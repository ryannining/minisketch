// Probe: the Array tool must accept framed objects as masters.
//
// Text, a traced picture and every group a tool produces (Box / Gear / Slot /
// Extrude wall) is ONE `art` entity: three frame points plus contours. The
// array used to filter the selection down to line/arc/circle/spline, so those
// were refused outright. This pins the fix and the behaviour around it:
//   - text / art / generated groups are accepted and snapshotted correctly
//   - a group keeps its PER-CONTOUR colours and its loop fill
//   - green construction guide lines are not cloned
//   - an image is refused with a message that says what to do instead
//   - editing a master refreshes the clones (no "press OK" step)
//
// Run: node testing/array_probe.js
const fs = require('fs');
const path = require('path');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
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

function makeWorld() {
  const world = {
    state: {
      points: {}, entities: {}, constraints: {}, 
      layers: [{ id: 1, name: 'Layer 1', visible: true, locked: false }],
      nextId: 300
    },
    ui: { selection: [], activeLayer: 1, focusLoop: null, arrayDraft: null },
    settings: { joinTol: 0.1 },
    toasts: [], history: 0, commits: 0
  };
  world.newId = () => ++world.state.nextId;
  world.P = (id) => world.state.points[+id] || null;
  world.privatePoint = (x, y) => {
    const id = world.newId();
    world.state.points[id] = { x, y };
    return id;
  };
  world.toast = (m) => world.toasts.push(String(m));
  world.round2 = (v) => Math.round(v * 100) / 100;
  world.pushHistory = () => { world.history++; };
  world.commit = () => { world.commits++; };
  world.colorOf = (e) => (e && e.color) || '#000000';
  world.xfBlock = () => false;
  world.entityPointIds = (e) => {
    if (!e) return [];
    if (e.type === 'line') return [e.a, e.b];
    if (e.type === 'spline') return e.pts || [];
    if (e.type === 'circle') return [e.c];
    if (e.type === 'text' || e.type === 'art' || e.type === 'image') return [e.p0, e.pw, e.ph];
    return [];
  };
  world.entityWorldPolylines = (e) => {
    if (!e) return [];
    if (e.type === 'spline') {
      const pts = (e.pts || []).map(i => world.P(i)).filter(Boolean).map(p => ({ x: p.x, y: p.y }));
      return pts.length >= 2 ? [{ pts, closed: !!e.closed }] : [];
    }
    if (e.type === 'line') {
      const a = world.P(e.a), b = world.P(e.b);
      return a && b ? [{ pts: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }], closed: false }] : [];
    }
    if (e.type === 'art') {
      return (e._loops || []).map(l => ({ pts: l.pts, closed: l.closed !== false }));
    }
    return [];
  };
  // the fake art exposes its contours directly instead of going through the frame
  world.artContoursWorld = (e) => (e._loops || []).map(l => ({
    pts: l.pts, closed: l.closed !== false,
    color: l.color || null, fill: l.fill || null
  }));
  world.textContoursWorld = (e) => e._textLoops || [];
  // the probe's text feeds traced loops, so the outline accessor hands them on
  world.textOutlineWorld = (e) => ({ loops: e._textLoops || [], closed: true });
  world.isSingleLineFont = () => false;
  world.textStrokesWorld = () => [];
  world.selectedEntities = () => world.ui.selection
    .filter(s => s.kind === 'entity' && world.state.entities[s.id])
    .map(s => world.state.entities[s.id]);
  world.groupableEntities = (ents) => {
    // mirrors the real rule: construction-coloured entities are not grouped
    const kept = [];
    let skipped = 0;
    for (const e of ents || []) {
      const col = String(world.colorOf(e)).trim().toLowerCase();
      if (col === '#00ff00') skipped++;
      else kept.push(e);
    }
    return { kept, skipped };
  };
  world.openArrayDialog = null;   // filled in by build()
  return world;
}

