// Probe for the SVG importer: units, colours, transforms, path data, style
// inheritance, the tree walker, clips and insertion into the document.
//
// Run: node testing/svg_import_probe.js
const fs = require('fs');
const path = require('path');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const ClipperLib = require(path.join(__dirname, '..', 'tools', 'clipper.js'));
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};
const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 1e-6 : tol);

// Brace scanner that skips strings, template literals and regex literals: the
// style-sheet parser has "{...}" inside a regular expression.
function braceEnd(src, from) {
  let depth = 0;
  let mode = null;
  let klass = false;                 // inside a regex [...] character class
  for (let i = src.indexOf('{', from); i < src.length; i++) {
    const c = src[i];
    if (mode) {
      if (c === '\\') { i++; continue; }
      if (mode === '/' && c === '[') { klass = true; continue; }
      if (mode === '/' && c === ']') { klass = false; continue; }
      if (c === mode && !klass) mode = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { mode = c; continue; }
    if (c === '/' && src[i + 1] !== '/' && src[i + 1] !== '*') {
      const prev = src.slice(Math.max(0, i - 2), i).trim().slice(-1);
      if (!prev || '=(,:[!&|?{};+-*%~^'.indexOf(prev) >= 0) { mode = '/'; continue; }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) return i + 1; }
  }
  throw new Error('unbalanced');
}
const sliceApp = (name) => {
  const start = appSrc.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('not found: ' + name);
  let i = appSrc.indexOf('(', start), depth = 0;
  for (; i < appSrc.length; i++) {
    if (appSrc[i] === '(') depth++;
    else if (appSrc[i] === ')') { depth--; if (!depth) break; }
  }
  return appSrc.slice(start, braceEnd(appSrc, i));
};

// matMul / matApply / matDet / matIsSimilarity moved to core.js
const Core = require(path.join(__dirname, '..', 'core.js'));
const sliceAppOrCore = (name) => {
  try { return sliceApp(name); } catch (err) { return Core[name].toString(); }
};
const COLORS = ['#000000', '#0000ff', '#00ffff', '#800080', '#ff0000', '#00ff00', '#800000', '#008080'];
const CNC_CODES = COLORS;
const NAMES = [
  'svgLenToMm', 'svgColorToHex', 'hexToRgb', 'rgbToLab', 'colorDistanceLab', 'nearestCncColor',
  'matMul', 'matApply', 'matDet', 'matIsSimilarity', 'parseTransformList',
  'svgArcToCubics', 'svgPathSegments', 'svgSegmentsToSubpaths',
  'svgStyleDecls', 'svgParseStyleSheets', 'svgApplyRules', 'svgStyleFor', 'svgHidden',
  'svgLocalId', 'svgHref', 'svgPointsAttr', 'svgRoundRectSegs', 'svgEllipseSegs', 'svgShapeSegs',
  'svgWalk', 'svgResolveClip', 'svgOwnBBox', 'svgCollectBounds', 'svgSubpathPolygon',
  'svgClipSubpaths', 'svgImportParse', 'svgImportInsert', 'svgName'
];

const state = { points: {}, entities: {}, constraints: {}, layers: [{ id: 1, name: 'Layer 1' }] };

