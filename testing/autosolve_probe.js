// Probe for the drag solve gate: "does this drag change anything the solver
// could see?" and the Auto solve timer that depends on it.
//
// It slices solveSketch, solveNow and the solve-policy / auto-solve block out
// of ../app.js (the same way solve_policy_probe.js does) and drives them with
// fake timers, so nothing here needs a browser.
//
// Run: node testing/autosolve_probe.js
const fs = require('fs');
const path = require('path');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const Core = require(path.join(__dirname, '..', 'core.js'));

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

// ---- slicing helpers -------------------------------------------------------
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

// solveSketch: renamed so the harness can wrap it and count every call.
const solveSketchSrc = sliceFn('solveSketch').replace('function solveSketch(', 'function realSolveSketch(');
const solveNowSrc = sliceFn('solveNow');
// policy + auto solve: from SOLVE_MODES up to solveNow (see solve_policy_probe)
const policyFrom = appSrc.indexOf('  const SOLVE_MODES = ');
const policyTo = appSrc.indexOf('  function solveNow(fixedPoints');
if (policyFrom < 0 || policyTo < 0 || policyTo < policyFrom) throw new Error('solve policy block not found');
const policySrc = appSrc.slice(policyFrom, policyTo);

const body = `
${solveSketchSrc}
${solveNowSrc}
${policySrc}
return {
  requestSolve, scheduleDragAutoSolve, cancelDragAutoSolve, markUnsolved, realSolveSketch,
  resetSolved() { dragSolveLastTime = 0; dragSolveTimer = 0; dragSolveSuppressed = false; }
};
`;

// ---- harness ---------------------------------------------------------------
function build(state, opts) {
  const o = opts || {};
  const calls = { solve: 0, status: 0, updateUI: 0, render: 0, loops: 0, toast: [], last: null };
  const ui = {
    drag: null, solveMode: o.solveMode || 'release', solveDirty: false,
    solverCost: null, selection: []
  };
  const settings = { autoSolve: o.autoSolve || 'on', autoSolveInterval: o.interval || 100 };

  // solveNow inside the body calls this, so every solve is counted and its
  // result (skipped or not) is observable. The real solveSketch is only known
  // once the body has been constructed, hence the mutable target.
  let real = null;
  const solveSketch = (so) => { calls.solve++; calls.last = real(so); return calls.last; };

  // fake clock + timers: the scheduler is driven by hand, never by real time
  const clock = { now: 0, timers: [], seq: 0 };
  const fakeSetTimeout = (fn, ms) => { clock.timers.push({ id: ++clock.seq, fn, at: clock.now + ms }); return clock.seq; };
  const fakeClearTimeout = (id) => { clock.timers = clock.timers.filter(t => t.id !== id); };
  const fireDue = () => {
    const due = clock.timers.filter(t => t.at <= clock.now);
    clock.timers = clock.timers.filter(t => t.at > clock.now);
    due.forEach(t => t.fn());
    return due.length;
  };

  const fn = new Function(
    'state', 'ui', 'settings', 'lmSolve', 'solveLinear', 'clamp', 'dist', 'wrapPi', 'wrapDeg',
    'RADIUS_SOLVE_LIMIT', 'textDimCount', 'performance', 'setTimeout', 'clearTimeout',
    'toast', 'updateStatusCounts', 'pushHistory', 'commit', 'invalidateLoops', 'xfBlock',
    'render', 'scheduleRender', 'updateUI', 'solveSketch', 'anyDimensionViolated', 'localStorage',
    body
  );
  const api = fn(
    state, ui, settings,
    Core.lmSolve, Core.solveLinear, Core.clamp, Core.dist, Core.wrapPi, Core.wrapDeg,
    2, () => 0,
    { now: () => clock.now }, fakeSetTimeout, fakeClearTimeout,
    (m) => calls.toast.push(m),
    () => { calls.status++; },
    () => {},
    () => {},
    () => { calls.loops++; },
    () => false,
    () => { calls.render++; },       // render (cycleSolveMode)
    () => { calls.render++; },       // scheduleRender (auto solve slot)
    () => { calls.updateUI++; },
    solveSketch,                     // solveNow resolves the wrapper
    () => false,
    { getItem: () => null, setItem: () => {} }
  );
  real = api.realSolveSketch;
  return { api, ui, settings, calls, clock, fireDue };
}

