// MiniSketch core — pure math and geometry. No DOM, no app state.
//
// Loaded before app.js as a plain <script> (works from file://, no build step).
// Everything here must stay dependency-free and stateless so tests/smoke.js can
// run it under Node; see ARCHITECTURE.md for what belongs in this file.
'use strict';

const TAU = Math.PI * 2;

// Curve sampling density. These live here because the pure spline code reads
// them; the Settings dialog in app.js assigns them on apply.
var SPLINE_SEG = 12;
var ARC_SEG = 72;

// --- scalar helpers ----------------------------------------------------------
function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function dist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function norm2pi(a) {
  a %= TAU;
  return a < 0 ? a + TAU : a;
}

function wrapPi(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

function wrapDeg(d) {
  d = (d + 540) % 360;
  if (d < 0) d += 360;
  return d - 180;
}

// Degrees into (-180, 180]. app.js used to carry a second, shadowed normDeg
// that folded into (0, 180]; the wrap below is the one that actually ran.
function normDeg(d) {
  d = d % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

// --- matrices ----------------------------------------------------------------
// [a, b, c, d, e, f]:  x' = a*x + c*y + e ,  y' = b*x + d*y + f
const MAT_ID = [1, 0, 0, 1, 0, 0];

function matMul(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5]
  ];
}

// `out` is an optional buffer to write into (partMarkerWorld/solveAssembly reuse
// a scratch object to avoid per-call allocation in the hot residue loop).
function matApply(m, pt, out) {
  const o = out || {};
  o.x = m[0] * pt.x + m[2] * pt.y + m[4];
  o.y = m[1] * pt.x + m[3] * pt.y + m[5];
  return o;
}

function matDet(m) { return m[0] * m[3] - m[1] * m[2]; }

// Is this transform a rotation + uniform scale (+ mirror + translate)?
function matIsSimilarity(m, eps) {
  const e = eps == null ? 1e-9 : eps;
  const sx = Math.hypot(m[0], m[1]);
  const sy = Math.hypot(m[2], m[3]);
  if (!(sx > e) || !(sy > e)) return false;
  if (Math.abs(sx - sy) > e * Math.max(sx, sy)) return false;
  const dot = m[0] * m[2] + m[1] * m[3];
  return Math.abs(dot) <= e * sx * sy;
}

function parseTransformList(str) {
  let m = MAT_ID;
  if (!str) return m;
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let g;
  while ((g = re.exec(str))) {
    const name = g[1].toLowerCase();
    const nums = g[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let t = MAT_ID;
    if (name === 'matrix' && nums.length === 6) t = nums;
    else if (name === 'translate' && nums.length >= 1) t = [1, 0, 0, 1, nums[0], nums[1] || 0];
    else if (name === 'scale' && nums.length >= 1) t = [nums[0], 0, 0, nums.length > 1 ? nums[1] : nums[0], 0, 0];
    else if (name === 'rotate' && nums.length >= 1) {
      const a = nums[0] * Math.PI / 180;
      const cos = Math.cos(a), sin = Math.sin(a);
      const rot = [cos, sin, -sin, cos, 0, 0];
      if (nums.length === 3) {
        // rotate about a point
        t = matMul(matMul([1, 0, 0, 1, nums[1], nums[2]], rot), [1, 0, 0, 1, -nums[1], -nums[2]]);
      } else t = rot;
    } else if (name === 'skewx' && nums.length === 1) t = [1, 0, Math.tan(nums[0] * Math.PI / 180), 1, 0, 0];
    else if (name === 'skewy' && nums.length === 1) t = [1, Math.tan(nums[0] * Math.PI / 180), 0, 1, 0, 0];
    m = matMul(m, t);
  }
  return m;
}

// --- SVG path data -----------------------------------------------------------
function svgArcToCubics(x0, y0, rx, ry, phiDeg, largeArc, sweep, x1, y1) {
  // SVG endpoint parameterisation -> centre, then four-or-fewer cubic pieces.
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (rx < 1e-12 || ry < 1e-12) return [{ t: 'L', p: { x: x1, y: y1 } }];
  const phi = phiDeg * Math.PI / 180;
  const cosP = Math.cos(phi), sinP = Math.sin(phi);
  const dx2 = (x0 - x1) / 2, dy2 = (y0 - y1) / 2;
  const x1p = cosP * dx2 + sinP * dy2;
  const y1p = -sinP * dx2 + cosP * dy2;
  let rx2 = rx * rx, ry2 = ry * ry;
  const lambda = (x1p * x1p) / rx2 + (y1p * y1p) / ry2;
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s; ry *= s;
    rx2 = rx * rx; ry2 = ry * ry;
  }
  const num = rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p;
  const den = rx2 * y1p * y1p + ry2 * x1p * x1p;
  let coef = den === 0 ? 0 : Math.sqrt(Math.max(0, num / den));
  if (largeArc === sweep) coef = -coef;
  const cxp = coef * (rx * y1p) / ry;
  const cyp = coef * -(ry * x1p) / rx;
  const cx = cosP * cxp - sinP * cyp + (x0 + x1) / 2;
  const cy = sinP * cxp + cosP * cyp + (y0 + y1) / 2;
  const angle = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.max(-1, Math.min(1, dot / (len || 1))));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const ux = (x1p - cxp) / rx, uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx, vy = (-y1p - cyp) / ry;
  const theta1 = angle(1, 0, ux, uy);
  let dTheta = angle(ux, uy, vx, vy);
  if (!sweep && dTheta > 0) dTheta -= Math.PI * 2;
  if (sweep && dTheta < 0) dTheta += Math.PI * 2;

  const segs = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2) - 1e-9));
  const step = dTheta / segs;
  const k = (4 / 3) * Math.tan(step / 4);
  const out = [];
  let th = theta1;
  let px = x0, py = y0;
  for (let i = 0; i < segs; i++) {
    const th2 = th + step;
    const cos1 = Math.cos(th), sin1 = Math.sin(th);
    const cos2 = Math.cos(th2), sin2 = Math.sin(th2);
    const map = (ex, ey) => ({
      x: cosP * rx * ex - sinP * ry * ey + cx,
      y: sinP * rx * ex + cosP * ry * ey + cy
    });
    const p1 = map(cos1 - k * sin1, sin1 + k * cos1);
    const p2 = map(cos2 + k * sin2, sin2 - k * cos2);
    const p3 = map(cos2, sin2);
    out.push({ t: 'C', c1: p1, c2: p2, p: p3, from: { x: px, y: py } });
    px = p3.x; py = p3.y;
    th = th2;
  }
  return out;
}

// Absolute segments in local coordinates: L {p}, C {c1,c2,p}, Z {}.
function svgPathSegments(d) {
  const toks = String(d || '').match(/[a-zA-Z]|-?[\d.]+(?:e[-+]?\d+)?/g) || [];
  const out = [];
  let i = 0;
  let cur = { x: 0, y: 0 };
  let start = { x: 0, y: 0 };
  let lastCtrl = null;
  let cmd = null;
  const num = () => parseFloat(toks[i++]);
  const isCmd = (t) => /^[a-zA-Z]$/.test(t);
  while (i < toks.length) {
    if (isCmd(toks[i])) { cmd = toks[i++]; }
    else if (cmd == null) { i++; continue; }
    const rel = cmd === cmd.toLowerCase();
    const c = cmd.toUpperCase();
    if (c === 'Z') {
      if (cur.x !== start.x || cur.y !== start.y) out.push({ t: 'L', p: { x: start.x, y: start.y } });
      out.push({ t: 'Z' });
      cur = { x: start.x, y: start.y };
      lastCtrl = null;
      continue;
    }
    if (c === 'M') {
      const x = num(), y = num();
      cur = rel ? { x: cur.x + x, y: cur.y + y } : { x, y };
      start = { x: cur.x, y: cur.y };
      out.push({ t: 'M', p: { x: cur.x, y: cur.y } });
      lastCtrl = null;
      cmd = rel ? 'l' : 'L';                 // implicit lineto after moveto
      continue;
    }
    if (c === 'L') {
      const x = num(), y = num();
      cur = rel ? { x: cur.x + x, y: cur.y + y } : { x, y };
      out.push({ t: 'L', p: { x: cur.x, y: cur.y } });
      lastCtrl = null;
      continue;
    }
    if (c === 'H') {
      const x = num();
      cur = { x: rel ? cur.x + x : x, y: cur.y };
      out.push({ t: 'L', p: { x: cur.x, y: cur.y } });
      lastCtrl = null;
      continue;
    }
    if (c === 'V') {
      const y = num();
      cur = { x: cur.x, y: rel ? cur.y + y : y };
      out.push({ t: 'L', p: { x: cur.x, y: cur.y } });
      lastCtrl = null;
      continue;
    }
    if (c === 'C' || c === 'S') {
      let c1, c2, p;
      if (c === 'C') {
        const x1 = num(), y1 = num(), x2 = num(), y2 = num(), x = num(), y = num();
        c1 = rel ? { x: cur.x + x1, y: cur.y + y1 } : { x: x1, y: y1 };
        c2 = rel ? { x: cur.x + x2, y: cur.y + y2 } : { x: x2, y: y2 };
        p = rel ? { x: cur.x + x, y: cur.y + y } : { x, y };
      } else {
        const x2 = num(), y2 = num(), x = num(), y = num();
        c1 = lastCtrl ? { x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y } : { x: cur.x, y: cur.y };
        c2 = rel ? { x: cur.x + x2, y: cur.y + y2 } : { x: x2, y: y2 };
        p = rel ? { x: cur.x + x, y: cur.y + y } : { x, y };
      }
      out.push({ t: 'C', from: { x: cur.x, y: cur.y }, c1, c2, p });
      lastCtrl = c2;
      cur = p;
      continue;
    }
    if (c === 'Q' || c === 'T') {
      let q1, p;
      if (c === 'Q') {
        const x1 = num(), y1 = num(), x = num(), y = num();
        q1 = rel ? { x: cur.x + x1, y: cur.y + y1 } : { x: x1, y: y1 };
        p = rel ? { x: cur.x + x, y: cur.y + y } : { x, y };
      } else {
        const x = num(), y = num();
        q1 = lastCtrl ? { x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y } : { x: cur.x, y: cur.y };
        p = rel ? { x: cur.x + x, y: cur.y + y } : { x, y };
      }
      // quadratic -> cubic
      const c1 = { x: cur.x + (2 / 3) * (q1.x - cur.x), y: cur.y + (2 / 3) * (q1.y - cur.y) };
      const c2 = { x: p.x + (2 / 3) * (q1.x - p.x), y: p.y + (2 / 3) * (q1.y - p.y) };
      out.push({ t: 'C', from: { x: cur.x, y: cur.y }, c1, c2, p });
      lastCtrl = q1;
      cur = p;
      continue;
    }
    if (c === 'A') {
      const rx = num(), ry = num(), rot = num(), large = num(), sweep = num(), x = num(), y = num();
      const p = rel ? { x: cur.x + x, y: cur.y + y } : { x, y };
      const pieces = svgArcToCubics(cur.x, cur.y, rx, ry, rot, !!large, !!sweep, p.x, p.y);
      for (const s of pieces) out.push(s);
      cur = p;
      lastCtrl = null;
      continue;
    }
    i++;                                    // unknown token
  }
  return out;
}

// Segments -> subpaths of nodes. A node keeps its incoming/outgoing handles so
// the curve can become a real spline entity instead of a polyline.
function svgSegmentsToSubpaths(segs, ctm) {
  const map = (p) => matApply(ctm || MAT_ID, p);
  const subs = [];
  let nodes = [];
  let closed = false;
  let moved = true;
  const flush = () => {
    if (nodes.length >= 2) subs.push({ nodes, closed });
    nodes = [];
    closed = false;
  };
  for (const s of segs) {
    if (s.t === 'M') {
      flush();
      nodes = [{ ...map(s.p), i: null, o: null }];
      moved = true;
      continue;
    }
    if (s.t === 'Z') {
      closed = true;
      flush();
      continue;
    }
    if (!nodes.length) nodes = [{ ...map(s.from || s.p), i: null, o: null }];
    if (s.t === 'L') {
      nodes.push({ ...map(s.p), i: null, o: null });
      continue;
    }
    if (s.t === 'C') {
      const last = nodes[nodes.length - 1];
      last.o = map(s.c1);
      nodes.push({ ...map(s.p), i: map(s.c2), o: null });
    }
  }
  flush();
  for (const sub of subs) {
    // a closed subpath repeats its first node
    if (sub.closed && sub.nodes.length > 2) {
      const a = sub.nodes[0], b = sub.nodes[sub.nodes.length - 1];
      if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-9) {
        a.i = b.i || a.i;
        sub.nodes.pop();
      }
    }
    sub.curved = sub.nodes.some(n => n.i || n.o);
  }
  return subs;
}

// --- cubic curves ------------------------------------------------------------
function cubicAt(P0, P1, P2, P3, t) {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * P0.x + b * P1.x + c * P2.x + d * P3.x,
    y: a * P0.y + b * P1.y + c * P2.y + d * P3.y
  };
}

function splitCubic(P0, P1, P2, P3, t) {
  const lerp = (a, b) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const p01 = lerp(P0, P1);
  const p12 = lerp(P1, P2);
  const p23 = lerp(P2, P3);
  const p012 = lerp(p01, p12);
  const p123 = lerp(p12, p23);
  const S = lerp(p012, p123);
  return {
    S,
    left: { o: p01, i: p012 },
    right: { o: p123, i: p23 }
  };
}

function autoHandles(cps, closed) {
  const n = cps.length;
  const loop = !!closed && n >= 3;
  const o = [];
  const i = [];
  for (let k = 0; k < n; k++) {
    let tx, ty;
    if (loop) {
      const prev = cps[(k - 1 + n) % n];
      const next = cps[(k + 1) % n];
      tx = (next.x - prev.x) / 6;
      ty = (next.y - prev.y) / 6;
    } else if (n === 2) {
      tx = (cps[1].x - cps[0].x) / 3;
      ty = (cps[1].y - cps[0].y) / 3;
    } else if (k === 0) {
      tx = (cps[1].x - cps[0].x) / 3;
      ty = (cps[1].y - cps[0].y) / 3;
    } else if (k === n - 1) {
      tx = (cps[n - 1].x - cps[n - 2].x) / 3;
      ty = (cps[n - 1].y - cps[n - 2].y) / 3;
    } else {
      tx = (cps[k + 1].x - cps[k - 1].x) / 6;
      ty = (cps[k + 1].y - cps[k - 1].y) / 6;
    }
    o.push({ x: cps[k].x + tx, y: cps[k].y + ty });
    i.push({ x: cps[k].x - tx, y: cps[k].y - ty });
  }
  return { o, i };
}

// The one drawing primitive every curve goes through. Contracts learned the
// hard way:
//  - a closed pair of nodes is a real loop (an SVG circle written as two
//    Beziers imports as exactly that), so the wrap segment needs nsegs = n;
//  - a missing handle is a corner (straight line segments import that way):
//    fall back to the node itself instead of dropping the whole segment.
function splineSamples(cps, has, closed) {
  cps = (cps || []).filter(Boolean);
  if (cps.length < 2) return [];
  const loop = !!closed && cps.length >= 2;
  let hs = has;
  if (!hs || hs.o.length !== cps.length || hs.i.length !== cps.length) hs = autoHandles(cps, loop);
  const out = [];
  const n = cps.length;
  const nsegs = loop ? n : n - 1;
  for (let s = 0; s < nsegs; s++) {
    const P0 = cps[s];
    const j = loop ? (s + 1) % n : s + 1;
    const P3 = cps[j];
    const P1 = hs.o[s] || P0;
    const P2 = hs.i[j] || P3;
    for (let k = 0; k < SPLINE_SEG; k++) {
      out.push(cubicAt(P0, P1, P2, P3, k / SPLINE_SEG));
    }
  }
  out.push(loop ? { x: cps[0].x, y: cps[0].y } : { x: cps[n - 1].x, y: cps[n - 1].y });
  return out;
}

function splineFrame(cps, has, closed) {
  cps = (cps || []).filter(Boolean);
  if (cps.length < 2) return null;
  const loop = !!closed && cps.length >= 2;
  let hs = has;
  if (!hs || hs.o.length !== cps.length || hs.i.length !== cps.length) hs = autoHandles(cps, loop);
  const n = cps.length;
  const nsegs = loop ? n : n - 1;
  const samples = splineSamples(cps, hs, loop);
  // splineSamples() emits SPLINE_SEG samples per span and one closing point, so
  // the divisor has to come from the samples themselves. It used to be the
  // literal 12, which silently assumed the default setting: with any other
  // "Curve segments per span" the sample index was divided by the wrong number
  // and a click on one span reported a completely different one.
  const per = Math.max(1, Math.round((samples.length - 1) / nsegs));
  const paramOf = pt => {
    // Which span, and where inside it? Picking the nearest SAMPLE and taking
    // its span is wrong near a node: a hit at u=0.983 of span 0 sits closer
    // to span 1's u=0 sample than to span 0's last sample (u=0.917), so the
    // old code answered span 1 / 0.3333 instead of span 0 / 0.3277. Resolve
    // per span instead: ternary-search the closest point on each cubic, keep
    // the best. nsegs is a handful, so this stays cheap.
    const cubicAtLocal = (segIdx, u) => {
      const j = loop ? (segIdx + 1) % n : segIdx + 1;
      const P0 = cps[segIdx];
      const P1 = hs.o[segIdx] || P0;
      const P2 = hs.i[j] || cps[j];
      return cubicAt(P0, P1, P2, cps[j], u);
    };
    const d2On = (segIdx, u) => {
      const q = cubicAtLocal(segIdx, u);
      const dx = q.x - pt.x, dy = q.y - pt.y;
      return dx * dx + dy * dy;
    };
    let bestSeg = 0, bestU = 0, bestD2 = Infinity;
    for (let s = 0; s < nsegs; s++) {
      let lo = 0, hi = 1;
      for (let it = 0; it < 60; it++) {
        const m1 = lo + (hi - lo) / 3;
        const m2 = hi - (hi - lo) / 3;
        if (d2On(s, m1) < d2On(s, m2)) hi = m2; else lo = m1;
      }
      const u = (lo + hi) / 2;
      const d = d2On(s, u);
      if (d < bestD2) { bestD2 = d; bestSeg = s; bestU = u; }
    }
    return (bestSeg + bestU) / nsegs;
  };
  const sampleAt = t => {
    const g = clamp(t, 0, 1) * nsegs;
    const segIdx = Math.min(nsegs - 1, Math.floor(g));
    const u = g - segIdx;
    const j = loop ? (segIdx + 1) % n : segIdx + 1;
    const P0 = cps[segIdx];
    const P1 = hs.o[segIdx] || P0;
    const P2 = hs.i[j] || cps[j];
    return cubicAt(P0, P1, P2, cps[j], u);
  };
  return { samples, nsegs, paramOf, sampleAt };
}

