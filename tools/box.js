// Box maker: a finger joint box unfolded into flat panels.
//
// Every edge is a finger joint ('tab' / 'notch' / 'plain'); the fingers are
// about `fw` wide and as deep as the material is thick, and the ends stay flush
// so the corners come out square. Panels: the four walls in a strip, then the
// bottom (and the lid) below it.
(() => {
  'use strict';

  const NS = window.MiniSketchTools;
  const KEY = 'minisketch.v1.boxMaker';

  function fingerEdge(ax, ay, bx, by, nx, ny, t, fw, mode) {
    const out = [];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-9) return out;
    const ux = (bx - ax) / len, uy = (by - ay) / len;
    const off = (i) => {
      if (mode === 'plain') return 0;
      const joint = (i % 2) === 0;              // even segments carry the joint;
      return joint ? (mode === 'tab' ? t : -t) : 0;   // ends stay flush -> square corners
    };
    let n = 1;
    if (mode !== 'plain') {
      n = Math.max(2, Math.round(len / Math.max(0.5, fw)));
      if (!(n % 2)) n += 1;                     // odd count: both ends match
    }
    const fl = len / n;
    out.push({ x: ax + nx * off(1), y: ay + ny * off(1) });
    for (let i = 1; i <= n; i++) {
      const atEnd = i === n;
      const px = atEnd ? bx : ax + ux * fl * i;   // exact corners, no fp drift
      const py = atEnd ? by : ay + uy * fl * i;
      out.push({ x: px + nx * off(i), y: py + ny * off(i) });
      if (!atEnd && off(i) !== off(i + 1)) {
        out.push({ x: px + nx * off(i + 1), y: py + ny * off(i + 1) });
      }
    }
    return out;
  }

  function boxPanelPoints(x0, y0, w, h, t, fw, m) {
    const pts = [];
    pts.push(...fingerEdge(x0, y0 + h, x0 + w, y0 + h, 0, 1, t, fw, m.top));
    pts.push(...fingerEdge(x0 + w, y0 + h, x0 + w, y0, 1, 0, t, fw, m.right));
    pts.push(...fingerEdge(x0 + w, y0, x0, y0, 0, -1, t, fw, m.bottom));
    pts.push(...fingerEdge(x0, y0, x0, y0 + h, -1, 0, t, fw, m.left));
    return pts;
  }

  function read(api, params) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (err) { saved = {}; }
    const p = params || {};
    const num = (k, def) => {
      const v = +p[k] != null && p[k] != null ? +p[k] : +saved[k];
      return isFinite(v) && v > 0 ? v : def;
    };
    return {
      l: num('l', 100), w: num('w', 80), h: num('h', 60),
      t: num('t', 4), fw: num('fw', 10),
      dim: (p.dim || saved.dim) === 'inside' ? 'inside' : 'outside',
      lid: p.lid != null ? !!p.lid : saved.lid !== false
    };
  }

  NS.register({
    id: 'box',
    label: 'Box maker',
    version: '1.0.0',
    icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2.5 5.5 8 2.5l5.5 3v5L8 13.5l-5.5-3z"/><path d="M2.5 5.5 8 8.5l5.5-3M8 8.5v5"/></svg>',
    title: 'Box maker: generate a finger joint box (panels laid out flat, ready to cut)',
    modalId: 'box-modal',
    guide: {
      en: {
        main: 'A finger-joint box laid out flat, ready to cut: <b>Outside</b> sizes the outer walls, <b>Inside</b> the cavity. Double click the result to edit.'
      },
      id: {
        main: 'Kotak finger joint ditata rata, siap potong: <b>Outside</b> mengukur dinding luarnya, <b>Inside</b> rongga dalamnya. Dobel-klik hasil untuk mengubah.'
      }
    },
    modal: `
<div id="box-modal" class="modal hidden">
  <div class="modal-box">
    <h3>Box maker &middot; finger joint</h3>
    <div class="opt-col">
      <label class="opt">Length (mm) <input type="number" id="box-l" value="100" step="1" min="5"></label>
      <label class="opt">Width (mm) <input type="number" id="box-w" value="80" step="1" min="5"></label>
      <label class="opt">Height (mm) <input type="number" id="box-h" value="60" step="1" min="5"></label>
      <label class="opt">Material thickness (mm) <input type="number" id="box-t" value="4" step="0.1" min="0.5"></label>
      <label class="opt">Finger width (mm) <input type="number" id="box-fw" value="10" step="1" min="1"></label>
      <label class="opt">Size is
        <select id="box-dim">
          <option value="outside">Outside</option>
          <option value="inside">Inside</option>
        </select>
      </label>
      <label class="opt"><input type="checkbox" id="box-lid" checked> Include lid (closed box)</label>
    </div>
    <div class="cnc-status" data-guide="main"></div>
    <div class="modal-actions">
      <button class="btn" id="box-cancel">Cancel</button>
      <button class="btn primary" id="box-ok">Create</button>
    </div>
  </div>
</div>`,

    open(api, params) {
      const s = read(api, params);
      const el = (id) => document.getElementById(id);
      el('box-l').value = s.l;
      el('box-w').value = s.w;
      el('box-h').value = s.h;
      el('box-t').value = s.t;
      el('box-fw').value = s.fw;
      el('box-dim').value = s.dim;
      el('box-lid').checked = s.lid;
      const ok = el('box-ok');
      if (ok) ok.focus();
    },

    apply(api) {
      const el = (id) => document.getElementById(id);
      const clamp = api.clamp, fmt = api.fmt;
      const T = clamp(+el('box-t').value || 4, 0.5, 100);
      let bl = clamp(+el('box-l').value || 100, 5, 5000);
      let bw = clamp(+el('box-w').value || 80, 5, 5000);
      let bh = clamp(+el('box-h').value || 60, 5, 5000);
      const FW = clamp(+el('box-fw').value || 10, 1, 500);
      const dim = el('box-dim').value === 'inside' ? 'inside' : 'outside';
      const lid = el('box-lid').checked;
      NS.close('box');
      try {
        localStorage.setItem(KEY, JSON.stringify({ l: bl, w: bw, h: bh, t: T, fw: FW, lid, dim }));
      } catch (err) { /* ignore */ }
      // inside dimensions: grow every axis by two walls so the cavity matches
      const inside = dim === 'inside';
      
      const sizeL = bl, sizeW = bw, sizeH = bh;
      // Panel geometry of this layout: front/back walls carry +T tabs on both
      // ends (outline bl+2T), side walls are notched (outline bw, full height),
      // caps face bl x (bw-2T) and tab all round (outline bl+2T x bw).
      // outside: pieces come out at the outer size L x W x H exactly.
      // inside: cavity must be L x W x H, so walls grow by the mating parts.
      if (inside) {
        bw += 2 * T;                       // side walls reach over the front/back walls
        bh += 2 * T;                       // bottom + lid caps add T at each end
      } else {
        bl -= 2 * T;                       // front/back end tabs complete the outer size
      }
      if (bl <= 0) {
        api.toast('Box maker: ' + fmt(sizeL) + '\u00d7' + fmt(sizeW) + '\u00d7' + fmt(sizeH) +
          ' mm is too small for ' + fmt(T) + ' mm material');
        return;
      }

      // side joints are finger joints too: the front and back parts carry tabs
      // on BOTH sides, the left and right parts notches on BOTH sides — every
      // seam pairs one of each. Top/bottom notches take the cap tabs.
      const wallTop = lid ? 'notch' : 'plain';
      const outM = { top: wallTop, bottom: 'notch', left: 'tab', right: 'tab' };
      const inM = { top: wallTop, bottom: 'notch', left: 'notch', right: 'notch' };
      const bottomM = { top: 'tab', bottom: 'tab', left: 'tab', right: 'tab' };
      const lidM = { top: 'tab', bottom: 'tab', left: 'tab', right: 'tab' };
      const panels = [];
      const gap = 8;
      // wall strip: front(l) right(w) back(l) left(w), each x height, above the
      // caps row (caps are bw tall — the rows must not overlap)
      let x = 0;
      const wallDefs = [
        { w: bl, m: outM }, { w: bw, m: inM }, { w: bl, m: outM }, { w: bw, m: inM }
      ];
      for (const def of wallDefs) {
        panels.push({ x0: x, y0: bw + gap, w: def.w, h: bh, m: def.m });
        x += def.w + gap;
      }
      const stripW = x - gap;
      // bottom (and lid) below: l x w — bottom sides stick out, lid sides cut in.
      // The rows need extra room: the tongues reach past the nominal panel size.
      const capGap = Math.max(gap * 2, gap + T * 2);
      const capH = bw - 2 * T;               // cap face = cavity; its tabs reach bw
      panels.push({ x0: 0, y0: 0, w: bl, h: capH, m: bottomM });
      if (lid) panels.push({ x0: bl + capGap, y0: 0, w: bl, h: capH, m: lidM });

      // centre the layout in the view
      const totalW = Math.max(stripW, lid ? bl + capGap + bl : bl);
      const totalH = bw + gap + bh;
      const center = api.s2w(api.getW() / 2, api.getH() / 2);
      const ox = center.x - totalW / 2;
      const oy = center.y - totalH / 2;

      api.pushHistory();
      const madeIds = [];
      for (const p of panels) {
        const pts = boxPanelPoints(ox + p.x0, oy + p.y0, p.w, p.h, T, FW, p.m);
        const id = api.addPanelEntity(pts, api.ui.color);
        if (id) madeIds.push(id);
      }
      api.commit();
      api.toast('Box maker: ' + madeIds.length + ' panels · ' + fmt(sizeL) + ' × ' +
        fmt(sizeW) + ' × ' + fmt(sizeH) + ' mm ' + (inside ? '(inside)' : '(outside)') +
        ' · material ' + fmt(T) + ' mm' + (lid ? ' · with lid' : ' · open top'));
      api.ui.selection = madeIds.map(id => ({ kind: 'entity', id }));
      api.cmdGroupSelection({ noHistory: true });
      const wrap = api.ui.selection.length === 1 ? api.state.entities[api.ui.selection[0].id] : null;
      if (wrap && wrap.type === 'art') {
        wrap.gen = { kind: 'box', params: { l: sizeL, w: sizeW, h: sizeH, t: T, fw: FW, lid, dim } };
        wrap.name = 'Box ' + fmt(sizeL) + '\u00d7' + fmt(sizeW) + '\u00d7' + fmt(sizeH);
        api.commit();
      }
    }
  });
})();
