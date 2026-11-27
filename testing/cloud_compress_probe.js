// Verify gzip compression + decompression in cloud/sync.js so >900KB sketches
// shrink safely under Firestore's 900KB document cap without losing geometry.
//
// Run: node testing/cloud_compress_probe.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { Bytes } = require('firebase/firestore');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log('  PASS  ' + name + (detail ? ' (' + detail + ')' : ''));
  } else {
    fail++;
    console.log('  FAIL  ' + name + (detail ? ' (' + detail + ')' : ''));
  }
}

(async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'cloud', 'sync.js'), 'utf8');
  const windowObj = {
    innerWidth: 1280,
    MiniSketchSyncBridge: null
  };
  const ctx = vm.createContext({
    window: windowObj,
    document: { currentScript: null, getElementById: () => null },
    location: { href: 'http://localhost:3000/', protocol: 'http:' },
    localStorage: {
      _m: new Map(),
      getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
      setItem(k, v) { this._m.set(k, String(v)); },
      removeItem(k) { this._m.delete(k); }
    },
    CompressionStream,
    DecompressionStream,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    btoa,
    atob,
    console,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    JSON,
    Map,
    Set,
    URL
  });
  vm.runInContext(src, ctx);
  const cloud = windowObj.MiniSketchCloud;
  check('MiniSketchCloud exposes compression helpers',
    cloud && typeof cloud.compressSketchState === 'function' && typeof cloud.decompressSketchState === 'function');

  // Build a realistic large sketch state (>1.6 MB raw JSON) with nested arrays & splines
  const entities = {};
  const points = {};
  for (let i = 0; i < 6500; i++) {
    const p1 = 'p' + (i * 2);
    const p2 = 'p' + (i * 2 + 1);
    points[p1] = { id: i * 2, x: +(Math.sin(i * 0.05) * 120).toFixed(4), y: +(Math.cos(i * 0.05) * 120).toFixed(4) };
    points[p2] = { id: i * 2 + 1, x: +(Math.sin(i * 0.05 + 0.1) * 120).toFixed(4), y: +(Math.cos(i * 0.05 + 0.1) * 120).toFixed(4) };
    entities['e' + i] = {
      id: i,
      type: i % 3 === 0 ? 'spline' : 'line',
      p1: i * 2,
      p2: i * 2 + 1,
      layer: i % 2 === 0 ? 'cut' : 'engrave',
      handles: [[0.125, -0.25], [0.75, 0.5]],
      meta: { color: '#ff3300', kerf: 0.15 }
    };
  }
  const largeState = {
    points,
    entities,
    constraints: {},
    layers: [{ id: 'cut', name: 'Cut', visible: true }, { id: 'engrave', name: 'Engrave', visible: true }],
    nextId: 20000
  };
  const rawBytes = Buffer.byteLength(JSON.stringify(largeState), 'utf8');
  check('Fixture sketch exceeds 900KB uncompressed', rawBytes > 900 * 1024, Math.round(rawBytes / 1024) + ' KB raw');

  // 1. Compress using Firestore Bytes mode
  const packedBytes = await cloud.compressSketchState(largeState, { Bytes });
  const docBytesMode = {
    id: 'active',
    name: 'Large Test',
    format: 'minisketch',
    version: 3,
    isActive: true,
    entityCount: 6500,
    state: packedBytes.state,
    view: { ox: 0, oy: 0, zoom: 1 },
    updatedAtMs: Date.now()
  };
  const estBytesMode = cloud.estimateDocBytes(docBytesMode);
  check('gzip-bytes-v1 compresses >1.6MB sketch well below 900KB',
    packedBytes.compressed && packedBytes.state._enc === 'gzip-bytes-v1' && estBytesMode < 900 * 1024,
    Math.round(rawBytes / 1024) + ' KB -> ' + Math.round(estBytesMode / 1024) + ' KB');

  const roundTripBytes = await cloud.decompressSketchState(packedBytes.state);
  check('gzip-bytes-v1 round-trip is 100% lossless',
    JSON.stringify(roundTripBytes) === JSON.stringify(largeState));

  // Simulate Firestore Bytes.toJSON() fallback decoding
  const jsonSerializedBytesState = {
    _enc: 'gzip-bytes-v1',
    rawBytes: packedBytes.rawBytes,
    gzBytes: packedBytes.gzBytes,
    data: packedBytes.state.data.toJSON()
  };
  const roundTripJsonBytes = await cloud.decompressSketchState(jsonSerializedBytesState);
  check('gzip-bytes-v1 handles toJSON() Bytes representation',
    JSON.stringify(roundTripJsonBytes) === JSON.stringify(largeState));

  // 2. Compress using base64 fallback (no Bytes class)
  const packedB64 = await cloud.compressSketchState(largeState, {});
  const estB64Mode = cloud.estimateDocBytes({ id: 'active', state: packedB64.state });
  check('gzip-b64-v1 fallback compresses below 900KB',
    packedB64.compressed && packedB64.state._enc === 'gzip-b64-v1' && estB64Mode < 900 * 1024,
    Math.round(estB64Mode / 1024) + ' KB');
  const roundTripB64 = await cloud.decompressSketchState(packedB64.state);
  check('gzip-b64-v1 round-trip is 100% lossless',
    JSON.stringify(roundTripB64) === JSON.stringify(largeState));

  // 3. Legacy uncompressed state backward compatibility
  const legacyState = { points: { p1: { id: 1, x: 10, y: 20 } }, entities: {}, nextId: 2 };
  const decodedLegacy = await cloud.decompressSketchState(legacyState);
  check('Legacy uncompressed cloud sketch state decodes unchanged',
    JSON.stringify(decodedLegacy) === JSON.stringify(legacyState));

  // 4. Tiny sketch prefers smaller representation and stays lossless
  const packedTiny = await cloud.compressSketchState(legacyState, { Bytes });
  const decodedTiny = await cloud.decompressSketchState(packedTiny.state);
  check('Tiny sketch stays lossless whether compressed or plain',
    JSON.stringify(decodedTiny) === JSON.stringify(legacyState));

  // 5. Verify Sh+F chip is not stamped onto #qb-focus while Shift+F stays in KEYMAP
  const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const shiftFLine = appSrc.split('\n').find(l => l.includes("key: 'Shift+F'")) || '';
  check('Focus KEYMAP entry omits chip/match so icon stays uncovered',
    shiftFLine.includes("label: 'Focus'") && shiftFLine.includes("match: ''") && !shiftFLine.includes('Sh+F'));

  console.log('\nTotal: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail > 0 ? 1 : 0);
})();
