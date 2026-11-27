// Probe: import placement must land OUTSIDE the existing workspace's bounding
// box with a 50 mm clearance, and DXF imports must use the file's colours when
// the file states them (falling back to the working colour only when absent).
//
// Run: node testing/import_placement_probe.js
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

const GAP = 50;
const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-9);

function world() {
  const w = { state: { points: {}, entities: {}, constraints: {} }, nextId: 0 };
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
  w.note = (x, y) => {   // comments must NOT count as workspace content
    const id = ++w.nextId;
    const pid = w.pt(x, y);
    w.state.entities[id] = { id, type: 'note', p: pid, text: 'x' };
    return id;
  };
  const src = 'const IMPORT_PLACE_GAP = ' + GAP + ';\n' +
    slice('docGeometryBounds') + '\n' +
    slice('importClearanceOffset') + '\n' +
    'return { docGeometryBounds, importClearanceOffset };';
  const api = new Function('state', src)(w.state);
  w.doc = () => api.docGeometryBounds();
  w.off = (x1, y1, x2, y2) => api.importClearanceOffset(x1, y1, x2, y2);
  return w;
}

// ---- placement -------------------------------------------------------------
console.log('import placement');
{
  const w = world();
  const d = w.doc();
  check('empty workspace has no bounds', d === null);
  const o = w.off(0, 0, 10, 10);
  check('empty workspace: no shift', o.dx === 0 && o.dy === 0);
}
{
  const w = world();
  w.line(0, 0, 100, 100);   // existing content spans [0,100] in both axes
  const d = w.doc();
  check('workspace bounds found', d.minX === 0 && d.minY === 0 && d.maxX === 100 && d.maxY === 100);

  // import would land on top of it -> must move to the right of the document,
  // 50 mm clear, top edges aligned
  const o = w.off(0, 0, 10, 10);
  check('overlapping import shifts right by exactly 50 mm', near(o.dx, 150), JSON.stringify(o));
  check('top edges align', o.dy === 0, JSON.stringify(o));
}
{
  const w = world();
  w.line(0, 0, 100, 100);
  // already right of the document: snaps back to exactly 50 mm clear
  const o = w.off(200, 0, 210, 10);
  check('far-right import realigns to 50 mm clear', near(o.dx, -50) && o.dy === 0, JSON.stringify(o));
  // below the document: moves right AND up so tops align
  const o2 = w.off(0, 200, 10, 210);
  check('below import lands right, top aligned', near(o2.dx, 150) && near(o2.dy, -200), JSON.stringify(o2));
  // vertically offset above: right + down to the same top
  const o3 = w.off(-5, -30, 105, -20);
  check('above import lands right, top aligned', near(o3.dx, 155) && near(o3.dy, 30), JSON.stringify(o3));
}
{
  const w = world();
  w.note(0, 0);   // comments only -> nothing counts as geometry
  const d = w.doc();
  check('notes do not count as workspace content', d === null);
}

