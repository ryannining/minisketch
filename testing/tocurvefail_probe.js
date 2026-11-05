// Probe: reproduce the Ctrl+K freeze with the user's tocurvefail.sketch.
// Loads the document, selects everything, and runs the real chain
// (entityWorldPolylines -> chainPolylines -> fitPolylineCurve) with timing per
// stage so the slow one names itself.
// Run: node testing/tocurvefail_probe.js
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

const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tocurvefail.sketch'), 'utf8'));
const s = doc.state;

const points = {};
for (const id in s.points) points[+id] = { x: s.points[id][0], y: s.points[id][1] };

// only lines and splines participate in Ctrl+K
const entities = {};
let nLines = 0, nSplines = 0, nOther = 0;
for (const id in s.entities) {
  const e = s.entities[id];
  if (e.type === 'line') { entities[+id] = { ...e, type: 'line', a: +e.a, b: +e.b }; nLines++; }
  else if (e.type === 'spline') { entities[+id] = { ...e, type: 'spline', pts: (e.pts || []).map(Number) }; nSplines++; }
  else { nOther++; }
}
console.log('lines=' + nLines + ' splines=' + nSplines + ' other=' + nOther + ' points=' + Object.keys(points).length);

const entityPointIds = (e) => {
  if (!e) return [];
  if (e.type === 'line') return [e.a, e.b];
  if (e.type === 'spline') return e.pts || [];
  if (e.type === 'circle') return [e.c];
  return [];
};
const P = (id) => points[+id] || null;
const entityWorldPolylines = (e) => {
  if (!e) return [];
  if (e.type === 'line') {
    const a = P(e.a), b = P(e.b);
    return a && b ? [{ pts: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }], closed: false }] : [];
  }
  if (e.type === 'spline') {
    const pts = (e.pts || []).map(p => P(p)).filter(Boolean).map(p => ({ x: p.x, y: p.y }));
    return pts.length >= 2 ? [{ pts, closed: !!e.closed }] : [];
  }
  return [];
};
const colorOf = (e) => (e && e.color) || '#000000';

const t0 = Date.now();
const polys = [];
const src = Object.values(entities).filter(e => e.type === 'line' || e.type === 'spline');
for (const e of src) {
  for (const pl of entityWorldPolylines(e)) {
    if (pl && pl.pts && pl.pts.length >= 2) polys.push({ pts: pl.pts, closed: !!pl.closed, color: colorOf(e) });
  }
}
console.log('polys=' + polys.length + ' total pts=' + polys.reduce((a, p) => a + p.pts.length, 0) +
  '  (' + (Date.now() - t0) + 'ms)');

const t1 = Date.now();
const chains = C.chainPolylines(polys, 0.1);
console.log('chains=' + chains.length + '  (' + (Date.now() - t1) + 'ms)');

const tol = 0.2, sharpAngle = 25;
let totalNodes = 0;
for (let ci = 0; ci < chains.length; ci++) {
  const ch = chains[ci];
  const t2 = Date.now();
  const res = C.fitPolylineCurve(ch.pts, { tol, sharpAngle, closed: !!ch.closed });
  const dt = Date.now() - t2;
  const nodes = res && res.nodes ? res.nodes.length : 0;
  totalNodes += nodes;
  console.log('chain ' + ci + ': pts=' + ch.pts.length + ' closed=' + !!ch.closed +
    ' nodes=' + nodes + '  (' + dt + 'ms)' + (dt > 500 ? '  <-- SLOW' : ''));
}
console.log('total nodes=' + totalNodes);
