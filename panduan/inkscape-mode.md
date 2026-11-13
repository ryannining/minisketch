# Inkscape Mode — rencana konversi navigasi & shortcut MiniSketch

Status: **RENCANA** (belum ada kode). Dokumen ini acuan eksekusi; jangan
diterapkan sekaligus, ikuti urutan di bagian bawah. Tujuannya menirukan cara
navigasi & shortcut Inkscape supaya pelanggan yang komplain "beda dengan
Inkscape" tidak kembali lagi.

---

## A. Navigasi (roda & pan)

| Aksi | Sekarang | Menjadi |
| --- | --- | --- |
| Zoom | roda polos | **Ctrl+roda** |
| Geser vertikal | — (roda = zoom) | **roda polos** |
| Geser horizontal | — | **Shift+roda** |
| Pan | drag kanan | **drag tengah** + drag kanan (tetap sebagai alias) |
| Space-pan | — | tidak dibuat (owner tidak pakai) |

Catatan implementasi: handler `onWheel` (app.js) sekarang selalu zoom; harus
dipecah berdasarkan modifier. `onPointerDown` case `ev.button === 1` sekarang
"pilih loop bawah" — diganti jadi pan (pilih loop bawah tetap via Alt+klik,
yang sudah ada).

## B. Tombol tool

| Tombol | Sekarang | Menjadi | Konflik yang dibereskan |
| --- | --- | --- | --- |
| `R` | transform | **kotak (box)** | transform pindah ke Ctrl+M |
| `E` | separate | **lingkaran (circle)** | — |
| `B` | box | **kurva/pen** (dulu K) | — |
| `Shift+B` | — | **garis** (dulu L) | — |
| `*` | — | **poligon/star** (dulu Y) | — |
| `A` | arc | arc (tetap) | — |
| `T` | tangent | **teks** (dulu W) | tangent pindah ke G |
| `Shift+E` | toggle dimensi | **separate** | toggle dimensi → Shift+D (kontekstual) |
| `I` | trim | trim (tetap) | — |
| `W` | text | kosong (dilepas) | — |

## C. Mode (F1/F2/F3)

| Tombol | Fungsi |
| --- | --- |
| `F1` | mode pilih/geser: titik & garis **tidak** bisa diedit; hanya objek/loop yang bisa dipilih & digeser |
| `F2` | mode edit node: objek/loop terpilih **menampilkan titik-titiknya** dan bisa diedit |
| `F3` | pilih **titik junction** (titik yang dilalui >3 garis) — untuk membersihkan garis dobel. Sudah ada sebagai `cmdSelectJunctionPoints` (sekarang `Alt+3`), tinggal pindah binding-nya ke F3 |

Konsep F1/F2 **menggabungkan** opsi tampil titik + mode edit yang sekarang
terpisah (toggle "Points" + pick filter). Perlu diganti perilaku toggle Points.

## D. Toggle & constraint

| Tombol | Sekarang | Menjadi |
| --- | --- | --- |
| `#` | — | **grid** (dulu G) |
| `Shift+5` (`%`) | — | **snap** (dulu S) |
| `G` | grid | **tangent** (dulu T) |
| `M` | midpoint | midpoint (tetap) |
| `Alt+M` | (usulan lama) | — (batal; midpoint tetap M) |
| `Ctrl+M` | move | **transform** |
| `Ctrl+Shift+M` | — | **move** (swap) |
| `D` | dimensi | dimensi (tetap) |
| `Shift+D` | kontekstual: seleksi **2 titik** atau **titik ke garis** → buat Measure; seleksi **badge dimensi** → toggle driving ↔ referensi |
| `Alt+E` | — | (cadangan; tidak dipakai) |
| `O/H/V/P/[`/`Q`/`.`/`F`/`J` | — | tetap |

## E. Seleksi

| Aksi | Menjadi |
| --- | --- |
| `Ctrl+klik` pada loop | selalu **clear** seleksi sebelumnya, lalu pilih |
| `Shift+klik` pada loop | toggle (tambah/kurang) |

## F. Pick filter & fit

| Tombol | Menjadi |
| --- | --- |
| `Alt+1 / Alt+2 / Alt+3` | pick filter titik / garis / loop (pindah dari 1/2/3; Alt+3 kosong setelah junction pindah ke F3) |
| `3` | **fit objek terpilih** (untuk screenshot ke customer) |
| `F3` | pilih titik junction (memindahkan `Alt+3` yang ada) |
| `S`, `N`, `Z` | biarkan seperti sekarang (snap, select connected, clean) |

Catatan: angka `1/2/3` sekarang pick filter (Plasticity-style). Dipindah ke
Alt+kombinasi supaya `3` bisa dipakai fit-selection. Bila `3` fit disetujui,
pick filter digit polos dihapus dari keyboard (tetap ada di panel Layers).

## G. Sudah cocok (tidak diubah)

`Ctrl+Z`/`Ctrl+Shift+Z` undo/redo, `Ctrl+C/V/X`, `Ctrl+A`, `Ctrl+D`,
`Ctrl+G`, `Del`, `Esc`. Tambah alias **`Ctrl+Shift+G`** = ungroup (Inkscape),
di samping `Ctrl+U`.

---

## Urutan eksekusi

1. **Navigasi** (roda, Ctrl+roda, Shift+roda, pan tengah/kanan) — paling terasa.
2. **Tabel KEYMAP** diubah (tool + toggle + constraint + mode F1/F2).
3. Konflik dibereskan: `Shift+E` toggle dimensi → `Shift+D`; `Ctrl+M` move →
   `Ctrl+Shift+M`; `3` pick filter → `Alt+1/2/3`.
4. **Seleksi** Ctrl/Shift+klik loop.
5. `help.js` + panduan + chip ribbon (otomatis dari KEYMAP).
6. Verifikasi: `node --check` + probe, lalu checklist browser untuk owner.

## Item terbuka (perlu konfirmasi sebelum eksekusi)

- `F3` = select connected? (N sekarang; F1/F2 sudah mengambil mode)
- `3` = fit-selection? (kalau ya, pick filter polos dilepas)
- `S` tetap snap, atau jadi alias select? (owner: biarkan sekarang)
