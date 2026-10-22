/* =====================================================================
   src/service/service.js — the stateful shell around the engine

   MCX.engine.ask() is a pure function. Everything that remembers
   something lives here, behind one object with async methods that return
   plain JSON (the HTTP API in tools/server.js returns exactly these):

     ask           cost cap -> session memory -> engine -> answer log (L1)
                   -> audit (G2) -> proposed actions into the queue (E5)
     feedback, log, gaps, evals                     the learning loop (L2–L4, G1)
     changes, draft, test, review, approve, deploy, reject, versions, rollback
                                                    the change lifecycle (C1–C6, O4, O5)
     actions, decide                                human check (E5) and write-back (E6):
                                                    OPS.ACTION_LOG + the outbox
     audit, verifyAudit                             hash-chained audit trail (G2)
     observe, retention                             dashboard and drift (O1, O2), purge (G4)
     sources, graph, search, health, status, sql, define, lineage, exportChanges

   MCX.createService({ storage, clock, ids, mode, hooks, settings })
     storage   MCX.storage.memory() | MCX.storage.local(prefix) | Node file storage
     clock     () -> ISO time. Read once or more per call; a scripted run
               returns the same time for the whole call.
     ids       (kind) -> id. Default: a counter per kind kept in storage,
               'log-0001', 'fb-0001', 'aud-0001', 'chg-0001', 'out-0001'.
     mode      'overlay' (default; browser and scripted runs): deployed
               changes are kept in storage and applied over the context
               as loaded. 'files' (Node server): hooks write the files in
               context/ and reload.
     hooks     files mode: persist(change, repo) -> [{ file, before, after }],
               restore(files), reload() -> repository
     settings  { cost: { dailyCap }, retention: { logDays } } over MCX.config.engine

   In the page, MCX.service is created at load with localStorage, and
   re-applies the deployed overlay as soon as the engine is ready (B4).
   Shapes of every method: docs/A2-HANDOFF.md and docs/API.md.
   ===================================================================== */
