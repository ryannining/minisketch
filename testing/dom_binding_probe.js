// Guard against the binding-time crash that killed every button.
//
// The app binds its controls in one long block at startup. A single
// `document.getElementById('x').addEventListener(...)` on an element that no
// longer exists throws there, and EVERY binding after it is skipped — so one
// stale id silently disables the whole UI.
//
// This probe statically checks that no `getElementById('x').` chain targets an
// id missing from index.html, unless the same statement guards it with `&&`.
//
// Run: node testing/dom_binding_probe.js
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
let pass = 0, fail = 0;

const unguarded = [];
for (const [i, line] of app.split('\n').entries()) {
  for (const m of line.matchAll(/document\.getElementById\('([^']+)'\)\s*\./g)) {
    const ident = m[1];
    if (ids.has(ident)) continue;
    if (line.slice(0, m.index).includes('&&')) continue;   // guarded on the same line
    unguarded.push((i + 1) + ': #' + ident);
  }
}

console.log('dom_binding: no unguarded getElementById chain on a missing id');
if (unguarded.length === 0) {
  pass++;
  console.log('  PASS  every id chain resolves, or is guarded with &&');
} else {
  fail++;
  console.log('  FAIL  ' + unguarded.length + ' would throw at startup');
  for (const u of unguarded.slice(0, 10)) console.log('        ' + u);
}

const exists = (id) => ids.has(id);
console.log('dom_binding: the buttons the header restructure moved');
for (const id of ['rb-clean', 'rb-group', 'rb-ungroup', 'rb-make-part', 'rb-mate',
  'btn-connected', 'btn-name', 'btn-to-curve', 'btn-group-select',
  'btn-sidebar', 'btn-theme']) {
  const ok = exists(id);
  if (ok) pass++; else fail++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + '#' + id + ' present in markup');
}

console.log('dom_binding: removed sidebar ids are not bound as live elements');
for (const id of ['loop-list', 'constraint-list', 'nsel-list', 'nsel-name',
  'btn-make-part', 'btn-mate', 'btn-dimension']) {
  const chained = new RegExp("getElementById\\('" + id + "'\\)\\s*\\.[a-zA-Z]").test(app);
  const guardedOk = !chained || exists(id) ||
    new RegExp("getElementById\\('" + id + "'\\)\\s*&&").test(app) ||
    new RegExp("const \\w+ = document\\.getElementById\\('" + id + "'\\);\\s*\\n\\s*if").test(app);
  if (guardedOk) pass++; else fail++;
  console.log((guardedOk ? '  PASS  ' : '  FAIL  ') + '#' + id + ' never dereferenced unguarded');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
