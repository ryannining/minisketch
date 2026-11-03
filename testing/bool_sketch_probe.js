// Probe: replay bool.sketch (Ryan's failing file) through the REAL app.js
// boolean path, and compare against the true union area.
//
// Run: node testing/bool_sketch_probe.js
const fs = require('fs');
const path = require('path');
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const C = require(path.join(__dirname, '..', 'core.js'));
global.window = {};
require(path.join(__dirname, '..', 'tools', 'path-bool.js'));
const PB = global.window.PathBool;

const S = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'bool.sketch'), 'utf8')).state;

function braceEnd(s, from) {
  let d = 0;
  for (let j = s.indexOf('{', from); j < s.length; j++) {
    if (s[j] === '{') d++; else if (s[j] === '}') { d--; if (!d) return j + 1; }
  }
  return s.length;
}
function slice(name) {
  const i = appSrc.indexOf('function ' + name + '(');
  return appSrc.slice(i, braceEnd(appSrc, i));
}
const shoelace = (q) => {
  let a = 0;
  for (let i = 0; i < q.length; i++) { const p = q[i], r = q[(i + 1) % q.length]; a += p.x * r.y - r.x * p.y; }
  return a / 2;
};

// ---- world ---------------------------------------------------------------
const w = {
  state: { points: {}, entities: {}, constraints: {}, namedSel: {}, layers: S.layers, nextId: 900 },
  ui: { selection: [], activeLayer: 1, color: '#000000' },
  settings: { booleanFit: 'exact' },
  toasts: []
};
for (const [k, v] of Object.entries(S.points)) w.state.points[k] = { x: v[0], y: v[1] };
for (const [k, e] of Object.entries(S.entities)) {
  w.state.entities[k] = {
    id: +k, type: e.type, pts: e.pts.slice(), closed: !!e.closed,
    color: e.color, layer: e.layer,
    hs: e.hs ? { o: e.hs.o.map(h => ({ x: h[0], y: h[1] })), i: e.hs.i.map(h => ({ x: h[0], y: h[1] })) } : null
  };
}
w.newId = () => ++w.state.nextId;
w.P = (id) => w.state.points[+id] || null;
w.privatePoint = (x, y) => { const id = w.newId(); w.state.points[id] = { x, y }; return id; };
w.pointAtWorld = (x, y) => {
  for (const k in w.state.points) { const p = w.state.points[k];
    if (Math.abs(p.x - x) >= 1e-6 || Math.abs(p.y - y) >= 1e-6) continue;
    return +k; }
  return w.privatePoint(x, y);
};
w.weldAllowed = () => true;
w.toast = (m) => w.toasts.push(String(m));
w.fmt = (v) => String(Math.round(v * 100) / 100);
w.commit = () => {};
w.pushHistory = () => {};
w.invalidateLoops = () => {};
w.render = () => {};
w.selected = (kind, id) => w.ui.selection.some(s => s.kind === kind && +s.id === +id);
w.removeEntities = (ids) => { for (const id of ids.map(Number)) delete w.state.entities[id]; };
w.colorOf = (e) => (e && e.color) || '#000000';
w.arcData = () => null;
w.circleData = () => null;
w.entityPointIds = (e) => (e && e.type === 'spline') ? (e.pts || []) : [];
w.ensureSplineHandles = (e) => {
  const cps = (e.pts || []).map(id => w.P(id)).filter(Boolean);
  if (cps.length < 2) { e.hs = null; return null; }
  if (!e.hs || e.hs.o.length !== cps.length || e.hs.i.length !== cps.length) e.hs = C.autoHandles(cps, !!e.closed);
  return e.hs;
};
w.loopEntities = (loop) => loop.ents || [];
w.addPanelEntity = (pts, color) => {
  w.__panelFallbacks = (w.__panelFallbacks || 0) + 1;
  return null;
};
w.getLoops = () => {
  const loops = [];
  for (const id in w.state.entities) {
    const e = w.state.entities[id];
    if (e.type !== 'spline' || !e.closed) continue;
    w.ensureSplineHandles(e);
    const cps = e.pts.map(i => w.P(i)).filter(Boolean);
    const poly = C.splineSamples(cps, e.hs, true);
    if (poly.length < 3) continue;
    loops.push({ poly, area: Math.abs(shoelace(poly)), signed: shoelace(poly),
      steps: [], splineEntity: +id, ents: [+id] });
  }
  return loops;
};

