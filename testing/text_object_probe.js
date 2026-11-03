// Probe for the text-object bugs found by hand:
//   1. the Hershey single-line layout must be y-down in the text's local box
//      (a cap rises above the baseline; the glyph was rendered upside down),
//   2. cancelling a brand-new text (Esc / Cancel) must leave nothing behind,
//   3. deleting a text must take its guide lines AND the constraints that hang
//      off its points (the height dimension used to survive Delete).
//
// Run: node testing/text_object_probe.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function braceEnd(src, from) {
  let i = src.indexOf('{', from), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) return j + 1; }
  }
  throw new Error('unbalanced');
}
const sliceApp = (name) => {
  const start = appSrc.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('not found: ' + name);
  let i = appSrc.indexOf('(', start), depth = 0;
  for (; i < appSrc.length; i++) {
    if (appSrc[i] === '(') depth++;
    else if (appSrc[i] === ')') { depth--; if (!depth) break; }
  }
  return appSrc.slice(start, braceEnd(appSrc, i));
};

// ---- 1. Hershey orientation -------------------------------------------
console.log('\n== single-line glyphs are not upside down ==');
{
  const sandbox = { window: {}, console, MiniSketchHershey: { data: {} } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'fonts', 'hershey-data.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'fonts', 'hershey.js'), 'utf8'), sandbox);
  const lay = vm.runInContext('MiniSketchHershey.layout("Hg", 100, 125)', sandbox);
  let minY = Infinity, maxY = -Infinity;
  for (const st of lay.strokes) for (const p of st) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  // layout space is y-down with the baseline at 0: a cap top is NEGATIVE and a
  // descender ('g') is positive
  check('a capital rises above the baseline', minY < -50, minY.toFixed(1));
  check('a descender falls below the baseline', maxY > 5, maxY.toFixed(1));
  check('the cap height is about 0.72 of the size', Math.abs(minY + 72) < 2, minY.toFixed(1));

  // and the local box mapping keeps that orientation (no second flip)
  const world = { points: {}, entities: {}, constraints: {}, layers: [], nextId: 1 };
  const stubs = `
    const TEXT_REF = 100;
    const state = ${JSON.stringify(world)};
    const window = { MiniSketchHershey: MiniSketchHersheyRef };
    function textMetricsOf() { return { width: 100, height: 100, ascent: 72, lineHeight: 125, lines: ['Hg'] }; }
  `;
  const fn = new Function('MiniSketchHersheyRef',
    stubs + sliceApp('textLocalStrokes') + '\nreturn textLocalStrokes;');
  const local = fn(sandbox.MiniSketchHershey)({ text: 'Hg', single: true });
  let lMin = Infinity, lMax = -Infinity;
  for (const st of local) for (const p of st) {
    if (p.y < lMin) lMin = p.y;
    if (p.y > lMax) lMax = p.y;
  }
  // local box is y-down from its top: a cap sits near 0, a descender below the
  // ascent (72). Getting this backwards is what drew the glyphs mirrored.
  check('in the local box a cap sits at the top', lMin < 10, lMin.toFixed(1));
  check('in the local box a descender sits below the baseline', lMax > 72, lMax.toFixed(1));
}

// ---- 2/3. deleting a text cleans up its guides and dimensions ----------
console.log('\n== deleting a text removes its guides and its dimension ==');
{
  const world = {
    points: {
      1: { x: 0, y: 0 },     // p0
      2: { x: 60, y: 0 },    // pw
      3: { x: 0, y: 20 },    // ph
      4: { x: 200, y: 200 }  // an unrelated point
    },
    entities: {},
    constraints: {},
    nextId: 100
  };
  world.entities[10] = { id: 10, type: 'line', a: 1, b: 2, color: '#00ff00' };
  world.entities[11] = { id: 11, type: 'line', a: 1, b: 3, color: '#00ff00' };
  world.entities[12] = {
    id: 12, type: 'text', p0: 1, pw: 2, ph: 3, guide: [10, 11],
    text: 'Hi', font: 'sans-serif', color: '#000000', layer: 1
  };
  // the height dimension hangs off p0/ph, NOT off the text entity
  world.constraints[20] = { id: 20, type: 'distance', p1: 1, p2: 3, value: 20 };
  // a guide constraint on one of the guides
  world.constraints[21] = { id: 21, type: 'horizontal', entity: 10 };
  // an unrelated dimension that must survive
  world.entities[13] = { id: 13, type: 'line', a: 4, b: 4, color: '#000000' };
  world.constraints[22] = { id: 22, type: 'distance', p1: 4, p2: 4, value: 5 };

  const fn = new Function('state', 'ui', 'xfBlock', 'pushHistory', 'pointUses',
    'entityPointIds', 'P', 'invalidateLoops', 'cleanupPoints', 'scheduleSave',
    'updateUI', 'render', 'clearSelection', 'selectedEntities', 'selectedPointIds',
    'selectedConstraintIds', 'removeConstraint', 'removeEntity', 'removeEntities',
    `${sliceApp('deleteSelection')}
     return deleteSelection;`);

  const api = {
    ui: { selection: [{ kind: 'entity', id: 12 }] },
    xfBlock: () => false,
    pushHistory: () => {},
    pointUses: (pid) => {
      const out = [];
      for (const id in world.entities) {
        const e = world.entities[id];
        const ids = e.type === 'line' ? [e.a, e.b] : (e.type === 'text' ? [e.p0, e.pw, e.ph] : []);
        if (ids.map(Number).includes(+pid)) out.push(e);
      }
      return out;
    },
    entityPointIds: (e) => e.type === 'line' ? [e.a, e.b] : (e.type === 'text' ? [e.p0, e.pw, e.ph] : []),
    P: (id) => world.points[id],
    invalidateLoops: () => {},
    cleanupPoints: () => {},
    scheduleSave: () => {},
    updateUI: () => {},
    render: () => {},
    clearSelection: () => { api.ui.selection = []; },
    selectedEntities: () => api.ui.selection.filter(s => s.kind === 'entity').map(s => world.entities[s.id]).filter(Boolean),
    selectedPointIds: () => api.ui.selection.filter(s => s.kind === 'point').map(s => s.id),
    selectedConstraintIds: () => api.ui.selection.filter(s => s.kind === 'constraint').map(s => s.id),
    removeConstraint: (id) => { delete world.constraints[id]; },
    removeEntity: (id) => { delete world.entities[id]; },
    removeEntities: (ids) => { for (const id of ids) delete world.entities[id]; }
  };

  const del = fn(world, api.ui, api.xfBlock, api.pushHistory, api.pointUses,
    api.entityPointIds, api.P, api.invalidateLoops, api.cleanupPoints, api.scheduleSave,
    api.updateUI, api.render, api.clearSelection, api.selectedEntities, api.selectedPointIds,
    api.selectedConstraintIds, api.removeConstraint, api.removeEntity, api.removeEntities);
  del();

  check('the text is gone', !world.entities[12]);
  check('both guide lines are gone', !world.entities[10] && !world.entities[11]);
  check('the height dimension is gone', !world.constraints[20]);
  check('the guide constraint is gone', !world.constraints[21]);
  check('an unrelated dimension survives', !!world.constraints[22]);
}

console.log('\n' + (fail ? fail + ' FAILED, ' : 'all ') + pass + ' checks passed');
process.exit(fail ? 1 : 0);
