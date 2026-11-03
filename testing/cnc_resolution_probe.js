// Check that the SAME shape reaches KaryaCNC with the same resolution no matter
// how it is stored: circle entity, Ctrl+K curve of it, Ctrl+G group of it.
//
// Run: node testing/cnc_resolution_probe.js
const fs = require('fs');
const path = require('path');
const C = require(path.join(__dirname, '..', 'core.js'));

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
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

const TAU = Math.PI * 2;
const R = 3;                       // the Ø6 circle from the report

// a circle as 4 cubic spans, exactly what Ctrl+K leaves behind
function circleCurve(r) {
  const k = 0.5522847498 * r;
  return {
    nodes: [
      { x: r, y: 0, o: { x: r, y: k }, i: { x: r, y: -k } },
      { x: 0, y: r, o: { x: -k, y: r }, i: { x: k, y: r } },
      { x: -r, y: 0, o: { x: -r, y: -k }, i: { x: -r, y: k } },
      { x: 0, y: -r, o: { x: k, y: -r }, i: { x: -k, y: -r } }
    ],
    closed: true
  };
}

// textGeom as app.js has it (sliced, so the probe and the app agree)
const textGeomFactory = new Function('P', slice('textGeom') + '\nreturn textGeom;');

function build(tol) {
  const state = { points: {}, entities: {}, constraints: {}, layers: [{ id: 1, name: 'L', visible: true }], nextId: 1 };
  const api = new Function(
    'state', 'ui', 'settings', 'P', 'TAU', 'clamp', 'cnc',
    'circleData', 'arcData', 'arcCubicNodes', 'flattenSpline', 'ensureSplineHandles',
    'entityPointIds', 'colorOf', 'artCurveSource', 'artContoursWorld', 'textOutlineWorld',
    'isConstructionColor', 'svgEntityAllowed', 'layerVisible', 'layerOf',
    'cncCleanPts', 'cncChains', 'cncShapesOf', 'selectedEntities',
    'cncColorStroke', 'cncFlattenCurveSub', 'cncFramedCurveShapes',
    slice('cncArcSpan') + '\n' +
    slice('textGeom') + '\n' +
    slice('artCurveSource') + '\n' +
    slice('cncPolyline') + '\n' +
    slice('cncFlattenCurveSub') + '\n' +
    slice('cncFramedCurveShapes') + '\n' +
    slice('cncCollectItems') +
    '\nreturn { cncPolyline, cncCollectItems };'
  )(
    state, { activeLayer: 1, selection: [] }, {}, (id) => state.points[id], TAU,
    (v, a, b) => Math.min(b, Math.max(a, v)), { tol, scope: 'visible', chain: false },
    (e) => ({ c: state.points[e.c], r: e.r }),
    (e) => {
      const c = state.points[e.c], s = state.points[e.s], en = state.points[e.e];
      if (!c || !s || !en) return null;
      const a0 = Math.atan2(s.y - c.y, s.x - c.x);
      const a1 = Math.atan2(en.y - c.y, en.x - c.x);
      let sweep = a1 - a0;
      while (sweep <= 0) sweep += TAU;
      return { c, r: Math.hypot(s.x - c.x, s.y - c.y), a0, sweep };
    },
    C.arcCubicNodes, C.flattenSpline,
    (e) => { if (!e.hs) e.hs = { o: [], i: [] }; return e.hs; },
    (e) => (e.type === 'spline' ? (e.pts || []) : e.type === 'circle' ? [e.c] : []),
    (e) => (e && e.color) || '#000000',
    undefined,                        // artCurveSource (sliced from app.js)
    // artContoursWorld: map the stored contours through the frame
    (e) => {
      const gg = textGeomFactory((id) => state.points[id])(e);
      if (!gg) return [];
      return (e.contours || []).map(loop => ({
        pts: loop.map(([u, v]) => ({
          x: gg.p0.x + u * gg.A.x + v * gg.B.x,
          y: gg.p0.y + u * gg.A.y + v * gg.B.y
        })),
        closed: true
      }));
    },
    () => ({ loops: [], closed: true }),
    (c) => String(c || '').toLowerCase() === '#00ff00',
    () => true, () => true, () => 1,
    (pts) => pts.slice(),
    (list) => list,
    () => [],
    () => [],
    (c) => String(c || '').toLowerCase() || '#000000',
    undefined, undefined
  );
  return { api, state };
}

function addCircle(state, cx, cy, r) {
  const id = state.nextId++;
  const pid = state.nextId++;
  state.points[pid] = { id: pid, x: cx, y: cy };
  state.entities[id] = { id, type: 'circle', c: pid, r, color: '#000000', layer: 1 };
  return id;
}
function addCurve(state, cx, cy, r) {
  const cv = circleCurve(r);
  const id = state.nextId++;
  const pts = [];
  for (const n of cv.nodes) {
    const pid = state.nextId++;
    state.points[pid] = { id: pid, x: cx + n.x, y: cy + n.y };
    pts.push(pid);
  }
  state.entities[id] = {
    id, type: 'spline', pts, closed: true, color: '#000000', layer: 1,
    hs: { o: cv.nodes.map(n => ({ x: cx + n.o.x, y: cy + n.o.y })),
      i: cv.nodes.map(n => ({ x: cx + n.i.x, y: cy + n.i.y })) }
  };
  return id;
}

