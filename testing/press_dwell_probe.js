// Probe for the press-and-hold click/drag disambiguation (mouse/pen):
//   1. A press ON an object no longer commits anything at mouse-down. The
//      first real move decides:
//        - started within PRESS_DWELL_MS (200 ms)  -> marquee (rubber)
//        - held past the dwell, then dragged       -> select + object drag
//        - released without a real move            -> plain click (select)
//   2. A held second press of a double-click inside a loop drags the
//      double-click selection: the loop plus everything it encloses. A held
//      single press drags the loop's own shape. A quick drag stays a marquee.
//   3. Touch keeps the old behaviour (immediate object drag; any loop drag is
//      the rectangle).
//   4. "Move my selection" presses stay immediate (a line whose points are all
//      selected, inside of a selected loop).
//
// Run: node testing/press_dwell_probe.js
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

console.log('\n== constants ==');
{
  check('the dwell is 200 ms', /const PRESS_DWELL_MS = 200;/.test(appSrc));
  check('the press slop exists', /const PRESS_SLOP_PX = 4;/.test(appSrc));
}

console.log('\n== mouse-down arms pressEntity instead of committing ==');
{
  const down = slice('onPointerDown');
  const pressEntity = down.indexOf("kind: 'pressEntity'");
  check('onPointerDown builds a pressEntity drag', pressEntity > 0);
  check('it records the press time', /downAt: ui\._downAt/.test(down));
  check('touch bypasses the dwell (immediate object drag)',
    /pointerType === 'touch'\)\s*\{\s*beginEntityPress\(/.test(down));
  check('the old immediate commit is gone from the entity branch',
    !/selectOnlySingle\('entity', eh\);/.test(down));
  check('a "move my selection" press stays immediate',
    /entityFullySelectedByPoints\(eh\) && selectionBodyDragFor\(world\)/.test(down));
  check('no double-press machinery remains',
    !/dblPress|DBL_PRESS|lastPress/.test(appSrc));
}

console.log('\n== move: the first real movement decides ==');
{
  const move = slice('onPointerMove');
  const pe = move.indexOf("d.kind === 'pressEntity'");
  const gate = move.indexOf('DRAG_GATE_MS');
  check('pressEntity is handled inside the drag dispatch', pe > 0);
  check('it is decided BEFORE the DRAG_GATE gate', pe > 0 && gate > pe);
  check('jitter under the slop keeps the press waiting',
    /PRESS_SLOP_PX &&\s*\n\s*Math\.abs\(pos\.y - d\.start\.y\) <= PRESS_SLOP_PX\) return;/.test(move));
  check('an early drag converts to a rubber with the same modifiers',
    /kind: 'rubber',\s*\n\s*start: d\.start,\s*\n\s*additive: d\.mods\.add \|\| d\.mods\.sub,\s*\n\s*subtract: d\.mods\.alt,/.test(move));
  check('a held drag activates the object drag and replays the event',
    /beginEntityPress\(d, pos, s2w\(pos\.x, pos\.y\), true\);\s*\n\s*if \(ui\.drag\) onPointerMove\(ev\);/.test(move));
  const rubber = move.indexOf("d.kind === 'rubber'");
  const dwellLoop = move.indexOf('d.deferredLoop && d.mouse && !d.dwellDecided');
  check('the deferred loop decides its dwell inside the rubber branch',
    rubber > 0 && dwellLoop > rubber);
  check('the loop dwell applies the click selection (modifiers included)',
    /applyLoopClick\(d\.deferredLoop, !!m\.add, !!m\.sub, !!m\.alt\)/.test(move));
  check('the loop dwell pushes history BEFORE the drag moves anything',
    /applyLoopClick\(d\.deferredLoop[\s\S]{0,400}pushHistory\(\);\s*\n\s*ui\.drag = at;/.test(move));
}

console.log('\n== up: a release without a real move is a plain click ==');
{
  const up = slice('onPointerUp');
  check('pointerup resolves pressEntity as a click',
    /kind === 'pressEntity'[\s\S]{0,400}beginEntityPress\(d, p, s2w\(p\.x, p\.y\), false\)/.test(up));
  check('a moved pressEntity never reaches pointerup as a click', true);
}

console.log('\n== beginEntityPress: selection rules + optional drag ==');
{
  // a stub world: one line entity, both points, one of them pre-selected
  const w = {
    points: { 1: { id: 1, x: 0, y: 0 }, 2: { id: 2, x: 10, y: 0 } },
    entities: { 7: { id: 7, type: 'line', a: 1, b: 2, color: '#000', layer: 1 } },
    constraints: {}
  };
  let selection = [];
  let historyPushes = 0;
  let dragBuilt = null;
  const fn = new Function(
    'state', 'ui', 'toggleSelect', 'selectOnly', 'selectOnlySingle', 'selected',
    'entityPointIds', 'pushHistory', 'bodyDragFor', 'selectionBodyDragFor',
    'updateUI', 'render',
    slice('beginEntityPress') + '\nreturn beginEntityPress;');
  const begin = fn(
    w,
    { groupSelect: false, selection },
    (kind, id, single) => {           // toggleSelect stub: toggle in a one-slot set
      const has = selection.some(s => s.kind === kind && +s.id === +id);
      selection = has ? [] : [{ kind, id }];
    },
    (kind, id) => { selection = [{ kind, id }]; },
    (kind, id) => { selection = [{ kind, id }]; },
    (kind, id) => selection.some(s => s.kind === kind && +s.id === +id),
    (e) => [e.a, e.b],
    () => { historyPushes++; },
    (e, pos, world, ids) => (dragBuilt = { kind: 'entity', ids, moved: false }),
    () => null,
    () => {}, () => {}
  );

  selection = [];
  historyPushes = 0;
  dragBuilt = null;
  begin({ eid: 7, mods: { add: false, sub: false, alt: false } }, null, null, false);
  check('a click selects the object', selection.length === 1 && +selection[0].id === 7);
  check('a click pushes no history', historyPushes === 0, historyPushes);
  check('a click builds no drag', dragBuilt === null);

  selection = [];
  historyPushes = 0;
  begin({ eid: 7, mods: { add: false, sub: false, alt: false } }, null, null, true);
  check('a dwell drag selects AND arms the body drag',
    selection.length === 1 && dragBuilt && dragBuilt.kind === 'entity');
  check('the drag pushes exactly one history entry', historyPushes === 1, historyPushes);

  selection = [];
  historyPushes = 0;
  dragBuilt = null;
  begin({ eid: 7, mods: { add: true, sub: false, alt: false } }, null, null, false);
  check('a modifier click toggles without a drag',
    historyPushes === 0 && dragBuilt === null);
}

console.log('\n== applyLoopClick forceSelect: a double click never deselects ==');
{
  // square (4 lines, ids 1-4) with one child line (id 9) inside it
  const w = { points: {}, entities: {}, constraints: {} };
  for (let i = 1; i <= 4; i++) w.points[i] = { id: i, x: 0, y: 0 };
  w.points[9] = { id: 9, x: 0, y: 0 };
  w.entities[1] = { id: 1, type: 'line', a: 1, b: 2, color: '#000', layer: 1 };
  w.entities[2] = { id: 2, type: 'line', a: 2, b: 3, color: '#000', layer: 1 };
  w.entities[3] = { id: 3, type: 'line', a: 3, b: 4, color: '#000', layer: 1 };
  w.entities[4] = { id: 4, type: 'line', a: 4, b: 1, color: '#000', layer: 1 };
  w.entities[9] = { id: 9, type: 'line', a: 1, b: 1, color: '#000', layer: 1 };
  let selection = [];
  const fn = new Function(
    'state', 'ui', 'getLoops', 'loopEntities', 'entityEditable', 'loopShapeSelected', 'selected',
    'entitiesInsideLoop', 'markLastPicked', 'updateUI', 'render',
    slice('applyLoopClick') + '\nreturn applyLoopClick;');
  const LOOP = { poly: [1] };
  let inside = [];                       // what entitiesInsideLoop reports
  const uiStub = {
    focusLoop: null,
    get selection() { return selection; },
    set selection(v) { selection = v; }
  };
  const apply = fn(
    w, uiStub,
    () => [LOOP],
    (loop) => [1, 2, 3, 4],
    () => true,
    () => selection.some(s => s.kind === 'entity' && +s.id <= 4),
    (kind, id) => selection.some(s => s.kind === kind && +s.id === +id),
    () => inside,
    () => {},
    () => {}, () => {}
  );
  const ids = () => selection.filter(s => s.kind === 'entity').map(s => +s.id).sort();
  // the first click of the pair selected the loop's own shape
  selection = [{ kind: 'entity', id: 1 }, { kind: 'entity', id: 2 }, { kind: 'entity', id: 3 }, { kind: 'entity', id: 4 }];
  apply(LOOP, false, false, false, true);
  check('double click on a CHILDLESS loop keeps it selected',
    ids().length === 4, JSON.stringify(ids()));
  inside = [9];
  selection = [{ kind: 'entity', id: 1 }, { kind: 'entity', id: 2 }, { kind: 'entity', id: 3 }, { kind: 'entity', id: 4 }];
  apply(LOOP, true, false, false, true);
  check('double click takes the loop and its contents, no toggle',
    ids().join(',') === '1,2,3,4,9', JSON.stringify(ids()));
  inside = [];
  selection = [{ kind: 'entity', id: 1 }, { kind: 'entity', id: 2 }, { kind: 'entity', id: 3 }, { kind: 'entity', id: 4 }];
  apply(LOOP, true, false, false);
  check('Ctrl+click keeps its toggle (all in -> out)',
    ids().length === 0, JSON.stringify(ids()));
  inside = [];
  selection = [];
  apply(LOOP, false, false, false);
  check('a plain click inside the loop selects only its own shape',
    ids().join(',') === '1,2,3,4', JSON.stringify(ids()));
  // and the double-click handler passes forceSelect
  const dbl = slice('onDoubleClick');
  check('onDoubleClick calls the force-select variant',
    /applyLoopClick\(loop, false, false, false, true\)/.test(dbl));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
