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

The output is always TrueType-flavoured when the input is (glyf kept as is);
a CFF input stays CFF and is refused only when the caller asks forglyf output.
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
                    help='keep CFF outlines (the app then traces them instead of reading glyf)')
    args = ap.parse_args()

    ft = TTFont(args.src)

    if 'glyf' not in ft and not args.allow_cff:
        print('refusing CFF input without --allow-cff (bundled faces need glyf)', file=sys.stderr)
        return 2

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