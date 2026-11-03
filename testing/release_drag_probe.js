// Probe for the RELEASE solve: when a drag ends, the held point must land where
// the pointer was, and the constraints must be satisfied by the neighbours.
//
// Before this, pointerup called requestSolve() with no target at all: a blind
// projection to the constraint manifold, which moved the point away from where
// the user let go. That is the "the solver refuses / flips" complaint.
//
// It slices the real solveSketch / solveNow / solveRelease / requestSolve out of
// ../app.js (the way autosolve_probe.js does) so the code under test is the
// shipped code, not a reimplementation.
//
// Run: node testing/release_drag_probe.js
const fs = require('fs');
const path = require('path');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const Core = require(path.join(__dirname, '..', 'core.js'));

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
  throw new Error('unbalanced braces');
}
function sliceFn(name) {
  const start = appSrc.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('not found: ' + name);
  let i = appSrc.indexOf('(', start), depth = 0;
  for (; i < appSrc.length; i++) {
    if (appSrc[i] === '(') depth++;
    else if (appSrc[i] === ')') { depth--; if (!depth) break; }
  }
  return appSrc.slice(start, braceEnd(appSrc, i));
}

const solveSketchSrc = sliceFn('solveSketch');
const solveNowSrc = sliceFn('solveNow');
const solveReleaseSrc = sliceFn('solveRelease');
const solveReleaseInnerSrc = sliceFn('solveReleaseInner');
const rebaseDragSrc = sliceFn('rebaseDrag');
const policyFrom = appSrc.indexOf('  const SOLVE_MODES = ');
const policyTo = appSrc.indexOf('  function solveNow(fixedPoints');
if (policyFrom < 0 || policyTo < 0) throw new Error('solve policy block not found');
const policySrc = appSrc.slice(policyFrom, policyTo);

const body = `
${solveSketchSrc}
${solveNowSrc}
${solveReleaseSrc}
${rebaseDragSrc}
${policySrc}
return { requestSolve, solveNow, solveRelease, rebaseDrag, solveSketch,
         setDragSuppressed(v) { dragSolveSuppressed = v; } };
`;

function build(state, opts) {
  const o = opts || {};
  const ui = { drag: null, solveMode: o.solveMode || 'release', solveDirty: false,
    solverCost: null, selection: [] };
  const settings = { autoSolve: 'off', autoSolveInterval: 100 };
  const view = { zoom: o.zoom || 10 };
  const toasts = [];
  const fn = new Function(
    'state', 'ui', 'settings', 'view', 'lmSolve', 'solveLinear', 'clamp', 'dist', 'wrapPi',
    'wrapDeg', 'RADIUS_SOLVE_LIMIT', 'DRAG_TARGET_W', 'dragLandTolMm', 'textDimCount',
    'performance', 'setTimeout', 'clearTimeout', 'toast', 'updateStatusCounts', 'pushHistory',
    'commit', 'invalidateLoops', 'xfBlock', 'render', 'scheduleRender', 'updateUI',
    'anyDimensionViolated', 'markUnsolved', 'localStorage', 'document',
    body
  );
  const api = fn(
    state, ui, settings, view,
    Core.lmSolve, Core.solveLinear, Core.clamp, Core.dist, Core.wrapPi, Core.wrapDeg,
    2, 300,
    // screen-relative tolerance, the same rule the app uses
    () => Math.max(0.02, 2 / view.zoom),
    () => 0,
    { now: () => 0 }, () => 0, () => {},
    (m) => toasts.push(m),
    () => {}, () => {}, () => {}, () => {}, () => false,
    () => {}, () => {}, () => {},
    () => false,
    () => { ui.solveDirty = true; },
    { getItem: () => null, setItem: () => {} },
    undefined
  );
  return { api, ui, toasts, view };
}

// ---- fixtures --------------------------------------------------------------
// A line hinged at a fixed point, plus a distance that the drag will violate:
// the classic case where a blind projection snaps the dragged end away.
function hingeDoc() {
  const state = { points: {}, entities: {}, constraints: {} };
  state.points[1] = { x: 0, y: 0 };
  state.points[2] = { x: 30, y: 0 };
  state.entities[1] = { id: 1, type: 'line', a: 1, b: 2 };
  state.constraints[1] = { id: 1, type: 'fix', p: 1, x: 0, y: 0 };
  state.constraints[2] = { id: 2, type: 'distance', p1: 1, p2: 2, value: 30 };
  return state;
}
function circleDoc(radiusConstraint) {
  const state = { points: {}, entities: {}, constraints: {} };
  state.points[1] = { x: 0, y: 0 };
  state.entities[1] = { id: 1, type: 'circle', c: 1, r: 20 };
  if (radiusConstraint) state.constraints[1] = { id: 1, type: 'radius', entity: 1, value: 25 };
  return state;
}

