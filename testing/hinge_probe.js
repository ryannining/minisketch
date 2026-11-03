// Probe for the Hinge box tool (tools/hinge.js).
//
// The tool was rebuilt from `ref/box_hinge_150x125x60mm.svg`: its constants are
// the reference numbers expressed as multiples of the stock thickness. So the
// strongest possible check is to parse that file and compare every panel back.
// A panel is correct when its size, its tab/slot rectangles and its knuckle
// match the SVG — not when a formula merely looks plausible.
//
// Both sides are compared in their own bounding box's frame (origin at the
// panel's bottom-left), because the sheet layout is ours to choose and the tool
// draws tabs below y = 0.
//
// Run: node testing/hinge_probe.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'tools', 'hinge.js'), 'utf8');
const svg = fs.readFileSync(path.join(root, 'ref', 'box_hinge_150x125x60mm.svg'), 'utf8');
const Clipper = require(path.join(root, 'tools', 'clipper.js'));
const C = require(path.join(root, 'core.js'));
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

const consts = src.slice(src.indexOf('const REF ='), src.indexOf('// ---- small helpers'));
const names = ['rect', 'chamferRect', 'lidOutline', 'circlePts', 'bbox', 'hingePlan'];
const H = new Function(
  consts +
  // the raised-cosine ease lives next to the lid builder
  'const ease = (t) => 0.5 * (1 - Math.cos(Math.PI * Math.max(0, Math.min(1, t))));\n' +
  names.map(slice).join('\n') +
  '\nreturn {' + names.join(',') + '};')();

const shim = require(path.join(__dirname, 'polybool_shim.js'));
const api = {
  clipperLib: () => Clipper,
  polyBoolOp: shim.polyBoolOp,
  offsetScale: 1000,
  offsetPrecision: 0.001,
  signedAreaPts: C.signedAreaPts
};
const combine = new Function('api', slice('combine') + '\nreturn combine;')(api);

// the tool's bbox() takes a LIST of contours; this takes just one
const bb = (pts) => H.bbox([pts]);
const area = (pts) => Math.abs(C.signedAreaPts(pts));
const netArea = (list) => list.reduce((a, pts) => a + C.signedAreaPts(pts), 0);

// Translate a point list so its bounding box starts at the origin.
function normalize(pts) {
  const b = bb(pts);
  return pts.map(p => ({ x: p.x - b.minX, y: p.y - b.minY }));
}

// ---------------------------------------------------------------------------
// Parse the reference SVG: each <g> with the paths in that group's OWN frame
// (the transform is dropped, which is all we need).
// ---------------------------------------------------------------------------
function parseSvg(text) {
  const groups = [];
  const gRe = /<g transform="([^"]+)">([\s\S]*?)<\/g>/g;
  let m;
  while ((m = gRe.exec(text))) {
    const transform = m[1];
    const body = m[2];
    const paths = [];
    const pRe = /<path d="([^"]+)"/g;
    let pm;
    while ((pm = pRe.exec(body))) {
      const nums = pm[1].match(/-?\d+(?:\.\d+)?/g) || [];
      const pts = [];
      for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: +nums[i], y: +nums[i + 1] });
      if (pts.length >= 3) paths.push(pts);
    }
    // `scale(1,-1)` is already Y-up; `scale(1,1)` is Y-down, so flip it
    const flip = /scale\(1,1\)/.test(transform);
    const own = paths.map(pts => pts.map(p => ({ x: p.x, y: flip ? -p.y : p.y })));
    const o = own.length ? H.bbox([own[0]]) : null;
    groups.push({
      transform,
      raw: paths,
      paths: own.map(pts => pts.map(p => ({ x: p.x - (o ? o.minX : 0), y: p.y - (o ? o.minY : 0) })))
    });
  }
  return groups;
}

const groups = parseSvg(svg);
const findGroup = (w, h) => groups.find(g => {
  const b = bb(g.paths[0]);
  return Math.abs(b.w - w) < 0.02 && Math.abs(b.h - h) < 0.02;
});

