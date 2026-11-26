// Probe for MiniSketch Extension System, AI Extension Builder, and Marketplace Server API.
// Run: node testing/extensions_probe.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  PASS  ' + name);
  } else {
    fail++;
    console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : ''));
  }
}

function makeFakeDom() {
  const byId = new Map();
  const bodyChildren = [];
  function makeEl(tag) {
    const el = {
      tagName: String(tag || 'DIV').toUpperCase(),
      id: '',
      className: '',
      textContent: '',
      title: '',
      _html: '',
      children: [],
      parentNode: null,
      attributes: {},
      listeners: {},
      classList: {
        _set: new Set(),
        add(c) { this._set.add(c); },
        remove(c) { this._set.delete(c); },
        toggle(c, on) { if (on === undefined) { if (this._set.has(c)) this._set.delete(c); else this._set.add(c); } else if (on) this._set.add(c); else this._set.delete(c); },
        contains(c) { return this._set.has(c); }
      },
      set innerHTML(val) {
        this._html = String(val || '');
        this.children = [];
        // Index any element with id="..." from injected modal markup so querySelector/getElementById works
        for (const m of this._html.matchAll(/\bid=["']([^"']+)["']/g)) {
          const child = makeEl('DIV');
          child.id = m[1];
          child.parentNode = this;
          this.children.push(child);
          byId.set(child.id, child);
        }
      },
      get innerHTML() { return this._html; },
      appendChild(child) {
        if (!child) return child;
        if (child.parentNode && child.parentNode !== this && child.parentNode.removeChild) {
          child.parentNode.removeChild(child);
        }
        child.parentNode = this;
        this.children.push(child);
        if (child.id) byId.set(child.id, child);
        return child;
      },
      removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx >= 0) this.children.splice(idx, 1);
        if (child && child.id && byId.get(child.id) === child) byId.delete(child.id);
        if (child) child.parentNode = null;
        return child;
      },
      value: '',
      checked: false,
      focus() {},
      select() {},
      get firstChild() { return this.children[0] || null; },
      addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
      querySelector(sel) {
        if (sel === '.modal-actions .btn.primary') return makeEl('BUTTON');
        if (sel === '[id$="-cancel"]') return makeEl('BUTTON');
        return null;
      },
      querySelectorAll() { return []; },
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return this.attributes[k] || null; }
    };
    return el;
  }
  const body = makeEl('BODY');
  body.appendChild = (child) => {
    if (!child) return child;
    if (child.parentNode && child.parentNode !== body && child.parentNode.removeChild) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = body;
    bodyChildren.push(child);
    if (child.id) byId.set(child.id, child);
    return child;
  };
  body.removeChild = (child) => {
    const idx = bodyChildren.indexOf(child);
    if (idx >= 0) bodyChildren.splice(idx, 1);
    if (child && child.id && byId.get(child.id) === child) byId.delete(child.id);
    return child;
  };
  const doc = {
    body,
    currentScript: null,
    createElement: (tag) => makeEl(tag),
    getElementById: (id) => byId.get(id) || null,
    querySelector: (sel) => {
      if (String(sel || '').includes('.btn.primary')) return makeEl('BUTTON');
      return null;
    },
    querySelectorAll: () => [],
    addEventListener: () => {}
  };
  return { doc, byId, makeEl };
}

function createStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(String(k), String(v)); },
    removeItem: (k) => { map.delete(String(k)); },
    _map: map
  };
}

function callBridge(bridgeHandler, method, url, headers, body) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 0,
      headers: {},
      body: '',
      writableEnded: false,
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      writeHead(code) { this.statusCode = code; return this; },
      end(chunk) { if (chunk) this.body += chunk; this.writableEnded = true; resolve(this); },
      on() {},
      write() { return true; }
    };
    const req = {
      method,
      url,
      headers: headers || {},
      on(ev, fn) {
        if (ev === 'data' && body) fn(Buffer.from(body));
        if (ev === 'end') fn();
      }
    };
    bridgeHandler(req, res);
    setTimeout(() => resolve(res), 100);
  });
}

