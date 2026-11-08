# Rencana Fitur Nesting MiniSketch — jendela Nesting + Clone + GA/NFP2

> Status: PLAN (belum implementasi). Output analisa saja — tidak ada file lain yang diubah.
> Referensi algoritma: `/mnt/smbshare/wails/karyacnc/nestjs2/frontend` (algoritma **GA + NFP2** saja,
> sesuai permintaan; `nfp.js` klasik & `nfp_optimized.js` tidak diporting).

---

## 1. Ringkasan fitur (flow user)

1. User menyeleksi **loops** yang mau dinesting (loop compound — loop luar + lubang di
   dalamnya — dihitung **1 objek**), plus **1 loop berwarna garis hijau** sebagai penanda
   **lembar (sheet)** tempat meletakkan hasil nesting.
2. User klik **Start** di panel **Nesting** (jendela baru di sidebar kanan).
3. App **meng-clone** semua loop terpilih menjadi objek nest engine (original tidak disentuh),
   lalu menjalankan **GA + NFP2 di background** dengan **progress bar** di panel.
4. Hasil **best** langsung di-place ke worksheet: **di sebelah kanan** lokasi loop hijau asli.
5. Part yang **tidak muat** di lembar di-place **di sebelah kanan output best** (tumpukan).

Output berbentuk **entity Clone** (`type:'array', kind:'clone'`) — satu clone per part,
master-nya adalah entity asli pembentuk loop. Jadi hasil nesting:
- bisa digeser/dirotasi/dihapus sebagai satu benda per part,
- tetap parametrik (edit master → clone ikut berubah bentuk, sesuai semantik Clone yang ada),
- tercatat di history sekali (satu undo = batal seluruh hasil nesting),
- ikut ter-export/CNC karena array clone sudah punya branch di semua pipeline
  (render, hit-test, save/load, CNC send — sudah lengkap di app.js).

---

## 2. Hasil riset — sisi referensi (nestjs2/frontend)

### 2.1 Arsitektur algoritma

| File | Isi | Dipakai? |
| --- | --- | --- |
| `js/geometry.js` (1320 ln) | `GEOM_SCALE=1000`, class `Point`, class `Path` (bounds cache, translate/rotate/flip/clone/align/offset via ClipperLib), `GeometryUtil` (pointInPolygon, polygonsIntersectAt on-the-fly offset, polyOutsideAt, getHorizontalIntersections, compactLayout) | ✅ port versi trim |
| `js/nfp2.js` (574 ln) | `NFP2SpatialHash` (grid hash + queryId stamping), `NFP2`: scanline search + vertex refinement + collision via spatial hash; konvensi **`lcolor === "#00ff00"` = sheet**; `_runPlacementPasses` 4-pass prioritas part besar | ✅ port |
| `js/nfp_ga.js` (444 ln) | `NFPGA`: kromosom = **permutasi urutan part** + gen rotasi (index varian per posisi); decoder = NFP2 **utuh tak diubah**; fitness = bounding-box area total + total bbox area part yang gagal diletakkan; elitism 2 + baseline "descending size" dijamin ikut → hasil GA tak pernah lebih buruk dari heuristic; OX crossover, tournament k=3, mutasi swap/relocate/invert + rotasi; default `popSize=6, generations=5, mutationRate=0.1` | ✅ port |
| `js/nestWorker.js` (81 ln) | Web Worker: rehydrate Path, progressHandler → `postMessage` | ❌ **tidak bisa** — Worker dari `file://` diblokir Chrome (lihat §4.1) |
| `js/main.js` (1717 ln) | UI, load SVG, **`generatePartVariants(part)`** (baris 849): `opart = part.clone().offset(spacing)` lalu per rotasi `variant.rotate(rot)`; containment pass (baris 713–730): part yang berada penuh di dalam part lain dijadikan `paths[]` child (lubang) + `childIndex`; `insideBonus` untuk part yang muat di lubang | ✅ pola adaptasi |
| `js/nfp.js`, `nfp_optimized.js` | algoritma NFP klasik / varian | ❌ tidak dipakai |

