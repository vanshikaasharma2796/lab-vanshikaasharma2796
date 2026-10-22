/* =====================================================================
   src/client.js — the page's link to the engine on a server

   NOT loaded by this project's index.html (there the engine, the
   warehouse and MCX.service run in the page). It is for a page served
   by a server that runs the engine: the .NET and Java ports, and
   `node tools/server.js --web <dir>`. It gives the page the same objects
   it uses in the browser, backed by the HTTP API in docs/API.md:

     MCX.engine.ready()      GET  api/status   the warehouse and repository stats
     MCX.engine.ask(input)   POST api/ask
     MCX.engine.refresh()    GET  api/status   again (after a deploy or a rollback)
     MCX.db.stats            { engine, rows, ms, tables }
     MCX.context             library() and stats() of the context repository
     MCX.service.*           every method the page uses, one endpoint each,
                             resolving with exactly what the server returns

   Errors reject with an Error whose message is the server's `error`
   text, plus `status` (400/403/404/409/500) and `code` when there is one
   (e.g. 'cost-cap'), the same as the in-browser MCX.service.
   ===================================================================== */
(function (global) {
  'use strict';
  var MCX = (global.MCX = global.MCX || {});

  function request(method, path, body) {
    var init = { method: method, headers: { Accept: 'application/json' } };
    if (method !== 'GET') {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body || {});
    }
    return global.fetch(path, init).then(function (response) {
      return response.text().then(function (text) {
        var json = null;
        try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
        if (!response.ok || json === null) {
          var error = new Error((json && json.error) || ('The server answered ' + response.status + ' ' + response.statusText));
          error.status = response.status;
          if (json && json.code) error.code = json.code;
          throw error;
        }
        return json;
      });
    });
  }
  /** GET with a query string; empty values are left out. */
  function get(path, query) {
    var parts = [];
    Object.keys(query || {}).forEach(function (key) {
      var value = query[key];
      if (value == null || value === '') return;
      if (Array.isArray(value)) value = value.join(',');
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
    });
    return request('GET', path + (parts.length ? '?' + parts.join('&') : ''));
  }
  function post(path, body) { return request('POST', path, body); }
  function id(value) { return encodeURIComponent(String(value)); }
  function args(a) { return a || {}; }

  var library = [];
  var libraryStats = { files: 0, tokens: 0 };
  var starting = null;

  function load() {
    return get('api/status').then(function (status) {
      library = status.library || [];
      libraryStats = status.context || libraryStats;
      MCX.db.stats = status.warehouse;
      return status.warehouse;
    });
  }

  MCX.remote = true;        // the page says "on the server" where it would say "in this page"
  MCX.contextRepo = {};     // the repository itself lives on the server
  MCX.db = { stats: null };
  MCX.context = {
    library: function () { return library; },
    stats: function () { return libraryStats; }
  };
  MCX.engine = {
    ready: function () {
      if (!starting) starting = load().then(null, function (error) { starting = null; throw error; });
      return starting;
    },
    refresh: function () { return load(); },
    ask: function (input) { return post('api/ask', input); }
  };

  var service = {
    ready: function () { return MCX.engine.ready().then(function () { return service; }); },
    ask: function (input) { return post('api/ask', input); },
    feedback: function (body) { return post('api/feedback', body); },
    log: function (a) { a = args(a); return get('api/log', { limit: a.limit, persona: a.persona, session: a.session }); },
    gaps: function () { return get('api/gaps'); },
    evals: function () { return get('api/evals'); },
    changes: function (a) { return get('api/changes', { status: args(a).status }); },
    draft: function (body) { return post('api/changes', body); },
    test: function (change) { return post('api/changes/' + id(change) + '/test', {}); },
    review: function (change, body) { return post('api/changes/' + id(change) + '/review', body); },
    approve: function (change, body) { return post('api/changes/' + id(change) + '/approve', body); },
    deploy: function (change, body) { return post('api/changes/' + id(change) + '/deploy', body); },
    reject: function (change, body) { return post('api/changes/' + id(change) + '/reject', body); },
    exportChanges: function () { return get('api/changes/export'); },
    versions: function () { return get('api/versions'); },
    rollback: function (version, body) { return post('api/versions/' + id(version) + '/rollback', body); },
    actions: function (a) { return get('api/actions', { status: args(a).status }); },
    decide: function (action, body) { return post('api/actions/' + id(action) + '/decide', body); },
    audit: function (a) { return get('api/audit', { limit: args(a).limit }); },
    verifyAudit: function () { return get('api/audit/verify'); },
    observe: function () { return get('api/observe'); },
    retention: function (body) { return post('api/retention/purge', body); },
    sources: function () { return get('api/sources'); },
    graph: function (a) { return get('api/graph', { focus: args(a).focus }); },
    search: function (a) { a = args(a); return get('api/search', { q: a.q, mode: a.mode, k: a.k, persona: a.persona, kinds: a.kinds }); },
    define: function (a) { return get('api/define', { term: args(a).term }); },
    lineage: function (a) { a = args(a); return get('api/lineage', { table: a.table, persona: a.persona, question: a.question, slug: a.slug }); },
    health: function () { return get('api/health'); },
    status: function () { return get('api/status'); },
    sql: function (body) { return post('api/sql', body); },
    /** Save the deployed changes as a JSON file (node tools/lifecycle.js apply <file> writes them into context/). */
    downloadChanges: function () {
      return service.exportChanges().then(function (data) {
        var blob = new global.Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
        var a = global.document.createElement('a');
        a.href = global.URL.createObjectURL(blob);
        a.download = 'mccontext-changes-' + String(data.current || 'context') + '.json';
        global.document.body.appendChild(a);
        a.click();
        global.setTimeout(function () { global.URL.revokeObjectURL(a.href); a.remove(); }, 0);
        return data;
      });
    }
  };
  MCX.service = service;
})(typeof window !== 'undefined' ? window : globalThis);
