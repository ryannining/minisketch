// Probe for the spiral generator (tools/spiral.js).
// Slices the pure functions out of the tool file and runs them without a DOM.
//
// Run: node testing/spiral_probe.js
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'spiral.js'), 'utf8');
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

const names = ['fmt2', 'planSpiral', 'spiralPoints'];
const consts = `
  const ARC_ERR = 0.02;
  const MAX_TURNS = 400;
  const MAX_STARTS = 8;
  const MODES = ['pitch', 'loops'];
`;
const T = new Function(consts + names.map(slice).join('\n') +
  '\nreturn {' + names.join(',') + '};')();

const bbox = (pts) => {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  return { minX: x0, maxX: x1, minY: y0, maxY: y1 };
};

console.log('\n== plan: refusals ==');
check('inner 0 refused', T.planSpiral({ di: 0, dout: 80, pitch: 3, mode: 'pitch' }).ok === false);
check('inner negative refused', T.planSpiral({ di: -5, dout: 80, pitch: 3, mode: 'pitch' }).ok === false);
check('outer <= inner refused', T.planSpiral({ di: 80, dout: 80, pitch: 3, mode: 'pitch' }).ok === false);
check('outer < inner refused', T.planSpiral({ di: 80, dout: 60, pitch: 3, mode: 'pitch' }).ok === false);
check('pitch > gap refused', T.planSpiral({ di: 20, dout: 24, pitch: 5, mode: 'pitch' }).ok === false);
check('pitch 0 refused', T.planSpiral({ di: 20, dout: 80, pitch: 0, mode: 'pitch' }).ok === false);
check('loops 0 refused', T.planSpiral({ di: 20, dout: 80, loops: 0, mode: 'loops' }).ok === false);
check('loops 500 refused', T.planSpiral({ di: 20, dout: 80, loops: 500, mode: 'loops' }).ok === false);
const r1 = T.planSpiral({ di: 0, dout: 80, pitch: 3, mode: 'pitch' });
check('refusal carries a reason', typeof r1.why === 'string' && r1.why.length > 0, r1.why);

console.log('\n== plan: whole turns and realised pitch ==');
const exact = T.planSpiral({ di: 20, dout: 80, pitch: 10, mode: 'pitch' });
check('exact division keeps the typed pitch', exact.ok && Math.abs(exact.pitch - 10) < 1e-12);
check('exact division: turns = gap/pitch', exact.n === 3, exact.n);
const odd = T.planSpiral({ di: 20, dout: 80, pitch: 3, mode: 'pitch' });
check('odd pitch rounds to nearest whole turn', odd.ok && odd.n === 10, odd.n);
check('realised pitch = gap / turns', Math.abs(odd.pitch - 30 / 10) < 1e-12);
check('realised pitch within half a step of typed', Math.abs(odd.pitch - 3) <= 3 / 2 + 1e-9, odd.pitch);
const lp = T.planSpiral({ di: 20, dout: 80, loops: 6, mode: 'loops' });
check('loops mode honours the count', lp.ok && lp.n === 6);
check('loops mode derives the pitch', Math.abs(lp.pitch - 30 / 6) < 1e-12);
const fractional = T.planSpiral({ di: 20, dout: 80, loops: 5.4, mode: 'loops' });
check('fractional loop count is snapped whole', fractional.ok && fractional.n === 5);
check('minimum spiral is one whole turn',
  (() => { const p = T.planSpiral({ di: 20, dout: 26, pitch: 3, mode: 'pitch' });
    return p.ok && p.n === 1 && Math.abs(p.pitch - 3) < 1e-12; })());

console.log('\n== points: start on the inner ring, end on the outer ==');
const pts = T.spiralPoints(exact.ri, exact.ro, exact.n);
check('first point sits at the inner radius', Math.abs(Math.hypot(pts[0].x, pts[0].y) - 10) < 1e-9, Math.hypot(pts[0].x, pts[0].y));
check('first point is not the centre', pts[0].x > 9.99 && Math.abs(pts[0].y) < 1e-9);
check('last point sits at the outer radius',
  Math.abs(Math.hypot(pts[pts.length - 1].x, pts[pts.length - 1].y) - 40) < 1e-9);
