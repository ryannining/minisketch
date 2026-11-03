'use strict';
// Cost estimator: preset parsing, per-colour pricing, engrave raster maths.
//
//   black  cut   @ preset speed
//   red    drill @ 2x preset speed
//   green  never billed, excluded from the billable box
//   blue   engrave: raster over its OWN box, one line per 1/DPI inch, 250 mm/s

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); }
};

const slice = (a, b) => {
  const i = app.indexOf(a);
  if (i < 0) return '';
  const j = app.indexOf(b, i);
  return j < 0 ? '' : app.slice(i, j);
};

// ---- parsing ------------------------------------------------------------
const parseSrc = slice('function costNum(', 'function costMoney(');
const M = new Function(`
  const COST_KEY = 'k';
  const cost = { presets: [], presetIdx: 0, dpi: 200, cutMm: 0, areaCm2: 0, travelMm: 0 };
  ${parseSrc}
  return { costNum, costParsePresets, costDefaultText };
`)();

console.log('cost: preset parsing');
const shipped = M.costParsePresets(M.costDefaultText());
check('every shipped preset parses', shipped.length === 22, 'got ' + shipped.length);
check('header row is skipped', !shipped.some(p => /nama bahan/i.test(p.name)));
const acp3 = shipped.find(p => p.name === 'CNC ACP 3mm');
check('ACP 3mm numbers are exact',
  acp3 && acp3.speed === 20 && acp3.repeats === 1 &&
  acp3.matPerCm2 === 22 && acp3.ratePerMin === 2000);
check('optional 6th column becomes kerf', acp3 && acp3.kerf === 4.5);

// ---- per-colour pricing -------------------------------------------------
const totalsSrc = slice('function costTotals(', 'function costFillPresets(');
const T = new Function(`
  const cost = {
    presets: [], presetIdx: 0, dpi: 200,
    cutMm: 0, fastMm: 0, engraveMm: 0, hasEngrave: false, engrave: null,
    cutSpeed: 10, areaCm2: 0, travelMm: 0
  };
  ${totalsSrc}
  return { costTotals, cost };
`)();

console.log('cost: per-colour pricing');
T.cost.presets = [{ name: 'p', speed: 10, repeats: 1, matPerCm2: 30, ratePerMin: 60, kerf: 0 }];
T.cost.presetIdx = 0;
T.cost.cutMm = 6000;
T.cost.fastMm = 0;
T.cost.engrave = null;
T.cost.areaCm2 = 10;
let t = T.costTotals();
check('cut only: 6000mm @10mm/s = 10 min', Math.abs(t.cutMin - 10) < 1e-9, String(t.cutMin));

T.cost.cutMm = 0;
T.cost.fastMm = 6000;
t = T.costTotals();
check('red drill runs at 2x speed: 6000mm @20mm/s = 5 min',
  Math.abs(t.drillMin - 5) < 1e-9, String(t.drillMin));

T.cost.fastMm = 0;
T.cost.areaCm2 = 0;
T.cost.engrave = { minutes: 4, wMm: 100, hMm: 100, lines: 100 };
t = T.costTotals();
check('engrave time is added to the total', Math.abs(t.minutes - 4) < 1e-9, String(t.minutes));
check('labour bills every minute of engrave too',
  Math.abs(t.labour - 240) < 1e-9, String(t.labour));

T.cost.presets[0].repeats = 2;
t = T.costTotals();
check('repeats multiply cut, drill AND engrave',
  Math.abs(t.cutMin - 0) < 1e-9 && Math.abs(t.engraveMin - 8) < 1e-9,
  String(t.engraveMin));

T.cost.presets[0].repeats = 1;
T.cost.engrave = { minutes: 4, wMm: 100, hMm: 100, lines: 100 };
T.cost.cutMm = 6000;
T.cost.areaCm2 = 10;
t = T.costTotals();
check('engrave cost is reported on its own',
  Math.abs(t.engraveCost - 240) < 1e-9, String(t.engraveCost));
