// Probe for the image re-trace frame (double-click a placed picture -> Trace):
//   1. The traced object's frame must be the picture's frame, and the solver
//      must NOT move it: the aspect constraint insertArt installs carries the
//      frame's OWN side ratio, so perpendicular + aspect are satisfied exactly
//      by the copied frame (zero residual -> no solver drift -> no skew).
//   2. The contours are normalised in BITMAP space (pt/iw, pt/ih), the same
//      mapping drawImageBitmap uses for the picture itself, so a traced point
//      lands exactly where its pixel sits in the picture — margins kept. The
//      old bounding-box normalisation stretched the artwork across the whole
//      frame and fed the solver a bbox ratio the frame could not satisfy: the
//      unanchored frame then slid/turned and the trace came out skewed.
//
// Run: node testing/retrace_frame_probe.js
'use strict';
const fs = require('fs');
const path = require('path');
const C = require(path.join(__dirname, '..', 'core.js'));

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

// ---- a solver harness: the real solveSketch, minimal surroundings ----------
function makeWorld() {
  return {
    points: {}, entities: {}, constraints: {},
    layers: [{ id: 1, visible: true, locked: false }],
    nextId: 1
  };
}
function pt(w, x, y) {
  const id = w.nextId++;
  w.points[id] = { id, x, y };
  return id;
}
function line(w, a, b) {
  const id = w.nextId++;
  w.entities[id] = { id, type: 'line', a, b, color: '#00ff00', layer: 1 };
  return id;
}

