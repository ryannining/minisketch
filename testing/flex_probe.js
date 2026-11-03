// Probe for the standalone flex/living-hinge pattern (tools/flex.js).
// Slices the pure functions out of the tool file and runs them without a DOM.
//
// Run: node testing/flex_probe.js
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'flex.js'), 'utf8');
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

const names = ['cuts', 'bridgePlan', 'columnPlan', 'buildPattern'];
const consts = `
  const MIN_SPAN = 0.2;
  const MIN_EDGE = 0.5;
  const fmt0 = (v) => String(Math.round(+v * 100) / 100);
`;
const F = new Function(consts + names.map(slice).join('\n') +
  '\nreturn {' + names.join(',') + '};')();

const solidAt = (list, y) => !list.some(([a, b]) => y > a + 1e-9 && y < b - 1e-9);
const overlaps = (list) => {
  const s = list.slice().sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < s.length; i++) if (s[i][0] < s[i - 1][1] - 1e-9) return true;
  return false;
};
const bboxOfSegs = (segs) => {
  let lo = Infinity, hi = -Infinity;
  for (const s of segs) { lo = Math.min(lo, s.x, s.x); hi = Math.max(hi, s.x, s.x); }
  let y0 = Infinity, y1 = -Infinity;
  for (const s of segs) { y0 = Math.min(y0, s.y0); y1 = Math.max(y1, s.y1); }
  return { minX: lo, maxX: hi, minY: y0, maxY: y1 };
};
const BASE = { length: 60, width: 20, cutPitch: 2.5, bridgeW: 1.6, bridgeP: 5.2,
  endMargin: 2, kerf: 0.2, outline: false, style: 'ab' };

// ---- the two columns must interlock --------------------------------------
console.log('\n== bridge plan: interlock ==');
for (const [W, bw, bp] of [[20, 1.6, 5.2], [40, 3, 4.37], [12, 1, 3], [60, 2, 9], [3.5, 1, 1.6]]) {
  const br = F.bridgePlan(W, bw, bp, false);
  const tag = `W${W}/bw${bw}/bp${bp}`;
  check(`${tag}: accepted`, br.ok === true, br.why);
  if (!br.ok) continue;
  const [A, B] = br.lists;
  check(`${tag}: both columns hold cuts`, A.length && B.length, A.length + '/' + B.length);
  check(`${tag}: spans are positive and inside the slit`,
    A.concat(B).every(([a, b]) => b > a && a >= -1e-9 && b <= W + 1e-9));
  check(`${tag}: one column never overlaps itself`, !overlaps(A) && !overlaps(B));
  check(`${tag}: the columns are complementary at both ends`,
    solidAt(A, 0.05) !== solidAt(B, 0.05) &&
    solidAt(A, W - 0.05) !== solidAt(B, W - 0.05),
    'bottom A:' + solidAt(A, 0.05) + ' B:' + solidAt(B, 0.05));
  check(`${tag}: the columns are not the same pattern`,
    JSON.stringify(A) !== JSON.stringify(B));
  // The interlock, stated properly: solid material never lines up between the
  // two columns, so at every height at least one of the two slits is open. A
  // band bridged in both columns would leave the strip rigid there.
  const bandsOf = (list) => {
    const out = [];
    let y = 0;
    for (const [a, b] of list.slice().sort((p, q) => p[0] - q[0])) {
      if (a - y > 1e-9) out.push([y, a]);
      y = Math.max(y, b);
    }
    if (W - y > 1e-9) out.push([y, W]);
    return out;
  };
  const touch = (p, q) => p[1] > q[0] + 1e-9 && q[1] > p[0] + 1e-9;
  const bA = bandsOf(A), bB = bandsOf(B);
  check(`${tag}: no height is bridged in both columns`,
    bA.every(a => bB.every(b => !touch(a, b))),
    'A ' + JSON.stringify(bA) + ' B ' + JSON.stringify(bB));
  const unionCovers = () => {
    const all = A.concat(B).sort((p, q) => p[0] - q[0]);
    let reach = 0;
    for (const [a, b] of all) { if (a > reach + 1e-9) break; reach = Math.max(reach, b); }
    return Math.abs(reach - W) < 1e-6;
  };
  check(`${tag}: the two columns together slit the full height`, unionCovers());
}

