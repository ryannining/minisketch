# Koreksi Rendering Engine — MiniSketch

Hasil analisa performance audit `app.js` (~24.3k baris, semua rendering & interaksi) dan `core.js` (~3.4k baris, pure geometry/solver). Target: editing lancar pada file kompleks (~5k entitas / 20k titik / banyak constraint, art, array, part).

Acuan arsitektur saat ini:
- Entry render: `app.js:16058 render()` — full redraw tiap frame, sudah ada koalesensi rAF (`scheduleRender` `app.js:2164`), blit snapshot saat pan (`app.js:16062`) dan zoom (`ui.zoomBlast` `app.js:16071`), settle timer 120 ms (`app.js:2177`).
- Satu-satunya sinyal "geometry berubah": `invalidateLoops()` (`app.js:2274`), dipanggil dari ±60 call site termasuk setiap pointermove saat drag.
- Cache yang ada: `loopCache`, `splineSampleCache`, `artContourCache`, `hitGridCache`, `pointUseCache`, `pointEditableCache`, `pointShownCache`.

Kesimpulan besar: **bottleneck utama bukan gambar canvas-nya, melainkan kebijakan invalidasi cache yang global** — satu pointermove menjatuhkan semua cache, sehingga frame berikutnya menghitung ulang SELURUH spline/art/loop/index meskipun hanya satu titik yang geser. Diurutkan dari dampak terbesar.

---

## PRIORITAS 1 — Invalidasi cache global per pointermove (dampak terbesar)

### 1.1 `invalidateLoops()` menjatuhkan semua cache sample/contour tiap move
- `app.js:2274–2294`: tiap pointermove saat drag → `splineSampleCache = new Map()`, `artContourCache = new Map()`, `pointUseCache/pointEditableCache/pointShownCache/hitGridCache = null`.
- Check keabsahan cache berbasis identitas array (`hit.pts === e.pts` `app.js:6169`; `hit.contours === e.contours` `app.js:10070`) — tapi drag mutating `state.points` in-place, jadi identitas tidak melihat perubahan; reset global adalah "tambalan" yang ada sekarang.
- Akibat: drag satu simpul spline → **semua spline di document di-resample** dan **semua art contour di-rebuild (termasuk RDP >300 titik, `app.js:10084`)** pada frame berikutnya. Drag satu frame art → re-RDP semua gambar embedded.
- **Koreksi:** versioning per-entitas/per-titik. Simpan `pointEpoch` global + catat pid titik yang dipakai entri cache; entri valid selama titik-titiknya tidak berubah sejak epoch terakhir entri itu dibangun. Alternatif lebih murah: cache entry menyimpan salinan koordinat titik saat dibangun, bandingkan dengan koordinat sekarang (O(n_pts) per entri, hanya entri yang ditanya yang dicek — bukan rebuild semua). `pointUseCache` (indeks entity→points) bahkan tidak perlu dijatuhkan saat drag sama sekali: drag mengubah koordinat, bukan keanggotaan entity↔point; hanya perlu invalid saat entity tambah/hapus.
- `hitGridCache` (`app.js:7108`): jangan null-kan tiap move; invalidasi hanya entri sel milik entitas yang titiknya bergerak, atau rebuild oleh diff epoch.

### 1.2 `geometryEpoch++` global memaksa semua array re-bake
- `app.js:2275` + `app.js:8596/11002`: tiap move bump epoch global → batch Path2D dan `arrayEnsureShapes` semua entitas array di document di-rebuild, padahal hanya array yang master/instance-nya berubah yang perlu.
- **Koreksi:** epoch per-master/per-array, atau simpan epoch saat array terakhir bake dan bandingkan hanya untuk entity array yang dibaca.

