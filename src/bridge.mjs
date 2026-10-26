import { EventEmitter } from 'node:events';
import { readFile, mkdir, open, unlink, appendFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';

export const BINDING = '__ncmKnowledgeHost';
export const METHODS = new Set(['config.get', 'config.save', 'connection.test', 'song.analyze', 'cache.clear']);
const DEBUG_ORIGIN = 'http://127.0.0.1:9227';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function isMainPage(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'orpheus:' && url.hostname === 'orpheus' && !url.username && !url.password && url.pathname === '/pub/app.html';
  } catch { return false; }
}

export function isAllowedContext(context, mainFrameId) {
  if (!context || context.auxData?.isDefault !== true || context.auxData?.frameId !== mainFrameId) return false;
  try {
    const origin = new URL(context.origin);
    return origin.protocol === 'orpheus:' && origin.hostname === 'orpheus' && !origin.username && !origin.password;
  } catch { return false; }
}

export function validateRequest(payload) {
  if (typeof payload !== 'string' || Buffer.byteLength(payload, 'utf8') > 32768) throw Error('请求过大或格式无效');
  let request;
  try { request = JSON.parse(payload); } catch { throw Error('请求格式无效'); }
  if (!request || !['string', 'number'].includes(typeof request.id) || String(request.id).length > 100 || !METHODS.has(request.method)) throw Error('不支持的请求');
  if (request.params !== undefined && (!request.params || typeof request.params !== 'object' || Array.isArray(request.params))) throw Error('请求参数无效');
  return request;
}

export function selectTarget(targets) {
  if (!Array.isArray(targets)) return null;
  return targets.find(target => {
    if (target.type !== 'page' || !isMainPage(target.url)) return false;
    try {
      const socket = new URL(target.webSocketDebuggerUrl);
      return socket.protocol === 'ws:' && ['127.0.0.1', 'localhost'].includes(socket.hostname) && socket.port === '9227' && !socket.username && !socket.password;
    } catch { return false; }
  }) || null;
}

export async function discoverTarget(fetchImpl = fetch) {
  const response = await fetchImpl(`${DEBUG_ORIGIN}/json/list`, { signal: AbortSignal.timeout(2500), redirect: 'error' });
  if (!response.ok) return null;
  const raw = await response.text();
  if (raw.length > 1024 * 1024) return null;
  return selectTarget(JSON.parse(raw));
}

export class CdpClient extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    socket.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (message.id) {
        const waiter = this.pending.get(message.id);
        if (!waiter) return;
        clearTimeout(waiter.timer);
        this.pending.delete(message.id);
        if (message.error) waiter.reject(Error('客户端接口执行失败'));
        else waiter.resolve(message.result || {});
      } else if (message.method) this.emit(message.method, message.params || {});
    });
    socket.addEventListener('close', () => {
      for (const waiter of this.pending.values()) { clearTimeout(waiter.timer); waiter.reject(Error('客户端连接已断开')); }
      this.pending.clear();
      this.emit('disconnect');
    });
    socket.addEventListener('error', () => {});
  }

  static async connect(url, WebSocketImpl = WebSocket) {
    const socket = new WebSocketImpl(url);
    const client = new CdpClient(socket);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(Error('客户端连接超时')); }, 5000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(Error('无法连接客户端')); }, { once: true });
    });
    return client;
  }

  send(method, params = {}) {
    if (this.socket.readyState !== 1) return Promise.reject(Error('客户端连接已断开'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error('客户端接口响应超时')); }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch { clearTimeout(timer); this.pending.delete(id); reject(Error('客户端连接已断开')); }
    });
  }

  close() { this.socket.close(); }
}

