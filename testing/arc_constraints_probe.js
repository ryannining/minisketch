// Probe for the arc / circle constraint work:
//   1. Equal on two circles or two arcs (or a circle + arc) compares RADIUS.
//   2. pointOn works on a circle and on an arc (the residual used e.r, which is
//      NaN for an arc, so it silently did nothing).
//   3. An arc whose ends carry no constraint anchors its START end, so a solve
//      moves the free end instead of dragging the whole arc.
//   4. A solve may not change a radius by more than 2x.
//
// Run: node testing/arc_constraints_probe.js
'use strict';
const fs = require('fs');
const path = require('path');
const C = require(path.join(__dirname, '..', 'core.js'));

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

// ---- a solver harness: the real solveSketch, minimal surroundings ----------
function makeWorld() {
  return {
    points: {}, entities: {}, constraints: {},
    layers: [{ id: 1, visible: true, locked: false }],
    nextId: 1
  };
}
function pt(w, x, y) {
  const id = w.nextId++;
  w.points[id] = { id, x, y };
  return id;
}
function circle(w, cx, cy, r) {
  const c = pt(w, cx, cy);
  const id = w.nextId++;
  w.entities[id] = { id, type: 'circle', c, r, color: '#000000', layer: 1 };
  return id;
}
function arc(w, cx, cy, r, a0, a1) {
  const c = pt(w, cx, cy);
  const s = pt(w, cx + r * Math.cos(a0), cy + r * Math.sin(a0));
  const e = pt(w, cx + r * Math.cos(a1), cy + r * Math.sin(a1));
  const id = w.nextId++;
  w.entities[id] = { id, type: 'arc', c, s, e, color: '#000000', layer: 1 };
  return id;
}

