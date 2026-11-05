# Analisa MiniSketch — peluang optimasi & perbaikan agar lebih enak dipakai

Tanggal: 2026-11-05. Sumber: baca `index.html`, `styles.css`, `help.js`, `app.js` (±25rb baris), `core.js`, `tools/*.js`, `server/*`, `ai/*`, plus `ARCHITECTURE.md`, `agents.md`, `performa.md`.
Fokus dokumen ini: **usability / kenyamanan pakai**, bukan sekadar angka performa (performa sudah dibahas tuntas di `performa.md` ronde 1–5).

## 0. Ringkasan eksekutif

MiniSketch secara teknis sudah matang (solver, loop-fill cache, spatial grid titik, Path2D batching). Yang bikin **kurang enak dipakai** sekarang bukan engine-nya, melainkan:

1. **Discoverability rendah** — banyak shortcut & modifier tak terlihat, overload satu huruf (`E/Z/F`), badge constraint terlihat seperti tombol tapi tidak bisa diklik.
2. **Alur kerja terputus** — generator tanpa live-preview, tidak ada bulk-edit, transform mengunci semua tool, undo kasar (1 aksi = 2 step), export DXF/G-code offline hilang.
3. **Feedback buram** — toast overwrite 2,2 dtk (error solver/CNC mudah kelewat), solver opaque (konflik cuma toast), import gagal cuma toast generik.
4. **Sisa risiko kode** — monolit IIFE 25rb baris, history = full JSON string (120 entri), duplikasi pola di 13 tool, tanpa `window.onerror` dan tanpa backup `.bak`.

Rekomendasi P0 (dampak besar, risiko rendah, tanpa ubah engine): kbd-chip di ribbon + un-overload shortcut, badge constraint klik-hapus, toast queue + varian error sticky, hint bar kontekstual, 1 aksi = 1 undo, backup `.bak` + global error handler, export DXF R12.

---

## 1. Yang sudah bagus (jangan diutak-atik)

- Engine render: batch `Path2D` per warna, culling off-screen, decimation 8 px, snapshot-blit pan/zoom, fill loop offscreen ber-cache, fast-mode settle saat zoom (detail di `performa.md` §6).
- Hit-test: spatial hash grid titik + grid entity, hover coalesce ke rAF + change-gated, `pointUses`/`selectionIndex`/`entityPointIds` ber-cache epoch.
- Panel DOM: `setHTML`/`listUnchanged`, guard per-frame, `Commit` DOM turun 569 ms → <191 ms.
- Kontrak performa di `ARCHITECTURE.md` masih valid: jangan scan semua entity per titik, jangan tambah variabel solver di luar probe, `lmSolve` early-out, `invalidateLoops()` satu-satunya hook geometry.
- `core.js` murni + `tests/smoke.js` hijau; 91 probe di `testing/` menjaga kontrak tool.

## 2. Masalah UX konkret (urut dampak kenyamanan)

