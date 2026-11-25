// Comprehensive probe for unified CNC stroke color & 3-mode KaryaCNC fill
// across all 10 MiniSketch entity types, Canvas, Swatch UI, KaryaCNC, SVG, and AI.
//
// Run: node testing/color_fill_probe.js
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const chatSrc = fs.readFileSync(path.join(ROOT, 'ai', 'chat.js'), 'utf8');
const toolsManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'ai', 'tools.json'), 'utf8'));
const sysPrompt = fs.readFileSync(path.join(ROOT, 'ai', 'system-prompt.txt'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const serveSrc = fs.readFileSync(path.join(ROOT, 'server', 'serve.js'), 'utf8');

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  PASS  ' + name);
  } else {
    fail++;
    console.log('  FAIL  ' + name + (extra !== undefined ? ' -> ' + extra : ''));
  }
}

console.log('\n== 1. Syntax, Port 8090 & Static Contracts ==');
try {
  new Function(appSrc);
  check('app.js parses cleanly with zero syntax errors', true);
} catch (err) {
  check('app.js parses cleanly with zero syntax errors', false, err.message);
}
try {
  new Function(chatSrc);
  check('ai/chat.js parses cleanly with zero syntax errors', true);
} catch (err) {
  check('ai/chat.js parses cleanly with zero syntax errors', false, err.message);
}
check('server/serve.js keeps port 8090', /process\.env\.PORT \|\| 8090/.test(serveSrc));
check('index.html swatch bar tooltip documents loops/text/group & master-linked array/clone',
  /fill CNC \(loop, teks, grup; array\/clone ikut master\)/i.test(html));

console.log('\n== 2. Text Fill Rendering Order & Even-Odd Combined Path ==');
const drawTextIdx = appSrc.indexOf('function drawTextEntity(e)');
const drawTextSlice = appSrc.slice(drawTextIdx, drawTextIdx + 4200);
const fillCallIdx = drawTextSlice.indexOf("ctx.fill(combined, 'evenodd')");
const strokeCallIdx = drawTextSlice.indexOf('ctx.strokeText(');
check('drawTextEntity combines all glyph loops into one Path2D with evenodd', fillCallIdx > 0);
check('drawTextEntity renders fill BEFORE glyph stroke', fillCallIdx > 0 && strokeCallIdx > fillCallIdx);
check('drawTextEntity skips fill when tw.closed is false (single-line font)',
  /if \(tw && tw\.closed && tw\.loops && tw\.loops\.length\)/.test(drawTextSlice));

console.log('\n== 3. Live Execution of Unified Style Engine (All 10 Entity Types) ==');
// Extract the unified functions directly from app.js so we test the REAL code.
const engineStart = appSrc.indexOf('  function normalizeFillValue(fill)');
const engineEnd = appSrc.indexOf('  // ONE tolerance, two windows.', engineStart);
check('Unified style engine block found in app.js', engineStart > 0 && engineEnd > engineStart);
const engineCode = appSrc.slice(engineStart, engineEnd);

