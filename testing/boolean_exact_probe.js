// Probe: exact bezier boolean (PathBool) + constraint survival.
//
// The legacy boolean flattened every loop to a polygon (Clipper), rounded to
// 0.001 mm, then re-fitted curves — the shape moved, and every constraint on
// the old geometry died in removeEntities. The exact engine (tools/path-bool.js)
// computes straight on lines/arcs/cubics. This probe lifts the real functions
// out of app.js and checks, against a fake document:
//   1. a union of two circles comes back as real arcs, on the true radii
//   2. a cut keeps the arc of the tool circle exact
//   3. a point-anchored dimension survives the union through a reused point id
//
// Run: node testing/boolean_exact_probe.js
const fs = require('fs');
const path = require('path');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const C = require(path.join(__dirname, '..', 'core.js'));
// The classic vendored build assigns global.PathBool (window.PathBool in the
// browser). Load it the same way the browser does — no ESM duplicate.
require(path.join(__dirname, '..', 'tools', 'path-bool.js'));
const PB = global.PathBool;
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
      points: {}, entities: {}, constraints: {}, namedSel: {},
      layers: [{ id: 1, name: 'Layer 1', visible: true, locked: false }],
      nextId: 200
    },
    ui: { selection: [], activeLayer: 1 },
    settings: { booleanFit: 'exact' },
    toasts: [], history: 0, commits: 0
  };
  world.newId = () => ++world.state.nextId;
  world.P = (id) => world.state.points[+id] || null;
  world.privatePoint = (x, y) => {
    const id = world.newId();
    world.state.points[id] = { x, y };
    return id;
  };
  // the real pointAtWorld without the weldAllowed machinery: reuse any point
  // that sits exactly here
  world.pointAtWorld = (x, y) => {
    for (const key in world.state.points) {
      const p = world.state.points[key];
      if (Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6) return +key;
    }
    return world.privatePoint(x, y);
  };
  world.toast = (m) => world.toasts.push(String(m));
  world.fmt = (v) => String(Math.round(v * 100) / 100);
  world.pushHistory = () => { world.history++; };
  world.commit = () => { world.commits++; };
  world.removeEntities = (ids) => {
    const gone = new Set(ids.map(Number));
    for (const id of gone) delete world.state.entities[id];
    // like the real one: constraints referencing eaten entities die
    for (const cid in world.state.constraints) {
      const c = world.state.constraints[cid];
      if (gone.has(+c.entity) || gone.has(+c.line) ||
          gone.has(+c.line1) || gone.has(+c.line2)) delete world.state.constraints[cid];
    }
  };
  world.colorOf = (e) => (e && e.color) || '#000000';
  world.circleData = (e) => {
    const c = world.P(e.c);
    if (!c) return null;
    // a circle stores r; an arc's radius IS the centre-to-start distance
    if (e.r != null) return { c, r: e.r };
    const s = world.P(e.s);
    return s ? { c, r: Math.hypot(s.x - c.x, s.y - c.y) } : null;
  };
  world.arcData = (e) => {
    const cd = world.circleData(e);
    if (!cd) return null;
    const s = world.P(e.s), en = world.P(e.e);
    if (!s || !en) return null;
    const a0 = Math.atan2(s.y - cd.c.y, s.x - cd.c.x);
    const a1 = Math.atan2(en.y - cd.c.y, en.x - cd.c.x);
    return { ...cd, a0, a1, sweep: C.norm2pi(a1 - a0) };
  };
  world.entityPointIds = (e) => {
    if (!e) return [];
    if (e.type === 'spline') return e.pts || [];
    if (e.type === 'line') return [e.a, e.b];
    if (e.type === 'circle') return [e.c];
    if (e.type === 'arc') return [e.s, e.e];
    return [];
  };
  world.ensureSplineHandles = (e) => {
    if (!e || e.type !== 'spline') return null;
    const cps = (e.pts || []).map(i => world.P(i)).filter(Boolean);
    if (!e.hs || e.hs.o.length !== cps.length) e.hs = C.autoHandles(cps, !!e.closed);
    return e.hs;
  };
  // trace loops from coincident points, in the shape getLoops() returns
  world.getLoops = () => {
    const find = (pid) => {
      for (const key in world.state.points) {
        const p = world.state.points[key];
        if (Math.abs(p.x - world.P(pid).x) < 1e-9 && Math.abs(p.y - world.P(pid).y) < 1e-9) return +key;
      }
      return +pid;
    };
    const loops = [];
    for (const id in world.state.entities) {
      const e = world.state.entities[id];
      if (e.type === 'circle') {
        loops.push({ circle: true, entity: +id, ents: [+id] });
      } else if (e.type === 'spline' && e.closed) {
        loops.push({ splineEntity: +id, ents: [+id] });
      }
    }
    // line chains
    const used = new Set();
    for (const id in world.state.entities) {
      const e0 = world.state.entities[id];
      if (e0.type !== 'line' || used.has(+id)) continue;
      const steps = [];
      let cur = find(e0.a);
      let guard = 0;
      let eid = +id;
      while (guard++ < 1000) {
        const e = world.state.entities[eid];
        if (!e || e.type !== 'line') break;
        used.add(eid);
        const a = find(e.a), b = find(e.b);
        const fwd = a === cur;
        steps.push({ edge: { entity: eid, aNode: a, bNode: b }, from: fwd ? a : b, to: fwd ? b : a });
        cur = fwd ? b : a;
        if (cur === steps[0].from) break;
        let next = null;
        for (const oid in world.state.entities) {
          const oe = world.state.entities[oid];
          if (oe.type !== 'line' || used.has(+oid)) continue;
          if (find(oe.a) === cur) { next = +oid; break; }
          if (find(oe.b) === cur) { next = +oid; break; }
        }
        if (next == null) break;
        eid = next;
      }
      if (steps.length > 2 && cur === steps[0].from) loops.push({ steps, ents: steps.map(s => s.edge.entity) });
    }
    return loops;
  };
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
    slice('addPanelEntity')
  ].join('\n');
  return new Function(
    'state', 'ui', 'settings', 'pathBoolLib', 'clipperLib', 'PathBoolUnused',
    'BOOL_EPS', 'P', 'arcData', 'circleData', 'entityPointIds', 'ensureSplineHandles',
    'autoHandles', 'norm2pi', 'wrapPi', 'pointAtWorld', 'privatePoint', 'newId',
    'colorOf', 'loopEntities', 'getLoops', 'pushHistory', 'commit', 'toast', 'fmt',
    'removeEntities', 'signedAreaPts', 'addPanelEntity', 'render', 'requestRender', 'invalidateLoops', 'cleanupPoints',
    `const window = { PathBool: pathBoolLib() };
     ${body}
     return { cmdBoolean };`
  )(
    world.state, world.ui, world.settings, () => PB, () => null, null,
    1e-6, world.P, world.arcData, world.circleData, world.entityPointIds,
    world.ensureSplineHandles, C.autoHandles, C.norm2pi, C.wrapPi,
    world.pointAtWorld, world.privatePoint, world.newId, world.colorOf,
    world.loopEntities, world.getLoops, world.pushHistory, world.commit,
    world.toast, world.fmt, world.removeEntities, C.signedAreaPts,
    null, () => {}, () => {}, () => {}, () => {} // addPanelEntity / render / invalidateLoops / cleanupPoints
  );
}

