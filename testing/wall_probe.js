// Probe for the Extrude wall hinge and strip geometry (tools/wall.js).
// Slices the pure functions out of the tool file and runs them without a DOM.
//
// Run: node testing/wall_probe.js
const fs = require('fs');
const path = require('path');
const shim = require(path.join(__dirname, 'polybool_shim.js'));


const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'wall.js'), 'utf8');
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

function braceEnd(s, from) {
  let d = 0;
  for (let j = s.indexOf('{', from); j < s.length; j++) {
    if (s[j] === '{') d++;
    else if (s[j] === '}') { d--; if (!d) return j + 1; }
  }
  throw new Error('unbalanced');
}
const slice = (name) => {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('not found: ' + name);
  let i = src.indexOf('(', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') { depth--; if (!depth) break; }
  }
  return src.slice(start, braceEnd(src, i));
};

// The tool's own open/apply are object-literal methods, written as
// "\n    apply(api) {" inside NS.register(), not as "function apply(".
const sliceMethod = (name) => {
  const start = src.indexOf('\n    ' + name + '(api');
  if (start < 0) throw new Error('method not found: ' + name);
  // brace-match from the method's opening brace: slicing to the end of the file
  // would drag in the closing braces of NS.register() and the IIFE
  const from = src.indexOf(')', start) + 1;
  return 'function ' + src.slice(start, braceEnd(src, from)).replace(/^\s*/, '');
};

const names = ['pathAt', 'pathInfo', 'bboxOf', 'loopProfile', 'hingeCuts',
  'bridgePlan', 'stripOutline', 'offsetOne', 'planFor'];
const consts = `
  const K_BRIDGE = 1.4, K_BRIDGE_PITCH = 4.37;
  const K_FINGER = 1.5, K_BAND = 1.875;
  const TAN_SPAN = 0.4, GAP_MERGE = 8, SLIT_EDGE = 3;
  const signOf = (loop) => (loop.depth % 2 === 0 ? -1 : 1);
  const midDelta = (loop, inset, t) => signOf(loop) * (inset + t / 2);
`;
const W = new Function(consts + names.map(slice).join('\n') +
  '\nreturn {' + names.join(',') + '};')();

// ---- bridge plan -------------------------------------------------------
console.log('\n== hinge bridge plan ==');
{
  const overlaps = (list) => {
    const s = list.slice().sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < s.length; i++) if (s[i][0] < s[i - 1][1] - 1e-9) return true;
    return false;
  };
  for (const [Hw, T] of [[40, 3], [20, 3], [60, 2], [12, 4]]) {
    const plan = W.bridgePlan(Hw, T);
    const solidAt = (list, y) => !list.some(([a, b]) => y > a + 1e-9 && y < b - 1e-9);
    check(`H${Hw}/t${T}: cuts in one column never overlap`,
      !overlaps(plan.colA) && !overlaps(plan.colB));
    check(`H${Hw}/t${T}: every cut span is positive`,
      plan.colA.concat(plan.colB).every(([a, b]) => b > a));
    check(`H${Hw}/t${T}: cuts stay inside the strip`,
      plan.colA.concat(plan.colB).every(([a, b]) => a >= -1e-9 && b <= Hw + 1e-9));
    // the point of two columns: one is solid exactly where the other is cut
    const eps = Math.min(0.2, Hw / 20);
    check(`H${Hw}/t${T}: the columns are complementary at the strip ends`,
      solidAt(plan.colA, eps) !== solidAt(plan.colB, eps) &&
      solidAt(plan.colA, Hw - eps) !== solidAt(plan.colB, Hw - eps),
      'bottom A:' + solidAt(plan.colA, eps) + ' B:' + solidAt(plan.colB, eps));
    check(`H${Hw}/t${T}: the two patterns are not identical`,
      JSON.stringify(plan.colA) !== JSON.stringify(plan.colB));
  }
}

// ---- curvature and hinge placement -------------------------------------
console.log('\n== curvature profile ==');
{
  const circle = (r, n) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = Math.PI * 2 * i / n;
      out.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
    }
    return out;
  };
  for (const r of [5, 20, 80]) {
    const lp = W.loopProfile(circle(r, 720));
    const mids = Array.from(lp.R).filter(v => isFinite(v)).sort((a, b) => a - b);
    const med = mids[Math.floor(mids.length / 2)];
    check(`circle r=${r}: radius read back within 5%`, Math.abs(med - r) / r < 0.05, med.toFixed(3));
  }
  const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const sq = W.loopProfile(square);
  // the hinge keys off per-sample turn, so that is the reading that matters
  const straight = Array.from(sq.turn).filter(v => Math.abs(v) < 1e-12).length / sq.ns;
  check('square: straight edges carry exactly zero turn', straight > 0.95, (straight * 100).toFixed(1) + '%');
  // the radius reading is smoothed over a window, so it only has to be honest
  // away from the corners
  const awayFromCorners = Array.from(sq.R).filter(v => !isFinite(v)).length / sq.ns;
  check('square: the radius reads infinite well away from the corners',
    awayFromCorners > 0.85, (awayFromCorners * 100).toFixed(1) + '%');
  const total = Array.from(sq.turn).reduce((a, b) => a + Math.abs(b), 0);
  check('square: total turn is exactly one full circle',
    Math.abs(total - Math.PI * 2) < 0.02, total.toFixed(4));
}

