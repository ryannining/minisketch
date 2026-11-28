// MiniSketch AI chat tab: natural-language modeling on the worksheet.
//
// Design notes (ARCHITECTURE.md):
// - No build step, no modules: this file registers window.MiniSketchAI and the
//   app.js hook `mountAiChat(api)` wires the panel created in index.html.
// - Coordinates are world mm, Y-down (+Y is down, the SVG/CNC convention). The
//   bridge clamps to +/-10000 too.
// - One chat turn = ONE undo step: the executor calls pushHistory() once,
//   runs every op, then commit() (which does updateUI + render).
// - Destructive ops (remove_entity, delete_selection) ask confirm() first.
// - Offline fallback: when no bridge URL is set, a small Indonesian/English
//   pattern parser handles the common shapes directly, no LLM needed.

(() => {
  'use strict';

  const NS = window.MiniSketchAI = window.MiniSketchAI || {};
  NS.log = [];
  NS.mode = 'chat';
  let api = null;

  const BUILDER_MODE_KEY = 'minisketch.chat.builderMode';
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (err) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (err) { /* private mode */ } };
  const lsDel = (k) => { try { localStorage.removeItem(k); } catch (err) { /* ignore */ } };

  function curLang() {
    try {
      if (window.MiniSketchI18n && typeof window.MiniSketchI18n.getLang === 'function') {
        return window.MiniSketchI18n.getLang() === 'id' ? 'id' : 'en';
      }
      const saved = lsGet('minisketch.help.lang');
      if (saved === 'id' || saved === 'en') return saved;
    } catch (err) { /* ignore */ }
    return 'en';
  }
  function tr(key, fallback, vars) {
    let out;
    try {
      if (window.MiniSketchI18n && typeof window.MiniSketchI18n.t === 'function') {
        out = window.MiniSketchI18n.t(key, fallback, vars);
      } else {
        out = fallback != null ? fallback : key;
        if (vars && typeof out === 'string') {
          out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
        }
      }
    } catch (err) {
      out = fallback != null ? fallback : key;
    }
    return out;
  }

  // Mode default = 'svg' (vector output) or 'ext' (AI Extension Builder).
  // Saved in localStorage so mode persists across browser restarts.
  NS.builderMode = lsGet(BUILDER_MODE_KEY) === 'ext' ? 'ext' : 'svg';
  NS.svgMode = () => NS.builderMode !== 'ext';

  function isLocalApiUrl(base) {
    try {
      const h = new URL(String(base || '')).hostname.toLowerCase();
      return h === 'localhost' || h === '127.0.0.1' || h === '::1' ||
        /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h);
    } catch (err) { return false; }
  }

  // List models from active provider (Gemini: ListModels; OpenAI-compatible: GET {base}/models).
  async function fetchProviderModels() {
    if (!api) return null;
    const ep = bridgeUrl();
    if (!ep) return null;
    const g = !!(api.settings && api.settings.aiProviderGoogle);
    const base = g
      ? 'https://generativelanguage.googleapis.com/v1beta'
      : String((api.settings && api.settings.aiApiUrl) || '').trim();
    const key = String((api.settings && api.settings.aiApiKey) || '').trim();
    if (!base || (!key && !isLocalApiUrl(base))) return null;
    try {
      const r = await fetch(ep + '/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { baseUrl: base, apiKey: key } })
      });
      const j = await r.json().catch(() => ({}));
      return (Array.isArray(j.models) && j.models.length) ? j.models : null;
    } catch (err) {
      return null;
    }
  }

  // Panel title shows the provider/model in use ("AI Chat · Google gemini-…").
  // Called from mount() and from app.js applySettings() after Settings Apply.
  NS.updateTitle = () => {
    const titleEl = document.querySelector('#chat-panel .panel-title');
    if (!titleEl) return;
    const label = tr('chat.panelLabel', 'AI Chat');
    const model = String((api && api.settings && api.settings.aiModel) || '').trim();
    const google = !!(api && api.settings && api.settings.aiProviderGoogle);
    const full = model
      ? label + ' · ' + (google ? 'Google ' : '') + model
      : label;
    const count = titleEl.querySelector('.count');
    titleEl.textContent = '';
    titleEl.appendChild(document.createTextNode(full + ' '));
    if (count) titleEl.appendChild(count);
  };

  // App-specific USER-FACING strings live in ai/ui-strings.js (window.MiniSketchAIStrings).
  const STR_DEFAULTS = {
    en: {
      offlineNoEndpoint: 'No bridge connected: run "node server/serve.js" and open http://127.0.0.1:8090 (or set AI bridge URL in Settings). Offline basic commands still work: "100x60 box", "circle d50", "move 10,0", "delete".',
      errorPrefix: 'Bridge error: ',
      errorHint: '. Check server/ai-bridge.js + settings.'
    },
    id: {
      offlineNoEndpoint: 'Tidak ada bridge: jalankan "node server/serve.js" lalu buka http://127.0.0.1:8090 (atau isi AI bridge URL di Pengaturan). Offline, perintah sederhana tetap jalan: "kotak 100x60", "lingkaran d50", "pindah 10,0", "hapus".',
      errorPrefix: 'Bridge error: ',
      errorHint: '. Cek server/ai-bridge.js + pengaturan.'
    }
  };
  function strVal(key) {
    const lang = curLang();
    const ext = window.MiniSketchAIStrings || {};
    if (ext[lang] && typeof ext[lang][key] === 'string') return ext[lang][key];
    if (typeof ext[key] === 'string' && lang === 'en') return ext[key];
    return (STR_DEFAULTS[lang] && STR_DEFAULTS[lang][key]) || STR_DEFAULTS.en[key] || '';
  }

  // Policy lives on the FRONTEND (ai/prompt.js): system prompt, tool manifest and
  // skills are static files fetched at send-time, so tuning them never needs a
  // rebuild and the SAME chat works against the Node proxy OR the KaryaCNC Go
  // proxy (both are policy-free streams now).
  const P = window.MiniSketchAIPrompt || null;
  const ensurePolicy = () => (P && P.ready ? P.ready() : Promise.resolve());

  const HEX_RE = /^#(?:[0-9a-f]{6})$/i;
  // KaryaCNC convention (user's machine): red is a LOW-POWER MARKING line, not
  // a drill/cut color. Through-cut is black; a drilled hole is a black circle.
  const COLOR_NAMES = {
    black: '#000000', cut: '#000000', potong: '#000000',
    blue: '#0000ff', engrave: '#0000ff',
    cyan: '#00ffff', vcarve: '#00ffff', 'v-carve': '#00ffff',
    purple: '#800080', pocket: '#800080', ungu: '#800080',
    red: '#ff0000', marking: '#ff0000', mark: '#ff0000', score: '#ff0000',
    green: '#00ff00', construction: '#00ff00', konstruksi: '#00ff00',
    maroon: '#800000', tab: '#800000',
    teal: '#008080', start: '#008080'
  };

  const normColor = (c) => {
    if (!c) return null;
    const s = String(c).trim().toLowerCase();
    if (HEX_RE.test(s)) return s;
    return COLOR_NAMES[s] || null;
  };

  function clampN(v) {
    const n = +v;
    if (!isFinite(n)) return 0;
    return Math.max(-10000, Math.min(10000, n));
  }

  const clampPt = (p) => ({ x: clampN(p && p.x), y: clampN(p && p.y) });

  // ---- image attachments (vision) -----------------------------------------
  // A user can attach/paste/drop an image ("bikin sketch sesuai gambar ini").
  // The image rides along as an OpenAI-style multimodal content part:
  //   content: [{type:'text', text}, {type:'image_url', image_url:{url:dataURL}}]
  // Only two backends see it — the proxy forwards `messages` verbatim, so the
  // provider must be vision-capable for images to actually be understood.
  const IMG_MAX_DIM = 1024;   // downscale the long edge: huge photos waste tokens
  const IMG_MAX_BYTES = 4 * 1024 * 1024;
  NS.pendingImages = [];      // dataURLs staged for the NEXT send

  function isImageFile(f) {
    return f && typeof f.type === 'string' && f.type.startsWith('image/');
  }

  // Read a File/Blob into a downscaled JPEG/PNG data URL. Keeps screenshots and
  // phone photos small enough to be cheap, without touching line-art fidelity.
  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('failed to read file'));
      reader.onload = () => {
        const src = String(reader.result || '');
        const img = new Image();
        img.onerror = () => resolve(src);   // not decodable: send as-is
        img.onload = () => {
          try {
            const scale = Math.min(1, IMG_MAX_DIM / Math.max(img.width, img.height));
            if (scale >= 1 && src.length < IMG_MAX_BYTES) { resolve(src); return; }
            const w = Math.max(1, Math.round(img.width * scale));
            const h = Math.max(1, Math.round(img.height * scale));
            const cv = document.createElement('canvas');
            cv.width = w; cv.height = h;
            const ctx = cv.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            // PNG for line-art (crisp), else JPEG to shrink photos
            const keepPng = /^data:image\/png/.test(src);
            resolve(cv.toDataURL(keepPng ? 'image/png' : 'image/jpeg', 0.85));
          } catch (err) { resolve(src); }
        };
        img.src = src;
      };
      reader.readAsDataURL(file);
    });
  }

  async function addImageFiles(files) {
    const imgs = Array.from(files || []).filter(isImageFile);
    if (!imgs.length) return 0;
    for (const f of imgs) {
      try {
        NS.pendingImages.push(await fileToDataURL(f));
      } catch (err) {
        pushLog('sys', tr('chat.loadImgErr', 'Failed to load image: {msg}', { msg: err && err.message || err }));
      }
    }
    renderPending();
    return imgs.length;
  }

  function renderPending() {
    const host = document.getElementById('chat-pending');
    if (!host) return;
    host.innerHTML = '';
    const imgs = NS.pendingImages || [];
    // Show the tray only when there is something staged, else keep it collapsed.
    host.hidden = imgs.length === 0;
    imgs.forEach((src, i) => {
      const wrap = document.createElement('span');
      wrap.className = 'chat-pending-item';
      const img = document.createElement('img');
      img.src = src;
      img.alt = tr('chat.attachAlt', 'attachment {n}', { n: i + 1 });
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'chat-pending-del';
      del.textContent = '×';
      del.title = tr('chat.removeImgTitle', 'Remove this image');
      del.addEventListener('click', () => {
        NS.pendingImages.splice(i, 1);
        renderPending();
      });
      wrap.appendChild(img);
      wrap.appendChild(del);
      host.appendChild(wrap);
    });
  }

  // Collect image files from a clipboard/drag DataTransfer's items.
  function imagesFromClipboard(dt) {
    const items = (dt && dt.items) || [];
    const out = [];
    for (const it of items) {
      if (it.kind === 'file') {
        const f = it.getAsFile && it.getAsFile();
        if (isImageFile(f)) out.push(f);
      }
    }
    return out;
  }

  function setupImageInput() {
    const input = document.getElementById('chat-input');
    const attach = document.getElementById('chat-attach');
    const file = document.getElementById('chat-file');
    if (attach && file) {
      attach.addEventListener('click', (ev) => { ev.preventDefault(); file.click(); });
      file.addEventListener('change', () => {
        addImageFiles(file.files);
        file.value = '';
      });
    }
    if (input) {
      // Drag & drop an image file onto the box.
      input.addEventListener('dragover', (ev) => { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; });
      input.addEventListener('drop', (ev) => {
        ev.preventDefault();
        if (ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files.length) {
          addImageFiles(ev.dataTransfer.files);
        }
      });
      // Klik di luar panel chat mencabut fokus dari input chat — jadi paste
      // berikutnya (teks/gambar) mendarat di target aslinya, bukan di chat.
      document.addEventListener('pointerdown', (ev) => {
        const t = ev.target;
        if (t && t.closest && t.closest('#chat-panel')) return;
        if (document.activeElement === input) input.blur();
      }, true);
    }
    // Paste an image INTO THE CHAT ONLY while the cursor is truly in the chat
    // input (document.activeElement === #chat-input). Anywhere else — canvas,
    // kolom lain, select model, dll. — paste diserahkan ke target aslinya
    // (workspace Image Trace, atau field teks yang sedang fokus). Satu listener
    // CAPTURE-phase menang sebelum handler workspace:
    //   • capture runs before the workspace's own bubble-phase paste handler
    //     (app.js onPasteEvent), which otherwise grabs the image for Image Trace
    //     and opens its dialog;
    //   • stopImmediatePropagation() keeps that trace handler from also firing.
    document.addEventListener('paste', (ev) => {
      if (document.activeElement !== input) return;     // hanya saat kursor di input chat
      const imgs = imagesFromClipboard(ev.clipboardData);
      if (!imgs.length) return;                         // nothing image-y: not ours
      ev.preventDefault();
      ev.stopImmediatePropagation();                    // block workspace Image Trace
      addImageFiles(imgs);
      if (input) input.focus();                         // ready for a note + Kirim
    }, true);                                           // capture: win the race
    renderPending();
  }

  function pushLog(role, text, ops, images) {
    const entry = { role, text: String(text == null ? '' : text), ops: ops || null, at: Date.now() };
    if (images && images.length) entry.images = images.slice();
    NS.log.push(entry);
    if (NS.log.length > 200) NS.log.splice(0, NS.log.length - 200);
    scheduleSave();
  }

  // ---- session store (IndexedDB) ------------------------------------------
  // Chat sessions (text AND attached image data URLs) live in IndexedDB:
  // localStorage's ~5MB quota can't hold downscaled photos, and a session
  // archive grows past it quickly. Structure:
  //   • `sessions` store — one record per session (running OR archived):
  //       { id, title, at, updatedAt, messages: [{role,text,ops,at,done,thinking,retryText,images?}] }
  //   • `meta` store — ONLY archived sessions (the History list), lightweight:
  //       { id, title, at, updatedAt, count, img }
  //   • localStorage key CURRENT_ID_KEY — which session is RUNNING right now.
  // The running session always survives a reload; "New" moves it into `meta`
  // (History), and clicking a History entry moves it back to running.
  const DB_NAME = 'minisketch-chat';
  const DB_VER = 1;
  const SESSIONS = 'sessions';
  const META = 'meta';
  const CURRENT_ID_KEY = 'minisketch.chat.currentId';
  const LEGACY_CHAT_KEY = 'minisketch.chat.v1';   // v0 localStorage record, migrated once
  let _db = null;
  const dbOpen = () => new Promise((resolve, reject) => {
    if (_db) return resolve(_db);
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VER); } catch (err) { return reject(err); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SESSIONS)) db.createObjectStore(SESSIONS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id' });
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
  const idbPut = (store, val) => dbOpen().then(db => new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(val);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  }));
  const idbGet = (store, key) => dbOpen().then(db => new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const rq = tx.objectStore(store).get(key);
    rq.onsuccess = () => res(rq.result || null);
    rq.onerror = () => rej(rq.error);
  }));
  const idbDel = (store, key) => dbOpen().then(db => new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  }));
  const idbAll = (store) => dbOpen().then(db => new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const rq = tx.objectStore(store).getAll();
    rq.onsuccess = () => res(rq.result || []);
    rq.onerror = () => rej(rq.error);
  }));

  // Mark a live entry as a FINISHED turn so it is kept on save. We used to
  // guess by "text doesn't end in …", but the FINAL phase of a turn ends in …
  // too ("… memverifikasi…", '… Ketik "lanjutkan"…'), so the last AI message —
  // the one carrying the thinking — was dropped and a refresh left only the
  // first user line. An explicit flag is reliable.
  function markDone(m) { if (m) m.done = true; }

  // The persistent picture of the RUNNING session: finished turns only. A live
  // agent message ("berpikir…") gets `done` when its turn completes, so this
  // filter is the same "finished" notion as the old v0 persistLog.
  function finishedMessages() {
    return NS.log.filter(m => m && (m.role === 'user' || m.done) && typeof m.text === 'string')
      .map(m => {
        const c = Object.assign({}, m);
        if (c.images && Array.isArray(c.images)) {
          c.images = c.images.filter(s => typeof s === 'string' && s.startsWith('data:image/'));
          if (!c.images.length) delete c.images;
        } else if (c.images) delete c.images;
        return c;
      })
      .slice(-200);
  }
  function sessionTitle(msgs) {
    const u = msgs.find(m => m.role === 'user');
    const t = u ? String(u.text || '').replace(/\s+/g, ' ').trim() : '';
    if (t) return t.length > 48 ? t.slice(0, 48) + '…' : t;
    return (u && u.images && u.images.length)
      ? tr('chat.imageWord', '(image)')
      : tr('chat.newConvTitle', 'New conversation');
  }
  function saveCurrentSession() {
    if (!NS.sessionId) return Promise.resolve();
    const msgs = finishedMessages();
    const sess = {
      id: NS.sessionId,
      title: sessionTitle(msgs),
      at: NS.sessionAt || Date.now(),
      updatedAt: Date.now(),
      messages: msgs
    };
    return idbPut(SESSIONS, sess).then(() => {
      if (msgs.length && window.MiniSketchCloud && window.MiniSketchCloud.onChatSessionSaved) {
        window.MiniSketchCloud.onChatSessionSaved(Object.assign({}, sess, { archived: false }));
      }
    }).catch(() => { /* IDB unavailable: chat won't survive refresh */ });
  }
  let _saveTimer = null;
  function scheduleSave() {
    if (!NS.sessionId) return;
    if (_saveTimer) return;
    _saveTimer = setTimeout(() => { _saveTimer = null; saveCurrentSession(); }, 120);
  }
  function sanitizeMessages(arr) {
    return (Array.isArray(arr) ? arr : [])
      .filter(m => m && (m.role === 'user' || m.role === 'ai' || m.role === 'sys') &&
        typeof m.text === 'string' && m.text)
      .map(m => {
        const c = Object.assign({}, m);
        if (c.images && Array.isArray(c.images)) {
          c.images = c.images.filter(s => typeof s === 'string' && s.startsWith('data:image/'));
          if (!c.images.length) delete c.images;
        } else delete c.images;
        return c;
      })
      .slice(-200);
  }
  function newSessionId() {
    return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
  // Load the running session (or migrate the v0 localStorage chat once).
  // Always resolves to a promise so callers can .then() unconditionally.
  function initSession() {
    const fresh = () => {
      NS.sessionId = newSessionId();
      NS.sessionAt = Date.now();
      lsSet(CURRENT_ID_KEY, NS.sessionId);
      return Promise.resolve();
    };
    const cur = lsGet(CURRENT_ID_KEY);
    if (cur) {
      return idbGet(SESSIONS, cur).then(sess => {
        if (sess) {
          NS.sessionId = cur;
          NS.sessionAt = sess.at;
          NS.log = sanitizeMessages(sess.messages);
          return;
        }
        return fresh();
      }).catch(() => { NS.sessionId = newSessionId(); });
    }
    const raw = lsGet(LEGACY_CHAT_KEY);
    if (raw) {
      try {
        const arr = JSON.parse(raw);
        const msgs = sanitizeMessages(arr);
        if (msgs.length) {
          NS.sessionId = newSessionId();
          NS.sessionAt = Date.now();
          NS.log = msgs;
          lsSet(CURRENT_ID_KEY, NS.sessionId);
          lsDel(LEGACY_CHAT_KEY);
          return saveCurrentSession();
        }
      } catch (err) { /* corrupted old record: start clean */ }
    }
    return fresh();
  }
  // Move the running session into the History archive (called by New, and before
  // resuming a History session so nothing currently running is lost).
  function archiveCurrentSession() {
    if (NS.sessionId && finishedMessages().length) {
      return saveCurrentSession().then(() => {
        const msgs = finishedMessages();
        const metaRow = {
          id: NS.sessionId,
          title: sessionTitle(msgs),
          at: NS.sessionAt || Date.now(),
          updatedAt: Date.now(),
          count: msgs.length,
          img: msgs.some(m => m.images && m.images.length)
        };
        if (window.MiniSketchCloud && window.MiniSketchCloud.onChatSessionSaved) {
          window.MiniSketchCloud.onChatSessionSaved({
            id: NS.sessionId,
            title: metaRow.title,
            at: metaRow.at,
            updatedAt: metaRow.updatedAt,
            archived: true,
            messages: msgs
          });
        }
        return idbPut(META, metaRow).catch(() => {});
      });
    }
    return Promise.resolve();
  }
  // Clicking a History row moves that session back to running.
  function resumeSession(id) {
    return idbGet(SESSIONS, id).then(sess => {
      if (!sess) return false;
      NS.sessionId = id;
      NS.sessionAt = sess.at;
      NS.log = sanitizeMessages(sess.messages);
      lsSet(CURRENT_ID_KEY, id);
      if (window.MiniSketchCloud && window.MiniSketchCloud.onChatSessionSaved) {
        window.MiniSketchCloud.onChatSessionSaved(Object.assign({}, sess, { archived: false }));
      }
      // it is the running session again: drop it from the History list
      return idbDel(META, id).then(() => true);
    }).catch(() => false);
  }
  function deleteArchivedSession(id) {
    if (window.MiniSketchCloud && window.MiniSketchCloud.onChatSessionDeleted) {
      window.MiniSketchCloud.onChatSessionDeleted(id);
    }
    return idbDel(SESSIONS, id).then(() => idbDel(META, id)).catch(() => {});
  }
  NS.meta = [];
  function refreshMeta() {
    idbAll(META).then(list => {
      NS.meta = list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      if (NS.mode === 'log') renderLog();
    }).catch(() => {});
  }

  NS.exportAllSessions = async () => {
    try {
      const [sessions, metas] = await Promise.all([idbAll(SESSIONS), idbAll(META)]);
      const metaIds = new Set((metas || []).map(m => m && m.id));
      return (sessions || [])
        .filter(s => s && s.id && Array.isArray(s.messages))
        .map(s => Object.assign({}, s, { archived: metaIds.has(s.id) && s.id !== NS.sessionId }));
    } catch (err) {
      return [];
    }
  };

  NS.importSyncedSessions = async (items) => {
    if (!Array.isArray(items) || !items.length) return;
    let activeUpdated = false;
    for (const remote of items) {
      if (!remote || !remote.id || !Array.isArray(remote.messages)) continue;
      try {
        const local = await idbGet(SESSIONS, remote.id);
        const rMs = Number(remote.updatedAtMs || remote.updatedAt || 0);
        const lMs = Number((local && (local.updatedAt || local.updatedAtMs)) || 0);
        if (!local || rMs > lMs) {
          const cleanMsgs = sanitizeMessages(remote.messages);
          const sessObj = {
            id: remote.id,
            title: remote.title || sessionTitle(cleanMsgs),
            at: Number(remote.at) || Date.now(),
            updatedAt: rMs || Date.now(),
            messages: cleanMsgs
          };
          await idbPut(SESSIONS, sessObj);
          if (remote.archived && remote.id !== NS.sessionId) {
            await idbPut(META, {
              id: remote.id,
              title: sessObj.title,
              at: sessObj.at,
              updatedAt: sessObj.updatedAt,
              count: cleanMsgs.length,
              img: !!remote.img
            });
          } else if (remote.id === NS.sessionId) {
            NS.log = cleanMsgs;
            NS.sessionAt = sessObj.at;
            activeUpdated = true;
          }
        }
      } catch (err) { /* ignore individual session merge error */ }
    }
    if (activeUpdated && NS.mode === 'chat') renderLog();
    refreshMeta();
  };

  function stateSummary() {
    if (!api) return null;
    const st = api.state;
    const ents = Object.values(st.entities || {});
    let bounds = null;
    try { bounds = api.contentBounds ? api.contentBounds() : null; } catch (err) { bounds = null; }
    let center = { x: 0, y: 0 };
    try { center = api.s2w(api.getW() / 2, api.getH() / 2) || center; } catch (err) { /* keep 0,0 */ }
    let loops = [];
    try { loops = (api.getLoops() || []).map(l => ({ area: Math.round((l.area || 0) * 100) / 100, entities: (api.loopEntities(l) || []).length })); }
    catch (err) { loops = []; }
    const typeCount = {};
    for (const e of ents) typeCount[e.type] = (typeCount[e.type] || 0) + 1;
    return {
      entities: ents.length,
      points: Object.keys(st.points || {}).length,
      constraints: Object.keys(st.constraints || {}).length,
      types: typeCount,
      selection: (api.ui.selection || []).map(s => ({ kind: s.kind, id: s.id })),
      activeLayer: api.ui.activeLayer,
      color: api.ui.color,
      bounds, center,
      loops: loops.slice(0, 12), loopCount: loops.length
    };
  }

  // Rich per-entity detail for the CURRENT user selection: bbox, area, color,
  // text content, and — crucially — which loops the entity belongs to
  // (outer ring vs enclosed counter), so the model can plan booleans.
  function describeSelection() {
    if (!api) return null;
    const st = api.state;
    const selIds = (api.ui.selection || []).filter(s => s.kind === 'entity').map(s => +s.id);
    const loops = (() => { try { return api.getLoops() || []; } catch (err) { return []; } })();
    const loopOf = {};
    loops.forEach((l, i) => {
      for (const eid of (api.loopEntities(l) || [])) loopOf[+eid] = i;
    });
    const details = selIds.map(id => {
      const e = st.entities[id];
      if (!e) return { id, missing: true };
      const d = { id, type: e.type, color: e.color || '#000000' };
      if (e.fill === 'gray' || e.fill === 'yellow') d.fill = e.fill;
      if (e.type === 'art') {
        if (Array.isArray(e.contourColors) && e.contourColors.length) {
          d.colors = Array.from(new Set(e.contourColors.map(c => c || e.color || '#000000')));
        }
        if (Array.isArray(e.contourFills) && e.contourFills.length) {
          d.fills = Array.from(new Set(e.contourFills.map(f => (f === 'gray' || f === 'yellow') ? f : (e.fill || 'none'))));
        }
      }
      if (e.type === 'array') d.readOnlyStyle = true;
      if (e.type === 'text') d.text = e.text;
      if (e.name) d.name = e.name;
      if (e.group) d.group = e.group;
      // world bbox of this entity
      try {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, ok = false;
        for (const pl of api.entityWorldPolylines(e)) {
          for (const p of pl.pts) {
            if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
            ok = true;
          }
        }
        if (ok) {
          d.bbox = {
            x: Math.round(minX * 100) / 100, y: Math.round(minY * 100) / 100,
            w: Math.round((maxX - minX) * 100) / 100, h: Math.round((maxY - minY) * 100) / 100
          };
          if (d.type === 'text') d.capHeight = d.bbox.h;
        }
      } catch (err) { /* bbox best-effort */ }
      if (loopOf[id] != null) d.loopIndex = loopOf[id];
      return d;
    });
    // loop geometry context: for each picked loop, its area and whether another
    // picked loop encloses it (outer vs counter — the boolean pairing matters)
    const loopInfo = {};
    for (const d of details) {
      if (d.loopIndex == null) continue;
      if (loopInfo[d.loopIndex]) { d.loopArea = loopInfo[d.loopIndex].area; d.enclosedBy = loopInfo[d.loopIndex].enclosedBy; continue; }
      const l = loops[d.loopIndex];
      const area = Math.round(Math.abs(l.area || 0) * 100) / 100;
      let enclosedBy = null;
      // a loop encloses this one when this loop's first point sits inside it
      try {
        const probe = (l.poly && l.poly[0]) || null;
        for (let j = 0; j < loops.length; j++) {
          if (j === d.loopIndex) continue;
          const other = loops[j];
          if (Math.abs(other.area || 0) <= Math.abs(l.area || 0)) continue;
          if (probe && api.pointInPoly(probe, other.poly || [])) { enclosedBy = j; break; }
        }
      } catch (err) { /* containment best-effort */ }
      loopInfo[d.loopIndex] = { area, enclosedBy };
      d.loopArea = area;
      d.enclosedBy = enclosedBy;
      if (enclosedBy != null) d.role = 'counter (inner)';
      else if (loops.length > 1) d.role = 'outer ring candidate';
    }
    return { count: selIds.length, entities: details, loopCount: loops.length };
  }

  // ---- executor: one validated op -> toolApi -------------------------------
  function selectEntities(ids) {
    api.ui.selection = (ids || [])
      .map(id => ({ kind: 'entity', id: +id }))
      .filter(s => api.state.entities[s.id]);
  }

  function runOp(op) {
    if (!op || !op.name) return { ok: false, error: 'empty op' };
    const a = op.arguments || op.args || {};
    switch (op.name) {
      case 'add_line': {
        const id = api.addLine(clampPt(a.a), clampPt(a.b), normColor(a.color) || undefined);
        return id ? { ok: true, id } : { ok: false, error: 'bad line points' };
      }
      case 'add_circle': {
        const r = Math.abs(+a.r);
        if (!(r > 1e-9)) return { ok: false, error: 'bad radius' };
        const id = api.addCircle(clampPt(a.c), Math.min(r, 10000), normColor(a.color) || undefined);
        return id ? { ok: true, id } : { ok: false, error: 'bad circle' };
      }
      case 'add_arc': {
        const id = api.addArc(clampPt(a.c), clampPt(a.s), clampPt(a.e), normColor(a.color) || undefined);
        return id ? { ok: true, id } : { ok: false, error: 'bad arc points' };
      }
      case 'add_spline': {
        const pts = (a.pts || []).map(clampPt);
        const id = api.addSpline({ pts, closed: !!a.closed, color: normColor(a.color) || undefined });
        return id ? { ok: true, id } : { ok: false, error: 'need 2+ points' };
      }
      case 'add_panel': {
        const pts = (a.pts || []).map(clampPt);
        const id = api.addPanelEntity(pts, normColor(a.color) || api.ui.color);
        return id ? { ok: true, id } : { ok: false, error: 'need 3+ points' };
      }
      case 'add_polyline': {
        const pts = (a.pts || []).map(clampPt);
        const id = api.addPolylineEntity(pts, normColor(a.color) || api.ui.color);
        return id ? { ok: true, id } : { ok: false, error: 'need 2+ points' };
      }
      case 'add_note': {
        // Real yellow workshop comment (also used as copy-count number for Nesting).
        // Visible lettering on the part uses add_text (enforced by system prompt).
        if (typeof a.text !== 'string' || !a.text.trim()) return { ok: false, error: 'need text' };
        const id = api.addNote(a.text, clampN(a.x), clampN(a.y));
        return id ? { ok: true, id } : { ok: false, error: 'bad note params' };
      }
      case 'add_text': {
        if (typeof a.text !== 'string' || !a.text.trim()) return { ok: false, error: 'need text' };
        const fillVal = (a.fill === 'gray' || a.fill === 'yellow') ? a.fill : undefined;
        const id = api.addText(a.text, clampN(a.x), clampN(a.y), {
          height: a.height, font: a.font, weight: a.weight,
          italic: a.italic, tracking: a.tracking, align: a.align,
          color: a.color, fill: fillVal
        });
        return id ? { ok: true, id } : { ok: false, error: 'bad text params' };
      }
      case 'add_constraint': {
        const c = { type: a.type };
        const num = (v) => (v != null && isFinite(+v) ? +v : null);
        const e1 = num(a.entity), e2 = num(a.entity2);
        const p = num(a.p), p1 = num(a.p1), p2 = num(a.p2);
        // Shape mirrors cmd*() in app.js: line pairs use line1/line2, point
        // pairs use p1/p2, single-entity dims use entity, single points use p.
        if (a.type === 'parallel' || a.type === 'perpendicular' || a.type === 'equal') {
          if (e1 == null || e2 == null) return { ok: false, error: 'need entity + entity2' };
          c.line1 = e1; c.line2 = e2;
        } else if (a.type === 'coincident' || a.type === 'distance') {
          if (p1 == null || p2 == null) return { ok: false, error: 'need p1 + p2' };
          c.p1 = p1; c.p2 = p2;
        } else if (a.type === 'radius' || a.type === 'pointDim' || a.type === 'pointOn' ||
                   a.type === 'midpoint' || a.type === 'aspect' || a.type === 'angle') {
          if (e1 == null && p == null) return { ok: false, error: 'need entity or p' };
          if (e1 != null) {
            if (a.type === 'angle') { if (e2 == null) return { ok: false, error: 'angle needs entity2' }; c.line1 = e1; c.line2 = e2; }
            else c.entity = e1;
          }
          if (p != null) c.p = p;
          if (p1 != null) c.p1 = p1;
          if (p2 != null) c.p2 = p2;
        } else if (a.type === 'fix' || a.type === 'horizontal' || a.type === 'vertical' || a.type === 'tangent') {
          if (p != null) c.p = p;
          if (e1 != null) c.entity = e1;
          if (e2 != null) c.line = e2;
          if (p == null && e1 == null) return { ok: false, error: 'need p or entity' };
        } else {
          return { ok: false, error: 'unknown constraint type' };
        }
        if (a.value != null && isFinite(+a.value)) c.value = Math.max(-100000, Math.min(100000, +a.value));
        const id = api.addConstraint(c, { history: false, solve: false });
        return id ? { ok: true, id } : { ok: false, error: 'constraint rejected' };
      }
      case 'move_selection': {
        const dx = clampN(a.dx), dy = clampN(a.dy);
        if (!dx && !dy) return { ok: false, error: 'zero move' };
        api.moveSelection(dx, dy);
        return { ok: true };
      }
      case 'scale_selection': {
        const sx = +a.sx, sy = +a.sy;
        if (!isFinite(sx) || !isFinite(sy) || !sx || !sy) return { ok: false, error: 'bad scale' };
        let ox = +a.ox, oy = +a.oy;
        if (!isFinite(ox) || !isFinite(oy)) {
          const b = (api.selectionBounds && api.selectionBounds()) || (api.contentBounds ? api.contentBounds() : null);
          ox = b ? (b.minX + b.maxX) / 2 : 0;
          oy = b ? (b.minY + b.maxY) / 2 : 0;
        }
        api.scaleSelection(sx, sy, ox, oy);
        return { ok: true };
      }
      case 'rotate_selection': {
        const deg = +a.angle;
        if (!isFinite(deg)) return { ok: false, error: 'bad angle' };
        const ox = a.ox != null && isFinite(+a.ox) ? clampN(a.ox) : NaN;
        const oy = a.oy != null && isFinite(+a.oy) ? clampN(a.oy) : NaN;
        return api.rotateSelection(deg, ox, oy);
      }
      case 'mirror_selection': {
        const axis = String(a.axis || '').toLowerCase();
        if (axis !== 'x' && axis !== 'y') return { ok: false, error: 'axis must be "x" or "y"' };
        const ox = a.ox != null && isFinite(+a.ox) ? clampN(a.ox) : NaN;
        const oy = a.oy != null && isFinite(+a.oy) ? clampN(a.oy) : NaN;
        return api.mirrorSelection(axis, ox, oy);
      }
      case 'duplicate_selection': {
        const dx = a.dx != null && isFinite(+a.dx) ? clampN(a.dx) : 0;
        const dy = a.dy != null && isFinite(+a.dy) ? clampN(a.dy) : 0;
        const r = api.duplicateSelection(dx, dy);
        if (!r || !r.ok) return r || { ok: false, error: 'duplicate failed' };
        return { ok: true, id: (r.ids && r.ids[0]) || undefined, ids: r.ids || [], count: (r.ids || []).length };
      }
      case 'set_selection_color': {
        const hasColor = a.color != null && String(a.color).trim() !== '';
        const hasFill = a.fill != null && String(a.fill).trim() !== '';
        if (!hasColor && !hasFill) return { ok: false, error: 'provide color and/or fill' };
        if (!api.ui.selection.length) return { ok: false, error: 'nothing selected' };
        const out = { ok: true };
        if (hasColor) {
          const col = normColor(a.color);
          if (!col) return { ok: false, error: 'bad color' };
          const rc = api.setSelectionColor(col, { noHistory: true, quiet: true, setDefault: false });
          if (!rc || !rc.ok) return { ok: false, error: (rc && rc.error) || 'color update failed', skippedArrays: rc && rc.skippedArrays };
          out.color = col;
          out.count = rc.count;
          if (rc.skippedArrays) out.skippedArrays = rc.skippedArrays;
        }
        if (hasFill) {
          const rf = api.setSelectionFill(a.fill, { noHistory: true, quiet: true });
          if (!rf || !rf.ok) return { ok: false, error: (rf && rf.error) || 'fill update failed', skippedArrays: rf && rf.skippedArrays };
          out.fill = a.fill;
          out.fillCount = rf.count;
          if (rf.skippedArrays) out.skippedArrays = Math.max(out.skippedArrays || 0, rf.skippedArrays);
          if (rf.singleLineWarn) out.singleLineWarn = rf.singleLineWarn;
        }
        return out;
      }
      case 'set_default_color': {
        const col = normColor(a.color);
        if (!col) return { ok: false, error: 'bad color' };
        api.ui.color = col;
        return { ok: true };
      }
      case 'remove_entity': {
        if (a.id == null || !api.state.entities[+a.id]) return { ok: false, error: 'unknown id' };
        api.removeEntity(+a.id);
        return { ok: true };
      }
      case 'delete_selection': {
        api.deleteSelection({ noHistory: true });
        return { ok: true };
      }
      case 'clear_selection': {
        api.ui.selection = [];
        return { ok: true };
      }
      case 'set_selection': {
        const ids = (Array.isArray(a.ids) ? a.ids : []).map(Number).filter(n =>
          api.state.entities[n]);
        if (!ids.length) return { ok: false, error: 'no valid entity ids' };
        selectEntities(ids);
        return { ok: true, count: ids.length, ids };
      }
      case 'text_to_curves': {
        const targets = a.id != null ? [+a.id] : api.selectedEntities().map(e => +e.id);
        const texts = targets.filter(id => api.state.entities[id] && api.state.entities[id].type === 'text');
        if (!texts.length) return { ok: false, error: 'select a text object first (or pass id)' };
        if (a.id != null) selectEntities(texts);
        const before = Object.keys(api.state.entities).length;
        api.cmdConvertToCurve();
        const after = Object.keys(api.state.entities).length;
        return { ok: true, curves: after - before + texts.length, madeIds: api.ui.selection.map(s => s.id) };
      }
      case 'ungroup': {
        api.cmdUngroupSelection();
        return { ok: true };
      }
      case 'boolean': {
        const mode = a.mode === 'cut' ? 'cut' : a.mode === 'intersect' ? 'intersect' : 'union';
        if (mode !== 'union' && api.ui.selection.filter(s => s.kind === 'entity').length < 2) {
          return { ok: false, error: mode + ' needs exactly 2+ loops: select the target loop first, then the tool loop last' };
        }
        api.cmdBoolean(mode);
        return { ok: true, mode };
      }
      case 'offset_selection': {
        // stencil bridges / inlay: grow (positive mm) or shrink the selected closed loops
        const d = +a.distance;
        if (!isFinite(d) || !d) return { ok: false, error: 'need distance in mm (+grow / -shrink)' };
        const contours = [];
        for (const e of api.selectedEntities()) {
          for (const pl of api.entityWorldPolylines(e)) {
            if (pl.closed && pl.pts.length >= 3) contours.push(pl);
          }
        }
        if (!contours.length) return { ok: false, error: 'selection has no closed loops' };
        const chains = api.offsetClosedChains(contours, Math.abs(d), d < 0);
        if (!chains || !chains.length) return { ok: false, error: 'offset produced nothing' };
        const made = [];
        for (const ch of chains) {
          if (ch.pts && ch.pts.length >= 3) {
            const id = api.addPanelEntity(ch.pts, api.ui.color);
            if (id) made.push(id);
          }
        }
        if (!made.length) return { ok: false, error: 'no usable chain in result' };
        api.ui.selection = made.map(id => ({ kind: 'entity', id }));
        return { ok: true, count: made.length, ids: made };
      }
      case 'get_entities': {
        const st = api.state;
        const out = [];
        for (const id in st.entities) {
          const e = st.entities[id];
          out.push({ id: +id, type: e.type, color: e.color || '#000000', text: e.type === 'text' ? e.text : undefined });
        }
        return { ok: true, query: 'get_entities', result: out.slice(0, 100) };
      }
      case 'get_svg': {
        // The whole drawing (or just the selection) as SVG. A model reads SVG
        // natively, so this beats the raw entity dump for understanding shape.
        const scope = a.scope === 'selection' ? 'selection' : 'all';
        const svg = api.exportSVG({
          onlyVisible: a.includeHidden ? false : true,
          onlySelected: scope === 'selection',
          returnString: true
        });
        if (!svg) return { ok: false, error: scope === 'selection' ? 'nothing selected to export' : 'drawing is empty' };
        let viewBox = '';
        const m = svg.match(/viewBox="([^"]+)"/);
        if (m) viewBox = m[1];
        const bytes = svg.length;
        // a 200 KB dump blows the context window for no gain: cap it and say so
        const MAX = 60000;
        const truncated = bytes > MAX;
        return {
          ok: true, query: 'get_svg',
          // `result` is the field applyOps forwards to the model; everything
          // useful about this answer lives in it.
          result: {
            scope, viewBox, bytes, truncated,
            note: 'Y-down world millimetres, 1:1 with the world frame; stroke colours are the CNC operations (see colorLegend). Paths are open polylines unless the shape closes.',
            svg: truncated ? svg.slice(0, MAX) : svg
          }
        };
      }
      case 'group_selection': {
        api.cmdGroupSelection({ noHistory: true });
        const sel = api.ui.selection;
        if (sel.length === 1) {
          const wrap = api.state.entities[sel[0].id];
          if (wrap && typeof a.name === 'string' && a.name.trim()) wrap.name = a.name.trim().slice(0, 80);
        }
        return { ok: true };
      }
      case 'call_generator':
        return { ok: false, error: 'generator must run alone', generator: { kind: a.kind, params: a.params || {} } };
      case 'get_selection':
        return { ok: true, query: 'get_selection', result: stateSummary().selection.map(s => {
          const e = s.kind === 'entity' ? api.state.entities[s.id] : null;
          return e ? { kind: 'entity', id: e.id, type: e.type, color: e.color || '#000000' } : s;
        }) };
      case 'use_skill': {
        const name = String(a.name || '').trim();
        if (!name) return { ok: false, error: 'need skill name' };
        NS.requestedSkills = NS.requestedSkills || [];
        if (!NS.requestedSkills.includes(name)) NS.requestedSkills.push(name);
        return { ok: true, query: 'use_skill', result: 'skill "' + name + '" will be active next round' };
      }
      case 'describe_selection': {
        const d = describeSelection();
        return d ? { ok: true, query: 'describe_selection', result: d }
                 : { ok: false, error: 'nothing selected' };
      }
      case 'import_svg': {
        // A whole SVG document becomes real entities in one op: the model
        // writes vector SVG natively, so one import_svg replaces dozens of
        // add_line / add_circle calls and stays a single undo step (applyOps
        // pushed history once for the whole batch).
        const text = String(a.svg || '');
        if (!text.trim()) return { ok: false, error: 'import_svg: empty svg' };
        if (text.length > 150000) return { ok: false, error: 'import_svg: svg too large (' + text.length + ' chars, max 150k)' };
        if (typeof api.svgImportParse !== 'function' || typeof api.svgImportInsert !== 'function')
          return { ok: false, error: 'import_svg: unavailable in this build' };
        let ir = null;
        try {
          ir = api.svgImportParse(text, {
            prefix: 'ai' + Date.now().toString(36) + '-',
            // The world is Y-down and so is SVG, so the default (yUp omitted or
            // false) imports 1:1 — no mirror. yUp:true is only for a source
            // authored bottom-left/+Y-up, which svgImportParse mirrors when it
            // is handed flipY === false (its flag means "flip into Y-down").
            flipY: a.yUp !== true,
            ...(isFinite(+a.scale) && +a.scale > 0 ? { scale: +a.scale } : {})
          });
        } catch (err) {
          return { ok: false, error: 'import_svg: ' + String(err && err.message || err) };
        }
        if (!ir.items || !ir.items.length) {
          return { ok: false, error: 'import_svg: no vector shapes found in the SVG' +
            (ir.skipped && (ir.skipped.text || ir.skipped.image)
              ? ' (skipped ' + [ir.skipped.text && ir.skipped.text + ' text', ir.skipped.image && ir.skipped.image + ' image'].filter(Boolean).join(', ') + ')'
              : '') };
        }
        const at = a.at && isFinite(+a.at.x) && isFinite(+a.at.y)
          ? clampPt(a.at) : undefined;
        const made = api.svgImportInsert(ir, {
          keepGroups: !!a.keepGroups,
          // The model writes lettering as SVG <text>. Import it as a REAL,
          // editable text object — not a yellow note. Without textMode:'text'
          // the importer turned every <text> into a non-machined note, so the
          // "editable text" the user asked for came out as comments.
          textMode: 'text',
          ...(at ? { center: at } : {})
        });
        const ids = (made && made.entities) || [];
        if (!ids.length) return { ok: false, error: 'import_svg: nothing inserted' };
        api.ui.selection = ids.map(id => ({ kind: 'entity', id }));
        const bb = ir.bounds || {};
        return {
          ok: true, id: ids[0], query: 'import_svg',
          result: {
            entities: ids.length,
            lines: made.lines, splines: made.splines,
            circles: made.circles, grouped: made.framed,
            sizeMm: { w: Math.round((ir.mmW || 0) * 100) / 100, h: Math.round((ir.mmH || 0) * 100) / 100 },
            bounds: isFinite(bb.minX) ? { minX: bb.minX, minY: bb.minY, maxX: bb.maxX, maxY: bb.maxY } : null,
            colors: (ir.colorList || []).slice(0, 12).map(c => c.hex),
            selected: ids.length
          }
        };
      }
      case 'get_bounds':
        return { ok: true, query: 'get_bounds', result: { bounds: stateSummary().bounds, center: stateSummary().center } };
      case 'get_loops':
        return { ok: true, query: 'get_loops', result: stateSummary().loops };
      default:
        return { ok: false, error: 'unknown tool: ' + op.name };
    }
  }

  // call_generator replays dialog params into the real generator: the tool
  // modal is filled from params, then apply() runs its own pushHistory, so
  // the whole thing stays one undo step and double-click re-edit keeps working.
  function runGenerator(kind, params) {
    const tools = window.MiniSketchTools;
    if (!tools) return { ok: false, error: 'generators unavailable' };
    const tool = tools.list.find(t => t.id === kind);
    if (!tool) return { ok: false, error: 'unknown generator: ' + kind };
    tools.open(kind, params || {});
    try {
      tool.apply(api);
    } finally {
      try { tools.close(kind); } catch (err) { /* ignore */ }
    }
    return { ok: true, generator: kind };
  }

  const READ_ONLY_OPS = new Set([
    'get_entities', 'get_svg', 'get_bounds', 'get_loops',
    'get_selection', 'describe_selection', 'use_skill',
    'set_selection', 'clear_selection'
  ]);


  // One batch of ops. `opts.noHistory` continues an agent turn that already
  // pushed history (round 2+ of the verify loop), so the whole agent run
  // stays ONE undo step. Pure read-only batches skip pushing an empty snapshot.
  async function applyOps(ops, opts) {
    const o = opts || {};
    const list = (ops || []).filter(Boolean);
    if (!list.length) return { made: 0, ids: [], queryResults: [], errors: ['no ops'], results: [], pushedHistory: false };
    // Preload fonts needed by import_svg or add_text so frame metrics are accurate immediately.
    if (window.MiniSketchFonts) {
      const fontsToLoad = new Set();
      if (list.some(op => op.name === 'import_svg')) {
        fontsToLoad.add('Liberation Sans');
        fontsToLoad.add('Liberation Serif');
      }
      for (const op of list) {
        if (op.name === 'add_text' && op.arguments && op.arguments.font) {
          fontsToLoad.add(String(op.arguments.font));
        }
      }
      if (fontsToLoad.size) {
        try {
          await Promise.all([...fontsToLoad].map(f => window.MiniSketchFonts.load(f, 400, 'normal')));
        } catch (err) { /* fall back to whatever metrics we have */ }
      }
    }
    if (list.length === 1 && (list[0].name === 'call_generator' || list[0].generator)) {
      const g = list[0].name === 'call_generator'
        ? { kind: list[0].arguments.kind, params: list[0].arguments.params }
        : list[0].generator;
      const r = runGenerator(g.kind, g.params || {});
      api.commit();
      return { made: r.ok ? 1 : 0, ids: [], queryResults: [], errors: r.ok ? [] : [r.error], results: [{ op: 'call_generator', ok: r.ok, error: r.error }], generator: g.kind, pushedHistory: true };
    }
    const hasMutation = list.some(op => !READ_ONLY_OPS.has(op.name));
    const destructive = list.some(op => op.name === 'remove_entity' || op.name === 'delete_selection');
    const preIds = destructive ? new Set(Object.keys(api.state.entities)) : null;
    const pushedHistory = hasMutation && !o.noHistory;
    if (pushedHistory) api.pushHistory();
    const madeIds = [];
    const queryResults = [];
    const errors = [];
    const results = [];
    let needSolve = false;
    for (const op of list.slice(0, 20)) {
      if (op.name === 'call_generator' || op.generator) {
        errors.push('call_generator must run alone in its own turn');
        results.push({ op: 'call_generator', ok: false, error: 'must run alone' });
        continue;
      }
      let r;
      const tOp = performance.now();
      try { r = runOp(op); }
      catch (err) { r = { ok: false, error: String(err && err.message || err) }; }
      console.log('[AI tool]', op.name, '(' + Math.round(performance.now() - tOp) + 'ms)',
        JSON.stringify(op.arguments || {}).slice(0, 600));
      results.push({ op: op.name, ok: r.ok, id: r.id, ids: r.ids || r.madeIds, error: r.ok ? undefined : r.error });
      if (r.ok && Array.isArray(r.ids) && r.ids.length) {
        for (const mid of r.ids) madeIds.push(mid);
      } else if (r.ok && r.id) {
        madeIds.push(r.id);
      }
      if (r.ok && r.query) queryResults.push({ query: r.query, result: r.result });
      if (!r.ok && !r.generator) errors.push(op.name + ': ' + (r.error || 'failed'));
      if (r.ok && op.name === 'add_constraint') needSolve = true;
    }
    if (needSolve) { try { api.requestSolve(); } catch (err) { /* solve is best-effort */ } }
    if (hasMutation) api.commit();
    if (destructive) {
      const madeSet = new Set(madeIds);
      const removedPreExisting = [...preIds].filter(id => !api.state.entities[+id] && !madeSet.has(+id));
      if (removedPreExisting.length) {
        // Konfirmasi sebelum menghapus objek lama
        const msg = tr('chat.confirmDelMsg',
          'AI chat wants to delete {n} existing object(s). Allow? (one Undo reverts)',
          { n: removedPreExisting.length });
        const allowed = (typeof window !== 'undefined' && typeof window.uiConfirm === 'function')
          ? await window.uiConfirm(msg, { title: tr('chat.confirmDelTitle', 'Confirm Deletion'), danger: true })
          : false;
        if (!allowed) {
          if (typeof api.undo === 'function') api.undo();
          return { made: 0, ids: [], queryResults: [], errors: ['cancelled by user'], results: [], pushedHistory: false };
        }
      }
    }
    return { made: madeIds.length, ids: madeIds, queryResults, errors, results, pushedHistory };
  }

  // ---- offline fallback: Indonesian/English pattern parser, no LLM --------
  // Usage-question answers ("cara membuat dimensi") — sourced from the current
  // UI/shortcuts so they never fight the keymap. Kept here (not in help.js) so
  // the offline chat stays self-contained and free.
  const USAGE_FAQ = [
    { keys: ['dimensi', 'dimension', 'ukur', 'measure', 'diameter', 'radial'],
      id: "Dimensi: pilih dua titik (atau lingkaran), tekan D untuk dimensi penggerak, Shift+D untuk ukur/referensi. Lingkaran menampilkan diameter ⌀; busur tetap R. Pilih badge lalu double-click/Enter untuk mengubah nilainya.",
      en: "Dimensions: select two points (or a circle), press D for a driving dimension, Shift+D for a measure/reference. Circles read as diameter ⌀; arcs stay R. Double-click / Enter a selected dimension to edit its value." },
    { keys: ['offset', 'sisih', 'tebal dinding', 'gambar ulang'],
      id: "Offset (Ctrl+J): pilih loop/objek, lalu Ctrl+J — muncul pratinjau putus-putus; roda mouse mengubah jarak (Shift=0.1, Alt=5), Enter untuk nilai pasti, Esc batal.",
      en: "Offset (Ctrl+J): select a loop/object, press Ctrl+J — a dashed preview appears; mouse wheel changes the distance (Shift=0.1, Alt=5), Enter for an exact value, Esc cancels." },
    { keys: ['group', 'grup', 'kelompokkan', 'gabung', 'ungroup', 'bongkar'],
      id: "Group: pilih beberapa objek lalu Ctrl+G untuk membungkus jadi satu objek; Ctrl+U (atau Ctrl+Shift+G) membongkarnya kembali.",
      en: "Group: select several objects and press Ctrl+G to wrap them into one object; Ctrl+U (or Ctrl+Shift+G) breaks it back apart." },
    { keys: ['kurva', 'curve', 'pen', 'pena', 'bezier', 'spline'],
      id: "Kurva: tekan B (pena kurva) — klik untuk sudut, klik-tahan-geser untuk lengkung, klik node pertama untuk menutup. Shift+B untuk garis lurus.",
      en: "Curve: press B (curve pen) — click for a corner, click-drag for a smooth bend, click the first node to close. Shift+B for a straight line." },
    { keys: ['lingkaran', 'circle', 'bulat', 'bundar', 'elips', 'ellipse', 'kotak', 'box', 'persegi', 'rectangle', 'teks', 'text', 'tulisan'],
      id: "Bentuk dasar: E lingkaran, R kotak, T teks. Pilih alat, klik titik awal, lalu klik lagi untuk menentukan ukurannya.",
      en: "Basic shapes: E circle, R box, T text. Pick the tool, click a start point, then click again to set the size." },
    { keys: ['trim', 'potong', 'crossing', 'persimpangan', 'separate', 'pisah'],
      id: "Trim (I) memotong di persimpangan; Ctrl+klik menyusuri rantai. Separate (Shift+E) membelah tanpa menghapus.",
      en: "Trim (I) cuts at crossings; Ctrl+click walks the whole chain. Separate (Shift+E) splits without deleting." },
    { keys: ['snap', 'menempel', 'grid', 'kisi'],
      id: "Snap: Shift+5 (%) menghidupkan/mematikan snap; # untuk grid. Alt membalik snap sementara.",
      en: "Snap: Shift+5 (%) toggles snapping; # toggles the grid. Alt temporarily inverts the snap." },
    { keys: ['navigasi', 'geser', 'pan', 'zoom', 'perbesar', 'fit', 'memaskan', 'lihat'],
      id: "Navigasi: roda = geser vertikal, Shift+roda = horizontal, Ctrl+roda = zoom. Drag tengah/kanan = pan. 3 = fit ke seleksi, Shift+F = fit ke seluruh gambar.",
      en: "Navigation: wheel pans vertically, Shift+wheel horizontally, Ctrl+wheel zooms. Middle/right drag pans. 3 fits the selection, Shift+F fits the whole drawing." },
    { keys: ['node', 'simpul', 'edit titik', 'ubah bentuk', 'handle', 'lancip', 'halus'],
      id: "Edit node: F2 masuk mode node — titik objek terpilih muncul dan bisa digeser; seret handle untuk melengkungkan, \\ untuk lancip/halus. F1 kembali ke mode pilih/geser, F3 memilih titik junction (dilalui >3 garis).",
      en: "Node editing: F2 enters node mode — the selected object's points appear and are draggable; drag a handle to bend, \\ to make sharp/smooth. F1 returns to select/move, F3 selects junction points (used by >3 lines)." },
    { keys: ['layer', 'lapisan', 'aktif'],
      id: "Panel Layers: klik baris layer untuk menjadikannya aktif; tombol ⇥ memindahkan seleksi ke layer itu. Titik/label hanya tampil di layer aktif.",
      en: "Layers panel: click a layer row to make it active; the ⇥ button moves the selection to that layer. Points/labels appear only on the active layer." },
    { keys: ['import', 'impor', 'buka', 'open', 'simpan', 'save', 'ekspor', 'export', 'svg', 'dxf', 'pdf', 'cdr'],
      id: "File menu: Ctrl+O buka (mengganti), Ctrl+I impor (menggabung), Ctrl+S simpan ke browser, Ctrl+Shift+S unduh .sketch, Ctrl+E ekspor SVG. Mendukung SVG/PDF/DXF/CDR.",
      en: "File menu: Ctrl+O open (replaces), Ctrl+I import (merges), Ctrl+S save to browser, Ctrl+Shift+S download .sketch, Ctrl+E export SVG. Supports SVG/PDF/DXF/CDR." },
    { keys: ['kirim', 'send', 'cnc', 'karya', 'mesin', 'laser'],
      id: "Kirim ke KaryaCNC: Alt+Q langsung kirim dengan pengaturan terakhir; menu Tool → Send to KaryaCNC membuka dialog (host/port/ruang lingkup).",
      en: "Send to KaryaCNC: Alt+Q sends immediately with the last settings; Tool → Send to KaryaCNC opens the dialog (host/port/scope)." },
    { keys: ['undo', 'batal', 'redo', 'ulangi', 'copy', 'salin', 'paste', 'tempel', 'duplicate', 'duplikat'],
      id: "Ctrl+Z batal, Ctrl+Shift+Z ulangi; Ctrl+C/V salin/tempel; Ctrl+D duplikat di tempat.",
      en: "Ctrl+Z undo, Ctrl+Shift+Z redo; Ctrl+C/V copy/paste; Ctrl+D duplicate in place." },
    { keys: ['transform', 'putar', 'rotasi', 'skala', 'geser', 'move', 'pindah'],
      id: "Transform: pilih objek lalu Ctrl+M untuk mode transform (putar/skala). Ctrl+Shift+M untuk memindahkan tepat (pilih titik referensi lalu tujuan).",
      en: "Transform: select an object and press Ctrl+M for transform mode (rotate/scale). Ctrl+Shift+M moves precisely (pick a reference point, then the destination)." }
  ];
  function answerUsage(text) {
    const t = ' ' + String(text == null ? '' : text).toLowerCase().trim() + ' ';
    const isQuestion = /\b(cara|bagaimana|gimana|how|apa|what|tolong|bantu|help)\b/.test(t);
    if (!isQuestion) return null;
    let best = null, bestScore = 0;
    for (const f of USAGE_FAQ) {
      let s = 0;
      for (const k of f.keys) if (t.includes(k)) s++;
      if (s > bestScore) { best = f; bestScore = s; }
    }
    if (!best || bestScore === 0) return null;
    const indo = /\b(cara|bagaimana|gimana|apa|tolong|bantu)\b/.test(t);
    return indo ? best.id : best.en;
  }
  function parseLocal(text) {
    const t = ' ' + String(text || '').toLowerCase().trim() + ' ';
    const num = (re) => { const m = t.match(re); return m ? +m[1] : null; };
    const at = (() => {
      const m = t.match(/(?:di|at|pada)\s*(-?[\d.,]+)\s*[,;]\s*(-?[\d.,]+)/);
      if (m) return { x: +String(m[1]).replace(',', '.'), y: +String(m[2]).replace(',', '.') };
      return null;
    })();
    const w = num(/(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/) != null ? +t.match(/(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/)[1].replace(',', '.') : null;
    const h = num(/(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/) != null ? +t.match(/(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/)[2].replace(',', '.') : null;
    const diam = num(/(?:diameter|diam|dm|d|ø|diameternya)\s*(\d+(?:[.,]\d+)?)/) || num(/(\d+(?:[.,]\d+)?)\s*(?:mm\s*)?(?:diameter|diam|ø)/);
    const has = (...words) => words.some(x => t.includes(x));
    const ox = at ? at.x : 0, oy = at ? at.y : 0;

    // A hole is a through-cut: black circle. Red stays reserved for low-power
    // marking lines (the user's machine convention).
    const isHole = has('lubang', 'bor', 'drill', 'hole');
    const isMark = has('marking', 'tanda', 'score', 'gosong');
    const color = isMark ? '#ff0000' : (isHole || has('kotak', 'box') ? '#000000' : null);
    if (has('kotak', 'box', 'square', 'rectangle', 'rect', 'persegi', 'plat', 'plate', 'flange') && w && h) {
      return {
        ops: [{ name: 'add_panel', arguments: {
          pts: [{ x: ox, y: oy }, { x: ox + w, y: oy }, { x: ox + w, y: oy + h }, { x: ox, y: oy + h }],
          ...(color ? { color } : {})
        } }],
        reply: 'Kotak ' + w + '×' + h + ' dibuat di (' + ox + ', ' + oy + ').'
      };
    }
    if (has('lingkaran', 'circle', 'bulat', 'bundar') || (diam && !has('kotak', 'box'))) {
      const r = diam ? diam / 2 : (num(/r\s*(\d+(?:[.,]\d+)?)/) || 10);
      const cx = at ? at.x : (has('tengah', 'center', 'middle') ? null : ox);
      const cy = at ? at.y : (has('tengah', 'center', 'middle') ? null : oy);
      let c = { x: cx != null ? cx : 0, y: cy != null ? cy : 0 };
      if (cx == null) {
        const b = api.contentBounds ? api.contentBounds() : null;
        c = b ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : { x: 0, y: 0 };
      }
      return {
        ops: [{ name: 'add_circle', arguments: { c, r, ...(color ? { color } : {}) } }],
        reply: (isHole ? 'Lubang d' + (r * 2) : 'Lingkaran r' + r) + ' dibuat di (' + c.x + ', ' + c.y + ').'
      };
    }
    if (has('garis', 'line', 'garia') && t.match(/(-?[\d.,]+)\s*[,;]\s*(-?[\d.,]+)\s+(?:ke|sampai|to|->?)\s*(-?[\d.,]+)\s*[,;]\s*(-?[\d.,]+)/)) {
      const m = t.match(/(-?[\d.,]+)\s*[,;]\s*(-?[\d.,]+)\s+(?:ke|sampai|to|->?)\s*(-?[\d.,]+)\s*[,;]\s*(-?[\d.,]+)/);
      const f = (s) => +String(s).replace(',', '.');
      return {
        ops: [{ name: 'add_line', arguments: { a: { x: f(m[1]), y: f(m[2]) }, b: { x: f(m[3]), y: f(m[4]) } } }],
        reply: 'Garis dibuat.'
      };
    }
    if (has('pindah', 'move', 'geser')) {
      const m = t.match(/(-?[\d.,]+)\s*[,;]?\s*(-?[\d.,]+)/);
      const dx = m ? +String(m[1]).replace(',', '.') : 10;
      const dy = m ? +String(m[2]).replace(',', '.') : 0;
      if (!api.ui.selection.length) return { ops: [], reply: 'Pilih dulu objeknya, lalu minta dipindah.' };
      return { ops: [{ name: 'move_selection', arguments: { dx, dy } }], reply: 'Dipindah (' + dx + ', ' + dy + ').' };
    }
    if (has('hapus', 'delete', 'buang', 'hilangkan')) {
      if (!api.ui.selection.length) return { ops: [], reply: 'Tidak ada yang dipilih.' };
      return { ops: [{ name: 'delete_selection', arguments: {} }], reply: 'Yang dipilih dihapus (Ctrl+Z untuk batal).' };
    }
    if (has('fill', 'isi')) {
      if (!api.ui.selection.length) return { ops: [], reply: 'Pilih dulu loop, teks, atau grup untuk diatur fill-nya.' };
      if (has('abu', 'gray', 'grey')) {
        return { ops: [{ name: 'set_selection_color', arguments: { fill: 'gray' } }], reply: 'Fill abu-abu (batas material KaryaCNC) diterapkan.' };
      }
      if (has('kuning', 'yellow')) {
        return { ops: [{ name: 'set_selection_color', arguments: { fill: 'yellow' } }], reply: 'Fill kuning (balik arah offset KaryaCNC) diterapkan.' };
      }
      if (has('hapus', 'kosong', 'none', 'hilang', 'tanpa', 'clear')) {
        return { ops: [{ name: 'set_selection_color', arguments: { fill: 'none' } }], reply: 'Fill dihapus.' };
      }
    }
    if (has('warna', 'color', 'colour', 'cat')) {
      for (const name of Object.keys(COLOR_NAMES)) {
        if (t.includes(name)) {
          if (!api.ui.selection.length) {
            return { ops: [{ name: 'set_default_color', arguments: { color: COLOR_NAMES[name] } }],
              reply: 'Warna gambar berikutnya: ' + name + '.' };
          }
          return { ops: [{ name: 'set_selection_color', arguments: { color: COLOR_NAMES[name] } }],
            reply: 'Seleksi diwarnai ' + name + '.' };
        }
      }
    }
    // Not a drawing command — try the offline usage-question answer.
    const usage = answerUsage(text);
    if (usage) return { ops: [], reply: usage };
    return null;
  }

  // ---- chat flow -----------------------------------------------------------
  function bridgeUrl() {
    let set = '';
    try { set = (api.settings.aiBridgeUrl || '').trim(); } catch (err) { set = ''; }
    if (set) return set.replace(/\/+$/, '');
    // No bridge URL set: the bridge lives on the SAME server that served the
    // app (server/serve.js), so its origin is the default. file:// pages have
    // no server behind them and stay in offline mode.
    try {
      if (/^https?:$/.test(location.protocol)) return location.origin.replace(/\/+$/, '');
    } catch (err) { /* no location: offline */ }
    return '';
  }

  let _bridgeBuild = null;
  function ensureBridgeBuild() {
    if (_bridgeBuild !== null) return Promise.resolve(_bridgeBuild);
    const b = bridgeUrl();
    if (!b) { _bridgeBuild = '-'; return Promise.resolve('-'); }
    return fetch(b + '/health', { cache: 'no-cache' })
      .then(r => r.json())
      .then(j => { _bridgeBuild = (j && j.build) || '-'; return _bridgeBuild; })
      .catch(() => { _bridgeBuild = '-'; return _bridgeBuild; });
  }

  async function send(text) {
    const input = String(text == null ? '' : text).trim();
    // a stop press (Kirim becomes Stop while running) aborts the request
    if (NS.activeAbort) { NS.activeAbort.abort(); return; }
    if (!input && !(NS.pendingImages && NS.pendingImages.length)) return;
    if (!api) return;
    // Stage any attached images onto this turn, then clear the tray.
    const attached = (NS.pendingImages && NS.pendingImages.length)
      ? NS.pendingImages.slice() : null;
    NS.pendingImages = [];
    renderPending();
    pushLog('user', input || tr('chat.imageWord', '(image)'), null, attached);
    renderLog();
    const url = bridgeUrl();
    if (!url) {
      if (NS.builderMode === 'ext') {
        pushLog('ai', tr('chat.extNeedsBridge', 'Extension Builder mode requires a bridge/AI connection. Run "node server/serve.js" and open http://127.0.0.1:8090 (or set AI bridge URL in Settings).'));
        renderLog();
        return;
      }
      const parsed = parseLocal(input);
      if (parsed && parsed.ops.length) {
        const r = await applyOps(parsed.ops);
        const tail = r.errors.length ? ' (' + r.errors[0] + ')' : '';
        pushLog('ai', parsed.reply + tail, parsed.ops);
      } else if (parsed) {
        pushLog('ai', parsed.reply);
      } else {
        pushLog('ai', strVal('offlineNoEndpoint'));
      }
      renderLog();
      return;
    }
    // Agent loop: emit -> execute -> feedback (fresh state + per-op results)
    // -> verify/fix, until the model answers with no tool calls (satisfied)
    // or the round cap. One undo step total across every round.
    // The cap is user-tunable (Settings > AI chat > AI agent rounds): every
    // round is a full provider request, so fewer rounds = cheaper turns.
    const MAX_ROUNDS = Math.max(1, Math.min(8, Math.round(+api.settings.aiMaxRounds) || 4));
    // Abort handle for the Stop button: kills the fetch mid-stream without
    // killing the chat (the placeholder becomes a retryable entry).
    const ac = new AbortController();
    NS.activeAbort = ac;
    NS.setStopVisible(true);
    // ONE object for the whole turn, mutated in place: renderLog keeps a live
    // DOM reference to it, so streaming deltas update the existing nodes and
    // the thinking box keeps its scroll position while the model types.
    const liveMsg = { role: 'ai', text: '…', at: Date.now() };
    NS.log.push(liveMsg);
    NS.liveMsg = liveMsg;
    // History carries the executed op names too: when a turn stopped early
    // (round cap / Stop) and the user says "lanjutkan", the model must know
    // what it already did — not just what it said.
    const history = NS.log.filter(m => m.role !== 'sys')
      .map(m => {
        const note = (m.ops && m.ops.length)
          ? '\n[tools executed in that turn: ' + m.ops.map(o => o.name).join(', ') + ']'
          : '';
        const role = m.role === 'ai' ? 'assistant' : 'user';
        // Multimodal user turn (attached images): content is a parts array.
        if (Array.isArray(m.images) && m.images.length) {
          const parts = [{ type: 'text', text: m.text + note }];
          for (const url of m.images) {
            parts.push({ type: 'image_url', image_url: { url } });
          }
          return { role, content: parts };
        }
        return { role, content: m.text + note };
      })
      .filter(m => !(typeof m.content === 'string' && m.content.startsWith('…')));
    let lastExec = null;
    const roundLog = [];                   // compact history across rounds in this turn
    let historyPushed = false;             // guarantees ONE Undo step across all rounds
    const usageTotal = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    NS.requestedSkills = [];               // use_skill ops refill this per turn
    const think = {};                      // round -> reasoning_content
    // live progress: update the placeholder BEFORE the fetch so the user sees
    // "thinking…" immediately, and again after each round lands
    const setPhase = (t, ops) => {
      liveMsg.text = t;
      liveMsg.ops = ops || [];
      liveMsg.thinking = Object.keys(think).map(r => think[r]).join('\n---\n') || null;
      renderLog();
    };
    let waitTimer = null;
    const startWaitClock = (label) => {
      stopWaitClock();
      const t0 = Date.now();
      setPhase(label);
      waitTimer = setInterval(() => {
        const s = Math.round((Date.now() - t0) / 1000);
        liveMsg.text = label + tr('chat.waitElapsed', ' ({s}s — do not refresh, request still running)', { s });
        renderLog();
      }, 1000);
    };
    const stopWaitClock = () => { if (waitTimer) { clearInterval(waitTimer); waitTimer = null; } };
    try {
      await ensurePolicy();
      Promise.resolve(ensureBridgeBuild()).catch(() => {});
      const extMode = NS.builderMode === 'ext';
      if (extMode && P && P.ensureExtPrompt) await P.ensureExtPrompt();
      const svgMode = !extMode && NS.svgMode();
      // SVG & Extension Builder modes send no CAD tool manifest — the model
      // returns <svg> or tool JS directly (full code block in Extension mode).
      let toolManifest = [];
      if (!svgMode && P && P.toolManifest) {
        toolManifest = P.toolManifest();
      }
      for (let round = 1; round <= MAX_ROUNDS; round++) {
        // Rebuild systemMessage EVERY round so `use_skill` and fresh document
        // state take effect immediately on round 2+.
        const curState = stateSummary();
        const sysMsg = P && P.systemMessage
          ? P.systemMessage(history, curState, NS.requestedSkills || [], { svgMode, extMode })
          : null;
        // Diagnostik: pastikan system prompt TERBARU yang terkirim (bukan cache
        // lama). Mencetak panjang + 2 baris pertama; aman, tidak memuat kunci API.
        if (sysMsg && sysMsg.content) {
          const head = String(sysMsg.content).split('\n').filter(Boolean).slice(0, 2).join(' | ');
          console.log('[AI sys] round=' + round + ' len=' + sysMsg.content.length + ' head=' + JSON.stringify(head));
        }
        const messages = [...history];
        if (sysMsg) messages.unshift(sysMsg);
        if (lastExec) {
          const hasSvgQuery = Array.isArray(lastExec.queryResults) &&
            lastExec.queryResults.some(q => q && q.query === 'get_svg');
          const fbLimit = hasSvgQuery ? 64000 : 12000;
          const fbPayload = {
            executed: {
              round: lastExec.round,
              ops: lastExec.ops || [],
              made: lastExec.made,
              ids: lastExec.ids,
              errors: lastExec.errors,
              results: lastExec.results
            },
            ...(lastExec.queryResults && lastExec.queryResults.length ? { queryResults: lastExec.queryResults } : {}),
            ...(roundLog.length > 1
              ? { priorRounds: roundLog.slice(0, -1).map(r => ({
                  round: r.round,
                  ops: r.ops,
                  made: r.made,
                  errors: r.errors
                })) }
              : {}),
            state: curState
          };
          const fbJson = JSON.stringify(fbPayload);
          messages.push({
            role: 'user',
            content: '[SYSTEM FEEDBACK after your last tool calls]\n' +
              (fbJson.length > fbLimit ? fbJson.slice(0, fbLimit) + '…[truncated]' : fbJson) +
              (lastExec.errors && lastExec.errors.length
                ? '\nAn op FAILED (' + lastExec.errors[0] + '). Fix it: emit corrected tool calls.'
                : '\nAll ops succeeded and the state/queryResults above reflect the current truth. If you only needed query data, now perform the requested CAD action. If the task is complete, reply with one short summary in the user\'s language (EN/ID) and NO tool calls.')
          });
        }
        startWaitClock(lastExec
          ? tr('chat.checkingRound', 'checking round {n} results…', { n: round - 1 })
          : tr('chat.thinking', 'thinking…'));
        const tRound = performance.now();
        const payload = {
          messages,
          tools: toolManifest,
          stateSummary: curState,
          agent: { round, maxRounds: MAX_ROUNDS },
          requestedSkills: NS.requestedSkills || [],
          settings: {
            baseUrl: api.settings.aiProviderGoogle
              ? 'https://generativelanguage.googleapis.com/v1beta'
              : String(api.settings.aiApiUrl || '').trim(),
            apiKey: String(api.settings.aiApiKey || '').trim(),
            model: String(api.settings.aiModel || '').trim(),
            thinking: String(api.settings.aiThinkLevel || 'normal')
          }
        };
        const bodyStr = JSON.stringify(payload);
        console.log('[AI req] putaran ' + round + '/' + MAX_ROUNDS +
          ' · payload=' + Math.round(bodyStr.length / 1024) + 'KB · msgs=' + messages.length +
          ' · tools=' + (toolManifest || []).length +
          ' · gemini=' + ((api.settings && api.settings.aiProviderGoogle) ? 1 : 0) +
          ' · bridge=' + String(_bridgeBuild || '-'));
        const res = await fetch(url + '/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: bodyStr,
          signal: ac.signal
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error((j && j.error) || ('bridge ' + res.status));
        }
        let data = null;
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        const liveThink = {};
        let liveContent = '';
        NS._lastThinkRound = 0;   // insert the round separator once per round
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith('data:')) continue;
            let ev;
            try { ev = JSON.parse(line.slice(5)); } catch (err) { continue; }
            if (ev.error) throw new Error(ev.error);
            if (ev.delta && ev.delta.thinking) {
              if (NS._lastThinkRound !== round) {
                NS._lastThinkRound = round;
                if (liveMsg.thinking) liveMsg.thinking += '\n---\n';
              }
              liveThink[round] = (liveThink[round] || '') + ev.delta.thinking;
              think[round] = liveThink[round];
              liveMsg.thinking = (liveMsg.thinking || '') + ev.delta.thinking;
              if (!liveContent && (!liveMsg.text || liveMsg.text === '…')) liveMsg.text = tr('chat.thinking', 'thinking…');
              scheduleThinkFlush();
            } else if (ev.delta && ev.delta.content) {
              stopWaitClock();
              liveContent += ev.delta.content;
              liveMsg.text = liveContent;
              scheduleThinkFlush();
            } else if (ev.done) {
              data = ev;
            }
          }
        }
        stopWaitClock();
        if (!data) throw new Error('bridge stream ended without a final event');
        if (data.usage && typeof data.usage === 'object') {
          usageTotal.prompt_tokens += +data.usage.prompt_tokens || 0;
          usageTotal.completion_tokens += +data.usage.completion_tokens || 0;
          usageTotal.total_tokens += +data.usage.total_tokens || 0;
        }
        const calls = (data.tool_calls || []).map(tc => ({ name: tc.name, arguments: tc.arguments || {} }));
        console.log('[AI done] replyLen=' + String((data.reply || '')).length +
          ' · replyHead=' + JSON.stringify(String(data.reply || '').slice(0, 80)) +
          ' · tool_calls=' + calls.length +
          ' · finishReason=' + String(data.finishReason || '-') +
          ' · usage=' + (usageTotal.total_tokens || 0));
        console.log('[AI stream] putaran ' + round + '/' + MAX_ROUNDS + ' selesai dalam ' +
          Math.round(performance.now() - tRound) + 'ms · tool_calls=' + calls.length +
          ' · thinking=' + Math.round((liveMsg.thinking || '').length / 1024) + 'KB');
        for (const c of calls) {
          console.log('[AI call]', c.name, JSON.stringify(c.arguments || {}).slice(0, 600));
        }
        const roundThink = String(data.thinking || '');
        if (roundThink) think[round] = roundThink;
        if (!calls.length) {
          liveMsg.rounds = round;
          if (usageTotal.total_tokens > 0) liveMsg.usage = { ...usageTotal };
          const replyTxt = String((data.reply || tr('chat.done', 'Done.')).trim());
          setPhase(replyTxt);
          // Extension mode: an AI "Done" without extractable code usually means
          // the reply was truncated (max output / content filter) — detect the
          // most common signal: an unclosed code fence.
          if (NS.builderMode === 'ext') {
            if (!extractExtensionCode(replyTxt)) {
              liveMsg.noExtCode = true;
              const fences = (replyTxt.match(/```/g) || []).length;
              const foreignToolCalls = /<tool_call>|<\/tool_call>|<arg_key>|(?:^|\s)(?:read|grep|bash|ls|cat|find|pwd|curl|cd)\s*[<(]/.test(replyTxt);
              liveMsg.truncated = (fences % 2 === 1);
              liveMsg.foreignToolCalls = foreignToolCalls;
              console.log('[AI] no ext code in reply · finishReason=' + String(data.finishReason || '-') +
                ' · fences=' + fences + ' · foreignToolCalls=' + foreignToolCalls +
                ' · replyLen=' + replyTxt.length);
              if (liveMsg.truncated && api && api.toast) {
                api.toast(tr('chat.extTruncWarn', 'Warning: the AI reply looks truncated (code fence unclosed) — auto-continuing…'));
              }
              if (foreignToolCalls && api && api.toast) {
                api.toast(tr('chat.extForeignToolWarn', 'Warning: the AI reply contains foreign tool calls (read/grep/bash). It has no file access — auto-correction sent.'));
              }
              // Auto-continue ONCE per continue-prompt: ask the model to resend
              // the COMPLETE code so a mid-reply cut / foreign-tool drift is
              // repaired automatically.
              const needsAutoCont = (liveMsg.truncated || foreignToolCalls) && input !== NS._lastAutoContSig;
              if (needsAutoCont) {
                NS._lastAutoContSig = input;
                const reason = foreignToolCalls ? 'foreign-tool-call drift' : 'truncation';
                const contPrompt = curLang() === 'id'
                  ? ('Balasanmu tampak ' + reason + ' dan kamu TIDAK punya akses file/tool luar. Kirim ulang SATU blok kode ekstensi LENGKAP ```js ... ``` (tertutup) tanpa `tool_call` apa pun.')
                  : ('Your reply appears to contain ' + reason + ' — you have NO file access or foreign tools. Resend ONE complete, closed ```js ... ``` extension code block, with no tool_call tags.');
                setTimeout(() => send(contPrompt), 60);
              }
            }
          }

          liveMsg.toolCalls = roundLog.flatMap(r => r.calls || []);
          markDone(liveMsg);
          break;
        }
        setPhase(tr('chat.executingOps', 'executing {n} op(s) (round {r}/{max})…', { n: calls.length, r: round, max: MAX_ROUNDS }), calls);        const r = await applyOps(calls, { noHistory: historyPushed });
        if (r.pushedHistory) historyPushed = true;
        lastExec = {
          round,
          ops: calls.map(c => c.name),
          made: r.made,
          ids: r.ids || [],
          queryResults: r.queryResults || [],
          errors: r.errors || [],
          results: r.results || []
        };
        roundLog.push({
          round,
          ops: calls.map(c => c.name),
          calls: calls.map((c, ci) => {
            const rr = (r.results && r.results[ci]) || {};
            const qr = (r.queryResults && r.queryResults[ci]) || {};
            let snippet = '';
            try { snippet = String(qr.result == null ? '' : qr.result).slice(0, 160); } catch (e) {}
            return {
              name: c.name,
              args: c.arguments || {},
              ok: !!rr.ok,
              error: rr.error || '',
              snippet
            };
          }),
          made: r.made,
          ids: (r.ids || []).slice(0, 20),
          errors: (r.errors || []).slice(0, 3)
        });
        const statusTxt = r.errors.length
          ? tr('chat.roundErr', 'error: {err}', { err: r.errors[0] })
          : tr('chat.roundOk', 'ok');
        setPhase(tr('chat.verifyingRound', 'round {r}/{max}: {made} op, {status} — verifying…', { r: round, max: MAX_ROUNDS, made: r.made, status: statusTxt }), calls);
        if (round === MAX_ROUNDS) {
          liveMsg.rounds = round;
          if (usageTotal.total_tokens > 0) liveMsg.usage = { ...usageTotal };
          const errPart = r.errors.length ? (', ' + tr('chat.roundErr', 'error: {err}', { err: r.errors[0] })) : '';
          setPhase(tr('chat.stoppedLimit',
            'Stopped at the {max}-round limit. Last: {made} op{errPart}. Type "continue" to proceed, or press Retry to start over.',
            { max: MAX_ROUNDS, made: r.made, errPart }), calls);
          liveMsg.retryText = input;   // Retry re-runs the whole request
          liveMsg.toolCalls = roundLog.flatMap(r => r.calls || []);
          markDone(liveMsg);
        }
      }
    } catch (err) {
      stopWaitClock();
      if (ac.signal.aborted) {
        // user pressed Stop: keep what the model was thinking, keep it
        // retryable — one click resends the exact same request
        liveMsg.text = tr('chat.stopped', 'Stopped.') +
          (liveMsg.thinking ? tr('chat.stoppedThoughts', ' (last thoughts saved above)') : '');
        liveMsg.retryText = input;
        liveMsg.ops = [];
        markDone(liveMsg);
      } else {
        // keep the failing turn retryable: remember what the user asked
        liveMsg.text = strVal('errorPrefix') + (err && err.message || err) + strVal('errorHint');
        liveMsg.retryText = input;
        liveMsg.ops = [];
        markDone(liveMsg);
      }
    }
    NS.activeAbort = null;
    NS.setStopVisible(false);
    NS.liveMsg = null;   // the turn is finished: the next render is a full rebuild
    renderLog();
    scheduleSave();      // persist the finished turn (text + images) right away
  }

  // ---- panel ---------------------------------------------------------------
  // The History tab shows only archived SESSIONS (no message content); the input
  // row and image tray belong to the Chat tab, so they hide in History mode.
  function setChatInputVisible(on) {
    const row = document.getElementById('chat-input-row');
    const tray = document.getElementById('chat-pending');
    const dock = document.getElementById('chat-ext-dock');
    if (row) row.hidden = !on;
    if (tray) tray.hidden = !on || !(NS.pendingImages && NS.pendingImages.length);
    if (!on && dock) dock.hidden = true;
    // Chat-only chrome: model row and the mode combo + New Session bar. The
    // History tab is purely the archived-session list, so these are hidden
    // there (the input row above already hides textarea + attach + Send).
    ['chat-model-row', 'chat-builder-bar'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.hidden = !on;
    });
  }
  function renderSessions(host) {
    host.innerHTML = '';
    if (!NS.meta.length) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="muted">' + escapeHtml(tr('chat.emptyHistory', 'No archived sessions yet — press New Session to move the current conversation to History.')) + '</span>';
      host.appendChild(li);
      return;
    }
    const loc = curLang() === 'id' ? 'id-ID' : 'en-US';
    for (const s of NS.meta) {
      const li = document.createElement('li');
      li.className = 'chat-session clickable';
      li.title = tr('chat.resumeSession', 'Click to resume this session');
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = s.title;
      const meta = document.createElement('span');
      meta.className = 'meta';
      const d = s.at ? new Date(s.at) : null;
      const dateStr = d ? d.toLocaleString(loc, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
      meta.textContent = (s.count != null ? tr('chat.msgCount', '{n} messages', { n: s.count }) : '') +
        (s.img ? ' · 🖼' : '') +
        (dateStr ? ' · ' + dateStr : '');
      const del = document.createElement('button');
      del.className = 'mini-del';
      del.textContent = '×';
      del.title = tr('chat.deleteHistory', 'Delete from History');
      del.addEventListener('click', (ev) => {
        ev.stopPropagation();
        deleteArchivedSession(s.id).then(refreshMeta);
      });
      li.appendChild(name);
      li.appendChild(meta);
      li.appendChild(del);
      li.addEventListener('click', () => {
        // archive whatever is running now first (same rule as New), then move
        // the clicked session back to running
        archiveCurrentSession().then(() => resumeSession(s.id)).then(ok => {
          if (!ok) { refreshMeta(); return; }
          setTab('chat');
          renderLog();
        });
      });
      host.appendChild(li);
    }
  }
  const THINK_PARAS = 2;
  const THINK_MAX_CHARS = 8000;
  function thinkCutNote() {
    return tr('chat.thinkCutNote', '[… earlier thinking was trimmed — only the last 2 paragraphs are shown]\n');
  }
  function thinkDisplay(s) {
    s = String(s || '');
    if (!s) return { text: '', cut: false };
    let cut = false;
    let out = s;
    const paras = s.split(/\n{2,}/);
    if (paras.length > THINK_PARAS) {
      out = paras.slice(-THINK_PARAS).join('\n\n');
      cut = true;
    }
    if (out.length > THINK_MAX_CHARS) {
      out = out.slice(-THINK_MAX_CHARS);
      cut = true;
    }
    return { text: out, cut };
  }
  let _thinkFlush = null;
  function scheduleThinkFlush() {
    if (_thinkFlush) return;
    _thinkFlush = setTimeout(() => {
      _thinkFlush = null;
      renderLog();
    }, 100);
  }

  function getExtDock() {
    let dock = document.getElementById('chat-ext-dock');
    if (dock) return dock;
    const row = document.getElementById('chat-input-row');
    if (row && row.parentNode && typeof row.parentNode.insertBefore === 'function') {
      dock = document.createElement('div');
      dock.id = 'chat-ext-dock';
      dock.className = 'chat-ext-dock';
      dock.hidden = true;
      const tray = document.getElementById('chat-pending');
      const anchor = (tray && tray.parentNode === row.parentNode) ? tray : row;
      row.parentNode.insertBefore(dock, anchor);
      return dock;
    }
    return null;
  }

  const DOCK_DRAFT_KEY = 'minisketch.chat.dockDraft';
  function saveDockDraft(code) {
    try {
      localStorage.setItem(DOCK_DRAFT_KEY, JSON.stringify({ code: String(code || ''), at: Date.now() }));
    } catch (e) { /* ignore */ }
  }
  function loadDockDraft() {
    try {
      const raw = localStorage.getItem(DOCK_DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && typeof d.code === 'string') return d.code;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function extVersions(items) {
    const out = [];
    for (const m of items || []) {
      // Include the embedded code from "Edit with AI" user messages too, so the
      // testing dock appears immediately — even before anything is sent to AI.
      if (m && (m.role === 'ai' || m.role === 'user')) {
        const code = extractExtensionCode(m.text);
        if (code) out.push({ msg: m, code });
      }
    }
    return out;
  }

  // The extension version currently shown in the testing dock: newest by
  // default, or the user-selected rollback target (NS.extSelIdx).
  function currentExtEntry(items) {
    const versions = extVersions(items || []);
    if (!versions.length) return null;
    let idx = (NS.extSelIdx == null) ? versions.length - 1 : NS.extSelIdx;
    if (idx < 0 || idx >= versions.length) idx = versions.length - 1;
    return versions[idx];
  }

  function renderExtDock(items) {
    const dock = getExtDock();
    if (!dock) return;
    const versions = extVersions(items || []);
    if (!versions.length) {
      NS._lastExtTotal = 0;
      dock.hidden = false;
      const sig = 'empty::' + curLang();
      if (dock._dockSig === sig && dock.children && dock.children.length) return;
      dock.innerHTML = '';
      // Optional warning when the last AI turn finished without any code.
      let lastAi = null;
      for (let i = (items || []).length - 1; i >= 0; i--) {
        if (items[i] && items[i].role === 'ai') { lastAi = items[i]; break; }
      }
      if (lastAi && lastAi.done && !extractExtensionCode(lastAi.text || '')) {
        const bar = document.createElement('div');
        bar.className = 'chat-ext-vers is-warn';
        const info = document.createElement('span');
        info.className = 'chat-ext-vers-info';
        info.textContent = lastAi.truncated
          ? tr('chat.extNoCodeTrunc', 'AI finished WITHOUT extension code — reply looks truncated (fence unclosed). The code may be incomplete.')
          : tr('chat.extNoCode', 'AI finished WITHOUT extension code. It may have answered in prose — ask again or use Continue.');
        bar.appendChild(info);
        dock.appendChild(bar);
      }
      // Always show an editable source card — paste code even when empty.
      // Restore the last draft after a refresh so edits are not lost.
      appendExtensionBlock(dock, null, loadDockDraft() || '', true);
      dock._dockSig = sig;
      return;
    }
    // A new version was generated (or the history changed): always show the
    // LATEST result by default — only an explicit prev/next pin overrides it,
    // and that pin is dropped again when the next version arrives.
    if (NS._lastExtTotal !== versions.length) {
      NS._lastExtTotal = versions.length;
      NS.extSelIdx = null;
    }
    let idx = (NS.extSelIdx == null) ? versions.length - 1 : NS.extSelIdx;
    if (idx < 0 || idx >= versions.length) idx = versions.length - 1;
    const ver = versions[idx];
    const pinned = idx < versions.length - 1;
    dock.hidden = false;
    const sig = ver.code + '::' + idx + '::' + (pinned ? 1 : 0) + '::' +
      (NS.activeAbort ? 1 : 0) + '::' + curLang();
    if (dock._dockSig === sig && dock.children && dock.children.length) return;
    dock.innerHTML = '';
    const bar = document.createElement('div');
    bar.className = 'chat-ext-vers' + (pinned ? ' is-pinned' : '');
    const info = document.createElement('span');
    info.className = 'chat-ext-vers-info';
    info.textContent = (pinned
      ? tr('chat.extVersionOld', 'Extension code v{cur}/{total} — OLD (rollback)', { cur: idx + 1, total: versions.length })
      : tr('chat.extVersionNew', 'Extension code v{cur}/{total} — latest', { cur: idx + 1, total: versions.length }));
    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'btn small';
    prev.textContent = '‹ ' + tr('chat.extPrev', 'prev');
    prev.disabled = idx === 0;
    prev.title = tr('chat.extPrevTitle', 'Roll back to the previous AI-generated version');
    prev.addEventListener('click', () => {
      NS.extSelIdx = Math.max(0, idx - 1);
      renderLog();
    });
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'btn small';
    next.textContent = tr('chat.extNext', 'next') + ' ›';
    next.disabled = idx === versions.length - 1;
    next.title = tr('chat.extNextTitle', 'Move forward to a newer AI-generated version');
    next.addEventListener('click', () => {
      NS.extSelIdx = Math.min(versions.length - 1, idx + 1);
      renderLog();
    });
    const latestBtn = document.createElement('button');
    latestBtn.type = 'button';
    latestBtn.className = 'btn small';
    latestBtn.textContent = tr('chat.extLatest', 'latest');
    latestBtn.disabled = !pinned;
    latestBtn.title = tr('chat.extLatestTitle', 'Jump to the newest AI-generated version');
    latestBtn.addEventListener('click', () => {
      NS.extSelIdx = null;
      renderLog();
    });
    bar.appendChild(info);
    bar.appendChild(prev);
    bar.appendChild(next);
    bar.appendChild(latestBtn);
    dock.appendChild(bar);
    appendExtensionBlock(dock, ver.msg, ver.code);
    dock._dockSig = sig;
  }

  function formatMessageHtml(m, isLatestExt) {
    const who = m.role === 'user' ? '<b>you</b>' : m.role === 'ai' ? '<b>ai</b>' : '<b class="muted">sys</b>';
    const body = String(m.text == null ? '' : m.text);
    let html;
    if (m.role === 'ai' && extractExtensionCode(body)) {
      const hasReg = (s) =>
        /(?:MiniSketchTools|NS)\s*\.\s*register\s*\(/.test(s) ||
        (/\bMiniSketchTools\b/.test(s) && /\.register\s*\(/.test(s));
      const hadFence = /```(?:js|javascript|ts)?\s*\n[\s\S]*?```/i.test(body);
      let stripped = hadFence
        ? body.replace(/```(?:js|javascript|ts)?\s*\n([\s\S]*?)```/gi, (full, inner) => (hasReg(inner) ? '' : full))
        : '';
      stripped = stripped.replace(/\n{3,}/g, '\n\n').trim();
      const note = isLatestExt
        ? '<span class="muted">' + escapeHtml(tr('chat.extNoteLatest', '[This version is shown in the testing panel below]')) + '</span>'
        : '<span class="muted">' + escapeHtml(tr('chat.extNotePrev', '[Previous version — roll back with prev/next below]')) + '</span>';
      html = who + (stripped ? (' ' + escapeHtml(stripped).replace(/\n/g, '<br>') + '<br>' + note) : (' ' + note));
    } else {
      html = who + ' ' + escapeHtml(body).replace(/\n/g, '<br>');
    }
    if (m.ops && m.ops.length) {
      html += '<br><span class="muted">' + m.ops.map(o => escapeHtml(o.name)).join(', ') + '</span>';
    }
    return html;
  }

  function renderLog() {
    const host = document.getElementById('chat-log');
    const count = document.getElementById('chat-count');
    if (!host) return;
    if (NS.mode === 'log') {
      if (count) count.textContent = String(NS.meta.length);
      NS.liveMsg = null;
      setChatInputVisible(false);
      renderSessions(host);
      return;
    }
    if (count) count.textContent = String(NS.log.length);
    setChatInputVisible(true);
    // the streaming turn is over (or spliced away by a retry): drop the ref
    if (NS.liveMsg && NS.log[NS.log.length - 1] !== NS.liveMsg) NS.liveMsg = null;
    // LIVE PATH
    if (NS.liveMsg && NS.liveRefs && NS.liveRefs.li.isConnected) {
      const m = NS.liveMsg;
      const who = m.role === 'user' ? '<b>you</b>' : m.role === 'ai' ? '<b>ai</b>' : '<b class="muted">sys</b>';
      let html = who + ' ' + escapeHtml(m.text).replace(/\n/g, '<br>');
      if (m.ops && m.ops.length) html += '<br><span class="muted">' + m.ops.map(o => escapeHtml(o.name)).join(', ') + '</span>';
      NS.liveRefs.text.innerHTML = html;
      if (NS.liveRefs.body) {
        const disp = thinkDisplay(m.thinking);
        if (disp.text !== NS.liveRefs.lastThink) {
          NS.liveRefs.body.textContent = (disp.cut ? thinkCutNote() : '') + disp.text;
          NS.liveRefs.lastThink = disp.text;
        }
        if (NS.liveRefs.det) NS.liveRefs.det.open = !!(NS.thinkOpen && NS.thinkOpen.has(m));
        stickToBottom(NS.liveRefs.body);
      }
      stickToBottom(host);
      return;
    }
    host.innerHTML = '';
    const items = NS.log.filter(m => m.role !== 'sys');
    renderExtDock(items);
    if (!items.length) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="muted">' + escapeHtml(tr('chat.emptyLog', 'Ask or describe something… e.g. "100x60 box at 0,0", "4x d5 holes in the corners", "build a 120x80x60 box tool".')) + '</span>';
      host.appendChild(li);
      return;
    }
    const latestExt = currentExtEntry(items);
    const fmtTok = (n) => n >= 1000 ? (Math.round(n / 100) / 10) + 'k' : String(n);
    let forkPlaced = false;
    for (const m of items.slice(-60)) {
      const li = document.createElement('li');
      if (m.role === 'user') li.classList.add('chat-user');
      else if (m.role === 'ai') li.classList.add('chat-ai');
      const html = formatMessageHtml(m, !!(latestExt && latestExt.msg === m));
      const textSpan = document.createElement('span');
      textSpan.innerHTML = html;
      li.appendChild(textSpan);
      if (m.role === 'user' && !forkPlaced) {
        li.appendChild(makeForkButton());
        forkPlaced = true;
      }
      if (m.role === 'ai' && m.done) {
        const parts = [];
        if (m.rounds && m.rounds > 1) parts.push(tr('chat.roundsMeta', '{n} rounds', { n: m.rounds }));
        if (m.usage && m.usage.total_tokens > 0) parts.push(tr('chat.tokensMeta', '{n} tokens', { n: fmtTok(m.usage.total_tokens) }));
        if (parts.length) {
          const meta = document.createElement('span');
          meta.className = 'chat-meta';
          meta.textContent = parts.join(' · ');
          li.appendChild(meta);
        }
      }
      appendImageThumbs(li, m);
      if (m.role === 'ai') appendToolCallsBlock(li, m);
      if (m.role === 'ai' && !extractExtensionCode(m.text) && (NS.svgMode() || /<svg[\s\S]*?<\/svg>/i.test(m.text))) appendSvgBlock(li, m);
      if (m.thinking) {
        NS.thinkOpen = NS.thinkOpen || new WeakSet();
        const det = document.createElement('details');
        det.className = 'chat-think';
        det.open = !!NS.thinkOpen.has(m);
        const sum = document.createElement('summary');
        sum.textContent = tr('chat.modelThinking', 'model thinking ({n} rounds)', { n: m.thinking.split(/\n-{3,}\n/).length });
        sum.addEventListener('click', () => {
          if (det.open) NS.thinkOpen.add(m); else NS.thinkOpen.delete(m);
        });
        const body = document.createElement('div');
        body.className = 'chat-think-body';
        const disp = thinkDisplay(m.thinking);
        body.textContent = (disp.cut ? thinkCutNote() : '') + disp.text;
        det.appendChild(sum);
        det.appendChild(body);
        li.insertBefore(det, textSpan);
        if (m === NS.liveMsg) {
          NS.liveRefs = { li, det, sum, body, text: textSpan, lastThink: disp.text };
          stickToBottom(body);
        }
      } else if (m === NS.liveMsg) {
        NS.liveRefs = { li, det: null, sum: null, body: null, text: textSpan, lastThink: '' };
      }
      if (m.retryText && NS.mode === 'chat') {
        li.classList.add('chat-error');
        const retry = document.createElement('button');
        retry.className = 'btn small chat-retry';
        retry.textContent = tr('chat.retry', 'Retry');
        retry.title = tr('chat.retryTitle', 'Resend the last prompt');
        retry.addEventListener('click', () => {
          const at = NS.log.indexOf(m);
          if (at >= 0) {
            const userEntry = NS.log[at - 1];
            const from = userEntry && userEntry.role === 'user' ? at - 1 : at;
            const imgs = userEntry && Array.isArray(userEntry.images) && userEntry.images.length
              ? userEntry.images.slice() : null;
            NS.log.splice(from, NS.log.length - from);
            if (imgs) NS.pendingImages = imgs;
          }
          scheduleSave();
          send(m.retryText);
        });
        li.appendChild(retry);
      }
      host.appendChild(li);
    }
    host.scrollTop = host.scrollHeight;
  }

  // Roll back the last exchange: remove the newest user+AI pair (or just the
  // newest user message if no answer arrived yet) and put that prompt back into
  // the input box so the user can edit and resend it. Images attached to that
  // prompt (if any) are restored to the pending tray.
  // ALSO reloads the system prompt cache (P.reload()) — the user's workflow is
  // "edit the prompt files, then rollback + resend", so the next send must use
  // the CURRENT prompt files, never a stale cached copy.
  function rollbackLastTurn() {
    if (NS.activeAbort) return false;
    const items = NS.log.filter(m => m.role !== 'sys');
    if (!items.length) return false;
    const last = items[items.length - 1];
    let promptText = '';
    let restoreImgs = null;
    if (last.role === 'ai') {
      NS.log.splice(NS.log.indexOf(last), 1);
      const prevItems = NS.log.filter(m => m.role !== 'sys');
      const prev = prevItems[prevItems.length - 1];
      if (prev && prev.role === 'user') {
        promptText = String(prev.text || '');
        if (Array.isArray(prev.images) && prev.images.length) restoreImgs = prev.images.slice();
        NS.log.splice(NS.log.indexOf(prev), 1);
      }
    } else if (last.role === 'user') {
      promptText = String(last.text || '');
      if (Array.isArray(last.images) && last.images.length) restoreImgs = last.images.slice();
      NS.log.splice(NS.log.indexOf(last), 1);
    } else {
      return false;
    }
    // Drop cached policy/system-prompt assets so the next send refetches them
    // (same as the Fork button does).
    try {
      if (window.MiniSketchAIPrompt && window.MiniSketchAIPrompt.reload) {
        window.MiniSketchAIPrompt.reload();
      }
    } catch (e) { /* reload is best-effort */ }
    NS.liveMsg = null;
    NS.liveRefs = null;
    if (restoreImgs) NS.pendingImages = restoreImgs;
    scheduleSave();
    renderPending();
    renderLog();
    const inp = document.getElementById('chat-input');
    if (inp) {
      inp.value = promptText;
      if (typeof inp.dispatchEvent === 'function') {
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      }
      try { inp.focus(); } catch (e) {}
    }
    return true;
  }

  function appendToolCallsBlock(li, m) {
    const calls = (m.toolCalls || []);
    if (!calls.length) return;
    const det = document.createElement('details');
    det.className = 'chat-toolcalls';
    const sum = document.createElement('summary');
    sum.textContent = tr('chat.toolCalls', 'tool calls ({n})', { n: calls.length });
    det.appendChild(sum);
    const body = document.createElement('div');
    body.className = 'chat-toolcalls-body';
    for (const c of calls) {
      const row = document.createElement('div');
      row.className = 'chat-toolcall' + (c.ok ? ' is-ok' : ' is-err');
      const nm = document.createElement('b');
      nm.textContent = c.name;
      row.appendChild(nm);
      const ar = document.createElement('code');
      try { ar.textContent = JSON.stringify(c.args).slice(0, 200); } catch (e) {}
      row.appendChild(ar);
      if (c.error) {
        const er = document.createElement('span');
        er.className = 'muted';
        er.textContent = ' ✗ ' + c.error;
        row.appendChild(er);
      }
      if (c.snippet) {
        const sn = document.createElement('pre');
        sn.textContent = c.snippet;
        row.appendChild(sn);
      }
      body.appendChild(row);
    }
    det.appendChild(body);
    li.appendChild(det);
  }

  function makeForkButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn small chat-fork';
    btn.textContent = tr('chat.fork', 'Fork');
    btn.title = tr('chat.forkTitle', 'Fork: start a new session with ONLY the first prompt (text + image), reload the latest system prompt, and place it into the input box to edit — press Enter to send. Current session moves to History.');
    btn.addEventListener('click', () => {
      if (NS.activeAbort) return;
      const firstUser = NS.log.find(m => m && m.role === 'user');
      if (!firstUser) return;
      const seedText = String(firstUser.text || '');
      const seedImages = (Array.isArray(firstUser.images) && firstUser.images.length)
        ? firstUser.images.slice()
        : null;
      archiveCurrentSession().then(() => {
        NS.log = [];
        NS.sessionId = newSessionId();
        NS.sessionAt = Date.now();
        lsSet(CURRENT_ID_KEY, NS.sessionId);
        NS.pendingImages = seedImages || [];
        renderPending();
        setTab('chat');
        renderLog();
        scheduleSave();
        // Muat ulang policy (system prompt) supaya session baru memakai prompt
        // TERBARU — bukan versi ter-cache dari sesi lama.
        const reload = (window.MiniSketchAIPrompt && window.MiniSketchAIPrompt.reload)
          ? window.MiniSketchAIPrompt.reload()
          : Promise.resolve(null);
        Promise.resolve(reload).then(() => {
          const inp = document.getElementById('chat-input');
          if (inp) {
            inp.value = seedText;        // draft: user tinggal edit lalu Enter
            inp.focus();
          }
        });
      });
    });
    return btn;
  }

  // In-app lightbox overlay for attached images & SVG previews (never calls window.open).
  let _lightboxEl = null;
  function closeLightbox() {
    if (_lightboxEl) _lightboxEl.hidden = true;
  }
  function openLightbox(src, title) {
    if (!src || typeof document === 'undefined') return;
    if (!_lightboxEl) {
      const ov = document.createElement('div');
      ov.id = 'chat-lightbox';
      ov.className = 'chat-lightbox';
      ov.setAttribute('role', 'dialog');
      ov.setAttribute('aria-modal', 'true');
      const card = document.createElement('div');
      card.className = 'chat-lightbox-card';
      const head = document.createElement('div');
      head.className = 'chat-lightbox-head';
      const cap = document.createElement('span');
      cap.className = 'chat-lightbox-cap';
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'btn small';
      closeBtn.textContent = tr('chat.lightboxClose', '× Close');
      closeBtn.addEventListener('click', closeLightbox);
      head.appendChild(cap);
      head.appendChild(closeBtn);
      const img = document.createElement('img');
      img.className = 'chat-lightbox-img';
      card.appendChild(head);
      card.appendChild(img);
      ov.appendChild(card);
      ov.addEventListener('click', (ev) => { if (ev.target === ov) closeLightbox(); });
      document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape' && _lightboxEl && !_lightboxEl.hidden) closeLightbox();
      });
      document.body.appendChild(ov);
      _lightboxEl = ov;
    }
    const imgEl = _lightboxEl.querySelector('.chat-lightbox-img');
    const capEl = _lightboxEl.querySelector('.chat-lightbox-cap');
    const closeBtnEl = _lightboxEl.querySelector('button');
    if (closeBtnEl) closeBtnEl.textContent = tr('chat.lightboxClose', '× Close');
    if (imgEl) { imgEl.src = src; imgEl.alt = title || 'preview'; }
    if (capEl) capEl.textContent = title || tr('chat.preview', 'Preview');
    _lightboxEl.hidden = false;
  }

  function isLoopbackHost() {
    const h = String(location && location.hostname || '').toLowerCase();
    if (h === 'localhost' || h === '[::1]' || h === '::1' || h === '127.0.0.1') return true;
    const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (m) {
      const a = +m[1], b = +m[2];
      if (a === 10) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
    }
    return false;
  }

  // Persist the extension source to the server's disk (loopback only). Returns
  // {ok} — used so AI-built tools survive browser storage being cleared.
  async function saveExtensionToDisk(code, meta) {
    try {
      if (!isLoopbackHost()) return { ok: false, error: 'loopback only' };
      const res = await fetch('api/extensions/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: (meta && meta.id) || 'custom-tool',
          label: (meta && (meta.label || meta.name)) || 'Custom Tool',
          code: String(code || '')
        })
      });
      const j = await res.json().catch(() => ({}));
      return j || { ok: false, error: 'bad response' };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  }

  async function copyTextToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) { /* fall back to textarea */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch (err) {
      return false;
    }
  }

  // Inline thumbnails for a turn's attached images.
  function appendImageThumbs(li, m) {
    if (!m || !Array.isArray(m.images) || !m.images.length) return;
    const row = document.createElement('div');
    row.className = 'chat-images';
    for (const src of m.images) {
      const img = document.createElement('img');
      img.className = 'chat-thumb';
      img.src = src;
      img.alt = tr('chat.attachedImgAlt', 'attached image');
      img.title = tr('chat.clickEnlarge', 'Click to enlarge');
      img.addEventListener('click', () => openLightbox(src, tr('chat.attachedImgCap', 'Attached image')));
      row.appendChild(img);
    }
    li.appendChild(row);
  }

  // ---- SVG mode -----------------------------------------------------------
  // Extract the first complete <svg>…</svg> from an AI reply.
  function extractSvg(text) {
    const m = String(text == null ? '' : text).match(/<svg[\s\S]*?<\/svg>/i);
    return m ? m[0] : null;
  }

  // Insert a pasted SVG into the worksheet, the same way the executor's
  // import_svg does (one undo step, real editable text for <text>).
  // Placement: top-RIGHT of the current workspace content + 20mm gap to the
  // right, so repeated inserts never pile up on top of existing geometry.
  async function importUserSvg(svgText) {
    if (typeof api.svgImportParse !== 'function' || typeof api.svgImportInsert !== 'function') return -1;
    try {
      if (window.MiniSketchFonts) {
        try {
          await Promise.all([
            window.MiniSketchFonts.load('Liberation Sans', 400, 'normal'),
            window.MiniSketchFonts.load('Liberation Serif', 400, 'normal')
          ]);
        } catch (err) { /* ignore */ }
      }
      const ir = api.svgImportParse(svgText, {
        prefix: 'svgpaste' + Date.now().toString(36) + '-',
        flipY: true
      });
      if (!ir.items || !ir.items.length) return 0;
      const bb = ir.bounds || null;
      let center = null;
      try {
        const ws = api.contentBounds ? api.contentBounds() : null;
        if (ws && bb && isFinite(bb.maxX)) {
          const w = bb.maxX - bb.minX;
          const h = bb.maxY - bb.minY;
          const right = isFinite(ws.maxX) ? ws.maxX : 0;
          const top = isFinite(ws.minY) ? ws.minY : 0;
          center = { x: right + 20 + w / 2, y: top + h / 2 };
        }
      } catch (err) { /* fall back to default placement */ }
      api.pushHistory();
      const made = api.svgImportInsert(ir, {
        keepGroups: true,
        textMode: 'text',
        ...(center ? { center } : {})
      });
      api.commit();
      const ids = (made && made.entities) || [];
      if (ids.length) api.ui.selection = ids.map(id => ({ kind: 'entity', id }));
      return ids.length;
    } catch (err) {
      return -2;
    }
  }

  function appendSvgBlock(li, m) {
    const svg = extractSvg(m.text);
    if (!svg) return;
    const row = document.createElement('div');
    row.className = 'chat-svg';
    const img = document.createElement('img');
    try { img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); }
    catch (err) { return; }
    img.className = 'chat-svg-preview';
    img.alt = 'SVG preview';
    img.title = tr('chat.svgPreviewTitle', 'SVG preview — click to enlarge');
    img.addEventListener('click', () => openLightbox(img.src, 'SVG Preview'));
    const actions = document.createElement('div');
    actions.className = 'chat-svg-actions';
    const status = document.createElement('span');
    status.className = 'muted chat-svg-status';
    const paste = document.createElement('button');
    paste.type = 'button';
    paste.className = 'btn small';
    paste.textContent = tr('chat.insertWorkspace', 'Insert to workspace');
    paste.title = tr('chat.insertWorkspaceTitle', 'Import this SVG to the worksheet: top-right of current content + 20mm right gap (one Undo)');
    paste.addEventListener('click', async () => {
      const n = await importUserSvg(svg);
      if (n > 0) {
        status.textContent = tr('chat.svgInserted', '✓ {n} objects inserted (top-right + 20mm).', { n });
        try { api.render && api.render(); } catch (err) { /* ignore */ }
      } else if (n === 0) {
        status.textContent = tr('chat.svgNone', 'No vector shapes were recognized.');
      } else {
        status.textContent = tr('chat.svgFail', 'Import failed (invalid SVG?).');
      }
    });
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn small';
    copyBtn.textContent = tr('chat.copySvg', 'Copy SVG');
    copyBtn.title = tr('chat.copySvgTitle', 'Copy the <svg> code to the clipboard');
    copyBtn.addEventListener('click', async () => {
      const ok = await copyTextToClipboard(svg);
      status.textContent = ok
        ? tr('chat.svgCopied', '✓ SVG copied to clipboard.')
        : tr('chat.svgCopyFail', 'Failed to copy SVG.');
    });
    actions.appendChild(paste);
    actions.appendChild(copyBtn);
    row.appendChild(img);
    row.appendChild(actions);
    row.appendChild(status);
    li.appendChild(row);
  }

  // ---- AI Extension Builder mode -----------------------------------------
  function extractExtensionCode(text) {
    const raw = String(text == null ? '' : text);
    const hasReg = (s) =>
      /(?:MiniSketchTools|NS)\s*\.\s*register\s*\(/.test(s) ||
      (/\bMiniSketchTools\b/.test(s) && /\.register\s*\(/.test(s));
    if (!hasReg(raw)) return null;
    const blocks = [];
    const fenceRe = /```(?:js|javascript|ts)?\s*\n([\s\S]*?)```/gi;
    let m;
    while ((m = fenceRe.exec(raw)) !== null) {
      if (hasReg(m[1])) blocks.push(m[1].trim());
    }
    if (blocks.length) return blocks[blocks.length - 1];
    // Fallback: raw un-fenced code if the model omitted markdown fences.
    // Start at the actual code (IIFE or register(...)) and cut after the final
    // `})();` so stray narrative before/after is never included.
    const startRe = /(?:^|\n)\s*(?:\(\s*\(\)\s*=>|\(function\s*\(|\/\/|\/\*|(?:window\.)?MiniSketchTools\.register\s*\()/;
    const st = raw.search(startRe);
    if (st < 0) return null;
    let code = raw.slice(st);
    const endIdx = code.lastIndexOf('})();');
    if (endIdx >= 0) code = code.slice(0, endIdx + 5);
    return hasReg(code) ? code.trim() : null;
  }

  function downloadExtensionFile(filename, content) {
    try {
      const blob = new Blob([String(content || '')], { type: 'application/javascript;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    } catch (err) {
      return false;
    }
  }

  function appendExtensionBlock(li, m, baseCode, force) {
    let liveCode = String(baseCode || extractExtensionCode(m && m.text) || '');
    if (!liveCode && !force) return;
    const reg = window.MiniSketchTools;
    let val = (reg && reg.validateExtensionCode)
      ? reg.validateExtensionCode(liveCode)
      : { ok: true, errors: [], warnings: [], extracted: { id: 'custom-tool', label: 'Custom Tool' } };
    let meta = {
      id: (val.extracted && val.extracted.id) || 'custom-tool',
      name: (val.extracted && (val.extracted.label || val.extracted.id)) || 'Custom Tool',
      label: (val.extracted && (val.extracted.label || val.extracted.id)) || 'Custom Tool',
      title: (val.extracted && val.extracted.title) || '',
      version: (val.extracted && val.extracted.version) || '1.0.0',
      author: (val.extracted && val.extracted.author) || 'AI Builder',
      category: (val.extracted && val.extracted.category) || 'AI Generated',
      description: (val.extracted && val.extracted.description) || '',
      icon: (val.extracted && val.extracted.icon) || ''
    };

    const card = document.createElement('div');
    card.className = 'chat-ext';

    const head = document.createElement('div');
    head.className = 'chat-ext-head';
    const title = document.createElement('span');
    title.className = 'chat-ext-title';
    if (reg && reg.sanitizeIconSvg) {
      const ic = document.createElement('span');
      ic.className = 'chat-ext-ic';
      ic.innerHTML = reg.sanitizeIconSvg(meta.icon);
      title.appendChild(ic);
    }
    const b = document.createElement('b');
    b.textContent = meta.label || 'Extension';
    const sub = document.createElement('span');
    sub.className = 'muted';
    sub.textContent = meta.id ? (' · ' + meta.id + ' · v' + meta.version) : '';
    title.appendChild(b);
    title.appendChild(sub);
    head.appendChild(title);
    card.appendChild(head);

    const status = document.createElement('div');
    status.className = 'chat-ext-status ' + (val.ok ? 'is-ok' : 'is-err');
    if (!val.ok) {
      status.textContent = tr('chat.extInvalid', 'Invalid: {err}', { err: val.errors[0] });
    } else if (val.warnings && val.warnings.length) {
      status.textContent = tr('chat.extReadyWarn', 'Ready ({n} warning: {warn})', { n: val.warnings.length, warn: val.warnings[0] });
    } else {
      status.textContent = tr('chat.extReady', 'Ready — syntax & contract valid');
    }
    card.appendChild(status);

    const actions = document.createElement('div');
    actions.className = 'chat-ext-actions';

    const fixBtn = document.createElement('button');
    fixBtn.type = 'button';
    fixBtn.className = 'btn small primary';
    fixBtn.textContent = tr('chat.extFixAi', 'Minta AI Perbaiki');
    fixBtn.disabled = !!NS.activeAbort;
    fixBtn.style.display = val.ok ? 'none' : '';
    fixBtn.title = tr('chat.extFixAiTitle', 'Send the validation errors to AI Extension Builder so the code gets fixed');
    fixBtn.addEventListener('click', () => {
      if (NS.activeAbort) return;
      if (typeof NS.setBuilderMode === 'function') NS.setBuilderMode('ext');
      else NS.builderMode = 'ext';
      const prompt = curLang() === 'id'
        ? ('Kode ekstensi sebelumnya gagal validasi:\n- ' + val.errors.join('\n- ') +
           '\n\nPerbaiki error tersebut dan kirim ulang SATU blok kode ```js ... ``` yang lengkap dan valid untuk window.MiniSketchTools.register({...}).')
        : ('The previous extension code failed validation:\n- ' + val.errors.join('\n- ') +
           '\n\nPlease fix those errors and resend ONE complete, valid ```js ... ``` code block for window.MiniSketchTools.register({...}).');
      send(prompt);
    });
    actions.appendChild(fixBtn);

    const testBtn = document.createElement('button');
    testBtn.type = 'button';
    testBtn.className = 'btn small';
    testBtn.textContent = tr('chat.extTestRun', 'Test Run');
    testBtn.disabled = !val.ok;
    testBtn.title = val.ok
      ? tr('chat.extTestRunTitle', 'Load temporarily (not saved) and open the tool dialog to test')
      : tr('chat.extCannotRun', 'Cannot run until validation passes: {err}', { err: val.errors[0] });
    testBtn.addEventListener('click', () => {
      if (!reg || !reg.installExtension) return;
      const res = reg.installExtension(meta, liveCode, { preview: true });
      if (!res.ok) {
        status.className = 'chat-ext-status is-err';
        status.textContent = res.error || tr('chat.extPreviewFail', 'Preview failed.');
        return;
      }
      reg.open(res.tool.id);
      status.className = 'chat-ext-status is-ok';
      status.textContent = tr('chat.extPreviewOk', 'Preview active — test parameters, then click Install to keep.');
    });

    const installBtn = document.createElement('button');
    installBtn.type = 'button';
    installBtn.className = 'btn small' + (val.ok ? ' primary' : '');
    installBtn.textContent = tr('chat.extInstall', 'Install');
    installBtn.disabled = !val.ok;
    installBtn.title = val.ok
      ? tr('chat.extInstallTitle', 'Save locally and add permanently to the Extensions panel')
      : tr('chat.extCannotInstall', 'Cannot install until validation passes: {err}', { err: val.errors[0] });
    installBtn.addEventListener('click', () => {
      if (!reg || !reg.installExtension) return;
      const res = reg.installExtension(meta, liveCode, { source: 'ai' });
      if (!res.ok) {
        status.className = 'chat-ext-status is-err';
        status.textContent = res.error || tr('chat.extInstallFail', 'Install failed.');
        return;
      }
      status.className = 'chat-ext-status is-ok';
      status.textContent = tr('chat.extInstalled', 'Installed to Extensions panel ({id}).', { id: res.tool.id });
      if (api && api.toast) api.toast(tr('chat.extToastInstalled', 'Extension "{name}" installed', { name: res.tool.label || res.tool.id }));
      // Also persist to disk when running from 127.0.0.1/localhost (no Google
      // login available there) so the tool survives browser storage clearing.
      saveExtensionToDisk(liveCode, meta).then((r) => {
        if (r && r.ok) {
          if (api && api.toast) api.toast(tr('chat.extSavedDisk', 'Also saved to server disk ({file})', { file: r.file }));
        }
      });
    });

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn small';
    editBtn.textContent = tr('chat.extEditAi', 'Edit with AI');
    editBtn.title = tr('chat.extEditAiTitle', 'Send this extension to the AI chat (new session, code embedded)');
    editBtn.addEventListener('click', () => {
      if (NS.editExtension) {
        try { NS.editExtension(liveCode, meta); } catch (e) { /* ignore */ }
      } else if (window.MiniSketchExtensions && window.MiniSketchExtensions.open) {
        window.MiniSketchExtensions.open('import', { code: liveCode });
      }
    });

    const pubBtn = document.createElement('button');
    pubBtn.type = 'button';
    pubBtn.className = 'btn small';
    pubBtn.textContent = tr('chat.extPublish', 'Publish…');
    pubBtn.disabled = !val.ok;
    pubBtn.title = tr('chat.extPublishTitle', 'Publish permanently to Cloud Community, MiniSketch Server, or GitHub Marketplace');
    pubBtn.addEventListener('click', () => {
      if (window.MiniSketchExtensions && window.MiniSketchExtensions.openPublish) {
        window.MiniSketchExtensions.openPublish(meta, liveCode);
      } else if (api && api.toast) {
        api.toast(tr('chat.extMgrNotLoaded', 'Extension Manager is not loaded.'));
      }
    });

    const dlBtn = document.createElement('button');
    dlBtn.type = 'button';
    dlBtn.className = 'btn small';
    dlBtn.textContent = tr('chat.extDownloadJs', 'Download .js');
    dlBtn.addEventListener('click', () => {
      const fn = (meta.id || 'extension').replace(/[^a-z0-9-_]/gi, '-') + '.js';
      const ok = downloadExtensionFile(fn, liveCode);
      status.className = 'chat-ext-status ' + (ok ? 'is-ok' : 'is-err');
      status.textContent = ok
        ? tr('chat.extDownloaded', 'Downloaded {fn}', { fn })
        : tr('chat.extDownloadFail', 'Download failed.');
    });

    const saveDiskBtn = document.createElement('button');
    saveDiskBtn.type = 'button';
    saveDiskBtn.className = 'btn small';
    saveDiskBtn.textContent = tr('chat.extSaveDisk', 'Save to disk');
    saveDiskBtn.title = tr('chat.extSaveDiskTitle', 'Write this extension to the server disk (works on 127.0.0.1/localhost)');
    saveDiskBtn.addEventListener('click', () => {
      saveExtensionToDisk(liveCode, meta).then((r) => {
        status.className = 'chat-ext-status ' + ((r && r.ok) ? 'is-ok' : 'is-err');
        status.textContent = (r && r.ok)
          ? tr('chat.extSavedDisk', 'Saved to server disk ({file})', { file: (r && r.file) || '' })
          : tr('chat.extSaveDiskFail', 'Save failed: {err}', { err: (r && r.error) || 'loopback only' });
      });
    });

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn small';
    copyBtn.textContent = tr('chat.extCopy', 'Copy');
    copyBtn.addEventListener('click', async () => {
      const ok = await copyTextToClipboard(liveCode);
      status.className = 'chat-ext-status ' + (ok ? 'is-ok' : 'is-err');
      status.textContent = ok
        ? tr('chat.extCopied', 'Code copied to clipboard.')
        : tr('chat.extCopyFail', 'Copy failed.');
    });

    actions.appendChild(testBtn);
    actions.appendChild(installBtn);
    actions.appendChild(editBtn);
    // Secondary actions live in a "⋯" popover to keep the card clean.
    {
      const moreHost = document.createElement('div');
      moreHost.className = 'ext-more';
      const moreBtn = document.createElement('button');
      moreBtn.type = 'button';
      moreBtn.className = 'btn small';
      moreBtn.textContent = '⋯';
      moreBtn.title = 'More actions';
      moreBtn.addEventListener('click', (ev) => { ev.stopPropagation(); moreHost.classList.toggle('open'); });
      const pop = document.createElement('div');
      pop.className = 'ext-more-pop';
      pop.appendChild(saveDiskBtn);
      pop.appendChild(pubBtn);
      pop.appendChild(dlBtn);
      pop.appendChild(copyBtn);
      moreHost.appendChild(moreBtn);
      moreHost.appendChild(pop);
      document.addEventListener('click', (e) => { if (!moreHost.contains(e.target)) moreHost.classList.remove('open'); });
      actions.appendChild(moreHost);
    }
    card.appendChild(actions);

    // Live state refresh after local edits
    const refreshState = () => {
      val = (reg && reg.validateExtensionCode)
        ? reg.validateExtensionCode(liveCode)
        : { ok: true, errors: [], warnings: [], extracted: { id: 'custom-tool', label: 'Custom Tool' } };
      meta = {
        id: (val.extracted && val.extracted.id) || 'custom-tool',
        name: (val.extracted && (val.extracted.label || val.extracted.id)) || 'Custom Tool',
        label: (val.extracted && (val.extracted.label || val.extracted.id)) || 'Custom Tool',
        title: (val.extracted && val.extracted.title) || '',
        version: (val.extracted && val.extracted.version) || '1.0.0',
        author: (val.extracted && val.extracted.author) || 'AI Builder',
        category: (val.extracted && val.extracted.category) || 'AI Generated',
        description: (val.extracted && val.extracted.description) || '',
        icon: (val.extracted && val.extracted.icon) || ''
      };
      status.className = 'chat-ext-status ' + (val.ok ? 'is-ok' : 'is-err');
      if (!val.ok) {
        status.textContent = tr('chat.extInvalid', 'Invalid: {err}', { err: val.errors[0] });
      } else if (val.warnings && val.warnings.length) {
        status.textContent = tr('chat.extReadyWarn', 'Ready ({n} warning: {warn})', { n: val.warnings.length, warn: val.warnings[0] });
      } else {
        status.textContent = tr('chat.extReady', 'Ready — syntax & contract valid');
      }
      fixBtn.style.display = val.ok ? 'none' : '';
      testBtn.disabled = !val.ok;
      testBtn.title = val.ok
        ? tr('chat.extTestRunTitle', 'Load temporarily (not saved) and open the tool dialog to test')
        : tr('chat.extCannotRun', 'Cannot run until validation passes: {err}', { err: val.errors[0] });
      installBtn.disabled = !val.ok;
      installBtn.className = 'btn small' + (val.ok ? ' primary' : '');
      installBtn.title = val.ok
        ? tr('chat.extInstallTitle', 'Save locally and add permanently to the Extensions panel')
        : tr('chat.extCannotInstall', 'Cannot install until validation passes: {err}', { err: val.errors[0] });
      pubBtn.disabled = !val.ok;
    };

    // Inline editable source — the ONLY source viewer: edit right here.
    const srcDet = document.createElement('details');
    srcDet.className = 'chat-ext-sourceedit';
    const srcSum = document.createElement('summary');
    srcSum.textContent = tr('chat.extSourceEdit', 'Source code ({n} lines) — edit & Apply', { n: liveCode.split('\n').length });
    const srcWrap = document.createElement('div');
    srcWrap.className = 'chat-ext-sourceedit-wrap';
    const srcHl = document.createElement('pre');
    srcHl.className = 'chat-ext-sourceedit-hl';
    const srcHlCode = document.createElement('code');
    srcHl.appendChild(srcHlCode);
    const srcTa = document.createElement('textarea');
    srcTa.className = 'chat-ext-sourceedit-ta';
    srcTa.spellcheck = false;
    srcTa.value = liveCode;
    const paintHl = () => {
      const v = srcTa.value;
      if (window.MiniSketchExtensions && typeof window.MiniSketchExtensions.highlightCode === 'function') {
        srcHlCode.innerHTML = window.MiniSketchExtensions.highlightCode(v);
      } else {
        srcHlCode.textContent = v;
      }
    };
    paintHl();
    let draftTimer = null;
    srcTa.addEventListener('input', () => {
      paintHl();
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => saveDockDraft(srcTa.value), 400);
    });
    srcTa.addEventListener('scroll', () => {
      srcHl.scrollTop = srcTa.scrollTop;
      srcHl.scrollLeft = srcTa.scrollLeft;
    });
    srcWrap.appendChild(srcHl);
    srcWrap.appendChild(srcTa);
    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'btn small primary';
    applyBtn.textContent = tr('chat.extApplyEdit', 'Apply');
    applyBtn.addEventListener('click', () => {
      liveCode = srcTa.value;
      saveDockDraft(liveCode);
      srcSum.textContent = tr('chat.extSourceEdit', 'Source code ({n} lines) — edit & Apply', { n: liveCode.split('\n').length });
      refreshState();
    });
    srcDet.appendChild(srcSum);
    srcDet.appendChild(srcWrap);
    srcDet.appendChild(applyBtn);
    card.appendChild(srcDet);

    li.appendChild(card);
  }

  // follow the tail of a scrolling element unless the user scrolled up to read
  function stickToBottom(el) {
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (near) el.scrollTop = el.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function setTab(mode) {
    NS.mode = mode === 'log' ? 'log' : 'chat';
    document.querySelectorAll('[data-chat-tab]').forEach(b => {
      b.classList.toggle('is-on', b.dataset.chatTab === NS.mode);
      b.setAttribute('aria-selected', b.dataset.chatTab === NS.mode ? 'true' : 'false');
    });
    if (NS.mode === 'log') refreshMeta();
    renderLog();
  }

  // Called once from app.js init() after mountTools(). Keeps all chat state
  // here; app.js only gains the aiBridgeUrl setting + this one call.
  NS.mount = function mount(aiApi) {
    api = aiApi;
    NS._apiRef = aiApi;   // debug/inspection handle
    // Restore the running session (text + images) from IndexedDB; the v0
    // localStorage chat migrates in once.
    initSession().then(() => renderLog()).catch(() => { renderLog(); });
    NS.updateTitle();
    setupImageInput();    // attach/paste/drop image wiring + tray
    // Preload the only two fonts the AI uses, so an import_svg that lands text
    // renders immediately: by the time applyOps awaits the face it is already
    // cached (the await resolves instantly) and the frame is fitted with real
    // metrics — no late-appearing text, no reload needed.
    if (window.MiniSketchFonts) {
      Promise.all([
        window.MiniSketchFonts.load('Liberation Sans', 400, 'normal'),
        window.MiniSketchFonts.load('Liberation Serif', 400, 'normal')
      ]).catch(() => { /* fonts stay on-demand if preload fails */ });
    }
    document.querySelectorAll('[data-chat-tab]').forEach(b => {
      b.addEventListener('click', () => setTab(b.dataset.chatTab));
    });

    // Mode combo box (SVG / Extension): one dropdown instead of two buttons.
    const modeSel = document.getElementById('chat-builder-mode');
    const setBuilderMode = (mode) => {
      NS.builderMode = mode === 'ext' ? 'ext' : 'svg';
      lsSet(BUILDER_MODE_KEY, NS.builderMode);
      if (modeSel) {
        modeSel.value = NS.builderMode === 'ext' ? 'ext' : 'svg';
      }
      const inp = document.getElementById('chat-input');
      if (inp) {
        inp.placeholder = NS.builderMode === 'ext'
          ? tr('chat.inputPhExt', 'Describe a parametric CNC tool to build… (e.g. "coaster generator with inner pattern")')
          : tr('chat.inputPhSvg', 'Describe a vector image… (Shift+Enter for a new line)');
      }
      if (window.MiniSketchCloud && window.MiniSketchCloud.scheduleSync) {
        window.MiniSketchCloud.scheduleSync('prefs');
      }
    };
    NS.setBuilderMode = setBuilderMode;
    if (modeSel) modeSel.addEventListener('change', () => setBuilderMode(modeSel.value));
    const savedMode = lsGet(BUILDER_MODE_KEY);
    if (savedMode === 'ext' || savedMode === 'svg') NS.builderMode = savedMode;
    setBuilderMode(NS.builderMode);
    const modelSel = document.getElementById('chat-model-sel');
    const modelRefresh = document.getElementById('chat-model-refresh');
    if (modelSel) {
      const VISION_RE = /vision|multimodal|\bvl\b|llava|pixtral|internvl|minicpm|qwen.*vl|glm-4v|gpt-4o|claude/i;
      const modelMeta = (mRaw) => {
        const id = typeof mRaw === 'string' ? mRaw : String((mRaw && (mRaw.id || mRaw.model || mRaw.name)) || '');
        return { id, free: /free/i.test(id), vision: VISION_RE.test(id) };
      };
      const fill = (models) => {
        const cur = String((api.settings && api.settings.aiModel) || '').trim();
        modelSel.innerHTML = '';
        const ph = document.createElement('option');
        ph.value = '';
        ph.textContent = cur || tr('chat.modelSelectPh', 'select model…');
        modelSel.appendChild(ph);
        const list = (Array.isArray(models) ? models : []).map(modelMeta);
        list.sort((a, b) => (b.free ? 1 : 0) - (a.free ? 1 : 0));
        for (const m of list) {
          const o = document.createElement('option');
          o.value = m.id;
          o.textContent = m.id + (m.free ? ' [free]' : '');
          o.dataset.free = m.free ? '1' : '0';
          o.dataset.vision = m.vision ? '1' : '0';
          o.dataset.q = m.id.toLowerCase();
          modelSel.appendChild(o);
        }
        modelSel.value = cur;
      };
      NS.fillModelList = fill;
      const loadM = (silent) => {
        return fetchProviderModels().then(models => {
          if (models) fill(models);
          else if (!silent && modelSel) modelSel.title = tr('chat.modelLoadErrTitle', 'Failed to load models — check provider/key in Settings');
        });
      };
      if (modelRefresh) {
        modelRefresh.addEventListener('click', () => {
          modelRefresh.disabled = true;
          loadM(false).finally(() => { modelRefresh.disabled = false; });
        });
      }
      modelSel.addEventListener('change', () => {
        const v = modelSel.value;
        if (v && window.setAiModelFromChat) window.setAiModelFromChat(v);
      });
      if (window.syncAiModelSelect) window.syncAiModelSelect();
      loadM(true);
    }

    // Reasoning level quick-control (Off/Low/Normal).
    const thinkSel = document.getElementById('chat-think-sel');
    if (thinkSel) thinkSel.addEventListener('change', () => {
      if (window.setAiThinkLevelFromChat) window.setAiThinkLevelFromChat(thinkSel.value);
    });
    if (window.syncAiQuickControls) window.syncAiQuickControls();

    const input = document.getElementById('chat-input');
    const btn = document.getElementById('chat-send');
    const resizeInput = () => {
      if (!input || input.tagName !== 'TEXTAREA') return;
      input.style.height = 'auto';
      const maxH = 140;
      const next = Math.min(input.scrollHeight, maxH);
      input.style.height = Math.max(60, next) + 'px';
      input.style.overflowY = input.scrollHeight > maxH ? 'auto' : 'hidden';
    };
    if (input && input.tagName === 'TEXTAREA') {
      input.addEventListener('input', resizeInput);
      resizeInput();
    }
    // Satu tombol: Kirim (idle) ↔ Stop (saat permintaan berjalan). Stop
    // memanggil abort() lalu tombol kembali jadi Kirim ketika turn selesai
    // (NS.activeAbort = null + setStopVisible(false) di akhir send()).
    NS.setStopVisible = (on) => {
      if (!btn) return;
      btn.classList.toggle('is-stop', !!on);
      btn.textContent = on ? tr('chat.stop', '■ Stop') : tr('chat.send', 'Send');
      btn.title = on ? tr('chat.stopTitle', 'Stop the running request') : '';
    };
    NS.refreshLanguage = () => {
      NS.updateTitle();
      if (modelSel && modelSel.options && modelSel.options[0] && modelSel.options[0].value === '') {
        const cur = String((api && api.settings && api.settings.aiModel) || '').trim();
        if (!cur) modelSel.options[0].textContent = tr('chat.modelSelectPh', 'select model…');
      }
      setBuilderMode(NS.builderMode);
      NS.setStopVisible(!!NS.activeAbort);
      renderPending();
      const dock = getExtDock();
      if (dock) dock._dockSig = '';
      renderLog();
    };
    // NOTE: the Fork button is rendered inline under the first user message by
    // renderLog/makeForkButton — there is no toolbar fork button any more.

    const newBtn = document.getElementById('chat-new');
    if (newBtn) newBtn.addEventListener('click', () => {
      if (NS.activeAbort) return;
      archiveCurrentSession().then(() => {
        NS.log = [];
        NS.sessionId = newSessionId();
        NS.sessionAt = Date.now();
        lsSet(CURRENT_ID_KEY, NS.sessionId);
        NS._lastExtTotal = 0;
        NS.extSelIdx = null;
        refreshMeta();
        setTab('chat');
        renderLog();
        if (input) input.focus();
      });
    });
    const rollbackBtn = document.getElementById('chat-rollback');
    if (rollbackBtn) rollbackBtn.addEventListener('click', () => {
      if (!rollbackLastTurn()) {
        if (NS.activeAbort) return;
        api && api.toast && api.toast(tr('chat.rollbackEmpty', 'Nothing to roll back.'));
      }
    });
    const go = () => {
      // When a request is running the single button is Stop: abort instead of
      // sending a new message.
      if (NS.activeAbort) { NS.activeAbort.abort(); return; }
      const v = input ? input.value : '';
      if (input) { input.value = ''; resizeInput(); }
      send(v);
      if (input) input.focus();
    };
    if (btn) btn.addEventListener('click', go);
    if (input) input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); go(); }
      ev.stopPropagation();
    });
  };

  // Edit-extension flow (used by the Extension Manager "Edit with AI" button):
  // embed the current extension code into the chat as a user context message so
  // the user can then simply say what to change. The code is NOT executed — it
  // only joins the conversation history, and the next user message drives the
  // AI (which replies with a full updated ```js ... ``` block, then the usual
  // Test/Install actions apply).
  NS.editExtension = (code, meta) => {
    const src = String(code == null ? '' : code).trim();
    if (!src) return false;
    NS._lastAutoContSig = null;
    if (typeof NS.setBuilderMode === 'function') NS.setBuilderMode('ext');
    else NS.builderMode = 'ext';
    // Make sure the sidebar and the AI Chat panel are visible.
    document.body.classList.add('sidebar-open');
    const panel = document.getElementById('chat-panel');
    if (panel) panel.open = true;
    // Start a FRESH session so the edit context is clean: archive the current
    // session (History) and begin a new one before embedding the code.
    const embed = () => {
      const name = (meta && (meta.label || meta.name || meta.id)) || 'extension';
      const msg = (curLang() === 'id')
        ? ('[Edit Ekstensi] Ini kode ekstensi "' + name + '" saat ini.\n' +
           'Jangan mengubah apa pun dulu — tunggu perintah saya berikutnya, lalu kirim ulang SATU blok kode ```js ... ``` yang lengkap dan valid untuk window.MiniSketchTools.register({...}).\n\n```js\n' + src + '\n```')
        : ('[Extension Edit] Here is the current code of the "' + name + '" extension.\n' +
           'Do not change anything yet — wait for my next instruction, then resend ONE complete, valid ```js ... ``` code block for window.MiniSketchTools.register({...}).\n\n```js\n' + src + '\n```');
      pushLog('user', msg);
      renderLog();
      const inp = document.getElementById('chat-input');
      if (inp) { try { inp.focus(); } catch (e) {} }
      if (api && api.toast) api.toast(tr('chat.extEditAiToast', 'New session — code embedded, tell the AI what to change'));
    };
    const startFresh = () => {
      NS.log = [];
      NS.sessionId = newSessionId();
      NS.sessionAt = Date.now();
      lsSet(CURRENT_ID_KEY, NS.sessionId);
      refreshMeta();
      setTab('chat');
      embed();
    };
    if (NS.activeAbort) { try { NS.activeAbort.abort(); } catch (e) {} }
    try { archiveCurrentSession().then(startFresh).catch(startFresh); }
    catch (e) { startFresh(); }
    return true;
  };

  NS.send = send;
  NS.applyOps = applyOps;
  NS.stateSummary = stateSummary;
  NS.renderLog = renderLog;
  NS.bridgeUrl = bridgeUrl;
  NS.extractExtensionCode = extractExtensionCode;
  NS.saveExtensionToDisk = saveExtensionToDisk;
})();
