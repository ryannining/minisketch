// ui-i18n.js — Unified EN / ID UI localization for MiniSketch.
// Synced with the existing File -> Lang switch (localStorage key: minisketch.help.lang).
(function () {
  'use strict';

  const LANG_KEY = 'minisketch.help.lang';

  const DICT = {
    en: {
      // Top menus
      'menu.file': 'File',
      'menu.tool': 'Tool',
      'file.new': 'New',
      'file.open': 'Open…',
      'file.open.key': 'replace',
      'file.import': 'Import…',
      'file.import.key': 'merge',
      'file.save': 'Save',
      'file.saveAs': 'Save as…',
      'file.exportSvg': 'Export SVG…',
      'file.langEn': 'Lang: English',
      'file.langId': 'Lang: Indonesia',
      'file.help': 'Help',
      'file.docs': 'Full documentation…',

      'tool.grid': 'View grid',
      'tool.snap': 'Snap',
      'tool.points': 'Points',
      'tool.dims': 'Show dimension',
      'tool.autodim': 'Auto dimension',
      'tool.autosolve': 'Auto solve',
      'tool.undoview': 'Undo moves view',
      'tool.solveNow': 'Solve now',
      'tool.solverMode': 'Solver mode',
      'tool.extensions': 'Extensions & Marketplace…',
      'tool.settings': 'Settings…',
      'tool.cnc': 'Send to KaryaCNC…',

      // Ribbon tabs
      'tab.draw': 'Draw',
      'tab.edit': 'Edit',
      'tab.arrange': 'Arrange',
      'tab.parts': 'Parts',
      'tab.constrain': 'Constrain',
      'tab.machine': 'KaryaCNC',

      // Ribbon buttons
      'btn.select': 'Select',
      'btn.line': 'Line',
      'btn.curve': 'Curve',
      'btn.arc': 'Arc',
      'btn.circle': 'Circle',
      'btn.box': 'Box',
      'btn.poly': 'Poly',
      'btn.text': 'Text',
      'btn.trim': 'Trim',
      'btn.separate': 'Separate',
      'btn.note': 'Note',

      'btn.transform': 'Transform',
      'btn.offset': 'Offset',
      'btn.move': 'Move',
      'btn.flipX': 'Flip X',
      'btn.flipY': 'Flip Y',
      'btn.rotCcw': 'Rot ←',
      'btn.rotCw': 'Rot →',
      'btn.group': 'Group',
      'btn.ungroup': 'Ungroup',
      'btn.clone': 'Clone',
      'btn.connected': 'Connected',
      'btn.cleanup': 'Clean up',
      'btn.union': 'Union',
      'btn.cut': 'Cut',
      'btn.intersect': 'Intersect',
      'btn.join': 'Join',
      'btn.weld': 'Weld',
      'btn.sharp': 'Sharp',

      'btn.dragwall': 'Drag wall',
      'btn.alignL': 'Align L',
      'btn.centerH': 'Center H',
      'btn.alignR': 'Align R',
      'btn.alignT': 'Align T',
      'btn.centerV': 'Center V',
      'btn.alignB': 'Align B',
      'btn.distH': 'Distribute H',
      'btn.distV': 'Distribute V',
      'btn.insert': 'Insert',
      'btn.array': 'Array',

      'btn.makePart': 'Make part',
      'btn.mate': 'Mate',

      'btn.fillet': 'Fillet',
      'btn.dim': 'Dim',
      'btn.measure': 'Measure',
      'btn.coincident': 'Coincident',
      'btn.horizontal': 'Horizontal',
      'btn.vertical': 'Vertical',
      'btn.parallel': 'Parallel',
      'btn.perp': 'Perp',
      'btn.equal': 'Equal',
      'btn.anchor': 'Anchor',
      'btn.midpoint': 'Midpoint',
      'btn.tangent': 'Tangent',

      'btn.sendCnc': 'Send CNC',
      'btn.cost': 'Cost',

      // Left dock
      'dock.focus': 'Focus',
      'dock.all': 'All',
      'dock.copy': 'Copy',
      'dock.paste': 'Paste',
      'dock.dup': 'Dup',
      'dock.del': 'Del',
      'dock.same': 'Same',
      'dock.layers': 'Layers',
      'dock.focusOnTitle': 'Focus active — press Shift+F to show everything',
      'dock.focusOffTitle': 'Focus (Shift+F) — hide unselected geometry',
      'dock.f1Title': 'F1 · Select/Move — move whole objects (points & lines locked)',
      'dock.f2Title': 'F2 · Node edit — points & lines editable',
      'dock.f3Title': 'F3 · Select junction points (3+ segments)',

      // Property bar
      'pb.fontPlaceholder': 'Search fonts…',
      'pb.fontTitle': 'Font family (hover or use arrows to preview live on canvas)',
      'pb.weightTitle': 'Font weight',
      'pb.boldTitle': 'Bold (Ctrl+B while typing)',
      'pb.italicTitle': 'Italic (Ctrl+I while typing)',
      'pb.heightLabel': 'H',
      'pb.heightTitle': 'Text height (mm)',
      'pb.alignLTitle': 'Align left',
      'pb.alignCTitle': 'Align center',
      'pb.alignRTitle': 'Align right',
      'pb.trackingLabel': 'AV',
      'pb.trackingTitle': 'Letter spacing (% of normal; 100 = normal)',
      'pb.leadingLabel': '↕',
      'pb.leadingTitle': 'Line height (% of font size; 125 = normal)',
      'pb.toCurve': '→ Curve',
      'pb.toCurveTitle': 'Convert to editable curves / splines',
      'pb.textAdv': 'Options',
      'pb.textAdvTitle': 'Advanced text options (outline tolerance, Fit Curve, System / Import fonts)',
      'pb.textDone': 'Done',
      'pb.textDoneTitle': 'Finish editing text (Esc or Ctrl+Enter)',
      'pb.grid': 'Grid',
      'pb.snap': 'Snap',
      'pb.autoDim': 'Auto dim',
      'pb.dims': 'Dims',
      'pb.modeSelect': 'Canvas',
      'pb.modeText': 'Text',
      'pb.modeTextEditing': 'Editing text',
      'pb.modeGeom': 'Bounds',
      'pb.singleLineBadge': '1-line',
      'pb.noFontMatch': 'No font matches',
      'pb.moreFonts': 'more — keep typing',
      'pb.favGroup': 'Favorites',
      'pb.currentGroup': 'Current',

      // Sidebar
      'side.panels': 'Panels',
      'side.aiChat': 'AI Chat',
      'side.selection': 'Selection',
      'side.objectTree': 'Object Tree',
      'side.currentLayerOnly': 'Current layer only',
      'side.parts': 'Parts',
      'side.nesting': 'Nesting',
      'side.extensions': 'Extensions',
      'side.name': 'Name',
      'side.toCurve': '→ Curve',
      'side.split': '→ Split',
      'side.cleanupLoops': 'Cleanup loops',
      'side.joinPoints': 'Join points',
      'side.checkUpdates': 'Check Updates',
      'side.marketplace': 'Marketplace…',
      'side.nothingSelected': 'Nothing selected',

      // Dialogs
      'dlg.textTitle': 'Text Options',
      'dlg.textContent': 'Content',
      'dlg.textFont': 'Font',
      'dlg.textStyle': 'Style',
      'dlg.textHeight': 'Height',
      'dlg.textLine': 'Line',
      'dlg.textLetter': 'Letter',
      'dlg.textDetail': 'Detail',
      'dlg.textFitCurve': 'Fit real curves on → Curve',
      'dlg.textPreview': 'Preview',
      'dlg.textStatus': 'Tip: click canvas with Text (T) or double-click any text to type directly on canvas. Single-line fonts send open strokes for engraving.',
      'dlg.systemFonts': 'System fonts…',
      'dlg.importFont': 'Import font…',
      'dlg.apply': 'Apply',
      'dlg.cancel': 'Cancel',
      'dlg.close': 'Close',
      'dlg.export': 'Export',
      'dlg.send': 'Send',
      'dlg.costTitle': 'Cutting Cost Estimator',
      'dlg.costPreset': 'Preset',
      'dlg.costName': 'Material',
      'dlg.costMat': 'Material price',
      'dlg.costRate': 'Cutting rate',
      'dlg.costSpeed': 'Cut speed',
      'dlg.costRepeats': 'Passes',
      'dlg.costSave': 'Save to preset',
      'dlg.svgTitle': 'Export SVG',
      'dlg.svgSelected': 'Only selected objects',
      'dlg.svgVisible': 'Only visible layers',
      'dlg.svgActive': 'Only active layer',
      'dlg.cncTitle': 'Send to KaryaCNC',
      'dlg.settingsTitle': 'Settings',
      'dlg.settingsLead': 'Click a group header to expand it. Hover or focus any field for details. Tolerances are in millimetres and saved per browser.',
      'dlg.settingsSearch': 'Search settings… (e.g. offset, snap, curve, frame)',
      'dlg.settingsReset': 'Reset defaults',
      'dlg.docsTitle': 'MiniSketch Documentation',
      'dlg.docsOpenTab': 'Open in new tab',
      'dlg.helpFullDocs': 'Full guide…',
      'dlg.tfToggle': 'L/T/W/H',
      'dlg.tfClose': 'Close size bar',
      'dlg.sidebarToggle': 'Show / hide panels (AI chat, selection, parts…)',
      'dlg.fileCaptionTitle': 'Active file — click to Save (Ctrl+S)',

      // Dynamic hints
      'hint.textTool': 'Text tool: click empty space to start typing on canvas, or click existing text to edit inline. Esc returns to Select.',
      'hint.textInline': 'Typing on canvas — Enter = new line · Esc or Ctrl+Enter = finish · Use the Property Bar above for live font, size, alignment & spacing.',
      'hint.select': 'Click to select. Drag points or geometry. Double-click text to edit directly on canvas.',
      'hint.snapOff': '  ⚠ Snap is OFF — hold Alt to snap temporarily, Shift+5 to toggle.'
    },

    id: {
      // Top menus
      'menu.file': 'File',
      'menu.tool': 'Alat',
      'file.new': 'Baru',
      'file.open': 'Buka…',
      'file.open.key': 'ganti',
      'file.import': 'Impor…',
      'file.import.key': 'gabung',
      'file.save': 'Simpan',
      'file.saveAs': 'Simpan sebagai…',
      'file.exportSvg': 'Ekspor SVG…',
      'file.langEn': 'Bahasa: English',
      'file.langId': 'Bahasa: Indonesia',
      'file.help': 'Bantuan',
      'file.docs': 'Dokumentasi lengkap…',

      'tool.grid': 'Tampilkan grid',
      'tool.snap': 'Snap',
      'tool.points': 'Titik',
      'tool.dims': 'Tampilkan dimensi',
      'tool.autodim': 'Dimensi otomatis',
      'tool.autosolve': 'Solve otomatis',
      'tool.undoview': 'Undo geser kamera',
      'tool.solveNow': 'Solve sekarang',
      'tool.solverMode': 'Mode solver',
      'tool.extensions': 'Ekstensi & Marketplace…',
      'tool.settings': 'Pengaturan…',
      'tool.cnc': 'Kirim ke KaryaCNC…',

      // Ribbon tabs
      'tab.draw': 'Gambar',
      'tab.edit': 'Edit',
      'tab.arrange': 'Susun',
      'tab.parts': 'Part',
      'tab.constrain': 'Konstrain',
      'tab.machine': 'KaryaCNC',

      // Ribbon buttons
      'btn.select': 'Pilih',
      'btn.line': 'Garis',
      'btn.curve': 'Kurva',
      'btn.arc': 'Busur',
      'btn.circle': 'Lingkaran',
      'btn.box': 'Kotak',
      'btn.poly': 'Poligon',
      'btn.text': 'Teks',
      'btn.trim': 'Potong',
      'btn.separate': 'Pisah',
      'btn.note': 'Catatan',

      'btn.transform': 'Transform',
      'btn.offset': 'Offset',
      'btn.move': 'Geser',
      'btn.flipX': 'Balik X',
      'btn.flipY': 'Balik Y',
      'btn.rotCcw': 'Putar ←',
      'btn.rotCw': 'Putar →',
      'btn.group': 'Grup',
      'btn.ungroup': 'Lepas Grup',
      'btn.clone': 'Klon',
      'btn.connected': 'Tersambung',
      'btn.cleanup': 'Rapikan',
      'btn.union': 'Gabung',
      'btn.cut': 'Potong',
      'btn.intersect': 'Irisan',
      'btn.join': 'Sambung',
      'btn.weld': 'Las',
      'btn.sharp': 'Sudut',

      'btn.dragwall': 'Dinding',
      'btn.alignL': 'Rata Kiri',
      'btn.centerH': 'Tengah H',
      'btn.alignR': 'Rata Kanan',
      'btn.alignT': 'Rata Atas',
      'btn.centerV': 'Tengah V',
      'btn.alignB': 'Rata Bawah',
      'btn.distH': 'Sebar H',
      'btn.distV': 'Sebar V',
      'btn.insert': 'Masukkan',
      'btn.array': 'Array',

      'btn.makePart': 'Buat Part',
      'btn.mate': 'Hubungkan',

      'btn.fillet': 'Fillet',
      'btn.dim': 'Dimensi',
      'btn.measure': 'Ukur',
      'btn.coincident': 'Berimpit',
      'btn.horizontal': 'Datar',
      'btn.vertical': 'Tegak',
      'btn.parallel': 'Sejajar',
      'btn.perp': 'Siku',
      'btn.equal': 'Sama',
      'btn.anchor': 'Kunci',
      'btn.midpoint': 'Tengah',
      'btn.tangent': 'Singgung',

      'btn.sendCnc': 'Kirim CNC',
      'btn.cost': 'Biaya',

      // Left dock
      'dock.focus': 'Fokus',
      'dock.all': 'Semua',
      'dock.copy': 'Salin',
      'dock.paste': 'Tempel',
      'dock.dup': 'Duplikat',
      'dock.del': 'Hapus',
      'dock.same': 'Warna',
      'dock.layers': 'Layer',
      'dock.focusOnTitle': 'Fokus aktif — tekan Shift+F untuk tampilkan semua',
      'dock.focusOffTitle': 'Fokus (Shift+F) — sembunyikan yang tidak dipilih',
      'dock.f1Title': 'F1 · Pilih/Geser — geser objek utuh (titik & garis terkunci)',
      'dock.f2Title': 'F2 · Edit node — titik & garis bisa diedit',
      'dock.f3Title': 'F3 · Pilih titik pertemuan (3+ garis)',

      // Property bar
      'pb.fontPlaceholder': 'Cari font…',
      'pb.fontTitle': 'Jenis font (arahkan kursor atau panah untuk pratinjau langsung di kanvas)',
      'pb.weightTitle': 'Ketebalan font',
      'pb.boldTitle': 'Tebal (Ctrl+B saat mengetik)',
      'pb.italicTitle': 'Miring (Ctrl+I saat mengetik)',
      'pb.heightLabel': 'T',
      'pb.heightTitle': 'Tinggi teks (mm)',
      'pb.alignLTitle': 'Rata kiri',
      'pb.alignCTitle': 'Rata tengah',
      'pb.alignRTitle': 'Rata kanan',
      'pb.trackingLabel': 'AV',
      'pb.trackingTitle': 'Jarak huruf (% dari normal; 100 = normal)',
      'pb.leadingLabel': '↕',
      'pb.leadingTitle': 'Jarak baris (% dari ukuran font; 125 = normal)',
      'pb.toCurve': '→ Kurva',
      'pb.toCurveTitle': 'Konversi ke kurva / spline yang dapat diedit',
      'pb.textAdv': 'Opsi',
      'pb.textAdvTitle': 'Opsi teks lanjutan (detail outline mm, Fit Curve, Font Sistem / Impor)',
      'pb.textDone': 'Selesai',
      'pb.textDoneTitle': 'Selesai mengetik teks (Esc atau Ctrl+Enter)',
      'pb.grid': 'Grid',
      'pb.snap': 'Snap',
      'pb.autoDim': 'Auto dim',
      'pb.dims': 'Dimensi',
      'pb.modeSelect': 'Kanvas',
      'pb.modeText': 'Teks',
      'pb.modeTextEditing': 'Edit teks',
      'pb.modeGeom': 'Ukuran',
      'pb.singleLineBadge': '1-garis',
      'pb.noFontMatch': 'Font tidak ditemukan',
      'pb.moreFonts': 'lainnya — terus ketik',
      'pb.favGroup': 'Favorit',
      'pb.currentGroup': 'Saat ini',

      // Sidebar
      'side.panels': 'Panel',
      'side.aiChat': 'AI Chat',
      'side.selection': 'Seleksi',
      'side.objectTree': 'Daftar Objek',
      'side.currentLayerOnly': 'Hanya layer aktif',
      'side.parts': 'Part',
      'side.nesting': 'Nesting',
      'side.extensions': 'Ekstensi',
      'side.name': 'Nama',
      'side.toCurve': '→ Kurva',
      'side.split': '→ Pisah',
      'side.cleanupLoops': 'Rapikan loop',
      'side.joinPoints': 'Sambung titik',
      'side.checkUpdates': 'Cek Pembaruan',
      'side.marketplace': 'Marketplace…',
      'side.nothingSelected': 'Belum ada yang dipilih',

      // Dialogs
      'dlg.textTitle': 'Opsi Teks Lanjutan',
      'dlg.textContent': 'Isi Teks',
      'dlg.textFont': 'Font',
      'dlg.textStyle': 'Gaya',
      'dlg.textHeight': 'Tinggi',
      'dlg.textLine': 'Baris',
      'dlg.textLetter': 'Huruf',
      'dlg.textDetail': 'Detail',
      'dlg.textFitCurve': 'Rapikan kurva Bézier saat → Kurva',
      'dlg.textPreview': 'Pratinjau',
      'dlg.textStatus': 'Tip: klik kanvas dengan alat Teks (T) atau klik ganda teks untuk mengetik langsung di kanvas. Font 1-garis menghasilkan jalur terbuka untuk ukir.',
      'dlg.systemFonts': 'Font sistem…',
      'dlg.importFont': 'Impor font…',
      'dlg.apply': 'Terapkan',
      'dlg.cancel': 'Batal',
      'dlg.close': 'Tutup',
      'dlg.export': 'Ekspor',
      'dlg.send': 'Kirim',
      'dlg.costTitle': 'Estimasi Biaya Cutting',
      'dlg.costPreset': 'Preset',
      'dlg.costName': 'Nama bahan',
      'dlg.costMat': 'Harga bahan',
      'dlg.costRate': 'Jasa cutting',
      'dlg.costSpeed': 'Kecepatan potong',
      'dlg.costRepeats': 'Pengulangan',
      'dlg.costSave': 'Simpan ke preset',
      'dlg.svgTitle': 'Ekspor SVG',
      'dlg.svgSelected': 'Hanya objek terpilih',
      'dlg.svgVisible': 'Hanya layer terlihat',
      'dlg.svgActive': 'Hanya layer aktif',
      'dlg.cncTitle': 'Kirim ke KaryaCNC',
      'dlg.settingsTitle': 'Pengaturan',
      'dlg.settingsLead': 'Klik nama grup untuk membukanya. Arahkan kursor atau fokuskan kolom untuk keterangan. Toleransi dalam milimeter dan tersimpan per browser.',
      'dlg.settingsSearch': 'Cari pengaturan… (mis. offset, snap, curve, frame)',
      'dlg.settingsReset': 'Reset standar',
      'dlg.docsTitle': 'Dokumentasi MiniSketch',
      'dlg.docsOpenTab': 'Buka di tab baru',
      'dlg.helpFullDocs': 'Panduan lengkap…',
      'dlg.tfToggle': 'L/T/W/H',
      'dlg.tfClose': 'Tutup bar ukuran',
      'dlg.sidebarToggle': 'Tampilkan / sembunyikan panel (AI chat, seleksi, part…)',
      'dlg.fileCaptionTitle': 'File aktif — klik untuk Simpan (Ctrl+S)',

      // Dynamic hints
      'hint.textTool': 'Alat Teks: klik ruang kosong untuk mengetik langsung di kanvas, atau klik teks yang ada untuk mengedit. Esc kembali ke Pilih.',
      'hint.textInline': 'Mengetik di kanvas — Enter = baris baru · Esc / Ctrl+Enter = selesai · Gunakan Property Bar di atas untuk ubah font, ukuran, rata & spasi langsung.',
      'hint.select': 'Klik untuk memilih. Tarik titik atau objek. Klik ganda teks untuk mengedit langsung di kanvas.',
      'hint.snapOff': '  ⚠ Snap MATI — tahan Alt untuk snap sementara, Shift+5 untuk aktifkan.'
    }
  };

  let currentLang = 'en';
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'id' || saved === 'en') currentLang = saved;
  } catch (err) { /* private mode */ }

  function getLang() {
    return currentLang;
  }

  function t(key, fallback) {
    const table = DICT[currentLang] || DICT.en;
    if (table && Object.prototype.hasOwnProperty.call(table, key)) return table[key];
    if (DICT.en && Object.prototype.hasOwnProperty.call(DICT.en, key)) return DICT.en[key];
    return fallback != null ? fallback : key;
  }

  function applyDom(root) {
    const scope = root || document;
    if (!scope || !scope.querySelectorAll) return;
    document.documentElement.lang = currentLang;

    const textNodes = scope.querySelectorAll('[data-i18n]');
    for (const el of textNodes) {
      const key = el.getAttribute('data-i18n');
      if (!key) continue;
      const val = t(key, null);
      if (val != null) el.textContent = val;
    }

    const titleNodes = scope.querySelectorAll('[data-i18n-title]');
    for (const el of titleNodes) {
      const key = el.getAttribute('data-i18n-title');
      if (!key) continue;
      const val = t(key, null);
      if (val != null) el.title = val;
    }

    const phNodes = scope.querySelectorAll('[data-i18n-placeholder]');
    for (const el of phNodes) {
      const key = el.getAttribute('data-i18n-placeholder');
      if (!key) continue;
      const val = t(key, null);
      if (val != null) el.placeholder = val;
    }

    const ariaNodes = scope.querySelectorAll('[data-i18n-aria]');
    for (const el of ariaNodes) {
      const key = el.getAttribute('data-i18n-aria');
      if (!key) continue;
      const val = t(key, null);
      if (val != null) el.setAttribute('aria-label', val);
    }
  }

  function setLang(lang) {
    currentLang = lang === 'id' ? 'id' : 'en';
    try { localStorage.setItem(LANG_KEY, currentLang); } catch (err) { /* ignore */ }
    applyDom(document);
    return currentLang;
  }

  window.MiniSketchI18n = {
    getLang,
    setLang,
    t,
    applyDom,
    DICT
  };
})();
