// Regression probe for the MiniSketch -> KaryaCNC bridge.
//
// 1. Slices the live CNC block out of ../app.js (never a copy of it) and runs it
//    over a fixture sketch.
// 2. Feeds the produced payload into KaryaCNC's real pathstoText1() sliced out of
//    /mnt/smbshare/wails/karyacnc/frontend/public/appcore.js.
// 3. Asserts path count, closure, stroke/fill codes, mm scale and Y mirror.
//
// Run: node testing/kc_payload_probe.js
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'app.js');
const KC = '/mnt/smbshare/wails/karyacnc/frontend/public/appcore.js';
const KC_OTHER = '/mnt/smbshare/wails/karyacnc/frontend/public/karyacnc.js';

const appSrc = fs.readFileSync(APP, 'utf8');
// pure helpers moved to core.js; fall back to it when app.js no longer
// defines the function (keeps the probe working across that refactor)
const Core = require(path.join(__dirname, '..', 'core.js'));

const kcSrc = fs.readFileSync(KC, 'utf8');
const kcOther = fs.readFileSync(KC_OTHER, 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
}

function sliceBraced(src, start) {
  let i = src.indexOf('{', start);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(start, j + 1);
    }
  }
  throw new Error('unbalanced slice');
}
function sliceOrCore(name) {
  const start = appSrc.indexOf('function ' + name + '(');
  // pure math moved to core.js; fall back to it when app.js no longer has it
  if (start < 0) {
    if (typeof Core[name] === 'function') return Core[name].toString();
    throw new Error('not found: ' + name);
  }
  return sliceBraced(appSrc, start);
}

// ---- fixture sketch: 100 x 50 rectangle made of 4 lines, one blue engrave
// line, one circle with a yellow fill, one circle with a gray fill -----------
const state = {
  points: {
    1: { id: 1, x: 0, y: 0 },
    2: { id: 2, x: 100, y: 0 },
    3: { id: 3, x: 100, y: 50 },
    4: { id: 4, x: 0, y: 50 },
    5: { id: 5, x: 30, y: 25 },
    6: { id: 6, x: 0, y: 60 },
    7: { id: 7, x: 40, y: 60 },
    8: { id: 8, x: 70, y: 25 }
  },
  entities: {
    10: { id: 10, type: 'line', a: 1, b: 2, color: '#000000' },
    11: { id: 11, type: 'line', a: 2, b: 3, color: '#000000' },
    12: { id: 12, type: 'line', a: 3, b: 4, color: '#000000' },
    13: { id: 13, type: 'line', a: 4, b: 1, color: '#000000' },
    14: { id: 14, type: 'circle', c: 5, r: 10, color: '#000000', fill: 'yellow' },
    15: { id: 15, type: 'line', a: 6, b: 7, color: '#0000ff' },
    16: { id: 16, type: 'circle', c: 8, r: 6, color: '#800080', fill: 'gray' }
  },
  constraints: {},
  layers: [
    { id: 1, name: 'Layer 1', visible: true, locked: false }
  ],
  nextLayerId: 2,
  nextId: 30
};
const ui = { activeLayer: 1, selection: [], color: '#000000' };

const fmtStub = (n) => String(Math.round(n * 100) / 100);
const noopStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

let prelude = '';
let api = null;
function buildCncBlock() {
  const start = appSrc.indexOf('  // ---- Send to KaryaCNC');
  const end = appSrc.indexOf('  function bindUI() {', start);
  const block = appSrc.slice(start, end);
  const tail = '\n return { cnc, cncCollectItems, cncBuildPayload, cncPolyline, cncChains, cncColorStroke, cncFillCode };';
  const params = ['state', 'ui', 'TAU', 'fmt', 'toast', 'localStorage', 'document', 'location', 'WebSocket', 'window'];
  const fn = new Function(...params, prelude + block + tail);
  return fn.bind(null, state, ui, Math.PI * 2, fmtStub, () => {}, noopStorage, {}, { hostname: '127.0.0.1' }, function () {}, {});
}
function stubFor(name) {
  if (name === 'norm2pi') return 'function (a) { var t = a % (Math.PI * 2); return t < 0 ? t + Math.PI * 2 : t; }';
  if (name === 'dist') return 'function (a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }';
  return 'null';
}
for (let attempt = 0; attempt < 40; attempt++) {
  try {
    api = buildCncBlock()();
    api.cnc.scope = 'visible';   // exercise the layer filter so helpers resolve
    api.cncCollectItems();   // smoke: surfaces missing helpers here
    break;
  } catch (e) {
    const m = /^(\w+) is not defined$/.exec(e.message);
    api = null;
    if (!m) throw e;
    let def = null;
    try { def = sliceOrCore(m[1]); } catch (err) { def = null; }
    if (def) prelude += def + '\n';
    else prelude += 'var ' + m[1] + ' = ' + stubFor(m[1]) + ';\n';
  }
}
if (!api) throw new Error('could not build the CNC block');
api.cnc.scope = 'visible';   // the fixture has no selection; the shipped default is 'selected'

