// Probe for the Help window: structure, both languages, and the language switch.
//
// Run: node testing/help_probe.js
const fs = require('fs');
const path = require('path');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const vm = require('vm');
const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

function braceEnd(src, from) {
  let depth = 0;
  for (let j = src.indexOf('{', from); j < src.length; j++) {
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

const modalStart = html.indexOf('<div id="help-modal"');
const modal = html.slice(modalStart, html.indexOf('<div id="text-modal"', modalStart) > 0
  ? html.indexOf('<div id="text-modal"', modalStart)
  : html.length);

// The help text itself lives in help.js now (HELP_DATA + renderHelp): the panes
// in index.html are empty containers that renderHelp fills. Run that renderer
// against a tiny DOM so the probe checks the real content, both languages.
const helpSrc = fs.readFileSync(path.join(__dirname, '..', 'help.js'), 'utf8');
const rendered = (() => {
  const panes = { en: { innerHTML: '' }, id: { innerHTML: '' } };
  const sandbox = {
    window: {},
    document: { querySelector: (sel) => (sel === '[data-help-pane="en"]' ? panes.en : panes.id) }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(helpSrc, sandbox);
  return panes;
})();
const paneOf = (lang) => {
  const pane = rendered[lang];
  if (!pane) return null;
  const attrsAt = modal.indexOf('data-help-pane="' + lang + '"');
  const attrs = attrsAt < 0 ? '' : modal.slice(attrsAt, modal.indexOf('>', attrsAt));
  return { hidden: /hidden/.test(attrs), body: pane.innerHTML };
};

console.log('\n== the window is there ==');
{
  check('a Help button in the top bar', /id="btn-help"[^>]*>Help</.test(html));
  check('the modal and its body', /id="help-modal"/.test(html) && /id="help-body"/.test(html));
  check('a Close button', /id="help-close"/.test(html));
  check('two language buttons', (html.match(/data-help-lang="/g) || []).length === 2);
  check('no leftover tips-* ids', !/tips-modal|tips-close|btn-tips/.test(html));
  check('no leftover tips-* classes', !/tips-box|tips-btn/.test(html));
  check('the divider count is balanced',
    (html.match(/<div\b/g) || []).length === (html.match(/<\/div>/g) || []).length,
    (html.match(/<div\b/g) || []).length + ' / ' + (html.match(/<\/div>/g) || []).length);
}

console.log('\n== both languages are complete ==');
{
  const en = paneOf('en');
  const id = paneOf('id');
  check('there is an English pane', !!en);
  check('there is an Indonesian pane', !!id);
  check('Indonesian starts hidden, English is shown', en && !en.hidden && id && id.hidden,
    JSON.stringify({ en: en && en.hidden, id: id && id.hidden }));

  const count = (body, re) => (body.match(re) || []).length;
  const enSecs = count(en.body, /<section class="help-sec/g);
  const idSecs = count(id.body, /<section class="help-sec/g);
  check('the same number of sections in both', enSecs === idSecs && enSecs >= 8, enSecs + ' / ' + idSecs);

  const enKeys = count(en.body, /<div class="help-key">/g);
  const idKeys = count(id.body, /<div class="help-key">/g);
  check('the key table has every key in both', enKeys === idKeys && enKeys >= 30, enKeys + ' / ' + idKeys);

  const enH = (en.body.match(/<h4>[^<]+<\/h4>/g) || []).map(s => s.replace(/<\/?h4>/g, ''));
  const idH = (id.body.match(/<h4>[^<]+<\/h4>/g) || []).map(s => s.replace(/<\/?h4>/g, ''));
  check('the section titles are translated', enH.length === idH.length && enH.some((t, i) => t !== idH[i]),
    enH.join(' | ') + '  VS  ' + idH.join(' | '));

  const words = (s) => s.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).length;
  check('the English text is substantial', words(en.body) > 700, words(en.body));
  check('the Indonesian text is substantial', words(id.body) > 700, words(id.body));
  check('the Indonesian pane really is Indonesian',
    /(dan|yang|untuk|dengan|tidak|bisa)\b/.test(id.body) && !/The |and the /.test(id.body.slice(0, 400)),
    id.body.slice(0, 120));
  check('both panes keep the important facts',
    /KaryaCNC/.test(en.body) && /KaryaCNC/.test(id.body) &&
    /Clipper/.test(en.body) && /Clipper/.test(id.body));
  check('no untranslated placeholders', !/TODO|FIXME|lorem/i.test(modal));
  check('the keys are marked up as <kbd>', count(en.body, /<kbd>/g) === count(en.body, /<\/kbd>/g) && count(en.body, /<kbd>/g) >= 30,
    count(en.body, /<kbd>/g));
}

console.log('\n== the text is bigger ==');
{
  const oldSize = 11.5;
  const m = /\.help-body \{[\s\S]*?font-size: ([\d.]+)px/.exec(css);
  check('the help body font size is declared', !!m, m && m[1]);
  const size = m ? parseFloat(m[1]) : 0;
  check('it is 1.25x the old 11.5px', Math.abs(size - oldSize * 1.25) < 0.05, size);
  check('line height is comfortable', /\.help-body \{[\s\S]*?line-height: 1\.6/.test(css));
  check('no old 11px help rule left', !/\.help-body \{\s*margin-top: 9px;\s*font-size: 11px/.test(css));
  check('the key table is two columns', /\.help-keys \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/.test(css));
  check('it folds to one column on a narrow window', /@media \(max-width: 700px\)[\s\S]*?\.help-keys \{ grid-template-columns: 1fr; \}/.test(css));
  check('a hidden pane is really hidden', /\.help-pane\[hidden\] \{ display: none; \}/.test(css));
}

console.log('\n== the language switch works ==');
{
  const mkEl = (attrs) => {
    const el = {
      attrs,
      hidden: false,
      cls: new Set(),
      getAttribute: (k) => attrs[k]
    };
    el.classList = {
      toggle: (c, on) => { if (on) el.cls.add(c); else el.cls.delete(c); }
    };
    return el;
  };

  const panes = [mkEl({ 'data-help-pane': 'en' }), mkEl({ 'data-help-pane': 'id' })];
  const btns = [mkEl({ 'data-help-lang': 'en' }), mkEl({ 'data-help-lang': 'id' })];
  const store = {};
  const body = { scrollTop: 99 };
  const document = {
    querySelectorAll: (sel) => (sel === '[data-help-pane]' ? panes : sel === '[data-help-lang]' ? btns : []),
    getElementById: (id) => (id === 'help-body' ? body : null)
  };
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); }
  };
  const api = new Function('document', 'localStorage',
    'const HELP_LANG_KEY = "minisketch.help.lang";\n' +
    sliceApp('helpLang') + '\n' + sliceApp('setHelpLang') +
    '\nreturn { helpLang, setHelpLang };')(document, localStorage);

  api.setHelpLang('id');
  check('choosing Indonesian hides English', panes[0].hidden === true && panes[1].hidden === false,
    JSON.stringify(panes.map(p => p.hidden)));
  check('the active button is marked', btns[1].cls.has('is-on') && !btns[0].cls.has('is-on'));
  check('the choice is remembered', store['minisketch.help.lang'] === 'id', store['minisketch.help.lang']);
  check('the pane scrolls back to the top', body.scrollTop === 0);

  api.setHelpLang('en');
  check('switching back shows English', panes[0].hidden === false && panes[1].hidden === true);
  check('and remembers that', api.helpLang() === 'en', api.helpLang());

  api.setHelpLang('klingon');
  check('an unknown language falls back to English', api.helpLang() === 'en' && panes[0].hidden === false);

  const broken = new Function('document', 'localStorage',
    'const HELP_LANG_KEY = "minisketch.help.lang";\n' + sliceApp('helpLang') +
    '\nreturn helpLang();')(document, { getItem: () => { throw new Error('blocked'); }, setItem: () => {} });
  check('a blocked localStorage still yields a language', broken === 'en', broken);
}

console.log('\n== no stale id was left behind ==');
{
  // a renamed element id is the classic way to break init(): bindUI() throws on the
  // first undefined variable and every binding after it is skipped
  // `tips[A-Z]...` used to mean the tooltip binder ran before its panel existed.
  // The tip box is gone and only `dataset.tipsBound` (a marker on the host
  // element) is left, which is not a DOM lookup — allow that one name.
  const tipsIds = (appSrc.match(/\btips[A-Z]\w*\b/g) || []).filter(w => w !== 'tipsBound');
  check('no tips* identifier in app.js', tipsIds.length === 0, tipsIds.join(' '));
  check('no tips- class or id anywhere', !/tips-/.test(appSrc) && !/tips-/.test(html));

  const ids = new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g)).map(m => m[1]));
  const wanted = new Set(Array.from(appSrc.matchAll(/getElementById\('([^']+)'\)/g)).map(m => m[1]));
  // these four buttons were removed on purpose (Undo/Redo/Fit/Demo are shortcuts
  // only), and "set-*" inputs are built by the settings form at runtime
  const gone = new Set(['btn-undo', 'btn-redo', 'btn-fit', 'btn-demo']);
  // Panels that were deliberately deleted from the markup. Their update
  // functions survive as guarded no-ops (`if (!list) return`), which is on
  // purpose: the state still changes and a future panel can be dropped in
  // without touching a dozen call sites. The CONTRACT is that these ids never
  // come back to index.html (panel_restructure_probe asserts that), not that
  // app.js must not mention them.
  const removedPanels = new Set(['constraint-list', 'constraint-block', 'constraint-count',
    'loop-list', 'loop-count', 'btn-clean-loops', 'btn-make-part', 'btn-mate',
    'nsel-save', 'nsel-name', 'nsel-list', 'btn-group', 'btn-ungroup']);
  // the PDF import dialog is built on demand (openPdfImport), never in the markup
  const builtInJs = new Set(['pdf-import-modal', 'pdf-colors', 'pdf-drop-tiny', 'pdf-cancel', 'pdf-ok',
    'pdf-text-mode']);
  // the quickbar dimension button is the live one; btn-dimension is its retired twin
  const retiredIds = new Set(['btn-dimension']);
  const missing = Array.from(wanted).filter(id => !ids.has(id) && !id.startsWith('set-') &&
    !gone.has(id) && !builtInJs.has(id) && !removedPanels.has(id) && !retiredIds.has(id));
  check('every getElementById target exists in the markup', missing.length === 0, missing.join(', '));

  const classes = new Set(Array.from(html.matchAll(/class="([^"]+)"/g))
    .flatMap(m => m[1].split(/\s+/)).filter(Boolean));
  const sel = Array.from(appSrc.matchAll(/querySelector(?:All)?\('\.([\w-]+)'/g)).map(m => m[1]);
  // swatches, list-item names and their wrappers are created in JS
  const builtByJs = new Set(['swatch', 'name', 'swatch-wrap']);
  const missClass = sel.filter(c => !classes.has(c) && !builtByJs.has(c));
  check('every querySelector class exists in the markup', missClass.length === 0, missClass.join(', '));
}

console.log('\n== wiring ==');
{
  check('the Help button opens it', /btn-help[\s\S]{0,120}openHelpModal/.test(appSrc));
  check('Close dismisses it', /help-close[\s\S]{0,120}closeHelpModal/.test(appSrc));
  check('Escape dismisses it', /help-modal[\s\S]{0,200}closeHelpModal/.test(appSrc));
  check('? opens it', /openHelpModal\(\)/.test(appSrc) && /key === '\?'/.test(appSrc));
  check('opening applies the remembered language', /function openHelpModal\(\) \{\s*setHelpLang\(helpLang\(\)\)/.test(appSrc));
  check('the language buttons are wired', /data-help-lang[\s\S]{0,160}setHelpLang/.test(appSrc));
}

console.log('\n' + (fail ? (fail + ' FAILED, ' + pass + ' passed') : ('all ' + pass + ' checks passed')));
process.exit(fail ? 1 : 0);
