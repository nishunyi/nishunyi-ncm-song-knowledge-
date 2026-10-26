import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  const bundled = path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  try { ({ chromium } = require(bundled)); } catch {}
}
const executable = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => p && existsSync(p));

test('player entry, first-use settings, saved configuration, safe result and native settings entry', { skip: !chromium || !executable }, async () => {
  const browser = await chromium.launch({ executablePath: executable, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const requests = []; page.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
    await page.goto(pathToFileURL(path.join(project, 'demo/index.html')).href);
    const entry = page.locator('#ncm-song-knowledge-entry').getByRole('button', { name: '歌曲知识', exact: true });
    await entry.waitFor();
    assert.match(await page.evaluate(() => document.getElementById('ncm-song-knowledge-entry').parentElement.className), /left/);
    assert.deepEqual(await page.evaluate(() => window.__ncmKnowledge.readSong()), { id: '185017', title: '夜曲', artists: ['周杰伦'], album: '十一月的萧邦' });
    assert.deepEqual(await page.evaluate(() => window.demoCalls), []);
    await entry.click();
    await page.getByRole('heading', { name: '先连接你的 DeepSeek' }).waitFor();
    const key = page.locator('input[name="api-key"]'); await key.waitFor();
    await mkdir(path.join(project, 'test-output'), { recursive: true });
    await page.screenshot({ path: path.join(project, 'test-output/first-use.png') });
    await page.getByRole('button', { name: '保存并查询这首歌' }).click();
    await page.getByText('请先填写 API Key。', { exact: true }).waitFor();
    await key.fill('offline-test-placeholder');
    await page.getByRole('button', { name: '测试连接', exact: true }).click();
    await page.getByText('离线演示：模拟连接成功，不会发出网络请求。').waitFor();
    await page.getByRole('button', { name: '保存并查询这首歌' }).click();
    await page.getByRole('heading', { name: '创作背景', exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: '[1]', exact: true }).getAttribute('href'), 'https://api-docs.deepseek.com/guides/search/');
    await page.screenshot({ path: path.join(project, 'test-output/result.png') });
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('heading', { name: '歌曲知识设置' }).waitFor();
    assert.equal(await page.locator('input[name="api-key"]').inputValue(), '');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '预览设置页' }).click();
    await page.locator('#ncm-song-knowledge-settings').getByRole('button', { name: 'API 设置' }).click();
    await page.getByRole('heading', { name: '歌曲知识设置' }).waitFor();
    await page.keyboard.press('Escape');
    await page.evaluate(() => { window.demoText = '## 创作背景\n<img src=x onerror="window.evil=true">\n<script>window.evil=true</script>\n[1]'; });
    await entry.click();
    await page.getByRole('heading', { name: '创作背景', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => Boolean(window.evil)), false);
    assert.equal(await page.locator('#ncm-song-knowledge-dialog article img').count(), 0);
    assert.deepEqual(requests, []);
  } finally { await browser.close(); }
});

test('closing an in-flight query cannot replace a later settings screen, and DOM-only song fallback works', { skip: !chromium || !executable }, async () => {
  const browser = await chromium.launch({ executablePath: executable, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
    await page.goto(pathToFileURL(path.join(project, 'demo/index.html')).href);
    await page.evaluate(() => { window.demoConfig.hasKey = true; window.demoDelay = 500; window.webpackJsonp = undefined; });
    assert.equal((await page.evaluate(() => window.__ncmKnowledge.readSong())).title, '夜曲');
    await page.locator('#ncm-song-knowledge-entry').getByRole('button', { name: '歌曲知识' }).click();
    await page.getByText('正在查找这首歌背后的故事…').waitFor();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('heading', { name: '歌曲知识设置' }).waitFor();
    await page.waitForFunction(() => window.demoCalls.includes('song.analyze'));
    await new Promise(resolve => setTimeout(resolve, 650));
    assert.equal(await page.getByRole('heading', { name: '歌曲知识设置' }).count(), 1);
    assert.equal(await page.getByRole('heading', { name: '创作背景', exact: true }).count(), 0);
    await page.evaluate(() => { window.__ncmKnowledge.dispose(); });
    assert.equal(await page.locator('#ncm-song-knowledge-entry').count(), 0);
  } finally { await browser.close(); }
});
