// Probe: the 90° rotate buttons turn the way their arrows point.
// World Y runs down, so VISUAL counter-clockwise moves a point at the right
// of the centre UPWARD (negative y). quickRotate's parameter is the visual
// direction (CCW positive): +90 (the ↺ button / Ctrl+[) must send (10, 0)
// to (0, -10); -90 (↻ / Ctrl+]) to (0, 10). The toast must agree.
//
// Run: node testing/rotate_direction_probe.js
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

function world() {
  const w = {
    state: {
      points: { 1: { x: -10, y: 0 }, 2: { x: 10, y: 0 } },
      entities: { 3: { id: 3, type: 'line', a: 1, b: 2 } },
      constraints: {}
    },
    toasts: []
  };
  w.deps = {
    xfBlock: () => false,
    selectionBounds: () => ({ minX: -10, minY: 0, maxX: 10, maxY: 0 }),
    selectionPointIds: () => new Set([1, 2]),
    selectedEntities: () => [w.state.entities[3]],
    pushHistory: () => {},
    P: (id) => w.state.points[+id] || null,
    toast: (m) => w.toasts.push(m),
    invalidateLoops: () => {},
    requestSolve: () => {},
    commit: () => {},
    state: w.state,
    matMul: (a, b) => a   // clone path not exercised
  };
  return w;
}
const build = (w) => new Function(
  ...Object.keys(w.deps),
  slice('quickRotate') + '\nreturn quickRotate;'
)(...Object.values(w.deps));

const near = (a, b) => Math.abs(a - b) < 1e-9;

{
  const w = world();
  build(w)(90);   // ↺ button / Ctrl+[
  const p = w.state.points[2];
  check('CCW (+90): right end goes UP on screen (0, -10)', near(p.x, 0) && near(p.y, -10),
    JSON.stringify(p));
  check('CCW toast says CCW', /CCW/.test(w.toasts[0]), w.toasts[0]);
}
{
  const w = world();
  build(w)(-90);  // ↻ button / Ctrl+]
  const p = w.state.points[2];
  check('CW (-90): right end goes DOWN on screen (0, 10)', near(p.x, 0) && near(p.y, 10),
    JSON.stringify(p));
  check('CW toast says CW', /CW/.test(w.toasts[0]) && !/CCW/.test(w.toasts[0]), w.toasts[0]);
}
{
  const w = world();
  const rot = build(w);
  rot(90); rot(90); rot(90); rot(90);
  const p = w.state.points[2];
  check('four CCW turns return home', near(p.x, 10) && near(p.y, 0), JSON.stringify(p));
}

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);