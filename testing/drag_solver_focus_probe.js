// Probe for focused solver behavior and eliminating unnecessary "Constraints unsolved"
// floating panel popups during normal or rigid object drags.
//
// Run: node testing/drag_solver_focus_probe.js
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
const residualSrc = sliceFn('constraintResidualSq');
const anyConSrc = sliceFn('anyConstraintViolated');
const dragHasSrc = sliceFn('dragHasConstraintViolation');
const ctxBarSrc = sliceFn('updateContextBar');
const policyFrom = appSrc.indexOf('  const SOLVE_MODES = ');
const policyTo = appSrc.indexOf('  function solveNow(fixedPoints');
const policySrc = appSrc.slice(policyFrom, policyTo);

const body = `
${solveSketchSrc}
${solveNowSrc}
${solveReleaseSrc}
${residualSrc}
${anyConSrc}
${dragHasSrc}
${ctxBarSrc}
${policySrc}
return {
  solveSketch, solveNow, requestSolve, solveRelease, markUnsolved,
  constraintResidualSq, anyConstraintViolated, dragHasConstraintViolation,
  updateContextBar,
  setDragSuppressed(v) { dragSolveSuppressed = v; }
};
`;

function makeCtxBarDom() {
  const classes = new Set(['hidden']);
  const bar = {
    __sig: 'none',
    innerHTML: '',
    children: [],
    classList: {
      add(c) { classes.add(c); },
      remove(c) { classes.delete(c); },
      contains(c) { return classes.has(c); }
    },
    appendChild(el) { this.children.push(el); }
  };
  const doc = {
    activeElement: null,
    getElementById(id) { return id === 'ctx-bar' ? bar : null; },
    createElement(tag) {
      return { tagName: tag.toUpperCase(), className: '', textContent: '', addEventListener() {} };
    }
  };
  return { bar, doc };
}

function build(state, opts) {
  const o = opts || {};
  const { bar, doc } = makeCtxBarDom();
  const ui = {
    drag: null, solveMode: o.solveMode || 'release', solveDirty: false,
    solverCost: null, selection: [], tool: 'select',
    offsetJob: null, draft: null, moveJob: null
  };
  const settings = { autoSolve: 'off', autoSolveInterval: 100 };
  let lmCalls = 0;
  const wrappedLmSolve = (...args) => { lmCalls++; return Core.lmSolve(...args); };
  const fn = new Function(
    'state', 'ui', 'settings', 'document', 'mateJob', 'OFFSET_JOIN', 'WALL_DRAG_MM', 'fmt',
    'lmSolve', 'solveLinear', 'clamp', 'dist', 'wrapPi', 'wrapDeg', 'angleRays',
    'RADIUS_SOLVE_LIMIT', 'DRAG_TARGET_W', 'dragLandTolMm', 'textDimCount',
    'performance', 'setTimeout', 'clearTimeout', 'toast', 'updateStatusCounts', 'pushHistory',
    'commit', 'invalidateLoops', 'xfBlock', 'render', 'scheduleRender', 'updateUI',
    'anyDimensionViolated', 'localStorage',
    body
  );
  const api = fn(
    state, ui, settings, doc, null, 'sharp', 2, (v) => String(v),
    wrappedLmSolve, Core.solveLinear, Core.clamp, Core.dist, Core.wrapPi, Core.wrapDeg,
    () => null,
    2, 300, () => 0.2, () => 0,
    { now: () => 0 }, () => 0, () => {},
    () => {}, () => { api && api.updateContextBar && api.updateContextBar(); },
    () => {}, () => {}, () => {}, () => false,
    () => {}, () => {}, () => {},
    () => false,
    { getItem: () => null, setItem: () => {} }
  );
  return { api, ui, bar, getLmCalls: () => lmCalls, resetLmCalls: () => { lmCalls = 0; } };
}

