// Debug: dump the decompressed RIFF chunk tree of a CDR file, plus txsm bytes.
const fs = require('fs');
let src = fs.readFileSync(__dirname + '/../core.js', 'utf8');
function grab(name) {
  let i = src.indexOf('function ' + name);
  if (src.lastIndexOf('async ', i) === i - 6) i -= 6;
  let j = src.indexOf('{', i), d = 0, k = j;
  for (; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (d === 0) break; } }
  return src.slice(i, k + 1);
}
const code = ['pdfLatin1', 'cdrUnzip', 'cdrEntryBytes', 'cdrInflateZlib', 'cdrRiffChunks',
  'cdrReadU16', 'cdrReadU32', 'cdrReadS32', 'cdrTxsmText'].map(grab).join('\n');
const factory = new Function('return (async function () {\n' + code + '\nreturn { pdfLatin1, cdrUnzip, cdrEntryBytes, cdrRiffChunks, cdrTxsmText };\n})()');

(async () => {
  const fns = await factory();
  const file = process.argv[2] || __dirname + '/../testimport/test9.cdr';
  const bytes = new Uint8Array(fs.readFileSync(file));
  const zip = fns.cdrUnzip(bytes);
  const entry = zip.get('content/riffData.cdr') || zip.get('content/root.dat');
  const root = entry ? await fns.cdrEntryBytes(entry) : bytes;
  const chunks = await fns.cdrRiffChunks(root, 12, root.length, 0, []);
  console.log('chunks:', chunks.length);
  for (const c of chunks) {
    console.log(c.depth, JSON.stringify(c.id), 'form=' + c.form, 'size=' + c.size, 'body@' + c.body);
    if (c.id === 'txsm') {
      const r = fns.cdrTxsmText(c.buf.subarray(c.body, c.body + c.size), 1400);
      console.log('   txsm text:', JSON.stringify(r));
      console.log('   first bytes:', Array.from(c.buf.subarray(c.body, c.body + 64)).map(b => b.toString(16).padStart(2, '0')).join(' '));
    }
  }
})();
