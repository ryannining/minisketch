// Probe for the Points toggle: it must show the handles of the WHOLE drawing,
// not only the active layer. Grabbing stays limited to the active layer.
//
// The bug: drawPoints() filtered with pointEditable(), which is "on the active
// layer and unlocked", so every point outside layer 1 was never drawn even with
// the Points toggle on.
//
// Run: node testing/point_visibility_probe.js
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

// ---- the two rules are separate functions --------------------------------
console.log('\n== showing and grabbing are different questions ==');
{
  check('pointShown exists', /function pointShown\(/.test(appSrc));
  check('pointEditable still exists', /function pointEditable\(/.test(appSrc));

  const shown = slice('pointShown');
  const editable = slice('pointEditable');
  check('pointShown asks about layer VISIBILITY',
    /layerVisible\(/.test(shown) && !/entityEditable\(/.test(shown), shown.slice(0, 120));
  check('pointEditable asks about EDITABILITY',
    /entityEditable\(/.test(editable) && !/layerVisible\(/.test(editable));
  check('the shown cache is dropped with the rest',
    /pointShownCache = null/.test(slice('invalidateLoops')));
}

console.log('\n== the renderer uses the showing rule ==');
{
  const draw = slice('drawPoints');
  check('drawPoints filters with pointShown', /pointShown\(id\)/.test(draw));
  check('drawPoints does not filter with pointEditable',
    !/if \(!pointEditable\(id\)\) continue;/.test(draw));
  check('but it still asks whether the point is grabbable',
    /pointEditable\(id\)/.test(draw));
  check('selection emphasis is limited to grabbable points',
    /grabbable && isSel/.test(draw) && /grabbable && isHover/.test(draw));
}

console.log('\n== the hit-test keeps the narrow rule ==');
{
  const hit = slice('hitPoint');
  check('hitPoint needs the point to be visible AND editable',
    /pointVisible\(id\)/.test(hit) && /pointEditable\(id\)/.test(hit));
}

// ---- behaviour, with the real functions ---------------------------------
console.log('\n== a point on layer 2 shows but does not grab ==');
{
  const state = {
    points: { 1: { x: 0, y: 0 }, 2: { x: 10, y: 0 } },
    entities: { 10: { id: 10, type: 'line', a: 1, b: 2, layer: 2 } },
    constraints: {},
    layers: [{ id: 1, visible: true, locked: false }, { id: 2, visible: true, locked: false }],
    nextId: 100
  };
  const ui = { activeLayer: 1 };
  const pointUses = (pid) => Object.values(state.entities)
    .filter(e => (e.type === 'line' ? [e.a, e.b] : []).map(Number).includes(+pid));
  const layerOf = (e) => (e.layer != null ? e.layer : 1);
  const getLayer = (id) => state.layers.find(l => l.id === id);
  const layerVisible = (e) => {
    const l = getLayer(layerOf(e));
    return !l || l.visible;
  };
  const entityEditable = (e) => {
    const l = getLayer(layerOf(e));
    return !!l && l.id === ui.activeLayer && l.visible && !l.locked;
  };

  const fn = new Function('state', 'ui', 'pointUses', 'layerOf', 'getLayer',
    'layerVisible', 'entityEditable',
    'let pointEditableCache = null; let pointShownCache = null; let pointCacheSig = "";\n' +
    'let pointSigTick = 0, pointSigChecked = -1;\n' +
    slice('pointCacheSignature') + '\n' + slice('pointCachesValid') + '\n' +
    slice('pointShown') + '\n' + slice('pointEditable') +
    '\nreturn { pointShown, pointEditable, frame: () => { pointSigTick++; } };');
  const api = fn(state, ui, pointUses, layerOf, getLayer, layerVisible, entityEditable);

  check('the layer-2 point is SHOWN', api.pointShown(1) === true);
  check('but it is NOT editable', api.pointEditable(1) === false);

  state.layers[1].visible = false;
  api.frame();       // render() bumps the tick once per frame
  check('hiding layer 2 hides its points', api.pointShown(1) === false);

  state.layers[1].visible = true;
  ui.activeLayer = 2;
  api.frame();
  check('making layer 2 active makes its points grabbable',
    api.pointEditable(1) === true);
}

console.log('\n== hiding a layer invalidates the cache on its own ==');
{
  // The reported bug: hiding a layer left its point markers on screen. The
  // toggle does not call invalidateLoops(), so the cache has to notice the
  // layer state itself.
  const state = {
    points: { 1: { x: 0, y: 0 }, 2: { x: 10, y: 0 } },
    entities: { 10: { id: 10, type: 'line', a: 1, b: 2, layer: 2 } },
    constraints: {},
    layers: [{ id: 1, visible: true, locked: false }, { id: 2, visible: true, locked: false }],
    nextId: 100
  };
  const ui = { activeLayer: 1 };
  const pointUses = (pid) => Object.values(state.entities)
    .filter(e => (e.type === 'line' ? [e.a, e.b] : []).map(Number).includes(+pid));
  const layerOf = (e) => (e.layer != null ? e.layer : 1);
  const getLayer = (id) => state.layers.find(l => l.id === id);
  const layerVisible = (e) => {
    const l = getLayer(layerOf(e));
    return !l || l.visible;
  };
  const entityEditable = (e) => {
    const l = getLayer(layerOf(e));
    return !!l && l.id === ui.activeLayer && l.visible && !l.locked;
  };

  const fn = new Function('state', 'ui', 'pointUses', 'layerOf', 'getLayer',
    'layerVisible', 'entityEditable',
    'let pointEditableCache = null; let pointShownCache = null; let pointCacheSig = "";\n' +
    'let pointSigTick = 0, pointSigChecked = -1;\n' +
    slice('pointCacheSignature') + '\n' + slice('pointCachesValid') + '\n' +
    slice('pointShown') + '\n' + slice('pointEditable') +
    '\nreturn { pointShown, pointEditable, frame: () => { pointSigTick++; } };');
  const api = fn(state, ui, pointUses, layerOf, getLayer, layerVisible, entityEditable);

  check('shown while the layer is visible', api.pointShown(1) === true);
  // no invalidateLoops() call here — exactly what the bug report describes
  state.layers[1].visible = false;
  api.frame();
  check('hidden as soon as the layer is hidden (cache notices)', api.pointShown(1) === false);
  state.layers[1].visible = true;
  api.frame();
  check('and back when the layer comes back', api.pointShown(1) === true);

  ui.activeLayer = 2;
  api.frame();
  check('switching the active layer drops the editable cache',
    api.pointEditable(1) === true);
  ui.activeLayer = 1;
  api.frame();
  check('and switching back restores the narrow rule',
    api.pointEditable(1) === false);
}

console.log('\n' + (fail ? fail + ' FAILED, ' : 'all ') + pass + ' checks passed');
process.exit(fail ? 1 : 0);