check('last point closes the final turn on the start bearing',
  Math.abs(pts[pts.length - 1].y) < 1e-9 && pts[pts.length - 1].x > 39.99);
const radii = pts.map(q => Math.hypot(q.x, q.y));
let mono = true;
for (let k = 1; k < radii.length; k++) if (radii[k] < radii[k - 1] - 1e-12) mono = false;
check('radius grows monotonically', mono);
let inBand = true;
for (const r of radii) if (r < exact.ri - 1e-9 || r > exact.ro + 1e-9) inBand = false;
check('every point stays within inner..outer', inBand);

console.log('\n== points: spacing meets the arc tolerance ==');
// chord deviation at each interior sample: midpoint of the chord vs the true
// arc radius expected there (r grows linearly with theta, so the mean of the
// neighbouring radii is the true mid radius)
let worst = 0;
for (let k = 0; k < pts.length - 1; k++) {
  const mx = (pts[k].x + pts[k + 1].x) / 2, my = (pts[k].y + pts[k + 1].y) / 2;
  const rMid = (radii[k] + radii[k + 1]) / 2;
  worst = Math.max(worst, rMid - Math.hypot(mx, my));
}
check('chord error <= ARC_ERR everywhere', worst <= 0.02 + 1e-9, worst);
const tiny = T.spiralPoints(0.25, 0.75, 1);
check('a hairline spiral still samples enough points', tiny.length >= 37, tiny.length);
const dense = T.spiralPoints(1, 2000, 1);
check('sample count stays capped on huge shapes', dense.length <= 24001, dense.length);

console.log('\n== geometry: the frame of a whole-turn spiral ==');
const bb = bbox(pts);
check('x extent reaches exactly the outer radius eastward', Math.abs(bb.maxX - 40) < 1e-9, bb.maxX);
// the true west extremum of the curve sits between samples, but a sample
// lands exactly on bearing 180 and reads -(ro - pitch/2)
const westSample = pts.filter(q => Math.abs(q.y) < 1e-9 && q.x < 0)
  .some(q => Math.abs(q.x + (40 - exact.pitch / 2)) < 1e-9);
check('a sample sits on the west bearing at ro - pitch/2', westSample);
check('west side is never beyond the expected shortfall',
  bb.minX <= -(40 - exact.pitch / 2) + 1e-9 && bb.minX > -40, bb.minX);
check('bbox never exceeds the outer circle',
  bb.maxX <= 40 + 1e-9 && bb.minX >= -40 - 1e-9 && bb.maxY <= 40 + 1e-9 && bb.minY >= -40 - 1e-9);
// turning by 90 degrees per quadrant must sample every extreme angle:
const q = T.spiralPoints(exact.ri, exact.ro, 2);
const qq = bbox(q);
check('two turns reach north, south, east and west',
  qq.maxX > 0 && qq.minX < 0 && qq.maxY > 0 && qq.minY < 0);

console.log('\n== angular sweep ==');
const lastTh = Math.atan2(pts[pts.length - 1].y, pts[pts.length - 1].x);
check('final point is on bearing 0 (mod 2pi)', Math.abs(Math.atan2(Math.sin(lastTh), Math.cos(lastTh))) < 1e-9);
let turnCount = 0;
for (let k = 1; k < pts.length; k++) {
  let d = Math.atan2(pts[k].y, pts[k].x) - Math.atan2(pts[k - 1].y, pts[k - 1].x);
  if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
  turnCount += d;
}
check('sweep is exactly 2*pi*turns CCW', Math.abs(turnCount - 2 * Math.PI * exact.n) < 1e-6, turnCount);

