// Probe: boolean result -> Ctrl+K.
//
// The question this answers: after a boolean union the result is a segmented
// outline. Can it be turned back into curves, and if not, why not? The probe
// lifts the real cmdBoolean / cmdFitCurve out of app.js and runs the whole flow
// against a fake document, so the answer comes from the code and not from
// reading it.
//
// Run: node testing/boolean_probe.js
const fs = require('fs');
const path = require('path');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const C = require(path.join(__dirname, '..', 'core.js'));
const ClipperLib = require(path.join(__dirname, '..', 'tools', 'clipper.js'));
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

function makeWorld() {
  const world = {
    state: {
      points: {}, entities: {}, constraints: {}, 
      layers: [{ id: 1, name: 'Layer 1', visible: true, locked: false }],
      nextId: 200
    },
    ui: { selection: [], activeLayer: 1, focusLoop: null, raw: null },
    settings: {
      joinTol: 0.1, bakeJoinTol: 0.1, curveFitTol: 0.2, curveSharpAngle: 25,
      offsetArcTol: 0.05, offsetMiter: 4, offsetJoin: 'sharp'
    },
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
  world.commit = () => {
    world.commits++;
    // as the real one does: give layerless entities the active layer
    for (const id in world.state.entities) {
      const e = world.state.entities[id];
      if (e.layer == null) e.layer = world.ui.activeLayer;
    }
  };
  world.requestSolve = () => { world.solved++; };
  world.invalidateLoops = () => {};
  world.cleanupPoints = () => {};
  world.xfBlock = () => false;
  world.removeEntity = (id) => { delete world.state.entities[+id]; };
  world.removeEntities = (ids) => { for (const id of ids) delete world.state.entities[+id]; };
  world.colorOf = (e) => (e && e.color) || '#000000';
  world.normalizeSplineLoops = () => {};
  world.removeDuplicateLines = () => {};
  world.fuseCoincidentPoints = () => 0;
  world.updateHistoryButtons = () => {};
  world.clipperLib = () => ClipperLib;
  // same engine selection the browser makes: the exact engine runs unless a
  // test explicitly disables it via world.pathBoolLib
  world.pathBoolLib = () => {
    require(path.join(__dirname, '..', 'tools', 'path-bool.js'));
    return global.PathBool;
  };
  world.offsetScale = 1000;
  world.offsetPrecision = 0.001;
  world.signedAreaPts = C.signedAreaPts;
  world.entityPointIds = (e) => {
    if (!e) return [];
    if (e.type === 'spline') return e.pts || [];
    if (e.type === 'line') return [e.a, e.b];
    if (e.type === 'circle') return [e.c];
    return [];
  };
  world.entityWorldPolylines = (e) => {
    if (!e) return [];
    if (e.type === 'spline') {
      const pts = (e.pts || []).map(i => world.P(i)).filter(Boolean).map(p => ({ x: p.x, y: p.y }));
      return pts.length >= 2 ? [{ pts, closed: !!e.closed }] : [];
    }
    if (e.type === 'circle') {
      const c = world.P(e.c);
      if (!c) return [];
      const out = [];
      const n = 360;
      for (let i = 0; i < n; i++) {
        const a = Math.PI * 2 * i / n;
        out.push({ x: c.x + e.r * Math.cos(a), y: c.y + e.r * Math.sin(a) });
      }
      return [{ pts: out, closed: true }];
    }
    return [];
  };
  world.selectedEntities = () => world.ui.selection
    .filter(s => s.kind === 'entity' && world.state.entities[s.id])
    .map(s => world.state.entities[s.id]);
  // loops: every single closed entity is one loop
  world.getLoops = () => Object.values(world.state.entities)
    .filter(e => e.type === 'circle' || (e.type === 'spline' && e.closed))
    .map(e => ({ poly: world.entityWorldPolylines(e)[0].pts, ents: [+e.id] }));
  world.loopEntities = (loop) => loop.ents;
  return world;
}

function build(world) {
  const body = [
    slice('pickedLoops'),
    slice('cmdBoolean'),
    slice('cmdBooleanExact'),
    slice('normalizeSplineWinding'),
    slice('boolPathsToEntities'),
    slice('loopToBoolCommands'),
    slice('boolArcCenter'),
    slice('addPanelEntity'),
    slice('splineHasCurves'),
    slice('addFittedSpline'),
    slice('cmdFitCurve'),
    slice('applyFitCurve')
  ].join('\n');
  return new Function(
    'state', 'ui', 'settings', 'ClipperLib', 'clipperLib', 'pathBoolLib', 'OFFSET_SCALE', 'OFFSET_PRECISION',
    'fitPolylineCurve', 'chainPolylines', 'signedAreaPts', 'getLoops', 'loopEntities',
    'newId', 'privatePoint', 'P', 'toast', 'fmt', 'pushHistory', 'commit',
    'requestSolve', 'invalidateLoops', 'cleanupPoints', 'xfBlock', 'removeEntity',
    'removeEntities', 'colorOf', 'normalizeSplineLoops', 'removeDuplicateLines',
    'fuseCoincidentPoints', 'updateHistoryButtons', 'entityPointIds', 'render', 'requestRender',
    'entityWorldPolylines', 'selectedEntities', 'openFitCurveDialog',
    `let history = { pop: () => {}, length: 0 };
     ${body}
     // no DOM here: the fit dialog applies straight away
     openFitCurveDialog = (job) => applyFitCurve(job.src, job.chains, job.tol, job.sharpAngle);
     return { cmdBoolean, cmdFitCurve, splineHasCurves };`
  )(
    world.state, world.ui, world.settings, ClipperLib, world.clipperLib, world.pathBoolLib, 1000, 0.001,
    C.fitPolylineCurve, C.chainPolylines, C.signedAreaPts, world.getLoops,
    world.loopEntities, world.newId, world.privatePoint, world.P, world.toast,
    world.fmt, world.pushHistory, world.commit, world.requestSolve,
    world.invalidateLoops, world.cleanupPoints, world.xfBlock, world.removeEntity,
    world.removeEntities, world.colorOf, world.normalizeSplineLoops,
    world.removeDuplicateLines, world.fuseCoincidentPoints,
    world.updateHistoryButtons, world.entityPointIds,
    () => {}, () => {},                      // render, requestRender: no DOM here
    world.entityWorldPolylines, world.selectedEntities,
    undefined   // openFitCurveDialog, replaced inside the body
  );
}

// two overlapping circles as circle entities
function twoCircles(world) {
  const c1 = world.privatePoint(0, 0);
  const c2 = world.privatePoint(60, 0);
  const a = world.newId(), b = world.newId();
  world.state.entities[a] = { id: a, type: 'circle', c: c1, r: 50, color: '#000000', layer: 1 };
  world.state.entities[b] = { id: b, type: 'circle', c: c2, r: 50, color: '#000000', layer: 1 };
  world.ui.selection = [{ kind: 'entity', id: a }, { kind: 'entity', id: b }];
  return [a, b];
}

// measure how far the fitted curve strays from a source polyline
function deviation(fitted, world, srcPts) {
  const cps = fitted.pts.map(i => world.state.points[i]);
  const cb = C.splineCubics(cps, fitted.hs, true);
  const dense = [];
  for (const c of cb) {
    const L = Math.hypot(c.P3.x - c.P0.x, c.P3.y - c.P0.y);
    const n = Math.max(32, Math.ceil(L * 20));
    for (let k = 0; k <= n; k++) dense.push(C.cubicAt(c.P0, c.P1, c.P2, c.P3, k / n));
  }
  let worst = 0;
  for (const p of srcPts) {
    let best = Infinity;
    for (const q of dense) best = Math.min(best, Math.hypot(q.x - p.x, q.y - p.y));
    worst = Math.max(worst, best);
  }
  return worst;
}
// A sharp corner after fitting is a KINK: both handles exist but are not
// collinear. A smooth node has them 180 degrees apart.
function kinks(fitted, world, minDeg) {
  const pts = fitted.pts.map(i => world.state.points[i]);
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const o = fitted.hs.o[i], inn = fitted.hs.i[i];
    if (!o) continue;
    if (!inn) { out.push({ i, dev: 180, y: pts[i].y }); continue; }
    const a = Math.atan2(o.y - pts[i].y, o.x - pts[i].x);
    const b = Math.atan2(inn.y - pts[i].y, inn.x - pts[i].x);
    let d = Math.abs(a - b);
    if (d > Math.PI) d = 2 * Math.PI - d;
    const dev = Math.abs(Math.PI - d) * 180 / Math.PI;
    if (dev > (minDeg || 5)) out.push({ i, dev, y: pts[i].y });
  }
  return out;
}
const only = (world) => Object.values(world.state.entities);