console.log('\n== hinge cuts ==');
{
  const prm = { height: 40, thick: 3, kerf: 0.4, cutPitch: 1.5, plainRK: 60 };
  const perCut = prm.kerf / prm.thick;                 // radians one cut absorbs

  // rounded rectangle: r fillets at the corners, wound CCW
  const roundRect = (w, h, r, seg) => {
    const pts = [];
    const corner = (cx, cy, a0) => {
      for (let i = 0; i <= seg; i++) {
        const a = a0 + (Math.PI / 2) * (i / seg);
        pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
      }
    };
    corner(w - r, h - r, 0);
    corner(r, h - r, Math.PI / 2);
    corner(r, r, Math.PI);
    corner(w - r, r, Math.PI * 1.5);
    return pts;
  };
  // Cluster the cut positions. The loop is circular, so rotate the list to
  // start after its largest gap first: otherwise a bend straddling the seam is
  // counted twice.
  const cluster = (cuts, L, merge) => {
    const ss = cuts.map(c => c.s).sort((a, b) => a - b);
    if (!ss.length) return [];
    let gi = 0, gv = -1;
    for (let i = 0; i < ss.length; i++) {
      const a = ss[i];
      const b = ss[(i + 1) % ss.length] + (i === ss.length - 1 ? L : 0);
      if (b - a > gv) { gv = b - a; gi = (i + 1) % ss.length; }
    }
    const rot = ss.slice(gi).concat(ss.slice(0, gi).map(v => v + L));
    const out = [];
    for (const v of rot) {
      const c = out[out.length - 1];
      if (c && v - c[c.length - 1] < merge) c.push(v);
      else out.push([v]);
    }
    return out;
  };
  const width = (c) => c[c.length - 1] - c[0];

  // ---- a sharp-cornered rectangle: 4 corners, nothing along the edges ----
  const rect = W.loopProfile([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }]);
  const hr = W.hingeCuts(rect, prm);
  check('sharp rectangle: bends in exactly 4 places', hr.zones === 4, hr.zones);
  const cl = cluster(hr.cuts, rect.L, 15);
  check('sharp rectangle: the cuts form 4 corner clusters', cl.length === 4, cl.length);
  const perCorner = Math.ceil((Math.PI / 2) / perCut);
  check('each 90 degree corner gets ceil(turn / (kerf/t)) cuts',
    hr.cuts.length === 4 * perCorner, hr.cuts.length + ' vs ' + 4 * perCorner);
  check('corner clusters are narrow: no cuts out on the straight edges',
    cl.every(c => width(c) < perCorner * prm.cutPitch + 4),
    cl.map(c => +width(c).toFixed(1)).join(','));
  // interior of each of the four straight edges, clear of both corners
  const onEdge = hr.cuts.filter(c =>
    (c.s > 30 && c.s < 170) || (c.s > 230 && c.s < 270) ||
    (c.s > 330 && c.s < 470) || (c.s > 530 && c.s < 570));
  check('no cuts in the middle of a straight edge', onEdge.length === 0, onEdge.length);

  // ---- a rectangle with large fillets: cluster width tracks the arc ----
  for (const r of [6, 20]) {
    const arc = r * Math.PI / 2;
    const profile = W.loopProfile(roundRect(300, 200, r, 16));
    const h = W.hingeCuts(profile, prm);
    const cls = cluster(h.cuts, profile.L, Math.max(8, arc * 0.5));
    check(`fillet r=${r}: still exactly 4 bend zones`, h.zones === 4, h.zones);
    const need = Math.ceil((Math.PI / 2) / perCut);
    check(`fillet r=${r}: ${need} cuts per corner (turn-driven, not pitch-driven)`,
      h.cuts.length === 4 * need, h.cuts.length);
    const w = cls.filter(c => c.length > 1).map(width);
    // a cluster spans the arc, or -- when the cuts need more room than the arc
    // gives at the minimum pitch -- the pitch grid, centred on the fillet
    const minSpan = (need - 1) * prm.cutPitch;
    // the radius is read through a 3 mm window either side, so a run bleeds
    // about that far past the tangent points
    const limit = Math.max(arc, minSpan) + 2 * prm.cutPitch + 2 * 3 + 1;
    check(`fillet r=${r}: clusters stay on the fillet (${Math.max(arc, minSpan).toFixed(1)} mm)`,
      w.every(v => v <= limit), w.map(v => +v.toFixed(1)).join(',') + ' > ' + limit.toFixed(1));
    check(`fillet r=${r}: clusters never merge across a straight run`,
      cls.filter(c => c.length > 1).length === 4,
      cls.filter(c => c.length > 1).length + ' clusters');
  }

  // ---- the shape from the drawings: a triangle with rounded corners ----
  // Tangent points sit r/tan(theta/2) along each edge, the arc centre
  // r/sin(theta/2) along the bisector, and the arc covers 180 - theta of turn
  // (120 degrees at a triangle corner).
  const roundedTri = (side, r, seg) => {
    const h = side * Math.sqrt(3) / 2;
    const V = [[-side / 2, 0], [side / 2, 0], [0, h]];
    const dir = (a, b) => {
      const dx = a[0] - b[0], dy = a[1] - b[1], l = Math.hypot(dx, dy);
      return { x: dx / l, y: dy / l };
    };
    const out = [];
    for (let i = 0; i < 3; i++) {
      const prev = V[(i + 2) % 3], v = V[i], next = V[(i + 1) % 3];
      const u1 = dir(prev, v), u2 = dir(next, v);
      const theta = Math.acos(Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y)));
      const tanD = r / Math.tan(theta / 2);
      const bis = dir([v[0] + u1.x + u2.x, v[1] + u1.y + u2.y], v);
      const cen = [v[0] + bis.x * (r / Math.sin(theta / 2)),
        v[1] + bis.y * (r / Math.sin(theta / 2))];
      const a1 = Math.atan2(v[1] + u1.y * tanD - cen[1], v[0] + u1.x * tanD - cen[0]);
      const a2 = Math.atan2(v[1] + u2.y * tanD - cen[1], v[0] + u2.x * tanD - cen[0]);
      let d = a2 - a1;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d <= -Math.PI) d += 2 * Math.PI;
      for (let n = 0; n <= seg; n++) {
        const a = a1 + d * (n / seg);
        out.push({ x: cen[0] + Math.cos(a) * r, y: cen[1] + Math.sin(a) * r });
      }
    }
    return out;
  };
  for (const r of [25, 10]) {
    const prof = W.loopProfile(roundedTri(380, r, 24));
    const h = W.hingeCuts(prof, prm);
    check(`rounded triangle r=${r}: bends in exactly 3 places`, h.zones === 3, h.zones);
    const cs = cluster(h.cuts, prof.L, 15);
    check(`rounded triangle r=${r}: the cuts sit in 3 clusters`, cs.length === 3, cs.length);
    const arc = r * (Math.PI * 2 / 3);
    const need = Math.ceil((Math.PI * 2 / 3) / perCut);
    const limit = Math.max(arc, (need - 1) * prm.cutPitch) + 2 * prm.cutPitch + 2 * 3 + 1;
    check(`rounded triangle r=${r}: each cluster stays on its fillet`,
      cs.every(c => width(c) <= limit), cs.map(c => +width(c).toFixed(1)).join(','));
    const gaps = [];
    for (let i = 1; i < cs.length; i++) gaps.push(cs[i][0] - cs[i - 1][cs[i - 1].length - 1]);
    check(`rounded triangle r=${r}: the three straight sides carry no cuts`,
      gaps.every(g => g > 0.5 * (prof.L / 3)), gaps.map(g => +g.toFixed(1)).join(','));
  }

  // ---- a genuinely flat outline: zero cuts, no matter how long ----
  const flatRect = W.loopProfile([{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 400 }, { x: 0, y: 400 }]);
  const edgesOnly = W.hingeCuts(flatRect, prm).cuts.filter(c => c.s > 40 && c.s < 760);
  check('a long flat rectangle gets no cuts along its edges', edgesOnly.length === 0, edgesOnly.length);

  // ---- gentle curvature: solid above the threshold, cut below it ----
  const circle = (r, n) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = Math.PI * 2 * i / n;
      out.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
    }
    return out;
  };
  const wide = W.loopProfile(circle(400, 2000));
  check('a circle far above the threshold radius stays solid',
    W.hingeCuts(wide, prm).cuts.length === 0, W.hingeCuts(wide, prm).cuts.length);
  check('lowering the threshold brings the cuts back',
    W.hingeCuts(wide, { ...prm, plainRK: 300 }).cuts.length > 0);
  const tight = W.loopProfile(circle(6, 400));
  check('a tight circle is cut all the way round',
    W.hingeCuts(tight, prm).zones === 1);
}

