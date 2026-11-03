// Probe for drafting snaps: midpoint of a line and point-on-line.
// Slices snapLineGeometry()/materializePoint() out of ../app.js and exercises
// them against a one-line fixture, then checks the constraint that gets added.
//
// Run: node testing/snap_probe.js
const fs = require('fs');
const path = require('path');

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
const sliceApp = (name) => {
  const start = appSrc.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('not found: ' + name);
  // The parameter list may hold default objects (opts = {}), so walk to the
  // closing paren before the body; the slice keeps the header.
  let i = appSrc.indexOf('(', start), depth = 0;
  for (; i < appSrc.length; i++) {
    if (appSrc[i] === '(') depth++;
    else if (appSrc[i] === ')') { depth--; if (!depth) break; }
  }
  return appSrc.slice(start, braceEnd(appSrc, i));
};

const state = {
  points: { 1: { id: 1, x: 0, y: 0 }, 2: { id: 2, x: 100, y: 0 } },
  entities: { 7: { id: 7, type: 'line', a: 1, b: 2, color: '#000000' } },
  constraints: {},
  nextId: 100
};
const newId = () => state.nextId++;
const ui = { snap: true, showGrid: true };
const view = { zoom: 1 };

let prelude = '';
let api = null;
// materializePoint consults weldAllowed; the probe never wants a weld, so it
// always gets a fresh point (the real rule needs the point-use index)
const build = () => new Function('state', 'ui', 'view', 'newId', 'P', 'layerVisible', 'clamp', 'gridStep',
  // materializePoint welds same-colour points and (unless auto dimension is
  // off) leaves a Midpoint / On-line constraint behind — the probe wants both
  // snapPoint consults the S/G toggle: carry the real rule so "snap off means
  // off" is exercised instead of a hard-coded true
  sliceApp('snapEnabled') + '\n' +
  'const weldAllowed = () => true;\n' +
  "const settings = { autoDimension: 'on' };\n" +
  sliceApp('snapLineGeometry') + '\n' + sliceApp('snapLoopCentroid') + '\n' +
  'const getLoops = () => [];\n' +
  sliceApp('snapPoint') + '\n' + sliceApp('materializePoint') +
  '\n return { snapLineGeometry, snapPoint, materializePoint };'
)(state, ui, view, newId, (id) => state.points[id], () => true,
  (v, lo, hi) => Math.min(hi, Math.max(lo, v)), () => 10);

try {
  api = build();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

console.log('\n== snapLineGeometry ==');
const mid = api.snapLineGeometry({ x: 50, y: 0.6 }, 5);
console.log('  near midpoint ->', JSON.stringify(mid));
check('midpoint wins near the middle', mid && mid.midId === 7 && mid.x === 50 && mid.y === 0);

const onLine = api.snapLineGeometry({ x: 20, y: 0.6 }, 5);
console.log('  on the body   ->', JSON.stringify(onLine));
check('body snap returns lineId', onLine && onLine.lineId === 7 && Math.abs(onLine.x - 20) < 1e-9);
check('body snap returns no midId', onLine && onLine.midId === undefined);

const nearEnd = api.snapLineGeometry({ x: 1, y: 0 }, 5);
check('ends are left to the point snap',
  nearEnd === null || (nearEnd.lineId === undefined && nearEnd.midId === undefined),
  JSON.stringify(nearEnd));

const far = api.snapLineGeometry({ x: 20, y: 40 }, 5);
check('outside the tolerance -> null', far === null, JSON.stringify(far));

// Regression: at the exact middle the body candidate is always the closer of
// the two, so the midpoint needs feature-point priority.
const deadCentre = api.snapLineGeometry({ x: 50, y: 0 }, 9);
check('exact middle still counts as midpoint', deadCentre && deadCentre.midId === 7,
  JSON.stringify(deadCentre));

console.log('\n== snapPoint: grid follows the G toggle ==');
ui.showGrid = true;
const snapOn = api.snapPoint({ x: 23.4, y: 41.7 });
check('grid on -> snaps to the 10 mm grid', snapOn.x === 20 && snapOn.y === 40, JSON.stringify(snapOn));
ui.showGrid = false;
const snapOff = api.snapPoint({ x: 23.4, y: 41.7 });
check('grid off -> free position, no grid snap', snapOff.x === 23.4 && snapOff.y === 41.7, JSON.stringify(snapOff));
const midStill = api.snapPoint({ x: 50.4, y: 0.3 });
check('geometry snap still works with the grid hidden', midStill.midId === 7, JSON.stringify(midStill));
const pointStill = api.snapPoint({ x: 0.4, y: 0.2 });
check('point snap still works with the grid hidden', pointStill.id === 1, JSON.stringify(pointStill));
ui.showGrid = true;

console.log('\n== materializePoint ==');
const pMid = api.materializePoint({ x: 50, y: 0, midId: 7 });
const cMid = Object.values(state.constraints).find(c => +c.p === pMid);
console.log('  midpoint constraint ->', JSON.stringify(cMid));
check('creates a midpoint constraint', !!cMid && cMid.type === 'midpoint' && +cMid.entity === 7);
check('constraint carries its own id', !!cMid && cMid.id === +Object.keys(state.constraints).find(k => state.constraints[k] === cMid));
check('point sits on the midpoint', state.points[pMid].x === 50 && state.points[pMid].y === 0);

const pOn = api.materializePoint({ x: 20, y: 0, lineId: 7 });
const cOn = Object.values(state.constraints).find(c => +c.p === pOn);
console.log('  pointOn constraint  ->', JSON.stringify(cOn));
check('creates a pointOn constraint', !!cOn && cOn.type === 'pointOn' && +cOn.entity === 7);

const pFresh = api.materializePoint({ x: 33, y: 12 });
check('free click adds no constraint', !Object.values(state.constraints).some(c => +c.p === pFresh));

state.nextId = 500;
const reuse = api.materializePoint({ x: 0, y: 0, id: 2, lineId: 7 });
check('snapping to an existing point reuses it and adds nothing', reuse === 2 && state.nextId === 500);

console.log('\n' + (fail ? (fail + ' FAILED, ' + pass + ' passed') : ('all ' + pass + ' checks passed')));
process.exit(fail ? 1 : 0);
