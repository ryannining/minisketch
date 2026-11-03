// Probe for the Slide top tool (tools/slidetop.js).
//
// The tool was built from `ref/slidetop_100x100x120mm.svg`, so the check that
// matters is the one against that file: every panel's shape, its tabs and slots,
// the glue mark and the way the sheet is nested. Shapes are compared by sampling
// the region rather than by matching vertex lists, because a panel may carry
// redundant collinear vertices on either side without being a different part.
//
// Run: node testing/slidetop_probe.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'tools', 'slidetop.js'), 'utf8');
const svg = fs.readFileSync(path.join(root, 'ref', 'slidetop_100x100x120mm.svg'), 'utf8');
const C = require(path.join(root, 'core.js'));

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};
const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 1e-6 : tol);

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

const NAMES = ['baseOutline', 'wallOutline', 'sideOutline',
  'markOutline', 'lidOutline', 'railOutline', 'slidePlan'];
// the pattern helpers (div / across / up / bbox) are consts, so they come in
// with the source block rather than through slice()
const consts = src.slice(src.indexOf('const NS ='), src.indexOf('// ---- edge patterns')) +
  src.slice(src.indexOf('// ---- edge patterns'), src.indexOf('// ---- panel outlines'));
const H = new Function('window', consts + NAMES.map(slice).join('\n') +
  '\nreturn {' + NAMES.concat(['bbox']).join(',') + '};')({ MiniSketchTools: {} });

const area = (pts) => Math.abs(C.signedAreaPts(pts));
// the file rounds every coordinate to 3 decimals, so areas cannot match
// better than ~0.05 mm2; a missing slot would be 40+ mm2
const sameArea = (a, b) => Math.abs(area(a) - area(b)) < 0.05;

// ---------------------------------------------------------------------------
// Parse the reference: the path numbers in each group's own frame (all panels
// are drawn with the same local convention: tabs below y = 0, y up), plus the
// transform that places that group on the sheet.
// ---------------------------------------------------------------------------
function transform(str) {
  const ops = [...str.matchAll(/(translate|rotate|scale)\(([^)]*)\)/g)]
    .map(m => ({ op: m[1], v: m[2].split(',').map(Number) }));
  return (p) => {
    let x = p.x, y = p.y;
    for (let i = ops.length - 1; i >= 0; i--) {
      const { op, v } = ops[i];
      if (op === 'translate') { x += v[0]; y += v[1] || 0; }
      else if (op === 'scale') { x *= v[0]; y *= (v[1] === undefined ? v[0] : v[1]); }
      else {
        const a = v[0] * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
        const nx = c * x - s * y, ny = s * x + c * y;
        x = nx; y = ny;
      }
    }
    return { x, y };
  };
}

function parseSvg(text) {
  const groups = [];
  const gRe = /<g transform="([^"]+)">([\s\S]*?)<\/g>/g;
  let m;
  while ((m = gRe.exec(text))) {
    const tf = transform(m[1]);
    const paths = [];
    const pRe = /<path d="([^"]+)"([^>]*)>/g;
    let pm;
    while ((pm = pRe.exec(m[2]))) {
      const nums = pm[1].match(/-?\d+(?:\.\d+)?/g) || [];
      const pts = [];
      for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: +nums[i], y: +nums[i + 1] });
      const stroke = (/stroke="([^"]+)"/.exec(pm[2]) || [])[1] || '';
      if (pts.length >= 3) paths.push({ pts, stroke });
    }
    // the sheet position in a y-up world (the file's y runs down)
    const placed = paths.map(p => p.pts.map(q => {
      const w = tf(q);
      return { x: w.x, y: -w.y };
    }));
    const own = paths.map(p => p.pts);
    groups.push({
      transform: m[1],
      paths: own,
      strokes: paths.map(p => p.stroke),
      placed,
      box: H.bbox(placed)
    });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Shape comparison: sample a grid over the union of both boxes and require the
