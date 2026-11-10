# Analisa Optimasi MiniSketch — cakupan `index.html`

Dokumen ini adalah hasil analisa statis terhadap seluruh kode yang benar‑benar
terload ke browser melalui `index.html` (plus worker yang dirujuk saat runtime).
TIDAK ADA perubahan kode yang dilakukan — ini hanya analisa & perencanaan.
Baris yang disebutkan diambil dari kondisi repo saat dokumen ini ditulis
(commit `47fadaf`); jika nanti bergeser, grep nama simbolnya.

---

## 0. Ringkasan eksekutif

| Metrik | Nilai |
| --- | --- |
| Beban startup (uncompressed) | **± 2.139 KB (2.09 MB)** |
| Beban font lazy (on‑demand) | ± 4.92 MB (8 file base64 JS) |
| `app.js` | 1.147 KB / 28.302 baris = **53.7% bobot startup** |
| `core.js` | 139 KB (murni, bersih) |
| Vendor libraries | Clipper 102 KB, PathBool 147 KB, ImageTracer 47 KB, nest 62 KB |
| Fungsi mati terkonfirmasi di `app.js` | 13 + 1 definisi ganda (± 6–8 KB) |
| Fungsi mati di `core.js` / fonts | `jointCost`, `quadCubicSag`, `fontKeyOf` |
| Duplikasi antar‑file | 0 (core vs app bersih); yang ada hanya `path-bool.esm.js` (repo saja) |
| Mismatch dokumentasi | `TOOLS.md` direferensikan tapi **tidak ada**; anchor line sudah banyak bergeser |

Prioritas rekomendasi (detail di §6):

1. **P0 — Sajikan lewat HTTP + gzip/br**: transfer turun ±2.1 MB → ±500 KB.
2. **P0 — Font WOFF2**: 4.92 MB base64 TTF → hemat ±60–70% tanpa mengubah UX.
3. **P1 — Bersihkan dead code & binding legacy** (± 8–12 KB, plus pengurangan kebingungan).
4. **P1 — Hapus/unifikasi `path-bool.esm.js`** (147 KB duplikat di repo).
5. **P2 — Trim CSS tak terpakai** (diverifikasi manual; ± 50 kandidat selector).
6. **P2 — Perbaiki dokumentasi** (sudah saya edit: ARCHITECTURE.md & createtools.md).

---

## 1. Cakupan: apa yang benar‑benar di‑load browser

### 1.1 Startup (script tag di `index.html`, paragraf akhir)
```
fonts/fonts.js, fonts/hershey-data.js, fonts/hershey.js, help.js,
tools/imagetracer.js, tools/clipper.js, tools/nest.js, tools/nest_io.js,
tools/path-bool.js, tools/registry.js, tools/trace.js,
tools/box.js, slot.js, gear.js, wall.js, hinge.js, slidetop.js, pulltop.js,
paintrack.js, paneliklan.js, flex.js, finger.js, spiral.js,
ai/chat.js, core.js, app.js
```
+ `styles.css`, + 1 script inline (theme sebelum first paint).

### 1.2 Lazy / ditarik saat runtime
- **Font bundled** (`carlito.js`, `liberation-*.js`, `noto-*.js`): chỉ dimuat
  saat family itu dipilih di dialog Text (`fonts/fonts.js` — `FONT_INDEX`, lazy
  loader, inject `<script>` on demand). Total 4.92 MB TIDAK ikut startup. ✔
- **Worker**: `tools/nest_worker.js` & `tools/trace_worker.js` dipanggil lewat
  `new Worker('tools/...')` dari `app.js:13056` / `tools/trace.js:214`. Di
  `file://`, Chrome melempar SecurityError → kode sudah meng‑catch dan fallback
  ke main‑thread (resilience bagus). ✔
- **Font impor user** disimpan di IndexedDB. ✔