### 1.3 Path2D dan objek dialok per frame, bukan di-cache
- `drawArtEntity` (`app.js:9966–9999`): tiap frame per art — 2 `Map` baru + **1 Path2D baru per contour**. Art 2k contour = 2k+ Path2D/frame.
- `drawArrays` (`app.js:8613–8660`): per instance per frame — `DOMMatrix` baru (2× konstruksi + multiply), **Path2D baru per warna per instance** (`p.addPath(sp, job.m)`). 500 clone × 3 warna = 1500 Path2D + 2000 `stroke()` per frame. `arrayInstanceOffsets(e)` (`app.js:10831`) juga menghitung ulang seluruh offset list (termasuk tabel arc-length guide) tiap frame, tanpa cache.
- **Koreksi:** bangun Path2D master dalam **world space** sekali (cache keyed epoch), lalu per instance/frame cukup `ctx.save(); ctx.setTransform(matrix); ctx.stroke(masterPath); ctx.restore()` — tanpa transform path per-instance. Cache offsets by `geometryEpoch`+param identity. (Komentar di `app.js:8558` sudah merekomendasikan pola ini.)

---

## PRIORITAS 2 — Hitch saat mouse-up: rebuild loop sinkron di frame pertama

- `getLoops()` (`app.js:8036`): rebuild = 2 full entity scan + union-find weld (`app.js:8086–8143`) + ekstraksi siklus di `app.js:8259–8270` yang menjalankan **BFS baru per sisa edge → O(E·(E+V))**, terburuk O(E²). Circle meng-alokasi 72 `{x,y}` per rebuild (`app.js:8197`).
- Deferral saat drag benar (`loopsDeferred` `app.js:2288`), tapi di `onPointerUp` (`app.js:19738–19750`) rebuild sinkron jatuh tepat di frame render pertama setelah release → **hitch yang dirasakan user sebagai "lambat di akhir drag"**.
- Nudge/delete/solve juga memicu rebuild sinkron di tengah frame (deferral hanya berlaku saat `ui.drag` aktif).
- Perilaku cache saat ini: `loopCache` whole-hog — dibuang total oleh setiap `invalidateLoops()`, tidak ada memori hasil lama. Dalam satu rebuild, mekanisme "jangan cek lagi" sudah ada **tapi untuk edge**: `usedEdges` (`app.js:8239/8282`, edge yang sudah dikonsumsi loop tidak boleh masuk loop lain) dan `noLoop` (`app.js:8258`, edge gagal tidak dicari ulang).

### Spesifikasi koreksi: cache persisten per komponen (bukan per titik)

Prinsip: siklus tidak pernah melewati batas komponen union-find, jadi **komponen adalah unit invalidasi yang alami**. Jangan pakai aturan "titik yang sudah milik loop lain tidak boleh dicek" — satu titik boleh ikut banyak loop secara sah (figure-8 / dua lingkaran bersentuhan; persegi ABCD + diagonal AC → loop ABC dan ACD berbagi A dan C). Yang tidak boleh dipakai ulang adalah **edge**, dan itu sudah ditegakkan `usedEdges`.

1. **Weld tetap full tiap rebuild** (`app.js:8086–8143`): union-find + grid `JOIN_TOL` itu O(n) dan murah. **Jangan** cache hasil weld per titik — dua titik yang hari ini berjarak 2×`JOIN_TOL` bisa bergeser menjadi <`JOIN_TOL` dan harus menyatu; hasil weld lama akan salah.
2. **Ekstraksi siklus per komponen**: kelompokkan edge berdasarkan root union-find. Dalam satu komponen: satu BFS untuk menemukan siklus pertama, lalu ulangi BFS **hanya di dalam komponen itu** dengan `usedEdges` sampai edge habis, baru pindah komponen. Total kerja turun dari O(E·(E+V)) → O(E+V + Σ panjang siklus). `noLoop` cukup per komponen.
3. **Cache persisten per komponen** (`componentLoopCache: Map<root, {signature, loops}>`): signature = daftar edge entity + pid anggota + **koordinat titik-titiknya** saat loop dibangun. `invalidateLoops()` global tidak lagi membuang hasil komponen yang signature-nya masih cocok — loop A tetap tercache selama garisnya tidak dihapus **dan tidak digeser** (perubahan koordinat tetap membatalkan, karena poligon loop ikut berubah; poligon disimpan sebagai salinan, `app.js:8295–8299`, jadi validitasnya harus diuji eksplisit terhadap koordinat sekarang).
4. **Reuse objek loop**: entri cache yang signature-nya cocok dikembalikan apa adanya (termasuk `poly` dan centroid yang sudah dihitung — sekaligus menyelesaikan `snapLoopCentroid` `app.js:2547` di Prioritas 3). Loop yang entity-nya hilang saat diff → buang; komponen yang berubah → re-extract lokal.
5. **Jalur cepat untuk operasi umum**: add/delete satu line hanya memengaruhi komponen yang memuat endpoint-nya; drag satu titik → komponen titik itu saja; sisanya dipetik dari cache. Hitch mouse-up hilang karena pekerjaan konstan bukan lagi ukuran document.
6. **Fallback minimal** bila poin 3–5 terlalu berisiko untuk sekali jalan: pindahkan rebuild penuh ke `requestIdleCallback` (`app.js:8036` read path) sambil tetap menggambar `loopCache` lama, plus perbaikan ekstraksi per komponen (poin 2) yang tetap berguna saat rebuild terjadi.

