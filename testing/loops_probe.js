// Probe for loop detection on mixed chains (lines + converted splines).
// Slices getLoops() out of ../app.js and runs it over fixtures: an open spline
// used as an edge of the loop graph, with shared end points and with duplicate
// end points at the same coordinates (what a convert leaves behind).
//
// Run: node testing/loops_probe.js
const fs = require('fs');
const path = require('path');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

function braceEnd(src, from) {
  let i = src.indexOf('{', from), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) return j + 1; }
  }
  throw new Error('unbalanced');
}
const sliceApp = (name) => {
  const start = appSrc.indexOf('function ' + name + '(');
  if (start < 0) return null;
  let i = appSrc.indexOf('(', start), depth = 0;
  for (; i < appSrc.length; i++) {
    if (appSrc[i] === '(') depth++;
    else if (appSrc[i] === ')') { depth--; if (!depth) break; }
  }
  return appSrc.slice(start, braceEnd(appSrc, i));
};

const stubs = {
  TAU: 'var TAU = Math.PI * 2;',
  loopCache: 'var loopCache = null;',
  loopsDeferred: 'var loopsDeferred = false;',
  ui: 'var ui = { drag: false };',
  splineSampleCache: 'var splineSampleCache = new Map();',
  epiCache: 'var epiCache = new Map();',
  byLayerCache: 'var byLayerCache = null;',
  arcData: 'var arcData = function(e){ var c = state.points[e.c]; var s = state.points[e.s]; var a0 = Math.atan2(s.y-c.y, s.x-c.x); var a1 = a0 + Math.PI/2; return { c: c, r: Math.hypot(s.x-c.x, s.y-c.y), a0: a0, a1: a1, sweep: Math.PI/2 }; };',
  sampleArc: 'var sampleArc = function(c,r,a0,sweep,reverse){ var n=12, out=[]; for(var i=0;i<=n;i++){ var t=reverse?1-i/n:i/n, a=a0+sweep*t; out.push({x:c.x+Math.cos(a)*r,y:c.y+Math.sin(a)*r}); } return out; };',
  circleData: 'var circleData = function(e){ if(e.type==="circle"){ var c=state.points[e.c]; return { c: c, r: e.r }; } if(e.type==="arc"){ var c=state.points[e.c]; var s=state.points[e.s]; return { c: c, r: Math.hypot(s.x-c.x,s.y-c.y) }; } return null; };',
  ensureSplineHandles: 'var ensureSplineHandles = function(){ };',
  splineSamplesOf: 'var splineSamplesOf = function(e){ return (e.pts||[]).map(function(p){ return state.points[p]; }); };',
  // the probe runs app.js's splineSamplesOf, which needs the core sampler plus
  // the same handle fallback app.js gets from core.js at load time
  splineSamples: 'var splineSamples = ' + (function(){ const C = require('../core.js'); return C.splineSamples.toString(); })() + ';',
  autoHandles: 'var autoHandles = ' + (function(){ const C = require('../core.js'); return C.autoHandles.toString(); })() + ';',
  // these live in the Settings window now, so give the probe their defaults
  SPLINE_SEG: 'var SPLINE_SEG = 12;',
  ARC_SEG: 'var ARC_SEG = 72;',
  CIRCLE_CHORD: 'var CIRCLE_CHORD = 1.5;',
  OFFSET_MITER: 'var OFFSET_MITER = 4;',
  OFFSET_TOL: 'var OFFSET_TOL = 0.05;',
  BAKE_JOIN_TOL: 'var BAKE_JOIN_TOL = 0.1;',
  JOIN_TOL: 'var JOIN_TOL = 0.1;',
  ART_TOL_MM: 'var ART_TOL_MM = 0.1;',
  TEXT_TOL_MM: 'var TEXT_TOL_MM = 0.08;'
};