(async () => {
  console.log('\n== 1. Registry validation, install, enable/disable, uninstall, reopen ==');
  {
    const registrySrc = fs.readFileSync(path.join(ROOT, 'tools', 'registry.js'), 'utf8');
    const storage = createStorage();
    const { doc, byId, makeEl } = makeFakeDom();
    const toasts = [];
    const hostRow = makeEl('DIV');
    hostRow.id = 'tools-row';
    const panelCount = makeEl('SPAN');
    panelCount.id = 'ext-panel-count';
    byId.set('ext-panel-count', panelCount);

    const sandbox = {
      console, setTimeout, clearTimeout,
      localStorage: storage,
      document: doc
    };
    sandbox.window = sandbox;
    vm.runInNewContext(registrySrc, sandbox);
    const R = sandbox.MiniSketchTools;

    const badSyntax = R.validateExtensionCode('function broken( {');
    check('validateExtensionCode catches syntax error', !badSyntax.ok && badSyntax.errors.some(e => /syntax/i.test(e)));

    const badBareState = R.validateExtensionCode(`(() => { MiniSketchTools.register({ id: 'bad-state', apply(api) { return state.entities; } }); })();`);
    check('validateExtensionCode catches bare state. access', !badBareState.ok && badBareState.errors.some(e => /api\.state/.test(e)));

    const badModalId = R.validateExtensionCode(`(() => {
      MiniSketchTools.register({
        id: 'bad-modal',
        modalId: 'bm-modal',
        modal: '<div id="bm-modal"><input id="bm-a"></div>',
        apply(api) { const x = document.getElementById('bm-missing').value; }
      });
    })();`);
    check('validateExtensionCode catches missing modal IDs', !badModalId.ok && badModalId.errors.some(e => /bm-missing/.test(e)));

    const badIcon = R.validateExtensionCode(`(() => { MiniSketchTools.register({ id: 'bad-ic', icon: '<svg onclick="evil()"><script>alert(1)</script></svg>', modalId: 'bi-m', modal: '<div id="bi-m"></div>', apply(api){} }); })();`);
    check('validateExtensionCode rejects unsafe SVG icon', !badIcon.ok && badIcon.errors.some(e => /icon SVG/i.test(e)));
    check('sanitizeIconSvg strips unsafe script/onclick SVG', !/script|onclick/i.test(R.sanitizeIconSvg('<svg onclick="evil()"><script>1</script></svg>')));

    const varIdOk = R.validateExtensionCode(`(() => {
      const ID = 'keychain-var';
      const MODAL_HTML = '<div id="kv-m"><input id="kv-w" value="40"></div>';
      MiniSketchTools.register({
        id: ID,
        label: 'Keychain',
        modalId: 'kv-m',
        modal: MODAL_HTML,
        icon: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5"/></svg>',
        apply(api) { const w = document.getElementById('kv-w').value; api.pushHistory(); api.cmdGroupSelection({noHistory:true}); const wrap = {name:'Keychain'}; wrap.name = 'Keychain ' + w; api.commit(); }
      });
    })();`);
    check('validateExtensionCode accepts const variable ID and modal variable', varIdOk.ok && varIdOk.extracted.id === 'keychain-var' && varIdOk.extracted.label === 'Keychain', varIdOk.errors.join('; '));

    const shorthandOk = R.validateExtensionCode(`(() => {
      const id = 'keychain-sh';
      const label = 'Keychain Shorthand';
      const modalId = 'ks-m';
      const modal = '<div id="ks-m"><input id="ks-r"></div>';
      MiniSketchTools.register({
        id,
        label,
        modalId,
        modal,
        icon: '<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12"/></svg>',
        apply(api) { const r = document.getElementById('ks-r').value; api.pushHistory(); api.cmdGroupSelection({noHistory:true}); const wrap = {name:'x'}; wrap.name = 'KS ' + r; api.commit(); }
      });
    })();`);
    check('validateExtensionCode accepts ES6 shorthand properties', shorthandOk.ok && shorthandOk.extracted.id === 'keychain-sh' && shorthandOk.extracted.label === 'Keychain Shorthand', shorthandOk.errors.join('; '));

    const tplVarModalMissing = R.validateExtensionCode(`(() => {
      const MODAL_HTML = '<div id="kt-m"><input id="kt-a"></div>';
      MiniSketchTools.register({
        "id": \`keychain-tpl\`,
        "label": "Keychain Tpl",
        modalId: 'kt-m',
        modal: MODAL_HTML,
        apply(api) { document.getElementById('kt-missing'); }
      });
    })();`);
    check('validateExtensionCode checks missing modal IDs even with quoted/template ID & variable modal', !tplVarModalMissing.ok && tplVarModalMissing.errors.some(e => /kt-missing/.test(e)));

    const objVarOk = R.validateExtensionCode(`(() => {
      const toolDef = {
        id: 'keychain-obj',
        label: 'Keychain Obj',
        modalId: 'ko-m',
        modal: '<div id="ko-m"></div>',
        apply(api) { api.pushHistory(); api.cmdGroupSelection({noHistory:true}); const wrap = {name:'x'}; wrap.name = 'Obj'; api.commit(); }
      };
      MiniSketchTools.register(toolDef);
    })();`);
    check('validateExtensionCode captures object variable passed to register(toolDef)', objVarOk.ok && objVarOk.extracted.id === 'keychain-obj', objVarOk.errors.join('; '));

    const runtimeFallbackOk = R.validateExtensionCode(`(() => {
      const ID = 'keychain-fb';
      const label = 'Keychain Fallback';
      MiniSketchTools.register({
        id: ID,
        label: label,
        modalId: 'kf-m',
        modal: '<div id="kf-m"></div>',
        apply(api) { api.pushHistory(); api.cmdGroupSelection({noHistory:true}); const wrap = {name:'x'}; wrap.name = 'FB'; api.commit(); }
      });
      missingRuntimeHelper();
    })();`);
    check('validateExtensionCode falls back to static constVars if top-level runtime throws', runtimeFallbackOk.ok && runtimeFallbackOk.extracted.id === 'keychain-fb', runtimeFallbackOk.errors.join('; '));

    // Register a built-in tool with icon & version first
    R.register({ id: 'builtin-box', label: 'Box', version: '1.0.0', icon: '<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12"/></svg>', apply() {} });
    const mockApi = { state: { entities: {} }, toast: (m) => toasts.push(m) };
    R.mount(mockApi, hostRow);
    const builtinBtn = doc.getElementById('btn-builtin-box');
    check('rendered tool button includes icon, label, and version spans',
      !!builtinBtn &&
      builtinBtn.children.some(c => c.className === 'ext-btn-ic' && /<svg/.test(c.innerHTML)) &&
      builtinBtn.children.some(c => c.className === 'ext-btn-lbl' && c.textContent === 'Box') &&
      builtinBtn.children.some(c => c.className === 'ext-btn-ver' && c.textContent === 'v1.0.0'));
    check('#ext-panel-count reflects active tool count', panelCount.textContent === '1');

    const sampleExt = `(() => {
      MiniSketchTools.register({
        id: 'sample-tag',
        label: 'Sample Tag',
        title: 'Sample generator',
        version: '1.2.0',
        icon: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5"/></svg>',
        modalId: 'sample-tag-modal',
        modal: \`<div id="sample-tag-modal" class="modal hidden"><div class="modal-box"><input id="st-w" value="50"><div class="modal-actions"><button id="st-cancel">Cancel</button><button class="btn primary">Create</button></div></div></div>\`,
        open(api, params) { if (params && params.w) document.getElementById('st-w').value = params.w; },
        apply(api) {
          api.pushHistory();
          const id = api.addPanelEntity([{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}], '#000000');
          const wrap = api.cmdGroupSelection({ noHistory: true });
          if (wrap) { wrap.name = 'Sample'; wrap.gen = { kind: 'sample-tag', params: { w: 50 } }; }
          api.commit();
        }
      });
    })();`;

    const prevRes = R.installExtension({ name: 'Sample Tag' }, sampleExt, { preview: true });
    check('preview install succeeds', prevRes.ok && prevRes.tool.preview === true);
    check('preview install does NOT persist to localStorage', !storage.getItem('minisketch.v1.ext.installed'));
    check('preview button appears in #tools-row', !!doc.getElementById('btn-sample-tag'));

    const instRes = R.installExtension({
      name: 'Sample Tag',
      author: 'Tester',
      version: '1.2.0',
      sourceUrl: 'https://example.com/ext/sample-tag.js',
      catalogUrl: 'https://example.com/ext/catalog.json'
    }, sampleExt, { source: 'marketplace' });
    check('permanent install succeeds', instRes.ok && instRes.tool.builtIn === false);
    const savedList = JSON.parse(storage.getItem('minisketch.v1.ext.installed'));
    check('permanent install persists icon, sourceUrl, catalogUrl to localStorage',
      savedList.length === 1 &&
      savedList[0].catalogUrl === 'https://example.com/ext/catalog.json' &&
      savedList[0].sourceUrl === 'https://example.com/ext/sample-tag.js' &&
      /<svg/.test(savedList[0].icon));
    check('#ext-panel-count increments when extension enabled', panelCount.textContent === '2');

    const cantOverwriteBuiltin = R.installExtension({}, `(() => { MiniSketchTools.register({ id: 'builtin-box', apply(api){} }); })();`);
    check('cannot overwrite built-in tool', !cantOverwriteBuiltin.ok);

    R.setEnabled('sample-tag', false);
    check('setEnabled(false) removes button from #tools-row and updates #ext-panel-count', !doc.getElementById('btn-sample-tag') && panelCount.textContent === '1');
    const reopenDisabled = R.reopen({ kind: 'sample-tag', params: {} });
    check('reopen on disabled extension returns false and toasts', reopenDisabled === false && toasts.some(t => /disabled/i.test(t)));

    // Simulate reload: fresh sandbox with same localStorage
    const { doc: doc2, makeEl: makeEl2 } = makeFakeDom();
    const hostRow2 = makeEl2('DIV');
    const sb2 = { console, setTimeout, clearTimeout, localStorage: storage, document: doc2 };
    sb2.window = sb2;
    vm.runInNewContext(registrySrc, sb2);
    sb2.MiniSketchTools.register({ id: 'builtin-box', label: 'Box', apply() {} });
    sb2.MiniSketchTools.mount(mockApi, hostRow2);
    check('disabled extension remains hidden across reload', !doc2.getElementById('btn-sample-tag'));
    sb2.MiniSketchTools.setEnabled('sample-tag', true);
    check('re-enabling after reload restores button', !!doc2.getElementById('btn-sample-tag'));

    const unBuiltin = sb2.MiniSketchTools.uninstallExtension('builtin-box');
    check('uninstall refuses built-in tool', !unBuiltin.ok);
    const unExt = sb2.MiniSketchTools.uninstallExtension('sample-tag');
    check('uninstall removes dynamic extension cleanly', unExt.ok && !doc2.getElementById('btn-sample-tag'));

    // Built-in tools all declare version and valid SVG icon
    const builtInFiles = ['box.js', 'slot.js', 'gear.js', 'wall.js', 'hinge.js', 'slidetop.js', 'pulltop.js', 'paintrack.js', 'paneliklan.js', 'flex.js', 'finger.js', 'spiral.js', 'textweld.js'];
    let allHaveIconVer = true;
    for (const f of builtInFiles) {
      const fSrc = fs.readFileSync(path.join(ROOT, 'tools', f), 'utf8');
      if (!/\bversion\s*:\s*['"]\d+\.\d+\.\d+['"]/.test(fSrc) || !/\bicon\s*:\s*['"]<svg\b/.test(fSrc)) {
        allHaveIconVer = false;
      }
    }
    check('all 13 built-in tools declare version and SVG icon', allHaveIconVer);
  }

  console.log('\n== 2. Starter Marketplace catalog & extensions ==');
  {
    const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'marketplace', 'catalog.json'), 'utf8'));
    check('marketplace/catalog.json lists 3 starter extensions', Array.isArray(catalog.extensions) && catalog.extensions.length === 3);

    const registrySrc = fs.readFileSync(path.join(ROOT, 'tools', 'registry.js'), 'utf8');
    for (const item of catalog.extensions) {
      const extPath = path.join(ROOT, 'marketplace', item.scriptUrl);
      const src = fs.readFileSync(extPath, 'utf8');
      const { doc, byId, makeEl } = makeFakeDom();
      const storage = createStorage();
      const sandbox = { console, setTimeout, clearTimeout, Math, localStorage: storage, document: doc };
      sandbox.window = sandbox;
      vm.runInNewContext(registrySrc, sandbox);
      const R = sandbox.MiniSketchTools;
      const v = R.validateExtensionCode(src);
      check(item.id + ' passes static validateExtensionCode() and has SVG icon', v.ok && /<svg\b/i.test(v.extracted.icon || '') && /<svg\b/i.test(item.icon || ''), v.errors.join('; '));

      let pushHist = 0, committed = 0, grouped = 0;
      const entities = {};
      let nextEnt = 1;
      const fakeWrap = { id: 9999, type: 'art' };
      const mockApi = {
        state: { entities },
        ui: { selection: [] },
        TAU: Math.PI * 2,
        clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
        round2: (v) => Math.round(v * 100) / 100,
        fmt: (v) => String(Math.round(v * 100) / 100),
        getW: () => 800,
        getH: () => 600,
        s2w: () => ({ x: 0, y: 0 }),
        contentBounds: () => null,
        pushHistory: () => { pushHist++; },
        commit: () => { committed++; },
        toast: () => {},
        selectedEntities: () => [],
        removeEntity: (id) => { delete entities[id]; },
        addPanelEntity: (pts, col) => {
          const id = nextEnt++;
          entities[id] = { id, type: 'spline', pts, color: col };
          mockApi.ui.selection.push({ kind: 'entity', id });
          return id;
        },
        addPolylineEntity: (pts, col) => {
          const id = nextEnt++;
          entities[id] = { id, type: 'spline', pts, color: col };
          mockApi.ui.selection.push({ kind: 'entity', id });
          return id;
        },
        addText: () => nextEnt++,
        cmdGroupSelection: () => {
          grouped++;
          entities[fakeWrap.id] = fakeWrap;
          mockApi.ui.selection = [{ kind: 'entity', id: fakeWrap.id }];
          return fakeWrap;
        }
      };
      const host = makeEl('DIV');
      R.mount(mockApi, host);
      const res = R.installExtension(item, src);
      check(item.id + ' installs cleanly', res.ok);
      R.open(item.id);
      // Set safe default values on inputs if fake DOM created empty elements
      for (const elNode of byId.values()) {
        if (elNode.value === undefined) elNode.value = '';
      }
      res.tool.apply(mockApi);
      check(item.id + ' apply() calls pushHistory once, creates entities, groups, and sets gen.kind',
        pushHist === 1 && committed >= 1 && grouped === 1 && Object.keys(entities).length > 1 &&
        fakeWrap.gen && fakeWrap.gen.kind === item.id && !!fakeWrap.name);
    }
  }

  console.log('\n== 3. Server Marketplace API (/api/marketplace/*) ==');
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-mkt-'));
    const prevDir = process.env.MARKETPLACE_DIR;
    const prevKey = process.env.MARKETPLACE_PUBLISH_KEY;
    process.env.MARKETPLACE_DIR = tmpDir;
    delete process.env.MARKETPLACE_PUBLISH_KEY;

    // Require fresh bridge instance after env setup
    delete require.cache[require.resolve(path.join(ROOT, 'server', 'ai-bridge.js'))];
    const { bridgeHandler } = require(path.join(ROOT, 'server', 'ai-bridge.js'));

    const h0 = await callBridge(bridgeHandler, 'GET', '/health', { origin: 'http://127.0.0.1:8090' });
    check('/health returns requiresPublishKey:false when unset', h0.statusCode === 200 && JSON.parse(h0.body).requiresPublishKey === false);

    const c0 = await callBridge(bridgeHandler, 'GET', '/api/marketplace/catalog', { origin: 'http://127.0.0.1:8090' });
    check('GET /api/marketplace/catalog works on empty dir', c0.statusCode === 200 && Array.isArray(JSON.parse(c0.body).extensions));

    const badId = await callBridge(bridgeHandler, 'POST', '/api/marketplace/publish', { origin: 'http://127.0.0.1:8090' }, JSON.stringify({
      meta: { id: '../evil', name: 'Evil' },
      code: 'MiniSketchTools.register({ id: "../evil", apply(){} });'
    }));
    check('publish rejects path traversal ID with 400', badId.statusCode === 400);

    const validCode = `(() => { MiniSketchTools.register({ id: 'test-jig', label: 'Test Jig', modalId: 'tj-m', modal: '<div id="tj-m"></div>', apply(api){ api.pushHistory(); api.cmdGroupSelection({noHistory:true}); api.commit(); } }); })();`;
    const pub1 = await callBridge(bridgeHandler, 'POST', '/api/marketplace/publish', { origin: 'http://127.0.0.1:8090' }, JSON.stringify({
      meta: { id: 'test-jig', name: 'Test Jig', version: '1.0.0', author: 'Tester', category: 'Jigs', description: 'A test jig' },
      code: validCode
    }));
    const pub1Json = JSON.parse(pub1.body);
    check('POST /api/marketplace/publish writes script & catalog (200)',
      pub1.statusCode === 200 && pub1Json.ok && pub1Json.scriptUrl === 'extensions/test-jig.js' &&
      fs.existsSync(path.join(tmpDir, 'extensions', 'test-jig.js')));

    const getScript = await callBridge(bridgeHandler, 'GET', '/api/marketplace/extensions/test-jig.js', { origin: 'http://127.0.0.1:8090' });
    check('GET /api/marketplace/extensions/:id serves published script', getScript.statusCode === 200 && getScript.body.includes('test-jig'));

    const dup = await callBridge(bridgeHandler, 'POST', '/api/marketplace/publish', { origin: 'http://127.0.0.1:8090' }, JSON.stringify({
      meta: { id: 'test-jig', name: 'Test Jig', version: '1.0.1' },
      code: validCode,
      overwrite: false
    }));
    check('duplicate publish without overwrite returns 409', dup.statusCode === 409);

    const upd = await callBridge(bridgeHandler, 'POST', '/api/marketplace/publish', { origin: 'http://127.0.0.1:8090' }, JSON.stringify({
      meta: { id: 'test-jig', name: 'Test Jig', version: '1.0.1' },
      code: validCode,
      overwrite: true
    }));
    check('publish with overwrite:true succeeds (200)', upd.statusCode === 200 && JSON.parse(upd.body).entry.version === '1.0.1');

    const varJigCode = `(() => { const id = 'var-jig'; MiniSketchTools.register({ id, label: 'Var Jig', apply(api){} }); })();`;
    const pubVarOk = await callBridge(bridgeHandler, 'POST', '/api/marketplace/publish', { origin: 'http://127.0.0.1:8090' }, JSON.stringify({
      meta: { id: 'var-jig', name: 'Var Jig', version: '1.0.0' },
      code: varJigCode
    }));
    check('publish accepts variable/shorthand register({ id }) (200)', pubVarOk.statusCode === 200);

    const pubVarMismatch = await callBridge(bridgeHandler, 'POST', '/api/marketplace/publish', { origin: 'http://127.0.0.1:8090' }, JSON.stringify({
      meta: { id: 'other-jig', name: 'Other Jig', version: '1.0.0' },
      code: varJigCode
    }));
    check('publish rejects mismatched variable/shorthand ID (400)', pubVarMismatch.statusCode === 400);

    // Enforce MARKETPLACE_PUBLISH_KEY
    process.env.MARKETPLACE_PUBLISH_KEY = 'secret-pass-123';
    const h1 = await callBridge(bridgeHandler, 'GET', '/health', { origin: 'http://127.0.0.1:8090' });
    check('/health reports requiresPublishKey:true when set', JSON.parse(h1.body).requiresPublishKey === true);

    const noKey = await callBridge(bridgeHandler, 'POST', '/api/marketplace/publish', { origin: 'http://127.0.0.1:8090' }, JSON.stringify({
      meta: { id: 'test-jig', name: 'Test Jig', version: '1.0.2' },
      code: validCode,
      overwrite: true
    }));
    check('publish without required publish key returns 401', noKey.statusCode === 401);

    const withKey = await callBridge(bridgeHandler, 'POST', '/api/marketplace/publish', {
      origin: 'http://127.0.0.1:8090',
      'x-publish-key': 'secret-pass-123'
    }, JSON.stringify({
      meta: { id: 'test-jig', name: 'Test Jig', version: '1.0.2' },
      code: validCode,
      overwrite: true
    }));
    check('publish with valid X-Publish-Key succeeds (200)', withKey.statusCode === 200);

    const delDenied = await callBridge(bridgeHandler, 'DELETE', '/api/marketplace/extensions/test-jig', { origin: 'http://127.0.0.1:8090' });
    check('DELETE without publish key returns 401', delDenied.statusCode === 401);

    const delOk = await callBridge(bridgeHandler, 'DELETE', '/api/marketplace/extensions/test-jig', {
      origin: 'http://127.0.0.1:8090',
      'x-publish-key': 'secret-pass-123'
    });
    check('DELETE with key removes file and catalog entry (200)',
      delOk.statusCode === 200 && !fs.existsSync(path.join(tmpDir, 'extensions', 'test-jig.js')) &&
      !JSON.parse(delOk.body).catalog.extensions.some(x => x.id === 'test-jig'));

    if (prevDir === undefined) delete process.env.MARKETPLACE_DIR; else process.env.MARKETPLACE_DIR = prevDir;
    if (prevKey === undefined) delete process.env.MARKETPLACE_PUBLISH_KEY; else process.env.MARKETPLACE_PUBLISH_KEY = prevKey;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log('\n== 4. AI Extension Builder Prompt & Chat Extraction + Manager Helpers ==');
  {
    const skillsSrc = fs.readFileSync(path.join(ROOT, 'ai', 'skills.js'), 'utf8');
    const promptSrc = fs.readFileSync(path.join(ROOT, 'ai', 'prompt.js'), 'utf8');
    const chatSrc = fs.readFileSync(path.join(ROOT, 'ai', 'chat.js'), 'utf8');
    const mgrSrc = fs.readFileSync(path.join(ROOT, 'extensions', 'manager.js'), 'utf8');
    const sysExtPrompt = fs.readFileSync(path.join(ROOT, 'ai', 'system-prompt-ext.txt'), 'utf8');
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    const sb = {
      console, setTimeout, clearTimeout, setInterval, clearInterval, performance: { now: () => Date.now() },
      TextDecoder, TextEncoder, AbortController, URL,
      localStorage: createStorage(),
      document: { currentScript: null, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {} },
      fetch: async (url) => {
        if (String(url).endsWith('system-prompt-ext.txt')) return { ok: true, text: async () => sysExtPrompt };
        if (String(url).endsWith('system-prompt.txt')) return { ok: true, text: async () => 'BASE' };
        if (String(url).endsWith('system-prompt-svg.txt')) return { ok: true, text: async () => 'SVG' };
        if (String(url).endsWith('tools.json')) return { ok: true, json: async () => ({ tools: [] }) };
        throw new Error('unexpected fetch: ' + url);
      }
    };
    sb.window = sb;
    vm.runInNewContext(skillsSrc, sb);
    vm.runInNewContext(promptSrc, sb);
    await sb.MiniSketchAIPrompt.ready();
    await sb.MiniSketchAIPrompt.ensureExtPrompt();
    const extSysMsg = sb.MiniSketchAIPrompt.systemMessage([{ role: 'user', content: 'buat coaster' }], null, [], { extMode: true });
    check('systemMessage({ extMode: true }) uses Extension Builder prompt',
      extSysMsg && extSysMsg.content.includes('MiniSketchTools.register'));

    vm.runInNewContext(chatSrc, sb);
    const extracted = sb.MiniSketchAI.extractExtensionCode('Berikut kodenya:\n```js\n(() => { MiniSketchTools.register({ id: "foo-tool", apply(){} }); })();\n```\nSilakan test.');
    check('extractExtensionCode extracts fenced JS tool block', extracted && extracted.includes('foo-tool'));
    const extractedUnfenced = sb.MiniSketchAI.extractExtensionCode('(function(){ const reg = window.MiniSketchTools; reg.register({ id: "un-fenced", apply(){} }); })();');
    check('extractExtensionCode extracts unfenced (function(){...}) extension block', extractedUnfenced && extractedUnfenced.includes('un-fenced'));
    check('extractExtensionCode returns null for normal SVG/text', sb.MiniSketchAI.extractExtensionCode('<svg><rect/></svg>') === null);

    vm.runInNewContext(mgrSrc, sb);
    check('manager compareVersions compares semantic versions',
      sb.MiniSketchExtensions._debug.compareVersions('1.2.0', '1.1.9') > 0 &&
      sb.MiniSketchExtensions._debug.compareVersions('1.0.0', '1.0.0') === 0);
    check('manager resolveUrl resolves relative scriptUrl against catalog URL',
      sb.MiniSketchExtensions._debug.resolveUrl('extensions/coaster-maker.js', 'https://example.com/mkt/catalog.json') === 'https://example.com/mkt/extensions/coaster-maker.js' &&
      sb.MiniSketchExtensions._debug.resolveUrl('extensions/coaster-maker.js', 'http://127.0.0.1:8090/api/marketplace/catalog') === 'http://127.0.0.1:8090/marketplace/extensions/coaster-maker.js');

    // Chat extension card rendering & recovery buttons (single pinned #chat-ext-dock above prompt)
    const { doc: cDoc, byId: cById, makeEl: cMakeEl } = makeFakeDom();
    for (const cid of ['chat-log', 'chat-ext-dock', 'chat-count', 'chat-input-row', 'chat-builder-ext', 'ext-modal', 'ext-imp-code', 'ext-imp-status', 'ext-imp-test', 'ext-imp-install', 'ext-imp-publish']) {
      const n = cMakeEl(cid === 'ext-imp-code' ? 'TEXTAREA' : 'DIV');
      n.id = cid;
      n.hidden = cid === 'chat-ext-dock';
      cById.set(cid, n);
    }
    const tabBtns = [];
    const paneEls = [];
    cDoc.querySelectorAll = (sel) => {
      if (sel === '[data-ext-tab]') return tabBtns;
      if (sel === '[data-ext-pane]') return paneEls;
      return [];
    };
    const registrySrcForChat = fs.readFileSync(path.join(ROOT, 'tools', 'registry.js'), 'utf8');
    const cSb = {
      console, setTimeout, clearTimeout, setInterval, clearInterval, performance: { now: () => Date.now() },
      TextDecoder, TextEncoder, AbortController, URL,
      localStorage: createStorage(),
      document: cDoc,
      fetch: sb.fetch
    };
    cSb.window = cSb;
    vm.runInNewContext(registrySrcForChat, cSb);
    vm.runInNewContext(skillsSrc, cSb);
    vm.runInNewContext(promptSrc, cSb);
    vm.runInNewContext(chatSrc, cSb);
    vm.runInNewContext(mgrSrc, cSb);

    function findAll(root, pred, out = []) {
      if (!root) return out;
      if (pred(root)) out.push(root);
      for (const ch of (root.children || [])) findAll(ch, pred, out);
      return out;
    }

    const validAiTurn = {
      role: 'ai',
      done: true,
      text: '```js\n(() => {\n  const ID = "keychain-tag";\n  MiniSketchTools.register({\n    id: ID,\n    label: "Keychain",\n    icon: \'<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5"/></svg>\',\n    modalId: "kc-m",\n    modal: \'<div id="kc-m"><input id="kc-w" value="40"></div>\',\n    apply(api) { const w = document.getElementById("kc-w").value; api.pushHistory(); api.cmdGroupSelection({noHistory:true}); const wrap = {name:"x"}; wrap.name = "Keychain " + w; api.commit(); }\n  });\n})();\n```'
    };
    const brokenAiTurn = {
      role: 'ai',
      done: true,
      text: '```js\n(() => {\n  MiniSketchTools.register({\n    label: "Broken Keychain",\n    apply(api) {}\n  });\n})();\n```'
    };

    // Turn 1 -> Turn 2: older valid turn, latest broken turn
    cSb.MiniSketchAI.mode = 'chat';
    cSb.MiniSketchAI.log = [validAiTurn, brokenAiTurn];
    cSb.MiniSketchAI.renderLog();
    const chatHost = cDoc.getElementById('chat-log');
    const chatDock = cDoc.getElementById('chat-ext-dock');
    const logCards = findAll(chatHost, n => n.className === 'chat-ext');
    const dockCards1 = findAll(chatDock, n => n.className === 'chat-ext');
    const brokenCard = dockCards1[0];
    const brokenBtns = findAll(brokenCard, n => n.tagName === 'BUTTON');
    const brokenFixBtn = brokenBtns.find(b => b.textContent === 'Minta AI Perbaiki');
    const brokenEditBtn = brokenBtns.find(b => b.textContent === 'Edit…');
    const brokenTestBtn = brokenBtns.find(b => b.textContent === 'Test Run');
    const brokenInstBtn = brokenBtns.find(b => b.textContent === 'Install');
    check('session with 2 extension turns renders 0 cards inside #chat-log and 1 latest card in pinned #chat-ext-dock',
      logCards.length === 0 &&
      !chatDock.hidden &&
      dockCards1.length === 1 &&
      findAll(brokenCard, n => n.tagName === 'B')[0]?.textContent === 'Broken Keychain');
    check('pinned dock shows Minta AI Perbaiki and Edit… when latest generated code fails validation',
      !!brokenFixBtn && !brokenFixBtn.disabled &&
      !!brokenEditBtn &&
      brokenTestBtn && brokenTestBtn.disabled &&
      brokenInstBtn && brokenInstBtn.disabled);
    if (brokenEditBtn && brokenEditBtn.listeners.click) {
      brokenEditBtn.listeners.click.forEach(fn => fn());
    }
    check('clicking Edit… opens import editor with latest code prefilled & validated',
      cDoc.getElementById('ext-imp-code').value.includes('Broken Keychain') &&
      /Invalid/i.test(cDoc.getElementById('ext-imp-status').textContent));

    // Turn 3: AI repairs the extension -> dock replaces broken card with latest valid card
    cSb.MiniSketchAI.log = [validAiTurn, brokenAiTurn, validAiTurn];
    cSb.MiniSketchAI.renderLog();
    const dockCards2 = findAll(chatDock, n => n.className === 'chat-ext');
    const validCard = dockCards2[0];
    const validBtns = findAll(validCard, n => n.tagName === 'BUTTON');
    const validTestBtn = validBtns.find(b => b.textContent === 'Test Run');
    const validInstBtn = validBtns.find(b => b.textContent === 'Install');
    const validEditBtn = validBtns.find(b => b.tagName === 'BUTTON' && b.textContent === 'Edit…');
    const validIc = findAll(validCard, n => n.className === 'chat-ext-ic')[0];
    const validSub = findAll(validCard, n => n.className === 'muted')[0];
    check('new valid extension turn replaces pinned dock content (still 1 card, Test Run & Install enabled)',
      findAll(chatHost, n => n.className === 'chat-ext').length === 0 &&
      dockCards2.length === 1 &&
      validTestBtn && !validTestBtn.disabled &&
      validInstBtn && !validInstBtn.disabled &&
      !!validEditBtn &&
      validIc && /<svg/.test(validIc.innerHTML) &&
      validSub && validSub.textContent.includes('keychain-tag') &&
      !validBtns.some(b => b.textContent === 'Minta AI Perbaiki'));

    // Switching to History hides the dock; clearing session hides & empties it
    cSb.MiniSketchAI.mode = 'log';
    cSb.MiniSketchAI.renderLog();
    check('History tab hides #chat-ext-dock', chatDock.hidden === true);
    cSb.MiniSketchAI.mode = 'chat';
    cSb.MiniSketchAI.log = [];
    cSb.MiniSketchAI.renderLog();
    check('New/empty session empties and hides #chat-ext-dock',
      chatDock.hidden === true && findAll(chatDock, n => n.className === 'chat-ext').length === 0);

    check('index.html has extension modal, pinned chat dock above prompt, builder toggle, and manager script',
      /id="ext-modal"/.test(html) &&
      /id="chat-log"[\s\S]*?id="chat-ext-dock"[\s\S]*?id="chat-input-row"/.test(html) &&
      /id="btn-extensions"/.test(html) &&
      /id="btn-extensions-menu"/.test(html) &&
      /id="btn-ext-check-updates"/.test(html) &&
      /id="ext-inst-check"/.test(html) &&
      /id="ext-inst-update-all"/.test(html) &&
      /id="ext-auto-update"/.test(html) &&
      /id="chat-builder-mode"/.test(html) &&
      /value="svg"/.test(html) &&
      /value="ext"/.test(html) &&
      /extensions\/manager\.js/.test(html) &&
      !/id="chat-mode-agent"/.test(html) &&
      !/id="chat-mode-svg"/.test(html));

    const arrangeSlice = html.slice(html.indexOf('id="rpage-arrange"'), html.indexOf('id="rpage-parts"'));
    const toolsPanelSlice = html.slice(html.indexOf('id="tools-panel"'), html.indexOf('</details>', html.indexOf('id="tools-panel"')));
    check('#btn-array moved from #tools-row to Arrange ribbon and panel renamed to Extensions',
      /id="btn-array"/.test(arrangeSlice) &&
      !/id="btn-array"/.test(toolsPanelSlice) &&
      /Extensions\s*<span class="count" id="ext-panel-count">/.test(toolsPanelSlice));
  }

  console.log('\n== 5. Extension Check Updates & Auto-Update ==');
  {
    const registrySrc = fs.readFileSync(path.join(ROOT, 'tools', 'registry.js'), 'utf8');
    const mgrSrc = fs.readFileSync(path.join(ROOT, 'extensions', 'manager.js'), 'utf8');
    const storage = createStorage();
    const { doc, byId, makeEl } = makeFakeDom();
    for (const id of ['tools-row', 'ext-panel-count', 'ext-inst-list', 'ext-inst-count', 'ext-inst-status', 'ext-inst-check', 'ext-inst-update-all', 'ext-auto-update', 'btn-ext-check-updates', 'ext-mkt-url']) {
      const node = makeEl(id === 'ext-auto-update' ? 'INPUT' : 'DIV');
      node.id = id;
      byId.set(id, node);
    }

    const v1Code = `(() => { MiniSketchTools.register({ id: 'up-tool', label: 'Up Tool', version: '1.0.0', icon: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4"/></svg>', modalId: 'up-m', modal: '<div id="up-m"></div>', apply(api){ api.pushHistory(); api.cmdGroupSelection({noHistory:true}); api.commit(); } }); })();`;
    const v2Code = `(() => { MiniSketchTools.register({ id: 'up-tool', label: 'Up Tool', version: '1.1.0', icon: '<svg viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10"/></svg>', modalId: 'up-m', modal: '<div id="up-m"></div>', apply(api){ api.pushHistory(); api.cmdGroupSelection({noHistory:true}); api.commit(); } }); })();`;

    const toasts = [];
    const sb = {
      console, setTimeout, clearTimeout, setInterval, clearInterval,
      URL,
      localStorage: storage,
      document: doc,
      location: { protocol: 'http:', origin: 'http://127.0.0.1:8090', href: 'http://127.0.0.1:8090/' },
      fetch: async (url) => {
        const u = String(url);
        if (u.endsWith('catalog.json')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              extensions: [{
                id: 'up-tool',
                name: 'Up Tool',
                version: '1.1.0',
                author: 'Updater',
                category: 'CNC Utility',
                scriptUrl: 'extensions/up-tool.js'
              }]
            })
          };
        }
        if (u.endsWith('extensions/up-tool.js')) {
          return { ok: true, status: 200, text: async () => v2Code };
        }
        throw new Error('unexpected update fetch: ' + u);
      }
    };
    sb.window = sb;
    vm.runInNewContext(registrySrc, sb);
    vm.runInNewContext(mgrSrc, sb);
    sb.MiniSketchTools.mount({ state: { entities: {} }, toast: (m) => toasts.push(m) }, doc.getElementById('tools-row'));
    sb.MiniSketchTools.installExtension({
      id: 'up-tool',
      name: 'Up Tool',
      version: '1.0.0',
      source: 'marketplace',
      sourceUrl: 'http://127.0.0.1:8090/mkt/extensions/up-tool.js',
      catalogUrl: 'http://127.0.0.1:8090/mkt/catalog.json'
    }, v1Code);
    sb.MiniSketchExtensions.mount({ state: { entities: {} }, toast: (m) => toasts.push(m) });

    const checkRes = await sb.MiniSketchExtensions.checkUpdates({ silent: false, autoApply: false });
    check('checkUpdates detects newer catalog version 1.0.0 -> 1.1.0',
      checkRes.checked === 1 && checkRes.updates.length === 1 && checkRes.updates[0].toVersion === '1.1.0');
    check('side Check Updates button shows available count',
      doc.getElementById('btn-ext-check-updates').textContent === 'Updates (1)' &&
      doc.getElementById('ext-inst-update-all').hidden === false);

    const applied = await sb.MiniSketchExtensions.applyAllUpdates();
    const afterCatalog = sb.MiniSketchTools.getCatalogState().find(x => x.id === 'up-tool');
    const updatedBtn = doc.getElementById('btn-up-tool');
    check('applyAllUpdates upgrades installed extension to v1.1.0 in storage & DOM button',
      applied === 1 &&
      afterCatalog && afterCatalog.version === '1.1.0' &&
      updatedBtn && updatedBtn.children.some(c => c.className === 'ext-btn-ver' && c.textContent === 'v1.1.0') &&
      doc.getElementById('btn-ext-check-updates').textContent === 'Check Updates');

    // Test autoApply mode from v1.0.0 -> v1.1.0 directly
    sb.MiniSketchTools.installExtension({
      id: 'up-tool',
      name: 'Up Tool',
      version: '1.0.0',
      source: 'marketplace',
      sourceUrl: 'http://127.0.0.1:8090/mkt/extensions/up-tool.js',
      catalogUrl: 'http://127.0.0.1:8090/mkt/catalog.json'
    }, v1Code);
    const autoRes = await sb.MiniSketchExtensions.checkUpdates({ silent: true, autoApply: true });
    const afterAuto = sb.MiniSketchTools.getCatalogState().find(x => x.id === 'up-tool');
    check('autoApply upgrades extension automatically when newer version exists',
      autoRes.applied === 1 && afterAuto && afterAuto.version === '1.1.0');
  }

  console.log('\n== 6. polyBoolOp Defensive Args & Runtime apply() Guard ==');
  {
    const appSrc = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
    const pbStart = appSrc.indexOf('  function polyBoolOp(op, subjectRings, clipRings) {');
    const pbEnd = appSrc.indexOf('  function cmdBoolean(mode) {', pbStart);
    const polyBoolSrc = appSrc.slice(pbStart, pbEnd);

    require(path.join(ROOT, 'tools', 'path-bool.js'));
    const core = require(path.join(ROOT, 'core.js'));
    const polyBoolOp = new Function(
      'pathBoolLib', 'clipperLib', 'signedAreaPts', 'pointInPoly', 'OFFSET_SCALE',
      polyBoolSrc + '\nreturn polyBoolOp;'
    )(() => global.PathBool, () => null, core.signedAreaPts, core.pointInPoly, 1000);

    const rectA = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }];
    const rectB = [{ x: 15, y: 2 }, { x: 30, y: 2 }, { x: 30, y: 8 }, { x: 15, y: 8 }];

    const u3 = polyBoolOp('union', [rectA], [rectB]);
    check('polyBoolOp("union", [a], [b]) merges clipRings cleanly', Array.isArray(u3) && u3.length === 1);

    const uSingle = polyBoolOp('union', rectA, rectB);
    check('polyBoolOp("union", ringA, ringB) accepts single-ring arrays directly', Array.isArray(uSingle) && uSingle.length === 1);

    const uSwapped = polyBoolOp(rectA, rectB, 'union');
    check('polyBoolOp(ringA, ringB, "union") tolerates swapped op argument', Array.isArray(uSwapped) && uSwapped.length === 1);

    const diffSwapped = polyBoolOp(rectA, 'difference', rectB);
    check('polyBoolOp(ringA, "difference", ringB) tolerates swapped op without TypeError', Array.isArray(diffSwapped) && diffSwapped.length === 1);

    const objWrapped = polyBoolOp('union', { pts: rectA }, { notARing: 123 });
    check('polyBoolOp handles { pts } and garbage non-array args without throwing', Array.isArray(objWrapped) && objWrapped.length === 1);

    const nonArraySafe = polyBoolOp('union', 'not-an-array', 42);
    check('polyBoolOp returns [] safely for scalar non-array arguments', Array.isArray(nonArraySafe) && nonArraySafe.length === 0);

    const cfgObjOk = polyBoolOp({ op: 'merge', subject: rectA, clip: rectB });
    check('polyBoolOp supports { op: "merge", subject, clip } object form', Array.isArray(cfgObjOk) && cfgObjOk.length === 1);

    const tuplePtsOk = polyBoolOp('subtract', [[[0, 0], [20, 0], [20, 10], [0, 10]]], { points: [[5, 2], [15, 2], [15, 8], [5, 8]] });
    check('polyBoolOp supports "subtract" alias, [x,y] tuples, and { points } wrapper', Array.isArray(tuplePtsOk) && tuplePtsOk.length === 2);

    // Extension apply() exception guard via OK button click
    const registrySrc = fs.readFileSync(path.join(ROOT, 'tools', 'registry.js'), 'utf8');
    const storage = createStorage();
    const { doc, byId, makeEl } = makeFakeDom();
    const okBtn = makeEl('BUTTON');
    const modalDiv = makeEl('DIV');
    modalDiv.id = 'boom-m';
    modalDiv.querySelector = (sel) => (sel === '.modal-actions .btn.primary' ? okBtn : null);
    byId.set('boom-m', modalDiv);
    const origGetById = doc.getElementById;
    doc.getElementById = (id) => (id === 'boom-m' ? modalDiv : origGetById(id));
    const toasts = [];
    const sb = { console, setTimeout, clearTimeout, localStorage: storage, document: doc };
    sb.window = sb;
    vm.runInNewContext(registrySrc, sb);
    sb.MiniSketchTools.mount({ state: { entities: {} }, toast: (m) => toasts.push(m) }, makeEl('DIV'));
    const boomRes = sb.MiniSketchTools.installExtension({ name: 'Boom' }, `(() => {
      MiniSketchTools.register({
        id: 'boom-tool',
        label: 'Boom',
        modalId: 'boom-m',
        modal: '<div id="boom-m"><button class="btn primary">Go</button></div>',
        apply() { throw new Error('kaboom'); }
      });
    })();`);
    sb.MiniSketchTools.open('boom-tool');
    let uncaught = false;
    try {
      (okBtn.listeners.click || []).forEach(fn => fn());
    } catch (e) {
      uncaught = true;
    }
    check('registry OK handler catches runtime error in extension apply() and toasts cleanly',
      boomRes.ok && !uncaught && toasts.some(t => /kaboom/.test(t)));

    // Defensive normalizeWinding & chainPolylines (core.js)
    const cwOuter = [{ x: 0, y: 0 }, { x: 0, y: 20 }, { x: 20, y: 20 }, { x: 20, y: 0 }];
    const ccwHole = [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }, { x: 5, y: 15 }];
    const nwSingleObj = core.normalizeWinding({ pts: cwOuter.slice(), closed: true });
    check('normalizeWinding handles single contour object without TypeError',
      Array.isArray(nwSingleObj) && nwSingleObj.length === 1 && core.signedAreaPts(nwSingleObj[0].pts) > 0);
    const nwBakeObj = core.normalizeWinding({ contours: [{ pts: cwOuter.slice(), closed: true }] });
    check('normalizeWinding unwraps bakeContours-shaped { contours: [...] } object',
      Array.isArray(nwBakeObj) && nwBakeObj.length === 1 && core.signedAreaPts(nwBakeObj[0].pts) > 0);
    const nwRawRings = core.normalizeWinding([cwOuter.slice(), ccwHole.slice()]);
    check('normalizeWinding normalizes raw point ring arrays [[pts]] (outer +, hole -)',
      Array.isArray(nwRawRings) && nwRawRings.length === 2 &&
      core.signedAreaPts(nwRawRings[0]) > 0 && core.signedAreaPts(nwRawRings[1]) < 0);
    const nwPointsSet = core.normalizeWinding(new Set([{ points: cwOuter.slice() }]));
    check('normalizeWinding handles Set and { points } wrapper safely',
      Array.isArray(nwPointsSet) && nwPointsSet.length === 1 && core.signedAreaPts(nwPointsSet[0].points) > 0);
    const nwScalar = core.normalizeWinding('not-an-array');
    check('normalizeWinding returns [] safely for scalar non-array input',
      Array.isArray(nwScalar) && nwScalar.length === 0);
    check('chainPolylines handles non-array safely',
      Array.isArray(core.chainPolylines(null, 0.1)) && core.chainPolylines('bad', 0.1).length === 0);

    // Defensive offsetClosedChains (app.js)
    const Clipper = require(path.join(ROOT, 'tools', 'clipper.js'));
    const offStart = appSrc.indexOf('  function offsetClosedChains(contours, dist, opts) {');
    const offEnd = appSrc.indexOf('  // Offset every chain.', offStart);
    const offSrc = appSrc.slice(offStart, offEnd);
    const offsetClosedChains = new Function(
      'clipperLib', 'OFFSET_MITER', 'OFFSET_SCALE', 'OFFSET_JOIN', 'OFFSET_ARC_TOL', 'OFFSET_PRECISION', 'signedAreaPts',
      offSrc + '\nreturn offsetClosedChains;'
    )(() => Clipper, 2, 1000, 'miter', 0.25, 0.001, core.signedAreaPts);
    const offRaw = offsetClosedChains([cwOuter.slice()], 1);
    const offBad = offsetClosedChains('not-an-array', 1);
    check('offsetClosedChains handles raw point rings and scalar non-arrays safely',
      Array.isArray(offRaw) && offRaw.length === 1 && Array.isArray(offBad) && offBad.length === 0);
  }

  console.log('\n== 7. Prompt Efficiency (SVG / Ext) & Syntax Highlighting (JS/HTML/CSS) ==');
  {
    const skillsSrc = fs.readFileSync(path.join(ROOT, 'ai', 'skills.js'), 'utf8');
    const promptSrc = fs.readFileSync(path.join(ROOT, 'ai', 'prompt.js'), 'utf8');
    const mgrSrc = fs.readFileSync(path.join(ROOT, 'extensions', 'manager.js'), 'utf8');
    const sysPrompt = fs.readFileSync(path.join(ROOT, 'ai', 'system-prompt.txt'), 'utf8');
    const sysSvgPrompt = fs.readFileSync(path.join(ROOT, 'ai', 'system-prompt-svg.txt'), 'utf8');
    const sysExtPrompt = fs.readFileSync(path.join(ROOT, 'ai', 'system-prompt-ext.txt'), 'utf8');
    const coasterSrc = fs.readFileSync(path.join(ROOT, 'marketplace', 'extensions', 'coaster-maker.js'), 'utf8');
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    const sb = {
      console, setTimeout, clearTimeout, setInterval, clearInterval, performance: { now: () => Date.now() },
      TextDecoder, TextEncoder, AbortController, URL,
      MiniSketchFonts: { index: () => [{ family: 'Liberation Sans' }, { family: 'Liberation Serif' }] },
      localStorage: createStorage(),
      document: { currentScript: null, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {} },
      fetch: async (url) => {
        if (String(url).endsWith('system-prompt.txt')) return { ok: true, text: async () => sysPrompt };
        if (String(url).endsWith('system-prompt-svg.txt')) return { ok: true, text: async () => sysSvgPrompt };
        if (String(url).endsWith('system-prompt-ext.txt')) return { ok: true, text: async () => sysExtPrompt };
        if (String(url).endsWith('tools.json')) return { ok: true, json: async () => ({ tools: [] }) };
        throw new Error('unexpected fetch: ' + url);
      }
    };
    sb.window = sb;
    vm.runInNewContext(skillsSrc, sb);
    vm.runInNewContext(promptSrc, sb);
    await sb.MiniSketchAIPrompt.ready();
    await sb.MiniSketchAIPrompt.ensureExtPrompt();

    const cadMsg = sb.MiniSketchAIPrompt.systemMessage([{ role: 'user', content: 'buat tulisan' }], { count: 0 }, [], {});
    const svgMsg = sb.MiniSketchAIPrompt.systemMessage([{ role: 'user', content: 'gambar bintang' }], { count: 2 }, [], { svgMode: true });
    const extMsg = sb.MiniSketchAIPrompt.systemMessage([{ role: 'user', content: 'buat coaster' }], { count: 2 }, [], { extMode: true });

    check('CAD mode injects AVAILABLE FONTS + CURRENT DOCUMENT while SVG & Ext skip font dump bloat',
      cadMsg.content.includes('AVAILABLE FONTS') &&
      cadMsg.content.includes('CURRENT DOCUMENT') &&
      !svgMsg.content.includes('AVAILABLE FONTS') &&
      !svgMsg.content.includes('CURRENT DOCUMENT') &&
      !extMsg.content.includes('AVAILABLE FONTS') &&
      !extMsg.content.includes('CURRENT DOCUMENT'));
    check('Extension Builder prompt is roomy (no 7 KB squeeze) with accurate addSpline/polyBoolOp docs and no catalog dump',
      extMsg.content.length < 40000 &&
      extMsg.content.includes('addSpline({ pts') &&
      extMsg.content.includes('ARRAY OF RINGS') &&
      !extMsg.content.includes('REFERENCE — BUILT-IN EXTENSIONS'));
    check('SVG mode prompt stays concise (< 2 KB) with viewBox/mm, fill="none", <g>, <text>, and full CNC colors',
      svgMsg.content.length < 2000 &&
      svgMsg.content.includes('fill="none"') &&
      svgMsg.content.includes('#00ffff') &&
      svgMsg.content.includes('<text') &&
      svgMsg.content.includes('<g id='));

    vm.runInNewContext(mgrSrc, sb);
    const hl = sb.MiniSketchExtensions.highlightCode;
    check('MiniSketchExtensions.highlightCode is exported', typeof hl === 'function');

    const unescapeHtml = (s) => String(s)
      .replace(/<[^>]+>/g, '')
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');

    const sampleMixed = `// Test JS + HTML + CSS + SVG
(() => {
  const NS = window.MiniSketchTools;
  const ID = 'test-hl';
  const html = \`<style>.box { padding: 8px; color: #ff0000; }</style>
<div id="\${ID}-modal" style="display:flex;gap:6px"><button onclick="return true">OK</button></div>\`;
  const re = /foo\\/bar/i;
  return { id: ID, html, re, count: 42 };
})();\n`;
    const hlMixed = hl(sampleMixed);
    check('highlightCode preserves every character losslessly for JS+HTML+CSS',
      unescapeHtml(hlMixed) === sampleMixed && unescapeHtml(hl(coasterSrc)) === coasterSrc);
    check('highlightCode emits distinct token classes for JS, HTML tags/attrs, CSS props/nums, comments, and hex colors',
      /class="hl-com"/.test(hlMixed) &&
      /class="hl-kw"/.test(hlMixed) &&
      /class="hl-api"/.test(hlMixed) &&
      /class="hl-tag"/.test(hlMixed) &&
      /class="hl-attr"/.test(hlMixed) &&
      /class="hl-hex"/.test(hlMixed) &&
      /class="hl-num"/.test(hlMixed) &&
      /class="hl-str"/.test(hlMixed));
    check('index.html wires backdrop <code id="ext-imp-code-hl"> and <code id="ext-pub-code-hl">',
      /id="ext-imp-code-hl"/.test(html) && /id="ext-pub-code-hl"/.test(html));
  }

  console.log('\n== 8. AI Builder Mode Persistence & Docs Coverage ==');
  {
    const chatSrc = fs.readFileSync(path.join(ROOT, 'ai', 'chat.js'), 'utf8');
    const storage = createStorage();

    function mountChatSandbox() {
      const { doc, byId, makeEl } = makeFakeDom();
      for (const id of ['chat-builder-mode', 'chat-input', 'chat-model-sel', 'chat-model-refresh', 'chat-think-sel', 'chat-log', 'chat-count', 'chat-send', 'chat-new', 'chat-attach', 'chat-file', 'chat-pending', 'chat-input-row']) {
        const node = makeEl(id === 'chat-input' ? 'TEXTAREA' : id.endsWith('-sel') || id === 'chat-builder-mode' ? 'SELECT' : 'DIV');
        node.id = id;
        node.style = {};
        node.scrollHeight = 60;
        byId.set(id, node);
      }
      const sb = {
        console, setTimeout, clearTimeout, setInterval, clearInterval,
        URL, TextDecoder, TextEncoder, AbortController,
        localStorage: storage,
        document: doc,
        location: { protocol: 'http:', origin: 'http://127.0.0.1:8090', href: 'http://127.0.0.1:8090/' },
        fetch: async () => ({ ok: false, json: async () => ({}) })
      };
      sb.window = sb;
      vm.runInNewContext(chatSrc, sb);
      sb.MiniSketchAI.mount({ settings: { aiModel: '', aiThinkLevel: 'normal' }, state: { entities: {} } });
      return { sb, doc };
    }

    const first = mountChatSandbox();
    check('AI builderMode defaults to svg on fresh storage',
      first.sb.MiniSketchAI.builderMode === 'svg' && first.doc.getElementById('chat-builder-mode').value === 'svg');
    first.sb.MiniSketchAI.setBuilderMode('ext');
    check('Switching to Extension mode saves minisketch.chat.builderMode in localStorage',
      storage.getItem('minisketch.chat.builderMode') === 'ext');

    const reloaded = mountChatSandbox();
    check('AI builderMode restores Extension mode & UI after simulated browser restart',
      reloaded.sb.MiniSketchAI.builderMode === 'ext' &&
      reloaded.doc.getElementById('chat-builder-mode').value === 'ext' &&
      /parametric CNC tool/i.test(reloaded.doc.getElementById('chat-input').placeholder));

    reloaded.sb.MiniSketchAI.setBuilderMode('svg');
    const reloadedSvg = mountChatSandbox();
    check('Switching back to SVG persists svg across simulated restart',
      reloadedSvg.sb.MiniSketchAI.builderMode === 'svg' &&
      reloadedSvg.doc.getElementById('chat-builder-mode').value === 'svg');

    check('app.js syncAiQuickControls preserves Extension placeholder when builderMode === "ext"',
      /MiniSketchAI\.builderMode === 'ext'/.test(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8')));

    const aiDoc = fs.readFileSync(path.join(ROOT, 'docs', 'ai.html'), 'utf8');
    const extDoc = fs.readFileSync(path.join(ROOT, 'docs', 'extensions.html'), 'utf8');
    const searchDoc = fs.readFileSync(path.join(ROOT, 'docs', 'search-data.js'), 'utf8');
    check('docs/ai.html + screenshot + docs/extensions.html + search-data cover Mode SVG/Extension & Extensions panel',
      fs.existsSync(path.join(ROOT, 'docs', 'img', 'screenshots', 'panel-ai-extension.png')) &&
      /panel-ai-extension\.png/.test(aiDoc) &&
      /Mode: SVG/.test(aiDoc) &&
      /Mode: Extension/.test(aiDoc) &&
      /Panel Testing Extension/.test(aiDoc) &&
      /Panel Extensions/.test(extDoc) &&
      /id:\s*"extensions"/.test(searchDoc));
  }

  console.log('\n' + (fail ? fail + ' FAILED, ' : 'all ') + pass + ' checks passed');
  process.exit(fail ? 1 : 0);
})();
