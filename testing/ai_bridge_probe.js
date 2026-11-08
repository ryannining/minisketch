// Probe for the AI bridge contract.
//
// The bridge is the only place a paid LLM call happens, so three things
// must hold and are pinned here:
//
//  1. NO BUILT-IN KEY. The API key belongs to whoever runs MiniSketch. A key
//     baked into the source leaks with the source, so the bridge must start
//     with no key and take it from the request, from POST /api/settings, or
//     from the environment.
//  2. THE USER'S SETTINGS ARE ACCEPTED. The app sends its own base URL, key
//     and model with every chat request; the bridge uses those for that
//     request and keeps no copy.
//  3. A RANDOM WEB PAGE CANNOT REACH IT. The old bridge answered with
//     Access-Control-Allow-Origin: *, so any site could spend the key.
//
// Run: node testing/ai_bridge_probe.js
const fs = require('fs');
const path = require('path');

// The bridge reads server/.env at load time. Pin the two endpoint variables
// to empty FIRST so the real .env cannot fill them in — the .env loader only
// fills a variable that is still undefined.
process.env.OPENAI_API_KEY = '';
process.env.OPENAI_BASE_URL = '';
delete process.env.MODEL;
delete process.env.OPENAI_MODEL;

const ROOT = path.join(__dirname, '..');
const bridgeSrc = fs.readFileSync(path.join(ROOT, 'server', 'ai-bridge.js'), 'utf8');
const chatSrc = fs.readFileSync(path.join(ROOT, 'ai', 'chat.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
};

// ---- the source has no baked-in secret -----------------------------------
console.log('\n== no secret is baked into the source ==');
{
  // The secret is not written out here either: a key that appears in a test
  // file is a key that leaks with the repository. What matters is that no
  // key-shaped default survives in the bridge, whatever it was.
  const KEY_LIKE = /sk-[A-Za-z0-9]{12,}/;
  const URL_LIKE = /https?:\/\/[^\s'"`]*\.host/;
  check('no key-shaped default survives in the bridge',
    !KEY_LIKE.test(bridgeSrc),
    (bridgeSrc.match(KEY_LIKE) || ['?'])[0]);
  check('no hardcoded endpoint survives in the bridge',
    !URL_LIKE.test(bridgeSrc),
    (bridgeSrc.match(URL_LIKE) || ['?'])[0]);
  check('the key comes from the environment',
    /(?:const|let) KEY = process\.env\.OPENAI_API_KEY \|\| ''/.test(bridgeSrc));
  check('the base URL comes from the environment', /OPENAI_BASE_URL \|\| ''/.test(bridgeSrc));
  check('the bridge keeps no key in its source',
    !/(?:const|let) KEY = process\.env\.OPENAI_API_KEY \|\| '[^']+'/.test(bridgeSrc));
}

// ---- the bridge answers ---------------------------------------------------
console.log('\n== the bridge honours the origin and takes settings ==');
const { bridgeHandler } = require(path.join(ROOT, 'server', 'ai-bridge.js'));

// A minimal request/response pair, enough for the bridge's handler.
function call(method, url, headers, body) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 0,
      headers: {},
      body: '',
      writableEnded: false,
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      writeHead(code) { this.statusCode = code; return this; },
      end(chunk) { if (chunk) this.body += chunk; this.writableEnded = true; resolve(this); },
      on() {},
      write() { return true; }
    };
    const req = {
      method,
      url,
      headers: headers || {},
      on(ev, fn) {
        if (ev === 'data' && body) fn(Buffer.from(body));
        if (ev === 'end') fn();
      }
    };
    bridgeHandler(req, res);
    setTimeout(() => resolve(res), 60);
  });
}

