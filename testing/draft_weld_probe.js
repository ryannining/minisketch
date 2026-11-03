// Probe: welding during drafting must stay inside one colour.
//
// Colour is the operation in KaryaCNC. Drawing a white line that touches a red
// line's point used to reuse that point outright, so the two operations became
// one piece of geometry: dragging the white corner dragged the red line, and the
// point was owned by both. Snapping to the position is still wanted — only the
// merge is not.
//
// Run: node testing/draft_weld_probe.js
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

function makeWorld() {
  const w = {
    state: {
      points: {}, entities: {}, constraints: {},
      layers: [{ id: 1, name: 'Layer 1', visible: true, locked: false }],
      nextId: 900
    },
    ui: { color: '#ffffff', snap: true, showGrid: false, activeLayer: 1 },
    settings: { autoDimension: 'on', nudgeStep: 1 },
    view: { zoom: 1, ox: 0, oy: 0 },
    toasts: []
  };
  w.newId = () => ++w.state.nextId;
  w.P = (id) => w.state.points[+id] || null;
  w.addPoint = (x, y) => { const id = w.newId(); w.state.points[id] = { x, y }; return id; };
  w.toast = (m) => w.toasts.push(String(m));
  w.colorOf = (e) => (e && e.color) || '#000000';
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
  w.snapLineGeometry = () => null;      // point + grid snaps only, for clarity
  w.gridStep = () => 10;
  return w;
}

function build(w) {
  const body = [
    // snapPoint asks the S/G toggle whether snapping is on at all
    slice('snapEnabled'),
    slice('weldAllowed'),
    slice('materializePoint'),
    slice('pointAtWorld'),
    slice('snapPoint')
  ].join('\n');
  return new Function(
    'state', 'ui', 'settings', 'view', 'newId', 'P', 'toast', 'colorOf',
    'entityPointIds', 'pointUses', 'snapLineGeometry', 'gridStep', 'layerOf',
    body + '\nreturn { weldAllowed, materializePoint, pointAtWorld, snapPoint };'
  )(
    w.state, w.ui, w.settings, w.view, w.newId, w.P, w.toast, w.colorOf,
    w.entityPointIds, w.pointUses, w.snapLineGeometry, w.gridStep,
    // welding is refused across layers, so the probe needs the same lookup
    (e) => (e && e.layer != null ? e.layer : 1)
  );
}

// a red line with one point at (0,0)
function redLine(w) {
  const a = w.addPoint(0, 0), b = w.addPoint(50, 0);
  const id = w.newId();
  w.state.entities[id] = { id, type: 'line', a, b, color: '#ff0000', layer: 1 };
  return { id, a, b };
}

// ---- 1. drafting onto another colour's point -------------------------
console.log('\n== drawing white onto a red point snaps without welding ==');
{
  const w = makeWorld();
  const api = build(w);
  const red = redLine(w);

  // the visible snap: same coordinates, same target point, but flagged no-weld
  const snap = api.snapPoint({ x: 0.01, y: 0.01 });
  check('the snap still finds the red point', snap.id === red.a, snap.id);
  check('it is flagged as snap-only', snap.weld === false, snap.weld);

  const pid = api.materializePoint(snap);
  check('drafting creates a NEW point', pid !== red.a, pid + ' vs ' + red.a);
  check('at exactly the same position',
    w.state.points[pid].x === 0 && w.state.points[pid].y === 0,
    JSON.stringify(w.state.points[pid]));
  check('no coincident constraint was added', Object.keys(w.state.constraints).length === 0,
    Object.keys(w.state.constraints).length);

  // now the white line is drawn with its own point; the red line must be untouched
  const white = w.newId();
  const other = w.addPoint(50, 0);
  w.state.entities[white] = { id: white, type: 'line', a: pid, b: other, color: '#ffffff', layer: 1 };
  const redUses = w.pointUses(red.a) || [];
  check('the red point is still owned only by the red line',
    redUses.length === 1 && +redUses[0].id === red.id,
    redUses.map(e => e.id).join(','));
  check('the red line does not reach the white line',
    !(w.pointUses(red.a) || []).some(e => +e.id === white));
}

// ---- 2. drafting onto the same colour still welds --------------------
console.log('\n== drawing white onto a white point still welds ==');
{
  const w = makeWorld();
  const api = build(w);
  const a = w.addPoint(0, 0), b = w.addPoint(50, 0);
  const id = w.newId();
  w.state.entities[id] = { id, type: 'line', a, b, color: '#ffffff', layer: 1 };

  const snap = api.snapPoint({ x: 0.01, y: 0.01 });
  check('the snap is flagged as a weld', snap.weld === true, snap.weld);
  const pid = api.materializePoint(snap);
  check('and it reuses the existing point', pid === a, pid + ' vs ' + a);
  // the real payoff: the next white segment shares the point, so a polyline
  // stays one connected chain when a corner is dragged
  const c2 = w.addPoint(0, 50);
  const second = w.newId();
  w.state.entities[second] = { id: second, type: 'line', a: pid, b: c2, color: '#ffffff', layer: 1 };
  check('which is what keeps a polyline one connected chain',
    (w.pointUses(a) || []).length === 2, (w.pointUses(a) || []).length);
}

