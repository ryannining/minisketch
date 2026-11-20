// Regression smoke tests for core.js. Run with:  node tests/smoke.js
// These pin down bugs that were actually found and fixed in the app, so a
// future change cannot silently bring them back.
'use strict';

const C = require('../core.js');
let failures = 0;

function ok(cond, label) {
  if (cond) {
    console.log('  ok  ' + label);
  } else {
    failures++;
    console.log('  FAIL ' + label);
  }
}

function close(a, b, tol, label) {
  ok(Math.abs(a - b) <= tol, label + ' (' + a + ' vs ' + b + ')');
}

// --- splineSamples -----------------------------------------------------------
console.log('splineSamples');
{
  // a closed pair of nodes is a full loop (an SVG circle is exactly this):
  // it must draw BOTH halves, not stop after the first segment.
  const cps = [{ x: 0, y: 0 }, { x: 4, y: 0 }];
  const hs = { o: [{ x: 0, y: 2 }, { x: 4, y: -2 }], i: [{ x: 0, y: -2 }, { x: 4, y: 2 }] };
  const s = C.splineSamples(cps, hs, true);
  ok(s.length === 2 * C.SPLINE_SEG + 1, 'closed 2-node spline draws both segments (' + s.length + ' samples)');
  const back = s[s.length - 1];
  close(back.x, 0, 1e-9, 'closed 2-node spline returns to its start (x)');
  close(back.y, 0, 1e-9, 'closed 2-node spline returns to its start (y)');

  // a missing handle is a corner, never a dropped segment
  const cps2 = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }];
  const hs2 = { o: [null, null, null], i: [null, null, null] };
  const s2 = C.splineSamples(cps2, hs2, true);
  ok(s2.length === 3 * C.SPLINE_SEG + 1, 'null handles keep every segment (' + s2.length + ' samples)');
  const mid = s2[Math.floor(C.SPLINE_SEG / 2)];
  close(mid.x, 0.5, 1e-9, 'corner with null handles draws a straight chord (x)');
  close(mid.y, 0.5, 1e-9, 'corner with null handles draws a straight chord (y)');
}

// --- SVG path parsing (g01.svg) ----------------------------------------------
console.log('svgPathSegments / svgSegmentsToSubpaths');
{
  const d1 = 'm -35.458916,340.49634 c 0,2.66667 -4,2.66667 -4,0 0,-2.66667 4,-2.66667 4,0 z';
  const d3 = 'm -20.319921,347.49714 -13.192354,-11.52002 c -6.027018,-5.26219 -13.920372,3.77635 -7.893334,9.03836 l 14.440197,12.61035 c 1.59816,1.39608 3.685229,2.0997 5.802061,1.957 l 28.2786034,-1.91277 c 2.1168938,-0.14347 4.0902116,-1.12171 5.4858596,-2.71971 l 12.610619,-14.4406 c 5.26228,-6.02541 -3.776247,-13.91878 -9.038479,-7.89294 l -9.3411235,10.69673 c -1.395655,1.59758 -3.3689731,2.57582 -5.4858589,2.71839 z';
  ok(C.svgPathSegments(d1).map(s => s.t).join('') === 'MCCZ', 'circle path parses as M C C Z');
  ok(C.svgPathSegments(d3).map(s => s.t).join('') === 'MLCLCLCLCLCLZ', 'mixed path parses without losing the last segment');

  const subs = C.svgSegmentsToSubpaths(C.svgPathSegments(d1));
  ok(subs.length === 1 && subs[0].nodes.length === 2 && subs[0].closed, 'circle subpath: 2 nodes, closed');
  ok(subs[0].nodes.every(n => n.i && n.o), 'circle subpath keeps handles on both nodes');

  const subs3 = C.svgSegmentsToSubpaths(C.svgPathSegments(d3));
  ok(subs3.length === 1 && subs3[0].nodes.length === 11, 'mixed subpath keeps all 11 nodes');
  ok(subs3[0].nodes.filter(n => !n.o).length === 6, 'line corners carry null handles (6 of 11)');
}

// --- drag-wall collision helpers --------------------------------------------
console.log('polyBBox / segmentsIntersect / polylineIntersectsPolyline');
{
  const box = C.polyBBox([{ x: -2, y: 1 }, { x: 5, y: -3 }, { x: 0, y: 4 }]);
  ok(box && box.minX === -2 && box.maxX === 5 && box.minY === -3 && box.maxY === 4,
    'polyBBox spans the real points');
  ok(C.bboxOverlap(box, { minX: 5, minY: -3, maxX: 8, maxY: 0 }), 'bbox overlap catches a shared edge');
  ok(!C.bboxOverlap(box, { minX: 5.1, minY: -3, maxX: 8, maxY: 0 }), 'bbox overlap rejects a gap');

  const a = { x: 0, y: 0 }, b = { x: 10, y: 0 };
  ok(C.segmentsIntersect(a, b, { x: 5, y: -5 }, { x: 5, y: 5 }), 'crossing segments intersect');
  ok(C.segmentsIntersect(a, b, { x: 5, y: 0 }, { x: 5, y: 5 }), 'touching at a T-junction intersects');
  ok(C.segmentsIntersect(a, b, { x: 10, y: 0 }, { x: 10, y: 5 }), 'touching at an endpoint intersects');
  ok(!C.segmentsIntersect(a, b, { x: 5, y: 1 }, { x: 5, y: 5 }), 'parallel-with-a-gap does not intersect');
  ok(!C.segmentsIntersect(a, b, { x: 0, y: 1 }, { x: 10, y: 1 }), 'collinear-but-offset does not intersect');

  const rect = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  ok(C.polylineIntersectsPolyline(rect, true, [{ x: 5, y: -1 }, { x: 5, y: 11 }], false),
    'a line crossing a closed polygon is a hit');
  ok(!C.polylineIntersectsPolyline(rect, true, [{ x: 2, y: 2 }, { x: 8, y: 8 }], false),
    'a line fully inside the polygon is not a boundary hit (nesting stays legal)');
  ok(C.polylineIntersectsPolyline(rect, true, [{ x: 10, y: 2 }, { x: 12, y: 2 }], false),
    'touching the polygon edge is a hit');
}


