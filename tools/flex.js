// Flex pattern: the living hinge of the Extrude wall strip, on its own.
//
// A row of slits is what lets rigid sheet stock bend. tools/wall.js draws that
// pattern on a wall strip and only where the outline curves; this is the pattern
// itself, as a rectangle you can drop anywhere: the LENGTH is the direction the
// material bends in, the WIDTH is the fold axis (the length of one slit).
//
// The hinge is not a uniform comb, and that is the whole trick, copied from
// wall.js: the bridges (the uncut webs inside one slit) are laid out
// symmetrically about the middle and dealt to two columns by their rank from the
// end, so column A owns both ends of the slit and column B cuts through them.
// A cut in one column therefore always faces solid material in its neighbour,
// which is what makes the strip bend both ways instead of collapsing along one
// fold line. `comb` collapses that to a single column pattern on purpose.
//
// The output is one framed object like every other generator, with its frame
// turned into what a flex pattern actually needs: a framed object is pinned to
// the page (horizontal guide line plus a ratio lock). Here the SIZE should be
// fixed and the ANGLE should not, so the tool drops those two constraints and
// dimensions both handle lines instead — Length on p0→pw, Width on p0→ph. The
// frame keeps three degrees of freedom: x, y and rotation. Drag it anywhere,
// drag the width handle to turn it, edit a dimension to resize it.
(() => {
  'use strict';

  const NS = window.MiniSketchTools;
  const KEY = 'minisketch.v1.flexHinge';

  const MIN_SPAN = 0.2;      // mm: a shorter cut than this is invisible to a laser
  const MIN_EDGE = 0.5;      // mm: a slit may not start exactly on an outline corner
  const fmt0 = (v) => String(Math.round(+v * 100) / 100);

  // ---- the pattern (pure, DOM-free) --------------------------------------

  // Bridges are the material a slit leaves standing; what gets emitted is what
  // lies between them, so every branch below returns CUT spans.
  //
  //   interlocked: the bridge centres run from bridgeW/2 to W - bridgeW/2, so
  //     the outermost bridges sit flush with both ends of the slit. Column A
  //     then owns both ends (outer rank 0, 2, 4 ...) and column B cuts straight
  //     through them — which is the interlock. The union of the two columns
  //     covers the full 0..W.
  //   comb: a row of n bridges with a gap on each side of every one of them,
  //     including the ends: W = (n+1)*gap + n*bridgeW. Nothing is flush, the
  //     single column still spans 0..W, and the bridges line up into stripes.
  function bridgePlan(W, bridgeW, bridgeP, comb) {
    if (!(W > 0) || !(bridgeW > 0) || !(bridgeP > 0))
      return { ok: false, why: 'width, bridge width and bridge pitch must all be above zero' };
    if (!(W > bridgeW + 2 * MIN_SPAN))
      return { ok: false, why: 'the width must leave a bridge of ' + fmt0(bridgeW) +
        ' mm and cut material on both sides of it' };

    const lists = [];
    let bridges = 0, pitch = 0;
    if (comb) {
      bridges = Math.max(1, Math.round((W + bridgeW) / bridgeP) - 1);
      pitch = (W + bridgeW) / (bridges + 1);
      const gap = pitch - bridgeW;
      if (!(gap > MIN_SPAN))
        return { ok: false, why: 'only ' + bridges + ' bridge' + (bridges === 1 ? '' : 's') +
          ' of cut material fits left and right of the bridges at ' + fmt0(bridgeP) +
          ' mm pitch — narrow the bridges or widen the pattern' };
      const bands = [];
      for (let j = 0; j < bridges; j++) {
        const a = gap + j * pitch;
        bands.push([a, a + bridgeW]);
      }
      lists.push(cuts(bands, W));
    } else {
      if (!(bridgeP > bridgeW + MIN_SPAN))
        return { ok: false, why: 'the bridge pitch must exceed the bridge width, or two neighbouring columns bridge the same height and the hinge stops interlocking' };
      const room = W - bridgeW;
      bridges = Math.max(3, Math.round(room / bridgeP) + 1);
      pitch = room / (bridges - 1);
      // three centres at least, and none of them touching the next bridge of
      // the same column: with two, A and B would be the same pattern
      if (!(pitch > bridgeW + MIN_SPAN))
        return { ok: false, why: 'only ' + bridges + ' bridges of ' + fmt0(bridgeW) +
          ' mm fit across ' + fmt0(W) + ' mm — three are needed for the two columns to differ, so widen the pattern, narrow the bridges, or pick one column (comb)' };
      const bands = { A: [], B: [] };
      for (let j = 0; j < bridges; j++) {
        const c = bridgeW / 2 + j * pitch;
        const outer = Math.min(j, bridges - 1 - j);
        bands[outer % 2 === 0 ? 'A' : 'B'].push([c - bridgeW / 2, c + bridgeW / 2]);
      }
      lists.push(cuts(bands.A, W), cuts(bands.B, W));
      if (!lists[0].length || !lists[1].length)
        return { ok: false, why: 'no cut is left between the bridges — widen the bridge pitch' };
      if (lists[0].length === lists[1].length && JSON.stringify(lists[0]) === JSON.stringify(lists[1]))
        return { ok: false, why: 'the two columns came out identical, so nothing interlocks' };
    }
    for (const list of lists) {
      if (!list.length) return { ok: false, why: 'a slit came out with no cut in it — widen the bridge pitch' };
    }
    return { ok: true, lists, bridges, pitch };
  }

  // Bridges in, cut spans out: everything before the first bridge, between two
  // bridges, and after the last one. Spans shorter than MIN_SPAN are dropped —
  // a laser would not see them and the file would only fill up.
  function cuts(bands, W) {
    const out = [];
    let y = 0;
    for (const band of bands) {
      if (band[0] - y > MIN_SPAN) out.push([y, band[0]]);
      y = Math.max(y, band[1]);
    }
    if (W - y > MIN_SPAN) out.push([y, W]);
    return out;
  }

  // Columns are spread so that the first sits at `margin` and the last at
  // L - margin: the requested pitch is nominal, what is reported is the pitch
  // that was actually achievable, and the cut area spans the length exactly.
  function columnPlan(L, cutP, margin) {
    const span = L - 2 * margin;
    if (!(span > cutP))
      return { ok: false, why: 'the end margins leave less than one cut pitch of ' + cutP + ' mm' };
    const n = Math.max(2, Math.round(span / cutP) + 1);
    const pitch = span / (n - 1);
    const xs = [];
    for (let i = 0; i < n; i++) xs.push(margin + i * pitch);
    return { ok: true, n, pitch, xs };
  }

  function buildPattern(p) {
    const length = p.length, width = p.width;
    const outline = !!p.outline;
    const style = p.style === 'comb' ? 'comb' : 'ab';
    // With an outline cut, a slit whose ENDPOINT lands exactly on a corner is
    // welded to the rectangle by the grouping bake (its chains are joined at a
    // tolerance), so the ends keep a sliver of solid material. The cap is what
    // is left of the length once two columns at the requested pitch are placed:
    // below it there is no honest margin at all, so the pattern is refused
    // rather than allowed to push a slit outside the Length x Width box.
    const floor = Math.max(MIN_EDGE, p.kerf);
    let margin = 0;
    if (outline) {
      const cap = length / 2 - p.cutPitch;
      if (!(cap >= floor))
        return { ok: false, why: 'the outline needs ' + fmt0(floor) +
          ' mm of solid material at each end and the cut pitch needs two columns, so the length must be at least ' +
          fmt0(2 * (floor + p.cutPitch)) + ' mm (or drop the outline)' };
      margin = Math.min(Math.max(p.endMargin, floor), cap);
    }
    const br = bridgePlan(width, p.bridgeW, p.bridgeP, style === 'comb');
    if (!br.ok) return br;
    const cp = columnPlan(length, p.cutPitch, margin);
    if (!cp.ok) return cp;
    if (!(cp.pitch - p.kerf > MIN_SPAN))
      return { ok: false, why: 'at ' + fmt0(cp.pitch) + ' mm the cuts are no further apart than the ' +
        fmt0(p.kerf) + ' mm beam removes, so nothing is left standing between two slits' };

    const segs = [];
    for (let i = 0; i < cp.xs.length; i++) {
      const spans = br.lists[style === 'comb' ? 0 : i % 2];
      for (const span of spans) segs.push({ x: cp.xs[i], y0: span[0], y1: span[1] });
    }
    if (!segs.length) return { ok: false, why: 'the pattern came out empty' };
    return {
      ok: true, length, width, segs, margin, style,
      rect: outline ? [{ x: 0, y: 0 }, { x: length, y: 0 },
        { x: length, y: width }, { x: 0, y: width }] : null,
      cols: cp.n, cutPitch: cp.pitch, bridges: br.bridges, bridgePitch: br.pitch,
      ligament: cp.pitch - p.kerf,
      alternates: style !== 'comb' && cp.n > 1
    };
  }

  // ---- dialog ------------------------------------------------------------

  function read(params) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (err) { saved = {}; }
    const p = params || {};
    const num = (k, def, lo) => {
      const raw = p[k] != null && p[k] !== '' ? +p[k] : +saved[k];
      return isFinite(raw) && raw >= (lo == null ? 0 : lo) ? raw : def;
    };
    const styleOf = (v) => (v === 'comb' ? 'comb' : 'ab');
    const outlineRaw = p.outline != null ? p.outline : saved.outline;
    return {
      length: num('length', 60, 6),
      width: num('width', 20, 3),
      cutPitch: num('cutPitch', 2.5, 0.6),
      bridgeW: num('bridgeW', 1.6, 0.3),
      bridgeP: num('bridgeP', 5.2, 0.6),
      endMargin: num('endMargin', 2, 0),
      kerf: num('kerf', 0.2, 0),
      outline: outlineRaw != null ? !!outlineRaw : false,
      style: styleOf(p.style != null ? p.style : saved.style)
    };
  }

  NS.register({
    id: 'flex',
    label: 'Flex pattern',
    version: '1.0.0',
    icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2" y="2.5" width="12" height="11" rx="1"/><path d="M5 4.5v3M5 10v2M8 3.5v2M8 8v3.5M11 4.5v3M11 10v2"/></svg>',
    title: 'Flex pattern: living hinge mandiri — kolom slit dengan dua pola bridge interlocking; Length arah tekuk, Width panjang slit. Dobel-klik hasilnya untuk mengubah parameter',
    modalId: 'flex-modal',
    guide: {
      en: {
        main: '<b>Length</b> bends, <b>Width</b> is one slit. Bridges break the slits; two interlocked columns bend both ways (comb = one fold line). The pitch is nominal — snapped to end on the edges, the real pitch is reported. Double click the result to edit.'
      },
      id: {
        main: '<b>Panjang</b> yang menekuk, <b>Lebar</b> satu garis potong. Bridge memutus tiap garis; dua kolom saling mengunci menekuk dua arah (sisir = satu garis lipat). Pitch nominal — disesuaikan agar berakhir di tepi, pitch aslinya dilaporkan. Dobel-klik hasil untuk mengubah.'
      }
    },
    modal: `
<div id="flex-modal" class="modal hidden">
  <div class="modal-box wide-cols">
    <h3>Flex pattern &middot; living hinge</h3>
    <div class="modal-cols">
    <div class="opt-col">
      <label class="opt">Length &mdash; bend direction (mm) <input type="number" id="flex-l" value="60" step="1" min="6"></label>
      <label class="opt">Width &mdash; slit length (mm) <input type="number" id="flex-w" value="20" step="0.5" min="3"></label>
      <label class="opt">Cut pitch (mm) <input type="number" id="flex-cp" value="2.5" step="0.1" min="0.6"></label>
      <label class="opt">Bridge width (mm) <input type="number" id="flex-bw" value="1.6" step="0.1" min="0.3"></label>
      <label class="opt">Bridge pitch (mm) <input type="number" id="flex-bp" value="5.2" step="0.1" min="0.6"></label>
      <label class="opt">End margin (mm) <input type="number" id="flex-em" value="2" step="0.5" min="0"></label>
      <label class="opt">Laser kerf (mm) <input type="number" id="flex-kerf" value="0.2" step="0.05" min="0"></label>
      <label class="opt">Bridges
        <select id="flex-style">
          <option value="ab">Two columns, interlocked</option>
          <option value="comb">One column (comb)</option>
        </select>
      </label>
      <label class="opt"><input type="checkbox" id="flex-outline"> Cut the outline rectangle</label>
    </div>
    <div class="cnc-status" data-guide="main"></div>
    </div>
    <div class="modal-actions">
      <button class="btn" id="flex-cancel">Cancel</button>
      <button class="btn primary" id="flex-ok">Create</button>
    </div>
  </div>
</div>`,

    open(api, params) {
      const s = read(params);
      const el = (id) => document.getElementById(id);
      el('flex-l').value = s.length;
      el('flex-w').value = s.width;
      el('flex-cp').value = s.cutPitch;
      el('flex-bw').value = s.bridgeW;
      el('flex-bp').value = s.bridgeP;
      el('flex-em').value = s.endMargin;
      el('flex-kerf').value = s.kerf;
      el('flex-outline').checked = s.outline;
      el('flex-style').value = s.style;
      const ok = el('flex-ok');
      if (ok) ok.focus();
    },

    apply(api) {
      const el = (id) => document.getElementById(id);
      const clamp = api.clamp, fmt = api.fmt, toast = api.toast;
      const length = clamp(+el('flex-l').value || 60, 6, 5000);
      const width = clamp(+el('flex-w').value || 20, 3, 500);
      const cutPitch = clamp(+el('flex-cp').value || 2.5, 0.6, 2000);
      const bridgeW = clamp(+el('flex-bw').value || 1.6, 0.3, 500);
      const bridgeP = clamp(+el('flex-bp').value || 5.2, 0.6, 2000);
      const endMargin = clamp(+el('flex-em').value || 0, 0, length / 2);
      const kerf = clamp(+el('flex-kerf').value || 0.2, 0, 5);
      const outline = !!el('flex-outline').checked;
      const style = el('flex-style').value === 'comb' ? 'comb' : 'ab';
      NS.close('flex');
      try {
        localStorage.setItem(KEY, JSON.stringify(
          { length, width, cutPitch, bridgeW, bridgeP, endMargin, kerf, outline, style }));
      } catch (err) { /* storage blocked */ }

      // Plan first: a hinge that cannot interlock is refused before the
      // document is touched, so one Ctrl+Z still undoes exactly one generate.
      const plan = buildPattern({ length, width, cutPitch, bridgeW, bridgeP, endMargin, kerf, outline, style });
      if (!plan.ok) {
        toast('Flex pattern: ' + plan.why);
        return;
      }

      api.pushHistory();

      // Where it goes: on top of whatever is selected, else the middle of the
      // view. A re-edit keeps the previous strip's pose instead.
      const picked = api.selectedEntities().filter(e =>
        !(e.type === 'art' && e.gen && e.gen.kind === 'flex'));
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const e of picked) {
        for (const pl of api.entityWorldPolylines(e)) {
          for (const q of pl.pts || []) {
            if (!isFinite(q.x) || !isFinite(q.y)) continue;
            if (q.x < minX) minX = q.x;
            if (q.x > maxX) maxX = q.x;
            if (q.y < minY) minY = q.y;
            if (q.y > maxY) maxY = q.y;
          }
        }
      }
      const centre = isFinite(minX) ? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } : null;

      // The old frame's origin and its two axis directions, read before the
      // previous strip is replaced — they are put back on the new frame below.
      let pose = null;
      const sel = api.ui.selection || [];
      if (sel.length === 1 && sel[0].kind === 'entity') {
        const prev = api.state.entities[sel[0].id];
        if (prev && prev.type === 'art' && prev.gen && prev.gen.kind === 'flex') {
          const o = api.P(prev.p0), w = api.P(prev.pw), h = api.P(prev.ph);
          if (o && w && h) {
            const len = Math.hypot(w.x - o.x, w.y - o.y);
            if (len > 1e-6) {
              const A = { x: (w.x - o.x) / len, y: (w.y - o.y) / len };
              // the old height direction, orthogonalised against A (a frame the
              // user skewed keeps its side of the fold)
              let B = { x: h.x - o.x, y: h.y - o.y };
              B = { x: B.x - A.x * (B.x * A.x + B.y * A.y), y: B.y - A.y * (B.x * A.x + B.y * A.y) };
              const bl = Math.hypot(B.x, B.y);
              pose = {
                x: o.x, y: o.y,
                ax: A.x, ay: A.y,
                bx: bl > 1e-6 ? B.x / bl : A.y, by: bl > 1e-6 ? B.y / bl : -A.x
              };
            }
          }
          api.removeEntity(prev.id);
        }
      }

      // The rebuilt geometry is always emitted axis aligned — the frame a group
      // gets is the bounding box of its contours, and only an axis aligned box
      // maps onto Length x Width exactly. The pose above is applied to the frame
      // afterwards instead, which turns (and moves) the whole pattern rigidly.
      const here = centre || api.s2w(api.getW() / 2, api.getH() / 2);
      const ox = here.x - length / 2, oy = here.y - width / 2;
      const at = (x, y) => ({ x: ox + x, y: oy + y });

      const color = api.ui.color;
      const madeIds = [];
      const emit = (pts, closed) => {
        const id = closed ? api.addPanelEntity(pts, color) : api.addPolylineEntity(pts, color);
        if (id) madeIds.push(id);
      };
      if (plan.rect) emit(plan.rect.map(p => at(p.x, p.y)), true);
      for (const s of plan.segs) emit([at(s.x, s.y0), at(s.x, s.y1)], false);
      api.commit();
      if (!madeIds.length) {
        toast('Flex pattern: could not build the cuts');
        return;
      }

      api.ui.selection = madeIds.map(id => ({ kind: 'entity', id }));
      api.cmdGroupSelection({ noHistory: true });
      const wrap = api.ui.selection.length === 1 ? api.state.entities[api.ui.selection[0].id] : null;
      if (!wrap || wrap.type !== 'art') {
        toast('Flex pattern: the cuts are there, but they could not be wrapped');
        return;
      }

      // A framed object is pinned to the page: its width line is horizontal and
      // its ratio is locked. A hinge has to be turned to lie along an edge, so
      // the angle is set free and the size is carried by two dimensions instead
      // — the app releases the ratio lock on its own once both handle lines are
      // dimensioned, but dropping it here keeps the constraint panel honest.
      const guides = (wrap.guide || []).map(Number);
      const cs = api.state.constraints;
      for (const cid in cs) {
        const c = cs[cid];
        if (!c) continue;
        if ((c.type === 'horizontal' || c.type === 'vertical') && guides.indexOf(+c.entity) >= 0) delete cs[cid];
        else if (c.type === 'aspect' && +c.entity === +wrap.id) delete cs[cid];
      }
      // Driving dimensions (never `reference`: those do not count as dimensioned
      // handles, and the ratio lock would stay and fight them).
      const dim = (p1, p2, value, offset) => {
        const id = api.newId();
        cs[id] = { id, type: 'distance', p1, p2, value: api.round2(value), offset };
      };
      dim(wrap.p0, wrap.pw, length, 10);
      dim(wrap.p0, wrap.ph, width, -10);
      if (pose) {
        // the frame came back axis aligned; put it where the user left it, and
        // the two dimensions above are then already satisfied exactly
        const p0 = api.state.points[wrap.p0], pw = api.state.points[wrap.pw], ph = api.state.points[wrap.ph];
        if (p0 && pw && ph) {
          p0.x = pose.x; p0.y = pose.y;
          pw.x = pose.x + pose.ax * length; pw.y = pose.y + pose.ay * length;
          ph.x = pose.x + pose.bx * width; ph.y = pose.y + pose.by * width;
        }
      }

      wrap.gen = {
        kind: 'flex',
        params: { length, width, cutPitch, bridgeW, bridgeP, endMargin, kerf, outline, style }
      };
      wrap.name = 'Flex ' + fmt(length) + '\u00d7' + fmt(width) + ' \u00b7 ' + plan.cols +
        ' slit' + (plan.cols === 1 ? '' : 's');
      api.requestSolve();
      api.commit();
      toast('Flex pattern: ' + fmt(length) + '\u00d7' + fmt(width) + ' mm \u00b7 ' +
        plan.cols + ' slit column' + (plan.cols === 1 ? '' : 's') + ' at ' + fmt(plan.cutPitch) +
        ' mm \u00b7 ' + plan.bridges + ' bridge' + (plan.bridges === 1 ? '' : 's') + ' of ' +
        fmt(bridgeW) + ' mm every ' + fmt(plan.bridgePitch) + ' mm \u00b7 ' + plan.segs.length +
        ' cut line' + (plan.segs.length === 1 ? '' : 's') +
        ' \u00b7 ' + fmt(plan.ligament) + ' mm left standing between two slits' +
        (plan.rect ? ' \u00b7 outline cut, ' + fmt(plan.margin) + ' mm of solid at each end' : '') +
        ' \u00b7 ' + (plan.alternates ? 'two interlocked columns, bends both ways' : 'one column, folds on one line') +
        ' \u00b7 rotation free');
    }
  });
})();
