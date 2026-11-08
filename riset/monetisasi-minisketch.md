# Monetisasi MiniSketch — Bisa Dijual? & Cara Menahan "Salinan Gratis"

**Tanggal:** 6 November 2026
**Basis:** baca langsung `app.js` (26.266 baris), `core.js` (3.575), `ai/chat.js` (973), `index.html`, `server/*`, `ai/*`, `tools/*`, `fonts/*`, plus `ARCHITECTURE.md`, `agents.md`, `analisa.md`, `riset/pasar-laser-cutting-shopee.md`, `riset/plan-tools-desain-cutting.md`.

> **Fokus dokumen ini:** kelayakan komersial + strategi anti-"jalanin salinan tanpa bayar".
> Analisa usability ada di `analisa.md`; performa di `performa.md`. Tidak diulang di sini.

---

## 0. Ringkasan eksekutif

**Jawaban singkat: bisa dijual, tapi MiniSketch sendiri adalah produk tier-murah, bukan pendorong revenue besar.** Yang paling lucrative bukan lisensi MiniSketch, melainkan **MiniSketch jadi pintu masuk (design front-end) ke ekosistem KaryaCNC** yang sudah Anda jual sebagai mesin.

> **Konteks dari owner yang mengubah gambar:** MiniSketch **sudah ter-embed** di binary KaryaCNC (`app.go:45`, `//go:embed all:minisketch`) dan disajikan sebagai tab "Sketcher". Jadi yang sebenarnya dibutuhkan bukan "lisensi MiniSketch", tapi **"rilis MiniSketch"** — dan strategi anti-piracy berubah total (§3 Model B).

Tiga hal yang harus dibereskan **sebelum rilis pertama**, berurutan dari yang paling fatal:

| # | Temuan | Dampak | Biaya perbaikan |
|---|--------|--------|-----------------|
| **1** | ~~`tools/Potrace.js` ber-lisensi **GPL**~~ **SELESAI (7 Nov 2026)** | Blocker closed-source. Diganti `tools/imagetracer.js` (ImageTracerJS, **Unlicense**) + wrapper `tools/trace.js` | ✅ Selesai — `tools/Potrace.js` dihapus |
| **2** | API key LLM **tertanam di git history** + `Access-Control-Allow-Origin: *` | Key bocor, bisa dipakai/dibakar biaya orang lain dari situs mana pun via CORS | ✅ **SELESAI (7 Nov 2026)** — key & endpoint dihapus dari source + history, CORS jadi allowlist, key jadi BYOK |
| **3** | Tidak ada `LICENSE`, `README`, atau `THIRD_PARTY_NOTICES` di root | Tidak layak dijual/di-share; kewajiban pencantuman lisensi MIT/Boost/OFL belum dipenuhi | 1 file EULA + 1 file notices, ±1 jam |

**Soal "orang jalankan salinan tanpa bayar":** dengan arsitektur sekarang (100% client-side, `file://`, tanpa build step, tanpa obfuscation) **tidak ada proteksi teknis yang bisa menahan salinan** — dan tidak akan pernah ada, karena kodenya dibaca plainly di DevTools.

**Tapi di Model B ini pertanyaan itu jadi sebagian besar tidak relevan.** MiniSketch memang gratis, dan itu **memang yang Anda mau** — dia funnel ke penjualan mesin. Yang harus dijaga bukan MiniSketch-nya, tapi **layer yang tidak bisa dicopy**: AI bermeter, preset/template cloud, dan preset mesin Anda.

Yang bisa dan harus dilakukan: **pindahkan nilai dari kode ke server.** Kode gratiskan (itu funnel-nya), tapi fitur yang bernilai harus hidup di server yang Anda kontrol:
- AI chat (sudah butuh server — bridge + API key)
- Template/preset produk (content yang basi kalau tidak di-update)
- Validator pre-flight & kalkulator harga
- Sinkronisasi proyek

Detail mekanisme di §5. Angka realita pasar dari `riset/pasar-laser-cutting-shopee.md`: seller Shopee laser cutting Indonesia punya margin tipis, jadi harga harus masuk akal untuk usaha kecil.

---

## 1. MiniSketch secara faktual

| Aspek | Fakta |
|---|---|
| Bentuk | Static files murni, tanpa build step, dibuka langsung dari `file://` (`ARCHITECTURE.md` — hard constraint) |
| Ukuran kode | `app.js` 26.266 + `core.js` 3.575 + `ai/chat.js` 973 + `help.js` 222 + `index.html` 735 + `styles.css` 2.648 ≈ **34.419 baris** |
| Modul | `core.js` = matematika murni (juga CommonJS untuk test), `app.js` = satu IIFE (~26 rb baris monolit) |
| Fitur inti | Constraint solver (Levenberg–Marquardt), 20+ tipe constraint, spline Bézier, boolean/offset (Clipper + path-bool), teks outline dari TTF (parse glyf sendiri), trace raster (ImageTracerJS + preview live), teks Hershey single-line, parts + assembly solver (pin/slider/string), exporter SVG, nest & kirim ke KaryaCNC |
| Generator | **12 tool** di `tools/`: box, finger, flex, gear, hinge, paintrack, paneliklan, pulltop, slidetop, slot, spiral, wall |
| AI | **30 tool** agentic (`ai/tools.json`), bridge OpenAI-compatible, model server-side, SSE streaming + reasoning |
| Integrasi mesin | Nesting HTTP `:3000/upload_svg`, WS `:8887` ke KaryaCNC, `postMessage` sinkron tema, `isWailsRuntime()` (desktop) |
| State | `localStorage` (`minisketch.v1`), autosave debounce, backup `.bak`, format `.sketch` v2 (JSON) |
| Font | 8 face dari 6 keluarga, semuanya **SIL OFL 1.1** (Liberation S/Serif/Mono, Noto Sans/Serif, Carlito) → 5,0 MB base64 |
| Repo | GitHub `ryannining/minisketch` — **private** ✓, 24 commit |
| Riset pasar | Sudah ada (`riset/pasar-laser-cutting-shopee.md`) + rencana 18 tool produk jadi (`riset/plan-tools-desain-cutting.md`) |

