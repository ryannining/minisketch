# Rencana Fitur Nesting MiniSketch — jendela Nesting + Clone + GA/NFP2

> Status: ANALISA & PLAN (belum implementasi). Output analisa saja — tidak ada file lain yang diubah.
> Independen dari `nestingplan1.md` / analisa AI lain. Semua referensi `app.js:…` diverifikasi dari
> pembacaan langsung file di runtime, bukan dari plan lain.

---

## Flow yang diminta (ringkas)

1. User pilih **loop-loop yang mau dinesting** (loop compound = luar + lubang-lubang di dalamnya
   dihitung **1 objek**), plus **1 loop dengan garis hijau** sebagai penanda **lembar (sheet)**.
2. User klik **Start** di panel **Nesting** yang baru di sidebar kanan (`#sidebar`).
3. App **meng-clone** setiap loop terpilih menjadi entity clone (original tidak disentuh),
   lalu menjalankan **GA + NFP2 di background** dengan **progress bar**.
4. Hasil **best** langsung di-place ke worksheet **di sebelah kanan** lokasi loop hijau aslinya.
5. Part yang **tidak muat** di-lembar di-place **di sebelah kanan output best** (kolom tumpukan).

---

## Keputusan utama (dan alasan)

| Keputusan | Jawaban | Alasan |
| --- | --- | --- |
| Engine | Port `nfp_ga.js` + `nfp2.js` + subset `geometry.js` dari karyacnc, jadi `tools/nest.js` | Algoritma yang user pakai sehari-hari; bukan reinvent |
| Eksekusi | **Main thread + yield antar evaluasi GA**, BUKAN Web Worker | `file://` blocking (ARCHITECTURE.md "hard constraint"). Unit kerja GA natural per-`_evaluate()` → `await nextFrame()` antar eval: UI responsif, progress mulus, Stop bisa dicek |
| Hasil nesting di worksheet | Entity **clone** per part (`type:'array', kind:'clone'`) | reuse penuh pipeline: render, hit-test, bounds, save/load, CNC, R-rotate, duplicate — sudah lengkap (patokan baris app.js di bawah) |
| Loop hijau | entity entity warna `#00ff00` = `CONSTRUCTION_COLOR` (app.js:10902), tapi **bukan** guide punya framed object | Pakai `ownedGuideIds()` (25657) untuk membuang guide, bukan warna saja |
| Posisi output | Kanan bounds loop hijau asli; unmuanut di kanan itu | Sesuai permintaan |
| Compound loop | Deteksi containment: loop kecil yang seluruh vertex-nya di dalam loop terpilih lain → jadi lubang part induk (1 objek, 1 clone, masters = semua entity induk + lubang) | Sesuai permintaan + adapter `childIndex` engine dikerjakan tanpa perlu parse SVG |

---

## Riset integrasi app.js (tempat hook)

### Loops
- `getLoops()` (8606–8931) — cache seluruh dokumentasi loop. Bentuk:
  - `{ poly, area, steps }` — rantai line/arc/spline; `steps[].edge.entity` = id entity.
  - `{ circle:true, entity, poly(72-gon), area }` — circle entity.
  - `{ poly, area, steps:[], splineEntity }` — spline tertutup.