// two polygons to agree on inside/outside everywhere that is not on an edge.
// ---------------------------------------------------------------------------
function distToEdges(p, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 1e-12 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const q = { x: a.x + t * dx, y: a.y + t * dy };
    best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y));
  }
  return best;
}

function sameRegion(a, b, steps) {
  const ba = H.bbox([a]), bbb = H.bbox([b]);
  const x0 = Math.min(ba.minX, bbb.minX) - 1, x1 = Math.max(ba.maxX, bbb.maxX) + 1;
  const y0 = Math.min(ba.minY, bbb.minY) - 1, y1 = Math.max(ba.maxY, bbb.maxY) + 1;
  const n = steps || 140;
  let differ = 0;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const p = { x: x0 + (x1 - x0) * i / n, y: y0 + (y1 - y0) * j / n };
      if (Math.min(distToEdges(p, a), distToEdges(p, b)) < 0.06) continue;
      if (C.pointInPoly(p, a) !== C.pointInPoly(p, b)) differ++;
    }
  }
  return differ;
}

// ---------------------------------------------------------------------------
const groups = parseSvg(svg);
let RUN = null;
const findGroup = (w, h, n) => groups.find(g => {
  const b = g.box;
  return near(b.w, w, 0.02) && near(b.h, h, 0.02) && (n == null || g.paths.length === n);
});

const PLAN = H.slidePlan({ W: 100, D: 100, H: 120, T: 3 });
const BASE_G = findGroup(100, 100, 1);
const FRONT_G = findGroup(100, 123, 1);        // body 120 + the 3 mm tabs
const BACK_G = findGroup(100, 116.35, 1);      // body 113.35 + the tabs
const SIDE_G = findGroup(123, 100, 2);
const LID_G = findGroup(93.4, 102, 1);         // 97 body + the 5 mm bow
const RAIL_G = findGroup(94, 10.2, 1);

RUN = runTool();

console.log('\n== the reference file ==');
{
  check('eight panel groups parse out of it', groups.length === 8, groups.length);
  check('one is the base (100 x 100)', !!BASE_G);
  check('two walls at 100 wide (120 and 113.35 deep)', !!FRONT_G && !!BACK_G);
  check('the two side walls carry a second path: the glue mark', !!SIDE_G &&
    SIDE_G.paths.length === 2, SIDE_G && SIDE_G.paths.length);
  check('the mark is the only non-red path in the file',
    groups.filter(g => g.strokes.some(s => s.toLowerCase() !== '#ff0000')).length === 2,
    groups.map(g => g.strokes.join('/')).join(' | '));
  check('one slide and two rails', !!LID_G && !!RAIL_G &&
    groups.filter(g => near(g.box.w, 94, 0.02) && near(g.box.h, 10.2, 0.02)).length === 2);
}

console.log('\n== base ==');
{
  const ref = BASE_G.paths[0];
  const mine = PLAN.base.outline;
  check('size W x D', near(PLAN.base.w, 100) && near(PLAN.base.h, 100));
  check('the shape matches the file', sameRegion(ref, mine) === 0, sameRegion(ref, mine) + ' samples differ');
  check('same area', sameArea(mine, ref), area(mine) + ' vs ' + area(ref));
  check('twelve slots (three per edge), notches cut into the edge',
    PLAN.prm.acrossW.length === 3 && PLAN.prm.acrossD.length === 3 &&
    sameRegion(ref, mine) === 0);
  const r = BASE_G.placed[0].map(p => p);
  check('a slot on the bottom edge starts a seventh of the way in',
    near(PLAN.prm.acrossW[0][0], 100 / 7, 1e-9) && near(PLAN.prm.acrossW[0][1], 200 / 7, 1e-9),
    PLAN.prm.acrossW[0].join('..'));
  check('the plate is not symmetric by accident: every edge pattern is the same',
    JSON.stringify(PLAN.prm.acrossW) === JSON.stringify(PLAN.prm.acrossD));
  void r;
}

