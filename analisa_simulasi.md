# MiniSketch — Analisis Kebutuhan: Simulasi Fisika untuk Assembly Mekanis

Dokumen ini menganalisis **apa saja yang dibutuhkan** untuk menambahkan
simulasi fisika pada sistem assembly, supaya desain part mekanis (misal
ketapel/trebuchet dengan trigger terkunci) bisa **diuji dinamikanya** — bukan
hanya dikunci secara statis seperti sekarang. **Belum ada keputusan/implementasi**
— ini murni perencanaan.

---

## 1. Kondisi saat ini: assembly itu STATIS, bukan dinamika

Yang sudah ada (saya verifikasi di kode):

| Konsep | Kondisi sekarang |
|---|---|
| `part` | body kaku: `pose {tx,ty,rot}` + `polylines` (bentuk) + `fixed`/`grounded`/`groundAt` + `width`/`color`/`name` |
| `mate` | `pin` (revolute), `slider` (prismatic), `string` (**display-only**, diabaikan solver) |
| Solver | `solveAssembly` = Levenberg-Marquardt **least-squares statis** (position-based) |
| Gaya | **tidak ada** — `core.js:1423` "No gravity, no regularisation: correctness comes from the assembly itself." |
| Massa/inersia | tidak ada |
| Tabrakan | tidak ada |
| Waktu | tidak ada (tanpa time integration, tanpa iterasi langkah) |

Konsekuensi: yang bisa Anda lakukan sekarang hanya **menentukan posisi** yang
memenuhi constraint (kinematika). Tidak bisa melihat arm ketapel melontar, tali
menarik, pemicu lepas, atau proyektil menumbuk target.

Jadi inti kebutuhan adalah: menjadikan assembly **dinamis** dengan rigid-body
dynamics + kontak + joint fisika + trigger.

---

## 2. "Mattenya" (kebutuhan inti) untuk simulasi

### 2.1 Rigid-body dynamics
- **Massa** per part := densitas material × luas (dari `polylines`). Perlu
  densitas default per material/layer + override per part.
- **Inersia rotasi** & **pusat massa (COM)** dihitung dari bentuk poligon.
- **Body type**: `static` (ground/fixed), `dynamic` (bergerak), `kinematic`
  (pilihan, untuk gerak terprogram).

### 2.2 Gaya
- **Gravitasi** (arah & besar bisa diatur).
- **Pegas / elastic band** — penting untuk ketapel/panah: gaya = k·(panjang −
  panjang diam). Di Box2D = `distanceJoint` (spring) atau `ropeJoint`.
- **Seret (drag)/damping** opsional agar tidak berosilasi selamanya.
- **Impuls manual & kecepatan awal** (untuk "lempar awal").

### 2.3 Joint (pemetaan dari mate yang sudah ada)
| Mate MiniSketch | Konstruksi Box2D |
|---|---|
| `pin` | `revoluteJoint` (anchor = titik pin, local anchors di kedua part) |
| `slider` | `prismaticJoint` (axis = arah edge) |
| `string` (saat ini display-only) | **upgrade**: jadi `distanceJoint`/`ropeJoint` (maksimal panjang) — ini yang membuat tali/band nyata |
| `grounded` | body `static` (+ `weldJoint` ke ground bila perlu) |
| `fixed` | `weldJoint` (atau body static) |

### 2.4 Trigger / latch (kunci & lepas)
Ini kebutuhan khusus yang Anda sebut. Representasi fisika yang bersih:
- **Latch = kendala yang ada lalu hilang.** Dua cara:
  1. **Wall/blocker fisik**: part pemicu (sebuah notch/stop) yang menghalangi
     arm via **collision**; saat trigger, blocker dimatikan (destroy body /
     `setEnabled(false)`). Ini paling "fisik" dan otomatis menghasilkan tumbukan.
  2. **Joint dengan limit**: revoluteJoint yang `lowerLimit == upperLimit`
     (terkunci); saat trigger, limit dibuka / motor diaktifkan sehingga arm bisa
     berputar terhadap pegas.
- Pemicu = event (tombol / hotkey / area sensor) yang men-trigger salah satu
  mekanisme di atas, plus mencatat "waktu lepas" untuk replay.

### 2.5 Tabrakan/kontak antar part
- Butuh **collision detection + resolution** (proyektil menumbuk target,
  blocker menahan arm, part tidak saling menembus).
- **Collision filtering/grup** — agar bisa menandai "sling boleh menembus arm"
  atau "bagian ini tidak boleh bertabrakan".
- **Friction & restitution** (pantulan) per material.

### 2.6 Integrasi waktu
- Fixed timestep (mis. 1/60 s) + akumulasi real-time; sub-step bila perlu.
- **Sleep** (benda diam berhenti dihitung), velocity threshold.
- Determinisme: langkah tetap + iterasi tetap → hasil reproducible (penting
  untuk debugging/replay).

### 2.7 Interaksi
- **Grab/release** = `mouseJoint` (sama rasa seperti drag part sekarang, tapi
  di dunia fisika — ambil & lepas, bukan hanya posisikan).