// ---- strip outline -----------------------------------------------------
console.log('\n== wall strip ==');
{
  const L = 300, Hw = 40, T = 3, bands = 7, f = 1.5 * T;
  const tabs = [];
  for (let i = 0; i < 8; i++) {
    const s = (i + 0.5) * L / 8;
    tabs.push({ x0: s - 5, x1: s + 5 });
  }
  const pts = W.stripOutline(L, Hw, T, tabs, f, bands);
  const bb = W.bboxOf([pts]);
  const xs = pts.map(p => p.x);
  check('strip is L plus one finger long (the other end has the matching recess)',
    Math.abs(bb.w - (L + f)) < 1e-6, bb.w.toFixed(3));
  check('strip body is Hw tall, tabs reach one thickness below it',
    Math.abs(bb.maxY - Hw) < 1e-6 && Math.abs(bb.minY + T) < 1e-6, bb.minY + '..' + bb.maxY);
  check('one protruding finger and one recess at each end (half-lap)',
    Math.min(...xs) < -f + 1e-9 && Math.max(...xs) > L - 1e-9 &&
    xs.some(x => Math.abs(x) < 1e-9) && xs.some(x => Math.abs(x - (L - f)) < 1e-9));

  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    area += a.x * b.y - b.x * a.y;
  }
  area = Math.abs(area / 2);
  const tabsArea = tabs.length * (tabs[0].x1 - tabs[0].x0) * T;
  // the seam interlock trades material between the two ends: net zero
  check('strip area is exactly body + tabs (the seam is area neutral)',
    Math.abs(area - (L * Hw + tabsArea)) < 1,
    area.toFixed(1) + ' vs ' + (L * Hw + tabsArea));
}