function createSandbox() {
  const toasts = [];
  let historyPushes = 0;
  let commits = 0;
  let uiUpdates = 0;
  let geometryEpoch = 1;

  const state = {
    points: {
      1: { x: 0, y: 0 }, 2: { x: 20, y: 0 }, 3: { x: 20, y: 20 }, 4: { x: 0, y: 20 },
      10: { x: 50, y: 50 },
      20: { x: 0, y: 40 }, 21: { x: 30, y: 40 }, 22: { x: 0, y: 50 },
      30: { x: 40, y: 40 }, 31: { x: 70, y: 40 }, 32: { x: 40, y: 60 },
      40: { x: 100, y: 10 },
      50: { x: 120, y: 10 }, 51: { x: 150, y: 10 }, 52: { x: 120, y: 30 },
      60: { x: 80, y: 0 }, 61: { x: 90, y: 10 }, 62: { x: 80, y: 20 }
    },
    entities: {
      // Closed 4-line loop
      101: { id: 101, type: 'line', a: 1, b: 2, color: '#000000' },
      102: { id: 102, type: 'line', a: 2, b: 3, color: '#000000' },
      103: { id: 103, type: 'line', a: 3, b: 4, color: '#000000' },
      104: { id: 104, type: 'line', a: 4, b: 1, color: '#000000' },
      // Circle
      105: { id: 105, type: 'circle', c: 10, r: 8, color: '#000000' },
      // Closed spline
      106: { id: 106, type: 'spline', pts: [1, 2, 3], closed: true, color: '#000000' },
      // Arc
      107: { id: 107, type: 'arc', c: 60, s: 61, e: 62, color: '#000000' },
      // Outline text + its owned guide lines
      108: { id: 108, type: 'text', p0: 20, pw: 21, ph: 22, guide: [208, 209], text: 'BOB', font: 'Liberation Sans', single: false, color: '#000000' },
      208: { id: 208, type: 'line', a: 20, b: 21, color: '#00ff00' },
      209: { id: 209, type: 'line', a: 20, b: 22, color: '#00ff00' },
      // Single-line text
      109: { id: 109, type: 'text', p0: 20, pw: 21, ph: 22, text: 'CNC', font: 'Hershey Sans 1-stroke', single: true, color: '#0000ff' },
      // Multi-color / multi-fill Group (art)
      110: {
        id: 110, type: 'art', p0: 30, pw: 31, ph: 32, guide: [210, 211], color: '#000000',
        contours: [[[0, 0], [1, 0], [1, 1], [0, 1]], [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]]],
        closed: [true, true],
        contourColors: ['#000000', '#ff0000'],
        contourFills: ['gray', null],
        curveSrc: [
          { closed: true, curved: false, c: '#000000', f: 'gray', n: [] },
          { closed: true, curved: false, c: '#ff0000', f: null, n: [] }
        ]
      },
      210: { id: 210, type: 'line', a: 30, b: 31, color: '#00ff00' },
      211: { id: 211, type: 'line', a: 30, b: 32, color: '#00ff00' },
      // Array / Clone (multi-color master 110)
      111: {
        id: 111, type: 'array', kind: 'clone', masters: [110], color: '#000000',
        shapes: [
          { color: '#000000', fill: 'gray', closed: true, pts: [[0, 0], [10, 0], [10, 10], [0, 10]] },
          { color: '#ff0000', fill: null, closed: true, pts: [[2, 2], [8, 2], [8, 8], [2, 8]] }
        ]
      },
      // Part (mechanism visual, non-CNC)
      112: { id: 112, type: 'part', color: '#15803d', polylines: [[[0, 0], [5, 0], [5, 5]]] },
      // Note (yellow comment, non-CNC)
      113: { id: 113, type: 'note', p: 40, text: 'x3' },
      // Image (raster bitmap, non-vector)
      114: { id: 114, type: 'image', p0: 50, pw: 51, ph: 52, src: 'data:image/png;base64,AAA' }
    }
  };

  const ui = { color: '#000000', selection: [], focusLoop: null };
  const rectLoop = { id: 'L1', entities: [101, 102, 103, 104] };

  const ctxObj = {
    state, ui,
    ownedGuideIds: () => new Set([208, 209, 210, 211]),
    selectedEntities: () => ui.selection.filter(s => s.kind === 'entity').map(s => state.entities[s.id]).filter(Boolean),
    selectedEntitiesForExport: () => ui.selection.filter(s => s.kind === 'entity').map(s => state.entities[s.id]).filter(Boolean),
    selectionIndex: () => ({
      point: new Set(ui.selection.filter(s => s.kind === 'point').map(s => +s.id)),
      entity: new Set(ui.selection.filter(s => s.kind === 'entity').map(s => +s.id))
    }),
    pointUses: (pid) => {
      const out = [];
      for (const e of Object.values(state.entities)) {
        if (e.p0 === pid || e.pw === pid || e.ph === pid || e.a === pid || e.b === pid || e.c === pid) out.push(e);
      }
      return out;
    },
    isSingleLineFont: (e) => !!(e && e.single),
    getLoops: () => [rectLoop],
    loopShapeSelected: (L) => L.entities.every(id => ui.selection.some(s => s.kind === 'entity' && s.id === id)),
    loopEntities: (L) => L.entities,
    pushHistory: () => { historyPushes++; },
    commit: () => { commits++; geometryEpoch++; },
    updateUI: () => { uiUpdates++; },
    toast: (m) => { toasts.push(m); },
    getMetrics: () => ({ toasts, historyPushes, commits, uiUpdates, geometryEpoch })
  };

  vm.createContext(ctxObj);
  vm.runInContext(engineCode, ctxObj);
  return ctxObj;
}

