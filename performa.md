# Analisa Performa Grafis — minisketch

Analisa berdasarkan: (1) profil Chrome (call tree, summary bottom-up) saat mengedit file berat dengan banyak titik diselect, dan (2) baca kode `app.js` (±25 ribu baris) dan `core.js`. **Tidak ada perubahan kode** — ini murni analisa.

## 1. Membaca data profil browser

Dari screenshot call tree (total waktu aktifitas):

| Entri | Self | Total | % | Arti |
|---|---|---|---|---|
| `Event: pointerover` | 45.3 ms | 2.438 ms | 40.9% | Waktu terbesar tersita di jalur hover/pointer |
| ↳ `onPointerMove` | 169.3 ms | 1.374 ms | 23.1% | Hit-test hover + snap per gerakan mouse |
| ↳ `onPointerUp` | 15.7 ms | 843.9 ms | 14.2% | Finalisasi select (marquee/klik) |
| `Animation frame fired` | 14.5 ms | 1.839 ms | 30.9% | Loop render |
| ↳ `render` (anon 2226) | 18.8 ms | 1.803 ms | 30.3% | Gambar penuh canvas per frame |
| ↳ `entityPointIds`, `selectionIndex`, `entityBounds`, `layerVisible` | kecil | — | — | Dipanggil berulang di dalam render |
| **`Commit` (DOM)** | **569.4 ms** | 574.5 ms | **9.7%** | Style/layout/DOM commit — mahal untuk aplikasi canvas! |

Interpretasi:

1. **Render penuh ~19 ms/frame (draw)** — sudah di batas 60 fps; dengan beban berat akan drop.
2. **`onPointerMove` 1.37 s** — hover hit-test berjalan pada rate polling mouse (125 Hz+), bukan per frame.
3. **`Commit` 569 ms** — ini DOM commit, bukan canvas. Aplikasi canvas murni seharusnya hampir nol di sini. Sumber utamanya kemungkinan besar `updateUI()` (dan turunannya: `updateSelectionInfo`, `updateConstraintList`, `updateLoopList`, `updateArrayList`, `updateTransformPanel`) yang memanggil banyak `document.querySelectorAll` dan menulis ulang DOM setiap kali seleksi berubah — dan dengan banyak titik diselect, itu terjadi sangat sering.
4. **`onPointerUp` 843 ms sekali jalan** — spike saat selesai marquee/klik. Termasuk `applyRubberSelection` (scan semua titik + semua entity) dan kemungkinan besar rebuild loop (invalidateLoops → `getLoops()` full rebuild) dipicu di satu frame.

## 1b. Konfirmasi dari data Bottom-Up (pembaruan)

Dengan bottom-up view, urutan biaya aktual (self time) menjadi jelas dan mengkonfirmasi + mempertajam dugaan:

| Fungsi | Self | Total | Catatan |
|---|---|---|---|
| `Commit` (DOM) | 569 ms | 574 ms | Konfirmasi temuan 3.3 |
| **`pointVisible`** | **486 ms** | 486 ms | BARU — lihat 3.1a di bawah |
| **`hitPoint`** | 405 ms | **874 ms (14.7%)** | Konfirmasi kuat temuan 3.1 |
| `lineTo` | 300 ms | 306 ms | Rasterisasi canvas (batching Path2D sudah bekerja; ini biaya instrinsik geometri besar) |
| `fill` / `stroke` | 196 / 127 ms | — | Idem |
| **`applyRubberSelection`** | 187 ms | **699 ms (11.8%)** | Konfirmasi kuat temuan 3.4 |
| **`bulkActive`** | **169 ms** | 201 ms | BARU — lihat 3.10 di bawah |
| `onPointerMove` | 169 ms | 1.374 ms | Konfirmasi 3.1 + 3.2 |
| `drawSegmentHighlight` | 149 ms | 329 ms | Baru — lihat 3.11 |
| `entityQuickBounds` | 148 ms | 184 ms | Dipakai hit grid; ok tapi ikut membangun grid |
| `drawPoints` | 137 ms | 267 ms | Konfirmasi 3.6 |
| `loopPath` | 134 ms | 336 ms | Konstruksi path loop (drawLoops/fills) |
| `Layout`, `Layerize`, `Hit test`, `Pre-paint` | ±90+118+71+71 ms | — | Tambahan bukti 3.3: total overhead DOM/style ±350 ms di luar Commit |
| `render` (total) | — | **2.680 ms (45.1%)** | Full-scene redraw, konfirmasi 3.8 |
| `Minor GC` | 70 ms | — | Bukti alokasi per frame (3.5, 3.6) |
| `updateCoords` | 83 ms | 118 ms | Jalur pointermove, lihat 3.9 |
| `drawEntities` | — | 645 ms | |
| `entityPointIds` | 50 ms | — | Konfirmasi 3.5 |
| `w2s` | 47 ms | — | Alokasi objek per panggilan |

