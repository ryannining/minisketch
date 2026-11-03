# Rencana Tools: Desain Siap Cutting untuk Produk yang Dijual

**Status:** DRAF — belum ada implementasi. Dokumen ini rencana murni, untuk direview sebelum coding.
**Tanggal:** 31 Oktober 2026
**Relasi:** melanjutkan [`pasar-laser-cutting-shopee.md`](pasar-laser-cutting-shopee.md) — katalog produk &amp; tier di dokumen itu adalah sumber kebutuhan di sini.
**Basis teknis:** `ARCHITECTURE.md` (MiniSketch) dan `TOOLS.md` (kontrak tool).

---

## 1. Tujuan

Menyusun daftar tool di panel **Tools** MiniSketch yang membuat desain **siap cutting** untuk produk yang terbukti laris di Shopee, sehingga satu pesanan bisa diselesaikan dalam hitungan menit, bukan digambar ulang tiap kali.

**Apa artinya "siap cutting"** — didefinisikan dulu supaya semua tool punya target yang sama:

- [ ] Semua loop tertutup, tidak ada path terbuka yang tidak disengaja -&gt; tidak harus
- [x] Warna = operasi CNC: `#000000` cut · `#0000ff` engrave · `#ff0000` drill · `#800080` pocket · `#00ff00` konstruksi (tidak pernah ikut dipotong, tidak pernah masuk group)
- [x] Teks sudah dalam bentuk outline yang benar (bukan single-line kecuali memang diinginkan), dan outline cache-nya valid terhadap `FONT_EPOCH`
- [ ] Sudah diterapkan kompensasi kerf untuk fitur press-fit (slot = tebal + kerf) -&gt; kompensasi ada di software laser cuttingnya
- [ ] Semua objek berada di dalam batas lembar bahan -&gt; saat desain hanya desain, urusan bahan di software laser cutting
- [x] Tidak ada path duplikat/tumpang tindih (ganda = dua kali potong = bahan gosong)
- [ ] Ukuran akhir cocok dengan tebal bahan yang benar-benar dipakai
- [ ] Sudah lolos pre-flight validator (tool T2, lihat §4)

---

## 2. Peta kapasitas yang sudah ada

Dicek langsung dari isi repo. **Ini yang tidak perlu dibangun ulang:**

### Sudah ada — generator (file di `tools/`)


| Tool         | id           | Fungsi                                                    |
| ------------ | ------------ | --------------------------------------------------------- |
| Box maker    | `box`        | Kotak finger joint, panel datar siap potong               |
| Hinge box    | `hinge`      | 6 panel dengan sudut knuckle bundar                       |
| Slide top    | `slidetop`   | Kotak dengan lid meluncur di alur                         |
| Pull top duo | `pulltopduo` | Dinding + dua atas geser + clip                           |
| Extrude wall | `wall`       | Loop jadi set flat-pack + living hinge, bawa param `kerf` |
| Slot         | `slot`       | Garis/kurva lingkaran jadi outline slot                   |
| Gear         | `gear`       | Spur gear, rack, pulley                                   |
| Paint rack   | `paintrack`  | Rak cat bertingkat                                        |
| Panel iklan  | `paneliklan` | Bidang bersudut membulat + lubang pen                     |


### Sudah ada — kemampuan infrastruktur


| Kemampuan                       | Lokasi                                  | Relevansi                                  |
| ------------------------------- | --------------------------------------- | ------------------------------------------ |
| **Nesting** ke server KaryaCNC  | tombol `Nest` di `index.html`           | Optimasi sisa lembar — sudah terhubung     |
| **Array** grid / melingkar      | `qb-array`, `btn-array`                 | Produksi massal (100 ganci sekaligus)      |
| **Offset** + preview live       | `Ctrl+O`, lewat Clipper                 | Kompensasi kerf, border ring, inlay socket |
| **Boolean** path                | `tools/path-bool.js`                    | Ornamen, lubang, siluet                    |
| **Trace gambar**                | `tools/Potrace.js`                      | Wall art dari foto/logo                    |
| **Teks outline + Hershey**      | `fonts/`                                | Semua produk bertulisan                    |
| **Ekspor CNC berwarna operasi** | `app.js`                                | Pipeline ke mesin                          |
| **Tool untuk AI agent**         | `ai/tools.json`, `ai/system-prompt.txt` | Desain via perintah                        |


### Kesenjangan yang terlihat