console.log('\n== front wall ==');
{
  const ref = FRONT_G.paths[0];
  const mine = PLAN.front.outline;
  check('body is W x H', near(PLAN.front.w, 100) && near(PLAN.front.h, 120));
  check('the shape matches the file', sameRegion(ref, mine) === 0, sameRegion(ref, mine) + ' samples differ');
  check('same area', sameArea(mine, ref), area(mine) + ' vs ' + area(ref));
  check('three tabs stand out below the body', (() => {
    const b = H.bbox([mine]);
    return near(b.minY, -3) && near(b.maxY, 120) && b.h === 123;
  })(), JSON.stringify(H.bbox([mine])));
  check('the upright slots start below the rail band',
    near(PLAN.prm.upSlots[0][0], 19.0957, 1e-3), PLAN.prm.upSlots[0][0]);
  check('and stop 10.2 mm short of the top',
    near(120 - PLAN.prm.upSlots[2][1], 29.2957, 1e-3), 120 - PLAN.prm.upSlots[2][1]);
}

console.log('\n== back wall (the lower one) ==');
{
  const ref = BACK_G.paths[0];
  const mine = PLAN.back.outline;
  check('body is W x (H - tongue - step)', near(PLAN.prm.backH, 113.35, 1e-9), PLAN.prm.backH);
  check('the shape matches the file', sameRegion(ref, mine) === 0, sameRegion(ref, mine) + ' samples differ');
  check('same area', sameArea(mine, ref), area(mine) + ' vs ' + area(ref));
  check('its slots line up with the front wall (same pattern from H)',
    JSON.stringify(PLAN.prm.upSlots).length > 0 &&
    sameRegion(ref, mine) === 0);
}

console.log('\n== side walls ==');
{
  const ref = SIDE_G.paths[0];
  const mine = PLAN.side.outline;
  check('the body is D - 2t wide, the tabs reach the full D',
    near(PLAN.prm.sideW, 94) && (() => {
      const b = H.bbox([mine]);
      return near(b.minX, 0) && near(b.maxX, 100) && near(b.h, 123);
    })(), JSON.stringify(H.bbox([mine])));
  check('the shape matches the file', sameRegion(ref, mine) === 0, sameRegion(ref, mine) + ' samples differ');
  check('same area', sameArea(mine, ref), area(mine) + ' vs ' + area(ref));

  // the mark: exact vertices, in the panel's own frame
  const refMark = SIDE_G.paths[1];
  const mineMark = PLAN.side.marking;
  check('the glue mark is eight points', refMark.length === 8 && mineMark.length === 8);
  check('and lands on exactly the same vertices', (() => {
    const key = (p) => Math.round(p.x * 1e4) + ',' + Math.round(p.y * 1e4);
    const a = refMark.map(key).sort().join(' ');
    const b = mineMark.map(key).sort().join(' ');
    return a === b;
  })(), refMark.map(p => p.x + ',' + p.y).join(' ') + ' vs ' + mineMark.map(p => p.x + ',' + p.y).join(' '));
  check('the mark sits in the top band, one step wide',
    (() => {
      const b = H.bbox([mineMark]);
      return near(b.minY, 109.8, 1e-9) && near(b.maxY, 120) && near(b.h, 10.2);
    })(), JSON.stringify(H.bbox([mineMark])));
  void ref;
}

console.log('\n== slide ==');
{
  const ref = LID_G.paths[0];
  const mine = PLAN.lid.outline;
  check('size (D - 2t - clearance) x (D - t)',
    near(PLAN.prm.lidW, 93.4) && near(PLAN.prm.lidH, 97), PLAN.prm.lidW + ' x ' + PLAN.prm.lidH);
  check('the shape matches the file', sameRegion(ref, mine) === 0, sameRegion(ref, mine) + ' samples differ');
  check('same area', sameArea(mine, ref), area(mine) + ' vs ' + area(ref));
  check('the leading edge follows the reference sample points exactly', (() => {
    for (let i = 0; i < ref.length; i++) {
      if (!near(mine[i].x, ref[i].x, 2e-3) || !near(mine[i].y, ref[i].y, 2e-3)) return false;
    }
    return true;
  })(), JSON.stringify(mine.slice(0, 4)));
  check('the tongue is tongueH tall and inset at both ends',
    (() => {
      const b = H.bbox([mine]);
      const top = mine.filter(p => near(p.y, 97));
      return near(b.maxY, 97) && near(b.minY, -5) &&
        near(Math.min(...top.map(p => p.x)), 3.2) && near(Math.max(...top.map(p => p.x)), 90.2);
    })(), JSON.stringify(H.bbox([mine])));
}