const TOL = 0.05;
const { api, state } = build(TOL);

console.log('\n== one Ø6 circle, three ways to store it ==');
const cid = addCircle(state, 0, 0, R);
const sid = addCurve(state, 20, 0, R);

const pc = api.cncPolyline(state.entities[cid]);
const ps = api.cncPolyline(state.entities[sid]);
check('the circle flattens', !!pc && pc.pts.length > 8, pc && pc.pts.length);
check('the curve flattens', !!ps && ps.pts.length > 8, ps && ps.pts.length);
check('both are closed', pc.closed && ps.closed);
check('the same point count for circle and curve', pc.pts.length === ps.pts.length,
  pc.pts.length + ' vs ' + ps.pts.length);

const devOf = (poly, cx, cy) => {
  let worst = 0;
  for (const [x, y] of poly.pts) worst = Math.max(worst, Math.abs(Math.hypot(x - cx, y - cy) - R));
  return worst;
};
check('the circle stays within the flatten tolerance', devOf(pc, 0, 0) <= TOL * 1.5, devOf(pc, 0, 0).toFixed(4));
check('the curve stays within the flatten tolerance', devOf(ps, 20, 0) <= TOL * 1.5, devOf(ps, 20, 0).toFixed(4));

console.log('\n== a group of that circle is sent from its curve data ==');
{
  // what Ctrl+G stores: contours normalised in the frame + the curve source
  const cv = circleCurve(R);
  const gid = state.nextId++;
  const p0 = state.nextId++, pw = state.nextId++, ph = state.nextId++;
  state.points[p0] = { id: p0, x: 40, y: R };
  state.points[pw] = { id: pw, x: 40 + 2 * R, y: R };
  state.points[ph] = { id: ph, x: 40, y: -R };
  state.entities[gid] = {
    id: gid, type: 'art', p0, pw, ph, guide: [], color: '#000000', layer: 1,
    ratio: 1,
    // the stored contours are pre-simplified: a coarse polygon
    contours: [Array.from({ length: 8 }, (_, i) => {
      const a = TAU * i / 8;
      return [(1 + Math.cos(a)) / 2, (1 - Math.sin(a)) / 2];
    })],
    closed: [true],
    curveSrc: [{
      closed: true, curved: true, c: '#000000', f: null,
      n: cv.nodes.map(n => ({
        p: [(n.x + R) / (2 * R), (R - n.y) / (2 * R)],
        o: [(n.o.x + R) / (2 * R), (R - n.o.y) / (2 * R)],
        i: [(n.i.x + R) / (2 * R), (R - n.i.y) / (2 * R)]
      }))
    }]
  };
  const items = api.cncCollectItems().filter(it => it.pts.length > 2);
  const group = items.find(it => it.pts.some(p => p[0] > 35));
  check('the group reached the machine', !!group);
  check('it used its curve data, not the 8-gon contour', group && group.pts.length > 12,
    group && group.pts.length);
  check('and at the same resolution as the circle', group && group.pts.length === pc.pts.length,
    group && group.pts.length + ' vs ' + pc.pts.length);
}

console.log('\n== green guide lines never reach the machine ==');
{
  const s2 = build(TOL);
  const gid2 = s2.state.nextId++;
  const gp = s2.state.nextId++, gp2 = s2.state.nextId++;
  s2.state.points[gp] = { id: gp, x: 0, y: 0 };
  s2.state.points[gp2] = { id: gp2, x: 10, y: 0 };
  // a guide owned by a framed object
  s2.state.entities[gid2] = {
    id: gid2, type: 'line', a: gp, b: gp2, color: '#00ff00', layer: 1
  };
  const owner = s2.state.nextId++;
  const op0 = s2.state.nextId++, opw = s2.state.nextId++, oph = s2.state.nextId++;
  s2.state.points[op0] = { id: op0, x: 0, y: 10 };
  s2.state.points[opw] = { id: opw, x: 10, y: 10 };
  s2.state.points[oph] = { id: oph, x: 0, y: 0 };
  s2.state.entities[owner] = {
    id: owner, type: 'art', p0: op0, pw: opw, ph: oph, guide: [gid2],
    color: '#000000', layer: 1,
    contours: [[[0, 0], [1, 0], [1, 1], [0, 1]]], closed: [true], ratio: 1
  };
  const items = s2.api.cncCollectItems();
  check('the green guide is not in the payload',
    !items.some(it => it.pts.some(p => p[0] === 0 && p[1] === 0) && it.pts.length === 2),
    items.length);
  // the art object's own square contour must be there (it has no curve data)
  check('the object itself is', items.length === 1, items.length + ' items');
}

console.log('\n' + (fail ? fail + ' FAILED, ' : 'all ') + pass + ' checks passed');
process.exit(fail ? 1 : 0);