1. **Tidak ada preset bahan.** `kerf` masih parameter per-tool (default 0.4 di `wall.js`) — belum ada satu tempat yang menyimpan "akrilik 3mm = kerf X, MDF 3mm = kerf Y".
2. **Tidak ada pre-flight check.** Tidak ada yang mengecek otomatis apakah desain benar-benar layak potong sebelum diekspor.
3. **Tidak ada generator produk jadi Tier 1/Tier 2.** Tool yang ada orientasinya ke peralatan &amp; kotak (gear, rak, box), bukan ke katalog Shopee (ganci, signage, plakat, nomor rumah).
4. **Tidak ada kalkulator harga.** Padahal riset §4 sudah punya tarif jasa dan rumus markup.

---

## 3. Usulan tool, dipetakan ke tier produk

Setiap entri: **ID sementara · produk Shopee yang dilayani · parameter · keluaran · prioritas · estimasi upaya · pertanyaan untuk review.**

Prioritas: **P0** fondasi / pengungkit terbesar · **P1** penghasil omzet · **P2** menyusul.

### Fase A — Fondasi (P0, sebelum generator produk)

#### T0 — Preset bahan &amp; profil potong

- **Layani:** semua produk (bukan produk langsung)
- **Isi:** profil bahan `Akrilik 2/3/4/5 mm`, `MDF 2/3/4 mm`, `Triplek 3/6 mm` — masing-masing menyimpan: tebal default, kerf, warna operasi, saran daya/kecepatan (catatan, bukan kontrol mesin), dan apakah press-fit atau glue-fit.
- **Keluaran:** dropdown bahan yang dibaca oleh semua tool lain (T3–T15), plus nilai kerf global.
- **Kesenjangan yang diisi:** `wall.js` menyimpan `kerf` sendiri-sendiri → dua home untuk satu setting, persis bug yang tercatat di `ARCHITECTURE.md`.
- **Upaya:** kecil–sedang. **Keputusan perlu review:** simpan di `SETTINGS_SPEC` atau record terpisah? *(catatan: satu sumber kebenar, jangan dua)*

#### T1 — Lembar bahan &amp; laporan utilisasi

- **Layani:** semua produk
- **Parameter:** ukuran lembar (preset: 300×200, 400×600, 600×400, 1200×600, custom)
- **Keluaran:** persegi batas lembar (warna `#00ff00`), semua isi yang jatuh di luarnya ditandai, dan angka **% pemakaian lembar** + sisa luas.
- **Interaksi:** melengkapi tombol `Nest` yang sudah ada — Nest menata, T1 mengukur.
- **Upaya:** kecil. **Pertanyaan:** ukuran lembar apa yang benar-benar Anda beli?

#### T2 — Pre-flight validator ("Cek siap cutting")

- **Layani:** semua produk — ini alasan utama desain gagal di mesin
- **Parameter:** pilihan (cek loop terbuka, path duplikat, teks single-line, objek di luar lembar, fitur lebih sempit dari minimum, konstruksi hijau tertinggal, warna tak dikenal)
- **Keluaran:** daftar temuan, tiap temuan bisa diklik untuk memilih objek bermasalah.
- **Upaya:** sedang. Nilainya tinggi: menangkap kesalahan sebelum bahan terbuang.
- **Pertanyaan:** minimum feature width berapa mm untuk tiap bahan?

#### T6 — Batch text / penukar nama

- **Layani:** Tier 1 &amp; 2 — pesanan 100 pcs dengan 100 nama berbeda
- **Parameter:** teks multi-baris (satu baris = satu unit), template target (pilih group hasil tool), kolom/baris penataan, jarak
- **Keluaran:** clone template dengan teks diganti per baris → Array sudah menata grid, T6 mengisi variabelnya.
- **Ini pengungkit terbesar:** tanpa ini, 100 nama = 100× buka-tutup dialog.
- **Upaya:** sedang. **Pertanyaan:** input dari paste saja, atau perlu baca CSV?

---

### Fase B — Tier 1: volume &amp; rating (P1)

#### T3 — Ganci / keychain maker

- **Produk:** gantungan kunci akrilik/kayu custom *(riset §3 Tier 1, paling ramai)*
- **Parameter:** bentuk dasar (bulat / persegi membulat / heksagon / ambil loop terpilih), ukuran (default 40×25 mm), tebal bahan, Ø lubang ring (3–5 mm), inset lubang, opsi teks/grafir 1 sisi atau 2 sisi, fillet sudut
- **Keluaran:** outline potong + lubang + area teks; satu named group dengan `gen.params`
- **Upaya:** kecil–sedang (siluet dari loop sudah didukung `offsetClosedChains`; lubang ada di `cornerholes` sebagai referensi pola)
- **Pertanyaan:** jual satuan atau langsung dalam paket 12/24 untuk nesting?

