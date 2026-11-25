'use strict';
// MiniSketch AI bridge — a POLICY-FREE streaming proxy.
//
// All the POLICY (system prompt, tool manifest, domain skills) now lives on the
// FRONTEND (ai/prompt.js + ai/system-prompt.txt + ai/tools.json + ai/skills.js).
// The frontend assembles the full `messages` (system message first) and the
// `tools` array and sends them here; this server just forwards them to an
// OpenAI-compatible endpoint and streams the reply back.
//
// TWO providers, one wire protocol:
//   • OpenAI-compatible (the default): forwards `messages`/`tools` straight to
//     {base}/chat/completions and re-assembles the SSE deltas.
//   • Google Gemini (auto-detected from the base URL — generativelanguage.*):
//     translates OpenAI-style messages/tools to Gemini contents/function
//     declarations, streams `alt=sse`, maps `thought:true` parts to thinking
//     deltas and `functionCall` parts to tool_calls. No frontend change needed:
//     the browser still talks OpenAI shape in and out.
//
// Why: tuning the prompt or tools no longer needs a server restart OR a rebuild
// of the KaryaCNC Go proxy — edit a static file, refresh. Both backends (this
// Node one and the Go one in KaryaCNC) are interchangeable policy-free streams.
//
// Run:  node server/ai-bridge.js     (default port 8090; PORT / AI_BRIDGE_PORT override)
// Optional env: AI_BRIDGE_PORT / PORT (listen), AI_ALLOWED_ORIGINS (extra CORS).
// The API key / base URL / model come from the FRONTEND with each request
// (Settings › AI chat). Nothing is stored here.

const http = require('http');
const https = require('https');

const PORT = +(process.env.PORT || process.env.AI_BRIDGE_PORT || 8090);

// Idle timeout for the upstream provider socket: any packet from the provider
// resets it, so a long reasoning stream is never killed — only a provider that
// stays silent this long is considered hung. Provider queues can sit idle
// >60 s, so the default is generous and configurable via AI_UPSTREAM_IDLE_S
// (seconds). 0 disables the idle timeout entirely.
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