const api = new Function(
  'COLORS', 'CNC_CODES', 'ClipperLib', 'OFFSET_SCALE', 'MAT_ID', 'SVG_MM_PER', 'SVG_DEFAULT_STYLE', 'SVG_SHAPES',
  'SVG_CONTAINERS', 'SVG_NAMED', 'state', 'ui', 'privatePoint', 'newId', 's2w', 'W', 'H',
  'addFramedObject', 'ART_TOL_MM', 'clipperLib', 'pathBoolLib', 'toast', 'invalidateLoops', 'settings', 'pasteTrace',
  'const COLORS_ = COLORS;\n' +
  NAMES.map(sliceAppOrCore).join('\n') +
  '\nreturn {' + NAMES.join(',') + ', COLORS_};'
)(
  COLORS, CNC_CODES, ClipperLib, 1000, [1, 0, 0, 1, 0, 0],
  { mm: 1, cm: 10, m: 1000, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, q: 0.25 },
  { stroke: 'none', fill: '#000000', strokeWidth: '1', fillRule: 'nonzero', display: null, visibility: null, opacity: null },
  { path: 1, polyline: 1, polygon: 1, line: 1, rect: 1, circle: 1, ellipse: 1 },
  { g: 1, svg: 1, a: 1, switch: 1, symbol: 1, defs: 1, clippath: 1, marker: 1, mask: 1, pattern: 1 },
  {
    black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', lime: '#00ff00',
    blue: '#0000ff', yellow: '#ffff00', cyan: '#00ffff', magenta: '#ff00ff', fuchsia: '#ff00ff',
    gray: '#808080', grey: '#808080', silver: '#c0c0c0', maroon: '#800000', olive: '#808000',
    navy: '#000080', purple: '#800080', teal: '#008080', orange: '#ffa500'
  },
  state,
  { activeLayer: 1, selection: [] },
  (x, y) => { const id = api._nextPoint = (api._nextPoint || 0) + 1; api.__points = api.__points || {}; api.__points[id] = { x, y }; state.points[id] = { x, y }; return id; },
  () => { const id = api._nextEntity = (api._nextEntity || 1000) + 1; return id; },
  () => ({ x: 0, y: 0 }),
  800, 600,
  function addFramedObjectStub(contours, opts) {
    const id = api._nextEntity = (api._nextEntity || 1000) + 1;
    state.entities[id] = { id, type: 'art', contours: contours.map(c => ({ pts: c.pts.slice(), closed: !!c.closed })), name: opts && opts.name };
    api.__framed = api.__framed || [];
    api.__framed.push({ id, contours, opts });
    return id;
  },
  0.1,
  () => ClipperLib,
  // the SVG clip runs on the exact engine: hand the probe the real library
  () => {
    require(path.join(__dirname, '..', 'tools', 'path-bool.js'));
    return global.PathBool;
  },
  () => {},
  () => {},
  // auto-join is off: this probe is about SVG geometry, and joinImportedSegments
  // belongs to the settings > geometry feature rather than the importer
  { joinImportAuto: 'off', joinImportTol: 0.02 },
  () => {}
);
// --- tiny DOM stand-in ------------------------------------------------------
function el(tag, attrs, kids, text) {
  const a = attrs || {};
  return {
    nodeName: tag,
    nodeType: 1,
    childNodes: kids || [],
    textContent: text || a.__text || '',
    getAttribute: (k) => (k in a ? a[k] : null),
    hasAttribute: (k) => k in a
  };
}
const group = (attrs, kids) => el('g', attrs, kids);
const baseMat = (scale, vbX, vbY, flip) => [scale, 0, 0, flip === false ? scale : -scale, -vbX * scale, (vbY || 0) * scale];

console.log('\n== units ==');
{
  check('mm stays mm', api.svgLenToMm('210mm') === 210);
  check('cm is 10 mm', api.svgLenToMm('2cm') === 20);
  check('inch is 25.4 mm', near(api.svgLenToMm('8.27in'), 210.058, 0.01));
  check('a bare number is a CSS pixel', near(api.svgLenToMm('96'), 25.4, 1e-9));
  check('a percentage is refused', api.svgLenToMm('100%') === null);
  check('junk is refused', api.svgLenToMm('abc') === null);
}

console.log('\n== colours ==');
{
  check('#f00 expands', api.svgColorToHex('#f00') === '#ff0000');
  check('#FF0000 lowercases', api.svgColorToHex('#FF0000') === '#ff0000');
  check('rgb() converts', api.svgColorToHex('rgb(0, 0, 255)') === '#0000ff');
  check('rgba(...,0) is invisible', api.svgColorToHex('rgba(255,0,0,0)') === null);
  check('none is nothing', api.svgColorToHex('none') === null);
  check('named colours work', api.svgColorToHex('navy') === '#000080');
  check('a gradient url is refused', api.svgColorToHex('url(#grad)') === null);
  for (const code of COLORS) {
    check(code + ' maps to itself', api.nearestCncColor(code) === code, api.nearestCncColor(code));
  }
  check('near-black maps to cut', api.nearestCncColor('#0a0a0a') === '#000000');
  check('a dark red maps to maroon or red',
    ['#800000', '#ff0000'].indexOf(api.nearestCncColor('#a01010')) >= 0, api.nearestCncColor('#a01010'));
}

console.log('\n== transforms ==');
{
  check('translate moves a point', JSON.stringify(api.matApply(api.parseTransformList('translate(10,20)'), { x: 1, y: 2 })) ===
    JSON.stringify({ x: 11, y: 22 }));
  check('rotate(90) turns +x into +y',
    near(api.matApply(api.parseTransformList('rotate(90)'), { x: 1, y: 0 }).y, 1, 1e-9));
  check('a list applies right to left',
    JSON.stringify(api.matApply(api.parseTransformList('translate(10,0) scale(2)'), { x: 1, y: 1 })) ===
    JSON.stringify({ x: 12, y: 2 }));
  check('rotate about a point keeps that point',
    near(api.matApply(api.parseTransformList('rotate(45, 10, 10)'), { x: 10, y: 10 }).x, 10, 1e-9));
  check('matrix() is read literally',
    api.matApply(api.parseTransformList('matrix(1 0 0 1 5 5)'), { x: 0, y: 0 }).x === 5);
  check('rotation is a similarity', api.matIsSimilarity(api.parseTransformList('rotate(30) scale(2)')));
  check('non-uniform scale is not', !api.matIsSimilarity(api.parseTransformList('scale(2,1)')));
  check('shear is not', !api.matIsSimilarity(api.parseTransformList('skewX(20)')));
  check('a mirror is a similarity', api.matIsSimilarity(api.parseTransformList('scale(-1,1)')));
  check('the determinant of a mirror is negative', api.matDet(api.parseTransformList('scale(-1,1)')) < 0);
}