{
  const sb = createSandbox();

  // 3a. Group (art): uniform stroke override updates color, contourColors, AND curveSrc[].c
  sb.ui.selection = [{ kind: 'entity', id: 110 }];
  const rArtCol = sb.applyStrokeColorToSelection('#0000ff');
  const art = sb.state.entities[110];
  check('Group stroke override succeeds', rArtCol.ok && rArtCol.count === 1);
  check('Group e.color updated to #0000ff', art.color === '#0000ff');
  check('Group contourColors uniformly updated to #0000ff', art.contourColors.every(c => c === '#0000ff'));
  check('Group curveSrc[].c uniformly updated to #0000ff', art.curveSrc.every(s => s.c === '#0000ff'));
  check('Group stroke update bumped geometryEpoch via commit()', sb.getMetrics().commits === 1 && sb.getMetrics().geometryEpoch === 2);

  // 3b. Group (art): uniform fill override & clear updates fill, contourFills, AND curveSrc[].f
  const rArtFillY = sb.setLoopFill('yellow');
  check('Group fill yellow succeeds', rArtFillY.ok && rArtFillY.count === 1);
  check('Group e.fill = yellow', art.fill === 'yellow');
  check('Group contourFills uniformly yellow', art.contourFills.every(f => f === 'yellow'));
  check('Group curveSrc[].f uniformly yellow', art.curveSrc.every(s => s.f === 'yellow'));

  const rArtFillNone = sb.setLoopFill('none');
  check('Group fill none clears e.fill, contourFills, and curveSrc[].f',
    rArtFillNone.ok && art.fill === undefined &&
    art.contourFills.every(f => f === null) &&
    art.curveSrc.every(s => s.f === null));

  // 3c. Text (outline): stroke + fill + selecting frame point p0 does NOT recolor owned guide lines
  sb.ui.selection = [{ kind: 'point', id: 20 }];
  const rTextPtCol = sb.applyStrokeColorToSelection('#800080');
  const txt = sb.state.entities[108];
  check('Text frame point selection recolors text entity', rTextPtCol.ok && txt.color === '#800080');
  check('Text frame point selection NEVER recolors green owned guide lines',
    sb.state.entities[208].color === '#00ff00' && sb.state.entities[209].color === '#00ff00');
  const rTextFill = sb.setLoopFill('gray');
  check('Text fill gray applied via frame point selection', rTextFill.ok && txt.fill === 'gray');

  // 3d. Text (single-line): fill warns caller that single-line stays open
  sb.ui.selection = [{ kind: 'entity', id: 109 }];
  const rSingleFill = sb.setLoopFill('yellow');
  check('Single-line text fill flags singleLineWarn=1', rSingleFill.ok && rSingleFill.singleLineWarn === 1);

  // 3e. Array / Clone: strictly read-only for stroke & fill
  const arr = sb.state.entities[111];
  const histBefore = sb.getMetrics().historyPushes;
  sb.ui.selection = [{ kind: 'entity', id: 111 }];
  const rArrCol = sb.applyStrokeColorToSelection('#ff0000');
  const rArrFill = sb.setLoopFill('yellow');
  check('Array/Clone stroke color rejected as read-only', !rArrCol.ok && rArrCol.skippedArrays === 1 && arr.color === '#000000');
  check('Array/Clone fill rejected as read-only', !rArrFill.ok && rArrFill.skippedArrays === 1 && arr.fill === undefined);
  check('Array/Clone rejection does NOT waste an Undo history entry', sb.getMetrics().historyPushes === histBefore);

  // 3f. Mixed selection (Text + Array): updates Text, skips Array cleanly
  sb.ui.selection = [{ kind: 'entity', id: 108 }, { kind: 'entity', id: 111 }];
  const rMixCol = sb.applyStrokeColorToSelection('#00ffff');
  const rMixFill = sb.setLoopFill('yellow');
  check('Mixed Text+Array stroke updates Text and skips Array',
    rMixCol.ok && rMixCol.count === 1 && rMixCol.skippedArrays === 1 && txt.color === '#00ffff' && arr.color === '#000000');
  check('Mixed Text+Array fill updates Text and skips Array',
    rMixFill.ok && rMixFill.count === 1 && rMixFill.skippedArrays === 1 && txt.fill === 'yellow' && arr.fill === undefined);

  // 3g. Closed 4-line loop, circle, closed spline, arc
  sb.ui.selection = [101, 102, 103, 104].map(id => ({ kind: 'entity', id }));
  const rLoopFill = sb.setLoopFill('gray');
  check('Closed 4-line loop fill applies to all 4 lines',
    rLoopFill.ok && [101, 102, 103, 104].every(id => sb.state.entities[id].fill === 'gray'));

  sb.ui.selection = [{ kind: 'entity', id: 105 }, { kind: 'entity', id: 106 }, { kind: 'entity', id: 107 }];
  const rGeoCol = sb.applyStrokeColorToSelection('#ff0000');
  const rGeoFill = sb.setLoopFill('yellow');
  check('Circle + Spline + Arc stroke updated',
    rGeoCol.ok && rGeoCol.count === 3 &&
    sb.state.entities[105].color === '#ff0000' &&
    sb.state.entities[106].color === '#ff0000' &&
    sb.state.entities[107].color === '#ff0000');
  check('Circle + closed Spline receive fill while open Arc stays unfilled',
    rGeoFill.ok && sb.state.entities[105].fill === 'yellow' &&
    sb.state.entities[106].fill === 'yellow' && sb.state.entities[107].fill === undefined);

  // 3h. Part (stroke allowed, CNC fill rejected) & Note/Image (both skipped)
  sb.ui.selection = [{ kind: 'entity', id: 112 }];
  const rPartCol = sb.applyStrokeColorToSelection('#0000ff');
  const rPartFill = sb.setLoopFill('gray');
  check('Part allows visual stroke color change', rPartCol.ok && sb.state.entities[112].color === '#0000ff');
  check('Part rejects CNC fill', !rPartFill.ok && rPartFill.skippedNonCnc === 1 && sb.state.entities[112].fill === undefined);

  sb.ui.selection = [{ kind: 'entity', id: 113 }, { kind: 'entity', id: 114 }];
  const rNonVecCol = sb.applyStrokeColorToSelection('#ff0000');
  const rNonVecFill = sb.setLoopFill('gray');
  check('Note and Image skip stroke color cleanly',
    !rNonVecCol.ok && rNonVecCol.skippedOther === 2 && sb.state.entities[113].color === undefined && sb.state.entities[114].color === undefined);
  check('Note and Image skip CNC fill cleanly',
    !rNonVecFill.ok && rNonVecFill.skippedNonCnc === 2 && sb.state.entities[113].fill === undefined && sb.state.entities[114].fill === undefined);

  // 3i. pushHistory happens BEFORE entity mutation in setLoopFill
  const setLoopBody = appSrc.slice(appSrc.indexOf('  function setLoopFill(fill, opts)'), appSrc.indexOf('  // ONE tolerance, two windows.'));
  const pushPos = setLoopBody.indexOf('pushHistory();');
  const mutPos = setLoopBody.indexOf('applyFillToEntity(e, norm)');
  check('setLoopFill calls pushHistory() BEFORE mutating entities', pushPos > 0 && mutPos > pushPos);
}

