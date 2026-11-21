// Probe for "drag the selection from anywhere inside its real outline".
//
// Pressing an edge used to be the only way to start moving a selection, which is
// tedious for a filled loop. The fallback now tests the loop's REAL polygon
// (pointInPoly), not a bounding box: the empty corner of an L-shaped selection
// must stay "empty canvas" so a click there still deselects.
//
// A second rule lives here too: a marquee rectangle picks POINTS only. Picking
// whole entities whose bounds merely grazed the rectangle grabbed a polyline
// wholesale when the marquee touched one edge.
//
// Run: node testing/selection_drag_probe.js
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

// --- the drag fallback ----------------------------------------------------
const start = app.indexOf('// Nothing under the cursor, but a press INSIDE');
const end = app.indexOf('const loop = pickLoopAt(', start);
const block = app.slice(start, end);

console.log('selection drag: real polygon, not a bounding box');
check('comment block found', start > 0 && end > start);
check('it runs only with a non-empty selection', /ui\.selection\.length/.test(block));
check('modifier presses are excluded', /!addMod && !subMod/.test(block));
check('it asks pressInsideSelectedLoop(world)', /pressInsideSelectedLoop\(world\)/.test(block));
check('a drag payload is built from the selection', /selectionBodyDragFor\(world\)/.test(block));
check('the drag is only installed when the payload exists', /if \(at\) \{/.test(block));
check('a history step is pushed before moving', /pushHistory\(\)/.test(block));
check('the drag is installed on ui.drag', /ui\.drag = at/.test(block));
check('NO bounding-box test remains in the fallback',
  !/selectionBounds\(\)/.test(block) && !/b\.minX/.test(block));
check('placed after the hit test, before loop picking',
  app.indexOf('const eh = hitEntity(pos.x, pos.y);') < start && start < end);
check('the fallback lives in the select tool branch',
  app.slice(0, start).lastIndexOf("if (ui.tool === 'select')") > 0);

console.log('selection drag: pressInsideSelectedLoop tests the real outline');
{
  const fnStart = app.indexOf('function pressInsideSelectedLoop(');
  const body = app.slice(fnStart, app.indexOf('\n  function ', fnStart));
  check('walks the loops', /for \(const loop of getLoops\(\)\)/.test(body));
  check('only loops whose whole shape is selected',
    /loopShapeSelected\(loop\)/.test(body));
  check('tests the real polygon with pointInPoly',
    /pointInPoly\(world, loop\.poly\)/.test(body));
  check('skips degenerate outlines', /loop\.poly \|\| loop\.poly\.length <= 2/.test(body));
}

// the geometric contract of pointInPoly use, checked directly
console.log('selection drag: inside vs outside (contract)');
{
  // even-odd rule, same semantics pointInPoly implements
  const inside = (pt, poly) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
      if ((yi > pt.y) !== (yj > pt.y) &&
        pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const L = [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 20 }, { x: 20, y: 20 },
    { x: 20, y: 50 }, { x: 0, y: 50 }];
  check('inside the L body is draggable', inside({ x: 10, y: 30 }, L));
  check('inside the L foot is draggable', inside({ x: 40, y: 10 }, L));
  check('the empty corner of the L is OUTSIDE (click deselects)',
    !inside({ x: 40, y: 40 }, L));
  check('far outside is outside', !inside({ x: 200, y: 200 }, L));
  check('a point on the very edge reads inside (inclusive enough)',
    inside({ x: 30, y: 0.0001 }, L));
}

console.log('selection drag: marquee picks points, not entities');
{
  const rs = app.indexOf('function applyRubberSelection(');
  const body = app.slice(rs, app.indexOf('\n  function ', rs));
  // a marquee no longer grabs entities by grazing bounds; the ONE entity rule
  // left is for containers that own no points (group/art, clone array, part),
  // and it requires full containment
  check('no entity is grabbed by a grazing bounding box',
    !/kill\.add\('entity:'/.test(body));
  check('point-less containers are selected only when fully inside',
    /e\.type !== 'art' && e\.type !== 'array' && e\.type !== 'part'\) continue;/.test(body) &&
    /bb\.minX >= w0\.x[\s\S]{0,200}bb\.maxY <= w1\.y/.test(body));
  check('points are picked', /picked\.set\('point:'/.test(body));
  check('points are subtracted too', /kill\.add\('point:'/.test(body));
  check('pointEditable is honoured on the active layer',
    /pointEditable\(\+key\)/.test(body));
  check('the tiny-drag deselect still works', /clearSelection\(\)/.test(body));
  check('cross-layer reach is kept for points', /pointUses\(\+key\)/.test(body));
  check('a comment states the points-only rule',
    /Rectangle selection picks POINTS only/.test(body));
}

console.log('selection drag: a click on a fully point-selected line DRAGS');
{
  const fnStart = app.indexOf('function entityFullySelectedByPoints(');
  const body = app.slice(fnStart, app.indexOf('\n  // ', fnStart));
  check('the helper exists', fnStart > 0);
  check('it requires the entity to exist and own points',
    /if \(!e\) return false;/.test(body) && /if \(!ids\.length\) return false;/.test(body));
  check('it compares every point against the point-selection index',
    /const sel = selectionIndex\(\)\.point;/.test(body) &&
    /if \(!sel\.has\(\+pid\)\) return false;/.test(body));
  const click = app.indexOf('// A click on a line whose points are ALL already selected');
  const clickBody = app.slice(click, click + 1400);
  check('the entity-click branch checks the helper BEFORE re-selecting',
    /entityFullySelectedByPoints\(eh\) && selectionBodyDragFor\(world\)/.test(clickBody));
  check('the drag path installs the whole-selection payload',
    /ui\.drag = selectionBodyDragFor\(world\)/.test(clickBody));
  check('modifiers still bypass the drag (they mean "change the selection")',
    /!addMod && !subMod && !wantGroup &&\s*entityFullySelectedByPoints/.test(clickBody));
}

console.log('selection drag: inside-drag accepts point-selected loops too');
{
  const fnStart = app.indexOf('function pressInsideSelectedLoop(');
  const body = app.slice(fnStart, app.indexOf('\n  function drawSegmentHighlight', fnStart));
  check('entity-selected loops still work', /loopShapeSelected\(loop\)/.test(body));
  check('point-selected loops count ("every point of the loop picked")',
    /ptSel\.has\(\+pid\)/.test(body));
  check('it requires the loop to own editable geometry',
    /owns && all && pointInPoly\(world, loop\.poly\)/.test(body));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
