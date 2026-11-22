// Probe for Ctrl+C / Ctrl+Shift+C — the multi-format copy: the selection goes
// to the OS clipboard in three flavours at once:
//   • text/plain — the SVG document (what Inkscape/Illustrator parse on paste)
//   • text/html   — the MiniSketch JSON payload (CLIP_MARK), so another tab
//                    pastes it back with full fidelity
//   • image/png   — a screenshot of the visible frame cropped to the selection
//                    plus a 20px margin (for sharing with a customer)
// Checks:
//   1. copySelection() drives the async ClipboardItem write (Route A) when it
//      is available, and falls back to arming the copy event (Route B) when
//      it is not.
//   2. Route B (onCopyEvent) puts the SVG in text/plain and the JSON payload
//      in text/html.
//   3. The paste handler accepts the JSON payload from text/html as well as
//      text/plain.
//   4. The keydown handler claims Ctrl+Shift+C BEFORE the plain Ctrl+C branch
//      and routes both to copySelection().
//   5. The clipboard variant of exportSVG omits the white sheet rect.
//   6. The shortcuts are documented in help.js (both languages) and README.
//
// Run: node testing/copy_svg_clipboard_probe.js
'use strict';
const fs = require('fs');
const path = require('path');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const helpSrc = fs.readFileSync(path.join(__dirname, '..', 'help.js'), 'utf8');
const readmeSrc = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

// A deterministic Blob stand-in: Node's global Blob does not expose the parts
// array, but the flavour contents are what matters.
class StubBlob {
  constructor(parts, opts) { this.parts = parts; this.type = (opts && opts.type) || ''; }
}
if (typeof Blob === 'undefined') global.Blob = StubBlob;

function braceEnd(src, from) {
  let i = src.indexOf('{', from), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) return j + 1; }
  }
  throw new Error('unbalanced');
}
// Slices `function name(...) { ... }` including an `async` prefix. The body
// brace search starts AFTER the parameter list closes — a default parameter
// object (e.g. `opts = { ... }`) otherwise looks like the body's opening brace.
const slice = (name, src) => {
  const s = src || appSrc;
  const re = new RegExp('(?:async\\s+)?function ' + name + '\\(');
  const m = re.exec(s);
  if (!m) throw new Error('not found: ' + name);
  const parenStart = s.indexOf('(', m.index);
  let depth = 0, close = -1;
  for (let i = parenStart; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') { depth--; if (!depth) { close = i; break; } }
  }
  const bodyStart = s.indexOf('{', close);
  if (bodyStart < 0) throw new Error('no body: ' + name);
  return s.slice(m.index, braceEnd(s, bodyStart));
};

const CLIP_MARK = 'MINISKETCH-CLIP:1:';
const JSON_MSG = 'MINISKETCH-CLIP:1:{"points":[],"entities":[{"id":1}],"t":999}';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M 0 0 L 10 0"/></svg>';

