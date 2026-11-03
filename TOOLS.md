# Writing a Tool (plugin) for MiniSketch

A **tool** is one JavaScript file in `tools/` that registers itself with
`tools/registry.js`. It gets a button in the Tools panel, a dialog, and an
`api` object for creating and editing geometry. No build step, no bundler, no
modules — plain `<script>` files, opened from `file://`.

Read [`ARCHITECTURE.md`](ARCHITECTURE.md) first for the data model.

---

## 1. TL;DR — the rules that matter

| Rule | Why |
| --- | --- |
| One file per tool in `tools/`, added to `index.html` **after `tools/registry.js`** | the registry injects the button and the dialog |
| Your file loads **before `core.js` and `app.js`** | so never call core helpers or `api` at module top level — only inside `open()` / `apply()` |
| `NS.register({ id, label, title, modalId, modal, open, apply })` | `id` doubles as `gen.kind` for re-editing |
| End `apply()` with a **named group** carrying `gen = { kind: id, params }` | double-clicking the result reopens your dialog |
| `api.pushHistory()` **once** at the start, `api.commit()` at the end | one Ctrl+Z undoes the whole tool |
| Group with `api.cmdGroupSelection({ noHistory: true })` | that call would otherwise push a second history step |
| Coordinates are **world millimetres, Y up** | SVG export negates Y; the canvas maps it |
| Colour is the **CNC operation**, not decoration | `#000000` cut, `#ff0000` drill, `#00ff00` construction (never machined, never grouped) |
| Never read `api.state` at module scope | `state` is replaced by undo / open / new; the getter keeps it live |

---

## 2. A complete, working tool

`tools/cornerholes.js` — puts a hole in each corner of the selected closed loop.
Paste this in, add `<script src="tools/cornerholes.js"></script>` after
`tools/registry.js` in `index.html`, reload, and it appears in the Tools panel.

```js
// Corner holes: one hole in each corner of every selected closed loop.
(() => {
  'use strict';

  const NS = window.MiniSketchTools;
  const KEY = 'minisketch.v1.cornerHoles';   // remembered parameters

  // Read the dialog defaults: last used values, overridden by `params` when a
  // generated group is reopened.
  function read(params) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { saved = {}; }
    const p = params || {};
    const num = (k, def, lo) => {
      const raw = p[k] != null && p[k] !== '' ? +p[k] : +saved[k];
      return isFinite(raw) && raw >= (lo == null ? 0 : lo) ? raw : def;
    };
    return {
      dia: num('dia', 6, 0.5),
      inset: num('inset', 8, 0)
    };
  }

  NS.register({
    id: 'cornerholes',                       // also gen.kind
    label: 'Corner holes',
    title: 'Corner holes: drill one hole in each corner of the selected loops',
    modalId: 'ch-modal',

    // The dialog markup. The registry injects this into <body> once.
    modal: `
<div id="ch-modal" class="modal hidden">
  <div class="modal-box">
    <h3>Corner holes</h3>
    <div class="opt-col">
      <label class="opt">Hole diameter (mm) <input type="number" id="ch-dia" value="6" step="0.5" min="0.5"></label>
      <label class="opt">Inset from the corner (mm) <input type="number" id="ch-inset" value="8" step="1" min="0"></label>
    </div>
    <div class="cnc-status">One hole per corner of each selected closed loop. The loops stay untouched; the result is one named group &mdash; double click it to edit the parameters.</div>
    <div class="modal-actions">
      <button class="btn" id="ch-cancel">Cancel</button>
      <button class="btn primary" id="ch-ok">Create</button>
    </div>
  </div>
