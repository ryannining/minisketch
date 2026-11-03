// Probe for the Pull top duo tool (tools/pulltop.js).
//
// The tool was built from `ref/pulltopduo_150x100x50mm.svg`, so the check that
// matters is the one against that file: every panel's outline vertex for vertex,
// the pin holes, the two glue marks, and the way the eleven panels are nested on
// the sheet. The reference nests each panel in its own <g> with a transform, so
// the comparison is done in the panel's own (untransformed) coordinates — that
// is exactly the frame the tool's outline builders work in.
//
// Run: node testing/pulltop_probe.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'tools', 'pulltop.js'), 'utf8');
const svg = fs.readFileSync(path.join(root, 'ref', 'pulltopduo_150x100x50mm.svg'), 'utf8');

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};
const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 1e-6 : tol);

// The geometry builders are pure functions over plain points, so they can be
// lifted out of the module and driven directly.
// Everything from the constants through pullTopPlan is pure geometry; the
// dialog section is where the DOM starts, so that is where the block ends.
const block = src.slice(src.indexOf('const NS ='), src.indexOf('// ---- dialog'));
const stub = { MiniSketchTools: { register() {}, close() {} } };
const G = new Function('window', block +
  '\nreturn { pullTopPlan, REF, across, up, bbox };')(stub);

// ---- the reference, in each panel's own coordinates --------------------
const groups = [...svg.matchAll(/<g transform="([^"]+)">([\s\S]*?)<\/g>/g)];
const REF_NAMES = ['base', 'wallTop', 'wallBot', 'sideL', 'sideR',
  'pullA', 'pullB', 'clipA', 'clipB', 'handleA', 'handleB'];
const paths = (g) => [...g.matchAll(/<path d="([^"]+)"[^/]*stroke="([^"]+)"/g)].map(m => ({
  col: m[2],
  pts: [...m[1].matchAll(/[ML]\s*([-\d.]+),([-\d.]+)/g)].map(q => ({ x: +q[1], y: +q[2] }))
}));
const REF = {};
groups.forEach((g, i) => { REF[REF_NAMES[i]] = paths(g[2]); });
const red = (k) => REF[k].filter(p => p.col === '#FF0000');
const green = (k) => REF[k].filter(p => p.col === '#00A651');

const span = (pts) => {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return {
    minX: Math.min(...xs), minY: Math.min(...ys),
    maxX: Math.max(...xs), maxY: Math.max(...ys),
    w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys)
  };
};

// Vertices are compared as a set of rounded coordinates: a panel may carry a
// redundant collinear vertex on either side without being a different part, but
// a missing or invented corner means the shape is wrong.
const sameVerts = (label, mine, ref) => {
  const key = (p) => p.x.toFixed(3) + ',' + p.y.toFixed(3);
  const A = new Set(mine.map(key)), B = new Set(ref.map(key));
  const miss = [...B].filter(k => !A.has(k));
  const extra = [...A].filter(k => !B.has(k));
  check(label + ': every reference vertex is there', miss.length === 0, miss.slice(0, 5).join('  '));
  check(label + ': no invented vertices', extra.length === 0, extra.slice(0, 5).join('  '));
};

const P = G.pullTopPlan({ W: 150, D: 100, H: 50, T: 3 });

console.log('\n-- panel outlines, vertex for vertex --');
sameVerts('Base', P.base.outline, red('base')[0].pts);
sameVerts('Wall', P.wall.outline, red('wallTop')[0].pts);
sameVerts('Side', P.side.outline, red('sideL')[0].pts);
sameVerts('Pull', P.pull.outline, red('pullA')[0].pts);
sameVerts('Clip', P.clip.outline, red('clipA')[0].pts);
sameVerts('Handle', P.handle.outline, red('handleA')[0].pts);