console.log('\n== path data ==');
{
  const segs = api.svgPathSegments('M0 0 L10 0 L10 10 Z');
  // the closing segment is written out explicitly, then Z
  check('the close is explicit', segs.filter(s => s.t === 'L').length === 3 && segs[segs.length - 1].t === 'Z',
    segs.map(s => s.t).join(''));
  const subs = api.svgSegmentsToSubpaths(segs, [1, 0, 0, 1, 0, 0]);
  check('one closed subpath', subs.length === 1 && subs[0].closed);
  check('three nodes (the repeated first is dropped)', subs[0].nodes.length === 3, subs[0].nodes.length);
  check('a straight path is not curved', subs[0].curved === false);

  const rel = api.svgPathSegments('m10 10 l5 0 l0 5');
  const relSubs = api.svgSegmentsToSubpaths(rel, [1, 0, 0, 1, 0, 0]);
  check('relative commands accumulate',
    near(relSubs[0].nodes[2].x, 15) && near(relSubs[0].nodes[2].y, 15),
    JSON.stringify(relSubs[0].nodes));

  const cubic = api.svgSegmentsToSubpaths(api.svgPathSegments('M0 0 C 10 0 10 10 20 10'), [1, 0, 0, 1, 0, 0]);
  check('a cubic becomes a curved subpath', cubic[0].curved === true);
  check('the outgoing handle is kept', cubic[0].nodes[0].o && near(cubic[0].nodes[0].o.x, 10));
  check('the incoming handle is kept', cubic[0].nodes[1].i && near(cubic[0].nodes[1].i.x, 10));
  check('two nodes for one cubic', cubic[0].nodes.length === 2);

  const quad = api.svgSegmentsToSubpaths(api.svgPathSegments('M0 0 Q 10 0 10 10'), [1, 0, 0, 1, 0, 0]);
  check('a quadratic is raised to a cubic', quad[0].curved && near(quad[0].nodes[0].o.x, 20 / 3, 1e-6),
    quad[0].nodes[0].o && quad[0].nodes[0].o.x);

  const smooth = api.svgPathSegments('M0 0 C 0 0 10 0 10 10 S 20 20 20 0').filter(s => s.t === 'C');
  check('S mirrors the previous control point', smooth.length === 2 && smooth[1].c1 && near(smooth[1].c1.x, 10),
    smooth.map(s => s.c1 && s.c1.x).join(','));

  const arc = api.svgPathSegments('M0 0 A 10 10 0 0 1 20 0').filter(s => s.t !== 'M');
  check('an arc becomes cubics', arc.length >= 1 && arc.every(s => s.t === 'C'), arc.map(s => s.t).join(''));
  const arcSub = api.svgSegmentsToSubpaths(arc, [1, 0, 0, 1, 0, 0]);
  const poly = api.svgSubpathPolygon(arcSub[0], 12);
  const radii = poly.map(p => Math.hypot(p.x - 10, p.y));
  check('the sampled arc stays on its circle',
    radii.every(r => near(r, 10, 0.2)), Math.min(...radii).toFixed(2) + '..' + Math.max(...radii).toFixed(2));

  const h = api.svgSegmentsToSubpaths(api.svgPathSegments('M0 0 H10 V10'), [1, 0, 0, 1, 0, 0]);
  check('H and V are lines', h[0].nodes.length === 3 && !h[0].curved);
}

