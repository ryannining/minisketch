/* =====================================================================
   MiniSketch Help — shared search & navigation
   Include di SETIAP halaman help ( setelah search-data.js ).
   ===================================================================== */
(function () {
  "use strict";

  var searchInput = document.getElementById("help-search-input");
  var searchClear = document.getElementById("help-search-clear");
  var searchResults = document.getElementById("help-search-results");
  var searchEmpty = document.getElementById("help-search-empty");
  var searchBox = searchInput && searchInput.closest ? searchInput.closest(".help-search") : null;
  var navItems = document.querySelectorAll(".help-nav-item");
  var currentPage = location.pathname.split("/").pop() || "index.html";

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

  // ---- Highlight navigasi aktif berdasarkan halaman saat ini ----
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

  // ---- Pencarian topik ----
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
        (topic.title || "") + " " + (topic.desc || "") + " " + (topic.tags || []).join(" ");
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

      var titleEl = document.createElement("div");
      titleEl.style.fontWeight = "700";
      titleEl.style.color = "var(--accent-ink)";
      titleEl.style.marginBottom = "2px";
      titleEl.textContent = topic.title;

      var descEl = document.createElement("div");
      descEl.style.fontSize = "12px";
      descEl.style.color = "var(--muted)";
      descEl.textContent = topic.desc;

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
    // Tutup hasil saat klik di luar
    document.addEventListener("click", function (e) {
      if (searchBox && searchBox.contains(e.target)) return;
      hideDropdown();
    });
  }

  // Inisialisasi
  markActiveNav();
  updateClearBtn();
  hideDropdown();

})();