function splineCubics(cps, hs, closed) {
  const loop = !!closed && cps.length >= 2;
  const n = cps.length;
  const nsegs = loop ? n : n - 1;
  const out = [];
  for (let s = 0; s < nsegs; s++) {
    const j = loop ? (s + 1) % n : s + 1;
    out.push({
      P0: cps[s],
      P1: hs.o[s] || cps[s],
      P2: hs.i[j] || cps[j],
      P3: cps[j]
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tolerance-driven flattening. Every consumer that hands geometry to a machine
// (KaryaCNC, DXF/SVG export) needs ONE point density for the same shape, no
// matter how the shape is stored: a circle entity, a curve made by Ctrl+K, a
// grouped contour, or a traced outline. Each of those used to sample by its own
// rule, so three copies of one Ø6 circle reached the machine with three
// different point counts.
//
// The rule is the chord sagitta. A curve that stands `d` away from its chord at
// n = 1 stands about d / n² away once split into n equal pieces, so
// n = ceil(sqrt(d / tol)) is the fewest evenly spaced samples inside the
// tolerance. That is also exactly the rule an arc follows (d = r(1 - cos(θ/2))),
// which is why a circle and a curve that follows the same circle come out with
// the same number of points.
// ---------------------------------------------------------------------------
function flattenCubic(P0, P1, P2, P3, tol, out, depth) {
  const t = isFinite(+tol) && +tol > 0 ? +tol : 0.05;
  const sink = out || [];
  const chordDev = () => {
    const dx = P3.x - P0.x, dy = P3.y - P0.y;
    const len = Math.hypot(dx, dy);
    let worst = 0;
    for (let i = 1; i < 16; i++) {
      const p = cubicAt(P0, P1, P2, P3, i / 16);
      const d = len < 1e-12
        ? Math.hypot(p.x - P0.x, p.y - P0.y)
        : Math.abs(dx * (p.y - P0.y) - dy * (p.x - P0.x)) / len;
      if (d > worst) worst = d;
    }
    return worst;
  };
  const dev = chordDev();
  let n = dev <= t ? 1 : Math.ceil(Math.sqrt(dev / t));
  n = Math.max(1, Math.min(512, n));
  // the estimate is asymptotic: walk up until the sampled error really fits
  const errOf = (count) => {
    let worst = 0;
    for (let i = 0; i < count; i++) {
      const a = cubicAt(P0, P1, P2, P3, i / count);
      const b = cubicAt(P0, P1, P2, P3, (i + 1) / count);
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      for (const u of [0.25, 0.5, 0.75]) {
        const p = cubicAt(P0, P1, P2, P3, (i + u) / count);
        const d = len < 1e-12
          ? Math.hypot(p.x - a.x, p.y - a.y)
          : Math.abs(dx * (p.y - a.y) - dy * (p.x - a.x)) / len;
        if (d > worst) worst = d;
      }
    }
    return worst;
  };
  // The sampled error falls monotonically as the segment count rises, so walk up
  // by doubling and then binary-search the boundary instead of testing n, n+1,
  // n+2 ... Every errOf(n) is O(n), so the old linear bump cost O(n²) per cubic
  // — on a tight tolerance that was ~500k cubicAt calls and an allocation per
  // sample. Same answer, a fraction of the evaluations.
  if (n < 512 && errOf(n) > t) {
    let lo = n, hi = 512;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (errOf(mid) > t) lo = mid + 1; else hi = mid;
    }
    n = lo;
  }
  if (n < 1) n = 1;
  for (let i = 1; i <= n; i++) sink.push(cubicAt(P0, P1, P2, P3, i / n));
  return sink;
}
// Flatten a whole spline: the node list plus one point per sampled span.
// `closed` repeats the first point at the end, which is what the machine format
// and every polyline consumer expect.
function flattenSpline(cps, hs, closed, tol) {
  const pts = (cps || []).filter(Boolean).map(p => ({ x: p.x, y: p.y }));
  if (pts.length < 2) return pts;
  const loop = !!closed && pts.length >= 2;
  const n = pts.length;
  const nsegs = loop ? n : n - 1;
  const out = [{ x: pts[0].x, y: pts[0].y }];
  const handles = hs || { o: [], i: [] };
  for (let s = 0; s < nsegs; s++) {
    const j = loop ? (s + 1) % n : s + 1;
    const P0 = pts[s];
    const P3 = pts[j];
    const P1 = (handles.o && handles.o[s]) || P0;
    const P2 = (handles.i && handles.i[j]) || P3;
    flattenCubic(P0, P1, P2, P3, tol, out, 0);
  }
  if (loop && out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (Math.abs(a.x - b.x) > 1e-12 || Math.abs(a.y - b.y) > 1e-12) out.push({ x: a.x, y: a.y });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Curve fitting: a dense polyline -> as few cubic Beziers as the tolerance
// allows. This is Schneider's "An Algorithm for Automatically Fitting Digitized
// Curves" (Graphics Gems, 1990), the same method Inkscape, Paper.js and potrace
// use, so a traced outline can end up with a handful of nodes instead of
// hundreds of straight ones.
//
// Sharp corners are the part that matters for CAD: a corner must survive as a
// corner (the two runs either side get their own tangents, taken from the
// polyline itself), never get rounded off by a curve that happens to fit both
// sides. fitPolylineCurve() splits the input at those corners and fits each run
// on its own.
// ---------------------------------------------------------------------------

function curveUnit(v) {
  const l = Math.hypot(v.x, v.y);
  return l > 1e-12 ? { x: v.x / l, y: v.y / l } : null;
}

// Drop consecutive duplicates: a zero-length step would break the tangents and
// the chord-length parameterisation.
function curveClean(pts) {
  const out = [];
  for (const p of pts || []) {
    if (!p || !isFinite(p.x) || !isFinite(p.y)) continue;
    const last = out[out.length - 1];
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < 1e-9) continue;
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

// Mean distance between consecutive points: the test for "this is a dense
// trace" rather than a polyline someone drew point by point.
function avgSpacing(pts, closed) {
  const n = pts.length;
  if (n < 2) return 0;
  let total = 0;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total / last;
}

// Moving average over a closed or open run. A traced outline wobbles by a
// fraction of its point spacing (marching squares lands on the 50% iso line, so
// the error is sub-pixel but the DIRECTION between two neighbours swings by tens
// of degrees). Schneider's fitter follows that wobble point for point and
// returns hundreds of nodes, which is why a converted glyph looked like a
// polyline. Averaging a few neighbours first removes the direction noise while
// leaving the shape within a fraction of a pixel.
function curveSmooth(pts, radius, closed) {
  const n = pts.length;
  const k = Math.floor(radius);
  if (!(k > 0) || n < 3) return pts;
  const out = [];
  for (let i = 0; i < n; i++) {
    let sx = 0, sy = 0, c = 0;
    for (let d = -k; d <= k; d++) {
      const j = i + d;
      if (!closed && (j < 0 || j >= n)) continue;
      const p = pts[((j % n) + n) % n];
      sx += p.x; sy += p.y; c++;
    }
    out.push({ x: sx / c, y: sy / c });
  }
  return out;
}

// Re-space the points by arc length. Even spacing is what makes the chord-length
// parameterisation and the tangents well conditioned; a dense trace leaves
// points bunched in the flat parts of a curve.
function curveResample(pts, step, closed) {
  const n = pts.length;
  if (!(step > 0) || n < 2) return pts;
  const out = [{ x: pts[0].x, y: pts[0].y }];
  let carry = 0;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d < 1e-12) continue;
    let t = step - carry;
    while (t <= d) {
      out.push({ x: a.x + (b.x - a.x) * t / d, y: a.y + (b.y - a.y) * t / d });
      t += step;
    }
    carry = d - (t - step);
  }
  if (!closed) {
    const end = pts[n - 1];
    const tail = out[out.length - 1];
    if (!tail || Math.hypot(tail.x - end.x, tail.y - end.y) > step * 0.35) out.push({ x: end.x, y: end.y });
  }
  return out.length >= 2 ? out : pts;
}

// Least-squares fit of one cubic to pts[first..last] with fixed end tangents.
// Returns the four control points; a degenerate normal equation falls back to
// the Wu/Barsky heuristic (thirds of the chord).
function curveBezierFor(pts, first, last, u, t1, t2) {
  const P0 = pts[first];
  const P3 = pts[last];
  const B0 = (t) => { const m = 1 - t; return m * m * m; };
  const B1 = (t) => { const m = 1 - t; return 3 * m * m * t; };
  const B2 = (t) => { const m = 1 - t; return 3 * m * t * t; };
  const B3 = (t) => t * t * t;
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = first; i <= last; i++) {
    const t = u[i - first];
    const a0 = { x: t1.x * B1(t), y: t1.y * B1(t) };
    const a1 = { x: t2.x * B2(t), y: t2.y * B2(t) };
    c00 += a0.x * a0.x + a0.y * a0.y;
    c01 += a0.x * a1.x + a0.y * a1.y;
    c11 += a1.x * a1.x + a1.y * a1.y;
    const tmp = {
      x: pts[i].x - (P0.x * (B0(t) + B1(t)) + P3.x * (B2(t) + B3(t))),
      y: pts[i].y - (P0.y * (B0(t) + B1(t)) + P3.y * (B2(t) + B3(t)))
    };
    x0 += a0.x * tmp.x + a0.y * tmp.y;
    x1 += a1.x * tmp.x + a1.y * tmp.y;
  }
  // Normal equations of Schneider's GenerateBezier: alphaL = det_X_C1 / det_C,
  // alphaR = det_C0_X / det_C (both with the same determinant). Note the sign of
  // the second numerator — negating it silently degrades every fit to the
  // chord/3 heuristic, which then needs twice the segments.
  const detC = c00 * c11 - c01 * c01;
  const detX_C1 = x0 * c11 - x1 * c01;
  const det_C0_X = c00 * x1 - c01 * x0;
  let alphaL = Math.abs(detC) > 1e-12 ? detX_C1 / detC : 0;
  let alphaR = Math.abs(detC) > 1e-12 ? det_C0_X / detC : 0;
  const segLen = Math.hypot(P3.x - P0.x, P3.y - P0.y);
  const eps = 1e-6 * Math.max(segLen, 1e-9);
  if (!(alphaL > eps) || !(alphaR > eps)) {
    const third = segLen / 3;
    return {
      P0, P3,
      P1: { x: P0.x + t1.x * third, y: P0.y + t1.y * third },
      P2: { x: P3.x + t2.x * third, y: P3.y + t2.y * third }
    };
  }
  // A handle running far past the chord means the fit is diverging; clamp so a
  // bad least-squares step cannot invent a wild loop.
  const cap = segLen * 1.5;
  if (alphaL > cap) alphaL = cap;
  if (alphaR > cap) alphaR = cap;
  return {
    P0, P3,
    P1: { x: P0.x + t1.x * alphaL, y: P0.y + t1.y * alphaL },
    P2: { x: P3.x + t2.x * alphaR, y: P3.y + t2.y * alphaR }
  };
}

function curveChordParams(pts, first, last) {
  const u = [0];
  let total = 0;
  for (let i = first + 1; i <= last; i++) {
    total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    u.push(total);
  }
  if (!(total > 1e-12)) return u.map(() => 0);
  for (let i = 0; i < u.length; i++) u[i] /= total;
  u[u.length - 1] = 1;
  return u;
}

// Furthest point from the curve: its error and where to split if the fit fails.
function curveMaxError(pts, first, last, bez, u) {
  let maxErr = 0;
  let split = Math.floor((first + last) / 2);
  for (let i = first + 1; i < last; i++) {
    const p = cubicAt(bez.P0, bez.P1, bez.P2, bez.P3, u[i - first]);
    const d = Math.hypot(p.x - pts[i].x, p.y - pts[i].y);
    if (d >= maxErr) { maxErr = d; split = i; }
  }
  return { error: maxErr, split };
}

// One Newton-Raphson step per sample: re-parameterise so the points land closer
// to where the current curve actually is.
function curveReparam(pts, first, last, bez, u) {
  const next = u.slice();
  const dQ = (t) => {
    const m = 1 - t;
    const a = 3 * m * m, b = 6 * m * t, c = 3 * t * t;
    return {
      x: a * (bez.P1.x - bez.P0.x) + b * (bez.P2.x - bez.P1.x) + c * (bez.P3.x - bez.P2.x),
      y: a * (bez.P1.y - bez.P0.y) + b * (bez.P2.y - bez.P1.y) + c * (bez.P3.y - bez.P2.y)
    };
  };
  const d2Q = (t) => {
    const a = 6 * (1 - t), b = 6 * t;
    return {
      x: a * (bez.P2.x - 2 * bez.P1.x + bez.P0.x) + b * (bez.P3.x - 2 * bez.P2.x + bez.P1.x),
      y: a * (bez.P2.y - 2 * bez.P1.y + bez.P0.y) + b * (bez.P3.y - 2 * bez.P2.y + bez.P1.y)
    };
  };
  for (let i = first; i <= last; i++) {
    const idx = i - first;
    const t = u[idx];
    const q = cubicAt(bez.P0, bez.P1, bez.P2, bez.P3, t);
    const q1 = dQ(t), q2 = d2Q(t);
    const dx = q.x - pts[i].x, dy = q.y - pts[i].y;
    const num = dx * q1.x + dy * q1.y;
    const den = q1.x * q1.x + q1.y * q1.y + dx * q2.x + dy * q2.y;
    next[idx] = Math.abs(den) > 1e-12 ? clamp(t - num / den, 0, 1) : t;
  }
  next[0] = 0;
  next[next.length - 1] = 1;
  return next;
}

// Recursive fit of pts[first..last]; returns cubics in order.
function curveFitRun(pts, first, last, t1, t2, tol, depth, out) {
  if (last - first <= 1) {
    const third = Math.hypot(pts[last].x - pts[first].x, pts[last].y - pts[first].y) / 3;
    out.push({
      P0: pts[first], P3: pts[last],
      P1: { x: pts[first].x + t1.x * third, y: pts[first].y + t1.y * third },
      P2: { x: pts[last].x + t2.x * third, y: pts[last].y + t2.y * third }
    });
    return;
  }
  let u = curveChordParams(pts, first, last);
  let bez = curveBezierFor(pts, first, last, u, t1, t2);
  let { error, split } = curveMaxError(pts, first, last, bez, u);
  if (error < tol) {
    out.push(bez);
    return;
  }
  // Before splitting, let Newton refine the parameterisation: one better fit
  // costs far less than one more segment. (Schneider only does this while the
  // error is already tiny — tol squared — which splits far more often than a
  // CAD outline wants, especially when the input is a coarse polyline.)
  const maxIter = 10;
  let previous = error;
  for (let i = 0; i < maxIter && depth < 64; i++) {
    u = curveReparam(pts, first, last, bez, u);
    bez = curveBezierFor(pts, first, last, u, t1, t2);
    const res = curveMaxError(pts, first, last, bez, u);
    error = res.error;
    split = res.split;
    if (error < tol) {
      out.push(bez);
      return;
    }
    // Newton has stalled: splitting is the only way forward, so stop wasting
    // iterations on a fit that is not improving (long traced outlines pay for it)
    if (error > previous * 0.98) break;
    previous = error;
  }
  if (depth >= 64 || split <= first || split >= last) {
    out.push(bez);
    return;
  }
  // Split, and give each half the tangent the polyline actually has there so
  // the joint is smooth (the halves share the centre tangent).
  const centre = curveUnit({
    x: pts[split - 1].x - pts[split + 1].x,
    y: pts[split - 1].y - pts[split + 1].y
  }) || curveUnit({ x: pts[split].x - pts[split - 1].x, y: pts[split].y - pts[split - 1].y }) || { x: 1, y: 0 };
  curveFitRun(pts, first, split, t1, centre, tol, depth + 1, out);
  curveFitRun(pts, split, last, { x: -centre.x, y: -centre.y }, t2, tol, depth + 1, out);
}

// Is this run straight enough that a line is the honest answer? Keeps a
// polyline's straight edges as plain segments instead of a curve that merely
// approximates them.
function curveIsStraight(pts, first, last, tol) {
  const a = pts[first], b = pts[last];
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  for (let i = first + 1; i < last; i++) {
    const p = pts[i];
    const d = len < 1e-12
      ? Math.hypot(p.x - a.x, p.y - a.y)
      : Math.abs(dx * (p.y - a.y) - dy * (p.x - a.x)) / len;
    if (d > tol) return false;
  }
  return true;
}

// Straight stretches INSIDE a run. A run between two sharp corners is often
// "curve, straight, curve" — fitting it as one curve problem lets the least
// squares bow the straight part (a 21 mm straight edge came out visibly bent).
// So the straight pieces are found first and kept as plain chords, and only the
// curved pieces around them are fitted.
//
// Two conditions, and both are needed:
//   * every point within `tol` of the span's own chord (the obvious one), and
//   * the direction barely changes from the start of the span to its end.
// The second one is what makes it scale-aware. A densely sampled arc is within
// the tolerance of a 3 mm chord just as a real straight edge is, so the chord
// test alone chopped a smooth curve into "straight" pieces and erased its
// handles. Over the whole straight edge the net turn is ~0; over any real piece
// of an arc it is length / radius.
const CURVE_STRAIGHT_TURN = 3 * Math.PI / 180;
const CURVE_STRAIGHT_RATE = 0.35;

function curveStraightSpans(pts, first, last, tol, minLen) {
  // Signed turn at a vertex. Summing these over a span IS the direction change
  // across it (length / radius on an arc), and on a wobbling straight edge the
  // signs cancel.
  const turnAt = (v) => {
    const a = curveUnit({ x: pts[v].x - pts[v - 1].x, y: pts[v].y - pts[v - 1].y });
    const b = curveUnit({ x: pts[v + 1].x - pts[v].x, y: pts[v + 1].y - pts[v].y });
    if (!a || !b) return 0;
    return Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y);
  };

  // How much this run bends overall, per millimetre. An absolute angle limit is
  // not enough: on a very gentle arc a 4 mm piece turns by under 3 degrees and
  // would be taken for straight, chopping the curve into 26 handle-less nodes.
  // Against the run's own rate, a real straight edge (rate ~0) stands out and a
  // piece of the surrounding arc does not.
  let totalTurn = 0, totalLen = 0;
  for (let v = first + 1; v < last; v++) {
    totalTurn += Math.abs(turnAt(v));
    totalLen += Math.hypot(pts[v + 1].x - pts[v].x, pts[v + 1].y - pts[v].y);
  }
  const rateRef = totalLen > 1e-9 ? totalTurn / totalLen : 0;

  const spans = [];
  let i = first;
  while (i < last) {
    let end = -1;
    let acc = 0;
    let j = i + 2;
    while (j <= last && curveIsStraight(pts, i, j, tol)) {
      acc += turnAt(j - 1);
      const len = Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y);
      if (len >= minLen && Math.abs(acc) <= CURVE_STRAIGHT_TURN &&
        (rateRef <= 1e-9 || Math.abs(acc) / len <= CURVE_STRAIGHT_RATE * rateRef)) {
        end = j;
      }
      j++;
    }
    if (end > 0) {
      spans.push([i, end]);
      i = end;
    } else {
      i++;
    }
  }
  return spans;
}

// Turn angle at an interior vertex, in radians (0 = straight ahead).
function curveTurn(prev, at, next) {
  const a = curveUnit({ x: at.x - prev.x, y: at.y - prev.y });
  const b = curveUnit({ x: next.x - at.x, y: next.y - at.y });
  if (!a || !b) return 0;
  return Math.abs(Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y));
}

