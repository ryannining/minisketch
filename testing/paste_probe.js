// Probe for the paste handler: marker payloads, images, SVG text, the in-memory
// fallback, and the middle-click (X11 primary selection) guard.
//
// Run: node testing/paste_probe.js
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

const CLIP_MARK = 'MINISKETCH-CLIP:1:';
const code = [
  'let pasteEventSeq = 0;',
  'let fallbackPasteAt = 0;',
  'let ignorePasteUntil = 0;',
  'let clipboard = null;',
  sliceApp('clipboardEventInTextWidget'),
  sliceApp('looksLikeSvgDoc'),
  sliceApp('onPasteEvent'),
  sliceApp('routeSvgAndRaster')
].join('\n');

const make = () => {
  const log = [];
  // whether the vector importer claims to have handled the markup
  let vectorHandles = true;
  // and whether the flat "art" reader found any path in it
  let artHandles = true;
  const api = new Function(
    'CLIP_MARK', 'importClipboardText', 'pasteClipboard', 'artFromSvgText', 'artFromBlob', 'toast',
    'openImageDialog', 'svgClipboardToSketch', 'pasteTrace',
    code + `
    return {
      onPasteEvent,
      clipboard: (c) => { clipboard = c; },
      ignoreFor(ms) { ignorePasteUntil = Date.now() + ms; },
      clearIgnore() { ignorePasteUntil = 0; },
      fallbackAt(t) { fallbackPasteAt = t; },
      seq: () => pasteEventSeq
    };`
  )(
    CLIP_MARK,
    (txt) => { const ok = txt.indexOf(CLIP_MARK) === 0; if (ok) log.push('import'); return ok; },
    () => log.push('pasteObjects'),
    (svg) => { log.push('svg'); return artHandles; },
    (blob) => log.push('blob'),
    (m) => log.push('toast:' + m),
    // the trace-or-picture dialog: the probe only needs to see it was reached
    (blob) => log.push('imageDialog'),
    // the file importer for SVG markup: real geometry, no flattening. When it
    // refuses it says why, and that reason has to reach the user.
    (text, report) => {
      log.push('vector');
      log.push('vector sees ' + String(text).slice(0, 5));
      if (!vectorHandles && report) report('no shapes the importer reads');
      return vectorHandles;
    },
    // the [paste] trace is a console.log behind a flag: silent in the probe
    () => {}
  );
  // lives here, not in the compiled body: the stubs below close over this
  // variable, a write from inside the compiled function would not reach it
  api.vector = (handled) => { vectorHandles = handled; };
  api.art = (handled) => { artHandles = handled; };
  return { api, log };
};

// A paste event with a plain string payload
const stringEvent = (text, types) => ({
  target: { tagName: 'CANVAS' },
  preventDefault() {},
  clipboardData: {
    types: types || ['text/plain'],
    getData: () => text,
    items: []
  }
});

// A paste event carrying one clipboard item
const itemEvent = (item, text) => ({
  target: { tagName: 'CANVAS' },
  preventDefault() {},
  clipboardData: {
    types: ['Files'],
    getData: () => (text || ''),
    items: [item],
    files: []
  }
});

console.log('\n== middle click never pastes ==');
{
  const { api, log } = make();
  api.clipboard({ entities: [{}], points: [{}] });
  api.ignoreFor(900);
  api.onPasteEvent(stringEvent(''));
  check('an empty middle-click paste is ignored', log.length === 0, JSON.stringify(log));
  api.onPasteEvent(stringEvent(CLIP_MARK + '{"points":[],"entities":[]}'));
  check('even a marker payload is ignored right after a middle click',
    log.length === 0, JSON.stringify(log));
  api.onPasteEvent(itemEvent({ kind: 'file', type: 'image/png', getAsFile: () => ({ type: 'image/png' }) }));
  check('a middle-click image paste is ignored too', log.length === 0, JSON.stringify(log));
  api.clearIgnore();
  api.onPasteEvent(stringEvent(CLIP_MARK + '{"points":[],"entities":[]}'));
  check('with the guard expired the marker pastes again', log.indexOf('import') >= 0, JSON.stringify(log));
}

