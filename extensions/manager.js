// MiniSketch Extension Manager & Marketplace
// Plain classic script (no ES modules, compatible with file:// and HTTP :8090).
// Exposes window.MiniSketchExtensions for app.js, tools/registry.js, and ai/chat.js.
(() => {
  'use strict';

  const NS = window.MiniSketchExtensions = window.MiniSketchExtensions || {};

  const MKT_URL_KEY = 'minisketch.v1.ext.marketplaceUrl';
  const GH_CFG_KEY = 'minisketch.v1.ext.githubCfg';
  const SERVER_URL_KEY = 'minisketch.v1.ext.serverUrl';
  const AUTO_UPDATE_KEY = 'minisketch.v1.ext.autoUpdate';

  let api = null;
  let activeTab = 'installed';
  let mktItems = [];
  let mktLoading = false;
  let mktError = '';
  let mktSourceResolved = '';
  const availableUpdates = new Map();
  let checkingUpdates = false;

  const el = (id) => document.getElementById(id);

  function sanitizeIcon(raw) {
    if (window.MiniSketchTools && window.MiniSketchTools.sanitizeIconSvg) {
      return window.MiniSketchTools.sanitizeIconSvg(raw);
    }
    return '<svg class="ext-btn-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M3 4.5h3.2a1.6 1.6 0 1 1 3.2 0H12.5v3.2a1.6 1.6 0 1 1 0 3.2V13.5H3V4.5z"/></svg>';
  }

  function lsGet(k, fallback) {
    try {
      const v = localStorage.getItem(k);
      return v == null ? fallback : v;
    } catch (err) {
      return fallback;
    }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, String(v)); } catch (err) { /* private mode */ }
  }

  function isHttpOrigin() {
    try { return /^https?:$/i.test(location.protocol); } catch (err) { return false; }
  }

  function defaultServerUrl() {
    if (isHttpOrigin()) return location.origin.replace(/\/+$/, '');
    return 'http://127.0.0.1:8090';
  }

  function defaultMarketplaceUrl() {
    if (isHttpOrigin()) return 'api/marketplace/catalog';
    return 'http://127.0.0.1:8090/api/marketplace/catalog';
  }

  function resolveUrl(relOrAbs, base) {
    const target = String(relOrAbs || '').trim();
    if (!target) return '';
    if (/^https?:\/\//i.test(target)) return target;
    try {
      const baseAbs = /^https?:\/\//i.test(String(base || ''))
        ? String(base)
        : new URL(String(base || ''), isHttpOrigin() ? location.href : 'http://127.0.0.1:8090/').toString();
      const baseUrl = new URL(baseAbs);
      if (target.startsWith('marketplace/') && (/\/api\/marketplace\/catalog$/i.test(baseUrl.pathname) || /\/marketplace\/catalog\.json$/i.test(baseUrl.pathname))) {
        return new URL(target, baseUrl.origin + '/').toString();
      }
      if (/\/api\/marketplace\/catalog$/i.test(baseUrl.pathname) && !target.startsWith('/')) {
        return new URL(target, baseUrl.origin + '/marketplace/catalog.json').toString();
      }
      return new URL(target, baseAbs).toString();
    } catch (err) {
      return target;
    }
  }

  function compareVersions(a, b) {
    const pa = String(a || '0.0.0').replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b || '0.0.0').replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < 3; i++) {
      const da = pa[i] || 0;
      const db = pb[i] || 0;
      if (da !== db) return da - db;
    }
    return 0;
  }

  function downloadJsFile(filename, content) {
    try {
      const blob = new Blob([String(content || '')], { type: 'application/javascript;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    } catch (err) {
      return false;
    }
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) { /* fallback */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch (err) {
      return false;
    }
  }

  function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(String(str));
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function base64ToUtf8(b64) {
    const bin = atob(String(b64 || '').replace(/\s+/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  // ---- Syntax Highlighter (JS + embedded HTML/SVG + CSS) ------------------
  function escHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function spanTok(cls, text) {
    if (!text) return '';
    return cls ? '<span class="' + cls + '">' + escHtml(text) + '</span>' : escHtml(text);
  }

  function renderTextWithHex(text, baseCls) {
    const s = String(text || '');
    const re = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;
    let out = '';
    let last = 0;
    let m;
    while ((m = re.exec(s)) !== null) {
      if (m.index > last) out += spanTok(baseCls, s.slice(last, m.index));
      const hex = m[0];
      const deco = hex.length === 7
        ? ' style="text-decoration:underline;text-decoration-color:' + hex + ';text-decoration-thickness:2px"'
        : '';
      out += '<span class="hl-hex"' + deco + '>' + escHtml(hex) + '</span>';
      last = m.index + hex.length;
    }
    if (last < s.length) out += spanTok(baseCls, s.slice(last));
    return out;
  }

  function highlightCssSegment(src, inlineDecls) {
    const s = String(src || '');
    const len = s.length;
    let i = 0;
    let out = '';
    let inBlock = !!inlineDecls;
    let expectValue = false;

    while (i < len) {
      const ch = s[i];
      if (ch === '/' && s[i + 1] === '*') {
        const end = s.indexOf('*/', i + 2);
        const j = end < 0 ? len : end + 2;
        out += spanTok('hl-com', s.slice(i, j));
        i = j;
        continue;
      }
      if (ch === '"' || ch === "'") {
        const q = ch;
        let j = i + 1;
        while (j < len) {
          if (s[j] === '\\') { j += 2; continue; }
          if (s[j] === q) { j++; break; }
          j++;
        }
        out += renderTextWithHex(s.slice(i, j), 'hl-str');
        i = j;
        continue;
      }
      if (ch === '{') {
        inBlock = true;
        expectValue = false;
        out += spanTok('hl-punct', ch);
        i++;
        continue;
      }
      if (ch === '}') {
        inBlock = !!inlineDecls;
        expectValue = false;
        out += spanTok('hl-punct', ch);
        i++;
        continue;
      }
      if (ch === ':') {
        if (inBlock) expectValue = true;
        out += spanTok('hl-punct', ch);
        i++;
        continue;
      }
      if (ch === ';') {
        expectValue = false;
        out += spanTok('hl-punct', ch);
        i++;
        continue;
      }
      if (ch === '#') {
        const m = s.slice(i).match(/^#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/);
        if (m && (inBlock || expectValue)) {
          out += renderTextWithHex(m[0], 'hl-hex');
          i += m[0].length;
          continue;
        }
      }
      if (ch === '@' && !inBlock) {
        const m = s.slice(i).match(/^@[a-zA-Z_-][\w-]*/);
        if (m) {
          out += spanTok('hl-kw', m[0]);
          i += m[0].length;
          continue;
        }
      }
      if (inBlock && expectValue && (/\d/.test(ch) || (ch === '.' && /\d/.test(s[i + 1] || '')) || (ch === '-' && /[\d.]/.test(s[i + 1] || '')))) {
        const m = s.slice(i).match(/^-?(?:\d+\.?\d*|\.\d+)(?:%|px|mm|cm|em|rem|vh|vw|dvh|deg|ms|s)?\b/);
        if (m) {
          out += spanTok('hl-num', m[0]);
          i += m[0].length;
          continue;
        }
      }
      if (/[A-Za-z_.-]/.test(ch)) {
        const m = s.slice(i).match(/^[A-Za-z_.-][\w-]*/);
        if (m) {
          const tok = m[0];
          const next = s[i + tok.length] || '';
          if (inBlock && !expectValue) {
            out += spanTok('hl-attr', tok);
          } else if (inBlock && expectValue) {
            if (next === '(') out += spanTok('hl-fn', tok);
            else if (/^(?:none|auto|inherit|initial|unset|block|inline|inline-block|flex|grid|hidden|visible|solid|dashed|dotted|relative|absolute|fixed|center|left|right|bold|normal|pointer|transparent|currentColor|!important)$/i.test(tok)) {
              out += spanTok('hl-kw', tok);
            } else {
              out += escHtml(tok);
            }
          } else {
            out += spanTok('hl-tag', tok);
          }
          i += tok.length;
          continue;
        }
      }
      if (/[(),>+~*=[\]!]/.test(ch)) {
        out += spanTok('hl-punct', ch);
        i++;
        continue;
      }
      out += escHtml(ch);
      i++;
    }
    return out;
  }

  function highlightHtmlSegment(src) {
    const s = String(src || '');
    const len = s.length;
    let i = 0;
    let out = '';

    while (i < len) {
      if (s.startsWith('<!--', i)) {
        const end = s.indexOf('-->', i + 4);
        const j = end < 0 ? len : end + 3;
        out += spanTok('hl-com', s.slice(i, j));
        i = j;
        continue;
      }
      if (s[i] === '<') {
        const mOpen = s.slice(i).match(/^<\/?([A-Za-z][A-Za-z0-9:_-]*)/);
        if (mOpen) {
          const isClose = s[i + 1] === '/';
          const tagName = mOpen[1];
          const isStyleOpen = !isClose && tagName.toLowerCase() === 'style';
          out += spanTok('hl-punct', isClose ? '</' : '<');
          out += spanTok('hl-tag', tagName);
          i += mOpen[0].length;
          let selfClose = false;
          while (i < len) {
            if (s[i] === '>') {
              out += spanTok('hl-punct', '>');
              i++;
              break;
            }
            if (s[i] === '/' && s[i + 1] === '>') {
              selfClose = true;
              out += spanTok('hl-punct', '/>');
              i += 2;
              break;
            }
            if (/\s/.test(s[i])) {
              let j = i + 1;
              while (j < len && /\s/.test(s[j])) j++;
              out += escHtml(s.slice(i, j));
              i = j;
              continue;
            }
            const mAttr = s.slice(i).match(/^[A-Za-z_:][\w:.-]*/);
            if (mAttr) {
              const attrName = mAttr[0];
              out += spanTok('hl-attr', attrName);
              i += attrName.length;
              while (i < len && /\s/.test(s[i])) { out += escHtml(s[i]); i++; }
              if (s[i] === '=') {
                out += spanTok('hl-punct', '=');
                i++;
                while (i < len && /\s/.test(s[i])) { out += escHtml(s[i]); i++; }
                if (s[i] === '"' || s[i] === "'") {
                  const q = s[i];
                  let j = i + 1;
                  while (j < len && s[j] !== q) {
                    if (s[j] === '\\') j += 2;
                    else j++;
                  }
                  const hasEnd = j < len && s[j] === q;
                  const inner = s.slice(i + 1, j);
                  out += spanTok('hl-str', q);
                  if (/^style$/i.test(attrName)) {
                    out += highlightCssSegment(inner, true);
                  } else if (/^on[a-z]+$/i.test(attrName)) {
                    out += highlightJsSegment(inner);
                  } else {
                    out += renderTextWithHex(inner, 'hl-str');
                  }
                  if (hasEnd) {
                    out += spanTok('hl-str', q);
                    i = j + 1;
                  } else {
                    i = j;
                  }
                }
              }
              continue;
            }
            out += escHtml(s[i]);
            i++;
          }
          if (isStyleOpen && !selfClose) {
            const closeIdx = s.slice(i).search(/<\/style\s*>/i);
            if (closeIdx >= 0) {
              out += highlightCssSegment(s.slice(i, i + closeIdx), false);
              i += closeIdx;
            } else {
              out += highlightCssSegment(s.slice(i), false);
              i = len;
            }
          }
          continue;
        }
      }
      const nextTag = s.indexOf('<', i + 1);
      const chunk = nextTag < 0 ? s.slice(i) : s.slice(i, nextTag);
      out += renderTextWithHex(chunk, '');
      i += chunk.length;
    }
    return out;
  }

  const JS_KEYWORDS = new Set([
    'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
    'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'finally',
    'for', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'of',
    'return', 'static', 'super', 'switch', 'this', 'throw', 'try', 'typeof',
    'var', 'void', 'while', 'with', 'yield'
  ]);
  const JS_LITERALS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);
  const JS_GLOBALS = new Set([
    'MiniSketchTools', 'MiniSketchExtensions', 'MiniSketchFonts', 'MiniSketchAI',
    'NS', 'api', 'window', 'document', 'localStorage', 'Math', 'JSON', 'Array',
    'Object', 'Number', 'String', 'Boolean', 'Set', 'Map', 'Promise', 'Error',
    'RegExp', 'Date', 'URL', 'FileReader', 'isFinite', 'isNaN', 'parseInt',
    'parseFloat', 'console', 'setTimeout', 'clearTimeout', 'fetch', 'el'
  ]);
  const REGEX_PREV_KW = new Set([
    'return', 'throw', 'case', 'in', 'of', 'typeof', 'void', 'delete', 'await', 'yield', 'new', 'else'
  ]);

  function looksLikeHtmlOrSvg(text) {
    return /<(?:!DOCTYPE|!--|[A-Za-z][A-Za-z0-9:-]*)(?:[\s>/]|$)/.test(text);
  }

  function highlightStringOrTemplateBody(body) {
    if (!body) return '';
    if (looksLikeHtmlOrSvg(body)) return highlightHtmlSegment(body);
    return renderTextWithHex(body, 'hl-str');
  }

  function highlightJsSegment(src) {
    const s = String(src || '');
    const len = s.length;
    let i = 0;
    let out = '';
    let allowRegex = true;

    while (i < len) {
      const ch = s[i];
      if (/\s/.test(ch)) {
        let j = i + 1;
        while (j < len && /\s/.test(s[j])) j++;
        out += escHtml(s.slice(i, j));
        i = j;
        continue;
      }
      if (ch === '/' && s[i + 1] === '/') {
        const nl = s.indexOf('\n', i + 2);
        const j = nl < 0 ? len : nl;
        out += spanTok('hl-com', s.slice(i, j));
        i = j;
        continue;
      }
      if (ch === '/' && s[i + 1] === '*') {
        const end = s.indexOf('*/', i + 2);
        const j = end < 0 ? len : end + 2;
        out += spanTok('hl-com', s.slice(i, j));
        i = j;
        continue;
      }
      if (ch === '/' && allowRegex) {
        let j = i + 1;
        let inClass = false;
        let closed = false;
        while (j < len && s[j] !== '\n') {
          if (s[j] === '\\') { j += 2; continue; }
          if (s[j] === '[') inClass = true;
          else if (s[j] === ']' && inClass) inClass = false;
          else if (s[j] === '/' && !inClass) { j++; closed = true; break; }
          j++;
        }
        if (closed) {
          while (j < len && /[a-z]/i.test(s[j])) j++;
          out += spanTok('hl-str', s.slice(i, j));
          i = j;
          allowRegex = false;
          continue;
        }
      }
      if (ch === '"' || ch === "'") {
        const q = ch;
        let j = i + 1;
        while (j < len && s[j] !== '\n') {
          if (s[j] === '\\') { j += 2; continue; }
          if (s[j] === q) { break; }
          j++;
        }
        const hasClose = j < len && s[j] === q;
        const body = s.slice(i + 1, j);
        out += spanTok('hl-str', q) + highlightStringOrTemplateBody(body) + (hasClose ? spanTok('hl-str', q) : '');
        i = hasClose ? j + 1 : j;
        allowRegex = false;
        continue;
      }
      if (ch === '`') {
        out += spanTok('hl-str', '`');
        i++;
        let segStart = i;
        while (i < len) {
          if (s[i] === '\\') {
            i += 2;
            continue;
          }
          if (s[i] === '`') {
            out += highlightStringOrTemplateBody(s.slice(segStart, i));
            out += spanTok('hl-str', '`');
            i++;
            break;
          }
          if (s[i] === '$' && s[i + 1] === '{') {
            out += highlightStringOrTemplateBody(s.slice(segStart, i));
            out += spanTok('hl-punct', '${');
            i += 2;
            const exprStart = i;
            let depth = 1;
            while (i < len && depth > 0) {
              const c = s[i];
              if (c === '\\') { i += 2; continue; }
              if (c === '"' || c === "'") {
                const q2 = c;
                i++;
                while (i < len && s[i] !== q2) {
                  if (s[i] === '\\') i += 2;
                  else i++;
                }
                if (i < len) i++;
                continue;
              }
              if (c === '`') {
                // Skip nested template cleanly
                i++;
                let nd = 0;
                while (i < len) {
                  if (s[i] === '\\') { i += 2; continue; }
                  if (s[i] === '$' && s[i + 1] === '{') { nd++; i += 2; continue; }
                  if (s[i] === '}' && nd > 0) { nd--; i++; continue; }
                  if (s[i] === '`' && nd === 0) { i++; break; }
                  i++;
                }
                continue;
              }
              if (c === '{') depth++;
              else if (c === '}') {
                depth--;
                if (depth === 0) break;
              }
              i++;
            }
            out += highlightJsSegment(s.slice(exprStart, i));
            if (i < len && s[i] === '}') {
              out += spanTok('hl-punct', '}');
              i++;
            }
            segStart = i;
            continue;
          }
          i++;
        }
        if (i >= len && s[i - 1] !== '`') {
          out += highlightStringOrTemplateBody(s.slice(segStart, len));
        }
        allowRegex = false;
        continue;
      }
      if (/\d/.test(ch) || (ch === '.' && /\d/.test(s[i + 1] || ''))) {
        const m = s.slice(i).match(/^(?:0x[0-9a-fA-F]+|0b[01]+|0o[0-7]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\b/);
        if (m) {
          out += spanTok('hl-num', m[0]);
          i += m[0].length;
          allowRegex = false;
          continue;
        }
      }
      if (/[A-Za-z_$]/.test(ch)) {
        const m = s.slice(i).match(/^[A-Za-z_$][\w$]*/);
        const word = m[0];
        let k = i + word.length;
        while (k < len && /\s/.test(s[k])) k++;
        const isCall = s[k] === '(';
        const prevDot = i > 0 && s[i - 1] === '.';
        let cls = '';
        if (!prevDot && JS_KEYWORDS.has(word)) cls = 'hl-kw';
        else if (!prevDot && JS_LITERALS.has(word)) cls = 'hl-num';
        else if (!prevDot && JS_GLOBALS.has(word)) cls = 'hl-api';
        else if (isCall) cls = 'hl-fn';
        out += spanTok(cls, word);
        i += word.length;
        allowRegex = !prevDot && REGEX_PREV_KW.has(word);
        continue;
      }
      if (/[{}()[\];,.?:!~%^&*+=<>|/-]/.test(ch)) {
        const two = s.slice(i, i + 2);
        const tok = (two === '=>' || two === '==' || two === '!=' || two === '<=' || two === '>=' || two === '&&' || two === '||' || two === '??' || two === '++' || two === '--')
          ? two : ch;
        out += spanTok('hl-punct', tok);
        i += tok.length;
        allowRegex = tok !== ')' && tok !== ']' && tok !== '++' && tok !== '--';
        continue;
      }
      out += escHtml(ch);
      i++;
      allowRegex = false;
    }
    return out;
  }

  function highlightCode(src) {
    const text = String(src == null ? '' : src);
    if (!text) return '';
    const trimmed = text.trimStart();
    if (/^<(?:!DOCTYPE|!--|[A-Za-z][A-Za-z0-9:-]*)/i.test(trimmed)) {
      return highlightHtmlSegment(text);
    }
    if (/^(?:\/\*(?:[\s\S]*?)\*\/\s*)?(?:@[a-z-]+|:root\b|[.#][A-Za-z_-][\w-]*\s*\{)/i.test(trimmed) && !/\b(?:function|const|let|var|MiniSketchTools)\b/.test(trimmed)) {
      return highlightCssSegment(text, false);
    }
    return highlightJsSegment(text);
  }
  NS.highlightCode = highlightCode;

  function syncCodeEditor(textareaId) {
    const ta = el(textareaId);
    const codeEl = el(textareaId + '-hl');
    if (!ta || !codeEl) return;
    const pre = codeEl.parentNode;
    const wrap = pre && pre.parentNode;
    if (wrap && wrap.classList) wrap.classList.add('is-hl');
    const val = String(ta.value || '');
    // Append one trailing space/newline when ending with \n so <pre> height matches <textarea>'s trailing empty line
    codeEl.innerHTML = val ? (highlightCode(val) + (val.endsWith('\n') ? '\n' : '')) : '';
    if (pre) {
      pre.scrollTop = ta.scrollTop;
      pre.scrollLeft = ta.scrollLeft;
    }
  }

  function setEditorCode(textareaId, code) {
    const ta = el(textareaId);
    if (ta) ta.value = code == null ? '' : String(code);
    syncCodeEditor(textareaId);
  }

  function wireCodeEditor(textareaId, onChange) {
    const ta = el(textareaId);
    const codeEl = el(textareaId + '-hl');
    if (!ta) return;
    if (codeEl) {
      const pre = codeEl.parentNode;
      const syncScroll = () => {
        if (pre) {
          pre.scrollTop = ta.scrollTop;
          pre.scrollLeft = ta.scrollLeft;
        }
      };
      ta.addEventListener('input', () => {
        syncCodeEditor(textareaId);
        if (onChange) onChange();
      });
      ta.addEventListener('scroll', syncScroll);
      ta.addEventListener('keydown', (ev) => {
        if (ev.key === 'Tab' && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
          ev.preventDefault();
          const start = ta.selectionStart || 0;
          const end = ta.selectionEnd || 0;
          if (typeof ta.setRangeText === 'function') {
            ta.setRangeText('  ', start, end, 'end');
          } else {
            ta.value = ta.value.slice(0, start) + '  ' + ta.value.slice(end);
            ta.selectionStart = ta.selectionEnd = start + 2;
          }
          syncCodeEditor(textareaId);
          if (onChange) onChange();
        }
      });
      syncCodeEditor(textareaId);
    }
  }

  function setStatus(id, msg, kind) {
    const node = el(id);
    if (!node) return;
    node.textContent = msg || '';
    node.className = 'ext-status' + (kind === 'ok' ? ' is-ok' : kind === 'err' ? ' is-err' : '');
  }

  function setTab(tab) {
    activeTab = tab || 'installed';
    document.querySelectorAll('[data-ext-tab]').forEach(btn => {
      const on = btn.dataset.extTab === activeTab;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('[data-ext-pane]').forEach(pane => {
      pane.hidden = pane.dataset.extPane !== activeTab;
    });
    if (activeTab === 'installed') renderInstalled();
    if (activeTab === 'marketplace' && !mktItems.length && !mktLoading) refreshMarketplace();
    if (activeTab === 'import') syncCodeEditor('ext-imp-code');
    if (activeTab === 'publish') { syncCodeEditor('ext-pub-code'); checkServerHealth(); }
  }

  function isAutoUpdateEnabled() {
    return lsGet(AUTO_UPDATE_KEY, '0') === '1';
  }

  function syncUpdateControls() {
    const updAll = el('ext-inst-update-all');
    const n = availableUpdates.size;
    if (updAll) {
      updAll.hidden = n === 0;
      updAll.textContent = n > 0 ? ('Update All (' + n + ')') : 'Update All';
    }
    const sideBtn = el('btn-ext-check-updates');
    if (sideBtn) {
      sideBtn.textContent = checkingUpdates
        ? 'Checking…'
        : n > 0
          ? ('Updates (' + n + ')')
          : 'Check Updates';
      sideBtn.classList.toggle('primary', n > 0);
    }
    const modalBtn = el('ext-inst-check');
    if (modalBtn) {
      modalBtn.disabled = checkingUpdates;
      modalBtn.textContent = checkingUpdates ? 'Checking…' : 'Check Updates';
    }
  }

  // ---- Tab 1: Installed --------------------------------------------------
  function renderInstalled() {
    const listEl = el('ext-inst-list');
    const countEl = el('ext-inst-count');
    if (!listEl || !window.MiniSketchTools || !window.MiniSketchTools.getCatalogState) return;
    const all = window.MiniSketchTools.getCatalogState();
    const q = String((el('ext-inst-search') && el('ext-inst-search').value) || '').trim().toLowerCase();
    const items = q
      ? all.filter(it => (it.name + ' ' + it.id + ' ' + it.category + ' ' + it.author).toLowerCase().includes(q))
      : all;

    const enabledTotal = all.filter(x => x.enabled).length;
    if (countEl) {
      countEl.textContent = enabledTotal + '/' + all.length + ' active';
    }
    syncUpdateControls();

    listEl.innerHTML = '';
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'ext-empty';
      empty.textContent = q ? 'No matching extensions.' : 'No extensions registered.';
      listEl.appendChild(empty);
      return;
    }

    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'ext-row' + (item.enabled ? '' : ' is-disabled');

      const main = document.createElement('div');
      main.className = 'ext-row-main';

      const titleLine = document.createElement('div');
      titleLine.className = 'ext-row-title';
      const iconSpan = document.createElement('span');
      iconSpan.className = 'ext-row-ic';
      iconSpan.innerHTML = sanitizeIcon(item.icon);
      const nameSpan = document.createElement('span');
      nameSpan.className = 'ext-name';
      nameSpan.textContent = item.name || item.label || item.id;
      const metaSpan = document.createElement('span');
      metaSpan.className = 'ext-meta';
      const srcLabel = item.builtIn
        ? 'Built-in'
        : item.preview
          ? 'Preview'
          : item.source === 'ai'
            ? 'AI Builder'
            : item.source === 'marketplace'
              ? 'Marketplace'
              : item.sourceUrl
                ? 'URL'
                : 'Local';
      const srcSaved = (!item.builtIn && (item.catalogUrl || item.sourceUrl)) ? ' · Source saved' : '';
      metaSpan.textContent = 'v' + (item.version || '1.0.0') + ' · by ' + (item.author || 'MiniSketch') + ' · ' + (item.category || 'Extension') + ' · ' + srcLabel + srcSaved;
      titleLine.appendChild(iconSpan);
      titleLine.appendChild(nameSpan);
      titleLine.appendChild(metaSpan);
      main.appendChild(titleLine);

      if (item.description) {
        const desc = document.createElement('div');
        desc.className = 'ext-row-desc';
        desc.textContent = item.description;
        main.appendChild(desc);
      }

      const actions = document.createElement('div');
      actions.className = 'ext-row-actions';

      const updInfo = availableUpdates.get(item.id);
      if (updInfo && !item.builtIn) {
        const updBtn = document.createElement('button');
        updBtn.type = 'button';
        updBtn.className = 'btn small primary';
        updBtn.textContent = 'Update v' + updInfo.toVersion;
        updBtn.title = 'Upgrade from v' + updInfo.fromVersion + ' to v' + updInfo.toVersion;
        updBtn.addEventListener('click', () => NS.applyUpdate(item.id, updBtn));
        actions.appendChild(updBtn);
      }

      const toggleLabel = document.createElement('label');
      toggleLabel.className = 'ext-toggle';
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = !!item.enabled;
      chk.addEventListener('change', () => {
        window.MiniSketchTools.setEnabled(item.id, chk.checked);
      });
      const chkTxt = document.createElement('span');
      chkTxt.textContent = item.enabled ? 'Enabled' : 'Disabled';
      toggleLabel.appendChild(chk);
      toggleLabel.appendChild(chkTxt);
      actions.appendChild(toggleLabel);

      if (item.enabled) {
        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'btn small';
        openBtn.textContent = 'Open';
        openBtn.addEventListener('click', () => {
          NS.close();
          window.MiniSketchTools.open(item.id);
        });
        actions.appendChild(openBtn);
      }

      if (!item.builtIn && item.code) {
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'btn small';
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', () => {
          setEditorCode('ext-imp-code', item.code);
          if (el('ext-imp-url') && item.sourceUrl) el('ext-imp-url').value = item.sourceUrl;
          setStatus('ext-imp-status', 'Loaded "' + item.id + '" into editor. Click Install after editing.', '');
          setTab('import');
        });
        actions.appendChild(editBtn);

        const pubBtn = document.createElement('button');
        pubBtn.type = 'button';
        pubBtn.className = 'btn small';
        pubBtn.textContent = 'Publish';
        pubBtn.addEventListener('click', () => {
          NS.openPublish(item, item.code);
        });
        actions.appendChild(pubBtn);

        const expBtn = document.createElement('button');
        expBtn.type = 'button';
        expBtn.className = 'btn small';
        expBtn.textContent = 'Export .js';
        expBtn.addEventListener('click', () => {
          downloadJsFile(item.id + '.js', item.code);
        });
        actions.appendChild(expBtn);

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn small danger';
        delBtn.textContent = 'Uninstall';
        delBtn.addEventListener('click', async () => {
          const ok = window.uiConfirm
            ? await window.uiConfirm('Uninstall extension "' + (item.name || item.id) + '"?', { danger: true })
            : true;
          if (!ok) return;
          availableUpdates.delete(item.id);
          const res = window.MiniSketchTools.uninstallExtension(item.id);
          if (!res.ok && api && api.toast) api.toast(res.error);
          syncUpdateControls();
        });
        actions.appendChild(delBtn);
      }

      row.appendChild(main);
      row.appendChild(actions);
      listEl.appendChild(row);
    }
  }

  // ---- Tab 2: Marketplace ------------------------------------------------
  function renderMarketplace() {
    const listEl = el('ext-mkt-list');
    const catSel = el('ext-mkt-cat');
    if (!listEl) return;
    listEl.innerHTML = '';

    if (mktLoading) {
      const ld = document.createElement('div');
      ld.className = 'ext-empty';
      ld.textContent = 'Loading Marketplace catalog…';
      listEl.appendChild(ld);
      return;
    }

    if (mktError) {
      const er = document.createElement('div');
      er.className = 'ext-empty is-err';
      er.textContent = mktError;
      listEl.appendChild(er);
      return;
    }

    if (catSel) {
      const prevCat = catSel.value;
      const cats = Array.from(new Set(mktItems.map(x => x.category || 'CNC Utility'))).sort();
      catSel.innerHTML = '<option value="">All categories</option>';
      for (const c of cats) {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        catSel.appendChild(opt);
      }
      if (cats.includes(prevCat)) catSel.value = prevCat;
    }

    const q = String((el('ext-mkt-search') && el('ext-mkt-search').value) || '').trim().toLowerCase();
    const cat = String((catSel && catSel.value) || '').trim();
    const filtered = mktItems.filter(it => {
      if (cat && (it.category || 'CNC Utility') !== cat) return false;
      if (!q) return true;
      return (it.name + ' ' + it.id + ' ' + it.description + ' ' + it.author + ' ' + (it.category || '')).toLowerCase().includes(q);
    });

    if (!filtered.length) {
      const emp = document.createElement('div');
      emp.className = 'ext-empty';
      emp.textContent = mktItems.length ? 'No extensions match your filter.' : 'Marketplace catalog is empty.';
      listEl.appendChild(emp);
      return;
    }

    const installed = (window.MiniSketchTools && window.MiniSketchTools.getCatalogState)
      ? window.MiniSketchTools.getCatalogState()
      : [];
    const instMap = new Map(installed.map(x => [x.id, x]));

    for (const item of filtered) {
      const row = document.createElement('div');
      row.className = 'ext-row';

      const main = document.createElement('div');
      main.className = 'ext-row-main';

      const titleLine = document.createElement('div');
      titleLine.className = 'ext-row-title';
      const iconSpan = document.createElement('span');
      iconSpan.className = 'ext-row-ic';
      iconSpan.innerHTML = sanitizeIcon(item.icon);
      const nameSpan = document.createElement('span');
      nameSpan.className = 'ext-name';
      nameSpan.textContent = item.name || item.label || item.id;
      const metaSpan = document.createElement('span');
      metaSpan.className = 'ext-meta';
      metaSpan.textContent = 'v' + (item.version || '1.0.0') + ' · by ' + (item.author || 'Community') + ' · ' + (item.category || 'CNC Utility');
      titleLine.appendChild(iconSpan);
      titleLine.appendChild(nameSpan);
      titleLine.appendChild(metaSpan);
      main.appendChild(titleLine);

      if (item.description) {
        const desc = document.createElement('div');
        desc.className = 'ext-row-desc';
        desc.textContent = item.description;
        main.appendChild(desc);
      }

      const actions = document.createElement('div');
      actions.className = 'ext-row-actions';
      const localItem = instMap.get(item.id);
      const isBuiltIn = !!(localItem && localItem.builtIn);
      const needsUpdate = !!(localItem && !localItem.builtIn && compareVersions(item.version, localItem.version) > 0);
      const isInstalledSame = !!(localItem && !localItem.builtIn && !needsUpdate);

      const instBtn = document.createElement('button');
      instBtn.type = 'button';
      instBtn.className = 'btn small' + (isBuiltIn || isInstalledSame ? '' : ' primary');
      instBtn.textContent = isBuiltIn ? 'Built-in' : needsUpdate ? 'Update' : isInstalledSame ? 'Installed' : 'Install';
      instBtn.disabled = isBuiltIn;
      instBtn.addEventListener('click', () => installMarketplaceItem(item, instBtn));
      actions.appendChild(instBtn);

      const testBtn = document.createElement('button');
      testBtn.type = 'button';
      testBtn.className = 'btn small';
      testBtn.textContent = 'Test Run';
      testBtn.disabled = isBuiltIn;
      testBtn.title = 'Load temporarily without saving and open tool dialog';
      testBtn.addEventListener('click', () => previewMarketplaceItem(item, testBtn));
      actions.appendChild(testBtn);

      row.appendChild(main);
      row.appendChild(actions);
      listEl.appendChild(row);
    }
  }

  async function fetchCatalogJson(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const list = Array.isArray(data) ? data : (data && Array.isArray(data.extensions) ? data.extensions : null);
    if (!list) throw new Error('Invalid catalog JSON format');
    return list;
  }

  async function refreshMarketplace() {
    const urlInput = el('ext-mkt-url');
    const customUrl = String((urlInput && urlInput.value) || '').trim();
    const primaryUrl = customUrl || defaultMarketplaceUrl();
    lsSet(MKT_URL_KEY, customUrl || primaryUrl);

    mktLoading = true;
    mktError = '';
    renderMarketplace();
    setStatus('ext-mkt-status', 'Fetching catalog…', '');

    try {
      let usedUrl = primaryUrl;
      let list = null;
      try {
        list = await fetchCatalogJson(primaryUrl);
      } catch (err) {
        // Fallback to static catalog.json if default API endpoint isn't mounted (e.g. GitHub Pages)
        if (primaryUrl === 'api/marketplace/catalog') {
          usedUrl = 'marketplace/catalog.json';
          list = await fetchCatalogJson(usedUrl);
        } else {
          throw err;
        }
      }
      mktItems = list.filter(x => x && x.id && x.scriptUrl);
      mktSourceResolved = usedUrl;
      mktLoading = false;
      setStatus('ext-mkt-status', mktItems.length + ' extension(s) available · ' + usedUrl, 'ok');
      renderMarketplace();
    } catch (err) {
      mktLoading = false;
      mktItems = [];
      mktError = 'Cannot load catalog from "' + primaryUrl + '": ' + String(err && err.message || err) + '. Start "node server/serve.js" (port 8090) or paste a GitHub/jsDelivr catalog.json URL.';
      setStatus('ext-mkt-status', 'Catalog unavailable', 'err');
      renderMarketplace();
    }
  }

  async function fetchMarketplaceScript(item) {
    const scriptUrl = resolveUrl(item.scriptUrl, mktSourceResolved || defaultMarketplaceUrl());
    const res = await fetch(scriptUrl, { cache: 'no-cache' });
    if (!res.ok) throw new Error('Failed to fetch script (' + res.status + ')');
    return { code: await res.text(), scriptUrl };
  }

  async function fetchMarketplaceCatalog(catalogUrl) {
    try {
      return { usedUrl: catalogUrl, list: await fetchCatalogJson(catalogUrl) };
    } catch (err) {
      if (catalogUrl === 'api/marketplace/catalog') {
        const fallback = 'marketplace/catalog.json';
        return { usedUrl: fallback, list: await fetchCatalogJson(fallback) };
      }
      throw err;
    }
  }

  async function installMarketplaceItem(item, btn) {
    const prevText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Installing…'; }
    try {
      const catUrl = mktSourceResolved || String((el('ext-mkt-url') && el('ext-mkt-url').value) || '').trim() || defaultMarketplaceUrl();
      const { code, scriptUrl } = await fetchMarketplaceScript(item);
      const res = window.MiniSketchTools.installExtension({
        id: item.id,
        name: item.name || item.label || item.id,
        label: item.label || item.name || item.id,
        version: item.version || '1.0.0',
        author: item.author || 'Community',
        category: item.category || 'CNC Utility',
        description: item.description || '',
        icon: item.icon || '',
        source: 'marketplace',
        sourceUrl: scriptUrl,
        catalogUrl: catUrl
      }, code);
      if (!res.ok) throw new Error(res.error || 'Validation failed');
      availableUpdates.delete(item.id);
      syncUpdateControls();
      setStatus('ext-mkt-status', 'Installed "' + (res.tool.label || res.tool.id) + '" v' + res.tool.version + ' to Extensions panel.', 'ok');
      if (api && api.toast) api.toast('Installed "' + (res.tool.label || res.tool.id) + '"');
      renderMarketplace();
    } catch (err) {
      setStatus('ext-mkt-status', 'Install failed: ' + String(err && err.message || err), 'err');
      if (btn) { btn.disabled = false; btn.textContent = prevText; }
    }
  }

  async function previewMarketplaceItem(item, btn) {
    const prevText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
    try {
      const { code, scriptUrl } = await fetchMarketplaceScript(item);
      const res = window.MiniSketchTools.installExtension({
        id: item.id,
        name: item.name || item.label || item.id,
        label: item.label || item.name || item.id,
        version: item.version || '1.0.0',
        author: item.author || 'Community',
        category: item.category || 'CNC Utility',
        description: item.description || '',
        sourceUrl: scriptUrl
      }, code, { preview: true });
      if (!res.ok) throw new Error(res.error || 'Validation failed');
      NS.close();
      window.MiniSketchTools.open(res.tool.id);
    } catch (err) {
      setStatus('ext-mkt-status', 'Preview failed: ' + String(err && err.message || err), 'err');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = prevText; }
    }
  }

  // ---- Tab 3: Add / Import -----------------------------------------------
  function validateImportEditor() {
    const code = el('ext-imp-code') ? el('ext-imp-code').value : '';
    const v = window.MiniSketchTools.validateExtensionCode(code);
    if (!v.ok) {
      setStatus('ext-imp-status', 'Invalid: ' + v.errors.join(' · '), 'err');
    } else if (v.warnings.length) {
      setStatus('ext-imp-status', 'Valid (' + v.extracted.id + ') — Warning: ' + v.warnings[0], 'ok');
    } else {
      setStatus('ext-imp-status', 'Valid extension "' + (v.extracted.label || v.extracted.id) + '" (' + v.extracted.id + ')', 'ok');
    }
    return v;
  }

  function installFromImport(preview) {
    const code = el('ext-imp-code') ? el('ext-imp-code').value : '';
    const v = validateImportEditor();
    if (!v.ok) return;
    const meta = {
      id: v.extracted.id,
      name: v.extracted.label || v.extracted.id,
      label: v.extracted.label || v.extracted.id,
      title: v.extracted.title,
      version: v.extracted.version || '1.0.0',
      author: v.extracted.author || 'Local User',
      category: v.extracted.category || 'CNC Utility',
      description: v.extracted.description || v.extracted.title || '',
      icon: v.extracted.icon || '',
      source: preview ? 'preview' : 'local',
      sourceUrl: String((el('ext-imp-url') && el('ext-imp-url').value) || '').trim()
    };
    const res = window.MiniSketchTools.installExtension(meta, code, { preview: !!preview });
    if (!res.ok) {
      setStatus('ext-imp-status', res.error || 'Failed to load extension.', 'err');
      return;
    }
    if (!preview) {
      availableUpdates.delete(res.tool.id);
      syncUpdateControls();
    }
    if (preview) {
      setStatus('ext-imp-status', 'Preview loaded — opening dialog…', 'ok');
      NS.close();
      window.MiniSketchTools.open(res.tool.id);
    } else {
      setStatus('ext-imp-status', 'Installed "' + (res.tool.label || res.tool.id) + '" permanently.', 'ok');
      if (api && api.toast) api.toast('Extension "' + (res.tool.label || res.tool.id) + '" installed');
    }
  }

  // ---- Update Checker & Auto-Update --------------------------------------
  NS.applyUpdate = async (id, btn) => {
    const upd = availableUpdates.get(String(id || ''));
    if (!upd || !window.MiniSketchTools || !window.MiniSketchTools.installExtension) return { ok: false, error: 'Update not found.' };
    if (btn) { btn.disabled = true; btn.textContent = 'Updating…'; }
    try {
      const entry = upd.entry || {};
      const res = window.MiniSketchTools.installExtension({
        id: upd.id,
        name: entry.name || entry.label || upd.id,
        label: entry.label || entry.name || upd.id,
        version: upd.toVersion,
        author: entry.author || upd.author || 'Community',
        category: entry.category || upd.category || 'CNC Utility',
        description: entry.description || upd.description || '',
        icon: entry.icon || upd.icon || '',
        source: upd.source || 'marketplace',
        sourceUrl: upd.scriptUrl || upd.sourceUrl || '',
        catalogUrl: upd.catalogUrl || ''
      }, upd.code);
      if (!res.ok) throw new Error(res.error || 'Validation failed');
      availableUpdates.delete(upd.id);
      syncUpdateControls();
      renderInstalled();
      setStatus('ext-inst-status', 'Updated "' + (res.tool.label || res.tool.id) + '" to v' + res.tool.version + '.', 'ok');
      return { ok: true, tool: res.tool };
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = 'Update v' + upd.toVersion; }
      setStatus('ext-inst-status', 'Update failed for "' + upd.id + '": ' + String(err && err.message || err), 'err');
      return { ok: false, error: String(err && err.message || err) };
    }
  };

  NS.applyAllUpdates = async () => {
    const ids = [...availableUpdates.keys()];
    if (!ids.length) return 0;
    let updated = 0;
    for (const id of ids) {
      const r = await NS.applyUpdate(id);
      if (r.ok) updated++;
    }
    if (updated && api && api.toast) {
      api.toast('Updated ' + updated + ' extension' + (updated > 1 ? 's' : ''));
    }
    return updated;
  };

  NS.checkUpdates = async (opts) => {
    const o = opts || {};
    if (checkingUpdates || !window.MiniSketchTools || !window.MiniSketchTools.getCatalogState) {
      return { checked: 0, updates: [], applied: 0 };
    }
    const all = window.MiniSketchTools.getCatalogState();
    const savedMkt = String((el('ext-mkt-url') && el('ext-mkt-url').value) || lsGet(MKT_URL_KEY, '') || defaultMarketplaceUrl()).trim();
    const candidates = all.filter(it => !it.builtIn && !it.preview && (it.catalogUrl || it.source === 'marketplace' || it.sourceUrl));

    if (!candidates.length) {
      availableUpdates.clear();
      syncUpdateControls();
      if (!o.silent) {
        setStatus('ext-inst-status', 'No extensions with a saved Marketplace or URL source to check.', '');
      }
      return { checked: 0, updates: [], applied: 0 };
    }

    checkingUpdates = true;
    syncUpdateControls();
    if (!o.silent) setStatus('ext-inst-status', 'Checking ' + candidates.length + ' extension(s) for updates…', '');

    const catalogCache = new Map();
    const found = [];
    let checked = 0;
    let errCount = 0;

    try {
      for (const item of candidates) {
        checked++;
        const catUrl = item.catalogUrl || (item.source === 'marketplace' ? (mktSourceResolved || savedMkt) : '');
        if (catUrl) {
          try {
            let catObj = catalogCache.get(catUrl);
            if (!catObj) {
              catObj = await fetchMarketplaceCatalog(catUrl);
              catalogCache.set(catUrl, catObj);
            }
            const entry = catObj.list.find(x => x && x.id === item.id);
            if (entry && compareVersions(entry.version, item.version) > 0) {
              const sUrl = resolveUrl(entry.scriptUrl, catObj.usedUrl || catUrl);
              const res = await fetch(sUrl, { cache: 'no-cache' });
              if (!res.ok) throw new Error('HTTP ' + res.status);
              const code = await res.text();
              const val = window.MiniSketchTools.validateExtensionCode(code);
              if (!val.ok) throw new Error(val.errors[0]);
              found.push({
                id: item.id,
                fromVersion: item.version || '1.0.0',
                toVersion: entry.version,
                entry,
                scriptUrl: sUrl,
                catalogUrl: catObj.usedUrl || catUrl,
                source: 'marketplace',
                code
              });
            }
          } catch (err) {
            errCount++;
          }
        } else if (item.sourceUrl) {
          try {
            const sUrl = resolveUrl(item.sourceUrl, defaultMarketplaceUrl());
            const res = await fetch(sUrl, { cache: 'no-cache' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const code = await res.text();
            const val = window.MiniSketchTools.validateExtensionCode(code);
            if (!val.ok) throw new Error(val.errors[0]);
            const remoteVer = (val.extracted && val.extracted.version) || '1.0.0';
            if (compareVersions(remoteVer, item.version) > 0) {
              found.push({
                id: item.id,
                fromVersion: item.version || '1.0.0',
                toVersion: remoteVer,
                entry: val.extracted || {},
                scriptUrl: sUrl,
                catalogUrl: '',
                source: item.source || 'local',
                code
              });
            }
          } catch (err) {
            errCount++;
          }
        }
      }
    } finally {
      checkingUpdates = false;
    }

    availableUpdates.clear();
    for (const u of found) availableUpdates.set(u.id, u);

    let applied = 0;
    if (found.length && o.autoApply) {
      applied = await NS.applyAllUpdates();
    } else {
      syncUpdateControls();
      renderInstalled();
    }

    if (o.autoApply && applied > 0) {
      setStatus('ext-inst-status', 'Auto-updated ' + applied + ' extension' + (applied > 1 ? 's' : '') + '.', 'ok');
    } else if (found.length) {
      setStatus('ext-inst-status', found.length + ' update' + (found.length > 1 ? 's' : '') + ' available.', 'ok');
      if (!o.silent && api && api.toast) {
        api.toast(found.length + ' extension update' + (found.length > 1 ? 's' : '') + ' available');
      }
    } else if (!o.silent) {
      const msg = errCount && errCount === checked
        ? 'Could not reach extension update sources (check server/network).'
        : 'All ' + checked + ' tracked extension(s) are up to date.';
      setStatus('ext-inst-status', msg, errCount === checked ? 'err' : 'ok');
      if (api && api.toast && errCount < checked) api.toast('Extensions are up to date');
    }

    return { checked, updates: found, applied };
  };

  // ---- Tab 4: Publish (Server + GitHub Static Repo) ----------------------
  function fillPublishForm(meta, code) {
    const m = meta || {};
    let ex = {};
    if (code && window.MiniSketchTools && window.MiniSketchTools.validateExtensionCode) {
      const v = window.MiniSketchTools.validateExtensionCode(code);
      ex = v.extracted || {};
    }
    if (el('ext-pub-id')) el('ext-pub-id').value = m.id || ex.id || '';
    if (el('ext-pub-name')) el('ext-pub-name').value = m.name || m.label || ex.label || m.id || ex.id || '';
    if (el('ext-pub-ver')) el('ext-pub-ver').value = m.version || ex.version || '1.0.0';
    if (el('ext-pub-author')) el('ext-pub-author').value = m.author || ex.author || 'Community';
    if (el('ext-pub-cat')) el('ext-pub-cat').value = m.category || ex.category || 'CNC Utility';
    if (el('ext-pub-desc')) el('ext-pub-desc').value = m.description || m.title || ex.description || '';
    if (code != null) setEditorCode('ext-pub-code', code);
  }

  function readPublishForm() {
    const id = String((el('ext-pub-id') && el('ext-pub-id').value) || '').trim().toLowerCase();
    const name = String((el('ext-pub-name') && el('ext-pub-name').value) || '').trim();
    const version = String((el('ext-pub-ver') && el('ext-pub-ver').value) || '1.0.0').trim() || '1.0.0';
    const author = String((el('ext-pub-author') && el('ext-pub-author').value) || 'Community').trim() || 'Community';
    const category = String((el('ext-pub-cat') && el('ext-pub-cat').value) || 'CNC Utility').trim() || 'CNC Utility';
    const description = String((el('ext-pub-desc') && el('ext-pub-desc').value) || '').trim();
    const code = String((el('ext-pub-code') && el('ext-pub-code').value) || '');
    return { id, name: name || id, label: name || id, version, author, category, description, code };
  }

  function syncPublishTargetUI() {
    const tgt = el('ext-pub-target') ? el('ext-pub-target').value : 'server';
    const srvBox = el('ext-pub-server-box');
    const ghBox = el('ext-pub-github-box');
    if (srvBox) srvBox.hidden = tgt !== 'server';
    if (ghBox) ghBox.hidden = tgt !== 'github';
    if (tgt === 'server') checkServerHealth();
  }

  async function checkServerHealth() {
    const urlEl = el('ext-pub-server-url');
    const base = String((urlEl && urlEl.value) || defaultServerUrl()).trim().replace(/\/+$/, '');
    const keyRow = el('ext-pub-key-row');
    try {
      const res = await fetch(base + '/health', { cache: 'no-cache' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      if (keyRow) keyRow.classList.toggle('is-required', !!data.requiresPublishKey);
      setStatus(
        'ext-pub-status',
        data.requiresPublishKey
          ? 'Server online (' + base + ') — Publish Key required.'
          : 'Server online (' + base + ') — ready for permanent publish.',
        'ok'
      );
    } catch (err) {
      setStatus(
        'ext-pub-status',
        'Server offline at ' + base + '. Start "node server/serve.js" (port 8090) or switch Target to GitHub Static Repo.',
        'err'
      );
    }
  }

  async function publishToServer() {
    const payload = readPublishForm();
    const val = window.MiniSketchTools.validateExtensionCode(payload.code);
    if (!val.ok) {
      setStatus('ext-pub-status', 'Fix code errors first: ' + val.errors[0], 'err');
      return;
    }
    const base = String((el('ext-pub-server-url') && el('ext-pub-server-url').value) || defaultServerUrl()).trim().replace(/\/+$/, '');
    lsSet(SERVER_URL_KEY, base);
    const pubKey = String((el('ext-pub-key') && el('ext-pub-key').value) || '').trim();
    const overwrite = !!(el('ext-pub-overwrite') && el('ext-pub-overwrite').checked);

    const headers = { 'Content-Type': 'application/json' };
    if (pubKey) headers['X-Publish-Key'] = pubKey;

    setStatus('ext-pub-status', 'Publishing to ' + base + '…', '');
    try {
      const res = await fetch(base + '/api/marketplace/publish', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          meta: {
            id: payload.id,
            name: payload.name,
            label: payload.label,
            version: payload.version,
            author: payload.author,
            category: payload.category,
            description: payload.description,
            icon: (val.extracted && val.extracted.icon) || ''
          },
          code: payload.code,
          overwrite
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error((data && data.error) || ('HTTP ' + res.status));
      }
      const shareUrl = resolveUrl(data.scriptUrl || ('marketplace/extensions/' + payload.id + '.js'), base + '/');
      setStatus('ext-pub-status', 'Published permanently! Download URL: ' + shareUrl, 'ok');
      if (api && api.toast) api.toast('Published "' + payload.name + '" to server marketplace');
      mktItems = []; // force marketplace refresh on next view
    } catch (err) {
      setStatus('ext-pub-status', 'Publish failed: ' + String(err && err.message || err), 'err');
    }
  }

  async function githubRequest(url, token, method, body) {
    const headers = {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + token
    };
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, {
      method: method || 'GET',
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
  }

  async function publishToGitHub() {
    const payload = readPublishForm();
    const val = window.MiniSketchTools.validateExtensionCode(payload.code);
    if (!val.ok) {
      setStatus('ext-pub-status', 'Fix code errors first: ' + val.errors[0], 'err');
      return;
    }

    const repo = String((el('ext-pub-gh-repo') && el('ext-pub-gh-repo').value) || '').trim();
    const branch = String((el('ext-pub-gh-branch') && el('ext-pub-gh-branch').value) || 'main').trim() || 'main';
    const extDir = String((el('ext-pub-gh-dir') && el('ext-pub-gh-dir').value) || 'marketplace/extensions').trim().replace(/^\/+|\/+$/g, '');
    const catPath = String((el('ext-pub-gh-cat') && el('ext-pub-gh-cat').value) || 'marketplace/catalog.json').trim().replace(/^\/+/, '');
    const token = String((el('ext-pub-gh-token') && el('ext-pub-gh-token').value) || '').trim();

    lsSet(GH_CFG_KEY, JSON.stringify({ repo, branch, extDir, catPath }));

    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
      setStatus('ext-pub-status', 'Enter GitHub repository as "owner/repo".', 'err');
      return;
    }
    if (!token) {
      setStatus('ext-pub-status', 'Enter a GitHub Personal Access Token (contents:write) or use Download .js + Copy catalog.json below.', 'err');
      return;
    }

    const scriptPath = (extDir ? extDir + '/' : '') + payload.id + '.js';
    const apiBase = 'https://api.github.com/repos/' + repo + '/contents/';

    setStatus('ext-pub-status', 'Uploading ' + scriptPath + ' to GitHub…', '');
    try {
      // 1. Check existing script SHA if updating
      const curScript = await githubRequest(apiBase + scriptPath + '?ref=' + encodeURIComponent(branch), token, 'GET');
      const scriptBody = {
        message: 'feat(extension): publish ' + payload.id + ' v' + payload.version,
        content: utf8ToBase64(payload.code),
        branch
      };
      if (curScript.ok && curScript.json && curScript.json.sha) scriptBody.sha = curScript.json.sha;

      const putScript = await githubRequest(apiBase + scriptPath, token, 'PUT', scriptBody);
      if (!putScript.ok) {
        throw new Error((putScript.json && putScript.json.message) || ('GitHub PUT script failed (' + putScript.status + ')'));
      }

      // 2. Read & update catalog.json
      setStatus('ext-pub-status', 'Updating ' + catPath + '…', '');
      const curCat = await githubRequest(apiBase + catPath + '?ref=' + encodeURIComponent(branch), token, 'GET');
      let catalogObj = { marketplaceVersion: 1, updatedAt: new Date().toISOString(), extensions: [] };
      let catSha = null;
      if (curCat.ok && curCat.json && curCat.json.content) {
        catSha = curCat.json.sha;
        try {
          const parsed = JSON.parse(base64ToUtf8(curCat.json.content));
          if (parsed && Array.isArray(parsed.extensions)) catalogObj = parsed;
        } catch (err) { /* reset malformed catalog */ }
      }

      const relScriptUrl = scriptPath.startsWith(catPath.replace(/[^/]+$/, ''))
        ? scriptPath.slice(catPath.replace(/[^/]+$/, '').length)
        : ('https://cdn.jsdelivr.net/gh/' + repo + '@' + branch + '/' + scriptPath);

      const entry = {
        id: payload.id,
        name: payload.name,
        label: payload.label,
        version: payload.version,
        author: payload.author,
        category: payload.category,
        description: payload.description,
        ...((val.extracted && val.extracted.icon) ? { icon: val.extracted.icon } : {}),
        scriptUrl: relScriptUrl,
        updatedAt: new Date().toISOString()
      };
      const exIdx = catalogObj.extensions.findIndex(x => x && x.id === payload.id);
      if (exIdx >= 0) catalogObj.extensions[exIdx] = entry;
      else catalogObj.extensions.push(entry);
      catalogObj.updatedAt = new Date().toISOString();

      const putCatBody = {
        message: 'chore(marketplace): update catalog for ' + payload.id + ' v' + payload.version,
        content: utf8ToBase64(JSON.stringify(catalogObj, null, 2) + '\n'),
        branch
      };
      if (catSha) putCatBody.sha = catSha;

      const putCat = await githubRequest(apiBase + catPath, token, 'PUT', putCatBody);
      if (!putCat.ok) {
        throw new Error((putCat.json && putCat.json.message) || ('GitHub PUT catalog failed (' + putCat.status + ')'));
      }

      const jsdelivrCat = 'https://cdn.jsdelivr.net/gh/' + repo + '@' + branch + '/' + catPath;
      const rawCat = 'https://raw.githubusercontent.com/' + repo + '/' + branch + '/' + catPath;
      if (el('ext-mkt-url')) el('ext-mkt-url').value = rawCat;
      lsSet(MKT_URL_KEY, rawCat);
      setStatus('ext-pub-status', 'Pushed to GitHub! Raw catalog: ' + rawCat + ' · CDN: ' + jsdelivrCat, 'ok');
      if (api && api.toast) api.toast('Pushed "' + payload.name + '" to GitHub');
    } catch (err) {
      setStatus('ext-pub-status', 'GitHub push failed: ' + String(err && err.message || err), 'err');
    }
  }

  function catalogSnippetJson() {
    const p = readPublishForm();
    return JSON.stringify({
      id: p.id || 'my-tool',
      name: p.name || 'My Tool',
      label: p.label || p.name || 'My Tool',
      version: p.version || '1.0.0',
      author: p.author || 'Community',
      category: p.category || 'CNC Utility',
      description: p.description || '',
      scriptUrl: 'extensions/' + (p.id || 'my-tool') + '.js',
      updatedAt: new Date().toISOString()
    }, null, 2);
  }

  // ---- Public API & Wiring -----------------------------------------------
  NS.open = (tab, payload) => {
    const modal = el('ext-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    if (tab === 'publish' && payload) {
      fillPublishForm(payload.meta || payload, payload.code);
    } else if (tab === 'import' && payload && payload.code) {
      setEditorCode('ext-imp-code', payload.code);
      setTab('import');
      validateImportEditor();
      return;
    }
    setTab(tab || activeTab || 'installed');
  };

  NS.openPublish = (meta, code) => {
    NS.open('publish', { meta: meta || {}, code: code != null ? code : (meta && meta.code) || '' });
  };

  NS.close = () => {
    const modal = el('ext-modal');
    if (modal) modal.classList.add('hidden');
  };

  NS.mount = (appApi) => {
    api = appApi;
    if (window.MiniSketchTools && window.MiniSketchTools.onChange) {
      window.MiniSketchTools.onChange(() => {
        const modal = el('ext-modal');
        if (modal && !modal.classList.contains('hidden')) {
          if (activeTab === 'installed') renderInstalled();
          if (activeTab === 'marketplace') renderMarketplace();
        }
      });
    }

    const closeBtn = el('ext-close');
    if (closeBtn) closeBtn.addEventListener('click', NS.close);

    const modal = el('ext-modal');
    if (modal) {
      // Prevent app.js global Enter handler from closing the dialog when user presses
      // Enter inside search or URL fields inside #ext-modal.
      modal.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && ev.target && (ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT')) {
          ev.stopPropagation();
          if (ev.target.id === 'ext-mkt-url') { ev.preventDefault(); refreshMarketplace(); }
          if (ev.target.id === 'ext-imp-url') { ev.preventDefault(); el('ext-imp-fetch') && el('ext-imp-fetch').click(); }
        }
      });
    }

    document.querySelectorAll('[data-ext-tab]').forEach(btn => {
      btn.addEventListener('click', () => setTab(btn.dataset.extTab));
    });

    // Installed listeners
    const instSearch = el('ext-inst-search');
    if (instSearch) instSearch.addEventListener('input', renderInstalled);
    const instCheck = el('ext-inst-check');
    if (instCheck) instCheck.addEventListener('click', () => NS.checkUpdates({ silent: false, autoApply: false }));
    const instUpdateAll = el('ext-inst-update-all');
    if (instUpdateAll) instUpdateAll.addEventListener('click', () => NS.applyAllUpdates());
    const autoChk = el('ext-auto-update');
    if (autoChk) {
      autoChk.checked = isAutoUpdateEnabled();
      autoChk.addEventListener('change', () => {
        lsSet(AUTO_UPDATE_KEY, autoChk.checked ? '1' : '0');
        if (autoChk.checked) NS.checkUpdates({ silent: false, autoApply: true });
      });
    }
    const sideCheckBtn = el('btn-ext-check-updates');
    if (sideCheckBtn) {
      sideCheckBtn.addEventListener('click', () => {
        if (availableUpdates.size > 0) {
          NS.open('installed');
        } else {
          NS.checkUpdates({ silent: false, autoApply: isAutoUpdateEnabled() });
        }
      });
    }

    // Marketplace listeners
    const mktUrlEl = el('ext-mkt-url');
    if (mktUrlEl) {
      const savedMkt = lsGet(MKT_URL_KEY, '');
      mktUrlEl.value = savedMkt || defaultMarketplaceUrl();
    }
    const mktRefresh = el('ext-mkt-refresh');
    if (mktRefresh) mktRefresh.addEventListener('click', refreshMarketplace);
    const mktReset = el('ext-mkt-reset');
    if (mktReset) mktReset.addEventListener('click', () => {
      if (mktUrlEl) mktUrlEl.value = defaultMarketplaceUrl();
      lsSet(MKT_URL_KEY, defaultMarketplaceUrl());
      refreshMarketplace();
    });
    const mktSearch = el('ext-mkt-search');
    if (mktSearch) mktSearch.addEventListener('input', renderMarketplace);
    const mktCat = el('ext-mkt-cat');
    if (mktCat) mktCat.addEventListener('change', renderMarketplace);

    // Add / Import listeners
    const impFileBtn = el('ext-imp-pick');
    const impFile = el('ext-imp-file');
    if (impFileBtn && impFile) {
      impFileBtn.addEventListener('click', () => impFile.click());
      impFile.addEventListener('change', () => {
        const f = impFile.files && impFile.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => {
          setEditorCode('ext-imp-code', String(reader.result || ''));
          validateImportEditor();
        };
        reader.readAsText(f);
        impFile.value = '';
      });
    }
    const impFetch = el('ext-imp-fetch');
    if (impFetch) impFetch.addEventListener('click', async () => {
      const url = String((el('ext-imp-url') && el('ext-imp-url').value) || '').trim();
      if (!url) { setStatus('ext-imp-status', 'Enter a .js file URL first.', 'err'); return; }
      setStatus('ext-imp-status', 'Fetching ' + url + '…', '');
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const text = await res.text();
        setEditorCode('ext-imp-code', text);
        validateImportEditor();
      } catch (err) {
        setStatus('ext-imp-status', 'Fetch failed: ' + String(err && err.message || err), 'err');
      }
    });
    wireCodeEditor('ext-imp-code');
    wireCodeEditor('ext-pub-code');
    const impVal = el('ext-imp-validate');
    if (impVal) impVal.addEventListener('click', validateImportEditor);
    const impTest = el('ext-imp-test');
    if (impTest) impTest.addEventListener('click', () => installFromImport(true));
    const impInstall = el('ext-imp-install');
    if (impInstall) impInstall.addEventListener('click', () => installFromImport(false));
    const impPub = el('ext-imp-publish');
    if (impPub) impPub.addEventListener('click', () => {
      const code = el('ext-imp-code') ? el('ext-imp-code').value : '';
      const v = validateImportEditor();
      NS.openPublish(v.extracted || {}, code);
    });

    // Publish listeners
    const srvUrlEl = el('ext-pub-server-url');
    if (srvUrlEl) {
      srvUrlEl.value = lsGet(SERVER_URL_KEY, '') || defaultServerUrl();
      srvUrlEl.addEventListener('change', () => {
        lsSet(SERVER_URL_KEY, srvUrlEl.value.trim());
        checkServerHealth();
      });
    }
    try {
      const ghSaved = JSON.parse(lsGet(GH_CFG_KEY, 'null'));
      if (ghSaved && typeof ghSaved === 'object') {
        if (el('ext-pub-gh-repo') && ghSaved.repo) el('ext-pub-gh-repo').value = ghSaved.repo;
        if (el('ext-pub-gh-branch') && ghSaved.branch) el('ext-pub-gh-branch').value = ghSaved.branch;
        if (el('ext-pub-gh-dir') && ghSaved.extDir) el('ext-pub-gh-dir').value = ghSaved.extDir;
        if (el('ext-pub-gh-cat') && ghSaved.catPath) el('ext-pub-gh-cat').value = ghSaved.catPath;
      }
    } catch (err) { /* ignore */ }

    const pubTarget = el('ext-pub-target');
    if (pubTarget) {
      pubTarget.addEventListener('change', syncPublishTargetUI);
      syncPublishTargetUI();
    }
    const pubAuto = el('ext-pub-autofill');
    if (pubAuto) pubAuto.addEventListener('click', () => {
      const code = el('ext-pub-code') ? el('ext-pub-code').value : '';
      fillPublishForm({}, code);
    });
    const pubSrvBtn = el('ext-pub-send-server');
    if (pubSrvBtn) pubSrvBtn.addEventListener('click', publishToServer);
    const pubGhBtn = el('ext-pub-send-gh');
    if (pubGhBtn) pubGhBtn.addEventListener('click', publishToGitHub);
    const pubDlBtn = el('ext-pub-dl');
    if (pubDlBtn) pubDlBtn.addEventListener('click', () => {
      const p = readPublishForm();
      if (!p.code.trim()) { setStatus('ext-pub-status', 'Paste extension code first.', 'err'); return; }
      const fn = (p.id || 'extension') + '.js';
      downloadJsFile(fn, p.code);
      setStatus('ext-pub-status', 'Downloaded ' + fn, 'ok');
    });
    const pubCopyEntry = el('ext-pub-copy-entry');
    if (pubCopyEntry) pubCopyEntry.addEventListener('click', async () => {
      const ok = await copyText(catalogSnippetJson());
      setStatus('ext-pub-status', ok ? 'Copied catalog.json entry to clipboard.' : 'Copy failed.', ok ? 'ok' : 'err');
    });

    syncUpdateControls();
    if (isHttpOrigin() && window.MiniSketchTools && window.MiniSketchTools.getCatalogState) {
      const hasTrackable = window.MiniSketchTools.getCatalogState().some(it => !it.builtIn && (it.catalogUrl || it.source === 'marketplace' || it.sourceUrl));
      if (hasTrackable) {
        setTimeout(() => {
          NS.checkUpdates({ silent: true, autoApply: isAutoUpdateEnabled() });
        }, 1200);
      }
    }
  };

  NS._debug = { compareVersions, resolveUrl, catalogSnippetJson, availableUpdates, sanitizeIcon };
})();