// Fit a polyline. Returns
//   { nodes: [{x, y, o, i}], closed, corners: [nodeIndex] }
// with `o`/`i` in absolute coordinates, or null for a corner / straight end.
// A node with a null handle on a side means the segment on that side is drawn as
// a straight chord, so straight stretches need no separate record.
// opts.tol         max deviation in drawing units (default 0.2)
// opts.sharpAngle  turn (degrees) at or above which a vertex stays a corner
//                  (default 25; 180 keeps none, 0 keeps all)
// opts.closed      treat the polyline as a loop
function fitPolylineCurve(input, opts) {
  const o = opts || {};
  const tol = isFinite(+o.tol) && +o.tol > 0 ? +o.tol : 0.2;
  const sharpDeg = isFinite(+o.sharpAngle) ? Math.max(0, Math.min(180, +o.sharpAngle)) : 25;
  const sharpRad = sharpDeg * Math.PI / 180;
  const closed = !!o.closed;

  let pts = curveClean(input);
  if (closed && pts.length > 2) {
    const a = pts[0], b = pts[pts.length - 1];
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-9) pts.pop();
  }
  // De-noise ONLY a run that is unmistakably a dense trace (see curveSmooth):
  // hundreds of points packed tighter than the tolerance. A hand-drawn or
  // already simplified polyline is left exactly as it is — smoothing would shave
  // its corners and the resample would move nodes off the geometry. Callers that
  // know the input is a trace (the glyph / picture outline path) can ask for it
  // with opts.denoise.
  const spacing = avgSpacing(pts, closed);
  const dense = o.denoise === true ? true
    : o.denoise === false ? false
      : (pts.length > 400 && spacing < tol * 2);
  if (dense) {
    // Smoothing must not move the shape more than the tolerance allows, or the
    // fit would honour `tol` on a curve that already drifted away from the
    // geometry. Try the widest window first and back off until the displacement
    // is inside half the tolerance (a dense trace has sub-tolerance noise, so a
    // window of a few points is enough to remove it).
    const before = pts;
    let radius = Math.max(1, Math.round(3 * tol / 0.2));
    let smoothed = before;
    while (radius > 0) {
      const cand = curveSmooth(before, radius, closed);
      let worst = 0;
      for (let i = 0; i < before.length; i++) {
        const d = Math.hypot(cand[i].x - before[i].x, cand[i].y - before[i].y);
        if (d > worst) worst = d;
      }
      if (worst <= tol * 0.5) { smoothed = cand; break; }
      radius = Math.floor(radius / 2);
    }
    pts = curveResample(smoothed, Math.max(0.05, tol * 1.5), closed);
  }
  const n = pts.length;
  if (n < 2) return null;

  // Every vertex is a corner: nothing to fit.
  if (sharpDeg <= 0) {
    const nodes = pts.map(p => ({ x: p.x, y: p.y, o: null, i: null }));
    return { nodes, closed, corners: nodes.map((_, i) => i) };
  }

  // Turn at a vertex, measured across a WINDOW instead of the two immediate
  // neighbours. A traced outline is dense and slightly wobbly: on 0.3 mm point
  // spacing a 0.05 mm wobble turns the next segment by tens of degrees, so the
  // one-step test called every vertex a corner and the whole glyph came back as
  // hundreds of handle-less nodes. Measuring the direction over a few points
  // each side makes the wobble cancel while a real corner still turns the path
  // by its true angle. A polyline with widely spaced points keeps the old
  // one-step test: its corners ARE the geometry.
  const reach = dense ? Math.max(2 * tol, 0) : 0;
  // Direction of travel AT vertex i: forwards it points away from i, backwards
  // it points INTO i (pts[i] - pts[j]), so both vectors describe the same
  // heading and a straight stretch turns by 0, not 180.
  const dirAt = (i, step) => {
    let j = i;
    let travelled = 0;
    for (let k = 0; k < 24; k++) {
      const next = j + step;
      if (closed) {
        if (travelled >= reach && k > 0) break;
        const prev = j;
        j = (next + n) % n;
        travelled += Math.hypot(pts[j].x - pts[prev].x, pts[j].y - pts[prev].y);
      } else {
        if (next < 0 || next >= n) break;
        if (travelled >= reach && k > 0) break;
        travelled += Math.hypot(pts[next].x - pts[j].x, pts[next].y - pts[j].y);
        j = next;
      }
    }
    if (j === i) return null;
    const dx = step < 0 ? pts[i].x - pts[j].x : pts[j].x - pts[i].x;
    const dy = step < 0 ? pts[i].y - pts[j].y : pts[j].y - pts[i].y;
    return curveUnit({ x: dx, y: dy });
  };
  const turnAt = (i) => {
    if (!closed && (i <= 0 || i >= n - 1)) return 0;
    const a = dirAt(i, -1);
    const b = dirAt(i, 1);
    if (!a || !b) return 0;
    return Math.abs(Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y));
  };
  let cornerIdx = [];
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) continue;
    if (turnAt(i) >= sharpRad) cornerIdx.push(i);
  }
  // Two corners closer than the reach are one corner (a traced tip can put
  // three vertices inside the same turn); keep the sharpest. The cap keeps a
  // coarse tolerance from merging the real corners of a short loop (a 4-node
  // rectangle must stay 4 nodes).
  if (cornerIdx.length > 1) {
    const near = Math.max(1, Math.min(
      Math.floor(n / 4),
      Math.ceil((reach || tol || 0.2) / Math.max(1e-9, avgSpacing(pts, closed)))));
    const kept = [];
    for (const i of cornerIdx) {
      // strict: a corner exactly `near` steps away is already a different
      // corner (a 4-node rectangle has near = 1 and must keep all four)
      if (kept.length && i - kept[kept.length - 1] < near) {
        if (turnAt(i) > turnAt(kept[kept.length - 1])) kept[kept.length - 1] = i;
        continue;
      }
      kept.push(i);
    }
    if (closed && kept.length > 1 && (n - kept[kept.length - 1]) + kept[0] < near) {
      if (turnAt(kept[0]) >= turnAt(kept[kept.length - 1])) kept.pop();
      else kept.shift();
    }
    cornerIdx = kept;
  }

  // A closed loop needs a seam. Put it on a corner when there is one, so no
  // fitted run straddles a corner; otherwise point 0 will do and the tangents
  // come from the wrap-around.
  if (closed && cornerIdx.length && cornerIdx[0] !== 0) {
    const rot = cornerIdx[0];
    pts = pts.slice(rot).concat(pts.slice(0, rot));
    cornerIdx = cornerIdx.map(i => (i - rot + n) % n).sort((a, b) => a - b);
  }

  // Runs between corners (or the whole thing when there are none).
  const spans = [];
  if (closed && cornerIdx.length) {
    for (let k = 0; k < cornerIdx.length; k++) {
      spans.push({
        from: cornerIdx[k],
        to: cornerIdx[(k + 1) % cornerIdx.length],
        wraps: k === cornerIdx.length - 1
      });
    }
  } else if (closed) {
    spans.push({ from: 0, to: 0, wraps: true });
  } else {
    const bounds = [0].concat(cornerIdx.filter(i => i > 0 && i < n - 1), [n - 1]);
    for (let k = 0; k + 1 < bounds.length; k++) spans.push({ from: bounds[k], to: bounds[k + 1], wraps: false });
  }

  const nodes = [];
  const corners = [];
  const addNode = (pt) => {
    const node = { x: pt.x, y: pt.y, o: null, i: null };
    nodes.push(node);
    return node;
  };
  const runPoints = (span) => {
    const list = [];
    if (span.wraps) {
      for (let i = span.from; i < n; i++) list.push(pts[i]);
      for (let i = 0; i <= span.to; i++) list.push(pts[i]);
    } else {
      for (let i = span.from; i <= span.to; i++) list.push(pts[i]);
    }
    return list;
  };

  addNode(pts[spans[0].from]);
  if (closed && cornerIdx.length) corners.push(0);

  for (const span of spans) {
    const list = runPoints(span);
    if (list.length < 2) continue;
    const last = list.length - 1;
    let startNode = nodes[nodes.length - 1];
    const atCorner = !span.wraps && cornerIdx.indexOf(span.to) >= 0;

    // Break the run into straight and curved pieces. A run that is straight from
    // end to end is the common case and needs no splitting.
    const straightSpans = curveIsStraight(list, 0, last, tol)
      ? [[0, last]]
      : curveStraightSpans(list, 0, last, tol, Math.max(12 * tol, 4));
    const pieces = [];
    let cursor = 0;
    for (const [a, b] of straightSpans) {
      if (a > cursor) pieces.push({ kind: 'curve', from: cursor, to: a });
      pieces.push({ kind: 'straight', from: a, to: b });
      cursor = b;
    }
    if (cursor < last || !pieces.length) pieces.push({ kind: 'curve', from: cursor, to: last });

    for (let pi = 0; pi < pieces.length; pi++) {
      const piece = pieces[pi];
      const isLastPiece = pi === pieces.length - 1;
      if (piece.to <= piece.from) continue;

      if (piece.kind === 'straight') {
        // A chord, not a curve: both facing handles stay null, so the renderer
        // draws the exact straight segment. The handle on the far side keeps
        // whatever the neighbouring curve put there, so the join stays smooth.
        let endNode;
        if (isLastPiece && span.wraps) endNode = nodes[0];
        else endNode = addNode(list[piece.to]);
        if (startNode === endNode) continue;
        startNode.o = null;
        endNode.i = null;
        startNode = endNode;
        continue;
      }

      const plist = [];
      for (let i = piece.from; i <= piece.to; i++) plist.push(list[i]);
      const pl = plist.length - 1;
      if (pl < 1) continue;
      if (pl === 1) {
        // two points and no straight-span rule fired: still just a chord
        let endNode;
        if (isLastPiece && span.wraps) endNode = nodes[0];
        else endNode = addNode(plist[1]);
        if (startNode === endNode) continue;
        startNode.o = null;
        endNode.i = null;
        startNode = endNode;
        continue;
      }
      const t1 = curveUnit({ x: plist[1].x - plist[0].x, y: plist[1].y - plist[0].y }) || { x: 1, y: 0 };
      const t2 = curveUnit({ x: plist[pl - 1].x - plist[pl].x, y: plist[pl - 1].y - plist[pl].y }) || { x: -1, y: 0 };
      const cubics = [];
      curveFitRun(plist, 0, pl, t1, t2, tol, 0, cubics);

      for (let k = 0; k < cubics.length; k++) {
        const c = cubics[k];
        const isLastCubic = k === cubics.length - 1;
        let endNode;
        if (isLastCubic && isLastPiece && span.wraps) endNode = nodes[0];
        else endNode = addNode(isLastCubic ? plist[pl] : c.P3);
        startNode.o = { x: c.P1.x, y: c.P1.y };
        endNode.i = { x: c.P2.x, y: c.P2.y };
        if (startNode === endNode) break;    // a closed run that fits in one cubic
        startNode = endNode;                 // the next cubic leaves from here
      }
    }
    if (atCorner) corners.push(nodes.length - 1);
  }

  if (nodes.length < 2) return null;
  const uniq = Array.from(new Set(corners)).sort((a, b) => a - b);
  return { nodes, closed, corners: uniq };
}

function sampleArc(c, r, a0, sweep, reverse) {
  const n = Math.max(8, Math.ceil(sweep / (TAU / Math.max(8, ARC_SEG))));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = reverse ? 1 - i / n : i / n;
    const a = a0 + sweep * t;
    out.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
  }
  return out;
}

// --- solver (Levenberg-Marquardt) --------------------------------------------
// Reusable scratch buffers for lmSolve. During an interactive drag lmSolve runs
// dozens of times per second; allocating J/A/g/M fresh on every LM iteration and
// every attempt allocated hundreds of small typed arrays per frame (GC jank).
// These grow only when a solve needs more rows/columns than an earlier one.
// lmSolve is single-threaded and not reentrant within this app, so module-scope
// reuse is safe.
let _lms_J = null, _lms_A = null, _lms_g = null, _lms_M = null;

// Return an array of m Float64Array(n) rows, reusing `rows` when it already has
// enough rows and columns (extra capacity is ignored). The returned rows are
// NOT zeroed on purpose: J/M/xn are fully rewritten before every read, and A/g
// are zeroed explicitly once per iteration.
function _lmsRows(rows, m, n) {
  if (rows && rows.length >= m && rows[0] && rows[0].length >= n) return rows;
  const out = new Array(m);
  for (let i = 0; i < m; i++) out[i] = new Float64Array(n);
  return out;
}

function lmSolve(x0, fn, maxIter, stepCap) {
  let x = x0.slice();
  let r = fn(x);
  let cost = 0;
  for (let i = 0; i < r.length; i++) cost += r[i] * r[i];
  if (!isFinite(cost)) return { x: x0, cost: Infinity, iterations: 0, converged: false };
  if (r.length === 0) return { x, cost: 0, iterations: 0, converged: true };
  // Already satisfied (e.g. a drag whose targets sit on the current
  // positions): never build the Jacobian just to discover there is no work.
  if (cost < 1e-16) return { x, cost, iterations: 0, converged: true };
  let lambda = 1e-3;
  const n = x.length;
  const m = r.length;
  let iterations = 0;
  let lastDx = 0;

  // Scratch J (reused across iterations; fully overwritten each iteration, so
  // no zeroing needed). A and g are accumulated, so they are zeroed once per
  // iteration. M is reconstructed every attempt. xn and dx must stay fresh per
  // attempt: after an accept xn becomes `x` (a reused buffer would let a later
  // rejected attempt destroy the current iterate), and dx is read immediately
  // after each solveLinear call.
  const J = _lmsRows(_lms_J, m, n); _lms_J = J;
  const A = _lmsRows(_lms_A, n, n); _lms_A = A;
  if (!_lms_g || _lms_g.length < n) _lms_g = new Float64Array(n);
  const g = _lms_g;
  const M = _lmsRows(_lms_M, n, n + 1); _lms_M = M;

  for (let iter = 0; iter < maxIter; iter++) {
    iterations = iter + 1;
    for (let j = 0; j < n; j++) {
      const old = x[j];
      const h = 1e-7 * Math.max(1, Math.abs(old));
      x[j] = old + h;
      const rp = fn(x);
      x[j] = old;
      for (let i = 0; i < m; i++) J[i][j] = (rp[i] - r[i]) / h;
    }

    for (let i = 0; i < n; i++) A[i].fill(0);
    g.fill(0);
    for (let i = 0; i < m; i++) {
      const Ji = J[i];
      for (let a = 0; a < n; a++) {
        const va = Ji[a];
        if (va === 0) continue;
        g[a] += va * r[i];
        for (let b = a; b < n; b++) A[a][b] += va * Ji[b];
      }
    }
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < a; b++) A[a][b] = A[b][a];
    }

    let accepted = false;

    for (let attempt = 0; attempt < 10; attempt++) {
      for (let a = 0; a < n; a++) {
        const Ma = M[a];
        for (let b = 0; b < n; b++) Ma[b] = A[a][b];
        Ma[a] += lambda * (A[a][a] + 1e-6) + 1e-12;
        Ma[n] = -g[a];
      }
      const dx = solveLinear(M, n);
      if (!dx) {
        lambda *= 10;
        continue;
      }
      const xn = new Array(n);
      let maxDx = 0;
      for (let i = 0; i < n; i++) {
        xn[i] = x[i] + dx[i];
        const ad = Math.abs(dx[i]);
        if (ad > maxDx) maxDx = ad;
      }
      // A single LM step may not teleport the system. Without a cap a nearly
      // singular Jacobian hands back a huge step, the cost happens to drop, and
      // the sketch lands on the mirrored branch of a distance/angle constraint:
      // the felt bug of a line "flipping" to the other side. Scaling the step
      // only changes the path to the solution, never the system being solved.
      if (stepCap > 0 && maxDx > stepCap) {
        const f = stepCap / maxDx;
        for (let i = 0; i < n; i++) xn[i] = x[i] + dx[i] * f;
        maxDx = stepCap;
      }
      lastDx = maxDx;
      const rn = fn(xn);
      let cn = 0;
      for (let i = 0; i < rn.length; i++) cn += rn[i] * rn[i];
      if (isFinite(cn) && cn < cost) {
        x = xn;
        r = rn;
        cost = cn;
        lambda = Math.max(1e-10, lambda * 0.35);
        accepted = true;
        break;
      }
      lambda *= 6;
    }

    if (!accepted) break;
    if (cost < 1e-16) break;
    if (lastDx < 1e-9) break;
  }
  // `converged` says the iterate stopped because it ran out of progress, not
  // because it ran out of budget. A caller that writes the result back must
  // look at this: committing a solution that hit maxIter mid-descent drags the
  // geometry somewhere the user never saw.
  return { x, cost, iterations, converged: lastDx < 1e-9 || cost < 1e-16 };
}

// Solve M·x = b (last column of M is b) in place. `out` is an optional buffer
// to write the solution into (reused by lmSolve to avoid per-call allocation);
// when omitted a fresh array is allocated. Returns null on a singular system.
function solveLinear(M, n, out) {
  for (let col = 0; col < n; col++) {
    let pivot = col;
    let best = Math.abs(M[col][col]);
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(M[row][col]);
      if (v > best) {
        best = v;
        pivot = row;
      }
    }
    if (best < 1e-14) return null;
    if (pivot !== col) {
      const tmp = M[col];
      M[col] = M[pivot];
      M[pivot] = tmp;
    }
    const pv = M[col][col];
    for (let j = col; j <= n; j++) M[col][j] /= pv;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const f = M[row][col];
      if (f === 0) continue;
      for (let j = col; j <= n; j++) M[row][j] -= f * M[col][j];
    }
  }
  const dst = out || new Array(n);
  for (let i = 0; i < n; i++) dst[i] = M[i][n];
  return dst;
}

// --- assembly solver (rigid parts + joints) ----------------------------------
// A part is a rigid body: its outline is frozen in a local frame and only the
// pose { tx, ty, rot } (millimetres + degrees, world Y-up) may change. A mate
// joins one marker of a part to one marker (pin) or one edge (slider) of
// another; a grounded part contributes no variables at all. solveAssembly()
// packs the free poses into one x vector and hands the whole joint network to
// lmSolve(), so a drag target, a pin and a slider are just residual rows: an
// over-constrained assembly still gets the least-squares answer instead of
// freezing. rot is kept continuous by the caller (no wrap during a drag) so the
// numeric Jacobian never sees a +-180 degree jump.
function partTransform(pose) {
  const a = (pose.rot || 0) * Math.PI / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return [c, s, -s, c, pose.tx || 0, pose.ty || 0];
}

// A marker ref { u, v } is local to its part; this is its world position. Inline
// the transform (same cos/sin/affine math as partTransform+matApply) and write
// into an optional `out` scratch so solveAssembly's hot residual loop does not
// allocate a matrix or a boxed point per marker per Jacobian evaluation.
function partMarkerWorld(pose, ref, out) {
  const a = (pose.rot || 0) * Math.PI / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const tx = pose.tx || 0, ty = pose.ty || 0;
  const o = out || {};
  o.x = c * ref.u - s * ref.v + tx;
  o.y = s * ref.u + c * ref.v + ty;
  return o;
}

