// MiniSketch raster-trace Web Worker.
//
// Runs the heavy ImageTracerJS run (color quantization + path tracing) off the
// main thread so a full-resolution import does not freeze the UI. The main
// thread already decoded and binarised the image (toImageData) and mapped the
// app-facing options to ImageTracer's own `iopts` — this worker only receives
// the binarised RGBA pixels and the ready iopts, runs the tracer, and posts
// back the foreground-only SVG string.
//
// Contract:
//   in:  { data: Uint8ClampedArray (transferred), width, height, iopts }
//   out: { svg, paths, width, height } | { error }
//
// The output shape matches window.MiniSketchTrace.trace() exactly, so the
// worker and the synchronous fallback produce identical results.
importScripts('imagetracer.js');

self.onmessage = function (e) {
  var msg = e.data || {};
  try {
    var data = msg.data;
    var width = msg.width, height = msg.height;
    var iopts = msg.iopts || {};
    var IT = self.ImageTracer;
    if (!IT || typeof IT.imagedataToTracedata !== 'function') {
      throw new Error('tracer library is missing');
    }
    // The tracer only reads imgd.width / imgd.height / imgd.data, so a plain
    // object is enough (no need to rebuild a full ImageData, which would copy
    // the transferred buffer).
    var imgd = { width: width, height: height, data: data };
    var td = IT.imagedataToTracedata(imgd, iopts);
    // Foreground only: layer 0 is the dark (shape) layer because the palette
    // lists black first; the white page-background layer is dropped on purpose.
    var dark = td.layers && td.layers[0] ? td.layers[0] : [];
    var parts = [];
    for (var p = 0; p < dark.length; p++) {
      var s = IT.svgpathstring(td, 0, p, iopts);
      if (s) parts.push(s);
    }
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width +
      '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height +
      '">' + parts.join('') + '</svg>';
    self.postMessage({ svg: svg, paths: parts.length, width: width, height: height });
  } catch (err) {
    self.postMessage({ error: String(err && err.stack || err) });
  }
};