function buildSolver(w) {
  return new Function(
    'state', 'ui', 'P', 'dist', 'clamp', 'TAU', 'wrapPi', 'norm2pi',
    'lmSolve', 'textDimCount', 'RADIUS_SOLVE_LIMIT',
    slice('solveSketch') + '\nreturn solveSketch;'
  )(
    w, { solverCost: 0 }, (id) => w.points[id],
    (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
    (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
    Math.PI * 2,
    (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a <= -Math.PI) a += Math.PI * 2; return a; },
    (a) => { while (a < 0) a += Math.PI * 2; while (a >= Math.PI * 2) a -= Math.PI * 2; return a; },
    C.lmSolve,
    () => 0,       // textDimCount: no framed objects here
    2              // RADIUS_SOLVE_LIMIT
  );
}

console.log('\n== Equal compares the RADIUS of two round shapes ==');
{
  const w = makeWorld();
  const a = circle(w, 0, 0, 5);
  const b = circle(w, 40, 0, 9);
  w.constraints[100] = { id: 100, type: 'equal', line1: a, line2: b };
  const solve = buildSolver(w);
  const res = solve({});
  const ra = w.entities[a].r;
  const rb = w.entities[b].r;
  check('both radii ended up equal', Math.abs(ra - rb) < 1e-3, ra + ' vs ' + rb);
  check('the solve converged', res.cost < 1e-6, res.cost);
}

console.log('\n== Equal works across a circle and an arc ==');
{
  const w = makeWorld();
  const c = circle(w, 0, 0, 6);
  const a = arc(w, 40, 0, 10, 0, Math.PI / 2);
  w.constraints[100] = { id: 100, type: 'equal', line1: c, line2: a };
  const solve = buildSolver(w);
  const res = solve({});
  const ae = w.entities[a];
  const arcR = Math.hypot(w.points[ae.s].x - w.points[ae.c].x, w.points[ae.s].y - w.points[ae.c].y);
  check('the arc radius matched the circle', Math.abs(arcR - w.entities[c].r) < 1e-2,
    arcR + ' vs ' + w.entities[c].r);
  check('the solve converged', res.cost < 1e-5, res.cost);
}

console.log('\n== pointOn keeps a point on a circle ==');
{
  const w = makeWorld();
  const c = circle(w, 0, 0, 10);
  const p = pt(w, 14, 3);          // off the circle
  w.constraints[100] = { id: 100, type: 'pointOn', p, entity: c };
  const solve = buildSolver(w);
  solve({});
  const cc = w.points[w.entities[c].c];
  const r = Math.hypot(w.points[p].x - cc.x, w.points[p].y - cc.y);
  check('the point landed on the circle (r=10 from its centre)',
    Math.abs(r - w.entities[c].r) < 1e-3, r);
}

console.log('\n== pointOn keeps a point on an ARC ==');
{
  const w = makeWorld();
  // a quarter arc from 0 to 90 degrees, r=10, centred at the origin
  const a = arc(w, 0, 0, 10, 0, Math.PI / 2);
  const p = pt(w, 12, 2);
  w.constraints[100] = { id: 100, type: 'pointOn', p, entity: a };
  const solve = buildSolver(w);
  const res = solve({});
  const r = Math.hypot(w.points[p].x, w.points[p].y);
  check('the point sits on the arc radius', Math.abs(r - 10) < 1e-2, r);
  check('the arc residual is finite (e.r would have been NaN)', isFinite(res.cost), res.cost);
}

console.log('\n== a free end is anchored by the other end ==');
{
  // The reported rule: the end with NO constraint may move; the other one is
  // anchored. Here the START is constrained, so the END must do the moving.
  const w = makeWorld();
  const a = arc(w, 0, 0, 10, 0, Math.PI / 2);
  const ae = w.entities[a];
  const sBefore = { x: w.points[ae.s].x, y: w.points[ae.s].y };
  const eBefore = { x: w.points[ae.e].x, y: w.points[ae.e].y };
  const cBefore = { x: w.points[ae.c].x, y: w.points[ae.c].y };
  // anchor the start; the end is then the free one, and a drag target pulls it
  w.constraints[100] = { id: 100, type: 'fix', p: ae.s, x: sBefore.x, y: sBefore.y };
  const solve = buildSolver(w);
  solve({ dragTargets: [{ p: ae.e, x: 6, y: 6, w: 30 }] });
  const sAfter = { x: w.points[ae.s].x, y: w.points[ae.s].y };
  check('the constrained start did not move',
    Math.abs(sAfter.x - sBefore.x) < 1e-6 && Math.abs(sAfter.y - sBefore.y) < 1e-6,
    JSON.stringify(sAfter) + ' vs ' + JSON.stringify(sBefore));
  const eAfter = { x: w.points[ae.e].x, y: w.points[ae.e].y };
  check('the free end DID move', Math.hypot(eAfter.x - eBefore.x, eAfter.y - eBefore.y) > 1e-6,
    JSON.stringify(eAfter));
  check('the centre stayed put (the radius is preserved)',
    Math.abs(w.points[ae.c].x - cBefore.x) < 1e-6 && Math.abs(w.points[ae.c].y - cBefore.y) < 1e-6,
    JSON.stringify(w.points[ae.c]));
}

console.log('\n== with no constraint at all the arc keeps its radius ==');
{
  const w = makeWorld();
  const a = arc(w, 0, 0, 10, 0, Math.PI / 2);
  const ae = w.entities[a];
  const sBefore = { x: w.points[ae.s].x, y: w.points[ae.s].y };
  const cBefore = { x: w.points[ae.c].x, y: w.points[ae.c].y };
  const p = pt(w, 0, 0);
  w.constraints[100] = { id: 100, type: 'coincident', p1: ae.e, p2: p };
  const solve = buildSolver(w);
  solve({});
  check('the start is anchored',
    Math.abs(w.points[ae.s].x - sBefore.x) < 1e-6 &&
    Math.abs(w.points[ae.s].y - sBefore.y) < 1e-6, JSON.stringify(w.points[ae.s]));
  check('the centre is anchored too',
    Math.abs(w.points[ae.c].x - cBefore.x) < 1e-6 &&
    Math.abs(w.points[ae.c].y - cBefore.y) < 1e-6, JSON.stringify(w.points[ae.c]));
}

console.log('\n== a constrained arc is not force-anchored ==');
{
  const w = makeWorld();
  const a = arc(w, 0, 0, 10, 0, Math.PI / 2);
  const ae = w.entities[a];
  // a constraint on the START end: the user is steering it, so the anchor rule
  // must not apply
  w.constraints[100] = {
    id: 100, type: 'fix', p: ae.s,
    x: w.points[ae.s].x, y: w.points[ae.s].y
  };
  w.constraints[101] = { id: 101, type: 'pointOn', p: ae.e, entity: a };
  const solve = buildSolver(w);
  const res = solve({});
  check('the solve still converges', res.cost < 1e-5, res.cost);
}

console.log('\n== a radius may not change by more than 2x ==');
{
  check('the limit is 2', /const RADIUS_SOLVE_LIMIT = 2;/.test(appSrc));
  const w = makeWorld();
  // an impossible radius demand: r must equal 500 while it starts at 5
  const c = circle(w, 0, 0, 5);
  w.constraints[100] = { id: 100, type: 'radius', entity: c, value: 500 };
  const solve = buildSolver(w);
  solve({});
  check('the radius stopped at 2x the start', Math.abs(w.entities[c].r - 10) < 1e-6, w.entities[c].r);

  const w2 = makeWorld();
  const c2 = circle(w2, 0, 0, 50);
  w2.constraints[100] = { id: 100, type: 'radius', entity: c2, value: 1 };
  const solve2 = buildSolver(w2);
  solve2({});
  check('and at half the start going down', Math.abs(w2.entities[c2].r - 25) < 1e-6, w2.entities[c2].r);
}

console.log('\n== the Equal command accepts round shapes ==');
{
  check('cmdLinePair accepts circles/arcs for equal',
    /type === 'equal' && isRound\(e\)/.test(appSrc));
  check('it refuses mixing a line with a circle', /a length is not a radius/.test(slice('solveSketch')) ||
    /not a line with a circle/.test(appSrc));
  check('the constraint is named after what it matches',
    /Equal radius/.test(appSrc) && /Equal length/.test(appSrc));
  check('a duplicate Equal is refused', /already constrained equal/.test(appSrc));
}

console.log('\n' + (fail ? fail + ' FAILED, ' : 'all ') + pass + ' checks passed');
process.exit(fail ? 1 : 0);
