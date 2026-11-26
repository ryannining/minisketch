// Probe for the raster tracer (tools/trace.js).
//
// The tracer replaces the old GPL Potrace port with ImageTracerJS
// (Unlicense). Two properties matter and are pinned here:
//
//  1. FOREGROUND ONLY. ImageTracerJS traces every palette colour, so the
//     white background of a picture would come back as a giant rectangle.
//     The wrapper binarises the raster and keeps only the dark layer, so the
//     cutter never tries to cut the whole sheet.
//  2. THE SETTINGS REACH THE TRACER. Detail / curve / speckle / threshold /
//     blur / corners / smooth must map onto the ImageTracerJS options, or
//     the tolerance knobs in the dialog would be decoration.
//
// Run: node testing/trace_probe.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const traceSrc = fs.readFileSync(path.join(ROOT, 'tools', 'trace.js'), 'utf8');

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

// ---- load the tracer the way the browser does --------------------------
// tools/trace.js is a plain script that registers window.MiniSketchTrace.
// In Node there is no window, so stand one up before evaluating it. ImageTracerJS
// installs itself on `self` when it sees a CommonJS `module`, so `self` has
// to point at the same object the tracer will land on.
const vm = require('vm');
const win = {};
const sandbox = {
  window: win,
  self: win,
  document: { createElement: () => ({ getContext: () => null }) },
  location: { href: 'file:///probe/' },
  ImageData: function (w, h) {
    this.width = w; this.height = h;
    this.data = new Uint8ClampedArray(w * h * 4);
  },
  setTimeout, clearTimeout
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'tools', 'imagetracer.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'tools', 'subpixel_trace.js'), 'utf8'), sandbox);
vm.runInContext(traceSrc, sandbox);
const T = win.MiniSketchTrace;

console.log('\n== the tracer module loads ==');
{
  check('tools/trace.js registers window.MiniSketchTrace', !!T);
  check('it exposes trace / toImageData / binarize',
    typeof T.trace === 'function' && typeof T.toImageData === 'function' && typeof T.binarize === 'function');
}

// ---- the GPL blocker is gone ------------------------------------------
console.log('\n== the GPL tracer is gone ==');
{
  check('tools/Potrace.js no longer exists', !fs.existsSync(path.join(ROOT, 'tools', 'Potrace.js')));
  check('index.html does not load Potrace', !/Potrace\.js/.test(html));
  check('index.html loads the new tracer', /tools\/imagetracer\.js/.test(html) && /tools\/trace\.js/.test(html));
  check('app.js never calls Potrace', !/\bPotrace\b/.test(appSrc));
  check('help.js no longer names Potrace', !/Potrace/.test(fs.readFileSync(path.join(ROOT, 'help.js'), 'utf8')));
}

// ---- the settings reach ImageTracerJS ---------------------------------
console.log('\n== the tolerance knobs reach the tracer ==');
{
  const o = T.traceOptions(T.normalizeOptions({}));
  check('detail maps to ltres (line error threshold)', o.ltres === 2, o.ltres);
  check('curve maps to qtres (curve error threshold)', o.qtres === 1, o.qtres);
  check('speckle maps to pathomit (noise paths dropped)', o.pathomit === 8, o.pathomit);
  check('corners maps to rightangleenhance', o.rightangleenhance === true);
  check('smooth maps to linefilter', o.linefilter === true);
  check('blur maps to blurradius', o.blurradius === 0, o.blurradius);
  check('only two colours are quantised', o.numberofcolors === 2 && o.colorsampling === 0);
  check('the palette is black + white', o.pal.length === 2 && o.pal[0].r === 0 && o.pal[1].r === 255);
}

// ---- option clamping ----------------------------------------------------
console.log('\n== out-of-range settings are clamped, not obeyed ==');
{
  const n = T.normalizeOptions({ detail: 9999, curve: -5, speckle: -3, threshold: 400, blur: 99 });
  check('detail is capped', n.detail === 20, n.detail);
  check('curve is floored', n.curve === 0.01, n.curve);
  check('speckle cannot go negative', n.speckle === 0, n.speckle);
  check('threshold is capped at 255', n.threshold === 255, n.threshold);
  check('blur is capped at 5', n.blur === 5, n.blur);
  const missing = T.normalizeOptions({});
  check('a missing setting falls back to its default', missing.detail === 2 && missing.speckle === 8);
}

// ---- binarisation --------------------------------------------------------
console.log('\n== binarisation picks the dark shape ==');
{
  const img = { width: 4, height: 1, data: new Uint8ClampedArray(4 * 4) };
  const vals = [0, 60, 200, 255];        // dark, dark, light, light
  for (let i = 0; i < 4; i++) {
    img.data[i * 4] = vals[i];
    img.data[i * 4 + 1] = vals[i];
    img.data[i * 4 + 2] = vals[i];
    img.data[i * 4 + 3] = 255;
  }
  const out = T.binarize(img, 128);
  check('a black pixel stays black', out.data[0] === 0);
  check('a dark grey pixel stays black', out.data[4] === 0);
  check('a light pixel becomes white', out.data[8] === 255);
  check('white stays white', out.data[12] === 255);
  check('the source pixels are untouched', img.data[0] === 0 && img.data[8] === 200);
  const strict = T.binarize(img, 10);
  check('a low threshold turns grey into white', strict.data[4] === 255);
}

// ---- foreground only ------------------------------------------------------
console.log('\n== only the dark shape is traced ==');
{
  // 32x32: a filled black square in the middle of a white field.
  const W = 32, H = 32;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const black = (x >= 8 && x < 24 && y >= 8 && y < 24);
      data[i] = data[i + 1] = data[i + 2] = black ? 0 : 255;
      data[i + 3] = 255;
    }
  }
  const bin = T.binarize({ width: W, height: H, data }, 128);
  T.trace(bin, { detail: 2, curve: 1, speckle: 4, threshold: 128 }).then((res) => {
    check('the trace returns an svg', typeof res.svg === 'string' && res.svg.length > 0);
    check('it reports the contour count', res.paths >= 1, res.paths);
    // the background rectangle would span the whole canvas (0,0)-(32,32);
    // the square must not reach the border. Read the coordinates out of the
    // path data only — the SVG attributes carry numbers of their own
    // (stroke-width, opacity) that have nothing to do with the geometry.
    const dAttr = (res.svg.match(/\sd="([^"]*)"/g) || []).join(' ');
    const nums = (dAttr.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    const maxX = Math.max.apply(null, nums);
    const minX = Math.min.apply(null, nums);
    check('the white background is NOT traced', maxX < 32, 'maxX=' + maxX);
    check('the shape keeps its real size', minX >= 7 && maxX <= 25, 'minX=' + minX + ' maxX=' + maxX);
    check('the svg has no white-filled path',
      !/fill="rgb\(255,255,255\)"/.test(res.svg));
    // Sub-Pixel AA algorithm: anti-aliased grayscale circle traced directly
    const SW = 64, SH = 64;
    const sdata = new Uint8ClampedArray(SW * SH * 4);
    for (let y = 0; y < SH; y++) {
      for (let x = 0; x < SW; x++) {
        const d = Math.hypot(x + 0.5 - 32.3, y + 0.5 - 32.6) - 16.4;
        const cov = Math.max(0, Math.min(1, 0.5 - d));
        const g = Math.round(255 * (1 - cov));
        const idx = (y * SW + x) * 4;
        sdata[idx] = sdata[idx + 1] = sdata[idx + 2] = g;
        sdata[idx + 3] = 255;
      }
    }
    return T.trace({ width: SW, height: SH, data: sdata }, {
      algorithm: 'subpixel', threshold: 128, detail: 2, curve: 1, speckle: 4, corners: true, smooth: true
    }).then((spRes) => {
      check('subpixel algorithm returns an svg', typeof spRes.svg === 'string' && spRes.svg.length > 0);
      check('subpixel algorithm traces a single foreground contour', spRes.paths === 1, spRes.paths);
      check('subpixel algorithm fits quadratic curves on circles', /\bQ\b/.test(spRes.svg));
      const sdAttr = (spRes.svg.match(/\sd="([^"]*)"/g) || []).join(' ');
      const snums = (sdAttr.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
      const smax = Math.max.apply(null, snums);
      const smin = Math.min.apply(null, snums);
      check('subpixel algorithm does not trace the white background', smax < SW && smin > 0, 'min=' + smin + ' max=' + smax);
      finish();
    });
  }).catch((err) => {
    check('the trace runs', false, err && err.message);
    finish();
  });
}

// ---- the dialog is wired --------------------------------------------------
console.log('\n== the dialog exposes the settings and the preview ==');
{
  for (const id of ['img-algo', 'img-detail', 'img-curve', 'img-speckle', 'img-threshold', 'img-blur',
    'img-corners', 'img-smooth', 'img-fitcurve', 'img-tol']) {
    check('the dialog has ' + id, html.indexOf('id="' + id + '"') >= 0);
  }
  check('index.html loads tools/subpixel_trace.js', /tools\/subpixel_trace\.js/.test(html));
  check('trace_worker.js imports subpixel_trace.js',
    /subpixel_trace\.js/.test(fs.readFileSync(path.join(ROOT, 'tools', 'trace_worker.js'), 'utf8')));
  check('normalizeOptions accepts subpixel and defaults unknown to imagetracer',
    T.normalizeOptions({ algorithm: 'subpixel' }).algorithm === 'subpixel' &&
    T.normalizeOptions({ algorithm: 'unknown' }).algorithm === 'imagetracer');
  check('the dialog has a preview canvas', /id="img-preview"/.test(html));
  check('the preview has an info line', /id="img-preview-info"/.test(html));
  check('the old potrace knobs are gone',
    !/id="img-turd"/.test(html) && !/id="img-optcurve"/.test(html));
  check('app.js reads the knobs into one options object',
    /function traceOptionsFromDialog\(\)/.test(appSrc) && /detail: num\('img-detail'/.test(appSrc));
  check('app.js draws a preview', /function drawTracePreview\(/.test(appSrc));
  check('the preview is debounced', /function scheduleTracePreview\(/.test(appSrc));
  check('changing a setting redraws the preview',
    /scheduleTracePreview\(ui\.imageDraft\.blob\)/.test(appSrc));
  check('the dialog opens with a preview drawn',
    /drawTracePreview\(blob, traceOptionsFromDialog\(\)\)/.test(appSrc));
  check('the settings are remembered', /localStorage\.setItem\(IMG_OPTS_KEY/.test(appSrc));
  check('the remembered settings include the new knobs',
    /speckle: traceOpts\.speckle/.test(appSrc) && /threshold: traceOpts\.threshold/.test(appSrc));
  check('the trace runs on the original pixels at full resolution',
    /artFromBlob\(d\.blob, \{[\s\S]{0,400}?mmPerUnit: width/.test(appSrc));
}

// ---- the preview-affecting knobs are sliders ------------------------------
console.log('\n== the knobs that drive the preview are sliders ==');
{
  const SLIDERS = ['img-detail', 'img-curve', 'img-speckle', 'img-threshold', 'img-blur', 'img-tol'];
  for (const id of SLIDERS) {
    const re = new RegExp('<input[^>]*id="' + id + '"[^>]*>');
    const m = re.exec(html);
    check(id + ' is a range slider', !!m && /type="range"/.test(m[0]), m ? m[0] : 'not found');
    check(id + ' has a number box beside it', html.indexOf('id="' + id + '-n"') >= 0);
  }
  // the value of record is the number box; the slider is the fast way to it
  check('the value is read from the number box',
    /const box = el\(id \+ '-n'\)/.test(appSrc));
  check('an empty number box falls back to the slider',
    /parseFloat\(el\(id\) \? el\(id\)\.value : ''\)/.test(appSrc));
  check('the slider writes into the number box', /n\.value = s\.value/.test(appSrc));
  check('the number box moves the slider', /s\.value = String\(Math\.max\(lo, Math\.min\(hi, v\)\)\)/.test(appSrc));
  check('both are wired by one helper', /function bindTraceSlider\(/.test(appSrc));
  check('every slider is bound',
    /for \(const id of \['img-detail', 'img-curve', 'img-speckle', 'img-threshold',\s*\n\s*'img-blur', 'img-tol'\]\)/.test(appSrc));
  check('the number box selects its content on focus',
    /n\.addEventListener\('focus', \(\) => n\.select\(\)\)/.test(appSrc));
  check('a remembered value goes into both slider and number box',
    /function setTraceValue\(/.test(appSrc) && /setTraceValue\(id,/.test(appSrc));
}

// ---- the settings are remembered for the next open -----------------------
console.log('\n== the settings survive until the next open ==');
{
  check('there is a save helper', /function saveTracePrefs\(/.test(appSrc));
  check('saving happens as the setting changes, not only on OK',
    /saveTracePrefs\(\);\s*\n\s*if \(ui\.imageDraft/.test(appSrc));
  check('the save keeps the other remembered fields',
    /\.\.\.saved,/.test(appSrc));
  check('every trace knob is written down',
    /detail: o\.detail, curve: o\.curve, speckle: o\.speckle,/.test(appSrc) &&
    /threshold: o\.threshold, blur: o\.blur, corners: o\.corners,/.test(appSrc));
  check('the simplify tolerance is written down', /tol: o\.simplify/.test(appSrc));
  check('the checkboxes are written down', /smooth: o\.smooth, tol: o\.simplify, fitCurve: o\.fitCurve/.test(appSrc));
  check('opening the dialog restores the remembered values',
    /numOr\('img-detail', 'detail', 2\)/.test(appSrc) &&
    /numOr\('img-threshold', 'threshold', 128\)/.test(appSrc));
}

// ---- the preview shows what the import will produce -----------------------
console.log('\n== the preview matches the import ==');
{
  check('the import and the preview share the thinning step',
    /function simplifyTracedPaths\(/.test(appSrc));
  check('insertArt uses the shared helper',
    /simplifyTracedPaths\(paths, o\.simplify, 2\)/.test(appSrc));
  check('the preview uses it too',
    /simplifyTracedPaths\(subs, opts\.simplify, 2\)/.test(appSrc));
  check('the preview counts the contours it will really get',
    /info\.textContent = loops\.length \+ ' contour'/.test(appSrc));
  check('the preview reports the point count too',
    /points \+ ' point'/.test(appSrc));
}

// ---- the panel is laid out so nothing is wasted -------------------------
console.log('\n== the panel has no wasted space ==');
{
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  // the pixel width a css rule asks for, or 0 when the rule is not there
  const cssWidth = (re) => {
    const m = re.exec(css);
    return m ? parseInt(m[1], 10) : 0;
  };
  // the trace dialog must not borrow the generator dialogs' width class:
  // nine tools use wide-cols and their two-column layout is tuned for it
  check('the trace dialog does not use wide-cols', !/class="modal-box wide-cols"[\s\S]{0,200}img-preview/.test(html));
  check('the trace dialog has its own box class', /class="modal-box trace-box"/.test(html));
  const boxW = cssWidth(/\.trace-box \{[\s\S]{0,120}?min\((\d+)px/);
  check('the trace box is wider than the generator box', boxW > 560, boxW);
  // the settings column must win over the shared .modal-cols .opt-col width,
  // so the sliders get a track worth dragging
  const colW = cssWidth(/\.modal-cols \.opt-col\.trace-opts \{[\s\S]{0,160}?width: (\d+)px/);
  check('the settings column beats the shared 200px rule', colW > 200, colW);
  const prevW = cssWidth(/\.trace-preview \{[\s\S]{0,160}?width: (\d+)px/);
  check('the preview column got wider too', prevW > 260, prevW);
  // the two columns plus the gap must fit inside the box
  check('the columns fit the box', prevW + colW + 16 + 36 <= boxW,
    prevW + '+' + colW + '+16+36 vs ' + boxW);
  check('the preview is sized to the settings column',
    /function sizeTracePreview\(/.test(appSrc) &&
    /canvas\.style\.height = h \+ 'px'/.test(appSrc));
  check('the preview is sized when the dialog opens',
    /sizeTracePreview\(\);\s*\n\s*resetPreviewView\(\);\s*\n\s*resetPreviewRefs\(\);[^\n]*\n\s*bindPreviewNav\(\);\s*\n\s*bindRefControls\(\);\s*\n\s*drawTracePreview\(blob/.test(appSrc));
  check('the preview follows a window resize',
    /window\.addEventListener\('resize'[\s\S]{0,300}?sizeTracePreview\(\)/.test(appSrc));
  check('the canvas is sharp on a hi-dpi screen',
    /window\.devicePixelRatio/.test(appSrc) && /ctx\.setTransform\(dpr, 0, 0, dpr, 0, 0\)/.test(appSrc));
  check('the picture keeps its aspect ratio in the box',
    /const fit = Math\.min\(cw \/ iw, ch \/ ih\)/.test(appSrc));
  // pan + zoom: the preview of a big picture is only inspectable zoomed in
  check('the preview can zoom (wheel)',
    /canvas\.addEventListener\('wheel'/.test(appSrc) && /previewView\.zoom/.test(appSrc));
  check('the preview can pan (drag)',
    /pointerdown/.test(appSrc) && /previewView\.px \+= dx/.test(appSrc));
  check('double-click resets the view',
    /dblclick/.test(appSrc) && /function resetPreviewView\(/.test(appSrc));
  check('every traced point is drawn as a dot',
    /every node as a dot/.test(appSrc) && /ctx\.arc\(x, y, rDot/.test(appSrc));
  check('the view survives a setting change (redraw keeps zoom)',
    /const view = previewView;/.test(appSrc));
  // snap points: a hand-set corner correction, applied to the SAME loops OK imports
  check('the preview shows the post-processed raster (threshold + blur)',
    /T\.processedImageData\(blob, opts\)/.test(appSrc));
  check('the tracer exposes processedImageData',
    /NS\.processedImageData = processedImageData/.test(traceSrc));
  check('double-click adds a snap point (single click does nothing)',
    /double-click = ADD a snap point there/.test(appSrc) && /previewRefs\.push\(/.test(appSrc));
  check('a snap point can be dragged (move) and its radius resized',
    /refDrag\.mode === 'move'/.test(appSrc) && /refDrag\.mode === 'radius'/.test(appSrc));
  check('double-click on a snap point removes it',
    /previewRefs\.splice\(previewRefs\.indexOf\(hit\.ref\), 1\)/.test(appSrc));
  check('a Clear button empties the snap points',
    /id="img-refs-clear"/.test(html) && /previewRefs = \[\];/.test(appSrc));
  check('snap points are lost when a new picture opens',
    /resetPreviewRefs\(\);/.test(appSrc));
  check('the snap pull is applied on the OK path too',
    /insertArt\(applyRefsToLoops\(simplifyTracedPaths\(paths, opts\.simplify, 2\)\), opts\)/.test(appSrc));
  // the pull must derive from the ORIGINAL points every time (dx/dy), not
  // mutate them: a deleted reference must restore the traced shape, and a
  // repaint must not compound the pull
  check('applyRefsToLoops copies the points (no in-place mutation)',
    /const out = loops\.map\(l => l\.map\(p => \[p\[0\], p\[1\]\]\)\);/.test(appSrc));
  check('the pull is recomputed from the original position each call',
    /pt\[0\] \+= \(ref\.x - pt\[0\]\) \* pull;/.test(appSrc) && /loops\.map\(l => l\.map/.test(appSrc));
}

// ---- duplicate contours (double outlines) are collapsed ------------------
console.log('\n== duplicate contours (the alternating double outlines) are collapsed ==');
{
  // Mimic ImageTracerJS output for a concentric target: every interior (hole)
  // boundary arrives twice — once as the parent ring's hole subpath and once
  // as a standalone path — sampled at different vertices. The old behaviour
  // stroked both copies, producing a double line on alternating nesting levels.
  const circle = (cx, cy, r, n, phase) => {
    const pts = [];
    for (let k = 0; k < n; k++) {
      const t = (k / n) * Math.PI * 2 + (phase || 0);
      pts.push([Math.round((cx + r * Math.cos(t)) * 10) / 10,
        Math.round((cy + r * Math.sin(t)) * 10) / 10]);
    }
    return pts;
  };
  const cx = 64, cy = 64;
  const loops = [
    circle(cx, cy, 57, 40),        // outer boundary of ring A
    circle(cx, cy, 48, 32),        // hole of ring A
    circle(cx, cy, 48, 36, 0.13), // SAME hole, resampled (duplicate)
    circle(cx, cy, 38, 28),        // outer boundary of ring B
    circle(cx, cy, 28, 24),        // hole of ring B
    circle(cx, cy, 28, 20, 0.41), // SAME hole, resampled (duplicate)
    circle(cx, cy, 18, 16)         // centre disk
  ];

  check('contourSignature reports the centroid',
    (() => {
      const s = T.contourSignature(circle(cx, cy, 48, 32));
      return Math.abs(s.cx - cx) < 0.5 && Math.abs(s.cy - cy) < 0.5;
    })());
  check('contourSignature reports the area',
    (() => {
      const s = T.contourSignature(circle(cx, cy, 48, 32));
      return Math.abs(s.area - Math.PI * 48 * 48) / (Math.PI * 48 * 48) < 0.02;
    })());
  check('two samplings of the same hole are treated as one contour',
    (() => {
      const a = T.contourSignature(circle(cx, cy, 48, 32));
      const b = T.contourSignature(circle(cx, cy, 48, 36, 0.13));
      return T.similarContour(a, b);
    })());
  check('the outer edge and its hole stay distinct',
    (() => {
      const a = T.contourSignature(circle(cx, cy, 57, 40));
      const b = T.contourSignature(circle(cx, cy, 48, 32));
      return !T.similarContour(a, b);
    })());
  check('a thin wall is not merged away',
    (() => {
      const a = T.contourSignature(circle(cx, cy, 50, 40)); // outer of a thin ring
      const b = T.contourSignature(circle(cx, cy, 47, 40)); // its hole
      return !T.similarContour(a, b);
    })());

  const deduped = T.dedupeContours(loops);
  check('dedupeContours drops the repeated hole copies',
    deduped.length === 5, 'got ' + deduped.length + ' contours');
  check('the five distinct boundaries all survive',
    (() => {
      const radii = deduped.map(l => {
        const s = T.contourSignature(l);
        return Math.round(Math.sqrt(s.area / Math.PI));
      }).sort((a, b) => a - b);
      return JSON.stringify(radii) === JSON.stringify([18, 28, 38, 48, 57]);
    })());
}

function finish() {
  console.log('\n' + (fail ? fail + ' FAILED, ' + pass + ' checks passed' : 'all ' + pass + ' checks passed'));
  process.exit(fail ? 1 : 0);
}