// ---- fixtures --------------------------------------------------------------
// A constrained sketch: a horizontal line pinned at one end, plus a distance
// that is currently VIOLATED (so the document really has work to do).
function constrainedDoc() {
  const state = { points: {}, entities: {}, constraints: {} };
  state.points[1] = { x: 0, y: 0 };
  state.points[2] = { x: 10, y: 3 };            // violates horizontal
  state.entities[1] = { id: 1, type: 'line', a: 1, b: 2 };
  state.constraints[1] = { id: 1, type: 'horizontal', entity: 1 };
  state.constraints[2] = { id: 2, type: 'fix', p: 1, x: 0, y: 0 };
  return state;
}
// ...and a free square nothing constrains.
function addFreeSquare(state) {
  // well clear of every id the fixtures above allocate
  let pid = 500, eid = 500;
  const ids = [[50, 50], [60, 50], [60, 60], [50, 60]].map(([x, y]) => {
    state.points[pid] = { x, y };
    return pid++;
  });
  for (let i = 0; i < 4; i++) {
    state.entities[eid] = { id: eid, type: 'line', a: ids[i], b: ids[(i + 1) % 4] };
    eid++;
  }
  return ids;
}
function circleDoc(withRadiusConstraint) {
  const state = { points: {}, entities: {}, constraints: {} };
  state.points[1] = { x: 0, y: 0 };
  state.entities[1] = { id: 1, type: 'circle', c: 1, r: 20 };
  if (withRadiusConstraint) state.constraints[1] = { id: 1, type: 'radius', entity: 1, value: 25 };
  return state;
}
function arcDoc() {
  const state = { points: {}, entities: {}, constraints: {} };
  state.points[1] = { x: 0, y: 0 };   // centre
  state.points[2] = { x: 10, y: 0 };  // start
  state.points[3] = { x: 0, y: 10 };  // end
  state.entities[1] = { id: 1, type: 'arc', c: 1, s: 2, e: 3 };
  return state;
}

// ---- 1. the gate answers without solving ----------------------------------
console.log('\n== a drag no constraint reads is skipped ==');
{
  const state = constrainedDoc();
  const free = addFreeSquare(state);
  const { api, calls, ui } = build(state);
  const before = { x: state.points[2].x, y: state.points[2].y };
  const res = api.requestSolve({ dragPoints: free });
  check('solveSketch is called once (the cheap probe)', calls.solve === 1, calls.solve);
  check('the result is marked skipped', res && res.skipped === true, JSON.stringify(res));
  check('the violated constraint was left alone', state.points[2].x === before.x && state.points[2].y === before.y);
  check('the solver never ran', calls.last.iterations === 0, calls.last.iterations);

  // a backlog must survive a skipped solve
  api.markUnsolved();
  api.requestSolve({ dragPoints: free });
  check('the unsolved flag survives a skipped solve', ui.solveDirty === true, ui.solveDirty);
}

// ---- 2. a drag a constraint reads does solve -------------------------------
console.log('\n== a drag a constraint reads still solves ==');
{
  const state = constrainedDoc();
  const { api, calls } = build(state);
  const res = api.requestSolve({ dragPoints: [2] });
  check('not skipped', !res.skipped, JSON.stringify(res));
  check('the solver actually ran', calls.last.iterations > 0, calls.last.iterations);
  check('horizontal is satisfied again', Math.abs(state.points[2].y - state.points[1].y) < 1e-6,
    state.points[2].y);
  check('the cost is published', api && typeof res.cost === 'number');
}

// ---- 3. live mode: a drag target alone does not keep the solve alive -----
console.log('\n== live mode: a drag target is not a constraint ==');
{
  const state = constrainedDoc();
  const free = addFreeSquare(state);
  const { api, calls } = build(state, { solveMode: 'live' });
  // A drag target on a point NO CONSTRAINT reads is still skipped: the target is
  // the hand, not a relation, and solving for it alone would move a free point
  // the mouse already placed. Only a relation gives the solver work to do.
  const res = api.requestSolve({ dragTargets: [{ p: free[0], x: 55, y: 55, w: 300 }], residualScale: 1, dragPoints: free });
  check('skipped: nothing reads the dragged points', res && res.skipped === true, JSON.stringify(res));
  check('the point is not dragged around by a solver it does not need',
    state.points[free[0]].x === 50, state.points[free[0]].x);

  // ...but a radius drag DOES count as reachable work once the entity is read by
  // a relation: the radius target is the only way the handle can survive a
  // release, and skipping it was the snap-back bug.
  const cd = circleDoc(true);
  const b2 = build(cd, { solveMode: 'live' });
  cd.entities[1].r = 60;
  const r2 = b2.api.requestSolve({
    dragPoints: [], dragEntity: 1,
    dragRadiusTarget: { e: 1, r: 60, w: 300 }
  });
  check('a radius drag against a radius dimension still solves', !r2.skipped, JSON.stringify(r2));
}