let state = null;
function buildGetLoops(fixture) {
  state = fixture;
  // splineSamplesOf in app.js is cache-backed (splineSampleCache), which the
  // slice cannot see; give the probe the same sampler built from core.js so the
  // fixture splines resolve exactly as they would in the app.
  const C = require('../core.js');
  let prelude = 'var loopCache = null;\n' +
    'var autoHandles = ' + C.autoHandles.toString() + ';\n' +
    'var cubicAt = ' + C.cubicAt.toString() + ';\n' +
    'var splineSamples = ' + C.splineSamples.toString() + ';\n';
  const P = (id) => state.points[id];
  const params = ['state', 'P'];
  const values = [state, P];
  const mk = () => new Function(...params, prelude + sliceApp('getLoops') + '\nreturn getLoops();')(...values);
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const fn = mk();
      return fn;
    } catch (e) {
      const m = /^(\w+) is not defined$/.exec(e.message);
      if (!m) throw e;
      const name = m[1];
      const src = sliceApp(name);
      if (src) prelude += src + '\n';
      else if (stubs[name]) prelude += stubs[name] + '\n';
      else prelude += 'var ' + name + ' = function () { return null; };\n';
    }
  }
  throw new Error('could not build getLoops');
}

const run = (fixture) => buildGetLoops(fixture);

// corner points
const base = () => ({
  points: {
    1: { id: 1, x: 0, y: 0 },
    2: { id: 2, x: 100, y: 0 },
    3: { id: 3, x: 100, y: 100 },
    4: { id: 4, x: 0, y: 100 },
    10: { id: 10, x: 100, y: 50 },
    11: { id: 11, x: 0, y: 50 }
  },
  entities: {},
  constraints: {},
  layers: [{ id: 1, name: 'Layer 1', visible: true }],
  nextId: 900
});

console.log('\n== square: 2 lines + 2 converted splines, shared end points ==');
let fx = base();
fx.entities = {
  1: { id: 1, type: 'line', a: 1, b: 2, color: '#000000' },
  2: { id: 2, type: 'spline', pts: [2, 10, 3], color: '#000000' },
  3: { id: 3, type: 'line', a: 3, b: 4, color: '#000000' },
  4: { id: 4, type: 'spline', pts: [4, 11, 1], color: '#000000' }
};
let loops = run(fx);
console.log('  loops:', loops.length, loops.map(l => 'pts=' + (l.poly || []).length + ' area=' + Math.round(l.area)));
check('one loop', loops.length === 1, loops.length);
check('loop has all four edges', loops[0] && loops[0].steps && loops[0].steps.length === 4,
  loops[0] && loops[0].steps && loops[0].steps.length);
check('area is 100 x 100', loops[0] && Math.abs(loops[0].area - 10000) < 1, loops[0] && Math.round(loops[0].area));
check('polyline is sampled through the curves', loops[0] && loops[0].poly.length > 8, loops[0] && loops[0].poly.length);

console.log('\n== same square, but the spline ends are duplicate points (convert leftover) ==');
fx = base();
fx.points[21] = { id: 21, x: 100, y: 0 };
fx.points[22] = { id: 22, x: 100, y: 100 };
fx.points[23] = { id: 23, x: 0, y: 100 };
fx.points[24] = { id: 24, x: 0, y: 0 };
fx.entities = {
  1: { id: 1, type: 'line', a: 1, b: 2, color: '#000000' },
  2: { id: 2, type: 'spline', pts: [21, 10, 22], color: '#000000' },
  3: { id: 3, type: 'line', a: 3, b: 4, color: '#000000' },
  4: { id: 4, type: 'spline', pts: [23, 11, 24], color: '#000000' }
};
loops = run(fx);
console.log('  loops:', loops.length, loops.map(l => 'pts=' + (l.poly || []).length + ' area=' + Math.round(l.area)));
check('still one loop (endpoints merged by position)', loops.length === 1, loops.length);

console.log('\n== open spline that does not close stays out ==');
fx = base();
fx.entities = {
  1: { id: 1, type: 'line', a: 1, b: 2, color: '#000000' },
  2: { id: 2, type: 'spline', pts: [2, 10, 3], color: '#000000' },
  3: { id: 3, type: 'line', a: 3, b: 4, color: '#000000' }
};
loops = run(fx);
check('no loop for an open chain', loops.length === 0, loops.length);

console.log('\n== closed spline is still a standalone loop ==');
fx = base();
fx.entities = {
  9: { id: 9, type: 'spline', closed: true, pts: [1, 2, 3, 4], color: '#000000' }
};
loops = run(fx);
check('one closed spline loop', loops.length === 1 && loops[0].splineEntity === 9, loops.length);

