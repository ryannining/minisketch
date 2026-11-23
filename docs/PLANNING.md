# Rencana Pembangunan Dokumentasi Help MiniSketch

## 1. Tujuan

Membuat sistem bantuan (help) dalam bentuk HTML di folder `docs/` yang mencakup **semua aspek** program MiniSketch, difokuskan **per fitur**, mulai dari yang basic (Draw), Open/Import file, Settings, hingga fitur lanjutan (KaryaCNC, Nesting, AI Chat). Setiap halaman dilengkapi **screenshot asli dari aplikasi**. Halaman-halaman saling bertautan dengan halaman utama (index.html). Terdapat **tombol pencarian topik** di setiap halaman. Tampilan mirip help dari aplikasi nyata (dark theme konsisten dengan aplikasi MiniSketch).

## 2. Lingkup cakupan (semua aspek program)

| No | Fitur | File HTML | Screenshot yang digunakan |
|----|-------|-----------|---------------------------|
| 1 | Beranda & Quick Start | `index.html` | 01-tampilan-awal, 02-contoh-sketsa |
| 2 | Draw — Menggambar | `draw.html` | 05-ribbon-draw, 02-contoh-sketsa |
| 3 | Edit — Mengubah Objek | `edit.html` | 06-ribbon-edit |
| 4 | Arrange — Susun Objek | `arrange.html` | 07-ribbon-arrange |
| 5 | Constrain — Batasan & Dimensi | `constrain.html` | 08-ribbon-constrain |
| 6 | Parts — Part & Assembly | `parts.html` | 10-ribbon-parts |
| 7 | KaryaCNC — Kirim ke Mesin | `karyacnc.html` | 09-ribbon-karyacnc, 14-kirim-karyacnc |
| 8 | Berkas — Open/Import/Save/Export | `files.html` | 03-menu-file |
| 9 | Import — SVG/PDF/CDR/DXF | `import.html` | 03-menu-file |
| 10 | Teks & Font | `text.html` | 05-ribbon-draw |
| 11 | Image Trace — Jejak Gambar | `trace.html` | 11-panel-tools |
| 12 | Nesting — Tata Letak Potongan | `nesting.html` | 11-panel-tools |
| 13 | Layers & Pick Filter | `layers.html` | 01-tampilan-awal |
| 14 | Settings — Pengaturan | `settings.html` | 13-settings |
| 15 | Solver — Mode Penyelesaian | `solver.html` | 01-tampilan-awal |
| 16 | Pintasan Keyboard Lengkap | `shortcuts.html` | — (tabel referensi) |
| 17 | AI Chat (Bawa Kunci Sendiri) | `ai.html` | 01-tampilan-awal |

## 3. Struktur file di `docs/`

```
docs/
├── index.html           # Halaman utama (beranda + quick start + grid fitur)
├── draw.html            # Tab Draw — semua alat gambar
├── edit.html            # Tab Edit — transform, offset, boolean, grup, dll
├── arrange.html         # Tab Arrange — align, distribute, drag wall
├── constrain.html       # Tab Constrain — constraint & dimensi
├── parts.html           # Tab Parts — make part, mate
├── karyacnc.html        # Tab KaryaCNC — send dialog, cost, warna operasi
├── files.html           # Menu Berkas — open/import/save/export
├── import.html          # Import detail — SVG/PDF/CDR/DXF
├── text.html            # Teks & Font — single-line, system, imported
├── trace.html           # Image Trace — detail line/curve, threshold, dll
├── nesting.html         # Nesting — GA + NFP, pengaturan dan kontrol
├── layers.html          # Layers & Pick Filter — 1/2/3 titik/garis/loop
├── settings.html        # Settings — semua grup (Renderer, Geometry, dll)
├── solver.html          # Solver — on release / manual / live, amber
├── shortcuts.html       # Pintasan Keyboard Lengkap — tabel referensi
├── ai.html              # AI Chat — bridge URL, API key, model, offline
├── PLANNING.md          # Dokumen rencana pembangunan (ini)
├── help.css             # Stylesheet dark theme konsisten dengan aplikasi
├── help.js              # Shared JS: pencarian topik + tandai nav aktif
├── search-data.js       # Indeks pencarian (judul, deskripsi, tag, URL)
└── img/
    └── screenshots/     # 14 screenshot asli dari aplikasi (01–14)
```

## 4. Fitur utama dokumentasi

- **Satu halaman utama (`index.html`)**: beranda, quick start, grid fitur dengan kartu yang saling bertaut ke setiap halaman detail.
- **Navigasi samping (sidebar)**: daftar semua topik, halaman aktif ditandai, kompatibel mobile (scroll horizontal di layar kecil).
- **Tombol pencarian topik** di setiap halaman: input teks, hasil ditampilkan sebagai daftar link yang dapat diklik, filter berdasarkan judul/deskripsi/tag.
- **Breadcrumb** di setiap halaman untuk navigasi balik ke beranda.
- **Tombol "Selanjutnya / Sebelumnya"** di footer setiap halaman untuk membaca berurutan.
- **Screenshot** disisipkan di hampir setiap halaman, dengan `figcaption` keterangan.
- **Tabel pintasan keyboard** untuk referensi cepat per fitur.
- **Dark theme** yang mengikuti gaya aplikasi MiniSketch (`styles.css`).
- **Responsive**: navigasi berubah menjadi scroll horizontal di mobile, konten menyesuaikan lebar.

## 5. Tahapan pelaksanaan (sudah selesai)

| Tahap | Keterangan | Status |
|-------|------------|--------|
| 1 | Eksplorasi struktur repositori (index.html, app.js, help.js, panduan/panduan.md) | Selesai |
| 2 | Salin 14 screenshot asli dari `panduan/screenshots/` ke `docs/img/screenshots/` | Selesai |
| 3 | Buat `help.css` — stylesheet dark theme konsisten aplikasi | Selesai |
| 4 | Buat `search-data.js` — indeks pencarian semua topik (judul, deskripsi, tag, URL) | Selesai |
| 5 | Buat `help.js` — shared JS: pencarian, tandai nav aktif, hasil pencarian | Selesai |
| 6 | Buat halaman utama `index.html` — beranda, quick start, grid fitur | Selesai |
| 7 | Buat 16 halaman fitur detail (draw, edit, arrange, constrain, parts, karyacnc, files, import, text, trace, nesting, layers, settings, solver, shortcuts, ai) | Selesai |
| 8 | Verifikasi semua file HTML valid dan semua referensi screenshot tidak rusak | Selesai |

## 6. Cara membuka dokumentasi

- Buka `docs/index.html` langsung dari browser (file://) — tidak perlu server.
- Atau melalui server MiniSketch: `node server/serve.js` lalu buka `http://localhost:8090/docs/index.html`.
- Pencarian topik: ketik kata kunci di kotak pencarian di setiap halaman.

## 7. Catatan teknis

- Semua path relatif: `help.css`, `help.js`, `search-data.js` berada di `docs/`; screenshot di `docs/img/screenshots/`.
- Tidak ada dependensi eksternal, tidak perlu build step.
- Dukungan bahasa: dokumentasi dalam Bahasa Indonesia, konsisten dengan opsi Lang: Indonesia di aplikasi.
- Setiap halaman menyertakan tautan ke halaman sebelumnya dan selanjutnya untuk alur pembaca berurutan.