</div>`,

    // Fill the dialog. `params` is gen.params when a group is reopened, else null.
    open(api, params) {
      const s = read(params);
      const el = (id) => document.getElementById(id);
      el('ch-dia').value = s.dia;
      el('ch-inset').value = s.inset;
      const ok = el('ch-ok');
      if (ok) ok.focus();
    },

    // Do the work. Always: pushHistory -> build -> commit -> group -> gen/name.
    apply(api) {
      const el = (id) => document.getElementById(id);
      const dia = api.clamp(+el('ch-dia').value || 6, 0.5, 500);
      const inset = api.clamp(+el('ch-inset').value || 0, 0, 500);
      NS.close('cornerholes');
      try { localStorage.setItem(KEY, JSON.stringify({ dia, inset })); } catch (e) { /* ignore */ }

      // Source geometry: bake the selection into world contours (chained,
      // de-duplicated, winding normalised, with per-colour grouping kept).
      const picked = api.selectedEntities();
      if (!picked.length) {
        api.toast('Select a closed loop first');
        return;
      }
      const baked = api.bakeContours(picked, {});
      const loops = (baked.contours || []).filter(c => c.closed && c.pts && c.pts.length >= 3);
      if (!loops.length) {
        api.toast('That selection has no closed loop');
        return;
      }

      const r = dia / 2;
      const color = api.ui.color;

      api.pushHistory();
      const madeIds = [];
      const srcs = [];
      for (const loop of loops) {
        // The inset runs along the bisector, INTO the material. Taking the two
        // edge directions pointing AWAY from the corner and adding them gives
        // that direction for a convex corner; a reflex corner needs the other
        // side, which the cross product tells us.
        const area = api.signedAreaPts(loop.pts);          // > 0 = counter-clockwise
        const n = loop.pts.length;
        for (let i = 0; i < n; i++) {
          const prev = loop.pts[(i - 1 + n) % n];
          const at = loop.pts[i];
          const next = loop.pts[(i + 1) % n];
          const a = { x: prev.x - at.x, y: prev.y - at.y };
          const b = { x: next.x - at.x, y: next.y - at.y };
          const la = Math.hypot(a.x, a.y), lb = Math.hypot(b.x, b.y);
          if (la < 1e-6 || lb < 1e-6) continue;
          const cross = a.x * b.y - a.y * b.x;
          const flip = ((cross > 0) === (area > 0)) ? -1 : 1;   // reflex corner
          let dx = (a.x / la + b.x / lb) * flip;
          let dy = (a.y / la + b.y / lb) * flip;
          const len = Math.hypot(dx, dy);
          if (len < 1e-9) continue;                        // a straight vertex
          const cx = at.x + (dx / len) * inset;
          const cy = at.y + (dy / len) * inset;
          // one circle entity: centre point + radius
          const id = api.addCircle({ x: cx, y: cy }, r, color);
          if (id) madeIds.push(id);
        }
        srcs.push(loop.pts.map(p => [api.round2(p.x), api.round2(p.y)]));
      }
      if (!madeIds.length) {
        api.toast('Corner holes: nothing fit');
        return;
      }
      api.commit();

      // One named group, and remember the parameters for a double-click re-edit.
      api.ui.selection = madeIds.map(id => ({ kind: 'entity', id }));
      api.cmdGroupSelection({ noHistory: true });
      const wrap = api.ui.selection.length === 1
        ? api.state.entities[api.ui.selection[0].id] : null;
      if (wrap && wrap.type === 'art') {
        wrap.gen = { kind: 'cornerholes', params: { dia, inset, src: srcs } };
        wrap.name = 'Corner holes \u00d8' + api.fmt(dia);
        api.commit();
      }
      api.toast('Corner holes: ' + madeIds.length + ' hole' +
        (madeIds.length === 1 ? '' : 's') + ' \u00b7 \u00d8' + api.fmt(dia) + ' mm');
    }
  });
})();
```

Note the shapes of the two recurring steps:

* **read the result of the bake**, not of the selection — `bakeContours` is what
  turns lines / arcs / splines / groups into closed world contours.
* **`gen.params` carries your own source data** when the original geometry may
  change later. Reference tools keep their source in `gen.params.src` so a
  re-edit rebuilds from those numbers and never depends on the current document.

---

## 3. The registry contract

`tools/registry.js` — you do not edit it, you only call it:

```js
window.MiniSketchTools.register({
  id:      'slot',          // unique; also the gen.kind stored on the group
  label:   'Slot',          // button text in the Tools panel
  title:   '…',             // button tooltip
  modalId: 'slot-modal',    // the outer <div> id of your dialog
  modal:   '<div id="slot-modal" …>…</div>',   // injected into <body> once
  open:    (api, params) => {},  // fill the dialog; params = gen.params or null
  apply:   (api) => {},          // do the work
  wire:    (api) => {}           // optional: extra listeners, run once at mount
});
```

What the registry does for you:

* appends a `<button class="btn small" id="btn-<id>">` to `#tools-row`;
* injects your `modal` markup into `<body>`;
* wires `.modal-actions .btn.primary` → `apply(api)` and `[id$="-cancel"]` → close;
* routes a **double-clicked group** to `open(api, gen.params)` when
  `gen.kind === id`;
