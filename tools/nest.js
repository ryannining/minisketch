// MiniSketch nesting engine — True NFP/IFP (No-Fit Polygon & Inner-Fit Polygon)
// with Convex Decomposition + Linear-Time Minkowski Sum, Pairwise NFP Caching,
// Exact Concave Part-in-Hole, Multi-Sheet Overflow, Upgraded GA + 3-Move Local
// Search, and Sub-mm Binary-Search Compaction.
//
// Classic script, no DOM, no imports. ClipperLib (tools/clipper.js) powers
// exact polygon boolean ops & Path.offset(). Falls back cleanly to enhanced
// scanline collision search if ClipperLib is absent. Exposed as
// window.MiniSketchNest in the browser and module.exports under Node.
//
// Conventions kept compatible with existing probes & app.js:
//   - all engine coordinates are integer mm * GEOM_SCALE (GEOM_SCALE = 1000)
//   - a path with lcolor '#00ff00' is the SHEET: skipped from placement, its
//     bounds define the sheet size and it appears in placements as the frame
//   - spacing: every part is offset outward by spacing/2 before variants are
//     built, so packing uses the grown shape and visual gap equals spacing
'use strict';

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
    this._edges = null;
    this._edgesDirty = false;
    this._shapeMeta = null;
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
    this._shapeMeta = null;
  }

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
      for (let i = 0; i < path.length; i++) {
        path[i].x += dx;
        path[i].y += dy;
      }
    }
    if (this._cachedBounds) {
      this._cachedBounds.x += dx;
      this._cachedBounds.y += dy;
      this._cachedBounds.pX += dx;
      this._cachedBounds.pY += dy;
      this._cachedBounds.fX = this._cachedBounds.x / GEOM_SCALE;
      this._cachedBounds.fY = this._cachedBounds.y / GEOM_SCALE;
    } else {
      this.invalidateBounds();
    }
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
    for (const path of this.paths) {
      for (let i = 0; i < path.length; i++) {
        const pt = path[i];
        const x = pt.x * cos - pt.y * sin;
        const y = pt.x * sin + pt.y * cos;
        pt.x = x;
        pt.y = y;
      }
    }
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
    for (const path of this.paths) {
      for (let i = 0; i < path.length; i++) {
        path[i].y = 2 * centerY - path[i].y;
      }
    }
    return this;
  }

  clone(dx = 0, dy = 0) {
    const newPaths = this.paths.map(p => p.map(pt => new Point(pt.x + dx, pt.y + dy)));
    const newPath = new Path(newPaths, this.originIndex, this.color, this.lcolor);
    newPath.transformMatrix = this.transformMatrix.slice();
    newPath.transformMatrix[4] += dx;
    newPath.transformMatrix[5] += dy;
    newPath.childIndex = this.childIndex;
    newPath._shapeMeta = this._shapeMeta;
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
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
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

// ---------------------------------------------------------------------------
// Low-level exact polygon & Minkowski / Convex Decomposition helpers
// ---------------------------------------------------------------------------

function _hasClipper() {
  return typeof ClipperLib !== 'undefined' && ClipperLib && ClipperLib.Clipper;
}

function _ringSignedArea(pts) {
  let area = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    area += a.x * b.y - b.x * a.y;
  }
  return area * 0.5;
}

function _ringBounds(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function _cleanRing(pts, eps = 1) {
  if (!pts || pts.length < 3) return [];
  const tmp = [];
  const eps2 = eps * eps;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (tmp.length > 0) {
      const prev = tmp[tmp.length - 1];
      const dx = p.x - prev.x, dy = p.y - prev.y;
      if (dx * dx + dy * dy <= eps2) continue;
    }
    tmp.push({ x: Math.round(p.x), y: Math.round(p.y) });
  }
  while (tmp.length > 1) {
    const first = tmp[0], last = tmp[tmp.length - 1];
    const dx = first.x - last.x, dy = first.y - last.y;
    if (dx * dx + dy * dy <= eps2) tmp.pop();
    else break;
  }
  if (tmp.length < 3) return tmp;
  // Remove collinear intermediate vertices
  const out = [];
  const n = tmp.length;
  for (let i = 0; i < n; i++) {
    const prev = tmp[(i - 1 + n) % n];
    const curr = tmp[i];
    const next = tmp[(i + 1) % n];
    const ax = curr.x - prev.x, ay = curr.y - prev.y;
    const bx = next.x - curr.x, by = next.y - curr.y;
    const cross = ax * by - ay * bx;
    const dot = ax * bx + ay * by;
    if (Math.abs(cross) <= 1 && dot > 0) continue;
    out.push(curr);
  }
  return out.length >= 3 ? out : tmp;
}

function _ensureCCW(pts) {
  const cleaned = _cleanRing(pts);
  if (cleaned.length < 3) return cleaned;
  if (_ringSignedArea(cleaned) < 0) cleaned.reverse();
  return cleaned;
}

function _isConvexRing(pts) {
  const n = pts ? pts.length : 0;
  if (n < 3) return true;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const c = pts[(i + 2) % n];
    const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cr) <= 1e-3) continue;
    const s = cr > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (sign !== s) return false;
  }
  return true;
}

function _isAxisAlignedRect(ccwPts, bounds) {
  if (!ccwPts || ccwPts.length !== 4) return false;
  const b = bounds || _ringBounds(ccwPts);
  const rectArea = b.width * b.height;
  if (!(rectArea > 0)) return false;
  const polyArea = Math.abs(_ringSignedArea(ccwPts));
  if (Math.abs(polyArea - rectArea) > rectArea * 0.0005 + 10) return false;
  for (let i = 0; i < 4; i++) {
    const p1 = ccwPts[i], p2 = ccwPts[(i + 1) % 4];
    if (Math.abs(p1.x - p2.x) > 2 && Math.abs(p1.y - p2.y) > 2) return false;
  }
  return true;
}

function _convexHullCCW(pts) {
  if (pts.length <= 3) return _ensureCCW(pts);
  const sorted = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (let i = 0; i < sorted.length; i++) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], sorted[i]) <= 0) {
      lower.pop();
    }
    lower.push(sorted[i]);
  }
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], sorted[i]) <= 0) {
      upper.pop();
    }
    upper.push(sorted[i]);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// Conservative polygon simplification: if a ring has more than `maxVerts`
