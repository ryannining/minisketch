// Comprehensive probe & benchmark for the upgraded True NFP/IFP nesting engine:
//   1. True NFP concave interlocking (L-shapes lock tighter than bbox)
//   2. Concave part-in-hole accuracy (rejects chord-crossing, accepts valid fit)
//   3. Pairwise NFP cache & shape deduplication hit ratio
//   4. Automatic multi-sheet overflow + oversized part safety guard
//   5. Sub-mm binary-search compaction precision
//   6. Web Worker infinite mode with warm NFP cache, island seed, and graceful Stop
//   7. UI preset & collapsible advanced options wiring
//
// Run: node testing/nest_true_nfp_probe.js
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function loadNestEngine() {
  const sandbox = {
    console,
    performance: { now: () => Date.now() },
    Math,
    setTimeout,
    clearTimeout,
    navigator: { userAgent: 'node' },
    module: { exports: {} }
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'tools/clipper.js'), 'utf8'), sandbox, { filename: 'clipper.js' });
  sandbox.ClipperLib = sandbox.module.exports;
  delete sandbox.module;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'tools/nest.js'), 'utf8'), sandbox, { filename: 'nest.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'tools/nest_io.js'), 'utf8'), sandbox, { filename: 'nest_io.js' });
  return { Nest: sandbox.window.MiniSketchNest, NestIO: sandbox.self.NestIO || sandbox.NestIO, ClipperLib: sandbox.ClipperLib };
}

const { Nest, NestIO } = loadNestEngine();
const { GEOM_SCALE, Point, Path, GeometryUtil, NFPCache, NFP2, NFPGA } = Nest;

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra !== undefined ? ' (' + extra + ')' : '')); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? ' -> ' + extra : '')); }
}

function polyPath(outerMm, holesMm, originIndex, lcolor) {
  const paths = [outerMm.map(p => new Point(p[0] * GEOM_SCALE, p[1] * GEOM_SCALE))];
  for (const h of (holesMm || [])) {
    paths.push(h.map(p => new Point(p[0] * GEOM_SCALE, p[1] * GEOM_SCALE)));
  }
  return new Path(paths, originIndex, null, lcolor || null);
}

function makeVariants(basePath, angles, originIndex) {
  return angles.map(a => {
    const v = basePath.clone();
    if (a !== 0) v.rotate(a);
    else v.align();
    v.originIndex = originIndex;
    return v;
  });
}

function placedInner(placements) {
  return (placements || []).filter(p => p.lcolor !== '#00ff00');
}

function pairsNonOverlapping(placements) {
  const ps = placedInner(placements);
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const aInB = GeometryUtil.polygonsIntersectAt(ps[i], 0, 0, ps[j], true);
      const bInA = GeometryUtil.polygonsIntersectAt(ps[j], 0, 0, ps[i], true);
      if (aInB && bInA) return false;
    }
  }
  return true;
}

