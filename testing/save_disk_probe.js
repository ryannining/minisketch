'use strict';
// Ctrl+S must ALWAYS reach the disk.
//
// The fear that drove this: Inkscape-style crash + customer files. Browser
// storage is not a file — clearing site data wipes it, and it cannot be opened
// after a crash. So Ctrl+S may never degrade into "saved to browser".

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

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

console.log('ctrl+s: always writes a file');
// take the block from the Ctrl+S branch up to the next shortcut branch
const sIdx = app.indexOf("if ((ev.ctrlKey || ev.metaKey) && lower === 's') {");
const sEnd = app.indexOf("if ((ev.ctrlKey || ev.metaKey) && lower === 'i')", sIdx);
const ctrlS = sIdx < 0 ? '' : app.slice(sIdx, sEnd);
check('the Ctrl+S branch was found', ctrlS.length > 0);
check('Ctrl+S calls downloadSketch unconditionally',
  /downloadSketch\(false\);/.test(ctrlS));
check('Ctrl+S never falls back to browser-only save',
  !/persistNow\(\)/.test(ctrlS) && !/Saved to browser/.test(ctrlS));
check('the Save button follows the same contract',
  /btn-save'\)\.addEventListener\('click', \(\) => \{[\s\S]{0,120}downloadSketch\(false\)/.test(app));

// Every path downloadSketch can take must end at a file.
console.log('ctrl+s: the three destinations');
const dl = slice('async function downloadSketch(', 'function downloadBlob(');
check('1. inside KaryaCNC: the host writes through a native dialog',
  /saveViaHost\(/.test(dl));
check('2. plain browser: the file picker writes the file',
  /saveTextAs\(text, '.sketch'/.test(dl));
check('3. no picker at all: a download is produced',
  /downloadBlob\('sketch-' \+ stamp/.test(dl));
check('a cancel stops WITHOUT downloading a surprise copy',
  /res === 'cancelled'\) return;/.test(dl));

// The host path really carries the document text.
const host = slice('async function saveViaHost(', 'async function downloadSketch(');
check('the host request carries the serialized document',
  /text: text/.test(host) && /JSON\.stringify\(\{ name: name, text: text \}\)/.test(host));

console.log('reload guard');
const guard = slice('Guard the destructive shortcuts', 'window.addEventListener(\'beforeunload\'');
check('Ctrl+R is intercepted', /k === 'r'/.test(guard));
check('F5 is intercepted', /k !== 'f5'/.test(guard));
check('the guard runs in the capture phase so it wins',
  /\}, true\);/.test(guard));
check('an empty drawing does not nag', /if \(!Object\.keys\(state\.entities\)\.length\) return;/.test(guard));
check('declining the dialog cancels the reload', /if \(!ans\) ev\.preventDefault\(\);/.test(guard));

console.log('browser storage is only a recovery net');
check('autosave still exists (crash recovery)', /function scheduleSave\(\)/.test(app));
check('autosave is debounced, not blocking',
  /saveTimer = setTimeout\(persistNow, 350\)/.test(app));
check('the status label no longer claims a browser save is "saved"',
  !/toast\('Saved to browser'\)/.test(app));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
