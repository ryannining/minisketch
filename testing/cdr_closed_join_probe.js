// Probe: closed imported primitives (boxes, ellipse outlines, closed paths)
// must stay ONE loop each — imported "join" must never weld them to other
// shapes. Regression for testimport/test10.cdr: two rectangles sharing an
// edge. Before the fix, joinImportedSegments deduped the shared edge and
// welded the two boxes into one loop plus leftover centre lines; the two
// boxes must remain two independent closed loops.
//
// Also guards the flip side: OPEN chains must still join (a split contour of
// two open pieces must weld back into one loop).
//
// Run: node testing/cdr_closed_join_probe.js
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

// minimal world replicating importPrimsIntoDocument's straight-prim path with
// the closed-loop lock, plus the real joinImportedSegments slice
function world() {
  const w = { state: { points: {}, entities: {}, constraints: {} }, nextId: 0 };
  w.P = (id) => w.state.points[+id] || null;
  w.newId = () => ++w.nextId;
  w.pt = (x, y) => {
    const id = ++w.nextId;
    w.state.points[id] = { id, x, y };
    return id;
  };
  w.importPrims = (prims, color) => {
    const lineIds = [];
    for (const pr of prims) {
      if (pr.kind === 'note' || pr.kind === 'circle') continue;
      let ids = pr.nodes.map(nd => w.pt(nd.p[0], nd.p[1]));
      if (pr.closed && ids.length > 2) {
        const p0 = w.state.points[ids[0]], pn = w.state.points[ids[ids.length - 1]];
        if (p0 && pn && Math.hypot(p0.x - pn.x, p0.y - pn.y) < 1e-9) {
          ids = ids.slice(0, -1);
        }
      }
      const last = pr.closed ? ids.length : ids.length - 1;
      for (let i = 0; i < last; i++) {
        const a = ids[i], b = ids[(i + 1) % ids.length];
        if (a === b) continue;
        const id = w.newId();
        w.state.entities[id] = { id, type: 'line', a, b, color };
        if (!pr.closed) lineIds.push(id);
      }
    }
    return lineIds;
  };
  w.join = new Function(
    'state', 'P', 'JOIN_TOL', 'settings', 'newId',
    slice('weldPoints') + '\n' + slice('joinImportedSegments') + '\nreturn joinImportedSegments;'
  )(w.state, w.P, 0.1, { curveSharpAngle: 25, curveFitTol: 0.2 }, () => ++w.nextId);
  w.runJoin = (lineIds, tol) => w.join(lineIds, tol);
  return w;
}

// real getLoops slice (harness from testing/loops_probe.js)
function buildGetLoops(state) {
  const P = (id) => state.points[id];
  let prelude = 'var loopCache = null;\n' +
    'var autoHandles = ' + C.autoHandles.toString() + ';\n' +
    'var cubicAt = ' + C.cubicAt.toString() + ';\n' +
    'var splineSamples = ' + C.splineSamples.toString() + ';\n';
  const stubs = {
    TAU: 'var TAU = Math.PI * 2;',
    loopsDeferred: 'var loopsDeferred = false;',
    ui: 'var ui = { drag: false };',
    splineSampleCache: 'var splineSampleCache = new Map();',
    epiCache: 'var epiCache = new Map();',
    byLayerCache: 'var byLayerCache = null;',
    arcData: 'var arcData = function(){ return null; };',
    sampleArc: 'var sampleArc = function(){ return []; };',
    circleData: 'var circleData = function(){ return null; };',
    ensureSplineHandles: 'var ensureSplineHandles = function(){ };',
    splineSamplesOf: 'var splineSamplesOf = function(e){ return (e.pts||[]).map(function(p){ return state.points[p]; }); };',
    entityPointIds: 'var entityPointIds = function(e){ if(!e) return []; if(e.type==="line") return [e.a,e.b]; if(e.type==="spline") return e.pts||[]; if(e.type==="circle") return [e.c]; if(e.type==="arc") return [e.s,e.e]; return []; };',
    layerOf: 'var layerOf = function(e){ return (e&&e.layer)||1; };',
    getLayer: 'var getLayer = function(){ return null; };',
    SPLINE_SEG: 'var SPLINE_SEG = 12;',
    ARC_SEG: 'var ARC_SEG = 72;',
    CIRCLE_CHORD: 'var CIRCLE_CHORD = 1.5;',
    OFFSET_MITER: 'var OFFSET_MITER = 4;',
    OFFSET_TOL: 'var OFFSET_TOL = 0.05;',
    BAKE_JOIN_TOL: 'var BAKE_JOIN_TOL = 0.1;',
    JOIN_TOL: 'var JOIN_TOL = 0.1;',
    LOOP_CLOSE_TOL: 'var LOOP_CLOSE_TOL = 0.1;',
    ART_TOL_MM: 'var ART_TOL_MM = 0.1;',
    TEXT_TOL_MM: 'var TEXT_TOL_MM = 0.08;'
  };
  const params = ['state', 'P'];
  const values = [state, P];
  const mk = () => new Function(...params, prelude + slice('getLoops') + '\nreturn getLoops();')(...values);
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      return mk();
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
  throw new Error('could not build getLoops');
}