console.log('\n== default: the boolean result is already curves ==');
{
  const world = makeWorld();
  const api = build(world);
  twoCircles(world);
  api.cmdBoolean('union');

  const made = only(world);
  check('one object', made.length === 1, made.length);
  const sp = made[0];
  check('a spline', sp && sp.type === 'spline');
  check('it carries real handles (not a polyline)',
    sp && (sp.hs.o.some(h => h) || sp.hs.i.some(h => h)));
  check('and only a handful of nodes', sp && sp.pts.length <= 12, sp ? sp.pts.length : '-');
  const ks = kinks(sp, world);
  check('the two crossings stay sharp', ks.length === 2,
    ks.map(k => k.dev.toFixed(0) + 'deg@y' + k.y.toFixed(1)).join(' '));
  check('one above the axis and one below',
    ks.length === 2 && Math.sign(ks[0].y) !== Math.sign(ks[1].y),
    ks.map(k => k.y.toFixed(1)).join(','));
  check('the kinks really turn (about 106 degrees between the two circles)',
    ks.length === 2 && ks.every(k => k.dev > 60), ks.map(k => k.dev.toFixed(0)).join(','));
  check('the toast reports nodes, not a polyline',
    world.toasts.some(t => /Union: 2 loops .* node.* mm/.test(t)), world.toasts.join(' | '));

  // it must still be a usable loop for the NEXT boolean / CNC
  const poly = world.entityWorldPolylines(sp);
  check('it still yields a closed polyline for downstream work',
    poly.length === 1 && poly[0].closed === true, poly.length);
}

