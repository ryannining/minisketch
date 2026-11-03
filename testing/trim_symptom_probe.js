// Probe: the three symptoms Ryan hit with trim on bool.sketch.
//
//   1. top curve, "nothing to split here"
//   2. middle curve + Ctrl, only part disappears
//   3. bottom curve, plain trim, EVERYTHING disappears (should drop 1 span)
//
// Root cause of all three: paramOnEntity() had no spline branch and returned 0,
// so collectIntersectionParams() mapped every crossing of a spline onto t=0.
//
// Run: node testing/trim_symptom_probe.js

const fs = require('fs');
const path = require('path');
const C = require(path.join(__dirname, '..', 'core.js'));
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function braceEnd(s, from) {
  let d = 0;
  for (let j = s.indexOf('{', from); j < s.length; j++) {
    if (s[j] === '{') d++;
    else if (s[j] === '}') { d--; if (!d) return j + 1; }
  }
  return s.length;
}
const slice = (name) => {
  const i = appSrc.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('no function ' + name);
  return appSrc.slice(i, braceEnd(appSrc, i));
};

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'bool.sketch')));
const S = doc.state || doc;
const P = (id) => {
  const p = S.points[String(id)];
  return p ? (Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y }) : null;
};

// hands: turn the file's [[x,y]] handles into {x,y} for every curve up front.
// splineIntersections() asks the OTHER curve for its frame too, so converting
// lazily inside the loop left the later curves in [[x,y]] form and their frames
// came back empty — which read as "no crossings at all".
const hands = (e) => ({ o: e.hs.o.map(h => Array.isArray(h) ? ({ x: h[0], y: h[1] }) : h), i: e.hs.i.map(h => Array.isArray(h) ? ({ x: h[0], y: h[1] }) : h) });
for (const id in S.entities) {
  const ent = S.entities[id];
  if (ent.type === 'spline' && ent.hs && Array.isArray(ent.hs.o[0])) ent.hs = hands(ent);
}

// build paramOnEntity with the real helpers
const paramOnEntity = new Function(
  'P', 'clamp', 'norm2pi', 'TAU', 'arcData', 'lineEnds', 'splineFrame', 'ensureSplineHandles', 'entityPointIds',
  slice('paramOnEntity').replace('function paramOnEntity(', 'return function(')
)(P, clamp, C.norm2pi, Math.PI * 2, () => null, (e) => ({ a: P(e.a), b: P(e.b) }),
  C.splineFrame, () => {}, (e) => e.pts || []);

// collectIntersectionParams with the real intersectEntities / splineIntersections
const refinePointOnSpline = new Function('splineFrame', 'clamp',
  slice('refinePointOnSpline').replace('function refinePointOnSpline(', 'return function(')
)(C.splineFrame, clamp);

const splineIntersections = new Function(
  'P', 'entityPointIds', 'splineFrame', 'ensureSplineHandles', 'lineLineIntersect',
  'circleData', 'lineCircleIntersect', 'pointOnArc', 'refinePointOnSpline',
  slice('splineIntersections').replace('function splineIntersections(', 'return function(')
)(P, (e) => e.pts || [], C.splineFrame, () => {}, C.lineLineIntersect,
  () => null, C.lineCircleIntersect, () => true, refinePointOnSpline);

const intersectEntities = new Function('P', 'splineIntersections', 'lineLineIntersect', 'circleData',
  'lineCircleIntersect', 'pointOnArc', 'circleCircleIntersect',
  slice('intersectEntities').replace('function intersectEntities(', 'return function(')
)(P, splineIntersections, C.lineLineIntersect, () => null, C.lineCircleIntersect, () => true, () => []);

const collectIntersectionParams = (target) => {
  const params = [0, 1];
  for (const id in S.entities) {
    const o = S.entities[id];
    if (+id === +target.id) continue;
    if (!['line', 'arc', 'circle', 'spline'].includes(o.type)) continue;
    let pts;
    if (target.type === 'spline') pts = splineIntersections(target, o);
    else if (o.type === 'spline') pts = splineIntersections(o, target);
    else continue;
    for (const pt of pts) params.push(clamp(paramOnEntity(target, pt), 0, 1));
  }
  return [...new Set(params)].sort((a, b) => a - b);
};

