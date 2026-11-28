// saved by MiniSketch (server disk) — id: halftone-panel
// label: Halftone
(() => {
  'use strict';
  const NS = window.MiniSketchTools;
  const ID = 'halftone-panel';
  const el = (id) => document.getElementById(id);

  function rectPts(cx, cy, w, h) {
    const x = w / 2, y = h / 2;
    return [
      { x: cx - x, y: cy - y },
      { x: cx + x, y: cy - y },
      { x: cx + x, y: cy + y },
      { x: cx - x, y: cy + y }
    ];
  }

  function circlePts(cx, cy, r, segs) {
    const pts = [];
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    return pts;
  }

  function hexPts(cx, cy, r) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    return pts;
  }

  function capsulePts(cx, cy, r, len) {
    const half = Math.max(0, len / 2 - r);
    const pts = [];
    const segs = 12;
    for (let i = 0; i <= segs; i++) {
      const a = -Math.PI / 2 + (i / segs) * Math.PI;
      pts.push({ x: cx + half + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    for (let i = 0; i <= segs; i++) {
      const a = Math.PI / 2 + (i / segs) * Math.PI;
      pts.push({ x: cx - half + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    return pts;
  }

  function pointInContours(api, pt, contours) {
    let inside = false;
    for (const ct of contours) {
      if (ct.closed && ct.pts && ct.pts.length >= 3 && api.pointInPoly(pt, ct.pts)) inside = !inside;
    }
    return inside;
  }

  // hole must be FULLY inside clip region: center + rim samples
  function holeInside(api, cx, cy, rx, ry, contours) {
    if (!pointInContours(api, { x: cx, y: cy }, contours)) return false;
    const N = 8;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      if (!pointInContours(api, { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry }, contours)) return false;
    }
    return true;
  }

  MiniSketchTools.register({
    id: ID,
    label: 'Halftone',
    title: 'Parametric Halftone Perforation',
    version: '1.2.0',
    author: 'AI Builder',
    category: 'Signage & Art',
    description: 'Creates a CNC-safe parametric halftone perforation panel with linear/radial green attractors or wave modulation.',
    icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.5" y="1.5" width="13" height="13" rx="1"/><circle cx="5" cy="5" r="1.2"/><circle cx="11" cy="5" r="0.8"/><circle cx="5" cy="11" r="1.8"/><circle cx="11" cy="11" r="1.2"/></svg>',
    modalId: ID + '-modal',
    guide: {
      en: { main: 'Cut #000000. Max hole size is auto-clamped to keep ≥8 mm web between holes. Selection = container: grid uses the object\'s own W×H and fills it inside Outer Margin. Green line = gradient axis, green circles = radial attractors. No selection = uses W/H.' },
      id: { main: 'Potong #000000. Ukuran lubang maks dibatasi otomatis agar jarak antar tepi ≥8 mm. Seleksi = wadah: grid memakai W×H objek dan mengisinya di dalam Outer Margin. Garis hijau = arah gradasi, circle hijau = radial attractor. Tanpa seleksi = pakai W/H.' }
    },
    modal: `<div id="${ID}-modal" class="modal hidden"><div class="modal-box wide-cols"><h3>Parametric Halftone Perforation</h3><div class="modal-cols"><div class="opt-col">
      <label class="opt">Width (mm) <input type="number" id="ht-w" value="1220" min="20"></label>
      <label class="opt">Height (mm) <input type="number" id="ht-h" value="2440" min="20"></label>
      <label class="opt">Grid Pitch (mm) <input type="number" id="ht-pitch" value="35" min="10"></label>
      <label class="opt">Grid Type <select id="ht-grid"><option value="square">Square</option><option value="staggered">Staggered / Hexagonal</option></select></label>
      <label class="opt">Hole Shape <select id="ht-shape"><option value="circle">Circle</option><option value="hexagon">Hexagon</option><option value="capsule">Capsule / Slot</option></select></label>
      <label class="opt">Min Hole Size (mm) <input type="number" id="ht-dmin" value="6" min="1"></label>
      <label class="opt">Max Hole Size (mm) <input type="number" id="ht-dmax" value="28" min="1"></label>
      <label class="opt">Outer Margin (mm) <input type="number" id="ht-margin" value="20" min="0"></label>
      <label class="opt">Wave Frequency <input type="number" id="ht-wfreq" value="2" min="0.1" step="0.1"></label>
      <label class="opt">Wave Amplitude (0-1) <input type="number" id="ht-wamp" value="0.8" min="0" max="1" step="0.05"></label>
    </div><div class="cnc-status" data-guide="main"></div></div><div class="modal-actions"><button class="btn" id="${ID}-cancel">Cancel</button><button class="btn primary" id="${ID}-ok">Generate</button></div></div></div>`,
    open(api, params) {
      if (params) {
        if (params.w != null) el('ht-w').value = params.w;
        if (params.h != null) el('ht-h').value = params.h;
        if (params.pitch != null) el('ht-pitch').value = params.pitch;
        if (params.grid != null) el('ht-grid').value = params.grid;
        if (params.shape != null) el('ht-shape').value = params.shape;
        if (params.dmin != null) el('ht-dmin').value = params.dmin;
        if (params.dmax != null) el('ht-dmax').value = params.dmax;
        if (params.margin != null) el('ht-margin').value = params.margin;
        if (params.wfreq != null) el('ht-wfreq').value = params.wfreq;
        if (params.wamp != null) el('ht-wamp').value = params.wamp;
      }
      const ok = el(ID + '-ok');
      if (ok) ok.focus();
    },
    apply(api) {
      const w = +el('ht-w').value;
      const h = +el('ht-h').value;
      const pitch = +el('ht-pitch').value;
      const grid = el('ht-grid').value;
      const shape = el('ht-shape').value;
      const dmin = +el('ht-dmin').value;
      const dmaxReq = +el('ht-dmax').value;
      const margin = +el('ht-margin').value;
      const wfreq = +el('ht-wfreq').value;
      const wamp = api.clamp(+el('ht-wamp').value, 0, 1);

      if (!(w >= 20 && h >= 20)) { api.toast('Width/Height minimal 20 mm'); return; }
      if (!(pitch >= 10)) { api.toast('Grid Pitch minimal 10 mm'); return; }
      if (!(dmin > 0 && dmaxReq >= dmin)) { api.toast('Ukuran lubang min/max tidak valid'); return; }
      if (!(margin >= 0)) { api.toast('Margin minimal 0 mm'); return; }

      NS.close(ID);

      const safeMax = Math.max(dmin, pitch - 8);
      const dmax = Math.min(dmaxReq, safeMax);
      if (dmax < dmaxReq) {
        api.toast('Max hole dibatasi ke ' + api.fmt(dmax) + ' mm (min web 8 mm)');
      }

      const sel = api.selectedEntities();
      const prev = sel.find(e => e.type === 'art' && e.gen && e.gen.kind === ID);
      const sb = api.selectionBounds();

      const greenLines = [];
      const greenCircles = [];
      const boundaryEnts = [];

      for (const e of sel) {
        if (prev && e.id === prev.id) continue;
        const col = (api.colorOf(e) || '').toLowerCase();
        if (col === '#00ff00') {
          if (e.type === 'line') {
            const pa = api.P(e.a), pb = api.P(e.b);
            if (pa && pb) greenLines.push({ a: pa, b: pb });
          } else if (e.type === 'circle') {
            const pc = api.P(e.c);
            if (pc) greenCircles.push({ x: pc.x, y: pc.y, r: e.r || 10 });
          }
        } else {
          boundaryEnts.push(e);
        }
      }

      // --- container: selection object always wins ---
      let outerContours = [];
      let containerSource = '';
      if (boundaryEnts.length > 0) {
        const baked = api.bakeContours(boundaryEnts, { joinTol: 0.1 });
        outerContours = ((baked && baked.contours) || []).filter(c => c && c.closed && c.pts && c.pts.length >= 3);
      }

      if (outerContours.length > 0) {
        containerSource = 'contours';
      } else if (sb) {
        // object selected but no closed contour -> use its own W×H bbox
        const cx = (sb.minX + sb.maxX) / 2, cy = (sb.minY + sb.maxY) / 2;
        outerContours = [{ pts: rectPts(cx, cy, sb.maxX - sb.minX, sb.maxY - sb.minY), closed: true }];
        containerSource = 'selbbox';
      } else {
        const c = api.s2w(api.getW() / 2, api.getH() / 2);
        outerContours = [{ pts: rectPts(c.x, c.y, w, h), closed: true }];
        containerSource = 'wh';
      }

      if (prev && containerSource === 'wh') {
        const pw = api.P(prev.pw), ph = api.P(prev.ph);
        if (pw && ph) {
          const cx = (pw.x + ph.x) / 2, cy = (pw.y + ph.y) / 2;
          outerContours = [{ pts: rectPts(cx, cy, w, h), closed: true }];
        }
      }

      // --- clip region: outer contour inset by outer margin ---
      let clipContours = outerContours;
      if (margin > 0) {
        const inset = api.offsetClosedChains(outerContours, -margin, { join: 'round', miterLimit: 2, arcTol: 0.2 });
        if (inset && inset.length) clipContours = inset;
      }

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const ct of clipContours) {
        for (const p of ct.pts) {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
      }
      if (!isFinite(minX)) { api.toast('Boundary tidak valid'); return; }

      const bw = Math.max(1e-6, maxX - minX);
      const bh = Math.max(1e-6, maxY - minY);
      const diag = Math.hypot(bw, bh);

      const stepX = pitch;
      const stepY = grid === 'staggered' ? pitch * Math.sqrt(3) / 2 : pitch;
      const stagger = grid === 'staggered';

      // counts fit the FULL span inside clip bbox BEFORE any skipping
      let colCount = stagger
        ? Math.max(1, Math.floor((bw - stepX / 2) / stepX) + 1)
        : Math.max(1, Math.floor(bw / stepX) + 1);
      const rowCount = Math.max(1, Math.floor(bh / stepY) + 1);
      const staggerActive = stagger && rowCount > 1 && colCount > 1;

      const spanX = (colCount - 1) * stepX + (staggerActive ? stepX / 2 : 0);
      const spanY = (rowCount - 1) * stepY;
      // centered symmetrically: even rows -s/4, odd rows +s/4 about center
      const baseX = (minX + maxX - spanX) / 2;
      const startY = (minY + maxY - spanY) / 2;

      api.pushHistory();
      if (prev) api.removeEntity(prev.id);

      const madeIds = [];
      if (containerSource !== 'contours') {
        const frameId = api.addPanelEntity(outerContours[0].pts, '#000000');
        if (frameId) madeIds.push(frameId);
      }

      let placed = 0;
      for (let r = 0; r < rowCount; r++) {
        const y = startY + r * stepY;
        const xOff = (staggerActive && (r % 2 === 1)) ? stepX * 0.5 : 0;
        for (let c = 0; c < colCount; c++) {
          const x = baseX + xOff + c * stepX;

          let t = 0.5;
          if (greenCircles.length > 0) {
            let minDist = Infinity;
            for (const gc of greenCircles) {
              const d = Math.hypot(x - gc.x, y - gc.y);
              if (d < minDist) minDist = d;
            }
            const norm = api.clamp(minDist / (diag * 0.5), 0, 1);
            t = 1 - norm;
          } else if (greenLines.length > 0) {
            const ln = greenLines[0];
            const vx = ln.b.x - ln.a.x, vy = ln.b.y - ln.a.y;
            const len2 = vx * vx + vy * vy;
            if (len2 > 1e-6) {
              t = api.clamp(((x - ln.a.x) * vx + (y - ln.a.y) * vy) / len2, 0, 1);
            }
          } else {
            const nx = (x - minX) / bw;
            const ny = (y - minY) / bh;
            const wave = 0.5 + 0.5 * Math.sin((nx + ny) * Math.PI * wfreq);
            t = 0.5 + (wave - 0.5) * wamp;
          }

          const size = dmin + (dmax - dmin) * api.clamp(t, 0, 1);
          const rad = size / 2;
          let pts, rx, ry;
          if (shape === 'hexagon') {
            pts = hexPts(x, y, rad);
            rx = ry = rad;
          } else if (shape === 'capsule') {
            const capLen = Math.min(dmax, size * 1.4);
            pts = capsulePts(x, y, rad * 0.7, capLen);
            rx = capLen / 2;
            ry = rad * 0.7;
          } else {
            pts = circlePts(x, y, rad, 24);
            rx = ry = rad;
          }

          // hole must sit fully inside the margin-inset region
          if (!holeInside(api, x, y, rx, ry, clipContours)) continue;

          const hid = api.addPanelEntity(pts, '#000000');
          if (hid) { madeIds.push(hid); placed++; }
        }
      }

      if (placed === 0) { api.commit(); api.toast('Tidak ada lubang di dalam wadah'); return; }

      api.commit();
      if (!madeIds.length) { api.toast('Tidak ada lubang yang dihasilkan'); return; }

      api.ui.selection = madeIds.map(id => ({ kind: 'entity', id }));
      api.cmdGroupSelection({ noHistory: true });
      const wrap = api.ui.selection.length === 1 ? api.state.entities[api.ui.selection[0].id] : null;
      if (wrap && wrap.type === 'art') {
        wrap.gen = {
          kind: ID,
          params: { w, h, pitch, grid, shape, dmin, dmax: dmaxReq, margin, wfreq, wamp }
        };
        wrap.name = 'Halftone ' + shape + ' (' + placed + ' holes)';
        api.commit();
      }
      api.toast('Halftone panel: ' + placed + ' holes');
    }
  });
})();