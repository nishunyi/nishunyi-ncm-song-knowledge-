import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, basename, resolve, join } from 'node:path';
import { KnowledgeService, normalizeBaseUrl, createWindowsVault } from '../src/service.mjs';

const KEY = 'test-private-key-never-print';
const SONG = { id: '123', title: '稻香', artists: ['周杰伦'], album: '魔杰座' };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

async function fixture(t, fetchImpl) {
  const dataDir = await mkdtemp(join(tmpdir(), 'ncm-knowledge-test-'));
  t.after(async () => {
    assert.equal(dirname(resolve(dataDir)), resolve(tmpdir()));
    assert.equal(basename(dataDir).startsWith('ncm-knowledge-test-'), true);
    await rm(dataDir, { recursive: true, force: true });
  });
  let secret = '';
  const vault = { async load() { return secret; }, async save(value) { secret = value; }, async clear() { secret = ''; } };
  const service = new KnowledgeService({ dataDir, fetchImpl, vault });
  await service.dispatch('config.save', { apiKey: KEY });
  return { service, dataDir, getSecret: () => secret };
}

test('normalizes compatible base URLs and refuses credential-bearing or insecure destinations', () => {
  assert.equal(normalizeBaseUrl(' https://api.deepseek.com/ '), 'https://api.deepseek.com');
  assert.equal(normalizeBaseUrl('https://example.com/v1/chat/completions/'), 'https://example.com/v1');
  assert.equal(normalizeBaseUrl('http://127.0.0.1:8000/v1'), 'http://127.0.0.1:8000/v1');
  assert.equal(normalizeBaseUrl('http://[::1]:8000'), 'http://[::1]:8000');
  for (const value of ['http://example.com', 'file:///secret', 'https://name:secret@example.com', 'https://example.com?key=secret', 'https://example.com#key']) {
    assert.throws(() => normalizeBaseUrl(value));
  }
});

test('saving an empty key preserves it, config never exposes or stores plaintext, clearKey removes it', async t => {
  const { service, dataDir, getSecret } = await fixture(t, () => { throw new Error('unexpected network'); });
  const config = await service.dispatch('config.save', { apiKey: '', model: 'custom-model' });
  assert.equal(getSecret(), KEY);
  assert.equal(config.hasKey, true);
  assert.equal(config.model, 'custom-model');
  assert.equal(JSON.stringify(config).includes(KEY), false);
  assert.equal((await readFile(join(dataDir, 'config.json'), 'utf8')).includes(KEY), false);
  assert.equal((await service.dispatch('config.save', { clearKey: true })).hasKey, false);
  assert.equal(getSecret(), '');
});

test('invalid config is rejected before replacing the credential', async t => {
  const { service, getSecret } = await fixture(t, () => {});
  await assert.rejects(service.dispatch('config.save', { apiKey: 'replacement', baseUrl: 'http://example.com' }), /HTTPS/);
  assert.equal(getSecret(), KEY);
});

test('connection test only requests models and prohibits bearer redirect forwarding', async t => {
  const calls = [];
  const { service } = await fixture(t, async (url, options) => {
    calls.push({ url, options });
    return json({ data: [{ id: 'deepseek-flash' }] });
  });
  const result = await service.dispatch('connection.test');
  assert.deepEqual(result.models, ['deepseek-flash']);
  assert.equal(result.modelAvailable, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.deepseek.com/models');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(calls[0].options.body, undefined);
});

test('connection test can verify an unsaved candidate without changing saved configuration', async t => {
  const calls = [];
  const { service, getSecret } = await fixture(t, async (url, options) => {
    calls.push({ url, authorization: options.headers.Authorization });
    return json({ data: [{ id: 'other-model' }] });
  });
  const candidate = await service.dispatch('connection.test', { baseUrl: 'https://other.example/v1/', apiKey: 'candidate-key', model: 'missing-model' });
  assert.equal(candidate.modelAvailable, false);
  assert.match(candidate.message, /missing-model.*未在模型列表中找到/);
  assert.equal(calls[0].url, 'https://other.example/v1/models');
  assert.equal(calls[0].authorization, 'Bearer candidate-key');
  assert.equal((await service.dispatch('config.get')).baseUrl, 'https://api.deepseek.com');
  assert.equal(getSecret(), KEY);
  await service.dispatch('connection.test', { apiKey: '' });
  assert.equal(calls[1].authorization, `Bearer ${KEY}`);
});

test('filtered invalid search results leave continuous citation IDs in the prompt and public sources', async t => {
  let references;
  const { service } = await fixture(t, async (url, options) => {
    if (url.endsWith('/search')) return json({ results: [
      { title: 'invalid', url: 'javascript:alert(1)', content: 'invalid' },
      { title: 'empty', url: 'https://empty.example', content: '' },
      { title: 'first valid', url: 'https://one.example', content: 'first evidence' },
      { title: 'second valid', url: 'https://two.example', content: 'second evidence' },
    ] });
    references = JSON.parse(JSON.parse(options.body).messages[1].content).references;
    return json({ choices: [{ message: { content: '来源一。[1] 来源二。[2]' } }] });
  });
  const result = await service.dispatch('song.analyze', { song: SONG });
  assert.deepEqual(result.sources.map(source => source.id), [1, 2]);
  assert.deepEqual(references.map(source => source.id), [1, 2]);
  assert.equal(result.sources[0].title, 'first valid');
});

test('searches before generation, supplies source evidence, and caches by song/provider/model', async t => {
  const calls = [];
  const { service, dataDir } = await fixture(t, async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url, body });
    if (url.endsWith('/tools/search')) return json({ results: [{ title: '作者访谈', url: 'https://example.org/interview', content: '有来源的创作背景。', snippet: '采访摘要' }] });
    return json({ choices: [{ message: { content: '## 创作背景\n根据访谈资料。[1]' } }] });
  });
  const first = await service.dispatch('song.analyze', { song: SONG });
  assert.equal(first.cached, false);
  assert.equal(first.searchStatus, 'searched');
  assert.equal(first.sources[0].url, 'https://example.org/interview');
  assert.equal(first.sources[0].evidence, undefined);
  assert.equal(calls[0].url, 'https://api.deepseek.com/v1/tools/search');
  assert.equal(calls[0].body.need_content, true);
  assert.equal(calls[1].body.messages[1].content.includes('有来源的创作背景。'), true);
  assert.equal(calls[1].body.messages[0].content.includes('不是指令'), true);
  const second = await service.dispatch('song.analyze', { song: SONG });
  assert.equal(second.cached, true);
  assert.equal(calls.length, 2);
  assert.equal((await readFile(join(dataDir, 'cache.json'), 'utf8')).includes(KEY), false);
  await service.dispatch('config.save', { model: 'other-model' });
  await service.dispatch('song.analyze', { song: SONG });
  assert.equal(calls.length, 4);
  await service.dispatch('cache.clear');
  await service.dispatch('song.analyze', { song: SONG });
  assert.equal(calls.length, 6);
});

