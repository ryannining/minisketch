// Probe for the Transform (R) point capture.
//
// A curve selected as an ENTITY used to explode when transformed: xfStartSession
// captured orig.handles for every selected spline, but orig.points only for
// selectionPointIds() — the points picked EXPLICITLY. An entity-selected curve
// has no explicitly selected points, so its handles were transformed while its
// anchors were never captured and never moved. The render then drew each anchor
// against handles that had flown off, which is the amber spray.
//
// The rule: capture exactly the set the transform will move.
//
// Run: node testing/transform_capture_probe.js
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

const ssStart = app.indexOf('function xfStartSession(');
const ssBody = app.slice(ssStart, app.indexOf('\n  function xfMapOriginal', ssStart));

console.log('transform capture: owned points are captured');
check('the capture set is selectionPointIds()',
  /for \(const id of selectionPointIds\(\)\)/.test(ssBody));
check('orig.points is filled from it',
  /for \(const id of selectionPointIds\(\)\)[\s\S]{0,140}orig\.points\[id\]/.test(ssBody));
// selectionPointIds() must be the COMBINED set — explicit points plus points of
// selected entities — or an entity-selected curve loses its anchors again.
check('selectionPointIds covers points owned by selected entities',
  (() => {
    const fnStart = app.indexOf('function selectionPointIds(');
    const body = app.slice(fnStart, app.indexOf('\n  function ', fnStart));
    return /s\.kind === 'entity'/.test(body) && /entityPointIds\(e\)/.test(body);
  })());
check('it returns a Set (so no .map call is needed)',
  (() => {
    const fnStart = app.indexOf('function selectionPointIds(');
    const body = app.slice(fnStart, app.indexOf('\n  function ', fnStart));
    return /const ids = new Set\(\)/.test(body) && /return ids;/.test(body);
  })());
check('no code calls .map on selectionPointIds()',
  !/selectionPointIds\(\)\.map/.test(app));

console.log('transform capture: handles come from the same set');
{
  const fnStart = app.indexOf('function movingSplineIds(');
  const body = app.slice(fnStart, app.indexOf('\n  function xfStartSession', fnStart));
  check('movingSplineIds exists', fnStart > 0);
  check('entity-selected splines are included',
    /if \(e\.type === 'spline'\) ids\.add\(\+e\.id\)/.test(body));
  check('point-selected splines are included',
    /own\.some\(pid => pts\.has\(\+pid\)\)/.test(body));
}
check('orig.handles is built from movingSplineIds',
  /for \(const eid of movingSplineIds\(\)\)[\s\S]{0,300}orig\.handles\[e\.id\]/.test(ssBody));
check('handles are ensured for point-selected splines too',
  /for \(const eid of movingSplineIds\(\)\)[\s\S]{0,120}ensureSplineHandles\(e\)/.test(ssBody));

console.log('transform capture: preview and restore use orig.points');
check('preview moves every captured point',
  /for \(const id in p\.orig\.points\)[\s\S]{0,220}pt\.x = q\.x/.test(app));
check('cancel restores every captured point',
  /function xfRestoreOriginals\(\)[\s\S]{0,260}p\.orig\.points/.test(app));
check('preview maps handles through the same transform',
  /e\.hs\.o = oh\.o\.map\(h => \(h \? xfMapOriginal/.test(app));

// the invariant, checked arithmetically: a translate-only transform must leave
// every captured point displaced by exactly (dx, dy)
console.log('transform capture: translate moves points rigidly');
{
  const map = (x, y, p) => {
    const phi = p.frame0 + p.angle;
    const c0 = Math.cos(p.frame0), s0 = Math.sin(p.frame0);
    const c1 = Math.cos(phi), s1 = Math.sin(phi);
    const dx = x - p.pivot.x, dy = y - p.pivot.y;
    const u = c0 * dx + s0 * dy, v = -s0 * dx + c0 * dy;
    const su = u * p.sx, sv = v * p.sy;
    return { x: p.pivot.x + c1 * su - s1 * sv + (p.dx || 0),
      y: p.pivot.y + s1 * su + c1 * sv + (p.dy || 0) };
  };
  const p = { pivot: { x: 10, y: 10 }, frame0: 0, angle: 0, sx: 1, sy: 1, dx: 100, dy: -50 };
  const a = map(10, 10, p), b = map(30, 40, p);
  check('pivot lands at pivot + delta', a.x === 110 && a.y === -40);
  check('every point shifts by the same delta',
    b.x === 130 && b.y === -10);
  check('a zero transform is the identity',
    map(7, 9, { ...p, dx: 0, dy: 0 }).x === 7);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
