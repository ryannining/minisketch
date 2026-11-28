// Probe: the Arrange tab's compound rule in arrangeableUnits — a loop chosen
// as the reference (last-picked entity) stays its OWN arrange unit instead of
// being absorbed into a parent compound, so a small box inside a bigger box can
// be aligned against it (e.g. center the small box in the big one).
//
// Run: node testing/arrange_units_probe.js
const fs = require('fs');
const path = require('path');
const C = require(path.join(__dirname, '..', 'core.js'));
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

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
  if (start < 0) return null;
  let i = appSrc.indexOf('(', start), depth = 0;
  for (; i < appSrc.length; i++) {
    if (appSrc[i] === '(') depth++;
    else if (appSrc[i] === ')') { depth--; if (!depth) break; }
  }
  return appSrc.slice(start, braceEnd(appSrc, i));
};

function buildWorld(rects) {
  const w = { state: { points: {}, entities: {}, constraints: {}, layers: [{ id: 1, name: 'Layer 1', visible: true }] }, nextId: 0 };
  w.P = (id) => w.state.points[+id] || null;
  w.newId = () => ++w.nextId;
  w.pt = (x, y) => {
    const id = ++w.nextId;
    w.state.points[id] = { id, x, y };
    return id;
  };
  w.rect = (x0, y0, x1, y1, color) => {
    const ids = [];
    const segs = [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]];
    for (const [ax, ay, bx, by] of segs) {
      const id = w.newId();
      w.state.entities[id] = { id, type: 'line', color, a: w.pt(ax, ay), b: w.pt(bx, by) };
      ids.push(id);
    }
    return ids;
  };
  w.recs = rects.map(r => w.rect(r.x0, r.y0, r.x1, r.y1, r.color));
  return w;
}

const REAL = ['colorOf', 'isConstructionColor', 'mergeBounds', 'entityBounds',
  'entityTightBounds', 'loopEntities', 'loopShapeSelected', 'getLoops',
  'loopBox', 'loopContainedIn', 'loopSubtree', 'arrangeLoopContents',
  'loopTree', 'entitiesInsideLoop', 'polysCross'];

function buildSandbox(w, selection, lastPickEntityId) {
  const stubs = {
    P: 'var P = (id) => state.points[+id] || null;',
    TAU: 'var TAU = Math.PI * 2;',
    loopsDeferred: 'var loopsDeferred = false;',
    loopCache: 'var loopCache = null;',
    ui: 'var ui = { drag: false, selection: ' + JSON.stringify(selection) + ' };',
    lastPickEntityId: 'var lastPickEntityId = ' + (lastPickEntityId == null ? 'null' : lastPickEntityId) + ';',
    splineSampleCache: 'var splineSampleCache = new Map();',
    epiCache: 'var epiCache = new Map();',
    byLayerCache: 'var byLayerCache = null;',
    CONSTRUCTION_COLOR: 'var CONSTRUCTION_COLOR = "#00ff00";',
    matMul: 'var matMul = ' + C.matMul.toString() + ';',
    splineSamples: 'var splineSamples = ' + C.splineSamples.toString() + ';',
    autoHandles: 'var autoHandles = ' + C.autoHandles.toString() + ';',
    cubicAt: 'var cubicAt = ' + C.cubicAt.toString() + ';',
    pointInPoly: 'var pointInPoly = ' + C.pointInPoly.toString() + ';',
    entityPointIds: 'var entityPointIds = function(e){ if(!e) return []; if(e.type==="line") return [e.a,e.b]; if(e.type==="spline") return e.pts||[]; if(e.type==="circle") return [e.c]; if(e.type==="arc") return [e.s,e.e]; return []; };',
    layerOf: 'var layerOf = function(){ return 1; };',
    ensureSplineHandles: 'var ensureSplineHandles = function(){};',
    splineSamplesOf: 'var splineSamplesOf = function(e){ return (e.pts||[]).map(function(p){ return state.points[p]; }); };',
    arcData: 'var arcData = function(){ return null; };',
    sampleArc: 'var sampleArc = function(){ return []; };',
    circleData: 'var circleData = function(){ return null; };',
    JOIN_TOL: 'var JOIN_TOL = 0.1;',
    LOOP_CLOSE_TOL: 'var LOOP_CLOSE_TOL = 0.1;',
    SPLINE_SEG: 'var SPLINE_SEG = 12;',
    ARC_SEG: 'var ARC_SEG = 72;',
    CIRCLE_CHORD: 'var CIRCLE_CHORD = 1.5;',
    OFFSET_MITER: 'var OFFSET_MITER = 4;',
    OFFSET_TOL: 'var OFFSET_TOL = 0.05;',
    BAKE_JOIN_TOL: 'var BAKE_JOIN_TOL = 0.1;',
    ART_TOL_MM: 'var ART_TOL_MM = 0.1;',
    TEXT_TOL_MM: 'var TEXT_TOL_MM = 0.08;',
    noWeldPoints: 'var noWeldPoints = new Map();',
    loopTreeFor: 'var loopTreeFor = null;',
    loopTreeData: 'var loopTreeData = null;',
    loopTreeEpoch: 'var loopTreeEpoch = 0;',
    loopContainCache: 'var loopContainCache = null;',
    interiorProbe: 'var interiorProbe = function(pts){ var x=0,y=0,n=(pts||[]).length; for(var i=0;i<n;i++){x+=pts[i].x;y+=pts[i].y;} return n?{x:x/n,y:y/n}:null; };',
    entityEditable: 'var entityEditable = function(){ return true; };',
    entitiesInsideLoop: null,
    requestSolve: 'var requestSolve = function(){};',
    pushHistory: 'var pushHistory = function(){};',
    commit: 'var commit = function(){};',
    invalidateLoops: 'var invalidateLoops = function(){};',
    toast: 'var toast = function(){};'
  };
  let prelude = '';
  for (const k in stubs) {
    if (stubs[k] != null) prelude += stubs[k] + '\n';
  }
  for (const name of REAL) {
    const src = slice(name);
    if (src) prelude += src + '\n';
  }
  const body = '\nreturn { arrangeableUnits, getLoops, getState: () => state };';
  let fn = null;
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      fn = new Function('state', 'ui', prelude + body)(w.state, { selection, drag: false });
      break;
    } catch (e) {
      const m = /^(\w+) is not defined$/.exec(e.message);
      if (!m) throw e;
      const name = m[1];
      if (stubs[name]) prelude += stubs[name] + '\n';
      else {
        const src = slice(name);
        if (src) prelude += src + '\n';
        else prelude += 'var ' + name + ' = function () { return null; };\n';
      }
    }
  }
  if (!fn) throw new Error('could not build sandbox');
  return fn;
}

