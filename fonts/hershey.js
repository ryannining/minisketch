// MiniSketchHershey — decoder + layout for the single-line (stroke) fonts.
// A stroke font has no filled outline: every glyph is a set of open polylines,
// which is what engrave / V-carve want (one pass per stem, no loops to clear).
//
// Layout uses the glyph table's advance widths only — no canvas measuring, so
// it is also faster than the outline path. Units: reference pixels, the same
// TEXT_REF space the outline fonts use (glyphs are scaled to match: the raw
// cap height of 21 units maps to about 0.7 of the font size, like a TTF).
//
// Fonts come from fonts/hershey-data.js (plain script, public domain data).
(() => {
  'use strict';

  // raw glyph units -> reference px. Raw: baseline y=22, cap top y=1, so the
  // cap height is 21 raw units; a TTF at size S has caps of roughly 0.72*S.
  const GLYPH_SCALE = 0.72 / 21;
  const ADVANCE_SCALE = 1.68 * GLYPH_SCALE;   // pen step per advance unit
  const SPACE_ADVANCE = 10 * ADVANCE_SCALE;   // raw space = 10 units
  const BASELINE = 22;                        // raw baseline row

  const fonts = {
    simplex: { name: 'Hershey Simplex' },
    script: { name: 'Hershey Script' }
  };
  const byName = {};
  for (const key in fonts) byName[fonts[key].name] = fonts[key];

  function decodePath(d) {
    // SVG-style "M4,1 L13,1 16,2 ..." -> strokes: [[{x,y},...], ...]
    const strokes = [];
    let cur = null;
    let x = 0, y = 0;
    const tokens = d.match(/[ML]|-?\d+(?:\.\d+)?/g) || [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t === 'M') {
        x = +tokens[++i];
        y = +tokens[++i];
        cur = [{ x, y }];
        strokes.push(cur);
      } else if (t === 'L') {
        // one command, any number of coordinate pairs
        while (i + 2 < tokens.length && tokens[i + 1] !== 'M' && tokens[i + 1] !== 'L') {
          x = +tokens[++i];
          y = +tokens[++i];
          cur.push({ x, y });
        }
      }
    }
    return strokes;
  }

  const decoded = new Map();    // cache key -> decoded glyph
  function glyphOf(fontKey, code) {
    const table = MiniSketchHershey.data[fontKey];
    if (!table) return null;
    const key = fontKey + ':' + code;
    let g = decoded.get(key);
    if (g !== undefined) return g;
    const raw = table[code - 33];
    if (!raw) {
      decoded.set(key, null);
      return null;
    }
    const strokes = decodePath(raw[1]).map(stroke => stroke.map(p => ({
      x: p.x * GLYPH_SCALE,
      y: (BASELINE - p.y) * GLYPH_SCALE        // y-up, baseline at 0
    })));
    g = { strokes, advance: raw[0] * ADVANCE_SCALE };
    decoded.set(key, g);
    return g;
  }

  function isSingleLine(family) {
    return !!byName[family];
  }
  // Lay text out in reference pixels: origin is the baseline of the FIRST
  // line's start, x to the right, y up. Returns { strokes, width, height,
  // ascent, lineHeight } — strokes carry only geometry, no frame mapping.
  // multi-line uses the same leading rule as the outline path.
  function layout(text, sizePx, lineHeightPx, align) {
    const strokes = [];
    let widest = 0;
    const lines = String(text == null ? '' : text).split('\n');
    const alignMode = align || 'left';
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      const pen = { v: 0 };
      const lineStrokes = [];
      for (const ch of line) {
        if (ch === ' ') { pen.v += SPACE_ADVANCE; continue; }
        const code = ch.charCodeAt(0);
        const g = glyphOf('simplex', code) || glyphOf('script', code) || null;
        if (!g) { pen.v += SPACE_ADVANCE * 0.6; continue; }
        for (const stroke of g.strokes) {
          lineStrokes.push(stroke.map(p => ({ x: p.x + pen.v, y: p.y })));
        }
        pen.v += g.advance;
      }
      const lineW = Math.max(1e-6, pen.v);
      if (lineW > widest) widest = lineW;
      // align shifts the whole line inside the measured width
      const dx = alignMode === 'center' ? (0 - lineW) / 2 : (alignMode === 'right' ? -lineW : 0);
      for (const st of lineStrokes) {
        // y is ALREADY canvas-style (down-positive): the baseline sits at 0 and
        // a cap rises to -0.72 * size. Later lines step DOWN by the leading.
        strokes.push(st.map(p => ({ x: (p.x + dx) * sizePx, y: li * lineHeightPx - p.y * sizePx })));
      }
    }
    const height = sizePx + lineHeightPx * (lines.length - 1);
    return { strokes, width: widest * sizePx, height, lineHeight: lineHeightPx, lines: lines.length };
  }

  // Family -> strokes laid out for ONE line at reference size (TEXT_REF), used
  // by the app's measuring path. Returns [{pts:[{x,y}]}] and the advance width.
  function measureLine(text) {
    const out = layout(text, 1, 1.25, 'left');
    return { strokes: out.strokes, width: out.width, height: out.height };
  }

  window.MiniSketchHershey = Object.assign(window.MiniSketchHershey, {
    fonts: () => Object.keys(fonts).map(k => fonts[k].name),
    isSingleLine,
    layout,
    measureLine
  });
})();