// parts:   [{ id, tx, ty, rot, grounded? }]
// mates:   [{ type:'pin', a:{part,u,v}, b:{part,u,v} },
//           { type:'slider', a:{part,u,v}, b:{part,u1,v1,u2,v2} },
//           { type:'string', a:{part,u,v}, b:{part,u,v}, len }]  (display only)
// targets: [{ part, ref:{u,v} | origin:true, to:{x,y}, weight? }]
// Returns { poses: Map(id -> {tx,ty,rot}), cost, iterations }.
//
// No gravity, no regularisation: correctness comes from the assembly itself.
// A part with no residual touching it has an all-zero Jacobian column and
// lmSolve leaves it exactly at its input pose — untouched spectators CANNOT
// drift. Motion propagates only through mates, so the user grounds the base
// parts (a part welded to another part at two markers is `grounded: true`) and
// every drag is warm-started from the previous poses (the caller re-feeds the
// result; a drag then advances in small steps, which keeps the solve in the
// natural branch of the mechanism).
//
// Weights: joints 100, targets 1 (overridable). When a drag target is
// reachable the weights never matter — every row lands on zero. When it is
// NOT (a mouse point off the rail a slider rides on, a reach a chain cannot
// make), the JOINTS must win the least-squares compromise: with jw the leak of
// an unreachable 6mm pull is 6/(jw²+1) — about half a micron at 100, six
// hundredths of a millimetre at 10. The 100:1 ratio still conditions the
// normal equations by only 1e4, far below where Float64 damped steps lose a
// row group.
//
// A `string` mate is NOT a joint: the solver ignores it completely. It is a
// measuring thread between two markers — drawn grey with its live length and
// its change against the recorded rest length (`len`) in percent. It never
// pulls, pushes or moves a part.
function solveAssembly(parts, mates, targets, opts) {
  const o = opts || {};
  const maxIter = o.maxIter || 80;
  const jw = o.jointWeight == null ? 100 : o.jointWeight;
  const tw = o.targetWeight == null ? 1 : o.targetWeight;
  const list = (parts || []).filter(p => p && p.id != null);
  const free = list.filter(p => !p.grounded);
  const idx = new Map(free.map((p, i) => [p.id, i]));
  const x0 = [];
  for (const p of free) x0.push(p.tx || 0, p.ty || 0, p.rot || 0);
  const poseOf = (x) => {
    const out = new Map();
    for (const p of list) {
      const i = idx.get(p.id);
      out.set(p.id, i === undefined
        ? { tx: p.tx || 0, ty: p.ty || 0, rot: p.rot || 0 }
        : { tx: x[i * 3], ty: x[i * 3 + 1], rot: x[i * 3 + 2] });
    }
    return out;
  };

  // Scratch points reused across residual evaluations (each marker's result is
  // pushed into r before the scratch is reused, so no cross-contamination).
  const sA = {}, sB = {}, sP = {}, sQ1 = {}, sQ2 = {}, sT = {};
  const ZERO_REF = { u: 0, v: 0 };

  const fn = (x) => {
    const poses = poseOf(x);
    const r = [];
    for (const m of mates || []) {
      const pa = m.a && poses.get(m.a.part);
      const pb = m.b && poses.get(m.b.part);
      if (!pa || !pb || pa === pb) continue;
      if (m.type === 'pin') {
        const A = partMarkerWorld(pa, m.a, sA);
        const B = partMarkerWorld(pb, m.b, sB);
        r.push((A.x - B.x) * jw, (A.y - B.y) * jw);
      } else if (m.type === 'slider') {
        const P = partMarkerWorld(pa, m.a, sP);
        const q1 = partMarkerWorld(pb, { u: m.b.u1, v: m.b.v1 }, sQ1);
        const q2 = partMarkerWorld(pb, { u: m.b.u2, v: m.b.v2 }, sQ2);
        const dx = q2.x - q1.x, dy = q2.y - q1.y;
        const len = Math.hypot(dx, dy);
        if (len < 1e-12) continue;
        r.push(((P.x - q1.x) * dy - (P.y - q1.y) * dx) / len * jw);
      }
      // type 'string' is display-only: no residual, it never moves a part
    }
    for (const t of targets || []) {
      const pose = poses.get(t.part);
      if (!pose) continue;
      const w = (t.weight == null ? tw : t.weight);
      const p = t.origin ? pose : partMarkerWorld(pose, t.ref || ZERO_REF, sT);
      r.push((p.x - t.to.x) * w, (p.y - t.to.y) * w);
    }
    return r;
  };

  const costOf = (x) => {
    const r = fn(x);
    let c = 0;
    for (let i = 0; i < r.length; i++) c += r[i] * r[i];
    return c;
  };

  // Joint-only residuals for the repair passes.
  const jointResiduals = (x) => {
    const poses = poseOf(x);
    const r = [];
    for (const m of mates || []) {
      const pa = m.a && poses.get(m.a.part);
      const pb = m.b && poses.get(m.b.part);
      if (!pa || !pb || pa === pb) continue;
      if (m.type === 'pin') {
        const A = partMarkerWorld(pa, m.a, sA);
        const B = partMarkerWorld(pb, m.b, sB);
        r.push(A.x - B.x, A.y - B.y);
      } else if (m.type === 'slider') {
        const P = partMarkerWorld(pa, m.a, sP);
        const q1 = partMarkerWorld(pb, { u: m.b.u1, v: m.b.v1 }, sQ1);
        const q2 = partMarkerWorld(pb, { u: m.b.u2, v: m.b.v2 }, sQ2);
        const dx = q2.x - q1.x, dy = q2.y - q1.y;
        const len = Math.hypot(dx, dy);
        if (len < 1e-12) continue;
        r.push(((P.x - q1.x) * dy - (P.y - q1.y) * dx) / len);
      }
      // type 'string' is display-only: the repair pass ignores it too
    }
    return r;
  };
  // Nothing is free (everything grounded): the answer is the input, whatever
  // the residuals say — lmSolve would burn its attempts on an empty x.
  if (!x0.length) return { poses: poseOf(x0), cost: costOf(x0), iterations: 0 };

  // Interactive drags call this 60x a second with a warm start; opts.fast
  // skips the repair/jitter rounds below — one damped pass is plenty when the
  // previous poses were already on the joint manifold, and the full pipeline
  // runs once more on release.
  if (o.fast) {
    const quick = lmSolve(x0, fn, Math.min(maxIter, 25));
    return { poses: poseOf(quick.x), cost: quick.cost, iterations: quick.iterations };
  }

  // Alternating solve (a projection method). Pass A: joints + targets from the
  // warm start — moves the mechanism toward the target, sacrificing joint
  // exactness when the target is unreachable. Pass B: joints ONLY, no target —
  // snaps every mate back to zero, sliding the answer onto the joint manifold.
  //
  // EVERY accept/reject decision is made on the FULL objective (joints +
  // targets), never on the cost of the pass that produced the point: a repair
  // pass reports a beautiful joint cost while silently erasing the target
  // progress (at a dead point it walks the answer straight back to the start
  // pose), so a repair is kept only when the full cost actually improved.
  const altSolve = (start) => {
    let cur = lmSolve(start, fn, maxIter);
    if (cur.cost > 1e-10) {
      const again = lmSolve(cur.x, fn, maxIter);
      if (again.cost < cur.cost) cur = again;
    }
    let fc = costOf(cur.x);
    for (let round = 0; round < 4; round++) {
      const repaired = lmSolve(cur.x, jointResiduals, maxIter);
      const rfc = costOf(repaired.x);
      if (!(rfc < fc * (1 - 1e-9))) break;
      cur = repaired;
      fc = rfc;
      const pulled = lmSolve(cur.x, fn, maxIter);
      const pfc = costOf(pulled.x);
      if (!(pfc < fc * (1 - 1e-9))) break;
      cur = pulled;
      fc = pfc;
    }
    return { x: cur.x, cost: fc };
  };

  let best = altSolve(x0);

  // Dead-point escape. A chain dragged along its own straight axis sits in a
  // singularity: the gradient of the tip position with respect to the joint
  // angles is exactly zero there, so no damped step can begin the fold and the
  // tip stays put although the target is well within reach. A small
  // deterministic rotation jitter breaks the collinearity; each pattern runs
  // the same alternating solve and the best full-cost result wins. Only
  // ACTIVE parts are jittered — a part no residual touches has an all-zero
  // Jacobian, so the solve never pulls it back and a spectator would keep the
  // perturbation (it used to drift a few degrees per drag until it sailed off
  // screen). Only not-cleanly-solved cases pay for this.
  const active = new Set();
  for (const m of mates || []) {
    if (m.a && m.a.part != null) active.add(m.a.part);
    if (m.b && m.b.part != null) active.add(m.b.part);
  }
  for (const t of targets || []) {
    if (t && t.part != null) active.add(t.part);
  }
  if (best.cost > 0.25) {
    for (const amp of [1, 3, 8]) {
      const xj = best.x.slice();
      for (let i = 0; i < free.length; i++) {
        if (!active.has(free[i].id)) continue;
        xj[i * 3 + 2] += (i % 2 ? -amp : amp);
      }
      const cand = altSolve(xj);
      if (cand.cost < best.cost) best = cand;
      if (best.cost <= 0.25) break;
    }
  }
  return { poses: poseOf(best.x), cost: best.cost, iterations: best.iterations };
}

// --- polygons and chains -----------------------------------------------------
function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > pt.y) !== (b.y > pt.y) &&
      pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function signedAreaPts(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function interiorProbe(pts) {
  let best = 0;
  let bi = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L > best) {
      best = L;
      bi = i;
    }
  }
  const a = pts[bi];
  const b = pts[(bi + 1) % pts.length];
  const len = best || 1;
  const sgn = signedAreaPts(pts) < 0 ? -1 : 1;
  const nx = sgn * (b.y - a.y) / len;
  const ny = sgn * -(b.x - a.x) / len;
  const eps = Math.max(1e-6, Math.min(best * 1e-3, 0.01));
  return { x: (a.x + b.x) / 2 - nx * eps, y: (a.y + b.y) / 2 - ny * eps };
}

// Even depth = island, odd depth = hole, and the winding has to follow: the
// same alternation KaryaCNC applies when it receives a job (luar, dalam, luar,
// dalam). Without this an offset cannot tell "grow" from "shrink".
function normalizeWinding(contours) {
  const closed = (contours || []).filter(c => c && c.closed && c.pts && c.pts.length >= 3);
  const probes = new Map();
  for (const c of closed) probes.set(c, interiorProbe(c.pts));
  for (const c of closed) {
    const probe = probes.get(c);
    let depth = 0;
    for (const other of closed) {
      if (other === c) continue;
      if (pointInPoly(probe, other.pts)) depth++;
    }
    c.depth = depth;
    const area = signedAreaPts(c.pts);
    const wantPositive = depth % 2 === 0;
    if ((area > 0) !== wantPositive) c.pts = c.pts.slice().reverse();
  }
  for (const c of contours || []) {
    if (c && c.depth == null) c.depth = 0;
  }
  return contours || [];
}

// Join polylines that share endpoints, so a grouped drawing comes back as the
// same closed loops when it is converted to lines again.
function chainPolylines(chains, tol) {
  const pool = chains.map(c => ({ pts: c.pts.slice(), closed: !!c.closed }));
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= tol;
  const out = [];
  while (pool.length) {
    const cur = pool.shift();
    if (cur.closed) {
      out.push(cur);
      continue;
    }
    let grew = true;
    while (grew) {
      grew = false;
      const head = cur.pts[0];
      const tail = cur.pts[cur.pts.length - 1];
      for (let i = 0; i < pool.length; i++) {
        const o = pool[i];
        if (o.closed) continue;
        const a = o.pts[0];
        const b = o.pts[o.pts.length - 1];
        if (near(tail, a)) cur.pts = cur.pts.concat(o.pts.slice(1));
        else if (near(tail, b)) cur.pts = cur.pts.concat(o.pts.slice(0, -1).reverse());
        else if (near(head, b)) cur.pts = o.pts.slice(0, -1).concat(cur.pts);
        else if (near(head, a)) cur.pts = o.pts.slice(1).reverse().concat(cur.pts);
        else continue;
        pool.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (cur.pts.length >= 3 && near(cur.pts[0], cur.pts[cur.pts.length - 1])) {
      cur.pts.pop();
      // two points left are a plain segment, not a loop: closing it would make
      // -> Curve emit the same line twice
      cur.closed = cur.pts.length >= 3;
    }
    out.push(cur);
  }
  return out;
}

function dedupeSorted(values, tol = 1e-7) {
  const out = [];
  for (const v of values) {
    if (!out.length || Math.abs(v - out[out.length - 1]) > tol) out.push(v);
  }
  return out;
}

function lineLineIntersect(a, b, c, d) {
  const rx = b.x - a.x, ry = b.y - a.y;
  const sx = d.x - c.x, sy = d.y - c.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-12) return [];
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denom;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denom;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return [];
  return [{ x: a.x + rx * t, y: a.y + ry * t }];
}

function lineCircleIntersect(a, b, c, r) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const fx = a.x - c.x, fy = a.y - c.y;
  const A = dx * dx + dy * dy;
  if (A < 1e-12) return [];
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - r * r;
  const disc = B * B - 4 * A * C;
  if (disc < -1e-9) return [];
  const sq = Math.sqrt(Math.max(0, disc));
  const out = [];
  const ts = [(-B - sq) / (2 * A), (-B + sq) / (2 * A)];
  for (const t of ts) {
    if (t >= -1e-9 && t <= 1 + 1e-9) out.push({ x: a.x + dx * t, y: a.y + dy * t });
  }
  return out;
}

// One arc or circle as cubic Bezier nodes (spans of at most 90 degrees by
// default), so a bake/ungroup round-trip yields editable curves instead of
// polylines. A four-span circle is accurate to ~0.03% of the radius. Handles are
// absolute, like every spline handle in the app. A closed circle drops the
// duplicated closing node (its incoming handle moves to the first node).
//
// opts.maxSweep lets the caller use a span narrower than a quarter circle: a
// coarse flatten tolerance needs more spans than the quarter-circle default for
// the cubic to stay within tolerance of the true arc, and the machine path must
// not deviate just because the shape is stored as a circle rather than a curve.
function arcCubicNodes(c, r, a0, sweep, closed, opts) {
  const maxSweep = opts && isFinite(+opts.maxSweep) && +opts.maxSweep > 1e-6
    ? Math.min(Math.PI / 2, +opts.maxSweep)
    : Math.PI / 2;
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / maxSweep - 1e-9));
  const step = sweep / n;
  const k = (4 / 3) * Math.tan(step / 4);
  const nodes = [];
  for (let s = 0; s <= n; s++) {
    const a = a0 + step * s;
    nodes.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a), o: null, i: null });
  }
  for (let s = 0; s < n; s++) {
    const a = a0 + step * s;
    const b = a + step;
    nodes[s].o = { x: nodes[s].x - k * r * Math.sin(a), y: nodes[s].y + k * r * Math.cos(a) };
    nodes[s + 1].i = { x: nodes[s + 1].x + k * r * Math.sin(b), y: nodes[s + 1].y - k * r * Math.cos(b) };
  }
  if (closed && nodes.length > 2) {
    nodes[0].i = nodes[nodes.length - 1].i;
    nodes.pop();
  }
  return { closed: !!closed, curved: true, nodes };
}

// --- serialization numbers ---------------------------------------------------
// Millimetre coordinates only need two decimals; art contours live normalised
// inside their frame and need six.
function round2(v) {
  return Math.round(v * 100) / 100;
}

function round6(v) {
  return Math.round(v * 1e6) / 1e6;
}

// ---- image pixel density ---------------------------------------------------
// A screenshot pasted from a CAD program is meaningless without a scale, but
// most raster formats can carry their intended pixel density, and a screen
// capture carries the display's. Reading it means the pasted picture lands at
// the size the source app meant instead of a guessed 96 dpi.
//
// Returns { dpi, dpiY, source } or null. `dpi` is horizontal; dpiY is the same
// unless the file states a different vertical density.
const IMAGE_DEFAULT_DPI = 96;

function imagePixelDensity(bytes) {
  if (!bytes || !bytes.length) return null;
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const isPng = u8.length > 33 && u8[0] === 0x89 && u8[1] === 0x50 &&
    u8[2] === 0x4e && u8[3] === 0x47;
  if (isPng) return pngDensity(u8);
  if (u8.length > 4 && u8[0] === 0xff && u8[1] === 0xd8) return jpegDensity(u8);
  // GIF has no density field; BMP has a nominal one but nobody sets it
  if (u8.length > 14 && u8[0] === 0x42 && u8[1] === 0x4d) return bmpDensity(u8);
  return null;
}

function pngDensity(u8) {
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let off = 8;                       // skip the signature
  while (off + 8 <= u8.length) {
    const len = view.getUint32(off);
    const type = String.fromCharCode(u8[off + 4], u8[off + 5], u8[off + 6], u8[off + 7]);
    if (type === 'pHYs' && len >= 9 && off + 8 + 9 <= u8.length) {
      const ppuX = view.getUint32(off + 8);
      const ppuY = view.getUint32(off + 12);
      const unit = u8[off + 16];     // 1 = metre, 0 = unknown (aspect only)
      if (unit === 1 && ppuX > 0) {
        const dpi = ppuX * 0.0254;
        const dpiY = ppuY > 0 ? ppuY * 0.0254 : dpi;
        if (dpi > 1 && dpi < 100000) return { dpi, dpiY, source: 'png' };
      }
      return null;
    }
    if (type === 'IDAT' || type === 'IEND') return null;   // pHYs must come first
    off += 12 + len;
  }
  return null;
}

function jpegDensity(u8) {
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let off = 2;
  while (off + 4 <= u8.length) {
    if (u8[off] !== 0xff) { off++; continue; }
    const marker = u8[off + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      off += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return null;   // start of scan
    const len = view.getUint16(off + 2);
    if (len < 2) return null;
    // APP0 "JFIF": units (0 none, 1 dpi, 2 dpcm) + Xdensity + Ydensity
    if (marker === 0xe0 && off + 16 <= u8.length &&
      u8[off + 4] === 0x4a && u8[off + 5] === 0x46 && u8[off + 6] === 0x49 && u8[off + 7] === 0x46) {
      const units = u8[off + 11];
      const xd = view.getUint16(off + 12);
      const yd = view.getUint16(off + 14);
      if (units === 1 && xd > 0) return { dpi: xd, dpiY: yd || xd, source: 'jfif' };
      if (units === 2 && xd > 0) return { dpi: xd * 2.54, dpiY: (yd || xd) * 2.54, source: 'jfif' };
    }
    // APP1 "Exif": XResolution (0x011A) / YResolution (0x011B) + ResolutionUnit
    if (marker === 0xe1 && off + 10 <= u8.length &&
      u8[off + 4] === 0x45 && u8[off + 5] === 0x78 && u8[off + 6] === 0x69 && u8[off + 7] === 0x66) {
      const exif = exifDensity(u8, view, off + 10);
      if (exif) return exif;
    }
    off += 2 + len;
  }
  return null;
}

function exifDensity(u8, view, base) {
  if (base + 8 > u8.length) return null;
  const tiff = base;
  const little = u8[tiff] === 0x49 && u8[tiff + 1] === 0x49;
  const big = u8[tiff] === 0x4d && u8[tiff + 1] === 0x4d;
  if (!little && !big) return null;
  const u16 = (o) => (little ? view.getUint16(o, true) : view.getUint16(o, false));
  const u32 = (o) => (little ? view.getUint32(o, true) : view.getUint32(o, false));
  if (u16(tiff + 2) !== 42) return null;
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > u8.length) return null;
  const count = u16(ifd);
  let xres = 0, yres = 0, unit = 2;      // 2 = inches, 3 = cm
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > u8.length) break;
    const tag = u16(entry);
    if (tag !== 0x011a && tag !== 0x011b && tag !== 0x0128) continue;
    const type = u16(entry + 2);
    const val = u32(entry + 8);
    if (tag === 0x0128) { unit = type === 3 ? u16(entry + 8) : val; continue; }
    // RATIONAL: numerator/denominator at the value offset
    if (type === 5 && val + 8 <= u8.length) {
      const num = u32(tiff + val);
      const den = u32(tiff + val + 4);
      const q = den ? num / den : 0;
      if (tag === 0x011a) xres = q;
      else yres = q;
    }
  }
  if (!(xres > 1)) return null;
  const scale = unit === 3 ? 2.54 : 1;   // pixels per cm -> per inch
  const dpi = xres * scale;
  const dpiY = (yres > 1 ? yres : xres) * scale;
  if (!(dpi > 1) || dpi >= 100000) return null;
  return { dpi, dpiY, source: 'exif' };
}

function bmpDensity(u8) {
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.length < 46) return null;
  const hdr = view.getUint32(14, true);
  // BITMAPINFOHEADER / V4 / V5 carry ppm as signed ints at offset 38/42
  if (hdr < 40 || u8.length < 46) return null;
  const ppmX = view.getInt32(38, true);
  const ppmY = view.getInt32(42, true);
  if (ppmX > 0) return { dpi: ppmX * 0.0254, dpiY: (ppmY > 0 ? ppmY : ppmX) * 0.0254, source: 'bmp' };
  return null;
}