#### T4 — Tag &amp; label maker

- **Produk:** label botol, label rak, label gantung, label jarik *(Tier 1)*
- **Parameter:** ukuran (mis. 60×25 mm), tebal, sudut bulat, Ø lubang, opsi slot gantung, jumlah dalam grid
- **Keluaran:** outline + lubang, siap Array
- **Upaya:** kecil — tumpang tindih besar dengan T3, **pertimbangkan gabung jadi satu tool "Tag maker"** dengan preset bentuk.

#### T5 — Pelat dasar bundar/persegi (coaster, magnet kulkas, pin base)

- **Produk:** magnet kulkas akrilik custom, coaster, pin/badge *(Tier 1)*
- **Parameter:** bentuk, ukuran standar (Ø80 coaster, 40×40 magnet), tebal, teks
- **Upaya:** kecil. Bisa jadi **preset di dalam T3/T4** alih-alih tool terpisah.

> **Keputusan untuk review:** T3 + T4 + T5 apakah jadi **satu tool serbaguna** ("Tag &amp; plate maker" dengan pilihan bentuk) atau **tiga tool terpisah**? Tool terpisah = dialog lebih sederhana tapi tombol Tools panel makin panjang; satu tool = dialog lebih kompleks. `TOOLS.md` menyarankan id unik per tool dan tiap tool satu file.

---

### Fase C — Tier 2: margin sebenarnya (P1)

#### T7 — Signage maker

- **Produk:** signage &amp; papan nama akrilik custom, logo toko *(riset Tier 2, Rp17.500–143.100)*
- **Parameter:** ukuran panel (mis. 250×100 mm), tebal, sudut, lubang mounting, **jumlah lapis** (teks timbul 2–3 lapis), jenis teks/logo, backing (tanpa / kayu / akrilik warna)
- **Keluaran:** per lapis satu panel + outline teks/logo yang di-cut terpisah + tanda registrasi penumpuk
- **Catatan:** `paneliklan.js` sudah punya "bidang bersudut membulat + lubang pen" — T7 bisa dibangun di atas pola itu dan menambah lapisan teks.
- **Upaya:** **sedang–besar** (bagian tersulit: auto-fit teks ke dalam panel dan menghasilkan outline huruf yang aman dipotong — ada `framed_fit_probe.js` dan `nest_text_probe.js` sebagai preseden)
- **Pertanyaan:** berapa lapis maksimum yang realistis dirakit?

#### T8 — Name tag, nomor meja &amp; standing

- **Produk:** name tag karyawan, nomor meja restoran, papan meja *(Tier 2)*
- **Parameter:** ukuran, tebal, lubang / slot tegak, sudut tegak, tinggi base
- **Keluaran:** panel + base dengan slot (reuse pola `slot` + `box`)
- **Upaya:** sedang

#### T9 — Plakat / piagam stand

- **Produk:** plakat akrilik, piagam penghargaan, vandel wisuda *(Tier 2, grosir korporat)*
- **Parameter:** ukuran panel, jenis kaki (base lurus / sandaran / tiang), jumlah lapis, area grafir teks
- **Keluaran:** panel + base + opsi lapis grafir
- **Upaya:** sedang. **Pertanyaan:** apakah perlu preset template piagam (bentuk per/sertifikat)?

#### T10 — Nomor rumah &amp; nomor pintu

- **Produk:** nomor rumah akrilik timbul *(Tier 2, "6rb+ terjual" di pembanding)*
- **Parameter:** tinggi digit (mis. 100 mm), jumlah digit, backplate atau huruf lepas, jarak antar digit, opsi lubang sekrup
- **Keluaran:** digit + backplate dengan registrasi
- **Upaya:** sedang — butuh set glyph angka; font outline sudah tersedia, tinggal disusun.
- **Pertanyaan:** huruf lepas atau menempel di backplate?

#### T11 — Cake topper &amp; table number

- **Produk:** topper kue, table number, place card pernikahan *(Tier 2, musiman)*
- **Parameter:** tinggi teks, gaya font, opsi tusuk/pin bawah, dekor outline sekeliling, jumlah (Array)
- **Keluaran:** outline teks + pin
- **Upaya:** kecil–sedang — tumpang tindih besar dengan T7 karena intinya sama (teks → outline → panel).

