# MiniSketch — architecture guide

Read this before changing code. It exists so the next developer (human or AI)
knows the data model, the invariants that have already caused real bugs, and
where each kind of change belongs.

## How it runs

Plain static files, no build step, opened straight from disk
(`file://…/index.html`). That is a hard constraint:

- **No ES modules** (`import`/`export` is blocked over `file://` in Chrome).
  Files are classic `<script>` tags loaded in order: `tools/imagetracer.js`,
  `tools/clipper.js`, `tools/registry.js`, the tool files (`tools/box.js`,
  `tools/slot.js`, `tools/gear.js`, `tools/wall.js`), `core.js`, `app.js`.
- `core.js` is pure (no DOM, no app state) and doubles as a Node module so
  `tests/smoke.js` can run it.

## Files

| File | What lives there |
| --- | --- |
| `core.js` | Pure math: scalars, matrices, SVG path parsing, cubic/spline sampling, the LM solver, polygon/chain utilities, serialization rounding. Global functions. |
| `app.js` | The whole application in one IIFE: document state, rendering, hit-testing, tools/commands, solver wiring, import/export, CNC, UI. |
| `index.html` | Layout, menus, modals, the bilingual Help text. |
| `styles.css` | All styling. |
| `tools/` | `registry.js` + one file per generator (`box.js`, `slot.js`, `gear.js`, `wall.js`, `hinge.js`, …), the tracer (`trace.js`, our wrapper) and the vendored libraries (`imagetracer.js`, `clipper.js`). Do not edit the vendored ones. |
| `fonts/` | The Text dialog's font catalogue. `fonts.js` is the registry (lazy loader, IndexedDB for imported fonts, `FONT_EPOCH`); `build.js` turns `fonts/src/*.ttf` into one generated `fonts/<slug>.js` per face (base64 bytes, registered through `FontFace` — the only route that works from `file://`); `hershey-data.js` + `hershey.js` are the public-domain single-line (stroke) fonts. Do not hand-edit the generated files or `hershey-data.js`. |
| `TOOLS.md` | How to write a tool/plugin: the registration contract, the whole `api` surface, conventions, and testing. |
| `testing/` | Standalone probes (`node testing/<name>_probe.js`). They slice functions out of the sources and run them without a DOM. `tools_probe.js` checks every registered tool against the contract. |
| `tests/smoke.js` | `node tests/smoke.js` — regression tests for `core.js`. |
| `server/` | The AI bridge (`ai-bridge.js`) and a dev static server. The bridge is the ONLY place a paid LLM call happens. |

## The AI endpoint is BYOK

**There is no API key in this repository.** A key baked into the source leaks
with the source, so the bridge starts with none and takes one from the user.

The key travels this way:

1. **MiniSketch Settings › AI chat** holds `AI API base URL`, `AI API key`
   (a masked field) and `AI model`. The app sends all three with every
   `/api/chat` request, in a `settings` block.
2. The bridge uses them **for that request only** and keeps no copy.
3. `POST /api/settings` on the bridge stores the same three values in memory
   (gone when the bridge stops) — for a bridge that serves several people.