**Titik berat yang tidak terlihat dari luar:** solver, part/assembly, dan parse glyf TTF untuk outline teks adalah kerja yang **tidak ada di Inkscape** (Inkscape trace pakai ImageMagick/CLI; teks di-curve manual). Ini nilai engineering riil, dan justru bagian yang paling sulit ditiru.

---

## 2. Yang menghalangi penjualan (blocker)

### 2.1 GPL di Potrace — blocker utama ✅ **SELESAI**

> **Status (7 Nov 2026):** sudah diperbaiki. `tools/Potrace.js` (GPL) **dihapus**, diganti `tools/imagetracer.js` (ImageTracerJS v1.2.6, **Unlicense**) + wrapper `tools/trace.js`. Blocker closed-source sudah bersih. Detail implementasi di `ARCHITECTURE.md` §"The raster tracer".

`tools/Potrace.js` header (yang sudah dihapus):

```
/* Copyright (C) 2001-2013 Peter Selinger.
 * A javascript port of Potrace (http://potrace.sourceforge.net).
 * Licensed under the GPL
```

Potrace asli = **GPL v2+**. GPL itu *viral/copyleft*: distribute binary yang memuat kode GPL → seluruh karya kombinasi wajib GPL dan source-nya harus dibuka. Meaning:

- ❌ Menjual MiniSketch sebagai **closed-source proprietary** dengan Potrace di dalamnya = pelanggaran GPL.
- ⚠️ Menjual MiniSketch **sebagai GPL** itu legal (GPL tak melarang dijual), tapi source terbuka = siapa pun bisa fork, dan "anti-piracy" jadi tak mungkin — semua yang Anda jual bisa di-fork bebas.
- ✅ Alternatif: **ganti tracer**.

Kusage-nya cuma **satu call site**: `traceBlobToSvg()` di `app.js` (paste/drop gambar raster → vektor). Jadi penggantian terisolasi.

Opsi penggantian ( researched):

| Opsi | Lisensi | Catatan |
|---|---|---|
| **ImageTracerJS** ✅ **dipakai** | **Unlicense / public domain** | JS murni, SVG path output, tanpa syarat. Wrapper `tools/trace.js` menyembunyikan perbedaan API-nya |
| **Potrace Professional** | lisensi komersial dari Icosasoft | Algoritma identik, kualitas paling bagus, tapi biaya per lisensi |
| Trace server-side | — | Tracing pindah ke server Anda; GPL tidak berlaku karena tidak didistribusikan. Tapi ini melanggar janji "offline, tanpa network" |

**Yang dikerjakan:** ImageTracerJS tracing **semua** warna palet — background putih akan jadi rectangle raksasa yang akan dipotong mesin. Wrapper `tools/trace.js` melakukan dua hal:

1. **Binarisasi dulu** (Rec. 601 luma vs `threshold`), lalu **hanya layer gelap** yang diambil → background putih tidak pernah ikut.
2. **Preview live** di dialog trace: gambar asli + outline hasil trace, di-redraw tiap knob diubah (debounce 180 ms). Preview trace dari copy 320 px (biar cepat), tapi knob berbasis-pixel di-scaling agar preview sesuai dengan hasil full-res. Preview memakai helper `simplifyTracedPaths()` yang sama dengan `insertArt()`, jadi **jumlah kontur di bawah preview = jumlah yang benar-benar akan masuk dokumen** — bukan jumlah mentah dari tracer.

**Panel trace (revisi 7 Nov 2026):** semua knob yang memengaruhi preview sekarang **slider + kolom angka** di sebelahnya:

| Knob | Slider | Kolom angka | Arti |
|---|---|---|---|
| Detail line | 0.1 – 10 | 0.01 – 20 | seberapa dekat sisi lurus mengikuti gambar |
| Detail curve | 0.1 – 10 | 0.01 – 20 | idem untuk kurva |
| Speckle | 0 – 60 px | 0 – 200 px | gumpalan lebih kecil dibuang |
| Threshold | 0 – 255 | 0 – 255 | piksel lebih gelap dari ini = bentuk |
| Blur | 0 – 5 | 0 – 5 | blur pra-trace |
| Simplify | 0.05 – 5 px | 0.05 – 10 px | titik terlalu dekat kontur dibuang |

Kolom angka adalah **nilai yang tercatat**; slider adalah jalan cepat mendekatinya (slider menulis ke kolom, kolom menggerakkan slider). Nilai di luar rentang slider tidak hilang — kolom tetap menyimpan nilai persisnya, slider hanya "menempel" di ujung. **Semua setting disimpan saat berubah**, bukan hanya saat OK — jadi tuning yang ditinggalkan (Cancel) tetap ada di openings berikutnya.

Hasil trace sudah diverifikasi end-to-end di `testing/trace_probe.js` (**84 check**): background tidak ikut, knob terpetakan ke opsi tracer yang benar, setting lama (`alphamax`/`turdsize`) dipetakan ulang ke `detail`/`curve`/`speckle`, slider dan kolom angka sinkron dua arah, dan setting bertahan ke openings berikutnya.

> Catatan: kalau nanti MiniSketch justru diputuskan jadi **open-source GPL** (opsi sah dan sah-sahaja untuk mendapatkan kontributor), maka blocker ini hilang total dan seluruh §5 berubah jadi strategi "hosted service + premium support".

### 2.2 Lisensi lain di tree (ringkas)