function build(world) {
  const body = [
    slice('arrayShapesOf'),
    slice('arrayEnsureShapes'),
    slice('arrayReanchorGuide'),
    slice('arrayBuildShapes'),
    slice('arrayInstancePolylines'),
    slice('arrayInstanceOffsets'),
    slice('arrayXformPoint'),
    // cmdCreateArray resolves the selection through selectedEntitiesForExport,
    // which lives further up app.js and was never carried into this harness
    slice('selectedEntitiesForExport'),
    // selectedEntitiesForExport asks ownedGuideIds which construction lines
    // belong to a frame; a stub made every green line look foreign and the
    // guide test failed for the wrong reason.
    slice('ownedGuideIds'),
    slice('cmdCreateArray')
  ].join('\n');
  return new Function(
    'state', 'ui', 'settings', 'newId', 'P', 'privatePoint', 'toast', 'round2',
    'pushHistory', 'commit', 'colorOf', 'xfBlock', 'entityPointIds',
    'entityWorldPolylines', 'artContoursWorld', 'textContoursWorld',
    'textOutlineWorld', 'isSingleLineFont', 'textStrokesWorld',
    'textGeom', 'artClosedFlags',
    'selectedEntities', 'groupableEntities', 'openArrayDialog', 'isConstructionColor',
    'selectionIndex', 'containerOf', 'getLayer',
    `let geometryEpoch = 0;
     ${body}
     return {
       cmdCreateArray, arrayShapesOf, arrayBuildShapes,
       arrayInstancePolylines, arrayInstanceOffsets,
       bumpGeometry: () => { geometryEpoch++; },
       getEpoch: () => geometryEpoch
     };`
  )(
    world.state, world.ui, world.settings, world.newId, world.P, world.privatePoint,
    world.toast, world.round2, world.pushHistory, world.commit, world.colorOf,
    world.xfBlock, world.entityPointIds, world.entityWorldPolylines,
    world.artContoursWorld, world.textContoursWorld,
    // textOutlineWorld / isSingleLineFont / textStrokesWorld stand-ins: the
    // probe feeds contours through _geom, so single-line stays off
    (e) => ({ loops: e._textLoops || [], closed: true }),
    () => false,
    () => [],
    (e) => e._geom || null,
    (e) => (e.closed || []).map(v => v !== false),
    world.selectedEntities,
    world.groupableEntities,
    (id, masters) => { world.opened = { id, masters }; },
    (c) => c === '#00ff00',
    () => ({ point: new Set(), entity: new Set() }),
    () => null,
    (id) => (id === 1 ? world.state.layers[0] : null)
  );
}

// a text object: frame + glyph contours
function makeText(world, text) {
  const p0 = world.privatePoint(0, 0);
  const pw = world.privatePoint(100, 0);
  const ph = world.privatePoint(0, 40);
  const id = world.newId();
  world.state.entities[id] = {
    id, type: 'text', p0, pw, ph, guide: [], text, color: '#000000', layer: 1,
    _textLoops: [
      // an "O"-ish square ring: outer + hole
      [{ x: 10, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 20 }, { x: 10, y: 20 }],
      [{ x: 15, y: 5 }, { x: 25, y: 5 }, { x: 25, y: 15 }, { x: 15, y: 15 }]
    ]
  };
  return id;
}

// a group from a tool: two contours with different colours and one fill
function makeGroup(world) {
  const p0 = world.privatePoint(0, 0);
  const pw = world.privatePoint(50, 0);
  const ph = world.privatePoint(0, 50);
  const id = world.newId();
  // geometry lives in contours normalised to the frame; here the frame is a
  // 50x50 identity box at the origin, so contours are world/mm directly
  world.state.entities[id] = {
    id, type: 'art', p0, pw, ph, guide: [], color: '#000000', layer: 1,
    _geom: { p0: { x: 0, y: 0 }, A: { x: 50, y: 0 }, B: { x: 0, y: 50 } },
    contours: [
      [[0, 0], [0.8, 0], [0.8, 0.6], [0, 0.6]],
      [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4], [0.2, 0.4]]
    ],
    contourColors: ['#ff0000', '#0000ff'],
    contourFills: ['yellow', null],
    closed: [true, true],
    _loops: [
      { pts: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 0, y: 30 }], closed: true, color: '#ff0000', fill: 'yellow' },
      { pts: [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }, { x: 10, y: 20 }], closed: true, color: '#0000ff', fill: null }
    ]
  };
  return id;
}

const grid1 = (world, masters) => {
  const id = world.newId();
  world.state.entities[id] = {
    id, type: 'array', kind: 'grid', params: { rows: 2, cols: 2, dx: 100, dy: -100 },
    color: '#000000', layer: 1, masters
  };
  return id;
};

