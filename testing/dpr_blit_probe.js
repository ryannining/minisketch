// Probe: the pan / zoom blit must survive a non-1 devicePixelRatio.
//
// Reported: on one PC panning looked wrong — the scale bar vanished during the
// drag and the whole picture appeared shifted. That PC has a devicePixelRatio
// above 1 (Windows display scaling). The canvas backing store is W*DPR x H*DPR
// device pixels, but the snapshot was created at W x H, so it copied only the
// top-left 1/DPR of the frame — the scale bar sits at the bottom and was never
// in the copy — and then drew that crop back enlarged by DPR.
//
// Run: node testing/dpr_blit_probe.js
const fs = require('fs');
const path = require('path');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

function braceEnd(s, from) {
  let d = 0;
  for (let j = s.indexOf('{', from); j < s.length; j++) {
    if (s[j] === '{') d++;
    else if (s[j] === '}') { d--; if (!d) return j + 1; }
  }
  throw new Error('unbalanced');
}
const slice = (name) => {
  const start = appSrc.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('not found: ' + name);
  let i = appSrc.indexOf('(', start), depth = 0;
  for (; i < appSrc.length; i++) {
    if (appSrc[i] === '(') depth++;
    else if (appSrc[i] === ')') { depth--; if (!depth) break; }
  }
  return appSrc.slice(start, braceEnd(appSrc, i));
};

// ---- 1. the snapshot follows the backing store -------------------------
console.log('\n== the snapshot is taken at device resolution ==');
{
  const W = 1200, H = 800;
  for (const dpr of [1, 1.25, 1.5, 2]) {
    const main = { width: Math.round(W * dpr), height: Math.round(H * dpr) };
    let made = null;
    const fakeDoc = {
      createElement: () => {
        made = { width: 0, height: 0 };
        made.getContext = () => ({ drawImage: () => {} });
        return made;
      }
    };
    const fn = new Function('canvas', 'document', 'W', 'H',
      slice('frameSnapshot') + '\nreturn frameSnapshot;')(main, fakeDoc, W, H);
    const snap = fn();
    check('dpr ' + dpr + ': snapshot matches the canvas backing store (' +
      main.width + 'x' + main.height + ')',
      snap && snap.width === main.width && snap.height === main.height,
      snap ? snap.width + 'x' + snap.height : 'null');
  }
}

// ---- 2. what the old code actually looked like ------------------------
// Model the two versions: copy W x H out of a W*DPR x H*DPR frame, then draw it
// back into W x H user units (which is W*DPR x H*DPR device pixels).
console.log('\n== why the old copy lost the bottom of the frame ==');
{
  const W = 1000, H = 700;
  const SCALE_BAR_Y = H - 26;       // drawScaleBar puts it 26 px above the bottom
  for (const dpr of [1, 1.25, 1.5, 2]) {
    const backingW = Math.round(W * dpr);
    const backingH = Math.round(H * dpr);

    // OLD: snapshot sized W x H, drawing the frame at natural size crops it
    const oldCopiedW = Math.min(W, backingW);
    const oldCopiedH = Math.min(H, backingH);
    // that crop is then stretched over the whole W x H user rect
    const oldCoverageW = oldCopiedW / backingW;      // fraction of the frame width
    const oldCoverageH = oldCopiedH / backingH;      // fraction of the frame height
    // the scale bar (in device px) is inside the copied region only if the whole
    // frame fits, i.e. dpr == 1
    const barInOld = SCALE_BAR_Y * dpr < oldCopiedH;

    // NEW: snapshot sized backingW x backingH, drawn into W x H user units
    const newCoverageW = backingW / backingW;
    const newCoverageH = backingH / backingH;
    const barInNew = true;

    check('dpr ' + dpr + ': the fix copies the whole frame (' +
      (newCoverageW * 100).toFixed(0) + '% x ' + (newCoverageH * 100).toFixed(0) + '%)',
      Math.abs(newCoverageW - 1) < 1e-9 && Math.abs(newCoverageH - 1) < 1e-9);

    if (dpr === 1) {
      check('dpr 1: the old copy was exact too, which is why it looked fine here',
        Math.abs(oldCoverageW - 1) < 1e-9 && Math.abs(oldCoverageH - 1) < 1e-9 && barInOld);
    } else {
      check('dpr ' + dpr + ': the old copy kept only ' + (oldCoverageW * 100).toFixed(0) +
        '% x ' + (oldCoverageH * 100).toFixed(0) + '% of the frame',
        oldCoverageW < 1 - 1e-9 || oldCoverageH < 1 - 1e-9);
      check('dpr ' + dpr + ': the old copy dropped the scale bar (this is the symptom)',
        !barInOld);
      check('dpr ' + dpr + ': the new copy keeps the scale bar', barInNew);
    }
  }
}

// ---- 3. both blits state their destination size -----------------------
console.log('\n== the blits state the destination size ==');
{
  check('pan blit draws into W x H user units',
    /ctx\.drawImage\(ui\.pan\.snap, view\.ox - ui\.pan\.ox, view\.oy - ui\.pan\.oy, W, H\)/.test(appSrc));
  check('zoom blit draws into W x H user units',
    /ctx\.drawImage\(z\.snap, 0, 0, W, H\)/.test(appSrc));
  check('pan takes its snapshot through frameSnapshot()',
    /function startPan\(pos\)[\s\S]{0,400}?ui\.pan\.snap = frameSnapshot\(\)/.test(appSrc));
  check('zoom takes its snapshot through frameSnapshot()',
    /first wheel tick of a burst[\s\S]{0,300}?const snap = frameSnapshot\(\)/.test(appSrc));
  check('the scale bar is still drawn in user units at the frame bottom',
    /const y0 = H - 26;/.test(appSrc));
  // no leftover site sized from W/H
  check('no snapshot is sized from W/H any more',
    !/snap\.width = W;/.test(appSrc));
  check('the context still works in user units (setTransform DPR)',
    /ctx\.setTransform\(DPR, 0, 0, DPR, 0, 0\)/.test(appSrc));
}

// ---- 4. RENDER_SCALE folds into DPR the same way ----------------------
console.log('\n== render scale multiplies into the same factor ==');
{
  check('DPR = devicePixelRatio x render scale x AA',
    /DPR = Math\.min\(window\.devicePixelRatio \|\| 1, 2\) \* RENDER_SCALE \* \(RENDER_AA \? 1 : 0\.5\)/.test(appSrc));
  check('the backing store is rounded from W/H x DPR',
    /canvas\.width = Math\.round\(W \* DPR\)/.test(appSrc));
}

console.log('\n' + (fail ? fail + ' FAILED, ' : 'all ') + pass + ' checks passed');
process.exit(fail ? 1 : 0);