// ---- 3. a stray point may always be welded ---------------------------
console.log('\n== a free point is fair game ==');
{
  const w = makeWorld();
  const api = build(w);
  const free = w.addPoint(10, 10);
  const snap = api.snapPoint({ x: 10.02, y: 10.02 });
  check('the snap is a weld', snap.weld === true, snap.weld);
  check('and reuses the free point', api.materializePoint(snap) === free);
}

// ---- 4. a point shared by two colours is not a welding target --------
console.log('\n== a point owned by white AND red does not weld ==');
{
  const w = makeWorld();
  const api = build(w);
  const shared = w.addPoint(0, 0);
  const b1 = w.addPoint(30, 0), b2 = w.addPoint(0, 30);
  const wl = w.newId(), rl = w.newId();
  w.state.entities[wl] = { id: wl, type: 'line', a: shared, b: b1, color: '#ffffff', layer: 1 };
  w.state.entities[rl] = { id: rl, type: 'line', a: shared, b: b2, color: '#ff0000', layer: 1 };
  const snap = api.snapPoint({ x: 0.01, y: 0.01 });
  check('it is snap-only', snap.weld === false, snap.weld);
  check('so the new geometry gets its own point', api.materializePoint(snap) !== shared);
}

// ---- 5. pointAtWorld follows the same rule ---------------------------
console.log('\n== polygons, boxes and curves follow the same rule ==');
{
  const w = makeWorld();
  const api = build(w);
  const red = redLine(w);

  const whitePid = api.pointAtWorld(0, 0);          // default colour = ui.color
  check('a white vertex on a red point gets a new point', whitePid !== red.a,
    whitePid + ' vs ' + red.a);
  check('at the same place',
    w.state.points[whitePid].x === 0 && w.state.points[whitePid].y === 0);
  check('a second call for the same colour reuses that new point',
    api.pointAtWorld(0, 0) === whitePid);

  const redPid = api.pointAtWorld(0, 0, '#ff0000');
  check('an explicitly red vertex does reuse the red point', redPid === red.a,
    redPid + ' vs ' + red.a);
}

// ---- 6. line snaps are unaffected ------------------------------------
console.log('\n== a line snap still leaves its constraint ==');
{
  const w = makeWorld();
  const api = build(w);
  const a = w.addPoint(0, 0), b = w.addPoint(100, 0);
  const l = w.newId();
  w.state.entities[l] = { id: l, type: 'line', a, b, color: '#ffffff', layer: 1 };
  w.ui.showGrid = false;
  api.snapPoint = api.snapPoint;   // no-op, keep the reference explicit
  // emulate a midpoint snap (no point under the cursor)
  const mid = api.materializePoint({ x: 50, y: 0, midId: l });
  check('a new point is created', !!w.state.points[mid]);
  check('with a midpoint constraint', Object.values(w.state.constraints)
    .some(c => c.type === 'midpoint' && +c.entity === l),
    JSON.stringify(Object.values(w.state.constraints)));
  check('and no welding happened', mid !== a && mid !== b);
}

// ---- 7. another LAYER is reference only: snap, never weld ------------
console.log('\n== a point on another layer is snap-only ==');
{
  const w = makeWorld();
  const api = build(w);
  const a = w.addPoint(0, 0), b = w.addPoint(50, 0);
  const ref = w.newId();
  // same colour, same spot — only the LAYER differs, which is what this checks
  w.state.entities[ref] = { id: ref, type: 'line', a, b, color: '#ffffff', layer: 2 };
  w.ui.activeLayer = 1;

  const snap = api.snapPoint({ x: 0.01, y: 0.01 });
  check('the snap still finds the reference point', snap.id === a, snap.id);
  check('but it is flagged as snap-only, not a weld', snap.weld === false, snap.weld);

  const pid = api.materializePoint(snap);
  check('drafting creates a NEW point', pid !== a, pid + ' vs ' + a);
  const p = w.state.points[pid];
  const ref0 = w.state.points[a];
  check('at exactly the reference position',
    Math.abs(p.x - ref0.x) < 1e-9 && Math.abs(p.y - ref0.y) < 1e-9,
    p.x + ',' + p.y);
  check('the reference point is still owned only by layer 2',
    (w.pointUses(a) || []).every(e => +e.id === ref),
    (w.pointUses(a) || []).map(e => e.id + '@' + e.layer).join(','));

  // and the same-layer case still welds
  w.state.entities[ref].layer = 1;
  check('the same point on the ACTIVE layer welds again',
    api.weldAllowed(a, '#ffffff') === true);
  w.state.entities[ref].layer = 2;
  check('and back on layer 2 it does not',
    api.weldAllowed(a, '#ffffff') === false);
}

console.log('\n' + (fail ? fail + ' FAILED, ' : 'all ') + pass + ' checks passed');
process.exit(fail ? 1 : 0);
