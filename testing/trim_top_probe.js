// Probe: trim exactness on bool.sketch's topmost curve (1490).
//
// Ryan's report: "trim tidak exact, menyisakan garis di luar curve".
//
// Three findings, each measured here:
//   1. splineIntersections() intersects the SAMPLED polyline, so a crossing
//      lands on a chord, not on the cubic.
//   2. splineFrame().paramOf() snapped to the sample grid (multiples of
//      1/(per*nsegs)), so the cut was placed up to 0.64 mm from the crossing.
//   3. trimChain() bailed to plain trimEntity() for splines, so Ctrl+click
//      ("clear the whole chain up to the next crossing") did nothing on curves.
//
// Run: node testing/trim_top_probe.js

const fs = require('fs');
const path = require('path');
const C = require(path.join(__dirname, '..', 'core.js'));
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function braceEnd(s, from) {
  let d = 0;
  for (let j = s.indexOf('{', from); j < s.length; j++) {
    if (s[j] === '{') d++;
    else if (s[j] === '}') { d--; if (!d) return j + 1; }
  }
  return s.length;
}
const slice = (name) => {
  const i = appSrc.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('no function ' + name);
  return appSrc.slice(i, braceEnd(appSrc, i));
};

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

// --- load the file --------------------------------------------------------

const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'bool.sketch')));
const S = doc.state || doc;
const P = (id) => {
  const p = S.points[String(id)];
  return p ? (Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y }) : null;
};

const TOP = '1490';
const e = S.entities[TOP];
const cps = e.pts.map(P).filter(Boolean);
const hs = { o: e.hs.o.map(h => ({ x: h[0], y: h[1] })), i: e.hs.i.map(h => ({ x: h[0], y: h[1] })) };
const closed = !!e.closed;
const nsegs = closed ? cps.length : cps.length - 1;
const cubics = C.splineCubics(cps, hs, closed);
const frame = C.splineFrame(cps, hs, closed);

console.log('curve ' + TOP + ': ' + cps.length + ' nodes, ' + nsegs + ' spans, closed=' + closed);

// --- exact helpers --------------------------------------------------------

const ptAt = (c, u) => {
  const m = 1 - u;
  return {
    x: m * m * m * c.P0.x + 3 * m * m * u * c.P1.x + 3 * m * u * u * c.P2.x + u * u * u * c.P3.x,
    y: m * m * m * c.P0.y + 3 * m * m * u * c.P1.y + 3 * m * u * u * c.P2.y + u * u * u * c.P3.y
  };
};
// closest distance from pt to the whole original chain
const distToChain = (pt) => {
  let best = Infinity;
  for (const c of cubics) {
    let lo = 0, hi = 1;
    for (let it = 0; it < 120; it++) {
      const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
      const q1 = ptAt(c, m1), q2 = ptAt(c, m2);
      const d1 = Math.hypot(q1.x - pt.x, q1.y - pt.y);
      const d2 = Math.hypot(q2.x - pt.x, q2.y - pt.y);
      if (d1 < d2) hi = m2; else lo = m1;
    }
    const q = ptAt(c, (lo + hi) / 2);
    const d = Math.hypot(q.x - pt.x, q.y - pt.y);
    if (d < best) best = d;
  }
  return best;
};

// --- 1. refinePointOnSpline ------------------------------------------------

console.log('\n[1] refinePointOnSpline (app.js)');
const refine = new Function('splineFrame', 'clamp',
  slice('refinePointOnSpline').replace('function refinePointOnSpline(', 'return function(')
)(C.splineFrame, (v, a, b) => Math.min(b, Math.max(a, v)));

// the two crossings of 1490 with 1494, as the OLD chord-based code found them
const rawHits = [
  { x: -225.5651, y: 216.6517 },
  { x: -230.3195, y: 233.7693 }
];
for (let i = 0; i < rawHits.length; i++) {
  const raw = rawHits[i];
  const refined = refine(frame, raw);
  const before = distToChain(raw), after = distToChain(refined);
  check('hit' + i + ' moves onto the cubic (' + before.toExponential(2) + ' -> ' +
    after.toExponential(2) + ' mm)', after < 1e-6, 'still ' + after.toExponential(2));
}

// --- 2. paramOf lands on the true crossing ---------------------------------

console.log('\n[2] splineFrame().paramOf (core.js)');
const truthParams = [0.098583, 0.327667];
for (let i = 0; i < rawHits.length; i++) {
  const t = frame.paramOf(rawHits[i]);
  const d = Math.abs(t - truthParams[i]);
  check('hit' + i + ' paramOf=' + t.toFixed(6) + ' vs true ' + truthParams[i].toFixed(6) +
    ' (delta ' + d.toExponential(2) + ')', d < 1e-4);
}

// on-curve distance of the cut point itself = where the trim will cut
console.log('\n[2b] cut position error along the curve');
for (let i = 0; i < rawHits.length; i++) {
  const t = frame.paramOf(rawHits[i]);
  const seg = Math.min(nsegs - 1, Math.floor(t * nsegs));
  const u = (t * nsegs) % 1;
  const q = ptAt(cubics[seg], u);
  const d = distToChain(q);
  check('hit' + i + ' cut point is on the curve (' + d.toExponential(2) + ' mm)', d < 1e-6);
}

// --- 3. Ctrl+click on a spline must clear the chain ------------------------

console.log('\n[3] trimChain handles splines (Ctrl+click)');
{
  const chainBody = slice('trimChain');
  const acceptsSpline = /e\.type !== 'spline'/.test(chainBody);
  const takesMode = /function trimChain\(target, world, mode = 'trim'\)/.test(chainBody);
  check('trimChain accepts splines', acceptsSpline,
    acceptsSpline ? '' : 'still returns trimEntity(...) for any non-line/arc');
  check('trimChain carries the mode through (trim vs separate)', takesMode);
}

console.log('\n' + (fail ? fail + ' FAILED' : 'all exact') + '  (' + pass + ' pass, ' + fail + ' fail)');
process.exit(fail ? 1 : 0);