console.log('\n== rails ==');
{
  const ref = RAIL_G.paths[0];
  const mine = PLAN.rail.outline;
  check('rail is D - 2t long and railH deep',
    near(PLAN.rail.w, 94) && near(PLAN.rail.h, 10.2), PLAN.rail.w + ' x ' + PLAN.rail.h);
  check('the profile matches the file', sameRegion(ref, mine, 90) === 0, sameRegion(ref, mine, 90) + ' samples differ');
  check('same area', sameArea(mine, ref), area(mine) + ' vs ' + area(ref));
  check('the groove floor is one step above the tongue',
    near(PLAN.prm.tongueH, 3.55, 1e-9) && near(PLAN.prm.stepH, 3.1, 1e-9));
}

console.log('\n== the sheet is nested like the file ==');
{
  // Reference world boxes, shifted so the base starts at the origin.
  const sideGs = groups.filter(g => near(g.box.w, 123, 0.02) && near(g.box.h, 100, 0.02));
  const railGs = groups.filter(g => near(g.box.w, 94, 0.02) && near(g.box.h, 10.2, 0.02));
  const gs = [BASE_G, FRONT_G, BACK_G, sideGs[0], sideGs[1], LID_G, railGs[0], railGs[1]];
  const base = BASE_G.box;
  const refBox = (g) => ({
    minX: g.box.minX - base.minX, maxX: g.box.maxX - base.minX,
    minY: g.box.minY - base.minY, maxY: g.box.maxY - base.minY
  });
  const ref = gs.map(refBox);

  // The tool's own placement, run through apply() with a fake document.
  const run = RUN;
  const placed = run.items;
  check('ten contours (eight panels, two marks) plus eight labels',
    run.entities.length === 10 && run.notes.length === 8,
    run.entities.length + ' / ' + run.notes.length);
  check('two panels are drawn red (the glue marks)',
    run.entities.filter(e => e.color === '#ff0000').length === 2,
    run.entities.map(e => e.color).join(' '));
  check('everything else is the current colour',
    run.entities.filter(e => e.color !== '#ff0000').every(e => e.color === '#000000'));

  // both sides are compared with the base at the origin: the sheet is centred
  // on the view, which is ours to choose
  const baseAt = placed[0];
  const toolBox = (i) => {
    const it = placed[i];
    return {
      minX: it.minX - baseAt.minX, maxX: it.maxX - baseAt.minX,
      minY: it.minY - baseAt.minY, maxY: it.maxY - baseAt.minY
    };
  };
  const names = placed.map(it => it.name);
  check('the panels are named', names.join('|') ===
    'Base|Front|Back|Left side|Right side|Slide|Rail|Rail', names.join('|'));

  let worst = 0, worstName = '';
  for (let i = 0; i < ref.length; i++) {
    const t = toolBox(i);
    const d = Math.max(
      Math.abs(t.minX - ref[i].minX), Math.abs(t.maxX - ref[i].maxX),
      Math.abs(t.minY - ref[i].minY), Math.abs(t.maxY - ref[i].maxY));
    if (d > worst) { worst = d; worstName = names[i]; }
  }
  check('every panel lands where the file puts it', worst < 0.02, worst.toFixed(4) + ' mm off (' + worstName + ')');
  check('the walls sit one gap clear of the base', (() => {
    const base2 = { minX: 0, maxX: 100, minY: 0, maxY: 100 }, front = toolBox(1), back = toolBox(2);
    return near(front.minY - base2.maxY, 14, 1e-6) && near(base2.minY - back.maxY, 14, 1e-6);
  })());
  check('the side walls flank it, tops level with the base', (() => {
    const base2 = { minX: 0, maxX: 100, minY: 0, maxY: 100 }, left = toolBox(3), right = toolBox(4);
    return near(base2.minX - left.maxX, 14, 1e-6) && near(right.minX - base2.maxX, 14, 1e-6) &&
      near(left.maxY, base2.maxY, 1e-6) && near(right.maxY, base2.maxY, 1e-6);
  })());
  check('the slide and rails are in their own column, left of the sides', (() => {
    const left = toolBox(3), lid = toolBox(5), r1 = toolBox(6), r2 = toolBox(7);
    return lid.maxX < left.minX && r1.maxX < left.minX + 1 &&
      near(left.minX - lid.maxX, 14, 1e-6) && r1.maxY < lid.minY && r2.maxY < r1.minY;
  })());
  check('the whole sheet is centred on the view', (() => {
    const b = run.sheet;
    return near((b.minX + b.maxX) / 2, run.view.x, 1e-6) && near((b.minY + b.maxY) / 2, run.view.y, 1e-6);
  })(), JSON.stringify(run.sheet));
}

