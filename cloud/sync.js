// MiniSketch Local-First Google Auth + Cloud Sync + Cloud Marketplace
// Classic script (never blocks offline/local/file:// usage).
// Exposes window.MiniSketchCloud.
(() => {
  'use strict';

  const NS = window.MiniSketchCloud = window.MiniSketchCloud || {};

  const OperationType = {
    CREATE: 'create',
    UPDATE: 'update',
    DELETE: 'delete',
    LIST: 'list',
    GET: 'get',
    WRITE: 'write'
  };
  NS.OperationType = OperationType;

  const PREF_DOC_ID = 'preferences';
  const ACTIVE_SKETCH_ID = 'active';
  const AUTO_SYNC_KEY = 'minisketch.cloud.autoSync';
  const PENDING_SYNC_KEY = 'minisketch.cloud.pending';
  const PENDING_DEL_KEY = 'minisketch.cloud.pendingDeletes';
  const PROFILE_UID_KEY = 'minisketch.cloud.profileUid';
  const MAX_DOC_BYTES = 900 * 1024;
  const MAX_CHAT_BYTES = 780 * 1024;
  const FIREBASE_SDK_VER = '13.4.0';

  const APP_ROOT = (() => {
    try {
      const cs = typeof document !== 'undefined' && document.currentScript;
      if (cs && cs.src) return new URL('../', cs.src).href;
    } catch (err) { /* ignore */ }
    try {
      return new URL('./', location.href).href;
    } catch (err) { return '/'; }
  })();

  let fbAppMod = null;
  let fbAuthMod = null;
  let fbFsMod = null;
  let app = null;
  let auth = null;
  let db = null;
  let currentUser = null;
  let ready = false;
  let available = false;
  let initError = '';
  let syncState = 'offline'; // 'offline' | 'guest' | 'syncing' | 'synced' | 'error'
  let lastSyncAt = 0;
  let applyingRemote = false;
  let userEditedLocalDoc = false;
  let bootStarted = false;
  let pendingSync = (() => {
    try { return localStorage.getItem(PENDING_SYNC_KEY) === '1'; }
    catch (err) { return false; }
  })();

  let unsubPrefs = null;
  let unsubExts = null;
  let unsubActiveSketch = null;
  let unsubAllSketches = null;
  let unsubChats = null;

  let prefsTimer = null;
  let docTimer = null;
  const createdAtCache = new Map();
  let cloudSketches = [];
  let cachedMarketplace = null;
  const authListeners = new Set();

  function isAutoSync() {
    try { return localStorage.getItem(AUTO_SYNC_KEY) === '1'; }
    catch (err) { return false; }
  }

  function setPendingSync(flag) {
    pendingSync = !!flag;
    try { localStorage.setItem(PENDING_SYNC_KEY, pendingSync ? '1' : '0'); }
    catch (err) { /* ignore */ }
    renderAuthChip();
    renderCloudModal();
  }

  function loadPendingDeletes() {
    try {
      const raw = JSON.parse(localStorage.getItem(PENDING_DEL_KEY) || '{}');
      return {
        exts: Array.isArray(raw.exts) ? raw.exts : [],
        chats: Array.isArray(raw.chats) ? raw.chats : []
      };
    } catch (err) {
      return { exts: [], chats: [] };
    }
  }

  function savePendingDeletes(obj) {
    try { localStorage.setItem(PENDING_DEL_KEY, JSON.stringify(obj)); }
    catch (err) { /* ignore */ }
  }

  function queuePendingDelete(kind, id) {
    const d = loadPendingDeletes();
    const list = kind === 'ext' ? d.exts : d.chats;
    if (!list.includes(id)) list.push(id);
    savePendingDeletes(d);
  }

  function isHttpOrigin() {
    try { return /^https?:$/i.test(location.protocol); }
    catch (err) { return false; }
  }

  function handleFirestoreError(error, operationType, path) {
    const u = auth && auth.currentUser;
    const providerInfo = (u && Array.isArray(u.providerData))
      ? u.providerData.map(p => ({
        providerId: p.providerId,
        displayName: p.displayName,
        email: p.email,
        photoUrl: p.photoURL
      }))
      : [];
    const errInfo = {
      error: error instanceof Error ? error.message : String(error),
      authInfo: {
        userId: u ? u.uid : undefined,
        email: u ? u.email : undefined,
        emailVerified: u ? u.emailVerified : undefined,
        isAnonymous: u ? u.isAnonymous : undefined,
        tenantId: u ? u.tenantId : undefined,
        providerInfo
      },
      operationType,
      path
    };
    const msg = String(errInfo.error || '');
    if (/Quota exceeded/i.test(msg)) {
      console.error('Firestore Quota Exceeded:', errInfo);
      if (window.MiniSketchSyncBridge && window.MiniSketchSyncBridge.toast) {
        window.MiniSketchSyncBridge.toast('Cloud storage quota exceeded for today. Local work remains safely saved.', { type: 'warn', sticky: true });
      }
      throw new Error(JSON.stringify(errInfo));
    }
    console.error('Firestore Error:', JSON.stringify(errInfo));
    throw new Error(JSON.stringify(errInfo));
  }
  NS.handleFirestoreError = handleFirestoreError;

  // Lossless recursive serializer for Firestore Maps/Lists (handles nested arrays
  // like spline handles, part polylines, and art contours without JSON.stringify).
  const NESTED_KEY = '__msArr';
  function toFs(val, inArray) {
    if (val === undefined) return null;
    if (val === null || typeof val === 'boolean' || typeof val === 'string') return val;
    if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
    if (Array.isArray(val)) {
      const mapped = val.map(item => toFs(item, true));
      return inArray ? { [NESTED_KEY]: mapped } : mapped;
    }
    if (typeof val === 'object') {
      const out = {};
      for (const k of Object.keys(val)) {
        const v = val[k];
        if (v === undefined) continue;
        out[k] = toFs(v, false);
      }
      return out;
    }
    return String(val);
  }

  function fromFs(val) {
    if (val === null || val === undefined || typeof val !== 'object') return val;
    if (typeof val.toMillis === 'function') return val.toMillis();
    if (val instanceof Uint8Array) return val;
    if (typeof val.toUint8Array === 'function') return val.toUint8Array();
    if (Array.isArray(val)) return val.map(fromFs);
    const keys = Object.keys(val);
    if (keys.length === 1 && keys[0] === NESTED_KEY && Array.isArray(val[NESTED_KEY])) {
      return val[NESTED_KEY].map(fromFs);
    }
    const out = {};
    for (const k of keys) out[k] = fromFs(val[k]);
    return out;
  }

  const textEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  const textDecoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;

  function utf8Len(str) {
    if (!str) return 0;
    return textEncoder ? textEncoder.encode(str).length : String(str).length;
  }

  function utf8Bytes(obj) {
    try {
      const s = JSON.stringify(obj);
      return utf8Len(s);
    } catch (err) {
      return Infinity;
    }
  }

  function estimateValueBytes(val) {
    if (val === null || val === undefined) return 1;
    if (typeof val === 'boolean') return 1;
    if (typeof val === 'number') return 8;
    if (typeof val === 'string') return utf8Len(val) + 1;
    if (val instanceof Uint8Array) return val.byteLength;
    if (typeof val.toUint8Array === 'function') return val.toUint8Array().byteLength;
    if (Array.isArray(val)) {
      let sum = 0;
      for (let i = 0; i < val.length; i++) sum += estimateValueBytes(val[i]);
      return sum;
    }
    if (typeof val === 'object') {
      let sum = 32;
      for (const k of Object.keys(val)) {
        const v = val[k];
        if (v === undefined) continue;
        sum += utf8Len(k) + 1 + estimateValueBytes(v);
      }
      return sum;
    }
    return 16;
  }

  function estimateFirestoreBytes(docObj) {
    if (!docObj || typeof docObj !== 'object') return Infinity;
    return 256 + estimateValueBytes(docObj);
  }

  function canStreamGzip() {
    return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
  }

  async function runByteStream(stream, u8) {
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    const chunks = [];
    const readDone = (async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value && value.byteLength) chunks.push(value);
      }
    })();
    await writer.write(u8);
    await writer.close();
    await readDone;
    let total = 0;
    for (let i = 0; i < chunks.length; i++) total += chunks[i].byteLength;
    const out = new Uint8Array(total);
    let offset = 0;
    for (let i = 0; i < chunks.length; i++) {
      out.set(chunks[i], offset);
      offset += chunks[i].byteLength;
    }
    return out;
  }

  async function gzipBytes(u8) {
    return await runByteStream(new CompressionStream('gzip'), u8);
  }

  async function gunzipBytes(u8) {
    return await runByteStream(new DecompressionStream('gzip'), u8);
  }

  function u8ToBase64(u8) {
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < u8.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }

  function base64ToU8(b64) {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  async function compressSketchState(rawState, fsMod) {
    const mod = fsMod || fbFsMod;
    const fallbackState = toFs(rawState, false);
    if (!canStreamGzip() || !textEncoder) {
      return { state: fallbackState, compressed: false, rawBytes: 0, gzBytes: 0 };
    }
    const rawJson = JSON.stringify(rawState);
    const rawU8 = textEncoder.encode(rawJson);
    const gzU8 = await gzipBytes(rawU8);
    const useBytes = !!(mod && mod.Bytes && typeof mod.Bytes.fromUint8Array === 'function');
    const compressedState = useBytes
      ? {
        _enc: 'gzip-bytes-v1',
        rawBytes: rawU8.byteLength,
        gzBytes: gzU8.byteLength,
        data: mod.Bytes.fromUint8Array(gzU8)
      }
      : {
        _enc: 'gzip-b64-v1',
        rawBytes: rawU8.byteLength,
        gzBytes: gzU8.byteLength,
        data: u8ToBase64(gzU8)
      };
    if (estimateValueBytes(compressedState) < estimateValueBytes(fallbackState)) {
      return {
        state: compressedState,
        compressed: true,
        rawBytes: rawU8.byteLength,
        gzBytes: gzU8.byteLength
      };
    }
    return { state: fallbackState, compressed: false, rawBytes: rawU8.byteLength, gzBytes: gzU8.byteLength };
  }

  async function decompressSketchState(state) {
    if (!state || typeof state !== 'object') return state;
    const enc = state._enc;
    if (!enc) return state;
    if (!canStreamGzip() || !textDecoder) {
      throw new Error('Browser does not support gzip DecompressionStream');
    }
    let gzU8 = null;
    if (enc === 'gzip-bytes-v1') {
      const d = state.data;
      if (d instanceof Uint8Array) gzU8 = d;
      else if (d && typeof d.toUint8Array === 'function') gzU8 = d.toUint8Array();
      else if (d && typeof d.bytes === 'string') gzU8 = base64ToU8(d.bytes);
      else if (typeof d === 'string') gzU8 = base64ToU8(d);
    } else if (enc === 'gzip-b64-v1') {
      if (typeof state.data === 'string') gzU8 = base64ToU8(state.data);
    } else {
      throw new Error('Unsupported cloud sketch encoding: ' + enc);
    }
    if (!gzU8) throw new Error('Missing compressed sketch payload');
    const rawU8 = await gunzipBytes(gzU8);
    return JSON.parse(textDecoder.decode(rawU8));
  }

  NS.compressSketchState = compressSketchState;
  NS.decompressSketchState = decompressSketchState;
  NS.estimateDocBytes = estimateFirestoreBytes;

  function setSyncState(next, detail) {
    syncState = next;
    if (next === 'synced') lastSyncAt = Date.now();
    renderAuthChip(detail);
    renderCloudModal();
    for (const fn of authListeners) {
      try { fn({ user: currentUser, state: syncState, available, ready }); }
      catch (err) { /* ignore */ }
    }
  }

  function renderAuthChip(detail) {
    const btn = document.getElementById('btn-cloud-auth');
    if (!btn) return;
    const lbl = btn.querySelector('.cloud-auth-label');
    const dot = btn.querySelector('.cloud-auth-dot');
    const av = btn.querySelector('.cloud-auth-avatar');
    btn.classList.remove('is-signed-in', 'is-syncing', 'is-error', 'is-offline');

    if (!available) {
      btn.classList.add('is-offline');
      btn.title = initError || 'Local / Offline Mode (all work saved in this browser)';
      if (lbl) lbl.textContent = 'Local';
      if (dot) dot.className = 'cloud-auth-dot is-local';
      if (av) { av.hidden = true; av.removeAttribute('src'); }
      return;
    }

    if (!currentUser) {
      btn.title = 'Sign in with Google to sync sketches, settings, AI chat & extensions across devices (optional — local save always works)';
      if (lbl) lbl.textContent = 'Sign in';
      if (dot) dot.className = 'cloud-auth-dot is-guest';
      if (av) { av.hidden = true; av.removeAttribute('src'); }
      return;
    }

    btn.classList.add('is-signed-in');
    if (syncState === 'syncing') btn.classList.add('is-syncing');
    if (syncState === 'error') btn.classList.add('is-error');
    const shortName = (currentUser.displayName || currentUser.email || 'Account').split(/\s+/)[0];
    if (lbl) lbl.textContent = syncState === 'syncing' ? 'Syncing…' : shortName;
    if (dot) {
      const dotCls = syncState === 'syncing'
        ? 'is-syncing'
        : syncState === 'error'
          ? 'is-error'
          : pendingSync
            ? 'is-pending'
            : 'is-synced';
      dot.className = 'cloud-auth-dot ' + dotCls;
    }
    if (av && currentUser.photoURL) {
      av.src = currentUser.photoURL;
      av.alt = shortName;
      av.hidden = false;
    } else if (av) {
      av.hidden = true;
      av.removeAttribute('src');
    }
    const modeNote = isAutoSync()
      ? (syncState === 'synced' ? 'Auto-sync active' : syncState === 'syncing' ? 'Syncing…' : 'Sync issue')
      : (pendingSync ? 'Manual sync · unsynced local changes (click to Sync Now)' : 'Manual sync mode (click for Cloud Sketches & Sync Now)');
    btn.title = (currentUser.email || shortName) + ' · ' + (detail || modeNote);
  }

  async function testConnection() {
    if (!db || !fbFsMod) return false;
    try {
      await fbFsMod.getDocFromServer(fbFsMod.doc(db, 'test', 'connection'));
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('the client is offline')) {
        console.error('Please check your Firebase configuration (client offline).');
        return false;
      }
      // Permission denied or missing test doc confirms server reachability.
      return true;
    }
  }

  async function upsertDoc(docRef, fields, path, cacheCreatedAt) {
    let createdAt = createdAtCache.get(path) || cacheCreatedAt || null;
    if (!createdAt) {
      try {
        const snap = await fbFsMod.getDoc(docRef);
        if (snap.exists()) {
          const d = snap.data();
          if (d && d.createdAt) createdAt = d.createdAt;
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, path);
      }
    }
    const opType = createdAt ? OperationType.UPDATE : OperationType.CREATE;
    const payload = Object.assign({}, fields, {
      createdAt: createdAt || fbFsMod.serverTimestamp(),
      updatedAt: fbFsMod.serverTimestamp()
    });
    try {
      await fbFsMod.setDoc(docRef, payload);
      if (!createdAt) {
        try {
          const fresh = await fbFsMod.getDoc(docRef);
          if (fresh.exists() && fresh.data().createdAt) {
            createdAtCache.set(path, fresh.data().createdAt);
          }
        } catch (err) { /* ignore follow-up cache read */ }
      }
    } catch (err) {
      handleFirestoreError(err, opType, path);
    }
  }

  async function syncUserProfile(user) {
    if (!db || !fbFsMod || !user) return;
    const path = 'users/' + user.uid;
    const ref = fbFsMod.doc(db, 'users', user.uid);
    const data = { uid: user.uid };
    if (user.email) data.email = String(user.email).slice(0, 320);
    if (user.displayName) data.displayName = String(user.displayName).slice(0, 160);
    if (user.photoURL) data.photoURL = String(user.photoURL).slice(0, 1024);
    await upsertDoc(ref, data, path);
  }

  // ---- Local Snapshot Collectors & Appliers --------------------------------
  function collectLocalToolParams() {
    const out = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('minisketch.tool.')) {
          const id = k.slice('minisketch.tool.'.length);
          if (id) {
            try {
              const parsed = JSON.parse(localStorage.getItem(k) || 'null');
              if (parsed !== null) out[id] = parsed;
            } catch (err) { /* ignore bad json */ }
          }
        }
      }
    } catch (err) { /* storage blocked */ }
    return out;
  }

  function applyLocalToolParams(map) {
    if (!map || typeof map !== 'object') return;
    for (const id of Object.keys(map)) {
      try {
        localStorage.setItem('minisketch.tool.' + id, JSON.stringify(map[id]));
      } catch (err) { /* ignore */ }
    }
  }

  function collectPreferencesPayload() {
    const bridge = window.MiniSketchSyncBridge;
    const b = bridge && bridge.exportPrefsBundle ? bridge.exportPrefsBundle() : {};
    const lsGetJson = (k, def) => {
      try {
        const raw = localStorage.getItem(k);
        return raw ? JSON.parse(raw) : def;
      } catch (err) { return def; }
    };
    const lsGetStr = (k, def) => {
      try {
        const raw = localStorage.getItem(k);
        return raw != null ? raw : def;
      } catch (err) { return def; }
    };
    const payload = {
      theme: b.theme || (lsGetStr('minisketch.theme', 'dark') === 'light' ? 'light' : 'dark'),
      lang: b.lang || (lsGetStr('minisketch.help.lang', 'en') === 'id' ? 'id' : 'en'),
      solveMode: b.solveMode || lsGetStr('minisketch.solvemode', 'release'),
      builderMode: (window.MiniSketchAI && window.MiniSketchAI.builderMode === 'ext') ? 'ext' : (lsGetStr('minisketch.chat.builderMode', 'svg') === 'ext' ? 'ext' : 'svg'),
      chatCurrentId: lsGetStr('minisketch.chat.currentId', ''),
      docName: lsGetStr('minisketch.v1.docname', ''),
      fileName: lsGetStr('minisketch.v1.filename', ''),
      layoutSideWidth: (() => {
        const l = lsGetJson('minisketch.v1.layout', null);
        return l && isFinite(+l.side) ? Math.round(+l.side) : 0;
      })(),
      marketplaceUrl: lsGetStr('minisketch.v1.ext.marketplaceUrl', ''),
      serverUrl: lsGetStr('minisketch.v1.ext.serverUrl', ''),
      extAutoUpdate: lsGetStr('minisketch.v1.ext.autoUpdate', '0') === '1',
      githubCfg: lsGetJson('minisketch.v1.ext.githubCfg', {}),
      settings: b.settings || lsGetJson('minisketch.settings.v1', {}),
      aiProviders: Array.isArray(b.aiProviders) ? b.aiProviders : lsGetJson('minisketch.ai.providers.v1', []),
      pickFilter: b.pickFilter || lsGetJson('minisketch.pickfilter.v1', {}),
      view: b.view || lsGetJson('minisketch.v1.view', {}),
      cncConfig: b.cncConfig || lsGetJson('minisketch.cnc.v2', {}),
      costPresets: typeof b.costPresets === 'string' ? b.costPresets : lsGetStr('minisketch.costPresets.v1', ''),
      nestPrefs: lsGetJson('minisketch.v1.nestPrefs', {}),
      imgOpts: lsGetJson('minisketch.v1.imgOpts', {}),
      fontFavorites: Array.isArray(b.fontFavorites) ? b.fontFavorites : lsGetJson('minisketch.fontFavorites.v1', []),
      textPrefs: {
        fitCurve: lsGetStr('minisketch.textFitCurve.v1', '1') !== '0',
        height: parseFloat(lsGetStr('minisketch.textHeight.v1', '20')) || 20,
        style: lsGetJson('minisketch.textStyle.v1', {}),
        otCurLayer: lsGetStr('minisketch.otCurrentLayer.v1', '')
      },
      toolParams: collectLocalToolParams(),
      disabledExtensions: lsGetJson('minisketch.v1.ext.disabled', []),
      updatedAtMs: Date.now()
    };
    return toFs(payload, false);
  }

  function applyRemotePreferences(remote) {
    if (!remote || typeof remote !== 'object') return;
    applyingRemote = true;
    try {
      const data = fromFs(remote);
      const safeSet = (k, v) => { try { localStorage.setItem(k, String(v)); } catch (err) { /* ignore */ } };
      const safeJson = (k, v) => { if (v !== undefined) safeSet(k, JSON.stringify(v)); };

      if (data.theme === 'dark' || data.theme === 'light') safeSet('minisketch.theme', data.theme);
      if (data.lang === 'en' || data.lang === 'id') safeSet('minisketch.help.lang', data.lang);
      if (data.solveMode === 'release' || data.solveMode === 'manual' || data.solveMode === 'live') safeSet('minisketch.solvemode', data.solveMode);
      if (data.builderMode === 'svg' || data.builderMode === 'ext') {
        safeSet('minisketch.chat.builderMode', data.builderMode);
        if (window.MiniSketchAI && window.MiniSketchAI.setBuilderMode) window.MiniSketchAI.setBuilderMode(data.builderMode);
      }
      if (typeof data.chatCurrentId === 'string' && data.chatCurrentId) safeSet('minisketch.chat.currentId', data.chatCurrentId);
      if (typeof data.docName === 'string') {
        if (data.docName) safeSet('minisketch.v1.docname', data.docName);
        else { try { localStorage.removeItem('minisketch.v1.docname'); } catch (err) {} }
      }
      if (typeof data.fileName === 'string' && data.fileName) safeSet('minisketch.v1.filename', data.fileName);
      if (data.layoutSideWidth && isFinite(+data.layoutSideWidth) && +data.layoutSideWidth > 180) {
        safeJson('minisketch.v1.layout', { side: +data.layoutSideWidth });
      }
      if (typeof data.marketplaceUrl === 'string' && data.marketplaceUrl) safeSet('minisketch.v1.ext.marketplaceUrl', data.marketplaceUrl);
      if (typeof data.serverUrl === 'string' && data.serverUrl) safeSet('minisketch.v1.ext.serverUrl', data.serverUrl);
      if (typeof data.extAutoUpdate === 'boolean') {
        safeSet('minisketch.v1.ext.autoUpdate', data.extAutoUpdate ? '1' : '0');
        const chk = document.getElementById('ext-auto-update');
        if (chk) chk.checked = data.extAutoUpdate;
      }
      if (data.githubCfg && typeof data.githubCfg === 'object') safeJson('minisketch.v1.ext.githubCfg', data.githubCfg);
      if (data.settings && typeof data.settings === 'object') safeJson('minisketch.settings.v1', data.settings);
      if (Array.isArray(data.aiProviders)) safeJson('minisketch.ai.providers.v1', data.aiProviders);
      if (data.pickFilter && typeof data.pickFilter === 'object') safeJson('minisketch.pickfilter.v1', data.pickFilter);
      if (data.view && typeof data.view === 'object') safeJson('minisketch.v1.view', data.view);
      if (data.cncConfig && typeof data.cncConfig === 'object') safeJson('minisketch.cnc.v2', data.cncConfig);
      if (typeof data.costPresets === 'string' && data.costPresets) safeSet('minisketch.costPresets.v1', data.costPresets);
      if (data.nestPrefs && typeof data.nestPrefs === 'object') safeJson('minisketch.v1.nestPrefs', data.nestPrefs);
      if (data.imgOpts && typeof data.imgOpts === 'object') safeJson('minisketch.v1.imgOpts', data.imgOpts);
      if (Array.isArray(data.fontFavorites)) safeJson('minisketch.fontFavorites.v1', data.fontFavorites);
      if (data.textPrefs && typeof data.textPrefs === 'object') {
        if (typeof data.textPrefs.fitCurve === 'boolean') safeSet('minisketch.textFitCurve.v1', data.textPrefs.fitCurve ? '1' : '0');
        if (isFinite(+data.textPrefs.height)) safeSet('minisketch.textHeight.v1', String(data.textPrefs.height));
        if (data.textPrefs.style && typeof data.textPrefs.style === 'object') safeJson('minisketch.textStyle.v1', data.textPrefs.style);
        if (typeof data.textPrefs.otCurLayer === 'string' && data.textPrefs.otCurLayer) safeSet('minisketch.otCurrentLayer.v1', data.textPrefs.otCurLayer);
      }
      if (data.toolParams && typeof data.toolParams === 'object') applyLocalToolParams(data.toolParams);
      if (Array.isArray(data.disabledExtensions)) {
        safeJson('minisketch.v1.ext.disabled', data.disabledExtensions);
        if (window.MiniSketchTools && window.MiniSketchTools.setDisabledList) {
          window.MiniSketchTools.setDisabledList(data.disabledExtensions);
        }
      }
      if (window.MiniSketchSyncBridge && window.MiniSketchSyncBridge.applyPrefsBundle) {
        window.MiniSketchSyncBridge.applyPrefsBundle(data);
      }
    } finally {
      applyingRemote = false;
    }
  }

  async function pushPreferences() {
    if (!currentUser || !db || !fbFsMod || applyingRemote) return;
    const path = 'users/' + currentUser.uid + '/sync_docs/' + PREF_DOC_ID;
    const ref = fbFsMod.doc(db, 'users', currentUser.uid, 'sync_docs', PREF_DOC_ID);
    const payload = collectPreferencesPayload();
    if (utf8Bytes(payload) > MAX_DOC_BYTES) return;
    await upsertDoc(ref, payload, path);
  }

  // ---- Extensions Sync -----------------------------------------------------
  function sanitizeExtensionRecord(rec) {
    if (!rec || !rec.id || !rec.code) return null;
    const id = String(rec.id).trim().toLowerCase();
    if (!/^[a-z][a-z0-9-]{1,39}$/.test(id)) return null;
    const code = String(rec.code).slice(0, 220000);
    return {
      id,
      name: String(rec.name || rec.label || id).slice(0, 120),
      label: String(rec.label || rec.name || id).slice(0, 120),
      title: String(rec.title || '').slice(0, 300),
      version: String(rec.version || '1.0.0').slice(0, 32),
      author: String(rec.author || 'Community').slice(0, 120),
      category: String(rec.category || 'CNC Utility').slice(0, 80),
      description: String(rec.description || '').slice(0, 1000),
      icon: String(rec.icon || '').slice(0, 8192),
      source: String(rec.source || 'local').slice(0, 40),
      sourceUrl: String(rec.sourceUrl || '').slice(0, 1024),
      catalogUrl: String(rec.catalogUrl || '').slice(0, 1024),
      code,
      installedAt: String(rec.installedAt || new Date().toISOString()).slice(0, 64),
      updatedAtStr: String(rec.updatedAt || rec.updatedAtStr || new Date().toISOString()).slice(0, 64)
    };
  }

  async function pushExtensionRecord(rec) {
    if (!currentUser || !db || !fbFsMod || applyingRemote) return;
    const clean = sanitizeExtensionRecord(rec);
    if (!clean) return;
    const path = 'users/' + currentUser.uid + '/extensions/' + clean.id;
    const ref = fbFsMod.doc(db, 'users', currentUser.uid, 'extensions', clean.id);
    if (utf8Bytes(clean) > MAX_DOC_BYTES) return;
    await upsertDoc(ref, clean, path);
  }

  async function deleteRemoteExtension(id) {
    if (!currentUser || !db || !fbFsMod || applyingRemote) return;
    const key = String(id || '').trim().toLowerCase();
    if (!/^[a-z][a-z0-9-]{1,39}$/.test(key)) return;
    const path = 'users/' + currentUser.uid + '/extensions/' + key;
    const ref = fbFsMod.doc(db, 'users', currentUser.uid, 'extensions', key);
    try {
      await fbFsMod.deleteDoc(ref);
      createdAtCache.delete(path);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  }

  // ---- Active & Saved Sketches Sync ----------------------------------------
  async function collectSketchPayload(sketchId, overrideName) {
    const bridge = window.MiniSketchSyncBridge;
    if (!bridge || !bridge.exportActiveDoc) return null;
    const exp = bridge.exportActiveDoc();
    if (!exp || !exp.doc || !exp.doc.state) return null;
    const rawState = exp.doc.state;
    const entityCount = rawState.entities ? Object.keys(rawState.entities).length : 0;
    const packed = await compressSketchState(rawState, fbFsMod);
    const payload = {
      id: String(sketchId || ACTIVE_SKETCH_ID),
      name: String(overrideName || exp.name || 'Untitled').slice(0, 200),
      format: String(exp.doc.format || 'minisketch').slice(0, 40),
      version: Number(exp.doc.version) || 3,
      isActive: sketchId === ACTIVE_SKETCH_ID,
      entityCount,
      state: packed.state,
      view: toFs(exp.doc.view || {}, false),
      updatedAtMs: Date.now()
    };
    return { payload, packed };
  }

  async function pushSketch(sketchId, overrideName) {
    if (!currentUser || !db || !fbFsMod || applyingRemote) return { ok: false, reason: 'unavailable' };
    const id = String(sketchId || ACTIVE_SKETCH_ID);
    const collected = await collectSketchPayload(id, overrideName);
    if (!collected) return { ok: false, reason: 'empty' };
    const { payload, packed } = collected;
    const docBytes = estimateFirestoreBytes(payload);
    if (docBytes > MAX_DOC_BYTES) {
      return {
        ok: false,
        reason: 'too-large',
        bytes: docBytes,
        compressed: packed.compressed,
        rawBytes: packed.rawBytes,
        gzBytes: packed.gzBytes
      };
    }
    const path = 'users/' + currentUser.uid + '/sketches/' + id;
    const ref = fbFsMod.doc(db, 'users', currentUser.uid, 'sketches', id);
    await upsertDoc(ref, payload, path);
    return {
      ok: true,
      bytes: docBytes,
      compressed: packed.compressed,
      rawBytes: packed.rawBytes,
      gzBytes: packed.gzBytes
    };
  }

  async function deleteCloudSketch(sketchId) {
    if (!currentUser || !db || !fbFsMod) return;
    const id = String(sketchId || '');
    if (!id || id === ACTIVE_SKETCH_ID) return;
    const path = 'users/' + currentUser.uid + '/sketches/' + id;
    const ref = fbFsMod.doc(db, 'users', currentUser.uid, 'sketches', id);
    try {
      await fbFsMod.deleteDoc(ref);
      createdAtCache.delete(path);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  }

  async function applyCloudSketchToCanvas(remoteDoc, predecodedState) {
    const bridge = window.MiniSketchSyncBridge;
    if (!bridge || !bridge.applyRemoteSketch || !remoteDoc || !remoteDoc.state) return;
    applyingRemote = true;
    try {
      const dec = fromFs(remoteDoc);
      const stateObj = predecodedState || await decompressSketchState(dec.state);
      if (!stateObj || typeof stateObj !== 'object') return;
      bridge.applyRemoteSketch({
        format: dec.format || 'minisketch',
        version: dec.version || 3,
        state: stateObj,
        view: dec.view || null
      }, dec.name || 'Untitled');
    } catch (err) {
      console.warn('[minisketch-cloud] Failed to decompress/apply cloud sketch:', err);
      if (bridge.toast) {
        bridge.toast('Failed to decompress cloud sketch.', { type: 'error' });
      }
    } finally {
      applyingRemote = false;
    }
  }

  // ---- AI Chat Sessions Sync -----------------------------------------------
  function prepareCloudChatPayload(sess) {
    if (!sess || !sess.id) return null;
    const msgs = Array.isArray(sess.messages) ? sess.messages.slice(-200) : [];
    const mapMsgs = (stripImgFromIdx) => msgs.map((m, idx) => {
      const c = {
        role: String(m.role || 'user'),
        text: String(m.text || ''),
        done: !!m.done
      };
      if (m.at) c.at = Number(m.at) || 0;
      if (m.ops) c.ops = toFs(m.ops, false);
      if (m.think) c.think = String(m.think);
      if (Array.isArray(m.images) && m.images.length && idx >= stripImgFromIdx) {
        c.images = m.images.filter(s => typeof s === 'string' && s.startsWith('data:image/'));
      }
      return c;
    });

    const base = {
      id: String(sess.id).slice(0, 128),
      title: String(sess.title || 'Percakapan baru').slice(0, 200),
      archived: !!sess.archived,
      at: Number(sess.at) || Date.now(),
      updatedAtMs: Number(sess.updatedAt) || Number(sess.updatedAtMs) || Date.now(),
      count: msgs.length,
      img: !!sess.img || msgs.some(m => Array.isArray(m.images) && m.images.length > 0),
      messages: mapMsgs(0)
    };
    if (utf8Bytes(base) <= MAX_CHAT_BYTES) return base;
    // Strip oldest attached base64 images progressively so text/SVG/code syncs within 1MB cap.
    for (let i = 1; i <= msgs.length; i++) {
      base.messages = mapMsgs(i);
      if (utf8Bytes(base) <= MAX_CHAT_BYTES) return base;
    }
    base.messages = mapMsgs(msgs.length);
    if (utf8Bytes(base) > MAX_CHAT_BYTES) return null;
    return base;
  }

  async function pushChatSession(sess) {
    if (!currentUser || !db || !fbFsMod || applyingRemote) return;
    const payload = prepareCloudChatPayload(sess);
    if (!payload) return;
    const path = 'users/' + currentUser.uid + '/chat_sessions/' + payload.id;
    const ref = fbFsMod.doc(db, 'users', currentUser.uid, 'chat_sessions', payload.id);
    await upsertDoc(ref, payload, path);
  }

  async function deleteRemoteChatSession(id) {
    if (!currentUser || !db || !fbFsMod || applyingRemote) return;
    const key = String(id || '').trim();
    if (!key) return;
    const path = 'users/' + currentUser.uid + '/chat_sessions/' + key;
    const ref = fbFsMod.doc(db, 'users', currentUser.uid, 'chat_sessions', key);
    try {
      await fbFsMod.deleteDoc(ref);
      createdAtCache.delete(path);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  }

  // ---- Initial Sync & Realtime Subscriptions -------------------------------
  function clearSubscriptions() {
    for (const fn of [unsubPrefs, unsubExts, unsubActiveSketch, unsubAllSketches, unsubChats]) {
      if (typeof fn === 'function') { try { fn(); } catch (err) {} }
    }
    unsubPrefs = unsubExts = unsubActiveSketch = unsubAllSketches = unsubChats = null;
  }

  async function refreshCloudSketches(user) {
    if (!db || !fbFsMod || !user) return [];
    const skColPath = 'users/' + user.uid + '/sketches';
    try {
      const snap = await fbFsMod.getDocs(fbFsMod.collection(db, 'users', user.uid, 'sketches'));
      const list = [];
      snap.forEach(d => {
        const v = d.data();
        if (v && v.id) {
          if (v.createdAt) createdAtCache.set(skColPath + '/' + d.id, v.createdAt);
          list.push(fromFs(v));
        }
      });
      cloudSketches = list.sort((a, b) => (Number(b.updatedAtMs) || 0) - (Number(a.updatedAtMs) || 0));
      renderCloudModal();
      return cloudSketches;
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, skColPath);
      return cloudSketches;
    }
  }

  async function pullFromCloudForUser(user, opts) {
    const o = opts || {};
    // 1. Preferences
    const prefPath = 'users/' + user.uid + '/sync_docs/' + PREF_DOC_ID;
    const prefRef = fbFsMod.doc(db, 'users', user.uid, 'sync_docs', PREF_DOC_ID);
    let prefSnap = null;
    try {
      prefSnap = await fbFsMod.getDoc(prefRef);
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, prefPath);
    }
    if (prefSnap && prefSnap.exists()) {
      const remote = prefSnap.data();
      if (remote && remote.createdAt) createdAtCache.set(prefPath, remote.createdAt);
      applyRemotePreferences(remote);
    } else if (o.pushIfMissing) {
      await pushPreferences();
    }

    // 2. Installed Extensions
    const extColPath = 'users/' + user.uid + '/extensions';
    let extSnaps = null;
    try {
      extSnaps = await fbFsMod.getDocs(fbFsMod.collection(db, 'users', user.uid, 'extensions'));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, extColPath);
    }
    const cloudExtMap = new Map();
    if (extSnaps) {
      extSnaps.forEach(d => {
        const v = d.data();
        if (v && v.id) {
          if (v.createdAt) createdAtCache.set(extColPath + '/' + d.id, v.createdAt);
          cloudExtMap.set(v.id, v);
        }
      });
    }
    const localExts = (window.MiniSketchTools && window.MiniSketchTools.exportExtensions)
      ? window.MiniSketchTools.exportExtensions()
      : [];
    const mergedExts = new Map();
    for (const [id, c] of cloudExtMap) mergedExts.set(id, c);
    for (const l of localExts) {
      const c = mergedExts.get(l.id);
      const lTime = Date.parse(l.updatedAt || l.installedAt || '') || 0;
      const cTime = Date.parse((c && (c.updatedAtStr || c.installedAt)) || '') || 0;
      if (!c || lTime > cTime) {
        mergedExts.set(l.id, l);
        if (o.pushIfMissing) await pushExtensionRecord(l);
      }
    }
    if (mergedExts.size && window.MiniSketchTools && window.MiniSketchTools.replaceSyncedExtensions) {
      applyingRemote = true;
      try {
        window.MiniSketchTools.replaceSyncedExtensions([...mergedExts.values()]);
      } finally {
        applyingRemote = false;
      }
    }

    // 3. Active Sketch (safe non-destructive pull)
    const activePath = 'users/' + user.uid + '/sketches/' + ACTIVE_SKETCH_ID;
    const activeRef = fbFsMod.doc(db, 'users', user.uid, 'sketches', ACTIVE_SKETCH_ID);
    let activeSnap = null;
    try {
      activeSnap = await fbFsMod.getDoc(activeRef);
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, activePath);
    }
    const bridge = window.MiniSketchSyncBridge;
    const localDirty = bridge && bridge.hasUserLocalWork ? bridge.hasUserLocalWork() : userEditedLocalDoc;
    if (activeSnap && activeSnap.exists()) {
      const remoteSketch = activeSnap.data();
      if (remoteSketch && remoteSketch.createdAt) createdAtCache.set(activePath, remoteSketch.createdAt);
      const remoteCount = Number(remoteSketch && remoteSketch.entityCount) || 0;
      if (!localDirty || o.forcePromptCanvas) {
        if (!localDirty) {
          await applyCloudSketchToCanvas(remoteSketch);
        } else if (remoteCount > 0 && bridge && bridge.confirmSyncOverwrite) {
          const useCloud = await bridge.confirmSyncOverwrite(remoteSketch.name || 'Cloud Sketch', remoteCount);
          if (useCloud) await applyCloudSketchToCanvas(remoteSketch);
          else if (o.pushIfMissing) await pushSketch(ACTIVE_SKETCH_ID);
        }
      } else if (o.pushIfMissing) {
        if (remoteCount > 0 && bridge && bridge.confirmSyncOverwrite) {
          const useCloud = await bridge.confirmSyncOverwrite(remoteSketch.name || 'Cloud Sketch', remoteCount);
          if (useCloud) await applyCloudSketchToCanvas(remoteSketch);
          else await pushSketch(ACTIVE_SKETCH_ID);
        } else {
          await pushSketch(ACTIVE_SKETCH_ID);
        }
      }
    } else if (o.pushIfMissing) {
      await pushSketch(ACTIVE_SKETCH_ID);
    }

    // 4. AI Chat Sessions (merge cloud -> local IDB)
    const chatColPath = 'users/' + user.uid + '/chat_sessions';
    let chatSnaps = null;
    try {
      chatSnaps = await fbFsMod.getDocs(fbFsMod.collection(db, 'users', user.uid, 'chat_sessions'));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, chatColPath);
    }
    const chatNS = window.MiniSketchAI;
    if (chatNS && chatNS.exportAllSessions) {
      const localSessions = await chatNS.exportAllSessions();
      const localMap = new Map(localSessions.map(s => [s.id, s]));
      const cloudMap = new Map();
      if (chatSnaps) {
        chatSnaps.forEach(d => {
          const v = fromFs(d.data());
          if (v && v.id) {
            if (d.data().createdAt) createdAtCache.set(chatColPath + '/' + d.id, d.data().createdAt);
            cloudMap.set(v.id, v);
          }
        });
      }
      if (chatNS.importSyncedSessions) {
        const toImport = [];
        for (const [id, c] of cloudMap) {
          const l = localMap.get(id);
          const cMs = Number(c.updatedAtMs) || 0;
          const lMs = Number(l && (l.updatedAt || l.updatedAtMs)) || 0;
          if (!l || cMs > lMs) toImport.push(c);
        }
        if (toImport.length) {
          applyingRemote = true;
          try { await chatNS.importSyncedSessions(toImport); }
          finally { applyingRemote = false; }
        }
      }
      if (o.pushIfMissing) {
        for (const l of localSessions) {
          const c = cloudMap.get(l.id);
          const lMs = Number(l.updatedAt || l.updatedAtMs) || 0;
          const cMs = Number(c && c.updatedAtMs) || 0;
          if ((!c || lMs > cMs) && Array.isArray(l.messages) && l.messages.length > 0) {
            await pushChatSession(l);
          }
        }
      }
    }

    await refreshCloudSketches(user);
  }

  async function initialSyncForUser(user) {
    try {
      let lastProfileUid = '';
      try { lastProfileUid = localStorage.getItem(PROFILE_UID_KEY) || ''; } catch (err) {}
      if (lastProfileUid !== user.uid) {
        await syncUserProfile(user);
        try { localStorage.setItem(PROFILE_UID_KEY, user.uid); } catch (err) {}
      }

      if (!isAutoSync()) {
        clearSubscriptions();
        // Manual mode (default): zero automatic uploads while editing or reloading.
        // Only hydrate on a completely fresh/empty browser, otherwise just load the Saved Cloud Sketches list.
        const bridge = window.MiniSketchSyncBridge;
        const localDirty = bridge && bridge.hasUserLocalWork ? bridge.hasUserLocalWork() : userEditedLocalDoc;
        const localExts = (window.MiniSketchTools && window.MiniSketchTools.exportExtensions)
          ? window.MiniSketchTools.exportExtensions() : [];
        if (!localDirty && localExts.length === 0) {
          await pullFromCloudForUser(user, { pushIfMissing: false });
        } else {
          await refreshCloudSketches(user);
        }
        setSyncState('synced', pendingSync ? 'Manual sync · unsynced local changes' : 'Manual sync ready');
        return;
      }

      setSyncState('syncing', 'Syncing workspace…');
      await pullFromCloudForUser(user, { pushIfMissing: true });
      startRealtimeListeners(user);
      setPendingSync(false);
      setSyncState('synced', 'All synced');
    } catch (err) {
      setSyncState('error', 'Sync error');
      console.warn('[minisketch-cloud] initial sync error:', err);
    }
  }

  function startRealtimeListeners(user) {
    clearSubscriptions();
    if (!db || !fbFsMod || !user) return;
    let bootSnapFlags = { prefs: true, exts: true, sketches: true, chats: true };

    const prefPath = 'users/' + user.uid + '/sync_docs/' + PREF_DOC_ID;
    unsubPrefs = fbFsMod.onSnapshot(
      fbFsMod.doc(db, 'users', user.uid, 'sync_docs', PREF_DOC_ID),
      (snap) => {
        if (bootSnapFlags.prefs) { bootSnapFlags.prefs = false; return; }
        if (!snap.exists() || snap.metadata.hasPendingWrites) return;
        const data = snap.data();
        if (data && data.createdAt) createdAtCache.set(prefPath, data.createdAt);
        applyRemotePreferences(data);
        setSyncState('synced', 'Synced from another device');
      },
      (err) => handleFirestoreError(err, OperationType.GET, prefPath)
    );

    const extColPath = 'users/' + user.uid + '/extensions';
    unsubExts = fbFsMod.onSnapshot(
      fbFsMod.collection(db, 'users', user.uid, 'extensions'),
      (snap) => {
        if (bootSnapFlags.exts) { bootSnapFlags.exts = false; return; }
        if (snap.metadata.hasPendingWrites) return;
        const list = [];
        snap.forEach(d => {
          const v = d.data();
          if (v && v.id) {
            if (v.createdAt) createdAtCache.set(extColPath + '/' + d.id, v.createdAt);
            list.push(v);
          }
        });
        if (window.MiniSketchTools && window.MiniSketchTools.replaceSyncedExtensions) {
          applyingRemote = true;
          try { window.MiniSketchTools.replaceSyncedExtensions(list, { pruneMissing: true }); }
          finally { applyingRemote = false; }
        }
      },
      (err) => handleFirestoreError(err, OperationType.LIST, extColPath)
    );

    const skColPath = 'users/' + user.uid + '/sketches';
    unsubAllSketches = fbFsMod.onSnapshot(
      fbFsMod.collection(db, 'users', user.uid, 'sketches'),
      async (snap) => {
        const list = [];
        snap.forEach(d => {
          const v = d.data();
          if (v && v.id) {
            if (v.createdAt) createdAtCache.set(skColPath + '/' + d.id, v.createdAt);
            list.push(fromFs(v));
          }
        });
        cloudSketches = list.sort((a, b) => (Number(b.updatedAtMs) || 0) - (Number(a.updatedAtMs) || 0));
        renderCloudModal();
        if (bootSnapFlags.sketches) { bootSnapFlags.sketches = false; return; }
        if (snap.metadata.hasPendingWrites) return;
        const active = list.find(x => x.id === ACTIVE_SKETCH_ID);
        if (active && (!window.MiniSketchSyncBridge || !window.MiniSketchSyncBridge.isDragging || !window.MiniSketchSyncBridge.isDragging())) {
          const curBridge = window.MiniSketchSyncBridge;
          const localStr = curBridge && curBridge.exportActiveDoc ? JSON.stringify(curBridge.exportActiveDoc().doc.state) : '';
          try {
            const remoteState = await decompressSketchState(active.state);
            const remoteStr = remoteState ? JSON.stringify(remoteState) : '';
            if (remoteStr && remoteStr !== localStr) {
              await applyCloudSketchToCanvas(active, remoteState);
            }
          } catch (err) {
            console.warn('[minisketch-cloud] Active sketch snapshot decode failed:', err);
          }
        }
      },
      (err) => handleFirestoreError(err, OperationType.LIST, skColPath)
    );

    const chatColPath = 'users/' + user.uid + '/chat_sessions';
    unsubChats = fbFsMod.onSnapshot(
      fbFsMod.collection(db, 'users', user.uid, 'chat_sessions'),
      async (snap) => {
        if (bootSnapFlags.chats) { bootSnapFlags.chats = false; return; }
        if (snap.metadata.hasPendingWrites) return;
        const chatNS = window.MiniSketchAI;
        if (!chatNS || !chatNS.importSyncedSessions) return;
        const items = [];
        snap.forEach(d => {
          const raw = d.data();
          if (raw && raw.id) {
            if (raw.createdAt) createdAtCache.set(chatColPath + '/' + d.id, raw.createdAt);
            items.push(fromFs(raw));
          }
        });
        applyingRemote = true;
        try { await chatNS.importSyncedSessions(items); }
        finally { applyingRemote = false; }
      },
      (err) => handleFirestoreError(err, OperationType.LIST, chatColPath)
    );
  }

  // ---- Community Marketplace (Firestore) -----------------------------------
  NS.listMarketplace = async () => {
    if (!available || !db || !fbFsMod) return [];
    const colPath = 'marketplace_extensions';
    try {
      const snaps = await fbFsMod.getDocs(fbFsMod.collection(db, colPath));
      const out = [];
      snaps.forEach(d => {
        const v = d.data();
        if (v && v.id && v.code) {
          if (v.createdAt) createdAtCache.set(colPath + '/' + d.id, v.createdAt);
          out.push(Object.assign({}, v, { sourceType: 'cloud' }));
        }
      });
      cachedMarketplace = out;
      return out;
    } catch (err) {
      console.warn('[minisketch-cloud] Marketplace list failed (offline/unavailable):', err);
      return cachedMarketplace || [];
    }
  };

  NS.publishMarketplace = async (payload, overwrite) => {
    if (!available || !db || !fbFsMod) {
      return { ok: false, error: 'Cloud Marketplace requires online connection.' };
    }
    if (!currentUser) {
      return { ok: false, error: 'Sign in with Google first to publish to Cloud Community.' };
    }
    const id = String((payload && payload.id) || '').trim().toLowerCase();
    if (!/^[a-z][a-z0-9-]{1,39}$/.test(id)) {
      return { ok: false, error: 'Invalid Extension ID (use 2-40 lowercase letters, digits, hyphens).' };
    }
    const path = 'marketplace_extensions/' + id;
    const ref = fbFsMod.doc(db, 'marketplace_extensions', id);
    let existing = null;
    try {
      const snap = await fbFsMod.getDoc(ref);
      if (snap.exists()) existing = snap.data();
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, path);
    }

    if (existing) {
      if (existing.authorUid !== currentUser.uid) {
        return { ok: false, error: 'Extension ID "' + id + '" is already owned by another publisher. Use a different ID.' };
      }
      if (!overwrite) {
        return { ok: false, error: 'Extension "' + id + '" already exists. Enable Overwrite to update your release.' };
      }
    }

    const docData = {
      id,
      name: String(payload.name || payload.label || id).slice(0, 120),
      label: String(payload.label || payload.name || id).slice(0, 120),
      version: String(payload.version || '1.0.0').slice(0, 32),
      author: String(payload.author || currentUser.displayName || 'Community').slice(0, 120),
      authorUid: currentUser.uid,
      category: String(payload.category || 'CNC Utility').slice(0, 80),
      description: String(payload.description || '').slice(0, 1000),
      icon: String(payload.icon || '').slice(0, 8192),
      code: String(payload.code || '').slice(0, 220000)
    };
    await upsertDoc(ref, docData, path, existing && existing.createdAt);
    return { ok: true, item: Object.assign({}, docData, { sourceType: 'cloud' }) };
  };

  NS.deleteMarketplace = async (id) => {
    if (!available || !db || !fbFsMod || !currentUser) {
      return { ok: false, error: 'Sign in with Google required.' };
    }
    const key = String(id || '').trim().toLowerCase();
    const path = 'marketplace_extensions/' + key;
    const ref = fbFsMod.doc(db, 'marketplace_extensions', key);
    try {
      await fbFsMod.deleteDoc(ref);
      createdAtCache.delete(path);
      return { ok: true };
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
      return { ok: false, error: String(err && err.message || err) };
    }
  };

  // ---- Auth Actions & Public Sync Notifications ----------------------------
  NS.signIn = async () => {
    if (!available || !auth || !fbAuthMod) {
      if (window.MiniSketchSyncBridge && window.MiniSketchSyncBridge.toast) {
        window.MiniSketchSyncBridge.toast('Cloud login is unavailable offline or on file:// — MiniSketch works 100% locally.');
      }
      return null;
    }
    try {
      const provider = new fbAuthMod.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const cred = await fbAuthMod.signInWithPopup(auth, provider);
      return cred ? cred.user : null;
    } catch (err) {
      const code = err && err.code;
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return null;
      console.warn('[minisketch-cloud] signIn failed:', err);
      if (window.MiniSketchSyncBridge && window.MiniSketchSyncBridge.toast) {
        window.MiniSketchSyncBridge.toast('Google Sign-In failed: ' + String(err && err.message || err), { type: 'error' });
      }
      return null;
    }
  };

  NS.signOut = async () => {
    clearSubscriptions();
    if (auth && fbAuthMod) {
      try { await fbAuthMod.signOut(auth); } catch (err) { /* ignore */ }
    }
    currentUser = null;
    cloudSketches = [];
    setSyncState('guest', 'Signed out (local mode)');
    if (window.MiniSketchSyncBridge && window.MiniSketchSyncBridge.toast) {
      window.MiniSketchSyncBridge.toast('Signed out — local workspace stays intact');
    }
  };

  NS.scheduleSync = (kind) => {
    if (applyingRemote) return;
    if (kind === 'doc') userEditedLocalDoc = true;
    if (!currentUser || !available) return;
    if (!isAutoSync()) {
      clearTimeout(prefsTimer);
      clearTimeout(docTimer);
      if (!pendingSync) setPendingSync(true);
      return;
    }
    if (kind === 'prefs') {
      clearTimeout(prefsTimer);
      prefsTimer = setTimeout(() => {
        prefsTimer = null;
        setSyncState('syncing');
        pushPreferences().then(() => setSyncState('synced')).catch(() => setSyncState('error'));
      }, 900);
    } else if (kind === 'doc') {
      clearTimeout(docTimer);
      docTimer = setTimeout(() => {
        docTimer = null;
        setSyncState('syncing');
        pushSketch(ACTIVE_SKETCH_ID).then((r) => {
          if (r && r.reason === 'too-large') setSyncState('error', 'Sketch >900KB compressed (local only)');
          else setSyncState('synced');
        }).catch(() => setSyncState('error'));
      }, 1500);
    }
  };

  NS.syncNow = async () => {
    if (!currentUser || !available) return;
    clearTimeout(prefsTimer);
    clearTimeout(docTimer);
    setSyncState('syncing', 'Uploading to Cloud…');
    try {
      await syncUserProfile(currentUser);
      try { localStorage.setItem(PROFILE_UID_KEY, currentUser.uid); } catch (err) {}

      // Flush any deletes made while in manual mode
      const dels = loadPendingDeletes();
      for (const id of dels.exts) { await deleteRemoteExtension(id); }
      for (const id of dels.chats) { await deleteRemoteChatSession(id); }
      savePendingDeletes({ exts: [], chats: [] });

      await pushPreferences();
      const r = await pushSketch(ACTIVE_SKETCH_ID);
      if (r && r.reason === 'too-large' && window.MiniSketchSyncBridge && window.MiniSketchSyncBridge.toast) {
        const kb = r.bytes ? (' (' + Math.round(r.bytes / 1024) + ' KB)') : '';
        window.MiniSketchSyncBridge.toast('Sketch exceeds 900KB limit even after compression' + kb + ' — saved locally.', { type: 'warn' });
      }
      if (window.MiniSketchTools && window.MiniSketchTools.exportExtensions) {
        for (const ext of window.MiniSketchTools.exportExtensions()) {
          await pushExtensionRecord(ext);
        }
      }
      if (window.MiniSketchAI && window.MiniSketchAI.exportAllSessions) {
        for (const sess of await window.MiniSketchAI.exportAllSessions()) {
          if (Array.isArray(sess.messages) && sess.messages.length > 0) await pushChatSession(sess);
        }
      }
      await refreshCloudSketches(currentUser);
      setPendingSync(false);
      setSyncState('synced', 'Synced just now');
      if (window.MiniSketchSyncBridge && window.MiniSketchSyncBridge.toast) {
        window.MiniSketchSyncBridge.toast('Cloud sync complete');
      }
    } catch (err) {
      setSyncState('error', 'Sync error');
    }
  };

  NS.pullNow = async () => {
    if (!currentUser || !available) return;
    setSyncState('syncing', 'Downloading from Cloud…');
    try {
      await pullFromCloudForUser(currentUser, { pushIfMissing: false, forcePromptCanvas: true });
      setPendingSync(false);
      setSyncState('synced', 'Pulled from Cloud');
      if (window.MiniSketchSyncBridge && window.MiniSketchSyncBridge.toast) {
        window.MiniSketchSyncBridge.toast('Downloaded latest data from Cloud');
      }
    } catch (err) {
      setSyncState('error', 'Pull error');
    }
  };

  NS.setAutoSync = async (enabled) => {
    const on = !!enabled;
    try { localStorage.setItem(AUTO_SYNC_KEY, on ? '1' : '0'); } catch (err) {}
    if (!on) {
      clearTimeout(prefsTimer);
      clearTimeout(docTimer);
      clearSubscriptions();
      renderAuthChip();
      renderCloudModal();
      return;
    }
    if (currentUser && available) {
      await NS.syncNow();
      startRealtimeListeners(currentUser);
    }
  };

  NS.onExtensionSaved = (rec) => {
    if (applyingRemote || !currentUser || !available) return;
    if (!isAutoSync()) { setPendingSync(true); return; }
    pushExtensionRecord(rec).catch(() => {});
  };
  NS.onExtensionDeleted = (id) => {
    if (applyingRemote || !currentUser || !available) return;
    if (!isAutoSync()) {
      queuePendingDelete('ext', String(id || '').trim().toLowerCase());
      setPendingSync(true);
      return;
    }
    deleteRemoteExtension(id).catch(() => {});
  };
  NS.onDisabledExtensionsChanged = () => {
    NS.scheduleSync('prefs');
  };
  NS.onChatSessionSaved = (sess) => {
    if (applyingRemote || !currentUser || !available || !sess) return;
    if (!isAutoSync()) { setPendingSync(true); return; }
    pushChatSession(sess).catch(() => {});
  };
  NS.onChatSessionDeleted = (id) => {
    if (applyingRemote || !currentUser || !available || !id) return;
    if (!isAutoSync()) {
      queuePendingDelete('chat', String(id || '').trim());
      setPendingSync(true);
      return;
    }
    deleteRemoteChatSession(id).catch(() => {});
  };

  NS.onAuthChange = (fn) => {
    if (typeof fn === 'function') authListeners.add(fn);
    return () => authListeners.delete(fn);
  };

  NS.getStatus = () => ({
    available,
    ready,
    syncState,
    autoSync: isAutoSync(),
    pendingSync,
    lastSyncAt,
    user: currentUser ? {
      uid: currentUser.uid,
      email: currentUser.email,
      displayName: currentUser.displayName,
      photoURL: currentUser.photoURL
    } : null
  });

  // ---- Cloud Account & Sketches Modal UI -----------------------------------
  function renderCloudModal() {
    const modal = document.getElementById('cloud-modal');
    if (!modal || modal.classList.contains('hidden')) return;
    const guestPane = document.getElementById('cloud-guest-pane');
    const userPane = document.getElementById('cloud-user-pane');
    const offNote = document.getElementById('cloud-offline-note');

    if (!available) {
      if (guestPane) guestPane.hidden = false;
      if (userPane) userPane.hidden = true;
      if (offNote) {
        offNote.hidden = false;
        offNote.textContent = 'Running in offline / local-only mode. Sketches, settings, AI history, and extensions are stored locally in your browser.';
      }
      return;
    }

    if (offNote) offNote.hidden = true;
    if (!currentUser) {
      if (guestPane) guestPane.hidden = false;
      if (userPane) userPane.hidden = true;
      return;
    }

    if (guestPane) guestPane.hidden = true;
    if (userPane) userPane.hidden = false;

    const autoChk = document.getElementById('cloud-autosync-chk');
    if (autoChk) autoChk.checked = isAutoSync();

    const uName = document.getElementById('cloud-user-name');
    const uMail = document.getElementById('cloud-user-email');
    const uAv = document.getElementById('cloud-user-avatar');
    const uState = document.getElementById('cloud-sync-state');
    if (uName) uName.textContent = currentUser.displayName || 'Google Account';
    if (uMail) uMail.textContent = currentUser.email || '';
    if (uAv) {
      if (currentUser.photoURL) { uAv.src = currentUser.photoURL; uAv.hidden = false; }
      else uAv.hidden = true;
    }
    if (uState) {
      const tStr = lastSyncAt ? (' · ' + new Date(lastSyncAt).toLocaleTimeString()) : '';
      if (syncState === 'syncing') {
        uState.textContent = 'Syncing with Cloud…';
      } else if (syncState === 'error') {
        uState.textContent = 'Sync error (local autosave remains active)';
      } else if (!isAutoSync()) {
        uState.textContent = pendingSync
          ? ('Manual sync · unsynced local changes' + tStr)
          : ('Manual sync · up to date' + tStr);
      } else {
        uState.textContent = 'Auto-sync active' + tStr;
      }
    }

    const listEl = document.getElementById('cloud-sketch-list');
    if (listEl) {
      listEl.innerHTML = '';
      if (!cloudSketches.length) {
        const emp = document.createElement('div');
        emp.className = 'ext-empty';
        emp.textContent = 'No cloud sketches yet.';
        listEl.appendChild(emp);
      } else {
        for (const sk of cloudSketches) {
          const row = document.createElement('div');
          row.className = 'cloud-sketch-row';
          const info = document.createElement('div');
          info.className = 'cloud-sketch-info';
          const ttl = document.createElement('div');
          ttl.className = 'cloud-sketch-name';
          ttl.textContent = sk.name + (sk.id === ACTIVE_SKETCH_ID ? ' (Active Workspace)' : '');
          const sub = document.createElement('div');
          sub.className = 'cloud-sketch-meta';
          const dt = sk.updatedAtMs ? new Date(sk.updatedAtMs).toLocaleString() : '';
          let gzLabel = '';
          if (sk.state && sk.state._enc && Number(sk.state.gzBytes) > 0) {
            const kb = Math.max(1, Math.round(Number(sk.state.gzBytes) / 1024));
            gzLabel = ' · ' + kb + ' KB (gzip)';
          }
          sub.textContent = (Number(sk.entityCount) || 0) + ' entities' + gzLabel + (dt ? (' · ' + dt) : '');
          info.appendChild(ttl);
          info.appendChild(sub);

          const acts = document.createElement('div');
          acts.className = 'cloud-sketch-actions';
          const loadBtn = document.createElement('button');
          loadBtn.type = 'button';
          loadBtn.className = 'btn small primary';
          loadBtn.textContent = 'Load';
          loadBtn.addEventListener('click', async () => {
            if (window.MiniSketchSyncBridge && window.MiniSketchSyncBridge.confirmLoadCloudSketch) {
              const ok = await window.MiniSketchSyncBridge.confirmLoadCloudSketch(sk.name);
              if (!ok) return;
            }
            await applyCloudSketchToCanvas(sk);
            NS.closeModal();
            if (window.MiniSketchSyncBridge && window.MiniSketchSyncBridge.toast) {
              window.MiniSketchSyncBridge.toast('Loaded "' + sk.name + '" from Cloud');
            }
          });
          acts.appendChild(loadBtn);

          if (sk.id !== ACTIVE_SKETCH_ID) {
            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'btn small danger';
            delBtn.textContent = 'Delete';
            delBtn.addEventListener('click', async () => {
              const ok = window.uiConfirm ? await window.uiConfirm('Delete cloud sketch "' + sk.name + '"?', { danger: true }) : true;
              if (!ok) return;
              await deleteCloudSketch(sk.id);
              await refreshCloudSketches(currentUser);
            });
            acts.appendChild(delBtn);
          }

          row.appendChild(info);
          row.appendChild(acts);
          listEl.appendChild(row);
        }
      }
    }
  }

  NS.openModal = () => {
    const m = document.getElementById('cloud-modal');
    if (!m) return;
    m.classList.remove('hidden');
    renderCloudModal();
    if (currentUser && available && !isAutoSync()) {
      refreshCloudSketches(currentUser).catch(() => {});
    }
  };

  NS.closeModal = () => {
    const m = document.getElementById('cloud-modal');
    if (m) m.classList.add('hidden');
  };

  function wireUi() {
    const authBtn = document.getElementById('btn-cloud-auth');
    if (authBtn) {
      authBtn.addEventListener('click', () => {
        NS.openModal();
      });
    }
    const fileCloudBtn = document.getElementById('btn-cloud-sketches');
    if (fileCloudBtn) {
      fileCloudBtn.addEventListener('click', () => {
        NS.openModal();
      });
    }
    const closeBtn = document.getElementById('cloud-close');
    if (closeBtn) closeBtn.addEventListener('click', NS.closeModal);
    const loginBtn = document.getElementById('cloud-signin-btn');
    if (loginBtn) loginBtn.addEventListener('click', () => NS.signIn());
    const outBtn = document.getElementById('cloud-signout-btn');
    if (outBtn) outBtn.addEventListener('click', () => NS.signOut());
    const syncBtn = document.getElementById('cloud-sync-now-btn');
    if (syncBtn) syncBtn.addEventListener('click', () => NS.syncNow());
    const pullBtn = document.getElementById('cloud-pull-now-btn');
    if (pullBtn) pullBtn.addEventListener('click', () => NS.pullNow());
    const autoChk = document.getElementById('cloud-autosync-chk');
    if (autoChk) {
      autoChk.checked = isAutoSync();
      autoChk.addEventListener('change', () => NS.setAutoSync(autoChk.checked));
    }
    const saveSnapBtn = document.getElementById('cloud-save-copy-btn');
    if (saveSnapBtn) {
      saveSnapBtn.addEventListener('click', async () => {
        if (!currentUser) return;
        const nameInp = document.getElementById('cloud-save-name');
        const bridge = window.MiniSketchSyncBridge;
        const defName = (bridge && bridge.exportActiveDoc && bridge.exportActiveDoc().name) || 'Sketch';
        const name = String((nameInp && nameInp.value) || defName).trim() || 'Sketch';
        const slug = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'sketch';
        const sketchId = 'sk_' + slug + '_' + Date.now().toString(36);
        saveSnapBtn.disabled = true;
        try {
          const r = await pushSketch(sketchId, name);
          if (r && r.reason === 'too-large') {
            const kb = r.bytes ? (' (' + Math.round(r.bytes / 1024) + ' KB)') : '';
            if (bridge && bridge.toast) bridge.toast('Sketch exceeds 900KB limit even after compression' + kb + '.', { type: 'warn' });
          } else if (r && r.ok) {
            if (nameInp) nameInp.value = '';
            await refreshCloudSketches(currentUser);
            const kbNote = r.compressed && r.gzBytes ? (' (' + Math.max(1, Math.round(r.gzBytes / 1024)) + ' KB gzip)') : '';
            if (bridge && bridge.toast) bridge.toast('Saved "' + name + '" to Cloud' + kbNote);
          }
        } finally {
          saveSnapBtn.disabled = false;
        }
      });
    }
    renderAuthChip();
  }

  async function loadFirebaseModules() {
    const localBase = APP_ROOT + 'vendor/firebase/';
    try {
      return await Promise.all([
        import(localBase + 'firebase-app.js'),
        import(localBase + 'firebase-auth.js'),
        import(localBase + 'firebase-firestore.js')
      ]);
    } catch (localErr) {
      const cdnBase = 'https://www.gstatic.com/firebasejs/' + FIREBASE_SDK_VER + '/';
      return await Promise.all([
        import(cdnBase + 'firebase-app.js'),
        import(cdnBase + 'firebase-auth.js'),
        import(cdnBase + 'firebase-firestore.js')
      ]);
    }
  }

  // ---- Non-Blocking Initialization -----------------------------------------
  NS.init = async () => {
    if (bootStarted) return;
    bootStarted = true;
    wireUi();

    if (!isHttpOrigin()) {
      available = false;
      ready = true;
      initError = 'file:// offline mode';
      setSyncState('offline', 'file:// local mode');
      return;
    }

    try {
      const cfgRes = await fetch(APP_ROOT + 'firebase-applet-config.json', { cache: 'no-store' });
      if (!cfgRes.ok) throw new Error('Firebase config missing (HTTP ' + cfgRes.status + ')');
      const cfg = await cfgRes.json();
      if (!cfg || !cfg.projectId || !cfg.apiKey) throw new Error('Invalid Firebase config');

      const [appMod, authMod, fsMod] = await loadFirebaseModules();
      fbAppMod = appMod;
      fbAuthMod = authMod;
      fbFsMod = fsMod;

      app = appMod.initializeApp(cfg);
      db = fsMod.getFirestore(app, cfg.firestoreDatabaseId);
      auth = authMod.getAuth(app);
      available = true;

      await testConnection();

      authMod.onAuthStateChanged(auth, async (user) => {
        currentUser = user || null;
        ready = true;
        if (currentUser) {
          await initialSyncForUser(currentUser);
        } else {
          clearSubscriptions();
          setSyncState('guest', 'Guest local mode');
        }
      });
    } catch (err) {
      available = false;
      ready = true;
      initError = 'Offline or Firebase SDK unreachable — running locally';
      console.warn('[minisketch-cloud] Cloud login unavailable:', err);
      setSyncState('offline', initError);
    }
  };
})();