const api = new Function(
  'state', 'ui', 'settings', 'pathBoolLib', 'clipperLib', 'BOOL_EPS', 'P', 'arcData',
  'circleData', 'entityPointIds', 'ensureSplineHandles', 'autoHandles', 'norm2pi',
  'wrapPi', 'pointAtWorld', 'privatePoint', 'newId', 'colorOf', 'loopEntities',
  'getLoops', 'invalidateLoops', 'render', 'commit', 'toast', 'fmt', 'removeEntities',
  'addPanelEntity', 'signedAreaPts', 'pushHistory', 'selected',
  `const window = { PathBool: pathBoolLib() };
   const __FIX_A = ${process.env.FIX_A ? 'true' : 'false'};
   ${[
     slice('normalizeSplineWinding'),
     slice('loopToBoolCommands').replace('const c = [', 'console.log("[input] entity " + (e && e.id) + " closed=" + (e && e.closed) + " nspans=" + spans.length); const c = ['),
     slice('boolPathsToEntities'),
     slice('cmdBooleanExact')
       .replace('normalizeSplineWinding(state.entities[ui.selection[id]]);',
                'normalizeSplineWinding(state.entities[__FIX_A ? ui.selection[id].id : ui.selection[id]]);'),
     slice('cmdBoolean'), slice('pickedLoops')
   ].join('\n')}
   return { cmdBoolean };`
)(w.state, w.ui, w.settings, () => PB, () => null, 1e-6, w.P, w.arcData, w.circleData,
  w.entityPointIds, w.ensureSplineHandles, C.autoHandles, C.norm2pi, C.wrapPi,
  w.pointAtWorld, w.privatePoint, w.newId, w.colorOf, w.loopEntities, w.getLoops,
  w.invalidateLoops, w.render, w.commit, w.toast, w.fmt, w.removeEntities,
  w.addPanelEntity, shoelace, w.pushHistory, w.selected);

// TEMP: capture what loopToBoolCommands sends
const _ltc = slice('loopToBoolCommands');
global.__sent = [];
const ids = Object.keys(w.state.entities).map(Number);
if (process.env.TRACE_SENT) {
  const probe = new Function('state','ui','P','arcData','circleData','entityPointIds',
    'ensureSplineHandles','autoHandles','norm2pi','wrapPi','pointAtWorld','privatePoint',
    'newId','BOOL_EPS','getLoops','invalidateLoops','render','__sent',
    slice('normalizeSplineWinding') + '\n' +
    _ltc.replace('function loopToBoolCommands(loop) {', 'function loopToBoolCommands(loop) {')
    + `\n
    const _g = getLoops;
    getLoops = function () {
      const ls = _g.apply(null, arguments);
      for (const l of ls) {
        const c = loopToBoolCommands(l);
        __sent.push({ id: l.splineEntity, signed: l.signed, cmds: c ? c.length : null,
          first: c ? c[0] : null, ok: !!c });
      }
      return ls;
    };
    return { loopToBoolCommands };`);
}
console.log('bool.sketch: ' + ids.length + ' closed splines, ' + Object.keys(w.state.points).length + ' points');
for (const id of ids) {
  const l = w.getLoops().find(x => x.splineEntity === id);
  console.log('  entity ' + id + ' winding=' + (l.signed > 0 ? 'CCW' : 'CW') +
    ' signed=' + l.signed.toFixed(2));
}

const areaOf = (paths) => {
  let t = 0;
  for (const pth of paths) {
    const pts = [];
    for (const seg of pth) {
      if (!pts.length) pts.push({ x: seg[1][0], y: seg[1][1] });
      for (let i = 1; i <= 16; i++) { const q = PB.samplePathSegmentAt(seg, i / 16); pts.push({ x: q[0], y: q[1] }); }
    }
    t += Math.abs(shoelace(pts));
  }
  return t;
};
const areaOfEntities = () => {
  let t = 0;
  for (const id of Object.keys(w.state.entities).map(Number)) {
    const e = w.state.entities[id];
    if (!e || e.type !== 'spline') continue;
    w.ensureSplineHandles(e);
    t += Math.abs(shoelace(C.splineSamples(e.pts.map(i => w.P(i)), e.hs, true)));
  }
  return t;
};

