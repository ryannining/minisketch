(() => {
  'use strict';
  const NS = window.MiniSketchTools;
  const ID = 'bake-nomor';
  const KEY = 'minisketch.v1.ext.' + ID;
  const el = (id) => document.getElementById(id);
  const read = (p) => {
    let s = {}; try { s = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) {}
    const n = (k, d, lo) => {
      const v = p && p[k] != null && p[k] !== '' ? +p[k] : +s[k];
      return isFinite(v) && v >= lo ? Math.round(v) : d;
    };
    return { from: n('from', 1, 1), to: n('to', 10, 1), gap: n('gap', 5, 0) };
  };
  NS.register({
    id: ID,
    label: 'Bake Nomor',
    title: 'Bake objek & beri nomor',
    version: '1.0.0',
    author: 'AI Builder',
    category: 'CNC Utility',
    description: 'Menyalin objek terseleksi ke kanan, mengganti teks ber-### dengan nomor.',
    icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2 4h5v8H2zM9 4h5v8H9z"/></svg>',
    modalId: ID + '-modal',
    modal: `<div id="${ID}-modal" class="modal hidden"><div class="modal-box wide-cols"><h3>Bake &amp; Nomor</h3><div class="modal-cols"><div class="opt-col"><label class="opt">Dari nomor <input type="number" id="${ID}-from" value="1" min="1" max="999"></label><label class="opt">Sampai nomor <input type="number" id="${ID}-to" value="10" min="1" max="999"></label><label class="opt">Jarak antar (mm) <input type="number" id="${ID}-gap" value="5" min="0" max="500"></label></div><div class="cnc-status">Objek non-teks &amp; teks tanpa placeholder di-bake; teks berisi ## disalin &amp; dinomori.</div></div><div class="modal-actions"><button class="btn" id="${ID}-cancel">Cancel</button><button class="btn primary" id="${ID}-ok">Create</button></div></div></div>`,
    open(api, params) {
      const s = read(params);
      el(`${ID}-from`).value = s.from;
      el(`${ID}-to`).value = s.to;
      el(`${ID}-gap`).value = s.gap;
      const ok = el(`${ID}-ok`);
      if (ok) ok.focus();
    },
    apply(api) {
      const from = parseInt(el(`${ID}-from`).value, 10);
      const to = parseInt(el(`${ID}-to`).value, 10);
      const gap = parseFloat(el(`${ID}-gap`).value);
      let a = from, b = to;
      if (!isFinite(a) || !isFinite(b) || a < 1 || b < 1) { api.toast('Input nomor tidak valid'); return; }
      if (a > b) { const tmp = a; a = b; b = tmp; }
      if (!isFinite(gap) || gap < 0 || gap > 500) { api.toast('Jarak harus 0–500 mm'); return; }
      const n = b - a + 1;
      if (n > 200) { api.toast('Maksimal 200 salinan'); return; }
      const ents = api.selectedEntities();
      if (!ents.length) { api.toast('Pilih objek dulu'); return; }
      const texts = ents.filter(e => e.type === 'text' && /#/.test(e.text || ''));
      const geom = ents.filter(e => e.type !== 'text' || !/#/.test(e.text || ''));
      const bb = api.selectionBounds();
      if (!bb) { api.toast('Gagal membaca batas seleksi'); return; }
      const step = (bb.maxX - bb.minX) + gap;
      const baked = api.bakeContours(geom, { tol: 0.2 });
      api.pushHistory();
      const made = [];
      for (let c = 0; c < n; c++) {
        const dx = (c + 1) * step;
        for (const ct of baked.contours || []) {
          if (!ct.pts || !ct.pts.length) continue;
          const pts = ct.pts.map(pt => ({ x: pt.x + dx, y: pt.y }));
          const color = ct.color || '#000000';
          made.push(ct.closed ? api.addPanelEntity(pts, color) : api.addPolylineEntity(pts, color));
        }
        for (const cv of baked.curves || []) {
          if (!cv.pts || !cv.pts.length) continue;
          const pts = cv.pts.map(pt => ({ x: pt.x + dx, y: pt.y }));
          made.push(api.addFittedCurve(pts, cv.color || '#000000', { tol: 0.2, closed: !!cv.closed }));
        }
        for (const t of texts) {
          const id = api.cloneEntityPlain(t.id, dx, 0, { withGuides: true });
          if (!id) continue;
          const num = a + c;
          api.setText(id, t.text.replace(/#+/g, m => String(num).padStart(m.length, '0')));
          made.push(id);
        }
      }
      api.commit();
      if (!made.length) { api.toast('Tidak ada yang dibuat'); return; }
      api.ui.selection = made.filter(Boolean).map(id => ({ kind: 'entity', id }));
      api.cmdGroupSelection({ noHistory: true });
      try { localStorage.setItem(KEY, JSON.stringify({ from: a, to: b, gap })); } catch (e) {}
      api.toast('Bake selesai (' + n + ' salinan)');
      NS.close(ID);
    }
  });
})();