---

## PRIORITAS 3 — Jalur hover/snap: full scan per event, sebagian tidak dikoalesensi

- `snapPoint` (`app.js:2494`) dipanggil **dua kali per hover event** (sekali di move handler `app.js:19248`, sekali lagi dari `render()` via `snapFor` `app.js:16137–16141`):
  - full scan `state.points` (20k hypot, `app.js:2504`),
  - `snapLineGeometry` (`app.js:2579`) scan semua entity,
  - `snapLoopCentroid` (`app.js:2547`) menghitung ulang centroid area-weighted **semua loop dari semua vertex polygon** tiap move — tanpa memo. → **High**. (Memo centroid ikut tersedia gratis begitu cache per-komponen Prioritas 2 poin 4 jadi — entri loop yang sama dikembalikan apa adanya.)
- `hitPoint` (`app.js:7964`): scan penuh `state.points` per check; grid hit (`hitGrid`) tidak dipakai untuk titik.
- `hitPartMarker` (`app.js:7404`) dan `findSnapFor` (`app.js:7513–7533`): **`partMarkersOf(e)` rebuild penuh (alokasi per node/midpoint/centroid master) untuk setiap part, setiap event** — padahal marker lokal-frame tidak bergantung pose. Cache per master; hanya `matApply` saat query. → **High** pada file banyak part.
- Throttle hover terbalik: `app.js:19203` `if (!ui.hover) return;` — justru saat SUDAH hover sesuatu, pemeriksaan penuh jalan terus tiap event.
- `bulkActive()` → `entityCount()` (`app.js:8666`) full scan **sebelum** throttle 66 ms diperiksa (`app.js:19201`).
- Beberapa cabang memanggil `render()` sinkron per event, bukan `scheduleRender()`: `app.js:18809` (moveJob pick), `app.js:18825` (curve draft), `app.js:19013` (`xfMoveInstance`), `app.js:18941/18972/19028` (xfRotate/xfScale/xfMove). Mouse 125 Hz = 125 render penuh/detik. → ganti `scheduleRender()`.
- `updateCoords` (`app.js:16714`) menulis `innerHTML` tiap raw event — pindah ke coalesced, pakai `textContent`.
- **Koreksi umum:** satu indeks spasial titik (grid/prefix bucket) dipakai bersama oleh `hitPoint`/`snapPoint`; centroid loop disimpan di entri `loopCache`; `snapFor` hasil disimpan per frame agar render tidak menghitung ulang.

---

## PRIORITAS 4 — History & save: JSON.stringify full document di jalur interaktif

- `pushHistory` → `snapshot()` (`app.js:2063–2067`, dipanggil di press `app.js:17516`): `JSON.stringify` SELURUH state (versi unpacked, lebih besar dari versi save) **sinkron di pointerdown** → blokir 20–60 ms pada file besar; cap 120 entri string penuh bisa ratusan MB.
- `persistNow` (`app.js:2130`) 350 ms setelah release: `serializeDoc()` penuh + `localStorage.setItem` di main thread → hitch pasca-drag yang dijamin muncul.
- **Koreksi:** snapshot inkremental/diff, atau kemas sekali dan pakai bersama untuk history & save (pakai `serializeState` yang packed, bukan stringify mentah); pindahkan serialisasi ke idle callback/Worker; target autosave ke IndexedDB (async) alih-alih localStorage sinkron; batasi history by total bytes.

