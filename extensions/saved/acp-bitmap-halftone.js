// saved by MiniSketch (server disk) — id: acp-bitmap-halftone
// label: ACP Halftone
(() => {
  'use strict';
  const NS = window.MiniSketchTools;
  const ID = 'acp-bitmap-halftone';
  const el = (id) => document.getElementById(id);

  let loadedDataUrl = '';
  let loadedFileName = '';
  let currentImgKey = '';

  const rectPts = (cx, cy, w, h) => {
    const hw = w / 2, hh = h / 2;
    return [
      { x: cx - hw, y: cy - hh },
      { x: cx + hw, y: cy - hh },
      { x: cx + hw, y: cy + hh },
      { x: cx - hw, y: cy + hh }
    ];
  };

  function ensureCCW(pts) {
    let area = 0;
    for (let i = 0, n = pts.length; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      area += a.x * b.y - b.x * a.y;
    }
    return area < 0 ? pts.slice().reverse() : pts.slice();
  }

  function makeCirclePts(cx, cy, d, segs) {
    const r = d / 2;
    const pts = [];
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    return pts;
  }

  function makeHexPts(cx, cy, d) {
    // Pointy-top hexagon with flat-to-flat diameter = d
    const r = d / Math.sqrt(3);
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3 + Math.PI / 6;
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    return pts;
  }

  function polyBounds(rings) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of rings) {
      for (const p of r) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
    }
    return isFinite(minX) ? { minX, minY, maxX, maxY } : null;
  }

  MiniSketchTools.register({
    id: ID,
    label: 'ACP Halftone',
    title: 'Panel ACP Pola Halftone Bitmap',
    version: '1.1.0',
    author: 'AI Builder',
    category: 'Signage & Art',
    description: 'Membuat panel ACP siap cutting dengan lubang bulat/hexagon berdasarkan kecerahan gambar bitmap.',
    icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.5" y="1.5" width="13" height="13" rx="1"/><circle cx="5.5" cy="5.5" r="1.8"/><circle cx="10.8" cy="5.5" r="1.1"/><circle cx="5.5" cy="10.8" r="1.1"/><circle cx="10.8" cy="10.8" r="2.1"/></svg>',
    modalId: ID + '-modal',
    guide: {
      en: { main: 'Select a closed container shape (optional) or use default W x H frame. Choose Grid or Staggered layout. Brightness scales hole sizes up to Max Size, spaced by Min Rib Width, and cropped to Margin.' },
      id: { main: 'Pilih objek tertutup sebagai wadah (opsional) atau gunakan kotak W x H otomatis. Pilih susunan Grid Biasa atau Staggered. Kecerahan gambar mengatur ukuran lubang hingga Ukuran Maks, berjarak min Lebar Antar Pola, dan ter-crop sesuai Margin.' }
    },
    modal: `
      <div id="${ID}-modal" class="modal hidden">
        <div class="modal-box wide-cols">
          <h3>Panel ACP Halftone Bitmap</h3>
          <div class="modal-cols">
            <div class="opt-col">
              <label class="opt">Gambar Bitmap
                <input type="file" id="abh-file" accept="image/*">
              </label>
              <div id="abh-file-info" style="font-size:11px;opacity:0.8;margin:-4px 0 6px 0;">Belum ada gambar dipilih</div>
              <label class="opt">Width Area (mm)
                <input type="number" id="abh-w" value="1220" min="20" step="1">
              </label>
              <label class="opt">Height Area (mm)
                <input type="number" id="abh-h" value="2440" min="20" step="1">
              </label>
              <label class="opt">Outer Margin (mm)
                <input type="number" id="abh-margin" value="20" min="0" step="1">
              </label>
              <label class="opt">Bentuk Pola
                <select id="abh-shape">
                  <option value="circle">Bulat (Circle)</option>
                  <option value="hexagon">Hexagon</option>
                </select>
              </label>
              <label class="opt">Susunan Grid
                <select id="abh-layout">
                  <option value="grid">Grid Biasa (Lurus)</option>
                  <option value="staggered">Staggered (Zig-zag)</option>
                </select>
              </label>
              <label class="opt">Ukuran Max Pola (mm)
                <input type="number" id="abh-max" value="50" min="2" step="0.5">
              </label>
              <label class="opt">Lebar Min Antar Pola (mm)
                <input type="number" id="abh-gap" value="20" min="1" step="0.5">
              </label>
              <label class="opt">Ukuran Min Lubang (mm)
                <input type="number" id="abh-min" value="4" min="0.5" step="0.5">
              </label>
              <label class="opt">Mapping Kecerahan
                <select id="abh-invert">
                  <option value="dark-big">Gelap = Lubang Besar</option>
                  <option value="light-big">Terang = Lubang Besar</option>
                </select>
              </label>
            </div>
            <div class="cnc-status" data-guide="main">
              Semua kontur di-output sebagai cutting tembus (#000000). Hanya berupa lubang tanpa pulau di dalam lubang. Hasil digabung menjadi grup parametrik yang dapat di-reopen.
            </div>
          </div>
          <div class="modal-actions">
            <button class="btn" id="${ID}-cancel">Batal</button>
            <button class="btn primary" id="${ID}-ok">Buat Panel</button>
          </div>
        </div>
      </div>
    `,
    wire(api) {
      const fileInput = el('abh-file');
      if (fileInput) {
        fileInput.addEventListener('change', (ev) => {
          const f = ev.target && ev.target.files && ev.target.files[0];
          if (!f) return;
          loadedFileName = f.name || 'gambar';
          const reader = new FileReader();
          reader.onload = () => {
            loadedDataUrl = String(reader.result || '');
            const info = el('abh-file-info');
            if (info) info.textContent = 'File: ' + loadedFileName;
          };
          reader.readAsDataURL(f);
        });
      }
    },
    open(api, params) {
      if (params) {
        if (params.w != null) el('abh-w').value = params.w;
        if (params.h != null) el('abh-h').value = params.h;
        if (params.margin != null) el('abh-margin').value = params.margin;
        if (params.shape != null) el('abh-shape').value = params.shape;
        if (params.layout != null) el('abh-layout').value = params.layout;
        if (params.maxSize != null) el('abh-max').value = params.maxSize;
        if (params.gap != null) el('abh-gap').value = params.gap;
        if (params.minSize != null) el('abh-min').value = params.minSize;
        if (params.invert != null) el('abh-invert').value = params.invert;
        if (params.imgKey) {
          currentImgKey = params.imgKey;
          api.loadToolImage(params.imgKey).then((res) => {
            if (res && res.ok) {
              loadedDataUrl = res.dataUrl;
              loadedFileName = params.imgName || 'tersimpan';
            }
            const info = el('abh-file-info');
            if (info) info.textContent = loadedDataUrl ? ('Siap: ' + (loadedFileName || 'gambar')) : 'Belum ada gambar dipilih';
          });
        }
      }
      const info = el('abh-file-info');
      if (info) {
        info.textContent = loadedDataUrl ? ('Siap: ' + (loadedFileName || 'gambar')) : 'Belum ada gambar dipilih';
      }
      const ok = el(ID + '-ok');
      if (ok) ok.focus();
    },
    async apply(api) {
      const w = +el('abh-w').value;
      const h = +el('abh-h').value;
      const margin = +el('abh-margin').value;
      const shape = el('abh-shape').value || 'circle';
      const layout = el('abh-layout').value || 'grid';
      const maxSize = +el('abh-max').value;
      const gap = +el('abh-gap').value;
      const minSize = +el('abh-min').value;
      const invert = el('abh-invert').value || 'dark-big';

      if (!loadedDataUrl) {
        api.toast('Pilih file gambar bitmap terlebih dahulu.');
        return;
      }
      if (!(w >= 20 && h >= 20)) {
        api.toast('Width dan Height minimal 20 mm.');
        return;
      }
      if (!(margin >= 0)) {
        api.toast('Outer margin tidak valid.');
        return;
      }
      if (!(maxSize >= 2 && gap >= 0.5 && minSize >= 0.5 && minSize <= maxSize)) {
        api.toast('Periksa ukuran max, min lubang, dan jarak antar pola.');
        return;
      }

      // Simpan gambar ke IndexedDB (bukan ke dokumen/localStorage) agar kuota
      // localStorage tidak jebol. params hanya membawa imgKey kecil.
      if (!currentImgKey) currentImgKey = ID + '-' + Date.now();
      const storeRes = await api.storeToolImage(currentImgKey, loadedDataUrl);
      if (!storeRes || !storeRes.ok) {
        api.toast('Gagal menyimpan gambar: ' + ((storeRes && storeRes.error) || 'unknown'));
        return;
      }

      const selAll = api.selectedEntities();
      const prev = selAll.find(e => e.type === 'art' && e.gen && e.gen.kind === ID);
      const nonPrevSel = selAll.filter(e => (!prev || e.id !== prev.id) && api.colorOf(e) !== '#00ff00');
      const sb = nonPrevSel.length ? api.boundsOf(nonPrevSel.map(e => e.id)) : (!prev ? api.selectionBounds() : null);

      let outerRings = [];
      let useCustomContainer = false;

      if (prev && prev.gen && prev.gen.params && prev.gen.params.customContainerRings) {
        useCustomContainer = true;
        outerRings = prev.gen.params.customContainerRings.map(r => ensureCCW(r));
      } else if (nonPrevSel.length > 0 || sb) {
        useCustomContainer = true;
        if (nonPrevSel.length > 0) {
          const baked = api.bakeContours(nonPrevSel, { joinTol: 0.1 });
          for (const ct of (baked && baked.contours) || []) {
            if (!ct || !Array.isArray(ct.pts) || ct.pts.length < 3) continue;
            const first = ct.pts[0], last = ct.pts[ct.pts.length - 1];
            const isClosed = ct.closed || Math.hypot(last.x - first.x, last.y - first.y) < 0.5;
            if (isClosed) {
              const clean = Math.hypot(last.x - first.x, last.y - first.y) < 1e-4 ? ct.pts.slice(0, -1) : ct.pts;
              if (clean.length >= 3) outerRings.push(ensureCCW(clean));
            }
          }
        }
        if (outerRings.length === 0 && sb && (sb.maxX - sb.minX) > 1 && (sb.maxY - sb.minY) > 1) {
          const cx = (sb.minX + sb.maxX) / 2;
          const cy = (sb.minY + sb.maxY) / 2;
          outerRings = [ensureCCW(rectPts(cx, cy, sb.maxX - sb.minX, sb.maxY - sb.minY))];
        }
        if (outerRings.length === 0) {
          api.toast('Objek wadah yang dipilih tidak membentuk kontur tertutup yang valid.');
          return;
        }
      }

      NS.close(ID);

      const pxData = await api.imageToPixels(loadedDataUrl, { maxDim: 1024 });
      if (!pxData || !pxData.ok || !(pxData.width > 0 && pxData.height > 0)) {
        api.toast('Gagal membaca gambar bitmap.');
        return;
      }

      let center = api.s2w(api.getW() / 2, api.getH() / 2);
      if (prev) {
        const pw = api.P(prev.pw), ph = api.P(prev.ph);
        if (pw && ph) {
          center = { x: (pw.x + ph.x) / 2, y: (pw.y + ph.y) / 2 };
        }
      }

      if (!useCustomContainer) {
        outerRings = [ensureCCW(rectPts(center.x, center.y, w, h))];
      }

      const outerBB = polyBounds(outerRings);
      if (!outerBB) {
        api.toast('Gagal menghitung batas area panel.');
        return;
      }

      let innerRings = [];
      if (margin > 0) {
        const offsetRes = api.offsetClosedChains(
          outerRings.map(pts => ({ pts, closed: true })),
          -margin,
          { join: 'miter', miterLimit: 2, arcTol: 0.1 }
        );
        for (const r of offsetRes || []) {
          if (r && Array.isArray(r.pts) && r.pts.length >= 3) {
            innerRings.push(ensureCCW(r.pts));
          }
        }
      } else {
        innerRings = outerRings.map(r => ensureCCW(r));
      }

      if (!innerRings.length) {
        api.toast('Outer margin terlalu besar sehingga tidak ada area tersisa.');
        return;
      }

      const innerBB = polyBounds(innerRings);
      const innerW = innerBB.maxX - innerBB.minX;
      const innerH = innerBB.maxY - innerBB.minY;
      if (!(innerW > 0 && innerH > 0)) {
        api.toast('Area dalam panel tidak valid.');
        return;
      }

      const isStaggered = layout === 'staggered';
      const pitch = maxSize + gap;
      const stepX = pitch;
      const stepY = isStaggered ? pitch * (Math.sqrt(3) / 2) : pitch;

      const padCols = 2;
      const padRows = 2;
      const baseCols = Math.max(1, Math.ceil((outerBB.maxX - outerBB.minX) / stepX));
      const baseRows = Math.max(1, Math.ceil((outerBB.maxY - outerBB.minY) / stepY));
      const cols = baseCols + padCols * 2;
      const rows = baseRows + padRows * 2;

      const spanX = (cols - 1) * stepX + (isStaggered ? stepX * 0.5 : 0);
      const spanY = (rows - 1) * stepY;
      const cxPanel = (outerBB.minX + outerBB.maxX) / 2;
      const cyPanel = (outerBB.minY + outerBB.maxY) / 2;
      const startX = cxPanel - spanX / 2;
      const startY = cyPanel - spanY / 2;

      const imgSpanW = Math.max(1e-6, outerBB.maxX - outerBB.minX);
      const imgSpanH = Math.max(1e-6, outerBB.maxY - outerBB.minY);

      const holePolys = [];
      const segsCircle = Math.max(16, Math.min(36, Math.round(maxSize * 0.8)));

      for (let r = 0; r < rows; r++) {
        const py = startY + r * stepY;
        const rowShift = (isStaggered && (r % 2 === 1)) ? (stepX * 0.5) : 0;

        for (let c = 0; c < cols; c++) {
          const px = startX + c * stepX + rowShift;

          if (px < innerBB.minX - maxSize || px > innerBB.maxX + maxSize ||
              py < innerBB.minY - maxSize || py > innerBB.maxY + maxSize) {
            continue;
          }

          const u = api.clamp((px - outerBB.minX) / imgSpanW, 0, 1);
          const v = api.clamp((py - outerBB.minY) / imgSpanH, 0, 1);
          const ix = Math.min(pxData.width - 1, Math.max(0, Math.floor(u * (pxData.width - 1))));
          const iy = Math.min(pxData.height - 1, Math.max(0, Math.floor(v * (pxData.height - 1))));

          const lum = pxData.luminance(ix, iy);
          const factor = invert === 'light-big' ? lum : (1 - lum);
          const d = factor * maxSize;

          if (d < minSize) continue;

          const rawPoly = shape === 'hexagon'
            ? makeHexPts(px, py, d)
            : makeCirclePts(px, py, d, segsCircle);

          const clipped = api.polyBoolOp('intersection', [ensureCCW(rawPoly)], innerRings);
          if (clipped && clipped.length) {
            for (const ring of clipped) {
              if (!ring || ring.length < 3) continue;
              if (api.signedAreaPts(ring) > 0.25) {
                holePolys.push(ensureCCW(ring));
              }
            }
          }
        }
      }

      if (!holePolys.length) {
        api.toast('Tidak ada lubang pola yang terbentuk di dalam area margin. Coba kecilkan margin atau ubah threshold.');
        return;
      }

      const merged = api.polyBoolOp('union', holePolys, []);
      const finalHoles = [];
      for (const ring of (merged && merged.length ? merged : holePolys)) {
        if (!ring || ring.length < 3) continue;
        if (api.signedAreaPts(ring) > 0.25) {
          finalHoles.push(ensureCCW(ring));
        }
      }

      api.pushHistory();
      if (prev) api.removeEntity(prev.id);

      const madeIds = [];

      if (!useCustomContainer) {
        for (const frameRing of outerRings) {
          const fid = api.addPanelEntity(frameRing, '#000000');
          if (fid) madeIds.push(fid);
        }
      }

      for (const hRing of finalHoles) {
        const hid = api.addPanelEntity(hRing, '#000000');
        if (hid) madeIds.push(hid);
      }

      api.commit();

      if (!madeIds.length) {
        api.toast('Gagal membuat entitas panel.');
        return;
      }

      api.ui.selection = madeIds.map(id => ({ kind: 'entity', id }));
      api.cmdGroupSelection({ noHistory: true });

      const wrap = api.ui.selection.length === 1 ? api.state.entities[api.ui.selection[0].id] : null;
      if (wrap && wrap.type === 'art') {
        wrap.gen = {
          kind: ID,
          params: {
            w,
            h,
            margin,
            shape,
            layout,
            maxSize,
            gap,
            minSize,
            invert,
            imgKey: currentImgKey,
            imgName: loadedFileName,
            customContainerRings: useCustomContainer ? outerRings : null
          }
        };
        const shapeLbl = shape === 'hexagon' ? 'Hex' : 'Bulat';
        const layoutLbl = isStaggered ? 'Staggered' : 'Grid';
        wrap.name = `ACP Halftone (${shapeLbl} ${layoutLbl} ${api.fmt(maxSize)}mm)`;
        api.commit();
      }

      api.toast(`Panel ACP selesai dibuat (${finalHoles.length} lubang).`);
    }
  });
})();