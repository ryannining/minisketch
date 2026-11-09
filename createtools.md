# Building a MiniSketch tool addon — the working handbook

This is the fast lane for writing a generator tool for MiniSketch when you have
never seen the repository. It is written for an agent that needs to produce
working code, not for a human who wants a reference manual: every section is
something you either copy, or get wrong.

[`TOOLS.md`](TOOLS.md) is the formal reference (rules, api list, checklist) and
[`ARCHITECTURE.md`](ARCHITECTURE.md) is the data model. This file does not
repeat them. It adds what neither contains: **how a grouped object is actually
built inside**, **how to change its constraints from a tool**, the numbers that
have hurt people, and a probe you can run without a browser. Every claim here
carries a `file:line` that was checked against the code as this file was
written — if the line has moved, grep the symbol name, not the number.

Two notes up front:

* `TOOLS.md` §2 walks through `tools/cornerholes.js`. That file no longer
  exists. Use `tools/flex.js` or `tools/paneliklan.js` as the small live
  examples instead.
* `app.js` is one ~24.5k-line IIFE. You never need to read most of it. The only
  region you need is `toolApi()` at `app.js:11565-11607` — that object literal
  *is* the entire surface a tool may touch.

---

## 0. Ten minutes to a new tool

Four files, always the same four:

| File | Change |
| --- | --- |
| `tools/mytool.js` | new. One IIFE that calls `MiniSketchTools.register({...})` |
| `index.html` | one `<script src="tools/mytool.js"></script>` — after `tools/registry.js` (`index.html:637`), before `src="app.js"` |
| `help.js` | one bullet in the `en` list (`help.js:206`) and the matching one in the `id` list (`help.js:208`) |
| `testing/mytool_probe.js` | new. Pure geometry, no DOM (§9) |

Then:

```sh
node --check tools/mytool.js
node testing/mytool_probe.js    # your geometry
```

Run only what covers *the tool you are building*. The repo-wide checks —
`node testing/tools_probe.js`, `node testing/help_probe.js`, `node tests/smoke.js`
and every other tool's probe — are **regression suites you do not run
unprompted**: tool work is interactive, iterate with the user until the design
is agreed, and only test when the user gives the green light that verification
is needed. The point is to save tokens, not to be careless; when asked, run the
full set verbatim and report the output.

The skeleton below passes `tools_probe.js` as written. Fill in the plan and the
emission; do not reorder the steps.

**The dialog is two columns: parameters on the left, the explanation on the
right — never stacked.** `<div class="modal-box wide-cols">` + `<div class="modal-cols">`
wrapping `<div class="opt-col">` (inputs only) and, as its **sibling**, the
`<div class="cnc-status">` (styles.css:699-717: the `opt-col` is a fixed 200px
column, the status takes the rest). A status placed *inside* `opt-col` falls
under the inputs, which is the wrong shape: the panel goes tall, the right side
stays empty, and the wide-screen layout is lost. The `@media (max-width: 620px)`
rule in styles.css:709-717 deliberately keeps two columns on a phone — "bantuan
jangan pindah ke bawah" — so nothing rescues a wrong markup afterwards. Live
examples: `tools/hinge.js:317-331`, `tools/wall.js:453-468`, `tools/slot.js:172-187`.

```js
// Mytool: one paragraph on what it makes and which existing tool it is a
// relative of. Say what the parameters MEAN physically, not just their units.
(() => {
  'use strict';

  const NS = window.MiniSketchTools;
  const KEY = 'minisketch.v1.mytool';

  // ---- the plan (pure, DOM-free: this is what the probe slices) ----------
  // Return { ok:false, why:'...' } for anything you cannot build honestly.
  // Never silently clamp a nonsense input into a mediocre one.
  function plan(p) {
    if (!(p.w > p.h)) return { ok: false, why: 'width must exceed height' };
    return { ok: true, w: p.w, h: p.h };
  }

  function read(params) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (err) { saved = {}; }
    const p = params || {};
    const num = (k, def, lo) => {
      const raw = p[k] != null && p[k] !== '' ? +p[k] : +saved[k];
      return isFinite(raw) && raw >= (lo == null ? 0 : lo) ? raw : def;
    };
    return { w: num('w', 60, 6), h: num('h', 20, 3) };
  }

  NS.register({
    id: 'mytool',                                  // doubles as gen.kind
    label: 'My tool',                              // button text
    title: 'One sentence in the tooltip',
    modalId: 'mytool-modal',
    modal: `
<div id="mytool-modal" class="modal hidden">
  <div class="modal-box wide-cols">
    <h3>My tool</h3>
    <div class="modal-cols">
    <div class="opt-col">
      <label class="opt">Width (mm) <input type="number" id="mt-w" value="60" step="1" min="6"></label>
      <label class="opt">Height (mm) <input type="number" id="mt-h" value="20" step="1" min="3"></label>
    </div>
      <div class="cnc-status">What happens, which numbers are nominal, what
      cannot be done and why. The user reads this instead of asking. It sits to
      the RIGHT of the inputs, never under them.</div>
    </div>
    <div class="modal-actions">
      <button class="btn" id="mytool-cancel">Cancel</button>
      <button class="btn primary" id="mytool-ok">Create</button>
    </div>
  </div>
