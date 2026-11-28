// saved by MiniSketch (server disk) — id: penrose-panel
// label: Penrose
(() => {
  'use strict';
  const NS = window.MiniSketchTools;
  const ID = 'penrose-panel';
  const el = (id) => document.getElementById(id);

  const PHI = (1 + Math.sqrt(5)) / 2;

  function mulberry32(seed) {
    let a = (seed | 0) || 1;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function polyArea(pts) {
    let a = 0;
    for (let i = 0, n = pts.length; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      a += p.x * q.y - q.x * p.y;
    }
    return Math.abs(a) * 0.5;
  }

  function polyCentroid(pts) {
    let x = 0, y = 0;
    for (const p of pts) { x += p.x; y += p.y; }
    const n = pts.length || 1;
    return { x: x / n, y: y / n };
  }

  function insetConvexPoly(pts, d) {
    const n = pts.length;
    if (n < 3) return null;
    let area2 = 0;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      area2 += p.x * q.y - q.x * p.y;
    }
    const ordered = area2 >= 0 ? pts : pts.slice().reverse();
    const lines = [];
    for (let i = 0; i < n; i++) {
      const a = ordered[i], b = ordered[(i + 1) % n];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) return null;
      const nx = -dy / len, ny = dx / len;
      lines.push({
        x1: a.x + nx * d, y1: a.y + ny * d,
        x2: b.x + nx * d, y2: b.y + ny * d
      });
    }
    const out = [];
    for (let i = 0; i < n; i++) {
      const l1 = lines[(i - 1 + n) % n], l2 = lines[i];
      const a1 = l1.y2 - l1.y1, b1 = l1.x1 - l1.x2, c1 = a1 * l1.x1 + b1 * l1.y1;
      const a2 = l2.y2 - l2.y1, b2 = l2.x1 - l2.x2, c2 = a2 * l2.x1 + b2 * l2.y1;
      const det = a1 * b2 - a2 * b1;
      if (Math.abs(det) < 1e-7) return null;
      out.push({ x: (b2 * c1 - b1 * c2) / det, y: (a1 * c2 - a2 * c1) / det });
    }
    return polyArea(out) > 1e-3 ? out : null;
  }

  function generatePenroseRhombi(cx, cy, maxR, moduleSize, rotDeg) {
    let k = Math.ceil(Math.log(Math.max(1.5, (maxR * 1.15) / moduleSize)) / Math.log(PHI));
    k = Math.max(1, Math.min(8, k));
    const r0 = moduleSize * Math.pow(PHI, k);

    let tris = [];
    for (let i = 0; i < 10; i++) {
      const a1 = (i * 36 * Math.PI) / 180;
      const a2 = ((i + 1) * 36 * Math.PI) / 180;
      const B = { x: r0 * Math.cos(a1), y: r0 * Math.sin(a1) };
      const C = { x: r0 * Math.cos(a2), y: r0 * Math.sin(a2) };
      const A = { x: 0, y: 0 };
      if (i % 2 === 0) tris.push({ t: 0, A, B, C });
      else tris.push({ t: 0, A, B: C, C: B });
    }

    for (let step = 0; step < k; step++) {
      const next = [];
      for (const tr of tris) {
        const { t, A, B, C } = tr;
        if (t === 0) {
          const P = { x: A.x + (B.x - A.x) / PHI, y: A.y + (B.y - A.y) / PHI };
          next.push({ t: 0, A: C, B: P, C: B });
          next.push({ t: 1, A: P, B: C, C: A });
        } else {
          const Q = { x: B.x + (A.x - B.x) / PHI, y: B.y + (A.y - B.y) / PHI };
          const R = { x: B.x + (C.x - B.x) / PHI, y: B.y + (C.y - B.y) / PHI };
          next.push({ t: 1, A: R, B: C, C: A });
          next.push({ t: 1, A: Q, B: R, C: B });
          next.push({ t: 0, A: R, B: Q, C: A });
        }
      }
      tris = next;
    }

    const rad = (rotDeg * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const xf = (p) => ({
      x: cx + p.x * cos - p.y * sin,
      y: cy + p.x * sin + p.y * cos
    });

    const pairs = new Map();
    const rhombi = [];
    for (const tr of tris) {
      const mx = Math.round(((tr.B.x + tr.C.x) * 0.5) * 100);
      const my = Math.round(((tr.B.y + tr.C.y) * 0.5) * 100);
      const key = tr.t + ':' + mx + ',' + my;
      const prev = pairs.get(key);
      if (prev) {
        pairs.delete(key);
        const pts = [xf(prev.A), xf(prev.B), xf(tr.A), xf(prev.C)];
        const c = polyCentroid(pts);
        if (Math.hypot(c.x - cx, c.y - cy) <= maxR + moduleSize) {
          rhombi.push(pts);
        }
      } else {
        pairs.set(key, tr);
      }
    }
    return rhombi;
  }

  MiniSketchTools.register({
    id: ID,
    label: 'Penrose',
    title: 'Parametric Penrose Tiling (Quasicrystal) Panel',
    version: '1.0.0',
    author: 'AI Builder',
    category: 'Signage & Art',
    description: 'Generates a CNC-ready Penrose quasicrystal perforated panel with green guide alignment and focal-point circles.',
    icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><polygon points="8,1 14,5 12,13 4,13 2,5"/><polygon points="8,1 11,6 8,10 5,6"/></svg>',
    modalId: ID + '-modal',
    guide: {
      en: { main: 'Creates Penrose rhombus cutouts (#000000). Select a shape as container, green line (#00ff00) for axis & density gradient, and green circles (#00ff00) for solid focal points.' },
      id: { main: 'Membuat lubang pola Penrose (#000000). Pilih objek sebagai wadah, garis hijau (#00ff00) untuk arah & gradasi kepadatan, dan lingkaran hijau (#00ff00) untuk area solid.' }
    },
    modal: `<div id="${ID}-modal" class="modal hidden"><div class="modal-box wide-cols"><h3>Penrose Tiling Panel</h3><div class="modal-cols"><div class="opt-col">
      <label class="opt">Width (mm) <input type="number" id="pp-w" value="1220" min="50"></label>
      <label class="opt">Height (mm) <input type="number" id="pp-h" value="2440" min="50"></label>
      <label class="opt">Module Side (mm) <input type="number" id="pp-mod" value="100" min="15" max="500"></label>
      <label class="opt">Wall Thickness (mm) <input type="number" id="pp-wall" value="12" min="1"></label>
      <label class="opt">Open Ratio (%) <input type="number" id="pp-ratio" value="100" min="0" max="100"></label>
      <label class="opt">Outer Margin (mm) <input type="number" id="pp-margin" value="20" min="0"></label>
      <label class="opt">Rotation (deg) <input type="number" id="pp-rot" value="0"></label>
      <label class="opt">Random Seed <input type="number" id="pp-seed" value="1" min="1"></label>
    </div><div class="cnc-status" data-guide="main"></div></div><div class="modal-actions"><button class="btn" id="${ID}-cancel">Cancel</button><button class="btn primary" id="${ID}-ok">Create</button></div></div></div>`,
    open(api, params) {
      if (params) {
        if (params.w != null) el('pp-w').value = params.w;
        if (params.h != null) el('pp-h').value = params.h;
        if (params.mod != null) el('pp-mod').value = params.mod;
        if (params.wall != null) el('pp-wall').value = params.wall;
        if (params.ratio != null) el('pp-ratio').value = params.ratio;
        if (params.margin != null) el('pp-margin').value = params.margin;
        if (params.rot != null) el('pp-rot').value = params.rot;
        if (params.seed != null) el('pp-seed').value = params.seed;
      }
      const ok = el(ID + '-ok');
      if (ok) ok.focus();
    },
    apply(api) {
      let w = +el('pp-w').value;
      let h = +el('pp-h').value;
      const mod = +el('pp-mod').value;
      const wall = +el('pp-wall').value;
      const ratio = api.clamp(+el('pp-ratio').value, 0, 100);
      const margin = Math.max(0, +el('pp-margin').value);
      const rot = +el('pp-rot').value || 0;
      const seed = Math.max(1, Math.round(+el('pp-seed').value || 1));

      if (!(w >= 50 && h >= 50 && mod >= 15 && wall >= 1)) {
        api.toast('Penrose: invalid dimensions');
        return;
      }
      NS.close(ID);

      const sel = api.selectedEntities();
      const prev = sel.find(e => e.type === 'art' && e.gen && e.gen.kind === ID);
      const others = sel.filter(e => e !== prev);

      let greenLine = null;
      const greenCircles = [];
      const containerEnts = [];

      for (const e of others) {
        const col = (api.colorOf(e) || '').toLowerCase();
        if (col === '#00ff00') {
          if (e.type === 'line' && !greenLine) {
            const p1 = api.P(e.a), p2 = api.P(e.b);
            if (p1 && p2) greenLine = { p1, p2 };
          } else if (e.type === 'circle') {
            const c = api.P(e.c);
            if (c && e.r > 0) greenCircles.push({ x: c.x, y: c.y, r: e.r });
          }
        } else {
          containerEnts.push(e);
        }
      }

      const sb = api.selectionBounds();
      const hasSel = !!sb && (sb.maxX - sb.minX > 1e-6 || sb.maxY - sb.minY > 1e-6);
      const boxPts = (b) => [
        { x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY },
        { x: b.maxX, y: b.maxY }, { x: b.minX, y: b.maxY }
      ];

      let outerRings = [];
      let useDefaultFrame = false;
      if (containerEnts.length > 0) {
        const baked = api.bakeContours(containerEnts, { joinTol: 0.1 });
        for (const ct of (baked && baked.contours) || []) {
          if (ct.closed && ct.pts && ct.pts.length >= 3) outerRings.push(ct.pts);
        }
        if (outerRings.length === 0) {
          if (!hasSel) { api.toast('Penrose: container has no closed outline'); return; }
          outerRings = [boxPts(sb)];
        }
      } else if (hasSel && !greenLine && greenCircles.length === 0) {
        outerRings = [boxPts(sb)];
      }

      if (outerRings.length === 0) {
        useDefaultFrame = true;
        let c = api.s2w(api.getW() / 2, api.getH() / 2);
        if (prev) {
          const pw = api.P(prev.pw), ph = api.P(prev.ph);
          if (pw && ph) c = { x: (pw.x + ph.x) / 2, y: (pw.y + ph.y) / 2 };
        }
        outerRings = [[
          { x: c.x - w / 2, y: c.y - h / 2 },
          { x: c.x + w / 2, y: c.y - h / 2 },
          { x: c.x + w / 2, y: c.y + h / 2 },
          { x: c.x - w / 2, y: c.y + h / 2 }
        ]];
      }

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const ring of outerRings) {
        for (const p of ring) {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
      }
      if (!useDefaultFrame) {
        w = maxX - minX;
        h = maxY - minY;
      }
      const cx = (minX + maxX) * 0.5;
      const cy = (minY + maxY) * 0.5;
      const maxR = Math.hypot(maxX - minX, maxY - minY) * 0.5;

      let innerRings = outerRings;
      if (margin > 0) {
        const off = api.offsetClosedChains(
          outerRings.map(pts => ({ pts, closed: true })),
          -margin,
          { join: 'miter', miterLimit: 2 }
        );
        innerRings = (off || []).map(r => r.pts).filter(pts => pts && pts.length >= 3);
      }
      if (innerRings.length === 0) {
        api.toast('Penrose: margin too large for container');
        return;
      }

      let tx = cx, ty = cy, tR = maxR;
      if (innerRings !== outerRings) {
        let iMinX = Infinity, iMinY = Infinity, iMaxX = -Infinity, iMaxY = -Infinity;
        for (const ring of innerRings) {
          for (const p of ring) {
            if (p.x < iMinX) iMinX = p.x;
            if (p.y < iMinY) iMinY = p.y;
            if (p.x > iMaxX) iMaxX = p.x;
            if (p.y > iMaxY) iMaxY = p.y;
          }
        }
        if (isFinite(iMinX)) {
          tx = (iMinX + iMaxX) * 0.5;
          ty = (iMinY + iMaxY) * 0.5;
          tR = Math.hypot(iMaxX - iMinX, iMaxY - iMinY) * 0.5;
        }
      }

      let finalRot = rot;
      let lineDir = null, lineLen = 0;
      if (greenLine) {
        const dx = greenLine.p2.x - greenLine.p1.x;
        const dy = greenLine.p2.y - greenLine.p1.y;
        lineLen = Math.hypot(dx, dy);
        if (lineLen > 1e-3) {
          finalRot = (Math.atan2(dy, dx) * 180) / Math.PI + rot;
          lineDir = { x: dx / lineLen, y: dy / lineLen };
        }
      }

      const rhombi = generatePenroseRhombi(tx, ty, tR, mod, finalRot);
      const rng = mulberry32(seed);
      const minSafeArea = Math.max(16, wall * wall * 0.6);
      const halfWall = wall * 0.5;
      const holes = [];

      for (const rh of rhombi) {
        const cent = polyCentroid(rh);

        let inCircle = false;
        for (const gc of greenCircles) {
          if (Math.hypot(cent.x - gc.x, cent.y - gc.y) <= gc.r + halfWall) {
            inCircle = true;
            break;
          }
        }
        if (inCircle) continue;

        let prob = ratio / 100;
        if (lineDir && lineLen > 1e-3) {
          const proj = (cent.x - greenLine.p1.x) * lineDir.x + (cent.y - greenLine.p1.y) * lineDir.y;
          const t = api.clamp(proj / lineLen, 0, 1);
          prob = prob * (1 - 0.85 * t);
        }
        if (rng() > prob) continue;

        const inset = insetConvexPoly(rh, halfWall);
        if (!inset) continue;

        const clipped = api.polyBoolOp('intersection', [inset], innerRings);
        for (const poly of clipped || []) {
          if (poly.length >= 3 && polyArea(poly) >= minSafeArea) {
            holes.push(poly);
          }
        }
      }

      api.pushHistory();
      if (prev) api.removeEntity(prev.id);

      const madeIds = [];
      if (useDefaultFrame) {
        for (const ring of outerRings) {
          const id = api.addPanelEntity(ring, '#000000');
          if (id) madeIds.push(id);
        }
      }
      for (const poly of holes) {
        const id = api.addPanelEntity(poly, '#000000');
        if (id) madeIds.push(id);
      }

      api.commit();
      if (!madeIds.length) {
        api.toast('Penrose: no valid tiles generated');
        return;
      }

      api.ui.selection = madeIds.map(id => ({ kind: 'entity', id }));
      api.cmdGroupSelection({ noHistory: true });
      const wrap = api.ui.selection.length === 1 ? api.state.entities[api.ui.selection[0].id] : null;
      if (wrap && wrap.type === 'art') {
        wrap.gen = { kind: ID, params: { w, h, mod, wall, ratio, margin, rot, seed } };
        wrap.name = 'Penrose ' + api.fmt(mod) + 'mm';
        api.commit();
      }
      api.toast('Penrose panel created (' + holes.length + ' tiles)');
    }
  });
})();