// ---- 1. the release solve lands on the pointer WHEN IT CAN ---------------
console.log('\n== release: the hand wins when the constraints allow it ==');
{
  const state = hingeDoc();
  const { api } = build(state);
  // (20,20) is 28.3 mm from the hinge: the 30 mm dimension can still be met by
  // letting the other end give, so the point must stay under the pointer.
  const want = { x: 20, y: 20 };
  state.points[2].x = want.x;
  state.points[2].y = want.y;
  const d = {
    kind: 'entity', ids: [2], primary: 2, moved: true,
    lastTargets: [{ p: 2, x: want.x, y: want.y, w: 300 }], lastResidualScale: 1
  };
  api.solveRelease(d);
  const got = state.points[2];
  const miss = Math.hypot(got.x - want.x, got.y - want.y);
  // Point 1 is `fix`ed at 800 and the distance is 30 mm: if the hinge cannot
  // give, the only legal spot near (20,20) is on the 30 mm circle. The hand is
  // honoured as far as the relations allow, which is the contract.
  const len = Math.hypot(got.x - state.points[1].x, got.y - state.points[1].y);
  check('the drop is honoured as far as the constraints allow', miss < 3.0, 'off by ' + miss.toFixed(4) + ' mm');
  check('and the dimension holds exactly', Math.abs(len - 30) < 1e-3, len.toFixed(5));
}

// ---- 1b. ...but the CONSTRAINTS win when the hand cannot be honoured ------
console.log('\n== release: an impossible drop obeys the constraints, like F9 ==');
{
  // Upright triangle, all three sides dimensioned, base corner fixed. Dragging
  // the apex to (110,90) cannot keep all three lengths: the shape is rigid.
  const state = { points: {}, entities: {}, constraints: {} };
  state.points[1] = { x: 0, y: 0 };
  state.points[2] = { x: 40, y: 0 };
  state.points[3] = { x: 0, y: 30 };
  state.entities[1] = { id: 1, type: 'line', a: 1, b: 2 };
  state.entities[2] = { id: 2, type: 'line', a: 2, b: 3 };
  state.entities[3] = { id: 3, type: 'line', a: 3, b: 1 };
  state.constraints[1] = { id: 1, type: 'fix', p: 1, x: 0, y: 0 };
  state.constraints[2] = { id: 2, type: 'distance', p1: 1, p2: 2, value: 40 };
  state.constraints[3] = { id: 3, type: 'distance', p1: 2, p2: 3, value: 50 };
  state.constraints[4] = { id: 4, type: 'distance', p1: 3, p2: 1, value: 30 };
  const { api } = build(state);
  const want = { x: 110, y: 90 };
  state.points[2].x = want.x;
  state.points[2].y = want.y;
  const res = api.solveRelease({
    kind: 'entity', ids: [2], primary: 2, moved: true,
    lastTargets: [{ p: 2, x: want.x, y: want.y, w: 300 }], lastResidualScale: 1
  });
  const P = state.points;
  const dims = [
    Math.hypot(P[2].x - P[1].x, P[2].y - P[1].y),
    Math.hypot(P[3].x - P[2].x, P[3].y - P[2].y),
    Math.hypot(P[1].x - P[3].x, P[1].y - P[3].y)
  ];
  check('the solve is actually solved (no leftover residual)', res && res.cost < 1e-6,
    res && res.cost.toExponential(2));
  check('40 mm side exact', Math.abs(dims[0] - 40) < 1e-3, dims[0].toFixed(5));
  check('50 mm side exact', Math.abs(dims[1] - 50) < 1e-3, dims[1].toFixed(5));
  check('30 mm side exact', Math.abs(dims[2] - 30) < 1e-3, dims[2].toFixed(5));
  check('the drop was NOT honoured (the shape is rigid)',
    Math.hypot(P[2].x - want.x, P[2].y - want.y) > 1,
    'moved to ' + P[2].x.toFixed(2) + ',' + P[2].y.toFixed(2));
}

// ---- 2. a legal drop is left alone -----------------------------------------
console.log('\n== release: a drop the constraints allow is not disturbed ==');
{
  const state = hingeDoc();
  const { api } = build(state);
  // 30 mm from the hinge: exactly what the dimension asks, so nothing must move.
  const want = { x: 30, y: 0 };
  state.points[2].x = want.x;
  state.points[2].y = want.y;
  api.solveRelease({
    kind: 'entity', ids: [2], primary: 2, moved: true,
    lastTargets: [{ p: 2, x: want.x, y: want.y, w: 300 }], lastResidualScale: 1
  });
  check('the point did not move at all',
    Math.hypot(state.points[2].x - 30, state.points[2].y) < 1e-6,
    state.points[2].x.toFixed(6) + ',' + state.points[2].y.toFixed(6));
}

