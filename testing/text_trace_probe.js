// Probe for the glyph tracer (no canvas needed).
// Slices traceAlphaContours / chainSegments / traceKey / rdpSimplify out of
// ../app.js and runs them on synthetic alpha grids.
//
// Run: node testing/text_trace_probe.js
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
  sliceApp('traceKey') + '\n' +
  sliceApp('polyAreaOf') + '\n' +
  sliceApp('pointInLoop') + '\n' +
  sliceApp('orientContours') + '\n' +
  sliceApp('chainSegments') + '\n' +
  sliceApp('rdpSimplify') + '\n' +
  sliceApp('traceAlphaContours') + '\n' +
  'return { traceAlphaContours, chainSegments, rdpSimplify, traceKey };'
)();

// --- helpers -------------------------------------------------------------
const W = 64, H = 64;
function blank() {
  const d = new Uint8ClampedArray(W * H * 4);
  return d;
}
function fillRect(d, x0, y0, x1, y1, v) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) d[(y * W + x) * 4 + 3] = v;
  }
}
const area = (loop) => {
  let s = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
};
const signedArea = (loop) => {
  let s = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
};
const isClosedLoop = (loop) => loop.length >= 3 &&
  !(loop[0][0] === loop[loop.length - 1][0] && loop[0][1] === loop[loop.length - 1][1]);

// --- 1. solid rectangle ------------------------------------------------
console.log('\n== solid rectangle ==');
let d = blank();
fillRect(d, 16, 16, 48, 48, 255);
let loops = api.traceAlphaContours(d, W, H, 128);
check('one contour', loops.length === 1, loops.length);
check('no duplicated closing point', isClosedLoop(loops[0]));
console.log('  points:', loops[0].length, 'area:', area(loops[0]).toFixed(2));
check('outline sits on the pixel border (32x32)', Math.abs(area(loops[0]) - 32 * 32) < 4, area(loops[0]));
const simplified = api.rdpSimplify(loops[0].concat([loops[0][0]]), 0.6);
check('simplifies to a clean rectangle (<=6 pts)', simplified.length <= 6, simplified.length);
check('corners land on the rect edge',
  Math.abs(simplified[0][0] - 15.5) < 1.5 || Math.abs(simplified[0][0] - 16) < 1.5, simplified[0]);

// --- 2. rectangle with a hole -----------------------------------------
console.log('\n== rectangle with a hole (like the counter of an "o") ==');
d = blank();
fillRect(d, 8, 8, 56, 56, 255);
fillRect(d, 24, 24, 40, 40, 0);
loops = api.traceAlphaContours(d, W, H, 128);
check('two contours', loops.length === 2, loops.length);
if (loops.length === 2) {
  const sorted = loops.slice().sort((a, b) => area(b) - area(a));
  console.log('  outer area:', area(sorted[0]).toFixed(2), ' hole area:', area(sorted[1]).toFixed(2));
  check('outer area ~48x48', Math.abs(area(sorted[0]) - 48 * 48) < 8, area(sorted[0]));
  check('hole area ~16x16', Math.abs(area(sorted[1]) - 16 * 16) < 8, area(sorted[1]));
  check('outer and hole run in opposite directions (filled stays on the left)',
    Math.sign(signedArea(sorted[0])) !== Math.sign(signedArea(sorted[1])),
    [signedArea(sorted[0]), signedArea(sorted[1])]);
}

// --- 3. disc -----------------------------------------------------------
console.log('\n== round shape (like an "o" or "c") ==');
d = blank();
const R = 18, cx = 32, cy = 32;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= R) d[(y * W + x) * 4 + 3] = 255;
  }
}
loops = api.traceAlphaContours(d, W, H, 128);
check('one contour', loops.length === 1, loops.length);
console.log('  points:', loops[0].length, 'area:', area(loops[0]).toFixed(2), 'circle area:', (Math.PI * R * R).toFixed(2));
check('area is close to pi*r^2', Math.abs(area(loops[0]) - Math.PI * R * R) / (Math.PI * R * R) < 0.03,
  area(loops[0]));
const smooth = api.rdpSimplify(loops[0].concat([loops[0][0]]), 0.55);
console.log('  after simplify @0.55px:', smooth.length, 'points');
check('simplify keeps a usable outline (>=8 points)', smooth.length >= 8, smooth.length);
check('simplify keeps the area', Math.abs(area(smooth.slice(0, -1)) - area(loops[0])) / area(loops[0]) < 0.03,
  area(smooth.slice(0, -1)));

// --- 4. two separate islands ------------------------------------------
console.log('\n== two separate islands (two glyphs) ==');
d = blank();
fillRect(d, 6, 20, 20, 34, 255);
fillRect(d, 40, 20, 54, 34, 255);
loops = api.traceAlphaContours(d, W, H, 128);
check('two contours', loops.length === 2, loops.length);
check('both are closed', loops.every(isClosedLoop));

// --- 5. empty grid -----------------------------------------------------
console.log('\n== empty grid ==');
d = blank();
check('no contours', api.traceAlphaContours(d, W, H, 128).length === 0);

// --- 6. rdp edge cases -------------------------------------------------
console.log('\n== rdp edge cases ==');
const line = [[0, 0], [2, 0], [4, 0], [6, 0], [6, 6]];
check('collinear points are dropped', api.rdpSimplify(line, 0.01).length === 3, api.rdpSimplify(line, 0.01).length);
check('a corner is kept', api.rdpSimplify(line, 0.01).some(p => p[0] === 6 && p[1] === 6));

console.log('\n' + (fail ? (fail + ' FAILED, ' + pass + ' passed') : ('all ' + pass + ' checks passed')));
process.exit(fail ? 1 : 0);
