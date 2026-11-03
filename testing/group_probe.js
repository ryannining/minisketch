// Probe for grouping (Ctrl+G): polyline chaining and open/closed contours.
//
// Run: node testing/group_probe.js
const fs = require('fs');
const path = require('path');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
// pure helpers moved to core.js; fall back to it when app.js no longer has them
const Core = require(path.join(__dirname, '..', 'core.js'));
const sliceOrCore = (name) => {
  try { return sliceApp(name); } catch (err) {
    if (typeof Core[name] === 'function') return Core[name].toString();
    throw err;
  }
};

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

function braceEnd(src, from) {
  let i = src.indexOf('{', from), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) return j + 1; }
  }
  throw new Error('unbalanced');
}
const sliceApp = (name) => {
  const start = appSrc.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('not found: ' + name);
  let i = appSrc.indexOf('(', start), depth = 0;
  for (; i < appSrc.length; i++) {
    if (appSrc[i] === '(') depth++;
    else if (appSrc[i] === ')') { depth--; if (!depth) break; }
  }
  return appSrc.slice(start, braceEnd(appSrc, i));
};

const P = (p) => p;
const TAU = Math.PI * 2;
const artContourCache = new Map();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const build = (extra) => new Function(
  'P', 'TAU', 'clamp', 'dist', 'state', 'colorOf', 'privatePoint', 'newId', 'textGeom',
  'rdpSimplify', 'ART_TOL_MM', 'artContourCache',
  sliceOrCore('artClosedFlags') + '\n' +
  sliceOrCore('artContoursWorld') + '\n' +
  sliceOrCore('artNotesToEntities') + '\n' +
  sliceOrCore('artCurveSource') + '\n' +
  sliceOrCore('artToLines') + '\n' +
  sliceOrCore('chainPolylines') + '\n' +
  "const CONSTRUCTION_COLOR = '#00ff00';" + '\n' +
  sliceOrCore('isConstructionColor') + '\n' +
  sliceOrCore('groupableEntities') + '\n' +
  'return { artClosedFlags, artContoursWorld, artToLines, chainPolylines, isConstructionColor, groupableEntities };'
)(
  P, TAU, clamp, dist,
  extra.state, extra.colorOf, extra.privatePoint, extra.newId, extra.textGeom,
  (pts) => pts,        // identity simplification: keep the geometry exact
  0.1,
  artContourCache
);

// a 100 x 50 frame, height pointing down
const ggOf = () => ({ p0: { x: 0, y: 0 }, A: { x: 100, y: 0 }, B: { x: 0, y: -50 }, w: 100, h: 50 });

console.log('\n== chaining polylines ==');
{
  const api = build({ state: { points: {}, entities: {} }, colorOf: () => '#000000', privatePoint: () => 1, newId: () => 1, textGeom: ggOf });
  const seg = (x1, y1, x2, y2) => ({ pts: [{ x: x1, y: y1 }, { x: x2, y: y2 }], closed: false });
  let out = api.chainPolylines([seg(0, 0, 10, 0), seg(10, 0, 10, 10)], 1e-3);
  check('two touching segments become one chain', out.length === 1 && out[0].pts.length === 3,
    JSON.stringify(out.map(o => o.pts.length)));
  check('a chain that does not close stays open', out[0].closed === false);

  out = api.chainPolylines([seg(0, 0, 10, 0), seg(10, 0, 10, 10), seg(10, 10, 0, 0)], 1e-3);
  check('a triangle closes', out.length === 1 && out[0].closed === true, JSON.stringify(out.length));
  check('the closing duplicate point is dropped', out[0].pts.length === 3, out[0].pts.length);

  out = api.chainPolylines([seg(0, 0, 10, 0), seg(0, 0, 0, 10)], 1e-3);
  check('a join at the head also works', out.length === 1 && out[0].pts.length === 3, JSON.stringify(out[0]));

  out = api.chainPolylines([seg(0, 0, 10, 0), seg(10, 0, 0, 0)], 1e-3);
  check('back-and-forth collapses to a 2-point chain', out.length === 1 && out[0].closed === false,
    JSON.stringify(out[0]));

  out = api.chainPolylines([seg(0, 0, 10, 0), seg(50, 50, 60, 50)], 1e-3);
  check('separated segments stay separate', out.length === 2, out.length);

  out = api.chainPolylines([seg(0, 0, 10, 0), seg(10.0005, 0, 20, 0)], 1e-3);
  check('within tolerance still joins', out.length === 1, out.length);
  out = api.chainPolylines([seg(0, 0, 10, 0), seg(10.5, 0, 20, 0)], 1e-3);
  check('beyond tolerance does not join', out.length === 2, out.length);

  out = api.chainPolylines([seg(10, 0, 0, 0), seg(10, 0, 10, 10)], 1e-3);
  check('reversed segments are stitched in order', out.length === 1 && out[0].pts.length === 3,
    JSON.stringify(out[0].pts));
}

console.log('\n== closed flags ==');
{
  const api = build({ state: { points: {}, entities: {} }, colorOf: () => '#000000', privatePoint: () => 1, newId: () => 1, textGeom: ggOf });
  check('no flag array means everything is closed',
    JSON.stringify(api.artClosedFlags({ contours: [[[0, 0], [1, 0], [1, 1]]] })) === '[true]');
  check('flags are honoured',
    JSON.stringify(api.artClosedFlags({ contours: [[1], [2]], closed: [false, true] })) === '[false,true]');
  check('a short flag array pads with closed',
    JSON.stringify(api.artClosedFlags({ contours: [[1], [2]], closed: [false] })) === '[false,true]');
}