function boxWithConstrainedAndFree() {
  const state = { points: {}, entities: {}, constraints: {} };
  // Constrained box 1 (points 1..4, entities 1..4)
  state.points[1] = { x: 0, y: 0 };
  state.points[2] = { x: 50, y: 0 };
  state.points[3] = { x: 50, y: 30 };
  state.points[4] = { x: 0, y: 30 };
  state.entities[1] = { id: 1, type: 'line', a: 1, b: 2 };
  state.entities[2] = { id: 2, type: 'line', a: 2, b: 3 };
  state.entities[3] = { id: 3, type: 'line', a: 3, b: 4 };
  state.entities[4] = { id: 4, type: 'line', a: 4, b: 1 };
  state.constraints[1] = { id: 1, type: 'horizontal', entity: 1 };
  state.constraints[2] = { id: 2, type: 'horizontal', entity: 3 };
  state.constraints[3] = { id: 3, type: 'vertical', entity: 2 };
  state.constraints[4] = { id: 4, type: 'vertical', entity: 4 };
  state.constraints[5] = { id: 5, type: 'distance', p1: 1, p2: 2, value: 50 };
  // Free square (points 10..13, entities 10..13) — NO constraints
  state.points[10] = { x: 100, y: 0 };
  state.points[11] = { x: 140, y: 0 };
  state.points[12] = { x: 140, y: 40 };
  state.points[13] = { x: 100, y: 40 };
  state.entities[10] = { id: 10, type: 'line', a: 10, b: 11 };
  state.entities[11] = { id: 11, type: 'line', a: 11, b: 12 };
  state.entities[12] = { id: 12, type: 'line', a: 12, b: 13 };
  state.entities[13] = { id: 13, type: 'line', a: 13, b: 10 };
  // Free rounded corner arc (points 20, 21, 22, entity 20)
  state.points[20] = { x: 200, y: 0 };
  state.points[21] = { x: 210, y: 0 };
  state.points[22] = { x: 200, y: 10 };
  state.entities[20] = { id: 20, type: 'arc', c: 20, s: 21, e: 22 };
  return state;
}

console.log('\n== 1. Dragging free normal object never triggers solveDirty or floating panel ==');
{
  const state = boxWithConstrainedAndFree();
  const h = build(state, { solveMode: 'release' });
  h.ui.drag = { kind: 'entity', ids: [10, 11, 12, 13], moved: true };
  h.api.setDragSuppressed(true);
  // Translate free square by (+25, +15)
  for (const id of [10, 11, 12, 13]) { state.points[id].x += 25; state.points[id].y += 15; }
  const res = h.api.requestSolve({ dragPoints: [10, 11, 12, 13], dragTargets: [{ p: 10, x: 125, y: 15 }] });
  h.api.updateContextBar();
  check('requestSolve skips normal drag without flagging solveDirty', h.ui.solveDirty === false && res && res.skipped === true);
  check('ctx-bar stays hidden during free object drag', h.bar.classList.contains('hidden') && h.bar.__sig === 'none');
  h.api.setDragSuppressed(false);
  h.ui.drag = null;
  h.api.solveRelease({ kind: 'entity', ids: [10, 11, 12, 13], primary: 10, moved: true, lastTargets: [{ p: 10, x: 125, y: 15, w: 300 }] });
  h.api.updateContextBar();
  check('solveRelease leaves solveDirty false, 0 LM calls, and ctx-bar hidden',
    h.ui.solveDirty === false && h.getLmCalls() === 0 && h.bar.classList.contains('hidden'));
}

console.log('\n== 2. Rigidly dragging a whole constrained box or free rounded arc stays silent & O(0) LM ==');
{
  const state = boxWithConstrainedAndFree();
  const h = build(state, { solveMode: 'release' });
  h.ui.drag = { kind: 'entity', ids: [1, 2, 3, 4, 20, 21, 22], moved: true };
  h.api.setDragSuppressed(true);
  for (const id of [1, 2, 3, 4, 20, 21, 22]) { state.points[id].x += 30; state.points[id].y += 20; }
  const res = h.api.requestSolve({ dragPoints: [1, 2, 3, 4, 20, 21, 22], dragTargets: [{ p: 1, x: 30, y: 20 }] });
  h.api.updateContextBar();
  check('rigid drag of whole constrained box + rounded arc does not mark unsolved',
    h.ui.solveDirty === false && res && res.skipped === true);
  check('ctx-bar stays hidden during rigid box drag', h.bar.classList.contains('hidden'));
  h.api.setDragSuppressed(false);
  h.ui.drag = null;
  const rel = h.api.solveRelease({
    kind: 'entity', ids: [1, 2, 3, 4, 20, 21, 22], primary: 1, moved: true,
    lastTargets: [{ p: 1, x: 30, y: 20, w: 300 }]
  });
  check('release of already-satisfied rigid box exits early without LM iterations',
    rel && rel.ok && rel.iterations === 0 && h.getLmCalls() === 0 && h.ui.solveDirty === false);
}

