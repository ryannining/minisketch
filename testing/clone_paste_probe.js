'use strict';
// Copy/paste of a CLONE must produce a visible copy.
//
// The bug: a clone (array, kind 'clone') owns NO points of its own — it points
// at live MASTER entities. clipboardPayload() pulled the masters into the
// payload but never their points, so every pasted master was dropped (a line
// with a null endpoint is skipped). The paste succeeded, the toast appeared, and
// the clone had no masters to draw: an invisible object somewhere nowhere.
//
// This probe lifts the real clipboardPayload/pasteClipboard out of app.js and
// runs them on a miniature document.

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); }
};

function slice(startMarker, endMarker) {
  const i = app.indexOf(startMarker);
  if (i < 0) return '';
  const j = app.indexOf(endMarker, i + 1);
  return j < 0 ? '' : app.slice(i, j);
}

const payloadSrc = slice('function clipboardPayload()', 'function clipboardBounds(');
const boundsSrc = slice('function clipboardBounds(', '// opts.from : payload to paste');
const pasteSrc = slice('function pasteClipboard(opts)', 'function cmdDuplicate');
if (!payloadSrc || !pasteSrc) { console.log('could not lift the functions'); process.exit(1); }

// ---- a miniature world -------------------------------------------------
// one line (points 1,2) as the MASTER of a clone (entity 10).
function makeWorld() {
  let nid = 1000;
  const state = {
    points: { 1: { x: 0, y: 0 }, 2: { x: 100, y: 0 } },
    entities: {
      10: {
        id: 10, type: 'array', kind: 'clone', layer: 1, color: '#000000',
        masters: [5], instances: [{ m: [1, 0, 0, 1, 120, 0], a: [0, 0] }]
      },
      5: { id: 5, type: 'line', a: 1, b: 2, layer: 1, color: '#000000' }
    },
    constraints: {},
    mates: {}
  };
  const ui = {
    selection: [{ kind: 'entity', id: 10 }],
    activeLayer: 1,
    raw: { x: 500, y: 0 },
    lastWorld: { x: 500, y: 0 }
  };
  return { state, ui, next: () => ++nid };
}

const build = (w) => new Function('w', `
  let state = w.state, ui = w.ui;
  let clipboard = null;
  let lastPastePoint = null;
  const CLIP_MARK = '__MINISKETCH__';
  let clipPayloadText = '';
  const W = 800, H = 600, view = { zoom: 1, ox: 0, oy: 0 };
  const geometryEpoch = 1;
  const history = [];
  let docDirty = false;
  const toast = (m) => { w.toasts.push(m); };
  const newId = () => String(w.next());
  const P = (id) => state.points[id] || null;
  const layerOf = (e) => (e && e.layer) || 1;
  const getLayer = (id) => ({ id: Number(id), visible: true, locked: false });
  const s2w = (x, y) => ({ x: x, y: y });
  const selectedEntities = () => ui.selection
    .filter(s => s.kind === 'entity')
    .map(s => state.entities[s.id]).filter(Boolean);
  const entityPointIds = (e) => {
    if (!e) return [];
    if (e.type === 'line') return [e.a, e.b];
    if (e.type === 'circle') return [e.c];
    if (e.type === 'arc') return [e.c, e.s, e.e];
    if (e.type === 'spline') return (e.pts || []).slice();
    if (e.type === 'array') return [];      // a clone owns no points
    return [];
  };
  const selectionPointIds = () => {
    const ids = new Set();
    for (const s of ui.selection) {
      if (s.kind === 'point' && state.points[s.id]) ids.add(+s.id);
      else if (s.kind === 'entity') {
        const e = state.entities[s.id];
        if (e) for (const pid of entityPointIds(e)) ids.add(+pid);
      }
    }
    return ids;
  };
  const constraintInsideSet = () => false;
  const xfBlock = () => false;
  const pushHistory = () => history.push(1);
  const commit = () => {};
  const render = () => {};
  const updateUI = () => {};
  const invalidateLoops = () => {};
  const ensureSplineHandles = () => {};
  const ensureTextAspect = () => {};
  const arrayBuildShapes = (masters) => ({ built: masters.length });
  const requestSolve = () => {};
  const arrayEnsureShapes = () => {};
  ${payloadSrc}
  ${boundsSrc}
  ${pasteSrc}
  return { clipboardPayload, pasteClipboard, setClip: (p) => { clipboard = p; },
           getClip: () => clipboard, state, ui };
`)(w);

