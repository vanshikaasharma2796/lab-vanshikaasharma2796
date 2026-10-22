/* =====================================================================
   src/app.js — McContext Burger · Talk to Data

   One question, two analysts, side by side:
     bare     raw SQL against bare schemas, no context
     context  the same analyst with the context layer connected

   Each panel is a chat. The question lands as a bubble, a reasoning
   trail fills in row by row (context loads, warehouse queries, thoughts),
   the tool-call timeline under the panel grows with every finished
   call, and the answer arrives last with its key phrases highlighted.

   The page has two sources for what it plays:
     Recorded   the transcripts in data/*.js, replayed as they are
     Live       MCX.engine.ask(): the context is assembled, the SQL is
                compiled and run in the page, and the answer is written
                from the rows, each time Run is pressed

   Both come back in the same shape, so one player shows them. Nothing
   here talks to a network. Names, copy and pacing are in src/config.js.
   ===================================================================== */
(function (global) {
  'use strict';

  var MCX = global.MCX;
  if (!MCX || !MCX.config || !MCX.script) return;

  var doc = global.document;
  var cfg = MCX.config;
  var brand = cfg.brand;
  var copy = cfg.copy;
  var pacing = cfg.pacing;
  var script = MCX.script;
  var named = script.named;

  // -------------------------------------------------------------------
  // Small helpers
  // -------------------------------------------------------------------

  function $(selector, root) { return (root || doc).querySelector(selector); }
  function $$(selector, root) { return Array.prototype.slice.call((root || doc).querySelectorAll(selector)); }

  /** Build an element: el('span', { class: 'x', text: 'hi' }, child, child) */
  function el(tag, props) {
    var node = doc.createElement(tag);
    var key;
    if (props) {
      for (key in props) {
        if (!Object.prototype.hasOwnProperty.call(props, key) || props[key] == null) continue;
        if (key === 'class') node.className = props[key];
        else if (key === 'text') node.textContent = props[key];
        else if (key === 'html') node.innerHTML = props[key];
        else node.setAttribute(key, props[key]);
      }
    }
    for (var i = 2; i < arguments.length; i++) {
      var kid = arguments[i];
      if (kid == null) continue;
      node.appendChild(typeof kid === 'string' ? doc.createTextNode(kid) : kid);
    }
    return node;
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function closest(node, selector) {
    return node && node.closest ? node.closest(selector) : null;
  }

  /** Fill {slots} in a line of copy, after the brand names. */
  function fill(template, values) {
    return named(template).replace(/\{(\w+)\}/g, function (whole, key) {
      return values && values[key] != null ? values[key] : whole;
    });
  }
  /** "1 row" / "3 rows" from a [singular, plural] pair in the copy. */
  function counted(count, pair) { return number(count) + ' ' + (count === 1 ? pair[0] : pair[1]); }
  function number(value) { return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  function sleep(ms) { return new Promise(function (resolve) { global.setTimeout(resolve, ms); }); }
  function between(min, max) { return min + Math.random() * (max - min); }
  function jittered(ms) { return ms * (1 - pacing.jitter + Math.random() * pacing.jitter * 2); }

  var ICONS = {
    chevron: '<path d="M6 9l6 6 6-6"/>',
    chevronUp: '<path d="M18 15l-6-6-6 6"/>',
    pencil: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    // Context-engine steps, one shape each (see TYPE_ICONS below)
    guard: '<path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/>',
    route: '<path d="M4 12h8"/><path d="M12 12l6-6M12 12l6 6"/><path d="M15 6h3v3M15 18h3v-3"/>',
    doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 13h6M10 17h6"/>',
    work: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
    memory: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3 4v5h5"/><path d="M12 8v4l3 2"/>',
    validate: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>',
    action: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
    act: '<path d="M4 12l16-8-6 16-3-7z"/><path d="M11 13l9-9"/>',
    up: '<path d="M7 11v9H4v-9z"/><path d="M7 11l4-7c1.5 0 2.5 1 2.5 2.5V10H19a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 17.8 20H7"/>',
    down: '<path d="M7 13V4H4v9z"/><path d="M7 13l4 7c1.5 0 2.5-1 2.5-2.5V14H19a2 2 0 0 0 2-2.3l-1.2-6A2 2 0 0 0 17.8 4H7"/>',
    // A plain database cylinder: stands for "a query against the warehouse".
    warehouse: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><ellipse cx="12" cy="6" rx="8" ry="3.2"/><path d="M4 9.1c1.7 1.5 4.6 2.3 8 2.3s6.3-.8 8-2.3V12c0 1.8-3.6 3.2-8 3.2S4 13.8 4 12z" opacity=".78"/><path d="M4 15.1c1.7 1.5 4.6 2.3 8 2.3s6.3-.8 8-2.3V18c0 1.8-3.6 3.2-8 3.2S4 19.8 4 18z" opacity=".55"/></svg>'
  };
  function strokeIcon(path, className) {
    return '<svg' + (className ? ' class="' + className + '"' : '') + ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  }

  // -------------------------------------------------------------------
  // One run: a clock that can be paused and cancelled
  // -------------------------------------------------------------------

  var CANCELLED = { cancelled: true };

  function Run() {
    this.cancelled = false;
    this.pausedAt = null;
    this.pausedTotal = 0;
  }
  /** Milliseconds this run has been playing, not counting time spent paused. */
  Run.prototype.clock = function () {
    var now = global.performance.now();
    return now - this.pausedTotal - (this.pausedAt == null ? 0 : now - this.pausedAt);
  };
  Run.prototype.isPaused = function () { return this.pausedAt != null; };
  Run.prototype.setPaused = function (paused) {
    if (paused && this.pausedAt == null) this.pausedAt = global.performance.now();
    if (!paused && this.pausedAt != null) {
      this.pausedTotal += global.performance.now() - this.pausedAt;
      this.pausedAt = null;
    }
  };
  Run.prototype.cancel = function () { this.cancelled = true; };
  Run.prototype.wait = async function (ms) {
    var until = this.clock() + ms / (pacing.speed || 1);
    for (;;) {
      if (this.cancelled) throw CANCELLED;
      var left = until - this.clock();
      if (left <= 0) return;
      await sleep(this.isPaused() ? 40 : Math.max(4, Math.min(40, left)));
    }
  };

  // -------------------------------------------------------------------
  // A panel: one analyst's chat, status pill and timeline
  // -------------------------------------------------------------------

  function Panel(side) {
    this.side = side;
    this.root = $('#panel-' + side);
    this.statusEl = $('.status', this.root);
    this.chat = $('.chat', this.root);
    this.timeline = $('.timeline', this.root);
    this.bar = $('.timeline__bar', this.root);
    this.bar.setAttribute('data-empty', named(copy.timelineEmpty));
    this.blocks = [];
    this.trail = null;
    this.trailHead = null;
    this.status = 'idle';
    this.live = false;       // is the transcript being played a live one?
  }

  Panel.prototype.setStatus = function (status) {
    var labels = { idle: 'Idle', working: 'Working', paused: 'Paused', done: 'Done' };
    this.status = status;
    this.statusEl.setAttribute('data-status', status);
    this.statusEl.textContent = labels[status] || status;
  };

  Panel.prototype.scrollToEnd = function () {
    var chat = this.chat;
    global.requestAnimationFrame(function () { chat.scrollTop = chat.scrollHeight; });
  };

  /** Wipe the chat and the timeline. */
  Panel.prototype.clear = function () {
    this.chat.innerHTML = '';
    this.bar.innerHTML = '';
    this.timeline.classList.remove('is-explaining');
    this.blocks = [];
    this.trail = null;
    this.trailHead = null;
  };

  /** Back to the resting state, with a note in the middle of the chat. */
  Panel.prototype.rest = function (noteHtml, smallPrint) {
    this.clear();
    this.root.classList.remove('is-running', 'is-done');
    this.setStatus('idle');
    var note = el('div', { class: 'chat__empty', html: noteHtml });
    if (smallPrint) note.appendChild(el('small', { text: smallPrint }));
    this.chat.appendChild(note);
  };

  Panel.prototype.begin = function (live) {
    this.clear();
    this.live = !!live;
    this.result = live || null;   // the live result behind this run: rich details for the engine's steps
    this.root.classList.remove('is-done');
    this.root.classList.add('is-running');
    this.setStatus('working');
  };

  Panel.prototype.finish = function () {
    this.root.classList.remove('is-running');
    this.root.classList.add('is-done');
    this.setStatus('done');
    if (cfg.features.answerScroll !== 'start') this.scrollToEnd();
  };

  Panel.prototype.ask = function (who, question) {
    this.chat.appendChild(
      el('div', { class: 'bubble bubble--user' }, el('span', { class: 'bubble__who', text: who }), question)
    );
    this.scrollToEnd();
  };

  Panel.prototype.openTrail = function () {
    this.trailHead = el('div', { class: 'trail__head is-live' }, el('span', { class: 'dot' }), el('span', { text: 'Reasoning…' }));
    this.trail = el('div', { class: 'trail' }, this.trailHead);
    this.chat.appendChild(this.trail);
    this.scrollToEnd();
  };

  Panel.prototype.closeTrail = function () {
    if (!this.trailHead) return;
    this.trailHead.classList.remove('is-live');
    this.trailHead.lastChild.textContent = 'Reasoning';
  };

  /** A reasoning line: shown as its first sentence, the rest on hover. */
  Panel.prototype.think = function (text) {
    var shown = script.firstSentence(text);
    var label = el('span', { class: 'row__label', text: shown });
    if (script.plain(text) !== shown) label.setAttribute('title', script.plain(text));
    this.trail.appendChild(
      el('div', { class: 'row row--thought' }, el('span', { class: 'row__icon row__icon--thought', text: '✦' }), label)
    );
    this.scrollToEnd();
  };

  /** Add a tool row in its "pending" state. Returns a handle for finishTool. */
  Panel.prototype.startTool = function (tool, startedAt) {
    var icon = el('span', { class: 'row__icon row__icon--' + tool.kind + (TYPED[tool.type] ? ' row__icon--t row__icon--' + tool.type : '') });
    if (TYPED[tool.type]) icon.innerHTML = strokeIcon(ICONS[tool.type]);
    else if (tool.kind === 'context') icon.appendChild(el('img', { src: brand.contextLogo, alt: '' }));
    else icon.innerHTML = ICONS.warehouse;

    var label = el('span', { class: 'row__label' }, tool.verb);
    if (tool.arg) {
      label.appendChild(doc.createTextNode(' '));
      label.appendChild(el('span', { class: 'chip', text: tool.arg }));
    }
    var time = el('span', { class: 'row__time' });
    var row = el('div', { class: 'row is-pending' + (TYPED[tool.type] ? ' row--t row--' + tool.type : '') + (tool.alert ? ' is-' + tool.alert : '') }, icon, label, time);
    this.trail.appendChild(row);
    this.scrollToEnd();
    return { tool: tool, row: row, time: time, startedAt: startedAt };
  };

  /** Mark a tool row as finished and add its block to the timeline. */
  Panel.prototype.finishTool = function (handle, finishedAt) {
    var tool = handle.tool;
    var took = Math.max(0, finishedAt - handle.startedAt);
    handle.row.classList.remove('is-pending');
    handle.row.classList.add('is-ok');
    handle.time.textContent = script.formatDuration(took);

    if (cfg.features.stepDetails) this.attachDetail(handle);

    this.blocks.push({ kind: tool.kind, type: TYPED[tool.type] ? tool.type : null, alert: tool.alert || null, meta: tool.meta || '', label: script.labelOf(tool), key: tool.key, took: took });
    this.drawTimeline();
  };

  /**
   * Click a finished tool row to see what was behind it.
   *   a query           the SQL; live runs add the first rows that came back and the real time
   *   a context load    where it came from; live runs add the text that was loaded
   */
  Panel.prototype.attachDetail = function (handle) {
    var tool = handle.tool;
    var row = handle.row;
    var detail = el('div', { class: 'row__detail', hidden: '' });
    var rich = TYPED[tool.type] ? typeDetail(tool, this.result) : null;
    if (rich) {
      detail.classList.add('row__detail--t', 'row__detail--' + tool.type);
      detail.appendChild(rich);
    } else if (tool.kind === 'warehouse') {
      detail.appendChild(el('pre', { text: tool.sql }));
      if (tool.result) detail.appendChild(resultTable(tool));
      else if (tool.rows != null || tool.cols) {
        var result = el('div', { class: 'result' });
        if (tool.rows != null) result.appendChild(el('b', { text: tool.rows + (tool.rows === 1 ? ' row' : ' rows') }));
        if (tool.cols) result.appendChild(doc.createTextNode((tool.rows != null ? ' · ' : '') + tool.cols));
        detail.appendChild(result);
      }
    } else if (tool.detail) {
      var bits = [tool.file, tool.tokens != null ? counted(tool.tokens, copy.live.tokens) : null].filter(Boolean);
      detail.appendChild(el('div', { class: 'source', text: bits.join(' · ') }));
      detail.appendChild(el('pre', { class: 'loaded', text: tool.detail }));
    } else {
      detail.appendChild(el('div', { text: '{' + tool.source + '}' }));
    }
    row.classList.add('has-detail');
    row.setAttribute('tabindex', '0');
    row.setAttribute('role', 'button');
    row.setAttribute('aria-expanded', 'false');
    row.parentNode.insertBefore(detail, row.nextSibling);
  };

  /** The first rows a live query returned, as a small table, with the real row count and time. */
  function resultTable(tool) {
    var result = tool.result;
    var wrap = el('div', { class: 'result' });
    if (result.rows.length) {
      var table = el('table');
      var head = el('tr');
      result.columns.forEach(function (name) { head.appendChild(el('th', { text: name })); });
      table.appendChild(el('thead', null, head));
      var body = el('tbody');
      result.rows.forEach(function (cells) {
        var tr = el('tr');
        cells.forEach(function (value) { tr.appendChild(el('td', { text: value == null ? '—' : String(value) })); });
        body.appendChild(tr);
      });
      table.appendChild(body);
      wrap.appendChild(el('div', { class: 'result__table' }, table));
    }
    var more = result.total - result.rows.length;
    var line = (result.total ? counted(result.total, copy.live.rows) : copy.live.noRows) +
      (more > 0 ? ' (' + fill(more === 1 ? copy.live.moreRows[0] : copy.live.moreRows[1], { n: number(more) }) + ')' : '') +
      (tool.ms != null ? ' · ' + fill(copy.live.queryLine, { ms: tool.ms < 10 ? tool.ms.toFixed(1) : Math.round(tool.ms) }) : '');
    wrap.appendChild(el('div', { class: 'result__line', text: line }));
    return wrap;
  }

  /** Redraw the timeline; each block's width is that call's share of the total time. */
  Panel.prototype.drawTimeline = function () {
    var blocks = this.blocks;
    var total = blocks.reduce(function (sum, b) { return sum + b.took; }, 0) || 1;
    while (this.bar.children.length < blocks.length) this.bar.appendChild(doc.createElement('span'));
    for (var i = 0; i < blocks.length; i++) {
      var block = blocks[i];
      var seg = this.bar.children[i];
      seg.className = 'seg seg--' + block.kind + (block.type ? ' seg--' + block.type : '') + (block.alert ? ' is-' + block.alert : '');
      seg.setAttribute('data-kind', block.kind);
      if (block.type) seg.setAttribute('data-type', block.type); else seg.removeAttribute('data-type');
      seg.setAttribute('data-meta', block.meta || '');
      seg.setAttribute('data-label', block.label);
      seg.setAttribute('data-took', script.formatDuration(block.took));
      seg.setAttribute('data-num', String(i + 1));
      seg.setAttribute('data-key', block.key);
      if (this.live) seg.setAttribute('data-live', '1');
      seg.style.width = ((block.took / total) * 100).toFixed(2) + '%';
    }
  };

  Panel.prototype.showTyping = function () {
    var dots = el('div', { class: 'dots' }, el('span'), el('span'), el('span'));
    this.chat.appendChild(dots);
    this.scrollToEnd();
    return dots;
  };

  Panel.prototype.answer = function (text, marks, footer) {
    var body = el('div', { class: 'bubble__body' });
    script.segment(text, marks).forEach(function (piece) {
      if (!piece.kind) { body.appendChild(doc.createTextNode(piece.text)); return; }
      var mark = el('mark', { class: piece.kind, text: piece.text });
      if (piece.kind === 'good' && piece.from && piece.from.length) mark.setAttribute('data-from', piece.from.join(','));
      body.appendChild(mark);
    });
    var bubble = el('div', { class: 'bubble bubble--agent' }, body, el('span', { class: 'bubble__foot', text: footer }));
    this.chat.appendChild(bubble);
    if (cfg.features.answerScroll === 'start') {
      var chat = this.chat;
      global.requestAnimationFrame(function () { chat.scrollTop = Math.max(0, bubble.offsetTop - chat.offsetTop - 16); });
    }
    return bubble;
  };

  // -------------------------------------------------------------------
  // Playing a transcript into a panel
  // -------------------------------------------------------------------

  /** The small line under an answer. A live answer says what was actually loaded. */
  function footerFor(side, live) {
    if (!live) return named(copy[side].footer);
    if (side === 'context' && live.pack) {
      var words = copy.live.loaded, pack = live.pack;
      var loaded = [words.persona, counted(pack.terms.length, words.terms), counted(pack.skills.length, words.skills),
        counted(pack.models.length, words.models), counted(pack.policies.length, words.policies)].join(' + ');
      return fill(copy.live.contextFooter, { loaded: loaded }) + copy.live.footerSuffix;
    }
    return named(copy[side].footer) + copy.live.footerSuffix;
  }

  async function play(panel, replay, question, who, run, live) {
    var pace = pacing[panel.side];
    panel.begin(live);
    if (panel.side === 'context') await run.wait(pacing.contextHeadStart);

    panel.ask(who, question);
    await run.wait(between(pacing.afterQuestion[0], pacing.afterQuestion[1]));
    panel.openTrail();

    var steps = replay.steps || [];
    for (var i = 0; i < steps.length; i++) {
      var step = steps[i];
      if (step.say != null) {
        await run.wait(jittered(pace.say) + (step.hold ? pacing.hold : 0));
        panel.think(step.say);
        continue;
      }
      var tool = dressTool(script.describeTool(step), panel.side === 'context' ? live : null);
      if (!tool) continue;
      var quick = tool.kind === 'context';
      await run.wait(jittered(quick ? pacing.load : pace.call));
      var handle = panel.startTool(tool, run.clock());
      await run.wait(jittered(quick ? pacing.load : pace.result));
      panel.finishTool(handle, run.clock());
    }

    await run.wait(jittered(pace.answer));
    panel.closeTrail();
    var dots = panel.showTyping();
    try {
      await run.wait(jittered(pacing.typing.base) + pacing.typing.extra);
    } finally {
      if (dots.parentNode) dots.parentNode.removeChild(dots);
    }
    panel.answer(replay.answer || '', replay.marks, footerFor(panel.side, live));
    if (panel.side === 'context' && live) answerExtras(panel, live);
    panel.finish();
  }

  // -------------------------------------------------------------------
  // Page state
  // -------------------------------------------------------------------

  var state = {
    persona: null,     // who is asking
    question: null,    // what they are asking: a bank question, or { typed: true, text }
    mode: 'recorded',  // 'recorded' or 'live'
    pair: null,        // { bare, context } for a recorded question
    live: null,        // what the engine returned for the last live run of this question
    run: null,         // the Run in flight, if any
    engine: 'off'      // 'off' | 'starting' | 'ready' | 'failed'
  };
  var engineReady = null;   // a promise for the warehouse being built
  var engineError = null;
  var panels = {};
  var ui = { runBtn: null, bank: null, current: null, route: null, askInput: null, personaWrap: null, personaBtn: null, personaMenu: null,
    mode: null, ctxBtn: null, strip: null, stripText: null };

  function personaById(id) {
    var list = MCX.catalog.personas;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function hasRecordings(persona) {
    return persona.questions.some(function (q) { return !!MCX.findReplay(persona.id, q.slug); });
  }
  function hasEngine() { return !!(MCX.engine && MCX.db && MCX.contextRepo); }
  /** Does this question run live? Typed questions always do. */
  function isLive() { return state.mode === 'live' || !!(state.question && state.question.typed); }
  function canRun() {
    if (!state.question) return false;
    return isLive() ? state.engine !== 'failed' && state.engine !== 'off' : !!state.pair;
  }

  function whoLabel() {
    var p = state.persona || {};
    return ((p.emoji || '') + ' ' + (p.name || 'Operator') + ' · ' + (p.role || '')).trim();
  }

  function setRunButton(mode) {
    var label = $('span', ui.runBtn);
    ui.runBtn.classList.toggle('is-running', mode === 'running');
    ui.runBtn.disabled = mode === 'disabled' || mode === 'starting';
    label.textContent = mode === 'running' ? 'Reset' : mode === 'done' ? 'Run again' : mode === 'starting' ? copy.live.starting : 'Run';
  }

  function stopRun() {
    if (state.run) state.run.cancel();
    state.run = null;
  }

  /** Stop anything playing and put both panels back to their resting state. */
  function rest() {
    stopRun();
    hideTip();
    hideCite();
    var note = canRun() ? named(copy.emptyPanel) : isLive() ? named(copy.live.unavailable) : named(copy.noReplay);
    panels.bare.rest(note);
    panels.context.rest(note);
    setRunButton(canRun() ? 'idle' : 'disabled');
  }

  /** A live question that could not be answered: say so in both panels, calmly. */
  function showFailure(error) {
    var message = String((error && error.message) || error || '');
    var missing = /^No analysis called/.test(message);
    var capped = !!(error && error.code === 'cost-cap');
    var note = named(missing ? copy.live.noAnalysis : capped ? copy.live.costCap : copy.live.failed);
    panels.bare.rest(note, message.split('\n')[0]);
    panels.context.rest(note, message.split('\n')[0]);
    setRunButton('idle');
    if (!missing && !capped && !(error && error.status) && global.console) global.console.error(error);
  }

  /**
   * Ask the engine. Resolves with { bare, context, pack, route, plan, guard, … } or throws.
   * Through MCX.service when there is one (in the page, or over HTTP on a server): the answer is
   * logged and audited, its actions are queued, and a typed follow-up in the same session gets
   * the earlier turns as memory. The session is this browser tab and this person.
   */
  async function askEngine() {
    if (state.engine === 'starting') {
      setRunButton('starting');
      await engineReady;
    }
    if (state.engine !== 'ready') throw engineError || new Error(named(copy.mode.noEngine));
    var q = state.question;
    var input = q.typed ? { persona: state.persona.id, question: q.text } : { persona: state.persona.id, question: q.text, slug: q.slug, bucket: q.bucket };
    var result;
    if (svc()) {
      input.session = sessionId() + ':' + state.persona.id;
      result = await svc().ask(input);
    } else {
      result = await MCX.engine.ask(input);
    }
    result.asker = state.persona.id;   // the page's own note: who asked (for feedback and the human check)
    return result;
  }

  /** One id per browser tab, kept across reloads of the tab (sessionStorage), so typed follow-ups get memory. */
  var tabSession = null;
  function sessionId() {
    if (tabSession) return tabSession;
    try { tabSession = global.sessionStorage.getItem('mcx.session'); } catch (e) { tabSession = null; }
    if (!tabSession) {
      tabSession = 'tab-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
      try { global.sessionStorage.setItem('mcx.session', tabSession); } catch (e) { /* private window: this page view only */ }
    }
    return tabSession;
  }
  function svc() { return MCX.service && typeof MCX.service.ask === 'function' ? MCX.service : null; }

  /** The Run button: start, or reset if a run is in flight. */
  async function runOrReset() {
    if (!canRun()) return;
    if (state.run) { rest(); return; }

    var asked = state.question;
    var pair = state.pair;
    var live = null;
    if (isLive()) {
      try {
        live = await askEngine();
      } catch (error) {
        if (state.question === asked) showFailure(error);
        return;
      }
      if (state.question !== asked || state.run) return;      // something else was chosen while the engine started
      state.live = live;
      pair = { bare: live.bare, context: live.context };
      showLive();
      refreshLoop();          // the learning loop shows the new log entry, gaps and actions
    }

    var run = (state.run = new Run());
    var who = whoLabel();
    setRunButton('running');
    hideTip();
    hideCite();

    try {
      await Promise.all([
        play(panels.bare, pair.bare, asked.text, who, run, live),
        // The context side shows the question as the guard read it: personal data masked.
        play(panels.context, pair.context, live && live.guard && live.guard.verdict === 'masked' ? live.guard.clean : asked.text, who, run, live)
      ]);
    } catch (reason) {
      if (reason !== CANCELLED) throw reason;
      return;
    }
    if (state.run !== run) return;
    state.run = null;
    setRunButton('done');
  }

  function togglePause() {
    var run = state.run;
    if (!run) return;
    run.setPaused(!run.isPaused());
    ['bare', 'context'].forEach(function (side) {
      var panel = panels[side];
      if (run.isPaused() && panel.status === 'working') panel.setStatus('paused');
      else if (!run.isPaused() && panel.status === 'paused') panel.setStatus('working');
    });
  }

  // -------------------------------------------------------------------
  // Recorded | Live
  // -------------------------------------------------------------------

  function drawMode() {
    var wrap = ui.mode;
    wrap.innerHTML = '';
    wrap.setAttribute('aria-label', copy.mode.label);
    ['recorded', 'live'].forEach(function (mode) {
      var button = el('button', { class: 'mode__btn', type: 'button', 'data-mode': mode, text: copy.mode[mode] });
      button.addEventListener('click', function (event) {
        if (event.detail > 0) button.blur();
        setMode(mode);
      });
      wrap.appendChild(button);
    });
  }

  function showMode() {
    var recordings = state.persona ? hasRecordings(state.persona) : false;
    var engine = state.engine !== 'off' && state.engine !== 'failed';
    $$('.mode__btn', ui.mode).forEach(function (button) {
      var mode = button.getAttribute('data-mode');
      var allowed = mode === 'recorded' ? recordings : engine;
      button.disabled = !allowed;
      button.classList.toggle('is-active', state.mode === mode);
      button.setAttribute('aria-pressed', String(state.mode === mode));
      button.title = mode === 'recorded'
        ? (recordings ? copy.mode.recordedTitle : fill(copy.mode.noRecordings, { name: state.persona ? state.persona.name : '' }))
        : (engine ? copy.mode.liveTitle : named(copy.mode.noEngine));
    });
  }

  function setMode(mode) {
    if (mode === state.mode) return;
    if (mode === 'recorded' && !(state.persona && hasRecordings(state.persona))) return;
    if (mode === 'live' && (state.engine === 'off' || state.engine === 'failed')) return;
    stopRun();
    state.mode = mode;
    showMode();
    if (state.question && state.question.typed) { rest(); return; }
    if (state.question) chooseQuestion(state.question, { run: false, collapse: false, keepBank: true });
  }

  // -------------------------------------------------------------------
  // Question bank
  // -------------------------------------------------------------------

  function bucketOf(question) {
    var buckets = MCX.catalog.buckets;
    for (var i = 0; i < buckets.length; i++) if (buckets[i].key === question.bucket) return buckets[i];
    return {};
  }

  function toggleButton(icon, text, onClick) {
    var button = el('button', { class: 'toggle', type: 'button', html: icon + '<span>' + escapeHtml(text) + '</span>' });
    button.addEventListener('click', function (event) {
      if (event.detail > 0) button.blur();
      onClick();
    });
    return button;
  }

  function setBankOpen(open) { ui.bank.classList.toggle('is-collapsed', !open); }

  function drawBank() {
    var persona = state.persona;
    var bank = ui.bank;
    bank.innerHTML = '';

    bank.appendChild(
      el('div', { class: 'bank__head' },
        el('span', { class: 'bank__hint', html: named(copy.bankHint) }),
        toggleButton(strokeIcon(ICONS.chevronUp), 'Collapse', function () { setBankOpen(false); }))
    );

    var grid = el('div', { class: 'bank__grid' });
    MCX.catalog.buckets.forEach(function (bucket) {
      var column = el('div', { class: 'bank__col' },
        el('div', { class: 'bank__label' }, el('span', { class: 'emoji', text: bucket.emoji || '' }), el('span', { text: bucket.label })));
      persona.questions.forEach(function (question) {
        if (question.bucket !== bucket.key) return;
        var pill = el('button', { class: 'pill', type: 'button', 'data-slug': question.slug, text: question.text });
        pill.addEventListener('click', function (event) {
          if (event.detail > 0) pill.blur(); // a mouse click leaves Space and Enter free for the shortcuts
          chooseQuestion(question, { run: true, collapse: true });
        });
        column.appendChild(pill);
      });
      grid.appendChild(column);
    });
    bank.appendChild(grid);

    // Type your own question: always answered live.
    var input = (ui.askInput = el('input', { class: 'ask__input', type: 'text', autocomplete: 'off', spellcheck: 'true', maxlength: '200',
      placeholder: copy.ask.placeholder, 'aria-label': copy.ask.label }));
    var askBtn = el('button', { class: 'ask__btn', type: 'submit', text: copy.ask.button });
    var form = el('form', { class: 'ask' }, input, askBtn);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      askTyped(input.value);
    });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { event.stopPropagation(); input.blur(); }
    });
    bank.appendChild(form);

    ui.current = el('span', { class: 'bank__current' });
    ui.route = el('span', { class: 'bank__route', hidden: '' });
    bank.appendChild(
      el('div', { class: 'bank__bar' },
        toggleButton(strokeIcon(ICONS.chevron), 'All questions', function () { setBankOpen(true); }),
        ui.current,
        ui.route,
        toggleButton(strokeIcon(ICONS.pencil), copy.ask.own, function () { setBankOpen(true); input.focus(); }))
    );
    bank.lastChild.lastChild.classList.add('bank__own');
    showAsk();
  }

  /** The ask box needs the engine. */
  function showAsk() {
    if (!ui.askInput) return;
    var off = state.engine === 'off' || state.engine === 'failed';
    ui.askInput.disabled = off;
    ui.askInput.nextSibling.disabled = off;
    ui.askInput.placeholder = off ? copy.ask.unavailable : copy.ask.placeholder;
  }

  function showCurrent(question) {
    var bucket = bucketOf(question);
    var kind = question.typed ? copy.ask.kind : String(bucket.label || question.bucket || '').split('—').pop().trim();
    ui.current.innerHTML = '';
    ui.current.appendChild(el('span', { class: 'emoji', text: question.typed ? copy.ask.emoji : (bucket.emoji || '') }));
    if (kind) ui.current.appendChild(el('span', { class: 'kind', text: kind }));
    ui.current.appendChild(el('span', { class: 'text', text: question.text }));
    $$('.pill', ui.bank).forEach(function (pill) {
      pill.classList.toggle('is-active', !question.typed && pill.getAttribute('data-slug') === question.slug);
    });
  }

  function chooseQuestion(question, options) {
    options = options || {};
    stopRun();
    state.question = question;
    state.pair = question.typed ? null : MCX.findReplay(state.persona.id, question.slug);
    state.live = null;
    showCurrent(question);
    showLive();
    if (options.collapse) setBankOpen(false);
    rest();
    if (options.run && canRun()) runOrReset();
  }

  /** A question typed by the user. It is answered live, whatever the mode switch says. */
  function askTyped(text) {
    text = String(text || '').replace(/\s+/g, ' ').trim();
    if (!text || state.engine === 'off' || state.engine === 'failed') return;
    if (ui.askInput) ui.askInput.blur();
    chooseQuestion({ typed: true, text: text }, { run: true, collapse: true });
  }

  // -------------------------------------------------------------------
  // What a live run adds to the page
  // -------------------------------------------------------------------

  /** After a live run: the context button, and how the question was routed. */
  function showLive() {
    var live = state.live;
    var button = ui.ctxBtn;
    if (button) {
      button.disabled = !live;
      button.title = live ? copy.contextButton.title : copy.contextButton.disabledTitle;
      $('span', button).textContent = copy.contextButton.label + (live ? ' · ' + counted(live.pack.tokens.used, copy.live.tokens) : '');
    }
    if (ui.route) {
      var text = live && live.route && copy.live.routes[live.route.kind] ? fill(copy.live.routes[live.route.kind], { like: live.route.like || '' }) : '';
      ui.route.textContent = text;
      ui.route.hidden = !text;
    }
    if (sheet.open && (sheet.tab === 'question' || sheet.tab === 'prompt' || sheet.tab === 'guardrails')) drawSheet();
  }

  // -------------------------------------------------------------------
  // Persona switcher
  // -------------------------------------------------------------------

  function drawPersonaSwitcher() {
    var wrap = ui.personaWrap;
    wrap.innerHTML = '';

    var button = (ui.personaBtn = el('button', { class: 'persona__btn', type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' }));
    button.addEventListener('click', function (event) {
      event.stopPropagation();
      if (event.detail > 0) button.blur();
      openPersonaMenu(ui.personaMenu.hidden);
    });
    wrap.appendChild(button);

    var menu = (ui.personaMenu = el('ul', { class: 'persona__menu', role: 'listbox', hidden: '' }));
    MCX.catalog.personas.forEach(function (persona) {
      var option = el('li', { class: 'persona__opt', role: 'option', tabindex: '0', 'data-id': persona.id },
        el('span', { class: 'emoji', text: persona.emoji || '' }),
        el('span', { class: 'who' },
          el('span', { class: 'name', text: persona.name }),
          el('span', { class: 'role', text: persona.role || '' }),
          persona.blurb ? el('span', { class: 'blurb', text: persona.blurb }) : null),
        persona.tag ? el('span', { class: 'tag', text: persona.tag }) : null);
      var pick = function () { openPersonaMenu(false); choosePersona(persona.id); };
      option.addEventListener('click', pick);
      option.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); pick(); }
      });
      menu.appendChild(option);
    });
    wrap.appendChild(menu);
  }

  function openPersonaMenu(open) {
    ui.personaMenu.hidden = !open;
    ui.personaWrap.classList.toggle('is-open', open);
    ui.personaBtn.setAttribute('aria-expanded', String(open));
  }

  function showPersona() {
    var p = state.persona;
    ui.personaBtn.innerHTML =
      '<span class="emoji">' + escapeHtml(p.emoji || '') + '</span>' +
      '<span class="who"><span class="name">' + escapeHtml(p.name) + '</span><span class="role">' + escapeHtml(p.role || '') + '</span></span>' +
      strokeIcon(ICONS.chevron, 'chev');
    $$('.persona__opt', ui.personaMenu).forEach(function (option) {
      var active = option.getAttribute('data-id') === p.id;
      option.classList.toggle('is-active', active);
      option.setAttribute('aria-selected', String(active));
    });
  }

  function choosePersona(id, wantedMode) {
    var persona = personaById(id);
    if (!persona) return;
    stopRun();
    state.persona = persona;
    // Recorded where there is something recorded; otherwise the questions run live.
    var engine = state.engine !== 'off' && state.engine !== 'failed';
    if (!hasRecordings(persona)) state.mode = 'live';
    else if (wantedMode === 'live' && engine) state.mode = 'live';
    else if (wantedMode === 'recorded' || !engine) state.mode = 'recorded';
    showPersona();
    showMode();
    drawBank();
    setBankOpen(true);
    var first = persona.questions.filter(function (q) { return q.hero; })[0] || persona.questions[0];
    if (first) chooseQuestion(first, { run: false, collapse: false });
  }

  // -------------------------------------------------------------------
  // Hover cards
  // -------------------------------------------------------------------

  var EDGE = 10;
  var tipEl = null;
  var citeEl = null;

  /** Place a floating card above a target, kept inside the window, with its arrow aimed at the target. */
  function placeAbove(card, target) {
    card.classList.add('is-on');
    var cardBox = card.getBoundingClientRect();
    var box = target.getBoundingClientRect();
    var centre = box.left + box.width / 2;
    var left = Math.max(EDGE, Math.min(centre - cardBox.width / 2, global.innerWidth - cardBox.width - EDGE));
    card.style.left = left + 'px';
    card.style.top = box.top + 'px';
    card.style.setProperty('--arrow-x', (centre - left) + 'px');
  }

  /** Hovering a timeline block: what the call was and how long it took. */
  function showTip(seg) {
    if (!tipEl) {
      tipEl = el('div', { class: 'tip' },
        el('div', { class: 'tip__kind' }, el('span', { class: 'dot' }), el('span', { class: 'name' }), el('span', { class: 'num' })),
        el('div', { class: 'tip__label' }),
        el('div', { class: 'tip__time' }));
      doc.body.appendChild(tipEl);
    }
    var kind = seg.getAttribute('data-kind');
    var type = seg.getAttribute('data-type');
    var live = seg.getAttribute('data-live') === '1';
    var meta = seg.getAttribute('data-meta');
    tipEl.setAttribute('data-kind', kind);
    if (type) tipEl.setAttribute('data-type', type); else tipEl.removeAttribute('data-type');
    $('.name', tipEl).textContent = named((type && copy.kinds[type]) || (live && kind === 'warehouse' && copy.kinds.warehouseLive) || copy.kinds[kind] || 'Step');
    $('.num', tipEl).textContent = '#' + seg.getAttribute('data-num');
    $('.tip__label', tipEl).textContent = seg.getAttribute('data-label');
    $('.tip__time', tipEl).textContent = seg.getAttribute('data-took') + (type && meta ? ' · ' + meta : '');
    placeAbove(tipEl, seg);
  }
  function hideTip() { if (tipEl) tipEl.classList.remove('is-on'); }

  /** Hovering a green phrase: name the context behind it and light up its timeline blocks. */
  function showCite(mark) {
    var keys = (mark.getAttribute('data-from') || '').split(',').filter(Boolean);
    var panelEl = closest(mark, '.panel');
    if (!keys.length || !panelEl) return;
    var panel = panels[panelEl.getAttribute('data-side')];
    var labels = [];
    $$('.seg', panel.bar).forEach(function (seg) {
      var related = keys.indexOf(seg.getAttribute('data-key')) !== -1;
      seg.classList.toggle('is-lit', related);
      seg.classList.toggle('is-dim', !related);
      if (related && labels.indexOf(seg.getAttribute('data-label')) === -1) labels.push(seg.getAttribute('data-label'));
    });
    panel.timeline.classList.add('is-explaining');

    if (!citeEl) {
      citeEl = el('div', { class: 'cite' });
      doc.body.appendChild(citeEl);
    }
    citeEl.innerHTML = '';
    citeEl.appendChild(
      el('div', { class: 'cite__top' },
        el('img', { src: brand.contextLogo, alt: brand.contextLayer }),
        el('div', { class: 'cite__title', text: named(copy.citeTitle) })));
    var list = el('div', { class: 'cite__list' });
    labels.forEach(function (label) { list.appendChild(el('span', { text: label })); });
    citeEl.appendChild(list);
    citeEl.appendChild(el('div', { class: 'cite__cue', text: named(copy.citeCue) }));
    placeAbove(citeEl, mark);
  }
  function hideCite() {
    if (citeEl) citeEl.classList.remove('is-on');
    ['bare', 'context'].forEach(function (side) {
      var panel = panels[side];
      if (!panel) return;
      $$('.seg', panel.bar).forEach(function (seg) { seg.classList.remove('is-lit', 'is-dim'); });
      panel.timeline.classList.remove('is-explaining');
    });
  }

  // -------------------------------------------------------------------
  // The context sheet: what was assembled, the repository, the warehouse
  // -------------------------------------------------------------------

  var sheet = { open: false, tab: 'question', root: null, backdrop: null, body: null, opener: null, token: 0, keep: null, pending: 0 };

  function buildSheet() {
    var words = copy.sheet;
    sheet.backdrop = el('div', { class: 'sheet__backdrop' });
    sheet.backdrop.addEventListener('click', closeSheet);
    var close = el('button', { class: 'sheet__close', type: 'button', 'aria-label': words.close, html: strokeIcon(ICONS.close) });
    close.addEventListener('click', closeSheet);
    var tabs = el('div', { class: 'sheet__tabs', role: 'tablist' });
    Object.keys(words.tabs).forEach(function (tab) {
      var button = el('button', { class: 'sheet__tab sheet__tab--' + tab, type: 'button', role: 'tab', 'data-tab': tab, text: words.tabs[tab] });
      button.addEventListener('click', function () { sheet.tab = tab; drawSheet(); });
      tabs.appendChild(button);
    });
    sheet.body = el('div', { class: 'sheet__body', role: 'tabpanel', tabindex: '0' });
    sheet.root = el('aside', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': named(words.title) },
      el('header', { class: 'sheet__head' },
        el('div', { class: 'sheet__title', text: named(words.title) }),
        el('div', { class: 'sheet__sub', text: named(words.sub) }),
        close, tabs),
      sheet.body);
    doc.body.appendChild(sheet.backdrop);
    doc.body.appendChild(sheet.root);
  }

  function openSheet(tab, opener) {
    if (!sheet.root) buildSheet();
    sheet.tab = tab || sheet.tab;
    sheet.open = true;
    sheet.opener = opener || doc.activeElement;
    hideTip();
    hideCite();
    drawSheet();
    sheet.root.classList.add('is-on');
    sheet.backdrop.classList.add('is-on');
    $('.sheet__close', sheet.root).focus();
  }

  function closeSheet() {
    if (!sheet.open) return;
    sheet.open = false;
    sheet.root.classList.remove('is-on');
    sheet.backdrop.classList.remove('is-on');
    if (sheet.opener && sheet.opener.focus) sheet.opener.focus();
  }

  function drawSheet(keepScroll) {
    $$('.sheet__tab', sheet.root).forEach(function (button) {
      var active = button.getAttribute('data-tab') === sheet.tab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
      if (active) {   // on a phone the tabs scroll sideways: keep the chosen one in view
        var strip = button.parentNode, left = button.offsetLeft - strip.offsetLeft;
        if (left < strip.scrollLeft || left + button.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = Math.max(0, left - 16);
      }
    });
    var body = sheet.body;
    sheet.token++;
    sheet.keep = keepScroll ? body.scrollTop : null;
    body.innerHTML = '';
    body.scrollTop = 0;
    sheet.root.setAttribute('data-tab', sheet.tab);
    ({ question: drawQuestionTab, prompt: drawPromptTab, guardrails: drawGuardrailsTab, repository: drawRepositoryTab, warehouse: drawWarehouseTab, loop: drawLoopTab })[sheet.tab](body);
    if (sheet.keep != null && !sheet.pending) body.scrollTop = sheet.keep;
  }

  /** One thing that can be opened to read: a context item, a repository file. */
  function itemRow(name, why, tokens, text, file, tags) {
    var summary = el('summary', { class: 'item__head' },
      el('span', { class: 'item__name', text: name }),
      why ? el('span', { class: 'item__why', text: why }) : null);
    (tags || []).forEach(function (tag) { summary.appendChild(el('span', { class: 'item__tag', text: tag })); });
    if (tokens != null) summary.appendChild(el('span', { class: 'item__tokens', text: counted(tokens, copy.live.tokens) }));
    return el('details', { class: 'item' }, summary,
      file ? el('div', { class: 'item__file', text: file }) : null,
      el('pre', { class: 'item__text', text: text || '' }));
  }

  function factsList(pairs) {
    var list = el('dl', { class: 'facts' });
    pairs.forEach(function (pair) {
      if (pair[1] == null || pair[1] === '') return;
      list.appendChild(el('dt', { text: pair[0] }));
      list.appendChild(el('dd', { text: pair[1] }));
    });
    return list;
  }

  function drawQuestionTab(body) {
    var words = copy.sheet, live = state.live;
    if (!live) { body.appendChild(el('p', { class: 'sheet__empty', text: words.empty })); return; }
    var pack = live.pack, tokens = pack.tokens;

    body.appendChild(el('p', { class: 'sheet__question', text: '“' + pack.question + '”' }));
    body.appendChild(factsList([
      ['Asked by', pack.persona.name],
      [words.facts.scope, pack.scope.chip],
      [words.facts.analysis, live.plan.title],
      [words.facts.route, live.route.why]
    ]));

    var share = Math.min(100, tokens.used / tokens.budget * 100);
    body.appendChild(el('div', { class: 'meter' },
      el('div', { class: 'meter__label', text: words.budget }),
      el('div', { class: 'meter__bar' }, el('span', { style: 'width:' + share.toFixed(1) + '%', class: tokens.used > tokens.budget ? 'is-over' : '' })),
      el('div', { class: 'meter__line', text: fill(words.budgetLine, { used: number(tokens.used), budget: number(tokens.budget), repo: number(tokens.repo) }) }),
      tokens.factsBudget != null ? el('div', { class: 'meter__line meter__line--sub', text: fill(words.factsLine, { facts: number(tokens.facts || 0), budget: number(tokens.factsBudget),
        instructions: number(tokens.instructions || 0), tools: number(tokens.tools || 0), memory: number(tokens.memory || 0), total: number(tokens.total || tokens.used) }) }) : null));
    if (pack.compacted.length) {
      body.appendChild(el('p', { class: 'sheet__note', text: fill(words.compacted, {
        names: pack.compacted.map(function (c) { return c.id; }).join(', '),
        saved: number(pack.compacted.reduce(function (sum, c) { return sum + (c.saved || 0); }, 0))
      }) }));
    }

    // Pinned instructions first (never compacted), then the cards, then facts, tools and memory.
    var memory = pack.memory && pack.memory.turns && pack.memory.turns.length ? [{ name: counted(pack.memory.turns.length, ['earlier turn', 'earlier turns']), why: 'this session',
      tokens: pack.memory.tokens, text: pack.memory.text }] : [];
    var groups = [['instructions', pack.instructions ? [pack.instructions] : []], ['persona', [pack.persona]], ['policies', pack.policies], ['memory', memory],
      ['terms', pack.terms], ['skills', pack.skills], ['models', pack.models], ['facts', pack.facts || []], ['tools', pack.tools || []]];
    groups.forEach(function (group) {
      if (!group[1].length) return;
      var section = el('section', { class: 'group group--' + group[0] },
        el('h3', { class: 'group__title' }, words.groups[group[0]], el('span', { class: 'group__count', text: String(group[1].length) })));
      group[1].forEach(function (item) {
        var tags = [];
        if (item.detail === 'brief') tags.push(words.tags.compact);
        if (item.late) tags.push(words.tags.late);
        if (group[0] === 'facts') { section.appendChild(factRow(item)); return; }
        if (group[0] === 'tools') { section.appendChild(itemRow(item.name, item.description, item.tokens, item.text, null, tags)); return; }
        section.appendChild(itemRow(item.name, item.why, item.tokens, item.text, item.file, tags));
      });
      body.appendChild(section);
    });

    if (pack.leftOut.length) {
      var left = el('section', { class: 'group group--left' }, el('h3', { class: 'group__title' }, words.leftOut));
      pack.leftOut.forEach(function (item) {
        left.appendChild(el('div', { class: 'left' },
          el('span', { class: 'left__kind', text: words.kinds[item.kind] || item.kind }),
          el('span', { class: 'left__name', text: item.id, title: item.id }),
          el('span', { class: 'left__why' },
            item.reason ? el('span', { class: 'reason reason--' + item.reason, text: words.reasons[item.reason] || item.reason }) : null,
            item.why)));
      });
      body.appendChild(left);
    }
    var have = pack.considered, w = words.availableWords;
    body.appendChild(el('p', { class: 'sheet__note', text: fill(words.available, {
      terms: counted(have.terms, w.terms), skills: counted(have.skills, w.skills), models: counted(have.models, w.models), policies: counted(have.policies, w.policies)
    }) }));
  }

  function drawPromptTab(body) {
    var words = copy.sheet, live = state.live;
    if (!live) { body.appendChild(el('p', { class: 'sheet__empty', text: words.empty })); return; }
    var text = live.pack.prompt;
    var button = el('button', { class: 'sheet__copy', type: 'button', text: words.copy });
    button.addEventListener('click', function () {
      var done = function (ok) {
        button.textContent = ok ? words.copied : words.copyFailed;
        global.setTimeout(function () { button.textContent = words.copy; }, 1800);
      };
      if (global.navigator.clipboard && global.navigator.clipboard.writeText) global.navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      else done(false);
    });
    body.appendChild(el('div', { class: 'sheet__bar' }, el('p', { class: 'sheet__note', text: words.promptCaption }), button));
    body.appendChild(el('pre', { class: 'prompt', text: text }));
  }

  function drawRepositoryTab(body) {
    var words = copy.sheet;
    if (!(MCX.context && MCX.contextRepo)) { body.appendChild(el('p', { class: 'sheet__empty', text: words.repositoryMissing })); return; }
    var items = MCX.context.library(), stats = MCX.context.stats();
    body.appendChild(el('p', { class: 'sheet__note', html: words.repositoryCaption }));
    body.appendChild(el('p', { class: 'sheet__total', text: fill(words.repositoryTotal, { files: number(stats.files), tokens: number(stats.tokens) }) }));
    if (svc()) {
      graphSection(body);
      sourcesSection(body);
    }
    Object.keys(words.repositoryGroups).forEach(function (kind) {
      if (kind === 'source' && svc()) return;     // shown above, with freshness
      var own = items.filter(function (item) { return item.kind === kind; });
      if (!own.length) return;
      var section = el('section', { class: 'group' },
        el('h3', { class: 'group__title' }, words.repositoryGroups[kind], el('span', { class: 'group__count', text: String(own.length) })));
      own.forEach(function (item) { section.appendChild(itemRow(item.name, kind === 'persona' ? '' : item.id, item.tokens, item.text, item.file)); });
      body.appendChild(section);
    });
  }

  function drawWarehouseTab(body) {
    var words = copy.sheet, stats = MCX.db && MCX.db.stats;
    body.appendChild(el('p', { class: 'sheet__note', text: MCX.remote && words.warehouseCaptionRemote ? words.warehouseCaptionRemote : words.warehouseCaption }));
    if (!stats) { body.appendChild(el('p', { class: 'sheet__empty', text: state.engine === 'failed' ? words.warehouseFailed : words.warehouseStarting })); return; }
    body.appendChild(factsList([
      [words.warehouseFacts.engine, stats.engine],
      [words.warehouseFacts.rows, number(stats.rows)],
      [words.warehouseFacts.tables, String(stats.tables.length)],
      [words.warehouseFacts.built, number(stats.ms) + ' ms']
    ]));
    Object.keys(words.schemas).forEach(function (schema) {
      var own = stats.tables.filter(function (table) { return table.schema === schema; });
      if (!own.length) return;
      var section = el('section', { class: 'group' },
        el('h3', { class: 'group__title' }, schema, el('span', { class: 'group__count', text: counted(own.length, words.tables) })),
        el('p', { class: 'group__sub', text: words.schemas[schema] }));
      own.forEach(function (table) { section.appendChild(itemRow(table.name, '', null, table.columns.join(', '), counted(table.rows, copy.live.rows))); });
      body.appendChild(section);
    });
    if (svc()) opsSection(body);
  }

  // -------------------------------------------------------------------
  // The context engine's own steps: guard, route, knowledge, work,
  // memory, validation, actions and write-back. Each has a colour and an
  // icon in the trace and the timeline, and a drawer with the details.
  // -------------------------------------------------------------------

  var TYPED = { guard: 1, route: 1, doc: 1, work: 1, memory: 1, validate: 1, action: 1, act: 1 };

  function personName(id) { var p = id ? personaById(id) : null; return p ? p.name : String(id || ''); }
  function personLabel(id) { var p = id ? personaById(id) : null; return p ? p.name + ' · ' + (p.role || '') : String(id || ''); }
  function names(ids) { return (ids || []).map(personName).join(', '); }
  function errText(error) { return String((error && error.message) || error || 'Something went wrong').split('\n')[0]; }
  function capital(text) { text = String(text || ''); return text.charAt(0).toUpperCase() + text.slice(1); }
  function money(value, currency) { return (currency || 'USD') + ' ' + Number(value || 0).toFixed(4); }
  function shortHash(hash) { return hash ? String(hash).slice(0, 12) + '…' : '—'; }
  function stamp(iso) { return iso ? String(iso).slice(0, 16).replace('T', ' ') : ''; }
  function unique(list) { var out = []; (list || []).forEach(function (x) { if (x && out.indexOf(x) === -1) out.push(x); }); return out; }
  function findAction(live, id) { return live && live.actions ? live.actions.filter(function (a) { return a.id === id; })[0] || null : null; }
  function chip(text, className, title) { return el('span', { class: 'chip2' + (className ? ' ' + className : ''), text: text, title: title || null }); }

  /** Plain, readable labels for the engine's steps (the keys stay as they are, so highlights still find them). */
  function dressTool(tool, live) {
    if (!tool || !TYPED[tool.type]) return tool;
    var v = tool.value;
    if (tool.type === 'guard') {
      tool.verb = 'Guard:';
      tool.arg = { pass: 'passed', masked: 'personal data masked', blocked: 'blocked' }[v] || v;
      if (v === 'blocked') tool.alert = 'alert'; else if (v === 'masked') tool.alert = 'warn';
    } else if (tool.type === 'route') {
      tool.verb = 'Routed to';
      if (/refusal/.test(v)) tool.alert = 'warn';
    } else if (tool.type === 'validate') {
      tool.verb = 'Validated:';
      tool.arg = tool.meta || v;
      if (v !== 'passed') tool.alert = 'alert';
    } else if (tool.type === 'memory') {
      tool.verb = 'Remembered';
    } else if (tool.type === 'doc') {
      tool.verb = 'Knowledge:';
    } else if (tool.type === 'work') {
      tool.verb = 'Thread:';
    } else if (tool.type === 'action') {
      var a = findAction(live, v);
      tool.verb = a && a.needsApproval ? 'Human check:' : 'Proposed:';
      if (a && a.needsApproval) tool.alert = 'warn';
    }
    return tool;
  }

  function checkList(checks) {
    var list = el('ul', { class: 'checks' });
    (checks || []).forEach(function (c) {
      list.appendChild(el('li', { class: c.ok ? 'is-ok' : 'is-bad' },
        el('span', { class: 'checks__mark', 'aria-hidden': 'true', text: c.ok ? '✓' : '✗' }),
        el('span', { class: 'checks__label', text: c.ok ? c.label : (c.label + ': ' + (c.failed || 'failed') + (c.detail ? ' (' + c.detail + ')' : '')) }),
        c.kind ? el('span', { class: 'checks__kind', text: c.kind }) : null));
    });
    return list;
  }

  function findingList(findings) {
    var list = el('ul', { class: 'findings' });
    (findings || []).forEach(function (f) {
      list.appendChild(el('li', null, chip(f.rule, 'chip2--' + (f.severity === 'high' ? 'alert' : 'warn')), ' ', el('span', { class: 'findings__sev', text: f.severity }), ' “' + f.text + '”'));
    });
    return list;
  }

  /** A fact from a knowledge page or a work thread: system, date, the masked snippet, why, lineage. */
  function factCard(f) {
    var words = copy.sheet;
    return el('div', { class: 'fact fact--' + f.kind },
      el('div', { class: 'fact__head' },
        chip(f.system, 'chip2--sys'),
        f.channel ? el('span', { class: 'fact__channel', text: f.channel }) : null,
        el('span', { class: 'fact__date', text: f.date }),
        f.masked ? chip(words.tags.masked, 'chip2--warn', 'Personal data in this snippet was masked') : null),
      el('div', { class: 'fact__title', text: f.title }),
      el('blockquote', { class: 'fact__snippet', text: '“' + f.snippet + '”' }),
      f.why ? el('div', { class: 'fact__why', text: f.why }) : null,
      el('div', { class: 'fact__lineage' }, el('span', { class: 'fact__label', text: 'Lineage' }),
        chain([f.key, f.lineage && f.lineage.source, f.lineage && f.lineage.system])),
      f.file ? el('div', { class: 'fact__file', text: f.file }) : null);
  }

  function factRow(f) {
    var summary = el('summary', { class: 'item__head' },
      el('span', { class: 'item__name', text: f.title }),
      el('span', { class: 'item__why', text: f.system + ' · ' + f.date + ' · ' + f.why }));
    if (f.masked) summary.appendChild(el('span', { class: 'item__tag', text: copy.sheet.tags.masked }));
    if (f.tokens != null) summary.appendChild(el('span', { class: 'item__tokens', text: counted(f.tokens, copy.live.tokens) }));
    return el('details', { class: 'item item--fact' }, summary, el('div', { class: 'item__body' }, factCard(f)));
  }

  /** a → b → c, each a small box. */
  function chain(parts) {
    var wrap = el('span', { class: 'chain' });
    parts.filter(Boolean).forEach(function (part, i) {
      if (i) wrap.appendChild(el('span', { class: 'chain__arrow', 'aria-hidden': 'true', text: '→' }));
      wrap.appendChild(el('span', { class: 'chain__part', text: part }));
    });
    return wrap;
  }

  function actionSummary(a) {
    return factsList([
      ['Type', a.system + ' ' + a.type],
      ['Impact', a.impact + (a.needsApproval ? ' · waits for a human check' : '')],
      ['Approver', a.approverRole + (a.approvers && a.approvers.length ? ' (' + names(a.approvers) + ')' : '')],
      ['Why', a.why],
      ['Detail', a.detail]
    ]);
  }

  /** The drawer under one of the engine's steps. */
  function typeDetail(tool, live) {
    var box = el('div', { class: 'tdetail' });
    var type = tool.type;
    if (type === 'act') {
      box.appendChild(el('p', { text: tool.detail }));
      box.appendChild(el('div', { class: 'tdetail__file', text: tool.file }));
      return box;
    }
    if (!live) return null;
    if (type === 'guard') {
      var g = live.guard || {};
      if (g.findings && g.findings.length) box.appendChild(findingList(g.findings));
      else box.appendChild(el('p', { text: copy.sheet.guardrails.noFindings }));
      if (g.verdict !== 'pass' && g.clean) box.appendChild(el('p', { class: 'tdetail__muted', text: (g.verdict === 'blocked' ? 'Not run. ' : 'Read as: ') + '“' + g.clean + '”' }));
    } else if (type === 'route') {
      var d = live.decision || {};
      box.appendChild(factsList([['Rule', d.rule], ['Executor', d.executor + (d.connected === false ? ' (not connected)' : '')], ['What', d.what], ['Model', d.model],
        ['Fallback', d.fallback], ['Why', live.route && live.route.why], ['Follow-up of', live.route && live.route.followUp ? '“' + live.route.followUp.from + '” → “' + live.route.followUp.question + '”' : null]]));
    } else if (type === 'doc' || type === 'work') {
      var f = (live.facts || []).filter(function (x) { return x.key === tool.key; })[0];
      if (!f) return null;
      box.appendChild(factCard(f));
    } else if (type === 'memory') {
      var turns = (live.pack && live.pack.memory && live.pack.memory.turns) || [];
      turns.forEach(function (t) { box.appendChild(el('p', { class: 'tdetail__turn', text: t.line })); });
    } else if (type === 'validate') {
      box.appendChild(checkList(live.validation && live.validation.checks));
    } else if (type === 'action') {
      var a = findAction(live, tool.value);
      if (!a) return null;
      box.appendChild(el('p', { class: 'tdetail__title', text: a.title }));
      box.appendChild(actionSummary(a));
    }
    return box;
  }

  /** A write-back after a person approved an action: one more row in the trace and one more block. */
  Panel.prototype.actRow = function (item) {
    if (!this.trail || !item.write) return;
    var tool = { kind: 'context', type: 'act', verb: 'Wrote to', arg: item.write.system + ' · ' + item.write.ref, key: 'act:' + item.id,
      meta: 'simulated', detail: item.write.note, file: item.write.table + ' · outbox ' + item.write.outbox, tokens: null, source: '' };
    var at = global.performance.now();
    this.finishTool(this.startTool(tool, at), at + 140);
  };

  // -------------------------------------------------------------------
  // Under the context answer: banners, quality, cost, feedback, actions
  // -------------------------------------------------------------------

  function banner(kind, title, line, extra) {
    return el('div', { class: 'banner banner--' + kind, role: kind === 'blocked' || kind === 'withheld' ? 'alert' : null },
      el('span', { class: 'banner__icon', html: strokeIcon(ICONS[kind === 'blocked' ? 'guard' : kind === 'withheld' ? 'validate' : kind === 'memory' ? 'memory' : 'guard']) }),
      el('div', { class: 'banner__text' }, el('strong', { text: title }), el('span', { text: ' ' + line }), extra || null));
  }

  function qualityBadge(q) {
    if (!q) return null;
    var x = copy.extras;
    var badge = el('button', { class: 'qbadge qbadge--' + q.band, type: 'button', 'aria-label': x.quality + ' ' + q.score + ' of 100, ' + (x.bands[q.band] || q.band) + '. ' + qualityText(q) },
      el('span', { class: 'qbadge__ring', text: String(q.score) }),
      el('span', { class: 'qbadge__label' }, x.quality, el('b', { text: ' ' + (x.bands[q.band] || q.band) })));
    badge._quality = q;
    return badge;
  }
  function qualityText(q) {
    var x = copy.extras;
    return Object.keys(q.parts || {}).map(function (k) { var p = q.parts[k]; return (x.parts[k] || k) + ' ' + Math.round(p.value * 100) + '% (' + p.weight + ' pts): ' + p.detail; }).join('. ');
  }
  function qualityBars(q) {
    var x = copy.extras, list = el('div', { class: 'qbars' });
    Object.keys(q.parts || {}).forEach(function (k) {
      var p = q.parts[k], pct = Math.max(0, Math.min(100, p.value * 100));
      list.appendChild(el('div', { class: 'qbars__row' },
        el('span', { class: 'qbars__name', text: (x.parts[k] || k) }),
        el('span', { class: 'qbars__bar' }, el('span', { class: pct >= 80 ? 'is-good' : pct >= 50 ? 'is-mid' : 'is-low', style: 'width:' + pct.toFixed(0) + '%' })),
        el('span', { class: 'qbars__pts', text: Math.round(p.value * p.weight) + '/' + p.weight }),
        el('span', { class: 'qbars__detail', text: p.detail })));
    });
    return list;
  }

  var qtipEl = null;
  function showQuality(badge) {
    var q = badge._quality;
    if (!q) return;
    if (!qtipEl) { qtipEl = el('div', { class: 'qtip', role: 'tooltip' }); doc.body.appendChild(qtipEl); }
    qtipEl.innerHTML = '';
    qtipEl.appendChild(el('div', { class: 'qtip__title', text: copy.extras.qualityTitle + ': ' + q.score + ' / 100 · ' + (copy.extras.bands[q.band] || q.band) }));
    qtipEl.appendChild(qualityBars(q));
    placeAbove(qtipEl, badge);
  }
  function hideQuality() { if (qtipEl) qtipEl.classList.remove('is-on'); }

  function answerExtras(panel, live) {
    var x = copy.extras;
    var wrap = el('div', { class: 'extras' });
    var g = live.guard, v = live.validation;
    if (g && g.verdict === 'blocked') {
      wrap.appendChild(banner('blocked', x.blocked, fill(x.blockedLine, { reason: capital(g.reason || (live.route && live.route.why) || '') }), findingList(g.findings)));
    }
    if (v && (v.fallback || v.ok === false)) {
      var failed = (v.checks || []).filter(function (c) { return !c.ok; }).map(function (c) { return c.failed || c.label; }).join('; ');
      var held = null;
      if (v.withheld && v.withheld.answer) held = el('details', { class: 'banner__more' }, el('summary', { text: x.withheldShow }), el('pre', { text: v.withheld.answer }));
      wrap.appendChild(banner('withheld', x.withheld, fill(x.withheldLine, { failed: failed || 'a check failed' }), held));
    }
    if (g && g.verdict === 'masked') wrap.appendChild(banner('masked', x.masked, fill(x.maskedLine, { clean: g.clean })));
    if (live.route && live.route.followUp) wrap.appendChild(banner('memory', x.memory, fill(x.memoryLine, { from: live.route.followUp.from, question: live.route.followUp.question })));

    var meta = el('div', { class: 'extras__meta' });
    var badge = qualityBadge(live.quality);
    if (badge) meta.appendChild(badge);
    if (live.cost) meta.appendChild(chip(fill(x.cost, { tokens: number(live.cost.tokens), currency: live.cost.currency, estimate: Number(live.cost.estimate).toFixed(4) }), 'chip2--cost', 'Tokens handed over and the estimated cost of this answer'));
    if (live.audit) meta.appendChild(chip(fill(x.audit, { id: live.audit.id }), 'chip2--audit', 'Hash ' + live.audit.hash));
    if (live.version) meta.appendChild(chip('v ' + live.version, 'chip2--version', 'Context version'));
    wrap.appendChild(meta);

    if (live.log && svc()) wrap.appendChild(feedbackBox(live));
    if (live.actions && live.actions.length) wrap.appendChild(actionsBox(panel, live));
    panel.chat.appendChild(wrap);
    panel.scrollToEnd();
  }

  function feedbackBox(live) {
    var x = copy.extras, vote = null;
    var box = el('div', { class: 'fb' });
    var up = el('button', { class: 'fb__vote fb__vote--up', type: 'button', 'aria-pressed': 'false', title: x.up, 'aria-label': x.up, html: strokeIcon(ICONS.up) });
    var down = el('button', { class: 'fb__vote fb__vote--down', type: 'button', 'aria-pressed': 'false', title: x.down, 'aria-label': x.down, html: strokeIcon(ICONS.down) });
    var note = el('textarea', { class: 'fb__note', rows: '2', maxlength: '500', placeholder: x.notePlaceholder, 'aria-label': x.notePlaceholder });
    var send = el('button', { class: 'btn btn--primary btn--sm', type: 'button', text: x.send });
    var status = el('span', { class: 'fb__status', role: 'status' });
    var form = el('div', { class: 'fb__form', hidden: '' }, note, el('div', { class: 'fb__row' }, send, status));
    function pick(which) {
      vote = which;
      up.setAttribute('aria-pressed', String(which === 'up'));
      down.setAttribute('aria-pressed', String(which === 'down'));
      form.hidden = false;
      note.focus();
    }
    up.addEventListener('click', function () { pick('up'); });
    down.addEventListener('click', function () { pick('down'); });
    send.addEventListener('click', function () {
      if (!vote) return;
      send.disabled = true;
      status.textContent = x.working;
      svc().feedback({ log: live.log.id, vote: vote, note: note.value.trim() || null, by: live.asker }).then(function (fb) {
        box.innerHTML = '';
        box.classList.add('is-done');
        box.appendChild(el('span', { class: 'fb__done', html: strokeIcon(ICONS[fb.vote]) }));
        box.appendChild(el('span', { text: fill(x.thanks, { id: fb.id, note: fb.note ? ': “' + fb.note + '”' : '' }) }));
        refreshLoop();
      }, function (error) { send.disabled = false; status.textContent = errText(error); status.classList.add('is-error'); });
    });
    box.appendChild(el('div', { class: 'fb__row' }, el('span', { class: 'fb__q', text: x.feedback }), up, down));
    box.appendChild(form);
    return box;
  }

  /** People who may decide an action: its approvers, and for a low-impact one also the asker. */
  function eligible(action, asker) { return unique((action.needsApproval ? [] : [asker]).concat(action.approvers || [])); }

  function personSelect(ids, selected, label) {
    var select = el('select', { class: 'select', 'aria-label': label || 'Person' });
    ids.forEach(function (id) {
      var option = el('option', { value: id, text: personLabel(id) });
      if (id === selected) option.selected = true;
      select.appendChild(option);
    });
    return select;
  }

  /** Approve or reject one queued action; on approve it is written back (simulated). */
  function decideControls(item, asker, onDone) {
    var x = copy.extras;
    var people = eligible(item, asker);
    var who = personSelect(people, people.indexOf(state.persona && state.persona.id) !== -1 ? state.persona.id : people[0], x.decideAs);
    var yes = el('button', { class: 'btn btn--go btn--sm', type: 'button', text: x.approve });
    var no = el('button', { class: 'btn btn--stop btn--sm', type: 'button', text: x.reject });
    var status = el('span', { class: 'act__status', role: 'status' });
    var wrap = el('div', { class: 'act__controls' }, el('label', { class: 'act__as' }, el('span', { text: x.decideAs }), who), yes, no, status);
    function decide(decision) {
      yes.disabled = no.disabled = who.disabled = true;
      status.className = 'act__status';
      status.textContent = x.working;
      svc().decide(item.qid || item.id, { decision: decision, by: who.value }).then(function (done) {
        onDone(done);
      }, function (error) {
        yes.disabled = no.disabled = who.disabled = false;
        status.textContent = errText(error);
        status.classList.add('is-error');
      });
    }
    yes.addEventListener('click', function () { decide('approve'); });
    no.addEventListener('click', function () { decide('reject'); });
    return wrap;
  }

  function decidedLine(item) {
    var x = copy.extras;
    if (item.status === 'written' && item.write) return el('div', { class: 'act__result act__result--written' }, el('span', { html: strokeIcon(ICONS.act) }), fill(x.written, { system: item.write.system, ref: item.write.ref }));
    if (item.status === 'rejected') return el('div', { class: 'act__result act__result--rejected', text: fill(x.rejected, { by: personName(item.decision && item.decision.by) }) + (item.decision && item.decision.note ? ': “' + item.decision.note + '”' : '') });
    return el('div', { class: 'act__result', text: item.status });
  }

  function actionCard(a, controls) {
    var x = copy.extras;
    return el('div', { class: 'act act--' + a.impact },
      el('div', { class: 'act__head' },
        chip(a.system + ' · ' + a.type, 'chip2--sys'),
        chip(a.needsApproval ? 'High impact' : 'Low impact', a.needsApproval ? 'chip2--alert' : 'chip2--ok')),
      el('div', { class: 'act__title', text: a.title }),
      a.detail ? el('div', { class: 'act__detail', text: a.detail }) : null,
      el('div', { class: 'act__who', text: (a.needsApproval ? fill(x.humanCheck, { role: a.approverRole }) + ' (' + names(a.approvers) + ')' : fill(x.lowImpact, { role: a.approverRole })) + (a.why ? ' · ' + a.why : '') }),
      controls || null);
  }

  function actionsBox(panel, live) {
    var x = copy.extras;
    var box = el('section', { class: 'acts' }, el('div', { class: 'acts__head' }, el('span', { class: 'acts__title', html: strokeIcon(ICONS.action) + '<span>' + escapeHtml(x.actions) + '</span>' }), el('span', { class: 'acts__hint', text: x.actionsHint })));
    live.actions.forEach(function (a, i) {
      var qid = (live.queued || [])[i] || null;
      var slot = el('div');
      if (qid && svc()) {
        var item = {}; Object.keys(a).forEach(function (k) { item[k] = a[k]; });
        item.qid = qid;
        slot.appendChild(decideControls(item, live.asker, function (done) {
          slot.innerHTML = '';
          slot.appendChild(decidedLine(done));
          if (done.status === 'written') panel.actRow(done);
          refreshLoop();
        }));
      }
      box.appendChild(actionCard(a, slot));
    });
    return box;
  }

  // -------------------------------------------------------------------
  // The context sheet: content that comes from MCX.service (async)
  // -------------------------------------------------------------------

  /** Fill part of the sheet when a promise settles; dropped if the sheet was redrawn meanwhile. */
  function later(parent, load, render) {
    var token = sheet.token;
    var holder = el('div', { class: 'async' }, el('p', { class: 'sheet__loading', text: 'Loading…' }));
    parent.appendChild(holder);
    sheet.pending++;
    Promise.resolve().then(load).then(function (data) {
      if (token !== sheet.token) return;
      holder.innerHTML = '';
      render(holder, data);
    }, function (error) {
      if (token !== sheet.token) return;
      holder.innerHTML = '';
      holder.appendChild(el('p', { class: 'sheet__error', text: errText(error) }));
    }).then(function () {
      if (token !== sheet.token) return;
      sheet.pending--;
      if (!sheet.pending && sheet.keep != null) { sheet.body.scrollTop = sheet.keep; sheet.keep = null; }
    });
    return holder;
  }

  /** Redraw the open sheet where it is (after a decision, a change step, new feedback…). */
  function refreshLoop() { if (sheet.open && sheet.tab === 'loop') drawSheet(true); }

  function section(kind, title, count) {
    return el('section', { class: 'group group--' + kind, id: 'sec-' + kind },
      el('h3', { class: 'group__title' }, title, count != null ? el('span', { class: 'group__count', text: String(count) }) : null));
  }

  function drawGuardrailsTab(body) {
    var words = copy.sheet, gw = words.guardrails, live = state.live;
    if (!live) { body.appendChild(el('p', { class: 'sheet__empty', text: words.empty })); return; }
    if (!live.guard) { body.appendChild(el('p', { class: 'sheet__empty', text: 'This answer came from an engine without guardrails.' })); return; }
    var g = live.guard, d = live.decision || {}, v = live.validation || { checks: [] }, q = live.quality, cost = live.cost || {}, ex = live.execution || {};
    body.appendChild(el('p', { class: 'sheet__note', text: gw.intro }));
    body.appendChild(el('p', { class: 'sheet__question', text: '“' + live.pack.question + '”' }));

    var passed = v.checks.filter(function (c) { return c.ok; }).length;
    var tiles = el('div', { class: 'tiles' },
      tile('guard', gw.guard, { pass: 'Passed', masked: 'Masked', blocked: 'Blocked' }[g.verdict] || g.verdict, g.findings.length ? g.findings.map(function (f) { return f.rule; }).join(', ') : 'no findings', g.verdict === 'blocked' ? 'alert' : g.verdict === 'masked' ? 'warn' : 'ok'),
      tile('route', gw.route, capital(d.executor || live.route.kind), d.rule || live.route.kind),
      tile('validate', gw.validation, passed + ' / ' + v.checks.length, v.ok ? 'all checks passed' : 'answer withheld', v.ok ? 'ok' : 'alert'),
      q ? tile('quality', gw.quality, String(q.score), copy.extras.bands[q.band] || q.band, q.band === 'strong' ? 'ok' : q.band === 'weak' ? 'alert' : 'warn') : null,
      tile('cost', gw.cost, money(cost.estimate, cost.currency), number(cost.tokens || 0) + ' tokens'),
      tile('version', gw.version, live.version || '—', live.audit ? live.audit.id : ''));
    body.appendChild(tiles);

    var sGuard = section('guard', gw.guard);
    sGuard.appendChild(g.findings.length ? findingList(g.findings) : el('p', { class: 'sheet__note', text: gw.noFindings }));
    if (g.verdict !== 'pass') sGuard.appendChild(el('p', { class: 'sheet__note', text: (g.verdict === 'blocked' ? 'Blocked: ' : 'Read as: ') + '“' + g.clean + '”' + (g.reason ? ' · ' + g.reason : '') }));
    body.appendChild(sGuard);

    var sRoute = section('route', gw.route);
    sRoute.appendChild(factsList([['Rule', d.rule], ['Executor', (d.executor || '') + (d.connected === false ? ' (not connected)' : '')], ['What', d.what], ['Model', d.model], ['Fallback', d.fallback],
      ['Route', live.route.kind + ' → ' + live.plan.name], ['Why', live.route.why]]));
    body.appendChild(sRoute);

    var sVal = section('validate', gw.validation, passed + '/' + v.checks.length);
    sVal.appendChild(checkList(v.checks));
    if (v.withheld && v.withheld.answer) sVal.appendChild(el('details', { class: 'banner__more' }, el('summary', { text: copy.extras.withheldShow }), el('pre', { text: v.withheld.answer })));
    body.appendChild(sVal);

    if (q) {
      var sQ = section('quality', gw.quality, q.score + ' · ' + (copy.extras.bands[q.band] || q.band));
      sQ.appendChild(qualityBars(q));
      body.appendChild(sQ);
    }

    var sCost = section('cost', gw.cost);
    var t = live.pack.tokens || {};
    sCost.appendChild(factsList([['Tokens', number(cost.tokens || 0) + ' handed over (cards ' + number(t.used || 0) + ' of ' + number(t.budget || 0) + ', facts ' + number(t.facts || 0) + ' of ' + number(t.factsBudget || 0) + ')'],
      ['Estimate', money(cost.estimate, cost.currency) + ' at ' + cost.perThousand + ' per 1,000 tokens']]));
    if (svc()) later(sCost, function () { return svc().observe(); }, function (holder, o) {
      var spent = (o.cost.byPersona || {})[live.asker] || 0;
      holder.appendChild(el('p', { class: 'sheet__note', text: fill(gw.spentToday, { name: personName(live.asker), currency: o.cost.currency, spent: Number(spent).toFixed(4), cap: o.cost.cap == null ? 'no cap' : Number(o.cost.cap).toFixed(2) }) }));
    });
    body.appendChild(sCost);

    var sEx = section('execution', gw.execution);
    var b = ex.bounds || {};
    sEx.appendChild(factsList([['Queries', (ex.queries || 0) + ' of at most ' + (b.maxQueries || '—')], ['Rows read', number(ex.rows || 0) + ' of at most ' + number(b.maxRows || 0)], ['Stopped', ex.stopped || null]]));
    body.appendChild(sEx);

    var sLin = section('lineage', gw.lineage);
    var findings = (live.context.marks || []).filter(function (m) { return m.good != null && m.lineage && m.lineage.length; });
    findings.forEach(function (m, i) {
      var box = el('details', { class: 'lineage' }, el('summary', { text: '“' + m.good + '”' }));
      if (i === 0) box.open = true;
      m.lineage.forEach(function (l) {
        var parts = [l.step, l.table && l.table !== l.step ? l.table : null, l.source ? l.source + (l.system ? ' (' + l.system + ')' : '') : null];
        var line = el('div', { class: 'lineage__line' }, chain(parts));
        if (l.upstream && l.upstream.length) line.appendChild(el('span', { class: 'lineage__up', text: ' fed by ' + l.upstream.map(function (u) { return u.system; }).join(', ') }));
        box.appendChild(line);
      });
      sLin.appendChild(box);
    });
    (live.facts || []).forEach(function (f) {
      sLin.appendChild(el('div', { class: 'lineage__line lineage__line--fact' }, chain([f.key, f.lineage && f.lineage.source, f.lineage && f.lineage.system, f.date])));
    });
    body.appendChild(sLin);

    var sAudit = section('audit', gw.audit);
    sAudit.appendChild(factsList([['Entry', live.audit ? live.audit.id : 'not logged (no service)'], ['Hash', live.audit ? live.audit.hash : null], ['Logged as', live.log ? live.log.id + ' · ' + stamp(live.log.at) : null],
      [gw.version, live.version], ['Sources', live.build ? live.build.ok + ' of ' + live.build.sources + ' reachable' + (live.build.stale && live.build.stale.length ? ' · stale: ' + live.build.stale.join(', ') : '') : null]]));
    body.appendChild(sAudit);
  }

  function tile(kind, label, value, sub, tone) {
    return el('div', { class: 'tile tile--' + kind + (tone ? ' is-' + tone : '') },
      el('div', { class: 'tile__label', text: label }),
      el('div', { class: 'tile__value', text: value }),
      sub ? el('div', { class: 'tile__sub', text: sub }) : null);
  }

  // ---- Repository: graph, sources with freshness ---------------------------------------------------

  var NODE_TYPES = ['persona', 'operator', 'region', 'store', 'term', 'metric', 'model', 'table', 'skill', 'policy', 'doc', 'thread', 'source'];

  function focusNodes(live) {
    if (!live || !live.pack) return [];
    var out = [];
    if (live.asker) out.push('persona:' + live.asker);
    (live.pack.terms || []).slice(0, 2).forEach(function (t) { out.push('term:' + t.id); });
    (live.facts || []).slice(0, 2).forEach(function (f) { out.push((f.kind === 'doc' ? 'doc:' : 'thread:') + f.id); });
    (live.pack.models || []).slice(0, 1).forEach(function (m) { out.push('model:' + m.id); });
    return out;
  }

  function graphSection(body) {
    var words = copy.sheet;
    var sec = section('graph', words.graph);
    body.appendChild(sec);
    later(sec, function () {
      var foci = focusNodes(state.live);
      return Promise.all([svc().graph({})].concat(foci.map(function (f) { return svc().graph({ focus: f }).catch(function () { return null; }); })));
    }, function (holder, r) {
      var g = r[0], c = g.counts || {};
      holder.appendChild(el('p', { class: 'sheet__note', text: fill(words.graphLine, { nodes: number(c.nodes || 0), edges: number(c.edges || 0) }) }));
      var types = el('div', { class: 'chips' });
      Object.keys(c.types || {}).sort(function (a, b) { return NODE_TYPES.indexOf(a) - NODE_TYPES.indexOf(b); }).forEach(function (k) { types.appendChild(chip(k + ' ' + c.types[k], 'chip2--node chip2--n-' + k)); });
      holder.appendChild(types);
      var rels = el('div', { class: 'chips chips--rel' });
      Object.keys(c.relations || {}).sort(function (a, b) { return c.relations[b] - c.relations[a]; }).forEach(function (k) { rels.appendChild(chip(k.replace(/_/g, ' ') + ' ' + c.relations[k], 'chip2--rel')); });
      holder.appendChild(rels);
      var near = r.slice(1).filter(Boolean);
      if (!near.length) return;
      holder.appendChild(el('h4', { class: 'group__sub2', text: words.neighbourhood }));
      holder.appendChild(neighbourhoodSvg(near));
      var list = el('div', { class: 'near' });
      near.forEach(function (n) {
        var others = n.edges.map(function (e) { return { rel: e.rel, other: e.from === n.focus ? e.to : e.from, out: e.from === n.focus }; });
        var item = el('details', { class: 'item' }, el('summary', { class: 'item__head' },
          chip(n.node.type, 'chip2--node chip2--n-' + n.node.type), el('span', { class: 'item__name', text: n.node.label }),
          el('span', { class: 'item__tokens', text: counted(others.length, ['link', 'links']) })));
        var ul = el('ul', { class: 'near__list' });
        others.forEach(function (o) { ul.appendChild(el('li', null, el('span', { class: 'near__rel', text: (o.out ? '' : '← ') + o.rel.replace(/_/g, ' ') + (o.out ? ' →' : '') }), ' ', el('span', { class: 'near__id', text: o.other }))); });
        item.appendChild(ul);
        list.appendChild(item);
      });
      holder.appendChild(list);
    });
  }

  /** The question in the middle, the nodes it touches around it, each with its number of links. */
  function neighbourhoodSvg(near) {
    var W = 640, H = 262, cx = W / 2, cy = 122, n = near.length;
    var NS = 'http://www.w3.org/2000/svg';
    function s(tag, attrs, text) {
      var node = doc.createElementNS(NS, tag);
      Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
      if (text != null) node.textContent = text;
      return node;
    }
    var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'nsvg', role: 'img', 'aria-label': 'This question and the graph nodes it touches' });
    var spots = near.map(function (x, i) {
      var angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      return { x: cx + Math.cos(angle) * 235, y: cy + Math.sin(angle) * 82, item: x };
    });
    spots.forEach(function (p) { svg.appendChild(s('line', { x1: cx, y1: cy, x2: p.x, y2: p.y, class: 'nsvg__edge' })); });
    spots.forEach(function (p) {
      var type = p.item.node.type, label = p.item.node.label;
      if (label.length > 30) label = label.slice(0, 28) + '…';
      var g = s('g', { class: 'nsvg__node nsvg__node--' + type });
      g.appendChild(s('circle', { cx: p.x, cy: p.y, r: 8 + Math.min(10, p.item.edges.length) }));
      g.appendChild(s('text', { x: p.x, y: p.y + 28, 'text-anchor': 'middle', class: 'nsvg__label' }, label));
      g.appendChild(s('text', { x: p.x, y: p.y + 41, 'text-anchor': 'middle', class: 'nsvg__type' }, type + ' · ' + p.item.edges.length + ' links'));
      g.appendChild(s('title', {}, p.item.node.id));
      svg.appendChild(g);
    });
    svg.appendChild(s('circle', { cx: cx, cy: cy, r: 26, class: 'nsvg__centre' }));
    svg.appendChild(s('text', { x: cx, y: cy + 4, 'text-anchor': 'middle', class: 'nsvg__centre-text' }, 'You asked'));
    return el('div', { class: 'nsvg__wrap' }, svg);
  }

  function sourcesSection(body) {
    var words = copy.sheet;
    var sec = section('sources', words.sources);
    body.appendChild(sec);
    later(sec, function () { return svc().sources(); }, function (holder, r) {
      holder.appendChild(el('p', { class: 'sheet__note', text: 'This deployment serves the ' + String(r.region).toUpperCase() + ' region; "today" is ' + r.today + '. Content held elsewhere or older than its source keeps is never retrieved.' }));
      r.sources.forEach(function (src) {
        var tone = src.status === 'stale' || src.status === 'unreachable' ? 'alert' : src.status === 'fresh' ? 'ok' : 'live';
        var summary = el('summary', { class: 'item__head' },
          el('span', { class: 'item__name', text: src.name }),
          el('span', { class: 'item__why', text: src.system }),
          chip(src.kind, 'chip2--kind chip2--k-' + src.kind),
          chip(src.status, 'chip2--' + tone));
        var age = src.ageHours != null ? number(src.ageHours) + ' h old, SLA ' + number(src.slaHours) + ' h' : null;
        holder.appendChild(el('details', { class: 'item item--source' }, summary, el('div', { class: 'item__body' }, factsList([
          ['Updated', (src.updated || '—') + (age ? ' · ' + age : '')], ['Items', src.items != null ? String(src.items) : null], ['Where', src.location], ['Owner', src.owner],
          ['Residency', src.residency ? String(src.residency).toUpperCase() : null], ['Keeps', src.retention_days != null ? src.retention_days + ' days' : null],
          ['Personal data', src.pii && src.pii.length ? src.pii.join(', ') : 'none'], ['Who may see it', (src.access || []).join(', ')], ['Detail', src.detail]]))));
      });
    });
  }

  function opsSection(body) {
    var words = copy.sheet;
    var sec = el('section', { class: 'group group--ops' },
      el('h3', { class: 'group__title' }, 'OPS', el('span', { class: 'group__count', text: '1 table' })),
      el('p', { class: 'group__sub', text: words.ops }));
    body.appendChild(sec);
    later(sec, function () { return svc().sql({ sql: 'SELECT * FROM OPS.ACTION_LOG ORDER BY at DESC, id DESC', limit: 50 }); }, function (holder, r) {
      var cols = ['at', 'system', 'type', 'title', 'decided_by', 'external_ref', 'status'];
      var item = itemRow('ACTION_LOG', '', null, r.columns.join(', '), counted(r.total, copy.live.rows));
      holder.appendChild(item);
      if (!r.rows.length) { holder.appendChild(el('p', { class: 'sheet__note', text: 'Empty: approve a proposed action under an answer and it is written here.' })); return; }
      var table = el('table', { class: 'grid' });
      var head = el('tr');
      cols.forEach(function (c) { head.appendChild(el('th', { text: c })); });
      table.appendChild(el('thead', null, head));
      var tb = el('tbody');
      r.rows.forEach(function (row) {
        var tr = el('tr');
        cols.forEach(function (c) { tr.appendChild(el('td', { text: c === 'at' ? stamp(row[c]) : row[c] == null ? '—' : String(row[c]) })); });
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      holder.appendChild(el('div', { class: 'grid__wrap' }, table));
    });
  }

  // ---- Learning loop -------------------------------------------------------------------------------

  var STEPS = ['draft', 'tested', 'reviewed', 'approved', 'deployed'];

  function drawLoopTab(body) {
    var words = copy.sheet.loop, s = svc();
    body.appendChild(el('p', { class: 'sheet__note', text: words.intro }));
    if (!s) { body.appendChild(el('p', { class: 'sheet__empty', text: 'The learning loop needs the context service, which did not load.' })); return; }
    var jump = el('nav', { class: 'jump', 'aria-label': 'Sections' });
    [['observe', words.observe], ['log', words.log], ['feedback', words.feedback], ['evals', words.evals], ['gaps', words.gaps], ['changes', words.changes],
      ['versions', words.versions], ['actions', words.actions], ['audit', words.audit], ['freshness', words.freshness], ['retention', words.retention]].forEach(function (p) {
      var b = el('button', { class: 'jump__btn jump__btn--' + p[0], type: 'button', text: p[1] });
      b.addEventListener('click', function () { var t = doc.getElementById('sec-' + p[0]); if (t) sheet.body.scrollTop = t.offsetTop - 8; });
      jump.appendChild(b);
    });
    body.appendChild(jump);
    later(body, function () {
      return Promise.all([s.observe(), s.log({ limit: 12 }), s.gaps(), s.changes(), s.versions(), s.actions(), s.audit({ limit: 200 })]);
    }, function (holder, r) {
      var obs = r[0], log = r[1], gaps = r[2], changes = r[3], versions = r[4], actions = r[5], audit = r[6];
      holder.appendChild(observeSection(obs));
      holder.appendChild(logSection(log));
      holder.appendChild(feedbackSection(obs, audit));
      holder.appendChild(evalsSection(obs));
      holder.appendChild(gapsSection(gaps));
      holder.appendChild(changesSection(changes));
      holder.appendChild(versionsSection(versions, changes));
      holder.appendChild(queueSection(actions));
      holder.appendChild(auditSection(audit));
      holder.appendChild(freshnessSection(obs));
      holder.appendChild(retentionSection(obs));
    });
  }

  function observeSection(o) {
    var words = copy.sheet.loop;
    var sec = section('observe', words.observe);
    var inFlight = ['draft', 'tested', 'reviewed', 'approved'].reduce(function (n, k) { return n + (o.changes[k] || 0); }, 0);
    var stale = o.sources.stale || [];
    sec.appendChild(el('div', { class: 'tiles tiles--loop' },
      tile('answers', 'Answers', number(o.answers), o.avgQuality == null ? 'none yet' : 'avg quality ' + o.avgQuality),
      tile('quality', 'Quality bands', (o.bands.strong || 0) + ' · ' + (o.bands.fair || 0) + ' · ' + (o.bands.weak || 0), 'strong · fair · weak'),
      tile('guard', 'Guard', o.guard.blocked + ' blocked', o.guard.masked + ' masked', o.guard.blocked ? 'warn' : 'ok'),
      tile('validate', 'Withheld', String(o.validationFails), 'failed validation', o.validationFails ? 'alert' : 'ok'),
      tile('feedback', 'Feedback', '▲ ' + o.feedback.up + '  ▼ ' + o.feedback.down, 'votes'),
      tile('gaps', 'Gaps open', o.gaps.open + ' of ' + o.gaps.total, o.gaps.fixed + ' fixed', o.gaps.open ? 'warn' : 'ok'),
      tile('changes', 'Changes', (o.changes.deployed || 0) + ' live', inFlight + ' in progress'),
      tile('action', 'Actions', (o.actions.proposed || 0) + ' waiting', o.written + ' written back'),
      tile('cost', 'Cost today', money(o.cost.total, o.cost.currency), o.cost.cap == null ? 'no cap' : 'cap ' + Number(o.cost.cap).toFixed(2) + ' per person'),
      tile('drift', 'Drift alerts', String(o.drift.alerts.length), o.drift.sources + ' sources · ' + o.drift.answers + ' answers · ' + o.drift.golden + ' golden', o.drift.alerts.length ? 'warn' : 'ok'),
      tile('sources', 'Sources fresh', (o.sources.ok - stale.length) + ' of ' + o.sources.total, stale.length ? 'stale: ' + stale.join(', ') : 'all within SLA', stale.length ? 'warn' : 'ok'),
      tile('version', 'Version', o.version || '—', o.versions + ' in history · audit ' + (o.audit.ok ? 'intact' : 'BROKEN'), o.audit.ok ? null : 'alert')));
    return sec;
  }

  function logSection(log) {
    var words = copy.sheet.loop;
    var sec = section('log', words.log, log.total);
    if (!log.entries.length) { sec.appendChild(el('p', { class: 'sheet__note', text: words.emptyLog })); return sec; }
    var list = el('div', { class: 'rows' });
    log.entries.forEach(function (e) {
      list.appendChild(el('div', { class: 'lrow' },
        el('span', { class: 'lrow__id', text: e.id }),
        el('span', { class: 'lrow__who', text: personName(e.persona) }),
        el('span', { class: 'lrow__q', text: e.question, title: e.question }),
        el('span', { class: 'lrow__meta' },
          chip(e.route + (e.analysis && e.analysis !== e.route ? ' → ' + e.analysis.split('/').pop() : ''), 'chip2--route'),
          e.guard !== 'pass' ? chip(e.guard, e.guard === 'blocked' ? 'chip2--alert' : 'chip2--warn') : null,
          !e.validation ? chip('withheld', 'chip2--alert') : null,
          e.memory ? chip('memory', 'chip2--memory') : null,
          chip(e.quality + ' ' + e.band, 'chip2--q-' + e.band),
          el('span', { class: 'lrow__time', text: stamp(e.at) }))));
    });
    sec.appendChild(list);
    if (log.purged) sec.appendChild(el('p', { class: 'sheet__note', text: log.purged + ' older entries were purged (retention).' }));
    return sec;
  }

  function feedbackSection(o, audit) {
    var words = copy.sheet.loop;
    var votes = audit.entries.filter(function (e) { return e.type === 'feedback'; }).slice(0, 8);
    var sec = section('feedback', words.feedback, o.feedback.up + o.feedback.down);
    sec.appendChild(el('p', { class: 'sheet__note', text: '▲ ' + o.feedback.up + ' useful · ▼ ' + o.feedback.down + ' not useful. Vote under any live answer; a down-vote with a note becomes a gap with a suggested fix.' }));
    votes.forEach(function (e) {
      var d = e.data || {};
      sec.appendChild(el('div', { class: 'lrow lrow--fb' },
        el('span', { class: 'lrow__vote lrow__vote--' + d.vote, html: strokeIcon(ICONS[d.vote === 'down' ? 'down' : 'up']) }),
        el('span', { class: 'lrow__who', text: personName(e.actor) }),
        el('span', { class: 'lrow__q', text: d.note ? '“' + d.note + '”' : '(no note)' }),
        el('span', { class: 'lrow__meta' }, chip(e.subject, 'chip2--route'), el('span', { class: 'lrow__time', text: stamp(e.at) }))));
    });
    return sec;
  }

  function evalsSection(o) {
    var words = copy.sheet.loop;
    var sec = section('evals', words.evals);
    var last = o.evals;
    var line = el('p', { class: 'sheet__note', text: last ? 'Last run ' + stamp(last.at) + ' on version ' + last.version + ': ' + last.passed + ' of ' + last.total + ' pass (score ' + last.score + ').' : 'The business evals (golden set) have not been run in this session yet.' });
    var out = el('div');
    var run = el('button', { class: 'btn btn--primary btn--sm', type: 'button', text: words.runEvals });
    run.addEventListener('click', function () {
      run.disabled = true;
      out.innerHTML = '';
      out.appendChild(progress('Running the business evals…'));
      frames().then(function () { return svc().evals(); }).then(function (r) {
        out.innerHTML = '';
        out.appendChild(el('p', { class: 'result-line ' + (r.passed === r.total ? 'is-ok' : 'is-bad'), text: r.passed + ' of ' + r.total + ' evals pass · score ' + r.score + ' · version ' + r.version }));
        var bad = r.cases.filter(function (c) { return !c.ok; });
        bad.forEach(function (c) { out.appendChild(el('p', { class: 'sheet__error', text: c.id + ' ' + c.title + ': ' + c.failures.join('; ') })); });
        run.disabled = false;
      }, function (error) { out.innerHTML = ''; out.appendChild(el('p', { class: 'sheet__error', text: errText(error) })); run.disabled = false; });
    });
    sec.appendChild(line);
    sec.appendChild(el('div', { class: 'btnrow' }, run));
    sec.appendChild(out);
    return sec;
  }

  function gapsSection(g) {
    var words = copy.sheet.loop;
    var sec = section('gaps', words.gaps, g.open + ' open');
    if (!g.gaps.length) { sec.appendChild(el('p', { class: 'sheet__note', text: words.emptyGaps })); return sec; }
    g.gaps.slice().reverse().forEach(function (gap) {
      var sug = gap.suggestion;
      var card = el('div', { class: 'card card--gap is-' + gap.status },
        el('div', { class: 'card__head' }, chip(gap.type, 'chip2--gap'), chip(gap.status, 'chip2--st-' + gap.status), el('span', { class: 'card__who', text: personName(gap.persona) + ' · asked ' + gap.count + '×' })),
        el('div', { class: 'card__title', text: '“' + gap.question + '”' }),
        el('div', { class: 'card__line', text: gap.detail }));
      if (sug) card.appendChild(el('div', { class: 'card__fix' }, el('b', { text: sug.kind ? 'Suggested fix: ' : 'For a person: ' }), sug.kind ? sugLabel(sug) + '. ' : '', sug.reason));
      if (gap.notes && gap.notes.length) card.appendChild(el('div', { class: 'card__line', text: 'Notes: ' + gap.notes.map(function (n) { return '“' + n + '”'; }).join(' ') }));
      if (gap.changes && gap.changes.length) card.appendChild(el('div', { class: 'card__line', text: 'Changes: ' + gap.changes.join(', ') }));
      if (sug && sug.kind && gap.status === 'open') {
        var status = el('span', { class: 'act__status', role: 'status' });
        var author = personSelect(MCX.catalog.personas.map(function (p) { return p.id; }), state.persona.id, 'Draft as');
        var btn = el('button', { class: 'btn btn--primary btn--sm', type: 'button', text: words.draft });
        btn.addEventListener('click', function () {
          btn.disabled = author.disabled = true;
          status.textContent = copy.extras.working;
          svc().draft({ fromGap: gap.id, author: author.value }).then(refreshLoop, function (error) { btn.disabled = author.disabled = false; status.textContent = errText(error); status.classList.add('is-error'); });
        });
        card.appendChild(el('div', { class: 'btnrow' }, el('label', { class: 'act__as' }, el('span', { text: 'Author' }), author), btn,
          el('span', { class: 'card__hint', text: 'the engine words it by rule; the owner of the file signs it off, never its author' }), status));
      }
      sec.appendChild(card);
    });
    return sec;
  }

  function sugLabel(s) {
    if (s.kind === 'add-synonym') return 'add “' + s.value + '” as a synonym of ' + s.target;
    if (s.kind === 'add-note') return 'add a field note to ' + s.target;
    if (s.kind === 'set-param') return 'set ' + s.target + ' to ' + JSON.stringify(s.value);
    return s.kind + ' ' + s.target;
  }

  function stepper(status) {
    var labels = { draft: 'Draft', tested: 'Test', reviewed: 'Review', approved: 'Approve', deployed: 'Deploy' };
    var at = STEPS.indexOf(status);
    var wrap = el('ol', { class: 'stepper' + (status === 'rejected' || status === 'rolled-back' ? ' is-off' : '') });
    STEPS.forEach(function (st, i) {
      // Steps up to the change's status are done; the next one is the step to take now.
      wrap.appendChild(el('li', { class: i <= at ? 'is-done' : at !== -1 && i === at + 1 ? 'is-now' : '' }, el('span', { class: 'stepper__dot', text: i <= at ? '✓' : String(i + 1) }), el('span', { text: labels[st] })));
    });
    return wrap;
  }

  /** Let the page paint (the progress bar) before a long synchronous step; a hidden page gets no frames, so a timer backs it up. */
  function frames() {
    return new Promise(function (resolve) {
      var done = false;
      function go() { if (!done) { done = true; global.setTimeout(resolve, 40); } }
      global.requestAnimationFrame(go);
      global.setTimeout(go, 150);
    });
  }

  function progress(text) {
    var started = global.performance.now();
    var secs = el('span', { class: 'progress__secs', text: '0.0 s' });
    var wrap = el('div', { class: 'progress', role: 'status' }, el('div', { class: 'progress__bar' }, el('span')), el('div', { class: 'progress__text' }, text + ' ', secs));
    var timer = global.setInterval(function () {
      if (!wrap.isConnected) { global.clearInterval(timer); return; }
      secs.textContent = ((global.performance.now() - started) / 1000).toFixed(1) + ' s';
    }, 100);
    return wrap;
  }

  /** One change: where it is in Draft → Test → Review → Approve → Deploy, what each step found, the next step. */
  function changeCard(c) {
    var words = copy.sheet.loop, x = copy.extras;
    var card = el('div', { class: 'card card--change is-' + c.status },
      el('div', { class: 'card__head' }, chip(c.id, 'chip2--id'), chip(c.kind, 'chip2--kind'), chip(c.status, 'chip2--st-' + c.status),
        el('span', { class: 'card__who', text: 'by ' + personName(c.author) + (c.drafter === 'engine' ? ' (drafted by the engine)' : '') })),
      el('div', { class: 'card__title', text: c.label }),
      el('div', { class: 'card__line', text: c.file + ' · owner ' + c.owner + ' · signs off: ' + (names(c.signoff) || 'nobody') }),
      stepper(c.status));
    if (c.reason) card.appendChild(el('div', { class: 'card__line card__line--muted', text: c.reason }));
    var t = c.test;
    if (t) {
      card.appendChild(el('div', { class: 'card__block' },
        el('b', { text: 'Test (on a copy): ' }),
        t.resolves === true ? 'the gap question is now answered (' + t.gap.before.route + ' → ' + t.gap.after.route + '). ' : t.resolves === false ? 'the gap question is still not answered. ' : '',
        t.goldenChanged.length + ' of ' + t.goldenTotal + ' golden answers change; evals ' + t.evalsBefore.passed + '/' + t.evalsBefore.total + ' → ' + t.evalsAfter.passed + '/' + t.evalsAfter.total +
        (t.broken.length ? '; breaks ' + t.broken.join(', ') : '') + '. Sandbox version ' + t.version.sandbox + '.'));
    }
    if (c.review) {
      var rv = el('div', { class: 'card__block' }, el('b', { text: 'Review: risk ' + c.review.risk + ', recommendation ' + c.review.recommendation + '. ' }));
      var ul = el('ul', { class: 'card__list' });
      c.review.summary.forEach(function (line) { ul.appendChild(el('li', { text: line })); });
      rv.appendChild(ul);
      card.appendChild(rv);
    }
    if (c.approval) card.appendChild(el('div', { class: 'card__block' }, el('b', { text: 'Signed off ' }), 'by ' + personName(c.approval.by) + ' for ' + c.approval.owner + ' · ' + stamp(c.approval.at)));
    if (c.deployment) card.appendChild(el('div', { class: 'card__block' }, el('b', { text: 'Live ' }), 'as version ' + c.deployment.version + ' (was ' + c.deployment.previous + ') by ' + personName(c.deployment.by) + ' · ' + stamp(c.deployment.at)));
    if (c.rejection) card.appendChild(el('div', { class: 'card__block' }, el('b', { text: 'Rejected ' }), 'by ' + personName(c.rejection.by) + (c.rejection.note ? ': “' + c.rejection.note + '”' : '')));
    if (c.rollback) card.appendChild(el('div', { class: 'card__block' }, el('b', { text: 'Rolled back ' }), 'to ' + c.rollback.to + ' by ' + personName(c.rollback.by)));

    if (['draft', 'tested', 'reviewed', 'approved'].indexOf(c.status) === -1) return card;
    var status = el('span', { class: 'act__status', role: 'status' });
    var row = el('div', { class: 'btnrow' });
    var me = state.persona.id;
    function run(promise, busy) {
      Array.prototype.forEach.call(row.querySelectorAll('button,select'), function (b) { b.disabled = true; });
      status.className = 'act__status';
      status.textContent = busy ? '' : x.working;
      return promise().then(function () { afterContextChange(); refreshLoop(); }, function (error) {
        Array.prototype.forEach.call(row.querySelectorAll('button,select'), function (b) { b.disabled = false; });
        if (busy && busy.parentNode) busy.parentNode.removeChild(busy);
        status.textContent = errText(error);
        status.classList.add('is-error');
      });
    }
    function button(label, cls, onClick) { var b = el('button', { class: 'btn btn--sm ' + cls, type: 'button', text: label }); b.addEventListener('click', onClick); return b; }

    if (c.status === 'draft' || c.status === 'tested' || c.status === 'reviewed') {
      row.appendChild(button(c.status === 'draft' ? words.test : words.test + ' again', c.status === 'draft' ? 'btn--primary' : 'btn--ghost', function () {
        var bar = progress(words.testing);
        card.appendChild(bar);
        run(function () { return frames().then(function () { return svc().test(c.id); }); }, bar);
      }));
    }
    if (c.status === 'tested') row.appendChild(button(words.review, 'btn--primary', function () { run(function () { return svc().review(c.id, { by: me }); }); }));
    if (c.status === 'reviewed') {
      var signers = (c.signoff || []).filter(function (p) { return p !== c.author; });
      if (signers.length) {
        var who = personSelect(signers, null, 'Signed off by');
        row.appendChild(el('label', { class: 'act__as' }, el('span', { text: 'Owner' }), who));
        row.appendChild(button(words.approveStep, 'btn--go', function () { run(function () { return svc().approve(c.id, { by: who.value }); }); }));
      } else {
        row.appendChild(el('span', { class: 'act__status is-error', text: 'Only ' + (names(c.signoff) || 'nobody') + ' signs off ' + c.owner + ' files, and the author cannot. Reject this draft and draft it again as someone else.' }));
      }
    }
    if (c.status === 'approved') {
      var deployers = unique([c.author].concat(c.signoff || []));
      var dwho = personSelect(deployers, c.approval ? c.approval.by : null, 'Deployed by');
      row.appendChild(el('label', { class: 'act__as' }, el('span', { text: 'By' }), dwho));
      row.appendChild(button(words.deploy, 'btn--go', function () { run(function () { return svc().deploy(c.id, { by: dwho.value }); }); }));
    }
    var deciders = unique([c.author].concat(c.signoff || []));
    var rwho = personSelect(deciders, deciders.indexOf(me) !== -1 ? me : deciders[0], 'Rejected by');
    var rej = el('details', { class: 'reject' }, el('summary', { class: 'btn btn--sm btn--stop', text: words.reject }));
    var note = el('input', { class: 'input', type: 'text', maxlength: '200', placeholder: 'Why (optional)', 'aria-label': 'Why it is rejected' });
    rej.appendChild(el('div', { class: 'reject__form' }, rwho, note, button(words.reject, 'btn--stop', function () { run(function () { return svc().reject(c.id, { by: rwho.value, note: note.value.trim() || null }); }); })));
    row.appendChild(rej);
    row.appendChild(status);
    card.appendChild(row);
    return card;
  }

  function changesSection(changes) {
    var words = copy.sheet.loop;
    var sec = section('changes', words.changes, changes.total);
    if (!changes.changes.length) { sec.appendChild(el('p', { class: 'sheet__note', text: words.emptyChanges })); return sec; }
    changes.changes.slice().reverse().forEach(function (c) { sec.appendChild(changeCard(c)); });
    return sec;
  }

  function versionsSection(v, changes) {
    var words = copy.sheet.loop;
    var sec = section('versions', words.versions, v.history.length);
    sec.appendChild(el('p', { class: 'sheet__note', text: 'Live: ' + v.current + ' · as first loaded: ' + v.base + (v.active.length ? ' · deployed changes: ' + v.active.join(', ') : '') }));
    var signers = unique([].concat.apply([], changes.changes.map(function (c) { return c.signoff || []; })));
    if (!signers.length) signers = MCX.catalog.personas.map(function (p) { return p.id; });
    var exp = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: words.exportChanges });
    var expStatus = el('span', { class: 'act__status', role: 'status' });
    exp.addEventListener('click', function () {
      var go = svc().downloadChanges ? svc().downloadChanges() : svc().exportChanges();
      go.then(function (d) { expStatus.textContent = d.changes.length + ' deployed change' + (d.changes.length === 1 ? '' : 's') + ' saved. Apply with node tools/lifecycle.js apply <file>.'; }, function (error) { expStatus.textContent = errText(error); });
    });
    sec.appendChild(el('div', { class: 'btnrow' }, exp, expStatus));
    // A rollback target is a version with changes still live that were deployed after it.
    var lastActive = -1;
    v.history.forEach(function (h, i) { if (h.kind === 'deploy' && v.active.indexOf(h.change) !== -1) lastActive = i; });
    var newest = v.history.length - 1;
    v.history.slice().reverse().forEach(function (h, r) {
      var index = newest - r;
      var live = index === newest;
      var row = el('div', { class: 'lrow lrow--ver' + (live ? ' is-live' : '') },
        el('span', { class: 'lrow__id', text: h.version }),
        chip(h.kind, 'chip2--v-' + h.kind),
        el('span', { class: 'lrow__q', text: (h.change ? h.change + ' ' : '') + (h.by ? 'by ' + personName(h.by) : '') + (h.undone ? ' undid ' + h.undone.join(', ') : '') + (h.note ? ' · ' + h.note : '') }),
        el('span', { class: 'lrow__meta' }, live ? chip('live', 'chip2--ok') : null, el('span', { class: 'lrow__time', text: stamp(h.at) })));
      sec.appendChild(row);
      if (index < lastActive) {
        var status = el('span', { class: 'act__status', role: 'status' });
        var who = personSelect(signers, signers[0], 'Rolled back by');
        var btn = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: words.rollback + ' to ' + h.version });
        btn.addEventListener('click', function () {
          btn.disabled = true;
          svc().rollback(h.version, { by: who.value }).then(function () { afterContextChange(); refreshLoop(); }, function (error) { btn.disabled = false; status.textContent = errText(error); status.classList.add('is-error'); });
        });
        sec.appendChild(el('div', { class: 'btnrow btnrow--indent' }, who, btn, status));
      }
    });
    return sec;
  }

  function queueSection(a) {
    var words = copy.sheet.loop;
    var sec = section('actions', words.actions, a.total);
    sec.appendChild(el('p', { class: 'sheet__note', text: (a.counts.proposed || 0) + ' waiting · ' + (a.counts.written || 0) + ' written back · ' + (a.counts.rejected || 0) + ' rejected · outbox ' + a.outbox.length }));
    if (!a.actions.length) { sec.appendChild(el('p', { class: 'sheet__note', text: words.emptyActions })); return sec; }
    a.actions.slice().reverse().forEach(function (item) {
      var slot = el('div');
      if (item.status === 'proposed') {
        slot.appendChild(decideControls(item, item.persona, function () { refreshLoop(); }));
      } else slot.appendChild(decidedLine(item));
      var card = actionCard(item, slot);
      card.insertBefore(el('div', { class: 'act__asked', text: 'Asked by ' + personName(item.persona) + ' · ' + item.analysis + ' · ' + (item.logs || []).join(', ') }), card.children[2]);
      sec.appendChild(card);
    });
    return sec;
  }

  function auditSection(audit) {
    var words = copy.sheet.loop;
    var sec = section('audit', words.audit, audit.total);
    var out = el('span', { class: 'act__status', role: 'status' });
    var btn = el('button', { class: 'btn btn--primary btn--sm', type: 'button', text: words.verify });
    btn.addEventListener('click', function () {
      btn.disabled = true;
      svc().verifyAudit().then(function (r) {
        btn.disabled = false;
        out.className = 'result-line ' + (r.ok ? 'is-ok' : 'is-bad');
        out.textContent = r.ok ? 'Chain intact: ' + r.checked + ' of ' + r.total + ' entries check out · head ' + shortHash(r.head) + (r.anchor ? ' · anchored after ' + r.anchor.purged + ' purged' : '')
          : 'Chain broken at ' + r.broken.id + ' (seq ' + r.broken.seq + '): ' + r.broken.reason;
      }, function (error) { btn.disabled = false; out.textContent = errText(error); });
    });
    sec.appendChild(el('div', { class: 'btnrow' }, btn, out));
    audit.entries.slice(0, 6).forEach(function (e) {
      sec.appendChild(el('div', { class: 'lrow lrow--audit' },
        el('span', { class: 'lrow__id', text: e.id }),
        chip(e.type, 'chip2--audit'),
        el('span', { class: 'lrow__q', text: (e.actor ? personName(e.actor) + ' · ' : '') + (e.subject || '') }),
        el('span', { class: 'lrow__meta' }, el('span', { class: 'lrow__hash', text: shortHash(e.hash), title: 'prev ' + e.prev + '\nhash ' + e.hash }), el('span', { class: 'lrow__time', text: stamp(e.at) }))));
    });
    return sec;
  }

  function freshnessSection(o) {
    var words = copy.sheet.loop;
    var sec = section('freshness', words.freshness);
    var list = el('div', { class: 'chips chips--fresh' });
    o.freshness.forEach(function (f) {
      var tone = f.status === 'stale' || f.status === 'unreachable' ? 'alert' : f.status === 'fresh' ? 'ok' : 'live';
      list.appendChild(chip(f.id + ' · ' + f.status + (f.ageHours != null ? ' · ' + number(f.ageHours) + '/' + number(f.slaHours) + ' h' : ''), 'chip2--' + tone, f.kind + (f.updated ? ', updated ' + f.updated : '')));
    });
    sec.appendChild(list);
    if (!o.drift.alerts.length) sec.appendChild(el('p', { class: 'sheet__note', text: 'No drift: answers asked again give the same figures.' }));
    o.drift.alerts.forEach(function (a) {
      var text = a.kind === 'source' ? a.id + ' is ' + a.status + ': ' + a.detail
        : a.kind === 'answer' ? personName(a.persona) + ' “' + a.question + '” changed since ' + a.previous + (a.added.length ? '; new: ' + a.added.slice(0, 2).join(' | ') : '') + (a.removed.length ? '; gone: ' + a.removed.slice(0, 2).join(' | ') : '')
          : a.id + ' differs from its golden answer at ' + a.path + ' (' + a.log + ')';
      sec.appendChild(el('div', { class: 'drift drift--' + a.kind }, chip(a.kind, 'chip2--warn'), ' ', text));
    });
    return sec;
  }

  function retentionSection(o) {
    var words = copy.sheet.loop;
    var r = o.retention;
    var sec = section('retention', words.retention);
    sec.appendChild(el('p', { class: 'sheet__note', text: 'Log, feedback and audit entries are kept ' + r.logDays + ' days. Purged so far: ' + r.purged.log + ' log, ' + r.purged.feedback + ' feedback, ' + r.purged.audit + ' audit (' + r.purges + ' purge' + (r.purges === 1 ? '' : 's') + '). The audit chain keeps an anchor, so it still verifies.' }));
    var out = el('span', { class: 'act__status', role: 'status' });
    var btn = el('button', { class: 'btn btn--stop btn--sm', type: 'button', text: words.purge + ' (older than ' + r.logDays + ' days)' });
    var confirm = el('button', { class: 'btn btn--stop btn--sm', type: 'button', text: 'Yes, purge', hidden: '' });
    btn.addEventListener('click', function () { confirm.hidden = false; out.textContent = 'Entries older than ' + r.logDays + ' days are deleted for good.'; });
    confirm.addEventListener('click', function () {
      confirm.disabled = btn.disabled = true;
      svc().retention({}).then(function (res) {
        out.textContent = 'Purged ' + res.purged.log + ' log, ' + res.purged.feedback + ' feedback and ' + res.purged.audit + ' audit entries older than ' + stamp(res.cutoff) + '.';
        global.setTimeout(refreshLoop, 1600);
      }, function (error) { confirm.disabled = btn.disabled = false; out.textContent = errText(error); });
    });
    sec.appendChild(el('div', { class: 'btnrow' }, btn, confirm, out));
    return sec;
  }

  /** The context changed (a deploy or a rollback): refresh what the page shows about the repository. */
  function afterContextChange() {
    var refresh = MCX.engine && MCX.engine.refresh ? MCX.engine.refresh() : Promise.resolve();
    Promise.resolve(refresh).then(showStrip, function () { /* the strip keeps the old numbers */ });
  }

  // -------------------------------------------------------------------
  // The live engine: start it, and say how it is doing
  // -------------------------------------------------------------------

  function showStrip() {
    if (!ui.strip) return;
    var words = copy.strip, text = '';
    ui.strip.setAttribute('data-state', state.engine);
    if (state.engine === 'ready') {
      var stats = MCX.db.stats, repo = MCX.context.stats();
      text = fill(MCX.remote && words.readyRemote ? words.readyRemote : words.ready, { rows: number(stats.rows), tables: stats.tables.length, ms: number(stats.ms), engine: String(stats.engine).split(' (')[0],
        files: repo.files, tokens: number(repo.tokens) });
    } else if (state.engine === 'starting') text = words.starting;
    else text = fill(words.failed, { error: engineError ? String(engineError.message || engineError).split('\n')[0] : 'not loaded' });
    ui.stripText.textContent = text;
    ui.stripText.title = text;
  }

  function startEngine() {
    if (!hasEngine()) {
      state.engine = 'failed';
      engineError = new Error('the engine files are missing');
      afterEngine();
      return;
    }
    state.engine = 'starting';
    showStrip();
    // A short pause first, so the page paints before the warehouse is built.
    engineReady = sleep(30).then(function () { return MCX.engine.ready(); }).then(function () { state.engine = 'ready'; }, function (error) {
      state.engine = 'failed';
      engineError = error;
      if (global.console) global.console.error(error);
    }).then(afterEngine);
  }

  function afterEngine() {
    showStrip();
    showMode();
    showAsk();
    if (state.engine === 'failed' && state.mode === 'live' && !state.run) {
      if (state.persona && hasRecordings(state.persona)) { state.mode = 'recorded'; showMode(); }
      if (state.question && !state.question.typed) chooseQuestion(state.question, { run: false, collapse: false });
      else rest();
    }
  }

  // -------------------------------------------------------------------
  // Wiring
  // -------------------------------------------------------------------

  var CITED = '.bubble--agent mark.good[data-from]';

  function toggleDetail(row) {
    var detail = row.nextElementSibling;
    if (!detail || !detail.classList.contains('row__detail')) return;
    detail.hidden = !detail.hidden;
    row.setAttribute('aria-expanded', String(!detail.hidden));
  }

  function wire() {
    ui.runBtn.addEventListener('click', function (event) {
      if (event.detail > 0) ui.runBtn.blur();
      runOrReset();
    });
    if (ui.ctxBtn) ui.ctxBtn.addEventListener('click', function () { openSheet('question', ui.ctxBtn); });
    $$('[data-sheet]').forEach(function (button) {
      button.addEventListener('click', function () { openSheet(button.getAttribute('data-sheet'), button); });
    });

    doc.addEventListener('click', function (event) {
      if (!ui.personaWrap.contains(event.target)) openPersonaMenu(false);
      var badge = closest(event.target, '.qbadge');
      if (badge) showQuality(badge); else hideQuality();
      var row = closest(event.target, '.row.has-detail');
      if (row) {
        if (event.detail > 0) row.blur();
        toggleDetail(row);
      }
    });

    doc.addEventListener('mouseover', function (event) {
      var seg = closest(event.target, '.seg');
      if (seg) showTip(seg);
      var mark = closest(event.target, CITED);
      if (mark) showCite(mark);
      var badge = closest(event.target, '.qbadge');
      if (badge) showQuality(badge);
    });
    doc.addEventListener('focusin', function (event) {
      var badge = closest(event.target, '.qbadge');
      if (badge) showQuality(badge); else hideQuality();
    });
    doc.addEventListener('mouseout', function (event) {
      var fromSeg = closest(event.target, '.seg');
      if (fromSeg && !closest(event.relatedTarget, '.seg')) hideTip();
      var fromMark = closest(event.target, CITED);
      if (fromMark && fromMark !== closest(event.relatedTarget, CITED)) hideCite();
      var fromBadge = closest(event.target, '.qbadge');
      if (fromBadge && fromBadge !== closest(event.relatedTarget, '.qbadge') && fromBadge !== doc.activeElement) hideQuality();
    });
    global.addEventListener('scroll', function () { hideTip(); hideCite(); hideQuality(); }, true);
    global.addEventListener('resize', function () { hideTip(); hideCite(); hideQuality(); });

    // Shortcuts: Space pauses or resumes, R resets, Enter runs, Esc closes whatever is open.
    doc.addEventListener('keydown', function (event) {
      var target = event.target;
      var tag = target && target.tagName;
      if (event.key === 'Escape' && qtipEl && qtipEl.classList.contains('is-on')) { hideQuality(); if (!sheet.open) return; }
      if (event.key === 'Escape' && sheet.open) { event.preventDefault(); closeSheet(); return; }
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Escape') { openPersonaMenu(false); return; }
      if (sheet.open) return;                    // the page behind the sheet does not take shortcuts

      var isSpace = event.key === ' ' || event.code === 'Space';
      if (isSpace || event.key === 'Enter') {
        var row = closest(target, '.row.has-detail');
        if (row && target === row) { event.preventDefault(); toggleDetail(row); return; }
        var role = target && target.getAttribute ? target.getAttribute('role') : null;
        if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY' || role === 'option') return; // the focused control handles it
      }
      if (isSpace) { event.preventDefault(); togglePause(); }
      else if (event.key === 'r' || event.key === 'R') { event.preventDefault(); rest(); }
      else if (event.key === 'Enter') { event.preventDefault(); runOrReset(); }
    });
  }

  /** Put the brand names and logos into the static markup. */
  function dress() {
    doc.title = named(copy.pageTitle);
    $('#eyebrow').textContent = named(copy.eyebrow);
    $('#headline').innerHTML = named(copy.headline);
    $$('[data-copy]').forEach(function (node) {
      var value = node.getAttribute('data-copy').split('.').reduce(function (at, key) { return at && at[key]; }, copy);
      if (typeof value === 'string') node.textContent = named(value);
    });
    $$('img[data-logo]').forEach(function (img) {
      img.src = img.getAttribute('data-logo') === 'context' ? brand.contextLogo : brand.companyLogo;
    });
  }

  function boot() {
    ui.runBtn = $('#runBtn');
    ui.bank = $('#bank');
    ui.personaWrap = $('#persona');
    ui.mode = $('#mode');
    ui.ctxBtn = $('#ctxBtn');
    ui.strip = $('#strip');
    ui.stripText = $('#stripText');
    panels.bare = new Panel('bare');
    panels.context = new Panel('context');

    dress();
    wire();
    drawMode();
    drawPersonaSwitcher();
    startEngine();     // recorded replays do not wait for it

    // A link can pre-select things: ?persona=maya  ?q=<question slug>  ?mode=live  ?ask=<your question>  ?autorun  ?speed=2
    var params = new global.URLSearchParams(global.location.search);
    var speed = parseFloat(params.get('speed'));
    if (speed > 0) pacing.speed = speed;
    var persona = personaById(params.get('persona')) || personaById(MCX.catalog.defaultPersona) || MCX.catalog.personas[0];
    choosePersona(persona.id, params.get('mode'));

    var wanted = params.get('q');
    var typed = params.get('ask');
    if (typed) askTyped(typed);
    else if (wanted || params.has('autorun')) {
      var match = state.persona.questions.filter(function (q) { return q.slug === wanted; })[0] || state.question;
      if (match) chooseQuestion(match, { run: true, collapse: true });
    }

    MCX.booted = true;
    var note = $('#bootNote');
    if (note) note.parentNode.removeChild(note);
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
