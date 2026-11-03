// Probe for badge placement (anti overlap).
// Slices badgeSlot() out of ../app.js and feeds it a fake ui.badgeRects.
//
// Run: node testing/badge_probe.js
const fs = require('fs');
const path = require('path');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
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

const ui = { badgeRects: [] };
const badgeSlot = new Function('ui', sliceApp('badgeSlot') + '\nreturn badgeSlot;')(ui);

const overlap = (a, b, w, h) => {
  const ax = a.x - w / 2, ay = a.y - h / 2;
  const bx = b.x - w / 2, by = b.y - h / 2;
  return ax < bx + w && ax + w > bx && ay < by + h && ay + h > by;
};

console.log('\n== single badge keeps its spot ==');
let a = badgeSlot(100, 100, 16, 14);
check('first badge sits exactly where asked', a.x === 100 && a.y === 100, JSON.stringify(a));

console.log('\n== two badges on the same anchor ==');
ui.badgeRects = [];
a = badgeSlot(100, 100, 16, 14);
const b = badgeSlot(100, 100, 16, 14);
check('second badge is moved', !(a.x === b.x && a.y === b.y), JSON.stringify([a, b]));
check('and it does not overlap the first', !overlap(a, b, 16, 14), JSON.stringify([a, b]));

console.log('\n== five badges on one point (H + V + parallel + perp + equal) ==');
ui.badgeRects = [];
const got = [];
for (let i = 0; i < 5; i++) got.push(badgeSlot(300, 300, 18, 14));
let clashes = 0;
for (let i = 0; i < got.length; i++) {
  for (let j = i + 1; j < got.length; j++) {
    if (overlap(got[i], got[j], 18, 14)) clashes++;
  }
}
console.log('  positions:', JSON.stringify(got));
check('all five are placed', got.length === 5);
check('no pair overlaps', clashes === 0, clashes + ' overlapping pairs');

console.log('\n== wide badge next to a narrow one ==');
ui.badgeRects = [];
const wide = badgeSlot(500, 200, 30, 14);
const narrow = badgeSlot(500, 200, 12, 14);
check('wide + narrow do not overlap', !overlap(wide, narrow, 30, 14) || !overlap(wide, narrow, 12, 14),
  JSON.stringify([wide, narrow]));

console.log('\n== crowded: 12 badges on the same spot ==');
ui.badgeRects = [];
const many = [];
for (let i = 0; i < 12; i++) many.push(badgeSlot(700, 400, 14, 14));
let bad = 0;
for (let i = 0; i < many.length; i++) {
  for (let j = i + 1; j < many.length; j++) {
    if (overlap(many[i], many[j], 14, 14)) bad++;
  }
}
check('still no overlap (falls back gracefully)', bad === 0, bad + ' overlapping pairs');

console.log('\n' + (fail ? (fail + ' FAILED, ' + pass + ' passed') : ('all ' + pass + ' checks passed')));
process.exit(fail ? 1 : 0);
