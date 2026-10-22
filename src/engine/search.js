/* =====================================================================
   src/engine/search.js — finding knowledge and work for a question

   What is searched (one "chunk" each):
     doc     a section of a knowledge page (context/knowledge/*.md, split on "## ")
     work    one message of a work thread (context/work/*.json)
     term    a glossary term (name, synonyms, definition)
     skill   a skill (title, description, body)

   Three ways to score a chunk against the query:
     keyword  BM25 on stemmed words without stop words (k1 1.4, b 0.6)
     vector   a deterministic hashed embedding: each word (weight 2)
              and each character trigram of "#word#" (weight 1) hashed
              with 32-bit FNV-1a into 256 dimensions, L2-normalised;
              the score is the cosine
     hybrid   reciprocal-rank fusion of the two rankings (k = 60),
              divided by its best possible value 2/61 so it reads 0..1

   A hit is one page or thread: its best chunk. With a persona the
   filters apply: approved pages only, the deployment's residency, the
   source's retention (counted back from "today", the warehouse's latest
   date), the access lists of the item and its source, and, for a
   franchise operator, nothing about another operator's stores.
   Snippets are the best one or two sentences, with personal data masked.

   MCX.search.query(q, { mode, k, persona, kinds, keepExcluded, region, today }) -> [hit]
   MCX.search.embed(text) -> Float64Array(256)
   ===================================================================== */
