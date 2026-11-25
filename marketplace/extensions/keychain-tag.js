// Keychain Tag: rounded-corner tag with keyring hole and optional inner marking border.
(() => {
  'use strict';

  const NS = window.MiniSketchTools;
  const KEY = 'minisketch.v1.ext.keychain-tag';

  function plan(p) {
    if (!(p.w >= 20 && p.h >= 12)) return { ok: false, why: 'width >= 20 mm and height >= 12 mm required' };
    if (p.r * 2 > Math.min(p.w, p.h)) return { ok: false, why: 'corner radius exceeds half the smallest side' };
    if (p.holeD >= p.h - 4) return { ok: false, why: 'hole diameter too large for tag height' };
    return { ok: true, ...p };
  }

  function roundedRectPts(cx, cy, w, h, r) {
    const hw = w / 2, hh = h / 2;
    const rad = Math.max(0, Math.min(r, hw - 0.1, hh - 0.1));
    if (rad < 0.2) {
      return [
        { x: cx - hw, y: cy - hh },
        { x: cx + hw, y: cy - hh },
        { x: cx + hw, y: cy + hh },
        { x: cx - hw, y: cy + hh }
      ];
    }
    const pts = [];
    const corners = [
      { x: cx + hw - rad, y: cy - hh + rad, a0: -Math.PI / 2, a1: 0 },
      { x: cx + hw - rad, y: cy + hh - rad, a0: 0, a1: Math.PI / 2 },
      { x: cx - hw + rad, y: cy + hh - rad, a0: Math.PI / 2, a1: Math.PI },
      { x: cx - hw + rad, y: cy - hh + rad, a0: Math.PI, a1: Math.PI * 1.5 }
    ];
    const steps = 8;
    for (const c of corners) {
      for (let i = 0; i <= steps; i++) {
        const a = c.a0 + (c.a1 - c.a0) * (i / steps);
        pts.push({ x: c.x + Math.cos(a) * rad, y: c.y + Math.sin(a) * rad });
      }
    }
    return pts;
  }

  function circlePts(cx, cy, r, segs) {
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
    const bool = (k, def) => (p[k] != null ? !!p[k] : (saved[k] != null ? !!saved[k] : def));
    return {
      w: num('w', 65, 20),
      h: num('h', 28, 12),
      r: num('r', 6, 0),
      holeD: num('holeD', 4.5, 1.5),
      markBorder: bool('markBorder', true)
    };
  }

  NS.register({
    id: 'keychain-tag',
    label: 'Keychain tag',
    icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.8" y="4.5" width="12.4" height="7" rx="2.5"/><circle cx="4.5" cy="8" r="1.2"/></svg>',
    title: 'Rounded keychain or luggage tag with keyring hole',
    version: '1.0.0',
    author: 'MiniSketch Official',
    category: 'Signage & Art',
    modalId: 'keychain-tag-modal',
    modal: `
<div id="keychain-tag-modal" class="modal hidden">
  <div class="modal-box wide-cols">
    <h3>Keychain Tag</h3>
    <div class="modal-cols">
      <div class="opt-col">
        <label class="opt">Width (mm) <input type="number" id="kt-w" value="65" step="1" min="20" max="400"></label>
        <label class="opt">Height (mm) <input type="number" id="kt-h" value="28" step="1" min="12" max="200"></label>
        <label class="opt">Corner radius (mm) <input type="number" id="kt-r" value="6" step="0.5" min="0"></label>
        <label class="opt">Ring hole dia (mm) <input type="number" id="kt-holed" value="4.5" step="0.5" min="1.5"></label>
        <label class="opt"><input type="checkbox" id="kt-mark" checked> Score border (#ff0000)</label>
      </div>
      <div class="cnc-status">Creates a rounded rectangular tag (#000000 cut) with a punched keyring hole on the left and an optional red (#ff0000) low-power surface score inset by 2.5 mm. Place your Text tool output inside afterwards.</div>
    </div>
    <div class="modal-actions">
      <button class="btn" id="keychain-tag-cancel">Cancel</button>
      <button class="btn primary" id="keychain-tag-ok">Create</button>
    </div>
  </div>
</div>`,

    open(api, params) {
      const s = read(params);
      const el = (id) => document.getElementById(id);
      el('kt-w').value = s.w;
      el('kt-h').value = s.h;
      el('kt-r').value = s.r;
      el('kt-holed').value = s.holeD;
      el('kt-mark').checked = s.markBorder;
      const ok = el('keychain-tag-ok');
      if (ok) ok.focus();
    },

    apply(api) {
      const el = (id) => document.getElementById(id);
      const w = api.clamp(+el('kt-w').value || 65, 20, 400);
      const h = api.clamp(+el('kt-h').value || 28, 12, 200);
      const r = api.clamp(+el('kt-r').value || 0, 0, 100);
      const holeD = api.clamp(+el('kt-holed').value || 4.5, 1.5, 40);
      const markBorder = !!el('kt-mark').checked;

      const p = plan({ w, h, r, holeD, markBorder });
      if (!p.ok) { api.toast('Keychain tag: ' + p.why); return; }

      NS.close('keychain-tag');
      try { localStorage.setItem(KEY, JSON.stringify({ w, h, r, holeD, markBorder })); } catch (err) { /* ignore */ }

      const prev = api.selectedEntities().find(e => e.type === 'art' && e.gen && e.gen.kind === 'keychain-tag');
      let center = api.s2w(api.getW() / 2, api.getH() / 2);
      if (prev) {
        const pw = api.P(prev.pw), ph = api.P(prev.ph);
        if (pw && ph) center = { x: (pw.x + ph.x) / 2, y: (pw.y + ph.y) / 2 };
      }

      api.pushHistory();
      if (prev) api.removeEntity(prev.id);

      const madeIds = [];
      const outer = api.addPanelEntity(roundedRectPts(center.x, center.y, w, h, r), '#000000');
      if (outer) madeIds.push(outer);

      const holeX = center.x - w / 2 + Math.max(4, holeD * 0.8 + 2.5);
      const hole = api.addPanelEntity(circlePts(holeX, center.y, holeD / 2, 24), '#000000');
      if (hole) madeIds.push(hole);

      if (markBorder && w > 24 && h > 14) {
        const inset = 2.5;
        const inner = api.addPanelEntity(
          roundedRectPts(center.x, center.y, w - inset * 2, h - inset * 2, Math.max(0, r - inset)),
          '#ff0000'
        );
        if (inner) madeIds.push(inner);
      }

      api.commit();
      if (!madeIds.length) { api.toast('Keychain tag: nothing built'); return; }

      api.ui.selection = madeIds.map(id => ({ kind: 'entity', id }));
      api.cmdGroupSelection({ noHistory: true });
      const wrap = api.ui.selection.length === 1 ? api.state.entities[api.ui.selection[0].id] : null;
      if (!wrap || wrap.type !== 'art') { api.toast('Keychain tag created'); return; }
      wrap.gen = { kind: 'keychain-tag', params: { w, h, r, holeD, markBorder } };
      wrap.name = 'Keychain ' + api.fmt(w) + '\u00d7' + api.fmt(h);
      api.commit();
      api.toast(wrap.name + ' mm');
    }
  });
})();
