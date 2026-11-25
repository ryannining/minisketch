// Panel iklan: a rounded advertising panel with a chosen set of pen holes.
//
// The maths lives in planPanel(): parameters in, outline points, hole centres
// and a fit verdict out — no document touched, so testing/paneliklan_probe.js
// can assert on it directly. apply() only reads the dialog, centres the plan in
// the view and writes the geometry as one named, re-editable group.
//
// "Jarak lubang ke pinggir" is the MATERIAL left between the hole wall and the
// panel edge, so the centre sits inset + radius from the edge and a bigger drill
// moves the centre inward instead of eating the margin.
(() => {
  'use strict';

  const NS = window.MiniSketchTools;
  const KEY = 'minisketch.v1.panelIklan';
  const MODES = ['corners', 'leftright', 'topbottom'];
  const ARC_ERR = 0.02;        // mm: how far a sampled corner may stray from the arc

  // Signed distance to the rounded panel: negative inside, and -sdf is the
  // distance to the nearest edge — the reading a hole is checked against, since
  // the hole has to keep that much material around it.
  function roundRectSDF(px, py, w, h, r) {
    const bx = w / 2 - r, by = h / 2 - r;
    const dx = Math.abs(px - w / 2) - bx;
    const dy = Math.abs(py - h / 2) - by;
    return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) +
      Math.min(Math.max(dx, dy), 0) - r;
  }

  // Closed outline of the panel, CCW from the bottom edge, with the corner arcs
  // sampled finely enough to stay within ARC_ERR of the true arc. r = 0 is a
  // plain rectangle; r is clamped to half the short side so the arc still makes
  // sense on a narrow panel.
  function roundRectPts(w, h, rIn) {
    const r = Math.max(0, Math.min(rIn, w / 2, h / 2));
    if (r <= 1e-9) {
      return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
    }
    const theta = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - ARC_ERR / r)));
    const n = Math.max(4, Math.min(128, Math.ceil((Math.PI / 2) / theta)));
    const arcs = [
      [w - r, r, -Math.PI / 2, 0],            // bottom right
      [w - r, h - r, 0, Math.PI / 2],         // top right
      [r, h - r, Math.PI / 2, Math.PI],       // top left
      [r, r, Math.PI, Math.PI * 1.5]          // bottom left
    ];
    const pts = [];
    for (const arc of arcs) {
      for (let i = 0; i <= n; i++) {
        const a = arc[2] + (arc[3] - arc[2]) * (i / n);
        pts.push({ x: arc[0] + r * Math.cos(a), y: arc[1] + r * Math.sin(a) });
      }
    }
    return pts;
  }

  // Hole centres in panel coordinates (origin bottom-left, Y up). `off` is
  // already the distance from the panel EDGE to the hole CENTRE.
  function holeCenters(w, h, mode, off) {
    if (mode === 'leftright') return [{ x: off, y: h / 2 }, { x: w - off, y: h / 2 }];
    if (mode === 'topbottom') return [{ x: w / 2, y: off }, { x: w / 2, y: h - off }];
    return [
      { x: off, y: off }, { x: w - off, y: off },
      { x: w - off, y: h - off }, { x: off, y: h - off }
    ];
  }

  // Parameters -> geometry. Never throws: a plan that does not fit comes back
  // as { ok: false, why } and the tool just reports it without touching the doc.
  function planPanel(p) {
    const w = +p.w, h = +p.h, dia = +p.dia, rIn = +p.r, inset = +p.inset;
    const mode = MODES.indexOf(p.mode) >= 0 ? p.mode : 'corners';
    if (!(w > 0) || !(h > 0)) return { ok: false, why: 'lebar dan tinggi harus lebih dari 0' };
    if (!(dia > 0)) return { ok: false, why: 'diameter lubang harus lebih dari 0' };
    const r = Math.max(0, Math.min(rIn, w / 2, h / 2));
    const holeR = dia / 2;
    const off = Math.max(0, inset) + holeR;
    const holes = holeCenters(w, h, mode, off);
    for (const c of holes) {
      if (roundRectSDF(c.x, c.y, w, h, r) > -holeR + 1e-9) {
        return { ok: false, why: 'lubang keluar bidang panel — kecilkan radius, jarak atau diameter' };
      }
    }
    for (let i = 0; i < holes.length; i++) {
      for (let j = i + 1; j < holes.length; j++) {
        const d = Math.hypot(holes[j].x - holes[i].x, holes[j].y - holes[i].y);
        if (d < dia - 1e-9) {
          return { ok: false, why: 'lubang saling bertumpuk — kecilkan diameter atau jaraknya' };
        }
      }
    }
    return {
      ok: true, why: '', w, h, dia, holeR, r, inset, mode,
      outline: roundRectPts(w, h, r),
      holes
    };
  }

  // A hole as four cubic Bézier nodes — an exact circle, kappa = (4/3)·tan(π/8).
  // The tool used to add a <circle>, but cmdGroupSelection refuses to take over
  // arc / circle selections (they have a life of their own), so the panel was
  // baked AND the original circles stayed: the result was doubled. A spline is
  // plain editable geometry, so grouping replaces it. The panel parameters are
  // still recorded in wrap.gen below, which is what re-editing reads.
  const KAPPA = (4 / 3) * Math.tan(Math.PI / 8);
  function circleSpline(cx, cy, r) {
    const pts = [], ho = [], hi = [];
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 2 * k;
      const ca = Math.cos(a), sa = Math.sin(a);
      const px = cx + ca * r, py = cy + sa * r;
      pts.push({ x: px, y: py });
      // tangent at angle a is (-sin a, cos a); the handle reaches KAPPA·r along it
      ho.push({ x: px - sa * r * KAPPA, y: py + ca * r * KAPPA });
      hi.push({ x: px + sa * r * KAPPA, y: py - ca * r * KAPPA });
    }
    return { pts, hs: { o: ho, i: hi }, closed: true };
  }

  function read(params) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (err) { saved = {}; }
    const p = params || {};
    const num = (k, def, lo, hi) => {
      const raw = p[k] != null && p[k] !== '' ? +p[k] : (saved[k] != null ? +saved[k] : NaN);
      if (!isFinite(raw) || raw < lo) return def;
      return hi != null && raw > hi ? hi : raw;
    };
    const mode = p.mode || saved.mode;
    return {
      w: num('w', 400, 1, 20000),
      h: num('h', 300, 1, 20000),
      dia: num('dia', 6, 0.1, 5000),
      r: num('r', 10, 0, 20000),
      inset: num('inset', 10, 0, 20000),
      mode: MODES.indexOf(mode) >= 0 ? mode : 'corners'
    };
  }

  NS.register({
    id: 'paneliklan',
    label: 'Panel iklan',
    version: '1.0.0',
    icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2" y="3.5" width="12" height="9" rx="1.8"/><circle cx="4.3" cy="5.8" r="0.8" fill="currentColor"/><circle cx="11.7" cy="5.8" r="0.8" fill="currentColor"/><circle cx="4.3" cy="10.2" r="0.8" fill="currentColor"/><circle cx="11.7" cy="10.2" r="0.8" fill="currentColor"/></svg>',
    title: 'Panel iklan: bidang bersudut membulat dengan lubang pen — 4 di sudut, 2 kiri-kanan atau 2 atas-bawah. Klik ganda hasilnya untuk mengubah parameter',
    modalId: 'pi-modal',
    guide: {
      en: {
        main: 'One panel <b>W &times; H</b> with corner <b>radius</b> and pen-hole &oslash; <b>d</b>: <b>4 corners</b> keeps the hole-edge margin to the two nearest sides equal; <b>2</b> places holes mid-side. Holes off the panel or overlapping are refused. Double click the result to edit.'
      },
      id: {
        main: 'Satu panel <b>L &times; T</b> bersudut <b>radius</b> dengan lubang pena &oslash; <b>d</b>: <b>4 di sudut</b> menjaga jarak tepi lubang ke dua sisi terdekat sama; <b>2</b> menaruh lubang di tengah sisi. Lubang keluar bidang atau bertumpuk ditolak. Dobel-klik hasil untuk mengubah.'
      }
    },
    modal: `
<div id="pi-modal" class="modal hidden">
  <div class="modal-box">
    <h3>Panel iklan</h3>
    <div class="opt-col">
      <label class="opt">Width (mm) <input type="number" id="pi-w" value="400" step="1" min="10"></label>
      <label class="opt">Height (mm) <input type="number" id="pi-h" value="300" step="1" min="10"></label>
      <label class="opt">Pen-hole diameter (mm) <input type="number" id="pi-dia" value="6" step="0.5" min="0.5"></label>
      <label class="opt">Corner radius (mm) <input type="number" id="pi-r" value="10" step="1" min="0"></label>
      <label class="opt" title="Leftover material: distance from the hole edge to the panel edge. The hole centre sits at inset + half the diameter from the edge.">Hole edge margin (mm) <input type="number" id="pi-inset" value="10" step="1" min="0"></label>
      <label class="opt">Holes
        <select id="pi-mode">
          <option value="corners">4 in the corners</option>
          <option value="leftright">2 left &amp; right</option>
          <option value="topbottom">2 top &amp; bottom</option>
        </select>
      </label>
    </div>
    <div class="cnc-status" data-guide="main"></div>
    <div class="modal-actions">
      <button class="btn" id="pi-cancel">Cancel</button>
      <button class="btn primary" id="pi-ok">Create</button>
    </div>
  </div>
</div>`,

    open(api, params) {
      const s = read(params);
      const el = (id) => document.getElementById(id);
      el('pi-w').value = s.w;
      el('pi-h').value = s.h;
      el('pi-dia').value = s.dia;
      el('pi-r').value = s.r;
      el('pi-inset').value = s.inset;
      el('pi-mode').value = s.mode;
      const ok = el('pi-ok');
      if (ok) ok.focus();
    },

    apply(api) {
      const el = (id) => document.getElementById(id);
      const clamp = api.clamp, fmt = api.fmt;
      const w = clamp(+el('pi-w').value || 400, 10, 20000);
      const h = clamp(+el('pi-h').value || 300, 10, 20000);
      const dia = clamp(+el('pi-dia').value || 6, 0.1, 5000);
      const r = clamp(+el('pi-r').value || 0, 0, 20000);
      const inset = clamp(+el('pi-inset').value || 0, 0, 20000);
      const modeVal = el('pi-mode').value;
      const mode = MODES.indexOf(modeVal) >= 0 ? modeVal : 'corners';
      NS.close('paneliklan');
      try { localStorage.setItem(KEY, JSON.stringify({ w, h, dia, r, inset, mode })); }
      catch (err) { /* storage blocked */ }

      // plan first: an impossible panel is refused before anything is written
      const plan = planPanel({ w, h, dia, r, inset, mode });
      if (!plan.ok) {
        api.toast('Panel iklan: ' + plan.why);
        return;
      }

      const centre = api.s2w(api.getW() / 2, api.getH() / 2);
      const ox = centre.x - plan.w / 2;
      const oy = centre.y - plan.h / 2;

      api.pushHistory();

      // A re-edit arrives with the previous panel still selected: replace it
      // instead of leaving a second copy on the canvas.
      const sel = api.ui.selection || [];
      if (sel.length === 1 && sel[0].kind === 'entity') {
        const prev = api.state.entities[sel[0].id];
        if (prev && prev.type === 'art' && prev.gen && prev.gen.kind === 'paneliklan') {
          api.removeEntity(prev.id);
        }
      }

      const color = api.ui.color;
      const madeIds = [];
      const outline = api.addPanelEntity(
        plan.outline.map(p => ({ x: p.x + ox, y: p.y + oy })), color);
      if (outline) madeIds.push(outline);
      for (const c of plan.holes) {
        const h = circleSpline(c.x + ox, c.y + oy, plan.holeR);
        const id = api.addSpline({ pts: h.pts, hs: h.hs, closed: true, color });
        if (id) madeIds.push(id);
      }
      api.commit();
      if (!madeIds.length) {
        api.toast('Panel iklan: gagal membuat geometri');
        return;
      }

      api.ui.selection = madeIds.map(id => ({ kind: 'entity', id }));
      api.cmdGroupSelection({ noHistory: true });
      const wrap = api.ui.selection.length === 1
        ? api.state.entities[api.ui.selection[0].id] : null;
      if (wrap && wrap.type === 'art') {
        wrap.gen = { kind: 'paneliklan', params: { w, h, dia, r, inset, mode } };
        wrap.name = 'Panel iklan ' + fmt(w) + '\u00d7' + fmt(h) +
          ' \u00b7 ' + plan.holes.length + ' lubang';
        api.commit();
      }
      api.toast('Panel iklan: ' + fmt(w) + ' \u00d7 ' + fmt(h) + ' mm \u00b7 radius ' +
        fmt(r) + ' \u00b7 \u00d8' + fmt(dia) + ' mm \u00b7 ' + plan.holes.length + ' lubang');
    }
  });
})();
