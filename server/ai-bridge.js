// MiniSketch AI bridge: optional local server that proxies chat to an
// OpenAI-compatible LLM. The browser (file://) can never hold the API key,
// so this tiny Node server holds it and only forwards validated tool calls.
//
// Run:  node server/ai-bridge.js   (defaults below are used when env is empty;
//   OPENAI_BASE_URL / OPENAI_API_KEY / MODEL env vars still override them)
// Then open MiniSketch settings and set AI bridge URL to http://localhost:8787.

'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Optional server/.env (KEY=VALUE per line, # comments). Loaded first so the
// real environment can still override anything in the file.
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m || line.trim().startsWith('#')) continue;
      if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    console.log('ai-bridge: loaded server/.env');
  }
} catch (err) { /* no .env: run on the built-in defaults */ }

const PORT = +(process.env.AI_BRIDGE_PORT || 8787);

// The API key belongs to whoever RUNS MiniSketch — it is not this project's
// to ship. It arrives three ways, in this order:
//   1. with the request  (the app sends the user's own key; nothing is kept)
//   2. bridge settings  (POST /api/settings, kept in memory only)
//   3. the environment   (OPENAI_API_KEY in server/.env — a self-hosted
//                         bridge for one person)
// There is deliberately NO built-in default: a key baked into the source is a
// key that leaks with the source.
let KEY = process.env.OPENAI_API_KEY || '';
let BASE = process.env.OPENAI_BASE_URL || '';
let MODEL = process.env.MODEL || process.env.OPENAI_MODEL || '';

// Settings the user pushed to the bridge (in memory; gone when it restarts).
let userSettings = { baseUrl: '', apiKey: '', model: '' };

// ---- CORS ---------------------------------------------------------------
// The bridge spends an API key, so a random web page must not be able to
// reach it. Only the pages that are meant to talk to the bridge are allowed:
// the app itself (a file:// page sends Origin: null), a MiniSketch served
// from any local port, and a private LAN address (the phone or tablet
// talking to this PC). AI_ALLOWED_ORIGINS adds exact origins on top.
const EXTRA_ORIGINS = (process.env.AI_ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

function originAllowed(origin) {
  if (!origin) return true;            // no Origin header: not a browser page
  if (origin === 'null') return true;  // a local file — that IS the app
  if (EXTRA_ORIGINS.indexOf(origin) >= 0) return true;
  try {
    const h = new URL(origin).hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
    if (/^10\./.test(h) || /^192\.168\./.test(h)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  } catch (err) { return false; }
  return false;
}

let TOOLS = [];
let SYSTEM = '';
let SKILLS = [];                         // {name, trigger:[words], body}
try {
  TOOLS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'ai', 'tools.json'), 'utf8')).tools || [];
} catch (err) { console.warn('ai-bridge: tools.json not found, running without tools'); }
try {
  SYSTEM = fs.readFileSync(path.join(__dirname, '..', 'ai', 'system-prompt.txt'), 'utf8');
} catch (err) { SYSTEM = 'You drive MiniSketch, a 2D CAD sketcher. Reply in Indonesian.'; }
// Domain recipes: injected into the system prompt ONLY when the user's message
// matches a skill's trigger words — domain knowledge without prompt bloat.
try {
  const dir = path.join(__dirname, '..', 'ai', 'skills');
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.md'))) {
    const raw = fs.readFileSync(path.join(dir, f), 'utf8');
    const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!m) continue;
    const meta = {};
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^(\w+):\s*(.+)$/);
      if (kv) meta[kv[1]] = kv[2].trim();
    }
    SKILLS.push({
      name: meta.name || f.replace(/\.md$/, ''),
      trigger: (meta.trigger || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
      body: m[2].trim()
    });
  }
  console.log('ai-bridge: ' + SKILLS.length + ' skill(s) loaded (' + SKILLS.map(s => s.name).join(', ') + ')');
} catch (err) { /* no skills dir: fine */ }

// Pick skills whose trigger words appear in the latest user message, plus any
// the model explicitly requested with use_skill (input.requestedSkills).
function skillsFor(messages, requested) {
  const lastUser = [...(messages || [])].reverse().find(m => m.role === 'user');
  const text = String(lastUser ? lastUser.content : '').toLowerCase();
  const out = [];
  const seen = new Set();
  for (const s of SKILLS) {
    if ((requested || []).includes(s.name) || s.trigger.some(t => text.includes(t))) {
      if (!seen.has(s.name)) { out.push(s); seen.add(s.name); }
    }
  }
  return out;
}

const MAX_OPS = 20;
const KNOWN = new Set(TOOLS.map(t => t.function && t.function.name).filter(Boolean));