console.log('\n== style inheritance ==');
{
  const rules = api.svgParseStyleSheets('.thin { stroke: #123456; stroke-width: 0.5 } .ghost { fill: none }');
  check('style sheets are read', rules.length === 2, rules.length);
  const parent = { stroke: 'none', fill: '#000000', strokeWidth: '1', fillRule: 'nonzero', display: null, visibility: null, opacity: null };
  const g = group({ fill: 'red' });
  const p = el('path', { d: 'M0 0 L1 1', stroke: 'blue', class: 'thin' });
  const gs = api.svgStyleFor(g, parent, rules);
  const ps = api.svgStyleFor(p, gs, rules);
  check('fill is inherited', ps.fill === 'red', ps.fill);
  // a CSS rule outranks a presentation attribute, exactly like a browser does it
  check('a class rule outranks the stroke attribute', ps.stroke === '#123456', ps.stroke);
  const plain = api.svgStyleFor(el('path', { d: 'M0 0', stroke: 'blue' }), gs, []);
  check('without a rule the attribute wins', plain.stroke === 'blue', plain.stroke);
  check('stroke-width comes from the class rule', String(ps.strokeWidth) === '0.5', ps.strokeWidth);

  const inline = api.svgStyleFor(el('path', { style: 'stroke:#00ff00;fill:none' }), parent, []);
  check('an inline style wins over the parent', inline.stroke === '#00ff00' && inline.fill === 'none');

  check('display:none hides', api.svgHidden({ display: 'none' }) === true);
  check('visibility:hidden hides', api.svgHidden({ visibility: 'hidden' }) === true);
  check('opacity 0 hides', api.svgHidden({ opacity: '0' }) === true);
  check('a normal element shows', api.svgHidden({ display: null, visibility: null }) === false);
}

console.log('\n== the walker ==');
{
  const ctxOf = () => ({
    rules: [], byId: new Map(), items: [], colors: new Map(),
    skipped: { text: 0, image: 0, use: 0, clip: 0 },
    groupSeq: 0, groupNames: {}, useDepth: 0, prefix: 'i1-'
  });
  const svg = el('svg', {}, [
    group({ id: 'logo' }, [
      el('rect', { x: 0, y: 0, width: 10, height: 10, stroke: '#0000ff' }),
      el('rect', { x: 20, y: 0, width: 10, height: 10, stroke: '#0000ff' })
    ])
  ]);
  const ctx = ctxOf();
  const m = api.matApply(baseMat(1, 0, 0), { x: 0, y: 0 });
  check('the flip matrix puts the origin at 0,0', near(m.x, 0) && near(m.y, 0));
  api.svgWalk(svg, ctx, baseMat(1, 0, 0), api.SVG_DEFAULT_STYLE || { stroke: 'none', fill: '#000000', strokeWidth: '1', fillRule: 'nonzero', display: null, visibility: null, opacity: null }, null, 0);
  check('two shapes were collected', ctx.items.length === 2, ctx.items.length);
  check('they share one group tag', ctx.items[0].group && ctx.items[0].group === ctx.items[1].group,
    ctx.items.map(i => i.group).join(','));
  check('the group is named after its id', ctx.groupNames[ctx.items[0].group] === 'logo',
    ctx.groupNames[ctx.items[0].group]);
  check('the colour is the stroke', ctx.items[0].color === '#0000ff', ctx.items[0].color);
  check('no written fill means not filled', ctx.items[0].filled === false, ctx.items[0].filled);
  const ctxF = ctxOf();
  api.svgWalk(el('svg', {}, [el('rect', { x: 0, y: 0, width: 4, height: 4, fill: '#ff0000' })]), ctxF, baseMat(1, 0, 0),
    { stroke: 'none', fill: '#000000', fillSet: false, strokeWidth: '1', fillRule: 'nonzero', display: null, visibility: null, opacity: null }, null, 0);
  check('an explicit fill is filled', ctxF.items[0].filled === true);
  check('Y is flipped up', ctx.items[0].subpaths[0].nodes.every(n => n.y <= 0),
    JSON.stringify(ctx.items[0].subpaths[0].nodes));

  // nesting collapses into one level
  const nested = el('svg', {}, [
    group({}, [group({}, [el('rect', { x: 0, y: 0, width: 5, height: 5, fill: '#ff0000' })])])
  ]);
  const ctx2 = ctxOf();
  api.svgWalk(nested, ctx2, baseMat(1, 0, 0), { stroke: 'none', fill: '#000000', strokeWidth: '1', fillRule: 'nonzero', display: null, visibility: null, opacity: null }, null, 0);
  check('a nested group still yields one group level', ctx2.items.length === 1 && !!ctx2.items[0].group);
  check('a filled shape is marked filled', ctx2.items[0].filled === true);

  // hidden subtree
  const hidden = el('svg', {}, [group({ display: 'none' }, [el('rect', { x: 0, y: 0, width: 5, height: 5 })])]);
  const ctx3 = ctxOf();
  api.svgWalk(hidden, ctx3, baseMat(1, 0, 0), { stroke: 'none', fill: '#000000', strokeWidth: '1', fillRule: 'nonzero', display: null, visibility: null, opacity: null }, null, 0);
  check('a hidden group is skipped', ctx3.items.length === 0);

  // text and image are counted, not imported
  const withText = el('svg', {}, [el('text', {}, [], 'hi'), el('image', { href: 'x.png' })]);
  const ctx4 = ctxOf();
  api.svgWalk(withText, ctx4, baseMat(1, 0, 0), { stroke: 'none', fill: '#000000', strokeWidth: '1', fillRule: 'nonzero', display: null, visibility: null, opacity: null }, null, 0);
  check('text is counted as skipped', ctx4.skipped.text === 1 && ctx4.skipped.image === 1,
    JSON.stringify(ctx4.skipped));
}

