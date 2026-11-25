// Text weld: many separate closed objects -> ONE connected cut piece.
//
// The user arranges the objects (letters overlapping where they want the
// joint) and selects their OUTER loops; this tool welds what is selected, in
// place, and REPLACES the originals (duplicate the master manually first if you
// want a backup). Holes are not handled — select the outers only. The selection
// is read through the app's OWN loop hierarchy (Object Tree / LoopTree): even
// level = outer. Overlapping letters stay siblings (both level 0) because the
// tree nests by bbox containment, not a single interior probe.
//
// The boolean is the EXACT bezier engine (api.boolLoopsExact -> PathBool on the
// real cubic commands), NOT api.polyBoolOp on tessellated polygons: the polygon
// path is slow and numerically fragile on dense spline outlines (the union came
// out empty, which misattributed every mark — "all red / all white"), and it
// facets the result. The exact engine is fast and keeps curves / full resolution.
//   A = union of every object -> the black cut outline (curves preserved).
// Marking is asymmetric: walking objects left -> right, the lens = object ∩
// (material to its left). A lens boundary arc belongs to the RIGHT object iff a
// probe nudged OUTWARD from the lens still lands inside the left material (the
// right object's penetrating arc is interior to the left; the left object's arc
// sits ON the left boundary, so its outward probe leaves the left material).
// Those arcs emit as red marking (#ff0000, does not cut through) as exact open
// splines carrying the lens's own nodes + handles — no tessellation, no refit.
// One red line per joint. An object that overlaps nothing stays its own piece.
//
// gen.params carries the source curve nodes so a double click rebuilds exactly.
(() => {
  'use strict';

  const NS = window.MiniSketchTools;
  const KEY = 'minisketch.v1.textweld';
  const CUT = '#000000';
  const MARK = '#ff0000';
  const KEY_EPS = 1e-4;       // mm: coordinate grid for point-coincidence comparison

  // ---- pure geometry (core helpers are global; the probe injects them) ----

  function cleanRing(pts) {
    const out = [];
    for (const p of pts || []) {
      const q = { x: +p.x, y: +p.y };
      if (!isFinite(q.x) || !isFinite(q.y)) continue;
      const last = out[out.length - 1];
      if (last && Math.hypot(last.x - q.x, last.y - q.y) < 1e-7) continue;
      out.push(q);
    }
    if (out.length > 2) {
      const a = out[0], b = out[out.length - 1];
      if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-7) out.pop();
    }
    return out;
  }

  function ringDepths(rings) {
    const probes = rings.map(r => interiorProbe(r));
    return rings.map((r, i) => {
      let d = 0;
      for (let j = 0; j < rings.length; j++) {
        if (j !== i && pointInPoly(probes[i], rings[j])) d++;
      }
      return d;
    });
  }

  function ringsBBox(rings) {
    let box = null;
    for (const r of rings) {
      const b = polyBBox(r);
      if (!b) continue;
      box = box ? {
        minX: Math.min(box.minX, b.minX), minY: Math.min(box.minY, b.minY),
        maxX: Math.max(box.maxX, b.maxX), maxY: Math.max(box.maxY, b.maxY)
      } : b;
    }
    return box;
  }

  // A curve loop ({nodes:[{x,y,o,i}], closed}) -> a sampled ring, for bbox /
  // point-in-material tests. Uses the real handles, so it follows the curve.
  function sampleLoop(l) {
    const nodes = l.nodes || [];
    if (nodes.length < 2) return [];
    const cps = nodes.map(n => ({ x: n.x, y: n.y }));
    const hs = { o: nodes.map(n => n.o || null), i: nodes.map(n => n.i || null) };
    return cleanRing(splineSamples(cps, hs, !!l.closed));
  }

  function nodeKey(p, eps) {
    return Math.round(p.x / eps) + ',' + Math.round(p.y / eps);
  }

  // Red marking by a flip-flop walk over each EXACT lens curve loop — pure
  // point-coincidence comparison, no intersection test, no tessellation. Start
  // at the loop's leftmost node (it sits on the RIGHT object's penetrating arc,
  // the left side of the lens) with state = keep; fromRight starts at the
  // rightmost node instead, keeping the other arc — so the user chooses which
  // side of the joint carries the red line. Walk node by node in curve order;
  // every node coincident with a union-A node is a tip where the boundary
  // switches owner, so flip keep/clean there. The kept arcs emit as red. The arc
  // containing the start is split by the walk and merged back across the closure.
  function markingRuns(lensLoops, aKeys, eps, fromRight) {
    const runs = [];
    for (const l of lensLoops) {
      const nodes = l.nodes || [];
      const n = nodes.length;
      if (n < 3) continue;
      let start = 0;
      for (let k = 1; k < n; k++) {
        if (fromRight ? nodes[k].x > nodes[start].x : nodes[k].x < nodes[start].x) start = k;
      }
      let keeping = true;
      const segs = [];
      let cur = [nodes[start]];
      for (let step = 1; step < n; step++) {
        const nd = nodes[(start + step) % n];
        if (aKeys.has(nodeKey(nd, eps))) {
          cur.push(nd);
          segs.push({ keeping, nodes: cur });
          keeping = !keeping;
          cur = [nd];
        } else {
          cur.push(nd);
        }
      }
      cur.push(nodes[start]);
      segs.push({ keeping, nodes: cur });
      if (segs.length > 1 && segs[0].keeping && segs[segs.length - 1].keeping) {
        const last = segs.pop();
        segs[0].nodes = last.nodes.concat(segs[0].nodes.slice(1));
      }
      for (const s of segs) if (s.keeping && s.nodes.length >= 2) runs.push(s.nodes);
    }
    return runs;
  }

  // Exact weld: A = union (curve loops), red marking via a flip-flop walk on the
  // intersection lenses. fromRight chooses which side of each joint is marked.
  function weldExact(objects, api, fromRight) {
    const allLoops = objects.map(o => o.loop);
    const A = api.boolLoopsExact('union', allLoops, []);
    if (A === null) return { ok: false, why: 'exact boolean perlu tools/path-bool.js — hard reload (Ctrl+Shift+R)' };
    if (!A.length) return { ok: false, why: 'union kosong' };
    const aRings = A.map(sampleLoop).filter(r => r.length >= 3);
    const aDep = ringDepths(aRings);
    const pieces = aRings.filter((r, i) => aDep[i] % 2 === 0).length;
    const aKeys = new Set();
    for (const l of A) for (const nd of l.nodes || []) aKeys.add(nodeKey(nd, KEY_EPS));

    const order = objects.slice().sort((a, b) =>
      (ringsBBox([a.outer]).minX - ringsBBox([b.outer]).minX));
    const leftLoops = [], redRuns = [];
    let joints = 0;
    for (const o of order) {
      if (leftLoops.length) {
        const lens = api.boolLoopsExact('intersection', [o.loop], leftLoops);
        if (lens && lens.length) {
          joints++;
          redRuns.push(...markingRuns(lens, aKeys, KEY_EPS, fromRight));
        }
      }
      leftLoops.push(o.loop);
    }
    return { ok: true, A, red: redRuns, joints, pieces };
  }

  function planWeld(objects) {
    if (!objects || objects.length < 2) return { ok: false, why: 'pilih minimal dua objek tertutup' };
    for (const o of objects) {
      if (!o.outer || o.outer.length < 3 || Math.abs(signedAreaPts(o.outer)) < 1e-6) {
        return { ok: false, why: 'ada objek tanpa outline tertutup yang sah' };
      }
    }
    return { ok: true, objects };
  }

  // ---- reading the selection (api side) ----------------------------------

  // Source curve nodes of a loop, for an exact re-edit. A single-spline loop
  // keeps its real nodes + handles; a composite loop falls back to its sampled
  // ring as corner nodes.
  function loopNodes(api, L) {
    if (L.splineEntity != null) {
      const e = api.state.entities[L.splineEntity];
      if (e && e.type === 'spline') {
        const cps = api.entityPointIds(e).map(id => api.P(id)).filter(Boolean);
        const hs = (e.hs && e.hs.o && e.hs.o.length === cps.length) ? e.hs : { o: cps.map(() => null), i: cps.map(() => null) };
        return { nodes: cps.map((p, k) => ({ x: p.x, y: p.y, o: hs.o[k] || null, i: hs.i[k] || null })), closed: !!e.closed };
      }
    }
    return { nodes: cleanRing(L.poly).map(p => ({ x: p.x, y: p.y, o: null, i: null })), closed: true };
  }

  // Outer loops of the SELECTION. Depth is computed RELATIVE to the selected
  // loops, not from the global LoopTree: a letter sitting inside an UNSELECTED
  // surrounding box is global depth 1 (a "hole" of the box) but is still an
  // outer of the selection — using global depth wrongly dropped every letter
  // and refused with "minimal 2". Containment uses the LoopTree's own rule
  // (bbox fit + interior probe), counted only among selected loops.
  function readObjects(api) {
    const picked = api.selectedEntities().filter(e =>
      e.type !== 'image' && api.colorOf(e) !== '#00ff00');
    const selIds = new Set(picked.map(e => +e.id));
    const selLoops = [];
    for (const L of api.getLoops()) {
      if (!L.poly || L.poly.length < 3) continue;
      const own = api.loopEntities(L).map(Number);
      if (own.length && own.every(id => selIds.has(id))) selLoops.push(L);
    }
    const boxes = selLoops.map(L => polyBBox(L.poly));
    const probes = selLoops.map(L => interiorProbe(L.poly));
    const depth = selLoops.map((L, i) => {
      let d = 0;
      for (let j = 0; j < selLoops.length; j++) {
        if (i === j) continue;
        const ib = boxes[i], ob = boxes[j];
        if (!ib || !ob) continue;
        if (ib.minX < ob.minX || ib.minY < ob.minY || ib.maxX > ob.maxX || ib.maxY > ob.maxY) continue;
        if (pointInPoly(probes[i], selLoops[j].poly)) d++;
      }
      return d;
    });
    // weld the shallowest selected level only; everything deeper is ignored —
    // left untouched, NOT welded and NOT deleted (the user keeps those loops).
    const minDepth = depth.length ? Math.min(...depth) : 0;
    const objs = [];
    for (let i = 0; i < selLoops.length; i++) {
      if (depth[i] === minDepth) objs.push({ loop: selLoops[i], outer: cleanRing(selLoops[i].poly), src: loopNodes(api, selLoops[i]) });
    }
    if (objs.length < 2) return { err: 'pilih minimal dua objek tertutup (outer saja)' };
    return { objects: objs };
  }

  // Re-edit: recreate temporary source splines from the stored nodes, take their
  // loops, weld, then remove the temps. Keeps curves exact across rebuilds.
  function objectsFromSrc(api, src) {
    const tempIds = [];
    const objs = [];
    const ids = src.map(s => {
      const id = api.addSpline({
        pts: s.nodes.map(n => ({ x: n.x, y: n.y })),
        hs: { o: s.nodes.map(n => n.o || null), i: s.nodes.map(n => n.i || null) },
        closed: !!s.closed, color: CUT
      });
      if (id) tempIds.push(+id);
      return id;
    });
    const loops = api.getLoops();
    for (const id of ids) {
      if (id == null) continue;
      const L = loops.find(l => l.splineEntity === id && l.poly && l.poly.length >= 3);
      if (L) objs.push({ loop: L, outer: cleanRing(L.poly), src: src[ids.indexOf(id)] });
    }
    return { objects: objs, tempIds };
  }

  function serialize(objects) {
    return objects.map(o => o.src);
  }

  NS.register({
    id: 'textweld',
    label: 'Text weld',
    version: '1.0.0',
    icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2.5 4h6M5.5 4v8M8.5 7.5h5M11 5v5"/></svg>',
    title: 'Text weld: weld the selected outer loops into one connected cut piece in place — exact boolean, curves preserved, the right object\'s overlap edge marked red. Replaces the originals. Double click to edit',
    modalId: 'tw-modal',
    guide: {
      en: {
        ttl: 'Text weld &middot; join into one',
        hint: 'Arrange the objects to <b>overlap</b>, select the <b>outers</b>, then Create. Text letters: <b>Convert to Curve</b> / ungroup first so they can be moved.',
        main: 'Welds the selection <b>in place</b> into one piece: the union becomes the <b>black cut outline</b> and each joint keeps one <b>red marking</b> arc (<b>Start from right</b> picks its side). <b>Replaces the originals.</b> Double click the result to edit.'
      },
      id: {
        ttl: 'Text weld &middot; sambung jadi satu',
        hint: 'Susun objek sampai saling <b>overlap</b>, select <b>outer</b>-nya, lalu Create. Huruf teks: <b>Convert to Curve</b> / ungroup dulu agar bisa digeser.',
        main: 'Me-weld pilihan <b>di posisinya</b> jadi satu bagian: union jadi <b>outline potong hitam</b> dan tiap sambungan menyisakan satu busur <b>marking merah</b> (sisinya lewat <b>Start from right</b>). <b>Menggantikan objek asli.</b> Dobel-klik hasil untuk mengubah.'
      }
    },
    modal: `
<div id="tw-modal" class="modal hidden">
  <div class="modal-box wide-cols">
    <h3><span data-guide="ttl">Text weld &middot; join into one</span></h3>
    <div class="modal-cols">
    <div class="opt-col">
      <label class="opt" title="Pick which joint arc becomes the red marking line: starting from the left keeps the right object's arc, from the right keeps the left object's arc."><input type="checkbox" id="tw-fromright"> Start from right</label>
      <div class="opt" data-guide="hint"></div>
    </div>
    <div class="cnc-status" data-guide="main"></div>
    </div>
    <div class="modal-actions">
      <button class="btn" id="tw-cancel">Cancel</button>
      <button class="btn primary" id="tw-ok">Create</button>
    </div>
  </div>
</div>`,

    open(api, params) {
      let saved = {};
      try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (err) { saved = {}; }
      const fr = params && params.fromRight != null ? params.fromRight : saved.fromRight;
      const cb = document.getElementById('tw-fromright');
      if (cb) cb.checked = !!fr;
      const ok = document.getElementById('tw-ok');
      if (ok) ok.focus();
    },

    apply(api) {
      const fmt = api.fmt;
      const cb = document.getElementById('tw-fromright');
      const fromRight = !!(cb && cb.checked);
      NS.close('textweld');
      try { localStorage.setItem(KEY, JSON.stringify({ fromRight })); } catch (err) { /* storage blocked */ }

      let objects = null, prev = null, srcIds = null, tempIds = [];
      const sel = api.ui.selection || [];
      if (sel.length === 1 && sel[0].kind === 'entity') {
        const e = api.state.entities[sel[0].id];
        if (e && e.type === 'art' && e.gen && e.gen.kind === 'textweld' &&
          e.gen.params && Array.isArray(e.gen.params.src)) {
          prev = e;
        }
      }
      if (prev) {
        const r = objectsFromSrc(api, prev.gen.params.src);
        objects = r.objects;
        tempIds = r.tempIds;
        if (objects.length < 2) { api.removeEntities(tempIds); api.toast('Text weld: sumber tersimpan tidak bisa dibaca'); return; }
      } else {
        const r = readObjects(api);
        if (r.err) { api.toast('Text weld: ' + r.err); return; }
        objects = r.objects;
        // remove only the welded outers' entities — deeper ignored loops stay
        srcIds = [];
        for (const o of objects) for (const id of api.loopEntities(o.loop)) srcIds.push(+id);
      }

      const plan = planWeld(objects);
      if (!plan.ok) { api.removeEntities(tempIds); api.toast('Text weld: ' + plan.why); return; }
      const weld = weldExact(objects, api, fromRight);
      if (!weld.ok) { api.removeEntities(tempIds); api.toast('Text weld: ' + weld.why); return; }

      api.pushHistory();

      // replace in place; a re-edit keeps the position the user gave the group
      let shiftX = 0, shiftY = 0;
      if (prev) {
        const o = api.P(prev.p0);
        const nb = ringsBBox(weld.A.map(sampleLoop));
        if (o && nb) { shiftX = o.x - nb.minX; shiftY = o.y - nb.minY; }
        api.removeEntity(prev.id);
      } else if (srcIds) {
        api.removeEntities(srcIds);
      }
      api.removeEntities(tempIds);
      const tx = p => ({ x: p.x + shiftX, y: p.y + shiftY });

      const madeIds = [];
      for (const l of weld.A) {
        const id = api.addSpline({
          pts: l.nodes.map(n => tx({ x: n.x, y: n.y })),
          hs: { o: l.nodes.map(n => n.o ? tx(n.o) : null), i: l.nodes.map(n => n.i ? tx(n.i) : null) },
          closed: !!l.closed, color: CUT
        });
        if (id) madeIds.push(id);
      }
      for (const run of weld.red) {
        const id = api.addSpline({
          pts: run.map(nd => tx({ x: nd.x, y: nd.y })),
          hs: {
            o: run.map((nd, j) => (j < run.length - 1 && nd.o) ? tx(nd.o) : null),
            i: run.map((nd, j) => (j > 0 && nd.i) ? tx(nd.i) : null)
          },
          closed: false, color: MARK
        });
        if (id) madeIds.push(id);
      }
      api.commit();
      if (!madeIds.length) { api.toast('Text weld: gagal membuat geometri'); return; }

      api.ui.selection = madeIds.map(id => ({ kind: 'entity', id }));
      api.cmdGroupSelection({ noHistory: true });
      const wrap = api.ui.selection.length === 1 ? api.state.entities[api.ui.selection[0].id] : null;
      if (!wrap || wrap.type !== 'art') { api.toast('Text weld: bentuk jadi tapi tidak ter-wrap'); return; }
      wrap.gen = { kind: 'textweld', params: { src: serialize(objects), fromRight } };
      wrap.name = 'Text weld ' + objects.length + '\u21921';
      api.commit();
      api.toast('Text weld: ' + objects.length + ' objek \u2192 ' + weld.pieces +
        ' bagian \u00b7 ' + weld.joints + ' sambungan \u00b7 kurva utuh');
    }
  });
})();