4. `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `MODEL` in `server/.env` are the
   fallback for a bridge run by one person.

Order of precedence: request → bridge settings → environment. With no key at
all the bridge answers **400** and names the setting to fill — it must never
fail silently.

**CORS is an allowlist, not `*`.** `originAllowed()` accepts a local file
(`Origin: null`, i.e. the app opened from disk), any `localhost` /
`127.0.0.1` port, and a private LAN address (the phone or tablet talking to
this PC). Everything else gets **403**. `AI_ALLOWED_ORIGINS` adds exact
origins. Without this, any web page the user visits could spend their key
through their own bridge.

`testing/ai_bridge_probe.js` pins all of it (33 checks).

## Data model (`state`)

```
state = {
  points:      { id: { x, y } },              // world mm, Y goes up
  entities:    { id: entity },                // see below
  constraints: { id: constraint },
  namedSel:    { name: [{ kind, id }, …] },
  layers:      [{ id, name, visible, locked }],
  nextLayerId, nextId
}
```

Entity types: `line` {a,b}, `arc` {c,s,e}, `circle` {c,r}, `spline`
{pts[], hs:{o[],i[]}, closed}, `text` {p0,pw,ph,text,font,weight,italic,
tracking,leading,align,single,…}, `art` {p0,pw,ph,contours,closed,ratio}, and
`part` — a rigid assembly body: `polylines` (the frozen master, one `[u,v]`
polyline per contour in LOCAL mm), `pose` {tx,ty,rot} (world mm + degrees, the
only thing that may change), `fixed` (Fix toggle: no solver variables at all),
`grounded` + `groundAt` {u,v,wx,wy} (a marker pinned to the WORLD spot it
occupied when it was grounded — never (0,0); rotation stays free), `width`
(px), `color`, `name`. A part owns NO `state.points`; markers (every node +
segment midpoint + a centroid for each closed loop) are derived from
`polylines` at hit/draw time. `state.mates` = {id:
{type:'pin'|'slider', a, aRef:{u,v}, b, bRef?, bEdge?{pl,i}}} joins two parts
(grounding is the `grounded` flag above, not a mate row). Dragging a marker
solves the whole assembly through `solveAssembly` in core.js (LM on the free
poses, joint weight 100 : target weight 1, alternating target/repair passes,
jitter escape only for parts that take part in the solve). Parts draw dark
green (`#15803d`) in the light theme and light green (`#4ade80`) in the dark
theme, never machine and never export (visualisation only).

Part drag has **two personalities**, chosen at pointerdown:

- **Free (no mate, not fixed): placement drag.** `t1` = the grabbed marker
  frozen at press; the snap cache (`partSnapCache()`: every visible point, plus
  midpoints and the origin) is built **once**; every frame the part is set to
  `startPose + (raw mouse delta)` and then shifted by `snap − wouldBeMarker`
  when a snap sits within 16 px (floor 2 mm) of where the grabbed marker would
  land. One calculation per frame from the start pose, so a caught snap stays
  caught until the mouse really leaves the radius.
- **Mated / fixed: mechanism drag.** No snap, no bounded correction — the raw
  mouse position is the solver target each move (`{fast:true}`, warm start),
  and the release runs one full solve. Pressing the part's *body* (not a
  marker) drags 1:1 (mated parts solve, free parts translate).

Multi-part selection drags as a group when no part in it is mated to a part
outside the selection; Ctrl locks one axis; Ctrl+M moves the whole selection
and its reference pick snaps to part markers too. A multi-point normal
selection (a selected loop, several objects) body-drags with the same bounded
snap as a free part (`selectionBodyDragFor`), excluding its own points from the
cache.


`text` extras: `leading` is line spacing in percent of the font size (default
125, clamped 50–400) and `align` is `left|center|right`; both default to the old
behaviour so older documents load unchanged. `single: true` marks a single-line
(Hershey) font — that text has **no outlines**: `textStrokesWorld` returns open
polylines and every consumer must keep `closed: false` (see `textOutlineWorld`).

Constraint types: `coincident`, `distance` (also `kind:'radius'`),
`horizontal`/`vertical` (per line), `horizontalPoints`/`verticalPoints`,
`pointDim`, `pointOn`, `midpoint`, `tangent`, `tangentAt`, `parallel`,
`perpendicular`, `equal`, `angle`, `aspect`, `fix`, `radius`.
A dimension is a constraint with a `value`; `reference: true` means
measure-only.

`view` = `{ ox, oy, zoom }` (screen placement of the world).
`ui` = everything transient (tool, selection, drag, drafts, panels).

## Invariants (each one caused a real bug — do not break them)

1. **Spline handles are absolute world coordinates**, one entry per node in
   `hs.o` / `hs.i`; a `null` handle means a *corner* and the segment must still
   be drawn (straight). Never drop a segment because a handle is missing, and
   a **closed spline with exactly 2 nodes is a full loop** (both halves).
   When a node is removed, its handle entries must be removed with it: a
   pts/hs length mismatch silently replaces ALL handles with `autoHandles`
   approximations (that once made loop fills deviate from the outlines).
