/* =====================================================================
   src/script.js — reading a replay script

   Pure functions, no page access. They turn the compact steps in
   data/*.js into what the page shows: row labels, timeline keys,
   reasoning lines and highlighted answers. tools/validate.js loads this
   same file, so the checks and the page can never disagree.
   ===================================================================== */
(function (global) {
  'use strict';

  var MCX = (global.MCX = global.MCX || {});

  /** Swap {context}, {warehouse}, {analyst}, {company} for the brand names in src/config.js. */
  function named(template) {
    var brand = MCX.config.brand;
    return String(template == null ? '' : template)
      .replace(/\{context\}/g, brand.contextLayer)
      .replace(/\{warehouse\}/g, brand.warehouse)
      .replace(/\{analyst\}/g, brand.analyst)
      .replace(/\{company\}/g, brand.company);
  }

  function formatDuration(ms) {
    return ms < 1000 ? Math.round(ms) + 'ms' : (ms / 1000).toFixed(1) + 's';
  }

  /** Remove the indentation a multi-line string picks up inside a data file. */
  function dedent(text) {
    var lines = String(text).replace(/\t/g, '  ').split('\n');
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    var margin = Infinity;
    lines.forEach(function (line) {
      if (line.trim()) margin = Math.min(margin, line.match(/^ */)[0].length);
    });
    if (!isFinite(margin)) margin = 0;
    return lines.map(function (line) { return line.slice(margin).replace(/\s+$/, ''); }).join('\n');
  }

  /** Markdown marks are dropped from reasoning lines. */
  function plain(text) {
    return String(text || '').replace(/\*\*/g, '').replace(/`/g, '');
  }

  /** A reasoning line is shown as its first sentence, capped at 190 characters. */
  function firstSentence(text) {
    var clean = plain(text);
    var stop = /[.!?](?=\s)/.exec(clean);
    var sentence = stop ? clean.slice(0, stop.index + 1) : clean;
    return sentence.length > 190 ? sentence.slice(0, 187) + '…' : sentence;
  }

  /**
   * Turn a SQL statement into a short label, e.g. "Queried ORDER_TIMING_MART".
   * The table is the first FROM target, ignoring the FROM inside EXTRACT(... FROM ...).
   */
  function readSql(sql) {
    var match;
    if (/^SHOW\s+SCHEMAS/i.test(sql)) return { verb: 'Listed schemas', arg: '' };
    if ((match = /^SHOW\s+TABLES\s+IN\s+([^\s;]+)/i.exec(sql))) return { verb: 'Listed tables in', arg: match[1].split('.').pop() };
    if ((match = /^DESCRIBE\s+([^\s;]+)/i.exec(sql))) return { verb: 'Inspected', arg: match[1].split('.').pop() };
    if ((match = /^PRAGMA\s+\w+\.table_info\(\s*'?(\w+)'?\s*\)/i.exec(sql))) return { verb: 'Inspected', arg: match[1] };
    if ((match = /\bFROM\s+(\w+)\.sqlite_master\b/i.exec(sql))) return { verb: 'Listed tables in', arg: match[1] };
    var body = sql.replace(/\b(EXTRACT|TRIM|SUBSTRING)\s*\([^()]*\)/gi, ' ');
    if ((match = /\bFROM\s+([^\s;()]+)/i.exec(body))) return { verb: 'Queried', arg: match[1].split('.').pop() };
    return { verb: 'Ran SQL', arg: '' };
  }

  var LOADS = {
    persona: { verb: 'Loaded persona', source: 'context repo',   key: function () { return 'persona'; } },
    term:    { verb: 'Resolved term',  source: 'glossary',       key: function (n) { return 'glossary:' + n; }, meta: 'status: certified' },
    skill:   { verb: 'Loaded skill',   source: 'skill registry', key: function (n) { return 'skill:' + n; } },
    model:   { verb: 'Loaded model',   source: 'semantic model', key: function (n) { return 'model:' + n; }, meta: 'certified: true' },
    policy:  { verb: 'Applied policy', source: 'policy',         key: function (n) { return 'policy:' + n; } },
    // Context engine v2
    guard:    { verb: 'Guard',             source: 'guard',            key: function () { return 'guard'; } },
    route:    { verb: 'Routed to',         source: 'routing table',    key: function () { return 'route'; } },
    doc:      { verb: 'Retrieved page',    source: 'knowledge',        key: function (n) { return 'doc:' + n; } },
    work:     { verb: 'Retrieved thread',  source: 'work',             key: function (n) { return 'work:' + n; } },
    memory:   { verb: 'Recalled',          source: 'session memory',   key: function () { return 'memory'; } },
    validate: { verb: 'Validated',         source: 'validation',       key: function () { return 'validate'; } },
    action:   { verb: 'Proposed action',   source: 'actions catalog',  key: function (n) { return 'action:' + n; } }
  };

  /**
   * Normalise one step from a data file.
   *   { say }                          -> null (a reasoning line, not a tool call)
   *   { sql, key, rows, cols, table }  -> a warehouse query
   *   { persona | term | skill | model | policy [, meta] } -> a context-layer load
   *   { guard | route | doc | work | memory | validate | action [, label, meta] } -> a context-engine step
   *     keys: 'guard', 'route', 'doc:<id>', 'work:<id>', 'memory', 'validate', 'action:<id>'
   *
   * A step produced by the live engine carries more, and it is passed through
   * untouched: a query's real time and first rows (ms, result), a load's file,
   * text and size (file, detail, tokens). Recorded steps leave these empty.
   */
  function describeTool(step) {
    if (step.sql != null) {
      var sql = dedent(step.sql);
      var read = readSql(sql);
      return {
        kind: 'warehouse',
        verb: read.verb,
        arg: step.table || read.arg,
        key: 'query:' + (step.key || 'sql'),
        sql: sql,
        rows: step.rows,
        cols: Array.isArray(step.cols) ? step.cols.join(', ') : (step.cols || ''),
        ms: step.ms != null ? step.ms : null,
        result: step.result || null
      };
    }
    for (var type in LOADS) {
      if (step[type] != null) {
        var load = LOADS[type];
        var name = String(step[type]);
        var bits = ['source: ' + MCX.config.brand.contextLayer + ' ' + load.source];
        if (step.meta || load.meta) bits.push(step.meta || load.meta);
        return {
          kind: 'context', type: type, verb: load.verb, arg: step.label != null ? String(step.label) : name, key: load.key(name), source: bits.join(', '),
          file: step.file || '', detail: step.detail || '', tokens: step.tokens != null ? step.tokens : null,
          value: name, meta: step.meta || load.meta || ''
        };
      }
    }
    return null;
  }

  /** The label a tool gets on its row and in the timeline. */
  function labelOf(tool) {
    return tool.verb + (tool.arg ? ' ' + tool.arg : '');
  }

  /**
   * Split an answer into plain and highlighted pieces.
   * marks: [{ good: 'phrase', from: ['query:spread', ...] }, { bad: 'phrase' }]
   * Every occurrence of a phrase is marked. Matches never overlap; when two
   * start at the same place the longer one wins.
   * Returns [{ text, kind: null | 'good' | 'bad', from: [...] | null }].
   */
  function segment(text, marks) {
    var found = [];
    (marks || []).forEach(function (mark) {
      var kind = mark.good != null ? 'good' : 'bad';
      var phrase = mark[kind];
      if (!phrase) return;
      var at = text.indexOf(phrase);
      while (at !== -1) {
        found.push({ start: at, end: at + phrase.length, kind: kind, from: mark.from || null });
        at = text.indexOf(phrase, at + phrase.length);
      }
    });
    found.sort(function (a, b) { return a.start - b.start || (b.end - b.start) - (a.end - a.start); });

    var pieces = [];
    var cursor = 0;
    found.forEach(function (hit) {
      if (hit.start < cursor) return;
      if (hit.start > cursor) pieces.push({ text: text.slice(cursor, hit.start), kind: null, from: null });
      pieces.push({ text: text.slice(hit.start, hit.end), kind: hit.kind, from: hit.from });
      cursor = hit.end;
    });
    if (cursor < text.length) pieces.push({ text: text.slice(cursor), kind: null, from: null });
    return pieces;
  }

  MCX.script = {
    named: named,
    formatDuration: formatDuration,
    dedent: dedent,
    plain: plain,
    firstSentence: firstSentence,
    readSql: readSql,
    describeTool: describeTool,
    labelOf: labelOf,
    segment: segment
  };
})(typeof window !== 'undefined' ? window : globalThis);
