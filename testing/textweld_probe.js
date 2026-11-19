// Probe for Text weld (tools/textweld.js): the exact-weld orchestration and the
// asymmetric outward-probe marking, sliced out and run without a DOM. The
// boolean in the weldExact test is a shim-backed fake api (simple rings); the
// real exact engine is verified separately against the app. Geometry helpers
// are the real core.js exports, injected into the slices.
//
// Run: node testing/textweld_probe.js
const fs = require('fs');
const path = require('path');
const core = require(path.join(__dirname, '..', 'core.js'));
const shim = require(path.join(__dirname, 'polybool_shim.js'));

const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'textweld.js'), 'utf8');
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
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('not found: ' + name);
  let i = src.indexOf('(', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') { depth--; if (!depth) break; }
  }
  return src.slice(start, braceEnd(src, i));
};

const names = ['cleanRing', 'ringDepths', 'ringsBBox', 'sampleLoop', 'nodeKey',
  'markingRuns', 'weldExact', 'planWeld', 'loopNodes', 'readObjects'];
const consts = 'const KEY_EPS = 1e-4;\n';
const T = new Function('interiorProbe', 'pointInPoly', 'polyBBox', 'signedAreaPts', 'splineSamples',
  consts + names.map(slice).join('\n') + '\nreturn {' + names.join(',') + '};')(
  core.interiorProbe, core.pointInPoly, core.polyBBox, core.signedAreaPts, core.splineSamples);

const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const obj = (outer) => ({ loop: { poly: outer }, outer, src: {} });

// fake exact api: rings in, curve loops out (corner nodes), via the real shim
const fakeApi = {
  boolLoopsExact(op, subj, clip) {
    const rings = (ls) => (ls || []).map(l => l.poly);
    let out;
    if (op === 'union') out = shim.polyBoolOp('union', rings(subj), []);
    else out = shim.polyBoolOp('intersection', rings(subj), rings(clip));
    return (out || []).map(r => ({ nodes: r.map(p => ({ x: p.x, y: p.y, o: null, i: null })), closed: true }));
  }
};

// ---- sampleLoop ---------------------------------------------------------
console.log('\n== sampleLoop follows the curve ==');
{
  const nodes = [];
  for (let k = 0; k < 8; k++) { const t = k / 8 * 2 * Math.PI; nodes.push({ x: 50 * Math.cos(t), y: 50 * Math.sin(t), o: null, i: null }); }
  const ring = T.sampleLoop({ nodes, closed: true });
  const bb = core.polyBBox(ring);
  check('sampled circle spans ~±50', Math.abs(bb.maxX - 50) < 1 && Math.abs(bb.minX + 50) < 1, JSON.stringify(bb));
}

// ---- flip-flop marking on exact curve loops (point coincidence) ----------
console.log('\n== markingRuns: flip-flop walk, side chosen by start ==');
{
  // diamond lens: T1,T2 are tips (on union A); O1 is the right-side arc node,
  // L1 the left-side arc node. Default starts leftmost (L1) -> keeps L1 arc.
  const T1 = { x: 0, y: 0, o: null, i: null }, O1 = { x: 1, y: 2, o: null, i: null };
  const T2 = { x: 0, y: 4, o: null, i: null }, L1 = { x: -1, y: 2, o: null, i: null };
  const lens = { nodes: [T1, O1, T2, L1], closed: true };
  const aKeys = new Set([T.nodeKey(T1, 1e-4), T.nodeKey(T2, 1e-4)]);
  const left = T.markingRuns([lens], aKeys, 1e-4, false);
  check('default keeps the leftmost arc (L1)', left.some(r => r.includes(L1)) && !left.some(r => r.includes(O1)));
  const right = T.markingRuns([lens], aKeys, 1e-4, true);
  check('fromRight keeps the rightmost arc (O1)', right.some(r => r.includes(O1)) && !right.some(r => r.includes(L1)));
  check('kept arc spans tip to tip', left.every(r => r.includes(T1) && r.includes(T2)));
}
{
  // a curved kept arc preserves its handles
  const T1 = { x: 0, y: 0, o: null, i: null };
  const O1 = { x: 1, y: 2, o: { x: 1.5, y: 1 }, i: { x: 1.5, y: 3 } };
  const T2 = { x: 0, y: 4, o: null, i: null }, L1 = { x: -1, y: 2, o: null, i: null };
  const lens = { nodes: [T1, O1, T2, L1], closed: true };
  const aKeys = new Set([T.nodeKey(T1, 1e-4), T.nodeKey(T2, 1e-4)]);
  const runs = T.markingRuns([lens], aKeys, 1e-4, true);
  check('curved marking run preserves handles', runs.some(r => r.some(nd => nd.o || nd.i)));
}