function postUpstreamOnce(payload, register, cfg) {
  const base = normalizeBase(cfg.base);
  const key = cfg.key;
  return new Promise((resolve, reject) => {
    if (!base || !key) return reject(new Error('missing API key or base URL'));
    const url = new URL(base + '/chat/completions');
    const lib = url.protocol === 'https:' ? https : http;
    const body = JSON.stringify(payload);
    const req = lib.request(url, {
      method: 'POST',
      agent: false,                      // no socket pooling: close after each response
      headers: {
        'Content-Type': 'application/json',
        'Connection': 'close',
        'Accept': 'text/event-stream',
        'Authorization': 'Bearer ' + key,
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      // STREAMING (stream:true): SSE "data: {...}" lines. reasoning_content and
      // content deltas are forwarded live to onDelta so the browser panel fills
      // while the model thinks; tool_calls are assembled from their deltas.
      let buf = '';
      const assembled = { role: 'assistant', content: '', reasoning_content: '', tool_calls: [] };
      const tcBuf = {};                  // index -> {name, arguments}
      const finish = (err) => {
        if (err) return reject(err);
        for (const k of Object.keys(tcBuf)) {
          const t = tcBuf[k];
          assembled.tool_calls.push({
            function: { name: t.name || '', arguments: t.arguments || '' }
          });
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error('upstream ' + res.statusCode + ': ' + buf.slice(-500)));
        }
        resolve({ choices: [{ message: assembled }], _raw: true });
      };
      res.on('data', (c) => {
        buf += c.toString();
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') return finish();
          let j;
          try { j = JSON.parse(data); } catch (err) { continue; }
          const d = (j.choices && j.choices[0] && j.choices[0].delta) || {};
          if (d.reasoning_content) {
            assembled.reasoning_content += d.reasoning_content;
            if (payload.onDelta) payload.onDelta({ thinking: d.reasoning_content });
          }
          if (d.content) {
            assembled.content += d.content;
            if (payload.onDelta) payload.onDelta({ content: d.content });
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
    });
    // Idle timeout, NOT total-time: the socket must show activity every
    // UPSTREAM_IDLE_MS (default 300 s) or it is genuinely hung. A reasoning
    // model streaming for minutes keeps resetting this on every packet, so
    // long answers are never killed. Slow provider queues get headroom; set
    // AI_UPSTREAM_IDLE_S to tune.
    req.setTimeout(UPSTREAM_IDLE_MS, () => req.destroy(new Error(
      'upstream idle >' + (UPSTREAM_IDLE_MS / 1000) + 's — connection closed')));
    req.on('error', reject);
    if (register) register(req);         // caller aborts when its client leaves
    req.write(body);
    req.end();
  });
}

// ---- Google Gemini adapter ------------------------------------------------
// The frontend speaks OpenAI shape (messages/tools, SSE {delta:{thinking|content}}
// then {done, reply, thinking, tool_calls}); Gemini speaks its own protocol. This
// adapter is the ONLY piece that knows about Gemini; everything upstream of it
// (chat.js) stays identical. Detected automatically from the base URL.
const GEMINI_HOST_RE = /generativelanguage\.googleapis\.com|generativelanguage\.google\.com/i;
function isGemini(base) { return GEMINI_HOST_RE.test(String(base || '')); }

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
  if (input.thinking !== false) body.thinkingConfig = { includeThinking: true };
  // NOTE: no generationConfig here — hardcoding maxOutputTokens etc. has caused
  // 400s on models with stricter limits. Provider defaults are safest.
  return body;
}

// Stream from Gemini REST. Resolves { content, reasoning, calls } where calls
// are already {name, arguments:{}} (Gemini sends complete functionCall parts).
function postGeminiOnce(payload, register, cfg) {
  const base = normalizeBase(cfg.base);
  const key = cfg.key;
  return new Promise((resolve, reject) => {
    if (!base || !key) return reject(new Error('missing API key or base URL'));
    const model = encodeURIComponent(cfg.model || 'gemini-2.5-flash');
    const root = base.replace(/\/v1beta?$/, '');
    const url = new URL(root + '/v1beta/models/' + model + ':streamGenerateContent?alt=sse');
    const lib = url.protocol === 'https:' ? https : http;
    const body = JSON.stringify(payload);
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
      let failed = false;
      let events = 0;
      const t0 = Date.now();
      const state = { content: '', reasoning: '', calls: [] };
      // Liveness logging: a long reasoning stream is normal, but an idle one is
      // not — show that we are still receiving data.
      const liveness = setInterval(() => {
        const secs = Math.round((Date.now() - t0) / 1000);
        console.log('  [gemini] live ' + secs + 's · events=' + events +
          ' · sang=' + Math.round((state.reasoning.length + state.content.length) / 1024) + 'KB');
      }, 20000);
      const stopLiveness = () => clearInterval(liveness);
      const finish = (err) => {
        if (failed) return stopLiveness();
        stopLiveness();
        if (err) { failed = true; return reject(err); }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          // Surface the provider's REAL error text — never swallow it.
          let msg = (rawBody || buf).trim();
          try {
            const j = JSON.parse(msg);
            if (j.error) msg = j.error.message || j.error.status || msg;
          } catch (e) { /* keep raw text */ }
          if (!msg) msg = '(empty response body, status ' + res.statusCode + ')';
          failed = true;
          return reject(new Error('upstream ' + res.statusCode + ': ' + msg.slice(0, 600)));
        }
        resolve(state);
      };
      res.on('data', (c) => {
        const s = c.toString();
        buf += s;
        rawBody += s;
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
          const cand = (j.candidates || [])[0];
          if (!cand || !cand.content || !Array.isArray(cand.content.parts)) continue;
          for (const part of cand.content.parts) {
            if (!part) continue;
            if (part.thought) {
              state.reasoning += part.text || '';
              if (payload.onDelta) payload.onDelta({ thinking: part.text || '' });
            } else if (typeof part.text === 'string' && part.text) {
              state.content += part.text;
              if (payload.onDelta) payload.onDelta({ content: part.text });
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
    // Idle timeout (same reasoning as OpenAI adapter): a thinking model
    // streaming for minutes keeps resetting this on every packet. Default
    // 300 s, tunable via AI_UPSTREAM_IDLE_S.
    req.setTimeout(UPSTREAM_IDLE_MS, () => req.destroy(new Error(
      'upstream idle >' + (UPSTREAM_IDLE_MS / 1000) + 's — connection closed')));
    req.on('error', (err) => reject(err));
    if (register) register(req);         // caller aborts when its client leaves
    req.write(body);
    req.end();
  });
}

// 429 (session/rate limit) waits once and retries — the provider frees sessions
// within seconds, and a failed round is expensive to redo by hand.
function postUpstream(payload, register, cfg) {
  const runOnce = isGemini(cfg.base) ? postGeminiOnce : postUpstreamOnce;
  return serializeUpstream(async () => {
    try {
      try {
        return await runOnce(payload, register, cfg);
      } catch (err) {
        if (!/^upstream 429/.test(String(err && err.message))) throw err;
        console.log('  upstream 429: waiting 6s, retrying once…');
        await new Promise(r => setTimeout(r, 6000));
        return await runOnce(payload, register, cfg);
      }
    } catch (err) {
      throw err;
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

// ---- the single endpoint: POST /api/chat ----------------------------------
function bridgeHandler(req, res) {
  const origin = req.headers.origin || '';
  if (!originAllowed(origin, req)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'origin not allowed: ' + origin }));
    return;
  }
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && req.url === '/health') {
    // Liveness only — the bridge holds no key/model/state of its own now.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, proxy: true }));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/chat') {
    const t0 = Date.now();
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 8 * 1024 * 1024) req.destroy(); });
    req.on('end', async () => {
      let clientGone = false;
      res.on('close', () => {
        if (res.writableEnded) return;     // normal completion, not a drop
        clientGone = true;
      });
      try {
        const input = JSON.parse(raw || '{}');
        const messages = Array.isArray(input.messages) ? input.messages : [];
        const tools = Array.isArray(input.tools) ? input.tools : [];
        const rs = (input && input.settings) || {};
        const cfg = {
          base: normalizeBase(rs.baseUrl || ''),
          key: String(rs.apiKey || '').trim(),
          model: String(rs.model || '').trim()
        };
        const lastUser = [...messages].reverse().find(m => m && m.role === 'user');
        const gemini = isGemini(cfg.base);
        console.log('\n=== chat ' + new Date().toLocaleTimeString() + ' ===' +
          ' msgs=' + messages.length + ' tools=' + tools.length +
          ' model=' + (cfg.model || '(provider default)') +
          ' base=' + (cfg.base || '(none)') + (gemini ? ' [gemini adapter]' : ''));
        console.log('  user says: ' + describeMessage(lastUser));
        if (!cfg.key || !cfg.base) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'No API key or base URL. Set "AI API base URL" and "AI API key" in Settings › AI chat.'
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
        const send = (obj) => {
          try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); }
          catch (err) { /* client gone: the close handler flags it */ }
        };

        // The frontend owns the prompt/tools; the only transport-level nicety is
        // asking for streamed reasoning. Gemini asks for it via thinkingConfig
        // (2.5+); GLM-family OpenAI endpoints take a `thinking` flag. If the
        // provider rejects the flag (400), retry without it.
        const basePayload = {
          model: cfg.model || undefined,
          messages,
          tools,
          tool_choice: 'auto',
          stream: true
        };

        // The frontend sends a reasoning LEVEL: 'off' | 'low' | 'normal'.
        //   off    -> no reasoning at all (cheapest, fastest)
        //   low    -> short reasoning; OpenAI-compatible providers also get
        //             reasoning_effort=low (GLM/z.ai-style endpoints accept it
        //             and cut their long thinking time)
        //   normal -> full reasoning (default)
        // If the provider rejects the extra field (400), retry without it.
        const wantThink = input.thinking !== 'off';
        const lowThink = input.thinking === 'low';
        const thinkOpts = wantThink ? { thinking: { type: 'enabled' } } : {};
        const lowOpts = lowThink ? { reasoning_effort: 'low' } : {};

        // When the browser aborts (Stop button / tab closed), destroy the
        // upstream request too — a paid stream must not keep running.
        const abortUp = (r) => { if (r && clientGone) r.destroy(); };

        let upstream;
        try {
          try {
            const p = gemini
              ? geminiRequest({ messages, tools, thinking: wantThink }, cfg)
              : { ...basePayload, ...thinkOpts, ...lowOpts };
            p.onDelta = (d) => send({ delta: d });
            upstream = await postUpstream(p, abortUp, cfg);
          } catch (err) {
            if (clientGone) return;
            if (!/^upstream 400/.test(String(err && err.message))) throw err;
            console.log('  upstream rejected the thinking flag — retrying without it');
            const p2 = gemini
              ? geminiRequest({ messages, tools, thinking: false }, cfg)
              : { ...basePayload };
            p2.onDelta = (d) => send({ delta: d });
            upstream = await postUpstream(p2, abortUp, cfg);
          }
        } catch (err) {
          if (clientGone) return;
          let text = String(err && err.message || err);
          if (/is not found|not found for API version/i.test(text)) {
            text = 'Model tidak ditemukan di provider — periksa nama/versi model (untuk Gemini: tombol "Muat daftar model" di Settings). Pesan provider: ' + text;
          }
          console.log('  ERROR: ' + text.slice(0, 300));
          // The 200 status line is already on the wire, so the failure travels
          // as an event on the same stream (an HTTP error body would never be
          // read; the chat would just hang on "…").
          send({ error: text });
          res.end();
          return;
        }

        // Frontend owns tool filtering/validation (it knows the executor's ops);
        // we just hand back the raw assembled calls in the shape chat.js reads.
        // Gemini resolves {content, reasoning, calls}; OpenAI resolves {choices}.
        const msg = gemini ? null : ((upstream.choices && upstream.choices[0] && upstream.choices[0].message) || {});
        const reply = gemini ? String(upstream.content || '') : String((msg && msg.content) || '');
        const think = gemini ? String(upstream.reasoning || '') : String((msg && (msg.reasoning_content || msg.reasoning)) || '');
        const rawCalls = gemini ? upstream.calls : ((msg && msg.tool_calls) || []);
        // Sanitize args (clamp numbers), drop unnamed calls, de-dup (some
        // providers repeat the final chunk, which would run an op twice) and cap
        // the count — parity with the Go proxy's assembleAIToolCalls.
        const calls = assembleCalls(rawCalls);
        console.log('  <- model: ' + (Date.now() - t0) + ' ms (gemini=' + gemini + '), tool_calls=' + calls.length);
        send({ done: true, reply, thinking: think.slice(0, 4000), tool_calls: calls });
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

  // ---- helper: POST /api/models (provider model list) ------------------
  // Lists the models the key can actually call, so Settings can offer a
  // dropdown instead of guessing names. Works for:
  //   • Google Gemini — ListModels (x-goog-api-key).
  //   • any OpenAI-compatible provider — GET {base}/models with Bearer auth
  //     (the standard /models endpoint; data[].id).
  if (req.method === 'POST' && req.url === '/api/models') {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 256 * 1024) req.destroy(); });
    req.on('end', () => {
      let input = {};
      try { input = JSON.parse(raw || '{}'); } catch (err) { input = {}; }
      const rs = (input && input.settings) || {};
      const cfg = {
        base: normalizeBase(rs.baseUrl || ''),
        key: String(rs.apiKey || '').trim()
      };
      if (!cfg.base) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Base URL kosong — pilih provider atau isi AI API base URL.' }));
        return;
      }
      if (!cfg.key) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Isi dulu AI API key.' }));
        return;
      }
      const root = cfg.base.replace(/\/v1beta?$/, '');
      const gemini = isGemini(cfg.base);
      const url = new URL(gemini ? root + '/v1beta/models' : root + '/models');
      const lib = url.protocol === 'https:' ? https : http;
      const req2 = lib.request(url, {
        method: 'GET',
        agent: false,
        headers: {
          'Accept': 'application/json',
          ...(gemini ? { 'x-goog-api-key': cfg.key } : { 'Authorization': 'Bearer ' + cfg.key })
        }
      }, (r2) => {
        let out = '';
        r2.on('data', c => { out += c; });
        r2.on('end', () => {
          if (r2.statusCode < 200 || r2.statusCode >= 300) {
            let msg = out.slice(0, 400);
            try { const j = JSON.parse(out); if (j.error && j.error.message) msg = j.error.message; } catch (e) {}
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: msg }));
            return;
          }
          let names = [];
          try {
            const j = JSON.parse(out);
            if (gemini) {
              names = (j.models || [])
                .filter(m => m && Array.isArray(m.supportedGenerationMethods) &&
                  m.supportedGenerationMethods.indexOf('generateContent') >= 0)
                .map(m => m.name.replace(/^models\//, ''));
            } else {
              // OpenAI standard: { data: [{ id, ... }] }
              names = (j.data || []).map(m => m && m.id).filter(Boolean);
              if (!names.length && Array.isArray(j.models)) names = j.models.map(m => m && m.id).filter(Boolean);
            }
            names = names.filter((v, i, a) => a.indexOf(v) === i).sort();
          } catch (err) { /* fall through empty */ }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ models: names.slice(0, 300) }));
        });
      });
      req2.setTimeout(30000, () => req2.destroy(new Error('ListModels timeout')));
      req2.on('error', (err) => {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err && err.message || err) }));
      });
      req2.end();
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
}

if (require.main !== module) {
  module.exports = { bridgeHandler, _test: { isGemini, geminiRequest, assembleCalls, sanitizeArgs } };
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
  console.log('  policy (prompt/tools/skills) now lives in ai/ on the frontend.');
});
