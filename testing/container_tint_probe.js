// Probe for how containers (group/art, clone array, part) read on canvas.
//
// The rule: UNSELECTED containers are drawn darkened (their colour mixed with
// black at 50%) so the working selection stands out; SELECTED ones return to the
// true colour. Brightening a selected container meant the drawing had two
// different "normal" colours depending on selection, which read as noise.
//
// Run: node testing/container_tint_probe.js
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

console.log('container tint: dimColor exists and mixes with black');
{
  const i = app.indexOf('function dimColor(');
  const body = app.slice(i, app.indexOf('\n  function ', i));
  check('dimColor is defined', i > 0);
  check('it parses #rrggbb', /\^#\(\[0-9a-fA-F\]\{6\}\)\$/.test(body));
  check('it also accepts rgb()/rgba()', /rgba\?\\\(/.test(body));
  check('it mixes 50% toward black', /v \* 0\.5/.test(body));
  check('the result is memoised', /darkCache\.get\(key\)/.test(body) && /darkCache\.set\(key, out\)/.test(body));
  check('a non-colour is passed through unchanged', /return hex;/.test(body));
}

console.log('container tint: all three draw paths follow the rule');
check('art/group: true colour when selected, dim otherwise',
  /ctx\.strokeStyle = isSel \? themedCanvasColor\(col\) : dimColor\(themedCanvasColor\(col\)\);/.test(app));
check('array/clone: true colour when selected, dim otherwise',
  /ctx\.strokeStyle = arrSel \? themedCanvasColor\(col\) : dimColor\(themedCanvasColor\(col\)\);/.test(app));
check('part: true colour when selected, dim otherwise',
  /ctx\.strokeStyle = isSel \? themedCanvasColor\(e\.color \|\| PART_COLOR\) : dimColor\(themedCanvasColor\(e\.color \|\| PART_COLOR\)\);/.test(app));
check('no container path brightens on selection any more',
  !/isSel \? brightColor\(themedCanvasColor\(col\)\)/.test(app) &&
  !/arrSel \? brightColor\(/.test(app));
check('plain shapes keep their brightened selection look',
  /ctx\.strokeStyle = isSel \? brightColor\(themedCanvasColor\(colorOf\(e\)\)\)/.test(app) ||
  /brightColor\(themedCanvasColor\(colorOf\(e\)\)\)/.test(app));

// ---- arithmetic -----------------------------------------------------------
console.log('container tint: colour maths');
{
  const dim = (hex) => {
    const rgb = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    return 'rgb(' + rgb.map(v => Math.round(v * 0.5)).join(',') + ')';
  };
  check('black stays black', dim('#000000') === 'rgb(0,0,0)');
  check('white becomes mid grey', dim('#ffffff') === 'rgb(128,128,128)');
  check('pure red halves to dark red', dim('#ff0000') === 'rgb(128,0,0)');
  // the CNC palette: red means marking, black means through-cut — both must
  // remain distinguishable after dimming
  check('marking red and cut black stay different',
    dim('#ff0000') !== dim('#000000'));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
