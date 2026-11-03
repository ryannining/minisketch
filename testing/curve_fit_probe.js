// Probe for Ctrl+K (polyline -> fitted curve).
//
// app.js is one IIFE, so the command is lifted out of the source and given a
// fake document, exactly like the duplicate probe. What gets pinned:
//   - a rectangle drawn as four separate lines becomes ONE 4-node curve with no
//     handles (no rounded corners, nothing added)
//   - a densely traced arc becomes a handful of nodes, not one per vertex
//   - two chains sharing a corner stay welded after the conversion
//   - the source lines are consumed, one undo step is spent, and the result is
//     selected
//   - real curves / arcs / circles are left alone
//
// Run: node testing/curve_fit_probe.js
const fs = require('fs');
const path = require('path');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const C = require(path.join(__dirname, '..', 'core.js'));
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

function braceEnd(s, from) {
  let d = 0;
  for (let j = s.indexOf('{', from); j < s.length; j++) {
    if (s[j] === '{') d++;
    else if (s[j] === '}') { d--; if (!d) return j + 1; }
  }
  throw new Error('unbalanced');
}
const slice = (name) => {
  const start = appSrc.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('not found: ' + name);
  let i = appSrc.indexOf('(', start), depth = 0;
  for (; i < appSrc.length; i++) {
    if (appSrc[i] === '(') depth++;
    else if (appSrc[i] === ')') { depth--; if (!depth) break; }
  }
  return appSrc.slice(start, braceEnd(appSrc, i));
};

// ---- fake document -----------------------------------------------------
function makeWorld() {
  const world = {
    state: {
      points: {}, entities: {}, constraints: {}, namedSel: {},
      layers: [{ id: 1, name: 'Layer 1', visible: true, locked: false }],
      nextId: 5000
    },
    ui: { selection: [], activeLayer: 1, focusLoop: null, raw: null, lastWorld: null },
    settings: { joinTol: 0.1, curveFitTol: 0.2, curveSharpAngle: 25 },
    W: 800, H: 600, view: { ox: 400, oy: 300, zoom: 1 },
    toasts: [], history: 0, commits: 0, solved: 0
  };
  world.newId = () => ++world.state.nextId;
  world.P = (id) => world.state.points[+id] || null;
  world.privatePoint = (x, y) => {
    const id = world.newId();
    world.state.points[id] = { x, y };
    return id;
  };
  world.toast = (m) => world.toasts.push(String(m));
  world.fmt = (v) => String(Math.round(v * 100) / 100);
  world.pushHistory = () => { world.history++; };
  world.commit = () => { world.commits++; };
  world.requestSolve = () => { world.solved++; };
  world.invalidateLoops = () => {};
  world.cleanupPoints = () => {};
  world.xfBlock = () => false;
  world.removeEntity = (id) => { delete world.state.entities[+id]; };
  world.colorOf = (e) => (e && e.color) || '#000000';
  world.normalizeSplineLoops = () => {};
  world.removeDuplicateLines = () => {};
  world.fuseCoincidentPoints = (ids) => {
    // weld points that sit on the same spot, as the real one does
    const list = Array.from(new Set((ids || []).map(Number))).filter(i => world.state.points[i]);
    let merged = 0;
    for (let i = 0; i < list.length; i++) {
      const a = world.state.points[list[i]];
      if (!a) continue;
      for (let j = i + 1; j < list.length; j++) {
        const bid = list[j];
        const b = world.state.points[bid];
        if (!b) continue;
        if (Math.hypot(a.x - b.x, a.y - b.y) > 1e-6) continue;
        for (const eid in world.state.entities) {
          const e = world.state.entities[eid];
          if (e.type !== 'spline' || !e.pts) continue;
          e.pts = e.pts.map(p => (+p === bid ? list[i] : p));
        }
        delete world.state.points[bid];
        merged++;
      }
    }
    return merged;
  };
  world.entityPointIds = (e) => {
    if (!e) return [];
    if (e.type === 'line') return [e.a, e.b];
    if (e.type === 'spline') return e.pts || [];
    if (e.type === 'circle') return [e.c];
    return [];
  };
  world.entityWorldPolylines = (e) => {
    if (!e) return [];
    if (e.type === 'line') {
      const a = world.P(e.a), b = world.P(e.b);
      return a && b ? [{ pts: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }], closed: false }] : [];
    }
    if (e.type === 'spline') {
      const pts = (e.pts || []).map(p => world.P(p)).filter(Boolean)
        .map(p => ({ x: p.x, y: p.y }));
      return pts.length >= 2 ? [{ pts, closed: !!e.closed }] : [];
    }
    return [];
  };
  world.selectedEntities = () => world.ui.selection
    .filter(s => s.kind === 'entity' && world.state.entities[s.id])
    .map(s => world.state.entities[s.id]);
  return world;
}

