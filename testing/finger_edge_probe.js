// Probe for the finger-joint EDGE PATH: the joint is one open zig-zag from the
// master line's a end to its b end (not a row of closed rectangles), so the
// KaryaCNC cut follows the real joint outline. Slices the real planFingers +
// edgePath out of ../tools/finger.js.
//
// Run: node testing/finger_edge_probe.js
const fs = require('fs');
const path = require('path');

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
  throw new Error('unbalanced braces');
}
const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'finger.js'), 'utf8');
function sliceFn(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('not found: ' + name);
  let i = src.indexOf('(', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') { depth--; if (!depth) break; }
  }
  return src.slice(start, braceEnd(src, i));
}
const planSrc = sliceFn('planFingers');
const edgeSrc = sliceFn('edgePath');
const boxSrc = sliceFn('boxRects');
const fmt0 = (v) => String(Math.round(+v * 100) / 100);
const MIN_CELL = 0.2;   // mm — same constant as tools/finger.js
const factory = new Function('fmt0', 'MIN_CELL', planSrc + '\n' + edgeSrc + '\n' + boxSrc +
  '\nreturn { planFingers, edgePath, boxRects };');
const { planFingers, edgePath, boxRects } = factory(fmt0, MIN_CELL);

// male and female on the same line
const L = 200, t = 3, fw = 12;
const male = planFingers(L, t, fw, 'male');
const female = planFingers(L, t, fw, 'female');
check('male plan ok', male.ok, male.why);
check('female plan ok', female.ok, female.why);
check('female owns the odd cells: first box present',
  female.tabs[0][0] === 0 && female.count >= male.count,
  female.count + ' vs ' + male.count);
check('male owns the even cells: first cell empty',
  male.tabs[0][0] === male.cell);
check('same grid for both modes', male.cell === female.cell);

const mp = edgePath(male);
const fp = edgePath(female);

for (const [label, path, plan] of [['male', mp, male], ['female', fp, female]]) {
  check(label + ': starts at the a end on the baseline',
    path[0][0] === 0 && path[0][1] === 0);
  check(label + ': ends at the b end on the baseline',
    path[path.length - 1][0] === L && path[path.length - 1][1] === 0);
  check(label + ': u never goes backwards',
    path.every((q, i) => i === 0 || q[0] >= path[i - 1][0] - 1e-9));
  check(label + ': v is only baseline or full thickness',
    path.every(q => q[1] === 0 || q[1] === t));
  check(label + ': open path (>= 4 corners, odd tab count)',
    path.length >= 4);
}

// the male path's rises sit exactly on the male tab cells
const maleRises = [];
for (let i = 1; i < mp.length - 1; i++) {
  if (mp[i][1] === t && mp[i - 1][1] === 0) maleRises.push(mp[i][0]);
}
check('male rises start at each tab start',
  maleRises.length === male.count && maleRises.every((u, i) => Math.abs(u - male.tabs[i][0]) < 1e-9));

// complement: no u-interval is a rise in BOTH rows (tab against gap)
const riseOf = (path) => {
  const set = [];
  for (let i = 1; i < path.length; i++) {
    if (path[i][1] === t && path[i - 1][1] === t) set.push([path[i - 1][0], path[i][0]]);
  }
  return set;
};
const mr = riseOf(mp), fr = riseOf(fp);
const overlap = mr.some(([a, b]) => fr.some(([c, d]) => a < d - 1e-9 && c < b - 1e-9));
check('male tab spans and female tab spans never overlap', !overlap);

// box mode: closed rectangles centred on the master line
const boxes = boxRects(male);
check('box mode: one rectangle per tab', boxes.length === male.count);
check('box mode: rectangles straddle the line (+t/2 .. -t/2)',
  boxes.every(r => r[0].y === t / 2 && r[1].y === t / 2 && r[2].y === -t / 2 && r[3].y === -t / 2));
check('box mode: each rectangle spans its tab cell',
  boxes.every((r, i) => r[0].x === male.tabs[i][0] && r[1].x === male.tabs[i][1]));

// end margins: grid inset, but the cut path still spans the whole line
const mm = 8;
const maleM = planFingers(L, t, fw, 'male', mm);
check('margin plan ok', maleM.ok, maleM.why);
const femaleM2 = planFingers(L, t, fw, 'female', mm);
check('margin insets the first tab (female, odd cells)',
  Math.abs(femaleM2.tabs[0][0] - mm) < 1e-9, femaleM2.tabs[0][0]);
check('margin insets the last tab end',
  Math.abs(femaleM2.tabs[femaleM2.count - 1][1] - (L - mm)) < 1e-9);
const mpM = edgePath(femaleM2);
check('margined path still starts and ends on the full line',
  mpM[0][0] === 0 && mpM[mpM.length - 1][0] === L);
check('margined path walks the baseline through the margin',
  mpM.some((q, i) => i > 0 && q[0] === mm && q[1] === 0));
const tooWide = planFingers(L, t, fw, 'male', L / 2);
check('margin eating the whole line is refused', !tooWide.ok);
const boxesM = boxRects(maleM);
check('box+margin: rectangles live in the inner span only',
  boxesM.every(r => r[0].x >= mm - 1e-9 && r[1].x <= L - mm + 1e-9));
const femaleM = planFingers(L, t, fw, 'female', mm);
const boxesF = boxRects(femaleM);
check('box+margin: female first rect starts at the offset',
  Math.abs(boxesF[0][0].x - mm) < 1e-9, boxesF[0][0].x);
check('box+margin: male first rect starts at offset + one cell',
  Math.abs(boxesM[0][0].x - (mm + maleM.cell)) < 1e-9, boxesM[0][0].x);

console.log('\n' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