function clampNum(v) {
  const n = +v;
  if (!isFinite(n)) return 0;
  return Math.max(-10000, Math.min(10000, n));
}

function sanitizeArgs(name, args) {
  const a = (args && typeof args === 'object') ? JSON.parse(JSON.stringify(args)) : {};
  const walk = (o) => {
    if (Array.isArray(o)) { for (let i = 0; i < o.length; i++) {
      if (typeof o[i] === 'number') o[i] = clampNum(o[i]);
      else if (o[i] && typeof o[i] === 'object') walk(o[i]);
    } }
    else if (o && typeof o === 'object') { for (const k of Object.keys(o)) {
      if (k === 'value' && typeof o[k] === 'number') o[k] = Math.max(-100000, Math.min(100000, o[k]));
      else if (typeof o[k] === 'number') o[k] = clampNum(o[k]);
      else if (o[k] && typeof o[k] === 'object') walk(o[k]);
    } }
  };
  walk(a);
  return a;
}

// One upstream request at a time, and no keep-alive: the provider counts
// OPEN CONNECTIONS as "active sessions" (429 at 5), so every request opens a
// fresh socket and closes it as soon as the response is fully read.
let upstreamBusy = null;
function serializeUpstream(run) {
  const next = (upstreamBusy || Promise.resolve()).then(run, run);
  upstreamBusy = next.catch(() => {});   // the queue never stays rejected
  return next;
}

function postUpstreamOnce(payload, register, cfg) {
  const base = (cfg && cfg.base) || BASE;
  const key = (cfg && cfg.key) || KEY;
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
      // STREAMING (stream:true in the payload): SSE chunks arrive as
      // "data: {...}" lines; reasoning_content and content Deltas are forwarded
      // live to onDelta so the browser panel fills while the model thinks.
      let buf = '';
      const assembled = { role: 'assistant', content: '', reasoning_content: '', tool_calls: [] };
      const tcBuf = {};                  // index -> {name, arguments}
      const finish = (err) => {
        if (err) return reject(err);
        // assemble tool_calls from deltas
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
    // Idle timeout, NOT total-time: the socket must show activity every 60 s
    // or it is genuinely hung (freed immediately). A reasoning model that is
    // legitimately streaming/thinking for minutes keeps resetting the timer on
    // every packet, so long answers are never killed. The old fixed 120 s cap
    // murdered slow-but-healthy calls with "upstream timeout after 120s".
    req.setTimeout(60000, () => req.destroy(new Error('upstream idle >60s — connection closed')));
    req.on('error', reject);
    if (register) register(req);         // caller can abort when its client leaves
    req.write(body);
    req.end();
  });
}

// Sessions the provider counts are OPEN SOCKETS: every path must close them.
//  - upstream timeout (above): hung connections are destroyed after 120 s
//  - client disconnect (browser refresh / New chat): the upstream request is
//    aborted immediately, its session frees at once
//  - in-flight counter in the log makes any leak visible at a glance
let upstreamInFlight = 0;

// 429 (session/rate limit) waits once and retries — the provider frees
// sessions within seconds, and a failed round is expensive to redo by hand.
function postUpstream(payload, register, cfg) {
  return serializeUpstream(async () => {
    upstreamInFlight++;
    if (upstreamInFlight > 1) console.log('  WARNING: ' + upstreamInFlight + ' upstream requests in flight (should never exceed 1)');
    try {
      try {
        return await postUpstreamOnce(payload, register, cfg);
      } catch (err) {
        if (!/^upstream 429/.test(String(err && err.message))) throw err;
        console.log('  upstream 429: waiting 6s, retrying once…');
        await new Promise(r => setTimeout(r, 6000));
        return await postUpstreamOnce(payload, register, cfg);
      }
    } finally {
      upstreamInFlight--;
    }
  });
}

