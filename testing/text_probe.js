// Probe for the text frame geometry (no canvas involved).
// Slices textGeom() / textInBox() / textDimCount() out of ../app.js and checks
// the affine frame: rotation, skew, inside test, and the rule that decides when
// the glyph ratio is released (two driven dimensions).
//
// Run: node testing/text_probe.js
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

let state = null;
const build = (prelude) => new Function('state', 'P',
  prelude + sliceApp('textGeom') + '\n' + sliceApp('textInBox') + '\n' + sliceApp('textDimCount') +
  '\nreturn { textGeom, textInBox, textDimCount };'
)(state, (id) => state.points[id]);

const preludeBase = '';

console.log('\n== textGeom: the three points are an affine frame ==');
state = {
  points: { 1: { x: 0, y: 0 }, 2: { x: 100, y: 0 }, 3: { x: 0, y: 20 } },
  entities: { 9: { id: 9, type: 'text', p0: 1, pw: 2, ph: 3 } },
  constraints: {}
};
let api = build(preludeBase);
let gg = api.textGeom(state.entities[9]);
console.log('  axis-aligned:', JSON.stringify({ A: gg.A, B: gg.B, w: gg.w, h: gg.h }));
check('width = 100', Math.abs(gg.w - 100) < 1e-9, gg.w);
check('height = 20', Math.abs(gg.h - 20) < 1e-9, gg.h);
check('A is the width vector', gg.A.x === 100 && gg.A.y === 0);
check('B is the height vector', gg.B.x === 0 && gg.B.y === 20);

console.log('\n== rotated 90 degrees ==');
state.points = { 1: { x: 0, y: 0 }, 2: { x: 0, y: 100 }, 3: { x: -20, y: 0 } };
gg = api.textGeom(state.entities[9]);
check('width still 100', Math.abs(gg.w - 100) < 1e-9, gg.w);
check('height still 20', Math.abs(gg.h - 20) < 1e-9, gg.h);
check('A points up', gg.A.x === 0 && gg.A.y === 100);
check('B points left (perpendicular after rotation)', gg.B.x === -20 && gg.B.y === 0);

console.log('\n== skewed frame (height point not perpendicular) ==');
state.points = { 1: { x: 0, y: 0 }, 2: { x: 100, y: 0 }, 3: { x: 30, y: 20 } };
gg = api.textGeom(state.entities[9]);
console.log('  skewed:', JSON.stringify({ A: gg.A, B: gg.B, w: gg.w, h: gg.h }));
check('width is the width line length', Math.abs(gg.w - 100) < 1e-9, gg.w);
check('height is the height line length, not a projection',
  Math.abs(gg.h - Math.hypot(30, 20)) < 1e-9, gg.h);
check('B keeps the horizontal offset (shear)', gg.B.x === 30);

console.log('\n== textInBox ==');
state.points = { 1: { x: 0, y: 0 }, 2: { x: 100, y: 0 }, 3: { x: 30, y: 20 } };
gg = api.textGeom(state.entities[9]);
check('a point just inside the skewed box is inside', api.textInBox({ x: 2, y: 1 }, gg) === true);
check('a point left of the sheared edge is outside (parallelogram, not rect)',
  api.textInBox({ x: 0.5, y: 1 }, gg) === false);
check('far corner is inside (parallelogram, not rectangle)',
  api.textInBox({ x: 125, y: 19 }, gg) === true);
check('outside past the width', api.textInBox({ x: 101, y: 0 }, gg) === false);
check('outside above the frame', api.textInBox({ x: 10, y: 21 }, gg) === false);
check('outside left of the origin', api.textInBox({ x: -1, y: 1 }, gg) === false);

console.log('\n== textDimCount decides when the ratio is released ==');
state.constraints = {};
check('no dimensions -> 0 (ratio locked)', api.textDimCount(9) === 0);
state.constraints = { 20: { id: 20, type: 'distance', p1: 1, p2: 2, value: 100, kind: 'length' } };
check('width dimension only -> 1 (ratio locked)', api.textDimCount(9) === 1, api.textDimCount(9));
state.constraints[21] = { id: 21, type: 'distance', p1: 1, p2: 3, value: 20, kind: 'length' };
check('width + height -> 2 (ratio released)', api.textDimCount(9) === 2, api.textDimCount(9));
state.constraints[21].reference = true;
check('a reference dimension does not release it', api.textDimCount(9) === 1, api.textDimCount(9));


console.log('\n== textContoursWorld maps outlines through the affine frame ==');
{
  // local box 100 x 60 reference px, frame: A = (100,0), B = (0,60)
  const fakeMetrics = { width: 100, height: 60, ascent: 48, lineHeight: 125, lines: ['X'] };
  const local = [[[0, 0], [100, 0], [100, 60], [0, 60]]];
  const mapFn = new Function('state', 'P', 'textGeom', 'textMetricsOf', 'textLocalContours',
    'rdpSimplify', 'traceKey', 'TEXT_TOL_MM',
    sliceApp('textContoursWorld') + '\nreturn textContoursWorld;'
  );
  const state2 = {
    points: { 1: { x: 10, y: 10 }, 2: { x: 110, y: 10 }, 3: { x: 10, y: 70 } },
    entities: { 9: { id: 9, type: 'text', p0: 1, pw: 2, ph: 3 } },
    constraints: {}
  };
  const geom = new Function('state', 'P', sliceApp('textGeom') + '\nreturn textGeom;')(state2, id => state2.points[id]);
  const helpers = new Function(
    sliceApp('traceKey') + '\n' + sliceApp('rdpSimplify') + '\nreturn { traceKey, rdpSimplify };'
  )();
  const mapContours = mapFn(state2, id => state2.points[id], geom, () => fakeMetrics, () => local,
    helpers.rdpSimplify, helpers.traceKey, 0.08);
  const world = mapContours(state2.entities[9]);
  const loop = world[0];
  console.log('  mapped:', JSON.stringify(loop));
  check('corner 0 is the frame origin', Math.abs(loop[0].x - 10) < 1e-9 && Math.abs(loop[0].y - 10) < 1e-9);
  check('corner 1 follows the width line', Math.abs(loop[1].x - 110) < 1e-9 && Math.abs(loop[1].y - 10) < 1e-9);
  check('corner 2 is the far corner', Math.abs(loop[2].x - 110) < 1e-9 && Math.abs(loop[2].y - 70) < 1e-9);
  check('corner 3 follows the height line', Math.abs(loop[3].x - 10) < 1e-9 && Math.abs(loop[3].y - 70) < 1e-9);
}

console.log('\n' + (fail ? (fail + ' FAILED, ' + pass + ' passed') : ('all ' + pass + ' checks passed')));
process.exit(fail ? 1 : 0);
