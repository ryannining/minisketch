/* =====================================================================
   MiniSketch Help — search index
   Daftar semua topik bantuan dengan kata kunci, judul, deskripsi dan URL.
   Digunakan oleh help.js untuk kotak pencarian di setiap halaman.
   ===================================================================== */
window.HELP_SEARCH_INDEX = [
  // ---------------------------------------------------------------- Beranda
  {
    id: "home",
    title: "Beranda &amp; Quick Start",
    desc: "Panduan awal, tampilan aplikasi, dan cara mulai menggambar pertama kali.",
    url: "index.html",
    tags: ["beranda", "awal", "quick start", "tampilan", "mulai", "draw", "gambar"],
  },
  // ---------------------------------------------------------------- Draw
  {
    id: "draw",
    title: "Draw — Menggambar",
    desc: "Semua alat gambar: garis, kurva Bézier, busur, lingkaran, kotak, poligon/bintang, teks, potong dan pisah.",
    url: "draw.html",
    tags: ["draw", "gambar", "garis", "line", "kurva", "curve", "busur", "arc", "lingkaran", "circle", "kotak", "box", "poligon", "poly", "bintang", "teks", "text", "potong", "trim", "pisah", "separate", "pintasan"],
  },
  {
    id: "draw-shortcuts",
    title: "Pintasan alat gambar",
    desc: "Tombol huruf untuk setiap alat di tab Draw dan cara menahan Shift/Alt saat menggambar.",
    url: "draw.html#shortcuts",
    tags: ["L", "B", "Y", "A", "C", "R", "W", "I", "E", "Shift", "Alt", "Enter", "Esc", "tombol pintas"],
  },
  // ---------------------------------------------------------------- Edit
  {
    id: "edit",
    title: "Edit — Mengubah Objek",
    desc: "Transformasi, offset, geser, array, gabung/bongkar grup, boolean (union/cut/intersect), join, fillet, dan bersihkan loop.",
    url: "edit.html",
    tags: ["edit", "transform", "offset", "geser", "move", "array", "grup", "group", "ungroup", "boolean", "union", "cut", "intersect", "join", "fillet", "clean", "Ctrl+Z", "Ctrl+G", "Ctrl+U", "Ctrl+J", "Ctrl+M", "Ctrl++", "Ctrl+-", "Ctrl+0", "J", "F", "Z"],
  },
  // ---------------------------------------------------------------- Arrange
  {
    id: "arrange",
    title: "Arrange — Susun Objek",
    desc: "Rata kiri/kanan/atas/bawah, tengah horizontal/vertikal, distribusi, dan drag wall untuk nesting manual.",
    url: "arrange.html",
    tags: ["arrange", "susun", "rata", "align", "distribute", "drag wall", "wall", "dinding", "nesting manual"],
  },
  // ---------------------------------------------------------------- Constrain
  {
    id: "constrain",
    title: "Constrain — Batasan &amp; Dimensi",
    desc: "Constraint coincident, horizontal, vertikal, sejajar, tegak lurus, sama panjang, jangkar, titik tengah, menyentuh, serta dimensi penggerak dan referensi.",
    url: "constrain.html",
    tags: ["constrain", "constraint", "batasan", "dimensi", "coincident", "berimpit", "horizontal", "vertikal", "parallel", "sejajar", "perpendicular", "tegak lurus", "equal", "sama panjang", "anchor", "jangkar", "midpoint", "titik tengah", "tangent", "menyinggung", "D", "Shift+D", "F9", "solver", "solve", "amber"],
  },
  // ---------------------------------------------------------------- Parts
  {
    id: "parts",
    title: "Parts — Part &amp; Assembly",
    desc: "Buat part kaku dari pilihan, dan gabungkan part dengan mate (pin, slider, string, arc) serta ground.",
    url: "parts.html",
    tags: ["parts", "part", "assembly", "make part", "mate", "pin", "slider", "string", "arc", "ground", "Alt+T", "perakitan"],
  },
  // ---------------------------------------------------------------- KaryaCNC
  {
    id: "karyacnc",
    title: "KaryaCNC — Kirim ke Mesin",
    desc: "Dialog kirim ke KaryaCNC: host, port, cakupan objek, toleransi flatten, rute Classic/JSON, dan warna operasi (hitam potong, merah gores, dll).",
    url: "karyacnc.html",
    tags: ["karyacnc", "kirim", "mesin", "CNC", "send", "host", "port", "flatten", "chaining", "route", "warna", "operasi", "Alt+Q", "cut", "mark", "engrave", "pocket", "v-carve"],
  },
  {
    id: "cost",
    title: "Estimasi Biaya Cutting",
    desc: "Dialog biaya: preset bahan, harga per cm², jasa cutting per menit, kecepatan, pengulangan, dan DPI engrave.",
    url: "karyacnc.html#cost",
    tags: ["biaya", "cost", "estimasi", "cutting", "preset", "harga", "cm²", "DPI", "engrave"],
  },
  // ---------------------------------------------------------------- Files
  {
    id: "files",
    title: "Berkas — Open, Import, Save, Export",
    desc: "Membuka file .sketch/.json, menggabungkan impor, menyimpan, dan mengekspor SVG dengan opsi layer.",
    url: "files.html",
    tags: ["berkas", "file", "open", "buka", "import", "impor", "save", "simpan", "export", "ekspor", "SVG", ".sketch", ".json", "Ctrl+O", "Ctrl+I", "Ctrl+S", "Ctrl+Shift+S", "Ctrl+E"],
  },
  // ---------------------------------------------------------------- Import
  {
    id: "import",
    title: "Import — SVG, PDF, CDR, DXF",
    desc: "Detail impor file vektor: SVG, PDF, CorelDRAW (CDR), dan DXF ASCII, pengaturan grup, warna, teks, dan clipping path.",
    url: "import.html",
    tags: ["import", "impor", "SVG", "PDF", "CDR", "CorelDRAW", "DXF", "ASCII", "clipping path", "grup", "warna", "teks", "loop", "weld"],
  },
  // ---------------------------------------------------------------- Text
  {
    id: "text",
    title: "Teks &amp; Font",
    desc: "Objek teks, pilihan font (single-line, sans, serif, display, imported, system), ukuran, jarak hurus, rata, detail outline, dan fit ke kurva.",
    url: "text.html",
    tags: ["teks", "text", "font", "single-line", "sans", "serif", "display", "imported", "system", "ukuran", "leading", "tracking", "detail", "fit curve", "kurva", "W"],
  },
  // ---------------------------------------------------------------- Trace
  {
    id: "trace",
    title: "Image Trace — Jejak Gambar",
    desc: "Menempelkan/menyeret gambar dan menjejaknya menjadi kurva: detail line/curve, speckle, threshold, blur, simplify, dan simpan tik sudut.",
    url: "trace.html",
    tags: ["trace", "jejak", "gambar", "gambar", "image", "paste", "drop", "detail line", "detail curve", "speckle", "threshold", "blur", "simplify", "sudut", "dpi", "Ctrl+V", "Ctrl+C"],
  },
  // ---------------------------------------------------------------- Nesting
  {
    id: "nesting",
    title: "Nesting — Tata Letak Potongan",
    desc: "Susun loop tertutup di atas lembar dengan algoritma genetika + NFP: spasi, grid, rotasi, flip, populasi, generasi, mutasi, dan pencarian lokal.",
    url: "nesting.html",
    tags: ["nesting", "tata letak", "lembar", "genetika", "NFP", "spasi", "grid", "rotasi", "flip", "populasi", "generasi", "mutasi", "Start", "Re-nest", "Stop"],
  },
  // ---------------------------------------------------------------- Settings
  {
    id: "settings",
    title: "Settings — Pengaturan",
    desc: "Semua pengaturan: Renderer, Geometry, Comments, Curves, Text, Paste, CNC, dan AI chat, dengan default dan keterangan masing-masing.",
    url: "settings.html",
    tags: ["settings", "pengaturan", "renderer", "geometry", "comments", "curves", "text", "paste", "CNC", "AI chat", "toleransi", "nudge", "chain tolerance", "join tolerance", "loop closure", "flatten", "undo", "anti-aliasing"],
  },
  // ---------------------------------------------------------------- Layers
  {
    id: "layers",
    title: "Layers &amp; Pick Filter",
    desc: "Layer, pindah objek antar layer, pick filter Plastycity-style (titik/garis/loop), dan memedarkan layer lain.",
    url: "layers.html",
    tags: ["layer", "layers", "pick filter", "titik", "garis", "loop", "plastycity", "medarkan", "aktif", "tambah layer"],
  },
  // ---------------------------------------------------------------- Solver
  {
    id: "solver",
    title: "Solver — Mode Penyelesaian",
    desc: "Mode solver: on release (saat dilepas), manual (F9), dan live (setiap gerakan), serta dimensi yang belum terpenuhi (amber).",
    url: "solver.html",
    tags: ["solver", "solve", "mode", "release", "manual", "live", "F9", "on release", "dimensi", "amber", "tidak terpenuhi"],
  },
  // ---------------------------------------------------------------- Shortcuts
  {
    id: "shortcuts",
    title: "Pintasan Keyboard Lengkap",
    desc: "Semua tombol pintas: berkas, alat, edit, constraint, tampilan, dan mesin, dalam satu tabel referensi.",
    url: "shortcuts.html",
    tags: ["pintasan", "keyboard", "shortcut", "tombol", "referensi", "Ctrl", "Shift", "Alt", "F1", "F2", "F3", "F9", "?", "Alt+Q"],
  },
  // ---------------------------------------------------------------- AI
  {
    id: "ai",
    title: "AI Chat (Bawa Kunci Sendiri)",
    desc: "Panel chat AI: bridge URL, API base URL, kunci API, model, dan jumlah putaran agen. Tidak ada kunci yang tersimpan di repositori.",
    url: "ai.html",
    tags: ["AI", "chat", "api", "kunci", "key", "bridge", "model", "BYOK", "offline", "perintah"],
  },
];