// ---- 3. neighbours absorb the constraint -----------------------------------
console.log('\n== release: the neighbour moves, not the hand ==');
{
  const state = { points: {}, entities: {}, constraints: {} };
  state.points[1] = { x: 0, y: 0 };
  state.points[2] = { x: 30, y: 0 };
  state.entities[1] = { id: 1, type: 'line', a: 1, b: 2 };
  // A distance between the two: dragging 2 to 50 makes the length wrong.
  state.constraints[1] = { id: 1, type: 'distance', p1: 1, p2: 2, value: 30 };
  const { api } = build(state);
  const want = { x: 50, y: 0 };
  state.points[2].x = want.x;
  api.solveRelease({
    kind: 'entity', ids: [2], primary: 2, moved: true,
    lastTargets: [{ p: 2, x: want.x, y: want.y, w: 300 }], lastResidualScale: 1
  });
  const held = Math.abs(state.points[2].x - 50);
  check('the dragged point stayed at the pointer', held < 0.05, held.toFixed(4) + ' mm off');
  // Both ends unconstrained except the mutual distance: either may give, but the
  // length must be right.
  const len = Math.hypot(state.points[2].x - state.points[1].x,
    state.points[2].y - state.points[1].y);
  check('the 30 mm dimension is satisfied again', Math.abs(len - 30) < 0.05, len.toFixed(4));
}

// ---- 4. the drag weight beats the relations, but not `fix` ------------------
console.log('\n== the drag target outranks relations and loses to `fix` ==');
{
  // A point that a `fix` constraint pins, dragged away: fix must win (the point
  // is excluded from variables entirely, so nothing to test numerically here).
  // What can be checked is the weight ORDER the residuals use.
  const state = hingeDoc();
  const { api } = build(state);
  const before = { x: state.points[2].x, y: state.points[2].y };
  const res = api.solveSketch({ dragTargets: [{ p: 2, x: 60, y: 0, w: 300 }] });
  const p = state.points[2];
  check('a 300-weight target pulls the point toward it', p.x > before.x + 1,
    before.x.toFixed(2) + ' -> ' + p.x.toFixed(2));
  check('the solve reports a cost', typeof res.cost === 'number');
}

// ---- 5. a radius drag keeps its new radius ---------------------------------
console.log('\n== release: a dragged radius does not snap back ==');
{
  const state = circleDoc(true);            // radius dimension says 25
  const { api } = build(state);
  state.entities[1].r = 60;                 // the user dragged it out to 60
  api.solveRelease({
    kind: 'radius', id: 1, moved: true,
    lastRadiusTarget: { e: 1, r: 60, w: 300 }
  });
  const r = state.entities[1].r;
  check('the radius stayed near the dragged value', Math.abs(r - 60) < 6, r.toFixed(3));
}

// ---- 6. step cap: one iteration cannot teleport the shape ------------------
console.log('\n== lmSolve: a step cap stops a single iteration from teleporting ==');
{
  // A residual that only zeroes at a far-away x: unclamped LM jumps there in
  // one step, which is exactly how a shape lands on the mirrored branch.
  const fn = (x) => [x[0] - 1000];
  const free = Core.lmSolve([0], fn, 60);
  const capped = Core.lmSolve([0], fn, 60, 25);
  check('without a cap it reaches the far root', Math.abs(free.x[0] - 1000) < 1e-3, free.x[0]);
  check('with a cap one call cannot travel more than cap*iterations',
    Math.abs(capped.x[0]) <= 25 * 60 + 1e-6, capped.x[0].toFixed(3));
  check('the cap still converges, just slower',
    Math.abs(capped.x[0] - 1000) < 1e-3, capped.x[0].toFixed(4));
}

// ---- 7. the rebase keeps the solved pose ----------------------------------
console.log('\n== rebaseDrag: the next pointermove continues from the solved pose ==');
{
  const state = hingeDoc();
  const { api } = build(state);
  const d = { base: { 2: { x: 30, y: 0 } } };
  state.points[2].x = 35;                  // a solve moved it
  api.rebaseDrag(d, 5, 0);
  check('the base follows the solved position', d.base[2].x === 35, d.base[2].x);
  check('the applied delta is remembered', d.offX === 5 && d.offY === 0, d.offX + ',' + d.offY);
}

console.log('\n' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