2. **`art`/`text` contours are normalized 0..1 inside their frame** — round them
   with `round6`, never `round2`. World coordinates (mm) use `round2` on save.
3. **Loop polygons hold coordinate copies**, never live `state.points`
   references — a live reference makes one vertex follow a later drag and the
   fill tears into a needle.
4. **World is Y-up, canvas is Y-down** — convert only through `w2s`/`s2w`.
5. **`invalidateLoops()` is the single "geometry changed" hook.** It drops the
   loop cache and the point-use index. Any code that adds/removes entities,
   rewires points **or moves spline handles** (they change the sampled curve)
   must call it (via `touch()`/`commit()`). While `ui.drag` is active the loop
   rebuild is deferred (`loopsDeferred`) to the first read after
   release — that is what keeps multi-thousand-point drags smooth.
6. **`.sketch` format**: `version 2` packs points and handles as `[x, y]` at 2
   decimals; the loader still accepts the v1 `{x, y}` shape. Save/load
   round-trips must keep `closed` flags and null handles intact.
7. **Editing affordances follow the active layer**: point markers, dimension
   labels and constraint badges draw only where they are grabbable
   (`pointEditable` / `constraintAnnotationActive`).
8. **Loop fill may lag during a drag** and catches up on release (by design,
   see 5).
9. **A framed object owns its guide lines.** `removeEntity` / `deleteSelection`
   must delete the text/picture's `guide` lines *and* every constraint that
   hangs off a point nothing else uses. A text's height dimension is a
   `distance` between `p0` and `ph`, not a constraint on the entity, so matching
   constraints by entity id alone leaves it behind after Delete.
10. **A text font may arrive late.** Bundled families lazy-load a `FontFace`, so
   the outline trace cache keys on `FONT_EPOCH` (`fonts/fonts.js`) — never
   cache traced contours under a key that omits it, or the fallback-font outline
   survives the load.
11. **Single-line fonts have no contours.** Anything that walks text outlines
    must go through `textOutlineWorld(e)` and respect its `closed` flag;
    `textContoursWorld` is empty for those fonts on purpose.
12. **The curve fitter de-noises only what it recognises as a trace.** A dense
    wobbly contour (a traced glyph) is smoothed and resampled before fitting;
    a hand-drawn polyline is not. Corner detection measures direction over a
    window for the same reason. Do not lower that guard: smoothing a 4-point
    rectangle shaves its corners.
13. **One snap switch, read everywhere.** `snapEnabled()` is `ui.snap !== ui.altDown`:
    Snap OFF means *nothing* snaps (points included — a dead snap used to look
    like a bug because endpoints still welded), and **Alt is its inverse while
    held**, so snap off + Alt borrows the snaps for a moment. `snapPoint`,
    `findSnapFor` and `partSnapCache` all gate on that one helper, so the
    preview, the hover marker and the click can never disagree. A part drag is
    not a snap magnet: the move is always the raw mouse delta and snap only
    *adds* a bounded correction, with a world floor (`max(2, 16/zoom)`) so deep
    zoom stays usable. A part's own baked source geometry still lives in
    `state.points` and shadows its outline — never exclude a whole bounding box
    of snaps, only points essentially coincident with the grab point.
14. **The assembly solver never touches a spectator part.** Jitter escape for
    singular dead-points applies only to parts that carry a mate or a drag
    target; applying it to unconnected parts accumulates a free rotation each
    call and walks them off the screen. A `string` mate is display-only (a
    measuring thread, `len` recorded at creation, drawn grey as
    current-length + now/rest·100%): the solver has NO string residual — it
    never moves a part, and `partHasAnyMate` ignores it so a part hanging only
    on strings still drags 1:1 like a free part.
15. **Mate picking is the one cross-layer exception.** While a mate job is
    open, `matePickable()` (visible + unlocked, any layer) replaces
    `entityEditable()` in the part hit-tests and `drawPartMarkers` shows every
    visible part's markers — an assembly spans layers. Everything else keeps
    the active-layer rule; locked still means locked even for a mate.

## Performance contracts