// ---- DXF -------------------------------------------------------------------
// Minimal ASCII DXF reader for the 2D geometry a sketch can hold: LINE, CIRCLE,
// ARC, LWPOLYLINE and POLYLINE (bulges become real arcs), SPLINE (fit points),
// ELLIPSE (as a spline) and INSERT of blocks that contain those. Primitives
// come back in world radians: {type:'line'|'circle'|'arc'|'spline'}, arcs run
// CCW from a0 to a1. Nothing here touches the DOM or app state.
function parseDxf(text) {
  if (!text || /AutoCAD Binary DXF/.test(String(text).slice(0, 64))) return [];
  const rows = [];
  const lines = String(text).split(/\r\n|\r|\n/);
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i], 10);
    if (Number.isFinite(code)) rows.push([code, lines[i + 1].trim()]);
  }
  const blocks = Object.create(null);
  const ents = [];
  let section = null;
  let blockName = null;
  let cur = null;
  const flush = () => {
    if (!cur) return;
    const rec = cur;
    cur = null;
    if (rec.type === 'SECTION') { section = dxfVal(rec, 2); return; }
    if (rec.type === 'ENDSEC' || rec.type === 'EOF') { section = null; return; }
    if (rec.type === 'BLOCK') { blockName = dxfVal(rec, 2); return; }
    if (rec.type === 'ENDBLK') { blockName = null; return; }
    if (section === 'ENTITIES') ents.push(rec);
    else if (section === 'BLOCKS' && blockName) (blocks[blockName] || (blocks[blockName] = [])).push(rec);
  };
  for (const row of rows) {
    if (row[0] === 0) {
      flush();
      cur = { type: String(row[1]).toUpperCase(), pairs: [] };
      continue;
    }
    if (cur) cur.pairs.push(row);
  }
  flush();
  const out = [];
  dxfDecodeAll(ents, blocks, { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }, out, 0);
  return out;
}

function dxfVal(rec, code) {
  for (const pair of rec.pairs) if (pair[0] === code) return pair[1];
  return null;
}

function dxfNum(rec, code, dflt) {
  const v = parseFloat(dxfVal(rec, code));
  return Number.isFinite(v) ? v : dflt;
}

function dxfPt(t, x, y) {
  return { x: t.a * x + t.b * y + t.tx, y: t.c * x + t.d * y + t.ty };
}

function dxfCompose(t, m) {
  return {
    a: t.a * m.a + t.b * m.c,
    b: t.a * m.b + t.b * m.d,
    c: t.c * m.a + t.d * m.c,
    d: t.c * m.b + t.d * m.d,
    tx: t.a * m.tx + t.b * m.ty + t.tx,
    ty: t.c * m.tx + t.d * m.ty + t.ty
  };
}

function dxfUniform(t) {
  const c1 = Math.hypot(t.a, t.c), c2 = Math.hypot(t.b, t.d);
  if (c1 < 1e-12 || c2 < 1e-12) return true;
  return Math.abs(t.a * t.b + t.c * t.d) < 1e-6 * c1 * c2 && Math.abs(c1 - c2) < 1e-6 * Math.max(c1, c2);
}

function dxfEllipsePts(t, cx, cy, rx, ry, rot, a0, a1, closed) {
  const pts = [];
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const n = 24;
  const last = closed ? n - 1 : n;   // a closed loop must not repeat its first node
  for (let k = 0; k <= last; k++) {
    const a = a0 + (a1 - a0) * (k / n);
    const x = rx * Math.cos(a), y = ry * Math.sin(a);
    const p = dxfPt(t, cx + x * cos - y * sin, cy + x * sin + y * cos);
    pts.push([p.x, p.y]);
  }
  return pts;
}

function dxfDecodeAll(recs, blocks, t, out, depth) {
  if (!recs || depth > 8) return;
  let poly = null;
  const endPoly = () => {
    if (!poly) return;
    const p = poly;
    poly = null;
    dxfEmitVerts(p.verts, p.closed, t, out);
  };
  for (const rec of recs) {
    if (rec.type === 'POLYLINE') {
      endPoly();
      poly = { closed: (dxfNum(rec, 70, 0) & 1) !== 0, verts: [] };
      continue;
    }
    if (rec.type === 'VERTEX' && poly) {
      poly.verts.push({ x: dxfNum(rec, 10, 0), y: dxfNum(rec, 20, 0), b: dxfNum(rec, 42, 0) });
      continue;
    }
    if (rec.type === 'SEQEND') {
      endPoly();
      continue;
    }
    endPoly();
    dxfEmit(rec, blocks, t, out, depth);
  }
  endPoly();
}

// Polyline vertices (with bulges) into line / arc primitives. bulge =
// tan(included/4), sign = winding: the sagitta sits bulge * half-chord to the
// left of the chord for a positive bulge.
function dxfEmitVerts(verts, closed, t, out) {
  const n = verts.length;
  if (n < 2) return;
  const count = closed ? n : n - 1;
  const det = t.a * t.d - t.b * t.c;
  const scale = Math.hypot(t.a, t.c);
  for (let i = 0; i < count; i++) {
    const v0 = verts[i];
    const v1 = verts[(i + 1) % n];
    const bulge = v0.b || 0;
    const p0 = dxfPt(t, v0.x, v0.y);
    const p1 = dxfPt(t, v1.x, v1.y);
    if (Math.abs(bulge) < 1e-9) {
      out.push({ type: 'line', x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y });
      continue;
    }
    const dx = v1.x - v0.x, dy = v1.y - v0.y;
    const chord = Math.hypot(dx, dy) || 1e-9;
    const h = chord / 2;
    const s = bulge * h;
    const r = (h * h + s * s) / (2 * Math.abs(s));
    const nx = -dy / chord, ny = dx / chord;
    const sg = bulge > 0 ? 1 : -1;
    const ccx = (v0.x + v1.x) / 2 + nx * sg * (r - Math.abs(s));
    const ccy = (v0.y + v1.y) / 2 + ny * sg * (r - Math.abs(s));
    const angStart = Math.atan2(v0.y - ccy, v0.x - ccx);
    const sweep = 4 * Math.atan(bulge);
    if (dxfUniform(t)) {
      // app arcs run CCW from a0 to a1; a mirror flips the winding
      let a0 = angStart, a1 = angStart + sweep;
      if (sweep < 0) { const tmp = a0; a0 = a1; a1 = tmp; }
      if (det < 0) { const tmp = a0; a0 = a1; a1 = tmp; }
      const c = dxfPt(t, ccx, ccy);
      out.push({ type: 'arc', cx: c.x, cy: c.y, r: r * scale, a0, a1 });
    } else {
      const pts = [];
      const steps = 24;
      for (let k = 0; k <= steps; k++) {
        const ang = angStart + sweep * (k / steps);
        const p = dxfPt(t, ccx + r * Math.cos(ang), ccy + r * Math.sin(ang));
        pts.push([p.x, p.y]);
      }
      out.push({ type: 'spline', pts, closed: false });
    }
  }
}

function dxfEmit(rec, blocks, t, out, depth) {
  const type = rec.type;
  if (type === 'LINE') {
    const p = dxfPt(t, dxfNum(rec, 10, 0), dxfNum(rec, 20, 0));
    const q = dxfPt(t, dxfNum(rec, 11, 0), dxfNum(rec, 21, 0));
    out.push({ type: 'line', x1: p.x, y1: p.y, x2: q.x, y2: q.y });
    return;
  }
  if (type === 'CIRCLE') {
    const cx = dxfNum(rec, 10, 0), cy = dxfNum(rec, 20, 0);
    const r = dxfNum(rec, 40, 0);
    if (r <= 0) return;
    const c = dxfPt(t, cx, cy);
    if (dxfUniform(t)) {
      out.push({ type: 'circle', cx: c.x, cy: c.y, r: r * Math.hypot(t.a, t.c) });
    } else {
      out.push({ type: 'spline', pts: dxfEllipsePts(t, cx, cy, r, r, 0, 0, Math.PI * 2, true), closed: true });
    }
    return;
  }
  if (type === 'ARC') {
    const cx = dxfNum(rec, 10, 0), cy = dxfNum(rec, 20, 0);
    const r = dxfNum(rec, 40, 0);
    if (r <= 0) return;
    const a0 = dxfNum(rec, 50, 0) * Math.PI / 180;
    const a1 = dxfNum(rec, 51, 0) * Math.PI / 180;
    const det = t.a * t.d - t.b * t.c;
    if (dxfUniform(t)) {
      const c = dxfPt(t, cx, cy);
      let s = a0, e = a1;
      if (det < 0) { const tmp = s; s = e; e = tmp; }
      out.push({ type: 'arc', cx: c.x, cy: c.y, r: r * Math.hypot(t.a, t.c), a0: s, a1: e });
    } else {
      let sweep = a1 - a0;
      while (sweep <= 1e-9) sweep += Math.PI * 2;
      out.push({ type: 'spline', pts: dxfEllipsePts(t, cx, cy, r, r, 0, a0, a0 + sweep, false), closed: false });
    }
    return;
  }
  if (type === 'LWPOLYLINE') {
    const verts = [];
    let closed = false;
    let curV = null;
    for (const pair of rec.pairs) {
      if (pair[0] === 10) {
        curV = { x: parseFloat(pair[1]) || 0, y: 0, b: 0 };
        verts.push(curV);
      } else if (pair[0] === 20 && curV) curV.y = parseFloat(pair[1]) || 0;
      else if (pair[0] === 42 && curV) curV.b = parseFloat(pair[1]) || 0;
      else if (pair[0] === 70) closed = (parseInt(pair[1], 10) & 1) !== 0;
    }
    dxfEmitVerts(verts, closed, t, out);
    return;
  }
  if (type === 'SPLINE') {
    const ctrl = [], fit = [];
    let flags = 0;
    for (const pair of rec.pairs) {
      if (pair[0] === 10) ctrl.push([parseFloat(pair[1]) || 0, 0]);
      else if (pair[0] === 20 && ctrl.length) ctrl[ctrl.length - 1][1] = parseFloat(pair[1]) || 0;
      else if (pair[0] === 11) fit.push([parseFloat(pair[1]) || 0, 0]);
      else if (pair[0] === 21 && fit.length) fit[fit.length - 1][1] = parseFloat(pair[1]) || 0;
      else if (pair[0] === 70) flags = parseInt(pair[1], 10) || 0;
    }
    const pts = fit.length >= 2 ? fit : ctrl;
    if (pts.length < 2) return;
    out.push({
      type: 'spline',
      pts: pts.map(p => {
        const q = dxfPt(t, p[0], p[1]);
        return [q.x, q.y];
      }),
      closed: (flags & 1) !== 0 || (flags & 2) !== 0
    });
    return;
  }
  if (type === 'ELLIPSE') {
    const cx = dxfNum(rec, 10, 0), cy = dxfNum(rec, 20, 0);
    const mx = dxfNum(rec, 11, 1), my = dxfNum(rec, 21, 0);
    const ratio = dxfNum(rec, 40, 1);
    const p0 = dxfNum(rec, 41, 0);
    let sweep = dxfNum(rec, 42, Math.PI * 2) - p0;
    while (sweep <= 1e-9) sweep += Math.PI * 2;
    const full = sweep >= Math.PI * 2 - 1e-6;
    if (full) sweep = Math.PI * 2;
    const R = Math.hypot(mx, my);
    out.push({
      type: 'spline',
      pts: dxfEllipsePts(t, cx, cy, R, R * ratio, Math.atan2(my, mx), p0, p0 + sweep, full),
      closed: full
    });
    return;
  }
  if (type === 'INSERT') {
    const name = dxfVal(rec, 2);
    const sub = name != null ? blocks[name] : null;
    if (!sub) return;
    const px = dxfNum(rec, 10, 0), py = dxfNum(rec, 20, 0);
    const sx = dxfNum(rec, 41, 1), sy = dxfNum(rec, 42, 1);
    const rot = dxfNum(rec, 50, 0) * Math.PI / 180;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const m = { a: cos * sx, b: -sin * sy, c: sin * sx, d: cos * sy, tx: px, ty: py };
    dxfDecodeAll(sub, blocks, dxfCompose(t, m), out, depth + 1);
    return;
  }
}

// ---- PDF -------------------------------------------------------------------
// Minimal PDF vector reader: decompress content streams and turn painted paths
// into node/handle primitives (the same shape the spline model uses). Text is
// extracted as note primitives (the app imports them as comments or text
// objects); clip regions are ignored. Coordinates stay in raw PDF user space.

function pdfTokens(content, uniMap) {
  const out = [];
  let i = 0;
  const n = content.length;
  while (i < n) {
    const ch = content[i];
    if (ch === '%') {
      while (i < n && content[i] !== '\n') i++;
      continue;
    }
    if (ch <= ' ') { i++; continue; }
    if ((ch >= '0' && ch <= '9') || ch === '-' || ch === '+' || ch === '.') {
      let j = i + 1;
      while (j < n && ((content[j] >= '0' && content[j] <= '9') || content[j] === '.')) j++;
      out.push({ t: 'num', v: parseFloat(content.slice(i, j)) });
      i = j;
      continue;
    }
    if (ch === '/') {
      let j = i + 1;
      while (j < n && content[j] > ' ' && '[]()<>/%'.indexOf(content[j]) < 0) j++;
      out.push({ t: 'name', v: content.slice(i + 1, j) });
      i = j;
      continue;
    }
    if (ch === '(') {
      let depth = 1, j = i + 1;
      while (j < n && depth > 0) {
        if (content[j] === '\\') j++;
        else if (content[j] === '(') depth++;
        else if (content[j] === ')') depth--;
        j++;
      }
      out.push({ t: 'str', v: content.slice(i + 1, j - 1) });
      i = j;
      continue;
    }
    if (ch === '<') {
      if (content[i + 1] === '<') { out.push({ t: 'op', v: '<<' }); i += 2; continue; }
      let j = content.indexOf('>', i);
      j = j < 0 ? n : j + 1;
      // HEX string (e.g. <0049><0055> inside a TJ array — how many CAD/PDF
      // writers encode text). Two encodings show up:
      //   - simple fonts: pairs of hex digits are single-byte character codes
      //   - Type0 / Identity-H: 4-digit groups are 2-byte glyph codes, and the
      //     file's ToUnicode CMap (uniMap) is keyed by those 16-bit codes.
      // Pick 16-bit units when the CMap knows them, otherwise fall back to
      // bytes (which also covers UTF-16BE text, high byte zero).
      const hex = content.slice(i + 1, j).replace(/[^0-9A-Fa-f]/g, '');
      let v = '';
      if (hex.length >= 4 && hex.length % 4 === 0) {
        const units = [];
        for (let k = 0; k + 3 < hex.length; k += 4) units.push(parseInt(hex.slice(k, k + 4), 16));
        const as16 = units.some(c => uniMap && uniMap.has(String.fromCharCode(c)));
        const utf16be = !(uniMap && uniMap.size) && units.every(c => c < 0x100);
        if (as16 || utf16be) {
          v = units.map(c => String.fromCharCode(c)).join('');
        }
      }
      if (!v) {
        const clean = hex.length % 2 ? hex.slice(0, -1) : hex;
        for (let k = 0; k + 1 < clean.length; k += 2) {
          v += String.fromCharCode(parseInt(clean.slice(k, k + 2), 16));
        }
      }
      out.push({ t: 'str', v });
      i = j;
      continue;
    }
    if (ch === '>') { i += content[i + 1] === '>' ? 2 : 1; continue; }
    if (ch === '[' || ch === ']') { out.push({ t: 'op', v: ch }); i++; continue; }
    if (ch === '{' || ch === '}') { i++; continue; }
    let j = i;
    while (j < n && content[j] > ' ' && '[]()<>/%'.indexOf(content[j]) < 0) j++;
    if (j === i) { i++; continue; }
    out.push({ t: 'op', v: content.slice(i, j) });
    i = j;
  }
  return out;
}

function pdfColor(vals, spaceName) {
  const hex = (v) => {
    const s = Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16);
    return s.length < 2 ? '0' + s : s;
  };
  if (vals.length >= 4) {
    // CMYK
    const [c, m, y, k] = vals;
    return '#' + hex((1 - c) * (1 - k)) + hex((1 - m) * (1 - k)) + hex((1 - y) * (1 - k));
  }
  if (vals.length === 3) return '#' + hex(vals[0]) + hex(vals[1]) + hex(vals[2]);
  if (vals.length >= 1) return '#' + hex(vals[0]) + hex(vals[0]) + hex(vals[0]);
  return null;
}

// One painted subpath -> nodes with absolute control handles (null = straight).
function pdfSubpathNodes(sp) {
  const nodes = [{ p: [sp.start.x, sp.start.y], o: null, i: null }];
  for (const s of sp.segs) {
    if (s.t === 'l') {
      nodes.push({ p: [s.p.x, s.p.y], o: null, i: null });
    } else {
      nodes[nodes.length - 1].o = [s.a.x, s.a.y];
      nodes.push({ p: [s.p.x, s.p.y], i: [s.b.x, s.b.y], o: null });
    }
  }
  let closed = sp.closed;
  if (closed && nodes.length > 2) {
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (Math.abs(first.p[0] - last.p[0]) < 1e-9 && Math.abs(first.p[1] - last.p[1]) < 1e-9) {
      if (last.o) first.o = last.o;
      if (last.i) first.i = last.i;
      nodes.pop();
    }
  }
  return { closed, nodes };
}

// decode PDF literal string escapes (\n, \ooo octal, \( \) \\)
function decodePdfString(s) {
  return String(s).replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (mm, g) => {
    if (g === 'n') return '\n';
    if (g === 'r') return '\r';
    if (g === 't') return '\t';
    if (g === 'b') return '\b';
    if (g === 'f') return '\f';
    if (g === '(') return '(';
    if (g === ')') return ')';
    if (g === '\\') return '\\';
    return String.fromCharCode(parseInt(g, 8) & 0xff);
  });
}

