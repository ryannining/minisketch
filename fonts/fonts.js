// MiniSketchFonts — the font catalogue for the Text dialog.
//
// The app runs from file://, where fetch() is blocked and @font-face URLs are
// CORS-checked. The one route that always works is the FontFace API fed an
// ArrayBuffer, so every bundled family ships as a generated JS file holding
// its base64 bytes (fonts/build.js writes them from fonts/src/*.ttf).
//
// Only the index below is parsed at startup; the per-font file is injected as
// a <script> the first time that family is chosen, then decoded and
// registered. Imported fonts (the user's own .ttf/.otf) are kept in IndexedDB
// and registered the same way on every startup.
//
// FONT_EPOCH bumps on every load: canvas tracing caches contours by trace key,
// and a font that arrives late must not let the old (fallback-font) trace
// survive under a key that looks correct.
(() => {
  'use strict';

  // Parse-time base: injectScript runs later, when document.currentScript is
  // null. Under a subpath (/sketcher) a document-relative 'fonts/x.js' would
  // resolve one level too high and 404.
  const FONT_BASE = ((document.currentScript && document.currentScript.src) || location.href).replace(/[^/]*$/, '');

  const FONT_INDEX = [
    {
      "family": "Liberation Sans",
      "category": "Sans",
      "weight": 400,
      "style": "normal",
      "license": "SIL OFL 1.1 / GPL+exception",
      "file": "liberation-sans.js"
    },
    {
      "family": "Liberation Sans",
      "category": "Sans",
      "weight": 700,
      "style": "normal",
      "license": "SIL OFL 1.1 / GPL+exception",
      "file": "liberation-sans-bold.js"
    },
    {
      "family": "Liberation Serif",
      "category": "Serif",
      "weight": 400,
      "style": "normal",
      "license": "SIL OFL 1.1 / GPL+exception",
      "file": "liberation-serif.js"
    },
    {
      "family": "Liberation Serif",
      "category": "Serif",
      "weight": 400,
      "style": "italic",
      "license": "SIL OFL 1.1 / GPL+exception",
      "file": "liberation-serif-italic.js"
    },
    {
      "family": "Liberation Serif",
      "category": "Serif",
      "weight": 700,
      "style": "normal",
      "license": "SIL OFL 1.1 / GPL+exception",
      "file": "liberation-serif-bold.js"
    },
    {
      "family": "Liberation Serif",
      "category": "Serif",
      "weight": 700,
      "style": "italic",
      "license": "SIL OFL 1.1 / GPL+exception",
      "file": "liberation-serif-bold-italic.js"
    },
    {
      "family": "Liberation Mono",
      "category": "Monospace",
      "weight": 400,
      "style": "normal",
      "license": "SIL OFL 1.1 / GPL+exception",
      "file": "liberation-mono.js"
    },
    {
      "family": "Noto Sans",
      "category": "Sans",
      "weight": 400,
      "style": "normal",
      "license": "SIL OFL 1.1",
      "file": "noto-sans.js"
    },
    {
      "family": "Noto Serif",
      "category": "Serif",
      "weight": 400,
      "style": "normal",
      "license": "SIL OFL 1.1",
      "file": "noto-serif.js"
    },
    {
      "family": "Carlito",
      "category": "Sans",
      "weight": 400,
      "style": "normal",
      "license": "SIL OFL 1.1",
      "file": "carlito.js"
    },
    {
      "family": "Anak Manja",
      "category": "Script",
      "weight": 400,
      "style": "normal",
      "license": "Free for personal & commercial use (Khurasan)",
      "file": "anak-manja.js"
    },
    {
      "family": "Matcha Style",
      "category": "Script",
      "weight": 400,
      "style": "normal",
      "license": "Free for personal & commercial use (Khurasan)",
      "file": "matcha-style.js"
    },
    {
      "family": "GROBOLD",
      "category": "Display",
      "weight": 400,
      "style": "normal",
      "license": "Free / donationware (Guy Buhry)",
      "file": "grobold.js"
    },
    {
      "family": "Super Mario 256",
      "category": "Display",
      "weight": 400,
      "style": "normal",
      "license": "Free (fsuarez913) — lettering is a Nintendo trademark",
      "file": "super-mario-256.js"
    },
    {
      "family": "Rony Mono",
      "category": "Monospace",
      "weight": 400,
      "style": "normal",
      "license": "Free (Rony Setya Siswadi)",
      "file": "rony-mono.js"
    },
    {
      "family": "Rony Mono",
      "category": "Monospace",
      "weight": 700,
      "style": "normal",
      "license": "Free (Rony Setya Siswadi)",
      "file": "rony-mono-bold.js"
    },
    {
      "family": "Avigea",
      "category": "Serif",
      "weight": 400,
      "style": "normal",
      "license": "Personal use only (Storytype Studio)",
      "file": "avigea.js"
    },
    {
      "family": "Avigea",
      "category": "Serif",
      "weight": 400,
      "style": "italic",
      "license": "Personal use only (Storytype Studio)",
      "file": "avigea-italic.js"
    },
    {
      "family": "Billion Dreams",
      "category": "Script",
      "weight": 400,
      "style": "normal",
      "license": "Personal use only (Mans Greback)",
      "file": "billion-dreams.js"
    },
    {
      "family": "Birds of Paradise",
      "category": "Script",
      "weight": 400,
      "style": "normal",
      "license": "Personal use only (Herofonts)",
      "file": "birds-of-paradise.js"
    },
    {
      "family": "Bright Sunlist",
      "category": "Serif",
      "weight": 400,
      "style": "normal",
      "license": "Personal use only (Letterena Studios)",
      "file": "bright-sunlist.js"
    },
    {
      "family": "Bright Sunlist",
      "category": "Serif",
      "weight": 400,
      "style": "italic",
      "license": "Personal use only (Letterena Studios)",
      "file": "bright-sunlist-italic.js"
    },
    {
      "family": "Chocolate Crispy",
      "category": "Script",
      "weight": 400,
      "style": "normal",
      "license": "Personal use only (ERGIBI Studio)",
      "file": "chocolate-crispy.js"
    },
    {
      "family": "Darling",
      "category": "Script",
      "weight": 400,
      "style": "normal",
      "license": "Personal use only (GFRcreative)",
      "file": "darling.js"
    },
    {
      "family": "Janda Manatee Bubble",
      "category": "Display",
      "weight": 400,
      "style": "normal",
      "license": "Personal use only (Kimberly Geswein)",
      "file": "janda-manatee-bubble.js"
    },
    {
      "family": "Janda Manatee Solid",
      "category": "Display",
      "weight": 400,
      "style": "normal",
      "license": "Personal use only (Kimberly Geswein)",
      "file": "janda-manatee-solid.js"
    },
    {
      "family": "Mercy Christole",
      "category": "Serif",
      "weight": 400,
      "style": "normal",
      "license": "Personal use only (HansCo)",
      "file": "mercy-christole.js"
    },
    {
      "family": "Milesdane Trial",
      "category": "Script",
      "weight": 400,
      "style": "normal",
      "license": "Personal use only (Ekobi Mantara)",
      "file": "milesdane-trial.js"
    },
    {
      "family": "Rasley Heights",
      "category": "Script",
      "weight": 400,
      "style": "normal",
      "license": "Personal use only (Mans Greback)",
      "file": "rasley-heights.js"
    },
    {
      "family": "Saltblack Combat",
      "category": "Display",
      "weight": 400,
      "style": "normal",
      "license": "Personal use only (Alit Design)",
      "file": "saltblack-combat.js"
    },
    {
      "family": "Simply Olive",
      "category": "Script",
      "weight": 400,
      "style": "normal",
      "license": "Personal use only (Niskala Huruf)",
      "file": "simply-olive.js"
    },
    {
      "family": "Supersonic Rocketship",
      "category": "Display",
      "weight": 400,
      "style": "normal",
      "license": "Personal use only (Imagex)",
      "file": "supersonic-rocketship.js"
    },
    {
      "family": "Super Waffles",
      "category": "Display",
      "weight": 400,
      "style": "normal",
      "license": "No licence text in the download",
      "file": "super-waffles.js"
    },
    {
      "family": "Sweety Rasty",
      "category": "Script",
      "weight": 400,
      "style": "normal",
      "license": "Personal use only (Holydie Studio)",
      "file": "sweety-rasty.js"
    },
    {
      "family": "Cocogoose Pro",
      "category": "Display",
      "weight": 400,
      "style": "normal",
      "license": "CC BY-NC (Zetafonts) — credit required",
      "file": "cocogoose-pro.js"
    },
    {
      "family": "Cocogoose Pro",
      "category": "Display",
      "weight": 300,
      "style": "normal",
      "license": "CC BY-NC (Zetafonts) — credit required",
      "file": "cocogoose-pro-light.js"
    },
    {
      "family": "Cocogoose Pro",
      "category": "Display",
      "weight": 700,
      "style": "normal",
      "license": "CC BY-NC (Zetafonts) — credit required",
      "file": "cocogoose-pro-bold.js"
    },
    {
      "family": "Cocogoose Pro",
      "category": "Display",
      "weight": 400,
      "style": "italic",
      "license": "CC BY-NC (Zetafonts) — credit required",
      "file": "cocogoose-pro-italic.js"
    },
    {
      "family": "Cocogoose Pro",
      "category": "Display",
      "weight": 700,
      "style": "italic",
      "license": "CC BY-NC (Zetafonts) — credit required",
      "file": "cocogoose-pro-bold-italic.js"
    },
    {
      "family": "Nasalization",
      "category": "Display",
      "weight": 400,
      "style": "normal",
      "license": "Typodermic Desktop EULA — no embedding in software",
      "file": "nasalization.js"
    },
    {
      "family": "Dealerplate California",
      "category": "Display",
      "weight": 400,
      "style": "normal",
      "license": "Typodermic Desktop EULA — no embedding in software",
      "file": "dealerplate-california.js"
    }
  ];
;
;

  const categories = () => {
    const seen = [];
    for (const f of FONT_INDEX) {
      if (f.category && !seen.includes(f.category)) seen.push(f.category);
    }
    if (imported.length && !seen.includes('Imported')) seen.push('Imported');
    if (systemStored().length && !seen.includes('System')) seen.push('System');
    return seen;
  };

  const known = (family) => FONT_INDEX.some(f => f.family === family);

  // families declared in the index but whose bytes are not registered yet
  const pending = new Set(FONT_INDEX.map(f => f.family));
  const registered = new Set();
  const loading = new Map();          // family -> Promise
  const buffers = new Map();          // family -> ArrayBuffer (exact outline source)
  const faces = new Map();            // "family|weight|style" -> parsed glyf outlines

  let epoch = 0;
  const listeners = [];
  const bumpEpoch = () => {
    epoch++;
    for (const fn of listeners) {
      try { fn(); } catch (err) { /* a listener must not break the rest */ }
    }
  };

  function decodeB64(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  // A family ships several members (regular / bold); each has its own outline
  // data, so the key carries weight and style. Keying by family alone made a
  // Bold text convert with the Regular letterforms.
  const faceKey = (family, weight, style) =>
    family + '|' + (weight || 400) + '|' + (style || 'normal');

  function registerFace(family, weight, style, buffer, file) {
    const face = new FontFace(family, buffer, {
      weight: String(weight || 400),
      style: style || 'normal'
    });
    return face.load().then(() => {
      document.fonts.add(face);
      pending.delete(family);
      bumpEpoch();
      // Parse the outline tables while the bytes are still unreferenced. A
      // font with no usable glyf (CFF, malformed) simply has no exact source
      // and the tracer keeps doing the work.
      const exact = file ? parseFont(buffer, file) : null;
      if (exact) faces.set(faceKey(family, weight, style), exact);
      return family;
    });
  }

  // ---- Exact outlines from the font's own tables ---------------------------
  // The canvas trace (raster + marching squares + Douglas-Peucker) is an
  // APPROXIMATION of the glyph, good to a fraction of a pixel. The outline that
  // -> Curve has to hand to the machine is in the font file itself: `glyf`
  // stores quadratic B-spline segments and straight lines, exactly. Reading
  // them means the converted geometry is the glyph, not a tracing of it, so no
  // tolerance is lost and no fitter has to guess the shape back.
  //
  // Only the TrueType `glyf` flavour is understood. CFF/OTF outlines (cubic
  // charstrings) fall back to the trace.
  //
  // Units: the font's own design units (unitsPerEm). Scaling and the flip from
  // font-up to canvas-down happen in app.js against the same metrics the
  // canvas text uses, so the outline lands on the drawn glyph.
  function qInterp(a, b, c, t) {
    const u = 1 - t;
    return { x: u * u * a.x + 2 * u * t * b.x + t * t * c.x, y: u * u * a.y + 2 * u * t * b.y + t * t * c.y };
  }

  // One closed contour of on-curve nodes with handles (font units, y up).
  function finishContour(segs, start) {
    // segs: [{kind:'line'|'quad', a, ctrl?, b}] in order, first seg starts at `start`
    const nodes = [{ x: start.x, y: start.y, ix: start.x, iy: start.y }];
    const straight = [];
    const clean = (s) => Math.abs(s) < 1e-6 ? 0 : Math.round(s * 1e4) / 1e4;
    for (const s of segs) {
      if (s.kind === 'line') {
        const P = { x: s.b.x, y: s.b.y };
        const A = nodes[nodes.length - 1];
        // a zero-length span is a repeated point: the font uses one where the
        // outline turns, and it carries no geometry
        if (Math.hypot(P.x - A.x, P.y - A.y) < 1e-9) continue;
        A.ox = A.x; A.oy = A.y;
        nodes.push({ x: P.x, y: P.y, ix: P.x, iy: P.y });
        straight.push({ x0: clean(A.x), y0: clean(A.y), x1: clean(P.x), y1: clean(P.y) });
        continue;
      }
      const a = nodes[nodes.length - 1];
      const c = s.ctrl;
      const b = s.b;
      // quadratic B-spline -> the cubic that IS the curve (exact, one span)
      a.ox = a.x + (2 / 3) * (c.x - a.x);
      a.oy = a.y + (2 / 3) * (c.y - a.y);
      const nb = { x: b.x, y: b.y, ix: b.x + (2 / 3) * (c.x - b.x), iy: b.y + (2 / 3) * (c.y - b.y) };
      nodes.push(nb);
    }
    if (nodes.length < 2) return null;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    // The contour is closed: the last segment lands back on the first node. The
    // duplicate is dropped, but its INCOMING handle belongs to the first node —
    // losing it turned the closing span into a corner (a visible dent on every
    // round glyph: the top of an `o`, the tail of an `r`).
    if (Math.hypot(last.x - first.x, last.y - first.y) < 1e-9) {
      if (last.ix != null) { first.ix = last.ix; first.iy = last.iy; }
      nodes.pop();
    }
    if (nodes.length < 2) return null;
    const flat = [];
    for (const n of nodes) {
      flat.push(clean(n.x), clean(n.y), clean(n.ix), clean(n.iy), clean(n.ox == null ? n.x : n.ox), clean(n.oy == null ? n.y : n.oy));
    }
    return { n: nodes.length, v: flat, st: straight };
  }

  // TrueType `glyf` decode. Returns {upem, asc, desc, glyph(code)} in the
  // font's own units (y up), or null when the file has no TrueType outlines.
  function parseFont(buffer, file) {
    try {
      const view = new DataView(buffer);
      const tag = (off) => String.fromCharCode(view.getUint8(off), view.getUint8(off + 1), view.getUint8(off + 2), view.getUint8(off + 3));
      const numTables = view.getUint16(4);
      const tab = {};
      for (let i = 0; i < numTables; i++) {
        const rec = 12 + i * 16;
        tab[tag(rec)] = { off: view.getUint32(rec + 8), len: view.getUint32(rec + 12) };
      }
      if (!tab.glyf || !tab.loca || !tab.head || !tab.maxp || !tab.cmap || !tab.hhea || !tab.hmtx) return null;
      const upem = view.getUint16(tab.head.off + 18);
      const locFormat = view.getInt16(tab.head.off + 50);
      const numGlyphs = view.getUint16(tab.maxp.off + 4);
      const asc = view.getInt16(tab.hhea.off + 4);
      const desc = view.getInt16(tab.hhea.off + 6);
      const locaAt = (g) => locFormat === 0
        ? view.getUint16(tab.loca.off + g * 2) * 2
        : view.getUint32(tab.loca.off + g * 4);

      // byte -> set of char codes (format 4 plus format 12, format 6 and 0)
      const cmapOf = {};
      try {
        const nSub = view.getUint16(tab.cmap.off + 2);
        let best = -1, bestScore = -1;
        for (let i = 0; i < nSub; i++) {
          const rec = tab.cmap.off + 4 + i * 8;
          const pid = view.getUint16(rec);
          const eid = view.getUint16(rec + 2);
          const off = view.getUint32(rec + 4);
          const fmt = view.getUint16(tab.cmap.off + off);
          const score = (fmt === 12 ? 3 : fmt === 4 ? 2 : fmt === 6 ? 1 : fmt === 0 ? 1 : -1) +
            (pid === 3 && eid === 10 ? 0.5 : pid === 3 && eid === 1 ? 0.25 : pid === 0 ? 0.1 : 0);
          if (score > bestScore) { bestScore = score; best = tab.cmap.off + off; }
        }
        if (best >= 0) {
          const fmt = view.getUint16(best);
          if (fmt === 4) {
            const segX2 = view.getUint16(best + 6);
            const ends = best + 14;
            const starts = ends + segX2 + 2;
            const deltas = starts + segX2;
            const ranges = deltas + segX2;
            for (let s = 0; s < segX2; s += 2) {
              const end = view.getUint16(ends + s);
              const start = view.getUint16(starts + s);
              const delta = view.getInt16(deltas + s);
              const ro = view.getUint16(ranges + s);
              if (start > end || start === 0xffff) continue;
              for (let c = start; c <= end && c !== 0x10000; c++) {
                let g;
                if (!ro) g = (c + delta) & 0xffff;
                else {
                  const at = ranges + s + ro + (c - start) * 2;
                  if (at + 1 >= buffer.byteLength) break;
                  g = view.getUint16(at);
                  if (g) g = (g + delta) & 0xffff;
                }
                if (g && g < numGlyphs) cmapOf[c] = g;
              }
            }
          } else if (fmt === 12) {
            const n = view.getUint32(best + 12);
            for (let i = 0; i < n; i++) {
              const rec = best + 16 + i * 12;
              const s0 = view.getUint32(rec);
              const s1 = view.getUint32(rec + 4);
              const g0 = view.getUint32(rec + 8);
              for (let c = s0; c <= s1 && c < 0x110000; c++) {
                if (g0 + (c - s0) < numGlyphs) cmapOf[c] = g0 + (c - s0);
              }
            }
          }
        }
      } catch (err) { /* no usable cmap: no exact source */ }
      if (!Object.keys(cmapOf).length) return null;

      const glyphCache = new Map();
      // Composite glyphs reference other glyphs by id with an affine 2x2; the
      // recursion depth is 5 by spec, and a self-reference would be a corrupt
      // font, so both are bounded.
      const glyphContours = (gid, depth) => {
        if (glyphCache.has(gid)) return glyphCache.get(gid);
        const out = [];
        if (gid >= numGlyphs || depth > 6) return out;   // do not cache a truncated read
        let p = tab.glyf.off + locaAt(gid);
        const next = tab.glyf.off + locaAt(gid + 1);
        if (p >= next) { glyphCache.set(gid, out); return out; }
        const nContours = view.getInt16(p);
        p += 10;
        if (nContours >= 0) {
          const ends = [];
          for (let i = 0; i < nContours; i++, p += 2) ends.push(view.getUint16(p));
          const nPts = nContours ? ends[nContours - 1] + 1 : 0;
          const insLen = view.getUint16(p); p += 2 + insLen;
          const flags = new Uint8Array(nPts);
          for (let i = 0; i < nPts;) {
            const f = view.getUint8(p++);
            flags[i++] = f;
            if (f & 8) {
              let rep = view.getUint8(p++);
              while (rep-- > 0 && i < nPts) flags[i++] = f;
            }
          }
          const xs = new Array(nPts);
          let v = 0;
          for (let i = 0; i < nPts; i++) {
            const f = flags[i];
            if (f & 2) { const d = view.getUint8(p++); v += (f & 16) ? d : -d; }
            else if (!(f & 16)) { v += view.getInt16(p); p += 2; }
            xs[i] = v;
          }
          const ys = new Array(nPts);
          v = 0;
          for (let i = 0; i < nPts; i++) {
            const f = flags[i];
            if (f & 4) { const d = view.getUint8(p++); v += (f & 32) ? d : -d; }
            else if (!(f & 32)) { v += view.getInt16(p); p += 2; }
            ys[i] = v;
          }
          let s = 0;
          for (let ci = 0; ci < nContours; ci++) {
            const e = ends[ci];
            const pts = [];
            for (; s <= e; s++) pts.push({ x: xs[s], y: ys[s], on: !!(flags[s] & 1) });
            s = e + 1;
            if (pts.length < 2) continue;
            out.push(pts);
          }
        } else {
          // composite: a sequence of {glyph, affine, offset}
          let guard = 0;
          for (;;) {
            if (++guard > 64 || p + 4 > buffer.byteLength) break;
            const flags = view.getUint16(p); p += 2;
            const subGlyph = view.getUint16(p); p += 2;
            let dx, dy;
            if (flags & 1) { dx = view.getInt16(p); dy = view.getInt16(p + 2); p += 4; }
            else { dx = view.getInt8(p); dy = view.getInt8(p + 1); p += 2; }
            let a = 1, b = 0, c = 0, d = 1;
            if (flags & 8) { a = d = view.getInt16(p) / 16384; p += 2; }
            else if (flags & 0x40) { a = view.getInt16(p) / 16384; d = view.getInt16(p + 2) / 16384; p += 4; }
            else if (flags & 0x80) {
              a = view.getInt16(p) / 16384; b = view.getInt16(p + 2) / 16384;
              c = view.getInt16(p + 4) / 16384; d = view.getInt16(p + 6) / 16384;
              p += 8;
            }
            const sub = glyphContours(subGlyph, depth + 1);
            for (const pts of sub) out.push(pts.map(q => ({
              x: a * q.x + c * q.y + dx,
              y: b * q.x + d * q.y + dy,
              on: q.on
            })));
            if (!(flags & 0x20)) break;
          }
        }
        glyphCache.set(gid, out);
        return out;
      };

      // Glyphs are decoded on demand: a font has thousands of them and a text
      // object only ever asks for the handful it contains.
      const glyphs = {};

      // hmtx: advance widths in font units. The canvas advances by
      // round(hmtx * scale), so the pen has to use the same number or a long
      // line drifts sideways glyph by glyph.
      const nH = view.getUint16(tab.hhea.off + 34);
      const advanceOf = (code) => {
        const gid = cmapOf[code];
        if (gid == null || gid >= numGlyphs) return null;
        const idx = Math.min(gid, nH - 1);
        return view.getUint16(tab.hmtx.off + idx * 4);
      };
      const glyphAt = (code) => {
        const key = String(code);
        if (glyphs[key] !== undefined) return glyphs[key];
        const gid = cmapOf[code];
        let built = null;
        if (gid != null) {
          built = [];
          for (const pts of glyphContours(gid, 0)) {
            const seg = contourSegs(pts);
            if (seg) built.push(seg);
          }
        }
        glyphs[key] = built;
        return built;
      };
      return { upem, asc, desc, file, glyph: glyphAt, advance: advanceOf };
    } catch (err) {
      if (typeof console !== 'undefined' && console.warn) console.warn('[fonts] outline parse failed', file, err);
      return null;
    }
  }

  // A TrueType contour is a cyclic list of on/off-curve points; two consecutive
  // off-curve points imply an on-curve midpoint between them. Walk it from an
  // on-curve start (the font's first point may be off-curve) and emit
  // line / quad segments, then turn the segments into nodes + handles.
  function contourSegs(pts) {
    if (!pts || pts.length < 2) return null;
    let start = -1;
    for (let i = 0; i < pts.length; i++) if (pts[i].on) { start = i; break; }
    const segs = [];
    let origin;
    if (start < 0) {
      // all off-curve: every on-curve point is a computed midpoint
      const last = pts[pts.length - 1];
      const first = pts[0];
      origin = { x: (last.x + first.x) / 2, y: (last.y + first.y) / 2 };
      for (let i = 0; i < pts.length; i++) {
        const c = pts[i];
        const nx = pts[(i + 1) % pts.length];
        const mid = { x: (c.x + nx.x) / 2, y: (c.y + nx.y) / 2 };
        segs.push({ kind: 'quad', ctrl: c, b: mid });
      }
      segs.push({ kind: 'line', b: origin });
      return finishContour(segs, origin);
    }
    origin = { x: pts[start].x, y: pts[start].y };
    const n = pts.length;
    let cur = origin;
    let ctrl = null;
    for (let k = 1; k <= n; k++) {
      const q = pts[(start + k) % n];
      if (q.on) {
        if (ctrl) { segs.push({ kind: 'quad', ctrl, b: { x: q.x, y: q.y } }); ctrl = null; }
        else if (k > 0) segs.push({ kind: 'line', b: { x: q.x, y: q.y } });
        cur = { x: q.x, y: q.y };
      } else if (ctrl) {
        const mid = { x: (ctrl.x + q.x) / 2, y: (ctrl.y + q.y) / 2 };
        segs.push({ kind: 'quad', ctrl, b: mid });
        cur = mid;
        ctrl = q;
      } else {
        ctrl = q;
      }
    }
    if (ctrl) segs.push({ kind: 'quad', ctrl, b: origin });
    return finishContour(segs, origin);
  }

  function injectScript(file) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = FONT_BASE + file;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error('could not load ' + file));
      document.head.appendChild(el);
    });
  }

  // Called by every generated fonts/<slug>.js file.
  function define(entry) {
    if (!entry || !entry.family || !entry.b64) return;
    // One family ships several members (regular, bold). A plain family check
    // dropped the second one, so a Bold text silently used the Regular
    // letterforms. Key by member, and let each weight register its own face.
    const key = faceKey(entry.family, entry.weight, entry.style);
    if (registered.has(key)) return;
    const bytes = decodeB64(entry.b64);
    buffers.set(key, bytes);
    loading.set(key, registerFace(entry.family, entry.weight, entry.style, bytes, entry.file || entry.family)
      .then((fam) => { registered.add(key); return fam; })
      .catch(err => {
        loading.delete(key);
        if (typeof console !== 'undefined' && console.warn) console.warn('[fonts]', err);
      }));
  }

  // Load one member of a bundled family: inject its file once, wait for the
  // FontFace. `weight`/`style` pick the member; the default is regular.
  function load(family, weight, style) {
    const w = weight || 400;
    const st = style || 'normal';
    const key = faceKey(family, w, st);
    if (registered.has(key)) return Promise.resolve(true);
    // an installed (system) family is not in the bundled index: its names live
    // in localStorage and its bytes come from the Local Font Access permission
    if (systemStored().some(f => f.family === family)) return loadSystem(family, w, st);
    if (!known(family)) return Promise.resolve(false);
    if (loading.has(key)) return loading.get(key).then(() => registered.has(key));
    // an italic request without an italic member falls back to upright
    const entry = FONT_INDEX.find(f => f.family === family && f.weight === w && (f.style || 'normal') === st)
      || FONT_INDEX.find(f => f.family === family);
    if (!entry) return Promise.resolve(false);
    const wantKey = faceKey(family, entry.weight || 400, entry.style || 'normal');
    if (registered.has(wantKey)) return Promise.resolve(true);
    loading.set(wantKey, injectScript(entry.file)
      .then(() => (loading.get(wantKey) || Promise.resolve()))
      .then(() => registered.has(wantKey))
      .catch(err => {
        loading.delete(wantKey);
        if (typeof console !== 'undefined' && console.warn) console.warn('[fonts]', err);
        return false;
      }));
    return loading.get(wantKey);
  }

  // ---- Imported fonts (IndexedDB) -----------------------------------------
  const DB_NAME = 'minisketch';
  const STORE = 'fonts';
  let dbPromise = null;

  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'family' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('IndexedDB unavailable'));
      });
      dbPromise.catch(() => { dbPromise = null; });
    }
    return dbPromise;
  }

  function storeAll(entries) {
    return db().then(database => new Promise((resolve, reject) => {
      const tx = database.transaction(STORE, 'readwrite');
      const st = tx.objectStore(STORE);
      for (const e of entries) st.put(e);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  function storeRemove(family) {
    return db().then(database => new Promise((resolve, reject) => {
      const tx = database.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(family);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  function storeList() {
    return db().then(database => new Promise((resolve, reject) => {
      const tx = database.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    }));
  }

  // Read the family name out of a TTF/OTF `name` table (nameID 1, the
  // UTF-16BE Windows record preferred). Falls back to the filename.
  function familyFromBytes(buffer, fileName) {
    try {
      const view = new DataView(buffer);
      const numTables = view.getUint16(4);
      let nameOff = 0;
      for (let i = 0; i < numTables; i++) {
        const rec = 12 + i * 16;
        const tag = String.fromCharCode(
          view.getUint8(rec), view.getUint8(rec + 1),
          view.getUint8(rec + 2), view.getUint8(rec + 3));
        if (tag === 'name') { nameOff = view.getUint32(rec + 8); break; }
      }
      if (nameOff) {
        const count = view.getUint16(nameOff + 2);
        const strOff = nameOff + view.getUint16(nameOff + 4);
        let latin = null;
        for (let i = 0; i < count; i++) {
          const rec = nameOff + 6 + i * 12;
          const platform = view.getUint16(rec);
          const nameId = view.getUint16(rec + 6);
          const len = view.getUint16(rec + 8);
          const off = view.getUint16(rec + 10);
          if (nameId !== 1 || !len) continue;
          if (platform === 3 || platform === 0) {
            let s = '';
            for (let k = 0; k < len; k += 2) s += String.fromCharCode(view.getUint16(strOff + off + k));
            const t = s.trim();
            if (t) return t.slice(0, 64);
          } else if (platform === 1 && latin == null) {
            let s = '';
            for (let k = 0; k < len; k++) s += String.fromCharCode(view.getUint8(strOff + off + k));
            latin = s;
          }
        }
        if (latin && latin.trim()) return latin.trim().slice(0, 64);
      }
    } catch (err) { /* fall through */ }
    return String(fileName || 'Imported font').replace(/\.[^.]+$/, '').slice(0, 64);
  }

  // Import a font file: register now, persist for every future session.
  // `registered` MUST be marked: app.js gates all text measurement and the
  // preview on `registered(family)`, and an imported face that only lands in
  // document.fonts renders nothing in the app (the classic "import worked but
  // the text is invisible" — no error, just a frame-only glyph box).
  function importFile(file) {
    return Promise.resolve(file.arrayBuffer()).then(buffer => {
      const family = familyFromBytes(buffer, file.name);
      const key = faceKey(family, 400, 'normal');
      buffers.set(key, buffer);
      return registerFace(family, 400, 'normal', buffer.slice(0), file.name).then(() => {
        registered.add(key);
        imported.push({ family, category: 'Imported', weight: 400, style: 'normal' });
        return storeAll([{ family, category: 'Imported', weight: 400, style: 'normal', bytes: buffer, name: file.name }]);
      }).then(() => family);
    });
  }

  function removeImported(family) {
    imported = imported.filter(f => f.family !== family);
    return storeRemove(family);
  }

  let imported = [];

  // Register every stored font (once, at startup). Resolves when done.
  // Marks `registered` per member like importFile does — textMetricsOf skips
  // unregistered fonts, so without this a reloaded document kept every
  // imported-family text as frame-only (and keepRatio in app.js froze it).
  function loadImported() {
    if (typeof indexedDB === 'undefined') return Promise.resolve();
    return storeList().then(rows => {
      const jobs = [];
      for (const row of rows) {
        if (!row || !row.family || !row.bytes) continue;
        imported.push({ family: row.family, category: 'Imported', weight: row.weight || 400, style: row.style || 'normal' });
        const key = faceKey(row.family, row.weight || 400, row.style || 'normal');
        if (!registered.has(key)) {
          buffers.set(key, row.bytes);
          jobs.push(registerFace(row.family, row.weight || 400, row.style || 'normal', row.bytes, row.name || row.family)
            .then(() => { registered.add(key); })
            .catch(err => {
              if (typeof console !== 'undefined' && console.warn) console.warn('[fonts]', row.family, err);
            }));
        }
      }
      return Promise.all(jobs);
    }).catch(() => { /* no IndexedDB (private mode): imports just do not persist */ });
  }

  // ---- System fonts (Local Font Access API — Chrome / Edge) ---------------
  // Windows ships hundreds of installed families. Chromium hands them to the
  // page through window.queryLocalFonts(): one permission dialog per origin,
  // then every FontData names its family and offers blob() — the REAL font
  // bytes. A system family can therefore register exactly like an imported
  // one, exact glyf outlines included, with no file to pick by hand.
  //
  // Names and bytes are kept apart on purpose: a granted permission lists
  // 1000+ fonts, and reading + parsing all of them up front would take
  // minutes. The button only remembers FAMILY NAMES (localStorage); the
  // dropdown lists them, and a family's bytes are read the moment it is
  // chosen — silently while the permission is still granted, never from a
  // background load (the picker needs a user gesture).
  const SYSTEM_KEY = 'minisketch.systemFonts.v1';
  let system = [];   // faces actually registered this session

  function systemStored() {
    try { return JSON.parse(localStorage.getItem(SYSTEM_KEY) || '[]'); }
    catch (err) { return []; }
  }

  function rememberSystemFamily(family, weight, style) {
    const list = systemStored();
    const cur = list.find(f => f.family === family);
    if (cur) {
      // keep the richest style hint seen (a Bold-only family lists weight 700)
      if ((cur.weight || 400) === 400 && (weight || 400) !== 400) cur.weight = weight;
      if ((cur.style || 'normal') === 'normal' && (style || 'normal') !== 'normal') cur.style = style;
    } else {
      list.push({ family, weight: weight || 400, style: style || 'normal' });
    }
    try { localStorage.setItem(SYSTEM_KEY, JSON.stringify(list)); } catch (err) { /* private mode */ }
  }

  function styleFromFontData(st) {
    const s = String(st || '').toLowerCase();
    const italic = s.indexOf('italic') >= 0 || s.indexOf('oblique') >= 0;
    const bold = s.indexOf('bold') >= 0 || s.indexOf('black') >= 0 || s.indexOf('heavy') >= 0;
    return { weight: bold ? 700 : 400, style: italic ? 'italic' : 'normal' };
  }

  // One permission dialog per origin: the first call shows Chromium's font
  // picker; once granted, calls return the whole installed set.
  function querySystemFonts() {
    if (typeof window.queryLocalFonts !== 'function') {
      return Promise.reject(new Error('this browser has no Local Font Access — use Chrome or Edge'));
    }
    return window.queryLocalFonts();
  }

  async function registerSystemFace(fd) {
    const { weight, style } = styleFromFontData(fd.style);
    const key = faceKey(fd.family, weight, style);
    if (registered.has(key)) return true;
    if (!fd.blob) return false;
    // FontData.blob() resolves to a Blob; FontFace needs raw bytes, and so
    // does the glyf parser that keeps the exact outline source.
    const buffer = await (await fd.blob()).arrayBuffer();
    buffers.set(key, buffer);
    await registerFace(fd.family, weight, style, buffer.slice(0), fd.fullName || fd.family);
    registered.add(key);
    if (!system.some(f => f.family === fd.family)) {
      system.push({ family: fd.family, category: 'System', weight, style });
    }
    rememberSystemFamily(fd.family, weight, style);
    bumpEpoch();
    return true;
  }

  // Button entry: list every installed family in the dropdown. Names only —
  // a family's bytes are read when it is chosen.
  async function importSystemFonts() {
    const fonts = await querySystemFonts();
    const seen = new Set();
    for (const fd of fonts) {
      if (!fd || !fd.family || seen.has(fd.family)) continue;
      seen.add(fd.family);
      rememberSystemFamily(fd.family, 400, 'normal');
    }
    if (seen.size) bumpEpoch();
    return seen.size;
  }

  const systemLoading = new Map();
  function loadSystem(family, weight, style) {
    const w = weight || 400;
    const st = style || 'normal';
    const key = faceKey(family, w, st);
    if (registered.has(key)) return Promise.resolve(true);
    if (systemLoading.has(key)) return systemLoading.get(key);
    const task = (async () => {
      // A picker cannot be shown from a background load: register silently
      // only when the permission is already granted, else report unavailable.
      if (!navigator.permissions || typeof navigator.permissions.query !== 'function') return false;
      const status = await navigator.permissions.query({ name: 'local-fonts' }).catch(() => null);
      if (!status || status.state !== 'granted') return false;
      const fonts = await querySystemFonts();
      const members = fonts.filter(fd => fd && fd.family === family);
      if (!members.length) return false;
      // the requested member first, then the closest weight/style
      const scored = members
        .map(fd => Object.assign(styleFromFontData(fd.style), { fd }))
        .sort((a, b) => (Math.abs(a.weight - w) + (a.style !== st ? 2 : 0))
                      - (Math.abs(b.weight - w) + (b.style !== st ? 2 : 0)));
      const ok = await registerSystemFace(scored[0].fd);
      return !!ok && (registered.has(key) || registered.has(faceKey(family, scored[0].weight, scored[0].style)));
    })();
    const tracked = task
      .then(v => { systemLoading.delete(key); return v; })
      .catch(err => {
        systemLoading.delete(key);
        if (typeof console !== 'undefined' && console.warn) console.warn('[fonts]', err);
        return false;
      });
    systemLoading.set(key, tracked);
    return tracked;
  }

  window.MiniSketchFonts = {
    define,
    load,
    loadImported,
    importFile,
    removeImported,
    familyFromBytes,
    known,
    querySystemFonts,
    importSystemFonts,
    systemList: () => systemStored(),
    // Exact `glyf` outline data for one member of a family (see parseFont), or
    // null when that member has no TrueType outlines. Font units, y up.
    outlines: (family, weight, style) => {
      const want = faceKey(family, weight, style);
      if (faces.has(want)) return faces.get(want);
      // fall back to any member of the family so a width/weight mismatch still
      // converts from real outlines instead of dropping to the raster trace
      for (const [k, v] of faces) if (k.startsWith(family + '|')) return v;
      return null;
    },
    index: () => FONT_INDEX.slice(),
    imported: () => imported.slice(),
    categories,
    registered: (family, weight, style) => registered.has(faceKey(family, weight, style)),
    get epoch() { return epoch; },
    onEpoch: (fn) => { if (typeof fn === 'function') listeners.push(fn); }
  };
})();
