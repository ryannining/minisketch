"""Normalize one font file for bundling into fonts/src/*.ttf.

Why this exists: the app registers a bundled font with `new FontFace(family,
bytes, { weight, style })`. That descriptor only picks the right member when
BOTH sides agree — the descriptor here AND the face's own `OS/2.usWeightClass`,
`head.macStyle` italic bit / `OS/2.fsSelection` italic bit. A face that claims
`Regular` in its name table while carrying weight 500 (the ' Mono files) or an
italic-only member whose style is only spelled out in the file name (Dealerplate
California) would otherwise render under a descriptor the browser rejects or
matches to the wrong member.

So this rewrites only those few tables, in place, keeping every glyph byte
untouched. It is NOT a subsetter: no glyph, cmap entry or hint is removed, so
the result is the same typeface, same character set, same outlines.

Tables rewritten:
  OS/2   usWeightClass, fsSelection (ITALIC / BOLD / REGULAR bits)
  head   macStyle (bold bit 0, italic bit 1)
  name   nameID 1 (family), 2 (subfamily), 4 (full), 6 (PostScript), 16/17 (typographic)

Usage: python3 fonts/normalize_font.py <in.ttf|otf> <out.ttf> \
           --family "Name" [--weight 400] [--style italic] [--full "..."] [--ps "..."]

The output is always TrueType-flavoured: a glyf input keeps its glyph bytes,
a CFF/OTF input is converted to glyf (cubic -> quadratic) so the app can read
exact contours instead of tracing the raster.
"""
import argparse
import os
import struct
import sys

from fontTools.ttLib import TTFont

MAC_ROMAN_IS_LATIN1 = True


def set_name(name_table, name_id, value, platform=(3, 1, 0x409)):
    """Set one name record (Windows Unicode BMP, en-US) and drop duplicates."""
    pid, eid, lid = platform
    name_table.setName(value, name_id, pid, eid, lid)
    # setName only updates/creates that one record; remove any other record
    # carrying the same nameID so a stale Mac or second Windows entry cannot
    # win the lookup in the browser.
    keep = []
    for rec in name_table.names:
        if rec.nameID == name_id and (rec.platformID, rec.platEncID, rec.langID) != (pid, eid, lid):
            continue
        keep.append(rec)
    name_table.names = keep


def cff_to_glyf(font):
    """Convert CFF charstrings (cubic) to TrueType glyf (quadratic).

    The app reads exact contours only from `glyf`; a CFF face would fall back
    to the raster tracer, which merges overlapping glyphs into one silhouette
    before contours exist. Cu2QuPen approximates each cubic with quadratics at
    1/1000 em — far below a pixel at any text size the sketcher uses.
    """
    from fontTools.pens.ttGlyphPen import TTGlyphPen
    from fontTools.pens.cu2quPen import Cu2QuPen
    from fontTools.ttLib import newTable

    order = font.getGlyphOrder()
    glyph_set = font.getGlyphSet()
    glyf = newTable('glyf')
    glyf.glyphOrder = order
    glyf.glyphs = {}
    err = font['head'].unitsPerEm / 1000.0
    for gname in order:
        pen = TTGlyphPen(glyph_set)
        glyph_set[gname].draw(Cu2QuPen(pen, err))
        glyf[gname] = pen.glyph()
    font['glyf'] = glyf
    font['loca'] = newTable('loca')

    def depth(gname, seen=()):
        g = glyf[gname]
        if not g.isComposite():
            return 0
        return 1 + max((depth(c.glyphName, seen + (gname,)) for c in g.components
                        if c.glyphName not in seen), default=0)

    maxp = font['maxp']
    maxp.tableVersion = 0x00010000
    maxp.maxZones = 2
    maxp.maxTwilightPoints = 0
    maxp.maxStorage = 0
    maxp.maxFunctionDefs = 0
    maxp.maxInstructionDefs = 0
    maxp.maxStackElements = 0
    maxp.maxSizeOfInstructions = 0
    simples = [g for g in glyf.glyphs.values() if not g.isComposite()]
    maxp.maxPoints = max((len(g.coordinates) for g in simples), default=0)
    maxp.maxContours = max((g.numberOfContours for g in simples), default=0)
    maxp.maxComponentElements = max((g.numberOfComponents for g in glyf.glyphs.values()
                                     if g.isComposite()), default=0)
    maxp.maxComponentDepth = max((depth(n) for n in order), default=0)
    font['head'].glyphDataFormat = 0
    font.sfntVersion = '\x00\x01\x00\x00'
    for tag in ('CFF ', 'CFF2', 'VORG', 'DSIG'):
        if tag in font:
            del font[tag]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('dst')
    ap.add_argument('--family', required=True)
    ap.add_argument('--subfamily', default='Regular')
    ap.add_argument('--full', default=None)
    ap.add_argument('--ps', default=None)
    ap.add_argument('--weight', type=int, default=400)
    ap.add_argument('--style', choices=['normal', 'italic'], default='normal')
    ap.add_argument('--bold', action='store_true')
    ap.add_argument('--allow-cff', action='store_true',
                    help='accept CFF/OTF input and convert its outlines to TrueType glyf')
    args = ap.parse_args()

    ft = TTFont(args.src)

    if 'glyf' not in ft:
        if not args.allow_cff:
            print('refusing CFF input without --allow-cff (bundled faces need glyf)', file=sys.stderr)
            return 2
        cff_to_glyf(ft)

    full = args.full or f'{args.family} {args.subfamily}'.strip()
    ps = args.ps or (args.family + '-' + args.subfamily).replace(' ', '')

    # ---- OS/2 -------------------------------------------------------------
    os2 = ft['OS/2']
    os2.usWeightClass = max(1, min(1000, args.weight))
    fs = os2.fsSelection & ~0b1100001      # clear ITALIC(0), BOLD(0x20), REGULAR(0x40)
    if args.bold:
        fs |= 0x20
    else:
        fs |= 0x40
    if args.style == 'italic':
        fs |= 0x01
    os2.fsSelection = fs

    # ---- head -------------------------------------------------------------
    head = ft['head']
    mac = head.macStyle & ~0b11
    if args.bold:
        mac |= 0x01
    if args.style == 'italic':
        mac |= 0x02
    head.macStyle = mac

    # ---- name -------------------------------------------------------------
    name = ft['name']
    set_name(name, 1, args.family)
    set_name(name, 2, args.subfamily)
    set_name(name, 4, full)
    set_name(name, 6, ps)
    # typographic family/subfamily: when they exist they win over name 1/2 in
    # modern shapers, so they have to agree
    set_name(name, 16, args.family)
    set_name(name, 17, args.subfamily)

    os.makedirs(os.path.dirname(os.path.abspath(args.dst)), exist_ok=True)
    ft.save(args.dst)

    n = TTFont(args.dst)
    cmap = n.getBestCmap() or {}
    print(f'{os.path.basename(args.dst):34} {os.path.getsize(args.dst) // 1024:5}K '
          f'glyf={"glyf" in n} glyphs={len(cmap):5} '
          f'w={n["OS/2"].usWeightClass} fs={n["OS/2"].fsSelection:#011b} mac={n["head"].macStyle} '
          f'fam={n["name"].getDebugName(1)!r} sub={n["name"].getDebugName(2)!r}')
    return 0


if __name__ == '__main__':
    sys.exit(main())