(function (global) {
  'use strict';
  var MCX = (global.MCX = global.MCX || {});

  var DRAFT_NOTE = "Drafted by the engine's rules; with a model connected, the model would draft the wording.";
  var EDITABLE = ['draft', 'tested', 'reviewed', 'approved'];
  var STATUSES = ['draft', 'tested', 'reviewed', 'approved', 'deployed', 'rejected', 'rolled-back'];
  var QUESTION_WORDS = ['how', 'what', 'why', 'which', 'who', 'when', 'where', 'whats', 'does', 'do', 'did', 'is', 'are', 'was', 'were', 'can', 'could', 'should', 'would', 'long', 'much', 'many', 'tell', 'show', 'give', 'me', 'my', 'our'];
  var DEFAULTS = {
    counters: {}, log: [], feedback: [], audit: [], auditAnchor: null, changes: [], restore: {},
    versions: { base: null, current: null, history: [], active: [] },
    actions: [], outbox: [], tombstones: { log: 0, feedback: 0, audit: 0, purges: [] }, evalRuns: []
  };

  function err(status, message, code) { var e = new Error(message); e.status = status; if (code) e.code = code; return e; }
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function pad(n, width) { var s = String(n); while (s.length < width) s = '0' + s; return s; }
  function round(x, digits) { var f = Math.pow(10, digits); return Math.floor(x * f + 0.5) / f; }
  function countBy(list, key, keys) {
    var out = {};
    (keys || []).forEach(function (k) { out[k] = 0; });
    list.forEach(function (x) { out[x[key]] = (out[x[key]] || 0) + 1; });
    return out;
  }
  function find(list, id) { return list.filter(function (x) { return x.id === id; })[0] || null; }
  function day(iso) { return String(iso).slice(0, 10); }
  function time(iso) { return Date.parse(iso); }
  /** ISO without milliseconds when they are zero, so scripted times stay short. */
  function iso(ms) { return new Date(ms).toISOString().replace('.000Z', 'Z'); }

  function create(options) {
    var opts = options || {};
    var storage = opts.storage || MCX.storage.memory();
    var clock = opts.clock || function () { return new Date().toISOString(); };
    var mode = opts.mode === 'files' ? 'files' : 'overlay';
    var hooks = opts.hooks || {};
    var overrides = opts.settings || {};
    var state = null, base = null, starting = null, evalCache = {};
    var service = {};

    // ---------------------------------------------------------------
    // Settings, state, ids
    // ---------------------------------------------------------------
    function settings() {
      var e = (MCX.config && MCX.config.engine) || {};
      var cost = {}, retention = { logDays: 30 };
      [e.cost || {}, overrides.cost || {}].forEach(function (o) { Object.keys(o).forEach(function (k) { cost[k] = o[k]; }); });
      [e.retention || {}, overrides.retention || {}].forEach(function (o) { Object.keys(o).forEach(function (k) { retention[k] = o[k]; }); });
      return { cost: cost, retention: retention };
    }
    function load() {
      state = {};
      Object.keys(DEFAULTS).forEach(function (key) { state[key] = storage.read(key, DEFAULTS[key]); });
    }
    function save() { Array.prototype.forEach.call(arguments, function (key) { storage.write(key, state[key]); }); }
    var nextId = opts.ids || function (kind) {
      state.counters[kind] = (state.counters[kind] || 0) + 1;
      save('counters');
      return kind + '-' + pad(state.counters[kind], 4);
    };
    function repo() { return MCX.contextRepo; }
    function persona(id, what) {
      var card = id && repo().personas[String(id)];
      if (!card) throw err(id ? 404 : 400, id ? 'No persona called ' + id + ' in the context repository' : (what || 'by') + ' is required (a persona id)');
      return card;
    }
    function version() { return MCX.build.version(); }

    // ---------------------------------------------------------------
    // Start: state, the overlay, the OPS schema
    // ---------------------------------------------------------------
    function ensureOps() {
      var names = MCX.db.query('PRAGMA database_list').rows.map(function (r) { return r.name; });
      if (names.indexOf('OPS') === -1) MCX.db.run("ATTACH DATABASE ':memory:' AS OPS");
      MCX.db.run('CREATE TABLE IF NOT EXISTS OPS.ACTION_LOG (id TEXT PRIMARY KEY, at TEXT, system TEXT, type TEXT, title TEXT, detail TEXT, ' +
        'decided_by TEXT, status TEXT, external_ref TEXT, action_id TEXT, log_id TEXT, impact TEXT)');
      // The table mirrors this service's outbox: written again from storage at every start.
      MCX.db.run('DELETE FROM OPS.ACTION_LOG');
      state.outbox.forEach(writeRow);
    }
    function writeRow(o) {
      MCX.db.run('INSERT OR REPLACE INTO OPS.ACTION_LOG (id, at, system, type, title, detail, decided_by, status, external_ref, action_id, log_id, impact) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        [o.id, o.at, o.system, o.type, o.title, o.detail, o.by, o.status, o.external_ref, o.action, o.log, o.impact]);
    }

    /** The live repository: the context as loaded plus the deployed overlay (overlay mode). */
    function rebuildLive() {
      var live = clone(base), skipped = [];
      state.versions.active.forEach(function (id) {
        var c = find(state.changes, id);
        try { if (c) MCX.changes.apply(live, c); } catch (error) { skipped.push({ change: id, reason: error.message }); }
      });
      MCX.contextRepo = live;
      MCX.engine.invalidate();
      return skipped;
    }

    function noteVersion(at, kind, extra) {
      var V = state.versions, v = version();
      var entry = { version: v, previous: V.current, at: at, by: null, kind: kind, change: null };
      Object.keys(extra || {}).forEach(function (k) { entry[k] = extra[k]; });
      V.history.push(entry);
      V.current = v;
      save('versions');
      return entry;
    }

    function init() {
      load();
      var at = clock();
      if (mode === 'overlay') { base = clone(repo()); service.skipped = rebuildLive(); } else { base = repo(); service.skipped = []; }
      ensureOps();
      var V = state.versions;
      if (!V.history.length) { V.base = version(); noteVersion(at, 'base', { note: 'the context as first loaded' }); }
      else if (V.current !== version()) noteVersion(at, 'reload', { note: 'the context files changed outside the lifecycle' });
    }

    function ready() {
      if (!starting) {
        starting = Promise.resolve(MCX.engine.ready()).then(init).then(function () { return service; }, function (error) { starting = null; throw error; });
      }
      return starting;
    }
    /** Every public method waits for the engine, then runs its body in one go (no interleaving). */
    function method(fn) { return function (a, b) { return ready().then(function () { return fn(a, b); }); }; }

    // ---------------------------------------------------------------
    // Audit (G2)
    // ---------------------------------------------------------------
    function audit(at, type, actor, subject, data) {
      var last = state.audit[state.audit.length - 1];
      var anchor = state.auditAnchor;
      var prev = last ? last.hash : anchor ? anchor.hash : MCX.audit.GENESIS;
      var seq = last ? last.seq + 1 : anchor ? anchor.seq + 1 : 1;
      var e = MCX.audit.entry(prev, seq, { id: nextId('aud'), at: at, type: type, actor: actor, subject: subject, data: data });
      state.audit.push(e);
      save('audit');
      return e;
    }

    // ---------------------------------------------------------------
    // Ask (L1, G5, S6 memory, E5 queue)
    // ---------------------------------------------------------------
    function spentToday(personaId, at) {
      var total = 0;
      state.log.forEach(function (e) { if (e.persona === personaId && day(e.at) === day(at)) total += e.cost.estimate; });
      return round(total, 6);
    }
    function missedWords(result) {
      var m = /not understood: (.+)$/.exec(result.quality.parts.coverage.detail || '');
      return m ? m[1].split(', ') : [];
    }
    function citedSources(marks) {
      var out = [];
      marks.forEach(function (m) { (m.lineage || []).forEach(function (l) { if (l.source && out.indexOf(l.source) === -1) out.push(l.source); }); });
      return out;
    }
    function ids(list) { return list.map(function (x) { return x.id; }); }

    function queueActions(result, entry, at) {
      var queued = [];
      result.actions.forEach(function (a) {
        var open = state.actions.filter(function (q) { return q.action === a.id && q.status === 'proposed'; })[0];
        if (open) { if (open.logs.indexOf(entry.id) === -1) open.logs.push(entry.id); queued.push(open.id); return; }
        var n = state.actions.filter(function (q) { return q.action === a.id; }).length;
        var item = { id: n ? a.id + '-' + (n + 1) : a.id, action: a.id, at: at, log: entry.id, logs: [entry.id], persona: entry.persona, analysis: a.analysis,
          type: a.type, system: a.system, title: a.title, detail: a.detail, impact: a.impact, needsApproval: a.needsApproval,
          approverRole: a.approverRole, approvers: a.approvers.slice(), why: a.why, status: 'proposed', decision: null, write: null };
        state.actions.push(item);
        queued.push(item.id);
      });
      if (result.actions.length) save('actions');
      return queued;
    }

    service.ask = method(function (input) {
      input = input || {};
      var card = persona(input.persona, 'persona');
      var question = String(input.question == null ? '' : input.question).trim();
      if (!question) throw err(400, 'question is required');
      var at = clock();
      var cost = settings().cost;
      var spent = spentToday(card.id, at);
      if (cost.dailyCap != null && spent >= cost.dailyCap) {
        throw err(403, 'The daily cost cap for ' + card.name + ' is reached: ' + (cost.currency || 'USD') + ' ' + spent.toFixed(4) + ' of ' + Number(cost.dailyCap).toFixed(4) +
          ' spent on ' + day(at) + '. It resets at midnight UTC.', 'cost-cap');
      }
      var session = input.session == null || input.session === '' ? null : String(input.session);
      var history = session ? state.log.filter(function (e) { return e.session === session; }).map(function (e) { return { question: e.question, analysis: e.analysis, answer: e.answer }; }) : [];
      var engineInput = { persona: card.id, question: question };
      if (input.slug) engineInput.slug = String(input.slug);
      if (input.bucket) engineInput.bucket = String(input.bucket);
      if (history.length) engineInput.history = history;
      var result = MCX.engine.ask(engineInput);

      var good = result.context.marks.filter(function (m) { return m.good != null; });
      var entry = {
        id: nextId('log'), at: at, session: session, persona: card.id, slug: input.slug ? String(input.slug) : null,
        question: result.pack.question, route: result.route.kind, analysis: result.plan.name,
        score: result.route.score == null ? null : result.route.score, followUp: result.route.followUp ? result.route.followUp.from : null,
        guard: result.guard.verdict, guardRules: result.guard.findings.map(function (f) { return f.rule; }),
        validation: result.validation.ok, quality: result.quality.score, band: result.quality.band, missed: missedWords(result),
        cost: { tokens: result.cost.tokens, estimate: result.cost.estimate }, version: result.version,
        facts: (result.facts || []).map(function (f) { return f.key; }), sources: citedSources(good),
        actions: result.actions.map(function (a) { return a.id; }), figures: good.map(function (m) { return m.good; }),
        fingerprint: MCX.evals.fingerprint(result), memory: result.pack.memory.turns.length, answer: result.context.answer
      };
      state.log.push(entry);
      save('log');
      var trail = audit(at, 'ask', card.id, entry.id, {
        log: entry.id, question: entry.question, route: entry.route, analysis: entry.analysis, version: entry.version,
        guard: entry.guard, validation: entry.validation, quality: entry.quality, sources: entry.sources, facts: entry.facts,
        terms: ids(result.pack.terms), skills: ids(result.pack.skills), models: ids(result.pack.models), policies: ids(result.pack.policies),
        actions: entry.actions, tokens: entry.cost.tokens
      });
      var queued = queueActions(result, entry, at);
      var out = {};
      Object.keys(result).forEach(function (k) { out[k] = result[k]; });
      out.log = { id: entry.id, at: at, session: session };
      out.audit = { id: trail.id, hash: trail.hash };
      out.queued = queued;
      return out;
    });

    // ---------------------------------------------------------------
    // Feedback and the log (L1, L2)
    // ---------------------------------------------------------------
    service.feedback = method(function (args) {
      args = args || {};
      var entry = find(state.log, args.log);
      if (!entry) throw err(404, 'No answer ' + args.log + ' in the log');
      if (args.vote !== 'up' && args.vote !== 'down') throw err(400, 'vote must be up or down');
      var by = args.by ? persona(args.by).id : entry.persona;
      var note = args.note == null ? null : MCX.guard.mask(String(args.note).trim()).slice(0, 500) || null;
      var at = clock();
      var fb = { id: nextId('fb'), at: at, log: entry.id, vote: args.vote, note: note, by: by, persona: entry.persona, question: entry.question };
      state.feedback.push(fb);
      save('feedback');
      audit(at, 'feedback', by, entry.id, { feedback: fb.id, vote: fb.vote, note: note });
      return fb;
    });

    service.log = method(function (args) {
      args = args || {};
      var limit = Math.max(1, Math.min(500, Number(args.limit) || 50));
      var list = state.log.filter(function (e) { return (!args.persona || e.persona === args.persona) && (!args.session || e.session === args.session); });
      return { total: list.length, purged: state.tombstones.log, entries: list.slice(-limit).reverse() };
    });

    // ---------------------------------------------------------------
    // Gaps (L3) with a suggested fix each (L4)
    // ---------------------------------------------------------------
    function glossaryDocs() {
      var g = repo().glossary;
      return Object.keys(g).map(function (id) { return { id: id, text: g[id].name + ' ' + (g[id].synonyms || []).join(' ') + ' ' + g[id].body }; });
    }
    /** The wording not understood, as a synonym of the closest glossary term (or null). */
    function suggestSynonym(entry) {
      if (!entry.missed.length) return null;
      var words = String(entry.question).toLowerCase().replace(/[’‘]/g, "'").match(/[a-z0-9%$'-]+/g) || [];
      var runs = [], run = [];
      words.forEach(function (w) {
        var stem = MCX.text.tokens(w)[0];
        if (stem && entry.missed.indexOf(stem) !== -1 && QUESTION_WORDS.indexOf(w) === -1) run.push(w);
        else { if (run.length) runs.push(run); run = []; }
      });
      if (run.length) runs.push(run);
      var docs = glossaryDocs(), best = null;
      runs.forEach(function (r, i) {
        var phrase = r.join(' ');
        if (phrase.length < 3) return;
        var top = MCX.text.rank(phrase, docs)[0];
        if (!top) return;
        if (!best || top.score > best.score || (top.score === best.score && r.length > best.words)) best = { phrase: phrase, term: top.id, score: top.score, words: r.length, at: i };
      });
      if (!best) return null;
      try { MCX.changes.describe(repo(), { kind: 'add-synonym', target: best.term, value: best.phrase }); } catch (error) { return null; }
      return { kind: 'add-synonym', target: best.term, value: best.phrase,
        reason: '“' + best.phrase + '” was not understood in “' + entry.question + '”; the closest glossary term is ' + repo().glossary[best.term].name + '.' };
    }

    /** A blocked question whose remainder is a known business question: worth a look at the guard rule. */
    function benign(entry) {
      var card = repo().personas[entry.persona];
      if (!card) return null;
      var rest = entry.question;
      MCX.guard.check(entry.question).findings.forEach(function (f) {
        var at = rest.toLowerCase().indexOf(String(f.text).toLowerCase());
        if (at !== -1) rest = rest.slice(0, at) + ' ' + rest.slice(at + f.text.length);
      });
      rest = rest.replace(/^[\s,:;.-]+|[\s,:;-]+$/g, '').replace(/\s+/g, ' ');
      if (!rest || MCX.guard.check(rest).verdict === 'blocked') return null;
      var routed = MCX.router.route(card, rest, null);
      return routed.kind === 'match' || routed.kind === 'lookup' ? { rest: rest, route: routed.kind, analysis: routed.analysis } : null;
    }

    /** Which gap (if any) one answer shows: { type, detail } or null. Shared by gaps() and test(). */
    function gapOf(e) {
      if (e.guard === 'blocked') return null;
      if (e.route === 'none') return { type: 'no-match', detail: 'no analysis or certified metric matches the wording' + (e.missed.length ? '; not understood: ' + e.missed.join(', ') : '') };
      if (e.route === 'match' && e.score != null && e.score < 0.6) return { type: 'weak-match', detail: 'matched at ' + round(e.score, 2) + ' (below 0.6)' + (e.missed.length ? '; not understood: ' + e.missed.join(', ') : '') };
      if (e.route !== 'bank' && e.route !== 'out-of-scope' && e.missed.length) return { type: 'not-understood', detail: 'not understood: ' + e.missed.join(', ') };
      return null;
    }

    function gapsList() {
      var groups = [], byKey = {};
      function add(type, entry, detail, suggestion, extra) {
        var key = type + '|' + entry.persona + '|' + entry.question;
        var g = byKey[key];
        if (!g) {
          g = byKey[key] = { id: 'gap-' + MCX.sha256(key).slice(0, 10), type: type, persona: entry.persona, question: entry.question, count: 0, logs: [],
            first: entry.at, last: entry.at, detail: detail, suggestion: suggestion, notes: [], status: 'open', changes: [] };
          groups.push(g);
        }
        g.count++;
        if (g.logs.indexOf(entry.id) === -1) g.logs.push(entry.id);
        g.last = entry.at;
        if (extra && extra.note) g.notes.push(extra.note);
      }
      state.log.forEach(function (e) {
        if (e.guard === 'blocked') {
          var b = benign(e);
          if (b) add('blocked-benign', e, 'blocked by ' + e.guardRules.filter(function (r) { return r.indexOf('pii-') !== 0; }).join(', ') + ', yet “' + b.rest + '” is a known question (' + b.route + ' → ' + b.analysis + ')',
            { kind: null, target: 'src/engine/guard.js', value: null, reason: 'A person reviews the guard rule: it may be too broad. Guard rules are code, not context, so this is not drafted automatically.' });
          return;
        }
        var gap = gapOf(e);
        if (gap) add(gap.type, e, gap.detail, suggestSynonym(e));
      });
      state.feedback.forEach(function (f) {
        if (f.vote !== 'down') return;
        var e = find(state.log, f.log);
        if (!e) return;
        var target = e.facts.filter(function (k) { return k.indexOf('doc:') === 0; }).map(function (k) { return 'knowledge:' + k.slice(4); })[0];
        if (!target) {
          var plan = MCX.analyses[e.analysis];
          var skill = plan && (plan.skills || []).filter(function (s) { return repo().skills[s]; })[0];
          if (skill) target = 'skill:' + skill;
        }
        var suggestion = f.note && target ? { kind: 'add-note', target: target, value: f.note, reason: 'Down-voted by ' + f.by + ': “' + f.note + '”. The note is added to the context the answer followed, for its owner to act on.' } : null;
        add('down-vote', { id: e.id, at: f.at, persona: e.persona, question: e.question }, 'down-voted' + (f.note ? ': “' + f.note + '”' : ' (no note)'), suggestion, { note: f.note });
      });
      groups.forEach(function (g) {
        var linked = state.changes.filter(function (c) { return c.fromGap === g.id; });
        g.changes = ids(linked);
        if (linked.some(function (c) { return c.status === 'deployed'; })) g.status = 'fixed';
        else if (linked.some(function (c) { return EDITABLE.indexOf(c.status) !== -1; })) g.status = 'drafted';
      });
      return groups;
    }

    service.gaps = method(function () {
      var list = gapsList();
      return { total: list.length, open: list.filter(function (g) { return g.status === 'open'; }).length, gaps: list };
    });

    // ---------------------------------------------------------------
    // Evals (G1)
    // ---------------------------------------------------------------
    function evalsFor(v) {
      if (!evalCache[v]) evalCache[v] = MCX.evals.run();
      return evalCache[v];
    }
    function brief(e) { return { score: e.score, passed: e.passed, total: e.total }; }

    service.evals = method(function () {
      var at = clock(), v = version(), result = evalsFor(v);
      state.evalRuns.push({ at: at, version: v, score: result.score, passed: result.passed, total: result.total });
      state.evalRuns = state.evalRuns.slice(-20);
      save('evalRuns');
      return { at: at, version: v, score: result.score, passed: result.passed, total: result.total, cases: result.cases };
    });

    // ---------------------------------------------------------------
    // The change lifecycle (C1–C6, O4, O5)
    // ---------------------------------------------------------------
    function change(id) {
      var c = find(state.changes, id);
      if (!c) throw err(404, 'No change ' + id);
      return c;
    }
    function step(c, at, by, name, note) { c.history.push({ at: at, by: by || null, step: name, status: c.status, note: note || null }); }
    function mayDecide(c, by) { return by === c.author || c.signoff.indexOf(by) !== -1; }
    function names(list) { return list.map(function (id) { var p = repo().personas[id]; return p ? p.name : id; }).join(', ') || 'nobody (no sign-off listed for this owner)'; }

    service.changes = method(function (args) {
      args = args || {};
      var list = state.changes.filter(function (c) { return !args.status || c.status === args.status; });
      return { total: list.length, counts: countBy(state.changes, 'status', STATUSES), changes: list };
    });

    service.draft = method(function (args) {
      args = args || {};
      var at = clock(), spec, gap = null;
      if (args.fromGap) {
        gap = find(gapsList(), args.fromGap);
        if (!gap) throw err(404, 'No gap ' + args.fromGap);
        if (!gap.suggestion || !gap.suggestion.kind) throw err(400, 'This gap has no automatic fix; draft a change by hand (kind, target, value, reason)');
        spec = { kind: gap.suggestion.kind, target: gap.suggestion.target, value: gap.suggestion.value, reason: gap.suggestion.reason, author: args.author || args.by || gap.persona };
      } else {
        spec = { kind: args.kind, target: args.target, value: args.value, reason: args.reason, author: args.author || args.by };
        if (!String(spec.reason || '').trim()) throw err(400, 'reason is required');
      }
      var author = persona(spec.author, 'author').id;
      var d = MCX.changes.describe(repo(), spec, at);
      var c = {
        id: nextId('chg'), at: at, kind: spec.kind, target: spec.target, value: d.value, reason: String(spec.reason).trim(), author: author,
        drafter: gap ? 'engine' : 'person', note: gap ? DRAFT_NOTE : null, fromGap: gap ? gap.id : null,
        question: gap ? gap.question : (args.question ? String(args.question) : null), persona: gap ? gap.persona : (args.persona || author),
        file: d.file, owner: d.owner, signoff: MCX.changes.signoff(repo(), d.owner), label: d.label, before: d.before, after: d.after,
        status: 'draft', baseVersion: version(), test: null, review: null, approval: null, deployment: null, rejection: null, rollback: null, history: []
      };
      step(c, at, author, 'draft', gap ? DRAFT_NOTE : 'proposed by ' + names([author]));
      state.changes.push(c);
      save('changes');
      audit(at, 'change.draft', author, c.id, { kind: c.kind, target: c.target, value: c.value, file: c.file, owner: c.owner, fromGap: c.fromGap });
      return c;
    });

    function summarize(result) {
      return { route: result.route.kind, analysis: result.plan.name, score: result.route.score == null ? null : result.route.score, quality: result.quality.score,
        understood: result.quality.parts.coverage.detail, missed: missedWords(result), answer: result.context.answer.split('\n')[0] };
    }

    service.test = method(function (id) {
      var c = change(id);
      if (['draft', 'tested', 'reviewed'].indexOf(c.status) === -1) throw err(409, 'Only a draft, tested or reviewed change can be tested; ' + c.id + ' is ' + c.status);
      var at = clock();
      var live = repo(), liveVersion = version();
      var before = evalsFor(liveVersion);
      var gapBefore = c.question ? summarize(MCX.engine.ask({ persona: c.persona, question: c.question })) : null;
      var sandbox = MCX.changes.apply(clone(live), c);
      var sandboxVersion, gapAfter = null, golden, after;
      MCX.contextRepo = sandbox;
      MCX.engine.invalidate();
      try {
        sandboxVersion = version();
        if (c.question) gapAfter = summarize(MCX.engine.ask({ persona: c.persona, question: c.question }));
        golden = MCX.evals.golden();
        after = evalsFor(sandboxVersion);
      } finally {
        MCX.contextRepo = live;
        MCX.engine.invalidate();
      }
      var passBefore = {}, broken = [], fixed = [];
      before.cases.forEach(function (x) { passBefore[x.id] = x.ok; });
      after.cases.forEach(function (x) { if (passBefore[x.id] && !x.ok) broken.push(x.id); if (passBefore[x.id] === false && x.ok) fixed.push(x.id); });
      var resolves = null;
      if (gapBefore && gapAfter && (c.fromGap == null || ['no-match', 'weak-match', 'not-understood'].indexOf((find(gapsList(), c.fromGap) || {}).type) !== -1)) {
        resolves = !gapOf({ guard: 'pass', route: gapAfter.route, score: gapAfter.score, missed: gapAfter.missed });
      }
      c.test = { at: at, sandbox: true, version: { live: liveVersion, sandbox: sandboxVersion },
        gap: c.question ? { persona: c.persona, question: c.question, before: gapBefore, after: gapAfter } : null,
        resolves: resolves, goldenTotal: golden.total, goldenChanged: golden.changed,
        evalsBefore: brief(before), evalsAfter: brief(after), broken: broken, fixed: fixed };
      c.status = 'tested';
      c.review = null; c.approval = null;
      step(c, at, null, 'test', 'simulated on a copy of the repository: ' + golden.changed.length + ' of ' + golden.total + ' golden answers change; evals ' + before.passed + '/' + before.total + ' → ' + after.passed + '/' + after.total +
        (resolves === true ? '; the gap question is now answered' : resolves === false ? '; the gap question is still not answered' : ''));
      save('changes');
      audit(at, 'change.test', null, c.id, { resolves: resolves, goldenChanged: golden.changed.length, evalsBefore: before.passed, evalsAfter: after.passed, broken: broken, sandbox: sandboxVersion });
      return c;
    });

    service.review = method(function (id, args) {
      args = args || {};
      var c = change(id);
      if (c.status !== 'tested') throw err(409, 'Only a tested change can be reviewed; ' + c.id + ' is ' + c.status);
      var by = args.by ? persona(args.by).id : null;
      var at = clock(), t = c.test;
      var risk = t.broken.length ? 'high' : t.goldenChanged.length > 5 ? 'medium' : t.goldenChanged.length ? 'low' : 'none';
      var recommendation = t.broken.length ? 'reject' : t.resolves === false ? 'rework' : 'approve';
      var summary = [
        c.label + ' (' + c.file + ', owner ' + c.owner + ').',
        c.drafter === 'engine' ? DRAFT_NOTE : 'Proposed by ' + names([c.author]) + '.',
        t.resolves === true ? 'The gap question is answered after the change (' + t.gap.before.route + ' → ' + t.gap.after.route + ').'
          : t.resolves === false ? 'The gap question is still not answered after the change.' : 'No gap question to re-ask.',
        t.goldenChanged.length + ' of ' + t.goldenTotal + ' golden answers change' + (t.goldenChanged.length ? ': ' + t.goldenChanged.slice(0, 8).map(function (g) { return g.id + ' (' + g.path + ')'; }).join(', ') + (t.goldenChanged.length > 8 ? ', …' : '') : '') + '.',
        'Evals: ' + t.evalsBefore.passed + ' of ' + t.evalsBefore.total + ' pass now, ' + t.evalsAfter.passed + ' of ' + t.evalsAfter.total + ' after' +
          (t.broken.length ? '; it breaks ' + t.broken.join(', ') : '') + (t.fixed.length ? '; it fixes ' + t.fixed.join(', ') : '') + '.',
        'Sign-off: ' + names(c.signoff) + ' (' + c.owner + '); the author cannot sign off.'
      ];
      c.review = { at: at, by: by, risk: risk, recommendation: recommendation, summary: summary };
      c.status = 'reviewed';
      step(c, at, by, 'review', 'risk ' + risk + ', recommendation: ' + recommendation);
      save('changes');
      audit(at, 'change.review', by, c.id, { risk: risk, recommendation: recommendation });
      return c;
    });

    service.approve = method(function (id, args) {
      args = args || {};
      var c = change(id);
      if (c.status !== 'reviewed') throw err(409, 'Only a reviewed change can be approved; ' + c.id + ' is ' + c.status);
      var by = persona(args.by).id;
      if (by === c.author) throw err(403, 'The author of a change cannot sign it off; ask ' + names(c.signoff));
      if (c.signoff.indexOf(by) === -1) throw err(403, names([by]) + ' does not sign off ' + c.owner + ' files; ask ' + names(c.signoff));
      var at = clock();
      c.approval = { at: at, by: by, owner: c.owner };
      c.status = 'approved';
      step(c, at, by, 'approve', 'signed off for ' + c.owner);
      save('changes');
      audit(at, 'change.approve', by, c.id, { owner: c.owner });
      return c;
    });

    service.deploy = method(function (id, args) {
      args = args || {};
      var c = change(id);
      if (c.status !== 'approved') throw err(409, 'Only an approved change can be deployed; ' + c.id + ' is ' + c.status);
      var by = persona(args.by).id;
      if (!mayDecide(c, by)) throw err(403, names([by]) + ' may not deploy this change; its author or ' + names(c.signoff) + ' can');
      var at = clock(), previous = version(), files = [c.file];
      var V = state.versions;
      if (mode === 'files') {
        state.restore[c.id] = hooks.persist(c, repo());
        save('restore');
        base = hooks.reload();
        MCX.contextRepo = base;
        MCX.engine.invalidate();
      } else {
        MCX.changes.apply(clone(repo()), c);         // fails here (409) if it no longer applies
      }
      V.active.push(c.id);
      if (mode !== 'files') rebuildLive();
      var entry = noteVersion(at, 'deploy', { by: by, change: c.id, files: files });
      entry.previous = previous;
      save('versions');
      c.deployment = { at: at, by: by, version: entry.version, previous: previous, files: files, mode: mode };
      c.status = 'deployed';
      step(c, at, by, 'deploy', 'live as version ' + entry.version);
      save('changes');
      audit(at, 'change.deploy', by, c.id, { version: entry.version, previous: previous, files: files });
      return c;
    });

    service.reject = method(function (id, args) {
      args = args || {};
      var c = change(id);
      if (EDITABLE.indexOf(c.status) === -1) throw err(409, 'Only a change that is not live can be rejected; ' + c.id + ' is ' + c.status);
      var by = persona(args.by).id;
      if (!mayDecide(c, by)) throw err(403, names([by]) + ' may not reject this change; its author or ' + names(c.signoff) + ' can');
      var at = clock(), note = args.note == null ? null : String(args.note).trim() || null;
      c.rejection = { at: at, by: by, note: note };
      c.status = 'rejected';
      step(c, at, by, 'reject', note);
      save('changes');
      audit(at, 'change.reject', by, c.id, { note: note });
      return c;
    });

    function publicHistory() { return state.versions.history.map(function (h) { return clone(h); }); }

    service.versions = method(function () {
      var V = state.versions;
      return { current: V.current, base: V.base, active: V.active.slice(), history: publicHistory() };
    });

    service.rollback = method(function (target, args) {
      args = args || {};
      var by = persona(args.by).id;
      var everyone = [];
      var sign = (repo().actions && repo().actions.signoff) || {};
      Object.keys(sign).forEach(function (k) { if (Array.isArray(sign[k])) sign[k].forEach(function (p) { if (everyone.indexOf(p) === -1) everyone.push(p); }); });
      if (everyone.indexOf(by) === -1) throw err(403, names([by]) + ' signs off no context files, so may not roll back');
      var V = state.versions, at = -1;
      V.history.forEach(function (h, i) { if (h.version === target) at = i; });
      if (at === -1) throw err(404, 'No version ' + target + ' in the history');
      if (target === V.current) throw err(409, 'Version ' + target + ' is already live');
      function deployedAt(id) { var i = -1; V.history.forEach(function (h, n) { if (h.kind === 'deploy' && h.change === id) i = n; }); return i; }
      var undo = V.active.filter(function (id) { return deployedAt(id) > at; });
      if (!undo.length) throw err(409, 'Nothing deployed through the lifecycle since ' + target + '; the context changed outside it');
      var when = clock(), previous = V.current;
      V.active = V.active.filter(function (id) { return undo.indexOf(id) === -1; });
      if (mode === 'files') {
        undo.slice().reverse().forEach(function (id) { if (state.restore[id]) hooks.restore(state.restore[id]); });
        base = hooks.reload();
        MCX.contextRepo = base;
        MCX.engine.invalidate();
      } else {
        rebuildLive();
      }
      undo.forEach(function (id) {
        var c = find(state.changes, id);
        c.status = 'rolled-back';
        c.rollback = { at: when, by: by, to: target };
        step(c, when, by, 'rollback', 'rolled back to ' + target);
      });
      save('changes');
      var entry = noteVersion(when, 'rollback', { by: by, target: target, undone: undo });
      entry.previous = previous;
      if (entry.version !== target) entry.note = 'the context now differs from ' + target + ' (it changed outside the lifecycle since)';
      save('versions');
      audit(when, 'version.rollback', by, target, { version: entry.version, previous: previous, undone: undo });
      return { version: entry.version, previous: previous, target: target, matches: entry.version === target, undone: undo };
    });

    /** The deployed changes, for the page's "Export changes" (tools/lifecycle.js apply writes them into context/). */
    service.exportChanges = method(function () {
      var V = state.versions;
      return {
        format: 'mccontext-changes/1', exported: clock(), base: V.base, current: V.current,
        changes: V.active.map(function (id) {
          var c = find(state.changes, id);
          return { id: c.id, kind: c.kind, target: c.target, value: c.value, after: c.after, file: c.file, owner: c.owner, reason: c.reason, author: c.author,
            approvedBy: c.approval ? c.approval.by : null, deployedBy: c.deployment ? c.deployment.by : null, deployedAt: c.deployment ? c.deployment.at : null, version: c.deployment ? c.deployment.version : null };
        })
      };
    });

    // ---------------------------------------------------------------
    // Actions: human check (E5) and write-back (E6)
    // ---------------------------------------------------------------
    var REF = { Jira: function (n) { return 'JIRA-' + (1041 + n); }, ServiceNow: function (n) { return 'INC' + pad(10041 + n, 7); },
      Slack: function (n) { return 'SLACK-' + (1041 + n); }, SAP: function (n) { return 'PO-' + (4500001041 + n); } };

    function act(item, by, at) {
      var key = 'ref:' + item.system;
      state.counters[key] = (state.counters[key] || 0) + 1;
      save('counters');
      var n = state.counters[key];
      var ref = REF[item.system] ? REF[item.system](n) : String(item.system).toUpperCase().replace(/[^A-Z0-9]+/g, '') + '-' + (1041 + n);
      var out = { id: nextId('out'), at: at, system: item.system, type: item.type, title: item.title, detail: item.detail, by: by, status: 'written',
        external_ref: ref, action: item.id, log: item.log, impact: item.impact, simulated: true };
      writeRow(out);
      state.outbox.push(out);
      save('outbox');
      item.write = { at: at, system: item.system, ref: ref, table: 'OPS.ACTION_LOG', outbox: out.id,
        note: 'Simulated: written to OPS.ACTION_LOG and the outbox as ' + ref + '; with a ' + item.system + ' connector it would be created there.' };
      item.status = 'written';
      audit(at, 'action.write', by, item.id, { system: item.system, ref: ref, table: 'OPS.ACTION_LOG', outbox: out.id });
      return out;
    }

    service.actions = method(function (args) {
      args = args || {};
      var list = state.actions.filter(function (a) { return !args.status || a.status === args.status; });
      return { total: list.length, counts: countBy(state.actions, 'status', ['proposed', 'written', 'rejected']), actions: list, outbox: state.outbox.slice() };
    });

    service.decide = method(function (id, args) {
      args = args || {};
      var item = find(state.actions, id);
      if (!item) throw err(404, 'No action ' + id + ' in the queue');
      if (item.status !== 'proposed') throw err(409, 'Action ' + id + ' is already ' + item.status);
      if (args.decision !== 'approve' && args.decision !== 'reject') throw err(400, 'decision must be approve or reject');
      var by = persona(args.by).id;
      if (item.needsApproval && item.approvers.indexOf(by) === -1) {
        throw err(403, 'This is a high-impact action: it needs a human check by ' + item.approverRole + ' (' + names(item.approvers) + ')');
      }
      if (!item.needsApproval && by !== item.persona && item.approvers.indexOf(by) === -1) {
        throw err(403, 'A low-impact action is decided by the person who asked (' + names([item.persona]) + ') or by ' + item.approverRole + ' (' + names(item.approvers) + ')');
      }
      var at = clock(), note = args.note == null ? null : MCX.guard.mask(String(args.note).trim()) || null;
      item.decision = { at: at, by: by, decision: args.decision, note: note };
      item.status = args.decision === 'approve' ? 'approved' : 'rejected';
      audit(at, 'action.decide', by, item.id, { decision: args.decision, impact: item.impact, needsApproval: item.needsApproval, note: note });
      if (args.decision === 'approve') act(item, by, at);
      save('actions');
      return item;
    });

    // ---------------------------------------------------------------
    // Audit (G2)
    // ---------------------------------------------------------------
    service.audit = method(function (args) {
      args = args || {};
      var limit = Math.max(1, Math.min(500, Number(args.limit) || 50));
      return { total: state.audit.length, anchor: state.auditAnchor, entries: state.audit.slice(-limit).reverse() };
    });

    function verify() {
      var r = MCX.audit.verify(state.audit, state.auditAnchor);
      return { ok: r.ok, checked: r.checked, total: state.audit.length, anchor: state.auditAnchor, broken: r.broken,
        head: state.audit.length ? state.audit[state.audit.length - 1].hash : state.auditAnchor ? state.auditAnchor.hash : MCX.audit.GENESIS };
    }
    service.verifyAudit = method(verify);

    // ---------------------------------------------------------------
    // Observe (O1, O2) and retention (G4)
    // ---------------------------------------------------------------
    function drift() {
      var alerts = [];
      MCX.build.freshness().forEach(function (f) {
        if (f.status === 'stale' || f.status === 'unreachable') alerts.push({ kind: 'source', id: f.id, status: f.status, detail: f.status === 'stale' ? 'last changed ' + f.updated + ', ' + f.ageHours + ' h ago; SLA ' + f.slaHours + ' h' : 'unreachable' });
      });
      var latest = {}, order = [];
      state.log.forEach(function (e) {
        var key = e.persona + '|' + e.question;
        if (!latest[key]) { latest[key] = []; order.push(key); }
        latest[key].push(e);
      });
      order.forEach(function (key) {
        var list = latest[key];
        if (list.length < 2) return;
        var now = list[list.length - 1], before = list[list.length - 2];
        var added = now.figures.filter(function (f) { return before.figures.indexOf(f) === -1; });
        var removed = before.figures.filter(function (f) { return now.figures.indexOf(f) === -1; });
        if (added.length || removed.length) alerts.push({ kind: 'answer', persona: now.persona, question: now.question, log: now.id, previous: before.id, version: now.version, previousVersion: before.version, added: added, removed: removed });
      });
      var seen = {};
      state.log.slice().reverse().forEach(function (e) {
        if (!e.slug || seen[e.persona + '/' + e.slug]) return;
        seen[e.persona + '/' + e.slug] = true;
        var g = MCX.evals.goldenFor(e.persona, e.slug);
        var path = g ? MCX.evals.diff(e.fingerprint, g.fp) : null;
        if (path) alerts.push({ kind: 'golden', id: e.persona + '/' + e.slug, log: e.id, path: path, version: e.version });
      });
      return alerts;
    }

    service.observe = method(function () {
      var at = clock(), log = state.log, cost = settings().cost;
      var quality = log.reduce(function (s, e) { return s + e.quality; }, 0);
      var byPersona = {}, total = 0;
      log.forEach(function (e) { if (day(e.at) === day(at)) { byPersona[e.persona] = round((byPersona[e.persona] || 0) + e.cost.estimate, 6); total += e.cost.estimate; } });
      var gaps = gapsList(), alerts = drift(), fresh = MCX.build.freshness(), report = MCX.build.report();
      return {
        at: at, version: state.versions.current, versions: state.versions.history.length,
        answers: log.length, avgQuality: log.length ? round(quality / log.length, 1) : null,
        bands: countBy(log, 'band', ['strong', 'fair', 'weak']),
        guard: { blocked: log.filter(function (e) { return e.guard === 'blocked'; }).length, masked: log.filter(function (e) { return e.guard === 'masked'; }).length },
        validationFails: log.filter(function (e) { return !e.validation; }).length,
        feedback: { up: state.feedback.filter(function (f) { return f.vote === 'up'; }).length, down: state.feedback.filter(function (f) { return f.vote === 'down'; }).length },
        gaps: { total: gaps.length, open: gaps.filter(function (g) { return g.status === 'open'; }).length, drafted: gaps.filter(function (g) { return g.status === 'drafted'; }).length, fixed: gaps.filter(function (g) { return g.status === 'fixed'; }).length },
        changes: countBy(state.changes, 'status', STATUSES),
        actions: countBy(state.actions, 'status', ['proposed', 'written', 'rejected']),
        written: state.outbox.length,
        cost: { day: day(at), currency: cost.currency || 'USD', cap: cost.dailyCap == null ? null : cost.dailyCap, total: round(total, 6), byPersona: byPersona },
        drift: { alerts: alerts, sources: alerts.filter(function (a) { return a.kind === 'source'; }).length, answers: alerts.filter(function (a) { return a.kind === 'answer'; }).length, golden: alerts.filter(function (a) { return a.kind === 'golden'; }).length },
        freshness: fresh.map(function (f) { return { id: f.id, kind: f.kind, status: f.status, updated: f.updated, ageHours: f.ageHours, slaHours: f.slaHours }; }),
        sources: { total: report.sources.length, ok: report.sources.filter(function (s) { return s.ok; }).length, stale: report.sources.filter(function (s) { return s.status === 'stale'; }).map(function (s) { return s.id; }) },
        audit: (function () { var v = verify(); return { entries: v.total, ok: v.ok, head: v.head }; })(),
        evals: state.evalRuns.length ? state.evalRuns[state.evalRuns.length - 1] : null,
        retention: { logDays: settings().retention.logDays, purged: { log: state.tombstones.log, feedback: state.tombstones.feedback, audit: state.tombstones.audit }, purges: state.tombstones.purges.length }
      };
    });

    service.retention = method(function (args) {
      args = args || {};
      var at = clock(), days = args.days != null ? Number(args.days) : settings().retention.logDays;
      if (!(days >= 0)) throw err(400, 'days must be zero or more');
      var cutoff = iso(time(at) - days * 86400000);
      var limit = time(cutoff);
      function old(e) { return time(e.at) < limit; }
      var purged = { log: state.log.filter(old).length, feedback: state.feedback.filter(old).length, audit: state.audit.filter(old).length };
      state.log = state.log.filter(function (e) { return !old(e); });
      state.feedback = state.feedback.filter(function (e) { return !old(e); });
      var gone = state.audit.filter(old);
      if (gone.length) {
        // Entries are in time order, so the purged ones are a prefix: keep its last link as the anchor.
        var lastGone = gone[gone.length - 1];
        state.auditAnchor = { seq: lastGone.seq, hash: lastGone.hash, purged: (state.auditAnchor ? state.auditAnchor.purged : 0) + gone.length, at: at };
        state.audit = state.audit.slice(state.audit.indexOf(lastGone) + 1);
      }
      var t = state.tombstones;
      t.log += purged.log; t.feedback += purged.feedback; t.audit += purged.audit;
      t.purges.push({ at: at, cutoff: cutoff, log: purged.log, feedback: purged.feedback, audit: purged.audit });
      save('log', 'feedback', 'audit', 'auditAnchor', 'tombstones');
      audit(at, 'retention.purge', null, null, { cutoff: cutoff, days: days, purged: purged });
      return { at: at, days: days, cutoff: cutoff, purged: purged, kept: { log: state.log.length, feedback: state.feedback.length, audit: state.audit.length },
        tombstones: { log: t.log, feedback: t.feedback, audit: t.audit } };
    });

    // ---------------------------------------------------------------
    // Sources, graph, search, health, status, SQL, terms, lineage (A0, B1–B5, O3)
    // ---------------------------------------------------------------
    service.sources = method(function () {
      var report = MCX.build.report();
      var sources = report.sources.map(function (s) {
        var reg = MCX.build.source(s.id) || {};
        var out = clone(s);
        ['owner', 'location', 'residency', 'retention_days', 'freshness_hours', 'pii', 'access', 'tables', 'feeds'].forEach(function (k) { if (reg[k] !== undefined) out[k] = clone(reg[k]); });
        return out;
      });
      return { version: report.version, today: report.today, region: (MCX.config.engine || {}).region || 'us', kinds: report.kinds, flags: report.flags, sources: sources };
    });

    service.graph = method(function (args) {
      args = args || {};
      var g = MCX.build.graph();
      if (args.focus) {
        var near = MCX.build.neighbours(String(args.focus));
        if (!near.node) throw err(404, 'No node ' + args.focus + ' in the graph (ids look like term:drive-thru-time, table:GOLD.ORDER_TIMING_MART, doc:pre-staging-how-to)');
        return { focus: String(args.focus), node: near.node, edges: near.edges };
      }
      var types = countBy(g.nodes, 'type'), rels = countBy(g.edges, 'rel');
      return { nodes: g.nodes, edges: g.edges, counts: { nodes: g.nodes.length, edges: g.edges.length, types: types, relations: rels } };
    });

    service.search = method(function (args) {
      args = args || {};
      var q = String(args.q == null ? '' : args.q).trim();
      if (!q) throw err(400, 'q is required');
      var mode = args.mode || 'hybrid';
      if (['keyword', 'vector', 'hybrid'].indexOf(mode) === -1) throw err(400, 'mode must be keyword, vector or hybrid');
      var k = args.k == null || args.k === '' ? 5 : Math.max(1, Math.min(50, Number(args.k) || 5));
      var card = args.persona ? persona(args.persona) : null;
      var kinds = args.kinds ? String(args.kinds).split(',') : ['doc', 'work'];
      var hits = MCX.search.query(MCX.guard.mask(q), { mode: mode, k: 0, persona: card, kinds: kinds, keepExcluded: true });
      var r = repo();
      var shown = [], hidden = 0;
      hits.forEach(function (h) {
        var item = h.kind === 'doc' ? (r.knowledge || {})[h.id] : h.kind === 'work' ? (r.work || {})[h.id] : null;
        var source = item ? MCX.build.source(item.source) || {} : {};
        // Without a persona, only what everyone may see.
        var restricted = !card && item && ((item.access && item.access.length && item.access.indexOf('*') === -1) || (source.access && source.access.length && source.access.indexOf('*') === -1));
        if (h.excluded || restricted) { hidden++; return; }
        if (shown.length >= k) return;
        shown.push({ kind: h.kind, id: h.id, key: h.kind + ':' + h.id, title: h.title, heading: h.heading || null, system: h.system, source: h.source, date: h.date,
          channel: h.channel || null, snippet: MCX.guard.mask(h.snippet), masked: MCX.guard.findPii(h.snippet).length > 0, score: h.score, keyword: h.keyword, vector: h.vector });
      });
      return { q: MCX.guard.mask(q), mode: mode, k: k, persona: card ? card.id : null, hits: shown, filtered: hidden };
    });

    service.health = method(function () {
      var stats = MCX.db.stats || {}, report = MCX.build.report(), v = verify(), b = MCX.evals.bundle();
      return { ok: true, version: version(), mode: mode, storage: storage.kind,
        warehouse: { ready: MCX.db.isOpen(), rows: stats.rows, tables: (stats.tables || []).length, ops: MCX.db.query('SELECT COUNT(*) AS n FROM OPS.ACTION_LOG').rows[0].n },
        sources: { total: report.sources.length, ok: report.sources.filter(function (s) { return s.ok; }).length, stale: report.sources.filter(function (s) { return s.status === 'stale'; }).length },
        audit: { ok: v.ok, entries: v.total }, evals: { cases: b.set.length, golden: b.golden.length },
        overlay: { active: state.versions.active.length, skipped: service.skipped || [] } };
    });

    service.status = method(function () {
      return { warehouse: MCX.db.stats, context: MCX.context.stats(), library: MCX.context.library() };
    });

    var WRITES = /\b(insert|update|delete|drop|alter|create|attach|detach|pragma|replace|vacuum|reindex|analyze|begin|commit|rollback|savepoint|release|load_extension)\b/i;
    /** Read-only SQL. gold: only certified GOLD tables that have a semantic model (the certified-sources policy). */
    service.sql = method(function (args) {
      args = args || {};
      var sql = String(args.sql == null ? '' : args.sql).trim().replace(/;\s*$/, '');
      if (!sql) throw err(400, 'sql is required');
      var bare = sql.replace(/'(?:[^']|'')*'/g, "''").replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
      if (/;/.test(bare)) throw err(400, 'One statement only');
      if (!/^\s*(select|with)\b/i.test(bare)) throw err(400, 'Read-only: only SELECT (or WITH … SELECT) is allowed');
      if (WRITES.test(bare)) throw err(400, 'Read-only: ' + WRITES.exec(bare)[1].toUpperCase() + ' is not allowed');
      if (args.gold) {
        if (/\bsqlite_\w+/i.test(bare)) throw err(403, 'certified-sources policy: only GOLD tables');
        var other = /\b(BRONZE|OPS|main|temp)\s*\./i.exec(bare);
        if (other) throw err(403, 'certified-sources policy: ' + other[1].toUpperCase() + ' is not certified; only GOLD tables with a semantic model may be read');
        var tables = MCX.sem.tablesIn(bare.replace(/\bgold\s*\.\s*/gi, 'GOLD.'));
        if (!tables.length) throw err(400, 'Name the GOLD tables with their schema, e.g. GOLD.ORDER_TIMING_MART');
        tables.forEach(function (t) { if (!repo().models[t]) throw err(403, 'certified-sources policy: GOLD.' + t + ' has no semantic model'); });
      }
      var result;
      try { result = MCX.db.query(sql); } catch (error) { throw err(400, String(error.message).split('\n')[0]); }
      var max = Math.max(1, Math.min(1000, Number(args.limit) || 200));
      return { columns: result.columns, rows: result.rows.slice(0, max), total: result.rows.length, truncated: result.rows.length > max, ms: result.ms };
    });

    service.define = method(function (args) {
      args = args || {};
      var q = String(args.term == null ? '' : args.term).trim();
      if (!q) throw err(400, 'term is required');
      var g = repo().glossary, lower = q.toLowerCase();
      var id = g[q] ? q : Object.keys(g).filter(function (k) { return g[k].name.toLowerCase() === lower || (g[k].synonyms || []).indexOf(lower) !== -1; })[0];
      if (!id) { var m = MCX.context.matchTerms(q)[0]; id = m ? m.id : null; }
      if (!id) throw err(404, 'No glossary term matches “' + q + '”');
      var t = g[id], metrics = [];
      Object.keys(repo().models).forEach(function (name) {
        var model = repo().models[name];
        Object.keys(model.metrics).forEach(function (k) { if (model.metrics[k].term === id) metrics.push(model.schema + '.' + name + '.' + k); });
      });
      return { id: id, name: t.name, status: t.status, owner: t.owner, synonyms: t.synonyms || [], maps_to: t.maps_to || null, not: t.not || null,
        resolves: t.resolves || null, definition: t.body, metrics: metrics, file: t.file };
    });

    service.lineage = method(function (args) {
      args = args || {};
      if (args.table) {
        var found = MCX.build.sourceOfTable(String(args.table));
        if (!found.source) throw err(404, 'No registered source holds ' + args.table);
        return { table: String(args.table), source: { id: found.source.id, name: found.source.name, system: found.source.system },
          upstream: found.upstream.map(function (u) { return { id: u.id, name: u.name, system: u.system }; }) };
      }
      var card = persona(args.persona, 'persona');
      var question = String(args.question == null ? '' : args.question).trim();
      if (!question) throw err(400, 'question (or table) is required');
      var input = { persona: card.id, question: question };
      if (args.slug) input.slug = String(args.slug);
      var result = MCX.engine.ask(input);
      return { question: result.pack.question, route: result.route.kind, analysis: result.plan.name, version: result.version,
        findings: result.context.marks.filter(function (m) { return m.good != null; }).map(function (m) { return { text: m.good, from: m.from, lineage: m.lineage }; }),
        facts: (result.facts || []).map(function (f) { return { key: f.key, title: f.title, system: f.system, date: f.date, lineage: f.lineage }; }) };
    });

    // ---------------------------------------------------------------
    // Keep fresh (B4): the Node server calls this when context/ changes
    // ---------------------------------------------------------------
    service.reload = method(function (repository) {
      var at = clock(), before = version();
      if (mode === 'overlay') { base = clone(repository || base); rebuildLive(); }
      else { base = repository || base; MCX.contextRepo = base; MCX.engine.invalidate(); }
      evalCache = {};
      if (version() === before && version() === state.versions.current) return { changed: false, version: before };
      noteVersion(at, 'reload', { note: 'context/ changed on disk' });
      audit(at, 'context.reload', null, version(), { previous: before });
      return { changed: true, version: version(), previous: before };
    });

    service.ready = ready;
    service.mode = mode;
    service.settings = settings;
    return service;
  }

  MCX.createService = create;
  MCX.ServiceError = err;

  // In the page: one service over localStorage, started with the engine.
  if (global.document && !MCX.service) {
    MCX.service = create({ storage: MCX.storage.local('mcx.service.'), mode: 'overlay' });
    /** Save the deployed changes as a JSON file (node tools/lifecycle.js apply <file> writes them into context/). */
    MCX.service.downloadChanges = function () {
      return MCX.service.exportChanges().then(function (data) {
        var blob = new global.Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
        var a = global.document.createElement('a');
        a.href = global.URL.createObjectURL(blob);
        a.download = 'mccontext-changes-' + String(data.current || 'context') + '.json';
        global.document.body.appendChild(a);
        a.click();
        setTimeout(function () { global.URL.revokeObjectURL(a.href); a.remove(); }, 0);
        return data;
      });
    };
    global.addEventListener('load', function () {
      setTimeout(function () {
        MCX.service.ready().catch(function (error) { if (global.console) global.console.warn('The context service did not start: ' + error.message); });
      }, 0);
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
