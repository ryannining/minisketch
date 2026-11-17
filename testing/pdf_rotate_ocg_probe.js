// Probe: PDF /Rotate and optional-content (layer) tagging.
// A portrait page (100x200) with /Rotate 270 must import LANDSCAPE with the
// content turned the way a viewer shows it, and every prim must carry its OCG
// layer name plus the default visibility from the catalog's /OFF list — the
// import dialog offers those as checkboxes (AutoCAD exports hide construction
// layers in the reference view but mark them visible in the PDF).
//
// Run: node testing/pdf_rotate_ocg_probe.js
const C = require('../core.js');
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

const content = [
  'q',
  '/OC /oc1 BDC',
  '10 10 m 90 10 l 90 190 l 10 190 l h S',
  'EMC',
  '/OC /oc2 BDC',
  '0 0 m 100 200 l S',
  'EMC',
  'Q'
].join('\n');
const objs = [
  '1 0 obj\n<< /Type /OCG /Name (Visible) >>\nendobj\n',
  '2 0 obj\n<< /Type /OCG /Name (Hidden) >>\nendobj\n',
  '3 0 obj\n<< /Type /Catalog /Pages 4 0 R /OCProperties << /OCGs [1 0 R 2 0 R] /D << /OFF [2 0 R] >> >> >>\nendobj\n',
  '4 0 obj\n<< /Type /Pages /Kids [5 0 R] /Count 1 >>\nendobj\n',
  '5 0 obj\n<< /Type /Page /Parent 4 0 R /MediaBox [0 0 100 200] /Rotate 270 /Resources << /Properties << /oc1 1 0 R /oc2 2 0 R >> >> /Contents 6 0 R >>\nendobj\n',
  '6 0 obj\n<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream\nendobj\n'
];
const bytes = new Uint8Array(Buffer.from('%PDF-1.4\n' + objs.join('') + '%%EOF', 'latin1'));

(async () => {
  const prims = await C.parsePdf(bytes);
  check('two strokes parsed', prims.length === 2, prims.length);
  const rect = prims.find(p => p.nodes.length === 4);
  const diag = prims.find(p => p.nodes.length === 2);
  check('layer names tagged', rect && rect.ocg === 'Visible' && diag && diag.ocg === 'Hidden',
    JSON.stringify(prims.map(p => p.ocg)));
  check('default visibility from /OFF', rect && rect.ocgOff === false && diag && diag.ocgOff === true);
  check('closed flag survives', rect && rect.closed === true);
  // Rotate 270 (viewer turns 270 CW = 90 CCW): (x,y) -> (H-y, x), H=200
  const xs = rect.nodes.map(n => n.p[0]), ys = rect.nodes.map(n => n.p[1]);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  check('portrait page imports landscape', w === 180 && h === 80, w + 'x' + h);
  const corner = rect.nodes.find(n => n.p[0] === 190 && n.p[1] === 10);
  check('content corner lands where the viewer shows it', !!corner,
    JSON.stringify(rect.nodes.map(n => n.p)));
  check('diagonal rotated too', diag && diag.nodes.some(n => n.p[0] === 200 && n.p[1] === 0) &&
    diag.nodes.some(n => n.p[0] === 0 && n.p[1] === 100), JSON.stringify(diag && diag.nodes.map(n => n.p)));

  // no /Rotate, no OCG: unchanged behaviour, tags null
  const plain = objs.slice();
  plain[4] = plain[4].replace(' /Rotate 270', '');
  const plainBytes = new Uint8Array(Buffer.from('%PDF-1.4\n' + plain.join('') + '%%EOF', 'latin1'));
  const pp = await C.parsePdf(plainBytes);
  const pr = pp.find(p => p.nodes.length === 4);
  const pxs = pr.nodes.map(n => n.p[0]), pys = pr.nodes.map(n => n.p[1]);
  check('without /Rotate the page stays portrait',
    Math.max(...pxs) - Math.min(...pxs) === 80 && Math.max(...pys) - Math.min(...pys) === 180);

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();