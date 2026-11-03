# Agent rules for MiniSketch — read before doing anything

One rule binds every agent that works on this repo, in every context (the
in-app AI chat, tool authoring, bug fixes, probes):

## Testing is the owner's job, not yours

MiniSketch is a browser app the owner uses by hand: rendering, hit-testing,
snapping, dragging, solver jitter — none of that is observable from Node
probes. So:

1. **Do not test the UI yourself.** Do not drive a browser, script
   screenshots, or reason about pixels. `.commandcode/settings.json` allows
   exactly four checks (`node --check`, `tests/smoke.js`, `tools_probe.js`,
   `assembly_probe.js`) — the contract and the math, nothing visual.
2. **When the owner reports a bug, your job is to fix it — then let the owner
   verify.** Never argue the report away ("the maths checks out"). Every
   "impossible" report has been a real bug; probes being green only proves the
   sliced function agrees with the probe, not that the browser does what the
   owner sees.
3. **A fix is not done until the owner has tested it in the browser.** Hand the
   feature back with a precise test recipe: what to draw, what to drag, what
   numbers to read (status bar `frame / draw ms`, size readouts).
4. **If a bug does not reproduce from reading the code, instrument instead of
   guessing.** Add a `console.log` of the actual numbers (inputs and outputs of
   the plan/refit/logic), ask the owner to paste the console line plus a
   screenshot. One logged line splits "calculation wrong" from "calculation
   right but render wrong" — own the cost: ask, don't speculate. A
   breakpoint at the suspicious line is equally acceptable when the owner
   prefers it.
5. **When the owner proposes a fix, hear it first.** The owner is a decades
   experienced programmer who has been stuck on this codebase for days. If you
   disagree, discuss — do not silently "improve" their solution and do not
   burn the session reconstructing their probe plumbing.

## Rounds, not marathons

- Never spend a whole session self-debugging. If a step needs eyes or a repro,
  ask. The owner would rather give you a one-line hint than watch you thrash.
- Fix forward; do not re-do wholesale.

## Where this is written

| File | Scope |
| --- | --- |
| `agents.md` (this file) | every agent, all work |
| `createtools.md` §8 | tool authoring |
| `TOOLS.md` §6 / §7 | tool testing checklist |
| `ARCHITECTURE.md` §Testing | repo-wide browser test policy |
| `ai/system-prompt.txt` §VERIFY-THEN-STOP | in-app AI chat loop |
| `ai/chat.js` feedback string | in-app AI chat loop implementation |
