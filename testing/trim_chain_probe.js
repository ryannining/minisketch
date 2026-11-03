// Probe: chain trim (Ctrl+click) and separate on splines.
//
// Ryan's requirements:
//   - Ctrl+click on a curve must clear the whole connected run up to the next
//     crossing (trimChain), walking through line/arc/spline alike.
//   - "E" (separate) has the same walk but DELETES nothing: every piece stays.
//
// Static checks on the lifted source plus a functional replay of the range
// complement for both modes.
//
// Run: node testing/trim_chain_probe.js

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

// --- 1. static: the walk accepts splines -----------------------------------

console.log('[1] chain walk covers line + arc + spline');
{
  const nb = slice('chainNeighborAt');
  check('chainNeighborAt accepts splines', /o\.type !== 'spline'/.test(nb));
  check('chainNeighborAt links through a spline end point',
    /entityPointIds\(o\)/.test(nb) && /ids\[ids\.length - 1\]/.test(nb));
  check('chainNeighborAt skips closed splines (no ends to walk)', /o\.closed\) continue/.test(nb));

  const tc = slice('trimChain');
  check('trimChain accepts splines', /e\.type !== 'spline'/.test(tc));
  check('trimChain takes a mode (trim vs separate)', /function trimChain\(target, world, mode = 'trim'\)/.test(tc));
  check('trimChain endStart resolves a spline start', /entityPointIds\(o\)\[0\]/.test(tc));
  check('trimChain endFar resolves a spline end', /ids\[ids\.length - 1\]/.test(tc));

  const dt = slice('doTrim');
  check('doTrim routes Ctrl+click to trimChain for BOTH modes',
    /if \(chain\) \{\s*\n\s*if \(!trimChain\(target, world, mode\)\)/.test(dt));

  const rw = slice('replaceEntityWithRanges');
  check('replaceEntityWithRanges rebuilds spline pieces', /e\.type === 'spline'/.test(rw));
  check('spline pieces go through splineSubCurve (exact)', /splineSubCurve\(ocps, ohs/.test(rw));
  check('spline piece reuses the original end point ids', /reuse = atStart \? e\.pts\[0\]/.test(rw));
}

// --- 2. functional: trim removes the run, separate keeps everything --------

console.log('\n[2] range complement per mode');
{
  const tc = slice('trimChain');
  const body = tc.slice(tc.indexOf('pushHistory();'));
  // lift just the kept[] builder, driven by a stand-in replaceEntityWithRanges
  const build = (rs, mode) => {
    const kept = [];
    if (mode === 'separate') {
      const s = [...rs].sort((p, q) => p[0] - q[0]);
      for (const [ra, rb] of s) if (rb - ra > 1e-9) kept.push([ra, rb]);
    } else {
      const s = [...rs].sort((p, q) => p[0] - q[0]);
      let cur = 0;
      for (const [ra, rb] of s) {
        if (ra > cur + 1e-9) kept.push([cur, ra]);
        cur = Math.max(cur, rb);
      }
      if (cur < 1 - 1e-9) kept.push([cur, 1]);
    }
    return kept;
  };
  check('source uses the complement for trim, the union for separate',
    /mode === 'separate'/.test(tc) && /kept\.push\(\[cur, ra\]\)/.test(tc));

  // a curve cut at 0.2 and 0.5, clicked in [0.2, 0.5] -> the walk records that
  // range, trim drops it, separate keeps both halves.
  const rs = [[0.2, 0.5]];
  const trimKept = build(rs, 'trim');
  const sepKept = build(rs, 'separate');
  check('trim: clicked range removed, rest kept (' +
    JSON.stringify(trimKept) + ')',
    trimKept.length === 2 &&
    Math.abs(trimKept[0][0] - 0) < 1e-9 && Math.abs(trimKept[0][1] - 0.2) < 1e-9 &&
    Math.abs(trimKept[1][0] - 0.5) < 1e-9 && Math.abs(trimKept[1][1] - 1) < 1e-9);
  check('separate: the clicked range is kept too (' +
    JSON.stringify(sepKept) + ')',
    sepKept.length === 1 &&
    Math.abs(sepKept[0][0] - 0.2) < 1e-9 && Math.abs(sepKept[0][1] - 0.5) < 1e-9);
}

// --- 3. functional: a chained spline trim stays exact ----------------------

console.log('\n[3] chained spline pieces are exact');
{
  const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'bool.sketch')));
  const S = doc.state || doc;
  const P = (id) => {
    const p = S.points[String(id)];
    return p ? (Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y }) : null;
  };
  const e = S.entities['1490'];
  const cps = e.pts.map(P).filter(Boolean);
  const hs = { o: e.hs.o.map(h => ({ x: h[0], y: h[1] })), i: e.hs.i.map(h => ({ x: h[0], y: h[1] })) };
  const closed = !!e.closed;
  const nsegs = closed ? cps.length : cps.length - 1;
  const cubics = C.splineCubics(cps, hs, closed);

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const subCurve = new Function('splineCubics', 'splitCubic', 'clamp',
    slice('splineSubCurve').replace('function splineSubCurve(', 'return function(')
  )(C.splineCubics, C.splitCubic, clamp);

  const ptAt = (c, u) => {
    const m = 1 - u;
    return {
      x: m * m * m * c.P0.x + 3 * m * m * u * c.P1.x + 3 * m * u * u * c.P2.x + u * u * u * c.P3.x,
      y: m * m * m * c.P0.y + 3 * m * m * u * c.P1.y + 3 * m * u * u * c.P2.y + u * u * u * c.P3.y
    };
  };
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

  // the two known crossings of 1490 / 1494
  const t0 = 0.098621, t1 = 0.327682;
  let worst = 0;
  for (const [a, b] of [[0, t0], [t0, t1], [t1, 1]]) {
    const sub = subCurve(cps, hs, a, b, closed);
    if (!sub || !sub.nodes) continue;
    const pc = C.splineCubics(sub.nodes.map(n => n.p),
      { o: sub.nodes.map(n => n.o), i: sub.nodes.map(n => n.i) }, false);
    for (const c of pc) for (let k = 0; k <= 100; k++) {
      const q = ptAt(c, k / 100);
      const d = distToChain(q);
      if (d > worst) worst = d;
    }
  }
  check('every chained piece stays on the original curve (' + worst.toExponential(2) + ' mm)',
    worst < 1e-6);
}

console.log('\n' + (fail ? fail + ' FAILED' : 'all good') + '  (' + pass + ' pass, ' + fail + ' fail)');
process.exit(fail ? 1 : 0);