> **Catatan penggabungan:** T7, T9, T11 pada dasarnya **"panel + teks outline + opsional lapis"**. Pertimbangkan **satu tool inti "Panel &amp; teks" dengan preset** (Signage / Plakat / Cake topper) untuk mengurangi duplikasi — mirip cara `wall.js` melayani beberapa kebutuhan. Ini keputusan desain penting: **satu tool serbaguna vs banyak tool spesifik.**

#### T12 — Nomor/medali souvenir (vandel, medal hanger)

- **Produk:** vandel, medal hanger, souvenir promosi *(Tier 2)*
- **Parameter:** bentuk (bulat/persegi/bidang custom), Ø lubang pita, teks
- **Upaya:** kecil — kemungkinan besar cukup jadi preset di T3/T5.

---

### Fase D — Tier 3: nilai tinggi (P2)

#### T13 — Wall art berlapis (layered art)

- **Produk:** wall art karakter, hiasan dinding *(riset Tier 3: bahan Rp40.000 → jual Rp500–600rb, margin tertinggi)*
- **Parameter:** tinggi total, jumlah layer (2–4), gambar sumber (trace via `Potrace.js` yang sudah ada), palet layer, opsi fill engrave, pin registrasi antar layer
- **Keluaran:** per layer satu outline + pin registrasi, warna berbeda per layer
- **Upaya:** **besar** — bagian tersulit otomatis memecah satu siluet jadi 2–4 lapis kedalaman yang masih terbaca. Ini pekerjaan desain, bukan sekadar geometri.
- **Pertanyaan:** apakah layer dibuat otomatis dari tinggi abu, atau manual (user pilih area tiap layer)? Rekomendasi: **manual dulu, otomatis belakangan.**

#### T14 — Panel ornamen / partisi motif

- **Produk:** ornamen panel dinding, partisi *(Tier 3, Rp250.000–750.000/m²)*
- **Parameter:** ukuran panel, pilih motif (grid geometris / lengkung / custom dari loop), pitch, ketebalan sisa (bridge), margin tepi
- **Keluaran:** panel + lubang motif, boolean dengan `path-bool.js`
- **Upaya:** sedang–besar. **Yang perlu ditentukan:** pustaka motif — mau mulai dari 5–10 motif atau custom penuh?

#### T15 — Rak akrilik display

- **Produk:** rak display kosmetik, sekat, standing *(Tier 3)*
- **Parameter:** lebar/tinggi/kedalaman, jumlah rak, tebal bahan, slot press-fit (tebal + kerf dari T0)
- **Keluaran:** sisi + rak, siap potong
- **Upaya:** kecil–sedang — `paintrack.js` dan `box.js` sudah memecahkan sebagian besar pola ini.

---

### Fase E — Sisi bisnis (P1, bukan geometri)

#### T17 — Kalkulator harga &amp; material

- **Layani:** penetapan harga jual di Shopee
- **Input:** desain aktif → luas potong (cm²) + jumlah loop + tebal bahan
- **Hitung:** HPP = bahan + jasa cutting (tarif riset §4.1/§4.2) + finishing + kemasan + fee marketplace → harga jual pakai multiplier per tier (rumus riset §4.3)
- **Keluaran:** panel ringkasan harga, bisa disalin / disimpan sebagai komentar di dokumen
- **Upaya:** kecil–sedang. Nilai strategis: menghubungkan riset pasar dengan desain harian.
- **Pertanyaan:** fee marketplace &amp; ongkir berapa persen yang Anda pakai sekarang?

#### T18 — Mockup foto listing *(opsional, P2)*

- Render desain jadi PNG dengan latar polos untuk foto produk Shopee.
- **Upaya:** sedang. **Pertanyaan:** perlu di dalam MiniSketch, atau cukup screenshot?

---

## 4. Rekomendasi urutan pengerjaan

```
Fase A (fondasi)  T0 preset bahan → T1 lembar → T2 validator → T6 batch text
Fase B (Tier 1)   T3 ganci (+T4/T5 sebagai preset) → Array sudah ada
Fase C (Tier 2)   T7 signage → T10 nomor rumah → T8/T9/T11
Fase D (Tier 3)   T15 rak → T14 ornamen → T13 wall art
Fase E (bisnis)   T17 kalkulator harga  (bisa dikerjakan paralel kapan saja)
```

**Alasan urutan ini:**