---

## PRIORITAS 5 — Kerja O(n) per frame di dalam `render()` (seharusnya incremental)

- `getLayer()` (`app.js:2063`) scan linear `state.layers`; `layerVisible(e)` = 2 scan per panggilan, dan dipanggil per entity (di `drawOneEntity` `app.js:14160`, per bucketing `drawEntities` `app.js:14122`, per loop `loopVisibleOnCanvas` `app.js:8469`, per point `app.js:10050`, dst) → 15–20k scan layer/frame. **Fix:** `Map id→layer` + memo visible per-frame sig (pola `pointCachesValid` `app.js:1804` sudah ada — perluas).
- `drawEntities` (`app.js:14090–14145`): 3 full scan per frame (entityCount + rebuild bucket `byLayer` + pass per layer). Bucketing cukup invalid saat struktur/layer berubah, bukan saat titik geser.
- ±10 fungsi gambar masing-masing mengiterasi SEMUA `state.entities` untuk menyaring tipe: `drawArrays` `app.js:8613`, `drawPartMarkers` `app.js:14635`, `drawMates` `app.js:14739` (+ `partsCount()` full scan lagi `app.js:14952`), `drawNotes` `app.js:16036`, `drawImageBitmaps` `app.js:8970`, `drawSegmentHighlight` 2 scan lagi `app.js:14418/14440`. **Fix:** indeks `entitiesByType` yang dipelihara saat tambah/hapus.
- `entityQuickBounds` (`app.js:7171`) tidak di-memo → dihitung ulang per (point × owner) per frame di `drawPoints` (`app.js:15039–15053`) dan setiap rebuild grid. **Fix:** memo keyed epoch.
- `drawDimensions` (`app.js:15312`): tiap frame iterasi semua constraint, `dimViolated` per dimensi, rebuild `ui.dimHits` — 60×/detik saat drag. **Med–High** dengan banyak dimensi.

---

## PRIORITAS 6 — Anti-pattern canvas & DOM kecil tapi berisik

- `drawGrid` (`app.js:8345–8364`): `beginPath/stroke` per garis (100–300 stroke/frame). Batch per warna → 3 stroke.
- `drawLabel`/`drawBadge` (`app.js:15129/15184`) dan label mate/scale/snap (`app.js:12213/14824/14891/15867`): `ctx.font = string` + `measureText()` sinkron per label per frame. Memo lebar teks keyed `text+zoom`.
- `drawTextEntity` (`app.js:9045–9107`): font string concat + `strokeText` per baris per frame (rasterisasi glyph ulang); `textLineOffsetX` (`app.js:9140`) tambah save/font/measure/restore per baris non-left. Cache bitmap/Path2D per (teks, style, zoom).
- `badgeSlot` (`app.js:15151–15181`): O(n²) rect-test untuk badge dimensi dengan banyak dimensi.
- `w2s` (`app.js:1974`) alokasi `{x,y}` per panggilan — ribuan per frame (`loopPath` `app.js:8485`, `mapPt` art `app.js:9977`, `matApply` part `app.js:14623`). `drawPoints` (`app.js:15034`) sudah inline; terapkan pola yang sama atau Path2D world-space + `setTransform`.
- `drawPoints` density cell key string `sx+','+sy` per titik per frame (`app.js:15056`) → hash numerik.
- DOM per frame: `updateStatusCounts`/`setFrameTime` (`app.js:16160–16187`) — 4–5 `getElementById` + tulis `textContent`/`title` tanpa diff; `updateTransformPanel` (`app.js:4300`) tulis 4 input + 5 getElementById tiap frame; `entityTightBounds` (`app.js:4081`) sample arc per entity terpilih per frame; `xfPositionPanel` (`app.js:5592`) baca `offsetWidth` (forced layout) per frame saat tool Transform aktif. **Fix:** cache elemen saat init, tulis hanya bila nilai berubah.
- `drawPoints` dan seluruh pipeline TIDAK memakai `shadowBlur`/gradient per-frame — sudah bersih.

