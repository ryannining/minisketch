// Probe: an array must reach the machine with the same geometry quality as its
// master.
//
// Reported symptom: a Ø100 circle arrayed 2x2 came out SMOOTHER in KaryaCNC
// than the original. Cause: the CNC path converted a circle with the flatten
// tolerance (50 points), but an array clone was taken from the on-screen
// snapshot, which follows the RENDER chord (a fixed 1.5 mm, 210 points).
//
// Run: node testing/cnc_array_probe.js
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

const TAU = Math.PI * 2;
const CIRCLE_CHORD = 1.5;     // Settings > Curves > Circle chord (render only)
const CNC_TOL = 0.05;         // Settings > CNC > Flatten tolerance

function makeWorld() {
  const w = {
    state: {
      points: {}, entities: {}, constraints: {}, 
      layers: [{ id: 1, name: 'Layer 1', visible: true, locked: false }],
      nextId: 100
    },
    ui: { selection: [], activeLayer: 1 },
    cnc: { tol: CNC_TOL, scope: 'visible', skippedText: 0, images: [] },
    toasts: []
  };
  w.newId = () => ++w.state.nextId;
  w.P = (id) => w.state.points[+id] || null;
  w.privatePoint = (x, y) => { const id = w.newId(); w.state.points[id] = { x, y }; return id; };
  w.toast = (m) => w.toasts.push(String(m));
  w.colorOf = (e) => (e && e.color) || '#000000';
  w.cncColorStroke = (c) => c || '#000000';
  w.svgEntityAllowed = () => true;
  w.layerVisible = () => true;
  w.entityEditable = () => true;
  w.circleData = (e) => {
    const c = w.P(e.c);
    return c && e.r > 0 ? { c, r: e.r } : null;
  };
  w.arcData = () => null;
  w.entityPointIds = (e) => {
    if (!e) return [];
    if (e.type === 'circle') return [e.c];
    if (e.type === 'line') return [e.a, e.b];
    if (e.type === 'spline') return e.pts || [];
    return [];
  };
  w.entityWorldPolylines = (e) => {
    // the RENDER tessellation: fixed chord, ignores the CNC tolerance
    if (e.type === 'circle') {
      const cd = w.circleData(e);
      if (!cd) return [];
      const n = Math.max(12, Math.min(720, Math.ceil(TAU * cd.r / CIRCLE_CHORD)));
      const pts = [];
      for (let i = 0; i < n; i++) {
        const a = TAU * i / n;
        pts.push({ x: cd.c.x + Math.cos(a) * cd.r, y: cd.c.y + Math.sin(a) * cd.r });
      }
      return [{ pts, closed: true }];
    }
    if (e.type === 'line') {
      const a = w.P(e.a), b = w.P(e.b);
      return a && b ? [{ pts: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }], closed: false }] : [];
    }
    return [];
  };
  w.splineSamplesOf = () => [];
  w.artContoursWorld = () => [];
  w.textContoursWorld = () => [];
  w.arrayXformPoint = (t, x, y) => {
    if (t.ang != null) {
      const cos = Math.cos(t.ang), sin = Math.sin(t.ang);
      const ux = x - t.cx, uy = y - t.cy;
      return { x: t.cx + ux * cos - uy * sin, y: t.cy + ux * sin + uy * cos };
    }
    return { x: x + (t.dx || 0), y: y + (t.dy || 0) };
  };
  w.arrayInstanceOffsets = (e) => {
    const out = [];
    const p = e.params || {};
    const rows = Math.max(1, Math.floor(+p.rows || 1));
    const cols = Math.max(1, Math.floor(+p.cols || 1));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (r === 0 && c === 0) continue;
        out.push({ dx: c * (+p.dx || 0), dy: r * (+p.dy || 0) });
      }
    }
    return out;
  };
  w.selectedEntities = () => [];
  return w;
}

