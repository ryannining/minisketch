// Probe for "insert point on a line" (double-click, Shift = add a point only).
// Slices insertPointOnEntity() out of ../app.js and checks that a split keeps
// the original entity id (so H/V/parallel/perpendicular/tangent/angle
// constraints survive on the first half) and that Shift never splits.
//
// Run: node testing/split_probe.js
const fs = require('fs');
const path = require('path');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
// pure helpers moved to core.js; fall back to it when app.js no longer
// defines the function (keeps the probe working across that refactor)
const Core = require(path.join(__dirname, '..', 'core.js'));
const sliceOrCore = (name) => {
  // app.js keeps the app-level functions; pure math moved to core.js
  const fromApp = sliceApp(name);
  if (fromApp) return fromApp;
  if (typeof Core[name] === 'function') return Core[name].toString();
  return null;      // the caller reports it as unresolvable
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
  if (start < 0) return null;
  let i = appSrc.indexOf('(', start), depth = 0;
  for (; i < appSrc.length; i++) {
    if (appSrc[i] === '(') depth++;
    else if (appSrc[i] === ')') { depth--; if (!depth) break; }
  }
  return appSrc.slice(start, braceEnd(appSrc, i));
};

function fixture() {
  return {
    points: {
      1: { id: 1, x: 0, y: 0 },
      2: { id: 2, x: 100, y: 0 },
      3: { id: 3, x: 0, y: 60 },
      4: { id: 4, x: 100, y: 60 },
      30: { id: 30, x: 50, y: 0 }
    },
    entities: {
      7: { id: 7, type: 'line', a: 1, b: 2, color: '#000000' },
      8: { id: 8, type: 'line', a: 3, b: 4, color: '#000000' }
    },
    constraints: {
      101: { id: 101, type: 'vertical', entity: 7 },
      102: { id: 102, type: 'parallel', line1: 7, line2: 8 },
      103: { id: 103, type: 'distance', p1: 1, p2: 2, value: 100, kind: 'length' },
      104: { id: 104, type: 'midpoint', p: 30, entity: 7 }
    },
    layers: [{ id: 1, name: 'Layer 1', visible: true }],
    nextId: 500
  };
}

let state = fixture();
const ui = { selection: [] };
const calls = { history: 0, commit: 0 };

const PARAMS = ['state', 'ui', 'pushHistory', 'commit', 'toast', 'solveNow', 'invalidateLoops', 'cleanupPoints'];
let prelude = '';

function makeInsert(targetState, targetUi, targetCalls) {
  const values = [targetState, targetUi,
    () => { if (targetCalls) targetCalls.history++; },
    () => { if (targetCalls) targetCalls.commit++; },
    () => {}, () => {}, () => {}, () => {}];
  return new Function(...PARAMS, prelude +
    sliceOrCore('insertPointOnEntity') + '\n return insertPointOnEntity;')(...values);
}

// Dependencies surface as runtime ReferenceErrors, so resolve them by running
// both paths against a scratch copy until nothing is missing.
function build() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const scratch = fixture();
      const scratchUi = { selection: [] };
      const trial = makeInsert(scratch, scratchUi, null);
      trial(7, { x: 30, y: 0 }, {});
      trial(7, { x: 70, y: 0 }, { addOnly: true });
      return makeInsert(state, ui, calls);
    } catch (e) {
      const m = /^(\w+) is not defined$/.exec(e.message);
      if (!m) throw e;
      const src = sliceOrCore(m[1]);
      if (src) prelude += src + '\n';
      else if (m[1] === 'TAU') prelude += 'var TAU = Math.PI * 2;\n';
      else throw new Error('cannot resolve ' + m[1]);
    }
  }
  throw new Error('could not build insertPointOnEntity');
}

console.log('\n== double-click splits the line and keeps the constraints ==');
let insert = build();
insert(7, { x: 30, y: 0 }, {});
const first = state.entities[7];
const halves = Object.values(state.entities).filter(e => e.type === 'line');
console.log('  entities:', halves.map(e => e.id + ':' + e.a + '-' + e.b).join(' '));
check('line 7 still exists (constraints keep their target)', !!first);
check('line 7 is now the first half', first && +first.a === 1 && +first.b !== 2,
  first && first.a + '-' + first.b);
check('one new second half was added', halves.length === 3, halves.length);
const second = halves.find(e => e.id !== 7 && e.id !== 8);
check('second half starts at the split point', second && +second.a === +first.b, second && second.a);
check('second half ends at the old b', second && +second.b === 2, second && second.b);
check('split point sits at x = 30', state.points[first.b] && Math.abs(state.points[first.b].x - 30) < 1e-9,
  state.points[first.b] && state.points[first.b].x);
check('vertical constraint still on line 7', state.constraints[101] && +state.constraints[101].entity === 7);
check('parallel constraint untouched', state.constraints[102] && +state.constraints[102].line1 === 7);
check('length dimension untouched', state.constraints[103] && Math.abs(state.constraints[103].value - 100) < 1e-9);
check('midpoint moved to the nearest half', state.constraints[104] &&
  (+state.constraints[104].entity === 7 || +state.constraints[104].entity === second.id),
  state.constraints[104] && state.constraints[104].entity);
check('toast/commit happened once', calls.commit === 1, calls.commit);

console.log('\n== Shift adds a point on the line, no split ==');
state = fixture();
build();
calls.commit = 0;
insert = build();
const entsBefore = Object.keys(state.entities).length;
insert(7, { x: 40, y: 0 }, { addOnly: true });
const entsAfter = Object.keys(state.entities).length;
check('entity count unchanged', entsAfter === entsBefore, entsBefore + ' -> ' + entsAfter);
check('line 7 untouched', +state.entities[7].a === 1 && +state.entities[7].b === 2,
  state.entities[7].a + '-' + state.entities[7].b);
const onLine = Object.values(state.constraints).filter(c => c.type === 'pointOn' && +c.entity === 7);
console.log('  pointOn constraints:', onLine.length);
check('a pointOn constraint was added', onLine.length === 1, onLine.length);
check('the new point is at x = 40', state.points[onLine[0].p] && Math.abs(state.points[onLine[0].p].x - 40) < 1e-9,
  state.points[onLine[0].p] && state.points[onLine[0].p].x);
check('the new point is selected', ui.selection.length === 1 && ui.selection[0].kind === 'point');

console.log('\n' + (fail ? (fail + ' FAILED, ' + pass + ' passed') : ('all ' + pass + ' checks passed')));
process.exit(fail ? 1 : 0);