### 2.2 Konvensi penting yang dipertahankan apa adanya

- **Semua koordinat engine integer `mm × 1000`** (`GEOM_SCALE = 1000`).
- **Loop hijau `#00ff00` = sheet**: engine men-skip part hijau dari placement, memakai
  bounds-nya sebagai ukuran lembar, dan menaruhnya di `placements` sebagai penanda frame
  (`nfp2.js` baris 174–186, `nfp_ga.js` baris 199–211). Kebetulan (nyaman!) konvensi hijau
  ini sama dengan yang diminta user.
- `align()`: part biasa digeser supaya titik kiri-bawah (pX,pY = vertex terkiri-terbawah) ke
  origin; part hijau digeser supaya **bounds min-corner** ke origin. Frame lembar = (0,0).
- `spacing`: part di-offset keluar `spacing/2` (Clipper `ClipperOffset`, miter) sebelum
  dibuat varian → packing pakai bentuk gemuk, hasil gambar pakai bentuk asli → celah
  antar part tepat `spacing`.
- **insideBonus**: kalau part muat penuh di **lubang** part lain (`poly2.paths.length>1`),
  skor placement dapat bonus besar → part kecil otomatis dijejalkan ke lubang (recycle material).
- Progress protocol: `progressHandler(done, total)`; total = `popSize × (generations+1) + 1`
  evaluasi.

---

## 3. Hasil riset — sisi minisketch (titik integrasi)

Semua referensi `app.js:…` = file `/home/ryan/git/minisketch/app.js`.

### 3.1 Loops

