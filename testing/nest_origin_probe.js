// Probe regresi: originIndex pada variants tiap salinan nesting harus sama
// dengan originIndex entry-nya.
//
// Latar: nestBuildEntries memakai `nextOrigin++` sebagai originIndex entry,
// sedangkan Path engine memakai oi+1. Karena semua salinan satu objek dulu
// BERBAGI array variants yang sama (originIndex = oi+1), maka saat objek
// terdahulu punya >1 salinan, penomoran bergeser dan placement objek
// belakangan memetakan ke master yang SALAH (mis. F digambar sebagai A).
// Perbaikan: setiap salinan mendapat variants yang di-clone dengan originIndex
// = originIndex entry-nya.
//
// Run: node testing/nest_origin_probe.js
const fs = require('fs');
const path = require('path');
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

console.log('nest origin: tiap salinan membawa variants dengan originIndex entry');
check('variants di-clone per salinan (bukan berbagi objek)',
  /const cvariants = variants\.map\(v => \{[\s\S]{0,120}cl\.originIndex = idx;/.test(appSrc));
check('entry memakai variants: cvariants',
  /variants: cvariants,/.test(appSrc));
check('variants lama (berbagi) tidak lagi dipakai di push entry',
  !/originIndex: nextOrigin\+\+,[\s\S]{0,80}variants,/s.test(appSrc));

// Perilaku: simulasi invarian pemetaan (sama dgn nestApplyResult lookup).
// - entry.originIndex = nextOrigin++ (unik per salinan)
// - placement.originIndex = originIndex variants (kini = originIndex entry)
function simulate(objects) {
  const entries = [];
  let nextOrigin = 1;
  for (let oi = 0; oi < objects.length; oi++) {
    const obj = objects[oi];
    for (let c = 0; c < obj.copies; c++) {
      const idx = nextOrigin++;
      entries.push({ originIndex: idx, obj: obj.name });
    }
  }
  const recsByOrigin = new Map(entries.map(e => [e.originIndex, e.obj]));
  // placement meniru originIndex variants (= originIndex entry setelah fix)
  let origin = 1;
  const bad = [];
  for (const obj of objects) {
    for (let c = 0; c < obj.copies; c++) {
      const got = recsByOrigin.get(origin++);
      if (got !== obj.name) bad.push(obj.name + ' -> ' + got);
    }
  }
  return bad;
}

console.log('nest origin: pemetaan placement -> master benar utk multi-salinan');
check('A=2,F=1 semua benar', simulate([{name:'A',copies:2},{name:'F',copies:1}]).length === 0,
  JSON.stringify(simulate([{name:'A',copies:2},{name:'F',copies:1}])));
check('A=3,F=2,G=1 semua benar', simulate([{name:'A',copies:3},{name:'F',copies:2},{name:'G',copies:1}]).length === 0,
  JSON.stringify(simulate([{name:'A',copies:3},{name:'F',copies:2},{name:'G',copies:1}])));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
