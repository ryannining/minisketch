// Probe for the line-colour swatch selection mark.
//
// The stage line swatches paint themselves through an S-shaped CSS mask. A mask
// clips the element's OWN box-shadow and pseudo-elements, so the "active" ring
// and the "selection uses this colour" dot could never show on the button — the
// fill squares (no mask) looked right while the line colours did not.
//
// The fix moves both marks to an unmasked `.swatch-wrap` around the button.
// This probe pins that structure and the CSS that draws the marks.
//
// Run: node testing/swatch_mark_probe.js
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

console.log('swatch mark: the button is still masked');
check('line swatch keeps its S mask',
  /\.stage-colors \.swatches \.swatch \{[\s\S]{0,600}-webkit-mask:/.test(css));
check('masked button paints no shadow of its own',
  /\.stage-colors \.swatches \.swatch \{[\s\S]{0,400}box-shadow:\s*none/.test(css));

console.log('swatch mark: marks live on the unmasked wrapper');
check('a .swatch-wrap rule exists', /\.swatch-wrap \{/.test(css));
check('wrapper is not masked',
  !/\.swatch-wrap[^{]*\{[^}]*-webkit-mask/.test(css));
check('wrapper positions its own marker',
  /\.swatch-wrap \{[^}]*position:\s*relative/.test(css));

console.log('swatch mark: active ring');
check('active ring drawn on the wrapper',
  /\.swatch-wrap\.active \{[^}]*box-shadow/.test(css));
check('no dead ring rule left on the masked button',
  !/\.swatches \.swatch\.active \{/.test(css));

console.log('swatch mark: selection colour dot');
check('sel-color draws a dot on the wrapper',
  /\.swatch-wrap\.sel-color::after \{[^}]*content:\s*''/.test(css));
check('the old display:none suppressor is gone',
  !/\.swatch\.sel-color::after \{ display: none; \}/.test(css));

console.log('swatch mark: JS wires it up');
check('swatches are created inside a wrapper',
  /const wrap = document\.createElement\('span'\);[\s\S]{0,200}wrap\.className = 'swatch-wrap'/.test(app));
check('wrapper carries the colour for lookup',
  /wrap\.dataset\.color = c\.value/.test(app));
check('wrapper is appended to the swatch row',
  /sw\.appendChild\(wrap\)/.test(app));
check('the button is no longer cloned an active class in markup',
  /b\.className = 'swatch';/.test(app));

console.log('swatch mark: every selected colour is marked, not just the first');
check('a Set of selection colours is built',
  /const selColors = new Set\(selectedEntities\(\)\.map\(e => colorOf\(e\)\)\)/.test(app));
check('each wrapper is compared against that set',
  /w\.classList\.toggle\('sel-color', selColors\.has\(w\.dataset\.color\)\)/.test(app));
check('no first-entity-only shortcut left',
  !/const selColor = \(\(\(\) => \{/.test(app));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