(async () => {

console.log('\n== the keydown handler claims Ctrl+Shift+C before plain Ctrl+C ==');
{
  const key = appSrc.indexOf('function onKeyDown(');
  const shiftC = appSrc.indexOf("ev.shiftKey && lower === 'c'", key);
  const plainC = shiftC > 0
    ? appSrc.indexOf("(ev.ctrlKey || ev.metaKey) && lower === 'c'", shiftC + 40)
    : -1;
  check('a Shift+C branch exists in onKeyDown', shiftC > 0);
  check('it runs before the plain Ctrl+C branch', shiftC > 0 && plainC > shiftC);
  check('it calls copySelection (the shared multi-format copy)',
    shiftC > 0 && /copySelection\(\)/.test(appSrc.slice(shiftC, shiftC + 600)));
  check('it preventDefaults (the DevTools-inspect shortcut)',
    shiftC > 0 && /preventDefault/.test(appSrc.slice(shiftC, shiftC + 600)));
  check('the old copySelectionAsSvg function is gone', !/function copySelectionAsSvg\(/.test(appSrc));
}

console.log('\n== copySelection: Route A (async ClipboardItem) when available ==');
{
  const fn = new Function(
    'CLIP_MARK', 'Date', 'xfBlock', 'clipboardPayload', 'exportSVG', 'toast',
    'canWriteAsyncClipboard', 'writeMultiFormatClipboard', 'setTimeout',
    'clipPayloadText', 'clipSvgText', 'clipCopyRequested', 'clipboard',
    'viewportCropToPngBlob',
    slice('copySelection') + '\nreturn copySelection;');

  const toasts = [];
  const exportCalls = [];
  const writeCalls = [];
  const copyFn = fn(
    CLIP_MARK, Date,
    () => false,                          // xfBlock
    () => ({ count: 2, pointCount: 0, entities: [{ id: 1 }, { id: 2 }],
      points: [], bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } }),
    (opts) => { exportCalls.push(opts); return SVG; },
    (m) => toasts.push(m),
    () => true,                           // canWriteAsyncClipboard
    async (...args) => { writeCalls.push(args); return true; },
    () => { throw new Error('legacy route must NOT be armed when Route A works'); },
    '', '', false, null,
    () => Promise.resolve('stub-png')     // viewportCropToPngBlob
  );
  copyFn();
  await new Promise(r => setTimeout(r, 0));
  check('exportSVG was asked for the selection as a string',
    exportCalls.length === 1 && exportCalls[0].onlySelected === true &&
    exportCalls[0].returnString === true);
  const writtenJson = writeCalls.length ? writeCalls[0][2] : '';
  let parsed = null;
  try { parsed = JSON.parse(writtenJson.slice(CLIP_MARK.length)); } catch (err) { /* not json */ }
  check('the async write got the SVG and the JSON payload',
    writeCalls.length === 1 &&
    writeCalls[0][1] === SVG &&
    writtenJson.indexOf(CLIP_MARK) === 0 &&
    parsed && parsed.entities && parsed.entities.length === 2);
  check('the PNG promise (viewport crop) rides along',
    writeCalls.length === 1 && writeCalls[0][3] && typeof writeCalls[0][3].then === 'function');
  check('the success toast names the count and the three flavours',
    /Copied 2 objects/.test(toasts[0]) &&
    /SVG/.test(toasts[0]) && /PNG/.test(toasts[0]) && /sketch/.test(toasts[0]),
    toasts[0]);
}

console.log('\n== copySelection: Route B (copy event) when async is unavailable ==');
{
  const fn = new Function(
    'CLIP_MARK', 'Date', 'xfBlock', 'clipboardPayload', 'exportSVG', 'toast',
    'canWriteAsyncClipboard', 'writeMultiFormatClipboard', 'setTimeout',
    'clipPayloadText', 'clipSvgText', 'clipCopyRequested', 'clipboard',
    'viewportCropToPngBlob',
    slice('copySelection') + '\nreturn copySelection;');

  const toasts = [];
  let timerScheduled = false;
  let writeCalled = false;
  const copyFn = fn(
    CLIP_MARK, Date,
    () => false,
    () => ({ count: 1, pointCount: 0, entities: [{ id: 7 }], points: [],
      bounds: { minX: 0, minY: 0, maxX: 5, maxY: 5 } }),
    () => SVG,
    (m) => toasts.push(m),
    () => false,                          // canWriteAsyncClipboard
    () => { writeCalled = true; return Promise.resolve(true); },
    () => { timerScheduled = true; },
    '', '', false, null,
    () => Promise.resolve('stub-png')
  );
  copyFn();
  check('the legacy route was armed (timer scheduled), not the async write',
    timerScheduled === true && writeCalled === false);
  check('the toast still reports the copied count and the three flavours',
    /Copied 1 object/.test(toasts[0]) && /SVG/.test(toasts[0]), toasts[0]);
}

console.log('\n== onCopyEvent (Route B): SVG in text/plain, JSON in text/html ==');
{
  const fn = new Function(
    'clipboardEventInTextWidget', 'clipCopyRequested', 'clipPayloadText', 'clipSvgText',
    slice('onCopyEvent') + '\nreturn onCopyEvent;');
  const flavours = {};
  let prevented = false;
  fn(() => false, true, JSON_MSG, SVG)({
    clipboardData: { setData(k, v) { flavours[k] = v; } },
    preventDefault() { prevented = true; }
  });
  check('text/plain carries the SVG markup', flavours['text/plain'] === SVG);
  check('text/html carries the MiniSketch JSON payload', flavours['text/html'] === JSON_MSG);
  check('image/svg+xml carries the SVG (Inkscape target)', flavours['image/svg+xml'] === SVG);
  check('the default was prevented', prevented === true);

  // Without an SVG rendering (e.g. point-only selection) the JSON fills both,
  // and there is no svg+xml target.
  const flavours2 = {};
  fn(() => false, true, JSON_MSG, '')({
    clipboardData: { setData(k, v) { flavours2[k] = v; } },
    preventDefault() {}
  });
  check('point-only copies keep JSON in both slots',
    flavours2['text/plain'] === JSON_MSG && flavours2['text/html'] === JSON_MSG);
  check('point-only copies have no svg+xml target', !('image/svg+xml' in flavours2));
}

console.log('\n== onPasteEvent: JSON payload accepted from text/html ==');
{
  const fn = new Function(
    'Date', 'ignorePasteUntil', 'pasteTrace', 'clipboardEventInTextWidget', 'pasteEventSeq',
    'fallbackPasteAt', 'importClipboardText', 'pasteClipboard', 'clipboard',
    'toast', 'CLIP_MARK', 'looksLikeSvgDoc', 'svgClipboardToSketch', 'artFromSvgText',
    'openImageDialog', 'routeSvgAndRaster',
    slice('onPasteEvent') + '\nreturn onPasteEvent;');
  const makeStub = () => {
    return {
      pasted: false, imported: false, prevented: false, svgRoute: false,
      run(ev, tick) {
        fn(
          Date, 0, () => {}, () => false, 0, 0,
          () => { this.imported = true; return true; },
          () => { this.pasted = true; },
          null, () => {}, CLIP_MARK, () => false, () => false, () => false, () => {},
          () => { this.svgRoute = true; }
        )(ev);
        return tick ? Promise.resolve().then(() => this) : this;
      }
    };
  };

  // 1. the payload sits exactly at offset 0 of the html slot
  const s1 = makeStub();
  const ev1 = {
    clipboardData: {
      getData(type) { return type === 'text/html' ? JSON_MSG : ''; },
      types: ['text/html'], items: []
    },
    preventDefault() { s1.prevented = true; }
  };
  const r1 = await s1.run(ev1, true);
  check('the html-slot payload was imported and pasted', r1.imported === true && r1.pasted === true);
  check('the paste default was prevented', r1.prevented === true);

  // 2. some platforms wrap/reflow the html flavour (BOM, fragment markers) —
  //    the marker is found anywhere in the slot, not only at offset 0
  const s2 = makeStub();
  const ev2 = {
    clipboardData: {
      getData(type) { return type === 'text/html' ? '\ufeff<!--StartFragment-->' + JSON_MSG : ''; },
      types: ['text/html'], items: []
    },
    preventDefault() { s2.prevented = true; }
  };
  const r2 = await s2.run(ev2, true);
  check('a wrapped html payload (BOM + fragment) is still found',
    r2.imported === true && r2.pasted === true);

  // 3. getData answers empty but the text/html item still holds the payload
  const s3 = makeStub();
  const ev3 = {
    clipboardData: {
      getData() { return ''; },
      types: ['text/html'],
      items: [{ kind: 'string', type: 'text/html', getAsString(cb) { cb(JSON_MSG); } }]
    },
    preventDefault() { s3.prevented = true; }
  };
  const r3 = await s3.run(ev3, true);
  check('the text/html item probe recovers the payload',
    r3.imported === true && r3.pasted === true && r3.svgRoute === false);

  // 4. the probed item holds someone else's html — fall through to the SVG routes
  const s4 = makeStub();
  const ev4 = {
    clipboardData: {
      getData() { return ''; },
      types: ['text/html'],
      items: [{ kind: 'string', type: 'text/html', getAsString(cb) { cb('<p>hello</p>'); } }]
    },
    preventDefault() { s4.prevented = true; }
  };
  const r4 = await s4.run(ev4, true);
  check('a non-sketch html item falls through to the SVG/raster routes',
    r4.imported === false && r4.svgRoute === true);
}

console.log('\n== the async multi-format write (writeMultiFormatClipboard) ==');
{
  const fn = new Function(
    'canWriteAsyncClipboard', 'Blob', 'pngPromise', 'ClipboardItem', 'navigator',
    slice('writeMultiFormatClipboard') + '\nreturn writeMultiFormatClipboard;');
  const pngBlob = new StubBlob(['fake-png'], { type: 'image/png' });
  // Note: pngPromise is BOTH a free variable and a parameter of the sliced
  // function — the parameter shadows the injection, so it must be passed as
  // the 4th argument of the call.
  const makeImpl = (clipboardItem, clipboardWrite) => {
    return fn(
      () => true, StubBlob, null,
      clipboardItem, clipboardWrite
    );
  };
  const recordItem = (attempts) => function ClipboardItem(flav) {
    attempts.push(flav); return { flav };
  };

  const attempts = [];
  const impl = makeImpl(
    recordItem(attempts),
    { clipboard: { write(items) { return Promise.resolve(items); } } }
  );
  const ok = await impl({ points: [], entities: [] }, SVG, JSON_MSG, Promise.resolve(pngBlob));
  check('the write resolved true', ok === true);
  const full = attempts[0] || {};
  check('text/plain flavour carries the SVG', full['text/plain'] instanceof StubBlob && full['text/plain'].parts[0] === SVG);
  check('text/html flavour carries the JSON', full['text/html'].parts[0] === JSON_MSG);
  check('image/svg+xml flavour carries the SVG (Inkscape target)',
    full['image/svg+xml'] instanceof StubBlob && full['image/svg+xml'].parts[0] === SVG);
  check('image/png flavour carries the viewport crop', full['image/png'] === pngBlob);

  // no PNG + no SVG -> text flavours only
  const attempts2 = [];
  const impl2 = makeImpl(recordItem(attempts2), { clipboard: { write() { return Promise.resolve(); } } });
  const noPngOk = await impl2({ points: [], entities: [] }, null, JSON_MSG, null);
  check('no PNG and no SVG target when both are absent',
    noPngOk === true && !attempts2[0]['image/png'] && !attempts2[0]['image/svg+xml']);

  // a browser that rejects the svg+xml MIME retries with the slimmer set
  const attempts3 = [];
  const rejectingItem = function ClipboardItem(flav) {
    attempts3.push(flav);
    if ('image/svg+xml' in flav) throw new TypeError('unsupported type');
    return { flav };
  };
  const impl3 = makeImpl(
    rejectingItem,
    { clipboard: { write(items) { return Promise.resolve(items); } } }
  );
  const retryOk = await impl3({ points: [], entities: [] }, SVG, JSON_MSG, Promise.resolve(pngBlob));
  check('an unsupported svg+xml MIME falls back to the slimmer set',
    retryOk === true && attempts3.length === 2 && !attempts3[1]['image/svg+xml'] && attempts3[1]['image/png'] === pngBlob);

  // a fully refused write resolves false (caller arms Route B)
  const attempts4 = [];
  const refuseOk = await makeImpl(
    recordItem(attempts4),
    { clipboard: { write() { return Promise.reject(new Error('permission')); } } }
  )({ points: [], entities: [] }, SVG, JSON_MSG, Promise.resolve(pngBlob));
  check('a refused write resolves false', refuseOk === false && attempts4.length === 3);
}

console.log('\n== viewportCropRect: selection bbox -> screen crop + 20px margin ==');
{
  const fn = new Function(
    'DPR', 'view', 'canvas',
    slice('viewportCropRect') + '\nreturn viewportCropRect;');
  const cropRect = fn(2, { zoom: 1.5, ox: 100, oy: 50 }, { width: 1200, height: 800 });
  // world 10..110 x 20..70 -> screen css 115..265 x 80..155 -> backing *2
  // margin 40px -> x 190, y 120, right 570, bottom 350
  const r = cropRect({ minX: 10, minY: 20, maxX: 110, maxY: 70 });
  check('crop follows the selection bbox + 20px margin',
    r && r.x === 190 && r.y === 120 && r.w === 380 && r.h === 230, JSON.stringify(r));
  check('it clamps to the canvas edge',
    !!cropRect({ minX: -500, minY: -500, maxX: 110, maxY: 70 }));
  check('an off-screen selection yields null',
    cropRect({ minX: 5000, minY: 20, maxX: 5100, maxY: 70 }) === null);
  check('a degenerate (point) selection still crops',
    !!cropRect({ minX: 10, minY: 20, maxX: 10, maxY: 20 }));
  check('null bounds yield null', cropRect(null) === null);
}

console.log('\n== viewportCropToPngBlob captures the visible frame ==');
{
  check('it snapshots the live canvas', /frameSnapshot\(\)/.test(appSrc));
  check('it applies a 20px CSS margin', /20 \* DPR/.test(appSrc));
  check('it encodes through canvas.toBlob as image/png',
    /toBlob/.test(appSrc) && /'image\/png'/.test(appSrc));
  check('it rejects when the crop is empty', /selection off-screen/.test(appSrc));
  check('the old SVG rasterizer is gone', !/function svgToPngBlob\(/.test(appSrc));
}

console.log('\n== exportSVG: no background sheet anywhere ==');
{
  const w = {
    points: { 1: { x: 0, y: 0 }, 2: { x: 10, y: 0 }, 3: { x: 10, y: 5 }, 4: { x: 0, y: 5 } },
    entities: {
      10: { id: 10, type: 'line', a: 1, b: 2, color: '#ff0000', layer: 1 },
      11: { id: 11, type: 'line', a: 2, b: 3, color: '#ff0000', layer: 1 }
    },
    layers: [{ id: 1, visible: true, locked: false }],
    constraints: {}
  };
  const fn = new Function(
    'state', 'ui', 'opts0', 'toast', 'downloadBlob', 'selectedEntitiesForExport',
    'ownedGuideIds', 'svgEntityAllowed', 'P', 'fmt', 'colorOf', 'chainPolylines',
    'arrayBounds', 'artContoursWorld', 'splineSamplesOf', 'textOutlineWorld',
    'ensureSplineHandles', 'entityPointIds', 'svgArcPath', 'layerVisible', 'Blob', 'Date',
    slice('exportSVG') + '\nreturn exportSVG;');
  const passthru = (e) => true;
  const svgOf = () => fn(
    w, { activeLayer: 1 },
    { onlyVisible: true, onlyActive: false, onlySelected: false },
    () => {}, () => {}, () => [],
    () => new Set(), passthru,
    (id) => w.points[id],
    (n) => Math.round(+n * 100) / 100,
    (e) => e.color || '#000000',
    (polys) => polys.map(pl => ({ pts: pl.pts, closed: false })),
    () => null, () => [], () => [], () => ({ loops: [] }),
    () => {}, (e) => [e.a, e.b],
    () => null, passthru,
    StubBlob, Date
  )({ returnString: true });
  const svg = svgOf();
  check('the file export has no white background rect',
    !/<rect\b/.test(svg), svg.slice(0, 200));
  check('the geometry is still there', /<path d="M 0 0 L 10 0/.test(svg), svg.slice(0, 200));
  check('it is a complete SVG document',
    /^<\?xml/.test(svg) && /<\/svg>\s*$/.test(svg));
  check('the page is sized in 96dpi pixels (not mm) so Inkscape lands on mm',
    /width="[0-9.]+px"/.test(svg) && /height="[0-9.]+px"/.test(svg), svg.slice(0, 220));
  check('the geometry is scaled up by 96/25.4 in a group transform',
    /<g transform="scale\(3\.779/.test(svg), svg.slice(0, 260));
  check('noBackground is gone from the source (always off)',
    !/noBackground/.test(appSrc));
}

console.log('\n== help.js documents the shortcut in both languages ==');
{
  check('the EN key group lists Ctrl+Shift+C', /Ctrl\+Shift\/C|Ctrl\+Shift\+C/.test(helpSrc));
  check('EN explains the unified multi-format copy',
    /copy \(sketch \+ SVG \+ PNG onto the system clipboard\)/.test(helpSrc));
  check('EN marks Ctrl+Shift+C the same as Ctrl+C',
    /Ctrl\+Shift\+C[^<]*<\/kbd><span>same as Ctrl\+C/.test(helpSrc));
  check('the ID key group lists Ctrl+Shift+C',
    /Ctrl\+Shift\+C[^<]*<\/kbd><span>sama dengan Ctrl\+C/.test(helpSrc));
  check('ID explains the unified copy',
    /salin \(sketsa \+ SVG \+ PNG ke clipboard sistem\)/.test(helpSrc));
}

console.log('\n== README mentions the three flavours ==');
{
  check('README describes the multi-format copy',
    /three flavours at once/.test(readmeSrc) && /PNG screenshot/.test(readmeSrc));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

})();
