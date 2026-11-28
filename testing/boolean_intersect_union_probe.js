// Probe: intersect must UNION the targets before intersecting with the tool.
//
// Reported case (the "two circles + box" sketch): a box spanning the middle,
// one circle overlapping its left edge and one overlapping its right edge. The
// two circles never touch each other. Selecting [circle, circle, box] and
// pressing Ctrl+0 (intersect, box = tool last) used to return NOTHING: the
// engine fused the two targets (circles) with an INTERSECTION first, and two
// disjoint circles intersect to empty — so stage 2 had nothing to intersect
// with the box.
//
// Fix: for intersect the targets fuse by UNION (single target stays as-is), so
// the two circles become one region, which then intersects the box into the two
// circle-inside-box lenses.
//
// Run: node testing/boolean_intersect_union_probe.js
const fs = require('fs');
const path = require('path');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const C = require(path.join(__dirname, '..', 'core.js'));
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

// Same minimal world as boolean_exact_probe.js (union/cut share it; this probe
// exercises the intersect branch of cmdBooleanExact).
function makeWorld() {
  const world = {
    state: {
      points: {}, entities: {}, constraints: {},
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
    slice('loopsSameRegion'),
    slice('dedupeLoops'),
    slice('orderLoopsBySelection'),
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
    null, () => {}, () => {}, () => {}, () => {}
  );
}

// chain result arcs/splines into rings, drop holes by containment, sum area
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
  const rings = [];
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
    rings.push({ pts, ar: ar / 2 });
  }
  const inside = (outer, p) => {
    let hit = false;
    const q = outer.pts;
    for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
      const xi = q[i].x, yi = q[i].y, xj = q[j].x, yj = q[j].y;
      if (((yi > p.y) !== (yj > p.y)) &&
          (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi)) hit = !hit;
    }
    return hit;
  };
  const sample = (ring) => {
    const q = ring.pts;
    for (let i = 0; i + 1 < q.length; i++) {
      const p = { x: (q[i].x + q[i + 1].x) / 2, y: (q[i].y + q[i + 1].y) / 2 };
      if (q.some((v, vi) => vi !== i && vi !== i + 1 && near(v, p))) continue;
      return p;
    }
    return q[0];
  };
  let total = 0;
  for (let i = 0; i < rings.length; i++) {
    let depth = 0;
    const p = sample(rings[i]);
    for (let j = 0; j < rings.length; j++) {
      if (j !== i && inside(rings[j], p)) depth++;
    }
    total += (depth % 2 === 0 ? 1 : -1) * Math.abs(rings[i].ar);
  }
  return total;
}

function circleEnt(world, cx, cy, r) {
  const c = world.privatePoint(cx, cy);
  const id = world.newId();
  world.state.entities[id] = { id, type: 'circle', c, r, color: '#000000', layer: 1 };
  return id;
}
function rectEnts(world, x0, y0, x1, y1) {
  const ps = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => world.privatePoint(x, y));
  const ids = [];
  for (let i = 0; i < 4; i++) {
    const id = world.newId();
    world.state.entities[id] = { id, type: 'line', a: ps[i], b: ps[(i + 1) % 4], color: '#000000', layer: 1 };
    ids.push(id);
  }
  return ids;
}

// The reported sketch: box 0..120 x 0..220, two r=45 circles centred on the
// left (x=0) and right (x=120) edges, vertically inside the box. The circles
// never touch each other (230 apart, radii 45+45=90).
const BOX = { x0: 0, y0: 0, x1: 120, y1: 220 };
const R = 45, CY = 110;

console.log('\n== intersect: two disjoint circles + box (box = tool last) ==');
{
  const world = makeWorld();
  const api = build(world);
  const cl = circleEnt(world, BOX.x0, CY, R);
  const cr = circleEnt(world, BOX.x1, CY, R);
  const box = rectEnts(world, BOX.x0, BOX.y0, BOX.x1, BOX.y1);
  // tool (box) selected LAST — intersect takes the last selected loop as tool
  world.ui.selection = [{ kind: 'entity', id: cl }, { kind: 'entity', id: cr },
    ...box.map(id => ({ kind: 'entity', id }))];
  api.cmdBoolean('intersect');
  const made = Object.values(world.state.entities);
  check('result is non-empty (was empty before the fix)', made.length > 0, made.length);
  check('no Clipper fallback happened', !/Clipper/.test(world.toasts.join(' ')), world.toasts.join(' | '));
  const area = loopArea(world);
  // each circle cuts a circular segment into the box: half-disc area
  // (the chord is the box edge x=0 / x=120, the circle centre sits on it,
  // so the inside-box part of each circle is exactly a half disc = πr²/2)
  const want = 2 * (Math.PI * R * R / 2);
  check('area = both half-discs inside the box', Math.abs(area - want) < 0.5,
    area.toFixed(4) + ' vs ' + want.toFixed(4));
  check('result came back as exact arcs on the true circles',
    made.filter(e => e.type === 'arc').length === 2 && made.filter(e => e.type === 'arc').every(e => {
      const ad = world.arcData(e);
      return Math.abs(ad.r - R) < 1e-9 &&
        (Math.abs(ad.c.x - BOX.x0) < 1e-9 || Math.abs(ad.c.x - BOX.x1) < 1e-9) &&
        Math.abs(ad.c.y - CY) < 1e-9;
    }),
    made.map(e => e.type).join(','));
}

console.log('\n== intersect: single overlapping target still works ==');
{
  const world = makeWorld();
  const api = build(world);
  const a = circleEnt(world, 0, 0, 50);
  const b = circleEnt(world, 60, 0, 50);
  // tool last = b; overlap lens area
  world.ui.selection = [{ kind: 'entity', id: a }, { kind: 'entity', id: b }];
  api.cmdBoolean('intersect');
  const made = Object.values(world.state.entities);
  check('lens result exists', made.length > 0, made.length);
  const area = loopArea(world);
  const th = Math.acos(30 / 50);
  const lens = 2 * 2500 * (th - (40 / 50) * (30 / 50));
  check('lens area exact (single target unchanged)', Math.abs(area - lens) < 0.5,
    area.toFixed(4) + ' vs ' + lens.toFixed(4));
}

console.log('\n== intersect: disjoint targets that miss the tool -> empty ==');
{
  const world = makeWorld();
  const api = build(world);
  const cl = circleEnt(world, -200, CY, R);
  const cr = circleEnt(world, -320, CY, R);
  const box = rectEnts(world, BOX.x0, BOX.y0, BOX.x1, BOX.y1);
  world.ui.selection = [{ kind: 'entity', id: cl }, { kind: 'entity', id: cr },
    ...box.map(id => ({ kind: 'entity', id }))];
  api.cmdBoolean('intersect');
  const made = Object.values(world.state.entities);
  // circles miss the box entirely, so the intersect is empty. Nothing is
  // consumed — the toast says "leaves nothing" and every original survives.
  check('circles far from the box leave nothing (originals untouched)',
    made.length === 6 && /leaves nothing/.test(world.toasts.join(' ')),
    made.length + ' entities, toasts: ' + world.toasts.join(' | '));
}

console.log('\n' + (fail ? fail + ' FAILED, ' : '') + pass + ' passed');
process.exit(fail ? 1 : 0);
