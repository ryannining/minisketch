// Probe: the bundled-vs-system routing in fonts/fonts.js. A family the catalogue
// bundles (Carlito) that is ALSO installed on the machine must load from its own
// bundled bytes (inject the per-font script), never hijack to the system path
// (loadSystem -> queryLocalFonts), which needs a user gesture and so cannot run
// from a background load. Also: a weight a family does not ship must be reported
// by hasMember as absent (the text-preview freeze guard), and importSystemFonts
// must not remember bundled families as "system". Run:
//   node testing/font_system_routing_probe.js
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

// ---- minimal browser mock -------------------------------------------------
let regRef = null;
let injectedFiles = [];     // per-font scripts the bundled path injected
function makeEl() { return { children: [], appendChild(c) { this.children.push(c); return c; } }; }
const fakeHead = {
  appendChild(el) {
    const m = /fonts\/([^/?#]+\.js)/.exec(el.src || '');
    if (m) injectedFiles.push(m[1]);
    // Simulate the injected script doing its one job: MiniSketchFonts.define.
    if (m && regRef) {
      const entry = regRef.index().find(f => f.file === m[1]);
      if (entry) regRef.define(Object.assign({}, entry, { b64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA' }));
    }
    if (el.onload) setTimeout(el.onload, 0);
  },
};
const fakeDocument = {
  currentScript: { src: 'file:///app/fonts/fonts.js' },
  head: fakeHead,
  fonts: { add() {} },
  createElement: () => makeEl(),
};
const store = {};
const fakeLocalStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
};
class FakeFontFace { constructor() {} load() { return Promise.resolve(); } }

// Carlito is installed AND bundled; Arial is system-only.
let systemInstalled = [
  { family: 'Carlito', fullName: 'Carlito', style: 'Regular' },
  { family: 'Arial', fullName: 'Arial', style: 'Regular' },
];
let queryLocalFontsCalls = 0;
const fakeNavigator = { permissions: { query: () => Promise.resolve({ state: 'granted' }) } };

// Pretend an older build already remembered Carlito as a "system" font.
store['minisketch.systemFonts.v1'] = JSON.stringify([
  { family: 'Carlito', weight: 400, style: 'normal' },
  { family: 'Arial', weight: 400, style: 'normal' },
]);

const src = fs.readFileSync(path.join(__dirname, '..', 'fonts', 'fonts.js'), 'utf8');
const run = new Function('document', 'location', 'localStorage', 'navigator', 'FontFace',
  'Blob', 'console', 'setTimeout', 'atob', 'indexedDB', 'window', 'queryLocalFonts',
  src + '\nreturn window.MiniSketchFonts;');
const windowObj = {};
windowObj.queryLocalFonts = () => { queryLocalFontsCalls++; return Promise.resolve(systemInstalled); };
const reg = run(fakeDocument, { href: 'file:///app/index.html' }, fakeLocalStorage, fakeNavigator,
  FakeFontFace, class { arrayBuffer() { return Promise.resolve(new ArrayBuffer(8)); } },
  console, setTimeout, (s) => Buffer.from(s, 'base64').toString('binary'), undefined,
  windowObj, windowObj.queryLocalFonts);
regRef = reg;

// Run a promise with a hard timeout so a regression that hangs fails loudly
// instead of stalling the probe.
const withTimeout = (p, ms) => Promise.race([
  p.then(v => ({ settled: true, v }), e => ({ settled: true, e })),
  new Promise(r => setTimeout(() => r({ settled: false }), ms)),
]);

(async () => {
  // ---- hasMember ----------------------------------------------------------
  check('hasMember: bundled Carlito 400 normal', reg.hasMember('Carlito', 400, 'normal') === true);
  check('hasMember: Carlito 700 (not shipped) false', reg.hasMember('Carlito', 700, 'normal') === false);

  // ---- bundled family that is also system-installed loads from its bytes ---
  // We assert the ROUTING (which path it took), not full registration: the fake
  // b64 below cannot be parsed by parseFont, so awaiting the whole load would
  // stall on garbage bytes. Real bundled files carry valid bytes.
  injectedFiles = []; queryLocalFontsCalls = 0;
  reg.load('Carlito', 400, 'normal');
  await new Promise(r => setTimeout(r, 30));   // let the inject + define run
  check('load(Carlito) took the BUNDLED path (injected carlito.js)',
    injectedFiles.includes('carlito.js'), 'injected=' + JSON.stringify(injectedFiles));
  check('load(Carlito) did NOT call queryLocalFonts', queryLocalFontsCalls === 0,
    'calls=' + queryLocalFontsCalls);
  // NOTE: we deliberately do NOT await the full load here. Its tail runs
  // parseFont on the FAKE b64 this harness injects, which loops on garbage
  // bytes; real bundled files carry valid bytes and settle fine. The routing
  // (the actual fix under test) is asserted by the two checks above.

  // ---- a weight the family does not ship must still settle (no freeze) ----
  injectedFiles = []; queryLocalFontsCalls = 0;
  const light = await withTimeout(reg.load('Carlito', 300, 'normal'), 800);
  check('load(Carlito,300) settles (no endless re-schedule)', light.settled);

  // ---- importSystemFonts skips bundled families --------------------------
  store['minisketch.systemFonts.v1'] = '[]';
  const n = await withTimeout(reg.importSystemFonts(), 800);
  const remembered = JSON.parse(store['minisketch.systemFonts.v1'] || '[]');
  check('importSystemFonts counted only non-bundled (Arial=1)', n.v === 1, 'n=' + n.v);
  check('importSystemFonts did NOT remember bundled Carlito',
    !remembered.some(f => f.family === 'Carlito'), JSON.stringify(remembered));
  check('importSystemFonts remembered system-only Arial',
    remembered.some(f => f.family === 'Arial'), JSON.stringify(remembered));

  // ---- system-only family routes to the system path ----------------------
  injectedFiles = []; queryLocalFontsCalls = 0;
  const arial = await withTimeout(reg.load('Arial', 400, 'normal'), 800);
  check('load(Arial) called queryLocalFonts (system path)', queryLocalFontsCalls > 0,
    'calls=' + queryLocalFontsCalls);
  check('load(Arial) did NOT inject a bundled script',
    injectedFiles.length === 0, 'injected=' + JSON.stringify(injectedFiles));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('probe error', e); process.exit(1); });
