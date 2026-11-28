// Probe for Sashiko Art Generator (tools/sashiko.js).
// Slices the pure planning and pattern generation out of the tool file and runs them with Clipper.
//
// Run: node testing/sashiko_probe.js
const fs = require('fs');
const path = require('path');
const ClipperLib = require('../tools/clipper.js');

const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'sashiko.js'), 'utf8');
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

const fnNames = [
  'dashPolyline', 'sampleVisibleArc',
  'genAsanoha', 'genSeigaiha', 'genShippo', 'genKikko', 'genSayagata',
  'genTatewaku', 'genKagome', 'genHishi', 'genKakihana', 'genHigaki',
  'generatePatternLines', 'planSashiko', 'miterTipPaths'
];

const api = new Function("const END_STYLES = ['round', 'miter', 'square'];\n" +
  fnNames.map(slice).join('\n') + '\nreturn { ' + fnNames.join(', ') + ' };')();

console.log('\n== planSashiko input validation ==');
const def = api.planSashiko({ w: 1220, h: 2440, th: 14, margin: 20, pitchX: 120, pitchY: 80, dashed: false, dash: 12, gap: 4, pattern: 'seigaiha', mode: 'holes' });
check('default parameters valid (1220x2440, th=14, margin=20, pitchX=120, pitchY=80)', def.ok === true, def.why);
check('default parameters returned intact', def.w === 1220 && def.h === 2440 && def.th === 14 && def.margin === 20 && def.pitchX === 120 && def.pitchY === 80);

check('w <= 0 rejected', api.planSashiko({ w: 0, h: 100, th: 10, margin: 5, pitchX: 50, pitchY: 50 }).ok === false);
check('h <= 0 rejected', api.planSashiko({ w: 100, h: -10, th: 10, margin: 5, pitchX: 50, pitchY: 50 }).ok === false);
check('th <= 0 rejected', api.planSashiko({ w: 100, h: 100, th: 0, margin: 5, pitchX: 50, pitchY: 50 }).ok === false);
check('margin < 0 rejected', api.planSashiko({ w: 100, h: 100, th: 10, margin: -1, pitchX: 50, pitchY: 50 }).ok === false);
check('2 * margin >= w rejected', api.planSashiko({ w: 100, h: 100, th: 10, margin: 55, pitchX: 50, pitchY: 50 }).ok === false);
check('pitchX <= 0 rejected', api.planSashiko({ w: 100, h: 100, th: 10, margin: 5, pitchX: 0, pitchY: 50 }).ok === false);
check('pitchY <= 0 rejected', api.planSashiko({ w: 100, h: 100, th: 10, margin: 5, pitchX: 50, pitchY: -5 }).ok === false);
check('dashed with invalid dash rejected', api.planSashiko({ w: 100, h: 100, th: 10, margin: 5, pitchX: 50, pitchY: 50, dashed: true, dash: 0, gap: 4 }).ok === false);
check('dashed with valid dash & gap accepted', api.planSashiko({ w: 100, h: 100, th: 10, margin: 5, pitchX: 50, pitchY: 50, dashed: true, dash: 12, gap: 4 }).ok === true);
check('end style round/miter/square accepted', ['round', 'miter', 'square'].every(end =>
  api.planSashiko({ w: 100, h: 100, th: 10, margin: 5, pitchX: 50, pitchY: 50, end }).ok === true));
check('unknown end style rejected', api.planSashiko({ w: 100, h: 100, th: 10, margin: 5, pitchX: 50, pitchY: 50, end: 'bevel' }).ok === false);
check('missing end style defaults to square', api.planSashiko({ w: 100, h: 100, th: 10, margin: 5, pitchX: 50, pitchY: 50 }).end === 'square');

console.log('\n== miter end caps ==');
const tips = api.miterTipPaths([{ x: 0, y: 0 }, { x: 100, y: 0 }], 7, 1000);
check('one tip triangle per open end', tips.length === 2 && tips.every(t => t.length === 3), JSON.stringify(tips));
check('tips extend half a ribbon past both ends', tips.length === 2 &&
  tips[0].some(p => p.X === -7000) && tips[1].some(p => p.X === 107000), JSON.stringify(tips));

