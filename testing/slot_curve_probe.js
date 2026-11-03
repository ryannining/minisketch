// Probe for the Slot generator: it must accept CURVED input (spline / arc /
// circle), follow the curve instead of the screen tessellation, and hand back
// SMOOTH geometry (fitted Bezier curves) instead of a many-segment polyline.
//
// Run: node testing/slot_curve_probe.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const C = require(path.join(__dirname, '..', 'core.js'));

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

const root = path.join(__dirname, '..');
const slotSrc = fs.readFileSync(path.join(root, 'tools', 'slot.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

// ---- helpers ---------------------------------------------------------------
function braceEnd(src, from) {
  let i = src.indexOf('{', from), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) return j + 1; }
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

function loadSlot() {
  let reg = null;
  const sandbox = {
    window: { MiniSketchTools: { register: (t) => { reg = t; }, close: () => {} } },
    console
  };
  sandbox.localStorage = {
    _d: {},
    getItem(k) { return this._d[k] == null ? null : this._d[k]; },
    setItem(k, v) { this._d[k] = String(v); }
  };
  // the dialog fields apply() reads
  const fields = { 'slot-d': '10', 'slot-detail': '0.05', 'slot-corner': 'miter' };
  sandbox.document = {
    getElementById: (id) => (id in fields ? { value: fields[id], focus() {} } : null)
  };
  vm.createContext(sandbox);
  vm.runInContext(slotSrc, sandbox, { filename: 'slot.js' });
  return { reg, fields };
}

// A small world with the real flattening / fitting wired in, so the numbers in
// the assertions mean something.
function makeWorld() {
  const state = { points: {}, entities: {}, constraints: {}, layers: [{ id: 1, visible: true }], nextId: 1 };
  const made = [];
  const toasts = [];

  const P = (id) => state.points[id];
  const entityPointIds = (e) => (e.type === 'spline' ? (e.pts || [])
    : e.type === 'circle' ? [e.c] : e.type === 'arc' ? [e.c, e.s, e.e] : []);
  const privatePoint = (x, y) => {
    const id = state.nextId++;
    state.points[id] = { id, x, y };
    return id;
  };

  // the real fitter, same call shape app.js uses
  const addFittedSpline = new Function(
    'state', 'newId', 'privatePoint', 'ui', 'fitPolylineCurve',
    slice('addFittedSpline') + '\nreturn addFittedSpline;'
  )(state, () => state.nextId++, privatePoint, { activeLayer: 1 }, C.fitPolylineCurve);

  const pathChainsOf = new Function(
    'P', 'TAU', 'entityPointIds', 'flattenSpline', 'circleData', 'arcData',
    'arcCubicNodes', 'entityWorldPolylines',
    slice('pathChainsOf') + '\nreturn pathChainsOf;'
  )(
    P, Math.PI * 2, entityPointIds, C.flattenSpline,
    (e) => { const c = P(e.c); return c ? { c, r: e.r } : null; },
    (e) => {
      const c = P(e.c), s = P(e.s), en = P(e.e);
      if (!c || !s || !en) return null;
      const a0 = Math.atan2(s.y - c.y, s.x - c.x);
      const a1 = Math.atan2(en.y - c.y, en.x - c.x);
      let sweep = a1 - a0;
      while (sweep <= 0) sweep += Math.PI * 2;
      return { c, r: Math.hypot(s.x - c.x, s.y - c.y), a0, sweep };
    },
    C.arcCubicNodes,
    () => []
  );

  const api = {
    state,
    ui: { color: '#000000', activeLayer: 1, selection: [] },
    settings: { joinTol: 0.1 },
    P,
    clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
    fmt: (v) => String(Math.round(v * 100) / 100),
    selectedEntities: () => [],
    colorOf: (e) => (e && e.color) || '#000000',
    entityPointIds,
    chainPolylines: C.chainPolylines,
    normalizeWinding: C.normalizeWinding,
    signedAreaPts: C.signedAreaPts,
    clipperLib: () => require(path.join(root, 'tools', 'clipper.js')),
    offsetScale: 1000,
    offsetPrecision: 0.001,
    offsetMiter: () => 4,
    pushHistory: () => {},
    commit: () => {},
    toast: (m) => toasts.push(String(m)),
    cmdGroupSelection: () => {},
    pathChainsOf,
    addPanelEntity: (pts) => {
      const pids = pts.map(p => privatePoint(p.x, p.y));
      const id = state.nextId++;
      state.entities[id] = {
        id, type: 'spline', pts: pids, closed: true, color: '#000000', layer: 1,
        hs: { o: pids.map(() => null), i: pids.map(() => null) }
      };
      made.push({ id, kind: 'polyline' });
      return id;
    },
    addFittedCurve: (pts, color, o) => {
      const id = addFittedSpline(pts, color, o);
      if (id) made.push({ id, kind: 'fitted' });
      return id;
    }
  };
  return { api, state, made, toasts, privatePoint };
}

// fixtures
function addCircle(world, r) {
  const c = world.privatePoint(0, 0);
  const id = world.state.nextId++;
  world.state.entities[id] = { id, type: 'circle', c, r, color: '#000000', layer: 1 };
  return () => [world.state.entities[id]];
}
function addSpline(world) {
  const ids = [world.privatePoint(-30, 0), world.privatePoint(0, 25), world.privatePoint(30, 0)];
  const id = world.state.nextId++;
  world.state.entities[id] = {
    id, type: 'spline', pts: ids, closed: false, color: '#000000', layer: 1,
    hs: {
      o: [{ x: -20, y: 0 }, { x: -10, y: 25 }, { x: 20, y: 0 }],
      i: [{ x: -20, y: 0 }, { x: 10, y: 25 }, { x: 20, y: 0 }]
    }
  };
  return () => [world.state.entities[id]];
}

const loaded = loadSlot();
const reg = loaded.reg;
check('the tool registers', !!reg && reg.id === 'slot');

console.log('\n== a CURVE is accepted as input ==');
{
  const world = makeWorld();
  world.api.selectedEntities = addSpline(world);
  reg.apply(world.api);
  check('it built an outline from a spline', world.made.length > 0, world.toasts.join(' | '));
  check('the outline was fitted to curves', world.made.every(m => m.kind === 'fitted'),
    world.made.map(m => m.kind).join(','));
}

console.log('\n== a CIRCLE becomes a closed groove ==');
{
  const world = makeWorld();
  world.api.selectedEntities = addCircle(world, 20);
  reg.apply(world.api);
  check('it built two outlines (outside + inside)', world.made.length === 2, world.made.length);
  check('both were fitted to curves', world.made.every(m => m.kind === 'fitted'));
}

console.log('\n== the result is smooth, not a dense polyline ==');
{
  const world = makeWorld();
  world.api.selectedEntities = addCircle(world, 20);
  reg.apply(world.api);
  const nodes = world.made.map(m => (world.state.entities[m.id].pts || []).length);
  check('each ring is a handful of nodes', nodes.every(n => n > 0 && n <= 16), nodes.join('/'));
  check('the nodes carry real handles', world.made.every(m => {
    const hs = world.state.entities[m.id].hs || {};
    return (hs.o || []).some(h => h) || (hs.i || []).some(h => h);
  }));
}

console.log('\n== the fitted rings follow the true offset ==');
{
  const world = makeWorld();
  world.api.selectedEntities = addCircle(world, 20);
  reg.apply(world.api);
  const worst = world.made.map((m) => {
    const ent = world.state.entities[m.id];
    const cps = (ent.pts || []).map(id => world.state.points[id]).filter(Boolean);
    const samples = C.flattenSpline(cps, ent.hs || { o: [], i: [] }, true, 0.01);
    let w = 0;
    for (const p of samples) {
      const r = Math.hypot(p.x, p.y);
      const err = Math.min(Math.abs(r - 25), Math.abs(r - 15));
      if (err > w) w = err;
    }
    return w;
  });
  check('every point sits on r=25 or r=15', worst.every(e => e < 0.2),
    worst.map(r => r.toFixed(3)).join(' / '));
}

console.log('\n== the source sampling follows the curve, not the screen ==');
{
  // A spline sampled at SPLINE_SEG (12/span) on this shape is coarse; the tool
  // must ask for a finer tolerance so the offset does not inherit faceting.
  check('the tool samples the source by tolerance',
    /pathChainsOf\(picked,/.test(slotSrc) || /flattenSpline\(/.test(slotSrc));
  check('the tool fits the offset back to curves',
    /addFittedCurve|fitPolylineCurve/.test(slotSrc));
  check('it asks for no de-noising (the offset is exact geometry)',
    /denoise:\s*false/.test(slotSrc));
  check('the detail is a stored parameter', /detail/.test(slotSrc) && /slot-detail/.test(slotSrc));
}

console.log('\n' + (fail ? fail + ' FAILED, ' : 'all ') + pass + ' checks passed');
process.exit(fail ? 1 : 0);
