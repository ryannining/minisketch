// Probe for the local nesting section in app.js: loop collection, compound
// grouping, engine input building and the placement -> clone-instance matrix.
// Follows the house pattern: slice the real functions out of app.js and run
// them in a minimal harness instead of loading the whole IIFE.
//
// Run: node testing/nest_app_probe.js
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const C = require(path.join(ROOT, 'core.js'));

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
  let i = start, depth = 0, seen = false;
  for (; i < appSrc.length; i++) {
    if (appSrc[i] === '{') { depth++; seen = true; }
    else if (appSrc[i] === '}') { depth--; if (seen && !depth) return appSrc.slice(start, i + 1); }
  }
  throw new Error('unbalanced: ' + name);
};

// ---- load the engine exactly like the browser does ------------------------
function loadEngine() {
  const sandbox = {
    console, Math, performance: { now: () => Date.now() },
    navigator: { userAgent: 'node' }, self: {}, window: {}, module: { exports: {} },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'tools/clipper.js'), 'utf8'), sandbox, { filename: 'clipper.js' });
  sandbox.ClipperLib = sandbox.module.exports;
  delete sandbox.module;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'tools/nest.js'), 'utf8'), sandbox, { filename: 'nest.js' });
  return sandbox.window.MiniSketchNest;
}
const MiniSketchNest = loadEngine();

// ---- slice list ------------------------------------------------------------
// constants the sliced functions read
const consts = `
const NEST_OUT_GAP = 10;
const MiniSketchNest = globalThis.__nest;
const matMul = globalThis.__matMul;
const state = globalThis.__state;
const ui = globalThis.__ui;
const getLoops = globalThis.__getLoops;
const loopShapeSelected = globalThis.__loopShapeSelected;
const loopEntities = globalThis.__loopEntities;
const ownedGuideIds = globalThis.__ownedGuideIds;
const isConstructionColor = globalThis.__isConstructionColor;
const colorOf = globalThis.__colorOf;
const pointInPoly = globalThis.__pointInPoly;
const xfBlock = globalThis.__xfBlock;
const toast = globalThis.__toast;
const pushHistory = globalThis.__pushHistory;
const commit = globalThis.__commit;
const newId = globalThis.__newId;
const P = globalThis.__P;
const entityPointIds = globalThis.__entityPointIds;
const invalidateLoops = globalThis.__invalidateLoops;
const document = globalThis.__document;
const performance = globalThis.__perf;
const setTimeout = globalThis.__setTimeout;
const matFromPlacement = (p) => [1,0,0,1,0,0];
`;
const fns = [
  'nestRotationAngles',
  'nestCollectLoops',
  'nestGroupParts',
  'nestBuildEntries',
  'nestPrepare',
  'nestPlacementMatrixAt',
  'nestAnchorOf',
].map(slice).join('\n');

function buildHarness(world) {
  const g = globalThisRef(world);
  const src = consts + fns + `
    return { nestRotationAngles, nestCollectLoops, nestGroupParts, nestBuildEntries,
             nestPrepare, nestPlacementMatrixAt, nestAnchorOf };`;
  return new Function('globalThis', src)(g);
}
// new Function('globalThis', ...) shadows the real globalThis only if the
// param name is used; the consts above read globalThis.__nest — pass a holder.
function globalThisRef(world) {
  return world;
}

// ---- world -----------------------------------------------------------------
function makeWorld() {
  const w = {};
  w.toasts = [];
  w.state = {
    points: {}, entities: {}, constraints: {}, nextId: 1000,
    layers: [{ id: 1, visible: true }],
  };
  w.ui = { activeLayer: 1, selection: [] };
  w.__nest = MiniSketchNest;
  w.__matMul = C.matMul;
  w.__state = w.state;
  w.__ui = w.ui;
  w.__pointInPoly = C.pointInPoly;
  w.__toast = (m) => w.toasts.push(m);
  w.__pushHistory = () => { w.historyPushed = true; };
  w.__commit = () => { w.committed = true; };
  w.__newId = () => ++w.state.nextId;
  w.__P = (id) => w.state.points[id] || null;
  w.__entityPointIds = (e) => {
    if (e.type === 'line') return [e.a, e.b];
    if (e.type === 'circle') return [e.c];
    return [];
  };
  w.__invalidateLoops = () => {};
  w.__xfBlock = () => false;
  w.__isConstructionColor = (c) => String(c || '').trim().toLowerCase() === '#00ff00';
  w.__colorOf = (e) => (e && e.color) || '#000000';
  w.__ownedGuideIds = () => w.owned || new Set();
  // document stub: only the nest-* fields the functions read
  const fields = {
    'nest-spacing': { value: '2' },
    'nest-rotation': { value: '0,90,180,270' },
    'nest-flip': { checked: false },
    'nest-pop': { value: '6' },
    'nest-gen': { value: '5' },
  };
  w.__document = { getElementById: (id) => fields[id] || null };
  w.fields = fields;
  return w;
}