console.log('\n== 3. Stretching constrained corner hides #ctx-bar while dragging in release mode & isolates component ==');
{
  const state = boxWithConstrainedAndFree();
  // Add an unrelated BROKEN impossible component (points 30,31; distance 50 fixed at dist 10)
  state.points[30] = { x: 0, y: 200 };
  state.points[31] = { x: 10, y: 200 };
  state.entities[30] = { id: 30, type: 'line', a: 30, b: 31 };
  state.constraints[30] = { id: 30, type: 'fix', p: 30, x: 0, y: 200 };
  state.constraints[31] = { id: 31, type: 'fix', p: 31, x: 10, y: 200 };
  state.constraints[32] = { id: 32, type: 'distance', p1: 30, p2: 31, value: 50 };

  const h = build(state, { solveMode: 'release' });
  h.ui.drag = { kind: 'entity', ids: [2], moved: true };
  h.api.setDragSuppressed(true);
  state.points[2].x = 70;
  state.points[2].y = 12; // violates horizontal(1), vertical(2), distance(5)
  h.api.requestSolve({ dragPoints: [2], dragTargets: [{ p: 2, x: 70, y: 12 }] });
  h.api.updateContextBar();
  check('status flags solveDirty during genuinely violated constrained drag', h.ui.solveDirty === true);
  check('ctx-bar does NOT float over canvas while actively dragging', h.bar.classList.contains('hidden'));

  h.api.setDragSuppressed(false);
  h.ui.drag = null;
  const rel = h.api.solveRelease({
    kind: 'entity', ids: [2], primary: 2, moved: true,
    lastTargets: [{ p: 2, x: 70, y: 12, w: 300 }]
  });
  h.api.updateContextBar();
  check('component-scoped release solves box corner cleanly despite unrelated broken component',
    rel && rel.ok && h.ui.solveDirty === false &&
    Math.abs(state.points[2].y - state.points[1].y) < 1e-4 &&
    Math.abs(Math.hypot(state.points[2].x - state.points[1].x, state.points[2].y - state.points[1].y) - 50) < 1e-4);
  check('ctx-bar stays hidden after release succeeds', h.bar.classList.contains('hidden'));
}

console.log('\n== 4. Manual mode: silent on normal drag, shows ctx-bar AFTER release only if constrained drag violated ==');
{
  const state = boxWithConstrainedAndFree();
  const h = build(state, { solveMode: 'manual' });
  h.ui.drag = { kind: 'entity', ids: [10, 11, 12, 13], moved: true };
  for (const id of [10, 11, 12, 13]) { state.points[id].x += 10; }
  h.api.requestSolve({ dragPoints: [10, 11, 12, 13] });
  h.ui.drag = null;
  h.api.updateContextBar();
  check('manual mode stays silent when dragging normal object', h.ui.solveDirty === false && h.bar.classList.contains('hidden'));

  h.ui.drag = { kind: 'entity', ids: [2], moved: true };
  state.points[2].y += 10;
  h.api.requestSolve({ dragPoints: [2] });
  h.api.updateContextBar();
  check('manual mode hides ctx-bar while still holding mouse down', h.ui.solveDirty === true && h.bar.classList.contains('hidden'));
  h.ui.drag = null;
  h.api.updateContextBar();
  check('manual mode reveals Solve (F9) ctx-bar only after mouse release',
    !h.bar.classList.contains('hidden') && h.bar.__sig === 'solve-dirty');
}

console.log('\n' + (fail ? (fail + ' FAILED, ' + pass + ' passed') : ('all ' + pass + ' checks passed')));
process.exit(fail ? 1 : 0);
