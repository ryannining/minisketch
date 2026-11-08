# Final Nesting Plan — MiniSketch (GA + NFP2 lokal)

> Gabungan `nestingplan1.md`, `nestingplan2.md`, `nestingplan3.md`.
> Status: **RENCANA**, belum ada kode. Engine referensi = `nestjs2/frontend`
> (`geometry.js`, `nfp2.js`, `nfp_ga.js`).
> Simbol di bawah sudah diverifikasi ada di `app.js` (baris dari pembacaan langsung):
> `getLoops` 8606, `loopEntities` 7037, `loopShapeSelected` 7053, `pushHistory` 2305,
> `cmdClone` 11453, `cloneInstanceOffsets` 11403, `pathChainsOf` 11993,
> `rdpSimplify` 10019, `chainPolylines` (core.js 1643), `offsetChains` (tools/slot.js 132),
> `CONSTRUCTION_COLOR` 10902, `isConstructionColor` 10904, `colorOf` 1920,
> `ownedGuideIds` 25657, `updatePartsList` 18022, `updateArrayList` 18178.
> **Belum ada** `nestGroupLoops` / `nestLoopPoly` / `initNestingPanel` / `updateNestingPanel`
> di app.js — itu yang mau dibuat.

---

## 0. Keputusan final (konsensus 3 plan)

