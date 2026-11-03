// Probe for the two new snap targets and the undo/view setting:
//   * the origin (0,0) snaps like a feature point
//   * the centroid of a closed loop snaps as a VIRTUAL point — materializePoint
//     creates a point there but never invents a constraint for it
//   * undo does not move the viewport unless "Undo moves view" is on
//
// Run: node testing/snap_virtual_probe.js
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

// ---- a square loop, centred at (0,0) after the coordinate merge ----------
const world = {
  points: { 1: { x: -10, y: -10 }, 2: { x: 10, y: -10 }, 3: { x: 10, y: 10 }, 4: { x: -10, y: 10 } },
  entities: {
    10: { id: 10, type: 'line', a: 1, b: 2, color: '#000', layer: 1 },
    11: { id: 11, type: 'line', a: 2, b: 3, color: '#000', layer: 1 },
    12: { id: 12, type: 'line', a: 3, b: 4, color: '#000', layer: 1 },
    13: { id: 13, type: 'line', a: 4, b: 1, color: '#000', layer: 1 }
  },
  constraints: {},
  layers: [{ id: 1, visible: true }], nextId: 100
};
const ui = { activeLayer: 1, snap: true, showGrid: false, color: '#000000' };
const getLoops = () => {
  // built from the live points, so moving the square moves its loop
  const p = (id) => world.points[id];
  const poly = [1, 2, 3, 4, 1].map(id => ({ ...p(id) }));
  return [{ poly, area: 400, steps: [] }];
};

const api = new Function(
  'state', 'ui', 'view', 'newId', 'P', 'layerVisible', 'clamp', 'gridStep',
  'weldAllowed', 'getLoops', 'settings',
  slice('snapEnabled') + '\n' + slice('snapPoint') + '\n' + slice('snapLoopCentroid') + '\n' + slice('snapLineGeometry') +
  '\n' + slice('materializePoint') +
  '\nreturn { snapPoint, snapLoopCentroid, materializePoint };'
)(
  world, ui, { zoom: 1 }, () => world.nextId++, (id) => world.points[id], () => true,
  (v, lo, hi) => Math.min(hi, Math.max(lo, v)), () => 10,
  () => true, getLoops, { autoDimension: 'on' }
);

console.log('\n== the origin snaps like a feature point ==');
{
  const s = api.snapPoint({ x: 0.8, y: -0.7 });
  check('the cursor near (0,0) snaps to the origin', s.x === 0 && s.y === 0, JSON.stringify(s));
  check('it is marked as the origin', s.origin === true);
  check('no entity id rides along (nothing to weld)', s.id == null);
}

console.log('\n== the loop centroid is a virtual snap target ==');
{
  // the centroid of this square is (0,0); move the query far from the origin so
  // the origin snap cannot win
  const far = { x: 0, y: 0 };
  const q = { x: 0.5, y: 0.5 };
  const nearOrigin = api.snapPoint({ x: 0.2, y: -0.2 });
  check('near the middle, the origin wins over the centroid', nearOrigin.origin === true);

  // move the square away so its centroid is elsewhere
  for (const key in world.points) {
    world.points[key].x += 100;
    world.points[key].y += 50;
  }
  const s = api.snapPoint({ x: 100.5, y: 50.4 });
  check('the centroid of the loop is found', s.virtual === true, JSON.stringify(s));
  check('it is at the square\'s centre (100, 50)',
    Math.abs(s.x - 100) < 1e-6 && Math.abs(s.y - 50) < 1e-6, JSON.stringify(s));
  check('it is flagged as coming from a loop', s.loop === true);

  const pid = api.materializePoint(s);
  check('materializePoint creates a real point there',
    world.points[pid] && world.points[pid].x === 100 && world.points[pid].y === 50);
  const added = Object.values(world.constraints)
    .filter(c => +c.p === +pid);
  check('with NO constraint invented for it', added.length === 0,
    JSON.stringify(added));
}

console.log('\n== undo does not move the viewport by default ==');
{
  check('the setting exists and defaults to off',
    /key: 'undoRestoresView'[\s\S]{0,200}def: 'off'/.test(appSrc));
  check('applySnapshot only restores the view when the setting allows it',
    /settings\.undoRestoresView === 'on'\) view = data\.view/.test(appSrc));
  check('the Tool menu carries the toggle', /id="menu-undoview"/.test(appSrc) ||
    fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').includes('id="menu-undoview"'));
  check('the toggle is wired', /tgl-undoview/.test(appSrc) &&
    fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').includes('id="tgl-undoview"'));
}

console.log('\n' + (fail ? fail + ' FAILED, ' : 'all ') + pass + ' checks passed');
process.exit(fail ? 1 : 0);
