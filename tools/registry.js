// MiniSketch tool registry (loaded before every tool file and before app.js).
//
// A tool is one file in tools/ that calls MiniSketchTools.register({...}):
//   id       unique key, also the gen.kind app.js stores on a generated group
//   label    button text in the Tools panel
//   title    button tooltip
//   modal    the dialog markup, injected into <body> once
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

  const modalOf = (tool) => document.getElementById(tool.modalId);

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
