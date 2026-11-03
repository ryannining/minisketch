// Probe: is spline trim exact? (Ryan: "trimmingnya tidak exact, menyisakan
// garis di luar curve")
//
// Trim path: trimEntity (app.js:5521) collects intersection params in the
// spline's global frame, then splineSubCurve (app.js:5467) re-splits the cubic
// chain at [t0, t1] with de Casteljau and rebuilds nodes {p, o, i}.
//
// The rebuild is where exactness can break. A node's o-handle must be the
// *next* span's P1 and its i-handle the *previous* span's P2. splineSubCurve
// writes:
//     nodes.push({ p: c.P0, o: c.P1, i: c.P0 });   // k === 0
//     nodes[nodes.length-1].o = { ...c.P1 };       // only when a next part exists
//     nodes.push({ p: c.P3, o: c.P3, i: c.P2 });
// so the FIRST node's i and the LAST node's o are synthetic (clamped to the
// node itself). Inside a single span that is harmless; across spans it
// flattens the handle and the piece drifts *outside* the original curve.
//
// Run: node testing/trim_probe.js

const fs = require('fs');
const path = require('path');
const C = require(path.join(__dirname, '..', 'core.js'));

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
function braceEnd(s, from) {
  let d = 0;
  for (let j = s.indexOf('{', from); j < s.length; j++) {
    if (s[j] === '{') d++;
    else if (s[j] === '}') { d--; if (!d) return j + 1; }
  }
  return s.length;
}
function slice(name) {
  const i = appSrc.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('no function ' + name);
  return appSrc.slice(i, braceEnd(appSrc, i));
}

// --- the app's own splitter, lifted verbatim -------------------------------

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// the app's own splitter, lifted verbatim: splineSubCurve closes over
// splineCubics / splitCubic / clamp, so inject them as parameters
const subCurveFactory = new Function('splineCubics', 'splitCubic', 'clamp',
  slice('splineSubCurve').replace('function splineSubCurve(', 'return function('));
const subCurve = subCurveFactory(C.splineCubics, C.splitCubic, clamp);

// --- geometry helpers ------------------------------------------------------

const cubicPoint = (c, u) => {
  const m = 1 - u;
  return {
    x: m * m * m * c.P0.x + 3 * m * m * u * c.P1.x + 3 * m * u * u * c.P2.x + u * u * u * c.P3.x,
    y: m * m * m * c.P0.y + 3 * m * m * u * c.P1.y + 3 * m * u * u * c.P2.y + u * u * u * c.P3.y
  };
};

// distance from a point to the original cubic chain, by Newton refinement over
// every span. Coarse sampling alone quantises the answer at half the sample
// spacing (~0.04 mm for a 30 mm span at 400 samples), which reads as drift.
const cubicClosest = (pt, c) => {
  let best = Infinity;
  for (let k = 0; k <= 200; k++) {
    const u = k / 200;
    const q = cubicPoint(c, u);
    const d = Math.hypot(q.x - pt.x, q.y - pt.y);
    if (d < best) best = d;
  }
  // golden-section refine the neighbourhood of the coarse minimum
  let lo = 0, hi = 1, mid = 0;
  {
    let bi = 0, bd = Infinity;
    for (let k = 0; k <= 200; k++) {
      const q = cubicPoint(c, k / 200);
      const d = Math.hypot(q.x - pt.x, q.y - pt.y);
      if (d < bd) { bd = d; bi = k; }
    }
    lo = Math.max(0, (bi - 1) / 200); hi = Math.min(1, (bi + 1) / 200);
  }
  for (let it = 0; it < 80; it++) {
    const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
    const d1 = (() => { const q = cubicPoint(c, m1); return Math.hypot(q.x - pt.x, q.y - pt.y); })();
    const d2 = (() => { const q = cubicPoint(c, m2); return Math.hypot(q.x - pt.x, q.y - pt.y); })();
    if (d1 < d2) hi = m2; else lo = m1;
  }
  mid = (lo + hi) / 2;
  const q = cubicPoint(c, mid);
  return Math.hypot(q.x - pt.x, q.y - pt.y);
};

const distToChain = (pt, cubics) => {
  let best = Infinity;
  for (const c of cubics) {
    const d = cubicClosest(pt, c);
    if (d < best) best = d;
  }
  return best;
};