// ---------------------------------------------------------------------------
const prm = { L: 150, W: 125, H: 60, T: 3 };
const plan = H.hingePlan(prm);

console.log('\n== the reference file ==');
{
  check('six panel groups parse out of it', groups.length === 6, groups.length);
  check('one carries a dozen slots (the base)', groups.some(g => g.paths.length === 13),
    groups.map(g => g.paths.length).join(','));
  check('two carry a knuckle ring (the side walls)',
    groups.filter(g => g.paths.length === 2).length === 2,
    groups.filter(g => g.paths.length === 2).length);
}

// ---------------------------------------------------------------------------
console.log('\n== base: 150 x 125, twelve slots ==');
{
  const ref = findGroup(150, 125);
  check('the reference base was found', !!ref);
  const b = bb(plan.base.outline);
  check('the plate is 150 x 125', Math.abs(b.w - 150) < 1e-6 && Math.abs(b.h - 125) < 1e-6,
    b.w + ' x ' + b.h);
  check('it is an octagon: four sides plus four 45 degree chamfers',
    plan.base.outline.length === 8 && Math.abs(plan.prm.chamfer - 3.275) < 1e-9,
    plan.base.outline.length + ' points, chamfer ' + plan.prm.chamfer);

  const refSlots = ref.paths.slice(1).map(p => bb(p));
  const mine = plan.base.slots.map(p => bb(p));
  check('the reference has 12 slots and so does the plan',
    refSlots.length === 12 && mine.length === 12, refSlots.length + ' / ' + mine.length);

  const same = (a, b2) => Math.abs(a.w - b2.w) < 1e-3 && Math.abs(a.h - b2.h) < 1e-3 &&
    Math.abs((a.minX + a.maxX) / 2 - (b2.minX + b2.maxX) / 2) < 1e-3 &&
    Math.abs((a.minY + a.maxY) / 2 - (b2.minY + b2.maxY) / 2) < 1e-3;
  const unmatched = refSlots.filter(rs => !mine.some(ms => same(rs, ms)));
  check('every slot is reproduced in size and position', unmatched.length === 0,
    unmatched.map(s => `${s.w.toFixed(2)}x${s.h.toFixed(2)}@${((s.minX + s.maxX) / 2).toFixed(2)},${((s.minY + s.maxY) / 2).toFixed(2)}`).join(' '));

  // and the plate really loses that material (the rounded corners also come off)
  const cut = (() => {
    const S = 1000;
    const toPath = (pts) => pts.map(p => ({ X: Math.round(p.x * S), Y: Math.round(p.y * S) }));
    const cl = new Clipper.Clipper();
    cl.AddPaths([toPath(plan.base.outline)], Clipper.PolyType.ptSubject, true);
    cl.AddPaths(plan.base.slots.map(toPath), Clipper.PolyType.ptClip, true);
    const raw = new Clipper.Paths();
    cl.Execute(Clipper.ClipType.ctDifference, raw,
      Clipper.PolyFillType.pftNonZero, Clipper.PolyFillType.pftNonZero);
    return raw.map(p => p.map(q => ({ x: q.X / S, y: q.Y / S })));
  })();
  const want = area(plan.base.outline) - plan.base.slots.reduce((a, s) => a + area(s), 0);
  check('the plate area drops by exactly the slot area',
    Math.abs(netArea(cut) - want) < 0.5, Math.abs(netArea(cut) - want).toFixed(3));
}