console.log('\n== the fitted result is accurate enough ==');
{
  // compare against the polyline the same boolean produces, so the measurement
  // is against Clipper's own outline rather than against an ideal
  const flat = makeWorld();
  flat.settings.booleanFit = 'poly';
  const fapi = build(flat);
  twoCircles(flat);
  fapi.cmdBoolean('union');
  const polyEnt = only(flat)[0];
  const srcPts = polyEnt.pts.map(i => flat.state.points[i]);
  check('the polyline mode really is a polyline',
    polyEnt.hs.o.every(h => !h) && polyEnt.hs.i.every(h => !h));

  const fitWorld = makeWorld();
  const api = build(fitWorld);
  twoCircles(fitWorld);
  api.cmdBoolean('union');
  const fitted = only(fitWorld)[0];
  const dev = deviation(fitted, fitWorld, srcPts);
  check('the fitted union is within the fit tolerance of the exact outline',
    dev <= 0.2 + 1e-3, dev.toFixed(3) + ' mm');
  check('and it is far simpler (' + srcPts.length + ' -> ' + fitted.pts.length + ' nodes)',
    fitted.pts.length * 20 < srcPts.length);
}

console.log('\n== polyline mode keeps Clipper exact, and Ctrl+K still cleans it ==');
{
  const world = makeWorld();
  world.settings.booleanFit = 'poly';
  const api = build(world);
  twoCircles(world);
  api.cmdBoolean('union');
  const sp = only(world)[0];
  check('a polyline, as asked', sp.hs.o.every(h => !h) && sp.hs.i.every(h => !h));
  check('heavily segmented', sp.pts.length > 100, sp.pts.length + ' points');
  check('splineHasCurves agrees it is a polyline', api.splineHasCurves(sp) === false);

  const before = world.toasts.length;
  const t0 = Date.now();
  api.cmdFitCurve();
  const ms = Date.now() - t0;
  check('Ctrl+K accepts it', !world.toasts.slice(before).some(t => /Select a polyline/.test(t)),
    world.toasts.slice(before).join(' | '));
  const fitted = only(world).find(e => e.type === 'spline');
  check('and fits it to a handful of nodes', fitted && fitted.pts.length <= 12,
    fitted ? fitted.pts.length : '-');
  check('fast now: the polyline is no longer sampled 12x (' + ms + ' ms)', ms < 250, ms);
}

console.log('\n== cut and intersect ==');
for (const mode of ['cut', 'intersect']) {
  const world = makeWorld();
  const api = build(world);
  twoCircles(world);
  api.cmdBoolean(mode);
  const sp = only(world)[0];
  check(mode + ': one curved object, few nodes',
    sp && sp.pts.length <= 12 && (sp.hs.o.some(h => h) || sp.hs.i.some(h => h)),
    sp ? sp.pts.length + ' nodes' : 'none');
}

console.log('\n' + (fail ? fail + ' FAILED, ' : 'all ') + pass + ' checks passed');
process.exit(fail ? 1 : 0);
