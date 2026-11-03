// Probe: grouping and ungrouping must PRESERVE curves.
//
// The reported case: a curve object with constraints, copied into a group,
// then the original + that group wrapped together; moving it aside and
// ungrouping gave back the original curve but a POLYLINE where the inner group
// had been.
//
// Cause: collectCurveSources() (what Ctrl+G stores for ungroup) handled line /
// spline / circle / arc, but an `art` group fell through to
// entityWorldPolylines() — the already-flattened contours. Wrapping a group
// therefore threw its curves away.
//
// Run: node testing/group_curve_probe.js
'use strict';
const fs = require('fs');
const path = require('path');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

function braceEnd(src, from) {
  let i = src.indexOf('{', from), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) return j + 1; }
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

console.log('\n== collectCurveSources keeps a nested group\'s curves ==');
{
  const body = slice('collectCurveSources');
  check('an `art` group is handled explicitly',
    /e\.type === 'art' && artCurveSource\(e\)/.test(body), body.includes("type === 'art'"));
  check('it reads the group\'s curve data, not its polylines',
    /artCurveSource\(e\)/.test(body));
  check('it still falls back to polylines for anything else',
    /entityWorldPolylines\(e\)/.test(body));
  check('a handle-free sub-path stays a polyline',
    /sub\.curved \|\| nodes\.some\(n => n\.o \|\| n\.i\)/.test(body));
}

// ---- behaviour: one curve + one group, wrapped, then ungrouped -----------
console.log('\n== wrapping a group keeps the curve inside it ==');
{
  const state = {
    points: {}, entities: {}, constraints: {},
    layers: [{ id: 1, visible: true, locked: false }], nextId: 1
  };
  const ui = { activeLayer: 1, color: '#000000', selection: [] };
  const newId = () => state.nextId++;
  const P = (id) => state.points[id];
  const privatePoint = (x, y) => { const id = newId(); state.points[id] = { id, x, y }; return id; };
  const colorOf = (e) => (e && e.color) || '#000000';
  const entityPointIds = (e) => (e.type === 'spline' ? (e.pts || [])
    : e.type === 'circle' ? [e.c] : e.type === 'arc' ? [e.c, e.s, e.e] : []);
  const circleData = (e) => (e.type === 'circle' ? { c: P(e.c), r: e.r } : null);
  const arcData = (e) => {
    if (e.type !== 'arc') return null;
    const c = P(e.c), s = P(e.s), en = P(e.e);
    const a0 = Math.atan2(s.y - c.y, s.x - c.x);
    let sweep = Math.atan2(en.y - c.y, en.x - c.x) - a0;
    while (sweep <= 0) sweep += Math.PI * 2;
    return { c, r: Math.hypot(s.x - c.x, s.y - c.y), a0, sweep };
  };
  const textGeom = new Function('P', slice('textGeom') + '\nreturn textGeom;')(P);
  const artCurveSource = new Function('textGeom',
    slice('artCurveSource') + '\nreturn artCurveSource;')(textGeom);
  const entityWorldPolylines = () => [{ pts: [{ x: 0, y: 0 }, { x: 1, y: 0 }], closed: false }];

  const collect = new Function('state', 'ui', 'P', 'newId', 'colorOf', 'entityPointIds',
    'circleData', 'arcData', 'arcCubicNodes', 'TAU', 'entityWorldPolylines', 'artCurveSource',
    slice('collectCurveSources') + '\nreturn collectCurveSources;')(
    state, ui, P, newId, colorOf, entityPointIds, circleData, arcData,
    require(path.join(__dirname, '..', 'core.js')).arcCubicNodes, Math.PI * 2,
    entityWorldPolylines, artCurveSource);

  // a real curve with handles
  const mk = (x, y) => privatePoint(x, y);
  const ids = [mk(0, 0), mk(10, 10), mk(20, 0)];
  const curveId = newId();
  state.entities[curveId] = {
    id: curveId, type: 'spline', pts: ids, closed: false, color: '#000000', layer: 1,
    hs: {
      o: [{ x: 5, y: 5 }, { x: 15, y: 10 }, { x: 25, y: 5 }],
      i: [{ x: -5, y: -5 }, { x: 5, y: 10 }, { x: 15, y: -5 }]
    }
  };

  // a group that already holds that curve (what Ctrl+G produced earlier)
  const p0 = privatePoint(0, 10), pw = privatePoint(20, 10), ph = privatePoint(0, 0);
  const groupId = newId();
  const frameW = 20, frameH = 10;
  const norm = (p) => [(p.x - 0) / frameW, (10 - p.y) / frameH];
  state.entities[groupId] = {
    id: groupId, type: 'art', p0, pw, ph, guide: [],
    color: '#000000', layer: 1, ratio: frameW / frameH,
    contours: [Array.from({ length: 8 }, (_, i) => {
      const a = Math.PI * 2 * i / 8;
      return [0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)];
    })],
    closed: [true],
    curveSrc: [{
      closed: false, curved: true, c: null, f: null,
      n: ids.map((pid, i) => ({
        p: norm(P(pid)),
        o: norm(state.entities[curveId].hs.o[i]),
        i: norm(state.entities[curveId].hs.i[i])
      }))
    }]
  };

  const out = collect([state.entities[curveId], state.entities[groupId]]);
  check('both sources produced curve data', out.length === 2, out.length);
  const fromCurve = out[0];
  const fromGroup = out[1];
  check('the plain curve kept its handles', fromCurve.nodes.some(n => n.o || n.i));
  check('the GROUP kept its handles too', fromGroup.nodes.some(n => n.o || n.i),
    JSON.stringify(fromGroup.nodes));
  check('the group did not contribute its flattened 8-gon',
    fromGroup.nodes.length === 3, fromGroup.nodes.length);
  check('both are still marked curved', fromCurve.curved && fromGroup.curved);
}

// ---- ungroup rebuilds curves from that data ------------------------------
console.log('\n== ungroup rebuilds splines, not polylines ==');
{
  const art = slice('artToLines');
  check('artToLines prefers the curve data', /const src = artCurveSource\(e\)/.test(art));
  check('a curved sub-path becomes a spline', /if \(sub\.curved\)/.test(art));
  check('only a straight sub-path becomes lines', /const last = sub\.closed \? pids\.length : pids\.length - 1/.test(art));
}

console.log('\n== nothing else flattens a group on the way through ==');
{
  check('bakeContours keeps the curve sources', /keepCurve: true/.test(slice('cmdGroupSelection')));
  check('a group with curve data is re-flattened at the machine tolerance only in CNC',
    /cncFramedCurveShapes/.test(appSrc));
}

console.log('\n' + (fail ? fail + ' FAILED, ' : 'all ') + pass + ' checks passed');
process.exit(fail ? 1 : 0);
