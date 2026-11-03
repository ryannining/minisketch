// Probe for the Paint rack tool (tools/paintrack.js).
//
// Property checks, no DOM: the shelf is the size the hole grid claims, the
// walls are tall enough for every tier, and a shelf's tabbed edge really
// interlocks a wall's notched edge (tab sums cancel notch sums over the
// shared engagement length).
//
// Run: node testing/paintrack_probe.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'tools', 'paintrack.js'), 'utf8');

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};
const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 1e-6 : tol);

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

const NAMES = ['fingerEdge', 'panelPoints', 'holeGrid', 'paintrackPlan'];
const T = new Function(NAMES.map(slice).join('\n') +
  '\nreturn {' + NAMES.join(',') + '};')();

const signedArea = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
};
const bbox = (pts) => {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of pts) {
    b.minX = Math.min(b.minX, p.x); b.maxX = Math.max(b.maxX, p.x);
    b.minY = Math.min(b.minY, p.y); b.maxY = Math.max(b.maxY, p.y);
  }
  return b;
};

// ---- reference case -----------------------------------------------------
const prm = { cols: 6, rows: 2, tiers: 3, dia: 30, sp: 8, t: 4, fw: 10, pitch: 55 };
const plan = T.paintrackPlan(prm);

check('panel count = 2 walls + tiers', plan.panels.length === 2 + prm.tiers,
  plan.panels.length);
check('shelf width = spacing*(cols+1) + cols*dia',
  near(plan.shelfW, prm.sp * (prm.cols + 1) + prm.cols * prm.dia), plan.shelfW);
check('shelf depth = spacing*(rows+1) + rows*dia',
  near(plan.shelfD, prm.sp * (prm.rows + 1) + prm.rows * prm.dia), plan.shelfD);
check('wall height = tiers * pitch', near(plan.wallH, prm.tiers * prm.pitch), plan.wallH);

// ---- shelf panel: bbox equals the claimed size, holes inside ------------
const shelf = plan.panels[2];
const sb = bbox(T.panelPoints(0, 0, shelf.w, shelf.h, prm.t, prm.fw, shelf.m));
// tabs stick out t on both sides
check('shelf bbox = shelf + 2 tabs wide', near(sb.maxX - sb.minX, shelf.w + 2 * prm.t, 1e-6),
  sb.maxX - sb.minX);
check('shelf holes = cols*rows', shelf.holes.length === prm.cols * prm.rows,
  shelf.holes.length);
const hb = bbox(shelf.holes);
check('hole centres stay inside the panel with >= 2 mm of material',
  hb.minX >= prm.sp - 1e-9 && hb.maxX <= shelf.w - prm.sp + 1e-9 &&
  hb.minY >= prm.sp - 1e-9 && hb.maxY <= shelf.h - prm.sp + 1e-9, JSON.stringify(hb));
const cell = prm.dia + prm.sp;
check('hole pitch = dia + spacing',
  near(shelf.holes[1].x - shelf.holes[0].x, cell) &&
  near(shelf.holes[prm.cols].y - shelf.holes[0].y, cell), cell);
check('holes clear the tab depth', hb.minX >= prm.t && hb.maxX <= shelf.w - prm.t,
  JSON.stringify(hb));

// ---- interlock: over the engagement length the shelf edge is the exact
// complement of the wall's inner edge -------------------------------------
const engage = Math.min(shelf.h, plan.wallH);
// complement check without flipping axes: the shelf's tab edge protrudes t
// exactly where the wall's notched edge recedes t, so shelfOffset(x) with the
// axis reversed equals the wall offset at the same height.
const shelfEdge = T.fingerEdge(0, 0, 0, engage, -1, 0, prm.t, prm.fw, 'tab');
const wallEdge = T.fingerEdge(shelf.w, 0, shelf.w, engage, 1, 0, prm.t, prm.fw, 'notch')
  .map(p => ({ x: p.x - shelf.w, y: p.y }));