console.log('\n== normal keyboard paste ==');
{
  const { api, log } = make();
  api.clearIgnore();
  api.onPasteEvent(stringEvent(CLIP_MARK + '{"points":[],"entities":[]}'));
  check('marker payload imports and pastes',
    log.indexOf('import') >= 0 && log.indexOf('pasteObjects') >= 0, JSON.stringify(log));
}
{
  const { api, log } = make();
  api.onPasteEvent(itemEvent({ kind: 'string', type: 'image/svg+xml', getAsString: (cb) => cb('<svg><path d="M0 0 L1 1"/></svg>') }));
  check('an SVG clipboard item goes to the vector importer', log.indexOf('vector') >= 0, JSON.stringify(log));
}
{
  const { api, log } = make();
  api.onPasteEvent(itemEvent({ kind: 'string', type: 'image/svg-xml', getAsString: (cb) => cb('<svg/>') }));
  check('the misspelled macOS SVG type is still vector', log.indexOf('vector') >= 0, JSON.stringify(log));
}
{
  const { api, log } = make();
  // a thenable that answers at once, so the probe stays synchronous
  const file = { text: () => ({ then: (ok) => ok('<svg/>') }) };
  api.onPasteEvent(itemEvent({ kind: 'file', type: 'image/svg+xml', getAsFile: () => file }));
  check('an SVG file item is read as markup', log.indexOf('vector') >= 0, JSON.stringify(log));
}
{
  const { api, log } = make();
  api.vector(false);
  api.onPasteEvent(itemEvent({ kind: 'string', type: 'image/svg+xml', getAsString: (cb) => cb('<svg><path d="M0 0 L1 1"/></svg>') }));
  check('when the importer declines, the flat art path still gets a turn',
    log.indexOf('vector') >= 0 && log.indexOf('svg') >= 0, JSON.stringify(log));
}
{
  const { api, log } = make();
  // the browser hands over an image/svg+xml item that answers EMPTY (the async
  // quirk the user hit), while the same markup also rides as plain text
  const ev = itemEvent({ kind: 'string', type: 'image/svg+xml', getAsString: (cb) => cb('') },
    '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="4" height="4"/></svg>');
  ev.clipboardData.types = ['text/plain', 'image/svg+xml'];
  api.onPasteEvent(ev);
  check('an empty svg item falls back to the text/plain payload',
    log.indexOf('vector sees <?xml') >= 0, JSON.stringify(log));
}
{
  const { api, log } = make();
  api.onPasteEvent(itemEvent({ kind: 'file', type: 'image/png', getAsFile: () => ({ type: 'image/png' }) }));
  // the raster goes to the trace-or-picture dialog now, not straight to tracing
  check('a raster image opens the trace dialog', log.indexOf('imageDialog') >= 0, JSON.stringify(log));
}
{
  const { api, log } = make();
  const ev = itemEvent({ kind: 'file', type: 'image/png', getAsFile: () => ({ type: 'image/png' }) });
  ev.clipboardData.getData = () => '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>';
  ev.clipboardData.types = ['text/plain', 'Files'];
  api.onPasteEvent(ev);
  check('a PNG preview next to SVG markup loses to the vectors',
    log.indexOf('vector') >= 0 && log.indexOf('imageDialog') < 0, JSON.stringify(log));
}
{
  const { api, log } = make();
  api.onPasteEvent(stringEvent('<svg><path d="M0 0 L1 1"/></svg>', ['text/plain']));
  check('plain text that is really an SVG document is imported as vectors',
    log.indexOf('vector') >= 0, JSON.stringify(log));
}
{
  const { api, log } = make();
  api.onPasteEvent(stringEvent('<html><body><p>hi</p><svg><path d="M0 0 L1 1"/></svg></body></html>',
    ['text/html', 'text/plain']));
  check('markup that only contains an <svg> is not an SVG document', log.length === 0, JSON.stringify(log));
}

{
  const { api, log } = make();
  api.vector(false);
  api.art(false);
  api.onPasteEvent(stringEvent('<svg><rect x="0" y="0" width="4" height="4"/></svg>', ['text/plain']));
  const notes = log.filter(l => l.indexOf('toast:') === 0).join(' | ');
  check('a refused paste says why instead of saying nothing',
    notes.indexOf('no shapes the importer reads') >= 0, notes || 'no note at all');
}

console.log('\n== the in-memory fallback is narrow ==');
{
  const { api, log } = make();
  api.clipboard({ entities: [{}], points: [{}] });
  api.fallbackAt(0);
  api.onPasteEvent(stringEvent('', []));
  check('no data and no declared type: memory fallback runs', log.indexOf('pasteObjects') >= 0, JSON.stringify(log));
}
{
  const { api, log } = make();
  api.clipboard({ entities: [{}], points: [{}] });
  api.fallbackAt(0);
  api.onPasteEvent(stringEvent('', ['text/plain']));
  check('a declared type means "not ours": no fallback', log.indexOf('pasteObjects') < 0, JSON.stringify(log));
}
{
  const { api, log } = make();
  api.clipboard(null);
  api.onPasteEvent(stringEvent('', []));
  check('no memory and no payload: nothing happens', log.length === 0, JSON.stringify(log));
}
{
  const { api, log } = make();
  api.clipboard({ entities: [{}], points: [{}] });
  api.fallbackAt(Date.now());
  api.onPasteEvent(stringEvent('plain text', ['text/plain']));
  check('plain text does not trigger the object paste', log.indexOf('pasteObjects') < 0, JSON.stringify(log));
}

console.log('\n== text widgets are left alone ==');
{
  const { api, log } = make();
  api.clearIgnore();
  api.onPasteEvent({
    target: { tagName: 'TEXTAREA' },
    preventDefault() {},
    clipboardData: { types: ['text/plain'], getData: () => CLIP_MARK + '{"points":[],"entities":[]}', items: [] }
  });
  check('pasting into an input is the browser\'s business', log.length === 0, JSON.stringify(log));
}

console.log('\n== the sequence counter still advances ==');
{
  const { api, log } = make();
  const before = api.seq();
  api.ignoreFor(900);
  api.onPasteEvent(stringEvent(''));
  // the ignore guard returns before the counter: a middle-click paste must not
  // look like a paste that happened, or the Ctrl+V fallback would be skipped
  check('an ignored middle-click paste leaves the counter alone', api.seq() === before, api.seq() - before);
}

console.log('\n' + (fail ? (fail + ' FAILED, ' + pass + ' passed') : ('all ' + pass + ' checks passed')));
process.exit(fail ? 1 : 0);
