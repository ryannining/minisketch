// saved by MiniSketch (server disk) — id: mashrabiya
// label: Mashrabiya
(() => {
  'use strict';
  const NS = window.MiniSketchTools;
  const ID = 'mashrabiya';
  const el = (id) => document.getElementById(id);

  function ptsBBox(pts) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY };
  }

  function cleanRing(pts, tol) {
    const out = [];
    const t2 = tol * tol;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (!out.length) { out.push({ x: p.x, y: p.y }); continue; }
      const prev = out[out.length - 1];
      const dx = p.x - prev.x, dy = p.y - prev.y;
      if (dx * dx + dy * dy > t2) out.push({ x: p.x, y: p.y });
    }
    while (out.length > 2) {
      const a = out[0], b = out[out.length - 1];
      const dx = a.x - b.x, dy = a.y - b.y;
      if (dx * dx + dy * dy <= t2) out.pop();
      else break;
    }
    return out;
  }

  function centroidOf(pts) {
    let sx = 0, sy = 0;
    for (let i = 0; i < pts.length; i++) { sx += pts[i].x; sy += pts[i].y; }
    const n = pts.length || 1;
    return { x: sx / n, y: sy / n };
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

  function bboxOverlapCheck(a, b) {
    return a.maxX >= b.minX && a.minX <= b.maxX && a.maxY >= b.minY && a.minY <= b.maxY;
  }

  function pointInRings(api, pt, rings) {
    let inside = false;
    for (let i = 0; i < rings.length; i++) {
      if (api.pointInPoly(pt, rings[i])) inside = !inside;
    }
    return inside;
  }

  function polar(cx, cy, r, deg) {
    const a = deg * Math.PI / 180;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  }

  function rotPt(cx, cy, lx, ly, deg) {
    const a = deg * Math.PI / 180;
    const c = Math.cos(a), s = Math.sin(a);
    return { x: cx + lx * c - ly * s, y: cy + lx * s + ly * c };
  }

  function buildCells(fold, pitch, cx0, cy0, areaBB) {
    const cells = [];
    const h = pitch / 2;
    const pad = pitch * 1.6;
    const xMin = areaBB.minX - pad, xMax = areaBB.maxX + pad;
    const yMin = areaBB.minY - pad, yMax = areaBB.maxY + pad;

    if (fold === 6) {
      const R = h / Math.cos(Math.PI / 6);
      const dy = pitch * Math.sqrt(3) / 2;
      const rVal = 0.28 * h, rTip = 0.50 * h, rMid = 0.80 * h;
      const rQ = R - rMid, rM = R / 2;
      const jLo = Math.floor((yMin - cy0) / dy) - 1;
      const jHi = Math.ceil((yMax - cy0) / dy) + 1;
      const iLo = Math.floor((xMin - cx0) / pitch) - 1;
      const iHi = Math.ceil((xMax - cx0) / pitch) + 1;

      for (let j = jLo; j <= jHi; j++) {
        const cy = cy0 + j * dy;
        const odd = ((j % 2) + 2) % 2;
        for (let i = iLo; i <= iHi; i++) {
          const cx = cx0 + (i + (odd ? 0.5 : 0)) * pitch;
          const star = [];
          for (let k = 0; k < 6; k++) {
            star.push(polar(cx, cy, rVal, k * 60));
            star.push(polar(cx, cy, rTip, (k + 0.5) * 60));
          }
          cells.push(star);
          for (let k = 0; k < 6; k++) {
            cells.push([
              polar(cx, cy, rVal, k * 60),
              polar(cx, cy, rTip, (k + 0.5) * 60),
              polar(cx, cy, rMid, (k + 0.5) * 60),
              polar(cx, cy, h, k * 60),
              polar(cx, cy, rMid, (k - 0.5) * 60),
              polar(cx, cy, rTip, (k - 0.5) * 60)
            ]);
          }
          const va = polar(cx, cy, R, 30);
          const triA = [];
          for (let m = 0; m < 3; m++) {
            triA.push(polar(va.x, va.y, rQ, 90 + m * 120));
            triA.push(polar(va.x, va.y, rM, 150 + m * 120));
          }
          cells.push(triA);
          const vb = polar(cx, cy, R, -30);
          const triB = [];
          for (let m = 0; m < 3; m++) {
            triB.push(polar(vb.x, vb.y, rQ, 30 + m * 120));
            triB.push(polar(vb.x, vb.y, rM, 90 + m * 120));
          }
          cells.push(triB);
        }
      }
    } else if (fold === 8) {
      const rVal = 0.28 * h, rTip = 0.50 * h, rMid = 0.78 * h;
      const rTip4 = h * (Math.SQRT2 - 1), rVal4 = 0.18 * h;
      const c225 = Math.cos(Math.PI / 8), s225 = Math.sin(Math.PI / 8);
      const qx = h - rMid * c225, qy = -h + rMid * s225;
      const m4 = rTip4 / Math.SQRT2;
      const jLo = Math.floor((yMin - cy0) / pitch) - 1;
      const jHi = Math.ceil((yMax - cy0) / pitch) + 1;
      const iLo = Math.floor((xMin - cx0) / pitch) - 1;
      const iHi = Math.ceil((xMax - cx0) / pitch) + 1;

      for (let j = jLo; j <= jHi; j++) {
        const cy = cy0 + j * pitch;
        for (let i = iLo; i <= iHi; i++) {
          const cx = cx0 + i * pitch;
          const star = [];
          for (let k = 0; k < 8; k++) {
            star.push(polar(cx, cy, rVal, k * 45));
            star.push(polar(cx, cy, rTip, (k + 0.5) * 45));
          }
          cells.push(star);
          for (let k = 0; k < 8; k++) {
            cells.push([
              polar(cx, cy, rVal, k * 45),
              polar(cx, cy, rTip, (k + 0.5) * 45),
              polar(cx, cy, rMid, (k + 0.5) * 45),
              polar(cx, cy, h, k * 45),
              polar(cx, cy, rMid, (k - 0.5) * 45),
              polar(cx, cy, rTip, (k - 0.5) * 45)
            ]);
          }
          const sx = cx + h, sy = cy + h;
          const star4 = [];
          for (let m = 0; m < 4; m++) {
            star4.push(polar(sx, sy, rVal4, m * 90));
            star4.push(polar(sx, sy, rTip4, m * 90 + 45));
          }
          cells.push(star4);
          const baseShield = [
            { x: 0, y: -h },
            { x: qx, y: qy },
            { x: m4, y: -m4 },
            { x: 0, y: -rVal4 },
            { x: -m4, y: -m4 },
            { x: -qx, y: qy }
          ];
          for (let d = 0; d < 4; d++) {
            cells.push(baseShield.map(p => rotPt(sx, sy, p.x, p.y, d * 90)));
          }
        }
      }
    } else if (fold === 10) {
      const dx = pitch * Math.cos(Math.PI / 5);
      const dy = pitch * Math.sin(Math.PI / 5);
      const rVal = 0.28 * h, rTip = 0.50 * h, rMid = 0.78 * h;
      const jLo = Math.floor((yMin - cy0) / dy) - 1;
      const jHi = Math.ceil((yMax - cy0) / dy) + 1;
      const iLo = Math.floor((xMin - cx0) / (2 * dx)) - 1;
      const iHi = Math.ceil((xMax - cx0) / (2 * dx)) + 1;

      for (let j = jLo; j <= jHi; j++) {
        const cy = cy0 + j * dy;
        const odd = ((j % 2) + 2) % 2;
        for (let i = iLo; i <= iHi; i++) {
          const cx = cx0 + (i * 2 + odd) * dx;
          const star = [];
          for (let k = 0; k < 10; k++) {
            star.push(polar(cx, cy, rVal, k * 36));
            star.push(polar(cx, cy, rTip, (k + 0.5) * 36));
          }
          cells.push(star);
          for (let k = 0; k < 10; k++) {
            cells.push([
              polar(cx, cy, rVal, k * 36),
              polar(cx, cy, rTip, (k + 0.5) * 36),
              polar(cx, cy, rMid, (k + 0.5) * 36),
              polar(cx, cy, h, k * 36),
              polar(cx, cy, rMid, (k - 0.5) * 36),
              polar(cx, cy, rTip, (k - 0.5) * 36)
            ]);
          }
          const bx = cx + dx, by = cy;
          cells.push([
            polar(cx, cy, h, 0),
            polar(cx, cy, rMid, -18),
            polar(cx, cy, h, -36),
            polar(bx, by - dy, rMid, 126),
            polar(bx, by - dy, h, 108),
            polar(bx, by - dy, rMid, 90),
            polar(bx, by - dy, h, 72),
            polar(bx, by - dy, rMid, 54),
            polar(bx, by - dy, h, 36),
            polar(cx + 2 * dx, cy, rMid, 198),
            polar(cx + 2 * dx, cy, h, 180),
            polar(cx + 2 * dx, cy, rMid, 162),
            polar(cx + 2 * dx, cy, h, 144),
            polar(bx, by + dy, rMid, 306),
            polar(bx, by + dy, h, 288),
            polar(bx, by + dy, rMid, 270),
            polar(bx, by + dy, h, 252),
            polar(bx, by + dy, rMid, 234),
            polar(bx, by + dy, h, 216),
            polar(cx, cy, rMid, 18)
          ]);
        }
      }
    } else {
      const R = h / Math.cos(Math.PI / 6);
      const dy = pitch * Math.sqrt(3) / 2;
      const rVal = 0.32 * h, rTip = 0.54 * h, rMid = 0.84 * h;
      const t30 = Math.tan(Math.PI / 6);
      const vaLocal = [
        { x: 0, y: -R / 2 },
        { x: rMid * Math.cos(Math.PI / 12) - h, y: rMid * Math.sin(Math.PI / 12) - h * t30 },
        { x: h * Math.cos(Math.PI / 6) - h, y: h * Math.sin(Math.PI / 6) - h * t30 },
        { x: rMid * Math.cos(Math.PI / 4) - h, y: rMid * Math.sin(Math.PI / 4) - h * t30 }
      ];
      const jLo = Math.floor((yMin - cy0) / dy) - 1;
      const jHi = Math.ceil((yMax - cy0) / dy) + 1;
      const iLo = Math.floor((xMin - cx0) / pitch) - 1;
      const iHi = Math.ceil((xMax - cx0) / pitch) + 1;

      for (let j = jLo; j <= jHi; j++) {
        const cy = cy0 + j * dy;
        const odd = ((j % 2) + 2) % 2;
        for (let i = iLo; i <= iHi; i++) {
          const cx = cx0 + (i + (odd ? 0.5 : 0)) * pitch;
          const star = [];
          for (let k = 0; k < 12; k++) {
            star.push(polar(cx, cy, rVal, k * 30));
            star.push(polar(cx, cy, rTip, (k + 0.5) * 30));
          }
          cells.push(star);
          for (let k = 0; k < 12; k++) {
            cells.push([
              polar(cx, cy, rVal, k * 30),
              polar(cx, cy, rTip, (k + 0.5) * 30),
              polar(cx, cy, rMid, (k + 0.5) * 30),
              polar(cx, cy, h, k * 30),
              polar(cx, cy, rMid, (k - 0.5) * 30),
              polar(cx, cy, rTip, (k - 0.5) * 30)
            ]);
          }
          const vax = cx + h, vay = cy + h * t30;
          const triA = [];
          for (let m = 0; m < 3; m++) {
            const deg = -m * 120;
            for (let q = 0; q < 4; q++) triA.push(rotPt(vax, vay, vaLocal[q].x, vaLocal[q].y, deg));
          }
          cells.push(triA);
          const vbx = cx + h, vby = cy - h * t30;
          const triB = [];
          for (let m = 0; m < 3; m++) {
            const deg = m * 120;
            for (let q = 0; q < 4; q++) triB.push(rotPt(vbx, vby, vaLocal[q].x, -vaLocal[q].y, deg));
          }
          cells.push(triB);
        }
      }
    }
    return cells;
  }

  function emitFilletedHole(api, rawPts, filletR) {
    const pts = cleanRing(rawPts, 0.05);
    if (pts.length < 3) return null;
    if (!(filletR > 0.02)) {
      return api.addPanelEntity(pts, '#000000');
    }
    const n = pts.length;
    const sPts = [], outH = [], inH = [];
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n];
      const p1 = pts[i];
      const p2 = pts[(i + 1) % n];
      const v1x = p0.x - p1.x, v1y = p0.y - p1.y;
      const v2x = p2.x - p1.x, v2y = p2.y - p1.y;
      const L1 = Math.hypot(v1x, v1y), L2 = Math.hypot(v2x, v2y);
      if (L1 < 1e-4 || L2 < 1e-4) continue;
      const u1x = v1x / L1, u1y = v1y / L1;
      const u2x = v2x / L2, u2y = v2y / L2;
      const dot = api.clamp(u1x * u2x + u1y * u2y, -1, 1);
      const theta = Math.acos(dot);
      if (theta > Math.PI - 0.04 || theta < 0.05) {
        sPts.push({ x: p1.x, y: p1.y });
        outH.push(null);
        inH.push(null);
        continue;
      }
      const half = theta / 2;
      const tanHalf = Math.tan(half);
      const d = Math.min(filletR / tanHalf, 0.45 * Math.min(L1, L2));
      if (d < 0.05) {
        sPts.push({ x: p1.x, y: p1.y });
        outH.push(null);
        inH.push(null);
        continue;
      }
      const r = d * tanHalf;
      const bx = u1x + u2x, by = u1y + u2y;
      const bl = Math.hypot(bx, by);
      if (bl < 1e-6) {
        sPts.push({ x: p1.x, y: p1.y });
        outH.push(null);
        inH.push(null);
        continue;
      }
      const distC = r / Math.sin(half);
      const cx = p1.x + (bx / bl) * distC;
      const cy = p1.y + (by / bl) * distC;
      const t1 = { x: p1.x + u1x * d, y: p1.y + u1y * d };
      const t2 = { x: p1.x + u2x * d, y: p1.y + u2y * d };
      const a1 = Math.atan2(t1.y - cy, t1.x - cx);
      const a2 = Math.atan2(t2.y - cy, t2.x - cx);
      const da = ((a2 - a1 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
      const k = (4 / 3) * Math.tan(da / 4);
      const h1 = { x: t1.x - k * r * Math.sin(a1), y: t1.y + k * r * Math.cos(a1) };
      const h2 = { x: t2.x + k * r * Math.sin(a2), y: t2.y - k * r * Math.cos(a2) };
      sPts.push(t1);
      inH.push(null);
      outH.push(h1);
      sPts.push(t2);
      inH.push(h2);
      outH.push(null);
    }
    if (sPts.length < 3) return api.addPanelEntity(pts, '#000000');
    const sid = api.addSpline({ pts: sPts, hs: { o: outH, i: inH }, closed: true, color: '#000000' });
    return sid || api.addPanelEntity(pts, '#000000');
  }

  MiniSketchTools.register({
    id: ID,
    label: 'Mashrabiya',
    title: 'Parametric Islamic Mashrabiya (Star & Rosette Tessellation)',
    version: '1.0.0',
    author: 'AI Builder',
    category: 'Signage & Art',
    description: 'Creates parametric Islamic star & rosette mashrabiya panels with gradient rib thickness and CNC corner fillets.',
    icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="1.5" y="1.5" width="13" height="13" rx="0.5"/><polygon points="8,3 9.4,5.8 12.5,5.5 10.2,8 12.5,10.5 9.4,10.2 8,13 6.6,10.2 3.5,10.5 5.8,8 3.5,5.5 6.6,5.8"/></svg>',
    modalId: ID + '-modal',
    guide: {
      en: { main: 'Star & rosette cells inset by rib thickness (#000000 cut). Holes smaller than 6 mm bit are automatically removed. Select any closed shape to use it as boundary, or leave unselected for a W×H frame.' },
      id: { main: 'Sel bintang & roset di-inset sesuai tebal sekat (#000000 cut). Lubang lebih kecil dari mata potong 6 mm otomatis dihapus. Pilih objek tertutup sebagai wadah boundary, atau kosongkan pilihan untuk frame kotak W×H.' }
    },
    modal: `<div id="${ID}-modal" class="modal hidden"><div class="modal-box wide-cols"><h3>Parametric Mashrabiya</h3><div class="modal-cols"><div class="opt-col">
      <label class="opt">Width Area (mm) <input type="number" id="mb-w" value="1220" min="20" step="10"></label>
      <label class="opt">Height Area (mm) <input type="number" id="mb-h" value="2440" min="20" step="10"></label>
      <label class="opt">Fold Symmetry <select id="mb-fold"><option value="6">6-fold (Hexagonal)</option><option value="8" selected>8-fold (Octagonal)</option><option value="10">10-fold (Girih Decagonal)</option><option value="12">12-fold (Dodecagonal)</option></select></label>
      <label class="opt">Grid Pitch (mm) <input type="number" id="mb-pitch" value="150" min="20" step="5"></label>
      <label class="opt">Rib Min (mm) <input type="number" id="mb-ribmin" value="10" min="2" step="1"></label>
      <label class="opt">Rib Max (mm) <input type="number" id="mb-ribmax" value="35" min="2" step="1"></label>
      <label class="opt">Gradasi Sekat <select id="mb-grad"><option value="vertical">Vertikal (Atas–Bawah)</option><option value="radial">Radial (Tengah–Tepi)</option><option value="horizontal">Horisontal (Kiri–Kanan)</option><option value="diagonal">Diagonal</option></select></label>
      <label class="opt">Corner Fillet (mm) <input type="number" id="mb-fillet" value="2" min="0" step="0.5"></label>
      <label class="opt">Margin Bingkai (mm) <input type="number" id="mb-margin" value="20" min="0" step="1"></label>
    </div><div class="cnc-status" data-guide="main">Sel bintang & roset di-inset sesuai tebal sekat (#000000 cut). Lubang lebih kecil dari mata potong 6 mm otomatis dihapus.</div></div><div class="modal-actions"><button class="btn" id="${ID}-cancel">Cancel</button><button class="btn primary" id="${ID}-ok">Create</button></div></div></div>`,
    open(api, params) {
      if (params) {
        if (params.w != null) el('mb-w').value = params.w;
        if (params.h != null) el('mb-h').value = params.h;
        if (params.fold != null) el('mb-fold').value = String(params.fold);
        if (params.pitch != null) el('mb-pitch').value = params.pitch;
        if (params.ribMin != null) el('mb-ribmin').value = params.ribMin;
        if (params.ribMax != null) el('mb-ribmax').value = params.ribMax;
        if (params.grad != null) el('mb-grad').value = params.grad;
        if (params.fillet != null) el('mb-fillet').value = params.fillet;
        if (params.margin != null) el('mb-margin').value = params.margin;
      }
      const ok = el(ID + '-ok');
      if (ok) ok.focus();
    },
    apply(api) {
      const w = +el('mb-w').value;
      const h = +el('mb-h').value;
      const fold = +el('mb-fold').value;
      const pitch = +el('mb-pitch').value;
      const ribMin = +el('mb-ribmin').value;
      const ribMax = +el('mb-ribmax').value;
      const grad = el('mb-grad').value || 'vertical';
      const fillet = +el('mb-fillet').value;
      const margin = +el('mb-margin').value;

      if (!(w >= 20 && h >= 20)) { api.toast('Ukuran area minimal 20 mm'); return; }
      if (![6, 8, 10, 12].includes(fold)) { api.toast('Pilih simetri 6, 8, 10, atau 12-fold'); return; }
      if (!(pitch >= 20)) { api.toast('Grid pitch minimal 20 mm'); return; }
      if (!(ribMin >= 2 && ribMax >= 2)) { api.toast('Tebal sekat minimal 2 mm'); return; }
      if (Math.min(ribMin, ribMax) >= pitch * 0.65) { api.toast('Tebal sekat terlalu besar terhadap pitch'); return; }
      if (!(fillet >= 0) || !(margin >= 0)) { api.toast('Fillet & margin tidak boleh negatif'); return; }

      const sel = api.selectedEntities();
      const prev = sel.find(e => e.type === 'art' && e.gen && e.gen.kind === ID);
      const sb = api.selectionBounds();
      const selCenter = sb ? { x: (sb.minX + sb.maxX) / 2, y: (sb.minY + sb.maxY) / 2 } : null;

      let outerRings = [];
      let useCustomBoundary = false;
      let emitOuterRect = false;

      if (prev && prev.gen && prev.gen.params && prev.gen.params.hasBoundary && Array.isArray(prev.gen.params.boundary)) {
        const pw = api.P(prev.pw), ph = api.P(prev.ph);
        let cNow = selCenter || api.s2w(api.getW() / 2, api.getH() / 2);
        if (pw && ph) cNow = { x: (pw.x + ph.x) / 2, y: (pw.y + ph.y) / 2 };
        outerRings = prev.gen.params.boundary.map(ring => ring.map(p => ({ x: cNow.x + p.dx, y: cNow.y + p.dy })));
        useCustomBoundary = true;
      } else if (!prev) {
        const nonGreen = sel.filter(e => api.colorOf(e) !== '#00ff00');
        if (nonGreen.length > 0) {
          const baked = api.bakeContours(nonGreen, { joinTol: 0.1 });
          const closedCts = (baked && baked.contours || []).filter(ct => ct && ct.closed && Array.isArray(ct.pts) && ct.pts.length >= 3);
          if (!closedCts.length) {
            api.toast('Objek yang dipilih harus berupa kurva tertutup');
            return;
          }
          outerRings = closedCts.map(ct => cleanRing(ct.pts, 0.05)).filter(r => r.length >= 3);
          if (!outerRings.length) {
            api.toast('Boundary terpilih tidak valid');
            return;
          }
          useCustomBoundary = true;
        } else if (sb) {
          const sw = sb.maxX - sb.minX, sh = sb.maxY - sb.minY;
          if (!(sw >= 20 && sh >= 20)) {
            api.toast('Area seleksi minimal 20 mm');
            return;
          }
          outerRings = [rectPts(selCenter.x, selCenter.y, sw, sh)];
          useCustomBoundary = true;
          emitOuterRect = true;
        }
      }

      if (!outerRings.length) {
        let c = api.s2w(api.getW() / 2, api.getH() / 2);
        if (prev) {
          const pw = api.P(prev.pw), ph = api.P(prev.ph);
          if (pw && ph) c = { x: (pw.x + ph.x) / 2, y: (pw.y + ph.y) / 2 };
        }
        outerRings = [rectPts(c.x, c.y, w, h)];
        emitOuterRect = true;
      }

      const probePos = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
      const probeSq = api.signedAreaPts(probePos) >= 0 ? probePos : probePos.slice().reverse();
      const probeRes = api.offsetClosedChains([{ pts: probeSq, closed: true }], -10, { join: 'miter', miterLimit: 2.5, arcTol: 0.05 });
      const shrinkNeedsPos = !!(probeRes && probeRes.length && Math.abs(api.signedAreaPts(probeRes[0].pts)) < 10000);
      const normOffsetOuter = (pts) => {
        const a = api.signedAreaPts(pts);
        return (shrinkNeedsPos ? a < 0 : a > 0) ? pts.slice().reverse() : pts;
      };
      const normBoolOuter = (pts) => (api.signedAreaPts(pts) < 0 ? pts.slice().reverse() : pts);
      const normBoolHole = (pts) => (api.signedAreaPts(pts) > 0 ? pts.slice().reverse() : pts);

      const outerOnly = [], holeOnly = [];
      for (let i = 0; i < outerRings.length; i++) {
        let depth = 0;
        const probe = outerRings[i][0];
        for (let j = 0; j < outerRings.length; j++) {
          if (i !== j && api.pointInPoly(probe, outerRings[j])) depth++;
        }
        if (depth % 2 === 0) outerOnly.push(outerRings[i]);
        else holeOnly.push(outerRings[i]);
      }

      let innerRings = [];
      if (margin > 0) {
        const insetOuters = [];
        for (const r of outerOnly) {
          const res = api.offsetClosedChains([{ pts: normOffsetOuter(r), closed: true }], -margin, { join: 'miter', miterLimit: 2, arcTol: 0.05 });
          for (const ct of res || []) if (ct.pts && ct.pts.length >= 3) insetOuters.push(normBoolOuter(ct.pts));
        }
        if (!insetOuters.length) {
          api.toast('Margin bingkai terlalu besar untuk ukuran wadah');
          return;
        }
        if (holeOnly.length) {
          const outsetHoles = [];
          for (const r of holeOnly) {
            const res = api.offsetClosedChains([{ pts: normOffsetOuter(r), closed: true }], margin, { join: 'miter', miterLimit: 2, arcTol: 0.05 });
            for (const ct of res || []) if (ct.pts && ct.pts.length >= 3) outsetHoles.push(normBoolOuter(ct.pts));
          }
          innerRings = outsetHoles.length ? (api.polyBoolOp('difference', insetOuters, outsetHoles) || []) : insetOuters;
        } else {
          innerRings = insetOuters;
        }
      } else {
        innerRings = outerOnly.map(normBoolOuter).concat(holeOnly.map(normBoolHole));
      }

      if (!innerRings.length) {
        api.toast('Area kerja kosong setelah dikurangi margin');
        return;
      }

      const workBB = ptsBBox(innerRings.flat());
      const outerBB = ptsBBox(outerRings.flat());
      const cx0 = (outerBB.minX + outerBB.maxX) / 2;
      const cy0 = (outerBB.minY + outerBB.maxY) / 2;
      const workW = Math.max(1e-6, workBB.maxX - workBB.minX);
      const workH = Math.max(1e-6, workBB.maxY - workBB.minY);
      const maxRad = Math.hypot(workW / 2, workH / 2);

      const innerPosRings = [];
      const innerBoolRings = [];
      for (let i = 0; i < innerRings.length; i++) {
        let depth = 0;
        const probe = innerRings[i][0];
        for (let j = 0; j < innerRings.length; j++) {
          if (i !== j && api.pointInPoly(probe, innerRings[j])) depth++;
        }
        innerPosRings.push(innerRings[i]);
        innerBoolRings.push(depth % 2 === 0 ? normBoolOuter(innerRings[i]) : normBoolHole(innerRings[i]));
      }

      const rawCells = buildCells(fold, pitch, cx0, cy0, workBB);
      const holesToEmit = [];

      const isSimpleRect = !useCustomBoundary && innerBoolRings.length === 1 && innerBoolRings[0].length === 4;

      for (let i = 0; i < rawCells.length; i++) {
        const cell = rawCells[i];
        const cbb = ptsBBox(cell);
        if (!bboxOverlapCheck(cbb, workBB)) continue;

        const cen = centroidOf(cell);
        let t = 0.5;
        if (grad === 'vertical') {
          t = 1 - api.clamp((cen.y - workBB.minY) / workH, 0, 1);
        } else if (grad === 'horizontal') {
          t = api.clamp((cen.x - workBB.minX) / workW, 0, 1);
        } else if (grad === 'diagonal') {
          t = 0.5 * (api.clamp((cen.x - workBB.minX) / workW, 0, 1) + (1 - api.clamp((cen.y - workBB.minY) / workH, 0, 1)));
        } else {
          t = api.clamp(Math.hypot(cen.x - cx0, cen.y - cy0) / maxRad, 0, 1);
        }
        const rib = ribMin + (ribMax - ribMin) * t;

        const insetRes = api.offsetClosedChains([{ pts: normOffsetOuter(cell), closed: true }], -rib / 2, { join: 'miter', miterLimit: 2.5, arcTol: 0.05 });
        if (!insetRes || !insetRes.length) continue;

        for (let rIdx = 0; rIdx < insetRes.length; rIdx++) {
          const rPts = insetRes[rIdx].pts;
          if (!rPts || rPts.length < 3) continue;
          const rbb = ptsBBox(rPts);
          if (!bboxOverlapCheck(rbb, workBB)) continue;

          let clippedList = null;
          let fullyInside = false;
          if (isSimpleRect && rbb.minX >= workBB.minX + 0.01 && rbb.maxX <= workBB.maxX - 0.01 && rbb.minY >= workBB.minY + 0.01 && rbb.maxY <= workBB.maxY - 0.01) {
            fullyInside = true;
          } else if (holeOnly.length === 0 && innerPosRings.length === 1 && rbb.minX >= workBB.minX + 0.01 && rbb.maxX <= workBB.maxX - 0.01 && rbb.minY >= workBB.minY + 0.01 && rbb.maxY <= workBB.maxY - 0.01) {
            let allIn = true;
            for (let pIdx = 0; pIdx < rPts.length; pIdx++) {
              if (!api.pointInPoly(rPts[pIdx], innerPosRings[0])) { allIn = false; break; }
            }
            if (allIn && !polylineIntersectsPolyline(rPts, true, innerPosRings[0], true)) fullyInside = true;
          }

          if (fullyInside) {
            clippedList = [rPts];
          } else {
            clippedList = api.polyBoolOp('intersection', [normBoolOuter(rPts)], innerBoolRings);
          }

          if (!clippedList || !clippedList.length) continue;
          for (let cIdx = 0; cIdx < clippedList.length; cIdx++) {
            const fPts = cleanRing(clippedList[cIdx], 0.05);
            if (fPts.length < 3) continue;
            const fbb = ptsBBox(fPts);
            if ((fbb.maxX - fbb.minX) < 6 || (fbb.maxY - fbb.minY) < 6) continue;
            if (Math.abs(api.signedAreaPts(fPts)) < 28.27) continue;
            const fit = api.offsetClosedChains([{ pts: normOffsetOuter(fPts), closed: true }], -3.0, { join: 'miter', miterLimit: 2, arcTol: 0.1 });
            if (!fit || !fit.length) continue;
            holesToEmit.push(fPts);
          }
        }
      }

      if (!holesToEmit.length) {
        api.toast('Tidak ada lubang >= 6 mm yang muat di dalam area/sekat ini');
        return;
      }

      NS.close(ID);

      const savedBoundary = useCustomBoundary
        ? outerRings.map(ring => ring.map(p => ({ dx: api.round2(p.x - cx0), dy: api.round2(p.y - cy0) })))
        : null;

      api.pushHistory();
      if (prev) api.removeEntity(prev.id);

      const madeIds = [];
      if (emitOuterRect) {
        for (const r of outerRings) {
          const fid = api.addPanelEntity(r, '#000000');
          if (fid) madeIds.push(fid);
        }
      }
      for (let i = 0; i < holesToEmit.length; i++) {
        const hid = emitFilletedHole(api, holesToEmit[i], fillet);
        if (hid) madeIds.push(hid);
      }

      api.commit();
      if (!madeIds.length) return;

      api.ui.selection = madeIds.map(id => ({ kind: 'entity', id }));
      api.cmdGroupSelection({ noHistory: true });
      const wrap = api.ui.selection.length === 1 ? api.state.entities[api.ui.selection[0].id] : null;
      if (wrap && wrap.type === 'art') {
        wrap.gen = {
          kind: ID,
          params: {
            w: api.round2(outerBB.maxX - outerBB.minX),
            h: api.round2(outerBB.maxY - outerBB.minY),
            fold,
            pitch,
            ribMin,
            ribMax,
            grad,
            fillet,
            margin,
            hasBoundary: useCustomBoundary,
            boundary: savedBoundary
          }
        };
        wrap.name = 'Mashrabiya ' + fold + '-fold';
        api.commit();
      }
      api.toast('Mashrabiya ' + fold + '-fold dibuat (' + holesToEmit.length + ' lubang)');
    }
  });
})();