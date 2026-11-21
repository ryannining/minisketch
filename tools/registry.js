// MiniSketch tool registry (loaded before every tool file and before app.js).
//
// A tool is one file in tools/ that calls MiniSketchTools.register({...}):
//   id       unique key, also the gen.kind app.js stores on a generated group
//   label    button text in the Tools panel
//   title    button tooltip
//   modal    the dialog markup, injected into <body> once
//   guide    optional { en: {...}, id: {...} } of guide texts: every key maps
//            to the element in the modal carrying data-guide="key". File → Lang
//            switches which language is painted into those placeholders, so
//            every tool window reads in ONE language instead of a mix.
//   open     fill the dialog (api, params from a re-edited group or null)
//   apply    run the generator (api)
//   wire     optional, run once at mount for dialog listeners beyond Create /
//            Cancel (e.g. a type select that shows and hides field groups)
//
// The dialog needs no extra wiring: its .btn.primary is "Create" and an
// element whose id ends in -cancel is "Cancel", which is exactly what app.js's
// generic modal keyboard handler already looks for (Enter / Escape).
window.MiniSketchTools = (() => {
  'use strict';

  const NS = {};
  NS.list = [];
  NS.api = null;

  // Same key the Help window's EN / Indonesia switch uses, so File → Lang
  // moves the tool guides and the Help panes together.
  const LANG_KEY = 'minisketch.help.lang';

  const readLang = () => {
    try { return localStorage.getItem(LANG_KEY) === 'id' ? 'id' : 'en'; }
    catch (err) { return 'en'; }
  };
  NS.lang = readLang();

  const modalOf = (tool) => document.getElementById(tool.modalId);

  // Paint one tool's guide placeholders in the current language. Missing
  // translations fall back to English; a tool without a guide is skipped.
  function applyToolLang(tool) {
    const modal = modalOf(tool);
    if (!modal || !tool.guide) return;
    const g = tool.guide[NS.lang] || tool.guide.en;
    if (!g) return;
    for (const k of Object.keys(g)) {
      const el = modal.querySelector('[data-guide="' + k + '"]');
      if (el) el.innerHTML = g[k];
    }
  }

  // File → Lang: store the choice and repaint every open dialog's guides.
  NS.setLang = (lang) => {
    NS.lang = lang === 'id' ? 'id' : 'en';
    try { localStorage.setItem(LANG_KEY, NS.lang); } catch (err) { /* private mode */ }
    for (const tool of NS.list) applyToolLang(tool);
  };

  NS.register = (tool) => {
    if (!tool || !tool.id || !tool.apply) return;
    if (NS.list.some(t => t.id === tool.id)) return;
    NS.list.push(tool);
  };

  // Called once by app.js init(): publishes the internals the tools work with,
  // injects the dialogs, and puts a button per tool into the Tools row.
  NS.mount = (api, host) => {
    NS.api = api;
    for (const tool of NS.list) {
      if (tool.modal) {
        const holder = document.createElement('div');
        holder.innerHTML = tool.modal.trim();
        while (holder.firstChild) document.body.appendChild(holder.firstChild);
      }
    }
    for (const tool of NS.list) {
      const modal = modalOf(tool);
      if (modal) {
        applyToolLang(tool);
        const ok = modal.querySelector('.modal-actions .btn.primary');
        if (ok) ok.addEventListener('click', () => tool.apply(NS.api));
        const cancel = modal.querySelector('[id$="-cancel"]');
        if (cancel) cancel.addEventListener('click', () => NS.close(tool.id));
      }
      if (tool.wire) tool.wire(NS.api);
      if (!host) continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn small';
      btn.id = 'btn-' + tool.id;
      btn.textContent = tool.label || tool.id;
      if (tool.title) btn.title = tool.title;
      btn.addEventListener('click', () => NS.open(tool.id));
      host.appendChild(btn);
    }
  };

  NS.open = (id, params) => {
    const tool = NS.list.find(t => t.id === id);
    if (!tool || !NS.api) return;
    const modal = modalOf(tool);
    if (modal) modal.classList.remove('hidden');
    tool.open(NS.api, params || null);
  };

  NS.close = (id) => {
    const tool = NS.list.find(t => t.id === id);
    const modal = tool && modalOf(tool);
    if (modal) modal.classList.add('hidden');
  };

  // Double clicking a generated group: app.js hands over its saved gen.
  NS.reopen = (gen) => {
    if (!gen || !gen.kind) return false;
    const tool = NS.list.find(t => t.id === gen.kind);
    if (!tool) return false;
    NS.open(tool.id, gen.params || {});
    return true;
  };

  return NS;
})();
