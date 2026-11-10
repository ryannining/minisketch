// Probe: does double-click insert-point on a spline preserve the curve?
// Simulates exactly the spline branch of insertPointOnEntity() in app.js and
// checks that the curve is unchanged: every span after the insert must be a
// bit-identical copy of an original span, except the split span, which must
// equal the exact de Casteljau left/right pieces.
//
// The oracle compares BÉZIER CONTROL POINTS directly — not sampled outlines.
// A sampled Hausdorff comparison across 400-500 points was tried first and
// proved to be a broken oracle: on wiggly splines consecutive samples can be
// far apart along the curve, so a curve compared against itself reports
// deviations of many units. The exact comparison below is deterministic and
// cannot false-positive.
//
// Run: node testing/spline_insert_probe.js
const Core = require('../core.js');
const { splitCubic, autoHandles } = Core;

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

const eq = (a, b) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;

function insertInSpline(cps, hs, closed, tGlobal) {
  // mirror of app.js spline branch
  const n = cps.length;
  const nsegs = closed ? n : n - 1;
  const g = Math.min(1, Math.max(0, tGlobal)) * nsegs;
  const k = Math.min(nsegs - 1, Math.floor(g));
  const u = g - k;
  const j = closed ? (k + 1) % n : k + 1;
  const P0 = cps[k];
  const P1 = hs.o[k] || P0;
  const P2 = hs.i[j] || cps[j];
  const P3 = cps[j];
  const r = splitCubic(P0, P1, P2, P3, u);
  const ids = cps.map((_, idx) => idx);
  const o = hs.o.slice();
  const ih = hs.i.slice();
  if (closed && k === n - 1) {
    o[n - 1] = r.left.o;
    ih[0] = r.right.i;
    o.push(r.right.o);
    ih.push(r.left.i);
    ids.push(n);
  } else {
    o[k] = r.left.o;
    ih[k + 1] = r.right.i;
    o.splice(k + 1, 0, r.right.o);
    ih.splice(k + 1, 0, r.left.i);
    ids.splice(k + 1, 0, n);
  }
  const newCps = ids.map(id => id === n ? r.S : cps[id]);
  return { cps: newCps, hs: { o, i: ih } };
}

// Returns null when the after-curve is an exact reparametrization of the
// before-curve, else a description of the first mismatch.
function shapeMismatch(before, after, closed, k, u) {
  const n = before.cps.length;
  const nsegs = closed ? n : n - 1;
  const A = after.cps, H = after.hs;
  const j = closed ? (k + 1) % n : k + 1;
  const P0 = before.cps[k], P1 = before.hs.o[k] || P0;
  const P2 = before.hs.i[j] || before.cps[j], P3 = before.cps[j];
  const r = splitCubic(P0, P1, P2, P3, u);
  const nsegsA = closed ? A.length : A.length - 1;
  for (let s = 0; s < nsegsA; s++) {
    const js = closed ? (s + 1) % A.length : s + 1;
    const A0 = A[s], A3 = A[js];
    const C1 = H.o[s] || A0, C2 = H.i[js] || A3;
    let E1, E2;
    if (s === k) { E1 = r.left.o; E2 = r.left.i; }
    else if (s === k + 1) { E1 = r.right.o; E2 = r.right.i; }
    else {
      const s0 = s > k ? s - 1 : s;
      const j0 = closed ? (s0 + 1) % n : s0 + 1;
      const Q0 = before.cps[s0], Q3 = before.cps[j0];
      if (!eq(A0, Q0) || !eq(A3, Q3)) return 'span ' + s + '->' + js + ' endpoints moved';
      E1 = before.hs.o[s0] || Q0;
      E2 = before.hs.i[j0] || Q3;
    }
    if (!eq(C1, E1) || !eq(C2, E2)) {
      return 'span ' + s + '->' + js + ' controls differ: (' +
        JSON.stringify(C1) + ',' + JSON.stringify(C2) + ') vs (' +
        JSON.stringify(E1) + ',' + JSON.stringify(E2) + ')';
    }
  }
  return null;
}

function rnd(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

function run(closed) {
  for (let trial = 0; trial < 120; trial++) {
    const R = rnd(trial * 7919 + (closed ? 17 : 31));
    const n = 3 + Math.floor(R() * 5);
    const cps = [];
    for (let i = 0; i < n; i++) cps.push({ x: R() * 400, y: R() * 400 });
    const hs = autoHandles(cps, closed);
    const nsegs = closed ? n : n - 1;
    const tGlobal = (0.2 + R() * 0.6); // middle of some span
    const g = tGlobal * nsegs;
    const k = Math.min(nsegs - 1, Math.floor(g));
    const u = g - k;
    if (u <= 0.02 || u >= 0.98) continue; // app guards this
    const after = insertInSpline(cps, hs, closed, tGlobal);
    const err = shapeMismatch({ cps, hs }, after, closed, k, u);
    check('insert preserves curve (' + (closed ? 'closed' : 'open') + ' trial ' + trial + ')',
      err === null, err);
  }
}

run(false);
run(true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
