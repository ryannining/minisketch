// MiniSketch tool registry (loaded before every tool file and before app.js).
//
// A tool is one file in tools/ (built-in) or a dynamic extension installed
// from AI Extension Builder, local file, or Marketplace. It calls
// MiniSketchTools.register({...}):
//   id       unique key, also the gen.kind app.js stores on a generated group
//   label    button text in the Tools panel
//   title    button tooltip
//   modal    the dialog markup, injected into <body> once
//   guide    optional { en: {...}, id: {...} } of guide texts: every key maps
//            to the element in the modal carrying data-guide="key". File -> Lang
//            switches which language is painted into those placeholders.
//   open     fill the dialog (api, params from a re-edited group or null)
//   apply    run the generator (api)
//   wire     optional, run once at mount for dialog listeners beyond Create /
//            Cancel (e.g. a type select that shows and hides field groups)
//
// The dialog needs no extra wiring: its .btn.primary is "Create" and an
// element whose id ends in -cancel is "Cancel", which is exactly what app.js's
// generic modal keyboard handler already looks for (Enter / Escape).
window.MiniSketchTools = (() => {
  'use strict';

  const NS = {};
  NS.list = [];
  NS.api = null;
  NS.host = null;

  const LANG_KEY = 'minisketch.help.lang';
  const DISABLED_KEY = 'minisketch.v1.ext.disabled';
  const INSTALLED_KEY = 'minisketch.v1.ext.installed';

  // When a non-built-in extension throws at runtime (only surfaces with a real
  // selection), add a "Fix with AI" button to its modal. Clicking it switches
  // the AI Chat to Extension Builder mode and sends the error + the extension's
  // own source back to the model, so it can revise instead of the user having
  // to hand-copy the error. This mirrors the "Minta AI Perbaiki" path that
  // validation errors already have.
  function addFixWithAI(tool, err) {
    const modal = document.getElementById(tool.modalId);
    if (!modal) return;
    const actions = modal.querySelector('.modal-actions');
    if (!actions) return;
    if (actions.querySelector('.ext-fix-ai')) return;   // already added
    const chat = window.MiniSketchAI;
    if (!chat || typeof chat.send !== 'function') return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn small ext-fix-ai';
    btn.textContent = 'Fix with AI';
    btn.title = 'Send this runtime error and the extension code to the AI to fix';
    btn.addEventListener('click', () => {
      if (chat.activeAbort) return;
      // switch the chat to Extension Builder mode so the fix keeps the
      // register({...}) contract
      if (typeof chat.setBuilderMode === 'function') chat.setBuilderMode('ext');
      else chat.builderMode = 'ext';
      // send the error + extension code so the AI can revise in the chat.
      const code = tool.code || '';
      const prompt =
        'Ekstensi "' + (tool.label || tool.id) + '" melempar error saat dijalankan:\n' +
        String(err && err.message || err) + '\n\n' +
        (code ? 'Kode ekstensinya:\n```js\n' + code + '\n```\n\n' : '') +
        'Perbaiki error tersebut dan kirim ulang SATU blok kode ```js ... ``` yang lengkap dan valid untuk window.MiniSketchTools.register({...}).';
      if (chat.setTab) chat.setTab('chat');
      chat.send(prompt);
      NS.close(tool.id);
    });
    actions.appendChild(btn);
  }

  let disabledIds = new Set();
  let installedRecords = [];
  let captureFn = null;
  const listeners = new Set();

  const readLang = () => {
    try { return localStorage.getItem(LANG_KEY) === 'id' ? 'id' : 'en'; }
    catch (err) { return 'en'; }
  };
  NS.lang = readLang();

  function loadStorageState() {
    try {
      const rawDis = JSON.parse(localStorage.getItem(DISABLED_KEY) || '[]');
      disabledIds = new Set(Array.isArray(rawDis) ? rawDis.map(String) : []);
    } catch (err) { disabledIds = new Set(); }
    try {
      const rawInst = JSON.parse(localStorage.getItem(INSTALLED_KEY) || '[]');
      installedRecords = Array.isArray(rawInst) ? rawInst.filter(r => r && r.id && r.code) : [];
    } catch (err) { installedRecords = []; }
  }

  // ---- Extension code storage: IndexedDB primary, localStorage as boot cache ----
  // Extension code (especially AI/marketplace tools) can be large, and it shares
  // the ~5MB localStorage quota with the document. The canonical copy therefore
  // lives in IndexedDB; localStorage keeps a cache for a synchronous boot. When
  // the quota denies the localStorage write (QuotaExceededError), the IDB copy
  // is still safe and the next boot restores from it via refreshFromIdb().
  const EXT_IDB_NAME = 'minisketch-ext';
  const EXT_IDB_VER = 1;
  const EXT_IDB_STORE = 'installed';
  let _extIdb = null;
  function openExtIdb() {
    if (_extIdb) return Promise.resolve(_extIdb);
    return new Promise((resolve, reject) => {
      const rq = indexedDB.open(EXT_IDB_NAME, EXT_IDB_VER);
      rq.onupgradeneeded = () => {
        const db = rq.result;
        if (!db.objectStoreNames.contains(EXT_IDB_STORE)) db.createObjectStore(EXT_IDB_STORE, { keyPath: 'id' });
      };
      rq.onsuccess = () => { _extIdb = rq.result; resolve(_extIdb); };
      rq.onerror = () => reject(rq.error);
    });
  }
  async function extIdbReplaceAll(records) {
    try {
      const db = await openExtIdb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(EXT_IDB_STORE, 'readwrite');
        const st = tx.objectStore(EXT_IDB_STORE);
        st.clear();
        for (const r of records) st.put(r);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      return true;
    } catch (err) {
      return false;
    }
  }
  async function extIdbGetAll() {
    try {
      const db = await openExtIdb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(EXT_IDB_STORE, 'readonly');
        const rq = tx.objectStore(EXT_IDB_STORE).getAll();
        rq.onsuccess = () => resolve(rq.result || []);
        rq.onerror = () => reject(rq.error);
      });
    } catch (err) {
      return [];
    }
  }

  function saveDisabled() {
    try { localStorage.setItem(DISABLED_KEY, JSON.stringify([...disabledIds])); }
    catch (err) { /* private mode / quota */ }
  }

  function saveInstalled() {
    const next = JSON.stringify(installedRecords);
    try { localStorage.setItem(INSTALLED_KEY, next); } catch (err) {
      // quota hit: the cache is dropped; the IDB canonical copy still holds it
      try { localStorage.removeItem(INSTALLED_KEY); } catch (e2) {}
    }
    extIdbReplaceAll(installedRecords);
  }

  function notifyChange() {
    for (const fn of listeners) {
      try { fn(NS.getCatalogState()); } catch (err) { /* ignore listener errors */ }
    }
  }

  NS.onChange = (fn) => {
    if (typeof fn === 'function') listeners.add(fn);
    return () => listeners.delete(fn);
  };

  const modalOf = (tool) => (tool && tool.modalId) ? document.getElementById(tool.modalId) : null;

  // ---- Automatic modal-value persistence ----------------------------------
  // Extension modal inputs are saved automatically after a successful apply()
  // and restored when the tool is opened again from the toolbar, so the AI
  // does NOT need to write any localStorage save/restore code. Reopen with
  // explicit params (double-clicked generated group, gen.params) always wins
  // over the saved values.
  const PARAM_KEY_PREFIX = 'minisketch.tools.params.';

  function collectToolParams(tool) {
    const modal = modalOf(tool);
    if (!modal) return null;
    const out = {};
    let found = false;
    modal.querySelectorAll('input, select, textarea').forEach(el => {
      if (!el.id) return;
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'radio') return;               // radio groups are not portable
      if (type === 'checkbox') {
        out[el.id] = { k: 'b', v: !!el.checked };
      } else {
        out[el.id] = { k: 'v', v: el.value };
      }
      found = true;
    });
    return found ? out : null;
  }

  function saveToolParams(tool) {
    const collected = collectToolParams(tool);
    if (!collected) return;
    try { localStorage.setItem(PARAM_KEY_PREFIX + tool.id, JSON.stringify(collected)); } catch (e) { /* private mode */ }
  }

  function restoreToolParams(tool) {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(PARAM_KEY_PREFIX + tool.id) || 'null'); } catch (e) {}
    if (!raw || typeof raw !== 'object') return;
    const modal = modalOf(tool);
    if (!modal) return;
    for (const id of Object.keys(raw)) {
      const rec = raw[id];
      if (!rec || typeof rec !== 'object') continue;
      let el = null;
      try { el = modal.querySelector('[id="' + String(id).replace(/"/g, '\\"') + '"]'); } catch (e) {}
      if (!el) continue;
      if (rec.k === 'b') {
        el.checked = !!rec.v;
      } else {
        const val = String(rec.v == null ? '' : rec.v);
        if (el.tagName === 'SELECT') {
          if (Array.from(el.options).some(o => o.value === val)) el.value = val;
        } else {
          el.value = val;
        }
      }
    }
  }

  function applyToolLang(tool) {
    const modal = modalOf(tool);
    if (!modal || !tool.guide) return;
    const g = tool.guide[NS.lang] || tool.guide.en;
    if (!g) return;
    for (const k of Object.keys(g)) {
      const el = modal.querySelector('[data-guide="' + k + '"]');
      if (el) el.innerHTML = g[k];
    }
  }

  NS.setLang = (lang) => {
    NS.lang = lang === 'id' ? 'id' : 'en';
    try { localStorage.setItem(LANG_KEY, NS.lang); } catch (err) { /* private mode */ }
    for (const tool of NS.list) applyToolLang(tool);
  };

  NS.isEnabled = (id) => !disabledIds.has(String(id));

  function mountToolModalAndWire(tool) {
    if (!tool) return;
    if (tool.modalId) {
      const existing = document.getElementById(tool.modalId);
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    }
    if (tool.modal) {
      const holder = document.createElement('div');
      holder.innerHTML = tool.modal.trim();
      while (holder.firstChild) document.body.appendChild(holder.firstChild);
    }
      const modal = modalOf(tool);
      if (modal) {
        applyToolLang(tool);
        const ok = modal.querySelector('.modal-actions .btn.primary');
        if (ok) ok.addEventListener('click', () => {
          if (tool.builtIn) {
            tool.apply(NS.api);
            return;
          }
          try {
            tool.apply(NS.api);
            saveToolParams(tool); // auto-persist modal values after a successful apply
          } catch (err) {
            console.warn('[minisketch] Extension apply error (' + tool.id + '):', err);
            if (NS.api && NS.api.toast) {
              NS.api.toast((tool.label || tool.id) + ' error: ' + String(err && err.message || err));
            }
            // Runtime errors (only appear with a real selection) get a path
            // back to the AI, same as validation errors have "Minta AI
            // Perbaiki": without this the user just saw a dead-end toast.
            addFixWithAI(tool, err);
          }
        });
        const cancel = modal.querySelector('[id$="-cancel"]');
        if (cancel) cancel.addEventListener('click', () => NS.close(tool.id));
      }
    if (tool.wire && NS.api) {
      if (tool.builtIn) tool.wire(NS.api);
      else {
        try { tool.wire(NS.api); } catch (err) {
          console.warn('[minisketch] Extension wire error (' + tool.id + '):', err);
        }
      }
    }
    tool._mounted = true;
  }

  const DEFAULT_EXT_ICON = '<svg class="ext-btn-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M3 4.5h3.2a1.6 1.6 0 1 1 3.2 0H12.5v3.2a1.6 1.6 0 1 1 0 3.2V13.5H3V4.5z"/></svg>';

  function sanitizeIconSvg(raw) {
    const s = String(raw || '').trim();
    const m = s.match(/<svg\b[^>]*>[\s\S]*?<\/svg>/i);
    if (!m) return DEFAULT_EXT_ICON;
    let svg = m[0];
    if (/<\s*(script|foreignObject|iframe|object|embed|style)\b/i.test(svg)) return DEFAULT_EXT_ICON;
    if (/\bon[a-z]+\s*=/i.test(svg) || /javascript:/i.test(svg) || /data:text\/html/i.test(svg)) return DEFAULT_EXT_ICON;
    svg = svg.replace(/^<svg\b/i, (head) => {
      let h = head;
      if (!/\baria-hidden\s*=/.test(h)) h += ' aria-hidden="true"';
      if (!/\bclass\s*=/.test(h)) h += ' class="ext-btn-icon"';
      return h;
    });
    return svg;
  }
  NS.sanitizeIconSvg = sanitizeIconSvg;

  function renderToolButton(btn, tool) {
    btn.className = 'btn small ext-tool-btn';
    btn.innerHTML = '';
    const ic = document.createElement('span');
    ic.className = 'ext-btn-ic';
    ic.innerHTML = sanitizeIconSvg(tool.icon);
    const lbl = document.createElement('span');
    lbl.className = 'ext-btn-lbl';
    lbl.textContent = tool.label || tool.id;
    const ver = document.createElement('span');
    ver.className = 'ext-btn-ver';
    ver.textContent = 'v' + (tool.version || '1.0.0');
    btn.appendChild(ic);
    btn.appendChild(lbl);
    btn.appendChild(ver);
    btn.title = (tool.title ? tool.title + ' · ' : '') + 'v' + (tool.version || '1.0.0');
  }

  function syncToolsRow() {
    const host = NS.host;
    if (!host) return;
    let enabledCount = 0;
    for (const tool of NS.list) {
      const btnId = 'btn-' + tool.id;
      const oldBtn = document.getElementById(btnId);
      const enabled = NS.isEnabled(tool.id);
      if (!enabled) {
        if (oldBtn && oldBtn.parentNode) oldBtn.parentNode.removeChild(oldBtn);
        continue;
      }
      enabledCount++;
      if (!oldBtn) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = btnId;
        renderToolButton(btn, tool);
        btn.addEventListener('click', () => NS.open(tool.id));
        host.appendChild(btn);
      } else {
        renderToolButton(oldBtn, tool);
      }
    }
    const cnt = document.getElementById('ext-panel-count');
    if (cnt) cnt.textContent = String(enabledCount);
  }

  NS.register = (tool) => {
    if (!tool || !tool.id || !tool.apply) return;
    if (captureFn) {
      captureFn(tool);
      return;
    }
    if (NS.list.some(t => t.id === tool.id)) return;
    tool.builtIn = tool.builtIn !== false;
    tool.source = tool.source || 'builtin';
    tool.version = tool.version || '1.0.0';
    tool.author = tool.author || 'MiniSketch';
    tool.category = tool.category || 'Built-in';
    tool.icon = tool.icon || '';
    NS.list.push(tool);
  };

  NS.validateExtensionCode = (code) => {
    const src = String(code == null ? '' : code);
    const errors = [];
    const warnings = [];
    const extracted = {
      id: '',
      label: '',
      title: '',
      modalId: '',
      version: '1.0.0',
      author: 'AI / Community',
      category: 'CNC Utility',
      description: '',
      icon: ''
    };

    if (!src.trim()) {
      errors.push('Extension code is empty.');
      return { ok: false, errors, warnings, extracted };
    }
    if (src.length > 200 * 1024) {
      errors.push('Extension code exceeds 200 KB limit.');
    }

    let syntaxOk = false;
    try {
      // Parse-only syntax check (never executes the body).
      new Function(src);
      syntaxOk = true;
    } catch (err) {
      errors.push('JavaScript syntax error: ' + String(err && err.message || err));
    }

    const hasRegisterCall =
      /(?:MiniSketchTools|NS)\s*\.\s*register\s*\(/.test(src) ||
      (/\bMiniSketchTools\b/.test(src) && /\.register\s*\(/.test(src));
    if (!hasRegisterCall) {
      errors.push('Missing MiniSketchTools.register({...}) call.');
    }

    // Stage 2: Static constant/shorthand/literal extraction (fallback if runtime capture throws)
    const constVars = new Map();
    for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])((?:\\[\s\S]|(?!\2)[^\\])*)\2/g)) {
      if (!constVars.has(m[1])) constVars.set(m[1], m[3]);
    }
    const pickStr = (key) => {
      const litRe = new RegExp('(?:^|[{,\\s])[\'"]?' + key + '[\'"]?\\s*:\\s*([\'`"])((?:\\\\[\\s\\S]|(?!\\1)[^\\\\])*)\\1');
      const mLit = src.match(litRe);
      if (mLit) return mLit[2].trim();
      const idRe = new RegExp('(?:^|[{,\\s])[\'"]?' + key + '[\'"]?\\s*:\\s*([A-Za-z_$][\\w$]*)\\b');
      const mId = src.match(idRe);
      if (mId && constVars.has(mId[1])) return String(constVars.get(mId[1])).trim();
      const shortRe = new RegExp('(?:^|[{,\\n])\\s*' + key + '\\s*(?=[,}\\n])');
      if (shortRe.test(src) && constVars.has(key)) return String(constVars.get(key)).trim();
      return '';
    };

    extracted.id = pickStr('id').toLowerCase();
    extracted.label = pickStr('label') || extracted.id;
    extracted.title = pickStr('title');
    extracted.modalId = pickStr('modalId');
    extracted.version = pickStr('version') || '1.0.0';
    extracted.author = pickStr('author') || 'AI / Community';
    extracted.category = pickStr('category') || 'CNC Utility';
    extracted.description = pickStr('description') || extracted.title;
    extracted.icon = pickStr('icon');
    let modalMarkup = pickStr('modal');
    let capturedApply = false;

    // Stage 3: Safe capture of MiniSketchTools.register({...}) object when syntax is valid
    if (syntaxOk && hasRegisterCall) {
      try {
        const reg = runExtensionCode(src);
        if (reg && typeof reg === 'object') {
          if (typeof reg.id === 'string' && reg.id.trim()) extracted.id = reg.id.trim().toLowerCase();
          if (typeof reg.label === 'string' && reg.label.trim()) extracted.label = reg.label.trim();
          else if (!extracted.label && extracted.id) extracted.label = extracted.id;
          if (typeof reg.title === 'string' && reg.title.trim()) extracted.title = reg.title.trim();
          if (typeof reg.modalId === 'string' && reg.modalId.trim()) extracted.modalId = reg.modalId.trim();
          if (typeof reg.version === 'string' && reg.version.trim()) extracted.version = reg.version.trim();
          if (typeof reg.author === 'string' && reg.author.trim()) extracted.author = reg.author.trim();
          if (typeof reg.category === 'string' && reg.category.trim()) extracted.category = reg.category.trim();
          if (typeof reg.description === 'string' && reg.description.trim()) extracted.description = reg.description.trim();
          else if (!extracted.description && extracted.title) extracted.description = extracted.title;
          if (typeof reg.icon === 'string' && reg.icon.trim()) extracted.icon = reg.icon.trim();
          if (typeof reg.modal === 'string' && reg.modal.trim()) modalMarkup = reg.modal;
          if (typeof reg.apply === 'function') capturedApply = true;
        }
      } catch (err) {
        /* keep static extraction if top-level execution hits missing runtime context */
      }
    }

    if (extracted.icon) {
      if (!/<svg\b[^>]*>[\s\S]*?<\/svg>/i.test(extracted.icon)) {
        warnings.push('icon property is not a valid <svg>...</svg> string (default icon will be used).');
      } else if (/<\s*(script|foreignObject|iframe|object|embed|style)\b|\bon[a-z]+\s*=|javascript:/i.test(extracted.icon)) {
        errors.push('icon SVG must not contain <script> or inline event attributes.');
      }
    } else {
      warnings.push('No SVG icon property provided (default icon will be used).');
    }

    if (!extracted.id) {
      errors.push('Missing string property id in MiniSketchTools.register({...}).');
    } else if (!/^[a-z][a-z0-9-]{1,39}$/.test(extracted.id)) {
      errors.push('id "' + extracted.id + '" must be 2-40 lowercase letters, digits, or hyphens.');
    }
    if (!capturedApply && !/\bapply\s*\(\s*api\s*\)|\bapply\s*:/.test(src)) {
      errors.push('Missing apply(api) handler in register({...}).');
    }

    // Check modal DOM IDs against el('...') / document.getElementById('...')
    if (extracted.modalId && !modalMarkup) {
      warnings.push('modalId is declared without a modal HTML string.');
    }
    if (modalMarkup) {
      const markupIds = new Set([...modalMarkup.matchAll(/\bid=["']([^"']+)["']/g)].map(m => m[1]));
      const readIds = new Set();
      for (const m of src.matchAll(/document\.getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) readIds.add(m[1]);
      for (const m of src.matchAll(/\bel\(\s*['"]([^'"]+)['"]\s*\)/g)) readIds.add(m[1]);
      const missingIds = [...readIds].filter(id => !markupIds.has(id));
      if (missingIds.length) {
        errors.push('Modal markup is missing element IDs read by code: ' + missingIds.join(', '));
      }
      if (extracted.modalId && !markupIds.has(extracted.modalId)) {
        errors.push('Modal markup root does not carry id="' + extracted.modalId + '".');
      }
    }

    if (/[^.\w]state\.(entities|points|constraints|layers|mates)\b/.test(src)) {
      errors.push('Direct bare `state.` access found — must use `api.state.` instead.');
    }

    const pushCount = (src.match(/\bapi\.pushHistory\s*\(/g) || []).length;
    if (pushCount === 0) warnings.push('No api.pushHistory() call detected (geometry edits will not create an Undo step).');
    else if (pushCount > 1) warnings.push('Multiple api.pushHistory() calls detected (prefer exactly one per apply).');

    if (!/\bcmdGroupSelection\s*\(/.test(src)) {
      warnings.push('No api.cmdGroupSelection({ noHistory: true }) detected — output will stay ungrouped.');
    }
    if (!/\bwrap\.name\s*=/.test(src)) {
      warnings.push('No wrap.name assignment detected.');
    }

    return {
      ok: errors.length === 0,
      errors,
      warnings,
      extracted
    };
  };

  function runExtensionCode(code) {
    let registered = null;
    const prevCapture = captureFn;
    captureFn = (tool) => { registered = tool; };
    try {
      const fn = new Function(String(code));
      fn();
    } finally {
      captureFn = prevCapture;
    }
    return registered;
  }

  NS.installExtension = (meta, code, opts) => {
    const o = opts || {};
    const v = NS.validateExtensionCode(code);
    if (!v.ok) {
      return { ok: false, error: v.errors[0], errors: v.errors, warnings: v.warnings };
    }
    let tool = null;
    try {
      tool = runExtensionCode(code);
    } catch (err) {
      return { ok: false, error: 'Runtime error while registering extension: ' + String(err && err.message || err) };
    }
    if (!tool || !tool.id || typeof tool.apply !== 'function') {
      return { ok: false, error: 'Extension did not call MiniSketchTools.register({ id, apply, ... }).' };
    }

    const existing = NS.list.find(t => t.id === tool.id);
    if (existing && existing.builtIn) {
      return { ok: false, error: 'Cannot overwrite built-in tool "' + tool.id + '". Use a different extension ID.' };
    }

    // Clean up prior DOM for this ID if replacing/updating
    if (existing) {
      NS.close(existing.id);
      const oldModal = modalOf(existing);
      if (oldModal && oldModal.parentNode) oldModal.parentNode.removeChild(oldModal);
      const oldBtn = document.getElementById('btn-' + existing.id);
      if (oldBtn && oldBtn.parentNode) oldBtn.parentNode.removeChild(oldBtn);
    }

    const m = meta || {};
    const recPrev = installedRecords.find(r => r.id === tool.id);
    tool.builtIn = false;
    tool.preview = !!o.preview;
    tool.source = o.preview ? 'preview' : (m.source || tool.source || (recPrev && recPrev.source) || 'local');
    tool.sourceUrl = m.sourceUrl !== undefined ? String(m.sourceUrl || '') : ((recPrev && recPrev.sourceUrl) || (existing && existing.sourceUrl) || '');
    tool.catalogUrl = m.catalogUrl !== undefined ? String(m.catalogUrl || '') : ((recPrev && recPrev.catalogUrl) || (existing && existing.catalogUrl) || '');
    tool.version = m.version || tool.version || v.extracted.version || '1.0.0';
    tool.author = m.author || tool.author || v.extracted.author || 'Community';
    tool.category = m.category || tool.category || v.extracted.category || 'CNC Utility';
    tool.description = m.description || tool.description || tool.title || v.extracted.description || '';
    tool.label = m.label || tool.label || tool.id;
    tool.icon = m.icon || tool.icon || v.extracted.icon || '';
    tool.code = String(code);

    const idx = NS.list.findIndex(t => t.id === tool.id);
    if (idx >= 0) NS.list[idx] = tool;
    else NS.list.push(tool);

    if (!o.preview) {
      disabledIds.delete(tool.id);
      saveDisabled();
      const now = new Date().toISOString();
      const recIdx = installedRecords.findIndex(r => r.id === tool.id);
      const record = {
        id: tool.id,
        name: m.name || tool.label || tool.id,
        label: tool.label,
        title: tool.title || '',
        version: tool.version,
        author: tool.author,
        category: tool.category,
        description: tool.description,
        icon: tool.icon,
        source: tool.source,
        sourceUrl: tool.sourceUrl,
        catalogUrl: tool.catalogUrl,
        code: String(code),
        installedAt: recIdx >= 0 ? installedRecords[recIdx].installedAt : now,
        updatedAt: now
      };
      if (recIdx >= 0) installedRecords[recIdx] = record;
      else installedRecords.push(record);
      saveInstalled();
      if (!o.silentSync && window.MiniSketchCloud && window.MiniSketchCloud.onExtensionSaved) {
        window.MiniSketchCloud.onExtensionSaved(record);
      }
    }

    if (NS.api) {
      mountToolModalAndWire(tool);
      syncToolsRow();
    }
    notifyChange();
    return { ok: true, tool, warnings: v.warnings };
  };

  NS.setEnabled = (id, enabled) => {
    const key = String(id || '');
    const tool = NS.list.find(t => t.id === key);
    if (!tool) return false;
    if (enabled) disabledIds.delete(key);
    else {
      NS.close(key);
      disabledIds.add(key);
    }
    saveDisabled();
    syncToolsRow();
    notifyChange();
    if (window.MiniSketchCloud && window.MiniSketchCloud.onDisabledExtensionsChanged) {
      window.MiniSketchCloud.onDisabledExtensionsChanged();
    }
    return true;
  };

  NS.uninstallExtension = (id) => {
    const key = String(id || '');
    const idx = NS.list.findIndex(t => t.id === key);
    if (idx < 0) return { ok: false, error: 'Extension not found.' };
    const tool = NS.list[idx];
    if (tool.builtIn) return { ok: false, error: 'Built-in tools cannot be uninstalled (disable instead).' };
    NS.close(key);
    const modal = modalOf(tool);
    if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
    const btn = document.getElementById('btn-' + key);
    if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
    NS.list.splice(idx, 1);
    disabledIds.delete(key);
    saveDisabled();
    installedRecords = installedRecords.filter(r => r.id !== key);
    saveInstalled();
    notifyChange();
    if (window.MiniSketchCloud && window.MiniSketchCloud.onExtensionDeleted) {
      window.MiniSketchCloud.onExtensionDeleted(key);
    }
    return { ok: true };
  };

  NS.exportExtensions = () => installedRecords.map(r => Object.assign({}, r));

  NS.setDisabledList = (ids) => {
    disabledIds = new Set(Array.isArray(ids) ? ids.map(String) : []);
    saveDisabled();
    syncToolsRow();
    notifyChange();
  };

  NS.replaceSyncedExtensions = (records, opts) => {
    const o = opts || {};
    const incoming = Array.isArray(records) ? records.filter(r => r && r.id && r.code) : [];
    const incomingIds = new Set(incoming.map(r => String(r.id).toLowerCase()));
    if (o.pruneMissing) {
      for (const cur of [...installedRecords]) {
        if (!incomingIds.has(cur.id)) {
          const tool = NS.list.find(t => t.id === cur.id);
          if (tool && !tool.builtIn) {
            NS.close(cur.id);
            const m = modalOf(tool);
            if (m && m.parentNode) m.parentNode.removeChild(m);
            const b = document.getElementById('btn-' + cur.id);
            if (b && b.parentNode) b.parentNode.removeChild(b);
            NS.list = NS.list.filter(t => t.id !== cur.id);
          }
          installedRecords = installedRecords.filter(r => r.id !== cur.id);
        }
      }
      saveInstalled();
    }
    for (const r of incoming) {
      NS.installExtension({
        id: r.id,
        name: r.name || r.label || r.id,
        label: r.label || r.name || r.id,
        title: r.title || '',
        version: r.version || '1.0.0',
        author: r.author || 'Community',
        category: r.category || 'CNC Utility',
        description: r.description || '',
        icon: r.icon || '',
        source: r.source || 'local',
        sourceUrl: r.sourceUrl || '',
        catalogUrl: r.catalogUrl || ''
      }, r.code, { silentSync: true });
    }
    syncToolsRow();
    notifyChange();
  };

  NS.getCatalogState = () => {
    const recMap = new Map(installedRecords.map(r => [r.id, r]));
    return NS.list.map(t => {
      const rec = recMap.get(t.id);
      return {
        id: t.id,
        name: (rec && rec.name) || t.label || t.id,
        label: t.label || t.id,
        title: t.title || '',
        description: (rec && rec.description) || t.description || t.title || '',
        icon: sanitizeIconSvg((rec && rec.icon) || t.icon || ''),
        rawIcon: (rec && rec.icon) || t.icon || '',
        version: (rec && rec.version) || t.version || '1.0.0',
        author: (rec && rec.author) || t.author || (t.builtIn ? 'MiniSketch' : 'Community'),
        category: (rec && rec.category) || t.category || (t.builtIn ? 'Built-in' : 'CNC Utility'),
        source: t.builtIn ? 'builtin' : (t.source || 'local'),
        sourceUrl: (rec && rec.sourceUrl) || t.sourceUrl || '',
        catalogUrl: (rec && rec.catalogUrl) || t.catalogUrl || '',
        updatedAt: (rec && rec.updatedAt) || '',
        builtIn: !!t.builtIn,
        preview: !!t.preview,
        enabled: NS.isEnabled(t.id),
        code: (rec && rec.code) || t.code || ''
      };
    });
  };

  // Mount one stored extension record into the tool list (skips duplicates and
  // broken records; keeps the app bootable).
  function mountRecord(rec) {
    if (!rec || !rec.id || !rec.code) return false;
    if (NS.list.some(t => t.id === rec.id)) return false;
    try {
      const tool = runExtensionCode(rec.code);
      if (tool && tool.id && typeof tool.apply === 'function') {
        tool.builtIn = false;
        tool.preview = false;
        tool.source = rec.source || 'local';
        tool.sourceUrl = rec.sourceUrl || '';
        tool.catalogUrl = rec.catalogUrl || '';
        tool.version = rec.version || tool.version || '1.0.0';
        tool.author = rec.author || tool.author || 'Community';
        tool.category = rec.category || tool.category || 'CNC Utility';
        tool.description = rec.description || tool.description || tool.title || '';
        tool.label = rec.label || tool.label || tool.id;
        tool.icon = rec.icon || tool.icon || '';
        tool.code = rec.code;
        NS.list.push(tool);
        return true;
      }
    } catch (err) {
      /* keep broken saved record harmless so the app still boots */
    }
    return false;
  }

  // When localStorage holds no extension cache (quota kept it from being
  // written, or storage was cleared), restore the canonical copies from
  // IndexedDB as soon as it resolves and re-populate the tool row.
  function refreshFromIdb() {
    let haveLs = false;
    try { haveLs = !!(localStorage.getItem(INSTALLED_KEY)); } catch (err) { haveLs = false; }
    if (haveLs) return Promise.resolve();
    return extIdbGetAll().then((records) => {
      const fresh = records.filter(r => r && r.id && r.code);
      if (!fresh.length || fresh.length === installedRecords.length) return;
      installedRecords = fresh;
      let mounted = 0;
      for (const rec of fresh) if (mountRecord(rec)) mounted++;
      for (const tool of NS.list) {
        if (!tool._mounted) mountToolModalAndWire(tool);
      }
      if (mounted) { syncToolsRow(); notifyChange(); }
    }).catch(() => {});
  }

  // Called once by app.js init(): loads saved extensions, injects modals, and
  // populates enabled tool buttons into #tools-row.
  NS.mount = (api, host) => {
    NS.api = api;
    NS.host = host;
    loadStorageState();

    // Load persisted user/AI/marketplace extensions before mounting UI
    for (const rec of installedRecords) mountRecord(rec);

    for (const tool of NS.list) {
      if (!tool._mounted) mountToolModalAndWire(tool);
    }
    syncToolsRow();
    notifyChange();
    // Async fallback when the localStorage cache is missing (quota was hit)
    refreshFromIdb();
  };

  NS.open = (id, params) => {
    const tool = NS.list.find(t => t.id === id);
    if (!tool || !NS.api) return false;
    const modal = modalOf(tool);
    if (modal) modal.classList.remove('hidden');
    if (typeof tool.open === 'function') {
      if (tool.builtIn) tool.open(NS.api, params || null);
      else {
        try { tool.open(NS.api, params || null); } catch (err) {
          console.warn('[minisketch] Extension open error (' + tool.id + '):', err);
          if (NS.api && NS.api.toast) NS.api.toast((tool.label || tool.id) + ' open error: ' + String(err && err.message || err));
        }
      }
    }
    // Fresh toolbar opens (no explicit params) recall the last-used values;
    // reopening a generated group with gen.params keeps those params instead.
    if (!tool.builtIn && !params) restoreToolParams(tool);
    return true;
  };

  NS.close = (id) => {
    const tool = NS.list.find(t => t.id === id);
    const modal = tool && modalOf(tool);
    if (modal) modal.classList.add('hidden');
  };

  // Double clicking a generated group: app.js hands over its saved gen.
  NS.reopen = (gen) => {
    if (!gen || !gen.kind) return false;
    const tool = NS.list.find(t => t.id === gen.kind);
    if (!tool) {
      if (NS.api && NS.api.toast) {
        NS.api.toast('Tool "' + gen.kind + '" is not installed — open Extensions & Marketplace to install it');
      }
      return false;
    }
    if (!NS.isEnabled(tool.id)) {
      if (NS.api && NS.api.toast) {
        NS.api.toast('Tool "' + (tool.label || tool.id) + '" is disabled — enable it in Extensions');
      }
      return false;
    }
    NS.open(tool.id, gen.params || {});
    return true;
  };

  return NS;
})();
