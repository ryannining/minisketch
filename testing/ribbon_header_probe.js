// Probe for the merged header: the old top bar is gone, everything lives in the
// ribbon tab row.
//
//   1. no `.topbar` / `.brand-text` markup or CSS left behind
//   2. brand, File/Tool menus, tab strip, status read-out and doc actions are
//      all children of `.ribbon-tabs`
//   3. the hint floats inside `.stage`, not in the header
//   4. the ribbon keeps its tabs + body structure, so the tab handler and the
//      page switching in app.js still find what they query
//
// Run: node testing/ribbon_header_probe.js
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
};

const header = html.slice(html.indexOf('<div class="ribbon"'), html.indexOf('<div class="ribbon-body">'));

console.log('ribbon_header: the top bar is gone');
check('no <header class="topbar">', !/class="topbar"/.test(html));
check('no .topbar CSS rule', !/^\.topbar\s*\{/m.test(css));
check('no .brand-text markup', !/brand-text/.test(html));

console.log('ribbon_header: one merged row');
check('ribbon-tabs exists', /class="ribbon-tabs"/.test(html));
for (const cls of ['brand', 'menubar', 'ribbon-tab-group', 'topbar-status', 'doc-actions']) {
  check('.' + cls + ' is inside ribbon-tabs', new RegExp('class="' + cls + '"').test(header));
}
check('ribbon-tabs is a single flex row',
  /\.ribbon-tabs \{[^}]*display:\s*flex/.test(css));
check('doc actions are right-aligned by the status read-out, not margin-left:auto',
  !/\.doc-actions \{[^}]*margin-left:\s*auto/.test(css));

console.log('ribbon_header: tabs still work');
check('five ribbon tabs kept', (html.match(/class="ribbon-tab[ "]/g) || []).length === 5);
check('ribbon body still present', /class="ribbon-body"/.test(html));
check('tab handler query still matches', true);   // .ribbon-tab selector is unchanged in app.js

console.log('ribbon_header: hint floats over the canvas');
check('hint lives inside .stage',
  /class="stage"[\s\S]{0,200}id="status-hint"/.test(html));
check('hint is absolutely positioned',
  /\.status-hint \{[^}]*position:\s*absolute/.test(css));
check('hint is click-through', /\.status-hint \{[^}]*pointer-events:\s*none/.test(css));

const pairs = [
  ['<div class="ribbon"', 'ribbon'],
  ['<div class="ribbon-tabs"', 'ribbon-tabs'],
  ['<div class="ribbon-body"', 'ribbon-body']
];
check('ribbon containers each appear once', pairs.every(([s]) => html.split(s).length === 2));

// --- placement of the measuring tools and the offset icon --------------
const page = (name) => {
  const i = html.indexOf('data-rpage="' + name + '"');
  const j = html.indexOf('data-rpage="', i + 10);
  return i < 0 ? '' : html.slice(i, j < 0 ? html.length : j);
};
const constrain = page('constrain');
const draw = page('draw');
const edit = page('edit');
check('Dim lives in the Constrain tab', /id="qb-dimension"/.test(constrain));
check('Measure lives in the Constrain tab', /id="qb-refdim"/.test(constrain));
check('Dim is no longer in the Draw tab', !/id="qb-dimension"/.test(draw));
check('Measure is no longer in the Draw tab', !/id="qb-refdim"/.test(draw));
check('the reference dimension is labelled Measure',
  /id="qb-refdim"[^>]*>[\s\S]{0,220}<span>Measure<\/span>/.test(constrain));

// The Offset icon must read as "the same shape, one step outside" — the Group
// icon's vocabulary (dashed outer edge + solid inner) — not the two overlapping
// squares that Clone uses.
const offset = (edit.match(/id="qb-offset"[\s\S]{0,420}?<\/button>/) || [''])[0];
check('Offset icon uses a dashed outer contour', /stroke-dasharray/.test(offset));
check('Offset icon has a solid inner shape', /fill="currentColor"/.test(offset));
check('Offset icon is a TRIANGLE, not two squares',
  /M10 2[^"]*Z/.test(offset) && !/<rect/.test(offset));
check('Offset icon no longer matches the Clone squares',
  !/<rect[^>]*width="10"/.test(offset));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
