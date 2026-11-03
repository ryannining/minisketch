// Probe for picking the span of a curve under the cursor.
//
// The bug: clicking the long straight edge of a panel selected a short segment
// somewhere else entirely (the reported case: the long bottom edge of a wall
// panel selected a 3 mm upright near the top-left corner).
//
// Cause: `splineFrame().paramOf()` in core.js divided the nearest-sample index
// by the literal 12. splineSamples() emits SPLINE_SEG samples per span, and
// SPLINE_SEG is a mutable global that app.js assigns from
// Settings -> Curves -> "Curve segments per span" (default 12). So the divisor
// was only right at the default: at 24 the span index came out doubled and got
// clamped to the last span, at 6 it was halved -- and the click landed on
// whatever span that named. On a panel whose last spans are the short uprights
// at the top-left, that is exactly the "small segment at the corner" symptom.
//
// paramOf also feeds split/trim and "insert point on curve", so those were
// wrong at any non-default setting too.
//
// Two fixes, both pinned here:
//   1. core.js derives the samples-per-span from the sample count instead of
//      assuming 12, so paramOf is correct at every setting.
//   2. app.js splineSegmentAt() no longer routes through the normalised
//      parameter at all: it measures the distance from the cursor to each
//      sampled span and takes the closest, which cannot be thrown off by how
//      the samples are numbered.
//
// The fixture is a real wall panel (150 x 50, three tabs out of one edge, two
// slots up each side) because that shape is what exposed it: long edges next to
// very short ones.
//
// Run: node testing/segment_pick_probe.js
const fs = require('fs');
const path = require('path');
const Module = require('module');