### 2.1 Shortcut overload & tak terlihat (P0)
- `E` = Separate DAN toggle driving/ref dimensi (konteks tak terlihat). `Z` = Clean DAN "seleksi sisa". `F` = Fillet vs `Shift+F` = Fit. User tidak bisa menebak arti tanpa baca help.
- Banyak shortcut hanya ada di `title`/help: `` `\ ``, `.`, `1/2/3`, `Ctrl+K/N/L/M`, `F9`, wheel-modifier offset (`Shift` 0.1 / `Alt` 5). Ribbon tidak menampilkan `kbd` chip.
- **Usul:** generate kbd-chip otomatis dari tabel `onKeyDown` agar tak basi; pindahkan toggle driving/ref dari `E` ke `Shift+E`; tambah panel `?` berupa grid shortcut yang di-generate (bukan teks statis di dua bahasa yang mudah basi).

### 2.2 Badge constraint terlihat seperti tombol tapi mati (P0)
- `help.js:85` menegaskan badge hanya hiasan; hapus harus via `Selection ×`. Ini melanggar affordance — user pasti klik badge dulu.
- **Usul:** jadikan badge klik = hapus (dengan confirm ringan / undoable), plus hover dua arah: hover list ↔ highlight canvas (pola ini sudah ada untuk parts, tinggal ditiru).

### 2.3 Hint bar tidak memandu langkah berikutnya (P0)
- `status-hint` satu baris, generik. Untuk alur multi-klik (Offset → sisi, Boolean → tool dulu baru target, Mate `Alt+T` → marker A lalu B, Dim `D` vs `Shift+D`) user harus hafal urutan.
- **Usul:** isi `statusHint()` dengan state machine per tool: `Side A ✓ → klik Side B`, `Tool ✓ → klik Target`, `Marker A ✓ → klik Marker B`. Boolean wajib tampilkan "klik TOOL dulu" karena urutan penting tapi tak ada indikasi di UI.

### 2.4 Toast overwrite, error penting hilang (P0)
- `toast()` (`app.js:1716`): satu `#toast`, 2200 ms, overwrite. Error solver (`Could not satisfy… residual…`) dan gagal CNC/nest mudah kelewat.
- **Usul:** queue + varian `ok/warn/error`; error solver & CNC = sticky sampai di-dismiss; klik status-solver `unsolved` langsung `F9`.

### 2.5 Help basi & bahasa campur (P1)
- Help masih menyebut `L/T/W/H di top bar` (kini floating canvas) dan `topbar dua menu` (status/solver/frame sudah pindah). `Biaya` vs `Estimasi Biaya`, `Make part/Mate/Nest` vs komentar Indonesia.
- **Usul:** perbaiki 3–4 kalimat basi itu dulu (murah); samakan istilah menu Bahasa Inggris vs Indonesia; generate bagian shortcut help dari sumber yang sama dengan kbd-chip (satu sumber kebenaran).

### 2.6 Layer "aktif saja yang bisa diedit" tanpa warning inline (P1)
- `entityEditable` + titik/dim hanya layer aktif — hanya dijelaskan di help. User klik objek layer lain → diam, dikira bug.
- **Usul:** saat klik objek non-aktif, toast sekali + highlight layer-nya di panel (`klik untuk pindah layer aktif`), atau tombol `isolate/solo` + rename inline di panel layer (panel kini cuma `+/-/dim`, `index.html:219-231`).

### 2.7 Tiga pola collapse berbeda + settings tersembunyi (P1)
- Sidebar slide-over (`btn-sidebar`), `stage-left` collapse via tab sendiri, `vsplit` resize manual tanpa tooltip — tiga mekanisme berbeda.
- `Auto dimension / solve / undo-view` hidup di menu Tool tapi `hidden:true` di modal Settings; tooltip hanya saat fokus → tak bisa di-scan.
- **Usul:** satukan pola collapse + ingat `localStorage`; tampilkan hidden keys sebagai `menu-linked (readonly)` di Settings + search box; tombol `Apply` jangan auto-close (atau `Apply` vs `Apply+Close` terpisah).

### 2.8 Modal Text/Image/Import terlalu ramai (P1)
- Text frame 3 titik + 2 guide + single-line vs outline + tracking/leading/align; Paste image Potrace 7 parameter sekaligus.
- **Usul:** wizard 2 langkah (esensial → advanced collapsed), samakan layout `opt-col/cnc-row`, validasi `mm/dpi` inline. Tambah badge `stroke-font` (single-line = open chain, tak bisa boolean/fit) + tombol `Convert to loop` sekali klik.

## 3. Celah workflow (fitur yang bikin bolak-balik)

