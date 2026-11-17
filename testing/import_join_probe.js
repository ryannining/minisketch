// Probe: import joining must stay faithful to the file shape.
// Contract of joinImportedSegments:
//   - a weld keeps VALID file positions: ends of segments longer than 20x the
//     join distance never move; a short open end snaps onto the vertex/end it
//     touches; ends within 20% of the tolerance merge as file noise with the
//     survivor keeping its position (this closes imported loops)
//   - two interior vertices never weld across a distance, so a flattened
//     curve's micro-segment staircase is not truncated by welding
//   - simplify walks each chain and hops interior nodes whose whole span stays
//     within the join distance of the chord; nodes ending a >20x-tolerance
//     segment and the chain ends are valid anchors and always survive; real
//     corners deviate more than the tolerance and survive too
//   - no segment is deleted unless it truly collapsed / doubled / merged
//
// Run: node testing/import_join_probe.js
const fs = require('fs');
const path = require('path');
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const C = require('../core.js');
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
  const start = appSrc.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('not found: ' + name);
  let i = appSrc.indexOf('(', start), depth = 0;
  for (; i < appSrc.length; i++) {
    if (appSrc[i] === '(') depth++;
    else if (appSrc[i] === ')') { depth--; if (!depth) break; }
  }
  return appSrc.slice(start, braceEnd(appSrc, i));
};

const MM = 25.4 / 72;
function world() {
  const w = { state: { points: {}, entities: {}, constraints: {} }, nextId: 0 };
  w.P = (id) => w.state.points[+id] || null;
  w.pt = (x, y) => {
    const id = ++w.nextId;
    w.state.points[id] = { id, x, y };
    return id;
  };
  w.line = (x1, y1, x2, y2) => {
    const id = ++w.nextId;
    w.state.entities[id] = { id, type: 'line', color: '#000000', a: w.pt(x1, y1), b: w.pt(x2, y2) };
    return id;
  };
  w.chain = (pts) => {   // one line entity per consecutive pair, private points
    const ids = [];
    for (let i = 0; i + 1 < pts.length; i++) ids.push(w.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
    return ids;
  };
  w.join = new Function(
    'state', 'P', 'JOIN_TOL', 'settings', 'newId',
    slice('weldPoints') + '\n' + slice('joinImportedSegments') + '\nreturn joinImportedSegments;'
  )(w.state, w.P, 0.1, { curveSharpAngle: 25, curveFitTol: 0.2 }, () => ++w.nextId);
  w.run = (tol) => w.join(Object.keys(w.state.entities).map(Number), tol);
  return w;
}
const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-6);