function allInsideSheet(placements, wMm, hMm) {
  const W = wMm * GEOM_SCALE, H = hMm * GEOM_SCALE;
  for (const p of placedInner(placements)) {
    const b = p.getBounds();
    if (b.x < -2 || b.y < -2 || b.x + b.width > W + 2 || b.y + b.height > H + 2) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// 1. True NFP Concave Interlocking (two 60x60 L-shapes lock inside 85x65)
// ---------------------------------------------------------------------------
console.log('\n== 1. True NFP Concave Interlocking ==');
{
  // L-shape: 60x60 outer, arm thickness 20 -> two inverted L's fit in 80x60!
  const lShape = [[0, 0], [60, 0], [60, 20], [20, 20], [20, 60], [0, 60]];
  const sheet = polyPath([[0, 0], [85, 0], [85, 65], [0, 65]], [], 0, '#00ff00');
  const p1 = polyPath(lShape, [], 1); p1.align();
  const p2 = polyPath(lShape, [], 2); p2.align();
  const parts = [
    { originIndex: 1, lcolor: null, childIndex: [], variants: makeVariants(p1, [0, 90, 180, 270], 1) },
    { originIndex: 2, lcolor: null, childIndex: [], variants: makeVariants(p2, [0, 90, 180, 270], 2) },
    { originIndex: 0, lcolor: '#00ff00', childIndex: [], variants: [sheet] }
  ];
  const ga = new NFPGA();
  ga.setSpacing(0);
  ga.setGAParams(6, 4, 0.15);
  const placements = ga.findBestPosition(parts, { width: 85, height: 65 }, null, 4 * GEOM_SCALE);
  const inner = placedInner(placements);
  const bb = ga.calculateTotalBounds(placements);
  const bW = bb.width / GEOM_SCALE, bH = bb.height / GEOM_SCALE;
  check('both L-shapes interlocked inside 85x65 sheet (impossible without true NFP)', inner.length === 2,
    inner.length + '/2, block ' + bW.toFixed(1) + 'x' + bH.toFixed(1) + ' mm');
  check('interlocked L-shapes have zero overlap', pairsNonOverlapping(placements));
  check('interlocked L-shapes stay inside sheet', allInsideSheet(placements, 85, 65));
  check('interlocked block area < 5500 mm² (non-interlocking bbox requires 7200 mm²)', bW * bH < 5500,
    (bW * bH).toFixed(0) + ' mm²');
}

// ---------------------------------------------------------------------------
// 2. Exact Concave Part-in-Hole
// ---------------------------------------------------------------------------
console.log('\n== 2. Concave Part-in-Hole Accuracy ==');
{
  // Outer 100x100 frame with an L-shaped concave hole:
  // [10,90]x[10,90] minus the upper-right notch [45,90]x[45,90]
  // So the reflex corner is at (45, 45).
  const frameOuter = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const lHole = [[10, 10], [90, 10], [90, 45], [45, 45], [45, 90], [10, 90]];
  const frame = polyPath(frameOuter, [lHole], 1);
  frame.align();

  // Part A: Triangle whose 3 vertices sit INSIDE the L-hole ((20,80), (80,20), (20,20)),
  //         while its hypotenuse from (20,80) to (80,20) crosses through (50,50) — OUTSIDE the concave hole!
  const chordCross = polyPath([[20, 20], [80, 20], [20, 80]], [], 2);
  check('polyOutsideAt rejects triangle whose chord crosses concave hole notch',
    GeometryUtil.polyOutsideAt(chordCross, 0, 0, frame, 1) === true);

  // Part B: Valid 25x25 square at (15, 15) strictly inside the lower-left of L-hole
  const validIn = polyPath([[15, 15], [40, 15], [40, 40], [15, 40]], [], 3);
  check('polyOutsideAt accepts square strictly inside concave L-hole',
    GeometryUtil.polyOutsideAt(validIn, 0, 0, frame, 1) === false);

  // End-to-end: nest frame + chord-crossing triangle + valid 24x24 square in a 105x105 sheet.
  // The valid 24x24 square MUST go inside the L-hole, while the chord-crossing triangle MUST NOT!
  const sheet = polyPath([[0, 0], [105, 0], [105, 105], [0, 105]], [], 0, '#00ff00');
  const triAlign = polyPath([[0, 0], [60, 0], [0, 60]], [], 2); triAlign.align();
  const sqAlign = polyPath([[0, 0], [24, 0], [24, 24], [0, 24]], [], 3); sqAlign.align();
  const parts = [
    { originIndex: 1, lcolor: null, childIndex: [], variants: [frame] },
    { originIndex: 2, lcolor: null, childIndex: [], variants: [triAlign] },
    { originIndex: 3, lcolor: null, childIndex: [], variants: [sqAlign] },
    { originIndex: 0, lcolor: '#00ff00', childIndex: [], variants: [sheet] }
  ];
  const ga = new NFPGA();
  ga.setSpacing(0);
  ga.setGAParams(4, 2, 0.1);
  const placements = ga.findBestPosition(parts, { width: 105, height: 105 }, null, 4 * GEOM_SCALE);
  const placedFrame = placements.find(p => p.originIndex === 1);
  const placedTri = placements.find(p => p.originIndex === 2);
  const placedSq = placements.find(p => p.originIndex === 3);
  check('frame placed', !!placedFrame);
  check('valid 24x24 square placed INSIDE concave L-hole',
    !!placedSq && !!placedFrame && !GeometryUtil.polyOutsideAt(placedSq, 0, 0, placedFrame, 1));
  check('chord-crossing 60x60 triangle NOT illegally placed inside concave L-hole',
    !placedTri || !GeometryUtil.polygonsIntersectAt(placedTri, 0, 0, placedFrame, true));
  check('zero overlap in concave hole scenario', pairsNonOverlapping(placements));
}

// ---------------------------------------------------------------------------
// 3. Pairwise NFP Cache & Shape Deduplication
// ---------------------------------------------------------------------------
console.log('\n== 3. NFP Cache & Shape Deduplication ==');
{
  const lShape = [[0, 0], [40, 0], [40, 15], [15, 15], [15, 40], [0, 40]];
  const sheet = polyPath([[0, 0], [220, 0], [220, 200], [0, 200]], [], 0, '#00ff00');
  const parts = [{ originIndex: 0, lcolor: '#00ff00', childIndex: [], variants: [sheet] }];
  const base = polyPath(lShape, [], 1); base.align();
  for (let i = 1; i <= 16; i++) {
    parts.push({ originIndex: i, lcolor: null, childIndex: [], variants: makeVariants(base, [0, 180], i) });
  }
  const ga = new NFPGA();
  ga.setSpacing(0);
  ga.setGAParams(6, 4, 0.12);
  ga.setLocalSearchBudget(6);
  const t0 = Date.now();
  const gen = ga.findBestPositionGen(parts, { width: 220, height: 200 }, 4 * GEOM_SCALE, {});
  let r;
  for (;;) { const n = gen.next(); if (n.done) { r = n.value; break; } }
  const ms = Date.now() - t0;
  const cs = r.stats.nfpCache;
  check('all 16 identical L-brackets packed', placedInner(r.placements).length === 16,
    placedInner(r.placements).length + '/16 in ' + ms + ' ms, util=' + r.utilization.toFixed(1) + '%');
  check('zero overlap across 16 L-brackets', pairsNonOverlapping(r.placements));
  check('NFP cache hit ratio > 90%', cs.nfpHits > cs.nfpMisses * 10,
    'hits=' + cs.nfpHits + ', misses=' + cs.nfpMisses);
}

// ---------------------------------------------------------------------------
// 4. Multi-Sheet Automatic Overflow + Oversized Guard
// ---------------------------------------------------------------------------
console.log('\n== 4. Multi-Sheet Overflow & Oversized Guard ==');
{
  const sheet = polyPath([[0, 0], [100, 0], [100, 100], [0, 100]], [], 0, '#00ff00');
  const parts = [{ originIndex: 0, lcolor: '#00ff00', childIndex: [], variants: [sheet] }];
  for (let i = 1; i <= 10; i++) {
    const sq = polyPath([[0, 0], [45, 0], [45, 45], [0, 45]], [], i); sq.align();
    parts.push({ originIndex: i, lcolor: null, childIndex: [], variants: [sq] });
  }
  const ga = new NFPGA();
  ga.setSpacing(0);
  ga.setGAParams(4, 2, 0.1);
  ga.setLocalSearchBudget(2);
  const gen = ga.findBestMultiSheetGen(parts, { width: 100, height: 100 }, 4 * GEOM_SCALE, { multiSheet: true });
  let res;
  for (;;) { const n = gen.next(); if (n.done) { res = n.value; break; } }
  check('multi-sheet places all 10 squares across 3 sheets',
    res.totalPlaced === 10 && res.unplaced === 0 && res.sheets.length === 3,
    res.totalPlaced + ' placed across ' + res.sheets.length + ' sheets');
  const allSheetsValid = res.sheets.every(sh =>
    pairsNonOverlapping(sh.placements) && allInsideSheet(sh.placements, 100, 100)
  );
  check('every sheet has zero overlap and stays inside 100x100 frame', allSheetsValid);

  // Oversized guard: 3 fit + 1 oversized (150x150)
  const parts2 = [{ originIndex: 0, lcolor: '#00ff00', childIndex: [], variants: [sheet] }];
  for (let i = 1; i <= 3; i++) {
    const sq = polyPath([[0, 0], [30, 0], [30, 30], [0, 30]], [], i); sq.align();
    parts2.push({ originIndex: i, lcolor: null, childIndex: [], variants: [sq] });
  }
  const giant = polyPath([[0, 0], [150, 0], [150, 150], [0, 150]], [], 4); giant.align();
  parts2.push({ originIndex: 4, lcolor: null, childIndex: [], variants: [giant] });
  const gen2 = ga.findBestMultiSheetGen(parts2, { width: 100, height: 100 }, 4 * GEOM_SCALE, { multiSheet: true });
  let res2;
  for (;;) { const n = gen2.next(); if (n.done) { res2 = n.value; break; } }
  check('oversized part does not trigger infinite sheets',
    res2.sheets.length === 1 && res2.totalPlaced === 3 && res2.unplaced === 1,
    res2.sheets.length + ' sheet, ' + res2.totalPlaced + ' placed, ' + res2.unplaced + ' unplaced');
}

// ---------------------------------------------------------------------------
// 5. Sub-mm Compaction
// ---------------------------------------------------------------------------
console.log('\n== 5. Sub-mm Binary-Search Compaction ==');
{
  const sheet = polyPath([[0, 0], [100, 0], [100, 100], [0, 100]], [], 0, '#00ff00');
  const p1 = polyPath([[10.35, 12.75], [30.35, 12.75], [30.35, 32.75], [10.35, 32.75]], [], 1);
  const p2 = polyPath([[45.8, 12.75], [65.8, 12.75], [65.8, 32.75], [45.8, 32.75]], [], 2);
  const placements = [sheet, p1, p2];
  const ga = new NFPGA();
  ga.compactSolution(placements, { width: 100, height: 100 });
  const b1 = p1.getBounds(), b2 = p2.getBounds();
  check('part 1 settled within 0.1 mm of origin',
    b1.x / GEOM_SCALE <= 0.1 && b1.y / GEOM_SCALE <= 0.1,
    '(' + (b1.x / GEOM_SCALE).toFixed(2) + ', ' + (b1.y / GEOM_SCALE).toFixed(2) + ')');
  check('part 2 settled within 0.1 mm of part 1',
    Math.abs((b2.x - (b1.x + b1.width)) / GEOM_SCALE) <= 0.1 && b2.y / GEOM_SCALE <= 0.1,
    'gap=' + ((b2.x - (b1.x + b1.width)) / GEOM_SCALE).toFixed(3) + ' mm');
  check('compacted parts have zero overlap', pairsNonOverlapping(placements));
}

// ---------------------------------------------------------------------------
// 6. Web Worker Infinite Mode + Warm Cache + Stop
// ---------------------------------------------------------------------------
console.log('\n== 6. Web Worker Infinite Mode & Warm Cache ==');
function testWorkerInfinite() {
  return new Promise((resolve) => {
    const messages = [];
    const workerSandbox = {
      console,
      Math,
      Date,
      performance: { now: () => Date.now() },
      setTimeout,
      clearTimeout,
      importScripts: (...files) => {
        for (const f of files) {
          const full = path.join(ROOT, 'tools', f);
          if (f === 'clipper.js') {
            workerSandbox.module = { exports: {} };
            vm.runInContext(fs.readFileSync(full, 'utf8'), workerSandbox, { filename: f });
            workerSandbox.ClipperLib = workerSandbox.module.exports;
            delete workerSandbox.module;
          } else {
            vm.runInContext(fs.readFileSync(full, 'utf8'), workerSandbox, { filename: f });
          }
        }
      },
      postMessage: (m) => {
        messages.push(m);
        if (m.type === 'best' && m.iter >= 1 && !sentSeed) {
          sentSeed = true;
          workerSandbox.self.onmessage({ data: { cmd: 'seed', jobId: 'w0', seed: m.result.bestOrder } });
        }
        if (m.type === 'progress' && m.iter >= 2 && !sentStop) {
          sentStop = true;
          workerSandbox.self.onmessage({ data: { cmd: 'stop', jobId: 'w0' } });
        }
        if (m.type === 'result' || m.type === 'error') {
          finish();
        }
      }
    };
    workerSandbox.self = workerSandbox;
    workerSandbox.globalThis = workerSandbox;
    vm.createContext(workerSandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'tools/nest_worker.js'), 'utf8'), workerSandbox, { filename: 'nest_worker.js' });

    let sentSeed = false, sentStop = false, finished = false;
    const safetyTimer = setTimeout(() => {
      if (!sentStop) {
        sentStop = true;
        workerSandbox.self.onmessage({ data: { cmd: 'stop', jobId: 'w0' } });
      }
    }, 1500);
    const hardTimer = setTimeout(() => finish(), 3000);

    function finish() {
      if (finished) return;
      finished = true;
      clearTimeout(safetyTimer);
      clearTimeout(hardTimer);
      const bestMsgs = messages.filter(m => m.type === 'best');
      const resMsg = messages.find(m => m.type === 'result');
      const errMsg = messages.find(m => m.type === 'error');
      check('worker ran without errors', !errMsg, errMsg ? errMsg.error : 'ok');
      check('infinite worker emitted live best message', bestMsgs.length >= 1, bestMsgs.length + ' best msg(s)');
      check('infinite worker stopped cleanly with final result', !!resMsg && resMsg.result && resMsg.result.totalPlaced === 6,
        resMsg && resMsg.result ? resMsg.result.totalPlaced + ' placed' : 'none');
      const nfpStats = resMsg && resMsg.result && resMsg.result.stats && resMsg.result.stats.nfpCache;
      check('warm NFP cache reused across infinite iterations', !!nfpStats && nfpStats.nfpHits > 0,
        nfpStats ? ('hits=' + nfpStats.nfpHits + ', misses=' + nfpStats.nfpMisses) : 'none');
      resolve();
    }

    const sheet = polyPath([[0, 0], [100, 0], [100, 100], [0, 100]], [], 0, '#00ff00');
    const rawEntries = [{ originIndex: 0, lcolor: '#00ff00', childIndex: [], variants: [sheet] }];
    for (let i = 1; i <= 6; i++) {
      const sq = polyPath([[0, 0], [40, 0], [40, 40], [0, 40]], [], i); sq.align();
      rawEntries.push({ originIndex: i, lcolor: null, childIndex: [], variants: [sq] });
    }
    workerSandbox.self.onmessage({
      data: {
        cmd: 'start',
        jobId: 'w0',
        input: {
          entriesData: NestIO.serializeEntries(rawEntries),
          spacing: 0,
          flip: false,
          multiSheet: true,
          maxVerts: 56,
          infinite: true,
          popSize: 4,
          generations: 2,
          mutation: 0.12,
          ls: 2,
          grid: 4 * GEOM_SCALE
        }
      }
    });
  });
}

