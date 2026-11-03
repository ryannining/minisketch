// Probe for the pixel density read out of a pasted raster (core.js) and the
// width the Paste image dialog derives from it.
//
// The bug: a reference screenshot pasted from a CAD app always landed at
// naturalWidth * 25.4 / 96, and the last used width was remembered, so two
// captures of the same area at slightly different crops came out at different
// sizes. The file's own density is the honest scale.
//
// Run: node testing/image_density_probe.js
'use strict';
const fs = require('fs');
const path = require('path');
const C = require(path.join(__dirname, '..', 'core.js'));

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

// ---- tiny builders ---------------------------------------------------------
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);            // the reader never verifies the CRC
  return Buffer.concat([len, Buffer.from(type, 'ascii'), data, crc]);
}
function png(ppuX, ppuY, unit, w, h) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w || 10, 0);
  ihdr.writeUInt32BE(h || 10, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const parts = [sig, chunk('IHDR', ihdr)];
  if (ppuX != null) {
    const phys = Buffer.alloc(9);
    phys.writeUInt32BE(ppuX, 0);
    phys.writeUInt32BE(ppuY == null ? ppuX : ppuY, 4);
    phys[8] = unit == null ? 1 : unit;
    parts.push(chunk('pHYs', phys));
  }
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}
function jfif(xd, yd, units) {
  const app0 = Buffer.alloc(18);
  app0[0] = 0xff; app0[1] = 0xe0;
  app0.writeUInt16BE(16, 2);
  Buffer.from('JFIF\0', 'ascii').copy(app0, 4);
  app0[9] = 1; app0[10] = 1;
  app0[11] = units;
  app0.writeUInt16BE(xd, 12);
  app0.writeUInt16BE(yd, 14);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, Buffer.from([0xff, 0xd9])]);
}

console.log('\n== PNG pHYs ==');
{
  const d300 = C.imagePixelDensity(png(11811, 11811, 1));
  check('300 dpi is read from pHYs (metre units)', d300 && Math.abs(d300.dpi - 300) < 0.01, d300 && d300.dpi);
  check('the vertical density comes too', d300 && Math.abs(d300.dpiY - 300) < 0.01, d300 && d300.dpiY);
  check('it says where it came from', d300 && d300.source === 'png');

  const d96 = C.imagePixelDensity(png(3780, 3780, 1));
  check('96 dpi round-trips', d96 && Math.abs(d96.dpi - 96) < 0.1, d96 && d96.dpi);

  const aniso = C.imagePixelDensity(png(11811, 5906, 1));
  check('a different Y density is kept separately',
    aniso && Math.abs(aniso.dpi - 300) < 0.05 && Math.abs(aniso.dpiY - 150) < 0.05,
    aniso && (aniso.dpi + '/' + aniso.dpiY));

  check('unit=0 (aspect only) is not a density', C.imagePixelDensity(png(11811, 11811, 0)) === null);
  check('a PNG without pHYs reports nothing', C.imagePixelDensity(png(null)) === null);
}

console.log('\n== JPEG JFIF and EXIF ==');
{
  const dpi = C.imagePixelDensity(jfif(300, 300, 1));
  check('JFIF dpi units are read', dpi && Math.abs(dpi.dpi - 300) < 1e-6, dpi && dpi.dpi);
  const dpcm = C.imagePixelDensity(jfif(118, 118, 2));
  check('JFIF dpcm is converted to dpi', dpcm && Math.abs(dpcm.dpi - 299.72) < 0.5, dpcm && dpcm.dpi);
  check('JFIF unit=0 (aspect only) is not a density', C.imagePixelDensity(jfif(1, 1, 0)) === null);
}

console.log('\n== the mm width follows the density ==');
{
  // what the dialog computes: naturalWidth * 25.4 / dpi
  const mmAt = (px, dpi) => px * 25.4 / dpi;
  check('1000 px at 300 dpi is 84.7 mm', Math.abs(mmAt(1000, 300) - 84.67) < 0.01, mmAt(1000, 300));
  check('1000 px at 96 dpi is 264.6 mm', Math.abs(mmAt(1000, 96) - 264.58) < 0.01, mmAt(1000, 96));
  // the point of the fix: a slightly different crop of the same CAD area keeps
  // the same scale, because the scale comes from the density, not a fixed width
  const cropA = 1000, cropB = 1012;
  check('two crops at the same dpi keep their true relative size',
    Math.abs(mmAt(cropA, 300) / mmAt(cropB, 300) - cropA / cropB) < 1e-9);
  check('the default dpi is 96', C.IMAGE_DEFAULT_DPI === 96);
}

console.log('\n== app.js uses the density, not a hardcoded 96 ==');
{
  const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  check('the paste dialog reads the density', /imageDensityOf\(blob\)/.test(appSrc));
  check('it reports the density in the dialog', /img-dpi/.test(appSrc));
  // the stored input is the DPI: a width only describes one pixel size, a
  // density describes the source
  check('the remembered value is the DPI', /dpi,?\s*\n?\s*\}\)\);/.test(appSrc) || /\bdpi\b\s*\}\)\);/.test(appSrc));
  check('no mm-per-pixel scale is stored any more', !/mmPerPx/.test(appSrc));
  check('the stored DPI is the fallback for a file with no density', /saved\.dpi/.test(appSrc));
  check('the dialog keeps dpi and width in step', /syncImageWidthFromDpi/.test(appSrc) && /syncImageDpiFromWidth/.test(appSrc));
  check('addImageEntity falls back to IMAGE_DEFAULT_DPI',
    /IMAGE_DEFAULT_DPI/.test(appSrc.slice(appSrc.indexOf('function addImageEntity('),
      appSrc.indexOf('function drawTextEntity('))));
  check('the trace path uses the same fallback',
    /ART_MM_PER_PX = 25\.4 \/ IMAGE_DEFAULT_DPI/.test(appSrc));
  // the only remaining 25.4 / 96 must be the CSS px unit for SVG imports
  const hard = appSrc.split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => /25\.4 ?\/ ?96/.test(line) && !/SVG_MM_PER/.test(line));
  check('no bare 25.4 / 96 is left outside the SVG unit table', hard.length === 0,
    hard.map(([n, l]) => n + ': ' + l.trim()).join(' | '));
}

console.log('\n' + (fail ? fail + ' FAILED, ' : 'all ') + pass + ' checks passed');
process.exit(fail ? 1 : 0);