// Parse one PDF content stream into primitives:
//   { color, closed, nodes: [{ p:[x,y], o:[x,y]|null, i:[x,y]|null }] }
// and note primitives for text: { kind:'note', x, y, text }
function pdfContentPrims(content, uniMap, fonts) {
  const toks = pdfTokens(String(content), uniMap);
  const out = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  let ops = [];
  let subpaths = [];
  let cur = null;
  let cx = 0, cy = 0;
  let stroke = null, fill = null;
  let inArray = false;
  let arrayBuf = [];
  let pendingTJ = '';
  // text extraction (-> comments): position from the text matrix, strings from
  // Tj / TJ / ' / " — no font parsing needed. Tf/Tc/Tw/Tz/Ts are tracked
  // only to know how big the text is and where its top-left corner sits, so
  // per-glyph text runs can be merged back into words.
  let tm = [1, 0, 0, 1, 0, 0];
  let leading = 0;
  let fontSize = 10;
  let charSpace = 0;
  let wordSpace = 0;
  let hScale = 1;
  let rise = 0;
  let curFont = null;
  let inText = false;

  const T = (x, y) => ({ x: ctm[0] * x + ctm[2] * y + ctm[4], y: ctm[1] * x + ctm[3] * y + ctm[5] });
  // text space -> user space: the text matrix places/scales the glyphs, the
  // CTM then places the whole text object in the page
  const TT = (x, y) => {
    const tx = tm[0] * x + tm[2] * y + tm[4];
    const ty = tm[1] * x + tm[3] * y + tm[5];
    return T(tx, ty);
  };
  const textHeight = () => {
    const a = TT(0, rise), b = TT(0, rise + (fontSize || 10));
    const h = Math.hypot(b.x - a.x, b.y - a.y);
    return Number.isFinite(h) && h > 0 ? h : (fontSize || 10);
  };
  const emitNote = (str) => {
    // CID subset fonts name glyphs by arbitrary id; the ToUnicode CMap turns
    // those codes back into real text. The font's own CMap wins over the
    // global fallback: different subset fonts reuse the same codes.
    const map = (fonts && curFont && fonts.get(curFont)) || uniMap;
    const s = String(str == null ? '' : str)
      .split('')
      .map(c => (map && map.has(c) ? map.get(c) : c))
      .join('')
      .replace(/\u0000/g, '')
      .trim();
    if (!s) return;
    const h = textHeight();
    // comment anchors are top-left (a comment's text grows right and down),
    // so lift the baseline to the text's cap line instead of keeping the
    // baseline, which would hang every imported label below its artwork
    const p = TT(0, rise + (fontSize || 10) * 0.75);
    // a rough advance for the whole run: enough to tell touching runs from
    // separate labels when merging below (no /Widths parsing here)
    const em = h / (fontSize || 10);
    const spaces = (s.match(/ /g) || []).length;
    const w = (s.length * fontSize * 0.5 + s.length * charSpace + spaces * wordSpace) * hScale * em;
    // baseline (advance) and up directions in user space, used to merge split
    // runs and to lay the text frame out in the page's own orientation
    const ax = TT(1, 0).x - TT(0, 0).x, ay = TT(1, 0).y - TT(0, 0).y;
    const al = Math.hypot(ax, ay) || 1;
    const bx = TT(0, 1).x - TT(0, 0).x, by = TT(0, 1).y - TT(0, 0).y;
    const bl = Math.hypot(bx, by) || 1;
    out.push({ kind: 'note', x: p.x, y: p.y, text: s, size: h, w,
      ux: ax / al, uy: ay / al, vx: bx / bl, vy: by / bl,
      color: null, closed: false, nodes: [] });
  };
  const showStr = (v) => { if (v != null && v !== '') emitNote(v); };

  const moveTo = (x, y) => {
    cur = { start: T(x, y), segs: [], closed: false };
    subpaths.push(cur);
    cx = x; cy = y;
  };
  const lineTo = (x, y) => {
    if (!cur) { moveTo(x, y); return; }
    cur.segs.push({ t: 'l', p: T(x, y) });
    cx = x; cy = y;
  };
  const curveTo = (x1, y1, x2, y2, x3, y3) => {
    if (!cur) moveTo(x1, y1);
    cur.segs.push({ t: 'c', a: T(x1, y1), b: T(x2, y2), p: T(x3, y3) });
    cx = x3; cy = y3;
  };
  const emit = (color) => {
    for (const sp of subpaths) {
      if (!sp.segs.length) continue;
      const built = pdfSubpathNodes(sp);
      // non-finite geometry (garbage tokens from a non-content stream) must
      // never reach the drawing: it poisons bounds and the loop weld
      if (built.nodes.length >= 2 &&
        built.nodes.every(nd => Number.isFinite(nd.p[0]) && Number.isFinite(nd.p[1]))) {
        out.push({ color: color || null, closed: built.closed, nodes: built.nodes });
      }
    }
    subpaths = [];
    cur = null;
  };

  for (const tk of toks) {
    if (tk.t === 'arr' || (tk.t === 'op' && tk.v === '[')) {
      // operand arrays (TJ kerning lists): collect the strings inside
      inArray = true;
      arrayBuf = [];
      continue;
    }
    if (inArray) {
      if (tk.t === 'op' && tk.v === ']') { inArray = false; pendingTJ = arrayBuf.join(''); }
      else if (tk.t === 'str') arrayBuf.push(decodePdfString(tk.v));
      continue;
    }
    if (tk.t !== 'op') { ops.push(tk.t === 'num' ? tk.v : tk.v); continue; }
    const op = tk.v;
    if (op === '[') { inArray = true; arrayBuf = []; ops = []; continue; }
    switch (op) {
      case 'q': stack.push(ctm.slice()); break;
      case 'Q': if (stack.length) ctm = stack.pop(); break;
      case 'cm': {
        const m = ops.slice(-6);
        if (m.length === 6 && m.every(Number.isFinite)) {
          // CTM' = CTM ∘ M: the new matrix applies in the current user space
          ctm = [
            ctm[0] * m[0] + ctm[2] * m[1],
            ctm[1] * m[0] + ctm[3] * m[1],
            ctm[0] * m[2] + ctm[2] * m[3],
            ctm[1] * m[2] + ctm[3] * m[3],
            ctm[0] * m[4] + ctm[2] * m[5] + ctm[4],
            ctm[1] * m[4] + ctm[3] * m[5] + ctm[5]
          ];
        }
        break;
      }
      case 'm': { const [x, y] = ops.slice(-2); if (Number.isFinite(x) && Number.isFinite(y)) moveTo(x, y); break; }
      case 'l': { const [x, y] = ops.slice(-2); if (Number.isFinite(x) && Number.isFinite(y)) lineTo(x, y); break; }
      case 'c': {
        const [x1, y1, x2, y2, x3, y3] = ops.slice(-6);
        if ([x1, y1, x2, y2, x3, y3].every(Number.isFinite)) curveTo(x1, y1, x2, y2, x3, y3);
        break;
      }
      case 'v': {
        const [x2, y2, x3, y3] = ops.slice(-4);
        if ([x2, y2, x3, y3].every(Number.isFinite)) curveTo(cx, cy, x2, y2, x3, y3);
        break;
      }
      case 'y': {
        const [x1, y1, x3, y3] = ops.slice(-4);
        if ([x1, y1, x3, y3].every(Number.isFinite)) curveTo(x1, y1, x3, y3, x3, y3);
        break;
      }
      case 're': {
        const [x, y, w, h] = ops.slice(-4);
        if ([x, y, w, h].every(Number.isFinite)) {
          moveTo(x, y);
          lineTo(x + w, y);
          lineTo(x + w, y + h);
          lineTo(x, y + h);
          cur.closed = true;
          cx = x; cy = y;
        }
        break;
      }
      case 'h': if (cur) cur.closed = true; break;
      case 'n': subpaths = []; cur = null; break;
      case 'S': case 's': emit(stroke); break;
      case 'f': case 'F': case 'f*': emit(fill); break;
      case 'B': case 'B*': case 'b': case 'b*': emit(stroke || fill); break;
      case 'BT': inText = true; tm = [1, 0, 0, 1, 0, 0]; break;
      case 'ET': inText = false; break;
      case 'Td': case 'TD': {
        const d = ops.slice(-2);
        if (d.every(Number.isFinite)) {
          tm = [tm[0], tm[1], tm[2], tm[3],
            tm[4] + tm[0] * d[0] + tm[2] * d[1],
            tm[5] + tm[1] * d[0] + tm[3] * d[1]];
          if (op === 'TD') leading = -d[1];
        }
        break;
      }
      case 'Tm': {
        const v = ops.slice(-6);
        if (v.length === 6 && v.every(Number.isFinite)) tm = v.slice();
        break;
      }
      case 'TL': {
        const v = ops.slice(-1)[0];
        if (Number.isFinite(v)) leading = v;
        break;
      }
      case 'T*': tm[5] -= leading; break;
      case 'Tj': case "'": case '"': {
        if (op === "'" || op === '"') tm[5] -= leading;
        const v = ops.slice(-1)[0];
        if (typeof v === 'string') showStr(decodePdfString(v));
        else if (pendingTJ) { showStr(pendingTJ); pendingTJ = ''; }
        break;
      }
      case 'TJ': showStr(pendingTJ); pendingTJ = ''; break;
      case 'Tf': {
        // font name + size: the name selects the page font resource (and its
        // ToUnicode CMap), the last operand is the size
        const name = ops.length >= 2 ? ops[ops.length - 2] : null;
        if (typeof name === 'string') curFont = name;
        const v = ops.slice(-1)[0];
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) fontSize = v;
        break;
      }
      case 'Tc': { const v = ops.slice(-1)[0]; if (Number.isFinite(v)) charSpace = v; break; }
      case 'Tw': { const v = ops.slice(-1)[0]; if (Number.isFinite(v)) wordSpace = v; break; }
      case 'Tz': { const v = ops.slice(-1)[0]; if (Number.isFinite(v) && v !== 0) hScale = v / 100; break; }
      case 'Ts': { const v = ops.slice(-1)[0]; if (Number.isFinite(v)) rise = v; break; }
      case 'RG': stroke = pdfColor(ops.slice(-3)); break;
      case 'rg': fill = pdfColor(ops.slice(-3)); break;
      case 'G': stroke = pdfColor(ops.slice(-1)); break;
      case 'g': fill = pdfColor(ops.slice(-1)); break;
      case 'K': stroke = pdfColor(ops.slice(-4)); break;
      case 'k': fill = pdfColor(ops.slice(-4)); break;
      case 'SC': case 'SCN': stroke = pdfColor(ops.slice(-4)); break;
      case 'sc': case 'scn': fill = pdfColor(ops.slice(-4)); break;
      default: break;   // text, XObjects, stroke attrs, clip: ignored
    }
    ops = [];
  }
  mergePdfNotes(out);
  return out;
}

// CAD/PDF writers often put every glyph in its own BT/ET block with an absolute
// text matrix. Left alone, a single label like "1D" arrives as two one-letter
// comments. Join the runs that sit on the same baseline and nearly touch back
// into the word they were split from (a real space is kept as one space).
// The baseline direction comes from the text matrix, so rotated labels merge
// along their own reading direction, not along the page x axis.
function mergePdfNotes(out) {
  const idx = [];
  for (let i = 0; i < out.length; i++) if (out[i].kind === 'note') idx.push(i);
  if (idx.length < 2) return;
  const items = idx.map(i => {
    const pr = out[i];
    let ux = pr.ux, uy = pr.uy;
    if (!Number.isFinite(ux) || !Number.isFinite(uy) || (ux === 0 && uy === 0)) { ux = 1; uy = 0; }
    const len = Math.hypot(ux, uy) || 1;
    ux /= len; uy /= len;
    return {
      i, pr, ux, uy, size: pr.size || 10,
      along: pr.x * ux + pr.y * uy,
      across: pr.x * -uy + pr.y * ux
    };
  });
  // group by line (across), then reading order along the line
  items.sort((a, b) => (Math.abs(a.across - b.across) <= 0.3 * Math.max(a.size, b.size)
    ? a.along - b.along
    : a.across - b.across));
  const runs = [];
  for (const it of items) {
    const run = runs[runs.length - 1];
    if (run) {
      const tol = Math.max(it.size, run.size) * 0.3;
      const gap = it.along - run.endAlong;
      const limit = Math.max(it.size, run.size) * 0.6;
      const sameLine = Math.abs(it.across - run.across) <= tol;
      const sameDir = it.ux * run.ux + it.uy * run.uy > 0.9;
      if (sameLine && sameDir && gap <= limit && gap >= -limit) {
        // a gap wider than a fraction of the font is a space, not a kern
        const space = gap > Math.max(it.size, run.size) * 0.15;
        run.text += (space && !/\s$/.test(run.text) ? ' ' : '') + it.pr.text;
        run.endAlong = it.along + (it.pr.w || 0);
        run.items.push(it);
        continue;
      }
    }
    runs.push({
      text: it.pr.text, size: it.size, along: it.along, across: it.across,
      ux: it.ux, uy: it.uy,
      endAlong: it.along + (it.pr.w || 0), items: [it]
    });
  }
  if (runs.length === idx.length) return;   // nothing merged
  const drop = new Set();
  for (const run of runs) {
    run.items[0].pr.text = run.text;
    for (let k = 1; k < run.items.length; k++) drop.add(run.items[k].i);
  }
  for (let i = out.length - 1; i >= 0; i--) if (drop.has(i)) out.splice(i, 1);
}

async function pdfInflate(bytes) {
  const ds = new DecompressionStream('deflate');
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(buf);
}

function pdfLatin1(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 8192, bytes.length)));
  }
  return s;
}

// Whole-file entry: object scan (N G obj) -> page objects -> their content
// streams. Pages are laid out left to right: each page's lower-left corner goes
// to (cumulative width, 0), using the MediaBox sizes from the file. Text
// becomes note primitives. Without a page tree every stream parses as one page.
async function parsePdf(bytes) {
  const raw = pdfLatin1(bytes);
  const objRe = /(\d+)\s+(\d+)\s+obj/g;
  const objs = [];
  let om;
  while ((om = objRe.exec(raw))) objs.push({ num: +om[1], bodyAt: objRe.lastIndex, at: om.index });
  const bodyOf = (i) => raw.slice(objs[i].bodyAt, i + 1 < objs.length ? objs[i + 1].at : raw.length);

  const streamTextOf = async (i) => {
    const seg = bodyOf(i);
    const si = seg.indexOf('stream');
    if (si < 0) return null;
    const dict = seg.slice(0, si);
    let start = si + 6;
    if (seg[start] === '\r') start++;
    if (seg[start] === '\n') start++;
    const ei = seg.indexOf('endstream', start);
    if (ei < 0) return null;
    let end = ei;
    const len = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
    if (len && +len[1] > 0 && start + (+len[1]) <= ei) {
      end = start + (+len[1]);
    } else {
      while (end > start) {
        const c = seg.charCodeAt(end - 1);
        if (c === 10 || c === 13 || c === 32 || c === 0) end--;
        else break;
      }
    }
    let body = bytes.subarray(objs[i].bodyAt + start, objs[i].bodyAt + end);
    if (/FlateDecode/.test(dict)) {
      try { body = await pdfInflate(body); } catch (err) {
        // /Length can lie (off by a byte or two): retry with the real stream
        // end, trimmed of the newline the writer put before "endstream"
        let end2 = ei;
        while (end2 > start) {
          const c = seg.charCodeAt(end2 - 1);
          if (c === 10 || c === 13 || c === 32 || c === 0) end2--;
          else break;
        }
        try { body = await pdfInflate(bytes.subarray(objs[i].bodyAt + start, objs[i].bodyAt + end2)); }
        catch (err2) { return null; }
      }
    }
    return pdfLatin1(body);
  };

  // ToUnicode CMaps -> code->text map. One CMap per font: subset fonts from
  // different families reuse the same codes, so a single global map turns some
  // pages into gibberish. The global map stays as the fallback for content
  // whose font resource we cannot resolve.
  const decodeCMapHex = (h) => {
    // <00480065> = two UTF-16BE chars
    const clean = String(h).replace(/[^0-9A-Fa-f]/g, '');
    let out2 = '';
    for (let k = 0; k + 3 < clean.length; k += 4) {
      out2 += String.fromCharCode(parseInt(clean.slice(k, k + 4), 16));
    }
    return out2;
  };
  const cmapTextToMap = (t) => {
    const map = new Map();
    for (const bm of t.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const em of bm[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
        // source code: ONE 16-bit code unit from the last 4 hex digits
        // (Identity-H codes are 2 bytes); our hex-string tokenizer delivers
        // exactly those code units
        map.set(String.fromCharCode(parseInt(em[1].slice(-4), 16)), decodeCMapHex(em[2]));
      }
    }
    for (const rm of t.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      const body = rm[1];
      // <lo> <hi> <dstStart>
      for (const em of body.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
        const lo = parseInt(em[1], 16), hi = parseInt(em[2], 16);
        if (!isFinite(lo) || !isFinite(hi) || hi < lo || hi - lo > 65535) continue;
        const dstBase = parseInt(em[3], 16);
        for (let c = lo; c <= hi; c++) {
          map.set(String.fromCharCode(c), String.fromCharCode(dstBase + (c - lo)));
        }
      }
      // <lo> <hi> [<d1> <d2> ...]
      for (const em of body.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([^\]]*)\]/g)) {
        const lo = parseInt(em[1], 16);
        const dsts = em[3].match(/<[0-9A-Fa-f]+>/g) || [];
        dsts.forEach((d, k) => map.set(String.fromCharCode(lo + k), decodeCMapHex(d)));
      }
    }
    return map;
  };
  const uniMap = new Map();
  for (let i = 0; i < objs.length; i++) {
    const seg = bodyOf(i);
    if (!/begincmap|beginbfchar|beginbfrange/.test(seg)) continue;
    let t = null;
    try { t = await streamTextOf(i); } catch (err) { t = null; }
    if (!t || !/begin(bfchar|bfrange)/.test(t)) continue;
    for (const [k, v] of cmapTextToMap(t)) uniMap.set(k, v);
  }
  // font object -> its ToUnicode CMap object (a font's /ToUnicode may also be
  // a direct stream; only the indirect form is handled here)
  const fontCmapNum = new Map();
  for (let i = 0; i < objs.length; i++) {
    const seg = bodyOf(i);
    if (!/\/Type\s*\/Font\b/.test(seg)) continue;
    const tu = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(seg);
    if (tu) fontCmapNum.set(objs[i].num, +tu[1]);
  }
  const fontUniCache = new Map();   // CMap object number -> Map|null
  const fontUni = async (fontObjNum) => {
    const cmapNum = fontCmapNum.get(fontObjNum);
    if (!cmapNum) return null;
    if (fontUniCache.has(cmapNum)) return fontUniCache.get(cmapNum);
    let map = null;
    const ci = objs.findIndex(o => o.num === cmapNum);
    if (ci >= 0) {
      let t = null;
      try { t = await streamTextOf(ci); } catch (err) { t = null; }
      if (t && /begin(bfchar|bfrange)/.test(t)) map = cmapTextToMap(t);
    }
    fontUniCache.set(cmapNum, map);
    return map;
  };

  const pages = [];
  for (let i = 0; i < objs.length; i++) {
    const seg = bodyOf(i);
    const si = seg.indexOf('stream');
    const dict = si >= 0 ? seg.slice(0, si) : seg;
    if (!/\/Type\s*\/Page\b/.test(dict)) continue;
    const mb = /\/MediaBox\s*\[\s*([+\-0-9.eE]+)\s+([+\-0-9.eE]+)\s+([+\-0-9.eE]+)\s+([+\-0-9.eE]+)\s*\]/.exec(dict);
    const box = mb
      ? [parseFloat(mb[1]), parseFloat(mb[2]), parseFloat(mb[3]), parseFloat(mb[4])]
      : [0, 0, 612, 792];
    const refs = [];
    const cm = /\/Contents\s*\[([^\]]*)\]/.exec(dict);
    if (cm) {
      for (const rm of cm[1].matchAll(/(\d+)\s+\d+\s+R/g)) refs.push(+rm[1]);
    } else {
      const cr = /\/Contents\s+(\d+)\s+\d+\s+R/.exec(dict);
      if (cr) refs.push(+cr[1]);
    }
    // page font resources: /F1 -> font object -> its ToUnicode map. Resources
    // may sit in an indirect object; inherited resources are not followed.
    const fonts = new Map();
    let resSeg = dict;
    const rr = /\/Resources\s+(\d+)\s+\d+\s+R/.exec(dict);
    if (rr) {
      const ri = objs.findIndex(o => o.num === +rr[1]);
      if (ri >= 0) resSeg = bodyOf(ri);
    }
    const fd = /\/Font\s*<<([\s\S]*?)>>/.exec(resSeg);
    if (fd) {
      for (const fm of fd[1].matchAll(/\/([^\s/<>\[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
        const m = await fontUni(+fm[2]);
        if (m) fonts.set(fm[1], m);
      }
    }
    pages.push({ box, refs, fonts });
  }

  const out = [];
  const shiftPrim = (pr, dx, dy) => {
    if (pr.kind === 'note') {
      pr.x += dx;
      pr.y += dy;
      return pr;
    }
    for (const nd of pr.nodes) {
      nd.p[0] += dx; nd.p[1] += dy;
      if (nd.o) { nd.o[0] += dx; nd.o[1] += dy; }
      if (nd.i) { nd.i[0] += dx; nd.i[1] += dy; }
    }
    return pr;
  };

  if (pages.length) {
    const gap = 28.34646;   // 10 mm between pages, in pt
    // Bounding-box driven layout: each page starts after the previous
    // page's REAL right edge (not its nominal MediaBox width), so artwork
    // narrower than the box packs tight and artwork bleeding past the box
    // never overlaps ("menumpuk") the next page.
    let cursor = -Infinity;   // x where the next page's content may start
    let pageNo = 0;
    const spans = [];
    for (const pg of pages) {
      pageNo++;
      const from = out.length;
      let content = '';
      for (const ref of pg.refs) {
        const idx = objs.findIndex(o => o.num === ref);
        if (idx < 0) continue;
        const t = await streamTextOf(idx);
        if (t) content += t + '\n';
      }
      const box = pg.box;
      // origin-normalized: page lower-left at (0, 0)
      const dx = -box[0];
      const dy = -box[1];
      if (content) {
        try {
          for (const pr of pdfContentPrims(content, uniMap, pg.fonts)) out.push(shiftPrim(pr, dx, dy));
        } catch (err) { /* keep going with the other pages */ }
      }
      if (out.length === from) continue;   // empty page: no slot, no marker
      // bounding box of this page's own artwork (vectors and text notes)
      let minX = Infinity, maxX = -Infinity;
      for (let k = from; k < out.length; k++) {
        const pr = out[k];
        if (pr.kind === 'note') {
          if (Number.isFinite(pr.x)) {
            if (pr.x < minX) minX = pr.x;
            if (pr.x > maxX) maxX = pr.x;
          }
          continue;
        }
        for (const nd of pr.nodes) {
          if (nd.p[0] < minX) minX = nd.p[0];
          if (nd.p[0] > maxX) maxX = nd.p[0];
        }
      }
      if (!isFinite(minX)) continue;
      // the first content page keeps its own coordinates; later pages
      // start after the previous page's real right edge plus the gap
      if (isFinite(cursor)) {
        const shift = cursor + gap - minX;
        for (let k = from; k < out.length; k++) shiftPrim(out[k], shift, 0);
        maxX += shift;
      }
      cursor = maxX;
      spans.push({ from, to: out.length, n: pageNo });
    }
    // multi-page documents get a marker comment above each page (in pt:
    // 34pt = 12mm above the page content)
    if (spans.length >= 2) {
      for (let i = 0; i < spans.length; i++) {
        let minX = Infinity, maxY = -Infinity;
        for (let k = spans[i].from; k < spans[i].to; k++) {
          for (const nd of out[k].nodes) {
            if (nd.p[0] < minX) minX = nd.p[0];
            if (nd.p[1] > maxY) maxY = nd.p[1];
          }
        }
        if (!isFinite(minX)) continue;
        out.push({ kind: 'note', x: minX, y: maxY + 34, text: '=== Page ' + spans[i].n + ' ===', pageLabel: true, color: null, closed: false, nodes: [] });
      }
    }
    return out;
  }

  // no page tree found: parse every content-looking stream as one page
  for (let i = 0; i < objs.length; i++) {
    const t = await streamTextOf(i);
    if (!t || t.length < 8) continue;
    if (!/[mnlcre]\s/.test(t)) continue;
    try {
      for (const pr of pdfContentPrims(t, uniMap)) out.push(pr);
    } catch (err) { /* not a content stream after all */ }
  }
  return out;
}

// ---- CDR (CorelDRAW) -------------------------------------------------------
// Reader for the modern "zcf" CDR container (X4+, tested on X7): a ZIP whose
// content/root.dat is a RIFF tree of object records ("loda"), with the heavy
// data in external streams (content/data/*.dat). The decode rules (coordinate
// units, point-type bits, argument types) follow LibreOffice's libcdr — see
// CDRParser::readLoda / _redirectX6Chunk and CommonParser::processPath.
// Output is the same node/handle primitive shape as the PDF reader, in mm.

function cdrUnzip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // end-of-central-directory: scan back for its signature
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65558); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = dv.getUint16(eocd + 10, true);
  let pos = dv.getUint32(eocd + 16, true);
  const out = new Map();
  for (let n = 0; n < count && pos + 46 <= bytes.length; n++) {
    if (dv.getUint32(pos, true) !== 0x02014b50) break;
    const method = dv.getUint16(pos + 10, true);
    const compSize = dv.getUint32(pos + 20, true);
    const nameLen = dv.getUint16(pos + 28, true);
    const extraLen = dv.getUint16(pos + 30, true);
    const cmtLen = dv.getUint16(pos + 32, true);
    const localOff = dv.getUint32(pos + 42, true);
    const name = pdfLatin1(bytes.subarray(pos + 46, pos + 46 + nameLen)).replace(/\\/g, '/');
    // local header: skip its own name/extra to reach the data
    const lName = dv.getUint16(localOff + 26, true);
    const lExtra = dv.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lName + lExtra;
    out.set(name, { method, bytes: bytes.subarray(dataStart, dataStart + compSize) });
    pos += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

async function cdrEntryBytes(entry) {
  if (!entry) return null;
  if (entry.method === 0) return entry.bytes;
  const ds = new DecompressionStream('deflate-raw');
  const buf = await new Response(new Blob([entry.bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(buf);
}

// zlib inflate that tolerates trailing junk after the stream end (the legacy
// CDR "cmpr" records pad the compressed block): the writer is fed in small
// chunks and everything decoded before the complaint is kept.
async function cdrInflateZlib(bytes) {
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  const out = [];
  let err = null;
  const pump = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        out.push(value);
      }
    } catch (e) { err = e; }
  })();
  try {
    for (let i = 0; i < bytes.length; i += 256) await writer.write(bytes.subarray(i, i + 256));
    await writer.close();
  } catch (e) { err = e; }
  await pump;
  const total = out.reduce((s, a) => s + a.length, 0);
  if (!total) {
    if (err && !/junk/i.test(String(err.message || err))) throw err;
    return new Uint8Array(0);
  }
  const res = new Uint8Array(total);
  let o = 0;
  for (const a of out) { res.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), o); o += a.length; }
  return res;
}

