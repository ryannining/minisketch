// Probe for the settings module: spec integrity, clamping, persistence and the
// hand-off into the working constants.
//
// Run: node testing/settings_probe.js
const fs = require('fs');
const path = require('path');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const coreSrc = fs.readFileSync(path.join(__dirname, '..', 'core.js'), 'utf8');
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

function braceEnd(src, from) {
  let i = src.indexOf('{', from), depth = 0;
  for (let j = i; j < src.length; j++) {
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

// the spec block is a const, so lift it verbatim
const specStart = appSrc.indexOf('  const SETTINGS_SPEC = [');
const specEnd = appSrc.indexOf('  const settings = {};');
if (specStart < 0 || specEnd < 0) throw new Error('spec block not found');
const specSrc = appSrc.slice(specStart, specEnd);

const kStart = appSrc.indexOf('  const SETTINGS_KEY = ');
const keySrc = appSrc.slice(kStart, appSrc.indexOf('\n', kStart) + 1);

const build = (store) => new Function(
  'localStorage', 'applySettings',
  keySrc + specSrc + '\nconst settings = {};\n' +
  ['settingsDefaults', 'settingSpec', 'clampSetting', 'loadSettings', 'saveSettings']
    .map(sliceApp).join('\n') +
  '\nreturn { SETTINGS_SPEC, settings, settingsDefaults, settingSpec, clampSetting, loadSettings, saveSettings };'
)(
  {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); }
  },
  () => { store.__applied = (store.__applied || 0) + 1; }
);

console.log('\n== the spec is sane ==');
{
  const api = build({});
  let ok = true;
  const seen = new Set();
  for (const sp of api.SETTINGS_SPEC) {
    if (!sp.key || !sp.label || !sp.group) ok = false;
    if (seen.has(sp.key)) ok = false;
    seen.add(sp.key);
    if (sp.choices) {
      // a choice knob: default must be one of the offered values
      if (!sp.choices.some(pair => pair[0] === sp.def)) ok = false;
    } else if (sp.text || sp.password || sp.hidden) {
      // a text field and a masked key have no numeric bounds; a hidden spec
      // lives on a menu toggle and carries its default only
      if (sp.def == null) ok = false;
    } else {
      if (!(sp.min < sp.def && sp.def < sp.max)) ok = false;
      if (!(sp.step > 0)) ok = false;
    }
  }
  check('every entry has a key, label, group and a def inside min..max', ok);
  check('keys are unique', seen.size === api.SETTINGS_SPEC.length, seen.size);
  check('the asked-for knobs are all there',
    ['bakeJoinTol', 'artTol', 'splineSeg', 'textTol', 'textTracePx', 'cncFlatten']
      .every(k => seen.has(k)), Array.from(seen).join(','));
  check('groups are used for the window layout',
    new Set(api.SETTINGS_SPEC.map(sp => sp.group)).size >= 4,
    Array.from(new Set(api.SETTINGS_SPEC.map(sp => sp.group))).join(','));
  check('every knob documents itself',
    api.SETTINGS_SPEC.every(sp => typeof sp.help === 'string' && sp.help.length > 10));
}

console.log('\n== clamping ==');
{
  const api = build({});
  const sp = api.settingSpec('artTol');
  check('below the minimum is raised', api.clampSetting(sp, 0.0001) === sp.min, api.clampSetting(sp, 0.0001));
  check('above the maximum is lowered', api.clampSetting(sp, 99) === sp.max, api.clampSetting(sp, 99));
  check('junk falls back to the default', api.clampSetting(sp, 'abc') === sp.def);
  const intSp = api.settingSpec('splineSeg');
  check('integer knobs are rounded', api.clampSetting(intSp, 7.6) === 8, api.clampSetting(intSp, 7.6));
  const joinSp = api.settingSpec('offsetJoin');
  check('offset corners offers sharp / round / square',
    joinSp.choices.map(pair => pair[0]).join(',') === 'sharp,round,square',
    JSON.stringify(joinSp.choices));
  check('an unknown choice falls back to the default', api.clampSetting(joinSp, 'wobbly') === joinSp.def,
    api.clampSetting(joinSp, 'wobbly'));
  check('a valid choice is kept', api.clampSetting(joinSp, 'round') === 'round');
  check('the default corner style is sharp', joinSp.def === 'sharp', joinSp.def);
  check('null falls back to the default', api.clampSetting(sp, null) === sp.def);
  check('an unknown key is reported as such', api.settingSpec('nope') === null);
}

