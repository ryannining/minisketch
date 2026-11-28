// Probe for Touch Mode & Laptop-Style Virtual Mouse Touchpad:
//   1. Manual Touch Mode toggle in header (#btn-touch-mode) & Tool menu (#tgl-touch-mode)
//   2. Slim icon-only ribbon in body.touch-mode (hides .kbd-chip and labels)
//   3. Swatch color panel (#stage-colors) dynamically relocates into #stage-left-panels
//      below Layers so collapsing #stage-left hides Edit + Layers + Swatches together
//   4. Direct touch on #canvas in Touch Mode is strictly Pan (1 finger) & Pinch-Zoom (2 fingers),
//      even when the touchpad is collapsed
//   5. Virtual mouse cursor (#vcursor) + collapsible touchpad dock (#vpad-dock & #vpad-reopen)
//      with left-side Shift/Ctrl/Alt + Left/Drag-Lock/Right controls and right-side pad surface
//   6. Synthetic mouse events (pointerType:'mouse', _virtual:true) + safeSetPointerCapture
//
// Run: node testing/virtual_touchpad_probe.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'ui-i18n.js'), 'utf8');

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
};

console.log('virtual_touchpad: HTML markup');
for (const id of [
  'btn-touch-mode', 'tgl-touch-mode', 'vcursor', 'vpad-dock',
  'vpad-lmb', 'vpad-drag-lock', 'vpad-rmb', 'vpad-surface',
  'vpad-collapse', 'vpad-reopen'
]) {
  check('index.html has #' + id, new RegExp('id="' + id + '"').test(html));
}
for (const m of ['shift', 'ctrl', 'alt']) {
  check('touchpad has modifier toggle data-vmod="' + m + '"',
    new RegExp('data-vmod="' + m + '"').test(html));
}
check('vpad-controls placed left of vpad-pad-wrap inside #vpad-dock',
  /id="vpad-dock"[\s\S]{0,4000}class="vpad-controls"[\s\S]{0,4000}class="vpad-pad-wrap"/.test(html));

console.log('virtual_touchpad: CSS rules');
check('body.touch-mode hides .kbd-chip badges',
  /body\.touch-mode \.ribbon \.kbd-chip[\s\S]{0,120}display:\s*none/.test(css));
check('body.touch-mode hides ribbon button text labels',
  /body\.touch-mode \.ribbon-body \.rb-btn > span:not\(\.kbd-chip\)\s*\{\s*display:\s*none;/.test(css));
check('body.touch-mode styles relocated .stage-colors inside .stage-left-panels',
  /body\.touch-mode \.stage-left-panels \.stage-colors\s*\{[\s\S]{0,300}position:\s*static/.test(css));
check('body.touch-mode hides duplicate .tf-toggle-wrapper inside .stage-edit',
  /body\.touch-mode \.stage-edit \.tf-toggle-wrapper\s*\{\s*display:\s*none;/.test(css));
check('vcursor supports arrow + crosshair + pressed/locked ring',
  /\.vcursor\[data-cursor="crosshair"\] \.vcursor-cross \{ display: block; \}/.test(css) &&
  /\.vcursor\.is-locked \.vcursor-ring/.test(css));

console.log('virtual_touchpad: JS engine & pointer bridge');
check('safeSetPointerCapture skips synthetic _virtual events',
  /function safeSetPointerCapture\(el, ev\)\s*\{\s*if \(!el \|\| !ev \|\| ev\._virtual/.test(app));
check('no raw canvas.setPointerCapture left in onPointerDown',
  !/async function onPointerDown[\s\S]{0,4500}canvas\.setPointerCapture/.test(app));
check('makeVirtualEvent synthesizes pointerType:"mouse" with _virtual:true',
  /function makeVirtualEvent[\s\S]{0,500}_virtual:\s*true[\s\S]{0,120}pointerType:\s*'mouse'/.test(app));
check('bindCanvas intercepts direct non-mouse touch in Touch Mode for pan/zoom only',
  /if \(ui\.touchMode && ev\.pointerType !== 'mouse'\)[\s\S]{0,450}touchPan =/.test(app));
check('relocateSwatches moves #stage-colors into #stage-left-panels in Touch Mode',
  /const relocateSwatches = \(toLeftPanel\) =>[\s\S]{0,250}leftPanelsEl\.appendChild\(colorsEl\)/.test(app));
check('initTouchMode persists preference and auto-detects pointer:coarse',
  /const TOUCH_MODE_KEY = 'minisketch\.touchMode'/.test(app) &&
  /matchMedia\('\(pointer: coarse\)'\)/.test(app));
check('init() calls initTouchMode()',
  /bindUI\(\);\s*initTouchMode\(\);/.test(app));

console.log('virtual_touchpad: i18n coverage');
for (const key of ['tool.touchMode', 'dlg.touchModeToggle', 'vpad.left', 'vpad.right', 'vpad.lock', 'vpad.locked', 'vpad.open']) {
  const count = (i18n.match(new RegExp("'" + key.replace('.', '\\.') + "':", 'g')) || []).length;
  check('ui-i18n.js has EN+ID entries for ' + key, count >= 2, 'found ' + count);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
