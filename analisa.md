# MiniSketch — Analisis & Rencana Optimasi

Tujuan dokumen ini: menganalisis `app.js`, `core.js`, dan `tools/*.js` untuk
mencari peluang optimasi yang masih tersisa, lalu menyusun rencana eksekusi.
**Belum ada kode yang diubah** — ini murni perencanaan.

---

## 1. Ringkasan Eksekutif

Project ini sudah sangat dioptimasi. Hot-path utama (rendering, loop-detection,
hit-testing, solver, nesting) sudah memakai teknik tingkat lanjut:

- Rendering di-*coalesce* lewat `requestAnimationFrame` (satu `rafPending` flag),
  dengan *fast mode* saat zoom.
- Loop-detection memakai grid-weld + union-find + BFS (hampir linear), bukan
  scan pairwise O(n²).
- Hit-testing memakai **spatial index** (`hitGrid`) — tidak menyapu seluruh
  dokumen per gerakan kursor.
- Solver (`solveSketch`) hanya membangun variabel untuk titik/radius yang
  benar-benar disentuh residual (menghindari O(n³)).
- `lmSolve` punya *early-out* saat biaya awal ~0.
- Nesting (GA) sudah jalan di **Web Worker** terpisah.

Peluang yang tersisa umumnya bersifat **alokasi/GC pressure** di hot path
interaktif, plus beberapa perbaikan struktural/maintability. Tidak ada satu pun
yang bersifat "rewrite besar" — semuanya perbaikan terkendali.

### Prioritas keseluruhan

| Prioritas | Area | Impact | Risiko |
|---|---|---|---|
| P1 | Buffer-reuse di `lmSolve`/`solveLinear` (core.js) | Tinggi (drag) | Rendah |
| P1 | Kurangi alokasi objek di `solveAssembly`/`partMarkerWorld` | Tinggi (drag part) | Rendah |
| P2 | `hitCandidates` reuse `Set`/buffer | Sedang (hover) | Rendah |
| P2 | Offload/`yield` generator tools berat (wall/finger/gear) | Sedang (UI jank) | Menengah |
| P2 | Trace raster besar pindah ke worker | Sedang (impor) | Menengah |
| P3 | `getLoops` invalidasi inkremental | Sedang (dokumen besar) | Menengah |
| P3 | Ekstraksi helper murni ke `core.js` + hapus duplikasi tools | Maintainability | Rendah |
| P4 | Jacobian analitik untuk residual umum | Tinggi | Tinggi |

---

## 2. Konteks & Kendala yang Harus Dihormati

1. **Aplikasi dibuka langsung dari `file://`** → dilarang ES modules
   (`import`/`export` diblokir Chrome). Semua file dimuat sebagai `<script>`
   klasik, berurutan. Berarti **tanpa build step, tanpa bundler**.
2. `core.js` murni (tanpa DOM) dan **double** sebagai modul Node
   (`tests/smoke.js`). Ini fondasi yang bisa diuji — jangan dipecah tanpa
   menambahkan kasus di smoke test.
3. `app.js` adalah satu IIFE besar (±27.7k baris). Tidak bisa dipecah menjadi
   modul, tapi fungsi murni bisa **dipindah ke `core.js`** (yang memang modul).
4. **Jangan sentuh library vendored**: `tools/imagetracer.js`,
   `tools/clipper.js`, `tools/path-bool.js` / `.esm.js`, dan file `*.LICENSE`.
   `trace.js` adalah wrapper kita di atas imagetracer.
5. `nest*` sudah jalan di worker — jangan pindah kembali ke main thread.
6. Setiap perubahan harus mempertahankan invariant yang sudah dicatat di
   `ARCHITECTURE.md` (13+ invariant penyebab bug nyata).

---

## 3. Yang Sudah Bagus (Jangan Diubah)

Biarkan yang berikut apa adanya — sudah optimal:

| Area | Bukti di kode |
|---|---|
| Scheduling render | `scheduleRender()` dengan `rafPending` guard (app.js:2402) |
| Fast mode saat zoom | `fastMode` melewati fills/notes/badges selama settle |
| Batching marker | `drawPoints` menggabung ke tiga `Path2D` (bukan per-marker `beginPath`) |
| Loop weld | grid `cell=max(JOIN_TOL,1e-4)` + `sameLayer` + `sameEnds` guard (app.js getLoops) |
| Hit-testing | `hitGrid()` spatial bucketing + `loose` list (app.js:7566) |
| Solver scope | hanya variabel yang disentuh residual; early-out `cost<1e-16` |
| Nesting | GA penuh di `nest_worker.js`, progress di-throttle 25 ms |
| Trace preview | re-draw debounce 180 ms; preview ≠ hasil (kualitas, bukan perf) |
| Point cache | `pointSigTick`/`pointCachesValid` — cek layer visibility sekali per frame, bukan per marker |

Kesimpulan: jangan "optimasi" hal-hal di atas tanpa metrik yang membuktikan
ada masalah.

---

## 4. Temuan per File

### 4.1 `core.js` — solver (hot path interaktif)