console.log('\n== circles ==');
{
  const ctxOf = () => ({
    rules: [], byId: new Map(), items: [], colors: new Map(),
    skipped: { text: 0, image: 0, use: 0, clip: 0 }, groupSeq: 0, groupNames: {}, useDepth: 0, prefix: 'i1-'
  });
  const D = { stroke: 'none', fill: '#000000', fillSet: false, strokeWidth: '1', fillRule: 'nonzero', display: null, visibility: null, opacity: null };

  const plain = el('svg', {}, [el('circle', { cx: 20, cy: 20, r: 5, stroke: '#0000ff' })]);
  const c1 = ctxOf();
  api.svgWalk(plain, c1, baseMat(1, 0, 0), D, null, 0);
  check('a circle becomes a circle entity', c1.items.length === 1 && c1.items[0].kind === 'circle',
    JSON.stringify(c1.items.map(i => i.kind)));
  check('with its radius and centre', near(c1.items[0].r, 5) && near(c1.items[0].c.x, 20) && near(c1.items[0].c.y, -20),
    JSON.stringify(c1.items[0]));
  check('and its stroke colour', c1.items[0].color === '#0000ff');

  const scaled = el('svg', {}, [
    group({ transform: 'translate(10,0) scale(2)' }, [el('circle', { cx: 0, cy: 0, r: 5, stroke: '#000000' })])
  ]);
  const c2 = ctxOf();
  api.svgWalk(scaled, c2, baseMat(1, 0, 0), D, null, 0);
  check('a uniformly scaled circle stays a circle', c2.items[0].kind === 'circle', c2.items[0].kind);
  check('the radius is scaled', near(c2.items[0].r, 10), c2.items[0].r);
  check('the centre is transformed', near(c2.items[0].c.x, 10), c2.items[0].c.x);

  const squashed = el('svg', {}, [
    group({ transform: 'scale(2,1)' }, [el('circle', { cx: 0, cy: 0, r: 5, stroke: '#000000' })])
  ]);
  const c3 = ctxOf();
  api.svgWalk(squashed, c3, baseMat(1, 0, 0), D, null, 0);
  check('a squashed circle becomes curves', c3.items[0].kind === 'paths' && c3.items[0].subpaths[0].curved === true,
    c3.items[0].kind);
  const poly = api.svgSubpathPolygon(c3.items[0].subpaths[0], 12);
  const xs = poly.map(p => p.x);
  check('the ellipse is wider than it is tall', near(Math.max(...xs), 10, 0.01) && near(Math.min(...xs), -10, 0.01),
    Math.min(...xs).toFixed(2) + '..' + Math.max(...xs).toFixed(2));

  const filledCircle = el('svg', {}, [el('circle', { cx: 0, cy: 0, r: 3, fill: '#00ff00', stroke: 'none' })]);
  const c4 = ctxOf();
  api.svgWalk(filledCircle, c4, baseMat(1, 0, 0), D, null, 0);
  check('a filled circle is filled', c4.items[0].filled === true && c4.items[0].color === '#00ff00');

  const zero = el('svg', {}, [el('circle', { cx: 0, cy: 0, r: 0 })]);
  const c5 = ctxOf();
  api.svgWalk(zero, c5, baseMat(1, 0, 0), D, null, 0);
  check('a zero radius circle is dropped', c5.items.length === 0);
}

