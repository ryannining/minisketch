'use strict';
// MiniSketch combined server: static files + AI bridge on ONE port.
//
//   node server/serve.js [port]        (default 8090, binds 0.0.0.0 = LAN)
//
// Requests to /health and /api/* are delegated to the AI bridge
// (server/ai-bridge.js, the same handler the standalone bridge serves);
// everything else is the no-store static server from static-nocache.js,
// so an edit to app.js/styles.css shows up on the next pull-to-refresh.
//
// From another PC or phone: http://<ip-desktop-ini>:8090/
// In MiniSketch settings, AI bridge URL may stay EMPTY: the app then uses its
// own origin (http://<host>:8090). Fill it in only for a bridge elsewhere.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { bridgeHandler } = require('./ai-bridge.js');

const PORT = +(process.argv[2] || process.env.PORT || 8090);
const ROOT = path.resolve(__dirname, '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm'
};

const server = http.createServer((req, res) => {
  // AI bridge endpoints first (also answers OPTIONS/CORS itself)
  const url = (req.url || '').split('?')[0];
  if (url === '/health' || url.startsWith('/api/')) {
    bridgeHandler(req, res);
    return;
  }

  // ---- static, no-store ---------------------------------------------------
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch (err) {
    res.writeHead(400).end('bad request');
    return;
  }
  if (rel.endsWith('/')) rel += 'index.html';

  // Secrets and server code never leave the machine: the static side must
  // not serve the API key or the bridge source.
  if (rel === '/server/.env' || rel === '/.env' || rel.startsWith('/.env.') ||
      rel.startsWith('/server/') ||
      rel.startsWith('/.git/') || rel === '/.git' ||
      rel.startsWith('/node_modules/')) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('forbidden');
    return;
  }

  const file = path.resolve(ROOT, '.' + path.posix.normalize(rel));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store'
      }).end('not found: ' + rel);
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    res.end(buf);
  });
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error('');
    console.error('Port ' + PORT + ' sudah dipakai — kemungkinan server lama masih jalan.');
    console.error('  ss -ltnp | grep ' + PORT + '      # lihat PID pemegang port');
    console.error('  kill <PID>');
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, '0.0.0.0', () => {
  const nets = require('os').networkInterfaces();
  const addrs = [];
  for (const name of Object.keys(nets)) {
    for (const n of nets[name] || []) {
      if (n.family === 'IPv4' && !n.internal) addrs.push(n.address);
    }
  }
  console.log('minisketch server (statis + AI bridge) on:');
  console.log('  http://localhost:' + PORT + '/');
  for (const a of addrs) console.log('  http://' + a + ':' + PORT + '/');
  console.log('  AI bridge: endpoint /api/chat di port yang sama — "AI bridge URL" di Settings boleh kosong');
});
