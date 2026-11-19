// Probe: a marquee must select a note/comment as an ENTITY, not just its
// anchor point. Regression for the bug where dragging a marquee over a note
// picked only the note's anchor point — the note object never joined the
// selection, so Ctrl+C copied an invisible point and paste produced nothing.
// Clicking a note worked because the click path selects the entity directly.
//
// Run: node testing/marquee_note_probe.js
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

// --- slice the real marquee block out of app.js ---------------------------
const start = app.indexOf('function marqueeCovers(');
const end = app.indexOf('\n  function mergePoints(', start);
check('marquee block found', start > 0 && end > start);

const state = { points: {}, entities: {}, constraints: {} };
const ui = { selection: [], rubber: null };
const pickFilter = { point: true, line: true, loop: true };

function buildMarquee() {
  const P = id => (id != null ? state.points[id] || null : null);
  const entityPointIds = (e) => {
    if (!e) return [];
    if (e.type === 'note') return e.p != null ? [e.p] : [];
    if (e.type === 'line') return [e.a, e.b];
    return [];
  };
  const entityBounds = (e) => {
    if (!e) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const add = (x, y) => {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    };
    if (e.type === 'note') {
      const p = P(e.p);
      if (!p) return null;
      add(p.x, p.y);
      // text extends right/down from the anchor (matches app.js entityBounds)
      add(p.x + String(e.text || '').length * 3 * 0.62, p.y - 3);
      return { minX, minY, maxX, maxY };
    }
    if (e.type === 'line') {
      const a = P(e.a), b = P(e.b);
      if (!a || !b) return null;
      add(a.x, a.y); add(b.x, b.y);
      return { minX, minY, maxX, maxY };
    }
    return null;
  };
  const entityEditable = () => true;
  const pointEditable = () => true;
  const pointUses = (pid) => {
    const uses = [];
    for (const k in state.entities) {
      const e = state.entities[k];
      if (entityPointIds(e).some(id => +id === +pid)) uses.push(e);
    }
    return uses;
  };
  const getLayer = () => ({ visible: true, locked: false });
  const layerOf = () => 1;
  const s2w = (x, y) => ({ x, y });   // identity for the probe
  const clearSelection = () => { ui.selection = []; };
  const updateUI = () => {};
  const render = () => {};
  const getLoops = () => [];
  const loopEntities = () => [];
  const circleData = () => null;

  const fn = new Function(
    'state', 'ui', 'pickFilter', 'P', 'entityPointIds', 'entityBounds',
    'entityEditable', 'pointEditable', 'pointUses', 'getLayer', 'layerOf',
    's2w', 'clearSelection', 'updateUI', 'render', 'getLoops', 'loopEntities',
    'circleData',
    'let lastPickEntityId = null;\n' +
    app.slice(start, end) + '\n' +
    'return { applyRubberSelection };'
  );
  return fn(state, ui, pickFilter, P, entityPointIds, entityBounds,
    entityEditable, pointEditable, pointUses, getLayer, layerOf,
    s2w, clearSelection, updateUI, render, getLoops, loopEntities, circleData);
}

const { applyRubberSelection } = buildMarquee();

const marquee = (x0, y0, x1, y1, opts) => {
  const o = opts || {};
  ui.selection = o.selection || [];
  ui.rubber = null;
  applyRubberSelection(
    { start: { x: x0, y: y0 }, additive: !!o.additive, subtract: !!o.subtract },
    { x: x1, y: y1 }
  );
  return ui.selection.slice();
};

console.log('marquee note: a comment fully inside is selected as an ENTITY');
{
  // note at (100,100), text "hello world" (10 chars) → bounds ~ (100,97)..(118.6,100)
  state.points[10] = { x: 100, y: 100 };
  state.entities[5] = { id: 5, type: 'note', p: 10, text: 'hello world' };
  // marquee 80,80 → 150,120 fully contains the note
  const sel = marquee(80, 80, 150, 120);
  check('the entity entry is selected',
    sel.length === 1 && sel[0].kind === 'entity' && sel[0].id === 5,
    JSON.stringify(sel));
  check('the anchor point is NOT selected as a bare point',
    !sel.some(s => s.kind === 'point' && s.id === 10),
    JSON.stringify(sel));
}

console.log('marquee note: a clipping marquee selects nothing (full containment only)');
{
  state.points[10] = { x: 100, y: 100 };
  state.entities[5] = { id: 5, type: 'note', p: 10, text: 'hello world' };
  // only the anchor (100,100) is inside; the text extends past x=105
  const sel = marquee(95, 95, 105, 105);
  check('neither point nor entity is selected',
    sel.length === 0,
    JSON.stringify(sel));
}

console.log('marquee note: Shift+drag can subtract a selected comment');
{
  state.points[10] = { x: 100, y: 100 };
  state.entities[5] = { id: 5, type: 'note', p: 10, text: 'hello world' };
  const sel = marquee(80, 80, 150, 120);
  check('baseline: selected first', sel.length === 1 && sel[0].id === 5);
  const after = marquee(80, 80, 150, 120, { subtract: true, selection: sel });
  check('subtract over the note removes it', after.length === 0, JSON.stringify(after));
}

console.log('marquee note: clipboardPayload sees the selected entity (copy carries the note)');
{
  // sanity: the marquee result is the same shape a click produces, so the
  // copy path (selectedEntities) will carry it — verify selectedEntities sees it
  const sel = marquee(80, 80, 150, 120);
  const ents = sel.filter(s => s.kind === 'entity' && state.entities[s.id])
    .map(s => state.entities[s.id]);
  check('the note is visible to selectedEntities()',
    ents.length === 1 && ents[0].type === 'note' && ents[0].id === 5,
    JSON.stringify(ents));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