// --- drag-wall offset direction ---------------------------------------------
console.log('drag-wall offset grows outward');
{
  // wallDrag uses a POSITIVE Clipper offset. Pin the sign: a rectangle offset by
  // +1 mm must grow, not shrink. This is the one thing a future refactor could
  // silently flip (and a wall that shrinks would let parts overlap).
  const ClipperLib = require('../tools/clipper.js');
  const rect = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  const co = new ClipperLib.ClipperOffset(4, 0.05 * 1000);
  co.AddPaths([rect.map(p => ({ X: Math.round(p.x * 1000), Y: Math.round(p.y * 1000) }))],
    ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  const raw = new ClipperLib.Paths();
  co.Execute(raw, 1 * 1000);
  const out = raw.map(path => path.map(p => ({ x: p.X / 1000, y: p.Y / 1000 })));
  const b = out[0] && C.polyBBox(out[0]);
  ok(!!b, 'positive offset returns a contour');
  ok(b && b.minX <= -0.999 && b.minY <= -0.999 && b.maxX >= 10.999 && b.maxY >= 10.999,
    'a +1 mm wall offset grows the rectangle outward');
}

// --- solver ------------------------------------------------------------------
console.log('lmSolve');
{
  // drag-style: pull x to 5, y to -2
  const fn = (x) => [(x[0] - 5) * 30, (x[1] + 2) * 30];
  const r = C.lmSolve([0, 0], fn, 60);
  close(r.x[0], 5, 1e-4, 'solver pulls x to its target');
  close(r.x[1], -2, 1e-4, 'solver pulls y to its target');

  // zero residual (drag targets sitting on current positions) must not
  // build a Jacobian at all
  const t0 = Date.now();
  const zero = C.lmSolve([1, 2], (x) => [0, 0], 60);
  ok(zero.iterations === 0, 'zero residual returns without iterating');
  ok(Date.now() - t0 < 50, 'zero residual returns immediately');

  // two points pulled together by a "coincident" pair of residuals
  const pair = (x) => [x[0] - x[2], x[1] - x[3], (x[0] - 10) * 10, (x[1] - 10) * 10];
  const pr = C.lmSolve([0, 0, 3, 4], pair, 60);
  close(pr.x[2], pr.x[0], 1e-3, 'coincident residuals meet (x)');
  close(pr.x[3], pr.x[1], 1e-3, 'coincident residuals meet (y)');
}

// --- polygons ----------------------------------------------------------------
console.log('polygons');
{
  const sq = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }];
  close(C.signedAreaPts(sq), 4, 1e-9, 'signed area of a CCW square');
  ok(C.pointInPoly({ x: 1, y: 1 }, sq), 'point inside the square');
  ok(!C.pointInPoly({ x: 3, y: 1 }, sq), 'point outside the square');

  const cw = sq.slice().reverse();
  const n = C.normalizeWinding([{ pts: cw, closed: true }]);
  ok(C.signedAreaPts(n[0].pts) > 0, 'normalizeWinding turns an outer loop CCW');

  const merged = C.chainPolylines([
    { pts: [{ x: 0, y: 0 }, { x: 2, y: 0 }], closed: false },
    { pts: [{ x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 0, y: 0 }], closed: false }
  ], 0.01);
  ok(merged.length === 1 && merged[0].closed && merged[0].pts.length === 4,
    'chainPolylines joins open segments into one closed loop');
}

// --- misc --------------------------------------------------------------------
console.log('misc');
{
  close(C.round2(12.3456), 12.35, 1e-9, 'round2');
  close(C.round6(0.12345678), 0.123457, 1e-9, 'round6');
  close(C.wrapDeg(270), -90, 1e-9, 'wrapDeg');
  close(C.normDeg(270), -90, 1e-9, 'normDeg wraps into (-180,180]');

  const m = C.parseTransformList('translate(10,20) rotate(90)');
  const p = C.matApply(m, { x: 1, y: 0 });
  close(p.x, 10, 1e-9, 'transform translate+rotate (x)');
  close(p.y, 21, 1e-9, 'transform translate+rotate (y)');

  const segs = C.svgPathSegments('M 0 0 A 5 5 0 0 1 10 0');
  ok(segs.length > 1 && segs[0].t === 'M' && segs.slice(1).every(s => s.t === 'C'),
    'arc command becomes cubics');
}

