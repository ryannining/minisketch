// Probe for the shared bake (chaining + winding hierarchy) and the offset that
// depends on it: triangle made of separate lines, circle inside it, and a third
// level inside the circle (luar / dalam / luar).
//
// Run: node testing/bake_probe.js
const fs = require('fs');
const path = require('path');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
// pure helpers moved to core.js; fall back to it when app.js no longer
// defines the function (keeps the probe working across that refactor)
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

const ClipperLib = require(path.join(__dirname, '..', 'tools', 'clipper.js'));
const names = ['rdpSimplify', 'signedAreaPts', 'pointInPoly', 'lineIntersect',
  'interiorProbe', 'normalizeWinding', 'chainPolylines', 'entityWorldPolylines',
  'bakeContours', 'offsetOpenChain', 'clipperLib', 'offsetClosedChains', 'offsetChains'];

// P has to read the fake state, so build the whole thing per-scenario.
function build(state) {
  return new Function(
    'P', 'dist', 'TAU', 'splineSamplesOf', 'circleData', 'arcData', 'sampleArc',
    'textContoursWorld', 'artContoursWorld', 'BAKE_JOIN_TOL', 'ClipperLib', 'toast',
    'colorOf',
    "const OFFSET_SCALE = 1000; const OFFSET_PRECISION = 0.001;" +
  "const OFFSET_MITER = 4, OFFSET_TOL = 0.05, SPLINE_SEG = 12, ARC_SEG = 72; " +
  "const CIRCLE_CHORD = 1.5, ART_TOL_MM = 0.1;" +
    "let OFFSET_JOIN = String.fromCharCode(115,104,97,114,112), OFFSET_ARC_TOL = 0.05;" + '\n' +
    names.map(sliceOrCore).join('\n') + '\nreturn {' + names.join(',') + ', BAKE_JOIN_TOL};'
  )(
    (id) => state.points[+id] || null,
    (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
    Math.PI * 2,
    () => [],
    (e) => {
      const c = state.points[+e.c];
      return c ? { c, r: e.r } : null;
    },
    () => null,
    () => [],
    () => [],
    () => [],
    0.1,
    ClipperLib,
    () => {},
    (e) => (e && e.color) || '#000000'
  );
}

// --- a sketch made of separate lines -------------------------------------
// A triangle drawn clockwise (y grows downwards on screen, so this is CW there),
// with every corner left open by 0.05 mm on purpose, plus a circle inside it.
function triangleAndCircle(gap) {
  const state = { points: {}, entities: {} };
  let pid = 0, eid = 0;
  const pt = (x, y) => { const id = ++pid; state.points[id] = { x, y }; return id; };
  const line = (a, b) => {
    const id = ++eid;
    state.entities[id] = { id, type: 'line', a, b, color: '#000000' };
    return id;
  };
  // clockwise triangle on screen: (0,0) -> (0,100) -> (100,0)
  const A = [0, 0], B = [0, 100], C = [100, 0];
  const v = [A, B, C];
  for (let i = 0; i < 3; i++) {
    const p = v[i], q = v[(i + 1) % 3];
    const a = pt(p[0], p[1]);
    const b = pt(q[0] + gap, q[1] + gap);       // leave the corner slightly open
    line(a, b);
  }
  const cid = ++eid;
  state.entities[cid] = { id: cid, type: 'circle', c: pt(25, 25), r: 8, color: '#000000' };
  return { state, eids: Object.keys(state.entities).map(Number) };
}

console.log('\n== chaining closes a hand-drawn shape ==');
{
  const { state, eids } = triangleAndCircle(0.05);
  const api2 = build(state);
  const baked = api2.bakeContours(eids.map(id => state.entities[id])).contours;
  check('the tolerance really is the bake tolerance', api2.BAKE_JOIN_TOL === 0.1, api2.BAKE_JOIN_TOL);
  check('3 loose lines + a circle bake into 2 contours', baked.length === 2, baked.length);
  const tri = baked.find(c => c.pts.length === 3);
  check('the triangle becomes one closed contour', !!tri && tri.closed === true,
    JSON.stringify(baked.map(c => [c.pts.length, c.closed])));
  check('its closing duplicate point is dropped', tri && tri.pts.length === 3, tri && tri.pts.length);
}

console.log('\n== winding and nesting depth (luar, dalam, luar) ==');
{
  const { state, eids } = triangleAndCircle(0.05);
  const api2 = build(state);
  const baked = api2.bakeContours(eids.map(id => state.entities[id])).contours;
  const tri = baked.find(c => c.pts.length === 3);
  const circ = baked.find(c => c.pts.length > 3);
  check('the triangle is depth 0', tri.depth === 0, tri.depth);
  check('the circle is depth 1', circ.depth === 1, circ.depth);
  check('the outer contour is wound positive', api2.signedAreaPts(tri.pts) > 0, api2.signedAreaPts(tri.pts));
  check('the hole is wound the opposite way', api2.signedAreaPts(circ.pts) < 0, api2.signedAreaPts(circ.pts));
}
{
  // third level: a small square inside the circle
  const { state, eids } = triangleAndCircle(0.05);
  let pid = 100, eid = 100;
  const pt = (x, y) => { const id = ++pid; state.points[id] = { x, y }; return id; };
  const sq = [[21, 21], [29, 21], [29, 29], [21, 29]];
  for (let i = 0; i < 4; i++) {
    const a = pt(sq[i][0], sq[i][1]);
    const b = pt(sq[(i + 1) % 4][0], sq[(i + 1) % 4][1]);
    const id = ++eid;
    state.entities[id] = { id, type: 'line', a, b, color: '#000000' };
    eids.push(id);
  }
  const api2 = build(state);
  const baked = api2.bakeContours(eids.map(id => state.entities[id])).contours;
  const byDepth = baked.map(c => c.depth).sort((x, y) => x - y);
  check('three levels of nesting', JSON.stringify(byDepth) === '[0,1,2]', JSON.stringify(byDepth));
  const island2 = baked.find(c => c.depth === 2);
  check('the second island is wound positive again', api2.signedAreaPts(island2.pts) > 0,
    api2.signedAreaPts(island2.pts));
}

console.log('\n== the input winding does not matter ==');
{
  const mk = (reverse) => {
    const state = { points: {}, entities: {} };
    let pid = 0, eid = 0;
    const pt = (x, y) => { const id = ++pid; state.points[id] = { x, y }; return id; };
    const v = reverse ? [[0, 0], [100, 0], [0, 100]] : [[0, 0], [0, 100], [100, 0]];
    for (let i = 0; i < 3; i++) {
      const p = v[i], q = v[(i + 1) % 3];
      const id = ++eid;
      state.entities[id] = { id, type: 'line', a: pt(p[0], p[1]), b: pt(q[0], q[1]), color: '#000000' };
    }
    return { state, eids: Object.keys(state.entities).map(Number) };
  };
  for (const reverse of [false, true]) {
    const { state, eids } = mk(reverse);
    const api2 = build(state);
    const baked = api2.bakeContours(eids.map(id => state.entities[id])).contours;
    check('one closed contour (' + (reverse ? 'ccw' : 'cw') + ' input)',
      baked.length === 1 && baked[0].closed, baked.length);
    check('always wound positive after baking (' + (reverse ? 'ccw' : 'cw') + ')',
      api2.signedAreaPts(baked[0].pts) > 0, api2.signedAreaPts(baked[0].pts));
  }
}

console.log('\n== offset follows the hierarchy: out, in, out ==');
{
  const d = 2;
  const { state, eids } = triangleAndCircle(0.05);
  const api2 = build(state);
  const baked = api2.bakeContours(eids.map(id => state.entities[id])).contours;
  const triBefore = baked.find(c => c.pts.length === 3);
  const circBefore = baked.find(c => c.pts.length > 3);
  const areaTriBefore = Math.abs(api2.signedAreaPts(triBefore.pts));
  const areaCircBefore = Math.abs(api2.signedAreaPts(circBefore.pts));
  const out = api2.offsetChains(baked, d, { tol: 0.05 });
  check('both contours survive', out.length === 2, out.length);
  const areaTriAfter = Math.abs(api2.signedAreaPts(out[0].pts));
  const areaCircAfter = Math.abs(api2.signedAreaPts(out[1].pts));
  check('the outer triangle grows', areaTriAfter > areaTriBefore, areaTriAfter + ' vs ' + areaTriBefore);
  check('the inner circle shrinks', areaCircAfter < areaCircBefore, areaCircAfter + ' vs ' + areaCircBefore);
}
{
  // and the same with a negative distance: the shape shrinks, the hole grows
  const { state, eids } = triangleAndCircle(0.05);
  const api2 = build(state);
  const baked = api2.bakeContours(eids.map(id => state.entities[id])).contours;
  const areaTriBefore = Math.abs(api2.signedAreaPts(api2.bakeContours(eids.map(id => state.entities[id])).contours.find(c => c.pts.length === 3).pts));
  const areaCircBefore = Math.abs(api2.signedAreaPts(api2.bakeContours(eids.map(id => state.entities[id])).contours.find(c => c.pts.length > 3).pts));
  const out = api2.offsetChains(baked, -1, { tol: 0.05 });
  check('still two contours', out.length === 2, out.length);
  check('the outer triangle shrinks', Math.abs(api2.signedAreaPts(out[0].pts)) < areaTriBefore);
  check('the hole grows', Math.abs(api2.signedAreaPts(out[1].pts)) > areaCircBefore);
}

console.log('\n== depth travels with the offset result ==');
{
  const { state, eids } = triangleAndCircle(0.05);
  const api2 = build(state);
  const baked = api2.bakeContours(eids.map(id => state.entities[id])).contours;
  const out = api2.offsetChains(baked, 1, { tol: 0.05 });
  check('the result keeps its depths', JSON.stringify(out.map(c => c.depth)) === '[0,1]',
    JSON.stringify(out.map(c => c.depth)));
  check('so a second offset keeps the same directions', (() => {
    const again = api2.offsetChains(out, 1, { tol: 0.05 });
    return Math.abs(api2.signedAreaPts(again[1].pts)) < Math.abs(api2.signedAreaPts(out[1].pts));
  })());
}

console.log('\n== open chains are not given a depth ==');
{
  const state = { points: {}, entities: {} };
  state.points[1] = { x: 0, y: 0 };
  state.points[2] = { x: 50, y: 0 };
  state.entities[1] = { id: 1, type: 'line', a: 1, b: 2, color: '#000000' };
  const api2 = build(state);
  const baked = api2.bakeContours([state.entities[1]]).contours;
  check('one open chain', baked.length === 1 && baked[0].closed === false);
  check('depth 0, no closure', baked[0].depth === 0, baked[0].depth);
}

console.log('\n== sharp corners leave no crossing lines ==');
{
  const selfIntersects = (pts) => {
    const n = pts.length;
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const hit = (p1, p2, p3, p4) => {
      const d1 = cross(p3, p4, p1);
      const d2 = cross(p3, p4, p2);
      const d3 = cross(p1, p2, p3);
      const d4 = cross(p1, p2, p4);
      return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
    };
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (j === i || j === (i + 1) % n || i === (j + 1) % n) continue;
        if (hit(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
      }
    }
    return false;
  };

  const state = { points: {}, entities: {} };
  const api3 = build(state);

  const shapes = {
    'acute triangle inset': [
      [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 8 }], -3
    ],
    'acute triangle outset': [
      [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 8 }], 3
    ],
    'pentagram': [
      [{ x: 50, y: 0 }, { x: 79, y: 90 }, { x: 0, y: 35 }, { x: 100, y: 35 }, { x: 21, y: 90 }], 3
    ],
    'sharp notch inset': [
      [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 20 }, { x: 50, y: 3 }, { x: 0, y: 20 }], -2
    ],
    'sharp notch outset': [
      [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 20 }, { x: 50, y: 3 }, { x: 0, y: 20 }], 2
    ]
  };

  for (const name of Object.keys(shapes)) {
    const [pts, d] = shapes[name];
    const out = api3.offsetChains([{ pts, closed: true }], d, { tol: 0.02, miterLimit: 4 });
    check(name + ': every contour is clean',
      out.every(c => !selfIntersects(c.pts)),
      JSON.stringify(out.map(c => c.pts.length)));
    if (d > 0) {
      check(name + ': the shape got bigger',
        out.length === 0 || Math.abs(api3.signedAreaPts(out[0].pts)) > Math.abs(api3.signedAreaPts(pts)),
        out.length && api3.signedAreaPts(out[0].pts));
    } else {
      check(name + ': the shape got smaller (or vanished)',
        out.length === 0 || Math.abs(api3.signedAreaPts(out[0].pts)) < Math.abs(api3.signedAreaPts(pts)));
    }
  }
}

console.log('\n' + (fail ? (fail + ' FAILED, ' + pass + ' passed') : ('all ' + pass + ' checks passed')));
process.exit(fail ? 1 : 0);
