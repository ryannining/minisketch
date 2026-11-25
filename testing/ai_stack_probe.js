// Comprehensive probe for the upgraded MiniSketch AI stack:
//   - server/ai-bridge.js (thinking levels, Gemini generationConfig.thinkingConfig,
//     OpenAI/GLM/local hosts, SVG empty-tools omission, usage forwarding, URL validation,
//     real upstream socket abort on client close, CORS & no secret leaks)
//   - ai/prompt.js + ai/system-prompt.txt + ai/tools.json + ai/skills.js
//     (multimodal skill matching, boolean cut target-first alignment, slim prompt,
//     new rotate/mirror/duplicate tool schemas)
//   - ai/chat.js (queryResults feedback, use_skill round-2 injection, 1-Undo noHistory
//     across rounds, restored add_note, new CAD transforms, live delta.content streaming,
//     custom bridgeUrl in fetchProviderModels, zero window.open)
//   - app.js (rotateSelection, mirrorSelection with arc s/e swap, duplicateSelection,
//     Test Koneksi & quick controls wiring)
//   - server/serve.js (port 8090 preserved)
//
// Run: node testing/ai_stack_probe.js
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const { EventEmitter } = require('events');

const ROOT = path.join(__dirname, '..');
const bridgeSrc = fs.readFileSync(path.join(ROOT, 'server', 'ai-bridge.js'), 'utf8');
const serveSrc = fs.readFileSync(path.join(ROOT, 'server', 'serve.js'), 'utf8');
const chatSrc = fs.readFileSync(path.join(ROOT, 'ai', 'chat.js'), 'utf8');
const promptSrc = fs.readFileSync(path.join(ROOT, 'ai', 'prompt.js'), 'utf8');
const skillsSrc = fs.readFileSync(path.join(ROOT, 'ai', 'skills.js'), 'utf8');
const sysPrompt = fs.readFileSync(path.join(ROOT, 'ai', 'system-prompt.txt'), 'utf8');
const toolsManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'ai', 'tools.json'), 'utf8'));
const appSrc = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

process.env.OPENAI_API_KEY = '';
process.env.OPENAI_BASE_URL = '';
process.env.GEMINI_API_KEY = '';
delete process.env.OPENAI_MODEL;
delete process.env.MODEL;

const { bridgeHandler, _test } = require(path.join(ROOT, 'server', 'ai-bridge.js'));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? ' -> ' + extra : '')); }
}

function callBridge(method, url, headers, body) {
  return new Promise((resolve) => {
    const res = Object.assign(new EventEmitter(), {
      statusCode: 0,
      headers: {},
      body: '',
      headersSent: false,
      writableEnded: false,
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      writeHead(code, h) {
        this.statusCode = code;
        this.headersSent = true;
        if (h) for (const [k, v] of Object.entries(h)) this.headers[k.toLowerCase()] = v;
        return this;
      },
      write(chunk) { this.body += String(chunk); return true; },
      end(chunk) { if (chunk) this.body += String(chunk); this.writableEnded = true; resolve(this); }
    });
    const req = new EventEmitter();
    req.method = method;
    req.url = url;
    req.headers = headers || {};
    req.destroy = () => {};
    bridgeHandler(req, res);
    setImmediate(() => {
      if (body != null) req.emit('data', Buffer.from(body));
      req.emit('end');
    });
  });
}

