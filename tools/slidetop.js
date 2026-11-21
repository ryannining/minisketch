// Slide top: six panels for a laser-cut box whose lid slides in a groove.
//
// Every number here was measured out of the reference file
// `ref/slidetop_100x100x120mm.svg` (100 x 100 x 120 mm, 3 mm stock). The panel
// divisions follow the panel size; the cross-section details (rail band, lid
// tongue, bow) scale with the stock thickness. The probe
// `testing/slidetop_probe.js` re-derives the reference case and compares every
// panel back against that SVG, so "matches the reference" is checked.
//
// The panels:
//
//   Base    W x D, a slot for every wall tab on all four edges
//   Front   W x H, tabs on the bottom edge, a slot in each upright edge
//   Back    W x (H - tongue - step): the same wall, lower so the lid can be
//           slid in over it
//   Side    D wide (body D - 2t, the tabs reach the full D), tabs on the bottom
//           edge and in both uprights, and a red glue mark near the top
//   Slide   (D - 2t - clearance) x (D - t): a bowed leading edge, and a tongue
//           along the top edge that runs in the groove
//   Rail    two stepped strips (D - 2t long) glued inside the side walls on the
//           red mark; the step is the groove the lid's tongue runs in
//
// Colour is the machining operation, so the panel outlines are drawn in the
// current colour (cut) and the glue marks in red: KaryaCNC reads RBcolor
// "ff00" as the marking operation. The result is one named group.
(() => {
  'use strict';

  const NS = window.MiniSketchTools;
  const KEY = 'minisketch.v1.slideTop';

  // KaryaCNC: stroke #ff....00 is a marking pass, not a cut.
  const MARK = '#ff0000';

  // The reference profile, measured at 3 mm stock. Everything here is a
  // cross-section detail, so it follows the stock thickness rather than the
  // panel size.
  const REF = {
    T: 3,
    railH: 10.2,      // 3.40 t — the rail strip, and the band it is glued in
    tongueH: 3.55,    // 1.183 t — the lid tongue, and the rail's top flange
    stepH: 3.1,       // 1.033 t — the rail's middle band (the groove floor)
    bow: 5,           // 1.667 t — how far the lid's leading edge bows out
    lidInset: 3.2,    // 1.067 t — the tongue starts this far in from each end
    lidClear: 0.6,    // 0.200 t — lid width under the box's clear width
    lidSegments: 16   //           the reference samples the bow 16 times
  };

  // Sheet layout, also measured off the reference: panel body to the base, and
  // the left column (lid plus two rails) hanging off the side walls.
  const GAP = 17;         // base edge -> neighbouring wall's body
  const COL_GAP = 14;     // base column -> side walls -> lid column
  const RAIL_GAP = 19;    // lid -> first rail
  const RAIL_PITCH = 14;  // rail -> rail

  // ---- edge patterns -----------------------------------------------------
  //
  // Both edges are divided into equal parts and the tabs take whole parts:
  //   across  W or D is cut into 7 parts and a tab sits in parts 1, 3, 5
  //   up      the height below the rail band is cut into 23 parts and a
  //           3-part tab sits at 4, 10 and 16
  // That is exactly how the reference lays them out (14.286 mm across on a
  // 100 mm edge; 19.096 / 14.322 mm up on a 109.8 mm edge).
  function div(len, parts, starts, width) {
    return starts.map(k => [k * len / parts, (k + width) * len / parts]);
  }
  const across = (len) => div(len, 7, [1, 3, 5], 1);
  const up = (len) => div(len, 23, [4, 10, 16], 3);

  function bbox(list) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pts of list) {
      for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  }

  // ---- panel outlines ----------------------------------------------------
  //
  // Every outline is walked once, counter-clockwise from the bottom-left, so
  // the shape comes out as a single closed contour with the tabs standing out
  // and the slots cut in. Building them this way (rather than subtracting
  // rectangles from a plate) keeps the slots open to the edge, which is how the
  // reference draws them and how the parts actually assemble.

  // A plate with a slot in every edge, one per wall tab.
  function baseOutline(W, D, T) {
    const pts = [{ x: 0, y: 0 }];
    for (const [a, b] of across(W)) pts.push({ x: a, y: 0 }, { x: a, y: T }, { x: b, y: T }, { x: b, y: 0 });
    pts.push({ x: W, y: 0 });
    for (const [a, b] of across(D)) pts.push({ x: W, y: a }, { x: W - T, y: a }, { x: W - T, y: b }, { x: W, y: b });
    pts.push({ x: W, y: D });
    for (const [a, b] of across(W).reverse()) pts.push({ x: b, y: D }, { x: b, y: D - T }, { x: a, y: D - T }, { x: a, y: D });
    pts.push({ x: 0, y: D });
    for (const [a, b] of across(D).reverse()) pts.push({ x: 0, y: b }, { x: T, y: b }, { x: T, y: a }, { x: 0, y: a });
    return pts;
  }

  // A wall: tabs along the bottom edge (they drop into the base), and a slot in
  // each upright edge. `upSlots` comes from the FULL box height, so the front
  // and the shorter back wall line up.
  function wallOutline(W, h, T, upSlots) {
    const pts = [{ x: 0, y: 0 }];
    for (const [a, b] of across(W)) pts.push({ x: a, y: 0 }, { x: a, y: -T }, { x: b, y: -T }, { x: b, y: 0 });
    pts.push({ x: W, y: 0 });
    for (const [a, b] of upSlots) pts.push({ x: W, y: a }, { x: W - T, y: a }, { x: W - T, y: b }, { x: W, y: b });
    pts.push({ x: W, y: h }, { x: 0, y: h });
    for (const [a, b] of upSlots.slice().reverse()) {
      pts.push({ x: 0, y: b }, { x: T, y: b }, { x: T, y: a }, { x: 0, y: a });
    }
    return pts;
  }

  // A side wall: the body is two stock thicknesses narrower than the box, and
  // its upright tabs reach out to the full D, where the front/back slots take
  // them.
  function sideOutline(D, H, T, upTabs) {
    const pts = [{ x: T, y: 0 }];
    for (const [a, b] of across(D)) pts.push({ x: a, y: 0 }, { x: a, y: -T }, { x: b, y: -T }, { x: b, y: 0 });
    pts.push({ x: D - T, y: 0 });
    for (const [a, b] of upTabs) pts.push({ x: D - T, y: a }, { x: D, y: a }, { x: D, y: b }, { x: D - T, y: b });
    pts.push({ x: D - T, y: H }, { x: T, y: H });
    for (const [a, b] of upTabs.slice().reverse()) {
      pts.push({ x: T, y: b }, { x: 0, y: b }, { x: 0, y: a }, { x: T, y: a });
    }
    return pts;
  }

  // The glue mark: the rail's footprint on the inside of a side wall. It is the
  // same stepped band as the rail itself, offset one step.
  function markOutline(D, H, T, railH, tongueH, stepH) {
    return [
      { x: 2 * T, y: H - railH },
      { x: D - T, y: H - railH },
      { x: D - T, y: H },
      { x: T, y: H },
      { x: T, y: H - tongueH },
      { x: D - 2 * T, y: H - tongueH },
      { x: D - 2 * T, y: H - tongueH - stepH },
      { x: 2 * T, y: H - tongueH - stepH }
    ];
  }

  // The sliding lid. Its leading edge is a sine bow (the reference's own sample
  // points: depth * sin(pi x / length), sampled 16 times), and the tongue along
  // the top edge runs in the rail groove.
  function lidOutline(A, B, tongueH, inset, bow, n) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      pts.push({ x: A * i / n, y: -bow * Math.sin(Math.PI * i / n) });
    }
    pts.push(
      { x: A, y: B - tongueH }, { x: A - inset, y: B - tongueH },
      { x: A - inset, y: B }, { x: inset, y: B },
      { x: inset, y: B - tongueH }, { x: 0, y: B - tongueH }
    );
    return pts;
  }

  // The rail: a strip whose two flanges are offset by one stock thickness, so
  // glued against the wall it leaves a groove of `tongueH` for the lid.
  function railOutline(RW, railH, tongueH, stepH, T) {
    return [
      { x: T, y: 0 }, { x: RW, y: 0 }, { x: RW, y: railH }, { x: 0, y: railH },
      { x: 0, y: tongueH + stepH }, { x: RW - T, y: tongueH + stepH },
      { x: RW - T, y: tongueH }, { x: T, y: tongueH }
    ];
  }

  function slidePlan(p) {
    const W = p.W, D = p.D, H = p.H, T = p.T;
    const s = T / REF.T;
    const railH = REF.railH * s;
    const tongueH = REF.tongueH * s;
    const stepH = REF.stepH * s;
    const bow = REF.bow * s;
    const lidInset = REF.lidInset * s;
    const lidClear = REF.lidClear * s;

    const upSlots = up(H - railH);          // shared by every upright edge
    const backH = H - (tongueH + stepH);    // the lid slides in over this wall
    const sideW = D - 2 * T;
    const lidW = sideW - lidClear;
    const lidH = D - T;

    return {
      prm: {
        W, D, H, T, railH, tongueH, stepH, bow, lidInset, lidClear,
        backH, sideW, lidW, lidH, upSlots, acrossW: across(W), acrossD: across(D)
      },
      base: { outline: baseOutline(W, D, T), w: W, h: D },
      front: { outline: wallOutline(W, H, T, upSlots), w: W, h: H },
      back: { outline: wallOutline(W, backH, T, upSlots), w: W, h: backH },
      side: {
        outline: sideOutline(D, H, T, upSlots),
        marking: markOutline(D, H, T, railH, tongueH, stepH),
        w: D, h: H
      },
      lid: {
        outline: lidOutline(lidW, lidH, tongueH, lidInset, bow, REF.lidSegments),
        w: lidW, h: lidH
      },
      rail: { outline: railOutline(sideW, railH, tongueH, stepH, T), w: sideW, h: railH }
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
    return { W: num('W', 100, 40), D: num('D', 100, 40), H: num('H', 120, 30), T: num('T', 3, 0.5) };
  }

  NS.register({
    id: 'slidetop',
    label: 'Slide top',
    title: 'Slide top: base, four walls and a sliding lid with two rails — the lid runs in a groove the rails make against the side walls, and the red line marks where they are glued. Double click the result to edit its parameters',
    modalId: 'slidetop-modal',
    guide: {
      en: {
        main: '<b>Base</b>, four walls, the sliding <b>lid</b> (bowed edge + tongue) and two <b>rails</b>; red lines mark where the rails glue. Double click the result to edit.'
      },
      id: {
        main: '<b>Base</b>, empat dinding, <b>lid</b> yang diselipkan (tepi melengkung + lidah) dan dua <b>rail</b>; garis merah menandai tempat rail dilem. Dobel-klik hasil untuk mengubah.'
      }
    },
    modal: `
<div id="slidetop-modal" class="modal hidden">
  <div class="modal-box wide-cols">
    <h3>Slide top &middot; sliding lid</h3>
    <div class="modal-cols">
    <div class="opt-col">
      <label class="opt">Width (mm) <input type="number" id="st-w" value="100" step="1" min="40"></label>
      <label class="opt">Depth (mm) <input type="number" id="st-d" value="100" step="1" min="40"></label>
      <label class="opt">Height (mm) <input type="number" id="st-h" value="120" step="1" min="30"></label>
      <label class="opt">Material thickness (mm) <input type="number" id="st-t" value="3" step="0.1" min="0.5"></label>
    </div>
    <div class="cnc-status" data-guide="main"></div>
    </div>
    <div class="modal-actions">
      <button class="btn" id="st-cancel">Cancel</button>
      <button class="btn primary" id="st-ok">Create</button>
    </div>
  </div>
</div>`,

    open(api, params) {
      const s = read(params);
      const el = (id) => document.getElementById(id);
      el('st-w').value = s.W;
      el('st-d').value = s.D;
      el('st-h').value = s.H;
      el('st-t').value = s.T;
      const ok = el('st-ok');
      if (ok) ok.focus();
    },

    apply(api) {
      const el = (id) => document.getElementById(id);
      const clamp = api.clamp, fmt = api.fmt, toast = api.toast;
      const W = clamp(+el('st-w').value || 100, 40, 2000);
      const D = clamp(+el('st-d').value || 100, 40, 2000);
      const H = clamp(+el('st-h').value || 120, 30, 500);
      const Traw = clamp(+el('st-t').value || 3, 0.5, 20);
      // The rail band is a cross-section detail; it may take at most a third of
      // the height, otherwise the upright slots would close on themselves.
      const T = Math.min(Traw, H / 10.2);
      NS.close('slidetop');
      try { localStorage.setItem(KEY, JSON.stringify({ W, D, H, T })); } catch (err) { /* ignore */ }

      const plan = slidePlan({ W, D, H, T });
      const prm = plan.prm;

      // ---- panels on the sheet ----
      //
      // The reference file nests them with every wall's tab edge turned toward
      // the base, and the lid column hanging off the left. `mode` is that
      // orientation in a y-up world: normal / flipY / rot90 / rot90flip.
      const items = [];
      const push = (name, list, mode, dx, dy, markAt, size) => {
        const it = { name, list, mode, dx, dy, markAt: markAt || [], size };
        items.push(it);
      };
      // `size` is the panel's own width and height; the tabs stand outside it
      push('Base', [plan.base.outline], 'normal', 0, 0, [], [plan.base.w, plan.base.h]);
      push('Front', [plan.front.outline], 'normal', 0, D + GAP, [], [plan.front.w, plan.front.h]);
      push('Back', [plan.back.outline], 'flipY', 0, -GAP, [], [plan.back.w, plan.back.h]);
      push('Left side', [plan.side.outline, plan.side.marking], 'rot90', -GAP, 0, [1],
        [plan.side.w, plan.side.h]);
      push('Right side', [plan.side.outline, plan.side.marking], 'rot90flip', W + GAP, 0, [1],
        [plan.side.w, plan.side.h]);

      // The lid column: right edge one gap left of the left side wall, top level
      // with the front/back walls' gap. The rails are left-aligned with the lid,
      // as in the reference (they are a little longer than it).
      const lidX = -GAP - H - COL_GAP - prm.lidW;
      push('Slide', [plan.lid.outline], 'flipY', lidX, D + GAP - prm.bow, [], [plan.lid.w, plan.lid.h]);
      const lidBottom = D + GAP - prm.bow - prm.lidH;
      const railSize = [plan.rail.w, plan.rail.h];
      push('Rail', [plan.rail.outline], 'flipY', lidX, lidBottom - RAIL_GAP, [], railSize);
      push('Rail', [plan.rail.outline], 'flipY', lidX,
        lidBottom - RAIL_GAP - prm.railH - RAIL_PITCH, [], railSize);

      const place = (it) => {
        const map = (p) => {
          if (it.mode === 'flipY') return { x: p.x, y: -p.y };
          if (it.mode === 'rot90') return { x: -p.y, y: p.x };
          if (it.mode === 'rot90flip') return { x: p.y, y: p.x };
          return { x: p.x, y: p.y };
        };
        it.placed = it.list.map(pts => pts.map(p => {
          const q = map(p);
          return { x: q.x + it.dx, y: q.y + it.dy };
        }));
        it.box = bbox(it.placed);
      };
      items.forEach(place);

      // centre the whole sheet on the view
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (const it of items) {
        bx0 = Math.min(bx0, it.box.minX);
        by0 = Math.min(by0, it.box.minY);
        bx1 = Math.max(bx1, it.box.maxX);
        by1 = Math.max(by1, it.box.maxY);
      }
      const view = api.s2w(api.getW() / 2, api.getH() / 2);
      const offX = view.x - (bx0 + bx1) / 2;
      const offY = view.y - (by0 + by1) / 2;
      for (const it of items) {
        it.placed = it.placed.map(pts => pts.map(p => ({ x: p.x + offX, y: p.y + offY })));
        it.box = bbox(it.placed);
      }

      api.pushHistory();
      const madeIds = [];
      const add = (pts, color) => {
        const id = api.addPanelEntity(pts, color);
        if (id) madeIds.push(id);
        return id;
      };
      // A label is a comment entity and goes into the selection with the
      // panels, so grouping keeps it inside the group.
      const label = (text, x, y) => {
        const size = isFinite(+api.settings.noteSize) ? +api.settings.noteSize : 3;
        const w = String(text).length * size * 0.55;
        const id = api.addNote ? api.addNote(text, x - w / 2, y - size / 2) : null;
        if (id) madeIds.push(id);
        return id;
      };

      let marks = 0;
      for (const it of items) {
        it.placed.forEach((pts, i) => {
          const isMark = it.markAt.indexOf(i) >= 0;
          if (isMark) marks++;
          add(pts, isMark ? MARK : api.ui.color);
        });
        label(it.name + ' \u00b7 ' + fmt(it.size[0]) + '\u00d7' + fmt(it.size[1]) + 'mm',
          (it.box.minX + it.box.maxX) / 2, (it.box.minY + it.box.maxY) / 2);
      }

      if (!madeIds.length) {
        toast('Slide top: could not build the panels');
        return;
      }
      api.commit();
      api.ui.selection = madeIds.map(id => ({ kind: 'entity', id }));
      api.cmdGroupSelection({ noHistory: true });
      const wrap = api.ui.selection.length === 1 ? api.state.entities[api.ui.selection[0].id] : null;
      if (wrap && wrap.type === 'art') {
        wrap.gen = { kind: 'slidetop', params: { W, D, H, T } };
        wrap.name = 'Slide top ' + fmt(W) + '\u00d7' + fmt(D) + '\u00d7' + fmt(H);
        api.commit();
      }
      toast('Slide top: 8 panels \u00b7 ' + fmt(W) + '\u00d7' + fmt(D) + '\u00d7' + fmt(H) +
        ' mm \u00b7 ' + fmt(T) + ' mm stock \u00b7 lid ' + fmt(prm.lidW) + '\u00d7' + fmt(prm.lidH) +
        ' mm \u00b7 groove ' + fmt(prm.tongueH) + ' mm \u00b7 ' + marks + ' glue marks' +
        (T < Traw - 1e-9 ? ' \u00b7 stock pulled back to ' + fmt(T) + ' mm for this height' : ''));
    }
  });
})();