// ---------------------------------------------------------------------------
console.log('\n== front / back wall: 150 x 60, four tabs, two end slots ==');
{
  const ref = findGroup(150, 60);
  check('the reference wall was found', !!ref);
  const b = bb(plan.wall.outline);
  check('the wall is 150 wide and H tall (the tab is part of H)',
    Math.abs(b.w - 150) < 1e-6 && Math.abs(b.h - 60) < 1e-6, b.w + ' x ' + b.h);
  check('so the visible wall above the plate is H - t',
    Math.abs(plan.prm.bodyH - 57) < 1e-9, plan.prm.bodyH);

  const mineN = normalize(plan.wall.outline);
  const refN = ref.paths[0];

  // the reference's tabs: edges lying at its own bottom (y = 0 after normalising)
  const refTabs = [];
  for (let i = 0; i < refN.length; i++) {
    const p = refN[i], q = refN[(i + 1) % refN.length];
    if (Math.abs(p.y) < 1e-6 && Math.abs(q.y) < 1e-6) {
      refTabs.push([Math.min(p.x, q.x), Math.max(p.x, q.x)]);
    }
  }
  const myTabs = [];
  for (let i = 0; i < mineN.length; i++) {
    const p = mineN[i], q = mineN[(i + 1) % mineN.length];
    if (Math.abs(p.y) < 1e-6 && Math.abs(q.y) < 1e-6) {
      myTabs.push([Math.min(p.x, q.x), Math.max(p.x, q.x)]);
    }
  }
  check('the reference has 4 tabs', refTabs.length === 4, refTabs.length);
  check('the plan has 4 tabs', myTabs.length === 4, myTabs.length);
  const tabsMatch = refTabs.every(([a1, b1]) =>
    myTabs.some(([a2, b2]) => Math.abs(a1 - a2) < 1e-3 && Math.abs(b1 - b2) < 1e-3));
  check('each tab sits exactly where the reference puts it', tabsMatch,
    refTabs.map(t => t.map(v => v.toFixed(2)).join('-')).join(' ') + ' vs ' +
    myTabs.map(t => t.map(v => v.toFixed(2)).join('-')).join(' '));

  // the upright slots at the ends: same x span, same depth from the top
  const refY = Math.min(...refN.filter(p => p.x > 2 && p.x < 7).map(p => p.y));
  const myY = Math.min(...mineN.filter(p => p.x > 2 && p.x < 7).map(p => p.y));
  check('the end slot reaches the same depth from the top',
    Math.abs(refY - myY) < 1e-3, refY.toFixed(3) + ' vs ' + myY.toFixed(3));
  check('the end slots are one stock wide, at x = 3..6 and 144..147',
    Math.abs(plan.wall.endSlots[0].x0 - 3) < 1e-9 && Math.abs(plan.wall.endSlots[0].x1 - 6) < 1e-9 &&
    Math.abs(plan.wall.endSlots[1].x0 - 144) < 1e-9 && Math.abs(plan.wall.endSlots[1].x1 - 147) < 1e-9,
    plan.wall.endSlots.map(s => s.x0 + '..' + s.x1).join(' '));
}