| Komponen | Lisensi | Status komersial |
|---|---|---|
| `tools/clipper.js` | **Boost Software License 1.0** | ✅ komersial bebas, wajib sertakan teks lisensi |
| JSBN (Tom Wu) di dalam clipper.js | Custom BSD-like: *"All redistributions must retain an intact copy of this copyright notice and disclaimer"* | ✅ boleh komersial, **wajib sertakan file LICENSE JSBN** (belum ada di repo) |
| `tools/path-bool.js` | **MIT** | ✅ wajib sertakan copyright — `tools/path-bool.LICENSE` sudah ada ✓ |
| `fonts/hershey-data.js` | Public domain (Hershey, NIST) + repack MIT | ✅ aman |
| 8 face font | **SIL OFL 1.1** | ✅ boleh komersial & embed; **wajib sertakan teks OFL + copyright notice** (belum ada di repo) |
| `fonts/src/BillionDreams_PERSONAL.ttf` | **PERSONAL USE ONLY** | ⚠️ **tidak dibangun** (build.js hanya 8 face OFL) tapi **ter-commit** di repo — jangan sampai ikut=share/publik |
| Kode sendiri (`app.js`, `core.js`, `tools/*.js` Except vendor) | Milik Anda | ✅ |

### 2.3 Kebocoran API key — ✅ **SELESAI (7 Nov 2026)**

> **Status:** key dan endpoint hardcoded **dihapus dari source DAN dari seluruh git history** (24 commit di-rewrite; `git grep` atas semua objek bersih). CORS `*` diganti allowlist. Model bisnisnya berubah jadi **BYOK**: key milik user.

Yang tadinya ada di `server/ai-bridge.js:31` (nilai disensor di sini — jangan tulis ulang key aslinya di dokumen mana pun):

```js
const KEY = process.env.OPENAI_API_KEY || '<api key lama yang tertanam>';
const BASE = process.env.OPENAI_BASE_URL || '<endpoint pihak ketiga>';
```

Key fallback ini **sudah ter-commit** di commit awal `178da3a`. Bridge juga mengirim `Access-Control-Allow-Origin: *` (`ai-bridge.js:228`), artinya **situs web mana pun** bisa memanggil bridge lokal Anda dan memakai key itu. Konsekuensinya:

- Biaya LLM Anda dibakar orang lain.
- Kalau repo perlu di-publish → key jadi publik permanen.

**Yang sudah dikerjakan:**

| # | Tindakan | Status |
|---|---|---|
| 1 | **Rotasi key di provider** | ⚠️ **HARUS Anda lakukan** — key lama harus dianggap sudah bocor. `server/.env` masih berisi key lama sampai Anda ganti |
| 2 | Hapus fallback hardcoded | ✅ `KEY`/`BASE` sekarang hanya dari env, tanpa default |
| 3 | CORS `*` → allowlist | ✅ `originAllowed()`: file:// (`Origin: null`), localhost/127.0.0.1 port mana pun, LAN privat; sisanya **403**. Extra origin via `AI_ALLOWED_ORIGINS` |
| 4 | Purge dari history | ✅ 24 commit di-rewrite (`git filter-branch`), `refs/original` dihapus, reflog di-expire, `gc --prune=now`. Verifikasi: `git grep` atas seluruh objek → kosong |

**Perubahan model: key jadi milik user (BYOK).** Ini yang diminta, dan sekaligusavr-nya:

- **MiniSketch Settings › AI chat** gaining tiga field baru: `AI API base URL`, `AI API key` (disembunyikan/masked), `AI model`. Key disimpan di `localStorage` browser user — di mesinnya sendiri, seperti aplikasi LAIN.
- **App mengirim setting itu di setiap request** (`settings: {baseUrl, apiKey, model}`), dan bridge memakainya untuk request itu saja. **Bridge tidak menyimpan salinannya.**
- **Bridge juga menerima `POST /api/settings`** — untuk bridge milik sendiri yang dipakai banyak user, atau untuk set sekali saja.
- Kalau tidak ada key sama sekali, bridge menjawab **400 dengan pesan yang menyebut nama fieldnya** ("Set AI API key in MiniSketch Settings"), bukan crash diam-diam.

**Kenapa ini bagus untuk bisnis:** biaya LLM **tidak pernah ditanggung Anda** — tiap user pakai key-nya sendiri. Kalau nanti hosted, Anda bisa tetap metered tanpa menanggung token. Dan tidak ada key di repo Anda yang bisa dicuri.

Verifikasi: `testing/ai_bridge_probe.js` (**33 check**).

> **Sisa satu langkah (butuh Anda):** `git push --force-with-lease origin main` + tag, karena history di GitHub masih yang lama. Repo private, jadi tidak mendesak, tapi sampai itu dilakukan key lama masih ada di remote.

`server/.env` sendiri ✅ sudah tidak ter-commit (`**/.env` di `.gitignore`).

### 2.4 Yang belum ada sama sekali

- `LICENSE` (EULA proprietary) — **tidak ada**
- `README.md` — **tidak ada**
- `THIRD_PARTY_NOTICES.md` — **tidak ada** (wajib oleh MIT/Boost/JSBN/OFL)
- `LICENSE` teks OFL font — **tidak ada**
- Gate lisensi / aktivasi — **nol** (`grep license|activation|trial|premium|payment` → tidak ada hit)

---

## 3. Bisakah dijual? — dua jawaban, tergantung model bisnis

### Model A — MiniSketch sebagai produk berdiri sendiri

**Secara teknis: ya.** Produk sudah matang, ringan, jalan di browser tanpa install, dan punya diferensiasi nyata.

