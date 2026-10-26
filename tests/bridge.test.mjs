import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { isMainPage, isAllowedContext, validateRequest, selectTarget, attachClient, BINDING, CdpClient } from '../src/bridge.mjs';

const context = (id = 1, frameId = 'main') => ({ id, origin: 'orpheus://orpheus', auxData: { isDefault: true, frameId } });
const flush = () => new Promise(resolve => setImmediate(resolve));

test('only local NetEase app targets and its main default world are allowed', () => {
  assert.equal(isMainPage('orpheus://orpheus/pub/app.html#/setting'), true);
  for (const url of ['https://music.163.com/', 'http://127.0.0.1/', 'orpheus://orpheus/evil.html', 'orpheus://orpheus.evil/pub/app.html']) assert.equal(isMainPage(url), false);
  assert.equal(isAllowedContext(context(), 'main'), true);
  assert.equal(isAllowedContext(context(1, 'iframe'), 'main'), false);
  assert.equal(isAllowedContext({ ...context(), origin: 'https://music.163.com' }, 'main'), false);
  assert.equal(isAllowedContext({ ...context(), auxData: { isDefault: false, frameId: 'main' } }, 'main'), false);
  const target = { type: 'page', url: 'orpheus://orpheus/pub/app.html', webSocketDebuggerUrl: 'ws://127.0.0.1:9227/devtools/page/ncm' };
  assert.equal(selectTarget([{ ...target, url: 'https://example.org' }, target]), target);
  assert.equal(selectTarget([{ ...target, webSocketDebuggerUrl: 'ws://evil.test:9227/devtools/page/ncm' }]), null);
});

test('bridge request validation bounds messages and restricts methods', () => {
  assert.equal(validateRequest(JSON.stringify({ id: '1', method: 'config.get' })).method, 'config.get');
  for (const payload of ['{', JSON.stringify({ id: '1', method: 'eval' }), JSON.stringify({ id: {}, method: 'config.get' }), JSON.stringify({ id: '1', method: 'config.save', params: [] }), 'x'.repeat(32769)]) assert.throws(() => validateRequest(payload));
});

class FakeClient extends EventEmitter {
  constructor({ mounted = true, createContext = true } = {}) { super(); this.calls = []; this.mounted = mounted; this.createContext = createContext; }
  async send(method, params) {
    this.calls.push({ method, params });
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main', url: 'orpheus://orpheus/pub/app.html' } } };
    if (method === 'Runtime.enable' && this.createContext) this.emit('Runtime.executionContextCreated', { context: context(1) });
    if (method === 'Runtime.evaluate' && params.expression.includes('ncm-knowledge-handshake')) return { result: { value: { ready: this.mounted, version: '0.1.0' } } };
    return {};
  }
  close() { this.closed = true; this.emit('disconnect'); }
}

test('binding response returns to calling main context; iframe calls are ignored', async () => {
  const client = new FakeClient();
  const invoked = [];
  await attachClient(client, { dispatch: async (method, params) => { invoked.push({ method, params }); return { hasKey: false }; } }, 'void 0;');
  client.emit('Runtime.executionContextCreated', { context: context(9) });
  client.emit('Runtime.executionContextCreated', { context: context(10, 'iframe') });
  await flush();
  client.emit('Runtime.bindingCalled', { name: BINDING, executionContextId: 10, payload: JSON.stringify({ id: 1, method: 'config.get' }) });
  client.emit('Runtime.bindingCalled', { name: BINDING, executionContextId: 9, payload: JSON.stringify({ id: 2, method: 'config.get' }) });
  await flush();
  assert.equal(invoked.length, 1);
  const reply = client.calls.find(call => call.method === 'Runtime.evaluate' && call.params.expression.includes('ncm-knowledge-response'));
  assert.equal(reply.params.contextId, 9);
  assert.match(reply.params.expression, /"id":2/);
});

test('context replacement prevents a delayed response reaching a reused context id', async () => {
  const client = new FakeClient();
  let resolve;
  await attachClient(client, { dispatch: () => new Promise(done => { resolve = done; }) }, 'void 0;');
  client.emit('Runtime.executionContextCreated', { context: context(9) });
  await flush();
  client.emit('Runtime.bindingCalled', { name: BINDING, executionContextId: 9, payload: JSON.stringify({ id: 5, method: 'song.analyze' }) });
  await flush();
  client.emit('Runtime.executionContextDestroyed', { executionContextId: 9 });
  client.emit('Runtime.executionContextCreated', { context: context(9) });
  resolve({ text: 'old response' });
  await flush();
  assert.equal(client.calls.filter(call => call.method === 'Runtime.evaluate' && call.params.expression.includes('ncm-knowledge-response')).length, 0);
});

test('three concurrent business requests are allowed and the fourth gets a retryable reply', async () => {
  const client = new FakeClient();
  const resolvers = [];
  await attachClient(client, { dispatch: () => new Promise(resolve => resolvers.push(resolve)) }, 'void 0;');
  client.emit('Runtime.executionContextCreated', { context: context(1) });
  await flush();
  for (let id = 1; id <= 4; id++) client.emit('Runtime.bindingCalled', { name: BINDING, executionContextId: 1, payload: JSON.stringify({ id, method: 'song.analyze' }) });
  await flush();
  assert.equal(resolvers.length, 3);
  assert.ok(client.calls.some(call => call.params?.expression?.includes('正在处理其他请求')));
  for (const resolve of resolvers) resolve({ text: 'done' });
  await flush();
});

test('client socket messages resolve requests and close rejects outstanding calls', async () => {
  class Socket extends EventTarget {
    readyState = 1;
    send(value) { this.last = JSON.parse(value); }
    close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
  }
  const socket = new Socket();
  const client = new CdpClient(socket);
  const response = client.send('Page.enable');
  socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id: socket.last.id, result: { done: true } }) }));
  assert.deepEqual(await response, { done: true });
  const pending = client.send('Runtime.enable');
  socket.close();
  await assert.rejects(pending, /连接已断开/);
});

test('attach waits for mounted payload handshake and rejects missing entry', async () => {
  const failed = new FakeClient({ mounted: false });
  const events = [];
  await assert.rejects(attachClient(failed, {}, 'void 0;', value => events.push(value)), /入口未能加载/);
  assert.ok(events.includes('payload-failed'));
  assert.equal(events.includes('payload-ready'), false);
  assert.equal(failed.listenerCount('Runtime.bindingCalled'), 0);
  const noContext = new FakeClient({ createContext: false });
  await assert.rejects(attachClient(noContext, {}, 'void 0;', () => {}, { readyTimeoutMs: 15 }), /初始化超时/);
});

test('context navigation reinjects once and reconnect never registers persistent scripts', async () => {
  const client = new FakeClient();
  await attachClient(client, {}, 'void 0;');
  client.emit('Runtime.executionContextCreated', { context: context(1) });
  await flush();
  assert.equal(client.calls.filter(call => call.method === 'Runtime.addBinding').length, 1);
  client.emit('Runtime.executionContextsCleared');
  client.emit('Runtime.executionContextCreated', { context: context(2) });
  await flush();
  assert.equal(client.calls.filter(call => call.method === 'Runtime.addBinding').length, 2);
  client.close();
  assert.equal(client.listenerCount('Runtime.executionContextCreated'), 0);
  assert.equal(client.listenerCount('Runtime.bindingCalled'), 0);
  await attachClient(client, {}, 'void 0;');
  assert.equal(client.calls.filter(call => call.method === 'Page.addScriptToEvaluateOnNewDocument').length, 0);
  client.close();
});