function build(w) {
  // cnc.tol is a plain object property here, so the module-level `cnc` the
  // sliced functions read has to be the same object
  const body = [
    slice('cncArcSpan'),
    slice('cncPolyline'),
    slice('cncFlattenCurveSub'),
    slice('cncFramedCurveShapes'),
    slice('cncCleanPts'),
    slice('cncShapesOf'),
    slice('cncCollectItems')
  ].join('\n');
  return new Function(
    'state', 'ui', 'cnc', 'cncColorStroke', 'svgEntityAllowed', 'selectedEntities',
    'P', 'colorOf', 'circleData', 'arcData', 'entityPointIds', 'splineSamplesOf',
    'artContoursWorld', 'textContoursWorld', 'arrayXformPoint', 'arrayInstanceOffsets',
    'TAU', 'clamp', 'cncChains',
    'arcCubicNodes', 'flattenSpline', 'ensureSplineHandles', 'textOutlineWorld',
    'isConstructionColor', 'artCurveSource',
    body + '\nreturn { cncCollectItems, cncShapesOf, cncPolyline };'
  )(
    w.state, w.ui, w.cnc, w.cncColorStroke, w.svgEntityAllowed, w.selectedEntities,
    w.P, w.colorOf, w.circleData, w.arcData, w.entityPointIds, w.splineSamplesOf,
    w.artContoursWorld, w.textContoursWorld, w.arrayXformPoint, w.arrayInstanceOffsets,
    TAU, (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
    // the probe only cares about the raw list, so chaining is a passthrough
    (list) => list,
    C.arcCubicNodes, C.flattenSpline,
    (e) => { if (!e.hs) e.hs = { o: [], i: [] }; return e.hs; },
    (e) => ({ loops: [], closed: true }),
    (c) => String(c || '').toLowerCase() === '#00ff00',
    () => null
  );
}

// a Ø100 circle, plus a 2x2 grid array of that same circle
function scene(w) {
  const c = w.privatePoint(0, 0);
  const cid = w.newId();
  w.state.entities[cid] = { id: cid, type: 'circle', c, r: 50, color: '#000000', layer: 1 };

  const c2 = w.privatePoint(500, 0);
  const cid2 = w.newId();
  w.state.entities[cid2] = { id: cid2, type: 'circle', c: c2, r: 50, color: '#000000', layer: 1 };

  const aid = w.newId();
  w.state.entities[aid] = {
    id: aid, type: 'array', kind: 'grid',
    params: { rows: 2, cols: 2, dx: 200, dy: -200 },
    masters: [cid2], color: '#000000', layer: 1
  };
  return { cid, cid2, aid };
}

console.log('\n== one circle, one arrayed copy of the same circle ==');
{
  const w = makeWorld();
  const api = build(w);
  const { cid, cid2, aid } = scene(w);
  const items = api.cncCollectItems();

  // the scene has a standalone circle at the origin plus an array of a second
  // one: the array's master is an object of its own AND draws three more
  // instances, so five r=50 circles reach the machine
  const circles = items.filter(it => it.closed && it.pts.length > 3);
  check('five r=50 circles reach the machine (plain + master + 3 clones)',
    circles.length === 5, circles.length);

  // what the same circle costs on its own, straight from the CNC converter
  const masterPoly = api.cncPolyline(w.state.entities[cid]);
  const nMaster = masterPoly.pts.length;
  const counts = [...new Set(circles.map(c => c.pts.length))];
  check('every one of them has the master\'s point count (' + nMaster + ')',
    counts.length === 1 && counts[0] === nMaster, counts.join('/') + ' vs ' + nMaster);

  const renderN = Math.ceil(TAU * 50 / CIRCLE_CHORD);
  check('which is the flatten tolerance, not the denser render chord (' + renderN + ')',
    nMaster <= renderN, nMaster + ' vs ' + renderN);

  // each circle really is r=50 around its OWN centre
  for (const it of circles) {
    const body = it.pts.slice(0, -1);
    const cx = body.reduce((a, p) => a + p[0], 0) / body.length;
    const cy = body.reduce((a, p) => a + p[1], 0) / body.length;
    const err = Math.max(...body.map(p => Math.abs(Math.hypot(p[0] - cx, p[1] - cy) - 50)));
    // a polyline around a circle is a chord approximation, so the vertices sit
    // on the circle and the mid-chord is inside it: the bound is the flatten
    // tolerance of that circle, not machine epsilon
    check('the circle at (' + Math.round(cx) + ',' + Math.round(cy) + ') stays within the flatten tolerance',
      err <= w.cnc.tol, err);
  }
  check('each sits at its own grid position',
    new Set(circles.map(it => {
      const body = it.pts.slice(0, -1);
      return Math.round(body.reduce((a, p) => a + p[0], 0) / body.length) + ':' +
        Math.round(body.reduce((a, p) => a + p[1], 0) / body.length);
    })).size === 5);
}

console.log('\n== the flatten tolerance is the single knob ==');
{
  for (const tol of [0.02, 0.05, 0.2]) {
    const w = makeWorld();
    w.cnc.tol = tol;
    const api = build(w);
    scene(w);
    const items = api.cncCollectItems();
    const counts = [...new Set(items.map(it => it.pts.length))];
    check('tol ' + tol + ' mm: every contour in the payload has one point count (' +
      counts.join('/') + ')', counts.length === 1, counts.join('/'));
  }
}

console.log('\n== a line array still chains, a group array keeps its colours ==');
{
  const w = makeWorld();
  const api = build(w);
  // a 4-line square as one array master set
  const ids = [];
  const pts = [[0, 0], [40, 0], [40, 40], [0, 40]];
  const pids = pts.map(p => w.privatePoint(p[0], p[1]));
  for (let i = 0; i < 4; i++) {
    const id = w.newId();
    w.state.entities[id] = {
      id, type: 'line', a: pids[i], b: pids[(i + 1) % 4], color: '#ff0000', layer: 1
    };
    ids.push(id);
  }
  const aid = w.newId();
  w.state.entities[aid] = {
    id: aid, type: 'array', kind: 'grid', params: { rows: 2, cols: 2, dx: 100, dy: -100 },
    masters: ids, color: '#000000', layer: 1
  };
  const items = api.cncCollectItems();
  // the four master lines are objects of their own AND the array draws three
  // more instances of them: 4 + 12
  check('every line reaches the machine (master + 3 clones)', items.length === 16, items.length);
  check('the master colour is kept', items.every(it => it.color === '#ff0000'),
    [...new Set(items.map(it => it.color))].join(','));
  check('they stay open (the chaining step joins them)', items.every(it => !it.closed));
  const moved = items.filter(it => Math.abs(it.pts[0][0] - 100) < 1e-6);
  check('one instance sits exactly one dx away', moved.length === 4, moved.length);
}

console.log('\n' + (fail ? fail + ' FAILED, ' : 'all ') + pass + ' checks passed');
process.exit(fail ? 1 : 0);
