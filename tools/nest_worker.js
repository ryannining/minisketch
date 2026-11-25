// Nesting Web Worker: runs True NFP/IFP + GA search off the main thread.
// Supports both one-shot runs (single or multi-sheet) AND continuous infinite
// mode with a persistent warm NFPCache across iterations + island seed sharing.
//
// Protocol:
//   -> { jobId, input }                          (one-shot or infinite start)
//   -> { cmd: 'start', jobId, input }            (explicit start)
//   -> { cmd: 'seed',  jobId, seed }             (island migration from sibling worker)
//   -> { cmd: 'stop',  jobId }                   (graceful cancel; emits best-so-far)
//
//   <- { type: 'progress', jobId, done, total, iter }
//   <- { type: 'best',     jobId, iter, result } (infinite live improvement)
//   <- { type: 'result',   jobId, result }       (final result)
//   <- { type: 'error',    jobId, error }
importScripts('clipper.js', 'nest.js', 'nest_io.js');

var _active = null;

function _isBetterResult(cand, best) {
  if (!best) return true;
  var cPlaced = cand.totalPlaced != null ? cand.totalPlaced : 0;
  var bPlaced = best.totalPlaced != null ? best.totalPlaced : 0;
  if (cPlaced !== bPlaced) return cPlaced > bPlaced;
  var cSheets = (cand.sheets && cand.sheets.length) || 1;
  var bSheets = (best.sheets && best.sheets.length) || 1;
  if (cSheets !== bSheets) return cSheets < bSheets;
  if (isFinite(cand.fitness) && isFinite(best.fitness)) {
    return cand.fitness < best.fitness - 1e-6;
  }
  return (cand.blockW * cand.blockH) < (best.blockW * best.blockH);
}

function _startIteration(run) {
  var NW = self.MiniSketchNest;
  var input = run.input;
  var ga = new NW.NFPGA();
  ga.setSpacing(input.spacing || 0);
  ga.setAllowFlip(!!input.flip);
  ga.setGAParams(input.popSize, input.generations, input.mutation);
  if (input.ls != null) ga.localSearchBudget = input.ls;
  if (input.maxVerts != null) ga.maxVerts = input.maxVerts;
  ga.nfpCache = run.nfpCache;

  var sheetCount = 0;
  for (var i = 0; i < run.entries.length; i++) {
    if (run.entries[i].lcolor === '#00ff00') sheetCount++;
  }
  var isFiniteSheets = !!input.finiteSheets || sheetCount > 1;
  var useMulti = !!input.multiSheet || isFiniteSheets;
  var opts = {
    nfpCache: run.nfpCache,
    multiSheet: !!input.multiSheet,
    finiteSheets: isFiniteSheets,
    shouldCancel: function () { return run.stopped; }
  };
  var seed = run.pendingSeed || run.bestSeed;
  if (seed && Array.isArray(seed.order)) {
    opts.seedOrder = {
      order: seed.order.slice(),
      rots: Array.isArray(seed.rots) ? seed.rots.slice() : null
    };
  }
  run.pendingSeed = null;
  run.ga = ga;
  run.gen = useMulti
    ? ga.findBestMultiSheetGen(run.entries, { width: 1, height: 1 }, input.grid, opts)
    : ga.findBestPositionGen(run.entries, { width: 1, height: 1 }, input.grid, opts);
}

function _tick(run) {
  if (_active !== run) return;
  try {
    var sliceStart = Date.now();
    for (;;) {
      var n = run.gen.next();
      if (n.done) {
        var wrapped = self.NestIO.buildWorkerResult(run.ga, n.value);
        if (_isBetterResult(wrapped, run.bestResult)) {
          run.bestResult = wrapped;
          if (wrapped.bestOrder) run.bestSeed = wrapped.bestOrder;
          if (run.infinite) {
            self.postMessage({ type: 'best', jobId: run.jobId, iter: run.iter, result: wrapped });
          }
        }
        if (!run.infinite || run.stopped) {
          var finalRes = run.bestResult || wrapped;
          if (run.stopped) finalRes.cancelled = true;
          _active = null;
          self.postMessage({ type: 'result', jobId: run.jobId, result: finalRes });
          return;
        }
        // Infinite mode: immediately start next iteration with the SAME warm NFPCache
        run.iter++;
        _startIteration(run);
        setTimeout(function () { _tick(run); }, 0);
        return;
      }
      var now = Date.now();
      if (now - run.lastProg > 35) {
        run.lastProg = now;
        self.postMessage({
          type: 'progress',
          jobId: run.jobId,
          done: n.value.done,
          total: n.value.total,
          iter: run.iter
        });
      }
      // Yield every ~16ms so incoming 'stop' or 'seed' messages are handled promptly
      if (now - sliceStart >= 16) {
        setTimeout(function () { _tick(run); }, 0);
        return;
      }
    }
  } catch (err) {
    _active = null;
    self.postMessage({ type: 'error', jobId: run.jobId, error: String(err && err.stack || err) });
  }
}

self.onmessage = function (e) {
  var msg = e.data || {};
  var cmd = msg.cmd || 'start';

  if (cmd === 'stop') {
    if (_active && (!msg.jobId || _active.jobId === msg.jobId)) {
      _active.stopped = true;
    }
    return;
  }

  if (cmd === 'seed') {
    if (_active && (!msg.jobId || _active.jobId === msg.jobId) && msg.seed) {
      _active.pendingSeed = msg.seed;
    }
    return;
  }

  // 'start' (or legacy message with { jobId, input })
  var NW = self.MiniSketchNest;
  try {
    var input = msg.input || {};
    var entries = self.NestIO.deserializeEntries(input.entriesData);
    var cache = new NW.NFPCache({ maxVerts: input.maxVerts || 56 });
    var run = {
      jobId: msg.jobId,
      input: input,
      entries: entries,
      nfpCache: cache,
      infinite: !!input.infinite,
      stopped: false,
      iter: 1,
      bestResult: null,
      bestSeed: input.seed || null,
      pendingSeed: null,
      lastProg: 0,
      ga: null,
      gen: null
    };
    _active = run;
    _startIteration(run);
    _tick(run);
  } catch (err) {
    _active = null;
    self.postMessage({ type: 'error', jobId: msg.jobId, error: String(err && err.stack || err) });
  }
};
