# MiniSketch — bug log

Format: Gejala → Root Cause → Impact → Fix → Test

---

## 2026-10-29 — Boolean union of 3 closed splines produces garbage / 3 fragments

### Gejala

`bool.sketch` (3 closed 3-point splines, all drawn clockwise). Select two,
Ctrl+B union → toast says "Union: 2 loops → **2 results**". One result is the
real union outline; the other is an invisible 3-point sliver (area 4.7).
Selecting the sliver and unioning with the third curve gives **3** fragments
totalling area 364, where the true union is a single loop of area ~483.

Two more symptoms found while tracing:

- Canvas startup threw `ReferenceError: ax is not defined` in `getLoops()` at
  app.js:7365, via `drawLoopFills` → `render` → `resize` → `init`. Every
  closed-spline loop failed to build, so fills silently disappeared.
- `MiniSketch.flipSpline(id)` (debug API) threw the same `ax is not defined`.

### Root Cause

Five separate defects. Numbers match the probe's report.

**1. Undeclared variables in five shoelace loops (the load-time crash).**
Five sites declared `const a = ..., b = ...` on the line above, then wrote
`ar += ax * by - bx * ay;` — referencing identifiers that exist nowhere.

| site | function |
|---|---|
| app.js:7335 | `getLoops()`, closed-spline branch |
| app.js:7365 | `getLoops()`, open-spline branch |
| app.js:11464 | `normalizeSplineWinding()` |
| app.js:11568 | `loopToBoolCommands()` area sign |
| app.js:21459 | `MiniSketch.flipSpline()` |

Because `getLoops()` threw, no spline loop ever got a `poly` or `area`. The
exception was swallowed per-call by the render loop, which is why only fills
vanished and the rest of the app worked.

**2. `loopToBoolCommands()` sent cubics with no `raw` field.**
The reverse code has two paths:

```js
if (s.raw) {
  const [p0, o, i, p3] = s.raw;
  s.a = p3; s.b = p0; s.c1 = i; s.c2 = o;   // correct
} else {
  const t = s.a; s.a = s.b; s.b = s.c2; s.c2 = s.c1; s.c1 = t;   // WRONG
}
```

The comment above the `else` branch states plainly that it "attaches each
handle to the WRONG node... exactly the mangled-curves bug on CW-drawn
loops." But `cubicSegs()` built its segments **without** `raw`, so `s.raw` was
always `undefined` and the wrong branch always ran. Every clockwise-drawn
spline entered the boolean with swapped handles.

**3. `cmdBooleanExact()`'s pre-pass indexed the selection object as an id.**

```js
for (const id in ui.selection) {
  normalizeSplineWinding(state.entities[ui.selection[id]]);
```

`ui.selection[id]` is `{kind, id}`, not a number, so
`state.entities[object]` was always `undefined`. `normalizeSplineWinding()`
returns early on a falsy argument, so this loop was a no-op.

**4. The result-normalising pass was commented out.**

```js
//for (const id in ui.selection) normalizeSplineWinding(state.entities[ui.selection[id]]);
//invalidateLoops();
```

The comment above it explains why it exists: a boolean result "can hand it
back wound clockwise... Left as-is, the very next operation reads it
inside-out and returns garbage — the 'union of a union' bug." Disabling it
restored that bug, and the stale loop cache from (4b) meant the second
operation read `loop.poly` belonging to entities that had already been
deleted.

**5. Not a defect — PathBool is not winding-sensitive.**
Ryan's hypothesis was that PathBool errors when input area is negative.
Tested directly: a `bool.sketch` union with all three inputs CW, and again
with the two-input stage reversed, both return **one** path of area 483.92
against a grid-sampled ground truth of 482.89. A two-overlapping-square test
with inputs CCW/CCW, CCW/CW and CW/CW all return 175, the correct value.
PathBool normalises internally under `FillRule.NonZero`. The garbage came
from defects 2-4 feeding it malformed geometry, not from the sign.

### Impact

- `getLoops()` threw for every closed spline from page load: no loop fills,
  no boolean, silently. Only a hard reload with the console open shows it.
- Any clockwise-drawn closed spline corrupted a boolean's input shape.
- Chaining two booleans ("union of a union") produced fragments instead of
  one loop, regardless of winding.

### Fix

```
app.js:7335, 7365, 11464, 11568, 21459
- ar += ax * by - bx * ay;
+ ar += a.x * b.y - b.x * a.y;

app.js:11521
- for (const sp of spans) segs.push({ k: 'C', a: sp[0], c1: sp[1], c2: sp[2], b: sp[3] });
+ for (const sp of spans) segs.push({ k: 'C', a: sp[0], c1: sp[1], c2: sp[2], b: sp[3], raw: sp });

app.js:11844-11849 (pre-pass)
- for (const id in ui.selection) {
-   normalizeSplineWinding(state.entities[ui.selection[id]]);
+ for (const sel of ui.selection) {
+   normalizeSplineWinding(state.entities[sel.id]);

app.js:11945-11948 (result pass, re-enabled)
- //for (const id in ui.selection) normalizeSplineWinding(state.entities[ui.selection[id]]);
- //invalidateLoops();
+ for (const s of madeIds) normalizeSplineWinding(state.entities[s]);
+ invalidateLoops();
```

Note the `raw: sp` shares the array reference with `spans`; the reverse path
reads it right after `spans` is built, and `spans` is local to
`cubicSegs()`, so no aliasing hazard.

### Test

`node testing/bool_sketch_probe.js` — replays `bool.sketch` through the real
`loopToBoolCommands` / `boolPathsToEntities` / `cmdBooleanExact`, sliced out
of app.js.

Before:

```
op1: 2 results  (9 pts area 309.8  +  3 pts area 4.7)
op2: 3 results  (221.0 + 140.6 + 4.7 = 366.3)
TRUE union area = 482.89
```

After:

```
op1: 1 result   (9 pts, area 309.75)
op2: 1 result   (15 pts, area 483.50)
TRUE union area = 482.89
```

`node testing/boolean_chain_probe.js` — 11 pass, 0 fail.

`node testing/boolean_winding_probe.js` — unions three octagons in all 8
CW/CCW input combinations, chained twice. Every combination returns one loop
of area 576.3, matching a 2000x2000 grid sample of the true union. Confirms
PathBool's output does not depend on input winding.

Manual, in the app:

1. Hard reload (Ctrl+Shift+R). Console must be clean — no
   `ax is not defined` from `getLoops`.
2. `MiniSketch.flipSpline(<id>)` on a spline must return a string status, not
   throw.
3. Open `bool.sketch`. Select two curves, Ctrl+B. Toast must read
   "Union: 2 loops → **1 result**". One outline, no sliver.
4. With that result selected, Ctrl+B against the third curve. Toast again
   "1 result"; the shape must be one continuous outline, not fragments.
5. Draw three fresh closed splines clockwise and repeat 3-4.

### Known remaining issue (not fixed here)

`cmdBooleanExact` stage 2 for **cut** and **intersection** does
`resultPaths.flat()` and re-feeds it as a single path
(app.js:11879-11881). The comment at app.js:11841 warns that packing several
rings into one path makes PathBool chain them into a figure-eight with `L`
connectors. Union is unaffected. Cut/intersection of multi-part targets may
still distort; needs its own test case.
