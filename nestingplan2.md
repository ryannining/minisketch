# Nesting lokal di MiniSketch — analisa & rencana implementasi

Status: **rencana, belum ada kode yang diubah**. Dokumen ini satu-satunya output.
Ruang lingkup: fitur nesting penuh di dalam MiniSketch (client-side, tanpa server),
memakai engine GA + NFP2 yang diport dari `nestjs2/frontend/js/nfp2.js` + `nfp_ga.js`.

Catatan: `nestingplan1.md` (plan dari AI lain) **tidak saya baca** supaya plan ini
independen dan bisa dibandingkan apa adanya.

---

## 0. Ringkasan keputusan (TL;DR)

| Topik | Keputusan |
| --- | --- |
| Tempat engine | file baru `nest/engine.js`, classic script, murni (tanpa DOM), `window.MiniSketchNest` + `module.exports` |
| Background | **tanpa Web Worker** (app dibuka dari `file://`, worker file:// diblokir). Generator + scheduler time-slice `setTimeout(0)`, budget ~12 ms/slice |
| Ruang kerja algoritma | *sheet space* Y-down (origin = pojok kiri-atas bbox loop hijau), lalu dikonjugasi balik ke world Y-up lewat matrix |
| Output | **clone** (`type:'array', kind:'clone'`), masters = entity loop objek (outer + lubang), instances = matrix penempatan |
| Master | tidak pernah digeser/diubah; clone hanya membaca geometri master |
| Compound loop | 1 objek = 1 loop outer + loop-loop lubang di dalamnya (depth genap/ganjil) |
| Sheet | loop yang **semua entity-nya** berwarna `#00ff00`; auto-deteksi kalau tepat satu, kalau lebih harus dipilih |
| Hasil | blok hasil otomatis diletakkan di kanan sheet, `GAP = 10 mm`; yang tidak muat ditumpuk ke kanan blok hasil |
| Gap part | offset tiap part keluar `gap/2` memakai `offsetChains` (Clipper) yang sudah ada, penempatan pakai poly yang sudah digemukkan, output pakai geometri asli |
| Undo | satu langkah undo untuk seluruh penempatan (dan satu langkah untuk penggantian hasil lama) |
| Default parameter | rotasi `0,90,180,270`, flip off, grid 4 mm, populasi 6, generasi 5, mutasi 0.1 (sama dengan referensi) |
| Nesting server lama | **tidak disentuh** (fitur terpisah, tetap ada) |
| Konfigurasi yang diubah | `node testing/nesting_probe.js` ditambahkan ke allowlist `.commandcode/settings.json` |

Alasan inti memilih engine referensi apa adanya: hasilnya sudah dipakai owner
sehari-hari, dan bentuk datanya (polygon + holes + matrix) cocok dengan clone
MiniSketch. Yang saya ubah hanya hal-hal yang di MiniSketch berbeda: satuan mm
(bukan `GEOM_SCALE = 1000`), tidak ada kanvas preview, dan eksekusi harus
kooperatif karena tidak ada worker.

---

## 1. Tujuan & non-tujuan

### Tujuan

1. Panel **Nesting** di sidebar kanan, sejajar panel lain (Layers, Parts, Array, …).
2. Owner memilih loop di kanvas → panel menampungnya sebagai **objek** (compound
   loop = 1 objek). Satu loop hijau = **lembar/sheet**.
3. Tombol **Nest** menjalankan GA + NFP2 lokal, dengan progress, estimasi sisa,
   dan **Stop** yang benar-benar menghentikan tanpa merusak dokumen.
4. Hasil terbaik langsung ditempatkan sebagai **clone** di kanvas: blok hasil di
   kanan sheet, sisa yang tidak muat di kanan blok hasil.
5. Hasil bisa diulang (re-nest) dan di-undo sebagai satu langkah.

### Non-tujuan (v1, sengaja tidak dikerjakan)

- Qty per objek (1 objek = 1 salinan). Struktur `instances` sudah siap untuk qty
  nanti, tapi UI/GA-nya belum.
- Multi-sheet, sheet sisa (remnant), nesting bertahap/`renest` seperti referensi.
- Kerf/tool-radius compensation. `gap` adalah jarak antar-part, bukan kompensasi
  radius pahat.
- Mengganti/menghapus fitur nesting server KaryaCNC yang sudah ada (`cmdNest`).
- Menambah dukungan `text`/`art`/`image`/`part` sebagai objek nesting (hanya loop).
- Preview layout sebelum commit, drag-and-drop part di preview.

---

## 2. Fakta repo yang jadi dasar plan

- Static app, tanpa build, tanpa ES module, dibuka dari `file://`. Script dimuat
  berurutan di `index.html:750-768`: `tools/*`, `ai/chat.js`, `core.js`, `app.js`.
- `app.js` satu IIFE raksasa (~26.5k baris). `core.js` murni + bisa di-`require`
  di Node dan diuji `tests/smoke.js`.
- Loop: `getLoops()` (`app.js:8606`) → `{ poly, area, steps, circle?, splineEntity? }`,
  `poly` sudah titik world mm (Y-up). Klik di dalam loop memilih entity loop
  (`applyLoopClick`, `app.js:18809`); `loopShapeSelected` (`app.js:7053`) =
  semua entity loop terseleksi; `loopEntities` (`app.js:7037`).
- Clone: `kind:'clone'`, `masters:[ids]`, `instances:[{m:[a,b,c,d,e,f], a:[x,y]}]`
  (`cmdClone` `app.js:11453`, `cloneInstanceOffsets` `11403`,
  `cloneAnchorOf` `11390`, `arrayShapesOf` `11629`, `arrayEnsureShapes` `11686`).
  Save/load clone instances sudah didukung (`app.js:25093-25103`).
- Offset + Clipper: `offsetChains(chains, dist, opts)` (`app.js:12705`) sudah
  menormalisasi winding (island tumbuh, hole menyusut) lewat `tools/clipper.js`.
- Polygon helpers: `pointInPoly` (`core.js:1574`), `signedAreaPts` (`1584`),
  `interiorProbe` (`1594`), `chainPolylines` (`1643`), `normalizeWinding` (`1619`),
  `matMul` (`core.js:54`), `matApply` (`core.js:65`).
- Flatten akurat: `pathChainsOf(ents, tol)` (`app.js:11993`) — line/spline/arc/circle
  di-flatten adaptif (default tol 0.05 mm).
- Warna: `#00ff00` = "Mark (green)" di `COLORS` (`app.js:49`). Guide milik array
  dikecualikan lewat `ownedGuideIds` (`app.js:25657`).
- `updateUI()` (`app.js:17536`) adalah satu-satunya tempat daftar panel di-refresh
  (`updatePartsList`, `updateArrayList`, …). Panel baru harus nempel di sini.
- Settings disimpan di `localStorage` per-key (lihat pola `minisketch.*`), undo
  lewat `pushHistory()` (`app.js:2305`) + `commit()` (`app.js:2612`).
- `agents.md`: UI tidak boleh dites sendiri oleh agent; verifikasi browser milik
  owner. Karena itu §12 memuat resep tes presisi, bukan klaim "sudah dites".

---

## 3. UX panel

### 3.1 Penempatan di sidebar

Sisipkan `<section class="panel">` baru di `index.html` setelah section Tools
(± baris 352, sebelum panel Layers), jadi urutannya: Tools → **Nesting** → Layers → …

```
┌ Nesting ────────────────────────────────┐
│ Sheet (green loop)                      │
│   ▢ 300 × 200 mm        [Pick] [Clear]  │
│   (300 × 200 · 4 sudut · layer 1)       │
│                                         │
│ Objects (4)              [Add] [Clear]  │
│   ▸ Rect 100×60    (1 loop)             │
│   ▸ Ring 80×80     (2 loops, 1 hole)    │
│   ▸ L-bracket      (1 loop, 6 pts)      │
│   ▸ Plate 120×90   (3 loops, 2 holes)   │
│   (+ 2 lebih)                           │
│                                         │
│ Gap (mm)        [ 2 ]                   │
│ Rotation        [0,90,180,270      ▾]   │
│ Allow flip      [ ]                     │
│ Quality         [Normal ▾]              │
│ ▓▓▓▓▓▓▓▓▓░░░░░░  62%   eval 19/31       │
│ Placed 3/4 · block 312×198 mm           │
│ [ ▶ Nest ]  [ ■ Stop ]  [ Clear result ]│
└─────────────────────────────────────────┘
```

Tombol **Add** mengambil dari seleksi kanvas (bukan dari daftar loop global) supaya
owner tetap mengontrol apa yang masuk. **Sheet ▢ Pick** mengambil loop hijau yang
sedang terseleksi; kalau tidak ada yang terseleksi, ambil satu-satunya loop hijau
di dokumen.

### 3.2 Alur

```
pilih loop di kanvas ──► Add ──► daftar Objects
gambar/ pilih loop hijau ──► Pick ──► Sheet
[ ▶ Nest ] ──► validasi ──► job jalan (progress) ──► hasil ──► clone di kanvas
                     │
                     └─► [ ■ Stop ] ──► dokumen tidak berubah, panel simpan status
```

- Satu objek hanya boleh masuk sekali (kunci = daftar entity id yang diurutkan).
  Menambah objek yang sudah ada diabaikan + toast.
- Kalau loop hijau yang dipilih ternyata objek (bukan sheet), tolak dengan pesan.
- Panel mengingat daftar objek + sheet + setting antar sesi
  (`localStorage['minisketch.nest.v1']`), **tapi tidak** mengingat hasil.
  Saat dokumen dibuka lagi, objek yang entity-nya hilang dibuang diam-diam
  (dan dihitung di status: "2 objek dibuang, entity hilang").
- Selama job jalan: tombol Nest disabled, Stop aktif, daftar Object/Sheet
  read-only (tapi kanvas tetap bisa dipakai — lihat §7.4).

### 3.3 Status yang harus terbaca (untuk verifikasi owner)

Setelah selesai, satu baris status:

```
Placed 18/20 · block 312×198 mm · 71% · 31 evals · 8.4 s
```

- `Placed k/n` — berapa objek masuk sheet.
- `block W×H` — bbox blok hasil (mm, world).
- `%` — utilisasi = luas asli objek terpasang / luas bbox blok.
- `evals` — jumlah evaluasi GA yang selesai (populasi × generasi + 1 baseline).
- `s` — wall clock job.

Kalau 0 yang muat: `Placed 0/4 · semua tidak muat · blok di kanan sheet`.

---

## 4. Loop → objek, dan sheet

### 4.1 Kandidat loop

Hanya loop yang **seluruh entity-nya** lolos `loopShapeSelected(loop)` yang
dipertimbangkan. Guide milik array dibuang (`ownedGuideIds()`), loop yang semua
entity-nya hijau dipisahkan sebagai kandidat sheet.

### 4.2 Compound loop = satu objek

Untuk dua loop `a`, `b` di layer yang sama, `a` **di dalam** `b` bila
`pointInPoly(interiorProbe(a.poly), b.poly)` benar. Hitung `depth(loop)` = jumlah
loop lain yang memuat loop itu (dibatasi ke layer yang sama, dan hanya di antara
kandidat objek).

- `depth` genap → **objek** (outer).
- `depth` ganjil → **lubang** milik objek genap terdekat yang memuatnya
  (container dengan area terkecil).

```
objek = { key, layer, outer: loop, holes: [loop...], entityIds: [...] }
```

Konsekuensi yang harus disadari (dan ditampilkan di panel: "2 loops, 1 hole"):
kalau owner menggambar dua kotak yang salah satunya di dalam yang lain, keduanya
otomatis jadi satu objek berlubang — itu memang aturan yang diminta.

Kalau loop hijau ikut terseleksi, ia **tidak** masuk objek; ia jadi sheet.

### 4.3 Sheet

Sheet = loop yang semua entity-nya berwarna `#00ff00` dan bukan guide milik array.

Aturan pemilihan:

1. Kalau ada loop hijau yang terseleksi persis satu → itu sheet-nya.
2. Kalau tidak ada yang terseleksi dan di dokumen ada tepat satu loop hijau → auto.
3. Kalau lebih dari satu → panel minta owner memilih satu ("2 green loops: pilih
   satu lalu tekan Pick"). Tidak menebak, karena salah sheet = salah hasil.
4. Sheet boleh berlubang (green loop di dalam green loop): ikut dipakai sebagai
   obstacle di engine (`sheet.holes`), jadi part tidak akan ditaruh di lubang sheet.

Sheet harus tertutup (`loop` memang hanya loop tertutup). Kalau tidak ada loop
hijau sama sekali: `Nest` disabled + hint "gambar loop hijau sebagai lembar".

### 4.4 Geometri objek (presisi)

`loop.poly` dari `getLoops()` **tidak dipakai langsung**: untuk circle jumlah
titiknya tetap 72 (kasar untuk Ø besar), dan poly itu hasil sampling tampilan.
Sebagai gantinya, untuk tiap loop:

```js
const ents = loopEntities(loop).filter(e => !owned.has(+e.id));
const chains = chainPolylines(pathChainsOf(ents, 0.05), JOIN_TOL);
// pilih chain tertutup yang cocok: |area - loop.area| terkecil
const pts = normalizeClosed(rdpSimplify(pick.pts, 0.02));   // ~0.02 mm
```

- `pathChainsOf(..., 0.05)` memakai flattener yang sama dengan jalur CNC
  (spline adaptif, arc via cubic, circle via cubic) → deviasi < 0.05 mm.
- `chainPolylines` menyambung segmen entity menjadi satu kontur; kalau loop
  berbagi entity dengan loop lain, ada >1 kandidat → pilih yang areanya paling
  dekat dengan `loop.area`.
- `rdpSimplify(pts, 0.02)` hanya untuk meringankan collision test; geometri
  output tetap master asli, jadi tidak ada perubahan bentuk yang terlihat.
- `normalizeWinding` dipakai supaya outer CCW / hole CW di sheet space.

Batas aman: kalau hasil simplify menurunkan luas > 0.5%, jangan simplify.

---

## 5. Ruang koordinat & matrix

### 5.1 Tiga ruang

| Ruang | Sumbu Y | Isi |
| --- | --- | --- |
| **World** (dokumen MiniSketch) | naik | semua entity, sheet, output clone |
| **Sheet space** | turun | kerja engine: origin = (sheet.bbox.minX, sheet.bbox.maxY) |
| Output | naik | world, blok hasil di kanan sheet |

Konjugasi world → sheet space (`F0`) dan sheet space → output world (`G`):

```
F0 = [1, 0, 0, -1, -sx0, sy1]      // (x, y) -> (x - sx0, sy1 - y)
G  = [1, 0, 0, -1, outX, sy1]      // (u, v) -> (outX + u, sy1 - v)
outX = max(sheet.bbox.maxX, masters.bbox.maxX) + GAP     // GAP = 10 mm
```

`max(...)` dengan bbox master mencegah hasil menimpa loop sumber kalau owner
sudah menggambar objek di kanan sheet.

Perhatikan `G ∘ F0` = translasi `(outX - sx0, 0)`: konjugasi ini konsisten dan
tidak membalik geometri (dua kali flip Y).

### 5.2 Matrix penempatan

Engine menyimpan, per objek, transform pra-varian:

```
mPre = T(align) · R(angle) · M(flip)
```

- `M(flip)` = `[1,0,0,-1,0,2*cy]` (cermin terhadap garis horizontal melalui
  center bbox sumber; hanya kalau flip aktif).
- `R(angle)` = `[cos, sin, -sin, cos, 0, 0]` (konvensi `matApply`/`matMul` app).
- `T(align)` = `[1,0,0,1,ax,ay]`, `(ax, ay) = -bboxMin(mPre.sebelum align)` →
  bbox varian mulai di (0,0).

Penempatan `(dx, dy)` adalah pojok kiri-atas bbox varian di sheet space:

```
mSheet = T(dx, dy) · mPre
mWorld = G · mSheet · F0          // inilah `instances[i].m`
```

`mWorld` adalah similarity (rotasi/mirror + translasi), jadi seluruh master
(outer + lubang) ikut kaku.

### 5.3 Contoh angka yang bisa dicek

Sheet world: `x 100..400`, `y 50..250` → `sx0 = 100`, `sy1 = 250`, `outX = 410`.
Objek: kotak 100×60 world `(150,60)-(250,120)`.

- `F0` → `(50,190)-(150,130)` di sheet space, bbox `x 50..150, y 130..190`.
- Varian angle 0, tanpa flip: `align = (-50,-130)`, `mPre = [1,0,0,1,-50,-130]`.
- Penempatan hasil GA yang sudah dinormalisasi: `(dx, dy) = (0, 0)`.
- `mWorld = [1, 0, 0, 1, 260, 130]`.
- Cek: `(150,60) → (410,190)`, `(250,120) → (510,250)`.

Jadi blok hasil mulai tepat 10 mm di kanan sheet (`410`) dan menempel di garis
atas sheet (`y = 250`). Angka ini dipakai sebagai test case probe (§12.1 #11).

### 5.4 Normalisasi blok

Setelah decode terbaik, semua placement digeser `(-bounds.x, -bounds.y)` supaya
blok mulai di origin output (tidak ada ruang mati di kiri/atas karena sheet besar).
`mWorld` dihitung dari `dx,dy` yang sudah digeser.

---

## 6. Engine: port GA + NFP2

### 6.1 Peta fungsi referensi → `nest/engine.js`

| Referensi (`nestjs2/frontend/js`) | Port | Catatan |
| --- | --- | --- |
| `NFP2SpatialHash` (`nfp2.js`) | `SpatialHash` | cell `max(50, step*5)`, query bbox |
| `NFP2.findBestNFPPlacement` | `*findBestPlacement(obj, variant)` | scanline + score prune + vertex pass |
| `NFP2.getCandidatePositions` | `vertexCandidates(variant, placed)` | 6 titik acuan × vertex |
| `NFP2.checkCollisions` | `collides(placed, variant, x, y)` | AABB → poly → sheet |
| `NFP2.calculateTotalBounds` | `boundsOf(placed)` | |
| `NFP2.compactSolution` | — | tidak perlu (tidak ada renest) |
| `NFPGA.findBestPosition` (`nfp_ga.js`) | `*gaSearch(ctx)` | elitism 2, OX, mutasi |
| `NFPGA._evaluate` | `*decode(ctx, chromosome)` | tanpa sheet clone, tanpa `fixed` |
| `NFPGA._createChromosome` | `createChromosome()` | permutation + rotation gene |
| `NFPGA._crossover` | `oxCrossover(a, b)` | OX + rotation gene dari parent A |
| `NFPGA._mutate` | `mutate(c)` | swap 2 gen + ganti rotasi |
| `main.js runNesting` | `run(input, opts)` | generator, bukan worker |

Yang **tidak** diport: `nfp.js` / `nfp_optimized.js` (varian "Grid"/noise),
`renest`, `multiCPU`, preview kanvas, preset file, infinite loop.

### 6.2 Formula yang dipertahankan

```
score(x, y, variant) = (y + h * 2) * 2 + x * 0.1 + penalty
penalty              = variant.holes > 0 ? 500 : 0        // mm², hanya tie-break
score               -= insideBonus                        // 5000 kalau masuk lubang
```

- Preferensi: **atas dulu, lalu kiri** (sheet space Y-down).
- Early break per baris: `if (best && y > H/3) break` — kalau sudah ada tempat
  bagus di sepertiga atas, tidak perlu memindai sisa sheet.
- Prune per kolom: `if (score > bestScore + 100) break` (score naik monoton
  terhadap x).
- Fitness GA:

```
fitness = bounds(placed).w * bounds(placed).h
        + Σ (bboxArea(obj) untuk setiap objek yang tidak muat)
```

  kecil = lebih baik. Baseline (urutan `longest side²` desc, rotasi 0) selalu
  jadi individu pertama, jadi hasil GA **tidak mungkin lebih buruk** dari urutan
  naif itu.
- Elitism 2; total evaluasi = `pop * gens + 1`.
- Mutasi: `mutationRate` (0.1) → 30% swap dua gen, 30% ganti satu gen rotasi,
  40% keduanya (persis pola referensi).

### 6.3 Deviasi yang disengaja (dan alasannya)

1. **Satuan mm, bukan `GEOM_SCALE = 1000`.** Semua toleransi (`0.001 mm`) dan
   `penalty`/`insideBonus` diskalakan. Ini menghilangkan seluruh `/1000` di
   referensi dan membuat probe bisa membandingkan angka mm langsung.
2. **Sheet sebagai polygon, bukan kotak.** `findBestPlacement` memakai
   `freeSpansAtY(y)`: interval bebas = span sheet dikurangi interval part yang
   sudah terpasang. Kelebihan vs referensi:
   - sheet berlubang / tidak konveks ditangani benar;
   - referensi `x = ceil(intersections[i+1])` mengasumsikan tiap part memberi
     tepat 2 perpotongan dan pasangan bersebelahan — rapuh kalau ada >2 objek
     sebaris. Span subtraction selalu benar.
3. **`insideBonus` dikembalikan, bukan disimpan di objek varian.** Referensi
   menaruh `variant.insideBonus` lalu membacanya setelah pengecekan; nilai basi
   dari kandidat sebelumnya bisa terbawa. Port mengembalikan
   `{hit, bonus}` per kandidat.
4. **Flip benar-benar diimplementasikan.** Di referensi `setAllowFlip` tidak
   pernah dipakai `NFP2` (flip hanya hidup di drag-rotate). Di sini flip
   menambah varian.
5. **Tanpa `complexityPenalty = 1000 * GEOM_SCALE`;** diganti `500 mm²` kecil
   supaya tidak mendominasi score yang kini dalam mm.
6. **Normalisasi blok** (§5.4), tidak ada di referensi.
7. **Tanpa noise acak di score.** Noise hanya berguna untuk infinite nesting;
   di sini randomness datang dari populasi/mutasi.
8. **Deadline per decode** (§7.3), tidak ada di referensi (worker tidak perlu).

### 6.4 Pseudocode inti

```js
// generator, yield progress tiap 512 uji
function* findBestPlacement(ctx, obj, variant) {
  let best = null, bestScore = Infinity, tests = 0;
  const { w, h } = variant.bbox;
  for (let y = 0; y + h <= ctx.sheetH; y += ctx.step) {
    for (const [x0, x1] of freeSpansAtY(ctx, y)) {
      for (let x = x0; x + w <= x1; x += ctx.step) {
        const score = baseScore(x, y, variant);
        if (best && score > bestScore + 100) break;
        const r = collides(ctx, variant, x, y);
        if (!r.hit) {
          const s = score - r.bonus;
          if (s < bestScore) { bestScore = s; best = { x, y }; }
          if (r.bonus > 5000) return best;      // pas masuk lubang: sudah optimal
        }
        if ((++tests & 511) === 0) yield { phase: 'place', tests };
      }
    }
    if (best && y > ctx.sheetH / 3) break;
  }
  // pass presisi: tempelkan ke vertex part yang sudah ada
  for (const cand of vertexCandidates(ctx, variant)) {
    const r = collides(ctx, variant, cand.x, cand.y);
    if (!r.hit) {
      const s = baseScore(cand.x, cand.y, variant) - r.bonus;
      if (s < bestScore) { bestScore = s; best = cand; }
    }
    if ((++tests & 511) === 0) yield { phase: 'vertex', tests };
  }
  return best;
}

function* decode(ctx, chromosome) {
  const placed = [], hash = new SpatialHash(ctx.step);
  let unplacedArea = 0;
  for (let i = 0; i < chromosome.order.length; i++) {
    const obj = ctx.objects[chromosome.order[i]];
    const variant = obj.variants[chromosome.rot[i] % obj.variants.length];
    if (ctx.deadline && now() > ctx.deadline) { unplacedArea += obj.area; continue; }
    const at = yield* findBestPlacement(ctx, obj, variant);
    if (!at) { unplacedArea += obj.area; continue; }
    placed.push({ obj, variant, x: at.x, y: at.y });
    hash.insert(at.x, at.y, variant.bbox.w, variant.bbox.h, placed.length - 1);
  }
  const b = boundsOf(placed);                 // 0×0 kalau tidak ada yang muat
  return { placed, area: b.w * b.h + unplacedArea, bbox: b };
}
```

### 6.5 Collision

Urutan cek (yang murah dulu):

1. bbox varian di dalam bbox sheet? kalau tidak → hit.
2. **sheet containment**: semua vertex varian di dalam `sheet.outline` dan tidak
   ada edge varian yang memotong edge sheet (atau edge lubang sheet) → lanjut.
   Ini yang membuat sheet non-konveks benar.
3. query `SpatialHash` dengan bbox varian; untuk tiap kandidat:
   `polysOverlap(varian shifted, placed.poly)` → hit.
4. **lubang**: kalau varian **seluruhnya** di dalam salah satu hole part yang
   sudah terpasang → bukan hit, `bonus = 5000` (hemat bahan; mengikuti referensi,
   termasuk batasannya: hanya lubang, bukan "di dalam part").

`polysOverlap(a, b)`: bbox reject dulu, lalu (i) ada vertex a di dalam b,
(ii) ada vertex b di dalam a, (iii) ada pasangan edge yang berpotongan
(strict, tidak menghitung sentuhan). Toleransi geometri `0.001 mm`; jarak nyata
antar-part dijamin oleh penggemukan `gap/2` (§6.6).

### 6.6 Gap

`gap` tidak dihitung saat collision (mahal dan rawan). Cara yang sama dengan
referensi: tiap part **digemukkan** `gap/2` sekali di awal.

```
grown = offsetChains([{pts: outer, closed:true}, ...holes], gap/2)
```

`offsetChains` (Clipper) sudah menangani island vs hole (outer tumbuh, hole
menyusut) sehingga inner offset ring tetap benar. Yang dipakai di engine:
`grown[0]` sebagai poly collision, `grown[1..]` sebagai hole. Geometri output
tetap outer/hole asli → gap terlihat sebagai celah, bukan perubahan bentuk.

Karena poly di-simplify 0.02 mm, clearance efektif = `gap - 0.04 mm`. Aman untuk
`gap ≥ 0.5`. Kalau `gap = 0`, clearance bisa sedikit negatif (tumpang tindih
0.02 mm) — status panel memperingatkan `gap 0: part bisa bersinggungan`.

### 6.7 Varian

`obj.variants` dibangun sekali per job:

```
angles = parseRotation(opts.rotation)   // "0,90,180,270" -> [0,90,180,270]
vars = []
for (a of angles) for (f of (opts.flip ? [false, true] : [false])) {
  const m = composePre(outer, holes, a, f);   // mPre + bbox + poly
  vars.push({ m, bbox, poly: grownOuter, holes: grownHoles, angle: a, flip: f });
}
```

Kalau `angles` kosong / tidak valid → `[0]`. Varian dengan bbox > sheet dibuang
lebih awal (tidak mungkin muat).

---

## 7. Eksekusi background

### 7.1 Kenapa bukan Web Worker

App dibuka dari `file://`. `new Worker('nest/worker.js')` gagal di Chrome
(`file://` tidak boleh memuat worker), dan fallback Blob worker juga diblokir
di sebagian konfigurasi. Solusi yang pasti jalan di semua cara buka file:
**generator + scheduler di main thread**, dipecah per ~12 ms. Ini bukan
"background" dalam arti thread terpisah, tapi dari sisi UX sama: UI tetap
merespons klik/pan, progress jalan, Stop instan.

Kalau nanti app disajikan lewat `http://` (mis. `python -m http.server`), worker
bisa ditambahkan tanpa mengubah engine (engine murni, tidak menyentuh DOM).

### 7.2 Scheduler

```js
let nestRun = null;   // { job, stop, t0, lastPaint, totalEvals }

function nestStep() {
  if (!nestRun) return;
  if (nestRun.stop) return nestAbort();
  const t = performance.now();
  let done = false, msg = null;
  try {
    while (performance.now() - t < 12) {
      const s = nestRun.job.next();
      if (s.done) { done = true; msg = s.value; break; }
      msg = s.value;
    }
  } catch (err) {
    console.error('[nest] crash', err);
    toast('Nesting gagal: ' + err.message);
    return nestAbort();
  }
  if (done) return nestFinish(msg);
  nestPaint(msg);                        // throttle: >=1% atau >=100 ms
  nestRun.timer = setTimeout(nestStep, 0);
}
```

- `setTimeout(0)` (bukan `requestAnimationFrame`) supaya tetap maju saat tab
  tidak aktif (rAF berhenti total di tab background).
- Generator yield tiap 512 uji collision / 1 part / 1 evaluasi, jadi satu slice
  tidak bisa jauh melewati 12 ms.
- `performance.now()` untuk statistik; jangan pakai `Date.now()` (clock bisa
  melompat).

### 7.3 Deadline & budget

- `opts.deadline = t0 + budgetMs` (Fast 8 s, Normal 30 s, Thorough 120 s).
- Deadline diperiksa **per objek** di `decode` (bukan per kandidat): kalau lewat,
  sisa objek dihitung unplaced → decode tetap selesai dengan hasil valid.
- Setelah deadline, `gaSearch` menyelesaikan evaluasi yang sedang jalan lalu
  berhenti; hasil = individu terbaik yang **sudah selesai** dievaluasi.
- Jadi job selalu berakhir dengan solusi utuh (tidak ada layout separuh jadi),
  dan paling lambat overshoot satu evaluasi.
- `maxCandidateTests` per part (default 60 000) sebagai jaring pengaman untuk
  sheet raksasa; kalau tercapai, part dianggap tidak muat di kandidat itu.

### 7.4 Interaksi selama job

- Kanvas tetap bisa di-pan/zoom. Kalau owner mengubah geometri master/sheet saat
  job jalan: input sudah **snapshot** (polygon + matrix anchor diambil di awal),
  jadi hasil tetap konsisten. Saat finish, entity yang sudah hilang dilewati
  (+ toast "1 objek dilewati: entity sudah dihapus").
- `anchor` untuk `instances[i].a` diambil dari kondisi **awal** job, sehingga
  kalau master sempat digeser, clone tetap mendarat di tempat yang direncanakan.
- Menjalankan job baru saat job lama jalan tidak mungkin (tombol disabled).

### 7.5 Progress

```
progress = (evalsDone + placedSoFar / objectCount) / totalEvals
```

- `evalsDone` = evaluasi selesai (baseline + tiap individu non-elit).
- Bar + teks `eval n/m`, `Placed k/n` (dari decode yang sedang jalan), dan
  `best` (fitness terbaik sejauh ini) supaya owner melihat ada kemajuan.
- Progress hanya naik (monotonic); reset 0 saat job baru.

---

## 8. Output: clone, penempatan, unplaced

### 8.1 Satu clone per objek

Untuk tiap objek dibuat **satu** entity clone berisi seluruh instance objek itu
(biasanya 1; kalau tidak muat, 1 instance unplaced):

```js
{
  id: newId(),
  type: 'array',
  kind: 'clone',
  params: { origin: 'nest', run: 3 },     // penanda hasil nesting
  color: colorOf(masterPertama),
  layer: layerMaster,
  masters: obj.entityIds,                  // outer + holes, urut stabil
  instances: [
    { m: [1,0,0,1,260,130], a: [150,60] }  // a = anchor master saat job mulai
  ]
}
```

- `masters` = entity loop outer + semua loop lubang. Urutan diambil dari
  `obj.entityIds` yang diurutkan naik supaya deterministik (save/load & undo rapi).
- `a` = titik pertama master (`cloneAnchorOf` memakai `entityPointIds`), nilainya
  dari snapshot awal. Ini yang membuat clone "tinggal di tempat" saat master
  digeser (`cloneInstanceOffsets` membatalkan translasi anchor).
- `color`/`layer` hanya untuk pewarnaan array di daftar; geometri tetap mengikuti
  master (`arrayShapesOf`).
- Save/load: `instances` + `a` sudah diserialisasi (`app.js:25093-25103`), jadi
  hasil nesting bertahan setelah simpan/buka.

### 8.2 Penempatan hasil

```
GAP = 10 mm
outX  = max(sheet.bbox.maxX, masters.bbox.maxX) + GAP
outTop = sheet.bbox.maxY            // blok mulai dari garis atas sheet
```

- Blok hasil = bbox placement yang sudah dinormalisasi (§5.4) → mulai di
  `(outX, outTop)`.
- Tidak muat: satu kolom di kanan blok, mulai dari atas blok, jarak 10 mm:

```
cursorX = block.w + GAP        // relatif sheet space
cursorY = 0
for (obj of unplaced) {
  mSheet = T(cursorX - srcBBox.minX, cursorY - srcBBox.minY) · mPre(angle 0)
  cursorY += srcBBox.h + GAP
}
```

  Hasilnya: tumpukan vertikal di kanan blok, tidak menimpa blok, tidak menimpa
  sheet. (Kalau owner ingin horizontal, cukup ubah satu baris — dicatat di §13.)

### 8.3 Commit & undo

- Semua clone dibuat dalam **satu** `pushHistory()` + `commit()`.
- Kalau ada hasil lama (`nestPanel.lastCloneIds`), hasil itu dihapus **dalam
  langkah undo yang sama** (push sekali, hapus lama, buat baru, commit). Jadi
  satu Ctrl+Z mengembalikan keadaan sebelum Nest terakhir.
- Setelah commit: `ui.selection` = id clone baru, `render()` lewat `commit()`,
  status panel diisi (§3.3), `geometryEpoch` naik otomatis (clone di-rebuild).
- Kalau hasil kosong (0 placement), tetap buat clone unplaced supaya owner
  melihat objeknya tidak hilang — tapi kalau **semua** unplaced, jangan pindahkan
  apa pun; cukup status "semua tidak muat, tidak ada yang ditempatkan"
  (menghindari tumpukan sia-sia di kanan sheet). Ini keputusan yang bisa
  dibalik (§13).

### 8.4 Kenapa clone, bukan copy entity

- Master tetap di tempatnya (owner tidak kehilangan gambar asli).
- Edit master (geser, ubah panjang, ganti radius) langsung terlihat di semua
  salinan → owner bisa memperbaiki part setelah nesting.
- Satu entity per objek = dokumen ringan: 200 objek × 1 matrix, bukan 200 × 40
  entity hasil copy. Ini penting karena app ini sudah berat di dokumen besar.
- CNC/export sudah memahami clone (`arrayInstancePolylines`, `cncShapesOf`).

Risiko yang diterima: clone tidak bisa diedit per-instance (harus edit master
atau "bake"/explode dulu). Itu konsisten dengan cara kerja fitur clone yang ada.

---

## 9. File yang disentuh & struktur kode

### 9.1 Tabel perubahan

| File | Status | Isi |
| --- | --- | --- |
| `nest/engine.js` | **baru** (~900 baris) | engine GA+NFP2 murni: geometri, varian, span, collision, GA, generator |
| `index.html` | edit | `<script src="nest/engine.js">` setelah `core.js` (baris 767) + markup panel di sidebar (± baris 352) |
| `styles.css` | edit | `.nest-*`: baris setting, daftar objek, progress bar, badge — ikut style panel yang ada |
| `app.js` | edit | blok `// ---- Nesting (local) ----` setelah blok nesting server, hook `updateUI()`, wiring tombol, prefs |
| `help.js` | edit | section "Nesting" (bilingual, 3 paragraf) |
| `testing/nesting_probe.js` | **baru** (~320 baris) | kontrak + matematika engine (§12.1) |
| `.commandcode/settings.json` | edit | izin `Shell(node testing/nesting_probe.js 2>&1)` |
| `ARCHITECTURE.md` | edit | baris file baru di tabel, catatan testing, 2 invariant |
| `tests/smoke.js` | — | **tidak diubah** (engine self-contained, tidak menambah global core) |
| `core.js` | — | **tidak diubah** |
| `tools/*`, `ai/*`, `server/*` | — | tidak diubah |

Alasan `core.js` tidak disentuh: semua matematika nesting bersifat khusus fitur
(polygon bertingkat, span, matrix varian). Menaruhnya di `core.js` akan
menambah ~600 baris ke file yang dipakai semua fitur, sementara engine yang
self-contained cukup satu `require` di probe dan satu `<script>` di app. Aturan
"pure → core.js" tetap dihormati dalam semangat: engine murni, tanpa DOM, diuji
probe.

### 9.2 Isi `nest/engine.js`

```
// ---- helpers (pure, no DOM) ----
bboxPts, area, pointInPoly, interiorOf, polysOverlap, edgeCross,
spanSubtract, spansOfPoly, freeSpansAtY, rdp
matMul, matApply, composePre

// ---- variants ----
buildVariants(obj, opts)          // rotasi x flip, grown + collision poly
buildSheet(sheet)                 // outline + holes + bbox

// ---- placement ----
SpatialHash
collides(ctx, variant, x, y)
*findBestPlacement(ctx, obj, variant)
vertexCandidates(ctx, variant)

// ---- GA ----
createChromosome(ctx)
oxCrossover(a, b)
mutate(c, rate)
*decode(ctx, chromosome)
*gaSearch(ctx, opts)
run(input, opts)                  // = gaSearch + normalisasi + matrix world

// ---- ekspor ----
window.MiniSketchNest = { run, __test: { ...pure helpers... } }
if (typeof module !== 'undefined') module.exports = window.MiniSketchNest
```

Engine tidak memanggil Clipper (`offsetChains` hidup di app). Pembagian tugas:
app menggemukkan polygon dengan `offsetChains(gap/2)` lalu mengirim hasilnya
sebagai `obj.grown`; engine memakai `grown` untuk collision, dan `outer`/`holes`
asli untuk geometri output. Kalau `grown` tidak ada (probe), engine memakai
geometri asli (gap 0) — probe tidak butuh Clipper. Dengan begitu engine bebas
dependensi dan Clipper tetap satu-satunya sumber kebenaran untuk offset.

Kontrak input final:

```js
MiniSketchNest.run({
  sheet: { outline: [[x,y]...], holes: [[[x,y]...]] },
  objects: [{
    key: 'o1',
    outer:   [[x,y]...],            // world, closed, tanpa titik akhir duplikat
    holes:   [ [[x,y]...], ... ],
    grown:   { outer: [...], holes: [...] } | null,   // sudah di-offset gap/2
    anchor:  [x, y]                 // untuk instances[].a
  }],
  frame: { sx0, sy1, outX, gap }    // dari app (§5.1)
}, opts)                            // generator
```

`opts`: `{ rotation, flip, step, gap, popSize, generations, mutationRate,
seed, budgetMs, maxTests }`.

Output (nilai `done`):

```js
{
  placements: [{ key, m: [a..f], bbox: {x,y,w,h}, angle, flip }],
  unplaced:   [{ key, m: [a..f], bbox }],
  block:      { w, h },             // blok hasil setelah normalisasi
  utilization: 0..1,
  stats: { evals, gens, ms, tests, collisions, bestFitness, baselineFitness }
}
```

### 9.3 Blok baru di `app.js`

Ditempatkan **setelah** blok nesting server (`nestSvgString`, ± baris 11714-12000)
dengan header `// ---- Nesting (local GA + NFP2, output = clone) ----`, supaya dua
fitur nesting bersebelahan tapi jelas terpisah:

```js
const NEST_OUT_GAP = 10;
let nestPanel = { objects: [], sheetIds: [], cloneIds: [], run: null, prefs: null };

function nestGreenLoops()            // semua loop hijau di dokumen (owned guide dibuang)
function nestAllLoops()              // getLoops() sekali, dipakai ulang
function nestPickSheet(loop)         // validasi + simpan sheetIds
function nestAddFromSelection()      // loopShapeSelected -> group -> objects
function nestGroupLoops(loops)       // depth parity -> { outer, holes } (§4.2)
function nestLoopPoly(loop)          // §4.4 pathChainsOf + chainPolylines + rdp
function nestBuildGrown(obj, gap)    // offsetChains(gap/2) -> grown
function nestBuildInput()            // world polygons + frame (§5.1)
function nestStart() / nestStep() / nestAbort() / nestFinish(result)
function nestPlaceResult(result)     // hapus hasil lama + buat clone + commit (§8)
function nestCloneFor(obj, matrices)
function nestReadOpts() / nestSavePrefs() / nestLoadPrefs()
function updateNestingPanel()        // dipanggil dari updateUI()
function initNestingPanel()          // listener tombol, sekali saat boot
```

Hook wajib:

- `updateUI()` (`app.js:17536`): tambahkan `updateNestingPanel();` setelah
  `updateArrayList();`. Tanpa ini daftar objek tidak ikut berubah saat undo/redo
  atau saat seleksi berubah.
- Boot: panggil `initNestingPanel()` di tempat tombol-tombol sidebar lain
  di-wire (dekat akhir IIFE), setelah `nestLoadPrefs()`.
- `updateNestingPanel()` harus murah: kalau panel sedang tertutup sidebar
  (`#sidebar.classList.contains('hidden')` / `display:none`), cukup tandai dirty
  dan render saat dibuka.

### 9.4 Markup panel (`index.html`)

```html
<section class="panel" id="panel-nesting">
  <h3>Nesting <span class="nest-badge" id="nest-count"></span></h3>
  <div class="row"><span class="lbl">Sheet</span>
    <span id="nest-sheet-info" class="nest-muted">none</span></div>
  <div class="row">
    <button id="nest-pick-sheet">Pick</button>
    <button id="nest-clear-sheet">Clear</button>
  </div>
  <div class="row"><span class="lbl">Objects</span>
    <span id="nest-obj-count" class="nest-muted">0</span></div>
  <div class="row">
    <button id="nest-add-sel">Add selection</button>
    <button id="nest-clear-objs">Clear</button>
  </div>
  <ul class="list nest-list" id="nest-obj-list"></ul>
  <div class="row"><label for="nest-gap">Gap (mm)</label>
    <input id="nest-gap" type="number" min="0" step="0.5" value="2"></div>
  <div class="row"><label for="nest-rot">Rotation</label>
    <input id="nest-rot" type="text" value="0,90,180,270"></div>
  <div class="row"><label for="nest-flip">Allow flip</label>
    <input id="nest-flip" type="checkbox"></div>
  <div class="row"><label for="nest-quality">Quality</label>
    <select id="nest-quality">
      <option value="fast">Fast</option>
      <option value="normal" selected>Normal</option>
      <option value="thorough">Thorough</option>
    </select></div>
  <div class="nest-progress"><div class="nest-progress-fill" id="nest-fill"></div></div>
  <div class="nest-status" id="nest-status">Draw a green loop as the sheet.</div>
  <div class="row">
    <button id="nest-run" class="primary">Nest</button>
    <button id="nest-stop" disabled>Stop</button>
    <button id="nest-clear-result" disabled>Clear result</button>
  </div>
</section>
```

(`Clear result` menghapus clone hasil nesting terakhir; satu undo step. Ini
satu-satunya tombol tambahan di luar permintaan, karena tanpa itu satu-satunya
cara membatalkan adalah Ctrl+Z — dan owner butuh jalan eksplisit saat mencoba
berkali-kali.)

---

## 10. Urutan implementasi

Tiap fase berakhir dengan kondisi yang bisa dicek, dan tidak ada fase yang
menyentuh UI yang belum siap.

### P0 — Engine + probe (tanpa UI)

1. `nest/engine.js`: helpers + varian + collision + span (tanpa GA).
2. `testing/nesting_probe.js`: kasus #1-#10 (§12.1).
3. `node --check nest/engine.js`, `node testing/nesting_probe.js`.

Selesai bila: semua kasus geometri hijau, tidak ada `require` selain engine.

### P1 — GA + output matrix (masih tanpa UI)

1. `SpatialHash`, `findBestPlacement`, `decode`, `gaSearch`, `run`.
2. Normalisasi blok + `G`/`F0` + `m` world + unplaced layout.
3. Probe #11-#16 (matrix contract, fitness, determinisme, gap, unplaced,
   progress).

Selesai bila: probe membuktikan (a) tidak ada overlap, (b) semua placement di
dalam sheet, (c) `m` memetakan master tepat ke bbox placement, (d) GA tidak
kalah dari baseline, (e) gap terjaga.

### P2 — Panel: sheet & objek (belum bisa run)

1. Markup + CSS panel, `initNestingPanel`, prefs.
2. `nestGroupLoops`, `nestLoopPoly`, deteksi sheet, daftar objek, `updateUI` hook.
3. Status kosong/validasi (belum ada tombol Nest aktif).

Selesai bila: `node --check app.js` lolos; owner bisa menambah/menghapus objek
dan memilih sheet, angka `W×H` di panel cocok dengan bbox di kanvas (owner yang
menilai, bukan agent).

### P3 — Run + progress + Stop (hasil masih di-log)

1. `nestBuildGrown`, `nestBuildInput`, `nestStart/nestStep/nestAbort`.
2. Progress bar + teks, tombol disabled state, log hasil ke console
   (`[nest] result { … }`).
3. Stop: dokumen tidak berubah.

Selesai bila: `node tests/smoke.js` tetap hijau (tidak ada regresi core), dan
owner bisa melihat progress berjalan + Stop bekerja tanpa mengubah dokumen.

### P4 — Clone output + undo + idempotensi

1. `nestPlaceResult`, `nestCloneFor`, pemetaan `a`/`m`, hapus hasil lama.
2. Tombol `Clear result`, seleksi hasil, status akhir (§3.3).

Selesai bila: satu undo menghapus seluruh hasil; run kedua menggantikan blok
lama, bukan menumpuk.

### P5 — Dokumentasi

1. `help.js` section Nesting.
2. `ARCHITECTURE.md`: tabel file, catatan probe, invariant:
   - "Nesting tidak pernah menggeser master; hasil selalu clone."
   - "Engine bekerja di sheet space Y-down; satu-satunya konjugasi ada di
     `frame` (`F0`/`G`)."
3. `.commandcode/settings.json`: izin probe.

Selesai bila: `node --check app.js`, `node --check nest/engine.js`,
`node tests/smoke.js`, `node testing/nesting_probe.js` semua exit 0.

### P6 — Verifikasi owner

Resep §12.2. Agent **tidak** menjalankan browser.

---

## 11. Performa & budget

Beban per objek per kandidat = beberapa test bbox + 1 test polygon. Dengan
score-prune, kandidat yang diuji polygon biasanya puluhan, bukan ribuan.

Estimasi kasar (harus diukur, bukan diklaim):

| Kasus | Uji collision / decode | Decode | GA Normal (31 eval) |
| --- | --- | --- | --- |
| 10 objek, sheet 300×200, step 4 | ~2–5 ribu | ~5–15 ms | ~0.2–0.5 s |
| 50 objek, sheet 1000×600, step 4 | ~50–150 ribu | ~80–300 ms | ~2.5–9 s |
| 200 objek, sheet 2000×1000, step 4 | ~500 rb–1.5 jt | ~1–4 s | ~30–120 s (kena budget) |

Karena itu:

- **Budget** (wall clock, bukan jumlah uji): Fast 8 s / Normal 30 s / Thorough
  120 s. Deadline dicek per objek (§7.3) → job selalu berhenti dengan hasil valid.
- **Cap**: `maxObjects = 200` (di atas itu tolak dengan toast, bukan hang),
  `maxTests` 60 000/part.
- **Bulk safety**: kalau objek > 4000 titik total, naikkan `rdp` tol ke 0.05 mm
  (dengan peringatan status "geometri disederhanakan 0.05 mm").
- Progress paint di-throttle (≥1% atau 100 ms) supaya sidebar tidak jadi beban.
- Tidak ada alokasi objek per test collision (pakai array angka / preallocated
  scratch) — ini yang paling menentukan GC pause di main thread.

Target yang harus dibuktikan di browser (bukan diklaim di sini): 20 objek
sederhana, Normal, selesai < 5 s; selama job jalan, pan/zoom kanvas tetap
merespons dan angka `draw ms` di status bar tidak melonjak permanen.

---

## 12. Pengujian

Sesuai `agents.md`: agent hanya boleh menjalankan `node --check`,
`node tests/smoke.js`, `node testing/tools_probe.js`,
`node testing/assembly_probe.js` (+ probe baru setelah diizinkan). Semua
verifikasi visual/hit-test milik owner.

### 12.1 `testing/nesting_probe.js` — kontrak & matematika

Pola sama dengan probe lain: `ok()/close()`, exit code 1 kalau ada yang gagal,
tanpa DOM. Kasus:

1. **spanSubtract / freeSpansAtY**: sheet L (non-konveks), y di bagian kosong →
   0 span; y yang memotong dua kaki → 2 span; setelah satu part terpasang di
   kaki kiri → span kiri menyempit, span kanan utuh.
2. **polysOverlap**: bersentuhan tepi → false; berpotongan → true; satu di dalam
   yang lain → true; terpisah → false.
3. **pointInPoly / edgeCross**: titik di lubang → false; edge yang menembus
   lubang → terdeteksi.
4. **buildVariants**: kotak 100×60 dengan 4 rotasi → bbox {100×60, 60×100,
   100×60, 60×100}; flip → bbox sama tapi tanda sumbu Y terbalik (cek satu
   vertex); semua bbox mulai di (0,0).
5. **Placement dasar**: satu kotak 100×60 di sheet 300×200, step 4 → `dx=0`,
   `dy=0` (pojok kiri-atas sheet space).
6. **Tidak overlap**: 4 kotak hasil satu decode → setiap pasangan `polysOverlap`
   false, dan semua vertex di dalam sheet.
7. **Lubang**: sheet 300×300, ring 200×200 dengan lubang 100×100, part 80×80 →
   part masuk lubang (`bonus`), dan hasilnya berada di dalam lubang (cek
   `pointInPoly`).
8. **Tidak muat**: part 400×400 di sheet 300×200 → masuk `unplaced`, bukan
   crash, dan `placements` kosong.
9. **GA ≥ baseline**: 8 objek acak (seed 1) → `fitness(best) <= fitness(baseline)`
   (baseline selalu jadi individu pertama) dan `best.placed >= baseline.placed`.
10. **Determinisme**: `seed: 7` dua kali → `m` identik; `seed: 8` → layout boleh
    beda tapi tetap valid (no overlap, semua di dalam sheet).
11. **Matrix contract** (contoh §5.3): sheet `(100,50)-(400,250)`, objek
    `(150,60)-(250,120)`, placement `(0,0)` → `m = [1,0,0,1,260,130]`; apply ke
    kedua sudut → `(410,190)` dan `(510,250)`; `bbox` world = `410,190,100,60`.
12. **Rotasi 90 di world**: placement dengan `angle = 90` → bbox hasil tertukar
    (w/h swap) dan hasil tetap di dalam sheet (cek semua vertex).
13. **Unplaced layout**: 2 unplaced → `m` menempatkan bbox di kanan blok dengan
    jarak tepat `gap` (10 mm), sumbu X sama, Y menurun, dan tidak beririsan
    dengan bbox blok.
14. **Gap**: dua part `grown` → jarak minimum antara `outer` asli ≥
    `gap - 0.05 mm` (sampling edge-to-edge).
15. **Progress**: semua yield `progress` monoton naik 0→1, `evals` berakhir =
    `pop*gens + 1`, dan tidak ada yield setelah `done`.
16. **Abort**: generator dibuang di tengah (`.return()`) → tidak ada exception,
    tidak ada state global yang tertinggal (jalankan `run` lagi setelahnya).

Probe mencetak juga benchmark: 20 kotak 100×60 di sheet 520×400, Normal,
`ms`, `tests`, `collisions`, `fitness` — angka untuk dibandingkan antar
perubahan, bukan assertion.

### 12.2 Resep verifikasi browser (untuk owner)

Persiapan: buka app seperti biasa, layer 1, zoom cukup untuk melihat ± 700×400 mm.

1. **Gambar sheet**: Rectangle tool, warna **Mark (green) `#00ff00`**,
   `300 × 200 mm` di sekitar `x 100..400, y 50..250`. Tidak perlu tertutup rapat
   sempurna — loop dari 4 line sudah cukup, tapi jangan ada celah.
2. **Gambar objek**:
   - 3 kotak `100 × 60` hitam, tersebar.
   - 1 ring: 2 circle `Ø80` dan `Ø40` sepusat (inner di dalam outer).
   - 1 L-bracket: 6 line hitam membentuk L (mis. 120×120 dengan potongan 60×60).
3. Pilih 3 kotak + ring + L (Ctrl+klik tiap loop; untuk ring **jangan** pilih
   inner-nya terpisah — cukup Ctrl+klik di badannya, `Add` akan mendeteksi
   lubang), lalu panel **Add selection**.
   Yang harus terbaca: `Objects (5)`, ring tampil `2 loops, 1 hole`, L-bracket
   `1 loop, 6 pts`.
4. Klik loop hijau → **Pick**. Yang harus terbaca:
   `Sheet 300 × 200 mm · 4 pts · layer 1`.
5. Set `Gap = 2`, `Rotation = 0,90,180,270`, flip off, `Quality = Normal`.
6. Tekan **Nest**. Amati:
   - progress naik (tidak langsung 100), teks `eval n/31`, `Placed k/5`;
   - saat progress ~50%, coba pan kanvas → harus tetap merespons;
   - selesai < 10 s untuk 5 objek (target < 5 s).
7. **Hasil yang diharapkan**:
   - blok hasil muncul **10 mm di kanan** sheet (tepi kiri blok = `410 mm`
     kalau sheet berakhir di `400`), rata atas dengan `y = 250`;
   - 5 clone, tidak ada yang menimpa sheet atau master;
   - status: `Placed 5/5 · block W×H mm · nn% · 31 evals · n.n s`, dengan
     `W ≤ 300`, `H ≤ 200` (harus muat di sheet);
   - master asli **tidak bergerak** (bandingkan L/T/W/H di panel transform
     sebelum dan sesudah Nest — harus sama persis).
8. **Clone mengikuti master**: klik satu master kotak, geser 30 mm ke bawah →
   semua salinan hasil nesting harus **tetap di tempat** (tidak ikut bergeser).
   Lalu ubah lebarnya (drag satu titik) → salinan ikut berubah bentuk.
9. **Undo**: Ctrl+Z sekali → seluruh blok hasil hilang, master & sheet utuh.
   Ctrl+Shift+Z → blok kembali di tempat yang sama.
10. **Re-nest**: tekan Nest lagi → blok lama **diganti**, bukan menumpuk
    (jumlah clone tetap 5). Ctrl+Z sekali → kembali ke blok sebelumnya.
11. **Tidak muat**: buat 1 kotak `250 × 180` tambahan, Add, Nest.
    Harus terbaca `Placed 5/6` (atau 6/6 kalau memang muat) dan kalau tidak
    muat, salinannya muncul **di kanan blok hasil**, tidak menimpa blok.
12. **Stop**: tambah 20 kotak kecil, Nest, tekan Stop saat progress ~30%.
    Dokumen tidak berubah, status jadi `Stopped at 30%`, tombol Nest aktif
    kembali, dan Nest berikutnya jalan normal.
13. **Sheet pindah**: geser loop hijau 200 mm ke kanan, Nest → blok hasil ikut
    pindah (10 mm di kanan posisi sheet yang baru).
14. **Simpan/buka**: Save `.json`, reload halaman, Load → clone hasil masih ada
    di posisi yang sama; Nest lagi tetap menggantikan blok lama.
15. **Tanpa sheet**: hapus loop hijau → tombol Nest disabled + hint yang jelas.
16. **CNC**: buka preview CNC → jumlah kontur = master + salinan; export SVG
    memuat salinan di posisi hasil nesting.

Kalau ada langkah yang tidak sesuai, kirim: (a) screenshot kanvas + panel,
(b) baris console `[nest]` (lihat §12.3), (c) angka status bar
`frame / draw ms`. Jangan menebak dari kode.

### 12.3 Instrumentasi (kalau ada laporan bug)

Jangan menebak. Tambahkan satu baris log yang di-gate supaya tidak berisik:

```js
if (localStorage.getItem('minisketch.nestDebug') === '1') {
  console.log('[nest] input', {
    sheet: { w, h, holes: sheetHoles.length },
    objects: objects.map(o => ({ key: o.key, outer: o.outer.length,
                                 holes: o.holes.length,
                                 w: +o.w.toFixed(2), h: +o.h.toFixed(2) })),
    opts
  });
  console.log('[nest] result', {
    placed: result.placements.length, unplaced: result.unplaced.length,
    block: result.block, util: +result.utilization.toFixed(3),
    stats: result.stats, outX
  });
}
```

Satu baris ini memisahkan "hitungan salah" dari "hitungan benar tapi render
salah". Owner mengaktifkan dengan
`localStorage.setItem('minisketch.nestDebug','1')` lalu reload.

---

## 13. Risiko, edge case, keputusan terbuka

### 13.1 Risiko utama

| Risiko | Dampak | Mitigasi |
| --- | --- | --- |
| Scanline lambat di sheet besar / part banyak | UI tersendat | budget + cap + slice 12 ms; quality preset; `draw ms` dipantau owner |
| Main thread (tanpa worker) | pan/zoom tersendat saat job | slice 12 ms + tidak ada alokasi per test; job bisa di-Stop |
| Compound grouping salah (dua kotak bersarang yang bukan part+lubang) | objek dianggap berlubang | panel menampilkan `n loops, m holes` **sebelum** Nest; owner bisa Clear dan pilih ulang |
| Loop berbagi entity dengan loop lain | clone ganda / grouping aneh | dideteksi saat Add (`entityIds` overlap) → toast "loop berbagi entity, dilewati" |
| Simplify 0.02 mm memakan clearance saat `gap` kecil | part bersinggungan | clearance = gap − 0.04 mm; peringatan saat `gap < 0.5` |
| Sheet hijau ganda (mis. guide hijau) | sheet salah | auto hanya kalau tepat satu; kalau lebih → wajib Pick |
| Hasil menimpa master yang digambar di kanan sheet | tumpang tindih visual | `outX = max(sheet.maxX, masters.maxX) + 10` |
| Clone dianggap "hasil" lalu diedit manual | re-nest menimpa editan | didokumentasikan di Help: edit master, bukan clone |
| Undo besar (200 clone) | jeda sesaat | satu commit, satu `geometryEpoch` bump |

### 13.2 Edge case & perilaku

| Kasus | Perilaku |
| --- | --- |
| Tidak ada loop hijau | Nest disabled, hint |
| >1 loop hijau & tidak ada yang dipilih | minta Pick |
| Objek > sheet (semua varian) | semua unplaced; kalau 0 placement, tidak ada yang dipindah, status jelas |
| 1 objek saja | decode 1 part, langsung ditempatkan di (0,0) varian terbaik |
| Sheet berlubang | lubang jadi obstacle, part tidak ditaruh di sana |
| Loop 2 titik (line bolak-balik) | area ~0 → dilewati dengan toast |
| `gap` 0 | boleh, tapi peringatan clearance |
| `rotation` kosong/invalid | fallback `[0]` |
| Master dihapus saat job jalan | objek dilewati saat finish + toast |
| Sheet dihapus saat job jalan | frame sudah snapshot; hasil tetap dibuat, status memperingatkan |
| Objek di layer terkunci | tidak bisa terseleksi, jadi tidak masuk |
| Dokumen besar (>1200 entity, render bulk) | tetap jalan; clone menambah sedikit entity |
| Zoom ekstrem saat finish | clone dibuat di world coords, tidak terpengaruh zoom |
| Undo saat job jalan | job membaca snapshot; hasil tetap konsisten |

### 13.3 Keputusan terbuka (default saya, silakan koreksi)

1. **Gap default 2 mm** (referensi 0). Kalau owner ingin persis referensi,
   ubah satu nilai di markup.
2. **Qty** tidak ada di v1. Kalau owner butuh "10 pcs per objek", itu perubahan
   kecil di `decode` (setiap objek jadi N entri) + UI angka; saya sarankan
   ditunda sampai layout dasar enak dipakai.
3. **Unplaced vertikal** di kanan blok. Kalau lebih suka horizontal (seperti
   `layoutUnplacedToRight` referensi), satu baris di §8.2.
4. **0 placement** tidak memindahkan apa pun. Alternatif: tetap tumpuk semua di
   kanan supaya owner lihat "ini yang tidak muat".
5. **`outX` ikut bbox master**, bukan hanya sheet. Kalau owner ingin selalu
   persis 10 mm dari sheet, hapus `masters.bbox.maxX` dari `max(...)`.
6. **Rotasi 8 arah** (0,45,…) belum masuk preset panel karena referensi default
   4 arah; parser rotasi sudah mendukung `"0-360:45"` kalau nanti dibutuhkan.
7. **Sheet hijau** dianggap sheet walau owner mungkin memakai hijau untuk
   "Mark". Kalau itu mengganggu, alternatifnya sheet dipilih manual tanpa
   auto-deteksi — tapi itu menghilangkan bagian permintaan "1 loop hijau =
   lembar".
8. **Lubang objek** dianggap bagian dari objek (tidak diisi part lain) kecuali
   part lain **seluruhnya** masuk lubang (aturan referensi, `insideBonus`).

---

## 14. Kriteria terima

Fitur dianggap selesai bila semua ini benar:

- [ ] Panel Nesting ada di sidebar, bisa dibuka/tutup bersama sidebar, tidak
      menggeser layout panel lain.
- [ ] Add selection mengubah loop terseleksi menjadi objek; compound loop jadi
      satu objek dengan jumlah lubang terbaca; objek ganda ditolak.
- [ ] Loop hijau terdeteksi otomatis kalau tunggal; kalau ganda, wajib Pick.
- [ ] Nest berjalan dengan progress yang naik, bisa di-Stop kapan saja tanpa
      mengubah dokumen.
- [ ] Hasil = clone; master tidak bergerak dan tidak berubah.
- [ ] Blok hasil 10 mm di kanan sheet, rata atas, tidak menimpa sheet/master.
- [ ] Objek yang tidak muat ada di kanan blok, tidak menimpa blok.
- [ ] Satu Ctrl+Z membatalkan seluruh hasil; Nest ulang menggantikan hasil lama
      (satu undo untuk keduanya).
- [ ] Clone mengikuti edit master (geser/ubah bentuk) tanpa berpindah tempat.
- [ ] Save/load mempertahankan hasil.
- [ ] `node --check app.js`, `node --check nest/engine.js`,
      `node tests/smoke.js`, `node testing/nesting_probe.js` exit 0.
- [ ] Owner sudah menjalankan resep §12.2 di browser dan menyatakan sesuai.

---

## 15. Lampiran

### 15.1 Parameter referensi vs default MiniSketch

| Parameter | Referensi (`nestjs2/frontend`) | MiniSketch |
| --- | --- | --- |
| Sheet | input W/H (kotak) | loop hijau (polygon, boleh berlubang) |
| Spacing | 0 mm, offset tiap part `spacing/2` | `gap` 2 mm, offset `gap/2` |
| Grid snap | 4 mm | 4 mm |
| Rotasi | `0,90,180,270` (juga range) | sama, default 4 arah |
| Flip | checkbox (tidak dipakai NFP2) | benar-benar dipakai |
| Populasi / generasi / mutasi | 6 / 5 / 0.1 | sama |
| Elitism | 2 | 2 |
| Fitness | bbox area + unplaced bbox area | sama |
| Baseline | longest side² desc, rotasi 0 | sama |
| Progress | evals/total | + fraksi part |
| Eksekusi | Web Worker | generator + `setTimeout(0)` |
| Output | SVG preview, download | clone di dokumen |

### 15.2 Contoh entity clone hasil nesting

```json
{
  "id": 8123,
  "type": "array",
  "kind": "clone",
  "params": { "origin": "nest", "run": 2 },
  "color": "#000000",
  "layer": 1,
  "masters": [412, 413],
  "instances": [
    { "m": [1, 0, 0, 1, 260, 130], "a": [150, 60] },
    { "m": [0, 1, -1, 0, 410, 250], "a": [150, 60] }
  ]
}
```

Arti: instance 1 = penempatan tanpa rotasi; instance 2 = rotasi 90° lalu
dipindah. `a` = anchor master saat job mulai (stabil walau master digeser).

### 15.3 Urutan eksekusi sekali jalan (untuk dibaca cepat)

```
klik Nest
  ├─ validasi sheet + objek + prefs
  ├─ snapshot: loop → poly (pathChainsOf 0.05) → group (depth parity)
  │            → grown (offsetChains gap/2) → varian (rotasi × flip)
  │            → frame (sx0, sy1, outX)
  ├─ job = MiniSketchNest.run(input, opts)        (generator)
  ├─ loop slice 12 ms: baseline → populasi → generasi (elitism, OX, mutasi)
  │            → simpan best decode lengkap
  ├─ deadline/budget → selesai dengan best yang valid
  ├─ normalisasi blok + unplaced column
  ├─ matrix world per instance (G · mSheet · F0)
  ├─ pushHistory → hapus clone hasil lama → buat clone baru → commit
  └─ status + seleksi hasil
```
