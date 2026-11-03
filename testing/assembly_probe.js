// Geometry probe for the assembly solver in core.js. Run: node testing/assembly_probe.js
// The assembly math lives in core.js (pure, exported), so this probe just
// requires it — no source slicing needed.
//
// Two conventions mirror how app.js uses the solver:
//  - the user grounds base parts (their double-marker weld = `grounded: true`);
//  - drags solve incrementally: the target moves in small steps and every
//    solve warm-starts from the previous poses.
'use strict';

const C = require('../core.js');
let failures = 0;

function ok(cond, label) {
  if (cond) {
    console.log('  ok  ' + label);
  } else {
    failures++;
    console.log('  FAIL ' + label);
  }
}

function close(a, b, tol, label) {
  ok(Math.abs(a - b) <= tol, label + ' (' + a + ' vs ' + b + ')');
}

function poseOf(result, id) {
  const p = result.poses.get(id);
  if (!p) {
    ok(false, 'part ' + id + ' missing from the result');
    return { tx: NaN, ty: NaN, rot: NaN };
  }
  return p;
}

// Drag simulation: move the target from `start` to `to` in small steps,
// feeding every result back as the next warm start. Mirrors pointermove.
function solveDrag(parts, mates, target, to, steps) {
  const n = steps || 12;
  const current = parts.map(p => ({ ...p }));
  const startRef = target.start || to;
  let last = null;
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    const toK = {
      x: startRef.x + (to.x - startRef.x) * t,
      y: startRef.y + (to.y - startRef.y) * t
    };
    const poses = current.map(p => ({ ...p }));
    const tgt = [{ part: target.part, ref: target.ref, origin: target.origin, to: toK }];
    last = C.solveAssembly(poses, mates, tgt);
    last.poses.forEach((pose, id) => {
      const rec = current.find(p => p.id === id);
      if (rec) { rec.tx = pose.tx; rec.ty = pose.ty; rec.rot = pose.rot; }
    });
  }
  return last;
}

// --- helpers ------------------------------------------------------------
console.log('partTransform / partMarkerWorld');
{
  const m = C.partTransform({ tx: 10, ty: 20, rot: 90 });
  const p = C.matApply(m, { x: 3, y: 0 });
  close(p.x, 10, 1e-9, 'rotate 90 then translate maps (3,0) to (10,23)');
  close(p.y, 23, 1e-9, 'rotate 90 then translate maps (3,0) to (10,23)');
  const q = C.partMarkerWorld({ tx: 5, ty: -1, rot: 0 }, { u: 2, v: 3 });
  close(q.x, 7, 1e-9, 'partMarkerWorld, identity rotation');
  close(q.y, 2, 1e-9, 'partMarkerWorld, identity rotation');
}

// --- spectator parts never move -----------------------------------------
console.log('spectator part (no residual touches it)');
{
  const parts = [
    { id: 'base', tx: 0, ty: 0, rot: 0, grounded: true },
    { id: 'bystander', tx: 50, ty: 40, rot: 17 }
  ];
  const mates = [];
  const tgt = [{ part: 'base', ref: { u: 0, v: 0 }, to: { x: 99, y: 99 } }];
  const r = C.solveAssembly(parts, mates, tgt);
  const z = poseOf(r, 'bystander');
  close(z.tx, 50, 1e-12, 'unmated part keeps tx exactly');
  close(z.ty, 40, 1e-12, 'unmated part keeps ty exactly');
  close(z.rot, 17, 1e-12, 'unmated part keeps rot exactly');
}

