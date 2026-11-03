// Probe for the offset math (Ctrl+O).
// Slices signedAreaPts / pointInPoly / lineIntersect / offsetOneContour /
// offsetChains / rdpSimplify out of ../app.js.
//
// Run: node testing/offset_probe.js
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
  let i = appSrc.indexOf('(', start), depth = 0;
  for (; i < appSrc.length; i++) {
    if (appSrc[i] === '(') depth++;
    else if (appSrc[i] === ')') { depth--; if (!depth) break; }
  }
  return appSrc.slice(start, braceEnd(appSrc, i));
};

const ClipperLib = require(path.join(__dirname, '..', 'tools', 'clipper.js'));
// pointInPoly moved to core.js (pure math); app.js only re-exports it
const Core = require(path.join(__dirname, '..', 'core.js'));
const sliceAppOrCore = (name) => {
  try { return sliceApp(name); } catch (err) { return Core[name].toString(); }
};
const api = new Function(
  'ClipperLib', 'toast',
  "const OFFSET_SCALE = 1000; const OFFSET_PRECISION = 0.001;" +
  "const OFFSET_MITER = 4, OFFSET_TOL = 0.05, SPLINE_SEG = 12, ARC_SEG = 72; " +
  "const CIRCLE_CHORD = 1.5, BAKE_JOIN_TOL = 0.1, ART_TOL_MM = 0.1;" + '\n' +
  "let OFFSET_JOIN = String.fromCharCode(115,104,97,114,112), OFFSET_ARC_TOL = 0.05; " +
  ['rdpSimplify', 'pointInPoly', 'signedAreaPts', 'lineIntersect', 'interiorProbe',
    'offsetOpenChain', 'clipperLib', 'offsetClosedChains', 'normalizeWinding', 'offsetChains']
    .map(sliceAppOrCore).join('\n') +
  '\nreturn { rdpSimplify, signedAreaPts, pointInPoly, lineIntersect, interiorProbe, offsetOpenChain, offsetClosedChains, offsetChains, setJoin(v) { OFFSET_JOIN = v; } };'
)(ClipperLib, () => {});

const P = (x, y) => ({ x, y });
const square = (x0, y0, size) => [
  P(x0, y0), P(x0 + size, y0), P(x0 + size, y0 + size), P(x0, y0 + size)
];
const bbox = (pts) => pts.reduce((a, p) => ({
  minX: Math.min(a.minX, p.x), maxX: Math.max(a.maxX, p.x),
  minY: Math.min(a.minY, p.y), maxY: Math.max(a.maxY, p.y)
}), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-6 : tol);

console.log('\n== basics ==');
check('signed area of a CCW square is positive', near(api.signedAreaPts(square(0, 0, 10)), 100), api.signedAreaPts(square(0, 0, 10)));
check('reversed winding flips the sign', near(api.signedAreaPts(square(0, 0, 10).slice().reverse()), -100));
check('point inside', api.pointInPoly(P(5, 5), square(0, 0, 10)) === true);
check('point outside', api.pointInPoly(P(15, 5), square(0, 0, 10)) === false);
check('line intersection', (() => {
  const h = api.lineIntersect(P(0, 0), P(1, 0), P(5, -5), P(0, 1));
  return h && near(h.x, 5) && near(h.y, 0);
})());
check('parallel lines have no intersection',
  api.lineIntersect(P(0, 0), P(1, 0), P(0, 5), P(1, 0)) === null);

console.log('\n== a closed square grows and shrinks ==');
{
  const out = api.offsetChains([{ pts: square(0, 0, 100), closed: true }], 10, { tol: 0.05 });
  check('one contour comes back', out.length === 1, out.length);
  const b = bbox(out[0].pts);
  check('grows by 10 on every side',
    near(b.minX, -10, 1e-6) && near(b.maxX, 110, 1e-6) && near(b.minY, -10, 1e-6) && near(b.maxY, 110, 1e-6),
    JSON.stringify(b));
  check('stays closed', out[0].closed === true);
  check('corners stay corners (4 points after simplification)', out[0].pts.length === 4, out[0].pts.length);
}
{
  const out = api.offsetChains([{ pts: square(0, 0, 100), closed: true }], -10, { tol: 0.05 });
  const b = bbox(out[0].pts);
  check('a negative distance shrinks',
    near(b.minX, 10, 1e-6) && near(b.maxX, 90, 1e-6), JSON.stringify(b));
}
{
  const out = api.offsetChains([{ pts: square(0, 0, 100), closed: true }], 0, { tol: 0.05 });
  const b = bbox(out[0].pts);
  check('zero distance leaves it alone',
    near(b.minX, 0, 1e-9) && near(b.maxX, 100, 1e-9), JSON.stringify(b));
}
{
  const cw = square(0, 0, 100).slice().reverse();
  const out = api.offsetChains([{ pts: cw, closed: true }], 10, { tol: 0.05 });
  const b = bbox(out[0].pts);
  check('winding does not matter: clockwise also grows',
    near(b.minX, -10, 1e-6) && near(b.maxX, 110, 1e-6), JSON.stringify(b));
}

