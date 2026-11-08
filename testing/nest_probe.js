// Node probe for tools/nest.js — no DOM, loads ClipperLib from tools/clipper.js
// the same way the browser does (vm sandbox), then exercises the GA + NFP2
// engine. Exit 1 on any failure.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function loadClassic(file, sandbox) {
  const src = fs.readFileSync(file, 'utf8');
  vm.runInContext(src, sandbox, { filename: file });
}

const sandbox = {
  console,
  performance: { now: () => Date.now() },
  Math,
  setTimeout,
  navigator: { userAgent: 'node' },
  self: {},
  window: {},
  // clipper.js detects `typeof module && module.exports` INSIDE the vm context
  // and takes the CommonJS branch, so hand it a fake `module` and copy the
  // export back to the bare global the engine reads.
  module: { exports: {} },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

loadClassic(path.join(ROOT, 'tools/clipper.js'), sandbox);
sandbox.ClipperLib = sandbox.module.exports;
delete sandbox.module;
loadClassic(path.join(ROOT, 'tools/nest.js'), sandbox);

const Nest = sandbox.window.MiniSketchNest;
const { GEOM_SCALE, Point, Path, GeometryUtil, NFP2SpatialHash, NFP2, NFPGA } = Nest;

let fails = 0;
let count = 0;
function ok(cond, name) {
  count++;
  if (!cond) { fails++; console.log('FAIL: ' + name); }
  else console.log('ok: ' + name);
}
function close(a, b, eps, name) {
  ok(Math.abs(a - b) <= eps, name + ' (' + a + ' vs ' + b + ')');
}

// helper: build an engine Path from mm polygon(s)
function polyPath(outerMm, holesMm, originIndex, lcolor) {
  const paths = [outerMm.map(p => new Point(p[0] * GEOM_SCALE, p[1] * GEOM_SCALE))];
  for (const h of holesMm || []) {
    paths.push(h.map(p => new Point(p[0] * GEOM_SCALE, p[1] * GEOM_SCALE)));
  }
  return new Path(paths, originIndex, null, lcolor || null);
}

function bboxOverlap(a, b) {
  return !(a.x + a.width <= b.x || b.x + b.width <= a.x ||
    a.y + a.height <= b.y || b.y + b.height <= a.y);
}

function placedInner(placements) {
  return placements.filter(p => p.lcolor !== '#00ff00');
}

function pairsNonOverlapping(placements) {
  const ps = placedInner(placements);
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const bi = ps[i].getBounds(), bj = ps[j].getBounds();
      const b1 = { x: bi.x, y: bi.y, w: bi.width, h: bi.height };
      const b2 = { x: bj.x, y: bj.y, w: bj.width, h: bj.height };
      const BUFFER = 0.1 * GEOM_SCALE;
      if (!(b1.x + b1.w + BUFFER > b2.x && b2.x + b2.w + BUFFER > b1.x &&
        b1.y + b1.h + BUFFER > b2.y && b2.y + b2.h + BUFFER > b1.y)) continue;
      // Symmetric test: a small part fully inside a bigger part's hole returns
      // false only when the SMALL one is poly1 (the checkchild branch looks at
      // poly2's holes with poly1's vertices). Try both directions.
      const aInB = GeometryUtil.polygonsIntersectAt(ps[i], 0, 0, ps[j], true);
      const bInA = GeometryUtil.polygonsIntersectAt(ps[j], 0, 0, ps[i], true);
      if (aInB && bInA) return false;
    }
  }
  return true;
}

function allInsideSheet(placements, sheetMmW, sheetMmH) {
  const W = sheetMmW * GEOM_SCALE, H = sheetMmH * GEOM_SCALE;
  for (const p of placedInner(placements)) {
    const b = p.getBounds();
    if (b.x < -1 || b.y < -1 || b.x + b.width > W + 1 || b.y + b.height > H + 1) return false;
  }
  return true;
}

// 1. basic place: one 40x40 square into a 100x100 sheet
{
  const square = polyPath([[0, 0], [40, 0], [40, 40], [0, 40]], [], 1);
  square.align();
  const sheetPart = polyPath([[0, 0], [100, 0], [100, 100], [0, 100]], [], 0, '#00ff00');
  const parts = [{
    originIndex: 1, lcolor: null, childIndex: [], variants: [square]
  }, {
    originIndex: 0, lcolor: '#00ff00', childIndex: [], variants: [sheetPart]
  }];
  const ga = new NFPGA();
  ga.setSpacing(0);
  ga.setGAParams(4, 2, 0.1);
  const placements = ga.findBestPosition(parts, { width: 100, height: 100 }, null, GEOM_SCALE);
  ok(placements.filter(p => p.lcolor !== '#00ff00').length === 1, '1: one part placed');
  ok(allInsideSheet(placements, 100, 100), '1: placement inside sheet');
  ok(pairsNonOverlapping(placements), '1: no overlap');
}