// ---- plan refusals ------------------------------------------------------
console.log('\n== planWeld ==');
{
  const two = [obj(rect(0, 0, 10, 10)), obj(rect(8, 0, 18, 10))];
  check('one object refused', !T.planWeld([two[0]]).ok);
  check('degenerate outer refused', !T.planWeld([obj([{ x: 0, y: 0 }, { x: 1, y: 1 }]), two[1]]).ok);
  check('valid plan ok', T.planWeld(two).ok);
}

// ---- weldExact orchestration --------------------------------------------
console.log('\n== weldExact ==');
{
  // vertical offset so the union has corner tips (axis-aligned overlap shares
  // whole edges and produces no discrete tip nodes)
  const w = T.weldExact([obj(rect(0, 0, 10, 10)), obj(rect(8, 2, 18, 12))], fakeApi, false);
  check('overlapping pair welds ok', w.ok, w.why);
  check('one piece', w.pieces === 1, w.pieces);
  check('one joint', w.joints === 1, w.joints);
  check('red marking present', w.red.length >= 1, w.red.length);
  const bb = T.ringsBBox(w.A.map(T.sampleLoop));
  check('union spans 0..18', Math.abs(bb.minX) < 1e-6 && Math.abs(bb.maxX - 18) < 1e-6, JSON.stringify(bb));
}
{
  const w = T.weldExact([obj(rect(0, 0, 10, 10)), obj(rect(20, 0, 30, 10))], fakeApi, false);
  check('detached objects -> two pieces, no joint', w.ok && w.pieces === 2 && w.joints === 0,
    JSON.stringify({ pieces: w.pieces, joints: w.joints }));
}
{
  const objs = [obj(rect(0, 0, 10, 10)), obj(rect(8, 2, 18, 12)), obj(rect(16, 4, 26, 14))];
  const w = T.weldExact(objs, fakeApi, false);
  check('three-chain welds ok', w.ok, w.why);
  check('two joints', w.joints === 2, w.joints);
  check('one piece', w.pieces === 1, w.pieces);
}

// ---- readObjects: depth relative to selection, not global ---------------
console.log('\n== readObjects: letters inside an unselected box ==');
{
  const box = { poly: rect(-50, -50, 100, 100), _e: 100 };
  const la = { poly: rect(0, 0, 10, 10), _e: 1 };
  const lb = { poly: rect(8, 2, 18, 12), _e: 2 };
  const fakeApi = {
    selectedEntities: () => [{ id: 1, type: 'spline', color: '#000000' }, { id: 2, type: 'spline', color: '#000000' }],
    colorOf: e => e.color,
    getLoops: () => [box, la, lb],
    loopEntities: L => [L._e]
  };
  const r = T.readObjects(fakeApi);
  check('letters inside unselected box are accepted', !r.err && r.objects.length === 2, r.err || r.objects.length);
  // selecting the box too makes it the container -> letters become its holes
  const fakeApi2 = Object.assign({}, fakeApi, {
    selectedEntities: () => [{ id: 100, type: 'spline', color: '#000000' }, { id: 1, type: 'spline', color: '#000000' }, { id: 2, type: 'spline', color: '#000000' }]
  });
  const r2 = T.readObjects(fakeApi2);
  check('box selected -> letters become its holes (not outers)', !!r2.err || r2.objects.length === 1, r2.err || r2.objects.length);
}

console.log('\n' + (fail ? fail + ' FAILED, ' : 'all ') + pass + ' checks passed');
process.exit(fail ? 1 : 0);