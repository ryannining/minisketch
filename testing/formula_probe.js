// Probe: evalFormula — the L/T/W/H strip and every other numeric field.
// Final rules:
//   - a bare number, signed or not, is ABSOLUTE: typing "-1100" over a field
//     showing "-1200" sets -1100, no prefix needed
//   - relative edits: "+10" (leading plus) or "10-" / "10+" (trailing operator)
//   - arithmetic everywhere: "-1200-10" = -1210, "1200*2" = 2400
//   - Wt/Z parse through evalFormula with the "=" literal prefix, so they get
//     arithmetic but never a relative shift
//   - angles/dimensions keep literal signed numbers ("-151.449")
//
// Run: node testing/formula_probe.js
const fs = require('fs');
const path = require('path');
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

const start = appSrc.indexOf('function evalFormula(');
let d = 0, end = -1;
for (let j = appSrc.indexOf('{', start); j < appSrc.length; j++) {
  if (appSrc[j] === '{') d++;
  else if (appSrc[j] === '}') { d--; if (!d) { end = j + 1; break; } }
}
const evalFormula = new Function(appSrc.slice(start, end) + '\nreturn evalFormula;')();

let pass = 0, fail = 0;
const near = (a, b) => Math.abs(a - b) < 1e-9;
const t = (name, got, want) => {
  const ok = Number.isNaN(want) ? Number.isNaN(got) : near(got, want);
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '  got ' + got + ', want ' + want); }
};

console.log('manual edit over a shown value (base -1200):');
const F = (s) => evalFormula(s, -1200);
t('"-1100" typed over "-1200" -> -1100 (absolute, no prefix)', F('-1100'), -1100);
t('"-10" is absolute -10, not a shift', F('-10'), -10);
t('"100" absolute', F('100'), 100);
t('"0" absolute', F('0'), 0);

console.log('relative shifts (base -1200):');
t('"+10" -> -1190', F('+10'), -1190);
t('"10-" -> -1210', F('10-'), -1210);
t('"10+" -> -1190', F('10+'), -1190);
t('"+-10" -> -1210', F('+-10'), -1210);
t('"+10*2" -> -1180', F('+10*2'), -1180);
t('"10*2-" -> -1220', F('10*2-'), -1220);
t('"+(3+4)" -> -1193', F('+(3+4)'), -1193);
t('"  10 -  " whitespace -> -1210', F('  10 -  '), -1210);

console.log('arithmetic (base -1200):');
t('"-1200-10" -> -1210 (no base prepend)', F('-1200-10'), -1210);
t('"-1200+10" -> -1190', F('-1200+10'), -1190);
t('"100*2" -> 200', F('100*2'), 200);
t('"1200+100" -> 1300', F('1200+100'), 1300);
t('"(10+2)*3" -> 36', F('(10+2)*3'), 36);
t('"150%" -> -1800', F('150%'), -1800);
t('"1e3" -> 1000', F('1e3'), 1000);
t('"1e-3" -> 0.001 (signed exponent is not a trailing op)', F('1e-3'), 0.001);
t('"=-10" literal escape', F('=-10'), -10);

console.log('rejections:');
t('"abc"', F('abc'), NaN);
t('"10*"', F('10*'), NaN);
t('""', F(''), NaN);
t('"="', F('='), NaN);
t('"-"', F('-'), NaN);
t('"1e-"', F('1e-'), NaN);

console.log('Wt/Z style: literal prefix + arithmetic (what applyTransformField passes):');
const L = (s) => evalFormula(s[0] === '=' ? s : '=' + s, 0);
t('"1200+100" -> 1300', L('1200+100'), 1300);
t('"1200*2" -> 2400', L('1200*2'), 2400);
t('"-10" -> -10', L('-10'), -10);
t('"+10" -> 10 (absolute, never a shift)', L('+10'), 10);
t('"50-20" -> 30', L('50-20'), 30);
t('"10-" rejected (no relative in Wt/Z)', L('10-'), NaN);

console.log('angles/dimensions regressions (base 200):');
t('"-151.449" reflex angle stays literal', evalFormula('-151.449', 200), -151.449);
t('"+20" still relative', evalFormula('+20', 200), 220);
t('"-5+3" arithmetic -> -2', evalFormula('-5+3', 200), -2);

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);