(function (global) {
  'use strict';
  var MCX = (global.MCX = global.MCX || {});
  var DIMS = 256, RRF_K = 60, K1 = 1.4, B = 0.6;
  var cache = { repo: null, chunks: null };

  function settings() { return (MCX.config && MCX.config.engine) || {}; }

  // -------------------------------------------------------------------
  // Hashed embedding
  // -------------------------------------------------------------------
  /** 32-bit FNV-1a over the string's character codes (the features here are ASCII). */
  function fnv1a(text) {
    var h = 0x811c9dc5;
    for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i) & 0xff; h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  function embed(text) {
    var v = new Float64Array(DIMS);
    MCX.text.tokens(text).forEach(function (word) {
      v[fnv1a('w:' + word) % DIMS] += 2;
      var padded = '#' + word + '#';
      for (var i = 0; i + 3 <= padded.length; i++) v[fnv1a('t:' + padded.slice(i, i + 3)) % DIMS] += 1;
    });
    var norm = 0;
    for (var d = 0; d < DIMS; d++) norm += v[d] * v[d];
    norm = Math.sqrt(norm);
    if (norm > 0) for (d = 0; d < DIMS; d++) v[d] /= norm;
    return v;
  }
  function cosine(a, b) { var s = 0; for (var d = 0; d < DIMS; d++) s += a[d] * b[d]; return s; }

  // -------------------------------------------------------------------
  // The index
  // -------------------------------------------------------------------
  function sections(page) {
    var body = String(page.body || '').replace(/^#\s.*\n+/, '');
    var out = [], heading = page.title, lines = [];
    function flush() { var text = lines.join(' ').replace(/\s+/g, ' ').trim(); if (text) out.push({ heading: heading, text: text }); lines = []; }
    body.split('\n').forEach(function (line) {
      var m = /^##\s+(.*)$/.exec(line);
      if (m) { flush(); heading = m[1].trim(); } else lines.push(line);
    });
    flush();
    return out;
  }

  function sourceOf(id) { return (MCX.contextRepo.sources || []).filter(function (s) { return s.id === id; })[0] || null; }

  function chunks() {
    var r = MCX.contextRepo;
    if (cache.repo === r && cache.chunks) return cache.chunks;
    var out = [];
    function push(c) { c.index = out.length; c.words = MCX.text.tokens(c.text); c.vec = embed(c.title + ' ' + (c.heading || '') + ' ' + c.text); out.push(c); }
    Object.keys(r.knowledge || {}).forEach(function (id) {
      var page = r.knowledge[id];
      sections(page).forEach(function (s, n) {
        push({ kind: 'doc', id: id, chunk: n, title: page.title, heading: s.heading, text: s.text, system: page.system, source: page.source, date: page.updated });
      });
    });
    Object.keys(r.work || {}).forEach(function (id) {
      var t = r.work[id];
      t.messages.forEach(function (m, n) {
        push({ kind: 'work', id: id, chunk: n, title: t.title, heading: m.from + ' · ' + m.at, text: m.text, system: t.system, source: t.source, date: t.date, channel: t.channel });
      });
    });
    Object.keys(r.glossary || {}).forEach(function (id) {
      var g = r.glossary[id];
      push({ kind: 'term', id: id, chunk: 0, title: g.name, heading: '', text: g.name + '. ' + (g.synonyms || []).join(', ') + '. ' + String(g.body || '').replace(/\s+/g, ' ').trim(), system: 'Context repository', source: 'context-repo', date: null });
    });
    Object.keys(r.skills || {}).forEach(function (id) {
      var s = r.skills[id];
      push({ kind: 'skill', id: id, chunk: 0, title: s.title, heading: '', text: s.title + '. ' + s.description + ' ' + String(s.body || '').replace(/^#\s.*\n+/, '').replace(/\s+/g, ' ').trim(), system: 'Context repository', source: 'context-repo', date: null });
    });
    cache.repo = r; cache.chunks = out;
    return out;
  }

  // -------------------------------------------------------------------
  // Scoring
  // -------------------------------------------------------------------
  function bm25(queryWords, list) {
    var terms = [];
    queryWords.forEach(function (w) { if (terms.indexOf(w) === -1) terms.push(w); });
    var n = list.length, avg = n ? list.reduce(function (s, c) { return s + c.words.length; }, 0) / n : 1;
    if (!avg) avg = 1;
    var df = terms.map(function (t) { return list.filter(function (c) { return c.words.indexOf(t) !== -1; }).length; });
    return list.map(function (c) {
      var score = 0;
      terms.forEach(function (t, i) {
        if (!df[i]) return;
        var tf = 0;
        for (var j = 0; j < c.words.length; j++) if (c.words[j] === t) tf++;
        if (!tf) return;
        var idf = Math.log(1 + (n - df[i] + 0.5) / (df[i] + 0.5));
        score += idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * c.words.length / avg));
      });
      return score;
    });
  }

  /** Rank positions (1-based) of the chunks with a positive score, best first, ties by index. */
  function ranks(list, scores) {
    var order = list.map(function (c, i) { return i; }).filter(function (i) { return scores[i] > 0; });
    order.sort(function (a, b) { return scores[b] - scores[a] || list[a].index - list[b].index; });
    var out = {};
    order.forEach(function (i, n) { out[i] = n + 1; });
    return out;
  }

  /** The best one or two sentences of a chunk for the query, personal data masked. */
  function snippet(text, queryWords) {
    var sentences = String(text).split(/(?<=[.!?])\s+/).filter(function (s) { return s.trim(); });
    if (!sentences.length) return '';
    var best = 0, bestScore = -1;
    sentences.forEach(function (s, i) {
      var words = MCX.text.tokens(s), hit = 0;
      queryWords.forEach(function (w, j) { if (queryWords.indexOf(w) === j && words.indexOf(w) !== -1) hit++; });
      if (hit > bestScore) { best = i; bestScore = hit; }
    });
    var out = sentences[best];
    if (out.length < 120 && sentences[best + 1]) out += ' ' + sentences[best + 1];
    return MCX.guard.mask(out);
  }

  // -------------------------------------------------------------------
  // Filters: who may see what
  // -------------------------------------------------------------------
  function personaCard(persona) {
    if (!persona) return null;
    return typeof persona === 'string' ? MCX.contextRepo.personas[persona] || null : persona;
  }
  function isOperator(card) { return !!(card && card.scope && card.scope.kind === 'operator'); }

  /** True if an access list lets this persona in: '*', 'corporate', 'operators', a role or a persona id. */
  function allows(list, card) {
    list = list && list.length ? list : ['*'];
    return list.some(function (who) {
      if (who === '*') return true;
      if (who === 'corporate') return !isOperator(card);
      if (who === 'operators') return isOperator(card);
      return who === card.id || who === card.role;
    });
  }

  /** The item behind a hit: a knowledge page or a work thread (null for terms and skills). */
  function itemOf(kind, id) {
    var r = MCX.contextRepo;
    return kind === 'doc' ? (r.knowledge || {})[id] : kind === 'work' ? (r.work || {})[id] : null;
  }

  /** Why this persona may not use the item here, or null. Codes: draft, residency, retention, access. */
  function exclusion(kind, id, card, opts) {
    var item = itemOf(kind, id);
    if (!item) return null;
    var source = sourceOf(item.source) || {};
    var region = opts.region || settings().region || 'us';
    if (kind === 'doc' && item.status !== 'approved') return { code: 'draft', why: 'a draft page (status ' + item.status + '); only approved pages are context' };
    var residency = item.residency || source.residency || region;
    if (residency !== region) return { code: 'residency', why: 'held in the ' + residency.toUpperCase() + ' region (' + (source.name || item.source) + '); this deployment serves ' + region.toUpperCase() };
    var today = opts.today;
    var date = kind === 'doc' ? item.updated : item.date;
    if (today && date && source.retention_days != null) {
      var age = MCX.fmt.daysBetween(date, today);
      if (age > source.retention_days) return { code: 'retention', why: age + ' days old; ' + (source.name || item.source) + ' keeps ' + source.retention_days + ' days' };
    }
    if (card) {
      if (!allows(source.access, card)) return { code: 'access', why: (source.name || item.source) + ' is not open to ' + card.role };
      if (!allows(item.access, card)) return { code: 'access', why: 'restricted to ' + item.access.join(', ') };
      if (isOperator(card) && MCX.build && MCX.build.entitiesOf) {
        var about = MCX.build.entitiesOf(kind, id);
        var other = about.operators.filter(function (name) { return name !== card.scope.operator; })[0];
        if (other) return { code: 'access', why: 'about ' + other + "'s stores; an operator sees their own" };
      }
    }
    return null;
  }

  function today() {
    try { return MCX.db && MCX.db.isOpen && MCX.db.isOpen() ? MCX.sem.anchors().maxDate : null; } catch (e) { return null; }
  }

  // -------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------
  /**
   * q        the query text
   * opts     mode 'keyword' | 'vector' | 'hybrid' (default), k (default 5), persona (id or card),
   *          kinds (default ['doc', 'work']), keepExcluded (return filtered items too, marked),
   *          region (default engine.region), today (default the warehouse's latest date)
   * returns  [{ kind, id, chunk, title, heading, system, source, date, channel, snippet, score, keyword, vector, excluded?, why? }]
   */
  function query(q, opts) {
    opts = opts || {};
    var mode = opts.mode || 'hybrid', k = opts.k == null ? 5 : opts.k;
    var kinds = opts.kinds || ['doc', 'work'];
    var card = personaCard(opts.persona);
    var filterOpts = { region: opts.region, today: opts.today !== undefined ? opts.today : today() };
    var list = chunks().filter(function (c) { return kinds.indexOf(c.kind) !== -1; });
    var words = MCX.text.tokens(q);
    var qv = embed(q);
    var kw = bm25(words, list);
    var vec = list.map(function (c) { return cosine(qv, c.vec); });
    var hy = null;
    if (mode === 'hybrid') {
      var rk = ranks(list, kw), rv = ranks(list, vec);
      hy = list.map(function (c, i) { return ((rk[i] ? 1 / (RRF_K + rk[i]) : 0) + (rv[i] ? 1 / (RRF_K + rv[i]) : 0)) / (2 / (RRF_K + 1)); });
    }
    var score = mode === 'keyword' ? kw : mode === 'vector' ? vec : hy;

    // Best chunk per item
    var best = {}, order = [];
    list.forEach(function (c, i) {
      if (!(score[i] > 0)) return;
      var key = c.kind + ':' + c.id;
      if (!(key in best)) { best[key] = i; order.push(key); return; }
      if (score[i] > score[best[key]]) best[key] = i;
    });
    var hits = order.map(function (key) { return best[key]; });
    hits.sort(function (a, b) { return score[b] - score[a] || list[a].index - list[b].index; });

    var out = [];
    hits.forEach(function (i) {
      var c = list[i];
      var why = card || opts.keepExcluded ? exclusion(c.kind, c.id, card, filterOpts) : null;
      if (why && !opts.keepExcluded) return;
      var hit = { kind: c.kind, id: c.id, chunk: c.chunk, title: c.title, heading: c.heading, system: c.system, source: c.source, date: c.date,
        snippet: snippet(c.text, words), score: score[i], keyword: kw[i], vector: vec[i] };
      if (c.channel) hit.channel = c.channel;
      if (why) { hit.excluded = why.code; hit.why = why.why; }
      out.push(hit);
    });
    return k > 0 ? out.slice(0, k) : out;
  }

  MCX.search = {
    query: query, embed: embed, fnv1a: fnv1a, cosine: cosine, sections: sections, exclusion: exclusion, allows: allows,
    chunks: chunks, reset: function () { cache.repo = null; cache.chunks = null; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