</div>`,

    open(api, params) {
      const s = read(params);
      const el = (id) => document.getElementById(id);
      el('mt-w').value = s.w;
      el('mt-h').value = s.h;
      const ok = el('mytool-ok');
      if (ok) ok.focus();
    },

    apply(api) {
      const el = (id) => document.getElementById(id);
      const fmt = api.fmt, toast = api.toast;
      const w = api.clamp(+el('mt-w').value || 60, 6, 5000);
      const h = api.clamp(+el('mt-h').value || 20, 3, 500);
      NS.close('mytool');
      try { localStorage.setItem(KEY, JSON.stringify({ w, h })); } catch (err) { /* storage blocked */ }

      const p = plan({ w, h });
      if (!p.ok) { toast('My tool: ' + p.why); return; }   // document untouched

      api.pushHistory();                                   // exactly one per file

      const centre = api.s2w(api.getW() / 2, api.getH() / 2);
      const color = api.ui.color;
      const madeIds = [];
      // emit(...): api.addPanelEntity(closedRing, color) / api.addPolylineEntity(twoPts, color)
      // ...your geometry here, in world millimetres, Y down...
      api.commit();
      if (!madeIds.length) { toast('My tool: nothing was built'); return; }

      api.ui.selection = madeIds.map(id => ({ kind: 'entity', id }));
      api.cmdGroupSelection({ noHistory: true });
      const wrap = api.ui.selection.length === 1 ? api.state.entities[api.ui.selection[0].id] : null;
      if (!wrap || wrap.type !== 'art') { toast('My tool: the shapes are there but not wrapped'); return; }
      wrap.gen = { kind: 'mytool', params: { w, h } };
      wrap.name = 'My tool ' + fmt(w) + '\u00d7' + fmt(h);
      api.commit();
      toast('My tool: ' + fmt(w) + '\u00d7' + fmt(h) + ' mm');
    }
  });
})();
```

---

## 1. The contract a machine enforces

`node testing/tools_probe.js` walks every file in `tools/` that calls
`NS.register` and fails the build otherwise. What it demands, with the check's
own line:

| Enforced | Probe |
| --- | --- |
| every `api.<name>` you use exists on `toolApi()` | `testing/tools_probe.js:110-113` |
| no bare `state.` — always `api.state.` | `:115` |
| every `el('x')` / `getElementById('x')` has a matching `id="x"` in your own modal string | `:123-127` |
| a registered `id:` | `:128` |
| `api.cmdGroupSelection({ noHistory: true })` present | `:155` |
| `kind: '<your id>'` present (file name and id may differ — `hinge.js` registers `hinge`, `pulltop.js` registers `pulltopduo`) | `:156-157` |
| `wrap.name =` present | `:158` |
| `api.pushHistory()` appears **exactly once** in the file | `:159` |
| `index.html` loads registry → tools → app.js, and has `id="tools-row"` | `:141-149` |
| nothing reassigned with `let` is exposed as a plain value; `state` is a getter | `:97-105` |

The registry itself (`tools/registry.js`) does three things you must not
duplicate: injects the modal into `<body>` (`:36-41`), wires `.btn.primary` to
`apply` and `[id$="-cancel"]` to `close` (`:45-52`), and creates the button
(`:53-59`). `NS.reopen` (`:78`) is how a double click finds you again: it looks
up `gen.kind` in the tool list and calls `open(api, gen.params)`.

---

## 2. The api surface, mapped by purpose

`toolApi()` returns this literal (`app.js:11565-11607`). Grouped by what you are
trying to do, because reading it alphabetically wastes time:

**What is selected / what it looks like baked**
* `selectedEntities()` `app.js:2719` — the picked entities.
* `entityWorldPolylines(e)` `:10288` — any entity kind as world-space polylines. This is how you read a selection you did not create (bbox, source geometry).
* `pathChainsOf(ents, tol)`, `flattenSpline`, `fitPolylineCurve`, `rdpSimplify` — tolerance-based sampling and simplification (`:11362` for `pathChainsOf`).
* `bakeContours(ents, opts)` `:10543` — colour-and-fill-separated chains, welded at `opts.joinTol` (`:10545`), winding-normalised (`:10572`). `opts.keepCurve` also returns the real Bézier sources.
* `chainPolylines(chains, tol)` — glues endpoints into loops. **Concatenates without sewing**: two ends within `tol` stay two vertices (see `tools/slot.js`'s `stitchChains` for why that matters).
* `normalizeWinding(contours)` — outer loop first, holes wound the other way by *nesting depth*.

**Building geometry** (none of these push history; the caller owns the undo step)
* `addPanelEntity(pts, color)` `:11311` — closed polygon.
* `addPolylineEntity(pts, color)` `:11331` — open path.
* `addFittedCurve(pts, color, {tol, sharpAngle, closed})` `:11582` → `addFittedSpline` `:18376` — refits a dense polyline into real nodes + handles. Falls back to nothing if the fit fails; `slot.js` follows it with `if (!id) id = api.addPanelEntity(...)`.
* `addLine` / `addCircle` / `addArc` / `addSpline` `:11432+`, `addNote(text,x,y)` `:11500`, `addText(text,x,y,opts)` `:11517`.
* `addPoint` = `privatePoint(x,y)` `:2439` — a bare point id.

**Grouping and the frame**
* `cmdGroupSelection({ noHistory: true })` `:10575` — bake → frame → take over. §3.
* `cmdUngroupSelection()` `:10713`, `cmdConvertToCurve()` `:18462`, `cmdBoolean(mode)` `:13394`.
* `moveSelection` `:4200`, `scaleSelection` `:4279`.
* `removeEntity(id)` `:2370` / `removeEntities` / `deleteSelection`; `entityPointIds(e)` `:1679`.

**Constraints and solving** (§4 is the real explanation)
* `addConstraint(c, opts)` `:11555` → `addConstraint` `:3738`.
* `requestSolve()` `:3378`, `solveNow(fixed, 60)` `:3578`, `getLoops()` `:8080`, `loopEntities()`.
* `api.state.constraints` and `api.state.points` are plain objects — you may
  write and `delete` entries directly (§4 explains when that is the right call
  instead of `api.addConstraint`).
* `newId()` `:11572`, `P(pid)` for a point, `round2`, `clamp`, `fmt`.

**Offset / booleans / measurement**
* `clipperLib()` `:12025` (null if `tools/clipper.js` did not load — always check), `offsetClosedChains(contours, dist, opts)` `:12029`, `polyBoolOp(op, subject, clip)` `:13304`, `signedAreaPts`, `pointInPoly`.
* `offsetScale` = 1000 (`:12022`, i.e. 1 unit = 0.001 mm), `offsetPrecision` = 0.001, `offsetMiter()`.

**Canvas, colour, housekeeping**
* `ui` (selection, color, activeLayer, settings-visible state), `settings`, `colorOf(e)` `:1706`, `contentBounds()` `:2017`, `getW`/`getH`/`s2w`, `exportSVG`, `svgImportParse`, `svgImportInsert`.
* `pushHistory()` `:11588`, `commit()`, `toast()`.

**Not exposed, so do not try:** the solver internals, the renderer, the event
loop, `xf*` transform state, the file save path. If you feel you need one of
those, the tool is shaped wrong.

---

## 3. Anatomy of the object a tool produces

`cmdGroupSelection` is the whole story of why your output behaves the way it
does. Read once, at `app.js:10575-10678`:

1. `xfBlock()` — refuses while a transform is pending (`:10580`). A tool that
   wants to group mid-drag simply cannot.
2. Decides `takeOver` (`:10604`):
   ```js
   const takeOver = !hasConstraints && !picked.some(e => e.type === 'arc' || e.type === 'circle');
   ```
   **This is the single most consequential line for a generator.** If your
   emitted entities carry any constraint, or if any of them is an `arc` or a
   `circle`, the group is made as a *bake*: the originals **stay on the canvas**
   next to your group, and a later move drags stale geometry along. Emit closed
   polygons (`addPanelEntity`) or fitted splines instead of circles. That exact
   bug is documented in `testing/paneliklan_apply_probe.js:1-15`.
3. Green construction lines are only absorbed on the take-over path
   (`:10606-10615`), and a selection of one `art`/`text` refuses with "Already
   one object" (`:10616-10619`) — so replace a re-edited group *before* grouping
   (§7).
4. Notes are pulled out and stored inside the group (`:10624-10630`, `:10422` in
   the framer) — but only notes that were in the selection.
5. `bakeContours(geo, { keepCurve: true })` (`:10638`) → `addFramedObject(...)`
   (`:10650`) → originals deleted (`:10659-10665`) → `ui.selection = [{entity:
   newId}]` (`:10668`) → `commit()`.

`addFramedObject` (`app.js:10363-10436`) then builds the frame, and this is the
part no other document explains:

```js
// bounding box of everything you emitted
p0 = privatePoint(minX, maxY);              // 10381  top-left
pwId = privatePoint(minX + w, maxY);        // 10382  top-right
phId = privatePoint(minX, maxY - h);        // 10383  bottom-left
state.entities[idW] = { type:'line', a:p0, b:pwId, color: CONSTRUCTION_COLOR };  // 10385
state.entities[idH] = { type:'line', a:p0, b:phId, color: CONSTRUCTION_COLOR };  // 10387
state.constraints[cH]    = { type:'horizontal',    entity: idW };               // 10389
state.constraints[cPerp] = { type:'perpendicular', line1: idW, line2: idH };    // 10391
const contours = contoursWorld.map(c => c.pts.map(pt =>
  [(pt.x - minX) / w, (maxY - pt.y) / h]));                                     // 10392
entity = { type:'art', p0, pw: pwId, ph: phId, guide:[idW, idH],
           contours, closed:[...], contourColors:[...], ratio: w / h, ... };    // 10394-10402
ensureTextAspect(entity);                                                       // 10434
```

Consequences a tool author must design around:

* **The frame is the bounding box of what you emit.** If you inset the geometry
  by half a kerf, the displayed dimension reads 0.2 mm less than the parameter
  the user typed. Make the emitted geometry span exactly `Length × Width`, and
  report the *realised* value (see §5).
* **Contours are stored normalised into the frame, Y flipped** (`:10392`).
  Rotating `p0/pw/ph` rotates the picture; **scaling** the frame stretches the
  pattern non-uniformly, and a skewed frame shears it. Any pattern whose
  absolute dimensions matter (a hinge, a slot) must therefore be regenerated
  after a frame resize, not resized. Say so in the dialog.
* **A flat object gets `w = 1` / `h = 1`** (`:10379-10380`). A group of purely
  horizontal lines gets a 1 mm tall frame — its "height" dimension is a lie.
  Never generate a degenerate axis if you plan to dimension it.
* `curveSrc` (`:10405-10418`) keeps the real nodes/handles so ungroup gives
  curves back rather than the tessellation. It is filled automatically from
  `bakeContours(..., { keepCurve: true })`, i.e. from `addFittedCurve` sources —
  another reason to prefer fitted curves over raw polylines.
* The two green guides are ordinary `line` entities, listed in `e.guide`, and
  every outbound path (CNC payload, nesting, SVG export) skips them through one
  ownership rule: `ownedGuideIds()` (`:23734-23761`) applied by
  `svgEntityAllowed()` (`:23773-23776`, used by `cncCollectItems` `:21655-21676`
  and by `exportSVG` `:23784`, which defaults `noGuides` to true). Note the
  comment at `:21668-21671`: **the colour alone must not decide** — `#00ff00` is
  also the Mark swatch, so a green line the user drew themselves is a real
  machining path, and only a green line that sits on a frame's corner pair (or
  is named in `guide`) is skipped. `removeEntity` on the group deletes its guides
  and the constraints orphaned with their points (`:2377-2398`), which is why
  replacing a re-edited group leaves no green line behind.