// ---------------------------------------------------------------------------
console.log('\n== side wall: knuckle on the outline, plus its pin hole ==');
{
  const sides = groups.filter(g => g.paths.length === 2);
  check('the reference has two knuckled side walls', sides.length === 2, sides.length);
  const refSize = H.bbox([sides[0].paths[0]]);
  check('the reference side wall measures 129.794 x 67.794 including the lobe',
    Math.abs(refSize.w - 129.794) < 0.02 && Math.abs(refSize.h - 67.794) < 0.02,
    refSize.w.toFixed(3) + ' x ' + refSize.h.toFixed(3));

  const mine = combine(api, [plan.side.outline, plan.side.barrelOuter], [plan.side.barrelHole]);
  const mb = H.bbox(mine);
  check('the plan side wall matches that size (within a sampling step)',
    Math.abs(mb.w - refSize.w) < 0.02 && Math.abs(mb.h - refSize.h) < 0.02,
    mb.w.toFixed(3) + ' x ' + mb.h.toFixed(3));

  const refHole = H.bbox([sides[0].paths[1]]);
  check('the reference pin hole is r = 2.145', Math.abs(refHole.w / 2 - 2.145) < 1e-3,
    (refHole.w / 2).toFixed(3));
  check('the plan knuckle is 4.8 outer / 2.145 pin',
    Math.abs(plan.side.barrel.r - 4.8) < 1e-9 && Math.abs(plan.side.barrel.hole - 2.145) < 1e-9,
    plan.side.barrel.r + ' / ' + plan.side.barrel.hole);

  check('two tabs, where the reference has them (7..13.15, 111.85..118)',
    Math.abs(plan.side.tabs[0].x0 - 7) < 1e-9 && Math.abs(plan.side.tabs[0].x1 - 13.15) < 1e-9 &&
    Math.abs(plan.side.tabs[1].x0 - 111.85) < 1e-9 && Math.abs(plan.side.tabs[1].x1 - 118) < 1e-9,
    plan.side.tabs.map(t => t.x0 + '..' + t.x1).join(' '));
  check('two notches open to the bottom edge (4.03..7, 118..120.97)',
    Math.abs(plan.side.notches[0].x0 - 4.03) < 1e-9 &&
    Math.abs(plan.side.notches[0].x1 - 7) < 1e-9 &&
    Math.abs(plan.side.notches[1].x0 - 118) < 1e-9 &&
    Math.abs(plan.side.notches[1].x1 - 120.97) < 1e-9,
    plan.side.notches.map(n => n.x0 + '..' + n.x1).join(' '));
  check('the notches are as deep as the reference (28.688)',
    Math.abs(plan.side.notches[0].y1 - 28.688) < 1e-3, plan.side.notches[0].y1);

  // the ring really is a ring: material minus the pin
  const ringArea = netArea(mine);
  const wantRing = area(plan.side.outline) +
    Math.PI * plan.side.barrel.r * plan.side.barrel.r * 0.5 -
    Math.PI * plan.side.barrel.hole * plan.side.barrel.hole;
  check('the side wall area is the body plus the half-lobe, minus the pin hole',
    Math.abs(ringArea - wantRing) < area(plan.side.outline) * 0.06,
    ringArea.toFixed(1) + ' vs ~' + wantRing.toFixed(1));
}

// ---------------------------------------------------------------------------
console.log('\n== lid: 150 x 128 with a lift scoop ==');
{
  const ref = findGroup(150, 128);
  check('the reference lid was found', !!ref);
  const b = bb(plan.lid.outline);
  check('the lid is L x (W + one stock)', Math.abs(b.w - 150) < 1e-6 && Math.abs(b.h - 128) < 1e-6,
    b.w + ' x ' + b.h);
  // the notches are part of the lid's outline (open to the side edges)
  const edgeYs = (x) => plan.lid.outline.filter(q => Math.abs(q.x - x) < 1e-9).map(q => q.y);
  check('the end notches are open to both side edges, at y 3.375 .. 6.849',
    [0, 150].every(x => {
      const ys = edgeYs(x);
      return ys.some(y => Math.abs(y - 3.375) < 1e-6) && ys.some(y => Math.abs(y - 6.849) < 1e-6);
    }),
    edgeYs(150).join(','));
  check('the scoop spans 10.224 .. 139.776', 
    Math.abs(plan.lid.scoop.x0 - 10.224) < 1e-9 &&
    Math.abs(plan.lid.scoop.x1 - 139.776) < 1e-9,
    plan.lid.scoop.x0 + '..' + plan.lid.scoop.x1);
  check('and is 3.474 deep', Math.abs(plan.lid.scoop.depth - 3.474) < 1e-9, plan.lid.scoop.depth);

  // the reference lid's front edge leaves y = 0 exactly where the scoop starts
  // and ends, so those x values must be in the file
  const raw = ref.raw[0];
  const has = (v) => raw.some(p => Math.abs(p.x - v) < 1e-6);
  check('the reference scoop starts and ends at 10.224 / 139.776',
    has(10.224) && has(139.776),
    raw.filter(p => Math.abs(p.y) < 1e-6).map(p => p.x.toFixed(3)).slice(0, 6).join(','));
  const dipYs = raw.filter(p => p.y > 3.4 && p.y < 3.6);
  check('and it really is a shallow dip, not a cut-out',
    dipYs.length > 1 && Math.max(...dipYs.map(p => p.x)) < 150,
    dipYs.length + ' points at the dip');
}

