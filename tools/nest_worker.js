// Nesting Web Worker: runs one full GA search off the main thread.
//
// The app loads this as a dedicated Worker ('tools/nest_worker.js'). It
// importScripts the engine (nest.js) and the shared io helpers (nest_io.js),
// receives serialized entries + params, and posts:
//   { type:'progress', jobId, done, total }   (throttled)
//   { type:'result',   jobId, result }        (placements + blockBounds)
//   { type:'error',    jobId, error }
importScripts('nest.js', 'nest_io.js');

self.onmessage = function (e) {
  var msg = e.data || {};
  var jobId = msg.jobId;
  var input = msg.input || {};
  var NW = self.MiniSketchNest;
  try {
    var entries = self.NestIO.deserializeEntries(input.entriesData);
    var ga = new NW.NFPGA();
    ga.setSpacing(input.spacing || 0);
    ga.setAllowFlip(!!input.flip);
    ga.setGAParams(input.popSize, input.generations, input.mutation);
    if (input.ls != null) ga.localSearchBudget = input.ls;
    var opts = {};
    if (input.seed && Array.isArray(input.seed.order)) {
      opts.seedOrder = { order: input.seed.order.slice(), rots: Array.isArray(input.seed.rots) ? input.seed.rots.slice() : null };
    }
    var gen = ga.findBestPositionGen(entries, { width: 1, height: 1 }, input.grid, opts);
    var last = 0;
    for (;;) {
      var n = gen.next();
      if (n.done) {
        self.postMessage({ type: 'result', jobId: jobId, result: self.NestIO.buildWorkerResult(ga, n.value) });
        return;
      }
      var now = Date.now();
      if (now - last > 25) {
        last = now;
        self.postMessage({ type: 'progress', jobId: jobId, done: n.value.done, total: n.value.total });
      }
    }
  } catch (err) {
    self.postMessage({ type: 'error', jobId: jobId, error: String(err && err.stack || err) });
  }
};
