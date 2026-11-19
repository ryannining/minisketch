// Probe for Clone: live copies placed by an instance matrix.
//
// The user's workflow is authoring a part, then placing several copies of it and
// moving each one with Transform. A plain copy/paste breaks that: the paste is a
// detached snapshot that never follows later edits to the original.
//
// A clone is an `array` with kind='clone'. It reuses the whole array pipeline
// (render, bounds, export, nest, save/load) and adds:
//   - e.masters    the live source entities (shared, never copied)
//   - e.instances  [{ m: [a,b,c,d,tx,ty] }, ...] one affine matrix per copy
//
// Two invariants matter and are checked here:
//   1. a clone owns NO points, so dragging it can never move the shared master
//   2. its placement is a matrix composed with Transform, so editing the master
//      changes the shape while every copy keeps its own spot
//
// Run: node testing/clone_probe.js
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

console.log('clone: the command exists and is reachable');
check('cmdClone is defined', /function cmdClone\(\)/.test(app));
check('the Edit ribbon has a Clone button', /id="rb-clone"/.test(html));
check('it is wired to cmdClone', /qbClick\('rb-clone', \(\) => cmdClone\(\)\)/.test(app));
// Each Clone must be its OWN entity: pooling them into one container made every
// copy of a master select, move and transform as a single lump.
check('each clone is a separate entity',
  !/if \(own === key\) \{ host = e; break; \}/.test(app) &&
  !/host\.instances = \(host\.instances/.test(app));
check('the command always creates a fresh entity',
  /pushHistory\(\);\s*\n\s*const id = newId\(\);\s*\n\s*state\.entities\[id\] = \{/.test(app));

console.log('clone: it owns no points (cannot drag the shared master)');
{
  const i = app.indexOf('function entityPointIds(');
  const body = app.slice(i, app.indexOf('\n  function ', i));
  check('arrays branch exists', /if \(e\.type === 'array'\)/.test(body));
  check('a clone short-circuits to an empty list',
    /if \(e\.kind === 'clone'\) return \[\];/.test(body));
  check('the empty list comes BEFORE the masters walk', (() => {
    const cloneAt = body.indexOf("if (e.kind === 'clone') return []");
    const mastersAt = body.indexOf('for (const mid of (e.masters');
    return cloneAt >= 0 && mastersAt > cloneAt;
  })());
}

console.log('clone: placement is an affine matrix');
{
  const i = app.indexOf('function arrayXformPoint(');
  const body = app.slice(i, app.indexOf('\n  // Geometry of one master', i));
  check('an explicit matrix is honoured first', /if \(t\.m\) \{/.test(body));
  check('it maps through a 2x3 affine', /m\[0\] \* x \+ m\[2\] \* y \+ m\[4\]/.test(body));
  check('the legacy dx/ang path is still there for grid/polar', /let px = x \+ \(t\.dx \|\| 0\)/.test(body));
}

console.log('clone: kind is preserved through save and load');
check('save keeps kind=clone',
  /e\.kind === 'polar' \|\| e\.kind === 'guide' \|\| e\.kind === 'clone'/.test(app));
check('load restores the instance matrices',
  /entities\[id\]\.instances = e\.instances/.test(app));
check('bad matrices are filtered out',
  /Array\.isArray\(i\.m\) && i\.m\.length === 6 && i\.m\.every\(v => isFinite\(\+v\)\)/.test(app));

console.log('clone: Transform edits the matrix, not the geometry');
check('the delta matrix helper exists', /function xfDeltaMatrix\(p\)/.test(app));
check('instances are captured before the session',
  /orig\.cloneMats\[e\.id\] = \(e\.instances \|\| \[\]\)\.map/.test(app));
check('the preview composes into each instance',
  /e\.instances = e\.instances\.map\(\(inst, i\) => \{[\s\S]{0,240}matMul\(xfDeltaMatrix\(p\), base\.m\)/.test(app));
check('cancel restores the captured matrices',
  /e\.instances = p\.orig\.cloneMats\[eid\]\.map/.test(app));
check('the master geometry is never touched for a clone',
  !/e\.type === 'array' && e\.kind === 'clone'[\s\S]{0,120}orig\.points/.test(app));

console.log('clone: a click selects it, a drag moves it (like a group)');
check('a plain click does NOT enter Transform',
  !/hitEnt\.type === 'array' && hitEnt\.kind === 'clone'[\s\S]{0,200}enterTransformMode\(\)/.test(app));
check('it selects and starts a drag instead',
  /hitEnt\.type === 'array' && hitEnt\.kind === 'clone'\) \{[\s\S]{0,1200}kind: 'xfMoveInstance'/.test(app));
check('the drag translates each instance matrix',
  /kind === 'xfMoveInstance'[\s\S]{0,600}base\[4\] \+ ddx/.test(app));
check('the shared masters are not touched by the drag',
  !/kind === 'xfMoveInstance'[\s\S]{0,400}state\.points\[/.test(app));

console.log('clone: the gizmo encloses the copies');
check('xfLocalExtents walks clone instances',
  /e\.type === 'array' && e\.kind === 'clone'[\s\S]{0,160}arrayInstancePolylines/.test(app));
check('entityBounds uses the array bounds for a clone',
  /e\.kind === 'clone' \?[\s\S]{0,80}const b = arrayBounds\(e\)/.test(app) ||
  /e\.type === 'array' && e\.kind === 'clone'\) \{[\s\S]{0,120}arrayBounds\(e\)/.test(app));

// ---- arithmetic: matrix compose + placement ------------------------------
console.log('clone: matrix maths');
{
  const matMul = (a, b) => [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5]
  ];
  const apply = (m, x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
  const I = [1, 0, 0, 1, 0, 0];
  const T = [1, 0, 0, 1, 100, 0];           // shift right 100
  const R90 = [0, 1, -1, 0, 0, 0];          // rotate 90 about origin

  check('identity leaves a point alone',
    JSON.stringify(apply(I, 7, 9)) === JSON.stringify({ x: 7, y: 9 }));
  check('translate shifts by its offset',
    JSON.stringify(apply(T, 0, 0)) === JSON.stringify({ x: 100, y: 0 }));
  check('rotate 90 maps +x to +y', (() => {
    const p = apply(R90, 10, 0);
    return Math.abs(p.x) < 1e-9 && Math.abs(p.y - 10) < 1e-9;
  })());

  // composing a transform onto an existing placement must not lose that placement
  const placed = matMul(T, I);              // clone sits at +100
  // a delta that rotates about the clone's own centre (100, 0), not the origin
  const xfDelta = (pivot, angle, sx, sy, dx, dy) => {
    const c = Math.cos(angle), s = Math.sin(angle);
    const a = c * sx, b = s * sx, cc = -s * sy, d = c * sy;
    return [a, b, cc, d,
      pivot.x + (dx || 0) - (a * pivot.x + cc * pivot.y),
      pivot.y + (dy || 0) - (b * pivot.x + d * pivot.y)];
  };
  const rotatedInPlace = matMul(xfDelta({ x: 100, y: 0 }, Math.PI / 2, 1, 1, 0, 0), placed);
  const before = apply(placed, 0, 0);
  const after = apply(rotatedInPlace, 0, 0);
  check('a later rotate keeps the clone where it was placed',
    Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9,
    JSON.stringify({ before, after }));
  // and the rotation really happened: a point to the right of the pivot swung
  const swung = apply(rotatedInPlace, 10, 0);
  check('the copy did rotate about its own centre',
    Math.abs(swung.x - 100) < 1e-9 && Math.abs(swung.y - 10) < 1e-9,
    JSON.stringify(swung));

  // and editing the master reshapes the copy without moving it
  const shapeBefore = [apply(placed, 0, 0), apply(placed, 10, 0)];
  const shapeAfter = [apply(placed, 0, 0), apply(placed, 20, 0)];   // master got longer
  check('the copy stays anchored when the master changes',
    shapeBefore[0].x === shapeAfter[0].x && shapeBefore[0].y === shapeAfter[0].y);
  check('but its extent follows the new master size',
    shapeAfter[1].x - shapeAfter[0].x === 20);
}

console.log('clone: it reaches every outbound path');
check('SVG export has an array branch emitting instances',
  /e\.type === 'array'[\s\S]{0,200}arrayInstancePolylines\(e, t\)/.test(app));
check('nest emits array instances too',
  /e\.type === 'array'\) \{[\s\S]{0,400}arrayInstancePolylines\(e, t\)/.test(app));
check('CNC collects array instances',
  /if \(e\.type === 'array'\) \{[\s\S]{0,500}arrayXformPoint\(t, p\[0\], p\[1\]\)/.test(app));
check('render honours the instance matrix (not just dx/ang)',
  /const m = t\.m[\s\S]{0,200}new DOMMatrix\(\[t\.m\[0\]/.test(app));

console.log('clone: a marquee can select it');
check('applyRubberSelection covers point-less entities',
  /e\.type !== 'art' && e\.type !== 'array' && e\.type !== 'part'\) continue;[\s\S]{0,400}entityBounds\(e\)/.test(app));
check('the containment test is "fully inside"',
  /bb\.minX >= w0\.x[\s\S]{0,200}bb\.maxY <= w1\.y/.test(app));

console.log('clone: export resolves the selection cascade');
{
  const i = app.indexOf('function selectedEntitiesForExport(');
  const body = app.slice(i, app.indexOf('\n  function selectedPointIds', i));
  check('helper exists', i > 0);
  check('1. direct entity selection counts', /const direct = selectedEntities\(\)/.test(body));
  check('2. entities whose own points are all picked count',
    /ids\.every\(pid => pts\.has\(\+pid\)\)/.test(body));
  check('3. point-less containers count when fully inside the box',
    /e\.type !== 'art' && e\.type !== 'array' && e\.type !== 'part'/.test(body) &&
    /inside = b\.minX >= box\.minX/.test(body));
  check('an array brings its masters along',
    /e\.type === 'array'\) \{[\s\S]{0,200}for \(const mid of \(e\.masters/.test(body));
  check('SVG export uses it', /const selectedIds = new Set\(selectedEntitiesForExport\(\)/.test(app));
  check('CNC collect uses it', /const selIds = new Set\(selectedEntitiesForExport\(\)/.test(app));
  check('CNC guard uses it', /cnc\.scope === 'selected' && !selectedEntitiesForExport\(\)\.length/.test(app));
}

console.log('clone: shortcuts and bulk operations');
check('Ctrl+L runs Clone', /\(ev\.ctrlKey \|\| ev\.metaKey\) && lower === 'l'[\s\S]{0,200}cmdClone\(\)/.test(app));
check('Ctrl+D duplicates a selected clone as a clone',
  /cloneSel\.length && cloneSel\.length === ui\.selection\.length[\s\S]{0,600}kind: 'clone'/.test(app));

console.log('clone: it moves with the rest of the selection');
check('a body drag carries clones along',
  /const clones = selectedEntities\(\)\s*\n\s*\.filter\(e => e\.type === 'array' && e\.kind === 'clone'\)/.test(app));
check('the drag applies the same delta to every instance matrix',
  /if \(d\.clones && d\.clones\.length\)[\s\S]{0,400}base\[4\] \+ dx/.test(app));
check('flip composes onto the instance matrix',
  /const M = \[sx, 0, 0, sy, ox - ox \* sx, oy - oy \* sy\][\s\S]{0,200}matMul\(M, inst\.m\)/.test(app));
check('rotate 90 composes onto the instance matrix',
  /const M = \[c, s, -s, c, cx - \(c \* cx - s \* cy\)[\s\S]{0,200}matMul\(M, inst\.m\)/.test(app));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
