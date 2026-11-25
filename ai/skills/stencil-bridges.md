---
name: stencil-bridges
trigger: stencil, jembatan, bridge, island, lepas, tengahnya, bolong
description: Keep letter counters (O, A, B, D, P, R, 0, 4, 6, 8, 9) attached to the stencil sheet with bridge bars: union bars+inner, then cut the union from the outer loop.
---

SKILL: STENCIL BRIDGES (jembatan stencil)

Problem: a letter with an enclosed counter (O, A, B, D, P, R, 0, 4, 6, 8, 9) leaves an
island of sheet material inside the cut. Without bridges the island falls out and the
stencil loses the letter's inside. Fix = 2-3 thin bars crossing the ring hole so the
counter stays attached to the sheet.

PROCEDURE (the proven order — do not reorder):
1. Prepare the letter loops: add_text, then text_to_curves. The result is one loop per
   contour: E = the outer contour, C = the counter (inner contour). For "O" there are
   exactly 2 loops.
2. Draw the bridge bars: add_panel with 2-3 thin rectangles (width = 2-4 mm for a
   50-100 mm letter; ask the user for material thickness if unsure). Each bar must
   CROSS the counter C completely and reach PAST the outer contour E on both ends, so
   the union genuinely overlaps both. Place bars at opposing sides (e.g. one horizontal
   upper-third, one horizontal lower-third, or one vertical + one horizontal).
3. Union bars with ALL inner objects: set_selection [C, bar1, bar2] then
   boolean union. Result U = counter + bars as ONE solid (originals are consumed).
4. Cut U out of the outer loop: set_selection [E, U] then boolean cut
   (TARGET loop FIRST, TOOL loop LAST — E is the target, U is the cutter). The result is
   the O-shaped paint hole WITH bridge gaps in it.
5. If the request includes a sheet/plate rectangle: set_selection [sheet, hole] and
   boolean cut again (sheet is the target first, hole is the tool last) so the letter
   window opens in the sheet.
6. Verify with get_loops: the counter must no longer be a separate loop from the sheet
   and the loop count must match expectation (say the count out loud in your summary).

RULES
- Letters WITHOUT enclosed counters (L, T, E, F, I, M, N...) need NO bridges — skip
  this skill for them.
- Never leave a bridge fully inside the ring hole: both bar ends must overlap past E,
  otherwise the union produces a floating island plus a bar sliver.
- Bars are part of the PAINT HOLE boundary, so paint flows around them; keep bars thin
  (2-4 mm) and few (2-3) so the letter stays readable.
- If the user says "tanpa jembatan" (no bridges), stop after step 1 and warn that the
  counter will drop out.

WORKED EXAMPLE — "buat stencil huruf O tinggi 80mm dengan jembatan"
- add_text {text:"O", height:80, color:"#000000", x:0, y:0}
- text_to_curves  -> loops E, C (describe_selection to identify outer E vs counter C)
- add_panel bars: [{x:-5,y:38},{x:105,y:38},{x:105,y:41},{x:-5,y:41}] and
  [{x:-5,y:-41},{x:105,y:-41},{x:105,y:-38},{x:-5,y:-38}] (80mm letter centred at 0,0:
  bars cross the counter and poke 5mm past the outer ellipse)
- set_selection [C, bar1, bar2]; boolean union  -> U
- set_selection [E, U]; boolean cut  -> O hole with 2 bridge gaps (target E first, tool U last)
- get_loops to verify, then reply with the summary line.