---

## 4. Constraints and the solver, from a tool

The solver's residual types (what you can actually constrain) are enumerated at
`app.js:3004-3155`: `coincident`, `distance`, `radius`, `horizontal`,
`vertical`, `tangent`, `midpoint`, `aspect`, `parallel`, `perpendicular`,
`angle`.

**Two ways to add a constraint, and when to use each.**

* `api.addConstraint(c, opts)` → `app.js:3738`. Validates against the duplicate
  / conflict check (`constraintBlocked`, `:3739`), assigns `c.id`, **pushes
  history unless `opts.history === false`**, calls `requestSolve()` unless
  `opts.solve === false`, then `invalidateLoops / scheduleSave / updateUI /
  render`. Correct for one constraint on user geometry. Wrong inside a loop in a
  generator: one undo step and one full solve per call.
* Writing `api.state.constraints[api.newId()] = {...}` directly. The in-app
  precedent is `toolAddText` (`app.js:11526-11535`), which builds the frame, the
  two guides, `horizontal`, `perpendicular` and the height dimension by plain
  object writes, then does a single `requestSolve(); commit();` at `:11549`.
  Use this when a tool writes several constraints at once. Delete entries the
  same way (`delete api.state.constraints[cid]`).

**Driving versus reference.** `reference: true` makes a dimension an annotation:
it is not counted as a driver anywhere. `textDimCount` (`:8976-8989`, and the
newer `framedDimCount` `:8961`) — the function that decides whether a framed
object is fully dimensioned — **skips reference dims explicitly** (`:8982`).

**The aspect lock releases itself.** Every framed object gets an `aspect`
constraint (`ensureTextAspect`, `:8934-8952`, called at `:10434`). At solve time:

```js
if (c.type === 'aspect' && textDimCount(c.entity) >= 2) aspectOff.add(cid);   // app.js:2949
```

So dimensioning both handle lines with two *driving* distances turns the ratio
lock off by itself. It is not deleted, only ignored, and the constraint panel
then shows `Text ratio (released)` (`:16499`) — a tool that does not want that
line in the panel deletes it itself (`tools/flex.js:372`).

**Horizontal is a pin.** A transform drops `horizontal`/`vertical` only for
entities in `selectedEntities()` (`xfCommit`, `:5274-5286`; `quickRotate` does
the same from `:4446`). When the user rotates a group, the **selected** thing is
the `art` entity — its owned guide line is not selected, so the guide's
`horizontal` constraint survives and the solver snaps the object back flat. If
your tool is supposed to produce something rotatable, it must delete that
constraint itself; nothing else will. `tools/flex.js:366-374` is four lines:

```js
const guides = (wrap.guide || []).map(Number);
for (const cid in cs) { const c = cs[cid];
  if ((c.type === 'horizontal' || c.type === 'vertical') && guides.indexOf(+c.entity) >= 0) delete cs[cid];
  else if (c.type === 'aspect' && +c.entity === +wrap.id) delete cs[cid]; }
```

**Count the degrees of freedom before you write.** The frame is three points =
6 unknowns. `perpendicular` removes 1, each driving `distance` removes 1.
6 − 3 = 3 → exactly x, y, θ: movable and rotatable, size locked. Add one more
driver and it is over-constrained (the solver fights itself); remove one and the
object is floppy. This is why the flex pattern dimensions *both* handle lines and
drops `horizontal`: 2 dims + perpendicular is the only combination that keeps
size honest and angle free.

**Where the dimension text lands.** `distanceGeom` (`app.js:15338-15352`) places
it along the left normal of `p1 → p2`, `(-dy, dx)/len`, at `c.offset` mm (default
26). For a frame measured top-left → top-right the normal points to +Y, so a
positive offset sits the Length text above the object; for top-left → bottom-left
it points to +X, so a **negative** offset is what puts Width outside the left
edge (`tools/flex.js:380-381`).

**`requestSolve()` may do nothing.** If the user is in manual solve mode it only
flags the document (`app.js:3379-3386`). Never rely on the solver to *make* your
geometry correct: emit it already satisfying every constraint you just wrote,
and treat the solve as a tidying pass. That is why `flex.js` emits axis-aligned
and applies the previous pose to the frame afterwards (`tools/flex.js:331-346`,
`:382`).

---

## 4b. Passive generator objects — the finger-joint pattern

If the tool's output should behave as a **pure modifier of some master geometry**
(it only changes when the master changes, never the other way round), copy
`tools/finger.js`. This is a deliberate design, not an accident: the object
carries **no constraint at all toward its master**, and all coupling runs
through the watcher. The pieces, in order:

**1. Frame points are private.** After grouping, mark the three frame points
`pr = true`:

```js
for (const pid of [wrap.p0, wrap.pw, wrap.ph]) {
  const pt = api.state.points[pid];
  if (pt) pt.pr = true;
}
```

A `pr` point is invisible, ungrabbable, skipped by Ctrl+A (`pointShown` /
`pointEditable` in app.js) but still solved and still moved with the group. It
survives save/load: `serializeState` writes the point as `[x, y, 1]` and
`loadDocument` reads the flag back. Without this, the user sees three mystery
handles and dragging one yanks other geometry through whatever pin you left.

**2. No constraint toward the master. Ever.** Not `coincident`, not a pin on a
frame corner. A two-way constraint turns every master drag into a solver fight
and every object drag into a master edit. The ONLY link is the watcher
(described next). If an older document may still carry a pin, strip it on load
in `rewatch` (`delete api.state.constraints[cid]` where the constraint touches
your frame point).

**3. The object is not body-draggable — the app enforces it for you.** In
`app.js`'s pointer-down, an entity with `e.gen && e.gen.kind` is selectable and
double-clickable but its body drag is skipped entirely. You get this for free
just by having `gen`; do not re-implement it in the tool.

**4. Following the master = the watcher, not constraints.** Register in
`apply`/`rewatch`:

```js
rewatch(api, e) {                        // called on every document load
  const m = e.gen.params.master;
  const ln = lineEnds(api, m.line);
  if (ln) api.watchGen(e.id, [ln.pa, ln.pb]);   // the master's POINTS
}
onChange(api, e) {                        // called when a solve moved them
  if (refitJoint(api, e)) api.commit();
}
```

The mechanics live in app.js's **Generator watchers** module:
`genWatchers` maps point id → entities; `solveNow` diffs watched points against
a **persistent baseline** (`genWatchBase`) that only advances when a change has
been dispatched — this is essential because a drag translates its points
directly, so a pre/post-solve diff reports "nothing changed" exactly when the
user dragged. One drag fires exactly once; depth guard 3 caps re-entrant
chains. `genWatchClear` + a `rewatch` pass run inside `loadDocument` **after**
`state` is swapped (calling `rewatch` mid-load writes into the dead previous
document — that was a real bug).

**5. The refit gate compares endpoints, not length/angle.** A pure translation
keeps length and angle; gating on those misses it. Compare the master's
endpoints against `gen.params.master.x1..y2` with a small tolerance, and when
they differ, **rewrite everything in place**:

* contours as normalised `[u, v]` from a pure `edgePath(plan)` (no entity
  removal, no re-group, no bake — one object write + one `commit()`);
* the frame points rewritten straight from the line: baseline corner on the a
  end, thickness along the normal (`flip` negates it), length along the line;
* `ratio` on the entity **and** the stored `aspect` constraint told the new
  value, or the next no-op solve shrinks the row back;
* `gen.params.master.{len,ang,span,x1..y2}` updated so the next no-change
  solve costs nothing;
* legacy-rectangle groups convert on their first refit.

**6. Frame conventions that bit us (each cost a debugging session):**

* `artContoursWorld` maps `world = p0 + u·(pw−p0) + v·(ph−p0)` — **v runs from
  p0 to ph**. If your plan's local coords put the baseline at v = 0, the refit
  writer must store `v → 1 − v/t` or the first refit flips the whole object and
  it looks misaligned with its master.
* Framer's normalisation already puts a full-span pattern into `[0,1]` — do NOT
  re-fit contours again afterwards. An old remap that assumed the group only
  covered `bmin..bmax` silently squeezed female finger joints out of phase
  while male (bmin=0, bmax=L) looked fine — the worst kind of bug: half the
  objects wrong.
* A generated art must not swallow hits by its bounding box — app.js skips
  `artInside` for `e.gen` entities, otherwise the object's box (which IS the
  master line's) makes the line unclickable. Free again, just by having `gen`.

**7. Colour is the operation, not inherited.** A modifier of a green
(construction) master line must still emit `#000000` cutting geometry —
hardcode the cutting colour in `emit` and re-assert it in the refit; do not
copy the master's colour.

Probe to copy: `testing/finger_edge_probe.js` (slices `planFingers` + `edgePath`,
asserts path properties: starts/ends on the master's ends, u never decreases,
male/female tab spans never overlap) and `testing/gen_watch_probe.js` (slices
the watcher module out of app.js; asserts direct-drag-then-noop-solve fires
exactly once). For `gen_watch_probe` style slicing, remember `Set.size`, not
`.length` — a `Set` has no `.length`, and `if (!set.length) return` silently
disables the whole dispatcher.

**8. Debugging discipline — believe the user, not your code.** When the user
says the result is wrong, it is wrong: every "impossible" report in this
section's history (flipped refit, squeezed female, k flipping between 5 and 3,
contours squashed on first refit) was first met with "the maths checks out" and
every one of them was a real bug. The probes being green proves only that the
sliced functions agree with the probe — not that the browser renders what you
computed.

* **Always hand the feature to the user to test in the browser.** Headless
  probes cannot see rendering, hit-testing, snapping, or the solver's jitter.
  The owner tests; you iterate.
* **When something smells wrong, add a `console.log` of the actual numbers**
  (inputs and outputs of the plan/refit — lengths, offsets, k, cell, tab
  ranges) and ask the user to paste the console line plus a screenshot. One
  logged line instantly separates "calculation wrong" from "calculation right
  but render/refit wrong" — the finger joint needed exactly this split after
  three rounds of guessing.