- Never scan all entities per point (or vice versa). The point→entities index
  (`pointUses`) is the shared lookup; it registers **each entity once per
  point** (duplicates made handle-drag double-shift once). Same pattern for
  `selectionIndex()`.
- `solveSketch` builds variables **only for points/radii the residuals touch**
  (recorded by a probe call). Adding "all points" back turns any solve into an
  O(n³) freeze.
- `lmSolve` returns immediately when the initial cost is already ~0 — never
  remove that early-out (drag targets sit on the current positions).
- `drawPoints` batches every marker into three `Path2D`s. Per-marker
  `beginPath` is what made thousand-point files crawl.
- Autosave must never run for camera moves: pan/zoom write only the tiny
  `view` record (`minisketch.v1.view`); the document saves on real edits.

## Where to make changes

| Goal | Where |
| --- | --- |
| New entity type | `entityPointIds`, draw branch in `drawEntities`, `cncPolyline`, `loadDocument`, `serializeState`, hit-testing (`entityScreenDistance`) |
| New constraint type | residual in `solveSketch`, `constraintConflict`, badge/draw in `drawConstraintBadges`/`drawDimensions`, `loadDocument` |
| New tool / shortcut | `onPointerDown` branch + `onKeyDown` switch + rail button + Help key table (both language panes!) |
| New setting | `SETTINGS_SPEC` entry + `applySettings` |
| New export format | mirror `downloadSketch` / `openSvgModal` |
| Pure geometry/math | **`core.js` + a case in `tests/smoke.js`** |
| Part / mate behaviour | `partTransform`, `partMarkersOf`, `partSnapCache`/`findSnapFor`, `solveAssemblyNow` (app.js); `solveAssembly` (core.js) + `testing/assembly_probe.js` |
| New Tools-panel generator | **one new file in `tools/`** — see below |

## Tools-panel generators

**Full guide: [`TOOLS.md`](TOOLS.md)** — the complete `api` reference (basic
shapes, curves, constraints, offsets, document operations), a working example,
the conventions, and how to test a tool.

Each generator is its own file in `tools/` and registers itself with
`tools/registry.js`:

```js
window.MiniSketchTools.register({
  id: 'wall',            // also the gen.kind stored on the generated group
  label: 'Extrude wall', title: '…', modalId: 'wall-modal',
  modal: '<div id="wall-modal" …>…</div>',   // injected into <body> at mount
  open(api, params) {},   // fill the dialog (params = a re-edited group's gen)
  apply(api) {},          // generate; must end with a named group + gen.params
  wire() {}               // optional: extra dialog listeners
});
```

- `api` is the surface `toolApi()` in `app.js` exposes: model (`state`, `ui`,
  `settings`), helpers (`P`, `clamp`, `fmt`, `s2w`, `getW/getH`,
  `contentBounds`), shape builders (`addLine`, `addCircle`, `addArc`,
  `addSpline`, `addConstraint`), geometry (`bakeContours`, `offsetClosedChains`,
  `chainPolylines`, `clipperLib`, `signedAreaPts`, …) and document ops
  (`pushHistory`, `commit`, `toast`, `removeEntity`, `requestSolve`,
  `addPanelEntity`, `addPolylineEntity`, `cmdGroupSelection`). A tool must not
  reach into anything else.
- Order matters only in `index.html`: `tools/registry.js`, then the tool files,
  then `core.js` and `app.js` (which calls `mountTools()` from `init()`). Because
  `core.js` loads *after* the tools, a tool must not call core helpers at module
  scope — only from inside `open` / `apply`.
- Adding a tool needs no app.js edit: the registry appends its button to
  `#tools-row`, wires `.btn.primary` to `apply` and `[id$="-cancel"]` to close,
  and `openGeneratorDialog()` hands a double-clicked group to `reopen()`.
- A generator must produce one named group with `gen = { kind: id, params }`,
  push history once (pass `{ noHistory: true }` to `cmdGroupSelection`), and
  keep its source geometry in `gen.params` so a re-edit never needs the
  originals. `node testing/tools_probe.js` enforces all of this for every file
  in `tools/` that registers itself.

## Testing

See [`agents.md`](agents.md) — testing is the owner's job. The short version:

