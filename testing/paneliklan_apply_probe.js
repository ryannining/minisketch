// Probe for Panel iklan's apply() — the path that writes geometry and groups it.
//
// The planning half is covered by paneliklan_probe.js, but that never runs
// apply(). The doubled result lived in apply(): holes were added as <circle>,
// and cmdGroupSelection refuses to TAKE OVER a selection containing circles
// (they keep their own identity), so the panel was baked AND the originals
// stayed on the canvas — a group plus an editable copy of itself.
//
// This probe drives apply() with a fake API and asserts that:
//   1. holes are submitted as closed splines, never as circles
//   2. the splines are true circles (4 Bézier nodes, kappa handles)
//   3. grouping is asked to run, so the originals belong to the group
//
// Run: node testing/paneliklan_apply_probe.js
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'paneliklan.js'), 'utf8');
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

console.log('paneliklan apply: holes are splines, not circles');
check('apply() no longer calls addCircle',
  !/api\.addCircle\(/.test(src));
check('apply() adds holes through addSpline',
  /api\.addSpline\(\{ pts: h\.pts, hs: h\.hs, closed: true, color \}\)/.test(src));
check('a circleSpline helper exists', /function circleSpline\(cx, cy, r\)/.test(src));

// ---- run the apply path against a fake api ------------------------------
const NS = { register(def) { NS.def = def; } };
const sandbox = { window: { MiniSketchTools: NS }, localStorage: { getItem: () => null, setItem: () => {} } };
const fn = new Function('window', 'localStorage', src + '\nreturn window.MiniSketchTools.def;');
const def = fn(sandbox.window, sandbox.localStorage);

// fields the dialog reads
const fields = { 'pi-w': 400, 'pi-h': 300, 'pi-dia': 6, 'pi-r': 10, 'pi-inset': 10, 'pi-mode': 'corners' };
const calls = { spline: [], circle: [], group: 0, made: [] };
let nextId = 1;
const document = {
  getElementById: (id) => {
    if (id in fields) return { value: String(fields[id]) };
    return { value: '', focus() {}, checked: false };
  }
};
globalThis.document = document;

const api = {
  clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, +v)),
  fmt: (v) => String(+v.toFixed(2)),
  toast: () => {},
  s2w: (x, y) => ({ x, y }),
  getW: () => 800,
  getH: () => 600,
  pushHistory: () => {},
  commit: () => {},
  removeEntity: () => {},
  ui: { selection: [], color: '#000000' },
  state: { entities: {} },
  addPanelEntity: (pts) => { const id = nextId++; calls.made.push(id); return id; },
  addCircle: (c, r) => { calls.circle.push({ c, r }); const id = nextId++; calls.made.push(id); return id; },
  addSpline: (o) => { calls.spline.push(o); const id = nextId++; calls.made.push(id); return id; },
  cmdGroupSelection: () => { calls.group++; }
};

// apply() closes the dialog via NS.close
NS.close = () => {};

// The tool script is a self-registering IIFE: evaluate it, then drive the
// registered definition directly.
def.apply(api, document, NS);

check('four holes created for "corners"', calls.spline.length === 4, JSON.stringify(calls.spline.length));
check('no circle was created', calls.circle.length === 0, JSON.stringify(calls.circle.length));
check('the outline plus four holes are selected', calls.made.length === 5, JSON.stringify(calls.made.length));
check('grouping ran once', calls.group === 1, JSON.stringify(calls.group));

console.log('paneliklan apply: the hole splines are true circles');
{
  const h = calls.spline[0];
  check('hole has 4 nodes', h.pts.length === 4, JSON.stringify(h.pts.length));
  check('hole is closed', h.closed === true);
  check('handles are present for every node',
    h.hs && h.hs.o.length === 4 && h.hs.i.length === 4);
  const r = 3;                       // dia 6
  const radii = h.pts.map(p => Math.hypot(p.x - h.pts[0].x, p.y - h.pts[0].y));
  const cx = (h.pts[0].x + h.pts[2].x) / 2, cy = (h.pts[0].y + h.pts[2].y) / 2;
  const rs = h.pts.map(p => Math.hypot(p.x - cx, p.y - cy));
  check('all four nodes are radius ' + r + ' from the centre',
    rs.every(v => Math.abs(v - r) < 1e-9), JSON.stringify(rs.map(v => +v.toFixed(4))));
  // handle length for a quarter-circle cubic = kappa * r
  const kappa = (4 / 3) * Math.tan(Math.PI / 8);
  const h0 = Math.hypot(h.hs.o[0].x - h.pts[0].x, h.hs.o[0].y - h.pts[0].y);
  check('handle reaches kappa*r', Math.abs(h0 - kappa * r) < 1e-9,
    'got ' + h0 + ' want ' + (kappa * r));
  // the tangent at node 0 (angle 0, point (r,0)) is (0,1): the handle runs in Y
  check('handle is tangent at the node (no radial kink)',
    Math.abs(h.hs.o[0].x - h.pts[0].x) < 1e-9 && Math.abs(h.hs.o[0].y - h.pts[0].y) > 0);
}

console.log('paneliklan apply: the takeover conditions now hold');
// cmdGroupSelection takes over only when the pick has no arc/circle
check('no circle entity is ever handed to the group',
  calls.circle.length === 0 && calls.spline.length > 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
