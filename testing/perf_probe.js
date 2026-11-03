// Benchmark: solver cost vs snapshot (undo) cost, to decide whether deferring
// the solve to a manual button is worth it.
//
// Run: node testing/perf_probe.js
const fs = require('fs');
const path = require('path');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
// pure helpers moved to core.js; fall back to it when app.js no longer
// defines the function (keeps the probe working across that refactor)
const Core = require(path.join(__dirname, '..', 'core.js'));
const sliceOrCore = (name) => {
  try { return sliceApp(name); } catch (err) {
    if (typeof Core[name] === 'function') return Core[name].toString();
    throw err;
  }
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
  if (start < 0) throw new Error('not found: ' + name);
  let i = appSrc.indexOf('(', start), depth = 0;
  for (; i < appSrc.length; i++) {
    if (appSrc[i] === '(') depth++;
    else if (appSrc[i] === ')') { depth--; if (!depth) break; }
  }
  return appSrc.slice(start, braceEnd(appSrc, i));
};

const solverCode = ['solveSketch', 'lmSolve', 'solveLinear', 'solveNow'].map(sliceOrCore).join('\n');
const ui = {};
const buildSolver = (state) => new Function(
  'state', 'ui', 'dist', 'textDimCount',
  // solveSketch calls markUnsolved() when it refuses to commit a stalled
  // iterate; this harness has no UI, so the flag is simply recorded on `ui`.
  'markUnsolved',
  solverCode + '\nreturn { solveSketch, solveNow };'
)(state, ui, (a, b) => Math.hypot(a.x - b.x, a.y - b.y), () => 0,
  () => { ui.solveDirty = true; });

// --- synthetic sketches ---------------------------------------------------
function makeSketch(nLines, opts) {
  const o = opts || {};
  const state = { points: {}, entities: {}, constraints: {} };
  let pid = 0, eid = 0, cid = 0;
  const pt = (x, y) => { const id = ++pid; state.points[id] = { x, y }; return id; };
  let prev = pt(0, 0);
  const first = prev;
  for (let i = 0; i < nLines; i++) {
    const vertical = i % 2 === 1;
    const next = pt(vertical ? state.points[prev].x : state.points[prev].x + 20,
      vertical ? state.points[prev].y + 20 : state.points[prev].y);
    const id = ++eid;
    state.entities[id] = { id, type: 'line', a: prev, b: next, color: '#000000' };
    if (o.constrain !== false) {
      const h = ++cid;
      state.constraints[h] = { id: h, type: vertical ? 'vertical' : 'horizontal', entity: id };
      if (i % 3 === 0) {
        const d = ++cid;
        state.constraints[d] = { id: d, type: 'distance', p1: prev, p2: next, value: 20, offset: 20 };
      }
    }
    prev = next;
  }
  state.constraints[++cid] = { id: cid, type: 'fix', p: first, x: 0, y: 0 };
  return state;
}

// Move every point a little, so the constraints are violated the way they are
// mid-drag and the solver actually has to iterate.
const perturb = (state, amt) => {
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff - 0.5;
  };
  for (const id in state.points) {
    state.points[id].x += rnd() * amt;
    state.points[id].y += rnd() * amt;
  }
};

const time = (fn, reps) => {
  fn();                                        // warm up
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < reps; i++) fn();
  const t1 = process.hrtime.bigint();
  return Number(t1 - t0) / 1e6 / reps;         // ms per call
};

const fmtMs = (v) => (v < 0.01 ? v.toFixed(3) : v.toFixed(2)) + ' ms';
const kb = (s) => (Buffer.byteLength(s, 'utf8') / 1024).toFixed(1) + ' KB';

console.log('=== solver: solveSketch() cost (Solver iterations until converged) ===');
console.log('lines  points  cons   maxIter  ms/solve   50 solves   iterations');
for (const n of [10, 30, 60, 120, 250]) {
  const state = makeSketch(n);
  const api = buildSolver(state);
  for (const iter of [60, 90]) {
    const reps = n >= 120 ? 10 : 30;
    // violated state: this is what a drag actually asks the solver to fix
    const ms = time(() => { perturb(state, 2); api.solveSketch({ maxIter: iter }); }, reps);
    perturb(state, 2);
    const res = api.solveSketch({ maxIter: iter });
    console.log(
      String(n).padEnd(6) + String(Object.keys(state.points).length).padEnd(8) +
      String(Object.keys(state.constraints).length).padEnd(7) + String(iter).padEnd(9) +
      fmtMs(ms).padEnd(12) + fmtMs(ms * 50).padEnd(12) + res.iterations);
  }
}

