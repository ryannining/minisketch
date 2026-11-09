// Shared serialization for the nesting Web Worker. Runs in the browser (as a
// global, loaded via importScripts) and under Node (module.exports) so the
// worker core can be exercised by probes.
//
// The worker receives the engine *entries* (built by nestBuildEntries on the
// main thread) as plain data: each variant is its aligned/rotated GEOM-space
// rings. It rebuilds MiniSketchNest.Path objects, runs the GA, and returns a
// plain placement list (originIndex + variantIdx + bounds) that the app can
// feed straight into nestApplyResult.
(function (root) {
  'use strict';

  function serializeEntries(entries) {
    return (entries || []).map(function (entry) {
      return {
        originIndex: entry.originIndex,
        lcolor: entry.lcolor != null ? entry.lcolor : null,
        childIndex: (entry.childIndex || []).slice(),
        variants: (entry.variants || []).map(function (v) {
          return {
            rings: (v.paths || []).map(function (ring) {
              return ring.map(function (p) { return [p.x, p.y]; });
            })
          };
        })
      };
    });
  }

  function deserializeEntries(data) {
    var NW = root.MiniSketchNest;
    return (data || []).map(function (entry) {
      var variants = (entry.variants || []).map(function (v) {
        var rings = (v.rings || []).map(function (ring) {
          return ring.map(function (pt) { return new NW.Point(pt[0], pt[1]); });
        });
        return new NW.Path(rings, entry.originIndex, null, entry.lcolor != null ? entry.lcolor : null);
      });
      return {
        originIndex: entry.originIndex,
        lcolor: entry.lcolor,
        childIndex: entry.childIndex,
        variants: variants
      };
    });
  }

  // Plain result the worker returns: placements + the block bounds. nestApplyResult
  // needs p.getBounds() / p.originIndex / p._variantIdx / p.lcolor — the app wraps
  // each placement with a getBounds() that returns `.bounds`.
  function buildWorkerResult(ga, res) {
    var n = ga.calculateTotalBounds(res.placements);
    var placements = (res.placements || []).map(function (p) {
      var g = p.getBounds();
      return {
        originIndex: p.originIndex,
        lcolor: p.lcolor,
        _variantIdx: p._variantIdx != null ? p._variantIdx : 0,
        bounds: { x: g.x, y: g.y, width: g.width, height: g.height }
      };
    });
    return {
      placements: placements,
      blockBounds: { x: n.x, y: n.y, width: n.width, height: n.height },
      blockW: n.width / root.MiniSketchNest.GEOM_SCALE,
      blockH: n.height / root.MiniSketchNest.GEOM_SCALE,
      unplaced: res.unplaced,
      cancelled: !!res.cancelled,
      fitness: res.fitness,
      stats: res.stats
    };
  }

  var api = { serializeEntries: serializeEntries, deserializeEntries: deserializeEntries, buildWorkerResult: buildWorkerResult };
  root.NestIO = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})((function () { return typeof self !== 'undefined' ? self : globalThis; })());
