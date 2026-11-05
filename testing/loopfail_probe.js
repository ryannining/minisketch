// Probe: why does loopfail.sketch not close into one loop?
// Runs the real getLoops() slice from app.js over the file's entities, with
// instrumentation on the edge graph.
// Run: node testing/loopfail_probe.js
const fs = require('fs');
const path = require('path');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const C = require(path.join(__dirname, '..', 'core.js'));

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

const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'loopfail.sketch'), 'utf8'));
const s = doc.state;

const state = {
  points: {}, entities: {}, constraints: {}, namedSel: {},
  layers: s.layers || [{ id: 1, name: 'L1', visible: true, locked: false }],
  nextId: s.nextId || 1
};
for (const id in s.points) state.points[+id] = { x: s.points[id][0], y: s.points[id][1] };
for (const id in s.entities) {
  const e = s.entities[id];
  if (e.type === 'line') state.entities[+id] = { ...e, type: 'line', a: +e.a, b: +e.b };
  else state.entities[+id] = { ...e, pts: (e.pts || []).map(Number) };
}

let dbg = null;
const probeDbg = (d) => { dbg = d; };
const getLoopsFn = new Function(
  'loopsDeferred', 'loopCache', 'probeDbg', 'state', 'ui', 'P', 'JOIN_TOL', 'layerOf',
  'entityPointIds', 'ensureSplineHandles', 'splineSamples', 'splineSamplesOf', 'TAU',
  slice('getLoops').replace('loopCache = loops;',
    'if (typeof probeDbg === "function") probeDbg({ edges, adj, parent });\n    loopCache = loops;') +
  '\nreturn getLoops;'
)(
  false, null, probeDbg, state, { focusLoop: null },
  (id) => state.points[+id] || null,
  0.1,
  (e) => (e && e.layer) || ((state.layers[0] || {}).id) || 1,
  (e) => {
    if (!e) return [];
    if (e.type === 'line') return [e.a, e.b];
    if (e.type === 'spline') return e.pts || [];
    if (e.type === 'circle') return [e.c];
    if (e.type === 'arc') return [e.s, e.e];
    return [];
  },
  () => {},
  C.splineSamples,
  new Function('splineSampleCache', 'ensureSplineHandles', 'entityPointIds', 'P', 'splineSamples',
    slice('splineSamplesOf') + '\nreturn splineSamplesOf;')(
    new Map(), () => {},
    (e) => {
      if (!e) return [];
      if (e.type === 'line') return [e.a, e.b];
      if (e.type === 'spline') return e.pts || [];
      if (e.type === 'circle') return [e.c];
      return [];
    },
    (id) => state.points[+id] || null,
    C.splineSamples),
  Math.PI * 2
);

const loops = getLoopsFn();
console.log('loops found:', loops.length);
for (const l of loops) {
  console.log('  area=' + (l.area || 0).toFixed(3),
    'poly=' + (l.poly ? l.poly.length : 0),
    'steps=' + (l.steps ? l.steps.length : 0),
    'splineEntity=' + (l.splineEntity != null ? l.splineEntity : '-'),
    'circle=' + !!l.circle);
}

if (dbg) {
  console.log('\nedges:', Object.keys(dbg.edges).length);
  for (const k in dbg.edges) {
    const e = dbg.edges[k];
    console.log('  edge', k, 'entity', e.entity, 'nodes', e.aNode, '<->', e.bNode,
      'pts', e.pa, e.pb);
  }
  console.log('union-find roots:');
  const roots = {};
  for (const k in dbg.parent) roots[k] = dbg.parent[k];
  console.log(roots);
  console.log('adjacency sizes:', Object.entries(dbg.adj).map(([k, v]) => k + ':' + v.length).join(' '));
}

for (const id in state.entities) {
  const e = state.entities[id];
  if (e.type !== 'spline') continue;
  const a = state.points[e.pts[0]], b = state.points[e.pts[e.pts.length - 1]];
  console.log('\nspline ' + id + ': start=(' + a.x + ',' + a.y + ') end=(' + b.x + ',' + b.y + ')');
}