// --- pin joint ----------------------------------------------------------
console.log('pin joint (grounded base, incremental drag)');
{
  // bar A is grounded; bar B is pinned to it at A(10,0) = B(0,0)
  const mk = (id, tx, rot, grounded) => ({ id, tx, ty: 0, rot, grounded: !!grounded });
  const parts0 = [mk('A', 0, 0, true), mk('B', 10, 0, false)];
  const mates = [{
    type: 'pin',
    a: { part: 'A', u: 10, v: 0 },
    b: { part: 'B', u: 0, v: 0 }
  }];

  // drag B's free end from where it sits (20,0) up to (10,10): B pivots 90
  // degrees about the pin; A never moves (it is the ground)
  const r = solveDrag(parts0, mates,
    { part: 'B', ref: { u: 10, v: 0 }, start: { x: 20, y: 0 } },
    { x: 10, y: 10 });
  const A = poseOf(r, 'A');
  const B = poseOf(r, 'B');
  close(A.tx, 0, 1e-9, 'grounded base stays put');
  const jA = C.partMarkerWorld({ tx: 0, ty: 0, rot: 0 }, { u: 10, v: 0 });
  const jB = C.partMarkerWorld(B, { u: 0, v: 0 });
  close(jB.x - jA.x, 0, 1e-3, 'pin stays closed (x)');
  close(jB.y - jA.y, 0, 1e-3, 'pin stays closed (y)');
  close(B.tx, 10, 1e-2, 'driven bar pivots about the pin (tx)');
  close(B.ty, 0, 1e-2, 'driven bar pivots about the pin (ty)');
  close(((B.rot % 360) + 360) % 360, 90, 1e-2, 'driven bar pivots 90 degrees');

  // a cold solve with both parts dragged together: the joint stays closed
  const parts2 = [mk('A', 0, 0, false), mk('B', 10, 0, false)];
  const tgt2 = [
    { part: 'A', ref: { u: 10, v: 0 }, to: { x: 4, y: 3 } },
    { part: 'B', ref: { u: 0, v: 0 }, to: { x: 4, y: 3 } }
  ];
  const r2 = C.solveAssembly(parts2, mates, tgt2);
  const jB2 = C.partMarkerWorld(poseOf(r2, 'B'), { u: 0, v: 0 });
  const jA2 = C.partMarkerWorld(poseOf(r2, 'A'), { u: 10, v: 0 });
  close(jB2.x - jA2.x, 0, 1e-4, 'both parts dragged together stay closed (x)');
  close(jB2.y - jA2.y, 0, 1e-4, 'both parts dragged together stay closed (y)');
}

// --- pure constraint solve (no targets) ----------------------------------
console.log('mate repair (no target)');
{
  // B was moved 10mm off its pin; a target-free solve must snap it back
  const parts = [
    { id: 'A', tx: 0, ty: 0, rot: 0, grounded: true },
    { id: 'B', tx: 20, ty: 0, rot: 0 }
  ];
  const mates = [{ type: 'pin', a: { part: 'A', u: 10, v: 0 }, b: { part: 'B', u: 0, v: 0 } }];
  const r = C.solveAssembly(parts, mates, []);
  const B = poseOf(r, 'B');
  const jB = C.partMarkerWorld(B, { u: 0, v: 0 });
  close(jB.x, 10, 1e-3, 'displaced bar snaps back onto its pin (x)');
  close(jB.y, 0, 1e-3, 'displaced bar snaps back onto its pin (y)');
  ok(r.cost < 1e-6, 'repair lands on an exact solution (cost ' + r.cost + ')');
}

// --- slider joint -------------------------------------------------------
console.log('slider joint');
{
  // grounded rail from (0,0) to (40,0); block A rides it via its marker
  const parts = [
    { id: 'rail', tx: 0, ty: 0, rot: 0, grounded: true },
    { id: 'A', tx: 5, ty: 0, rot: 0 }
  ];
  const mates = [{
    type: 'slider',
    a: { part: 'A', u: 0, v: 0 },
    b: { part: 'rail', u1: 0, v1: 0, u2: 40, v2: 0 }
  }];

  // slide A along the rail
  const tgt = [{ part: 'A', ref: { u: 0, v: 0 }, to: { x: 12, y: 0 } }];
  const r = C.solveAssembly(parts, mates, tgt);
  const A = poseOf(r, 'A');
  close(A.ty, 0, 1e-4, 'marker pulled along the rail keeps y = 0');
  close(A.tx, 12, 1e-4, 'marker slides to the target along the rail');
  close(A.rot, 0, 1e-6, 'straight pull along the rail does not rotate the part');

  // pulling the marker off the rail (incrementally): it must land back ON the
  // rail line, as far along as the pull allows
  const r2 = solveDrag(parts, mates,
    { part: 'A', ref: { u: 0, v: 0 }, start: { x: 5, y: 0 } },
    { x: 20, y: 6 });
  const A2 = poseOf(r2, 'A');
  const P = C.partMarkerWorld(A2, { u: 0, v: 0 });
  close(P.y, 0, 1e-3, 'pulled off-line, the marker stays on the rail line (y = 0)');
  close(P.x, 20, 1e-2, 'pulled off-line, the marker still reaches along the rail (x)');
  close(A2.rot, 0, 1e-3, 'translation alone satisfies the rail (no rotation)');
}