// ---- 1. group / text masters are accepted ------------------------------
console.log('\n== framed objects are accepted ==');
{
  const world = makeWorld();
  const api = build(world);
  const textId = makeText(world, 'O');

  world.ui.selection = [{ kind: 'entity', id: textId }];
  api.cmdCreateArray();
  check('a text object opens the array dialog', !!world.opened, world.toasts.join(' | '));
  check('with the text as its master',
    world.opened && world.opened.masters.length === 1 && world.opened.masters[0] === textId);
  check('no "select geometry" complaint',
    !world.toasts.some(t => /Select geometry/.test(t)), world.toasts.join(' | '));

  const shapes = api.arrayBuildShapes([textId]);
  check('the glyph contours became array shapes', shapes.length === 2, shapes.length);
  check('both contours are closed', shapes.every(s => s.closed));
  check('the frame points are not used as geometry (no 100x40 box)',
    Math.max(...shapes.flatMap(s => s.pts.map(p => p[0]))) <= 30,
    Math.max(...shapes.flatMap(s => s.pts.map(p => p[0]))));
}

// ---- 2. a tool group keeps its colours and fill -----------------------
console.log('\n== a group keeps its per-contour colour and fill ==');
{
  const world = makeWorld();
  const api = build(world);
  const artId = makeGroup(world);
  world.ui.selection = [{ kind: 'entity', id: artId }];
  api.cmdCreateArray();
  check('the group opens the dialog', !!world.opened);

  const shapes = api.arrayBuildShapes([artId]);
  check('two contours', shapes.length === 2);
  const colours = shapes.map(s => s.color).sort();
  check('each contour keeps its own colour',
    colours[0] === '#0000ff' && colours[1] === '#ff0000', colours.join(','));
  check('the filled contour keeps its fill',
    shapes.some(s => s.fill === 'yellow') && shapes.some(s => !s.fill),
    shapes.map(s => s.fill || '-').join(','));

  // and the clones carry it through arrayInstancePolylines' source shapes
  const arrId = grid1(world, [artId]);
  const inst = api.arrayInstancePolylines(world.state.entities[arrId], { dx: 100, dy: 0 });
  check('the instance keeps both colours', inst.length === 2);
  check('and it is really moved by the offset',
    Math.min(...inst.flatMap(i => i.pts.map(p => p.x))) === 100,
    Math.min(...inst.flatMap(i => i.pts.map(p => p.x))));
}

// ---- 3. guide lines are not cloned ------------------------------------
console.log('\n== green construction lines stay out ==');
{
  const world = makeWorld();
  const api = build(world);
  const textId = makeText(world, 'O');
  // the guide line the text owns
  const g = world.newId();
  const a = world.privatePoint(0, 0), b = world.privatePoint(100, 0);
  world.state.entities[g] = { id: g, type: 'line', a, b, color: '#00ff00', layer: 1 };
  // A framed object records its own construction lines in `guide`. Without this
  // the fixture is not a text that owns a guide, it is a text plus an unrelated
  // green line — and cmdCreateArray correctly keeps both.
  world.state.entities[textId].guide = [g];

  world.ui.selection = [{ kind: 'entity', id: textId }, { kind: 'entity', id: g }];
  api.cmdCreateArray();
  check('the text is the only master',
    world.opened && world.opened.masters.length === 1 && world.opened.masters[0] === textId,
    world.opened ? world.opened.masters.join(',') : 'none');
}

// ---- 4. an image is refused with guidance -----------------------------
console.log('\n== an image says what to do instead ==');
{
  const world = makeWorld();
  const api = build(world);
  const p0 = world.privatePoint(0, 0);
  const pw = world.privatePoint(10, 0);
  const ph = world.privatePoint(0, 10);
  const id = world.newId();
  world.state.entities[id] = { id, type: 'image', p0, pw, ph, src: 'data:', iw: 1, ih: 1, layer: 1 };
  world.ui.selection = [{ kind: 'entity', id }];
  api.cmdCreateArray();
  check('no dialog opens', !world.opened);
  check('the message explains the trace route',
    world.toasts.some(t => /picture cannot be arrayed.*trace it/i.test(t)),
    world.toasts.join(' | '));
}

// ---- 5. an array of an array is refused -------------------------------
console.log('\n== arraying an array is refused ==');
{
  const world = makeWorld();
  const api = build(world);
  const artId = makeGroup(world);
  const arrId = grid1(world, [artId]);
  world.ui.selection = [{ kind: 'entity', id: arrId }];
  api.cmdCreateArray();
  check('no dialog opens', !world.opened);
  check('and it says why', world.toasts.some(t => /cannot hold another array/i.test(t)),
    world.toasts.join(' | '));
}