**Secara komersial: ya, tapi plafonnya rendah.** Pembeli potensial = seller laser cutting / operator CNC skala kecil-menengah di Indonesia. Dari `riset/pasar-laser-cutting-shopee.md`, ini persis kelompok yang buying decision-nya price-sensitive: produk Tier 1 dijual Rp1.000–50.000 dengan margin 3–5×.

Pembanding global: **LightBurn Core $99 / Pro $199** (one-time, 3 aktivasi, 1 tahun update). LightBurn jauh lebih lengkap (support banyak controller, direct machine control). MiniSketch tidak bisa — dan tidak perlu —priced di sana; narrowness-nya justru berarti price-nya harus narrow.

**Hambatan pasar**: LightBurn ~$99, Inkscape gratis, Fusion 360 gratis untuk hobby. MiniSketch harus justify harga dengan value yang **tidak** bisa didapat gratis. Value itu: (a) pipeline MiniSketch→KaryaCNC (warna = operasi mesin, ready-to-cut), (b) 12 generator orientasi produksi, (c) UI Bahasa Indonesia, (d) alur produk jadi Shopee (T0–T15 di rencana Anda).

**Rekomendasi harga (asumsi, perlu divalidasi):**

| Tier | Isi | Harga usul | Catatan |
|---|---|---|---|
| **Free** | 100% editing lokal + 12 generator + export SVG/.sketch + AI offline (`parseLocal`) | Rp0 | Funnel. Nol gesekan, nol DRM. |
| **Pro (sekali bayar)** | + export DXF & G-code, pre-flight validator, kalkulator harga, preset bahan, 1 tahun update, 3 aktivasi | **Rp500.000 / shop** | Setara ~$31. Jauh di bawah LightBurn, dan fitur bedanya nyata |
| **Cloud (berlangganan)** | + AI agent host (LLM key Anda, bermeter), pustaka template cloud, sinkronisasi proyek, update template instan | **Rp99.000/bulan** atau Rp990.000/tahun | Yang benar-benar tak bisa dicopy |
| **Workshop/Enterprise** | lisensi per kursi, support prioritas, integrasi custom | custom | Untuk bengkel >3 mesin |

Free tier harus **benar-benar berguna**, bukan crippled — supaya yang tidak bayar tetap pakai dan merekomendasikan, dan yang bayar punya alasan jelas (bukan sekadar "dilarang").

### Model B — MiniSketch sebagai funnel ke ekosistem KaryaCNC (rekomendasi)

Anda sudah memegang seluruh stack: `karyacnc` (public), `karyacontroller`, `shape-nest-optimizer`, `minisketch`. MiniSketch adalah **design front-end**; KaryaCNC + mesin adalah **yang menghasilkan uang**.

Kalau ini yang mau, jawabannya jadi jauh lebih sederhana:

- MiniSketch **gratis**, tanpa lisensi, tanpa enforcement sama sekali.
- Yang dibayar: hardware mesin, lisensi software KaryaCNC, servis/setting.
- Kontak dengan vendor lain: orang yang sudah pakai MiniSketch tidak bisa pakai tool Anda (Inkscape/Illustrator) secepat itu → konversi ke hardware Anda jauh lebih tinggi.
- Pertanyaan "orangnya jalankan MiniSketch tanpa bayar" **hampir tidak relevan** — MiniSketch gratis memang, yang mahal tetap mesin.

**Rekomendasi saya: jalankan Model B sebagai backbone, Model A sebagai upsell.** MiniSketch free + KaryaCNC berbayar. Kalau nanti terlihat ada pasar yang mau bayar untuk *software* MiniSketch-nya sendiri (bukan mesinnya), barulah Model A diaktifkan.

### Model B sudah berjalan — dan di situlah nilai sebenarnya

Fakta yang ditemukan di repo `karyacnc` (`/mnt/smbshare/wails/karyacnc`):

| Fakta | Bukti | Artinya |
|---|---|---|
| MiniSketch **sudah ter-embed** di binary KaryaCNC | `app.go:45` → `//go:embed all:minisketch` | User cukup download exe baru → langsung dapat MiniSketch. **Zero distribusi tambahan.** |
| Disajikan sebagai tab "Sketcher" | `frontend/index.html:407` (`data-tab="sketcher"`), iframe ke `/sketcher/` (`karyacnc.js:2894`) | MiniSketch **bukan aplikasi terpisah** — dia bagian dari produk yang sudah Anda jual |
| Dev-mode swap | `app.go:973-984`: kalau folder `minisketch/` ada di cwd → serve dari sana, else dari embedded FS | Rilis bisa **decouple**: taruh `minisketch/` sebagai folder terpisah alongside exe, tanpa rebuild binary Go |
| Pipeline sudah menyambung | `app.js:11737` protokol identik extension Inkscape KaryaCNC; `handleSaveSketch` (`app.go:1064`) menjembatani iframe → native save dialog | Ini **sudah** Product-Market Fit untuk alur "gambar → kirim mesin". Tidak perlu diuji lagi |
| KaryaCNC sendiri **tidak punya** lisensi/aktivasi | `grep license\|activation\|trial` → nihil di `app.go` | Monetisasi yang ada adalah hardware, bukan software |

**Artinya: yang Anda butuhkan bukan "lisensi MiniSketch", tapi "rilis MiniSketch".** Pertanyaan anti-piracy di §5 jadi jauh lebih akut setelah ini — karena begitu MiniSketch dibundle gratis ke exe, **seluruh pengguna KaryaCNC memakainya tanpa bayar, dan itu memang yang Anda mau**. Yang tidak boleh bocor ke luar adalah: (a) MiniSketch sebagai produk berdiri sendiri, (b) preset/template/AI cloud berbayar.

#### Kanal distribusi yang sudah ada (gratis)

```
KaryaCNC exe baru (satu file, ~12 MB, semua aset embedded)
   └─ tab Sketcher → MiniSketch (works offline, file:///http, tanpa install)
```