console.log('\n-- panel sizes --');
const sizeOf = (label, pts, ref) => {
  const a = span(pts), b = span(ref);
  check(label + ' is ' + a.w.toFixed(3) + ' x ' + a.h.toFixed(3) +
    ' (reference ' + b.w.toFixed(3) + ' x ' + b.h.toFixed(3) + ')',
    near(a.w, b.w, 0.02) && near(a.h, b.h, 0.02));
};
sizeOf('Base', P.base.outline, red('base')[0].pts);
sizeOf('Wall', P.wall.outline, red('wallTop')[0].pts);
sizeOf('Side', P.side.outline, red('sideL')[0].pts);
sizeOf('Pull', P.pull.outline, red('pullA')[0].pts);
sizeOf('Clip', P.clip.outline, red('clipA')[0].pts);
sizeOf('Handle', P.handle.outline, red('handleA')[0].pts);

console.log('\n-- pin holes --');
const rh = [span(red('sideL')[1].pts), span(red('sideL')[2].pts)];
const mh = P.side.holes.map(span);
check('hole radius ' + (mh[0].w / 2).toFixed(4) + ' (reference ' + (rh[0].w / 2).toFixed(4) + ')',
  near(mh[0].w / 2, rh[0].w / 2, 0.01));
check('hole height ' + mh[0].h.toFixed(4) + ' (reference ' + rh[0].h.toFixed(4) + ')',
  near(mh[0].h, rh[0].h, 0.02));
const cx = (b) => (b.minX + b.maxX) / 2;
check('both hole centres ' + mh.map(b => cx(b).toFixed(3)).sort().join(' / ') +
  ' (reference ' + rh.map(b => cx(b).toFixed(3)).sort().join(' / ') + ')',
  near(Math.min(cx(mh[0]), cx(mh[1])), Math.min(cx(rh[0]), cx(rh[1])), 0.01) &&
  near(Math.max(cx(mh[0]), cx(mh[1])), Math.max(cx(rh[0]), cx(rh[1])), 0.01));
check('hole centre height ' + ((mh[0].minY + mh[0].maxY) / 2).toFixed(3) +
  ' (reference ' + ((rh[0].minY + rh[0].maxY) / 2).toFixed(3) + ')',
  near((mh[0].minY + mh[0].maxY) / 2, (rh[0].minY + rh[0].maxY) / 2, 0.01));
check('holes are 48-sided like the reference', P.side.holes[0].length === 48 &&
  red('sideL')[1].pts.length === 48);

console.log('\n-- glue marks --');
const markOf = (label, mine, ref) => {
  const a = span(mine), b = span(ref);
  check(label + ' is ' + a.w.toFixed(2) + ' x ' + a.h.toFixed(2) +
    ' at (' + a.minX.toFixed(2) + ', ' + a.minY.toFixed(2) + ')' +
    ' (reference ' + b.w.toFixed(2) + ' x ' + b.h.toFixed(2) +
    ' at (' + b.minX.toFixed(2) + ', ' + b.minY.toFixed(2) + '))',
    near(a.w, b.w, 0.02) && near(a.h, b.h, 0.02) &&
    near(a.minX, b.minX, 0.02) && near(a.minY, b.minY, 0.02));
};
markOf('side wall mark', P.side.marking, green('sideL')[0].pts);
markOf('pull mark', P.pull.marking, green('pullA')[0].pts);
check('both sides carry the same mark', REF.sideL.length === REF.sideR.length);
check('the marks are the only non-cut geometry', REF.base.every(p => p.col === '#FF0000'));

console.log('\n-- edge patterns --');
const ac = G.across(150);
check('across 150 starts at 21.429 / 64.286 / 107.143',
  near(ac[0][0], 21.4286, 0.001) && near(ac[1][0], 64.2857, 0.001) && near(ac[2][0], 107.1429, 0.001),
  JSON.stringify(ac));
const up = G.up(50);
check('up 50 starts at 8.696 / 21.739 / 34.783',
  near(up[0][0], 8.6957, 0.001) && near(up[1][0], 21.7391, 0.001) && near(up[2][0], 34.7826, 0.001),
  JSON.stringify(up));
