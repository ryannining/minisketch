// Probe: customer export cracks vs loop detection, and the per-job Weld.
// loopclose_weld.sketch is a real customer document whose junctions carry 0.1-0.17 mm
// rounding gaps: at the CNC join tolerance (0.1) no contour closes; the wider
// loop closure tolerance (0.2) must detect them, and the Weld dialog's per-job
// distance must close them permanently WITHOUT touching Settings.
//
// Run: node testing/loop_close_weld_probe.js
const fs = require('fs');
const path = require('path');
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const C = require('../core.js');
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};
function braceEnd(s, from) {
  let d = 0;
  for (let j = s.indexOf('{', from); j < s.length; j++) {
    if (s[j] === '{') d++;
    else if (s[j] === '}') { d--; if (!d) return j + 1; }
  }
  throw new Error('unbalanced');
}
const slice = (name) => {
  const start = appSrc.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('not found: ' + name);
  let i = appSrc.indexOf('(', start), depth = 0;
  for (; i < appSrc.length; i++) {
    if (appSrc[i] === '(') depth++;
    else if (appSrc[i] === ')') { depth--; if (!depth) break; }
  }
  return appSrc.slice(start, braceEnd(appSrc, i));
};

function harness(state, closeTol) {
  const env = {
    state,
    ui: { drag: false },
    loopCache: null,
    loopsDeferred: false,
    JOIN_TOL: 0.1,
    LOOP_CLOSE_TOL: closeTol,
    splineSampleCache: new Map(),
    P: (id) => state.points[+id] || null,
    layerOf: (e) => (e && e.layer != null ? e.layer : 1),
    colorOf: (e) => (e && e.color) || '#000000',
    normColor: (c) => c,
    entityPointIds: (e) => {
      if (!e) return [];
      if (e.type === 'line') return [e.a, e.b];
      if (e.type === 'arc') return [e.c, e.s, e.e];
      if (e.type === 'circle') return [e.c];
      if (e.type === 'spline') return e.pts || [];
      return [];
    },
    arcData: () => null,
    splineSamples: C.splineSamples,
    sampleArc: C.sampleArc,
    autoHandles: C.autoHandles,
    signedAreaPts: C.signedAreaPts,
    pointInPoly: C.pointInPoly,
    newId: () => ++state.nextId
  };
  const body = [
    slice('ensureSplineHandles'),
    slice('splineSamplesOf'),
    slice('getLoops'),
    slice('weldPoints'),
    slice('loopWeldPairs'),
    slice('weldWithTol')
  ].join('\n');
  const api = new Function(...Object.keys(env),
    body + '\nreturn { getLoops, weldWithTol, loopWeldPairs };');
  return api(...Object.values(env));
}

function loadSketch() {
  const doc = JSON.parse(fs.readFileSync(path.join(__dirname, 'loopclose_weld.sketch'), 'utf8'));
  const st = doc.state;
  const points = {};
  for (const id in st.points) {
    const p = st.points[id];
    points[id] = Array.isArray(p) ? { id: +id, x: p[0], y: p[1] } : p;
  }
  // saved handles are [x,y] pairs; the app loader materialises them to objects
  const entities = {};
  for (const id in st.entities) {
    const e = Object.assign({}, st.entities[id]);
    if (e.hs) {
      const conv = (arr) => (arr || []).map(h => (Array.isArray(h) ? { x: h[0], y: h[1] } : h));
      e.hs = { o: conv(e.hs.o), i: conv(e.hs.i) };
    }
    entities[id] = e;
  }
  return { points, entities, constraints: st.constraints || {}, nextId: st.nextId || 1000 };
}

// ---- detection tolerance --------------------------------------------------
{
  const at01 = harness(loadSketch(), 0.1).getLoops();
  const at025 = harness(loadSketch(), 0.25).getLoops();
  check('customer file: no loops at CNC join tolerance 0.1', at01.length === 0, at01.length);
  check('customer file: all 7 contours at closure gap 0.25', at025.length === 7, at025.length);
}

// ---- per-job weld closes the cracks permanently ---------------------------
{
  const st = loadSketch();
  const api = harness(st, 0.1);
  const welded = api.weldWithTol(0.25, false);
  check('weld at 0.25 closes junction gaps', welded > 0, welded);
  const loops = api.getLoops();
  check('after weld, loops close even at tolerance 0.1', loops.length === 7, loops.length);
}
{
  const st = loadSketch();
  const api = harness(st, 0.1);
  const w01 = api.weldWithTol(0.1, false);
  const st2 = loadSketch();
  const w025 = harness(st2, 0.1).weldWithTol(0.25, false);
  check('weld distance drives how many gaps close', w01 < w025, w01 + ' vs ' + w025);
}
{
  // junctions-only mode welds exactly the detected loop junctions
  const st = loadSketch();
  const api = harness(st, 0.25);
  const pairs = api.loopWeldPairs(api.getLoops());
  const welded = api.weldWithTol(0.25, true);
  check('junctions-only weld matches loop junction pairs', welded > 0 && welded <= pairs.length,
    welded + ' of ' + pairs.length);
}

