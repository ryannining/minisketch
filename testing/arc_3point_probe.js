// Probe for the reworked Arc tool (3-point arc):
//   * click 1 + 2 = the two endpoint ON the arc
//   * click 3 = the through / middle point — the arc is created immediately
//     when valid, otherwise an indication (toast) is shown and the draft stays
//   * the third point fully determines the arc (it passes through it), so the
//     same three points always give the same arc
//   * Space toggles between an arc and a FULL circle through the three points
//   * Esc steps back one stage (3rd -> 2nd -> 1st -> cancel)
//
// The actual `if (ui.tool === 'arc')` block is extracted from app.js and
// executed, so the probe tests the real handler.
//
// Run: node testing/arc_3point_probe.js
'use strict';
const fs = require('fs');
const path = require('path');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

// --- extract the arc handler from app.js ------------------------------------
const arcStart = appSrc.indexOf("if (ui.tool === 'arc') {");
const arcEnd = appSrc.indexOf("if (ui.tool === 'circle') {", arcStart);
check('arc handler block found', arcStart > 0 && arcEnd > arcStart);
const arcBranch = appSrc.slice(arcStart, arcEnd);

const runArcClick = new Function('ui', 'snap', 'dep', `
  const TAU = Math.PI * 2;
  const P = dep.P;
  const dist = dep.dist;
  const threePointArcCenter = dep.threePointArcCenter;
  const toast = dep.toast;
  const pushHistory = dep.pushHistory;
  const materializePoint = dep.materializePoint;
  const history = dep.history;
  const updateHistoryButtons = dep.updateHistoryButtons;
  const newId = dep.newId;
  const state = dep.state;
  const requestSolve = dep.requestSolve;
  const commit = dep.commit;
  const render = dep.render;
  const cancelDraft = dep.cancelDraft;
  const shift = false;
  ${arcBranch}
`);

// --- threePointArcCenter sliced from app.js (uses only TAU) ------------------
const tpStart = appSrc.indexOf('function threePointArcCenter(');
const tpEnd = appSrc.indexOf('\n  }', tpStart) + 4;   // include the closing }
const tpc = new Function('TAU', appSrc.slice(tpStart, tpEnd) + '\nreturn threePointArcCenter;')(Math.PI * 2);

// --- fixture ----------------------------------------------------------------
const state = {
  points: {},
  entities: {},
  constraints: {},
  nextId: 100
};
const ui = { draft: null, tool: 'arc', selection: [], color: '#000000' };
let toasts = [];
const dep = {
  state,
  P: id => state.points[id],
  dist: (a, b) => Math.hypot(b.x - a.x, b.y - a.y),
  threePointArcCenter: tpc,
  toast: m => toasts.push(m),
  pushHistory: () => {},
  materializePoint: sp => {
    if (sp && sp.id != null && state.points[sp.id]) return sp.id;
    const id = state.nextId++;
    state.points[id] = { x: sp.x, y: sp.y };
    return id;
  },
  history: { pop: () => {} },
  updateHistoryButtons: () => {},
  newId: () => state.nextId++,
  requestSolve: () => {},
  commit: () => {},
  render: () => {},
  cancelDraft: () => { ui.draft = null; }
};

const reset = () => {
  state.points = {};
  state.entities = {};
  state.nextId = 100;
  ui.draft = null;
  ui.selection = [];
  toasts = [];
};
const freshSnap = (x, y) => ({ x, y });

console.log('\n== the arc tool is a 3-point flow ==');
{
  reset();
  runArcClick(ui, freshSnap(0, 0), dep);
  check('first click starts stage 1', ui.draft && ui.draft.stage === 1, JSON.stringify(ui.draft));
  check('first click remembers endpoint a', ui.draft.a && ui.draft.a.x === 0 && ui.draft.a.y === 0, JSON.stringify(ui.draft && ui.draft.a));

  runArcClick(ui, freshSnap(100, 0), dep);
  check('second click moves to stage 2', ui.draft && ui.draft.stage === 2, JSON.stringify(ui.draft));
  check('second click remembers endpoint b', ui.draft.b && ui.draft.b.x === 100 && ui.draft.b.y === 0);

  runArcClick(ui, freshSnap(50, 80), dep);
  check('third click creates the arc', Object.keys(state.entities).length === 1);
  const arc = Object.values(state.entities)[0];
  check('created entity is an arc', arc && arc.type === 'arc', JSON.stringify(arc));
  check('draft is cleared after a valid arc', ui.draft === null);
  const c = state.points[arc.c], s = state.points[arc.s], e = state.points[arc.e];
  // start/end are the two clicked endpoints in whichever order the arc through
  // the picked point comes (the 'passes through' check below pins that).
  check('the arc keeps both endpoints', s && e &&
    ((s.x === 0 && s.y === 0 && e.x === 100 && e.y === 0) ||
     (s.x === 100 && s.y === 0 && e.x === 0 && e.y === 0)),
    JSON.stringify({ c, s, e }));
  // the arc's CCW sweep from s to e must contain the through point (50,80)
  if (c && s && e) {
    const a0 = Math.atan2(s.y - c.y, s.x - c.x);
    const a1 = Math.atan2(e.y - c.y, e.x - c.x);
    const sweep = (a1 - a0 + Math.PI * 2) % (Math.PI * 2);
    const am = Math.atan2(80 - c.y, 50 - c.x);
    const rel = (am - a0 + Math.PI * 2) % (Math.PI * 2);
    check('the arc passes through the picked point', rel <= sweep + 1e-9,
      JSON.stringify({ a0, a1, sweep, rel, c }));
  }
}

