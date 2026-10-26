/* Song Knowledge UI. Loaded only into the installed client's main page. */
(() => {
  'use strict';
  if (window.top !== window) return;
  if (window.__ncmKnowledge) window.__ncmKnowledge.dispose();
  let disposed = false, sequence = 0, modal = null, view = null, focusBefore = null;
  let currentSong = null, pendingSong = null, activeRequest = 0, storeReader = null;
  let retryStoreAt = 0, mountTimer = null, pollTimer = null, observer = null;
  const pending = new Map(), hosts = new Set();
  const BOOK = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true"><path d="M12 5.5C9 3.7 5.5 4 3 5v14c2.5-1 6-1.3 9 .5 3-1.8 6.5-1.5 9-.5V5c-2.5-1-6-1.3-9 .5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 6v13" stroke="currentColor" stroke-width="1.6"/></svg>';
  const CSS = `
    :host{font:14px/1.6 -apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif;color:#242824;box-sizing:border-box;--accent:#bd343f;--ink:#242824;--muted:#6b706c;--line:#e7e7e1;--paper:#fff;--wash:#f7f7f3}
    *,*:before,*:after{box-sizing:border-box}button,input{font:inherit}button,a,input{outline-offset:4px}button{cursor:pointer}button:disabled{cursor:wait;opacity:.6}a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
    .entry{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid #b7b7b744;border-radius:18px;background:transparent;color:inherit;padding:6px 11px;white-space:nowrap;font-size:12px;line-height:18px}.entry:hover{color:var(--accent);background:#bd343f0a;border-color:#bd343f55}.fallback{position:fixed;right:178px;bottom:21px;z-index:9999;background:var(--paper);box-shadow:0 2px 12px #0001}
    .veil{position:fixed;inset:0;z-index:2147483000;background:#13161480;display:flex;align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(6px)}
    .dialog{width:780px;max-width:100%;max-height:calc(100vh - 48px);display:flex;flex-direction:column;background:var(--paper);border:1px solid var(--line);border-radius:18px;box-shadow:0 24px 90px #0005;overflow:hidden}
    header{padding:22px 28px 18px;border-bottom:1px solid var(--line);display:flex;align-items:flex-start;gap:18px;background:var(--wash)}.brand{width:42px;height:42px;border-radius:12px;color:var(--accent);background:#bd343f12;display:flex;align-items:center;justify-content:center}.heading{flex:1;min-width:0}.eyebrow{font-size:11px;letter-spacing:2px;color:var(--muted);margin-bottom:5px}h1{font-size:23px;line-height:1.4;margin:0 0 5px;font-weight:650;color:var(--ink);overflow-wrap:anywhere}.meta{font-size:12px;color:var(--muted)}.icon{background:transparent;border:0;color:var(--muted);font-size:22px;line-height:28px;padding:2px 6px;border-radius:6px}.icon:hover{background:#8882}.header-actions{display:flex;gap:8px;align-items:center}
    main{padding:24px 28px;overflow:auto;min-height:220px;overscroll-behavior:contain}footer{padding:14px 28px;border-top:1px solid var(--line);display:flex;gap:12px;align-items:center;justify-content:space-between;background:var(--wash);font-size:11px;color:var(--muted)}.actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.primary,.secondary{border:0;border-radius:9px;padding:9px 16px;line-height:20px;font-size:13px}.primary{background:var(--accent);color:white}.primary:hover{filter:brightness(1.06)}.secondary{background:var(--wash);border:1px solid var(--line);color:var(--ink)}.textbutton{background:none;border:0;padding:2px;color:var(--accent);font-size:12px}
    h2{font-size:17px;margin:0 0 10px;font-weight:650}h3{font-size:15px;margin:22px 0 8px}p{margin:0 0 12px}p:last-child{margin-bottom:0}.muted{color:var(--muted);font-size:12px}.intro{margin-bottom:22px}.step{display:inline-flex;align-items:center;background:#bd343f0d;color:var(--accent);padding:3px 9px;border-radius:6px;font-size:11px;margin-bottom:10px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.field{display:flex;flex-direction:column;gap:6px;margin:0 0 16px;font-size:12px;color:var(--ink)}.field input{padding:10px 12px;background:var(--paper);border:1px solid #b6bab4;border-radius:8px;color:var(--ink);width:100%;min-width:0}.field input:focus{border-color:var(--accent)}.field small{font-size:11px;color:var(--muted)}.keyrow{display:flex;gap:6px}.keyrow input{flex:1;min-width:0}.keyrow button{white-space:nowrap}.check{display:flex;gap:9px;align-items:flex-start;margin:8px 0 16px;font-size:12px}.check input{margin-top:5px;accent-color:var(--accent)}.notice{padding:12px 14px;border-radius:9px;background:var(--wash);color:var(--muted);font-size:12px;border:1px solid var(--line);margin-bottom:18px}.message{font-size:12px;min-height:20px;margin-top:12px;white-space:pre-wrap;overflow-wrap:anywhere}.error{color:#c02b3a}.success{color:#207546}.topics{display:flex;gap:8px;margin-bottom:24px;flex-wrap:wrap}.chip{padding:5px 10px;font-size:11px;border:1px solid var(--line);border-radius:20px;color:var(--muted)}.progress{padding:30px 10px;text-align:center}.spinner{display:inline-block;width:26px;height:26px;border:2px solid var(--line);border-top-color:var(--accent);border-radius:50%;animation:turn 1s linear infinite;margin-bottom:12px}@keyframes turn{to{transform:rotate(360deg)}}.answer{font-size:14px;line-height:1.95;color:var(--ink);overflow-wrap:anywhere}.answer ul,.answer ol{padding-left:24px;margin:10px 0 18px}.answer h2{margin-top:24px}.answer h3{margin-top:20px}.source-list{list-style:none;padding:0;margin:8px 0}.source-list li{border-top:1px solid var(--line);padding:9px 0;font-size:12px}.source-domain{display:block;font-size:10px;color:var(--muted);margin-left:26px}.source-num{color:var(--muted);display:inline-block;width:26px}.result-label{font-size:11px;color:var(--muted);margin-bottom:18px}.manual{border:1px solid var(--line);padding:16px;border-radius:10px;margin:15px 0}.manual .grid .field{margin-bottom:5px}.settings-row{display:flex;align-items:center;gap:15px;padding:18px 22px;border:1px solid var(--line);border-radius:10px;margin:20px 0;background:var(--paper)}.settings-row .copy{flex:1}.settings-row strong{display:block}.settings-row small{color:var(--muted)}
    @media(prefers-reduced-motion:reduce){.spinner{animation:none}}
    @media(max-width:600px){.veil{padding:10px}.dialog{max-height:calc(100vh - 20px)}header,main,footer{padding:18px}.grid{grid-template-columns:1fr}.eyebrow{letter-spacing:1px}h1{font-size:19px}.brand{display:none}footer{align-items:flex-start;flex-direction:column}.fallback{right:120px}}
    :host([data-theme="dark"]){--ink:#eceee9;--muted:#a4aba3;--line:#3c403b;--paper:#252824;--wash:#20231f;color:var(--ink);--accent:#f08087}:host([data-theme="dark"]) .field input{border-color:#656a62}:host([data-theme="dark"]) .primary{color:#231c1c}:host([data-theme="dark"]) .error{color:#ff929c}
  `;
  function element(tag, attrs = {}, text = '') {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'class') node.className = value;
      else node.setAttribute(key, value);
    }
    if (text) node.textContent = text;
    return node;
  }
  function theme(host) {
    try {
      const rgb = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g);
      const dark = rgb && (rgb.length < 4 || Number(rgb[3]) > 0) && Number(rgb[0])*.2126+Number(rgb[1])*.7152+Number(rgb[2])*.0722 < 105;
      host.dataset.theme = dark || document.documentElement.classList.contains('s-theme-dark') ? 'dark' : 'light';
    } catch (_) {}
  }
  function shadowHost(id) {
    const host = element('div', { id });
    const root = host.attachShadow({ mode: 'open' });
    root.appendChild(element('style', {}, CSS));
    theme(host); hosts.add(host);
    return { host, root };
  }
  function rpc(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = String(++sequence);
      if (typeof window.__ncmKnowledgeHost !== 'function') return reject(Error('本机连接已断开，请通过「网易云·歌曲知识」重新启动。'));
      const timer = setTimeout(() => { pending.delete(id); reject(Error('请求超时，请检查网络或重试。')); }, 180000);
      pending.set(id, { resolve, reject, timer });
      try { window.__ncmKnowledgeHost(JSON.stringify({ id, method, params })); }
      catch (_) { clearTimeout(timer); pending.delete(id); reject(Error('无法连接本机服务。')); }
    });
  }
  window.__ncmKnowledgeReceive = reply => {
    const item = pending.get(String(reply.id));
    if (!item) return;
    clearTimeout(item.timer); pending.delete(String(reply.id));
    if (reply.error) item.reject(Error(String(reply.error)));
    else item.resolve(reply.result);
  };
  function normalizeSong(raw) {
    if (!raw) return null;
    const artists = raw.artists || raw.ar || raw.resourceArtists || [];
    const title = String(raw.title || raw.name || raw.resourceName || '').trim();
    if (!title) return null;
    return { id: String(raw.id || raw.resourceTrackId || ''), title,
      artists: (Array.isArray(artists) ? artists : [artists]).map(a => typeof a === 'string' ? a : a.name || '').filter(Boolean),
      album: typeof raw.album === 'string' ? raw.album : (raw.album || raw.al || {}).name || raw.resourceAlbumName || '' };
  }
  function discoverStore() {
    if (Date.now() < retryStoreAt) return;
    retryStoreAt = Date.now() + 15000;
    try {
      let requireFn;
      const chunks = window.webpackJsonp;
      if (!Array.isArray(chunks)) return;
      const unique = 'song_knowledge_' + Date.now();
      chunks.push([[unique], { [unique]: (_m, _e, req) => { requireFn = req; } }, [[unique]]]);
      if (!requireFn || !requireFn.m) return;
      for (const id of Object.keys(requireFn.m)) {
        const source = String(requireFn.m[id]);
        if (!source.includes('dva-tool') || !source.includes('getStore')) continue;
        const exports = requireFn(id);
        const helper = Object.values(exports).find(value => value && typeof value.getStore === 'function');
        if (helper) { storeReader = () => helper.getStore(); break; }
      }
    } catch (_) {}
  }
  function readSong() {
    if (!storeReader) discoverStore();
    try {
      const store = storeReader && storeReader();
      const state = store && typeof store.getState === 'function' ? store.getState() : store;
      const playing = state && state.playing;
      if (playing) {
        const raw = playing.curTrack || (playing.curPlaying && (playing.curPlaying.track || playing.curPlaying));
        const song = normalizeSong({ ...raw, ...playing, id: playing.resourceTrackId || (raw && raw.id), name: playing.resourceName || (raw && raw.name) });
        if (song) return song;
      }
    } catch (_) { storeReader = null; }
    // Only use elements inside the current-player area; never read a search-result row.
    const fullTitle = document.querySelector('#page_pc_songplay [class*="TrackTitleContainer_"] .title');
    if (isVisible(fullTitle)) {
      const info = document.querySelector('#page_pc_songplay .info');
      const artist = info && info.querySelector('.artist > span[title]');
      const album = info && info.querySelector('.album .link[title]');
      return normalizeSong({ title: fullTitle.getAttribute('title') || fullTitle.textContent,
        artists: artist ? [artist.getAttribute('title') || artist.textContent] : [],
        album: album ? album.getAttribute('title') || album.textContent : '' });
    }
    const player = document.querySelector('#page_pc_mini_bar, .m-playbar, .m-player, [data-ncm-current-player]');
    if (player) {
      const title = player.querySelector('.playinfo .name, .f-dib .name, [data-song-title], a[href*="/song?id="]');
      const artists = [...player.querySelectorAll('[data-song-artist], a[href*="/artist?id="]')].map(n => n.textContent.trim());
      if (title && title.textContent.trim()) return normalizeSong({ title: title.getAttribute('title') || title.textContent, artists });
    }
    return null;
  }
  function close() {
    activeRequest++;
    if (modal) { hosts.delete(modal.host); modal.host.remove(); }
    modal = null; view = null;
    if (focusBefore && focusBefore.isConnected) focusBefore.focus();
  }
  function dialog(title, subtitle) {
    if (modal) close();
    focusBefore = document.activeElement;
    modal = shadowHost('ncm-song-knowledge-dialog');
    const veil = element('div', { class: 'veil' });
    const frame = element('section', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'knowledge-title' });
    const header = element('header');
    const brand = element('div', { class: 'brand' }); brand.innerHTML = BOOK;
    const heading = element('div', { class: 'heading' });
    heading.append(element('div', { class: 'eyebrow' }, '歌曲知识 / SONG NOTES'), element('h1', { id: 'knowledge-title' }, title), element('div', { class: 'meta' }, subtitle));
    const buttons = element('div', { class: 'header-actions' });
    const settings = element('button', { class: 'textbutton', 'data-action': 'settings', title: 'API 设置' }, '设置');
    settings.onclick = () => showSettings(false);
    const x = element('button', { class: 'icon', 'aria-label': '关闭', title: '关闭（Esc）' }, '×'); x.onclick = close;
    buttons.append(settings, x); header.append(brand, heading, buttons);
    const main = element('main'), footer = element('footer');
    footer.append(element('span', {}, 'DeepSeek · 仅点击查询时发送歌曲信息'), element('span', {}, '让每首歌，多一层理解'));
    frame.append(header, main, footer); veil.append(frame); modal.root.append(veil); document.body.append(modal.host);
    veil.addEventListener('click', e => { if (e.target === veil) close(); });
    frame.addEventListener('keydown', e => {
      if (e.key !== 'Tab') return;
      const targets = [...frame.querySelectorAll('button:not(:disabled),input:not(:disabled),a[href]')].filter(n => n.getClientRects().length);
      if (!targets.length) return;
      const focus = modal.root.activeElement;
      if (e.shiftKey && focus === targets[0]) { e.preventDefault(); targets[targets.length - 1].focus(); }
      else if (!e.shiftKey && focus === targets[targets.length - 1]) { e.preventDefault(); targets[0].focus(); }
    });
    x.focus();
    view = { main, footer, heading, settings, frame };
    return view;
  }
  function field(label, value, type = 'text', hint = '') {
    const wrap = element('label', { class: 'field' });
    const input = element('input', { type, autocomplete: type === 'password' ? 'new-password' : 'off' });
    input.value = value || '';
    wrap.append(element('span', {}, label), input);
    if (hint) wrap.append(element('small', {}, hint));
    return { wrap, input };
  }
  async function showSettings(first, songAfter = null) {
    pendingSong = songAfter;
    const v = dialog(first ? '先连接你的 DeepSeek' : '歌曲知识设置', first ? '设置一次，之后在播放页一键查询' : '管理 API、联网检索和本地缓存');
    v.settings.hidden = true;
    const loading = element('p', { class: 'muted' }, '正在读取本机设置…'); v.main.append(loading);
    let config;
    try { config = await rpc('config.get'); } catch (error) { loading.className = 'error'; loading.textContent = error.message; return; }
    if (!view || view !== v) return;
    v.main.replaceChildren();
    const intro = element('div', { class: 'intro' });
    intro.append(element('div', { class: 'step' }, first ? '首次使用 · API 连接' : 'API 连接'), element('p', {}, '先搜索资料，再整理创作背景、文化典故与听歌线索。'));
    const keyLink = element('a', { href: 'https://platform.deepseek.com/api_keys', target: '_blank', rel: 'noopener noreferrer' }, '前往 DeepSeek 获取 API Key ↗'); intro.append(keyLink);
    const key = field('API Key', '', 'password', config.hasKey ? '已保存密钥。留空表示保留，密钥不会回显。' : '密钥使用当前 Windows 账户加密后保存在本机。');
    key.input.placeholder = config.hasKey ? '已设置 · 留空保留' : 'sk-…'; key.input.name = 'api-key';
    const address = field('API 地址', config.baseUrl || 'https://api.deepseek.com', 'url', '官方地址或兼容的 HTTPS 接口'); address.input.name = 'base-url';
    const model = field('模型名称', config.model || 'deepseek-flash', 'text', '可填写服务商支持的模型'); model.input.name = 'model';
    const grid = element('div', { class: 'grid' }); grid.append(address.wrap, model.wrap);
    const check = element('label', { class: 'check' });
    const search = element('input', { type: 'checkbox' }); search.checked = config.searchEnabled !== false; search.name = 'search-enabled';
    check.append(search, element('span', {}, '联网检索（推荐）：调用同一 API 地址的 DeepSeek Search 接口，结果附网页来源。'));
    const note = element('div', { class: 'notice' }, '查询会把歌名、歌手、专辑发给你设置的服务商，并按其 API 规则计费。联网查询每次使用一次搜索和一次模型整理；重复查看优先使用本地缓存。关闭联网后会标明「未联网」。');
    const message = element('div', { class: 'message', role: 'status', 'aria-live': 'polite' });
    const actions = element('div', { class: 'actions' });
    const save = element('button', { class: 'primary', 'data-action': 'save' }, songAfter ? '保存并查询这首歌' : first ? '保存并继续' : '保存设置');
    const test = element('button', { class: 'secondary', 'data-action': 'test' }, '测试连接');
    const clear = element('button', { class: 'textbutton' }, '清除本地缓存');
    const remove = element('button', { class: 'textbutton' }, '删除已存密钥');
    const busy = yes => { save.disabled = test.disabled = clear.disabled = remove.disabled = yes; };
    const saveConfig = () => rpc('config.save', { baseUrl: address.input.value.trim(), model: model.input.value.trim(), apiKey: key.input.value.trim(), searchEnabled: search.checked });
    save.onclick = async () => {
      if (!config.hasKey && !key.input.value.trim()) { message.className = 'message error'; message.textContent = '请先填写 API Key。'; key.input.focus(); return; }
      busy(true); message.className = 'message'; message.textContent = '正在保存…';
      try {
        const saved = await saveConfig(); key.input.value = '';
        if (!view || view !== v) return;
        config = saved;
        message.className = 'message success'; message.textContent = '设置已保存。';
        key.input.placeholder = '已设置 · 留空保留';
        if (songAfter || first) { pendingSong = null; showResult(songAfter); }
      } catch (error) { message.className = 'message error'; message.textContent = error.message; }
      finally { busy(false); }
    };
    test.onclick = async () => {
      busy(true); message.className = 'message'; message.textContent = '正在测试（不生成内容）…';
      try {
        const result = await rpc('connection.test', { baseUrl: address.input.value.trim(), model: model.input.value.trim(), apiKey: key.input.value.trim() });
        message.className = 'message success'; message.textContent = typeof result === 'string' ? result : result.message || '连接成功。点击保存设置后生效。';
      } catch (error) { message.className = 'message error'; message.textContent = error.message; }
      finally { busy(false); }
    };
    clear.onclick = async () => { busy(true); try { await rpc('cache.clear'); message.textContent = '本地缓存已清除。'; } catch (error) { message.textContent = error.message; } finally { busy(false); } };
    remove.onclick = async () => { busy(true); try { await rpc('config.save', { clearKey: true }); key.input.value = ''; key.input.placeholder = 'sk-…'; key.wrap.querySelector('small').textContent = '已删除密钥。'; message.textContent = '已删除已存密钥。'; } catch (error) { message.textContent = error.message; } finally { busy(false); } };
    actions.append(save, test); const maintenance = element('div', { class: 'actions', style: 'margin-top:18px' }); maintenance.append(clear, remove);
    v.main.append(intro, key.wrap, grid, check, note, actions, message, maintenance);
    key.input.focus();
  }
  function inline(parent, text, sources) {
    const regex = /\*\*([^*]+)\*\*|\[(\d+)\]/g;
    let at = 0, match;
    while ((match = regex.exec(text))) {
      parent.append(document.createTextNode(text.slice(at, match.index)));
      if (match[1]) parent.append(element('strong', {}, match[1]));
      else {
        const n = Number(match[2]), source = sources[n - 1];
        if (source && /^https?:\/\//i.test(source.url)) parent.append(element('a', { href: source.url, target: '_blank', rel: 'noopener noreferrer' }, '[' + n + ']'));
        else parent.append(document.createTextNode(match[0]));
      }
      at = match.index + match[0].length;
    }
    parent.append(document.createTextNode(text.slice(at)));
  }
  function markdown(parent, text, sources) {
    let list = null;
    for (const line of String(text || '').split('\n')) {
      if (!line.trim()) { list = null; continue; }
      const heading = /^(#{1,4})\s+(.+)$/.exec(line), item = /^\s*(?:[-*]|\d+[.)])\s+(.+)$/.exec(line);
      if (heading) { list = null; const node = element(heading[1].length < 3 ? 'h2' : 'h3'); inline(node, heading[2], sources); parent.append(node); }
      else if (item) { if (!list) { list = element('ul'); parent.append(list); } const node = element('li'); inline(node, item[1], sources); list.append(node); }
      else { list = null; const node = element('p'); inline(node, line, sources); parent.append(node); }
    }
  }
  function manualForm(main, song) {
    const box = element('div', { class: 'manual' });
    box.append(element('p', { class: 'muted' }, song ? '也可以修改识别结果后查询：' : '暂时没读到正在播放的歌曲。请先播放一首歌，或手动填写：'));
    const title = field('歌名', song ? song.title : ''), artist = field('歌手', song ? song.artists.join(' / ') : '');
    title.input.name = 'song-title'; artist.input.name = 'song-artist';
    const grid = element('div', { class: 'grid' }); grid.append(title.wrap, artist.wrap);
    const go = element('button', { class: 'primary', style: 'margin-top:14px' }, '查询歌曲知识');
    const error = element('div', { class: 'message error', role: 'alert' });
    go.onclick = () => {
      if (!title.input.value.trim()) { error.textContent = '请填写歌名。'; return; }
      const next = { id: '', title: title.input.value.trim(), artists: artist.input.value.split(/\s*\/\s*/).map(x => x.trim()).filter(Boolean), album: '' };
      openSong(next);
    };
    box.append(grid, go, error); main.append(box); return title.input;
  }
  async function showResult(song, refresh = false) {
    const v = dialog(song ? song.title : '这首歌的另一面', song ? [song.artists.join(' / '), song.album].filter(Boolean).join(' · ') || '当前播放' : '创作背景 · 文化典故 · 音乐知识');
    if (!song) { manualForm(v.main, null).focus(); return; }
    const token = ++activeRequest;
    const topics = element('div', { class: 'topics' });
    for (const label of ['创作背景', '歌词与典故', '音乐知识', '延伸阅读']) topics.append(element('span', { class: 'chip' }, label));
    const progress = element('div', { class: 'progress', role: 'status', 'aria-live': 'polite' });
    progress.append(element('div', { class: 'spinner' }), element('p', {}, '正在查找这首歌背后的故事…'), element('p', { class: 'muted' }, '联网检索与资料整理可能需要几十秒'));
    v.main.append(topics, progress);
    try {
      const result = await rpc('song.analyze', { song, refresh });
      if (disposed || view !== v || token !== activeRequest) return;
      progress.remove();
      const sources = result.sources || [];
      const label = result.searchStatus === 'disabled' || result.searchStatus === 'offline' || !sources.length ? '未联网核验 · 模型解读，仅供参考' : '基于联网资料整理 · 点击文中序号查看来源';
      v.main.append(element('div', { class: 'result-label' }, label + (result.cached ? ' · 来自本地缓存' : '')));
      const answer = element('article', { class: 'answer' }); markdown(answer, result.text, sources); v.main.append(answer);
      if (sources.length) {
        v.main.append(element('h3', {}, '参考资料'));
        const list = element('ul', { class: 'source-list' });
        sources.forEach((source, index) => {
          if (!/^https?:\/\//i.test(source.url || '')) return;
          const li = element('li'), anchor = element('a', { href: source.url, target: '_blank', rel: 'noopener noreferrer' }, source.title || source.url);
          li.append(element('span', { class: 'source-num' }, '[' + (index + 1) + ']'), anchor);
          try { li.append(element('span', { class: 'source-domain' }, new URL(source.url).hostname)); } catch (_) {}
          list.append(li);
        }); v.main.append(list);
      }
      const actions = element('div', { class: 'actions', style: 'margin-top:22px' });
      const retry = element('button', { class: 'secondary', 'data-action': 'refresh' }, '重新搜索'); retry.onclick = () => showResult(song, true);
      const edit = element('button', { class: 'textbutton' }, '修改歌曲信息'); edit.onclick = () => { edit.disabled = true; manualForm(v.main, song).focus(); };
      actions.append(retry, edit); v.main.append(actions);
    } catch (error) {
      if (disposed || view !== v || token !== activeRequest) return;
      progress.replaceChildren(element('h2', {}, '这次查询没有完成'), element('p', { class: 'error', role: 'alert' }, error.message));
      const retry = element('button', { class: 'primary' }, '重试'); retry.onclick = () => showResult(song, refresh);
      const settings = element('button', { class: 'secondary', style: 'margin-left:10px' }, '检查 API 设置'); settings.onclick = () => showSettings(false, song);
      progress.append(retry, settings);
    }
  }
  async function openSong(song) {
    try {
      const config = await rpc('config.get');
      if (!config.hasKey) return showSettings(true, song);
      showResult(song);
    } catch (error) { const v = dialog('歌曲知识连接异常', ''); v.main.append(element('p', { class: 'error' }, error.message)); }
  }
  function onClick() { currentSong = readSong(); openSong(currentSong); }
  function isVisible(node) { return !!node && node.getClientRects().length > 0; }
  function mount() {
    if (disposed || !document.body) return;
    let entry = document.getElementById('ncm-song-knowledge-entry');
    const selectors = [
      '[class*="VinylPageContainer_"] .page-footer .vinyl-page-bar-wrapper .left',
      '[class*="VinylPageContainer_"] .page-footer .vinyl-page-bar-wrapper .red-star-comment-wrapper',
      '.vinyl-page-bar-wrapper .left', '.vinyl-page-bar-wrapper .red-star-comment-wrapper',
      '.m-player .btns', '.m-playbar .oper', '[data-ncm-play-actions]'
    ];
    let target;
    for (const selector of selectors) { target = [...document.querySelectorAll(selector)].find(isVisible); if (target) break; }
    if (!entry) {
      const created = shadowHost('ncm-song-knowledge-entry'); entry = created.host;
      const button = element('button', { class: 'entry', title: '查询当前歌曲的创作背景、典故与音乐知识', 'aria-label': '歌曲知识' });
      button.innerHTML = BOOK; button.append(document.createTextNode('歌曲知识')); button.onclick = onClick;
      created.root.append(button);
      // The client's minibar uses mouse-up on its parent to open the full player.
      for (const type of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup']) entry.addEventListener(type, event => event.stopPropagation());
    }
    if (target && entry.parentNode !== target) { entry.className = ''; entry.style.cssText = 'display:inline-flex;vertical-align:middle;margin:0 8px;flex-shrink:0'; target.append(entry); }
    else if (!target && !entry.isConnected) { entry.className = ''; entry.style.cssText = 'position:fixed;right:174px;bottom:24px;z-index:9999'; entry.shadowRoot.querySelector('.entry').classList.add('fallback'); document.body.append(entry); }
    theme(entry);
    if (target) entry.shadowRoot.querySelector('.entry').classList.remove('fallback');
    // Added to the client's settings route; the header settings shortcut is always available in the dialog.
    const path = location.hash + location.pathname;
    const settingsTarget = [...document.querySelectorAll('#page_pc_setting main.right-container, #page_pc_setting main[class*="Container_"]')].find(isVisible) ||
      (/setting|preference/i.test(path) ? [...document.querySelectorAll('.m-set, .m-setting, [data-ncm-settings]')].find(isVisible) : null);
    let row = document.getElementById('ncm-song-knowledge-settings');
    if (settingsTarget && !row) {
      const created = shadowHost('ncm-song-knowledge-settings'); row = created.host;
      const content = element('div', { class: 'settings-row' }), copy = element('div', { class: 'copy' });
      copy.append(element('strong', {}, '歌曲知识'), element('small', {}, 'DeepSeek API · 联网检索与歌曲背景解读'));
      const button = element('button', { class: 'secondary' }, 'API 设置'); button.onclick = () => showSettings(false);
      content.append(copy, button); created.root.append(content); settingsTarget.prepend(row);
    }
    if (!settingsTarget && row) { hosts.delete(row); row.remove(); }
  }
  function onKey(event) { if (event.key === 'Escape' && modal) { event.preventDefault(); event.stopPropagation(); close(); } }
  const publicApi = {
    version: '0.1.0', readSong, open: onClick, openSettings: () => showSettings(false),
    dispose() {
      disposed = true; activeRequest++;
      clearTimeout(mountTimer); clearInterval(pollTimer); if (observer) observer.disconnect();
      document.removeEventListener('keydown', onKey, true);
      for (const item of pending.values()) { clearTimeout(item.timer); item.reject(Error('连接已重置，请重试。')); }
      pending.clear(); for (const host of hosts) host.remove(); hosts.clear();
      delete window.__ncmKnowledgeReceive;
    }
  };
  window.__ncmKnowledge = publicApi;
  function init() {
    if (disposed) return;
    document.addEventListener('keydown', onKey, true); mount();
    observer = new MutationObserver(records => {
      if (!records.some(record => ![...hosts].some(host => host === record.target || host.contains(record.target)))) return;
      clearTimeout(mountTimer); mountTimer = setTimeout(mount, 400);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    pollTimer = setInterval(() => { if (!document.hidden) mount(); }, 3000);
  }
  if (document.body) init(); else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
