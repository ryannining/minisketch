/* =====================================================================
   MiniSketch Help — shared search & navigation
   Include di SETIAP halaman help ( setelah search-data.js ).
   ===================================================================== */
(function () {
  "use strict";

  var searchInput = document.getElementById("help-search-input");
  var searchResults = document.getElementById("help-search-results");
  var searchEmpty = document.getElementById("help-search-empty");
  var navItems = document.querySelectorAll(".help-nav-item");
  var currentPage = location.pathname.split("/").pop() || "index.html";

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
    var q = (query || "").toLowerCase().trim();
    var results = [];

    if (q.length > 0) {
      results = window.HELP_SEARCH_INDEX.filter(function (topic) {
        var haystack =
          (topic.title || "") + " " + (topic.desc || "") + " " + (topic.tags || []).join(" ");
        return haystack.toLowerCase().indexOf(q) !== -1;
      });
    }

    if (results.length === 0) {
      if (searchEmpty) searchEmpty.hidden = q.length === 0;
      return;
    }
    if (searchEmpty) searchEmpty.hidden = true;

    results.slice(0, 12).forEach(function (topic) {
      var a = document.createElement("a");
      a.href = topic.url;
      a.className = "search-result-item";
      a.style.display = "block";
      a.style.padding = "8px 12px";
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

      // Highlight kata yang dicari pada judul/deskripsi (sederhana)
      if (q.length > 0) {
        highlightNode(titleEl, q);
        highlightNode(descEl, q);
      }

      searchResults.appendChild(a);
    });
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
      renderSearchResults(searchInput.value);
    });
    // Tutup hasil saat klik di luar
    document.addEventListener("click", function (e) {
      if (searchResults && !searchInput.contains(e.target) && !searchResults.contains(e.target)) {
        searchResults.innerHTML = "";
      }
    });
  }

  // Inisialisasi
  markActiveNav();
  if (searchInput) renderSearchResults("");

})();
