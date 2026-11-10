// Probe: full Ctrl+K Apply with the REAL app.js helpers (removeEntity,
// fuseCoincidentPoints, mergePoints, normalizeSplineLoops,
// removeDuplicateLines) against the user's tocurvefail.sketch, timing each
// stage to name the one that freezes.
// Run: node testing/tocurvefail_apply_probe.js
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

const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tocurvefail.sketch'), 'utf8'));
const s = doc.state;

const state = {
  points: {}, entities: {}, constraints: {}, 
  layers: s.layers || [{ id: 1, name: 'L1', visible: true, locked: false }],
  nextId: s.nextId || 1
};
for (const id in s.points) state.points[+id] = { x: s.points[id][0], y: s.points[id][1] };
for (const id in s.entities) {
  const e = s.entities[id];
  if (e.type === 'line') state.entities[+id] = { ...e, type: 'line', a: +e.a, b: +e.b };
  else if (e.type === 'spline') state.entities[+id] = { ...e, type: 'spline', pts: (e.pts || []).map(Number) };
  else state.entities[+id] = { ...e };
}

const ui = { selection: [], activeLayer: (state.layers[0] || {}).id || 1 };
const settings = { joinTol: 0.1, curveFitTol: 0.2, curveSharpAngle: 25 };

// --- real helpers from app.js -------------------------------------------
const genWatchRemove = () => {};
const mates = {};
const entityPointIds = (e) => {
  if (!e) return [];
  if (e.type === 'line') return [e.a, e.b];
  if (e.type === 'spline') return e.pts || [];
  if (e.type === 'circle') return [e.c];
  if (e.type === 'arc') return [e.c, e.a, e.b];
  return [];
};
const P = (id) => state.points[+id] || null;
const removeEntityFn = new Function(
  'state', 'genWatchRemove', 'entityPointIds', 'invalidateLoops', 'state_mates',
  slice('removeEntity') + '\nreturn removeEntity;'
)(state, genWatchRemove, entityPointIds, () => {}, mates);
const fuseFn = new Function(
  'state', 'mergePoints',
  slice('fuseCoincidentPoints') + '\nreturn fuseCoincidentPoints;'
)(state, mergePoints);
const normalizeFn = new Function(
  'state', 'entityPointIds', 'P', 'ensureSplineHandles', 'invalidateLoops', 'dist',
  slice('normalizeSplineLoops') + '\nreturn normalizeSplineLoops;'
)(state, entityPointIds, P, () => {}, () => {},
  (a, b) => Math.hypot(a.x - b.x, a.y - b.y));
const dedupeFn = new Function(
  'state', 'removeEntity',
  slice('removeDuplicateLines') + '\nreturn removeDuplicateLines;'
)(state, removeEntityFn);

// mergePoints real implementation is big; a faithful weld is enough: rewire
// every entity/constraint reference, drop the point (same semantics).
function mergePoints(fromId, toId) {
  const from = +fromId, to = +toId;
  for (const eid in state.entities) {
    const e = state.entities[eid];
    if (e.type === 'line') {
      if (+e.a === from) e.a = to;
      if (+e.b === from) e.b = to;
    } else if (e.type === 'spline') {
      e.pts = e.pts.map(p => (+p === from ? to : p));
      if (e.hs) {
        if (e.hs.o) delete e.hs.o;
        if (e.hs.i) delete e.hs.i;
      }
    } else if (e.type === 'arc') {
      if (+e.a === from) e.a = to;
      if (+e.b === from) e.b = to;
      if (+e.c === from) e.c = to;
    }
  }
  for (const cid in state.constraints) {
    const c = state.constraints[cid];
    if (+c.p1 === from) c.p1 = to;
    if (+c.p2 === from) c.p2 = to;
    if (+c.p === from) c.p = to;
  }
  delete state.points[from];
}

// --- applyFitCurve slice -------------------------------------------------
ui.selection = Object.keys(state.entities)
  .filter(id => state.entities[id].type === 'line' || state.entities[id].type === 'spline')
  .map(id => ({ kind: 'entity', id: +id }));

const applyFn = new Function(
  'src', 'chains', 'tol', 'sharpAngle',
  'state', 'ui', 'settings',
  'P', 'privatePoint', 'newId', 'entityPointIds', 'toast', 'fmt', 'pushHistory',
  'removeEntity', 'cleanupPoints', 'invalidateLoops', 'fuseCoincidentPoints',
  'normalizeSplineLoops', 'removeDuplicateLines', 'requestSolve', 'commit',
  'fitPolylineCurve',
  slice('applyFitCurve') + '\nreturn applyFitCurve;'
)(
  ui.selection.map(s => state.entities[s.id]),
  C.chainPolylines(
    ui.selection.flatMap(e => {
      if (e.type === 'line') {
        const a = P(e.a), b = P(e.b);
        return a && b ? [{ pts: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }], closed: false, color: e.color }] : [];
      }
      if (e.type === 'spline') {
        const pts = (e.pts || []).map(p => P(p)).filter(Boolean).map(p => ({ x: p.x, y: p.y }));
        return pts.length >= 2 ? [{ pts, closed: !!e.closed, color: e.color }] : [];
      }
      return [];
    }), settings.joinTol),
  settings.curveFitTol, settings.curveSharpAngle,
  state, ui, settings,
  P,
  (x, y) => { const id = ++state.nextId; state.points[id] = { x, y }; return id; },
  () => ++state.nextId,
  entityPointIds,
  (m) => console.log('TOAST:', m),
  (v) => String(Math.round(v * 100) / 100),
  () => {}, removeEntityFn,
  () => { // cleanupPoints real
    const used = new Set();
    for (const id in state.entities) for (const pid of entityPointIds(state.entities[id])) used.add(+pid);
    for (const id in state.constraints) {
      const c = state.constraints[id];
      if (c.p1 != null) used.add(+c.p1);
      if (c.p2 != null) used.add(+c.p2);
      if (c.p != null) used.add(+c.p);
    }
    for (const id in state.points) if (!used.has(+id)) delete state.points[id];
  },
  () => {}, fuseFn, normalizeFn, dedupeFn,
  () => {}, () => {}, C.fitPolylineCurve
);

const t0 = Date.now();
const srcEnts = ui.selection.map(s => state.entities[s.id]);
applyFn(
  srcEnts,
  C.chainPolylines(
    srcEnts.flatMap(e => {
      if (e.type === 'line') {
        const a = P(e.a), b = P(e.b);
        return a && b ? [{ pts: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }], closed: false, color: e.color }] : [];
      }
      if (e.type === 'spline') {
        const pts = (e.pts || []).map(p => P(p)).filter(Boolean).map(p => ({ x: p.x, y: p.y }));
        return pts.length >= 2 ? [{ pts, closed: !!e.closed, color: e.color }] : [];
      }
      return [];
    }), settings.joinTol),
  settings.curveFitTol, settings.curveSharpAngle
);
console.log('applyFitCurve total: ' + (Date.now() - t0) + 'ms');
console.log('splines made:', Object.values(state.entities).filter(e => e.type === 'spline').length);
console.log('lines left:', Object.values(state.entities).filter(e => e.type === 'line').length);
console.log('points:', Object.keys(state.points).length);
