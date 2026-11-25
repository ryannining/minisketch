'use strict';
// Vercel serverless entry point.
//
// Reuses the EXACT same combined handler as the local `node server/serve.js`
// (static files + AI bridge at /api/* and /health). vercel.json rewrites every
// request that doesn't match an existing static file to this function, so the
// app keeps talking to /api/chat on its own origin exactly like localhost.

const { handler } = require('../server/serve.js');

module.exports = handler;