console.log('\n== a hole shrinks when the shape grows ==');
{
  const outer = square(0, 0, 100);
  const hole = [P(40, 40), P(60, 40), P(60, 60), P(40, 60)];      // 20 x 20
  const out = api.offsetChains([
    { pts: outer, closed: true },
    { pts: hole, closed: true }
  ], 5, { tol: 0.05 });
  check('both contours survive a small offset', out.length === 2, out.length);
  const bOuter = bbox(out[0].pts);
  const bHole = bbox(out[1].pts);
  check('the island grows', near(bOuter.minX, -5, 1e-6) && near(bOuter.maxX, 105, 1e-6), JSON.stringify(bOuter));
  check('the hole shrinks', near(bHole.minX, 45, 1e-6) && near(bHole.maxX, 55, 1e-6), JSON.stringify(bHole));
}
{
  const outer = square(0, 0, 100);
  const hole = [P(40, 40), P(60, 40), P(60, 60), P(40, 60)];
  const out = api.offsetChains([
    { pts: outer, closed: true },
    { pts: hole, closed: true }
  ], 15, { tol: 0.05 });
  check('a hole that would invert is dropped, not drawn inside out', out.length === 1, out.length);
}

console.log('\n== open chains stay open ==');
{
  const line = [P(0, 0), P(100, 0)];
  const out = api.offsetChains([{ pts: line, closed: false }], 10, { tol: 0.05 });
  check('a line offsets into a parallel line', out.length === 1 && out[0].closed === false);
  check('shifted by 10 perpendicular',
    near(out[0].pts[0].y, out[0].pts[1].y) && near(Math.abs(out[0].pts[0].y), 10, 1e-6),
    JSON.stringify(out[0].pts));
  check('still 2 points', out[0].pts.length === 2, out[0].pts.length);
}
{
  const l = [P(0, 0), P(100, 0), P(100, 100)];
  const out = api.offsetChains([{ pts: l, closed: false }], 10, { tol: 0.05 });
  check('an L keeps its corner count', out[0].pts.length === 3, out[0].pts.length);
  check('and stays open', out[0].closed === false);
}

console.log('\n== miter limit ==');
{
  // a very sharp spike: the miter would run far away
  const spike = [P(0, 0), P(100, 0), P(0, 6)];
  const out = api.offsetChains([{ pts: spike, closed: true }], 4, { tol: 0.01, miterLimit: 2 });
  const sb = bbox(out[0].pts);
  const rail = 4 * 2 + 1e-6;                      // miterLimit * |dist|
  check('a sharp corner is bevelled instead of spiking',
    sb.minX >= -6 - rail && sb.maxX <= 100 + rail && sb.maxY <= 6 + rail,
    JSON.stringify(sb));
}

console.log('\n== simplify keeps the shape ==');
{
  const many = [];
  const n = 64;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    many.push(P(50 + 40 * Math.cos(t), 50 + 40 * Math.sin(t)));
  }
  // accurate run: tight tolerance keeps every vertex of the ring
  let out = api.offsetChains([{ pts: many, closed: true }], 5, { tol: 0.05 });
  let b = bbox(out[0].pts);
  check('a 64-gon circle grows by 5',
    near(b.minX, 5, 0.1) && near(b.maxX, 95, 0.1) && near(b.minY, 5, 0.1) && near(b.maxY, 95, 0.1),
    JSON.stringify(b));
  // loose tolerance: Clipper keeps collinear points, our RDP has to thin them
  out = api.offsetChains([{ pts: many, closed: true }], 5, { tol: 0.5 });
  b = bbox(out[0].pts);
  check('and is simplified when the tolerance allows it', out[0].pts.length < n, out[0].pts.length);
  check('without moving the outline more than the tolerance',
    near(b.minX, 5, 0.6) && near(b.maxX, 95, 0.6), JSON.stringify(b));
}

console.log('\n== corner style ==');
{
  const sq = square(0, 0, 100);
  api.setJoin('sharp');
  const sharp = api.offsetChains([{ pts: sq, closed: true }], 10, { tol: 0.02 });
  check('sharp corners keep four vertices', sharp[0].pts.length === 4, sharp[0].pts.length);
  check('and reach the mitre distance', near(bbox(sharp[0].pts).minX, -10, 1e-6),
    JSON.stringify(bbox(sharp[0].pts)));

  api.setJoin('round');
  const round = api.offsetChains([{ pts: sq, closed: true }], 10, { tol: 0.02 });
  check('rounded corners add points', round[0].pts.length > 4, round[0].pts.length);
  check('the straight sides are still offset by 10',
    near(Math.abs(bbox(round[0].pts).minY), 10, 0.06), JSON.stringify(bbox(round[0].pts)));

  api.setJoin('square');
  const beh = api.offsetChains([{ pts: sq, closed: true }], 10, { tol: 0.02 });
  check('squared corners are bevels, not mitres', bbox(beh[0].pts).minX > -10.01,
    JSON.stringify(bbox(beh[0].pts)));

  api.setJoin('sharp');
}

console.log('\n== several chains at once ==');
{
  const out = api.offsetChains([
    { pts: square(0, 0, 20), closed: true },
    { pts: square(100, 0, 20), closed: true },
    { pts: [P(0, 100), P(50, 100)], closed: false }
  ], 2, { tol: 0.05 });
  check('all three come back', out.length === 3, out.length);
  // Clipper does not promise an order, so sort the two islands by their left edge
  const mins = out.filter(c => c.closed).map(c => bbox(c.pts).minX).sort((a, b) => a - b);
  check('the two islands grew', near(mins[0], -2, 1e-6) && near(mins[1], 98, 1e-6), JSON.stringify(mins));
  check('the open chain is preserved as open', out[2].closed === false);
}
{
  const out = api.offsetChains([{ pts: square(0, 0, 10), closed: true }], -20, { tol: 0.05 });
  check('offsetting a shape to death yields nothing', out.length === 0, out.length);
}

console.log('\n' + (fail ? (fail + ' FAILED, ' + pass + ' passed') : ('all ' + pass + ' checks passed')));
process.exit(fail ? 1 : 0);
