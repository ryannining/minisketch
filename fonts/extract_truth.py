"""Dump the EXACT outline of a few glyphs with fontTools, as segment lists, so
the JS side can be checked against the font's own curves instead of against a
flattened copy of them (a flattened reference carries its own chord error).

Segments per contour, in font units, y up:
  ['L', x1, y1]                 line to
  ['Q', cx, cy, x1, y1]         quadratic to (exact, no midpoint guessing)
  ['C', x1, y1, x2, y2, x3, y3]  cubic to (CFF fonts only)

Run: uv run --with fonttools python3 fonts/extract_truth.py > testing/font_truth.json
"""
import glob
import json
import os
import sys

from fontTools.pens.recordingPen import RecordingPen
from fontTools.ttLib import TTFont

CHARS = 'Testg'
TARGETS = sorted(glob.glob(os.path.join(os.path.dirname(__file__), 'src', '*.ttf')))


def segments(ops):
    """RecordingPen ops -> list of contours, each a list of segment tuples."""
    contours = []
    cur = []
    start = None
    pos = None
    for op, args in ops:
        if op == 'moveTo':
            if cur:
                contours.append({'start': start, 'segs': cur})
            cur = []
            start = args[0]
            pos = start
        elif op == 'lineTo':
            cur.append(['L', args[0][0], args[0][1]])
            pos = args[0]
        elif op == 'qCurveTo':
            pts = list(args)
            offs, end = pts[:-1], pts[-1]
            if end is None:
                end = start
            for i, c in enumerate(offs):
                nxt = offs[i + 1] if i + 1 < len(offs) else end
                on = ((c[0] + nxt[0]) / 2, (c[1] + nxt[1]) / 2) if i + 1 < len(offs) else nxt
                cur.append(['Q', c[0], c[1], on[0], on[1]])
            pos = end
        elif op == 'curveTo':
            p1, p2, p3 = args
            cur.append(['C', p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]])
            pos = p3
        elif op == 'closePath':
            if cur:
                contours.append({'start': start, 'segs': cur})
            cur = []
    if cur:
        contours.append({'start': start, 'segs': cur})
    return contours


out = {'fonts': []}
for f in TARGETS:
    font = TTFont(f)
    if 'glyf' not in font:
        continue
    cmap = font.getBestCmap()
    gs = font.getGlyphSet()
    head = font['head']
    hhea = font['hhea']
    hmtx = font['hmtx']
    entry = {
        'file': os.path.basename(f),
        'upem': head.unitsPerEm,
        'asc': hhea.ascent,
        'desc': hhea.descent,
        'chars': [],
    }
    for ch in sorted(set(CHARS)):
        if ord(ch) not in cmap:
            continue
        rp = RecordingPen()
        gs[cmap[ord(ch)]].draw(rp)
        entry['chars'].append({
            'char': ch,
            'code': ord(ch),
            'adv': hmtx[cmap[ord(ch)]][0],
            'contours': [{'start': list(c['start']), 'segs': c['segs']} for c in segments(rp.value)],
        })
    out['fonts'].append(entry)

json.dump(out, sys.stdout)