console.log('\n== 1. payload from the fixture sketch ==');
const payload = api.cncBuildPayload(api.cncCollectItems());
if (!payload) throw new Error('payload builder returned null');
console.log(payload.text);
check('4 paths (rect chain + yellow circle + open blue line + gray circle)', payload.paths === 4, payload.paths);
check('bbox 100 x 60 mm', Math.abs(payload.width - 100) < 1e-6 && Math.abs(payload.height - 60) < 1e-6,
  payload.width + ' x ' + payload.height);
check('black cut header', /P:none:#000000:0/.test(payload.text));
check('blue engrave header', /P:none:#0000ff:0/.test(payload.text));
check('yellow fill header', /P:#ffff00:#000000:0/.test(payload.text));
check('gray fill header', /P:#808080:#800080:0/.test(payload.text));
check('closing point repeated on the rectangle', /^0,60$/m.test(payload.text) &&
  payload.text.split('\n').filter(l => l === '0,60').length >= 2,
  payload.text.split('\n').filter(l => l === '0,60').length);

console.log('\n== 2. stroke / fill codes ==');
check('#800080 passes through untouched', api.cncColorStroke('#800080') === '#800080');
check('uppercase is normalised', api.cncColorStroke('#00FF00') === '#00ff00');
check('missing colour falls back to cut', api.cncColorStroke('') === '#000000');
check('unknown fill falls back to none', api.cncFillCode('rainbow') === 'none');

// ---- 3. feed the payload into KaryaCNC's own parser ---------------------
console.log('\n== 3. KaryaCNC pathstoText1() parses it back ==');
function kcSlice(name) {
  for (const src of [kcSrc, kcOther]) {
    const start = src.indexOf('function ' + name + '(');
    if (start >= 0) return sliceBraced(src, start);
  }
  return null;
}
const stu = {};
const env = {
  getnumber: () => 0.1,
  getchecked: () => false,
  getvalue: (id) => (stu[id] !== undefined ? stu[id] : '1'),
  setvalue: (id, v) => { stu[id] = v; },
  sqr: (x) => x * x,
  mround: (x) => Math.round(x * 1000) / 1000,
  mround2: (x) => Math.round(x * 100) / 100,
  console: { log: () => {} },
  sqrt: Math.sqrt,
  cmd: 3,
  CMD_LASER: 1, CMD_FOAM: 2, CMD_CNC: 3, CMD_3D: 4, CMD_PLASMA: 5
};
let kcBody = '';
['RBcolor', 'isInside', 'defaultsty'].forEach((n) => { const s = kcSlice(n); if (s) kcBody += s + '\n'; });
const kcFnSrc = sliceBraced(kcSrc, kcSrc.indexOf('function pathstoText1('));
const kcText = kcFnSrc.replace('return t1;', 'globalThis.__kc = { paths: paths }; return t1;');
const kcBuild = () => new Function(...Object.keys(env), kcBody + kcText + '\nreturn pathstoText1;')(...Object.values(env));
let kcRun = kcBuild();
let svg = null;
for (let attempt = 0; attempt < 20; attempt++) {
  try { svg = kcRun(payload.text); break; }
  catch (e) {
    const m = /^(\w+) is not defined$/.exec(e.message);
    if (!m) throw e;
    const def = kcSlice(m[1]);
    if (def) kcBody += def + '\n'; else env[m[1]] = 1;
    kcRun = kcBuild();
  }
}
if (svg == null) throw new Error('KaryaCNC parser rejected the payload');
const parsed = globalThis.__kc.paths;
parsed.forEach((p, i) => {
  console.log('  path' + i, 'pts=' + p[0].length, 'closed=' + p[8],
    'fill=' + p[9].fill, 'stroke=' + p[9].stroke);
});
check('KaryaCNC sees 4 paths', parsed.length === 4, parsed.length);
const rect = parsed.find(p => p[0].length === 5 && p[8]);
const openLine = parsed.find(p => p[0].length === 2);
const yellowPath = parsed.find(p => p[9].fill === '#ffff00');
const grayPath = parsed.find(p => p[9].fill === '#808080');
check('rectangle arrived as one closed 5-point path', !!rect);
check('rectangle stroke is cut black', !!rect && rect[9].stroke === '#000000', rect && rect[9].stroke);
check('open engrave line stays open', !!openLine && openLine[8] === false, openLine && openLine[8]);
check('open line keeps the blue engrave stroke', !!openLine && openLine[9].stroke === '#0000ff',
  openLine && openLine[9].stroke);
check('yellow fill survives on a closed contour', !!yellowPath && yellowPath[8] === true);
check('gray fill survives on a pocket contour', !!grayPath && grayPath[9].stroke === '#800080',
  grayPath && grayPath[9].stroke);
const widthAttr = /width="([^"]+)"/.exec(svg)[1];
check('workpiece stays 100mm wide', widthAttr === '100mm', widthAttr);
check('Y mirrored (bottom-left origin)', /M0 0/.test(svg.replace(/\r/g, '')));

console.log('\n' + (fail ? (fail + ' FAILED, ' + pass + ' passed') : ('all ' + pass + ' checks passed')));
process.exit(fail ? 1 : 0);
