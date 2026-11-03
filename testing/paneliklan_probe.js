// Probe for the Panel iklan geometry (tools/paneliklan.js).
// Slices the pure plan functions out of the tool file and runs them without a DOM.
//
// Run: node testing/paneliklan_probe.js
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'paneliklan.js'), 'utf8');
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

const names = ['roundRectSDF', 'roundRectPts', 'holeCenters', 'planPanel'];
const consts = `
  const MODES = ['corners', 'leftright', 'topbottom'];
  const ARC_ERR = 0.02;
`;
const P = new Function(consts + names.map(slice).join('\n') +
  '\nreturn {' + names.join(',') + '};')();

const bbox = (pts) => pts.reduce((b, p) => ({
  minX: Math.min(b.minX, p.x), maxX: Math.max(b.maxX, p.x),
  minY: Math.min(b.minY, p.y), maxY: Math.max(b.maxY, p.y)
}), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });

console.log('\n== outline ==');
for (const [w, h, r] of [[400, 300, 10], [400, 300, 0], [120, 60, 5], [400, 300, 900], [50, 50, 25]]) {
  const pts = P.roundRectPts(w, h, r);
  const b = bbox(pts);
  const tag = `${w}x${h} r${r}`;
  check(`${tag}: bbox is exactly the panel size`,
    Math.abs(b.minX) < 1e-9 && Math.abs(b.minY) < 1e-9 &&
    Math.abs(b.maxX - w) < 1e-9 && Math.abs(b.maxY - h) < 1e-9,
    JSON.stringify(b));
  const rr = Math.min(r, w / 2, h / 2);
  if (rr > 1e-9) {
    // every sample sits on the true rounded-rect boundary (within ARC_ERR),
    // and the corners really are arcs of radius r
    const dev = pts.map(p => Math.abs(P.roundRectSDF(p.x, p.y, w, h, rr)));
    check(`${tag}: every outline point lies on the boundary`, Math.max(...dev) <= 0.021,
      Math.max(...dev).toFixed(4));
    const n = Math.round(pts.length / 4);
    const samples = [pts[0], pts[n], pts[2 * n], pts[3 * n]];
    const arcDev = samples.map((p, i) => {
      const cs = [[w - rr, rr], [w - rr, h - rr], [rr, h - rr], [rr, rr]];
      return Math.abs(Math.hypot(p.x - cs[i][0], p.y - cs[i][1]) - rr);
    });
    check(`${tag}: corner samples are on the corner arc`, Math.max(...arcDev) <= 1e-9,
      Math.max(...arcDev).toExponential(2));
  }
  check(`${tag}: runs counter-clockwise (positive area)`,
    2 * pts.reduce((s, p, i) => {
      const q = pts[(i + 1) % pts.length];
      return s + (p.x * q.y - q.x * p.y) / 2;
    }, 0) > 0);
}

