// Probe for the press/drag disambiguation (mouse/pen):
//   1. Lines, points and every other DIRECT object drag IMMEDIATELY: pressing
//      on one selects it and arms the body drag at once — no time gate, no
//      accidental marquee. A release without a real move pops the drag's
//      history entry, so a plain click still just selects.
//   2. Only a press inside a FILL LOOP keeps the time-gated marquee:
//        - a drag that starts within PRESS_DWELL_MS (200 ms) -> marquee
//          (rubber rectangle selection)
//        - held past the dwell, then dragged -> select the loop + move it
//        - released without a real move -> plain click (select the loop)
//   3. Touch keeps the old rule for loops: any drag is the rectangle. Direct
//      objects drag immediately, same as mouse.
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

console.log('\n== mouse-down: direct objects commit immediately, loops are gated ==');
{
  const down = slice('onPointerDown');
  check('a press on a line arms the drag right away (no gate)',
    /beginEntityPress\(\{ eid: eh, mods: \{ add: addMod, sub: subMod, alt: ev\.altKey \} \}, pos, world, true\);/.test(down));
  check('no pressEntity waiter kind is built anymore', !/pressEntity/.test(appSrc));
  check('the fill-loop branch still builds a gated rubber with deferredLoop',
    /deferredLoop: loop/.test(down));
  check('the loop dwell is armed at 200 ms',
    /armDragFeedback\(ui\.drag, PRESS_DWELL_MS, 'loop-dwell'\)/.test(down));
  check('empty-space presses still start the classic rubber',
    /kind: 'rubber', start: pos, additive: addMod \|\| subMod, subtract: ev\.altKey \|\| ui\.altToggle, crossLayer: !!\(ev\.ctrlKey && ev\.shiftKey\)/.test(down));
  check('touch bypasses the loop dwell (any drag is the rectangle)',
    /mouse: ev\.pointerType !== 'touch'/.test(down));
}

console.log('\n== move: only the loop dwell is decided by time ==');
{
  const move = slice('onPointerMove');
  check('no pressEntity branch remains in the drag dispatch',
    !/pressEntity/.test(move));
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
  check('pointerup pops the history of a never-moved drag (plain click)',
    /if \(!d\.moved\) \{\s*\n\s*history\.pop\(\);/.test(up));
  check('no pressEntity click-resolution path remains', !/pressEntity/.test(up));
}

console.log('\n== beginEntityPress: selection rules + the immediate drag ==');
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
    'flashSelectToolReady', 'updateUI', 'render',
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
    () => {},
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
  check('a press selects AND arms the body drag in one step',
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
    'entitiesInsideLoop', 'markLastPicked', 'lastPickEntityId', 'updateUI', 'render',
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
    null,
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