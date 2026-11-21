// Extrude wall: a flat closed outline becomes a laser-cut 3D object.
//
// The master outline is copied into a part set:
//
//   Base       the outline with finger joint notches punched along the edge
//   Lid        the outline, plus an engraved guide at the wall's inner face
//   Lid plug   the outline offset inward, to seat inside the wall opening
//   Wall       one flat strip: tabs along its BOTTOM edge (they slide into the
//              base notches) and a living-hinge pattern wherever the outline
//              curves
//
// Measurements all start at the master edge and go inward: the wall's mid
// plane sits at inset + t/2, so its outer face is flush with the plate by
// default. Clipper offsets are sign-only (positive grows the polygon, negative
// shrinks it, whatever the winding), so the sign flips on hole loops: the
// nesting depth decides which side the material is on.
//
// The hinge is the whole trick, and it is not a uniform comb:
//
//   * Two column patterns alternate. Column A is bridged at both ends of the
//     strip height, column B in the middle, and the bridges are laid out
//     symmetrically about the middle. Neighbouring columns are therefore never
//     cut at the same height, which is what makes the strip bend both ways
//     instead of collapsing along one fold line.
//   * Cuts appear only where the outline actually curves. A curve's radius is
//     estimated from the tangent turning over a short window; anything gentler
//     than ~60 material thicknesses folds without help and stays solid. Zones
//     are merged when the straight gap between them is short, and extended a
//     little past each curve so the corner is spread over more columns.
(() => {
  'use strict';

  const NS = window.MiniSketchTools;
  const KEY = 'minisketch.v1.extrudeWall';
  const GAP = 30;              // mm between the parts in the layout

  // Tuning, all in material thicknesses unless noted.
  const K_BRIDGE = 1.4;        // height of an uncut web inside the hinge
  const K_BRIDGE_PITCH = 4.37; // spacing between those webs
  const K_BAND = 1.875;        // target height of one interlocking band
  const K_FINGER = 1.5;        // half-lap finger at the strip's two ends
  const K_TAB = 2;             // finger width, in material thicknesses
  const K_TAB_PITCH = 4;       // spacing between fingers, in thicknesses
  // A finger is a straight prism, so a finger joint needs a reasonably gentle
  // bend. Below this radius the strip butt-joins instead (glued). 25 mm is the
  // threshold the reference flat-pack generator uses; the 3x stock term only
  // kicks in on very thick board, where a 24 mm finger on a 25 mm radius would
  // be nonsense.
  const TAB_MIN_R_MM = 25;      // mm
  const TAN_SPAN = 0.4;        // mm of chord either side used to read a tangent
  const GAP_MERGE = 8;         // mm: a straight gap this short joins two bends
  const SLIT_EDGE = 3;         // mm of solid material at the seam and at tabs

  // ---- path math ---------------------------------------------------------

  function pathAt(info, s) {
    let d = ((s % info.total) + info.total) % info.total;
    for (let i = 0; i < info.segs.length; i++) {
      const seg = info.segs[i];
      if (d <= seg.len || i === info.segs.length - 1) {
        const k = seg.len > 1e-12 ? d / seg.len : 0;
        return {
          x: seg.a.x + seg.dx * k,
          y: seg.a.y + seg.dy * k,
          tx: seg.dx / seg.len,
          ty: seg.dy / seg.len
        };
      }
      d -= seg.len;
    }
    const s0 = info.segs[0];
    return { x: s0.a.x, y: s0.a.y, tx: s0.dx / s0.len, ty: s0.dy / s0.len };
  }

  function pathInfo(pts) {
    const segs = [];
    let total = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) continue;
      segs.push({ a, b, dx, dy, len, s0: total });
      total += len;
    }
    return { segs, total };
  }

  function bboxOf(list) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pts of list) {
      for (const p of pts || []) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }
    if (!isFinite(minX)) return null;
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  }

  // ---- curvature ---------------------------------------------------------

  // Sample the loop on a fine grid and read the turn per sample. The tangent
  // comes from a chord a short way either side, so one stray vertex cannot spin
  // a slot.
  //
  // Two readings come out of this and they are NOT interchangeable:
  //   turn[j]  the turn AT one sample. A collinear run reports exactly zero,
  //            which is what keeps a straight edge free of hinge cuts. On a
  //            tessellated curve the turn piles up on the vertices, and the
  //            hinge sums a whole run, so the total is still right.
  //   R[j]     the local RADIUS, from the turn summed over a window. Per-sample
  //            turn cannot give a radius: an arc drawn as 16 chords reads as
  //            "straight, straight, … sharp vertex, …" and reports a few mm on a
  //            20 mm fillet, which then wrongly forbids a finger joint there.
  function loopProfile(pts) {
    const info = pathInfo(pts);
    const L = info.total;
    const ns = Math.max(24, Math.round(L / 0.25));
    const step = L / ns;
    const X = new Float64Array(ns), Y = new Float64Array(ns);
    for (let j = 0; j < ns; j++) {
      const p = pathAt(info, j * step);
      X[j] = p.x;
      Y[j] = p.y;
    }
    const hb = Math.max(1, Math.round(TAN_SPAN / step));
    const th = new Float64Array(ns);
    for (let j = 0; j < ns; j++) {
      const a = (j - hb + ns * 4) % ns, b = (j + hb) % ns;
      th[j] = Math.atan2(Y[b] - Y[a], X[b] - X[a]);
    }
    let segMax = 0;
    for (const seg of info.segs) if (seg.len > segMax) segMax = seg.len;
    const turn = new Float64Array(ns);
    const R = new Float64Array(ns);
    for (let j = 0; j < ns; j++) {
      let d = th[(j + 1) % ns] - th[j];
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d <= -Math.PI) d += 2 * Math.PI;
      turn[j] = d;
    }
    // The radius window has to clear the longest chord (or it catches no vertex
    // on a tessellated arc and reads a straight line) without ever reaching
    // across a real feature — hence the 3 mm ceiling.
    const hw = Math.max(2, Math.min(Math.round(3.0 / step), Math.round(2.5 * segMax / step)));
    // turn[j] spans the interval [j, j+1], so summing k = -hw..hw covers
    // (2*hw + 1) steps of arc, not 2*hw.
    const span = (2 * hw + 1) * step;
    for (let j = 0; j < ns; j++) {
      let sum = 0;
      for (let k = -hw; k <= hw; k++) sum += Math.abs(turn[((j + k) % ns + ns) % ns]);
      R[j] = sum < 1e-9 ? Infinity : span / sum;
    }
    return { step, ns, R, turn, L };
  }

  // Hinge columns: one relief cut per kerf / thickness radians of turn, all of
  // them inside the stretch that actually bends.
  //
  // The count comes from the turn, not from a nominal pitch: a 90 degree fillet
  // needs the same number of cuts whether it is small or large, and a run that
  // barely turns needs none at all — that is what keeps a straight edge clean.
  // The cuts are then spread evenly over the curved stretch, and the stretch is
  // widened symmetrically only when the cuts would otherwise be closer together
  // than the cut pitch (a sharp corner, where the turn happens in one sample).
  function hingeCuts(profile, prm) {
    const { ns, step, R, turn, L } = profile;
    const plainR = prm.plainRK * prm.thick;
    const perCut = Math.max(0.03, prm.kerf / Math.max(0.5, prm.thick));
    const curved = new Uint8Array(ns);
    let any = false;
    for (let j = 0; j < ns; j++) {
      if (R[j] < plainR) { curved[j] = 1; any = true; }
    }
    if (!any) return { zones: 0, cuts: [] };

    // walk from an uncurved sample so no run has to wrap around the seam
    let start = 0;
    while (start < ns && curved[start]) start++;
    if (start >= ns) start = 0;
    const runs = [];
    let cur = null;
    for (let k = 0; k < ns; k++) {
      const j = (start + k) % ns;
      if (curved[j]) {
        if (!cur) cur = { j0: j, j1: j, turn: 0 };
        cur.j1 = j;
        cur.turn += Math.abs(turn[j]);
      } else if (cur) {
        runs.push(cur);
        cur = null;
      }
    }
    if (cur) runs.push(cur);

    // short straight gaps between two bends belong to the fold too
    const gapSamples = (a, b) => ((b - a + ns) % ns);
    const merged = [];
    for (const r of runs) {
      const prev = merged[merged.length - 1];
      if (prev && gapSamples(prev.j1, r.j0) * step <= GAP_MERGE) {
        prev.j1 = r.j1;
        prev.turn += r.turn;
      } else {
        merged.push({ j0: r.j0, j1: r.j1, turn: r.turn });
      }
    }
    if (merged.length > 1) {
      const first = merged[0], last = merged[merged.length - 1];
      if (gapSamples(last.j1, first.j0) * step <= GAP_MERGE) {
        last.j1 = first.j1;
        last.turn += first.turn;
        merged.shift();
      }
    }

    const cuts = [];
    const minPitch = Math.max(0.6, prm.cutPitch);
    for (const r of merged) {
      const need = Math.ceil(r.turn / perCut - 1e-6);
      if (!(need >= 1)) continue;                       // too little bend to matter
      const spanIdx = gapSamples(r.j0, r.j1) + 1;
      const span = spanIdx * step;
      const pitch = need < 2 ? 0 : Math.max(span / (need - 1), minPitch);
      const centre = (r.j0 + gapSamples(r.j0, r.j1) / 2) * step;
      for (let k = 0; k < need; k++) {
        const s = centre + (k - (need - 1) / 2) * pitch;
        cuts.push({ s: ((s % L) + L) % L, col: k % 2 });
      }
    }
    return { zones: merged.length, cuts };
  }

  // ---- hinge pattern -----------------------------------------------------

  // Bridges are uncut webs. They sit at symmetric heights along the strip and
  // are dealt to two columns, A taking the outermost pair, B the next one in.
  // A cut in one column therefore always faces solid material in its
  // neighbour, which is what lets the strip fold both ways.
  function bridgePlan(Hw, thick) {
    const bw = K_BRIDGE * thick;
    const pT = K_BRIDGE_PITCH * thick;
    const room = Math.max(0, Hw - bw);
    const n = Math.max(2, Math.round(room / pT) + 1);
    const p = room / (n - 1);
    const bands = { A: [], B: [] };
    for (let j = 0; j < n; j++) {
      const c = bw / 2 + j * p;
      const outer = Math.min(j, n - 1 - j);
      bands[n === 2 ? (j === 0 ? 'A' : 'B') : (outer % 2 === 0 ? 'A' : 'B')]
        .push([c - bw / 2, c + bw / 2]);
    }
    const cutsOf = (list) => {
      const out = [];
      let y = 0;
      for (const [a, b] of list) {
        if (a - y > 0.05) out.push([y, a]);
        y = b;
      }
      if (Hw - y > 0.05) out.push([y, Hw]);
      return out;
    };
    return { colA: cutsOf(bands.A), colB: cutsOf(bands.B) };
  }

  // ---- one loop -> wall plan ---------------------------------------------

  // Signed offset from the master edge to the wall's mid plane / faces. Islands
  // sit inside the loop, holes outside it (the wall goes under the plate ring),
  // hence the sign flip on odd nesting depth.
  const signOf = (loop) => (loop.depth % 2 === 0 ? -1 : 1);
  const midDelta = (loop, inset, t) => signOf(loop) * (inset + t / 2);
  const guideDelta = (loop, inset) => signOf(loop) * inset;
  const plugDelta = (loop, inset, t, fit) => signOf(loop) * (inset + t + fit);

  function offsetOne(api, pts, delta, join) {
    const res = api.offsetClosedChains([{ pts, closed: true }], delta,
      { join: join || 'miter', miterLimit: 2, arcTol: 0.05 });
    if (!res || !res.length) return null;
    let best = res[0];
    for (const c of res) {
      if (Math.abs(api.signedAreaPts(c.pts)) > Math.abs(api.signedAreaPts(best.pts))) best = c;
    }
    return best.pts;
  }

  // Loop minus a set of cut-outs, through the exact engine (api.polyBoolOp).
  function subtractLoops(api, subjectLoops, clipLoops) {
    if (!clipLoops.length) return subjectLoops.map(p => p.slice());
    return api.polyBoolOp('difference', subjectLoops, clipLoops) ||
      subjectLoops.map(p => p.slice());
  }

  function planFor(api, loop, prm) {
    const path = offsetOne(api, loop.pts, midDelta(loop, prm.inset, prm.thick), 'miter');
    if (!path || path.length < 3) return null;
    const info = pathInfo(path);
    const L = info.total;
    // The finger joint follows the stock: both the width of a finger and the
    // spacing between fingers are multiples of the material thickness, so the
    // notch in the plate grows with it. That keeps the joint a joint (a finger
    // narrower than the stock is just a nick) at every thickness.
    const tabW = api.clamp(prm.tabK * prm.thick, 2, 200);
    const tabPitch = api.clamp(prm.pitchK * prm.thick, tabW + 3, 1000);
    if (!(L > Math.max(10, tabW + 6)) || info.segs.length < 3) return null;

    const ccw = api.signedAreaPts(path) > 0;
    // outward normal points away from the enclosed area (toward the plate edge)
    const outward = (tx, ty) => (ccw ? { x: ty, y: -tx } : { x: -ty, y: tx });

    // The local radius decides whether a finger joint is possible at all. A
    // finger is a straight prism, so where the wall bends tightly the slot cut
    // through a curved edge no longer measures the finger width: measured along
    // the plate edge it reads wider the tighter the bend (an arc is longer than
    // its chord), and the two cut faces stop lining up with the finger's sides.
    // Below TAB_MIN_RK x thickness the joint is therefore left out — the strip
    // butt-joins there and is glued, which is what flat-pack generators do.
    const profile = loopProfile(path);
    const minR = prm.tabMinR != null ? prm.tabMinR : Math.max(TAB_MIN_R_MM, 3 * prm.thick);
    const radiusNear = (s, half) => {
      const span = Math.max(1, Math.ceil(half / profile.step));
      const centre = Math.round(s / profile.step);
      let r = Infinity;
      for (let k = -span; k <= span; k++) {
        const j = ((centre + k) % profile.ns + profile.ns) % profile.ns;
        if (profile.R[j] < r) r = profile.R[j];
      }
      return r;
    };

    // tabs, spread evenly along the loop; too-tight stretches are skipped
    const nMax = Math.max(1, Math.floor(L / (tabW + 3)));
    const nTabs = Math.max(1, Math.min(Math.round(L / tabPitch), nMax));
    const tabs = [];
    const notches = [];
    let tooTight = 0;
    for (let i = 0; i < nTabs; i++) {
      const s = (i + 0.5) * L / nTabs;
      if (radiusNear(s, tabW / 2 + prm.thick) < minR) { tooTight++; continue; }
      const at = pathAt(info, s);
      const n = outward(at.tx, at.ty);
      const at2 = (a, b) => ({
        x: at.x + at.tx * a + n.x * b,
        y: at.y + at.ty * a + n.y * b
      });
      tabs.push({ x0: s - tabW / 2, x1: s + tabW / 2 });
      // The notch is the finger's footprint plus the kerf, and nothing else.
      // The finger is a prism of `tabW` along the wall and one STOCK THICKNESS
      // across it — the strip is drawn flat, so its thickness is out of plane and
      // the hole that receives it must be `thickness + kerf` wide (not a function
      // of the finger's length). That width belongs to the joint, so an edge
      // inset must not inflate it: the inset only moves the whole slot inward with
      // the wall — otherwise a 2 mm inset on a 2 mm board gave a 5 mm hole.
      const hw = (tabW + prm.kerf) / 2;
      const hd = (prm.thick + prm.kerf) / 2;
      notches.push([
        at2(-hw, -hd), at2(hw, -hd), at2(hw, hd), at2(-hw, hd)
      ]);
    }

    // Hinge columns: only where the outline actually turns, and never in the
    // last few mm before the seam.
    //
    // Fingers are deliberately NOT excluded. With the finger pitch at 4x the
    // stock the material between two fingers is only 2x the stock, so a margin
    // around every finger would swallow the whole strip and leave a corner with
    // no cuts at all — the strip then cannot bend where it must. A cut that ends
    // at a finger's shoulder lands on an existing concave corner (the ideal
    // place); one that ends inside a finger still only reaches the finger's top
    // edge, so the finger itself stays whole.
    const hinge = hingeCuts(profile, prm);
    const plan = bridgePlan(prm.height, prm.thick);
    const cols = [];
    for (const c of hinge.cuts) {
      if (c.s < SLIT_EDGE || L - c.s < SLIT_EDGE) continue;
      cols.push({ s: c.s, cuts: c.col === 0 ? plan.colA : plan.colB });
    }

    return {
      L, tabs, notches, cols, zones: hinge.zones, tooTight,
      tabW, slotLen: tabW + prm.kerf, slotW: prm.thick + prm.kerf,
      bands: (() => {
        const q = prm.height / (K_BAND * prm.thick);
        return Math.max(3, 2 * Math.round((q - 1) / 2) + 1);   // odd: ends match
      })(),
      color: loop.color || null
    };
  }

  // ---- flat strip --------------------------------------------------------

  // Local coordinates: body 0..L wide and 0..Hw tall, tabs hanging below y=0.
  // The two ends alternate in and out per band, so when the strip is wrapped
  // the ends overlap as a half-lap joint instead of meeting on a butt seam.
  function stripOutline(L, Hw, tabH, tabs, finger, bands) {
    const sh = Hw / bands;
    const xl = j => (j % 2 === 0 ? -finger : 0);
    const xr = j => L - (j % 2 === 0 ? finger : 0);
    const pts = [{ x: xl(0), y: 0 }];
    for (const t of tabs) {
      pts.push({ x: t.x0, y: 0 }, { x: t.x0, y: -tabH }, { x: t.x1, y: -tabH }, { x: t.x1, y: 0 });
    }
    for (let j = 0; j < bands; j++) {
      pts.push({ x: xr(j), y: j * sh }, { x: xr(j), y: (j + 1) * sh });
    }
    pts.push({ x: xl(bands - 1), y: Hw });
    for (let j = bands - 1; j >= 0; j--) {
      pts.push({ x: xl(j), y: (j + 1) * sh }, { x: xl(j), y: j * sh });
    }
    return pts;
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
    const thick = num('thick', 3, 0.5);
    // Finger width and pitch are multiples of the material thickness — a 10 mm
    // finger is right on 3 mm stock and useless on 12 mm. Documents saved before
    // this are in millimetres, so those are converted rather than reinterpreted.
    const asK = (mmKey, def) => {
      const mm = p[mmKey] != null && p[mmKey] !== '' ? +p[mmKey] : +saved[mmKey];
      return isFinite(mm) && mm > 0 ? mm / thick : def;
    };
    return {
      height: num('height', 40, 2),
      thick,
      inset: num('inset', 0, 0),
      tabK: num('tabK', asK('tabW', K_TAB), 0.2),
      pitchK: num('pitchK', asK('pitch', K_TAB_PITCH), 0.5),
      cutPitch: num('cutPitch', 1.5, 0.6),
      kerf: num('kerf', 0.4, 0),
      plainRK: num('plainRK', 60, 2)
    };
  }

  NS.register({
    id: 'wall',
    label: 'Extrude wall',
    title: 'Extrude wall: turn the selected closed loops into a flat-pack set — base with finger joint notches, bendable wall strip (hinge cuts only where the outline curves), lid and lid plug. Double click the result to edit its parameters',
    modalId: 'wall-modal',
    guide: {
      en: {
        main: 'Each selected loop becomes a flat-pack set: <b>base</b> with finger notches, engraved <b>lid</b> + plug, and a bendable <b>wall</b> strip. Joints follow the thickness; fingers need a bend radius of at least 25&nbsp;mm. Double click the result to edit.'
      },
      id: {
        main: 'Tiap loop terpilih jadi satu set flat-pack: <b>base</b> bermues finger, <b>lid</b> bergaris pandu + plug-nya, dan strip <b>dinding</b> yang bisa dibengkokkan. Sambungan mengikuti tebal bahan; finger butuh radius belok minimal 25&nbsp;mm. Dobel-klik hasil untuk mengubah.'
      }
    },
    modal: `
<div id="wall-modal" class="modal hidden">
  <div class="modal-box wide-cols">
    <h3>Extrude wall &middot; flat-pack set</h3>
    <div class="modal-cols">
    <div class="opt-col">
      <label class="opt">Wall height (mm) <input type="number" id="wall-h" value="40" step="1" min="2"></label>
      <label class="opt">Material thickness (mm) <input type="number" id="wall-t" value="3" step="0.1" min="0.5"></label>
      <label class="opt">Edge inset (mm) <input type="number" id="wall-inset" value="0" step="0.5" min="0"></label>
      <label class="opt">Finger width (&times; thickness) <input type="number" id="wall-tabk" value="2" step="0.1" min="0.2"></label>
      <label class="opt">Finger pitch (&times; thickness) <input type="number" id="wall-pitchk" value="4" step="0.1" min="0.5"></label>
      <label class="opt">Hinge cut pitch (mm) <input type="number" id="wall-cutpitch" value="1.5" step="0.1" min="0.6"></label>
      <label class="opt">Curve threshold (&times; thickness) <input type="number" id="wall-plainrk" value="60" step="5" min="2"></label>
      <label class="opt">Laser kerf (mm) <input type="number" id="wall-kerf" value="0.4" step="0.05" min="0"></label>
    </div>
    <div class="cnc-status" data-guide="main"></div>
    </div>
    <div class="modal-actions">
      <button class="btn" id="wall-cancel">Cancel</button>
      <button class="btn primary" id="wall-ok">Create</button>
    </div>
  </div>
</div>`,

    open(api, params) {
      const s = read(params);
      const el = (id) => document.getElementById(id);
      el('wall-h').value = s.height;
      el('wall-t').value = s.thick;
      el('wall-inset').value = s.inset;
      el('wall-tabk').value = s.tabK;
      el('wall-pitchk').value = s.pitchK;
      el('wall-cutpitch').value = s.cutPitch;
      el('wall-kerf').value = s.kerf;
      el('wall-plainrk').value = s.plainRK;
      const ok = el('wall-ok');
      if (ok) ok.focus();
    },

    apply(api) {
      const el = (id) => document.getElementById(id);
      const clamp = api.clamp, fmt = api.fmt, toast = api.toast;
      const height = clamp(+el('wall-h').value || 40, 2, 500);
      const thick = clamp(+el('wall-t').value || 3, 0.5, 50);
      const inset = clamp(+el('wall-inset').value || 0, 0, 100);
      const tabK = clamp(+el('wall-tabk').value || K_TAB, 0.2, 20);
      const pitchK = clamp(+el('wall-pitchk').value || K_TAB_PITCH, 0.5, 50);
      const cutPitch = clamp(+el('wall-cutpitch').value || 1.5, 0.6, 20);
      const kerf = clamp(+el('wall-kerf').value || 0.4, 0, 5);
      const plainRK = clamp(+el('wall-plainrk').value || 60, 2, 500);
      NS.close('wall');
      try {
        localStorage.setItem(KEY, JSON.stringify({ height, thick, inset, tabK, pitchK, cutPitch, kerf, plainRK }));
      } catch (err) { /* ignore */ }
      if (!api.clipperLib()) {
        toast('Extrude wall needs tools/clipper.js');
        return;
      }

      // Re-editing a generated set rebuilds from the loops stored in its gen;
      // any other selection is baked into loops first.
      const sel = api.selectedEntities();
      const genGroups = sel.filter(e => e.type === 'art' && e.gen && e.gen.kind === 'wall' &&
        e.gen.params && Array.isArray(e.gen.params.src));
      const others = sel.filter(e => !(e.type === 'art' && e.gen && e.gen.kind === 'wall'));
      let loops = [];
      if (others.length) {
        const baked = api.bakeContours(others, {});
        loops = (baked.contours || []).filter(c => c.closed && c.pts && c.pts.length >= 3)
          .map(c => ({ pts: c.pts, closed: true, color: c.color || null }));
      } else if (genGroups.length) {
        for (const g of genGroups) {
          for (const loop of g.gen.params.src) {
            if (Array.isArray(loop) && loop.length >= 3) {
              loops.push({ pts: loop.map(p => ({ x: +p[0], y: +p[1] })), closed: true, color: null });
            }
          }
        }
      }
      if (!loops.length) {
        toast('Select the closed loops of the shape first');
        return;
      }
      loops = api.normalizeWinding(loops.map(c => ({ pts: c.pts.slice(), closed: true, color: c.color })))
        .filter(c => c.closed && c.pts.length >= 3);

      const prm = {
        height, thick, inset, tabK, pitchK, cutPitch, kerf, plainRK,
        tabMinR: Math.max(TAB_MIN_R_MM, 3 * thick)
      };

      const plans = [];
      let tabsN = 0, cutsN = 0, zonesN = 0, tightN = 0, skipped = 0;
      for (const loop of loops) {
        const plan = planFor(api, loop, prm);
        if (!plan) { skipped++; continue; }
        plan.loop = loop;
        plans.push(plan);
        tabsN += plan.tabs.length;
        cutsN += plan.cols.length;
        zonesN += plan.zones || 0;
        tightN += plan.tooTight || 0;
      }
      if (!plans.length) {
        toast('Extrude wall: those loops are too small for a wall');
        return;
      }

      // ---- one object per outermost loop: the loop plus the holes inside it ----
      // A hole's "lid" is the plate that is already there, so only an island
      // gets a lid and a plug; its holes only contribute their walls.
      const objs = [];
      for (const loop of loops) {
        if ((loop.depth || 0) === 0) objs.push({ outer: loop, members: [loop], plans: [] });
      }
      for (const loop of loops) {
        if ((loop.depth || 0) === 0) continue;
        let target = null;
        for (const o of objs) {
          if (!api.pointInPoly(loop.pts[0], o.outer.pts)) continue;
          if (!target || Math.abs(api.signedAreaPts(o.outer.pts)) < Math.abs(api.signedAreaPts(target.outer.pts))) target = o;
        }
        if (target) target.members.push(loop);
      }
      for (const plan of plans) {
        const owner = objs.find(o => o.members.indexOf(plan.loop) >= 0) || objs[0];
        if (owner) owner.plans.push(plan);
      }

      // ---- one part list for the whole sheet ----
      const items = [];
      for (const o of objs) {
        if (!o.plans.length) continue;
        const notches = [];
        for (const plan of o.plans) notches.push(...plan.notches);
        const baseLoops = subtractLoops(api, o.members.map(l => l.pts), notches);
        if (baseLoops.length) items.push({ name: 'Base', list: baseLoops, color: api.ui.color });
        const guide = offsetOne(api, o.outer.pts, guideDelta(o.outer, inset), 'round');
        items.push({ name: 'Lid', list: [o.outer.pts], color: api.ui.color, extra: guide ? [guide] : [] });
        const plug = offsetOne(api, o.outer.pts, plugDelta(o.outer, inset, thick, kerf), 'round');
        if (plug) items.push({ name: 'Lid plug', list: [plug], color: api.ui.color });
      }
      for (const plan of plans) {
        items.push({ name: 'Wall', strip: plan, color: plan.color || api.ui.color });
      }
      for (const it of items) {
        if (it.strip) {
          const local = stripOutline(it.strip.L, height, thick, it.strip.tabs,
            K_FINGER * thick, it.strip.bands);
          it.local = local;
          it.box = bboxOf([local]);
        } else {
          it.box = bboxOf(it.list);
        }
      }

      // ---- shelf layout, centred on the view like every other generator ----
      // Parts flow left to right and wrap once a row is wider than the screen
      // (or than the widest part, which has to fit somewhere). The finished
      // sheet is then shifted so its centre lands on the middle of the current
      // view: a generated set belongs where the user is looking, not parked to
      // the right of whatever happened to be drawn already.
      const worldW = Math.abs(api.s2w(api.getW(), 0).x - api.s2w(0, 0).x);
      const widest = items.reduce((w, it) => Math.max(w, it.box.w), 0);
      const maxW = Math.max(widest, worldW * 0.9);
      let cx = 0, cy = 0, rowH = 0;
      for (const it of items) {
        if (cx > 0 && cx + it.box.w > maxW) {
          cx = 0;
          cy -= rowH + GAP;
          rowH = 0;
        }
        it.at = { dx: cx - it.box.minX, dy: cy - it.box.maxY };
        cx += it.box.w + GAP;
        rowH = Math.max(rowH, it.box.h);
      }
      // centre the whole sheet on the view
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (const it of items) {
        bx0 = Math.min(bx0, it.box.minX + it.at.dx);
        by0 = Math.min(by0, it.box.minY + it.at.dy);
        bx1 = Math.max(bx1, it.box.maxX + it.at.dx);
        by1 = Math.max(by1, it.box.maxY + it.at.dy);
      }
      const viewCentre = api.s2w(api.getW() / 2, api.getH() / 2);
      const offX = viewCentre.x - (bx0 + bx1) / 2;
      const offY = viewCentre.y - (by0 + by1) / 2;
      for (const it of items) {
        it.at.dx += offX;
        it.at.dy += offY;
      }

      api.pushHistory();
      const madeIds = [];
      const emit = (pts, closed, color) => {
        const id = closed ? api.addPanelEntity(pts, color) : api.addPolylineEntity(pts, color);
        if (id) madeIds.push(id);
        return id;
      };
      // A label is a comment entity. It goes into the selection together with
      // the panels, so grouping stores it INSIDE the group: a label left outside
      // would not travel when the group is dragged.
      const label = (text, x, y) => {
        const size = isFinite(+api.settings.noteSize) ? +api.settings.noteSize : 3;
        const w = String(text).length * size * 0.55;
        const id = api.addNote ? api.addNote(text, x - w / 2, y - size / 2) : null;
        if (id) madeIds.push(id);
        return id;
      };
      const shift = (pts, at) => pts.map(p => ({ x: p.x + at.dx, y: p.y + at.dy }));
      const centre = (it, sx, sy) => ({
        x: (it.box.minX + it.box.maxX) / 2 + it.at.dx + (sx || 0),
        y: (it.box.minY + it.box.maxY) / 2 + it.at.dy + (sy || 0)
      });

      for (const it of items) {
        if (it.strip) {
          const plan = it.strip;
          emit(shift(it.local, it.at), true, it.color);
          for (const col of plan.cols) {
            for (const [a, b] of col.cuts) {
              emit([{ x: col.s + it.at.dx, y: a + it.at.dy }, { x: col.s + it.at.dx, y: b + it.at.dy }],
                false, it.color);
            }
          }
          const c = centre(it, plan.L / 2 - it.box.w / 2, 0);
          label('Wall \u00b7 ' + fmt(plan.L) + '\u00d7' + fmt(height) + 'mm', c.x, c.y);
          continue;
        }
        for (const pts of it.list) emit(shift(pts, it.at), true, it.color);
        // the lid's inner guide is an engrave, not a cut
        for (const pts of it.extra || []) emit(shift(pts, it.at), true, '#0000ff');
        const c = centre(it);
        label(it.name + ' \u00b7 ' + fmt(it.box.w) + '\u00d7' + fmt(it.box.h) + 'mm', c.x, c.y);
      }

      if (!madeIds.length) {
        toast('Extrude wall: could not build the parts');
        return;
      }
      api.commit();
      api.ui.selection = madeIds.map(id => ({ kind: 'entity', id }));
      api.cmdGroupSelection({ noHistory: true });
      const wrap = api.ui.selection.length === 1 ? api.state.entities[api.ui.selection[0].id] : null;
      if (wrap && wrap.type === 'art') {
        wrap.gen = {
          kind: 'wall',
          params: {
            height, thick, inset, tabK, pitchK, cutPitch, kerf, plainRK,
            src: loops.map(c => c.pts.map(p => [api.round2(p.x), api.round2(p.y)]))
          }
        };
        wrap.name = 'Extrude wall \u00b7 H' + fmt(height) + ' \u00b7 ' + plans.length +
          ' wall' + (plans.length === 1 ? '' : 's');
        api.commit();
      }
      toast('Extrude wall: ' + plans.length + ' wall' + (plans.length === 1 ? '' : 's') +
        ' + base + lid + plug' +
        ' \u00b7 ' + tabsN + ' finger' + (tabsN === 1 ? '' : 's') + ' ' +
        fmt(api.clamp(tabK * thick, 2, 200)) + ' mm, slot ' +
        fmt(api.clamp(tabK * thick, 2, 200) + kerf) + '\u00d7' + fmt(thick + kerf) + ' mm' +
        ' \u00b7 ' + cutsN + ' hinge cut' + (cutsN === 1 ? '' : 's') +
        ' in ' + zonesN + ' bend' + (zonesN === 1 ? '' : 's') +
        ' \u00b7 H' + fmt(height) + ' mm \u00b7 ' + fmt(thick) + ' mm stock' +
        (tightN ? ' \u00b7 ' + tightN + ' spot' + (tightN === 1 ? '' : 's') + ' butt-joined (bend too tight for a finger)' : '') +
        (skipped ? ' \u00b7 ' + skipped + ' loop' + (skipped === 1 ? '' : 's') + ' skipped' : ''));
    }
  });
})();