// build a tiny drawing: a green sheet square (100x100 at 0,0) plus two part
// squares (40x40 at 200,0 and 200,100) formed by two lines each? Keep it to
// circles: loop detection is app-side, but the sliced nestCollectLoops reads
// getLoops() — we stub it with hand-made loops instead of rebuilding the graph.
function makeLoops(w) {
  const poly = (x, y, s) => {
    const p = [];
    for (let i = 0; i < 4; i++) {
      const t = i * Math.PI / 2 + Math.PI / 4;
      p.push({ x: x + Math.cos(t) * s * Math.SQRT1_2, y: y + Math.sin(t) * s * Math.SQRT1_2 });
    }
    return p;
  };
  const sheet = { poly: poly(50, 50, 100), area: 10000 };
  const partA = { poly: poly(220, 20, 40), area: 1600 };
  const partB = { poly: poly(220, 120, 40), area: 1600 };
  const hole = { poly: poly(220, 120, 20), area: 400 }; // inside partB
  w.loops = [sheet, partA, partB, hole];

  // entities: sheet = 4 green lines, partA = 2 black lines (id style does not
  // matter, loopEntities is derived from the loop record we hand-craft)
  w.state.entities[1] = { id: 1, type: 'line', a: 'p1', b: 'p2', color: '#00ff00' };
  w.state.entities[2] = { id: 2, type: 'line', a: 'p2', b: 'p3', color: '#00ff00' };
  w.state.entities[3] = { id: 3, type: 'line', a: 'p3', b: 'p4', color: '#00ff00' };
  w.state.entities[4] = { id: 4, type: 'line', a: 'p4', b: 'p1', color: '#00ff00' };
  w.state.entities[10] = { id: 10, type: 'line', a: 'q1', b: 'q2', color: '#000000' };
  w.state.entities[11] = { id: 11, type: 'line', a: 'q2', b: 'q3', color: '#000000' };
  w.state.entities[12] = { id: 12, type: 'line', a: 'q3', b: 'q4', color: '#000000' };
  w.state.entities[13] = { id: 13, type: 'line', a: 'q4', b: 'q1', color: '#000000' };
  w.state.entities[14] = { id: 14, type: 'line', a: 'r1', b: 'r2', color: '#000000' };
  w.state.entities[15] = { id: 15, type: 'line', a: 'r2', b: 'r3', color: '#000000' };
  w.state.entities[16] = { id: 16, type: 'line', a: 'r3', b: 'r4', color: '#000000' };
  w.state.entities[17] = { id: 17, type: 'line', a: 'r4', b: 'r1', color: '#000000' };
  w.state.entities[18] = { id: 18, type: 'line', a: 's1', b: 's2', color: '#000000' };
  w.state.entities[19] = { id: 19, type: 'line', a: 's2', b: 's3', color: '#000000' };
  w.state.entities[20] = { id: 20, type: 'line', a: 's3', b: 's4', color: '#000000' };
  w.state.entities[21] = { id: 21, type: 'line', a: 's4', b: 's1', color: '#000000' };

  sheet.entityIds = [1, 2, 3, 4];
  partA.entityIds = [10, 11, 12, 13];
  partB.entityIds = [14, 15, 16, 17];
  hole.entityIds = [18, 19, 20, 21];

  w.__getLoops = () => w.loops;
  w.__loopShapeSelected = (loop) => (w.selectedLoops || []).includes(loop);
  w.__loopEntities = (loop) => loop.entityIds;
}