console.log('\n== 4. KaryaCNC & SVG Export Parity ==');
const cncSlice = appSrc.slice(appSrc.indexOf('function cncCollectItems('), appSrc.indexOf('function cncBuildPayload('));
check('cncCollectItems art fallback respects loop.color and loop.fill',
  /const col = cncColorStroke\(loop\.color \|\| color\);/.test(cncSlice) &&
  /const fl = \(loop\.fill === 'gray' \|\| loop\.fill === 'yellow'\) \? loop\.fill : fill;/.test(cncSlice));
check('cncCollectItems text strips fill when outline.closed is false',
  /const fill = outline\.closed && \(e\.fill === 'gray' \|\| e\.fill === 'yellow'\) \? e\.fill : 'none';/.test(cncSlice));
check('cncCollectItems array has no stale baseFill override (strictly master-derived)',
  !/baseFill/.test(cncSlice) && /const fill = \(sh\.fill === 'gray' \|\| sh\.fill === 'yellow'\) \? sh\.fill : 'none';/.test(cncSlice));

const svgSlice = appSrc.slice(appSrc.indexOf('function exportSVG('), appSrc.indexOf("const svg = parts.join('\\n');") + 40);
check('exportSVG emits CNC_FILL hex and fill-rule="evenodd"',
  /fill="' \+ CNC_FILL\[fill\] \+ '"'/.test(svgSlice) && /fill-rule="evenodd"/.test(svgSlice));
check('exportSVG groups lines by color + fill', /const lineByStyle = new Map\(\);/.test(svgSlice));
check('exportSVG combines filled text loops into one evenodd path',
  /if \(out\.closed && \(ownFill === 'gray' \|\| ownFill === 'yellow'\)\)/.test(svgSlice));
check('arrayInstancePolylines propagates sh.fill for SVG export',
  /fill: \(sh\.fill === 'gray' \|\| sh\.fill === 'yellow'\) \? sh\.fill : null/.test(appSrc));

console.log('\n== 5. AI Tool Schema, Prompt & Execution ==');
const setColorTool = toolsManifest.tools.find(t => t.function && t.function.name === 'set_selection_color');
const addTextTool = toolsManifest.tools.find(t => t.function && t.function.name === 'add_text');
check('tools.json set_selection_color has optional color + fill enum [none, gray, yellow]',
  setColorTool &&
  setColorTool.function.parameters.properties.color &&
  setColorTool.function.parameters.properties.fill &&
  JSON.stringify(setColorTool.function.parameters.properties.fill.enum) === JSON.stringify(['none', 'gray', 'yellow']) &&
  Array.isArray(setColorTool.function.parameters.required) &&
  setColorTool.function.parameters.required.length === 0);
check('tools.json add_text has optional fill enum [none, gray, yellow]',
  addTextTool &&
  addTextTool.function.parameters.properties.fill &&
  JSON.stringify(addTextTool.function.parameters.properties.fill.enum) === JSON.stringify(['none', 'gray', 'yellow']));
check('system-prompt.txt documents 3 KaryaCNC fill modes and array/clone master rule',
  /KaryaCNC Fill modes/i.test(sysPrompt) && /Arrays\/clones always inherit color and fill from their master/i.test(sysPrompt));
check('ai/chat.js set_selection_color delegates to unified api.setSelectionColor and api.setSelectionFill',
  /api\.setSelectionColor\(col/.test(chatSrc) && /api\.setSelectionFill\(a\.fill/.test(chatSrc));
check('ai/chat.js describeSelection exposes fill, group colors/fills, and array readOnlyStyle',
  /d\.readOnlyStyle = true/.test(chatSrc) && /d\.fills =/.test(chatSrc));
check('app.js toolApi() exposes setSelectionColor and setSelectionFill',
  /setSelectionColor:\s*applyStrokeColorToSelection/.test(appSrc) &&
  /setSelectionFill:\s*setLoopFill/.test(appSrc));

console.log('\nSummary: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
