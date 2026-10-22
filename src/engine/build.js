/* =====================================================================
   src/engine/build.js — the always-on build: sources to a context graph

   The registry in context/sources.json names every system context comes
   from: systems of record (raw BRONZE feeds), of knowledge (wiki pages),
   of data (the certified GOLD warehouse), of semantics (glossary,
   models, skills, policies), of work (chat, email, call notes) and the
   runtime (who is asking, this session). The build:

     connect()     reaches each source: ok or not, how many items, when
                   it last changed
     mapMeaning()  links pages and threads to glossary terms: their own
                   tags plus any synonym found in the text
     resolve()     finds operators, regions and stores in pages and
                   threads, by full name, first or last name, "SE" for
                   Southeast and so on, read from GOLD.FRANCHISE_STORE_DIM
     graph()       one graph of personas, operators, regions, stores,
                   terms, metrics, models, tables, skills, policies,
                   pages, threads and sources, with named edges
     freshness()   each source's age against its SLA: data sources from
                   the warehouse's own latest dates, files against
                   "today" (the warehouse's latest date)
     report()      all of it summarised, with the context version

   Everything is computed once per repository version and cached.
   MCX.build.reset() drops the cache after the repository changes.

   MCX.build.version() -> first 12 hex of sha256(canonical repository JSON)
   ===================================================================== */