function unusedSegments(w, loops) {
  const used = new Set();
  for (const l of loops) for (const s of (l.steps || [])) used.add(+s.edge.entity);
  return Object.keys(w.state.entities).filter(id => !used.has(+id)).map(Number);
}

(async () => {
  const buf = fs.readFileSync(path.join(__dirname, '..', 'testimport/test10.cdr'));
  const prims = await C.parseCdr(new Uint8Array(buf));
  check('fixture: test10.cdr parses to 2 closed prims', prims.length === 2 && prims.every(p => p.closed), prims.length);
  const color = '#000000';

  // 1) import + join (the dialog default) must keep two independent loops
  {
    const w = world();
    const lineIds = w.importPrims(prims, color);
    const welded = w.runJoin(lineIds, 0.1);
    const loops = buildGetLoops(w.state);
    check('join never welds closed prims (welded=0)', welded === 0, welded);
    check('two loops stay separate', loops.length === 2, loops.length);
    if (loops.length === 2) {
      const areas = loops.map(l => l.area).sort((a, b) => a - b);
      check('both loops keep the full box area', areas[0] > 2.8e6 && Math.abs(areas[1] - areas[0]) < 1, areas);
      check('no centre-line leftovers (all segments used)', unusedSegments(w, loops).length === 0,
        unusedSegments(w, loops).length);
      for (const l of loops) {
        check('each loop has 4 steps (its own box)', l.steps.length === 4, l.steps.length);
      }
    }
  }

  // 2) import without join must behave the same (closed prims are unaffected)
  {
    const w = world();
    const lineIds = w.importPrims(prims, color);
    check('no zero-length closing segments created', Object.keys(w.state.entities).length === 8,
      Object.keys(w.state.entities).length);
    const loops = buildGetLoops(w.state);
    check('no-join: two loops stay separate', loops.length === 2, loops.length);
  }

  // 3) open chains must STILL join (the lock must not over-reach)
  {
    const w = world();
    // one rectangle split into two open L chains sharing the same corner coords
    const mk = (x1, y1, x2, y2) => {
      const id = w.newId();
      w.state.entities[id] = { id, type: 'line', color, a: w.pt(x1, y1), b: w.pt(x2, y2) };
      return id;
    };
    const ids = [mk(0, 0, 10, 0), mk(10, 0, 10, 10), mk(10, 10, 0, 10), mk(0, 10, 0, 0)];
    const welded = w.runJoin(ids, 0.1);
    check('open chains still weld', welded > 0, welded);
    const loops = buildGetLoops(w.state);
    check('welded open chains form one loop', loops.length === 1, loops.length);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