// ---- one loop through the real Clipper ---------------------------------
console.log('\n== plan for a rounded square ==');
{
  const C = require(path.join(__dirname, '..', 'tools', 'clipper.js'));
  const SCALE = 1000;
  const api = {
    clipperLib: () => C,
    polyBoolOp: shim.polyBoolOp,
    offsetScale: SCALE,
    offsetPrecision: 0.001,
    clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
    signedAreaPts: (pts) => {
      let a = 0;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length];
        a += p.x * q.y - q.x * p.y;
      }
      return a / 2;
    },
    offsetClosedChains: (contours, dist, opts) => {
      const o = opts || {};
      const paths = contours.map(c => c.pts.map(pt => ({
        X: Math.round(pt.x * SCALE), Y: Math.round(pt.y * SCALE)
      })));
      const joinType = (o.join === 'round') ? C.JoinType.jtRound : C.JoinType.jtMiter;
      const co = new C.ClipperOffset(o.miterLimit || 4, (o.arcTol || 0.05) * SCALE);
      co.AddPaths(paths, joinType, C.EndType.etClosedPolygon);
      const raw = new C.Paths();
      co.Execute(raw, dist * SCALE);
      const out = [];
      for (const path of raw) {
        if (!path || path.length < 3) continue;
        let pts = path.map(pt => ({ x: pt.X / SCALE, y: pt.Y / SCALE }));
        const dedup = [pts[0]];
        for (let i = 1; i < pts.length; i++) {
          const last = dedup[dedup.length - 1];
          if (Math.hypot(pts[i].x - last.x, pts[i].y - last.y) > 0.0005) dedup.push(pts[i]);
        }
        pts = dedup;
        const f0 = pts[0], l0 = pts[pts.length - 1];
        if (Math.hypot(f0.x - l0.x, f0.y - l0.y) <= 0.001) pts.pop();
        if (pts.length >= 3) out.push({ pts, closed: true });
      }
      return out;
    }
  };

  // 200 x 120 box with 20 mm corner radii, wound CCW
  const roundBox = (w, h, r, n) => {
    const pts = [];
    const corner = (cx, cy, a0) => {
      for (let i = 0; i <= n; i++) {
        const a = a0 + (Math.PI / 2) * (i / n);
        pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
      }
    };
    corner(w - r, h - r, 0);
    corner(r, h - r, Math.PI / 2);
    corner(r, r, Math.PI);
    corner(w - r, r, Math.PI * 1.5);
    return pts;
  };
  const loop = { pts: roundBox(200, 120, 20, 12), closed: true, depth: 0 };
  const prm = { height: 40, thick: 3, inset: 0, tabK: 2, pitchK: 4, cutPitch: 1.5, kerf: 0.4, plainRK: 60, tabMinR: 25 };
  const plan = W.planFor(api, loop, prm);

  check('plan exists for a 200x120 rounded box', !!plan);
  if (plan) {
    // Steiner: shrinking a convex loop by d takes 2*pi*d off its perimeter
    const perim0 = 2 * (200 - 40) + 2 * (120 - 40) + 2 * Math.PI * 20;
    const perim = perim0 - 2 * Math.PI * (prm.thick / 2);
    check('wall length is the mid-line perimeter, P - 2*pi*t/2',
      Math.abs(plan.L - perim) / perim < 0.01, plan.L.toFixed(2) + ' vs ' + perim.toFixed(2));
    // one finger roughly every 4x the stock, minus the positions refused on
    // bends too tight for a straight finger (the 20 mm fillets at t=3)
    const wantTabs = Math.round(plan.L / (prm.pitchK * prm.thick));
    check('tabs are spread along the loop at the thickness pitch',
      Math.abs(plan.tabs.length + plan.tooTight - wantTabs) <= 1,
      plan.tabs.length + ' + ' + plan.tooTight + ' skipped vs ~' + wantTabs);
    check('the tight 20 mm fillets are refused at t=3',
      plan.tooTight > 0, plan.tooTight);
    check('every tab has its notch', plan.notches.length === plan.tabs.length);
    check('hinge cuts appear only on the corners',
      plan.cols.length > 0 && plan.cols.length < plan.L / 1.5,
      plan.cols.length + ' columns over ' + plan.L.toFixed(0) + ' mm');
    const ss = plan.cols.map(c => c.s).sort((a, b) => a - b);
    const runs = [];
    for (const v of ss) {
      const r = runs[runs.length - 1];
      if (r && v - r[r.length - 1] < 20) r.push(v);
      else runs.push([v]);
    }
    // a corner that straddles the strip's start shows up as two clusters, one
    // at each end of the arc-length range: the seam splits it, by design
    const seamSplit = runs.length > 1 &&
      (plan.L - runs[runs.length - 1][runs[runs.length - 1].length - 1]) + runs[0][0] < 20;
    check('cuts cluster into the four corners',
      runs.length === 4 || (runs.length === 5 && seamSplit), runs.length + ' clusters');
    check('each cluster stays on its corner', runs.every(r => r[r.length - 1] - r[0] < 70),
      runs.map(r => +(r[r.length - 1] - r[0]).toFixed(1)).join(','));
    const straightMid = ss.filter(v => {
      // halfway between two clusters is the middle of a straight run
      for (let i = 1; i < runs.length; i++) {
        const a = runs[i - 1][runs[i - 1].length - 1], b = runs[i][0];
        if (b - a > 60 && v > a + 20 && v < b - 20) return true;
      }
      return false;
    });
    check('no hinge cuts in the middle of a straight run', straightMid.length === 0, straightMid.length);
    check('bands is odd so the two strip ends match', plan.bands % 2 === 1, plan.bands);
    // the notch must reach past the plate edge, or the tab cannot slide in
    const notchReach = plan.notches.map(n => Math.max(...n.map(p => p.y)));
    check('notches open past the plate edge', Math.min(...notchReach) > 0, Math.min(...notchReach));
  }
}

