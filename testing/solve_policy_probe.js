// Probe for the solve policy (live / on release / manual) and F9.
// Slices the solve-policy block out of ../app.js with stubs for the solver.
//
// Run: node testing/solve_policy_probe.js
const fs = require('fs');
const path = require('path');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

const from = appSrc.indexOf('  const SOLVE_MODES = ');
const to = appSrc.indexOf('  function solveNow(fixedPoints');
if (from < 0 || to < 0 || to < from) throw new Error('solve policy block not found');
const block = appSrc.slice(from, to);

const store = {};
const make = () => {
  const calls = { solve: 0, status: 0, toast: [], history: 0, commit: 0 };
  const ui = { solveMode: 'release', solveDirty: false, solverCost: null };
  const app = new Function(
    'ui', 'localStorage', 'solveNow', 'toast', 'updateStatusCounts', 'pushHistory',
    'commit', 'invalidateLoops', 'xfBlock', 'render',
    block + `
    return {
      requestSolve, solveAll, cycleSolveMode, loadSolveMode, markUnsolved,
      setDrag(v) { dragSolveSuppressed = v; },
      reset() { dragSolveSuppressed = false; },
      modes: SOLVE_MODES, labels: SOLVE_MODE_LABEL
    };`
  )(
    ui,
    {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); }
    },
    () => { calls.solve++; ui.solverCost = 0; return { cost: 0 }; },
    (m) => calls.toast.push(m),
    () => { calls.status++; },
    () => { calls.history++; },
    () => { calls.commit++; },
    () => {},
    () => false,
    () => {}
  );
  return { app, ui, calls };
};

console.log('\n== defaults ==');
let { app, ui, calls } = make();
app.loadSolveMode();
check('fresh install defaults to on release', ui.solveMode === 'release', ui.solveMode);
check('three modes exist', app.modes.join(',') === 'release,manual,live', app.modes.join(','));

console.log('\n== on release: a drag does not solve, releasing does ==');
({ app, ui, calls } = make());
app.loadSolveMode();
app.setDrag(true);
const r = app.requestSolve();
check('solve skipped while dragging', calls.solve === 0, calls.solve);
check('requestSolve returns null', r === null, r);
check('the sketch is flagged unsolved', ui.solveDirty === true);
check('the status chip is refreshed', calls.status > 0);
app.setDrag(false);                                  // pointerup
app.requestSolve();
check('solve runs once the drag is over', calls.solve === 1, calls.solve);
check('the unsolved flag is cleared', ui.solveDirty === false);

console.log('\n== on release: commands outside a drag still solve ==');
({ app, ui, calls } = make());
app.loadSolveMode();
app.requestSolve();
check('a command solves immediately', calls.solve === 1, calls.solve);

console.log('\n== manual: nothing solves on its own ==');
({ app, ui, calls } = make());
ui.solveMode = 'manual';
app.requestSolve();
app.setDrag(true);
app.requestSolve();
app.setDrag(false);
app.requestSolve();
check('no automatic solve at all', calls.solve === 0, calls.solve);
check('geometry stays flagged unsolved', ui.solveDirty === true);

console.log('\n== manual: F9 solves anyway ==');
app.solveAll();
check('F9 runs the solver', calls.solve === 1, calls.solve);
check('F9 records an undo step', calls.history === 1, calls.history);
check('F9 clears the unsolved flag', ui.solveDirty === false);
check('F9 commits (render + save + UI)', calls.commit === 1, calls.commit);
check('a dirty solve reports it', calls.toast.some(t => /Solved/.test(t)), JSON.stringify(calls.toast));

console.log('\n== live: solves inside the drag loop like before ==');
({ app, ui, calls } = make());
ui.solveMode = 'live';
app.loadSolveMode();                                  // must not override a set mode? it reads storage
ui.solveMode = 'live';
app.setDrag(true);
app.requestSolve();
check('live mode solves even mid-drag', calls.solve === 1, calls.solve);
check('nothing is left unsolved', ui.solveDirty === false);

console.log('\n== cycling the mode ==');
({ app, ui, calls } = make());
app.loadSolveMode();                                  // release
app.cycleSolveMode();
check('release -> manual', ui.solveMode === 'manual', ui.solveMode);
check('the choice is remembered', store['minisketch.solvemode'] === 'manual', store['minisketch.solvemode']);
check('the user is told', calls.toast.some(t => /manual/.test(t)), JSON.stringify(calls.toast));
app.cycleSolveMode();
check('manual -> live', ui.solveMode === 'live', ui.solveMode);
app.cycleSolveMode();
check('live -> release', ui.solveMode === 'release', ui.solveMode);
check('and back to the start', app.modes[0] === ui.solveMode);

console.log('\n== live mode catches up on unsolved work when entered ==');
({ app, ui, calls } = make());
ui.solveMode = 'manual';
app.requestSolve();
check('unsolved before switching', ui.solveDirty === true);
app.cycleSolveMode();                                 // manual -> live, catches up
check('the mode became live', ui.solveMode === 'live', ui.solveMode);
check('switching to live solves the backlog', calls.solve === 1, calls.solve);
check('and the backlog is no longer flagged', ui.solveDirty === false);

console.log('\n== a stored mode is restored ==');
store['minisketch.solvemode'] = 'manual';
({ app, ui } = make());
app.loadSolveMode();
check('manual is restored from storage', ui.solveMode === 'manual', ui.solveMode);
store['minisketch.solvemode'] = 'garbage';
({ app, ui } = make());
app.loadSolveMode();
check('an unknown value falls back to release', ui.solveMode === 'release', ui.solveMode);

console.log('\n' + (fail ? (fail + ' FAILED, ' + pass + ' passed') : ('all ' + pass + ' checks passed')));
process.exit(fail ? 1 : 0);
