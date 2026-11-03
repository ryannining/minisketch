// Paint storage rack: a tiered laser-cut rack that holds bottles upright.
//
// Parts: two side walls and N shelves (tiers). Each shelf is drilled with a
// grid of round holes (columns x rows, diameter + spacing) and its left/right
// edges carry finger-joint tabs that slot into continuous fingered slots in
// the side walls — the same comb trick the Box maker uses, so a shelf can
// slide in at any tier height. Every joint size follows the material
// thickness; the shelf size follows the hole grid plus an edge margin equal
// to the spacing.
(() => {
  'use strict';

  const NS = window.MiniSketchTools;
  const KEY = 'minisketch.v1.paintRack';

  // ---- pure plan helpers (probed by testing/paintrack_probe.js) ----------

  // Same finger/comb edge as the Box maker: 'tab' sticks out one thickness,
  // 'notch' cuts in one thickness, 'plain' leaves a straight edge. Fingers are
  // about `fw` wide, the count is odd so both ends match.
  function fingerEdge(ax, ay, bx, by, nx, ny, t, fw, mode) {
    const out = [];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-9) return out;
    const ux = (bx - ax) / len, uy = (by - ay) / len;
    const off = (i) => {
      if (mode === 'plain') return 0;
      const joint = (i % 2) === 0;
      return joint ? (mode === 'tab' ? t : -t) : 0;
    };
    let n = 1;
    if (mode !== 'plain') {
      n = Math.max(2, Math.round(len / Math.max(0.5, fw)));
      if (!(n % 2)) n += 1;
    }
    const fl = len / n;
    out.push({ x: ax + nx * off(1), y: ay + ny * off(1) });
    for (let i = 1; i <= n; i++) {
      const atEnd = i === n;
      const px = atEnd ? bx : ax + ux * fl * i;
      const py = atEnd ? by : ay + uy * fl * i;
      out.push({ x: px + nx * off(i), y: py + ny * off(i) });
      if (!atEnd && off(i) !== off(i + 1)) {
        out.push({ x: px + nx * off(i + 1), y: py + ny * off(i + 1) });
      }
    }
    return out;
  }

  function panelPoints(x0, y0, w, h, t, fw, m) {
    const pts = [];
    pts.push(...fingerEdge(x0, y0 + h, x0 + w, y0 + h, 0, 1, t, fw, m.top));
    pts.push(...fingerEdge(x0 + w, y0 + h, x0 + w, y0, 1, 0, t, fw, m.right));
    pts.push(...fingerEdge(x0 + w, y0, x0, y0, 0, -1, t, fw, m.bottom));
    pts.push(...fingerEdge(x0, y0, x0, y0 + h, -1, 0, t, fw, m.left));
    return pts;
  }

  // Hole grid on a shelf of w x h: edge margin = spacing on all sides,
  // cell pitch = dia + spacing. Columns run along w, rows along h.
  function holeGrid(w, h, cols, rows, dia, sp) {
    const out = [];
    const cell = dia + sp;
    const gw = (cols - 1) * cell, gh = (rows - 1) * cell;
    const x0 = (w - gw) / 2, y0 = (h - gh) / 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        out.push({ x: x0 + c * cell, y: y0 + r * cell });
      }
    }
    return out;
  }

  // The whole flat layout. Returns panels with local outlines + hole centres;
  // apply() only places them at the view centre.
  function paintrackPlan(p) {
    const cols = Math.max(1, Math.round(p.cols));
    const rows = Math.max(1, Math.round(p.rows));
    const tiers = Math.max(1, Math.round(p.tiers));
    const dia = p.dia, sp = p.sp, t = p.t, fw = p.fw, pitch = p.pitch;
    const cell = dia + sp;
    const shelfW = sp * (cols + 1) + cols * dia;   // margin = spacing
    const shelfD = sp * (rows + 1) + rows * dia;
    const wallH = tiers * pitch;                    // bottom shelf sits at 0

    const gap = Math.max(8, t * 2);
    const panels = [];
    // left wall: fingered slot on its right (inner) edge
    panels.push({
      name: 'Side wall L', x0: 0, y0: 0, w: shelfD, h: wallH,
      m: { top: 'plain', right: 'notch', bottom: 'plain', left: 'plain' },
      holes: []
    });
    // right wall: mirrored
    panels.push({
      name: 'Side wall R', x0: shelfD + gap, y0: 0, w: shelfD, h: wallH,
      m: { top: 'plain', right: 'plain', bottom: 'plain', left: 'notch' },
      holes: []
    });
    // shelves, stacked to the right of the walls
    const sx = 2 * shelfD + 2 * gap;
    for (let i = 0; i < tiers; i++) {
      panels.push({
        name: 'Shelf ' + (i + 1), x0: sx, y0: i * (shelfD + gap),
        w: shelfW, h: shelfD,
        m: { top: 'plain', right: 'tab', bottom: 'plain', left: 'tab' },
        holes: holeGrid(shelfW, shelfD, cols, rows, dia, sp)
      });
    }
    const totalW = sx + shelfW;
    const totalH = Math.max(wallH, tiers * shelfD + (tiers - 1) * gap);
    return { panels, shelfW, shelfD, wallH, totalW, totalH, cell, cols, rows, tiers };
  }

  // ---- dialog ------------------------------------------------------------

  function read(params) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (err) { saved = {}; }
    const p = params || {};
    const num = (k, def) => {
      const v = p[k] != null && p[k] !== '' ? +p[k] : +saved[k];
      return isFinite(v) && v > 0 ? v : def;
    };
    return {
      cols: Math.round(num('cols', 6)), rows: Math.round(num('rows', 2)),
      tiers: Math.round(num('tiers', 3)), dia: num('dia', 30),
      sp: num('sp', 8), t: num('t', 4), fw: num('fw', 10),
      pitch: num('pitch', 55)
    };
  }

  NS.register({
    id: 'paintrack',
    label: 'Paint rack',
    title: 'Paint storage rack: tiered shelves drilled with a hole grid, slotted into two side walls (flat, ready to cut)',
    modalId: 'paintrack-modal',
    modal: `
<div id="paintrack-modal" class="modal hidden">
  <div class="modal-box wide-cols">
    <h3>Paint storage rack</h3>
    <div class="modal-cols">
    <div class="opt-col">
      <label class="opt">Columns (holes left to right) <input type="number" id="ps-cols" value="6" step="1" min="1"></label>
      <label class="opt">Rows (holes front to back) <input type="number" id="ps-rows" value="2" step="1" min="1"></label>
      <label class="opt">Tiers (shelves) <input type="number" id="ps-tiers" value="3" step="1" min="1"></label>
      <label class="opt">Hole diameter (mm) <input type="number" id="ps-dia" value="30" step="0.5" min="2"></label>
      <label class="opt">Spacing between holes (mm) <input type="number" id="ps-sp" value="8" step="0.5" min="1"></label>
      <label class="opt">Tier pitch &mdash; shelf height step (mm) <input type="number" id="ps-pitch" value="55" step="1" min="5"></label>
      <label class="opt">Material thickness (mm) <input type="number" id="ps-t" value="4" step="0.1" min="0.5"></label>
      <label class="opt">Finger width (mm) <input type="number" id="ps-fw" value="10" step="1" min="1"></label>
    </div>
    <div class="cnc-status">Two side walls with fingered slots, one drilled shelf per tier. Shelf size follows the hole grid (edge margin = spacing); every joint follows the thickness. Double click the result to edit.</div>
    </div>
    <div class="modal-actions">
      <button class="btn" id="ps-cancel">Cancel</button>
      <button class="btn primary" id="ps-ok">Create</button>
    </div>
  </div>
</div>`,

    open(api, params) {
      const s = read(params);
      const el = (id) => document.getElementById(id);
      el('ps-cols').value = s.cols;
      el('ps-rows').value = s.rows;
      el('ps-tiers').value = s.tiers;
      el('ps-dia').value = s.dia;
      el('ps-sp').value = s.sp;
      el('ps-pitch').value = s.pitch;
      el('ps-t').value = s.t;
      el('ps-fw').value = s.fw;
      const ok = el('ps-ok');
      if (ok) ok.focus();
    },

    apply(api) {
      const el = (id) => document.getElementById(id);
      const clamp = api.clamp, fmt = api.fmt;
      const prm = {
        cols: clamp(Math.round(+el('ps-cols').value || 6), 1, 40),
        rows: clamp(Math.round(+el('ps-rows').value || 2), 1, 40),
        tiers: clamp(Math.round(+el('ps-tiers').value || 3), 1, 12),
        dia: clamp(+el('ps-dia').value || 30, 2, 300),
        sp: clamp(+el('ps-sp').value || 8, 1, 200),
        pitch: clamp(+el('ps-pitch').value || 55, 5, 500),
        t: clamp(+el('ps-t').value || 4, 0.5, 100),
        fw: clamp(+el('ps-fw').value || 10, 1, 500)
      };
      NS.close('paintrack');
      try { localStorage.setItem(KEY, JSON.stringify(prm)); } catch (err) { /* ignore */ }

      const plan = paintrackPlan(prm);
      if (plan.cell <= prm.dia + 0.5) { /* unreachable: cell = dia + sp, sp >= 1 */ }
      // a hole must leave at least ~1.5 mm of material to the tabs
      if (prm.sp < 1.5) {
        api.toast('Paint rack: spacing below 1.5 mm leaves too little material');
        return;
      }

      // centre the layout in the view
      const center = api.s2w(api.getW() / 2, api.getH() / 2);
      const ox = center.x - plan.totalW / 2;
      const oy = center.y - plan.totalH / 2;

      api.pushHistory();
      const madeIds = [];
      for (const p of plan.panels) {
        const pts = panelPoints(ox + p.x0, oy + p.y0, p.w, p.h, prm.t, prm.fw, p.m);
        const id = api.addPanelEntity(pts, api.ui.color);
        if (id) madeIds.push(id);
        for (const hpt of p.holes) {
          const cid = api.addCircle({ x: ox + p.x0 + hpt.x, y: oy + p.y0 + hpt.y },
            prm.dia / 2, api.ui.color);
          if (cid) madeIds.push(cid);
        }
      }
      api.commit();
      api.toast('Paint rack: ' + plan.tiers + ' tier' + (plan.tiers === 1 ? '' : 's') +
        ' \u00b7 ' + plan.cols + '\u00d7' + plan.rows + ' holes \u00d8' + fmt(prm.dia) +
        ' mm \u00b7 shelf ' + fmt(plan.shelfW) + '\u00d7' + fmt(plan.shelfD) +
        ' \u00b7 walls ' + fmt(plan.wallH) + ' tall \u00b7 material ' + fmt(prm.t) + ' mm');
      api.ui.selection = madeIds.map(id => ({ kind: 'entity', id }));
      api.cmdGroupSelection({ noHistory: true });
      const wrap = api.ui.selection.length === 1
        ? api.state.entities[api.ui.selection[0].id] : null;
      if (wrap && wrap.type === 'art') {
        wrap.gen = { kind: 'paintrack', params: prm };
        wrap.name = 'Paint rack ' + plan.cols + '\u00d7' + plan.rows +
          ' \u00d7' + plan.tiers + ' \u00f8' + fmt(prm.dia);
        api.commit();
      }
    }
  });
})();