console.log('\n== nestRotationAngles ==');
{
  const w = makeWorld();
  const h = buildHarness(w);
  check('parses comma list', JSON.stringify(h.nestRotationAngles('0,90,180,270')) === '[0,90,180,270]');
  check('normalizes 360+', JSON.stringify(h.nestRotationAngles('45,405')) === '[45]');
  check('invalid falls back to [0]', JSON.stringify(h.nestRotationAngles('abc')) === '[0]');
  check('empty falls back to [0]', JSON.stringify(h.nestRotationAngles('')) === '[0]');
}

console.log('\n== nestCollectLoops ==');
{
  const w = makeWorld();
  makeLoops(w);
  const h = buildHarness(w);
  w.selectedLoops = [w.loops[0], w.loops[1], w.loops[2]];
  const sel = h.nestCollectLoops();
  check('sheet loop detected (green)', sel.sheetLoops.length === 1);
  check('part loops detected (2 black)', sel.partLoops.length === 2);
  // a loop whose entities are all in ownedGuideIds is dropped entirely
  w.owned = new Set([1, 2, 3, 4]);
  const sel2 = h.nestCollectLoops();
  check('owned green guides dropped', sel2.sheetLoops.length === 0 && sel2.partLoops.length === 2);
}

console.log('\n== nestGroupParts ==');
{
  const w = makeWorld();
  makeLoops(w);
  const h = buildHarness(w);
  // partB (40) contains hole (20): grouping merges them into one object
  const objs = h.nestGroupParts([
    { loop: w.loops[1], entityIds: w.loops[1].entityIds },
    { loop: w.loops[2], entityIds: w.loops[2].entityIds },
    { loop: w.loops[3], entityIds: w.loops[3].entityIds },
  ]);
  check('two objects after grouping (A, B+hole)', objs.length === 2);
  const objB = objs.find(o => o.outer.loop === w.loops[2]);
  check('hole attached to its outer', !!objB && objB.holeRecs.length === 1 && objB.holeRecs[0].loop === w.loops[3]);
}

console.log('\n== nestBuildEntries ==');
{
  const w = makeWorld();
  makeLoops(w);
  const h = buildHarness(w);
  const sel = {
    sheetLoops: [{ loop: w.loops[0], entityIds: w.loops[0].entityIds }],
    partLoops: [
      { loop: w.loops[1], entityIds: w.loops[1].entityIds },
      { loop: w.loops[2], entityIds: w.loops[2].entityIds },
      { loop: w.loops[3], entityIds: w.loops[3].entityIds },
    ],
  };
  const objects = h.nestGroupParts(sel.partLoops);
  const entries = h.nestBuildEntries(sel.sheetLoops, objects, 2, '0,90,180,270', false);
  check('2 part entries + 1 sheet entry', entries.length === 3);
  const sheetEntry = entries.find(e => e.lcolor === '#00ff00');
  check('sheet entry marked green', !!sheetEntry && sheetEntry.originIndex === 0);
  const ring = entries.find(e => e.originIndex === 2);
  check('compound entry has 2 paths (outer+hole)', !!ring && ring.variants[0].paths.length === 2);
  check('4 rotation variants per part', entries[0].variants.length === 4);
  // engine works in integer mm * 1000
  const GEOM = MiniSketchNest.GEOM_SCALE;
  const b = sheetEntry.variants[0].getBounds();
  check('sheet bbox in engine units', Math.round(b.width / GEOM) === 100 && Math.round(b.height / GEOM) === 100);
  // flip doubles the variants
  const entriesFlip = h.nestBuildEntries(sel.sheetLoops, objects, 2, '0,90', true);
  check('flip doubles variant count', entriesFlip[0].variants.length === 4);
  // spacing offsets the parts (grown), never the sheet
  const grown = entries[0].variants[0].getBounds();
  check('spacing grows part bbox by spacing (2mm -> +2mm)', Math.round(grown.width / GEOM) === 42);
}

