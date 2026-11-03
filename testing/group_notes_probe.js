// Probe: a group can hold comments, and the hinge tool's plates match the
// reference drawing exactly.
//
// Two things are pinned here:
//
// 1. GROUP + COMMENTS. Selecting a comment (";" note) together with shapes and
//    pressing Ctrl+G used to bake the shapes and then DELETE the note: notes
//    have no geometry, so baking produced nothing for them and the take-over
//    removed every original. The note now goes INSIDE the group (in the same
//    normalised frame as the contours), is drawn there, survives save/load, and
//    comes back as a note entity on ungroup / -> Curve.
//
// 2. HINGE PLATES. The base and the lid were built from circles-of-arcs and
//    rectangle cuts, but the reference draws 45 degree CHAMFERS and a
//    raised-cosine scoop with the end notches open to the side edges.
//
// Run: node testing/group_notes_probe.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const hingeSrc = fs.readFileSync(path.join(root, 'tools', 'hinge.js'), 'utf8');
const svg = fs.readFileSync(path.join(root, 'ref', 'box_hinge_150x125x60mm.svg'), 'utf8');
const C = require(path.join(root, 'core.js'));
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
const sliceOf = (src, name) => {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('not found: ' + name);
  let i = src.indexOf('(', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') { depth--; if (!depth) break; }
  }
  return src.slice(start, braceEnd(src, i));
};

// ---------------------------------------------------------------------------
// 1. the hinge plates, against the reference polygons
// ---------------------------------------------------------------------------
const hingeConsts = hingeSrc.slice(hingeSrc.indexOf('const REF ='),
  hingeSrc.indexOf('// ---- small helpers'));
const hingeNames = ['rect', 'chamferRect', 'lidOutline', 'circlePts', 'bbox', 'hingePlan'];
const H = new Function(
  hingeConsts +
  'const ease = (t) => 0.5 * (1 - Math.cos(Math.PI * Math.max(0, Math.min(1, t))));\n' +
  hingeNames.map(n => sliceOf(hingeSrc, n)).join('\n') +
  '\nreturn {' + hingeNames.join(',') + '};'
)();

const plan = H.hingePlan({ L: 150, W: 125, H: 60, T: 3 });

// the reference panel polygons, normalised to their own bounding box
function refPanels() {
  const out = [];
  const gRe = /<g transform="([^"]+)">([\s\S]*?)<\/g>/g;
  let m;
  while ((m = gRe.exec(svg))) {
    const flip = /scale\(1,1\)/.test(m[1]);
    const paths = [];
    const pRe = /<path d="([^"]+)"/g;
    let pm;
    while ((pm = pRe.exec(m[2]))) {
      const nums = pm[1].match(/-?\d+(?:\.\d+)?/g) || [];
      const pts = [];
      for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: +nums[i], y: flip ? -nums[i + 1] : +nums[i + 1] });
      if (pts.length >= 3) paths.push(pts);
    }
    out.push(paths);
  }
  return out;
}
const refs = refPanels();
const asPoly = (pts) => pts.map(p => ({ x: p.x, y: p.y }));
const netArea = (list) => list.reduce((a, pts) => a + C.signedAreaPts(pts), 0);
const refBase = refs.find(g => Math.abs(H.bbox([asPoly(g[0])]).w - 150) < 0.02 &&
  Math.abs(H.bbox([asPoly(g[0])]).h - 125) < 0.02)[0];
const refLid = refs.find(g => Math.abs(H.bbox([asPoly(g[0])]).w - 150) < 0.02 &&
  Math.abs(H.bbox([asPoly(g[0])]).h - 128) < 0.02)[0];

console.log('\n== the base is the reference octagon ==');
{
  const mine = plan.base.outline;
  check('it has eight points: four sides and four chamfers', mine.length === 8, mine.length);
  const want = [[3.275, 0], [146.725, 0], [150, 3.275], [150, 121.725],
    [146.725, 125], [3.275, 125], [0, 121.725], [0, 3.275]];
  const ok = want.every(([x, y], i) => Math.abs(mine[i].x - x) < 1e-6 &&
    Math.abs(mine[i].y - y) < 1e-6);
  check('every corner is at the reference coordinate', ok,
    mine.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' '));
  check('the corners are chamfers, not arcs (a reference corner is 2 points apart)',
    Math.abs(C.signedAreaPts(mine) - C.signedAreaPts(refBase)) < 0.01,
    C.signedAreaPts(mine).toFixed(2) + ' vs ' + C.signedAreaPts(refBase).toFixed(2));
}

