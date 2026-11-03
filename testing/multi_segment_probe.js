// Probe for selecting MORE THAN ONE segment of a curve path.
//
// A segment is named by its two end points, so "several segments" means
// "several selected points". Two things had to change:
//   * the click handler used to REPLACE the selection on every click unless
//     Ctrl/Shift was held, and even then toggleSelect() could remove a shared
//     end point and break the neighbouring segment;
//   * drawSegmentHighlight() bailed out unless EXACTLY two points were selected,
//     so a multi-segment selection drew no highlight at all.
//
// Run: node testing/multi_segment_probe.js
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

// ---- a world with one 4-node open curve --------------------------------
function makeWorld() {
  const state = {
    points: {
      1: { x: 0, y: 0 }, 2: { x: 10, y: 0 }, 3: { x: 20, y: 0 }, 4: { x: 30, y: 0 }
    },
    entities: {
      10: {
        id: 10, type: 'spline', pts: [1, 2, 3, 4], closed: false, color: '#000000', layer: 1,
        hs: { o: [null, null, null, null], i: [null, null, null, null] }
      }
    },
    constraints: {}, layers: [{ id: 1, visible: true }], nextId: 100
  };
  return { state, ui: { selection: [] } };
}

function build(w) {
  const selIndex = () => {
    const idx = { entity: new Set(), point: new Set(), constraint: new Set() };
    for (const s of w.ui.selection) {
      if (idx[s.kind]) idx[s.kind].add(+s.id);
    }
    return idx;
  };
  return new Function('state', 'ui', 'selectedPointIds', 'selected', 'entityPointIds',
    slice('selectSegment') + '\n' + slice('segmentSelections') + '\n' + slice('segmentPointIds') +
    '\nreturn { selectSegment, segmentSelections, segmentPointIds };'
  )(
    w.state, w.ui,
    () => w.ui.selection.filter(s => s.kind === 'point' && w.state.points[s.id]).map(s => s.id),
    (kind, id) => selIndex()[kind] ? selIndex()[kind].has(+id) : false,
    (e) => (e.type === 'spline' ? (e.pts || []) : [])
  );
}

console.log('\n== Ctrl+click adds a segment instead of replacing ==');
{
  const w = makeWorld();
  const api = build(w);
  // segments 0 (1-2) then 1 (2-3)
  api.selectSegment({ a: 1, b: 2, seg: 0 }, 'add');
  check('the first segment selects its two ends', w.ui.selection.length === 2,
    JSON.stringify(w.ui.selection));
  api.selectSegment({ a: 2, b: 3, seg: 1 }, 'add');
  check('the second segment adds its free end only', w.ui.selection.length === 3,
    JSON.stringify(w.ui.selection));
  check('both segments are implied by the selection',
    api.segmentSelections().length === 2,
    JSON.stringify(api.segmentSelections().map(s => s.seg)));
}

console.log('\n== clicking the same segment again removes it ==');
{
  const w = makeWorld();
  const api = build(w);
  api.selectSegment({ a: 1, b: 2, seg: 0 }, 'add');
  api.selectSegment({ a: 2, b: 3, seg: 1 }, 'add');
  api.selectSegment({ a: 2, b: 3, seg: 1 }, 'add');   // toggle off
  check('the toggled segment is gone', api.segmentSelections().length === 1,
    JSON.stringify(api.segmentSelections().map(s => s.seg)));
  check('the first segment survived', api.segmentSelections()[0].seg === 0);
}

console.log('\n== Shift behaves exactly like Ctrl (toggle) ==');
{
  const w = makeWorld();
  const api = build(w);
  api.selectSegment({ a: 1, b: 2, seg: 0 }, 'toggle');
  api.selectSegment({ a: 2, b: 3, seg: 1 }, 'toggle');
  check('two segments selected', api.segmentSelections().length === 2,
    JSON.stringify(api.segmentSelections().map(s => s.seg)));
  api.selectSegment({ a: 1, b: 2, seg: 0 }, 'toggle');
  check('toggling one off leaves the other', api.segmentSelections().length === 1,
    JSON.stringify(api.segmentSelections().map(s => s.seg)));
  check('and it is the right one', api.segmentSelections()[0].seg === 1);
}

console.log('\n== a run of segments is one drag target ==');
{
  const w = makeWorld();
  const api = build(w);
  api.selectSegment({ a: 1, b: 2, seg: 0 }, 'add');
  api.selectSegment({ a: 2, b: 3, seg: 1 }, 'add');
  api.selectSegment({ a: 3, b: 4, seg: 2 }, 'add');
  const ids = api.segmentPointIds();
  check('all four nodes travel together', ids.length === 4, ids.join(','));
  check('the whole curve is selected', api.segmentSelections().length === 3);
}

console.log('\n== the highlight no longer needs exactly two points ==');
{
  const draw = slice('drawSegmentHighlight');
  check('it does not bail out on a 2-point selection',
    !/sel\.length !== 2/.test(draw), draw.slice(0, 120));
  check('it does not bail out when no POINT is selected',
    !/if \(!sel\.size\) return;/.test(draw));
  check('it walks every span', /for \(let seg = 0; seg < nsegs; seg\+\+\)/.test(draw));
  check('it lights a span when BOTH ends are selected',
    /!sel\.has\(\+ids\[seg\]\) \|\| !sel\.has\(\+ids\[nxt\]\)/.test(draw));
  check('a selected LINE also lights up (polyline segments)',
    /e\.type !== 'line'/.test(draw) && /selectionIndex\(\)\.entity/.test(draw));
  check('a point-selected line lights up too',
    /sel\.has\(\+e\.a\) \|\| !sel\.has\(\+e\.b\)/.test(draw));
  check('select-all does not paint everything amber',
    /selEnts\.size <= 200/.test(draw));
  check('several highlights can be drawn at once', !/if \(any\) return;/.test(draw));
}

console.log('\n== the click handler routes through selectSegment ==');
{
  const src = appSrc;
  check('Ctrl and Shift both toggle', /selectSegment\(seg, 'toggle'\)/.test(src));
  check('neither is treated as a plain remove', !/selectSegment\(seg, subMod \? 'remove'/.test(src));
  check('the drag uses every selected segment point',
    /const dragIds = segmentPointIds\(\)/.test(src));
  check('a plain click still replaces the selection',
    /ui\.selection = \[\{ kind: 'point', id: seg\.a \}, \{ kind: 'point', id: seg\.b \}\]/.test(src));
}

console.log('\n' + (fail ? fail + ' FAILED, ' : 'all ') + pass + ' checks passed');
process.exit(fail ? 1 : 0);