// ---------------------------------------------------------------------------
// 7. High-Vertex Curved Silhouette Benchmark + UI Wiring Check
// ---------------------------------------------------------------------------
console.log('\n== 7. Curved High-Vertex Benchmark & UI Wiring ==');
{
  // Build 8 wavy 160-vertex blobs (similar to traced vector art)
  const blobPts = [];
  for (let i = 0; i < 160; i++) {
    const a = (i / 160) * Math.PI * 2;
    const r = 24 + 6 * Math.sin(a * 5);
    blobPts.push([35 + Math.cos(a) * r, 35 + Math.sin(a) * r]);
  }
  const sheet = polyPath([[0, 0], [260, 0], [260, 160], [0, 160]], [], 0, '#00ff00');
  const parts = [{ originIndex: 0, lcolor: '#00ff00', childIndex: [], variants: [sheet] }];
  const baseBlob = polyPath(blobPts, [], 1); baseBlob.align();
  for (let i = 1; i <= 8; i++) {
    parts.push({ originIndex: i, lcolor: null, childIndex: [], variants: makeVariants(baseBlob, [0, 90], i) });
  }
  const ga = new NFPGA();
  ga.setSpacing(0);
  ga.setGAParams(6, 4, 0.12);
  ga.setLocalSearchBudget(4);
  const t0 = Date.now();
  const placements = ga.findBestPosition(parts, { width: 260, height: 160 }, null, 4 * GEOM_SCALE);
  const ms = Date.now() - t0;
  check('8 high-vertex (160pt) curved blobs packed quickly',
    placedInner(placements).length === 8 && ms < 4000,
    placedInner(placements).length + '/8 in ' + ms + ' ms');
  check('8 curved blobs have zero overlap', pairsNonOverlapping(placements));
  check('8 curved blobs stay inside sheet', allInsideSheet(placements, 260, 160));

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  check('index.html has #nest-preset, #nest-multisheet, #nest-adv',
    html.includes('id="nest-preset"') && html.includes('id="nest-multisheet"') && html.includes('id="nest-adv"'));
  check('app.js wires NEST_PRESETS and nestApplyPreset',
    /const NEST_PRESETS\b/.test(app) && /function nestApplyPreset/.test(app));
  check('app.js uses Web Workers for infinite mode too',
    /if \(!nestCanUseWorkers\(\)\)/.test(app) && /cmd:\s*'seed'/.test(app));
}