- `node tests/smoke.js` must stay green — every entry there pins a bug that was
  actually shipped once (half-circles on import, dropped segments, solver
  freezes, winding direction).
- The owner tests the app in a browser personally; describe what to check and
  what numbers to read (status bar `frame / draw ms`) instead of testing UI
  yourself.
- When the owner reports a bug, fix it and hand it back for them to verify —
  never argue the report away. If it does not reproduce from reading the code,
  add a `console.log` of the real numbers and ask for the pasted output (or ask
  the owner to breakpoint it) instead of guessing.
- If the owner proposes a fix, hear it first; disagree by discussing, not by
  silently replacing it.

## Known quirks

- `normDeg` used to exist twice (fold-to-180 vs wrap-to-±180); the wrap version
  always won at runtime and is the one in `core.js`. The angle-violated check
  would prefer folding near ±180° — deliberate, unfixed.
- `Ctrl+N` (Name selection) is reserved by Chrome; the panel button works.
- Loop fills are intentionally stale while dragging (see invariant 5/8).

## The raster tracer

`tools/trace.js` wraps the vendored `tools/imagetracer.js` (ImageTracerJS,
**Unlicense / public domain**). It replaced `tools/Potrace.js`, which was GPL
and would have forced the whole app to be GPL — the single blocker to shipping
a closed-source product. Do not reintroduce a GPL library here.

Two rules the wrapper enforces, both worth preserving:

1. **Foreground only.** ImageTracerJS traces every palette colour, so the
   white background of a picture would come back as a rectangle spanning the
   whole sheet. `binarize()` turns the raster into black/white (Rec. 601 luma
   against `threshold`) and `trace()` keeps **only the dark layer**. A traced
   picture must never contain the background rectangle — the cutter would try
   to cut the whole sheet.
2. **The preview is not the result.** The dialog draws a preview from a
   downscaled copy (320 px) so the tolerance can be tuned by watching it, but
   OK traces the **original pixels at full resolution**. Never make the
   preview the thing that gets inserted.

`testing/trace_probe.js` pins both, plus the option mapping
(`detail`→`ltres`, `curve`→`qtres`, `speckle`→`pathomit`, `blur`→`blurradius`,
`corners`→`rightangleenhance`, `smooth`→`linefilter`).

The trace dialog's knobs are read by `traceOptionsFromDialog()` in `app.js`;
the preview is drawn by `drawTracePreview()` and re-drawn (debounced 180 ms)
by `scheduleTracePreview()` whenever a knob changes.

**The preview-affecting knobs are sliders with a number box beside them.**
`bindTraceSlider(id, onChange)` keeps the two in step in both directions: the
slider writes the exact value into the box, the box moves the slider (a value
outside the slider's range pins it to the nearest end). The **number box is the
value of record** — `traceOptionsFromDialog()` reads it, falling back to the
slider when the box is empty. `setTraceValue(id, value, fallback)` puts a
remembered value into both.

**The settings are saved as they change**, not only when OK is pressed
(`saveTracePrefs()`), so a tuning that was abandoned is still there the next
time the panel opens. The saved object is merged into the existing
`minisketch.v1.imgOpts` record, so the DPI and the mode survive alongside.

**The preview shows what the import will produce.** `simplifyTracedPaths()`
is shared by `insertArt()` and by the preview, and the preview's tolerance and
minimum-area scale with its downscale factor — so the contour count under the
preview is the count that will really land in the document, not the raw
tracer's count.

**The trace dialog has its own layout classes** — `trace-box` and
`trace-opts` — and must not borrow `wide-cols`. Nine generator dialogs use
`wide-cols` with the shared `.modal-cols .opt-col { width: 200px }`, and that
rule has the higher specificity: a plain `.trace-opts { width: ... }` would
lose to it and the panel would keep a 200px settings column with the sliders
squashed and a hole beside them. `.modal-cols .opt-col.trace-opts` is
deliberately more specific. `sizeTracePreview()` measures the settings column
and gives the canvas that height, so the preview fills the column instead of
leaving a hole under it; the canvas backing store is scaled by the device
pixel ratio, so the outline stays sharp.