| # | Celah | Dampak | Usul konkret |
|---|-------|--------|--------------|
| 1 | **Tanpa Export DXF / G-code offline / PDF 1:1** — cuma SVG + WS KaryaCNC + nest `:3000` | Bengkel tanpa server / butuh DXF harus putar via Inkscape = pemutus alur | DXF R12 (LWPolyline+ARC/CIRCLE per warna operasi) → G-code offline (profil, feed/plunge, tab/bridge, urutan potong) → PDF 1:1 |
| 2 | **Semua 13 generator tanpa live-preview** (`box/gear/wall/…` isi angka → Create baru kelihatan; revisi = double-click grup → modal lagi) | 3–5 klik per iterasi ukuran | Preview canvas + dimensi + estimasi potong di modal; `Apply live (tanpa close)` |
| 3 | **Bulk-edit nol** — tiap tool simpan `KEY` sendiri, tak ada ganti warna/operasi/layer/toleransi massal | Repetitif untuk file besar | Bar material global `T=3/4/6…` diwariskan ke box/finger/slot/hinge; panel Selection: set color/layer/offset untuk N objek; `Find same color/size → bulk` |
| 4 | **Transform mengunci segalanya** (`if(ui.transform.pending) toast(Apply or cancel)`) | Tak bisa ukur/geser lain sebelum apply/cancel | Gizmo persisten + input numerik inline; `Esc` = batal preview tanpa history |
| 5 | **Undo kasar** — `pushHistory` = full JSON, max 120; generator `push→commit→group(noHistory)→commit` = 2 step untuk 1 aksi | Undo tak terduga, memori/GC berat | 1 aksi = 1 undo; preview/array/nest jangan `commit`; label history (`Box 100×80`, `Boolean union`) di tooltip undo |
| 6 | **Solver opaque** — konflik cuma toast depan (`constraintConflict`), gagal = toast + `Ctrl+Z` | User tak tahu apa yang melawan apa | Panel Constraints (filter by type, bulk delete, toggle reference) + highlight merah objek konflik + DOF counter + auto-cleanup duplikat |
| 7 | **Import rapuh/silent** — DXF biner ditolak, `catch → toast(That file could not be read)`, glyph hilang cuma `console.warn` | File "masuk tapi rusak diam-diam" | Dialog unit/skala saat import + daftar skip (TEXT/HATCH/CLIP) + klik error lompat ke objek + log terlihat |
| 8 | **CNC/nest butuh host, gagal = toast** (`ws://host:8887`, `:3000/upload_svg`) | Tak ada antrean offline/retry | Checklist preflight 1-klik (loop terbuka/duplikat/single-line/di luar lembar) + kerf-comp otomatis dari T material + simulasi travel + antrean offline |

## 4. Sisa peluang performa (kecil — sebagian besar sudah selesai)

`performa.md` ronde 1–5 sudah memangkas `onPointerMove` 1374→228 ms, `Commit` 569→<191 ms, render 2680→1298 ms. Yang sengaja di-skip dan tetap valid sebagai roadmap:

1. World-space `Path2D` untuk entity stroke + `ctx.setTransform` (memangkas build-path saat kamera berubah; sisa rasterisasi tak bisa dihilangkan dari JS).
2. Rebuild loop idle/chunk di mouse-up (spike tersisa kecil setelah grid titik; ronde 6 incremental FULL/FAST ditunda karena kasus hapus-garis menduplikasi loop — lanjutkan hanya dengan test bed proper).
3. Solver ke Web Worker (hanya untuk drag berat dengan constraint banyak).
4. WebGL/WebGPU — hanya bila target dokumen 10× lebih besar.

Jangan buka ronde performa baru sebelum P0 usability di §2 selesai — rasionya sudah di wilayah diminishing return.

## 5. Kesehatan kode (risiko bug & maintainability)