// RIFF walk: yields { id, body, size } leaves and { id:'LIST', form, body, size } nodes.
// Legacy (X4 era) containers compress whole subtrees into "cmpr" lists: a zlib
// stream of the real chunk tree plus a second, equally compressed table of
// chunk lengths — inside that tree a chunk's size field is an INDEX into the
// table. Ported from libcdr CDRParser::parseRecords.
async function cdrRiffChunks(buf, off, end, depth, out, blockLengths) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const table = blockLengths || [];
  while (off + 8 <= end) {
    const id = pdfLatin1(buf.subarray(off, off + 4));
    let size = dv.getUint32(off + 4, true);
    if (size < table.length) size = table[size];
    const body = off + 8;
    const stop = body + size;
    if (size < 0 || stop > end) break;
    if (id === 'RIFF' || id === 'LIST') {
      // RIFF form ids are space-padded: "obj ", "trfl", "lgob"...
      const form = pdfLatin1(buf.subarray(body, body + 4)).trim();
      if (form === 'cmpr' && size >= 48 &&
        pdfLatin1(buf.subarray(body + 20, body + 24)) === 'CPng') {
        const cmprsize = dv.getUint32(body + 4, true);
        const z = body + 28;
        if (z + cmprsize <= stop) {
          try {
            const content = await cdrInflateZlib(buf.subarray(z, z + cmprsize));
            let tbl = [];
            try {
              const raw = await cdrInflateZlib(buf.subarray(z + cmprsize, stop));
              const tdv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
              for (let i = 0; i + 4 <= raw.length; i += 4) tbl.push(tdv.getUint32(i, true));
            } catch (err2) { tbl = []; }
            await cdrRiffChunks(content, 0, content.length, depth + 1, out, tbl);
          } catch (err) { /* skip a broken compressed list */ }
        }
      } else {
        out.push({ id, form, body: body + 4, size: size - 4, depth, buf });
        await cdrRiffChunks(buf, body + 4, stop, depth + 1, out, table);
      }
    } else {
      out.push({ id, body, size, depth, buf });
    }
    off = stop + (size & 1);
  }
  return out;
}

function cdrReadU16(dv, o) { return dv.getUint16(o, true); }
function cdrReadU32(dv, o) { return dv.getUint32(o, true); }
function cdrReadS32(dv, o) { return dv.getInt32(o, true); }

// Coordinate unit: signed 32-bit at 254000 units per inch = 1/10000 mm.
function cdrCoord(v) { return v / 10000; }

function cdrColorOf(dv, o, version) {
  if (o + 10 > dv.byteLength) return null;
  const model = cdrReadU16(dv, o);
  const value = cdrReadU32(dv, o + 8);
  const b0 = value & 0xff, b1 = (value >> 8) & 0xff, b2 = (value >> 16) & 0xff, b3 = (value >>> 24) & 0xff;
  const hex = (v) => {
    const s = Math.round(Math.max(0, Math.min(1, v))).toString(16);
    return s.length < 2 ? '0' + s : s;
  };
  const byte = (v) => {
    const s = Math.round(Math.max(0, Math.min(255, v))).toString(16);
    return s.length < 2 ? '0' + s : s;
  };
  if (model === 0x01 || model === 0x19) return '#' + byte(b0) + byte(b1) + byte(b2);        // RGB
  if (model === 0x08) return b0 ? '#000000' : '#ffffff';                                     // BW
  if (model === 0x09) return '#' + byte(b0) + byte(b0) + byte(b0);                           // gray
  if (model === 0x03) {                                                                      // CMYK
    return '#' + byte(255 * (1 - b0 / 255) * (1 - b3 / 255)) + byte(255 * (1 - b1 / 255) * (1 - b3 / 255)) + byte(255 * (1 - b2 / 255) * (1 - b3 / 255));
  }
  return null;
}

// processPath port: point type bits -> node/handle primitives. One record can
// hold several subpaths (a moveTo starts a new one).
function cdrPathPrims(points, types) {
  const out = [];
  let nodes = null;
  let c1 = null, c2 = null;
  let closed = false;
  const flush = () => {
    if (nodes && nodes.length >= 2) out.push({ color: null, closed, nodes });
    nodes = null;
    c1 = c2 = null;
    closed = false;
  };
  for (let k = 0; k < points.length; k++) {
    const t = types[k];
    const seg = (t & 0x40 ? 1 : 0) + (t & 0x80 ? 2 : 0);
    if (seg === 0) {
      flush();
      nodes = [{ p: [points[k][0], points[k][1]], o: null, i: null }];
    } else if (!nodes) {
      nodes = [{ p: [points[k][0], points[k][1]], o: null, i: null }];
    } else if (seg === 1) {
      nodes.push({ p: [points[k][0], points[k][1]], o: null, i: null });
    } else if (seg === 3) {
      if (!c1) c1 = points[k];
      else c2 = points[k];
    } else {
      // cubic end node: the two 0xC0 points before it are its control points
      if (c1 && c2) {
        nodes[nodes.length - 1].o = [c1[0], c1[1]];
        nodes.push({ p: [points[k][0], points[k][1]], o: null, i: [c2[0], c2[1]] });
      } else {
        nodes.push({ p: [points[k][0], points[k][1]], o: null, i: null });
      }
      c1 = c2 = null;
    }
    if (t & 0x08) closed = true;
  }
  flush();
  return out;
}

// trfd chunk -> { v0, v1, x0, v3, v4, y0 } with x0/y0 in mm.
function cdrTrfdMatrix(dv, body, size, version) {
  const numOfArgs = Math.min(cdrReadU32(dv, body + 4), 16);
  const startOfArgs = cdrReadU32(dv, body + 8);
  for (let i = 0; i < numOfArgs; i++) {
    const off = body + cdrReadU32(dv, body + startOfArgs + 4 * i);
    if (off + 10 > body + size) continue;
    let p = off + (version >= 1300 ? 8 : 0);
    const type = cdrReadU16(dv, p);
    p += 2;
    if (type !== 0x08) continue;
    if (version >= 600) p += 6;
    const f = (o) => dv.getFloat64(o, true);
    return {
      v0: f(p), v1: f(p + 8), x0: f(p + 16) / 10000,
      v3: f(p + 24), v4: f(p + 32), y0: f(p + 40) / 10000
    };
  }
  return null;
}

function cdrTrafoApply(t, x, y) {
  if (!t) return [x, y];
  return [t.v0 * x + t.v1 * y + t.x0, t.v3 * x + t.v4 * y + t.y0];
}

// txsm, versions 800..1599 (libcdr readTxsm middle branch)
function cdrTxsmTextLegacy(buf, version) {
  const dv = new DataView(buf.buffer, buf.byteOffset);
  const end = buf.length;
  const u32 = (p) => cdrReadU32(dv, p);
  let text = '';
  try {
    let p = 0;
    const frameFlag = u32(p); p += 4;
    p += 32;                                    // fixed header block
    if (version >= 1500) p += 1;
    const numFrames = u32(p); p += 4;
    for (let f = 0; f < numFrames && p < end; f++) {
      p += 4;                                   // frameId
      p += 48;                                  // frame trafo (6 doubles)
      if (version > 700) {
        const onPath = u32(p); p += 4;
        if (onPath === 1) {
          p += 4;                               // var1
          if (version > 1200) p += 8;           // orientation + var2
          p += 28;                              // var3..mirrorH
        } else if (version >= 1500) p += 8;
      }
      if (!frameFlag) {
        if (version >= 1500) p += 40;
        else if (version >= 1400) p += 36;
        else if (version > 800) p += 34;
        else if (version >= 800) p += 32;
      } else if (version >= 1500) p += 4;
    }
    const numPara = u32(p); p += 4;
    for (let j = 0; j < numPara && p < end; j++) {
      p += 4;                                   // style id
      p += 1;
      if (version > 1200 && frameFlag) p += 1;
      const numStyles = Math.min(u32(p), 64); p += 4;
      for (let i = 0; i < numStyles && p < end; i++) {
        p += 2;                                 // num chars using this style
        const fl2 = buf[p]; p += 1;
        const fl3 = version >= 800 ? buf[p] : 0; p += 1;
        if (fl2 & 0x01) p += 4;                 // fontId + charSet
        if (fl2 & 0x02) p += 4;
        if (fl2 & 0x04) p += 4;                 // font size (coordinate)
        if (fl2 & 0x08) p += 4;
        if (fl2 & 0x10) p += 4;
        if (fl2 & 0x20) p += 4;
        if (fl2 & 0x40) p += 4 + (version >= 1300 ? 48 : 0);   // fill
        if (fl2 & 0x80) p += 4;                                // outline
        if (fl3 & 0x08) {
          if (version >= 1300) {
            const tlen = u32(p); p += 4 + tlen * 2;
          } else p += 4;
        }
        if (fl3 & 0x20) {
          const flag = buf[p];
          if (flag) p += 4 + (version >= 1500 ? 48 : 0);
        }
      }
      const numChars = u32(p); p += 4;
      p += numChars * (version >= 1200 ? 8 : 4);   // char descriptions
      let numBytes = numChars;
      if (version >= 1200) { numBytes = u32(p); p += 4; }
      if (p + numBytes > end) break;
      text += pdfLatin1(buf.subarray(p, p + numBytes));
      p += numBytes + 1;                        // 0 ending character
    }
    return text.replace(/\u0000/g, '').trim();
  } catch (err) {
    return text;
  }
}

// txsm -> the text string, best effort. X6+ (>=1600) uses the readTxsm16
// layout below; versions 800..1599 use the older generic layout ported from
// libcdr CDRParser::readTxsm (the branch between readTxsm6 and readTxsm16).
function cdrTxsmText(buf, version) {
  if (version < 800) return '';
  if (version >= 800 && version < 1600) return cdrTxsmTextLegacy(buf, version);
  const dv = new DataView(buf.buffer, buf.byteOffset);
  const end = buf.length;
  try {
    let p = 0;
    const u32 = () => { const v = cdrReadU32(dv, p); p += 4; return v; };
    const frameFlag = u32();
    p += 37;
    const numFrames = u32();
    for (let f = 0; f < numFrames && p < end; f++) {
      u32();                                  // frameId
      p += 48;
      const onPath = u32();
      if (onPath === 1) p += 48;
      else p += 8;
      if (!frameFlag) {
        p += 16;
        const tlen = u32();
        p += tlen * (version > 1600 ? 1 : 2);
      }
    }
    const numPara = u32();
    let text = '';
    for (let j = 0; j < numPara && p < end; j++) {
      u32();                                  // style id
      p += frameFlag ? 2 : 1;
      let styleLen = u32();
      if (version < 1700) styleLen *= 2;
      p += styleLen;
      const numRecords = u32();
      for (let i = 0; i < numRecords && p + 17 <= end; i++) {
        p += 2;
        const stFlag1 = cdrReadU16(dv, p); p += 2;
        const stFlag2 = cdrReadU16(dv, p); p += 2;
        if (stFlag2 & 0x04) {
          const encLen = u32() * 2;
          p += encLen;
        }
        if (stFlag1 || (stFlag2 & 0x04)) {
          let jsonLen = u32();
          if (version < 1700) jsonLen *= 2;
          p += jsonLen;
        }
      }
      const numChars = u32();
      p += numChars * 8;
      const numBytes = u32();
      if (p + numBytes > end) break;
      text += pdfLatin1(buf.subarray(p, p + numBytes));
      p += numBytes + 1;
    }
    // X6+ stores the string as UTF-8-ish bytes; latin1 above keeps it readable
    return text.replace(/\u0000/g, '').trim();
  } catch (err) {
    return '';
  }
}

// readRectangle port: builds the local rect path (x0,y0 extents from the
// origin), rounded corners as quadratic Bezier -> cubic nodes.
function cdrRectNodes(x0, y0, r0, r1, r2, r3, cornerType, scaleX, scaleY) {
  const quad = (p0, q, p2) => ({
    t: 'c',
    a: [p0[0] + 2 / 3 * (q[0] - p0[0]), p0[1] + 2 / 3 * (q[1] - p0[1])],
    b: [p2[0] + 2 / 3 * (q[0] - p2[0]), p2[1] + 2 / 3 * (q[1] - p2[1])],
    p: p2
  });
  const segs = [];
  const line = (p) => segs.push({ t: 'l', p });
  const corner = (base, apex, next, r, sx, sy) => {
    if (r <= 0) { line(apex); return; }
    if (cornerType === 2) { line([apex[0], apex[1]]); return; }
    if (cornerType === 1) {
      line([base[0] + (apex[0] - base[0]), base[1] + (apex[1] - base[1])]);
      line(apex);
      line(next);
      return;
    }
    // cornerType 0: true quarter-round through the apex
    segs.push(quad(base, apex, next));
  };
  const start = r0 > 0 ? [0, -r0 / scaleY] : [0, 0];
  segs.push({ t: 'm', p: start });
  const y1 = y0;
  if (r1 > 0) {
    line([0, y1 + r1 / scaleY]);
    corner([0, y1], [0, y1], [r1 / scaleX, y1], r1, scaleX, scaleY);
  } else line([0, y1]);
  if (r2 > 0) {
    line([x0 - r2 / scaleX, y1]);
    corner([x0, y1], [x0, y1], [x0, y1 + r2 / scaleY], r2, scaleX, scaleY);
  } else line([x0, y1]);
  if (r3 > 0) {
    line([x0, -r3 / scaleY]);
    corner([x0, 0], [x0, 0], [x0 - r3 / scaleX, 0], r3, scaleX, scaleY);
  } else line([x0, 0]);
  if (r0 > 0) {
    line([r0 / scaleX, 0]);
    corner([0, 0], [0, 0], [0, -r0 / scaleY], r0, scaleX, scaleY);
  } else line([0, 0]);
  return cdrSegsToNodes(segs, true);
}

// readEllipse port: x,y are full diameters; angles in radians (readAngle).
function cdrEllipseNodes(x, y, angle1, angle2, pie) {
  const cx = x / 2, cy = y / 2;
  const rx = Math.abs(cx), ry = Math.abs(cy);
  const segs = [];
  const arcSeg = (a0, a1) => {
    // <= 90 degree spans as cubics (kappa per span), Y flipped like libcdr
    const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2 - 1e-9)));
    for (let k = 0; k < n; k++) {
      const t0 = a0 + (a1 - a0) * (k / n);
      const t1 = a0 + (a1 - a0) * ((k + 1) / n);
      const dt = t1 - t0;
      const kk = 4 / 3 * Math.tan(dt / 4);
      const p0 = [cx + rx * Math.cos(t0), cy - ry * Math.sin(t0)];
      const p3 = [cx + rx * Math.cos(t1), cy - ry * Math.sin(t1)];
      const c1 = [p0[0] - kk * rx * Math.sin(t0), p0[1] - kk * ry * Math.cos(t0)];
      const c2 = [p3[0] + kk * rx * Math.sin(t1), p3[1] + kk * ry * Math.cos(t1)];
      segs.push({ t: 'c', a: c1, b: c2, p: p3 });
    }
  };
  let a1 = angle1, a2 = angle2;
  while (a2 < a1) a2 += Math.PI * 2;
  const full = Math.abs(a2 - a1) < 1e-9;
  if (full) { a1 = 0; a2 = Math.PI * 2; }
  const x0 = cx + rx * Math.cos(a1), y0 = cy - ry * Math.sin(a1);
  segs.push({ t: 'm', p: [x0, y0] });
  arcSeg(a1, a2);
  if (pie) {
    segs.push({ t: 'l', p: [cx, cy] });
    segs.push({ t: 'l', p: [x0, y0] });
    return cdrSegsToNodes(segs, true);
  }
  const out = cdrSegsToNodes(segs, full);
  // a full ellipse with equal radii is a true circle
  if (full && Math.abs(rx - ry) < 1e-9 * Math.max(rx, ry)) {
    out.circleR = rx;
    out.circleC = [cx, cy];
  }
  return out;
}