Kanal ini handle semuanya: user sudah pakai, sudah install, tidak perlu akun, tidak perlu download kedua. Ini **jauh lebih kuat** daripada menjualan lewat toko aplikasi atau jualan lisensi per-seat — dan biayanya nol.

#### Rekomendasi konkret untuk rilis

Ini menyiratkan keputusan yang lebih besar dari sekadar teknis, jadi diurutkan dari yang paling aman:

**Tahap 1 — Rilis MiniSketch ke user KaryaCNC yang sudah ada (gratis, tanpa monetisasi).**

Alasan ini soal urgency, bukan sentimental:

1. **User Anda belum tahu MiniSketch ada.** Versi lama mereka masih pakai Inkscape. Mereka mungkin sudah menemukan MiniSketch ini dari mana saja — atau belum sama sekali. Yang pasti: mereka **tidak tahu** ini bagian dari produk yang mereka beli.
2. **Setiap user yang tetap di Inkscape = satu alasan untuk tidak upgrade** (atau bahkan alasan beli software CAM lain).
3. **Rilis gratis = akuisisi gratis.** Setiap user KaryaCNC yang aktif memakai MiniSketch adalah calon pembeli mesin. Ini persis Model B, dan biayanya **nol** — Anda cuma rebuild exe.
4. MiniSketch yang lebih baik = lebih banyak orang yang pakai mesin Anda = lebih banyak demand. Ini bukan charity, ini akuisisi.

> Yang perlu diikat: **jangan.**
> - Jangan jual MiniSketch ke user KaryaCNC. Free itu funnel-nya.
> - Jangan bundel MiniSketch ke exe *dan* jual terpisah dengan fitur yang sama — user akan merasa dicurang.
> - Jangan tahan MiniSketch sebagai "keunggulan eksklusif". Edge Anda bukan editor — edge Anda adalah **mesin + CAM + dukungan**. Editor gratis justru memperkuat posisi itu.

**Tahap 2 — Monetisasi layer yang benar-benar tidak bisa dicopy:**

| Yang dijual | Kenapa tidak bisa dicopy | Hook teknis |
|---|---|---|
| **Mesin + hardware** | sudah, ini bisnis inti | — |
| **AI agent host** (bermeter) | LLM key di server Anda; tanpa server → tanpa AI | `server/ai-bridge.js` sudah ada tinggal hosted |
| **Preset bahan + template produk** | content yang basi; salinan lokal jadi usang | JSON via HTTP; `file://` → inject `<script>` |
| **Pre-flight validator + kalkulator harga** | butuh data bahan live (harga berubah) | server |
| **Preset mesin / parameter Anda** | proprietary, tied to hardware Anda | config per model mesin |

**Tahap 3 — Pisahkan MiniSketch sebagai produk berdiri sendiri (opsional, revenue tambahan).**

Untuk orang yang **tidak** memakai KaryaCNC (punya Ruida/GRBL sendiri, atau pakai LightBurn). Mereka butuh editor yang bridge ke mesin mereka. Di sini tier berbayar masuk akal — dan ini **tidak** mengorbankan Model B karena-segmentasi berbeda (mesin lain, bukan mesin Anda).

#### Soal "iri kalau orang lain jadi lebih produktif"

Ini fair, dan memang ada biayanya — tapi biayanya bukan "orang lain jadi produktif", melainkan **"user Anda tidak tahu fitur itu ada"**.

Hitung dua-duanya:
- **Tidak rilis** → user Anda tetap di Inkscape, tidak pernah tahu MiniSketch ada, dan kalau suatu saat ketemu MiniSketch (repo publik? file nyasar?) → Anda kehilangan kredit. Risiko ini **nyata dan tidak terkendali**.
- **Rilis** → user Anda langsung pakai MiniSketch, jadi lebih produktif, dan lebih **tetap** di ekosistem Anda (KaryaCNC + mesin) karena MiniSketch jadi alasan untuk tidak pindah.

Yang hilang bukan "produktivitas user", tapi **rasa memiliki**. Dan rasa memiliki itu memang tidak bisa dibayar — tapi juga tidak bisa dipertahankan lewat penahanan, hanya lewat kualitas dan dukungan.

Kalau tetap mau menahan: **tahan lewat release, bukan lewat embargo.** Rilis bertahap ke 5–10 user lama dulu (minta feedback), lalu seluruhnya. Praktisnya ini menghapus risiko "ori" tanpa mengorbankan rollout.

#### Checklist teknis rilis MiniSketch ke user KaryaCNC

Karena MiniSketch jalan di iframe `/sketcher/` dengan origin sama (`localhost:3000`), hampir semua yang sudah Anda bangun **tetap jalan** — tapi ada beberapa hal yang *harus dicek* saat MiniSketch jadi rilis produksi, bukan lagi app dev yang dibuka dari `file://`:

| # | Cek | Kenapa |
|---|---|---|
| 1 | `localStorage` tidak bentrok | Dev pakai `minisketch.v1` di origin `file://`; produksi pakai origin `http://localhost:3000` → **state berbeda**, user tidak bringing data lama. Ini harus diterima (atau di-migrate lewat `handleSaveSketch`) |
| 2 | Font loading dari `file://` → `http://` | `fonts/fonts.js` memakai `FontFace` + base64, jadi aman di `http://` juga. Tapi pastikan tidak ada `fetch()` ke path relatif yang di-block CORS |
| 3 | `saveViaHost` / `handleSaveSketch` | `app.go:1064` sudah menjembatani iframe → native save dialog. Pastikan alur ini jalan untuk file `.sketch` |
| 4 | WS ke mesin (`ws://host:8887`) | Dari iframe, `WebSocket` ke host mesin tetap jalan (bukan cross-origin fetch). Tapi kalau nanti ada `fetch` ke API luar, CORS jadi isu baru |
| 5 | `postMessage` tema (`app.js:209`) | `window.parent.postMessage(..., '*')` — sudah ada, tetap sinkron |
| 6 | Ukuran exe | `+13,6 MB` aset MiniSketch (5 MB di antaranya font base64). Cache CDN/user bandwidth — pertimbangkan lazy-load font: jangan embed 8 face sekaligus, embed 2–3 yang paling sering dipakai |
| 7 | Jalur `devPath` | Kalau folder `minisketch/` ikut tersebar di folder user, app akan serve dari sana — **hati-hati**: user bisa mengedit MiniSketch sendiri. Untuk rilis resmi, folder itu **jangan** disertakan |

