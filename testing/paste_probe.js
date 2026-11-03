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
  sliceApp('onPasteEvent')
].join('\n');

const make = () => {
  const log = [];
  const api = new Function(
    'CLIP_MARK', 'importClipboardText', 'pasteClipboard', 'artFromSvgText', 'artFromBlob', 'toast',
    'openImageDialog',
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
    (svg) => { log.push('svg'); return true; },
    (blob) => log.push('blob'),
    (m) => log.push('toast:' + m),
    // the trace-or-picture dialog: the probe only needs to see it was reached
    (blob) => log.push('imageDialog')
  );
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
  check('an SVG clipboard item goes to the parser', log.indexOf('svg') >= 0, JSON.stringify(log));
}
{
  const { api, log } = make();
  api.onPasteEvent(itemEvent({ kind: 'file', type: 'image/png', getAsFile: () => ({ type: 'image/png' }) }));
  // the raster goes to the trace-or-picture dialog now, not straight to tracing
  check('a raster image opens the trace dialog', log.indexOf('imageDialog') >= 0, JSON.stringify(log));
}
{
  const { api, log } = make();
  api.onPasteEvent(stringEvent('<svg><path d="M0 0 L1 1"/></svg>', ['text/plain']));
  check('plain text that is really SVG is parsed', log.indexOf('svg') >= 0, JSON.stringify(log));
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