- `poly` **sudah salinan koordinat** (invariant ARCHITECTURE #3) → aman dipakai engine.
- `loopEntities(loop)` (7037) — semua id entity pembentuk loop (3 bentuk di atas).
- `loopShapeSelected(loop)` (7053) sudah ada → **pakai langsung** untuk menemukan loop yang
  "terpilih" (selection ke entity, bukan ada `{kind:'loop'}` di `ui.selection`).
- `invalidateLoops()` (2574) — satu pintu invalidasi, dipanggil oleh `commit()`/`touch()`.

### Clone (fitur yang diminta dipakai)
- Bentuk entity: `{ id, type:'array', kind:'clone', masters:[entityId…],
  instances:[{ m:[a,b,c,d,tx,ty], a:[anchorX,anchorY] }], params:{}, color, layer }`
  (patokan: pembuatan `cmdClone()` 11453–11513).
- **Satu clone = satu entity dengan banyak masters** → cocok untuk loop compound:
  masters = entity loop luar + semua entity lubang; satu matriks placement untuk semuanya.
- Instance matriks bekerja pada koordinat world master **saat ini**; `a` (anchor) dicatat saat
  create supaya master yang kelak digeser tidak menyeret clone (`cloneInstanceOffsets`,
  11403–11419). Kita buat dengan anchor = posisi anchor sekarang → kompensasi no-op saat lahir.
- Render clone: `drawArrays()` (9288) + `arraySourcePaths()` (9238) — Path2D per warna di-cache,
  instance di-stamp via `DOMMatrix`.
- Clone di-exclude dari loop detection (`e.kind === 'clone'` → `return []`, app.js:1905):
  hasil nesting tidak jadi "loop baru yang bisa terpilih lagi" — bagus, tidak bolak-balik.
- Pipeline clone sudah lengkap (terverifikasi di app.js): bounds (`5367`), xf transform
  (`4893`), selection/duplikat (`5240`, `18760`), hit-test (`19125`), save/load
  (`25089`, `25094`), export (`11517`).
- Helper matriks: `matMul` / `matApply` — **core.js** (54–67) global, bukan local app.js
  (`app.js` havponya `matMul` di 11426 yang identik; pakai yang core.js agar konsisten dengan
  file testing).

### Warna & guide
- `#00ff00` = `CONSTRUCTION_COLOR` (10902) + `isConstructionColor()` (10904).
- Guide milik framed object di-deteksi lewat **ownership** — `ownedGuideIds()` (25654–25694),
  bukan warna. Loop hijau buatan user adalah geometry sah → **selalu buang `ownedGuideIds()`
  sebelum menentukan loop hijau / part**.
- `colorOf(e)` (1920) → `e.color || '#000000'`.

### Panel kanan / jendela baru
- `#sidebar` (index.html:281) berisi `<section class="panel">` bertumpuk (Chat, Selection,
  Parts, Tools). **Menambah panel = satu `<section class="panel" id="nest-panel">`** baru
  sebelum `</aside>` (index.html:354) — otomatis ikut `#vsplit`, theme gelap, slide-over tablet.
- Pola refresh data: `updateXxxList()` dipanggil dari `updateUI()` (17536–17577).
  Ditambah `updateNestPanel()` sebelum `xfUpdatePanel()`.
- CSS panel sudah ada: `.panel`, `.panel h3`, `.count`, `.row`, `.list`, `.btn`, `.meta`.
  Yang baru: `.nest-progress` (~10 baris CSS).

### History / commit / keamanan async
- `pushHistory()` (2305) = snapshot JSON **sebelum** mutasi. `commit()` (2612–2636) =
  cleanupPoints + invalidateLoops + scheduleSave + updateUI + render.
- Pola background job yang sudah ada: `runSvgImport()` (1099–1138) — `pushHistory()` sekali,
  bangun geometry, `commit()` sekali di akhir. **Ikut persis pola ini.**
- Render coalesce: `scheduleRender()` (2402) → satu RAF. Progress = update DOM panel +
  `scheduleRender()`; **bukan** `commit()` per frame.
- **Bahaya async**: undo/new/load MENGGANTI objek `state` (`applySnapshot` 2319–2341:
  `state = data.state`). Job lintas-frame wajib pegang referensi `const stateAtStart = state`
  dan **batalkan diri** kalau `state !== stateAtStart` setelah tiap yield (juga cek entity master
  masih ada sebelum membuat clone).

### Konvensi lain
- Toast bahasa Indonesia; label panel bahasa Inggris seperti panel lain.
- `xfBlock()` (5284) dicek di Start dan di `nestStop`.

---

## Riset source referensi nesting (karyacnc nestjs2/frontend)

File relevan (dibaca langsung):
- `js/geometry.js` (1320 baris), `js/nfp2.js` (574), `js/nfp_ga.js` (444), `js/nestWorker.js` (81),
  `js/main.js` (1717), `js/nfp.js`, `js/nfp_optimized.js`, `js/clipper.js` (ClipperLib).

### Algoritma GA+NFP2 yang diminta (hanya ini yang diporting)

| Kelas | Isi penting |
| --- | --- |
| `NFP2SpatialHash` (nfp2.js:7) | grid hash + `queryId` stamping; `add/remove/query` |
| `NFP2` (nfp2.js:85) | `findBestPosition`, `_runPlacementPasses` (4 pass prioritas area), `findBestNFPPlacement` (scanline + vertex refinement + bbox reject `bestScore+100` + break `y > sheet.height/3`), `checkCollisions`, `calculateTotalBounds`, `compactSolution` (settling hasil rapat), `getHorizontalIntersections` (dipakai scanline). Buang: `renest`, `checkDragPlacement`, `NFPOptimized` |
| `NFPGA` (nfp_ga.js:16) | `findBestPosition` (GA), `_evaluate`, `_placeWithVariant`, `_shuffled/_crossover/_mutateOrder/_randomRots/_crossoverRots/_mutate/_isValidSeed/_tournament`, `_entryArea`, `renest`/`compactSolution`/`checkDragPlacement` delegasi NFP2 (dibuang), `calculateTotalBounds`, `getPerformanceStats`. Default `popSize=6, generations=5, mutationRate=0.1`; elitism 2 + baseline "descending size" dijamin ikut → GA tak pernah lebih buruk dari heuristic |
| `GeometryUtil` (geometry.js:870) | `distance`, `pointInPolygon`, `polyOutside`, `polygonsIntersectAt` (dengan `insideBonus`), `polyOutsideAt`, `getHorizontalIntersections`, `lineSegmentsIntersectXY`, `pointInPolygonOffset`, `compactLayout` (dipakai `NFP2.compactSolution`) |
| `Path` / `Point` (geometry.js:3/19) | `getBounds` (+cache `_cachedBounds` untuk `pX/pY/width/height/fX/fY/fWidth/fHeight`), `translate`, `rotate` (deg→rad, lalu `align()`), `flip(centerY)`, `clone(dx,dy)` (menyalin bounds cache), `align` (part: −(pX,pY); sheet hijau: −(bounds.x,bounds.y)), `offset(distance)` via ClipperLib miter closed-polygon. Buang: `fromSVGPath`, `toSVGPath`, `getSVGPathData`, `originalPathCache`, `simplifyPath`, `removeIntersections`, SAT/normals, `ensureClockwise`, `NFPCalculator`, `convexHull` |

### Konvensi yang dipertahankan APA ADANYA

- **Semua koordinat engine integer `mm × 1000`** (`GEOM_SCALE = 1000`).
- **Loop hijau `#00ff00` = sheet**: engine skip part hijau dari placement, pakai bounds-nya
  sebagai ukuran lembar, dan menaruhnya di `placements` sebagai penanda frame (nfp2.js:174–186,
  nfp_ga.js:199–211). Sama dengan konvensi minisketch `CONSTRUCTION_COLOR`.
- `align()`: part biasa digeser supaya titik kiri-bawah (`pX,pY` = vertex terkiri-terbawah) ke
  origin; part sheet hijau digeser supaya **bounds min-corner** ke origin. Frame lembar = (0,0).
- `spacing`: part di-offset keluar `spacing/2` (Clipper `ClipperOffset`, miter) sebelum dibuat
  varian → packing pakai bentuk gemuk, hasil gambar pakai bentuk asli → celah antar part = `spacing`.
- **insideBonus**: kalau part muat penuh di **lubang** part lain (`poly2.paths.length>1`) →
  skor placement dapat bonus besar (`10000 * GEOM_SCALE`, geometry.js:955–962) → part kecil
  otomatis dijejalkan ke lubang (recycle material).
- Progress protocol: `progressHandler(done, total)`; total = `popSize × (generations+1) + 1`.
- `generatePartVariants(part)` (main.js:849): `opart = part.clone().offset(spacing)` lalu per
  rotasi `variant.rotate(rot)`.
- Containment pass referensi (main.js:713–730): part yang berada penuh di dalam part lain
  dijadikan `paths[]` child (lubang) + `childIndex`. Kita tiru polanya di sisi data minisketch.

### Yang TIDAK diporting
- `js/nestWorker.js` — Web Worker, tidak bisa dari `file://` (lihat keputusan main thread).
- `js/nfp.js`, `js/nfp_optimized.js`, `NFPCalculator` — bukan GA+NFP2/klasik, tidak diminta.
- Semua parse/export SVG + `renest` + `checkDragPlacement` — tidak dibutuhkan di minisketch.

---

## Arsitektur & alur data

```
ui.selection
   │  nestCollectSelection()  [app.js]
   │    ├─ loopShapeSelected-pola: getLoops() × selection (loopEntities)
   │    ├─ buang ownedGuideIds()
   │    ├─ sheet: TEPAT satu loop yang semua entity-nya #00ff00  → { sheetLoop, sheetBounds }
   │    └─ parts: sisa loop; compound → pohon containment      → [{ outer, holes[], entities[] }]
   ▼
nestBuildJob(sel)  [app.js]                     tools/nest.js (engine)
   │  per part: poly ×1000 → Path(paths=[luar,…lubang], originIndex, lcolor=null)
   │  base = clone().offset(spacing)   (ClipperLib, fallback tanpa offset bila kosong)
   │  variants = per θ ∈ rotations × flip → normalisasi min-corner → 0   (catat bMin/re)
   │  sheetPath = loop hijau ×1000, lcolor '#00ff00'
   ▼
nestRun() — async loop [app.js]  ←────────── progressHandler(done, total)
   │  for eval in totalEvals:                   (update panel + scheduleRender)
   │     best = engine._evaluate(...)          (main thread, 1 eval per tick)
   │     await yieldFrame(); cek cancel & state epoch
   │  final = compactSolution(best)
   ▼
nestApplyResult(best)  [app.js]
   │  pushHistory() (SEKALI, sebelum mutasi)
   │  per part ter-place  → 1 clone {masters, instances:[{m: M, a: anchor}]}
   │  per part tidak muat → 1 clone di tumpukan kanan
   │  (+1 clone frame lembar hijau — opsional, bisa dibuang)
   │  ui.selection = id clone hasil; commit() (SEKALI)
   ▼
worksheet: kanan bounds loop hijau asli → toast ringkasan (Indonesia)
```

### Matriks komposit untuk instance clone

Placement engine bekerja pada poligon hasil sampling loop (`loop.poly`, mm → ×1000);
sedangkan **clone menggambar master asli** (kurva asli, warna asli) melalui satu matriks.
Jadi fidelity kurva hasil nesting = fidelity master (engine hanya menentukan posisi —
persis cara CNC memotong hasil flatten `loop.poly`).

```
M = S_out ∘ T(dx,dy) ∘ T(re) ∘ R(θ) ∘ [F] ∘ T(−bMin) ∘ S_in

S_in   = [1000,0,0,1000,0,0]                 (mm → engine)
T(−bMin)= translate=−varian-basis-bbox-min-corner (offset) → 0
R(θ)   = rotasi θ derajat                    (engine rad)
F      = flip Y di tengah bbox varian       (hanya kalau Allow flip)
T(re)  = re-normalisasi min-corner varian hasil rotasi/flip → 0
T(dx,dy)= posisi hasil placement engine (integer engine unit)
S_out  = [1/1000,0,0,1/1000, outX, outY]     (engine → world mm)
         outX = sheetBounds.maxX + 10 mm (kanan loop hijau asli)
         outY = sheetBounds.minY  (sejajar bawah)
```

Semua komposisi via `matMul` dari core.js (54–63) + `matApply` (65).

Catatan: urutan geometrinya identik dengan `generatePartVariants()` referensi (offset dulu,
lalu rotasi per varian), tetapi penulisan adapter kita sendiri — lebih bersih daripada meniru
quirks `align()` referensi, dan minimize mismatch `pX/pY`.

- **Unplaced**: varian 0 (tanpa rotasi), origin `outX2 = outX + lebarTotalHasil + 10 mm`,
  disusun ke bawah dengan jarak `spacing` (bounding box min-corner ditempel).

---

## Spesifikasi perubahan file

### 1. BARU `tools/nest.js` (~1100 baris, port trim `geometry.js` + `nfp2.js` + `nfp_ga.js`)

- Classic `<script>`, tanpa DOM, tanpa `import/export` (constraint file://), tanpa observasi UI.
- Urutan di `index.html`: setelah `tools/clipper.js` (750) / sebelum `core.js` (767) —
  Clipper dibutuhkan runtime oleh `Path.offset()`; globals di top-level.

Isi & penyimpangan dari referensi:

| Blok | Asal | Perubahan |
| --- | --- | --- |
| `const GEOM_SCALE = 1000` | geometry.js:1 | sama |
| `class Point` | geometry.js:3 | sama (x,y,clone) |
| `class Path` | geometry.js:19 | trim: constructor, `getBounds`(+cache), `invalidateBounds`, `translate`, `rotate`, `flip`, `clone`, `align`, `offset` (ClipperLib), `static getSignedArea`. **Buang**: fromSVGPath, toSVGPath, getSVGPathData, originalPathCache, simplifyPath, removeIntersections, SAT/normals, ensureClockwise. `Path.clone` tetap menyalin `_cachedBounds` (hot path) |
| `GeometryUtil` | geometry.js:870 | trim: `pointInPolygonOffset`, `lineSegmentsIntersectXY`, `polygonsIntersectAt` (dengan `insideBonus`), `polyOutside`, `polyOutsideAt`, `getHorizontalIntersections`, `compactLayout`, `distance` |
| `class NFP2SpatialHash` | nfp2.js:7 | sama |
| `class NFP2` | nfp2.js:85 | `findBestPosition`, `_runPlacementPasses`, `findBestNFPPlacement`, `getCandidatePositions`, `checkCollisions`, `calculateTotalBounds`, `compactSolution`. Buang: `renest`, `checkDragPlacement`. Konvensi `#00ff00` = sheet **tetap** |
| `class NFPGA` | nfp_ga.js:16 | `findBestPosition` (GA), `_evaluate`, `_placeWithVariant`, helper permutasi (pertahankan yang GA+nest procedural; buang seedOrder/renest hooks) |
| ekspor global | — | tanpa ES module: class/const top-level. Tambah guard kecil untuk probe: `if (typeof window !== 'undefined') window.MiniSketchNest = { NFP2, NFPGA, Path, Point, GEOM_SCALE }` |

Node-loadable (tanpa DOM, `performance.now()` aman di Node ≥8.5) → bisa di-probe
`testing/nest_probe.js` via `vm.runInNewContext` (budaya testing/ existing: probes Node tanpa DOM).

### 2. `index.html` (~18 baris)

- Script tag `tools/nest.js` di atas (setelah clipper.js).
- Panel baru di `#sidebar` sebelum `</aside>`:

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

(Ikut selera panel: tanpa paragraf penjelasan; label singkat; dokumentasi = Help.)

### 3. `styles.css` (~10 baris, dekat blok panel 1919–1960)

```css
.nest-progress { height: 6px; border: 1px solid var(--line); border-radius: 3px; overflow: hidden; background: var(--panel-2, transparent); }
.nest-progress-fill { height: 100%; width: 0%; background: var(--accent, #2563eb); transition: width .12s linear; }
#nest-panel .row label { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; }
#nest-panel input, #nest-panel select { width: 52px; }
```

(nama var warna disesuaikan dengan token theme yang benar-benar ada saat implementasi.)

### 4. `app.js` — seksi baru "Nesting" (~230 baris, satu tempat, dekat seksi array/clone)

Fungsi:

- `nestPrefsLoad() / nestPrefsSave()` — `localStorage['minisketch.v1.nestPrefs']`,
  save-on-change (pola `saveTracePrefs` 14417–14429).
- `nestCollectSelection()` — seperti arsitektur: return `{ ok, sheet, parts, error }`;
  validasi: ≥1 part, tepat 1 loop hijau; loop compound digabung (holes); entity guide
  ownership dibuang; Toast error Indonesia bila gagal ("Pilih minimal satu loop untuk nesting
  dan satu loop garis hijau sebagai lembar").
- `nestBuildJob(sel)` — bangun `{ engineParts:[{variants, childIndex, originKey, entities}],
  sheetPath, sheetWorldBounds, spacing, … }`. `originKey` = kunci stabil part untuk mencocokkan
  hasil placement → masters (engine memakai `originIndex`).
- `nestRun()` — async; `stateAtStart` guard; per-eval yield + progress + cancel; akhir:
  `compactSolution` → `nestApplyResult`.
- `nestVariantMatrix(partRec, placement)` — hitung matriks komposit (butuh data `bMin`/`re`
  per varian yang dicatat saat build).
- `nestApplyResult(best)` — `pushHistory()` → buat clone per part (placed & unplaced) +
  frame lembar → `ui.selection` = clone baru → `commit()` → toast ringkasan Indonesia.
- `updateNestPanel()` — dipanggil dari `updateUI()`; tombol Start disabled saat `nestState.running`
  atau seleksi tak valid; count badge = jumlah part terpilih.
- Wiring: `nest-start`, `nest-stop`, listener `change` input (persist), di blok wiring tombol
  (~24020–24041); **tanpa shortcut keyboard baru** (taste: badge hanya bila berguna).

Interaksi yang **tidak** diubah: `cmdNest` lama (nest server KaryaCNC, 11919), `#btn-nest`,
pick filter.

### 5. `help.js`

+1–2 baris bilingual (EN & ID) pada bagian panel: cara memilih loop + loop hijau,
Start/Stop, arti "tidak muat" di kanan hasil. (Help adalah deliverable.)

### 6. BARU `testing/nest_probe.js` (Node, tanpa DOM)

Pola probe existing: baca source `tools/nest.js`, `vm.runInNewContext` di sandbox.

1. **Place dasar**: kotak 40×40 ke sheet kotak 100×100 → 1 placement, tanpa overlap,
   bbox part di dalam sheet.
2. **Spacing**: 2 kotak 20×20, spacing 3 → jarak bbox ≥ 3 (±epsilon).
3. **Hole**: part cincin (luar + 1 lubang) + part kecil yang muat di lubang → part kecil
   ditempatkan di dalam lubang (insideBonus) atau minimal tak overlap.
4. **Sheet hijau**: Path `lcolor:'#00ff00'` menentukan ukuran lembar & tidak di-rotate.
5. **GA elitism**: fitness hasil GA ≤ fitness baseline descending-size (invarian referensi).
6. **compactSolution**: hasil tak menghasilkan overlap baru.
7. **Determinisme minim**: engine berjalan tanpa `window` / DOM (probe adalah buktinya).

`node --check` untuk semua file yang diedit; probe dijalankan sekali sebagai verifikasi statis
(bukan testing app — testing app tetap milik user).

---

## Edge cases & perlakuan

| Kasus | Perlakuan |
| --- | --- |
| Tidak ada loop hijau / lebih dari 1 hijau di seleksi | Toast Indonesia, tidak mulai |
| Part lebih besar dari lembar | Tidak pernah dapat placement → masuk tumpukan "tidak muat" kanan |
| Loop hijau ≠ persegi (bentuk bebas) | Didukung: engine memakai bounds untuk ukuran & scanline `sheetRange` dari interseksi hijau (`lcolor` branch) — perilaku sama dengan referensi |
| `offset` Clipper menghasilkan kosong (part tipis + spacing besar) | Fallback varian tanpa offset (spacing efektif 0 utk part itu) |
| Entity master dihapus/undo saat job jalan | Guard `state !== stateAtStart` → batalkan + toast; cek `state.entities[masterId]` sebelum buat clone |
| Seleksi berubah / user mulai transform (xf) saat jalan | Job baca seleksi **sekali** di awal (snapshot data); `xfBlock()` dicek di Start |
| Loop di layer berbeda-beda | Loop diambil dari seleksi (per-layer by design); clone baru di `ui.activeLayer`, matriks world → aman |
| Guide hijau milik frame (text/group) | Dibuang via `ownedGuideIds()` — bukan kandidat sheet/part |
| Drawing ribuan titik (hasil trace) | Engine bekerja pada `loop.poly` (sampling); collision pakai bbox-reject + spatial hash; **tidak ada simplify** (geometry user tak diubah) |
| Y-axis | Engine & world sama-sama Y-up; mirror hanya urusan canvas referensi — tidak diporting |
| Circle loop | `loop.poly` 72-gon → nesting pakai approx 72-gon; clone menggambar circle asli |
| Stop ditekan | Finalisasi best-so-far (elitism menjamin baseline minimal ada) |

---

## Urutan implementasi

1. Port `tools/nest.js` (trim) + `node --check` + probe dasar (1–2, 7).
2. `index.html`: script tag + panel; `styles.css`: progress bar.
3. `app.js`: seksi Nesting — collect/build/run/apply + wiring + `updateNestPanel` + prefs persist.
4. `help.js`: 1–2 baris EN/ID.
5. Probe lengkap (3–6) + `node --check` semua + `node tests/smoke.js` (regresi core — wajib tetap hijau, kita tidak menyentuh core).
6. Serahkan checklist testing manual ke user (bukan test sendiri):
   - Gambar 3–4 loop + 1 kotak hijau besar → seleksi semua → Start → hasil muncul kanan
     loop hijau, tanpa overlap, jarak antar part = Spacing.
   - Loop berlubang (kotak + circle di dalamnya): keduanya terpilih → dihitung 1 objek,
     circle ikut pindah sebagai bagian clone.
   - Part yang lebih besar dari lembar → muncul di tumpukan kanan hasil.
   - Undo sekali → seluruh hasil nesting hilang, original utuh.
   - Progress bar jalan; Stop berhenti dan tetap menghasilkan best-so-far.
   - Refresh halaman → nilai Spacing/Rotation/Flip terakhir masih terpasang.

---

## Out of scope (dipesan untuk nanti, tidak dikerjakan sekarang)

- Web Worker / Blob-worker (kalau suatu hari butuh evaluasi raksasa).
- Renest parsial, drag-and-drop hasil dengan validasi `checkDragPlacement`,
  infinite-loop nesting — ada di referensi tapi tidak diminta.
- Multi-lembar / optimasi jumlah lembar.
- Menggantikan alur nest server lama (`#btn-nest` / `nestUpload`) — tetap ada.
