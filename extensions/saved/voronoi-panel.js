// saved by MiniSketch (server disk) — id: voronoi-panel
// label: Voronoi
(() => {
  'use strict';
  const NS = window.MiniSketchTools;
  const ID = 'voronoi-panel';
  const el = (id) => document.getElementById(id);

  function mulberry32(a) {
    return function () {
      let t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rectPts(cx, cy, w, h) {
    const x = w / 2, y = h / 2;
    return [
      { x: cx - x, y: cy - y },
      { x: cx + x, y: cy - y },
      { x: cx + x, y: cy + y },
      { x: cx - x, y: cy + y }
    ];
  }

  function closedPts(api, ct) {
    const src = ct && ct.pts;
    if (!Array.isArray(src) || src.length < 3) return null;
    const pts = src.slice();
    if (ct.closed) return pts;
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      total += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    }
    const a = pts[0], b = pts[pts.length - 1];
    const gap = Math.hypot(b.x - a.x, b.y - a.y);
    if (gap < Math.max(0.5, total * 0.005)) {
      pts.pop();
      return pts.length >= 3 ? pts : null;
    }
    return null;
  }

  function normRing(api, pts) {
    const r = pts.slice();
    if (api.signedAreaPts(r) < 0) r.reverse();
    return r;
  }

  function clipPolyHalfPlane(poly, ax, ay, bx, by) {
    const mx = (ax + bx) * 0.5;
    const my = (ay + by) * 0.5;
    const nx = bx - ax;
    const ny = by - ay;
    const out = [];
    const n = poly.length;
    if (n < 3) return out;
    for (let i = 0; i < n; i++) {
      const p1 = poly[i];
      const p2 = poly[(i + 1) % n];
      const d1 = (p1.x - mx) * nx + (p1.y - my) * ny;
      const d2 = (p2.x - mx) * nx + (p2.y - my) * ny;
      if (d1 <= 0) {
        out.push(p1);
        if (d2 > 0) {
          const t = d1 / (d1 - d2);
          out.push({ x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) });
        }
      } else if (d2 <= 0) {
        const t = d1 / (d1 - d2);
        out.push({ x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) });
      }
    }
    return out;
  }

  function computeVoronoiCells(seeds, bbox) {
    const pad = 10;
    const baseBox = [
      { x: bbox.minX - pad, y: bbox.minY - pad },
      { x: bbox.maxX + pad, y: bbox.minY - pad },
      { x: bbox.maxX + pad, y: bbox.maxY + pad },
      { x: bbox.minX - pad, y: bbox.maxY + pad }
    ];
    const cells = [];
    for (let i = 0; i < seeds.length; i++) {
      const s = seeds[i];
      let poly = baseBox.slice();
      const others = [];
      for (let j = 0; j < seeds.length; j++) {
        if (i === j) continue;
        const o = seeds[j];
        const dx = o.x - s.x, dy = o.y - s.y;
        others.push({ x: o.x, y: o.y, d2: dx * dx + dy * dy });
      }
      others.sort((a, b) => a.d2 - b.d2);
      for (let k = 0; k < others.length; k++) {
        const o = others[k];
        let maxR2 = 0;
        for (let p = 0; p < poly.length; p++) {
          const dx = poly[p].x - s.x, dy = poly[p].y - s.y;
          const r2 = dx * dx + dy * dy;
          if (r2 > maxR2) maxR2 = r2;
        }
        if (o.d2 > 4 * maxR2 + 1) break;
        poly = clipPolyHalfPlane(poly, s.x, s.y, o.x, o.y);
        if (poly.length < 3) break;
      }
      if (poly.length >= 3) cells.push(poly);
    }
    return cells;
  }

  function pointInRings(api, pt, rings) {
    let inside = false;
    for (const r of rings) {
      if (api.pointInPoly(pt, r)) inside = !inside;
    }
    return inside;
  }

  function bboxOf(rings) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of rings) for (const p of r) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY };
  }

  MiniSketchTools.register({
    id: ID,
    label: 'Voronoi',
    title: 'Parametric Gradient Voronoi Panel',
    version: '1.2.0',
    author: 'AI Builder',
    category: 'Signage & Art',
    description: 'Voronoi panel sized from the selected object and inset inside it by the outer margin. Falls back to modal WxH at canvas center. Density gradient, wall thickness, green guide support.',
    icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="1.5" y="1.5" width="13" height="13" rx="1"/><path d="M5 1.5L7 6L2 9M7 6L12 5L14.5 9M7 6L8 11L14.5 12M8 11L4 14.5"/></svg>',
    modalId: ID + '-modal',
    guide: {
      en: { main: 'Select a shape: panel uses its WxH and is placed inside it by Outer Margin. No selection = WxH at canvas center. Green line = gradient angle, green circles = radial gradient.' },
      id: { main: 'Pilih objek: panel memakai WxH objek dan diletakkan di dalamnya sesuai Outer Margin. Tanpa seleksi = WxH di tengah kanvas. Garis hijau = arah gradasi, lingkaran hijau = gradasi radial.' }
    },
    modal: `<div id="${ID}-modal" class="modal hidden"><div class="modal-box wide-cols"><h3>Voronoi Panel</h3><div class="modal-cols"><div class="opt-col">
      <label class="opt">Width (mm) <input type="number" id="vp-w" value="1220" min="50"></label>
      <label class="opt">Height (mm) <input type="number" id="vp-h" value="2440" min="50"></label>
      <label class="opt">Top / Center Cell (mm) <input type="number" id="vp-top" value="50" min="10"></label>
      <label class="opt">Bottom / Edge Cell (mm) <input type="number" id="vp-bot" value="160" min="10"></label>
      <label class="opt">Wall Thickness (mm) <input type="number" id="vp-wall" value="12" min="2" step="0.5"></label>
      <label class="opt">Outer Margin (mm) <input type="number" id="vp-margin" value="20" min="0" step="1"></label>
      <label class="opt">Random Seed <input type="number" id="vp-seed" value="1" min="1" step="1"></label>
    </div><div class="cnc-status" data-guide="main"></div></div><div class="modal-actions"><button class="btn" id="${ID}-cancel">Cancel</button><button class="btn primary" id="${ID}-ok">Create</button></div></div></div>`,
    open(api, params) {
      if (params) {
        if (params.w != null) el('vp-w').value = params.w;
        if (params.h != null) el('vp-h').value = params.h;
        if (params.topCell != null) el('vp-top').value = params.topCell;
        if (params.botCell != null) el('vp-bot').value = params.botCell;
        if (params.wall != null) el('vp-wall').value = params.wall;
        if (params.margin != null) el('vp-margin').value = params.margin;
        if (params.seed != null) el('vp-seed').value = params.seed;
      }
      const ok = el(ID + '-ok');
      if (ok) ok.focus();
    },
    apply(api) {
      const w = +el('vp-w').value;
      const h = +el('vp-h').value;
      const topCell = +el('vp-top').value;
      const botCell = +el('vp-bot').value;
      const wall = +el('vp-wall').value;
      const margin = +el('vp-margin').value;
      const seed = Math.max(1, Math.floor(+el('vp-seed').value || 1));

      if (!(w >= 50 && h >= 50 && topCell >= 10 && botCell >= 10 && wall >= 2 && margin >= 0)) {
        api.toast('Parameter tidak valid');
        return;
      }
      NS.close(ID);

      const sel = api.selectedEntities();
      const prev = sel.find(e => e.type === 'art' && e.gen && e.gen.kind === ID);
      const sb = api.selectionBounds();

      const greenLines = [];
      const greenCircles = [];
      const containerEnts = [];
      for (const e of sel) {
        if (prev && e.id === prev.id) continue;
        const col = (api.colorOf(e) || '').toLowerCase();
        if (col === '#00ff00') {
          if (e.type === 'line') {
            const pa = api.P(e.a), pb = api.P(e.b);
            if (pa && pb) greenLines.push({ a: pa, b: pb });
          } else if (e.type === 'circle') {
            const pc = api.P(e.c);
            if (pc) greenCircles.push({ x: pc.x, y: pc.y });
          }
        } else {
          containerEnts.push(e);
        }
      }

      // Work area = selected object itself. Baked closed contours first;
      // selectionBounds() is the guaranteed fallback — never modal WxH when a selection exists.
      let workRings = [];
      if (containerEnts.length > 0) {
        const baked = api.bakeContours(containerEnts, { joinTol: 0.1 });
        for (const ct of (baked && baked.contours) || []) {
          const pts = closedPts(api, ct);
          if (pts) workRings.push(pts);
        }
      }
      if (workRings.length === 0 && (containerEnts.length > 0 || sb)) {
        const ids = containerEnts.map(e => e.id);
        const box = (ids.length ? api.boundsOf(ids) : null) || sb;
        if (box && box.maxX > box.minX && box.maxY > box.minY) {
          workRings = [rectPts(
            (box.minX + box.maxX) / 2,
            (box.minY + box.maxY) / 2,
            box.maxX - box.minX,
            box.maxY - box.minY
          )];
        }
      }
      if (workRings.length === 0) {
        const c = api.s2w(api.getW() / 2, api.getH() / 2);
        workRings = [rectPts(c.x, c.y, w, h)];
      }

      // Panel = work area inset by Outer Margin; cells live inside the panel.
      let panelRings = workRings;
      if (margin > 0) {
        const off = api.offsetClosedChains(
          workRings.map(pts => ({ pts, closed: true })),
          -margin,
          { join: 'miter', miterLimit: 2, arcTol: 0.1 }
        );
        panelRings = (off || []).map(r => r.pts).filter(pts => pts && pts.length >= 3);
        if (panelRings.length === 0) {
          api.toast('Margin terlalu besar untuk objek');
          return;
        }
      }

      const bbox = bboxOf(panelRings);

      let getT;
      if (greenCircles.length > 0) {
        const corners = [
          { x: bbox.minX, y: bbox.minY }, { x: bbox.maxX, y: bbox.minY },
          { x: bbox.maxX, y: bbox.maxY }, { x: bbox.minX, y: bbox.maxY }
        ];
        let maxD = 1;
        for (const c of corners) {
          let dMin = Infinity;
          for (const gc of greenCircles) {
            const d = Math.hypot(c.x - gc.x, c.y - gc.y);
            if (d < dMin) dMin = d;
          }
          if (dMin > maxD) maxD = dMin;
        }
        getT = (x, y) => {
          let dMin = Infinity;
          for (const gc of greenCircles) {
            const d = Math.hypot(x - gc.x, y - gc.y);
            if (d < dMin) dMin = d;
          }
          return api.clamp(dMin / maxD, 0, 1);
        };
      } else if (greenLines.length > 0) {
        const gl = greenLines[0];
        const dx = gl.b.x - gl.a.x, dy = gl.b.y - gl.a.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        let minP = Infinity, maxP = -Infinity;
        for (const r of panelRings) for (const p of r) {
          const pr = p.x * ux + p.y * uy;
          if (pr < minP) minP = pr;
          if (pr > maxP) maxP = pr;
        }
        const spanP = Math.max(1e-6, maxP - minP);
        getT = (x, y) => api.clamp(((x * ux + y * uy) - minP) / spanP, 0, 1);
      } else {
        const spanY = Math.max(1e-6, bbox.maxY - bbox.minY);
        getT = (x, y) => api.clamp((y - bbox.minY) / spanY, 0, 1);
      }

      const rng = mulberry32(seed);
      const seeds = [];
      const minCell = Math.min(topCell, botCell);
      const areaApprox = (bbox.maxX - bbox.minX) * (bbox.maxY - bbox.minY);
      const maxSeeds = Math.min(800, Math.ceil(areaApprox / (minCell * minCell * 0.5)) + 50);
      const maxAttempts = maxSeeds * 25;

      for (let att = 0; att < maxAttempts && seeds.length < maxSeeds; att++) {
        const x = bbox.minX + rng() * (bbox.maxX - bbox.minX);
        const y = bbox.minY + rng() * (bbox.maxY - bbox.minY);
        if (!pointInRings(api, { x, y }, panelRings)) continue;
        const t = getT(x, y);
        const targetR = (topCell + t * (botCell - topCell)) * 0.85;
        let ok = true;
        for (const s of seeds) {
          const minR = Math.min(targetR, s.r);
          const dx = x - s.x, dy = y - s.y;
          if (dx * dx + dy * dy < minR * minR) { ok = false; break; }
        }
        if (ok) seeds.push({ x, y, r: targetR });
      }

      if (seeds.length < 3) {
        api.toast('Area terlalu kecil untuk ukuran sel');
        return;
      }

      const rawCells = computeVoronoiCells(seeds, bbox);
      const halfWall = wall * 0.5;
      const insetCells = [];
      for (const cell of rawCells) {
        const off = api.offsetClosedChains(
          [{ pts: normRing(api, cell), closed: true }],
          -halfWall,
          { join: 'round', arcTol: 0.2 }
        );
        for (const r of off || []) {
          if (r.pts && r.pts.length >= 3) insetCells.push(normRing(api, r.pts));
        }
      }

      if (insetCells.length === 0) {
        api.toast('Wall terlalu besar untuk sel');
        return;
      }
      const finalHoles = api.polyBoolOp(
        'intersection',
        insetCells,
        panelRings.map(r => normRing(api, r))
      ) || [];
      if (finalHoles.length === 0) {
        api.toast('Voronoi tidak berpotongan dengan panel');
        return;
      }

      api.pushHistory();
      if (prev) api.removeEntity(prev.id);

      const madeIds = [];
      for (const r of panelRings) {
        const id = api.addPanelEntity(r, '#000000');
        if (id) madeIds.push(id);
      }
      for (const hPts of finalHoles) {
        if (hPts && hPts.length >= 3) {
          const id = api.addPanelEntity(hPts, '#000000');
          if (id) madeIds.push(id);
        }
      }

      api.commit();
      if (!madeIds.length) return;

      api.ui.selection = madeIds.map(id => ({ kind: 'entity', id }));
      api.cmdGroupSelection({ noHistory: true });
      const wrap = api.ui.selection.length === 1 ? api.state.entities[api.ui.selection[0].id] : null;
      if (wrap && wrap.type === 'art') {
        wrap.gen = { kind: ID, params: { w, h, topCell, botCell, wall, margin, seed } };
        wrap.name = `Voronoi ${api.fmt(bbox.maxX - bbox.minX)}x${api.fmt(bbox.maxY - bbox.minY)}`;
        api.commit();
      }
      api.toast(`Voronoi dibuat (${finalHoles.length} sel)`);
    }
  });
})();