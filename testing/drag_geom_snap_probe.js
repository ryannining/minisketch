// Probe for the point-drag geometry snaps:
//   * dragging a single point snaps to a line (on-line), a line midpoint, a
//     closed-loop centre and the origin — not just to existing points
//   * the caught snap is carried in d.snap so drawSnapMarker draws the right
//     virtual indicator (midpoint / on line / loop centre / origin / grid)
//   * the dragged point lands EXACTLY on the snap (dx/dy anchor math)
//   * a multi-point body (loop) drag snaps through the SAME snapPoint API so
//     every point-snap feature applies (points, origin, on-line, midpoint,
//     other loops' centres, grid), while the dragged geometry itself is
//     excluded (skip / skipEntities / skipLoops)
//   * partSnapCache includes loop centroids
//
// Run: node testing/drag_geom_snap_probe.js
'use strict';
const fs = require('fs');
const path = require('path');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

function braceEnd(src, from) {
  const i = src.indexOf('{', from);
  let depth = 0;
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

// ---- fixture: a line (60,0)->(160,0) and a square loop centred at (200,100) --
// The line is kept off the origin so an origin snap is unambiguous (no point
// sits on (0,0)) and the loop corners are far from the line.
const state = {
  points: {
    1: { x: 60, y: 0 }, 2: { x: 160, y: 0 },
    3: { x: 190, y: 90 }, 4: { x: 210, y: 90 },
    5: { x: 210, y: 110 }, 6: { x: 190, y: 110 },
    // a second, undragged loop (square, centroid (300,140)) so the body-drag
    // tests can prove snapping to ANOTHER loop's centre works, and self-snap
    // to the dragged loop's own centre is excluded
    21: { x: 280, y: 120 }, 22: { x: 320, y: 120 },
    23: { x: 320, y: 160 }, 24: { x: 280, y: 160 }
  },
  entities: {
    7: { id: 7, type: 'line', a: 1, b: 2, layer: 1 },
    8: { id: 8, type: 'line', a: 3, b: 4, layer: 1 },
    9: { id: 9, type: 'line', a: 4, b: 5, layer: 1 },
    10: { id: 10, type: 'line', a: 5, b: 6, layer: 1 },
    11: { id: 11, type: 'line', a: 6, b: 3, layer: 1 },
    21: { id: 21, type: 'line', a: 21, b: 22, layer: 1 },
    22: { id: 22, type: 'line', a: 22, b: 23, layer: 1 },
    23: { id: 23, type: 'line', a: 23, b: 24, layer: 1 },
    24: { id: 24, type: 'line', a: 24, b: 21, layer: 1 }
  },
  constraints: {},
  layers: [{ id: 1, visible: true }],
  nextId: 500
};
const ui = { snap: true, showGrid: false, color: '#000000' };
const view = { zoom: 1 };
// Memoized so loop identity is stable across calls — selectionBodyDragFor and
// snapPoint must agree on WHICH loop object is being dragged (skipLoops uses
// object identity).
let cachedLoops = null;
const getLoops = () => {
  if (!cachedLoops) {
    const p = (id) => state.points[id];
    const poly1 = [3, 4, 5, 6, 3].map(id => ({ x: p(id).x, y: p(id).y }));
    const poly2 = [21, 22, 23, 24, 21].map(id => ({ x: p(id).x, y: p(id).y }));
    cachedLoops = [
      { poly: poly1, area: 400, steps: [] },
      { poly: poly2, area: 1600, steps: [] }
    ];
  }
  return cachedLoops;
};

const snapApi = new Function(
  'state', 'ui', 'view', 'newId', 'P', 'layerVisible', 'clamp', 'gridStep',
  'weldAllowed', 'getLoops', 'pointCandidatesNear', 'settings',
  'let loopCentroidLoops = null;\nlet loopCentroidMap = null;\n' +
  slice('snapEnabled') + '\n' + slice('snapPoint') + '\n' +
  slice('snapLineGeometry') + '\n' + slice('snapLoopCentroid') + '\n' +
  slice('loopCentroids') +
  '\nreturn { snapPoint };'
)(
  state, ui, view, () => state.nextId++, (id) => state.points[id], () => true,
  (v, lo, hi) => Math.min(hi, Math.max(lo, v)), () => 10, () => true,
  getLoops, () => null, { autoDimension: 'on' }
);
const snapPoint = snapApi.snapPoint;

console.log('\n== snapPoint delivers geometry snaps for the point drag ==');
{
  const mid = snapPoint({ x: 111, y: 2 });
  check('near a line midpoint -> midId', mid && mid.midId === 7, JSON.stringify(mid));
  check('midpoint snap carries the position', mid && mid.x === 110 && mid.y === 0);

  const onl = snapPoint({ x: 130, y: 2 });
  check('near a line body -> lineId', onl && onl.lineId === 7, JSON.stringify(onl));
  check('on-line snap stays on the line', onl && onl.x === 130 && onl.y === 0);

  const loop = snapPoint({ x: 200.3, y: 100.4 });
  check('near a loop centre -> virtual', loop && loop.virtual === true, JSON.stringify(loop));
  check('loop snap flags the loop', loop && loop.loop === true);
  check('loop snap sits exactly on the centroid', loop && Math.abs(loop.x - 200) < 1e-6 && Math.abs(loop.y - 100) < 1e-6);

  const org = snapPoint({ x: 0.5, y: 0.4 });
  check('near the origin -> origin', org && org.origin === true, JSON.stringify(org));

  const none = snapPoint({ x: 300, y: 300 });
  check('far from everything -> raw position', none && none.id == null && !none.lineId && !none.midId && !none.virtual && !none.origin);

  // grid: only when the grid is on, and it must not beat points/lines/loops
  ui.showGrid = false;
  const noGrid = snapPoint({ x: 34.2, y: 27.8 });
  check('grid off -> no grid snap', !noGrid.grid, JSON.stringify(noGrid));
  const better = snapPoint({ x: 111, y: 2 });
  check('grid on still lets the midpoint win', better.midId === 7, JSON.stringify(better));
  ui.showGrid = true;
  const grd = snapPoint({ x: 34.2, y: 27.8 });
  check('grid on -> grid snap flagged', grd.grid === true, JSON.stringify(grd));
  check('grid snap sits on the grid intersection', grd.x === 30 && grd.y === 30, JSON.stringify(grd));
  ui.showGrid = false;
}

// ---- the actual drag branch, extracted from app.js as-is -------------------
const branchStart = appSrc.indexOf('if (d.ids.length <= 1 && d.snapPrimary && d.primary != null && d.origPrimary) {');
const branchEnd = appSrc.indexOf('} else if (d.grab) {', branchStart);
check('single-point drag branch found once', branchStart > 0 && branchEnd > branchStart);
const branch = appSrc.slice(branchStart, branchEnd + 1);   // includes the closing }
const runBranch = new Function('d', 'world', 'dep', `
  let dx = world.x - d.startWorld.x;
  let dy = world.y - d.startWorld.y;
  const snapPoint = dep.snapPoint;
  const dragWeldColor = dep.dragWeldColor;
  const weldAllowed = dep.weldAllowed;
  ${branch}
  return { dx, dy, snap: d.snap };
`);

// ---- the body-drag branch, extracted from app.js as-is ---------------------
const bodyOpen = '} else if (d.grab) {';
const bodyStart = appSrc.indexOf(bodyOpen, branchEnd);
const bodyEnd = appSrc.indexOf('\n        } else {\n          d.snap = null;', bodyStart);
check('body drag branch found once', bodyStart > 0 && bodyEnd > bodyStart);
// slice the statements INSIDE the else-if (after the opener); embed them in a
// synthetic block so the fragment compiles standalone
const bodyBranch = appSrc.slice(bodyStart + bodyOpen.length, bodyEnd);
const runBodyBranch = new Function('d', 'dep', `
  let dx = dep.raw.dx;
  let dy = dep.raw.dy;
  const snapPoint = dep.snapPoint;
  if (true) {
    ${bodyBranch}
  }
  return { dx, dy, snap: d.snap };
`);

console.log('\n== single-point drag: caught snaps land exactly and carry the marker ==');
{
  const base = { 5: { x: 10, y: 0 } };
  const mkD = () => ({
    ids: [5], snapPrimary: true, primary: 5,
    origPrimary: { x: 10, y: 0 },
    startWorld: { x: 10, y: 0 },
    startPos: base, base, bodyDrag: false,
    offX: 0, offY: 0, snap: null
  });

  {
    const d = mkD();
    const r = runBranch(d, { x: 111, y: 2 }, { snapPoint, dragWeldColor: () => null, weldAllowed: () => true });
    check('midpoint snap: d.snap.midId set', r.snap && r.snap.midId === 7, JSON.stringify(r.snap));
    check('midpoint snap: no coincident id', r.snap && r.snap.id == null);
    check('midpoint snap: full lands on the midpoint', 10 + r.dx === 110 && r.dy === 0, (10 + r.dx) + ',' + r.dy);
  }
  {
    const d = mkD();
    const r = runBranch(d, { x: 130, y: 2 }, { snapPoint, dragWeldColor: () => null, weldAllowed: () => true });
    check('on-line snap: d.snap.lineId set', r.snap && r.snap.lineId === 7, JSON.stringify(r.snap));
    check('on-line snap: point lands on the line', 10 + r.dx === 130 && r.dy === 0, (10 + r.dx) + ',' + r.dy);
  }
  {
    const d = mkD();
    const r = runBranch(d, { x: 200.3, y: 100.4 }, { snapPoint, dragWeldColor: () => null, weldAllowed: () => true });
    check('loop-centre snap: d.snap.virtual/loop set', r.snap && r.snap.virtual === true && r.snap.loop === true, JSON.stringify(r.snap));
    check('loop-centre snap: point lands on the centroid', Math.abs((10 + r.dx) - 200) < 1e-6 && Math.abs(r.dy - 100) < 1e-6, (10 + r.dx) + ',' + r.dy);
  }
  {
    const d = mkD();
    const r = runBranch(d, { x: 0.5, y: 0.4 }, { snapPoint, dragWeldColor: () => null, weldAllowed: () => true });
    check('origin snap: d.snap.origin set', r.snap && r.snap.origin === true, JSON.stringify(r.snap));
    check('origin snap: point lands on the origin', Math.abs((10 + r.dx) - 0) < 1e-6 && Math.abs(r.dy) < 1e-6, (10 + r.dx) + ',' + r.dy);
  }
  {
    const d = mkD();
    const r = runBranch(d, { x: 300, y: 300 }, { snapPoint, dragWeldColor: () => null, weldAllowed: () => true });
    check('no snap: d.snap stays null', r.snap === null, JSON.stringify(r.snap));
    check('no snap: raw delta preserved', r.dx === 290 && r.dy === 300, r.dx + ',' + r.dy);
  }
  {
    // grid snap: only when the grid is on; the point lands on the intersection
    ui.showGrid = true;
    const d = mkD();
    const r = runBranch(d, { x: 34.2, y: 27.8 }, { snapPoint, dragWeldColor: () => null, weldAllowed: () => true });
    check('grid snap: d.snap.grid set', r.snap && r.snap.grid === true, JSON.stringify(r.snap));
    check('grid snap: no coincident id', r.snap && r.snap.id == null);
    check('grid snap: point lands on the grid intersection', 10 + r.dx === 30 && r.dy === 30, (10 + r.dx) + ',' + r.dy);
    ui.showGrid = false;
  }
  {
    // existing POINT snap still welds / carries id (the old behaviour): drag
    // point 5 toward corner 4, which is not skipped.
    const d = mkD();
    const r = runBranch(d, { x: 210, y: 92 }, { snapPoint, dragWeldColor: () => '#000000', weldAllowed: () => true });
    check('existing-point snap: id carried for weld', r.snap && r.snap.id === 4, JSON.stringify(r.snap));
    check('existing-point snap: coincident true', r.snap && r.snap.coincident === true);
    check('existing-point snap: weld permission computed', r.snap && r.snap.weld === true);
    check('existing-point snap: point lands on the target', 10 + r.dx === 210 && r.dy === 90, (10 + r.dx) + ',' + r.dy);
  }
}


console.log('\n== multi-point body (loop) drag: full point-snap set, minus self ==');
{
  const mkBodyD = () => ({
    grab: { x: 10, y: 10 },
    skip: new Set([3, 4, 5, 6]),
    skipEntities: new Set([8, 9, 10, 11]),
    skipLoops: new Set([getLoops()[0]]),   // the loop being dragged
    snap: null
  });
  const dep = { snapPoint };

  {
    const d = mkBodyD();
    const r = runBodyBranch(d, { raw: { dx: 120, dy: -8 }, ...dep });
    check('body drag catches an on-line snap', r.snap && r.snap.lineId === 7, JSON.stringify(r.snap));
    check('body drag shifts so the grab lands on the line',
      10 + r.dx === 130 && 10 + r.dy === 0, (10 + r.dx) + ',' + (10 + r.dy));
  }
  {
    const d = mkBodyD();
    const r = runBodyBranch(d, { raw: { dx: 100, dy: -8 }, ...dep });
    check('body drag catches a line midpoint', r.snap && r.snap.midId === 7, JSON.stringify(r.snap));
    check('body drag lands its grab on the midpoint',
      10 + r.dx === 110 && 10 + r.dy === 0, (10 + r.dx) + ',' + (10 + r.dy));
  }
  {
    const d = mkBodyD();
    const r = runBodyBranch(d, { raw: { dx: 290, dy: 130 }, ...dep });
    check('body drag catches ANOTHER loop\'s centre', r.snap && r.snap.loop === true && r.snap.virtual === true, JSON.stringify(r.snap));
    check('body drag lands its grab on the other centroid',
      Math.abs((10 + r.dx) - 300) < 1e-6 && Math.abs((10 + r.dy) - 140) < 1e-6,
      (10 + r.dx) + ',' + (10 + r.dy));
  }
  {
    const d = mkBodyD();
    const r = runBodyBranch(d, { raw: { dx: 190, dy: 90 }, ...dep });
    check('body drag does NOT snap to its own loop centre', r.snap === null, JSON.stringify(r.snap));
    check('body drag keeps the raw delta on a self-snap', r.dx === 190 && r.dy === 90, r.dx + ',' + r.dy);
  }
  {
    const d = mkBodyD();
    const r = runBodyBranch(d, { raw: { dx: 180, dy: 80 }, ...dep });
    check('body drag does NOT snap onto its own edges', r.snap === null, JSON.stringify(r.snap));
  }
  {
    const d = mkBodyD();
    const r = runBodyBranch(d, { raw: { dx: 50, dy: -10 }, ...dep });
    check('body drag still catches another point', r.snap && r.snap.id === 1, JSON.stringify(r.snap));
  }
  {
    ui.showGrid = true;
    const d = mkBodyD();
    const r = runBodyBranch(d, { raw: { dx: 24.2, dy: 17.8 }, ...dep });
    check('body drag catches the grid when it is on', r.snap && r.snap.grid === true, JSON.stringify(r.snap));
    check('body drag lands its grab on the grid intersection',
      Math.abs((10 + r.dx) - 30) < 1e-9 && Math.abs((10 + r.dy) - 30) < 1e-9,
      (10 + r.dx) + ',' + (10 + r.dy));
    ui.showGrid = false;
  }
}

console.log('\n== source-level checks for the drag snap plumbing ==');
{
  check('partSnapCache adds loop centroids', /for \(const \[, c\] of loopCentroids\(\)\)/.test(appSrc));
  const partCacheIdx = appSrc.indexOf('function partSnapCache()');
  const partCacheBlock = appSrc.slice(partCacheIdx, appSrc.indexOf('\n  function ', partCacheIdx + 10));
  check('partSnapCache loop-centroid add lives inside the ui.snap branch',
    partCacheBlock.indexOf("if (ui.snap) {") < partCacheBlock.indexOf("for (const [, c] of loopCentroids())"));

  const selIdx = appSrc.indexOf('function selectionBodyDragFor(world)');
  const selBlock = appSrc.slice(selIdx, appSrc.indexOf('\n  function ', selIdx + 10));
  check('selectionBodyDragFor builds a skip point set', /const dragSet = new Set\(ids\)/.test(selBlock));
  check('selectionBodyDragFor builds skipLoops for self-loops',
    /const skipLoops = new Set\(\)/.test(selBlock));
  check('selectionBodyDragFor builds skipEntities for fully-dragged lines',
    /const skipEntities = new Set\(\)/.test(selBlock));
  check('selectionBodyDragFor passes skip/skipEntities/skipLoops through',
    /skip: dragSet/.test(selBlock) && /skipEntities,/.test(selBlock) && /skipLoops,/.test(selBlock));
  check('selectionBodyDragFor no longer builds a static snap cache',
    !/const cache = \[\]/.test(selBlock));
  check('the body drag snap call uses snapPoint with the skip sets',
    /snapPoint\(\{ x: wx, y: wy \}, \{/.test(appSrc) &&
    /skipEntities: d\.skipEntities/.test(appSrc) &&
    /skipLoops: d\.skipLoops/.test(appSrc));
}

console.log('\n' + (fail ? fail + ' FAILED, ' : 'all ') + pass + ' checks passed');
process.exit(fail ? 1 : 0);