console.log('\n== the lid is the reference shape ==');
{
  const mine = plan.lid.outline;
  const bb = H.bbox([mine]);
  check('it is L x (W + t)', Math.abs(bb.w - 150) < 1e-6 && Math.abs(bb.h - 128) < 1e-6,
    bb.w.toFixed(2) + ' x ' + bb.h.toFixed(2));
  check('its area matches the reference lid exactly (within a sampling step)',
    Math.abs(Math.abs(C.signedAreaPts(mine)) - Math.abs(C.signedAreaPts(refLid))) < 60,
    Math.abs(C.signedAreaPts(mine)).toFixed(1) + ' vs ' + Math.abs(C.signedAreaPts(refLid)).toFixed(1));

  // the front corners are square: the outline visits (0,0) and (L,0)
  check('the front corners are square, not cut',
    mine.some(p => Math.abs(p.x) < 1e-9 && Math.abs(p.y) < 1e-9) &&
    mine.some(p => Math.abs(p.x - 150) < 1e-9 && Math.abs(p.y) < 1e-9),
    mine.filter(p => Math.abs(p.y) < 1e-6).map(p => p.x.toFixed(1)).join(','));

  // the back corners are chamfered: the two diagonal runs
  check('the back corners are chamfered at 3.275',
    mine.some(p => Math.abs(p.x - 146.725) < 1e-6 && Math.abs(p.y - 128) < 1e-6) &&
    mine.some(p => Math.abs(p.x - 3.275) < 1e-6 && Math.abs(p.y - 128) < 1e-6),
    mine.filter(p => Math.abs(p.y - 128) < 1e-6).map(p => p.x.toFixed(2)).join(','));

  // the end notches are OPEN to the side edges: at x = 0 and x = 150 the outline
  // runs from slotY to slotY+slotH along the edge itself
  // the notch is open when the outline runs ALONG the edge between slotY and
  // slotY+slotH — i.e. both of those heights are vertices on the side edge
  const edgeYs = (x) => mine.filter(p => Math.abs(p.x - x) < 1e-9).map(p => p.y);
  const openAt = (x) => {
    const ys = edgeYs(x);
    return ys.some(y => Math.abs(y - 3.375) < 1e-6) &&
      ys.some(y => Math.abs(y - 6.849) < 1e-6);
  };
  check('the right end notch is open to the edge', openAt(150), edgeYs(150).join(','));
  check('so is the left end', openAt(0), edgeYs(0).join(','));

  // and the scoop is a curve, not a rectangle: it has intermediate heights
  // the scoop lives between its two ends; the notch vertices are near the sides
  const scoopPts = mine.filter(p => p.x > 10 && p.x < 140 && p.y > 1e-6 && p.y < 3.475);
  check('the scoop rises and falls on a curve (intermediate heights)',
    scoopPts.length >= 8, scoopPts.length + ' curve points');
  const scoopMax = Math.max(...scoopPts.map(p => p.y));
  check('the scoop is 3.474 deep', Math.abs(scoopMax - 3.474) < 1e-6, scoopMax.toFixed(4));
  check('and it is flat in the middle: two points at full depth, far apart',
    (() => {
      const deep = mine.filter(p => Math.abs(p.y - 3.474) < 1e-6).map(p => p.x).sort((a, b) => a - b);
      return deep.length >= 2 && (deep[deep.length - 1] - deep[0]) > 100;
    })(), '');
  // the raised-cosine profile, checked against the reference's own samples
  const rise = plan.prm.lidScoopRise;
  const ease = (t) => 0.5 * (1 - Math.cos(Math.PI * t));
  const t = 0.25;
  const refY = (() => {
    // the reference rises from x=10.224 to x=21.024 in eight equal steps
    const xs = 10.224 + (21.024 - 10.224) * t;
    const p = refLid.find(q => Math.abs(q.x - xs) < 1e-6);
    return p ? Math.abs(p.y) : null;
  })();
  check('the scoop profile matches the reference at t = 1/4',
    refY != null && Math.abs(3.474 * ease(t) - refY) < 0.02,
    (3.474 * ease(t)).toFixed(3) + ' vs ' + (refY == null ? '-' : refY.toFixed(3)));
  void rise;
}

