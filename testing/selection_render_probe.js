// Probe for the selected-line-width setting and the selection batching.
//
// Dragging a big selection was slow because of two things in drawOneEntity():
//   1. every selected shape got its own thick stroke (a hardcoded 1.3 x)
//   2. every selected shape got its own stroke() call — no batching
// The width is now Settings > Renderer > Selected line width, and selected
// shapes batch into their own Path2D map keyed by their brightened colour.
//
// Run: node testing/selection_render_probe.js
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

console.log('selection render: the width is a setting');
check('SETTINGS_SPEC has selWidth',
  /\{ group: 'Renderer', key: 'selWidth', label: 'Selected line width'/.test(app));
check('it defaults to 2.6 (the old 2 x 1.3)',
  /key: 'selWidth'[\s\S]{0,160}def: 2\.6/.test(app));
check('it has a sane range', /key: 'selWidth'[\s\S]{0,200}min: 0\.5, max: 12/.test(app));
check('SEL_WIDTH is declared', /let SEL_WIDTH = 2\.6;/.test(app));
check('SEL_WIDTH is read from settings', /SEL_WIDTH = settings\.selWidth;/.test(app));

console.log('selection render: the hardcoded multiplier is gone');
check('no lw * 1.3 left', !/isSel \? lw \* 1\.3/.test(app));
check('selected strokes use selLw', /ctx\.lineWidth = isSel \? selLw/.test(app));
check('selLw derives from SEL_WIDTH with the zoom clamp',
  /const selLw = SEL_WIDTH \* clamp\(view\.zoom, LINE_ZOOM_MIN, LINE_ZOOM_MAX\)/.test(app));

console.log('selection render: selLw reaches drawOneEntity');
check('drawOneEntity takes selLw', /function drawOneEntity\(e, bulk, manySelected, lw, selLw, selBatch, batch\)/.test(app));
check('the call site passes selLw', /drawOneEntity\(e, bulk, manySelected, lw, selLw, selBatch, batch\)/.test(app));
check('selLw is defined inside drawEntities, where the loop runs',
  (() => {
    const fnStart = app.indexOf('function drawEntities()');
    const fnEnd = app.indexOf('\n  function flushSelectedBatch', fnStart);
    const body = app.slice(fnStart, fnEnd);
    return /const selLw = SEL_WIDTH/.test(body);
  })());
// drawOneEntity is a SIBLING of drawEntities, so a local of drawEntities is NOT
// in scope there: every free variable must arrive as a parameter.
check('drawOneEntity reads selLw only as its own parameter, not a closure local',
  (() => {
    const start = app.indexOf('function drawOneEntity(');
    const body = app.slice(start, app.indexOf('\n  function flushEntityBatch', start));
    return /ctx\.lineWidth = isSel \? selLw/.test(body);
  })());
check('selected shapes join selBatch by brightened colour',
  /isSel && !manySelected && !isHover[\s\S]{0,220}selBatch\.set\(color, path\)/.test(app));
check('a selBatch map is created', /const selBatch = new Map\(\)/.test(app));
check('a flush helper exists', /function flushSelectedBatch\(selBatch, selLw\)/.test(app));
check('it strokes once at selLw', /flushSelectedBatch[\s\S]{0,200}ctx\.lineWidth = selLw/.test(app));
check('the flush runs per layer', /flushEntityBatch\(batch, lw, manySelected\);\s*\n\s*flushSelectedBatch\(selBatch, selLw\)/.test(app));
check('both maps are cleared each layer',
  /batch\.clear\(\);\s*\n\s*selBatch\.clear\(\)/.test(app));

console.log('selection render: brightColor is memoised');
check('a cache backs brightColor', /const brightCache = new Map\(\)/.test(app));
check('a hit returns early', /const hit = brightCache\.get\(hex\);\s*\n\s*if \(hit\) return hit;/.test(app));
check('a miss is stored', /brightCache\.set\(hex, out\)/.test(app));

console.log('selection render: the hovered shape still draws on its own');
check('hover bypasses the selection batch',
  /isSel && !manySelected && !isHover/.test(app));
check('hover keeps its own width', /isHover \? lw \* 1\.4 : lw/.test(app));

console.log('selection render: every draw path honours the width');
check('art groups read SEL_WIDTH when selected',
  /const artSelLw = isSel \? SEL_WIDTH \* zoomClamp : LINE_WIDTH \* zoomClamp/.test(app));
check('art groups use their true colour when selected',
  /ctx\.strokeStyle = isSel \? themedCanvasColor\(col\) : dimColor\(themedCanvasColor\(col\)\);/.test(app));
check('array clones read SEL_WIDTH when their array is selected',
  /const zw = \(arrSel \? SEL_WIDTH : LINE_WIDTH\) \* clamp/.test(app));
check('array clones use their true colour when selected',
  /ctx\.strokeStyle = arrSel \? themedCanvasColor\(col\) : dimColor\(themedCanvasColor\(col\)\);/.test(app));
check('array jobs carry their entity id',
  /jobs\.push\(\{ m, src, eid: \+id \}\)/.test(app));
check('no raw LINE_WIDTH stroke left outside the unselected branches',
  (() => {
    // the three remaining sites must all be conditional on "not selected"
    let bad = 0;
    for (const m of app.matchAll(/ctx\.lineWidth = LINE_WIDTH \* clamp/g)) {
      const line = app.slice(app.lastIndexOf('\n', m.index) + 1, app.indexOf('\n', m.index));
      if (!/selLw|zw|artSelLw|isSel|arrSel/.test(line) && !/const lw =/.test(line)) bad++;
    }
    return bad === 0;
  })());

console.log('selection render: one line, one stroke');
check('SEG_WIDTH derives from the setting, not hardcoded 6',
  /const SEG_WIDTH = Math\.max\(2, SEL_WIDTH \* clamp\(view\.zoom, LINE_ZOOM_MIN, LINE_ZOOM_MAX\)\)/.test(app));
check('a helper decides which lines the amber band owns',
  /function lineDrawnAsSegment\(eid\)/.test(app));
check('selected lines are skipped in the normal pass (no doubled stroke)',
  /if \(e\.type === 'line' && lineDrawnAsSegment\(\+e\.id\)\) return;/.test(app));
check('wholly selected splines are skipped too (amber owns every span)',
  /if \(e\.type === 'spline'\) return;/.test(app));
check('the helper shares the entityHighlight threshold (<=200)',
  /lineDrawnAsSegment[\s\S]{0,400}selEnts\.size > 200/.test(app));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
