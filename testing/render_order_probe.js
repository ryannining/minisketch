// Probe for the render ORDER (no canvas needed: the passes are read out of
// render() and their relative order is asserted).
//
// The bug this pins: a pasted picture was drawn in the entity pass, i.e. AFTER
// drawLoopFills(), so its bitmap covered every yellow / gray loop fill. A filled
// circle drawn on top of a reference picture therefore looked unfilled.
//
// Run: node testing/render_order_probe.js
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

const render = slice('render');

// the first occurrence of each pass inside render()
const at = (needle) => render.indexOf(needle);

console.log('\n== the draw passes run in the right order ==');
{
  const iGrid = at('drawGrid()');
  const iImage = at('drawImageBitmaps()');
  const iFills = at('drawLoopFills()');
  const iLoops = at('drawLoops()');
  const iEnts = at('drawEntities()');
  const iDims = at('drawDimensions()');
  const iPoints = at('drawPoints()');

  check('the picture backdrop pass exists', iImage > 0, iImage);
  check('it is painted after the grid', iImage > iGrid, iImage + ' vs ' + iGrid);
  check('it is painted BEFORE the loop fills', iImage < iFills, iImage + ' vs ' + iFills);
  check('the loop fills come before the loops', iFills < iLoops);
  check('the loops come before the entities', iLoops < iEnts);
  check('dimensions sit above the geometry', iDims > iEnts);
  check('point markers are last', iPoints > iDims);
}

console.log('\n== the bitmap and the frame are separate passes ==');
{
  const bitmap = slice('drawImageBitmap');
  const bitmaps = slice('drawImageBitmaps');
  const frame = slice('drawImageEntity');

  check('drawImageBitmap really draws the image', /drawImage\(/.test(bitmap));
  check('drawImageBitmaps walks the image entities', /type !== 'image'/.test(bitmaps) && /drawImageBitmap\(e\)/.test(bitmaps));
  check('it respects layer visibility', /layerVisible\(/.test(bitmaps));
  check('it respects the viewport cull', /entityOnScreen\(/.test(bitmaps));

  // the per-entity pass must NOT paint the bitmap any more, or the fill is
  // covered again the moment the picture is drawn with the other entities
  check('the entity pass no longer paints the bitmap', !/drawImage\(/.test(frame), frame.includes('drawImage('));
  check('the entity pass still draws the dashed frame', /setLineDash/.test(frame));
  check('the entity pass still tints the selection', /globalAlpha/.test(frame));
}

console.log('\n== the fill tint is painted per loop, under the geometry ==');
{
  const fills = slice('drawLoopFills');
  check('fills use the loop fill tint', /LOOP_FILL_TINT\[fill\]/.test(fills));
  check('an unfilled loop is skipped', /fill === 'none'/.test(fills));
  check('a hidden layer is skipped', /loopVisibleOnCanvas\(loop\)/.test(fills));
}

console.log('\n' + (fail ? fail + ' FAILED, ' : 'all ') + pass + ' checks passed');
process.exit(fail ? 1 : 0);
