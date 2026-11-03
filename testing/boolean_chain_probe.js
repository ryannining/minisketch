// Probe: closed-spline boolean defects in app.js (Ryan's 3-curve union report).
//
//   bug #1  normalizeSplineWinding()  app.js:11464   ar += ax*by - bx*ay
//   bug #2  loopToBoolCommands()      app.js:11568   ar += ax*by - bx*ay
//
// ax / ay / bx / by are never declared in either function -> ReferenceError on
// every call. cmdBooleanExact catches it (app.js:11880), toasts "Exact boolean
// failed", and silently falls back to Clipper, which flattens + re-fits: the
// garbage geometry. MiniSketch.flipSpline() has the same bug.
//
// Run: node testing/boolean_chain_probe.js
const fs = require('fs');
const path = require('path');
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const C = require(path.join(__dirname, '..', 'core.js'));

function braceEnd(s, from) {
  let d = 0;
  for (let j = s.indexOf('{', from); j < s.length; j++) {
    if (s[j] === '{') d++;
    else if (s[j] === '}') { d--; if (!d) return j + 1; }
  }
  return s.length;
}
function slice(name) {
  const i = appSrc.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('no function ' + name);
  return appSrc.slice(i, braceEnd(appSrc, i));
}
const lineOf = (fn, needle) => {
  const i = appSrc.indexOf('function ' + fn + '(');
  const j = appSrc.indexOf(needle, i);
  return appSrc.slice(0, j).split('\n').length;
};

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

console.log('\n== regression: no bare shoelace left in app.js ==');
{
  const bad = appSrc.split('\n').map((l, i) => [i + 1, l])
    .filter(([, l]) => /ax \* by - bx \* ay/.test(l));
  check('app.js has no `ax * by - bx * ay`', bad.length === 0,
    bad.map(([n]) => 'app.js:' + n).join(', '));
  const good = appSrc.split('\n').map((l, i) => [i + 1, l])
    .filter(([, l]) => /a\.x \* b\.y - b\.x \* a\.y/.test(l));
  console.log('  `a.x * b.y - b.x * a.y` at app.js:' + good.map(([n]) => n).join(', '));
}

// ---- getLoops' own shoelace ------------------------------------------------
console.log('\n== getLoops() area math, run on the real body ==');
{
  // exercise the exact shoelace app.js:7332-7336 uses, taken from the file
  const cps = blob(0, 0, 30, true);
  const hs = C.autoHandles(cps, true);
  const poly = C.splineSamples(cps, hs, true);
  const body = appSrc.slice(appSrc.indexOf('let ar = 0;', appSrc.indexOf('function getLoops(')));
  const line = body.slice(body.indexOf('ar +='), body.indexOf('ar +=') + 40).split('\n')[0];
  const expect = (() => {
    let ar = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      ar += a.x * b.y - b.x * a.y;
    }
    return ar / 2;
  })();
  let got = null, err = null;
  try {
    got = new Function('poly', `let ar = 0;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        ${line.trim().replace(/^ar \+= /, 'ar += ')}
      } return ar / 2;`)(poly);
  } catch (e) { err = e.message; }
  check('getLoops shoelace (`' + line.trim() + '`) runs', !err, err);
  check('getLoops area equals the reference shoelace', Math.abs(got - expect) < 1e-9,
    got + ' vs ' + expect);
}

