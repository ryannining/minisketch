(() => {
  'use strict';
  const NS = window.MiniSketchTools;
  const ID = 'trace-test-circle';
  const el = (id) => document.getElementById(id);

  MiniSketchTools.register({
    id: ID,
    label: 'Trace Test',
    title: 'Circle → trace → x4',
    version: '1.0.0',
    author: 'AI Builder',
    category: 'CNC Utility',
    description: 'Diagnostic: draws a black circle on an offscreen canvas, traces it via api.traceCanvas, then duplicates the result into a 2x2 grid.',
    icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="8" cy="8" r="5"/></svg>',
    modalId: ID + '-modal',
    modal: `<div id="${ID}-modal" class="modal hidden"><div class="modal-box wide-cols"><h3>Trace Test</h3><div class="modal-cols"><div class="opt-col"><label class="opt">Diameter (mm) <input type="number" id="tt-d" value="60" min="10"></label><label class="opt">Gap (mm) <input type="number" id="tt-gap" value="40" min="0"></label></div><div class="cnc-status">Diagnostic: circle → traceCanvas → duplicate 2x2.</div></div><div class="modal-actions"><button class="btn" id="${ID}-cancel">Cancel</button><button class="btn primary" id="${ID}-ok">Run</button></div></div></div>`,
    open(api, params) {
      el('tt-d').value = (params && params.d) || 60;
      el('tt-gap').value = (params && params.gap) || 40;
      const ok = el(ID + '-ok');
      if (ok) ok.focus();
    },
    async apply(api) {
      const d = Math.max(10, +el('tt-d').value || 60);
      const gap = Math.max(0, +el('tt-gap').value || 40);
      NS.close(ID);

      // 1) Offscreen canvas: black circle on white.
      const pxPerMm = 3;
      const pad = 12;
      const size = Math.ceil((d + gap) * pxPerMm) + pad * 2;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, (d * pxPerMm) / 2, 0, Math.PI * 2);
      ctx.fill();

      // 2) Trace to vector contours.
      const traced = await api.traceCanvas(canvas, { threshold: 128 });
      if (!traced || !traced.ok) {
        api.toast('Trace gagal: ' + (traced && traced.error) || 'unknown');
        return;
      }
      const ids = traced.ids.slice();
      const bb = api.boundsOf(ids);
      if (!bb) { api.toast('Trace: tidak dapat menghitung bounds'); return; }

      // 3) Duplicate the original trace into a 2x2 grid.
      const w = bb.maxX - bb.minX;
      const h = bb.maxY - bb.minY;
      const stepX = w + gap;
      const stepY = h + gap;

      const copyAt = (dx, dy) => {
        api.ui.selection = ids.map(id => ({ kind: 'entity', id }));
        return api.duplicateSelection(dx, dy);
      };

      const rB = copyAt(0, stepY);
      const rC = copyAt(stepX, 0);
      const rD = copyAt(stepX, stepY);

      const all = ids.concat(
        (rB && rB.ids) || [],
        (rC && rC.ids) || [],
        (rD && rD.ids) || []
      ).filter(Boolean);

      api.ui.selection = all.map(id => ({ kind: 'entity', id }));
      api.setSelectionColor('#000000');
      api.cmdGroupSelection({ noHistory: true });

      const wrap = api.ui.selection.length === 1 ? api.state.entities[api.ui.selection[0].id] : null;
      if (wrap && wrap.type === 'art') {
        wrap.gen = { kind: ID, params: { d, gap } };
        wrap.name = 'Trace Test (4× circle)';
        api.commit();
      }

      api.toast('Trace OK — 4 lingkaran (' + all.length + ' kontur)');
    }
  });
})();