* **Remember solver jitter.** A "100 mm" line can really be 100.05 or 99.95
  (snap + solve). Any formula that sits on a rounding boundary against the
  line length will flip discontinuously as the user drags. Round the count
  first, then derive the rest (`n = round(inner/fw); k = 2*floor(n/2)+1`), and
  never branch on `len` equality.
* **Frame must equal the bake bbox — in the refit too, with the same
  normalisation.** Create-time contours are normalised to the bbox of what was
  emitted; if the refit writer normalises over a different span (the full line
  when the bbox is only the inner span) the picture squashes on the first
  refit while the plan logs identical numbers. Normalise over the same span
  the frame covers, and derive the frame FROM the emitted bbox
  (`tabs[0][0] .. tabs[last][1]`), never from a parameter like the inner span.
* Old objects keep their own `gen.params` — a stale joint refits with its own
  stored settings, not the dialog's last values. Before hunting a bug, confirm
  the object under test was created with the current code; ask the user to
  delete and recreate it.

---

## 5. Geometry conventions that are not optional

* **World millimetres, Y down** (screen/SVG/KaryaCNC convention): +X right, +Y
  down, `w2s`/`s2w` are a plain zoom+offset with no negation.
* **Colour is the machining operation**, not decoration — `app.js:48-57`:
  `#000000` cut, `#0000ff` engrave, `#00ffff` v-carve, `#800080` pocket,
  `#ff0000` marking line (low power, does not cut through; there is no drill
  colour — a drilled hole is a black cut circle), `#00ff00` mark/construction
  (`CONSTRUCTION_COLOR`,
  `:10271`), `#800000` cut tab, `#008080` start point. Use `api.ui.color` for
  real geometry (the user's current pick) and never green for anything that
  should be cut.
* **Tolerances you should use rather than invent:**
  `settings.bakeJoinTol` (labelled *Chain tolerance*, default 0.1 mm,
  `app.js:1173`) drives grouping/offset welding via `BAKE_JOIN_TOL` (`:1330`,
  used at `:10545`); `settings.joinTol` (*Join tolerance*, default 0.1 mm,
  `:1176`) is the CNC joint tolerance used when reading sources (`:18725`).
  They are two different settings and it is easy to grab the wrong one.
  Clipper works at `offsetScale` 1000 with `offsetPrecision` 0.001 (`:12022`).
* **Nominal in, realised out.** If you must fit an integer number of features
  into a span (columns, tabs, teeth), distribute them between the ends and
  report the pitch you actually achieved, not the one that was typed. The
  pattern must still exactly fill the frame, so the bbox and the parameter agree:
  ```js
  const span = L - 2 * margin;
  const n = Math.max(2, Math.round(span / pitch) + 1);
  const real = span / (n - 1);            // tools/flex.js:115-124
  ```
  The toast then says `25 slit columns at 2.4 mm` when 2.5 was requested.
* **Refuse, do not rescue.** A generator that silently clamps nonsense
  (`bridgePitch <= bridgeWidth`) produces geometry that looks fine on screen and
  fails on the machine. Return `{ ok:false, why }` with the numbers that would
  work, and name the alternative (`tools/flex.js:77-79` tells the user to pick
  the comb style). Plan everything before `pushHistory()` so a refusal leaves no
  half-step in the undo stack — the pattern is in `tools/paneliklan.js:199-209`.
* **Kerf is a validation input, not a shrink-wrap.** Removing `kerf/2` from every
  cut is the classic way to make a generated object measure something other than
  its parameters. Use kerf to reject a ligament the beam cannot leave behind
  (`tools/flex.js:150-151`) and to report the real ligament; let the geometry
  keep its nominal size.

---

## 6. Where the result lands

Three policies exist in the repo; pick deliberately, and never leave the object
at the world origin.

| Policy | Example | Use when |
| --- | --- | --- |
| centre of the viewport | `tools/paneliklan.js:205` (`api.s2w(api.getW()/2, api.getH()/2)`) | the tool is standalone and the document is empty or irrelevant |
| beside / racked next to the drawing | `tools/wall.js` layout rows, `tools/box.js`, `tools/paintrack.js` | the tool emits a *set* of parts that must not overlap |
| on top of the selection | `tools/flex.js:287-301` | the result belongs to a feature the user just picked |

The selection-anchored version is ten lines and worth copying:

```js
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const e of api.selectedEntities()) {
  for (const pl of api.entityWorldPolylines(e))
    for (const q of pl.pts || []) { /* accumulate */ }
}
const centre = isFinite(minX) ? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } : null;
const here = centre || api.s2w(api.getW() / 2, api.getH() / 2);
```

Filter your *own* previous output out of that bbox, or a re-edit creeps across
the canvas each time (`tools/flex.js:287-288` does exactly that for
`gen.kind === 'flex'`).

---

## 7. Re-editing without moving the object

`openGeneratorDialog` (`app.js:11615-11618`, called from the double-click handler
at `:20206-20210`) hands your `gen.params` back to `open()`. Two rules:

1. **Replace the old group inside the same history step.** By the time `apply()`
   runs, the double-clicked group is still selected. `api.removeEntity(prev.id)`
   after your `pushHistory()` and before emitting (`tools/paneliklan.js:209-218`),
   otherwise you add a second copy — and grouping would refuse anyway
   (`app.js:10616`).
2. **Keep the transform the user gave you.** Every existing tool except
   `flex.js` teleports the rebuilt object back to the view centre, because it
   re-emits geometry and lets the framer derive a fresh axis-aligned box from its
   bbox. To preserve it, capture the old frame as an origin plus two unit
   vectors *before* deleting, emit axis-aligned as always, then overwrite the
   three new frame points afterwards (`tools/flex.js:303-330` and `:382-391`):

   ```js
   const o = api.P(prev.p0), w = api.P(prev.pw), h = api.P(prev.ph);
   const A = unit(w - o);                       // length direction
   let B = orthogonalise(h - o, A); B = unit(B); // keeps a skewed frame's side
   pose = { x: o.x, y: o.y, ax: A.x, ay: A.y, bx: B.x, by: B.y };
   // ... later, after grouping and after writing the two dimensions:
   p0.x = pose.x;            p0.y = pose.y;
   pw.x = pose.x + pose.ax * L; pw.y = pose.y + pose.ay * L;
   ph.x = pose.x + pose.bx * W; ph.y = pose.y + pose.by * W;
   ```

   Because the two driving dimensions are `|p0→pw| = L` and `|p0→ph| = W`, the
   pose you write already satisfies them exactly, so the following solve is a
   no-op — which is the property that makes this work in manual solve mode too.

`api.removeEntity` also deletes the group's owned guides and any constraint
orphaned with its points (`app.js:2377-2398`), so no green line or stale
dimension survives the swap.

---

## 8. Landmines, each one verifiable

* **A stale `state`.** `state` is `let` and replaced by undo/New/load/demo; the
  api exposes it through a getter (`app.js:11567-11570`). Capturing
  `const st = api.state` at module scope means your `gen` and `name` are written
  into a dead object: the group appears, double-click does nothing. Enforced at
  `testing/tools_probe.js:115`.
* **`takeOver` depends on constraints, arcs and circles** (`app.js:10604`).
  Emit `addPanelEntity` / `addFittedCurve`, never `addCircle`, and add no
  constraint to the *source* shapes you group.
* **Coincident endpoints get welded.** `chainPolylines(..., joinTol)` inside
  `bakeContours` (`:10560`) merges a slit endpoint that lands exactly on an
  outline corner into one odd contour. Keep a real margin when the outline is
  cut (`tools/flex.js:136-144` floors it at `max(0.5, kerf)`).
* **`chainPolylines` concatenates without sewing** — two vertices up to the
  tolerance apart remain two vertices, so a chained polyline source carries a
  tiny random jog at every junction, which an offset then amplifies into waves.
  `tools/slot.js` (`stitchChains`) moves each pair to its midpoint first.
* **A spline with no handles is a polyline** and sampling it is ~12× more
  expensive than reading the tessellation you already have; flatten at a
  tolerance that matches what the machine needs, not the screen.
* **`addNote` only travels if it is selected.** A note created and not pushed
  into `ui.selection` is left behind when the group moves
  (`TOOLS.md` §5.5; the mechanism is `app.js:10624-10630`).
* **Clipper only knows inside from outside by nesting depth** (`:10572`
  `normalizeWinding`, and `wall.js`'s `signOf(loop)` = `-1` at even depth).
  Compare *signed* areas; `Math.abs` hides holes, which is already in `TOOLS.md` §8.
* **Grouping a flat object gives a 1 mm frame** (`app.js:10379-10380`) — never
  dimension an axis that has no extent.
* **Resizing the frame rescales the pattern** (`:10392`) — say so in the dialog
  if absolute dimensions matter.
* **`requestSolve()` is skipped in manual mode** (`:3379`) — never depend on the
  solver to fix what you emitted.
* **Rotating a group does not drop its guide's `horizontal`** (`:5274-5286`) —
  see §4.
* **`localStorage` can throw** (private mode, quota). Every tool wraps it in
  try/catch; copy that, do not "improve" it.
* **No work at module load.** Your file is parsed before `core.js` and `app.js`
  run (`index.html:637-647` then `core.js`, `app.js`); only `open()`/`apply()`
  may call api or core helpers.
* **`clipperLib()` may be null** (`app.js:12025`) if `tools/clipper.js` is
  missing — `slot.js` toasts `Slot needs tools/clipper.js`. Check it.

---

## 9. Testing without a browser

`TOOLS.md` §6 is the rule: probes cover the contract and the maths, and the
owner checks anything that needs eyes. Do not script a browser.

**a) Pure geometry.** Write the plan as free functions and slice them out with
brace matching — the harness is `testing/flex_probe.js:15-42` (identical in
`testing/wall_probe.js:17-56`):

```js
const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'mytool.js'), 'utf8');
const slice = (name) => { /* find "function name(", paren-match, brace-match */ };
const consts = ` const MIN_SPAN = 0.2; ... `;   // duplicate the tool's constants
const T = new Function(consts + names.map(slice).join('\n') +
  '\nreturn {' + names.join(',') + '};')();
```

The duplication is deliberate and is also a trap: if the probe's `consts` drift
from the tool's, you test a different tool. Assert **properties**, not snapshots —
for a pattern generator the ones worth writing are: degenerate inputs are
refused; every emitted span is positive and inside the object; the union of the
features covers exactly `0..W`; two alternating features never coincide; the
bounding box of everything emitted equals `L × W` to 1e-9 (this one check caught
two real bugs in `flex.js` while it was written).

Methods written inside `NS.register({...})` (like `apply`) are not `function`
declarations; `testing/wall_probe.js:38-48` has a `sliceMethod` for those.

**b) Driving `apply()` with a fake api.** When the bug lives in the emission and
grouping path, run it headless — `testing/paneliklan_apply_probe.js:38-70` is the
minimum:

```js
const NS = { register(def) { NS.def = def; }, close() {} };
const sandbox = { window: { MiniSketchTools: NS }, localStorage: { getItem: () => null, setItem: () => {} } };
const def = new Function('window', 'localStorage', src + '\nreturn window.MiniSketchTools.def;')(sandbox.window, sandbox.localStorage);
globalThis.document = { getElementById: (id) => (id in fields ? { value: String(fields[id]) } : { value: '', focus(){}, checked: false }) };
const api = { clamp, fmt, toast, s2w, getW, getH, ui: { selection: [], color: '#000000' },
  state: { entities: {}, constraints: {}, points: {} },
  pushHistory(){}, commit(){}, removeEntity(){}, cmdGroupSelection(){}, addPanelEntity(pts){...}, addPolylineEntity(pts){...} };
```

For anything involving Clipper, `testing/wall_probe.js:315-355` shows the fake
`offsetClosedChains` that calls the real `tools/clipper.js` at scale 1000 — use
`require('../tools/clipper.js')` rather than reimplementing it.

**c) Name the probe after the tool** (`testing/<id>_probe.js`) so the next agent
finds it, and make it exit non-zero on failure (`process.exit(fail ? 1 : 0)`).

---

## 10. Release checklist

Beyond `TOOLS.md` §7, the parts that are easy to miss:

- [ ] `node --check tools/<file>.js` and `node testing/<tool>_probe.js` run, and
      their output is reported verbatim; the repo-wide regression suites
      (`tools_probe.js`, `help_probe.js`, `tests/smoke.js`, other tools' probes)
      only when the owner asks for them (§0)
- [ ] `help.js`: **both** the `en` (`:206`) and `id` (`:208`) lists got a bullet
- [ ] the dialog renders as two columns — `.cnc-status` is a sibling of the
      `opt-col` inside `modal-cols`, so the guide sits to the *right* of the
      parameters, not under them (§0)
- [ ] the emitted geometry's bbox equals the parameters on screen
- [ ] nothing that must be machined is green; nothing that must not be is black
- [ ] a nonsense parameter produces a toast with numbers, not a mediocre shape
- [ ] double-click reopens with the typed values, replaces the old group, and
      (unless the tool is placement-sensitive) keeps the user's position/angle
- [ ] `gen.params` holds everything needed to rebuild without the document
      (source chains too, if the input can change — see `tools/slot.js`'s `params.src`)
- [ ] ungrouping gives back editable geometry rather than a dead tessellation
- [ ] the dialog text states the two things the user will otherwise discover by
      breaking it
- [ ] **handed to the user for a browser test round** — create, drag, reload —
      before calling it done; if anything looks off, log the numbers to the
      console and get the console line + screenshot from the user before
      changing code again (§4b.8)

---

## 11. The existing tools and what each one is the exemplar of

| Tool | id / label | Copy from it for |
| --- | --- | --- |
| `tools/finger.js` | `finger` / Finger joint | **passive modifier objects**: private frame points, no constraint to the master, watcher-driven refit, in-place contour rewrite (§4b) |
| `tools/flex.js` | `flex` / Flex pattern | frame surgery: dropping `horizontal` + `aspect`, driving dims on both guides, pose-preserving re-edit (§4, §7) |
| `tools/paneliklan.js` | `paneliklan` / Panel iklan | plan-then-history refusal (`:199-209`), replace-on-re-edit (`:209-218`), why holes must be splines not circles |
| `tools/slot.js` | `slot` / Slot | reading *any* selected path at a tolerance, `stitchChains`, Clipper offset round-trip, fitting output back to curves |
| `tools/wall.js` | `wall` / Extrude wall | rack layout beside the drawing, curvature-driven feature placement, per-sample turn maths, the living hinge this file's `flex` extracts |
| `tools/box.js` | `box` / Box maker | inside/outside sizing conventions and finger-joint tab geometry |
| `tools/gear.js` | `gear` / Gear | polar generative geometry (involute teeth, racks, pulleys) — everything from an angle loop |
| `tools/hinge.js` | `hinge` / Hinge box | constants lifted from a reference spec, and the value of a dense probe |
| `tools/slidetop.js`, `tools/pulltop.js` | `slidetop`, `pulltopduo` | multi-panel sets where one joint family is replaced by another (grooves instead of fingers) |
| `tools/paintrack.js` | `paintrack` / Paint rack | sheet/rack packing of many parts, labels per part |
| `tools/registry.js` | — | the mounting contract only; never add tool logic to it |

---

## 12. Where to look something up

| Question | Answer lives at |
| --- | --- |
| What may a tool call? | `app.js:11565-11607` (`toolApi`) |
| What does grouping really do? | `app.js:10575-10678` |
| How is the frame built and the contour stored? | `app.js:10363-10436` |
| Which constraints can the solver solve? | `app.js:3004-3155` |
| When does a lock stop applying? | `app.js:2949` (aspect), `:8982` (reference dims) |
| What colours mean what? | `app.js:48-57` |
| What tolerance does grouping weld at? | `app.js:10545`, `:1173`, `:1330` |
| How does a double click reopen a generator? | `app.js:20206-20210` → `tools/registry.js:78` |
| How does a passive modifier follow its master? | §4b — watcher module in app.js, `tools/finger.js` (`rewatch`/`onChange`/`refitJoint`/`refitInPlace`) |
| What does the machine enforce? | `testing/tools_probe.js` |
| Live, small example tool? | `tools/flex.js`, then `tools/paneliklan.js` |