- `getLoops()` (8606–8931): mengembalikan cache loop seluruh dokumen. Bentuk loop:
  - `{ poly, area, steps }` — loop rantai line/arc/spline (`steps[].edge.entity` = id entity),
  - `{ circle:true, entity, poly(72-gon), area }` — entity circle,
  - `{ poly, area, steps:[], splineEntity }` — spline tertutup.
  `poly` **sudah salinan koordinat** (invariant #3) — aman dipakai engine.
- `loopEntities(loop)` (7037): semua entity id pembentuk loop (ketiga bentuk di atas).
- `invalidateLoops()` (2574): satu pintu invalidasi; dipanggil `commit()`/`touch()`.
- Loop terpilih: tidak ada `{kind:'loop'}` di `ui.selection`; loop "terpilih" = **derived**
  dari selection entity-nya (`loopShapeSelected` 7053), dan sudah ada pola `pickedLoops()`
  (13395–13412) yang memetakan selection → daftar loop via `loopEntities`. **Pakai pola ini.**
- Pick filter loops (tombol 3 / `pickFilter.loop`, 1276) tidak perlu disentuh.

### 3.2 Clone (fitur yang diminta dipakai)

- Bentuk entity: `{ id, type:'array', kind:'clone', masters:[entityId…],
  instances:[{ m:[a,b,c,d,tx,ty], a:[anchorX,anchorY] }], params:{}, color, layer }`
  (pembuatan: `cmdClone()` 11453–11513).
- **Satu clone = satu entity dengan banyak masters** → cocok untuk loop compound: masters =
  entity loop luar + semua entity lubang; satu matriks placement untuk semuanya.
- Matriks instance bekerja pada koordinat world master **saat ini**; `a` (anchor) dicatat
  saat create supaya master yang kelak digeser tidak menyeret clone
  (`cloneInstanceOffsets` 11403–11419). Kita buat dengan anchor = posisi anchor sekarang →
  kompensasi no-op saat lahir.
- Render clone: `drawArrays()` (9288) + `arraySourcePaths()` (9238) — Path2D per warna di-cache,
  instance di-stamp via `DOMMatrix` → murah (taste #84: instancing harus nyaris gratis).
- Clone di-exclude dari loop detection (1905) — hasil nesting tidak akan "bolak-balik"
  jadi loop baru. Bagus.
- Helper matriks: `matFromPlacement()` (11439) ada, tapi kita butuh komposisi umum —
  pakai `matMul` dari **core.js** (54–63, `matMul(a,b)` = a∘b) + `matApply` (65).

### 3.3 Panel / jendela kanan

- Sidebar kanan `#sidebar` (index.html 281–354) berisi `<section class="panel">` bertumpuk
  (AI Chat, Selection, Parts, Tools). **Menambah panel = satu `<section class="panel" id="nest-panel">`**
  baru di `#sidebar` — otomatis ikut resize `#vsplit`, theme gelap, slide-over tablet.
- Pola refresh data: fungsi `updateXxxList()` dipanggil dari `updateUI()` (17536–17577),
  dijaga signature murah via `listUnchanged` (17592). Kita tambah `updateNestPanel()`.
- CSS panel sudah ada (`.panel`, `.panel h3`, `.count`, `.row`, `.list`, `.btn`, `.meta`).
  Yang baru hanya **progress bar** (~12 baris CSS).

### 3.4 History / commit / render / keamanan async

- `pushHistory()` (2305) = snapshot JSON **sebelum** mutasi; `commit()` (2612–2636) =
  cleanupPoints + invalidateLoops + scheduleSave + updateUI + render. Pola background job
  yang sudah ada: `runSvgImport` (1099–1138) — `pushHistory()` sekali di awal, bangun
  geometry, `commit()` sekali di akhir. **Kita ikut persis pola ini.**
- Render on-demand: `scheduleRender()` (2402) coalesce ke satu rAF. Progress = update DOM
  panel + `scheduleRender()`, **bukan** `commit()` per frame.
- **Bahaya async**: undo/new/load MENGGANTI objek `state` (`applySnapshot` 2322:
  `state = data.state`). Job yang jalan lintas-frame wajib memegang referensi
  `const stateAtStart = state` dan **membatalkan diri** kalau `state !== stateAtStart`
  setelah tiap yield. (Juga cek entity master masih ada sebelum membuat clone.)

### 3.5 Konvensi warna & guide

- `#00ff00` = "Mark (green)" di palet (49–59) + `CONSTRUCTION_COLOR` (10902); garis guide
  milik framed object di-deteksi lewat **ownership** (`ownedGuideIds()` 25657), bukan warna —
  jadi loop hijau buatan user adalah geometry sah. Kandidat sheet/part otomatis **buang
  entity yang ada di `ownedGuideIds()`** supaya guide frame text/group tidak ikut ternesting.
- Toast bahasa Indonesia (taste #2); label panel bahasa Inggris seperti panel lain.

---

## 4. Keputusan desain (dan alasannya)

### 4.1 Main thread + yield, BUKAN Web Worker

`file://` adalah constraint keras (ARCHITECTURE.md): Chrome memblokir `new Worker('…')`
dari halaman `file://`. Alternatif Blob-URL worker menuntut source engine di-inline jadi
string — kompleks dan rapuh. Karena unit kerja GA sudah pecah natural per-evaluasi
(≈ `popSize×(gen+1)+1` ≈ 36 evaluasi), kita jalankan engine di **main thread** dan
`await yieldFrame()` (rAF/setTimeout 0) **antar evaluasi** → UI tetap responsif, progress
bar jalan mulus, tombol Stop bisa dicek antar evaluasi. Biaya per evaluasi untuk ukuran
part realistis (puluhan loop, ratusan–ribuan titik) sudah ringan karena NFP2 memakai
spatial hash + bbox reject + early-out (`bestScore+100`, `y > sheet.height/3` break).

### 4.2 Engine = file baru `tools/nest.js` (port trim, self-contained)

- Pola sama dengan vendor lain (`clipper.js`, `imagetracer.js`): classic `<script>`,
  tanpa DOM, tanpa import. Tidak menyentuh `core.js` (core tetap murni math minisketch;
  engine nest adalah library adaptasi seperti vendor).
- Di-trim dari referensi (~3200 → ~1100 baris): buang parse/export SVG (`fromSVGPath`,
  `toSVGPath`, `getSVGPathData`, `originalPathCache`), `nfp.js`, `NFPOptimized`, `renest`,
  `checkDragPlacement`, SAT/normals, `compactSolution` **dipertahankan** (settling hasil
  best, dipanggil sekali setelah GA selesai — ini yang membuat hasil rapat).
- Node-loadable (class + const di top-level, tanpa DOM) → bisa di-probe
  `testing/nest_probe.js` via `vm.runInNewContext` — sesuai budaya testing/
  (probes Node tanpa DOM).

### 4.3 Sheet & part dari seleksi

- Sheet = **tepat satu** loop terpilih yang semua entity pembentuknya berwarna `#00ff00`
  (setelah buang `ownedGuideIds`). Bukan → toast Indonesia yang menjelaskan
  ("Pilih 1 loop hijau sebagai lembar + loop yang mau dinesting").
- Part = sisa loop terpilih. **Compound**: loop yang berada penuh di dalam loop terpilih
  lain menjadi **lubang**-nya (1 objek): uji contain pakai 1 vertex `poly` + `pointInPoly`
  (core.js sudah punya), bentuk pohon, sort area desc → `paths[0]` = luar, sisanya lubang.
  Identik dengan containment pass referensi (main.js:713–730) tapi di sisi data minisketch.
- Masters clone per part = union `loopEntities()` loop luar + semua loop lubang.

### 4.4 Output = Clone + transformasi matriks komposit

Placement engine bekerja pada **poligon hasil sampling loop** (`loop.poly`, mm → ×1000);
sedangkan **clone menggambar master asli** (kurva asli, warna asli) melalui satu matriks.
Jadi fidelity kurva hasil nesting = fidelity master (engine hanya menentukan posisi —
persis cara CNC memotong hasil flatten `loop.poly`).

Matriks instance dunia untuk part dengan varian terpilih (rotasi θ, flip F):

```
M = S_out ∘ T(dx,dy) ∘ T(re) ∘ R(θ) ∘ [F] ∘ T(−bMin) ∘ S_in

S_in  = [1000,0,0,1000,0,0]                      (mm → engine)
T(−bMin)= normalisasi bbox min-corner varian dasar (offset) → 0
R(θ)  = rotasi θ derajat (engine rad)
F     = flip Y di tengah bbox varian (opsional, dari Allow flip)
T(re) = re-normalisasi min-corner varian hasil rotasi/flip → 0
T(dx,dy)= posisi hasil placement engine (integer engine unit)
S_out = [1/1000,0,0,1/1000, outX, outY]          (engine → world mm)
        outX = sheetBounds.maxX + 10 mm (kanan loop hijau asli)
        outY = sheetBounds.minY  (sejajar bawah)
```

Semua komposisi via `matMul` core.js. Detail varian (offset, rotasi, flip, normalisasi
min-corner, pencatatan `bMin`/`re`) kita tulis sendiri di adapter — **lebih bersih daripada
meniru quirks `align()` referensi** — tetapi urutan geometrinya identik dengan
`generatePartVariants()` (offset dulu, lalu rotasi per varian).

- **Unplaced**: varian 0 (tanpa rotasi), origin `outX2 = outX + lebarTotalHasil + 10 mm`,
  disusun ke bawah dengan jarak `spacing` (bounding box min-corner ditempel).
- **Frame lembar output**: satu clone hijau tambahan dari loop sheet di origin output —
  supaya batas lembar terbaca (keputusan kecil; gampang dibuang kalau tidak mau).

### 4.5 Parameter panel (persist "last used")

Panel: `Spacing (mm)`, `Rotation` (select: 0° / 90° / 180° / 270° / 15° steps),
`Allow flip` (checkbox), `GA Pop`, `GA Gen` (default 6 / 5 — sama referensi), tombol
`Start` ⇄ `Stop`, progress bar, satu baris status meta (n placed / total, fitness, luas).
Nilai disimpan **saat berubah** ke `localStorage['minisketch.v1.nestPrefs']`
(pola `saveTracePrefs` — taste #3 last-used & #111 state survives abandonment).

---

## 5. Arsitektur & alur data

```
ui.selection
   │  nestCollectSelection()  [app.js]
   │    ├─ pickedLoops-pola: getLoops() × selection (loopEntities)
   │    ├─ buang ownedGuideIds()
   │    ├─ sheet: 1 loop hijau (#00ff00)          → { sheetLoop, sheetBounds }
   │    └─ parts: pohon containment              → [{ outer, holes[], entities[] }]
   ▼
nestBuildJob()  [app.js]                    tools/nest.js (engine)
   │  per part: poly×1000 → Path(paths=[luar,…lubang])
   │  base = clone().offset(spacing)  (ClipperLib, fallback tanpa offset bila kosong)
   │  variants = untuk tiap θ ∈ rotations × flip → normalisasi min-corner → 0
   │  sheetPath = loop hijau ×1000, lcolor '#00ff00'
   ▼
nestRun() — async loop [app.js]  ←────────── progressHandler(done,total)
   │  for eval in totalEvals:                     (update panel + scheduleRender)
   │     best = NFPGA._evaluate(...)              (main thread, 1 eval per tick)
   │     await yieldFrame(); cek cancel & state epoch
   │  final = compactSolution(best)
   ▼
nestApplyResult()  [app.js]
   │  pushHistory() (SEKALI, sebelum mutasi)
   │  per placed part  → 1 clone {masters, instances:[{m: M, a: anchor}]}
   │  per unplaced     → 1 clone di tumpukan kanan
   │  (+1 clone frame lembar hijau)
   │  ui.selection = id clone hasil; commit() (SEKALI)
   ▼
worksheet: kanan loop hijau asli        toast ringkasan (Indonesia)
```

---

## 6. Spesifikasi perubahan file

### 6.1 BARU `tools/nest.js` (~1100 baris, port trim `geometry.js`+`nfp2.js`+`nfp_ga.js`)

Isi & penyimpangan dari referensi:

| Blok | Asal | Perubahan |
| --- | --- | --- |
| `const GEOM_SCALE = 1000` | geometry.js:1 | sama |
| `class Point` | geometry.js:3 | sama (x,y,clone) |
| `class Path` | geometry.js:19 | trim: constructor, `getBounds`(+cache), `invalidateBounds`, `translate`, `rotate`, `flip`, `clone`, `align`, `offset` (ClipperLib), `static getSignedArea`. **Buang**: fromSVGPath, toSVGPath, getSVGPathData, originalPathCache, simplifyPath, removeIntersections, SAT/normals, ensureClockwise. `Path.clone` tetap menyalin `_cachedBounds` (hot path). |
| `GeometryUtil` | geometry.js:870 | trim: `pointInPolygonOffset`, `lineSegmentsIntersectXY`, `polygonsIntersectAt` (dengan `insideBonus`), `polyOutsideAt`, `getHorizontalIntersections`, `compactLayout`, `distance` |
| `class NFP2SpatialHash` | nfp2.js:7 | sama |
| `class NFP2` | nfp2.js:85 | `findBestPosition`, `_runPlacementPasses`, `findBestNFPPlacement`, `getCandidatePositions`, `checkCollisions`, `calculateTotalBounds`, `compactSolution`. Buang: `renest`, `checkDragPlacement`. Konvensi `#00ff00` = sheet **tetap**. |
| `class NFPGA` | nfp_ga.js:16 | `findBestPosition` (GA), `_evaluate`, `_placeWithVariant`, helper permutasi. `renest`/`compactSolution` delegasi NFP2 dipertahankan bentuknya. |
| ekspor global | — | tanpa ES module: class/const top-level (classic script). Tambah guard kecil `window.MiniSketchNest = { NFP2, NFPGA, Path, Point, GEOM_SCALE }` untuk probe/testing. |

Tanpa DOM, tanpa `performance` khusus (`performance.now()` ada di browser & Node ≥8.5 —
probe Node aman), `Math.random` polos.

### 6.2 `index.html`

1. `<script src="tools/nest.js"></script>` — setelah `tools/clipper.js` (750) /
   sebelum `core.js` (767); urutan wajib: clipper dulu (Path.offset memakai ClipperLib
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

(Ikut selera panel: tanpa paragraf penjelasan; label singkat; dok = Help.)

### 6.3 `styles.css` (~12 baris, dekat blok panel 1919–1960)

```css
.nest-progress { height: 6px; border: 1px solid var(--line); border-radius: 3px; overflow: hidden; background: var(--panel-2, transparent); }
.nest-progress-fill { height: 100%; width: 0%; background: var(--accent, #2563eb); transition: width .12s linear; }
#nest-panel .row label { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; }
#nest-panel input, #nest-panel select { width: 52px; }
```

(nama var warna disesuaikan dengan token theme yang benar-benar ada saat implementasi.)

### 6.4 `app.js` — seksi baru "Nesting" (~230 baris, satu tempat, dekat seksi array/clone)

Fungsi:

- `nestPrefsLoad()/nestPrefsSave()` — `minisketch.v1.nestPrefs`, save on change semua input.
- `nestCollectSelection()` — seperti §5: kembalikan `{ ok, sheet, parts, error }`;
  validasi: ≥1 part, tepat 1 sheet hijau; loop compound digabung (holes); entity guide
  ownership dibuang; Toast error Indonesia bila gagal.
- `nestBuildJob(sel)` — bangun `{ engineParts:[{variants, childIndex, originKey, entities}],
  sheetPath, sheetWorldBounds, spacing, … }` (detail §4.4). `originKey` = kunci stabil part
  untuk mencocokkan hasil placement → masters (engine memakai `originIndex`).
- `nestRun()` — async; `stateAtStart` guard; per-eval yield + progress + cancel;
  akhir: `compactSolution` → `nestApplyResult`.
- `nestVariantMatrix(partRec, placement)` — hitung matriks komposit §4.4
  (butuh data `bMin`/`re` per varian yang dicatat saat build).
- `nestApplyResult(best)` — `pushHistory()` → buat clone per part (placed & unplaced) +
  frame lembar → `ui.selection` = clone baru → `commit()` → toast ringkasan Indonesia
  ("Nesting selesai: 14 diletakkan, 2 tidak muat — luas 480×320 mm").
- `updateNestPanel()` — dipanggil dari `updateUI()`; signature-guard; render status/
  progress; tombol Start disabled saat `nestState.running` atau seleksi tak valid
  (count badge = jumlah part terpilih).
- Wiring: `nest-start`, `nest-stop`, listener `change` input (persist), di blok wiring
  tombol (~24021–24041); **tanpa shortcut keyboard baru** (taste: badge hanya bila berguna).

Interaksi yang **tidak** diubah: `cmdNest` lama (nest server KaryaCNC), pick filter,
`#btn-nest`.

### 6.5 `help.js`

+1–2 baris bilingual (EN & ID) pada bagian panel: cara memilih loop + loop hijau,
Start/Stop, arti "tidak muat" di kanan hasil. (Help adalah deliverable — taste #64.)

### 6.6 BARU `testing/nest_probe.js` (Node, tanpa DOM)

Pola probe existing: baca source `tools/nest.js`, `vm.runInNewContext` di sandbox.

1. **Place dasar**: kotak 40×40 ke sheet kotak 100×100 → 1 placement, tanpa overlap,
   bbox part di dalam sheet.
2. **Spacing**: 2 kotak 20×20, spacing 3 → jarak bbox ≥ 3 (±epsilon).
3. **Hole**: part cincin (luar + 1 lubang) + part kecil yang muat di lubang → part kecil
   ditempatkan di dalam lubang (insideBonus) atau minimal tak overlap.
4. **Sheet hijau**: Path `lcolor:'#00ff00'` menentukan ukuran lembar & tidak di-rotate.
5. **GA elitism**: fitness hasil GA ≤ fitness baseline descending-size (invarian referensi).
6. **compactSolution**: hasil tak menghasilkan overlap baru.
7. **Determinisme minim**: engine berjalan tanpa DOM/`window` (probe adalah buktinya).

`node --check` untuk semua file yang diedit; probe dijalankan sekali sebagai static
verification (bukan testing app — testing app tetap milik user, taste #32).

---

## 7. Edge cases & perlakuan

| Kasus | Perlakuan |
| --- | --- |
| Tidak ada loop hijau / >1 hijau di seleksi | Toast Indonesia, tidak mulai |
| Part lebih besar dari lembar | Tidak pernah dapat placement → masuk tumpukan "tidak muat" kanan |
| Loop hijau ≠ persegi (bentuk bebas) | Didukung: engine memakai bounds untuk ukuran & scanline `sheetRange` dari interseksi hijau (`lcolor` branch) — perilaku sama dengan referensi |
| `offset` Clipper menghasilkan kosong (part tipis + spacing besar) | Fallback varian tanpa offset (spacing efektif 0 utk part itu) |
| Entity master dihapus/undo saat job jalan | Guard `state !== stateAtStart` → batalkan + toast; cek `state.entities[masterId]` sebelum buat clone |
| Seleksi berubah / user mulai transform (xf) saat jalan | Job baca seleksi **sekali** di awal (snapshot data), jadi perubahan seleksi aman; `xfBlock()` dicek di Start |
| Loop di layer berbeda-beda | Loop diambil dari seleksi (per-layer by design); clone baru di `ui.activeLayer`, matriks world → aman |
| Guide hijau milik frame (text/group) | Dibuang via `ownedGuideIds()` — bukan kandidat sheet/part |
| Drawing ribuan titik (hasil trace) | Engine bekerja pada `loop.poly` (sampling); collision pakai bbox-reject + spatial hash; **tidak ada simplify** (geometry user tak diubah — taste #10) |
| Y-axis | Engine & world sama-sama Y-up; mirror hanya urusan canvas referensi — tidak diporting |
| Circle loop | `loop.poly` 72-gon → nesting pakai approx 72-gon; clone menggambar circle asli |
| Stop ditekan | Finalisasi best-so-far (elitism menjamin baseline minimal ada) |

---

## 8. Urutan implementasi (step by step)

1. Port `tools/nest.js` (trim) + `node --check` + probe dasar (1–2, 7).
2. `index.html`: script tag + panel; `styles.css`: progress bar.
3. `app.js`: seksi Nesting — collect/build/run/apply + wiring + `updateNestPanel` +
   prefs persist.
4. `help.js`: 1–2 baris EN/ID.
5. Probe lengkap (3–6) + `node --check` semua + `node tests/smoke.js` (regresi core —
   wajib tetap hijau, kita tidak menyentuh core).
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

## 9. Out of scope (dipesan untuk nanti, tidak dikerjakan sekarang)

- Web Worker / Blob-worker (kalau suatu saat butuh evaluasi raksasa).
- Renest parsial, drag-and-drop hasil dengan validasi `checkDragPlacement`,
  infinite-loop nesting (loop tanpa henti cari kombinasi) — ada di referensi tapi tidak
  diminta.
- Multi-lembar / optimasi jumlah lembar.
- Menggantikan alur nest server lama (`#btn-nest` / `nestUpload`) — tetap ada.
