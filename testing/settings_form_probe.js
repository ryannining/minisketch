// Does the Settings window come up filled with the defaults?
// A tiny DOM stub runs buildSettingsForm() + fillSettingsForm() for real.
//
// Run: node testing/settings_form_probe.js
const fs = require('fs');
const path = require('path');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
// pure helpers moved to core.js; fall back to it when app.js no longer
// defines the function (keeps the probe working across that refactor)
const Core = require(path.join(__dirname, '..', 'core.js'));
const sliceOrCore = (name) => {
  try { return sliceApp(name); } catch (err) {
    if (typeof Core[name] === 'function') return Core[name].toString();
    throw err;
  }
};

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

// ---- the smallest DOM that the form builder touches ----------------------
const byId = {};
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.dataset = {};
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.type = '';
    this._id = '';
    this.attrs = {};
    this.listeners = {};
    this.open = false;
  }
  set id(v) { this._id = String(v); byId[this._id] = this; }
  get id() { return this._id; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  dispatchEvent(ev) { for (const fn of (this.listeners[ev.type] || [])) fn(ev); return true; }
  querySelectorAll(sel) {
    // enough for the form builder: details.settings-group and .settings-row
    const out = [];
    const walk = (el) => {
      for (const ch of el.children) {
        if (sel === 'details.settings-group' && ch.tagName === 'DETAILS') out.push(ch);
        else if (sel === '.settings-row' && String(ch.className || '').split(' ').includes('settings-row')) out.push(ch);
        walk(ch);
      }
    };
    walk(this);
    return out;
  }
  set innerHTML(v) { if (!v) this.children = []; }
  get innerHTML() { return ''; }
}
// classList backed by className so toggle/add/remove work in the stub
Object.defineProperty(El.prototype, 'classList', {
  get() {
    const el = this;
    const list = () => String(el.className || '').split(' ').filter(Boolean);
    const write = (a) => { el.className = a.join(' '); };
    return {
      add(...cs) { const a = list(); for (const c of cs) if (!a.includes(c)) a.push(c); write(a); },
      remove(...cs) { write(list().filter(c => !cs.includes(c))); },
      toggle(c, force) {
        const a = list(); const has = a.includes(c);
        const on = force === undefined ? !has : !!force;
        if (on && !has) a.push(c);
        if (!on && has) a.splice(a.indexOf(c), 1);
        write(a);
        return on;
      },
      contains(c) { return list().includes(c); }
    };
  }
});
const document = {
  createElement: (tag) => new El(tag),
  getElementById: (id) => byId[id] || null,
  // scans every element created through this stub (the form is built here,
  // so a global walk finds all linked buttons)
  querySelectorAll: (sel) => {
    const out = [];
    const walk = (el) => {
      for (const ch of Object.values(byId)) {
        if (ch.__seen) continue;
        ch.__seen = true;
        if (sel === '.settings-linked-btn' && String(ch.className || '').split(' ').includes('settings-linked-btn')) out.push(ch);
        walk(ch);
      }
    };
    walk();
    for (const ch of Object.values(byId)) delete ch.__seen;
    return out;
  },
  querySelector: (sel) => document.querySelectorAll(sel)[0] || null
};

const specSrc = appSrc.slice(appSrc.indexOf('  const SETTINGS_SPEC = ['), appSrc.indexOf('  const settings = {};'));
const api = new Function('document', 'localStorage', 'applySettings', 'invalidateLoops', 'render', 'toast',
  specSrc + '\nconst settings = {};\n' +
  ['settingsDefaults', 'settingSpec', 'clampSetting', 'loadSettings', 'saveSettings',
    'buildSettingsForm', 'bindSettingsTips', 'bindSettingsSearch', 'menuLinkedValue',
    'refreshLinkedSettings', 'flashMenuLinked', 'fillSettingsForm', 'applySettingsForm', 'resetSettingsForm',
    'openSettingsModal', 'closeSettingsModal'].map(sliceApp).join('\n') +
  '\nreturn { SETTINGS_SPEC, settings, settingsDefaults, loadSettings, buildSettingsForm, fillSettingsForm, applySettingsForm, resetSettingsForm, saveSettings, clampSetting, settingSpec };'
)(
  document,
  { getItem: () => null, setItem: () => {} },
  () => {},
  () => {},
  () => {},
  () => {}
);