// chain the result entities into closed loops and sum the signed shoelace
// areas — holes subtract themselves. Endpoints are matched geometrically
// (tolerance), not by key: the two outer arcs of a union end at the lens
// intersection points, whose coordinates can differ in the last bits.
function loopArea(world) {
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-4 || Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 1e-9;
  const items = [];
  for (const id in world.state.entities) {
    const e = world.state.entities[id];
    const pts = [];
    if (e.type === 'arc') {
      const ad = world.arcData(e);
      if (!ad) continue;
      for (let k = 0; k <= 512; k++) {
        const a = ad.a0 + ad.sweep * k / 512;
        pts.push({ x: ad.c.x + Math.cos(a) * ad.r, y: ad.c.y + Math.sin(a) * ad.r });
      }
    } else if (e.type === 'spline') {
      const cps = (e.pts || []).map(i => world.P(i)).filter(Boolean);
      if (cps.length < 2) continue;
      const cb = C.splineCubics(cps, e.hs, !!e.closed);
      for (const c of cb) {
        for (let k = 0; k <= 64; k++) pts.push(C.cubicAt(c.P0, c.P1, c.P2, c.P3, k / 64));
      }
    } else continue;
    if (pts.length > 1) items.push({ start: pts[0], end: pts[pts.length - 1], pts });
  }
  let total = 0;
  while (items.length) {
    let chain = items.shift();
    let guard = 0;
    while (!near(chain.end, chain.start) && guard++ < items.length + 2) {
      const idx = items.findIndex(it => near(it.start, chain.end) || near(it.end, chain.end));
      if (idx < 0) break;
      const it = items.splice(idx, 1)[0];
      const fwd = near(it.start, chain.end);
      const pts = fwd ? it.pts : it.pts.slice().reverse();
      chain = { start: chain.start, end: fwd ? it.end : it.start,
        pts: chain.pts.concat(pts.slice(1)) };
    }
    let ar = 0;
    const pts = chain.pts;
    for (let i = 0; i < pts.length - 1; i++) ar += pts[i].x * pts[i + 1].y - pts[i + 1].x * pts[i].y;
    total += ar / 2;
  }
  return Math.abs(total);
}