**4.1.1 — Alokasi ulang buffer di `lmSolve` (P1, dampak tinggi, risiko rendah)**

`lmSolve` (core.js:1217) menciptakan buffer baru **setiap iterasi dan setiap
attempt**:

- `J = new Array(m)` lalu `J[i] = new Float64Array(n)` — per iterasi.
- `A = new Array(n)` + `A[i] = new Float64Array(n)` — per iterasi.
- `g = new Float64Array(n)` — per iterasi.
- `M = new Array(n)` + `M[a] = new Float64Array(n+1)` — **per attempt** (s/d 10
  attempt per iterasi).
- `xn = new Array(n)` — per attempt.

Selama drag, `lmSolve` dipanggil 60×/detik. Ini berarti ribuan alokasi kecil
per detik yang memicu GC dan menghentak frame.

**Rencana:** miliki *scratch buffer* yang dipakai ulang (dialokasikan sekali,
diperbesar bila perlu), dan tulis hasil ke buffer milik pemanggil. Pasang
checkbox yang sama untuk semua alokasi di dalam loop.

**4.1.2 — `solveLinear` mengalokasikan `out` (P1)**

`solveLinear` (core.js:1320) membuat `out = new Array(n)` setiap panggilan, dan
dipanggil berkali-kali di dalam attempt loop. Tulis ke buffer yang disediakan
pemanggil.

**4.1.3 — `solveAssembly`/`partTransform`/`partMarkerWorld` alokasi objek (P1)**

Setiap evaluasi residual (`fn`) di `solveAssembly` (core.js:1401):

- `poseOf(x)` membangun **Map baru** berisi objek pose `{tx,ty,rot}` untuk
  semua part — padahal hanya part yang aktif yang dibaca.
- `partTransform` mengembalikan array `[c,s,-s,c,tx,ty]` baru per marker.
- `partMarkerWorld` memanggil `matApply` yang membuat **objek `{x,y}` baru**
  per marker.

Dalam satu iterasi LM, `fn` dipanggil `n+1` kali (Jacobian beda hingga), dan
tiap panggilan mengulang alokasi di atas. Untuk mekanisme dengan banyak marker,
ini dominan.

**Rencana:**
- Lewatkan `x` langsung ke residual tanpa membangun Map penuh (hanya part yang
  dibaca residual).
- Gunakan array `[x,y]` atau objek yang dipakai ulang untuk koordinat marker
  (mis. buffer `{x,y}` scratch), atau kembalikan koordinat sebagai array.
- Hati-hati: jangan mengubah perilaku numerik (hasil harus identik).

**4.1.4 — Jacobian numerik = `n+1` eval residual per iterasi (P4, risiko tinggi)**

LM memakai beda hingga: untuk `n` variabel, tiap iterasi memanggil `fn` `n+1`
kali. Ini mahal untuk assembly besar.

**Rencana (opsional, berisiko):** turunkan Jacobian analitik untuk residual
umum (coincident, distance, pin, slider). Keuntungan: hilangkan `n` evaluasi
per iterasi. **Tapi**: menyentuh inti solver berisiko mengubah hasil konvergensi
(terutama di singularitas/dead-point). Lakukan hanya jika metrik menunjukkan
drag assembly terasa lambat, dan lindungi dengan probe `testing/assembly_probe.js`.

### 4.2 `app.js` — hit-testing, loop, render

**4.2.1 — `hitCandidates` membangun `Set` baru per query (P2)**

`hitCandidates` (app.js:7620) membuat `new Set(g.loose)` lalu menambahkan id dari
bucket setiap panggilan. Ini berjalan pada kecepatan polling mouse saat hover.

**Rencana:** untuk query kecil (kursor lokal), hindari alokasi `Set` bila
daftar kandidat pendek — cukup array yang dipakai ulang. Pastikan perilaku
identik.

**4.2.2 — `getLoops` rebuild penuh setiap perubahan geometri (P3)**

Cache loop (`loopCache`) di-*drop* seluruhnya oleh `invalidateLoops()` setiap
kali ada perubahan geometri. Pada dokumen besar dengan ribuan entitas, rebuild
semuanya meski hanya satu region berubah.

**Rencana (opsional, menengah):** invalidasi *dirty-region* / per-layer. Risiko:
korelasi antar-layer & weld membuat region lazy sulit ditentukan. Ini hanya
bernilai jika metrik menunjukkan dokumen besar lambat setelah edit kecil. Jangan
dikerjakan kalau belum terbukti jadi bottleneck.

**4.2.3 — Ukuran `app.js` (27.7k baris) — maintainability (P3)**

Bukan masalah runtime, tapi kognitif. Fungsi-fungsi geometri murni (boolean
ops, offset, loop helpers) bisa dipindah ke `core.js` agar bisa diuji lewat
smoke test dan berkurang beban satu file raksasa. Batasan `file://` tetap
dihormati (core.js sudah classic script + modul Node).

**Rencana:** pindah bertahap fungsi murni, tinjau masing-masing dengan case di
`tests/smoke.js`. Tidak menyentuh perilaku.

### 4.3 `tools/*.js` — generator

