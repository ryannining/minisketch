// Probe: N (select connected) must not cross a colour boundary.
//
// Reported: two loops in different colours had their points stacked (or a few
// hundredths of a millimetre apart). Selecting a point on the white line and
// pressing N also pulled in the red point sitting under it.
//
// Two holes were found:
//   1. the point merge (points closer than JOIN_TOL are one joint) ignored the
//      colour rule the entities already followed, so a coincident point of the
//      other colour joined the selection;
//   2. when no seed colour could be resolved, the colour filter switched itself
//      off entirely and the walk spread over the whole drawing.
//
// Run: node testing/select_connected_probe.js
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

const JOIN_TOL = 0.1;

function makeWorld() {
  const w = {
    state: {
      points: {}, entities: {}, constraints: {},
      layers: [{ id: 1, name: 'Layer 1', visible: true, locked: false }],
      nextId: 500
    },
    ui: { selection: [], activeLayer: 1, hover: null, focusLoop: null },
    toasts: [], renders: 0, updates: 0
  };
  w.newId = () => ++w.state.nextId;
  w.P = (id) => w.state.points[+id] || null;
  w.addPoint = (x, y) => { const id = w.newId(); w.state.points[id] = { x, y }; return id; };
  w.toast = (m) => w.toasts.push(String(m));
  w.colorOf = (e) => (e && e.color) || '#000000';
  w.layerOf = (e) => (e && e.layer != null ? e.layer : 1);
  w.entityPointIds = (e) => {
    if (!e) return [];
    if (e.type === 'line') return [e.a, e.b];
    if (e.type === 'spline') return e.pts || [];
    return [];
  };
  w.pointUses = (pid) => {
    const out = [];
    for (const eid in w.state.entities) {
      const e = w.state.entities[eid];
      for (const q of w.entityPointIds(e)) {
        if (+q === +pid) { out.push(e); break; }
      }
    }
    return out.length ? out : null;
  };
  w.selectedEntities = () => w.ui.selection
    .filter(s => s.kind === 'entity' && w.state.entities[s.id])
    .map(s => w.state.entities[s.id]);
  w.selectedPointIds = () => w.ui.selection
    .filter(s => s.kind === 'point' && w.state.points[s.id])
    .map(s => s.id);
  w.updateUI = () => { w.updates++; };
  w.render = () => { w.renders++; };
  return w;
}

function build(w) {
  return new Function(
    'state', 'ui', 'colorOf', 'layerOf', 'entityPointIds', 'pointUses',
    'selectedEntities', 'selectedPointIds', 'toast', 'updateUI', 'render',
    'JOIN_TOL',
    slice('cmdSelectConnected') + '\nreturn cmdSelectConnected;'
  )(
    w.state, w.ui, w.colorOf, w.layerOf, w.entityPointIds, w.pointUses,
    w.selectedEntities, w.selectedPointIds, w.toast, w.updateUI, w.render,
    JOIN_TOL
  );
}

// a closed loop of n lines in one colour
function loop(w, colour, cx, cy, r, n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = Math.PI * 2 * i / n;
    pts.push(w.addPoint(cx + r * Math.cos(a), cy + r * Math.sin(a)));
  }
  const ids = [];
  for (let i = 0; i < n; i++) {
    const id = w.newId();
    w.state.entities[id] = {
      id, type: 'line', a: pts[i], b: pts[(i + 1) % n], color: colour, layer: 1
    };
    ids.push(id);
  }
  return { pts, ids };
}

const selEntities = (w) => w.ui.selection.filter(s => s.kind === 'entity').map(s => s.id);
const selPoints = (w) => w.ui.selection.filter(s => s.kind === 'point').map(s => s.id);
const coloursOf = (w, ids) => [...new Set(ids.map(id => w.state.entities[id].color))];

// ---- 1. coincident points, different colours ---------------------------
console.log('\n== a stacked red point does not join the white chain ==');
{
  const w = makeWorld();
  const cmd = build(w);
  const white = loop(w, '#ffffff', 0, 0, 40, 4);
  // the red loop shares the white loop's first point GEOMETRICALLY (a separate
  // point id on the same spot, exactly what happens after drawing over an edge)
  const redStart = w.addPoint(w.state.points[white.pts[0]].x, w.state.points[white.pts[0]].y);
  const rest = [
    w.addPoint(80, 0), w.addPoint(80, 40), w.addPoint(40, 40)
  ];
  const chain = [redStart].concat(rest);
  const redIds = [];
  for (let i = 0; i < chain.length; i++) {
    const id = w.newId();
    w.state.entities[id] = {
      id, type: 'line', a: chain[i], b: chain[(i + 1) % chain.length],
      color: '#ff0000', layer: 1
    };
    redIds.push(id);
  }

  w.ui.selection = [{ kind: 'point', id: white.pts[0] }];
  cmd();

  const ents = selEntities(w);
  check('all four white lines are selected', white.ids.every(id => ents.indexOf(id) >= 0),
    ents.length + ' of ' + white.ids.length);
  check('no red line is selected', redIds.every(id => ents.indexOf(id) < 0),
    redIds.filter(id => ents.indexOf(id) >= 0).length + ' red leaked');
  check('only white geometry is in the selection',
    coloursOf(w, ents).length === 1 && coloursOf(w, ents)[0] === '#ffffff',
    coloursOf(w, ents).join(','));

  const pts = selPoints(w);
  check('the coincident red POINT is not selected either',
    pts.indexOf(redStart) < 0, pts.indexOf(redStart));
  check('all four white points are selected',
    white.pts.every(p => pts.indexOf(p) >= 0), pts.length);
}