* runs `wire(api)` once, for listeners beyond Create / Cancel (e.g. a `<select>`
  that shows and hides field groups).

### Dialog conventions

* Give every element id a **tool-specific prefix** (`ch-`, `hg-`, `slot-`).
  Two tools with the same id will fight, and the id must exist in your markup —
  `node testing/tools_probe.js` checks that every `getElementById('…')` in your
  file has a matching `id="…"`.
* The primary action must be `.btn.primary`; the cancel element must end in
  `-cancel`. Then **Enter** and **Escape** work for free (app.js has one generic
  modal keyboard handler).
* Use the existing classes: `.modal-box`, `.opt-col`, `.opt`, `.cnc-row`,
  `.cnc-label`, `.cnc-unit`, `.cnc-status`, `.modal-actions`, `.btn`, `.btn.primary`.

---

## 4. The `api` object

Everything a tool may touch. Nothing else in `app.js` is public.

### Model access

| Member | What it is |
| --- | --- |
| `api.state` | **getter** → `{ points, entities, constraints, layers, nextId, namedSel }`. Read it fresh every time; never store it. |
| `api.ui` | live UI state: `color`, `activeLayer`, `selection`, `snap`, `showGrid`, … |
| `api.settings` | live settings (`artTol`, `joinTol`, `bakeJoinTol`, `curveFitTol`, `curveSharpAngle`, `noteSize`, `offsetJoin`, `offsetMiter`, `offsetArcTol`, …) |

### Points

| Call | Returns | Notes |
| --- | --- | --- |
| `api.newId()` | `number` | the next free id, for anything you write into `state` yourself |
| `api.privatePoint(x, y)` / `api.addPoint(x, y)` | `number` | always a **new** point |
| `api.P(id)` | `{x, y}` \| `null` | read a point |
| `api.entityPointIds(e)` | `number[]` | the point ids an entity uses, in order |

### Basic shapes and curves

All of these create the entity **and** its points, on `api.ui.activeLayer`, and
return the new entity id (or `null` when the input is unusable). `color` defaults
to `api.ui.color`. Point arguments accept a **point id**, a `{x, y}`, or a snap
object — and reuse an existing point of the same colour when it sits exactly
there, so chains stay connected.

| Call | Creates |
| --- | --- |
| `api.addLine(a, b, color?)` | `{ type: 'line', a, b }` |
| `api.addCircle(c, r, color?)` | `{ type: 'circle', c, r }` |
| `api.addArc(c, s, e, color?)` | `{ type: 'arc', c, s, e }` — `s` and `e` are points **on** the arc |
| `api.addSpline({ pts, hs?, closed?, color?, fill?, tol?, weld? })` | `{ type: 'spline', pts, hs, closed }` — see below |
| `api.addPanelEntity(pts, color)` | a **closed** spline from an array of `{x, y}`, all handles null: the standard way to emit a cut outline |
| `api.addPolylineEntity(pts, color)` | the same, **open** — for cut lines that are not a loop (kerf slits, score marks) |
| `api.addConstraint(c, opts?)` | a validated constraint, solved unless `opts.solve === false`; `opts.history: false` skips the undo step |
| `api.addNote(text, x, y)` | a comment (the `;` note) at a world position; returns its id |

`addSpline` details:

* `pts`: array of point ids / `{x, y}`; at least 2.
* `hs`: `{ o: [...], i: [...] }`, **absolute world positions**, same length as
  `pts`, `null` = sharp corner at that node. Omit it and `autoHandles` generates a
  smooth curve through the points.
* `closed: true` makes a real loop (the wrap segment is drawn).
* `fill`: `'gray'` or `'yellow'` — the loop fill shown behind the outline.

For anything the builders do not cover, write the entity directly. The document
is a plain object graph:

```js
const id = api.newId();
api.state.points[id] = { x, y };                       // points are owned by entities
api.state.entities[id] = {
  id, type: 'spline', pts: [/* point ids */], closed: true,
  hs: { o: [/* … */], i: [/* … */] },                   // may be all null
  color: '#000000', layer: api.ui.activeLayer,
  fill: null,                    // 'gray' | 'yellow' | null
  name: '',                      // label drawn at the frame's top-left
  tol: 0.1,                      // optional: own simplification tolerance (mm)
  gen: { kind: 'mytool', params: {} }   // only on a generated group
};
```

