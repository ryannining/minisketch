// Regression probe for the "double-click insert rounded the whole triangle"
// bug. The insert mutates an EXISTING spline's pts (3 -> 4) while the
// entity->points index (epiCache) still holds the OLD list. commit() ran
// cleanupPoints() BEFORE clearing that cache, so the brand-new point was not
// in the used-set, got swept, pts/hs lengths mismatched, and the renderer
// silently fell back to autoHandles — rounding every sharp corner.
//
// This probe replays the exact sequence with the REAL commit()/cleanupPoints()
// and a cached entityPointIds (the same caching contract as app.js).
//
// Run: node testing/commit_cleanup_probe.js
const fs = require('fs');
const path = require('path');
const Core = require('../core.js');
const { splineSamples, cubicAt } = Core;

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

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
function sliceApp(name) {
  const start = appSrc.indexOf('function ' + name + '(');
  if (start < 0) return null;
  let i = appSrc.indexOf('(', start), depth = 0;
  for (; i < appSrc.length; i++) {
    if (appSrc[i] === '(') depth++;
    else if (appSrc[i] === ')') { depth--; if (!depth) break; }
  }
  return appSrc.slice(start, braceEnd(appSrc, i));
}

// Module-level `let`s the sliced functions assign; declared here with the same
// names so the extracted function bodies bind to this probe's state.
let prelude = `
var pointUseCache = null;
var epiCache = new Map();
var layerIndex = null;
var byLayerCache = null;
var geometryEpoch = 0;
var pointEditableCache = null;
var pointShownCache = null;
var hitGridCache = null;
var entityCountCache = -1;
var pointGridCache = null;
var eqbCache = new Map();
var splineSampleCache = new Map();
var artContourCache = new Map();
var loopsDeferred = false;
var loopCache = null;
`;

// The sliced functions, in dependency order (resolution loop fills the rest).
for (const fn of ['invalidateLayerIndex', 'entityPointIdsBuild', 'entityPointIds',
  'cleanupPoints', 'invalidateLoops', 'commit']) {
  prelude += sliceApp(fn) + '\n';
}
prelude += `
function getLayer(id) {
  if (!layerIndex) {
    layerIndex = new Map();
    for (const l of (state.layers || [])) layerIndex.set(l.id, l);
  }
  return layerIndex.get(id) === undefined ? null : layerIndex.get(id);
}
function layerOf(e) { return e.layer != null ? e.layer : 1; }
function scheduleSave() {}
function updateUI() {}
function render() {}
`;

const PARAMS = ['state', 'ui'];
function makeFn() {
  const values = [state, { activeLayer: 1, drag: null }];
  return new Function(...PARAMS, prelude + '\n return { commit, entityPointIds, cleanupPoints };')(...values);
}

// --- fixture: the user's closed sharp triangle --------------------------------
const state = {
  points: {
    1: { x: 112.74, y: -144.86 },
    2: { x: 483.18, y: -115.06 },
    3: { x: 299.06, y: -28.8 }
  },
  entities: {
    4: {
      id: 4, type: 'spline', pts: [1, 2, 3], closed: true, color: '#000000', layer: 1,
      hs: { o: [null, null, null], i: [null, null, null] }
    }
  },
  constraints: {},
  layers: [{ id: 1, name: 'Layer 1', visible: true }],
  nextId: 10
};
const ui = { activeLayer: 1, drag: null };

const api = makeFn();

// 1. warm the entity->points cache exactly like the app does while rendering
const warm = api.entityPointIds(state.entities[4]);
check('cache warmed with the pre-edit points', JSON.stringify(warm) === '[1,2,3]', JSON.stringify(warm));

// 2. replay the double-click insert mutation on the existing entity, with the
// exact handles De Casteljau produces (the console log rounds to 2 decimals;
// here we use full precision)
const r = Core.splitCubic(
  state.points[1], state.points[1], state.points[2], state.points[2], 0.4869);
const ids = api.entityPointIds(state.entities[4]).slice();
ids.splice(1, 0, 14);
const e = state.entities[4];
e.pts = ids;
e.hs = {
  o: [r.left.o, r.right.o, null, null],
  i: [null, r.left.i, r.right.i, null]
};
state.points[14] = { x: r.S.x, y: r.S.y };

// 3. commit() — the real one, with the real cleanupPoints ordering
api.commit();

// 4. the new point must have survived the sweep
check('inserted point 14 survives cleanupPoints', !!state.points[14],
  'points left: ' + Object.keys(state.points).join(','));
check('entity pts still reference it', e.pts.length === 4 && e.pts.includes(14), JSON.stringify(e.pts));
check('pts/hs lengths stay consistent (no autoHandles fallback)',
  e.hs.o.length === 4 && e.hs.i.length === 4, e.hs.o.length + '/' + e.hs.i.length);

// 5. the outline must still be the triangle: every sample sits on the NEAREST
// of the three sides
const cps = e.pts.map(pid => state.points[pid]).filter(Boolean);
const samples = splineSamples(cps, e.hs, true);
const sides = [[1, 2], [2, 3], [3, 1]];
let worst = 0;
for (const s of samples) {
  let best = Infinity;
  for (const [ai, bi] of sides) {
    const A = state.points[ai], B = state.points[bi];
    const dx = B.x - A.x, dy = B.y - A.y, L2 = dx * dx + dy * dy;
    let t = ((s.x - A.x) * dx + (s.y - A.y) * dy) / L2;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(s.x - (A.x + dx * t), s.y - (A.y + dy * t)));
  }
  worst = Math.max(worst, best);
}
check('outline stays the straight-sided triangle (max deviation ' + worst.toExponential(2) + ')', worst < 1e-6, worst);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