1. **Monolit IIFE** `app.js` 25.555 baris — magnet merge-conflict, `node --check` lambat, isi tak bisa di-unit-test (hanya `core.js` yang bisa via `smoke.js`).
2. **Template duplikasi ×13 tool**: `KEY + readParams + open + apply(clamp…) + NS.close + pushHistory + commit + group + gen.params`. `tools_probe.js` menegakkan via regex — berfungsi tapi brittle.
3. **Lifecycle `snapshot/pushHistory/touch/commit` membingungkan** (`app.js:2157,2161,2417,2423`): salah urut/lupa = undo salah atau cache basi. Tool pattern `push→commit→group(noHistory)→commit` atomik hanya karena `commit` tidak push.
4. **`catch{/*ignore*/}` massal** (~60 di `app.js`) — sebagian benar (private-mode `localStorage`), sebagian menyembunyikan bug topologi (`chainPolylines catch → loops=polys`).
5. **Validasi input diam-diam**: `clamp(+el.value||def)` — `""`/`NaN`/`0` → default tanpa pesan; tiap tool bikin rentang sendiri. (`box.js:114-118`; `box.js:56` bahkan `+p[k]!=null && p[k]!=null` yang salah logika, selamat karena `isFinite` setelahnya.)
6. **Key sprawl `localStorage`** + **tanpa `window.onerror`** + **tanpa backup `.bak`** — tulis korup menimpa last-good; exception di render/drag tinggalkan state setengah termutasi.

Quick wins risiko rendah (tanpa ubah perilaku): `tools/_util.js` (`readParams/saveParams/num/finishGen`), helper `store.getJSON/setJSON` ber-prefix, tabel `push/commit/touch` di `ARCHITECTURE.md`, guard `snapshot >4 MB → cap history 40`, backup tulis `minisketch.v1.bak` (load: main → bak → blank), `window.addEventListener('error' → toast)`, `console.log` sisa di belakang `#debug`, CI mini `node --check && smoke && tools_probe`.

## 6. Rekomendasi prioritas (P0 → P2)

### P0 — kerjakan dulu (dampak besar, risiko rendah)
1. kbd-chip di ribbon + panel `?` ter-generate; pindah toggle driving/ref `E` → `Shift+E`.
2. Badge constraint klik-hapus + hover list↔canvas.
3. Hint bar kontekstual per tool (Offset/Boolean/Mate/Dim).
4. Toast queue + error sticky (solver/CNC); klik `unsolved` → `F9`.
5. 1 aksi = 1 undo; preview jangan `commit`.
6. Backup `.bak` + global error handler (menyelamatkan kerja user).
7. Export DXF R12 (membuka bengkel tanpa server).

### P1 — berikutnya (dampak sedang-besar)
8. Warning inline klik objek layer non-aktif + `isolate/solo` + rename inline layer.
9. Panel Constraints (filter, bulk delete, toggle ref, highlight konflik, DOF).
10. Generator live-preview + `Apply live` (mulai dari 1 tool, mis. `box`).
11. Bulk-edit selection (color/layer/offset) + bar material global `T`.
12. Import dialog unit/skala + daftar skip + log terlihat.
13. Unifikasi collapse + Settings search + tampilkan hidden keys.
14. Perbaiki help basi + samakan istilah bilingual.

### P2 — bila sempat / jangka menengah
15. G-code offline + PDF 1:1 + kerf-comp + tab/bridge + preflight checklist + antrean offline.
16. `tools/_util.js` + `store` helper + dokumentasi lifecycle (mengurangi bug masa depan).
17. World-space `Path2D` + rebuild loop idle/chunk (hanya bila dokumen tumbuh 10×).
18. Solver Web Worker; WebGL bila perlu.

## 7. Usul langkah konkret berikutnya

1. Saya kerjakan P0 no. 1–4 dulu (murni UI, tanpa sentuh solver/render): kbd-chip, badge klik-hapus, hint kontekstual Boolean/Mate/Offset, toast queue.
2. Lalu P0 no. 5–7: satukan undo generator, backup `.bak` + error handler, export DXF R12.
3. Setiap selesai: resep uji browser dari owner (angka `frame/draw ms` + skenario klik), sesuai `agents.md` — testing UI tetap milik owner.

---
*Performa historis & log ronde: lihat `performa.md` §6. Kontrak arsitektur yang wajib dijaga: `ARCHITECTURE.md` (invarian 1–15, performance contracts, peta `tools/`). Aturan agen: `agents.md` (jangan uji UI sendiri; kembalikan dengan resep uji).*
