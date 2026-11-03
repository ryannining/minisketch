// Probe for the GENERATOR WATCHERS: a generated object (gen.kind) registers its
// dependent points via api.watchGen; after a solve that actually MOVED one of
// those points, the tool's onChange runs with the changed point ids. A solve
// that moved nothing must not call it, removal must detach, and the re-entrancy
// guard must stop a handler that keeps re-solving after 3 rounds.
//
// It slices the real watcher module + solveNow out of ../app.js (the way
// release_drag_probe.js does) so the code under test is the shipped code.
//
// Run: node testing/gen_watch_probe.js
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
function sliceBlock(fromMarker, toMarker) {
  const a = appSrc.indexOf(fromMarker);
  const b = appSrc.indexOf(toMarker);
  if (a < 0 || b < 0 || b < a) throw new Error('block not found');
  return appSrc.slice(a, b);
}

const watchSrc = sliceBlock('// ---- Generator watchers', '  function solveNow(fixedPoints');
const solveNowSrc = sliceFn('solveNow');

// ---- sandbox ---------------------------------------------------------------
// A tiny document: two points, one watched (1) one not (2). solveSketch is a
// stub the tests control: it moves whichever points each test asks for, then
// reports a normal (non-skipped) result.
const state = {
  points: { 1: { x: 0, y: 0 }, 2: { x: 10, y: 0 } },
  entities: {}
};
const ui = { solverCost: 0 };
let moveOnSolve = [];             // point ids the stubbed solver moves each run
let solveRuns = 0;

const tools = { list: [] };
const sandbox = `
${watchSrc}
${solveNowSrc}
return { genWatchAdd, genWatchRemove, genWatchClear, genWatchDispatch,
  genWatchDepth: () => genWatchDepth, solveNow,
  watchedCount: () => genWatchers.size };
`;
const factory = new Function('state', 'ui', 'window', 'solveSketch', 'toolApi', sandbox);
const W = factory(state, ui, { MiniSketchTools: tools }, solveStub, () => ({}));

function solveStub() {
  solveRuns++;
  for (const pid of moveOnSolve) {
    const p = state.points[pid];
    if (p) p.x += 1;
  }
  return { skipped: false, cost: 0 };
}

// a fake tool with a watched entity
let calls = [];
tools.list.push({
  id: 'finger',
  onChange(api, e, changed) {
    calls.push({ entity: e.id, changed: changed.slice() });
    // simulate "the rebuild moved the watched point again": the real finger
    // refit re-solves; here the solver moves the point once more per round
    if (e.retrigger) W.solveNow();
  }
});
const fakeApi = {};   // toolApi() stub: onChange receives it, unused here

const ent = { id: 7, gen: { kind: 'finger' } };
state.entities[7] = ent;

// 1. register and move the watched point
W.genWatchAdd(7, [1]);
check('registry holds one watch', W.watchedCount() === 1);
moveOnSolve = [1];
W.solveNow();
check('moved watched point -> onChange ran', calls.length === 1);
check('onChange got the changed point id', calls[0] && calls[0].changed.includes(1));
check('onChange got the entity', calls[0] && calls[0].entity === 7);

// 2. move the UNWATCHED point only
calls = [];
moveOnSolve = [2];
W.solveNow();
check('moved unwatched point -> onChange did NOT run', calls.length === 0);

// 3. a solve that moved nothing
calls = [];
moveOnSolve = [];
W.solveNow();
check('solve that moved nothing -> no onChange', calls.length === 0);

// 4. removal detaches
W.genWatchRemove(7);
check('remove empties the registry', W.watchedCount() === 0);
moveOnSolve = [1];
W.solveNow();
check('after removal a moved point triggers nothing', calls.length === 0);

// 5. re-entrancy guard: a handler whose rebuild keeps moving the point must
//    settle after the depth cap, not loop forever
W.genWatchAdd(7, [1]);
ent.retrigger = true;
calls = [];
moveOnSolve = [1];
const before = solveRuns;
W.solveNow();
check('re-entrant onChange is capped (depth guard)', calls.length <= 3,
  'calls=' + calls.length);
check('the capped loop did terminate', solveRuns - before <= 4,
  'solves=' + (solveRuns - before));

// 6. a DIRECT move (drag translate, no solver) followed by a solve that itself
//    changes nothing must STILL fire: the pre/post-solve diff would miss it
ent.retrigger = false;            // a quiet handler for this test
W.genWatchAdd(7, [1]);
state.points[1].x += 25;          // the drag translates the point directly
calls = [];
moveOnSolve = [];                 // the release solve itself moves nothing
W.solveNow();
check('direct drag translate + no-op solve -> onChange ran', calls.length === 1,
  'calls=' + calls.length);

// 6b. exactly once: an immediate second no-op solve must not re-fire
calls2 = calls;
W.solveNow();
check('no double fire on the next no-op solve', calls.length === 1);

// 7. clear (loadDocument path)
W.genWatchClear();
check('clear empties the registry', W.watchedCount() === 0);

console.log('\\n' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