function build(world) {
  // The real Ctrl+K path opens a dialog; the probe wants the apply step, so it
  // slices the dialog function too and stubs it out with applyFitCurve.
  const body = [
    slice('splineHasCurves'),
    slice('cmdFitCurve'),
    slice('applyFitCurve')
  ].join('\n');
  return new Function(
    'state', 'ui', 'settings', 'W', 'H',
    'fitPolylineCurve', 'chainPolylines', 'signedAreaPts',
    'newId', 'privatePoint', 'P', 'toast', 'fmt', 'pushHistory', 'commit',
    'requestSolve', 'invalidateLoops', 'cleanupPoints', 'xfBlock', 'removeEntity',
    'colorOf', 'normalizeSplineLoops', 'removeDuplicateLines', 'fuseCoincidentPoints',
    'entityPointIds', 'entityWorldPolylines', 'selectedEntities',
    'openFitCurveDialog',
    `let history = { pop: () => {} };
     ${body}
     // the probe has no DOM: the "dialog" applies immediately
     openFitCurveDialog = (job) => applyFitCurve(job.src, job.chains, job.tol, job.sharpAngle);
     return { cmdFitCurve, splineHasCurves, applyFitCurve };`
  )(
    world.state, world.ui, world.settings, world.W, world.H,
    C.fitPolylineCurve, C.chainPolylines, C.signedAreaPts,
    world.newId, world.privatePoint, world.P, world.toast, world.fmt,
    world.pushHistory, world.commit, world.requestSolve, world.invalidateLoops,
    world.cleanupPoints, world.xfBlock, world.removeEntity, world.colorOf,
    world.normalizeSplineLoops, world.removeDuplicateLines, world.fuseCoincidentPoints,
    world.entityPointIds, world.entityWorldPolylines, world.selectedEntities,
    // no DOM in the probe: run the job straight through the apply step
    undefined
  );
}

// draw a closed polygon as separate line entities sharing corner points
function drawPolygon(world, pts, color) {
  const ids = pts.map(p => world.privatePoint(p.x, p.y));
  const ents = [];
  for (let i = 0; i < ids.length; i++) {
    const id = world.newId();
    world.state.entities[id] = {
      id, type: 'line', a: ids[i], b: ids[(i + 1) % ids.length],
      color: color || '#000000', layer: 1
    };
    ents.push(id);
  }
  return { ids, ents };
}

const splines = (world) => Object.values(world.state.entities).filter(e => e.type === 'spline');
const lines = (world) => Object.values(world.state.entities).filter(e => e.type === 'line');

// ---- 1. a rectangle drawn as 4 lines -----------------------------------
console.log('\n== four lines become one 4-node curve ==');
{
  const world = makeWorld();
  const api = build(world);
  const rect = drawPolygon(world, [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }
  ]);
  world.ui.selection = rect.ents.map(id => ({ kind: 'entity', id }));
  api.cmdFitCurve();

  check('the four lines are gone', lines(world).length === 0, lines(world).length);
  check('one spline was produced', splines(world).length === 1, splines(world).length);
  const sp = splines(world)[0];
  check('it is closed', sp.closed === true);
  check('it has exactly 4 nodes', sp.pts.length === 4, sp.pts.length);
  check('no handles: the corners stay square',
    sp.hs.o.every(h => !h) && sp.hs.i.every(h => !h));
  const coords = sp.pts.map(id => world.state.points[id]).map(p => [Math.round(p.x), Math.round(p.y)]);
  check('the corners are the original ones',
    JSON.stringify(coords.slice().sort()) === JSON.stringify([[0, 0], [0, 60], [100, 0], [100, 60]].sort()),
    JSON.stringify(coords));
  check('the result is selected', world.ui.selection.length === 1 && world.ui.selection[0].kind === 'entity');
  check('exactly one undo step', world.history === 1, world.history);
  check('the toast reports 4 nodes', world.toasts.some(t => /Fitted 1 curve .* 4 nodes/.test(t)),
    world.toasts.join(' | '));
}