---

## PRIORITAS 7 — BUG: deklarasi `dimColor` ganda menimpa yang memoized

- Dua `function dimColor` dalam satu scope: `app.js:14582` (versi memoized color-mix) dan `app.js:15306` (versi dimensions-only). Yang belakangan menang → `dimColor(themedCanvasColor(col))` di `drawArtEntity` (`app.js:10016`), `drawArrays` (`app.js:14657`), `drawPartEntity` (`app.js:14618`) mengembalikan `#7b8798` konstan; `darkCache` mati; art/clone/part non-selected kehilangan warna aslinya saat redup.
- **Koreksi:** ganti nama salah satu (mis. `dimViolatedColor` untuk versi 15306) dan sambungkan kembali. Ini bug visualitas sekaligus dead-code perf.

---

## PRIORITAS 8 — core.js: biaya komputasi yang ikut dirasakan interaktif

1. **`curveStraightSpans` kuadratik** (`core.js:878–924`): untuk tiap start `i`, `j` diperluas dan `curveIsStraight(i,j)` di-recall dengan re-scan semua interior point → O(len²)–O(len³) per fit run. Dipanggil dari dialog Ctrl+K yang **re-fit semua chain di setiap event slider `input`** (`app.js:18629`) → seret tolerance slider di atas trace besar = badai interaktif. **Fix:** running max-deviation (extend-or-reset linear) + debounce slider ~100 ms + memo corner-detection (tidak bergantung tol).
2. **Verifikasi `n++` linear pada `flattenCubic`** (`core.js:545`): `errOf(n)` O(n) dihitung ulang untuk tiap n yang dinaikkan → worst ~500k `cubicAt` + alokasi objek per cubic pada tol ketat. Parameter `depth` (`core.js:508`) diterima tapi tak dipakai (fungsi ini tidak rekursif — asumsi premis lama). **Fix:** doubling + binary search pada n; buffer Float64Array keluaran; memo keyed (points, tol).
3. **Sampling tetap `SPLINE_SEG=12` / `ARC_SEG=72`** (`core.js:12–13`): tidak zoom-aware — faceted saat zoom-in, boros saat zoom-out. **Fix:** render spline dengan `bezierCurveTo` native (poligon hanya untuk hit-test/mesin), atau jumlah segmen per span dari ukuran pixel span.
4. **`lmSolve` numerik Jacobian + alokasi berat** (`core.js:1205–1287`): n+1 evaluasi `fn` per iterasi, `J/A/M/g/xn` array baru per iterasi/attempts; `solveLinear` Gauss-Jordan O(n³) full-column (bisa Cholesky SPD, separuh kerja). `solveAssembly.fn` rebuild `poseOf` Map + objek per marker per residual. `maxIter` default 80.
   - `solveAssembly` penuh saat release/nudge (`app.js:19711/4379/4495`) bisa sampai ±30 lmSolve berlapis (altSolve×2 + 4 repair + 3 jitter restart, `core.js:1504–1557`) → freeze terukur di assembly ≥10 part. **Fix:** Jacobian analitik untuk residual pin/slider, reuse buffer, Cholesky, cap jitter ladder jadi 1 pass saat release sisanya idle, re-solve hanya komponen terhubung part yang digeser.
5. **Art pipeline kuadratik saat re-bake** (dan di-trigger tiap move oleh §1.1): `normalizeWinding` O(C²·V) point-in-poly (`core.js:1607–1627`) → prefilter bbox; `chainPolylines` — `splice(i,1)` O(K) + `concat` salin seluruh chain tiap merge → O(P·K) total point copy (`core.js:1631–1670`) → endpoint hash grid + merge tanpa copy.
6. **`splineIntersections`** (`app.js:6103–6141`): O(n₁·n₂·144) pair-test sample × alokasi array per pasangan dari `lineLineIntersect`/`lineCircleIntersect` (`core.js:1680/1691`). **Fix:** broad-phase bbox per segmen + out-param tanpa alokasi array.
7. **`Math.hypot` di inner loop** (`core.js:21,513,534,602,617,659,736,751,850,897,1633`): untuk MURNI perbandingan, ganti squared-distance; bila nilai perlu, `Math.sqrt(dx*dx+dy*dy)` (2–5× lebih cepat). Med tapi mudah.
8. Import-only (bukan editor jank, tetap dicatat): PDF `objs.findIndex` dalam loop xref → O(objs²) (`core.js:2636`) pakai Map; `cdrUnzip` tulis `DecompressionStream` per 256 byte dengan await per tulis (`core.js:2747`) → chunk 64 KB.

