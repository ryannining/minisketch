// Probe: double-click insert-point on a spline (insertPointOnEntity in app.js)
// must add a node that lies exactly on the curve while keeping every other
// segment bit-identical (no autoHandles regeneration = no "drastic" re-shape).
// Regression guard for the reported bug "dobel klik di garis curve menambah
// titik tapi kontrol handle titik lain berubah drastis".
//
// Run: node testing/spline_insert_app_probe.js
const fs = require('fs');
const path = require('path');
const Core = require('../core.js');
const { cubicAt, autoHandles, splineFrame, splitCubic } = Core;

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
function sliceApp(name) {
  const start = appSrc.indexOf('function ' + name + '(');
  if (start < 0) return null;
  let i = appSrc.indexOf('(', start), depth = 0;
  for (; i < appSrc.length; i++) {
    if (appSrc[i] === '(') depth++;
    else if (appSrc[i] === ')') { depth--; if (!depth) break; }
  }
  return appSrc.slice(start, braceEnd(appSrc, i));
}

function fixture(cps, closed, hs, manualSplit) {
  const pts = {};
  const ids = [];
  let id = 100;
  for (const p of cps) {
    pts[id] = { id, x: p.x, y: p.y };
    ids.push(id);
    id++;
  }
  if (manualSplit) {
    // leave the first node sharp (null handles) to mirror hand-drawn curves
    hs = { o: hs.o.slice(), i: hs.i.slice() };
    hs.o[0] = null;
    hs.i[0] = null;
  }
  return {
    points: pts,
    entities: {
      700: { id: 700, type: 'spline', pts: ids, closed, hs, color: '#000000' }
    },
    constraints: {},
    layers: [{ id: 1, name: 'Layer 1', visible: true }],
    nextId: 1000
  };
}

const PARAMS = ['state', 'ui', 'pushHistory', 'commit', 'toast', 'solveNow', 'invalidateLoops', 'cleanupPoints'];
let prelude = `
var SPLINE_SEG = 12; var ARC_SEG = 72;
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function entityPointIds(e) { return Array.isArray(e.pts) ? e.pts.slice() : []; }
function P(id) { return state.points[id]; }
function newId() { return state.nextId++; }
function __privOrig(x, y) { const id = newId(); state.points[id] = { id, x, y }; return id; }
function privatePoint() { return __privOrig.apply(null, arguments); }
function pointAtWorld(x, y, color) { return privatePoint(x, y); }
function colorOf(e) { return e.color || '#000000'; }
`;

function makeInsert(targetState) {
  const values = [targetState, { selection: [] }, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}];
  return new Function(...PARAMS, prelude + sliceApp('insertPointOnEntity') + '\n return insertPointOnEntity;')(...values);
}

function build() {
  prelude += Core.splitCubic.toString() + '\n';
  prelude += Core.cubicAt.toString() + '\n';
  prelude += Core.autoHandles.toString() + '\n';
  prelude += Core.splineSamples.toString() + '\n';
  prelude += Core.splineFrame.toString() + '\n';
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const st = fixture([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }], false,
        autoHandles([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }], false));
      const trial = makeInsert(st);
      trial(700, { x: 25, y: 0 }, {});
      return makeInsert;
    } catch (e) {
      const m = /^(\w+) is not defined$/.exec(e.message);
      if (!m) throw e;
      const src = sliceApp(m[1]);
      if (src) { prelude += src + '\n'; continue; }
      if (m[1] === 'TAU') { prelude += 'var TAU = Math.PI * 2;\n'; continue; }
      throw new Error('cannot resolve ' + m[1]);
    }
  }
  throw new Error('could not build insertPointOnEntity');
}

const samePt = (a, b) => Math.abs(a.x - b.x) <= 1e-9 && Math.abs(a.y - b.y) <= 1e-9;
function quadArr(cps, hs, loop) {
  const n = cps.length;
  const nsegs = loop ? n : n - 1;
  const out = [];
  for (let s = 0; s < nsegs; s++) {
    const j = loop ? (s + 1) % n : s + 1;
    out.push([cps[s], hs.o[s] || cps[s], hs.i[j] || cps[j], cps[j]]);
  }
  return out;
}
function sameQuad(a, b) {
  for (let i = 0; i < 4; i++) if (!samePt(a[i], b[i])) return false;
  return true;
}
function polyline(quads, per) {
  const out = [];
  for (const [A, B, C, D] of quads) {
    for (let i = 0; i <= per; i++) out.push(cubicAt(A, B, C, D, i / per));
  }
  return out;
}
function maxMinDist(A, B) {
  let worst = 0;
  for (const p of A) {
    let best = Infinity;
    for (const q of B) best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y));
    if (best > worst) worst = best;
  }
  return worst;
}