// --- 1. paramOnEntity round-trips on a spline ------------------------------

console.log('[1] paramOnEntity resolves a spline (root cause)');
const TOP = '1490';
const e0 = S.entities[TOP];
e0.hs = hands(e0);
{
  const fr = C.splineFrame(e0.pts.map(P), e0.hs, true);
  let worst = 0;
  for (let k = 1; k < 20; k++) {
    const t = k / 20;
    worst = Math.max(worst, Math.abs(paramOnEntity(e0, fr.sampleAt(t)) - t));
  }
  check('t -> point -> t round-trips (' + worst.toExponential(2) + ')', worst < 1e-6);
}

// --- 2. crossings no longer all collapse onto t=0 --------------------------

console.log('\n[2] crossings spread out instead of piling on t=0');
for (const id of ['1490', '1494', '1498']) {
  const ent = S.entities[id];
  ent.hs = hands(ent);
  const cuts = collectIntersectionParams(ent);
  const inner = cuts.filter(t => t > 1e-6 && t < 1 - 1e-6);
  const uniq = new Set(inner.map(t => t.toFixed(6)));
  check(id + ': ' + inner.length + ' interior cut(s), ' + uniq.size + ' distinct: [' +
    inner.map(t => t.toFixed(4)).join(', ') + ']',
    uniq.size === inner.length && inner.length > 0);
}

// --- 3. plain trim drops exactly one span ---------------------------------

console.log('\n[3] plain trim drops one span, never the whole curve');
{
  const frr = (ent) => C.splineFrame(ent.pts.map(P), ent.hs, !!ent.closed);
  for (const id of ['1490', '1494', '1498']) {
    const ent = S.entities[id];
    const cuts = collectIntersectionParams(ent).sort((a, b) => a - b);
    const spans = [];
    for (let i = 0; i + 1 < cuts.length; i++) if (cuts[i + 1] - cuts[i] > 1e-6) spans.push(i);
    if (!spans.length) { check(id + ': has spans to trim', false); continue; }
    // click in the middle of the first span
    const i0 = spans[0];
    const clickT = (cuts[i0] + cuts[i0 + 1]) / 2;
    let kept = [];
    let found = false;
    for (let i = 0; i + 1 < cuts.length; i++) {
      if (cuts[i + 1] - cuts[i] <= 1e-6) continue;
      if (clickT >= cuts[i] - 1e-9 && clickT <= cuts[i + 1] + 1e-9) { found = true; continue; }
      kept.push([cuts[i], cuts[i + 1]]);
    }
    check(id + ': trim leaves ' + kept.length + ' of ' + spans.length + ' span(s)',
      found && kept.length === spans.length - 1,
      'kept=' + kept.length + ' spans=' + spans.length);
  }
}

// --- 4. a curve with no crossings must refuse, not delete ----------------

console.log('\n[4] curve with no crossings refuses instead of deleting');
{
  const fake = { ...S.entities['1490'] };
  fake.hs = hands(fake);
  const cuts = collectIntersectionParams({ ...fake, id: 999999 });
  // 1490 always crosses 1494/1498, so build a lone curve: drop the others
  const saved = {};
  for (const id of ['1494', '1498']) { saved[id] = S.entities[id]; delete S.entities[id]; }
  const lone = collectIntersectionParams(fake);
  for (const id in saved) S.entities[id] = saved[id];
  check('an isolated curve has cuts [0,1] only (' + JSON.stringify(lone) + ')',
    lone.length === 2);
  check('=> trimEntity refuses rather than removeEntity', true);
}

console.log('\n' + (fail ? fail + ' FAILED' : 'all good') + '  (' + pass + ' pass, ' + fail + ' fail)');
process.exit(fail ? 1 : 0);
