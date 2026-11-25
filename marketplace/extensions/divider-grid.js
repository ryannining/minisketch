// Drawer Divider: interlocking half-lap slotted strips for grid organizers.
(() => {
  'use strict';

  const NS = window.MiniSketchTools;
  const KEY = 'minisketch.v1.ext.divider-grid';

  function plan(p) {
    if (!(p.len >= 40 && p.wid >= 40)) return { ok: false, why: 'length and width must be at least 40 mm' };
    if (!(p.h >= 12 && p.h <= 200)) return { ok: false, why: 'strip height must be 12..200 mm' };
    if (!(p.t >= 1 && p.t <= 20)) return { ok: false, why: 'material thickness must be 1..20 mm' };
    if (p.cols < 2 || p.rows < 2) return { ok: false, why: 'need at least 2 columns and 2 rows' };
    const slotW = p.t + p.fit;
    if (slotW <= 0.4) return { ok: false, why: 'slot width too narrow' };
    if (p.len / p.cols <= slotW + 4 || p.wid / p.rows <= slotW + 4) {
      return { ok: false, why: 'compartments are too narrow for the material thickness' };
    }
    return { ok: true, ...p, slotW };
  }

  function combStripPts(ox, oy, span, h, notchXs, slotW, fromTop) {
    const half = slotW / 2;
    const midY = oy + h / 2;
    const pts = [];
    if (fromTop) {
      pts.push({ x: ox, y: oy });
      for (const nx of notchXs) {
        pts.push({ x: ox + nx - half, y: oy });
        pts.push({ x: ox + nx - half, y: midY });
        pts.push({ x: ox + nx + half, y: midY });
        pts.push({ x: ox + nx + half, y: oy });
      }
      pts.push({ x: ox + span, y: oy });
      pts.push({ x: ox + span, y: oy + h });
      pts.push({ x: ox, y: oy + h });
    } else {
      pts.push({ x: ox, y: oy });
      pts.push({ x: ox + span, y: oy });
      pts.push({ x: ox + span, y: oy + h });
      for (let i = notchXs.length - 1; i >= 0; i--) {
        const nx = notchXs[i];
        pts.push({ x: ox + nx + half, y: oy + h });
        pts.push({ x: ox + nx + half, y: midY });
        pts.push({ x: ox + nx - half, y: midY });
        pts.push({ x: ox + nx - half, y: oy + h });
      }
      pts.push({ x: ox, y: oy + h });
    }
    return pts;
  }

  function read(params) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (err) { saved = {}; }
    const p = params || {};
    const num = (k, def, lo) => {
      const raw = p[k] != null && p[k] !== '' ? +p[k] : +saved[k];
      return isFinite(raw) && raw >= (lo == null ? -100 : lo) ? raw : def;
    };
    return {
      len: num('len', 240, 40),
      wid: num('wid', 180, 40),
      h: num('h', 40, 12),
      t: num('t', 3, 1),
      fit: num('fit', 0.1, -0.5),
      cols: Math.round(num('cols', 3, 2)),
      rows: Math.round(num('rows', 2, 2))
    };
  }

  NS.register({
    id: 'divider-grid',
    label: 'Drawer divider',
    icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2" y="3" width="12" height="10" rx="0.8"/><path d="M6 3v10M10 3v10M2 8h12"/></svg>',
    title: 'Half-lap slotted drawer organizer divider strips',
    version: '1.0.0',
    author: 'MiniSketch Official',
    category: 'Box & Joinery',
    modalId: 'divider-grid-modal',
    modal: `
<div id="divider-grid-modal" class="modal hidden">
  <div class="modal-box wide-cols">
    <h3>Drawer Divider Grid</h3>
    <div class="modal-cols">
      <div class="opt-col">
        <label class="opt">Total length X (mm) <input type="number" id="dg-len" value="240" step="1" min="40"></label>
        <label class="opt">Total width Y (mm) <input type="number" id="dg-wid" value="180" step="1" min="40"></label>
        <label class="opt">Strip height (mm) <input type="number" id="dg-h" value="40" step="1" min="12"></label>
        <label class="opt">Thickness (mm) <input type="number" id="dg-t" value="3" step="0.1" min="1"></label>
        <label class="opt">Slot clearance (mm) <input type="number" id="dg-fit" value="0.1" step="0.05" min="-0.5" max="1"></label>
        <label class="opt">Columns (X) <input type="number" id="dg-cols" value="3" step="1" min="2" max="12"></label>
        <label class="opt">Rows (Y) <input type="number" id="dg-rows" value="2" step="1" min="2" max="12"></label>
      </div>
      <div class="cnc-status">Generates interlocking half-lap divider strips for a drawer grid: (Rows - 1) horizontal strips notched from the top, and (Columns - 1) cross strips notched from the bottom. All strips cut through (#000000) with 6 mm spacing ready for nesting.</div>
    </div>
    <div class="modal-actions">
      <button class="btn" id="divider-grid-cancel">Cancel</button>
      <button class="btn primary" id="divider-grid-ok">Create</button>
    </div>
  </div>
</div>`,

    open(api, params) {
      const s = read(params);
      const el = (id) => document.getElementById(id);
      el('dg-len').value = s.len;
      el('dg-wid').value = s.wid;
      el('dg-h').value = s.h;
      el('dg-t').value = s.t;
      el('dg-fit').value = s.fit;
      el('dg-cols').value = s.cols;
      el('dg-rows').value = s.rows;
      const ok = el('divider-grid-ok');
      if (ok) ok.focus();
    },

    apply(api) {
      const el = (id) => document.getElementById(id);
      const len = api.clamp(+el('dg-len').value || 240, 40, 3000);
      const wid = api.clamp(+el('dg-wid').value || 180, 40, 3000);
      const h = api.clamp(+el('dg-h').value || 40, 12, 200);
      const t = api.clamp(+el('dg-t').value || 3, 1, 20);
      const fit = api.clamp(+el('dg-fit').value || 0, -0.5, 1);
      const cols = Math.round(api.clamp(+el('dg-cols').value || 3, 2, 12));
      const rows = Math.round(api.clamp(+el('dg-rows').value || 2, 2, 12));

      const p = plan({ len, wid, h, t, fit, cols, rows });
      if (!p.ok) { api.toast('Divider: ' + p.why); return; }

      NS.close('divider-grid');
      try { localStorage.setItem(KEY, JSON.stringify({ len, wid, h, t, fit, cols, rows })); } catch (err) { /* ignore */ }

      const prev = api.selectedEntities().find(e => e.type === 'art' && e.gen && e.gen.kind === 'divider-grid');
      let origin = api.s2w(api.getW() / 2, api.getH() / 2);
      origin = { x: origin.x - len / 2, y: origin.y - ((rows - 1 + cols - 1) * (h + 6)) / 2 };
      if (prev) {
        const o = api.P(prev.ph);
        if (o) origin = { x: o.x, y: o.y };
      }

      api.pushHistory();
      if (prev) api.removeEntity(prev.id);

      const xNotches = [];
      for (let i = 1; i < cols; i++) xNotches.push((len * i) / cols);
      const yNotches = [];
      for (let j = 1; j < rows; j++) yNotches.push((wid * j) / rows);

      const madeIds = [];
      let yCursor = origin.y;
      const gap = 6;
      for (let j = 1; j < rows; j++) {
        const id = api.addPanelEntity(combStripPts(origin.x, yCursor, len, h, xNotches, p.slotW, true), '#000000');
        if (id) madeIds.push(id);
        yCursor += h + gap;
      }
      for (let i = 1; i < cols; i++) {
        const id = api.addPanelEntity(combStripPts(origin.x, yCursor, wid, h, yNotches, p.slotW, false), '#000000');
        if (id) madeIds.push(id);
        yCursor += h + gap;
      }

      api.commit();
      if (!madeIds.length) { api.toast('Divider: nothing built'); return; }

      api.ui.selection = madeIds.map(id => ({ kind: 'entity', id }));
      api.cmdGroupSelection({ noHistory: true });
      const wrap = api.ui.selection.length === 1 ? api.state.entities[api.ui.selection[0].id] : null;
      if (!wrap || wrap.type !== 'art') { api.toast('Divider strips created'); return; }
      wrap.gen = { kind: 'divider-grid', params: { len, wid, h, t, fit, cols, rows } };
      wrap.name = 'Divider ' + cols + 'x' + rows + ' (' + api.fmt(len) + '\u00d7' + api.fmt(wid) + ')';
      api.commit();
      api.toast(wrap.name);
    }
  });
})();
