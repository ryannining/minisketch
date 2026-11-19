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
    function textTrackingPx(e, s) { return ((e.tracking || 0) / 100) * s; }
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
    'updateUI', 'render', 'clearSelection', 'selectedEntities', 'selectedEntitiesForExport', 'selectedPointIds',
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
    selectedEntitiesForExport: () => api.selectedEntities(),
    selectedPointIds: () => api.ui.selection.filter(s => s.kind === 'point').map(s => s.id),
    selectedConstraintIds: () => api.ui.selection.filter(s => s.kind === 'constraint').map(s => s.id),
    removeConstraint: (id) => { delete world.constraints[id]; },
    removeEntity: (id) => { delete world.entities[id]; },
    removeEntities: (ids) => { for (const id of ids) delete world.entities[id]; }
  };

  const del = fn(world, api.ui, api.xfBlock, api.pushHistory, api.pointUses,
    api.entityPointIds, api.P, api.invalidateLoops, api.cleanupPoints, api.scheduleSave,
    api.updateUI, api.render, api.clearSelection, api.selectedEntities, api.selectedEntitiesForExport, api.selectedPointIds,
    api.selectedConstraintIds, api.removeConstraint, api.removeEntity, api.removeEntities);
  del();

  check('the text is gone', !world.entities[12]);
  check('both guide lines are gone', !world.entities[10] && !world.entities[11]);
  check('the height dimension is gone', !world.constraints[20]);
  check('the guide constraint is gone', !world.constraints[21]);
  check('an unrelated dimension survives', !!world.constraints[22]);
}

// ---- 4. Hershey multi-line alignment -----------------------------------
console.log('\n== Hershey align uses the slack against the widest line ==');
{
  const sandbox = { window: {}, console, MiniSketchHershey: { data: {} } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'fonts', 'hershey-data.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'fonts', 'hershey.js'), 'utf8'), sandbox);
  const layout = (t, a) => vm.runInContext(
    `MiniSketchHershey.layout(${JSON.stringify(t)}, 100, 125, ${JSON.stringify(a)})`, sandbox);
  const minX = (strokes) => {
    let m = Infinity;
    for (const st of strokes) for (const p of st) if (p.x < m) m = p.x;
    return m;
  };
  const maxX = (strokes) => {
    let m = -Infinity;
    for (const st of strokes) for (const p of st) if (p.x > m) m = p.x;
    return m;
  };

  const two = layout('a\nbbbb', 'left');
  const shortLeft = minX(layout('a', 'left').strokes);
  const slack = two.width - layout('a', 'left').width;
  // line 1 sits around baseline 0, line 2 around baseline 125
  const line1 = two.strokes.filter(st => st.every(p => p.y < 30));
  const line2 = two.strokes.filter(st => st.every(p => p.y > 30));
  check('two lines are emitted', line1.length > 0 && line2.length > 0);
  check('left: short line starts at its natural x', Math.abs(minX(line1) - shortLeft) < 1e-6, minX(line1));

  // glyph ink may overhang its advance (true of the raw font too), so the
  // invariant is per line: each line's left-layout extents shifted by its dx
  const line1Left = { min: minX(line1), max: maxX(line1) };
  const line2Left = { min: minX(line2), max: maxX(line2) };
  const cen = layout('a\nbbbb', 'center');
  const cenLine1 = cen.strokes.filter(st => st.every(p => p.y < 30));
  check('center: short line shifted by half the slack',
    Math.abs(minX(cenLine1) - (shortLeft + slack / 2)) < 1e-6, minX(cenLine1));
  check('center: extents are the left extents shifted by dx',
    Math.abs(minX(cen.strokes) - Math.min(line2Left.min, line1Left.min + slack / 2)) < 1e-6 &&
    Math.abs(maxX(cen.strokes) - Math.max(line2Left.max, line1Left.max + slack / 2)) < 1e-6);

  const right = layout('a\nbbbb', 'right');
  const rightLine1 = right.strokes.filter(st => st.every(p => p.y < 30));
  check('right: short line ends at the widest width',
    Math.abs(maxX(rightLine1) - (maxX(layout('a', 'left').strokes) + slack)) < 1e-6, maxX(rightLine1));
  check('right: extents are the left extents shifted by dx',
    Math.abs(minX(right.strokes) - Math.min(line2Left.min, line1Left.min + slack)) < 1e-6 &&
    Math.abs(maxX(right.strokes) - Math.max(line2Left.max, line1Left.max + slack)) < 1e-6);

  check('single line: center strokes identical to left',
    JSON.stringify(layout('x', 'center').strokes) === JSON.stringify(layout('x', 'left').strokes));
  check('single line: right strokes identical to left',
    JSON.stringify(layout('x', 'right').strokes) === JSON.stringify(layout('x', 'left').strokes));

  const emptyMid = layout('a\n\nb', 'left');
  check('empty middle line still counts', emptyMid.lines === 3, emptyMid.lines);
  let maxY = -Infinity;
  for (const st of emptyMid.strokes) for (const p of st) if (p.y > maxY) maxY = p.y;
  check('third baseline steps by 2x leading', Math.abs(maxY - 250) < 1e-6, maxY);
}

// ---- 5. remembered text style carries leading/align ---------------------
console.log('\n== text style persistence includes leading and align ==');
{
  const store = {};
  const localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  };
  const fn = new Function('localStorage', 'TEXT_DEFAULT_FONT',
    'function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }\n' +
    "const TEXT_STYLE_KEY = 'minisketch.textStyle.v1';\n" +
    sliceApp('textStyleLeading') + '\n' +
    sliceApp('textStyleAlign') + '\n' + sliceApp('loadTextStyle') + '\n' +
    sliceApp('saveTextStyle') + '\nreturn { loadTextStyle, saveTextStyle };');
  const { loadTextStyle, saveTextStyle } = fn(localStorage, 'Liberation Sans');

  // an OLD stored style (no leading/align) must load with the defaults
  store['minisketch.textStyle.v1'] = JSON.stringify({ font: 'X', weight: 700, italic: true, tracking: 5 });
  let s = loadTextStyle();
  check('old style gains default leading', s.leading === 125, s.leading);
  check('old style gains default align', s.align === 'left', s.align);

  saveTextStyle({ font: 'X', leading: 999, align: 'bogus' });
  s = loadTextStyle();
  check('leading clamps to 400', s.leading === 400, s.leading);
  check('bogus align falls back to left', s.align === 'left', s.align);

  saveTextStyle({ font: 'Hershey Simplex', leading: 150, align: 'center' });
  s = loadTextStyle();
  check('leading/align round-trip', s.leading === 150 && s.align === 'center', JSON.stringify(s));

  delete store['minisketch.textStyle.v1'];
  s = loadTextStyle();
  check('fresh fallback has leading/align', s.leading === 125 && s.align === 'left');
}