function circleEnt(world, cx, cy, r) {
  const c = world.privatePoint(cx, cy);
  const id = world.newId();
  world.state.entities[id] = { id, type: 'circle', c, r, color: '#000000', layer: 1 };
  return id;
}

console.log('\n== exact engine: union of two circles ==');
{
  const world = makeWorld();
  const api = build(world);
  const a = circleEnt(world, 0, 0, 50);
  const b = circleEnt(world, 60, 0, 50);
  world.ui.selection = [{ kind: 'entity', id: a }, { kind: 'entity', id: b }];
  api.cmdBoolean('union');
  const made = Object.values(world.state.entities);
  check('old entities gone', !world.state.entities[a] && !world.state.entities[b]);
  check('result exists', made.length > 0, made.length);
  check('result is arcs (no fitting)', made.every(e => e.type === 'arc'), made.map(e => e.type).join(','));
  // every arc must sit on one of the two true circles
  let worst = 0;
  for (const e of made) {
    const ad = world.arcData(e);
    // the arc must SIT on one of the two true circles: its centre within
    // tolerance of a centre, and its radius equal
    const d1 = Math.hypot(ad.c.x - 0, ad.c.y - 0);
    const d2 = Math.hypot(ad.c.x - 60, ad.c.y - 0);
    worst = Math.max(worst, Math.min(d1, d2), Math.abs(ad.r - 50));
  }
  check('arcs on the exact original circles', worst < 1e-9, worst);
  const area = loopArea(world);
  // lens = 2r²(θ − sinθcosθ), θ = angle from a centre to an intersection point
  const th = Math.acos(30 / 50);
  const lens = 2 * 2500 * (th - (40 / 50) * (30 / 50));
  check('union area exact', Math.abs(area - (2 * Math.PI * 2500 - lens)) < 0.5,
    area.toFixed(6) + ' vs ' + (2 * Math.PI * 2500 - lens).toFixed(6));
}