// ---------------------------------------------------------------------------
// 2. a group holds comments
// ---------------------------------------------------------------------------
function fakeApp() {
  // the pieces of app.js the grouping path needs, with a minimal document
  const w = {
    state: { points: {}, entities: {}, constraints: {}, layers: [{ id: 1, name: 'L', visible: true, locked: false }], nextId: 100 },
    ui: { activeLayer: 1, color: '#000000', selection: [] },
    toasts: [], history: 0, commits: 0
  };
  w.newId = () => ++w.state.nextId;
  w.P = (id) => w.state.points[+id] || null;
  w.privatePoint = (x, y) => { const id = w.newId(); w.state.points[id] = { x, y }; return id; };
  w.toast = (m) => w.toasts.push(String(m));
  w.pushHistory = () => { w.history++; };
  w.commit = () => { w.commits++; };
  w.invalidateLoops = () => {};
  w.cleanupPoints = () => {
    const used = new Set();
    for (const id in w.state.entities) {
      for (const pid of w.entityPointIds(w.state.entities[id])) used.add(+pid);
    }
    for (const id in w.state.points) if (!used.has(+id)) delete w.state.points[id];
  };
  w.entityPointIds = (e) => {
    if (!e) return [];
    if (e.type === 'note') return e.p != null ? [e.p] : [];
    if (e.type === 'spline') return e.pts || [];
    if (e.type === 'line') return [e.a, e.b];
    if (e.type === 'art') return [e.p0, e.pw, e.ph];
    return [];
  };
  w.removeEntity = (id) => { delete w.state.entities[+id]; };
  w.colorOf = (e) => (e && e.color) || '#000000';
  w.selectedEntities = () => w.ui.selection
    .filter(s => s.kind === 'entity' && w.state.entities[s.id])
    .map(s => w.state.entities[s.id]);
  w.groupableEntities = (ents) => ({ kept: ents.slice(), skipped: 0 });
  w.textGeom = (e) => e._geom || null;

  const body = [
    sliceOf(appSrc, 'addFramedObject'),
    sliceOf(appSrc, 'artNotesToEntities'),
    sliceOf(appSrc, 'cmdGroupSelection')
  ].join('\n');
  const api = new Function(
    'state', 'ui', 'newId', 'privatePoint', 'P', 'toast', 'pushHistory', 'commit',
    'invalidateLoops', 'cleanupPoints', 'entityPointIds', 'removeEntity', 'colorOf',
    'selectedEntities', 'groupableEntities', 'textGeom',
    'bakeContours', 'majorityColor', 'addFramedObjectCall', 'ensureTextAspect', 'layerOf',
    'getLayer', 'xfBlock',
    'let history = { pop() {}, length: 0 };\n' + body +
    '\nreturn { cmdGroupSelection, artNotesToEntities };'
  )(
    w.state, w.ui, w.newId, w.privatePoint, w.P, w.toast, w.pushHistory, w.commit,
    w.invalidateLoops, w.cleanupPoints, w.entityPointIds, w.removeEntity, w.colorOf,
    w.selectedEntities, w.groupableEntities, w.textGeom,
    // bake: one closed square contour from the selected splines
    (ents) => ({ contours: ents.filter(e => e.type === 'spline').flatMap(e => {
      const pts = (e.pts || []).map(id => w.state.points[id]).filter(Boolean);
      return pts.length >= 3 ? [{ pts, closed: true, color: e.color }] : [];
    }), curves: null }),
    () => ({ color: '#000000', mixed: false }),
    (c, o) => w.callAddFramed(c, o),
    () => null,
    (e) => (e && e.layer != null ? e.layer : 1),
    (id) => ({ id }),
    () => false
  );
  // addFramedObject is called inside cmdGroupSelection by name; route it
  w.callAddFramed = (contours, opts) => {
    const fn = new Function(
      'privatePoint', 'newId', 'state', 'ui', 'ensureTextAspect', 'artNotesToEntities',
      'let _unused = 0;\n' + sliceOf(appSrc, 'addFramedObject') + '\nreturn addFramedObject;'
    )(w.privatePoint, w.newId, w.state, w.ui, () => null, null);
    return fn(contours, opts);
  };
  return { w, api };
}

