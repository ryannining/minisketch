// Probe for "Send to nest": a selected text object must ship its glyph data.
//
// Two bugs used to hide text from the nesting server:
//   1. cmdNest() skipped e.type === 'text' outright, so it was never uploaded
//   2. nestSvgString() had no text branch: it fell through to the straight-line
//      pool, where entityWorldPolylinep yields nothing for a text frame
//
// This probe lifts nestSvgString out of the IIFE, stubs the helpers it needs,
// and checks that a text entity produces <path> elements — open (no Z) for a
// single-line font, closed (Z) for an outline font.
//
// Run: node testing/nest_text_probe.js
const fs = require('fs');
const path = require('path');
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

console.log('nest text: cmdNest no longer drops text');
check('text is not filtered out with notes',
  !/if \(e\.type === 'note' \|\| e\.type === 'text'\) continue;/.test(appSrc));
check('notes are still skipped',
  /if \(e\.type === 'note'\) continue;/.test(appSrc));

console.log('nest text: nestSvgString has a text branch');
check('text branch calls textOutlineWorld',
  /if \(e\.type === 'text'\) \{[\s\S]{0,400}textOutlineWorld\(e\)/.test(appSrc));

// ---- lift nestSvgString and run it --------------------------------------
function braceEnd(s, from) {
  let d = 0;
  for (let j = s.indexOf('{', from); j < s.length; j++) {
    if (s[j] === '{') d++;
    else if (s[j] === '}') { d--; if (!d) return j + 1; }
  }
  throw new Error('unbalanced');
}
const src = appSrc.slice(appSrc.indexOf('function nestSvgString('));
const fnSrc = src.slice(0, braceEnd(src, src.indexOf(')')));

function build(outline) {
  const stub = {
    ownedGuideIds: () => new Set(),
    colorOf: () => '#000000',
    textOutlineWorld: () => outline,
    circleData: () => null,
    svgArcPath: () => null,
    entityWorldPolylinep: () => null,
    nestClosedLoop: () => null,
    P: () => null
  };
  const names = Object.keys(stub);
  const fn = new Function(...names, fnSrc + '\nreturn nestSvgString;');
  return fn(...names.map(n => stub[n]));
}

console.log('nest text: single-line font emits open strokes');
{
  const outlines = {
    closed: false,
    loops: [
      [{ x: 0, y: 0 }, { x: 0, y: 10 }],
      [{ x: 5, y: 0 }, { x: 5, y: 10 }]
    ]
  };
  const svg = build(outlines)([{ id: 1, type: 'text' }]);
  const paths = (svg.match(/<path/g) || []).length;
  check('two stems -> two paths', paths === 2, 'got ' + paths);
  check('open strokes carry no Z', !/ Z"/.test(svg));
  check('stroke colour is set', /stroke="#000000"/.test(svg));
}

console.log('nest text: outline font emits closed contours');
{
  const outlines = {
    closed: true,
    loops: [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]]
  };
  const svg = build(outlines)([{ id: 2, type: 'text' }]);
  check('one contour -> one path', (svg.match(/<path/g) || []).length === 1);
  check('closed contour carries Z', / Z"/.test(svg));
}

console.log('nest text: y is flipped into SVG space');
{
  const outlines = { closed: false, loops: [[{ x: 1, y: 2 }, { x: 3, y: 4 }]] };
  const svg = build(outlines)([{ id: 3, type: 'text' }]);
  check('y negated (2 -> -2.0000)', /M 1\.0000 -2\.0000/.test(svg), svg);
}

console.log('nest text: degenerate loops are dropped');
{
  const outlines = { closed: false, loops: [[{ x: 0, y: 0 }], []] };
  const svg = build(outlines)([{ id: 4, type: 'text' }]);
  check('a 1-point loop emits no path', (svg.match(/<path/g) || []).length === 0);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