console.log('\n== exact engine: rect minus circle keeps the hole exact ==');
{
  const world = makeWorld();
  const api = build(world);
  // rect 0..100 x 0..60 as four lines
  const ps = [[0, 0], [100, 0], [100, 60], [0, 60]].map(([x, y]) => world.privatePoint(x, y));
  const ids = [];
  for (let i = 0; i < 4; i++) {
    const id = world.newId();
    world.state.entities[id] = { id, type: 'line', a: ps[i], b: ps[(i + 1) % 4], color: '#000000', layer: 1 };
    ids.push(id);
  }
  const hole = circleEnt(world, 50, 30, 10);
  world.ui.selection = [{ kind: 'entity', id: hole }, ...ids.map(id => ({ kind: 'entity', id }))];
  api.cmdBoolean('cut');
  const made = Object.values(world.state.entities);
  const arcs = made.filter(e => e.type === 'arc');
  check('result has entities', made.length > 0);
  check('the tool circle came back as exact arcs', arcs.length >= 1 &&
    arcs.every(e => {
      const ad = world.arcData(e);
      return ad && Math.abs(ad.r - 10) < 1e-9 &&
        Math.hypot(ad.c.x - 50, ad.c.y - 30) < 1e-9;
    }),
    arcs.map(e => { const ad = world.arcData(e); return ad ? ad.r : 'null'; }).join(','));
  const area = loopArea(world);
  check('cut area exact', Math.abs(area - (6000 - Math.PI * 100)) < 1e-2,
    area.toFixed(6) + ' vs ' + (6000 - Math.PI * 100).toFixed(6));
}

console.log('\n== constraints survive through reused point ids ==');
{
  const world = makeWorld();
  const api = build(world);
  // two overlapping rects sharing exact corners
  const ps = [[0, 0], [100, 0], [100, 50], [0, 50]].map(([x, y]) => world.privatePoint(x, y));
  const ids = [];
  for (let i = 0; i < 4; i++) {
    const id = world.newId();
    world.state.entities[id] = { id, type: 'line', a: ps[i], b: ps[(i + 1) % 4], color: '#000000', layer: 1 };
    ids.push(id);
  }
  const bottomLeft = ps[0], bottomRight = ps[1];
  const ck = world.newId();
  world.state.constraints[ck] = { id: ck, type: 'distance', p1: bottomLeft, p2: bottomRight, value: 100 };
  const r2ps = [[30, 10], [130, 10], [130, 60], [30, 60]].map(([x, y]) => world.privatePoint(x, y));
  const ids2 = [];
  for (let i = 0; i < 4; i++) {
    const id = world.newId();
    world.state.entities[id] = { id, type: 'line', a: r2ps[i], b: r2ps[(i + 1) % 4], color: '#000000', layer: 1 };
    ids2.push(id);
  }
  world.ui.selection = [...ids, ...ids2].map(id => ({ kind: 'entity', id }));
  api.cmdBoolean('union');
  const cons = Object.values(world.state.constraints);
  const dist = cons.find(c => c.type === 'distance');
  check('distance constraint survived', !!dist);
  if (dist) {
    const p1 = world.P(dist.p1), p2 = world.P(dist.p2);
    check('it still measures the original 100 mm span',
      !!p1 && !!p2 && Math.abs(Math.hypot(p1.x - p2.x, p1.y - p2.y) - 100) < 1e-6,
      p1 && p2 ? Math.hypot(p1.x - p2.x, p1.y - p2.y) : 'missing point');
  }
  check('no constraint reported dropped', !/dropped/.test(world.toasts.join(' ')), world.toasts.join(' | '));
}