### Constraints

`api.addConstraint({ type, … }, opts?)` — `opts.history: false` when you already
pushed history, `opts.solve: false` to add without solving.

| `type` | Fields |
| --- | --- |
| `coincident` | `p1`, `p2` |
| `horizontalPoints`, `verticalPoints` | `p1`, `p2` |
| `horizontal`, `vertical` | `entity` (a line) |
| `distance` | `p1`, `p2`, `value`, `offset` (dimension text distance), `reference?`, `kind?` |
| `pointDim` | `p`, `entity`, `value` (dimension from a point to a line) |
| `radius` | `entity` (circle / arc), `value` |
| `angle` | `line1`, `line2`, `value` (degrees), `radius` |
| `parallel`, `perpendicular` | `line1`, `line2` |
| `equal` | `line1`, `line2` |
| `tangent` | `line`, `entity`, `side` (+1 / −1) |
| `tangentAt` | `line`, `entity`, `p` (tangency point) |
| `midpoint` | `p`, `entity` |
| `pointOn` | `p`, `entity` |
| `fix` | `p`, `x`, `y` (anchor a point in place) |
| `aspect` | `entity`, `p0`, `pw`, `ph`, `ratio` — created for you by framed objects; do not add by hand |

`value` / `reference`: a **reference** dimension only measures; a driving one
forces the geometry. `offset` positions the dimension text.

### Solving

| Call | Effect |
| --- | --- |
| `api.requestSolve(a?, b?)` | solve according to the user's solve mode (`manual` only marks the sketch unsolved) — the normal call after changing geometry |
| `api.solveNow(opts?)` | force a solve regardless of mode; returns `{ cost, … }` |

Editing point coordinates directly and then calling `api.requestSolve()` is how a
tool makes a constraint-driven change. If you only add plain geometry, `commit()`
alone is enough; tools do **not** have to solve.

### Reading geometry

| Call | Returns |
| --- | --- |
| `api.selectedEntities()` | the selected entities (objects, not ids) |
| `api.colorOf(e)` | the entity's colour, defaulting to `#000000` |
| `api.entityWorldPolylines(e)` | `[{ pts: [{x, y}], closed }]` — the entity flattened **as drawn** |
| `api.bakeContours(ents, { joinTol?, keepCurve? })` | `{ contours: [{ pts, closed, color, fill, depth }], curves }` — chains, de-duplicates, normalises winding. **Use this on a selection.** |
| `api.getLoops()` | `[{ poly: [{x, y}], area, steps, splineEntity } \| { circle: true, entity, poly, area }]` — every closed loop in the document |
| `api.loopEntities(loop)` | the entity ids that make up a loop |
| `api.contentBounds()` | `{ minX, minY, maxX, maxY }` of the drawing, or `null` |
| `api.getW()` / `api.getH()` | canvas size in CSS pixels |
| `api.s2w(sx, sy)` | screen → world; use with `getW()/getH()` to place output at the view centre |

### Geometry helpers

| Call | Notes |
| --- | --- |
| `api.chainPolylines(chains, tol)` | join polylines that share endpoints |
| `api.normalizeWinding(contours)` | sets `depth` (even = island, odd = hole) and winds accordingly |
| `api.signedAreaPts(pts)` | signed area; **negative = hole** after normalisation |
| `api.pointInPoly(pt, pts)` | containment test |
| `api.offsetClosedChains(contours, dist, opts?)` | Clipper offset. `dist` in mm: **positive grows, negative shrinks** (independent of winding). `opts`: `{ join: 'sharp'\|'round'\|'square', miterLimit, arcTol }`. Returns `[{pts, closed}]`, or `null` if `tools/clipper.js` is missing. |
| `api.clipperLib()` | the raw `ClipperLib` object, for boolean / difference work |
| `api.offsetScale` / `api.offsetPrecision` | 1000 (Clipper works in integers) / 0.001 |
| `api.offsetMiter()` | the miter limit from Settings |

### Pure helpers from `core.js`

`core.js` is a plain script, so its top-level functions are globals and a tool
may call them directly (this is how the built-in tools fit curves and sample
splines):

