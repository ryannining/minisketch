'use strict';
// MiniSketch AI bridge — a POLICY-FREE streaming proxy.
//
// All the POLICY (system prompt, tool manifest, domain skills) lives on the
// FRONTEND (ai/prompt.js + ai/system-prompt.txt + ai/tools.json + ai/skills.js).
// The frontend assembles the full `messages` (system message first) and the
// `tools` array and sends them here; this server forwards them to an
// OpenAI-compatible endpoint OR Google Gemini and streams the reply back.
//
// TWO providers, one wire protocol (100% compatible with KaryaCNC Go proxy):
//   • OpenAI-compatible (the default): forwards `messages`/`tools` straight to
//     {base}/chat/completions and re-assembles the SSE deltas.
//   • Google Gemini (auto-detected from the base URL — generativelanguage.*):
//     translates OpenAI-style messages/tools to Gemini contents/function
//     declarations, streams `alt=sse`, maps `thought:true` parts to thinking
//     deltas and `functionCall` parts to tool_calls.
//
// Run:  node server/ai-bridge.js     (default port 8090; PORT / AI_BRIDGE_PORT override)
// Optional env: AI_BRIDGE_PORT / PORT (listen), AI_ALLOWED_ORIGINS (extra CORS),
//   OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL / GEMINI_API_KEY (optional fallbacks).
// Credentials from Settings › AI chat travel per request and are never stored or logged.

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const PORT = +(process.env.PORT || process.env.AI_BRIDGE_PORT || 8090);

// Idle timeout for the upstream provider socket: any packet from the provider
// resets it, so a long reasoning stream is never killed — only a provider that
// stays silent this long is considered hung. Configurable via AI_UPSTREAM_IDLE_S.
const UPSTREAM_IDLE_MS = (() => {
  const raw = process.env.AI_UPSTREAM_IDLE_S;
  if (raw == null || String(raw).trim() === '') return 300000;
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? Math.round(v * 1000) : 300000;
})();

