// Probe: LoopTree nesting is PER LAYER. A loop on layer 2 that sits
// geometrically inside a layer-1 loop must stay a root of its own layer's
// hierarchy (depth tinting, Object Tree, arrange all read this tree), and a
// leaf entity joins only a loop on its own layer.
//
// Run: node testing/loop_tree_layers_probe.js
const fs = require('fs');
const path = require('path');
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const C = require(path.join(__dirname, '..', 'core.js'));
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

// square loop fixture: circle-flagged so loopEntities reads .entity
const state = { points: {}, entities: {}, nextId: 100 };
const newId = () => ++state.nextId;
const P = (id) => state.points[+id] || null;
const layerOf = (e) => (e && e.layer != null ? e.layer : 1);
const entityPointIds = (e) => (e && e.type === 'line' ? [e.a, e.b] : []);
const entityBounds = () => null;

function squareLoop(layer, x0, y0, x1, y1) {
  const eid = newId();
  state.entities[eid] = { id: eid, type: 'circle', layer };
  const poly = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  return { circle: true, entity: eid, poly, area: (x1 - x0) * (y1 - y0) };
}
function lineEnt(layer, x0, y0, x1, y1) {
  const a = newId(), b = newId();
  state.points[a] = { x: x0, y: y0 };
  state.points[b] = { x: x1, y: y1 };
  const id = newId();
  state.entities[id] = { id, type: 'line', a, b, layer };
  return id;
}

// layer 1: A outer, B inside A. layer 2: D big, C inside D — and C sits
// geometrically inside B (and A) too, which must NOT nest it under them.
const A = squareLoop(1, 0, 0, 100, 100);
const B = squareLoop(1, 20, 20, 40, 40);
const D = squareLoop(2, 10, 10, 90, 90);
const Cc = squareLoop(2, 30, 30, 35, 35);
const leafL1 = lineEnt(1, 25, 25, 30, 30);   // inside B (layer 1)
const leafL2 = lineEnt(2, 31, 31, 33, 33);   // inside C (layer 2), also inside B/A
const loops = [A, B, D, Cc];

const body = [slice('loopTree'), slice('loopBox'), slice('loopContainedIn'), slice('loopEntities')].join('\n');
const api = new Function(
  'state', 'P', 'layerOf', 'entityPointIds', 'entityBounds', 'pointInPoly', 'getLoops',
  `let loopTreeFor = null, loopTreeData = null, loopTreeEpoch = 0;
   ${body}
   return { loopTree };`
)(state, P, layerOf, entityPointIds, entityBounds, C.pointInPoly, () => loops);

const t = api.loopTree();
check('same-layer nesting kept: B under A', B.parent === A && B.level === 1);
check('same-layer nesting kept: C under D', Cc.parent === D && Cc.level === 1);
check('cross-layer nesting refused: C not under B/A', Cc.parent === D);
check('layer-2 root D stays root despite sitting inside A', D.parent === null && D.level === 0);
check('roots are A and D', t.roots.length === 2 && t.roots.includes(A) && t.roots.includes(D));
check('layer-1 leaf joins B', t.owner.get(leafL1) === B);
check('layer-2 leaf joins C, not the layer-1 loops around it', t.owner.get(leafL2) === Cc);
check('leaves lists agree', t.leaves.get(B).includes(leafL1) && t.leaves.get(Cc).includes(leafL2) &&
  !t.leaves.get(B).includes(leafL2));

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);