console.log('\n== a group keeps the comments it was made with ==');
{
  // the real code path, minus the DOM: build a document with one square and one
  // comment, select both, group them
  const w = {
    state: { points: {}, entities: {}, constraints: {}, layers: [{ id: 1, name: 'L', visible: true, locked: false }], nextId: 500 },
    ui: { activeLayer: 1, color: '#000000' },
    toasts: []
  };
  const newId = () => ++w.state.nextId;
  const pt = (x, y) => { const id = newId(); w.state.points[id] = { x, y }; return id; };
  const sq = [pt(0, 0), pt(100, 0), pt(100, 60), pt(0, 60)];
  const sid = newId();
  w.state.entities[sid] = {
    id: sid, type: 'spline', pts: sq, closed: true,
    hs: { o: sq.map(() => null), i: sq.map(() => null) }, color: '#000000', layer: 1
  };
  const npid = pt(50, 30);
  const nid = newId();
  w.state.entities[nid] = { id: nid, type: 'note', p: npid, text: 'hello', layer: 1 };

  // run the real addFramedObject with notes
  const addFramed = new Function(
    'privatePoint', 'newId', 'state', 'ui', 'ensureTextAspect', 'CONSTRUCTION_COLOR',
    sliceOf(appSrc, 'addFramedObject') + '\nreturn addFramedObject;'
  )(pt, newId, w.state, w.ui, () => null, '#00ff00');

  const artId = addFramed([{ pts: sq.map(id => w.state.points[id]), closed: true }],
    { color: '#000000', layer: 1, notes: [{ text: 'hello', p: { x: 50, y: 30 } }] });
  const art = w.state.entities[artId];
  check('the group stores the comment', Array.isArray(art.notes) && art.notes.length === 1,
    art.notes ? art.notes.length : 'none');
  check('with its text', art.notes[0].t === 'hello', art.notes[0] && art.notes[0].t);
  check('normalised into the frame (u, v in 0..1)',
    art.notes[0].u > 0 && art.notes[0].u < 1 && art.notes[0].v > 0 && art.notes[0].v < 1,
    art.notes[0].u + ',' + art.notes[0].v);
  check('at the right place: the middle of a 100x60 box',
    Math.abs(art.notes[0].u - 0.5) < 1e-9 && Math.abs(art.notes[0].v - 0.5) < 1e-9,
    art.notes[0].u + ',' + art.notes[0].v);

  // and the round trip: notes back as entities
  const back = new Function(
    'privatePoint', 'newId', 'state', 'ui', 'textGeom',
    sliceOf(appSrc, 'artNotesToEntities') + '\nreturn artNotesToEntities;'
  )(pt, newId, w.state, w.ui, () => ({
    p0: { x: 0, y: 60 }, A: { x: 100, y: 0 }, B: { x: 0, y: -60 }
  }))(art);
  check('ungroup gives the comment back as a note entity', back.length === 1, back.length);
  const note = w.state.entities[back[0]];
  check('with the same text', note && note.text === 'hello', note && note.text);
  const np = note && w.state.points[note.p];
  check('at the same world position', np && Math.abs(np.x - 50) < 1e-9 && Math.abs(np.y - 30) < 1e-9,
    np ? np.x + ',' + np.y : 'none');
}