// The real edit: click mid-span, run the app function, then assert the curve
// is still the same set of points (dense bi-directional nearest distance) and
// that the pts/hs arrays stay consistent (the invariant whose violation would
// silently re-fit ALL handles = the drastic re-shape).
function runOne(closed, manualSplit) {
  const cps = [];
  const n = 5;
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2 + 0.3;
    cps.push({ x: Math.cos(a) * 120 + 40, y: Math.sin(a) * 120 + 30 });
  }
  let hs = autoHandles(cps, closed);
  // sprinkle manual asymmetry (like a user-tweaked curve)
  for (let i = 0; i < n; i++) {
    if (i % 3 === 0) { hs.o[i] = { x: hs.o[i].x + 12, y: hs.o[i].y + 6 }; hs.i[i] = { x: hs.i[i].x - 12, y: hs.i[i].y - 6 }; }
  }
  const state = fixture(cps, closed, hs, manualSplit);
  const e = state.entities[700];
  const hs0 = e.hs;                 // the entity's own handles (post-sharp-start)
  const frame = splineFrame(cps, hs0, closed);
  const nsegs = closed ? n : n - 1;
  const seg = closed ? 2 : 2;      // a middle span
  const u = 0.45;
  const j = closed ? (seg + 1) % n : seg + 1;
  const q = cubicAt(cps[seg], hs0.o[seg] || cps[seg], hs0.i[j] || cps[j], cps[j], u);
  const ins = makeInsert(state);
  ins(700, { x: q.x, y: q.y }, {});
  const afterCps = e.pts.map(pid => state.points[pid]).filter(Boolean);
  const tag = (closed ? 'closed' : 'open') + (manualSplit ? '/sharp-start' : '');

  check('[' + tag + '] a point was inserted', afterCps.length === n + 1, afterCps.length + ' vs ' + (n + 1));
  check('[' + tag + '] pts/hs lengths stay consistent',
    e.pts.length === e.hs.o.length && e.hs.o.length === e.hs.i.length,
    e.pts.length + ' / ' + e.hs.o.length + ' / ' + e.hs.i.length);

  const BQ = quadArr(cps, hs0, closed);
  const AQ = quadArr(afterCps, e.hs, closed);
  // every before span, except the split one, must appear verbatim in after
  let splitB = -1, splitA = -1;
  const used = new Array(AQ.length).fill(false);
  for (let s = 0; s < BQ.length; s++) {
    let found = -1;
    for (let sp = 0; sp < AQ.length; sp++) {
      if (!used[sp] && sameQuad(BQ[s], AQ[sp])) { found = sp; break; }
    }
    if (found >= 0) { used[found] = true; continue; }
    splitB = s;
  }
  const leftover = [];
  for (let sp = 0; sp < AQ.length; sp++) if (!used[sp]) leftover.push(sp);
  check('[' + tag + '] exactly one span split into a halves', splitB >= 0 && leftover.length === 2,
    'splitB=' + splitB + ' leftover=' + JSON.stringify(leftover));
  if (splitB < 0 || leftover.length !== 2) {
    const dbg = [];
    for (let s = 0; s < BQ.length; s++) {
      let f = -1;
      for (let sp = 0; sp < AQ.length; sp++) if (sameQuad(BQ[s], AQ[sp])) { f = sp; break; }
      dbg.push('BQ[' + s + ']->AQ[' + f + ']');
    }
    console.log('    matchmap: ' + dbg.join(' '));
    if (BQ[0]) {
      const a0 = AQ[0], b0 = BQ[0];
      if (a0 && b0) for (let k = 0; k < 4; k++) {
        console.log('    BQ[0][' + k + ']=' + JSON.stringify(b0[k]) + ' AQ[0][' + k + ']=' + JSON.stringify(a0[k]) + ' d=' + Math.hypot(b0[k].x - a0[k].x, b0[k].y - a0[k].y));
      }
    }
    console.log('    afterCps=' + JSON.stringify(afterCps));
    console.log('    afterHS.o=' + JSON.stringify(e.hs.o));
    console.log('    afterHS.i=' + JSON.stringify(e.hs.i));
  }
  if (splitB >= 0 && leftover.length === 2) {
    const L = AQ[leftover[0]], R = AQ[leftover[1]];
    const P = BQ[splitB][0], Q = BQ[splitB][3];
    const endsOk = (samePt(L[0], P) && samePt(L[3], R[0]) && samePt(R[3], Q)) ||
      (samePt(R[0], P) && samePt(R[3], L[0]) && samePt(L[3], Q));
    check('[' + tag + '] split halves share the original span endpoints', endsOk);
    // dense bi-directional outline comparison (user-visible shape)
    const A = polyline(BQ, 300);
    const B = polyline(AQ, 300);
    const scale = Math.max(1, ...cps.map(p => Math.hypot(p.x, p.y)));
    const d = Math.max(maxMinDist(A, B), maxMinDist(B, A));
    check('[' + tag + '] outline preserved (max nearest-dist=' + d.toFixed(4) + ', scale=' + scale.toFixed(0) + ')',
      d < 0.02 * scale, 'd=' + d.toFixed(4));
  } else {
    splitA = leftover[0];
  }
}

const insert = build();

// Shift+double-click on a spline is treated the same as a plain double click:
// there is no point-on-spline solver relation, so a fake "On" point would be
// disconnected and swept. It must insert a real node on the curve.
{
  const cps = [{ x: 0, y: 0 }, { x: 80, y: 10 }, { x: 160, y: 90 }, { x: 60, y: 120 }];
  const state = fixture(cps, false, autoHandles(cps, false), false);
  const e = state.entities[700];
  const before = e.pts.slice();
  const ins = makeInsert(state);
  ins(700, { x: 40, y: 5 }, { addOnly: true });
  check('[shift-addOnly] inserts a real node like a plain double click',
    e.pts.length === before.length + 1, e.pts.length + ' vs ' + (before.length + 1));
  const ptOn = Object.values(state.constraints).filter(c => c.type === 'pointOn');
  check('[shift-addOnly] no fake pointOn constraint is created', ptOn.length === 0, JSON.stringify(ptOn));
}
runOne(false, false);
runOne(true, false);
runOne(false, true);
runOne(true, true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