// ---------------------------------------------------------------------------
// The sheet arrangement: it must sit where the reference file puts it.
// ---------------------------------------------------------------------------
console.log('\n== the sheet is arranged like the reference ==');
{
  // the reference's own transforms, applied to its own path data, then flipped
  // into a y-up world — this is what the file renders
  function refWorld() {
    const out = [];
    const gRe = /<g transform="([^"]+)">([\s\S]*?)<\/g>/g;
    let m;
    while ((m = gRe.exec(svg))) {
      const t = m[1];
      const tx = +(t.match(/translate\(([-0-9.]+)/)[1]);
      const ty = +(t.match(/,\s*([-0-9.]+)\)/)[1]);
      const rot = +(t.match(/rotate\(([-0-9.]+)\)/)[1]) * Math.PI / 180;
      const flip = /scale\(1,-1\)/.test(t) ? -1 : 1;
      const pts = [];
      const pRe = /<path d="([^"]+)"/g;
      let pm;
      while ((pm = pRe.exec(m[2]))) {
        const nums = pm[1].match(/-?\d+(?:\.\d+)?/g) || [];
        for (let i = 0; i + 1 < nums.length; i += 2) {
          const x = +nums[i], y = +nums[i + 1] * flip;
          const xr = x * Math.cos(rot) - y * Math.sin(rot);
          const yr = x * Math.sin(rot) + y * Math.cos(rot);
          pts.push({ x: tx + xr, y: -(ty + yr) });
        }
      }
      out.push({ pts, box: H.bbox([pts]) });
    }
    return out;
  }

  // the same arrangement, built the way the tool builds it
  const W = prm.W;
  const mirror = (pts) => pts.map(q => ({ x: W - q.x, y: q.y }));
  const panels = [
    { key: 'base', mode: 'normal', list: [{ pts: plan.base.outline }] },
    { key: 'lid', mode: 'flipY', list: [{ pts: plan.lid.outline }] },
    { key: 'back', mode: 'normal', list: [{ pts: plan.wall.outline }] },
    { key: 'front', mode: 'flipY', list: [{ pts: plan.wall.outline }] },
    { key: 'left', mode: 'rot90', list: [{ pts: plan.side.outline }, { pts: plan.side.barrelOuter }] },
    { key: 'right', mode: 'rot90flip', list: [{ pts: mirror(plan.side.outline) }, { pts: mirror(plan.side.barrelOuter) }] }
  ];
  for (const p of panels) {
    const xf = (q) => {
      if (p.mode === 'flipY') return { x: q.x, y: -q.y };
      if (p.mode === 'rot90') return { x: -q.y, y: q.x };
      if (p.mode === 'rot90flip') return { x: q.y, y: q.x };
      return { x: q.x, y: q.y };
    };
    p.pts = p.list.flatMap(l => l.pts.map(xf));
    p.box = H.bbox([p.pts]);
  }
  // the column of four, then the two sides level with the base
  const GAP_SHEET = 14;
  let yTop = 0;
  for (const key of ['lid', 'back', 'base', 'front']) {
    const p = panels.find(q => q.key === key);
    p.at = { dx: -p.box.minX, dy: yTop - p.box.maxY };
    yTop -= p.box.h + GAP_SHEET;
  }
  const base = panels.find(q => q.key === 'base');
  for (const key of ['left', 'right']) {
    const p = panels.find(q => q.key === key);
    const dx = key === 'left' ? -GAP_SHEET - p.box.maxX : base.box.w + GAP_SHEET - p.box.minX;
    p.at = { dx, dy: (base.box.maxY + base.at.dy) - p.box.maxY };
  }

  const ref = refWorld();
  const sheetOf = (list) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const b of list) {
      x0 = Math.min(x0, b.minX); x1 = Math.max(x1, b.maxX);
      y0 = Math.min(y0, b.minY); y1 = Math.max(y1, b.maxY);
    }
    return { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0 };
  };
  const mineBoxes = panels.map(p => ({
    w: p.box.w, h: p.box.h,
    minX: p.box.minX + p.at.dx, maxX: p.box.maxX + p.at.dx,
    minY: p.box.minY + p.at.dy, maxY: p.box.maxY + p.at.dy
  }));
  const refBoxes = ref.map(r => r.box);
  const mineSheet = sheetOf(mineBoxes);
  const refSheet = sheetOf(refBoxes);

  check('the sheet is the reference size (313.6 x 415)',
    Math.abs(mineSheet.w - refSheet.w) < 0.1 && Math.abs(mineSheet.h - refSheet.h) < 0.1,
    mineSheet.w.toFixed(2) + ' x ' + mineSheet.h.toFixed(2) + ' vs ' +
    refSheet.w.toFixed(2) + ' x ' + refSheet.h.toFixed(2));

  // every panel must land on the reference panel of the same size, at the same
  // relative spot — that is what "mimics the file" means
  const rel = (b, sheet) => ({
    x0: +(b.minX - sheet.x0).toFixed(1), y0: +(b.minY - sheet.y0).toFixed(1),
    w: +b.w.toFixed(1), h: +b.h.toFixed(1)
  });
  const refRels = refBoxes.map(b => rel(b, refSheet));
  const mineRels = mineBoxes.map(b => rel(b, mineSheet));
  const missing = refRels.filter(rr => !mineRels.some(mr =>
    Math.abs(rr.w - mr.w) < 0.15 && Math.abs(rr.h - mr.h) < 0.15 &&
    Math.abs(rr.x0 - mr.x0) < 0.3 && Math.abs(rr.y0 - mr.y0) < 0.3));
  check('all six panels land where the file puts them', missing.length === 0,
    missing.map(r => `${r.w}x${r.h}@${r.x0},${r.y0}`).join(' '));

  // the four column panels share a column; the side walls flank it
  for (const key of ['lid', 'back', 'base', 'front']) {
    const p = panels.find(q => q.key === key);
    check(key + ' is in the column', Math.abs(p.at.dx + p.box.minX) < 1e-6,
      (p.at.dx + p.box.minX).toFixed(3));
  }
  const left = panels.find(q => q.key === 'left');
  const right = panels.find(q => q.key === 'right');
  check('the side walls flank the base, a gap either side',
    Math.abs((left.at.dx + left.box.maxX) - (-GAP_SHEET)) < 1e-6 &&
    Math.abs((right.at.dx + right.box.minX) - (base.box.w + GAP_SHEET)) < 1e-6,
    (left.at.dx + left.box.maxX).toFixed(2) + ' | ' + (right.at.dx + right.box.minX).toFixed(2));
  check('their tops are level with the base top',
    Math.abs((left.at.dy + left.box.maxY) - (base.at.dy + base.box.maxY)) < 1e-6 &&
    Math.abs((right.at.dy + right.box.maxY) - (base.at.dy + base.box.maxY)) < 1e-6);
  check('the side walls really are turned a quarter turn (taller than wide)',
    left.box.h > left.box.w && right.box.h > right.box.w,
    left.box.w.toFixed(1) + 'x' + left.box.h.toFixed(1));

  // the lid is turned over, so the scoop — the shallow cut along its front edge
  // — ends up on the panel's TOP edge, exactly as the file draws it
  const lid = panels.find(q => q.key === 'lid');
  const lidBox = lid.box;
  const topStrip = lid.pts.filter(q => q.y > lidBox.maxY - plan.lid.scoop.depth - 0.5);
  check('the lid is flipped, so its scoop is on the top edge',
    topStrip.length > 4, topStrip.length + ' points in the scoop band');
  check('and the scoop spans the panel, not one corner',
    topStrip.length && (Math.max(...topStrip.map(q => q.x)) - Math.min(...topStrip.map(q => q.x))) > 100,
    topStrip.length ? (Math.max(...topStrip.map(q => q.x)) - Math.min(...topStrip.map(q => q.x))).toFixed(1) : '-');
}

