/* =====================================================================
   MiniSketch Help — search index
   Daftar semua topik bantuan dengan kata kunci, judul, deskripsi dan URL.
   Digunakan oleh help.js untuk kotak pencarian di setiap halaman.
   ===================================================================== */
window.HELP_SEARCH_INDEX = [
  // ---------------------------------------------------------------- Beranda
  {
    id: "home",
    title: "Beranda & Quick Start",
    desc: "Panduan awal, konsep dasar CNC (loop, warna operasi, bersihkan garis), dan cara mulai menggambar pertama kali.",
    url: "index.html",
    tags: ["beranda", "awal", "quick start", "pemula", "konsep", "loop", "tampilan", "mulai", "draw", "gambar"],
  },
  {
    id: "pemula",
    title: "Konsep Dasar Pemula (Loop, Warna, Bersihkan)",
    desc: "Penjelasan loop tertutup vs garis terbuka, garis bantu hijau, Gray/Yellow fill, serta Cleanup loops dan Weld.",
    url: "index.html#pemula",
    tags: ["pemula", "konsep", "loop", "tertutup", "terbuka", "fill", "gray", "yellow", "cleanup", "weld", "hijau"],
  },
  // ---------------------------------------------------------------- Draw
  {
    id: "draw",
    title: "Draw — Menggambar",
    desc: "Semua alat gambar: garis, kurva Bézier, busur, lingkaran, kotak, poligon/bintang, teks, catatan, potong dan pisah.",
    url: "draw.html",
    tags: ["draw", "gambar", "garis", "line", "kurva", "curve", "busur", "arc", "lingkaran", "circle", "kotak", "box", "poligon", "poly", "bintang", "teks", "text", "note", "catatan", "potong", "trim", "pisah", "separate", "pintasan"],
  },
  {
    id: "draw-shortcuts",
    title: "Pintasan alat gambar",
    desc: "Tombol untuk setiap alat di tab Draw dan cara menahan Shift/Alt saat menggambar.",
    url: "draw.html#shortcuts",
    tags: ["Shift+B", "B", "*", "A", "E", "R", "T", "I", "Shift+E", ";", "Shift", "Alt", "Enter", "Esc", "tombol pintas"],
  },
  // ---------------------------------------------------------------- Edit
  {
    id: "edit",
    title: "Edit — Mengubah Objek",
    desc: "Transformasi, offset, geser, array, clone, grup/bongkar grup, boolean (union/cut/intersect), join, weld, fillet, dan bersihkan loop.",
    url: "edit.html",
    tags: ["edit", "transform", "offset", "geser", "move", "array", "clone", "grup", "group", "ungroup", "boolean", "union", "cut", "intersect", "join", "weld", "Alt+W", "fillet", "clean", "Ctrl+Z", "Ctrl+G", "Ctrl+U", "Ctrl+J", "Ctrl+L", "Ctrl+Shift+L", "Ctrl+M", "Ctrl+Shift+M", "Ctrl++", "Ctrl+-", "Ctrl+0", "J", "F", "Z", "Shift+L"],
  },
  // ---------------------------------------------------------------- Arrange
  {
    id: "arrange",
    title: "Arrange — Susun Objek",
    desc: "Rata kiri/kanan/atas/bawah, tengah horizontal/vertikal, distribusi, Insert ke kotak hijau, dan drag wall untuk nesting manual.",
    url: "arrange.html",
    tags: ["arrange", "susun", "rata", "align", "distribute", "insert", "kotak hijau", "drag wall", "wall", "dinding", "nesting manual", "W"],
  },
  // ---------------------------------------------------------------- Constrain
  {
    id: "constrain",
    title: "Constrain — Batasan & Dimensi",
    desc: "Constraint coincident, horizontal, vertikal, sejajar, tegak lurus, sama panjang, jangkar, titik tengah, menyentuh, strip Wt/Z, serta dimensi penggerak dan referensi.",
    url: "constrain.html",
    tags: ["constrain", "constraint", "batasan", "dimensi", "coincident", "berimpit", "horizontal", "vertikal", "parallel", "sejajar", "perpendicular", "tegak lurus", "equal", "sama panjang", "anchor", "jangkar", "midpoint", "titik tengah", "tangent", "menyinggung", "D", "Shift+D", "G", "O", "H", "V", "P", "Q", "M", "F9", "solver", "solve", "amber", "Wt", "Z"],
  },
  // ---------------------------------------------------------------- Tools
  {
    id: "tools",
    title: "Tools — 13 Generator Parametrik & Clone",
    desc: "Array (tab Edit), Box maker, Slot, Gear, Extrude wall, Hinge box, Slide top, Pull top duo, Paint rack, Panel iklan, Flex pattern, Finger joint, Spiral, dan Text weld.",
    url: "tools.html",
    tags: ["tools", "generator", "parametrik", "box maker", "gear", "slot", "extrude wall", "hinge box", "slide top", "pull top duo", "paint rack", "panel iklan", "flex pattern", "living hinge", "finger joint", "spiral", "text weld", "array", "clone", "Ctrl+L"],
  },
  // ---------------------------------------------------------------- Extensions
  {
    id: "extensions",
    title: "Extensions — Panel Ekstensi & Marketplace",
    desc: "Panel Extensions di sidebar, tab Installed/Marketplace/Add-Import/Publish, editor kode syntax highlighting (JS/HTML/CSS), Check Updates, Test Run, dan AI Extension Builder.",
    url: "extensions.html",
    tags: ["extensions", "ekstensi", "panel extensions", "marketplace", "installed", "add", "import", "publish", "github", "check updates", "auto-update", "syntax highlight", "test run", "fix with ai", "MiniSketchTools", "custom tool"],
  },
  // ---------------------------------------------------------------- Parts
  {
    id: "parts",
    title: "Parts — Part & Assembly",
    desc: "Buat part kaku dari pilihan, dan gabungkan part dengan mate (pin, slider, string, arc) serta ground.",
    url: "parts.html",
    tags: ["parts", "part", "assembly", "make part", "mate", "pin", "slider", "string", "arc", "ground", "Alt+T", "perakitan"],
  },
  // ---------------------------------------------------------------- KaryaCNC
  {
    id: "karyacnc",
    title: "KaryaCNC — Kirim ke Mesin",
    desc: "Dialog kirim ke KaryaCNC: host, port, cakupan objek, toleransi flatten, rute Classic/JSON, dan warna operasi (hitam potong, merah drill/gores, dll).",
    url: "karyacnc.html",
    tags: ["karyacnc", "kirim", "mesin", "CNC", "send", "host", "port", "flatten", "chaining", "route", "warna", "operasi", "Alt+Q", "Alt+C", "cut", "drill", "gores", "mark", "engrave", "pocket", "v-carve"],
  },
  {
    id: "cost",
    title: "Estimasi Biaya Cutting",
    desc: "Dialog biaya: preset bahan, harga per cm², jasa cutting per menit, kecepatan, pengulangan, dan DPI engrave.",
    url: "karyacnc.html#cost",
    tags: ["biaya", "cost", "estimasi", "cutting", "preset", "harga", "cm²", "DPI", "engrave", "Alt+C"],
  },
  // ---------------------------------------------------------------- Files
  {
    id: "files",
    title: "Berkas — Open, Import, Save, Export",
    desc: "Membuka file .sketch/.json, menggabungkan impor, menyimpan ke disk atau browser, dan mengekspor SVG dengan opsi layer.",
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
    title: "Teks & Font",
    desc: "Objek teks (T), pilihan font (single-line, sans, serif, display, imported, system), ukuran, jarak huruf, rata, detail outline, dan fit ke kurva.",
    url: "text.html",
    tags: ["teks", "text", "font", "single-line", "sans", "serif", "display", "imported", "system", "ukuran", "leading", "tracking", "jarak huruf", "detail", "fit curve", "kurva", "T"],
  },
  // ---------------------------------------------------------------- Trace
  {
    id: "trace",
    title: "Image Trace — Jejak Gambar",
    desc: "Menempelkan/menyeret gambar dan menjejaknya menjadi kurva: detail line/curve, speckle, threshold, blur, simplify, dan simpan titik sudut.",
    url: "trace.html",
    tags: ["trace", "jejak", "gambar", "image", "paste", "drop", "detail line", "detail curve", "speckle", "threshold", "blur", "simplify", "sudut", "dpi", "Ctrl+V", "Ctrl+C"],
  },
  // ---------------------------------------------------------------- Nesting
  {
    id: "nesting",
    title: "Nesting — Tata Letak Potongan",
    desc: "Susun loop tertutup di atas lembar hijau dengan algoritma genetika + NFP: spasi, grid, rotasi, flip, populasi, generasi, mutasi, dan pencarian lokal.",
    url: "nesting.html",
    tags: ["nesting", "tata letak", "lembar", "lembar hijau", "genetika", "NFP", "spasi", "grid", "rotasi", "flip", "populasi", "generasi", "mutasi", "Start", "Re-nest", "Stop"],
  },
  // ---------------------------------------------------------------- Settings
  {
    id: "settings",
    title: "Settings — Pengaturan",
    desc: "Semua pengaturan: History, Renderer, Geometry, Comments, Curves, Text, Paste, CNC, dan AI chat (Google Gemini, bridge URL, reasoning level).",
    url: "settings.html",
    tags: ["settings", "pengaturan", "history", "renderer", "geometry", "comments", "curves", "text", "paste", "CNC", "AI chat", "gemini", "reasoning", "toleransi", "nudge", "chain tolerance", "join tolerance", "loop closure", "flatten", "undo", "anti-aliasing"],
  },
  // ---------------------------------------------------------------- Layers
  {
    id: "layers",
    title: "Layers & Pick Filter",
    desc: "Layer, pindah objek antar layer, pick filter Plasticity-style (Alt+1/2/3 untuk titik/garis/loop), dan memudarkan layer lain.",
    url: "layers.html",
    tags: ["layer", "layers", "pick filter", "titik", "garis", "loop", "plasticity", "memudarkan", "Alt+1", "Alt+2", "Alt+3", "aktif", "tambah layer"],
  },
  // ---------------------------------------------------------------- Solver
  {
    id: "solver",
    title: "Solver — Mode Penyelesaian",
    desc: "Mode solver: on release (saat dilepas), manual (F9), dan live (setiap gerakan), serta dimensi yang belum terpenuhi (amber).",
    url: "solver.html",
    tags: ["solver", "solve", "mode", "release", "manual", "live", "F9", "on release", "dimensi", "amber", "tidak terpenuhi", "Shift+D"],
  },
  // ---------------------------------------------------------------- Shortcuts
  {
    id: "shortcuts",
    title: "Pintasan Keyboard Lengkap",
    desc: "Semua tombol pintas: berkas, alat, edit, constraint, tampilan, dan mesin, dalam satu tabel referensi.",
    url: "shortcuts.html",
    tags: ["pintasan", "keyboard", "shortcut", "tombol", "referensi", "Ctrl", "Shift", "Alt", "F1", "F2", "F3", "F9", "?", "Alt+Q", "Alt+C", "Shift+D", "Shift+L", "Alt+W"],
  },
  // ---------------------------------------------------------------- AI
  {
    id: "ai",
    title: "AI Chat (Mode SVG & Extension Builder)",
    desc: "Panel chat AI: Mode SVG (desain vektor ke kanvas), Mode Extension dengan Panel Testing permanen di atas prompt, History, Fork, Vision (lampirkan gambar), dan reasoning level.",
    url: "ai.html",
    tags: ["AI", "chat", "api", "kunci", "key", "bridge", "model", "gemini", "vision", "gambar", "fork", "history", "new session", "mode svg", "mode extension", "extension builder", "panel testing", "test run", "install", "minta ai perbaiki", "reasoning", "BYOK", "offline", "perintah"],
  },
];