(function (global) {
  'use strict';
  var MCX = (global.MCX = global.MCX || {});
  var cache = {};

  function repo() { return MCX.contextRepo; }
  function memo(name, make) {
    if (cache.repo !== repo()) cache = { repo: repo() };
    if (!(name in cache)) cache[name] = make();
    return cache[name];
  }
  function today() { return MCX.sem.anchors().maxDate; }
  function sources() { return repo().sources || []; }
  function source(id) { return sources().filter(function (s) { return s.id === id; })[0] || null; }

  /** The context version: the first 12 hex characters of the SHA-256 of the canonical repository JSON. */
  function version() { return memo('version', function () { return MCX.sha256(MCX.canonicalJson(repo())).slice(0, 12); }); }

  // -------------------------------------------------------------------
  // Connect
  // -------------------------------------------------------------------
  function tableCount(table) { return MCX.db.query('SELECT COUNT(*) AS n FROM ' + table).rows[0].n; }
  function latestIn(ref) {
    // "SCHEMA.TABLE.COLUMN" -> the latest date in that column (first ten characters, so timestamps work too)
    var parts = ref.split('.');
    var row = MCX.db.query('SELECT MAX(substr(' + parts[2] + ', 1, 10)) AS d FROM ' + parts[0] + '.' + parts[1]).rows[0];
    return row ? row.d : null;
  }

  function itemsOf(s) {
    var r = repo();
    if (s.kind === 'knowledge') return Object.keys(r.knowledge || {}).filter(function (id) { return r.knowledge[id].source === s.id; }).map(function (id) { return { id: id, date: r.knowledge[id].updated }; });
    if (s.kind === 'work') return Object.keys(r.work || {}).filter(function (id) { return r.work[id].source === s.id; }).map(function (id) { return { id: id, date: r.work[id].date }; });
    return [];
  }

  function connect() {
    return memo('connect', function () {
      var r = repo();
      return sources().map(function (s) {
        var out = { id: s.id, kind: s.kind, name: s.name, system: s.system, connector: s.connector, ok: true, items: 0, updated: null, detail: '' };
        try {
          if (s.connector === 'warehouse') {
            (s.tables || []).forEach(function (t) { out.items += tableCount(t); });
            out.updated = s.updated_from ? latestIn(s.updated_from) : null;
            out.detail = (s.tables || []).length + ' table' + ((s.tables || []).length === 1 ? '' : 's') + ', ' + out.items + ' rows';
          } else if (s.kind === 'knowledge' || s.kind === 'work') {
            var items = itemsOf(s);
            out.items = items.length;
            out.updated = items.reduce(function (m, i) { return !m || i.date > m ? i.date : m; }, null);
            out.detail = items.length + (s.kind === 'knowledge' ? ' page' : ' thread') + (items.length === 1 ? '' : 's');
          } else if (s.kind === 'semantics') {
            out.items = Object.keys(r.glossary).length + Object.keys(r.models).length + Object.keys(r.skills).length + Object.keys(r.policies).length;
            out.detail = Object.keys(r.glossary).length + ' terms, ' + Object.keys(r.models).length + ' models, ' + Object.keys(r.skills).length + ' skills, ' + Object.keys(r.policies).length + ' policies';
          } else if (s.kind === 'runtime') {
            out.items = Object.keys(r.personas).length;
            out.detail = out.items + ' personas, plus each session\'s earlier turns';
          }
          if (s.connector === 'files' && s.kind !== 'semantics' && !out.items) { out.ok = false; out.detail = 'no items found'; }
        } catch (error) {
          out.ok = false; out.detail = error.message;
        }
        return out;
      });
    });
  }

  // -------------------------------------------------------------------
  // Keep fresh
  // -------------------------------------------------------------------
  function freshness() {
    return memo('freshness', function () {
      var now = today();
      return connect().map(function (c) {
        var s = source(c.id), sla = s.freshness_hours;
        var out = { id: c.id, kind: c.kind, updated: c.updated, slaHours: sla, ageHours: null, fresh: true, status: 'not tracked' };
        if (c.updated && sla) {
          out.ageHours = MCX.fmt.daysBetween(c.updated, now) * 24;
          out.fresh = out.ageHours <= sla;
          out.status = out.fresh ? 'fresh' : 'stale';
        } else if (!sla) {
          out.status = 'live';           // read at run time: the repository and the session
        }
        if (!c.ok) { out.fresh = false; out.status = 'unreachable'; }
        return out;
      });
    });
  }

  // -------------------------------------------------------------------
  // Map meaning: pages and threads to glossary terms
  // -------------------------------------------------------------------
  function textOf(kind, item) {
    return kind === 'doc' ? item.title + '\n' + item.body : item.title + '\n' + item.messages.map(function (m) { return m.text; }).join('\n');
  }
  function eachItem(fn) {
    var r = repo();
    Object.keys(r.knowledge || {}).forEach(function (id) { fn('doc', id, r.knowledge[id]); });
    Object.keys(r.work || {}).forEach(function (id) { fn('work', id, r.work[id]); });
  }

  function mapMeaning() {
    return memo('meaning', function () {
      var glossary = repo().glossary, links = [], unknown = [];
      eachItem(function (kind, id, item) {
        var text = textOf(kind, item), seen = {};
        (item.terms || []).forEach(function (term) {
          if (!glossary[term]) { unknown.push({ kind: kind, id: id, term: term }); return; }
          seen[term] = true;
          links.push({ kind: kind, id: id, term: term, how: 'tagged', match: null });
        });
        Object.keys(glossary).forEach(function (term) {
          if (seen[term]) return;
          var hit = (glossary[term].synonyms || []).filter(function (phrase) { return MCX.text.hasPhrase(text, phrase); })[0];
          if (hit) { seen[term] = true; links.push({ kind: kind, id: id, term: term, how: 'synonym', match: hit }); }
        });
      });
      return { links: links, unknown: unknown };
    });
  }

  // -------------------------------------------------------------------
  // Resolve: operators, regions and stores named in pages and threads
  // -------------------------------------------------------------------
  var REGION_ALIASES = { Southeast: ['SE'], Midwest: ['MW'], Northeast: ['NE'], West: [] };

  function aliasTable() {
    return memo('aliases', function () {
      var e = MCX.sem.entities(), out = [];
      Object.keys(e.stores).forEach(function (name) { out.push({ kind: 'store', name: name, alias: name }); });
      Object.keys(e.operators).forEach(function (name) {
        e.operators[name].aliases.forEach(function (alias, i) {
          if (alias.length > 3 && out.every(function (a) { return !(a.kind === 'operator' && a.alias === alias); })) out.push({ kind: 'operator', name: name, alias: alias, partial: i >= 2 });
        });
      });
      Object.keys(e.regions).forEach(function (name) {
        out.push({ kind: 'region', name: name, alias: name });
        (REGION_ALIASES[name] || []).forEach(function (alias) { out.push({ kind: 'region', name: name, alias: alias, exact: true }); });
      });
      return out;
    });
  }

  function found(text, a) {
    // Short upper-case aliases ("SE") must appear in capitals as a word; the rest match as phrases.
    if (a.exact) return new RegExp('(^|[^A-Za-z])' + a.alias + '([^A-Za-z]|$)').test(text);
    return MCX.text.hasPhrase(text, a.alias);
  }

  function resolve() {
    return memo('resolve', function () {
      var e = MCX.sem.entities(), mentions = [], unresolved = [];
      eachItem(function (kind, id, item) {
        var text = textOf(kind, item), seen = {};
        function add(entity, name, alias, how) {
          var key = entity + ':' + name;
          if (seen[key]) return;
          seen[key] = true;
          mentions.push({ kind: kind, id: id, entity: entity, name: name, alias: alias, how: how });
        }
        (item.entities || []).forEach(function (name) {
          if (e.operators[name]) add('operator', name, name, 'tagged');
          else if (e.regions[name]) add('region', name, name, 'tagged');
          else if (e.stores[name]) add('store', name, name, 'tagged');
          else unresolved.push({ kind: kind, id: id, name: name });
        });
        aliasTable().forEach(function (a) { if (found(text, a)) add(a.kind, a.name, a.alias, 'found'); });
      });
      return { mentions: mentions, unresolved: unresolved };
    });
  }

  /** Operators, regions and stores a page or thread is about (a store also counts for its operator). */
  function entitiesOf(kind, id) {
    var index = memo('about', function () {
      var e = MCX.sem.entities(), out = {};
      resolve().mentions.forEach(function (m) {
        var about = out[m.kind + ':' + m.id] = out[m.kind + ':' + m.id] || { operators: [], regions: [], stores: [] };
        function put(list, name) { if (list.indexOf(name) === -1) list.push(name); }
        if (m.entity === 'operator') put(about.operators, m.name);
        if (m.entity === 'region') put(about.regions, m.name);
        if (m.entity === 'store') { put(about.stores, m.name); put(about.operators, e.stores[m.name].operator); }
      });
      return out;
    });
    return index[kind + ':' + id] || { operators: [], regions: [], stores: [] };
  }

  // -------------------------------------------------------------------
  // The graph
  // -------------------------------------------------------------------
  function graph() {
    return memo('graph', function () {
      var r = repo(), e = MCX.sem.entities(), nodes = [], edges = [], have = {};
      function node(type, id, label) { var key = type + ':' + id; if (!have[key]) { have[key] = true; nodes.push({ id: key, type: type, label: label || id }); } return key; }
      function edge(from, rel, to) { edges.push({ from: from, rel: rel, to: to }); }
      var tableSource = {};
      sources().forEach(function (s) {
        var sk = node('source', s.id, s.name + ' (' + s.system + ')');
        (s.tables || []).forEach(function (t) { var tk = node('table', t, t); edge(tk, 'held_in', sk); tableSource[t] = s.id; });
        (s.feeds || []).forEach(function (m) { edge(node('table', 'GOLD.' + m, 'GOLD.' + m), 'fed_by', sk); });
      });
      Object.keys(e.regions).forEach(function (name) { node('region', name); });
      Object.keys(e.operators).forEach(function (name) { edge(node('operator', name), 'operates_in', 'region:' + e.operators[name].region); });
      Object.keys(e.stores).forEach(function (name) { edge(node('store', name), 'operated_by', 'operator:' + e.stores[name].operator); });
      Object.keys(r.personas).forEach(function (id) {
        var p = r.personas[id], pk = node('persona', id, p.name + ' · ' + p.role);
        edge(pk, 'defined_in', 'source:session');
        if (p.scope && p.scope.kind === 'operator' && e.operators[p.scope.operator]) edge(pk, 'is', 'operator:' + p.scope.operator);
      });
      Object.keys(r.glossary).forEach(function (id) { edge(node('term', id, r.glossary[id].name), 'defined_in', 'source:context-repo'); });
      Object.keys(r.models).forEach(function (id) {
        var m = r.models[id], mk = node('model', id);
        edge(mk, 'describes', node('table', m.schema + '.' + id, m.schema + '.' + id));
        Object.keys(m.metrics).forEach(function (name) {
          var xk = node('metric', id + '.' + name, name);
          edge(xk, 'on', mk);
          if (m.metrics[name].term && r.glossary[m.metrics[name].term]) edge('term:' + m.metrics[name].term, 'defines', xk);
        });
        Object.keys(m.joins || {}).forEach(function (other) { if (r.models[other]) edge(mk, 'joins', node('model', other)); });
      });
      Object.keys(r.skills).forEach(function (id) { edge(node('skill', id, r.skills[id].title), 'defined_in', 'source:context-repo'); });
      Object.keys(r.policies).forEach(function (id) { edge(node('policy', id, r.policies[id].name), 'defined_in', 'source:context-repo'); });
      // What each analysis ties together: the skills it follows use its terms and query its models.
      Object.keys(MCX.analyses || {}).sort().forEach(function (name) {
        var plan = MCX.analyses[name];
        (plan.skills || []).forEach(function (s) {
          if (!r.skills[s]) return;
          (plan.models || []).forEach(function (m) { if (r.models[m]) edge('skill:' + s, 'queries', 'model:' + m); });
          (plan.terms || []).forEach(function (t) { if (r.glossary[t]) edge('skill:' + s, 'uses', 'term:' + t); });
        });
      });
      Object.keys(r.knowledge || {}).forEach(function (id) { edge(node('doc', id, r.knowledge[id].title), 'stored_in', 'source:' + r.knowledge[id].source); });
      Object.keys(r.work || {}).forEach(function (id) { edge(node('thread', id, r.work[id].title), 'stored_in', 'source:' + r.work[id].source); });
      mapMeaning().links.forEach(function (l) { edge((l.kind === 'doc' ? 'doc:' : 'thread:') + l.id, 'mentions', 'term:' + l.term); });
      resolve().mentions.forEach(function (m) { edge((m.kind === 'doc' ? 'doc:' : 'thread:') + m.id, 'about', m.entity + ':' + m.name); });
      // De-duplicate edges, keeping the first.
      var seen = {}, unique = [];
      edges.forEach(function (x) { var k = x.from + '|' + x.rel + '|' + x.to; if (!seen[k]) { seen[k] = true; unique.push(x); } });
      return { nodes: nodes, edges: unique, tableSource: tableSource };
    });
  }

  /** Nodes within one step of a node, for browsing: { node, edges: [...] }. */
  function neighbours(key) {
    var g = graph();
    var near = g.edges.filter(function (x) { return x.from === key || x.to === key; });
    return { node: g.nodes.filter(function (n) { return n.id === key; })[0] || null, edges: near };
  }

  // -------------------------------------------------------------------
  // Lineage helpers
  // -------------------------------------------------------------------
  /** The registry entry that holds a table ('GOLD.ORDER_TIMING_MART') and the record sources that feed it. */
  function sourceOfTable(table) {
    var s = sources().filter(function (x) { return (x.tables || []).indexOf(table) !== -1; })[0] || null;
    var name = table.split('.').pop();
    var feeds = sources().filter(function (x) { return (x.feeds || []).indexOf(name) !== -1; });
    return { source: s, upstream: feeds };
  }

  // -------------------------------------------------------------------
  // Report
  // -------------------------------------------------------------------
  function report() {
    return memo('report', function () {
      var c = connect(), f = freshness(), g = graph(), meaning = mapMeaning(), res = resolve();
      var kinds = {};
      sources().forEach(function (s) { kinds[s.kind] = (kinds[s.kind] || 0) + 1; });
      var flags = [];
      c.forEach(function (x) { if (!x.ok) flags.push({ source: x.id, flag: 'unreachable', detail: x.detail }); });
      f.forEach(function (x) { if (x.status === 'stale') flags.push({ source: x.id, flag: 'stale', detail: 'last changed ' + x.updated + ', ' + x.ageHours + ' h ago; SLA ' + x.slaHours + ' h' }); });
      meaning.unknown.forEach(function (u) { flags.push({ source: u.kind + ':' + u.id, flag: 'unknown-term', detail: u.term }); });
      res.unresolved.forEach(function (u) { flags.push({ source: u.kind + ':' + u.id, flag: 'unresolved-entity', detail: u.name }); });
      return {
        version: version(), today: today(),
        sources: c.map(function (x, i) { return Object.assign({}, x, { status: f[i].status, ageHours: f[i].ageHours, slaHours: f[i].slaHours, fresh: f[i].fresh }); }),
        kinds: kinds,
        meaning: { links: meaning.links.length, tagged: meaning.links.filter(function (l) { return l.how === 'tagged'; }).length },
        entities: { mentions: res.mentions.length, unresolved: res.unresolved.length },
        graph: { nodes: g.nodes.length, edges: g.edges.length },
        flags: flags
      };
    });
  }

  /** The short form returned with every answer. */
  function summary() {
    var r = report();
    return {
      version: r.version, sources: r.sources.length, ok: r.sources.filter(function (s) { return s.ok; }).length,
      stale: r.sources.filter(function (s) { return s.status === 'stale'; }).map(function (s) { return s.id; }),
      flags: r.flags.length
    };
  }

  MCX.build = {
    version: version, connect: connect, freshness: freshness, mapMeaning: mapMeaning, resolve: resolve, entitiesOf: entitiesOf,
    graph: graph, neighbours: neighbours, sourceOfTable: sourceOfTable, source: source, report: report, summary: summary,
    reset: function () { cache = {}; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
