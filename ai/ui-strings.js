// ai/ui-strings.js — MiniSketch (upstream master) USER-FACING STRINGS (EN / ID).
//
// Read by ai/chat.js as window.MiniSketchAIStrings. Loaded before ai/chat.js.
// Missing keys fall back to chat.js defaults.

window.MiniSketchAIStrings = {
  en: {
    offlineNoEndpoint: 'No bridge connected: run "node server/serve.js" and open http://127.0.0.1:8090 (or set AI bridge URL in Settings). Offline basic commands still work: "100x60 box", "circle d50", "move 10,0", "delete".',
    errorPrefix: 'Bridge error: ',
    errorHint: '. Check server/ai-bridge.js + settings.'
  },
  id: {
    offlineNoEndpoint: 'Tidak ada bridge: jalankan "node server/serve.js" lalu buka http://127.0.0.1:8090 (atau isi AI bridge URL di Pengaturan). Offline, perintah sederhana tetap jalan: "kotak 100x60", "lingkaran d50", "pindah 10,0", "hapus".',
    errorPrefix: 'Bridge error: ',
    errorHint: '. Cek server/ai-bridge.js + pengaturan.'
  },
  // Legacy flat fallbacks
  offlineNoEndpoint: 'No bridge connected: run "node server/serve.js" and open http://127.0.0.1:8090 (or set AI bridge URL in Settings). Offline basic commands still work: "100x60 box", "circle d50", "move 10,0", "delete".',
  errorPrefix: 'Bridge error: ',
  errorHint: '. Check server/ai-bridge.js + settings.'
};