console.log('\n== defaults and persistence ==');
{
  const store = {};
  const api = build(store);
  api.loadSettings();
  const def = api.settingsDefaults();
  check('a fresh install gets the defaults',
    api.SETTINGS_SPEC.every(sp => api.settings[sp.key] === def[sp.key]));
  check('loading pushes the values into the app', store.__applied === 1, store.__applied);

  api.settings.artTol = 0.25;
  api.settings.splineSeg = 24;
  api.saveSettings();
  check('the values are written to storage', /0.25/.test(store['minisketch.settings.v1'] || ''),
    store['minisketch.settings.v1']);

  const api2 = build(store);
  api2.loadSettings();
  check('and restored on the next load', api2.settings.artTol === 0.25 && api2.settings.splineSeg === 24,
    JSON.stringify({ art: api2.settings.artTol, seg: api2.settings.splineSeg }));
  check('missing keys fall back to their defaults', api2.settings.textTol === api2.settingSpec('textTol').def,
    api2.settings.textTol);
}
{
  const store = { 'minisketch.settings.v1': JSON.stringify({ artTol: 500, splineSeg: 'x' }) };
  const api = build(store);
  api.loadSettings();
  check('out-of-range stored values are clamped', api.settings.artTol === api.settingSpec('artTol').max,
    api.settings.artTol);
  check('unreadable stored values fall back', api.settings.splineSeg === api.settingSpec('splineSeg').def,
    api.settings.splineSeg);
}
{
  const store = { 'minisketch.settings.v1': '{not json' };
  const api = build(store);
  let threw = false;
  try { api.loadSettings(); } catch (err) { threw = true; }
  check('broken storage does not throw', !threw);
  check('and the defaults are used', api.settings.bakeJoinTol === api.settingSpec('bakeJoinTol').def);
}

console.log('\n== every knob reaches a working constant ==');
{
  // applySettings() must mention every key, otherwise a knob would do nothing
  const start = appSrc.indexOf('  function applySettings() {');
  const body = appSrc.slice(start, braceEnd(appSrc, start));
  // The menu toggles (hidden specs) are READ where they are used, not pushed
  // into working constants by applySettings — that split is deliberate.
  // So are curveFitTol / booleanFit / curveSharpAngle: the fitter reads them at
  // the moment it runs, because two different features want them live.
  // autoSolveInterval is read by scheduleDragAutoSolve every time the timer
  // arms; the two AI keys are read by ai/chat.js (which owns the chat panel),
  // not by applySettings. A form key that is consumed somewhere else is fine —
  // the check below is about keys applySettings silently drops on the floor.
  // These are read where they are used instead: the AI ones in ai/chat.js,
  // the rest on the canvas or in the menus.
  const readAtUse = new Set(['curveFitTol', 'booleanFit', 'curveSharpAngle',
    'autoDimension', 'autoSolve', 'undoRestoresView',
    'autoSolveInterval', 'aiBridgeUrl', 'aiMaxRounds',
    'aiApiUrl', 'aiApiKey', 'aiModel']);
  const formKeys = build({}).SETTINGS_SPEC.filter(sp => !sp.hidden).map(sp => sp.key);
  const missing = [];
  for (const key of formKeys) {
    if (readAtUse.has(key)) continue;
    if (!body.includes('settings.' + key)) missing.push(key);
  }
  check('applySettings touches each form key', missing.length === 0, missing.join(','));
  // and the constants it writes must exist in the app. SPLINE_SEG / ARC_SEG
  // live in core.js now (it is where splineSamples / sampleArc use them), so
  // their declarations are not in app.js any more — only the assignments are.
  const round = ['TEXT_TOL_MM', 'TEXT_TRACE_PX', 'ART_TOL_MM', 'ART_MAX_MM', 'BAKE_JOIN_TOL',
    'CIRCLE_CHORD', 'OFFSET_MITER', 'OFFSET_TOL', 'OFFSET_JOIN', 'OFFSET_ARC_TOL'];
  const inCore = ['SPLINE_SEG', 'ARC_SEG'];
  for (const name of round) {
    check(name + ' is a mutable working constant',
      new RegExp('let ' + name + ' = ').test(appSrc));
  }
  for (const name of inCore) {
    check(name + ' is assigned from settings (declared in core.js)',
      new RegExp(name + ' = settings\\.').test(appSrc));
  }
  check('SPLINE_SEG and ARC_SEG really exist in core.js',
    /var SPLINE_SEG = /.test(coreSrc) && /var ARC_SEG = /.test(coreSrc));
}