console.log('\n== hole patterns ==');
{
  const base = { w: 400, h: 300, dia: 6, r: 10, inset: 10 };
  const near = (a, b, tol) => Math.abs(a - b) <= (tol || 1e-9);

  const corners = P.planPanel(Object.assign({}, base, { mode: 'corners' }));
  check('4 sudut: plan is accepted', corners.ok, corners.why);
  check('4 sudut: four holes', corners.holes.length === 4, corners.holes.length);
  // centre sits inset + radius from both edges -> 10 + 3 = 13
  check('4 sudut: bottom-left hole at 13,13',
    near(corners.holes[0].x, 13) && near(corners.holes[0].y, 13),
    JSON.stringify(corners.holes[0]));
  check('4 sudut: holes mirrored on both axes',
    near(corners.holes[1].x, 387) && near(corners.holes[1].y, 13) &&
    near(corners.holes[2].x, 387) && near(corners.holes[2].y, 287) &&
    near(corners.holes[3].x, 13) && near(corners.holes[3].y, 287),
    JSON.stringify(corners.holes));
  check('4 sudut: material between hole and edge is exactly the requested gap',
    corners.holes.every(c => near(-P.roundRectSDF(c.x, c.y, 400, 300, 10), 10 + 3)),
    corners.holes.map(c => -P.roundRectSDF(c.x, c.y, 400, 300, 10)).join(','));

  const lr = P.planPanel(Object.assign({}, base, { mode: 'leftright' }));
  check('2 kiri-kanan: two holes, vertically centred',
    lr.ok && lr.holes.length === 2 && near(lr.holes[0].y, 150) && near(lr.holes[1].y, 150),
    lr.ok ? JSON.stringify(lr.holes) : lr.why);
  check('2 kiri-kanan: one hole per side',
    near(lr.holes[0].x, 13) && near(lr.holes[1].x, 387), JSON.stringify(lr.holes));

  const tb = P.planPanel(Object.assign({}, base, { mode: 'topbottom' }));
  check('2 atas-bawah: two holes, horizontally centred',
    tb.ok && tb.holes.length === 2 && near(tb.holes[0].x, 200) && near(tb.holes[1].x, 200),
    tb.ok ? JSON.stringify(tb.holes) : tb.why);
  check('2 atas-bawah: one hole per side',
    near(tb.holes[0].y, 13) && near(tb.holes[1].y, 287), JSON.stringify(tb.holes));

  const noMode = P.planPanel(Object.assign({}, base, { mode: 'nonsense' }));
  check('an unknown pattern falls back to 4 corners', noMode.ok && noMode.holes.length === 4,
    noMode.why);
}

console.log('\n== fit checks ==');
{
  const base = { w: 400, h: 300, dia: 6, r: 10, inset: 10, mode: 'corners' };
  // a radius that big swallows the corner: the hole would sit outside the panel
  const swallowed = P.planPanel(Object.assign({}, base, { r: 150 }));
  check('a hole outside the panel is refused', !swallowed.ok && /keluar/.test(swallowed.why),
    swallowed.why);
  const noMargin = P.planPanel(Object.assign({}, base, { inset: 0, r: 0 }));
  check('inset 0 with r = 0 still fits (hole tangent to the edge)', noMargin.ok, noMargin.why);
  const bitten = P.planPanel(Object.assign({}, base, { inset: 0 }));
  check('inset 0 under a big radius is refused (the arc eats the corner)',
    !bitten.ok && /keluar/.test(bitten.why), bitten.why);
  // 400 wide, holes 60 across with 5 mm margin: centres 35 and 365 -> 330 apart, fine;
  // make them huge and they collide
  const clash = P.planPanel(Object.assign({}, base, { dia: 200, inset: 5, r: 0 }));
  check('overlapping holes are refused', !clash.ok && /tumpuk/.test(clash.why), clash.why);
  const thin = P.planPanel(Object.assign({}, base, { w: 30, mode: 'leftright' }));
  check('a panel too narrow for its side holes is refused', !thin.ok, thin.why);
  const bad = P.planPanel({ w: 0, h: 10, dia: 6, r: 1, inset: 1, mode: 'corners' });
  check('zero width is refused', !bad.ok, bad.why);
}

console.log('\n== sdf sanity ==');
{
  const inside = P.roundRectSDF(200, 150, 400, 300, 10);
  check('centre reads strictly inside', inside < 0, inside);
  check('distance to the nearest edge from the centre is 150', Math.abs(-inside - 150) < 1e-9, -inside);
  const offCentre = P.roundRectSDF(13, 150, 400, 300, 10);
  check('a point 13 mm from the left edge reads 13 mm of material', Math.abs(-offCentre - 13) < 1e-9,
    -offCentre);
  const outside = P.roundRectSDF(-5, 150, 400, 300, 10);
  check('a point past the edge reads positive', outside > 0, outside);
}

console.log('\n' + (fail ? fail + ' FAILED, ' : 'all ') + pass + ' checks passed');
process.exit(fail ? 1 : 0);