// --- ground -------------------------------------------------------------
console.log('grounded part');
{
  const parts = [
    { id: 'base', tx: 0, ty: 0, rot: 0, grounded: true },
    { id: 'arm', tx: 10, ty: 0, rot: 0 }
  ];
  const mates = [{ type: 'pin', a: { part: 'base', u: 10, v: 0 }, b: { part: 'arm', u: 0, v: 0 } }];
  // a target on the ground itself: the base cannot comply and nothing may move
  const tgt = [{ part: 'base', ref: { u: 10, v: 0 }, to: { x: 50, y: 50 } }];
  const r = C.solveAssembly(parts, mates, tgt);
  const base = poseOf(r, 'base');
  close(base.tx, 0, 1e-12, 'grounded part never moves (tx)');
  close(base.ty, 0, 1e-12, 'grounded part never moves (ty)');
  close(base.rot, 0, 1e-12, 'grounded part never moves (rot)');
  // the arm is still pinned to the base: it must NOT follow the phantom target
  const arm = poseOf(r, 'arm');
  const jB = C.partMarkerWorld(arm, { u: 0, v: 0 });
  close(jB.x, 10, 1e-6, 'arm stays pinned to the unmoved base (x)');
  close(jB.y, 0, 1e-6, 'arm stays pinned to the unmoved base (y)');
}

// --- open chain, drag propagates through pins ---------------------------
console.log('chain drag propagation (A-B-C pinned to grounded D)');
{
  // A--B--C--D with D grounded; drag A's free end to (10,0) — 20mm from D, so
  // the 30mm chain reaches with an elbow, joints closed all the way.
  const mk = (id, tx, grounded) => ({ id, tx, ty: 0, rot: 0, grounded: !!grounded });
  const parts0 = [mk('A', 0), mk('B', 10), mk('C', 20), mk('D', 30, true)];
  const mates = [
    { type: 'pin', a: { part: 'A', u: 10, v: 0 }, b: { part: 'B', u: 0, v: 0 } },
    { type: 'pin', a: { part: 'B', u: 10, v: 0 }, b: { part: 'C', u: 0, v: 0 } },
    { type: 'pin', a: { part: 'C', u: 10, v: 0 }, b: { part: 'D', u: 0, v: 0 } }
  ];

  const r = solveDrag(parts0, mates,
    { part: 'A', ref: { u: 0, v: 0 }, start: { x: 0, y: 0 } },
    { x: 10, y: 0 }, 16);
  const chain = ['A', 'B', 'C', 'D'].map(id => poseOf(r, id));
  for (let k = 0; k < 3; k++) {
    const jA = C.partMarkerWorld(chain[k], { u: 10, v: 0 });
    const jB = C.partMarkerWorld(chain[k + 1], { u: 0, v: 0 });
    close(jA.x - jB.x, 0, 1e-2, 'pin ' + k + ' stays closed (x)');
    close(jA.y - jB.y, 0, 1e-2, 'pin ' + k + ' stays closed (y)');
  }
  // each bar is rigid: its length must stay 10
  for (let k = 0; k < 4; k++) {
    const p = C.partMarkerWorld(chain[k], { u: 10, v: 0 });
    const q = C.partMarkerWorld(chain[k], { u: 0, v: 0 });
    close(Math.hypot(p.x - q.x, p.y - q.y), 10, 1e-3, 'bar ' + k + ' stays rigid (10mm)');
  }
  // the free end reached the target; the ground never moved
  const tip = C.partMarkerWorld(chain[0], { u: 0, v: 0 });
  close(tip.x, 10, 1e-1, 'drag propagates: the free end reached the target');
  close(tip.y, 0, 1e-1, 'drag propagates: the free end reached the target (y)');
  close(chain[3].tx, 30, 1e-9, 'grounded end stays put');
}

// --- string mate (display-only measuring thread) --------------------------
console.log('string mate (display only, never moves a part)');
{
  // two grounded posts 40mm apart, a free block between them; the string runs
  // from post 1 to the block and was recorded at 20mm.
  const parts = [
    { id: 'p1', tx: 0, ty: 0, rot: 0, grounded: true },
    { id: 'p2', tx: 40, ty: 0, rot: 0, grounded: true },
    { id: 'block', tx: 20, ty: 0, rot: 0 }
  ];
  const mates = [{
    type: 'string',
    a: { part: 'p1', u: 0, v: 0 },
    b: { part: 'block', u: 0, v: 0 },
    len: 20
  }];

  // 1. the string is NOT a joint: a target-free solve changes nothing, even
  //    though the block sits 14mm from the post (well off the 20mm rest)
  const r0 = C.solveAssembly(parts, mates, []);
  const b0 = poseOf(r0, 'block');
  close(b0.tx, 20, 1e-12, 'a string never pulls: untouched block keeps tx exactly');
  close(b0.ty, 0, 1e-12, 'a string never pulls: untouched block keeps ty exactly');
  close(b0.rot, 0, 1e-12, 'a string never pulls: untouched block keeps rot exactly');

  // 2. dragged THROUGH a string-only assembly the block follows the target
  //    exactly — the thread measures the move but never fights it
  const r1 = C.solveAssembly(parts, mates,
    [{ part: 'block', ref: { u: 0, v: 0 }, to: { x: 35, y: 7 } }]);
  const b1 = poseOf(r1, 'block');
  const d1 = C.partMarkerWorld(b1, { u: 0, v: 0 });
  close(d1.x, 35, 1e-4, 'drag over a string: the block reaches the target exactly (x)');
  close(d1.y, 7, 1e-4, 'drag over a string: the block reaches the target exactly (y)');

  // 3. a block with NO target and NO other mate stays put too (spectator rule
  //    holds even though a string names it)
  const moved = [parts[0], parts[1], { id: 'block', tx: 31, ty: -5, rot: 12 }];
  const r2 = C.solveAssembly(moved, mates, []);
  const b2 = poseOf(r2, 'block');
  close(b2.tx, 31, 1e-12, 'string-named spectator keeps tx exactly');
  close(b2.ty, -5, 1e-12, 'string-named spectator keeps ty exactly');
  close(b2.rot, 12, 1e-12, 'string-named spectator keeps rot exactly');
}