(async () => {
  console.log('\n== a random web page is refused ==');
  {
    const evil = await call('POST', '/api/chat', { origin: 'https://evil.example.com' }, '{}');
    check('a remote origin gets 403', evil.statusCode === 403, 'got ' + evil.statusCode);
    check('the refusal says why', /origin not allowed/.test(evil.body));
    check('no CORS header is granted', !evil.headers['access-control-allow-origin']);
  }

  console.log('\n== the app itself is allowed ==');
  {
    const local = await call('GET', '/health', { origin: 'null' }, null);
    check('a local file (Origin: null) is allowed', local.statusCode === 200, 'got ' + local.statusCode);
    check('the allowed origin is echoed back', local.headers['access-control-allow-origin'] === 'null');
    const lh = await call('GET', '/health', { origin: 'http://localhost:8090' }, null);
    check('a localhost port is allowed', lh.statusCode === 200, 'got ' + lh.statusCode);
    const lan = await call('GET', '/health', { origin: 'http://192.168.1.20:8090' }, null);
    check('a private LAN address is allowed', lan.statusCode === 200, 'got ' + lan.statusCode);
    const noOrigin = await call('GET', '/health', {}, null);
    check('a request without an Origin still works', noOrigin.statusCode === 200, 'got ' + noOrigin.statusCode);
  }

  console.log('\n== no key means a clear refusal, not a crash ==');
  {
    const r = await call('POST', '/api/chat', { origin: 'null' }, JSON.stringify({ messages: [] }));
    check('a chat without a key is refused', r.statusCode === 400, 'got ' + r.statusCode);
    check('the message names the setting to fill',
      /AI API key/.test(r.body), r.body.slice(0, 120));
  }

  console.log('\n== the user pushes their own settings ==');
  {
    const r = await call('POST', '/api/settings', { origin: 'null' },
      JSON.stringify({ baseUrl: 'https://my-provider.example/v1', apiKey: 'sk-user-own-key', model: 'my-model' }));
    check('the settings are accepted', r.statusCode === 200, 'got ' + r.statusCode);
    check('the key is never echoed back', r.body.indexOf('sk-user-own-key') < 0, r.body.slice(0, 160));
    check('the answer says a key is set', /"hasKey":true/.test(r.body));
    const h = await call('GET', '/health', { origin: 'null' }, null);
    check('the bridge now reports the model', /my-model/.test(h.body), h.body.slice(0, 160));
  }

  console.log('\n== the app sends its own settings with every chat ==');
  {
    check('the chat request carries a settings block',
      /settings: \{[\s\S]{0,200}?baseUrl:/.test(chatSrc));
    check('it carries the base URL', /baseUrl: String\(api\.settings\.aiApiUrl/.test(chatSrc));
    check('it carries the key', /apiKey: String\(api\.settings\.aiApiKey/.test(chatSrc));
    check('it carries the model', /model: String\(api\.settings\.aiModel/.test(chatSrc));
  }

  console.log('\n== the app has the settings fields ==');
  {
    check('there is an AI API base URL setting', /key: 'aiApiUrl'/.test(appSrc));
    check('there is an AI API key setting', /key: 'aiApiKey'/.test(appSrc));
    check('there is an AI model setting', /key: 'aiModel'/.test(appSrc));
    check('the key field is masked in the form', /sp\.password/.test(appSrc) &&
      /input\.type = 'password'/.test(appSrc));
    check('a masked field survives a reload', /if \(sp\.text \|\| sp\.password\)/.test(appSrc));
    check('the bridge URL field is still there', /key: 'aiBridgeUrl'/.test(appSrc));
    check('the settings dialog is built from the spec', /SETTINGS_SPEC/.test(appSrc));
    check('index.html has no hand-written key field', !/id="set-aiApiKey"/.test(html));
  }

  console.log('\n== the secret never reaches the log ==');
  {
    check('the bridge logs whether a key is set, not the key',
      /key=' \+ \(userSettings\.apiKey \? 'set' : 'none'\)/.test(bridgeSrc));
    check('the chat log does not print the key',
      !/console\.log\([^)]*apiKey/.test(bridgeSrc));
    // The log has to say WHERE each value came from. A run that quietly uses
    // the .env key while the user typed one into Settings looks identical to
    // a correct run unless the log says so.
    check('the chat log names the source of the key',
      /keyFrom/.test(bridgeSrc) && /key=' \+ keyFrom/.test(bridgeSrc));
    check('the source can be request, bridge settings or .env',
      /rs\.apiKey \? 'request' : \(userSettings\.apiKey \? 'bridge settings' : '\.env'\)/.test(bridgeSrc));
    check('the source of the base URL is named too', /baseFrom/.test(bridgeSrc));
    check('the source of the model is named too', /modelFrom/.test(bridgeSrc));
    check('/health reports where the values come from',
      /source: \{[\s\S]{0,400}?base:/.test(bridgeSrc));
    check('/health reports the key length, never the key',
      /keyLength:/.test(bridgeSrc));
    // the health answer must not carry the key itself
    const healthBody = (bridgeSrc.match(/req\.url === '\/health'[\s\S]{0,900}?res\.end\(JSON\.stringify\(/g) || []).join('');
    check('the health answer carries no key field',
      !/apiKey\s*:/.test(healthBody), healthBody.slice(0, 120));
  }

  console.log('\n' + (fail ? fail + ' FAILED, ' + pass + ' checks passed' : 'all ' + pass + ' checks passed'));
  process.exit(fail ? 1 : 0);
})();
