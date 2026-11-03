// Finger joint: a row of tabs laid along one or more lines the user picked.
//
// The input is geometry that already exists — a straight line drawn on the edge
// of a board, one line per edge to be jointed. The output for each line is a
// row of rectangles standing on it: each is one cell wide along the line and one
// `tebal bahan` deep along the line's normal. `male` puts a tab on the first cell
// (the row starts by protruding), `female` starts with the gap the mating board's
// tab drops into, which costs it exactly one finger against the male.
//
// The line is the MASTER of the result and the joint is a MODIFIER of it: it has
// no furniture of its own. The two green guide lines the framer hands every
// grouped object are deleted, with the constraints that hung on them, so nothing
// is drawn across the tabs. What is left is the box's own corner handles, and a
// row stretched with one of those is put back to the line's size on release — a
// joint that grew while you were not looking at it is the confusion this removes.
// What stays on the frame is one driving constraint and the aspect lock:
//
//   coincident  the frame's baseline corner  ->  the a end of the line
//
// which is what a live link is in this app: `reference` annotations are skipped
// by the solver (app.js:3003), only driving constraints move geometry. Drag the
// master line and the joint rides along with it, live.
//
// What a single point pin cannot carry is the line's ANGLE and LENGTH — those
// need a line pair (`parallel`), and the only line pair available was the guide
// that is now gone. So angle, length and finger count are recalculated when the
// drag ENDS: a `pointerup` listener on window, which by construction runs after
// the canvas's own release handler, plus `keyup` for a change that came without a
// pointer (a typed dimension, an arrow-key nudge). It rebuilds a joint when its
// master line changed length or angle, or when the joint's own frame no longer
// measures what it was baked for — so however the row got out of shape, letting
// go re-derives it from the line. Nothing happens during the drag: a row rebuilt
// on every pointermove is the lag this avoids. The rebuild writes no history step
// of its own — the drag pushed one when the pointer went down, so Ctrl+Z puts the
// line and the row back together as they were. Double clicking the joint and
// Create does the same recalculation on demand and is still the way to change the
// parameters. A joint whose master line was deleted sits where its line last was,
// stored in gen.params, and follows nothing.
// Nothing about the result's size is a dimension — sizing it is the line's job,
// not the frame's.
//
// One grid per line, shared by both modes: the line is cut into an ODD number of
// equal cells, `male` takes cells 0,2,4… and `female` the cells in between, 1,3…
// That is what makes two boards jointed on the same edge interleave — tab against
// gap, same width, one fewer finger on the female — and it is why the cell count
// is never rounded separately per mode: a female that did would cut narrower
// fingers and crash into the male's. Because the count is odd, both phases read
// the same from either end, so the rows match whichever way each line was drawn.
//
// The requested finger width is nominal: the line is divided into an equal number
// of cells so no cell is ever cut short in the middle, and the width achieved is
// what the toast reports. One group per line.
//
// A line has no inside, so the side the tabs grow on is the line's direction
// turned 90°: by default the right of a→b, which is OUTSIDE for a loop drawn
// counterclockwise (the app's convention for an outer contour). "Balik arah"
// turns them the other way.
//
// The tabs are emitted axis-aligned and then placed by rewriting the group's
// frame (p0/pw/ph), because a group's frame is the bounding box of whatever it
// wraps: emitting the rotated rectangles directly would store a rotated pattern
// inside a straight box. The frame is rewritten to the box the WHOLE LINE
// occupies, in both modes, so the two boards' boxes coincide and the box has a
// corner to pin to; the stored pattern is re-normalised into that box, which for
// `female` is what keeps its tabs in phase instead of stretched over it.
(() => {
  'use strict';

  const NS = window.MiniSketchTools;
  const KEY = 'minisketch.v1.finger';
  const MIN_CELL = 0.2;   // mm: narrower than this and the machine cannot make the joint
  const REFIT_TOL = 0.01; // mm: solver jitter is not a length change worth rebuilding for
  const REFIT_ANG = 0.002; // rad (~0.1°): the same tolerance, applied to the line's angle
  const fmt0 = (v) => String(Math.round(+v * 100) / 100);

  // The direction a master line was baked for, and the difference between two
  // directions. Angles wrap, so a line turned past ±180° has to read as a small
  // change rather than as the whole circle.
  const angOf = (ln) => Math.round(Math.atan2(ln.y2 - ln.y1, ln.x2 - ln.x1) * 1e5) / 1e5;
  function angDelta(a, b) {
    let d = +a - +b;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  }

  // ---- the layout (pure, DOM-free: what testing/finger_probe.js slices) ----

  // The grid is ONE per line and both modes share it: L is divided into an ODD
  // number of equal cells as close to the requested finger width as possible.
  // `male` takes cells 0,2,4… — a tab at both ends, (k+1)/2 of them. `female`
  // takes the cells in between, 1,3… — exactly one tab fewer than the male, and
  // every one of them lands in a gap of the male row on the same line. That is
  // what makes two boards interleave, and it is why the cell width is never
  // recomputed per mode: a female that rounded its own cell count would cut
  // narrower fingers and collide with the male's. An odd k also makes both phases
  // symmetric, so the row matches its mate whichever way the line was drawn.
  function planFingers(L, t, fw, mode, margin) {
    margin = Math.max(0, +margin || 0);
    if (!(L > 0)) return { ok: false, why: 'garisnya nol panjang' };
    if (margin * 2 >= L)
      return { ok: false, why: 'offset pinggir ' + fmt0(margin) + ' mm per sisi memakan seluruh garis ' +
        fmt0(L) + ' mm — kecilkan offset' };
    if (!(t > 0)) return { ok: false, why: 'tebal bahan harus lebih dari 0' };
    if (!(fw > 0)) return { ok: false, why: 'lebar finger harus lebih dari 0' };
    const female = mode === 'female';
    const inner = L - 2 * margin;          // the grid lives between the margins
    // Round the count first, then force odd: rounding (want-1)/2 directly sits
    // on a knife edge — a master line of 100.05 vs 99.95 (solver jitter, snap)
    // flipped k between 5 and 3, so male and female built on DIFFERENT grids
    // and a drag changed the whole pattern. Round(inner/fw) is stable: both
    // 60.05/15 and 59.95/15 give n = 4 -> k = 5.
    const n = Math.max(1, Math.round(inner / fw));
    const k = 2 * Math.floor(n / 2) + 1;
    // The female row is made of the male's gaps, and the grid's outermost cells
    // belong to the male: below three cells there is no gap for it to fill.
    if (female && k < 3)
      return { ok: false, why: 'female mengisi celah di antara finger, dan garis sepanjang ' +
        fmt0(L) + ' mm ini cuma punya ' + k + ' kolom — tanpa celah tidak ada yang bisa diisi. Perpanjang garisnya (minimal 2× lebar finger) atau perkecil lebar finger' };
    const cell = inner / k;
    if (!(cell > MIN_CELL))
      return { ok: false, why: 'kolom selebar ' + fmt0(cell) + ' mm terlalu sempit untuk dipotong — perbesar lebar finger atau pakai garis yang lebih panjang' };
    const tabs = [];
    // female owns the odd cells counting from 1 (1st, 3rd, 5th, ...), male the
    // even ones (2nd, 4th, ...): same count logic as `kotak` boxes and the same
    // complement in either shape.
    for (let i = female ? 0 : 1; i < k; i += 2) tabs.push([margin + i * cell, margin + (i + 1) * cell]);
    if (!tabs.length) return { ok: false, why: 'tidak ada tempat untuk satu finger pun' };
    if (typeof console !== 'undefined')
      console.log('[finger] L=' + fmt0(L) + ' off=' + fmt0(margin) + ' inner=' +
        fmt0(inner) + ' fw=' + fmt0(fw) + ' -> n=' + n + ' k=' + k +
        ' cell=' + fmt0(cell) + ' tabs=' + (female ? 'F' : 'M') +
        (female ? '0,2,4..' : '1,3,5..') + ' ' +
        tabs.map(t => fmt0(t[0]) + '-' + fmt0(t[1])).join(', '));
    return {
      ok: true, L, t, cell, cols: k, tabs, count: tabs.length,
      // u measured from the line's a end: the frame box is the whole line, while
      // the rectangles that get grouped cover bmin..bmax — for `female` the outer
      // cell at each end belongs to the mate, so the pattern has to be re-normalised
      bmin: tabs[0][0], bmax: tabs[tabs.length - 1][1]
    };
  }

  // The plan as ONE open path in local coordinates: u along the line from its
  // a end to its b end, v along the side the tabs grow on, the baseline at
  // v = 0. The path walks the baseline and rises over every tab cell — the
  // complete finger-joint edge, ready to cut as a single line, instead of a
  // row of closed rectangles (whose sides would double-cut the joint and the
  // straight master line would slice straight through the tabs).
  function edgePath(plan) {
    const pts = [[0, 0]];
    for (const tab of plan.tabs) {
      const a = tab[0], b = tab[1], last = pts[pts.length - 1];
      if (a - last[0] > 1e-9) pts.push([a, 0]);
      pts.push([a, plan.t], [b, plan.t], [b, 0]);
    }
    const last = pts[pts.length - 1];
    if (plan.L - last[0] > 1e-9) pts.push([plan.L, 0]);
    return pts;
  }

  // ---- the master line ---------------------------------------------------

  // A straight line as a master: its two endpoints in world millimetres plus the
  // point ids the live link pins the frame to.
  // Straightness of one spline segment: null/zero handles are straight; bent
// handles are straight only when both control points sit on the chord (within
// dev mm per side). Traced outlines carry plain polylines, so this stays cheap.
function segIsStraight(api, e, i, dev) {
  const o = e.hs && e.hs.o ? e.hs.o[i] : null;
  const io = e.hs && e.hs.i ? e.hs.i[i] : null;
  const a = api.P(e.pts[i]), b = api.P(e.pts[i + 1]);
  if (!a || !b) return false;
  const chord = (q) => {
    if (!q) return true;
    const ux = b.x - a.x, uy = b.y - a.y, len = Math.hypot(ux, uy);
    if (!(len > 1e-9)) return !q;
    const t = ((q.x - a.x) * ux + (q.y - a.y) * uy) / (len * len);
    if (t <= 0 || t >= 1) return false;
    return Math.hypot(a.x + ux * t - q.x, a.y + uy * t - q.y) <= dev;
  };
  return chord(o) && chord(io);
}

// Maximal straight node runs of a curve: [[startIdx, endIdx], ...] (each run
// spans endIdx-startIdx segments). Used to find where a joint may live.
function curveStraightRuns(api, e, dev) {
  const runs = [];
  if (!e || e.type !== 'spline' || !Array.isArray(e.pts) || e.pts.length < 2) return runs;
  let start = 0;
  for (let i = 0; i + 1 < e.pts.length; i++) {
    const straight = segIsStraight(api, e, i, dev);
    const last = i + 2 === e.pts.length;
    if (!straight || last) {
      const end = straight && last ? i + 1 : i;
      if (end > start) runs.push([start, end]);
      start = i + 1;
    }
  }
  return runs;
}

// The live ends of a master stored as {curve, na, nb} (nodes of a curve) —
// the segment between those two nodes, whatever the curve's other nodes do.
function curveSegEnds(api, id, na, nb) {
  const e = api.state.entities[id];
  if (!e || e.type !== 'spline' || !Array.isArray(e.pts)) return null;
  const pa = api.P(e.pts[na]), pb = api.P(e.pts[nb]);
  if (!pa || !pb) return null;
  const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
  if (!(len > 1e-9)) return null;
  return { curve: +id, na, nb, pa: +e.pts[na], pb: +e.pts[nb],
    x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y, len };
}

function lineEnds(api, id) {
    const e = api.state.entities[id];
    if (!e || e.type !== 'line') return null;
    const a = api.P(e.a), b = api.P(e.b);
    if (!a || !b) return null;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(len > 1e-9)) return null;
    return { line: +id, pa: +e.a, pb: +e.b, x1: a.x, y1: a.y, x2: b.x, y2: b.y, len };
  }

  // The two green handle lines of a frame are `line` entities too; they are
  // construction geometry of some other object, never a joint to build on.
  function guideIds(api) {
    const ids = new Set();
    const ents = api.state.entities;
    for (const key in ents) {
      const e = ents[key];
      if (e && e.guide) for (const g of e.guide) ids.add(+g);
    }
    return ids;
  }

  // Every straight line in the selection, as one row of fingers each.
  function pickedLines(api) {
    const guides = guideIds(api);
    const out = [];
    for (const e of api.selectedEntities()) {
      if (!e || guides.has(+e.id)) continue;
      if (e.type === 'line') {
        const ln = lineEnds(api, e.id);
        if (ln) out.push(ln);
      } else if (e.type === 'spline' && !(e.gen && e.gen.kind)) {
        // a traced or hand-drawn curve: the joint may sit on ONE straight run
        // of its nodes. Exactly one run -> use it; several -> ambiguous, the
        // user picks two adjacent points instead.
        const runs = curveStraightRuns(api, e, 0.05);
        const best = runs.sort((a, b) =>
          (b[1] - b[0]) - (a[1] - a[0]))[0];
        if (!best) {
          api.toast('Finger joint: kurva itu tidak punya segmen lurus — segmen finger harus lurus');
          continue;
        }
        if (runs.length > 1) {
          api.toast('Finger joint: kurva punya ' + runs.length + ' segmen lurus — pilih DUA TITIK ujung segmen yang mau diberi finger');
          continue;
        }
        const ln = curveSegEnds(api, e.id, best[0], best[1]);
        if (ln) out.push(ln);
      }
    }
    // two adjacent points of one curve selected -> that exact segment
    const pts = (api.ui.selection || []).filter(s => s && s.kind === 'point').map(s => +s.id);
    if (pts.length === 2) {
      for (const key in api.state.entities) {
        const e = api.state.entities[key];
        if (!e || e.type !== 'spline' || !Array.isArray(e.pts)) continue;
        const i = e.pts.indexOf(pts[0]), j = e.pts.indexOf(pts[1]);
        if (i < 0 || j < 0 || Math.abs(i - j) !== 1) continue;
        const ln = curveSegEnds(api, +key, Math.min(i, j), Math.max(i, j));
        if (ln) { out.push(ln); break; }
      }
    }
    return out;
  }

  // The master of an existing joint, read LIVE. The endpoints saved in
  // gen.params are only what is used once that line is gone, and then there is
  // nothing to link to: the joint sits where its line last was.
  function masterOf(api, wrap) {
    const m = wrap && wrap.gen && wrap.gen.params ? wrap.gen.params.master : null;
    if (!m) return null;
    if (m.line != null) {
      const live = lineEnds(api, m.line);
      if (live) return live;
    }
    const len = Math.hypot(m.x2 - m.x1, m.y2 - m.y1);
    if (!(len > 1e-9)) return null;
    return { line: null, pa: null, pb: null, x1: m.x1, y1: m.y1, x2: m.x2, y2: m.y2, len };
  }

  // The pose a row takes on a master line. The frame box is the line itself —
  // corner to corner, one `tebal bahan` deep along the normal — for both modes, so
  // the box's baseline corner sits on the line's a end and can be pinned to it,
  // and so the two boards' boxes coincide. The side the tabs grow on is the right
  // normal of a→b, which makes "balik arah" mean the same side in both modes.
  function frameOf(ln, flip) {
    const rx = (ln.y2 - ln.y1) / ln.len, ry = -(ln.x2 - ln.x1) / ln.len;
    return {
      ox: ln.x1, oy: ln.y1,
      ax: (ln.x2 - ln.x1) / ln.len, ay: (ln.y2 - ln.y1) / ln.len,
      nx: flip ? -rx : rx, ny: flip ? -ry : ry,
      L: ln.len, master: ln, pin: ln.pa
    };
  }

  // ---- refit, on release only --------------------------------------------

  // Every joint whose master line no longer matches what the row was baked for —
  // or whose own frame has been stretched out of shape — is rebuilt in place.
  // Called from pointerup and keyup, never from pointermove: see the note at the
  // top of the file.
  // Refit ONE joint to its live master line. Called from the watcher
  // (gen.onChange, see app.js) after a solve moved one of the master line's
  // endpoints — the geometry is settled when this runs, never mid-drag.
  // Returns true when the row was rebuilt.
  function offTag(p) {
    const off = +p.margin || 0;
    return off > 0 ? ' \u00b7 off ' + (Math.round(off * 100) / 100) : '';
  }

  function frameAx(api, ln, p) {
    const rx = (ln.y2 - ln.y1) / ln.len, ry = -(ln.x2 - ln.x1) / ln.len;
    return {
      nx: p.flip ? -rx : rx, ny: p.flip ? -ry : ry,
      ax: (ln.x2 - ln.x1) / ln.len, ay: (ln.y2 - ln.y1) / ln.len
    };
  }

  function refitJoint(api, e) {
    const p = e.gen.params || {};
    const m = p.master;
    if (!m || m.line == null) return false;
    const ln = lineEnds(api, m.line);
    if (!ln) return false;      // the master is gone: nothing to fit to
    // passive modifier: ANY movement of the master's endpoints (translate,
    // rotate, resize) is a change to follow — compare against the recorded
    // endpoints, not just length/angle.
    const lineMoved =
      Math.abs(ln.x1 - m.x1) > REFIT_TOL || Math.abs(ln.y1 - m.y1) > REFIT_TOL ||
      Math.abs(ln.x2 - m.x2) > REFIT_TOL || Math.abs(ln.y2 - m.y2) > REFIT_TOL;
    // The pin only carries the corner, so dragging a frame handle can leave the
    // row wider or narrower than the cut baked into it. The line is the master:
    // the row gives way, not the line.
    const pts = api.state.points;
    const fa = pts[e.p0], fb = pts[e.pw];
    const frameDrift = m.span > 0 && fa && fb &&
      Math.abs(Math.hypot(fb.x - fa.x, fb.y - fa.y) - m.span) > REFIT_TOL;
    if (!lineMoved && !frameDrift) return false;
    const plan = planFingers(ln.len, +p.t, +p.fw, p.mode, +p.margin || 0);
    if (!plan.ok) {
      // remember where the line is so this does not refuse the same thing again
      m.len = api.round2(ln.len); m.ang = angOf(ln);
      api.toast('Finger joint: ' + plan.why);
      return false;
    }
    // In-place first: rewrite the group's contours straight from the new plan.
    // This skips the whole remove -> emit N panels -> group -> bake pipeline.
    if (refitInPlace(api, { e, ln, p, plan })) return true;
    // Fallback: the old path, for a group whose stored shape is not what the
    // in-place writer expects (e.g. hand-edited contours).
    const cfg = {
      t: +p.t, fw: +p.fw,
      mode: p.mode === 'female' ? 'female' : 'male',
      shape: p.shape === 'box' ? 'box' : 'zigzag',
      margin: +p.margin || 0,
      flip: !!p.flip,
      color: e.color || api.ui.color,
      fmt: api.fmt
    };
    api.removeEntity(e.id);
    return !!emitRow(api, frameOf(ln, cfg.flip), plan, cfg, { quiet: true });
  }

  // Rebuild a joint WITHOUT destroying and re-grouping it: write the new tab
  // pattern straight into the group's stored contours (u along the master line
  // over its length L, v over the thickness) AND turn the frame onto the live
  // line — the pin carries only the corner, so the frame's angle must be set
  // here (the guides were removed on purpose, nothing else rotates the box).
  // Returns false when the stored group does not look like what this writes;
  // the caller falls back to the full remove/re-emit path.
  function refitInPlace(api, one) {
    const e = one.e, plan = one.plan, p = one.p, ln = one.ln;
    const L = plan.L, t = +p.t;
    if (!Array.isArray(e.contours)) return false;
    const pts = api.state.points;
    const ph = pts[e.ph], p0 = pts[e.p0], pw = pts[e.pw];
    if (!ph || !p0 || !pw) return false;
    // the joint is always a cutting colour, whatever the master line wears
    e.color = '#000000';
    if (e.contourColors) e.contourColors = e.contours.map(() => '#000000');
    if (p.shape === 'box') {
      // closed rectangles straddling the line: v in 0..1 covers the full
      // symmetric frame, u each tab cell
      // normalise over the BOXES' OWN bbox, not the whole line: that is what
      // the framer did at create time (bake bbox), and the frame this branch
      // writes is that same bbox. Normalising over L here squashed the boxes
      // on the first refit while the plan logged identical numbers.
      const bx0n = plan.tabs[0][0], bxw = plan.tabs[plan.tabs.length - 1][1] - bx0n;
      const un = (x) => (x - bx0n) / bxw;
      e.contours = plan.tabs.map(tab => [
        [un(tab[0]), 0], [un(tab[1]), 0], [un(tab[1]), 1], [un(tab[0]), 1]
      ]);
      e.closed = e.contours.map(() => true);
      if (Array.isArray(e.curveSrc)) {
        e.curveSrc = plan.tabs.map(tab => ({
          closed: true,
          n: [[un(tab[0]), 0], [un(tab[1]), 0], [un(tab[1]), 1], [un(tab[0]), 1]].map(q => ({
            p: q, o: null, i: null
          }))
        }));
      }
      const hx = frameAx(api, ln, p), n2 = t / 2;
      const bx0 = plan.tabs[0][0], bx1 = plan.tabs[plan.tabs.length - 1][1];
      // same rule as emitRow: pw-p0 is the bbox vector, and p0 carries the
      // normal offset. Deriving pw from the offset p0 shortened the frame on a
      // rotated line and skewed the boxes.
      const rvx = hx.ax * (bx1 - bx0), rvy = hx.ay * (bx1 - bx0);
      const rvlen = Math.hypot(rvx, rvy) || 1;
      const rux = rvx / rvlen, ruy = rvy / rvlen;
      ph.x = ln.x1 + hx.ax * bx0 - hx.nx * n2;
      ph.y = ln.y1 + hx.ay * bx0 - hx.ny * n2;
      p0.x = ph.x + hx.nx * t;
      p0.y = ph.y + hx.ny * t;
      pw.x = p0.x + rux * rvlen;
      pw.y = p0.y + ruy * rvlen;
      p0.pr = pw.pr = ph.pr = true;
      e.ratio = (bx1 - bx0) / t;
      for (const cid in api.state.constraints) {
        const c = api.state.constraints[cid];
        if (c && c.type === 'aspect' && +c.entity === +e.id) c.ratio = e.ratio;
      }
      const m2 = p.master;
      m2.len = api.round2(L); m2.ang = angOf(ln); m2.span = api.round2(bx1 - bx0);
      m2.x1 = api.round2(ln.x1); m2.y1 = api.round2(ln.y1);
      m2.x2 = api.round2(ln.x2); m2.y2 = api.round2(ln.y2);
      e.name = 'Finger ' + (p.mode === 'female' ? 'female' : 'male') + ' ' +
        plan.count + ' kotak \u00b7 ' + api.fmt(L) + '\u00d7' + api.fmt(t) + offTag(p);
      return true;
    }
    // pattern: ONE open zig-zag path, v in 0..1 over the thickness. Frame
    // convention (artContoursWorld): v runs from p0 — the OUTER wall — to ph,
    // the baseline on the master line, so baseline is v = 1 and a full tab is
    // v = 0. edgePath is built the other way up (baseline 0, tab tip t), hence
    // the mirror; getting this wrong flips the joint on its first refit and
    // leaves it looking unaligned with the master.
    const edge = edgePath(plan).map(q => [q[0] / L, 1 - q[1] / t]);
    e.contours = [edge];
    e.closed = [false];
    // curveSrc is the CNC export's read of the same pattern (nodes in u,v);
    // a pure polygon has null handles
    if (Array.isArray(e.curveSrc)) {
      e.curveSrc = [{
        closed: false,
        n: edge.map(q => ({ p: [q[0], q[1]], o: null, i: null }))
      }];
    }
    // the frame box IS the master line, both modes: baseline corner on the
    // line's a end, thickness along the (possibly flipped) normal, length along
    // the line. The coincident pin on ph survives this; the aspect lock reads
    // the new ratio off the entity, and the stored constraint must be told or
    // the solver would shrink the row back to the tabs' own bounding box.
    const rx = (ln.y2 - ln.y1) / ln.len, ry = -(ln.x2 - ln.x1) / ln.len;
    const ax = (ln.x2 - ln.x1) / ln.len, ay = (ln.y2 - ln.y1) / ln.len;
    const nx = p.flip ? -rx : rx, ny = p.flip ? -ry : ry;
    ph.x = ln.x1; ph.y = ln.y1;
    p0.x = ln.x1 + nx * t; p0.y = ln.y1 + ny * t;
    pw.x = p0.x + ax * L; pw.y = p0.y + ay * L;
    p0.pr = pw.pr = ph.pr = true;
    e.ratio = L / t;
    for (const cid in api.state.constraints) {
      const c = api.state.constraints[cid];
      if (c && c.type === 'aspect' && +c.entity === +e.id) c.ratio = e.ratio;
    }
    // record what this row was baked for, so the next solve that moves nothing
    // costs nothing (same bookkeeping emitRow does)
    const m = p.master;
    m.len = api.round2(L);
    m.ang = angOf(ln);
    m.span = api.round2(L);
    m.x1 = api.round2(ln.x1); m.y1 = api.round2(ln.y1);
    m.x2 = api.round2(ln.x2); m.y2 = api.round2(ln.y2);
    e.name = 'Finger ' + (p.mode === 'female' ? 'female' : 'male') + ' ' +
      plan.count + ' tab \u00b7 ' + api.fmt(L) + '\u00d7' + api.fmt(t) + offTag(p);
    return true;
  }

  // ---- dialog ------------------------------------------------------------

  function read(params) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (err) { saved = {}; }
    const p = params || {};
    const num = (k, def, lo) => {
      const raw = p[k] != null && p[k] !== '' ? +p[k] : +saved[k];
      return isFinite(raw) && raw >= (lo == null ? 0 : lo) ? raw : def;
    };
    const shapeRaw = p.shape != null ? p.shape : saved.shape;
    const margin = num('margin', 0, 0);
    const modeRaw = p.mode != null ? p.mode : saved.mode;
    const flipRaw = p.flip != null ? p.flip : saved.flip;
    return {
      t: num('t', 3, 0.2),
      fw: num('fw', 6, 0.2),
      shape: shapeRaw === 'box' ? 'box' : 'zigzag',
      margin,
      mode: modeRaw === 'female' ? 'female' : 'male',
      flip: flipRaw != null ? !!flipRaw : false
    };
  }

  NS.register({
    id: 'finger',
    label: 'Finger joint',
    title: 'Finger joint: pilih garis, Create — deretan finger jadi modifier garis itu: ikut bergerak, dan dihitung ulang otomatis tiap solve menggerakkannya. Dobel-klik hasilnya untuk mengubah parameter',
    modalId: 'finger-modal',
    modal: `
<div id="finger-modal" class="modal hidden">
  <div class="modal-box wide-cols">
    <h3>Finger joint</h3>
    <div class="modal-cols">
    <div class="opt-col">
      <label class="opt">Tebal bahan (mm) <input type="number" id="fg-t" value="3" step="0.1" min="0.2"></label>
      <label class="opt">Lebar finger (mm) <input type="number" id="fg-fw" value="6" step="0.5" min="0.2"></label>
      <label class="opt" title="male: kolom pertama menonjol. female: kolom pertama adalah coakan.">Mulai
        <select id="fg-mode">
          <option value="male">male &mdash; tonjolan lebih dulu</option>
          <option value="female">female &mdash; coakan lebih dulu</option>
        </select>
      </label>
      <label class="opt">Offset pinggir (mm) <input type="number" id="fg-margin" value="0" step="0.5" min="0"></label>
      <label class="opt">Bentuk <select id="fg-shape">
        <option value="zigzag">Zig-zag (jalur potong)</option>
        <option value="box">Kotak lubang, center di garis</option>
      </select></label>
      <label class="opt"><input type="checkbox" id="fg-flip"> Balik arah tonjolan</label>
    </div>
    <div class="cnc-status">Pilih <b>minimal satu garis</b> (garis biasa, bukan tepi milik grup), lalu Create: tiap garis jadi SATU jalur potong finger joint lengkap dari ujung ke ujung garis &mdash; naik-turun membentuk tab, bukan kotak terpisah &mdash; set garis masternya hijau (konstruksi) agar tidak ikut dipotong &mdash; <b>lebar finger</b> searah garis, <b>tebal bahan</b> tegak lurusnya. Tonjolan tumbuh ke kanan arah garis (ke luar untuk loop CCW); centang <b>balik arah</b> kalau masuk ke dalam.<br><br>Hasilnya murni <b>modifier garis master</b>: geser/putar/panjangkan garisnya dan baris mengikuti <b>otomatis setelah solve</b> &mdash; jumlah finger ikut dihitung ulang; tarik handle grup sampai salah bentuk, lepas, baris kembali ke ukuran garis. Baris terlalu pendek untuk satu finger pun ditolak dengan pesan.<br><br><b>male</b> &amp; <b>female</b> memakai kisi kolom ganjil yang sama, jadi dua papan di tepi yang sama saling menyilang &mdash; female satu finger lebih sedikit. Lebar finger bersifat nominal: yang tercapai dilaporkan di toast. Dobel-klik grup untuk mengubah parameter.</div>
    </div>
    <div class="modal-actions">
      <button class="btn" id="finger-cancel">Cancel</button>
      <button class="btn primary" id="finger-ok">Create</button>
    </div>
  </div>
</div>`,

    open(api, params) {
      const s = read(params);
      const el = (id) => document.getElementById(id);
      el('fg-t').value = s.t;
      el('fg-fw').value = s.fw;
      el('fg-mode').value = s.mode;
      el('fg-shape').value = s.shape;
      el('fg-margin').value = s.margin;
      el('fg-flip').checked = s.flip;
      const ok = el('finger-ok');
      if (ok) ok.focus();
    },

    // Mounted once, by registry.js. Bubble-phase on window, so this runs after
    // the canvas's own pointerup handler: the release solve has already put the
    // dragged geometry where it belongs and the refit reads the line as it ended
    // up. Nothing here runs during a drag, so a row of tabs is never re-baked
    // frame by frame. keyup covers the length changed without a pointer — a
    // dimension typed in or an arrow-key nudge.
    // Watcher-driven refit (see app.js "Generator watchers"): after any solve
    // that moved a master-line endpoint, this runs with the geometry already
    // settled. No pointerup/keyup listeners: a change that never moves the
    // line (a plain click, an unrelated drag) costs nothing, and a change made
    // without the pointer (a typed dimension, undo) triggers the same way.
    onChange(api, e) {
      if (refitJoint(api, e)) api.commit();
    },

    // functions are not serialized: after a document load, re-register the
    // watch on the master line's endpoints
    rewatch(api, e) {
      // Documents saved before the private-point flag carry the frame points
      // as visible, grabbable handles — dragging one yanked the master line
      // through the coincident pin. Repair them right here, at every load.
      for (const pid of [e.p0, e.pw, e.ph]) {
        const pt = api.state.points[pid];
        if (pt) pt.pr = true;
      }
      // strip the legacy pin on load: the joint is passive now, a saved pin
      // would still let its frame drag the master line around
      for (const cid in api.state.constraints) {
        const c = api.state.constraints[cid];
        if (c && c.type === 'coincident' && (+c.p1 === +e.ph)) delete api.state.constraints[cid];
      }
      const m = e.gen && e.gen.params ? e.gen.params.master : null;
      if (!m || m.line == null) return;
      const ln = lineEnds(api, m.line);
      if (ln && ln.pa != null) api.watchGen(e.id, [ln.pa, ln.pb]);
    },

    apply(api) {
      const el = (id) => document.getElementById(id);
      const clamp = api.clamp, fmt = api.fmt, toast = api.toast;
      const t = clamp(+el('fg-t').value || 3, 0.2, 200);
      const fw = clamp(+el('fg-fw').value || 6, 0.2, 5000);
      const mode = el('fg-mode').value === 'female' ? 'female' : 'male';
      const shape = el('fg-shape').value === 'box' ? 'box' : 'zigzag';
      const margin = api.clamp(+el('fg-margin').value || 0, 0, 100000);
      const flip = !!el('fg-flip').checked;
      NS.close('finger');
      try { localStorage.setItem(KEY, JSON.stringify({ t, fw, mode, shape, margin, flip })); }
      catch (err) { /* storage blocked */ }

      // The joint this is a re-edit of, when there is one.
      let prev = null;
      for (const s of api.ui.selection || []) {
        const e = s && s.kind === 'entity' ? api.state.entities[s.id] : null;
        if (e && e.type === 'art' && e.gen && e.gen.kind === 'finger') { prev = e; break; }
      }

      // One row per selected line; with nothing selected a re-edit falls back to
      // the master line that joint was built on.
      const lines = pickedLines(api);
      if (!lines.length && prev) {
        const m = masterOf(api, prev);
        if (m) lines.push(m);
      }
      if (!lines.length) {
        toast('Finger joint: pilih dulu satu garis atau lebih — garis biasa, bukan tepi dari sebuah grup');
        return;
      }

      const frames = lines.map(ln => frameOf(ln, flip));

      // Plan every row before the document is touched: a line that cannot carry
      // the joint is refused, and nothing half-built is left in the undo stack.
      const plans = [];
      for (const f of frames) {
        const p = planFingers(f.L, t, fw, mode, margin);
        if (!p.ok) {
          toast('Finger joint: garis master ' + fmt0(f.L) + ' mm — ' + p.why);
          return;
        }
        plans.push(p);
      }

      api.pushHistory();
      // Replace the old joint in the same history step instead of stacking a
      // second copy on top of it (grouping a lone art object is refused). Its own
      // links disappear with it: removeEntity prunes every constraint hanging on
      // the guides and the points that go away.
      if (prev) api.removeEntity(prev.id);

      const cfg = { t, fw, mode, shape, margin, flip, color: '#000000', fmt }; // always a cutting colour — the master may be construction green
      let built = 0;
      let tabs = 0;
      let links = 0;
      for (let i = 0; i < frames.length; i++) {
        const r = emitRow(api, frames[i], plans[i], cfg);
        if (r) { built++; if (r.linked) links++; tabs += plans[i].count; }
      }
      api.requestSolve();
      api.commit();
      if (!built) { toast('Finger joint: tidak ada grup yang jadi'); return; }
      toast('Finger joint: ' + built + ' deret · ' + tabs + ' finger · lebar ' +
        fmt(plans[0].cell) + ' mm (diminta ' + fmt(fw) + ') · tebal ' + fmt(t) +
        ' mm · ' + (mode === 'female' ? 'diawali coakan' : 'diawali tonjolan') +
        (links === built
          ? ' · modifier dari garis master — geser garisnya, barisnya ikut otomatis setelah solve'
          : links ? ' · ' + links + ' dari ' + built + ' deret tertaut, sisanya garis master sudah dihapus'
            : ' · garis master sudah dihapus — dipakai posisi terakhir yang tersimpan, jadi tidak ikut bergerak'));
    }
  });

  // One row: emit the tabs straight, group them, strip the frame's guide lines,
  // turn the frame onto the master line, then pin that frame to the line's a end so
  // the solver carries the joint along with the master.
  // box mode: each tab cell as a CLOSED rectangle straddling the master line,
  // half the thickness to each side — finger holes centred on the line, to be
  // boolean-subtracted from a panel rather than cut as an edge path.
  function boxRects(plan) {
    const h = plan.t / 2;
    return plan.tabs.map(tab => [
      { x: tab[0], y: h }, { x: tab[1], y: h },
      { x: tab[1], y: -h }, { x: tab[0], y: -h }
    ]);
  }

  function emitRow(api, frame, plan, cfg, opts) {
    const L = plan.L;
    let made = [];
    if (cfg.shape === 'box') {
      // Same route as zigzag: ONE polyline in world coordinates. The framer
      // normalises whatever it is handed to an AXIS-ALIGNED bbox (addFramedObject
      // uses minX/maxX/minY/maxY, plus horizontal + perpendicular guides), so a
      // frame derived from the row's own oriented box can never match it: on a
      // rotated line the axis-aligned bbox is larger and not parallel to the
      // line, and the boxes get stretched diagonally. Handing the geometry over
      // as one world path and letting the framer do the normalisation (which is
      // exactly what the zigzag path does) keeps the boxes undistorted.
      const path = [];
      for (const rect of boxRects(plan)) {
        for (const q of rect) {
          path.push({ x: frame.ox + frame.ax * q.x + frame.nx * q.y,
                      y: frame.oy + frame.ay * q.x + frame.ny * q.y });
        }
        // close this box and jump to the next one as a separate subpath
        path.push({ ...path[path.length - 4] });
      }
      const id = api.addPolylineEntity(path, cfg.color);
      made = id ? [id] : [];
    } else {
      const id = api.addPolylineEntity(
        edgePath(plan).map(q => ({ x: frame.ox + q[0], y: frame.oy + q[1] })),
        cfg.color);
      made = id ? [id] : [];
    }
    if (!opts || !opts.quiet) api.commit();
    if (!made.length) { api.toast('Finger joint: jalur finger gagal dibuat'); return null; }

    api.ui.selection = made.map(id => ({ kind: 'entity', id }));
    api.cmdGroupSelection({ noHistory: true });
    const wrap = api.ui.selection.length === 1
      ? api.state.entities[api.ui.selection[0].id] : null;
    if (!wrap || wrap.type !== 'art') {
      api.toast('Finger joint: tonjolan ada di kanvas, tapi tidak berhasil digrup');
      return null;
    }

    // The joint has no furniture of its own: the two green guides the framer
    // handed it are removed, and removing them takes the constraints that hang on
    // them (`horizontal`, `perpendicular`) with them — removeEntity prunes by
    // entity and by orphaned point, and the frame's three points are still the
    // group's, so the aspect lock survives as the only thing left on the frame.
    // What is left to drag is the frame's own corner handles, and stretching the
    // row with one of those is caught on release by the refit, which re-derives
    // the joint from the master line rather than letting it stay out of shape.
    for (const gid of (wrap.guide || []).map(Number)) api.removeEntity(gid);
    wrap.guide = [];
    // The three frame points are the modifier's plumbing, not drawing handles:
    // mark them private (invisible, ungrabbable, skipped by Ctrl+A) so the row
    // behaves as a pure modifier of the master line. The solver still moves
    // them; the group body drag still moves them with it.
    for (const pid of [wrap.p0, wrap.pw, wrap.ph]) {
      const pt = api.state.points[pid];
      if (pt) pt.pr = true;
    }

    // ph is the baseline corner on the line's a end, p0 the outer wall above it,
    // pw one whole line length along: the frame box IS the master line, in both
    // modes, so the box has an endpoint to pin to and the two boards' boxes land
    // on top of each other.
    let frameLen = L;
    if (cfg.shape === 'box') {
      frameLen = plan.tabs[plan.tabs.length - 1][1] - plan.tabs[0][0];
    }
    const p0 = api.state.points[wrap.p0];
    const pw = api.state.points[wrap.pw];
    const ph = api.state.points[wrap.ph];
    if (p0 && pw && ph) {
      // One frame recipe for both shapes (the zigzag one, which is the one that
      // works): ph on the line's a end, p0 one thickness along the normal, pw a
      // whole line length along. The framer then re-normalises the contours to
      // this box, so the emitted world geometry and the stored u/v agree.
      // Box mode: these provisional u/v come from the bake's AXIS-ALIGNED bbox
      // and would render skewed on a slanted line — but the refitInPlace call
      // at the end of emitRow rewrites them into the oriented frame right
      // away, the same code path the master-line watcher runs on every move.
      ph.x = frame.ox; ph.y = frame.oy;
      p0.x = frame.ox + frame.nx * cfg.t; p0.y = frame.oy + frame.ny * cfg.t;
      pw.x = p0.x + frame.ax * L; pw.y = p0.y + frame.ay * L;
    }

    // The aspect lock must hold the frame this row was baked for, or the solver
    // shrinks the row back to the baked group's own bounding box.
    wrap.ratio = frameLen / cfg.t;
    for (const cid in api.state.constraints) {
      const c = api.state.constraints[cid];
      if (c && c.type === 'aspect' && +c.entity === +wrap.id) c.ratio = wrap.ratio;
    }

    // The live link, and the only one: the corner rides on the end of the line, so
    // moving the master carries the joint. A `reference` constraint would be
    // ignored by the solver, so this is a driving one — and a deleted master line
    // is nothing to link to. Carrying the line's ANGLE would need a line pair, and
    // the line pair was the guide that is now gone: angle is re-derived on release.
    // fully passive: no constraint ties the joint to the master line at all.
    // The watcher refit is the only thing that moves it — it never pulls the
    // line, and the line never drags it through the solver.
    let linked = false;

    wrap.gen = {
      kind: 'finger',
      params: {
        t: cfg.t, fw: cfg.fw, mode: cfg.mode, shape: cfg.shape, margin: cfg.margin, flip: cfg.flip,
        master: {
          line: frame.master.line == null ? null : frame.master.line,
          // the length and direction this row was baked for: the release refit
          // compares the live line against them, so a joint that is already right
          // costs nothing
          len: api.round2(L),
          ang: angOf(frame.master),
          // the frame box this row was baked for — the whole line in zigzag, the
          // boxes' own bbox in box mode (matching refitInPlace's bookkeeping)
          span: api.round2(cfg.shape === 'box'
            ? plan.tabs[plan.tabs.length - 1][1] - plan.tabs[0][0]
            : L),
          x1: api.round2(frame.master.x1), y1: api.round2(frame.master.y1),
          x2: api.round2(frame.master.x2), y2: api.round2(frame.master.y2)
        }
      }
    };
    wrap.name = 'Finger ' + cfg.mode + ' ' + plan.count + ' ' +
      (cfg.shape === 'box' ? 'kotak' : 'tab') + ' · ' +
      cfg.fmt(L) + '×' + cfg.fmt(cfg.t) +
      ((+cfg.margin || 0) > 0 ? ' · off ' + cfg.fmt(+cfg.margin) : '');
    // the live link: watch the master line's endpoints so a solve that moves
    // either of them re-derives this row from the settled line
    if (frame.master.line != null && frame.master.pa != null) {
      api.watchGen(wrap.id, [frame.master.pa, frame.master.pb]);
      linked = true;   // watcher terpasang = deret ini tertaut ke garis master
    }
    // create-time refit: run the exact same in-place rebuild the master-line
    // watcher runs when a solve moves the line, so the stored u/v and the
    // frame are written by ONE code path. Without it, box mode keeps the
    // bake's axis-aligned u/v and renders skewed / off the line on a slanted
    // master until the first real move. gen.params must exist first (above).
    refitInPlace(api, { e: wrap, plan, p: wrap.gen.params, ln: frame.master });
    return { linked };
  }
})();
