// Probe for object names (Ctrl+N) and for the non-destructive Ctrl+G.
//
// Run: node testing/naming_probe.js
const fs = require('fs');
const path = require('path');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
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

// A tiny harness: names are edited through prompt(), everything else is recorded.
function harness(promptAnswer) {
  const log = { history: 0, commits: 0, toasts: [], info: 0, prompts: [] };
  const fixture = {
    points: { 1: { x: 0, y: 0 }, 2: { x: 10, y: 0 }, 3: { x: 0, y: 10 } },
    entities: {
      1: { id: 1, type: 'line', a: 1, b: 2, color: '#000000', layer: 1 },
      2: { id: 2, type: 'line', a: 2, b: 3, color: '#000000', layer: 1 },
      3: { id: 3, type: 'circle', c: 1, r: 5, color: '#0000ff', layer: 1 }
    },
    constraints: {}
  };
  const picked = [fixture.entities[1], fixture.entities[2]];
  const api = new Function(
    'state', 'ui', 'selection', 'xfBlock', 'selectedEntities', 'pushHistory', 'commit',
    'updateSelectionInfo', 'toast', 'prompt',
    sliceApp('cmdNameSelection') + '\nreturn cmdNameSelection;'
  )(
    fixture,
    { activeLayer: 1 },
    [],
    () => false,
    () => picked,
    () => { log.history++; },
    () => { log.commits++; },
    () => { log.info++; },
    (m) => { log.toasts.push(String(m)); },
    (msg, def) => { log.prompts.push({ msg, def }); return typeof promptAnswer === 'function' ? promptAnswer(msg, def) : promptAnswer; }
  );
  return { api, fixture, picked, log };
}

console.log('\n== naming one object ==');
{
  const { api, fixture, picked, log } = harness('Bracket');
  api();
  check('the name lands on the object', picked[0].name === 'Bracket', picked[0].name);
  check('an undo step is pushed', log.history === 1, log.history);
  check('the document is committed', log.commits === 1, log.commits);
  check('the panel is refreshed', log.info === 1, log.info);
  check('a toast reports the name', /Bracket/.test(log.toasts.join(' ')), log.toasts.join(' '));
  check('the prompt shows the old name (empty for a new object)', log.prompts[0].def === '', JSON.stringify(log.prompts[0]));
  check('the prompt mentions how many objects', /2 objects/.test(log.prompts[0].msg), log.prompts[0].msg);
  check('the unpicked object is not touched', fixture.entities[3].name === undefined, fixture.entities[3].name);
}

console.log('\n== naming rules ==');
{
  const { api, picked } = harness('  Bracket  ');
  api();
  check('the name is trimmed', picked[0].name === 'Bracket', JSON.stringify(picked[0].name));

  const long = harness('x'.repeat(200));
  long.api();
  check('a very long name is capped at 80 characters', long.picked[0].name.length === 80, long.picked[0].name.length);

  const cleared = harness('');
  cleared.picked.forEach(e => { e.name = 'Old'; });
  cleared.api();
  check('an empty answer clears the name', cleared.picked.every(e => e.name === undefined),
    JSON.stringify(cleared.picked.map(e => e.name)));
  check('clearing still commits and toasts', cleared.log.commits === 1 && /cleared/i.test(cleared.log.toasts.join(' ')),
    cleared.log.toasts.join(' '));

  const cancelled = harness(null);
  cancelled.api();
  check('Esc (null) changes nothing', cancelled.picked.every(e => e.name === undefined) &&
    cancelled.log.history === 0 && cancelled.log.commits === 0,
    JSON.stringify({ names: cancelled.picked.map(e => e.name), h: cancelled.log.history }));
}

console.log('\n== the prompt starts from the shared name ==');
{
  const { api, picked, log } = harness('Common');
  picked.forEach(e => { e.name = 'Common'; });
  api();
  check('a shared name is offered back', log.prompts[0].def === 'Common', log.prompts[0].def);

  const mixed = harness('New');
  mixed.picked[0].name = 'A';
  mixed.picked[1].name = 'B';
  mixed.api();
  check('different names are not offered', mixed.log.prompts[0].def === '', mixed.log.prompts[0].def);
  check('and both get the new one', mixed.picked.every(e => e.name === 'New'),
    JSON.stringify(mixed.picked.map(e => e.name)));
}