export async function attachClient(client, service, payload, log = () => {}, { readyTimeoutMs = 8000 } = {}) {
  const contexts = new Map();
  let mainFrameId;
  let mainUrl = '';
  let active = 0;
  let disposed = false;
  let readySettled = false;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // A failed command can reject readiness before attachClient reaches its await.
  void ready.catch(() => {});
  const readyTimer = setTimeout(() => settleReady(Error('页面扩展初始化超时，请检查客户端版本。')), readyTimeoutMs);
  const initialized = new Set();
  const listeners = [];
  function settleReady(error) {
    if (readySettled) return;
    readySettled = true;
    clearTimeout(readyTimer);
    if (error) { log('payload-not-ready'); rejectReady(error); }
    else resolveReady();
  }
  const on = (event, handler) => { client.on(event, handler); listeners.push([event, handler]); };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    settleReady(Error('客户端在扩展初始化前已断开。'));
    for (const [event, handler] of listeners) client.removeListener(event, handler);
    contexts.clear(); initialized.clear();
  };
  on('disconnect', dispose);
  let frameTree;
  try { frameTree = await client.send('Page.getFrameTree'); }
  catch (error) { dispose(); throw error; }
  mainFrameId = frameTree.frameTree?.frame?.id;
  mainUrl = frameTree.frameTree?.frame?.url || '';
  if (!mainFrameId || !isMainPage(mainUrl)) { dispose(); throw Error('未检测到网易云主页面'); }

  const initializeContext = async context => {
    if (disposed || !isMainPage(mainUrl) || !isAllowedContext(context, mainFrameId) || initialized.has(context.id)) return;
    initialized.add(context.id);
    try {
      await client.send('Runtime.addBinding', { name: BINDING, executionContextId: context.id });
      if (disposed || contexts.get(context.id) !== context) return;
      const expression = `/* ncm-knowledge-handshake */ (async () => {\n${payload}\nfor (let attempt = 0; attempt < 60; attempt++) {\n if (window.__ncmKnowledge && typeof window.__ncmKnowledgeReceive === 'function' && document.getElementById('ncm-song-knowledge-entry')) return { ready: true, version: window.__ncmKnowledge.version };\n await new Promise(resolve => setTimeout(resolve, 100));\n}\nreturn { ready: false };\n})()`;
      const evaluated = await client.send('Runtime.evaluate', { expression, contextId: context.id, returnByValue: true, awaitPromise: true });
      if (disposed || contexts.get(context.id) !== context) return;
      if (evaluated.exceptionDetails || evaluated.result?.value?.ready !== true) throw Error('页面扩展加载失败');
      log('payload-ready');
      settleReady();
    } catch {
      if (!disposed && contexts.get(context.id) === context) {
        initialized.delete(context.id); log('payload-failed'); settleReady(Error('歌曲知识入口未能加载，请检查客户端版本。'));
      }
    }
  };
  on('Runtime.executionContextCreated', ({ context }) => {
    contexts.set(context.id, context);
    void initializeContext(context);
  });
  on('Runtime.executionContextDestroyed', ({ executionContextId }) => { contexts.delete(executionContextId); initialized.delete(executionContextId); });
  on('Runtime.executionContextsCleared', () => { contexts.clear(); initialized.clear(); });
  on('Page.frameNavigated', ({ frame }) => {
    if (!frame.parentId) {
      mainFrameId = frame.id;
      mainUrl = frame.url;
      if (!isMainPage(mainUrl)) { contexts.clear(); initialized.clear(); client.close(); }
      else for (const context of contexts.values()) void initializeContext(context);
    }
  });
  const respond = async (context, message) => {
    if (disposed || contexts.get(context.id) !== context || !isMainPage(mainUrl) || !isAllowedContext(context, mainFrameId)) return;
    const serialized = JSON.stringify(message).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    await client.send('Runtime.evaluate', { expression: `/* ncm-knowledge-response */ typeof window.__ncmKnowledgeReceive === 'function' && window.__ncmKnowledgeReceive(${serialized})`, contextId: context.id });
  };
  on('Runtime.bindingCalled', event => {
    void (async () => {
      if (disposed || event.name !== BINDING) return;
      const context = contexts.get(event.executionContextId);
      if (!context || !isMainPage(mainUrl) || !isAllowedContext(context, mainFrameId)) return;
      let request;
      try { request = validateRequest(event.payload); }
      catch { log('request-rejected'); return; }
      if (active >= 3) { await respond(context, { id: request.id, error: '正在处理其他请求，请稍后再试' }); return; }
      active++;
      try {
        const result = await service.dispatch(request.method, request.params || {});
        await respond(context, { id: request.id, result });
      } catch (error) {
        const message = typeof error?.message === 'string' ? error.message.slice(0, 500) : '处理失败，请重试';
        await respond(context, { id: request.id, error: message });
      } finally { active--; }
    })().catch(() => log('response-unavailable'));
  });
  try {
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    // Every navigation creates a context event. Injecting only after that event
    // avoids accumulating persistent new-document scripts across reconnects.
    await ready;
    return { contexts, dispose };
  } catch (error) { dispose(); throw error; }
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function acquireLock(dataDir) {
  const lockPath = path.join(dataDir, 'bridge.lock');
  try {
    const existing = Number(await readFile(lockPath, 'utf8'));
    if (Number.isSafeInteger(existing) && existing > 0) {
      try { process.kill(existing, 0); return null; } catch (error) { if (error.code === 'EPERM') return null; }
    }
    await unlink(lockPath);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try {
    const handle = await open(lockPath, 'wx');
    await handle.writeFile(String(process.pid));
    await handle.close();
  } catch (error) { if (error.code === 'EEXIST') return null; throw error; }
  return async () => { try { if (Number(await readFile(lockPath, 'utf8')) === process.pid) await unlink(lockPath); } catch {} };
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes('--check')) {
    let target = null;
    try { target = await discoverTarget(); } catch {}
    // This is discovery only: a target is not proof that payload mounting worked.
    process.stdout.write(JSON.stringify({ ready: false, targetAvailable: Boolean(target), payloadVerified: false, port: 9227, target: target ? '网易云主页面' : null }) + '\n');
    return target ? 0 : 1;
  }
  const dataDir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'NcmSongKnowledge');
  await mkdir(dataDir, { recursive: true });
  const release = await acquireLock(dataDir);
  if (!release) return 0;
  const logPath = path.join(dataDir, 'bridge.log');
  try { if ((await stat(logPath)).size > 256000) await writeFile(logPath, ''); } catch {}
  const log = event => { void appendFile(logPath, `${new Date().toISOString()} ${event}\n`).catch(() => {}); };
  let stop = false;
  let current = null;
  const stopHandler = () => { stop = true; current?.close(); };
  process.once('SIGINT', stopHandler);
  process.once('SIGTERM', stopHandler);
  let unavailableSince = Date.now();
  let backoff = 1000;
  try {
    const { KnowledgeService } = await import('./service.mjs');
    const service = new KnowledgeService({ dataDir });
    const payload = await readFile(path.join(ROOT, 'src', 'payload.js'), 'utf8');
    while (!stop && Date.now() - unavailableSince < 30000) {
      try {
        const target = await discoverTarget();
        if (!target) throw Error('目标未就绪');
        current = await CdpClient.connect(target.webSocketDebuggerUrl);
        const disconnected = new Promise(resolve => current.once('disconnect', resolve));
        await attachClient(current, service, payload, log);
        log('client-connected');
        backoff = 1000;
        await disconnected;
        unavailableSince = Date.now();
        current = null;
        log('client-disconnected');
      } catch {
        current?.close();
        current = null;
        log('waiting-for-client');
      }
      if (!stop) await delay(backoff);
      backoff = Math.min(5000, backoff * 1.5);
    }
    log('bridge-stopped');
    return 0;
  } finally {
    current?.close();
    process.removeListener('SIGINT', stopHandler);
    process.removeListener('SIGTERM', stopHandler);
    await release();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(code => { process.exitCode = code; }).catch(() => { process.stderr.write('歌曲知识连接器启动失败，请查看本机日志或重新安装入口。\n'); process.exitCode = 1; });
}