console.log('\n== every knob is really consumed, not a dummy ==');
{
  const bodyStart = appSrc.indexOf('  function applySettings() {');
  const bodyEnd = braceEnd(appSrc, bodyStart);
  const applyBody = appSrc.slice(bodyStart, bodyEnd);
  const consumer = {
    bakeJoinTol: 'BAKE_JOIN_TOL', artTol: 'ART_TOL_MM', offsetMiter: 'OFFSET_MITER',
    offsetArcTol: 'OFFSET_ARC_TOL', offsetJoin: 'OFFSET_JOIN', offsetTol: 'OFFSET_TOL',
    splineSeg: 'SPLINE_SEG', arcSeg: 'ARC_SEG', circleChord: 'CIRCLE_CHORD',
    textTol: 'TEXT_TOL_MM', textTracePx: 'TEXT_TRACE_PX', pasteMaxMm: 'ART_MAX_MM'
  };
  // SPLINE_SEG / ARC_SEG are consumed by core.js (splineSamples / sampleArc),
  // so their use-count is read from there instead of app.js.
  const inCore = new Set(['SPLINE_SEG', 'ARC_SEG']);
  for (const key of Object.keys(consumer)) {
    const name = consumer[key];
    // wherever the constant is used outside the declaration and applySettings()
    const code = appSrc.slice(0, appSrc.indexOf('  function applySettings() {')) +
      appSrc.slice(bodyEnd);
    const hay = inCore.has(name) ? coreSrc : code;
    const uses = hay.split(new RegExp('\\b' + name + '\\b')).length - 1;
    check(key + ' is read by ' + name + (inCore.has(name) ? ' (core.js)' : ' in the drawing code'),
      uses > 0, uses);
  }
  check('cncFlatten is pushed into cnc.tol', /cnc\.tol = settings\.cncFlatten/.test(applyBody));
  // every curved kind flattens at cnc.tol now (arcs and circles included), so
  // the check is on the flattener itself rather than the old arc-step helper
  check('and cnc.tol is what flattens curves',
    /cnc\.tol/.test(sliceApp('cncPolyline')) &&
    /cncFramedCurveShapes\(e, cnc\.tol/.test(sliceApp('cncCollectItems')) &&
    /cncArcSpan\(cnc\.tol/.test(sliceApp('cncPolyline')));
  // The two-way share: applySettings pushes the setting into cnc.tol, and
  // cncSaveSettings writes cnc.tol back into the setting (through clampSetting).
  check('the CNC window shares the value both ways',
    /cnc\.tol = settings\.cncFlatten/.test(appSrc) &&
    /settings\.cncFlatten = clampSetting\([^;]*cnc\.tol\);/.test(appSrc));
  check('the text trace cache is dropped when the raster size changes',
    /textTraceCache\.clear\(\)/.test(applyBody));
}

console.log('\n== the window cannot come up blank ==');
{
  check('the form falls back to the default for a missing value',
    /settings\[sp\.key\] != null \? settings\[sp\.key\] : sp\.def/.test(appSrc));
  check('an unread settings object is loaded on open',
    /Object\.keys\(settings\)\.length !== SETTINGS_SPEC\.length\) loadSettings/.test(appSrc));
  check('a failing apply cannot block the window', /apply failed/.test(appSrc));
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const boxStart = css.indexOf('/* Settings window */');
  const box = css.slice(boxStart, css.indexOf('.constraint-block', boxStart));
  check('the inputs use the real theme tokens',
    /background: var\(--input\)/.test(box) && /color: var\(--ink\)/.test(box));
  check('no invented token names in the settings styles',
    !/var\(--text\)|var\(--input-bg\)|var\(--panel-2\)/.test(box),
    (box.match(/var\(--[a-z0-9-]+\)/g) || []).filter((v, i, a) => a.indexOf(v) === i).join(' '));
}

console.log('\n== the window markup exists ==');
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  check('there is a Settings button', /id="btn-settings"/.test(html));
  check('there is a modal with a groups host', /id="settings-modal"/.test(html) && /id="settings-groups"/.test(html));
  check('apply / reset / close are all there',
    /id="settings-apply"/.test(html) && /id="settings-reset"/.test(html) && /id="settings-close"/.test(html));
  check('the window is wired in bindUI', /btn-settings/.test(appSrc) && /openSettingsModal/.test(appSrc));
  check('Escape closes it', /settings-modal[\s\S]{0,220}closeSettingsModal/.test(appSrc));
}

console.log('\n' + (fail ? (fail + ' FAILED, ' + pass + ' passed') : ('all ' + pass + ' checks passed')));
process.exit(fail ? 1 : 0);
