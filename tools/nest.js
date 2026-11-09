// MiniSketch nesting engine — trimmed port of KaryaCNC nestjs2/frontend
// (js/geometry.js + js/nfp2.js + js/nfp_ga.js, GA + NFP2 only).
// Classic script, no DOM, no imports. ClipperLib (tools/clipper.js) is required
// at runtime by Path.offset(). Exposed as window.MiniSketchNest in the browser
// and module.exports under Node so testing/nest_probe.js can load it.
//
// Conventions kept exactly as the reference:
//   - all engine coordinates are integer mm * GEOM_SCALE (GEOM_SCALE = 1000)
//   - a path with lcolor '#00ff00' is the SHEET: it is skipped from placement,
//     its bounds define the sheet size and it appears in the placements as the
//     sheet frame marker
//   - spacing: every part is offset outward by spacing/2 before variants are
//     built, so packing uses the grown shape and the visual gap equals spacing
'use strict';

// Timing summary is accumulated on the instance (NFPGA._lastPlaceMs /
// _lastPlaceCount) and logged ONCE per run by the app ([nest] timing) —
// no per-place log spam.
const GEOM_SCALE = 1000;

class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  clone() {
    return new Point(this.x, this.y);
  }
}

// Matrix helper used by Path.translate/rotate/flip to track the accumulated
// transform (kept for parity with the reference; MiniSketch does not export it).
function multiplyMatrices(m1, m2) {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    e1 * a2 + f1 * c2 + e2,
    e1 * b2 + f1 * d2 + f2
  ];
}

class Path {
  constructor(paths = [], index, color = null, lcolor = null) {
    this.paths = paths;
    this.originIndex = index;
    this.lcolor = lcolor;
    if (lcolor === '#00ff00') color = '#ffffff';
    if (color == null || color === false) color = '#' + Math.floor(Math.random() * 16777215).toString(16);
    this.color = color;
    this._cachedBounds = null;
    this.transformMatrix = [1, 0, 0, 1, 0, 0];
    this.childIndex = [];
    // Cached x-sorted edge list for the collision sweep; rebuilt on any
    // transform via _edgesDirty. Separate from bounds: edges are per-ring and
    // consumed only by GeometryUtil.polygonsIntersectAt().
    this._edges = null;
    this._edgesDirty = false;
  }

  getBounds() {
    if (this._cachedBounds) return this._cachedBounds;
    const path0 = this.paths[0];
    if (!path0 || !path0.length) {
      this._cachedBounds = { x: 0, y: 0, pX: 0, pY: 0, width: 0, height: 0, fX: 0, fY: 0, fWidth: 0, fHeight: 0 };
      return this._cachedBounds;
    }
    let x = path0[0].x;
    let minX = x, maxX = x;
    let y = path0[0].y;
    let minY = y, maxY = y;
    let pMinX = x, pMinY = y;
    const len = path0.length;
    for (let i = 1; i < len; i++) {
      const point = path0[i];
      x = point.x;
      y = point.y;
      if (x < minX) minX = x;
      else if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      else if (y > maxY) maxY = y;
      if (y < pMinY || (y === pMinY && x < pMinX)) {
        pMinX = x;
        pMinY = y;
      }
    }
    this._cachedBounds = {
      x: minX,
      y: minY,
      pX: pMinX,
      pY: pMinY,
      width: maxX - minX,
      height: maxY - minY,
      fX: minX / GEOM_SCALE,
      fY: minY / GEOM_SCALE,
      fWidth: (maxX - minX) / GEOM_SCALE,
      fHeight: (maxY - minY) / GEOM_SCALE
    };
    return this._cachedBounds;
  }

  invalidateBounds() {
    this._cachedBounds = null;
    this._edgesDirty = true;
  }

  // X-sorted edge list of the first ring (closed). The collision test sweeps
  // two of these so the O(n*m) edge-pair scan becomes ~O(n+m+hit) on average —
  // the single biggest speedup for high-vertex traced parts.
  getSortedEdges() {
    if (this._edges && !this._edgesDirty) return this._edges;
    const pts = this.paths[0];
    const n = pts ? pts.length : 0;
    const edges = new Array(n);
    for (let i = 0; i < n; i++) {
      const p1 = pts[i];
      const p2 = pts[(i + 1) % n];
      const x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y;
      edges[i] = {
        x1, y1, x2, y2,
        minX: x1 < x2 ? x1 : x2,
        maxX: x1 > x2 ? x1 : x2,
        minY: y1 < y2 ? y1 : y2,
        maxY: y1 > y2 ? y1 : y2
      };
    }
    edges.sort((a, b) => a.minX - b.minX);
    this._edges = edges;
    this._edgesDirty = false;
    return edges;
  }

  translate(dx, dy) {
    const matrix = [1, 0, 0, 1, dx, dy];
    this.transformMatrix = multiplyMatrices(this.transformMatrix, matrix);
    for (const path of this.paths) {
      path.forEach(point => {
        point.x += dx;
        point.y += dy;
      });
    }
    if (this._cachedBounds) {
      this._cachedBounds.x += dx;
      this._cachedBounds.y += dy;
    } else this.invalidateBounds();
    this._edgesDirty = true;
    return this;
  }

  rotate(angle) {
    const rangle = angle * Math.PI / 180;
    const cos = Math.cos(rangle);
    const sin = Math.sin(rangle);
    this.invalidateBounds();
    const matrix = [cos, sin, -sin, cos, 0, 0];
    this.transformMatrix = multiplyMatrices(this.transformMatrix, matrix);
    this.paths.forEach(path => {
      path.forEach(point => {
        const x = point.x * cos - point.y * sin;
        const y = point.x * sin + point.y * cos;
        point.x = x;
        point.y = y;
      });
    });
    this.align();
    return this;
  }

  flip(centerY = null) {
    if (centerY === null) {
      const b = this.getBounds();
      centerY = b.y + b.height / 2;
    }
    this.invalidateBounds();
    const matrix = [1, 0, 0, -1, 0, 2 * centerY];
    this.transformMatrix = multiplyMatrices(this.transformMatrix, matrix);
    this.paths.forEach(path => {
      path.forEach(point => {
        point.y = 2 * centerY - point.y;
      });
    });
    return this;
  }

  clone(dx = 0, dy = 0) {
    const newPaths = this.paths.map(p => p.map(pt => new Point(pt.x + dx, pt.y + dy)));
    const newPath = new Path(newPaths, this.originIndex, this.color, this.lcolor);
    newPath.transformMatrix = this.transformMatrix.slice();
    newPath.transformMatrix[4] += dx;
    newPath.transformMatrix[5] += dy;
    newPath.childIndex = this.childIndex;
    // Copy the cached bounds so getBounds() on clones (hot path during
    // nesting) is O(1). Must be a fresh object: translate() mutates in place.
    if (this._cachedBounds) {
      const b = this._cachedBounds;
      newPath._cachedBounds = {
        x: b.x + dx,
        y: b.y + dy,
        pX: b.pX + dx,
        pY: b.pY + dy,
        width: b.width,
        height: b.height,
        fX: b.fX + dx / GEOM_SCALE,
        fY: b.fY + dy / GEOM_SCALE,
        fWidth: b.fWidth,
        fHeight: b.fHeight
      };
    }
    return newPath;
  }

  align() {
    const bounds = this.getBounds();
    const l = this.lcolor === '#00ff00';
    return this.translate(l ? -bounds.x : -bounds.pX, l ? -bounds.y : -bounds.pY);
  }

