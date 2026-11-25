// Probe for the cross-device PC + tablet + mobile touch UI upgrades:
//   1. F1/F2/F3 mode switcher markup, binding, and pickFilter sync
//   2. Collapsible L/T/W/H bar for narrow viewports (<=900px) with live W×H readout
//   3. Contextual floating action bar (#ctx-bar) covering Offset, Line/Curve/Arc/
//      Box/Poly drafts, Move, Mate, Drag Wall, and unsolved manual solver (F9)
//   4. Slide-over sidebar backdrop + close header + splitter media-query guard
//   5. Automatic touch ergonomics (@media (pointer: coarse)) and modal max-width safety
//   6. Boolean Shift toggle support for touch devices
//   7. Main server port stays 8090
//
// Run: node testing/responsive_touch_ui_probe.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const serve = fs.readFileSync(path.join(root, 'server', 'serve.js'), 'utf8');

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
};

console.log('responsive_touch_ui: server port invariant');
check('server/serve.js defaults to port 8090',
  /process\.env\.PORT \|\| 8090/.test(serve));

console.log('responsive_touch_ui: F1/F2/F3 mode switcher');
for (const id of ['mode-switch', 'mode-f1', 'mode-f2', 'mode-f3']) {
  check('index.html has #' + id, new RegExp('id="' + id + '"').test(html));
}
check('app.js binds F1/F2/F3 mode buttons',
  /modeF1\.addEventListener\('click', \(\) => setMode\('select'\)\)/.test(app) &&
  /modeF2\.addEventListener\('click', \(\) => setMode\('node'\)\)/.test(app) &&
  /modeF3\.addEventListener\('click', \(\) => cmdSelectJunctionPoints\(\)\)/.test(app));
check('syncPickFilterUI updates #mode-f1 and #mode-f2 states',
  /function syncPickFilterUI\(\)[\s\S]{0,900}getElementById\('mode-f1'\)/.test(app));

console.log('responsive_touch_ui: collapsible L/T/W/H bar');
check('index.html has #tf-toggle-btn and #tf-close-btn',
  /id="tf-toggle-btn"/.test(html) && /id="tf-close-btn"/.test(html));
check('styles.css reveals .stage-lth-toggle and .tf-strip.lth-open at <=900px',
  /@media \(max-width: 900px\)[\s\S]{0,500}\.stage-lth-toggle \{ display: inline-flex; \}[\s\S]{0,500}\.tf-strip\.lth-open/.test(css));
check('updateTransformPanel updates #tf-toggle-label with W × H mm',
  /getElementById\('tf-toggle-label'\)[\s\S]{0,600}vals\[2\]/.test(app));

console.log('responsive_touch_ui: contextual touch action bar');
check('index.html has #ctx-bar inside .stage',
  /id="ctx-bar"/.test(html));
check('updateContextBar covers offset, draft, move, mate, dragwall, solveDirty',
  /function updateContextBar\(\)[\s\S]{0,1200}ui\.offsetJob[\s\S]{0,1200}ui\.draft[\s\S]{0,1200}ui\.moveJob[\s\S]{0,1200}mateJob[\s\S]{0,1200}dragwall[\s\S]{0,1200}ui\.solveDirty/.test(app));
check('applyOffsetValue commits offset directly without double prompt',
  /function applyOffsetValue\(raw\)/.test(app));

console.log('responsive_touch_ui: solver access on narrow & touch screens');
for (const id of ['btn-solve-now', 'btn-solve-mode', 'sidebar-solve-now', 'sidebar-solve-mode']) {
  check('index.html has #' + id, new RegExp('id="' + id + '"').test(html));
}
check('app.js wires solver buttons to solveAll and cycleSolveMode',
  /btnSolveNow\.addEventListener\('click', \(\) => solveAll\(\)\)/.test(app) &&
  /sideSolveMode\.addEventListener\('click', \(\) => cycleSolveMode\(\)\)/.test(app));

console.log('responsive_touch_ui: sidebar drawer, backdrop & splitter guard');
check('index.html has #sidebar-backdrop and #btn-sidebar-close',
  /id="sidebar-backdrop"/.test(html) && /id="btn-sidebar-close"/.test(html));
check('bindSidebarSplitter clears inline width in slide-over mode',
  /function bindSidebarSplitter\(\)[\s\S]{0,800}isSlideOver\(\)[\s\S]{0,300}side\.style\.width = ''/.test(app));
check('stale .doc-actions width:100% phone bug removed',
  !/\.doc-actions\s*\{\s*width:\s*100%/.test(css));

console.log('responsive_touch_ui: automatic touch scaling & modal safety');
check('styles.css has @media (pointer: coarse) touch sizing block',
  /@media \(pointer: coarse\)[\s\S]{0,2000}\.stage-left-tab[\s\S]{0,2000}\.ctx-btn/.test(css));
check('modal dialogs clamp width to viewport on narrow phones',
  /\.modal-box \{[^}]*max-width: calc\(100vw - 24px\)/.test(css) &&
  /\.text-box \{ width: min\(410px, calc\(100vw - 24px\)\); \}/.test(css) &&
  /\.fit-box \{ width: min\(380px, calc\(100vw - 24px\)\); \}/.test(css));
check('xfPositionPanel clamps y inside stage bounds',
  /function xfPositionPanel[\s\S]{0,1600}y = clamp\(y, 6, Math\.max\(6, SH - h - 6\)\)/.test(app));
check('boolean quick actions honor touch ui.shiftToggle',
  /const keep = !!\(\(ev && ev\.shiftKey\) \|\| ui\.shiftToggle\)/.test(app));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