// sample the rebuilt piece through splineCubics (what the app renders)
const pieceCubics = (nodes, closed) => C.splineCubics(
  nodes.map(n => n.p),
  { o: nodes.map(n => n.o), i: nodes.map(n => n.i) },
  closed
);

// --- a wavy open spline, the shape trim is used on -------------------------

const cps = [
  { x: 0, y: 0 }, { x: 20, y: 35 }, { x: 55, y: -10 }, { x: 90, y: 30 }
];
// smooth handles, so a mis-assigned handle shows up as drift
const hs = C.autoHandles(cps, false);
const cubics = C.splineCubics(cps, hs, false);

console.log('open spline: ' + cps.length + ' nodes, ' + cubics.length + ' spans');

// --- case 1: trim inside ONE span -----------------------------------------

{
  const t0 = 0.03, t1 = 0.20;            // both inside span 0 (0..0.25)
  const r = subCurve(cps, hs, t0, t1, false);
  check('case1 split returns nodes', r && r.nodes && r.nodes.length === 2,
    r && r.nodes && r.nodes.length);
  if (r && r.nodes) {
    const pc = pieceCubics(r.nodes, false);
    let worst = 0, at = null;
    for (const c of pc) {
      for (let k = 0; k <= 60; k++) {
        const q = cubicPoint(c, k / 60);
        const d = distToChain(q, cubics);
        if (d > worst) { worst = d; at = q; }
      }
    }
    check('case1 piece stays on the original curve (< 1e-6 mm)', worst < 1e-6,
      'max drift ' + worst.toExponential(3) + ' at (' +
      (at && at.x.toFixed(2)) + ',' + (at && at.y.toFixed(2)) + ')');
  }
}

// --- case 2: trim spanning TWO spans (the interesting one) -----------------

{
  const t0 = 0.10, t1 = 0.40;            // spans 1 and 2 region, crosses a node
  const r = subCurve(cps, hs, t0, t1, false);
  check('case2 split returns nodes', r && r.nodes && r.nodes.length >= 3,
    r && r.nodes && r.nodes.length);
  if (r && r.nodes) {
    const pc = pieceCubics(r.nodes, false);
    let worst = 0, at = null;
    for (const c of pc) {
      for (let k = 0; k <= 60; k++) {
        const q = cubicPoint(c, k / 60);
        const d = distToChain(q, cubics);
        if (d > worst) { worst = d; at = q; }
      }
    }
    check('case2 piece stays on the original curve (< 1e-6 mm)', worst < 1e-6,
      'max drift ' + worst.toExponential(3) + ' at (' +
      (at && at.x.toFixed(2)) + ',' + (at && at.y.toFixed(2)) + ')');
  }
}

// --- case 3: node count and handle continuity ------------------------------

{
  const t0 = 0.10, t1 = 0.40;
  const r = subCurve(cps, hs, t0, t1, false);
  if (r && r.nodes) {
    // every interior node must carry BOTH handles as real positions,
    // and consecutive spans must share the node: prev.o == this.P1
    const pc = pieceCubics(r.nodes, false);
    let badChain = 0;
    for (let s = 0; s + 1 < r.nodes.length; s++) {
      const nd = r.nodes[s];
      // nd.o is the out-handle used by span s
      if (!nd.o || !nd.i) badChain++;
      const nextNd = r.nodes[s + 1];
      // node positions must be distinct (no zero-length spans)
      if (Math.hypot(nextNd.p.x - nd.p.x, nextNd.p.y - nd.p.y) < 1e-12) badChain++;
    }
    check('case3 every node has both handles and spans are non-degenerate',
      badChain === 0, badChain + ' bad nodes');

    // endpoints must land exactly on the original curve
    const p0 = r.nodes[0].p, pN = r.nodes[r.nodes.length - 1].p;
    const d0 = distToChain(p0, cubics), dN = distToChain(pN, cubics);
    check('case3 endpoints lie on the original curve (< 1e-9)',
      d0 < 1e-9 && dN < 1e-9,
      'start ' + d0.toExponential(2) + ' end ' + dN.toExponential(2));
  }
}

console.log('\n' + (fail ? fail + ' FAILED' : 'all exact') + '  (' + pass + ' pass, ' + fail + ' fail)');
process.exit(fail ? 1 : 0);