### 3.1a (BARU) ✅ SELESAI (ronde 1: `pointVisible` → `pointShownCache`)

`pointVisible()`: 486 ms self, jalur terpanas ke-2

`pointVisible` (app.js:1842) memanggil `pointUses(pid)` + `layerVisible` per pemakaian. Ia dipanggil dari `hitPoint()` **per titik per event mouse** — dan `hitPoint` adalah 874 ms total. Cache `pointEditableCache`/`pointShownCache` (dengan signature per frame) sudah ada, tetapi `pointVisible` sendiri **tidak memakai cache itu**. Spatial grid titik (rekomendasi #1) membuat `hitPoint` hampir tidak pernah menyentuh `pointVisible` lagi; sebagai langkah murah tambahan, rutekan `pointVisible` lewat cache per-epoch yang sama.

### 3.10 (BARU) ✅ SELESAI (ronde 1: entityCountCache per epoch)

`bulkActive()` dipanggil per entity → O(n²) per frame

`bulkActive()` (app.js:8913) = `entityCount() >= BULK_ENTITIES`, dan `entityCount()` menghitung **for..in seluruh `state.entities`**. `drawOneEntity` memanggil `bulkActive()` hasilnya via parameter `bulk` — tetapi pemanggil lain (dan pemanggilan `bulkActive()` per draw call di jalur lain, mis. drawPoints/loop fills bila ada) menjadikannya O(entities) per panggilan. Dengan ribuan entity × ribuan panggilan per frame = jutaan iterasi for..in — cocok dengan 169 ms self yang murni loop. 

- **Saran:** cache jumlah entity (invalidate bersama `geometryEpoch`), atau hitung sekali di awal `render()` dan pass-down seperti `bulk` yang sudah dilakukan di `drawEntities`. Perbaikan satu baris, dampak langsung.

### 3.11 (BARU) ✅ SELESAI (ronde 3: satu Path2D untuk semua segmen amber + bezierCurveTo native + cache Set titik)

`drawSegmentHighlight` 329 ms total

Highlight segmen (chain yang akan di-trim/di-select) menggambar per frame penuh di atas scene. Bila highlight digambar untuk seluruh chain besar dengan stroke terpisah per segmen, itu biaya `stroke` yang terlihat di tabel. Kandidat batching `Path2D` yang sama seperti entity (kumpulkan semua segmen highlight dalam satu path, satu stroke).

Kesimpulan prioritas bertambah: **rekomendasi #1 (grid titik) kini terbukti mencakup dua item terpanas (`hitPoint` 874 ms + `pointVisible` 486 ms ≈ 21% total)**, dan perbaikan `bulkActive` masuk sebagai prioritas tinggi karena satu-line dan jelas O(n²).

## 2. Yang sudah dioptimasi (jangan diutak-atik lagi)

Kode sudah melalui banyak optimisasi yang didokumentasikan di komentar:

- Batch `Path2D` per warna untuk entity & titik (satu `stroke`/`fill` per kelompok).
- Culling off-screen, marker density (1 marker per sel 8 px), `entitySubPixel` skip.
- Snapshot blit untuk pan (`ui.pan.snap`) dan zoom (`zoomBlast`) — kamera tidak redraw penuh.
- Spatial grid hit-test untuk **entity** (`hitGridCache`, bucket per sel) — bagus.
- `selectionIndex()` berbasis Set, `layerIndex` Map, `pointUses` cache, coalescing rAF.
- Seleksi >400 entity digambar sebagai satu pass highlight, bukan stroke ganda per shape.

Jadi peluang besar yang tersisa bukan di loop gambar kasar, tapi di: **hit-test titik yang masih linear, update DOM, dan alokasi per frame**.

## 3. Temuan & peluang optimisasi (urut dampak)

### 3.1 ✅ SELESAI (ronde 1: spatial hash grid titik `pointGrid`/`pointCandidatesNear`)

`hitPoint()` dan `snapPoint()` scan SEMUA titik, linear (dampak besar, hover)

`hitPoint()` (app.js:8148) iterasi **setiap titik di dokumen** setiap kali dipanggil: `pointVisible` + `pointEditable` + `w2s()` (alokasi objek) + `Math.hypot` per titik. `snapPoint()` (app.js:2564) juga linear scan semua titik. Entity sudah punya spatial grid, **titik belum**.

- Dipanggil dari jalur hover di `onPointerMove` setiap event mouse (bukan per frame), plus dari setiap snap saat drag/draft.
- Pada file berat (ribuan titik) × 125 Hz mouse = ratusan ribu iterasi + alokasi per detik. Ini cocok dengan 1.37 s di `onPointerMove`.
- **Saran:** bangun spatial hash grid untuk titik (mirip `hitGridCache` entity), rebuild saat `invalidateLoops`/perubahan struktur, query radius 9 px. Ini memangkas hover & snap jadi O(kandidat di sel).

### 3.2 ✅ SELESAI (ronde 4: probe hover coalesced ke rAF + change-gated; ronde 5 perbaiki regresi tremor mouse)

Jalur hover berjalan per-event, bukan per-frame (dampak besar, mudah)

Komentar di kode sendiri mengaku: "Hover runs at the mouse polling rate; coalesce it like every other per-event path". Tetapi hit-test-nya sendiri (`hitPoint` → `hitDimension` → `hitEntity`) tetap dijalankan **di dalam handler** setiap event; hanya render-nya yang di-coalesce.

- **Saran:** simpan posisi pointer terakhir, dan jalankan seluruh pipeline hover (hit-test + `updateCanvasCursor`) sekali per frame di dalam rAF `scheduleRender` — bukan per event. Pada mouse 125 Hz ini langsung memangkas ~60% pekerjaan `onPointerMove`.

### 3.3 ✅ SELESAI (ronde 1–2: guard updateTransformPanel per frame, skip identical status text, setHTML/listUnchanged untuk semua panel)

`Commit` DOM 569 ms: `updateUI()` dan panel-panel (dampak besar, tersembunyi)

Ini biaya aneh untuk aplikasi canvas: 9.7% waktu habis di style/layout browser. `updateUI()` (app.js:16591) melakukan puluhan `querySelectorAll`, toggle class di semua tombol/swatch, dan memanggil `updateSelectionInfo`, `updateConstraintList`, `updateLoopList`, `updateArrayList`, `updateTransformPanel`. `render()` juga memanggil `updateStatusCounts` + `updateTransformPanel` **setiap frame** (app.js akhir render).

- Saat drag dengan banyak titik diselect, seleksi berubah/refresh sering → seluruh panel dirender ulang → `Commit` membengkak dan bersaing dengan frame budget canvas.
- **Saran:**
  - Jangan panggil `updateTransformPanel` tiap frame; hanya saat seleksi/drag benar-benar berubah nilai.
  - Kumpulkan (batch) update panel: tandai dirty, flush sekali per frame atau saat idle.
  - Panel daftar constraint/loop/array yang panjang sebaiknya di-virtualize atau minimal di-skip ketika isinya tidak berubah (bandingkan signature string sebelum menulis DOM).

### 3.4 ⏸ SEBAGIAN — applyRubberSelection turun 699→237 ms via grid titik; rebuild loop masih sinkron di pointerup (spike kecil, di-skip)

`onPointerUp` 843 ms: marquee + rebuild loop di satu frame

`applyRubberSelection` scan semua titik (linear, dengan `pointUses` + `getLayer` per titik) lalu scan semua entity. Di jalur klik juga ada `pressInsideSelectedLoop` yang memaksa `getLoops()` — dan setelah drag, cache loop selalu invalid → **deteksi loop penuh dijalankan di pointerup**, di frame yang sama dengan `updateUI()`.

- **Saran:**
  - Deferred/pecah: jalankan rebuild loop via `requestIdleCallback` atau chunk asinkron setelah paint frame pertama, bukan sinkron di pointerup.
  - Marquee titik bisa pakai spatial grid titik yang sama dengan 3.1 (rect query per sel, bukan scan semua).
  - `updateUI()` dipanggil beberapa kali berturut-turut di jalur seleksi (mis. clearSelection → updateUI → render) — cukup sekali setelah semua mutasi.

### 3.5 ✅ SELESAI (ronde 4: cache per entity id, invalidasi bersama invalidateLoops; semua call site diaudit read-only)

`entityPointIds()` mengalokasikan array baru setiap panggilan (dampak sedang, tersebar)

`entityPointIds` muncul di call tree render **dan** pointermove. Untuk `spline` ia melakukan `pts.slice()` setiap kali; untuk `array` rekursif dengan `push(...)` spread. Fungsi ini dipanggil puluhan kali per frame per entity terseleksi (drawPoints, selectionInfo, dimensions, badges, dsb.).

- **Saran:** cache hasil per entity id (Map `id → frozen array`), di-invalidate bersama `geometryEpoch`. Seleksi besar × panggilan berulang = GC pressure yang terlihat sebagai self time kecil tapi tersebar luas.

### 3.6 ✅ SELESAI (ronde 2–3: selEntPoints cache, cellSeen numerik, cull spatial via grid)

`drawPoints()` per frame: alokasi & lookup berulang (dampak sedang)

- `selEntPoints` (Set titik milik entity terseleksi) dihitung ulang **setiap frame**; dengan 1000 entity terseleksi × rata-rata titik, itu ribuan operasi per frame padahal tidak berubah selama drag. Cache bersama `selectionIndex`.
- `cellSeen` pakai Set string `x,y` — alokasi string per marker. Grid `Map<number>` dengan key `(cx<<16)|cy` jauh lebih murah.
- `pointUses(id)` + `layerOf` + `entitySubPixel` per titik per frame; bisa di-cache per geometryEpoch.

### 3.7 ✅ SELESAI (ronde 1: touchSelection() meng-invalidate cache pada mutasi in-place)

Cache `selectionIndex()` bisa stale / rebuild berulang (benar + performa)

Cache divalidasi dengan **identitas array + panjang** (`selIndexArr === ui.selection && selIndexLen === ui.selection.length`). `toggleSelect` memutasi array yang sama dengan `splice`/`push`:

- `splice` menghapus 1 lalu `push` menambah 1 → panjang bisa kembali sama, identitas sama → **cache dianggap valid padahal isi berubah** (risiko bug halus, dan bisa juga memaksa rebuild di tempat lain).
- Selain itu `selectedEntities()` membuat array baru (filter+map) setiap panggilan, dan `updateUI` memanggilnya beberapa kali.
- **Saran:** validasi cache dengan counter epoch yang di-bump setiap mutasi `ui.selection`, bukan identitas+panjang.

### 3.8 ⏸ SEBAGIAN tanpa refactor dua-layer: blit zoom/pan sudah ada; fill loop kini offscreen layer ber-cache; fast-mode settle render saat zoom; sisa: world-space Path2D untuk entity stroke (belum dikerjakan)

Render selalu full-scene (dampak sedang-jauh, kerja besar)

Setiap perubahan (hover pun!) → redraw penuh: grid, fills, loops, semua entity, semua titik, dimensi, badge. Sudah ada blit untuk pan/zoom, tapi **tidak ada layering**.

- **Saran jangka menengah:** pisah dua canvas: (a) layer statis (geometry, grid) yang hanya digambar saat geometry/kamera berubah, dan (b) layer overlay (seleksi, hover, snap marker, rubber band) yang digambar tiap frame. Saat hanya hover/seleksi berubah, cukup overlay 1–2 ms, bukan 19 ms full scene.

### 3.9 ✅ SELESAI (updateCoords di-string-guard; statusHint hanya dijalankan saat berubah)

Hal kecil lain

- `updateCoords(pos.x, pos.y)` + `statusHint()` dijalankan tiap pointermove; `statusHintText` membangun string panjang per event — jadikan event-driven (saat tool/lock berubah).
- `drawDimensions`/`drawConstraintBadges` menghitung bounds/teks tiap frame; bisa cache per geometryEpoch bila `ui.showAnnots` aktif.
- `selectedEntitiesForExport` dsb. boleh tetap, tapi pastikan tidak dipanggil di jalur render.

## 4. Rekomendasi prioritas

| # | Aksi | Perkiraan dampak | Risiko | Status |
|---|---|---|---|---|
| 1 | Spatial hash grid untuk titik (hit-test + snap) | Besar — memangkas 23% jalur pointermove | Rendah | ✅ SELESAI (ronde 1) |
| 2 | Coalesce seluruh hover/hit-test ke rAF | Besar pada mouse ber-rate tinggi | Rendah | ✅ SELESAI (ronde 4, change-gated) |
| 3 | Batch/defer update DOM panel (`updateUI`, panel per frame) | Besar — 9.7% Commit | Rendah | ✅ SELESAI (ronde 1–2) |
| 4 | Pindahkan rebuild loop keluar dari pointerup (idle/chunk) | Spike 843 ms → halus | Sedang | ⏸ SKIP — spike turun ke 237 ms setelah ronde 1 |
| 5 | Cache `entityPointIds` + `selEntPoints` + epoch-based selection cache | Sedang-besar untuk seleksi besar | Rendah | ✅ SELESAI (ronde 2 & 4) |
| 6 | Canvas dua layer (statis + overlay) | Sedang-besar, kerja besar | Sedang | ⏸ SKIP — manfaatnya sebagian besar dicapai fill-layer cache + fast-mode zoom + decimation marker |

## 5. Data yang kalau ada akan mempertajam analisa

1. **Flame chart / Bottom-Up view lengkap** (bukan hanya call tree) untuk melihat callee terbesar di dalam `onPointerMove` dan `onPointerUp` — apakah `hitPoint`, `snapPoint`, `getLoops`, atau `updateUI` yang dominan.
2. **Jumlah titik / entity / entity terseleksi** di file berat tsb (status bar atau console), supaya estimasi O(n) bisa dikuantifikasi.
3. Profil dengan **kutelan memory / GC events** (checkbox "Memory" di Performance panel) untuk mengonfirmasi dugaan alokasi (`w2s`, `entityPointIds`, string key).
4. Screenshot **Event log / frame dengan long task** saat drag, bukan hanya saat select — untuk memisahkan biaya solver vs render vs DOM.

Kirim data itu kalau mau, analisa bisa diperbarui dengan angka yang lebih presisi.

## 6. Log pengerjaan (ronde 1–5, 2026-01)

Semua commit di bawah titik aman `backup-pra-optimasi` / `9032f98`.

| Ronde | Commit | Isi |
|---|---|---|
| 1 | `660ab22` | Spatial hash grid titik (`hitPoint`/`snapPoint`), `pointVisible`→cache, cache `entityCount`, `touchSelection`, guard panel DOM per frame |
| 2 | `95b1993` | `setHTML`/`listUnchanged` — panel constraint/loop/parts/array + `updateCoords` skip rebuild saat konten sama |
| 3 | `20b16b6` | Batch segmen amber (1 Path2D), bezierCurveTo native, cache Set titik terseleksi, cull titik via grid |
| — | `d1fd862` | Decimation 8 px juga untuk marker terseleksi bulk (>500); fix bug cache null |
| 4 | `7684d37` | Cache `entityPointIds`, cache byLayer, hover hit-test ke rAF, cache Path2D loop |
| — | `0101418` | Cache `entityQuickBounds`, meta loop (visible/sel/fill) ikut frame cache |
| — | `b7e23f7` | Fast-mode settle render saat zoom (skip fills/tints/marker plain/anotasi selama window 150 ms; render penuh di ujung) |
| 5 | `c8975e3` | Fix regresi: pointermove hanya render saat hasil hover berubah |
| — | `bea85d6` | Fill loop → offscreen layer ber-cache (satu drawImage per frame); tint `drawLoops` dibatch 2 fill |
| — | `02f91f0` | Halo bulk-select jadi setting |
| — | `4246fe8` | Halo bulk-select dihapus permanen (glow biru 4.5× lebar garis = satu rasterisasi penuh ekstra per frame) |

### Hasil ukur (profil 12 s, file uji: 9103 garis · 1081 kurva · 24613 titik · 1420 loop)

| Metrik | Awal | Setelah ronde 1–2 |
|---|---|---|
| `onPointerMove` | 1374 ms (23%) | 228 ms (7%) |
| `hitPoint` + `pointVisible` | 1360 ms | ≈0 di papan teratas |
| `applyRubberSelection` | 699 ms | 237 ms |
| `Commit` DOM | 569 ms | 191 ms (lalu lebih kecil lagi setelah ronde 2) |
| render total | 2680 ms | 1298 ms |
| drawPoints | 291 ms/frame papan atas | ter-cull via grid + decimation |
| drawLoopFills | 84 ms + fill 126 ms | satu drawImage (cache) |

### Yang sengaja tidak dikerjakan (roadmap kalau suatu saat perlu)
1. World-space Path2D untuk entity stroke + `ctx.setTransform` — memangkas biaya build path saat kamera berubah (sisa biaya rasterisasi tidak bisa dihilangkan dari JS).
2. Rebuild loop idle/chunk di mouse-up (spike tersisa kecil).
3. Solver ke Web Worker (drag berat dengan constraint banyak).
4. WebGL/WebGPU — hanya untuk target dokumen 10× lebih besar.

## 7. Ronde 6 (ditunda): incremental loop rebuild
Implementasi dua-jalur FULL/FAST per komponen pernah dibuat (commit db1967a,
arsip /tmp/app_incremental_wip.js) mengikuti desain: identitas loop per
komponen; hapus/tambah/trim/geser titik hanya membangun ulang komponen
terkait; FULL hanya untuk load/import/F8.
Status: kasus geser titik LULUS, kasus hapus garis menduplikasi loop
(bookkeeping pointComps belum benar). Dikembalikan ke versi stabil
(rebuild penuh sekali per perubahan geometry, ±100–120 ms per 1000 loop,
semua pembacaan cached). Dilanjutkan nanti dengan test bed yang proper.
