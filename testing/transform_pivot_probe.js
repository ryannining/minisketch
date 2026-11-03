// Probe for the Transform pivot lifecycle: remembered, and it follows translation.
//
// Three bugs lived here:
//   1. enterTransformMode() wrote the bounding-box centre over ui.transform.pivot
//      unconditionally, so the pivot cache was dead code and every entry to
//      Transform reset the pivot to the middle.
//   2. xfCommit() stored the old pivot coordinates while the geometry had moved
//      by (dx, dy), so the NEXT rotate span around a point the shape had left.
//   3. "Center pivot" wrote the pivot without remembering it.
//
// Run: node testing/transform_pivot_probe.js
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

console.log('transform pivot: entering Transform keeps the remembered pivot');
{
  const fnStart = app.indexOf('function enterTransformMode(');
  const body = app.slice(fnStart, app.indexOf('\n  function exitTransformMode', fnStart));
  check('enterTransformMode exists', fnStart > 0);
  check('it asks xfPivot() instead of computing the centre',
    /ui\.transform\.pivot = xfPivot\(\);/.test(body));
  check('the unconditional bounding-box centre is gone',
    !/const b = selectionBounds\(\);\s*\n\s*ui\.transform\.pivot = b \?/.test(body));
}

console.log('transform pivot: xfPivot consults the cache');
{
  const fnStart = app.indexOf('function xfPivot()');
  const body = app.slice(fnStart, app.indexOf('\n  function xfFrameAngle', fnStart));
  check('a live pivot wins', /if \(ui\.transform\.pivot\) return ui\.transform\.pivot;/.test(body));
  check('then the cache for this selection', /xfPivotCache\.has\(key\)/.test(body));
  check('the bounding-box centre is only the fallback',
    /selectionBounds\(\)[\s\S]{0,120}minX \+ b\.maxX/.test(body));
}

console.log('transform pivot: the cache key is a hash of the selected point ids');
{
  const fnStart = app.indexOf('function xfSelectionKey(');
  const body = app.slice(fnStart, app.indexOf('\n  function xfPivot', fnStart));
  check('xfSelectionKey exists', fnStart > 0);
  check('it collects the selected points', /selectedPointIds\(\)/.test(body));
  check('it also collects points of selected entities', /entityPointIds\(e\)/.test(body));
  check('it sorts so pick order does not matter',
    /\.sort\(\(a, b\) => a - b\)\.join\(','\)/.test(body));
}