function buildSolver(w) {
  return new Function(
    'state', 'ui', 'P', 'dist', 'clamp', 'TAU', 'wrapPi', 'norm2pi',
    'lmSolve', 'textDimCount', 'RADIUS_SOLVE_LIMIT',
    slice('solveSketch') + '\nreturn solveSketch;'
  )(
    w, { solverCost: 0 }, (id) => w.points[id],
    (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
    (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
    Math.PI * 2,
    (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a <= -Math.PI) a += Math.PI * 2; return a; },
    (a) => { while (a < 0) a += Math.PI * 2; while (a >= Math.PI * 2) a -= Math.PI * 2; return a; },
    C.lmSolve,
    () => 0,       // textDimCount: no driven dimensions on the frame guides
    2              // RADIUS_SOLVE_LIMIT
  );
}

// A placed picture, rotated, the way addImageEntity + a rotate gesture leave
// it: three frame points, two green guides, perpendicular between them.
// The bitmap is 400x200 px shown 100x50 mm; the frame is turned by theta.
function placePicture(w, theta) {
  const iw = 400, ih = 200;
  const worldW = 100, worldH = 50;
  const p0 = pt(w, 40, 40);
  const ux = Math.cos(theta), uy = Math.sin(theta);
  const pw = pt(w, 40 + ux * worldW, 40 + uy * worldW);
  const ph = pt(w, 40 - uy * worldH, 40 + ux * worldH);
  const gW = line(w, p0, pw);
  const gH = line(w, p0, ph);
  w.constraints[w.nextId] = { id: w.nextId++, type: 'perpendicular', line1: gW, line2: gH };
  return { iw, ih, p0, pw, ph, gW, gH };
}

// What insertArt builds for a re-trace. `ratio` and the contour normalisation
// are the two knobs the fix changed; both callers below pass their variant.
function buildRetracedArt(w, pic, opts) {
  const o = opts || {};
  const q0 = w.points[pic.p0], qw = w.points[pic.pw], qh = w.points[pic.ph];
  const n0 = pt(w, q0.x, q0.y);
  const nw = pt(w, qw.x, qw.y);
  const nh = pt(w, qh.x, qh.y);
  const sideW = Math.hypot(qw.x - q0.x, qw.y - q0.y);
  const sideH = Math.hypot(qh.x - q0.x, qh.y - q0.y);
  const gW = line(w, n0, nw);
  const gH = line(w, n0, nh);
  w.constraints[w.nextId] = { id: w.nextId++, type: 'perpendicular', line1: gW, line2: gH };
  const ratio = o.ratio !== undefined ? o.ratio : (sideW / sideH);
  w.constraints[w.nextId] = {
    id: w.nextId++, type: 'aspect', entity: 0,
    p0: n0, pw: nw, ph: nh, ratio
  };
  return { n0, nw, nh, ratio };
}

const frameMoved = (w, pic, art) => {
  let m = 0;
  m = Math.max(m, Math.hypot(w.points[art.n0].x - w.points[pic.p0].x, w.points[art.n0].y - w.points[pic.p0].y));
  m = Math.max(m, Math.hypot(w.points[art.nw].x - w.points[pic.pw].x, w.points[art.nw].y - w.points[pic.pw].y));
  m = Math.max(m, Math.hypot(w.points[art.nh].x - w.points[pic.ph].x, w.points[art.nh].y - w.points[pic.ph].y));
  return m;
};

const THETA = Math.PI / 6;   // the picture sits rotated 30 deg

console.log('\n== re-trace: the copied frame does not move when the solver runs ==');
{
  const w = makeWorld();
  const pic = placePicture(w, THETA);
  // The artwork does NOT fill the bitmap (margins): its traced bbox is
  // 300x140 px inside the 400x200 bitmap — the usual real-world case.
  const bboxW = 300, bboxH = 140;
  const art = buildRetracedArt(w, pic);           // ratio = the frame's own
  const solve = buildSolver(w);
  const res = solve({ maxIter: 60 });
  const moved = frameMoved(w, pic, art);
  check('the frame stayed on the picture (no solver drift)', moved < 1e-6, moved);
  check('the solve is already satisfied (cost ~ 0)', res.cost < 1e-6, res.cost);
  check('the aspect ratio is the frame ratio, not the bbox ratio',
    Math.abs(art.ratio - 2) < 1e-9 && Math.abs(art.ratio - bboxW / bboxH) > 1e-3, art.ratio);
}

console.log('\n== the old bbox ratio DID drag the frame (the skew this fixes) ==');
{
  const w = makeWorld();
  const pic = placePicture(w, THETA);
  const before = frameMoved(w, pic, { n0: pic.p0, nw: pic.pw, nh: pic.ph });
  // ratio the old code stored: traced-bbox 300x140 -> 2.1428, frame is 2.0
  const art = buildRetracedArt(w, pic, { ratio: 300 / 140 });
  const solve = buildSolver(w);
  solve({ maxIter: 60 });
  const moved = frameMoved(w, pic, art) - before;
  check('a bbox ratio on the copied frame makes the solver move it', moved > 0.5, moved);
}

console.log('\n== traced points land where their pixels sit in the picture ==');
{
  const w = makeWorld();
  const pic = placePicture(w, THETA);
  const q0 = w.points[pic.p0], qw = w.points[pic.pw], qh = w.points[pic.ph];
  const A = { x: qw.x - q0.x, y: qw.y - q0.y };
  const B = { x: qh.x - q0.x, y: qh.y - q0.y };
  const mapPt = (u, v) => ({
    x: q0.x + u * A.x + v * B.x,
    y: q0.y + u * A.y + v * B.y
  });
  // a traced vertex at pixel (310, 55) of the 400x200 bitmap, normalised the
  // new way; the picture renders that pixel through the SAME mapping
  const u = 310 / 400, v = 55 / 200;
  const traced = mapPt(u, v);
  const picture = mapPt(310 / pic.iw, 55 / pic.ih);
  check('bitmap-normalised contour renders onto its own pixel',
    Math.hypot(traced.x - picture.x, traced.y - picture.y) < 1e-9);
  // the old way: bbox (50..350, 30..170) normalised, then stretched across the
  // whole frame — the same pixel landed somewhere else entirely
  const oldU = (310 - 50) / 300, oldV = (55 - 30) / 140;
  const old = mapPt(oldU, oldV);
  check('bbox-normalised contour lands off the pixel (the old behaviour)',
    Math.hypot(old.x - picture.x, old.y - picture.y) > 5);
}

console.log('\n== insertArt pins the re-trace construction (static) ==');
{
  const fn = slice('insertArt');
  check('re-trace normalises contours by the bitmap size',
    /pt\[0\] \/ srcMapW/.test(fn) && /pt\[1\] \/ srcMapH/.test(fn));
  check('the aspect ratio is the copied frame side ratio on a re-trace',
    /ratio: isRetrace \? frameRatio : srcW \/ srcH/.test(fn));
  check('the frame ratio is measured from the copied points',
    /frameRatio = sideW \/ sideH/.test(fn));
  check('fresh pastes keep the bounding-box normalisation',
    /\[\(pt\[0\] - minX\) \/ srcW, \(pt\[1\] - minY\) \/ srcH\]/.test(fn));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