// ---- CORS -----------------------------------------------------------------
// The bridge forwards a paid API call, so a random web page must not be able to
// reach it. Allowed: the app itself (a file:// page sends Origin: null), any
// local/loopback page, and a private LAN address (phone/tablet on the same Wi-Fi).
// AI_ALLOWED_ORIGINS adds exact origins on top.
const EXTRA_ORIGINS = (process.env.AI_ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

function originAllowed(origin, req) {
  if (!origin) return true;            // no Origin header: not a browser page
  if (origin === 'null') return true;  // a local file — that IS the app
  if (EXTRA_ORIGINS.indexOf(origin) >= 0) return true;
  try {
    const u = new URL(origin);
    const h = u.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
    if (/^10\./.test(h) || /^192\.168\./.test(h)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
    const reqHost = req && (req.headers['x-forwarded-host'] || req.headers.host || '');
    const firstHost = String(reqHost).split(',')[0].trim().toLowerCase();
    if (firstHost && u.host.toLowerCase() === firstHost) return true;
  } catch (err) { return false; }
  return false;
}

// The user pastes the base URL in whatever shape the provider's docs show it,
// including a trailing slash or the full ".../v1/chat/completions". Both work.
function normalizeBase(base) {
  return String(base || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
}

// Validate upstream URL strictly (http: or https: only).
function parseUpstreamUrl(raw) {
  let u;
  try { u = new URL(String(raw || '')); }
  catch (err) { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return u;
}

// Local/LAN hosts (Ollama, LM Studio, llama.cpp, vLLM) often run without an API key.
function isLocalHost(base) {
  const u = parseUpstreamUrl(base);
  if (!u) return false;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]') return true;
  if (/^10\./.test(h) || /^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return false;
}

const GEMINI_HOST_RE = /generativelanguage\.googleapis\.com|generativelanguage\.google\.com/i;
const GLM_HOST_RE = /bigmodel\.cn|(^|\.)z\.ai$/i;
function isGemini(base) { return GEMINI_HOST_RE.test(String(base || '')); }
function isGlmHost(base) {
  const u = parseUpstreamUrl(base);
  return !!(u && GLM_HOST_RE.test(u.hostname));
}

// Resolve effective upstream config: request settings win, optional env vars
// act as fallback when request fields are blank. Never stores or echoes keys.
function resolveConfig(rs) {
  const s = rs || {};
  const reqBase = normalizeBase(s.baseUrl || '');
  const envBase = normalizeBase(process.env.OPENAI_BASE_URL || '');
  const base = reqBase || envBase;
  const gemini = isGemini(base);
  const reqKey = String(s.apiKey || '').trim();
  const envKey = String((gemini ? (process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY) : process.env.OPENAI_API_KEY) || '').trim();
  const key = reqKey || envKey;
  const reqModel = String(s.model || '').trim();
  const envModel = String(process.env.OPENAI_MODEL || process.env.MODEL || '').trim();
  const model = reqModel || envModel;
  return {
    base,
    key,
    model,
    gemini,
    local: !gemini && isLocalHost(base),
    baseFrom: reqBase ? 'request' : (envBase ? 'env' : 'none'),
    keyFrom: reqKey ? 'request' : (envKey ? 'env' : 'none'),
    modelFrom: reqModel ? 'request' : (envModel ? 'env' : 'default')
  };
}

// ---- arg sanitizing (parity with the KaryaCNC Go proxy's sanitizeAIArgs) ---
// A model can hallucinate wild coordinates; clamp every number to the world
// frame so nothing absurd reaches the worksheet. Constraint `value` gets a
// wider limit. Mirrors the Go proxy so both backends behave identically.
function clampNum(n, limit) {
  if (!isFinite(n)) return 0;
  return Math.max(-limit, Math.min(limit, n));
}
function sanitizeArgs(args) {
  if (!args || typeof args !== 'object') return {};
  for (const k of Object.keys(args)) {
    const v = args[k];
    if (typeof v === 'number') {
      args[k] = clampNum(v, k === 'value' ? 100000 : 10000);
    } else if (Array.isArray(v)) {
      args[k] = v.map(item =>
        (item && typeof item === 'object') ? sanitizeArgs(item) :
        (typeof item === 'number') ? clampNum(item, 10000) : item);
    } else if (v && typeof v === 'object') {
      args[k] = sanitizeArgs(v);
    }
  }
  return args;
}
const MAX_OPS = 20;

// Log-friendly summary of a user message (string OR multimodal parts array).
function describeMessage(m) {
  const c = m && m.content;
  if (typeof c === 'string') return c.replace(/\s+/g, ' ').slice(0, 160);
  if (Array.isArray(c)) {
    const texts = [];
    let imgs = 0;
    for (const p of c) {
      if (p && p.type === 'text' && p.text) texts.push(String(p.text));
      else if (p && p.type === 'image_url') imgs++;
    }
    const out = texts.join(' ').replace(/\s+/g, ' ').slice(0, 120);
    return out + (imgs ? (out ? ' [' : '[') + imgs + ' gambar]' : '');
  }
  return '(none)';
}

// ---- upstream (one socket at a time, no keep-alive) -----------------------
// Providers count OPEN CONNECTIONS as "active sessions" (429 past a small cap),
// so every request opens a fresh socket and closes it as soon as it's read, and
// requests are serialized.
let upstreamBusy = null;
function serializeUpstream(run) {
  const next = (upstreamBusy || Promise.resolve()).then(run, run);
  upstreamBusy = next.catch(() => {});
  return next;
}

// Build an OpenAI-compatible request body without sending proprietary flags to
// unrelated providers (avoids unnecessary 400 retry double-requests).
function openaiRequest(input, cfg, opts) {
  const o = opts || {};
  const body = {
    model: cfg.model || undefined,
    messages: input.messages || [],
    stream: true
  };
  const tools = Array.isArray(input.tools) ? input.tools : [];
  // Omit `tools` / `tool_choice` when empty (SVG mode): several OpenAI-compatible
  // endpoints return 400 when given `tools: [], tool_choice: 'auto'`.
  if (tools.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  if (!o.bare) {
    body.stream_options = { include_usage: true };
    const level = String(input.thinking || 'normal').toLowerCase();
    if (isGlmHost(cfg.base)) {
      if (level === 'off') body.thinking = { type: 'disabled' };
      else body.thinking = { type: 'enabled' };
      if (level === 'low') body.reasoning_effort = 'low';
    } else {
      if (level === 'low') body.reasoning_effort = 'low';
    }
  }
  return body;
}

function postUpstreamOnce(payload, register, cfg) {
  const base = normalizeBase(cfg.base);
  const key = cfg.key;
  return new Promise((resolve, reject) => {
    if (!base || (!key && !cfg.local)) return reject(new Error('missing API key or base URL'));
    const url = parseUpstreamUrl(base + '/chat/completions');
    if (!url) return reject(new Error('invalid upstream base URL'));
    const lib = url.protocol === 'https:' ? https : http;
    const onDelta = payload.onDelta;
    const wire = { ...payload };
    delete wire.onDelta;
    const body = JSON.stringify(wire);
    const headers = {
      'Content-Type': 'application/json',
      'Connection': 'close',
      'Accept': 'text/event-stream',
      'Content-Length': Buffer.byteLength(body)
    };
    if (key) headers['Authorization'] = 'Bearer ' + key;
    let settled = false;
    const doneResolve = (v) => { if (!settled) { settled = true; resolve(v); } };
    const doneReject = (e) => { if (!settled) { settled = true; reject(e); } };

    const req = lib.request(url, {
      method: 'POST',
      agent: false,                      // no socket pooling: close after each response
      headers
    }, (res) => {
      let buf = '';
      let rawBody = '';
      const assembled = { role: 'assistant', content: '', reasoning_content: '', tool_calls: [], usage: null };
      const tcBuf = {};                  // index -> {id, name, arguments}
      const finish = (err) => {
        if (err) return doneReject(err);
        for (const k of Object.keys(tcBuf).sort((a, b) => (+a) - (+b))) {
          const t = tcBuf[k];
          assembled.tool_calls.push({
            id: t.id,
            function: { name: t.name || '', arguments: t.arguments || '' }
          });
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          let msg = (rawBody || buf).trim();
          try {
            const j = JSON.parse(msg);
            if (j.error && j.error.message) msg = j.error.message;
          } catch (e) { /* keep raw */ }
          return doneReject(new Error('upstream ' + res.statusCode + ': ' + msg.slice(0, 600)));
        }
        doneResolve({ choices: [{ message: assembled }], usage: assembled.usage, _raw: true });
      };
      res.on('data', (c) => {
        const s = c.toString();
        buf += s;
        if (rawBody.length < 4096) rawBody += s;
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') return finish();
          let j;
          try { j = JSON.parse(data); } catch (err) { continue; }
          if (j.usage && typeof j.usage === 'object') {
            assembled.usage = {
              prompt_tokens: +j.usage.prompt_tokens || 0,
              completion_tokens: +j.usage.completion_tokens || 0,
              total_tokens: +j.usage.total_tokens || ((+j.usage.prompt_tokens || 0) + (+j.usage.completion_tokens || 0))
            };
          }
          const d = (j.choices && j.choices[0] && j.choices[0].delta) || {};
          const rChunk = d.reasoning_content || d.reasoning || '';
          if (rChunk) {
            assembled.reasoning_content += rChunk;
            if (onDelta) onDelta({ thinking: rChunk });
          }
          if (d.content) {
            assembled.content += d.content;
            if (onDelta) onDelta({ content: d.content });
          }
          for (const tc of (d.tool_calls || [])) {
            const i = tc.index != null ? tc.index : 0;
            if (!tcBuf[i]) tcBuf[i] = { name: '', arguments: '' };
            if (tc.id && !tcBuf[i].id) tcBuf[i].id = tc.id;
            if (tc.function) {
              if (tc.function.name) tcBuf[i].name += tc.function.name;
              if (tc.function.arguments) tcBuf[i].arguments += tc.function.arguments;
            }
          }
        }
      });
      res.on('end', () => finish());
      res.on('error', (err) => finish(err));
    });
    req.setTimeout(UPSTREAM_IDLE_MS, () => req.destroy(new Error(
      'upstream idle >' + (UPSTREAM_IDLE_MS / 1000) + 's — connection closed')));
    req.on('error', doneReject);
    if (register) register(req);         // caller aborts when its client leaves
    req.write(body);
    req.end();
  });
}

// ---- Google Gemini adapter ------------------------------------------------
// OpenAI message content (string | parts[]) -> Gemini parts[]
function geminiParts(m) {
  const c = m.content;
  if (typeof c === 'string') return c ? [{ text: c }] : [];
  if (!Array.isArray(c)) return [];
  const parts = [];
  for (const p of c) {
    if (p.type === 'text' && p.text) {
      parts.push({ text: String(p.text) });
    } else if (p.type === 'image_url' && p.image_url && p.image_url.url) {
      // data:image/png;base64,.... -> inlineData (Gemini)
      const mm = String(p.image_url.url).match(/^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i);
      if (mm) parts.push({ inlineData: { mimeType: mm[1], data: mm[2] } });
    }
  }
  return parts;
}

// Build Gemini generationConfig.thinkingConfig according to model generation
// and requested reasoning level ('off' | 'low' | 'normal' | false).
function geminiThinkingConfig(model, level) {
  if (level === false) return null;
  const lv = String(level || 'normal').toLowerCase();
  const m = String(model || '').toLowerCase();
  const isGen34 = /^gemini-[34]/.test(m);
  const isGen25 = /^gemini-2\.5/.test(m);
  if (lv === 'off') {
    if (isGen25) {
      // Gemini 2.5 Pro cannot turn thinking off completely; Flash accepts 0.
      if (/pro/.test(m)) return { includeThoughts: false, thinkingBudget: 128 };
      return { includeThoughts: false, thinkingBudget: 0 };
    }
    if (isGen34) {
      if (/flash-lite/.test(m)) return { includeThoughts: false, thinkingLevel: 'MINIMAL' };
      return { includeThoughts: false, thinkingLevel: 'LOW' };
    }
    return null;
  }
  if (lv === 'low') {
    if (isGen34) return { includeThoughts: true, thinkingLevel: 'LOW' };
    if (isGen25) return { includeThoughts: true, thinkingBudget: 1024 };
    return { includeThoughts: true };
  }
  // 'normal' (default)
  return { includeThoughts: true };
}

// Build a Gemini generateContent request body from the OpenAI-style input.
function geminiRequest(input, cfg) {
  const contents = [];
  let sysText = '';
  const push = (role, parts) => {
    if (!parts.length) return;
    const last = contents[contents.length - 1];
    // Gemini wants alternate user/model roles — merge consecutive same-role.
    if (last && last.role === role) last.parts = last.parts.concat(parts);
    else contents.push({ role, parts });
  };
  for (const m of input.messages || []) {
    if (!m || !m.role) continue;
    if (m.role === 'system') {
      const t = typeof m.content === 'string' ? m.content : '';
      if (t) sysText += (sysText ? '\n\n' : '') + t;
      continue;
    }
    const role = (m.role === 'assistant' || m.role === 'model') ? 'model' : 'user';
    push(role, geminiParts(m));
  }
  const body = { contents };
  if (sysText) body.systemInstruction = { parts: [{ text: sysText }] };
  if (Array.isArray(input.tools) && input.tools.length) {
    const decls = [];
    for (const t of input.tools) {
      const fn = (t && t.function) || {};
      const name = fn.name || (t && t.name);
      if (!name) continue;
      const d = { name, description: fn.description || '' };
      if (fn.parameters) d.parameters = fn.parameters;
      decls.push(d);
    }
    if (decls.length) body.tools = [{ functionDeclarations: decls }];
  }
  const tc = geminiThinkingConfig(cfg && cfg.model, input.thinking);
  if (tc) body.generationConfig = { thinkingConfig: tc };
  return body;
}

// Stream from Gemini REST. Resolves { content, reasoning, calls, usage }.
function postGeminiOnce(payload, register, cfg) {
  const base = normalizeBase(cfg.base);
  const key = cfg.key;
  return new Promise((resolve, reject) => {
    if (!base || !key) return reject(new Error('missing API key or base URL'));
    const model = encodeURIComponent(cfg.model || 'gemini-4-hydrogen');
    const root = base.replace(/\/v1beta?$/, '');
    const url = parseUpstreamUrl(root + '/v1beta/models/' + model + ':streamGenerateContent?alt=sse');
    if (!url) return reject(new Error('invalid Gemini base URL'));
    const lib = url.protocol === 'https:' ? https : http;
    const onDelta = payload.onDelta;
    const wire = { ...payload };
    delete wire.onDelta;
    const body = JSON.stringify(wire);
    let settled = false;
    const doneResolve = (v) => { if (!settled) { settled = true; resolve(v); } };
    const doneReject = (e) => { if (!settled) { settled = true; reject(e); } };

    const req = lib.request(url, {
      method: 'POST',
      agent: false,                      // no socket pooling: close after each response
      headers: {
        'Content-Type': 'application/json',
        'Connection': 'close',
        'Accept': 'text/event-stream',
        'x-goog-api-key': key,
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let buf = '';
      let rawBody = '';       // full raw response captured for error reporting
      let events = 0;
      const t0 = Date.now();
      const state = { content: '', reasoning: '', calls: [], usage: null };
      const liveness = setInterval(() => {
        const secs = Math.round((Date.now() - t0) / 1000);
        console.log('  [gemini] live ' + secs + 's · events=' + events +
          ' · bytes=' + Math.round((state.reasoning.length + state.content.length) / 1024) + 'KB');
      }, 20000);
      const stopLiveness = () => clearInterval(liveness);
      const finish = (err) => {
        stopLiveness();
        if (err) return doneReject(err);
        if (res.statusCode < 200 || res.statusCode >= 300) {
          let msg = (rawBody || buf).trim();
          try {
            const j = JSON.parse(msg);
            if (j.error) msg = j.error.message || j.error.status || msg;
          } catch (e) { /* keep raw text */ }
          if (!msg) msg = '(empty response body, status ' + res.statusCode + ')';
          return doneReject(new Error('upstream ' + res.statusCode + ': ' + msg.slice(0, 600)));
        }
        doneResolve(state);
      };
      res.on('data', (c) => {
        const s = c.toString();
        buf += s;
        if (rawBody.length < 4096) rawBody += s;
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data) continue;
          let j;
          try { j = JSON.parse(data); } catch (err) { continue; }
          if (j.error) { finish(new Error(j.error.message || 'gemini error')); return; }
          if (j.usageMetadata && typeof j.usageMetadata === 'object') {
            const u = j.usageMetadata;
            const pt = +u.promptTokenCount || 0;
            const ct = (+u.candidatesTokenCount || 0) + (+u.thoughtsTokenCount || 0);
            state.usage = {
              prompt_tokens: pt,
              completion_tokens: ct,
              total_tokens: +u.totalTokenCount || (pt + ct)
            };
          }
          const cand = (j.candidates || [])[0];
          if (!cand || !cand.content || !Array.isArray(cand.content.parts)) continue;
          for (const part of cand.content.parts) {
            if (!part) continue;
            if (part.thought) {
              state.reasoning += part.text || '';
              if (onDelta) onDelta({ thinking: part.text || '' });
            } else if (typeof part.text === 'string' && part.text) {
              state.content += part.text;
              if (onDelta) onDelta({ content: part.text });
            } else if (part.functionCall && part.functionCall.name) {
              state.calls.push({
                name: part.functionCall.name,
                arguments: part.functionCall.args || {}
              });
            }
          }
          events++;
        }
      });
      res.on('end', () => finish());
      res.on('error', (err) => finish(err));
    });
    req.setTimeout(UPSTREAM_IDLE_MS, () => req.destroy(new Error(
      'upstream idle >' + (UPSTREAM_IDLE_MS / 1000) + 's — connection closed')));
    req.on('error', doneReject);
    if (register) register(req);         // caller aborts when its client leaves
    req.write(body);
    req.end();
  });
}

// 429 (session/rate limit) waits once and retries — cancellable if client stops.
function postUpstream(payload, register, cfg, isCancelled, registerSleep) {
  const runOnce = isGemini(cfg.base) ? postGeminiOnce : postUpstreamOnce;
  return serializeUpstream(async () => {
    if (isCancelled && isCancelled()) throw new Error('client aborted');
    try {
      return await runOnce(payload, register, cfg);
    } catch (err) {
      if (isCancelled && isCancelled()) throw err;
      if (!/^upstream 429/.test(String(err && err.message))) throw err;
      console.log('  upstream 429: waiting 6s, retrying once…');
      await new Promise((resolve) => {
        const t = setTimeout(resolve, 6000);
        if (registerSleep) registerSleep(() => { clearTimeout(t); resolve(); });
      });
      if (isCancelled && isCancelled()) throw new Error('client aborted');
      return await runOnce(payload, register, cfg);
    }
  });
}

// Normalize raw tool calls from EITHER provider into {name, arguments} with
// sanitized (clamped) args, de-duped, capped — parity with the Go proxy.
function assembleCalls(raw) {
  const seen = new Set();
  const calls = [];
  for (const tc of (raw || [])) {
    const fn = tc.function || {};
    const name = (fn.name || tc.name || '').trim();
    if (!name) continue;
    const rawArgs = (tc.arguments !== undefined) ? tc.arguments : fn.arguments;
    let args = {};
    if (typeof rawArgs === 'string') {
      try { args = JSON.parse(rawArgs); } catch (err) { continue; }
    } else if (rawArgs && typeof rawArgs === 'object') {
      args = rawArgs;
    }
    const sanitized = sanitizeArgs(args);
    const fp = name + '|' + JSON.stringify(sanitized);
    if (seen.has(fp)) continue;
    seen.add(fp);
    calls.push({ name, arguments: sanitized });
    if (calls.length >= MAX_OPS) break;
  }
  return calls;
}

// ---- Persistent Extension Marketplace (catalog + publish on disk) ----------
function marketplaceDir() {
  const envDir = process.env.MARKETPLACE_DIR;
  return envDir && String(envDir).trim()
    ? path.resolve(String(envDir).trim())
    : path.resolve(__dirname, '..', 'marketplace');
}

function marketplacePaths() {
  const dir = marketplaceDir();
  return {
    dir,
    extDir: path.join(dir, 'extensions'),
    catalogFile: path.join(dir, 'catalog.json')
  };
}

function publishKeyValid(supplied) {
  const expected = String(process.env.MARKETPLACE_PUBLISH_KEY || '').trim();
  if (!expected) return true;
  const got = String(supplied || '').trim();
  if (!got) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(got, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function readMarketplaceCatalog() {
  const { catalogFile } = marketplacePaths();
  try {
    const raw = fs.readFileSync(catalogFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.extensions)) return parsed;
  } catch (err) { /* fall back to empty catalog */ }
  return {
    marketplaceVersion: 1,
    name: 'MiniSketch Extension Marketplace',
    updatedAt: new Date().toISOString(),
    extensions: []
  };
}

function writeFileAtomic(targetPath, content) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = targetPath + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, targetPath);
}

function validateExtensionPayload(meta, code) {
  const m = meta && typeof meta === 'object' ? meta : {};
  const id = String(m.id || '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(id)) {
    return { ok: false, error: 'Extension ID must be 2-40 lowercase letters, digits, or hyphens (starting with a letter).' };
  }
  const name = String(m.name || '').trim().slice(0, 80);
  if (!name) return { ok: false, error: 'Extension name is required.' };
  const version = String(m.version || '1.0.0').trim().slice(0, 32);
  if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(version)) {
    return { ok: false, error: 'Version must use semantic format like 1.0.0.' };
  }
  const author = String(m.author || 'Community').trim().slice(0, 60) || 'Community';
  const category = String(m.category || 'CNC Utility').trim().slice(0, 40) || 'CNC Utility';
  const description = String(m.description || '').trim().slice(0, 240);
  const src = String(code == null ? '' : code);
  if (src.length < 40 || src.length > 200 * 1024) {
    return { ok: false, error: 'Extension code must be between 40 bytes and 200 KB.' };
  }
  try {
    new vm.Script(src, { filename: id + '.js' });
  } catch (err) {
    return { ok: false, error: 'JavaScript syntax error: ' + String(err && err.message || err) };
  }
  const hasRegister =
    /(?:MiniSketchTools|NS)\s*\.\s*register\s*\(/.test(src) ||
    (/\bMiniSketchTools\b/.test(src) && /\.register\s*\(/.test(src));
  if (!hasRegister) {
    return { ok: false, error: 'Extension must call MiniSketchTools.register({...}).' };
  }
  let registeredId = '';
  try {
    let captured = null;
    const noop = () => {};
    const stubDoc = {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ classList: { add: noop, remove: noop, toggle: noop }, style: {}, appendChild: noop, addEventListener: noop })
    };
    const sandbox = {
      MiniSketchTools: { register(t) { captured = t; } },
      document: stubDoc,
      localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
      Math, Date, JSON, Array, Object, String, Number, Boolean, RegExp, Map, Set, parseInt, parseFloat, isFinite, isNaN
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    const ctx = vm.createContext(sandbox);
    new vm.Script(src, { filename: id + '.js' }).runInContext(ctx, { timeout: 250 });
    if (captured && typeof captured.id === 'string') {
      registeredId = captured.id.trim().toLowerCase();
    }
  } catch (err) {
    const idMatch = src.match(/['"]?\bid['"]?\s*:\s*(['"`])([a-z0-9-]+)\1/i);
    if (idMatch) registeredId = idMatch[2].toLowerCase();
  }
  if (!registeredId || registeredId !== id) {
    return { ok: false, error: 'Code register({ id }) must match Extension ID "' + id + '".' };
  }
  const rawIcon = String(m.icon || '').trim();
  const iconMatch = rawIcon.match(/<svg\b[^>]*>[\s\S]*?<\/svg>/i);
  const safeIcon = (iconMatch && !/<\s*(script|foreignObject|iframe|object|embed|style)\b/i.test(iconMatch[0]) && !/\bon[a-z]+\s*=|javascript:/i.test(iconMatch[0]))
    ? iconMatch[0].slice(0, 2048)
    : '';
  const now = new Date().toISOString();
  return {
    ok: true,
    code: src,
    entry: {
      id,
      name,
      version,
      author,
      category,
      description,
      ...(safeIcon ? { icon: safeIcon } : {}),
      scriptUrl: 'extensions/' + id + '.js',
      minAppVersion: '1.0.0',
      updatedAt: now
    }
  };
}

function publishMarketplaceExtension(entry, code, overwrite) {
  const { extDir, catalogFile } = marketplacePaths();
  const catalog = readMarketplaceCatalog();
  const idx = catalog.extensions.findIndex(e => e && e.id === entry.id);
  if (idx >= 0 && !overwrite) {
    return { ok: false, status: 409, exists: true, error: 'Extension "' + entry.id + '" already exists in Marketplace (enable overwrite to update).' };
  }
  fs.mkdirSync(extDir, { recursive: true });
  const targetScript = path.join(extDir, entry.id + '.js');
  writeFileAtomic(targetScript, code);
  if (idx >= 0) catalog.extensions[idx] = entry;
  else catalog.extensions.push(entry);
  catalog.updatedAt = entry.updatedAt;
  writeFileAtomic(catalogFile, JSON.stringify(catalog, null, 2) + '\n');
  return { ok: true, entry, catalog };
}

function deleteMarketplaceExtension(extId) {
  const id = String(extId || '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(id)) {
    return { ok: false, status: 400, error: 'Invalid extension ID.' };
  }
  const { extDir, catalogFile } = marketplacePaths();
  const catalog = readMarketplaceCatalog();
  const idx = catalog.extensions.findIndex(e => e && e.id === id);
  if (idx < 0) return { ok: false, status: 404, error: 'Extension not found in catalog.' };
  catalog.extensions.splice(idx, 1);
  catalog.updatedAt = new Date().toISOString();
  const targetScript = path.join(extDir, id + '.js');
  try { if (fs.existsSync(targetScript)) fs.unlinkSync(targetScript); } catch (err) { /* ignore */ }
  writeFileAtomic(catalogFile, JSON.stringify(catalog, null, 2) + '\n');
  return { ok: true, catalog };
}

// ---- HTTP handler: /health, /api/chat, /api/models ------------------------
function bridgeHandler(req, res) {
  const origin = req.headers.origin || '';
  if (!originAllowed(origin, req)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'origin not allowed: ' + origin }));
    return;
  }
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Publish-Key');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const reqPath = String(req.url || '').split('?')[0];

  if (req.method === 'GET' && reqPath === '/health') {
    const envCfg = resolveConfig({});
    const pubKey = String(process.env.MARKETPLACE_PUBLISH_KEY || '').trim();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      proxy: true,
      hasEnvKey: !!envCfg.key,
      hasEnvBase: !!envCfg.base,
      envModel: envCfg.model || undefined,
      requiresPublishKey: !!pubKey
    }));
    return;
  }

  if (reqPath === '/api/marketplace/catalog' && req.method === 'GET') {
    const cat = readMarketplaceCatalog();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, ...cat }));
    return;
  }

  if (reqPath === '/api/marketplace/publish' && req.method === 'POST') {
    let raw = '';
    let tooBig = false;
    req.on('data', c => {
      raw += c;
      if (raw.length > 512 * 1024) { tooBig = true; req.destroy(); }
    });
    req.on('end', () => {
      if (tooBig) {
        if (!res.writableEnded) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Payload too large (max 512 KB).' }));
        }
        return;
      }
      let input = {};
      try { input = JSON.parse(raw || '{}'); }
      catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body.' }));
        return;
      }
      const suppliedKey = String((req.headers && req.headers['x-publish-key']) || input.publishKey || '').trim();
      if (!publishKeyValid(suppliedKey)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid or missing Publish Key.' }));
        return;
      }
      const metaObj = (input.meta && typeof input.meta === 'object') ? input.meta : input;
      const check = validateExtensionPayload(metaObj, input.code);
      if (!check.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: check.error }));
        return;
      }
      const result = publishMarketplaceExtension(check.entry, check.code, !!input.overwrite);
      if (!result.ok) {
        res.writeHead(result.status || 409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: result.error, exists: !!result.exists }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, scriptUrl: result.entry.scriptUrl, entry: result.entry, catalog: result.catalog }));
    });
    return;
  }

  if (reqPath.startsWith('/api/marketplace/extensions/') && req.method === 'GET') {
    const rawId = decodeURIComponent(reqPath.slice('/api/marketplace/extensions/'.length)).trim().replace(/\.js$/i, '').toLowerCase();
    if (!/^[a-z][a-z0-9-]{1,39}$/.test(rawId)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid extension ID.' }));
      return;
    }
    const targetScript = path.join(marketplacePaths().extDir, rawId + '.js');
    try {
      const code = fs.readFileSync(targetScript, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(code);
    } catch (err) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Extension script not found.' }));
    }
    return;
  }

  if (reqPath.startsWith('/api/marketplace/extensions/') && req.method === 'DELETE') {
    const extId = decodeURIComponent(reqPath.slice('/api/marketplace/extensions/'.length)).trim();
    const suppliedKey = String((req.headers && req.headers['x-publish-key']) || '').trim();
    if (!publishKeyValid(suppliedKey)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid or missing Publish Key.' }));
      return;
    }
    const result = deleteMarketplaceExtension(extId);
    if (!result.ok) {
      res.writeHead(result.status || 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: result.error }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, id: extId, catalog: result.catalog }));
    return;
  }

  if (req.method === 'POST' && reqPath === '/api/chat') {
    const t0 = Date.now();
    let raw = '';
    let tooBig = false;
    req.on('data', c => {
      raw += c;
      if (raw.length > 10 * 1024 * 1024) { tooBig = true; req.destroy(); }
    });
    req.on('end', async () => {
      if (tooBig) return;
      let clientGone = false;
      let activeUpReq = null;
      let cancelSleep = null;
      res.on('close', () => {
        if (res.writableEnded) return;     // normal completion, not a drop
        clientGone = true;
        if (cancelSleep) { try { cancelSleep(); } catch (e) {} cancelSleep = null; }
        if (activeUpReq) {
          try { activeUpReq.destroy(new Error('client aborted')); } catch (e) {}
          activeUpReq = null;
        }
      });
      const send = (obj) => {
        if (clientGone || res.writableEnded) return;
        try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); }
        catch (err) { clientGone = true; }
      };
      try {
        const input = JSON.parse(raw || '{}');
        const messages = Array.isArray(input.messages) ? input.messages : [];
        const tools = Array.isArray(input.tools) ? input.tools : [];
        const rs = (input && input.settings) || {};
        const cfg = resolveConfig(rs);
        const lastUser = [...messages].reverse().find(m => m && m.role === 'user');
        const thinkLevel = String(
          rs.thinking != null ? rs.thinking :
          (input.thinking != null ? input.thinking : 'normal')
        ).toLowerCase();

        console.log('\n=== chat ' + new Date().toLocaleTimeString() + ' ===' +
          ' msgs=' + messages.length + ' tools=' + tools.length +
          ' think=' + thinkLevel +
          ' model=' + (cfg.model || '(provider default)') +
          ' base=' + (cfg.base || '(none)') +
          ' key=' + cfg.keyFrom +
          (cfg.gemini ? ' [gemini adapter]' : (cfg.local ? ' [local]' : '')));
        console.log('  user says: ' + describeMessage(lastUser));

        if (!cfg.base || (!cfg.key && !cfg.local)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'No API key or base URL. Set "AI API base URL" and "AI API key" in Settings › AI chat.'
          }));
          return;
        }
        if (!parseUpstreamUrl(cfg.base)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'AI API base URL tidak valid — gunakan alamat http:// atau https://.'
          }));
          return;
        }

        // SSE to the browser: live reasoning/content deltas, then one final JSON
        // event with the assembled tool_calls (chat.js has one reader for both).
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });

        // When the browser aborts (Stop button / tab closed), destroy the
        // upstream request immediately so a paid stream never keeps running.
        const abortUp = (r) => {
          activeUpReq = r;
          if (r && clientGone) {
            try { r.destroy(new Error('client aborted')); } catch (e) {}
            activeUpReq = null;
          }
        };
        const isCancelled = () => clientGone;
        const regSleep = (fn) => { cancelSleep = fn; };

        let upstream;
        try {
          try {
            const p = cfg.gemini
              ? geminiRequest({ messages, tools, thinking: thinkLevel }, cfg)
              : openaiRequest({ messages, tools, thinking: thinkLevel }, cfg, { bare: false });
            p.onDelta = (d) => send({ delta: d });
            upstream = await postUpstream(p, abortUp, cfg, isCancelled, regSleep);
          } catch (err) {
            if (clientGone) return;
            if (!/^upstream 400/.test(String(err && err.message))) throw err;
            console.log('  upstream rejected optional thinking/usage flags — retrying bare');
            const p2 = cfg.gemini
              ? geminiRequest({ messages, tools, thinking: false }, cfg)
              : openaiRequest({ messages, tools, thinking: 'off' }, cfg, { bare: true });
            p2.onDelta = (d) => send({ delta: d });
            upstream = await postUpstream(p2, abortUp, cfg, isCancelled, regSleep);
          }
        } catch (err) {
          if (clientGone) return;
          let text = String(err && err.message || err);
          if (/is not found|not found for API version/i.test(text)) {
            text = 'Model tidak ditemukan di provider — periksa nama/versi model (klik tombol 🔄 di panel AI Chat untuk memuat daftar model). Pesan provider: ' + text;
          }
          console.log('  ERROR: ' + text.slice(0, 300));
          send({ error: text });
          res.end();
          return;
        } finally {
          activeUpReq = null;
          cancelSleep = null;
        }

        if (clientGone) return;
        const msg = cfg.gemini ? null : ((upstream.choices && upstream.choices[0] && upstream.choices[0].message) || {});
        const reply = cfg.gemini ? String(upstream.content || '') : String((msg && msg.content) || '');
        const think = cfg.gemini ? String(upstream.reasoning || '') : String((msg && (msg.reasoning_content || msg.reasoning)) || '');
        const rawCalls = cfg.gemini ? upstream.calls : ((msg && msg.tool_calls) || []);
        const usage = cfg.gemini ? upstream.usage : (upstream.usage || (msg && msg.usage) || null);
        const calls = assembleCalls(rawCalls);
        console.log('  <- model: ' + (Date.now() - t0) + ' ms (gemini=' + cfg.gemini + '), tool_calls=' + calls.length +
          (usage && usage.total_tokens ? ', tokens=' + usage.total_tokens : ''));
        send({
          done: true,
          reply,
          thinking: think.slice(0, 8000),
          tool_calls: calls,
          ...(usage ? { usage } : {})
        });
        res.end();
      } catch (err) {
        const text = String(err && err.message || err);
        if (res.headersSent) {
          try { if (!res.writableEnded) { send({ error: text }); res.end(); } } catch (e2) {}
          return;
        }
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: text }));
      }
    });
    return;
  }

  // ---- helper: POST /api/models (provider model list & connection test) ----
  if (req.method === 'POST' && reqPath === '/api/models') {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 256 * 1024) req.destroy(); });
    req.on('end', () => {
      let input = {};
      try { input = JSON.parse(raw || '{}'); } catch (err) { input = {}; }
      const rs = (input && input.settings) || {};
      const cfg = resolveConfig(rs);
      if (!cfg.base) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Base URL kosong — pilih provider atau isi AI API base URL.' }));
        return;
      }
      if (!parseUpstreamUrl(cfg.base)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Base URL tidak valid — gunakan alamat http:// atau https://.' }));
        return;
      }
      if (!cfg.key && !cfg.local) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Isi dulu AI API key.' }));
        return;
      }
      const root = cfg.base.replace(/\/v1beta?$/, '');
      const url = parseUpstreamUrl(cfg.gemini ? root + '/v1beta/models' : cfg.base + '/models');
      if (!url) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Base URL tidak valid.' }));
        return;
      }
      const lib = url.protocol === 'https:' ? https : http;
      const headers = { 'Accept': 'application/json' };
      if (cfg.gemini && cfg.key) headers['x-goog-api-key'] = cfg.key;
      else if (cfg.key) headers['Authorization'] = 'Bearer ' + cfg.key;

      let replied = false;
      const replyJson = (code, obj) => {
        if (replied || res.writableEnded) return;
        replied = true;
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      const req2 = lib.request(url, {
        method: 'GET',
        agent: false,
        headers
      }, (r2) => {
        let out = '';
        r2.on('data', c => { out += c; });
        r2.on('end', () => {
          if (r2.statusCode < 200 || r2.statusCode >= 300) {
            let msg = out.slice(0, 400);
            try { const j = JSON.parse(out); if (j.error && j.error.message) msg = j.error.message; } catch (e) {}
            replyJson(502, { error: msg || ('HTTP ' + r2.statusCode) });
            return;
          }
          let names = [];
          try {
            const j = JSON.parse(out);
            if (cfg.gemini) {
              names = (j.models || [])
                .filter(m => m && Array.isArray(m.supportedGenerationMethods) &&
                  m.supportedGenerationMethods.indexOf('generateContent') >= 0)
                .map(m => m.name.replace(/^models\//, ''));
            } else {
              // OpenAI standard: { data: [{ id, ... }] } or Ollama { models: [{ name }] }
              names = (j.data || []).map(m => m && m.id).filter(Boolean);
              if (!names.length && Array.isArray(j.models)) {
                names = j.models.map(m => m && (m.id || m.name)).filter(Boolean);
              }
            }
            names = names.filter((v, i, a) => a.indexOf(v) === i).sort();
          } catch (err) { /* fall through empty */ }
          replyJson(200, { models: names.slice(0, 300) });
        });
      });
      req2.setTimeout(30000, () => req2.destroy(new Error('ListModels timeout')));
      req2.on('error', (err) => {
        replyJson(502, { error: String(err && err.message || err) });
      });
      req2.end();
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
}

if (require.main !== module) {
  module.exports = {
    bridgeHandler,
    _test: {
      isGemini,
      isGlmHost,
      isLocalHost,
      parseUpstreamUrl,
      resolveConfig,
      geminiThinkingConfig,
      geminiRequest,
      openaiRequest,
      assembleCalls,
      sanitizeArgs,
      validateExtensionPayload,
      readMarketplaceCatalog,
      publishMarketplaceExtension,
      deleteMarketplaceExtension
    }
  };
  return;
}

const server = http.createServer(bridgeHandler);
server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error('\nPort ' + PORT + ' sudah dipakai — bridge lain masih jalan?');
    console.error('  ss -ltnp | grep ' + PORT + '   # lihat PID pemegang port');
    process.exit(1);
  }
  throw err;
});
server.listen(PORT, '0.0.0.0', () => {
  console.log('minisketch ai-bridge (policy-free proxy) on http://localhost:' + PORT);
  console.log('  policy (prompt/tools/skills) lives in ai/ on the frontend.');
});