// ---- nonsense input is refused, not silently clamped ----------------------
console.log('\n== bridge plan: refusals ==');
{
  const refusals = [
    [0, 1.6, 5.2, 'zero width'],
    [-4, 1.6, 5.2, 'negative width'],
    [20, 0, 5.2, 'zero bridge'],
    [20, 1.6, 0, 'zero pitch'],
    [1.5, 1.6, 5.2, 'width smaller than one bridge'],
    [1.9, 1.6, 5.2, 'width that leaves no cut material beside the bridge'],
    [20, 1.6, 1.5, 'pitch not wider than the bridge'],
    [4, 1.6, 12, 'pitch far wider than the width'],
    [8, 3, 20, 'bridges cannot reach three']
  ];
  for (const [W, bw, bp, what] of refusals) {
    const br = F.bridgePlan(W, bw, bp, false);
    check(`refuses ${what} (${W}/${bw}/${bp})`, br.ok === false, JSON.stringify(br));
    check(`${what}: says why`, br.ok === false && typeof br.why === 'string' && br.why.length > 10);
  }
  // the far case: a wide pitch collapses to three bridges and a real pitch
  const br = F.bridgePlan(20, 1.6, 100, false);
  check('an absurd pitch is re-validated, not trusted',
    br.ok === false || (br.bridges >= 3 && br.pitch > 1.6 + 0.2),
    JSON.stringify({ ok: br.ok, bridges: br.bridges, pitch: br.pitch, why: br.why }));
}

// ---- comb: one column, still full height --------------------------------
console.log('\n== bridge plan: comb ==');
for (const [W, bw, bp] of [[20, 1.6, 5.2], [30, 2, 8], [6, 1, 2.2]]) {
  const br = F.bridgePlan(W, bw, bp, true);
  const tag = `comb W${W}/bw${bw}/bp${bp}`;
  check(`${tag}: accepted`, br.ok === true, br.why);
  if (!br.ok) continue;
  check(`${tag}: yields exactly one column`, br.lists.length === 1);
  const list = br.lists[0];
  check(`${tag}: cuts tile the whole height`,
    Math.abs(list[0][0]) < 1e-9 && Math.abs(list[list.length - 1][1] - W) < 1e-9,
    list[0][0] + '..' + list[list.length - 1][1]);
  check(`${tag}: spans ordered, positive, not overlapping`,
    list.every(([a, b]) => b > a) && !overlaps(list) &&
    list.slice(1).every(([a], i) => a >= list[i][1] - 1e-9));
  const ab = F.bridgePlan(W, bw, bp, false);
  check(`${tag}: the comb is not the interlocked first column`,
    !ab.ok || JSON.stringify(ab.lists[0]) !== JSON.stringify(list));
}
{
  const br = F.bridgePlan(20, 1.6, 1.65, true);
  check('comb refuses a pitch that leaves no gap beside a bridge', br.ok === false, JSON.stringify(br));
}

// ---- columns are spread over the length exactly --------------------------
console.log('\n== column plan ==');
for (const [L, cp, m] of [[60, 2.5, 0], [60, 2.5, 2], [12, 1.5, 0], [500, 7, 20], [6, 2, 0]]) {
  const p = F.columnPlan(L, cp, m);
  const tag = `L${L}/cp${cp}/m${m}`;
  check(`${tag}: accepted`, p.ok === true, p.why);
  if (!p.ok) continue;
  check(`${tag}: first column sits on the margin`, Math.abs(p.xs[0] - m) < 1e-9, p.xs[0]);
  check(`${tag}: last column sits on L - margin`,
    Math.abs(p.xs[p.xs.length - 1] - (L - m)) < 1e-9, p.xs[p.xs.length - 1]);
  check(`${tag}: pitch is uniform`,
    p.xs.every((v, i) => i === 0 || Math.abs((v - p.xs[i - 1]) - p.pitch) < 1e-9));
  check(`${tag}: n - 1 intervals cover the span, so the real pitch is near the typed one`,
    p.xs.length === p.n && Math.abs(p.pitch - cp) / cp < 0.2, p.pitch.toFixed(3) + ' vs ' + cp);
  check(`${tag}: two columns at least`, p.n >= 2);
}
check('a length shorter than one pitch is refused',
  F.columnPlan(6, 10, 0).ok === false);
check('margins that eat the length are refused',
  F.columnPlan(60, 2.5, 30).ok === false);