const unitBoundsOf = (fn, unit) => {
  const st = fn.getState();
  let ids = [];
  for (const id of unit.ids) { const e = st.entities[id]; if (e) ids.push(id); }
  return unit.b;
};

// ---- 1) big box + small box inside; small box is reference (selected last) --
{
  const w = buildWorld([
    { x0: 0, y0: 0, x1: 100, y1: 80, color: '#000000' },   // big box
    { x0: 40, y0: 30, x1: 60, y1: 50, color: '#000000' }    // small box inside
  ]);
  // selection order: big box first, then the small box last (reference)
  const selection = [
    ...w.recs[0].map(id => ({ kind: 'entity', id })),
    ...w.recs[1].map(id => ({ kind: 'entity', id }))
  ];
  const lastId = w.recs[1][w.recs[1].length - 1];
  const fn = buildSandbox(w, selection, lastId);
  const units = fn.arrangeableUnits();
  check('big+small: two units', units.length === 2, units.length);
  if (units.length === 2) {
    const smallIds = new Set(w.recs[1]);
    const hasSmall = units.filter(u => u.ids.some(id => smallIds.has(id)));
    check('big+small: small box is its own separate unit', hasSmall.length === 1, hasSmall.length);
    // the big-box unit must NOT contain any of the small box's entities
    const smallUnit = hasSmall[0];
    const bigUnit = units.find(u => u !== smallUnit);
    const overlap = bigUnit.ids.filter(id => smallIds.has(id));
    check('big+small: big-box unit excludes the small box', overlap.length === 0, overlap.length);
    check('big+small: own unit contains ALL small box entities',
      smallIds.size > 0 && smallIds.size === smallUnit.ids.filter(id => smallIds.has(id)).length,
      smallUnit.ids.filter(id => smallIds.has(id)).length + '/' + smallIds.size);
  }
}

// ---- 1b) big box + small box; BIG box selected last (reference = outer) ----
{
  const w = buildWorld([
    { x0: 0, y0: 0, x1: 100, y1: 80, color: '#000000' },
    { x0: 40, y0: 30, x1: 60, y1: 50, color: '#000000' }
  ]);
  // selection order: small box first, then the big box last (reference)
  const selection = [
    ...w.recs[1].map(id => ({ kind: 'entity', id })),
    ...w.recs[0].map(id => ({ kind: 'entity', id }))
  ];
  const lastId = w.recs[0][w.recs[0].length - 1];
  const fn = buildSandbox(w, selection, lastId);
  const units = fn.arrangeableUnits();
  check('big+small ref=big: two units', units.length === 2, units.length);
}

// ---- 1c) big+small via marquee (no click reference) => classic compound: 1 unit
{
  const w = buildWorld([
    { x0: 0, y0: 0, x1: 100, y1: 80, color: '#000000' },
    { x0: 40, y0: 30, x1: 60, y1: 50, color: '#000000' }
  ]);
  const selection = [
    ...w.recs[0].map(id => ({ kind: 'entity', id })),
    ...w.recs[1].map(id => ({ kind: 'entity', id }))
  ];
  const fn = buildSandbox(w, selection, null);   // no explicit click reference
  const units = fn.arrangeableUnits();
  check('big+small marquee: one compound unit (classic)', units.length === 1, units.length);
}

// ---- 2) regression: two side-by-side boxes, one reference => still two units
{
  const w = buildWorld([
    { x0: 0, y0: 0, x1: 40, y1: 40, color: '#000000' },
    { x0: 100, y0: 0, x1: 140, y1: 40, color: '#000000' }
  ]);
  const selection = [
    ...w.recs[0].map(id => ({ kind: 'entity', id })),
    ...w.recs[1].map(id => ({ kind: 'entity', id }))
  ];
  const lastId = w.recs[1][w.recs[1].length - 1];
  const fn = buildSandbox(w, selection, lastId);
  const units = fn.arrangeableUnits();
  check('side/side: two units (no merge)', units.length === 2, units.length);
}

// ---- 3) regression: only the big box selected (reference = big) => one unit
{
  const w = buildWorld([
    { x0: 0, y0: 0, x1: 100, y1: 80, color: '#000000' },
    { x0: 40, y0: 30, x1: 60, y1: 50, color: '#000000' }
  ]);
  const selection = w.recs[0].map(id => ({ kind: 'entity', id }));
  const lastId = w.recs[0][w.recs[0].length - 1];
  const fn = buildSandbox(w, selection, lastId);
  const units = fn.arrangeableUnits();
  check('only big selected: one unit', units.length === 1, units.length);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