// ---- 6. mixed selection: supported ones go in, the rest is reported ---
console.log('\n== a mixed selection keeps what it can ==');
{
  const world = makeWorld();
  const api = build(world);
  const textId = makeText(world, 'O');
  const p0 = world.privatePoint(0, 0);
  const pw = world.privatePoint(10, 0);
  const ph = world.privatePoint(0, 10);
  const img = world.newId();
  world.state.entities[img] = { id: img, type: 'image', p0, pw, ph, src: 'data:', iw: 1, ih: 1, layer: 1 };
  world.ui.selection = [{ kind: 'entity', id: textId }, { kind: 'entity', id: img }];
  api.cmdCreateArray();
  check('the text still becomes the master',
    world.opened && world.opened.masters.length === 1 && world.opened.masters[0] === textId);
  check('and the skipped object is reported',
    world.toasts.some(t => /1 object left out of the array/.test(t)), world.toasts.join(' | '));
}

// ---- 7. editing a master refreshes the clones ------------------------
console.log('\n== the snapshot follows the master ==');
{
  const world = makeWorld();
  const api = build(world);
  const artId = makeGroup(world);
  const arrId = grid1(world, [artId]);
  const arr = world.state.entities[arrId];

  const first = api.arrayInstancePolylines(arr, { dx: 100, dy: 0 });
  const firstMaxX = Math.max(...first[0].pts.map(p => p.x));

  // move the master contour by 7 mm (normalised units: 7/50 of the frame) and
  // signal a geometry change
  const art = world.state.entities[artId];
  art.contours = art.contours.map((loop, i) =>
    (i === 0 ? loop.map(([u, v]) => [u + 7 / 50, v]) : loop));
  art._loops[0].pts = art._loops[0].pts.map(p => ({ x: p.x + 7, y: p.y }));
  const cached = api.arrayInstancePolylines(arr, { dx: 100, dy: 0 });
  check('without a geometry change the snapshot is reused (cheap)',
    Math.max(...cached[0].pts.map(p => p.x)) === firstMaxX);

  api.bumpGeometry();
  const fresh = api.arrayInstancePolylines(arr, { dx: 100, dy: 0 });
  check('after invalidateLoops the clones pick the edit up automatically',
    Math.max(...fresh[0].pts.map(p => p.x)) === firstMaxX + 7,
    Math.max(...fresh[0].pts.map(p => p.x)) + ' vs ' + (firstMaxX + 7));
}

// ---- 8. the dialog defaults come from the glyphs, not the frame ------
console.log('\n== spacing defaults use real geometry ==');
{
  const world = makeWorld();
  const api = build(world);
  const textId = makeText(world, 'O');
  world.ui.selection = [{ kind: 'entity', id: textId }];
  api.cmdCreateArray();
  // openArrayDialog is stubbed, so check the bounds the dialog would measure
  const shapes = api.arrayBuildShapes([textId]);
  const xs = shapes.flatMap(s => s.pts.map(p => p[0]));
  const ys = shapes.flatMap(s => s.pts.map(p => p[1]));
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  check('the measured span is the glyph span (20 x 20), not the 100 x 40 frame',
    spanX === 20 && spanY === 20, spanX + ' x ' + spanY);
}

