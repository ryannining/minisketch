// Hinge box: six panels for a laser-cut box whose corners fold on a round
// knuckle instead of a finger joint.
//
// Every number here was measured out of the reference file
// `ref/box_hinge_150x125x60mm.svg` (150 x 125 x 60 mm, 3 mm stock) and then
// expressed as a ratio of the stock thickness (or of the height, for the two
// depths that follow it), so the same design scales to other sizes. The probe
// `testing/hinge_probe.js` re-derives the reference case and compares it back
// against that SVG, so "matches the reference" is checked, not claimed.
//
// The six panels:
//
//   Base   L x W, rounded corners, a slot for every wall tab on all four edges
//   Lid    L x (W + t), rounded corners, a scoop along the front edge to lift it
//   Wall   L x H (front and back): 4 tabs on the bottom edge, and near each end
//          an upright slot that the side wall's prong passes through
//   Side   W x H (left and right): 2 tabs, 2 notches open to the bottom edge,
//          and a round knuckle (barrel) at one end that the lid hooks over
//
// Colour is the machining operation, so everything is drawn in the current
// colour and the result is left as one named group.
(() => {
  'use strict';

  const NS = window.MiniSketchTools;
  const KEY = 'minisketch.v1.hingeBox';
  const GAP = 30;                       // mm between panels on the sheet

  // ---- constants, as measured in the reference (3 mm stock) --------------
  // Each is the reference value plus where it comes from, so the intent stays
  // readable and the probe can check the derivation.
  const REF = {
    T: 3, H: 60,
    tabW: 6.15,        // 2.05 t — the finger that drops through a base slot
    tabD: 3,           // 1.00 t — how deep that finger is
    chamfer: 3.275,    // 1.0917 t — 45 deg cut on the plate corners (the
                       //           reference uses straight lines, not arcs)
    endSlotW: 3,       // 1.00 t — the upright slot in a wall
    endSlotD: 28.312,  // 0.47187 h — how far it reaches down from the top edge
    notchW: 2.97,      // 0.99 t — the notch in a side wall
    notchD: 28.688,    // 0.47813 h
    barrelR: 4.8,      // 1.60 t — outer radius of the knuckle
    barrelHoleR: 2.145,// 0.715 t — its pin hole
    lidSlotW: 6.849,   // 2.283 t — the slot at each end of the lid
    lidSlotY: 3.375,   // 1.125 t
    lidSlotH: 3.474,   // 1.158 t
    lidScoopD: 3.474,  // 1.158 t — how deep the finger scoop cuts in
    lidScoopX0: 10.224,// 3.408 t — where the scoop starts along the front edge
    lidScoopRise: 10.8,// 3.60 t — how far the scoop takes to reach full depth
    fbTabCentre: 12.8, // 4.2667 t — first/last tab CENTRE of a front/back wall
                       //           (9.725 is its left edge)
    fbTabPitch: 41.467,// 13.822 t — nominal spacing between those tabs
    sideTabX: 7        // 2.3333 t — where the first side tab starts
  };

  // ---- small helpers -----------------------------------------------------

  function rect(x0, y0, x1, y1) {
    return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  }

  // The reference's plate corners are 45 degree CHAMFERS, not arcs: its path is
  // "M 3.275,0 L 146.725,0 L 150,3.275 ..." — straight lines all the way. An
  // octagon with the given cut, drawn counter-clockwise from the bottom-left.
  function chamferRect(w, h, c) {
    const cc = Math.max(0, Math.min(c, Math.min(w, h) / 2));
    if (!(cc > 1e-9)) return rect(0, 0, w, h);
    return [
      { x: cc, y: 0 }, { x: w - cc, y: 0 },
      { x: w, y: cc }, { x: w, y: h - cc },
      { x: w - cc, y: h }, { x: cc, y: h },
      { x: 0, y: h - cc }, { x: 0, y: cc }
    ];
  }

  // Raised-cosine ease, the profile the reference uses for the lid's finger
  // scoop: y = depth/2 * (1 - cos(pi t)). Checked against its own sample points
  // (t = 1/8 -> 0.038, 1/4 -> 0.146, 3/8 -> 0.309 ...), which it reproduces.
  const ease = (t) => 0.5 * (1 - Math.cos(Math.PI * Math.max(0, Math.min(1, t))));

  // The lid, exactly as the reference draws it: chamfered at the BACK corners,
  // square at the front, with a raised-cosine scoop in the front edge and a
  // notch open to each side edge (the knuckle sits in it). Building the shape
  // this way — rather than cutting a closed rectangle out of a plate — is what
  // makes the notch actually open at the edge.
  function lidOutline(p) {
    const L = p.L, D = p.h, c = p.chamfer;
    const sy = p.slotY, sh = p.slotH, sw = p.slotW;
    const x0 = p.scoop.x0, x1 = p.scoop.x1, rise = p.scoop.rise, dep = p.scoop.depth;
    const n = 8;
    const pts = [{ x: 0, y: 0 }];
    // front edge: scoop up, along the bottom of the scoop, then back down
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      pts.push({ x: x0 + rise * t, y: dep * ease(t) });
    }
    for (let i = n; i >= 0; i--) {
      const t = i / n;
      pts.push({ x: x1 - rise * t, y: dep * ease(t) });
    }
    // right end: square corner, then the notch that the knuckle sits in
    pts.push({ x: L, y: 0 }, { x: L, y: sy },
      { x: L - sw, y: sy }, { x: L - sw, y: sy + sh }, { x: L, y: sy + sh });
    // back edge, chamfered at both corners
    pts.push({ x: L, y: D - c }, { x: L - c, y: D },
      { x: c, y: D }, { x: 0, y: D - c });
    // left end: the matching notch, then down to the front corner
    pts.push({ x: 0, y: sy + sh }, { x: sw, y: sy + sh },
      { x: sw, y: sy }, { x: 0, y: sy });
    return pts;
  }

  function circlePts(cx, cy, r, seg) {
    const n = Math.max(12, seg || 48);
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n;
      out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return out;
  }

  function bbox(ptsList) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pts of ptsList) {
      for (const p of pts || []) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }
    return isFinite(minX) ? { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY } : null;
  }

  // Difference through the exact engine (api.polyBoolOp). A hole comes back
  // wound the other way, so the SIGNED area of the result is the material
  // that is left.
  function subtract(api, subject, clips) {
    if (!clips.length) return [subject];
    return api.polyBoolOp('difference', [subject], clips) || [subject];
  }

  // Union a list of contours, then cut holes out of the result. The side wall
  // needs both: its knuckle is a lobe ON the outline (as in the reference), with
  // the pin hole cut through it. The boolean itself runs on the exact engine
  // (api.polyBoolOp) — Clipper stays only for the offset steps below.
  function combine(api, addList, cutList) {
    let base = addList;
    if (addList.length > 1) {
      // union them into one contour so the shared edge disappears
      base = api.polyBoolOp('union', addList) || addList;
    }
    if (!cutList.length) return base;
    return api.polyBoolOp('difference', base, cutList) || base;
  }

  // ---- the plan ----------------------------------------------------------
  // Pure numbers, no document: the probe runs this on its own.
  //
  // Local frames: every panel has its own bottom-left at (0, 0) and Y up. Tabs
  // hang below y = 0.
  function hingePlan(prm) {
    const T = prm.T, L = prm.L, W = prm.W, H = prm.H;
    const k = T / REF.T;                       // thickness scale

    const tabW = REF.tabW * k;
    const tabD = REF.tabD * k;
    const chamfer = REF.chamfer * k;
    const endSlotW = REF.endSlotW * k;
    const endSlotD = (REF.endSlotD / REF.H) * H;
    const notchW = REF.notchW * k;
    const notchD = (REF.notchD / REF.H) * H;
    const barrelR = REF.barrelR * k;
    const barrelHoleR = REF.barrelHoleR * k;
    const lidDepth = W + T;
    const lidSlotW = REF.lidSlotW * k;
    const lidSlotY = REF.lidSlotY * k;
    const lidSlotH = REF.lidSlotH * k;
    const lidScoopD = REF.lidScoopD * k;
    const lidScoopX0 = REF.lidScoopX0 * k;
    const lidScoopRise = REF.lidScoopRise * k;
    const lidScoopX1 = L - lidScoopX0;
    const fbTabCentre = REF.fbTabCentre * k;
    const fbPitchTarget = REF.fbTabPitch * k;
    const sideTabX = REF.sideTabX * k;
    // The reference measures H as the panel's TOTAL height: the finger tab is
    // part of it, so the visible wall above the plate is H - t. Keep that, or
    // the box comes out one thickness taller than asked for.
    const bodyH = H - tabD;

    // --- front / back wall: L x H, tabs below, an upright slot at each end ---
    const endSlotIn = 2 * T;                   // the slot's inner edge (x = 2t)
    const nFb = Math.max(2, Math.round((L - 2 * fbTabCentre) / fbPitchTarget) + 1);
    const fbSpan = Math.max(tabW, L - 2 * fbTabCentre);
    const fbCentres = [];
    for (let i = 0; i < nFb; i++) {
      fbCentres.push(nFb === 1 ? L / 2 : fbTabCentre + (fbSpan * i) / (nFb - 1));
    }
    const fbTabs = fbCentres.map(c => ({ x0: c - tabW / 2, x1: c + tabW / 2 }));
    const fbEndSlots = [
      { x0: endSlotIn - endSlotW, x1: endSlotIn, y0: bodyH - endSlotD, y1: bodyH },
      { x0: L - endSlotIn, x1: L - endSlotIn + endSlotW, y0: bodyH - endSlotD, y1: bodyH }
    ];
    const wallOutline = (() => {
      const pts = [{ x: 0, y: 0 }];
      for (const tb of fbTabs) {
        pts.push({ x: tb.x0, y: 0 }, { x: tb.x0, y: -tabD },
          { x: tb.x1, y: -tabD }, { x: tb.x1, y: 0 });
      }
      pts.push({ x: L, y: 0 }, { x: L, y: bodyH });
      const right = fbEndSlots[1];
      pts.push({ x: right.x1, y: bodyH }, { x: right.x1, y: right.y0 },
        { x: right.x0, y: right.y0 }, { x: right.x0, y: bodyH });
      const left = fbEndSlots[0];
      pts.push({ x: left.x1, y: bodyH }, { x: left.x1, y: left.y0 },
        { x: left.x0, y: left.y0 }, { x: left.x0, y: bodyH });
      pts.push({ x: 0, y: bodyH });
      return pts;
    })();

    // --- side wall: W x H, 2 tabs, 2 notches open to the bottom --------------
    const sideTabs = [
      { x0: sideTabX, x1: sideTabX + tabW },
      { x0: W - sideTabX - tabW, x1: W - sideTabX }
    ];
    const sideNotches = [
      { x0: sideTabX - notchW, x1: sideTabX, y0: 0, y1: notchD },
      { x0: W - sideTabX, x1: W - sideTabX + notchW, y0: 0, y1: notchD }
    ];
    const sideOutline = (() => {
      const pts = [{ x: 0, y: 0 }];
      pts.push({ x: sideNotches[0].x0, y: 0 },
        { x: sideNotches[0].x0, y: sideNotches[0].y1 },
        { x: sideNotches[0].x1, y: sideNotches[0].y1 },
        { x: sideNotches[0].x1, y: 0 });
      for (const tb of sideTabs) {
        pts.push({ x: tb.x0, y: 0 }, { x: tb.x0, y: -tabD },
          { x: tb.x1, y: -tabD }, { x: tb.x1, y: 0 });
      }
      pts.push({ x: sideNotches[1].x0, y: 0 },
        { x: sideNotches[1].x0, y: sideNotches[1].y1 },
        { x: sideNotches[1].x1, y: sideNotches[1].y1 },
        { x: sideNotches[1].x1, y: 0 },
        { x: W, y: 0 }, { x: W, y: bodyH },
        // ... and back along the top edge. Without this the closing segment runs
        // straight from (W, bodyH) to (0, 0), which drew a diagonal across the
        // panel instead of a rectangle.
        { x: 0, y: bodyH });
      return pts;
    })();
    // the knuckle hangs off the LEFT end of the top edge, as a lobe ON the
    // outline; the right-hand wall is the mirror, so each one ends up with its
    // knuckle on an outer corner
    const barrel = { x: 0, y: bodyH + tabD, r: barrelR, hole: barrelHoleR };
    const barrelOuter = circlePts(barrel.x, barrel.y, barrel.r, 48);
    const barrelHole = circlePts(barrel.x, barrel.y, barrel.hole, 32);

    // --- slots in the base, one per wall tab --------------------------------
    const slots = [];
    for (const tb of fbTabs) {
      const c = (tb.x0 + tb.x1) / 2;
      slots.push(rect(c - tabW / 2, T, c + tabW / 2, 2 * T));
      slots.push(rect(c - tabW / 2, W - 2 * T, c + tabW / 2, W - T));
    }
    for (const tb of sideTabs) {
      const c = (tb.x0 + tb.x1) / 2;
      slots.push(rect(T, c - tabW / 2, 2 * T, c + tabW / 2));
      slots.push(rect(L - 2 * T, c - tabW / 2, L - T, c + tabW / 2));
    }

    return {
      prm: {
        T, L, W, H, bodyH, tabW, tabD, chamfer, endSlotW, endSlotD, notchW, notchD,
        barrelR, barrelHoleR, lidDepth, lidSlotW, lidSlotY, lidSlotH,
        lidScoopD, lidScoopX0, lidScoopX1, lidScoopRise, fbTabCentre, sideTabX, nFb
      },
      base: { w: L, h: W, outline: chamferRect(L, W, chamfer), slots },
      wall: { w: L, h: H, tabs: fbTabs, endSlots: fbEndSlots, outline: wallOutline },
      side: {
        w: W, h: H, tabs: sideTabs, notches: sideNotches, barrel,
        outline: sideOutline, barrelOuter, barrelHole
      },
      lid: {
        w: L, h: lidDepth,
        // the lid's notches and scoop are part of its outline, not cuts in a
        // plate: that is how the reference draws it, and it keeps the notch
        // open at the side edge
        outline: lidOutline({
          L, h: lidDepth, chamfer, slotY: lidSlotY, slotH: lidSlotH, slotW: lidSlotW,
          scoop: { x0: lidScoopX0, x1: lidScoopX1, rise: lidScoopRise, depth: lidScoopD }
        }),
        scoop: { x0: lidScoopX0, x1: lidScoopX1, rise: lidScoopRise, depth: lidScoopD }
      }
    };
  }

  // ---- dialog -------------------------------------------------------------

  function read(params) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (err) { saved = {}; }
    const p = params || {};
    const num = (k, def, lo) => {
      const raw = p[k] != null && p[k] !== '' ? +p[k] : +saved[k];
      return isFinite(raw) && raw >= (lo == null ? 0 : lo) ? raw : def;
    };
    return { L: num('L', 150, 20), W: num('W', 125, 20), H: num('H', 60, 10), T: num('T', 3, 0.5) };
  }

  NS.register({
    id: 'hinge',
    label: 'Hinge box',
    title: 'Hinge box: six panels with round knuckle corners — walls carry finger-joint tabs into the base and lid, the side walls hook round a barrel instead of being finger jointed. Double click the result to edit its parameters',
    modalId: 'hinge-modal',
    modal: `
<div id="hinge-modal" class="modal hidden">
  <div class="modal-box wide-cols">
    <h3>Hinge box &middot; knuckle corners</h3>
    <div class="modal-cols">
    <div class="opt-col">
      <label class="opt">Length (mm) <input type="number" id="hg-l" value="150" step="1" min="20"></label>
      <label class="opt">Width (mm) <input type="number" id="hg-w" value="125" step="1" min="20"></label>
      <label class="opt">Height (mm) <input type="number" id="hg-h" value="60" step="1" min="10"></label>
      <label class="opt">Material thickness (mm) <input type="number" id="hg-t" value="3" step="0.1" min="0.5"></label>
    </div>
    <div class="cnc-status">Six panels: <b>Base</b> and <b>Lid</b> take the wall tabs; the two <b>side</b> walls hook round the knuckles. Every size follows the stock thickness. Double click the result to edit.</div>
    </div>
    <div class="modal-actions">
      <button class="btn" id="hg-cancel">Cancel</button>
      <button class="btn primary" id="hg-ok">Create</button>
    </div>
  </div>
</div>`,

    open(api, params) {
      const s = read(params);
      const el = (id) => document.getElementById(id);
      el('hg-l').value = s.L;
      el('hg-w').value = s.W;
      el('hg-h').value = s.H;
      el('hg-t').value = s.T;
      const ok = el('hg-ok');
      if (ok) ok.focus();
    },

    apply(api) {
      const el = (id) => document.getElementById(id);
      const clamp = api.clamp, fmt = api.fmt, toast = api.toast;
      const L = clamp(+el('hg-l').value || 150, 20, 2000);
      const W = clamp(+el('hg-w').value || 125, 20, 2000);
      const H = clamp(+el('hg-h').value || 60, 10, 500);
      const T = clamp(+el('hg-t').value || 3, 0.5, 20);
      NS.close('hinge');
      try { localStorage.setItem(KEY, JSON.stringify({ L, W, H, T })); } catch (err) { /* ignore */ }
      if (!api.clipperLib()) {
        toast('Hinge box needs tools/clipper.js');
        return;
      }

      const plan = hingePlan({ L, W, H, T });

      // ---- panels: what goes on the sheet ----
      //
      // Each panel is placed with the transform the reference file uses for it,
      // so the sheet looks the same as `ref/box_hinge_150x125x60mm.svg`:
      //   base / back   upright, tab tips up
      //   lid / front   turned over (their local Y is mirrored)
      //   side walls    rotated a quarter turn, knuckle on the outer corner
      // The four column panels share one column; the side walls stand either
      // side of the base with their tops level with it. Every gap is GAP_SHEET.
      const GAP_SHEET = 14;                    // mm, measured off the reference
      const items = [];
      const pushPanel = (name, list, key, mode) => {
        const it = { name, list, key, mode };
        it.box = bbox(list);
        items.push(it);
      };

      // base: the plate with every tab slot cut out
      pushPanel('Base', subtract(api, plan.base.outline, plan.base.slots), 'base', 'normal');
      // lid: its notches and scoop are already part of the outline
      pushPanel('Lid', [plan.lid.outline], 'lid', 'flipY');
      // front / back wall — the same part, one of them turned over as in the file
      pushPanel('Back', [plan.wall.outline], 'back', 'normal');
      pushPanel('Front', [plan.wall.outline.map(p => ({ x: p.x, y: p.y }))], 'front', 'flipY');
      // side walls: body + knuckle lobe as one outline, with the pin hole cut
      // through it. The pair is mirrored, so each knuckle lands on an outer end.
      const mirrorPts = (pts) => pts.map(p => ({ x: W - p.x, y: p.y }));
      const sideL = combine(api,
        [plan.side.outline, plan.side.barrelOuter], [plan.side.barrelHole]);
      const sideR = combine(api,
        [mirrorPts(plan.side.outline), mirrorPts(plan.side.barrelOuter)],
        [mirrorPts(plan.side.barrelHole)]);
      pushPanel('Left side', sideL.length ? sideL : [plan.side.outline], 'left', 'rot90');
      pushPanel('Right side', sideR.length ? sideR : [plan.side.outline], 'right', 'rot90flip');

      // ---- arrange: one column, side walls flanking the base ----
      // Modes above are the reference's own orientation, expressed for a y-up
      // world: normal / flipY keep the panel upright or turned over; rot90 and
      // rot90flip turn it a quarter turn (the mirror is what makes the pair).
      const place = (it) => {
        const out = [];
        for (const pts of it.list) {
          out.push(pts.map(p => {
            if (it.mode === 'flipY') return { x: p.x, y: -p.y };
            if (it.mode === 'rot90') return { x: -p.y, y: p.x };
            if (it.mode === 'rot90flip') return { x: p.y, y: p.x };
            return { x: p.x, y: p.y };
          }));
        }
        it.placed = out;
        it.box = bbox(out);
        return it;
      };
      items.forEach(place);

      const column = ['lid', 'back', 'base', 'front'];
      let yTop = 0;                            // world Y of the next panel's top
      for (const key of column) {
        const it = items.find(x => x.key === key);
        if (!it) continue;
        it.at = { dx: -it.box.minX, dy: yTop - it.box.maxY };
        yTop -= it.box.h + GAP_SHEET;
      }
      const colBase = items.find(x => x.key === 'base');
      const colW = colBase ? colBase.box.w : L;
      const baseTop = colBase ? colBase.box.maxY + colBase.at.dy : 0;
      for (const key of ['left', 'right']) {
        const it = items.find(x => x.key === key);
        if (!it) continue;
        // tops level with the base, one gap clear of the column
        const dx = key === 'left'
          ? -(GAP_SHEET) - it.box.maxX
          : colW + GAP_SHEET - it.box.minX;
        it.at = { dx, dy: baseTop - it.box.maxY };
      }

      // centre the whole sheet on the view
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (const it of items) {
        if (!it.at) continue;
        bx0 = Math.min(bx0, it.box.minX + it.at.dx);
        by0 = Math.min(by0, it.box.minY + it.at.dy);
        bx1 = Math.max(bx1, it.box.maxX + it.at.dx);
        by1 = Math.max(by1, it.box.maxY + it.at.dy);
      }
      const viewCentre = api.s2w(api.getW() / 2, api.getH() / 2);
      const offX = viewCentre.x - (bx0 + bx1) / 2;
      const offY = viewCentre.y - (by0 + by1) / 2;
      for (const it of items) {
        if (!it.at) continue;
        it.at.dx += offX;
        it.at.dy += offY;
      }

      api.pushHistory();
      const madeIds = [];
      const add = (pts) => {
        const id = api.addPanelEntity(pts, api.ui.color);
        if (id) madeIds.push(id);
        return id;
      };
      const shift = (pts, at) => pts.map(p => ({ x: p.x + at.dx, y: p.y + at.dy }));
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

      for (const it of items) {
        for (const pts of it.placed) add(shift(pts, it.at));
        const b = it.box;
        // the label reads the panel's own size, not its rotated footprint
        const own = bbox(it.list);
        label(it.name + ' \u00b7 ' + fmt(own.w) + '\u00d7' + fmt(own.h) + 'mm',
          (b.minX + b.maxX) / 2 + it.at.dx, (b.minY + b.maxY) / 2 + it.at.dy);
      }

      if (!madeIds.length) {
        toast('Hinge box: could not build the panels');
        return;
      }
      api.commit();
      api.ui.selection = madeIds.map(id => ({ kind: 'entity', id }));
      api.cmdGroupSelection({ noHistory: true });
      const wrap = api.ui.selection.length === 1 ? api.state.entities[api.ui.selection[0].id] : null;
      if (wrap && wrap.type === 'art') {
        wrap.gen = { kind: 'hinge', params: { L, W, H, T } };
        wrap.name = 'Hinge box ' + fmt(L) + '\u00d7' + fmt(W) + '\u00d7' + fmt(H);
        api.commit();
      }
      toast('Hinge box: 6 panels \u00b7 ' + fmt(L) + '\u00d7' + fmt(W) + '\u00d7' + fmt(H) +
        ' mm \u00b7 ' + fmt(T) + ' mm stock \u00b7 tab ' + fmt(plan.prm.tabW) +
        ' mm \u00b7 knuckle R' + fmt(plan.prm.barrelR) + ' mm');
    }
  });
})();
