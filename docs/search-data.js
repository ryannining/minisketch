/* =====================================================================
   MiniSketch Help — bilingual search index (EN / ID)
   All help topics with English and Indonesian titles, descriptions, tags, URLs.
   Used by help.js for the search box on every help page.
   ===================================================================== */
window.HELP_SEARCH_INDEX = [
  // ---------------------------------------------------------------- Home
  {
    id: "home",
    title: "Beranda & Quick Start",
    titleEn: "Home & Quick Start",
    desc: "Panduan awal, konsep dasar CNC (loop, warna operasi, bersihkan garis), dan cara mulai menggambar pertama kali.",
    descEn: "Getting started, core CNC concepts (closed loops, operation colors, cleanup), and drawing your first sketch.",
    url: "index.html",
    tags: ["beranda", "awal", "home", "quick start", "pemula", "beginner", "konsep", "concept", "loop", "tampilan", "mulai", "draw", "gambar"],
  },
  {
    id: "pemula",
    title: "Konsep Dasar Pemula (Loop, Warna, Bersihkan)",
    titleEn: "Beginner CNC Concepts (Loops, Colors, Cleanup)",
    desc: "Penjelasan loop tertutup vs garis terbuka, garis bantu hijau, Gray/Yellow fill, serta Cleanup loops dan Weld.",
    descEn: "Closed loops vs open lines, green construction guides, Gray/Yellow fills, Cleanup loops, and Weld.",
    url: "index.html#pemula",
    tags: ["pemula", "beginner", "konsep", "loop", "closed loop", "tertutup", "terbuka", "open", "fill", "gray", "yellow", "cleanup", "weld", "hijau", "green"],
  },
  // ---------------------------------------------------------------- Draw
  {
    id: "draw",
    title: "Draw — Menggambar",
    titleEn: "Draw — Sketching Tools",
    desc: "Semua alat gambar: garis, kurva Bézier, busur, lingkaran, kotak, poligon/bintang, teks, catatan, potong dan pisah.",
    descEn: "All drawing tools: line, Bézier curve, arc, circle, box, polygon/star, text, note, trim, and separate.",
    url: "draw.html",
    tags: ["draw", "sketch", "gambar", "garis", "line", "kurva", "curve", "bezier", "busur", "arc", "lingkaran", "circle", "kotak", "box", "poligon", "poly", "bintang", "star", "teks", "text", "note", "catatan", "potong", "trim", "pisah", "separate", "pintasan", "shortcuts"],
  },
  {
    id: "draw-shortcuts",
    title: "Pintasan alat gambar",
    titleEn: "Drawing Tool Shortcuts & Snap",
    desc: "Tombol untuk setiap alat di tab Draw, urutan prioritas snap, dan cara menahan Shift/Alt saat menggambar.",
    descEn: "Shortcuts for every tool in the Draw tab, snap priority order, and holding Shift/Alt while drawing.",
    url: "draw.html#shortcuts",
    tags: ["Shift+B", "B", "*", "A", "E", "R", "T", "I", "Shift+E", ";", "Shift", "Alt", "Enter", "Esc", "tombol pintas", "snap", "shortcuts"],
  },
  // ---------------------------------------------------------------- Edit
  {
    id: "edit",
    title: "Edit — Mengubah Objek",
    titleEn: "Edit — Modify & Boolean",
    desc: "Transformasi, offset, geser, clone, grup/bongkar grup, boolean (union/cut/intersect), join, weld, fillet, dan bersihkan loop.",
    descEn: "Transform, offset, move, clone, group/ungroup, exact boolean (union/cut/intersect), join, weld, fillet, and cleanup.",
    url: "edit.html",
    tags: ["edit", "modify", "transform", "offset", "geser", "move", "clone", "grup", "group", "ungroup", "boolean", "union", "cut", "intersect", "join", "weld", "Alt+W", "fillet", "clean", "Ctrl+Z", "Ctrl+G", "Ctrl+U", "Ctrl+J", "Ctrl+L", "Ctrl+Shift+L", "Ctrl+M", "Ctrl+Shift+M", "Ctrl++", "Ctrl+-", "Ctrl+0", "J", "F", "Z", "Shift+L"],
  },
  // ---------------------------------------------------------------- Arrange
  {
    id: "arrange",
    title: "Arrange — Susun Objek",
    titleEn: "Arrange — Align, Distribute, Insert & Drag Wall",
    desc: "Rata kiri/kanan/atas/bawah, tengah horizontal/vertikal, distribusi, Insert ke kotak hijau, Array clone, dan drag wall untuk nesting manual.",
    descEn: "Align left/right/top/bottom, center horizontally/vertically, distribute spacing, Insert into green sheet, Array clone, and Drag wall for manual nesting.",
    url: "arrange.html",
    tags: ["arrange", "susun", "rata", "align", "distribute", "insert", "array", "kotak hijau", "green box", "drag wall", "wall", "dinding", "nesting manual", "manual nesting", "W"],
  },
  // ---------------------------------------------------------------- Constrain
  {
    id: "constrain",
    title: "Constrain — Batasan & Dimensi",
    titleEn: "Constrain — Geometric Constraints & Dimensions",
    desc: "Constraint coincident, horizontal, vertikal, sejajar, tegak lurus, sama panjang, jangkar, titik tengah, menyentuh, strip Wt/Z, serta dimensi penggerak dan referensi.",
    descEn: "Coincident, horizontal, vertical, parallel, perpendicular, equal, anchor, midpoint, tangent constraints, L/T/W/H/Wt/Z strip, driving & reference dimensions.",
    url: "constrain.html",
    tags: ["constrain", "constraint", "batasan", "dimensi", "dimension", "coincident", "berimpit", "horizontal", "vertikal", "vertical", "parallel", "sejajar", "perpendicular", "tegak lurus", "equal", "sama panjang", "anchor", "jangkar", "midpoint", "titik tengah", "tangent", "menyinggung", "D", "Shift+D", "G", "O", "H", "V", "P", "Q", "M", "F9", "solver", "solve", "amber", "Wt", "Z"],
  },
  // ---------------------------------------------------------------- Tools
  {
    id: "tools",
    title: "Tools — 13 Generator Parametrik & Clone",
    titleEn: "Tools — 13 Parametric Generators & Clone",
    desc: "Array (tab Edit), Box maker, Slot, Gear, Extrude wall, Hinge box, Slide top, Pull top duo, Paint rack, Panel iklan, Flex pattern, Finger joint, Spiral, dan Text weld.",
    descEn: "Array (Edit tab), Box maker, Slot, Gear, Extrude wall, Hinge box, Slide top, Pull top duo, Paint rack, Sign panel, Flex pattern, Finger joint, Spiral, and Text weld.",
    url: "tools.html",
    tags: ["tools", "generator", "parametrik", "parametric", "box maker", "gear", "slot", "extrude wall", "hinge box", "slide top", "pull top duo", "paint rack", "panel iklan", "sign panel", "flex pattern", "living hinge", "finger joint", "spiral", "text weld", "array", "clone", "Ctrl+L"],
  },
  // ---------------------------------------------------------------- Extensions
  {
    id: "extensions",
    title: "Extensions — Panel Ekstensi & Marketplace",
    titleEn: "Extensions — Extensions Panel & Marketplace",
    desc: "Panel Extensions di sidebar, tab Installed/Marketplace/Add-Import/Publish, editor kode syntax highlighting (JS/HTML/CSS), Check Updates, Test Run, dan AI Extension Builder.",
    descEn: "Sidebar Extensions panel, Installed/Marketplace/Add-Import/Publish tabs, syntax-highlighted JS/HTML/CSS code editor, Check Updates, Test Run, and AI Extension Builder.",
    url: "extensions.html",
    tags: ["extensions", "ekstensi", "panel extensions", "extensions panel", "marketplace", "installed", "add", "import", "publish", "github", "check updates", "auto-update", "syntax highlight", "test run", "fix with ai", "MiniSketchTools", "custom tool"],
  },
  // ---------------------------------------------------------------- Parts
  {
    id: "parts",
    title: "Parts — Part & Assembly",
    titleEn: "Parts — Rigid Parts & Assembly Mates",
    desc: "Buat part kaku dari pilihan, dan gabungkan part dengan mate (pin, slider, string, arc) serta ground.",
    descEn: "Freeze selections into rigid parts and connect assemblies with mates (pin, slider, string, arc) or ground them.",
    url: "parts.html",
    tags: ["parts", "part", "assembly", "make part", "mate", "pin", "slider", "string", "arc", "ground", "Alt+T", "perakitan"],
  },
  // ---------------------------------------------------------------- KaryaCNC
  {
    id: "karyacnc",
    title: "KaryaCNC — Kirim ke Mesin",
    titleEn: "KaryaCNC — Send to Machine",
    desc: "Dialog kirim ke KaryaCNC: host, port, cakupan objek, toleransi flatten, rute Classic/JSON, dan warna operasi (hitam potong, merah drill/gores, dll).",
    descEn: "Send to KaryaCNC dialog: WebSocket host/port, scope, flatten tolerance, Classic/Express JSON protocol, and 9 operation stroke colors.",
    url: "karyacnc.html",
    tags: ["karyacnc", "kirim", "mesin", "CNC", "send", "host", "port", "flatten", "chaining", "route", "warna", "color", "operasi", "operation", "Alt+Q", "Alt+C", "cut", "drill", "gores", "mark", "engrave", "pocket", "v-carve"],
  },
  {
    id: "cost",
    title: "Estimasi Biaya Cutting",
    titleEn: "Cutting Cost Estimator",
    desc: "Dialog biaya: preset bahan, harga per cm², jasa cutting per menit, kecepatan, pengulangan, dan DPI engrave.",
    descEn: "Cost dialog: material presets, price per cm², cutting rate per minute, speed, passes, and engrave DPI.",
    url: "karyacnc.html#cost",
    tags: ["biaya", "cost", "estimasi", "estimate", "cutting", "preset", "harga", "price", "cm²", "DPI", "engrave", "Alt+C"],
  },
  // ---------------------------------------------------------------- Files
  {
    id: "files",
    title: "Berkas — Open, Import, Save, Export & Cloud Sync",
    titleEn: "Files — Open, Import, Save, Export & Cloud Sync",
    desc: "Membuka file .sketch/.json, menggabungkan impor, menyimpan ke disk atau browser, ekspor SVG, dan sinkronisasi opsional akun Google.",
    descEn: "Open .sketch/.json files, merge imports, save locally or to disk, export SVG with layer options, and optional Google Cloud Sync.",
    url: "files.html",
    tags: ["berkas", "file", "files", "open", "buka", "import", "impor", "save", "simpan", "export", "ekspor", "SVG", ".sketch", ".json", "cloud", "sync", "google", "login", "offline", "Ctrl+O", "Ctrl+I", "Ctrl+S", "Ctrl+Shift+S", "Ctrl+E"],
  },
  // ---------------------------------------------------------------- Import
  {
    id: "import",
    title: "Import — SVG, PDF, CDR, DXF",
    titleEn: "Import — SVG, PDF, CDR, DXF",
    desc: "Detail impor file vektor: SVG, PDF, CorelDRAW (CDR), dan DXF ASCII, pengaturan grup, warna, teks, dan clipping path.",
    descEn: "Vector import details for SVG, PDF, CorelDRAW (CDR), and ASCII DXF: groups, color mapping, text handling, and clipping paths.",
    url: "import.html",
    tags: ["import", "impor", "SVG", "PDF", "CDR", "CorelDRAW", "DXF", "ASCII", "clipping path", "grup", "group", "warna", "color", "teks", "text", "loop", "weld"],
  },
  // ---------------------------------------------------------------- Text
  {
    id: "text",
    title: "Teks & Font",
    titleEn: "Text & Fonts",
    desc: "Objek teks (T), pilihan font (single-line, sans, serif, display, imported, system), ukuran, jarak huruf, rata, detail outline, dan fit ke kurva.",
    descEn: "Text objects (T), font categories (single-line, sans, serif, display, imported, system), size, letter tracking, alignment, detail, and curve fitting.",
    url: "text.html",
    tags: ["teks", "text", "font", "single-line", "sans", "serif", "display", "imported", "system", "ukuran", "height", "leading", "tracking", "jarak huruf", "detail", "fit curve", "kurva", "T"],
  },
  // ---------------------------------------------------------------- Trace
  {
    id: "trace",
    title: "Image Trace — Jejak Gambar",
    titleEn: "Image Trace — Bitmap to Vector",
    desc: "Menempelkan/menyeret gambar dan menjejaknya menjadi kurva: detail line/curve, speckle, threshold, blur, simplify, dan simpan titik sudut.",
    descEn: "Paste or drop images and trace them into editable curves: line/curve detail, speckle, threshold, blur, simplify, and sharp corner preservation.",
    url: "trace.html",
    tags: ["trace", "jejak", "gambar", "image", "bitmap", "paste", "drop", "detail line", "detail curve", "speckle", "threshold", "blur", "simplify", "sudut", "corners", "dpi", "Ctrl+V", "Ctrl+C"],
  },
  // ---------------------------------------------------------------- Nesting
  {
    id: "nesting",
    title: "Nesting — Tata Letak Potongan",
    titleEn: "Nesting — Sheet Layout Optimizer",
    desc: "Susun loop tertutup di atas lembar hijau dengan algoritma genetika + NFP: preset Quality (Fast/Balanced/Max), Space, Rot, Flip, dan Advanced options (Pop, Gen, Mut, LS, Grid).",
    descEn: "Pack closed loops onto a green sheet using local GA + NFP nesting: Quality presets (Fast/Balanced/Max), Space, Rot, Flip, and Advanced options (Pop, Gen, Mut, LS, Grid).",
    url: "nesting.html",
    tags: ["nesting", "tata letak", "lembar", "lembar hijau", "sheet", "genetika", "NFP", "quality", "fast", "balanced", "max", "space", "spasi", "grid", "rotasi", "rotation", "flip", "populasi", "generasi", "mutasi", "advanced options", "Start", "Re-nest", "Stop"],
  },
  // ---------------------------------------------------------------- Settings
  {
    id: "settings",
    title: "Settings — Pengaturan",
    titleEn: "Settings — Preferences & Tolerances",
    desc: "Semua pengaturan: History, Renderer, Geometry, Comments, Curves, Text, Paste, CNC, dan AI chat (Google Gemini, bridge URL, reasoning level).",
    descEn: "All preferences: History, Renderer, Geometry tolerances, Comments, Curves, Text, Paste, CNC flatten tolerance, and AI chat (Gemini, bridge URL, reasoning).",
    url: "settings.html",
    tags: ["settings", "pengaturan", "preferences", "history", "renderer", "geometry", "comments", "curves", "text", "paste", "CNC", "AI chat", "gemini", "reasoning", "toleransi", "tolerance", "nudge", "chain tolerance", "join tolerance", "loop closure", "flatten", "undo", "anti-aliasing"],
  },
  // ---------------------------------------------------------------- Layers
  {
    id: "layers",
    title: "Layers & Pick Filter",
    titleEn: "Layers & Pick Filter",
    desc: "Layer, pindah objek antar layer, pick filter Plasticity-style (Alt+1/2/3 untuk titik/garis/loop), dan memudarkan layer lain.",
    descEn: "Manage drawing layers, move objects between layers, toggle Plasticity-style pick filters (Alt+1/2/3 for points/lines/loops), and fade inactive layers.",
    url: "layers.html",
    tags: ["layer", "layers", "pick filter", "titik", "points", "garis", "lines", "loop", "loops", "plasticity", "memudarkan", "dim", "fade", "Alt+1", "Alt+2", "Alt+3", "aktif", "tambah layer"],
  },
  // ---------------------------------------------------------------- Solver
  {
    id: "solver",
    title: "Solver — Mode Penyelesaian",
    titleEn: "Solver — Solve Modes & Unsatisfied Dimensions",
    desc: "Mode solver: on release (saat dilepas), manual (F9), dan live (setiap gerakan), serta dimensi yang belum terpenuhi (amber).",
    descEn: "Solver modes: on release, manual (F9), and live, plus unsatisfied (amber) driving dimensions.",
    url: "solver.html",
    tags: ["solver", "solve", "mode", "release", "manual", "live", "F9", "on release", "dimensi", "dimension", "amber", "tidak terpenuhi", "unsatisfied", "Shift+D"],
  },
  // ---------------------------------------------------------------- Shortcuts
  {
    id: "shortcuts",
    title: "Pintasan Keyboard Lengkap",
    titleEn: "Complete Keyboard Shortcuts",
    desc: "Semua tombol pintas: berkas, alat, edit, constraint, tampilan, dan mesin, dalam satu tabel referensi.",
    descEn: "All keyboard shortcuts for files, drawing tools, editing, constraints, viewport navigation, and machine output in one reference page.",
    url: "shortcuts.html",
    tags: ["pintasan", "keyboard", "shortcut", "shortcuts", "hotkey", "tombol", "referensi", "Ctrl", "Shift", "Alt", "F1", "F2", "F3", "F9", "?", "Alt+Q", "Alt+C", "Shift+D", "Shift+L", "Alt+W"],
  },
  // ---------------------------------------------------------------- AI
  {
    id: "ai",
    title: "AI Chat (Mode SVG & Extension Builder)",
    titleEn: "AI Chat (SVG & Extension Builder)",
    desc: "Panel chat AI: Mode SVG (desain vektor ke kanvas), Mode Extension dengan Panel Testing permanen di atas prompt, History, Fork, Vision (lampirkan gambar), dan reasoning level.",
    descEn: "AI Chat panel: Mode: SVG (vector designs to canvas), Mode: Extension with permanent Extension Testing Panel above prompt, History, Fork, Vision image input, and reasoning level.",
    url: "ai.html",
    tags: ["AI", "chat", "api", "kunci", "key", "bridge", "model", "gemini", "vision", "gambar", "image", "fork", "history", "new session", "mode svg", "mode extension", "extension builder", "panel testing", "test run", "install", "minta ai perbaiki", "fix with ai", "reasoning", "BYOK", "offline", "perintah"],
  },
];
