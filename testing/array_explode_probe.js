// Probe: array/clone -> independent curves (-> Curve on an array).
// Every instance must become a real spline with its own points, handles
// transformed with the nodes, colours/closed flags kept, and the master
// untouched. Covers clone matrices (incl. anchor compensation), grid offsets
// and circle masters (which become Bezier splines, never polylines).
//
// Run: node testing/array_explode_probe.js
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

function makeWorld() {
  const world = {
    state: { points: {}, entities: {}, constraints: {}, layers: [{ id: 1 }], nextId: 300 },
    ui: { selection: [], activeLayer: 1 }
  };
  world.newId = () => ++world.state.nextId;
  world.P = (id) => world.state.points[+id] || null;
  world.privatePoint = (x, y) => {
    const id = world.newId();
    world.state.points[id] = { x, y };
    return id;
  };
  world.colorOf = (e) => (e && e.color) || '#000000';
  world.layerOf = (e) => (e && e.layer != null ? e.layer : 1);
  world.entityPointIds = (e) => {
    if (!e) return [];
    if (e.type === 'line') return [e.a, e.b];
    if (e.type === 'spline') return e.pts || [];
    if (e.type === 'circle') return [e.c];
    if (e.type === 'array') return e.kind === 'clone' ? [] : (e.masters || []).flatMap(mid => world.entityPointIds(world.state.entities[mid]));
    return [];
  };
  world.entityWorldPolylines = (e) => {
    if (!e) return [];
    if (e.type === 'line') {
      const a = world.P(e.a), b = world.P(e.b);
      return a && b ? [{ pts: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }], closed: false }] : [];
    }
    if (e.type === 'spline') {
      const hasCurves = !!(e.hs && ((e.hs.o || []).some(h => h) || (e.hs.i || []).some(h => h)));
      if (hasCurves) return [];   // curved splines go through collectCurveSources, not here
      const pts = (e.pts || []).map(i => world.P(i)).filter(Boolean).map(p => ({ x: p.x, y: p.y }));
      return pts.length >= 2 ? [{ pts, closed: !!e.closed }] : [];
    }
    return [];
  };
  world.circleData = (e) => {
    if (!e || e.type !== 'circle') return null;
    const c = world.P(e.c);
    return c ? { c, r: e.r } : null;
  };
  world.arcData = () => null;
  world.artCurveSource = () => null;
  world.isSingleLineFont = () => false;
  world.textStrokesWorld = () => [];
  world.textExactLoopsWorld = () => null;
  return world;
}

function build(world) {
  const body = [
    slice('cloneAnchorOf'),
    slice('cloneInstanceOffsets'),
    slice('arrayInstanceOffsets'),
    slice('arrayXformPoint'),
    slice('collectCurveSources'),
    slice('arrayMasterCurveSources'),
    slice('explodeArrayToCurves'),
    slice('addFittedSpline')
  ].join('\n');
  return new Function(
    'state', 'ui', 'newId', 'P', 'privatePoint', 'colorOf', 'layerOf',
    'entityPointIds', 'entityWorldPolylines', 'circleData', 'arcData',
    'artCurveSource', 'isSingleLineFont', 'textStrokesWorld', 'textExactLoopsWorld',
    'matMul', 'arcCubicNodes', 'fitPolylineCurve', 'TAU',
    `${body}
     return { explodeArrayToCurves, arrayInstanceOffsets };`
  )(
    world.state, world.ui, world.newId, world.P, world.privatePoint,
    world.colorOf, world.layerOf, world.entityPointIds, world.entityWorldPolylines,
    world.circleData, world.arcData, world.artCurveSource, world.isSingleLineFont,
    world.textStrokesWorld, world.textExactLoopsWorld,
    C.matMul, C.arcCubicNodes, C.fitPolylineCurve, C.TAU
  );
}

const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-6);

// ---- 1. clone with a rotation matrix: nodes AND handles transform --------
{
  const w = makeWorld();
  const api = build(w);
  // master: open spline, 3 nodes, one out-handle on node 0
  const p0 = w.privatePoint(0, 0), p1 = w.privatePoint(10, 0), p2 = w.privatePoint(10, 5);
  const mid = w.newId();
  w.state.entities[mid] = {
    id: mid, type: 'spline', pts: [p0, p1, p2], closed: false, color: '#ff0000', layer: 1,
    hs: { o: [{ x: 4, y: -2 }, null, null], i: [null, null, null] }
  };
  const aid = w.newId();
  // 90 deg rotation + translation (100, 20)
  w.state.entities[aid] = {
    id: aid, type: 'array', kind: 'clone', color: '#ff0000', layer: 1,
    masters: [mid], instances: [{ m: [0, 1, -1, 0, 100, 20], a: [0, 0] }]
  };
  const created = api.explodeArrayToCurves(w.state.entities[aid]);
  check('clone: one spline per instance', created.length === 1, created.length);
  const s = w.state.entities[created[0]];
  check('clone: result is a spline with its own points', s && s.type === 'spline' && s.pts.length === 3 &&
    s.pts.every(pid => pid !== p0 && pid !== p1 && pid !== p2));
  const q = s.pts.map(pid => w.P(pid));
  check('clone: nodes rotated+translated', near(q[0].x, 100) && near(q[0].y, 20) &&
    near(q[1].x, 100) && near(q[1].y, 30) && near(q[2].x, 95) && near(q[2].y, 30),
    JSON.stringify(q));
  check('clone: handle transformed too', s.hs.o[0] && near(s.hs.o[0].x, 102) && near(s.hs.o[0].y, 24),
    JSON.stringify(s.hs.o[0]));
  check('clone: colour and open flag kept', s.color === '#ff0000' && !s.closed);
  check('clone: master untouched', w.P(p0).x === 0 && w.P(p1).x === 10 &&
    w.state.entities[mid].hs.o[0].x === 4);
}

