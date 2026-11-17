// Probe: the L/T/W/H strip anchors at the VISUAL top-left.
// World Y runs down (canvas), so top = minY. Pins:
//   - H 100 -> 200 scales about (minX, minY): the box grows DOWNWARD,
//     the top edge stays put (the old pivot (minX, maxY) grew it upward)
//   - W grows rightward about the same corner
//   - T shows/edits minY, L edits minX
//   - the aspect lock still scales both axes about the top-left
//
// Run: node testing/tf_strip_pivot_probe.js
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

// a 100x100 box at world (10, 20)-(110, 120); visual top-left = (10, 20)
const B = { minX: 10, minY: 20, maxX: 110, maxY: 120 };
const calls = { move: [], scale: [], toasts: [] };
let lockChecked = false;
const deps = {
  xfBlock: () => false,
  selectionBounds: () => B,
  selectionPointIds: () => new Set(),
  pushHistory: () => {},
  moveSelection: (dx, dy) => calls.move.push([dx, dy]),
  scaleSelection: (sx, sy, ox, oy) => calls.scale.push([sx, sy, ox, oy]),
  invalidateLoops: () => {},
  requestSolve: () => {},
  commit: () => {},
  updateTransformPanel: () => {},
  updateHistoryButtons: () => {},
  toast: (m) => calls.toasts.push(m),
  history: { pop: () => {} },
  document: { getElementById: (id) => (id === 'tf-lock' ? { checked: lockChecked } : null) },
  applyEntityNumber: () => {}
};
const body = [slice('evalFormula'), slice('applyTransformField')].join('\n');
const apply = new Function(
  ...Object.keys(deps),
  `${body}\nreturn applyTransformField;`
)(...Object.values(deps));

const reset = () => { calls.move.length = 0; calls.scale.length = 0; calls.toasts.length = 0; };

reset();
apply('height', '200');
check('H 100->200: factor 2 about visual top-left (10, 20)',
  calls.scale.length === 1 && calls.scale[0][0] === 1 && calls.scale[0][1] === 2 &&
  calls.scale[0][2] === 10 && calls.scale[0][3] === 20, JSON.stringify(calls.scale));

reset();
apply('width', '200');
check('W 100->200: factor 2 about the same corner',
  calls.scale.length === 1 && calls.scale[0][0] === 2 && calls.scale[0][1] === 1 &&
  calls.scale[0][2] === 10 && calls.scale[0][3] === 20, JSON.stringify(calls.scale));

reset();
lockChecked = true;
apply('height', '200');
check('locked H: both axes scale about top-left',
  calls.scale[0][0] === 2 && calls.scale[0][1] === 2 && calls.scale[0][2] === 10 && calls.scale[0][3] === 20,
  JSON.stringify(calls.scale));
lockChecked = false;

reset();
apply('top', '50');
check('T edits the visual top edge (minY 20 -> 50 = move +30)',
  calls.move.length === 1 && calls.move[0][0] === 0 && calls.move[0][1] === 30, JSON.stringify(calls.move));

reset();
apply('left', '-5');
check('L edits minX (10 -> -5 = move -15)',
  calls.move.length === 1 && calls.move[0][0] === -15 && calls.move[0][1] === 0, JSON.stringify(calls.move));

reset();
apply('height', '10-');
check('relative "10-" shrinks H about top-left (factor 0.9)',
  calls.scale[0][1] === 0.9 && calls.scale[0][3] === 20, JSON.stringify(calls.scale));

reset();
apply('height', '0');
check('H=0 rejected with a toast, no scale', calls.scale.length === 0 && calls.toasts.length === 1);

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);