console.log('\n== starts: plan ==');
check('starts 0 refused', T.planSpiral({ di: 20, dout: 80, pitch: 3, starts: 0, mode: 'pitch' }).ok === false);
check('starts 9 refused', T.planSpiral({ di: 20, dout: 80, pitch: 1, starts: 9, mode: 'pitch' }).ok === false);
check('starts 2.6 snapped whole', (() => { const p = T.planSpiral({ di: 20, dout: 80, pitch: 1, starts: 2.6, mode: 'pitch' }); return p.ok && p.S === 3; })());
check('starts 2 with pitch > gap/2 refused', T.planSpiral({ di: 20, dout: 80, pitch: 16, starts: 2, mode: 'pitch' }).ok === false);
const s2 = T.planSpiral({ di: 20, dout: 80, pitch: 3, starts: 2, mode: 'pitch' });
check('starts 2: each arm grows 2*pitch per turn', s2.ok && s2.n === 5, s2.n);
check('starts 2: adjacent pitch preserved', s2.ok && Math.abs(s2.pitch - 3) < 1e-12, s2.pitch);
check('starts 2: lead per arm = gap/turns', Math.abs(s2.lead - 6) < 1e-12);
const s2l = T.planSpiral({ di: 20, dout: 80, loops: 5, starts: 2, mode: 'loops' });
check('loops mode with starts: turns per arm honoured', s2l.ok && s2l.n === 5);
check('loops mode with starts: pitch = gap/(S*n)', Math.abs(s2l.pitch - 3) < 1e-12);
check('starts 1 keeps the single-arm numbers', (() => { const p = T.planSpiral({ di: 20, dout: 80, pitch: 10, starts: 1, mode: 'pitch' }); return p.ok && p.n === 3 && Math.abs(p.pitch - 10) < 1e-12; })());

console.log('\n== starts: the arms interleave without cutting ==');
const armA = T.spiralPoints(s2.ri, s2.ro, s2.n, 0);
const armB = T.spiralPoints(s2.ri, s2.ro, s2.n, Math.PI);
let minGap = Infinity;
for (const a of armA) for (const b of armB) {
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  if (d < minGap) minGap = d;
}
check('two 180-deg arms never touch', minGap >= s2.pitch - 1e-9, minGap);
check('arm B ends on bearing 180 at the outer radius',
  (() => { const e = armB[armB.length - 1];
    return Math.abs(Math.hypot(e.x, e.y) - s2.ro) < 1e-9 && e.x < 0 && Math.abs(e.y) < 1e-9; })());
check('arm B starts on bearing 180 at the inner radius',
  (() => { const q = armB[0];
    return Math.abs(Math.hypot(q.x, q.y) - s2.ri) < 1e-9 && q.x < 0; })());
// every point of arm B is a rotation of arm A by pi: identical arm, offset phase
let rotated = true;
for (let k = 0; k < armA.length; k++) {
  const a = armA[k], b = armB[k];
  if (Math.hypot(a.x + b.x, a.y + b.y) > 1e-9) rotated = false;
}
check('the starts are exact rotations of one arm', rotated);
// 4 starts fill the frame square: extremes hit +-ro on both axes
const arms4 = [];
const p4 = T.planSpiral({ di: 20, dout: 80, pitch: 1.5, starts: 4, mode: 'pitch' });
check('starts 4 plans', p4.ok);
for (let k = 0; k < 4; k++) for (const q of T.spiralPoints(p4.ri, p4.ro, p4.n, Math.PI / 2 * k)) arms4.push({ arm: k, x: q.x, y: q.y });
const bb4 = bbox(arms4);
check('starts 4: bbox is exactly outer diameter wide', Math.abs(bb4.maxX - 40) < 1e-9 && Math.abs(bb4.minX + 40) < 1e-9, bb4.minX + ',' + bb4.maxX);
check('starts 4: bbox is exactly outer diameter tall', Math.abs(bb4.maxY - 40) < 1e-9 && Math.abs(bb4.minY + 40) < 1e-9, bb4.minY + ',' + bb4.maxY);
let gap4 = Infinity;
for (let k = 0; k < arms4.length; k++) for (let m = k + 1; m < arms4.length; m++) {
  if ((arms4[k].arm | 0) === (arms4[m].arm | 0)) continue; // same arm: just segment length
  const d = Math.hypot(arms4[k].x - arms4[m].x, arms4[k].y - arms4[m].y);
  if (d < gap4) gap4 = d;
}
check('four arms keep the adjacent pitch apart', gap4 >= p4.pitch - 1e-9, gap4);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