// ---- 2. a densely traced arc becomes a few nodes -----------------------
console.log('\n== a dense polyline collapses to a few nodes ==');
{
  const world = makeWorld();
  const api = build(world);
  // 40 short lines along a quarter circle of radius 80
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const a = Math.PI / 2 * i / 40;
    pts.push({ x: 80 * Math.cos(a), y: 80 * Math.sin(a) });
  }
  const ids = pts.map(p => world.privatePoint(p.x, p.y));
  const ents = [];
  for (let i = 0; i + 1 < ids.length; i++) {
    const id = world.newId();
    world.state.entities[id] = { id, type: 'line', a: ids[i], b: ids[i + 1], color: '#000000', layer: 1 };
    ents.push(id);
  }
  world.ui.selection = ents.map(id => ({ kind: 'entity', id }));
  api.cmdFitCurve();
  const sp = splines(world)[0];
  check('41 points became a handful of nodes', sp && sp.pts.length >= 2 && sp.pts.length <= 4,
    sp ? sp.pts.length : 'none');
  check('it kept curves (handles present)',
    sp && (sp.hs.o.some(h => h) || sp.hs.i.some(h => h)));
  check('it is open', sp && sp.closed !== true);

  // the fitted curve really follows the arc
  const cps = sp.pts.map(id => world.state.points[id]);
  const samples = C.splineSamples(cps, sp.hs, false);
  let worst = 0;
  for (const s of samples) worst = Math.max(worst, Math.abs(Math.hypot(s.x, s.y) - 80));
  check('the fitted curve stays on the 80 mm circle', worst < 0.2 + 1e-6, worst.toFixed(3));
}

// ---- 3. two chains sharing a corner stay welded ------------------------
console.log('\n== chains stay welded ==');
{
  const world = makeWorld();
  const api = build(world);
  // an L: horizontal run then vertical run, sharing the middle point
  const a = world.privatePoint(0, 0);
  const b = world.privatePoint(60, 0);
  const c = world.privatePoint(60, 40);
  const l1 = world.newId(), l2 = world.newId();
  world.state.entities[l1] = { id: l1, type: 'line', a, b, color: '#000000', layer: 1 };
  world.state.entities[l2] = { id: l2, type: 'line', a: b, b: c, color: '#000000', layer: 1 };
  world.ui.selection = [{ kind: 'entity', id: l1 }, { kind: 'entity', id: l2 }];
  api.cmdFitCurve();
  const sp = splines(world)[0];
  check('one curve for the whole L', splines(world).length === 1);
  check('three nodes, the corner kept sharp', sp.pts.length === 3, sp.pts.length);
  check('the shared point is still one point',
    new Set(sp.pts).size === sp.pts.length && sp.pts.length === 3);
  check('the corner point is the original id', sp.pts.indexOf(b) >= 0);
}

// ---- 4. things that are already curves stay put -----------------------
console.log('\n== only polylines are converted ==');
{
  const world = makeWorld();
  const api = build(world);
  const cf = world.privatePoint(0, 0);
  const cid = world.newId();
  world.state.entities[cid] = { id: cid, type: 'circle', c: cf, r: 20, color: '#000000', layer: 1 };
  world.ui.selection = [{ kind: 'entity', id: cid }];
  api.cmdFitCurve();
  check('a circle is not touched', world.state.entities[cid] && world.state.entities[cid].type === 'circle');
  check('and it says what it wants',
    world.toasts.some(t => /polyline/.test(t)), world.toasts.join(' | '));
  check('no undo step is wasted', world.history === 0, world.history);
}

// ---- 5. an already-curved spline CAN be re-fitted ----------------------
console.log('\n== a curved spline can be re-fitted (Ctrl+K repeats) ==');
{
  const world = makeWorld();
  const api = build(world);
  const p1 = world.privatePoint(0, 0), p2 = world.privatePoint(50, 50);
  const sid = world.newId();
  world.state.entities[sid] = {
    id: sid, type: 'spline', pts: [p1, p2],
    hs: { o: [{ x: 10, y: 0 }, null], i: [null, { x: 40, y: 50 }] },
    color: '#000000', layer: 1
  };
  check('splineHasCurves sees the handle', api.splineHasCurves(world.state.entities[sid]) === true);
  world.ui.selection = [{ kind: 'entity', id: sid }];
  api.cmdFitCurve();
  // the old spline is consumed and a fitted one takes its place: re-fitting a
  // curve is exactly what the Ctrl+K dialog is for (a coarse first pass can
  // leave too many nodes)
  check('the source spline was re-fitted', !world.state.entities[sid]);
  check('a spline came out', splines(world).length === 1, splines(world).length);
}

console.log('\n' + (fail ? fail + ' FAILED, ' : 'all ') + pass + ' checks passed');
process.exit(fail ? 1 : 0);