// ---- DXF colours -----------------------------------------------------------
console.log('DXF colours');
{
  const pairs = (...a) => a.map(p => p[0] + '\n' + p[1] + '\n').join('');
  const dxf = pairs(
    [0, 'SECTION'], [2, 'TABLES'],
    [0, 'LAYER'], [2, 'L_RED'], [62, '1'],
    [0, 'LAYER'], [2, 'L_GREEN'], [62, '3'],
    [0, 'LAYER'], [2, 'L_TRUECOLOR'], [62, '256'], [420, '65280'],
    [0, 'ENDSEC'],
    [0, 'SECTION'], [2, 'ENTITIES'],
    // ACI 2 (yellow) wins over the layer
    [0, 'LINE'], [62, '2'], [8, 'L_RED'], [10, '0'], [20, '0'], [11, '10'], [21, '0'],
    // no code 62 -> BYLAYER -> layer red
    [0, 'LINE'], [8, 'L_RED'], [10, '0'], [20, '0'], [11, '10'], [21, '0'],
    // true color 420 -> green, overrides layer
    [0, 'LINE'], [420, '65280'], [8, 'L_RED'], [10, '0'], [20, '0'], [11, '10'], [21, '0'],
    // BYBLOCK (0) -> inherit -> null when nothing above resolves
    [0, 'LINE'], [62, '0'], [10, '0'], [20, '0'], [11, '10'], [21, '0'],
    // no colour at all -> null (caller falls back to working colour)
    [0, 'LINE'], [10, '0'], [20, '0'], [11, '10'], [21, '0'],
    // layer with true color only
    [0, 'LINE'], [8, 'L_TRUECOLOR'], [10, '0'], [20, '0'], [11, '10'], [21, '0'],
    [0, 'ENDSEC'], [0, 'EOF']
  );
  const prims = C.parseDxf(dxf);
  check('five lines parsed', prims.length === 6, prims.length);
  const colors = prims.map(p => p.color);
  check('ACI 2 resolves to yellow', colors[0] === '#ffff00', colors[0]);
  check('BYLAYER resolves from the layer table', colors[1] === '#ff0000', colors[1]);
  check('true color 420 wins over layers', colors[2] === '#00ff00', colors[2]);
  check('BYBLOCK without a parent colour stays null', colors[3] === null, colors[3]);
  check('no colour mentioned stays null (caller falls back)', colors[4] === null, colors[4]);
  check('layer true color is honoured', colors[5] === '#00ff00', colors[5]);
}
{
  const pairs = (...a) => a.map(p => p[0] + '\n' + p[1] + '\n').join('');
  // a block without colours, inserted under a red (ACI 1) insert -> inherit
  const dxf = pairs(
    [0, 'SECTION'], [2, 'BLOCKS'],
    [0, 'BLOCK'], [2, 'B1'],
    [0, 'LINE'], [10, '0'], [20, '0'], [11, '1'], [21, '0'],
    [0, 'ENDBLK'],
    [0, 'ENDSEC'],
    [0, 'SECTION'], [2, 'ENTITIES'],
    [0, 'INSERT'], [2, 'B1'], [62, '1'], [10, '100'], [20, '0'],
    [0, 'ENDSEC'], [0, 'EOF']
  );
  const prims = C.parseDxf(dxf);
  check('insert inherits its own colour into the block', prims.length === 1 && prims[0].color === '#ff0000',
    JSON.stringify(prims.map(p => p.color)));
}

// ---- white -> cut (import colour normalization) ----------------------------
console.log('white to cut');
{
  const COLORS = [
    { name: 'Cut (black)', value: '#000000' },
    { name: 'Engrave (blue)', value: '#0000ff' },
    { name: 'V-carve (cyan)', value: '#00ffff' },
    { name: 'Pocket (purple)', value: '#800080' },
    { name: 'Drill (red)', value: '#ff0000' },
    { name: 'Mark (green)', value: '#00ff00' },
    { name: 'Cut tab (maroon)', value: '#800000' },
    { name: 'Start point (teal)', value: '#008080' },
    { name: 'Clip (yellow)', value: '#ffff00' }
  ];
  const CNC_CODES = COLORS.map(c => c.value);
  const names = ['hexToRgb', 'rgbToLab', 'colorDistanceLab', 'nearestCncColorDist', 'nearestCncColor', 'importColorNormalized'];
  const CNC_MATCH_MAX_DIST = 46;
  const api = new Function(
    'CNC_CODES', 'CNC_MATCH_MAX_DIST',
    names.map(slice).join('\n') + '\nreturn {' + names.join(',') + '};'
  )(CNC_CODES, CNC_MATCH_MAX_DIST);
  check('white -> cut', api.importColorNormalized('#ffffff') === '#000000');
  check('near-white -> cut', api.importColorNormalized('#f5f5f5') === '#000000');
  check('a palette code stays itself', api.importColorNormalized('#00ffff') === '#00ffff');
  check('orange snaps to red (a match)', api.importColorNormalized('#ff7f00') === '#ff0000',
    api.importColorNormalized('#ff7f00'));
  check('gold snaps to yellow', api.importColorNormalized('#ffd700') === '#ffff00',
    api.importColorNormalized('#ffd700'));
  check('far magenta has no match -> cut', api.importColorNormalized('#ff00ff') === '#000000',
    api.importColorNormalized('#ff00ff'));
  check('null stays null', api.importColorNormalized(null) === null);
  check('unreadable -> cut', api.importColorNormalized('garbage') === '#000000');
  check('nearest: pure white is cut', api.nearestCncColor('#ffffff') === '#000000');
  check('nearest: black is cut', api.nearestCncColor('#000000') === '#000000');
  check('nearest: red is drill', api.nearestCncColor('#ff0000') === '#ff0000');
}
{
  // DXF ACI 7 is white — the parser must surface it and the app normalizes it
  const pairs = (...a) => a.map(p => p[0] + '\n' + p[1] + '\n').join('');
  const dxf = pairs(
    [0, 'SECTION'], [2, 'ENTITIES'],
    [0, 'LINE'], [62, '7'], [10, '0'], [20, '0'], [11, '10'], [21, '0'],
    [0, 'ENDSEC'], [0, 'EOF']
  );
  const prims = C.parseDxf(dxf);
  check('DXF ACI 7 parses as white', prims.length === 1 && prims[0].color === '#ffffff',
    JSON.stringify(prims.map(p => p.color)));
}