console.log('\n== dashed running stitch segmentation ==');
const sampleLine = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
const dashes = api.dashPolyline(sampleLine, 12, 4);
check('dashPolyline generates segments', Array.isArray(dashes) && dashes.length > 0, dashes.length);
check('dashes have valid endpoints', dashes[0][0].x === 0 && dashes[dashes.length - 1][1].x === 100);

console.log('\n== pattern line generators (Pitch X & Pitch Y) ==');
const PATTERNS = [
  'seigaiha', 'asanoha', 'shippo', 'kikko', 'sayagata',
  'tatewaku', 'kagome', 'hishi', 'kakihana', 'higaki'
];

for (const pid of PATTERNS) {
  const lines = api.generatePatternLines(pid, 0, 0, 300, 300, 100, 75);
  check(`${pid}: generates lines with independent px & py`, Array.isArray(lines) && lines.length > 0, lines ? lines.length : 0);
  let allFinite = true;
  for (const line of lines) {
    for (const pt of line) {
      if (!isFinite(pt.x) || !isFinite(pt.y)) { allFinite = false; break; }
    }
  }
  check(`${pid}: all points have finite coordinates`, allFinite);
}

console.log('\n== Clipper ribbon union and hole extraction ==');
const SCALE = 1000;
const testW = 300, testH = 300, testTh = 14, testMargin = 20;

const innerPoly = [
  { X: testMargin * SCALE, Y: testMargin * SCALE },
  { X: (testW - testMargin) * SCALE, Y: testMargin * SCALE },
  { X: (testW - testMargin) * SCALE, Y: (testH - testMargin) * SCALE },
  { X: testMargin * SCALE, Y: (testH - testMargin) * SCALE }
];

for (const pid of ['seigaiha', 'asanoha', 'shippo', 'kikko', 'sayagata']) {
  const lines = api.generatePatternLines(pid, testMargin, testMargin, testW - testMargin, testH - testMargin, 90, 70);
  const co = new ClipperLib.ClipperOffset(2, 0.25 * SCALE);
  for (const line of lines) {
    if (!line || line.length < 2) continue;
    co.AddPath(
      line.map(p => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) })),
      ClipperLib.JoinType.jtMiter,
      ClipperLib.EndType.etOpenSquare
    );
  }
  const ribbons = new ClipperLib.Paths();
  co.Execute(ribbons, (testTh / 2) * SCALE);
  check(`${pid}: ribbons unified successfully`, ribbons.length > 0, ribbons.length);

  const c = new ClipperLib.Clipper();
  c.AddPath(innerPoly, ClipperLib.PolyType.ptSubject, true);
  c.AddPaths(ribbons, ClipperLib.PolyType.ptClip, true);
  const holes = new ClipperLib.Paths();
  c.Execute(
    ClipperLib.ClipType.ctDifference,
    holes,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero
  );
  check(`${pid}: generates closed cut holes (> 0)`, holes.length > 0, `${holes.length} holes`);
}

console.log('\n== Dashed lines Clipper ribbon generation ==');
{
  const lines = api.generatePatternLines('seigaiha', testMargin, testMargin, testW - testMargin, testH - testMargin, 100, 70);
  const dashedLines = [];
  for (const l of lines) {
    const d = api.dashPolyline(l, 12, 4);
    for (const seg of d) dashedLines.push(seg);
  }
  check('seigaiha dashed: segments created', dashedLines.length > lines.length, `${dashedLines.length} segments`);
  const co = new ClipperLib.ClipperOffset(2, 0.25 * SCALE);
  for (const l of dashedLines) {
    co.AddPath(
      l.map(p => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) })),
      ClipperLib.JoinType.jtRound,
      ClipperLib.EndType.etOpenRound
    );
  }
  const dashedRibbons = new ClipperLib.Paths();
  co.Execute(dashedRibbons, (testTh / 2) * SCALE);
  check('seigaiha dashed: ribbons formed', dashedRibbons.length > 0, dashedRibbons.length);
}

console.log('\n' + (fail ? fail + ' FAILED, ' : 'all ') + pass + ' checks passed');
process.exit(fail ? 1 : 0);