Poin 7 penting: mekanisme `devPath` di `app.go:973` membuat MiniSketch **bisa diedit user** kalau folder-nya ada di cwd. Untuk rilis, pastikan hanya `//go:embed` yang aktif.

#### Strategi pemisahan: "MiniSketch independen" vs "MiniSketch bawaan"

Ini yang perlu diputuskan dan **tidak bisa dijawab tanpa pilihan tegas**:

| Opsi | Isi | Akibat |
|---|---|---|
| **X. Solo** | MiniSketch dibagikan terpisah, user download sendiri | Kontrol penuh, bisa set harga, tapi **kehilangan bundling gratis** dan harus bangun distribusi sendiri |
| **Y. Bundled only** | MiniSketch cuma di dalam exe KaryaCNC | Nol usaha distribusi, user pasti dapat — tapi **tidak ada** yang bisa bayar untuk MiniSketch |
| **Z. Dua-duanya (rekomendasi)** | MiniSketch free + standalone; monetize layer cloud/AI/preset | Bundle tetap jadi funnel; standalone menambah pasar baru (user mesin non-KaryaCNC) tanpa mengurangi nilai bundle |

Untuk **Z**, MiniSketch standalone harus tetap jalan 100% lokal (tanpa server) supaya benar-benar gratis dan berguna — dan **tidak** boleh kehilangan fitur inti yang ada di bundle. Bedanya hanya di layer cloud.


---

## 4. Realitas anti-piracy: apa yang tidak akan pernah berhasil

Sebutkan sekali, supaya tidak ada energi terbuang:

| Upaya | Kenapa gagal |
|---|---|
| License check di client-side JS | 1 baris di DevTools. Selalu gagal untuk yang berani |
| Obfuscation / minify | menaikkan waktu saja, bukan menghambat |
| Watermark geometri yang ikut terpotong | produk customer rusak → brand rusak, dan Anda kehilangan pelanggan |
| Check online wajib (login tiap buka) | bengkel punya internet jelek; Anda justru membuat mereka pirate |
| Membuka GitHub jadi publik | kode dibaca, GPL jadi liability, tidak ada yang bisa menahan |
| Password/serial di dalam `.sketch` | file format JSON, dibaca plaintext |

Yang **benar-benar** bekerja untuk software lokal ada **dua**, dan keduanya soal **arsitektur**, bukan obfuscation:

1. **Nilai hidup di server** → tidak bisa disalin.
2. **Content yang basi** → salinan lama makin tidak berguna.

---

## 5. Strategi menahan "jalankan salinan gratis" (lapisan)

### Lapisan 0 — Accept the reality (baseline)

Setiap salinan gratis = **1 pengguna nyata** di pasar Anda. Untuk software desain, itu hampir selalu untung, bukan kerugian: biaya akuisisi pengguna ini gratis untuk Anda. Jadi **jangan habiskan energi** untuk menyamarkan. Habiskan energi untuk membuat server-side tier yang benar-benar bernilai.

### Lapisan 1 — Lisensi bertanda tangan, toleran offline

Sesuai constraint "tanpa build step, `file://`-safe, plain `<script>`", implementasinya harus ringan:

```
server/
  license.js     # tabel lisensi,Issue/verify token
  serve.js       # + POST /api/license/activate, GET /api/license/status
  ai-bridge.js   # + wajibkan lisensi valid untuk panggilan LLM
```

Sisi klien — file baru `license.js` (plain script, **tanpa build**):

- Simpan lisensi terverifikasi di `localStorage` (`minisketch.v1.license`).
- Verifikasi **HMAC/Ed25519** dengan public key yang di-embed di klien → **offline-safe** (tidak perlu internet tiap buka).
- Expose `license.tier` (`'free' | 'pro'`), `license.expiry`, `license.seats`.
- **Grace period 30–90 hari** untuk mode offline, revalidasi online saat sempat. Ini wajib: bengkel sering offline.

Yang di-gate **harus di dalam fitur**, **bukan** modal "Are you licensed?" saat startup. Modal license itu cara tercepat untuk membuat orang pirate, dan bertentangan dengan aturan panel Anda sendiri (no nag, no prose, default no prompt). Gate granular:

| Fitur | Free | Pro |
|---|---|---|
| Edit, constraint, solver, 12 generator | ✅ | ✅ |
| Export SVG / `.sketch` | ✅ | ✅ |
| AI offline (`parseLocal`: "kotak 100x60") | ✅ | ✅ |
| AI agent penuh (butuh bridge+key) | ❌ | ✅ |
| Export DXF / G-code | ❌ | ✅ |
| Pre-flight validator + kalkulator harga | ❌ | ✅ |
| Template & preset cloud | ❌ | ✅ |
| Sinkronisasi proyek | ❌ | ✅ |

### Lapisan 2 — Watermark output free tier (ringan, tidak merusak produk)

Ini yang palingarah & sesuai konvensi mesin Anda sendiri:

> merah `#ff0000` = marking line **LOW POWER** (goresan permukaan, tidak tembus); semua bentuk tembus wajib hitam `#000000`.