// ---- the two boolean-path functions, called verbatim ------------------------
function blob(cx, cy, r, cw) {
  const n = 6, p = [];
  for (let i = 0; i < n; i++) {
    const a = (cw ? -1 : 1) * i * 2 * Math.PI / n;
    p.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return p;
}
const shoelace = (q) => {
  let a = 0;
  for (let i = 0; i < q.length; i++) {
    const p = q[i], r = q[(i + 1) % q.length];
    a += p.x * r.y - r.x * p.y;
  }
  return a / 2;
};

function fixture(cw) {
  const cps = blob(0, 0, 30, cw);
  const hs = C.autoHandles(cps, true);
  const state = { points: {}, entities: {}, constraints: {} };
  cps.forEach((p, i) => { state.points[i + 1] = { x: p.x, y: p.y }; });
  const pts = cps.map((p, i) => i + 1);
  state.entities[99] = { id: 99, type: 'spline', pts, hs, closed: true, color: '#000' };
  const poly = C.splineSamples(cps, hs, true);
  return {
    state,
    entity: state.entities[99],
    loop: { splineEntity: 99, ents: [99], poly, area: Math.abs(shoelace(poly)) },
    P: (id) => state.points[+id] || null
  };
}

console.log('\n== both functions, called for real on a closed spline ==');
for (const cw of [true, false]) {
  const f = fixture(cw);
  for (const fn of ['normalizeSplineWinding', 'loopToBoolCommands']) {
    let err = null;
    try {
      if (fn === 'normalizeSplineWinding') {
        new Function('e', 'P', slice(fn) + '\nreturn normalizeSplineWinding(e);')(f.entity, f.P);
      } else {
        new Function('loop', 'P', 'arcData', 'circleData', 'entityPointIds',
          'ensureSplineHandles', 'autoHandles', 'norm2pi', 'BOOL_EPS', 'state',
          slice('normalizeSplineWinding') + '\n' + slice(fn) +
          '\nreturn loopToBoolCommands(loop);')(
          f.loop, f.P, () => null, () => null,
          (e) => (e.pts || []), (e) => e.hs, C.autoHandles, C.norm2pi, 1e-6, f.state);
      }
    } catch (e) { err = e.message; }
    check(fn + ' (' + (cw ? 'CW' : 'CCW') + ' input) throws nothing',
      !err, err);
  }
}

// ---- the intended expression, for reference --------------------------------
console.log('\n== the shoelace both functions meant to write ==');
for (const cw of [true, false]) {
  const cps = blob(0, 0, 30, cw);
  let ar = 0;
  for (let i = 0; i < cps.length; i++) {
    const a = cps[i], b = cps[(i + 1) % cps.length];
    ar += a.x * b.y - b.x * a.y;
  }
  check('shoelace over ' + (cw ? 'CW ' : 'CCW') + ' nodes is ' + (cw ? 'negative' : 'positive'),
    cw ? ar / 2 < 0 : ar / 2 > 0, (ar / 2).toFixed(2));
}

// ---- does PathBool itself behave? (no, the bug is upstream of it) ----------
console.log('\n== PathBool is NOT at fault (independent check) ==');
{
  global.window = {};
  require(path.join(__dirname, '..', 'tools', 'path-bool.js'));
  const PB = global.window.PathBool;
  const cmds = (p) => {
    const h = C.autoHandles(p, true), n = p.length;
    const out = [['M', [p[0].x, p[0].y]]];
    for (let s = 0; s < n; s++) {
      const j = (s + 1) % n;
      out.push(['C', [h.o[s].x, h.o[s].y], [h.i[j].x, h.i[j].y], [p[j].x, p[j].y]]);
    }
    out.push(['Z']);
    return out;
  };
  const toIn = (p) => ({ path: [...PB.pathFromCommands(cmds(p))], fillRule: PB.FillRule.NonZero });
  const A = blob(0, 0, 30, true), B = blob(25, 0, 30, true), Cb = blob(50, 0, 30, true);
  const r1 = new PB.PathBoolean([toIn(A), toIn(B)]).get(PB.PathBooleanOperation.Union);
  const r2 = new PB.PathBoolean([
    { path: [...r1[0]], fillRule: PB.FillRule.NonZero }, toIn(Cb)
  ]).get(PB.PathBooleanOperation.Union);
  const areaOf = (pth) => {
    const pts = [];
    for (const seg of pth) {
      if (!pts.length) pts.push({ x: seg[1][0], y: seg[1][1] });
      for (let i = 1; i <= 16; i++) {
        const q = PB.samplePathSegmentAt(seg, i / 16);
        pts.push({ x: q[0], y: q[1] });
      }
    }
    return shoelace(pts);
  };
  const a2 = Math.abs(areaOf(r2[0]));
  check('PathBool chain 1->2->3 gives one clean loop', r2.length === 1 && r2[0].length === 10,
    'paths=' + r2.length + ' segs=' + r2[0].length);
  check('PathBool area matches the true 3-blob union (~5738)', Math.abs(a2 - 5738) < 200,
    a2.toFixed(1));
}

console.log('\n' + pass + ' pass, ' + fail + ' fail');
console.log('\nCONCLUSION');
console.log('  Every closed-spline boolean throws ReferenceError before PathBool is');
console.log('  reached. cmdBooleanExact catches it at app.js:11880, toasts "Exact');
console.log('  boolean failed" and falls back to Clipper, which flattens to a');
console.log('  polygon and re-fits: the garbage Ryan sees. PathBool on its own');
console.log('  handles the full 1->2->3 chain correctly.');
process.exit(fail ? 1 : 0);