  static getSignedArea(points) {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      area += points[i].x * points[j].y - points[j].x * points[i].y;
    }
    return area / 2;
  }

  offset(distance) {
    if (distance === 0 || this.lcolor === '#00ff00') return this;
    const clipperPaths = this.paths.map(path =>
      path.map(p => ({ X: p.x, Y: p.y }))
    );
    const co = new ClipperLib.ClipperOffset();
    co.AddPaths(clipperPaths, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
    const solution_paths = new ClipperLib.Paths();
    co.Execute(solution_paths, distance * GEOM_SCALE / 2);
    const newPaths = solution_paths.map(path =>
      path.map(p => new Point(p.X, p.Y))
    );
    this.paths = newPaths;
    this.invalidateBounds();
    return this;
  }
}

// Utility functions for geometry calculations (trimmed to what NFP2/NFPGA use).
const GeometryUtil = {
  distance: function (p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
  },

  // Ramer-Douglas-Peucker on a closed ring, in ENGINE units (mm * GEOM_SCALE).
  // Collision cost is O(n * m) in the vertex counts, so a traced outline with
  // 400 points nests ~7x slower than the same outline reduced to ~120 (measured
  // on 12 five-lobe blobs, GA 6x5: 12000 ms vs 1670 ms) while the layout is
  // unchanged at the same tolerance. The app simplifies only the COPY it hands
  // to the search; the geometry that lands in the document stays untouched.
  rdpClosed: function (points, tol) {
    const n = points ? points.length : 0;
    if (n < 4 || !(tol > 0)) return (points || []).map(p => ({ x: p.x, y: p.y }));
    const keep = new Uint8Array(n);
    keep[0] = 1;
    keep[n - 1] = 1;
    const tol2 = tol * tol;
    const stack = [[0, n - 1]];
    while (stack.length) {
      const seg = stack.pop();
      const a = seg[0];
      const b = seg[1];
      if (b - a < 2) continue;
      const ax = points[a].x, ay = points[a].y;
      const dx = points[b].x - ax, dy = points[b].y - ay;
      const len2 = dx * dx + dy * dy;
      let best = -1, bestD = tol2;
      for (let i = a + 1; i < b; i++) {
        const px = points[i].x - ax, py = points[i].y - ay;
        let d;
        if (len2 > 0) {
          let t = (px * dx + py * dy) / len2;
          if (t < 0) t = 0;
          else if (t > 1) t = 1;
          const qx = px - t * dx, qy = py - t * dy;
          d = qx * qx + qy * qy;
        } else {
          d = px * px + py * py;
        }
        if (d > bestD) { bestD = d; best = i; }
      }
      if (best > 0) {
        keep[best] = 1;
        stack.push([a, best], [best, b]);
      }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push({ x: points[i].x, y: points[i].y });
    return out;
  },

  pointInPolygon: function (point, polygon) {
    const numVertices = polygon.length;
    let isInside = false;
    const testX = point.x;
    const testY = point.y;
    for (let i = 0, j = numVertices - 1; i < numVertices; j = i++) {
      const vertI = polygon[i];
      const vertJ = polygon[j];
      if (((vertI.y > testY) !== (vertJ.y > testY)) &&
        (testX < (vertJ.x - vertI.x) * (testY - vertI.y) / (vertJ.y - vertI.y) + vertI.x)) {
        isInside = !isInside;
      }
    }
    return isInside;
  },

  // Check if poly1 has any point outside poly2's path idx ("fully inside" test).
  polyOutside: function (poly1, poly2, idx = 0) {
    for (const point of poly1.paths[0]) {
      if (!this.pointInPolygon(point, poly2.paths[idx])) return true;
    }
    return false;
  },

  lineSegmentsIntersect: function (p1, p2, p3, p4) {
    return this.lineSegmentsIntersectXY(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y, p4.x, p4.y);
  },

  // Segment intersection on raw coordinates (no Point objects allocated).
  lineSegmentsIntersectXY: function (x1, y1, x2, y2, x3, y3, x4, y4) {
    const ccw1 = (y4 - y1) * (x3 - x1) > (y3 - y1) * (x4 - x1);
    const ccw2 = (y4 - y2) * (x3 - x2) > (y3 - y2) * (x4 - x2);
    if (ccw1 === ccw2) return false;
    const ccw3 = (y3 - y1) * (x2 - x1) > (y2 - y1) * (x3 - x1);
    const ccw4 = (y4 - y1) * (x2 - x1) > (y2 - y1) * (x4 - x1);
    return ccw3 !== ccw4;
  },

  // Ray-casting point-in-polygon where the polygon is offset by (offX, offY)
  // on the fly — no translated polygon is materialized.
  pointInPolygonOffset: function (px, py, polygon, offX, offY) {
    const numVertices = polygon.length;
    let isInside = false;
    for (let i = 0, j = numVertices - 1; i < numVertices; j = i++) {
      const vi = polygon[i];
      const vj = polygon[j];
      const viY = vi.y + offY;
      const vjY = vj.y + offY;
      if (((viY > py) !== (vjY > py)) &&
        (px < (vj.x - vi.x) * (py - viY) / (vjY - viY) + vi.x + offX)) {
        isInside = !isInside;
      }
    }
    return isInside;
  },

  polyOutsideAt: function (poly1, dx, dy, poly2, idx = 0) {
    const points = poly1.paths[0];
    const target = poly2.paths[idx];
    const len = points.length;
    for (let i = 0; i < len; i++) {
      const p = points[i];
      if (!this.pointInPolygonOffset(p.x + dx, p.y + dy, target, 0, 0)) return true;
    }
    return false;
  },

  /**
   * Intersection test between poly1 translated by (dx, dy) and poly2.
   * Sets poly1.insideBonus when poly1 fits fully inside a hole of poly2.
   */
  polygonsIntersectAt: function (poly1, dx, dy, poly2, checkchild = true) {
    const BUFFER = 0.1 * GEOM_SCALE;
    const bounds1 = poly1.getBounds();
    const bounds2 = poly2.getBounds();
    const bx = bounds1.x + dx;
    const by = bounds1.y + dy;

    if (!(bx + bounds1.width + BUFFER > bounds2.x &&
      bx - BUFFER < bounds2.x + bounds2.width &&
      by + bounds1.height + BUFFER > bounds2.y &&
      by - BUFFER < bounds2.y + bounds2.height)) {
      return false;
    }

    // if poly2 has children (holes), a poly1 fully inside a hole is no hit —
    // it earns the inside bonus (small parts get pushed into holes).
    if (poly2.paths.length > 1 && checkchild) {
      for (let i = 1; i < poly2.paths.length; i++) {
        if (!this.polyOutsideAt(poly1, dx, dy, poly2, i)) {
          poly1.insideBonus = 10000 * GEOM_SCALE;
          return false;
        }
      }
    }

    const path1 = poly1.paths[0];
    const path2 = poly2.paths[0];
    const len1 = path1.length;
    const len2 = path2.length;
    const last1 = len1 - 1;
    const last2 = len2 - 1;
    const pointInPolygonOffset = this.pointInPolygonOffset;
    const lineSegmentsIntersectXY = this.lineSegmentsIntersectXY;

    const b2x = bounds2.x, b2y = bounds2.y, b2w = bounds2.width, b2h = bounds2.height;
    for (let i = 0; i < len1; i++) {
      const pt = path1[i];
      const px = pt.x + dx, py = pt.y + dy;
      if (px < b2x || px > b2x + b2w || py < b2y || py > b2y + b2h) continue;
      if (pointInPolygonOffset(px, py, path2, 0, 0)) return true;
    }

    const b1x = bx, b1y = by, b1w = bounds1.width, b1h = bounds1.height;
    for (let i = 0; i < len2; i++) {
      const pt = path2[i];
      if (pt.x < b1x || pt.x > b1x + b1w || pt.y < b1y || pt.y > b1y + b1h) continue;
      if (pointInPolygonOffset(pt.x, pt.y, path1, dx, dy)) return true;
    }

    // Edge-sweep intersection. Both rings' edges are kept x-sorted (cached on
    // the Path), so we slide over poly2's edges as poly1's min-x advances and
    // test only pairs whose x- and y-ranges overlap. poly1 is conceptually
    // offset by (dx, dy) — applied on the fly, no translated copy is built.
    // This is the same pair set the old doubly-nested loop tested, but it
    // turns O(n*m) into ~O(n+m+hit) on average for many-vertex parts.
    const edges1 = poly1.getSortedEdges();
    const edges2 = poly2.getSortedEdges();
    const m = edges2.length;
    let j = 0;
    for (let i = 0; i < len1; i++) {
      const e1 = edges1[i];
      const e1minX = e1.minX + dx;
      const e1maxX = e1.maxX + dx;
      const e1minY = e1.minY + dy;
      const e1maxY = e1.maxY + dy;
      while (j < m && edges2[j].maxX < e1minX) j++;
      for (let k = j; k < m; k++) {
        const e2 = edges2[k];
        if (e2.minX > e1maxX) break;
        if (e1minY > e2.maxY || e2.minY > e1maxY) continue;
        if (lineSegmentsIntersectXY(e1.x1 + dx, e1.y1 + dy, e1.x2 + dx, e1.y2 + dy,
          e2.x1, e2.y1, e2.x2, e2.y2)) {
          return true;
        }
      }
    }

    return false;
  },

  // x positions where a horizontal line at y crosses the part's paths.
  getHorizontalIntersections(part, y) {
    const intersections = [];
    const b = part.getBounds();
    if (b.y > y || b.y + b.height < y) return intersections;
    for (const path of part.paths) {
      for (let i = 0; i < path.length; i++) {
        const p1 = path[i];
        const p2 = path[(i + 1) % path.length];
        if (Math.abs(p1.y - p2.y) < 0.0001) continue;
        if ((p1.y <= y && p2.y >= y) || (p1.y >= y && p2.y <= y)) {
          const t = (y - p1.y) / (p2.y - p1.y);
          const x = p1.x + t * (p2.x - p1.x);
          intersections.push(x);
        }
      }
    }
    return intersections;
  },

  // Settling pass: repeatedly nudge parts up / sideways (1 mm steps) while the
  // result stays collision-free. Used once on the final solution.
  compactLayout(placements, collisionCheck) {
    const step = 1 * GEOM_SCALE;
    const iterations = 3;
    const items = placements.filter(p => p.lcolor !== '#00ff00');
    if (items.length === 0) return 0;
    const sheet = placements.find(p => p.lcolor === '#00ff00');
    const sheetWidth = sheet ? sheet.getBounds().width : Infinity;

    let totalMoved = 0;
    for (let pass = 0; pass < iterations; pass++) {
      const hDir = Math.random() < 0.5 ? -1 : 1;
      items.sort((a, b) => {
        const bA = a.getBounds();
        const bB = b.getBounds();
        const noise = (Math.random() - 0.5) * 0.2;
        if (pass % 2 === 0) {
          const areaA = bA.width * bA.height;
          const areaB = bB.width * bB.height;
          return (areaA - areaB) + (noise * (areaA + areaB));
        } else {
          const posA = bA.y * 10 + bA.x;
          const posB = bB.y * 10 + bB.x;
          return (posA - posB) + (noise * 100 * GEOM_SCALE);
        }
      });

      for (const part of items) {
        collisionCheck(part, 'start');
        let moved = true;
        while (moved) {
          moved = false;
          let bounds = part.getBounds();
          if (bounds.y >= step) {
            part.translate(0, -step);
            if (collisionCheck(part, 'check')) {
              part.translate(0, step);
            } else {
              moved = true;
              totalMoved++;
            }
          }
          bounds = part.getBounds();
          let canMoveH = false;
          if (hDir === -1 && bounds.x >= step) {
            canMoveH = true;
          } else if (hDir === 1 && (bounds.x + bounds.width + step) <= sheetWidth) {
            canMoveH = true;
          }
          if (canMoveH) {
            part.translate(hDir * step, 0);
            if (collisionCheck(part, 'check')) {
              part.translate(-hDir * step, 0);
            } else {
              moved = true;
              totalMoved++;
            }
          }
        }
        collisionCheck(part, 'end');
      }
    }
    return totalMoved;
  }
};

class NFP2SpatialHash {
  constructor(cellSize) {
    this.cellSize = cellSize;
    this.grid = new Map();
    this.queryId = 0;
    this.resultArray = [];
  }

  add(part) {
    const bounds = part.getBounds();
    const startX = Math.floor(bounds.x / this.cellSize);
    const endX = Math.floor((bounds.x + bounds.width) / this.cellSize);
    const startY = Math.floor(bounds.y / this.cellSize);
    const endY = Math.floor((bounds.y + bounds.height) / this.cellSize);
    for (let x = startX; x <= endX; x++) {
      for (let y = startY; y <= endY; y++) {
        const key = (x << 16) | (y & 0xFFFF);
        if (!this.grid.has(key)) this.grid.set(key, []);
        this.grid.get(key).push(part);
      }
    }
  }

  remove(part) {
    const bounds = part.getBounds();
    const startX = Math.floor(bounds.x / this.cellSize);
    const endX = Math.floor((bounds.x + bounds.width) / this.cellSize);
    const startY = Math.floor(bounds.y / this.cellSize);
    const endY = Math.floor((bounds.y + bounds.height) / this.cellSize);
    for (let x = startX; x <= endX; x++) {
      for (let y = startY; y <= endY; y++) {
        const key = (x << 16) | (y & 0xFFFF);
        const cell = this.grid.get(key);
        if (cell) {
          const idx = cell.indexOf(part);
          if (idx !== -1) cell.splice(idx, 1);
        }
      }
    }
  }

  // Returns a REUSABLE array (deduped via queryId stamping) — consume it before
  // the next query.
  query(bx, by, bw, bh) {
    const startX = Math.floor(bx / this.cellSize);
    const endX = Math.floor((bx + bw) / this.cellSize);
    const startY = Math.floor(by / this.cellSize);
    const endY = Math.floor((by + bh) / this.cellSize);
    const results = this.resultArray;
    results.length = 0;
    const qId = ++this.queryId;
    for (let x = startX; x <= endX; x++) {
      for (let y = startY; y <= endY; y++) {
        const key = (x << 16) | (y & 0xFFFF);
        const cell = this.grid.get(key);
        if (cell) {
          const cellLen = cell.length;
          for (let i = 0; i < cellLen; i++) {
            const part = cell[i];
            if (part._lastQueryId !== qId) {
              part._lastQueryId = qId;
              results.push(part);
            }
          }
        }
      }
    }
    return results;
  }
}

class NFP2 {
  constructor() {
    this.spacing = 0;
    this.allowFlip = true;
    this.performanceStats = {
      boundaryPointsTested: 0,
      collisionAvoided: 0,
      collisionChecks: 0
    };
    this.spatialHash = null;
    this.gridSize = 10;
    this.hascustomsheet = false;
  }

  setSpacing(spacing) {
    this.spacing = spacing * GEOM_SCALE;
    this.gridSize = spacing > 0 ? spacing * GEOM_SCALE : GEOM_SCALE;
  }
  setAllowFlip(allowFlip) { this.allowFlip = allowFlip; }

  // Gravity-centered placement objective (lowest-gravity-center policy): among
  // valid non-colliding candidate offsets, prefer the one whose centroid sits
  // as low and as left as possible. Centers the ordering on the part's actual
  // middle instead of its top edge, giving tighter vertical stacking for
  // irregular shapes. Score grows with positive y/x, so *lower* is better;
  // hole-bearing variants carry a penalty to keep them out of the plain field
  // (they are allowed back only via insideBonus).
  _gravityScore(b, dx, dy, holePenalty) {
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    return (cy + dy) * 2 + (cx + dx) * 0.1 + holePenalty;
  }

  findBestPosition(parts, sheet, progressHandler, gridSize, initialPlacements = []) {
    const startTime = performance.now();
    const scaledGridSize = gridSize;
    const scaledSheet = {
      width: sheet.width * GEOM_SCALE,
      height: sheet.height * GEOM_SCALE
    };
    this.performanceStats = {
      boundaryPointsTested: 0,
      collisionAvoided: 0,
      collisionChecks: 0
    };

    this._initialIndexSet = initialPlacements.length > 0
      ? new Set(initialPlacements.map(p => p.originIndex))
      : null;

    const cellSize = Math.max(50 * GEOM_SCALE, scaledGridSize * 5);
    this.spatialHash = new NFP2SpatialHash(cellSize);

    const bestPlacementsAll = [...initialPlacements];
    initialPlacements.forEach(p => this.spatialHash.add(p));

    const totalParts = parts.length;
    this.hascustomsheet = false;
    parts.forEach(p => { p.placed = false; });

    this._runPlacementPasses(parts, bestPlacementsAll, scaledSheet, scaledGridSize, progressHandler, totalParts);

    const endTime = performance.now();
    console.log('NFP2 Performance:', {
      time: (endTime - startTime).toFixed(2) + 'ms',
      partsProcessed: totalParts,
      ...this.performanceStats
    });

    return bestPlacementsAll;
  }

  _runPlacementPasses(parts, bestPlacementsAll, scaledSheet, scaledGridSize, progressHandler, totalParts) {
    const partData = new Map();
    let maxArea = 0, minArea = Infinity;

    for (const part of parts) {
      if (part.placed) continue;
      if (this._initialIndexSet && this._initialIndexSet.has(part.originIndex)) {
        part.placed = true;
        continue;
      }
      if (part.lcolor === '#00ff00') {
        const sheetVariant = part.variants[0];
        sheetVariant.align();
        const bounds = sheetVariant.getBounds();
        scaledSheet.width = bounds.width;
        scaledSheet.height = bounds.height;
        this.hascustomsheet = true;
        const placedSheet = sheetVariant.clone();
        bestPlacementsAll.push(placedSheet);
        this.spatialHash.add(placedSheet);
        part.placed = true;
        continue;
      }
      const b = part.variants[0].getBounds();
      const longestSide = Math.max(b.width, b.height);
      const area = longestSide * longestSide;
      partData.set(part, { area, aspectRatio: b.width / b.height });
      maxArea = Math.max(maxArea, area);
      minArea = Math.min(minArea, area);
    }

    const remainingParts = parts.filter(part => !part.placed && part.lcolor !== '#00ff00');
    const areaRange = maxArea - minArea;
    const thresholds = [
      minArea + areaRange * 0.75,
      minArea + areaRange * 0.5,
      minArea + areaRange * 0.25,
      minArea
    ];

    // 4 passes like the reference so large parts are placed first.
    for (let pass = 0; pass < 4; pass++) {
      const passParts = remainingParts.filter(part => {
        if (part.placed) return false;
        const area = partData.get(part).area;
        if (pass === 0) return area >= thresholds[0];
        if (pass === 1) return area >= thresholds[1];
        if (pass === 2) return area >= thresholds[2];
        return true;
      });

      passParts.sort((a, b) => {
        const aD = partData.get(a);
        const bD = partData.get(b);
        const scoreA = aD.area * Math.abs(1 - aD.aspectRatio);
        const scoreB = bD.area * Math.abs(1 - bD.aspectRatio);
        const noise = (Math.random() - 0.5) * (scoreA + scoreB) * 0.1;
        return scoreB - scoreA + noise;
      });

      for (let part of passParts) {
        if (part.placed) continue;
        const bestPlacement = this.findBestNFPPlacement(part, bestPlacementsAll, scaledSheet, scaledGridSize);
        if (bestPlacement) {
          bestPlacement.childIndex = part.childIndex;
          bestPlacementsAll.push(bestPlacement);
          this.spatialHash.add(bestPlacement);
          part.placed = true;
        }
        if (progressHandler) progressHandler(bestPlacementsAll.length, totalParts);
      }
    }
  }

  findBestNFPPlacement(part, placedPartsAll, sheet, gridSize) {
    const sheetParts = placedPartsAll.filter(p => p.lcolor === '#00ff00');
    let bestPlacement = null;
    // Phase timing (diagnostics): split scanline vs vertex-refine vs collision.
    this.performanceStats = this.performanceStats || { scanMs: 0, vertMs: 0, collMs: 0 };
    const tScan = performance.now();
    let bestScore = Infinity;
    // timing instrumentation: where does a part's placement search spend its
    // time? Logged from _evaluateGen when NEST_TIMING is on.
    const t0 = performance.now();
    // Hard budget per placement: once a valid placement exists, stop refining
    // further when we exceed this wall-clock budget. Dense packing (many
    // placed parts + holes) can make a single placement search take many
    // seconds synchronously — which freezes the progress UI. The budget caps
    // the worst case to ~1s while still returning a valid (if not perfectly
    // lowest) placement for every part.
    const PLACE_BUDGET_MS = 1200;
    let candidates = 0, collisions = 0;

    // 1. Scanline-based search (top-first, then left).
    const yStep = Math.max(4 * GEOM_SCALE, gridSize);
    const xStep = Math.max(4 * GEOM_SCALE, gridSize);

    const scanParts = placedPartsAll.map(p => {
      const b = p.getBounds();
      return { p, minY: b.y, maxY: b.y + b.height };
    });
    // Any placed part carrying holes makes insideBonus reachable this scan.
    this._holesOnSheet = placedPartsAll.some(p => p.lcolor !== '#00ff00' && p.paths.length > 1) ? 1 : 0;

    for (let y = 0; y < sheet.height; y += yStep) {
      const intersections = [];
      let sheetRange = [0, sheet.width];

      for (const sp of scanParts) {
        if (y < sp.minY || y > sp.maxY) continue;
        const placed = sp.p;
        const pts = GeometryUtil.getHorizontalIntersections(placed, y);
        if (placed.lcolor === '#00ff00') {
          if (pts.length >= 2) {
            pts.sort((a, b) => a - b);
            sheetRange = [pts[0], pts[pts.length - 1]];
          }
        } else {
          intersections.push(...pts);
        }
      }
      intersections.sort((a, b) => a - b);

      for (let x = sheetRange[0]; x <= sheetRange[1]; x += xStep) {
        let insideAnyPart = false;
        for (let i = 0; i < intersections.length; i += 2) {
          if (x >= intersections[i] && x <= intersections[i + 1]) {
            x = Math.ceil(intersections[i + 1]);
            insideAnyPart = true;
            break;
          }
        }
        if (insideAnyPart) continue;

        for (let variant of part.variants) {
          const b = variant.getBounds();
          const dx = x - b.x;
          const dy = y - b.y;

          if (x < 0 || y < 0 || x + b.width > sheet.width || y + b.height > sheet.height) continue;

          const score = this._gravityScore(b, dx, dy, variant.paths.length > 1 ? 1000 * GEOM_SCALE : 0);
          // Deviation from the reference: when the sheet has placed parts with
          // holes, a candidate that fits fully inside a hole earns insideBonus
          // (10000 * GEOM_SCALE) which crushes any plain score — but the
          // reference prune (`score > bestScore + 100 -> continue`) discarded
          // those candidates BEFORE the bonus was computed, so the hole fit was
          // only found by luck of scan order. When holes exist, run the
          // collision test anyway; the prune stays exact when there are none.
          const mayFitInHole = this._holesOnSheet > 0 && variant.paths.length === 1;
          if (score > bestScore + 100 && !mayFitInHole) continue;
          candidates++;

          variant.insideBonus = 0;
          if (!this.checkCollisions(variant, dx, dy, sheetParts)) {
            const finalScore = score - (variant.insideBonus || 0);
            if (finalScore < bestScore) {
              bestScore = finalScore;
              bestPlacement = variant.clone(dx, dy);
              if (variant.insideBonus > 5000) return bestPlacement;
            }
          }
        }
      }
      // Stop evaluation if we have a very solid result at the top.
      if (bestPlacement && (y > sheet.height / 3 || performance.now() - t0 > PLACE_BUDGET_MS)) break;
    }

    const tVertPhase = performance.now();
    // 2. Vertex refinement pass.
    // DOMINANT COST: with text-traced parts (hundreds of points each), the
    // raw candidate list is every placed vertex x 6-9 samples = tens of
    // thousands, and bestScore (a y-based number ~2x sheet height) always
    // exceeds sheet.height*0.5, so this pass runs for EVERY part. Collision-
    // testing all of them is O(parts² × pts) — the whole crawl. The pass is
    // a refinement heuristic: sorting by score and testing only the best K
    // keeps its quality while bounding the cost.
    let vertexPass = false, vertexCandidates = 0;
    if (!bestPlacement || bestScore > (sheet.height * 0.5)) {
      vertexPass = true;
      const edgeCandidates = this.getCandidatePositions(part.variants[0], placedPartsAll, sheet, gridSize);
      vertexCandidates = edgeCandidates.length;
      const K = 200;
      if (edgeCandidates.length > K) {
        const vb = part.variants[0].getBounds();
        for (const pos of edgeCandidates) {
          pos._score = this._gravityScore(vb, pos.x, pos.y, 0);
        }
        edgeCandidates.sort((p, q) => p._score - q._score);
        edgeCandidates.length = K;
      }
      for (let pos of edgeCandidates) {
        if (bestPlacement && performance.now() - t0 > PLACE_BUDGET_MS) break;
        const b = part.variants[0].getBounds();
        const score = this._gravityScore(b, pos.x, pos.y, 0);
        if (score < bestScore) {
          if (!this.checkCollisions(part.variants[0], pos.x, pos.y, sheetParts)) {
            bestPlacement = part.variants[0].clone(pos.x, pos.y);
            bestScore = score;
          }
        }
      }
    }

    // timing: accumulate instead of spamming — the GA constructor exposes a
    // per-run summary via getPerformanceStats() so the console stays readable.
    const tNow = performance.now();
    const tVert = (typeof tVertPhase !== 'undefined') ? tVertPhase : tNow;
    const scanMs = tVert - tScan;
    const vertMs = tNow - tVert;
    this.performanceStats.scanMs += scanMs;
    this.performanceStats.vertMs += vertMs;
    const tTotal = tNow - t0;
    if (tTotal > 400) {
      const pi = (part.variants && part.variants[0] && part.variants[0].originIndex) != null
        ? part.variants[0].originIndex : -1;
      const pb = part.variants[0].getBounds();
      console.log('[nest][slow] placement origin=' + pi + ' total=' + tTotal.toFixed(0) +
        'ms scan=' + scanMs.toFixed(0) + 'ms vert=' + vertMs.toFixed(0) + 'ms' +
        ' cand=' + candidates + ' coll=' +
        (this.performanceStats.collisionChecks - (this._collBefore || 0)) +
        ' sz=' + Math.round(pb.width / GEOM_SCALE) + 'x' + Math.round(pb.height / GEOM_SCALE) +
        'mm placed=' + (this._lastPlaceCount || 0));
    }
    this._collBefore = this.performanceStats.collisionChecks;
    this._lastPlaceMs = (this._lastPlaceMs || 0) + tTotal;
    this._lastPlaceCount = (this._lastPlaceCount || 0) + 1;
    return bestPlacement;
  }

  getCandidatePositions(part, placedParts, sheet, gridSize) {
    const positions = [];
    const pb = part.getBounds();
    const pW = pb.width;
    const pH = pb.height;

    // start points along the top and left encourage top-left packing
    const startStep = gridSize * 2;
    for (let x = 0; x <= sheet.width; x += startStep) {
      positions.push({ x: x - pb.x, y: -pb.y });
    }
    for (let y = 0; y <= sheet.height / 2; y += startStep) {
      positions.push({ x: -pb.x, y: y - pb.y });
    }

    if (placedParts.length === 0) return positions;

    const seen = new Set();
    const addPos = (x, y) => {
      const k = Math.round(x) + ',' + Math.round(y);
      if (!seen.has(k)) {
        positions.push({ x, y });
        seen.add(k);
      }
    };

    const newPartPath = part.paths[0];
    const vSamples = [];
    vSamples.push({ x: pb.x, y: pb.y });
    vSamples.push({ x: pb.x + pW, y: pb.y });
    vSamples.push({ x: pb.x + pW, y: pb.y + pH });
    vSamples.push({ x: pb.x, y: pb.y + pH });
    vSamples.push({ x: pb.x + pW / 2, y: pb.y });
    vSamples.push({ x: pb.x, y: pb.y + pH / 2 });

    if (this.gridSize < 3 * GEOM_SCALE) {
      vSamples.push({ x: pb.x + pW / 2, y: pb.y + pH });
      vSamples.push({ x: pb.x + pW, y: pb.y + pH / 2 });
      vSamples.push({ x: pb.x + pW / 2, y: pb.y + pH / 2 });
    }

    // Budget-bound candidate generation. Naively every placed vertex x the
    // sample offsets would yield tens of thousands of candidates for traced
    // parts — only to be sorted and truncated to K=200 in
    // findBestNFPPlacement. Adapt the sampling stride so the generated set
    // stays near a fixed budget while still spread across all placed contours.
    const MAX_VERT_CANDIDATES = 4000;
    const samplesPerVertex = vSamples.length || 1;
    const maxVerts = Math.max(1, Math.floor(MAX_VERT_CANDIDATES / samplesPerVertex));
    let totalVerts = 0;
    for (const placed of placedParts) {
      if (placed.lcolor === '#00ff00') continue;
      for (const path of placed.paths) totalVerts += path.length;
    }
    const baseVSkip = Math.max(1, Math.floor(gridSize / (2 * GEOM_SCALE)));
    const budgetStride = totalVerts > maxVerts ? Math.ceil(totalVerts / maxVerts) : 1;
    const vSkip = Math.max(baseVSkip, budgetStride);

    for (const placed of placedParts) {
      if (placed.lcolor === '#00ff00') continue;
      for (const path of placed.paths) {
        const len = path.length;
        if (len < 2) continue;
        for (let i = 0; i < len; i += vSkip) {
          const pt = path[i];
          for (const v of vSamples) {
            addPos(pt.x - v.x, pt.y - v.y);
          }
        }
      }
    }

    return positions.filter(p => {
      const bx = p.x + pb.x;
      const by = p.y + pb.y;
      return bx >= 0 && bx + pb.width <= sheet.width &&
        by >= 0 && by + pb.height <= sheet.height;
    });
  }

  checkCollisions(variant, dx, dy, sheetParts) {
    const vBounds = variant.getBounds();
    const bx = vBounds.x + dx;
    const by = vBounds.y + dy;
    const bw = vBounds.width;
    const bh = vBounds.height;

    // 1. sheet constraints
    for (const s of sheetParts) {
      this.performanceStats.collisionChecks++;
      if (GeometryUtil.polyOutsideAt(variant, dx, dy, s)) return true;
    }

    const candidates = this.spatialHash.query(bx, by, bw, bh);

    // 2. part intersections
    for (const placed of candidates) {
      if (placed.lcolor === '#00ff00') continue;
      const pb = placed._cachedBounds || placed.getBounds();
      if (bx > pb.x + pb.width || bx + bw < pb.x ||
        by > pb.y + pb.height || by + bh < pb.y) {
        continue;
      }
      this.performanceStats.collisionChecks++;
      if (GeometryUtil.polygonsIntersectAt(variant, dx, dy, placed, true)) return true;
    }

    return false;
  }

  calculateTotalBounds(parts) {
    if (parts.length === 0) return { x: 0, y: 0, width: 10 * GEOM_SCALE, height: 10 * GEOM_SCALE };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const part of parts) {
      if (part.lcolor === '#00ff00') continue;
      const b = part.getBounds();
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  getPerformanceStats() { return this.performanceStats; }

  compactSolution(placements, sheet) {
    const cellSize = (this.spatialHash && this.spatialHash.cellSize) ||
      Math.max(50 * GEOM_SCALE, (this.gridSize || 10) * 5);
    this.spatialHash = new NFP2SpatialHash(cellSize);
    placements.forEach(p => this.spatialHash.add(p));
    const sheetParts = placements.filter(p => p.lcolor === '#00ff00');

    const collisionCheck = (part, phase) => {
      if (part.lcolor === '#00ff00') return false;
      if (phase === 'start') {
        this.spatialHash.remove(part);
        return false;
      }
      if (phase === 'end') {
        this.spatialHash.add(part);
        return false;
      }
      const b = part.getBounds();
      if (b.x < 0 || b.y < 0 || b.x + b.width > sheet.width * GEOM_SCALE || b.y + b.height > sheet.height * GEOM_SCALE) {
        return true;
      }
      return this.checkCollisions(part, 0, 0, sheetParts);
    };

    const moves = GeometryUtil.compactLayout(placements, collisionCheck);
    console.log('NFP2 Compaction done. Multi-pass moves: ' + moves);
    return placements;
  }
}

/**
 * GA whose chromosome is the placement order (a permutation of entry indexes)
 * plus one rotation-variant gene per position. The decoder is the unmodified
 * NFP2 placement search. Fitness = total bounding-box area + bbox area of
 * every unplaced part. Elitism always keeps the descending-size baseline
 * individual, so a GA run can never score worse than the plain heuristic.
 */
class NFPGA {
  constructor() {
    this.spacing = 0;
    this.allowFlip = true;
    this.gridSize = 10;
    this.performanceStats = {
      generations: 0,
      evaluations: 0,
      collisionChecks: 0,
      bestFitness: Infinity
    };
    this.hascustomsheet = false;
    this.popSize = 6;
    this.generations = 5;
    this.mutationRate = 0.1;
    // #7 — fitness objective: 'area' (bounding-box area, default) or 'strip'
    // (fixed-width strip stock: minimize used height, width only breaks ties).
    this.fitnessMode = 'area';
    // #6 — hill-climb local-search budget (pairwise order swaps) applied to the
    // best chromosome after the GA converges. 0 disables it.
    this.localSearchBudget = 24;
  }

  setSpacing(spacing) {
    this.spacing = spacing * GEOM_SCALE;
    this.gridSize = spacing > 0 ? spacing * GEOM_SCALE : GEOM_SCALE;
  }

  setAllowFlip(allowFlip) { this.allowFlip = allowFlip; }

  setGAParams(popSize, generations, mutationRate) {
    if (popSize > 1) this.popSize = Math.floor(popSize);
    if (generations > 0) this.generations = Math.floor(generations);
    if (mutationRate >= 0 && mutationRate <= 1) this.mutationRate = mutationRate;
  }

  setFitnessMode(mode) {
    if (mode === 'strip' || mode === 'area') this.fitnessMode = mode;
  }

  setLocalSearchBudget(budget) {
    if (budget >= 0) this.localSearchBudget = Math.floor(budget);
  }

  // ---- pure permutation helpers (no geometry here) ----

  _shuffled(n) {
    const a = [];
    for (let i = 0; i < n; i++) a.push(i);
    for (let i = n - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // Order crossover (OX): copy a slice of p1, fill the rest in p2 order.
  _crossover(p1, p2) {
    const n = p1.length;
    if (n < 2) return p1.slice();
    let a = (Math.random() * n) | 0;
    let b = (Math.random() * n) | 0;
    if (a > b) { const t = a; a = b; b = t; }
    const child = new Array(n).fill(-1);
    const used = new Set();
    for (let i = a; i <= b; i++) { child[i] = p1[i]; used.add(p1[i]); }
    let j = (b + 1) % n;
    for (let i = 0; i < n; i++) {
      const g = p2[(b + 1 + i) % n];
      if (!used.has(g)) { child[j] = g; used.add(g); j = (j + 1) % n; }
    }
    return child;
  }

  _mutateOrder(order) {
    const n = order.length;
    if (n < 2) return order;
    const a = order.slice();
    const r = Math.random();
    if (r < 0.5) {
      const i = (Math.random() * n) | 0;
      let j = (Math.random() * n) | 0;
      if (i === j) j = (j + 1) % n;
      const t = a[i]; a[i] = a[j]; a[j] = t;
    } else if (r < 0.8) {
      const i = (Math.random() * n) | 0;
      const g = a.splice(i, 1)[0];
      a.splice((Math.random() * (n - 1 + 1)) | 0, 0, g);
    } else {
      let i = (Math.random() * n) | 0;
      let j = (Math.random() * n) | 0;
      if (i > j) { const t = i; i = j; j = t; }
      while (i < j) { const t = a[i]; a[i] = a[j]; a[j] = t; i++; j--; }
    }
    return a;
  }

  _randomRots() {
    return this._variantCounts.map(c => (Math.random() * c) | 0);
  }

  _crossoverRots(r1, r2) {
    const n = r1.length;
    const child = new Array(n);
    for (let i = 0; i < n; i++) child[i] = Math.random() < 0.5 ? r1[i] : r2[i];
    return child;
  }

  _mutate(ind) {
    const order = this._mutateOrder(ind.order);
    let rots = ind.rots;
    if (Math.random() < this.mutationRate) {
      rots = ind.rots.slice();
      const i = (Math.random() * rots.length) | 0;
      const c = this._variantCounts[i];
      if (c > 1) {
        let v = (Math.random() * c) | 0;
        if (v === rots[i]) v = (v + 1) % c;
        rots[i] = v;
      }
    }
    return { order, rots };
  }

  _tournament(fits, k) {
    let best = (Math.random() * fits.length) | 0;
    for (let i = 1; i < k; i++) {
      const c = (Math.random() * fits.length) | 0;
      if (fits[c] < fits[best]) best = c;
    }
    return best;
  }

  _entryArea(e) {
    if (e._gaArea !== undefined) return e._gaArea;
    let a = 0;
    if (e.variants && e.variants.length > 0) {
      const b = e.variants[0].getBounds();
      a = b.width * b.height;
    }
    e._gaArea = a;
    return a;
  }

  /**
   * Decode one chromosome: place parts in `order` using a fresh NFP2 instance
   * as the decoder. Returns { placements, fitness, unplaced, unplacedArea }.
   */
  // Generator twin of _evaluate: identical math, but yields after every PART
  // placement attempt so a main-thread scheduler can bound its time slices to
  // one part (one glyph-heavy part can take seconds — a per-chromosome yield
  // freezes the progress bar for that whole span). Yields {done, total,
  // evalsDone} where done/total count PART steps within this decode.
  *_evaluateGen(ind, ctx, evalsDone) {
    const order = Array.isArray(ind) ? ind : ind.order;
    const dec = new NFP2();
    dec.spacing = this.spacing;
    dec.allowFlip = this.allowFlip;
    // Sync with the CALLER's grid size (the reference worker does
    // `nfp.gridSize = gridSize` from its payload). setSpacing() alone leaves
    // gridSize at spacing-derived 1 mm when spacing = 0, which silently
    // enables the max-packing extra vertex samples in getCandidatePositions
    // and makes every placement search crawl.
    dec.gridSize = ctx.gridSize;
    dec.performanceStats = { boundaryPointsTested: 0, collisionAvoided: 0, collisionChecks: 0 };
    const cellSize = Math.max(50 * GEOM_SCALE, ctx.gridSize * 5);
    dec.spatialHash = new NFP2SpatialHash(cellSize);

    const sheet = { width: ctx.scaledSheet.width, height: ctx.scaledSheet.height };
    const placed = ctx.fixed.slice();
    for (const p of placed) dec.spatialHash.add(p);

    // green entries become the sheet, exactly like the reference
    for (const e of ctx.entries) {
      if (e.lcolor !== '#00ff00') continue;
      const sv = e.variants[0];
      sv.align();
      const b = sv.getBounds();
      sheet.width = b.width;
      sheet.height = b.height;
      dec.hascustomsheet = true;
      const c = sv.clone();
      c.childIndex = e.childIndex;
      placed.push(c);
      dec.spatialHash.add(c);
    }

    const placeableCount = ctx.placeableCount || order.length;
    let partStep = 0;
    let unplaced = 0;
    let unplacedArea = 0;
    for (let k = 0; k < order.length; k++) {
      const e = ctx.entries[order[k]];
      if (!e || (ctx.initialSet && ctx.initialSet.has(e.originIndex))) continue;
      if (e.lcolor === '#00ff00') continue; // fixed by the decoder above
      let bp = null;
      let usedVariant = -1;
      if (ind && !Array.isArray(ind) && ind.rots) {
        const variants = e.variants || [];
        if (Number.isInteger(ind.rots[order[k]]) && variants.length) {
          usedVariant = ((ind.rots[order[k]] % variants.length) + variants.length) % variants.length;
        }
        bp = this._placeWithVariant(dec, e, ind.rots[order[k]], placed, sheet, ctx.gridSize);
      } else {
        bp = dec.findBestNFPPlacement(e, placed, sheet, ctx.gridSize);
      }
      if (bp) {
        bp.childIndex = e.childIndex;
        if (usedVariant >= 0) bp._variantIdx = usedVariant;
        placed.push(bp);
        dec.spatialHash.add(bp);
      } else {
        unplaced++;
        unplacedArea += this._entryArea(e);
      }
      partStep++;
      yield { done: partStep, total: placeableCount, evalsDone };
    }

    let fit = 0;
    if (placed.length > 0) {
      const b = dec.calculateTotalBounds(placed);
      if (this.fitnessMode === 'strip') {
        // Fixed-width strip objective: minimize used height; width breaks ties.
        fit = b.height * 1000000 + b.width;
      } else {
        fit = b.width * b.height;
      }
    }
    ctx.stats.collisionChecks += dec.performanceStats.collisionChecks || 0;
    return { placements: placed, fitness: fit + unplacedArea, unplaced: unplaced, unplacedArea: unplacedArea };
  }

  _evaluate(ind, ctx) {
    const gen = this._evaluateGen(ind, ctx, 0);
    let n;
    do { n = gen.next(); } while (!n.done);
    return n.value;
  }

  // #6 — bounded hill-climb local search around `ind`. Neighborhood: pairwise
  // order swaps (with occasional rotation flips). Each trial is one full
  // decode; the best-improving move is kept. Returns the best individual and
  // its evaluation. Bounded by `budget` trials and the optional shouldCancel.
  _localSearch(ind, ctx, budget, shouldCancel) {
    let bestInd = ind;
    let bestR = this._evaluate(ind, ctx);
    const n = ind.order.length;
    let trials = 0;
    while (trials < budget) {
      if (shouldCancel && shouldCancel()) break;
      const a = (Math.random() * n) | 0;
      let b = (Math.random() * n) | 0;
      if (a === b) b = (b + 1) % n;
      const order = ind.order.slice();
      const t = order[a]; order[a] = order[b]; order[b] = t;
      const candidate = { order, rots: ind.rots };
      const r = this._evaluate(candidate, ctx);
      trials++;
      if (r.fitness < bestR.fitness) {
        bestR = r;
        bestInd = candidate;
      }
    }
    return { ind: bestInd, result: bestR, trials };
  }

  /**
   * Place one part trying only the rotation gene (a single variant index).
   */
  _placeWithVariant(dec, entry, gene, placed, sheet, gridSize) {
    const variants = entry.variants;
    if (!variants || variants.length === 0) return null;
    let list = variants;
    if (Number.isInteger(gene)) {
      const v = variants[((gene % variants.length) + variants.length) % variants.length];
      if (v) list = [v];
    }
    const single = { variants: list, childIndex: entry.childIndex };
    return dec.findBestNFPPlacement(single, placed, sheet, gridSize);
  }

  /**
   * Generator form of the GA search: yields {done, total} after every
   * evaluation so a caller can keep the UI responsive between steps, and
   * returns { placements, fitness, unplaced, stats, cancelled } at the end.
   * opts.shouldCancel (optional) is polled before each evaluation; when it
   * turns true the search stops early and returns the best completed
   * evaluation (the baseline is always the first one, so there is always a
   * valid result unless the very first evaluation is cancelled).
   */
  *findBestPositionGen(parts, sheet, gridSize, opts = {}) {
    const scaledSheet = {
      width: sheet.width * GEOM_SCALE,
      height: sheet.height * GEOM_SCALE
    };
    this.hascustomsheet = false;
    // The grid param is the authoritative scan step (like the reference
    // worker's `nfp.gridSize = gridSize`); setSpacing() must not override it.
    this.gridSize = gridSize;
    parts.forEach(p => { p.placed = false; });

    const entries = parts.slice();
    const placeables = entries.filter(e => e.lcolor !== '#00ff00');

    const stats = { generations: 0, evaluations: 0, collisionChecks: 0, bestFitness: Infinity };

    if (placeables.length === 0) {
      const r = this._evaluate({ order: entries.map((e, i) => i), rots: null }, {
        entries, scaledSheet, gridSize, fixed: [], initialSet: null, stats
      });
      stats.evaluations = 1;
      stats.bestFitness = r.fitness;
      return { placements: r.placements, fitness: r.fitness, unplaced: r.unplaced, stats, cancelled: false };
    }

    // Baseline individual: descending size (longest side squared).
    const sizeOf = (e) => {
      const b = e.variants[0].getBounds();
      const l = Math.max(b.width, b.height);
      return l * l;
    };
    const baselineOrder = placeables
      .map(e => entries.indexOf(e))
      .sort((a, b) => sizeOf(entries[b]) - sizeOf(entries[a]));

    const ctx = {
      entries: entries,
      scaledSheet: scaledSheet,
      gridSize: gridSize,
      fixed: [],
      initialSet: null,
      placeableCount: placeables.length,
      stats: stats
    };

    this._variantCounts = entries.map(e =>
      (e.variants && e.variants.length > 0) ? e.variants.length : 1);

    const popSize = Math.max(2, this.popSize);
    const n = entries.length;
    const baseSet = new Set(baselineOrder);
    const baseRots = this._randomRots();
    let pop = [{
      order: baselineOrder.concat(
        Array.from({ length: n }, (_, i) => i).filter(i => !baseSet.has(i))
      ), rots: baseRots
    }];
    // Seed: the winner of the previous iteration (infinite mode / re-nest) as
    // the second individual, exactly like the reference's gaSeedOrder. It is
    // only accepted as a full permutation of the current entry positions, so a
    // changed part list can never smuggle a stale gene in.
    const seed = opts.seedOrder;
    if (seed && Array.isArray(seed.order) && Array.isArray(seed.rots) &&
        seed.order.length === n && seed.rots.length === n) {
      const seen = new Array(n).fill(false);
      let valid = true;
      for (const v of seed.order) {
        if (!Number.isInteger(v) || v < 0 || v >= n || seen[v]) { valid = false; break; }
        seen[v] = true;
      }
      if (valid) pop.push({ order: seed.order.slice(), rots: seed.rots.slice() });
    }
    while (pop.length < popSize) pop.push({ order: this._shuffled(n), rots: this._randomRots() });

    const totalEvals = pop.length * Math.max(1, this.generations) + 1;
    const totalSteps = totalEvals * placeables.length; // progress counts PART steps
    let evalsDone = 0;

    const shouldCancel = opts.shouldCancel || null;
    let bestResult = null; // best COMPLETED evaluation (for early exit)
    let bestIndRef = null; // chromosome behind bestResult, for the next iteration's seed

    // Run one evaluation as a sub-generator, re-yielding every PART step so
    // the caller's time slices stay bounded by a single placement search.
    // evalsDone here counts COMPLETED evaluations (bumped when the sub-gen
    // returns); the caller's progress fraction uses evalsDone + partStep/total.
    function* runEval(nfpga, ind, ctx2, evalsDoneRef) {
      const evIdx = evalsDoneRef.v;
      console.log('[nest][eval] eval ' + evIdx + ' START (' + (totalEvals - evIdx) + ' remaining)');
      const gen = nfpga._evaluateGen(ind, ctx2, evIdx);
      let sub;
      for (;;) {
        if (shouldCancel && shouldCancel()) return null;
        sub = gen.next();
        if (sub.done) break;
        yield {
          eval: evIdx, part: sub.value.done, parts: sub.value.total,
          done: evIdx * placeables.length + sub.value.done, total: totalSteps
        };
      }
      evalsDoneRef.v++;
      console.log('[nest][eval] eval ' + evIdx + ' DONE' +
        (sub.value ? ' fit=' + Number(sub.value.fitness).toFixed(3) : ' (null)'));
      return sub.value;
    }
    const evalsRef = { v: 0 };

    let cancelled = false;
    let fits = [];
    for (const o of pop) {
      if (shouldCancel && shouldCancel()) { cancelled = true; break; }
      const rGen = runEval(this, o, ctx, evalsRef);
      let r;
      for (;;) {
        if (shouldCancel && shouldCancel()) { cancelled = true; break; }
        const y = rGen.next();
        if (y.done) { r = y.value; break; }
        yield { done: y.value.done, total: y.value.total };
      }
      if (cancelled) break;
      evalsDone = evalsRef.v;
      stats.evaluations = evalsDone;
      if (r) {
        fits.push(r.fitness);
        if (!bestResult || r.fitness < bestResult.fitness) { bestResult = r; bestIndRef = o; }
      }
    }

    if (!cancelled) {
      const ELITES = Math.min(2, pop.length);
      let gen;
      for (gen = 0; gen < this.generations; gen++) {
        console.log('[nest][gen] generation ' + gen + ' start (pop=' + pop.length + ')');
        const ranked = pop.map((o, i) => i).sort((a, b) => fits[a] - fits[b]);
        const next = [];
        for (let e = 0; e < ELITES; e++) next.push(pop[ranked[e]]);
        while (next.length < pop.length) {
          const p1 = pop[this._tournament(fits, 3)];
          const p2 = pop[this._tournament(fits, 3)];
          const order = this._crossover(p1.order, p2.order);
          const rots = this._crossoverRots(p1.rots, p2.rots);
          next.push(this._mutate({ order, rots }));
        }
        pop = next;
        const newFits = [];
        let abortedGen = false;
        for (let i = 0; i < pop.length; i++) {
          if (i < ELITES) { newFits.push(fits[ranked[i]]); continue; }
          if (shouldCancel && shouldCancel()) { cancelled = true; abortedGen = true; break; }
          const rGen = runEval(this, pop[i], ctx, evalsRef);
          let r;
          for (;;) {
            if (shouldCancel && shouldCancel()) { cancelled = true; abortedGen = true; break; }
            const y = rGen.next();
            if (y.done) { r = y.value; break; }
            yield { done: y.value.done, total: y.value.total };
          }
          if (cancelled) break;
          if (r) {
            newFits.push(r.fitness);
            if (!bestResult || r.fitness < bestResult.fitness) { bestResult = r; bestIndRef = pop[i]; }
          }
        }
        if (abortedGen) break;
        evalsDone = evalsRef.v;
        stats.evaluations = evalsDone;
        fits = newFits;
        console.log('[nest][gen] generation ' + gen + ' done (evals=' + evalsDone + ')');
      }
      stats.generations = gen;
    }

    let result;
    let lsTrials = 0;
    if (cancelled) {
      result = bestResult; // best-so-far (baseline completed first unless cancelled before it)
      if (!result) return { placements: [], fitness: Infinity, unplaced: placeables.length, stats, cancelled: true };
    } else {
      const ranked = pop.map((o, i) => i).sort((a, b) => fits[a] - fits[b]);
      const bestInd = pop[ranked[0]];
      if (shouldCancel && shouldCancel()) {
        result = bestResult;
        cancelled = true;
      } else {
        // #6 — bounded hill-climb local search on the best chromosome before the
        // final decode, so the returned packing is at least as good as the GA's
        // winner and usually tighter.
        let target = bestInd;
        let r = null;
        if (this.localSearchBudget > 0 && n > 1) {
          console.log('[nest][ls] local search START (budget=' + this.localSearchBudget + ')');
          const ls = this._localSearch(bestInd, ctx, this.localSearchBudget, shouldCancel);
          target = ls.ind;
          r = ls.result;
          lsTrials = ls.trials;
          console.log('[nest][ls] local search DONE (trials=' + ls.trials + ')');
        }
        if (!r) {
          const rGen = runEval(this, target, ctx, evalsRef);
          for (;;) {
            if (shouldCancel && shouldCancel()) { cancelled = true; break; }
            const y = rGen.next();
            if (y.done) { r = y.value; break; }
            yield { done: y.value.done, total: y.value.total };
          }
        }
        if (cancelled || !r) {
          result = bestResult;
          cancelled = true;
        } else {
          result = r;
          bestIndRef = target;
        }
      }
    }
    evalsDone = evalsRef.v;
    stats.evaluations = evalsDone + lsTrials;

    stats.collisionChecks = ctx.stats.collisionChecks;
    stats.bestFitness = result ? result.fitness : Infinity;
    const seedOut = bestIndRef && Array.isArray(bestIndRef.order)
      ? { order: bestIndRef.order.slice(), rots: Array.isArray(bestIndRef.rots) ? bestIndRef.rots.slice() : null }
      : null;
    return {
      placements: result ? result.placements : [],
      fitness: result ? result.fitness : Infinity,
      unplaced: result ? result.unplaced : placeables.length,
      stats,
      cancelled,
      bestOrder: seedOut
    };
  }

  // Synchronous wrapper over the generator (used by the probe and any caller
  // that does not need cooperative scheduling).
  findBestPosition(parts, sheet, progressHandler, gridSize) {
    const gen = this.findBestPositionGen(parts, sheet, gridSize != null ? gridSize : this.gridSize);
    let r;
    for (;;) {
      const n = gen.next();
      if (n.done) { r = n.value; break; }
      if (progressHandler) progressHandler(n.value.done, n.value.total);
    }
    this.performanceStats = r.stats;
    this.hascustomsheet = r.stats && r.stats.hascustomsheet || this.hascustomsheet;
    return r.placements;
  }

  compactSolution(placements, sheet) {
    const dec = new NFP2();
    dec.spacing = this.spacing;
    dec.allowFlip = this.allowFlip;
    dec.gridSize = this.gridSize;
    return dec.compactSolution(placements, sheet);
  }

  calculateTotalBounds(parts) {
    if (parts.length === 0) return { x: 0, y: 0, width: 10 * GEOM_SCALE, height: 10 * GEOM_SCALE };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const part of parts) {
      if (part.lcolor === '#00ff00') continue;
      const b = part.getBounds();
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  getPerformanceStats() { return this.performanceStats; }
}

const MiniSketchNest = { GEOM_SCALE, Point, Path, GeometryUtil, NFP2SpatialHash, NFP2, NFPGA };

if (typeof window !== 'undefined') window.MiniSketchNest = MiniSketchNest;
if (typeof module !== 'undefined' && module.exports) module.exports = MiniSketchNest;