1. **T0 + T2 dulu** karena semua tool berikutnya membaca preset bahan, dan validator mencegah kerja ulang. Membalik urutannya berarti banyak tool harus di-refactor.
2. **T6 (batch text) lebih bernilai daripada jumlah tool.** Satu tool ini mengubah 100 pesanan jadi satu kali kerja.
3. **Tier 1 sebelum Tier 2** karena Tier 1 memberi volume &amp; review pertama, tapi **T7 signage adalah target akhirnya** karena di situ marginnya.
4. **Tier 3 ditunda** — margin besar tapi desainnya paling manual dan volume Shopee-nya kecil.

**Estimasi kasar (hari kerja, bukan janji):** Fase A 3–5 · Fase B 3–5 · Fase C 8–14 · Fase D 10–18 · Fase E 2–4.

---

## 5. Hal-hal yang harus diputuskan sebelum mulai

Untuk direview sebelum ada coding:

**Strategi produk**

1. **Urutan prioritas** — setuju dengan §4, atau Tier 2 (signage) duluan karena margin? Jawab: YA
2. **Gabung atau pisah** — T3/T4/T5 jadi satu "Tag &amp; plate maker", dan T7/T9/T11 jadi satu "Panel &amp; teks"? Ini keputusan paling mahal untuk diubah nanti. Jawab : YA 
3. **Berapa banyak tool** yang layak ditampilkan di panel Tools yang sudah cukup panjang? Jawab: BEBAS

**Bisnis**
4. Ukuran lembar bahan yang benar-benar dipakai (untuk T1).
5. Kerf aktual per bahan — perlu diukur di mesin Anda, angka default `0.4` di `wall.js (jawab: KERF Diurus di software laser cutting)` mungkin belum cocok.  
6. Fee marketplace + ongkir yang dipakai di kalkulator harga (T17). (Jawab: KaryaCNC sudah bisa menghitung harga)  
7. Apakah T17 memang perlu di MiniSketch, atau cukup spreadsheet? (Jawab: sudah ada di KaryaCNC minisketch urusan desain saja)

**Teknis**
8. **Target mesin:** laser CO2 saja, atau juga CNC router? Menentukan warna operasi yang relevan dan apakah `#800080` pocket dipakai. (Jawab: saya punya keduanya) 9. **Bahasa UI tool** — `paneliklan` memakai Indonesia, sisanya Inggris. Perlu diseragamkan? (jawab:Ya) 10. **Update** `ai/tools.json` — apakah tool baru juga harus terdaftar untuk AI agent (tidak)? Belum dicek apakah generator tool otomatis terlihat di sana.  
11. **Dokumentasi** `help.js` — tiap tool baru butuh entri di **kedua** pane bahasa (aturan di `ARCHITECTURE.md`). Ini biaya rutin yang gampang terlupa. 

---

## 6. Risiko &amp; ketergantungan


| Risiko                                                   | Dampak                                 | Mitgasi                                                                                      |
| -------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------- |
| T7 (signage) auto-fit teks gagal untuk logo/aksara rumit | Fase C macet                           | Mulai dari teks latin sederhana; logo dulu via trace manual                                  |
| T13 (wall art) otomatisasi layer ternyata terlalu sulit  | Fase D mundur                          | Mulai manual layer demi layer; otomatisasi hanya jika ternyata berulang                      |
| Panel Tools jadi terlalu banyak tombol                   | UI berantakan                          | Keputusan #2 di §5 — gabungkan jadi tool serbaguna berpreset                                 |
| Duplikasi kerf/setting seperti bug lama                  | Nilai konsisten salah di beberapa tool | T0 jadi satu-satunya sumber; jangan simpan kerf di `gen.params` tool                         |
| `tools_probe.js` merah                                   | Handoff tertahan                       | Ikuti checklist §7 `TOOLS.md`: grup bernama, `gen`, push history sekali, id dialog berprefix |
| Help bilingual terlewat                                  | Dokumen tidak lengkap                  | Masukkan ke checklist per tool                                                               |


**Ketergantungan yang sudah ada dan harus tetap hijau:**
`node testing/tools_probe.js` · `node tests/smoke.js` · probe geometri per tool (`testing/<tool>_probe.js`)

**Batasan yang tidak berubah:** tanpa build step, tanpa ES module, satu file per tool, tool tidak boleh memanggil helper core di module scope.

---

## 7. Yang belum ada di dokumen ini

- Angka permintaan per produk dari data asli Shopee (riset §2 — perlu validasi manual)
- Prototipe dialog / layout UI tiap tool — sengaja tidak digambar sebelum §5 dijawab
- Rencana pengujian per tool — menyusul setelah tool &amp; urutan dikunci