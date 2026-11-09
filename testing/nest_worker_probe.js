// Probe regresi untuk Web Worker nesting:
//   1. nest_io serialize/deserialize round-trip mempertahankan jumlah variant,
//      lcolor sheet, dan koordinat.
//   2. Wiring di app.js ada (NestIO, nestStartWorkers) — permukaan yang rawan
//      rusak saat refactor.
//
// Run: node testing/nest_worker_probe.js
const fs = require('fs');
const path = require('path');
const NW = require(path.join(__dirname, '..', 'tools', 'nest.js'));
global.MiniSketchNest = NW; // worker global untuk modul io
const io = require(path.join(__dirname, '..', 'tools', 'nest_io.js'));
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

const G = NW.GEOM_SCALE;
const rect = (x0,y0,x1,y1) => [{x:x0*G,y:y0*G},{x:x1*G,y:y0*G},{x:x1*G,y:y1*G},{x:x0*G,y:y1*G}];
const mk = (oi, lc, rings) => ({
  originIndex: oi, lcolor: lc, childIndex: [],
  variants: [ new NW.Path(rings.map(r => r.map(p => new NW.Point(p.x, p.y))), oi, null, lc) ]
});
const raw = [
  mk(0, '#00ff00', [rect(0,0,1200,1000)]),
  mk(1, null, [rect(0,0,200,150)]),
  mk(2, null, [rect(0,0,180,140), rect(0,0,60,60)])
];

console.log('nest worker io: round-trip serialisasi');
const data = io.serializeEntries(raw);
const entries = io.deserializeEntries(data);
check('jumlah entry dipertahankan', entries.length === raw.length, 'got ' + entries.length);
check('sheet lcolor dipertahankan', entries[0].lcolor === '#00ff00');
check('jumlah variant per entry sama', entries.every((e,i) => e.variants.length === raw[i].variants.length));
check('part #3 punya 2 ring (hole)', entries[2].variants[0].paths.length === 2, 'got ' + entries[2].variants[0].paths.length);
check('format serialisasi: ring berupa angka', Array.isArray(data[0].variants[0].rings[0][0]) &&
  typeof data[0].variants[0].rings[0][0][0] === 'number');

console.log('nest worker: wiring di app.js');
check('NestIO dipakai di app', /NestIO\.serializeEntries/.test(appSrc));
check('nestStartWorkers ada', /function nestStartWorkers/.test(appSrc));
check('nestCanUseWorkers fallback ada', /function nestCanUseWorkers/.test(appSrc));
check('worker-mode di nestPaintProgress', /nestJob\.workers && nestJob\.workers\.length/.test(appSrc));
check('Stop men-terminate worker', /nestFinishWorkers\(nestJob\)/.test(appSrc));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
