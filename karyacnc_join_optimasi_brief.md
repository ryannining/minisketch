# Brief — Teknik Optimasi Join/Chaining di KaryaCNC (untuk AI MiniSketch)

> **Kepada:** AI yang mengerjakan **MiniSketch asli**.
> **Tujuan:** berbagi teknik yang membuat join di KaryaCNC cepat, agar bisa diterapkan pada join MiniSketch (yang saat ini sangat lambat di file besar, mis. ribuan segmen dari PDF mahasiswa).
> **Lokasi kode referensi:** `frontend/public/appcore.js` — blok `if (join)` di `pathstoText1` (PASS 1 & 2), helper `jc*`, dan `gridQueryRing`/`srtGrid` di `sortedgcode`.

---

## 0. Kenapa join KaryaCNC relatif cepat

Join KaryaCNC tetap O(n²) **di kasus terburuk**, tapi menjadi cepat di praktik karena **memangkas sebagian besar pasangan dengan uji murah sebelum uji mahal**. Intinya: jangan pernah melakukan perbandingan titik-per-titik untuk pasangan yang jelas-jelas tidak berdekatan.

---

## 1. Precompute "invariant murah" sekali per path

Sebelum loop pasangan, hitung sekali untuk setiap path:
- **Bounding box** (min/max x,y) → `jcBounds()`.
- **Panjang polyline** → `jcPolyLen()`.

Hash ini di-cache dalam array `pBox[]`/`pLen[]` dan dipakai berulang tanpa menghitung ulang.

## 2. Rejection bounding-box sebelum uji mahal

```js
if (!jcBoxHit(pBox[i], pBox[ii], dupLin)) continue;  // cheap reject
if (!jcIsDup(pa[0], p[0], dupTol)) continue;          // expensive test
```

- `jcBoxHit` = uji tumpang-tindih bbox **plus margin** (`g` ≈ toleransi linier).
- Hanya kalau bbox bertabrakan baru lanjut ke uji geometri mahal. Mayoritas pasangan ditolak di sini (O(1)).

## 3. Pemangkasan kandidat dengan ambang jarak

Chaining (PASS 2) hanya mengumpulkan **kandidat ujung yang berada dalam toleransi join** dari ekor polyline:
```js
var d1 = sqr(p1[0]-ox) + sqr(p1[1]-oy);
if (d1 < joinTol) cands.push([d1, ii, 0]);  // hanya endpoint dekat
```
Tidak semua path di-scan penuh; cukup yang ujungnya dekat. Lalu kandidat **disortir berdasarkan jarak** dan dicoba dari yang terdekat.

## 4. Predikat geometri khusus dengan early-out

- `jcIsDup`: cek **pencocokan vertex** (maju/mundur) dulu — cepat dan eksak untuk duplikat pas. Baru fallback ke `jcLiesOn` (uji "berada di atas").
- `jcLiesOn`: uji segmen, bukan hanya vertex — pakai **titik tengah + kedua ujung + titik ¼/¾** pada segmen terdekat, dengan early-out begitu ada yang meleset.
- `jcPtSegD2`: jarak titik-ke-segmen dengan proyeksi ter-clamp.

## 5. Guard rail untuk kebenaran (jangan join salah)

- `jcJoinAllowed(chain, cand, eps, window)`: menolak join yang **menyilang atau menelusuri ulang** garis yang sudah jadi bagian chain. Jendela `window` membatasi seberapa jauh ke belakang chain dicek (bukan seluruh chain) → murah.
- `jcOverlapLen`: mendeteksi garis yang terpotong dua kali (overlap kolinear).

## 6. Spatial-hash grid — expanding-ring query (untuk pencarian tetangga)

`gridQueryRing(gridObj, x, y, maxItems, maxR)` dipakai di `sortedgcode` untuk **nearest-polygon sort**:
- Bagi bidang menjadi **sel seragam** (`cellSize`), petakan tiap item ke selnya (`floor(x/cell)`).
- Query: jalan **L-infinity ring keluar** dari sel titik acuan sampai jarak maksimum, kumpulkan item (stop saat seluruh extent tertutup).
- Ini mengubah pencarian tetangga terdekat dari O(n) menjadi mendekati O(1) per query (hanya sel sekitar).

**Catatan penting:** di KaryaCNC, **containment (parent/child)** sengaja TIDAK pakai grid — karena hash 3×3 pernah memberi hasil salah untuk kotak bersarang (yang kecil di dalam besar). Jadi: gunakan grid untuk pencarian *tetangga*, tapi jangan untuk keputusan yang butuh keutuhan global seperti containment.

---

## 7. Rekomendasi spesifik untuk MiniSketch

1. **Buat indeks ujung segmen** (uniform grid ATAU `Map` keyed oleh koordinat bulat, seperti `cncChains`) agar pencarian ujung yang bersentuhan bukan scan semua.
2. **Bounding-box pre-rejection** sebelum uji overlap/duplikat.
3. **Pangkas kandidat dengan ambang jarak** (toleransi join), sortir terdekat dulu.
4. **Jaga kebenaran**: jangan join yang menyilang/menelusuri ulang (guard rail), dan jangan andalkan grid untuk containment.
5. Biasanya profil menunjukkan jalur **chaining** paling panas — di situ fokuskan optimasi.

---

## 8. Referensi kode

- `appcore.js`:
  - `jcBounds` (3950), `jcBoxHit` (3962), `jcPtSegD2` (3967), `jcLiesOn` (3986), `jcIsDup` (4022), `jcFirstSeg` (4040), `jcOverlapLen` (4047), `jcJoinAllowed` (4102), `gridQueryRing` (3865).
  - PASS 1 & 2 di `pathstoText1` (±4399–4540).
  - `srtGrid`/`gridQueryRing` di `sortedgcode` (±2665–2830).

---

## 9. Status implementasi di MiniSketch

Teknik di atas sudah diterapkan dan ter-commit di repo MiniSketch:

- **Join saat import** (`joinImportedSegments`): hanya warna sama, jarak minimal
  `joinImportTol` (Settings → Geometry), dedupe garis dobel persis **sebelum**
  weld dan lagi **sesudah** weld (pembersihan post-weld — koreksi: PDF asli
  terpisah, weld menyatukan ujung sehingga near-duplikat baru menjadi dobel
  persis setelah weld).
- **Dedupe rute CNC**: `cncCollectItems(scope, {dedupe:true})` membuang segmen
  ganda (key tak-berarah ±1e-4 mm + warna/fill sama) **sebelum** chaining —
  dipakai di **kedua** rute (classic & JSON), termasuk jalur cost quote.
  Alasan: `skipJoin:true` membuat KaryaCNC tidak lagi menambal topologi, jadi
  data yang dikirim harus benar-benar bersih.
- **Rute JSON v1**: frame `{type:'job', version:1, units:'mm', ...,
  paths:[{color, pts, closed, skipJoin:true, fill?}], images:[...]}`;
  koordinat Y-up, origin bebas; pilihan rute persist di localStorage
  (`CNC_KEY.route`); default tetap classic.
- **Optimasi performa lain**: `loopDepthOf` (bbox cache + quick-reject,
  ~2.8×), snap (AABB reject + cache centroid loop).
