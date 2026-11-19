#!/usr/bin/env python3
"""Rebuild fonts/src/*.ttf from the zips listed in fonts/catalog.json.

Every face in the catalogue names the zip and the member inside it that it came
from, so the whole bundled set is reproducible from the downloads alone:

    python3 fonts/prepare_fonts.py

A face with `"source": null` was already a clean .ttf in fonts/src (Liberation,
Noto, Carlito) and is left alone.

The point of the rewrite is the FONT MATCHING, not compression. The app
registers a face with

    new FontFace(family, bytes, { weight: '400', style: 'italic' })

and the browser decides whether that descriptor matches by reading the file's
own `OS/2.usWeightClass` and the italic bit in `head.macStyle` /
`OS/2.fsSelection`. Downloaded fonts routinely disagree with their filename:

  * `' Mono Regular.ttf` says usWeightClass 500 and subfamily ".", so a request
    for weight 400 would not match it;
  * `Cocogoose-Pro-Bold-trial.ttf` carries family "CocogooseProTrial Bold" with
    the typographic family "CocogooseProTrial", so the family the registry asks
    for is not the family the file reports;
  * `RasleyHeights_PERSONAL_USE_ONLY.otf` reports the family "Rasley Heights
    PERSONAL USE", spaces and all.

So this rewrites only those tables — `OS/2`, `head.macStyle`, and `name` ids
1/2/4/6/16/17 — and leaves every glyph byte, cmap entry and hint untouched. It
is NOT a subsetter and NOT a converter: the typeface is the same one, with the
same character set and the same outlines.

A CFF/OTF input is converted to TrueType glyf (cubic -> quadratic) by
normalize_font.py: `fonts.js` reads exact contours only from a `glyf` table,
and a CFF face would otherwise fall back to the raster tracer when text is
converted to curves — a trace merges overlapping glyphs before contours
exist, so boolean union would see one pre-merged silhouette.

Usage:
    python3 fonts/prepare_fonts.py            # rebuild every sourced face
    python3 fonts/prepare_fonts.py --check    # report only, write nothing
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'src')
CATALOG = os.path.join(HERE, 'catalog.json')
NORMALIZE = os.path.join(HERE, 'normalize_font.py')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true', help='report what would change, write nothing')
    args = ap.parse_args()

    with open(CATALOG, encoding='utf-8') as fh:
        catalog = json.load(fh)

    entries = catalog['fonts']
    todo = [f for f in entries if f.get('source')]
    fresh = [f for f in entries if not f.get('source')]

    print(f'{len(entries)} faces in the catalogue: {len(todo)} built from a zip, '
          f'{len(fresh)} already plain .ttf\n')

    failures = []
    for face in todo:
        src = face['source']
        zip_path = os.path.join(SRC, src['zip'])
        member = src['member']
        out_path = os.path.join(SRC, face['file'])

        if not os.path.exists(zip_path):
            failures.append(f"{face['file']}: missing {src['zip']}")
            continue

        try:
            with zipfile.ZipFile(zip_path) as zf:
                raw = zf.read(member)
        except KeyError:
            failures.append(f"{face['file']}: {src['zip']} has no {member!r}")
            continue

        # normalize_font.py takes a path, so stage the member in a temp file
        with tempfile.NamedTemporaryFile(suffix='.bin', delete=False) as tmp:
            tmp.write(raw)
            staged = tmp.name
        try:
            cmd = [sys.executable, NORMALIZE, staged, out_path,
                   '--family', face['family'],
                   '--subfamily', subfamily_of(face),
                   '--weight', str(face['weight']),
                   '--style', face['style'],
                   '--allow-cff']
            if face['weight'] >= 700:
                cmd.append('--bold')
            proc = subprocess.run(cmd, capture_output=True, text=True)
        finally:
            os.unlink(staged)

        if proc.returncode != 0:
            failures.append(f"{face['file']}: {(proc.stderr or proc.stdout).strip()}")
        else:
            print('  ' + proc.stdout.strip())

    for face in fresh:
        path = os.path.join(SRC, face['file'])
        if not os.path.exists(path):
            failures.append(f"{face['file']}: expected a plain .ttf in fonts/src")

    if failures:
        print('\nFAILED:')
        for f in failures:
            print('  ' + f)
        return 1

    # Cross-check: the catalogue's family/weight/style has to agree with what
    # normalize_font.py actually wrote, or the registry would ask for a member
    # the file does not offer.
    from fontTools.ttLib import TTFont

    problems = []
    for face in entries:
        path = os.path.join(SRC, face['file'])
        ft = TTFont(path, lazy=True)
        name = ft['name']
        got_family = (name.getDebugName(16) or name.getDebugName(1) or '').strip()
        os2 = ft['OS/2']
        got_italic = bool(os2.fsSelection & 0x01) or bool(ft['head'].macStyle & 0x02)
        want_italic = face['style'] == 'italic'
        if got_family != face['family']:
            problems.append(f"{face['file']}: family {got_family!r} != {face['family']!r}")
        if got_italic != want_italic:
            problems.append(f"{face['file']}: italic={got_italic} != {want_italic}")
        if face['weight'] >= 700 and not (os2.fsSelection & 0x20):
            problems.append(f"{face['file']}: weight {face['weight']} without the BOLD bit")

    if problems:
        print('\nMISMATCH:')
        for p in problems:
            print('  ' + p)
        return 1

    print(f'\nall {len(entries)} faces agree with the catalogue')
    return 0


def subfamily_of(face):
    """The name-id-2 string for a face: 'Regular', 'Bold', 'Italic', 'Bold Italic'."""
    parts = []
    if face['weight'] >= 700:
        parts.append('Bold')
    if face['style'] == 'italic':
        parts.append('Italic')
    return ' '.join(parts) if parts else 'Regular'


if __name__ == '__main__':
    sys.exit(main())