// --- arc / circle to cubic ---------------------------------------------------
console.log('arcCubicNodes');
{
  const sub = C.arcCubicNodes({ x: 0, y: 0 }, 10, 0, C.TAU, true);
  ok(sub.closed && sub.curved && sub.nodes.length === 4, 'circle becomes a 4-node closed cubic');
  ok(sub.nodes.every(n => n.o && n.i), 'every circle node keeps both handles');
  // sample the first span and check it stays on the circle
  const n0 = sub.nodes[0], n1 = sub.nodes[1];
  const mid = C.cubicAt(n0, n0.o, n1.i, n1, 0.5);
  close(Math.hypot(mid.x, mid.y), 10, 0.03, 'cubic circle stays within 0.03mm of the true radius');
  close(Math.hypot(n0.x, n0.y), 10, 1e-9, 'circle node lies on the circle');

  const arc = C.arcCubicNodes({ x: 1, y: 2 }, 5, 0, Math.PI, false);
  ok(!arc.closed && arc.nodes.length === 3 && arc.nodes.every(n => n.o || n.i),
    'half arc becomes two open cubic spans (3 nodes)');
}

// --- DXF ---------------------------------------------------------------------
console.log('parseDxf');
{
  const pairs = (...arr) => arr.map(p => p[0] + '\n' + p[1] + '\n').join('');
  const dxf = pairs(
    [0, 'SECTION'], [2, 'ENTITIES'],
    [0, 'LINE'], [10, '0'], [20, '0'], [11, '10'], [21, '0'],
    [0, 'CIRCLE'], [10, '5'], [20, '5'], [40, '2'],
    [0, 'ARC'], [10, '0'], [20, '0'], [40, '5'], [50, '0'], [51, '90'],
    [0, 'LWPOLYLINE'], [90, '3'], [70, '1'],
    [10, '0'], [20, '0'], [42, '1'],
    [10, '10'], [20, '0'],
    [10, '10'], [20, '10'],
    [0, 'SPLINE'], [70, '0'],
    [11, '0'], [21, '0'], [11, '5'], [21, '5'], [11, '10'], [21, '0'],
    [0, 'ENDSEC'], [0, 'EOF']
  );
  const prims = C.parseDxf(dxf);
  ok(prims.length === 7, 'seven primitives (line, circle, arc, 3 polyline segs, spline), got ' + prims.length);
  const circ = prims.find(p => p.type === 'circle');
  ok(circ && circ.cx === 5 && circ.cy === 5 && circ.r === 2, 'circle keeps centre and radius');
  const arc = prims.find(p => p.type === 'arc');
  ok(arc && Math.abs(arc.r - 5) < 1e-9 && Math.abs(arc.a0) < 1e-9 && Math.abs(arc.a1 - Math.PI / 2) < 1e-9,
    'arc runs CCW from 0 to 90 degrees in radians');
  const arcs = prims.filter(p => p.type === 'arc').length;
  const lines = prims.filter(p => p.type === 'line').length;
  ok(lines === 3 && arcs === 2, 'closed polyline with one bulge = 2 lines + 1 arc, got ' + lines + ' lines / ' + arcs + ' arcs');
  const bulge = prims.filter(p => p.type === 'arc')[1];
  ok(bulge && Math.abs(bulge.r - 5) < 1e-9 && Math.abs(bulge.cx - 5) < 1e-9 && Math.abs(bulge.cy) < 1e-9,
    'bulge 1 on a 10mm chord is a half circle above the chord');
  const spl = prims.find(p => p.type === 'spline');
  ok(spl && spl.pts.length === 3 && !spl.closed, 'spline keeps its three fit points, open');

  const dxf2 = pairs(
    [0, 'SECTION'], [2, 'BLOCKS'],
    [0, 'BLOCK'], [2, 'B1'],
    [0, 'LINE'], [10, '0'], [20, '0'], [11, '1'], [21, '0'],
    [0, 'ENDBLK'],
    [0, 'ENDSEC'],
    [0, 'SECTION'], [2, 'ENTITIES'],
    [0, 'INSERT'], [2, 'B1'], [10, '100'], [20, '0'], [41, '2'], [42, '2'], [50, '90'],
    [0, 'ENDSEC'], [0, 'EOF']
  );
  const ins = C.parseDxf(dxf2);
  ok(ins.length === 1 && ins[0].type === 'line', 'block insert emits the block entities');
  ok(Math.abs(ins[0].x2 - 100) < 1e-9 && Math.abs(ins[0].y2 - 2) < 1e-9,
    'insert rotate 90 + scale 2 maps (1,0) to (100,2)');

  ok(C.parseDxf('AutoCAD Binary DXF').length === 0, 'binary DXF is rejected, not misread');
}

