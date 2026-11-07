(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const state = { ready: false, enabled: true, rules: Object.create(null), models: [], selected: '', dirty: false, saving: false };
  let catalogLoading = false, revision = 0, lastWriteAt = 0;
  function error(message = '') { $('error').textContent = message; $('error').hidden = !message; }
  function changed() { revision++; state.dirty = true; $('save-status').textContent = '有未保存的修改'; $('save').disabled = !state.ready || state.saving; }
  function draft() {
    if (!state.selected) return;
    state.rules[state.selected] = { prompt: $('prompt').value, enabled: $('rule-enabled').checked, position: $('position').value };
  }
  function allModels() {
    const map = new Map(state.models.map(m => [m.id, m]));
    for (const id of Object.keys(state.rules)) if (!map.has(id)) {
      const slash = id.indexOf('/');
      map.set(id, { id, name: slash >= 0 ? id.slice(slash + 1) : id, provider: slash >= 0 ? id.slice(0, slash) : '已保存', missing: true });
    }
    return [...map.values()];
  }
  function renderList() {
    const query = $('search').value.toLocaleLowerCase();
    const models = allModels();
    $('count').textContent = String(state.models.length);
    $('models').replaceChildren();
    for (const m of models.filter(m => (m.name + ' ' + m.id).toLocaleLowerCase().includes(query))) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'model-item' + (m.id === state.selected ? ' selected' : '');
      button.setAttribute('aria-pressed', String(m.id === state.selected));
      const title = document.createElement('span'); title.className = 'model-title';
      const name = document.createElement('span'); name.textContent = m.name; title.append(name);
      const rule = state.rules[m.id];
      if (rule?.prompt?.trim()) { const dot = document.createElement('span'); dot.className = 'dot' + (rule.enabled === false ? ' off' : ''); dot.title = rule.enabled === false ? '已暂停' : '已配置提示词'; title.append(dot); }
      const sub = document.createElement('span'); sub.className = 'model-sub'; sub.textContent = m.provider + (m.missing ? ' · 当前未开放' : '');
      button.append(title, sub); button.addEventListener('click', () => select(m.id)); $('models').append(button);
    }
    if (!$('models').children.length) { const p = document.createElement('p'); p.className = 'catalog-status'; p.textContent = query ? '没有匹配的模型' : '还没有识别到开放的模型'; $('models').append(p); }
  }
  function select(id) {
    draft(); state.selected = id;
    const m = allModels().find(m => m.id === id); if (!m) return;
    const rule = state.rules[id] || { prompt: '', enabled: true, position: 'append' };
    $('empty').hidden = true; $('editing').hidden = false;
    $('model-name').textContent = m.name; $('model-id').textContent = m.id;
    $('prompt').value = rule.prompt || ''; $('rule-enabled').checked = rule.enabled !== false; $('length').textContent = Array.from($('prompt').value).length + ' 字';
    $('position').value = rule.position === 'prepend' ? 'prepend' : 'append'; positionHint();
    renderList();
  }
  function applyCatalog(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.models)) return;
    state.models = snapshot.models.filter(m => m && typeof m.id === 'string' && typeof m.name === 'string');
    renderList();
    $('catalog-status').textContent = snapshot.available ? '已连接本机 Magpie · 自动同步模型' : '正在连接本机 Magpie，暂时显示已识别的模型';
    if (state.ready && !state.selected && state.models.length) select(state.models[0].id);
  }
  function refreshCatalog() {
    if (catalogLoading) return;
    catalogLoading = true;
    const script = document.createElement('script');
    script.src = 'catalog.generated.js?t=' + Date.now();
    script.onload = () => { catalogLoading = false; script.remove(); applyCatalog(window.MODEL_PROMPT_CATALOG); };
    script.onerror = () => { catalogLoading = false; script.remove(); $('catalog-status').textContent = '模型列表读取失败，请点击刷新重试'; };
    document.head.append(script);
  }
  async function save() {
    if (!state.ready || state.saving) return;
    draft(); state.saving = true; $('save').disabled = true; error();
    const savingRevision = revision;
    try {
      const rules = Object.create(null);
      for (const [id, rule] of Object.entries(state.rules)) if (rule.prompt?.trim()) rules[id] = { enabled: rule.enabled !== false, prompt: rule.prompt, position: rule.position === 'prepend' ? 'prepend' : 'append' };
      const current = await magpie.options.get();
      const options = { ...current, version: 1, enabled: state.enabled, rules };
      if (new TextEncoder().encode(JSON.stringify({ options })).length > 60000) throw new Error('提示词总量过大，超过了 Magpie 页面设置的保存容量。请缩短部分提示词后重试。');
      // Magpie's page bridge permits one settings write per second.
      const delay = Math.max(0, 1100 - (Date.now() - lastWriteAt));
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      lastWriteAt = Date.now();
      await magpie.options.set(options);
      if (revision === savingRevision) { state.rules = rules; state.dirty = false; $('save-status').textContent = '已保存 · 后续请求生效'; }
      else { $('save-status').textContent = '保存完成，另有新的修改待保存'; }
      renderList();
    } catch (e) { error('保存失败：' + (e?.message || String(e))); $('save-status').textContent = '尚未保存，请重试'; }
    finally { state.saving = false; $('save').disabled = !state.dirty; }
  }
  $('search').addEventListener('input', renderList);
  function positionHint() { $('position-hint').textContent = $('position').value === 'prepend' ? '保留原有系统提示词，在头部加入这段内容。留空即不添加。' : '保留原有系统提示词，在末尾加入这段内容。留空即不添加。'; }
  $('position').addEventListener('change', () => { draft(); positionHint(); changed(); });
  $('refresh').addEventListener('click', refreshCatalog);
  $('save').addEventListener('click', save);
  $('enabled').addEventListener('change', () => { state.enabled = $('enabled').checked; changed(); });
  $('rule-enabled').addEventListener('change', () => { draft(); changed(); renderList(); });
  $('prompt').addEventListener('input', () => { draft(); $('length').textContent = Array.from($('prompt').value).length + ' 字'; changed(); renderList(); });
  document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (state.dirty) save(); } });
  async function init() {
    if (!window.magpie) { error('请从 Magpie 的“模型提示词”插件页面打开。'); return; }
    try {
      await magpie.ready;
      const options = await magpie.options.get();
      state.enabled = options.enabled !== false; $('enabled').checked = state.enabled;
      if (options.rules && typeof options.rules === 'object') for (const [id, rule] of Object.entries(options.rules)) {
        if (rule && typeof rule.prompt === 'string') state.rules[id] = { prompt: rule.prompt, enabled: rule.enabled !== false, position: rule.position === 'prepend' ? 'prepend' : 'append' };
      }
      state.ready = true; $('save-status').textContent = '粘贴提示词后，点击保存';
      applyCatalog(window.MODEL_PROMPT_CATALOG);
      if (!state.selected && allModels().length) select(allModels()[0].id);
      refreshCatalog(); setInterval(refreshCatalog, 5000);
    } catch (e) { error('连接 Magpie 失败：' + (e?.message || String(e))); }
  }
  init();
})();