### 1.3 TIDAK masuk browser (di luar scope, tapi mempengaruhi repo)
- `testing/*` (probe Node), `tests/smoke.js`
- `server/*` (bridges AI + dev static server)
- `tools/path-bool.esm.js` — duplikat ESM dari `path-bool.js`; **dipakai hanya
  oleh probe Node**, tidak pernah di‑load browser (lihat §4)
- `fonts/build.js`, `fonts/src/*.ttf` (alat build)
- `backup/`, `.qoder/`, `.freebuff/`, `.commandcode/`

---

## 2. Bug ditemukan

### B1. `cmdSelectSameColor` didefinisikan dua kali — `app.js:15671` dan `app.js:27736`
Keduanya di scope IIFE yang sama → definisi **kedua menang** (function
declaration di‑hoist, yang belakangan menimpa). Konsekuensi:
- Versi `15671` (pilih bedasarkan warna tunggal, toast *"Pick an object first,
  then press Ctrl+Shift+A"*) **mati total** — tidak pernah dieksekusi.
- Perilaku sebenarnya adalah versi `27736` (multi‑warna + batasan layer).
- Risiko lanjutan: siapa saja yang mengedit versi `15671` mengira mengubah
  perilaku; hasilnya tidak ada efek. Ini juga duplikasi kode (§4).
**Rekomendasi:** hapus definisi `15671`, pertahankan `27736`.

### B2. `updateHistoryButtons()` menarget id yang tidak ada
`updateHistoryButtons()` (`app.js:2338-2343`) menulis `disabled` ke
`btn-undo` / `btn-redo` — **tidak ada** di `index.html`. Tombol undo/redo yang
asli (`qb-undo-side` / `qb-redo-side`, `index.html:262,266`) hanya di‑wire
kliknya (`app.js:25727-25730`) dan **tidak pernah** di‑update state disablednya.
→ Feedback visual "tidak ada yang bisa di‑undo" hilang (bug UI minor).
**Rekomendasi:** arahkan `updateHistoryButtons` ke `qb-undo-side` /
`qb-redo-side`.

### B3. Fitur "named selections" tanpa UI (unreachable)
`state.namedSel`, `saveNamedSelection`, `renameNamedSelection`,
`beginNamedSelectionRename`, `applyNamedSelection`, `deleteNamedSelection`
(`app.js:26398-26500+`) hanya ter‑wire ke `nsel-save`, `nsel-name`,
`nsel-list` — ketiganya **tidak ada** di `index.html`. Seluruh fitur ini tidak
bisa diakses dari UI (perhatikan: tombol *Name* di panel Selection =
`cmdNameSelection` adalah hal BERBEDA — itu memberi nama entity, bukan
menyimpan selection).
**Rekomendasi:** baik pulihkan UI-nya, atau hapus fitur + kodenya.

### B4. `updateLoopList()` no-op permanen
`updateLoopList()` (`app.js:19582`) dipanggil tiap `updateUI()` tapi langsung
`return` karena `loop-list` / `loop-count` telah dihapus dari HTML. Sisa kode
render loop‑list (± 30 baris) menjadi dead. Perilaku: lintasan `loop-list`/`loop-count` mungkin dulu bagian dari panel yang dihapus.
**Rekomendasi:** hapus fungsi + pemanggilnya.

### B5. Binding legacy ke id yang tidak ada (tidak crash, tapi dead)
Semua berikut di‑guard (`if (el) ...`) jadi tidak melempar error, tetapi
merupakan dead wiring ke elemen yang sudah dihapus/terganti di ribbon baru:

| id lama | lokasi wiring | pengganti yang ada |
| --- | --- | --- |
| `btn-undo` / `btn-redo` | 2338, 25598 | `qb-undo-side` / `qb-redo-side` |
| `btn-fit` | 25617 | `qb-fit` |
| `btn-demo` | 25635 | tidak ada (fitur demo non‑UI; masih lewat `toolApi.loadDemo`) |
| `btn-dimension` | 19140, 19260, 25719 | `qb-dimension` |
| `btn-group` / `btn-ungroup` | 26266, 26268 | `rb-group` / `rb-ungroup` |
| `btn-make-part` / `btn-mate` | 25761, 25763 | `rb-make-part` / `rb-mate` |
| `loop-list` / `loop-count` | 19583, 19586 | (panel hilang) |
| `nsel-*` | 26067-26496 | (fitur tanpa UI, lihat B3) |

Catatan khusus: `btn-dimension` dipakai sebagai *proxy* untuk men‑disable
`qb-dimension` — karena `btn-dimension` null, `if (dimBtn && qbDim)` selalu
false → logika validitas dimensi yang halus (`dimOk`, `app.js:19256-19260`)
tidak pernah diterapkan. Tombol masih ter‑disable/enable oleh aturan umum
`.qb-act` (hanya berdasarkan ada/tidaknya seleksi ber‑bounds), jadi detail
seperti "2 garis atau 2 titik" tidak tercermin di tombol. Efek nyata tapi
minor.

### B6. Mismatch dokumentasi (sudah diperbaiki di §7)
- `TOOLS.md` direferensikan oleh `ARCHITECTURE.md`, `createtools.md`, dan
  `agents.md` — file-nya **tidak ada** di repo.
- `createtools.md` menyebut `app.js` ± 24.5k baris (aktual 28.3k).
- Anchor line doc (mis. `toolApi` @ 11565 → aktual 13695; `cmdGroupSelection`
  @ 10575 → aktual 11658; `index.html` script @ 637 → aktual 803). Dokumen
  sudah memberi disclaimer "grep symbol name, bukan nomor" → tidak kami anggap
  bug, hanya perlu di‑sync.

---

## 3. Dead code terkonfirmasi

### 3.1 `app.js` — 13 fungsi tak pernah dirujuk
| Fungsi | Lokasi | Catatan |
| --- | --- | --- |
| `lineLength` | 3153 | superseded oleh `dirOf`/`lineEnds` |
| `dimensionConstraintCount` | 4431 | mati; `isDimensionConstraint` di sebelahnya dipakai |
| `hitLoopPick` | 7450 | wrapper 1 baris, tak dipanggil (`hitLoopPicks` dipakai) |
| `partLocalBounds` | 8075 | tak dipanggil (bounds part dihitung di tempat lain) |
| `framedDimCount` | 10049 | duplikat `textDimCount` (10064), yang itu dipakai |
| `identityMatrix` | 11873 | tak dipakai (komentar di sekitarnya bahkan menyebut penghapusan duplikat lama) |
| `matFromPlacement` | 11883 | tak dipakai (matrix clone dibangun inline) |
| `updateOrCreatePolarGuides` | 13958 | fitur polar guides pensiun; versi array masih hidup |
| `cmdSelectSameColor` (def #1) | 15671 | dibayangi def #2 (lihat B1) |
| `draftSizeLabel` | 18594 | superseded (label draft baru) |
| `splineHasCurves` | 21811 | tak dipakai |
| `cncModalOpen` | 25432 | tak dipakai |
| `hasGeometry` | 27774 | tak dipakai |

Estimasi: ± 6.1 KB (sekitar 175 baris) — belum termasuk rantai pemanggil
yang ikut mati serta binding legacy B5 (± 2 KB lagi).

### 3.2 `core.js`
- `jointCost` (`core.js:1535`) — closure di dalam `solveAssembly` yang **tidak
  pernah dipanggil** (`jointResiduals` yang dipakai). Sisa refactor.
- Catatan: 97 fungsi `core.js` lainnya semuanya dirujuk (intern atau oleh app/
  tools). Tidak ada fungsi top‑level mati di core.

### 3.3 Fonts
- `quadCubicSag` (`fonts/fonts.js:164`) — tak dipanggil (qInterp dipakai oleh
  `finishContour`; sag helper ini tidak).
- `fontKeyOf` (`fonts/hershey.js:77`) — tak dipanggil.

### 3.4 Catatan "kandidat mati" yang ternyata HIDUP (jangan dihapus)
`bindCanvasTapClose`, `bindSidebarPanels`, `bindStageLeftTab` — ini IIFE yang
langsung dieksekusi (`(function x(){...})()`); analisa berbasis nama members
false‑positive. `hasGeometry` dll sudah dicek ulang. `settings-help` dst di
CSS juga false‑positive (dipakai via `classList.toggle(x, bool)` atau data).

---

## 4. Duplikasi kode

1. **`cmdSelectSameColor` ganda** (§B1) — contoh duplikasi paling jelas.
2. **`path-bool.esm.js` vs `path-bool.js`** (masing‑masing ± 147 KB):
   - `path-bool.js` (classic, `window.PathBool`) → di‑load browser.
   - `path-bool.esm.js` → hanya dipakai 4 probe (`testing/boolean_exact_probe.js`,
     `polybool_shim.js`, `boolean_probe.js`, `svg_import_probe.js`).
   - Ini duplikat **di repo**, bukan di payload browser. Risiko drift antar
     dua salinan. Rekomendasi: unifikasi (probe pakai versi classic, hapus
     ESM — atau sebaliknya), simpan satu saja.
3. **`framedDimCount` vs `textDimCount`** — duplikat literal (± 18 baris
   sama); hapus `framedDimCount`.
4. **Pola try/catch `localStorage` + `read(params)`** diulang di setiap tool —
   ini **by design** (kontrak tools_probe), bukan bug. Jangan digabung.
5. **core vs app**: 0 definisi fungsi ganda (97 fungsi core tidak ada yang
   di‑define ulang di app). Split sudah bersih.
6. `help.js` menyimpan teks bantuan dwibahasa (en/id) — duplikasi tekstual
   yang disengaja (UI bilingual), bukan bug.

---

## 5. Kode tidak optimum / catatan performa

- **`app.js` monolit 28.3k baris**: bukan masalah *runtime*, tapi
  maintenance/cognitive load. Memecahnya tidak mengecilkan ukuran (sama saja)
  kecuali sekaligus menghapus dead code. Saya **tidak** merekomendasikan
  refactor besar sebagai bagian dari penghematan ukuran.
- **DOM query berulang di `updateUI()`**: `document.querySelectorAll('[data-quick]')`,
  `[data-cmd]`, `[data-arrange]`, `.tool-btn`, `.swatch-wrap` etc. dipanggil
  setiap `updateUI()` (90 call-site, semua event‑driven, bukan per frame). Ini
  fine — hanya micro‑nit: bisa di‑cache per panel.
- **`bindConstraintTools()` dipanggil dari `updateUI()`** tapi di‑guard
  `dataset.bound` → tidak ada double‑bind. ✔
- **Renderer**: sudah ada kontrak performa (batched `Path2D`, loop rebuild
  deferred, autosave terpisah untuk camera). Tidak ada temuan regresi di sini.
- **`updateLoopList()`/`updateNamedSelections()`** dipanggil tiap `updateUI()`
  walau no‑op → buang pemanggil (B4/B3).
- **Worker `file://`**: fallback main‑thread sudah ada; tidak perlu diubah.
- **getElementById berulang untuk id sama** (mis. `btn-dimension` di 3 tempat,
  `nsel-name` di 2) — micro, tidak berdampak.
- **`best`/`history`**: 120 entri snapshot — wajar.

---

## 6. Optimasi ukuran — ukuran & skala prioritas

Baseline terukur (uncompressed, startup):
```
index.html 67 KB   styles.css 63 KB
app.js 1.147 KB    core.js 139 KB   help.js 71 KB
ai/chat.js 48 KB   fonts.js 28 KB + hershey 28 KB
tools: clipper 102 KB, path-bool 147 KB, nest 62 KB,
       imagetracer 47 KB, finger 43 KB, wall 32 KB, hinge 23 KB,
       flex 20 KB, slider/pulltop 17-18 KB, trace/gear 13 KB,
       box/slot/paintrack/paneliklan/spiral 9-13 KB, registry 3 KB
TOTAL ≈ 2.139 MB
```

### P0-1. HTTP + gzip/brotli (paling besar & paling murah)
`file://` murni tidak bisa kompresi transfer. Jika disajikan lewat `server/`
atau static host mana pun: gzip/br akan menurunkan ± 2.1 MB → **± 400–550 KB**
transfer (app.js ~1.15 MB → ± 220 KB gzip). Ini mengubah "rasa" load pertama
secara drastis tanpa menyentuh kode. Catatan: kontrak "buka dari disk"
(`file://`) tetap dipertahankan untuk dev; kompetibilitas gzip adalah opsional
saat publish.

### P0-2. Font → WOFF2 (4.92 MB lazy)
8 font bundled dikirim sebagai base64 **TTF** (via `fonts/build.js` dari
`fonts/src/*.ttf`). Konversi ke WOFF2 (bezier + subset penuh) umumnya hemat
**±60–70%**: `carlito.js` 838 KB → ± 250–300 KB; `noto-serif.js` 950 KB →
± 300–350 KB; total ± 4.92 MB → ± 1.5–2 MB. Tidak mengubah beban startup
(tetap lazy); hanya mempercepat dialog Text. Perlu regenerasi `fonts/build.js`
+ data, dan `FontFace` menerima ArrayBuffer WOFF2 apa adanya. Ini perubahan
*tooling* (bukan kode aplikasi) tapi tetap butuh verifikasi owner.

### P1-3. Hapus dead code & binding legacy
Hapus 13 fungsi mati + definisi ganda `cmdSelectSameColor` + `updateLoopList`
+ kode nsel (jika fitur tidak dipulihkan) + binding B5. Estimasi **± 8–12 KB**
dari app.js, plus kejelasan. Aman selama `node tests/smoke.js` dan
`node testing/tools_probe.js` tetap hijau (fungsi yang dihapus tidak pernah
dipanggil, jadi probe tidak boleh berubah).

### P1-4. Unifikasi `path-bool.esm.js`
Hapus salinan ESM (147 KB) dan arahkan 4 probe ke `path-bool.js` (atau
sebaliknya). Murni penghemat repo, bukan payload.

### P2-5. CSS tak terpakai
± 50 kandidat selector yang tidak muncul di atribut `class`/`classList`
(heuristik; banyak yang false‑positive seperti `.xf-lock`, `.sel-color`,
`.constraint-block`, `.is-off`). Verifikasi manual per kandidat (terutama
`loop-fill`, `fill-btn`, `qb-sep`, `rail-group`, `rb-fills`, `settings-help`,
`help-sec-keys`, `topbar`, `.org`, `.and`, `.g`, `.w3`, `.hint`, `.warn`,
`.wide`, `.sticky`). Potensi trim kecil (beberapa KB).

### P2-6. Minifikasi whitespace/komentar (opsional, tradeoff)
`app.js` ± 22% komentar (≈ 253 KB dari 1.15 MB). Minifikasi penuh bisa hemat
± 200–250 KB namun: (a) harus di‑commit sebagai file terpisah (tanpa build
step), (b) menghilangkan keterbacaan — bertentangan dengan semangat repo yang
sangat berkomentar. **Disarankan hanya** jika memutuskan publish non‑`file://`
dan ingin load tercepat. Untuk sekarang: lewati.

### P2-7. `help.js` & `ai/chat.js`
71 KB help dwibahasa dan 48 KB chat adalah konten fungsional; tidak ada
penghemat mudah tanpa kehilangan fitur.

---

## 7. Konsistensi dokumentasi (EDIT SUDAH DILAKUKAN)

Perintah Anda: *"kalo perlu edit file ARCHITECTURE.md createtools.md, misal
ditemukan ketidak cocokan."* Saya sudah menerapkan koreksi kecil berikut:

1. **`ARCHITECTURE.md`**
   - Tabel File: baris `TOOLS.md` → diganti `createtools.md` (handbook
     hidup; TOOLS.md belum ada).
   - Bagian "Tools-panel generators": tautan `[TOOLS.md](TOOLS.md)` → `createtools.md`.
   - Bagian "How it runs": daftar urutan `<script>` diperbarui ke urutan
     aktual (termasuk fonts, help, nest_io, path-bool, trace, ai/chat.js, dan
     daftar generator lengkap).
   - Baris vendored libraries: ditambah `path-bool.js` (PathBool).
   - Tabel File: ditambah baris `ai/chat.js`.
2. **`createtools.md`**
   - Header: perbaiki jumlah baris `app.js` (± 24.5k → ± 28.3k).
   - §0: perbaiki anchor `index.html:637` → "dekat akhir `<body>` (sebelum
     `src="app.js"`)" agar tidak bergantung nomor baris.
   - Tambah catatan satu baris di awal bahwa `TOOLS.md` saat ini belum ada dan
     file ini yang menjadi referensi resmi.

(Catatan: anchor line lain di createtools.md sengaja dibiarkan — dokumennya
sendiri memperingatkan *"if the line has moved, grep the symbol name"*.)

---

## 8. Perencanaan tindakan (belum dieksekusi)

**Fase 0 — Verifikasi owner (browser):**
- Simpan sketsa → reload → pastikan status bar `frame / draw ms` normal.
- Uji undo/redo (perhatikan B2: tombol samping tidak pernah disabled — memang
  begitu sekarang).
- Buka dialog Text → pilih beberapa font (tes lazy load + WOFF2 setelah P0-2).

**Fase 1 — Dead code aman (P1-3):**
- Hapus: `lineLength`, `dimensionConstraintCount`, `hitLoopPick`,
  `partLocalBounds`, `framedDimCount`, `identityMatrix`, `matFromPlacement`,
  `updateOrCreatePolarGuides`, `cmdSelectSameColor` #1, `draftSizeLabel`,
  `splineHasCurves`, `cncModalOpen`, `hasGeometry`, `updateLoopList` +
  pemanggilnya; binding B5; (opsional) blok nsel jika fitur tidak dihidupkan.
- Hapus `jointCost` (core), `quadCubicSag` (fonts), `fontKeyOf` (hershey).
- Jalankan `node tests/smoke.js`, `node testing/tools_probe.js`,
  `node testing/help_probe.js` + probe tool terkait.
- Perbaiki B2 (`updateHistoryButtons` → `qb-undo-side`/`qb-redo-side`).

**Fase 2 — Ukuran (P0):**
- Putuskan target serving (file:// vs HTTP). Jika HTTP: aktifkan gzip/br.
- Rencanakan regenerasi font WOFF2 (ubah `fonts/build.js` + data).
- Unifikasi `path-bool.esm.js`.

**Fase 3 — Opsional:**
- Verifikasi CSS kandidat tak terpakai & trim.
- Evaluasi minify build hanya jika publish non‑file://.

**Syarat keluar (DoD):** semua probe repo hijau; smoke test hijau; owner
verifikasi manual di browser (karena perubahan menyentuh wiring UI).

---

## 9. Lampiran — hal yang sudah dicek dan DINYATAKAN SEHAT

- Tidak ada duplikasi definisi fungsi antara `core.js` & `app.js` (0 ganda).
- `core.js` top‑level: tidak ada fungsi mati (97/97 dirujuk, `jointCost`
  satu‑satunya closure mati).
- Font lazy loading sudah benar (tidak membebani startup).
- Model keamanan AI bridge (BYOK, CORS allowlist) benar & terdokumentasi.
- Fallback worker `file://` sudah ada.
- `registry.js` kontrak mounting tool sudah sesuai docs.
- Index `index.html` → CSS/JS: tidak ada `<script>` yang mengarah ke file yang
  tidak ada (semua 27 file ada). Worker juga ada.