check('cut cost excludes the engrave portion',
  Math.abs(t.cutCost - 600) < 1e-9, String(t.cutCost));
check('cut + engrave = billed labour',
  Math.abs((t.cutCost + t.engraveCost) - t.labour) < 1e-9,
  t.cutCost + '+' + t.engraveCost + ' vs ' + t.labour);

// ---- engrave raster maths ----------------------------------------------
const eng = slice('function costEngraveBox(', 'function costTotals(');
const E = new Function(`
  const cost = { dpi: 200 };
  const COST_ENGRAVE_SPEED = 250;
  const isFinite = Number.isFinite;
  ${eng}
  return { costEngraveBox, cost };
`)();

console.log('cost: engrave raster');
// 200 dpi -> 25.4/200 = 0.127 mm per line
let g = E.costEngraveBox(0, 0, 100, 100);
check('200 dpi => 0.127 mm line pitch', Math.abs(g.lineMm - 0.127) < 1e-9, String(g.lineMm));
check('lines = height / pitch', Math.abs(g.lines - (100 / 0.127)) < 1e-6, String(g.lines));
check('raster length = lines * width',
  Math.abs(g.lengthMm - g.lines * 100) < 1e-6, String(g.lengthMm));
check('time = length / 250mm/s / 60',
  Math.abs(g.minutes - g.lengthMm / 250 / 60) < 1e-12, String(g.minutes));

E.cost.dpi = 400;
g = E.costEngraveBox(0, 0, 100, 100);
check('doubling dpi halves the pitch and doubles the time',
  Math.abs(g.lineMm - 25.4 / 400) < 1e-12 && g.lines > 700, String(g.lines));

E.cost.dpi = 0;
g = E.costEngraveBox(0, 0, 10, 10);
check('a zero dpi cannot divide by zero', isFinite(g.lines) && g.dpi === 200, String(g.dpi));

E.cost.dpi = 200;
g = E.costEngraveBox(0, 0, 0, 0);
check('an empty box costs no engrave time', g.minutes === 0);

// ---- the rules live in the source --------------------------------------
console.log('cost: rules');
const meas = slice('function costMeasure(', 'function costEngraveBox(');
check('green is skipped before it is measured',
  /col === COST_GREEN\) continue;/.test(meas));
check('red is billed separately at double speed',
  /cost\.fastMm|fast \+= len/.test(meas) && /\* 2/.test(slice('function costTotals(', 'function costFillPresets(')));
check('engrave box comes from the BLUE geometry only',
  /col === COST_BLUE/.test(meas) && /eMinX/.test(meas));
check('measurement still runs on the baked CNC payload',
  /cncChains\(\s*cncCollectItems\(/.test(meas));
check('the billable box also records width and height, not just area',
  /cost\.boxW = /.test(meas) && /cost\.boxH = /.test(meas));
// One rectangle, not one per blue shape: the head rasters the whole span.
check('engrave box is a single merged box across every blue shape',
  /eMinX/.test(meas) && /eMaxX/.test(meas) &&
  (meas.match(/costEngraveBox\(/g) || []).length === 1,
  String((meas.match(/costEngraveBox\(/g) || []).length));

const render = slice('function costRender(', 'function costOpen(');
check('the panel shows the bounding box as W x H',
  /Bounding box[\s\S]{0,90}×[\s\S]{0,60}mm/.test(render));
check('the panel shows Engrave size', /Engrave size/.test(render));
check('the panel shows Engrave cost', /Engrave cost/.test(render));

console.log('cost: ui');
check('the modal offers a DPI input', /id="cost-dpi"/.test(html));
check('DPI defaults to 200', /id="cost-dpi"[^>]*value="200"/.test(html));
check('DPI is persisted on the cost state', /cost\.dpi = v > 0/.test(app));
check('changing DPI recomputes the quote', /cost\.dpi = v[\s\S]{0,160}costMeasure\(\)/.test(app));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