// ---------------------------------------------------------------------------
// The side wall is a rectangle: a missing top edge used to close it with a
// diagonal straight from (w, top) to (0, bottom), which halved its area.
// ---------------------------------------------------------------------------
console.log('\n== the side wall is a closed rectangle, not a triangle ==');
{
  const body = plan.side.outline;
  const tabs = plan.side.tabs.reduce((a, t) => a + (t.x1 - t.x0) * plan.prm.tabD, 0);
  const notches = plan.side.notches.reduce((a, n) => a + (n.x1 - n.x0) * n.y1, 0);
  const want = prm.W * plan.prm.bodyH + tabs - notches;
  check('its area is the body plus the tabs minus the notches',
    Math.abs(area(body) - want) < 0.5,
    area(body).toFixed(1) + ' vs ' + want.toFixed(1) + ' (a diagonal would be about half)');
  const b = bb(body);
  check('its bounding box is W wide and a full body tall',
    Math.abs(b.w - prm.W) < 1e-6 && Math.abs(b.h - (plan.prm.bodyH + plan.prm.tabD)) < 1e-6,
    b.w.toFixed(2) + ' x ' + b.h.toFixed(2));
  check('the outline reaches the top edge on both sides',
    body.some(q => Math.abs(q.x) < 1e-9 && Math.abs(q.y - plan.prm.bodyH) < 1e-9) &&
    body.some(q => Math.abs(q.x - prm.W) < 1e-9 && Math.abs(q.y - plan.prm.bodyH) < 1e-9));
}

