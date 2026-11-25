// Spiral: an Archimedean spiral that starts on the INNER ring, not the centre.
//
// The path opens at diameter dalam (half-way up the inner circle) and the
// radius grows by `pitch` every full turn until it reaches diameter luar, so
// the middle stays empty — the shape a plasma/laser spiral cut expects, where
// a centre start would pillar the sheet. Choose the generator either by pitch
// (the number of turns is fitted to the gap and the realised pitch is
// reported) or by turn count (the pitch follows). The maths lives in
// planSpiral()/spiralPoints(): pure and DOM-free, which is what
// testing/spiral_probe.js slices and asserts on; apply() only reads the
// dialog, places the result and writes it as one named, re-editable group.
(() => {
  'use strict';

  const NS = window.MiniSketchTools;
  const KEY = 'minisketch.v1.spiral';
  const ARC_ERR = 0.02;      // mm: max deviation of one chord from the true arc
  const MAX_TURNS = 400;
  const MAX_STARTS = 8;
  const MODES = ['pitch', 'loops'];

  // Parameters -> the honest numbers. Turns are always whole per arm so every
  // arm ends at radius ro on its own start bearing; a pitch that does not
  // divide the gap is realised as the nearest whole turn count, never as a
  // truncated arc. `pitch` is the gap BETWEEN ADJACENT ARMS (what the beam
  // sees); each individual arm therefore grows S times that per turn — the
  // multi-start thread convention, lead = starts × pitch.
  function planSpiral(p) {
    const di = +p.di, dout = +p.dout, pitch = +p.pitch, loops = +p.loops;
    const mode = MODES.indexOf(p.mode) >= 0 ? p.mode : 'pitch';
    const S = Math.round(p.starts == null ? 1 : +p.starts);
    if (!(S >= 1 && S <= MAX_STARTS)) {
      return { ok: false, why: 'jumlah start harus bulat 1 sampai ' + MAX_STARTS };
    }
    if (!(di > 0)) {
      return { ok: false, why: 'diameter dalam harus lebih dari 0 — spiral mulai dari cincin dalam, bukan dari titik tengah' };
    }
    if (!(dout > di)) {
      return { ok: false, why: 'diameter luar harus lebih dari diameter dalam' };
    }
    const ri = di / 2, ro = dout / 2;
    const gap = ro - ri;
    let n;
    if (mode === 'pitch') {
      if (!(pitch > 0)) return { ok: false, why: 'pitch harus lebih dari 0' };
      if (S * pitch > gap + 1e-9) {
        return { ok: false, why: 'pitch ' + fmt2(pitch) + ' mm × ' + S + ' start = ' + fmt2(S * pitch) +
          ' mm per lilitan lengan, lebih besar dari selisih radius ' + fmt2(gap) + ' mm — satu lilitan pun tidak muat' };
      }
      n = Math.max(1, Math.round(gap / (S * pitch)));
    } else {
      if (!(loops >= 1) || !isFinite(loops)) return { ok: false, why: 'jumlah lilitan minimal 1' };
      n = Math.round(loops);
      if (n > MAX_TURNS) return { ok: false, why: 'jumlah lilitan terlalu banyak (maks ' + MAX_TURNS + ')' };
    }
    return { ok: true, ri, ro, n, S, pitch: gap / (S * n), lead: gap / n, gap };
  }

  // Two small format helpers used inside plan's refusal text; kept as function
  // declarations so the probe's brace-matching slicer can pick up planSpiral
  // without dragging the whole file in.
  function fmt2(v) { return String(Math.round(+v * 1000) / 1000); }

  // Sampled points around (0,0), CCW, theta from `phase` to phase + 2*pi*n,
  // the arm's own radius growing from ri to ro. The dense polyline is only an
  // intermediate: apply() refits it to real Bézier nodes, so the step size is
  // set by ARC_ERR at the outermost radius (err = r·dθ²/8) and the machine
  // never sees a polygonalised arc. The step count is a whole multiple of 4
  // turns so bearings 0/90/180/270 always land on a sample relative to the
  // phase: that is what makes the bounding box hit its exact extremes instead
  // of missing them by one sample.
  function spiralPoints(ri, ro, n, phase) {
    const total = 2 * Math.PI * n;
    const lead = (ro - ri) / n;
    const ph = +phase || 0;
    const dth = Math.sqrt(8 * ARC_ERR / ro);
    const unit = 4 * n;
    let steps = Math.max(9 * unit, Math.ceil(total / dth / unit) * unit);
    if (steps > 24000) steps = Math.max(unit, Math.floor(24000 / unit) * unit);
    const pts = [];
    for (let k = 0; k <= steps; k++) {
      const t = total * k / steps;
      const r = ri + lead * t / (2 * Math.PI);
      const th = ph + t;
      pts.push({ x: r * Math.cos(th), y: r * Math.sin(th) });
    }
    return pts;
  }

  function read(params) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (err) { saved = {}; }
    const p = params || {};
    const num = (k, def, lo) => {
      const raw = p[k] != null && p[k] !== '' ? +p[k] : +saved[k];
      return isFinite(raw) && raw >= (lo == null ? 0 : lo) ? raw : def;
    };
    const mode = p.mode || saved.mode;
    return {
      di: num('di', 20, 0.5),
      dout: num('dout', 80, 1),
      pitch: num('pitch', 3, 0.05),
      loops: num('loops', 6, 1),
      starts: num('starts', 1, 1),
      mode: MODES.indexOf(mode) >= 0 ? mode : 'pitch'
    };
  }

  NS.register({
    id: 'spiral',
    label: 'Spiral',
    version: '1.0.0',
    icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M8.4 8a.9.9 0 1 1-1.8 0 2.2 2.2 0 1 1 4.4 0 3.7 3.7 0 1 1-7.4 0 5.3 5.3 0 1 1 10.6 0"/></svg>',
    title: 'Spiral Archimedes: mulai dari lingkaran dalam (bukan titik tengah), melebar tiap lilitan sampai diameter luar; bisa 2 start atau lebih (lengan berselang-seling yang tidak saling memotong). Klik ganda hasilnya untuk mengubah parameter',
    modalId: 'spiral-modal',
    guide: {
      en: {
        main: 'Archimedean spiral from the <b>inner diameter</b> to the outer one; each arm grows <b>pitch &times; starts</b> per turn, so multiple arms never touch. Turns per arm stay whole — the pitch is adjusted and reported. Double click to edit (don\'t drag the frame: the pattern stretches with it).'
      },
      id: {
        main: 'Spiral Archimedes dari <b>diameter dalam</b> ke diameter luar; tiap lengan melebar <b>pitch &times; jumlah start</b> per putaran, jadi banyak lengan tidak pernah bersentuhan. Lilitan tiap lengan selalu bulat — pitch disesuaikan dan dilaporkan. Dobel-klik untuk mengubah (jangan tarik bingkainya: polanya ikut terulur).'
      }
    },
    modal: `
<div id="spiral-modal" class="modal hidden">
  <div class="modal-box">
    <h3>Spiral</h3>
    <div class="opt-col">
      <label class="opt" title="Diameter of the circle the spiral starts on — the first point sits at this radius, not at the centre.">Inner diameter (mm) <input type="number" id="sp-di" value="20" step="1" min="0.5"></label>
      <label class="opt">Outer diameter (mm) <input type="number" id="sp-do" value="80" step="1" min="1"></label>
      <label class="opt" title="How many identical spiral arms, rotated by 360&deg;/count. 2 = two arms interleaved left-right (180&deg;); 4 = four arms every 90&deg;. Adjacent arms always keep exactly one pitch apart, so arms never cross.">Starts <input type="number" id="sp-starts" value="1" step="1" min="1" max="8"></label>
      <label class="opt">Driven by
        <select id="sp-mode">
          <option value="pitch">Pitch (arm spacing)</option>
          <option value="loops">Turns</option>
        </select>
      </label>
      <label class="opt" title="Distance between adjacent arms. Each arm itself grows pitch &times; starts per full turn.">Pitch (mm) <input type="number" id="sp-pitch" value="3" step="0.5" min="0.05"></label>
      <label class="opt">Turns per arm <input type="number" id="sp-loops" value="6" step="1" min="1"></label>
      <div class="cnc-status" data-guide="main"></div>
    </div>
    <div class="modal-actions">
      <button class="btn" id="spiral-cancel">Cancel</button>
      <button class="btn primary" id="spiral-ok">Create</button>
    </div>
  </div>
</div>`,

    open(api, params) {
      const s = read(params);
      const el = (id) => document.getElementById(id);
      el('sp-di').value = s.di;
      el('sp-do').value = s.dout;
      el('sp-starts').value = s.starts;
      el('sp-pitch').value = s.pitch;
      el('sp-loops').value = s.loops;
      el('sp-mode').value = s.mode;
      const ok = el('spiral-ok');
      if (ok) ok.focus();
    },

    apply(api) {
      const el = (id) => document.getElementById(id);
      const fmt = api.fmt, toast = api.toast;
      const di = api.clamp(+el('sp-di').value || 20, 0.5, 4000);
      const dout = api.clamp(+el('sp-do').value || 80, 1, 4000);
      const starts = Math.round(api.clamp(+el('sp-starts').value || 1, 1, MAX_STARTS));
      const pitch = api.clamp(+el('sp-pitch').value || 3, 0.05, 2000);
      const loops = Math.round(api.clamp(+el('sp-loops').value || 6, 1, MAX_TURNS));
      const modeVal = el('sp-mode').value;
      const mode = MODES.indexOf(modeVal) >= 0 ? modeVal : 'pitch';
      NS.close('spiral');
      try { localStorage.setItem(KEY, JSON.stringify({ di, dout, pitch, loops, starts, mode })); }
      catch (err) { /* storage blocked */ }

      // plan first: an impossible spiral is refused before anything is written
      const p = planSpiral({ di, dout, pitch, loops, starts, mode });
      if (!p.ok) { toast('Spiral: ' + p.why); return; }

      api.pushHistory();

      // A re-edit arrives with the previous spiral still selected: keep its
      // centre (the frame of an open spiral is not centred on the spiral's
      // own origin, so re-centring on the view would creep each time) and
      // replace the old group instead of leaving a second copy.
      let centre = api.s2w(api.getW() / 2, api.getH() / 2);
      const sel = api.ui.selection || [];
      if (sel.length === 1 && sel[0].kind === 'entity') {
        const prev = api.state.entities[sel[0].id];
        if (prev && prev.type === 'art' && prev.gen && prev.gen.kind === 'spiral') {
          const pw = api.P(prev.pw), ph = api.P(prev.ph);
          if (pw && ph) centre = { x: (pw.x + ph.x) / 2, y: (pw.y + ph.y) / 2 };
          api.removeEntity(prev.id);
        }
      }

      // one arm per start, each rotated 360°/S around the shared centre
      const color = api.ui.color;
      const madeIds = [];
      for (let k = 0; k < p.S; k++) {
        const world = spiralPoints(p.ri, p.ro, p.n, 2 * Math.PI * k / p.S)
          .map(q => ({ x: q.x + centre.x, y: q.y + centre.y }));
        let id = api.addFittedCurve(world, color, { tol: ARC_ERR, closed: false });
        if (!id) id = api.addPolylineEntity(world, color);
        if (id) madeIds.push(id);
      }
      api.commit();
      if (!madeIds.length) { toast('Spiral: gagal membuat geometri'); return; }

      api.ui.selection = madeIds.map(id => ({ kind: 'entity', id }));
      api.cmdGroupSelection({ noHistory: true });
      const wrap = api.ui.selection.length === 1
        ? api.state.entities[api.ui.selection[0].id] : null;
      if (!wrap || wrap.type !== 'art') {
        toast('Spiral: bentuknya ada tapi tidak terbungkus grup');
        return;
      }
      wrap.gen = { kind: 'spiral', params: { di, dout, pitch, loops, starts, mode } };
      wrap.name = 'Spiral \u00d8' + fmt(di) + '\u2192' + fmt(dout) +
        ' \u00b7 ' + p.S + ' start \u00b7 ' + p.n + ' lilitan';
      api.commit();
      let msg = 'Spiral: \u00d8' + fmt(di) + ' \u2192 \u00d8' + fmt(dout) + ' mm \u00b7 ' +
        p.n + ' lilitan \u00b7 pitch ' + fmt(p.pitch) + ' mm' +
        (p.S > 1 ? ' \u00b7 ' + p.S + ' lengan' : '');
      if (mode === 'pitch' && Math.abs(p.pitch - pitch) > 1e-9) {
        msg += ' (disesuaikan dari ' + fmt(pitch) + ')';
      }
      toast(msg);
    }
  });
})();
