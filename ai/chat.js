// MiniSketch AI chat tab: natural-language modeling on the worksheet.
//
// Design notes (ARCHITECTURE.md):
// - No build step, no modules: this file registers window.MiniSketchAI and the
//   app.js hook `mountAiChat(api)` wires the panel created in index.html.
// - Coordinates are world mm, Y-up. The bridge clamps to +/-10000 too.
// - One chat turn = ONE undo step: the executor calls pushHistory() once,
//   runs every op, then commit() (which does updateUI + render).
// - Destructive ops (remove_entity, delete_selection) ask confirm() first.
// - Offline fallback: when no bridge URL is set, a small Indonesian/English
//   pattern parser handles the common shapes directly, no LLM needed.

(() => {
  'use strict';

  const NS = window.MiniSketchAI = window.MiniSketchAI || {};
  NS.log = [];
  NS.mode = 'chat';
  let api = null;

  const HEX_RE = /^#(?:[0-9a-f]{6})$/i;
  // KaryaCNC convention (user's machine): red is a LOW-POWER MARKING line, not
  // a drill/cut color. Through-cut is black; a drilled hole is a black circle.
  const COLOR_NAMES = {
    black: '#000000', cut: '#000000', potong: '#000000',
    blue: '#0000ff', engrave: '#0000ff',
    cyan: '#00ffff', vcarve: '#00ffff', 'v-carve': '#00ffff',
    purple: '#800080', pocket: '#800080', ungu: '#800080',
    red: '#ff0000', marking: '#ff0000', mark: '#ff0000', score: '#ff0000',
    green: '#00ff00', construction: '#00ff00', konstruksi: '#00ff00',
    maroon: '#800000', tab: '#800000',
    teal: '#008080', start: '#008080'
  };

  const normColor = (c) => {
    if (!c) return null;
    const s = String(c).trim().toLowerCase();
    if (HEX_RE.test(s)) return s;
    return COLOR_NAMES[s] || null;
  };

  function clampN(v) {
    const n = +v;
    if (!isFinite(n)) return 0;
    return Math.max(-10000, Math.min(10000, n));
  }

  const clampPt = (p) => ({ x: clampN(p && p.x), y: clampN(p && p.y) });

  function pushLog(role, text, ops) {
    NS.log.push({ role, text: String(text == null ? '' : text), ops: ops || null, at: Date.now() });
    if (NS.log.length > 200) NS.log.splice(0, NS.log.length - 200);
    persistLog();
  }

  // Chat survives a page refresh: same localStorage pattern as the document
  // (STORAGE_KEY) and settings (SETTINGS_KEY) in app.js. Transient agent
  // phases ("berpikir…") are never saved — only finished turns are.
  const CHAT_KEY = 'minisketch.chat.v1';
  function persistLog() {
    try {
      const done = NS.log.filter(m => m && m.text && !/…\s*$/.test(m.text));
      localStorage.setItem(CHAT_KEY, JSON.stringify(done.slice(-200)));
    } catch (err) { /* private mode: the chat just does not survive refresh */ }
  }
  function loadLog() {
    try {
      const raw = localStorage.getItem(CHAT_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        NS.log = arr.filter(m => m && (m.role === 'user' || m.role === 'ai' || m.role === 'sys') &&
          typeof m.text === 'string' && m.text);
      }
    } catch (err) { /* corrupted record: start clean */ }
  }

  function stateSummary() {
    if (!api) return null;
    const st = api.state;
    const ents = Object.values(st.entities || {});
    let bounds = null;
    try { bounds = api.contentBounds ? api.contentBounds() : null; } catch (err) { bounds = null; }
    let center = { x: 0, y: 0 };
    try { center = api.s2w(api.getW() / 2, api.getH() / 2) || center; } catch (err) { /* keep 0,0 */ }
    let loops = [];
    try { loops = (api.getLoops() || []).map(l => ({ area: Math.round((l.area || 0) * 100) / 100, entities: (api.loopEntities(l) || []).length })); }
    catch (err) { loops = []; }
    const typeCount = {};
    for (const e of ents) typeCount[e.type] = (typeCount[e.type] || 0) + 1;
    return {
      entities: ents.length,
      points: Object.keys(st.points || {}).length,
      constraints: Object.keys(st.constraints || {}).length,
      types: typeCount,
      selection: (api.ui.selection || []).map(s => ({ kind: s.kind, id: s.id })),
      activeLayer: api.ui.activeLayer,
      color: api.ui.color,
      bounds, center,
      loops: loops.slice(0, 12), loopCount: loops.length
    };
  }

  // Rich per-entity detail for the CURRENT user selection: bbox, area, color,
  // text content, and — crucially — which loops the entity belongs to
  // (outer ring vs enclosed counter), so the model can plan booleans.
  function describeSelection() {
    if (!api) return null;
    const st = api.state;
    const selIds = (api.ui.selection || []).filter(s => s.kind === 'entity').map(s => +s.id);
    const loops = (() => { try { return api.getLoops() || []; } catch (err) { return []; } })();
    const loopOf = {};
    loops.forEach((l, i) => {
      for (const eid of (api.loopEntities(l) || [])) loopOf[+eid] = i;
    });
    const details = selIds.map(id => {
      const e = st.entities[id];
      if (!e) return { id, missing: true };
      const d = { id, type: e.type, color: e.color || '#000000' };
      if (e.type === 'text') d.text = e.text;
      if (e.name) d.name = e.name;
      if (e.group) d.group = e.group;
      // world bbox of this entity
      try {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, ok = false;
        for (const pl of api.entityWorldPolylines(e)) {
          for (const p of pl.pts) {
            if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
            ok = true;
          }
        }
        if (ok) {
          d.bbox = {
            x: Math.round(minX * 100) / 100, y: Math.round(minY * 100) / 100,
            w: Math.round((maxX - minX) * 100) / 100, h: Math.round((maxY - minY) * 100) / 100
          };
          if (d.type === 'text') d.capHeight = d.bbox.h;
        }
      } catch (err) { /* bbox best-effort */ }
      if (loopOf[id] != null) d.loopIndex = loopOf[id];
      return d;
    });
    // loop geometry context: for each picked loop, its area and whether another
    // picked loop encloses it (outer vs counter — the boolean pairing matters)
    const loopInfo = {};
    for (const d of details) {
      if (d.loopIndex == null) continue;
      if (loopInfo[d.loopIndex]) { d.loopArea = loopInfo[d.loopIndex].area; d.enclosedBy = loopInfo[d.loopIndex].enclosedBy; continue; }
      const l = loops[d.loopIndex];
      const area = Math.round(Math.abs(l.area || 0) * 100) / 100;
      let enclosedBy = null;
      // a loop encloses this one when this loop's first point sits inside it
      try {
        const probe = (l.poly && l.poly[0]) || null;
        for (let j = 0; j < loops.length; j++) {
          if (j === d.loopIndex) continue;
          const other = loops[j];
          if (Math.abs(other.area || 0) <= Math.abs(l.area || 0)) continue;
          if (probe && api.pointInPoly(probe, other.poly || [])) { enclosedBy = j; break; }
        }
      } catch (err) { /* containment best-effort */ }
      loopInfo[d.loopIndex] = { area, enclosedBy };
      d.loopArea = area;
      d.enclosedBy = enclosedBy;
      if (enclosedBy != null) d.role = 'counter (inner)';
      else if (loops.length > 1) d.role = 'outer ring candidate';
    }
    return { count: selIds.length, entities: details, loopCount: loops.length };
  }

  // ---- executor: one validated op -> toolApi -------------------------------
  function selectEntities(ids) {
    api.ui.selection = (ids || [])
      .map(id => ({ kind: 'entity', id: +id }))
      .filter(s => api.state.entities[s.id]);
  }

  function runOp(op) {
    if (!op || !op.name) return { ok: false, error: 'empty op' };
    const a = op.arguments || op.args || {};
    switch (op.name) {
      case 'add_line': {
        const id = api.addLine(clampPt(a.a), clampPt(a.b), normColor(a.color) || undefined);
        return id ? { ok: true, id } : { ok: false, error: 'bad line points' };
      }
      case 'add_circle': {
        const r = Math.abs(+a.r);
        if (!(r > 1e-9)) return { ok: false, error: 'bad radius' };
        const id = api.addCircle(clampPt(a.c), Math.min(r, 10000), normColor(a.color) || undefined);
        return id ? { ok: true, id } : { ok: false, error: 'bad circle' };
      }
      case 'add_arc': {
        const id = api.addArc(clampPt(a.c), clampPt(a.s), clampPt(a.e), normColor(a.color) || undefined);
        return id ? { ok: true, id } : { ok: false, error: 'bad arc points' };
      }
      case 'add_spline': {
        const pts = (a.pts || []).map(clampPt);
        const id = api.addSpline({ pts, closed: !!a.closed, color: normColor(a.color) || undefined });
        return id ? { ok: true, id } : { ok: false, error: 'need 2+ points' };
      }
      case 'add_panel': {
        const pts = (a.pts || []).map(clampPt);
        const id = api.addPanelEntity(pts, normColor(a.color) || api.ui.color);
        return id ? { ok: true, id } : { ok: false, error: 'need 3+ points' };
      }
      case 'add_polyline': {
        const pts = (a.pts || []).map(clampPt);
        const id = api.addPolylineEntity(pts, normColor(a.color) || api.ui.color);
        return id ? { ok: true, id } : { ok: false, error: 'need 2+ points' };
      }
      case 'add_note': {
        const id = api.addNote(a.text, clampN(a.x), clampN(a.y));
        return id ? { ok: true, id } : { ok: false, error: 'bad note' };
      }
      case 'add_text': {
        if (typeof a.text !== 'string' || !a.text.trim()) return { ok: false, error: 'need text' };
        const id = api.addText(a.text, clampN(a.x), clampN(a.y), {
          height: a.height, font: a.font, weight: a.weight,
          italic: a.italic, tracking: a.tracking, align: a.align, color: a.color
        });
        return id ? { ok: true, id } : { ok: false, error: 'bad text params' };
      }
      case 'add_constraint': {
        const c = { type: a.type };
        const num = (v) => (v != null && isFinite(+v) ? +v : null);
        const e1 = num(a.entity), e2 = num(a.entity2);
        const p = num(a.p), p1 = num(a.p1), p2 = num(a.p2);
        // Shape mirrors cmd*() in app.js: line pairs use line1/line2, point
        // pairs use p1/p2, single-entity dims use entity, single points use p.
        if (a.type === 'parallel' || a.type === 'perpendicular' || a.type === 'equal') {
          if (e1 == null || e2 == null) return { ok: false, error: 'need entity + entity2' };
          c.line1 = e1; c.line2 = e2;
        } else if (a.type === 'coincident' || a.type === 'distance') {
          if (p1 == null || p2 == null) return { ok: false, error: 'need p1 + p2' };
          c.p1 = p1; c.p2 = p2;
        } else if (a.type === 'radius' || a.type === 'pointDim' || a.type === 'pointOn' ||
                   a.type === 'midpoint' || a.type === 'aspect' || a.type === 'angle') {
          if (e1 == null && p == null) return { ok: false, error: 'need entity or p' };
          if (e1 != null) {
            if (a.type === 'angle') { if (e2 == null) return { ok: false, error: 'angle needs entity2' }; c.line1 = e1; c.line2 = e2; }
            else c.entity = e1;
          }
          if (p != null) c.p = p;
          if (p1 != null) c.p1 = p1;
          if (p2 != null) c.p2 = p2;
        } else if (a.type === 'fix' || a.type === 'horizontal' || a.type === 'vertical' || a.type === 'tangent') {
          if (p != null) c.p = p;
          if (e1 != null) c.entity = e1;
          if (e2 != null) c.line = e2;
          if (p == null && e1 == null) return { ok: false, error: 'need p or entity' };
        } else {
          return { ok: false, error: 'unknown constraint type' };
        }
        if (a.value != null && isFinite(+a.value)) c.value = Math.max(-100000, Math.min(100000, +a.value));
        const id = api.addConstraint(c, { history: false, solve: false });
        return id ? { ok: true, id } : { ok: false, error: 'constraint rejected' };
      }
      case 'move_selection': {
        const dx = clampN(a.dx), dy = clampN(a.dy);
        if (!dx && !dy) return { ok: false, error: 'zero move' };
        api.moveSelection(dx, dy);
        return { ok: true };
      }
      case 'scale_selection': {
        const sx = +a.sx, sy = +a.sy;
        if (!isFinite(sx) || !isFinite(sy) || !sx || !sy) return { ok: false, error: 'bad scale' };
        let ox = +a.ox, oy = +a.oy;
        if (!isFinite(ox) || !isFinite(oy)) {
          const b = api.contentBounds ? api.contentBounds() : null;
          ox = b ? (b.minX + b.maxX) / 2 : 0;
          oy = b ? (b.minY + b.maxY) / 2 : 0;
        }
        api.scaleSelection(sx, sy, ox, oy);
        return { ok: true };
      }
      case 'set_selection_color': {
        const col = normColor(a.color);
        if (!col) return { ok: false, error: 'bad color' };
        const ents = api.selectedEntities();
        if (!ents.length) return { ok: false, error: 'nothing selected' };
        for (const e of ents) e.color = col;
        return { ok: true, count: ents.length };
      }
      case 'set_default_color': {
        const col = normColor(a.color);
        if (!col) return { ok: false, error: 'bad color' };
        api.ui.color = col;
        return { ok: true };
      }
      case 'remove_entity': {
        if (a.id == null || !api.state.entities[+a.id]) return { ok: false, error: 'unknown id' };
        api.removeEntity(+a.id);
        return { ok: true };
      }
      case 'delete_selection': {
        api.deleteSelection({ noHistory: true });
        return { ok: true };
      }
      case 'clear_selection': {
        api.ui.selection = [];
        return { ok: true };
      }
      case 'set_selection': {
        const ids = (Array.isArray(a.ids) ? a.ids : []).map(Number).filter(n =>
          api.state.entities[n]);
        if (!ids.length) return { ok: false, error: 'no valid entity ids' };
        selectEntities(ids);
        return { ok: true, count: ids.length, ids };
      }
      case 'text_to_curves': {
        const targets = a.id != null ? [+a.id] : api.selectedEntities().map(e => +e.id);
        const texts = targets.filter(id => api.state.entities[id] && api.state.entities[id].type === 'text');
        if (!texts.length) return { ok: false, error: 'select a text object first (or pass id)' };
        if (a.id != null) selectEntities(texts);
        const before = Object.keys(api.state.entities).length;
        api.cmdConvertToCurve();
        const after = Object.keys(api.state.entities).length;
        return { ok: true, curves: after - before + texts.length, madeIds: api.ui.selection.map(s => s.id) };
      }
      case 'ungroup': {
        api.cmdUngroupSelection();
        return { ok: true };
      }
      case 'boolean': {
        const mode = a.mode === 'cut' ? 'cut' : a.mode === 'intersect' ? 'intersect' : 'union';
        if (mode !== 'union' && api.ui.selection.filter(s => s.kind === 'entity').length < 2) {
          return { ok: false, error: mode + ' needs exactly 2+ loops: select tool loop first, then target' };
        }
        api.cmdBoolean(mode);
        return { ok: true, mode };
      }
      case 'offset_selection': {
        // stencil bridges / inlay: grow (positive mm) or shrink the selected closed loops
        const d = +a.distance;
        if (!isFinite(d) || !d) return { ok: false, error: 'need distance in mm (+grow / -shrink)' };
        const contours = [];
        for (const e of api.selectedEntities()) {
          for (const pl of api.entityWorldPolylines(e)) {
            if (pl.closed && pl.pts.length >= 3) contours.push(pl);
          }
        }
        if (!contours.length) return { ok: false, error: 'selection has no closed loops' };
        const chains = api.offsetClosedChains(contours, Math.abs(d), d < 0);
        if (!chains || !chains.length) return { ok: false, error: 'offset produced nothing' };
        const made = [];
        for (const ch of chains) {
          if (ch.pts && ch.pts.length >= 3) {
            const id = api.addPanelEntity(ch.pts, api.ui.color);
            if (id) made.push(id);
          }
        }
        if (!made.length) return { ok: false, error: 'no usable chain in result' };
        api.ui.selection = made.map(id => ({ kind: 'entity', id }));
        return { ok: true, count: made.length, ids: made };
      }
      case 'get_entities': {
        const st = api.state;
        const out = [];
        for (const id in st.entities) {
          const e = st.entities[id];
          out.push({ id: +id, type: e.type, color: e.color || '#000000', text: e.type === 'text' ? e.text : undefined });
        }
        return { ok: true, query: 'get_entities', result: out.slice(0, 100) };
      }
      case 'get_svg': {
        // The whole drawing (or just the selection) as SVG. A model reads SVG
        // natively, so this beats the raw entity dump for understanding shape.
        const scope = a.scope === 'selection' ? 'selection' : 'all';
        const svg = api.exportSVG({
          onlyVisible: a.includeHidden ? false : true,
          onlySelected: scope === 'selection',
          returnString: true
        });
        if (!svg) return { ok: false, error: scope === 'selection' ? 'nothing selected to export' : 'drawing is empty' };
        let viewBox = '';
        const m = svg.match(/viewBox="([^"]+)"/);
        if (m) viewBox = m[1];
        const bytes = svg.length;
        // a 200 KB dump blows the context window for no gain: cap it and say so
        const MAX = 60000;
        const truncated = bytes > MAX;
        return {
          ok: true, query: 'get_svg',
          // `result` is the field applyOps forwards to the model; everything
          // useful about this answer lives in it.
          result: {
            scope, viewBox, bytes, truncated,
            note: 'Y-up world millimetres; stroke colours are the CNC operations (see colorLegend). Paths are open polylines unless the shape closes.',
            svg: truncated ? svg.slice(0, MAX) : svg
          }
        };
      }
      case 'group_selection': {
        api.cmdGroupSelection({ noHistory: true });
        const sel = api.ui.selection;
        if (sel.length === 1) {
          const wrap = api.state.entities[sel[0].id];
          if (wrap && typeof a.name === 'string' && a.name.trim()) wrap.name = a.name.trim().slice(0, 80);
        }
        return { ok: true };
      }
      case 'call_generator':
        return { ok: false, error: 'generator must run alone', generator: { kind: a.kind, params: a.params || {} } };
      case 'get_selection':
        return { ok: true, query: 'get_selection', result: stateSummary().selection.map(s => {
          const e = s.kind === 'entity' ? api.state.entities[s.id] : null;
          return e ? { kind: 'entity', id: e.id, type: e.type, color: e.color || '#000000' } : s;
        }) };
      case 'use_skill': {
        const name = String(a.name || '').trim();
        if (!name) return { ok: false, error: 'need skill name' };
        NS.requestedSkills = NS.requestedSkills || [];
        if (!NS.requestedSkills.includes(name)) NS.requestedSkills.push(name);
        return { ok: true, query: 'use_skill', result: 'skill "' + name + '" will be active next round' };
      }
      case 'describe_selection': {
        const d = describeSelection();
        return d ? { ok: true, query: 'describe_selection', result: d }
                 : { ok: false, error: 'nothing selected' };
      }
      case 'import_svg': {
        // A whole SVG document becomes real entities in one op: the model
        // writes vector SVG natively, so one import_svg replaces dozens of
        // add_line / add_circle calls and stays a single undo step (applyOps
        // pushed history once for the whole batch).
        const text = String(a.svg || '');
        if (!text.trim()) return { ok: false, error: 'import_svg: empty svg' };
        if (text.length > 150000) return { ok: false, error: 'import_svg: svg too large (' + text.length + ' chars, max 150k)' };
        if (typeof api.svgImportParse !== 'function' || typeof api.svgImportInsert !== 'function')
          return { ok: false, error: 'import_svg: unavailable in this build' };
        let ir = null;
        try {
          ir = api.svgImportParse(text, {
            prefix: 'ai' + Date.now().toString(36) + '-',
            // yUp (default true): the model writes coordinates as it thinks —
            // bottom-left origin, +Y up — so import them that way, no flip.
            // Only a verbatim get_svg export (Y-down) needs yUp:false.
            flipY: a.yUp === false,
            ...(isFinite(+a.scale) && +a.scale > 0 ? { scale: +a.scale } : {})
          });
        } catch (err) {
          return { ok: false, error: 'import_svg: ' + String(err && err.message || err) };
        }
        if (!ir.items || !ir.items.length) {
          return { ok: false, error: 'import_svg: no vector shapes found in the SVG' +
            (ir.skipped && (ir.skipped.text || ir.skipped.image)
              ? ' (skipped ' + [ir.skipped.text && ir.skipped.text + ' text', ir.skipped.image && ir.skipped.image + ' image'].filter(Boolean).join(', ') + ')'
              : '') };
        }
        const at = a.at && isFinite(+a.at.x) && isFinite(+a.at.y)
          ? clampPt(a.at) : undefined;
        const made = api.svgImportInsert(ir, {
          keepGroups: !!a.keepGroups,
          ...(at ? { center: at } : {})
        });
        const ids = (made && made.entities) || [];
        if (!ids.length) return { ok: false, error: 'import_svg: nothing inserted' };
        api.ui.selection = ids.map(id => ({ kind: 'entity', id }));
        const bb = ir.bounds || {};
        return {
          ok: true, id: ids[0], query: 'import_svg',
          result: {
            entities: ids.length,
            lines: made.lines, splines: made.splines,
            circles: made.circles, grouped: made.framed,
            sizeMm: { w: Math.round((ir.mmW || 0) * 100) / 100, h: Math.round((ir.mmH || 0) * 100) / 100 },
            bounds: isFinite(bb.minX) ? { minX: bb.minX, minY: bb.minY, maxX: bb.maxX, maxY: bb.maxY } : null,
            colors: (ir.colorList || []).slice(0, 12).map(c => c.hex),
            selected: ids.length
          }
        };
      }
      case 'get_bounds':
        return { ok: true, query: 'get_bounds', result: { bounds: stateSummary().bounds, center: stateSummary().center } };
      case 'get_loops':
        return { ok: true, query: 'get_loops', result: stateSummary().loops };
      default:
        return { ok: false, error: 'unknown tool: ' + op.name };
    }
  }

  // call_generator replays dialog params into the real generator: the tool
  // modal is filled from params, then apply() runs its own pushHistory, so
  // the whole thing stays one undo step and double-click re-edit keeps working.
  function runGenerator(kind, params) {
    const tools = window.MiniSketchTools;
    if (!tools) return { ok: false, error: 'generators unavailable' };
    const tool = tools.list.find(t => t.id === kind);
    if (!tool) return { ok: false, error: 'unknown generator: ' + kind };
    tools.open(kind, params || {});
    try {
      tool.apply(api);
    } finally {
      try { tools.close(kind); } catch (err) { /* ignore */ }
    }
    return { ok: true, generator: kind };
  }

  // One batch of ops. `opts.noHistory` continues an agent turn that already
  // pushed history (round 2+ of the verify loop), so the whole agent run
  // stays ONE undo step. Returns per-op results for the agent loop feedback.
  function applyOps(ops, opts) {
    const o = opts || {};
    const list = (ops || []).filter(Boolean);
    if (!list.length) return { made: 0, errors: ['no ops'], results: [] };
    if (list.length === 1 && (list[0].name === 'call_generator' || list[0].generator)) {
      const g = list[0].name === 'call_generator'
        ? { kind: list[0].arguments.kind, params: list[0].arguments.params }
        : list[0].generator;
      const r = runGenerator(g.kind, g.params || {});
      api.commit();
      return { made: r.ok ? 1 : 0, errors: r.ok ? [] : [r.error], results: [{ op: 'call_generator', ok: r.ok, error: r.error }], generator: g.kind };
    }
    const destructive = list.some(op => op.name === 'remove_entity' || op.name === 'delete_selection');
    if (destructive && !window.confirm('AI chat wants to delete geometry. Allow? (one Undo reverts it)')) {
      return { made: 0, errors: ['cancelled by user'], results: [] };
    }
    if (!o.noHistory) api.pushHistory();
    const madeIds = [];
    const queryResults = [];
    const errors = [];
    const results = [];
    let needSolve = false;
    for (const op of list.slice(0, 20)) {
      if (op.name === 'call_generator' || op.generator) {
        errors.push('call_generator must run alone in its own turn');
        results.push({ op: 'call_generator', ok: false, error: 'must run alone' });
        continue;
      }
      let r;
      try { r = runOp(op); }
      catch (err) { r = { ok: false, error: String(err && err.message || err) }; }
      results.push({ op: op.name, ok: r.ok, id: r.id, error: r.ok ? undefined : r.error });
      if (r.ok && r.id) madeIds.push(r.id);
      if (r.ok && r.query) queryResults.push({ query: r.query, result: r.result });
      if (!r.ok && !r.generator) errors.push(op.name + ': ' + (r.error || 'failed'));
      if (r.ok && op.name === 'add_constraint') needSolve = true;
    }
    if (needSolve) { try { api.requestSolve(); } catch (err) { /* solve is best-effort */ } }
    api.commit();
    return { made: madeIds.length, ids: madeIds, queryResults, errors, results };
  }

  // ---- offline fallback: Indonesian/English pattern parser, no LLM --------
  function parseLocal(text) {
    const t = ' ' + String(text || '').toLowerCase().trim() + ' ';
    const num = (re) => { const m = t.match(re); return m ? +m[1] : null; };
    const at = (() => {
      const m = t.match(/(?:di|at|pada)\s*(-?[\d.,]+)\s*[,;]\s*(-?[\d.,]+)/);
      if (m) return { x: +String(m[1]).replace(',', '.'), y: +String(m[2]).replace(',', '.') };
      return null;
    })();
    const w = num(/(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/) != null ? +t.match(/(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/)[1].replace(',', '.') : null;
    const h = num(/(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/) != null ? +t.match(/(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/)[2].replace(',', '.') : null;
    const diam = num(/(?:diameter|diam|dm|d|ø|diameternya)\s*(\d+(?:[.,]\d+)?)/) || num(/(\d+(?:[.,]\d+)?)\s*(?:mm\s*)?(?:diameter|diam|ø)/);
    const has = (...words) => words.some(x => t.includes(x));
    const ox = at ? at.x : 0, oy = at ? at.y : 0;

    // A hole is a through-cut: black circle. Red stays reserved for low-power
    // marking lines (the user's machine convention).
    const isHole = has('lubang', 'bor', 'drill', 'hole');
    const isMark = has('marking', 'tanda', 'score', 'gosong');
    const color = isMark ? '#ff0000' : (isHole || has('kotak', 'box') ? '#000000' : null);
    if (has('kotak', 'box', 'square', 'rectangle', 'rect', 'persegi', 'plat', 'plate', 'flange') && w && h) {
      return {
        ops: [{ name: 'add_panel', arguments: {
          pts: [{ x: ox, y: oy }, { x: ox + w, y: oy }, { x: ox + w, y: oy + h }, { x: ox, y: oy + h }],
          ...(color ? { color } : {})
        } }],
        reply: 'Kotak ' + w + '×' + h + ' dibuat di (' + ox + ', ' + oy + ').'
      };
    }
    if (has('lingkaran', 'circle', 'bulat', 'bundar') || (diam && !has('kotak', 'box'))) {
      const r = diam ? diam / 2 : (num(/r\s*(\d+(?:[.,]\d+)?)/) || 10);
      const cx = at ? at.x : (has('tengah', 'center', 'middle') ? null : ox);
      const cy = at ? at.y : (has('tengah', 'center', 'middle') ? null : oy);
      let c = { x: cx != null ? cx : 0, y: cy != null ? cy : 0 };
      if (cx == null) {
        const b = api.contentBounds ? api.contentBounds() : null;
        c = b ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : { x: 0, y: 0 };
      }
      return {
        ops: [{ name: 'add_circle', arguments: { c, r, ...(color ? { color } : {}) } }],
        reply: (isHole ? 'Lubang d' + (r * 2) : 'Lingkaran r' + r) + ' dibuat di (' + c.x + ', ' + c.y + ').'
      };
    }
    if (has('garis', 'line', 'garia') && t.match(/(-?[\d.,]+)\s*[,;]\s*(-?[\d.,]+)\s+(?:ke|sampai|to|->?)\s*(-?[\d.,]+)\s*[,;]\s*(-?[\d.,]+)/)) {
      const m = t.match(/(-?[\d.,]+)\s*[,;]\s*(-?[\d.,]+)\s+(?:ke|sampai|to|->?)\s*(-?[\d.,]+)\s*[,;]\s*(-?[\d.,]+)/);
      const f = (s) => +String(s).replace(',', '.');
      return {
        ops: [{ name: 'add_line', arguments: { a: { x: f(m[1]), y: f(m[2]) }, b: { x: f(m[3]), y: f(m[4]) } } }],
        reply: 'Garis dibuat.'
      };
    }
    if (has('pindah', 'move', 'geser')) {
      const m = t.match(/(-?[\d.,]+)\s*[,;]?\s*(-?[\d.,]+)/);
      const dx = m ? +String(m[1]).replace(',', '.') : 10;
      const dy = m ? +String(m[2]).replace(',', '.') : 0;
      if (!api.ui.selection.length) return { ops: [], reply: 'Pilih dulu objeknya, lalu minta dipindah.' };
      return { ops: [{ name: 'move_selection', arguments: { dx, dy } }], reply: 'Dipindah (' + dx + ', ' + dy + ').' };
    }
    if (has('hapus', 'delete', 'buang', 'hilangkan')) {
      if (!api.ui.selection.length) return { ops: [], reply: 'Tidak ada yang dipilih.' };
      return { ops: [{ name: 'delete_selection', arguments: {} }], reply: 'Yang dipilih dihapus (Ctrl+Z untuk batal).' };
    }
    if (has('warna', 'color', 'colour', 'cat')) {
      for (const name of Object.keys(COLOR_NAMES)) {
        if (t.includes(name)) {
          if (!api.ui.selection.length) {
            return { ops: [{ name: 'set_default_color', arguments: { color: COLOR_NAMES[name] } }],
              reply: 'Warna gambar berikutnya: ' + name + '.' };
          }
          return { ops: [{ name: 'set_selection_color', arguments: { color: COLOR_NAMES[name] } }],
            reply: 'Seleksi diwarnai ' + name + '.' };
        }
      }
    }
    return null;
  }

  // ---- chat flow -----------------------------------------------------------
  function bridgeUrl() {
    try { return (api.settings.aiBridgeUrl || '').trim().replace(/\/+$/, ''); }
    catch (err) { return ''; }
  }

  async function send(text) {
    const input = String(text == null ? '' : text).trim();
    // a stop press (Kirim becomes Stop while running) aborts the request
    if (NS.activeAbort) { NS.activeAbort.abort(); return; }
    if (!input || !api) return;
    pushLog('user', input);
    renderLog();
    const url = bridgeUrl();
    if (!url) {
      const parsed = parseLocal(input);
      if (parsed && parsed.ops.length) {
        const r = applyOps(parsed.ops);
        const tail = r.errors.length ? ' (' + r.errors[0] + ')' : '';
        pushLog('ai', parsed.reply + tail, parsed.ops);
      } else if (parsed) {
        pushLog('ai', parsed.reply);
      } else {
        pushLog('ai', 'Isi AI bridge URL di Settings untuk jawaban AI, atau coba: "kotak 100x60", "lingkaran d50", "pindah 10,0", "hapus".');
      }
      renderLog();
      return;
    }
    // Agent loop: emit -> execute -> feedback (fresh state + per-op results)
    // -> verify/fix, until the model answers with no tool calls (satisfied)
    // or the round cap. One undo step total across every round.
    // The cap is user-tunable (Settings > AI chat > AI agent rounds): every
    // round is a full provider request, so fewer rounds = cheaper turns.
    const MAX_ROUNDS = Math.max(1, Math.min(8, Math.round(+api.settings.aiMaxRounds) || 4));
    // Abort handle for the Stop button: kills the fetch mid-stream without
    // killing the chat (the placeholder becomes a retryable entry).
    const ac = new AbortController();
    NS.activeAbort = ac;
    NS.setStopVisible(true);
    // ONE object for the whole turn, mutated in place: renderLog keeps a live
    // DOM reference to it, so streaming deltas update the existing nodes and
    // the thinking box keeps its scroll position while the model types.
    const liveMsg = { role: 'ai', text: '…', at: Date.now() };
    NS.log.push(liveMsg);
    NS.liveMsg = liveMsg;
    // History carries the executed op names too: when a turn stopped early
    // (round cap / Stop) and the user says "lanjutkan", the model must know
    // what it already did — not just what it said.
    const history = NS.log.filter(m => m.role !== 'sys')
      .map(m => ({
        role: m.role === 'ai' ? 'assistant' : 'user',
        content: m.text + (m.ops && m.ops.length
          ? '\n[tools executed in that turn: ' + m.ops.map(o => o.name).join(', ') + ']'
          : '')
      }))
      .filter(m => !m.content.startsWith('…'));
    let lastExec = null;
    NS.requestedSkills = [];               // use_skill ops refill this per turn
    const think = {};                      // round -> reasoning_content (deepseek)
    // live progress: update the placeholder BEFORE the fetch so the user sees
    // "thinking…" immediately, and again after each round lands
    const setPhase = (t, ops) => {
      liveMsg.text = t;
      liveMsg.ops = ops || [];
      liveMsg.thinking = Object.keys(think).map(r => think[r]).join('\n---\n') || null;
      renderLog();
    };
    // live seconds counter: the model legitimately thinks 10-40 s; a silent UI
    // invites a refresh, which kills the request and wastes the session.
    // Only the TEXT line is rewritten — the thinking payload must survive, or
    // the panel the user steers by disappears exactly while they wait.
    let waitTimer = null;
    const startWaitClock = (label) => {
      stopWaitClock();
      const t0 = Date.now();
      setPhase(label);
      waitTimer = setInterval(() => {
        const s = Math.round((Date.now() - t0) / 1000);
        liveMsg.text = label + '  (' + s + ' dtk — jangan refresh, permintaan masih berjalan)';
        renderLog();
      }, 1000);
    };
    const stopWaitClock = () => { if (waitTimer) { clearInterval(waitTimer); waitTimer = null; } };
    try {
      for (let round = 1; round <= MAX_ROUNDS; round++) {
        const messages = [...history];
        if (lastExec) {
          messages.push({
            role: 'user',
            content: '[SYSTEM FEEDBACK after your last tool calls]\n' +
              JSON.stringify({ executed: lastExec, state: stateSummary() }).slice(0, 3000) +
              (lastExec.errors && lastExec.errors.length
                ? '\nAn op FAILED (' + lastExec.errors[0] + '). Fix it: emit corrected tool calls.'
                : '\nAll ops succeeded and the state above already reflects them. Do NOT re-verify a simple, obviously-correct result (a panel at the given size/position, a circle at the given centre) unless the user\'s request was positional or you are genuinely unsure (overlapping ids, wrong place, a shape that should have closed). Otherwise reply with the final Indonesian summary and NO tool calls.')
          });
        }
        startWaitClock(lastExec
          ? 'memeriksa hasil putaran ' + (round - 1) + '…'
          : 'berpikir…');
        const res = await fetch(url + '/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages,
            stateSummary: stateSummary(),
            agent: { round, maxRounds: MAX_ROUNDS },
            requestedSkills: NS.requestedSkills || []
          }),
          signal: ac.signal
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error((j && j.error) || ('bridge ' + res.status));
        }
        // The bridge streams SSE: {delta:{thinking|content}} events live while
        // the model works, then one final {done, reply, thinking, tool_calls}.
        let data = null;
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        const liveThink = {};
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith('data:')) continue;
            let ev;
            try { ev = JSON.parse(line.slice(5)); } catch (err) { continue; }
            if (ev.delta && ev.delta.thinking) {
              liveThink[round] = (liveThink[round] || '') + ev.delta.thinking;
              think[round] = liveThink[round];
              // show reasoning AS IT ARRIVES — the whole point of streaming
              liveMsg.thinking = Object.keys(think).map(r => think[r]).join('\n---\n');
              if (!liveMsg.text || liveMsg.text === '…') liveMsg.text = 'berpikir…';
              renderLog();
            } else if (ev.done) {
              data = ev;
            }
          }
        }
        stopWaitClock();
        if (!data) throw new Error('bridge stream ended without a final event');
        const calls = (data.tool_calls || []).map(tc => ({ name: tc.name, arguments: tc.arguments || {} }));
        const roundThink = String(data.thinking || '');
        if (roundThink) think[round] = roundThink;
        if (!calls.length) {
          // no tool calls = the model is satisfied; this ends the loop
          setPhase((data.reply || 'Selesai.').trim() +
            (round > 1 ? '  (setelah ' + (round - 1) + ' verifikasi)' : ''));
          break;
        }
        setPhase('mengeksekusi ' + calls.length + ' op (putaran ' + round + '/' + MAX_ROUNDS + ')…', calls);
        const r = applyOps(calls, { noHistory: round > 1 });
        lastExec = { round, made: r.made, ids: r.ids, errors: r.errors, results: r.results };
        setPhase('putaran ' + round + '/' + MAX_ROUNDS + ': ' + r.made + ' op' +
          (r.errors.length ? ', error: ' + r.errors[0] : ', ok') + ' — memverifikasi…', calls);
        if (round === MAX_ROUNDS) {
          setPhase('Berhenti di batas ' + MAX_ROUNDS + ' putaran. Terakhir: ' + r.made + ' op' +
            (r.errors.length ? ', error: ' + r.errors[0] : '') +
            '. Ketik "lanjutkan" untuk meneruskan, atau tombol Retry untuk mengulang.', calls);
          liveMsg.retryText = input;   // Retry re-runs the whole request
        }
      }
    } catch (err) {
      stopWaitClock();
      if (ac.signal.aborted) {
        // user pressed Stop: keep what the model was thinking, keep it
        // retryable — one click resends the exact same request
        liveMsg.text = 'Dihentikan.' +
          (liveMsg.thinking ? ' (pikiran terakhir tersimpan di atas)' : '');
        liveMsg.retryText = input;
        liveMsg.ops = [];
      } else {
        // keep the failing turn retryable: remember what the user asked
        liveMsg.text = 'Bridge error: ' + (err && err.message || err) + '. Cek server/ai-bridge.js + env.';
        liveMsg.retryText = input;
        liveMsg.ops = [];
      }
    }
    NS.activeAbort = null;
    NS.setStopVisible(false);
    NS.liveMsg = null;   // the turn is finished: the next render is a full rebuild
    renderLog();
  }

  // ---- panel ---------------------------------------------------------------
  function renderLog() {
    const host = document.getElementById('chat-log');
    const count = document.getElementById('chat-count');
    if (!host) return;
    if (count) count.textContent = String(NS.log.length);
    // the streaming turn is over (or spliced away by a retry): drop the ref
    if (NS.liveMsg && NS.log[NS.log.length - 1] !== NS.liveMsg) NS.liveMsg = null;
    // LIVE PATH: the streaming message updates its existing nodes instead of a
    // full rebuild — rebuilding destroyed the thinking box (and its scroll)
    // on every delta, which fought the user's scrolling and snapped to the top.
    if (NS.liveMsg && NS.liveRefs && NS.liveRefs.li.isConnected) {
      const m = NS.liveMsg;
      const who = m.role === 'user' ? '<b>kamu</b>' : m.role === 'ai' ? '<b>ai</b>' : '<b class="muted">sys</b>';
      let html = who + ' ' + escapeHtml(m.text).replace(/\n/g, '<br>');
      if (m.ops && m.ops.length) html += '<br><span class="muted">' + m.ops.map(o => escapeHtml(o.name)).join(', ') + '</span>';
      NS.liveRefs.text.innerHTML = html;
      NS.liveRefs.body.textContent = m.thinking || '';
      NS.liveRefs.det.open = !(NS.thinkClosed && NS.thinkClosed.has(m));
      // auto-scroll the reasoning box ONLY while the user sits at its bottom;
      // scrolled up to read = we leave their position alone
      stickToBottom(NS.liveRefs.body);
      return;
    }
    host.innerHTML = '';
    const items = NS.log.filter(m => NS.mode === 'log' ? true : m.role !== 'sys');
    if (!items.length) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="muted">Tanya atau perintahkan sesuatu… cth: "kotak 100x60 di 0,0", "4 lubang d5 di sudut", "buatkan box 120x80x60".</span>';
      host.appendChild(li);
      return;
    }
    for (const m of items.slice(-60)) {
      const li = document.createElement('li');
      const who = m.role === 'user' ? '<b>kamu</b>' : m.role === 'ai' ? '<b>ai</b>' : '<b class="muted">sys</b>';
      let html = who + ' ' + escapeHtml(m.text).replace(/\n/g, '<br>');
      if (m.ops && m.ops.length) {
        html += '<br><span class="muted">' + m.ops.map(o => escapeHtml(o.name)).join(', ') + '</span>';
      }
      // text lives in its own span so the live-update path can rewrite just it
      const textSpan = document.createElement('span');
      textSpan.innerHTML = html;
      li.appendChild(textSpan);
      // the model's reasoning, collapsible: click to inspect/correct its plan.
      // Default OPEN, and the open state survives a re-render: renderChat
      // rebuilds the whole log on every update, so a <details> the user opened
      // would snap shut again unless we remember it per log entry.
      if (m.thinking) {
        // Keyed on the message object, not the index: a retry splices the log
        // and would shift every index. Default OPEN; only entries the user
        // explicitly closed stay shut across re-renders.
        NS.thinkClosed = NS.thinkClosed || new WeakSet();
        const det = document.createElement('details');
        det.className = 'chat-think';
        det.open = !NS.thinkClosed.has(m);
        const sum = document.createElement('summary');
        sum.textContent = 'pikiran model (' + m.thinking.split(/\n-{3,}\n/).length + ' putaran)';
        sum.addEventListener('click', () => {
          // runs before the browser toggles `open`
          if (det.open) NS.thinkClosed.add(m); else NS.thinkClosed.delete(m);
        });
        const body = document.createElement('div');
        body.className = 'chat-think-body';
        body.textContent = m.thinking;
        det.appendChild(sum);
        det.appendChild(body);
        li.appendChild(det);
        // remember the streaming message's nodes for the live-update path
        if (m === NS.liveMsg) {
          NS.liveRefs = { li, det, sum, body, text: textSpan };
          stickToBottom(body);
        }
      }
      if (m.retryText && NS.mode === 'chat') {
        li.classList.add('chat-error');
        const retry = document.createElement('button');
        retry.className = 'btn small chat-retry';
        retry.textContent = 'Retry';
        retry.title = 'Kirim ulang perintah terakhir ini';
        retry.addEventListener('click', () => {
          // drop the error entry and every turn after it, then resend
          const at = NS.log.indexOf(m);
          if (at >= 0) {
            const userEntry = NS.log[at - 1];
            NS.log.splice(userEntry && userEntry.role === 'user' ? at - 1 : at, NS.log.length);
          }
          send(m.retryText);
        });
        li.appendChild(retry);
      }
      host.appendChild(li);
    }
    host.scrollTop = host.scrollHeight;
  }

  // follow the tail of a scrolling element unless the user scrolled up to read
  function stickToBottom(el) {
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (near) el.scrollTop = el.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function setTab(mode) {
    NS.mode = mode === 'log' ? 'log' : 'chat';
    document.querySelectorAll('[data-chat-tab]').forEach(b => {
      b.classList.toggle('is-on', b.dataset.chatTab === NS.mode);
    });
    renderLog();
  }

  // Called once from app.js init() after mountTools(). Keeps all chat state
  // here; app.js only gains the aiBridgeUrl setting + this one call.
  NS.mount = function mount(aiApi) {
    api = aiApi;
    NS._apiRef = aiApi;   // debug/inspection handle
    loadLog();
    renderLog();
    document.querySelectorAll('[data-chat-tab]').forEach(b => {
      b.addEventListener('click', () => setTab(b.dataset.chatTab));
    });
    const input = document.getElementById('chat-input');
    const btn = document.getElementById('chat-send');
    const stopBtn = document.getElementById('chat-stop');
    if (stopBtn) stopBtn.addEventListener('click', () => {
      if (NS.activeAbort) NS.activeAbort.abort();
    });
    NS.setStopVisible = (on) => {
      // The `hidden` ATTRIBUTE, not a class: styles.css has no generic `.hidden`
      // rule, so `class="hidden"` did nothing and the Stop button was on screen
      // all the time. The attribute is honoured by the UA stylesheet for any
      // element, no CSS needed.
      if (stopBtn) stopBtn.hidden = !on;
      // The Send button keeps its own label. Flipping it to "Stop" as well put
      // two Stop buttons next to each other while a request was running.
    };
    const newBtn = document.getElementById('chat-new');
    if (newBtn) newBtn.addEventListener('click', () => {
      NS.log = [];
      persistLog();
      renderLog();
      if (input) input.focus();
    });
    const go = () => {
      const v = input ? input.value : '';
      if (input) input.value = '';
      send(v);
      if (input) input.focus();
    };
    if (btn) btn.addEventListener('click', go);
    if (input) input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); go(); }
      ev.stopPropagation();
    });
  };

  NS.send = send;
  NS.applyOps = applyOps;
  NS.stateSummary = stateSummary;
})();