`TAU`, `clamp`, `round2`, `round6`, `cubicAt`, `splitCubic`, `autoHandles`,
`splineSamples`, `splineCubics`, `splineFrame`, `sampleArc`, `arcCubicNodes`,
`fitPolylineCurve`, `pointInPoly`, `signedAreaPts`, `interiorProbe`,
`normalizeWinding`, `chainPolylines`, `lmSolve`, `solveLinear`,
`lineLineIntersect`, `lineCircleIntersect`, `svgPathSegments`, `parseDxf`, …

`fitPolylineCurve(pts, { tol, sharpAngle, closed })` is the one to reach for when
a tool produces a dense polyline that should become real Bézier curves: it
returns `{ nodes: [{ x, y, o, i }], closed, corners }` with as few cubic segments
as stay within `tol`, keeping a corner wherever the polyline turns more than
`sharpAngle` degrees.

### Document operations

| Call | Notes |
| --- | --- |
| `api.pushHistory()` | snapshot before your changes. **Once**, at the start of `apply()`. |
| `api.commit()` | layer fix-ups, sweep orphan points, invalidate loops, autosave, repaint. **Always** call it before you group or report. |
| `api.toast(msg)` | feedback in the status toast |
| `api.removeEntity(id)` | delete an entity (and its owned guide lines) |
| `api.cmdGroupSelection({ noHistory: true })` | wrap the **current selection** into one `art` group |
| `api.fmt(n)` | number → short string, for labels and toasts |

---

## 5. Conventions, and the invariants they protect

1. **One undo step per tool.** `pushHistory()` once, then every mutation, then
   `commit()`, then `cmdGroupSelection({ noHistory: true })`. Do not call
   `pushHistory()` again after that.
2. **Name what you produce.** Set `wrap.name`. A group without a name has no
   label on the canvas, and the user cannot tell the results apart.
3. **Store your parameters.** `wrap.gen = { kind: id, params: {…} }` — the whole
   double-click re-edit flow depends on it. Put source geometry in `params` too
   if a re-edit must not depend on the current document.
4. **Do not delete the user's input** unless the tool is explicitly a converter.
   Most generators add a result next to the original.
5. **Labels must go into the selection too.** A generated group is built from
   whatever is selected when you call `cmdGroupSelection`, so a label created
   with `api.addNote` and left out of `ui.selection` stays an orphan comment —
   the group drags away and the label is left behind. Push the id your builder
   returned into the same array you select:
   ```js
   const ids = [];
   const id = api.addPanelEntity(pts, color); if (id) ids.push(id);
   const note = api.addNote('Base 150x125mm', cx, cy); if (note) ids.push(note);
   api.ui.selection = ids.map(id => ({ kind: 'entity', id }));
   api.cmdGroupSelection({ noHistory: true });   // the comment is stored inside
   ```
6. **Colour is the operation.** KaryaCNC reads the stroke colour as the machining
   operation: `#000000` cut, `#0000ff` engrave, `#ff0000` drill, `#800080`
   pocket, `#00ff00` construction. Green lines are never machined and never
   grouped — keep guides green, and choose the colour of real geometry
   deliberately (`api.ui.color` is the user's current pick).
7. **Points are shared, not copied.** Two entities that meet must use the *same
   point id*, otherwise the joint comes apart when dragged. The builders do this
   for you (same-colour, same-position). When you build entities by hand, pass
   ids.
8. **Never weld across colours.** Joining a white loop to a red point merges two
   machining operations. `pointAtWorld` / the builders respect this via
   `weldAllowed`; if you write points yourself, respect it too.
9. **`commit()` cleans up.** A point used by no entity and no constraint is
   deleted — so create points and entities together, before committing.
10. **Millimetres, Y up.** Screen Y is flipped by the view; never mix the two
   (`api.s2w` converts).
11. **No per-frame work.** A tool runs on Create, not every frame. If you cache
    something, key it on the geometry, and drop the cache in `commit()` (which
    calls `invalidateLoops`).

---

## 6. Testing a tool

Testing is the owner's job — see [`agents.md`](agents.md). **Do not spend a
long time checking.** Run the two Node probes below, report what they say, and
stop. Anything that needs eyes on the UI — how it looks, whether a drag feels
right, whether the dialog reads well — is the owner's check: ask them to try it
instead of probing, scripting a browser, or reasoning about pixels. Probes cover
the contract and the math, not the feel. When the owner reports your tool is
wrong, fix it and hand it back to verify; if it does not reproduce from reading
the code, add a `console.log` of the real numbers (or ask the owner to
breakpoint the suspicious line) rather than guess. If the owner proposes a fix,
discuss before replacing it.

Two layers, both runnable with plain Node (`node testing/<file>.js`):

**a) The contract probe** — `node testing/tools_probe.js` walks every file in
`tools/` that calls `NS.register` and checks, for each one:

* every `api.<name>` it uses exists on the surface (`toolApi()` in `app.js`);
* it does not reach for the document through a bare global;
* the dialog carries every id it reads;
* the registry mapping, the script order in `index.html`, and the mount point;
* it groups the result, stores `gen.kind`, names the group, and pushes history
  exactly once.

**b) A geometry probe** — write `testing/<tool>_probe.js` that slices the pure
functions out of your tool file and runs them without a DOM:

```js
const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'mytool.js'), 'utf8');
function braceEnd(s, from) { /* brace matching, see an existing probe */ }
const slice = (name) => { /* extract "function name(...) { ... }" */ };
const names = ['rect', 'tabCentres', 'myPlan'];
const T = new Function(consts + names.map(slice).join('\n') +
  '\nreturn {' + names.join(',') + '};')();
```

That is why the built-in tools are written as **pure plan functions** plus a thin
`apply()`: `hingePlan(prm)` / `wallPlanFor(...)` return plain numbers and point
arrays, so a probe can assert on them directly. Whatever you can express without
the document, express without the document.

The strongest checks are properties, not snapshots:

* the panel is the size it claims (`bbox` of the outline);
* a slot is centred on the tab it receives, and the slot width is
  `thickness + clearance`;
* `api.offsetClosedChains` / Clipper actually removed the area you expected —
  compare **signed** areas, since a hole comes back wound the other way;
* a curve passes within `tol` of the input (sample it densely — the renderer's
  own 12-samples-per-segment density is too coarse to judge a fit by).

Finally, `node tests/smoke.js` must stay green: it pins the `core.js` behaviour
every tool relies on.

When a probe goes red, check **once** whether the failure is yours (read the
assertion, run it against the previous file if there is a backup). If it is not
obviously yours, say so and ask the owner — do not spend a long session
reconstructing old probe plumbing.

---

## 7. Checklist before handing a tool back

- [ ] file in `tools/`, `<script>` added after `tools/registry.js` in `index.html`
- [ ] `NS.register({ id, label, title, modalId, modal, open, apply })`
- [ ] dialog: `.btn.primary` = Create, `[id$="-cancel"]` = Cancel, prefixed ids
- [ ] `open()` fills every field from `read(params)` (and remembers them)
- [ ] `apply()`: `pushHistory()` → build → `commit()` → group(`noHistory`) →
      `gen = { kind, params }` → `name` → `commit()`
- [ ] no `api.state` captured at module scope
- [ ] no work at module load (core.js is not loaded yet)
- [ ] output is in world mm, Y up, and lands where the user is looking
- [ ] `node testing/tools_probe.js` green
- [ ] `node tests/smoke.js` green
- [ ] you have described what to check in the browser (the owner tests the UI)

---

## 8. Pitfalls that have actually bitten

Each of these was a real bug in this codebase, worth re-reading before you write
a tool.

* **A stale `state`.** `state` is `let` and replaced by undo / New / load.
  Capturing `api.state` in a variable meant the tool wrote its `gen` and `name`
  into a dead object: the group appeared but double-click did nothing.
* **Two tolerances for the same geometry.** The on-screen snapshot of a circle
  followed the *render* chord while the CNC path followed the *flatten*
  tolerance, so arrayed clones cut smoother than the original. If a tool needs
  machine geometry, compute it at the machine's tolerance.
* **Two homes for one setting.** The CNC flatten tolerance was stored both in the
  Settings record and in the KaryaCNC record; the second one silently won. Keep
  one source of truth.
* **`Math.abs` hiding holes.** A Clipper difference returns the outer contour
  plus holes wound the other way; the *signed* sum is the remaining material.
* **Snapshot resolution.** A canvas copy must be taken at the backing-store size
  (`canvas.width`, i.e. `W × devicePixelRatio`) and blitted into a `W × H` user
  space, or it silently crops on a scaled display.
* **An id typo in the dialog.** Code reading `hg-ok` while the markup said
  `hinge-ok` produced a Create button that did nothing. `tools_probe.js` now
  catches this.
* **Grouping without a name or `gen`.** The result cannot be labelled or
  re-edited, which is the difference between a tool and a one-off script.