// ---- 4. a radius drag ------------------------------------------------------
console.log('\n== a radius drag only solves when something reads the radius ==');
{
  const withC = circleDoc(true);
  const r1 = build(withC).api.requestSolve({ dragPoints: [], dragEntity: 1 });
  check('radius constraint reads it -> solves', !r1.skipped, JSON.stringify(r1));
  check('and the radius moved to the dimension', Math.abs(withC.entities[1].r - 25) < 1e-6,
    withC.entities[1].r);

  const without = circleDoc(false);
  const r2 = build(without).api.requestSolve({ dragPoints: [], dragEntity: 1 });
  check('nothing reads it -> skipped', r2 && r2.skipped === true, JSON.stringify(r2));
  check('the radius stays where the handle left it', without.entities[1].r === 20, without.entities[1].r);
}

// ---- 5. arcs always have their own residual --------------------------------
console.log('\n== an arc end is read even with no explicit constraint ==');
{
  const state = arcDoc();
  const { api } = build(state);
  const res = api.requestSolve({ dragPoints: [3] });
  check('the arc sweep residual keeps the solve alive', !res.skipped, JSON.stringify(res));
}

// ---- 6. non-drag calls are untouched ---------------------------------------
console.log('\n== a solve without drag points is never gated ==');
{
  const state = constrainedDoc();
  addFreeSquare(state);
  const { api } = build(state);
  const res = api.requestSolve();
  check('no skipped flag on ordinary solves', !res.skipped, JSON.stringify(res));
}

// ---- 7. the auto solve timer -----------------------------------------------
console.log('\n== auto solve: no solve inside the first pointermove ==');
{
  const state = constrainedDoc();
  const free = addFreeSquare(state);
  const h = build(state, { interval: 100 });
  h.api.resetSolved();
  h.ui.drag = { kind: 'entity', ids: free, moved: true };
  h.api.scheduleDragAutoSolve();
  check('the first move only arms the timer', h.calls.solve === 0, h.calls.solve);
  check('one timer is pending for the interval',
    h.clock.timers.length === 1 && h.clock.timers[0].at === 100,
    JSON.stringify(h.clock.timers.map(t => t.at)));

  h.clock.now = 100;
  h.fireDue();
  check('the slot runs the probe', h.calls.solve === 1, h.calls.solve);
  check('and it reports the drag as irrelevant', h.calls.last && h.calls.last.skipped === true,
    JSON.stringify(h.calls.last));
  check('no panel rebuild for a skipped slot', h.calls.updateUI === 0, h.calls.updateUI);
  check('no repaint for a skipped slot', h.calls.render === 0, h.calls.render);
  check('no loop invalidation for a skipped slot', h.calls.loops === 0, h.calls.loops);
  check('the solver cost is untouched', h.ui.solverCost === null, h.ui.solverCost);
}

console.log('\n== auto solve: a constrained drag does the work ==');
{
  const state = constrainedDoc();
  const h = build(state, { interval: 100 });
  h.api.resetSolved();
  h.ui.drag = { kind: 'entity', ids: [2], moved: true };
  h.api.scheduleDragAutoSolve();
  h.clock.now = 100;
  h.fireDue();
  check('the solve ran', h.calls.solve === 1 && !h.calls.last.skipped, JSON.stringify(h.calls.last));
  check('horizontal is repaired mid-drag', Math.abs(state.points[2].y - state.points[1].y) < 1e-6,
    state.points[2].y);
  check('the panel is refreshed once', h.calls.updateUI === 1, h.calls.updateUI);
  check('a repaint is scheduled', h.calls.render === 1, h.calls.render);
}