// ---- dimension badge labels & orthogonal H/V geometry ---------------------
console.log('dimension labels & geometry');
{
  const names = ['dimMeasureLabel', 'distanceGeom'];
  const g = {
    p1: { x: 0, y: 0 }, p2: { x: 30, y: 40 },
    q1: { x: 0, y: 0 }, q2: { x: 30, y: 40 }
  };
  const fmt = (v) => String(Math.round(v * 1000) / 1000);
  const pts = { 1: { x: 0, y: 0 }, 2: { x: 30, y: 40 } };
  const P = (id) => pts[id] || null;
  const api = new Function('fmt', 'P', names.map(slice).join('\n') + '\nreturn { dimMeasureLabel, distanceGeom };')(fmt, P);
  check('D mode shows (50)', api.dimMeasureLabel({ axis: null }, g) === '(50)', api.dimMeasureLabel({ axis: null }, g));
  check('H mode shows (30) without H prefix', api.dimMeasureLabel({ axis: 'x' }, g) === '(30)', api.dimMeasureLabel({ axis: 'x' }, g));
  check('V mode shows (40) without V prefix', api.dimMeasureLabel({ axis: 'y' }, g) === '(40)', api.dimMeasureLabel({ axis: 'y' }, g));
  check('D reference shows (55), no nesting', api.dimMeasureLabel({ axis: null, reference: true, value: 55 }, g) === '(55)',
    api.dimMeasureLabel({ axis: null, reference: true, value: 55 }, g));
  check('H reference still measures the X span cleanly', api.dimMeasureLabel({ axis: 'x', reference: true, value: 55 }, g) === '(30)',
    api.dimMeasureLabel({ axis: 'x', reference: true, value: 55 }, g));
  check('radius label untouched', api.dimMeasureLabel({ kind: 'r', value: 7 }, g) === 'R 7',
    api.dimMeasureLabel({ kind: 'r', value: 7 }, g));
  check('radius reference keeps one paren', api.dimMeasureLabel({ kind: 'r', reference: true, value: 7 }, g) === 'R (7)',
    api.dimMeasureLabel({ kind: 'r', reference: true, value: 7 }, g));

  const gh = api.distanceGeom({ p1: 1, p2: 2, axis: 'x' });
  check('H distanceGeom builds 2 vertical extension lines and 1 horizontal dim line',
    gh && gh.q1.x === 0 && gh.q2.x === 30 && gh.q1.y === gh.q2.y && gh.q1.y > 40 && gh.nx === 0 && gh.ny === 1,
    JSON.stringify(gh));
  const gv = api.distanceGeom({ p1: 1, p2: 2, axis: 'y' });
  check('V distanceGeom builds 2 horizontal extension lines and 1 vertical dim line',
    gv && gv.q1.y === 0 && gv.q2.y === 40 && gv.q1.x === gv.q2.x && gv.q1.x > 30 && gv.nx === 1 && gv.ny === 0,
    JSON.stringify(gv));
}

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