// vertices, simplify with RDP and expand outward (or shrink inward for holes)
// by the RDP tolerance so the collision proxy strictly encloses the real part
// (or sits strictly inside a hole) -> guaranteed zero false overlaps.
function _simplifySafe(ccwPts, maxVerts, isHole) {
  if (!ccwPts || ccwPts.length <= maxVerts || !_hasClipper()) return ccwPts;
  const tols = [0.15, 0.3, 0.6, 1.0, 1.8, 3.0];
  let best = ccwPts;
  let usedTol = 0;
  for (let t = 0; t < tols.length; t++) {
    const tol = tols[t] * GEOM_SCALE;
    const simp = GeometryUtil.rdpClosed(ccwPts, tol);
    if (simp.length >= 3) {
      best = simp;
      usedTol = tol;
      if (simp.length <= maxVerts) break;
    }
  }
  if (best === ccwPts || best.length >= ccwPts.length) return ccwPts;
  try {
    const cpath = best.map(p => ({ X: Math.round(p.x), Y: Math.round(p.y) }));
    const co = new ClipperLib.ClipperOffset(2, usedTol * 0.25);
    co.AddPath(cpath, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
    const sol = new ClipperLib.Paths();
    // Positive offset expands CCW outer ring; negative shrinks hole inward
    const delta = isHole ? -usedTol : usedTol;
    co.Execute(sol, delta);
    if (sol.length === 1 && sol[0].length >= 3) {
      const out = _ensureCCW(sol[0].map(p => ({ x: p.X, y: p.Y })));
      if (out.length >= 3 && out.length < ccwPts.length) return out;
    }
  } catch (e) { /* keep original on any Clipper error */ }
  return ccwPts;
}

// Point-in-triangle test (inclusive) for ear-clipping
function _pointInTri(px, py, ax, ay, bx, by, cx, cy) {
  const c1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  if (c1 < 0) return false;
  const c2 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
  if (c2 < 0) return false;
  const c3 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
  return c3 >= 0;
}

// Ear-clipping triangulation + Hertel-Mehlhorn greedy convex merge.
// Input: simple CCW polygon `pts` (array of {x, y}).
// Output: array of CCW convex polygons (each array of {x, y}).
function _decomposeConvex(pts) {
  const n = pts ? pts.length : 0;
  if (n < 3) return [];
  if (n === 3 || _isConvexRing(pts)) return [pts];

  // Build index ring for ear-clipping
  const idx = [];
  for (let i = 0; i < n; i++) idx.push(i);
  const triangles = [];
  let guard = n * n * 2;
  let earStart = 0;

  while (idx.length > 3 && guard-- > 0) {
    const m = idx.length;
    let found = false;
    for (let step = 0; step < m; step++) {
      const k = (earStart + step) % m;
      const iPrev = idx[(k - 1 + m) % m];
      const iCurr = idx[k];
      const iNext = idx[(k + 1) % m];
      const a = pts[iPrev], b = pts[iCurr], c = pts[iNext];
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (cross <= 0) continue; // reflex or collinear

      let blocked = false;
      for (let j = 0; j < m; j++) {
        const ij = idx[j];
        if (ij === iPrev || ij === iCurr || ij === iNext) continue;
        const p = pts[ij];
        // Ignore exact duplicates of triangle corners
        if ((p.x === a.x && p.y === a.y) || (p.x === b.x && p.y === b.y) || (p.x === c.x && p.y === c.y)) continue;
        if (_pointInTri(p.x, p.y, a.x, a.y, b.x, b.y, c.x, c.y)) {
          blocked = true;
          break;
        }
      }
      if (!blocked) {
        triangles.push([iPrev, iCurr, iNext]);
        idx.splice(k, 1);
        earStart = k % idx.length;
        found = true;
        break;
      }
    }
    if (!found) {
      // Degenerate/collinear fallback: clip most-convex positive-area corner
      let bestK = -1, bestArea = -Infinity;
      for (let k = 0; k < m; k++) {
        const a = pts[idx[(k - 1 + m) % m]];
        const b = pts[idx[k]];
        const c = pts[idx[(k + 1) % m]];
        const cr = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        if (cr > bestArea) { bestArea = cr; bestK = k; }
      }
      if (bestK < 0 || bestArea <= 0) {
        // Fallback to convex hull (strictly enclosing -> safe)
        return [_convexHullCCW(pts)];
      }
      triangles.push([idx[(bestK - 1 + m) % m], idx[bestK], idx[(bestK + 1) % m]]);
      idx.splice(bestK, 1);
      earStart = bestK % idx.length;
    }
  }
  if (idx.length === 3) {
    const a = pts[idx[0]], b = pts[idx[1]], c = pts[idx[2]];
    const cr = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (cr > 0) triangles.push([idx[0], idx[1], idx[2]]);
  }
  if (!triangles.length) return [_convexHullCCW(pts)];

  // Hertel-Mehlhorn greedy merge of adjacent convex polygons sharing a diagonal
  const polys = triangles;
  let merged = true;
  while (merged) {
    merged = false;
    outer:
    for (let i = 0; i < polys.length; i++) {
      const p1 = polys[i];
      const len1 = p1.length;
      for (let e1 = 0; e1 < len1; e1++) {
        const u = p1[e1];
        const v = p1[(e1 + 1) % len1];
        for (let j = i + 1; j < polys.length; j++) {
          const p2 = polys[j];
          const len2 = p2.length;
          // Look for opposite directed edge v -> u in p2
          let e2 = -1;
          for (let k = 0; k < len2; k++) {
            if (p2[k] === v && p2[(k + 1) % len2] === u) { e2 = k; break; }
          }
          if (e2 < 0) continue;
          // Check convexity at u and v after removing diagonal (u, v)
          const uPrev = pts[p1[(e1 - 1 + len1) % len1]];
          const uPt = pts[u];
          const uNext = pts[p2[(e2 + 2) % len2]];
          if ((uPt.x - uPrev.x) * (uNext.y - uPt.y) - (uPt.y - uPrev.y) * (uNext.x - uPt.x) < -1e-2) continue;

          const vPrev = pts[p2[(e2 - 1 + len2) % len2]];
          const vPt = pts[v];
          const vNext = pts[p1[(e1 + 2) % len1]];
          if ((vPt.x - vPrev.x) * (vNext.y - vPt.y) - (vPt.y - vPrev.y) * (vNext.x - vPt.x) < -1e-2) continue;

          // Merge p1 and p2
          const combined = [];
          for (let k = 0; k < len1; k++) {
            const idx1 = (e1 + 1 + k) % len1;
            combined.push(p1[idx1]);
            if (idx1 === e1) {
              for (let m2 = 2; m2 < len2; m2++) {
                combined.push(p2[(e2 + m2) % len2]);
              }
            }
          }
          polys[i] = combined;
          polys.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }

  return polys.map(indices => indices.map(k => pts[k]));
}

// Reorder a convex CCW polygon (or 2-point segment) so vertex 0 is lowest-y,
// tie-breaking by lowest-x.
function _reorderLowest(pts) {
  const n = pts.length;
  let best = 0;
  for (let i = 1; i < n; i++) {
    if (pts[i].y < pts[best].y || (pts[i].y === pts[best].y && pts[i].x < pts[best].x)) {
      best = i;
    }
  }
  if (best === 0) return pts;
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = pts[(best + i) % n];
  return out;
}

// Exact O(n + m) Minkowski Sum of two CCW convex polygons (or a 2-vertex
// segment and a CCW convex polygon). Uses half-plane + cross-product angular
// ordering — zero trig, exact across [0, 2*pi). Returns Clipper Path [{X, Y}].
function _minkowskiSumConvex(A, B) {
  const n = A.length, m = B.length;
  if (n < 2 || m < 2) return [];
  const a = _reorderLowest(A);
  const b = _reorderLowest(B);
  const res = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    const pa = a[i % n];
    const pb = b[j % m];
    const X = Math.round(pa.x + pb.x);
    const Y = Math.round(pa.y + pb.y);
    if (res.length === 0 || res[res.length - 1].X !== X || res[res.length - 1].Y !== Y) {
      res.push({ X, Y });
    }
    if (i >= n) { j++; continue; }
    if (j >= m) { i++; continue; }
    const paNext = a[(i + 1) % n];
    const pbNext = b[(j + 1) % m];
    const eax = paNext.x - pa.x, eay = paNext.y - pa.y;
    const ebx = pbNext.x - pb.x, eby = pbNext.y - pb.y;
    const ha = (eay > 0 || (eay === 0 && eax > 0)) ? 0 : 1;
    const hb = (eby > 0 || (eby === 0 && ebx > 0)) ? 0 : 1;
    if (ha !== hb) {
      if (ha < hb) i++;
      else j++;
    } else {
      const cr = eax * eby - eay * ebx;
      if (cr > 0) i++;
      else if (cr < 0) j++;
      else { i++; j++; }
    }
  }
  if (res.length > 1 && res[0].X === res[res.length - 1].X && res[0].Y === res[res.length - 1].Y) {
    res.pop();
  }
  return res;
}

function _clipperPathsBounds(cpaths) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < cpaths.length; i++) {
    const ring = cpaths[i];
    for (let j = 0; j < ring.length; j++) {
      const p = ring[j];
      if (p.X < minX) minX = p.X;
      if (p.X > maxX) maxX = p.X;
      if (p.Y < minY) minY = p.Y;
      if (p.Y > maxY) maxY = p.Y;
    }
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function _pointInClipperRing(px, py, ring) {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i].X, yi = ring[i].Y;
    const xj = ring[j].X, yj = ring[j].Y;
    if (((yi > py) !== (yj > py)) &&
      (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function _pointInClipperPaths(px, py, cpaths) {
  let parity = false;
  for (let i = 0; i < cpaths.length; i++) {
    if (_pointInClipperRing(px, py, cpaths[i])) parity = !parity;
  }
  return parity;
}

// ---------------------------------------------------------------------------
// NFPCache: shape deduplication + exact NFP / IFP memoization
// ---------------------------------------------------------------------------

class NFPCache {
  constructor(opts = {}) {
    this.maxVerts = opts.maxVerts || 56;
    this.maxEntries = opts.maxEntries || 12000;
    this.shapeCache = new Map();
    this.nfpCache = new Map();
    this.ifpCache = new Map();
    this.stats = {
      shapeHits: 0,
      shapeMisses: 0,
      nfpHits: 0,
      nfpMisses: 0,
      ifpHits: 0,
      ifpMisses: 0
    };
  }

  _shapeKeyFromPath(path) {
    const b = path.getBounds();
    const ox = b.x, oy = b.y;
    const parts = [];
    for (let r = 0; r < path.paths.length; r++) {
      const ring = path.paths[r];
      const coords = new Array(ring.length * 2);
      for (let i = 0; i < ring.length; i++) {
        coords[i * 2] = Math.round((ring[i].x - ox) * 0.1);
        coords[i * 2 + 1] = Math.round((ring[i].y - oy) * 0.1);
      }
      parts.push(coords.join(','));
    }
    return parts.join(';');
  }

  getShape(path) {
    if (path._shapeMeta && path._shapeMeta._cacheId === this) {
      this.stats.shapeHits++;
      return path._shapeMeta;
    }
    const key = this._shapeKeyFromPath(path);
    const existing = this.shapeCache.get(key);
    if (existing) {
      path._shapeMeta = existing;
      this.stats.shapeHits++;
      return existing;
    }
    this.stats.shapeMisses++;
    const b = path.getBounds();
    const ox = b.x, oy = b.y;
    const rawOuter = path.paths[0].map(p => ({ x: Math.round(p.x - ox), y: Math.round(p.y - oy) }));
    let outerCCW = _ensureCCW(rawOuter);
    outerCCW = _simplifySafe(outerCCW, this.maxVerts, false);
    const bounds = _ringBounds(outerCCW);
    const isRect = _isAxisAlignedRect(outerCCW, bounds);
    const outerArea = Math.abs(_ringSignedArea(outerCCW));
    const convexParts = isRect ? [outerCCW] : _decomposeConvex(outerCCW);
    const negConvexParts = convexParts.map(cp =>
      _reorderLowest(cp.map(p => ({ x: -p.x, y: -p.y })))
    );

    // Pick a guaranteed interior point of the shape (centroid of largest convex piece)
    let bestPiece = convexParts[0] || outerCCW;
    let bestPieceArea = -1;
    for (let i = 0; i < convexParts.length; i++) {
      const a = Math.abs(_ringSignedArea(convexParts[i]));
      if (a > bestPieceArea) { bestPieceArea = a; bestPiece = convexParts[i]; }
    }
    let icx = 0, icy = 0;
    for (let i = 0; i < bestPiece.length; i++) {
      icx += bestPiece[i].x;
      icy += bestPiece[i].y;
    }
    const interiorPt = bestPiece.length
      ? { x: Math.round(icx / bestPiece.length), y: Math.round(icy / bestPiece.length) }
      : { x: Math.round(bounds.width * 0.5), y: Math.round(bounds.height * 0.5) };

    const holes = [];
    let holeAreaSum = 0;
    for (let r = 1; r < path.paths.length; r++) {
      const rawHole = path.paths[r].map(p => ({ x: Math.round(p.x - ox), y: Math.round(p.y - oy) }));
      let holeCCW = _ensureCCW(rawHole);
      holeCCW = _simplifySafe(holeCCW, Math.max(32, Math.floor(this.maxVerts * 0.8)), true);
      if (holeCCW.length < 3) continue;
      const hb = _ringBounds(holeCCW);
      const ha = Math.abs(_ringSignedArea(holeCCW));
      if (ha < 100) continue;
      holeAreaSum += ha;
      holes.push({
        key: key + ':h' + r,
        ringCCW: holeCCW,
        bounds: hb,
        area: ha,
        isRect: _isAxisAlignedRect(holeCCW, hb)
      });
    }

    const meta = {
      _cacheId: this,
      key,
      width: Math.round(b.width),
      height: Math.round(b.height),
      outerCCW,
      bounds,
      isRect,
      area: Math.max(1, outerArea - holeAreaSum),
      outerArea,
      convexParts,
      negConvexParts,
      interiorPt,
      holes
    };
    this.shapeCache.set(key, meta);
    path._shapeMeta = meta;
    return meta;
  }

  // Exact Inner-Fit Polygon IFP(container, metaB): set of bbox-min positions
  // (tx, ty) of B such that B_0 + (tx, ty) lies completely inside `container`.
  // Topological theorem: (B + t) subset H  <=>  t in (H - b0) \ (dH (+) -B)
  // where b0 is any interior point of B.
  computeExactIFP(containerRingCCW, containerBounds, containerIsRect, metaB, insetUnits = 0) {
    const bw = metaB.width;
    const bh = metaB.height;
    const cw = containerBounds.width;
    const ch = containerBounds.height;
    if (bw > cw - 2 * insetUnits + 1 || bh > ch - 2 * insetUnits + 1) {
      return [];
    }
    if (containerIsRect) {
      const x0 = Math.round(containerBounds.minX + insetUnits);
      const y0 = Math.round(containerBounds.minY + insetUnits);
      const x1 = Math.round(containerBounds.maxX - bw - insetUnits);
      const y1 = Math.round(containerBounds.maxY - bh - insetUnits);
      if (x1 < x0 || y1 < y0) return [];
      return [[
        { X: x0, Y: y0 },
        { X: x1, Y: y0 },
        { X: x1, Y: y1 },
        { X: x0, Y: y1 }
      ]];
    }
    if (!_hasClipper()) return [];

    // Optionally inset container inward so tight hole/custom-sheet fits stay
    // strictly inside ray-cast checks.
    let rings = [containerRingCCW];
    if (insetUnits > 0) {
      const co = new ClipperLib.ClipperOffset();
      co.AddPath(containerRingCCW.map(p => ({ X: p.x, Y: p.y })), ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
      const shrunk = new ClipperLib.Paths();
      co.Execute(shrunk, -insetUnits);
      if (!shrunk.length) return [];
      rings = shrunk.map(r => _ensureCCW(r.map(p => ({ x: p.X, y: p.Y }))));
    }

    const b0 = metaB.interiorPt;
    const negParts = metaB.negConvexParts;
    const allIFP = [];

    for (let ri = 0; ri < rings.length; ri++) {
      const H = rings[ri];
      if (H.length < 3) continue;
      const hShifted = H.map(p => ({ X: Math.round(p.x - b0.x), Y: Math.round(p.y - b0.y) }));
      const sweepClipper = new ClipperLib.Clipper();
      const hn = H.length;
      for (let ei = 0; ei < hn; ei++) {
        const seg = [H[ei], H[(ei + 1) % hn]];
        if (seg[0].x === seg[1].x && seg[0].y === seg[1].y) continue;
        for (let q = 0; q < negParts.length; q++) {
          const swept = _minkowskiSumConvex(seg, negParts[q]);
          if (swept.length >= 3) {
            sweepClipper.AddPath(swept, ClipperLib.PolyType.ptSubject, true);
          }
        }
      }
      const sweepUnion = new ClipperLib.Paths();
      sweepClipper.Execute(
        ClipperLib.ClipType.ctUnion,
        sweepUnion,
        ClipperLib.PolyFillType.pftNonZero,
        ClipperLib.PolyFillType.pftNonZero
      );

      const diffClipper = new ClipperLib.Clipper();
      diffClipper.AddPath(hShifted, ClipperLib.PolyType.ptSubject, true);
      if (sweepUnion.length) {
        diffClipper.AddPaths(sweepUnion, ClipperLib.PolyType.ptClip, true);
      }
      const sol = new ClipperLib.Paths();
      diffClipper.Execute(
        ClipperLib.ClipType.ctDifference,
        sol,
        ClipperLib.PolyFillType.pftNonZero,
        ClipperLib.PolyFillType.pftNonZero
      );
      for (let s = 0; s < sol.length; s++) {
        if (sol[s].length >= 3) allIFP.push(sol[s]);
      }
    }
    return allIFP;
  }

  getSheetIFP(sheetMeta, metaB) {
    const key = 'S|' + sheetMeta.key + '|' + metaB.key;
    const hit = this.ifpCache.get(key);
    if (hit !== undefined) {
      this.stats.ifpHits++;
      return hit;
    }
    this.stats.ifpMisses++;
    const inset = sheetMeta.isRect ? 0 : 2;
    const paths = this.computeExactIFP(
      sheetMeta.outerCCW,
      sheetMeta.bounds,
      sheetMeta.isRect,
      metaB,
      inset
    );
    const res = {
      paths,
      isRect: sheetMeta.isRect,
      bbox: paths.length ? _clipperPathsBounds(paths) : null
    };
    if (this.ifpCache.size > this.maxEntries) this.ifpCache.clear();
    this.ifpCache.set(key, res);
    return res;
  }

  // Exact No-Fit Polygon NFP(metaA, metaB) with holes of A carved out via
  // exact IFP(hole_i, metaB).
  getNFP(metaA, metaB) {
    const key = metaA.key + '|' + metaB.key;
    const hit = this.nfpCache.get(key);
    if (hit !== undefined) {
      this.stats.nfpHits++;
      return hit;
    }
    this.stats.nfpMisses++;

    let nfpPaths;
    if (metaA.isRect && metaB.isRect && metaA.holes.length === 0) {
      // O(1) exact rectangle-rectangle NFP: [-bw, aw] x [-bh, ah]
      nfpPaths = [[
        { X: -metaB.width, Y: -metaB.height },
        { X: metaA.width, Y: -metaB.height },
        { X: metaA.width, Y: metaA.height },
        { X: -metaB.width, Y: metaA.height }
      ]];
    } else if (_hasClipper()) {
      const c = new ClipperLib.Clipper();
      const partsA = metaA.convexParts;
      const negB = metaB.negConvexParts;
      for (let i = 0; i < partsA.length; i++) {
        for (let j = 0; j < negB.length; j++) {
          const sum = _minkowskiSumConvex(partsA[i], negB[j]);
          if (sum.length >= 3) c.AddPath(sum, ClipperLib.PolyType.ptSubject, true);
        }
      }
      nfpPaths = new ClipperLib.Paths();
      c.Execute(
        ClipperLib.ClipType.ctUnion,
        nfpPaths,
        ClipperLib.PolyFillType.pftNonZero,
        ClipperLib.PolyFillType.pftNonZero
      );
      if (nfpPaths.length) {
        nfpPaths = ClipperLib.Clipper.CleanPolygons(nfpPaths, 2);
      }
    } else {
      nfpPaths = [];
    }

    // Carve out exact IFPs for any holes in A that can accommodate B
    const holeIFPs = [];
    if (metaA.holes.length > 0 && nfpPaths.length > 0 && _hasClipper()) {
      const holeClip = [];
      for (let hi = 0; hi < metaA.holes.length; hi++) {
        const h = metaA.holes[hi];
        if (metaB.width > h.bounds.width - 4 || metaB.height > h.bounds.height - 4) continue;
        // Inset hole by 3 units (0.003mm) so ray-cast polyOutsideAt stays strictly inside
        const hifp = this.computeExactIFP(h.ringCCW, h.bounds, h.isRect, metaB, 3);
        if (hifp.length > 0) {
          const hb = _clipperPathsBounds(hifp);
          holeIFPs.push({ paths: hifp, area: h.area, bbox: hb });
          for (let k = 0; k < hifp.length; k++) holeClip.push(hifp[k]);
        }
      }
      if (holeClip.length > 0) {
        const dc = new ClipperLib.Clipper();
        dc.AddPaths(nfpPaths, ClipperLib.PolyType.ptSubject, true);
        dc.AddPaths(holeClip, ClipperLib.PolyType.ptClip, true);
        const carved = new ClipperLib.Paths();
        dc.Execute(
          ClipperLib.ClipType.ctDifference,
          carved,
          ClipperLib.PolyFillType.pftNonZero,
          ClipperLib.PolyFillType.pftNonZero
        );
        nfpPaths = carved;
      }
    }

    const entry = {
      paths: nfpPaths,
      bbox: nfpPaths.length ? _clipperPathsBounds(nfpPaths) : { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 },
      holeIFPs
    };
    if (this.nfpCache.size > this.maxEntries) this.nfpCache.clear();
    this.nfpCache.set(key, entry);
    return entry;
  }
}

// ---------------------------------------------------------------------------
// GeometryUtil (with fixed concave polyOutsideAt & sub-mm binary compaction)
// ---------------------------------------------------------------------------

const GeometryUtil = {
  distance: function (p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
  },

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

  polyOutside: function (poly1, poly2, idx = 0) {
    return this.polyOutsideAt(poly1, 0, 0, poly2, idx);
  },

  lineSegmentsIntersect: function (p1, p2, p3, p4) {
    return this.lineSegmentsIntersectXY(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y, p4.x, p4.y);
  },

  lineSegmentsIntersectXY: function (x1, y1, x2, y2, x3, y3, x4, y4) {
    const ccw1 = (y4 - y1) * (x3 - x1) > (y3 - y1) * (x4 - x1);
    const ccw2 = (y4 - y2) * (x3 - x2) > (y3 - y2) * (x4 - x2);
    if (ccw1 === ccw2) return false;
    const ccw3 = (y3 - y1) * (x2 - x1) > (y2 - y1) * (x3 - x1);
    const ccw4 = (y4 - y1) * (x2 - x1) > (y2 - y1) * (x4 - x1);
    return ccw3 !== ccw4;
  },

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

  // Exact containment check: returns true if ANY part of poly1+(dx,dy) falls
  // outside poly2.paths[idx]. Now handles CONCAVE holes & concave custom sheets
  // by verifying both vertex containment AND that no edge of poly1 crosses or
  // chords outside a concave boundary.
  polyOutsideAt: function (poly1, dx, dy, poly2, idx = 0) {
    const points = poly1.paths[0];
    const target = poly2.paths[idx];
    const len = points.length;
    const tlen = target.length;
    if (!len || tlen < 3) return true;

    // Fast path for axis-aligned rectangular sheet (idx === 0, lcolor === '#00ff00')
    if (idx === 0 && poly2.lcolor === '#00ff00') {
      if (target._isRect === undefined) {
        const tb = _ringBounds(target);
        target._isRect = _isAxisAlignedRect(_ensureCCW(target), tb);
        target._rectBounds = tb;
      }
      if (target._isRect) {
        const b1 = poly1.getBounds();
        const tb = target._rectBounds;
        const x0 = b1.x + dx, y0 = b1.y + dy;
        return (x0 < tb.minX - 1 || y0 < tb.minY - 1 ||
          x0 + b1.width > tb.maxX + 1 || y0 + b1.height > tb.maxY + 1);
      }
    }

    // 1. All vertices of poly1 must lie inside target
    for (let i = 0; i < len; i++) {
      const p = points[i];
      if (!this.pointInPolygonOffset(p.x + dx, p.y + dy, target, 0, 0)) return true;
    }

    // 2. If target is convex, vertex containment is mathematically sufficient.
    if (target._isConvex === undefined) {
      target._isConvex = _isConvexRing(target);
    }
    if (target._isConvex) return false;

    // 3. Concave container (concave hole or concave sheet): verify no edge
    //    crosses the boundary AND every edge midpoint stays inside target.
    for (let i = 0; i < len; i++) {
      const a = points[i];
      const b = points[(i + 1) % len];
      const ax = a.x + dx, ay = a.y + dy;
      const bx = b.x + dx, by = b.y + dy;
      if (!this.pointInPolygonOffset((ax + bx) * 0.5, (ay + by) * 0.5, target, 0, 0)) {
        return true;
      }
      const eMinX = ax < bx ? ax : bx;
      const eMaxX = ax > bx ? ax : bx;
      const eMinY = ay < by ? ay : by;
      const eMaxY = ay > by ? ay : by;
      for (let j = 0; j < tlen; j++) {
        const c = target[j];
        const d = target[(j + 1) % tlen];
        const tMinX = c.x < d.x ? c.x : d.x;
        const tMaxX = c.x > d.x ? c.x : d.x;
        if (eMaxX < tMinX || tMaxX < eMinX) continue;
        const tMinY = c.y < d.y ? c.y : d.y;
        const tMaxY = c.y > d.y ? c.y : d.y;
        if (eMaxY < tMinY || tMaxY < eMinY) continue;
        if (this.lineSegmentsIntersectXY(ax, ay, bx, by, c.x, c.y, d.x, d.y)) {
          return true;
        }
      }
    }
    return false;
  },

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

    // If poly2 has holes, poly1 strictly inside a hole is valid and earns
    // best-fit insideBonus (smaller hole = higher bonus).
    if (poly2.paths.length > 1 && checkchild) {
      let bestHoleArea = Infinity;
      for (let i = 1; i < poly2.paths.length; i++) {
        if (!this.polyOutsideAt(poly1, dx, dy, poly2, i)) {
          const ha = Math.abs(Path.getSignedArea(poly2.paths[i]));
          if (ha < bestHoleArea) bestHoleArea = ha;
        }
      }
      if (bestHoleArea < Infinity) {
        const normArea = Math.max(1, bestHoleArea / (GEOM_SCALE * GEOM_SCALE));
        poly1.insideBonus = 10000 * GEOM_SCALE + (1e6 / normArea);
        return false;
      }
    }

    const path1 = poly1.paths[0];
    const path2 = poly2.paths[0];
    const len1 = path1.length;
    const len2 = path2.length;
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

  // Sub-mm binary-search settling pass: slides parts toward (-Y, -X) and
  // diagonal (-X, -Y) with decaying steps from 4mm down to 0.05mm. Faster and
  // 20x tighter than fixed 1mm stepping.
  compactLayout(placements, collisionCheck) {
    const items = placements.filter(p => p.lcolor !== '#00ff00');
    if (items.length === 0) return 0;
    const steps = [4 * GEOM_SCALE, 2 * GEOM_SCALE, 1 * GEOM_SCALE, 500, 200, 50];
    const dirs = [
      [0, -1],
      [-1, 0],
      [-1, -1]
    ];

    let totalMoved = 0;
    for (let pass = 0; pass < 2; pass++) {
      items.sort((a, b) => {
        const bA = a.getBounds();
        const bB = b.getBounds();
        if (pass === 0) return (bA.y - bB.y) || (bA.x - bB.x);
        return (bA.x - bB.x) || (bA.y - bB.y);
      });

      let passMoved = 0;
      for (let idx = 0; idx < items.length; idx++) {
        const part = items[idx];
        collisionCheck(part, 'start');
        for (let si = 0; si < steps.length; si++) {
          const step = steps[si];
          for (let di = 0; di < dirs.length; di++) {
            const dx = dirs[di][0] * step;
            const dy = dirs[di][1] * step;
            let guard = 64;
            while (guard-- > 0) {
              const b = part.getBounds();
              if (b.x + dx < 0 || b.y + dy < 0) break;
              part.translate(dx, dy);
              if (collisionCheck(part, 'check')) {
                part.translate(-dx, -dy);
                break;
              }
              totalMoved++;
              passMoved++;
            }
          }
        }
        collisionCheck(part, 'end');
      }
      if (passMoved === 0) break;
    }
    return totalMoved;
  }
};

// ---------------------------------------------------------------------------
// Spatial Hash
// ---------------------------------------------------------------------------

let _spatialHashQuerySeq = 0;

class NFP2SpatialHash {
  constructor(cellSize) {
    this.cellSize = cellSize;
    this.grid = new Map();
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
        let cell = this.grid.get(key);
        if (!cell) { cell = []; this.grid.set(key, cell); }
        cell.push(part);
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

  query(bx, by, bw, bh) {
    const startX = Math.floor(bx / this.cellSize);
    const endX = Math.floor((bx + bw) / this.cellSize);
    const startY = Math.floor(by / this.cellSize);
    const endY = Math.floor((by + bh) / this.cellSize);
    const results = this.resultArray;
    results.length = 0;
    const qId = ++_spatialHashQuerySeq;
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

// ---------------------------------------------------------------------------
// NFP2 Decoder: True NFP/IFP exact sliding placement + scanline fallback
// ---------------------------------------------------------------------------

class NFP2 {
  constructor() {
    this.spacing = 0;
    this.allowFlip = true;
    this.performanceStats = {
      boundaryPointsTested: 0,
      collisionAvoided: 0,
      collisionChecks: 0,
      nfpExactCalls: 0,
      fallbackCalls: 0
    };
    this.spatialHash = null;
    this.gridSize = 10;
    this.hascustomsheet = false;
    this.fitnessMode = 'area';
    this.nfpCache = null;
    this.useExactNFP = true;
  }

  setSpacing(spacing) {
    this.spacing = spacing * GEOM_SCALE;
    this.gridSize = spacing > 0 ? spacing * GEOM_SCALE : GEOM_SCALE;
  }
  setAllowFlip(allowFlip) { this.allowFlip = allowFlip; }

  _gravityScore(b, dx, dy, holePenalty) {
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    return (cy + dy) * 2 + (cx + dx) * 0.1 + holePenalty;
  }

  _getSheetMeta(sheet, sheetParts) {
    const cache = this.nfpCache;
    if (sheetParts.length > 0) {
      return cache.getShape(sheetParts[0]);
    }
    const w = Math.round(sheet.width);
    const h = Math.round(sheet.height);
    const key = 'RECT_SHEET:' + w + 'x' + h;
    let meta = cache.shapeCache.get(key);
    if (!meta) {
      const rectPts = [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h }
      ];
      meta = {
        _cacheId: cache,
        key,
        width: w,
        height: h,
        outerCCW: rectPts,
        bounds: { minX: 0, minY: 0, maxX: w, maxY: h, width: w, height: h },
        isRect: true,
        area: Math.max(1, w * h),
        outerArea: Math.max(1, w * h),
        convexParts: [rectPts],
        negConvexParts: [],
        interiorPt: { x: Math.round(w * 0.5), y: Math.round(h * 0.5) },
        holes: []
      };
      cache.shapeCache.set(key, meta);
    }
    return meta;
  }

  findBestPosition(parts, sheet, progressHandler, gridSize, initialPlacements = []) {
    const scaledGridSize = gridSize;
    const scaledSheet = {
      width: sheet.width * GEOM_SCALE,
      height: sheet.height * GEOM_SCALE
    };
    this.performanceStats = {
      boundaryPointsTested: 0,
      collisionAvoided: 0,
      collisionChecks: 0,
      nfpExactCalls: 0,
      fallbackCalls: 0
    };
    if (!this.nfpCache) this.nfpCache = new NFPCache();

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
    return bestPlacementsAll;
  }

  _runPlacementPasses(parts, bestPlacementsAll, scaledSheet, scaledGridSize, progressHandler, totalParts) {
    const partData = new Map();
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
      const v0 = part.variants[0];
      const area = Math.abs(Path.getSignedArea(v0.paths[0]));
      partData.set(part, { area });
    }

    const remainingParts = parts.filter(part => !part.placed && part.lcolor !== '#00ff00');
    remainingParts.sort((a, b) => partData.get(b).area - partData.get(a).area);

    for (const part of remainingParts) {
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

  // Exact True NFP/IFP placement: computes Feasible(B) = IFP(Sheet, B) \ U NFP(P_i, B)
  // via cached Minkowski NFPs, scores all feasible contact vertices (including
  // exact concave hole cavities), and verifies top candidates with checkCollisions.
  _findExactNFPPlacement(part, placedPartsAll, sheetParts, placedNonSheet, sheet) {
    const cache = this.nfpCache || (this.nfpCache = new NFPCache());
    const sheetMeta = this._getSheetMeta(sheet, sheetParts);

    // Current block bounds of already-placed parts
    let hasPlaced = placedNonSheet.length > 0;
    let curMinX = Infinity, curMinY = Infinity, curMaxX = -Infinity, curMaxY = -Infinity;
    for (let i = 0; i < placedNonSheet.length; i++) {
      const pb = placedNonSheet[i].getBounds();
      if (pb.x < curMinX) curMinX = pb.x;
      if (pb.y < curMinY) curMinY = pb.y;
      if (pb.x + pb.width > curMaxX) curMaxX = pb.x + pb.width;
      if (pb.y + pb.height > curMaxY) curMaxY = pb.y + pb.height;
    }

    let bestPlacement = null;
    let bestScore = Infinity;

    const PAD = 8; // 0.008mm pad on rect IFP during ctDifference so 0-clearance fits never collapse
    const isStrip = this.fitnessMode === 'strip';

    for (let vi = 0; vi < part.variants.length; vi++) {
      const variant = part.variants[vi];
      const vb = variant.getBounds();
      const metaB = cache.getShape(variant);
      const sheetIFP = cache.getSheetIFP(sheetMeta, metaB);
      if (!sheetIFP.paths.length) continue;

      const bw = metaB.width;
      const bh = metaB.height;
      const ifpBBox = sheetIFP.bbox;
      const isRectSheet = sheetIFP.isRect;
      const maxValidX = ifpBBox.maxX;
      const maxValidY = ifpBBox.maxY;
      const minValidX = ifpBBox.minX;
      const minValidY = ifpBBox.minY;

      let feasibleRings;
      const activeHoles = [];

      if (!hasPlaced) {
        feasibleRings = sheetIFP.paths;
      } else {
        // Subject: sheet IFP (padded slightly for rect sheets so zero-width
        // tight fits produce boundary edges we clamp back onto the exact IFP)
        const subjectPaths = isRectSheet
          ? [[
            { X: minValidX - PAD, Y: minValidY - PAD },
            { X: maxValidX + PAD, Y: minValidY - PAD },
            { X: maxValidX + PAD, Y: maxValidY + PAD },
            { X: minValidX - PAD, Y: maxValidY + PAD }
          ]]
          : sheetIFP.paths;

        const subjMinX = isRectSheet ? minValidX - PAD : ifpBBox.minX;
        const subjMinY = isRectSheet ? minValidY - PAD : ifpBBox.minY;
        const subjMaxX = isRectSheet ? maxValidX + PAD : ifpBBox.maxX;
        const subjMaxY = isRectSheet ? maxValidY + PAD : ifpBBox.maxY;

        const clipper = new ClipperLib.Clipper();
        clipper.AddPaths(subjectPaths, ClipperLib.PolyType.ptSubject, true);
        let clipCount = 0;

        for (let pi = 0; pi < placedNonSheet.length; pi++) {
          const placed = placedNonSheet[pi];
          const metaA = cache.getShape(placed);
          const nfp = cache.getNFP(metaA, metaB);
          if (!nfp.paths.length) continue;
          const pb = placed.getBounds();
          const px = Math.round(pb.x);
          const py = Math.round(pb.y);

          // Fast bbox cull against sheet IFP
          if (nfp.bbox.maxX + px < subjMinX || nfp.bbox.minX + px > subjMaxX ||
            nfp.bbox.maxY + py < subjMinY || nfp.bbox.minY + py > subjMaxY) {
            continue;
          }

          for (let r = 0; r < nfp.paths.length; r++) {
            const ring = nfp.paths[r];
            const translated = new Array(ring.length);
            for (let k = 0; k < ring.length; k++) {
              translated[k] = { X: ring[k].X + px, Y: ring[k].Y + py };
            }
            clipper.AddPath(translated, ClipperLib.PolyType.ptClip, true);
            clipCount++;
          }

          if (nfp.holeIFPs.length > 0 && variant.paths.length === 1) {
            for (let hi = 0; hi < nfp.holeIFPs.length; hi++) {
              const hf = nfp.holeIFPs[hi];
              activeHoles.push({
                area: hf.area,
                ox: px,
                oy: py,
                minX: hf.bbox.minX + px - 2,
                maxX: hf.bbox.maxX + px + 2,
                minY: hf.bbox.minY + py - 2,
                maxY: hf.bbox.maxY + py + 2,
                paths: hf.paths
              });
            }
          }
        }

        if (clipCount === 0) {
          feasibleRings = sheetIFP.paths;
        } else {
          feasibleRings = new ClipperLib.Paths();
          clipper.Execute(
            ClipperLib.ClipType.ctDifference,
            feasibleRings,
            ClipperLib.PolyFillType.pftNonZero,
            ClipperLib.PolyFillType.pftNonZero
          );
        }
      }

      if (!feasibleRings || feasibleRings.length === 0) continue;

      // Collect candidate target bbox-min points (tx, ty) from feasible vertices
      // plus exact sheet-border intersections when rectangular PAD was used.
      const candidates = [];
      const seen = new Set();
      const pushCand = (tx, ty) => {
        if (isRectSheet) {
          if (tx < minValidX - PAD - 1 || tx > maxValidX + PAD + 1 ||
            ty < minValidY - PAD - 1 || ty > maxValidY + PAD + 1) return;
          if (tx < minValidX) tx = minValidX;
          else if (tx > maxValidX) tx = maxValidX;
          if (ty < minValidY) ty = minValidY;
          else if (ty > maxValidY) ty = maxValidY;
        }
        const rx = Math.round(tx);
        const ry = Math.round(ty);
        const key = rx + ',' + ry;
        if (seen.has(key)) return;
        seen.add(key);

        // Compute best-fit hole bonus if (rx, ry) sits inside an active hole cavity
        let holeBonus = 0;
        if (activeHoles.length > 0) {
          let smallestHole = Infinity;
          for (let hi = 0; hi < activeHoles.length; hi++) {
            const ah = activeHoles[hi];
            if (rx < ah.minX || rx > ah.maxX || ry < ah.minY || ry > ah.maxY) continue;
            // Inside hole IFP (check point or vertex match with tiny tolerance)
            const lx = rx - ah.ox, ly = ry - ah.oy;
            let inH = _pointInClipperPaths(lx, ly, ah.paths);
            if (!inH) {
              // Vertex on hole IFP boundary (exact corner fit!)
              inH = _pointInClipperPaths(lx + 1, ly + 1, ah.paths) ||
                _pointInClipperPaths(lx - 1, ly + 1, ah.paths) ||
                _pointInClipperPaths(lx + 1, ly - 1, ah.paths) ||
                _pointInClipperPaths(lx - 1, ly - 1, ah.paths);
            }
            if (inH && ah.area < smallestHole) smallestHole = ah.area;
          }
          if (smallestHole < Infinity) {
            const mm2 = Math.max(1, smallestHole / (GEOM_SCALE * GEOM_SCALE));
            holeBonus = 1e14 + (1e11 / mm2);
          }
        }

        // Resulting bounding box if placed at (rx, ry)
        const nMinX = hasPlaced && curMinX < rx ? curMinX : rx;
        const nMinY = hasPlaced && curMinY < ry ? curMinY : ry;
        const nMaxX = hasPlaced && curMaxX > rx + bw ? curMaxX : rx + bw;
        const nMaxY = hasPlaced && curMaxY > ry + bh ? curMaxY : ry + bh;
        const nW = nMaxX - nMinX;
        const nH = nMaxY - nMinY;

        let score;
        if (isStrip) {
          score = (nH / GEOM_SCALE) * 1e6 + (nW / GEOM_SCALE) * 1e2 +
            (ry + bh * 0.5) * 0.002 + (rx + bw * 0.5) * 0.0004 - holeBonus;
        } else {
          const areaMm2 = (nW / GEOM_SCALE) * (nH / GEOM_SCALE);
          // Primary: minimize total bounding-box area; secondary: tight top-left gravity
          score = areaMm2 * 1e4 + (ry + bh * 0.5) * 0.002 + (rx + bw * 0.5) * 0.0005 - holeBonus;
        }
        // Slight penalty for hole-bearing parts so solid parts settle in holes cleanly
        if (variant.paths.length > 1) score += 1e3;

        if (score < bestScore) {
          candidates.push({ x: rx, y: ry, score, inHole: holeBonus > 0 });
        }
      };

      for (let ri = 0; ri < feasibleRings.length; ri++) {
        const ring = feasibleRings[ri];
        const rlen = ring.length;
        for (let k = 0; k < rlen; k++) {
          const p = ring[k];
          pushCand(p.X, p.Y);
          // If rectangular sheet pad was used and this edge crosses a true sheet
          // boundary (0, maxValidX, maxValidY), add the exact intersection point.
          if (isRectSheet) {
            const q = ring[(k + 1) % rlen];
            if ((p.X < minValidX && q.X >= minValidX) || (q.X < minValidX && p.X >= minValidX)) {
              const t = (minValidX - p.X) / (q.X - p.X);
              pushCand(minValidX, p.Y + t * (q.Y - p.Y));
            }
            if ((p.X > maxValidX && q.X <= maxValidX) || (q.X > maxValidX && p.X <= maxValidX)) {
              const t = (maxValidX - p.X) / (q.X - p.X);
              pushCand(maxValidX, p.Y + t * (q.Y - p.Y));
            }
            if ((p.Y < minValidY && q.Y >= minValidY) || (q.Y < minValidY && p.Y >= minValidY)) {
              const t = (minValidY - p.Y) / (q.Y - p.Y);
              pushCand(p.X + t * (q.X - p.X), minValidY);
            }
            if ((p.Y > maxValidY && q.Y <= maxValidY) || (q.Y > maxValidY && p.Y <= maxValidY)) {
              const t = (maxValidY - p.Y) / (q.Y - p.Y);
              pushCand(p.X + t * (q.X - p.X), maxValidY);
            }
            // Also sample axis-aligned projection onto current block right/bottom edge
            // if an edge spans across it (helps pack strictly within existing bbox)
            if (hasPlaced) {
              const edgeRight = curMaxX - bw;
              if ((p.X < edgeRight && q.X > edgeRight) || (q.X < edgeRight && p.X > edgeRight)) {
                const t = (edgeRight - p.X) / (q.X - p.X);
                pushCand(edgeRight, p.Y + t * (q.Y - p.Y));
              }
              const edgeBot = curMaxY - bh;
              if ((p.Y < edgeBot && q.Y > edgeBot) || (q.Y < edgeBot && p.Y > edgeBot)) {
                const t = (edgeBot - p.Y) / (q.Y - p.Y);
                pushCand(p.X + t * (q.X - p.X), edgeBot);
              }
            }
          }
        }
      }

      if (!candidates.length) continue;
      candidates.sort((a, b) => a.score - b.score);
      this.performanceStats.boundaryPointsTested += candidates.length;

      // Verify best candidates with exact collision check (handles 1-micron
      // integer rounding on slanted edges with tiny directional micro-nudges).
      const nudges = [[0, 0], [2, 0], [0, 2], [-2, 0], [0, -2], [2, 2], [-2, 2], [2, -2], [-2, -2]];
      const maxCheck = Math.min(candidates.length, 48);
      for (let ci = 0; ci < maxCheck; ci++) {
        const cand = candidates[ci];
        if (cand.score >= bestScore) break;
        const baseDx = cand.x - vb.x;
        const baseDy = cand.y - vb.y;
        let accepted = false;
        for (let ni = 0; ni < nudges.length; ni++) {
          const tx = cand.x + nudges[ni][0];
          const ty = cand.y + nudges[ni][1];
          if (tx < 0 || ty < 0 || tx + bw > sheet.width + 1 || ty + bh > sheet.height + 1) continue;
          const dx = baseDx + nudges[ni][0];
          const dy = baseDy + nudges[ni][1];
          variant.insideBonus = 0;
          if (!this.checkCollisions(variant, dx, dy, sheetParts)) {
            bestScore = cand.score;
            bestPlacement = variant.clone(dx, dy);
            accepted = true;
            break;
          }
          // For interior points that failed on non-slanted contact, try only a few nudges
          if (ni === 4 && !cand.inHole) break;
        }
        if (accepted) break;
      }
    }

    this.performanceStats.nfpExactCalls++;
    return bestPlacement;
  }

  findBestNFPPlacement(part, placedPartsAll, sheet, gridSize) {
    const sheetParts = [];
    const placedNonSheet = [];
    for (let i = 0; i < placedPartsAll.length; i++) {
      const p = placedPartsAll[i];
      if (p.lcolor === '#00ff00') sheetParts.push(p);
      else placedNonSheet.push(p);
    }

    if (this.useExactNFP && _hasClipper()) {
      const exact = this._findExactNFPPlacement(part, placedPartsAll, sheetParts, placedNonSheet, sheet);
      if (exact) return exact;
      // If exact NFP proved no placement exists on the sheet, return null directly
      // (unless Clipper threw or returned empty on a degenerate shape).
      return null;
    }

    // Fallback: enhanced scanline + vertex search (used only if ClipperLib is absent)
    this.performanceStats.fallbackCalls++;
    return this._findScanlineFallback(part, placedPartsAll, sheetParts, sheet, gridSize);
  }

  _findScanlineFallback(part, placedPartsAll, sheetParts, sheet, gridSize) {
    let bestPlacement = null;
    let bestScore = Infinity;
    const t0 = performance.now();
    const PLACE_BUDGET_MS = 1200;

    // Removed the old 4mm hard floor — honors caller's gridSize down to 1mm
    const step = Math.max(1 * GEOM_SCALE, gridSize);
    const scanParts = placedPartsAll.map(p => {
      const b = p.getBounds();
      return { p, minY: b.y, maxY: b.y + b.height };
    });
    const hasHoles = placedPartsAll.some(p => p.lcolor !== '#00ff00' && p.paths.length > 1);

    for (let y = 0; y < sheet.height; y += step) {
      const intersections = [];
      let sheetRange = [0, sheet.width];
      for (const sp of scanParts) {
        if (y < sp.minY || y > sp.maxY) continue;
        const pts = GeometryUtil.getHorizontalIntersections(sp.p, y);
        if (sp.p.lcolor === '#00ff00') {
          if (pts.length >= 2) {
            pts.sort((a, b) => a - b);
            sheetRange = [pts[0], pts[pts.length - 1]];
          }
        } else {
          intersections.push(...pts);
        }
      }
      intersections.sort((a, b) => a - b);

      for (let x = sheetRange[0]; x <= sheetRange[1]; x += step) {
        let insideAnyPart = false;
        for (let i = 0; i < intersections.length; i += 2) {
          if (x >= intersections[i] && x <= intersections[i + 1]) {
            x = Math.ceil(intersections[i + 1]);
            insideAnyPart = true;
            break;
          }
        }
        if (insideAnyPart) continue;

        for (const variant of part.variants) {
          const b = variant.getBounds();
          if (x < 0 || y < 0 || x + b.width > sheet.width || y + b.height > sheet.height) continue;
          const dx = x - b.x;
          const dy = y - b.y;
          const score = this._gravityScore(b, dx, dy, variant.paths.length > 1 ? 1000 * GEOM_SCALE : 0);
          const mayFitInHole = hasHoles && variant.paths.length === 1;
          if (score > bestScore + 100 && !mayFitInHole) continue;
          variant.insideBonus = 0;
          if (!this.checkCollisions(variant, dx, dy, sheetParts)) {
            const finalScore = score - (variant.insideBonus || 0);
            if (finalScore < bestScore) {
              bestScore = finalScore;
              bestPlacement = variant.clone(dx, dy);
            }
          }
        }
      }
      if (bestPlacement && performance.now() - t0 > PLACE_BUDGET_MS) break;
    }

    if (!bestPlacement || bestScore > sheet.height * 0.5) {
      const edgeCandidates = this.getCandidatePositions(part.variants[0], placedPartsAll, sheet, gridSize);
      const vb = part.variants[0].getBounds();
      for (const pos of edgeCandidates) pos._score = this._gravityScore(vb, pos.x, pos.y, 0);
      edgeCandidates.sort((p, q) => p._score - q._score);
      const K = Math.min(edgeCandidates.length, 200);
      for (let i = 0; i < K; i++) {
        if (bestPlacement && performance.now() - t0 > PLACE_BUDGET_MS) break;
        const pos = edgeCandidates[i];
        if (pos._score < bestScore) {
          if (!this.checkCollisions(part.variants[0], pos.x, pos.y, sheetParts)) {
            bestPlacement = part.variants[0].clone(pos.x, pos.y);
            bestScore = pos._score;
          }
        }
      }
    }
    return bestPlacement;
  }

  getCandidatePositions(part, placedParts, sheet, gridSize) {
    const positions = [];
    const pb = part.getBounds();
    const pW = pb.width;
    const pH = pb.height;

    const startStep = Math.max(GEOM_SCALE, gridSize * 2);
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

    const vSamples = [
      { x: pb.x, y: pb.y },
      { x: pb.x + pW, y: pb.y },
      { x: pb.x + pW, y: pb.y + pH },
      { x: pb.x, y: pb.y + pH },
      { x: pb.x + pW / 2, y: pb.y },
      { x: pb.x, y: pb.y + pH / 2 }
    ];

    const MAX_VERT_CANDIDATES = 4000;
    const maxVerts = Math.max(1, Math.floor(MAX_VERT_CANDIDATES / vSamples.length));
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
          for (const v of vSamples) addPos(pt.x - v.x, pt.y - v.y);
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

    for (let i = 0; i < sheetParts.length; i++) {
      this.performanceStats.collisionChecks++;
      if (GeometryUtil.polyOutsideAt(variant, dx, dy, sheetParts[i])) return true;
    }

    const candidates = this.spatialHash.query(bx, by, bw, bh);
    for (let i = 0; i < candidates.length; i++) {
      const placed = candidates[i];
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
    if (!parts || parts.length === 0) return { x: 0, y: 0, width: 10 * GEOM_SCALE, height: 10 * GEOM_SCALE };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let found = false;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.lcolor === '#00ff00') continue;
      found = true;
      const b = part.getBounds();
      if (b.x < minX) minX = b.x;
      if (b.y < minY) minY = b.y;
      if (b.x + b.width > maxX) maxX = b.x + b.width;
      if (b.y + b.height > maxY) maxY = b.y + b.height;
    }
    if (!found) return { x: 0, y: 0, width: 0, height: 0 };
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  getPerformanceStats() { return this.performanceStats; }

  compactSolution(placements, sheet) {
    const cellSize = (this.spatialHash && this.spatialHash.cellSize) ||
      Math.max(50 * GEOM_SCALE, (this.gridSize || 10) * 5);
    this.spatialHash = new NFP2SpatialHash(cellSize);
    placements.forEach(p => this.spatialHash.add(p));
    const sheetParts = placements.filter(p => p.lcolor === '#00ff00');
    const maxW = sheet.width * GEOM_SCALE;
    const maxH = sheet.height * GEOM_SCALE;

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
      if (b.x < 0 || b.y < 0 || b.x + b.width > maxW || b.y + b.height > maxH) {
        return true;
      }
      return this.checkCollisions(part, 0, 0, sheetParts);
    };

    GeometryUtil.compactLayout(placements, collisionCheck);
    return placements;
  }
}

// ---------------------------------------------------------------------------
// NFPGA: Genetic Algorithm + Multi-Heuristic Seeds + 3-Move Local Search +
//        Shared NFP Cache + Automatic Multi-Sheet Packing
// ---------------------------------------------------------------------------

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
    this.popSize = 8;
    this.generations = 6;
    this.mutationRate = 0.12;
    this.fitnessMode = 'area';
    this.localSearchBudget = 8;
    this.nfpCache = null;
    this.maxVerts = 56;
    this.enableCompaction = true;
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

  _shuffled(n) {
    const a = new Array(n);
    for (let i = 0; i < n; i++) a[i] = i;
    for (let i = n - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

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
    if (n < 2) return order.slice();
    const a = order.slice();
    if (Math.random() > Math.max(0.25, this.mutationRate)) return a;
    const r = Math.random();
    if (r < 0.45) {
      const i = (Math.random() * n) | 0;
      let j = (Math.random() * n) | 0;
      if (i === j) j = (j + 1) % n;
      const t = a[i]; a[i] = a[j]; a[j] = t;
    } else if (r < 0.8) {
      const i = (Math.random() * n) | 0;
      const g = a.splice(i, 1)[0];
      a.splice((Math.random() * n) | 0, 0, g);
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
    if (rots && Math.random() < Math.max(0.2, this.mutationRate)) {
      rots = ind.rots.slice();
      const flips = Math.max(1, Math.round(rots.length * this.mutationRate * 0.5));
      for (let f = 0; f < flips; f++) {
        const i = (Math.random() * rots.length) | 0;
        const c = this._variantCounts[i];
        if (c > 1) {
          let v = (Math.random() * c) | 0;
          if (v === rots[i]) v = (v + 1) % c;
          rots[i] = v;
        }
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

  _entryTrueArea(e) {
    if (e._gaTrueArea !== undefined) return e._gaTrueArea;
    let a = 0;
    if (e.variants && e.variants.length > 0 && e.variants[0].paths[0]) {
      a = Math.abs(Path.getSignedArea(e.variants[0].paths[0]));
      for (let h = 1; h < e.variants[0].paths.length; h++) {
        a -= Math.abs(Path.getSignedArea(e.variants[0].paths[h]));
      }
      if (a < 1) a = this._entryArea(e);
    }
    e._gaTrueArea = a;
    return a;
  }

  _computeUtilization(placements, sheetArea) {
    if (!(sheetArea > 0) || !placements) return 0;
    let partArea = 0;
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      if (p.lcolor === '#00ff00') continue;
      let a = Math.abs(Path.getSignedArea(p.paths[0]));
      for (let h = 1; h < p.paths.length; h++) {
        a -= Math.abs(Path.getSignedArea(p.paths[h]));
      }
      if (a > 0) partArea += a;
    }
    return Math.min(100, (partArea / sheetArea) * 100);
  }

  *_evaluateGen(ind, ctx, evalsDone) {
    const order = Array.isArray(ind) ? ind : ind.order;
    const dec = new NFP2();
    dec.spacing = this.spacing;
    dec.allowFlip = this.allowFlip;
    dec.gridSize = ctx.gridSize;
    dec.fitnessMode = this.fitnessMode;
    dec.nfpCache = ctx.nfpCache;
    dec.performanceStats = {
      boundaryPointsTested: 0,
      collisionAvoided: 0,
      collisionChecks: 0,
      nfpExactCalls: 0,
      fallbackCalls: 0
    };
    const cellSize = Math.max(50 * GEOM_SCALE, ctx.gridSize * 5);
    dec.spatialHash = new NFP2SpatialHash(cellSize);

    const sheet = { width: ctx.scaledSheet.width, height: ctx.scaledSheet.height };
    const placed = ctx.fixed.slice();
    for (const p of placed) dec.spatialHash.add(p);

    let sheetArea = sheet.width * sheet.height;
    for (const e of ctx.entries) {
      if (e.lcolor !== '#00ff00') continue;
      const sv = e.variants[0];
      sv.align();
      const b = sv.getBounds();
      sheet.width = b.width;
      sheet.height = b.height;
      sheetArea = Math.abs(Path.getSignedArea(sv.paths[0])) || (b.width * b.height);
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
      if (e.lcolor === '#00ff00') continue;
      let bp = null;
      let usedVariant = -1;
      if (ind && !Array.isArray(ind) && ind.rots) {
        const variants = e.variants || [];
        if (Number.isInteger(ind.rots[order[k]]) && variants.length) {
          usedVariant = ((ind.rots[order[k]] % variants.length) + variants.length) % variants.length;
        }
        bp = this._placeWithVariant(dec, e, ind.rots[order[k]], placed, sheet, ctx.gridSize);
        // If the chosen rotation gene didn't fit on the sheet at all, allow
        // falling back to another variant so valid parts aren't needlessly dropped.
        if (!bp && variants.length > 1) {
          for (let alt = 0; alt < variants.length; alt++) {
            if (alt === usedVariant) continue;
            bp = this._placeWithVariant(dec, e, alt, placed, sheet, ctx.gridSize);
            if (bp) { usedVariant = alt; break; }
          }
        }
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
      yield { done: partStep, total: placeableCount, evalsDone, partialPlaced: placed, unplaced };
    }

    let fit = 0;
    const placedNonSheetCount = placed.filter(p => p.lcolor !== '#00ff00').length;
    if (placedNonSheetCount > 0) {
      const b = dec.calculateTotalBounds(placed);
      if (this.fitnessMode === 'strip') {
        fit = b.height * 1000000 + b.width;
      } else {
        fit = b.width * b.height;
      }
    }
    // Strongly penalize unplaced parts so placing more parts always beats
    // a slightly tighter bbox that dropped a part.
    const sheetPenalty = Math.max(sheet.width * sheet.height, 1e12);
    const totalFitness = fit + unplaced * sheetPenalty * 10 + unplacedArea;

    ctx.stats.collisionChecks += dec.performanceStats.collisionChecks || 0;
    const utilization = this._computeUtilization(placed, sheetArea);
    return {
      placements: placed,
      fitness: totalFitness,
      unplaced,
      unplacedArea,
      utilization,
      sheetArea
    };
  }

  _evaluate(ind, ctx) {
    const gen = this._evaluateGen(ind, ctx, 0);
    let n;
    do { n = gen.next(); } while (!n.done);
    return n.value;
  }

  // 3-Move True Hill-Climbing Local Search:
  //   - Pairwise order swap (40%)
  //   - Insertion / relocate move (30%)
  //   - Rotation / flip gene mutation (30%)
  // Mutates from `bestInd` (actual hill climb!) and keeps strictly improving moves.
  _makeLocalNeighbor(bestInd) {
    const n = bestInd.order.length;
    const hasRots = Array.isArray(bestInd.rots) &&
      this._variantCounts && this._variantCounts.some(c => c > 1);
    const r = Math.random();

    if (hasRots && r < 0.30) {
      const rots = bestInd.rots.slice();
      // Pick an entry that actually has >1 rotation/flip variant
      const multi = [];
      for (let i = 0; i < rots.length; i++) {
        if (this._variantCounts[i] > 1) multi.push(i);
      }
      if (multi.length > 0) {
        const idx = multi[(Math.random() * multi.length) | 0];
        const c = this._variantCounts[idx];
        let v = (Math.random() * c) | 0;
        if (v === rots[idx]) v = (v + 1) % c;
        rots[idx] = v;
        return { order: bestInd.order.slice(), rots };
      }
    }

    const order = bestInd.order.slice();
    if (n >= 2) {
      if (r < 0.65) {
        // Pairwise swap
        const a = (Math.random() * n) | 0;
        let b = (Math.random() * n) | 0;
        if (a === b) b = (b + 1) % n;
        const t = order[a]; order[a] = order[b]; order[b] = t;
      } else {
        // Insertion move: pull an element and place at another index
        const from = (Math.random() * n) | 0;
        let to = (Math.random() * n) | 0;
        if (from === to) to = (to + 1) % n;
        const g = order.splice(from, 1)[0];
        order.splice(to, 0, g);
      }
    }
    return { order, rots: bestInd.rots ? bestInd.rots.slice() : null };
  }

  _localSearch(ind, ctx, budget, shouldCancel) {
    let bestInd = ind;
    let bestR = this._evaluate(ind, ctx);
    let trials = 0;
    while (trials < budget) {
      if (shouldCancel && shouldCancel()) break;
      const candidate = this._makeLocalNeighbor(bestInd);
      const r = this._evaluate(candidate, ctx);
      trials++;
      if (r.fitness < bestR.fitness) {
        bestR = r;
        bestInd = candidate;
      }
    }
    return { ind: bestInd, result: bestR, trials };
  }

  *_localSearchGen(ind, ctx, budget, shouldCancel, initialResult) {
    let bestInd = ind;
    let bestR = initialResult || this._evaluate(ind, ctx);
    let trials = 0;
    while (trials < budget) {
      if (shouldCancel && shouldCancel()) break;
      const candidate = this._makeLocalNeighbor(bestInd);
      const r = this._evaluate(candidate, ctx);
      trials++;
      if (r.fitness < bestR.fitness) {
        bestR = r;
        bestInd = candidate;
      }
      yield { lsTrial: trials, lsBudget: budget };
    }
    return { ind: bestInd, result: bestR, trials };
  }

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

  // Build smart heuristic seeds for the initial GA population
  _buildInitialSeeds(entries, placeables, seedOpt) {
    const n = entries.length;
    const placeIdx = placeables.map(e => entries.indexOf(e));
    const placeSet = new Set(placeIdx);
    const tail = [];
    for (let i = 0; i < n; i++) if (!placeSet.has(i)) tail.push(i);

    const makeOrder = (cmp) => placeIdx.slice().sort(cmp).concat(tail);
    const zeroRots = this._variantCounts.map(() => 0);

    // Best-aspect rotations: orient longest side horizontally when available
    const flatRots = entries.map((e, idx) => {
      const vs = e.variants || [];
      if (vs.length <= 1) return 0;
      let bestV = 0, bestH = Infinity;
      for (let i = 0; i < vs.length; i++) {
        const b = vs[i].getBounds();
        if (b.height < bestH) { bestH = b.height; bestV = i; }
      }
      return bestV;
    });

    const seeds = [];
    // 1. Descending true polygon area (with default rot 0)
    seeds.push({
      order: makeOrder((a, b) => this._entryTrueArea(entries[b]) - this._entryTrueArea(entries[a])),
      rots: zeroRots.slice()
    });

    // 2. Previous winner seed (infinite mode / island migration)
    if (seedOpt && Array.isArray(seedOpt.order) && Array.isArray(seedOpt.rots) &&
      seedOpt.order.length === n && seedOpt.rots.length === n) {
      const seen = new Array(n).fill(false);
      let valid = true;
      for (const v of seedOpt.order) {
        if (!Number.isInteger(v) || v < 0 || v >= n || seen[v]) { valid = false; break; }
        seen[v] = true;
      }
      if (valid) seeds.push({ order: seedOpt.order.slice(), rots: seedOpt.rots.slice() });
    }

    // 3. Descending true area with flat (lowest-height) rotations
    seeds.push({
      order: makeOrder((a, b) => this._entryTrueArea(entries[b]) - this._entryTrueArea(entries[a])),
      rots: flatRots
    });

    // 4. Descending bounding-box perimeter (long thin parts first)
    seeds.push({
      order: makeOrder((a, b) => {
        const ba = entries[a].variants[0].getBounds();
        const bb = entries[b].variants[0].getBounds();
        return (bb.width + bb.height) - (ba.width + ba.height);
      }),
      rots: this._randomRots()
    });

    // 5. Descending longest side
    seeds.push({
      order: makeOrder((a, b) => {
        const ba = entries[a].variants[0].getBounds();
        const bb = entries[b].variants[0].getBounds();
        return Math.max(bb.width, bb.height) - Math.max(ba.width, ba.height);
      }),
      rots: this._randomRots()
    });

    // 6. Concavity / hole-bearing first (so cavities & holes are open for small parts!)
    seeds.push({
      order: makeOrder((a, b) => {
        const ea = entries[a], eb = entries[b];
        const ha = ea.variants[0].paths.length > 1 ? 2 : 1;
        const hb = eb.variants[0].paths.length > 1 ? 2 : 1;
        const ca = ha * (this._entryArea(ea) / Math.max(1, this._entryTrueArea(ea)));
        const cb = hb * (this._entryArea(eb) / Math.max(1, this._entryTrueArea(eb)));
        return (cb * this._entryArea(eb)) - (ca * this._entryArea(ea));
      }),
      rots: this._randomRots()
    });

    return seeds;
  }

  *findBestPositionGen(parts, sheet, gridSize, opts = {}) {
    const scaledSheet = {
      width: sheet.width * GEOM_SCALE,
      height: sheet.height * GEOM_SCALE
    };
    this.hascustomsheet = false;
    this.gridSize = gridSize;
    parts.forEach(p => { p.placed = false; });

    const entries = parts.slice();
    const placeables = entries.filter(e => e.lcolor !== '#00ff00');

    const nfpCache = opts.nfpCache || this.nfpCache || new NFPCache({ maxVerts: this.maxVerts });
    this.nfpCache = nfpCache;

    const stats = { generations: 0, evaluations: 0, collisionChecks: 0, bestFitness: Infinity };

    const ctx = {
      entries,
      scaledSheet,
      gridSize,
      fixed: [],
      initialSet: null,
      placeableCount: placeables.length,
      nfpCache,
      stats
    };

    if (placeables.length === 0) {
      const r = this._evaluate({ order: entries.map((e, i) => i), rots: null }, ctx);
      stats.evaluations = 1;
      stats.bestFitness = r.fitness;
      return {
        placements: r.placements,
        fitness: r.fitness,
        unplaced: r.unplaced,
        utilization: r.utilization || 0,
        stats,
        cancelled: false
      };
    }

    this._variantCounts = entries.map(e =>
      (e.variants && e.variants.length > 0) ? e.variants.length : 1
    );

    const popSize = Math.max(2, this.popSize);
    const n = entries.length;
    const seeds = this._buildInitialSeeds(entries, placeables, opts.seedOrder);
    let pop = [];
    for (let i = 0; i < seeds.length && pop.length < popSize; i++) pop.push(seeds[i]);
    while (pop.length < popSize) pop.push({ order: this._shuffled(n), rots: this._randomRots() });

    const totalEvals = pop.length + Math.max(0, pop.length - Math.min(2, pop.length)) * Math.max(1, this.generations) + 1;
    const totalSteps = Math.max(1, totalEvals * placeables.length);
    let evalsDone = 0;

    const shouldCancel = opts.shouldCancel || null;
    let bestResult = null;
    let bestIndRef = null;
    let lastPartial = null;

    function* runEval(nfpga, ind, ctx2, evalsDoneRef) {
      const evIdx = evalsDoneRef.v;
      const gen = nfpga._evaluateGen(ind, ctx2, evIdx);
      let sub;
      for (;;) {
        if (shouldCancel && shouldCancel()) return null;
        sub = gen.next();
        if (sub.done) break;
        if (sub.value.partialPlaced) {
          lastPartial = {
            placements: sub.value.partialPlaced,
            unplaced: placeables.length - sub.value.partialPlaced.filter(p => p.lcolor !== '#00ff00').length
          };
        }
        yield {
          eval: evIdx,
          part: sub.value.done,
          parts: sub.value.total,
          done: evIdx * placeables.length + sub.value.done,
          total: totalSteps
        };
      }
      evalsDoneRef.v++;
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
      }
      stats.generations = gen;
    }

    let result;
    let lsTrials = 0;
    if (cancelled) {
      result = bestResult;
      if (!result && lastPartial) {
        // Early cancellation during eval 0: still return valid partial placements
        result = {
          placements: lastPartial.placements,
          fitness: Infinity,
          unplaced: lastPartial.unplaced,
          utilization: 0
        };
      }
      if (!result) {
        return { placements: [], fitness: Infinity, unplaced: placeables.length, utilization: 0, stats, cancelled: true };
      }
    } else {
      const ranked = pop.map((o, i) => i).sort((a, b) => fits[a] - fits[b]);
      const bestInd = pop[ranked[0]];
      if (shouldCancel && shouldCancel()) {
        result = bestResult;
        cancelled = true;
      } else {
        let target = bestInd;
        let r = bestResult;
        if (this.localSearchBudget > 0 && placeables.length > 1) {
          const baseDone = evalsRef.v * placeables.length;
          const remaining = Math.max(1, totalSteps - baseDone);
          const lsGen = this._localSearchGen(bestInd, ctx, this.localSearchBudget, shouldCancel, bestResult);
          let ls = null;
          for (;;) {
            if (shouldCancel && shouldCancel()) { cancelled = true; break; }
            const y = lsGen.next();
            if (y.done) { ls = y.value; break; }
            const frac = y.value.lsTrial / Math.max(1, y.value.lsBudget);
            yield { done: baseDone + Math.round(frac * remaining), total: totalSteps };
          }
          if (ls) {
            target = ls.ind;
            r = ls.result;
            lsTrials = ls.trials;
          }
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

    // Optional final sub-mm compaction on the winning uncancelled layout
    if (result && result.placements && result.placements.length > 1 && !cancelled && this.enableCompaction) {
      const sheetEntry = entries.find(e => e.lcolor === '#00ff00');
      const sb = sheetEntry ? sheetEntry.variants[0].getBounds() : scaledSheet;
      const compactSheet = { width: sb.width / GEOM_SCALE, height: sb.height / GEOM_SCALE };
      this.compactSolution(result.placements, compactSheet);
    }

    evalsDone = evalsRef.v;
    stats.evaluations = evalsDone + lsTrials;
    stats.collisionChecks = ctx.stats.collisionChecks;
    stats.bestFitness = result ? result.fitness : Infinity;
    stats.nfpCache = Object.assign({}, nfpCache.stats);

    const seedOut = bestIndRef && Array.isArray(bestIndRef.order)
      ? { order: bestIndRef.order.slice(), rots: Array.isArray(bestIndRef.rots) ? bestIndRef.rots.slice() : null }
      : null;
    return {
      placements: result ? result.placements : [],
      fitness: result ? result.fitness : Infinity,
      unplaced: result ? result.unplaced : placeables.length,
      utilization: result ? (result.utilization || 0) : 0,
      stats,
      cancelled,
      bestOrder: seedOut
    };
  }

  // Multi-Sheet Generator (supports BOTH explicit finite sheet inventory from
  // multiple green loops / sheet-note counts AND automatic overflow cloning of
  // a single green sheet when `opts.multiSheet` is true).
  // Reuses the EXACT same warm NFPCache across all sheets.
  *findBestMultiSheetGen(parts, sheet, gridSize, opts = {}) {
    const sheetEntries = parts.filter(e => e.lcolor === '#00ff00');
    let remaining = parts.filter(e => e.lcolor !== '#00ff00');
    const totalParts = remaining.length;

    const finiteSheets = !!opts.finiteSheets || sheetEntries.length > 1;
    const multiSheet = !!opts.multiSheet;
    const maxSheets = finiteSheets
      ? Math.max(1, sheetEntries.length)
      : (multiSheet ? (opts.maxSheets || 50) : 1);

    const nfpCache = opts.nfpCache || this.nfpCache || new NFPCache({ maxVerts: this.maxVerts });
    this.nfpCache = nfpCache;

    const sheets = [];
    let totalPlaced = 0;
    let totalEvals = 0;
    let totalChecks = 0;
    let firstSeed = null;
    let cancelled = false;

    for (let si = 0; si < maxSheets; si++) {
      if (remaining.length === 0) break;
      const activeSheet = finiteSheets
        ? (sheetEntries[si] || null)
        : (sheetEntries[0] || null);
      if (finiteSheets && sheetEntries.length > 0 && !activeSheet) break;
      const sheetOriginIndex = activeSheet ? activeSheet.originIndex : 0;
      const batch = activeSheet ? remaining.concat([activeSheet]) : remaining.slice();
      const sheetOpts = Object.assign({}, opts, {
        nfpCache,
        seedOrder: si === 0 ? opts.seedOrder : null
      });
      const gen = this.findBestPositionGen(batch, sheet, gridSize, sheetOpts);
      let res;
      for (;;) {
        const n = gen.next();
        if (n.done) { res = n.value; break; }
        // Blend progress across already-placed parts + current sheet fraction
        const placedFrac = totalParts > 0 ? totalPlaced / totalParts : 0;
        const remFrac = totalParts > 0 ? remaining.length / totalParts : 1;
        const curFrac = n.value.total > 0 ? n.value.done / n.value.total : 0;
        const globalDone = Math.round((placedFrac + remFrac * curFrac) * 1000);
        yield { done: globalDone, total: 1000, sheetIndex: si };
      }
      totalEvals += (res.stats && res.stats.evaluations) || 0;
      totalChecks += (res.stats && res.stats.collisionChecks) || 0;
      if (si === 0 && res.bestOrder) firstSeed = res.bestOrder;

      const placedOnSheet = (res.placements || []).filter(p => p.lcolor !== '#00ff00');
      const blockBounds = this.calculateTotalBounds(res.placements || []);

      if (placedOnSheet.length === 0) {
        if (res.cancelled) {
          cancelled = true;
          break;
        }
        // In explicit heterogeneous sheet mode, a small remnant sheet might fit
        // nothing while a subsequent larger sheet can still fit remaining parts.
        if (finiteSheets && si + 1 < maxSheets) {
          continue;
        }
        // Auto-overflow (identical sheets) or final finite sheet: stop safely
        if (sheets.length === 0) {
          sheets.push({
            sheetIndex: 0,
            sheetOriginIndex,
            placements: res.placements || [],
            blockBounds,
            placedCount: 0,
            utilization: 0,
            fitness: res.fitness
          });
        }
        cancelled = !!res.cancelled;
        break;
      }

      sheets.push({
        sheetIndex: sheets.length,
        sheetOriginIndex,
        placements: res.placements,
        blockBounds,
        placedCount: placedOnSheet.length,
        utilization: res.utilization || 0,
        fitness: res.fitness
      });

      const placedSet = new Set(placedOnSheet.map(p => p.originIndex));
      totalPlaced += placedOnSheet.length;
      remaining = remaining.filter(e => !placedSet.has(e.originIndex));

      if (res.cancelled) { cancelled = true; break; }
      if (!finiteSheets && !multiSheet) break;
    }

    // Overall utilization: average across used sheets (weighted equally per sheet)
    let avgUtil = 0;
    for (let i = 0; i < sheets.length; i++) avgUtil += sheets[i].utilization || 0;
    if (sheets.length > 0) avgUtil /= sheets.length;

    const lastSheet = sheets[sheets.length - 1];
    const lastBounds = lastSheet ? lastSheet.blockBounds : { width: 0, height: 0 };
    const lastArea = (lastBounds.width / GEOM_SCALE) * (lastBounds.height / GEOM_SCALE);
    // Lexicographic fitness: fewer unplaced > fewer sheets > smaller last-sheet area
    const compositeFitness =
      remaining.length * 1e18 +
      sheets.length * 1e14 +
      lastArea;

    const firstSheet = sheets[0] || { placements: [], blockBounds: { x: 0, y: 0, width: 0, height: 0 } };
    return {
      sheets,
      placements: firstSheet.placements,
      totalPlaced,
      unplaced: remaining.length,
      unplacedOriginIndices: remaining.map(e => e.originIndex),
      utilization: avgUtil,
      fitness: compositeFitness,
      stats: {
        evaluations: totalEvals,
        collisionChecks: totalChecks,
        sheetsUsed: sheets.length,
        bestFitness: compositeFitness,
        nfpCache: Object.assign({}, nfpCache.stats)
      },
      cancelled,
      bestOrder: firstSeed
    };
  }

  findBestPosition(parts, sheet, progressHandler, gridSize) {
    const gen = this.findBestPositionGen(parts, sheet, gridSize != null ? gridSize : this.gridSize);
    let r;
    for (;;) {
      const n = gen.next();
      if (n.done) { r = n.value; break; }
      if (progressHandler) progressHandler(n.value.done, n.value.total);
    }
    this.performanceStats = r.stats;
    this.hascustomsheet = (r.stats && r.stats.hascustomsheet) || this.hascustomsheet;
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
    if (!parts || parts.length === 0) return { x: 0, y: 0, width: 10 * GEOM_SCALE, height: 10 * GEOM_SCALE };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let found = false;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.lcolor === '#00ff00') continue;
      found = true;
      const b = part.getBounds();
      if (b.x < minX) minX = b.x;
      if (b.y < minY) minY = b.y;
      if (b.x + b.width > maxX) maxX = b.x + b.width;
      if (b.y + b.height > maxY) maxY = b.y + b.height;
    }
    if (!found) return { x: 0, y: 0, width: 0, height: 0 };
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  getPerformanceStats() { return this.performanceStats; }
}

const MiniSketchNest = {
  GEOM_SCALE,
  Point,
  Path,
  GeometryUtil,
  NFPCache,
  NFP2SpatialHash,
  NFP2,
  NFPGA
};

if (typeof globalThis !== 'undefined') globalThis.MiniSketchNest = MiniSketchNest;
if (typeof window !== 'undefined') window.MiniSketchNest = MiniSketchNest;
if (typeof module !== 'undefined' && module.exports) module.exports = MiniSketchNest;