console.log('\n== degenerate inputs do not break the exact engine ==');
{
  const world = makeWorld();
  const api = build(world);
  // a closed spline whose last node repeats the first (imported outlines do
  // this): the duplicate used to reach PathBoolean as a zero-length span and
  // blow up face flagging, dumping the boolean into the legacy Clipper+fit
  // path — the source of the distorted results
  const T = [[0,0],[100,0],[100,20],[70,20],[70,120],[30,120],[30,20],[0,20],[0,0]];
  const ps = T.map(([x,y]) => world.privatePoint(x,y));
  const sid = world.newId();
  world.state.entities[sid] = { id: sid, type: 'spline', pts: ps,
    hs: { o: ps.map(() => null), i: ps.map(() => null) }, closed: true, color: '#000000', layer: 1 };
  const rps = [[30,50],[70,50],[70,70],[30,70]].map(([x,y]) => world.privatePoint(x,y));
  const rids = [];
  for (let i = 0; i < 4; i++) {
    const id = world.newId();
    world.state.entities[id] = { id, type: 'line', a: rps[i], b: rps[(i + 1) % 4], color: '#000000', layer: 1 };
    rids.push(id);
  }
  world.ui.selection = [...rids.map(id => ({ kind: 'entity', id })), { kind: 'entity', id: sid }];
  api.cmdBoolean('cut');
  const made = Object.values(world.state.entities).filter(e => !rids.includes(e.id));
  check('duplicate closing node still cuts', made.length === 2, made.length);
  check('no Clipper fallback happened', !/Clipper/.test(world.toasts.join(' ')), world.toasts.join(' | '));
  const area = loopArea(world);
  const want = (100*20 + 40*100 + (40*20 - 40*20)) - 40*20; // bar + stem - cut slot
  check('cut area exact with degenerate input', Math.abs(area - (2000 + 4000 - 800)) < 1e-2,
    area.toFixed(4) + ' vs ' + (2000 + 4000 - 800).toFixed(4));
}

console.log('\n== cut with more than two loops keeps every target ==');
{
  const world = makeWorld();
  const api = build(world);
  const rect = (x0,y0,x1,y1) => {
    const ps = [[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(([x,y]) => world.privatePoint(x,y));
    const ids = [];
    for (let i = 0; i < 4; i++) {
      const id = world.newId();
      world.state.entities[id] = { id, type: 'line', a: ps[i], b: ps[(i + 1) % 4], color: '#000000', layer: 1 };
      ids.push(id);
    }
    return ids;
  };
  const bar = rect(0,0,100,20), stem = rect(30,20,70,120), tool = rect(10,40,90,60);
  // tool first, then BOTH targets — the old code silently dropped the stem
  world.ui.selection = [...tool, ...bar, ...stem].map(id => ({ kind: 'entity', id }));
  api.cmdBoolean('cut');
  const made = Object.values(world.state.entities);
  check('both targets survive the cut', made.length === 2, made.length);
  const area = loopArea(world);
  check('T-minus-slot area exact', Math.abs(area - (2000 + 4000 - 800)) < 1e-2,
    area.toFixed(4));
}

console.log('\n== CW-drawn loops union correctly ==');
{
  // a loop drawn clockwise (its dense poly has negative area) used to slip
  // through the sample-based winding check and produce garbage; the dense
  // poly is now the sign authority
  const mk = (world, pts, hOut, hIn) => {
    const ps = pts.map(([x,y]) => world.privatePoint(x,y));
    const id = world.newId();
    world.state.entities[id] = { id, type: 'spline', pts: ps,
      hs: { o: ps.map(hOut), i: ps.map(hIn) }, closed: true, color: '#000000', layer: 1 };
    return id;
  };
  const flat = () => null;
  for (const hOut of [flat, (p) => ({ x: p.x + 8, y: p.y - 6 })]) {
    const world = makeWorld();
    const api = build(world);
    // CW order (negative shoelace) + a CCW partner
    const a = mk(world, [[40,150],[150,170],[200,10]], hOut, flat);
    const b = mk(world, [[240,40],[180,150],[120,20]], hOut, flat);
    world.ui.selection = [{ kind: 'entity', id: a }, { kind: 'entity', id: b }];
    api.cmdBoolean('union');
    const made = Object.values(world.state.entities);
    check('CW loop unions into one result (handles: ' + (hOut === flat ? 'flat' : 'bulged') + ')',
      made.length === 1, made.length);
    // overlap of the two triangles must be eaten: nodes > any input's 3
    check('  and is a merged outline, not a slice',
      made.length === 1 && made[0].pts.length > 4, made[0] && made[0].pts.length);
  }
}

console.log('\n' + (fail ? fail + ' FAILED, ' : '') + pass + ' passed');
process.exit(fail ? 1 : 0);