// ---------------------------------------------------------------------------
console.log('\n== it scales with the stock ==');
{
  for (const T of [2, 3, 4, 6]) {
    const p = H.hingePlan({ L: 150, W: 125, H: 60, T });
    const k = T / 3;
    check('t=' + T + ': tab width follows the thickness',
      Math.abs(p.prm.tabW - 6.15 * k) < 1e-9, p.prm.tabW);
    check('t=' + T + ': the corner chamfer follows it',
      Math.abs(p.prm.chamfer - 3.275 * k) < 1e-9, p.prm.chamfer);
    check('t=' + T + ': the knuckle follows it',
      Math.abs(p.prm.barrelR - 4.8 * k) < 1e-9, p.prm.barrelR);
    check('t=' + T + ': the wall body stays H - t',
      Math.abs(p.prm.bodyH - (60 - T)) < 1e-9, p.prm.bodyH);
    check('t=' + T + ': the lid stays one stock deeper than the base',
      Math.abs(p.lid.h - (125 + T)) < 1e-9, p.lid.h);
  }
  const small = H.hingePlan({ L: 150, W: 125, H: 60, T: 3 });
  const large = H.hingePlan({ L: 400, W: 300, H: 80, T: 3 });
  check('a longer wall gets more tabs', large.wall.tabs.length > small.wall.tabs.length,
    small.wall.tabs.length + ' -> ' + large.wall.tabs.length);
}

// ---------------------------------------------------------------------------
console.log('\n== wiring ==');
{
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  check('index.html loads the tool', /tools\/hinge\.js/.test(html));
  check('after the registry, before app.js',
    html.indexOf('tools/registry.js') < html.indexOf('tools/hinge.js') &&
    html.indexOf('tools/hinge.js') < html.indexOf('src="app.js"'));
  check('the tool registers itself', /NS\.register\(\{/.test(src));
  check('the dialog has Create and Cancel', /id="hg-ok"/.test(src) && /id="hg-cancel"/.test(src));
  check('the result is grouped and named',
    /cmdGroupSelection\(\{ noHistory: true \}\)/.test(src) && /wrap\.name =/.test(src));
  check('and remembers its parameters for re-editing',
    /kind: 'hinge'/.test(src) && /params: \{ L, W, H, T \}/.test(src));
  check('every id the code reads exists in the dialog', (() => {
    const ids = new Set();
    for (const m of src.matchAll(/el\('([^']+)'\)/g)) ids.add(m[1]);
    const markup = new Set([...src.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
    return [...ids].every(i => markup.has(i));
  })());
}

console.log('\n' + (fail ? fail + ' FAILED, ' : 'all ') + pass + ' checks passed');
process.exit(fail ? 1 : 0);