(async () => {
  console.log('\n== 1. Port 8090 & Policy/Prompt Consistency ==');
  check('serve.js default port remains 8090', /process\.env\.PORT \|\| 8090/.test(serveSrc));
  check('system-prompt.txt is slim (< 8 KB)', Buffer.byteLength(sysPrompt, 'utf8') < 8192, Buffer.byteLength(sysPrompt, 'utf8') + ' bytes');
  check('system-prompt.txt has no console.log debug leak', !/console\.log/.test(sysPrompt));
  check('system-prompt.txt has no dijkstra typo', !/dijkstra/i.test(sysPrompt));
  check('system-prompt.txt boolean cut says target first, tool last', /TARGET loop FIRST.*TOOL.*LAST/i.test(sysPrompt));
  check('skills.js stencil-bridges says set_selection [E, U] (target first)', /set_selection \[E, U\]/.test(skillsSrc));
  const boolTool = toolsManifest.tools.find(t => t.function && t.function.name === 'boolean');
  check('tools.json boolean says target first, tool last', boolTool && /TARGET loop FIRST.*TOOL.*LAST/i.test(boolTool.function.description));
  const polyTool = toolsManifest.tools.find(t => t.function && t.function.name === 'add_polyline');
  check('tools.json add_polyline uses #ff0000 for score lines (not #0000ff)',
    polyTool && polyTool.function.description.includes('#ff0000') && !polyTool.function.description.includes('#0000ff'));
  const chatOps = new Set([...chatSrc.matchAll(/case '([a-z_]+)':/g)].map(m => m[1]));
  for (const name of ['rotate_selection', 'mirror_selection', 'duplicate_selection', 'add_note']) {
    check('tools.json + chat.js both implement ' + name,
      toolsManifest.tools.some(t => t.function && t.function.name === name) && chatOps.has(name));
  }
  check('ai/chat.js restores add_note -> api.addNote', /case 'add_note':[\s\S]{0,300}api\.addNote\(/.test(chatSrc));
  check('ai/chat.js has zero window.open calls', !/window\.open\s*\(/.test(chatSrc));
  check('ai/chat.js fetchProviderModels uses bridgeUrl()', /fetch\(ep \+ '\/api\/models'/.test(chatSrc));

  console.log('\n== 2. Bridge Adapter & Security Checks ==');
  {
    const g4Low = _test.geminiRequest({ messages: [{ role: 'user', content: 'hi' }], thinking: 'low' }, { model: 'gemini-4-hydrogen' });
    check('Gemini 4 low uses generationConfig.thinkingConfig.thinkingLevel=LOW + includeThoughts=true',
      g4Low.generationConfig && g4Low.generationConfig.thinkingConfig &&
      g4Low.generationConfig.thinkingConfig.includeThoughts === true &&
      g4Low.generationConfig.thinkingConfig.thinkingLevel === 'LOW' &&
      !g4Low.thinkingConfig);

    const g25Off = _test.geminiRequest({ messages: [{ role: 'user', content: 'hi' }], thinking: 'off' }, { model: 'gemini-2.5-flash' });
    check('Gemini 2.5 Flash off uses generationConfig.thinkingConfig.thinkingBudget=0',
      g25Off.generationConfig && g25Off.generationConfig.thinkingConfig &&
      g25Off.generationConfig.thinkingConfig.thinkingBudget === 0 &&
      g25Off.generationConfig.thinkingConfig.includeThoughts === false);

    const gRetry = _test.geminiRequest({ messages: [{ role: 'user', content: 'hi' }], thinking: false }, { model: 'gemini-4-hydrogen' });
    check('Gemini bare retry omits generationConfig.thinkingConfig', !gRetry.generationConfig);

    const oaSvg = _test.openaiRequest({ messages: [{ role: 'user', content: 'svg' }], tools: [], thinking: 'normal' }, { base: 'https://api.deepseek.com/v1', model: 'deepseek-chat' });
    check('OpenAI SVG mode omits empty tools & tool_choice', oaSvg.tools === undefined && oaSvg.tool_choice === undefined);
    check('Non-GLM OpenAI endpoint does not get GLM thinking flag', oaSvg.thinking === undefined);

    const oaLow = _test.openaiRequest({ messages: [{ role: 'user', content: 'hi' }], tools: [], thinking: 'low' }, { base: 'https://api.openai.com/v1', model: 'o4-mini' });
    check('OpenAI low thinking sends reasoning_effort=low', oaLow.reasoning_effort === 'low');

    const glmNormal = _test.openaiRequest({ messages: [{ role: 'user', content: 'hi' }], tools: [], thinking: 'normal' }, { base: 'https://api.z.ai/api/paas/v4', model: 'glm-4.5' });
    check('GLM host receives thinking.type=enabled', glmNormal.thinking && glmNormal.thinking.type === 'enabled');

    check('isLocalHost allows 127.0.0.1 and rejects api.openai.com',
      _test.isLocalHost('http://127.0.0.1:11434/v1') && !_test.isLocalHost('https://api.openai.com/v1'));

    const evil = await callBridge('POST', '/api/chat', { origin: 'https://evil.example' }, '{}');
    check('Bridge rejects foreign Origin with 403', evil.statusCode === 403);

    const badUrl = await callBridge('POST', '/api/chat', { origin: 'null' }, JSON.stringify({
      messages: [{ role: 'user', content: 'hi' }],
      settings: { baseUrl: 'file:///etc/passwd', apiKey: 'sk-test-123456' }
    }));
    check('Bridge rejects non-http(s) upstream URL with 400', badUrl.statusCode === 400);

    const noKeyRemote = await callBridge('POST', '/api/chat', { origin: 'null' }, JSON.stringify({
      messages: [{ role: 'user', content: 'hi' }],
      settings: { baseUrl: 'https://api.openai.com/v1', apiKey: '' }
    }));
    check('Bridge refuses remote endpoint without API key (400)', noKeyRemote.statusCode === 400);

    const health = await callBridge('GET', '/health', { origin: 'http://localhost:8090' }, null);
    check('/health returns 200 without apiKey field', health.statusCode === 200 && !/apiKey/.test(health.body));
  }

  console.log('\n== 3. Live Mock Upstream: settings.thinking, Usage, Local No-Key, and Stop Abort ==');
  {
    let lastReqBody = null;
    let lastAuthHeader = null;
    let abortObserved = false;
    let hangResolve = null;

    const mockServer = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/v1/models') {
        lastAuthHeader = req.headers.authorization || '';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'local-coder-7b' }] }));
        return;
      }
      let raw = '';
      req.on('data', c => { raw += c; });
      req.on('end', () => {
        lastReqBody = JSON.parse(raw || '{}');
        lastAuthHeader = req.headers.authorization || '';
        if (lastReqBody.model === 'hang-model') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.write('data: {"choices":[{"delta":{"reasoning_content":"step 1"}}]}\n\n');
          req.on('close', () => {
            abortObserved = true;
            if (hangResolve) hangResolve();
          });
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('data: {"choices":[{"delta":{"reasoning_content":"pikir"}}]}\n\n');
        res.write('data: {"choices":[{"delta":{"content":"Halo CAD"}}]}\n\n');
        res.write('data: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":30,"total_tokens":150}}\n\n');
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });

    await new Promise(r => mockServer.listen(0, '127.0.0.1', r));
    const port = mockServer.address().port;
    const localBase = 'http://127.0.0.1:' + port + '/v1';

    // 3a. Local /api/models works with empty API key
    const modRes = await callBridge('POST', '/api/models', { origin: 'http://localhost:8090' }, JSON.stringify({
      settings: { baseUrl: localBase, apiKey: '' }
    }));
    const modJson = JSON.parse(modRes.body || '{}');
    check('Local OpenAI /api/models succeeds without API key',
      modRes.statusCode === 200 && Array.isArray(modJson.models) && modJson.models[0] === 'local-coder-7b');

    // 3b. settings.thinking='low' reaches upstream + usage & content deltas returned
    const chatRes = await callBridge('POST', '/api/chat', { origin: 'http://localhost:8090' }, JSON.stringify({
      messages: [{ role: 'user', content: 'tes' }],
      tools: [],
      settings: { baseUrl: localBase, apiKey: '', model: 'local-coder-7b', thinking: 'low' }
    }));
    check('settings.thinking="low" forwarded as reasoning_effort="low"', lastReqBody && lastReqBody.reasoning_effort === 'low');
    check('Empty key on local host omits Authorization header', lastAuthHeader === '');
    check('Bridge forwards delta.content and usage in SSE',
      chatRes.body.includes('"content":"Halo CAD"') && chatRes.body.includes('"total_tokens":150'));

    // 3c. Client disconnect (Stop button) destroys upstream socket immediately
    const hangPromise = new Promise(r => { hangResolve = r; });
    const stopRes = Object.assign(new EventEmitter(), {
      statusCode: 0, headers: {}, body: '', headersSent: false, writableEnded: false,
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      writeHead(code) { this.statusCode = code; this.headersSent = true; return this; },
      write(chunk) {
        this.body += String(chunk);
        // As soon as first delta arrives, simulate user clicking Stop (browser drops SSE)
        setTimeout(() => stopRes.emit('close'), 15);
        return true;
      },
      end() { this.writableEnded = true; }
    });
    const stopReq = new EventEmitter();
    stopReq.method = 'POST';
    stopReq.url = '/api/chat';
    stopReq.headers = { origin: 'http://localhost:8090' };
    stopReq.destroy = () => {};
    bridgeHandler(stopReq, stopRes);
    setImmediate(() => {
      stopReq.emit('data', Buffer.from(JSON.stringify({
        messages: [{ role: 'user', content: 'hang' }],
        tools: [],
        settings: { baseUrl: localBase, apiKey: '', model: 'hang-model', thinking: 'normal' }
      })));
      stopReq.emit('end');
    });
    await Promise.race([hangPromise, new Promise(r => setTimeout(r, 1500))]);
    check('Stop / client close destroys active upstream HTTP request immediately', abortObserved);

    await new Promise(r => mockServer.close(r));
  }

  console.log('\n== 4. Frontend Prompt Multimodal Skill Matching + Multi-Round Agent Loop ==');
  {
    const sandbox = {
      window: {},
      document: {
        currentScript: null,
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: () => {}
      },
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      console: { log: () => {}, warn: () => {}, error: () => {} },
      performance: { now: () => Date.now() },
      setTimeout, clearTimeout, setInterval, clearInterval,
      TextDecoder, TextEncoder, AbortController,
      fetch: async (url) => {
        if (String(url).endsWith('system-prompt.txt')) return { ok: true, text: async () => sysPrompt };
        if (String(url).endsWith('system-prompt-svg.txt')) return { ok: true, text: async () => '<svg/>' };
        if (String(url).endsWith('tools.json')) return { ok: true, json: async () => toolsManifest };
        throw new Error('unexpected fetch: ' + url);
      }
    };
    sandbox.window = sandbox;
    vm.runInNewContext(skillsSrc, sandbox);
    vm.runInNewContext(promptSrc, sandbox);
    await sandbox.MiniSketchAIPrompt.ready();

    // Multimodal skill trigger test
    const mmMsgs = [{
      role: 'user',
      content: [
        { type: 'text', text: 'tolong buat stencil huruf O sesuai gambar' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }
      ]
    }];
    const matched = sandbox.MiniSketchAIPrompt._debug.skillsFor(mmMsgs, []);
    check('Multimodal message array triggers stencil-bridges skill', matched.some(s => s.name === 'stencil-bridges'));

    // Multi-round agent loop test in ai/chat.js:
    // Round 1: returns get_bounds + use_skill (read-only: NO pushHistory)
    // Round 2: receives queryResults AND stencil-bridges in system prompt -> emits add_panel (pushHistory #1)
    // Round 3: emits rotate_selection (noHistory=true -> still 1 pushHistory total!) + streams content
    const capturedPayloads = [];
    let fetchRound = 0;
    sandbox.fetch = async (url, init) => {
      if (String(url).endsWith('system-prompt.txt')) return { ok: true, text: async () => sysPrompt };
      if (String(url).endsWith('system-prompt-svg.txt')) return { ok: true, text: async () => '<svg/>' };
      if (String(url).endsWith('tools.json')) return { ok: true, json: async () => toolsManifest };
      fetchRound++;
      capturedPayloads.push(JSON.parse(init.body));
      let sse = '';
      if (fetchRound === 1) {
        sse = 'data: ' + JSON.stringify({
          done: true, reply: '', thinking: 'cek batas',
          tool_calls: [
            { name: 'get_bounds', arguments: {} },
            { name: 'use_skill', arguments: { name: 'stencil-bridges' } }
          ],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }
        }) + '\n\n';
      } else if (fetchRound === 2) {
        sse = 'data: ' + JSON.stringify({
          done: true, reply: '', thinking: 'gambar kotak',
          tool_calls: [
            { name: 'add_panel', arguments: { pts: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 }], color: '#000000' } }
          ],
          usage: { prompt_tokens: 150, completion_tokens: 30, total_tokens: 180 }
        }) + '\n\n';
      } else if (fetchRound === 3) {
        sse = 'data: ' + JSON.stringify({
          done: true, reply: '', thinking: 'putar kotak',
          tool_calls: [
            { name: 'rotate_selection', arguments: { angle: 90 } }
          ],
          usage: { prompt_tokens: 160, completion_tokens: 20, total_tokens: 180 }
        }) + '\n\n';
      } else {
        sse = 'data: {"delta":{"content":"Kotak dibuat "}}\n\n' +
              'data: {"delta":{"content":"dan diputar 90 derajat."}}\n\n' +
              'data: ' + JSON.stringify({
                done: true, reply: 'Kotak dibuat dan diputar 90 derajat.', thinking: '',
                tool_calls: [],
                usage: { prompt_tokens: 170, completion_tokens: 15, total_tokens: 185 }
              }) + '\n\n';
      }
      const enc = new TextEncoder().encode(sse);
      let readDone = false;
      return {
        ok: true,
        status: 200,
        body: {
          getReader() {
            return {
              async read() {
                if (readDone) return { done: true, value: undefined };
                readDone = true;
                return { done: false, value: enc };
              }
            };
          }
        }
      };
    };

    vm.runInNewContext(chatSrc, sandbox);
    let historyCalls = 0, noteCalls = 0, rotateCalls = 0, mirrorCalls = 0, dupCalls = 0;
    const mockApi = {
      state: { entities: {}, points: {}, constraints: {} },
      ui: { selection: [], activeLayer: 1, color: '#000000' },
      settings: { aiBridgeUrl: 'http://127.0.0.1:8090', aiApiUrl: 'http://127.0.0.1:11434/v1', aiApiKey: '', aiModel: 'test', aiThinkLevel: 'low', aiMaxRounds: 5, aiModeSvg: false },
      contentBounds: () => ({ minX: 10, minY: 20, maxX: 110, maxY: 80 }),
      selectionBounds: () => ({ minX: 0, minY: 0, maxX: 40, maxY: 20 }),
      s2w: () => ({ x: 60, y: 50 }),
      getW: () => 800, getH: () => 600,
      getLoops: () => [], loopEntities: () => [],
      pushHistory: () => { historyCalls++; },
      undo: () => {},
      commit: () => {},
      addPanelEntity: (pts, col) => { mockApi.state.entities[101] = { id: 101, type: 'spline', color: col }; mockApi.ui.selection = [{ kind: 'entity', id: 101 }]; return 101; },
      addNote: (t, x, y) => { noteCalls++; mockApi.state.entities[102] = { id: 102, type: 'note', text: t }; return 102; },
      rotateSelection: (deg) => { rotateCalls++; return { ok: true, count: 1 }; },
      mirrorSelection: (ax) => { mirrorCalls++; return { ok: true, count: 1, axis: ax }; },
      duplicateSelection: (dx, dy) => { dupCalls++; return { ok: true, ids: [103] }; }
    };
    sandbox.MiniSketchAI.mount(mockApi);
    await sandbox.MiniSketchAI.send('buat kotak lalu putar');

    check('Agent loop ran 4 rounds cleanly', capturedPayloads.length === 4, 'got ' + capturedPayloads.length);
    const r2UserFb = capturedPayloads[1].messages[capturedPayloads[1].messages.length - 1].content;
    check('Round 2 receives queryResults from get_bounds', r2UserFb.includes('"query":"get_bounds"') && r2UserFb.includes('"maxX":110'));
    const r2Sys = capturedPayloads[1].messages[0].content;
    // SVG-only mode: skills are gated behind !svgMode, so the tool-call skill
    // recipes are intentionally NOT injected anymore.
    check('Round 2 system prompt does NOT inject agent skills (SVG-only mode)',
      !r2Sys.includes('ACTIVE SKILL: stencil-bridges'));
    check('Multi-round turn (read-only + add + rotate) calls pushHistory EXACTLY ONCE', historyCalls === 1, 'got ' + historyCalls);
    check('rotate_selection executed in round 3', rotateCalls === 1);
    const finalMsg = sandbox.MiniSketchAI.log[sandbox.MiniSketchAI.log.length - 1];
    check('Token usage accumulated across all rounds (665)', finalMsg && finalMsg.usage && finalMsg.usage.total_tokens === 665,
      JSON.stringify(finalMsg && finalMsg.usage));

    // Direct executor checks for add_note, mirror_selection, duplicate_selection
    const rDirect = await sandbox.MiniSketchAI.applyOps([
      { name: 'add_note', arguments: { text: '3', x: 50, y: 50 } },
      { name: 'mirror_selection', arguments: { axis: 'x' } },
      { name: 'duplicate_selection', arguments: { dx: 60, dy: 0 } }
    ], { noHistory: true });
    check('add_note calls api.addNote directly', noteCalls === 1);
    check('mirror_selection calls api.mirrorSelection', mirrorCalls === 1);
    check('duplicate_selection calls api.duplicateSelection', dupCalls === 1);
    check('applyOps({ noHistory: true }) does not call pushHistory', historyCalls === 1, 'got ' + historyCalls);
    check('applyOps returned duplicate id 103', rDirect.ids.includes(103));
  }

  console.log('\n== 5. UI Quick Controls & Settings Wiring ==');
  // Mode Agen/SVG toggle and the Settings gear were removed: SVG is the only
  // mode, so there is no mode toggle and no gear in the panel.
  check('index.html removed Mode quick toggle (SVG-only mode)',
    !/id="chat-mode-agent"/.test(html) && !/id="chat-mode-svg"/.test(html));
  check('index.html has Reasoning quick select (#chat-think-sel)', /id="chat-think-sel"/.test(html));
  check('index.html removed Settings gear (moved to Settings › AI chat only)',
    !/id="chat-settings-btn"/.test(html));
  check('index.html upgraded #chat-input to textarea', /<textarea[^>]*id="chat-input"/.test(html));
  check('app.js has Test koneksi button (#ai-test-conn)', /id = 'ai-test-conn'/.test(appSrc));
  check('app.js exposes rotateSelection, mirrorSelection, duplicateSelection, selectionBounds, undo in toolApi()',
    /rotateSelection,\s*\n\s*mirrorSelection,\s*duplicateSelection/.test(appSrc) &&
    /pushHistory,\s*undo,\s*commit/.test(appSrc));

  console.log('\n' + (fail ? fail + ' FAILED, ' : 'all ') + pass + ' checks passed');
  process.exit(fail ? 1 : 0);
})();