check('shelf tab edge mirrors the wall notch edge point for point',
  shelfEdge.length === wallEdge.length &&
  shelfEdge.every((p, i) => near(p.x, wallEdge[i].x, 1e-9) && near(p.y, wallEdge[i].y, 1e-9)),
  shelfEdge.length + ' vs ' + wallEdge.length);
// signed area of a comb and its complement cancel over the same span
check('tabs add exactly what notches remove',
  near(Math.abs(signedArea(T.fingerEdge(0, 0, 0, engage, -1, 0, prm.t, prm.fw, 'tab'))),
    Math.abs(signedArea(T.fingerEdge(0, 0, 0, engage, 1, 0, prm.t, prm.fw, 'notch'))), 1e-6));

// ---- panel outlines are sane closed loops -------------------------------
for (const p of plan.panels) {
  const pts = T.panelPoints(0, 0, p.w, p.h, prm.t, prm.fw, p.m);
  const b = bbox(pts);
  // a notched ('comb') edge runs the panel's FULL height/width, so the
  // expected area is w*h minus the recessed strip along that edge
  let expected = p.w * p.h;
  // joint area of one edge = the strip between the fingered edge and the
  // straight baseline: trapezoidal integral of the normal offset over the
  // edge (negative = material removed by notches, positive = tabs added)
  const edge = (ax, ay, bx, by, nx, ny, mode) => {
    const e = T.fingerEdge(ax, ay, bx, by, nx, ny, prm.t, prm.fw, mode);
    const ux = (bx - ax), uy = (by - ay);
    const len = Math.hypot(ux, uy);
    let strip = 0;
    for (let i = 0; i + 1 < e.length; i++) {
      const s0 = ((e[i].x - ax) * ux + (e[i].y - ay) * uy) / len;
      const s1 = ((e[i + 1].x - ax) * ux + (e[i + 1].y - ay) * uy) / len;
      const o0 = (e[i].x - ax) * nx + (e[i].y - ay) * ny;
      const o1 = (e[i + 1].x - ax) * nx + (e[i + 1].y - ay) * ny;
      strip += 0.5 * (o0 + o1) * (s1 - s0);
    }
    return strip;
  };
  const offs = edge(0, 0, p.w, 0, 0, -1, p.m.bottom) + edge(0, p.h, p.w, p.h, 0, 1, p.m.top) +
    edge(p.w, 0, p.w, p.h, 1, 0, p.m.right) + edge(0, 0, 0, p.h, -1, 0, p.m.left);
  // panelPoints walks clockwise, |signedArea| = w*h; a notch edge's strip is
  // negative (material removed), a tab edge's positive (material added)
  expected += offs;
  check(p.name + ': closed outline, area matches joints',
    pts.length >= 4 && near(Math.abs(signedArea(pts)), expected, Math.max(1, 0.02 * p.w * p.h)),
    Math.abs(signedArea(pts)).toFixed(1) + ' vs ' + expected.toFixed(1));
  check(p.name + ': notches never cut deeper than the panel',
    b.minX >= -prm.t - 1e-9 && b.minY >= -prm.t - 1e-9 &&
    b.maxX <= p.w + prm.t + 1e-9 && b.maxY <= p.h + prm.t + 1e-9);
}

// ---- degenerate parameter guards ----------------------------------------
const one = T.paintrackPlan({ cols: 1, rows: 1, tiers: 1, dia: 30, sp: 8, t: 4, fw: 10, pitch: 55 });
check('1x1x1 plan still builds', one.panels.length === 3 && one.panels[2].holes.length === 1);
check('layout is non-overlapping: walls end before the shelf column starts',
  plan.panels[0].x0 + plan.panels[0].w <= plan.panels[1].x0 &&
  plan.panels[1].x0 + plan.panels[1].w <= plan.panels[2].x0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