---

## Ringkasan urutan pengerjaan (untuk AI yang mengerjakan)

| # | Koreksi | Lokasi kunci | Dampak | Risiko |
|---|---------|--------------|--------|--------|
| 1 | Invalidasi cache scoped (epoch per-titik/per-entitas), jangan drop-all per move | `app.js:2274`, `6169`, `10070`, `7108` | Sangat tinggi (drag) | sedang — harus diuji terhadap jalur nudge/delete/solve agar tidak stale |
| 2 | `pointUseCache` tidak di-drop saat perubahan koordinat (hanya struktur) | `app.js:2276` | tinggi | rendah |
| 3 | Path2D world-space + `setTransform` untuk `drawArrays`/`drawArtEntity`; cache offsets per epoch | `app.js:8613`, `9966`, `10831` | tinggi (file art/clone) | sedang |
| 4 | Rebuild `getLoops` bertingkat: ekstraksi per komponen (BFS per komponen, bukan per edge) + cache persisten signature-per-komponen + idle fallback | `app.js:8036`, `8259`, `19738` | tinggi (hitch mouse-up) | sedang–tinggi (topologi) — lihat spesifikasi Prioritas 2 |
| 5 | Ganti `render()` sinkron di cabang move jadi `scheduleRender()` | `app.js:18809`, `18825`, `19013`, `18941`, `18972`, `19028` | tinggi (mouse Hz tinggi) | rendah |
| 6 | Memo `partMarkersOf` per master; indeks spasial titik untuk `hitPoint`/`snapPoint`; centroid loop di cache | `app.js:7365`, `7513`, `7964`, `2494`, `2547` | tinggi (hover/snap) | sedang |
| 7 | History/save: snapshot packed + idle/Worker, batasi bytes | `app.js:2063`, `2130`, `2206` | tinggi (hitch press & pasca-release) | sedang |
| 8 | Layer Map + memo visible per frame; `entitiesByType`; memo `entityQuickBounds` | `app.js:2063 (getLayer)`, `14090`, `7171` | sedang–tinggi | rendah |
| 9 | Perbaikan bug `dimColor` ganda | `app.js:14582` vs `15306` | sedang (visual bug + dead cache) | rendah |
| 10 | Batch `drawGrid`, memo `measureText`, DOM diff-before-write | `app.js:8345`, `15129`, `16160`, `4300` | sedang | rendah |
| 11 | core.js: linearisasi `curveStraightSpans`, binary search `flattenCubic`, debounce slider fit | `core.js:878`, `545`, `app.js:18629` | tinggi (trace/Ctrl+K) | sedang |
| 12 | core.js: Jacobian analitik/buffer reuse/Cholesky di `lmSolve`, cap jitter `solveAssembly` | `core.js:1205`, `1308`, `1546` | tinggi (assembly/constraints live) | tinggi |
| 13 | Sampling zoom-aware (`bezierCurveTo` render) | `core.js:12`, `app.js:8690` | sedang (juga akurasi visual) | sedang |
| 14 | Ganti `Math.hypot` di perbandingan → squared-distance | `core.js` banyak tempat | rendah–sedang | sangat rendah |

Catatan pengujian: indikator yang sudah tersedia di app dipakai untuk mengukur hasil — status "frame / draw ms" (`setFrameTime` `app.js:16160`). Sebelum/sesudah tiap koreksi, ukur pada file berat dengan: drag titik spline di dokumen berisi banyak spline+art, hover di file banyak part, drag part bermate, release drag pada file dengan ribuan edge loop, dan slider Ctrl+K pada trace besar. `tests/smoke.js` menjalankan core.js di Node — jaga agar tetap dependency-free (lihat `ARCHITECTURE.md`).
