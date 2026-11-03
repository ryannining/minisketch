// Probe for the Tools-panel contract (tools/registry.js + tools/*.js vs app.js).
//
// The generators live outside app.js's IIFE, so everything they touch has to be
// handed to them through toolApi(). That surface has one trap: a `let` that
// app.js REPLACES (state is swapped by undo, New, load, demo) must be exposed
// through a getter. A copied reference goes stale as soon as a document loads,
// and every tool then writes its gen / name into a dead object — the group is
// still created, but it can neither be named nor re-opened.
//
// Run: node testing/tools_probe.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
// Every file in tools/ that registers itself is checked, so a new tool cannot
// arrive without honouring the contract.
const TOOLS = fs.readdirSync(path.join(__dirname, '..', 'tools'))
  .filter(f => f.endsWith('.js'))
  .map(f => f.slice(0, -3))
  .filter(n => n !== 'registry' && n !== 'clipper' && n !== 'Potrace')
  // the tool files call NS.register(...) where NS = window.MiniSketchTools
  .filter(n => /\bNS\.register\s*\(|MiniSketchTools\.register\s*\(/.test(
    fs.readFileSync(path.join(__dirname, '..', 'tools', n + '.js'), 'utf8')))
  .sort();
const toolSrc = {};
for (const t of TOOLS) {
  toolSrc[t] = fs.readFileSync(path.join(root, 'tools', t + '.js'), 'utf8');
}
const registrySrc = fs.readFileSync(path.join(root, 'tools', 'registry.js'), 'utf8');

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

// The file name and the registered id do not have to match (hinge.js registers
// 'hinged_box'), so the id is read out of the source.
const registeredId = (src) => {
  const m = src.match(/id:\s*'([^']+)'/);
  return m ? m[1] : null;
};

function braceEnd(s, from) {
  let d = 0;
  for (let j = s.indexOf('{', from); j < s.length; j++) {
    if (s[j] === '{') d++;
    else if (s[j] === '}') { d--; if (!d) return j + 1; }
  }
  throw new Error('unbalanced');
}

// ---- the exposed surface ------------------------------------------------
const apiStart = appSrc.indexOf('function toolApi()');
if (apiStart < 0) {
  console.log('  FAIL  app.js has no toolApi()');
  process.exit(1);
}
const apiEnd = braceEnd(appSrc, apiStart);
const apiBody = appSrc.slice(apiStart, apiEnd);

// split the returned object literal into top-level entries
const objStart = apiBody.indexOf('return {') + 'return {'.length;
const objEnd = apiBody.lastIndexOf('}');
// drop // comments first: their prose contains commas and colons
const objBody = apiBody.slice(objStart, objEnd).replace(/\/\/[^\n]*/g, '');
const entries = [];
{
  let depth = 0, cur = '';
  for (const ch of objBody) {
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { entries.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) entries.push(cur);
}
const exposed = {};
for (const raw of entries) {
  const e = raw.trim();
  if (!e) continue;
  if (e.startsWith('get ')) {
    exposed[e.slice(4).split(/[\s(:]/)[0]] = 'getter';
  } else if (e.includes(':')) {
    exposed[e.split(':')[0].trim()] = 'value';
  } else {
    exposed[e.split(/[\s,]/)[0]] = 'value';
  }
}

console.log('\n== the surface ==');
check('toolApi exposes something', Object.keys(exposed).length > 10, Object.keys(exposed).length);

// A value entry whose name app.js declares with `let` and assigns again later
// is a stale-reference bug waiting to happen.
const reassigned = [];
for (const [name, kind] of Object.entries(exposed)) {
  if (kind === 'getter' || name.endsWith('()')) continue;
  if (!new RegExp('\\blet\\s+' + name + '\\b').test(appSrc)) continue;
  const assigns = (appSrc.match(new RegExp('\\b' + name + '\\s*=\\s*[^=]', 'g')) || []).length;
  if (assigns > 1) reassigned.push(name + ' (' + assigns + ' assignments)');
}
check('no reassigned `let` is exposed as a plain value', reassigned.length === 0, reassigned.join(', '));
check('state is exposed through a getter', exposed.state === 'getter', exposed.state);

// ---- every api.* a tool uses must exist --------------------------------
console.log('\n== tools only touch the surface ==');
for (const t of TOOLS) {
  const used = new Set((toolSrc[t].match(/\bapi\.([A-Za-z_][A-Za-z0-9_]*)/g) || [])
    .map(s => s.slice(4)));
  const missing = [...used].filter(n => !(n in exposed));
  check(`${t}: every api.* member exists`, missing.length === 0, missing.join(', '));
  // the tool must go through api for state, not reach for a global
  check(`${t}: does not reference a bare \`state\` global`, !/[^.\w]state\./.test(toolSrc[t]));
}

// ---- dialogs are self-contained ---------------------------------------
console.log('\n== dialogs own their ids ==');
for (const t of TOOLS) {
  const src = toolSrc[t];
  const used = new Set();
  for (const m of src.matchAll(/getElementById\('([^']+)'\)/g)) used.add(m[1]);
  for (const m of src.matchAll(/\bel\('([^']+)'\)/g)) used.add(m[1]);
  const markup = new Set([...src.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  const missing = [...used].filter(i => !markup.has(i));
  check(`${t}: modal markup carries every id the code reads`, missing.length === 0, missing.join(', '));
  check(`${t}: registers an id`, !!registeredId(src), 'no id: in the register call');
}

// ---- registry wiring ---------------------------------------------------
console.log('\n== registry ==');
check('registry mounts into a host row', /host\.appendChild/.test(registrySrc));
check('registry wires Create to apply', /btn\.primary[\s\S]{0,80}addEventListener\('click'/.test(registrySrc));
check('registry wires Cancel to close', /-cancel[\s\S]{0,80}addEventListener\('click'/.test(registrySrc));
check('registry reopens by gen.kind', /NS\.reopen\s*=\s*\(gen\)[\s\S]{0,200}t\.id === gen\.kind/.test(registrySrc));
check('app.js hands double clicks to the registry',
  /function openGeneratorDialog\(gen\)[\s\S]{0,200}MiniSketchTools\.reopen\(gen\)/.test(appSrc));
check('app.js still calls it on a double clicked art object',
  /ent\.gen && ent\.type === 'art'[\s\S]{0,200}openGeneratorDialog\(ent\.gen\)/.test(appSrc));
check('index.html loads the registry before the tools and app.js', (() => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const at = (s) => html.indexOf(s);
  return at('tools/registry.js') > 0 &&
    at('tools/registry.js') < at('tools/' + TOOLS[0] + '.js') &&
    at('tools/' + TOOLS[TOOLS.length - 1] + '.js') < at('src="app.js"');
})());
check('index.html gives the registry a mount point', /id="tools-row"/.test(
  fs.readFileSync(path.join(root, 'index.html'), 'utf8')));

// ---- each tool ends with a named group carrying its params -------------
console.log('\n== every generator leaves a re-editable group ==');
for (const t of TOOLS) {
  const src = toolSrc[t];
  check(`${t}: groups the result`, /cmdGroupSelection\(\{\s*noHistory:\s*true\s*\}\)/.test(src));
  const toolId = registeredId(src) || t;
  check(`${t}: stores gen.kind = ${toolId}`, new RegExp("kind:\\s*'" + toolId + "'").test(src));
  check(`${t}: names the group`, /wrap\.name\s*=/.test(src));
  check(`${t}: pushes history exactly once`, (src.match(/api\.pushHistory\(\)/g) || []).length === 1);
}

console.log('\n' + (fail ? fail + ' FAILED, ' : 'all ') + pass + ' checks passed');
process.exit(fail ? 1 : 0);
