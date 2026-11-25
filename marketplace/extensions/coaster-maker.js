// Coaster Maker: parametric round/polygon coaster with optional inner engrave border and hanging hole.
(() => {
  'use strict';

  const NS = window.MiniSketchTools;
  const KEY = 'minisketch.v1.ext.coaster-maker';

  function plan(p) {
    if (!(p.d >= 30 && p.d <= 500)) return { ok: false, why: 'diameter must be between 30 and 500 mm' };
    if (p.border && !(p.margin >= 2 && p.margin < p.d / 2 - 4)) {
      return { ok: false, why: 'border inset must leave a valid inner ring' };
    }
    if (p.hole && !(p.holeD >= 1.5 && p.holeD <= p.d / 4)) {
      return { ok: false, why: 'hole diameter is out of range' };
    }
    return { ok: true, ...p };
  }

  function polyCircle(cx, cy, r, segs) {
    const pts = [];
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    return pts;
  }

  function read(params) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (err) { saved = {}; }
    const p = params || {};
    const num = (k, def, lo) => {
      const raw = p[k] != null && p[k] !== '' ? +p[k] : +saved[k];
      return isFinite(raw) && raw >= (lo == null ? 0 : lo) ? raw : def;
    };
    const str = (k, def) => (p[k] != null ? String(p[k]) : (saved[k] != null ? String(saved[k]) : def));
    const bool = (k, def) => (p[k] != null ? !!p[k] : (saved[k] != null ? !!saved[k] : def));
    return {
      shape: str('shape', 'round'),
      d: num('d', 90, 30),
      border: bool('border', true),
      margin: num('margin', 6, 2),
      hole: bool('hole', false),
      holeD: num('holeD', 4, 1.5)
    };
  }

  NS.register({
    id: 'coaster-maker',
    label: 'Coaster',
    icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="3.4" stroke-dasharray="1.6 1.4"/></svg>',
    title: 'Parametric coaster with optional engrave ring and hanging hole',
    version: '1.0.0',
    author: 'MiniSketch Official',
    category: 'Signage & Art',
    modalId: 'coaster-maker-modal',
    modal: `
<div id="coaster-maker-modal" class="modal hidden">
  <div class="modal-box wide-cols">
    <h3>Coaster Maker</h3>
    <div class="modal-cols">
      <div class="opt-col">
        <label class="opt">Shape
          <select id="cm-shape">
            <option value="round">Round</option>
            <option value="hex">Hexagon</option>
            <option value="oct">Octagon</option>
          </select>
        </label>
        <label class="opt">Diameter (mm) <input type="number" id="cm-d" value="90" step="1" min="30" max="500"></label>
        <label class="opt"><input type="checkbox" id="cm-border" checked> Inner engrave ring</label>
        <label class="opt">Ring inset (mm) <input type="number" id="cm-margin" value="6" step="0.5" min="2"></label>
        <label class="opt"><input type="checkbox" id="cm-hole"> Hanging hole</label>
        <label class="opt">Hole dia (mm) <input type="number" id="cm-holed" value="4" step="0.5" min="1.5"></label>
      </div>
      <div class="cnc-status">Generates a cut-through coaster outline (#000000) with an optional blue (#0000ff) engrave ring inset from the edge and a black cut hanging hole near the top edge. Double-click the group later to adjust dimensions.</div>
    </div>
    <div class="modal-actions">
      <button class="btn" id="coaster-maker-cancel">Cancel</button>
      <button class="btn primary" id="coaster-maker-ok">Create</button>
    </div>
  </div>
</div>`,

    open(api, params) {
      const s = read(params);
      const el = (id) => document.getElementById(id);
      el('cm-shape').value = s.shape;
      el('cm-d').value = s.d;
      el('cm-border').checked = s.border;
      el('cm-margin').value = s.margin;
      el('cm-hole').checked = s.hole;
      el('cm-holed').value = s.holeD;
      const ok = el('coaster-maker-ok');
      if (ok) ok.focus();
    },

    apply(api) {
      const el = (id) => document.getElementById(id);
      const shape = el('cm-shape').value || 'round';
      const d = api.clamp(+el('cm-d').value || 90, 30, 500);
      const border = !!el('cm-border').checked;
      const margin = api.clamp(+el('cm-margin').value || 6, 2, 100);
      const hole = !!el('cm-hole').checked;
      const holeD = api.clamp(+el('cm-holed').value || 4, 1.5, 40);

      const p = plan({ shape, d, border, margin, hole, holeD });
      if (!p.ok) { api.toast('Coaster: ' + p.why); return; }

      NS.close('coaster-maker');
      try { localStorage.setItem(KEY, JSON.stringify({ shape, d, border, margin, hole, holeD })); } catch (err) { /* ignore */ }

      const prev = api.selectedEntities().find(e => e.type === 'art' && e.gen && e.gen.kind === 'coaster-maker');
      let center = api.s2w(api.getW() / 2, api.getH() / 2);
      if (prev) {
        const o = api.P(prev.p0), pw = api.P(prev.pw), ph = api.P(prev.ph);
        if (o && pw && ph) center = { x: (pw.x + ph.x) / 2, y: (pw.y + ph.y) / 2 };
      }

      api.pushHistory();
      if (prev) api.removeEntity(prev.id);

      const segs = shape === 'hex' ? 6 : (shape === 'oct' ? 8 : 64);
      const r = d / 2;
      const madeIds = [];
      const outerId = api.addPanelEntity(polyCircle(center.x, center.y, r, segs), '#000000');
      if (outerId) madeIds.push(outerId);

      if (border) {
        const innerId = api.addPanelEntity(polyCircle(center.x, center.y, r - margin, segs), '#0000ff');
        if (innerId) madeIds.push(innerId);
      }

      if (hole) {
        const hy = center.y - (r - Math.max(4, margin * 0.85) - holeD / 2);
        const holeId = api.addPanelEntity(polyCircle(center.x, hy, holeD / 2, 24), '#000000');
        if (holeId) madeIds.push(holeId);
      }

      api.commit();
      if (!madeIds.length) { api.toast('Coaster: nothing was built'); return; }

      api.ui.selection = madeIds.map(id => ({ kind: 'entity', id }));
      api.cmdGroupSelection({ noHistory: true });
      const wrap = api.ui.selection.length === 1 ? api.state.entities[api.ui.selection[0].id] : null;
      if (!wrap || wrap.type !== 'art') { api.toast('Coaster created'); return; }
      wrap.gen = { kind: 'coaster-maker', params: { shape, d, border, margin, hole, holeD } };
      wrap.name = 'Coaster ' + shape + ' ' + api.fmt(d) + 'mm';
      api.commit();
      api.toast(wrap.name);
    }
  });
})();