console.log('\n== collinear points are refused with an indication ==');
{
  reset();
  runArcClick(ui, freshSnap(0, 0), dep);
  runArcClick(ui, freshSnap(100, 0), dep);
  runArcClick(ui, freshSnap(200, 0), dep);   // collinear
  check('no arc is created', Object.keys(state.entities).length === 0, JSON.stringify(state.entities));
  check('a toast warns about collinearity', toasts.some(t => /collinear/.test(t)), JSON.stringify(toasts));
  check('the draft stays (stage 2) so the user can retry', ui.draft && ui.draft.stage === 2, JSON.stringify(ui.draft));
}

console.log('\n== the same three points always give the same arc ==');
{
  // run the same three clicks twice; the created arcs must be identical
  // (the through point fully determines the arc — no direction flip)
  const makeArc = () => {
    reset();
    runArcClick(ui, freshSnap(0, 0), dep);
    runArcClick(ui, freshSnap(100, 0), dep);
    runArcClick(ui, freshSnap(50, 60), dep);
    const arc = Object.values(state.entities)[0];
    return {
      c: state.points[arc.c],
      s: state.points[arc.s],
      e: state.points[arc.e]
    };
  };
  const m1 = makeArc();
  const m2 = makeArc();
  check('center is identical', m1.c && m2.c &&
    Math.abs(m1.c.x - m2.c.x) < 1e-9 && Math.abs(m1.c.y - m2.c.y) < 1e-9,
    JSON.stringify({ m1: m1.c, m2: m2.c }));
  check('start/end are identical', m1.s && m2.s && m1.e && m2.e &&
    Math.abs(m1.s.x - m2.s.x) < 1e-9 && Math.abs(m1.s.y - m2.s.y) < 1e-9 &&
    Math.abs(m1.e.x - m2.e.x) < 1e-9 && Math.abs(m1.e.y - m2.e.y) < 1e-9,
    JSON.stringify({ m1, m2 }));
  if (m1.c && m1.s && m1.e) {
    const a0 = Math.atan2(m1.s.y - m1.c.y, m1.s.x - m1.c.x);
    const a1 = Math.atan2(m1.e.y - m1.c.y, m1.e.x - m1.c.x);
    const sweep = (a1 - a0 + Math.PI * 2) % (Math.PI * 2);
    const am = Math.atan2(60 - m1.c.y, 50 - m1.c.x);
    const rel = (am - a0 + Math.PI * 2) % (Math.PI * 2);
    check('the arc passes through the picked point', rel <= sweep + 1e-9,
      JSON.stringify({ sweep, rel, c: m1.c }));
  }
}

console.log('\n== Space toggles arc / full circle ==');
{
  reset();
  runArcClick(ui, freshSnap(0, 0), dep);
  runArcClick(ui, freshSnap(100, 0), dep);
  ui.draft.fullCircle = true;
  runArcClick(ui, freshSnap(50, 60), dep);
  const ents = Object.values(state.entities);
  check('Space creates a circle entity', ents.length === 1 && ents[0].type === 'circle', JSON.stringify(ents));
  const circ = ents[0];
  const c = state.points[circ.c];
  check('circle center is the circumcenter', c && Math.abs(c.x - 50) < 1e-6 && Math.abs(c.y - 9.166666666666666) < 1e-6,
    JSON.stringify(c));
  if (c) {
    const r = circ.r;
    const dA = Math.hypot(c.x - 0, c.y - 0);
    const dB = Math.hypot(c.x - 100, c.y - 0);
    const dM = Math.hypot(c.x - 50, c.y - 60);
    check('circle passes through all three points',
      Math.abs(dA - r) < 1e-6 && Math.abs(dB - r) < 1e-6 && Math.abs(dM - r) < 1e-6,
      JSON.stringify({ r, dA, dB, dM }));
  }

  // collinear points are still refused in circle mode
  reset();
  runArcClick(ui, freshSnap(0, 0), dep);
  runArcClick(ui, freshSnap(100, 0), dep);
  ui.draft.fullCircle = true;
  runArcClick(ui, freshSnap(200, 0), dep);
  check('circle mode still refuses collinear points', Object.keys(state.entities).length === 0, JSON.stringify(state.entities));
  check('circle mode keeps the draft on failure', ui.draft && ui.draft.stage === 2, JSON.stringify(ui.draft));
}

console.log('\n' + (fail ? fail + ' FAILED, ' : 'all ') + pass + ' checks passed');
process.exit(fail ? 1 : 0);