// ---- joints only where a finger can actually pass ----------------------
console.log('\n== finger joints need a gentle enough bend ==');
{
  const C = require(path.join(__dirname, '..', 'tools', 'clipper.js'));
  const SCALE = 1000;
  const api = {
    clipperLib: () => C,
    polyBoolOp: shim.polyBoolOp,
    offsetScale: SCALE,
    offsetPrecision: 0.001,
    clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
    signedAreaPts: (pts) => {
      let a = 0;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length];
        a += p.x * q.y - q.x * p.y;
      }
      return a / 2;
    },
    offsetClosedChains: (contours, dist, opts) => {
      const o = opts || {};
      const paths = contours.map(c => c.pts.map(pt => ({
        X: Math.round(pt.x * SCALE), Y: Math.round(pt.y * SCALE)
      })));
      const jt = (o.join === 'round') ? C.JoinType.jtRound : C.JoinType.jtMiter;
      const co = new C.ClipperOffset(o.miterLimit || 4, (o.arcTol || 0.05) * SCALE);
      co.AddPaths(paths, jt, C.EndType.etClosedPolygon);
      const raw = new C.Paths();
      co.Execute(raw, dist * SCALE);
      return raw.filter(p => p && p.length >= 3)
        .map(p => ({ pts: p.map(q => ({ x: q.X / SCALE, y: q.Y / SCALE })), closed: true }));
    }
  };
  const circle = (r, n) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = Math.PI * 2 * i / n;
      out.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
    }
    return out;
  };
  const roundRect = (w, h, r, seg) => {
    const out = [];
    const corner = (cx, cy, a0) => {
      for (let i = 0; i <= seg; i++) {
        const a = a0 + (Math.PI / 2) * (i / seg);
        out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
      }
    };
    corner(w - r, h - r, 0);
    corner(r, h - r, Math.PI / 2);
    corner(r, r, Math.PI);
    corner(w - r, r, Math.PI * 1.5);
    return out;
  };
  const base = { height: 40, thick: 2, inset: 0, tabK: 2, pitchK: 4, cutPitch: 1.5, kerf: 0.4, plainRK: 60, fit: 0.15, tabMinR: 25 };
  const run = (pts, extra) => W.planFor(api, { pts, closed: true, depth: 0 }, { ...base, ...extra });

  // minR = 8 x thickness = 16 mm; the mid plane sits 1 mm inside, so a 15 mm
  // circle bends far too tight for a straight finger to pass through
  const tight = run(circle(15, 720));
  check('a 15 mm circle gets no finger joints at all', tight.tabs.length === 0, tight.tabs.length);
  check('... and reports them as butt-joined spots', tight.tooTight > 0, tight.tooTight);

  const wide = run(circle(40, 720));
  check('a 40 mm circle gets finger joints', wide.tabs.length > 10, wide.tabs.length);
  check('every slot on the wide circle is the same width',
    new Set(wide.notches.map(n => Math.hypot(n[1].x - n[0].x, n[1].y - n[0].y).toFixed(4))).size === 1);

  // A 20 mm fillet leaves a 19 mm mid-plane radius, under the 25 mm rule.
  // "On the fillet" means inside the arc's own angular span at the fillet
  // radius. Distance and a rough direction test both also match points just past
  // the tangent point, where the straight edge is nearly the same direction from
  // the corner centre — so the span is stated exactly.
  const onArc = (p, c, rMid, a0, a1) => {
    const dx = p.x - c[0], dy = p.y - c[1];
    if (Math.abs(Math.hypot(dx, dy) - rMid) > 0.6) return false;
    let a = Math.atan2(dy, dx) * 180 / Math.PI;
    while (a < 0) a += 360;
    while (a < a0 - 1e-9) a += 360;
    return a <= a1 + 1e-9;
  };
  const spotOnFillet = (plan, corners, rMid) => plan.tabs.filter(t => {
    const p = W.pathAt(plan.info, (t.x0 + t.x1) / 2);
    return corners.some(c => onArc(p, c.c, rMid, c.a0, c.a1));
  }).length;

  // each corner fillet spans one outward quadrant
  const corners20 = [
    { c: [180, 100], a0: 270, a1: 360 }, { c: [20, 100], a0: 90, a1: 180 },
    { c: [20, 20], a0: 180, a1: 270 }, { c: [180, 20], a0: 0, a1: 90 }
  ];
  const corners10 = [
    { c: [190, 110], a0: 270, a1: 360 }, { c: [10, 110], a0: 90, a1: 180 },
    { c: [10, 10], a0: 180, a1: 270 }, { c: [190, 10], a0: 0, a1: 90 }
  ];
  const withPath = (plan, pts, thick) => {
    plan.info = W.pathInfo(api.offsetClosedChains([{ pts, closed: true }], -(thick / 2))[0].pts);
    return plan;
  };

  // the threshold is 25 mm, so a 19 mm fillet is refused at every thickness
  const thin20 = withPath(run(roundRect(200, 120, 20, 16)), roundRect(200, 120, 20, 16), 2);
  check('r=20 at t=2: the 19 mm fillet is below the 25 mm rule and refused',
    thin20.tooTight > 0 && spotOnFillet(thin20, corners20, 19) === 0,
    thin20.tooTight + ' skipped, ' + spotOnFillet(thin20, corners20, 19) + ' on the arc');
  check('r=20 at t=2: the straight sides still carry fingers', thin20.tabs.length > 20, thin20.tabs.length);

  const thick20 = withPath(run(roundRect(200, 120, 20, 16), { thick: 3 }),
    roundRect(200, 120, 20, 16), 3);
  check('r=20 at t=3: the same fillet is refused',
    thick20.tooTight > 0 && spotOnFillet(thick20, corners20, 18.5) === 0,
    thick20.tooTight + ' skipped, ' + spotOnFillet(thick20, corners20, 18.5) + ' on the arc');
  check('r=20 at t=3: the straight sides still carry fingers',
    thick20.tabs.length > 20, thick20.tabs.length);

  const tightRR = withPath(run(roundRect(200, 120, 10, 16)), roundRect(200, 120, 10, 16), 2);
  check('r=10 at t=2: the 9 mm fillet is refused',
    tightRR.tooTight > 0, tightRR.tooTight);
  check('r=10: no finger sits on the fillet', spotOnFillet(tightRR, corners10, 9) === 0,
    spotOnFillet(tightRR, corners10, 9));
  check('r=10: the straight sides still carry fingers', tightRR.tabs.length > 15, tightRR.tabs.length);

  // lowering the threshold lets the r=10 fillets carry joints again
  const loose = run(roundRect(200, 120, 10, 16), { tabMinR: 6 });
  check('a lower threshold allows joints on the tight fillets too',
    loose.tooTight === 0 && loose.tabs.length > tightRR.tabs.length,
    loose.tabs.length + ' vs ' + tightRR.tabs.length);
}