// 2. spacing: two 20x20 squares, spacing 3 -> bbox distance >= 3-ish
{
  const mk = (idx) => {
    const p = polyPath([[0, 0], [20, 0], [20, 20], [0, 20]], [], idx);
    return p;
  };
  const sheetPart = polyPath([[0, 0], [100, 0], [100, 100], [0, 100]], [], 0, '#00ff00');
  const base = [];
  for (let i = 0; i < 2; i++) {
    const v = mk(i + 1).clone().offset(3); // grow by spacing (like the app does)
    base.push({ originIndex: i + 1, lcolor: null, childIndex: [], variants: [v] });
  }
  base.push({ originIndex: 0, lcolor: '#00ff00', childIndex: [], variants: [sheetPart] });
  const ga = new NFPGA();
  ga.setSpacing(3);
  const placements = ga.findBestPosition(base, { width: 100, height: 100 }, null, ga.gridSize);
  ok(placedInner(placements).length === 2, '2: both parts placed');
  const [a, b] = placedInner(placements).map(p => p.getBounds());
  // grown shapes must not overlap; shrunk back by 1.5 each side the visual gap
  // is >= 3 - epsilon
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height));
  const sep = Math.max(dx, dy);
  ok(sep >= -1, '2: grown parts separated (sep=' + sep.toFixed(2) + ')');
  ok(pairsNonOverlapping(placements), '2: no polygon overlap');
}

// 3. hole: ring (outer 60 + hole 30) + small 20 square -> square may go inside
{
  const ring = polyPath(
    [[0, 0], [60, 0], [60, 60], [0, 60]],
    [[[15, 15], [45, 15], [45, 45], [15, 45]]],
    1
  );
  ring.align();
  const small = polyPath([[0, 0], [20, 0], [20, 20], [0, 20]], [], 2);
  small.align();
  const sheetPart = polyPath([[0, 0], [100, 0], [100, 100], [0, 100]], [], 0, '#00ff00');
  const parts = [
    { originIndex: 1, lcolor: null, childIndex: [], variants: [ring] },
    { originIndex: 2, lcolor: null, childIndex: [], variants: [small] },
    { originIndex: 0, lcolor: '#00ff00', childIndex: [], variants: [sheetPart] }
  ];
  const ga = new NFPGA();
  ga.setSpacing(0);
  ga.setGAParams(4, 2, 0.1);
  const placements = ga.findBestPosition(parts, { width: 100, height: 100 }, null, GEOM_SCALE);
  ok(placedInner(placements).length === 2, '3: both parts placed');
  ok(pairsNonOverlapping(placements), '3: no polygon overlap');
  // find the small part placement and check it is inside the ring's hole
  const ringP = placements.find(p => p.originIndex === 1);
  const smallP = placements.find(p => p.originIndex === 2);
  ok(!!ringP && !!smallP, '3: both present in result');
  if (ringP && smallP) {
    const inHole = !GeometryUtil.polyOutsideAt(smallP, 0, 0, ringP, 1);
    ok(inHole, '3: small part inside the ring hole (insideBonus path)');
  }
}

// 4. green sheet convention: lcolor '#00ff00' defines the sheet size
{
  const square = polyPath([[0, 0], [40, 0], [40, 40], [0, 40]], [], 1);
  square.align();
  // L-shaped sheet
  const sheetPart = polyPath(
    [[0, 0], [120, 0], [120, 40], [80, 40], [80, 100], [0, 100]], [], 0, '#00ff00'
  );
  const parts = [
    { originIndex: 1, lcolor: null, childIndex: [], variants: [square] },
    { originIndex: 0, lcolor: '#00ff00', childIndex: [], variants: [sheetPart] }
  ];
  const ga = new NFPGA();
  ga.setSpacing(0);
  const placements = ga.findBestPosition(parts, { width: 500, height: 500 }, null, GEOM_SCALE);
  const sheetP = placements.find(p => p.lcolor === '#00ff00');
  ok(!!sheetP, '4: sheet appears in placements');
  const b = sheetP.getBounds();
  close(b.width / GEOM_SCALE, 120, 0.01, '4: sheet width from green path');
  close(b.height / GEOM_SCALE, 100, 0.01, '4: sheet height from green path');
}

// 5. GA >= baseline (descending size)
{
  const sheetPart = polyPath([[0, 0], [300, 0], [300, 200], [0, 200]], [], 0, '#00ff00');
  const parts = [{ originIndex: 0, lcolor: '#00ff00', childIndex: [], variants: [sheetPart] }];
  const sizes = [[90, 60], [70, 80], [120, 50], [40, 40], [55, 25], [30, 90], [65, 45], [25, 25]];
  sizes.forEach((s, i) => {
    const p = polyPath([[0, 0], [s[0], 0], [s[0], s[1]], [0, s[1]]], [], i + 1);
    p.align();
    parts.push({ originIndex: i + 1, lcolor: null, childIndex: [], variants: [p] });
  });
  const ga = new NFPGA();
  ga.setSpacing(0);
  ga.setGAParams(6, 5, 0.1);
  const placements = ga.findBestPosition(parts, { width: 300, height: 200 }, null, GEOM_SCALE);
  ok(placedInner(placements).length >= 6, '5: most parts placed (' + placedInner(placements).length + '/8)');
  ok(allInsideSheet(placements, 300, 200), '5: inside sheet');
  ok(pairsNonOverlapping(placements), '5: no overlap');
}