console.log('\n== auto solve: the next slot waits its interval ==');
{
  const state = constrainedDoc();
  const h = build(state, { interval: 100 });
  h.api.resetSolved();
  h.ui.drag = { kind: 'entity', ids: [2], moved: true };
  h.api.scheduleDragAutoSolve();          // arms t=100
  h.clock.now = 100; h.fireDue();         // runs, records lastTime = 100
  h.api.scheduleDragAutoSolve();          // move right after the solve
  check('no back-to-back solve', h.calls.solve === 1, h.calls.solve);
  check('the next slot is a full interval later',
    h.clock.timers.length === 1 && h.clock.timers[0].at === 200,
    JSON.stringify(h.clock.timers.map(t => t.at)));
}

console.log('\n== auto solve: manual mode never arms the timer ==');
{
  const state = constrainedDoc();
  const h = build(state, { solveMode: 'manual' });
  h.api.resetSolved();
  h.ui.drag = { kind: 'entity', ids: [2], moved: true };
  h.api.scheduleDragAutoSolve();
  check('no timer at all', h.clock.timers.length === 0, JSON.stringify(h.clock.timers));
  check('no solve', h.calls.solve === 0, h.calls.solve);
}

console.log('\n== auto solve: a released drag cancels the pending slot ==');
{
  const state = constrainedDoc();
  const h = build(state, { interval: 100 });
  h.api.resetSolved();
  h.ui.drag = { kind: 'entity', ids: [2], moved: true };
  h.api.scheduleDragAutoSolve();
  h.api.cancelDragAutoSolve();            // pointerup
  check('the timer is gone', h.clock.timers.length === 0, JSON.stringify(h.clock.timers));
  h.clock.now = 100;
  check('and nothing fires', h.fireDue() === 0 && h.calls.solve === 0, h.calls.solve);
}

// ---- 8. what a skipped slot actually saves ---------------------------------
console.log('\n== auto solve: cost of one slot, constrained document ==');
{
  // a long horizontal/vertical chain with dimensions — the sort of file where
  // the full solve is expensive — plus a free square to drag.
  const makeState = () => {
    const state = { points: {}, entities: {}, constraints: {} };
    let pid = 0, eid = 0, cid = 0;
    const pt = (x, y) => { state.points[++pid] = { x, y }; return pid; };
    let prev = pt(0, 0);
    const first = prev;
    for (let i = 0; i < 120; i++) {
      const vertical = i % 2 === 1;
      const next = pt(vertical ? state.points[prev].x : state.points[prev].x + 20,
        vertical ? state.points[prev].y + 20 : state.points[prev].y);
      const e = ++eid;
      state.entities[e] = { id: e, type: 'line', a: prev, b: next };
      state.constraints[++cid] = { id: cid, type: vertical ? 'vertical' : 'horizontal', entity: e };
      if (i % 3 === 0) state.constraints[++cid] = { id: cid, type: 'distance', p1: prev, p2: next, value: 20, offset: 20 };
      prev = next;
    }
    state.constraints[++cid] = { id: cid, type: 'fix', p: first, x: 0, y: 0 };
    addFreeSquare(state);
    // break a few dimensions, so the solver has real work mid-drag
    for (const k of Object.keys(state.points)) {
      if (+k % 7 === 0) state.points[k].y += 1.5;
    }
    return state;
  };

  // A fresh document per sample: one solve repairs the dimensions, so reusing
  // it would measure the cheap "already satisfied" path after the first call.
  const freeIds = [500, 501, 502, 503];
  const timeOf = (opts) => {
    let total = 0;
    for (let i = 0; i < 50; i++) {
      const state = makeState();
      const { api } = build(state);
      const t0 = process.hrtime.bigint();
      api.requestSolve(opts);
      total += Number(process.hrtime.bigint() - t0);
    }
    return total / 1e6;
  };
  const gated = timeOf({ dragPoints: freeIds });         // the new path
  const full = timeOf();                                 // what a slot cost before
  console.log('  50 slots: gated ' + gated.toFixed(1) + ' ms, full ' + full.toFixed(1) +
    ' ms  (' + (full / gated).toFixed(1) + 'x)');
  check('a skipped slot is cheaper than the full solve', gated < full,
    gated.toFixed(2) + ' vs ' + full.toFixed(2));
  check('and a lot cheaper on a real file', full / gated >= 3, (full / gated).toFixed(2));
}

console.log('\n' + (fail ? (fail + ' FAILED, ' + pass + ' passed') : ('all ' + pass + ' checks passed')));
process.exit(fail ? 1 : 0);
