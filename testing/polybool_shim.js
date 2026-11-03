// Shared shim for probes: the same polygon boolean the app exposes as
// api.polyBoolOp, built straight on the vendored PathBool ESM build. Probes
// cannot reach into app.js's IIFE, so the stubbed api gets this instead.
'use strict';
const path = require('path');
const PB = require(path.join(__dirname, '..', 'tools', 'path-bool.esm.js'));
const { signedAreaPts, pointInPoly } = require(path.join(__dirname, '..', 'core.js'));

function polyBoolOp(op, subjectRings, clipRings) {
  const subject = (subjectRings || []).filter(r => r && r.length >= 3);
  const clips = (clipRings || []).filter(r => r && r.length >= 3);
  if (!subject.length) return [];
  if (op !== 'union' && op !== 'difference' && op !== 'intersection') return null;
  const dedup = (pts) => {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const last = out[out.length - 1];
      if (Math.hypot(pts[i].x - last.x, pts[i].y - last.y) > 1e-9) out.push(pts[i]);
    }
    return out;
  };
  const toPath = (rings) => {
    const cmds = [];
    for (const r of rings) {
      cmds.push(['M', [r[0].x, r[0].y]]);
      for (let i = 1; i < r.length; i++) cmds.push(['L', [r[i].x, r[i].y]]);
      cmds.push(['Z']);
    }
    return [...PB.pathFromCommands(cmds)];
  };
  const opMap = {
    union: PB.PathBooleanOperation.Union,
    difference: PB.PathBooleanOperation.Difference,
    intersection: PB.PathBooleanOperation.Intersection
  };
  const inputs = [{ path: toPath(subject), fillRule: PB.FillRule.NonZero }];
  if (op !== 'union' && clips.length) {
    inputs.push({ path: toPath(clips), fillRule: PB.FillRule.NonZero });
  }
  const res = new PB.PathBoolean(inputs).get(opMap[op]);
  const rings = [];
  for (const p of res) {
    let cur = null;
    for (const seg of p) {
      const st = seg[1];
      const en = seg[0] === 'L' ? seg[2]
        : seg[0] === 'C' ? seg[4]
        : seg[0] === 'Q' ? seg[3] : seg[7];
      if (!cur || Math.hypot(cur[cur.length - 1].x - st[0], cur[cur.length - 1].y - st[1]) > 1e-6) {
        if (cur) rings.push(cur);
        cur = [{ x: st[0], y: st[1] }];
      }
      cur.push({ x: en[0], y: en[1] });
    }
    if (cur) rings.push(cur);
  }
  return rings
    .map(dedup)
    .filter(r => r.length >= 3 && Math.abs(signedAreaPts(r)) > 1e-6)
    .map(r => {
      // Clipper convention: outer positive, holes negative
      const area = signedAreaPts(r);
      const holes = rings.filter(o => o !== r && Math.abs(signedAreaPts(o)) > Math.abs(area) &&
        pointInPoly(r[0], o)).length;
      if ((holes % 2 === 0) !== area > 0) r = r.slice().reverse();
      return r;
    });
}

module.exports = { polyBoolOp };
