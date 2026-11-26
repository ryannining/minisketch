# Bundled fonts

Every family in the Text dialog ships **inside this repo**: one generated
`fonts/<slug>.js` per face, holding the font's bytes as base64 and registered
through the `FontFace` API at runtime.

That indirection exists because the app runs straight off disk (`file://`):

- a CSS `@font-face` with a `url()` is CORS-checked and blocked;
- `fetch()` on a local file is blocked outright;
- `new FontFace(family, arrayBuffer, descriptors)` works everywhere.

So the bytes travel as a classic `<script>` — the one format `file://` always
allows — and `fonts.js` decodes them into an `ArrayBuffer`.

## The catalogue

`catalog.json` is the single manifest: **one entry per face** (family + weight +
style), each naming the zip and the member inside it that it came from. Both
scripts read it, so they cannot drift apart.

31 families, 43 faces:

| Category | Families |
| --- | --- |
| Sans | Liberation Sans, Noto Sans, Carlito |
| Serif | Liberation Serif, Noto Serif, Avigea, Bright Sunlist, Mercy Christole |
| Monospace | Liberation Mono, Rony Mono |
| Script | Anak Manja, Matcha Style, Billion Dreams, Birds of Paradise, Chocolate Crispy, Darling, Milesdane Trial, Rasley Heights, Simply Olive, Sweety Rasty |
| Display | GROBOLD, Super Mario 256, Janda Manatee Bubble, Janda Manatee Solid, Saltblack Combat, Supersonic Rocketship, Super Waffles, Cocogoose Pro, Nasalization, Dealerplate California, PLATMOTOR |

`license` in the catalogue is provenance — it records where a face came from.
Nothing in the UI reads it and no face is flagged or filtered on it.

## Rebuilding

```
python3 fonts/prepare_fonts.py     # fonts/src/*.ttf from the zips in fonts/src/
node fonts/build.js                # fonts/<slug>.js + FONT_INDEX in fonts.js
```

`prepare_fonts.py --check` reports without writing. It also cross-checks that
each built file's family and italic bit agree with the catalogue, because a
mismatch there is invisible until the browser refuses to match a descriptor.

`uv run --with fonttools python3 fonts/extract_truth.py > testing/font_truth.json`
then `node testing/font_outline_probe.js` — the probe compares the JS outline
parser against the font's own `glyf` data, for every TrueType face in `src/`.

## Faces are files, not one file per family

A family is several faces, and each is its own generated file:

```
liberation-serif.js                 Regular
liberation-serif-bold.js            Bold
liberation-serif-italic.js          Italic
liberation-serif-bold-italic.js     Bold Italic
```

`build.js` derives the name from the family plus a suffix for anything that is
not plain Regular upright. Two collisions this prevents:

- with only a `-bold` suffix, Italic and Bold Italic both wanted
  `liberation-serif-italic.js`, and one face silently overwrote the other;
- without a `-light` suffix, Cocogoose's Light (300) and Regular (400) both
  wanted `cocogoose-pro.js`.

`outlines()` never falls back across weights or styles. A CFF Regular beside a
TrueType Bold would otherwise answer a Regular request with the Bold's design,
and the pen would drift off the glyphs because the advances differ. No outline
means the raster tracer, which always fits the face the canvas drew.

## TrueType outlines only

`fonts.js` reads exact contours from a `glyf` table. A CFF/OTF face has cubic
charstrings instead, so `outlines()` returns `null` and that text drops to the
raster tracer when converted to curves. Eight faces are in that position
(Avigea, Bright Sunlist, Milesdane, Rasley Heights, Nasalization, Dealerplate
California) because no TrueType build of them exists in the downloads — they
render and measure correctly, they just trace approximately. Prefer the `.ttf`
of a family whenever it ships one.

## A face whose style lives only in its filename

The `FontFace` constructor takes the weight and style as *descriptors*, and the
browser matches them against the file's own `OS/2.usWeightClass` and
`head.macStyle`. Downloaded fonts routinely disagree with their filename:

- `' Mono Regular.ttf` says `usWeightClass` 500 and subfamily `'.'`;
- `Cocogoose-Pro-Bold-trial.ttf` reports family `CocogooseProTrial Bold`;
- `RasleyHeights_PERSONAL_USE_ONLY.otf` reports `Rasley Heights PERSONAL USE`;
- `' Mono Bold.ttf` and `' Mono Regular.ttf` both call themselves subfamily `'.'`.

`normalize_font.py` rewrites exactly those tables in place — `OS/2`,
`head.macStyle`, and `name` ids 1/2/4/6/16/17 — leaving every glyph byte,
cmap entry and hint untouched. It is not a subsetter and not a converter.

```
python3 fonts/normalize_font.py in.ttf out.ttf \
  --family "Real Name" --subfamily Italic --weight 400 --style italic
```

## Loading

`init()` preloads only the faces the open document actually needs: the default
family plus every member the restored text entities reference. Not the whole
catalogue — at 41 faces that is ~11 MB of base64 parsed on every cold start to
serve fonts the document never mentions.

Everything else loads itself the first time it is picked. That is the whole
point of bundling: no import step, no IndexedDB entry, no missing file.

## A note on the probe's reference

`extract_truth.py` draws with fontTools at offset 0. The library's glyph set
otherwise shifts a glyph by `lsb - xMin` to normalise fonts whose stored
bounding box disagrees with its own coordinates — Mercy Christole stores
`xMin -15` while its real minimum is `-14` — and that shift showed up as a
phantom 1-unit error on the two glyphs where it applies. `fonts.js` reads the
coordinates as stored, so the probe has to as well.

## Building a bundled font from a specimen image

When a typeface only exists as a clean black-on-white specimen PNG/JPG (like
`PLATMOTOR`), turn it into a native TrueType bundled font without keeping
per-glyph SVGs in the repo:

1. **Segment glyphs**: group dark connected components per row, merge split
   parts that belong to one character (e.g. a sliced `0`, dotted `i`/`j`, or
   accented glyphs) by horizontal overlap, and map each glyph to its Unicode
   codepoint (`A`–`Z`, `0`–`9`, etc.). Map lowercase `a`–`z` to the uppercase
   glyphs in `cmap` if the specimen is all-caps.
2. **Sub-pixel trace**: trace each glyph's **original anti-aliased grayscale**
   pixels (do not binarise first) with `tools/subpixel_trace.js`
   (`SubPixelTracer.traceImageData`). It uses sub-pixel Marching Squares on the
   50% gray isocontour, preserves sharp corners by intersecting flanking OLS
   lines, adds cardinal extrema anchors on loops, and outputs clean `M`/`L`/`Q`
   quadratic contours directly compatible with TrueType `glyf`.
3. **Compile to TrueType (`.ttf`)**: using `fontTools.fontBuilder.FontBuilder`
   (e.g. via `uv run --with fonttools python3 ...`):
   - Set `unitsPerEm = 1000`, `ascender = 800`, `descender = -200` (scale cap
     height to ~700–760 units, flip Y from image coords to font coords).
   - Enforce TrueType winding: outer contours **clockwise**, interior holes
     **counter-clockwise** (`signedArea < 0` for outer in Y-up space).
   - Emit quadratic splines via `TTGlyphPen` (`moveTo`, `lineTo`, `qCurveTo`,
     `closePath`), set sidebearings / `hmtx`, `cmap`, `OS/2.usWeightClass`
     (`400` Regular, `300` Light, `700` Bold), `head.macStyle`, and `name`
     tables.
   - Save the compiled `.ttf` into `fonts/src/<Family>-<Style>.ttf`.
4. **Register & bundle**:
   - Add each face to `fonts/catalog.json` (`family`, `category`, `weight`,
     `style`, `out: "fonts/src/<Family>-<Style>.ttf"`).
   - Run `node fonts/build.js` to generate `fonts/<slug>.js` and update
     `FONT_INDEX` in `fonts/fonts.js`.
   - Verify with `node testing/font_system_routing_probe.js` and
     `node testing/text_probe.js`.
   - Remove temporary per-glyph SVG folders / one-off scripts so only the
     compiled `.ttf` and `fonts/<slug>.js` stay in the repository.