console.log('\n=== solver with drag targets (what a body drag does per mousemove) ===');
{
  const state = makeSketch(60);
  const api = buildSolver(state);
  const targets = Object.keys(state.points).slice(0, 8).map(id => ({
    p: +id, x: state.points[id].x + 1, y: state.points[id].y + 1, w: 30
  }));
  const ms = time(() => {
    perturb(state, 2);
    api.solveNow({ dragTargets: targets, residualScale: 20 }, 90);
  }, 30);
  console.log('60 lines, 8 drag targets: ' + fmtMs(ms) + ' per mousemove solve');
}

console.log('\n=== no constraints at all (free vector editing) ===');
{
  const state = makeSketch(60, { constrain: false });
  const api = buildSolver(state);
  const res = api.solveSketch({ maxIter: 90 });
  const ms = time(() => api.solveSketch({ maxIter: 90 }), 100);
  console.log('60 lines, 0 constraints: ' + fmtMs(ms) + ' (' + res.iterations + ' iterations)');
}

console.log('\n=== undo snapshot: JSON.stringify(state + view) per pushHistory() ===');
console.log('lines  points  cons   size         stringify   parse+restore');
const view = { x: 0, y: 0, zoom: 1 };
for (const n of [10, 30, 60, 120, 250]) {
  const state = makeSketch(n);
  const snap = () => JSON.stringify({ state, view });
  const size = snap();
  const sMs = time(snap, 100);
  const pMs = time(() => JSON.parse(size), 100);
  console.log(
    String(n).padEnd(6) + String(Object.keys(state.points).length).padEnd(8) +
    String(Object.keys(state.constraints).length).padEnd(7) +
    kb(size).padEnd(13) + fmtMs(sMs).padEnd(12) + fmtMs(pMs));
}

console.log('\n=== same, with a pasted artwork entity (contours dominate the size) ===');
for (const ptsPerContour of [50, 200, 800]) {
  const state = makeSketch(20);
  const contours = [];
  for (let c = 0; c < 6; c++) {
    const loop = [];
    for (let i = 0; i < ptsPerContour; i++) {
      const t = (i / ptsPerContour) * Math.PI * 2;
      loop.push([0.5 + 0.4 * Math.cos(t), 0.5 + 0.4 * Math.sin(t)]);
    }
    contours.push(loop);
  }
  state.entities[9999] = {
    id: 9999, type: 'art', p0: 1, pw: 2, ph: 3, guide: [], contours,
    ratio: 1, tol: 0.1, color: '#000000'
  };
  const snap = JSON.stringify({ state, view });
  const sMs = time(() => JSON.stringify({ state, view }), 20);
  const nodes = contours.reduce((a, l) => a + l.length, 0);
  console.log(String(nodes).padEnd(8) + 'nodes  snapshot ' + kb(snap).padEnd(10) +
    ' stringify ' + fmtMs(sMs) + '  x120 undo steps = ' +
    (Buffer.byteLength(snap, 'utf8') * 120 / 1048576).toFixed(1) + ' MB');
}

console.log('\n=== text entity: contours are cached, not stored ===');
{
  const state = makeSketch(10);
  state.entities[8888] = { id: 8888, type: 'text', p0: 1, pw: 2, ph: 3, text: 'KaryaCNC', font: 'sans-serif', weight: 400 };
  console.log('text snapshot: ' + kb(JSON.stringify({ state, view })));
}

console.log('\n=== cheap relaxation: 1 or 2 iterations instead of converging ===');
console.log('lines  pts   1 iter    2 iters   4 iters (converged)   per-iteration');
for (const n of [30, 60, 120, 250]) {
  const state = makeSketch(n);
  const api = buildSolver(state);
  const one = time(() => { perturb(state, 2); api.solveSketch({ maxIter: 1 }); }, 20);
  const two = time(() => { perturb(state, 2); api.solveSketch({ maxIter: 2 }); }, 20);
  const full = time(() => { perturb(state, 2); api.solveSketch({ maxIter: 60 }); }, 10);
  console.log(
    String(n).padEnd(6) + String(Object.keys(state.points).length).padEnd(7) +
    fmtMs(one).padEnd(10) + fmtMs(two).padEnd(10) + fmtMs(full).padEnd(22) +
    fmtMs(full / 4));
}

console.log('\n=== what one full solve costs relative to a 60 fps frame (16.7 ms) ===');
for (const n of [10, 30, 60, 120]) {
  const state = makeSketch(n);
  const api = buildSolver(state);
  const ms = time(() => { perturb(state, 2); api.solveSketch({ maxIter: 60 }); }, 10);
  console.log(String(n).padEnd(6) + 'lines: ' + (ms / 16.7 * 100).toFixed(0) + '% of the frame budget');
}
