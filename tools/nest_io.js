// Shared serialization for the nesting Web Worker. Runs in the browser (as a
// global, loaded via importScripts) and under Node (module.exports) so the
// worker core can be exercised by probes.
//
// The worker receives the engine *entries* (built by nestBuildEntries on the
// main thread) as plain data: each variant is its aligned/rotated GEOM-space
// rings. It rebuilds MiniSketchNest.Path objects, runs the GA (single or
// multi-sheet), and returns plain placement lists (originIndex + variantIdx +
// bounds) that the app feeds into nestApplyResult.
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

  function serializePlacements(list) {
    return (list || []).map(function (p) {
      var g = p.getBounds();
      return {
        originIndex: p.originIndex,
        lcolor: p.lcolor,
        _variantIdx: p._variantIdx != null ? p._variantIdx : 0,
        bounds: { x: g.x, y: g.y, width: g.width, height: g.height }
      };
    });
  }

  // Plain result the worker returns: placements + blockBounds + optional multi-sheet
  // breakdown + utilization + bestOrder seed (for island migration in infinite mode).
  function buildWorkerResult(ga, res) {
    var GEOM = root.MiniSketchNest.GEOM_SCALE;
    var placements = serializePlacements(res.placements);
    var n = ga.calculateTotalBounds(res.placements);
    var sheets = null;
    if (Array.isArray(res.sheets) && res.sheets.length > 0) {
      sheets = res.sheets.map(function (s, idx) {
        var sb = s.blockBounds || ga.calculateTotalBounds(s.placements);
        return {
          sheetIndex: s.sheetIndex != null ? s.sheetIndex : idx,
          sheetOriginIndex: s.sheetOriginIndex != null ? s.sheetOriginIndex : 0,
          placements: serializePlacements(s.placements),
          blockBounds: { x: sb.x, y: sb.y, width: sb.width, height: sb.height },
          blockW: sb.width / GEOM,
          blockH: sb.height / GEOM,
          placedCount: s.placedCount != null ? s.placedCount :
            (s.placements || []).filter(function (p) { return p.lcolor !== '#00ff00'; }).length,
          utilization: s.utilization || 0
        };
      });
    }
    var totalPlaced = res.totalPlaced != null
      ? res.totalPlaced
      : placements.filter(function (p) { return p.lcolor !== '#00ff00'; }).length;
    return {
      placements: placements,
      sheets: sheets,
      totalPlaced: totalPlaced,
      blockBounds: { x: n.x, y: n.y, width: n.width, height: n.height },
      blockW: n.width / GEOM,
      blockH: n.height / GEOM,
      unplaced: res.unplaced,
      utilization: res.utilization || 0,
      cancelled: !!res.cancelled,
      fitness: res.fitness,
      stats: res.stats,
      bestOrder: res.bestOrder || null
    };
  }

  var api = {
    serializeEntries: serializeEntries,
    deserializeEntries: deserializeEntries,
    buildWorkerResult: buildWorkerResult
  };
  root.NestIO = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})((function () { return typeof self !== 'undefined' ? self : globalThis; })());