const root = path.join(__dirname, '..');
const coreSrc = fs.readFileSync(path.join(root, 'core.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

// ---- fixture -----------------------------------------------------------
const PANEL = [
  { x: 0, y: 0 }, { x: 21.429, y: 0 }, { x: 21.429, y: -3 }, { x: 42.857, y: -3 },
  { x: 42.857, y: 0 }, { x: 64.286, y: 0 }, { x: 64.286, y: -3 }, { x: 85.714, y: -3 },
  { x: 85.714, y: 0 }, { x: 107.143, y: 0 }, { x: 107.143, y: -3 }, { x: 128.571, y: -3 },
  { x: 128.571, y: 0 }, { x: 150, y: 0 },
  { x: 150, y: 8.696 }, { x: 147, y: 8.696 }, { x: 147, y: 15.217 }, { x: 150, y: 15.217 },
  { x: 150, y: 21.739 }, { x: 147, y: 21.739 }, { x: 147, y: 28.261 }, { x: 150, y: 28.261 },
  { x: 150, y: 34.783 }, { x: 147, y: 34.783 }, { x: 147, y: 41.304 }, { x: 150, y: 41.304 },
  { x: 150, y: 50 }, { x: 0, y: 50 },
  { x: 0, y: 41.304 }, { x: 3, y: 41.304 }, { x: 3, y: 34.783 }, { x: 0, y: 34.783 },
  { x: 0, y: 28.261 }, { x: 3, y: 28.261 }, { x: 3, y: 21.739 }, { x: 0, y: 21.739 },
  { x: 0, y: 15.217 }, { x: 3, y: 15.217 }, { x: 3, y: 8.696 }, { x: 0, y: 8.696 }
];
const N = PANEL.length;
const HANDLES = { o: PANEL.map(() => null), i: PANEL.map(() => null) };

// Clicks that sit ON the outline, in the clear part of each long edge. Points
// inside a slot are deliberately not used: there the inner face really is the
// closest edge, so they would test nothing.
const CLICKS = [
  { x: 10, y: 0, edge: 'bottom' }, { x: 53, y: 0, edge: 'bottom' }, { x: 139, y: 0, edge: 'bottom' },
  { x: 40, y: 50, edge: 'top' }, { x: 75, y: 50, edge: 'top' }, { x: 120, y: 50, edge: 'top' },
  { x: 0, y: 45, edge: 'left' }, { x: 0, y: 18, edge: 'left' },
  { x: 0, y: 31, edge: 'left' }, { x: 0, y: 3, edge: 'left' },
  { x: 150, y: 45, edge: 'right' }, { x: 150, y: 18, edge: 'right' },
  { x: 150, y: 31, edge: 'right' }, { x: 150, y: 3, edge: 'right' }
];
const onEdge = (k, edge) => {
  const A = PANEL[k], B = PANEL[(k + 1) % N];
  if (edge === 'bottom') return Math.abs(A.y) < 1e-6 && Math.abs(B.y) < 1e-6;
  if (edge === 'top') return Math.abs(A.y - 50) < 1e-6 && Math.abs(B.y - 50) < 1e-6;
  if (edge === 'left') return Math.abs(A.x) < 1e-6 && Math.abs(B.x) < 1e-6;
  if (edge === 'right') return Math.abs(A.x - 150) < 1e-6 && Math.abs(B.x - 150) < 1e-6;
  return false;
};
const spanText = (k) => '(' + PANEL[k].x + ',' + PANEL[k].y + ')->(' +
  PANEL[(k + 1) % N].x + ',' + PANEL[(k + 1) % N].y + ')';

// ---- helpers -----------------------------------------------------------
// core.js keeps SPLINE_SEG as a mutable global, so the probe recompiles the
// module with each value it wants to exercise. `oldParamOf` puts back the
// hardcoded divisor so the bug itself can be demonstrated.
function coreWith(seg, oldParamOf) {
  let code = coreSrc.replace(/var SPLINE_SEG = \d+;/, 'var SPLINE_SEG = ' + seg + ';');
  if (oldParamOf) {
    code = code.replace(
      /const per = Math\.max\(1, Math\.round\(\(samples\.length - 1\) \/ nsegs\)\);/,
      'const per = 12;');
  }
  const m = new Module(path.join(root, 'core.js'));
  m.filename = path.join(root, 'core.js');
  m.paths = Module._nodeModulePaths(root);
  m._compile(code, m.filename);
  return m.exports;
}

function braceEnd(s, from) {
  let d = 0;
  for (let j = s.indexOf('{', from); j < s.length; j++) {
    if (s[j] === '{') d++;
    else if (s[j] === '}') { d--; if (!d) return j + 1; }
  }
  throw new Error('unbalanced');
}
function sliceFn(name) {
  const st = appSrc.indexOf('function ' + name + '(');
  if (st < 0) throw new Error('not found: ' + name);
  let i = appSrc.indexOf('(', st), d = 0;
  for (; i < appSrc.length; i++) {
    if (appSrc[i] === '(') d++;
    else if (appSrc[i] === ')') { d--; if (!d) break; }
  }
  return appSrc.slice(st, braceEnd(appSrc, i));
}

// The real splineSegmentAt, driven with a stubbed entity.
function segAtFor(seg) {
  const C = coreWith(seg, false);
  const e = {
    id: 1, type: 'spline', closed: true,
    pts: PANEL.map((_, i) => i + 1),
    hs: { o: PANEL.map(() => null), i: PANEL.map(() => null) }
  };
  const samples = C.splineSamples(PANEL, e.hs, true);
  const fn = new Function('P', 'entityPointIds', 'splineSamplesOf', 'ensureSplineHandles',
    'splineSamples', 'clamp', 'SPLINE_SEG', 'return ' + sliceFn('splineSegmentAt'))(
    (id) => PANEL[id - 1], () => e.pts, () => samples, () => e.hs, C.splineSamples,
    (v, a, b) => Math.min(Math.max(v, a), b), seg);
  return (world) => fn(e, world);
}

// ---- 1. the parameter no longer depends on the sampling ----------------
console.log('\n-- a point has the same parameter at every sampling density --');
const params = [];
for (const seg of [6, 10, 12, 16, 24, 32, 48, 64]) {
  const C = coreWith(seg, false);
  params.push(C.splineFrame(PANEL, HANDLES, true).paramOf({ x: 75, y: 50 }));
}
const spread = Math.max(...params) - Math.min(...params);
check('paramOf(75,50) is stable across 6..64 segments per span',
  spread < 0.02, 'spread ' + spread.toFixed(4));

// ---- 2. the old divisor really did break away from the default ---------
console.log('\n-- the old hardcoded divisor, for the record --');
const oldWrongAt = {};
for (const seg of [6, 10, 12, 16, 24, 32, 48, 64]) {
  const C = coreWith(seg, true);
  const frame = C.splineFrame(PANEL, HANDLES, true);
  let wrong = 0;
  for (const c of CLICKS) {
    const t = frame.paramOf({ x: c.x, y: c.y });
    const k = Math.min(N - 1, Math.floor(Math.max(0, Math.min(1, t)) * N));
    if (!onEdge(k, c.edge)) wrong++;
  }
  oldWrongAt[seg] = wrong;
}
check('at the default (12) the old code was right, which is why this hid',
  oldWrongAt[12] === 0, oldWrongAt[12] + ' wrong');
for (const seg of [6, 10, 16, 24, 32, 48, 64]) {
  check('at ' + seg + ' segments per span the old code was badly wrong (' +
    oldWrongAt[seg] + '/' + CLICKS.length + ')', oldWrongAt[seg] > 0);
}

// ---- 3. the fix: every setting lands on the edge under the cursor ------
console.log('\n-- the span under the cursor, at every setting --');
for (const seg of [6, 10, 12, 16, 24, 32, 48, 64]) {
  const segAt = segAtFor(seg);
  let wrong = 0, first = null;
  for (const c of CLICKS) {
    const s = segAt({ x: c.x, y: c.y });
    if (!s || !onEdge(s.seg, c.edge)) {
      wrong++;
      if (!first) first = c.edge + ' @' + c.x + ',' + c.y + ' -> ' + (s ? spanText(s.seg) : 'null');
    }
  }
  check(seg + ' segments per span: all ' + CLICKS.length + ' clicks land on their edge',
    wrong === 0, wrong + ' wrong, e.g. ' + first);
}

// ---- 4. short spans are still selectable -------------------------------
console.log('\n-- the short spans are still reachable --');
const segAt12 = segAtFor(12);
const tab = segAt12({ x: 21.429, y: -1.5 });
check('a click inside a tab picks the tab',
  Math.abs(PANEL[tab.seg].y + 3) < 1e-6 || Math.abs(PANEL[(tab.seg + 1) % N].y + 3) < 1e-6,
  spanText(tab.seg));
const slot = segAt12({ x: 148.5, y: 12 });
check('a click inside a side slot picks the slot',
  Math.abs(PANEL[slot.seg].x - 147) < 1e-6 && Math.abs(PANEL[(slot.seg + 1) % N].x - 147) < 1e-6,
  spanText(slot.seg));
const slot2 = segAt12({ x: 1.5, y: 25 });
check('a click inside the other slot picks it',
  Math.abs(PANEL[slot2.seg].x - 3) < 1e-6 && Math.abs(PANEL[(slot2.seg + 1) % N].x - 3) < 1e-6,
  spanText(slot2.seg));

// ---- 5. open splines do not wrap --------------------------------------
console.log('\n-- open splines --');
const OPEN = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }];
const openSeg = new Function('P', 'entityPointIds', 'splineSamplesOf', 'ensureSplineHandles',
  'splineSamples', 'clamp', 'SPLINE_SEG', 'return ' + sliceFn('splineSegmentAt'))(
  (id) => OPEN[id - 1], () => [1, 2, 3],
  () => coreWith(12, false).splineSamples(OPEN, { o: [null, null, null], i: [null, null, null] }, false),
  () => ({ o: [null, null, null], i: [null, null, null] }),
  coreWith(12, false).splineSamples, (v, a, b) => Math.min(Math.max(v, a), b), 12);
const OPEN_E = { id: 2, type: 'spline', closed: false, pts: [1, 2, 3],
  hs: { o: [null, null, null], i: [null, null, null] } };
const os1 = openSeg(OPEN_E, { x: 50, y: 25 });
check('an open spline picks its last span', os1.a === 2 && os1.b === 3, JSON.stringify(os1));
const os2 = openSeg(OPEN_E, { x: 25, y: 0 });
check('an open spline picks its first span', os2.a === 1 && os2.b === 2, JSON.stringify(os2));

// ---- 6. where the fix lives -------------------------------------------
console.log('\n-- the fix is in the shared helper, not the caller --');
check('core.js no longer divides the sample index by a literal 12',
  !/Math\.floor\(bi \/ 12\)/.test(coreSrc) && !/\(bi % 12\)/.test(coreSrc));
check('core.js derives the samples-per-span from the sample count',
  /\(samples\.length - 1\) \/ nsegs/.test(coreSrc));
check('splineSegmentAt measures the distance to each sampled span',
  /world\.x - \(prev\.x \+ dx \* t\)/.test(appSrc));

console.log('\n' + (fail ? fail + ' FAILED, ' : '') + pass + ' checks passed');
process.exit(fail ? 1 : 0);
