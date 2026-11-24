// ai/ui-strings.js — MiniSketch (upstream master) USER-FACING STRINGS.
//
// The upstream app is normally served by the Node bridge/server
// (server/ai-bridge.js + server/serve.js on :8090), so the guidance below
// points there. KaryaCNC ships its own Go proxy at /api/chat instead, so its
// copy of this file phrases the same guidance around the Settings › AI chat
// provider fields. This is the ONLY ai/ file that differs between the two apps;
// chat.js / prompt.js / the policy assets stay identical and safe to sync.
//
// Read by ai/chat.js as window.MiniSketchAIStrings. Loaded before ai/chat.js.
// Missing keys fall back to chat.js defaults.

window.MiniSketchAIStrings = {
  // Shown when the chat tab has no endpoint to talk to (file:// / no server).
  offlineNoEndpoint: 'Tidak ada bridge: jalankan "node server/serve.js" lalu buka http://127.0.0.1:8090 (atau isi AI bridge URL di Settings). Offline, command sederhana tetap jalan: "kotak 100x60", "lingkaran d50", "pindah 10,0", "hapus".',

  // Prefixed to an upstream/bridge failure.
  errorPrefix: 'Bridge error: ',
  errorHint: '. Cek server/ai-bridge.js + env.'
};