// --- PDF ---------------------------------------------------------------------
console.log('pdfContentPrims');
{
  // transform + stroke colour + straight path
  let p = C.pdfContentPrims('0.75 0 0 -0.75 0 841.92 cm\nq\n0 0 0 RG\n10 10 m\n20 10 l\nS\nQ\n');
  ok(p.length === 1 && p[0].nodes.length === 2, 'straight path becomes one two-node primitive');
  close(p[0].nodes[0].p[0], 7.5, 1e-9, 'cm transform applied (x)');
  close(p[0].nodes[0].p[1], 834.42, 1e-9, 'cm transform applied (y, flipped)');
  ok(p[0].color === '#000000', 'stroke colour captured');
  // cubic + close + fill colour
  p = C.pdfContentPrims('1 0 0 rg\n0 0 m\n0 10 10 10 10 0 c\nh\nf\n');
  ok(p.length === 1 && p[0].closed, 'closed filled curve detected');
  ok(p[0].color === '#ff0000', 'fill colour captured');
  ok(p[0].nodes[0].o && p[0].nodes[1].i, 'cubic controls land on the node handles');
  // v/y curve variants and re
  p = C.pdfContentPrims('0 0 m\n5 5 10 0 y\nS\n0 0 10 5 re\nS\n');
  ok(p.length === 2, 'y-curve and rectangle both emit');
  ok(p[1].closed && p[1].nodes.length === 4, 'rectangle is a closed four-node path');
  ok(p[0].nodes[1].i && p[0].nodes[1].i[0] === 10, 'y curve second control equals its endpoint');
  // text becomes note primitives (comments in the app)
  p = C.pdfContentPrims('BT\n/F1 12 Tf\n100 200 Td\n(Hello) Tj\n0 -14 TD\n[(Wor) -200 (ld)] TJ\nET\n');
  const notes = p.filter(x => x.kind === 'note');
  ok(notes.length === 2, 'two text notes extracted');
  ok(notes[0].text === 'Hello' && notes[0].x === 100 && notes[0].y === 209, 'Tj note keeps its text and position (top-left anchor)');
  ok(notes[1].text === 'World' && notes[1].y === 195, 'TJ array joins its strings and moves down');
  p = C.pdfContentPrims('BT 10 20 Td (a\\(b\\)\\n\\101) Tj ET');
  const n1 = p.find(x => x.kind === 'note');
  ok(n1 && n1.text === 'a(b)\nA', 'string escapes decode (parens, newline, octal)');
  // CAD writers put each glyph in its own BT/ET block: touching runs on one
  // baseline merge back into the label
  p = C.pdfContentPrims('BT /F1 12 Tf 100 200 Td (1) Tj ET BT /F1 12 Tf 107 200 Td (D) Tj ET');
  const merged = p.filter(x => x.kind === 'note');
  ok(merged.length === 1 && merged[0].text === '1D', 'split glyph runs merge into one label');
  // Type0 / Identity-H text: hex groups are 2-byte codes resolved by ToUnicode
  const cidMap = new Map([['\u027a', 'P'], ['\u0277', 'e']]);
  p = C.pdfContentPrims('BT /F1 12 Tf 10 20 Td <027a0277> Tj ET', cidMap);
  const cid = p.find(x => x.kind === 'note');
  ok(cid && cid.text === 'Pe', 'Identity-H hex codes decode through ToUnicode');
}

// --- CDR ---------------------------------------------------------------------
console.log('parseCdr');
{
  const fs = require('fs');
  const path = require('path');
  const cdrPath = path.join(__dirname, '..', 'testimport', 'test1.cdr');
  if (fs.existsSync(cdrPath)) {
    const bytes = new Uint8Array(fs.readFileSync(cdrPath));
    // parseCdr is async (zip inflate); run it in the async tail below
    global.__cdrBytes = bytes;
  } else {
    ok(true, 'no test1.cdr present \u2014 CDR checks skipped');
  }
}