// ---- 2. the same, but a hair apart instead of exactly on top ----------
console.log('\n== a red point 0.05 mm away does not join either ==');
{
  const w = makeWorld();
  const cmd = build(w);
  const white = loop(w, '#ffffff', 0, 0, 40, 4);
  const p0 = w.state.points[white.pts[0]];
  const redStart = w.addPoint(p0.x + 0.05, p0.y + 0.05);
  const rest = [w.addPoint(80, 0), w.addPoint(80, 40), w.addPoint(40, 40)];
  const chain = [redStart].concat(rest);
  const redIds = [];
  for (let i = 0; i < chain.length; i++) {
    const id = w.newId();
    w.state.entities[id] = {
      id, type: 'line', a: chain[i], b: chain[(i + 1) % chain.length],
      color: '#ff0000', layer: 1
    };
    redIds.push(id);
  }
  w.ui.selection = [{ kind: 'point', id: white.pts[0] }];
  cmd();
  check('the white loop is selected', white.ids.every(id => selEntities(w).indexOf(id) >= 0));
  check('the red loop is not', redIds.every(id => selEntities(w).indexOf(id) < 0));
  check('and its near point is not in the point selection',
    selPoints(w).indexOf(redStart) < 0, selPoints(w).indexOf(redStart));
}

// ---- 3. genuine joins inside one colour still work --------------------
console.log('\n== a hairline gap inside one colour still joins ==');
{
  const w = makeWorld();
  const cmd = build(w);
  // two halves of a white loop whose shared corner is 0.05 mm apart
  const a = w.addPoint(0, 0), b = w.addPoint(40, 0), c = w.addPoint(40, 40);
  const c2 = w.addPoint(40.05, 40.03), d = w.addPoint(0, 40);
  const l1 = w.newId(), l2 = w.newId(), l3 = w.newId();
  w.state.entities[l1] = { id: l1, type: 'line', a, b, color: '#ffffff', layer: 1 };
  w.state.entities[l2] = { id: l2, type: 'line', a: b, b: c, color: '#ffffff', layer: 1 };
  w.state.entities[l3] = { id: l3, type: 'line', a: c2, b: d, color: '#ffffff', layer: 1 };
  w.ui.selection = [{ kind: 'point', id: a }];
  cmd();
  check('the chain crosses the 0.05 mm gap', selEntities(w).length === 3, selEntities(w).length);
  check('and both sides of the gap are in the point selection',
    selPoints(w).indexOf(c) >= 0 && selPoints(w).indexOf(c2) >= 0,
    selPoints(w).length + ' points');
}

// ---- 4. a stray point must not select the whole drawing ---------------
console.log('\n== a stray point selects nothing ==');
{
  const w = makeWorld();
  const cmd = build(w);
  loop(w, '#ffffff', 0, 0, 40, 4);
  loop(w, '#ff0000', 200, 0, 40, 4);
  const stray = w.addPoint(999, 999);
  w.ui.selection = [{ kind: 'point', id: stray }];
  cmd();
  check('no entity is selected', selEntities(w).length === 0, selEntities(w).length);
  check('and it says why', w.toasts.some(t => /not part of any object/.test(t)),
    w.toasts.join(' | '));
}

// ---- 5. an entity selection still works per colour --------------------
console.log('\n== selecting an entity keeps the colour rule ==');
{
  const w = makeWorld();
  const cmd = build(w);
  const white = loop(w, '#ffffff', 0, 0, 40, 4);
  const red = loop(w, '#ff0000', 0, 0, 40, 4);   // exactly on top, different colour
  w.ui.selection = [{ kind: 'entity', id: white.ids[0] }];
  cmd();
  const ents = selEntities(w);
  check('the white loop is fully selected',
    white.ids.every(id => ents.indexOf(id) >= 0), ents.length);
  check('the red loop sharing the same coordinates is not',
    red.ids.every(id => ents.indexOf(id) < 0),
    red.ids.filter(id => ents.indexOf(id) >= 0).length + ' red leaked');
}

// ---- 6. the same point id shared by two colours ----------------------
console.log('\n== a point genuinely shared by two colours ==');
{
  const w = makeWorld();
  const cmd = build(w);
  // one corner point used by both a white and a red line
  const shared = w.addPoint(0, 0);
  const a2 = w.addPoint(40, 0), b2 = w.addPoint(0, 40);
  const a3 = w.addPoint(-40, 0), b3 = w.addPoint(0, -40);
  const wl = w.newId(), rl = w.newId();
  w.state.entities[wl] = { id: wl, type: 'line', a: shared, b: a2, color: '#ffffff', layer: 1 };
  w.state.entities[rl] = { id: rl, type: 'line', a: shared, b: a3, color: '#ff0000', layer: 1 };
  w.ui.selection = [{ kind: 'entity', id: wl }];
  cmd();
  check('only the white line is selected', selEntities(w).length === 1 &&
    selEntities(w)[0] === wl, selEntities(w).join(','));
  check('the shared corner is selected (it belongs to the white line)',
    selPoints(w).indexOf(shared) >= 0);
}

console.log('\n' + (fail ? fail + ' FAILED, ' : 'all ') + pass + ' checks passed');
process.exit(fail ? 1 : 0);
