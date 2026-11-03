// Probe: the exact outline reader in fonts/fonts.js against the same glyph as
// fontTools sees it. Slices the parser out of fonts/fonts.js (no DOM needed),
// feeds it the real TTF bytes and compares node for node with a JSON dump made
// by fontTools (glyf + cmap + hmtx). Run:
//   uv run --with fonttools python3 fonts/extract_truth.py   (writes truth json)
//   node testing/font_outline_probe.js
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'fonts', 'fonts.js'), 'utf8');
const truthFile = process.argv[2] || path.join(__dirname, 'font_truth.json');
const truth = JSON.parse(fs.readFileSync(truthFile, 'utf8'));

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

function braceEnd(s, from) {
  let d = 0;
  for (let j = s.indexOf('{', from); j < s.length; j++) {
    if (s[j] === '{') d++;
    else if (s[j] === '}') { d--; if (!d) return j + 1; }
  }
  throw new Error('unbalanced');
}
const sliceFn = (name) => {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('not found: ' + name);
  let i = src.indexOf('(', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') { depth--; if (!depth) break; }
  }
  return src.slice(start, braceEnd(src, i));
};

const api = new Function(sliceFn('qInterp') + '\n' + sliceFn('finishContour') + '\n' +
  sliceFn('parseFont') + '\n' + sliceFn('contourSegs') + '\n' +
  'return { parseFont };')();
const C = require(path.join(__dirname, '..', 'core.js'));

// A stored contour -> its segments, so both sides of the comparison can be
// densified the same way.
function contourSegments(c) {
  const v = c.v, n = c.n;
  const segs = [];
  const node = (i) => ({
    x: v[i * 6], y: v[i * 6 + 1],
    ix: v[i * 6 + 2], iy: v[i * 6 + 3],
    ox: v[i * 6 + 4], oy: v[i * 6 + 5]
  });
  for (let k = 0; k < n; k++) {
    const a = node(k), b = node((k + 1) % n);
    const flat = Math.abs(a.ox - a.x) < 1e-9 && Math.abs(a.oy - a.y) < 1e-9 &&
      Math.abs(b.ix - b.x) < 1e-9 && Math.abs(b.iy - b.y) < 1e-9;
    segs.push(flat ? ['L', b.x, b.y] : ['C', a.ox, a.oy, b.ix, b.iy, b.x, b.y]);
  }
  return segs;
}

// segment list -> dense points. `start` is where the first segment begins.
function segsToPoints(segs, start, per) {
  // the start point IS part of the contour: leaving it out closes the polyline
  // from the last point straight to the second point and cuts every corner that
  // begins a contour
  const pts = [start];
  let cur = start;
  const push = (p) => { pts.push(p); cur = p; };
  for (const s of segs) {
    if (s[0] === 'L') {
      const b = { x: s[1], y: s[2] };
      for (let k = 1; k <= per; k++) pts.push({ x: cur.x + (b.x - cur.x) * k / per, y: cur.y + (b.y - cur.y) * k / per });
      cur = b;
    } else if (s[0] === 'Q') {
      const c = { x: s[1], y: s[2] }, b = { x: s[3], y: s[4] };
      for (let k = 1; k <= per; k++) {
        const t = k / per, u = 1 - t;
        pts.push({ x: u * u * cur.x + 2 * u * t * c.x + t * t * b.x, y: u * u * cur.y + 2 * u * t * c.y + t * t * b.y });
      }
      cur = b;
    } else {
      const c1 = { x: s[1], y: s[2] }, c2 = { x: s[3], y: s[4] }, b = { x: s[5], y: s[6] };
      for (let k = 1; k <= per; k++) {
        const t = k / per, u = 1 - t;
        pts.push({
          x: u * u * u * cur.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
          y: u * u * u * cur.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y
        });
      }
      cur = b;
    }
  }
  return pts;
}

function ptSegDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
  let t = L > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
// one-sided max distance from point set P to the closed polyline through Q
function maxToSet(P, Q) {
  let worst = 0;
  for (const p of P) {
    let best = Infinity;
    for (let i = 0; i < Q.length; i++) {
      const d = ptSegDist(p, Q[i], Q[(i + 1) % Q.length]);
      if (d < best) best = d;
    }
    if (best > worst) worst = best;
  }
  return worst;
}

for (const test of truth.fonts) {
  const file = path.join(__dirname, '..', 'fonts', 'src', test.file);
  const buf = fs.readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  console.log('\n== ' + test.file);
  const parsed = api.parseFont(ab, test.file);
  if (!parsed) { check('font parsed', false); continue; }
  check('font parsed', true);
  check('unitsPerEm', parsed.upem === test.upem, parsed.upem + ' vs ' + test.upem);
  check('ascent/descent', parsed.asc === test.asc && parsed.desc === test.desc,
    parsed.asc + '/' + parsed.desc + ' vs ' + test.asc + '/' + test.desc);

  for (const ch of test.chars) {
    const key = String(ch.code);
    const mine = parsed.glyph(+key) || [];
    check('glyph "' + ch.char + '" found', mine.length === ch.contours.length,
      mine.length + ' contours vs ' + ch.contours.length);
    let worst = 0;
    for (let ci = 0; ci < ch.contours.length; ci++) {
      const refSegs = ch.contours[ci].segs;     // exact font segments
      const refStart = { x: ch.contours[ci].start[0], y: ch.contours[ci].start[1] };
      const got = mine[ci];
      if (!got) continue;
      // reference: densify the font's OWN segments (lines + quadratics), so the
      // comparison target is the designed curve, not a chord approximation
      const refPts = segsToPoints(refSegs, refStart, 64);
      const gotPts = segsToPoints(contourSegments(got), refStart, 64);
      const d1 = maxToSet(gotPts, refPts);
      const d2 = maxToSet(refPts, gotPts);
      worst = Math.max(worst, d1, d2);
    }
    // 0.5 design units at upem 1000-2048 is ~0.03% of an em: a correct parser
    // lands far inside that; anything larger means a wrong segment or handle.
    check('glyph "' + ch.char + '" matches the font outline', worst < 0.5,
      'worst ' + worst.toFixed(4) + ' units');
  }
}

console.log('\n' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
