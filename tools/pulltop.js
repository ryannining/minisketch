// Pull top duo: eleven panels for a laser-cut box that is closed by two
// sliding panels you pull apart.
//
// Every number was measured out of `ref/pulltopduo_150x100x50mm.svg`
// (150 x 100 x 50 mm, 3 mm stock) and is kept here as a ratio of the stock
// thickness, because all of it is cross-section detail. The panel sizes
// themselves follow W / D / H.
//
// The panels:
//
//   Base    W x D, a slot in every edge for the wall tabs
//   Wall    W x H, tabs along the bottom edge, a slot in each upright edge
//           (two of these)
//   Side    (D - 2t) x H, tabs along the bottom edge and out of both uprights,
//           a pin hole near each top corner, and a glue mark for the clip
//           (two of these, mirror images)
//   Pull    (W - 2t) x (H - 1.2t): the sliding top, with a small tab out of
//           each upright edge near its top, and a glue mark for the handle
//           (two of these)
//   Clip    a small block glued to the side wall, whose top edge is the shelf
//           the pull's tab rests on (two of these)
//   Handle  a finger pull glued to the pull (two of these)
//
// Colour is the machining operation, so the panel outlines are drawn in the
// current colour (cut) and the glue marks in red, which KaryaCNC reads as a
// marking pass. Green is construction geometry in this app and would be
// dropped from the group, so it is not used here.
(() => {
  'use strict';

  const NS = window.MiniSketchTools;
  const KEY = 'minisketch.v1.pullTopDuo';

  // KaryaCNC: a red stroke is a marking pass, not a cut.
  const MARK = '#ff0000';

  // Measured off the reference at 3 mm stock. All of it is cross-section
  // detail, so it scales with the stock thickness rather than the box.
  const REF = {
    pullClear: 1.2,      // pull height  = H - 1.2 t   (3.6 mm at 3 mm stock)
    pullTabTop: 1.0403,  // the pull's side tab starts this far below its top
    clipW: 4.0,          // 12 mm
    clipH: 2.6667,       //  8 mm
    clipTop: 2.207,      // the clip's top edge, this far below H (6.621 mm)
    handleW: 13.3333,    // 40 mm
    handleH: 3.3333,     // 10 mm
    handleR: 0.8333,     //  2.5 mm
    markY: 1.6667,       // the handle's glue mark, this far above the pull base
    holeR: 0.7071,       //  2.121 mm
    holeIn: 1.7071,      // the pin hole's centre, this far in from the body edge
    holeSegs: 48         // the reference samples the pin holes 48 times
  };

  // Sheet layout, also measured off the reference: every neighbouring panel is
  // one gap apart, and the pull column starts above the base's top edge.
  const GAP = 14;
  const COL_TOP = 17;
  const ARC = 6;      // the handle's rounded ends are sampled in 6 steps

  // ---- edge patterns -----------------------------------------------------
  //
  // Both edges are divided into equal parts and the tabs take whole parts:
  //   across  W or D is cut into 7 parts and a tab sits in parts 1, 3, 5
  //   up      the height is cut into 23 parts and a 3-part tab sits at 4, 10, 16
  // That is exactly how the reference lays them out (21.429 mm across a 150 mm
  // edge, 8.696 mm up a 50 mm edge).
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
  // Every outline is walked once, so the shape comes out as a single closed
  // contour with the tabs standing out and the slots cut in. Building them this
  // way (rather than subtracting rectangles) keeps the slots open to the edge,
  // which is how the reference draws them and how the parts assemble.

  // A plate with a slot in every edge, one per wall tab.
  function baseOutline(W, D, T) {
    const pts = [{ x: 0, y: 0 }];
    for (const [a, b] of across(W)) pts.push({ x: a, y: 0 }, { x: a, y: T }, { x: b, y: T }, { x: b, y: 0 });
    pts.push({ x: W, y: 0 });
    for (const [a, b] of across(D)) pts.push({ x: W, y: a }, { x: W - T, y: a }, { x: W - T, y: b }, { x: W, y: b });
    pts.push({ x: W, y: D });
    for (const [a, b] of across(W).slice().reverse()) {
      pts.push({ x: b, y: D }, { x: b, y: D - T }, { x: a, y: D - T }, { x: a, y: D });
    }
    pts.push({ x: 0, y: D });
    for (const [a, b] of across(D).slice().reverse()) {
      pts.push({ x: 0, y: b }, { x: T, y: b }, { x: T, y: a }, { x: 0, y: a });
    }
    return pts;
  }

  // A wall: tabs along the bottom edge (they drop into the base) and a slot in
  // each upright edge.
  function wallOutline(W, H, T, upSlots) {
    const pts = [{ x: 0, y: 0 }];
    for (const [a, b] of across(W)) pts.push({ x: a, y: 0 }, { x: a, y: -T }, { x: b, y: -T }, { x: b, y: 0 });
    pts.push({ x: W, y: 0 });
    for (const [a, b] of upSlots) pts.push({ x: W, y: a }, { x: W - T, y: a }, { x: W - T, y: b }, { x: W, y: b });
    pts.push({ x: W, y: H }, { x: 0, y: H });
    for (const [a, b] of upSlots.slice().reverse()) {
      pts.push({ x: 0, y: b }, { x: T, y: b }, { x: T, y: a }, { x: 0, y: a });
    }
    return pts;
  }

  // A side wall: the body is two stock thicknesses narrower than the box, and
  // its upright tabs reach out to the full D, where the wall slots take them.
  function sideOutline(D, H, T, upTabs) {
    const pts = [{ x: T, y: 0 }];
    for (const [a, b] of across(D)) pts.push({ x: a, y: 0 }, { x: a, y: -T }, { x: b, y: -T }, { x: b, y: 0 });
    pts.push({ x: D - T, y: 0 });
    for (const [a, b] of upTabs) {
      pts.push({ x: D - T, y: a }, { x: D, y: a }, { x: D, y: b }, { x: D - T, y: b });
    }
    pts.push({ x: D - T, y: H }, { x: T, y: H });
    for (const [a, b] of upTabs.slice().reverse()) {
      pts.push({ x: T, y: b }, { x: 0, y: b }, { x: 0, y: a }, { x: T, y: a });
    }
    return pts;
  }

  // A sliding top: a plain plate with one tab out of each upright edge, set in
  // from the top edge. `tabTop` is measured down from the pull's top edge.
  function pullOutline(w, h, T, tabTop) {
    const top = h - tabTop;
    const bottom = top - T;
    return [
      { x: 0, y: 0 }, { x: w, y: 0 },
      { x: w, y: bottom }, { x: w + T, y: bottom }, { x: w + T, y: top }, { x: w, y: top },
      { x: w, y: h }, { x: 0, y: h },
      { x: 0, y: top }, { x: -T, y: top }, { x: -T, y: bottom }, { x: 0, y: bottom }
    ];
  }

  function rect(x0, y0, x1, y1) {
    return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  }

  // The clip's footprint on the inside of a side wall.
  function sideMark(D, H, T, clipW, clipH, clipTop) {
    const x0 = D / 2 - clipW / 2;
    return rect(x0, clipTop - clipH, x0 + clipW, clipTop);
  }

  // The handle's footprint on the pull.
  function pullMark(w, T, handleW, markY) {
    const x0 = w / 2 - handleW / 2;
    return rect(x0, markY, x0 + handleW, markY + T);
  }

  // A pin hole: square bottom, rounded top.
  function handleOutline(w, h, r) {
    const rr = Math.min(r, w / 2, h);
    const pts = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h - rr }];
    for (let i = 1; i <= ARC; i++) {
      const a = (i * Math.PI) / (2 * ARC);
      pts.push({ x: w - rr + rr * Math.cos(a), y: h - rr + rr * Math.sin(a) });
    }
    pts.push({ x: rr, y: h });
    for (let i = 1; i <= ARC; i++) {
      const a = Math.PI / 2 + (i * Math.PI) / (2 * ARC);
      pts.push({ x: rr + rr * Math.cos(a), y: h - rr + rr * Math.sin(a) });
    }
    return pts;
  }

  function holeOutline(cx, cy, r, segs) {
    const n = Math.max(8, Math.round(segs) || REF.holeSegs);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return pts;
  }

  // ---- the plan ----------------------------------------------------------

  function pullTopPlan({ W, D, H, T }) {
    const prm = {
      pullW: Math.max(T, W - 2 * T),
      pullH: Math.max(3 * T, H - REF.pullClear * T),
      clipW: REF.clipW * T,
      clipH: REF.clipH * T,
      clipTop: H - REF.clipTop * T,
      handleW: REF.handleW * T,
      handleH: REF.handleH * T,
      handleR: REF.handleR * T,
      markY: REF.markY * T,
      holeR: REF.holeR * T,
      holeIn: REF.holeIn * T
    };
    // The tab must keep clear of the pull's bottom edge on a short box.
    prm.tabTop = Math.min(REF.pullTabTop * T, Math.max(0, prm.pullH - T - 1e-6));

    const upSlots = up(H);
    const holeY = H - prm.holeIn;
    return {
      prm,
      base: { outline: baseOutline(W, D, T), w: W, h: D },
      wall: { outline: wallOutline(W, H, T, upSlots), w: W, h: H },
      side: {
        outline: sideOutline(D, H, T, upSlots),
        holes: [
          holeOutline(T + prm.holeIn, holeY, prm.holeR, REF.holeSegs),
          holeOutline(D - T - prm.holeIn, holeY, prm.holeR, REF.holeSegs)
        ],
        marking: sideMark(D, H, T, prm.clipW, prm.clipH, prm.clipTop),
        w: D, h: H
      },
      pull: {
        outline: pullOutline(prm.pullW, prm.pullH, T, prm.tabTop),
        marking: pullMark(prm.pullW, T, prm.handleW, prm.markY),
        w: prm.pullW, h: prm.pullH
      },
      clip: { outline: rect(0, 0, prm.clipW, prm.clipH), w: prm.clipW, h: prm.clipH },
      handle: {
        outline: handleOutline(prm.handleW, prm.handleH, prm.handleR),
        w: prm.handleW, h: prm.handleH
      }
    };
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
    return { W: num('W', 150, 40), D: num('D', 100, 40), H: num('H', 50, 20), T: num('T', 3, 0.5) };
  }

  NS.register({
    id: 'pulltopduo',
    label: 'Pull top duo',
    version: '1.0.0',
    icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2.5" y="6.5" width="11" height="7" rx="0.8"/><path d="M7.5 3.5H2.5M4.2 2 2.5 3.5 4.2 5M8.5 3.5h5M11.8 2l1.7 1.5-1.7 1.5"/></svg>',
    title: 'Pull top duo: base, four walls and two sliding tops you pull apart, with clips that carry them and finger handles. The red marks show where the clips and handles are glued. Double click the result to edit its parameters',
    modalId: 'pulltopduo-modal',
    guide: {
      en: {
        main: '<b>Base</b>, four walls and two sliding <b>pulls</b> with their clips and handles. <b>Red lines</b> mark glue spots — everything else cuts. Double click the result to edit.'
      },
      id: {
        main: '<b>Base</b>, empat dinding dan dua <b>pull</b> yang diselipkan beserta clip dan handlenya. <b>Garis merah</b> menandai tempat lem — sisanya potong. Dobel-klik hasil untuk mengubah.'
      }
    },
    modal: `
<div id="pulltopduo-modal" class="modal hidden">
  <div class="modal-box wide-cols">
    <h3>Pull top duo &middot; two sliding tops</h3>
    <div class="modal-cols">
    <div class="opt-col">
      <label class="opt">Width (mm) <input type="number" id="pt-w" value="150" step="1" min="40"></label>
      <label class="opt">Depth (mm) <input type="number" id="pt-d" value="100" step="1" min="40"></label>
      <label class="opt">Height (mm) <input type="number" id="pt-h" value="50" step="1" min="20"></label>
      <label class="opt">Material thickness (mm) <input type="number" id="pt-t" value="3" step="0.1" min="0.5"></label>
    </div>
    <div class="cnc-status" data-guide="main"></div>
    </div>
    <div class="modal-actions">
      <button class="btn" id="pt-cancel">Cancel</button>
      <button class="btn primary" id="pt-ok">Create</button>
    </div>
  </div>
</div>`,

    open(api, params) {
      const s = read(params);
      const el = (id) => document.getElementById(id);
      el('pt-w').value = s.W;
      el('pt-d').value = s.D;
      el('pt-h').value = s.H;
      el('pt-t').value = s.T;
      const ok = el('pt-ok');
      if (ok) ok.focus();
    },

    apply(api) {
      const el = (id) => document.getElementById(id);
      const clamp = api.clamp, fmt = api.fmt, toast = api.toast;
      const W = clamp(+el('pt-w').value || 150, 40, 2000);
      const D = clamp(+el('pt-d').value || 100, 40, 2000);
      const H = clamp(+el('pt-h').value || 50, 20, 500);
      const Traw = clamp(+el('pt-t').value || 3, 0.5, 20);
      // Two stock thicknesses come out of the sides and the pull, so the stock
      // has to leave a body behind on the narrowest panel.
      const T = Math.min(Traw, D / 8, H / 6);
      NS.close('pulltopduo');
      try { localStorage.setItem(KEY, JSON.stringify({ W, D, H, T })); } catch (err) { /* ignore */ }

      const plan = pullTopPlan({ W, D, H, T });
      const prm = plan.prm;

      // ---- panels on the sheet ----
      //
      // The reference nests the walls above and below the base, the side walls
      // left and right (turned a quarter turn), and the pull column one gap off
      // the left side wall, running downwards.
      const items = [];
      const push = (name, list, mode, dx, dy, markAt, size) => {
        items.push({ name, list, mode, dx, dy, markAt: markAt || [], size });
      };

      const sideLeft = -(GAP + H + T);      // the left side wall's outer edge
      const colRight = sideLeft - GAP;      // the pull column's right edge
      const clip = plan.clip.outline;
      const handle = plan.handle.outline;

      push('Base', [plan.base.outline], 'normal', 0, 0, [], [plan.base.w, plan.base.h]);
      push('Wall', [plan.wall.outline], 'normal', 0, D + GAP + T, [], [plan.wall.w, plan.wall.h]);
      push('Wall', [plan.wall.outline], 'flipY', 0, -(GAP + T), [], [plan.wall.w, plan.wall.h]);
      push('Side', [plan.side.outline].concat(plan.side.holes, [plan.side.marking]), 'rot90',
        -(GAP + T), 0, [3], [plan.side.w, plan.side.h]);
      push('Side', [plan.side.outline].concat(plan.side.holes, [plan.side.marking]), 'rot90flip',
        W + GAP + T, 0, [3], [plan.side.w, plan.side.h]);

      // The pull column: two pulls stacked, then a row of clips, then a row of
      // handles, all right-aligned on the same edge.
      let cursor = D + COL_TOP;
      const pullDx = colRight - (prm.pullW + T);
      const pullSize = [prm.pullW, prm.pullH];
      push('Pull', [plan.pull.outline, plan.pull.marking], 'flipY', pullDx, cursor, [1], pullSize);
      cursor -= prm.pullH + GAP;
      push('Pull', [plan.pull.outline, plan.pull.marking], 'flipY', pullDx, cursor, [1], pullSize);
      cursor -= prm.pullH + GAP;

      const clipSize = [prm.clipW, prm.clipH];
      push('Clip', [clip], 'flipY', colRight - prm.clipW, cursor, [], clipSize);
      push('Clip', [clip], 'flipY', colRight - 2 * prm.clipW - GAP, cursor, [], clipSize);
      cursor -= prm.clipH + GAP;

      const handleSize = [prm.handleW, prm.handleH];
      push('Handle', [handle], 'flipY', colRight - prm.handleW, cursor, [], handleSize);
      push('Handle', [handle], 'flipY', colRight - 2 * prm.handleW - GAP, cursor, [], handleSize);

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
        toast('Pull top duo: could not build the panels');
        return;
      }
      api.commit();
      api.ui.selection = madeIds.map(id => ({ kind: 'entity', id }));
      api.cmdGroupSelection({ noHistory: true });
      const wrap = api.ui.selection.length === 1 ? api.state.entities[api.ui.selection[0].id] : null;
      if (wrap && wrap.type === 'art') {
        wrap.gen = { kind: 'pulltopduo', params: { W, D, H, T } };
        wrap.name = 'Pull top duo \u00b7 ' + fmt(W) + '\u00d7' + fmt(D) + '\u00d7' + fmt(H);
      }
      toast('Pull top duo: ' + items.length + ' panels \u00b7 ' + fmt(W) + '\u00d7' + fmt(D) + '\u00d7' +
        fmt(H) + ' mm \u00b7 ' + fmt(T) + ' mm stock \u00b7 pulls ' +
        fmt(prm.pullW) + '\u00d7' + fmt(prm.pullH) + ' mm');
    }
  });
})();