**4.3.1 — Generator berat jalan sinkron di main thread (P2)**

`wall.js` (831 baris), `finger.js`, `gear.js`, `slot.js` menghasilkan ribuan
titik/entitas. Semua `apply()` jalan sinkron → bisa **jank UI** (freze beberapa
detik) untuk input besar.

**Rencana:**
- Opsi A (mudah): sisipkan `yield` ke `requestAnimationFrame` antar-batch
  saat membangun entitas, sehingga UI tetap responsif.
- Opsi B (kompleks): pindah generasi ke worker — sulit karena tool bergantung
  pada `api` (state + helpers app.js). Tidak disarankan kecuali Opsi A terbukti
  kurang.

**4.3.2 — Duplikasi helper kecil (P3)**

`spiral.js` dan `trace.js` men-definisikan ulang helper yang sudah ada di core
(`clamp`, dll). Ini bukan perf, tapi DRY — risiko bila versi menyimpang. Rapikan
dengan memakai helper dari `api`/core.

**4.3.3 — Trace raster besar harus dipindah ke worker (P2)**

`trace.js`/`imagetracer.js` menjalankan *full-resolution* trace sinkron saat OK
ditekan. Untuk gambar besar, ini bisa terasa lama.

**Rencana:** jalankan trace (bagian murni imagetracer) di `Worker`, kirim hasil
`contours` kembali ke main thread untuk `insertArt`. Preview tetap di main thread
(downscaled 320px).

**4.3.4 — `nest.js` sudah di worker — pertahankan**

GA `nest.js` memang berat dan mengalokasikan banyak, tapi **sudah off-thread**.
Jangan pindah ke main thread. Yang bisa dipertimbangkan: mengurangi alokasi di
inner loop `nfp2`/`findBestPositionGen` hanya jika metrik worker menunjukkan
selisih besar — bukan prioritas.

---

## 5. Rencana Eksekusi (Urutan)

### Fase 1 — Quick wins, risiko rendah (dikerjakan dulu)
1. **`lmSolve` buffer reuse** (4.1.1) — scratch `J/A/g/M/xn`, tulis ke buffer
   pemanggil.
2. **`solveLinear` output buffer** (4.1.2).
3. **`solveAssembly` kurangi alokasi** (4.1.3) — tanpa mengubah hasil numerik.
4. **`hitCandidates` reuse array** (4.2.1).
5. **Tool heavy `yield` antar-batch** (4.3.1-Opsi A).

Verifikasi: `node tests/smoke.js` hijau, `node testing/assembly_probe.js`
hijau, `node testing/tools_probe.js` hijau, dan cek manual drag (frame/draw ms
di status bar harus tidak naik; hasil solve identik).

### Fase 2 — Offload & struktur (menengah)
6. **Trace raster → worker** (4.3.3).
7. **Ekstraksi murni ke `core.js`** (4.2.3) + hapus duplikasi tools (4.3.2),
   masing-masing dengan case smoke test.

### Fase 3 — Opsional/risiko (hanya jika metrik menuntut)
8. **`getLoops` invalidasi inkremental** (4.2.2).
9. **Jacobian analitik** (4.1.4).

---

## 6. Metrik yang Harus Diukur Sebelum/Sesudah

Sebelum menyetujui optimasi, ukur baseline:

1. **Status bar** `frame / draw ms` saat:
   - drag titik/garis pada file 1k & 5k titik;
   - drag part (mekanisme); 
   - hover/pan pada file besar.
2. **Solve time** (iterasi & ms) untuk skenario drag assembly.
3. **Waktu generate tool** (wall/finger/gear) untuk input besar, dan apakah UI
   beku (jank) selama generate.
4. **Waktu trace** gambar besar (mis. 2000×2000 px).
5. **GC/allokasi** di DevTools Performance untuk drag (jumlah alokasi per 10s).

Pola kerja: catat angka sebelum, lakukan satu optimasi, ukur sesudah, bandingkan.
Jangan mengubah beberapa hal sekaligus sebelum ada baseline.

---

## 7. Anti-Sasaran (Jangan Dilakukan)

- Jangan "optimasi" bagian yang sudah bagus (Bagian 3) tanpa metrik.
- Jangan pindah `nest*` kembali ke main thread.
- Jangan sentuh library vendored.
- Jangan perkenalkan ES modules / build step (melanggar constraint `file://`).
- Jangan mengubah perilaku numerik solver demi kecepatan tanpa verifikasi probe.
- Jangan menghapus early-out `lmSolve` atau scope variabel `solveSketch`.

---

## 8. Kesimpulan

Optimasi terbaik berikutnya adalah **mengurangi tekanan alokasi di hot path
interaktif** (`lmSolve`, `solveAssembly`, `hitCandidates`) — dampak tertinggi
dengan risiko terendah, dan menyelesaikan **jank UI pada generator tools berat**
serta **trace raster** yang berjalan sinkron. Rekomendasi Fase 1–2 di atas
bersifat terkendali, tidak menyentuh arsitektur, dan tetap menjaga seluruh
invariant yang sudah dicatat.