// ---- 6. letter spacing is a percent of normal, like leading --------------
console.log('\n== letter spacing: 100% = normal, and Hershey honours it ==');
{
  const fn = new Function('clamp',
    sliceApp('textTrackingFromPct') + '\nreturn textTrackingFromPct;');
  const f = fn((v, lo, hi) => v < lo ? lo : (v > hi ? hi : v));
  check('100% is normal spacing', f(100) === 0, f(100));
  check('110% adds a tenth of the size', f(110) === 10, f(110));
  check('90% tightens', f(90) === -10, f(90));
  check('clamps to the old offset range', f(500) === 60 && f(0) === -30);
  check('garbage falls back to normal', f('x') === 0);

  const sandbox = { window: {}, console, MiniSketchHershey: { data: {} } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'fonts', 'hershey-data.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'fonts', 'hershey.js'), 'utf8'), sandbox);
  const w0 = vm.runInContext('MiniSketchHershey.layout("ii", 100, 125, "left").width', sandbox);
  const w1 = vm.runInContext('MiniSketchHershey.layout("ii", 100, 125, "left", 10).width', sandbox);
  check('two glyphs gain two tracking steps', Math.abs(w1 - w0 - 20) < 1e-6, w1 - w0);
  const w2 = vm.runInContext('MiniSketchHershey.layout("ii", 100, 125, "left", -5).width', sandbox);
  check('negative tracking tightens', Math.abs(w2 - w0 + 10) < 1e-6, w2 - w0);
}

console.log('\n' + (fail ? fail + ' FAILED, ' : 'all ') + pass + ' checks passed');
process.exit(fail ? 1 : 0);
