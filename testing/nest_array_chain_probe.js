// Probe regresi: payload nesting untuk ARRAY harus meng-chain polylines per
// instance menjadi loop (bukan mengirim tiap segmen sebagai <path> terpisah).
//
// Latar: cabang array di nestSvgString sebelumnya meng-emit tiap polyline
// mentah dari arrayInstancePolylines. Untuk part yang dibentuk dari beberapa
// garis, tiap segmen jadi <path> sendiri -> array 7x5 dari persegi 4 garis jadi
// 140 path lepas dan KaryaCNC melaporkan ~2000 part. Perbaikan: chain per
// instance per warna (sama dgn pool garis lurus).
//
// Run: node testing/nest_array_chain_probe.js
const fs = require('fs');
const path = require('path');
const Core = require(path.join(__dirname, '..', 'core.js'));
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

console.log('nest array chain: payload tidak lagi mengirim segmen lepas');
check('cabang array mengelompokkan per warna (byColor)',
  /if \(e\.type === 'array'\) \{[\s\S]{0,1200}const byColor = new Map\(\);/.test(appSrc));
check('cabang array memanggil chainPolylines per instance',
  /if \(e\.type === 'array'\) \{[\s\S]{0,1600}chainPolylines\(polys, 0\.05\)/.test(appSrc));
check('emit per loop hasil chain (bukan per polyline mentah)',
  /if \(e\.type === 'array'\) \{[\s\S]{0,2000}for \(const loop of loops\)/.test(appSrc));

// Perilaku: 4 garis persegi -> 1 loop tertutup
console.log('nest array chain: chainPolylines menutup persegi 4 garis');
{
  const rect = [
    { pts: [{x:0,y:0},{x:100,y:0}], closed: false },
    { pts: [{x:100,y:0},{x:100,y:50}], closed: false },
    { pts: [{x:100,y:50},{x:0,y:50}], closed: false },
    { pts: [{x:0,y:50},{x:0,y:0}], closed: false },
  ];
  const loops = Core.chainPolylines(rect, 0.05);
  check('persegi -> tepat 1 loop', loops.length === 1, 'got ' + loops.length);
  check('loop persegi tertutup', loops[0] && !!loops[0].closed);
  check('loop persegi 4 titik', loops[0] && loops[0].pts.length === 4, 'got ' + (loops[0] && loops[0].pts.length));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