// ---- colour / layer guards ------------------------------------------------
{
  const st = { points: {}, entities: {}, constraints: {}, nextId: 0 };
  const pt = (x, y) => { const id = ++st.nextId; st.points[id] = { id, x, y }; return id; };
  const line = (x1, y1, x2, y2, color) => {
    const id = ++st.nextId;
    st.entities[id] = { id, type: 'line', color, layer: 1, a: pt(x1, y1), b: pt(x2, y2) };
    return id;
  };
  line(0, 0, 10, 0, '#000000');
  line(10.05, 0, 20, 0, '#ff0000');
  const api = harness(st, 0.1);
  check('different colours never weld', api.weldWithTol(0.2, false) === 0);
  const st2 = { points: {}, entities: {}, constraints: {}, nextId: 0 };
  const pt2 = (x, y) => { const id = ++st2.nextId; st2.points[id] = { id, x, y }; return id; };
  const mk = (x1, y1, x2, y2, layer) => {
    const id = ++st2.nextId;
    st2.entities[id] = { id, type: 'line', color: '#000000', layer, a: pt2(x1, y1), b: pt2(x2, y2) };
  };
  mk(0, 0, 10, 0, 1);
  mk(10.05, 0, 20, 0, 2);
  check('different layers never weld', harness(st2, 0.1).weldWithTol(0.2, false) === 0);
}

// ---- Shift+L / Cleanup loops must not shred curves ------------------------
{
  const st = { points: {}, entities: {}, constraints: {}, nextId: 0 };
  const pt = (x, y) => { const id = ++st.nextId; st.points[id] = { id, x, y }; return id; };
  const A = pt(0, 0), B = pt(100, 0), Cp = pt(100, 100), D1 = pt(0.15, 100);
  const D2 = pt(0, 100), M = pt(0, 50);
  const line = (a, b) => { const id = ++st.nextId; st.entities[id] = { id, type: 'line', color: '#000000', layer: 1, a, b }; return id; };
  line(A, B); line(B, Cp); line(Cp, D1);
  const sid = ++st.nextId;
  st.entities[sid] = { id: sid, type: 'spline', color: '#000000', layer: 1, pts: [D2, M, A], hs: { o: [null, null, null], i: [null, null, null] } };
  const env = {
    state: st,
    ui: { drag: false },
    loopCache: null,
    loopsDeferred: false,
    JOIN_TOL: 0.1,
    LOOP_CLOSE_TOL: 0.25,
    splineSampleCache: new Map(),
    P: (id) => st.points[+id] || null,
    layerOf: (e) => (e && e.layer != null ? e.layer : 1),
    normColor: (c) => c,
    entityPointIds: (e) => (e.type === 'line' ? [e.a, e.b] : e.pts || []),
    arcData: () => null,
    splineSamples: C.splineSamples,
    sampleArc: C.sampleArc,
    autoHandles: C.autoHandles,
    signedAreaPts: C.signedAreaPts,
    pointInPoly: C.pointInPoly,
    newId: () => ++st.nextId,
    invalidateLoops: () => { env.loopCache = null; },
    pushHistory: () => {},
    history: { pop: () => {} },
    updateHistoryButtons: () => {},
    commit: () => {},
    toast: () => {},
    fmt: (v) => String(v)
  };
  const body = [
    slice('ensureSplineHandles'),
    slice('splineSamplesOf'),
    slice('getLoops'),
    slice('weldPoints'),
    slice('loopWeldPairs'),
    slice('cleanUpLoops')
  ].join('\n');
  const api = new Function(...Object.keys(env), body + '\nreturn { cleanUpLoops, getLoops };')(...Object.values(env));
  api.cleanUpLoops();
  check('cleanup welds the 0.15 junction crack', st.entities[sid].pts[0] === D1 || st.points[D1] === undefined,
    'spline start ' + st.entities[sid].pts[0] + ' vs ' + D1);
  check('cleanup keeps every far-apart spline node', st.entities[sid].pts.length === 3, st.entities[sid].pts.length);
  check('cleanup leaves the contour a closed loop', api.getLoops().length === 1, api.getLoops().length);
}

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);