console.log('\n== the grouping command does not swallow comments ==');
{
  const src = appSrc;
  check('notes are pulled out before baking',
    /const notes = \[\];\s*\n\s*const geo = \[\];[\s\S]{0,300}?e\.type !== 'note'/.test(src));
  check('baking runs on the geometry only', /bakeContours\(geo, \{ keepCurve: true \}\)/.test(src));
  check('the notes go into the new group',
    /addFramedObject\(merged, \{[^}]*notes \}/.test(src));
  check('a comment-only selection is refused, not turned into an empty group',
    /Those are comments only/.test(src));
  check('the note entities are removed only after being stored',
    /for \(const e of ents\) if \(e\.type === 'note'\) removeEntity/.test(src));
  check('the group draws its comments', /for \(const n of \(e\.notes \|\| \[\]\)\)/.test(src));
  check('and they survive save + load',
    /out\.notes = e\.notes\.map/.test(src) && /entities\[id\]\.notes = nn/.test(src));
  check('-> Curve hands them back too',
    /if \(e\.type === 'art'\) \{\s*\n\s*for \(const nid of artNotesToEntities\(e\)\) ids\.push\(nid\)/.test(src));
}

// ---------------------------------------------------------------------------
// A generator's own labels must end up INSIDE its group.
//
// The tools draw their panel labels as comments, but they were created after the
// panels were collected, so they never entered the selection that gets grouped:
// the group was built from the panels alone and dragging it left every label
// behind. Composition of two things already proven above:
//   - the tool puts its label ids into the selection (checked here), and
//   - cmdGroupSelection stores selected comments inside the group (checked above).
// ---------------------------------------------------------------------------
console.log('\n== a generator puts its labels inside the group ==');
{
  const Clipper = require(path.join(root, 'tools', 'clipper.js'));

  // A fake document + api that records which entities the tool selected, then
  // reports the ids that are comments.
  function runTool(file) {
    const src = fs.readFileSync(path.join(root, 'tools', file), 'utf8');
    const w = {
      state: { points: {}, entities: {}, constraints: {}, layers: [{ id: 1, name: 'L', visible: true, locked: false }], nextId: 1 },
      ui: { color: '#000000', activeLayer: 1, selection: [] },
      settings: { noteSize: 3 },
      toasts: [], selected: [], grouped: null
    };
    const el = (id) => ({ value: id.endsWith('-ok') ? '' : '', focus() {}, classList: { add() {}, remove() {} } });
    const fields = {};
    const doc = {
      getElementById: (id) => (id.endsWith('-modal')
        ? { classList: { add() {}, remove() {} } }
        : (fields[id] = fields[id] || el(id))),
      createElement: () => ({ classList: { add() {}, remove() {} }, appendChild() {}, addEventListener() {} })
    };
    const win = {};
    const store = {};
    const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };

    const api = {
      get state() { return w.state; },
      ui: w.ui, settings: w.settings,
      clamp: C.clamp,
      fmt: (n) => String(Math.round(n * 100) / 100),
      round2: C.round2,
      newId: () => ++w.state.nextId,
      privatePoint: (x, y) => { const id = ++w.state.nextId; w.state.points[id] = { x, y }; return id; },
      s2w: (x, y) => ({ x: (x - 640) / 1, y: -(y - 300) / 1 }),
      getW: () => 1280, getH: () => 600,
      // The real ones, so the tool exercises its own geometry path
      clipperLib: () => Clipper,
      offsetScale: 1000,
      offsetPrecision: 0.001,
      signedAreaPts: C.signedAreaPts,
      chainPolylines: C.chainPolylines,
      contentBounds: () => null,
      // wall.js works FROM a selection, so give it one closed shape
      selectedEntities: () => w.sel || [],
      colorOf: (e) => (e && e.color) || '#000000',
      entityPointIds: (e) => (e && e.type === 'spline' ? e.pts : []),
      entityWorldPolylines: (e) => [{ pts: (e.pts || []).map(i => w.state.points[i]), closed: !!e.closed }],
      bakeContours: (ents) => ({ contours: ents.filter(e => e.type === 'spline').flatMap(e => {
        const pts = (e.pts || []).map(i => w.state.points[i]).filter(Boolean);
        return pts.length >= 3 ? [{ pts, closed: true, color: e.color }] : [];
      }), curves: null }),
      // a real Clipper offset: wall.js is built on it and bails without it
      offsetClosedChains: (contours, dist, opts) => {
        const o = opts || {};
        const S = 1000;
        const paths = contours.map(c => c.pts.map(pt => ({
          X: Math.round(pt.x * S), Y: Math.round(pt.y * S)
        })));
        const jt = (o.join === 'round') ? Clipper.JoinType.jtRound : Clipper.JoinType.jtMiter;
        const co = new Clipper.ClipperOffset(o.miterLimit || 4, (o.arcTol || 0.05) * S);
        co.AddPaths(paths, jt, Clipper.EndType.etClosedPolygon);
        const raw = new Clipper.Paths();
        co.Execute(raw, dist * S);
        return raw.filter(q => q && q.length >= 3)
          .map(q => ({ pts: q.map(pt => ({ x: pt.X / S, y: pt.Y / S })), closed: true }));
      },
      pointInPoly: C.pointInPoly,
      normalizeWinding: (l) => l,
      addPanelEntity: (pts, color) => {
        const id = ++w.state.nextId;
        const pids = pts.map(p => { const pid = ++w.state.nextId; w.state.points[pid] = { x: p.x, y: p.y }; return pid; });
        w.state.entities[id] = { id, type: 'spline', pts: pids, closed: true, color, layer: 1, hs: { o: pids.map(() => null), i: pids.map(() => null) } };
        return id;
      },
      addPolylineEntity: () => null,
      // the new builder, exactly as app.js implements it
      addNote: (text, x, y) => {
        const t = String(text == null ? '' : text);
        if (!t.trim() || !isFinite(+x) || !isFinite(+y)) return null;
        const pid = ++w.state.nextId; w.state.points[pid] = { x, y };
        const id = ++w.state.nextId;
        w.state.entities[id] = { id, type: 'note', p: pid, text: t, layer: 1 };
        return id;
      },
      pushHistory: () => {},
      commit: () => {},
      toast: (m) => w.toasts.push(String(m)),
      cmdGroupSelection: () => {
        w.selected = w.ui.selection.map(q => ({ kind: q.kind, id: q.id, type: w.state.entities[q.id] && w.state.entities[q.id].type }));
        w.grouped = { count: w.selected.length };
        // stand in for the real wrap: one 'art' holding everything selected
        const gid = ++w.state.nextId;
        w.state.entities[gid] = { id: gid, type: 'art', contours: [[[0, 0]]], color: '#000000', layer: 1 };
        w.ui.selection = [{ kind: 'entity', id: gid }];
      }
    };

    // a 300 x 200 closed shape to feed wall.js
    const shapePts = [];
    for (let i = 0; i < 40; i++) {
      const a = Math.PI * 2 * i / 40;
      shapePts.push({ x: 150 + 120 * Math.cos(a), y: 100 + 80 * Math.sin(a) });
    }
    const spids = shapePts.map(p => { const id = ++w.state.nextId; w.state.points[id] = { x: p.x, y: p.y }; return id; });
    const sid = ++w.state.nextId;
    w.state.entities[sid] = { id: sid, type: 'spline', pts: spids, closed: true, color: '#000000', layer: 1, hs: { o: spids.map(() => null), i: spids.map(() => null) } };
    w.sel = [w.state.entities[sid]];

    new Function('window', 'document', 'localStorage', fs.readFileSync(path.join(root, 'tools', 'registry.js'), 'utf8'))
      (win, doc, localStorage);
    new Function('window', 'document', 'localStorage', src)(win, doc, localStorage);
    const tool = win.MiniSketchTools.list[0];
    tool.open(api, null);
    tool.apply(api);
    return { w, selected: w.selected, toasts: w.toasts };
  }

  for (const file of ['hinge.js', 'wall.js']) {
    const r = runTool(file);
    const notes = r.selected.filter(q => q.type === 'note');
    const shapes = r.selected.filter(q => q.type === 'spline');
    check(file + ': the tool selected both shapes and labels',
      shapes.length > 0 && notes.length > 0,
      shapes.length + ' shapes, ' + notes.length + ' labels');
    check(file + ': every label it drew is in the selection',
      notes.length === Object.values(r.w.state.entities).filter(q => q.type === 'note').length,
      notes.length + ' of ' + Object.values(r.w.state.entities).filter(q => q.type === 'note').length);
    check(file + ': so the group will contain them', notes.length > 0);
  }
}

console.log('\n' + (fail ? fail + ' FAILED, ' : 'all ') + pass + ' checks passed');
process.exit(fail ? 1 : 0);
