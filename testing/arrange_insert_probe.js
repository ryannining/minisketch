// Probe: the Arrange tab's Insert tool (arrangeInsert + collectInsertInput).
// Slices the real functions out of app.js (including the real getLoops loop
// detection and the nest decomposition nestCollectLoops / nestGroupParts) and
// runs them over fixture worlds:
//   - a green (construction) loop is the target box; everything else is an item
//   - ALL non-green objects move as ONE group: one shared delta (relative
//     layout kept, loops never pile up at the box center)
//   - works even when the green box ALREADY surrounds the objects (recenter):
//     the sheet is still the target and the inner loops are still items
//   - the whole group rotates 90° about its own center only when that makes
//     the GROUP's bounding box fit inside the green box
//
// Run: node testing/arrange_insert_probe.js
const fs = require('fs');
const path = require('path');
const C = require(path.join(__dirname, '..', 'core.js'));
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};
const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-6);

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
  const groups = rects.map(r => w.rect(r.x0, r.y0, r.x1, r.y1, r.color));
  w.recs = groups;
  // select every entity
  w.selection = Object.keys(w.state.entities).map(id => ({ kind: 'entity', id: +id }));
  return w;
}

// real loops + nest + arrange slices, with stubs for browser-only helpers
function buildSandbox(w) {
  const stubs = {
    P: 'var P = (id) => state.points[+id] || null;',
    TAU: 'var TAU = Math.PI * 2;',
    loopsDeferred: 'var loopsDeferred = false;',
    loopCache: 'var loopCache = null;',
    ui: 'var ui = { drag: false, selection: ' + JSON.stringify(w.selection) + ' };',
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
    selectionIndex: 'var selectionIndex = function(){ var m={entity:new Set(),point:new Set(),constraint:new Set()}; for(var i=0;i<ui.selection.length;i++){ var s=ui.selection[i]; var k=s.kind||"entity"; if(!m[k]) m[k]=new Set(); m[k].add(+s.id);} return m; };',
    selected: 'var selected = function(kind,id){ var m=selectionIndex(); return m[kind]?m[kind].has(+id):false; };',
    entityFullySelectedByPoints: 'var entityFullySelectedByPoints = function(){ return false; };',
    entityEditable: 'var entityEditable = function(){ return true; };',
    nestTextRec: 'var nestTextRec = function(){ return null; };',
    nestHull: 'var nestHull = function(){ return null; };',
    requestSolve: 'var requestSolve = function(){};',
    pushHistory: 'var pushHistory = function(){};',
    commit: 'var commit = function(){};',
    invalidateLoops: 'var invalidateLoops = function(){};',
    toast: 'var toast = function(){};'
  };
  let prelude = '';
  for (const k in stubs) prelude += stubs[k] + '\n';
  const real = ['colorOf', 'isConstructionColor', 'mergeBounds', 'entityBounds',
    'entityTightBounds', 'translateUnit', 'rotateUnit', 'loopEntities', 'loopShapeSelected',
    'ownedGuideIds', 'nestCollectLoops', 'nestGroupParts', 'collectInsertInput', 'arrangeInsert',
    'getLoops'];
  for (const name of real) {
    const src = slice(name);
    if (src) prelude += src + '\n';
  }
  const body = '\nreturn { arrangeInsert, collectInsertInput, getLoops, getState: () => state };';
  let fn = null;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      fn = new Function('state', 'ui', prelude + body)(w.state, { selection: w.selection, drag: false });
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

function boundsOf(w, fn, ids) {
  const st = fn.getState();
  let b = null;
  for (const id of ids) {
    const e = st.entities[id];
    if (!e) continue;
    for (const pid of [e.a, e.b]) {
      const p = st.points[pid];
      if (!p) continue;
      if (!b) b = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
      else {
        if (p.x < b.minX) b.minX = p.x;
        if (p.y < b.minY) b.minY = p.y;
        if (p.x > b.maxX) b.maxX = p.x;
        if (p.y > b.maxY) b.maxY = p.y;
      }
    }
  }
  return b;
}
const center = (b) => b ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : null;

// ---- 1) green box already surrounds the objects (recenter) ------------------
{
  const w = buildWorld([
    { x0: 0, y0: 0, x1: 100, y1: 80, color: '#00ff00' },   // green sheet
    { x0: 40, y0: 20, x1: 60, y1: 40, color: '#000000' }   // item already inside
  ]);
  const fn = buildSandbox(w);
  const ci = fn.collectInsertInput();
  check('enclosed: green sheet still detected as target', ci.target.length === 1, ci.target.length);
  check('enclosed: inner loop detected as item', ci.items.length === 1, ci.items.length);
  const before = center(boundsOf(w, fn, w.recs[1]));
  fn.arrangeInsert();
  const after = center(boundsOf(w, fn, w.recs[1]));
  const bG = boundsOf(w, fn, w.recs[0]);
  check('inner loop recentered to green center (50,40)', after && near(after.x, 50, 1e-6) && near(after.y, 40, 1e-6), after && after.x + ',' + after.y);
  check('green sheet untouched', bG && near(bG.minX, 0, 1e-6) && near(bG.minY, 0, 1e-6) &&
    near(bG.maxX, 100, 1e-6) && near(bG.maxY, 80, 1e-6), bG && JSON.stringify(bG));
  check('recenter moved the item (not a no-op)', Math.abs(after.x - before.x) + Math.abs(after.y - before.y) > 1e-9, before.x + ',' + before.y + ' -> ' + after.x + ',' + after.y);
}

// ---- 2) items outside the green box: group rotation when needed ------------
{
  const w = buildWorld([
    { x0: 0, y0: 0, x1: 100, y1: 50, color: '#00ff00' },   // green 100x50
    { x0: 200, y0: 80, x1: 220, y1: 160, color: '#000000' }, // A 20x80
    { x0: 220, y0: 80, x1: 240, y1: 150, color: '#ff0000' }  // B 20x70 -> union 40x80
  ]);
  const fn = buildSandbox(w);
  fn.arrangeInsert();
  const bA = boundsOf(w, fn, w.recs[1]);
  const bB = boundsOf(w, fn, w.recs[2]);
  const bU = boundsOf(w, fn, [...w.recs[1], ...w.recs[2]]);
  check('group union rotated to 80x40 (only way to fit 100x50)',
    bU && near(bU.maxX - bU.minX, 80, 1e-6) && near(bU.maxY - bU.minY, 40, 1e-6),
    bU ? (bU.maxX - bU.minX) + 'x' + (bU.maxY - bU.minY) : 'none');
  check('group centered in green box (x 10..90, y 5..45)',
    bU && near((bU.minX + bU.maxX) / 2, 50, 1e-6) && near((bU.minY + bU.maxY) / 2, 25, 1e-6),
    bU ? ((bU.minX + bU.maxX) / 2) + ',' + ((bU.minY + bU.maxY) / 2) : 'none');
  const dAB = { x: center(bB).x - center(bA).x, y: center(bB).y - center(bA).y };
  check('relative layout preserved under group rotation (offset 20,-5 -> -5,-20)',
    near(dAB.x, -5, 1e-6) && near(dAB.y, -20, 1e-6), dAB.x + ',' + dAB.y);
  const bG = boundsOf(w, fn, w.recs[0]);
  check('green box untouched', bG && near(bG.minX, 0, 1e-6) && near(bG.minY, 0, 1e-6) &&
    near(bG.maxX, 100, 1e-6) && near(bG.maxY, 50, 1e-6), bG && JSON.stringify(bG));
}

// ---- 3) items outside, group already fits: one shared translation ----------
{
  const w = buildWorld([
    { x0: 0, y0: 0, x1: 100, y1: 80, color: '#00ff00' },
    { x0: 200, y0: 80, x1: 220, y1: 160, color: '#000000' },   // A 20x80
    { x0: 220, y0: 80, x1: 240, y1: 150, color: '#ff0000' }    // B 20x70 -> union 40x80 fits
  ]);
  const fn = buildSandbox(w);
  const before = { a: center(boundsOf(w, fn, w.recs[1])), b: center(boundsOf(w, fn, w.recs[2])) };
  fn.arrangeInsert();
  const bU = boundsOf(w, fn, [...w.recs[1], ...w.recs[2]]);
  const after = { a: center(boundsOf(w, fn, w.recs[1])), b: center(boundsOf(w, fn, w.recs[2])) };
  check('no rotation when group already fits (union stays 40x80)',
    bU && near(bU.maxX - bU.minX, 40, 1e-6) && near(bU.maxY - bU.minY, 80, 1e-6),
    bU ? (bU.maxX - bU.minX) + 'x' + (bU.maxY - bU.minY) : 'none');
  check('group centered in 100x80 green box (x 30..70, y 0..80)',
    bU && near((bU.minX + bU.maxX) / 2, 50, 1e-6) && near((bU.minY + bU.maxY) / 2, 40, 1e-6),
    bU ? ((bU.minX + bU.maxX) / 2) + ',' + ((bU.minY + bU.maxY) / 2) : 'none');
  const dxA = after.a.x - before.a.x, dyA = after.a.y - before.a.y;
  const dxB = after.b.x - before.b.x, dyB = after.b.y - before.b.y;
  check('A and B translated by the SAME delta (one group)',
    near(dxA, dxB, 1e-6) && near(dyA, dyB, 1e-6) && (Math.abs(dxA) + Math.abs(dyA)) > 1,
    dxA + ',' + dyA + ' vs ' + dxB + ',' + dyB);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