// ---- op 1: union entities[0] + entities[1] ------------------------------
w.toasts.length = 0;
w.ui.selection = [{ kind: 'entity', id: ids[0] }, { kind: 'entity', id: ids[1] }];
let r1 = null, e1 = null;
try { r1 = api.cmdBoolean('union'); } catch (e) { e1 = e.message; }
const afterNames = Object.keys(w.state.entities).map(Number).filter(x => ids.indexOf(x) < 0);
console.log('\nop1 union(' + ids[0] + ',' + ids[1] + ') -> ' + (e1 || r1) +
  '  destroyed=' + ids.slice(0, 2).filter(x => !w.state.entities[x]).join(',') +
  '  new=' + afterNames.join(',') +
  '  area(new)=' + areaOfEntities().toFixed(1));
console.log('   toasts: ' + JSON.stringify(w.toasts));

// ---- op 2: union(op1 result, entities[2]) --------------------------------
if (!afterNames.length) { console.log('\nop1 produced nothing; cannot continue'); process.exit(1); }
const u = afterNames[afterNames.length - 1];
{
  const e = w.state.entities[u];
  console.log('   op1 entity ' + u + ': pts=' + e.pts.length +
    ' hs.o=' + (e.hs ? e.hs.o.length : 'null') + ' hs.i=' + (e.hs ? e.hs.i.length : 'null') +
    ' closed=' + !!e.closed);
  console.log('   op1 pts coords: ' + e.pts.map(i => {
    const p = w.P(i); return '(' + p.x.toFixed(1) + ',' + p.y.toFixed(1) + ')';
  }).join(' '));
  if (e.hs) {
    const fmt = (arr) => arr.map((h, k) => h ? '(' + h.x.toFixed(1) + ',' + h.y.toFixed(1) + ')' : 'NULL').join(' ');
    console.log('   op1 hs.o: ' + fmt(e.hs.o));
    console.log('   op1 hs.i: ' + fmt(e.hs.i));
    const nullsO = e.hs.o.filter(h => !h).length, nullsI = e.hs.i.filter(h => !h).length;
    console.log('   op1 NULL handles: o=' + nullsO + ' i=' + nullsI + ' of ' + e.hs.o.length);
  }
  const cps = e.pts.map(i => w.P(i));
  const poly = C.splineSamples(cps, e.hs, true);
  console.log('   op1 sampled poly points=' + poly.length +
    ' signedArea=' + shoelace(poly).toFixed(2));
  // What does the app's own ensureSplineHandles do with these nulls?
  const before = e.hs.o.slice();
  w.ensureSplineHandles(e);
  console.log('   after ensureSplineHandles: NULLs o=' + e.hs.o.filter(h => !h).length +
    '  (rebuilt=' + (e.hs.o !== before) + ')');
}
w.toasts.length = 0;
w.ui.selection = [{ kind: 'entity', id: u }, { kind: 'entity', id: ids[2] }];
let r2 = null, e2 = null;
try { r2 = api.cmdBoolean('union'); } catch (e) { e2 = e.message; }
const finalNames = Object.keys(w.state.entities).map(Number).filter(x => x !== u && x !== ids[2]);
console.log('\nop2 union(' + u + ',' + ids[2] + ') -> ' + (e2 || r2) +
  '  destroyed=' + (w.state.entities[u] ? '' : u + ' ') + (w.state.entities[ids[2]] ? '' : ids[2]) +
  '  new=' + finalNames.join(','));
console.log('   toasts: ' + JSON.stringify(w.toasts));

for (const id of finalNames) {
  const e = w.state.entities[id];
  if (e.type !== 'spline') { console.log('   new entity ' + id + ' type=' + e.type); continue; }
  const l = w.getLoops().find(x => x.splineEntity === id);
  console.log('   new entity ' + id + ' spline pts=' + e.pts.length +
    ' closed=' + !!e.closed + ' winding=' + (l && l.signed < 0 ? 'CW' : 'CCW') +
    ' area=' + Math.abs(shoelace(C.splineSamples(e.pts.map(i => w.P(i)), e.hs, true))).toFixed(1));
}
console.log('\nTRUE union area of all 3  = 482.89  (grid sample, /tmp/truth.js)');
console.log('result total entity area = ' + areaOfEntities().toFixed(1));
