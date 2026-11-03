// End-to-end probe in a real browser: convert a text object with both paths and
// measure each against the font's own outline.
//
// Serves the app over http (file:// blocks the font <script>), opens it, makes a
// text object "nomor 1" in Liberation Sans, then:
//   1. MiniSketch.textSource(id)      -> which path -> Curve takes
//   2. convert, and measure the result against the glyf outline (fontTools)
//
// Run: node testing/text_exact_probe.mjs   (headless chromium via browser_exec)
const body = `
(() => {
  const app = window.MiniSketch;
  const st = app.live().state;
  // find the text entity the harness made
  const ids = Object.keys(st.entities).filter(k => st.entities[k].type === 'text');
  if (!ids.length) return { error: 'no text entity' };
  return { textIds: ids };
})()
`;
module.exports = { body };