// segments (m/l/c in order) -> node/handle list, the primitive shape
function cdrSegsToNodes(segs, closed) {
  const nodes = [];
  for (const s of segs) {
    if (s.t === 'm') nodes.push({ p: [s.p[0], s.p[1]], o: null, i: null });
    else if (s.t === 'l') nodes.push({ p: [s.p[0], s.p[1]], o: null, i: null });
    else {
      if (nodes.length) nodes[nodes.length - 1].o = [s.a[0], s.a[1]];
      nodes.push({ p: [s.p[0], s.p[1]], o: null, i: [s.b[0], s.b[1]] });
    }
  }
  return { color: null, closed: !!closed, nodes };
}

// rectangle record (v1500+ layout) -> node primitives
function cdrReadRect(dv, o, version) {
  let p = o;
  const coord = () => { const v = cdrReadS32(dv, p); p += 4; return cdrCoord(v); };
  // X5+ (>=1500) stores rect coordinates as float64 in 1/254000 inch
  // (libcdr readRectCoord); older files use the plain S32 coordinate
  const rectCoord = () => {
    if (version < 1500) return coord();
    const v = dv.getFloat64(p, true); p += 8;
    return v / 10000;
  };
  const dbl = () => { const v = dv.getFloat64(p, true); p += 8; return v; };
  const x0 = rectCoord(), y0 = rectCoord();
  let r3 = 0, r2 = 0, r1 = 0, r0 = 0, cornerType = 0, scaleX = 1, scaleY = 1;
  if (version < 1500) {
    r3 = rectCoord();
    r2 = version < 900 ? r3 : rectCoord();
    r1 = version < 900 ? r3 : rectCoord();
    r0 = version < 900 ? r3 : rectCoord();
  } else {
    let s = dbl(); if (Math.abs(s) > 1e-12) scaleX = s;
    s = dbl(); if (Math.abs(s) > 1e-12) scaleY = s;
    const scaleWith = dv.getUint8(p); p += 1;
    p += 7;
    if (scaleWith === 0) {
      r3 = dbl();
      cornerType = dv.getUint8(p); p += 1;
      p += 15;
      r2 = dbl();
      p += 16;
      r1 = dbl();
      p += 16;
      r0 = dbl();
      const w = Math.abs(x0 * scaleX / 2), h = Math.abs(y0 * scaleY / 2);
      const m = Math.min(w, h) || 1;
      r3 *= m; r2 *= m; r1 *= m; r0 *= m;
    } else {
      r3 = rectCoord();
      cornerType = dv.getUint8(p); p += 1;
      p += 15;
      r2 = rectCoord();
      p += 16;
      r1 = rectCoord();
      p += 16;
      r0 = rectCoord();
    }
  }
  return cdrRectNodes(x0, y0, r0, r1, r2, r3, cornerType, scaleX, scaleY);
}

// ellipse record -> node primitives
function cdrReadEllipse(dv, o) {
  const x = cdrCoord(cdrReadS32(dv, o));
  const y = cdrCoord(cdrReadS32(dv, o + 4));
  const angle1 = Math.PI * cdrReadS32(dv, o + 8) / 180000000;
  const angle2 = Math.PI * cdrReadS32(dv, o + 12) / 180000000;
  const pie = cdrReadU32(dv, o + 16) !== 0;
  return cdrEllipseNodes(x, y, angle1, angle2, pie);
}

async function parseCdr(bytes) {
  let root = null;
  const zip = cdrUnzip(bytes);
  if (zip) {
    // modern "zcf" stores content/root.dat; the X4/X5 layout (CDRF) keeps the
    // whole RIFF tree in content/riffData.cdr
    const rootEntry = zip.get('content/root.dat') || zip.get('content/riffData.cdr');
    if (!rootEntry) return [];
    root = await cdrEntryBytes(rootEntry);
  } else if (pdfLatin1(bytes.subarray(0, 4)) === 'RIFF') {
    // legacy (X4 era) container: the file itself is the RIFF tree
    root = bytes;
  } else {
    return [];
  }
  const chunks = await cdrRiffChunks(root, 12, root.length, 0, []);
  const dvRoot = new DataView(root.buffer, root.byteOffset);

  // version from the vrsn chunk (1700 = X7; legacy files carry a u16).
  // zipped X4/X6-era files can carry vrsn = 0: fall back to the RIFF form
  // letter ("CDRD" = 1300 ... "CDRH" = 1600), like libcdr getCDRVersion —
  // the txsm text layout depends on getting this right.
  let version = 0;
  for (const c of chunks) {
    if (c.id !== 'vrsn') continue;
    const dv = new DataView(c.buf.buffer, c.buf.byteOffset, c.buf.byteLength);
    if (c.size >= 12) version = cdrReadU32(dv, c.body + 8);
    else if (c.size >= 2) version = cdrReadU16(dv, c.body);
    break;
  }
  if (!version) {
    const formChar = pdfLatin1(root.subarray(8, 9));
    const formVer = formChar >= 'A' && formChar <= 'Z' ? 100 * (formChar.charCodeAt(0) - 55) : 0;
    if (formVer >= 300) version = formVer;
  }
  if (!version) version = 1700;

  // external streams: content/data/* listed by content/dataFileList.dat
  const listEntry = zip ? zip.get('content/dataFileList.dat') : null;
  const names = listEntry
    ? pdfLatin1(await cdrEntryBytes(listEntry)).split(/\r?\n/).map(s => s.trim()).filter(Boolean)
    : [];
  const streams = [];
  for (const n of names) {
    const e = zip.get('content/data/' + n) || zip.get(n);
    streams.push(e ? await cdrEntryBytes(e) : null);
  }

  // line styles first: outl chunks give the colour of each outline id
  const styles = new Map();
  for (const c of chunks) {
    if (c.id !== 'outl' || c.size < 12) continue;
    const dv = new DataView(c.buf.buffer, c.buf.byteOffset, c.buf.byteLength);
    const id = cdrReadU32(dv, c.body);
    // version >= 1300: (record id u32, length u32) blocks until record id 1
    let p = c.body + 4;
    if (version >= 1300) {
      for (let guard = 0; guard < 64 && p + 8 <= c.body + c.size; guard++) {
        const rid = cdrReadU32(dv, p);
        const rlen = cdrReadU32(dv, p + 4);
        p += 8;
        if (rid === 1) break;
        p += rlen;
      }
    }
    // lineType u16, caps u16, join u16, width coord, stretch u16, pad 2,
    // angle, pad 46 (>=1300), then the colour (u16 model, u16 palette, pad 4, u32 value)
    const colorAt = p + 6 + 4 + 2 + 2 + 4 + (version >= 1300 ? 46 : 52);
    styles.set(id, cdrColorOf(dv, colorAt, version));
  }

  const out = [];
  // geometry objects live in LIST:obj blocks together with their trfd
  // transform and, for text, their txsm string record
  const groups = [];
  let objGroup = null;
  let pageIdx = -1;
  for (const c of chunks) {
    if (c.id === 'LIST' && c.form === 'page') {
      // multi-page file: remember which page every object belongs to
      pageIdx++;
      objGroup = null;
      continue;
    }
    if (c.id === 'LIST' && c.form === 'obj') {
      objGroup = { depth: c.depth, items: [], page: pageIdx };
      groups.push(objGroup);
      continue;
    }
    if (objGroup && c.depth > objGroup.depth) {
      objGroup.items.push(c);
      continue;
    }
    objGroup = null;
    if (c.id === 'loda') groups.push({ depth: -1, items: [c], page: pageIdx });
  }

  // multi-page documents lay out left to right: each page starts after
  // the previous page's REAL right edge (page width + 10mm is only the
  // minimum gap), so a page whose artwork bleeds past its box — or whose
  // master-page residue sits elsewhere — never overlaps ("menumpuk")
  // the page before it. Page 0 is the master/cover residue and keeps its
  // own coordinates; content pages 1..N slot in after it.
  const PG_GAP = 10;   // mm between pages

  // X6+ chunks can be 16-byte redirect stubs into the external streams:
  // (stream number, payload length, offset in stream, 0)
  const resolveChunk = (c) => {
    const buf = c.buf || root;
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    if (c.size === 16 && version >= 1600) {
      const stream = cdrReadU32(dv, c.body);
      const len = cdrReadU32(dv, c.body + 4);
      const off = cdrReadU32(dv, c.body + 8);
      const src = streams[stream];
      if (!src || off + len > src.length) return null;
      return { buf: src, base: off, size: len };
    }
    return { buf, base: c.body, size: c.size };
  };

  const pageSpans = [];
  let pgCursor = -Infinity;   // right edge of the previous page's real bbox
  // measure prims[from..to) -> [minX, maxX]; circles use cx±r, text uses .x
  const cdrSpanBox = (from, to) => {
    let loX = Infinity, hiX = -Infinity;
    for (let i = from; i < to; i++) {
      const pr = out[i];
      if (pr.kind === 'note') {
        if (Number.isFinite(pr.x)) {
          if (pr.x < loX) loX = pr.x;
          if (pr.x > hiX) hiX = pr.x;
        }
        continue;
      }
      if (pr.kind === 'circle') {
        if (Number.isFinite(pr.cx) && Number.isFinite(pr.r)) {
          if (pr.cx - pr.r < loX) loX = pr.cx - pr.r;
          if (pr.cx + pr.r > hiX) hiX = pr.cx + pr.r;
        }
        continue;
      }
      for (const nd of pr.nodes) {
        if (!Number.isFinite(nd.p[0])) continue;
        if (nd.p[0] < loX) loX = nd.p[0];
        if (nd.p[0] > hiX) hiX = nd.p[0];
      }
    }
    return [loX, hiX];
  };
  // shift prims[from..to) right by dx (vectors, circle centres, text notes)
  const cdrShiftX = (from, to, dx) => {
    for (let i = from; i < to; i++) {
      const pr = out[i];
      if (pr.kind === 'note') { pr.x += dx; continue; }
      if (pr.kind === 'circle') { pr.cx += dx; continue; }
      for (const nd of pr.nodes) {
        nd.p[0] += dx;
        if (nd.o) nd.o[0] += dx;
        if (nd.i) nd.i[0] += dx;
      }
    }
  };
  for (const g of groups) {
    const spanFrom = out.length;
    let trafo = null;
    let textStr = null;
    let lodaChunk = null;
    for (const c of g.items) {
      if (c.id === 'trfd') {
        const r = resolveChunk(c);
        if (r) trafo = cdrTrfdMatrix(new DataView(r.buf.buffer, r.buf.byteOffset), r.base, r.size, version);
      } else if (c.id === 'txsm') {
        const r = resolveChunk(c);
        if (r) textStr = cdrTxsmText(r.buf.subarray(r.base, r.base + r.size), version);
      } else if (c.id === 'loda') lodaChunk = c;
    }
    // Defer the page shift until AFTER the primitives are built: parse at
    // native coordinates, measure this group's real bbox, then shift to
    // start after the previous page's right edge. (The old code folded a
    // guessed shift into the trafo up front, which double-shifted rects
    // and ellipses whose handles were transformed twice.)
    if (!lodaChunk) continue;

    const res = resolveChunk(lodaChunk);
    if (!res) continue;
    const buf = res.buf;
    const base = res.base;
    const size = res.size;
    if (size < 20) continue;
    const dv = new DataView(buf.buffer, buf.byteOffset);
    const numOfArgs = Math.min(cdrReadU32(dv, base + 4), 64);
    const startOfArgs = cdrReadU32(dv, base + 8);
    const startOfTypes = cdrReadU32(dv, base + 12);
    const chunkType = cdrReadU32(dv, base + 16);
    let coords = null;
    let styleId = 0;
    for (let i = 0; i < numOfArgs; i++) {
      const off = cdrReadU32(dv, base + startOfArgs + 4 * i);
      const type = cdrReadU32(dv, base + startOfTypes + 4 * (numOfArgs - 1 - i));   // stored reversed
      if (type === 0x1e) coords = base + off;
      else if (type === 0x0a) styleId = cdrReadU32(dv, base + off) >>> 0;
    }
    if (coords == null || coords + 4 > buf.length) continue;

    if (chunkType === 0x04 || chunkType === 0x06) {
      // text object -> a comment at its anchor
      const ax = cdrCoord(cdrReadS32(dv, coords)) ;
      const ay = cdrCoord(cdrReadS32(dv, coords + 4));
      const at = cdrTrafoApply(trafo, ax, ay);
      // CDR text has no reliable size in the chunk we read: 5 mm is the usual
      // CAD lettering height, and the importer's text-frame fit refines it
      if (textStr) {
        // the group/frame transform also carries the text's rotation: keep its
        // baseline/up directions so a rotated label imports rotated
        let ux = 1, uy = 0, vx = 0, vy = 1;
        if (trafo) {
          const al = Math.hypot(trafo.v0, trafo.v3) || 1;
          const bl = Math.hypot(trafo.v1, trafo.v4) || 1;
          ux = trafo.v0 / al; uy = trafo.v3 / al;
          vx = trafo.v1 / bl; vy = trafo.v4 / bl;
        }
        out.push({ kind: 'note', x: at[0], y: at[1], text: textStr,
          size: 5, ux, uy, vx, vy, color: null, closed: false, nodes: [] });
      }
      pageSpans.push({ page: g.page, from: spanFrom, to: out.length });
      continue;
    }
    if (chunkType !== 0x03 && chunkType !== 0x14) {
      // rectangle / ellipse records carry their shape inline (no coords arg)
      let shape = null;
      if (chunkType === 0x01) shape = cdrReadRect(dv, coords, version);
      else if (chunkType === 0x02) shape = cdrReadEllipse(dv, coords);
      if (!shape || shape.nodes.length < 2) continue;
      const pts = shape.nodes.map(nd => cdrTrafoApply(trafo, nd.p[0], nd.p[1]));
      const color = (styleId && styles.get(styleId)) || null;
      const nodes = shape.nodes.map((nd, k) => ({
        p: pts[k],
        o: nd.o ? cdrTrafoApply(trafo, nd.o[0], nd.o[1]) : null,
        i: nd.i ? cdrTrafoApply(trafo, nd.i[0], nd.i[1]) : null
      }));
      // an unrotated circular ellipse stays a real circle entity
      const m = trafo || { v0: 1, v1: 0, x0: 0, v3: 0, v4: 1, y0: 0 };
      const linear = Math.abs(m.v1) < 1e-9 && Math.abs(m.v3) < 1e-9;
      if (chunkType === 0x02 && shape.circleR > 0 && linear && Math.abs(m.v0) > 1e-9 && Math.abs(Math.abs(m.v0) - Math.abs(m.v4)) < 1e-6 * Math.abs(m.v0)) {
        const c = cdrTrafoApply(trafo, shape.circleC[0], shape.circleC[1]);
        out.push({ kind: 'circle', cx: c[0], cy: c[1], r: shape.circleR * Math.abs(m.v0), color, closed: true, nodes: [] });
      } else {
        out.push({ color, closed: shape.closed, nodes });
      }
      pageSpans.push({ page: g.page, from: spanFrom, to: out.length });
      continue;
    }

    const count = cdrReadU16(dv, coords);
    const pts = [], types = [];
    let p = coords + 4;
    for (let k = 0; k < count && p + 8 <= buf.length; k++, p += 8) {
      pts.push(cdrTrafoApply(trafo, cdrCoord(cdrReadS32(dv, p)), cdrCoord(cdrReadS32(dv, p + 4))));
    }
    for (let k = 0; k < count && p < buf.length; k++, p++) {
      types.push(buf[p]);
    }
    const color = (styleId && styles.get(styleId)) || null;
    for (const prim of cdrPathPrims(pts, types)) {
      prim.color = color;
      out.push(prim);
    }
    pageSpans.push({ page: g.page, from: spanFrom, to: out.length });
  }
  // bounding-box page placement: measure each page's REAL combined bbox
  // (across all its groups), then shift whole pages so page P starts
  // after page P-1's right edge plus the gap. Page 0 is master/cover
  // residue and keeps its own coordinates.
  {
    const pagesSeen = [];
    for (const s of pageSpans) {
      if (s.page > 0 && pagesSeen.indexOf(s.page) < 0) pagesSeen.push(s.page);
    }
    pagesSeen.sort((a, b) => a - b);
    for (const pg of pagesSeen) {
      let from = Infinity, to = -Infinity;
      for (const s of pageSpans) {
        if (s.page !== pg) continue;
        if (s.from < from) from = s.from;
        if (s.to > to) to = s.to;
      }
      if (!isFinite(from) || to <= from) continue;
      const [loX, hiX] = cdrSpanBox(from, to);
      if (!isFinite(loX)) continue;
      if (isFinite(pgCursor)) {
        const need = pgCursor + PG_GAP - loX;
        if (need > 0) {
          cdrShiftX(from, to, need);
          pgCursor = hiX + need;
        } else {
          pgCursor = hiX;
        }
      } else {
        pgCursor = hiX;
      }
    }
    // fix up the recorded spans: shifting a page moves every group inside
    // it — recompute is unnecessary since marker code only reads bbox, but
    // spans stay valid as ranges (the prims themselves moved in place)
  }
  // multi-page documents get a marker comment above each page
  const maxPage = pageSpans.reduce((m, s) => Math.max(m, s.page), -1);
  if (maxPage >= 2) {
    for (let pg = 1; pg <= maxPage; pg++) {
      let minX = Infinity, maxY = -Infinity;
      for (const s of pageSpans) {
        if (s.page !== pg) continue;
        for (let i = s.from; i < s.to; i++) {
          for (const nd of out[i].nodes) {
            if (nd.p[0] < minX) minX = nd.p[0];
            if (nd.p[1] > maxY) maxY = nd.p[1];
          }
        }
      }
      if (!isFinite(minX)) continue;
      out.push({ kind: 'note', x: minX, y: maxY + 12, text: '=== Page ' + pg + ' ===', pageLabel: true, color: null, closed: false, nodes: [] });
    }
  }
  return out;
}

// Node export for tests/smoke.js; in the browser `module` does not exist.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TAU, SPLINE_SEG, ARC_SEG,
    clamp, dist, norm2pi, wrapPi, wrapDeg, normDeg,
    MAT_ID, matMul, matApply, matDet, matIsSimilarity, parseTransformList,
    svgArcToCubics, svgPathSegments, svgSegmentsToSubpaths,
    cubicAt, splitCubic, autoHandles, splineSamples, splineFrame, splineCubics, sampleArc, arcCubicNodes,
    flattenCubic, flattenSpline,
    fitPolylineCurve, curveTurn, curveIsStraight,
    lmSolve, solveLinear,
    partTransform, partMarkerWorld, solveAssembly,
    pointInPoly, signedAreaPts, interiorProbe, normalizeWinding, chainPolylines,
    dedupeSorted, lineLineIntersect, lineCircleIntersect,
    parseDxf, pdfContentPrims, parsePdf, parseCdr, cdrRectNodes, cdrEllipseNodes,
    imagePixelDensity, IMAGE_DEFAULT_DPI,
    round2, round6
  };
}
