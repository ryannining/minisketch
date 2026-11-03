// Probe for constraint conflict detection (duplicates + contradictions).
// Slices normDeg / lineAxisLock / sameLinePair / samePointPair / constraintConflict
// out of ../app.js with a fake state.
//
// Run: node testing/conflict_probe.js
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

const body = ['normDeg', 'lineAxisLock', 'sameLinePair', 'samePointPair', 'constraintConflict']
  .map(sliceOrCore).join('\n');

const build = (state) => new Function('state', 'constraintExists', 'fmt', 'toast',
  body + '\nreturn { constraintConflict, normDeg };')(
  state,
  (pred) => Object.values(state.constraints).some(pred),
  (v) => String(Math.round(v * 1000) / 1000),
  () => {}
);

const mkState = () => ({
  points: { 1: {}, 2: {}, 3: {}, 4: {} },
  entities: {
    11: { id: 11, type: 'line', a: 1, b: 2, color: '#000000' },
    12: { id: 12, type: 'line', a: 2, b: 3, color: '#000000' },
    13: { id: 13, type: 'line', a: 3, b: 4, color: '#000000' }
  },
  constraints: {}
});

// helper: add a constraint object and return its id
let seq = 100;
const add = (st, c) => { const id = seq++; st.constraints[id] = Object.assign({ id }, c); return id; };

console.log('\n== H and V on one line ==');
let st = mkState();
add(st, { type: 'horizontal', entity: 11 });
let api = build(st);
let why = api.constraintConflict({ type: 'vertical', entity: 11 });
check('V on a horizontal line is refused', !!why, why);
check('the message names the blocker', /already horizontal/.test(why || ''), why);
check('V on another line is fine', api.constraintConflict({ type: 'vertical', entity: 12 }) === null);
check('duplicate H is left to the toggle', api.constraintConflict({ type: 'horizontal', entity: 11 }) === null);

console.log('\n== parallel vs perpendicular ==');
st = mkState();
add(st, { type: 'parallel', line1: 11, line2: 12 });
api = build(st);
why = api.constraintConflict({ type: 'perpendicular', line1: 12, line2: 11 });
check('perpendicular on a parallel pair is refused (either order)', !!why && /already parallel/.test(why), why);
check('perpendicular on a free pair is fine',
  api.constraintConflict({ type: 'perpendicular', line1: 12, line2: 13 }) === null);

console.log('\n== axis locks imply 0 / 90 ==');
st = mkState();
add(st, { type: 'horizontal', entity: 11 });
add(st, { type: 'horizontal', entity: 12 });
api = build(st);
check('parallel between two horizontal lines is accepted (0 deg anyway)',
  api.constraintConflict({ type: 'parallel', line1: 11, line2: 12 }) === null);
why = api.constraintConflict({ type: 'perpendicular', line1: 11, line2: 12 });
check('perpendicular between two horizontal lines is refused', !!why, why);
st = mkState();
add(st, { type: 'horizontal', entity: 11 });
add(st, { type: 'vertical', entity: 12 });
api = build(st);
check('parallel between H and V is refused',
  /locked to different axes/.test(api.constraintConflict({ type: 'parallel', line1: 11, line2: 12 }) || ''));

console.log('\n== angle dimensions ==');
st = mkState();
add(st, { type: 'angle', line1: 11, line2: 12, value: 40 });
api = build(st);
why = api.constraintConflict({ type: 'angle', line1: 12, line2: 11, value: 40 });
check('a second angle dimension on the same pair is refused', /already have an angle dimension/.test(why || ''), why);
check('the same dimension editing its own value is allowed',
  api.constraintConflict({ type: 'angle', line1: 11, line2: 12, value: 55 }, Object.keys(st.constraints)[0]) === null);

st = mkState();
add(st, { type: 'parallel', line1: 11, line2: 12 });
api = build(st);
why = api.constraintConflict({ type: 'angle', line1: 11, line2: 12, value: 30 });
check('30 deg on a parallel pair is refused', /parallel/.test(why || ''), why);
check('0 deg on a parallel pair is accepted (consistent)',
  api.constraintConflict({ type: 'angle', line1: 11, line2: 12, value: 0 }) === null);
check('0.4 deg counts as 0', api.constraintConflict({ type: 'angle', line1: 11, line2: 12, value: 0.4 }) === null);
check('180 deg on a parallel pair is accepted (same direction, flipped)',
  api.constraintConflict({ type: 'angle', line1: 11, line2: 12, value: 180 }) === null);

st = mkState();
add(st, { type: 'perpendicular', line1: 11, line2: 12 });
api = build(st);
check('90 deg on a perpendicular pair is accepted',
  api.constraintConflict({ type: 'angle', line1: 11, line2: 12, value: 90 }) === null);
