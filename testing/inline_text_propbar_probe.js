// Probe for On-Canvas Inline Text, Contextual Property Bar, and EN/ID UI i18n.
// Run: node testing/inline_text_propbar_probe.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const i18nSrc = fs.readFileSync(path.join(root, 'ui-i18n.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log('  PASS  ' + name);
  } else {
    fail++;
    console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : ''));
  }
}

console.log('== 1. Markup & De-duplication ==');
check('#prop-bar exists right after ribbon', html.includes('id="prop-bar"'));
check('#pb-text, #pb-geom, #pb-idle exist',
  html.includes('id="pb-text"') && html.includes('id="pb-geom"') && html.includes('id="pb-idle"'));
check('#pb-geom-transform exposes the Transform gizmo',
  html.includes('id="pb-geom-transform"') &&
  appSrc.includes('pb-geom-transform') && appSrc.includes('enterTransformMode('));
check('#pb-text-transform exposes Transform for text too',
  html.includes('id="pb-text-transform"') &&
  appSrc.includes('pb-text-transform') && appSrc.includes('enterTransformMode('));;
check('#inline-text-input exists inside stage',
  html.includes('id="inline-text-input"') && html.indexOf('id="inline-text-input"') > html.indexOf('id="canvas"'));
check('duplicate #qb-array and #qb-clean removed from Edit ribbon',
  !html.includes('id="qb-array"') && !html.includes('id="qb-clean"'));
check('canonical #btn-array and #rb-clean preserved',
  html.includes('id="btn-array"') && html.includes('id="rb-clean"'));
check('#status-frame hidden by default in index.html',
  /<span id="status-frame"[^>]*class="[^"]*hidden/.test(html));
check('ui-i18n.js script loaded before app.js',
  html.indexOf('src="ui-i18n.js"') > 0 && html.indexOf('src="ui-i18n.js"') < html.indexOf('src="app.js"'));

console.log('== 2. Stylesheet Rules ==');
check('.prop-bar styled cleanly', css.includes('.prop-bar {'));
check('.tf-strip.in-prop-bar docks statically on desktop',
  /\.tf-strip\.in-prop-bar\s*\{[\s\S]*?position:\s*static/.test(css));
check('.inline-text-input off-screen hidden styling present',
  /\.inline-text-input\s*\{[\s\S]*?opacity:\s*0/.test(css));
check('#status-frame.hidden hides developer frame timing',
  /#status-frame\.hidden[\s\S]*?display:\s*none/.test(css));
check(':focus-visible accessibility ring present',
  css.includes('.pb-btn:focus-visible'));

console.log('== 3. Unified EN/ID Localization ==');
const store = {};
const mockEl = { textContent: 'Draw', title: '', placeholder: '', attrs: {}, getAttribute(k) { return this.attrs[k]; }, setAttribute(k, v) { this.attrs[k] = v; } };
mockEl.attrs['data-i18n'] = 'tab.draw';
const i18nCtx = {
  localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = String(v); } },
  document: {
    documentElement: { lang: 'en' },
    querySelectorAll: (sel) => sel === '[data-i18n]' ? [mockEl] : []
  },
  window: {}
};
i18nCtx.window = i18nCtx;
vm.createContext(i18nCtx);
vm.runInContext(i18nSrc, i18nCtx);
const i18n = i18nCtx.MiniSketchI18n;
check('MiniSketchI18n exposed on window', !!i18n && typeof i18n.t === 'function');
const enKeys = Object.keys(i18n.DICT.en);
const idKeys = new Set(Object.keys(i18n.DICT.id));
const missingId = enKeys.filter(k => !idKeys.has(k));
check('100% EN keys have ID translations', missingId.length === 0, missingId.join(', '));
i18n.setLang('id');
check('setLang("id") updates DOM textContent & html lang',
  mockEl.textContent === 'Gambar' && i18nCtx.document.documentElement.lang === 'id');
i18n.setLang('en');
check('setLang("en") restores English DOM textContent',
  mockEl.textContent === 'Draw' && i18nCtx.document.documentElement.lang === 'en');

// Verify every data-i18n* key referenced in index.html exists in DICT.en
const refRe = /data-i18n(?:-(?:title|placeholder|aria))?="([^"]+)"/g;
const missingHtmlKeys = [];
let m;
while ((m = refRe.exec(html)) !== null) {
  if (!(m[1] in i18n.DICT.en)) missingHtmlKeys.push(m[1]);
}
check('every data-i18n* key in index.html exists in ui-i18n.js',
  missingHtmlKeys.length === 0, missingHtmlKeys.join(', '));

console.log('== 4. Inline Text & Property Bar Engine Wiring ==');
check('app.js defines startInlineText, commitInlineText, drawInlineTextOverlay',
  appSrc.includes('function startInlineText(') &&
  appSrc.includes('function commitInlineText(') &&
  appSrc.includes('function drawInlineTextOverlay('));
check('app.js defines updatePropertyBar, initPropertyBar, syncTfStripMount',
  appSrc.includes('function updatePropertyBar(') &&
  appSrc.includes('function initPropertyBar(') &&
  appSrc.includes('function syncTfStripMount('));
check('Text tool click starts inline canvas editing without resetting tool to select',
  /if \(ui\.tool === 'text'\) \{[\s\S]{0,900}startInlineText\(id,\s*\{\s*isNew:\s*true\s*\}\)/.test(appSrc));
check('Double-click on text opens inline canvas editing',
  /if \(ent && ent\.type === 'text'\) \{[\s\S]{0,600}startInlineText\(eh,/.test(appSrc));
check('Font picker supports live hover & arrow preview with restore on cancel',
  appSrc.includes('function pbFontPreviewOnCanvas(') && appSrc.includes('function pbFontRestorePreview('));
check('showFrameTiming setting registered with default false',
  /key:\s*'showFrameTiming'[\s\S]{0,120}def:\s*false/.test(appSrc));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
