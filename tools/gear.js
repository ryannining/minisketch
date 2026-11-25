// Gear maker: spur gear, matching rack, and pulleys / 3D gears from flat stock.
//
// Involute spur gear (metric module), matching rack, and pulleys built from flat
// stock: the body is cut round(width / material) times and a flange disc goes on
// each side. Every piece lands as its own closed loops, grouped and selected.
(() => {
  'use strict';

  const NS = window.MiniSketchTools;
  const KEY = 'minisketch.v1.gearMaker';
  const TAU = Math.PI * 2;

  function gearPoints(m, z, alphaDeg, cx, cy) {
    const alpha = (alphaDeg || 20) * Math.PI / 180;
    const rp = m * z / 2;
    const rb = rp * Math.cos(alpha);
    const ra = rp + m;
    const rf = Math.max(rp - 1.25 * m, m * 0.25);
    const inv = (phi) => Math.tan(phi) - phi;
    const half = Math.PI / (2 * z);            // half tooth angle at the pitch circle
    const flankAng = (r) => {
      const phi = r > rb ? Math.acos(Math.min(1, rb / r)) : 0;
      return half + inv(alpha) - inv(phi);
    };
    const pts = [];
    const pushPolar = (r, a) => pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    const rStart = Math.max(rf, rb);
    const aRoot = flankAng(rStart);
    const step = 6;
    for (let k = 0; k < z; k++) {
      const c = k * TAU / z;
      if (rf < rb - 1e-9) pushPolar(rf, c - aRoot);        // radial drop to the root
      for (let i = 0; i <= step; i++) {                     // right flank up
        const r = rStart + (ra - rStart) * (i / step);
        pushPolar(r, c - flankAng(r));
      }
      const ta = flankAng(ra);
      for (let i = 1; i <= 2; i++) pushPolar(ra, c - ta + 2 * ta * (i / 3));  // tip arc
      for (let i = step; i >= 0; i--) {                     // left flank down
        const r = rStart + (ra - rStart) * (i / step);
        pushPolar(r, c + flankAng(r));
      }
      if (rf < rb - 1e-9) pushPolar(rf, c + aRoot);
      const nextC = (k + 1) * TAU / z;
      if (rf < rb - 1e-9) pushPolar(rf, (c + nextC) / 2);   // root arc
    }
    return pts;
  }

  function rackPoints(m, z, alphaDeg, cx, cy) {
    const alpha = (alphaDeg || 20) * Math.PI / 180;
    const pitch = Math.PI * m;                 // one tooth + one gap along the pitch line
    const a = m, d = 1.25 * m;
    const halfT = Math.PI * m / 4;             // half tooth thickness on the pitch line
    const wt = Math.max(halfT - a * Math.tan(alpha), m * 0.05);
    const wr = halfT + d * Math.tan(alpha);
    const len = z * pitch;
    const body = -d - Math.max(m * 2, d);
    const pts = [{ x: 0, y: body }, { x: 0, y: -d }];
    for (let k = 0; k < z; k++) {
      const xk = k * pitch + pitch / 2;
      pts.push({ x: xk - wr, y: -d }, { x: xk - wt, y: a }, { x: xk + wt, y: a }, { x: xk + wr, y: -d });
    }
    pts.push({ x: len, y: -d }, { x: len, y: body });
    return pts.map(p => ({ x: cx + p.x - len / 2, y: cy + p.y - (a + body) / 2 }));
  }

  function circlePts(cx, cy, r) {
    const n = Math.max(24, Math.min(360, Math.ceil(r * 4)));
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = TAU * i / n;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return pts;
  }

  function updateFields() {
    const typeEl = document.getElementById('gear-type');
    const type = typeEl ? typeEl.value : 'gear';
    const show = (id, on) => {
      const el = document.getElementById(id);
      if (el) el.style.display = on ? '' : 'none';
    };
    show('tooth-fields', type !== 'pulley');        // module / teeth / angle
    show('rack-fields', type === 'rack');           // rack height
    show('pulley-fields', type === 'pulley');       // outer + set screws
    show('bore-field', type !== 'rack');            // shaft hole
    show('stack-fields', type !== 'rack');          // 3D build: width / thickness / flange
  }

  function read(params) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (err) { saved = {}; }
    const p = params || {};
    const pick = (k, def, min) => {
      const raw = p[k] != null ? +p[k] : +saved[k];
      return isFinite(raw) && raw >= min ? raw : def;
    };
    const type = p.type || saved.type;
    return {
      type: type === 'rack' ? 'rack' : type === 'pulley' ? 'pulley' : 'gear',
      module: pick('module', 2, 0.2),
      teeth: Math.round(pick('teeth', 24, 6)),
      alpha: pick('alpha', 20, 1),
      bore: Math.min(4000, Math.max(0, p.bore != null ? +p.bore : (isFinite(+saved.bore) ? +saved.bore : 8))),
      height: pick('height', 15, 2),
      od: pick('od', 50, 5),
      width: pick('width', 10, 0.1),
      thick: pick('thick', 2, 0.1),
      flange: Math.max(0, p.flange != null ? +p.flange : (isFinite(+saved.flange) ? +saved.flange : 60)),
      screws: Math.max(0, Math.round(p.screws != null ? +p.screws : (isFinite(+saved.screws) ? +saved.screws : 2))),
      screwD: pick('screwD', 4, 0.5)
    };
  }

  NS.register({
    id: 'gear',
    label: 'Gear',
    version: '1.0.0',
    icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1"/><circle cx="8" cy="8" r="4.6"/></svg>',
    title: 'Gear maker: spur gear, rack, or a pulley / 3D gear cut from flat stock with flanges',
    modalId: 'gear-modal',
    guide: {
      en: {
        main: 'Spur gear, rack or pulley from flat stock: <b>Module</b> and <b>Teeth</b> size the gear; a pulley stacks body layers between two flanges. Double click the result to edit.'
      },
      id: {
        main: 'Spur gear, rack atau pulley dari lembaran: <b>Module</b> dan <b>Teeth</b> menentukan ukuran gear; pulley menumpuk lapisan body di antara dua flange. Dobel-klik hasil untuk mengubah.'
      }
    },
    modal: `
<div id="gear-modal" class="modal hidden">
  <div class="modal-box">
    <h3>Gear maker</h3>
    <div class="opt-col">
      <label class="opt">Type
        <select id="gear-type">
          <option value="gear">Spur gear</option>
          <option value="rack">Rack</option>
          <option value="pulley">Pulley</option>
        </select>
      </label>
      <div id="tooth-fields">
        <label class="opt">Module (mm) <input type="number" id="gear-module" value="2" step="0.1" min="0.2"></label>
        <label class="opt">Teeth <input type="number" id="gear-teeth" value="24" step="1" min="6"></label>
        <label class="opt">Pressure angle (&deg;) <input type="number" id="gear-alpha" value="20" step="1" min="10" max="45"></label>
      </div>
      <div id="rack-fields">
        <label class="opt">Rack height (mm) <input type="number" id="gear-height" value="15" step="1" min="2"></label>
      </div>
      <div id="pulley-fields">
        <label class="opt">Outer diameter (mm) <input type="number" id="gear-od" value="50" step="1" min="5"></label>
        <label class="opt">Set screws <input type="number" id="gear-screws" value="2" step="1" min="0" max="12"></label>
        <label class="opt">Screw diameter (mm) <input type="number" id="gear-screw-d" value="4" step="0.5" min="0.5"></label>
      </div>
      <div id="bore-field">
        <label class="opt">Shaft hole / bore (mm) <input type="number" id="gear-bore" value="8" step="0.5" min="0"></label>
      </div>
      <div id="stack-fields">
        <label class="opt">Body width (mm) <input type="number" id="gear-width" value="10" step="1" min="0.1"></label>
        <label class="opt">Material thickness (mm) <input type="number" id="gear-thick" value="2" step="0.1" min="0.1"></label>
        <label class="opt">Flange diameter (mm, 0 = none) <input type="number" id="gear-flange" value="60" step="1" min="0"></label>
      </div>
    </div>
    <div class="cnc-status" data-guide="main"></div>
    <div class="modal-actions">
      <button class="btn" id="gear-cancel">Cancel</button>
      <button class="btn primary" id="gear-ok">Create</button>
    </div>
  </div>
</div>`,

    wire() {
      const typeEl = document.getElementById('gear-type');
      if (typeEl) typeEl.addEventListener('change', updateFields);
    },

    open(api, params) {
      const s = read(params);
      const el = (id) => document.getElementById(id);
      el('gear-type').value = s.type;
      el('gear-module').value = s.module;
      el('gear-teeth').value = s.teeth;
      el('gear-alpha').value = s.alpha;
      el('gear-bore').value = s.bore;
      el('gear-height').value = s.height;
      el('gear-od').value = s.od;
      el('gear-width').value = s.width;
      el('gear-thick').value = s.thick;
      el('gear-flange').value = s.flange;
      el('gear-screws').value = s.screws;
      el('gear-screw-d').value = s.screwD;
      updateFields();
    },

    apply(api) {
      const el = (id) => document.getElementById(id);
      const clamp = api.clamp, fmt = api.fmt;
      const type = el('gear-type').value === 'rack' ? 'rack'
        : el('gear-type').value === 'pulley' ? 'pulley' : 'gear';
      const moduleM = clamp(+el('gear-module').value || 2, 0.2, 50);
      const teeth = clamp(Math.round(+el('gear-teeth').value || 24), 6, 400);
      const alpha = clamp(+el('gear-alpha').value || 20, 10, 45);
      const bore = clamp(+el('gear-bore').value || 0, 0, 4000);
      const height = clamp(+el('gear-height').value || 15, 2, 500);
      const od = clamp(+el('gear-od').value || 50, 5, 5000);
      const width = clamp(+el('gear-width').value || 10, 0.1, 500);
      const thick = clamp(+el('gear-thick').value || 2, 0.1, 100);
      const flange = clamp(+el('gear-flange').value || 0, 0, 5000);
      const screws = clamp(Math.round(+el('gear-screws').value || 0), 0, 12);
      const screwD = clamp(+el('gear-screw-d').value || 4, 0.5, 100);
      NS.close('gear');
      try {
        localStorage.setItem(KEY, JSON.stringify({
          type, module: moduleM, teeth, alpha, bore, height, od, width, thick, flange, screws, screwD
        }));
      } catch (err) { /* ignore */ }

      // 3D build from flat stock: the body is cut round(width / thick) times and
      // a flange disc goes on each side ("kuping pinggir")
      const bodyN = Math.max(1, Math.round(width / thick));
      const parts = [];                             // { d, kind: gear|disc|rack }
      if (type === 'rack') {
        parts.push({ kind: 'rack', d: moduleM * teeth });
      } else if (type === 'gear') {
        const dGear = moduleM * teeth + 2 * moduleM;
        for (let i = 0; i < bodyN; i++) parts.push({ kind: 'gear', d: dGear, screws: false });
        if (flange > 0) { parts.push({ kind: 'disc', d: flange, flange: true }); parts.push({ kind: 'disc', d: flange, flange: true }); }
      } else {
        for (let i = 0; i < bodyN; i++) parts.push({ kind: 'disc', d: od, screws: true });
        if (flange > 0) { parts.push({ kind: 'disc', d: flange, flange: true }); parts.push({ kind: 'disc', d: flange, flange: true }); }
      }

      // lay the pieces in a row, centred in the view
      const gap = 8;
      const totalW = parts.reduce((s, p) => s + p.d, 0) + gap * (parts.length - 1);
      const center = api.s2w(api.getW() / 2, api.getH() / 2);
      let x = center.x - totalW / 2;

      api.pushHistory();
      const madeIds = [];
      const addLoop = (pts) => {
        const id = api.addPanelEntity(pts, api.ui.color);
        if (id) madeIds.push(id);
      };
      for (const part of parts) {
        const px = x + part.d / 2;
        const py = center.y;
        if (part.kind === 'gear') {
          addLoop(gearPoints(moduleM, teeth, alpha, px, py));
        } else if (part.kind === 'rack') {
          addLoop(rackPoints(moduleM, teeth, alpha, px, py));
        } else {
          addLoop(circlePts(px, py, part.d / 2));
        }
        if (part.kind !== 'rack') {
          if (bore > 0) addLoop(circlePts(px, py, bore / 2));
          if (part.screws && screws > 0) {
            const sr = bore / 2 + screwD;
            if (sr + screwD / 2 < part.d / 2) {
              for (let i = 0; i < screws; i++) {
                const a = TAU * i / screws;
                addLoop(circlePts(px + sr * Math.cos(a), py + sr * Math.sin(a), screwD / 2));
              }
            }
          }
        }
        x += part.d + gap;
      }
      api.commit();
      const what = type === 'gear'
        ? ('Gear \u00b7 module ' + fmt(moduleM) + ' \u00b7 ' + teeth + ' teeth \u00b7 ' + bodyN + ' layers')
        : type === 'rack'
          ? ('Rack \u00b7 module ' + fmt(moduleM) + ' \u00b7 ' + teeth + ' teeth')
          : ('Pulley \u00b7 \u00d8' + fmt(od) + ' \u00d7 ' + bodyN + ' layers + 2 flanges');
      api.toast('Gear maker: ' + what + ' \u00b7 ' + madeIds.length + ' loop' + (madeIds.length === 1 ? '' : 's'));
      api.ui.selection = madeIds.map(id => ({ kind: 'entity', id }));
      api.cmdGroupSelection({ noHistory: true });
      const wrap = api.ui.selection.length === 1 ? api.state.entities[api.ui.selection[0].id] : null;
      if (wrap && wrap.type === 'art') {
        wrap.gen = {
          kind: 'gear',
          params: { type, module: moduleM, teeth, alpha, bore, height, od, width, thick, flange, screws, screwD }
        };
        wrap.name = type === 'gear' ? ('Gear m' + fmt(moduleM) + ' \u00b7 ' + teeth + 'T')
          : type === 'rack' ? ('Rack m' + fmt(moduleM) + ' \u00b7 ' + teeth + 'T')
            : ('Pulley \u00d8' + fmt(od));
        api.commit();
      }
    }
  });
})();
