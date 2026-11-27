/* =====================================================================
   MiniSketch Help — shared dual-language (EN / ID), search & navigation
   Included on EVERY help page (after search-data.js).
   ===================================================================== */
(function () {
  "use strict";

  var LANG_KEY = "minisketch.help.lang";
  var searchInput = document.getElementById("help-search-input");
  var searchClear = document.getElementById("help-search-clear");
  var searchResults = document.getElementById("help-search-results");
  var searchEmpty = document.getElementById("help-search-empty");
  var searchBox = searchInput && searchInput.closest ? searchInput.closest(".help-search") : null;
  var navItems = document.querySelectorAll(".help-nav-item");
  var currentPage = location.pathname.split("/").pop() || "index.html";
  if (!currentPage || currentPage.indexOf(".html") === -1) currentPage = "index.html";

  var UI = {
    en: {
      searchPlaceholder: "Search help topics…",
      searchAria: "Search help topics",
      clearTitle: "Clear search",
      searchEmpty: "No matching topics.",
      navTitle: "Topics",
      langTitle: "Documentation language",
      titleSuffix: " | MiniSketch Help",
      groups: {
        "Gambar & Edit": "Draw & Edit",
        "Part & Mesin": "Parts & Machine",
        "Berkas & Data": "Files & Data",
        "Pengaturan & Lainnya": "Settings & More"
      }
    },
    id: {
      searchPlaceholder: "Cari topik bantuan…",
      searchAria: "Cari topik bantuan",
      clearTitle: "Hapus kata kunci",
      searchEmpty: "Tidak ada topik yang cocok.",
      navTitle: "Topik",
      langTitle: "Bahasa dokumentasi",
      titleSuffix: " | Bantuan MiniSketch",
      groups: {
        "Draw & Edit": "Gambar & Edit",
        "Parts & Machine": "Part & Mesin",
        "Files & Data": "Berkas & Data",
        "Settings & More": "Pengaturan & Lainnya"
      }
    }
  };

  var PAGE_META = {
    "index.html": {
      docTitle: { en: "MiniSketch Help — Complete Guide", id: "Bantuan MiniSketch — Panduan Lengkap" },
      headerTitle: { en: "MiniSketch Help", id: "Bantuan MiniSketch" },
      headerSub: { en: "Complete guide to every 2D constraint sketching & CNC feature", id: "Panduan lengkap semua fitur sketsa 2D constraint & CNC" },
      navLabel: { en: "Home & Quick Start", id: "Beranda & Quick Start" }
    },
    "draw.html": {
      headerTitle: { en: "Draw — Sketching Tools", id: "Draw — Menggambar" },
      headerSub: { en: "All drawing tools on the Draw tab and how to use them", id: "Semua alat gambar di tab Draw dan cara menggunakannya" },
      navLabel: { en: "Draw — Sketching", id: "Draw — Menggambar" }
    },
    "edit.html": {
      headerTitle: { en: "Edit — Modify Objects", id: "Edit — Mengubah Objek" },
      headerSub: { en: "Transform, offset, move, array, group, boolean, join, fillet, and cleanup", id: "Transformasi, offset, geser, array, grup, boolean, join, fillet, dan bersihkan loop" },
      navLabel: { en: "Edit — Modify Objects", id: "Edit — Mengubah Objek" }
    },
    "arrange.html": {
      headerTitle: { en: "Arrange — Position & Align", id: "Arrange — Susun Objek" },
      headerSub: { en: "Align, center, distribute, Insert into green sheet, and Drag wall manual nesting", id: "Rata, tengah, distribusi, Insert ke kotak hijau, dan drag wall untuk nesting manual" },
      navLabel: { en: "Arrange — Align & Layout", id: "Arrange — Susun Objek" }
    },
    "constrain.html": {
      headerTitle: { en: "Constrain — Constraints & Dimensions", id: "Constrain — Batasan & Dimensi" },
      headerSub: { en: "Coincident, horizontal/vertical, parallel, perpendicular, equal, driving & reference dimensions", id: "Coincident, horizontal/vertikal, sejajar, tegak lurus, sama panjang, dimensi penggerak & referensi" },
      navLabel: { en: "Constrain — Constraints & Dim.", id: "Constrain — Batasan & Dimensi" }
    },
    "tools.html": {
      headerTitle: { en: "Tools — 13 Parametric Generators & Clone", id: "Tools — Generator Parametrik & Clone" },
      headerSub: { en: "13 built-in CNC part generators + Array / Live Clone", id: "13 alat pembuat part otomatis + Array / Clone siap potong CNC" },
      navLabel: { en: "Tools — Parametric Generators", id: "Tools — Generator Parametrik" },
      navKbd: { en: "13 Tools", id: "13 Alat" }
    },
    "extensions.html": {
      headerTitle: { en: "Extensions — Panel & Marketplace", id: "Extensions — Panel Ekstensi & Marketplace" },
      headerSub: { en: "Manage built-in & custom generators, install from Marketplace, edit .js with syntax highlighting, and publish", id: "Kelola generator bawaan & custom, pasang dari Marketplace, impor kode .js bersyntax-highlight, dan terbitkan" },
      navLabel: { en: "Extensions — Panel & Marketplace", id: "Extensions — Ekstensi & Marketplace" }
    },
    "parts.html": {
      headerTitle: { en: "Parts — Rigid Parts & Assembly", id: "Parts — Part & Assembly" },
      headerSub: { en: "Create rigid parts and connect mechanisms with mates (pin, slider, string, arc)", id: "Buat part kaku dan gabungkan dengan mate (pin, slider, string, arc)" },
      navLabel: { en: "Parts — Part & Assembly", id: "Parts — Part & Assembly" }
    },
    "karyacnc.html": {
      headerTitle: { en: "KaryaCNC — Send to Machine", id: "KaryaCNC — Kirim ke Mesin" },
      headerSub: { en: "Send dialog, cutting cost estimator, and operation colors (black cut, red drill/score, etc.)", id: "Dialog kirim, estimasi biaya, dan warna operasi (hitam potong, merah gores, dll)" },
      navLabel: { en: "KaryaCNC — Send to Machine", id: "KaryaCNC — Kirim ke Mesin" }
    },
    "files.html": {
      headerTitle: { en: "Files — Open / Import / Save / Export", id: "Berkas — Open / Import / Save / Export" },
      headerSub: { en: "Open .sketch/.json, merge imports, save, export SVG, and optional Google Cloud Sync", id: "Buka .sketch/.json, impor gabung, simpan, ekspor SVG, dan sinkronisasi Cloud opsional" },
      navLabel: { en: "Files — Open / Save / Export", id: "Berkas — Open / Import / Save / Export" }
    },
    "import.html": {
      headerTitle: { en: "Import — SVG / PDF / CDR / DXF", id: "Import — SVG / PDF / CDR / DXF" },
      headerSub: { en: "Import vector files with group, color mapping, text, and clipping path options", id: "Impor file vektor dengan pengaturan grup, warna, teks, dan clipping path" },
      navLabel: { en: "Import — SVG / PDF / CDR / DXF", id: "Import — SVG / PDF / CDR / DXF" }
    },
    "text.html": {
      headerTitle: { en: "Text & Fonts", id: "Teks & Font" },
      headerSub: { en: "Text objects, font categories, sizing, letter tracking, and curve fitting", id: "Objek teks, pilihan font, ukuran, jarak huruf, dan fit ke kurva" },
      navLabel: { en: "Text & Fonts", id: "Teks & Font" }
    },
    "trace.html": {
      headerTitle: { en: "Image Trace — Bitmap to Vector", id: "Image Trace — Jejak Gambar" },
      headerSub: { en: "Trace pasted or dropped bitmap images into editable vector curves", id: "Jejakkan gambar paste atau seretan menjadi kurva yang bisa diedit" },
      navLabel: { en: "Image Trace — Trace Bitmap", id: "Image Trace — Jejak Gambar" }
    },
    "nesting.html": {
      headerTitle: { en: "Nesting — Sheet Layout Optimizer", id: "Nesting — Tata Letak Potongan" },
      headerSub: { en: "Pack closed loops onto green sheets using genetic algorithms + NFP", id: "Susun loop tertutup di atas lembar dengan algoritma genetika + NFP" },
      navLabel: { en: "Nesting — Sheet Packing", id: "Nesting — Tata Letak Potongan" }
    },
    "layers.html": {
      headerTitle: { en: "Layers & Pick Filter", id: "Layers & Pick Filter" },
      headerSub: { en: "Layers, moving objects between layers, Plasticity-style pick filters, and layer dimming", id: "Layer, pindah objek antar layer, pick filter Plasticity-style, dan memudarkan layer lain" },
      navLabel: { en: "Layers & Pick Filter", id: "Layers & Pick Filter" }
    },
    "settings.html": {
      headerTitle: { en: "Settings — Preferences", id: "Settings — Pengaturan" },
      headerSub: { en: "History, Renderer, Geometry, Comments, Curves, Text, Paste, CNC, and AI chat", id: "Renderer, Geometry, Comments, Curves, Text, Paste, CNC, dan AI chat" },
      navLabel: { en: "Settings — Preferences", id: "Settings — Pengaturan" }
    },
    "solver.html": {
      headerTitle: { en: "Solver — Solve Modes", id: "Solver — Mode Penyelesaian" },
      headerSub: { en: "On release, manual (F9), and live modes — plus unsatisfied (amber) dimensions", id: "On release, manual (F9), dan live — serta dimensi belum terpenuhi (amber)" },
      navLabel: { en: "Solver — Solve Modes", id: "Solver — Mode Penyelesaian" }
    },
    "shortcuts.html": {
      headerTitle: { en: "Complete Keyboard Shortcuts", id: "Pintasan Keyboard Lengkap" },
      headerSub: { en: "Reference for all file, drawing, edit, constraint, view, and machine shortcuts", id: "Referensi semua tombol pintas berkas, alat, edit, constraint, tampilan, dan mesin" },
      navLabel: { en: "Complete Keyboard Shortcuts", id: "Pintasan Keyboard Lengkap" }
    },
    "ai.html": {
      headerTitle: { en: "AI Chat (SVG & Extension Builder)", id: "AI Chat (Mode SVG & Extension Builder)" },
      headerSub: { en: "Automated SVG vector designs, custom CNC Extensions, live Testing Panel, Vision-to-sketch, and session history", id: "Desain vektor SVG otomatis, buat alat CNC custom (Extension), uji langsung, Vision-to-sketch, dan riwayat sesi" },
      navLabel: { en: "AI Chat (SVG & Extension)", id: "AI Chat (Mode SVG & Extension)" }
    }
  };

  function readInitialLang() {
    try {
      var params = new URLSearchParams(location.search || "");
      var qLang = params.get("lang");
      if (qLang === "en" || qLang === "id") return qLang;
    } catch (e) {}
    try {
      var saved = localStorage.getItem(LANG_KEY);
      if (saved === "en" || saved === "id") return saved;
    } catch (e) {}
    return "en";
  }

  var activeLang = readInitialLang();

  // Inject [EN | ID] language toggle into .help-header
  var langBtns = {};
  function ensureLangSwitcher() {
    var header = document.querySelector(".help-header");
    if (!header) return;
    var existing = header.querySelector(".help-lang-switch");
    if (existing) {
      langBtns.en = existing.querySelector('[data-doc-lang-btn="en"]');
      langBtns.id = existing.querySelector('[data-doc-lang-btn="id"]');
      return;
    }
    var wrap = document.createElement("div");
    wrap.className = "help-lang-switch";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Documentation language");

    ["en", "id"].forEach(function (code) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "help-lang-btn";
      btn.setAttribute("data-doc-lang-btn", code);
      btn.textContent = code.toUpperCase();
      btn.addEventListener("click", function () {
        setDocLang(code, true);
      });
      langBtns[code] = btn;
      wrap.appendChild(btn);
    });

    if (searchBox && searchBox.parentElement === header) {
      header.insertBefore(wrap, searchBox);
    } else {
      header.appendChild(wrap);
    }
  }

  function applyChromeLang(lang) {
    var u = UI[lang] || UI.en;
    var meta = PAGE_META[currentPage];
    if (meta) {
      document.title = meta.docTitle ? meta.docTitle[lang] : (meta.headerTitle[lang] + u.titleSuffix);
      var titleEl = document.querySelector(".help-title");
      var subEl = document.querySelector(".help-subtitle");
      if (titleEl) titleEl.textContent = meta.headerTitle[lang];
      if (subEl) subEl.textContent = meta.headerSub[lang];
    }

    if (searchInput) {
      searchInput.placeholder = u.searchPlaceholder;
      searchInput.setAttribute("aria-label", u.searchAria);
    }
    if (searchClear) searchClear.title = u.clearTitle;
    if (searchEmpty) searchEmpty.textContent = u.searchEmpty;

    var navTitle = document.querySelector(".help-nav-title");
    if (navTitle) navTitle.textContent = u.navTitle;

    var groupSubs = document.querySelectorAll(".help-nav-group .nav-sub");
    groupSubs.forEach(function (el) {
      var txt = (el.textContent || "").trim();
      if (u.groups[txt]) el.textContent = u.groups[txt];
    });

    navItems.forEach(function (item) {
      var href = (item.getAttribute("href") || "").split("#")[0];
      var m = PAGE_META[href];
      if (!m) return;
      var kbdEl = item.querySelector(".nav-kbd");
      var labelText = m.navLabel[lang];
      // Preserve child kbd badge cleanly without destroying it
      var firstText = null;
      for (var i = 0; i < item.childNodes.length; i++) {
        if (item.childNodes[i].nodeType === 3) { firstText = item.childNodes[i]; break; }
      }
      if (firstText) firstText.nodeValue = labelText;
      else item.insertBefore(document.createTextNode(labelText), item.firstChild);
      if (kbdEl && m.navKbd && m.navKbd[lang]) kbdEl.textContent = m.navKbd[lang];
    });

    var langWrap = document.querySelector(".help-lang-switch");
    if (langWrap) langWrap.setAttribute("aria-label", u.langTitle);
    if (langBtns.en) langBtns.en.classList.toggle("active", lang === "en");
    if (langBtns.id) langBtns.id.classList.toggle("active", lang === "id");
  }

  function scrollToHash() {
    var hash = (location.hash || "").replace(/^#/, "");
    if (!hash) return;
    var activeRoot = document.querySelector('.help-page [data-lang="' + activeLang + '"]');
    var target = null;
    if (activeRoot) {
      target = activeRoot.querySelector('[data-anchor="' + hash + '"]');
      if (!target) {
        try { target = activeRoot.querySelector("#" + hash); } catch (e) {}
      }
    }
    if (!target) target = document.getElementById(hash);
    if (target && target.scrollIntoView) {
      target.scrollIntoView({ behavior: "auto", block: "start" });
    }
  }

  function setDocLang(lang, notifyParent) {
    activeLang = lang === "id" ? "id" : "en";
    document.documentElement.dataset.docLang = activeLang;
    document.documentElement.lang = activeLang;
    try { localStorage.setItem(LANG_KEY, activeLang); } catch (e) {}
    applyChromeLang(activeLang);
    if (searchInput && searchInput.value.trim().length > 0) {
      renderSearchResults(searchInput.value);
    }
    if (notifyParent && window.parent && window.parent !== window) {
      try { window.parent.postMessage({ type: "minisketch-set-lang", lang: activeLang }, "*"); } catch (e) {}
    }
  }

  // Anchor dropdowns directly inside .help-search so they align below the input
  function setupDropdownEl(el) {
    if (!el) return;
    if (searchBox && el.parentElement !== searchBox) searchBox.appendChild(el);
    el.style.position = "absolute";
    el.style.left = "auto";
    el.style.right = "0";
    el.style.top = "calc(100% + 6px)";
    el.style.width = "min(420px, 90vw)";
    el.style.background = "var(--panel)";
    el.style.border = "1px solid var(--line-strong)";
    el.style.borderRadius = "var(--radius)";
    el.style.boxShadow = "0 12px 28px var(--shadow-modal)";
    el.style.zIndex = "60";
  }
  setupDropdownEl(searchResults);
  setupDropdownEl(searchEmpty);

  function updateClearBtn() {
    if (!searchClear || !searchInput) return;
    var hasText = searchInput.value.trim().length > 0;
    searchClear.style.display = hasText ? "inline-flex" : "none";
  }

  function hideDropdown() {
    if (searchResults) searchResults.style.display = "none";
    if (searchEmpty) {
      searchEmpty.hidden = true;
      searchEmpty.style.display = "none";
    }
  }

  // ---- Highlight active navigation item for the current page ----
  function markActiveNav() {
    var match = null;
    navItems.forEach(function (item) {
      var href = item.getAttribute("href") || "";
      var isExact = href === currentPage;
      var isHash = currentPage.indexOf("#") === -1 && href.indexOf("#") !== -1
        && href.split("#")[0] === currentPage;
      if (isExact || isHash) {
        item.classList.add("active");
        match = item;
      } else {
        item.classList.remove("active");
      }
    });
    return match;
  }

  // ---- Bilingual topic search ----
  function renderSearchResults(query) {
    if (!searchResults || !window.HELP_SEARCH_INDEX) return;

    searchResults.innerHTML = "";
    var raw = query || "";
    var q = raw.toLowerCase().trim();
    updateClearBtn();

    if (q.length === 0) {
      hideDropdown();
      return;
    }

    var results = window.HELP_SEARCH_INDEX.filter(function (topic) {
      var haystack =
        (topic.title || "") + " " +
        (topic.titleEn || "") + " " +
        (topic.desc || "") + " " +
        (topic.descEn || "") + " " +
        (topic.tags || []).join(" ");
      return haystack.toLowerCase().indexOf(q) !== -1;
    });

    if (results.length === 0) {
      searchResults.style.display = "none";
      if (searchEmpty) {
        searchEmpty.hidden = false;
        searchEmpty.style.display = "block";
      }
      return;
    }

    if (searchEmpty) {
      searchEmpty.hidden = true;
      searchEmpty.style.display = "none";
    }

    results.slice(0, 12).forEach(function (topic) {
      var a = document.createElement("a");
      a.href = topic.url;
      a.className = "search-result-item";
      a.style.display = "block";
      a.style.padding = "9px 13px";
      a.style.color = "var(--ink)";
      a.style.textDecoration = "none";
      a.style.borderBottom = "1px solid var(--line)";
      a.style.fontSize = "13px";

      var titleText = activeLang === "en" ? (topic.titleEn || topic.title) : topic.title;
      var descText = activeLang === "en" ? (topic.descEn || topic.desc) : topic.desc;

      var titleEl = document.createElement("div");
      titleEl.style.fontWeight = "700";
      titleEl.style.color = "var(--accent-ink)";
      titleEl.style.marginBottom = "2px";
      titleEl.textContent = titleText;

      var descEl = document.createElement("div");
      descEl.style.fontSize = "12px";
      descEl.style.color = "var(--muted)";
      descEl.textContent = descText;

      a.appendChild(titleEl);
      a.appendChild(descEl);

      highlightNode(titleEl, q);
      highlightNode(descEl, q);

      searchResults.appendChild(a);
    });

    searchResults.style.display = "block";
  }

  function highlightNode(node, q) {
    if (!node || node.childNodes.length === 0) return;
    var text = node.textContent;
    var lower = text.toLowerCase();
    var idx = lower.indexOf(q);
    if (idx === -1) return;
    var before = document.createTextNode(text.slice(0, idx));
    var match = document.createElement("mark");
    match.style.background = "rgba(79, 140, 255, 0.25)";
    match.style.color = "inherit";
    match.style.padding = "0 1px";
    match.style.borderRadius = "2px";
    match.textContent = text.slice(idx, idx + q.length);
    var after = document.createTextNode(text.slice(idx + q.length));
    node.textContent = "";
    node.appendChild(before);
    node.appendChild(match);
    node.appendChild(after);
  }

  if (searchInput) {
    searchInput.addEventListener("input", function (e) {
      renderSearchResults(e.target.value);
    });
    searchInput.addEventListener("focus", function () {
      if (searchInput.value.trim().length > 0) renderSearchResults(searchInput.value);
    });
    searchInput.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        hideDropdown();
        searchInput.blur();
      }
    });
    if (searchClear) {
      searchClear.addEventListener("click", function (e) {
        e.preventDefault();
        searchInput.value = "";
        hideDropdown();
        updateClearBtn();
        searchInput.focus();
      });
    }
    document.addEventListener("click", function (e) {
      if (searchBox && searchBox.contains(e.target)) return;
      hideDropdown();
    });
  }

  // Listen to parent app or other tabs changing language
  window.addEventListener("message", function (e) {
    var d = e && e.data;
    if (d && d.type === "minisketch-doc-lang" && (d.lang === "en" || d.lang === "id")) {
      setDocLang(d.lang, false);
      scrollToHash();
    }
  });
  window.addEventListener("storage", function (e) {
    if (e && e.key === LANG_KEY && (e.newValue === "en" || e.newValue === "id")) {
      setDocLang(e.newValue, false);
    }
  });
  window.addEventListener("hashchange", scrollToHash);

  // Initialize
  ensureLangSwitcher();
  markActiveNav();
  setDocLang(activeLang, false);
  updateClearBtn();
  hideDropdown();
  if (location.hash) setTimeout(scrollToHash, 0);

})();
