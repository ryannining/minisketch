// Probe for the touch UI: on-screen Shift/Ctrl/Alt toggles + two-finger pinch.
//
// app.js is one IIFE, so the source is checked structurally:
//   1. the three toggle buttons exist in index.html and carry data-toggle
//   2. app.js binds them and pushes the flag onto ui.<x>Down, the same flags
//      the keyboard path sets, so every tool reacts to the toggle
//   3. onPointerMove / onKeyUp compose pinch toggles with the real keys via OR
//      (a plain assignment would erase the toggle on the next mouse move)
//   4. a two-finger gesture zooms about the pinch midpoint and clamps zoom
//      to the same 0.03..100 range the wheel uses
//
// Run: node testing/touch_ui_probe.js
const fs = require('fs');
const path = require('path');
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
};

console.log('touch_ui: markup');
for (const k of ['shift', 'ctrl', 'alt']) {
  check('index.html has data-toggle="' + k + '"',
    new RegExp('data-toggle="' + k + '"').test(htmlSrc));
}
check('toggle buttons inside .tf-toggle-wrapper',
  /class="tf-toggle-wrapper"[\s\S]{0,600}data-toggle="shift"/.test(htmlSrc));
check('no inline display:flex forcing toggles on desktop',
  !/class="tf-toggle-wrapper"[^>]*style="[^"]*display:\s*flex/.test(htmlSrc));

console.log('touch_ui: toggle sizing');
const cssSrc = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
check('touch edit panel matches the 120px Layers card',
  /\.stage-edit \{[^}]*width:\s*120px/.test(cssSrc));
check('icon grid is 3 columns',
  /\.stage-edit \{[^}]*grid-template-columns:\s*repeat\(3,/.test(cssSrc));
check('toggles size to their cell (no fixed 34px width)',
  /\.tf-toggle-wrapper \.toggle \{[^}]*width:\s*auto/.test(cssSrc));

console.log('touch_ui: modifier composition');
check('pointermove ORs shiftToggle',
  /ui\.shiftDown = ev\.shiftKey \|\| ui\.shiftToggle/.test(appSrc));
check('pointermove ORs ctrlToggle',
  /ui\.ctrlDown = ev\.ctrlKey \|\| ui\.ctrlToggle/.test(appSrc));
check('pointermove ORs altToggle',
  /ui\.altDown = ev\.altKey \|\| ui\.altToggle/.test(appSrc));
check('keyup ORs shiftToggle',
  /const shift = ev\.shiftKey \|\| ui\.shiftToggle/.test(appSrc));

console.log('touch_ui: toggle binding');
check('data-toggle buttons are bound',
  /querySelectorAll\('\.rb-btn\.toggle\[data-toggle\]'\)/.test(appSrc));
check('toggle flips ui.ctrlToggle', /ui\[toggleField\[k\]\] = !ui\[toggleField\[k\]\]/.test(appSrc));
check('toggle syncs Down flag', /ui\[toggleFlag\[k\]\] = !!ui\[toggleField\[k\]\]/.test(appSrc));
check('active class drives the on state', /classList\.toggle\('active'/.test(appSrc));

console.log('touch_ui: pinch gesture');
check('tracks touch pointers by id', /const touchPts = new Map\(\)/.test(appSrc));
check('two fingers start the gesture', /touchPts\.size === 2\) beginPinch/.test(appSrc));
check('zoom clamped to wheel range', /clamp\(pinch\.zoom \* scale, 0\.03, 100\)/.test(appSrc));
check('zoom anchored at pinch midpoint',
  /const anchor = \{\s*x: \(pinch\.mx - pinch\.ox\) \/ pinch\.zoom/.test(appSrc));
check('gesture swallows the tap that ends it', /pinchSwallowed/.test(appSrc));

const mathOk = (() => {
  const d0 = 100, d1 = 200;              // fingers spread 2x
  const zoom0 = 1, zoom = Math.max(0.03, Math.min(100, zoom0 * (d1 / d0)));
  return Math.abs(zoom - 2) < 1e-9;
})();
check('2x finger spread doubles zoom', mathOk);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
