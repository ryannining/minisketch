/*
 * MiniSketch Sub-Pixel Grayscale Anti-Aliased Vector Tracer (tools/subpixel_trace.js).
 *
 * Unlike binary pixel tracers (ImageTracerJS / Potrace) that threshold the image
 * into pure 0/255 pixels before tracing — throwing away anti-aliasing shades and
 * turning diagonal/curved boundaries into 1-pixel staircases — this tracer reads
 * the continuous grayscale luminance field directly:
 *
 *   1. Linear-interpolated Marching Squares extracts exact sub-pixel iso-contours
 *      at the chosen threshold (recovering ~0.05–0.1 px edge precision from AA).
 *   2. Turning-angle corner detection + flanking OLS line intersection restores
 *      razor-sharp corners lost to 1-pixel anti-aliasing blur.
 *   3. Cardinal extrema anchors + straight-run splitting + closed-form least-squares
 *      quadratic Bezier fitting (with Newton parameter refinement) produce clean,
 *      minimal-node L/Q vector paths.
 *   4. Optional axis-alignment snapping keeps nearly vertical/horizontal stems flat.
 *
 * Works identically in the main browser window, inside a Web Worker
 * (importScripts), and in Node.js (CommonJS). Zero external dependencies.
 */
((globalScope) => {
  'use strict';

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function signedArea(pts) {
    let a = 0;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      a += p.x * q.y - q.x * p.y;
    }
    return a * 0.5;
  }

  function ptDist(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  function ptLineDist(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
    return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
  }

  // Fast separable 2-pass box blur on a Float32Array grayscale field (w x h).
  function blurGray(src, w, h, radius) {
    const r = Math.max(0, Math.min(5, Math.round(radius || 0)));
    if (r <= 0) return src;
    let cur = new Float32Array(src);
    let tmp = new Float32Array(w * h);
    const span = r * 2 + 1;

    for (let pass = 0; pass < 2; pass++) {
      // Horizontal pass
      for (let y = 0; y < h; y++) {
        const row = y * w;
        let sum = 0;
        for (let dx = -r; dx <= r; dx++) sum += cur[row + clamp(dx, 0, w - 1)];
        for (let x = 0; x < w; x++) {
          tmp[row + x] = sum / span;
          const xOut = clamp(x - r, 0, w - 1);
          const xIn = clamp(x + r + 1, 0, w - 1);
          sum += cur[row + xIn] - cur[row + xOut];
        }
      }
      // Vertical pass
      for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let dy = -r; dy <= r; dy++) sum += tmp[clamp(dy, 0, h - 1) * w + x];
        for (let y = 0; y < h; y++) {
          cur[y * w + x] = sum / span;
          const yOut = clamp(y - r, 0, h - 1);
          const yIn = clamp(y + r + 1, 0, h - 1);
          sum += tmp[yIn * w + x] - tmp[yOut * w + x];
        }
      }
    }
    return cur;
  }

  // Convert RGBA ImageData (composited over white) into a 1px white-padded
  // Float32Array luminance field of size (w+2) x (h+2), so shapes touching
  // the image border always close cleanly.
  function imageDataToPaddedGray(imgd, blurRadius) {
    const w = imgd.width, h = imgd.height, sd = imgd.data;
    const raw = new Float32Array(w * h);
    for (let i = 0, p = 0; i < sd.length; i += 4, p++) {
      const a = sd[i + 3] / 255;
      raw[p] = (0.299 * sd[i] + 0.587 * sd[i + 1] + 0.114 * sd[i + 2]) * a + 255 * (1 - a);
    }
    const filtered = blurRadius > 0 ? blurGray(raw, w, h, blurRadius) : raw;
    const pw = w + 2, ph = h + 2;
    const field = new Float32Array(pw * ph);
    field.fill(255);
    for (let y = 0; y < h; y++) {
      field.set(filtered.subarray(y * w, (y + 1) * w), (y + 1) * pw + 1);
    }
    return { field, pw, ph };
  }

  // Sub-pixel Marching Squares using integer edge IDs (zero string allocation).
  // Returns closed loops in original image pixel coordinates (0..w, 0..h).
  function marchingSquaresSubpixel(field, pw, ph, iso, minArea, minPerim) {
    // Grid edge IDs:
    //   Horizontal edge (x,y)-(x+1,y): id = y * pw + x
    //   Vertical edge   (x,y)-(x,y+1): id = pw * ph + y * pw + x
    const edgeBaseV = pw * ph;
    const totalEdges = edgeBaseV * 2;
    const edgeToSeg = new Int32Array(totalEdges);
    edgeToSeg.fill(-1);

    // Flat dynamic arrays for directed segments
    const segX0 = [];
    const segY0 = [];
    const segNextEdge = [];

    const interp = (v0, v1) => {
      const d = v1 - v0;
      if (Math.abs(d) < 1e-6) return 0.5;
      const t = (iso - v0) / d;
      return t < 0.02 ? 0.02 : t > 0.98 ? 0.98 : t;
    };

    const addSeg = (x, y, eA, eB, v0, v1, v2, v3) => {
      let ax, ay, kA, kB;
      if (eA === 0) { ax = x + interp(v0, v1); ay = y; kA = y * pw + x; }
      else if (eA === 1) { ax = x + 1; ay = y + interp(v1, v2); kA = edgeBaseV + y * pw + (x + 1); }
      else if (eA === 2) { ax = x + 1 - interp(v2, v3); ay = y + 1; kA = (y + 1) * pw + x; }
      else { ax = x; ay = y + 1 - interp(v3, v0); kA = edgeBaseV + y * pw + x; }

      if (eB === 0) kB = y * pw + x;
      else if (eB === 1) kB = edgeBaseV + y * pw + (x + 1);
      else if (eB === 2) kB = (y + 1) * pw + x;
      else kB = edgeBaseV + y * pw + x;

      const id = segX0.length;
      // Subtract 1 from padded coords to map back to image coords (+0.5 centers pixel)
      segX0.push(ax - 0.5);
      segY0.push(ay - 0.5);
      segNextEdge.push(kB);
      edgeToSeg[kA] = id;
    };

    for (let y = 0; y < ph - 1; y++) {
      const row0 = y * pw;
      const row1 = row0 + pw;
      for (let x = 0; x < pw - 1; x++) {
        const v0 = field[row0 + x];
        const v1 = field[row0 + x + 1];
        const v2 = field[row1 + x + 1];
        const v3 = field[row1 + x];
        const code = (v0 < iso ? 1 : 0) | (v1 < iso ? 2 : 0) | (v2 < iso ? 4 : 0) | (v3 < iso ? 8 : 0);
        if (code === 0 || code === 15) continue;

        switch (code) {
          case 1:  addSeg(x, y, 0, 3, v0, v1, v2, v3); break;
          case 2:  addSeg(x, y, 1, 0, v0, v1, v2, v3); break;
          case 3:  addSeg(x, y, 1, 3, v0, v1, v2, v3); break;
          case 4:  addSeg(x, y, 2, 1, v0, v1, v2, v3); break;
          case 5: {
            if ((v0 + v1 + v2 + v3) * 0.25 < iso) {
              addSeg(x, y, 0, 1, v0, v1, v2, v3);
              addSeg(x, y, 2, 3, v0, v1, v2, v3);
            } else {
              addSeg(x, y, 0, 3, v0, v1, v2, v3);
              addSeg(x, y, 2, 1, v0, v1, v2, v3);
            }
            break;
          }
          case 6:  addSeg(x, y, 2, 0, v0, v1, v2, v3); break;
          case 7:  addSeg(x, y, 2, 3, v0, v1, v2, v3); break;
          case 8:  addSeg(x, y, 3, 2, v0, v1, v2, v3); break;
          case 9:  addSeg(x, y, 0, 2, v0, v1, v2, v3); break;
          case 10: {
            if ((v0 + v1 + v2 + v3) * 0.25 < iso) {
              addSeg(x, y, 1, 2, v0, v1, v2, v3);
              addSeg(x, y, 3, 0, v0, v1, v2, v3);
            } else {
              addSeg(x, y, 1, 0, v0, v1, v2, v3);
              addSeg(x, y, 3, 2, v0, v1, v2, v3);
            }
            break;
          }
          case 11: addSeg(x, y, 1, 2, v0, v1, v2, v3); break;
          case 12: addSeg(x, y, 3, 1, v0, v1, v2, v3); break;
          case 13: addSeg(x, y, 0, 1, v0, v1, v2, v3); break;
          case 14: addSeg(x, y, 3, 0, v0, v1, v2, v3); break;
        }
      }
    }

    const nSegs = segX0.length;
    const used = new Uint8Array(nSegs);
    const loops = [];

    for (let i = 0; i < nSegs; i++) {
      if (used[i]) continue;
      const pts = [];
      let cur = i;
      while (cur >= 0 && !used[cur]) {
        used[cur] = 1;
        pts.push({ x: segX0[cur], y: segY0[cur] });
        cur = edgeToSeg[segNextEdge[cur]];
      }
      if (pts.length < 4) continue;
      if (minPerim > 0 && pts.length < minPerim) continue;
      const area = Math.abs(signedArea(pts));
      if (area >= minArea) loops.push(pts);
    }
    return loops;
  }

  function computeArcLengths(pts) {
    const n = pts.length;
    const s = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
      s[i + 1] = s[i] + ptDist(pts[i], pts[(i + 1) % n]);
    }
    return s;
  }

  function sampleClosed(pts, cumS, dist) {
    const L = cumS[pts.length];
    const d = ((dist % L) + L) % L;
    let lo = 0, hi = pts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cumS[mid] <= d) lo = mid;
      else hi = mid - 1;
    }
    const segLen = cumS[lo + 1] - cumS[lo];
    const t = segLen > 1e-9 ? (d - cumS[lo]) / segLen : 0;
    const a = pts[lo], b = pts[(lo + 1) % pts.length];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  function fitLineOLS(pts) {
    let mx = 0, my = 0;
    for (let i = 0; i < pts.length; i++) { mx += pts[i].x; my += pts[i].y; }
    mx /= pts.length; my /= pts.length;
    let sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < pts.length; i++) {
      const dx = pts[i].x - mx, dy = pts[i].y - my;
      sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    }
    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const ux = Math.cos(theta), uy = Math.sin(theta);
    let maxErr = 0;
    for (let i = 0; i < pts.length; i++) {
      const d = Math.abs((pts[i].x - mx) * (-uy) + (pts[i].y - my) * ux);
      if (d > maxErr) maxErr = d;
    }
    return { mx, my, ux, uy, maxErr };
  }

  function intersectLines(L1, L2) {
    const det = L1.ux * L2.uy - L1.uy * L2.ux;
    if (Math.abs(det) < 1e-4) return null;
    const dx = L2.mx - L1.mx, dy = L2.my - L1.my;
    const t = (dx * L2.uy - dy * L2.ux) / det;
    return { x: L1.mx + t * L1.ux, y: L1.my + t * L1.uy };
  }

  function detectCorners(pts, cumS, opts) {
    const n = pts.length;
    const perim = cumS[n];
    const win = Math.min(opts.cornerWindow, perim * 0.12);
    const angles = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      const si = cumS[i];
      const pPrev = sampleClosed(pts, cumS, si - win);
      const pCurr = pts[i];
      const pNext = sampleClosed(pts, cumS, si + win);
      const ax = pCurr.x - pPrev.x, ay = pCurr.y - pPrev.y;
      const bx = pNext.x - pCurr.x, by = pNext.y - pCurr.y;
      const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      if (la < 1e-6 || lb < 1e-6) continue;
      const dot = clamp((ax * bx + ay * by) / (la * lb), -1, 1);
      angles[i] = Math.acos(dot);
    }

    const nmsRad = opts.cornerNms;
    const threshRad = opts.cornerAngleDeg * Math.PI / 180;
    const corners = [];
    for (let i = 0; i < n; i++) {
      if (angles[i] < threshRad) continue;
      let isMax = true;
      for (let dir = -1; dir <= 1; dir += 2) {
        let k = 1;
        while (k < n) {
          const j = (i + dir * k + n) % n;
          let ds = Math.abs(cumS[j] - cumS[i]);
          ds = Math.min(ds, perim - ds);
          if (ds > nmsRad) break;
          if (angles[j] > angles[i] || (angles[j] === angles[i] && j < i)) {
            isMax = false;
            break;
          }
          k++;
        }
        if (!isMax) break;
      }
      if (isMax) corners.push(i);
    }

    const refined = new Map();
    const maxFlank = Math.min(5.2, perim * 0.12);
    if (maxFlank >= 2.2) {
      const sampleFlank = (centerS, sign) => {
        const arr = [];
        for (let d = 1.6; d <= maxFlank; d += 0.6) {
          arr.push(sampleClosed(pts, cumS, centerS + sign * d));
        }
        return arr;
      };
      for (let ci = 0; ci < corners.length; ci++) {
        const idx = corners[ci];
        const L1 = fitLineOLS(sampleFlank(cumS[idx], -1));
        const L2 = fitLineOLS(sampleFlank(cumS[idx], +1));
        if (L1.maxErr < 0.25 && L2.maxErr < 0.25) {
          const ix = intersectLines(L1, L2);
          if (ix && ptDist(ix, pts[idx]) < 1.8) refined.set(idx, ix);
        }
      }
    }
    return { corners, refined };
  }

  function fitSingleQuad(chain) {
    const m = chain.length;
    const p0 = chain[0], p1 = chain[m - 1];
    if (m <= 2) return { c: { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }, maxErr: 0, maxIdx: 1 };

    const t = new Float64Array(m);
    let total = 0;
    for (let i = 1; i < m; i++) {
      total += ptDist(chain[i - 1], chain[i]);
      t[i] = total;
    }
    if (total < 1e-6) return { c: { x: p0.x, y: p0.y }, maxErr: 0, maxIdx: 1 };
    for (let i = 1; i < m; i++) t[i] /= total;

    let numX = 0, numY = 0, den = 0;
    for (let i = 1; i < m - 1; i++) {
      const ti = t[i], ui = 1 - ti, w = 2 * ti * ui;
      numX += w * (chain[i].x - ui * ui * p0.x - ti * ti * p1.x);
      numY += w * (chain[i].y - ui * ui * p0.y - ti * ti * p1.y);
      den += w * w;
    }
    if (den < 1e-9) return { c: { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }, maxErr: 0, maxIdx: 1 };
    let cx = numX / den, cy = numY / den;

    for (let iter = 0; iter < 2; iter++) {
      for (let i = 1; i < m - 1; i++) {
        let ti = t[i];
        const qx = chain[i].x, qy = chain[i].y;
        for (let nr = 0; nr < 2; nr++) {
          const ui = 1 - ti;
          const bx = ui * ui * p0.x + 2 * ui * ti * cx + ti * ti * p1.x;
          const by = ui * ui * p0.y + 2 * ui * ti * cy + ti * ti * p1.y;
          const d1x = 2 * (ui * (cx - p0.x) + ti * (p1.x - cx));
          const d1y = 2 * (ui * (cy - p0.y) + ti * (p1.y - cy));
          const d2x = 2 * (p1.x - 2 * cx + p0.x);
          const d2y = 2 * (p1.y - 2 * cy + p0.y);
          const fx = bx - qx, fy = by - qy;
          const num = fx * d1x + fy * d1y;
          const dnm = d1x * d1x + d1y * d1y + fx * d2x + fy * d2y;
          if (Math.abs(dnm) > 1e-9) ti = clamp(ti - num / dnm, 0.001, 0.999);
        }
        t[i] = ti;
      }
      numX = 0; numY = 0; den = 0;
      for (let i = 1; i < m - 1; i++) {
        const ti = t[i], ui = 1 - ti, w = 2 * ti * ui;
        numX += w * (chain[i].x - ui * ui * p0.x - ti * ti * p1.x);
        numY += w * (chain[i].y - ui * ui * p0.y - ti * ti * p1.y);
        den += w * w;
      }
      if (den > 1e-9) { cx = numX / den; cy = numY / den; }
    }

    let maxErr = 0, maxIdx = m >> 1;
    for (let i = 1; i < m - 1; i++) {
      const ti = t[i], ui = 1 - ti;
      const bx = ui * ui * p0.x + 2 * ui * ti * cx + ti * ti * p1.x;
      const by = ui * ui * p0.y + 2 * ui * ti * cy + ti * ti * p1.y;
      const err = Math.hypot(chain[i].x - bx, chain[i].y - by);
      if (err > maxErr) { maxErr = err; maxIdx = i; }
    }
    return { c: { x: cx, y: cy }, maxErr, maxIdx };
  }

  function maxLineDeviation(chain) {
    const a = chain[0], b = chain[chain.length - 1];
    let maxD = 0, maxIdx = 1;
    for (let i = 1; i < chain.length - 1; i++) {
      const d = ptLineDist(chain[i], a, b);
      if (d > maxD) { maxD = d; maxIdx = i; }
    }
    return { maxD, maxIdx };
  }

  // Detect a clean straight prefix/suffix transitioning into a rounded corner.
  // Uses a fast strided scan + binary refinement so even very long chains stay O(N log N).
  function extractStraightPrefixSuffix(chain, lineTol) {
    const m = chain.length;
    if (m < 10) return null;
    const tight = lineTol * 0.65;
    const isStraightRange = (lo, hi) => {
      const a = chain[lo], b = chain[hi];
      for (let i = lo + 1; i < hi; i++) {
        if (ptLineDist(chain[i], a, b) > tight) return false;
      }
      return true;
    };

    // Binary search longest straight prefix
    if (isStraightRange(0, 6)) {
      let lo = 6, hi = m - 4;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (isStraightRange(0, mid)) lo = mid;
        else hi = mid - 1;
      }
      if (lo >= 6 && ptDist(chain[0], chain[lo]) >= 8 && m - lo >= 5) return lo;
    }

    // Binary search longest straight suffix
    if (isStraightRange(m - 7, m - 1)) {
      let lo = 3, hi = m - 7;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (isStraightRange(mid, m - 1)) hi = mid;
        else lo = mid + 1;
      }
      if (hi <= m - 7 && ptDist(chain[hi], chain[m - 1]) >= 8 && hi >= 5) return hi;
    }
    return null;
  }

  function fitChain(chain, opts, depth) {
    const m = chain.length;
    const p0 = chain[0], p1 = chain[m - 1];
    if (m <= 2 || ptDist(p0, p1) < 0.5) return [['L', p1.x, p1.y]];
    if (maxLineDeviation(chain).maxD <= opts.lineTol) return [['L', p1.x, p1.y]];

    if (depth < 16) {
      const transIdx = extractStraightPrefixSuffix(chain, opts.lineTol);
      if (transIdx !== null && transIdx > 1 && transIdx < m - 2) {
        return fitChain(chain.slice(0, transIdx + 1), opts, depth + 1)
          .concat(fitChain(chain.slice(transIdx), opts, depth + 1));
      }
    }

    const q = fitSingleQuad(chain);
    const chord = ptDist(p0, p1);
    const ctrlDist = ptLineDist(q.c, p0, p1);
    const badCtrl = ctrlDist > Math.max(18, chord * 0.9);
    if ((!badCtrl && q.maxErr <= opts.curveTol) || m <= 4 || depth >= 24) {
      if (badCtrl || ctrlDist < 0.18) return [['L', p1.x, p1.y]];
      return [['Q', q.c.x, q.c.y, p1.x, p1.y]];
    }

    let split = q.maxIdx;
    if (split <= 1 || split >= m - 2) split = m >> 1;
    return fitChain(chain.slice(0, split + 1), opts, depth + 1)
      .concat(fitChain(chain.slice(split), opts, depth + 1));
  }

  function snapAxisAlignedLines(start, segs, maxRad) {
    const n = segs.length;
    if (n < 2) return;
    const endPt = (i) => {
      const s = segs[i];
      return s[0] === 'L' ? { x: s[1], y: s[2] } : { x: s[3], y: s[4] };
    };
    const setEndPt = (i, x, y) => {
      const s = segs[i];
      if (s[0] === 'L') { s[1] = x; s[2] = y; }
      else { s[3] = x; s[4] = y; }
      if (i === n - 1) { start.x = x; start.y = y; }
    };
    for (let i = 0; i < n; i++) {
      const s = segs[i];
      if (s[0] !== 'L') continue;
      const prevIdx = (i - 1 + n) % n;
      const a = endPt(prevIdx);
      const b = endPt(i);
      const dx = b.x - a.x, dy = b.y - a.y;
      if (Math.hypot(dx, dy) < 6) continue;
      const ang = Math.atan2(Math.abs(dy), Math.abs(dx));
      if (ang < maxRad) {
        const avgY = (a.y + b.y) * 0.5;
        setEndPt(prevIdx, a.x, avgY);
        setEndPt(i, b.x, avgY);
      } else if (Math.abs(Math.PI * 0.5 - ang) < maxRad) {
        const avgX = (a.x + b.x) * 0.5;
        setEndPt(prevIdx, avgX, a.y);
        setEndPt(i, avgX, b.y);
      }
    }
  }

  function vectorizeLoop(pts, opts) {
    const n = pts.length;
    const cumS = computeArcLengths(pts);
    const perim = cumS[n];

    let anchors = [];
    let refined = new Map();
    if (opts.corners) {
      const det = detectCorners(pts, cumS, opts);
      anchors = det.corners.slice();
      refined = det.refined;
    }

    // Add cardinal extrema (minX/maxX/minY/maxY) away from existing anchors so
    // smooth ovals/curves split symmetrically into short quadratic spans.
    const nearExisting = (idx, minDist) => {
      for (let i = 0; i < anchors.length; i++) {
        let ds = Math.abs(cumS[idx] - cumS[anchors[i]]);
        ds = Math.min(ds, perim - ds);
        if (ds < minDist) return true;
      }
      return false;
    };
    let iMinX = 0, iMaxX = 0, iMinY = 0, iMaxY = 0;
    for (let i = 1; i < n; i++) {
      if (pts[i].x < pts[iMinX].x) iMinX = i;
      if (pts[i].x > pts[iMaxX].x) iMaxX = i;
      if (pts[i].y < pts[iMinY].y) iMinY = i;
      if (pts[i].y > pts[iMaxY].y) iMaxY = i;
    }
    const minExtGap = Math.min(6.0, perim * 0.08);
    const exts = [iMinX, iMaxX, iMinY, iMaxY];
    for (let e = 0; e < 4; e++) {
      if (!nearExisting(exts[e], minExtGap)) anchors.push(exts[e]);
    }
    anchors.sort((a, b) => a - b);
    if (anchors.length < 2) {
      anchors.push((anchors[0] + (n >> 1)) % n);
      anchors.sort((a, b) => a - b);
    }

    const segs = [];
    const anchorPt = (idx) => refined.get(idx) || pts[idx];
    const start = { x: anchorPt(anchors[0]).x, y: anchorPt(anchors[0]).y };

    for (let ai = 0; ai < anchors.length; ai++) {
      const i0 = anchors[ai];
      const i1 = anchors[(ai + 1) % anchors.length];
      const chain = [anchorPt(i0)];
      let k = (i0 + 1) % n;
      while (k !== i1) {
        chain.push(pts[k]);
        k = (k + 1) % n;
      }
      chain.push(anchorPt(i1));
      if (opts.smooth) {
        while (chain.length > 3 && ptDist(chain[0], chain[1]) < 0.7) chain.splice(1, 1);
        while (chain.length > 3 && ptDist(chain[chain.length - 1], chain[chain.length - 2]) < 0.7) {
          chain.splice(chain.length - 2, 1);
        }
      }
      const fitted = fitChain(chain, opts, 0);
      for (let f = 0; f < fitted.length; f++) segs.push(fitted[f]);
    }

    if (opts.smooth) {
      snapAxisAlignedLines(start, segs, 1.4 * Math.PI / 180);
    }
    return { start, segs };
  }

  function fmt(v) {
    const r = Math.round(v * 100) / 100;
    return Object.is(r, -0) ? '0' : String(r);
  }

  // Main entry point: RGBA ImageData + MiniSketch trace options -> { svg, paths, width, height }
  function traceImageData(imgd, opts) {
    const o = opts || {};
    const w = imgd.width, h = imgd.height;
    const iso = clamp(isFinite(+o.threshold) ? +o.threshold : 128, 1, 254);
    const detail = clamp(isFinite(+o.detail) ? +o.detail : 2, 0.01, 20);
    const curve = clamp(isFinite(+o.curve) ? +o.curve : 1, 0.01, 20);
    const speckle = clamp(isFinite(+o.speckle) ? +o.speckle : 8, 0, 200);
    const blur = clamp(isFinite(+o.blur) ? +o.blur : 0, 0, 5);
    const corners = o.corners !== false;
    const smooth = o.smooth !== false;

    // Map MiniSketch dialog knobs onto sub-pixel fitting tolerances:
    //   detail=2 -> lineTol ~0.44 px;  curve=1 -> curveTol ~0.40 px
    const fitOpts = {
      lineTol: clamp(detail * 0.22, 0.12, 5.0),
      curveTol: clamp(curve * 0.40, 0.12, 6.0),
      cornerWindow: 3.2,
      cornerNms: 3.0,
      cornerAngleDeg: 32,
      corners,
      smooth
    };

    const { field, pw, ph } = imageDataToPaddedGray(imgd, blur);
    const minArea = Math.max(2.0, speckle * 1.2);
    const rawLoops = marchingSquaresSubpixel(field, pw, ph, iso, minArea, speckle);

    const parts = [];
    for (let i = 0; i < rawLoops.length; i++) {
      const c = vectorizeLoop(rawLoops[i], fitOpts);
      if (!c.segs.length) continue;
      let d = 'M ' + fmt(c.start.x) + ' ' + fmt(c.start.y);
      for (let s = 0; s < c.segs.length; s++) {
        const seg = c.segs[s];
        if (seg[0] === 'L') d += ' L ' + fmt(seg[1]) + ' ' + fmt(seg[2]);
        else d += ' Q ' + fmt(seg[1]) + ' ' + fmt(seg[2]) + ' ' + fmt(seg[3]) + ' ' + fmt(seg[4]);
      }
      d += ' Z';
      parts.push('<path fill="rgb(0,0,0)" fill-rule="evenodd" d="' + d + '" />');
    }

    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w +
      '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' + parts.join('') + '</svg>';
    return { svg, paths: parts.length, width: w, height: h };
  }

  const api = { traceImageData, blurGray };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.SubPixelTracer = api;
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