console.log('\n== scales with the stock ==');
{
  for (const T of [2, 3, 6]) {
    const p = H.slidePlan({ W: 150, D: 120, H: 100, T });
    check('t=' + T + ': the rail band and the groove follow the stock',
      near(p.prm.railH, 10.2 * T / 3, 1e-9) && near(p.prm.tongueH, 3.55 * T / 3, 1e-9),
      p.prm.railH + ' / ' + p.prm.tongueH);
    check('t=' + T + ': the side body stays D - 2t', near(p.prm.sideW, 120 - 2 * T, 1e-9));
    check('t=' + T + ': the back wall stays tongue + step lower than the front',
      near(p.prm.backH, 100 - (3.55 + 3.1) * T / 3, 1e-9), p.prm.backH);
    check('t=' + T + ': the lid clears the opening', p.prm.lidW < p.prm.sideW);
  }
  const big = H.slidePlan({ W: 300, D: 200, H: 150, T: 3 });
  check('a bigger box keeps three tabs per edge (the pattern is proportional)',
    big.prm.acrossW.length === 3 && near(big.prm.acrossW[0][0], 300 / 7, 1e-9));

  // a stock that would eat the whole height is pulled back in apply(), so the
  // plan never sees one; check the geometry stays sane just below that limit
  const squat = H.slidePlan({ W: 60, D: 50, H: 30, T: 30 / 10.2 });
  check('a squat box still has a wall left below the rail band',
    squat.prm.upSlots.length === 3 && squat.prm.backH > 0 &&
    squat.prm.upSlots[2][1] < 30 - squat.prm.railH + 1e-9,
    squat.prm.backH);
  check('and every panel is a simple, non-empty loop', (() => {
    for (const p of [squat.base.outline, squat.front.outline, squat.back.outline,
      squat.side.outline, squat.side.marking, squat.lid.outline, squat.rail.outline]) {
      if (area(p) <= 0) return false;
    }
    return true;
  })());
}