check('tabs take one whole part across', near(ac[0][1] - ac[0][0], 150 / 7));
check('tabs take three whole parts up', near(up[0][1] - up[0][0], 3 * 50 / 23));
const sideUp = G.up(50);
check('the side wall uses the same upright pattern as the wall',
  near(sideUp[1][0], up[1][0]) && near(sideUp[2][0], up[2][0]));

console.log('\n-- the pull sits inside the box --');
check('pull is two stock thicknesses narrower than the box', near(P.prm.pullW, 150 - 2 * 3));
check('pull is 1.2 stock thicknesses shorter than the box', near(P.prm.pullH, 50 - 1.2 * 3));
check('the pull has one tab out of each upright edge',
  P.pull.outline.filter(p => p.x < 0).length === 2 && P.pull.outline.filter(p => p.x > P.prm.pullW).length === 2);
const tabYs = P.pull.outline.filter(p => p.x > P.prm.pullW).map(p => p.y).sort((a, b) => a - b);
check('the tab is one stock thickness tall', near(tabYs[1] - tabYs[0], 3));
check('the tab sits below the pull top edge', tabYs[1] < P.prm.pullH && tabYs[1] > P.prm.pullH - 4);

console.log('\n-- the clip is the shelf the pull rests on --');
check('clip width is 4 stock thicknesses', near(P.prm.clipW, 12));
check('clip height is 8/3 stock thicknesses', near(P.prm.clipH, 8, 0.001), P.prm.clipH);
check('clip top is level with the pull tab top, within a clearance',
  Math.abs(P.prm.clipTop - (P.prm.pullH - P.prm.tabTop + 3 - 3)) < 0.5,
  'clip top ' + P.prm.clipTop.toFixed(3) + ' vs pull tab top ' + (P.prm.pullH - P.prm.tabTop).toFixed(3));
check('the clip is narrower than the pull is long', P.prm.clipW < P.prm.pullW);

console.log('\n-- scaling with stock thickness --');
for (const T of [2, 3, 4, 6]) {
  const q = G.pullTopPlan({ W: 150, D: 100, H: 50, T });
  check('t=' + T + ': pull ' + q.prm.pullW + ' x ' + q.prm.pullH.toFixed(2),
    near(q.prm.pullW, 150 - 2 * T) && near(q.prm.pullH, 50 - 1.2 * T));
  check('t=' + T + ': clip ' + q.prm.clipW + ' x ' + q.prm.clipH.toFixed(2) +
    ', handle ' + q.prm.handleW.toFixed(2) + ' x ' + q.prm.handleH.toFixed(2),
    near(q.prm.clipW, 4 * T, 0.001) && near(q.prm.clipH, 8 * T / 3, 0.001) &&
    near(q.prm.handleW, 40 * T / 3, 0.001) && near(q.prm.handleH, 10 * T / 3, 0.001));
  check('t=' + T + ': pin hole radius ' + q.prm.holeR.toFixed(4),
    near(q.prm.holeR, 2.1213 * T / 3, 0.01));
  check('t=' + T + ': the base still gets three tabs per edge',
    q.base.outline.filter(p => near(p.y, T) && p.x > 0 && p.x < 150).length === 6);
}