// ---- the finger joint: size comes from the stock, not from the layout ----
console.log('\n== finger joint geometry ==');
{
  const C = require(path.join(__dirname, '..', 'tools', 'clipper.js'));
  const SCALE = 1000;
  const api = {
    clipperLib: () => C,
    polyBoolOp: shim.polyBoolOp,
    offsetScale: SCALE,
    offsetPrecision: 0.001,
    clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
    signedAreaPts: (pts) => {
      let a = 0;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length];
        a += p.x * q.y - q.x * p.y;
      }
      return a / 2;
    },
    offsetClosedChains: (contours, dist, opts) => {
      const o = opts || {};
      const paths = contours.map(c => c.pts.map(pt => ({
        X: Math.round(pt.x * SCALE), Y: Math.round(pt.y * SCALE)
      })));
      const jt = (o.join === 'round') ? C.JoinType.jtRound : C.JoinType.jtMiter;
      const co = new C.ClipperOffset(o.miterLimit || 4, (o.arcTol || 0.05) * SCALE);
      co.AddPaths(paths, jt, C.EndType.etClosedPolygon);
      const raw = new C.Paths();
      co.Execute(raw, dist * SCALE);
      return raw.filter(p => p && p.length >= 3)
        .map(p => ({ pts: p.map(q => ({ x: q.X / SCALE, y: q.Y / SCALE })), closed: true }));
    }
  };
  const box = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  const plan = (thick, inset, kerf) => W.planFor(api, { pts: box(400, 300), closed: true, depth: 0 }, {
    height: 40, thick, inset, tabK: 2, pitchK: 4, cutPitch: 1.5, kerf, plainRK: 60, tabMinR: 25
  });
  // corner order on the notch is (tangential, radial, tangential, radial)
  const slotOf = (n) => ({
    len: Math.hypot(n[1].x - n[0].x, n[1].y - n[0].y),
    wid: Math.hypot(n[2].x - n[1].x, n[2].y - n[1].y)
  });

  for (const t of [2, 3, 6, 12]) {
    const kerf = 0.4;
    const p = plan(t, 0, kerf);
    const s0 = slotOf(p.notches[0]);
    check(`t=${t}: finger is 2x the stock (${2 * t} mm)`, Math.abs(p.tabW - 2 * t) < 1e-6, p.tabW);
    check(`t=${t}: slot LENGTH is the finger + kerf`, Math.abs(s0.len - (2 * t + kerf)) < 1e-6, s0.len);
    // the whole point of this rule: the slot WIDTH is one stock thickness plus
    // kerf, and must not grow with the finger's length or with the inset
    check(`t=${t}: slot WIDTH is one thickness + kerf (${t + kerf} mm)`,
      Math.abs(s0.wid - (t + kerf)) < 1e-6, s0.wid);
  }

  // an edge inset moves the slot inward with the wall; it must not resize it
  for (const inset of [0, 2, 5]) {
    const p = plan(2, inset, 0.4);
    const s0 = slotOf(p.notches[0]);
    check(`inset ${inset}: slot stays ${2.4} x ${4.4} mm`,
      Math.abs(s0.wid - 2.4) < 1e-6 && Math.abs(s0.len - 4.4) < 1e-6,
      s0.len.toFixed(2) + ' x ' + s0.wid.toFixed(2));
  }

  // doubling the finger length must leave the width alone
  const shortF = W.planFor(api, { pts: box(400, 300), closed: true, depth: 0 },
    { height: 40, thick: 2, inset: 0, tabK: 2, pitchK: 8, cutPitch: 1.5, kerf: 0.4, plainRK: 60, tabMinR: 25 });
  const longF = W.planFor(api, { pts: box(400, 300), closed: true, depth: 0 },
    { height: 40, thick: 2, inset: 0, tabK: 5, pitchK: 12, cutPitch: 1.5, kerf: 0.4, plainRK: 60, tabMinR: 25 });
  check('a 5x finger gets a longer slot but the same width',
    Math.abs(slotOf(longF.notches[0]).len - (10 + 0.4)) < 1e-6 &&
    Math.abs(slotOf(longF.notches[0]).wid - slotOf(shortF.notches[0]).wid) < 1e-6,
    slotOf(longF.notches[0]).len.toFixed(2) + ' x ' + slotOf(longF.notches[0]).wid.toFixed(2));

  // the slot sits symmetrically on the finger's mid plane
  const p3 = plan(2, 3, 0.4);
  const n3 = p3.notches[0];
  const sideA = Math.hypot(n3[0].x - n3[3].x, n3[0].y - n3[3].y);
  const sideB = Math.hypot(n3[1].x - n3[2].x, n3[1].y - n3[2].y);
  check('the slot is centred on the finger (equal sides)', Math.abs(sideA - sideB) < 1e-6,
    sideA.toFixed(3) + ' vs ' + sideB.toFixed(3));

  // and the kerf really is the only slack
  const k2 = plan(2, 0, 0.2), k4 = plan(2, 0, 0.4);
  check('a wider kerf widens the slot by exactly that much',
    Math.abs((slotOf(k4.notches[0]).wid - slotOf(k2.notches[0]).wid) - 0.2) < 1e-6,
    slotOf(k2.notches[0]).wid + ' -> ' + slotOf(k4.notches[0]).wid);
}