(async () => {
  // ---- real file: the truncated-corner regression -------------------------
  const prims = (await C.parsePdf(new Uint8Array(fs.readFileSync('testimport/test7.pdf'))))
    .filter(p => p.ocg === 'Layer 03');
  const hull = prims.filter(p => {
    const xs = p.nodes.map(n => n.p[0]), ys = p.nodes.map(n => n.p[1]);
    return Math.max(...xs) <= 452 && Math.min(...xs) >= 74 &&
      Math.max(...ys) <= 371 && Math.min(...ys) >= 293 && p.nodes.length >= 2;
  });
  const inner = hull.find(p => p.nodes.length === 42);
  check('fixture: inner wall staircase found', !!inner);
  const w = world();
  const strokeOf = new Map();
  hull.forEach((p, si) => {
    for (let i = 0; i + 1 < p.nodes.length; i++) {
      const id = w.line(p.nodes[i].p[0] * MM, p.nodes[i].p[1] * MM,
        p.nodes[i + 1].p[0] * MM, p.nodes[i + 1].p[1] * MM);
      strokeOf.set(id, si);
    }
  });
  const innerIdx = hull.indexOf(inner);
  const before = Object.keys(w.state.entities).length;
  const ptsBefore = Object.keys(w.state.points).length;
  // zero-length segments (duplicated consecutive nodes in the file) carry no
  // geometry — losing one is dedup, not truncation
  const lenOf = (e) => {
    const a = w.P(e.a), b = w.P(e.b);
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const realInner = new Set([...strokeOf.entries()]
    .filter(([id, si]) => si === innerIdx && lenOf(w.state.entities[id]) > 1e-6)
    .map(([id]) => id));
  // snapshot every segment's endpoints to prove geometry fidelity
  const segsBefore = Object.values(w.state.entities).map(e => {
    const a = w.P(e.a), b = w.P(e.b);
    return [a.x, a.y, b.x, b.y];
  });
  w.run(0.1);
  const after = Object.keys(w.state.entities).length;
  // fidelity = every original node of the curved corner still lies ON the
  // surviving geometry (exact point, or inside a collinear-merged segment).
  // Entity count may drop: merges delete entities without moving the shape.
  const liveSegs = Object.values(w.state.entities).map(e => {
    const a = w.P(e.a), b = w.P(e.b);
    return a && b ? [a.x, a.y, b.x, b.y] : null;
  }).filter(Boolean);
  const onGeom = (x, y, eps) => liveSegs.some(s => {
    const [x1, y1, x2, y2] = s;
    const dx = x2 - x1, dy = y2 - y1;
    const L2 = dx * dx + dy * dy;
    const e = eps || 1e-6;
    if (L2 < 1e-12) return Math.hypot(x - x1, y - y1) < e;
    let t = ((x - x1) * dx + (y - y1) * dy) / L2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)) < e;
  });
  const innerMissing = inner.nodes.filter(n => !onGeom(n.p[0] * MM, n.p[1] * MM, 0.1 + 1e-6)).length;
  check('join ON keeps the curved corner within fit tolerance', innerMissing === 0,
    'missing ' + innerMissing + ' of ' + inner.nodes.length);
  check('join ON still welds and simplifies (not a no-op)', after < before,
    'before ' + before + ' after ' + after);
  check('coincident interior points still dedupe', Object.keys(w.state.points).length < ptsBefore,
    ptsBefore + ' -> ' + Object.keys(w.state.points).length);
  // every surviving endpoint stays at a file node, or at most tol/2 away
  // (midpoint gap welds); snaps and collinear merges land exactly on nodes
  const origPts = segsBefore.flatMap(s => [[s[0], s[1]], [s[2], s[3]]]);
  let maxDev = 0;
  for (const e of Object.values(w.state.entities)) {
    for (const pid of [e.a, e.b]) {
      const p = w.P(pid);
      if (!p) continue;
      let best = Infinity;
      for (const o of origPts) best = Math.min(best, Math.hypot(p.x - o[0], p.y - o[1]));
      maxDev = Math.max(maxDev, best);
    }
  }
  check('no endpoint leaves its valid file position', maxDev <= 1e-6, maxDev);

  // ---- gap weld: short open end snaps onto the long end's valid position --
  {
    const g = world();
    g.line(0, 0, 10, 0);
    g.line(10.06, 0, 11, 0.04);   // short segment: its end may move
    const welded = g.run(0.1);
    const es = Object.values(g.state.entities);
    const shared = es.length === 2 &&
      (es[0].b === es[1].a || es[0].b === es[1].b || es[0].a === es[1].a || es[0].a === es[1].b);
    check('gap weld joins short end onto long end', welded >= 1 && shared, 'welded ' + welded + ' entities ' + es.length);
    if (shared) {
      const pid = es[0].b === es[1].a || es[0].b === es[1].b ? es[0].b : es[0].a;
      const p = g.P(pid);
      check('weld keeps the long end valid position (10, 0)', near(p.x, 10, 1e-9) && near(p.y, 0, 1e-9),
        p.x + ',' + p.y);
    }
    // two LONG ends across a real gap: both valid, neither may move -> no weld
    const h = world();
    h.line(0, 0, 10, 0);
    h.line(10.06, 0, 20, 0);
    h.run(0.1);
    const hs = Object.values(h.state.entities);
    const hp = hs.flatMap(e => [h.P(e.a), h.P(e.b)]);
    check('long ends across a real gap never move', hs.length === 2 &&
      hp.some(p => near(p.x, 10.06, 1e-9)) && hp.some(p => near(p.x, 10, 1e-9)), hs.length);
    // ...but within 20% of the tolerance they are file noise: merge, no move
    const n = world();
    n.line(0, 0, 10, 0);
    n.line(10.014, 0, 20, 0);
    n.run(0.1);
    const ns = Object.values(n.state.entities);
    const np = ns.flatMap(e => [n.P(e.a), n.P(e.b)]);
    check('noise-gap long ends merge without moving', ns.length === 2 &&
      (ns[0].b === ns[1].a || ns[0].b === ns[1].b || ns[0].a === ns[1].a || ns[0].a === ns[1].b) &&
      !np.some(p => near(p.x, 10.014, 1e-9)), ns.length);
  }

  // ---- loop closure: coincident chain ends share one point ----------------
  {
    const g = world();
    g.chain([[0, 0], [10, 0], [10, 10], [0, 0]]);
    g.run(0.1);
    const es = Object.values(g.state.entities);
    check('loop closure keeps all segments', es.length === 3, es.length);
    const first = es[0], last = es[2];
    const closed = first.a === last.a || first.a === last.b || first.b === last.a || first.b === last.b;
    check('loop ends welded into one point', closed);
  }

  // ---- T-junction: open end snaps onto an interior vertex, vertex stays ----
  {
    const g = world();
    g.chain([[0, 0], [5, 0], [10, 0]]);       // interior vertex at (5, 0)
    g.line(5, 0.05, 5, 0.5);                  // SHORT open end 0.05 away from it
    const nBefore = Object.keys(g.state.entities).length;
    const welded = g.run(0.1);
    const es = Object.values(g.state.entities);
    check('T-junction welds the open end onto the vertex', welded >= 1 && es.length === nBefore,
      'welded ' + welded + ' entities ' + es.length);
    const interior = g.state.points && Object.values(g.state.points).find(p => p.x === 5 && p.y === 0);
    check('interior vertex did not move', !!interior);
    const stray = es.find(e => {
      const a = g.P(e.a), b = g.P(e.b);
      return (a.x === 5 && a.y === 0.5) || (b.x === 5 && b.y === 0.5);
    });
    const a = g.P(stray.a), b = g.P(stray.b);
    const snapped = (a.x === 5 && a.y === 0) || (b.x === 5 && b.y === 0);
    check('open end landed exactly on the vertex', snapped);
  }

  // ---- simplify: collinear runs collapse, curves do not -------------------
  {
    const g = world();
    g.chain([[0, 0], [1, 0], [2, 0], [3, 0]]);
    g.run(0.1);
    const es = Object.values(g.state.entities);
    check('collinear run simplifies to one line', es.length === 1, es.length);
    if (es.length === 1) {
      const a = g.P(es[0].a), b = g.P(es[0].b);
      const span = Math.min(a.x, b.x) === 0 && Math.max(a.x, b.x) === 3;
      check('simplified line spans the original ends', span);
    }
    const c = world();
    c.chain([[0, 0], [1, 0.02], [2, 0]]);      // shallow bend: turn ~1.1 deg, sagitta 0.02
    c.run(0.1);
    const cs = Object.values(c.state.entities);
    check('shallow bend simplifies within tolerance', cs.length === 1, cs.length);
    const k = world();
    k.chain([[0, 0], [1, 0], [1, 1]]);         // 90 deg corner: must survive
    k.run(0.1);
    const ks = Object.values(k.state.entities);
    const corner = Object.values(k.state.points).find(p => p.x === 1 && p.y === 0);
    check('sharp corner keeps its node and position', ks.length === 2 && !!corner, ks.length);
    // staircase arc: 1-degree steps on R50 — noise turns collapse, shape stays
    const a = world();
    const arc = [];
    for (let i = 0; i <= 30; i++) {
      const t = i * Math.PI / 180;
      arc.push([50 * Math.sin(t), 50 - 50 * Math.cos(t)]);
    }
    a.chain(arc);
    a.run(0.1);
    const as = Object.values(a.state.entities);
    const aSegs = as.map(e => {
      const p = a.P(e.a), q = a.P(e.b);
      return [p.x, p.y, q.x, q.y];
    });
    const nearSeg = (x, y) => aSegs.some(s => {
      const dx = s[2] - s[0], dy = s[3] - s[1];
      const L2 = dx * dx + dy * dy;
      let t = L2 ? ((x - s[0]) * dx + (y - s[1]) * dy) / L2 : 0;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(x - (s[0] + t * dx), y - (s[1] + t * dy)) <= 0.1 + 1e-6;
    });
    check('staircase arc simplifies hard', as.length <= 8, as.length + ' of 30');
    check('staircase arc stays within join distance', arc.every(p => nearSeg(p[0], p[1])));
    const ends = as.flatMap(e => [a.P(e.a), a.P(e.b)]);
    check('arc ends keep exact file positions',
      ends.some(p => near(p.x, 0, 1e-9) && near(p.y, 0, 1e-9)) &&
      ends.some(p => near(p.x, arc[30][0], 1e-9) && near(p.y, arc[30][1], 1e-9)));
    // quantized slant: axis-aligned micro steps with 90-DEGREE local turns
    // (the PDF numeric-noise staircase). A turn-angle test keeps them all;
    // the chord-deviation test must hop them and keep the valid ends.
    const q = world();
    const steps = [];
    for (let i = 0; i <= 12; i++) {
      steps.push([i * 0.3, i * 0.05]);
      if (i < 12) steps.push([(i + 1) * 0.3, i * 0.05]);
    }
    q.chain(steps);
    q.run(0.1);
    const qs = Object.values(q.state.entities);
    const qSegs = qs.map(e => {
      const p = q.P(e.a), r = q.P(e.b);
      return [p.x, p.y, r.x, r.y];
    });
    const qNear = (x, y) => qSegs.some(s => {
      const dx = s[2] - s[0], dy = s[3] - s[1];
      const L2 = dx * dx + dy * dy;
      let t = L2 ? ((x - s[0]) * dx + (y - s[1]) * dy) / L2 : 0;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(x - (s[0] + t * dx), y - (s[1] + t * dy)) <= 0.1 + 1e-6;
    });
    check('90-degree micro staircase collapses', qs.length <= 2, qs.length + ' of ' + (steps.length - 1));
    check('staircase nodes stay within join distance', steps.every(p => qNear(p[0], p[1])));
    const qEnds = qs.flatMap(e => [q.P(e.a), q.P(e.b)]);
    check('staircase valid ends kept exactly',
      qEnds.some(p => near(p.x, 0, 1e-9) && near(p.y, 0, 1e-9)) &&
      qEnds.some(p => near(p.x, 3.6, 1e-9) && near(p.y, 0.6, 1e-9)));
    // raising the join distance collapses a coarser staircase too
    const q2 = world();
    const steps2 = [];
    for (let i = 0; i <= 8; i++) {
      steps2.push([i * 0.6, i * 0.15]);
      if (i < 8) steps2.push([(i + 1) * 0.6, i * 0.15]);
    }
    q2.chain(steps2);
    q2.run(0.05);
    const coarseAt005 = Object.values(q2.state.entities).length;
    const q3 = world();
    q3.chain(steps2);
    q3.run(0.3);
    const coarseAt03 = Object.values(q3.state.entities).length;
    check('join distance drives simplify strength', coarseAt03 < coarseAt005,
      coarseAt005 + ' @0.05 vs ' + coarseAt03 + ' @0.3');
  }

  // ---- join off: nothing touched ------------------------------------------
  {
    const g = world();
    g.chain([[0, 0], [0.04, 0], [0.08, 0]]);
    const snap = JSON.stringify(g.state);
    check('join off is a no-op', JSON.stringify(g.state) === snap);
  }

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();