// --- over-constrained: least squares, no NaN -----------------------------
console.log('over-constrained assembly');
{
  // both ends of one 10mm bar pinned to two grounded points 8mm apart — no
  // exact solution exists; the solver must still answer, and the answer must
  // be the least-squares compromise (both pins share the residual evenly).
  const parts = [
    { id: 'bar', tx: 0, ty: 0, rot: 0 },
    { id: 'p1', tx: 0, ty: 0, rot: 0, grounded: true },
    { id: 'p2', tx: 8, ty: 0, rot: 0, grounded: true }
  ];
  const mates = [
    { type: 'pin', a: { part: 'bar', u: 0, v: 0 }, b: { part: 'p1', u: 0, v: 0 } },
    { type: 'pin', a: { part: 'bar', u: 10, v: 0 }, b: { part: 'p2', u: 0, v: 0 } }
  ];
  const r = C.solveAssembly(parts, mates, []);
  ok(Number.isFinite(r.cost), 'over-constrained solve returns a finite cost');
  ok(r.cost > 1e-6, 'an impossible pin pair leaves residual (cost ' + r.cost.toFixed(4) + ')');
  const bar = poseOf(r, 'bar');
  const j1 = C.partMarkerWorld(bar, { u: 0, v: 0 });
  const j2 = C.partMarkerWorld(bar, { u: 10, v: 0 });
  const e1 = Math.hypot(j1.x - 0, j1.y - 0);
  const e2 = Math.hypot(j2.x - 8, j2.y - 0);
  close(e1, e2, 1e-3, 'the two pin errors are equal (least-squares compromise)');
}

// --- slider + pin chain (crank-slider sanity) ---------------------------
console.log('crank-slider chain');
{
  // ground carries a vertical rail; a slider block rides it and an arm is
  // pinned to the block. Dragging the arm's end upward must move the block
  // along the rail only.
  const parts0 = [
    { id: 'rail', tx: 0, ty: 0, rot: 0, grounded: true },
    { id: 'block', tx: 0, ty: 0, rot: 0 },
    { id: 'arm', tx: 0, ty: 0, rot: 0 }
  ];
  const mates = [
    { type: 'slider', a: { part: 'block', u: 0, v: 0 }, b: { part: 'rail', u1: 0, v1: 0, u2: 0, v2: 30 } },
    { type: 'pin', a: { part: 'arm', u: 0, v: 0 }, b: { part: 'block', u: 0, v: 0 } }
  ];
  const r = solveDrag(parts0, mates,
    { part: 'arm', ref: { u: 8, v: 0 }, start: { x: 8, y: 0 } },
    { x: 8, y: 9 });
  const block = poseOf(r, 'block');
  close(block.tx, 0, 1e-2, 'block stays on the vertical rail (tx = 0)');
  close(block.ty, 9, 1e-1, 'block slid up to keep the arm end at (8,9)');
  const arm = poseOf(r, 'arm');
  close(((arm.rot % 360) + 360) % 360, 0, 1e-1, 'arm stays level when dragged vertically');
  const end = C.partMarkerWorld(arm, { u: 8, v: 0 });
  close(end.x, 8, 1e-2, 'arm end reached the target (x)');
  close(end.y, 9, 1e-1, 'arm end reached the target (y)');
}

console.log(failures ? '\n' + failures + ' FAILURES' : '\nall assembly solver tests passed');
process.exit(failures ? 1 : 0);
