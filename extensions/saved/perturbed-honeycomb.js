// saved by MiniSketch (server disk) — id: perturbed-honeycomb
// label: Honeycomb
(() => {
  'use strict';
  const NS = window.MiniSketchTools;
  const ID = 'perturbed-honeycomb';
  const el = (id) => document.getElementById(id);

  function mulberry32(seed) {
    let a = (seed | 0) >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rectPts(cx, cy, w, h) {
    const hw = w / 2, hh = h / 2;
    return [
      { x: cx - hw, y: cy - hh },
      { x: cx + hw, y: cy - hh },
      { x: cx + hw, y: cy + hh },
      { x: cx - hw, y: cy + hh }
    ];
  }

  function clipHalfPlane(poly, mx, my, nx, ny) {
    if (!poly.length) return poly;
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const da = (a.x - mx) * nx + (a.y - my) * ny;
      const db = (b.x - mx) * nx + (b.y - my) * ny;
      if (da <= 0) {
        out.push(a);
        if (db > 0) {
          const t = da / (da - db);
          out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        }
      } else if (db <= 0) {
        const t = da / (da - db);
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    return out;
  }

  function polyAreaAbs(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      a += p.x * q.y - q.x * p.y;
    }
    return Math.abs(a) * 0.5;
  }

  function buildHoneycomb(api, params, containerRings, greenLines, greenCircles, bbox) {
    const { radTop, radBot, strength, wall, fillet, seed } = params;
    const rng = mulberry32(seed);
    const str = api.clamp(strength, 0, 80) / 100;
    const maxR = Math.max(radTop, radBot);
    const minR = Math.min(radTop, radBot);
    const spanY = Math.max(1e-3, bbox.maxY - bbox.minY);

    const pad = maxR * 2.5;
    const minX = bbox.minX - pad, maxX = bbox.maxX + pad;
    const minY = bbox.minY - pad, maxY = bbox.maxY + pad;

    const seeds = [];
    let row = 0;
    let y = minY;
    while (y <= maxY) {
      const tY = api.clamp((y - bbox.minY) / spanY, 0, 1);
      const rowR = radTop + (radBot - radTop) * tY;
      const dx = Math.sqrt(3) * rowR;
      const dy = 1.5 * rowR;
      const xOff = (row % 2) * (dx * 0.5);

      for (let x = minX + xOff; x <= maxX; x += dx) {
        let localR = rowR;
        if (greenLines.length > 0) {
          const ln = greenLines[0];
          const vx = ln.b.x - ln.a.x, vy = ln.b.y - ln.a.y;
          const lenSq = vx * vx + vy * vy;
          if (lenSq > 1e-6) {
            const tL = api.clamp(((x - ln.a.x) * vx + (y - ln.a.y) * vy) / lenSq, 0, 1);
            localR = radTop + (radBot - radTop) * tL;
          }
        }

        let px = x + (rng() * 2 - 1) * localR * 0.45 * str;
        let py = y + (rng() * 2 - 1) * localR * 0.45 * str;

        for (const ln of greenLines) {
          const vx = ln.b.x - ln.a.x, vy = ln.b.y - ln.a.y;
          const lenSq = vx * vx + vy * vy;
          if (lenSq < 1e-6) continue;
          const len = Math.sqrt(lenSq);
          const ux = vx / len, uy = vy / len;
          const t = api.clamp(((px - ln.a.x) * vx + (py - ln.a.y) * vy) / lenSq, 0, 1);
          const pull = (t - 0.5) * localR * 0.6 * (0.3 + str);
          px += ux * pull;
          py += uy * pull;
        }

        for (const cc of greenCircles) {
          const rx = px - cc.x, ry = py - cc.y;
          const d = Math.hypot(rx, ry);
          const influence = Math.max(cc.r * 2.2, maxR * 3.5);
          if (d > 1e-3 && d < influence) {
            const k = (1 - d / influence);
            const push = k * k * localR * 0.85;
            px += (rx / d) * push;
            py += (ry / d) * push;
          }
        }

        seeds.push({ x: px, y: py, r: localR });
      }
      y += Math.max(minR * 0.8, dy);
      row++;
    }

    const searchR = maxR * 3.5;
    const insetAmt = wall * 0.5 + fillet;
    const made = [];

    for (let i = 0; i < seeds.length; i++) {
      const s = seeds[i];
      if (s.x < bbox.minX - maxR * 1.2 || s.x > bbox.maxX + maxR * 1.2 ||
          s.y < bbox.minY - maxR * 1.2 || s.y > bbox.maxY + maxR * 1.2) continue;

      let cell = rectPts(s.x, s.y, maxR * 4, maxR * 4);
      for (let j = 0; j < seeds.length; j++) {
        if (i === j) continue;
        const o = seeds[j];
        const vx = o.x - s.x, vy = o.y - s.y;
        if (Math.abs(vx) > searchR || Math.abs(vy) > searchR) continue;
        const d = Math.hypot(vx, vy);
        if (d < 1e-4 || d > searchR) continue;
        cell = clipHalfPlane(cell, (s.x + o.x) * 0.5, (s.y + o.y) * 0.5, vx / d, vy / d);
        if (cell.length < 3) break;
      }
      if (cell.length < 3 || polyAreaAbs(cell) < 4) continue;

      let inner = api.offsetClosedChains([{ pts: cell, closed: true }], -insetAmt, {
        join: 'miter', miterLimit: 4, arcTol: 0.2
      });
      if (!inner || !inner.length) continue;

      if (fillet > 0.05) {
        inner = api.offsetClosedChains(inner, fillet, { join: 'round', arcTol: 0.15 });
        if (!inner || !inner.length) continue;
      }

      for (const r of inner) {
        if (!r.pts || r.pts.length < 3) continue;
        const clipped = api.polyBoolOp('intersection', [r.pts], containerRings);
        for (const cp of clipped || []) {
          if (cp && cp.length >= 3 && polyAreaAbs(cp) > 2) {
            const id = api.addPanelEntity(cp, '#000000');
            if (id) made.push(id);
          }
        }
      }
    }
    return made;
  }

  MiniSketchTools.register({
    id: ID,
    label: 'Honeycomb',
    title: 'Perturbed Honeycomb Panel',
    version: '1.1.0',
    author: 'AI Builder',
    category: 'Signage & Art',
    description: 'Membuat panel sarang lebah terdistorsi dengan gradasi ukuran atas-bawah, sekat, fillet sudut, serta dukungan garis & lingkaran hijau.',
    icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><polygon points="8,1.5 13,4.5 13,10.5 8,13.5 3,10.5 3,4.5"/><circle cx="8" cy="7.5" r="1.5"/></svg>',
    modalId: ID + '-modal',
    modal: `<div id="${ID}-modal" class="modal hidden"><div class="modal-box wide-cols"><h3>Perturbed Honeycomb</h3><div class="modal-cols"><div class="opt-col">
      <label class="opt">Width (mm) <input type="number" id="ph-w" value="1220" min="20" step="10"></label>
      <label class="opt">Height (mm) <input type="number" id="ph-h" value="2440" min="20" step="10"></label>
      <label class="opt">Top Radius (mm) <input type="number" id="ph-rad-top" value="45" min="5" step="1"></label>
      <label class="opt">Bottom Radius (mm) <input type="number" id="ph-rad-bot" value="25" min="5" step="1"></label>
      <label class="opt">Perturbation (%) <input type="number" id="ph-str" value="25" min="0" max="80" step="5"></label>
      <label class="opt">Wall Thickness (mm) <input type="number" id="ph-wall" value="12" min="1" step="0.5"></label>
      <label class="opt">Corner Fillet (mm) <input type="number" id="ph-fillet" value="3" min="0" step="0.5"></label>
      <label class="opt">Outer Margin (mm) <input type="number" id="ph-margin" value="20" min="0" step="1"></label>
      <label class="opt">Random Seed <input type="number" id="ph-seed" value="1234" step="1"></label>
    </div><div class="cnc-status" data-guide="main">Gradasi ukuran sel dari Top Radius ke Bottom Radius (#000000). Seleksi wadah, garis hijau (#00ff00) untuk sumbu gradasi, atau lingkaran hijau untuk attractor.</div></div><div class="modal-actions"><button class="btn" id="${ID}-cancel">Cancel</button><button class="btn primary" id="${ID}-ok">Create</button></div></div></div>`,
    guide: {
      en: { main: 'Size gradation from Top Radius to Bottom Radius (#000000). Select container shape, green line (#00ff00) for gradation axis, or green circles for attractors.' },
      id: { main: 'Gradasi ukuran sel dari Top Radius ke Bottom Radius (#000000). Seleksi wadah, garis hijau (#00ff00) untuk sumbu gradasi, atau lingkaran hijau untuk attractor.' }
    },
    open(api, params) {
      if (params) {
        if (params.w != null) el('ph-w').value = params.w;
        if (params.h != null) el('ph-h').value = params.h;
        if (params.radTop != null) el('ph-rad-top').value = params.radTop;
        if (params.radBot != null) el('ph-rad-bot').value = params.radBot;
        if (params.strength != null) el('ph-str').value = params.strength;
        if (params.wall != null) el('ph-wall').value = params.wall;
        if (params.fillet != null) el('ph-fillet').value = params.fillet;
        if (params.margin != null) el('ph-margin').value = params.margin;
        if (params.seed != null) el('ph-seed').value = params.seed;
      }
      const ok = el(ID + '-ok');
      if (ok) ok.focus();
    },
    apply(api) {
      let w = +el('ph-w').value;
      let h = +el('ph-h').value;
      const radTop = +el('ph-rad-top').value;
      const radBot = +el('ph-rad-bot').value;
      const strength = +el('ph-str').value;
      const wall = +el('ph-wall').value;
      const fillet = +el('ph-fillet').value;
      const margin = +el('ph-margin').value;
      const seed = +el('ph-seed').value || 1;

      if (!(radTop >= 5 && radBot >= 5)) { api.toast('Top/Bottom radius minimal 5 mm'); return; }
      if (!(wall >= 1)) { api.toast('Wall thickness minimal 1 mm'); return; }
      if (strength < 0 || strength > 80) { api.toast('Perturbation harus 0% - 80%'); return; }

      const sel = api.selectedEntities();
      const prev = sel.find(e => e.type === 'art' && e.gen && e.gen.kind === ID);

      const greenLines = [];
      const greenCircles = [];
      const containerEnts = [];

      for (const e of sel) {
        if (prev && e.id === prev.id) continue;
        const col = (api.colorOf(e) || '').toLowerCase();
        if (col === '#00ff00') {
          if (e.type === 'line') {
            const a = api.P(e.a), b = api.P(e.b);
            if (a && b) greenLines.push({ a, b });
          } else if (e.type === 'circle') {
            const c = api.P(e.c);
            if (c) greenCircles.push({ x: c.x, y: c.y, r: e.r || radTop });
          }
        } else {
          containerEnts.push(e);
        }
      }

      const sb = api.selectionBounds();
      const hasContainer = containerEnts.length > 0 ||
        (!!sb && !prev && greenLines.length === 0 && greenCircles.length === 0);
      const box = containerEnts.length
        ? (api.boundsOf(containerEnts.map(e => e.id)) || sb)
        : ((hasContainer || prev) ? sb : null);

      let center = api.s2w(api.getW() / 2, api.getH() / 2);
      if (prev) {
        const pw = api.P(prev.pw), ph = api.P(prev.ph);
        if (pw && ph) center = { x: (pw.x + ph.x) / 2, y: (pw.y + ph.y) / 2 };
      }
      if (containerEnts.length || hasContainer) {
        if (box) center = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
      }
      if (box) { w = box.maxX - box.minX; h = box.maxY - box.minY; }

      if (!(w >= 20 && h >= 20)) { api.toast('Width/Height minimal 20 mm'); return; }

      NS.close(ID);

      let outerFrame = null;
      let containerChains = [];
      if (containerEnts.length > 0) {
        const baked = api.bakeContours(containerEnts, { joinTol: 0.1 });
        for (const ct of (baked && baked.contours) || []) {
          if (ct.closed && ct.pts && ct.pts.length >= 3) {
            containerChains.push({ pts: ct.pts, closed: true });
          }
        }
      }
      if (!containerChains.length) {
        const r = rectPts(center.x, center.y, w, h);
        if (!hasContainer) outerFrame = r;
        containerChains = [{ pts: r, closed: true }];
      }

      const insetContainers = margin > 0
        ? api.offsetClosedChains(containerChains, -margin, { join: 'miter', miterLimit: 4, arcTol: 0.2 })
        : containerChains;

      if (!insetContainers || !insetContainers.length) {
        api.toast('Margin terlalu besar untuk wadah');
        return;
      }

      const containerRings = insetContainers.map(c => c.pts);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const ring of containerRings) {
        for (const p of ring) {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
      }

      api.pushHistory();
      if (prev) api.removeEntity(prev.id);

      const madeIds = [];
      if (outerFrame) {
        const fid = api.addPanelEntity(outerFrame, '#000000');
        if (fid) madeIds.push(fid);
      }

      const cellIds = buildHoneycomb(
        api,
        { radTop, radBot, strength, wall, fillet, seed },
        containerRings,
        greenLines,
        greenCircles,
        { minX, minY, maxX, maxY }
      );
      for (const id of cellIds) madeIds.push(id);

      api.commit();
      if (!madeIds.length) { api.toast('Tidak ada sel yang dihasilkan'); return; }

      api.ui.selection = madeIds.map(id => ({ kind: 'entity', id }));
      api.cmdGroupSelection({ noHistory: true });
      const wrap = api.ui.selection.length === 1 ? api.state.entities[api.ui.selection[0].id] : null;
      if (wrap && wrap.type === 'art') {
        wrap.gen = { kind: ID, params: { w, h, radTop, radBot, strength, wall, fillet, margin, seed } };
        wrap.name = `Honeycomb ${api.fmt(radTop)}-${api.fmt(radBot)} (${cellIds.length})`;
        api.commit();
      }
      api.toast(`Honeycomb dibuat (${cellIds.length} sel)`);
    }
  });
})();