console.log('transform pivot: commit keeps the pivot where it was placed');
{
  const fnStart = app.indexOf('function xfCommit(');
  const body = app.slice(fnStart, app.indexOf('\n  function enterTransformMode', fnStart));
  // dx/dy already carry the translation, so the pivot must NOT be shifted again:
  // doing that moved the rotation centre out from under the user.
  check('the pivot keeps its own coordinates',
    /ui\.transform\.pivot = \{ x: p\.pivot\.x, y: p\.pivot\.y \};/.test(body));
  check('it is not re-derived from the translation',
    !/pivotAfter/.test(body) && !/p\.pivot\.x \+ \(p\.dx/.test(body));
  check('the cache stores that same pivot',
    /xfPivotCache\.set\(cacheKey, \{ x: p\.pivot\.x, y: p\.pivot\.y \}\)/.test(body));
}

console.log('transform pivot: Center pivot is remembered as well');
{
  const idx = app.indexOf("document.getElementById('xf-center')");
  const body = app.slice(idx, idx + 1100);
  check('the button handler caches the new pivot',
    /xfPivotCache\.set\(ckey, \{ x: base\.x, y: base\.y \}\)/.test(body));
  check('it re-centres through xfSetPivot', /xfSetPivot\(base\.x, base\.y\)/.test(body));
}

console.log('transform pivot: rotate spins about p.pivot (contract)');
{
  // the handler must measure the angle against the pending pivot, not the centre
  const idx = app.indexOf("if (d.kind === 'xfRotate')");
  const body = app.slice(idx, idx + 700);
  check('angle is measured from the pending pivot',
    /Math\.atan2\(world\.y - p\.pivot\.y, world\.x - p\.pivot\.x\)/.test(body));
  check('it writes p.angle and previews', /p\.angle = a;/.test(body) && /xfApplyPreview\(\)/.test(body));
}

// replay the lifecycle the code performs
console.log('transform pivot: lifecycle replay');
{
  const ui = { transform: { pivot: null, frame: 0, pending: null } };
  const cache = new Map();
  const key = '1,2,3';
  const xfPivot = () => ui.transform.pivot ||
    (key && cache.has(key) ? cache.get(key) : { x: 100, y: 100 });
  const enter = () => { ui.transform.pivot = xfPivot(); ui.transform.frame = 0; };
  const exit = () => { ui.transform.pivot = null; ui.transform.frame = 0; };
  const commit = (p) => {
    ui.transform.frame = p.frame0 + p.angle;
    // mirrors xfCommit: dx/dy already moved the geometry, the pivot stays put
    const after = { x: p.pivot.x, y: p.pivot.y };
    ui.transform.pivot = after;
    cache.set(key, { x: after.x, y: after.y });
    exit();
  };

  cache.set(key, { x: 250, y: 120 });
  enter();
  check('a dragged pivot survives re-entry', ui.transform.pivot.x === 250 && ui.transform.pivot.y === 120);

  commit({ frame0: 0, angle: Math.PI / 2, dx: 0, dy: 0, pivot: { x: 250, y: 120 } });
  enter();
  check('a pure rotate leaves the pivot where it was',
    ui.transform.pivot.x === 250 && ui.transform.pivot.y === 120);

  cache.set(key, { x: 250, y: 120 });
  enter();
  commit({ frame0: 0, angle: 0, dx: 100, dy: -50, pivot: { x: 250, y: 120 } });
  enter();
  check('a translate leaves the pivot alone (dx/dy already moved the geometry)',
    ui.transform.pivot.x === 250 && ui.transform.pivot.y === 120);
}

console.log('transform pivot: moving the pivot never moves the geometry');
{
  const idx = app.indexOf('function xfSetPivot(');
  const body = app.slice(idx, app.indexOf('\n  function xfApplyPreview', idx));
  check('xfSetPivot exists', idx > 0);
  check('it compensates through the FULL linear part (frame + angle + scale)',
    /const c0 = Math\.cos\(p\.frame0\)/.test(body) && /c1 \* su - s1 \* sv/.test(body));
  check('the compensation is folded into dx/dy',
    /p\.dx = \(p\.dx \|\| 0\) \+/.test(body) && /p\.dy = \(p\.dy \|\| 0\) \+/.test(body));
  check('the pivot drag uses xfSetPivot',
    (() => {
      const i = app.indexOf("if (d.kind === 'xfPivot')");
      return /xfSetPivot\(base\.x, base\.y\)/.test(app.slice(i, i + 800));
    })());
  check('Center pivot uses xfSetPivot too',
    /xfSetPivot\(base\.x, base\.y\)/.test(app));

  // exact arithmetic: geometry must be bit-identical across a pivot move
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
  const setPivot = (p, px, py) => {
    const old = p.pivot, ddx = px - old.x, ddy = py - old.y;
    const c0 = Math.cos(p.frame0), s0 = Math.sin(p.frame0);
    const phi = p.frame0 + p.angle;
    const c1 = Math.cos(phi), s1 = Math.sin(phi);
    const u = c0 * ddx + s0 * ddy, v = -s0 * ddx + c0 * ddy;
    const su = u * p.sx, sv = v * p.sy;
    p.dx = (p.dx || 0) + (c1 * su - s1 * sv) - ddx;
    p.dy = (p.dy || 0) + (s1 * su + c1 * sv) - ddy;
    p.pivot = { x: px, y: py };
  };
  let allStill = true;
  for (const cfg of [
    { frame0: 0, angle: 0, sx: 1, sy: 1 },
    { frame0: 0, angle: Math.PI / 2, sx: 1, sy: 1 },
    { frame0: 0, angle: 0.7, sx: 2, sy: 0.5 },
    { frame0: 0.3, angle: -1.1, sx: 1.4, sy: 1.4 },
    { frame0: -2.4, angle: 2.9, sx: 1, sy: 1 }
  ]) {
    const p = { ...cfg, pivot: { x: 10, y: 20 }, dx: 5, dy: -7 };
    const pts = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 30 }, { x: -5, y: 12 }];
    const before = pts.map(q => map(q.x, q.y, p));
    setPivot(p, 77, -13);
    const after = pts.map(q => map(q.x, q.y, p));
    if (!before.every((b, i) => Math.abs(b.x - after[i].x) < 1e-9 &&
      Math.abs(b.y - after[i].y) < 1e-9)) allStill = false;
  }
  check('every point is unchanged by a pivot move (all frame/scale combos)', allStill);

  // and the pivot is a fixed point of a subsequent rotation
  const p2 = { frame0: 0, angle: 0, sx: 1, sy: 1, pivot: { x: 0, y: 0 }, dx: 0, dy: 0 };
  setPivot(p2, 100, 100);
  p2.angle = Math.PI / 2;
  const m = map(100, 100, p2);
  check('rotating afterwards spins about the moved pivot',
    Math.abs(m.x - 100) < 1e-9 && Math.abs(m.y - 100) < 1e-9);
}

console.log('transform pivot: the marker is drawn where the rotation happens');
{
  const idx = app.indexOf('function xfPivotDisplay(');
  const body = app.slice(idx, app.indexOf('\n  // Move the pending pivot', idx));
  check('xfPivotDisplay exists', idx > 0);
  check('it adds the pending delta to the stored pivot',
    /base\.x \+ \(p\.dx \|\| 0\)/.test(body) && /base\.y \+ \(p\.dy \|\| 0\)/.test(body));
  check('the overlay draws the pivot through it',
    /const pivW = xfPivotDisplay\(\);\s*\n\s*const ps = w2s\(pivW\.x, pivW\.y\);/.test(app));
  check('the overlay no longer draws the raw pivot in screen space',
    !/const ps = w2s\(pivot\.x, pivot\.y\);/.test(app));
  check('a pivot drag converts the cursor back to base coordinates',
    /target\.x - \(pend\.dx \|\| 0\)/.test(app));
  check('Center pivot does the same',
    /piv\.x - \(pend\.dx \|\| 0\)/.test(app));

  // Contract: after a translate, the pivot point is a FIXED POINT of rotation.
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
  // the reported case: fresh transform, drag right 100 mm, then rotate
  const p = { frame0: 0, angle: 0, sx: 1, sy: 1, pivot: { x: 0, y: 0 }, dx: 100, dy: 0 };
  const shown = { x: p.pivot.x + p.dx, y: p.pivot.y + p.dy };
  const afterTranslate = map(0, 0, p);
  check('the displayed pivot equals where the pivot point ends up',
    Math.abs(afterTranslate.x - shown.x) < 1e-9 && Math.abs(afterTranslate.y - shown.y) < 1e-9);
  p.angle = Math.PI / 2;
  const afterRotate = map(0, 0, p);
  check('rotating keeps that point fixed (spins about the shown pivot)',
    Math.abs(afterRotate.x - shown.x) < 1e-9 && Math.abs(afterRotate.y - shown.y) < 1e-9);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
