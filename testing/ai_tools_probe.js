// Probe for the AI chat contract (ai/tools.json + ai/chat.js + server/ai-bridge.js).
//
// Run: node testing/ai_tools_probe.js
// Checks, without a browser or an LLM key:
//  1. every tool in tools.json maps to a real toolApi()/executor op
//  2. the chat executor calls pushHistory exactly once per turn (undo = 1 step)
//  3. destructive ops need confirm() and use noHistory paths
//  4. coordinates are clamped, the bridge validates tools, and no API key
//     ever appears in frontend files
//  5. wiring: index.html order, sidebar panel, settings knob, mount call
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const chatSrc = fs.readFileSync(path.join(root, 'ai', 'chat.js'), 'utf8');
const toolsManifest = JSON.parse(fs.readFileSync(path.join(root, 'ai', 'tools.json'), 'utf8'));
const bridgeSrc = fs.readFileSync(path.join(root, 'server', 'ai-bridge.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

// executor `case` labels use the same snake_case names as tools.json
const toOp = (n) => n;

console.log('\n== tools.json maps to the executor ==');
const ops = new Set([...chatSrc.matchAll(/case '([a-z_]+)':/g)].map(m => m[1]));
for (const t of (toolsManifest.tools || [])) {
  const name = t.function && t.function.name;
  if (!name) { check('(unnamed tool)', false); continue; }
  check(name + ': executor has case', ops.has(toOp(name)), [...ops].join(',').slice(0, 120));
  const schema = (t.function.parameters || {}).properties || {};
  check(name + ': has JSON schema', Object.keys(schema).length > 0 || name.startsWith('get_') || name.startsWith('describe_') ||
    ['delete_selection', 'clear_selection', 'ungroup'].includes(name));
  const hasDesc = !!(t.function.description && t.function.description.length > 10);
  check(name + ': has description', hasDesc);
}

console.log('\n== executor matches toolApi ==');
const apiStart = appSrc.indexOf('function toolApi()');
check('toolApi exists', apiStart >= 0);
const apiBody = appSrc.slice(apiStart, appSrc.indexOf('\n  }', apiStart) + 4);
// op -> toolApi surface it must call (spot contract, not exhaustive)
const needs = {
  addPanel: 'addPanelEntity', addPolyline: 'addPolylineEntity',
  addLine: 'addLine', addCircle: 'addCircle', addArc: 'addArc',
  addSpline: 'addSpline', addNote: 'addNote', addConstraint: 'addConstraint',
  moveSelection: 'moveSelection', scaleSelection: 'scaleSelection',
  removeEntity: 'removeEntity', deleteSelection: 'deleteSelection',
  groupSelection: 'cmdGroupSelection', getBounds: 'contentBounds', getLoops: 'getLoops'
};
for (const [op, fn] of Object.entries(needs)) {
  check('executor ' + op + ' -> api.' + fn,
    chatSrc.includes('api.' + fn), fn);
}

console.log('\n== one turn = one undo ==');
check('applyOps pushes history once per turn',
  (chatSrc.match(/api\.pushHistory\(\)/g) || []).length === 1,
  (chatSrc.match(/api\.pushHistory\(\)/g) || []).length + ' pushHistory calls');
check('delete_selection uses the noHistory path',
  /deleteSelection\(\{\s*noHistory:\s*true/.test(chatSrc));
check('add_constraint defers history+solves to the turn',
  /addConstraint\(c,\s*\{\s*history:\s*false,\s*solve:\s*false/.test(chatSrc));
check('generator turn runs solo', /call_generator[\s\S]{0,300}must run alone/.test(chatSrc));

console.log('\n== destructive ops ask first ==');
check('confirm() guards delete', /window\.confirm\([\s\S]{0,120}[Dd]elete/.test(chatSrc));

console.log('\n== clamping + bridge validation ==');
check('executor clamps coordinates', /-10000.*10000/.test(chatSrc));
check('bridge clamps coordinates', /-10000.*10000/.test(bridgeSrc));
check('bridge allow-lists tool names', /KNOWN\.has|KNOWN\.add|new Set/.test(bridgeSrc));
check('bridge caps ops per turn', /MAX_OPS/.test(bridgeSrc));
check('bridge reads key from env, not the request',
  /process\.env\.OPENAI_API_KEY/.test(bridgeSrc) && !/req.*[Aa]pi.?[Kk]ey/.test(bridgeSrc));

console.log('\n== no secrets in the frontend ==');
for (const [f, src] of [['app.js', appSrc], ['ai/chat.js', chatSrc], ['index.html', html]]) {
  check(f + ': no API key literal', !/OPENAI_API_KEY|sk-ant-|sk-[A-Za-z0-9]{8}/.test(src));
}

console.log('\n== wiring ==');
check('index.html loads ai/chat.js before app.js',
  html.indexOf('ai/chat.js') > 0 && html.indexOf('ai/chat.js') < html.indexOf('src="app.js"'));
check('sidebar has the chat panel', /id="chat-panel"/.test(html) && /id="chat-log"/.test(html) &&
  /id="chat-input"/.test(html) && /id="chat-send"/.test(html));
check('settings has aiBridgeUrl', /aiBridgeUrl/.test(appSrc));
check('init mounts the chat', /MiniSketchAI.*mount\(toolApi\(\)\)/.test(appSrc));
check('tools.json names known generators only', (() => {
  const gen = (toolsManifest.tools || []).find(t => t.function && t.function.name === 'call_generator');
  const kinds = ((gen && gen.function.parameters.properties.kind) || {}).enum || [];
  const have = ['box', 'slot', 'gear', 'wall', 'hinge', 'slidetop', 'pulltop'];
  return kinds.length > 0 && kinds.every(k => have.includes(k));
})());

console.log('\n' + (fail ? fail + ' FAILED, ' : 'all ') + pass + ' checks passed');
process.exit(fail ? 1 : 0);
