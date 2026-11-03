// Probe for the right-panel restructure + the new Edit-ribbon actions.
//
// Removed from the sidebar: Constrain, Closed loops, Named selections, and the
// Parts action buttons. The actions moved to the Edit ribbon and must still be
// reachable, and every lookup of a removed element must be guarded or the app
// throws at startup.
//
// Run: node testing/panel_restructure_probe.js
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
};

console.log('panels: removed from the sidebar');
for (const id of ['constraint-list', 'constraint-block', 'loop-list', 'loop-count',
  'nsel-list', 'nsel-name', 'nsel-save', 'btn-make-part', 'btn-mate']) {
  check('#' + id + ' is gone', !new RegExp('id="' + id + '"').test(html));
}
check('no Constrain panel heading', !/<h3>Constrain<\/h3>/.test(html));
check('no Closed loops panel heading', !/<h3>Closed loops/.test(html));
check('no Named selections panel heading', !/<h3>Named selections<\/h3>/.test(html));

console.log('parts: list only');
const parts = html.slice(html.indexOf('id="parts-list"') - 400, html.indexOf('id="parts-list"') + 40);
check('parts-list kept', /id="parts-list"/.test(html));
check('no action buttons next to the parts list',
  !/btn-make-part|btn-mate/.test(parts));

console.log('edit ribbon: new actions');
const edit = html.slice(html.indexOf('data-rpage="edit"'), html.indexOf('data-rpage="boolean"'));
for (const id of ['rb-clean', 'rb-group', 'rb-ungroup', 'rb-make-part', 'rb-mate', 'btn-connected']) {
  check('#' + id + ' lives in the Edit ribbon', new RegExp('id="' + id + '"').test(edit));
}
check('clean-up calls cmdCleanSelection', /qbClick\('rb-clean', \(\) => cmdCleanSelection\(\)\)/.test(app));
check('group wired', /qbClick\('rb-group', \(\) => cmdGroupSelection\(\)\)/.test(app));
check('ungroup wired', /qbClick\('rb-ungroup', \(\) => cmdUngroupSelection\(\)\)/.test(app));
check('make part wired', /qbClick\('rb-make-part', \(\) => cmdMakePart\(\)\)/.test(app));
check('mate wired', /qbClick\('rb-mate', \(\) => startMateJob\(\)\)/.test(app));

console.log('edit ribbon: action order');
{
  const order = ['rb-group', 'rb-ungroup', 'btn-connected', 'rb-clean', 'rb-make-part', 'rb-mate'];
  const pos = order.map(id => edit.indexOf('id="' + id + '"'));
  check('all six actions present', pos.every(p => p >= 0));
  check('order is Group, Ungroup, Connected, Clean up | Make part, Mate',
    pos.every((p, i) => i === 0 || p > pos[i - 1]), JSON.stringify(pos));
  // The Edit page has four rb-panels: transform/offset, flip/rotate, then the
  // two new action groups. Clean up closes the first new group; make-part/mate
  // form the second.
  const panels = edit.split('<div class="rb-panel">').slice(1);
  check('four action panels in the Edit ribbon', panels.length === 4, JSON.stringify(panels.length));
  const first = panels[2] || '', second = panels[3] || '';
  check('first new panel: Group, Ungroup, Connected, Clean up',
    ['rb-group', 'rb-ungroup', 'btn-connected', 'rb-clean'].every(id => first.includes('id="' + id + '"')) &&
    !first.includes('id="rb-mate"'));
  check('second new panel: Make part, Mate',
    second.includes('id="rb-make-part"') && second.includes('id="rb-mate"') &&
    !second.includes('id="rb-group"'));
}

console.log('clean-up works with nothing selected');
check('cmdCleanSelection falls back to selectLeftovers when empty',
  /function cmdCleanSelection\(\) \{\s*if \(!ui\.selection\.length\) \{\s*selectLeftovers\(\)/.test(app));
check('selectLeftovers finds dead constraints',
  /function selectLeftovers\(\)[\s\S]{0,600}constraintRefsValid/.test(app));

console.log('no unguarded lookup of a removed element');
const removed = ['constraint-list', 'loop-list', 'nsel-name', 'nsel-save'];
for (const id of removed) {
  const re = new RegExp("document\\.getElementById\\('" + id + "'\\)\\.", 'g');
  check('no direct .access on #' + id, !re.test(app));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
