// Sashiko Art Generator: Japanese geometric lattice & woven pattern generator
// for CNC routing, laser cutting, decorative partitions, and screens.
//
// Features authentic traditional lineart motifs (Asanoha, Seigaiha, Shippō,
// Kikkō, Sayagata, Tatewaku, Kagome, Hishi-moyo, Kaki-no-hana, Higaki) with
// independent Pitch X & Pitch Y (sumbu X dan Y), optional Sashiko dashed stitches
// (garis putus-putus tusuk jelujur), true shingle/scale Seigaiha wave occlusion,
// ribbon thickening (Tebal sekat / Lebar pita) and boolean union via Clipper.
// If no container is selected, outputs an outer frame of W x H in green (#00ff00 mark).
// If a closed object is selected, uses that object as the container.
// Results are grouped into a single re-editable parametric art group.
(() => {
  'use strict';

  const NS = window.MiniSketchTools;
  const KEY = 'minisketch.v1.sashiko';
  const SCALE = 1000; // Clipper integer scale (1 mm = 1000 units)

  const PATTERNS = [
    { key: 'seigaiha', name: 'Seigaiha (Ocean Waves / Ombak Laut)', defPitchX: 120, defPitchY: 70 },
    { key: 'asanoha', name: 'Asanoha (Hemp Leaf / Daun Rami)', defPitchX: 120, defPitchY: 104 },
    { key: 'shippo', name: 'Shippō-tsunagi (Seven Treasures / Lingkaran)', defPitchX: 90, defPitchY: 90 },
    { key: 'kikko', name: 'Kikkō (Tortoise Shell / Sisik Kura-kura)', defPitchX: 100, defPitchY: 86 },
    { key: 'sayagata', name: 'Sayagata (Key Fret / Labirin Geometris)', defPitchX: 80, defPitchY: 80 },
    { key: 'tatewaku', name: 'Tatewaku (Rising Steam / Gelombang Uap)', defPitchX: 90, defPitchY: 80 },
    { key: 'kagome', name: 'Kagome (Bamboo Weave / Bintang Triaksial)', defPitchX: 90, defPitchY: 78 },
    { key: 'hishi', name: 'Hishi-Moyo (Diamond Lattice / Belah Ketupat)', defPitchX: 90, defPitchY: 70 },
    { key: 'kakihana', name: 'Kaki-no-hana (Persimmon Flower / Bunga Kesemek)', defPitchX: 70, defPitchY: 70 },
    { key: 'higaki', name: 'Higaki (Cypress Weave / Anyaman Bilik)', defPitchX: 80, defPitchY: 80 }
  ];

  function patternNameOf(pid) {
    const p = PATTERNS.find(x => x.key === pid);
    return p ? p.name.split(' (')[0] : 'Sashiko';
  }

  const END_STYLES = ['round', 'miter', 'square'];

  // Clipper has no miter end cap: offset with flat (butt) ends and add a
  // triangular tip at each end before the boolean union.
  function miterTipPaths(pts, half, scale) {
    const out = [];
    const n = pts && pts.length;
    if (!n || n < 2) return out;
    const tip = (p, q) => {
      const dx = q.x - p.x, dy = q.y - p.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) return;
      const ux = dx / len, uy = dy / len;
      const nx = -uy * half, ny = ux * half;
      // q is always the inward neighbour, so the apex sits opposite it.
      const ax = p.x - ux * half, ay = p.y - uy * half;
      const first = { X: Math.round((p.x + nx) * scale), Y: Math.round((p.y + ny) * scale) };
      const apex = { X: Math.round(ax * scale), Y: Math.round(ay * scale) };
      const last = { X: Math.round((p.x - nx) * scale), Y: Math.round((p.y - ny) * scale) };
      if (first.X === apex.X && first.Y === apex.Y) return;
      if (last.X === apex.X && last.Y === apex.Y) return;
      if (first.X === last.X && first.Y === last.Y) return;
      out.push([first, apex, last]);
    };
    tip(pts[0], pts[1]);
    tip(pts[n - 1], pts[n - 2]);
    return out;
  }

  // --- Dashed Polyline Segmentation (Sashiko running stitch) ---------------
  // --- Dashed Polyline Segmentation (Sashiko running stitch) ---------------
  function dashPolyline(pts, dashLen, gapLen) {
    if (!pts || pts.length < 2) return [];
    const segLens = [];
    let totalLen = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const d = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
      segLens.push(d);
      totalLen += d;
    }
    if (totalLen < 1) return [];

    const L = dashLen;
    const G = gapLen;
    const spans = [];
    if (totalLen < L * 0.7) {
      spans.push([totalLen * 0.1, totalLen * 0.9]);
    } else {
      const n = Math.max(1, Math.round((totalLen + G) / (L + G)));
      const denom = n * L + (n - 1) * G;
      const k = denom > 0 ? totalLen / denom : 1;
      for (let i = 0; i < n; i++) {
        spans.push([i * (L + G) * k, (i * (L + G) + L) * k]);
      }
    }

    function pointAt(dist) {
      let cur = 0;
      for (let i = 0; i < segLens.length; i++) {
        if (cur + segLens[i] >= dist || i === segLens.length - 1) {
          const segD = segLens[i];
          const t = segD > 1e-9 ? Math.max(0, Math.min(1, (dist - cur) / segD)) : 0;
          return {
            x: pts[i].x + (pts[i + 1].x - pts[i].x) * t,
            y: pts[i].y + (pts[i + 1].y - pts[i].y) * t
          };
        }
        cur += segLens[i];
      }
      return pts[pts.length - 1];
    }

    const out = [];
    for (const [t0, t1] of spans) {
      if (t1 - t0 < 0.5) continue;
      const sub = [pointAt(t0)];
      let cur = 0;
      for (let i = 0; i < segLens.length; i++) {
        cur += segLens[i];
        if (cur > t0 + 1e-3 && cur < t1 - 1e-3) {
          sub.push({ x: pts[i + 1].x, y: pts[i + 1].y });
        }
      }
      sub.push(pointAt(t1));
      out.push(sub);
    }
    return out;
  }

  // --- 1. Seigaiha (Traditional Ocean Waves with Shingle Occlusion) --------
  function sampleVisibleArc(cx, cy, rkx, rky, Rx, Ry) {
    const N = 40;
    const visibleSegments = [];
    let currentSegment = [];

    const cy1 = cy + Ry / 2;
    const cy2 = cy + Ry;

    for (let i = 0; i <= N; i++) {
      const a = Math.PI * (i / N);
      const x = cx + rkx * Math.cos(a);
      const y = cy - rky * Math.sin(a); // pointing UP

      let occluded = false;
      // Row j + 1 (left and right adjacent fans in front)
      for (const cx1 of [cx - Rx, cx + Rx]) {
        const dx = (x - cx1) / Rx;
        const dy = (y - cy1) / Ry;
        if (dx * dx + dy * dy < 0.999) { occluded = true; break; }
      }
      // Row j + 2 (directly below fan in front)
      if (!occluded) {
        const dx = (x - cx) / Rx;
        const dy = (y - cy2) / Ry;
        if (dx * dx + dy * dy < 0.999) occluded = true;
      }

      if (!occluded) {
        currentSegment.push({ x, y });
      } else {
        if (currentSegment.length >= 2) visibleSegments.push(currentSegment);
        currentSegment = [];
      }
    }
    if (currentSegment.length >= 2) visibleSegments.push(currentSegment);
    return visibleSegments;
  }

  function genSeigaiha(minX, minY, maxX, maxY, px, py) {
    const lines = [];
    const numRings = 4;
    const Rx = px / 2;
    const Ry = py;
    const pad = Math.max(Rx, Ry) * 2;

    const startJ = Math.floor((minY - pad) / (Ry / 2)) - 1;
    const endJ = Math.ceil((maxY + pad) / (Ry / 2)) + 2;

    for (let j = startJ; j <= endJ; j++) {
      const cy = j * (Ry / 2);
      const off = (Math.abs(j) % 2 !== 0) ? Rx : 0;
      const startC = Math.floor((minX - pad - off) / (2 * Rx)) - 1;
      const endC = Math.ceil((maxX + pad - off) / (2 * Rx)) + 1;

      for (let c = startC; c <= endC; c++) {
        const cx = c * (2 * Rx) + off;
        for (let k = 1; k <= numRings; k++) {
          const rkx = Rx * (k / numRings);
          const rky = Ry * (k / numRings);
          const segs = sampleVisibleArc(cx, cy, rkx, rky, Rx, Ry);
          for (const s of segs) lines.push(s);
        }
      }
    }
    return lines;
  }

  // --- 2. Asanoha (Hemp Leaf / Daun Rami) -----------------------------------
  function genAsanoha(minX, minY, maxX, maxY, px, py) {
    const lines = [];
    const pad = Math.max(px, py) * 1.5;
    const x0 = minX - pad, y0 = minY - pad;
    const x1 = maxX + pad, y1 = maxY + pad;
    const w = x1 - x0, h = y1 - y0;

    // Horizontal grid lines
    for (let y = y0; y <= y1 + py; y += py) {
      lines.push([{ x: x0, y }, { x: x1, y }]);
    }

    // Diagonals with slope py / (px / 2)
    const slope = py / (px / 2);
    const maxDim = Math.max(w, h) * 3;
    for (let d = -maxDim; d <= maxDim; d += px) {
      lines.push([{ x: d + y0 / slope, y: y0 }, { x: d + y1 / slope, y: y1 }]);
      lines.push([{ x: d - y0 / slope, y: y0 }, { x: d - y1 / slope, y: y1 }]);
    }

    // Hexagon centers & inner diamond spokes
    const stepX = px;
    const stepY = py * 2;
    const startC = Math.floor(x0 / stepX) - 1;
    const endC = Math.ceil(x1 / stepX) + 1;
    const startR = Math.floor(y0 / stepY) - 1;
    const endR = Math.ceil(y1 / stepY) + 1;

    for (let r = startR; r <= endR; r++) {
      const cy = r * stepY;
      const xOff = (Math.abs(r) % 2) * (stepX / 2);
      for (let c = startC; c <= endC; c++) {
        const cx = c * stepX + xOff;
        // 6 spokes from center to vertices
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i + Math.PI / 6;
          const vx = cx + (px / 2) * Math.cos(a);
          const vy = cy + (py / 2) * 1.15 * Math.sin(a);
          lines.push([{ x: cx, y: cy }, { x: vx, y: vy }]);

          const aNext = (Math.PI / 3) * (i + 1) + Math.PI / 6;
          const mx = (vx + cx + (px / 2) * Math.cos(aNext)) / 2;
          const my = (vy + cy + (py / 2) * 1.15 * Math.sin(aNext)) / 2;
          lines.push([{ x: cx, y: cy }, { x: mx, y: my }]);
        }
      }
    }
    return lines;
  }

  // --- 3. Shippo (Seven Treasures) -----------------------------------------
  function genShippo(minX, minY, maxX, maxY, px, py) {
    const lines = [];
    const pad = Math.max(px, py) * 1.5;
    const x0 = minX - pad, y0 = minY - pad;
    const x1 = maxX + pad, y1 = maxY + pad;
    const startC = Math.floor(x0 / px) - 1;
    const endC = Math.ceil(x1 / px) + 1;
    const startR = Math.floor(y0 / py) - 1;
    const endR = Math.ceil(y1 / py) + 1;
    const SEGS = 32;

    for (let r = startR; r <= endR; r++) {
      const cy = r * py;
      for (let c = startC; c <= endC; c++) {
        const cx = c * px;
        const circle = [];
        for (let s = 0; s <= SEGS; s++) {
          const a = (2 * Math.PI * s) / SEGS;
          circle.push({ x: cx + px * Math.cos(a), y: cy + py * Math.sin(a) });
        }
        lines.push(circle);
      }
    }
    return lines;
  }

  // --- 4. Kikko (Tortoise Shell / Honeycomb) --------------------------------
  function genKikko(minX, minY, maxX, maxY, px, py) {
    const lines = [];
    const wCol = px * 0.75;
    const hRow = py;
    const pad = Math.max(px, py) * 1.5;
    const x0 = minX - pad, y0 = minY - pad;
    const x1 = maxX + pad, y1 = maxY + pad;
    const startC = Math.floor(x0 / wCol) - 1;
    const endC = Math.ceil(x1 / wCol) + 1;
    const startR = Math.floor(y0 / hRow) - 1;
    const endR = Math.ceil(y1 / hRow) + 1;

    for (let c = startC; c <= endC; c++) {
      const cx = c * wCol;
      const yOff = (Math.abs(c) % 2) * (hRow / 2);
      for (let r = startR; r <= endR; r++) {
        const cy = r * hRow + yOff;
        const hex = [];
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i;
          hex.push({ x: cx + (px / 2) * Math.cos(a), y: cy + (py / 2) * Math.sin(a) });
        }
        for (let i = 0; i < 6; i++) {
          lines.push([hex[i], hex[(i + 1) % 6]]);
        }
        lines.push([{ x: cx, y: cy }, hex[0]]);
        lines.push([{ x: cx, y: cy }, hex[2]]);
        lines.push([{ x: cx, y: cy }, hex[4]]);
      }
    }
    return lines;
  }

  // --- 5. Sayagata (Key Fret / Labirin Geometris) ---------------------------
  function genSayagata(minX, minY, maxX, maxY, px, py) {
    const lines = [];
    const qx = px / 4, hfx = px / 2, tqx = (3 * px) / 4;
    const qy = py / 4, hfy = py / 2, tqy = (3 * py) / 4;
    const pad = Math.max(px, py);
    const x0 = minX - pad, y0 = minY - pad;
    const x1 = maxX + pad, y1 = maxY + pad;
    const startC = Math.floor(x0 / px) - 1;
    const endC = Math.ceil(x1 / px) + 1;
    const startR = Math.floor(y0 / py) - 1;
    const endR = Math.ceil(y1 / py) + 1;

    for (let r = startR; r <= endR; r++) {
      const cy = r * py;
      for (let c = startC; c <= endC; c++) {
        const cx = c * px;
        lines.push([
          { x: cx, y: cy + qy },
          { x: cx + tqx, y: cy + qy },
          { x: cx + tqx, y: cy + py }
        ]);
        lines.push([
          { x: cx + qx, y: cy + py },
          { x: cx + qx, y: cy + hfy },
          { x: cx + px, y: cy + hfy }
        ]);
        lines.push([
          { x: cx + px, y: cy + tqy },
          { x: cx + qx, y: cy + tqy },
          { x: cx + qx, y: cy }
        ]);
        lines.push([
          { x: cx + tqx, y: cy },
          { x: cx + tqx, y: cy + hfy },
          { x: cx, y: cy + hfy }
        ]);
      }
    }
    return lines;
  }

  // --- 6. Tatewaku (Rising Steam / Gelombang Uap) ---------------------------
  function genTatewaku(minX, minY, maxX, maxY, px, py) {
    const lines = [];
    const waveLen = py * 2;
    const amp = px * 0.35;
    const pad = Math.max(px, py);
    const x0 = minX - pad, y0 = minY - pad;
    const x1 = maxX + pad, y1 = maxY + pad;
    const startC = Math.floor(x0 / px) - 1;
    const endC = Math.ceil(x1 / px) + 1;
    const SEGS = 32;
    const totalPeriods = Math.ceil((y1 - y0) / waveLen) + 2;

    for (let c = startC; c <= endC; c++) {
      const cx = c * px;
      const phase = (Math.abs(c) % 2) * Math.PI;
      const waveL = [];
      const waveR = [];
      const totalSteps = totalPeriods * SEGS;
      const yStart = y0;
      const yEnd = y1;
      const yStep = (yEnd - yStart) / totalSteps;

      for (let s = 0; s <= totalSteps; s++) {
        const y = yStart + s * yStep;
        const angle = (2 * Math.PI * (y / waveLen)) + phase;
        const dx = amp * Math.sin(angle);
        waveL.push({ x: cx - dx, y });
        waveR.push({ x: cx + dx, y });
      }
      lines.push(waveL);
      lines.push(waveR);
    }
    return lines;
  }

  // --- 7. Kagome (Bamboo Basket Weave / Bintang Triaksial) -------------------
  function genKagome(minX, minY, maxX, maxY, px, py) {
    const lines = [];
    const pad = Math.max(px, py) * 1.5;
    const x0 = minX - pad, y0 = minY - pad;
    const x1 = maxX + pad, y1 = maxY + pad;
    const w = x1 - x0, h = y1 - y0;

    for (let y = y0; y <= y1 + py; y += py) {
      lines.push([{ x: x0, y }, { x: x1, y }]);
    }
    const slope = py / (px / 2);
    const maxDim = Math.max(w, h) * 3;
    for (let d = -maxDim; d <= maxDim; d += px) {
      lines.push([{ x: d + y0 / slope, y: y0 }, { x: d + y1 / slope, y: y1 }]);
      lines.push([{ x: d - y0 / slope, y: y0 }, { x: d - y1 / slope, y: y1 }]);
    }
    return lines;
  }

  // --- 8. Hishi (Diamond Lattice / Belah Ketupat) ----------------------------
  function genHishi(minX, minY, maxX, maxY, px, py) {
    const lines = [];
    const pad = Math.max(px, py);
    const x0 = minX - pad, y0 = minY - pad;
    const x1 = maxX + pad, y1 = maxY + pad;
    const slope = py / px;
    const maxDim = Math.max(x1 - x0, y1 - y0) * 3;

    for (let d = -maxDim; d <= maxDim; d += px) {
      lines.push([{ x: d + y0 / slope, y: y0 }, { x: d + y1 / slope, y: y1 }]);
      lines.push([{ x: d - y0 / slope, y: y0 }, { x: d - y1 / slope, y: y1 }]);
    }
    return lines;
  }

  // --- 9. Kakihana (Persimmon Flower / Bunga Kesemek) -----------------------
  function genKakihana(minX, minY, maxX, maxY, px, py) {
    const lines = [];
    const pad = Math.max(px, py);
    const x0 = minX - pad, y0 = minY - pad;
    const x1 = maxX + pad, y1 = maxY + pad;
    const startC = Math.floor(x0 / px) - 1;
    const endC = Math.ceil(x1 / px) + 1;
    const startR = Math.floor(y0 / py) - 1;
    const endR = Math.ceil(y1 / py) + 1;

    for (let r = startR; r <= endR; r++) {
      const y = r * py;
      for (let c = startC; c <= endC; c++) {
        const x = c * px;
        if (Math.abs(r + c) % 2 === 0) {
          lines.push([{ x: x - px * 0.45, y }, { x: x + px * 0.45, y }]);
          lines.push([{ x, y: y - py * 0.45 }, { x, y: y + py * 0.45 }]);
        } else {
          lines.push([{ x: x - px * 0.3, y: y - py * 0.3 }, { x: x + px * 0.3, y: y + py * 0.3 }]);
          lines.push([{ x: x - px * 0.3, y: y + py * 0.3 }, { x: x + px * 0.3, y: y - py * 0.3 }]);
        }
      }
    }
    return lines;
  }

  // --- 10. Higaki (Cypress Weave / Anyaman Bilik) ---------------------------
  function genHigaki(minX, minY, maxX, maxY, px, py) {
    const lines = [];
    const nLines = 3;
    const pad = Math.max(px, py);
    const x0 = minX - pad, y0 = minY - pad;
    const x1 = maxX + pad, y1 = maxY + pad;
    const startC = Math.floor(x0 / px) - 1;
    const endC = Math.ceil(x1 / px) + 1;
    const startR = Math.floor(y0 / py) - 1;
    const endR = Math.ceil(y1 / py) + 1;

    for (let r = startR; r <= endR; r++) {
      const cy = r * py;
      for (let c = startC; c <= endC; c++) {
        const cx = c * px;
        const isOdd = Math.abs(r + c) % 2 === 1;
        for (let k = 1; k <= nLines; k++) {
          const offX = (k / (nLines + 1)) * px;
          const offY = (k / (nLines + 1)) * py;
          if (isOdd) {
            lines.push([{ x: cx + offX, y: cy }, { x: cx + px, y: cy + py - offY }]);
            lines.push([{ x: cx, y: cy + offY }, { x: cx + px - offX, y: cy + py }]);
          } else {
            lines.push([{ x: cx + offX, y: cy + py }, { x: cx + px, y: cy + offY }]);
            lines.push([{ x: cx, y: cy + py - offY }, { x: cx + px - offX, y: cy }]);
          }
        }
      }
    }
    return lines;
  }

  function generatePatternLines(pattern, minX, minY, maxX, maxY, px, py) {
    switch (pattern) {
      case 'seigaiha': return genSeigaiha(minX, minY, maxX, maxY, px, py);
      case 'asanoha': return genAsanoha(minX, minY, maxX, maxY, px, py);
      case 'shippo': return genShippo(minX, minY, maxX, maxY, px, py);
      case 'kikko': return genKikko(minX, minY, maxX, maxY, px, py);
      case 'sayagata': return genSayagata(minX, minY, maxX, maxY, px, py);
      case 'tatewaku': return genTatewaku(minX, minY, maxX, maxY, px, py);
      case 'kagome': return genKagome(minX, minY, maxX, maxY, px, py);
      case 'hishi': return genHishi(minX, minY, maxX, maxY, px, py);
      case 'kakihana': return genKakihana(minX, minY, maxX, maxY, px, py);
      case 'higaki': return genHigaki(minX, minY, maxX, maxY, px, py);
      default: return genSeigaiha(minX, minY, maxX, maxY, px, py);
    }
  }

  // --- Pure Planning Validation ---------------------------------------------
  function planSashiko(p) {
    const w = +p.w, h = +p.h, th = +p.th, margin = +p.margin;
    const px = +p.pitchX, py = +p.pitchY;
    if (!(w > 0) || !(h > 0)) return { ok: false, why: 'lebar dan tinggi harus lebih dari 0' };
    if (!(th > 0)) return { ok: false, why: 'tebal sekat pita harus lebih dari 0' };
    if (margin < 0) return { ok: false, why: 'margin bingkai tidak boleh negatif' };
    if (w <= 2 * margin || h <= 2 * margin) return { ok: false, why: 'ukuran area harus lebih besar dari 2x margin' };
    if (!(px > 0) || !(py > 0)) return { ok: false, why: 'pitch X dan pitch Y harus lebih dari 0' };
    if (p.dashed) {
      if (!(+p.dash > 0) || !(+p.gap > 0)) return { ok: false, why: 'panjang dash dan gap harus lebih dari 0' };
    }
    const end = p.end == null ? 'square' : String(p.end);
    if (END_STYLES.indexOf(end) < 0) return { ok: false, why: 'ujung garis harus round, miter, atau square' };
    return { ok: true, w, h, th, margin, pitchX: px, pitchY: py, pattern: p.pattern, mode: p.mode, dashed: !!p.dashed, dash: +p.dash, gap: +p.gap, end };
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
    const boolVal = (k, def) => {
      if (p[k] !== undefined) return !!p[k];
      if (saved[k] !== undefined) return !!saved[k];
      return def;
    };
    const oldPitch = num('pitch', 120, 10, 5000);
    return {
      w: num('w', 1220, 20, 20000),
      h: num('h', 2440, 20, 20000),
      th: num('th', 14, 0.5, 500),
      margin: num('margin', 20, 0, 5000),
      pitchX: num('pitchX', num('pitchx', oldPitch, 10, 5000), 10, 5000),
      pitchY: num('pitchY', num('pitchy', Math.round(oldPitch * 0.65), 10, 5000), 10, 5000),
      dashed: boolVal('dashed', false),
      dash: num('dash', 12, 1, 500),
      gap: num('gap', 4, 1, 500),
      pattern: p.pattern || saved.pattern || 'seigaiha',
      mode: p.mode || saved.mode || 'holes',
      end: END_STYLES.indexOf(String(p.end || saved.end || 'square')) >= 0
        ? String(p.end || saved.end || 'square') : 'square'
    };
  }

  // --- Tool Registration ---------------------------------------------------
  NS.register({
    id: 'sashiko',
    label: 'Sashiko Art',
    version: '1.1.0',
    icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2 13.5c1.8-3 4.2-4.5 6-4.5s4.2 1.5 6 4.5M4 13.5c1.2-1.8 2.8-2.7 4-2.7s2.8.9 4 2.7M6 13.5c.6-.9 1.4-1.35 2-1.35s1.4.45 2 1.35M2 8c1.8-3 4.2-4.5 6-4.5S12.2 5 14 8M4 8c1.2-1.8 2.8-2.7 4-2.7S10.8 6.2 12 8M6 8c.6-.9 1.4-1.35 2-1.35S9.4 7.1 10 8"/></svg>',
    title: 'Sashiko Art: generator pola anyaman & kisi-kisi laser cut/CNC parametrik dengan jahitan putus-putus dan sumbu X/Y independen',
    modalId: 'sashiko-modal',
    guide: {
      en: {
        main: '<b>Sashiko Art Generator</b> converts authentic Japanese lineart motifs into CNC/laser cutting screens and partitions with independent <b>Pitch X</b> &amp; <b>Pitch Y</b>.<br><br>&bull; <b>Seigaiha Overlap:</b> Uses traditional overlapping shingle wave geometry where each wave arches seamlessly above the crests in front.<br>&bull; <b>Dashed Lines:</b> Enable <b>Garis putus-putus (Dashed)</b> for genuine running-stitch Sashiko embroidery looks.<br>&bull; <b>Ribbon Union:</b> All ribbon curves of thickness <b>Tebal sekat</b> are unioned into a clean structural skeleton. <b>Ujung garis</b> picks round, miter (pointed) or square caps. Cut holes are closed paths in <b>#000000</b>.<br>&bull; <b>Container:</b> If a closed shape is selected, it acts as the container (inset by Margin). Otherwise a <b>W &times; H</b> green (#00ff00 mark) outer frame is included. Double click to re-open.'
      },
      id: {
        main: '<b>Sashiko Art Generator</b> membuat kisi-kisi dan partisi dekoratif laser cut/CNC dari motif tradisional Jepang dengan <b>Pitch X</b> &amp; <b>Pitch Y</b> terpisah.<br><br>&bull; <b>Pola Seigaiha:</b> Menggunakan overlap sirip gelombang asli Jepang tanpa garis tembus ke gelombang di bawahnya.<br>&bull; <b>Garis Putus-putus:</b> Aktifkan <b>Garis putus-putus (Dashed)</b> untuk motif jahitan tusuk jelujur khas Sashiko.<br>&bull; <b>Penyatuan Pita:</b> Semua pita kurva setebal <b>Tebal sekat</b> di-boolean union rapi. <b>Ujung garis</b> memilih ujung bulat (round), runcing (miter), atau kotak (square); area lubang dipotong dengan garis <b>#000000 (cut)</b>.<br>&bull; <b>Wadah:</b> Bila ada objek tertutup yang diseleksi, objek tersebut otomatis menjadi wadah (di-inset sebesar Margin). Jika tidak, frame luar kotak <b>L &times; T</b> hijau (#00ff00 mark) disertakan. Dobel-klik untuk mengedit kembali.'
      }
    },
    modal: `
<div id="sashiko-modal" class="modal hidden">
  <div class="modal-box wide-cols">
    <h3>Sashiko Art Generator</h3>
    <div class="modal-cols">
      <div class="opt-col">
        <label class="opt">Pola / Motif
          <select id="sashiko-pattern">
            <option value="seigaiha">Seigaiha (Ocean Waves / Ombak Laut)</option>
            <option value="asanoha">Asanoha (Hemp Leaf / Daun Rami)</option>
            <option value="shippo">Shippō-tsunagi (Seven Treasures / Lingkaran)</option>
            <option value="kikko">Kikkō (Tortoise Shell / Sisik Kura-kura)</option>
            <option value="sayagata">Sayagata (Key Fret / Labirin Geometris)</option>
            <option value="tatewaku">Tatewaku (Rising Steam / Gelombang Uap)</option>
            <option value="kagome">Kagome (Bamboo Weave / Bintang Triaksial)</option>
            <option value="hishi">Hishi-Moyo (Diamond Lattice / Belah Ketupat)</option>
            <option value="kakihana">Kaki-no-hana (Persimmon Flower / Bunga)</option>
            <option value="higaki">Higaki (Cypress Weave / Anyaman Bilik)</option>
          </select>
        </label>
        <label class="opt">Width area (mm) <input type="number" id="sashiko-w" value="1220" step="10" min="50"></label>
        <label class="opt">Height area (mm) <input type="number" id="sashiko-h" value="2440" step="10" min="50"></label>
        <label class="opt" title="Lebar pita sekat anyaman yang ditebalkan dan diunion">Tebal sekat pita (mm) <input type="number" id="sashiko-th" value="14" step="0.5" min="1"></label>
        <label class="opt" title="Jarak dinding solid bingkai luar dari tepi wadah">Margin bingkai luar (mm) <input type="number" id="sashiko-margin" value="20" step="1" min="0"></label>
        <label class="opt" title="Jarak/lebar modul pola pada sumbu X">Pitch X / Lebar motif (mm) <input type="number" id="sashiko-pitchx" value="120" step="5" min="10"></label>
        <label class="opt" title="Jarak/tinggi modul pola pada sumbu Y">Pitch Y / Tinggi motif (mm) <input type="number" id="sashiko-pitchy" value="80" step="5" min="10"></label>
        <label class="opt"><input type="checkbox" id="sashiko-dashed"> Garis putus-putus (Dashed)</label>
        <label class="opt" title="Panjang satu segmen jahitan">Panjang dash (mm) <input type="number" id="sashiko-dash" value="12" step="1" min="2"></label>
        <label class="opt" title="Jarak celah antar jahitan">Jarak celah / Gap (mm) <input type="number" id="sashiko-gap" value="4" step="1" min="1"></label>
        <label class="opt" title="Bentuk ujung pita: bulat, runcing (miter), atau kotak">Ujung garis
          <select id="sashiko-end">
            <option value="round">Round (bulat)</option>
            <option value="miter">Miter (runcing)</option>
            <option value="square">Square (kotak)</option>
          </select>
        </label>
        <label class="opt">Mode keluaran
          <select id="sashiko-mode">
            <option value="holes">Lubang anyaman (Cut #000000)</option>
            <option value="ribbons">Tulang pita / Jahitan (Cut #000000)</option>
            <option value="full">Panel lengkap (Frame luar + Lubang cut)</option>
          </select>
        </label>
      </div>
      <div class="cnc-status" data-guide="main"></div>
    </div>
    <div class="modal-actions">
      <button class="btn" id="sashiko-cancel">Cancel</button>
      <button class="btn primary" id="sashiko-ok">Create</button>
    </div>
  </div>
</div>`,

    wire(api) {
      const el = (id) => document.getElementById(id);
      const patSelect = el('sashiko-pattern');
      if (patSelect) {
        patSelect.addEventListener('change', () => {
          const p = PATTERNS.find(x => x.key === patSelect.value);
          if (p) {
            el('sashiko-pitchx').value = p.defPitchX;
            el('sashiko-pitchy').value = p.defPitchY;
          }
        });
      }
    },

    open(api, params) {
      const s = read(params);
      const el = (id) => document.getElementById(id);

      // If no explicit params (fresh toolbar click), inspect current selection
      if (!params) {
        const sel = api.selectedEntities();
        const otherEntities = sel.filter(e => !(e.type === 'art' && e.gen && e.gen.kind === 'sashiko'));
        if (otherEntities.length) {
          const baked = api.bakeContours(otherEntities, {});
          const loops = (baked.contours || []).filter(c => c.closed && c.pts && c.pts.length >= 3);
          if (loops.length) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const p of loops[0].pts) {
              if (p.x < minX) minX = p.x;
              if (p.x > maxX) maxX = p.x;
              if (p.y < minY) minY = p.y;
              if (p.y > maxY) maxY = p.y;
            }
            if (isFinite(minX) && maxX > minX && maxY > minY) {
              s.w = Math.round(maxX - minX);
              s.h = Math.round(maxY - minY);
            }
          }
        }
      }

      el('sashiko-pattern').value = s.pattern;
      el('sashiko-w').value = s.w;
      el('sashiko-h').value = s.h;
      el('sashiko-th').value = s.th;
      el('sashiko-margin').value = s.margin;
      el('sashiko-pitchx').value = s.pitchX;
      el('sashiko-pitchy').value = s.pitchY;
      el('sashiko-dashed').checked = !!s.dashed;
      el('sashiko-dash').value = s.dash;
      el('sashiko-gap').value = s.gap;
      el('sashiko-end').value = s.end;
      el('sashiko-mode').value = s.mode;

      const ok = el('sashiko-ok');
      if (ok) ok.focus();
    },

    apply(api) {
      const el = (id) => document.getElementById(id);
      const clamp = api.clamp, fmt = api.fmt, toast = api.toast;

      const Lib = api.clipperLib();
      if (!Lib) {
        toast('Sashiko Art membutuhkan tools/clipper.js');
        return;
      }

      const pattern = el('sashiko-pattern').value;
      const w = clamp(+el('sashiko-w').value || 1220, 20, 20000);
      const h = clamp(+el('sashiko-h').value || 2440, 20, 20000);
      const th = clamp(+el('sashiko-th').value || 14, 0.5, 500);
      const margin = clamp(+el('sashiko-margin').value || 20, 0, 5000);
      const pitchX = clamp(+el('sashiko-pitchx').value || 120, 10, 5000);
      const pitchY = clamp(+el('sashiko-pitchy').value || 80, 10, 5000);
      const dashed = !!el('sashiko-dashed').checked;
      const dash = clamp(+el('sashiko-dash').value || 12, 1, 500);
      const gap = clamp(+el('sashiko-gap').value || 4, 1, 500);
      const mode = el('sashiko-mode').value;
      const end = el('sashiko-end').value;

      NS.close('sashiko');
      try {
        localStorage.setItem(KEY, JSON.stringify({ w, h, th, margin, pitchX, pitchY, dashed, dash, gap, pattern, mode, end }));
      } catch (err) { /* storage blocked */ }

      const plan = planSashiko({ w, h, th, margin, pitchX, pitchY, dashed, dash, gap, pattern, mode, end });
      if (!plan.ok) {
        toast('Sashiko Art: ' + plan.why);
        return;
      }

      // Check for container object in current selection
      const sel = api.selectedEntities();
      const genGroups = sel.filter(e => e.type === 'art' && e.gen && e.gen.kind === 'sashiko');
      const otherEntities = sel.filter(e => !(e.type === 'art' && e.gen && e.gen.kind === 'sashiko'));

      let containerLoop = null;
      let hasCustomContainer = false;
      let bbox = null;

      if (otherEntities.length) {
        const baked = api.bakeContours(otherEntities, {});
        const loops = (baked.contours || []).filter(c => c.closed && c.pts && c.pts.length >= 3);
        if (loops.length) {
          containerLoop = loops[0].pts;
          hasCustomContainer = true;
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const p of containerLoop) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
          }
          bbox = { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
        }
      }

      let outerBoxPts = null;
      if (!hasCustomContainer) {
        // Place in centre of viewport if no container is selected
        const centre = api.s2w(api.getW() / 2, api.getH() / 2);
        const ox = centre.x - w / 2;
        const oy = centre.y - h / 2;
        bbox = { minX: ox, minY: oy, maxX: ox + w, maxY: oy + h, w, h };
        outerBoxPts = [
          { x: ox, y: oy },
          { x: ox + w, y: oy },
          { x: ox + w, y: oy + h },
          { x: ox, y: oy + h }
        ];
        containerLoop = outerBoxPts;
      }

      // Inset container by margin to form innerBoundary
      const coMargin = new Lib.ClipperOffset(2, 0.25 * SCALE);
      coMargin.AddPath(
        containerLoop.map(p => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) })),
        Lib.JoinType.jtMiter,
        Lib.EndType.etClosedPolygon
      );
      const innerPolys = new Lib.Paths();
      if (margin > 0) {
        coMargin.Execute(innerPolys, -margin * SCALE);
      } else {
        const cPath = new Lib.Path();
        for (const p of containerLoop) {
          cPath.push(new Lib.IntPoint2(Math.round(p.x * SCALE), Math.round(p.y * SCALE)));
        }
        innerPolys.push(cPath);
      }

      if (!innerPolys.length) {
        toast('Sashiko Art: margin terlalu besar, area dalam habis');
        return;
      }

      // Generate raw pattern lines across bbox with pitchX & pitchY
      let rawLines = generatePatternLines(pattern, bbox.minX, bbox.minY, bbox.maxX, bbox.maxY, pitchX, pitchY);
      if (!rawLines || !rawLines.length) {
        toast('Sashiko Art: gagal menghasilkan garis pola');
        return;
      }

      // Apply dashed lines segmentation if requested
      if (dashed) {
        const dashedLines = [];
        for (const line of rawLines) {
          const dashes = dashPolyline(line, dash, gap);
          for (const d of dashes) dashedLines.push(d);
        }
        rawLines = dashedLines;
      }

      // Thicken lines into 2D ribbons with the chosen end style, then union.
      const half = (th / 2) * SCALE;
      const endType = end === 'round' ? Lib.EndType.etOpenRound
        : end === 'miter' ? Lib.EndType.etOpenButt : Lib.EndType.etOpenSquare;
      const joinType = end === 'round' ? Lib.JoinType.jtRound : Lib.JoinType.jtMiter;
      const coRibbon = new Lib.ClipperOffset(2, 0.25 * SCALE);
      const tips = [];
      const areaPath = (path) => {
        let a = 0;
        for (let i = 0; i < path.length; i++) {
          const p = path[i], q = path[(i + 1) % path.length];
          a += p.X * q.Y - q.X * p.Y;
        }
        return a / 2;
      };
      for (const line of rawLines) {
        if (!line || line.length < 2) continue;
        coRibbon.AddPath(
          line.map(p => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) })),
          joinType,
          endType
        );
        if (end === 'miter') {
          for (const tri of miterTipPaths(line, th / 2, SCALE)) tips.push(tri);
        }
      }
      const ribbons = new Lib.Paths();
      coRibbon.Execute(ribbons, half);
      if (tips.length && ribbons.length) {
        const sign = areaPath(ribbons[0]) >= 0 ? 1 : -1;
        for (const tri of tips) {
          if ((areaPath(tri) >= 0 ? 1 : -1) !== sign) tri.reverse();
          ribbons.push(tri);
        }
      }

      // Compute closed cut holes = Difference(innerPolys, ribbons)
      const cDiff = new Lib.Clipper();
      cDiff.AddPaths(innerPolys, Lib.PolyType.ptSubject, true);
      cDiff.AddPaths(ribbons, Lib.PolyType.ptClip, true);
      const rawHoles = new Lib.Paths();
      cDiff.Execute(
        Lib.ClipType.ctDifference,
        rawHoles,
        Lib.PolyFillType.pftNonZero,
        Lib.PolyFillType.pftNonZero
      );

      // Clean up holes: filter slivers & tiny collinear artifacts
      const validHoles = [];
      for (const raw of rawHoles) {
        if (!raw || raw.length < 3) continue;
        let pts = raw.map(p => ({ x: p.X / SCALE, y: p.Y / SCALE }));
        const dedup = [pts[0]];
        for (let i = 1; i < pts.length; i++) {
          if (Math.hypot(pts[i].x - dedup[dedup.length - 1].x, pts[i].y - dedup[dedup.length - 1].y) > 0.005) {
            dedup.push(pts[i]);
          }
        }
        pts = dedup;
        if (pts.length >= 3 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) <= 0.005) {
          pts.pop();
        }
        if (pts.length >= 3) {
          const area = Math.abs(api.signedAreaPts(pts));
          if (area >= 2) {
            validHoles.push(pts);
          }
        }
      }

      // If mode is 'ribbons', compute ribbons clipped to innerPolys
      let clippedRibbons = null;
      if (mode === 'ribbons') {
        const cRib = new Lib.Clipper();
        cRib.AddPaths(innerPolys, Lib.PolyType.ptSubject, true);
        cRib.AddPaths(ribbons, Lib.PolyType.ptClip, true);
        clippedRibbons = new Lib.Paths();
        cRib.Execute(
          Lib.ClipType.ctIntersection,
          clippedRibbons,
          Lib.PolyFillType.pftNonZero,
          Lib.PolyFillType.pftNonZero
        );
      }

      // Exactly ONE undo step per apply
      api.pushHistory();

      // If re-editing, remove the previously generated group
      if (genGroups.length === 1) {
        api.removeEntity(genGroups[0].id);
      }

      const madeIds = [];

      // 1. If no custom container selected, add the outer boundary box with green line (#00ff00)
      if (!hasCustomContainer && outerBoxPts) {
        const frameColor = mode === 'full' ? '#000000' : '#00ff00';
        const frameId = api.addPanelEntity(outerBoxPts, frameColor);
        if (frameId) madeIds.push(frameId);
      }

      // 2. Add hole loops or ribbons
      if (mode === 'holes' || mode === 'full') {
        for (const hPts of validHoles) {
          const hid = api.addPanelEntity(hPts, '#000000');
          if (hid) madeIds.push(hid);
        }
      } else if (mode === 'ribbons' && clippedRibbons) {
        for (const raw of clippedRibbons) {
          if (!raw || raw.length < 3) continue;
          const pts = raw.map(p => ({ x: p.X / SCALE, y: p.Y / SCALE }));
          const rid = api.addPanelEntity(pts, '#000000');
          if (rid) madeIds.push(rid);
        }
      }

      api.commit();

      if (!madeIds.length) {
        toast('Sashiko Art: tidak ada geometri yang berhasil dibuat');
        return;
      }

      // 3. Group everything into one named parametric group
      api.ui.selection = madeIds.map(id => ({ kind: 'entity', id }));
      api.cmdGroupSelection({ noHistory: true });
      const wrap = api.ui.selection.length === 1 ? api.state.entities[api.ui.selection[0].id] : null;
      const pName = patternNameOf(pattern);
      if (wrap && wrap.type === 'art') {
        wrap.gen = {
          kind: 'sashiko',
          params: { w, h, th, margin, pitchX, pitchY, dashed, dash, gap, pattern, mode, end }
        };
        wrap.name = 'Sashiko Art ' + pName + ' ' + fmt(bbox.w) + '\u00d7' + fmt(bbox.h) + ' mm';
        api.commit();
      }

      const countDesc = mode === 'ribbons'
        ? (clippedRibbons ? clippedRibbons.length : 0) + ' pita'
        : validHoles.length + ' lubang cut';
      toast('Sashiko Art: ' + pName + ' \u00b7 ' + countDesc + ' (' + fmt(bbox.w) + '\u00d7' + fmt(bbox.h) + ' mm)');
    }
  });
})();