// ---- 2. anchor compensation: master moved after cloning ------------------
{
  const w = makeWorld();
  const api = build(w);
  const p0 = w.privatePoint(0, 0), p1 = w.privatePoint(10, 0);
  const mid = w.newId();
  w.state.entities[mid] = { id: mid, type: 'line', a: p0, b: p1, color: '#0000ff', layer: 1 };
  const aid = w.newId();
  w.state.entities[aid] = {
    id: aid, type: 'array', kind: 'clone', masters: [mid],
    instances: [{ m: [1, 0, 0, 1, 50, 0], a: [0, 0] }]
  };
  // drag the master by (7, 3): the clone must NOT follow
  w.P(p0).x += 7; w.P(p0).y += 3; w.P(p1).x += 7; w.P(p1).y += 3;
  const created = api.explodeArrayToCurves(w.state.entities[aid]);
  const s = w.state.entities[created[0]];
  const q = s.pts.map(pid => w.P(pid));
  check('anchor: clone stays pinned where it was placed',
    near(q[0].x, 50) && near(q[0].y, 0) && near(q[1].x, 60) && near(q[1].y, 0),
    JSON.stringify(q));
}

// ---- 3. grid array: rows x cols minus the implicit base ------------------
{
  const w = makeWorld();
  const api = build(w);
  const p0 = w.privatePoint(0, 0), p1 = w.privatePoint(5, 0);
  const mid = w.newId();
  w.state.entities[mid] = { id: mid, type: 'line', a: p0, b: p1, color: '#000000', layer: 1 };
  const aid = w.newId();
  w.state.entities[aid] = {
    id: aid, type: 'array', kind: 'grid', masters: [mid],
    params: { rows: 2, cols: 2, dx: 10, dy: 5 }
  };
  const created = api.explodeArrayToCurves(w.state.entities[aid]);
  check('grid: 3 instances for 2x2 (base stays the master)', created.length === 3, created.length);
  const starts = created.map(id => w.P(w.state.entities[id].pts[0]));
  const want = [[10, 0], [0, 5], [10, 5]];
  check('grid: offsets correct', want.every(([x, y]) => starts.some(p => near(p.x, x) && near(p.y, y))),
    JSON.stringify(starts));
  check('grid: straight master stays handle-free', created.every(id => {
    const s = w.state.entities[id];
    return s.hs.o.every(h => !h) && s.hs.i.every(h => !h);
  }));
}

// ---- 4. circle master becomes a closed Bezier spline ---------------------
{
  const w = makeWorld();
  const api = build(w);
  const pc = w.privatePoint(20, 20);
  const mid = w.newId();
  w.state.entities[mid] = { id: mid, type: 'circle', c: pc, r: 5, color: '#00ff00', layer: 1 };
  const aid = w.newId();
  w.state.entities[aid] = {
    id: aid, type: 'array', kind: 'clone', masters: [mid],
    instances: [{ m: [1, 0, 0, 1, 30, 0], a: [20, 20] }]
  };
  const created = api.explodeArrayToCurves(w.state.entities[aid]);
  const s = w.state.entities[created[0]];
  check('circle: 4-node closed spline with handles', s && s.type === 'spline' && s.closed &&
    s.pts.length === 4 && s.hs.o.every(h => h));
  const q0 = w.P(s.pts[0]);
  check('circle: placed at the translated centre', near(q0.x, 55) && near(q0.y, 20),
    JSON.stringify(q0));
}

// ---- 5. no instances -> nothing created ----------------------------------
{
  const w = makeWorld();
  const api = build(w);
  const p0 = w.privatePoint(0, 0), p1 = w.privatePoint(5, 0);
  const mid = w.newId();
  w.state.entities[mid] = { id: mid, type: 'line', a: p0, b: p1 };
  const aid = w.newId();
  w.state.entities[aid] = { id: aid, type: 'array', kind: 'clone', masters: [mid], instances: [] };
  check('empty: no instances -> no curves', api.explodeArrayToCurves(w.state.entities[aid]).length === 0);
}

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);