console.log('\n== artContoursWorld keeps open chains open ==');
{
  const state = { points: {}, entities: {} };
  const api = build({ state, colorOf: () => '#000000', privatePoint: () => 1, newId: () => 1, textGeom: ggOf });
  const e = {
    id: 1, type: 'art',
    contours: [
      [[0, 0], [1, 0], [1, 1]],          // closed
      [[0.2, 0.2], [0.4, 0.2], [0.4, 0.6]] // open
    ],
    closed: [true, false]
  };
  const loops = api.artContoursWorld(e);
  check('both contours come out', loops.length === 2, loops.length);
  check('the first is marked closed', loops[0].closed === true);
  check('the second is marked open', loops[1].closed === false);
  check('an open chain keeps exactly its own points', loops[1].pts.length === 3, loops[1].pts.length);
  check('world coordinates follow the frame',
    loops[0].pts[1].x === 100 && loops[0].pts[1].y === 0, JSON.stringify(loops[0].pts[1]));
  check('height runs downward', loops[0].pts[2].y === -50, JSON.stringify(loops[0].pts[2]));
}

console.log('\n== artToLines: segments per contour ==');
{
  let pid = 0, eid = 100;
  const state = { points: {}, entities: {} };
  const api = build({
    state,
    colorOf: () => '#000000',
    privatePoint: (x, y) => { const id = ++pid; state.points[id] = { x, y }; return id; },
    newId: () => ++eid,
    textGeom: ggOf
  });
  let e = { id: 1, type: 'art', contours: [[[0, 0], [1, 0], [1, 1], [0, 1]]], closed: [true] };
  state.entities[1] = e;
  let ids = api.artToLines(1);
  check('a closed square becomes 4 lines', ids.length === 4, ids.length);

  pid = 0; eid = 100;
  state.points = {}; state.entities = { 1: {} };
  e = { id: 1, type: 'art', contours: [[[0, 0], [1, 0], [1, 1]]], closed: [false] };
  state.entities[1] = e;
  ids = api.artToLines(1);
  check('an open 3-point chain becomes 2 lines', ids.length === 2, ids.length);
  check('the two lines share their middle point', (() => {
    const ents = ids.map(id => state.entities[id]);
    const a = ents[0];
    const b = ents[1];
    return a.b === b.a;
  })(), JSON.stringify(ids.map(id => [state.entities[id].a, state.entities[id].b])));
}

console.log('\n== green construction lines are left out ==');
{
  const api = build({
    state: { points: {}, entities: {} },
    colorOf: (e) => (e && e.color) || '#000000',
    privatePoint: () => 1,
    newId: () => 1,
    textGeom: ggOf
  });
  check('#00ff00 is construction', api.isConstructionColor('#00ff00') === true);
  check('case does not matter', api.isConstructionColor('#00FF00') === true);
  check('surrounding spaces do not matter', api.isConstructionColor(' #00ff00 ') === true);
  check('black is real geometry', api.isConstructionColor('#000000') === false);
  check('a missing colour is real geometry', api.isConstructionColor(undefined) === false);

  const a = { id: 1, type: 'line', color: '#000000' };
  const g1 = { id: 2, type: 'line', color: '#00ff00' };
  const g2 = { id: 3, type: 'line', color: '#00FF00' };
  const b = { id: 4, type: 'line', color: '#0000ff' };
  const r = api.groupableEntities([a, g1, b, g2]);
  check('the real shapes are kept', r.kept.length === 2 && r.kept[0] === a && r.kept[1] === b,
    JSON.stringify(r.kept.map(e => e.id)));
  check('the construction lines are counted', r.skipped === 2, r.skipped);
  const onlyGreen = api.groupableEntities([g1, g2]);
  check('a selection of only green leaves nothing to group', onlyGreen.kept.length === 0 && onlyGreen.skipped === 2);
  check('an empty selection is fine', api.groupableEntities([]).kept.length === 0);
}

console.log('\n== grouping normalisation round-trips ==');
{
  // frame from a bbox, then normalise and back: the group must not move geometry
  const minX = 12, maxY = 30, w = 40, h = 20;
  const world = [{ x: 12, y: 30 }, { x: 52, y: 30 }, { x: 52, y: 10 }];
  const contours = world.map(p => [(p.x - minX) / w, (maxY - p.y) / h]);
  const back = contours.map(([u, v]) => ({ x: minX + u * w, y: maxY - v * h }));
  check('normalised corners map back exactly',
    back.every((p, i) => Math.abs(p.x - world[i].x) < 1e-9 && Math.abs(p.y - world[i].y) < 1e-9),
    JSON.stringify(back));
  check('top-left is 0,0 and bottom-right is 1,1',
    Math.abs(contours[0][0]) < 1e-9 && Math.abs(contours[0][1]) < 1e-9 &&
    Math.abs(contours[1][0] - 1) < 1e-9 && Math.abs(contours[2][1] - 1) < 1e-9,
    JSON.stringify(contours));
}

console.log('\n' + (fail ? (fail + ' FAILED, ' + pass + ' passed') : ('all ' + pass + ' checks passed')));
process.exit(fail ? 1 : 0);