console.log('\n== a hairline gap closes: the M case from modena.sketch ==');
fx = base();
fx.points[31] = { id: 31, x: 0, y: 0 };
fx.points[32] = { id: 32, x: 50, y: 60 };
fx.points[33] = { id: 33, x: 100, y: 0 };
fx.points[34] = { id: 34, x: 0.0015, y: 0.0012 };      // 1.9 micron from point 31
fx.entities = {
  7: { id: 7, type: 'spline', pts: [31, 32, 33, 34], color: '#000000' }
};
loops = run(fx);
check('a curve ending 2 micron from its start is a loop', loops.length === 1, loops.length);

console.log('\n== a real gap stays open ==');
fx = base();
fx.points[34] = { id: 34, x: 0.5, y: 0 };             // half a millimetre away
loops = run(fx);
check('a 0.5 mm gap is not a loop', loops.length === 0, loops.length);

console.log('\n== two lines 0.05 mm apart are welded, 0.3 mm apart are not ==');
fx = base();
fx.points[41] = { id: 41, x: 0, y: 200 };
fx.points[42] = { id: 42, x: 100, y: 200 };
fx.points[43] = { id: 43, x: 100, y: 300 };
fx.points[44] = { id: 44, x: 0, y: 300 };
fx.points[45] = { id: 45, x: 0.05, y: 300.02 };        // a second point 0.05 mm away
fx.entities = {
  1: { id: 1, type: 'line', a: 41, b: 42, color: '#000000' },
  2: { id: 2, type: 'line', a: 42, b: 43, color: '#000000' },
  3: { id: 3, type: 'line', a: 43, b: 44, color: '#000000' },
  4: { id: 4, type: 'line', a: 45, b: 41, color: '#000000' }
};
loops = run(fx);
check('a 0.05 mm gap between line ends closes', loops.length === 1, loops.length);
fx.points[45] = { id: 45, x: 0.3, y: 300 };
loops = run(fx);
check('a 0.3 mm gap between line ends stays open', loops.length === 0, loops.length);

console.log('\n== mixed colours: a green rectangle + a black arc on one edge ==');
fx = base();
fx.points[10] = { id: 10, x: 50, y: -20 };
fx.entities = {
  1: { id: 1, type: 'line', a: 1, b: 2, color: '#00ff00' },
  2: { id: 2, type: 'line', a: 2, b: 3, color: '#00ff00' },
  3: { id: 3, type: 'line', a: 3, b: 4, color: '#00ff00' },
  4: { id: 4, type: 'line', a: 4, b: 1, color: '#00ff00' },
  5: { id: 5, type: 'arc', c: 10, s: 1, e: 2, color: '#000000' }
};
loops = run(fx);
const colorsOf = (l) => (l.steps || []).map(s => fx.entities[s.edge.entity].color);
check('exactly one loop', loops.length === 1, loops.length);
check('it is the all-green rectangle, not the arc+line mix',
  loops.length === 1 && colorsOf(loops[0]).length === 4 &&
  colorsOf(loops[0]).every(c => c === '#00ff00'),
  loops.length && JSON.stringify(colorsOf(loops[0])));
check('the rectangle area is 100 x 100',
  loops[0] && Math.abs(loops[0].area - 10000) < 1, loops[0] && Math.round(loops[0].area));

console.log('\n== a mixed-colour cycle is still found when it is the only one ==');
fx = base();
fx.points[10] = { id: 10, x: 50, y: -20 };
fx.entities = {
  1: { id: 1, type: 'line', a: 1, b: 2, color: '#00ff00' },
  2: { id: 2, type: 'line', a: 2, b: 3, color: '#000000' },
  3: { id: 3, type: 'line', a: 3, b: 1, color: '#000000' }
};
loops = run(fx);
check('one triangle loop still forms',
  loops.length === 1 && colorsOf(loops[0]).length === 3, loops.length);

console.log('\n' + (fail ? (fail + ' FAILED, ' + pass + ' passed') : ('all ' + pass + ' checks passed')));
process.exit(fail ? 1 : 0);