console.log('\n== wiring ==');
{
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  check('index.html loads the tool', /tools\/slidetop\.js/.test(html));
  check('after the registry, before app.js',
    html.indexOf('tools/registry.js') < html.indexOf('tools/slidetop.js') &&
    html.indexOf('tools/slidetop.js') < html.indexOf('src="app.js"'));
  check('the tool registers itself', /NS\.register\(\{/.test(src));
  check('the dialog has Create and Cancel', /id="st-ok"/.test(src) && /id="st-cancel"/.test(src));
  check('the result is grouped and named',
    /cmdGroupSelection\(\{ noHistory: true \}\)/.test(src) && /wrap\.name =/.test(src));
  check('and remembers its parameters for re-editing',
    /kind: 'slidetop'/.test(src) && /params: \{ W, D, H, T \}/.test(src));
  check('the labels go into the selection, so they ride with the group',
    RUN.grouped.filter(t => t === 'note').length === 8,
    RUN.grouped.filter(t => t === 'note').length);
  check('every id the code reads exists in the dialog', (() => {
    const ids = new Set([...src.matchAll(/el\('([^']+)'\)/g)].map(m => m[1]));
    const markup = new Set([...src.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
    return [...ids].every(i => markup.has(i));
  })(), [...new Set([...src.matchAll(/el\('([^']+)'\)/g)].map(m => m[1]))].join(' '));
  check('one undo step for the whole sheet', RUN.history === 1, RUN.history);
  check('the labels carry the panel size, not the tab-inclusive footprint',
    RUN.notes.map(n => n.text).join(' | ') ===
    'Base \u00b7 100\u00d7100mm | Front \u00b7 100\u00d7120mm | Back \u00b7 100\u00d7113.35mm | ' +
    'Left side \u00b7 100\u00d7120mm | Right side \u00b7 100\u00d7120mm | Slide \u00b7 93.4\u00d797mm | ' +
    'Rail \u00b7 94\u00d710.2mm | Rail \u00b7 94\u00d710.2mm',
    RUN.notes.map(n => n.text).join(' | '));
}

// ---------------------------------------------------------------------------
// Run the tool's apply() against a fake document and collect what it produced.
function runTool() {
  const store = {};
  const fields = {};
  const el = (id) => (fields[id] = fields[id] || {
    value: id === 'st-w' ? '100' : id === 'st-d' ? '100' : id === 'st-h' ? '120' : '3',
    focus() {}, classList: { add() {}, remove() {} }
  });
  const document = {
    getElementById: (id) => (id.endsWith('-modal')
      ? { classList: { add() {}, remove() {} } }
      : el(id))
  };
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); }
  };
  const win = { MiniSketchTools: { list: [], register(t) { this.list.push(t); }, close() {}, open() {} } };
  const out = {
    entities: [], notes: [], grouped: [], history: 0, items: [], sheet: null, view: { x: 0, y: 0 }
  };
  const state = { points: {}, entities: {}, nextId: 0 };
  const api = {
    get state() { return state; },
    ui: { color: '#000000', selection: [] },
    settings: { noteSize: 3 },
    clamp: C.clamp, fmt: (n) => String(Math.round(n * 100) / 100),
    newId: () => ++state.nextId,
    s2w: (x, y) => ({ x: x - 640, y: -(y - 400) }),
    getW: () => 1280, getH: () => 800,
    addPanelEntity: (pts, color) => {
      out.entities.push({ color, pts: pts.map(p => ({ x: p.x, y: p.y })) });
      const id = ++state.nextId;
      state.entities[id] = { id, type: 'spline' };
      return id;
    },
    addNote: (text, x, y) => {
      out.notes.push({ text, x, y });
      const id = ++state.nextId;
      state.entities[id] = { id, type: 'note' };
      return id;
    },
    pushHistory: () => { out.history++; },
    commit: () => {},
    toast: () => {},
    cmdGroupSelection: () => {
      out.grouped = api.ui.selection.map(q => state.entities[q.id] && state.entities[q.id].type);
    }
  };
  out.view = api.s2w(640, 400);
  new Function('window', 'document', 'localStorage', src)(win, document, localStorage);
  win.MiniSketchTools.list[0].apply(api);
  const names = ['Base', 'Front', 'Back', 'Left side', 'Right side', 'Slide', 'Rail', 'Rail'];
  out.items = out.entities.filter(e => e.color !== '#ff0000').map((e, i) => {
    const b = H.bbox([e.pts]);
    return { name: names[i], ...b };
  });
  const all = out.entities.flatMap(e => e.pts);
  out.sheet = H.bbox([all]);
  return out;
}

console.log('\n' + (fail ? fail + ' FAILED, ' : '') + pass + ' checks passed');
process.exit(fail ? 1 : 0);