- Panel kontrol: play/pause/step/reset, gravity, kualitas (iterasi), parameter
  pemicu.

---

## 3. Pilihan engine (fokus: box2d.js)

Fakta yang saya verifikasi:

| | box2d.js (kripken) | planck.js |
|---|---|---|
| Asal | port Emscripten langsung dari Box2D C++ | rewrite JS/TS dari Box2D |
| Lisensi | **zlib** (permisif, aman untuk closed-source) | **MIT** |
| Status | lama (2012), API polos Box2D | aktif (v1.5.x), TypeScript, modular, jalan di browser **dan Node** |
| Ukuran | ~800 KB min | lebih ramping total modular |
| Bun build | `box2d.min.js` (script klasik) | `planck.min.js` (glob/UMD, bisa `<script>`) |

Rekomendasi: **planck.js sebagai pilihan utama** (MIT, terawat, dukungan
TS, mudah diuji di Node dengan probe seperti `core.js`) — sementara
**box2d.js tetap valid** jika Anda ingin port Box2D kanonik (zlib juga aman).
Pelajaran dari kasus Potrace/GPL: **pastikan lisensi permisif** (MIT/zlib) —
keduanya memenuhi. Hindari varian GPL.

Catatan: ada juga `box2d.wasm` (lebih cepat, tapi loader lebih berat); untuk
editor interaktif & jumlah body sedang, JS cukup.

Kebutuhan engine teknis:
- **Hasgon konveks wajib** (Box2D): maks 8 vertex (`b2_maxPolygonVertices`),
  urutan benar. Bentuk cekung (gear, strip wall, dll) harus **dipecah menjadi
  konveks** — pakai `poly-decomp.js` (cegah, lisensi perlu dicek) atau
  ear-clipping sendiri. Lubang (multi-contour) → beberapa fixture.
- **Skala satuan**: Box2D enak pada ukuran ~0.1–10 unit. Part kita dalam mm
  (bisa 1..ribuan mm). Perlu konstanta `SIM_SCALE` (mis. 1 mm = 0.001 m →
  500 mm = 0.5 m, pas; atau 0.01 jika part kecil). Dokumenkan & biarkan diatur.

---

## 4. Pemetaan & integrasi dengan aplikasi

### 4.1 Model data tambahan
- Per part: `mass`, `inertia`, `com`, `density`, `material`, `bodyType`,
  (opsional) `simProps {friction, restitution, sleepAllowed}`.
- Per mate: `simKind` (revolute/prismatic/distance/rope/weld) + parameter
  (spring k, rest length, limits).
- Global: `sim {gravity, timeScale, iterations, solver}`.
- Trigger: daftar `trigger` (nama, jenis, target part/joint, kondisi).

### 4.2 Mode: Edit (LM statis) ↔ Simulate (fisika)
- **Jangan menimpa** LM statis — itu tetap dipakai untuk mendesain/memosisikan
  (drag presisi, constraint). Tambahkan **mode Simulate** yang terpisah.
- Bridge: saat masuk Simulate, bangun `World` Box2D dari state saat ini (part +
  mate + ground). Selama simulate, tiap langkah menulis pose body → `pose` part
  → render normal (reuse `drawPartEntity`). Saat keluar/pause, tulis pose balik
  dan solver statis mengambil alih lagi.
- Konflik: solusi fisika (impuls) **berbeda** dari solusi LM (position-based).
  Pastikan kedua mode tidak saling menulis serentak; sim hanya hidup di mode
  Simulate.

### 4.3 Rendering
- Render memakai pose (sudah ada) → tak perlu path baru.
- Opsional overlay: vektor kecepatan, titik kontak, COM, garis jejak (trail).

### 4.4 Worker / determinisme
- Box2D deterministik untuk dt & iterasi tetap. Untuk MVP, **main thread** cukup
  (puluhan body @60Hz murah). Pemindahan ke `Worker` (seperti nesting/trace)
  hanya perlu jika scene banyak body; file:// worker sudah terbukti jalan.

---

## 5. Use case: ketapel/trebuchet dengan trigger terkunci

Sketsa bagaimana tepatnya bekerja:

1. **Bingkai/stock** → body `static`.
2. **Arm** → `dynamic`, dihubungkan ke bingkai dengan **revoluteJoint** (pin)
   pada porosnya.
3. **Karet/elastic band** → `distanceJoint` (spring) antara ujung arm dan titik
   anchor di bingkai. Parameter `k` dan panjang diam diatur di panel.
4. **Pemicu terkunci** → pada posisi "cocked", arm ditahan:
   - blocker kecil (body static/sensor) menghalangi ujung arm → arm tidak bisa
     lepas karena collision; **atau**
   - revoluteJoint dengan `lowerLimit == upperLimit` (kunci).
5. **Trigger** (tombol) → `blocker.setEnabled(false)` (atau buka limit) →
   spring menarik arm → arm berputar cepat.
6. **Proyektil/sling** → part `dynamic` terpisah, dihubungkan sementara dengan
   ropeJoint ke ujung arm; saat kecepatan cukup / sudut tertentu, rope **dilepas**
   (destroy joint / batas maksimum tercapai) → proyektil meluncur bebas.