// the host the form is appended to
const host = document.createElement('div');
host.id = 'settings-groups';

console.log('\n== the window is filled on open ==');
api.loadSettings();
api.buildSettingsForm();
api.fillSettingsForm();
{
  const defaults = api.settingsDefaults();
  // hidden specs (autoDimension, autoSolve) live on the Tool menu, not in the
  // Settings form, so they have no input by design
  const visible = api.SETTINGS_SPEC.filter(sp => !sp.hidden);
  let filled = 0, blank = [];
  for (const sp of visible) {
    const el = document.getElementById('set-' + sp.key);
    if (!el) { blank.push(sp.key + ' (missing input)'); continue; }
    // text fields (aiBridgeUrl) are legitimately empty by default, and so is
    // the masked key field (aiApiKey): an empty key is the default
    if ((el.value === '' || el.value == null) && !sp.text && !sp.password) { blank.push(sp.key); continue; }
    filled++;
  }
  check('every field has a value', blank.length === 0, blank.join(', '));
  check('all ' + visible.length + ' fields are present', filled === visible.length, filled);
  check('the values are the defaults', visible.every(sp =>
    String(document.getElementById('set-' + sp.key).value) === String(defaults[sp.key])),
    visible.map(sp => sp.key + '=' + document.getElementById('set-' + sp.key).value).join(' '));
  // noteColor is a text field (a colour literal), the key is masked,
  // everything else numeric
  check('numbers are number inputs', visible.filter(sp => !sp.choices && !sp.text && !sp.password).every(sp =>
    document.getElementById('set-' + sp.key).type === 'number'));
  check('a secret is a masked input', visible.filter(sp => sp.password).every(sp =>
    document.getElementById('set-' + sp.key).type === 'password'));
  check('a choice knob is a select with its options', (() => {
    const el = document.getElementById('set-offsetJoin');
    return el.tagName === 'SELECT' && el.children.length === 3 &&
      el.children.map(o => o.value).join(',') === 'sharp,round,square';
  })());
  check('the form is grouped into sections',
    host.children.length >= 4 && host.children.every(sec => sec.className === 'settings-group'),
    host.children.length);
}

console.log('\n== editing and applying ==');
{
  // the user types a new value, then presses Apply
  document.getElementById('set-artTol').value = '0.24';
  document.getElementById('set-offsetJoin').value = 'round';
  document.getElementById('set-splineSeg').value = '';
  api.applySettingsForm();
  check('a typed number is stored', api.settings.artTol === 0.24, api.settings.artTol);
  check('a chosen option is stored', api.settings.offsetJoin === 'round', api.settings.offsetJoin);
  check('an emptied field goes back to its default',
    api.settings.splineSeg === api.settingSpec('splineSeg').def, api.settings.splineSeg);
  check('the field shows the value again',
    document.getElementById('set-splineSeg').value === String(api.settingSpec('splineSeg').def),
    document.getElementById('set-splineSeg').value);

  document.getElementById('set-artTol').value = '99';
  api.applySettingsForm();
  check('an out-of-range entry is clamped and shown clamped',
    api.settings.artTol === api.settingSpec('artTol').max &&
    document.getElementById('set-artTol').value === String(api.settingSpec('artTol').max),
    document.getElementById('set-artTol').value);

  api.resetSettingsForm();
  check('Reset defaults restores every field', api.SETTINGS_SPEC.filter(sp => !sp.hidden).every(sp =>
    document.getElementById('set-' + sp.key).value === String(api.settingSpec(sp.key).def)),
    api.SETTINGS_SPEC.filter(sp => !sp.hidden).map(sp => sp.key + '=' + document.getElementById('set-' + sp.key).value).join(' '));
}

console.log('\n== opening twice does not duplicate the form ==');
{
  const sections = host.children.length;
  api.buildSettingsForm();
  api.fillSettingsForm();
  check('the builder is idempotent', host.children.length === sections, host.children.length);
  check('values survive a reopen', api.SETTINGS_SPEC.filter(sp => !sp.hidden).every(sp =>
    document.getElementById('set-' + sp.key).value === String(api.settings[sp.key])));
}

console.log('\n' + (fail ? (fail + ' FAILED, ' + pass + ' passed') : ('all ' + pass + ' checks passed')));
process.exit(fail ? 1 : 0);