// ---- the clone must be drawn from the SAME geometry as its master -------
// Reported: a group arrayed as visibly faceted clones, with small holes turning
// into hexagons. Ungrouping first made it smooth. Cause: drawArtEntity() draws
// the stored contours through the frame, while arrayShapesOf() went through
// artContoursWorld(), which applies the "Object detail" (rdp) tolerance. The
// clone was therefore a simplified outline of its own master.
console.log('\n== a clone is not a simplified master ==');
{
  const world = makeWorld();
  const api = build(world);

  // a smooth 200-point circle stored as a group, plus a tiny 24-point hole
  const circleLoop = (r, n, cu, cv) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = Math.PI * 2 * i / n;
      out.push([cu + (r * Math.cos(a)) / 200, cv + (r * Math.sin(a)) / 200]);
    }
    return out;
  };
  const p0 = world.privatePoint(0, 0);
  const pw = world.privatePoint(200, 0);
  const ph = world.privatePoint(0, 200);
  const id = world.newId();
  world.state.entities[id] = {
    id, type: 'art', p0, pw, ph, guide: [], color: '#000000', layer: 1,
    _geom: { p0: { x: 0, y: 0 }, A: { x: 200, y: 0 }, B: { x: 0, y: 200 } },
    contours: [circleLoop(80, 200, 0.5, 0.5), circleLoop(12, 24, 0.5, 0.5)],
    contourColors: ['#000000', '#000000'],
    closed: [true, true]
  };

  const shapes = api.arrayBuildShapes([id]);
  check('both contours come through', shapes.length === 2, shapes.length);
  check('the outer contour keeps all 200 points', shapes[0].pts.length === 200,
    shapes[0].pts.length);
  check('the small hole keeps all 24 points', shapes[1].pts.length === 24,
    shapes[1].pts.length);

  // the frame maps [0,1] onto 200 mm, so the outer circle is r=80 about (100,100)
  const r = shapes[0].pts.map(p => Math.hypot(p[0] - 100, p[1] - 100));
  check('the clone is a true r=80 circle, not a polygon approximation',
    Math.max(...r.map(v => Math.abs(v - 80))) < 1e-6,
    Math.max(...r.map(v => Math.abs(v - 80))));

  // and it matches what drawArtEntity would draw (same contours, same frame)
  const gg = world.state.entities[id]._geom;
  const drawn = world.state.entities[id].contours[0].map(([u, v]) => [
    gg.p0.x + u * gg.A.x + v * gg.B.x,
    gg.p0.y + u * gg.A.y + v * gg.B.y
  ]);
  check('the clone points are exactly the master contour mapped through the frame',
    shapes[0].pts.length === drawn.length &&
    shapes[0].pts.every((p, i) => Math.abs(p[0] - drawn[i][0]) < 1e-9 &&
      Math.abs(p[1] - drawn[i][1]) < 1e-9));

  // What the old code did: simplify with the Object detail tolerance (0.1 mm by
  // default, followed live from Settings) and clone that. The RDP is the real one
  // from app.js, so the comparison is honest.
  const rdp = new Function(slice('rdpSimplify') + '\nreturn rdpSimplify;')();
  const closedRing = drawn.concat([drawn[0]]);
  const simplifiedPts = rdp(closedRing, 0.1);
  check('the simplified outline really is coarser (this is what used to be cloned)',
    simplifiedPts.length < 200, simplifiedPts.length + ' vs 200');
  // 200 -> 73 points at the default 0.1 mm detail; larger values are worse
  check('and that loss is what made the clones look faceted',
    simplifiedPts.length < 100, simplifiedPts.length);
  const coarse = rdp(closedRing, 2);
  check('a coarse Object detail shreds it further (the hexagon case)',
    coarse.length < 25, coarse.length);
}

// ---- 9. the grid guide stays glued to the master's top-left ----------
console.log('\n== the guide stays glued to the master top-left ==');
{
  const world = makeWorld();
  const api = build(world);
  const artId = makeGroup(world);
  const arrId = grid1(world, [artId]);
  const arr = world.state.entities[arrId];
  // give the array the guide points a real createArrayGuides() would have made:
  // p0 at the master's top-left (minX, maxY) and pw/ph as the spacing vectors
  // (the group's world bbox is 0..40 x 0..30, so its top-left is 0,30)
  const p0 = world.privatePoint(0, 30);
  const pw = world.privatePoint(100, 30);
  const ph = world.privatePoint(0, 130);
  arr.p0 = p0; arr.pw = pw; arr.ph = ph;

  // a geometry change that shifts the master by +10 in both axes — its top-left
  // moves from (0,30) to (10,40)
  const art = world.state.entities[artId];
  art.contours = art.contours.map(loop =>
    loop.map(([u, v]) => [u + 10 / 50, v + 10 / 50]));
  art._loops = art._loops.map(loop => ({
    ...loop,
    pts: loop.pts.map(p => ({ x: p.x + 10, y: p.y + 10 }))
  }));
  api.bumpGeometry();
  api.arrayInstancePolylines(arr, { dx: 100, dy: 0 });  // triggers arrayEnsureShapes

  check('the guide anchor follows the master top-left',
    world.P(p0).x === 10 && world.P(p0).y === 40,
    world.P(p0).x + ',' + world.P(p0).y + ' vs 10,40');
  check('the spacing vectors are preserved (clones do not move)',
    world.P(pw).x - world.P(p0).x === 100 &&
    world.P(ph).y - world.P(p0).y === 100,
    (world.P(pw).x - world.P(p0).x) + ',' +
    (world.P(ph).y - world.P(p0).y));
}

console.log('\n' + (fail ? fail + ' FAILED, ' : 'all ') + pass + ' checks passed');
process.exit(fail ? 1 : 0);