(async () => {
  console.log('parsePdf (real files)');
  const fs = require('fs');
  const path = require('path');
  for (const name of ['test1.pdf', 'test2.pdf']) {
    try {
      const bytes = new Uint8Array(fs.readFileSync(path.join(__dirname, '..', 'testimport', name)));
      const prims = await C.parsePdf(bytes);
      ok(prims.length > 0, name + ' yields vector primitives (got ' + prims.length + ')');
      ok(prims.every(pr => pr.nodes.length >= 2), name + ' primitives carry nodes');
      ok(prims.every(pr => pr.nodes.every(nd => Number.isFinite(nd.p[0]) && Number.isFinite(nd.p[1]))),
        name + ' has only finite coordinates (no NaN from stray streams)');
    } catch (err) {
      ok(false, name + ' parses without throwing (' + err + ')');
    }
  }

  // multi-page PDFs lay out from each page's real bbox: page 2 starts
  // after page 1's real right edge + gap (not its nominal MediaBox width)
  {
    const pdfText = [
      '1 0 obj\n<< /Type /Page /MediaBox [0 0 100 50] /Contents 10 0 R >>\nendobj',
      '2 0 obj\n<< /Type /Page /MediaBox [0 0 200 50] /Contents 11 0 R >>\nendobj',
      '3 0 obj\n<< /Type /Page /MediaBox [0 0 100 50] /Contents 12 0 R >>\nendobj',
      '10 0 obj\n<< /Length 16 >>\nstream\n0 0 m 50 25 l S\nendstream\nendobj',
      // page 2 artwork bleeds past its box (to x=300): page 3 must start
      // after the bleed, not after the nominal box edge
      '11 0 obj\n<< /Length 18 >>\nstream\n0 0 m 300 25 l S\nendstream\nendobj',
      '12 0 obj\n<< /Length 16 >>\nstream\n0 0 m 40 25 l S\nendstream\nendobj'
    ].join('\n');
    const b = new Uint8Array(pdfText.length);
    for (let i = 0; i < pdfText.length; i++) b[i] = pdfText.charCodeAt(i) & 0xff;
    try {
      const all = await C.parsePdf(b);
      const prims = all.filter(p => p.kind !== 'note');
      ok(prims.length === 3, 'three pages give three paths (got ' + prims.length + ')');
      const xs = prims.map(pr => pr.nodes[pr.nodes.length - 1].p[0]);
      ok(xs[0] === 50, 'page 1 keeps its own coordinates');
      ok(Math.abs(xs[1] - (50 + 283.4646 + 300)) < 1e-6,
        'page 2 starts after page-1 right edge + gap (got ' + xs[1] + ')');
      ok(Math.abs(xs[2] - (50 + 283.4646 + 300 + 283.4646 + 40)) < 1e-6,
        'page 3 starts after the page-2 bleed, not the box edge (got ' + xs[2] + ')');
      const marks = all.filter(p => p.kind === 'note' && /^=== Page/.test(p.text));
      ok(marks.length === 3, 'multi-page PDF gets page marker comments (got ' + marks.length + ')');
    } catch (err) {
      ok(false, 'multi-page layout parses without throwing (' + err + ')');
    }
  }

  if (global.__cdrBytes) {
    try {
      const prims = await C.parseCdr(global.__cdrBytes);
      ok(prims.length > 0, 'test1.cdr yields vector primitives (got ' + prims.length + ')');
      ok(prims.every(pr => pr.nodes.every(nd => Number.isFinite(nd.p[0]) && Number.isFinite(nd.p[1]))),
        'test1.cdr coordinates are finite');
      let minX = 1e30, minY = 1e30, maxX = -1e30, maxY = -1e30;
      for (const pr of prims) for (const nd of pr.nodes) {
        minX = Math.min(minX, nd.p[0]); maxX = Math.max(maxX, nd.p[0]);
        minY = Math.min(minY, nd.p[1]); maxY = Math.max(maxY, nd.p[1]);
      }
      const w = maxX - minX, h = maxY - minY;
      ok(w > 10 && h > 10, 'test1.cdr has real mm size (got ' + w.toFixed(1) + ' x ' + h.toFixed(1) + ' mm)');
    } catch (err) {
      ok(false, 'test1.cdr parses without throwing (' + err + ')');
    }
  }

  // test3.cdr: legacy RIFF (X4 era) container with "cmpr" compressed subtrees
  const t3path = path.join(__dirname, '..', 'testimport', 'test3.cdr');
  if (fs.existsSync(t3path)) {
    try {
      const prims = await C.parseCdr(new Uint8Array(fs.readFileSync(t3path)));
      ok(prims.length > 0, 'test3.cdr (legacy cmpr container) yields primitives (got ' + prims.length + ')');
      ok(prims.every(pr => pr.nodes.every(nd => Number.isFinite(nd.p[0]) && Number.isFinite(nd.p[1]))),
        'test3.cdr coordinates are finite');
      let minX = 1e30, minY = 1e30, maxX = -1e30, maxY = -1e30;
      for (const pr of prims) for (const nd of pr.nodes) {
        minX = Math.min(minX, nd.p[0]); maxX = Math.max(maxX, nd.p[0]);
        minY = Math.min(minY, nd.p[1]); maxY = Math.max(maxY, nd.p[1]);
      }
      const w = maxX - minX, h = maxY - minY;
      ok(Math.abs(w - 2599.4) < 2 && Math.abs(h - 1283.8) < 4,
        'test3.cdr size matches the file bbox (got ' + w.toFixed(1) + ' x ' + h.toFixed(1) + ' mm)');
    } catch (err) {
      ok(false, 'test3.cdr parses without throwing (' + err + ')');
    }
  }

  // test4.cdr: X5+ rectangles store coordinates as float64 (readRectCoord) —
  // reading them as S32 made one rect 316 kilometres tall
  const t4path = path.join(__dirname, '..', 'testimport', 'test4.cdr');
  if (fs.existsSync(t4path)) {
    try {
      const prims = await C.parseCdr(new Uint8Array(fs.readFileSync(t4path)));
      ok(prims.length > 0, 'test4.cdr yields primitives (got ' + prims.length + ')');
      let minX = 1e30, minY = 1e30, maxX = -1e30, maxY = -1e30;
      for (const pr of prims) for (const nd of pr.nodes) {
        minX = Math.min(minX, nd.p[0]); maxX = Math.max(maxX, nd.p[0]);
        minY = Math.min(minY, nd.p[1]); maxY = Math.max(maxY, nd.p[1]);
      }
      const w = maxX - minX, h = maxY - minY;
      ok(h < 5000, 'test4.cdr height is sane (got ' + w.toFixed(1) + ' x ' + h.toFixed(1) + ' mm)');
    } catch (err) {
      ok(false, 'test4.cdr parses without throwing (' + err + ')');
    }
  }

  // test5.cdr: zip "CDRF" layout keeps the RIFF tree in content/riffData.cdr
  const t5path = path.join(__dirname, '..', 'testimport', 'test5.cdr');
  if (fs.existsSync(t5path)) {
    try {
      const prims = await C.parseCdr(new Uint8Array(fs.readFileSync(t5path)));
      ok(prims.length > 50, 'test5.cdr (riffData.cdr layout) yields primitives (got ' + prims.length + ')');
      ok(prims.every(pr => pr.nodes.every(nd => Number.isFinite(nd.p[0]) && Number.isFinite(nd.p[1]))),
        'test5.cdr coordinates are finite');
    } catch (err) {
      ok(false, 'test5.cdr parses without throwing (' + err + ')');
    }
  }

  // test6.cdr: five labelled rectangles — 43X5CM .. 24X5CM must read 430x50 ..
  // 240x50 mm (this pins the float64 rect coordinates for X5+ files)
  const t6path = path.join(__dirname, '..', 'testimport', 'test6.cdr');
  if (fs.existsSync(t6path)) {
    try {
      const prims = await C.parseCdr(new Uint8Array(fs.readFileSync(t6path)));
      ok(prims.length > 20, 'test6.cdr yields primitives (got ' + prims.length + ')');
      const rects = prims.map(pr => {
        let a = 1e30, b = 1e30, c = -1e30, d = -1e30;
        for (const nd of pr.nodes) {
          a = Math.min(a, nd.p[0]); c = Math.max(c, nd.p[0]);
          b = Math.min(b, nd.p[1]); d = Math.max(d, nd.p[1]);
        }
        return { w: c - a, h: d - b, n: pr.nodes.length };
      }).filter(r => r.n === 5 && Math.abs(r.h - 50) < 1);
      ok(rects.length === 5, 'test6.cdr has the five 50mm-tall panels (got ' + rects.length + ')');
      const widths = rects.map(r => Math.round(r.w)).sort((x, y) => x - y);
      ok(String(widths) === '240,280,360,400,430',
        'test6.cdr panel widths match the labels (got ' + widths.join(',') + ')');
    } catch (err) {
      ok(false, 'test6.cdr parses without throwing (' + err + ')');
    }
  }

  // ---------------------------------------------------------------------
  // Curve fitting (Ctrl+K): a polyline must survive as few cubics within the
  // tolerance, straight runs must stay straight, and a sharp corner must stay a
  // corner. Every case below pins a bug that was found while building it.
  console.log('\nfitPolylineCurve');
  {
    const circlePts = (r, n) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        const a = Math.PI * 2 * i / n;
        out.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
      }
      return out;
    };
    // deviation of the fitted curve from the true circle, sampled finely
    const radialError = (res, r) => {
      const cps = res.nodes.map(n => ({ x: n.x, y: n.y }));
      const hs = { o: res.nodes.map(n => n.o), i: res.nodes.map(n => n.i) };
      let worst = 0;
      for (const p of C.splineSamples(cps, hs, res.closed)) {
        worst = Math.max(worst, Math.abs(Math.hypot(p.x, p.y) - r));
      }
      return worst;
    };
    const fit = (pts, opts) => C.fitPolylineCurve(pts, opts);

    // a dense circle becomes a handful of nodes, inside the tolerance
    const dense = fit(circlePts(20, 200), { tol: 0.2, sharpAngle: 25, closed: true });
    ok(dense && dense.nodes.length >= 3 && dense.nodes.length <= 8,
      'dense circle fits in a few nodes (got ' + (dense ? dense.nodes.length : 'null') + ')');
    ok(dense && radialError(dense, 20) <= 0.2 + 1e-6,
      'the fitted circle stays inside the tolerance (dev ' + (dense ? radialError(dense, 20).toFixed(3) : '-') + ')');
    ok(dense && dense.corners.length === 0, 'a circle has no corners');

    // a tighter tolerance needs at least as many nodes, a looser one fewer
    const tight = fit(circlePts(20, 200), { tol: 0.02, sharpAngle: 25, closed: true });
    const loose = fit(circlePts(20, 200), { tol: 1.0, sharpAngle: 25, closed: true });
    ok(tight.nodes.length >= loose.nodes.length,
      'a tighter tolerance never uses fewer nodes (' + tight.nodes.length + ' vs ' + loose.nodes.length + ')');
    ok(radialError(tight, 20) <= 0.02 + 1e-6,
      'the tight fit honours its own tolerance (dev ' + radialError(tight, 20).toFixed(4) + ')');

    // straight edges stay straight: no handles at all, so the renderer draws chords
    const rect = fit([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }],
      { tol: 0.2, sharpAngle: 25, closed: true });
    ok(rect.nodes.length === 4, 'a rectangle stays 4 nodes (got ' + rect.nodes.length + ')');
    ok(rect.nodes.every(n => !n.o && !n.i), 'a rectangle keeps no handles (no rounding)');
    ok(rect.corners.length === 4, 'all four corners are marked sharp');

    // the same rectangle, subdivided along every edge (a traced outline)
    const denseRect = [];
    const edge = (ax, ay, bx, by, n) => {
      for (let i = 0; i < n; i++) denseRect.push({ x: ax + (bx - ax) * i / n, y: ay + (by - ay) * i / n });
    };
    edge(0, 0, 100, 0, 10); edge(100, 0, 100, 60, 6);
    edge(100, 60, 0, 60, 10); edge(0, 60, 0, 0, 6);
    const dr = fit(denseRect, { tol: 0.2, sharpAngle: 25, closed: true });
    ok(dr.nodes.length === 4, 'a densely traced rectangle also collapses to 4 nodes (got ' + dr.nodes.length + ')');
    ok(dr.nodes.every(n => !n.o && !n.i), 'and stays perfectly straight');

    // a STAIRCASE trace (the real output of the raster tracer: every boundary
    // point on the 0.5 px grid) used to come back wavy: the turn detector saw
    // a 45-90° flip at every step and marked ~every vertex a corner, and the
    // smoothing backed off because its displacement budget was the FIT
    // tolerance, tighter than the noise it was removing. A staircase circle
    // must still fit as a circle, a staircase rectangle keep its corners.
    const stair = (cx, cy, r, n) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        const a = Math.PI * 2 * i / n;
        out.push({ x: Math.round((cx + r * Math.cos(a)) * 2) / 2, y: Math.round((cy + r * Math.sin(a)) * 2) / 2 });
      }
      return out;
    };
    const sc = fit(stair(60, 60, 11, 140), { tol: 0.2, sharpAngle: 25, closed: true, denoise: true });
    ok(sc && sc.nodes.length <= 8, 'a staircase circle fits in a few nodes (got ' + (sc ? sc.nodes.length : 'null') + ')');
    ok(sc && sc.corners.length === 0, 'a staircase circle has no corners (got ' + (sc ? sc.corners.length : '-') + ')');
    const sq2 = [];
    for (let i = 0; i < 25; i++) sq2.push({ x: i, y: 0 });
    for (let i = 0; i < 25; i++) sq2.push({ x: 25, y: i });
    for (let i = 0; i < 25; i++) sq2.push({ x: 25 - i, y: 25 });
    for (let i = 0; i < 25; i++) sq2.push({ x: 0, y: 25 - i });
    const ss = fit(sq2, { tol: 0.2, sharpAngle: 25, closed: true, denoise: true });
    ok(ss && ss.corners.length === 4, 'a staircase rectangle keeps exactly 4 corners (got ' + (ss ? ss.corners.length : '-') + ')');
    // denoise never fires on a sparse polyline even when requested: a 4-point
    // rectangle has no noise, and a quarter-shape window would round it away
    const sparse = fit([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 30 }, { x: 0, y: 30 }],
      { tol: 0.2, sharpAngle: 25, closed: true, denoise: true });
    ok(sparse && sparse.nodes.length === 4 && sparse.corners.length === 4,
      'denoise on a sparse rectangle changes nothing (got ' + (sparse ? sparse.nodes.length + '/' + sparse.corners.length : 'null') + ')');

    // corner threshold: 0 keeps every vertex, 180 rounds everything
    const arcPts = [];
    for (let i = 0; i <= 20; i++) {
      const a = Math.PI * i / 20;
      arcPts.push({ x: 50 * Math.cos(a), y: 50 * Math.sin(a) });
    }
    const allSharp = fit(arcPts, { tol: 0.2, sharpAngle: 0, closed: false });
    ok(allSharp.nodes.length === arcPts.length, 'sharpAngle 0 keeps every vertex');
    ok(allSharp.nodes.every(n => !n.o && !n.i), 'sharpAngle 0 produces no handles');
    const allRound = fit(arcPts, { tol: 0.2, sharpAngle: 180, closed: false });
    ok(allRound.corners.length === 0, 'sharpAngle 180 rounds every vertex');
    ok(allRound.nodes.length < arcPts.length, 'sharpAngle 180 really fits (fewer nodes)');

    // a sharp corner in the middle of a smooth run survives at its exact position
    const notch = [];
    for (let i = 0; i <= 24; i++) {
      const a = -Math.PI / 2 + Math.PI * i / 24;
      notch.push({ x: 40 * Math.cos(a), y: 40 * Math.sin(a) });
    }
    notch.push({ x: 0, y: -40 });            // the pointy bit
    for (let i = 0; i <= 24; i++) {
      const a = Math.PI / 2 + Math.PI * i / 24;
      notch.push({ x: 40 * Math.cos(a), y: 40 * Math.sin(a) });
    }
    const nf = fit(notch, { tol: 0.2, sharpAngle: 25, closed: true });
    const hasTip = nf.nodes.some(n => Math.hypot(n.x - 0, n.y + 40) < 1e-9);
    ok(hasTip, 'the sharp tip is kept as a node at its exact position');
    const tipIdx = nf.nodes.findIndex(n => Math.hypot(n.x, n.y + 40) < 1e-9);
    ok(tipIdx >= 0 && nf.corners.indexOf(tipIdx) >= 0, 'and it is marked as a corner');

    // the fit never runs away: handles stay near the chord
    for (const n of (dense.nodes || [])) {
      if (!n.o) continue;
    }
    let overshoot = 0;
    for (let i = 0; i < dense.nodes.length; i++) {
      const a = dense.nodes[i];
      const b = dense.nodes[(i + 1) % dense.nodes.length];
      if (!a.o || !b.i) continue;
      const chord = Math.hypot(b.x - a.x, b.y - a.y);
      const h1 = Math.hypot(a.o.x - a.x, a.o.y - a.y);
      const h2 = Math.hypot(b.i.x - b.x, b.i.y - b.y);
      overshoot = Math.max(overshoot, h1 / chord, h2 / chord);
    }
    ok(overshoot < 1.05, 'no handle is absurdly long compared to its chord (' + overshoot.toFixed(2) + ')');

    // garbage in, nothing out
    ok(fit([{ x: 0, y: 0 }], {}) === null, 'a single point yields null');
    ok(fit([], {}) === null, 'an empty list yields null');
    ok(fit([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }], {}) === null,
      'duplicate points collapse and yield null');
    const dup = fit([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }],
      { tol: 0.2, sharpAngle: 25, closed: false });
    ok(dup && dup.nodes.length === 2, 'duplicates are dropped, a straight line stays 2 nodes (got ' +
      (dup ? dup.nodes.length : 'null') + ')');
  }

  // Straight stretches INSIDE a run must come out exactly straight. A run that
  // is "arc, 21 mm straight, arc" used to be fitted as one curve problem and the
  // least squares bowed the straight part by up to the tolerance — visibly
  // "mleyot" on screen. Two bugs were found building this: the first detector
  // had no scale awareness (a 3 mm piece of a dense arc is within tolerance of
  // its chord too, so the whole curve was chopped into handle-less nodes), and
  // the second under-reported the turn by comparing two short chord directions.
  console.log('\nfitPolylineCurve: straight runs inside a curve');
  {
    // arc, vertical straight of 21 mm, arc — the shape from the report
    const mixed = (R, straight = 21, arcPts = 24) => {
      const pts = [];
      for (let i = 0; i <= arcPts; i++) {
        const a = Math.PI * 0.75 - Math.PI * 0.25 * i / arcPts;
        pts.push({ x: R * Math.cos(a), y: R * Math.sin(a) });
      }
      const top = pts[pts.length - 1];
      const seg = Math.max(2, Math.round(straight));
      for (let i = 1; i <= seg; i++) pts.push({ x: top.x, y: top.y - straight * i / seg });
      const bottom = pts[pts.length - 1];
      for (let i = 1; i <= arcPts; i++) {
        const a = Math.PI - Math.PI * 0.25 * i / arcPts;
        pts.push({ x: R + R * Math.cos(a), y: bottom.y + R * Math.sin(a) });
      }
      return pts;
    };
    const cubicsOf = (res) => C.splineCubics(
      res.nodes.map(n => ({ x: n.x, y: n.y })),
      { o: res.nodes.map(n => n.o), i: res.nodes.map(n => n.i) },
      res.closed);
    // the vertical piece: both ends share x
    const vertical = (res) => {
      for (const c of cubicsOf(res)) {
        if (Math.abs(c.P0.x - c.P3.x) > 1e-9) continue;
        if (Math.abs(c.P0.y - c.P3.y) < 10) continue;
        let bow = 0;
        for (let k = 0; k <= 200; k++) {
          const p = C.cubicAt(c.P0, c.P1, c.P2, c.P3, k / 200);
          bow = Math.max(bow, Math.abs(p.x - c.P0.x));
        }
        return { len: Math.hypot(c.P3.x - c.P0.x, c.P3.y - c.P0.y), bow };
      }
      return null;
    };

    for (const R of [30, 60, 120, 300]) {
      for (const tol of [0.1, 0.2, 0.5]) {
        const res = C.fitPolylineCurve(mixed(R), { tol, sharpAngle: 25, closed: false });
        const v = vertical(res);
        ok(!!v, 'R=' + R + ' tol=' + tol + ': the straight edge survives as one segment');
        ok(v && Math.abs(v.len - 21) < 1e-6, 'R=' + R + ' tol=' + tol + ': it is still 21.000 mm (' +
          (v ? v.len.toFixed(3) : '-') + ')');
        ok(v && v.bow < 1e-9, 'R=' + R + ' tol=' + tol + ': and it is dead straight (bow ' +
          (v ? v.bow.toExponential(1) : '-') + ')');
        // the arcs either side must stay curves, not be chopped into chords
        const curved = res.nodes.filter(n => n.o || n.i).length;
        ok(curved >= 2, 'R=' + R + ' tol=' + tol + ': the arcs still carry handles (' + curved + ' nodes)');
        // straight-node count stays small for a gentle arc: no false positives
        ok(res.nodes.length <= 12, 'R=' + R + ' tol=' + tol + ': node count stays sane (' + res.nodes.length + ')');
      }
    }

    // a run that is entirely a gentle arc must keep its handles: no straight
    // pieces may be invented along it
    for (const R of [60, 200, 600]) {
      const arc = [];
      for (let i = 0; i <= 40; i++) {
        const a = Math.PI * i / 40;
        arc.push({ x: R * Math.cos(a), y: R * Math.sin(a) });
      }
      const res = C.fitPolylineCurve(arc, { tol: 0.2, sharpAngle: 180, closed: false });
      const handles = res.nodes.filter(n => n.o || n.i).length;
      ok(handles === res.nodes.length, 'R=' + R + ': a pure arc keeps a handle on every node (' +
        handles + '/' + res.nodes.length + ')');
      ok(res.nodes.length <= 8, 'R=' + R + ': and stays a handful of nodes (' + res.nodes.length + ')');
    }

    // a straight edge between two sharp corners is still just a chord
    const rect = C.fitPolylineCurve([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }],
      { tol: 0.2, sharpAngle: 25, closed: true });
    ok(rect.nodes.length === 4 && rect.nodes.every(n => !n.o && !n.i),
      'a rectangle stays four bare corners');

    // mixed run plus a sharp corner: the corner still splits the fit
    const withCorner = mixed(60).concat([{ x: -60, y: 40 }]);
    const wc = C.fitPolylineCurve(withCorner, { tol: 0.2, sharpAngle: 25, closed: false });
    ok(wc.corners.length >= 1, 'a sharp corner after the mixed run is still detected');
  }

  console.log(failures ? '\n' + failures + ' FAILURES' : '\nall smoke tests passed');
  process.exit(failures ? 1 : 0);
})();