// ---------------------------------------------------------------------------
// 8. Explicit Multi-Sheet Inventory (Multiple Green Loops & Sheet Notes)
// ---------------------------------------------------------------------------
console.log('\n== 8. Explicit Multi-Sheet Inventory & Leftovers Outside ==');
{
  // 8a. Heterogeneous sheets: Sheet 0 = 60x60 (fits 1 x 45x45), Sheet -1 = 100x100 (fits 4 x 45x45).
  // Supply 7 parts of 45x45 -> 5 placed across the 2 sheets, 2 left unplaced (NEVER spawns sheet 3 even if multiSheet:true).
  const shA = polyPath([[0, 0], [60, 0], [60, 60], [0, 60]], [], 0, '#00ff00'); shA.align();
  const shB = polyPath([[0, 0], [100, 0], [100, 100], [0, 100]], [], -1, '#00ff00'); shB.align();
  const entries = [
    { originIndex: 0, lcolor: '#00ff00', childIndex: [], variants: [shA] },
    { originIndex: -1, lcolor: '#00ff00', childIndex: [], variants: [shB] }
  ];
  for (let i = 1; i <= 7; i++) {
    const sq = polyPath([[0, 0], [45, 0], [45, 45], [0, 45]], [], i); sq.align();
    entries.push({ originIndex: i, lcolor: null, childIndex: [], variants: [sq] });
  }
  const ga = new NFPGA();
  ga.setSpacing(0);
  ga.setGAParams(4, 2, 0.12);
  ga.setLocalSearchBudget(2);
  const gen = ga.findBestMultiSheetGen(entries, { width: 1, height: 1 }, 4 * GEOM_SCALE, {
    multiSheet: true,
    finiteSheets: true
  });
  let r;
  for (;;) { const n = gen.next(); if (n.done) { r = n.value; break; } }
  check('heterogeneous 2-sheet inventory strictly capped at 2 sheets', r.sheets.length === 2, r.sheets.length + ' sheets');
  check('heterogeneous 2-sheet places 5 and leaves 2 unplaced outside',
    r.totalPlaced === 5 && r.unplaced === 2,
    r.totalPlaced + ' placed, ' + r.unplaced + ' unplaced');
  check('each sheet preserves its own sheetOriginIndex (0 and -1)',
    r.sheets[0].sheetOriginIndex === 0 && r.sheets[1].sheetOriginIndex === -1,
    r.sheets.map(s => s.sheetOriginIndex).join(','));
  check('Sheet 0 parts fit inside 60x60 and Sheet 1 parts fit inside 100x100',
    allInsideSheet(r.sheets[0].placements, 60, 60) && allInsideSheet(r.sheets[1].placements, 100, 100));
  const serialized = NestIO.buildWorkerResult(ga, r);
  check('NestIO preserves sheetOriginIndex per sheet',
    serialized.sheets[0].sheetOriginIndex === 0 && serialized.sheets[1].sheetOriginIndex === -1);

  // 8b. Small remnant sheet (30x30) + larger sheet (100x100) with 2 parts of 45x45:
  // Sheet 0 fits 0 parts -> must NOT abort early; must continue to Sheet -1 and place both parts!
  const shSmall = polyPath([[0, 0], [30, 0], [30, 30], [0, 30]], [], 0, '#00ff00'); shSmall.align();
  const shBig = polyPath([[0, 0], [100, 0], [100, 100], [0, 100]], [], -1, '#00ff00'); shBig.align();
  const entriesRem = [
    { originIndex: 0, lcolor: '#00ff00', childIndex: [], variants: [shSmall] },
    { originIndex: -1, lcolor: '#00ff00', childIndex: [], variants: [shBig] }
  ];
  for (let i = 1; i <= 2; i++) {
    const sq = polyPath([[0, 0], [45, 0], [45, 45], [0, 45]], [], i); sq.align();
    entriesRem.push({ originIndex: i, lcolor: null, childIndex: [], variants: [sq] });
  }
  const genRem = ga.findBestMultiSheetGen(entriesRem, { width: 1, height: 1 }, 4 * GEOM_SCALE, {
    multiSheet: false,
    finiteSheets: true
  });
  let rRem;
  for (;;) { const n = genRem.next(); if (n.done) { rRem = n.value; break; } }
  check('remnant-skip: continues past too-small sheet 0 and places both on sheet -1',
    rRem.totalPlaced === 2 && rRem.unplaced === 0 && rRem.sheets.length === 1 && rRem.sheets[0].sheetOriginIndex === -1,
    'placed=' + rRem.totalPlaced + ' sheetOrig=' + (rRem.sheets[0] && rRem.sheets[0].sheetOriginIndex));

  // 8c. App-level note inside green box vs note inside part + heterogeneous nestApplyResult
  const Core = require(path.join(ROOT, 'core.js'));
  const appSrc = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  function sliceAppFn(name) {
    const start = appSrc.indexOf('  function ' + name + '(');
    if (start < 0) throw new Error('missing ' + name);
    let depth = 0, i = appSrc.indexOf('{', start);
    for (; i < appSrc.length; i++) {
      if (appSrc[i] === '{') depth++;
      else if (appSrc[i] === '}' && --depth === 0) return appSrc.slice(start, i + 1);
    }
    throw new Error('unclosed ' + name);
  }
  const st = {
    points: {
      // Sheet 1 (0..60 x 0..60) + note "2" inside Sheet 1 at (5,5)
      s1a: { x: 0, y: 0 }, s1b: { x: 60, y: 0 }, s1c: { x: 60, y: 60 }, s1d: { x: 0, y: 60 },
      nSheet: { x: 5, y: 5 },
      // Part 1 (20..50 x 20..50 — physically sitting INSIDE Sheet 1!) + note "3" inside Part 1 at (35,35)
      p1a: { x: 20, y: 20 }, p1b: { x: 50, y: 20 }, p1c: { x: 50, y: 50 }, p1d: { x: 20, y: 50 },
      nPart: { x: 35, y: 35 },
      // Sheet 2 (80..200 x 10..90 — different size & Y offset!)
      s2a: { x: 80, y: 10 }, s2b: { x: 200, y: 10 }, s2c: { x: 200, y: 90 }, s2d: { x: 80, y: 90 }
    },
    entities: {
      1: { id: 1, type: 'line', a: 's1a', b: 's1b', color: '#00ff00' },
      2: { id: 2, type: 'line', a: 's2a', b: 's2b', color: '#00ff00' },
      3: { id: 3, type: 'line', a: 'p1a', b: 'p1b', color: '#ffffff' },
      10: { id: 10, type: 'note', p: 'nSheet', text: '2' },
      11: { id: 11, type: 'note', p: 'nPart', text: '3' }
    },
    nextId: 100
  };
  const uiStub = { activeLayer: 1, selection: [] };
  const fnSrc = `
    const NEST_OUT_GAP = 50, NEST_SIMPLIFY_MM = 0.02, NEST_MAX_COPIES = 500;
    const P = (id) => state.points[id] || null;
    const entityPointIds = (e) => e.type === 'line' ? [e.a, e.b] : [];
    const colorOf = (e) => (e && e.color) || '#ffffff';
    const pushHistory = () => {};
    const commit = () => {};
    const invalidateLoops = () => {};
    const toast = () => {};
    const nestSetStatus = () => {};
    const newId = () => ++state.nextId;
    const removeEntities = () => {};
    const document = { getElementById: () => ({ checked: false }) };
    ${sliceAppFn('nestEnginePoly')}
    ${sliceAppFn('nestCommentCount')}
    ${sliceAppFn('nestRotationAngles')}
    ${sliceAppFn('nestBuildEntries')}
    ${sliceAppFn('nestPlacementMatrixAt')}
    ${sliceAppFn('nestAnchorOf')}
    ${sliceAppFn('nestApplyResult')}
    return { nestBuildEntries, nestApplyResult };
  `;
  const appHelpers = new Function('MiniSketchNest', 'pointInPoly', 'state', 'ui', fnSrc)(
    Nest, Core.pointInPoly, st, uiStub
  );
  const shRec1 = {
    loop: { poly: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 60 }, { x: 0, y: 60 }], area: 3600 },
    entityIds: [1]
  };
  const shRec2 = {
    loop: { poly: [{ x: 80, y: 10 }, { x: 200, y: 10 }, { x: 200, y: 90 }, { x: 80, y: 90 }], area: 9600 },
    entityIds: [2]
  };
  const partRec1 = {
    loop: { poly: [{ x: 20, y: 20 }, { x: 50, y: 20 }, { x: 50, y: 50 }, { x: 20, y: 50 }], area: 900 },
    entityIds: [3]
  };
  const built = appHelpers.nestBuildEntries([shRec2, shRec1], [{ outer: partRec1, holeRecs: [] }], 0, '0', false);
  const builtSheets = built.filter(e => e.lcolor === '#00ff00');
  const builtParts = built.filter(e => e.lcolor !== '#00ff00');
  check('note "3" inside part sitting inside Sheet 1 gives 3 parts, NOT 3 copies of Sheet 1',
    builtParts.length === 3, 'parts=' + builtParts.length);
  check('Sheet 1 note "2" + Sheet 2 (default 1) gives 3 sheet entries sorted left-to-right',
    builtSheets.length === 3 &&
    builtSheets[0].originIndex === 0 && builtSheets[0]._sheetExplicitNote === true &&
    builtSheets[1].originIndex === -1 && builtSheets[1]._sheetExplicitNote === true &&
    builtSheets[2].originIndex === -2 && builtSheets[2]._sheetExplicitNote === false,
    builtSheets.map(s => s.originIndex + ':' + s._sheetExplicitNote).join(','));

  // Test nestApplyResult with heterogeneous sheets (Sheet 0: 60x60, Sheet -2: 120x80) + 1 unplaced part below
  const pPlaced1 = builtParts[0].variants[0].clone();
  const pPlaced2 = builtParts[1].variants[0].clone();
  const mockSheets = [
    { sheetIndex: 0, sheetOriginIndex: 0, placements: [pPlaced1], blockBounds: ga.calculateTotalBounds([pPlaced1]), utilization: 25 },
    { sheetIndex: 1, sheetOriginIndex: -2, placements: [pPlaced2], blockBounds: ga.calculateTotalBounds([pPlaced2]), utilization: 10 }
  ];
  const jobStub = {
    entries: built,
    sheetBounds: { minX: 0, minY: 0, maxX: 200, maxY: 90 },
    spacing: 0,
    variantAngles: [0],
    flip: false,
    ga
  };
  appHelpers.nestApplyResult(jobStub, [pPlaced1], 2, 1, false, false, mockSheets);
  const clones = Object.values(st.entities).filter(e => e.type === 'array' && e.kind === 'clone' && e.params.origin === 'nest');
  const frames = clones.filter(c => c.params.role === 'frame');
  const partClones = clones.filter(c => c.params.role !== 'frame');
  // Frame 0 starts at baseOutX = 200 + 50 = 250 (width 60 -> ends 310); Frame 1 starts at 310 + 50 = 360 (s2 minX=80 -> tx=280)
  const f0OutX = frames[0].instances[0].m[4] + 0;
  const f1OutX = frames[1].instances[0].m[4] + 80;
  const unplacedClone = partClones.find(c => c.params.sheet == null);
  const unplacedY = unplacedClone ? (unplacedClone.instances[0].m[5] + 20) : -1;
  check('heterogeneous sheet frames placed side-by-side without overlap (250 then 360)',
    frames.length === 2 && Math.abs(f0OutX - 250) < 1e-6 && Math.abs(f1OutX - 360) < 1e-6,
    'f0=' + f0OutX + ', f1=' + f1OutX);
  check('unplaced leftover part stacked cleanly outside below the sheets',
    !!unplacedClone && unplacedY >= 140,
    'unplacedY=' + unplacedY);
}

testWorkerInfinite().then(() => {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
});