function bridgeHandler(req, res) {
  // A random web page must not be able to spend the user's API key.
  const origin = req.headers.origin || '';
  if (!originAllowed(origin)) {
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
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      model: userSettings.model || MODEL,
      tools: KNOWN.size,
      hasKey: !!(userSettings.apiKey || KEY),
      // where the bridge would get its values if the app sent none: this is
      // what tells you whether the .env fallback is still in play
      source: {
        base: userSettings.baseUrl ? 'bridge settings' : (BASE ? '.env' : 'none'),
        key: userSettings.apiKey ? 'bridge settings' : (KEY ? '.env' : 'none'),
        model: userSettings.model ? 'bridge settings' : (MODEL ? '.env' : 'none')
      },
      // never the key itself, only whether there is one
      keyLength: (userSettings.apiKey || KEY || '').length
    }));
    return;
  }
  if (req.method === 'GET' && req.url === '/api/tools') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tools: TOOLS }));
    return;
  }
  if (req.method === 'GET' && req.url === '/api/skills') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ skills: SKILLS.map(s => ({ name: s.name, trigger: s.trigger })) }));
    return;
  }
  // The user pushes their own endpoint settings here: the API key, the base
  // URL of an OpenAI-compatible service, and the model name. They are kept in
  // memory only (the bridge forgets them when it stops) and the key is never
  // echoed back.
  if (req.method === 'POST' && req.url === '/api/settings') {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 64 * 1024) req.destroy(); });
    req.on('end', () => {
      try {
        const s = JSON.parse(raw || '{}');
        if (typeof s.baseUrl === 'string') userSettings.baseUrl = s.baseUrl.trim();
        if (typeof s.apiKey === 'string') userSettings.apiKey = s.apiKey.trim();
        if (typeof s.model === 'string') userSettings.model = s.model.trim();
        console.log('  settings pushed: base=' + (userSettings.baseUrl || '(none)') +
          ' model=' + (userSettings.model || '(none)') +
          ' key=' + (userSettings.apiKey ? 'set' : 'none'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          hasKey: !!(userSettings.apiKey || KEY),
          model: userSettings.model || MODEL,
          baseUrl: userSettings.baseUrl || BASE
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad settings json' }));
      }
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/api/chat') {
    const t0 = Date.now();
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 256 * 1024) req.destroy(); });
    req.on('end', async () => {
      try {
        const input = JSON.parse(raw || '{}');
        const messages = Array.isArray(input.messages) ? input.messages : [];
        const stateSummary = input.stateSummary || null;
        const agent = input.agent || {};
        const lastUser = [...messages].reverse().find(m => m.role === 'user');
        console.log('\n=== chat request ' + new Date().toLocaleTimeString() + ' ===');
        console.log('  round      : ' + (agent.round || 1) + '/' + (agent.maxRounds || '?'));
        console.log('  messages   : ' + messages.length);
        console.log('  user says  : ' + String(lastUser ? lastUser.content : '(none)').replace(/\s+/g, ' ').slice(0, 160));
        if (stateSummary) console.log('  document   : ' + (stateSummary.entities || 0) + ' entities, ' +
          (stateSummary.loops || []).length + ' loops, selection ' + (stateSummary.selection || []).length);
        let sys = SYSTEM + (stateSummary
          ? '\n\nCURRENT DOCUMENT (world mm, Y-up):\n' + JSON.stringify(stateSummary).slice(0, 4000)
          : '');
        const active = skillsFor(messages, input.requestedSkills);
        if (active.length) {
          console.log('  skills     : ' + active.map(s => s.name).join(', '));
          sys += '\n\n' + active.map(s =>
            '=== ACTIVE SKILL: ' + s.name + ' ===\n' + s.body).join('\n\n');
        }
        // The user's own endpoint settings: what came with THIS request wins,
        // then the settings pushed to the bridge, then the environment.
        const rs = (input && input.settings) || {};
        const cfg = {
          base: String(rs.baseUrl || userSettings.baseUrl || BASE || '').replace(/\/+$/, ''),
          key: String(rs.apiKey || userSettings.apiKey || KEY || '').trim(),
          model: String(rs.model || userSettings.model || MODEL || '').trim()
        };
        // where each piece came from — the log has to say it, or a run that
        // silently uses the .env key looks like the Settings key was used
        const keyFrom = rs.apiKey ? 'request' : (userSettings.apiKey ? 'bridge settings' : '.env');
        const baseFrom = rs.baseUrl ? 'request' : (userSettings.baseUrl ? 'bridge settings' : '.env');
        const modelFrom = rs.model ? 'request' : (userSettings.model ? 'bridge settings' : '.env');
        if (!cfg.key || !cfg.base) {
          console.log('  no API key: set it in MiniSketch Settings (AI API key), or on the bridge');
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'No API key. Set "AI API key" in MiniSketch Settings, or start the bridge with OPENAI_API_KEY in server/.env.'
          }));
          return;
        }
        console.log('  -> upstream: model=' + (cfg.model || '(provider default)') + ' (' + modelFrom + ')' +
          ' base=' + cfg.base + ' (' + baseFrom + ')' +
          ' key=' + keyFrom + ' tools=' + TOOLS.length);
        // If the browser truly drops mid-flight (refresh, tab close), abort the
        // upstream request so its session frees at once. Detection MUST use the
        // RESPONSE 'close' (writableEnded=false): the request's own 'close'
        // fires as soon as its body is read — milliseconds in — and would abort
        // every healthy call.
        let upstreamReq = null;
        let clientGone = false;
        res.on('close', () => {
          if (res.writableEnded) return;     // normal completion, not a drop
          clientGone = true;
          console.log('  browser dropped the connection (refresh/close?) — aborting upstream so its session frees');
          if (upstreamReq) upstreamReq.destroy(new Error('client disconnected'));
        });
        // Ask GLM-family models to ALWAYS return their reasoning, and STREAM
        // the answer: reasoning deltas are forwarded to the browser live
        // (SSE below), so the "pikiran model" panel fills while it thinks.
        const basePayload = {
          model: cfg.model || undefined,
          messages: [{ role: 'system', content: sys }, ...messages.slice(-20)],
          tools: TOOLS,
          tool_choice: 'auto',
          stream: true
        };
        // SSE to the browser: live reasoning/content deltas, then a final JSON
        // event with the assembled tool_calls (same shape the old non-stream
        // response had, so chat.js needs one reader for both phases).
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });
        const send = (obj) => {
          try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); }
          catch (err) { /* client gone: the close handler aborts upstream */ }
        };
        basePayload.onDelta = (d) => send({ delta: d });   // stripped before JSON (see postUpstreamOnce)
        let upstream;
        try {
          upstream = await postUpstream({
            ...basePayload,
            thinking: { type: 'enabled' }
          }, (r) => { upstreamReq = r; }, cfg);
        } catch (err) {
          if (clientGone) {
            console.log('  upstream aborted (client gone) — nothing to answer');
            return;
          }
          if (!/^upstream 400/.test(String(err && err.message))) throw err;
          console.log('  upstream rejected the thinking flag — retrying without it');
          upstream = await postUpstream(basePayload, (r) => { upstreamReq = r; }, cfg);
        }
        const msg = (upstream.choices && upstream.choices[0] && upstream.choices[0].message) || {};
        // reasoning models (deepseek-r1 style) return their chain of thought in
        // a separate field; surface it so the user can follow/correct the plan
        const think = String(msg.reasoning_content || msg.reasoning || '');
        const calls = (msg.tool_calls || []).slice(0, MAX_OPS)
          .filter(tc => tc && tc.function && KNOWN.has(tc.function.name))
          // de-dup: z.ai sometimes repeats the final delta chunk, which would
          // double-register the same call and run it twice
          .filter((tc, i, arr) => arr.findIndex(x =>
            x.function.name === tc.function.name && x.function.arguments === tc.function.arguments) === i)
          .map(tc => {
            let args = {};
            try { args = JSON.parse(tc.function.arguments || '{}'); } catch (err) { args = {}; }
            return { name: tc.function.name, arguments: sanitizeArgs(tc.function.name, args) };
          });
        console.log('  <- model   : ' + (Date.now() - t0) + ' ms');
        if (think) console.log('  thinking   : ' + think.replace(/\s+/g, ' ').slice(0, 500) + (think.length > 500 ? '…' : ''));
        if (msg.content) console.log('  says       : ' + String(msg.content).replace(/\s+/g, ' ').slice(0, 300));
        if (calls.length) {
          for (const c of calls) {
            console.log('  tool_call  : ' + c.name + '(' + JSON.stringify(c.arguments).slice(0, 220) + ')');
          }
        } else {
          console.log('  tool_call  : (none — model is done)');
        }
        // final event carries the assembled result (deltas already streamed)
        send({ done: true, reply: msg.content || '', thinking: think.slice(0, 4000), tool_calls: calls });
        res.end();
      } catch (err) {
        // a disconnected client can no longer receive anything: do not attempt
        // to write headers on a dead socket (would throw ERR_HTTP_HEADERS_SENT)
        if (res.writableEnded || res.headersSent) {
          console.log('  (response already closed: ' + String(err && err.message || err).slice(0, 120) + ')');
          try { res.end(); } catch (e2) { /* socket already gone */ }
          return;
        }
        console.log('  ERROR      : ' + String(err && err.message || err).slice(0, 300));
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err && err.message || err) }));
      }
      return;
    });
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
}

if (require.main !== module) {
  module.exports = { bridgeHandler };
  return;
}

const server = http.createServer(bridgeHandler);

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error('');
    console.error('Port ' + PORT + ' sudah dipakai — kemungkinan ada ai-bridge lain yang masih jalan.');
    console.error('Cari dan matikan proses lama, lalu jalankan lagi:');
    console.error('  ss -ltnp | grep ' + PORT + '          # lihat PID pemegang port');
    console.error('  pkill -f "node server/ai-bridge.js"   # atau: kill <PID>');
    console.error('Kalau yang jalan memang instance ini di terminal lain, gunakan itu saja.');
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log('minisketch ai-bridge on http://localhost:' + PORT + ' model=' + MODEL + ' tools=' + KNOWN.size);
});