// ---- the whole pattern: the frame must read Length x Width --------------
console.log('\n== built pattern: bbox is exactly L x W ==');
{
  const grid = [];
  for (const [L, W] of [[60, 20], [24, 8], [120, 40], [10, 8]])
    for (const style of ['ab', 'comb'])
      for (const outline of [false, true])
        grid.push({ L, W, style, outline });
  for (const g of grid) {
    const p = Object.assign({}, BASE,
      { length: g.L, width: g.W, style: g.style, outline: g.outline });
    const plan = F.buildPattern(p);
    const tag = `${g.L}x${g.W} ${g.style} outline:${g.outline ? 'on' : 'off'}`;
    check(`${tag}: built`, plan.ok === true, plan.why);
    if (!plan.ok) continue;
    const bb = bboxOfSegs(plan.segs);
    const lo = g.outline ? Math.min(bb.minX, 0) : bb.minX;
    const hi = g.outline ? Math.max(bb.maxX, g.L) : bb.maxX;
    check(`${tag}: cuts span the width exactly`,
      Math.abs(bb.minY) < 1e-9 && Math.abs(bb.maxY - g.W) < 1e-9,
      bb.minY + '..' + bb.maxY);
    check(`${tag}: cuts span the length exactly`,
      Math.abs(lo) < 1e-9 && Math.abs(hi - g.L) < 1e-9, lo + '..' + hi);
    check(`${tag}: every cut is inside the box`,
      plan.segs.every(s => s.x >= -1e-9 && s.x <= g.L + 1e-9 &&
        s.y0 >= -1e-9 && s.y1 <= g.W + 1e-9));
    if (g.outline) {
      check(`${tag}: outline rectangle is the box`,
        JSON.stringify(plan.rect) === JSON.stringify(
          [{ x: 0, y: 0 }, { x: g.L, y: 0 }, { x: g.L, y: g.W }, { x: 0, y: g.W }]));
      check(`${tag}: no slit endpoint lands on a corner`,
        plan.segs.every(s => s.x > 1e-9 && s.x < g.L - 1e-9),
        plan.margin);
    } else {
      check(`${tag}: no outline emitted`, plan.rect === null);
      check(`${tag}: outermost slits stay on the edges (nothing to weld)`,
        Math.abs(bboxOfSegs(plan.segs).minX) < 1e-9 &&
        Math.abs(bboxOfSegs(plan.segs).maxX - g.L) < 1e-9);
    }
    if (g.style === 'comb') {
      const byX = {};
      for (const s of plan.segs) (byX[s.x] = byX[s.x] || []).push([s.y0, s.y1]);
      const cols = Object.values(byX);
      check(`${tag}: every comb column is the same row`,
        cols.every(c => JSON.stringify(c) === JSON.stringify(cols[0])), cols.length + ' columns');
    }
  }
}

console.log('\n== built pattern: refusals ==');
for (const [patch, what] of [
  [{ width: 1.5 }, 'a width that cannot hold a bridge'],
  [{ bridgeP: 1.0, bridgeW: 1.6 }, 'a bridge pitch below the bridge width'],
  [{ cutPitch: 0.2 }, 'a cut pitch inside the kerf'],
  [{ length: 6, cutPitch: 40 }, 'a length shorter than the cut pitch'],
  [{ outline: true, length: 4, cutPitch: 2 }, 'a length with no room for an end margin'],
  [{ outline: true, length: 6, cutPitch: 3 }, 'a length exactly full of two columns'],
  [{ style: 'comb', bridgeP: 1.6, bridgeW: 1.5 }, 'a comb with no gap left beside its bridges']
]) {
  const plan = F.buildPattern(Object.assign({}, BASE, patch));
  check(`refuses ${what}`, plan.ok === false, JSON.stringify(plan));
}
{
  // a slit too short to hold three bridges cannot interlock: it must say so and
  // name the way out, not quietly emit two identical columns
  const plan = F.buildPattern(Object.assign({}, BASE, { width: 4 }));
  check('a narrow width is refused for the interlocked style',
    plan.ok === false, JSON.stringify(plan));
  check('and the message points at the comb style',
    plan.ok === false && /comb/i.test(plan.why), plan.why);
  // the margin may never go negative: that would put a slit outside the box
  for (const [L, cp, em] of [[8, 3, 0], [12, 5, 20], [9, 2, 4], [40, 2, 0]]) {
    const p = F.buildPattern(Object.assign({}, BASE, { length: L, cutPitch: cp, endMargin: em, outline: true }));
    if (!p.ok) { check(`L${L}/cp${cp}/em${em}: refused honestly`, true); continue; }
    check(`L${L}/cp${cp}/em${em}: margin stays inside the box`,
      p.margin >= 0 && p.segs.every(s => s.x >= -1e-9 && s.x <= L + 1e-9),
      p.margin + ' / ' + p.segs.map(s => s.x).join(','));
  }
}
{
  // the ligament: the real pitch is what matters, not the typed one
  const plan = F.buildPattern(Object.assign({}, BASE, { cutPitch: 0.61, kerf: 0.5 }));
  check('a ligament thinner than the beam can leave is refused',
    plan.ok === false || plan.ligament > 0.2, JSON.stringify(plan));
}

console.log('\n== built pattern: a sane default is a usable hinge ==');
{
  const plan = F.buildPattern(BASE);
  check('default builds', plan.ok === true, plan.why);
  if (plan.ok) {
    check('default has a real number of slits over the length',
      plan.cols >= 20 && plan.cols <= 30, plan.cols);
    check('default ligament is cuttable (>= 0.4 mm of standing material)',
      plan.ligament >= 0.4, plan.ligament);
    check('default bridge pitch is wider than one bridge',
      plan.bridgePitch > BASE.bridgeW, plan.bridgePitch + ' vs ' + BASE.bridgeW);
    check('default interlocks (two alternating columns)', plan.alternates === true);
    const comb = F.buildPattern(Object.assign({}, BASE, { style: 'comb' }));
    check('the same numbers as a comb build too, and fold one way only',
      comb.ok === true && comb.alternates === false, comb.why);
    check('comb cuts are not more than twice the interlocked count',
      comb.ok && plan.ok && comb.segs.length <= plan.segs.length * 2 + 2,
      comb.segs.length + ' vs ' + plan.segs.length);
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
