'use strict';
// Save / Save As: the File System Access path, and its fallback.
//
// The bug being locked down: an <a download> blob always makes a NEW file, so a
// second save of the same name became "sketch (1).sketch". Save now writes
// through a retained handle; Save As always opens the picker.

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); }
};
const slice = (a, b) => {
  const i = app.indexOf(a);
  if (i < 0) return '';
  const j = app.indexOf(b, i);
  return j < 0 ? '' : app.slice(i, j);
};

// ---- behaviour, executed for real -------------------------------------
const src = slice('const FILENAME_KEY', 'function downloadBlob(');
const make = (win) => new Function('window', 'localStorage', 'toast', `
  ${src}
  return { save, saveApiAvailable, saveTextAs, saveSuggestName };
`)(win, win.localStorage, () => {});

const mkWin = (opts) => {
  const store = {};
  const calls = { picker: 0, wrote: [] };
  const win = {
    isSecureContext: true,
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); }
    },
    showSaveFilePicker: opts.hasPicker ? async (o) => {
      calls.picker++;
      if (opts.abort) { const e = new Error('x'); e.name = 'AbortError'; throw e; }
      return {
        name: o.suggestedName,
        queryPermission: async () => 'granted',
        createWritable: async () => ({
          write: async (t) => { calls.wrote.push(t); },
          close: async () => {}
        })
      };
    } : undefined
  };
  // `window.top !== window` is how the app detects an embedding frame.
  win.top = opts.embedded ? { framed: true } : win;
  return { win, calls, store };
};

(async () => {
  console.log('save: file picker path');
  let { win, calls, store } = mkWin({ hasPicker: true });
  let S = make(win);
  check('picker is detected when present', S.saveApiAvailable());
  let r = await S.saveTextAs('DOC1', '.sketch', 'MiniSketch drawing', false);
  check('first save opens the picker', r === 'saved' && calls.picker === 1);
  check('the text really reaches the file', calls.wrote[0] === 'DOC1');
  check('the handle is retained', !!S.save.handle);

  r = await S.saveTextAs('DOC2', '.sketch', 'MiniSketch drawing', false);
  check('second save reuses the handle — no new file, no "(1)"',
    r === 'saved' && calls.picker === 1 && calls.wrote[1] === 'DOC2',
    'pickers=' + calls.picker);

  r = await S.saveTextAs('SVG', '.svg', 'SVG', false);
  check('a different extension must NOT overwrite the .sketch',
    calls.picker === 2, 'pickers=' + calls.picker);

  ({ win, calls } = mkWin({ hasPicker: true }));
  S = make(win);
  await S.saveTextAs('A', '.sketch', 'd', false);
  r = await S.saveTextAs('B', '.sketch', 'd', true);
  check('Save As always opens the picker even with a live handle',
    r === 'saved' && calls.picker === 2, 'pickers=' + calls.picker);

  ({ win, calls } = mkWin({ hasPicker: true, abort: true }));
  S = make(win);
  r = await S.saveTextAs('A', '.sketch', 'd', false);
  check('closing the dialog cancels, it does not fall back to a download',
    r === 'cancelled');

  console.log('save: fallback');
  ({ win, calls } = mkWin({ hasPicker: false }));
  S = make(win);
  check('no picker => not available', !S.saveApiAvailable());
  r = await S.saveTextAs('A', '.sketch', 'd', false);
  check('no picker => caller falls back', r === 'fallback');

  console.log('save: naming');
  const named = mkWin({ hasPicker: true });
  store = named.store;
  S = make(named.win);
  store['minisketch.v1.filename'] = 'kursi';
  check('the remembered name prefills the dialog',
    S.saveSuggestName('.sketch') === 'kursi.sketch', S.saveSuggestName('.sketch'));
  store['minisketch.v1.filename'] = 'a/b:c';
  check('unsafe characters are stripped',
    S.saveSuggestName('.sketch') === 'a_b_c.sketch', S.saveSuggestName('.sketch'));

  console.log('save: embedded in KaryaCNC');
  ({ win, calls } = mkWin({ hasPicker: true, embedded: true }));
  S = make(win);
  check('inside an iframe the picker is NOT advertised (it would throw)',
    !S.saveApiAvailable());
  r = await S.saveTextAs('A', '.sketch', 'd', false);
  check('embedded => straight to the download fallback, no broken picker',
    r === 'fallback' && calls.picker === 0);

  console.log('save: wiring');
  check('Ctrl+S always attempts a file write (never browser-only)',
    !/if \(saveApiAvailable\(\)\) downloadSketch/.test(app) &&
    /lower === 's'\) \{[\s\S]{0,320}downloadSketch\(false\);/.test(app));
  check('Ctrl+Shift+S forces the picker (Save As)',
    /downloadSketch\(true\)/.test(app));
  check('Save As is labelled as such in the menu',
    /id="btn-download"[^>]*>Save as/.test(html));
  check('Open keeps the handle so a later Save writes back',
    /save\.handle = handle;/.test(app));
  check('Open and the <input> share one handler',
    /await openDocumentFile\(file\)/.test(app) &&
    (app.match(/async function openDocumentFile\(file\)/g) || []).length === 1);
  check('the click handler does not pass the Event as forcePicker',
    /btn-download'\)\.addEventListener\('click', \(\) => downloadSketch\(\)\)/.test(app));

  console.log('save: host bridge (KaryaCNC iframe)');
  const viaSrc = slice('async function saveViaHost(', 'async function downloadSketch(');
  check('the host bridge only runs inside a frame',
    /if \(!isEmbedded\(\)\) return null;/.test(viaSrc));
  check('it POSTs to the host origin, not a relative path',
    /fetch\('\/save-sketch'/.test(viaSrc));
  check('a plain failure falls through instead of throwing',
    /catch \(err\)[\s\S]{0,40}return null;/.test(viaSrc));
  check('cancelling the host dialog does NOT then download a copy',
    /viaHost === 'cancelled'\) return;/.test(app));
  // Inside a frame the browser picker does not exist, so Save As must reach the
  // host too — the host dialog always asks WHERE to write, which IS "save as".
  check('Save As still reaches the host when embedded',
    /if \(isEmbedded\(\) \|\| !forcePicker\)/.test(app));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