Jadi watermark free tier **jangan** pakai hitam (akan membotong produk customer) — pakai **merah `#ff0000` sebagai garis marking**: produk tetap utuh, tapi jelas ada branding. Ini persis yang dilakukan LightBurn di free trial-nya, dan cocok dengan semantik mesin Anda.

Lokasi watermark:
- Prefer **metadata file** dulu (SVG/XML comment + field di `.sketch`) — 0 efek ke geometri, tapi tidak terlihat → deterrent lemah.
- Kalau mau terlihat: **garis marking `#ff0000`** kecil di pojok (atau optional di dialog export), plus **nama lisensi/kontak** sebagai teks di layer hijau `#00ff00` (hanya travel, tidak pernah dipotong — aman untuk produk).

Sudah ada tempatnya: `serializeDoc()` (`app.js:2547`) tinggal tambah field `license: {tier, id, issued}` — format `.sketch` v2 JSON, backward-compatible.

### Lapisan 3 — Content yang basi (senjata anti-pirasi terkuat)

Ini yang paling underused di repo Anda. Nilaiángka terbesar MiniSketch dalam 12–24 bulan ke depan bukan kodenya, tapi **content**:

- Preset bahan (akrilik/MDF/triplek: tebal, kerf, operasi warna, min feature width) — T0
- Template produk jadi Shopee: ganci, tag, magnet, coaster, signage, plakat, name tag, nomor rumah, cake topper, rak — T3–T15
- Validator pre-flight — T2
- Kalkulator HPP & harga jual — T17 (pakai data `riset/pasar-laser-cutting-shopee.md` §4)

Kalau **semua ini dispoz lewat server**, maka:
- Salinan lokal aged 30 hari → **tidak bisa pakai preset terbaru, tidak bisa pakai template produk baru, tidak ada update**.
- User yang bayar selalu punya preset & template terbaru.
- Konten adalah aset yang **tidak bisa di-fork** secara hukum maupun teknis.

Ini juga alasan bagus untuk punya server: JSON preset + template kecil, dikirim via `fetch` (catatan: `file://` memblokir `fetch` → preset harus di-inject sebagai `<script>` atau lewat server saat app disajikan via HTTP; kalau app tetap `file://` murni, preset harus di-cache via `<script>` tag injection).

### Lapisan 4 — Distribusi hygiene (rendah biaya, efek nyata)

- **Release build terpisah**: repo tetap source-readable (bagus untuk AI-maintainability & kontribusi), tapi zip pelanggan berisi **bundle minified** (gabungan `app.js`+`core.js`+`tools/*` menjadi 1–2 file). Menurunkan daya tarik "copy-paste folder & rename".
- **Sertakan notices**: `LICENSE` (EULA Anda), `THIRD_PARTY_NOTICES.md`, `OFL.txt`, `JSBN-LICENSE.txt`, `README.md` singkat.
- **Jangan sertakan** dalam zip pelanggan: `fonts/src/` (termasuk font PERSONAL USE ONLY), `server/.env`, `testing/`, `tests/`, `riset/`, `.git/`.
- **Jangan pernah** publish repo public selama Potrace GPL masih di dalam dan Anda tetap closed-source.
- Kalau share ke marketplace (Shopee/Gumroad/Tokopedia), tuliskan lisensi di halaman produk (bukan hanya di dalam zip) — itu yang enforceable secara sosial.
- **Khusus bundel KaryaCNC**: jangan sertakan folder `minisketch/` terpisah di samping exe — kalau ada, `app.go:973` akan serve dari sana dan user bisa mengedit MiniSketch. Rilis resmi hanya boleh `//go:embed`.

### Lapisan 5 — Ukur konversinya

Server Anda sudah jadi titik ukur. Yang perlu diukur: jumlah install aktif (heartbeat), tier, fitur yang dipakai. Tanpa ini, Anda tidak tahu apakah energi anti-piracy yang Anda pakai berguna atau sia-sia. Hook: `POST /api/telemetry` (anonim, opt-in di settings) — dan sesuai aturan Anda, **server-side persistence**, bukan localStorage.

### Lapisan 6 — Jual yang tidak bisa dicopy (rekomendasi utama)

Tiga hal yang secara teknis mustahil disalin orang:
1. **Kuota LLM** — key di server Anda, metered per lisensi.
2. **Template & preset cloud** — update tanpa perlu unduh ulang app.
3. **Layanan** — misal "kirim desain ke mesin + operator yang memotong", atau preset mesin/parameter Anda sendiri.

---

## 6. Checklist pra-rilis (urutan)

> Diurutkan menurut **realitas Model B**: MiniSketch dirilis gratis ke user KaryaCNC lebih dulu (Tahap 0), lalu monetization (Tahap 1+).

### Tahap 0 — Rilis ke user KaryaCNC (gratis) — prioritas utama

- [x] Rotasi API key LLM; hapus default hardcoded dari `ai-bridge.js` — ✅ key & endpoint dihapus dari source + history, CORS jadi allowlist, model jadi BYOK (user isi sendiri di Settings › AI chat)
- [x] Ganti `Access-Control-Allow-Origin: *` → allowlist — ✅ `originAllowed()`: file://, localhost, LAN privat; sisanya 403
- [ ] **Push history yang sudah di-rewrite ke GitHub** (`git push --force-with-lease origin main` + tag) — key lama masih ada di remote sampai ini
- [x] Tentukan fate Potrace: **diganti ImageTracerJS** (Unlicense) + wrapper `tools/trace.js` — `tools/Potrace.js` dihapus ✅
- [ ] Tulis `LICENSE` (EULA) + `THIRD_PARTY_NOTICES.md` + salinan `OFL.txt` + `JSBN-LICENSE.txt` + `README.md`
- [ ] Hapus `fonts/src/BillionDreams_PERSONAL.ttf` + folder `billion_dreams/` dari git (historis juga), atau pastikan tidak pernah ikut zip
- [ ] Pastikan `server/.env` tidak pernah ter-commit (✅ sudah di-ignore — pertahankan)
- [ ] Review `ai/system-prompt.txt` & `ai/tools.json` untuk data sensitif
- [ ] Verifikasi checklist teknis rilis §"Checklist teknis rilis" (localStorage origin, font, save dialog, WS, `devPath`)
- [ ] Purge key dari git history (`git filter-repo`)
- [ ] Rebuild exe KaryaCNC → distribute ke user lama (versi baru, tab Sketcher = MiniSketch)
- [ ] Landing page / README KaryaCNC: jelaskan MiniSketch menggantikan Inkscape, dengan tangkapan layar

