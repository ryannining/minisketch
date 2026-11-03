// Probe for curve fitting inside the text tracer and the image trace.
//
// Both traces end up as polylines; "Fit real curves" turns them into real
// Bezier splines on -> Curve instead of one straight line per contour segment.
// The flag lives on the object (text.fitCurve / art.fitCurve) so it per-object
// survives save+load, and both dialogs expose it as a checkbox.
//
// Run: node testing/framed_fit_probe.js
const fs = require('fs');
const path = require('path');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const C = require(path.join(__dirname, '..', 'core.js'));
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

// Dense resampling of a fitted spline. splineSamples() is the renderer's
// density (12 per segment) and is too coarse to judge a fit by.
function denseSamples(cps, hs, closed) {
  const out = [];
  for (const c of C.splineCubics(cps, hs, closed)) {
    // density follows the segment length: a fitted segment can be 40 mm long,
    // and a fixed 64 steps would only measure its own chord error
    const len = Math.hypot(c.P3.x - c.P0.x, c.P3.y - c.P0.y);
    const n = Math.max(32, Math.ceil(len * 20));
    for (let k = 0; k <= n; k++) out.push(C.cubicAt(c.P0, c.P1, c.P2, c.P3, k / n));
  }
  return out;
}

// ---- the checkboxes ----------------------------------------------------
console.log('\n== the choice is in both dialogs ==');
{
  check('text dialog has a fit checkbox', /id="text-fitcurve"/.test(html));
  check('image dialog has a fit checkbox', /id="img-fitcurve"/.test(html));
  check('the potrace checkbox is still separate', /id="img-optcurve"/.test(html));
  check('applyTextEditor stores it on the object',
    /function applyTextEditor[\s\S]{0,2600}?e\.fitCurve = !!fitEl\.checked/.test(appSrc));
  check('applyTextEditor remembers it for new text',
    /function applyTextEditor[\s\S]{0,2600}?saveTextFit\(e\.fitCurve\)/.test(appSrc));
  check('the image dialog reads it back', /el\('img-fitcurve'\)\.checked = saved\.fitCurve !== false/.test(appSrc));
  check('the image dialog passes it to the trace',
    /artFromBlob\(d\.blob, \{[\s\S]{0,200}?fitCurve,/.test(appSrc));
  check('insertArt marks the new object',
    /if \(o\.fitCurve === true\) state\.entities\[id\]\.fitCurve = true;/.test(appSrc));
  check('a new text is born with the remembered choice',
    /fitCurve: loadTextFit\(\)/.test(appSrc));
  check('the flag survives save + load',
    /e\.type === 'text' \|\| e\.type === 'art'\) && e\.fitCurve === true[\s\S]{0,120}?entities\[id\]\.fitCurve = true/.test(appSrc));
}

// ---- the conversion path ----------------------------------------------
console.log('\n== -> Curve fits the real curves ==');

function makeWorld() {
  const world = {
    state: {
      points: {}, entities: {}, constraints: {}, namedSel: {},
      layers: [{ id: 1, name: 'Layer 1', visible: true, locked: false }],
      nextId: 9000
    },
    ui: { selection: [], activeLayer: 1, focusLoop: null },
    settings: { curveFitTol: 0.2, curveSharpAngle: 25, joinTol: 0.1 },
    toasts: [], history: 0, commits: 0, solved: 0
  };
  world.newId = () => ++world.state.nextId;
  world.P = (id) => world.state.points[+id] || null;
  world.privatePoint = (x, y) => {
    const id = world.newId();
    world.state.points[id] = { x, y };
    return id;
  };
  world.toast = (m) => world.toasts.push(String(m));
  world.pushHistory = () => { world.history++; };
  world.commit = () => { world.commits++; };
  world.requestSolve = () => { world.solved++; };
  world.invalidateLoops = () => {};
  world.cleanupPoints = () => {};
  world.xfBlock = () => false;
  world.removeEntity = (id) => { delete world.state.entities[+id]; };
  world.colorOf = (e) => (e && e.color) || '#000000';
  world.normalizeSplineLoops = () => {};
  world.removeDuplicateLines = () => {};
  world.fuseCoincidentPoints = () => 0;
  world.updateHistoryButtons = () => {};
  world.entityPointIds = (e) => {
    if (!e) return [];
    if (e.type === 'spline') return e.pts || [];
    if (e.type === 'line') return [e.a, e.b];
    return [];
  };
  world.selectedEntities = () => world.ui.selection
    .filter(s => s.kind === 'entity' && world.state.entities[s.id])
    .map(s => world.state.entities[s.id]);
  // a text object with two contours: one round, one with a sharp corner
  world.texGeom = null;
  return world;
}

function build(world) {
  const body = [
    slice('artNotesToEntities'),
    slice('addFittedSpline'),
    slice('framedLoopsWorld'),
    slice('framedFitTol'),
    slice('cmdConvertToCurve')
  ].join('\n');
  return new Function(
    'state', 'ui', 'settings', 'TAU', 'fitPolylineCurve',
    'newId', 'privatePoint', 'P', 'toast', 'pushHistory', 'commit', 'requestSolve',
    'invalidateLoops', 'cleanupPoints', 'xfBlock', 'removeEntity', 'colorOf',
    'normalizeSplineLoops', 'removeDuplicateLines', 'fuseCoincidentPoints',
    'updateHistoryButtons', 'entityPointIds', 'selectedEntities',
    'textGeom', 'textMetricsOf', 'textLocalContours', 'artClosedFlags',
    'isSingleLineFont', 'textStrokesWorld',
    'artCurveSource', 'artToLines', 'textToLines', 'circleData', 'arcCurveNode', 'fmt',
    'textExactLoopsWorld',
    `let history = { pop: () => {} };
     const TEXT_TOL_MM = 0.08, ART_TOL_MM = 0.1;
     let textExactWhy = 'no-outline-data';
     let textTraceWarned = false, textExactLoadPromise = null;
     ${body}
     return { cmdConvertToCurve, addFittedSpline, framedLoopsWorld, framedFitTol };`
  )(
    world.state, world.ui, world.settings, Math.PI * 2, C.fitPolylineCurve,
    world.newId, world.privatePoint, world.P, world.toast, world.pushHistory,
    world.commit, world.requestSolve, world.invalidateLoops, world.cleanupPoints,
    world.xfBlock, world.removeEntity, world.colorOf, world.normalizeSplineLoops,
    world.removeDuplicateLines, world.fuseCoincidentPoints, world.updateHistoryButtons,
    world.entityPointIds, world.selectedEntities,
    // a text frame 100 wide / 40 tall at the origin, y up
    (e) => e._geom || null,
    (e) => e._metrics || null,
    (e) => e._contours || [],
    (e) => (e.closed || []).map(v => v !== false),
    () => false,                     // isSingleLineFont (outline text here)
    () => [],                        // textStrokesWorld
    () => null,                      // artCurveSource
    () => [],                        // artToLines (not used by these cases)
    () => [],                        // textToLines
    () => null,                      // circleData
    () => null,                      // arcCurveNode
    (v) => String(Math.round(v * 100) / 100),
    // no font bakend in Node: these cases exercise the traced/fitted path
    () => null
  );
}
void 0;

// a text object whose traced glyph is a dense rounded blob with one sharp tip
function makeText(world, opts) {
  const contour = [];
  for (let i = 0; i < 120; i++) {
    const a = Math.PI * 2 * i / 120;
    const r = 30 + 4 * Math.sin(a * 3);
    contour.push([60 + r * Math.cos(a) * 0.6, 20 + r * Math.sin(a)]);
  }
  contour.push([60, 20 - 34]);        // the sharp tip
  const p0 = world.privatePoint(0, 0);
  const pw = world.privatePoint(100, 0);
  const ph = world.privatePoint(0, 40);
  const id = world.newId();
  const ent = {
    id, type: 'text', p0, pw, ph, text: 'X', color: '#000000', layer: 1,
    _geom: { p0: { x: 0, y: 0 }, A: { x: 100, y: 0 }, B: { x: 0, y: 40 }, pw: { x: 100, y: 0 }, ph: { x: 0, y: 40 } },
    _metrics: { width: 100, height: 40, ascent: 30, descent: 10, lines: ['X'], lineHeight: 40 },
    _contours: [contour]
  };
  if (opts && opts.fit) ent.fitCurve = true;
  world.state.entities[id] = ent;
  world.ui.selection = [{ kind: 'entity', id }];
  return { id, ent, contour };
}

// text with fit ON -> real splines
{
  const world = makeWorld();
  const api = build(world);
  const t = makeText(world, { fit: true });
  api.cmdConvertToCurve();
  const made = Object.values(world.state.entities);
  check('the text is consumed', !world.state.entities[t.id]);
  check('one spline was produced', made.length === 1 && made[0].type === 'spline',
    made.map(e => e.type).join(','));
  const sp = made[0];
  check('it is closed', sp.closed === true);
  check('it carries real handles', sp.hs.o.some(h => h) && sp.hs.i.some(h => h));
  check('far fewer nodes than the 121 traced points', sp.pts.length < 40, sp.pts.length);
  check('the toast says fitted',
    world.toasts.some(x => /fitted curve/.test(x)), world.toasts.join(' | '));

  // the fitted curve must still follow the traced outline
  const cps = sp.pts.map(id => world.state.points[id]);
  const samples = denseSamples(cps, sp.hs, true);
  let worst = 0;
  const tol = Math.max(world.settings.curveFitTol, 0.08);
  for (const pt of t.contour) {
    const w = { x: pt[0], y: pt[1] };   // frame is the identity here
    let best = Infinity;
    for (const q of samples) best = Math.min(best, Math.hypot(q.x - w.x, q.y - w.y));
    worst = Math.max(worst, best);
  }
  check('the fitted glyph stays within the tolerance of the trace',
    worst <= tol + 1e-3, worst.toFixed(3) + ' vs ' + tol);
}

// text with fit OFF -> one line per segment, exactly as before
{
  const world = makeWorld();
  const api = build(world);
  const t = makeText(world, { fit: false });
  const before = world.privatePoint;
  // textToLines stub returns one marker id so the path is observable
  api.cmdConvertToCurve();
  check('with the box off nothing is fitted (no spline appears)',
    Object.values(world.state.entities).every(e => e.type !== 'spline'),
    Object.values(world.state.entities).map(e => e.type).join(','));
}

// an art object traced with fit ON
{
  const world = makeWorld();
  const api = build(world);
  const p0 = world.privatePoint(0, 0);
  const pw = world.privatePoint(200, 0);
  const ph = world.privatePoint(0, 100);
  const contour = [];
  for (let i = 0; i < 90; i++) {
    const a = Math.PI * 2 * i / 90;
    contour.push([0.5 + 0.4 * Math.cos(a), 0.5 + 0.3 * Math.sin(a)]);
  }
  const id = world.newId();
  world.state.entities[id] = {
    id, type: 'art', p0, pw, ph, guide: [], contours: [contour], closed: [true],
    ratio: 2, color: '#000000', layer: 1, fitCurve: true,
    _geom: { p0: { x: 0, y: 0 }, A: { x: 200, y: 0 }, B: { x: 0, y: 100 } }
  };
  world.ui.selection = [{ kind: 'entity', id }];
  api.cmdConvertToCurve();
  const made = Object.values(world.state.entities);
  check('the picture becomes one fitted spline', made.length === 1 && made[0].type === 'spline',
    made.map(e => e.type).join(','));
  const sp = made[0];
  check('the ellipse is fitted, not one line per point', sp.pts.length < 30, sp.pts.length);
  const cps = sp.pts.map(i => world.state.points[i]);
  const samples = denseSamples(cps, sp.hs, true);
  // the source ellipse: centre (100, 50) radius (80, 30)
  let worst = 0;
  for (const s of samples) {
    const nx = (s.x - 100) / 80, ny = (s.y - 50) / 30;
    worst = Math.max(worst, Math.abs(Math.hypot(nx, ny) - 1));
  }
  check('the fitted ellipse is really an ellipse', worst < 0.02, worst.toFixed(4));
}

// an art object traced with fit OFF keeps the line path
{
  const world = makeWorld();
  const api = build(world);
  const p0 = world.privatePoint(0, 0);
  const pw = world.privatePoint(50, 0);
  const ph = world.privatePoint(0, 50);
  const id = world.newId();
  world.state.entities[id] = {
    id, type: 'art', p0, pw, ph, guide: [],
    contours: [[[0, 0], [1, 0], [1, 1], [0, 1]]], closed: [true],
    ratio: 1, color: '#000000', layer: 1,
    _geom: { p0: { x: 0, y: 0 }, A: { x: 50, y: 0 }, B: { x: 0, y: 50 } }
  };
  world.ui.selection = [{ kind: 'entity', id }];
  api.cmdConvertToCurve();
  check('without the box the picture keeps the line path',
    Object.values(world.state.entities).every(e => e.type !== 'spline'));
}

console.log('\n' + (fail ? fail + ' FAILED, ' : 'all ') + pass + ' checks passed');
process.exit(fail ? 1 : 0);