console.log('clone: the payload carries the master AND its points');
{
  const w = makeWorld();
  w.toasts = [];
  const M = build(w);
  const p = M.clipboardPayload();
  check('a clone is selected, so a payload exists', !!p);
  check('the clone itself is in the payload',
    p.entities.some(e => e.id === '10' || e.id === 10));
  check('the MASTER entity travels with it',
    p.entities.some(e => (e.id === '5' || e.id === 5) && e.type === 'line'));
  check('the MASTER\'s points travel too (this was the bug)',
    p.points.length >= 2, 'points=' + p.points.length);
  check('the master is listed for rewiring', p.arrayMasters.length === 1);
}

console.log('clone: the paste produces a drawable clone');
{
  const w = makeWorld();
  w.toasts = [];
  const M = build(w);
  const before = Object.keys(M.state.entities).length;
  const p = M.clipboardPayload();
  const ok = M.pasteClipboard({ from: p, at: 'cursor' });
  const ids = Object.keys(M.state.entities);
  check('paste reports success', ok === true);
  check('new entities were created', ids.length > before,
    before + ' -> ' + ids.length);

  const clones = ids.map(i => M.state.entities[i])
    .filter(e => e && e.type === 'array' && e.kind === 'clone' && !w.state.entities[e.id] === false || false);
  const newClone = ids.map(i => M.state.entities[i])
    .find(e => e && e.type === 'array' && e.kind === 'clone' && Number(e.id) > 10);
  check('a new clone exists', !!newClone);
  check('the new clone has a master (not empty)', newClone && Array.isArray(newClone.masters) &&
    newClone.masters.length === 1, newClone ? JSON.stringify(newClone.masters) : '');
  const masterId = newClone && newClone.masters[0];
  const master = masterId != null ? M.state.entities[masterId] : null;
  check('that master is a real, complete line', !!master && master.type === 'line' &&
    master.a != null && master.b != null, JSON.stringify(master));
  check('both master endpoints exist as points',
    master && M.state.points[master.a] && M.state.points[master.b]);
  // The clone sits a fixed 120mm to the right of its master. That RELATIVE
  // placement must survive the paste: the master moved, so the clone moves with
  // it. What must NOT happen is a phantom compensation — that is why the anchor
  // has to equal the pasted master's first point.
  const pastedAnchor = master ? M.state.points[master.a] : null;
  check('the clone keeps its 120mm offset from the master',
    newClone && newClone.instances[0].m[4] === 120,
    newClone ? String(newClone.instances[0].m[4]) : '');
  check('the anchor matches the pasted master (no phantom shift)',
    newClone && pastedAnchor &&
    Math.abs(newClone.instances[0].a[0] - pastedAnchor.x) < 1e-9 &&
    Math.abs(newClone.instances[0].a[1] - pastedAnchor.y) < 1e-9,
    newClone ? JSON.stringify(newClone.instances[0].a) + ' vs ' +
      JSON.stringify(pastedAnchor) : '');
  check('the whole copy landed at the paste point, not back at the origin',
    newClone && newClone.instances[0].a[0] > 100,
    newClone ? String(newClone.instances[0].a[0]) : '');
}

console.log('clone: the source is untouched');
{
  const w = makeWorld();
  w.toasts = [];
  const M = build(w);
  const p = M.clipboardPayload();
  M.pasteClipboard({ from: p, at: 'cursor' });
  check('the original clone still points at the original master',
    JSON.stringify(w.state.entities[10].masters) === '[5]');
  check('the original master line is unchanged',
    w.state.entities[5].a === 1 && w.state.entities[5].b === 2);
  check('the original anchor is unchanged',
    w.state.entities[10].instances[0].a[0] === 0);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