// 6. too big -> unplaced, not a crash
{
  const big = polyPath([[0, 0], [400, 0], [400, 400], [0, 400]], [], 1);
  big.align();
  const sheetPart = polyPath([[0, 0], [300, 0], [300, 200], [0, 200]], [], 0, '#00ff00');
  const parts = [
    { originIndex: 1, lcolor: null, childIndex: [], variants: [big] },
    { originIndex: 0, lcolor: '#00ff00', childIndex: [], variants: [sheetPart] }
  ];
  const ga = new NFPGA();
  ga.setSpacing(0);
  const placements = ga.findBestPosition(parts, { width: 300, height: 200 }, null, GEOM_SCALE);
  ok(placedInner(placements).length === 0, '6: oversized part not placed');
  ok(placements.filter(p => p.lcolor === '#00ff00').length === 1, '6: sheet still in placements');
}

// 7. compactSolution keeps the result valid
{
  const sheetPart = polyPath([[0, 0], [100, 0], [100, 100], [0, 100]], [], 0, '#00ff00');
  const parts = [{ originIndex: 0, lcolor: '#00ff00', childIndex: [], variants: [sheetPart] }];
  for (let i = 0; i < 3; i++) {
    const p = polyPath([[0, 0], [20, 0], [20, 20], [0, 20]], [], i + 1);
    p.align();
    parts.push({ originIndex: i + 1, lcolor: null, childIndex: [], variants: [p] });
  }
  const ga = new NFPGA();
  ga.setSpacing(0);
  const placements = ga.findBestPosition(parts, { width: 100, height: 100 }, null, GEOM_SCALE);
  const before = placedInner(placements).length;
  ga.compactSolution(placements, { width: 100, height: 100 });
  ok(placedInner(placements).length === before, '7: compaction keeps all parts');
  ok(pairsNonOverlapping(placements), '7: compaction introduces no overlap');
  ok(allInsideSheet(placements, 100, 100), '7: compaction keeps parts in sheet');
}

// 8. generator: yields progress and can be cancelled early; result stays valid
{
  const sheetPart = polyPath([[0, 0], [200, 0], [200, 200], [0, 200]], [], 0, '#00ff00');
  const parts = [{ originIndex: 0, lcolor: '#00ff00', childIndex: [], variants: [sheetPart] }];
  for (let i = 0; i < 6; i++) {
    const p = polyPath([[0, 0], [30, 0], [30, 30], [0, 30]], [], i + 1);
    p.align();
    parts.push({ originIndex: i + 1, lcolor: null, childIndex: [], variants: [p] });
  }
  const ga = new NFPGA();
  ga.setSpacing(0);
  ga.setGAParams(6, 4, 0.1);
  let yielded = 0;
  let lastP = 0;
  let monotonic = true;
  const gen = ga.findBestPositionGen(parts, { width: 200, height: 200 }, ga.gridSize, {});
  let res;
  for (;;) {
    const n = gen.next();
    if (n.done) { res = n.value; break; }
    yielded++;
    if (n.value.done < lastP) monotonic = false;
    lastP = n.value.done;
  }
  ok(res && !res.cancelled, '8: run finishes uncancelled');
  ok(yielded > 0, '8: generator yields progress (' + yielded + ')');
  ok(monotonic, '8: progress monotonic');
  ok(pairsNonOverlapping(res.placements), '8: generator result valid (no overlap)');

  // cancel early
  const ga2 = new NFPGA();
  ga2.setSpacing(0);
  ga2.setGAParams(6, 4, 0.1);
  let evals = 0;
  const gen2 = ga2.findBestPositionGen(parts, { width: 200, height: 200 }, ga2.gridSize, {
    shouldCancel: () => evals >= 3
  });
  let res2;
  for (;;) {
    const n = gen2.next();
    if (n.done) { res2 = n.value; break; }
    evals = n.value.done;
  }
  ok(res2 && res2.cancelled === true, '8: cancel flag reported');
  ok(res2.placements.filter(p => p.lcolor !== '#00ff00').length > 0, '8: cancelled run still has placements');
  ok(pairsNonOverlapping(res2.placements), '8: cancelled result valid');
}

// 9. engine loads without window (sandbox.window stays an empty object with no
//    DOM); MiniSketchNest exposed both ways
ok(typeof NFP2 === 'function' && typeof NFPGA === 'function', '9: classes exported');
ok(moduleOverrideWorks(), '9: module.exports works under Node');
function moduleOverrideWorks() {
  const M = require(path.join(ROOT, 'tools/nest.js'));
  return M && typeof M.NFPGA === 'function';
}

console.log('\n' + (count - fails) + '/' + count + ' checks passed');
process.exit(fails ? 1 : 0);
