// ai/prompt.js — Frontend home of the AI chat POLICY.
//
// This module owns everything the LLM needs to drive MiniSketch EXCEPT the
// transport: the system prompt, the tool manifest and the domain skills. It
// fetches them as plain static files (no build step) so tuning the prompt or
// tools never needs a rebuild — push the file, refresh, done.
//
// Why on the frontend: the old design kept these on the bridge server, which
// meant every prompt tweak needed a server restart. Moving them here lets the
// SAME chat.js talk to EITHER backend (the tiny Node proxy or the KaryaCNC Go
// proxy) — both are now policy-free streams that just forward {messages, tools}.
//
// Contract (registered on window.MiniSketchAIPrompt):
//   ready()            -> Promise<null>; prefetch + cache tools/system/skills
//   systemMessage(messages, stateSummary, requestedSkills)
//                      -> {role:'system', content} for THIS turn, or null when
//                         nothing could be loaded (chat.js then sends history as-is)
//   toolManifest()     -> array of OpenAI tool schemas ([] when unavailable)
//
// Coordinates/units/color legend live in the system prompt file, not here — this
// file only assembles. Edit ai/system-prompt.txt, ai/tools.json, ai/skills.js.

(() => {
  'use strict';

  const NS = window.MiniSketchAIPrompt = window.MiniSketchAIPrompt || {};

  // Resolve ai/ asset URLs relative to THIS script, so it works from any page
  // path (/, /sketcher/, file://). prompt.js lives in ai/, next to the assets.
  function assetUrl(file) {
    try {
      const script = document.currentScript;
      if (script && script.src) {
        return script.src.replace(/prompt\.js.*$/, '') + file;
      }
    } catch (err) { /* fall through to relative */ }
    return 'ai/' + file;
  }

  const SYSTEM_URL = assetUrl('system-prompt.txt');
  const TOOLS_URL = assetUrl('tools.json');
  const SVG_SYSTEM_URL = assetUrl('system-prompt-svg.txt');

  // ---- cached policy assets ----------------------------------------------
  let systemText = '';      // ai/system-prompt.txt (the base persona + rules)
  let svgSystemText = '';   // ai/system-prompt-svg.txt (SVG-only mode persona)
  let tools = [];           // ai/tools.json -> .tools (OpenAI function schemas)
  let skills = [];          // [{name, trigger:[words], body}]
  let loadPromise = null;

  function fetchText(url) {
    return fetch(url, { cache: 'no-cache' }).then(r => (r.ok ? r.text() : ''));
  }
  function fetchJson(url) {
    return fetch(url, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null));
  }

  function load() {
    if (loadPromise) return loadPromise;
    loadPromise = Promise.all([
      fetchText(SYSTEM_URL),
      fetchJson(TOOLS_URL),
      fetchText(SVG_SYSTEM_URL)
    ]).then(([sys, toolsJson, svgSys]) => {
      systemText = String(sys || '').trim();
      svgSystemText = String(svgSys || '').trim();
      tools = (toolsJson && Array.isArray(toolsJson.tools)) ? toolsJson.tools : [];
      skills = readSkills();
      return null;
    }).catch(() => {
      // A missing/failed asset degrades gracefully: chat still runs, just with
      // no injected system prompt (the model leans on the history alone).
      systemText = systemText || '';
      svgSystemText = svgSystemText || '';
      tools = tools || [];
      skills = skills || [];
      return null;
    });
    return loadPromise;
  }

  // Skills live in ai/skills.js as window.MiniSketchAISkills (a plain array).
  // A separate file (not inline) so new recipes ship without touching chat.js.
  function readSkills() {
    const raw = window.MiniSketchAISkills;
    if (!Array.isArray(raw)) return [];
    return raw.map(s => ({
      name: String(s.name || '').trim(),
      trigger: (Array.isArray(s.trigger) ? s.trigger : String(s.trigger || '').split(','))
        .map(t => String(t).trim().toLowerCase()).filter(Boolean),
      body: String(s.body || '').trim()
    })).filter(s => s.name && s.body);
  }

  // Extract plain text from either string content or OpenAI multimodal parts[].
  function messageText(m) {
    const c = m && m.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) {
      return c
        .filter(p => p && p.type === 'text' && p.text)
        .map(p => String(p.text))
        .join(' ');
    }
    return '';
  }

  // Pick skills whose trigger word appears in the latest user message, plus any
  // the model explicitly asked for with use_skill. Domain knowledge on demand,
  // without bloating every prompt.
  function skillsFor(messages, requested) {
    const lastUser = [...(messages || [])].reverse().find(m => m && m.role === 'user');
    const text = messageText(lastUser).toLowerCase();
    const out = [];
    const seen = new Set();
    for (const s of skills) {
      const hit = (requested || []).includes(s.name) || s.trigger.some(t => text.includes(t));
      if (hit && !seen.has(s.name)) { out.push(s); seen.add(s.name); }
    }
    return out;
  }

  // Build THIS turn's system message: base persona + current document state
  // (so the model sees the worksheet) + any active skill recipes.
  // opts.svgMode switches to the SVG-only persona (no tools, no document dump —
  // the model just has to produce one <svg>).
  function systemMessage(messages, stateSummary, requestedSkills, opts) {
    const svgMode = !!(opts && opts.svgMode);
    const base = svgMode ? (svgSystemText || systemText) : systemText;
    if (!base) return null;
    let sys = base;
    if (!svgMode && stateSummary) {
      sys += '\n\nCURRENT DOCUMENT (world mm, Y-down: +X right, +Y down):\n' +
        JSON.stringify(stateSummary).slice(0, 4000);
    }
    const active = skillsFor(messages, requestedSkills);
    if (active.length && !svgMode) {
      sys += '\n\n' + active.map(s =>
        '=== ACTIVE SKILL: ' + s.name + ' ===\n' + s.body).join('\n\n');
    }
    return { role: 'system', content: sys };
  }

  function toolManifest() { return tools; }
  function ready() { return load(); }

  NS.ready = ready;
  NS.systemMessage = systemMessage;
  NS.toolManifest = toolManifest;
  // exposed for debugging / tests
  NS._debug = { skillsFor, readSkills, assetUrl };
})();