console.log('\n== <use> and clip ==');
{
  const target = el('rect', { id: 'box', x: 0, y: 0, width: 10, height: 10, stroke: '#000000' });
  const ctx = {
    rules: [], byId: new Map([['box', target]]), items: [], colors: new Map(),
    skipped: { text: 0, image: 0, use: 0, clip: 0 }, groupSeq: 0, groupNames: {}, useDepth: 0, prefix: 'i1-'
  };
  const svg = el('svg', {}, [
    el('defs', {}, [target]),
    el('use', { 'xlink:href': '#box', x: 100, y: 0 }),
    el('use', { 'xlink:href': '#box', x: 200, y: 0 })
  ]);
  api.svgWalk(svg, ctx, baseMat(1, 0, 0), { stroke: 'none', fill: '#000000', strokeWidth: '1', fillRule: 'nonzero', display: null, visibility: null, opacity: null }, null, 0);
  check('both uses were expanded', ctx.items.length === 2, ctx.items.length);
  const xs = ctx.items.map(i => i.subpaths[0].nodes[0].x).sort((a, b) => a - b);
  check('the use offsets were applied', near(xs[0], 100) && near(xs[1], 200), xs.join(','));

  // clipping: a 10x10 square clipped by a 5x10 rectangle => area halves
  const subject = [{ nodes: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], closed: true }];
  const clip = [{ nodes: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 10 }, { x: 0, y: 10 }], closed: true }];
  const out = api.svgClipSubpaths(subject, clip);
  const area = (nodes) => {
    let a = 0;
    for (let i = 0; i < nodes.length; i++) {
      const p = nodes[i], q = nodes[(i + 1) % nodes.length];
      a += p.x * q.y - q.x * p.y;
    }
    return Math.abs(a / 2);
  };
  check('clipping returns geometry', out && out.length === 1, out && out.length);
  check('the clipped area is half', near(area(out[0].nodes), 50, 1e-6), area(out[0].nodes));
  check('clipped output is closed lines', out[0].closed === true && out[0].curved === false);

  const none = api.svgClipSubpaths(subject, [{ nodes: [{ x: 50, y: 50 }, { x: 60, y: 50 }, { x: 60, y: 60 }], closed: true }]);
  check('a clip that misses leaves nothing', none && none.length === 0, none && none.length);
}

console.log('\n== Inkscape clipboard markup ==');
{
  // What Inkscape writes for Edit > Copy: one <g> per shared parent carrying that
  // parent's transform, the originals of linked duplicates parked in an
  // <inkscape:clipboard> node beside the bbox of the copy, and - for a millimetre
  // template - width in mm against a viewBox in 1/90 inch user units.
  const original = el('rect', { id: 'rect123', x: 0, y: 0, width: 20, height: 12, stroke: '#0000ff' });
  const ctx = {
    rules: [], byId: new Map([['rect123', original]]), items: [], colors: new Map(),
    skipped: { text: 0, image: 0, use: 0, clip: 0 }, groupSeq: 0, groupNames: {}, useDepth: 0,
    prefix: 'clip-7f3-'
  };
  const svg = el('svg', { width: '120mm', height: '80mm', viewBox: '0 0 425.197 283.465' }, [
    el('sodipodi:namedview', { id: 'base' }, []),
    el('inkscape:clipboard', { min: '0 0', max: '425.197 283.465' }, [original]),
    group({ id: 'layer1', transform: 'translate(3.5,4.5)' }, [
      el('path', { d: 'M0 0 L30 0', stroke: '#000000' }),
      el('use', { 'xlink:href': '#rect123', x: 40, y: 0 })
    ])
  ]);
  const scale = 120 / 425.197;                      // the mm-per-user-unit of a 90 dpi document
  const minX = (it) => Math.min.apply(null, it.subpaths[0].nodes.map(n => n.x));
  api.svgWalk(svg, ctx, baseMat(scale, 0, 0),
    { stroke: 'none', fill: '#000000', strokeWidth: '1', fillRule: 'nonzero', display: null, visibility: null, opacity: null },
    null, 0);
  check('the clipboard node is not walked as a drawing', ctx.items.length === 2,
    ctx.items.map(i => i.source).join(','));
  check('the clone is still pasted, once',
    ctx.items.filter(i => i.source === 'rect').length === 1 && ctx.skipped.use === 0,
    'use skipped: ' + ctx.skipped.use);
  const path = ctx.items.filter(i => i.source === 'path')[0];
  const rect = ctx.items.filter(i => i.source === 'rect')[0];
  check('the inherited group transform lands', near(minX(path), 3.5 * scale, 1e-6), minX(path));
  check('the use offset stacks on it', near(minX(rect), 43.5 * scale, 1e-6), minX(rect));
  check('millimetres survive at 90 dpi', near(scale, 0.28222, 1e-4), scale);

  // The same payload written with the namespace prefix Inkscape keeps on its
  // clipboard nodes: <svg:rect> is a rect. Matching on nodeName alone would see
  // an empty drawing and paste nothing at all.
  const pctx = {
    rules: [], byId: new Map(), items: [], colors: new Map(),
    skipped: { text: 0, image: 0, use: 0, clip: 0 }, groupSeq: 0, groupNames: {}, useDepth: 0,
    prefix: 'clip-8a-'
  };
  api.svgWalk(el('svg', { 'xmlns:svg': 'http://www.w3.org/2000/svg' }, [
    el('inkscape:clipboard', { min: '0 0', max: '10 10' }, [original]),
    el('svg:g', { transform: 'translate(1,2)' }, [
      el('svg:rect', { x: 0, y: 0, width: 10, height: 5, stroke: '#ff0000' }),
      el('svg:path', { d: 'M0 0 L8 0', stroke: '#000000' })
    ])
  ]), pctx, baseMat(1, 0, 0),
    { stroke: 'none', fill: '#000000', strokeWidth: '1', fillRule: 'nonzero', display: null, visibility: null, opacity: null },
    null, 0);
  check('namespace-prefixed markup is still a drawing', pctx.items.length === 2,
    pctx.items.map(i => i.source).join(','));
  check('a prefixed clipboard node is skipped by its local name',
    pctx.items.filter(i => i.source === 'rect').length === 1,
    pctx.items.filter(i => i.source === 'rect').length);
}

