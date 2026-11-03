// Probe for pasted artwork: SVG path parsing and the frame maths.
// Slices parsePathData / svgTextToPaths / artLocalOf / artInside / artPointCount
// out of ../app.js and runs them without a DOM or a canvas.
//
// Run: node testing/art_probe.js
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

const api = new Function(
  sliceApp('parsePathData') + '\n' +
  sliceApp('svgTextToPaths') + '\n' +
  sliceApp('artLocalOf') + '\n' +
  sliceApp('artPointCount') + '\n' +
  sliceApp('artInside') + '\n' +
  'return { parsePathData, svgTextToPaths, artLocalOf, artInside, artPointCount };'
)();

const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-6 : tol);

// --- 1. straight commands ------------------------------------------------
console.log('\n== M / L / H / V / Z ==');
let subs = api.parsePathData('M0 0 L10 0 L10 10 Z');
check('one subpath', subs.length === 1, subs.length);
check('closed subpath repeats its first point',
  subs[0].length === 4 && near(subs[0][3][0], 0) && near(subs[0][3][1], 0), JSON.stringify(subs[0]));
check('corner coordinates', near(subs[0][1][0], 10) && near(subs[0][2][1], 10));

subs = api.parsePathData('M0,0 H10 V10 H0 Z');
check('H/V build the same square', subs.length === 1 && near(subs[0][2][0], 10) && near(subs[0][2][1], 10),
  JSON.stringify(subs[0]));

console.log('\n== relative commands ==');
subs = api.parsePathData('m5 5 l10 0 l0 10 l-10 0 z');
check('relative move + lines', subs.length === 1 && subs[0].length === 5, subs[0] && subs[0].length);
check('starts at 5,5', near(subs[0][0][0], 5) && near(subs[0][0][1], 5), JSON.stringify(subs[0][0]));
check('third corner at 15,15', near(subs[0][2][0], 15) && near(subs[0][2][1], 15), JSON.stringify(subs[0][2]));
check('fourth corner back to 5,15', near(subs[0][3][0], 5) && near(subs[0][3][1], 15), JSON.stringify(subs[0][3]));

console.log('\n== several subpaths in one d ==');
subs = api.parsePathData('M0 0 L5 0 L5 5 Z M10 0 L15 0 L15 5 Z');
check('two subpaths', subs.length === 2, subs.length);
check('second subpath starts at 10,0', near(subs[1][0][0], 10));

// --- 2. curves become polylines ----------------------------------------
console.log('\n== cubic / quadratic / smooth ==');
subs = api.parsePathData('M0 0 C0 10 10 10 10 0');
check('cubic is flattened to points', subs[0].length > 6, subs[0].length);
check('cubic ends on its end point',
  near(subs[0][subs[0].length - 1][0], 10, 1e-6) && near(subs[0][subs[0].length - 1][1], 0, 1e-6),
  JSON.stringify(subs[0][subs[0].length - 1]));
check('cubic bulges below the chord', Math.max(...subs[0].map(p => p[1])) > 5);

subs = api.parsePathData('M0 0 Q5 10 10 0');
check('quadratic is flattened', subs[0].length > 5 && Math.max(...subs[0].map(p => p[1])) > 3);

subs = api.parsePathData('M0 0 C0 10 10 10 10 0 S20 -10 20 0');
check('S continues smoothly (still one subpath)', subs.length === 1 && subs[0].length > 12, subs[0].length);

// --- 3. arcs -----------------------------------------------------------
console.log('\n== arc ==');
subs = api.parsePathData('M0 0 A10 10 0 0 1 20 0');
check('arc ends exactly on the end point',
  near(subs[0][subs[0].length - 1][0], 20, 1e-3) && near(subs[0][subs[0].length - 1][1], 0, 1e-3),
  JSON.stringify(subs[0][subs[0].length - 1]));
// sweep=1 runs in the positive-angle direction, which in SVG's y-down space
// means the arc bulges towards negative y
const minY = Math.min(...subs[0].map(p => p[1]));
check('arc bulges by the radius (sweep 1)', minY > -11 && minY < -9, minY);
check('arc stays on or above the chord', Math.max(...subs[0].map(p => p[1])) <= 1e-9);
check('arc has several points', subs[0].length > 6, subs[0].length);

// --- 4. SVG wrapper ----------------------------------------------------
console.log('\n== <svg> wrapper ==');
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
  '<path d="M0 0 L10 0 L10 10 Z" fill="#000"/><path d="M20 0 L30 0 L30 10 Z"/></svg>';
subs = api.svgTextToPaths(svg);
check('both paths found', subs.length === 2, subs.length);
check('svgTextToPaths survives a broken document',
  api.svgTextToPaths('<svg><path d="M0 0 L4 0 L4 4 Z"') .length === 1);

// --- 5. frame maths ----------------------------------------------------
console.log('\n== affine frame ==');
// p0 = top-left, A = (100,0) width, B = (0,-50) height pointing down
const gg = { p0: { x: 0, y: 0 }, A: { x: 100, y: 0 }, B: { x: 0, y: -50 }, w: 100, h: 50 };
let loc = api.artLocalOf(gg, { x: 50, y: -25 });
check('centre of the frame maps to 0.5, 0.5', near(loc.u, 0.5) && near(loc.v, 0.5), JSON.stringify(loc));
loc = api.artLocalOf(gg, { x: 100, y: 0 });
check('bottom-right corner maps to 1, 0', near(loc.u, 1) && near(loc.v, 0), JSON.stringify(loc));
const skewed = { p0: { x: 0, y: 0 }, A: { x: 100, y: 0 }, B: { x: 20, y: -50 }, w: 100, h: 50 };
loc = api.artLocalOf(skewed, { x: 70, y: -25 });
// u*100 + v*20 = 70 and v*-50 = -25  ->  v = 0.5, u = 0.6
check('skewed frame accounts for the shear', near(loc.u, 0.6) && near(loc.v, 0.5), JSON.stringify(loc));

// --- 6. even-odd hit test ---------------------------------------------
console.log('\n== inside / hole ==');
const square = [[0, 0], [1, 0], [1, 1], [0, 1]];
const hole = [[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]];
const art = { contours: [square, hole] };
check('inside the ring is inside', api.artInside(gg, art, { u: 0.1, v: 0.1 }) === true);
check('the counter (hole) is not inside', api.artInside(gg, art, { u: 0.5, v: 0.5 }) === false);
check('outside the frame is not inside', api.artInside(gg, art, { u: 1.2, v: 0.5 }) === false);
check('point count adds up', api.artPointCount(art) === 8, api.artPointCount(art));

console.log('\n' + (fail ? (fail + ' FAILED, ' + pass + ' passed') : ('all ' + pass + ' checks passed')));
process.exit(fail ? 1 : 0);
