// Probe for Ctrl+Shift+C — copy the selection to the OS clipboard as an SVG
// document so a plain Ctrl+V pastes it into Inkscape / Illustrator:
//   1. copySelectionAsSvg() writes BOTH clipboard flavours (text/plain is what
//      Inkscape parses, text/html carries the same markup) through the copy
//      event, with the async Clipboard API as the fallback.
//   2. The clipboard variant of exportSVG omits the white sheet rect — a
//      pasted background would sit in front of the geometry in Inkscape.
//   3. The keydown handler claims Ctrl+Shift+C BEFORE the plain Ctrl+C branch
//      (Shift+C would otherwise fall through to the MiniSketch copy).
//   4. The shortcut is documented in help.js, both languages.
//
// Run: node testing/copy_svg_clipboard_probe.js
'use strict';
const fs = require('fs');
const path = require('path');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const helpSrc = fs.readFileSync(path.join(__dirname, '..', 'help.js'), 'utf8');
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
const slice = (name, src) => {
  const s = src || appSrc;
  const start = s.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('not found: ' + name);
  let i = s.indexOf('(', start), depth = 0;
  for (; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') { depth--; if (!depth) break; }
  }
  return s.slice(start, braceEnd(s, i));
};

console.log('\n== the keydown handler claims Ctrl+Shift+C before plain Ctrl+C ==');
{
  const key = appSrc.indexOf('function onKeyDown(');
  const shiftC = appSrc.indexOf("ev.shiftKey && lower === 'c'", key);
  const plainC = shiftC > 0
    ? appSrc.indexOf("(ev.ctrlKey || ev.metaKey) && lower === 'c'", shiftC + 40)
    : -1;
  check('a Shift+C branch exists in onKeyDown', shiftC > 0);
  check('it runs before the plain Ctrl+C branch', shiftC > 0 && plainC > shiftC);
  check('it calls copySelectionAsSvg',
    shiftC > 0 && /copySelectionAsSvg\(\)/.test(appSrc.slice(shiftC, shiftC + 600)));
  check('it preventDefaults (the DevTools-inspect shortcut)',
    shiftC > 0 && /preventDefault/.test(appSrc.slice(shiftC, shiftC + 600)));
}

console.log('\n== copySelectionAsSvg: the copy-event write path ==');
{
  const fn = new Function(
    'xfBlock', 'exportSVG', 'toast', 'selectedEntitiesForExport',
    'document', 'navigator', 'ClipboardItem',
    slice('copySelectionAsSvg') + '\nreturn copySelectionAsSvg;');

  const toasts = [];
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M 0 0 L 10 0"/></svg>';
  const exportCalls = [];
  const listeners = [];
  const removed = [];

  // A document whose execCommand('copy') fires the registered copy listener
  // SYNCHRONOUSLY, exactly what a browser does inside the user gesture.
  const makeDoc = (execOk, flavours) => {
    let copyFn = null;
    return {
      body: { appendChild() {} },
      createElement() {
        return { value: '', style: {}, setAttribute() {}, select() {}, remove() {} };
      },
      addEventListener(type, fn) {
        listeners.push({ type, fn });
        if (type === 'copy') copyFn = fn;
      },
      removeEventListener(type, fn) { removed.push({ type, fn }); },
      execCommand(cmd) {
        if (cmd !== 'copy' || !copyFn) return false;
        let prevented = false;
        copyFn({
          preventDefault() { prevented = true; },
          clipboardData: { setData(k, v) { flavours[k] = v; } }
        });
        return prevented !== undefined ? execOk : execOk;
      }
    };
  };

  const run = (execOk, clipboardApi) => {
    toasts.length = 0;
    listeners.length = 0;
    removed.length = 0;
    const flavours = {};
    const doc = makeDoc(execOk, flavours);
    const nav = clipboardApi || {};
    const copyFn = fn(
      () => false,                                   // xfBlock
      (opts) => { exportCalls.push(opts); return SVG; },
      (m) => toasts.push(m),
      () => [{ id: 1 }, { id: 2 }],                  // two objects selected
      doc, nav, null
    );
    copyFn();                                        // the command itself
    return { flavours };
  };

  const out = run(true);
  check('exportSVG is asked for the selection as a string', exportCalls.pop().onlySelected === true);
  check('a one-shot copy listener was installed and cleaned up',
    listeners.some(l => l.type === 'copy') && removed.some(l => l.type === 'copy'));
  check('text/plain carries the SVG markup', out.flavours['text/plain'] === SVG);
  check('text/html carries the SVG markup too', out.flavours['text/html'] === SVG);
  check('the success toast names the count and Inkscape',
    /Copied 2 objects as SVG/.test(toasts[0]) && /Inkscape/.test(toasts[0]), toasts[0]);

  // execCommand refused -> the async Clipboard API takes over
  toasts.length = 0;
  const written = [];
  const itemFlavours = {};
  const copyFn2 = fn(
    () => false,
    () => SVG,
    (m) => toasts.push(m),
    () => [{ id: 1 }],
    makeDoc(false, {}),
    { clipboard: { write(items) { written.push(items); return Promise.resolve(); } } },
    function ClipboardItem(flav) { itemFlavours.flav = flav; return { flav }; }
  );
  copyFn2();
  (async () => {
    await new Promise(r => setTimeout(r, 0));
    check('the fallback wrote one ClipboardItem', written.length === 1 && written[0].length === 1);
    check('the fallback item carries both flavours',
      itemFlavours.flav && itemFlavours.flav['text/plain'] && itemFlavours.flav['text/html']);
    check('the fallback success toast ran', /Copied 1 object as SVG/.test(toasts[0]), toasts[0]);
    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
  })();
}

console.log('\n== exportSVG: no background sheet anywhere ==');
{
  // the real exportSVG with a stub world: two lines in one colour
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
    global.Blob, Date
  )({ returnString: true });
  const svg = svgOf();
  check('the file export has no white background rect',
    !/<rect\b/.test(svg), svg.slice(0, 200));
  check('the geometry is still there', /<path d="M 0 0 L 10 0/.test(svg), svg.slice(0, 200));
  check('it is a complete SVG document',
    /^<\?xml/.test(svg) && /<\/svg>\s*$/.test(svg));
  check('noBackground is gone from the source (always off)',
    !/noBackground/.test(appSrc));
}

console.log('\n== help.js documents the shortcut in both languages ==');
{
  check('the EN key group lists Ctrl+Shift+C', /Ctrl\+Shift\/C|Ctrl\+Shift\+C/.test(helpSrc));
  check('EN explains the Inkscape paste',
    /copy selection as SVG to the clipboard/.test(helpSrc) &&
    /Inkscape/.test(helpSrc));
  check('the ID key group lists Ctrl+Shift+C',
    /Ctrl\+Shift\+C[^<]*<\/kbd><span>salin pilihan sebagai SVG/.test(helpSrc));
}