console.log('\n-- the sheet is nested like the reference --');
// Reference positions, normalised so the base's own bounding box starts at 0,0
// (the tool re-centres the whole sheet on the view, so only the relative
// placement is meaningful).
const GAP = 14, COL_TOP = 17;
const prm = P.prm;
const sideLeft = -(GAP + 50 + 3);
const colRight = sideLeft - GAP;
const pullDx = colRight - (prm.pullW + 3);
const put = (list, mode, dx, dy) => {
  const pts = [];
  for (const seq of list) {
    for (const p of seq) {
      let q = p;
      if (mode === 'flipY') q = { x: p.x, y: -p.y };
      else if (mode === 'rot90') q = { x: -p.y, y: p.x };
      else if (mode === 'rot90flip') q = { x: p.y, y: p.x };
      pts.push({ x: q.x + dx, y: q.y + dy });
    }
  }
  return span(pts);
};
const boxes = {};
boxes.base = put([P.base.outline], 'normal', 0, 0);
boxes.wallTop = put([P.wall.outline], 'normal', 0, 100 + GAP + 3);
boxes.wallBot = put([P.wall.outline], 'flipY', 0, -(GAP + 3));
boxes.sideL = put([P.side.outline], 'rot90', -(GAP + 3), 0);
boxes.sideR = put([P.side.outline], 'rot90flip', 150 + GAP + 3, 0);
let cur = 100 + COL_TOP;
boxes.pullA = put([P.pull.outline], 'flipY', pullDx, cur); cur -= prm.pullH + GAP;
boxes.pullB = put([P.pull.outline], 'flipY', pullDx, cur); cur -= prm.pullH + GAP;
boxes.clipA = put([P.clip.outline], 'flipY', colRight - prm.clipW, cur);
boxes.clipB = put([P.clip.outline], 'flipY', colRight - 2 * prm.clipW - GAP, cur);
cur -= prm.clipH + GAP;
boxes.handleA = put([P.handle.outline], 'flipY', colRight - prm.handleW, cur);
boxes.handleB = put([P.handle.outline], 'flipY', colRight - 2 * prm.handleW - GAP, cur);

// Where the reference puts each panel, relative to the base.
const WANT = {
  base: [0, 0, 150, 100],
  wallTop: [0, 114, 150, 167],
  wallBot: [0, -67, 150, -14],
  sideL: [-67, 0, -14, 100],
  sideR: [164, 0, 217, 100],
  pullA: [-231, 70.6, -81, 117],
  pullB: [-231, 10.2, -81, 56.6],
  clipA: [-93, -11.8, -81, -3.8],
  clipB: [-119, -11.8, -107, -3.8],
  handleA: [-121, -35.8, -81, -25.8],
  handleB: [-175, -35.8, -135, -25.8]
};
for (const k in WANT) {
  const [x0, y0, x1, y1] = WANT[k], b = boxes[k];
  check(k + ' lands at (' + b.minX.toFixed(2) + ', ' + b.minY.toFixed(2) + ')..(' +
    b.maxX.toFixed(2) + ', ' + b.maxY.toFixed(2) + ')',
    near(b.minX, x0, 0.02) && near(b.minY, y0, 0.02) &&
    near(b.maxX, x1, 0.02) && near(b.maxY, y1, 0.02),
    'reference (' + x0 + ', ' + y0 + ')..(' + x1 + ', ' + y1 + ')');
}

console.log('\n-- wiring --');
const modal = src.slice(src.indexOf('modal:'), src.indexOf('open(api'));
check('registers as pulltopduo', src.includes("id: 'pulltopduo'"));
check('the dialog carries its own ids', modal.includes('id="pulltopduo-modal"') &&
  modal.includes('id="pt-cancel"') && modal.includes('class="btn primary" id="pt-ok"'));
check('every field the apply reads exists in the dialog',
  ['pt-w', 'pt-d', 'pt-h', 'pt-t'].every(id => modal.includes('id="' + id + '"')));
check('stores gen so double click re-opens it', src.includes("wrap.gen = { kind: 'pulltopduo'"));
check('names the group', src.includes('wrap.name ='));
check('exactly one undo step', (src.match(/pushHistory\(\)/g) || []).length === 1);
check('the labels go into the selection with the panels',
  src.includes('api.addNote') && src.includes('madeIds.push(id)'));
check('no green construction colour (it would be dropped from the group)',
  !/#00ff00/i.test(src));

console.log('\n' + (fail ? fail + ' FAILED, ' : '') + pass + ' checks passed');
process.exit(fail ? 1 : 0);