### Tahap 1 — Monetisasi layer cloud (Model B)

- [ ] Host AI bridge (LLM key di server Anda, bermeter per lisensi/pengguna)
- [ ] Server preset bahan (T0) & pre-flight (T2) → cloud, via HTTP (atau `<script>` injection kalau `file://`)
- [ ] Template produk T3–T15 (dari `riset/plan-tools-desain-cutting.md`) → cloud
- [ ] DXF R12 export + G-code offline (butir 1 §3 `analisa.md`)
- [ ] Telemetry heartbeat (anonim, opt-in) untuk mengukur konversi

### Tahap 2 — MiniSketch standalone (Model A, opsional — revenue tambahan)

Hanya kalau ada pasar nyata (user mesin non-KaryaCNC). Pilih salah satu:

- [ ] **Opsi X — Solo**: distribusi sendiri, harga sendiri
- [ ] **Opsi Z — Dua-duanya** (rekomendasi): free + standalone, monetize yang sama seperti Tahap 1

- [ ] `server/license.js` — terbitkan token (HMAC/Ed25519), verifikasi offline di klien
- [ ] `license.js` klien — `tier`, `expiry`, gate granular per fitur tabel §5.1
- [ ] Dialog aktivasi (mengikuti aturan modal Anda: backdrop gelap swallow klik, Esc=batal, Enter=OK, fokus input pertama, Tab cycling)
- [ ] Watermark metadata di `serializeDoc()` + opsi marking `#ff0000` di dialog export
- [ ] Release build: bundling/minify script + zip whitelist
- [ ] Halaman penjualan: harga, tier, EULA, cara aktivasi, garansi

---

## 7. Yang paling perlu diputuskan

1. **Kapan rilis MiniSketch ke user KaryaCNC?** Rekomendasi: **secepatnya** — ini akuisisi gratis, biayanya nol, dan menahan justru membocorkan kontrol. Kalau mau bertahap, 5–10 user lama dulu.
2. **Potrace: ✅ sudah diganti** ImageTracerJS (Unlicense) + wrapper `tools/trace.js`, plus preview live di dialog trace. Blocker closed-source bersih.
3. **MiniSketch standalone: rilis terpisah juga?** Rekomendasi: **Ya (opsi Z)** — free + standalone, monetize di layer cloud. Bundle tetap jadi funnel.
4. **Free tier seberapa lengkap?** Rekomendasi: **lengkap untuk editing** (funnel), gate di server-side features.
5. **Nama & domain untuk host lisensi/AI?** — perlu ada sebelum sell (mis. `minisketch.id` + `api.minisketch.id`).
6. **Siapa yang opsi beli: per shop atau per-seat?** Rekomendasi: **per shop**, 3 aktivasi, seperti LightBurn — lebih mudah dari per-seat untuk pasar mikro.

---

## 8. Risiko yang belum dibahas

- **Monolit `app.js` 26 rb baris** — untuk "jual" ke pihak ketiga ini bukan masalah (mereka tak perlu baca), tapi untuk hiring/kontribusi ini liability. `ARCHITECTURE.md` + `agents.md` menunjukkan kualitas rekayasa nyata, dan itu bahan jualan ("built by a serious engineer").
- **Single-developer risk** — seluruh 34 rb baris + parser glyf + solver ada di satu kepala. Firewall: `tests/smoke.js` (regression) + 91 probe di `testing/` + invariants di `ARCHITECTURE.md`. Sudah bagus; jagakan.
- **Target pasar sempit** — ini tools untuk niche. Ekspansi ke market lebih luas (mis. general CAD) bukan prioritas; justify ke pasar sendiri.
- **`file://` vs HTTP** — kalau produk jadi server-distributed (untuk lisensi/preset/AI), `file://` masih boleh, tapi preset/AI butuh HTTP. Jangan sampai "jual" memaksa churn arsitektur besar; wrestle: **HTTP-only untuk Pro, `file://` untuk Free** — biarkan user Pro download standalone bundle yang require lisensi online saat aktivasi saja.
- **MiniSketch jadi "gratis" — apa yang hilang?** Kalau user punya editor yang jauh lebih powerful (Inkscape + extension) gratis, MiniSketch harus menang di **alur integrasi mesin**, bukan di fitur gambar. Pertahankan protokol KaryaCNC, dan jadikan template produk Shopee sebagai pembeda — bukan di feature-count CAD.
- **Rilis MiniSketch sebagai tab** — kalau tab Sketcher di user versi lama masih kosong / fitur mini, user akan bingung. Pastikan tab Sketcher di exe baru punya entry point yang jelas (welcome card, tombol "buka file .sketch", link ke docs).

---

*Dokumen terkait: `riset/pasar-laser-cutting-shopee.md` (pasar & harga), `riset/plan-tools-desain-cutting.md` (rencana tool produk jadi), `analisa.md` (usability P0/P1/P2), `ARCHITECTURE.md` (kontrak teknis — wajib dijaga), `agents.md` (testing tetap milik owner).*