// ---- the finished sheet lands in the middle of the view -----------------
// A generated set used to be parked to the right of whatever was already
// drawn, so on a busy drawing it appeared off screen. Every other generator
// (Box, Gear) centres its output on the view; this does too, and wraps its rows
// to the screen width instead of a fixed 400 mm.
console.log('\n== layout is centred on the view ==');
{
  const C = require(path.join(__dirname, '..', 'core.js'));
  // the tool's tuning constants, as they are in the file
  const constSrc = src.slice(src.indexOf('const KEY ='), src.indexOf('// ---- path math')) +
    // the offset-sign helpers sit further down, next to planFor
    src.slice(src.indexOf('const signOf ='), src.indexOf('function offsetOne('));
  const K = new Function(constSrc + 'return { K_BRIDGE, K_BRIDGE_PITCH, K_BAND, K_FINGER, K_TAB, K_TAB_PITCH, TAB_MIN_R_MM, TAN_SPAN, GAP_MERGE, SLIT_EDGE, GAP };')();
  const Clipper = require(path.join(__dirname, '..', 'tools', 'clipper.js'));
  const clipperApi = {
    clipperLib: () => Clipper,
    polyBoolOp: shim.polyBoolOp,
    offsetScale: 1000,
    offsetPrecision: 0.001,
    signedAreaPts: C.signedAreaPts,
    offsetClosedChains: (contours, dist, opts) => {
      const o = opts || {};
      const S = 1000;
      const paths = contours.map(c => c.pts.map(pt => ({
        X: Math.round(pt.x * S), Y: Math.round(pt.y * S)
      })));
      const jt = (o.join === 'round') ? Clipper.JoinType.jtRound : Clipper.JoinType.jtMiter;
      const co = new Clipper.ClipperOffset(o.miterLimit || 4, (o.arcTol || 0.05) * S);
      co.AddPaths(paths, jt, Clipper.EndType.etClosedPolygon);
      const raw = new Clipper.Paths();
      co.Execute(raw, dist * S);
      return raw.filter(p => p && p.length >= 3)
        .map(p => ({ pts: p.map(q => ({ x: q.X / S, y: q.Y / S })), closed: true }));
    }
  };
  // a fake document + api, enough to run the real applyWallMaker
  const mkWorld = (viewW, viewH, ox, oy, zoom) => {
    const w = {
      pts: {}, ents: {}, nextId: 0, added: [], notes: [],
      view: { W: viewW, H: viewH, ox, oy, zoom },
      toasts: []
    };
    w.api = {
      ...clipperApi,
      state: w.state = { points: w.pts, entities: w.ents, constraints: {} },
      ui: { color: '#000000', activeLayer: 1, selection: [] },
      settings: { noteSize: 3 },
      clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
      fmt: (v) => String(Math.round(v * 100) / 100),
      round2: (v) => Math.round(v * 100) / 100,
      toast: (m) => w.toasts.push(String(m)),
      newId: () => ++w.nextId,
      privatePoint: (x, y) => { const id = ++w.nextId; w.pts[id] = { x, y }; return id; },
      s2w: (x, y) => ({ x: (x - ox) / zoom, y: -(y - oy) / zoom }),
      getW: () => viewW,
      getH: () => viewH,
      contentBounds: () => null,
      selectedEntities: () => [],
      colorOf: (e) => (e && e.color) || '#000000',
      pointInPoly: C.pointInPoly,
      signedAreaPts: C.signedAreaPts,
      // the real one chains the selection into contours; here the fake document
      // already holds one closed spline per shape
      normalizeWinding: C.normalizeWinding,
      bakeContours: (ents) => {
        const contours = [];
        for (const e of ents || []) {
          const pts = (e.pts || []).map(id => w.pts[id]).filter(Boolean).map(p => ({ x: p.x, y: p.y }));
          if (pts.length >= 3) contours.push({ pts, closed: true, color: e.color, depth: 0 });
        }
        return { contours };
      },
      pushHistory: () => {},
      commit: () => {},
      // labels are comments now: the tool creates them through api.addNote and
      // puts them into the selection, so they end up inside the group
      addNote: (text, x, y) => {
        const t = String(text == null ? '' : text);
        if (!t.trim() || !isFinite(+x) || !isFinite(+y)) return null;
        const id = ++w.nextId;
        w.notes.push({ text: t, at: { x, y } });
        return id;
      },
      cmdGroupSelection: () => {},
      addPanelEntity: (pts, color) => {
        const id = ++w.nextId;
        const clean = pts.map(p => ({ x: p.x, y: p.y }));
        w.added.push({ id, kind: 'closed', color: color, pts: clean });
        w.ents[id] = {
          id, type: 'spline', closed: true, color: '#000000',
          pts: clean.map(p => w.api.privatePoint(p.x, p.y)),
          hs: { o: clean.map(() => null), i: clean.map(() => null) }
        };
        return id;
      },
      addPolylineEntity: (pts, color) => {
        const id = ++w.nextId;
        const clean = pts.map(p => ({ x: p.x, y: p.y }));
        w.added.push({ id, kind: 'open', color: color, pts: clean });
        w.ents[id] = { id, type: 'spline', closed: false, color: '#000000', pts: [] };
        return id;
      }
    };
    // the real one creates note entities directly on state
    const origPrivate = w.api.privatePoint;
    const realCommitGroup = w.api.cmdGroupSelection;
    w.api.cmdGroupSelection = () => {
      for (const e of Object.values(w.ents)) {
        if (e.type === 'note') w.notes.push({ text: e.text, at: w.pts[e.p] });
      }
      realCommitGroup();
    };
    return w;
  };

  // module-level helpers planFor leans on (offset signs from the nesting depth)
  const signHelpers = src.slice(src.indexOf('const signOf ='), src.indexOf('function offsetOne('));
  const wallBody = [
    ...['pathAt', 'pathInfo', 'bboxOf', 'loopProfile', 'hingeCuts', 'bridgePlan',
      'offsetOne', 'subtractLoops', 'planFor', 'stripOutline', 'read'].map(slice),
    // the generator itself is the `apply(api)` method of the registered tool
    sliceMethod('apply'),
    'return apply;'
  ].join('\n');

  const run = (viewW, viewH, ox, oy, zoom) => {
    const w = mkWorld(viewW, viewH, ox, oy, zoom);
    const apply = new Function(
      'api', 'fitPolylineCurve', 'signedAreaPts', 'pointInPoly', 'clipperLib',
      'K_BRIDGE', 'K_BRIDGE_PITCH', 'K_BAND', 'K_FINGER', 'K_TAB', 'K_TAB_PITCH',
      'TAB_MIN_R_MM', 'TAN_SPAN', 'GAP_MERGE', 'SLIT_EDGE', 'GAP',
      `const NS = { close: () => {} };
       const document = { getElementById: (id) => ({
         value: id === 'wall-h' ? '40' : id === 'wall-t' ? '2'
           : id === 'wall-inset' ? '0' : id === 'wall-tabk' ? '2'
           : id === 'wall-pitchk' ? '4' : id === 'wall-cutpitch' ? '1.5'
           : id === 'wall-kerf' ? '0.4' : id === 'wall-plainrk' ? '60' : '0',
         focus: () => {}, classList: { add: () => {}, remove: () => {} }
       }) };
       const localStorage = { getItem: () => null, setItem: () => {} };
       ${signHelpers}
       ${wallBody}`
    )(w.api, C.fitPolylineCurve, C.signedAreaPts, C.pointInPoly, clipperApi.clipperLib,
      K.K_BRIDGE, K.K_BRIDGE_PITCH, K.K_BAND, K.K_FINGER, K.K_TAB, K.K_TAB_PITCH,
      K.TAB_MIN_R_MM, K.TAN_SPAN, K.GAP_MERGE, K.SLIT_EDGE, K.GAP);

    // the source shape (a 200 x 120 rounded box) is a real object in the drawing
    const p0 = w.api.privatePoint(0, 0);
    const shape = [];
    const rr = (x, y) => { shape.push({ x, y }); };
    const corner = (cx, cy, a0) => {
      for (let i = 0; i <= 12; i++) {
        const a = a0 + Math.PI / 2 * (i / 12);
        rr(cx + 20 * Math.cos(a), cy + 20 * Math.sin(a));
      }
    };
    corner(180, 100, 0); corner(20, 100, Math.PI / 2);
    corner(20, 20, Math.PI); corner(180, 20, Math.PI * 1.5);
    const sid = ++w.nextId;
    w.ents[sid] = {
      id: sid, type: 'spline', closed: true, color: '#000000',
      pts: shape.map(p => w.api.privatePoint(p.x, p.y)),
      hs: { o: shape.map(() => null), i: shape.map(() => null) }
    };
    w.api.selectedEntities = () => [w.ents[sid]];
    apply(w.api);
    return w;
  };

  for (const [vw, vh, ox, oy, zoom] of [
    [1200, 800, 600, 400, 1],
    [1600, 900, 300, 700, 0.5],
    [900, 600, -200, 150, 2]
  ]) {
    const w = run(vw, vh, ox, oy, zoom);
    const all = w.added.flatMap(a => a.pts);
    check(`view ${vw}x${vh}@${zoom}: something was generated`, all.length > 0, w.added.length);
    if (!all.length) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of all) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    // the view centre in world coordinates
    const cx = (vw / 2 - ox) / zoom;
    const cy = -(vh / 2 - oy) / zoom;
    const sheetCx = (minX + maxX) / 2;
    const sheetCy = (minY + maxY) / 2;
    check(`view ${vw}x${vh}@${zoom}: horizontally centred (off by ${Math.abs(sheetCx - cx).toFixed(2)} mm)`,
      Math.abs(sheetCx - cx) < 1, sheetCx.toFixed(2) + ' vs ' + cx.toFixed(2));
    check(`view ${vw}x${vh}@${zoom}: vertically centred (off by ${Math.abs(sheetCy - cy).toFixed(2)} mm)`,
      Math.abs(sheetCy - cy) < 1, sheetCy.toFixed(2) + ' vs ' + cy.toFixed(2));
    check(`view ${vw}x${vh}@${zoom}: it is not parked to the right of the origin`,
      Math.abs(sheetCx - cx) < Math.max(50, (maxX - minX) / 2),
      sheetCx.toFixed(1));
  }

  // the parts must not overlap each other after the shift. The lid's inner
  // guide is engraved exactly on the lid outline on purpose, so it is not a
  // separate part and is left out of this check.
  const w = run(1200, 800, 600, 400, 1);
  const parts = w.added.filter(a => a.kind === 'closed' && a.color !== '#0000ff');
  const boxes = parts.map(a => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of a.pts) {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    return { x0, y0, x1, y1 };
  });
  let overlaps = 0;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.x0 < b.x1 - 0.01 && b.x0 < a.x1 - 0.01 && a.y0 < b.y1 - 0.01 && b.y0 < a.y1 - 0.01) overlaps++;
    }
  }
  check('the parts do not overlap after centring', overlaps === 0, overlaps + ' overlapping pairs');
  check('every part got its label', w.notes.length === boxes.length,
    w.notes.length + ' labels for ' + boxes.length + ' parts');
  check('the engrave guide rides on the lid, not on its own',
    w.added.some(a => a.color === '#0000ff'), w.added.filter(a => a.color === '#0000ff').length);
}

console.log('\n' + (fail ? fail + ' FAILED, ' : 'all ') + pass + ' checks passed');
process.exit(fail ? 1 : 0);