console.log('\n== Inkscape clipboard scale ==');
{
  // An Inkscape clipboard copy keeps only the viewBox and drops the root
  // width/height. A shape that is 100 mm wide at 96 dpi spans 377.95276 user
  // units, so the importer must fall back to the CSS px scale (25.4/96).
  const collectAll = (node) => {
    const out = [];
    const walk = (n) => { for (const c of (n.childNodes || [])) { out.push(c); walk(c); } };
    walk(node);
    return out;
  };
  const originalRect = el('rect', { id: 'rect100', x: 0, y: 0, width: 377.95276, height: 188.97638, stroke: '#0000ff' });
  // the realistic Inkscape clipboard: root carries inkscape:version but NO
  // <inkscape:clipboard> node (that node only appears for linked/filter refs)
  const root = el('svg', { viewBox: '0 0 377.95276 188.97638', 'inkscape:version': '1.2.2' }, [
    el('sodipodi:namedview', { id: 'base', 'inkscape:document-units': 'mm' }, []),
    group({ id: 'layer1' }, [originalRect])
  ]);
  root.getElementsByTagName = (t) => (t === '*' ? collectAll(root) : []);
  const doc = { documentElement: root, getElementsByTagName: () => [] };
  global.DOMParser = class { parseFromString() { return doc; } };
  const ir = api.svgImportParse('<svg></svg>', { prefix: 'clip-9-' });
  check('a bare-viewBox Inkscape clipboard uses the CSS px scale (96dpi)',
    near(ir.scale, 25.4 / 96, 1e-9), ir.scale);
  check('the 100 mm rectangle measures about 100 mm',
    near(ir.mmW, 100, 0.01), ir.mmW);
}
{
  // The clipboard format we actually see from Inkscape: root carries px
  // width/height but NO viewBox. One user unit is then one CSS pixel, so a
  // 377.95276-wide drawing (100 mm at 96 dpi) must map to ~100 mm.
  const collectAll = (node) => {
    const out = [];
    const walk = (n) => { for (const c of (n.childNodes || [])) { out.push(c); walk(c); } };
    walk(node);
    return out;
  };
  const rect = el('rect', { x: 0, y: 0, width: 377.95276, height: 113.38583, stroke: '#0000ff' });
  const root = el('svg', { width: '377.95276', height: '113.38583', 'inkscape:version': '1.2.2' }, [
    el('sodipodi:namedview', { id: 'base', 'inkscape:document-units': 'mm' }, []),
    group({ id: 'layer1' }, [rect])
  ]);
  root.getElementsByTagName = (t) => (t === '*' ? collectAll(root) : []);
  const doc = { documentElement: root, getElementsByTagName: () => [] };
  global.DOMParser = class { parseFromString() { return doc; } };
  const ir = api.svgImportParse('<svg></svg>', { prefix: 'clip-a-' });
  check('px width/height without a viewBox uses the CSS px scale',
    near(ir.scale, 25.4 / 96, 1e-9), ir.scale);
  check('and a 100 mm object measures about 100 mm',
    near(ir.mmW, 100, 0.01), ir.mmW);
}