7. **Target** → part `dynamic`/`static`; tumbukan dipecahkan collision engine;
   target bisa tumbang (kalau dynamic).
8. Ukur dengan tool: posisi saat lepas, kecepatan, jarak jangkau.

Ini semua diekspresikan memakai joint + collision standar — tidak perlu physics
khusus.

---

## 6. Fase / scoping

- **Fase A (MVP)**: world dari part+mate; gravity; revolute/prismatic dari
  pin/slider; ground=static; grab/release (mouseJoint); step + render; panel
  play/pause/step/reset. Belum perlu collision (atau hanya dasar).
- **Fase B**: collision + convex decomposition + densitas/massa; `string` jadi
  distance/rope joint; spring; trigger/latch; parameter friction/restitution.
- **Fase C**: motor, sensor, measurement, trails, rekaman/replay, multi-body
  besar (worker), material presets.

---

## 7. Risiko & gotchas

- **Konveksitas**: banyak bentuk desain cekung (gear, wall) → wajib decompose.
  Tanpa ini Box2D akan menolak/rusak.
- **Skala & stabilitas**: mm→unit scaling salah → jitter/ledakan (tunneling).
  Perlu clamping kecepatan & iterasi yang memadai.
- **Sinkronisasi dua solver**: LM statis vs impuls fisika — harus eksklusif per
  mode; jangan biarkan keduanya menulis pose yang sama.
- **`string` saat ini display-only**: meng-upgrade-nya jadi fisik mengubah
  perilaku `solveAssembly` (saat ini diabaikan) — pastikan hanya aktif di mode
  Simulate agar LM statis tidak berubah.
- **Lisensi**: deploy hanya engine permisif (MIT/zlib). Verifikasi lisensi
  `poly-decomp` bila dipakai.
- **Determinisme**: jika nanti ke worker, pastikan tidak ada Math.random di
  jalur sim (ada di code, bukan physics).
- **Kinerja**: banyak fixture dari polylines padat → bisa lambat; gunakan
  simplification/resampling bentuk untuk fixture (seperti yang sudah ada untuk
  loop).

---

## 8. Yang TIDAK dicakup (batas)

- Deformasi elastis (bending) — arm ketapel yang lentur tidak bisa dimodelkan
  sebagai body kaku; perlu serangkaian segmen yang dijoint (approximasi).
- Sabuk/rantai/gear meshing presisi — bisa diaproksimasi (motor + kontak),
  bukan built-in.
- Fluida / aerodinamika.
- Kontrol/state machine kompleks di luar trigger sederhana.

---

## 9. Kesimpulan

Kebutuhan inti bisa diringkas menjadi: **rigid body dynamics + pemetaan
mate→joint + gaya (gravitasi & pegas) + collision + trigger/latch + integrasi
waktu + mode Simulate yang eksklusif terhadap LM statis**. Engine Box2D
(box2d.js zlib / planck.js MIT) memenuhi semuanya; bagian yang perlu dibangun
di sisi MiniSketch adalah: (1) pemetaan model→world, (2) convex decomposition
untuk polylines cekung, (3) skala satuan, (4) UI mode Simulate + trigger, dan
(5) evaluasi massa/inersia dari geometri. Fase A/B di atas memberi jalur
bertahap yang rendah risiko.

---

## 10. Lampiran A — Konfirmasi desain (hasil diskusi)

Poin-poin berikut sudah dikonfirmasi bersama dan menjadi keputusan desain awal:

1. **Ground / virtual ground.** Part `fixed`/`grounded` = body `static`
   (tidak jatuh, tetap ikut collision). Ada juga toggle lantai virtual opsional
   (platform statis di default y), supaya benda tidak jatuh selamanya saat
   belum ada lantai yang digambar.
2. **Kontrol sim.** Tombol **Start ▶ / Pause ⏸ / Reset ↺** + **Step** (satu
   frame) + pengatur Gravity/quality.
3. **Drag part saat simulasi.** Pakai **mouseJoint**: grab/geser/lepas part
   `dynamic` di tengah sim (cara manual men-draw picu / mengokang arm). Part
   `static` tidak bisa digeser selama sim; saat sim aktif, editing constraint
   dimatikan.
4. **Pegas + blocker fixed (collision) = latch.** Pegas = `distanceJoint`
   (spring) antar anchor; part statis menghalangi lewat collision sehingga part
   yang ditarik pegas berhenti di kontak. **Trigger** = matikan blocker
   (`setEnabled(false)` / destroy / pindah) → pegas melepas part. Peringatan:
   pegas sangat kaku + blocker tipis berisiko tunneling → gunakan CCD /
   sub-stepping / blocker lebih tebal.

Alur ketapel yang disepakati:
```
Bingkai (static) + Arm (dynamic, revolute) + Karet (spring ke anchor)
  + Blocker statis menahan arm (cocked)  ──►  Trigger matikan blocker
    ──►  pegas menarik arm → arm berputar → sling/proyektil (rope) lepas
      ──►  proyektil meluncur → tumbuk target (collision)
```

**Status: masih fase analisa — belum ada implementasi.**
