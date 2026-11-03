// Slot: a centreline path -> one slot outline with round ends.
//
// The path may be made of lines, curves, arcs or circles: every kind is sampled
// to the requested detail first, so a curved path is followed exactly instead of
// along the display tessellation. The offset itself is Clipper's, and the result
// is fitted back to real Bezier curves — a straight run stays straight and a
// curve stays a curve, so the slot reads as smooth geometry instead of a
// hundred-segment polyline.
//
// The originals are kept; the result is one named group whose gen carries the
// source chains, so a double click rebuilds it.
(() => {
  'use strict';

  const NS = window.MiniSketchTools;
  const KEY = 'minisketch.v1.slotMaker';
  const DEFAULT_DETAIL = 0.05;      // mm: max deviation of the fitted outline
  const SHARP_ANGLE = 25;           // corners sharper than this stay corners
  // two source vertices closer than this are one joint (the Settings chain
  // tolerance): they get sewn together before the offset sees them
  const BAKE_EPS = 0.1;

  // Sampling density for the SOURCE. Finer than the output detail: the offset
  // has to follow the true curve, otherwise the fit would smooth over faceting
  // that is already baked into the offset polyline.
  function sourceTol(detail) {
    return Math.max(0.005, Math.min(0.02, detail / 4));
  }

  function cleanPath(pts) {
    const out = [];
    for (const p of pts || []) {
      const last = out[out.length - 1];
      if (last && Math.hypot(last.x - p.x, last.y - p.y) < 1e-7) continue;
      out.push({ x: +p.x, y: +p.y });
    }
    return out;
  }

  // chainPolylines GLUES pieces (concat) without sewing: two ends up to the
  // join tolerance apart stay two vertices, so the chained path carries a
  // tiny random-direction jog every place two lines met. On a curve source
  // that never happens (the flatten is continuous); on a polyline source the
  // jogs are what bent the offset into waves. Sew every such pair onto its
  // midpoint — the same compromise Ctrl+G makes when it welds.
  function stitchChains(chains, tol) {
    for (const c of chains || []) {
      const pts = c.pts || [];
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        if (d > 1e-9 && d <= tol) {
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          a.x = b.x = mx;
          a.y = b.y = my;
        }
      }
    }
  }

  function toClipperPaths(api, chains) {
    const scale = api.offsetScale;
    return chains
      .filter(c => c.pts && c.pts.length >= 2)
      .map(c => c.pts.map(pt => ({ X: Math.round(pt.x * scale), Y: Math.round(pt.y * scale) })));
  }

  function fromClipperPaths(api, raw) {
    const scale = api.offsetScale;
    const out = [];
    for (const path of raw) {
      if (!path || path.length < 3) continue;
      const pts = path.map(pt => ({ x: pt.X / scale, y: pt.Y / scale }));
      // dedupe close repeats AND micro backtracks: a spike out-and-back (the
      // same vertex twice, a hair apart) survives a pure dedupe and comes out
      // of the fitter as a bump
      const dedup = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        const q = pts[i];
        const last = dedup[dedup.length - 1];
        if (Math.hypot(q.x - last.x, q.y - last.y) <= api.offsetPrecision * 0.5) continue;
        if (dedup.length >= 2) {
          const prev = dedup[dedup.length - 2];
          const ux = last.x - prev.x, uy = last.y - prev.y;
          const vx = q.x - last.x, vy = q.y - last.y;
          if (ux * vx + uy * vy < 0) dedup.pop();   // reversed direction
        }
        dedup.push(q);
      }
      // a closed ring repeats its first point
      if (dedup.length > 2) {
        const a = dedup[0], b = dedup[dedup.length - 1];
        if (Math.hypot(a.x - b.x, a.y - b.y) <= api.offsetPrecision) dedup.pop();
      }
      if (dedup.length >= 3 && Math.abs(api.signedAreaPts(dedup)) >= 1e-6) {
        // Clipper leaves only 2 vertices (endpoints) for a long straight run.
        // The curve fitter's straight-span detector needs at least 3 collinear
        // points to begin a window, otherwise a long straight side next to a
        // round end gets swallowed into the curve fit and waves/bows outward.
        // Subdivide any segment longer than 4mm with its exact midpoint:
        // geometry stays 100% identical, but the fitter recognizes the straight run.
        const ring = [];
        for (let k = 0; k < dedup.length; k++) {
          const p1 = dedup[k];
          const p2 = dedup[(k + 1) % dedup.length];
          ring.push(p1);
          if (Math.hypot(p2.x - p1.x, p2.y - p1.y) >= 4) {
            ring.push({ x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 });
          }
        }
        out.push({ pts: ring, closed: true });
      }
    }
    return out;
  }

  function offsetOne(api, paths, r, corner, closedInput, arcTol) {
    const Lib = api.clipperLib();
    const scale = api.offsetScale;
    const joinType = corner === 'round' ? Lib.JoinType.jtRound : Lib.JoinType.jtMiter;
    const endType = closedInput ? Lib.EndType.etClosedPolygon : Lib.EndType.etOpenRound;
    const co = new Lib.ClipperOffset(api.offsetMiter(), arcTol * scale);
    co.AddPaths(paths, joinType, endType);
    const raw = new Lib.Paths();
    co.Execute(raw, r * scale);
    return fromClipperPaths(api, raw);
  }

  // Open path -> a slot (offset once with round ends).
  // Closed path -> a closed groove: offset outward and inward, and let the
  // winding normalisation read the inner one as the hole.
  function offsetChains(api, chains, d, corner, detail) {
    if (!api.clipperLib()) return null;
    const r = d / 2;
    const arcTol = Math.max(0.005, Math.min(0.05, detail / 2));
    const open = chains.filter(c => !c.closed);
    const closed = chains.filter(c => c.closed && c.pts.length >= 3);
    const out = [];
    if (open.length) {
      const paths = toClipperPaths(api, open);
      if (paths.length) out.push(...offsetOne(api, paths, r, corner, false, arcTol));
    }
    for (const c of closed) {
      const paths = toClipperPaths(api, [c]);
      if (!paths.length) continue;
      out.push(...offsetOne(api, paths, r, corner, true, arcTol));
      out.push(...offsetOne(api, paths, -r, corner, true, arcTol));
    }
    return out.length ? api.normalizeWinding(out) : [];
  }

  function read(params) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (err) { saved = {}; }
    const p = params || {};
    const d = p.d != null ? +p.d : +saved.d;
    const detail = p.detail != null ? +p.detail : +saved.detail;
    const corner = p.corner || saved.corner;
    return {
      d: isFinite(d) && d > 0 ? d : 10,
      detail: isFinite(detail) && detail > 0 ? detail : DEFAULT_DETAIL,
      corner: corner === 'miter' ? 'miter' : 'round'
    };
  }

  NS.register({
    id: 'slot',
    label: 'Slot',
    title: 'Slot: turn the selected lines, curves, arcs or circles into a slot outline with the given end diameter. Curved input is followed exactly and the result is fitted back to smooth curves. Double click the result to edit its parameters',
    modalId: 'slot-modal',
    modal: `
<div id="slot-modal" class="modal hidden">
  <div class="modal-box wide-cols">
    <h3>Slot &middot; from a path</h3>
    <div class="modal-cols">
    <div class="opt-col">
      <label class="opt">End diameter (mm) <input type="number" id="slot-d" value="10" step="0.5" min="0.1"></label>
      <label class="opt">Corners
        <select id="slot-corner">
          <option value="round">Round</option>
          <option value="miter">Miter</option>
        </select>
      </label>
      <label class="opt">Detail (mm) <input type="number" id="slot-detail" value="0.05" step="0.01" min="0.005"></label>
    </div>
    <div class="cnc-status">The selected path becomes one slot outline: offset both sides by half the end diameter, round ends. Lines, curves, arcs and circles all work &mdash; a closed path becomes a groove. Originals are kept; double click the result to edit.</div>
    </div>
    <div class="modal-actions">
      <button class="btn" id="slot-cancel">Cancel</button>
      <button class="btn primary" id="slot-ok">Create</button>
    </div>
  </div>
</div>`,

    open(api, params) {
      const s = read(params);
      const el = (id) => document.getElementById(id);
      el('slot-d').value = s.d;
      el('slot-detail').value = s.detail;
      el('slot-corner').value = s.corner;
      const ok = el('slot-ok');
      if (ok) ok.focus();
    },

    apply(api) {
      const el = (id) => document.getElementById(id);
      const fmt = api.fmt;
      const d = api.clamp(+el('slot-d').value || 10, 0.1, 500);
      const detail = api.clamp(+el('slot-detail').value || DEFAULT_DETAIL, 0.005, 5);
      const corner = el('slot-corner').value === 'round' ? 'round' : 'miter';
      NS.close('slot');
      try { localStorage.setItem(KEY, JSON.stringify({ d, detail, corner })); } catch (err) { /* ignore */ }

      // Selected path -> chains. Any entity kind is accepted: the source is
      // flattened at a tolerance, so a curve is followed instead of being taken
      // at the screen tessellation.
      let color = api.ui.color;
      let srcChains = null;
      const picked = api.selectedEntities().filter(e =>
        e.type === 'line' || e.type === 'spline' || e.type === 'arc' || e.type === 'circle');
      const isAllLines = picked.length > 0 && picked.every(e => e.type === 'line');
      if (picked.length) {
        color = api.colorOf(picked[0]);
        const polys = api.pathChainsOf(picked, sourceTol(detail));
        let chains;
        try { chains = api.chainPolylines(polys, api.settings.joinTol); } catch (err) { chains = polys; }
        // sew the glue joints first (a polyline source carries a jog at every
        // junction), but keep EVERY user vertex intact — never drop vertices
        // based on turn angle, or gentle bends get cut across!
        stitchChains(chains, api.settings.joinTol);
        srcChains = chains
          .filter(c => c.pts && c.pts.length >= 2)
          .map(c => ({
            pts: cleanPath(c.pts),
            closed: !!c.closed
          }));
      } else {
        // re-edit: the double clicked slot group rebuilds from its stored source
        const g = api.selectedEntities().find(e => e.type === 'art' && e.gen && e.gen.kind === 'slot' &&
          e.gen.params && Array.isArray(e.gen.params.src));
        if (g) {
          const flags = Array.isArray(g.gen.params.closed) ? g.gen.params.closed : [];
          srcChains = g.gen.params.src.map((c, i) => ({
            pts: cleanPath(c.map(p => ({ x: +p.x, y: +p.y }))),
            closed: !!flags[i]      // older params stored open chains only
          }));
          if (g.color) color = g.color;
        }
      }
      if (!srcChains || !srcChains.length) {
        api.toast('Select a line, curve, arc or circle first');
        return;
      }
      const outlines = offsetChains(api, srcChains, d, corner, detail);
      if (outlines === null) {
        api.toast('Slot needs tools/clipper.js');
        return;
      }
      if (!outlines.length) {
        api.toast('Slot: nothing came out of the offset');
        return;
      }

      api.pushHistory();
      const madeIds = [];
      for (const o of outlines) {
        // If the source was made purely of straight lines (polyline/lines),
        // emit it directly as a polyline via addPanelEntity — no curve fitting
        // necessary! That keeps the straight runs dead straight and avoids
        // any curve-fitting artifacts or bowing.
        let id = null;
        if (isAllLines) {
          id = api.addPanelEntity(o.pts, color);
        } else {
          id = api.addFittedCurve(o.pts, color, {
            tol: detail, sharpAngle: SHARP_ANGLE, closed: true, denoise: false
          });
          if (!id) id = api.addPanelEntity(o.pts, color);
        }
        if (id) madeIds.push(id);
      }
      api.commit();
      if (!madeIds.length) {
        api.toast('Slot: could not build the outline');
        return;
      }
      // one named group; the gen carries the source points for re-editing
      api.ui.selection = madeIds.map(id => ({ kind: 'entity', id }));
      api.cmdGroupSelection({ noHistory: true });
      const wrap = api.ui.selection.length === 1 ? api.state.entities[api.ui.selection[0].id] : null;
      if (wrap && wrap.type === 'art') {
        wrap.gen = {
          kind: 'slot',
          params: {
            d, corner, detail,
            src: srcChains.map(c => c.pts),
            closed: srcChains.map(c => !!c.closed)
          }
        };
        wrap.name = 'Slot \u2300' + fmt(d);
        api.commit();
      }
      api.toast('Slot: ' + madeIds.length + ' outline' + (madeIds.length === 1 ? '' : 's') +
        ' \u00b7 \u2300' + fmt(d) + ' mm \u00b7 ' + (corner === 'round' ? 'round' : 'miter') +
        ' corners \u00b7 ' + fmt(detail) + ' mm detail \u00b7 path kept');
    }
  });
})();