console.log('\n== insertion ==');
{
  const resetState = () => {
    for (const k in state.points) delete state.points[k];
    for (const k in state.entities) delete state.entities[k];
    api.__points = {};
    api.__framed = [];
    api._nextPoint = 0;
    api._nextEntity = 1000;
  };
  const sub = (pts, closed, curved) => ({
    nodes: pts.map(p => ({ x: p[0], y: p[1], i: null, o: null })),
    closed: !!closed, curved: !!curved
  });

  resetState();
  const ir = {
    items: [
      { kind: 'paths', subpaths: [sub([[0, 0], [10, 0], [10, 10]], true)], color: '#ff0000', filled: true, group: 'gA', clip: null },
      { kind: 'paths', subpaths: [sub([[10, 10], [20, 10]], false)], color: '#ff0000', filled: false, group: 'gA', clip: null },
      { kind: 'circle', c: { x: 40, y: 40 }, r: 5, color: '#00ff00', filled: false, group: null, clip: null }
    ],
    bounds: { minX: 0, minY: 0, maxX: 45, maxY: 45 },
    groupNames: { gA: 'logo' }, skipped: { text: 0, image: 0, use: 0, clip: 0 }
  };
  const made = api.svgImportInsert(ir, {
    fillMode: 'gray', keepGroups: false, colorMap: { '#ff0000': '#0000ff' },
    center: { x: 0, y: 0 }
  });
  const ents = Object.values(state.entities);
  check('three lines and one circle were made',
    ents.filter(e => e.type === 'line').length === 4 && ents.filter(e => e.type === 'circle').length === 1,
    ents.map(e => e.type).join(','));
  check('the colour was remapped', ents.filter(e => e.type === 'line').every(e => e.color === '#0000ff'));
  check('the circle keeps its own colour', ents.find(e => e.type === 'circle').color === '#00ff00');
  check('a filled contour becomes a gray fill',
    ents.filter(e => e.type === 'line').some(e => e.fill === 'gray'));
  check('the group tag is set when groups are not framed',
    ents.filter(e => e.type === 'line').every(e => e.group === 'gA'));
  const touch = state.points[ents.find(e => e.type === 'line' && e.fill).b];
  check('touching endpoints share one point', !!touch);
  check('the circle got its own centre point', !!state.points[ents.find(e => e.type === 'circle').c]);
  check('the import reports what it made', made.lines === 4 && made.circles === 1 && made.splines === 0,
    JSON.stringify(made));

  resetState();
  const made2 = api.svgImportInsert(ir, {
    fillMode: 'yellow', keepGroups: true, colorMap: {}, center: { x: 0, y: 0 }
  });
  check('with keepGroups the group becomes one framed object', api.__framed.length === 1, api.__framed.length);
  check('the framed object carries the group name', api.__framed[0].opts.name === 'logo', api.__framed[0].opts.name);
  check('no member entities are made for that group',
    Object.values(state.entities).filter(e => e.type === 'line').length === 0,
    Object.values(state.entities).map(e => e.type).join(','));
  check('the group still gets a tag', made2.groups.size >= 1);
  check('the framed object takes the yellow fill',
    state.entities[api.__framed[0].id].fill === 'yellow', state.entities[api.__framed[0].id].fill);

  // curved subpath -> spline entity with handles
  resetState();
  const curved = {
    nodes: [
      { x: 0, y: 0, o: { x: 3, y: 0 }, i: null },
      { x: 10, y: 10, i: { x: 7, y: 10 }, o: null }
    ],
    closed: false, curved: true
  };
  api.svgImportInsert({ items: [{ kind: 'paths', subpaths: [curved], color: '#000000', filled: false, group: null, clip: null }], bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, groupNames: {}, skipped: {} },
    { fillMode: 'gray', keepGroups: false, colorMap: {}, center: { x: 0, y: 0 } });
  const spline = Object.values(state.entities).find(e => e.type === 'spline');
  check('a curved subpath becomes a spline', !!spline);
  check('the spline keeps its handles', spline && spline.hs.o[0] && spline.hs.i[1],
    spline && JSON.stringify(spline.hs));
  check('the spline has two points', spline && spline.pts.length === 2, spline && spline.pts.length);

  // clipping is applied on the way in
  resetState();
  api.svgImportInsert({
    items: [{
      kind: 'paths',
      subpaths: [sub([[0, 0], [10, 0], [10, 10], [0, 10]], true)],
      color: '#000000', filled: false, group: null,
      clip: [{ nodes: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 10 }, { x: 0, y: 10 }], closed: true }]
    }],
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, groupNames: {},
    skipped: { text: 0, image: 0, use: 0, clip: 0 }
  }, { fillMode: 'gray', keepGroups: false, colorMap: {}, center: { x: 0, y: 0 } });
  const clippedPts = Object.values(state.points);
  const spanX = Math.max(...clippedPts.map(p => p.x)) - Math.min(...clippedPts.map(p => p.x));
  check('the clip is applied before the entities are written', near(spanX, 5, 0.001), spanX);
}

console.log('\n' + (fail ? (fail + ' FAILED, ' + pass + ' passed') : ('all ' + pass + ' checks passed')));
process.exit(fail ? 1 : 0);
