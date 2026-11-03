// Probe: ONE flatten tolerance, two windows.
//
// The tolerance used to live in two records: Settings > CNC > Flatten tolerance
// (settings.cncFlatten) and the KaryaCNC window's own saved `tol`. Both wrote it,
// and cncLoadSettings() — called at init, when the KaryaCNC window opens and on
// every Alt+Q quick send — restored the record's older copy. So a change in the
// Settings panel was silently reverted and looked like it did nothing, while the
// value in the send window was the one that actually cut.
//
// Run: node testing/cnc_tol_probe.js
const fs = require('fs');
const path = require('path');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

function braceEnd(s, from) {
  let d = 0;
  for (let j = s.indexOf('{', from); j < s.length; j++) {
    if (s[j] === '{') d++;
    else if (s[j] === '}') { d--; if (!d) return j + 1; }
  }
  throw new Error('unbalanced');
}
const slice = (name) => {
  const start = appSrc.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('not found: ' + name);
  let i = appSrc.indexOf('(', start), depth = 0;
  for (; i < appSrc.length; i++) {
    if (appSrc[i] === '(') depth++;
    else if (appSrc[i] === ')') { depth--; if (!depth) break; }
  }
  return appSrc.slice(start, braceEnd(appSrc, i));
};

// ---- one world with a fake localStorage --------------------------------
function makeWorld(store) {
  const w = {
    store,                                   // key -> string
    settings: { cncFlatten: 0.05 },
    spec: { key: 'cncFlatten', def: 0.05, min: 0.005, max: 1, step: 0.005 },
    cnc: { host: '127.0.0.1', port: 8887, scope: 'selected', tol: 0.05, chain: true },
    savedSettingsCalls: 0,
    tolField: { value: '' }
  };
  w.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); }
  };
  w.document = {
    getElementById: (id) => (id === 'cnc-tol' ? w.tolField : null)
  };
  w.clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  w.settingSpec = (k) => (k === w.spec.key ? w.spec : null);
  w.clampSetting = (sp, v) => {
    if (!sp) return v;
    const n = +v;
    if (!isFinite(n)) return sp.def;
    return w.clamp(n, sp.min, sp.max);
  };
  w.saveSettings = () => { w.savedSettingsCalls++; };
  return w;
}

function build(w) {
  const body = [
    slice('cncLoadSettings'),
    slice('updateCncTolField'),
    slice('cncSaveSettings')
  ].join('\n');
  return new Function(
    'settings', 'cnc', 'localStorage', 'document', 'clamp',
    'settingSpec', 'clampSetting', 'saveSettings', 'CNC_KEY',
    body + '\nreturn { cncLoadSettings, cncSaveSettings, updateCncTolField };'
  )(
    w.settings, w.cnc, w.localStorage, w.document, w.clamp,
    w.settingSpec, w.clampSetting, w.saveSettings, 'minisketch.cnc.v2'
  );
}

console.log('\n== a fresh start uses the Settings value ==');
{
  const w = makeWorld({});
  const api = build(w);
  api.cncLoadSettings();
  check('cnc.tol follows settings.cncFlatten (0.05)', w.cnc.tol === 0.05, w.cnc.tol);
  check('the send window shows the same number', w.tolField.value === '0.05', w.tolField.value);
  check('no record was invented', !w.store['minisketch.cnc.v2']);

  w.settings.cncFlatten = 0.01;
  api.cncLoadSettings();
  check('changing the setting takes effect on the next load', w.cnc.tol === 0.01, w.cnc.tol);
}

console.log('\n== an old record cannot override the Settings panel ==');
{
  // what an older build left behind: its own copy of the tolerance
  const legacy = {
    'minisketch.cnc.v2': JSON.stringify({
      host: '10.0.0.5', port: 9999, scope: 'visible', tol: 0.6, chain: false
    })
  };
  const w = makeWorld(legacy);
  const api = build(w);
  api.cncLoadSettings();

  check('the legacy value is adopted once, not thrown away', w.cnc.tol === 0.6, w.cnc.tol);
  check('and it becomes the shared setting', w.settings.cncFlatten === 0.6, w.settings.cncFlatten);
  check('settings were persisted', w.savedSettingsCalls >= 1, w.savedSettingsCalls);
  const rec = JSON.parse(w.store['minisketch.cnc.v2']);
  check('the record is rewritten without its own tol', rec.tol === undefined,
    JSON.stringify(rec));
  check('host / port / scope / chain survive the migration',
    rec.host === '10.0.0.5' && rec.port === 9999 && rec.scope === 'visible' && rec.chain === false,
    JSON.stringify(rec));

  // the user fixes it in the Settings panel
  w.settings.cncFlatten = 0.02;
  api.cncLoadSettings();      // opening the KaryaCNC window, or Alt+Q
  check('a Settings change now survives opening the send window',
    w.cnc.tol === 0.02, w.cnc.tol);
  api.cncLoadSettings();
  api.cncLoadSettings();
  check('and many loads later it is still 0.02', w.cnc.tol === 0.02, w.cnc.tol);
}

console.log('\n== the send window writes the same single value ==');
{
  const w = makeWorld({});
  const api = build(w);
  api.cncLoadSettings();
  // the user types 0.015 in the send window
  w.cnc.tol = 0.015;
  api.cncSaveSettings();
  check('the Settings value follows the send window', w.settings.cncFlatten === 0.015,
    w.settings.cncFlatten);
  const rec = JSON.parse(w.store['minisketch.cnc.v2']);
  check('the record still keeps no tolerance of its own', rec.tol === undefined);
  check('host / port / scope survive', rec.host === '127.0.0.1' && rec.port === 8887,
    JSON.stringify(rec));

  // and a reload agrees
  api.cncLoadSettings();
  check('a reload keeps 0.015 (no ping-pong)', w.cnc.tol === 0.015, w.cnc.tol);
}

console.log('\n== the number is clamped by the setting spec ==');
{
  const w = makeWorld({});
  const api = build(w);
  api.cncLoadSettings();
  w.settings.cncFlatten = 99;       // nonsense from an edited record
  api.cncLoadSettings();
  check('too large is clamped to the spec maximum (1)', w.cnc.tol === 1, w.cnc.tol);
  w.settings.cncFlatten = 0.00001;
  api.cncLoadSettings();
  check('too small is clamped to the spec minimum (0.005)', w.cnc.tol === 0.005, w.cnc.tol);
}

console.log('\n== the wiring that makes it stick ==');
{
  check('applySettings pushes the setting into cnc.tol',
    /cnc\.tol = settings\.cncFlatten/.test(appSrc));
  check('applySettings refreshes the send window field',
    /cnc\.tol = settings\.cncFlatten;[\s\S]{0,600}?updateCncTolField\(\)/.test(appSrc));
  check('opening the send window re-reads the shared value',
    /function openCncModal\(\)[\s\S]{0,400}?cncLoadSettings\(\)/.test(appSrc));
  check('a quick send re-reads it too',
    /function cncSend\(opts\)[\s\S]{0,300}?if \(quick\) cncLoadSettings\(\)/.test(appSrc));
  check('the send window field writes back through cncSaveSettings',
    /function cncReadSettingsFromInputs\(\)[\s\S]{0,900}?cncSaveSettings\(\)/.test(appSrc));
  check('the record no longer stores a tolerance',
    !/tol: cnc\.tol/.test(appSrc));
  check('the Settings help says it is one shared number',
    /One number, shown in both this window and the KaryaCNC window/.test(appSrc));
}

console.log('\n' + (fail ? fail + ' FAILED, ' : 'all ') + pass + ' checks passed');
process.exit(fail ? 1 : 0);