| Topik | Keputusan |
| --- | --- |
| Engine | File baru **`tools/nest.js`** (port trim `geometry.js` + `nfp2.js` + `nfp_ga.js`), classic `<script>`, murni, tanpa DOM. `window.MiniSketchNest` + guard `module.exports` untuk probe. |
| Eksekusi | **Main thread + yield**, tanpa Web Worker (app dibuka dari `file://`; Chrome blokir worker file://). Unit kerja = 1 evaluasi GA. Scheduler time-slice `setTimeout(0)`, budget ±12 ms/slice. |
| Satuan engine | **Pertahankan `GEOM_SCALE = 1000`** (int mm×1000) — plan 1 & 3 sepakat; plan 2 (mm) kalah karena mengubah formula referensi (`insideBonus = 10000 × GEOM_SCALE`, `complexityPenalty`). |
| Konvensi sheet | **`#00ff00` = sheet**, dipertahankan apa adanya (`nfp2.js` branch `lcolor`). Sama dengan `CONSTRUCTION_COLOR` MiniSketch. |
| Sheet detection | `isConstructionColor(colorOf(e))` untuk semua entity loop; **buang `ownedGuideIds()`** sebelum menentukan sheet/part. Tepat satu sheet; kalau >1 → toast & batal. |
| Compound loop | 1 objek = 1 loop outer + loop-loop di dalamnya (containment via `pointInPoly` + 1 vertex). Masters clone = entity outer + semua entity lubang. |
| Geometri part | Pakai **`loop.poly`** dari `getLoops()` langsung (`getLoops()` sudah salinan koordinat, invariant #3). Tidak ada simplify — fidelity dijamin oleh clone yang menggambar master asli. |
| Gap | Offset tiap part keluar `spacing/2` via `offsetChains` (ClipperLib, yang sudah dipakai app). Packing pakai bentuk gemuk, output pakai bentuk asli. |
| Output | **Entity clone** (`type:'array', kind:'clone'`), satu per part. Master tidak pernah digeser. Pipeline render/hit-test/save/CNC clone sudah lengkap di app.js. |
| Posisi hasil | Kanan loop hijau asli: `outX = sheetBounds.maxX + 10 mm`, `outY = sheetBounds.minY`. Unplaced di kanan blok hasil, disusun ke bawah. |
| Undo / commit | `pushHistory()` **SEKALI** di awal mutasi, `commit()` **SEKALI** di akhir (pola `runSvgImport` 1099–1138). Satu Ctrl+Z = batal seluruh hasil. |
| Safety async | `const stateAtStart = state`; cek `state !== stateAtStart` tiap yield; cek entity master masih ada sebelum buat clone. `xfBlock()` dicek di Start. |
| Prefs | `localStorage['minisketch.v1.nestPrefs']`, save-on-change (pola `saveTracePrefs`). |
| Yang tidak disentuh | `core.js`, `cmdNest` (nesting server KaryaCNC), `#btn-nest`, pick filter. |

---

## 1. Flow user

1. Pilih loop yang mau dinesting (compound loop dihitung 1 objek) + 1 loop hijau sebagai sheet.
2. Klik **Start** di panel Nesting (sidebar kanan).
3. App clone loop terpilih → jalan GA + NFP2 di main thread dengan progress bar.
4. Hasil best di-place kanan loop hijau. Tidak muat → kanan blok hasil.
5. Undo sekali = batal seluruh hasil.

---

## 2. Arsitektur

```
ui.selection
   │  nestCollectSelection()  [app.js]
   │    ├─ getLoops() × selection (via loopEntities / loopShapeSelected)
   │    ├─ buang ownedGuideIds()
   │    ├─ sheet = tepat 1 loop hijau (isConstructionColor) → { sheetLoop, sheetBounds }
   │    └─ parts: containment tree → [{ outer, holes[], entityIds[] }]
   ▼
nestBuildJob(sel)  [app.js]                    tools/nest.js
   │  per part: poly×1000 → Path(paths=[luar,…lubang], originIndex)
   │  base = clone().offset(spacing)   (ClipperLib; fallback tanpa offset bila kosong)
   │  variants = per θ ∈ rotations × flip → align() referensi
   │  sheetPath = loop hijau ×1000, lcolor '#00ff00'
   ▼
nestRun()  [app.js]  ←──────── progressHandler(done, total)
   │  for eval in popSize×(gen+1)+1:
   │     best = NFPGA._evaluate(...)           (1 eval per tick)
   │     await yieldFrame(); cek cancel & stateAtStart
   │  final = compactSolution(best)
   ▼
nestApplyResult(best)  [app.js]
   │  pushHistory() (SEKALI)
   │  per placed part  → 1 clone {masters, instances:[{m: M, a: anchor}]}
   │  per unplaced     → 1 clone di tumpukan kanan
   │  ui.selection = id clone baru; commit() (SEKALI); toast Indonesia
   ▼
worksheet: kanan loop hijau asli
```

### Matriks instance clone

Engine kerja di `loop.poly` (sampling); clone menggambar master asli via 1 matriks, jadi
fidelity kurva = fidelity master (persis cara CNC memotong flatten `loop.poly`).

```
M = S_out ∘ T(dx,dy) ∘ T(re) ∘ R(θ) ∘ [F] ∘ T(−bMin) ∘ S_in

S_in    = [1000,0,0,1000,0,0]              (mm → engine)
T(−bMin)= normalisasi bbox min-corner varian dasar (offset) → 0
R(θ)    = rotasi θ derajat
F       = flip Y di tengah bbox varian (opsional, Allow flip)
T(re)   = re-normalisasi min-corner varian hasil rotasi/flip → 0
T(dx,dy)= posisi placement engine (int engine unit)
S_out   = [1/1000,0,0,1/1000, outX, outY]  (engine → world mm)
          outX = sheetBounds.maxX + 10 mm
          outY = sheetBounds.minY
```

Komposisi via `matMul` + `matApply` dari **core.js** (konsisten dengan file testing).
Detail varian (offset, rotasi, flip, pencatatan `bMin`/`re`) ditulis sendiri di adapter —
urutan geometri identik `generatePartVariants()` referensi (offset dulu, lalu rotasi),
tapi tidak meniru quirks `align()`.

### Unplaced

Varian 0 (tanpa rotasi). `outX2 = outX + lebarTotalHasil + 10 mm`, disusun ke bawah
dengan jarak `spacing` (bbox min-corner ditempel).

---

## 3. Engine `tools/nest.js` (~1100 baris)

| Blok | Asal | Isi |
| --- | --- | --- |
| `GEOM_SCALE = 1000` | geometry.js:1 | sama |
| `class Point` | geometry.js:3 | sama |
| `class Path` | geometry.js:19 | trim: constructor, `getBounds`(+cache), `invalidateBounds`, `translate`, `rotate`, `flip`, `clone`, `align`, `offset` (ClipperLib), `static getSignedArea`. **Buang**: fromSVGPath, toSVGPath, getSVGPathData, originalPathCache, simplifyPath, removeIntersections, SAT/normals, ensureClockwise. `clone` tetap menyalin `_cachedBounds` (hot path). |
| `GeometryUtil` | geometry.js:870 | trim: `pointInPolygonOffset`, `lineSegmentsIntersectXY`, `polygonsIntersectAt` (+`insideBonus`), `polyOutsideAt`, `getHorizontalIntersections`, `compactLayout`, `distance` |
| `NFP2SpatialHash` | nfp2.js:7 | sama |
| `NFP2` | nfp2.js:85 | `findBestPosition`, `_runPlacementPasses`, `findBestNFPPlacement`, `getCandidatePositions`, `checkCollisions`, `calculateTotalBounds`, `compactSolution`. Buang: `renest`, `checkDragPlacement`. Konvensi `#00ff00` = sheet **tetap**. |
| `NFPGA` | nfp_ga.js:16 | `findBestPosition`, `_evaluate`, `_placeWithVariant`, helper permutasi. Default `popSize=6, gen=5, mutationRate=0.1`; elitism 2 + baseline descending-size dijamin ikut → GA tak pernah lebih buruk dari heuristic. |
| Ekspor | — | class/const top-level (classic script). `window.MiniSketchNest = { NFP2, NFPGA, Path, Point, GEOM_SCALE }` untuk probe. |

Konvensi dipertahankan:
- Koordinat int mm×1000.
- `#00ff00` = sheet (skip placement, jadi ukuran lembar, muncul sebagai frame di `placements`).
- `align()`: part biasa → titik kiri-bawah ke origin; sheet hijau → bounds min-corner ke origin.
- `spacing`: offset keluar `spacing/2` (ClipperOffset miter) sebelum varian.
- `insideBonus`: part muat penuh di lubang part lain (`poly2.paths.length > 1`) dapat bonus besar.
- Progress: `progressHandler(done, total)`; `total = popSize × (generations+1) + 1`.

Tanpa DOM, tanpa `performance` khusus, `Math.random` polos.

---

## 4. `app.js` — seksi Nesting (~230 baris, dekat seksi array/clone)

Fungsi:
- `nestPrefsLoad()/nestPrefsSave()` — `minisketch.v1.nestPrefs`, save on change.
- `nestCollectSelection()` — kembalikan `{ ok, sheet, parts, error }`; validasi ≥1 part,
  tepat 1 loop hijau; compound digabung; buang `ownedGuideIds()`; toast error Indonesia.
- `nestBuildJob(sel)` — bangun `{ engineParts:[{variants, originIndex, originKey, entities}],
  sheetPath, sheetWorldBounds, spacing }`. `originKey` = kunci stabil untuk mencocokkan
  hasil placement → masters.
- `nestRun()` — async; `stateAtStart` guard; per-eval yield + progress + cancel; akhir:
  `compactSolution` → `nestApplyResult`.
- `nestVariantMatrix(partRec, placement)` — matriks komposit (butuh `bMin`/`re` per varian).
- `nestApplyResult(best)` — `pushHistory()` → clone per part (placed & unplaced) →
  `ui.selection` = clone baru → `commit()` → toast ringkasan Indonesia.
- `updateNestPanel()` — dipanggil dari `updateUI()` (dekat `updateArrayList` 18178);
  signature-guard (`listUnchanged` pola); Start disabled saat running / seleksi tak valid;
  count badge = jumlah part terpilih.
- Wiring: `nest-start`, `nest-stop`, listener `change` input; di blok wiring tombol
  (~24020–24041); tanpa shortcut keyboard baru.

Interaksi **tidak** diubah: `cmdNest` (nest server), `#btn-nest`, pick filter.

---

## 5. `index.html`

1. `<script src="tools/nest.js"></script>` — setelah `tools/clipper.js` (750),
   sebelum `core.js` (767). Urutan wajib: clipper dulu (Path.offset pakai ClipperLib
   saat runtime), app.js terakhir.
2. Panel baru di `#sidebar`, setelah panel Tools (sebelum `</aside>` 354):

```html
<section class="panel" id="nest-panel">
  <h3>Nesting <span class="count" id="nest-count">0</span></h3>
  <div class="row">
    <label>Sp <input type="number" id="nest-spacing" value="2" min="0" step="0.5"></label>
    <label>Rot <select id="nest-rotation">
      <option value="0">0°</option><option value="90">90°</option>
      <option value="180">180°</option><option value="270">270°</option>
      <option value="15">15° steps</option>
    </select></label>
    <label class="check"><input type="checkbox" id="nest-flip">Flip</label>
  </div>
  <div class="row">
    <label>Pop <input type="number" id="nest-pop" value="6" min="2" max="40" step="1"></label>
    <label>Gen <input type="number" id="nest-gen" value="5" min="1" max="60" step="1"></label>
    <button class="btn primary" id="nest-start">Start</button>
    <button class="btn" id="nest-stop" hidden>Stop</button>
  </div>
  <div class="nest-progress" id="nest-progress" hidden><div class="nest-progress-fill" id="nest-progress-fill"></div></div>
  <div class="meta" id="nest-status">—</div>
</section>
```

---

## 6. `styles.css` (~12 baris, dekat blok panel 1919–1960)

```css
.nest-progress { height: 6px; border: 1px solid var(--line); border-radius: 3px; overflow: hidden; background: var(--panel-2, transparent); }
.nest-progress-fill { height: 100%; width: 0%; background: var(--accent, #2563eb); transition: width .12s linear; }
#nest-panel .row label { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; }
#nest-panel input, #nest-panel select { width: 52px; }
```

Nama var warna disesuaikan token theme yang benar-benar ada saat implementasi.

---

## 7. `help.js`

+1–2 baris bilingual (EN & ID) pada bagian panel: cara memilih loop + loop hijau,
Start/Stop, arti "tidak muat" di kanan hasil. (Help adalah deliverable — taste #64.)

---

## 8. `testing/nest_probe.js` (Node, tanpa DOM)

Pola probe existing: baca source `tools/nest.js`, `vm.runInNewContext` di sandbox.

1. **Place dasar**: kotak 40×40 ke sheet kotak 100×100 → 1 placement, tanpa overlap.
2. **Spacing**: 2 kotak 20×20, spacing 3 → jarak bbox ≥ 3 (±epsilon).
3. **Hole**: part cincin (luar + 1 lubang) + part kecil yang muat → masuk lubang (insideBonus).
4. **Sheet hijau**: Path `lcolor:'#00ff00'` menentukan ukuran lembar & tidak di-rotate.
5. **GA elitism**: fitness GA ≤ fitness baseline descending-size.
6. **compactSolution**: hasil tak menghasilkan overlap baru.
7. **Determinisme minim**: engine jalan tanpa DOM/`window`.

---

## 9. Urutan implementasi

1. Port `tools/nest.js` (trim) + `node --check` + probe dasar (1, 2, 7).
2. `index.html`: script tag + panel; `styles.css`: progress bar.
3. `app.js`: seksi Nesting — collect/build/run/apply + wiring + `updateNestPanel` + prefs.
4. `help.js`: 1–2 baris EN/ID.
5. Probe lengkap (3–6) + `node --check` semua + `node tests/smoke.js` (wajib tetap hijau).
6. Serahkan checklist testing manual ke user (bukan test sendiri — taste #32):
   - 3–4 loop + 1 kotak hijau besar → seleksi semua → Start → hasil kanan loop hijau,
     tanpa overlap, jarak antar part = Spacing.
   - Loop berlubang (kotak + circle di dalam) → 1 objek, circle ikut pindah sebagai bagian clone.
   - Part lebih besar dari lembar → tumpukan kanan hasil.
   - Undo sekali → seluruh hasil hilang, original utuh.
   - Progress bar jalan; Stop berhenti dan tetap menghasilkan best-so-far.
   - Refresh halaman → Spacing/Rotation/Flip terakhir masih terpasang.

---

## 10. Edge cases

| Kasus | Perlakuan |
| --- | --- |
| Tidak ada / >1 loop hijau di seleksi | Toast Indonesia, tidak mulai |
| Part lebih besar dari lembar | Tidak pernah dapat placement → tumpukan "tidak muat" kanan |
| Loop hijau ≠ persegi | Engine pakai bounds untuk ukuran + scanline `sheetRange` dari interseksi hijau (`lcolor` branch) — sama dengan referensi |
| `offset` Clipper kosong (part tipis + spacing besar) | Fallback varian tanpa offset (spacing efektif 0 utk part itu) |
| Master dihapus / undo saat job jalan | Guard `state !== stateAtStart` → batalkan + toast; cek `state.entities[masterId]` sebelum buat clone |
| Seleksi berubah / user mulai xf saat jalan | Job baca seleksi sekali di awal (snapshot); `xfBlock()` dicek di Start |
| Loop di layer berbeda-beda | Loop diambil dari seleksi; clone baru di `ui.activeLayer`, matriks world → aman |
| Guide hijau milik frame (text/group) | Dibuang via `ownedGuideIds()` — bukan kandidat sheet/part |
| Drawing ribuan titik (hasil trace) | Engine bekerja pada `loop.poly`; collision pakai bbox-reject + spatial hash; **tidak ada simplify** |
| Y-axis | Engine & world sama-sama Y-up; mirror hanya urusan canvas referensi — tidak diporting |
| Circle loop | `loop.poly` 72-gon → nesting pakai approx 72-gon; clone menggambar circle asli |
| Stop ditekan | Finalisasi best-so-far (elitism menjamin baseline minimal ada) |

---

## 11. Perbedaan antar plan & keputusan akhir

- **Web Worker vs main thread**: ketiganya setuju main thread + yield. `file://` = constraint keras (ARCHITECTURE.md).
- **Satuan mm vs `GEOM_SCALE=1000`**: plan 2 mengusulkan mm; plan 1 & 3 pertahankan `×1000`. **Final: `×1000`** — menghilangkan risiko mengubah formula `insideBonus`/`complexityPenalty` referensi.
- **`compactSolution`**: plan 2 buang (tidak ada renest); plan 1 & 3 pertahankan (settling hasil rapat). **Final: pertahankan**, dipanggil sekali setelah GA selesai.
- **Geometri part**: plan 2 pakai `pathChainsOf(0.05)` + `rdpSimplify(0.02)`; plan 1 & 3 pakai `loop.poly` langsung. **Final: `loop.poly` langsung** — lebih murah, tidak ada risiko simplify memakan clearance, fidelity dijamin clone.
- **Sheet space Y-down (plan 2)** vs langsung engine space (plan 1 & 3): **Final: ikut referensi** (engine space Y-up, `align()` menempatkan frame di (0,0)); konjugasi world hanya translasi `(outX, outY)`. Lebih sedikit lapisan.
- **Panel UI**: plan 2 lebih kaya (daftar objek + preview bbox + Quality preset + Clear result). **Final: minimal dulu** (plan 1/3), tambah kemudian kalau owner minta.
- **Qty per objek**: tidak ada di v1 (plan 2). Struktur `instances` clone sudah siap untuk qty nanti.
- **Frame lembar hijau di output**: plan 1 & 3 opsional. **Final: tidak dibuat** — mengurangi kebisingan; owner sudah punya loop hijau asli sebagai acuan.

---

## 12. Out of scope

- Web Worker / Blob-worker (kalau suatu saat butuh evaluasi raksasa).
- Renest parsial, drag-and-drop hasil dengan validasi `checkDragPlacement`, infinite-loop nesting.
- Multi-lembar / optimasi jumlah lembar.
- Menggantikan alur nest server lama (`#btn-nest` / `nestUpload`) — tetap ada.
- Qty per objek, preview layout sebelum commit.
