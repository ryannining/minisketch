// Probe for rotating a framed object (text / art / image) via the transform
// gizmo or the quick 90° rotate:
//
//   The framed kinds hold their frame together with constraints that live on
//   their GUIDE LINES, not on the framed entity itself: `horizontal` names a
//   guide (c.entity = guide id), `perpendicular` names the guide pair. The
//   drop rule in xfCommit / quickRotate tested ownership against the selected
//   entity ids alone, so rotating a picture left the H constraint behind and
//   the release solve rotated the frame straight back to 0°.
//
//   The fix: selectionEntityIds() — the selection's entity ids PLUS the guide
//   ids, the same ownership rule selectionPointIds() already applies to
//   points.
//
// Run: node testing/rotate_guide_constraint_probe.js
'use strict';
const fs = require('fs');
const path = require('path');
const C = require(path.join(__dirname, '..', 'core.js'));

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

// ---- selectionEntityIds: the ownership rule ------------------------------
function buildIdsFn(world, selection) {
  return new Function('state', 'ui', slice('selectionEntityIds') + '\nreturn selectionEntityIds;')(
    world, { selection });
}

console.log('\n== selectionEntityIds sees the guides of a framed object ==');
{
  const w = { points: {}, entities: {} };
  const mk = (x, y) => { const id = w.points.a ? (w.points.b ? 'pc' : 'pb') : 'pa'; w.points[id] = { id, x, y }; return id; };
  const gW = 101, gH = 102, img = 100;
  w.entities[gW] = { id: gW, type: 'line', a: mk(0, 0), b: mk(10, 0) };
  w.entities[gH] = { id: gH, type: 'line', a: mk(0, 0), b: mk(0, 5) };
  w.entities[img] = { id: img, type: 'image', p0: 'pa', pw: 'pb', ph: 'pc', guide: [gW, gH] };
  const ids = buildIdsFn(w, [{ kind: 'entity', id: img }])();
  check('the framed entity itself is in the set', ids.has(img), [...ids].join(','));
  check('guide W is in the set', ids.has(gW), [...ids].join(','));
  check('guide H is in the set', ids.has(gH), [...ids].join(','));
  check('exactly the image + its two guides', ids.size === 3, ids.size);
}

console.log('\n== a plain line brings no extra ids ==');
{
  const w = { points: { a: { id: 'a', x: 0, y: 0 }, b: { id: 'b', x: 5, y: 0 } }, entities: {} };
  w.entities[7] = { id: 7, type: 'line', a: 'a', b: 'b' };
  const ids = buildIdsFn(w, [{ kind: 'entity', id: 7 }])();
  check('only the line itself', ids.size === 1 && ids.has(7), [...ids].join(','));
}

console.log('\n== the callers use the guide-aware set (static) ==');
{
  const xf = slice('xfCommit');
  const qr = slice('quickRotate');
  check('xfCommit builds eids via selectionEntityIds', /const eids = selectionEntityIds\(\)/.test(xf));
  check('quickRotate builds eids via selectionEntityIds', /const eids = selectionEntityIds\(\)/.test(qr));
  check('the old eids construction is gone from both',
    !/eids = new Set\(selectedEntities\(\)\.map/.test(xf + qr));
}

// ---- solver demo: H on the guide un-rotates the picture ------------------
// The real solveSketch, minimal surroundings (same harness as
// arc_constraints_probe).
function makeWorld() {
  return {
    points: {}, entities: {}, constraints: {},
    layers: [{ id: 1, visible: true, locked: false }],
    nextId: 1
  };
}
function pt(w, x, y) {
  const id = w.nextId++;
  w.points[id] = { id, x, y };
  return id;
}
function line(w, a, b) {
  const id = w.nextId++;
  w.entities[id] = { id, type: 'line', a, b, color: '#00ff00', layer: 1 };
  return id;
}
function buildSolver(w) {
  return new Function(
    'state', 'ui', 'P', 'dist', 'clamp', 'TAU', 'wrapPi', 'norm2pi',
    'lmSolve', 'textDimCount', 'RADIUS_SOLVE_LIMIT',
    slice('solveSketch') + '\nreturn solveSketch;'
  )(
    w, { solverCost: 0 }, (id) => w.points[id],
    (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
    (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
    Math.PI * 2,
    (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a <= -Math.PI) a += Math.PI * 2; return a; },
    (a) => { while (a < 0) a += Math.PI * 2; while (a >= Math.PI * 2) a -= Math.PI * 2; return a; },
    C.lmSolve,
    () => 2,       // textDimCount: both guides dimensioned -> aspect released
    2              // RADIUS_SOLVE_LIMIT
  );
}

// A picture rotated 30 deg AFTER placement, exactly what the transform gizmo
// leaves behind: the frame points rotated, H still on the width guide unless
// the drop rule removed it.
function placedPicture(w, theta, withH) {
  const p0 = pt(w, 40, 40);
  const pw = pt(w, 40 + Math.cos(theta) * 100, 40 + Math.sin(theta) * 100);
  const ph = pt(w, 40 - Math.sin(theta) * 50, 40 + Math.cos(theta) * 50);
  const gW = line(w, p0, pw);
  const gH = line(w, p0, ph);
  const id = w.nextId++;
  w.entities[id] = { id, type: 'image', p0, pw, ph, guide: [gW, gH], ratio: 2 };
  if (withH) w.constraints[w.nextId++] = { id: w.nextId, type: 'horizontal', entity: gW };
  w.constraints[w.nextId++] = { id: w.nextId, type: 'perpendicular', line1: gW, line2: gH };
  return { id, gW, gH, p0, pw, ph };
}

const angleDeg = (w, pic) => {
  const a = w.points[pic.p0], b = w.points[pic.pw];
  return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
};

console.log('\n== H on the width guide rotates a 30 deg picture back ==');
{
  const w = makeWorld();
  const pic = placedPicture(w, Math.PI / 6, true);
  const solve = buildSolver(w);
  solve({ maxIter: 60 });
  const deg = angleDeg(w, pic);
  // the H residual only reads y, so any horizontal answer satisfies it: the
  // solver walks the frame off the user's 30 deg (here it lands flipped)
  check('the H constraint does not leave the rotation at 30 deg',
    Math.abs(Math.abs(deg) - 30) > 5, deg);
}

console.log('\n== with the guide constraints dropped (the fix), the rotation stays ==');
{
  const w = makeWorld();
  const pic = placedPicture(w, Math.PI / 6, false);
  const solve = buildSolver(w);
  solve({ maxIter: 60 });
  const deg = angleDeg(w, pic);
  check('a rotated picture with no H keeps its rotation', Math.abs(deg - 30) < 0.1, deg);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
