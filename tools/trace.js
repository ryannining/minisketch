/*
 * MiniSketch raster tracer — ImageTracerJS based.
 *
 * Why this file exists
 * --------------------
 * The old tracer was tools/Potrace.js (Peter Selinger's potrace port), which
 * is GPL. That made a closed-source distribution impossible: a combined work
 * containing GPL code must itself be GPL. ImageTracerJS is Unlicense /
 * public domain, so the same job can be shipped inside a proprietary product.
 *
 * What it does
 * ------------
 * ImageTracerJS quantises the raster into a palette and traces EVERY colour
 * region. For a laser cutter that is wrong: the white background would come
 * back as a giant rectangle and the cutter would try to cut it. So this
 * wrapper binarises the source (dark = shape, light = background) and keeps
 * only the dark layer — the silhouette the user actually wants to cut.
 *
 * Contract (registered on window.MiniSketchTrace)
 * -----------------------------------------------
 *   toImageData(blob)      -> Promise<ImageData>     decode + binarise
 *   trace(imageData, opts) -> Promise<{svg, paths}>   foreground-only SVG
 *   options for both are described in OPTION_DEFAULTS below.
 *
 * Loaded as a plain <script> (no build step, no modules) like the other
 * files in tools/.
 */
(() => {
  'use strict';

  const NS = window.MiniSketchTrace = window.MiniSketchTrace || {};

  // ---- option defaults ---------------------------------------------------
  // The names are the app-facing ones (the image dialog speaks these), not
  // ImageTracerJS's own names. The mapping lives in traceOptions().
  const OPTION_DEFAULTS = {
    detail: 2,        // straight-line error threshold (ImageTracerJS ltres)
    curve: 1,         // quadratic error threshold (qtres)
    speckle: 8,       // drop paths shorter than this (pathomit)
    threshold: 128,   // 0-255 luminance cut between shape and background
    blur: 0,          // 0-5 selective blur before tracing
    corners: true,    // keep right-angle corners (rightangleenhance)
    smooth: true      // drop 2-point noise segments (linefilter)
  };

  const OPTION_LIMITS = {
    detail: [0.01, 20, 0.1],
    curve: [0.01, 20, 0.1],
    speckle: [0, 200, 1],
    threshold: [0, 255, 1],
    blur: [0, 5, 1],
    corners: [null, null, null],
    smooth: [null, null, null]
  };

  function clampNum(v, lo, hi, def) {
    const n = +v;
    if (!isFinite(n)) return def;
    return Math.max(lo, Math.min(hi, n));
  }

  // Normalise whatever the caller passed into a full, in-range option set.
  function normalizeOptions(opts) {
    const o = opts || {};
    const out = {};
    for (const key of Object.keys(OPTION_DEFAULTS)) {
      const def = OPTION_DEFAULTS[key];
      const lim = OPTION_LIMITS[key];
      if (typeof def === 'boolean') {
        out[key] = o[key] === undefined ? def : !!o[key];
      } else {
        const raw = o[key] === undefined ? def : +o[key];
        out[key] = clampNum(raw, lim[0], lim[1], def);
      }
    }
    return out;
  }

  // The ImageTracerJS option object. Two colours only (black + white) so the
  // quantiser cannot invent mid-tones: the binarisation already decided what
  // is shape and what is background.
  function traceOptions(o) {
    return {
      ltres: o.detail,
      qtres: o.curve,
      pathomit: o.speckle,
      rightangleenhance: o.corners,
      linefilter: o.smooth,
      blurradius: o.blur,
      blurdelta: 20,
      colorsampling: 0,
      numberofcolors: 2,
      layering: 0,
      strokewidth: 0,
      scale: 1,
      roundcoords: 2,
      viewbox: false,
      desc: false,
      pal: [
        { r: 0, g: 0, b: 0, a: 255 },
        { r: 255, g: 255, b: 255, a: 255 }
      ]
    };
  }

  // ---- decode + binarise -------------------------------------------------

  // Load a blob into an <img> and paint it to a canvas, so we can read the
  // pixels. The browser does the decoding (PNG/JPEG/WEBP all work).
  function blobToImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('image could not be decoded'));
      };
      img.src = url;
    });
  }

  // Binarise into a fresh ImageData: pixels at or above the threshold become
  // white (background), the rest become black (shape). Working on a copy
  // keeps the caller's ImageData untouched.
  function binarize(src, threshold) {
    const w = src.width, h = src.height;
    const out = new ImageData(w, h);
    const sd = src.data, od = out.data;
    const cut = clampNum(threshold, 0, 255, 128);
    for (let i = 0; i < sd.length; i += 4) {
      // Rec. 601 luma — the same weighting the eye uses, so a saturated blue
      // counts as dark even when its green+blue channels are high.
      const luma = 0.299 * sd[i] + 0.587 * sd[i + 1] + 0.114 * sd[i + 2];
      const dark = luma < cut ? 0 : 255;
      od[i] = dark; od[i + 1] = dark; od[i + 2] = dark; od[i + 3] = 255;
    }
    return out;
  }

  // Decode a blob straight into a binarised ImageData.
  async function toImageData(blob, opts) {
    const o = normalizeOptions(opts);
    const img = await blobToImage(blob);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) throw new Error('image has no size');
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const raw = ctx.getImageData(0, 0, w, h);
    return binarize(raw, o.threshold);
  }

  // ---- trace -------------------------------------------------------------

  // The tracer library. ImageTracerJS installs itself on `self` (the browser
  // global) when loaded as a plain script, but a CommonJS/AMD loader puts it
  // somewhere else — look in both places so the module works in the app and
  // in the headless probes.
  function tracerLib() {
    if (typeof window !== 'undefined' && window.ImageTracer) return window.ImageTracer;
    if (typeof self !== 'undefined' && self.ImageTracer) return self.ImageTracer;
    if (typeof globalThis !== 'undefined' && globalThis.ImageTracer) return globalThis.ImageTracer;
    return null;
  }

  // Trace a binarised ImageData and return the FOREGROUND ONLY as an SVG
  // string plus the raw path data.
  //
  // ImageTracerJS returns one layer per palette colour. Layer 0 is the dark
  // one because the palette lists black first; the white layer (the page
  // background) is dropped on purpose — cutting it would cut the whole sheet.
  async function trace(imageData, opts) {
    const o = normalizeOptions(opts);
    const IT = tracerLib();
    if (!IT || typeof IT.imagedataToTracedata !== 'function') {
      throw new Error('tracer library is missing');
    }
    const iopts = traceOptions(o);
    const td = IT.imagedataToTracedata(imageData, iopts);
    const dark = td.layers && td.layers[0] ? td.layers[0] : [];
    const parts = [];
    for (let p = 0; p < dark.length; p++) {
      const s = IT.svgpathstring(td, 0, p, iopts);
      if (s) parts.push(s);
    }
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + imageData.width +
      '" height="' + imageData.height + '" viewBox="0 0 ' + imageData.width + ' ' + imageData.height +
      '">' + parts.join('') + '</svg>';
    return { svg, paths: parts.length, width: imageData.width, height: imageData.height };
  }

  // Convenience: blob in, foreground SVG out.
  async function traceBlob(blob, opts) {
    const imgd = await toImageData(blob, opts);
    return trace(imgd, opts);
  }

  // ---- worker offload ------------------------------------------------------
  // The full-resolution trace is the one heavy, synchronous stretch in the
  // import path. Run it in a Worker (tools/trace_worker.js) so a big image does
  // not freeze the UI. The worker receives the binarised RGBA pixels plus the
  // ready ImageTracer `iopts` and returns the same { svg, paths, width, height }
  // the synchronous trace() produces. Returns null when Workers are unavailable
  // (e.g. some file:// setups / the Node probes) or the worker failed to load,
  // so the caller can fall back to the synchronous tracer.
  function runTraceInWorker(imageData, iopts) {
    if (typeof Worker === 'undefined') return Promise.resolve(null);
    return new Promise((resolve) => {
      let w;
      try { w = new Worker('tools/trace_worker.js'); }
      catch (e) { return resolve(null); }
      const done = (val) => {
        try { w.terminate(); } catch (e) { /* ignore */ }
        resolve(val);
      };
      w.onerror = () => done(null);
      w.onmessage = (e) => {
        const d = e.data || {};
        if (d.error) return done(null);
        done({ svg: d.svg, paths: d.paths, width: d.width, height: d.height });
      };
      try {
        w.postMessage({
          data: imageData.data,
          width: imageData.width,
          height: imageData.height,
          iopts: iopts
        }, [imageData.data.buffer]);
      } catch (e) { done(null); }
    });
  }

  // Full-resolution trace, worker-first, falling back to the synchronous tracer.
  async function traceBlobInWorker(blob, opts) {
    const o = normalizeOptions(opts);
    const iopts = traceOptions(o);
    const imgd = await toImageData(blob, o);
    const wr = await runTraceInWorker(imgd, iopts);
    if (wr) return wr;
    // Worker unavailable/failed: the buffer may have been transferred away, so
    // re-decode and trace synchronously (decode is cheap; only the tracer is
    // expensive).
    const imgd2 = await toImageData(blob, o);
    return trace(imgd2, o);
  }

  // ---- duplicate-contour removal -----------------------------------------

  // ImageTracerJS emits every interior (hole) boundary of an annular region
  // TWICE: once as the hole subpath inside the parent ring's composite path,
  // and once again as a standalone path. Because the two copies are sampled
  // at different vertices, stroking both draws two near-parallel lines — the
  // "double outline" seen on nested shapes. These helpers fingerprint a
  // contour and identify that extra copy so it can be dropped.
  //
  // A contour is collapsed onto a few size/location invariants (centroid,
  // bounding box, area). Two contours are the "same boundary" when those
  // match within a small relative tolerance. Genuinely different boundaries
  // (e.g. a ring's outer edge vs its hole) always differ in area enough to
  // stay distinct, so a thin wall is never merged away.
  function contourSignature(loop) {
    let sx = 0, sy = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of loop || []) {
      sx += p[0]; sy += p[1];
      if (p[0] < x0) x0 = p[0];
      if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[1] > y1) y1 = p[1];
    }
    const n = (loop && loop.length) || 0;
    let a = 0;
    for (let i = 0; i < n; i++) {
      const p = loop[i], q = loop[(i + 1) % n];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return { cx: n ? sx / n : 0, cy: n ? sy / n : 0, w: x1 - x0, h: y1 - y0, area: Math.abs(a) / 2 };
  }

  function similarContour(A, B) {
    const size = Math.max(A.w, A.h, B.w, B.h, 1e-9);
    if (size <= 0) return true;
    if (Math.hypot(A.cx - B.cx, A.cy - B.cy) > 0.06 * size) return false;
    if (Math.abs(A.w - B.w) > 0.06 * size) return false;
    if (Math.abs(A.h - B.h) > 0.06 * size) return false;
    const am = Math.max(A.area, B.area, 1e-9);
    if (Math.abs(A.area - B.area) / am > 0.06) return false;
    return true;
  }

  // Keep the first of any co-located cluster of contours; drop the rest.
  function dedupeContours(loops) {
    const seen = [];
    const out = [];
    for (const loop of loops || []) {
      if (!loop || loop.length < 3) continue;
      const sig = contourSignature(loop);
      if (seen.some(s => similarContour(sig, s))) continue;
      seen.push(sig);
      out.push(loop);
    }
    return out;
  }

  NS.OPTION_DEFAULTS = OPTION_DEFAULTS;
  NS.OPTION_LIMITS = OPTION_LIMITS;
  NS.normalizeOptions = normalizeOptions;
  NS.traceOptions = traceOptions;
  NS.binarize = binarize;
  NS.blobToImage = blobToImage;
  NS.toImageData = toImageData;
  NS.trace = trace;
  NS.traceBlob = traceBlob;
  NS.runTraceInWorker = runTraceInWorker;
  NS.traceBlobInWorker = traceBlobInWorker;
  NS.contourSignature = contourSignature;
  NS.similarContour = similarContour;
  NS.dedupeContours = dedupeContours;
})();