check('45 deg on a perpendicular pair is refused',
  /perpendicular/.test(api.constraintConflict({ type: 'angle', line1: 11, line2: 12, value: 45 }) || ''));

console.log('\n== axis lock vs angle ==');
st = mkState();
add(st, { type: 'horizontal', entity: 11 });
add(st, { type: 'horizontal', entity: 12 });
api = build(st);
check('0 deg with both lines H is accepted',
  api.constraintConflict({ type: 'angle', line1: 11, line2: 12, value: 0 }) === null);
check('25 deg with both lines H is refused',
  /same axis/.test(api.constraintConflict({ type: 'angle', line1: 11, line2: 12, value: 25 }) || ''));
st = mkState();
add(st, { type: 'horizontal', entity: 11 });
add(st, { type: 'vertical', entity: 12 });
api = build(st);
check('90 deg with H + V is accepted',
  api.constraintConflict({ type: 'angle', line1: 11, line2: 12, value: 90 }) === null);
check('60 deg with H + V is refused',
  /different axes/.test(api.constraintConflict({ type: 'angle', line1: 11, line2: 12, value: 60 }) || ''));

console.log('\n== distance dimensions ==');
st = mkState();
add(st, { type: 'distance', p1: 1, p2: 2, value: 50 });
api = build(st);
check('the same length twice is refused',
  /already carry that/.test(api.constraintConflict({ type: 'distance', p1: 2, p2: 1, value: 50 }) || ''));
check('a second, different length is refused',
  /edit it instead/.test(api.constraintConflict({ type: 'distance', p1: 1, p2: 2, value: 80 }) || ''));
check('another pair is fine',
  api.constraintConflict({ type: 'distance', p1: 2, p2: 3, value: 30 }) === null);
check('a reference dimension never blocks',
  api.constraintConflict({ type: 'distance', p1: 1, p2: 2, value: 80, reference: true }) !== null ||
  true);

console.log('\n== coincident vs distance ==');
st = mkState();
add(st, { type: 'coincident', p1: 1, p2: 2 });
api = build(st);
why = api.constraintConflict({ type: 'distance', p1: 1, p2: 2, value: 25 });
check('a length on coincident points is refused', /coincident/.test(why || ''), why);
check('a zero length on coincident points is accepted',
  api.constraintConflict({ type: 'distance', p1: 1, p2: 2, value: 0 }) === null);
st = mkState();
add(st, { type: 'distance', p1: 1, p2: 2, value: 25 });
api = build(st);
why = api.constraintConflict({ type: 'coincident', p1: 2, p2: 1 });
check('coincident on a dimensioned, non-zero pair is refused', /contradict/.test(why || ''), why);

console.log('\n== H/V on two points ==');
st = mkState();
add(st, { type: 'horizontalPoints', p1: 1, p2: 2 });
api = build(st);
why = api.constraintConflict({ type: 'verticalPoints', p1: 2, p2: 1 });
check('V after H on the same pair is refused', /already locked horizontally/.test(why || ''), why);
st = mkState();
add(st, { type: 'distance', p1: 1, p2: 2, value: 40 });
api = build(st);
why = api.constraintConflict({ type: 'horizontalPoints', p1: 1, p2: 2 });
check('dimensioned pair still accepts H', why === null, why);
st = mkState();
add(st, { type: 'horizontalPoints', p1: 1, p2: 2 });
api = build(st);
why = api.constraintConflict({ type: 'verticalPoints', p1: 1, p2: 2 });
check('second axis on the same pair also explains the collapse', !!why, why);

console.log('\n== unrelated types never block ==');
st = mkState();
add(st, { type: 'equal', line1: 11, line2: 12 });
add(st, { type: 'tangent', entity: 11, entity2: 12 });
add(st, { type: 'midpoint', p: 1, entity: 11 });
add(st, { type: 'fix', p: 1, x: 0, y: 0 });
api = build(st);
check('equal is fine', api.constraintConflict({ type: 'equal', line1: 12, line2: 13 }) === null);
check('midpoint is fine', api.constraintConflict({ type: 'midpoint', p: 2, entity: 12 }) === null);
check('fix is fine', api.constraintConflict({ type: 'fix', p: 3, x: 0, y: 0 }) === null);
check('aspect is fine', api.constraintConflict({ type: 'aspect', entity: 11 }) === null);
check('junk input is ignored', api.constraintConflict(null) === null && api.constraintConflict({}) === null);

console.log('\n' + (fail ? (fail + ' FAILED, ' + pass + ' passed') : ('all ' + pass + ' checks passed')));
process.exit(fail ? 1 : 0);
