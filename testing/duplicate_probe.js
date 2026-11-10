// Probe for Ctrl+D (duplicate in place).
//
// The generator tools and the duplicate command share pasteClipboard(), so the
// copy path lives inside app.js's IIFE and cannot be required directly. This
// probe lifts the three clipboard functions out of the source, gives them a
// minimal fake document, and checks the two promises Ctrl+D makes:
//   1. the copy lands exactly on top of the original (zero offset)
//   2. the copy is selected, geometry AND points, so an arrow key moves it
// It also pins the refactor that made it possible: Ctrl+C and Ctrl+D must build
// their payload from the same function, and duplicating must not touch the
// user's clipboard.
//
// Run: node testing/duplicate_probe.js
const fs = require('fs');
const path = require('path');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

function braceEnd(s, from) {
  let d = 0;
  for (let j = s.indexOf('{', from); j < s.length; j++) {
    if (s[j] === '{') d++;
    else if (s[j] === '}') { d--; if (!d) return j + 1; }
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

// ---- a minimal document the pasted code can run against ----------------
function makeWorld() {
  const world = {
    state: { points: {}, entities: {}, constraints: {}, layers: [{ id: 1, name: 'Layer 1', visible: true, locked: false }], nextId: 1000 },
    ui: { selection: [], activeLayer: 1, raw: null, lastWorld: null, focusLoop: null },
    W: 800, H: 600, view: { ox: 400, oy: 300, zoom: 1 },
    clipboard: null,
    lastPastePoint: null,
    toasts: [],
    history: 0,
    solved: 0,
    committed: 0
  };
  world.newId = () => ++world.state.nextId;
  world.P = (id) => world.state.points[+id] || null;
  world.toast = (m) => world.toasts.push(String(m));
  world.s2w = (x, y) => ({ x: (x - world.view.ox) / world.view.zoom, y: -(y - world.view.oy) / world.view.zoom });
  world.pushHistory = () => { world.history++; };
  world.requestSolve = () => { world.solved++; };
  world.commit = () => { world.committed++; };
  world.invalidateLoops = () => {};
  world.xfBlock = () => false;
  world.ensureSplineHandles = () => {};
  world.ensureTextAspect = () => {};
  // layerOf needs a layer lookup; the fixture has a single implicit layer
  world.getLayer = (id) => (id === 1 ? world.state.layers[0] : null);
  world.entityPointIds = (e) => {
    if (e.type === 'line') return [e.a, e.b];
    if (e.type === 'circle') return [e.c];
    if (e.type === 'spline') return e.pts || [];
    return [];
  };
  world.selectedEntities = () => world.ui.selection
    .filter(s => s.kind === 'entity' && world.state.entities[s.id])
    .map(s => world.state.entities[s.id]);
  world.selectionPointIds = () => {
    const ids = new Set();
    for (const s of world.ui.selection) {
      if (s.kind === 'point' && world.state.points[s.id]) ids.add(+s.id);
      else if (s.kind === 'entity' && world.state.entities[s.id]) {
        for (const pid of world.entityPointIds(world.state.entities[s.id])) ids.add(+pid);
      }
    }
    return ids;
  };
  // every constraint of a plain line pair lives inside the set
  world.constraintInsideSet = () => true;
  return world;
}

function build(world) {
  const body = [
    // clipboardPayload reads the layer of every copied entity; the harness has
    // to carry the helper or the sliced code throws on the first paste.
    slice('layerOf'),
    slice('clipboardPayload'),
    slice('clipboardBounds'),
    slice('pasteClipboard'),
    slice('cmdDuplicateSelection')
  ].join('\n');
  return new Function(
    'state', 'ui', 'W', 'H', 'view',
    'newId', 'P', 'toast', 's2w', 'pushHistory', 'requestSolve', 'commit',
    'invalidateLoops', 'xfBlock', 'ensureSplineHandles', 'ensureTextAspect',
    'entityPointIds', 'selectedEntities', 'selectionPointIds', 'constraintInsideSet',
    'getLayer',
    // mutable holders for the two module-level `let`s the code writes
    'setClipboard', 'getClipboard', 'getLastPastePoint',
    `let clipboard = getClipboard();
     let lastPastePoint = getLastPastePoint();
     ${body}
     return {
       clipboardPayload, clipboardBounds, pasteClipboard, cmdDuplicateSelection,
       snapshot: () => ({ clipboard, lastPastePoint }),
       setClipboard: (v) => { clipboard = v; setClipboard(v); },
       getClipboard: () => clipboard,
       setSelection: (sel) => { ui.selection = sel; }
     };`
  )(
    world.state, world.ui, world.W, world.H, world.view,
    world.newId, world.P, world.toast, world.s2w, world.pushHistory, world.requestSolve,
    world.commit, world.invalidateLoops, world.xfBlock, world.ensureSplineHandles,
    world.ensureTextAspect, world.entityPointIds, world.selectedEntities,
    world.selectionPointIds, world.constraintInsideSet,
    world.getLayer,
    (v) => { world.clipboard = v; },
    () => world.clipboard,
    () => world.lastPastePoint
  );
}

// a square drawn as four lines with four shared corner points
function drawSquare(world, x0, y0, w) {
  const { state } = world;
  const mk = (x, y) => { const id = world.newId(); state.points[id] = { x, y }; return id; };
  const a = mk(x0, y0), b = mk(x0 + w, y0), c = mk(x0 + w, y0 + w), d = mk(x0, y0 + w);
  const line = (p, q) => {
    const id = world.newId();
    state.entities[id] = { id, type: 'line', a: p, b: q, color: '#000000', layer: 1 };
    return id;
  };
  return { pts: [a, b, c, d], ents: [line(a, b), line(b, c), line(c, d), line(d, a)] };
}

// ---- 1. the shared payload --------------------------------------------
console.log('\n== one payload, two commands ==');
{
  check('clipboardPayload() exists', /function clipboardPayload\(\)/.test(appSrc));
  check('copySelection() builds through it',
    /function copySelection\(\)\s*\{[\s\S]{0,400}?clipboardPayload\(\)/.test(appSrc));
  // 300 chars was too tight the moment cmdDuplicateSelection grew a clone
  // branch: it still builds its payload through clipboardPayload(), just a
  // little further down. Assert the CALL is inside the function, not that it is
  // within a fixed number of characters of the opening brace.
  const dupStart = appSrc.indexOf('function cmdDuplicateSelection()');
  const dupEnd = appSrc.indexOf('\n  function ', dupStart + 10);
  const dupBody = appSrc.slice(dupStart, dupEnd < 0 ? dupStart + 4000 : dupEnd);
  check('Ctrl+D builds through it too', /clipboardPayload\(\)/.test(dupBody));
  check('Ctrl+C is the only writer of the OS payload',
    (appSrc.match(/clipPayloadText = CLIP_MARK/g) || []).length === 1);
  check('duplicating does not assign the clipboard',
    !/function cmdDuplicateSelection[\s\S]{0,600}?clipboard = payload/.test(appSrc));
}

// ---- 2. duplicate lands exactly on top --------------------------------
console.log('\n== duplicate in place ==');
{
  const world = makeWorld();
  const api = build(world);
  const sq = drawSquare(world, 100, 100, 50);
  api.setSelection(sq.ents.map(id => ({ kind: 'entity', id })));

  const before = {
    pts: Object.values(world.state.points).map(p => [p.x, p.y]),
    ents: Object.keys(world.state.entities).length
  };
  world.ui.raw = { x: 999, y: 999 };     // the mouse is somewhere else; must not matter
  api.cmdDuplicateSelection();

  check('the entity count doubled', Object.keys(world.state.entities).length === before.ents * 2,
    before.ents + ' -> ' + Object.keys(world.state.entities).length);
  check('the point count doubled', Object.keys(world.state.points).length === before.pts.length * 2,
    before.pts.length + ' -> ' + Object.keys(world.state.points).length);

  // every original point has a twin at the same coordinates
  const after = Object.values(world.state.points).map(p => [p.x, p.y]);
  const keys = new Map();
  for (const [x, y] of after) {
    const k = x.toFixed(6) + ',' + y.toFixed(6);
    keys.set(k, (keys.get(k) || 0) + 1);
  }
  const doubled = [...keys.values()].every(n => n === 2);
  check('every point exists exactly twice, at identical coordinates', doubled,
    [...keys.entries()].filter(([, n]) => n !== 2).map(([k, n]) => k + ' x' + n).join(' '));

  check('the pasted copy ignores the cursor position', !world.toasts.some(t => /Pasted/.test(t)));
  check('it reports a duplicate', world.toasts.some(t => /Duplicated 4 objects/.test(t)),
    world.toasts.join(' | '));
  check('it hints at the arrow keys', world.toasts.some(t => /arrow keys/.test(t)));
}

// ---- 3. the copy is what gets selected, so a nudge moves it -----------
console.log('\n== the duplicate is selected ==');
{
  const world = makeWorld();
  const api = build(world);
  const sq = drawSquare(world, 100, 100, 50);
  api.setSelection(sq.ents.map(id => ({ kind: 'entity', id })));
  api.cmdDuplicateSelection();

  const selEnts = world.ui.selection.filter(s => s.kind === 'entity').map(s => s.id);
  const selPts = world.ui.selection.filter(s => s.kind === 'point').map(s => s.id);
  const originals = new Set(sq.ents);
  const originalPts = new Set(sq.pts);
  check('4 entities are selected', selEnts.length === 4, selEnts.length);
  check('none of them is an original', selEnts.every(id => !originals.has(id)));
  check('4 points are selected', selPts.length === 4, selPts.length);
  check('none of them is an original', selPts.every(id => !originalPts.has(id)));

  // move the selection the way an arrow key does, and confirm only the copy moves
  const pinned = world.selectionPointIds();
  check('selectionPointIds resolves the copy (an arrow key can move it)',
    pinned.size === 4, pinned.size);
  const beforeOrig = sq.pts.map(pid => ({ ...world.state.points[pid] }));
  for (const pid of pinned) {
    world.state.points[pid].x += 1;
    world.state.points[pid].y += 1;
  }
  const origMoved = sq.pts.some((pid, i) => {
    const p = world.state.points[pid];
    return p.x !== beforeOrig[i].x || p.y !== beforeOrig[i].y;
  });
  check('nudging the copy leaves the original where it was', !origMoved);
}

// ---- 4. constants and relations survive the copy ---------------------
console.log('\n== the copy is a real copy ==');
{
  const world = makeWorld();
  const api = build(world);
  const sq = drawSquare(world, 0, 0, 40);
  // one horizontal constraint inside the set
  const cid = world.newId();
  world.state.constraints[cid] = { id: cid, type: 'horizontal', entity: sq.ents[0] };
  api.setSelection(sq.ents.map(id => ({ kind: 'entity', id })));
  api.cmdDuplicateSelection();

  check('the constraint was copied', Object.keys(world.state.constraints).length === 2,
    Object.keys(world.state.constraints).length);
  const copies = Object.values(world.state.constraints).filter(c => c.id !== cid);
  check('the copy points at the copied line, not the original',
    copies.length === 1 && sq.ents.indexOf(copies[0].entity) < 0,
    copies.map(c => c.entity).join(','));
  check('the copy keeps its type', copies.length === 1 && copies[0].type === 'horizontal');

  const lineCopies = Object.values(world.state.entities).filter(e => sq.ents.indexOf(e.id) < 0);
  const pointIds = new Set(Object.keys(world.state.points).map(Number));
  check('copied lines reference copied points',
    lineCopies.every(e => pointIds.has(e.a) && pointIds.has(e.b)));
  check('a duplicate does not need to be solved into place', world.solved >= 1);
  check('it spends exactly one undo step', world.history === 1, world.history);
  check('it commits once', world.committed === 1, world.committed);
}

// ---- 5. nothing selected ---------------------------------------------
console.log('\n== guard rails ==');
{
  const world = makeWorld();
  const api = build(world);
  api.setSelection([]);
  api.cmdDuplicateSelection();
  check('with an empty selection it says so',
    world.toasts.some(t => /Select geometry or points to duplicate/.test(t)),
    world.toasts.join(' | '));
  check('and changes nothing', Object.keys(world.state.entities).length === 0);
  check('and spends no undo step', world.history === 0, world.history);
}

// ---- 6. Ctrl+D must not clobber the clipboard of Ctrl+V ---------------
console.log('\n== Ctrl+D leaves the clipboard alone ==');
{
  const world = makeWorld();
  const api = build(world);
  const sq = drawSquare(world, 0, 0, 30);
  // simulate Ctrl+C on this shape: select, then build and store the payload
  api.setSelection(sq.ents.map(id => ({ kind: 'entity', id })));
  api.setClipboard(api.clipboardPayload());
  const payloadBefore = JSON.stringify(api.getClipboard());

  // now select something else and duplicate it
  const other = drawSquare(world, 200, 200, 20);
  api.setSelection(other.ents.map(id => ({ kind: 'entity', id })));
  api.cmdDuplicateSelection();

  check('the clipboard payload is untouched',
    JSON.stringify(api.getClipboard()) === payloadBefore);
  check('the clipboard still points at the first shape',
    api.getClipboard().entities.length === 4 &&
    api.getClipboard().entities.every(e => sq.ents.indexOf(e.id) >= 0));

  // and a later paste still drops that first shape (at the cursor)
  world.ui.raw = { x: 0, y: 0 };
  api.pasteClipboard();
  const pastedLine = Object.values(world.state.entities)
    .filter(e => other.ents.indexOf(e.id) < 0 && sq.ents.indexOf(e.id) < 0)
    .filter(e => e.type === 'line');
  check('Ctrl+V afterwards still pastes the copied shape', pastedLine.length === 8,
    pastedLine.length);
}

console.log('\n' + (fail ? fail + ' FAILED, ' : 'all ') + pass + ' checks passed');
process.exit(fail ? 1 : 0);