console.log('\n== nothing selected ==');
{
  const log = { toasts: [] };
  const api = new Function(
    'state', 'ui', 'xfBlock', 'selectedEntities', 'pushHistory', 'commit',
    'updateSelectionInfo', 'toast', 'prompt',
    sliceApp('cmdNameSelection') + '\nreturn cmdNameSelection;'
  )({ points: {}, entities: {}, constraints: {} }, { activeLayer: 1 }, () => false, () => [],
    () => {}, () => {}, () => {}, (m) => { log.toasts.push(String(m)); }, () => { throw new Error('prompt should not open'); });
  api();
  check('it says what to do instead of opening a prompt', /Ctrl\+N/.test(log.toasts.join(' ')), log.toasts.join(' '));
}

console.log('\n== Ctrl+G keeps the originals ==');
{
  // the function takes an opts argument now
  const start = appSrc.indexOf('function cmdGroupSelection(');
  const body = appSrc.slice(start, braceEnd(appSrc, start));
  check('it does not delete the picked entities', !/delete state\.entities\[eid\]/.test(body));
  check('it does not drop constraints', !/delete state\.constraints\[cid\]/.test(body));
  check('it does not solve the sketch', !/solveNow\(\)/.test(body));
  check('it still bakes the contours', /bakeContours\(/.test(body));
  check('it still makes one framed object', /addFramedObject\(/.test(body));
  check('it says the originals stay', /originals kept/.test(body));
  check('it selects the new object', /ui\.selection = \[\{ kind: 'entity', id \}\]/.test(body));
  check('one undo step', (body.match(/pushHistory\(\)/g) || []).length === 1);
  check('a shared name is inherited', /name: shared/.test(body));
}

console.log('\n== names survive the round trip ==');
{
  check('Ctrl+N is bound', /lower === 'n'[\s\S]{0,80}cmdNameSelection/.test(appSrc));
  check('there is a Name button in the Selection panel', /id="btn-name"/.test(htmlSrc));
  check('the button is wired', /btn-name[\s\S]{0,120}cmdNameSelection/.test(appSrc));
  check('the loader copies the name for every type', /names are cosmetic[\s\S]{0,260}entities\[key\]\.name = nm/.test(appSrc));
  check('the framed object can carry a name', /if \(o\.name\) state\.entities\[id\]\.name/.test(appSrc));
  check('the Selection panel shows the name', /sel-name/.test(appSrc) && /sel-name/.test(fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8')));
  check('the document writer keeps the whole state', /return JSON\.stringify\(\{[\s\S]{0,120}state/.test(appSrc));
  check('a copy deep-clones the entity, so the name travels', /entities: Array\.from\(eids\)[\s\S]{0,160}JSON\.parse\(JSON\.stringify\(state\.entities\[eid\]\)\)/.test(appSrc));
}

console.log('\n== offset really reads the settings ==');
{
  const confirmStart = appSrc.indexOf('function confirmOffset()');
  const confirmBody = appSrc.slice(confirmStart, braceEnd(appSrc, confirmStart));
  check('the committed offset uses the stored tolerance', /tol: OFFSET_TOL/.test(confirmBody));
  check('the committed offset uses the stored miter limit', /miterLimit: OFFSET_MITER/.test(confirmBody));
  check('the committed offset uses the stored corner style', /join: OFFSET_JOIN/.test(confirmBody));
  check('the committed offset uses the stored arc tolerance', /arcTol: OFFSET_ARC_TOL/.test(confirmBody));
  const previewStart = appSrc.indexOf('function refreshOffsetPreview()');
  const previewBody = appSrc.slice(previewStart, braceEnd(appSrc, previewStart));
  check('the preview uses the stored corner style too', /join: OFFSET_JOIN/.test(previewBody));
  check('no magic 0.05 / 4 left in the offset commands',
    !/miterLimit: 4[,}]/.test(confirmBody) && !/tol: 0\.05[,}]/.test(confirmBody));
}

console.log('\n' + (fail ? (fail + ' FAILED, ' + pass + ' passed') : ('all ' + pass + ' checks passed')));
process.exit(fail ? 1 : 0);