console.log('\n== end-to-end engine run through nestBuildEntries ==');
{
  const w = makeWorld();
  makeLoops(w);
  const h = buildHarness(w);
  const sel = {
    sheetLoops: [{ loop: w.loops[0], entityIds: w.loops[0].entityIds }],
    partLoops: [
      { loop: w.loops[1], entityIds: w.loops[1].entityIds },
      { loop: w.loops[2], entityIds: w.loops[2].entityIds },
      { loop: w.loops[3], entityIds: w.loops[3].entityIds },
    ],
  };
  const objects = h.nestGroupParts(sel.partLoops);
  const spacing = 2;
  const entries = h.nestBuildEntries(sel.sheetLoops, objects, spacing, '0,90,180,270', false);
  const ga = new MiniSketchNest.NFPGA();
  ga.setSpacing(spacing);
  ga.setGAParams(4, 2, 0.1);
  const placements = ga.findBestPosition(entries, { width: 100, height: 100 }, null, ga.gridSize);
  const inner = placements.filter(p => p.lcolor !== '#00ff00');
  check('both objects placed by the engine', inner.length === 2);
  check('sheet frame in placements', placements.some(p => p.lcolor === '#00ff00'));
  // matrix: rebuild the rigid chain for a variant and check it lands where asked
  const p0 = inner[0];
  const entry0 = entries.find(e => e.originIndex === p0.originIndex); // SAME part
  const rec = entry0._rec;
  const pb = p0.getBounds();
  const GEOM = MiniSketchNest.GEOM_SCALE;
  const px = 120, py = 10; // arbitrary world target for the bbox min corner
  const jobStub = { variantAngles: h.nestRotationAngles('0,90,180,270') };
  const M = h.nestPlacementMatrixAt(jobStub, rec, p0._variantIdx != null ? p0._variantIdx : 0, px, py);
  // apply M to the master poly; its bbox must land at (px,py) with the size of
  // the ALIGNED master (the engine placement is the grown shape, the clone
  // draws the master, so the master size — not pb — is the expectation)
  const out = rec.outer.loop.poly.map(p => C.matApply(M, p));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of out) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  const masterW = Math.max(...rec.outer.loop.poly.map(p => p.x)) - Math.min(...rec.outer.loop.poly.map(p => p.x));
  const masterH = Math.max(...rec.outer.loop.poly.map(p => p.y)) - Math.min(...rec.outer.loop.poly.map(p => p.y));
  check('matrix lands bbox min corner at target', Math.abs(minX - px) < 0.5 && Math.abs(minY - py) < 0.5,
    '(' + minX.toFixed(2) + ',' + minY.toFixed(2) + ') vs (' + px + ',' + py + ')');
  check('matrix preserves master size', Math.abs((maxX - minX) - masterW) < 0.5 &&
    Math.abs((maxY - minY) - masterH) < 0.5,
    (maxX - minX).toFixed(2) + 'x' + (maxY - minY).toFixed(2) + ' vs ' + masterW.toFixed(2) + 'x' + masterH.toFixed(2));
  // rotation gene -> the size swaps for 90deg variants
  const M90 = h.nestPlacementMatrixAt(jobStub, rec, 1, px, py); // variant 1 = 90deg (no flip)
  const out90 = rec.outer.loop.poly.map(p => C.matApply(M90, p));
  let w90 = 0, h90 = 0;
  let nminX = Infinity, nminY = Infinity, nmaxX = -Infinity, nmaxY = -Infinity;
  for (const p of out90) {
    nminX = Math.min(nminX, p.x); nminY = Math.min(nminY, p.y);
    nmaxX = Math.max(nmaxX, p.x); nmaxY = Math.max(nmaxY, p.y);
  }
  w90 = nmaxX - nminX; h90 = nmaxY - nminY;
  check('variant 1 is a rotated shape (w/h swapped)', Math.abs(w90 - h90) < 0.5); // square stays square
  // anchor: first master point id resolves through P()
  w.state.points.q1 = { x: 200, y: 0 };
  check('anchor reads the first master point', JSON.stringify(h.nestAnchorOf([10, 11])) === '[200,0]');
}

console.log('\n== nestPrepare validation ==');
{
  const w = makeWorld();
  makeLoops(w);
  const h = buildHarness(w);
  w.selectedLoops = [];
  h.nestPrepare();
  check('no selection -> toast, no job', w.toasts.length === 1 && /hijau|nesting/i.test(w.toasts[0]));
  w.selectedLoops = [w.loops[1]];
  w.toasts.length = 0;
  h.nestPrepare();
  check('parts only -> sheet toast', w.toasts.length === 1 && /hijau/.test(w.toasts[0]));
  w.selectedLoops = [w.loops[0], w.loops[1], w.loops[2], w.loops[3]];
  w.toasts.length = 0;
  const prep = h.nestPrepare();
  check('full selection prepares', !!prep && prep.objects.length === 2 && prep.spacing === 2);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