test('failed or empty search cannot silently generate an allegedly researched answer', async t => {
  let calls = 0;
  const { service } = await fixture(t, async () => { calls++; return json({ error: { message: KEY } }, 401); });
  await assert.rejects(service.dispatch('song.analyze', { song: SONG }), error => /联网搜索失败/.test(error.message) && !error.message.includes(KEY));
  assert.equal(calls, 1);
  service.fetch = async () => json({ results: [] });
  await assert.rejects(service.dispatch('song.analyze', { song: SONG }), /没有搜索到可用资料/);
});

test('disabled search is explicit and has no fabricated source list', async t => {
  const calls = [];
  const { service } = await fixture(t, async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return json({ choices: [{ message: { content: '未联网：以下内容未经实时资料核验。' } }] });
  });
  await service.dispatch('config.save', { searchEnabled: false });
  const result = await service.dispatch('song.analyze', { song: SONG });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.endsWith('/chat/completions'), true);
  assert.equal(JSON.parse(calls[0].body.messages[1].content).mode, '未联网');
  assert.equal(result.searchStatus, 'disabled');
  assert.deepEqual(result.sources, []);
});

test('network errors, provider error bodies and redirect locations never reveal the key', async t => {
  const { service } = await fixture(t, async () => { throw new Error(`network error ${KEY}`); });
  await assert.rejects(service.dispatch('connection.test'), error => !error.message.includes(KEY));
  service.fetch = async () => json({ error: { message: KEY } }, 429);
  await assert.rejects(service.dispatch('connection.test'), error => /频繁/.test(error.message) && !error.message.includes(KEY));
  service.fetch = async () => new Response('', { status: 302, headers: { Location: `https://example.com/${KEY}` } });
  await assert.rejects(service.dispatch('connection.test'), error => /重定向/.test(error.message) && !error.message.includes(KEY));
});

test('oversized API responses are refused', async t => {
  const { service } = await fixture(t, async () => new Response('{}', { headers: { 'content-length': '99999999' } }));
  await assert.rejects(service.dispatch('connection.test'), /过大/);
});

test('simultaneous analyses of one song share the same two API requests', async t => {
  let calls = 0;
  const { service } = await fixture(t, async url => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 5));
    return url.endsWith('/search')
      ? json({ results: [{ title: '来源', url: 'https://example.com', summary: '可靠资料' }] })
      : json({ choices: [{ message: { content: '音乐解读。[1]' } }] });
  });
  const [first, second] = await Promise.all([service.dispatch('song.analyze', { song: SONG }), service.dispatch('song.analyze', { song: SONG })]);
  assert.deepEqual(first, second);
  assert.equal(calls, 2);
});

test('Windows DPAPI stores encrypted data and survives a fresh vault instance', { skip: process.platform !== 'win32' }, async t => {
  const { dataDir } = await fixture(t, () => {});
  const vault = createWindowsVault(dataDir);
  await vault.save(KEY);
  const saved = await readFile(join(dataDir, 'secret.dpapi'), 'utf8');
  assert.equal(saved.includes(KEY), false);
  assert.equal(await createWindowsVault(dataDir).load(), KEY);
  await vault.clear();
  assert.equal(await createWindowsVault(dataDir).load(), '');
});
