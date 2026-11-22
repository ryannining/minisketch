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

// ---- undo: one draw-text = one history step ------------------------------
console.log('\n== a new text applies without a second history push ==');
{
  const i = appSrc.indexOf('async function applyTextEditor(');
  const body = appSrc.slice(i, appSrc.indexOf('\n  function ', i));
  check('Apply pushes only for an EXISTING text (the placement snapshot stays the new text\'s undo target)',
    /if \(!ed\.isNew\) pushHistory\(\);/.test(body));
  check('and there is no unconditional push left in Apply',
    !/\n\s*pushHistory\(\);\s*\n/.test(body));
  const p = appSrc.indexOf("if (ui.tool === 'text') {");
  const place = appSrc.slice(p, p + 900);
  check('placement still pushes once — the snapshot Cancel pops',
    /pushHistory\(\);/.test(place));
  const d = appSrc.indexOf('function discardNewText(');
  const drop = appSrc.slice(d, appSrc.indexOf('\n  function ', d));
  check('Cancel still pops that snapshot (no phantom undo step)',
    /history\.pop\(\)/.test(drop));
}

// ---- dragging a text: press on the selected frame drags immediately ------
console.log('\n== a selected text drags from its whole frame, no dwell ==');
{
  const p = appSrc.indexOf('function onPointerDown(');
  const press = appSrc.slice(p, appSrc.indexOf('\n  function ', p));
  check('a press inside a selected framed object is an immediate body drag',
    /selected\('entity', eh\) &&\s*\(hitEnt\.type === 'text' \|\| hitEnt\.type === 'image' \|\| hitEnt\.type === 'art'\)[\s\S]{0,120}selectionBodyDragFor\(world\)/.test(press));
  check('modifier clicks still go through the dwell path (add / sub / Alt group)',
    press.indexOf("!addMod && !subMod && !wantGroup && selected('entity', eh)") <
    press.indexOf("hitEnt.type === 'text'"));
  check('the hit area is the whole frame (textInBox inside = hit)',
    /if \(textInBox\(world, gg\)\) return 3;/.test(appSrc));
  // selection must be visible on the GLYPHS themselves: a themed white glyph
  // cannot brighten, so a picked text takes the amber selection mix instead
  const dtx = appSrc.indexOf('function drawTextEntity(');
  const dtail = appSrc.slice(dtx, appSrc.indexOf('\n  function ', dtx));
  check('a selected text draws its glyphs in the amber selection mix + Selected width',
    /strokeStyle = isSel \? selectMixColor\(themedCanvasColor\(colorOf\(e\)\)\) : colorOf\(e\)/.test(dtail) &&
    /isSel \? SEL_WIDTH : 1/.test(dtail));
}

// ---- draft: a new text appears only when Apply is pressed ----------------
console.log('\n== a new text is a hidden draft until Apply ==');
{
  const p = appSrc.indexOf("if (ui.tool === 'text') {");
  const place = appSrc.slice(p, appSrc.indexOf("\n    if (ui.tool === 'line')", p));
  check('placement creates the text as a hidden draft (no guides, no commit)',
    /_draft: true/.test(place) && /guide: \[\]/.test(place) &&
    !/commit\(\)/.test(place) && !/state\.entities\[idW\]/.test(place));
  const a = appSrc.indexOf('async function applyTextEditor(');
  const apply = appSrc.slice(a, appSrc.indexOf('\n  function ', a));
  check('Apply clears the draft flag and attaches the guide frame',
    /delete e\._draft;/.test(apply) && /attachTextGuides\(e\)/.test(apply));
  check('drawOneEntity skips drafts (nothing on the workspace before Apply)',
    /function drawOneEntity\([\s\S]{0,300}if \(e\._draft\) return;/.test(appSrc));
  check('hit tests ignore drafts',
    /function entityScreenDistance\([\s\S]{0,220}if \(e\._draft\) return Infinity;/.test(appSrc));
  check('guides + horizontal + perpendicular attach once at Apply',
    /function attachTextGuides\(/.test(appSrc) &&
    /type: 'horizontal', entity: idW/.test(appSrc) &&
    /type: 'perpendicular', line1: idW, line2: idH/.test(appSrc));
  const d0 = appSrc.indexOf('function discardNewText(');
  const drop = appSrc.slice(d0, appSrc.indexOf('\n  function ', d0));
  check('Cancel still pops the placement snapshot (workspace stays clean)',
    /history\.pop\(\)/.test(drop));
}

console.log('\n' + (fail ? (fail + ' FAILED, ' + pass + ' passed') : ('all ' + pass + ' checks passed')));
process.exit(fail ? 1 : 0);
