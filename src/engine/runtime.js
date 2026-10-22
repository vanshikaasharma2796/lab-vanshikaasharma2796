/* =====================================================================
   src/engine/runtime.js — running one question, live

   MCX.engine.ask({ persona, question }) answers a question twice:

     context   The context layer picks the persona, glossary terms,
               skills and semantic models the question needs. An
               analysis (src/analyses/) then follows the skill: every
               number comes from a query compiled from the semantic
               models and run on the certified GOLD tables.
     bare      The same warehouse with no context: only the raw BRONZE
               tables and their column names (src/engine/bare.js).

   Nothing is scripted. The reasoning lines, SQL, row counts and figures
   in both answers are produced when the question is asked. What comes
   back is a pair of transcripts in the same format as the recorded
   replays in data/, so the page plays both the same way.

   An analysis is registered with MCX.analysis(name, { ... run(ctx) }).
   The ctx it receives is described in docs/ENGINE.md.

   Context engine v2, on the context side only (the bare analyst is
   unchanged): guard -> route decision -> assemble (instructions,
   memory, facts, tools, cost) -> execute inside engine.bounds ->
   "also relevant" paragraph -> actions -> validate (fallback on
   failure) -> lineage per finding -> quality. See docs/CONTEXT-ENGINE.md.
   ===================================================================== */
(function (global) {
  'use strict';
  var MCX = (global.MCX = global.MCX || {});

  MCX.analyses = MCX.analyses || {};
  /** Register an analysis: the executable half of a skill. */
  MCX.analysis = function (name, def) { def.name = name; MCX.analyses[name] = def; return def; };

  function settings() { return (MCX.config && MCX.config.engine) || {}; }
  function round(x, digits) { return MCX.fmt.round(x, digits); }
  /** An analysis that runs past engine.bounds is stopped; validation then replaces its answer. */
  function boundError(what) { var e = new Error('execution bound: ' + what); e.bound = true; return e; }

  // -------------------------------------------------------------------
  // The answer being written
  // -------------------------------------------------------------------
  function Writer() { this.blocks = []; this.marks = []; }
  /** A paragraph. */
  Writer.prototype.p = function (text) { this.blocks.push(String(text)); return this; };
  /** Bulleted lines kept together. Pass numbered: true for 1. 2. 3. */
  Writer.prototype.list = function (items, numbered) {
    var lines = items.filter(function (x) { return x != null && x !== ''; });
    this.blocks.push(lines.map(function (line, i) { return (numbered ? (i + 1) + '. ' : '• ') + line; }).join('\n'));
    return this;
  };
  /** A lead-in line followed directly by bullets. */
  Writer.prototype.listed = function (lead, items, numbered) {
    var lines = items.filter(function (x) { return x != null && x !== ''; });
    this.blocks.push(lead + '\n' + lines.map(function (line, i) { return (numbered ? (i + 1) + '. ' : '• ') + line; }).join('\n'));
    return this;
  };
  Writer.prototype.text = function () { return this.blocks.join('\n\n'); };

  // -------------------------------------------------------------------
  // One side of one run
  // -------------------------------------------------------------------
  function Run(side, input) {
    this.side = side;
    this.persona = input.persona;
    this.question = input.question;
    this.intent = input.intent;
    this.fmt = MCX.fmt;
    this.steps = [];
    this.queries = {};          // key -> { sql, models, metrics, rows }
    this.answer = new Writer();
    this.facts = {};            // anything an analysis wants to hand back (tools/ask.js prints it)
    this.execution = { queries: 0, rows: 0 };
    if (side === 'context') {
      this.pack = input.pack;
      this.scope = input.scope;
      this.time = input.time;
      this.focus = input.focus || null;
      this.who = wording(input.scope);
      this.regionProxy = null;
    } else {
      this.user = { name: input.persona.name, first: input.persona.name.split(' ')[0], role: input.persona.role };
    }
  }

  /** A reasoning line. */
  Run.prototype.say = function (text, options) {
    var step = { say: String(text) };
    if (options && options.hold) step.hold = true;
    this.steps.push(step);
    return this;
  };

  /**
   * Run a query and return its rows.
   *   key    short unique name; answers cite it as 'query:<key>'
   *   what   a compile spec for the semantic layer (context side), or SQL text
   *   say    optional reasoning line shown before the query
   */
  Run.prototype.q = function (key, what, say) {
    if (this.queries[key]) throw new Error('Query key used twice: ' + key);
    var compiled = typeof what === 'string' ? { sql: MCX.script.dedent(what), models: [], metrics: [] } : this.compile(what);
    var sql = compiled.sql;
    if (this.side === 'context') {
      // certified-sources policy, enforced: GOLD only, and only tables that have a semantic model.
      if (/\bBRONZE\./i.test(sql)) throw new Error('certified-sources policy: a context-side query may not read BRONZE (' + key + ')');
      if (typeof what === 'string') compiled.models = MCX.sem.tablesIn(sql);
      var self = this;
      compiled.models.forEach(function (name) { self.model(name); });
    } else if (/\bGOLD\./i.test(sql)) {
      throw new Error('The bare analyst has no access to GOLD (' + key + ')');
    }
    var bounds = this.side === 'context' ? settings().bounds || {} : {};
    if (bounds.maxQueries && this.execution.queries >= bounds.maxQueries) throw boundError('more than ' + bounds.maxQueries + ' queries (' + key + ')');
    if (say) this.say(say);
    var result = MCX.db.query(sql);
    this.execution.queries++;
    this.execution.rows += result.rows.length;
    if (bounds.maxRows && this.execution.rows > bounds.maxRows) throw boundError('more than ' + bounds.maxRows + ' rows read (' + key + ')');
    var keep = settings().resultRows || 8;
    this.steps.push({
      sql: sql, key: key, rows: result.rows.length, cols: result.columns.map(function (c) { return c.toUpperCase(); }).join(', '),
      ms: round(result.ms, 2),
      result: { columns: result.columns, rows: result.rows.slice(0, keep).map(function (row) { return result.columns.map(function (c) { return row[c]; }); }), total: result.rows.length }
    });
    this.queries[key] = { sql: sql, models: compiled.models, metrics: compiled.metrics, rows: result.rows.length };
    return result.rows;
  };
  /** The first row of a query (or an empty object). */
  Run.prototype.one = function (key, what, say) { return this.q(key, what, say)[0] || {}; };

  Run.prototype.compile = function (spec) {
    if (this.side !== 'context') throw new Error('The bare analyst has no semantic layer: write the SQL');
    return MCX.sem.compile(spec, this);
  };

  // ---- Context access (context side only) --------------------------------------
  Run.prototype.load = function (kind, id, why, meta) {
    if (this.side !== 'context') throw new Error('The bare analyst has no context layer (' + kind + ' ' + id + ')');
    var list = { term: this.pack.terms, skill: this.pack.skills, model: this.pack.models, policy: this.pack.policies }[kind];
    var item = list.filter(function (i) { return i.id === id; })[0];
    if (!item && kind === 'policy' && this.pack.instructions && this.pack.instructions.id === id) item = this.pack.instructions;
    var shown = this.steps.some(function (s) { return s[kind] === id; });
    if (!item) item = MCX.context.extend(this.pack, kind, id, why);
    if (!shown && (kind !== 'policy' || why)) this.steps.push(loadStep(item, meta));
    return item;
  };
  /** A glossary term: { name, maps_to, not, resolves, body, ... } */
  Run.prototype.term = function (id) { this.load('term', id, 'the analysis needed the definition'); return MCX.contextRepo.glossary[id]; };
  /** A skill, with its numbers in .params */
  Run.prototype.skill = function (id, meta) { this.load('skill', id, 'the analysis needed the playbook', meta); return MCX.contextRepo.skills[id]; };
  Run.prototype.params = function (id) { return this.skill(id).params; };
  Run.prototype.model = function (id) { this.load('model', id, 'a query was compiled from it'); return MCX.contextRepo.models[id]; };
  /** Apply a policy and say so in the trace. */
  Run.prototype.policy = function (id, say) {
    this.load('policy', id, 'applied');
    if (say) this.say(say);
    return MCX.contextRepo.policies[id];
  };
  /** How this reader likes to be answered (from the voice-and-tone skill). */
  Run.prototype.voice = function () {
    this.load('skill', 'voice-and-tone', 'to word the answer for this reader', 'purpose: voice');
    var audiences = MCX.contextRepo.skills['voice-and-tone'].params.audiences;
    return audiences[this.persona.voice] || audiences.analyst;
  };

  // ---- Highlighted phrases ------------------------------------------------------
  /** A phrase the answer can stand behind. Sources: 'persona', a query key, or 'skill:x' / 'glossary:x' / 'model:X' / 'policy:x'. */
  Run.prototype.g = function (text) {
    this.answer.marks.push({ good: String(text), from: Array.prototype.slice.call(arguments, 1) });
    return text;
  };
  /** A phrase that is a guess or a gap. */
  Run.prototype.b = function (text) { this.answer.marks.push({ bad: String(text) }); return text; };

  // -------------------------------------------------------------------
  // Words for whose stores these are
  // -------------------------------------------------------------------
  function wording(scope) {
    var cap = MCX.fmt.cap, w = { you: !!scope.own, poss: scope.poss, Poss: cap(scope.poss), name: scope.name, Name: cap(scope.name) };
    w.stores = scope.label;                                   // "your 14 Southeast stores"
    w.Stores = cap(scope.label);
    w.portfolio = scope.kind === 'operator' ? scope.poss + ' portfolio' : scope.kind === 'region' ? 'the ' + scope.region : scope.kind === 'store' ? scope.store : 'the network';
    w.their = scope.own ? 'your' : scope.kind === 'operator' ? 'their' : 'its';
    return w;
  }

  // -------------------------------------------------------------------
  // The trace
  // -------------------------------------------------------------------
  function loadStep(item, meta) {
    var step = { file: item.file, detail: item.text, tokens: item.tokens };
    step[item.kind] = item.id;
    if (meta) step.meta = meta;
    else if (item.kind === 'term' && item.match) step.meta = 'status: certified, matched: “' + item.match + '”';
    else if (item.kind === 'skill') step.meta = 'owner: ' + MCX.contextRepo.skills[item.id].owner;
    else if (item.kind === 'policy') step.meta = 'owner: ' + MCX.contextRepo.policies[item.id].owner;
    return step;
  }

  function scopeLine(card, scope) {
    var lead = "Resolved who's asking from the persona — ";
    if (scope.own) return lead + 'scoped automatically to ' + scope.label + '. Never had to ask.';
    var sees = card.name + ', ' + card.role + ', sees every store';
    if (scope.kind === 'operator') return lead + sees + '. The question names ' + scope.operator + ', so it is scoped to those ' + scope.stores + ' ' + scope.regionOf + ' stores.';
    if (scope.kind === 'region') return lead + sees + '. The question names the ' + scope.region + ', so it is scoped to its ' + scope.stores + ' stores.';
    if (scope.kind === 'store') return lead + sees + '. The question names ' + scope.store + ', so it is scoped to that store.';
    return lead + card.name + ', ' + card.role + ': network-wide, all ' + scope.stores + ' stores in ' + MCX.fmt.word(scope.regions) + ' regions. Never had to ask.';
  }

  function announce(skill) {
    var labels = (skill.params && skill.params.step_labels) || {};
    var steps = (skill.steps || []).map(function (s) { return labels[s] || s; }).join(' → ');
    return String(skill.announce || '').replace('{steps}', steps);
  }

  function guardStep(guard) {
    var findings = guard.findings.map(function (f) { return f.rule + ' (' + f.severity + '): ' + f.text; });
    return { guard: guard.verdict, meta: guard.verdict === 'pass' ? 'no findings' : guard.findings.map(function (f) { return f.rule; }).join(', '),
      detail: guard.verdict === 'pass' ? 'Checked for prompt injection, SQL and script injection, bulk personal data, credentials and personal data in the question. Nothing found.' : findings.join('\n') + (guard.verdict === 'masked' ? '\nThe question goes on with the personal data masked: ' + guard.clean : '') };
  }

  function routeStep(route, decision) {
    var label = decision.executor + (decision.executor === 'model' ? ' (' + (decision.model || 'not connected') + ') → ' + (decision.fallback || 'fallback') : '');
    return { route: label, meta: 'rule: ' + decision.rule + ', route: ' + route.kind, detail: (decision.what ? decision.what + '.\n' : '') + 'Why: ' + route.why };
  }

  function factStep(fact) {
    var step = { label: fact.title, meta: fact.system + ', ' + fact.date + (fact.masked ? ', personal data masked' : ''), file: fact.file, detail: fact.text, tokens: fact.tokens };
    step[fact.kind] = fact.id;
    return step;
  }

  function opening(run) {
    var pack = run.pack, r = MCX.contextRepo;
    run.steps.push(guardStep(run.guard));
    if (run.guard.verdict === 'masked') run.say('The question carries personal data. Masked it before anything else reads it: “' + run.guard.clean + '”.');
    if (pack.instructions) run.steps.push({ policy: 'pinned-instructions', meta: 'always first, never compacted', file: pack.instructions.file, detail: pack.instructions.text, tokens: pack.instructions.tokens });
    // "Marcus J. Williams · 14 Southeast stores" for an operator; "Priya · Store Ops · all 104 stores" for a corporate role.
    var card = run.persona, scope = pack.scope;
    var who = scope.own ? scope.chip : card.name + ' · ' + card.role + ' · ' + (scope.kind === 'network' ? 'all ' + scope.stores + ' stores' : 'scoped to ' + (scope.operator || scope.store || 'the ' + scope.region));
    run.steps.push({ persona: who, meta: 'scope: ' + scope.kind + ', stores: ' + scope.stores, file: pack.persona.file, detail: pack.persona.text, tokens: pack.persona.tokens });
    run.say(scopeLine(run.persona, pack.scope));
    run.steps.push(routeStep(run.route, run.decision));
    if (run.route.kind === 'blocked') return;            // nothing else is loaded for a blocked question
    (pack.facts || []).forEach(function (fact) { run.steps.push(factStep(fact)); });
    if (pack.memory && pack.memory.turns.length) {
      run.steps.push({ memory: pack.memory.turns.length + (pack.memory.turns.length === 1 ? ' earlier turn' : ' earlier turns'), meta: 'this session', detail: pack.memory.text, tokens: pack.memory.tokens });
      if (run.route.followUp) run.say('Read this as a follow-up to “' + run.route.followUp.from + '”, from the session memory.');
    }
    pack.terms.forEach(function (item) {
      run.steps.push(loadStep(item));
      if (item.narrate) run.say(r.glossary[item.id].resolves, { hold: true });
    });
    pack.skills.forEach(function (item) {
      run.steps.push(loadStep(item));
      if (item.narrate) run.say(announce(r.skills[item.id]), { hold: !!r.skills[item.id].hold });
    });
    pack.models.forEach(function (item) { run.steps.push(loadStep(item)); });
  }

  // ---- Lineage: every source a finding rests on, back to the system it came from ----------
  function sourceRef(id) {
    var s = MCX.build.source(id);
    return { source: id, system: s ? s.system : null };
  }
  function tableRef(table) {
    var found = MCX.build.sourceOfTable(table);
    var out = { table: table, source: found.source ? found.source.id : null, system: found.source ? found.source.system : null };
    if (found.upstream.length) out.upstream = found.upstream.map(function (u) { return { source: u.id, system: u.system }; });
    return out;
  }
  function merge(base, extra) { Object.keys(extra).forEach(function (k) { base[k] = extra[k]; }); return base; }

  /** One cited key -> { step, kind, id, model?, table?, source, system, upstream? } */
  function lineageOf(run, key) {
    var r = MCX.contextRepo;
    if (key === 'persona') return merge({ step: key, kind: 'persona', id: run.persona.id }, sourceRef('session'));
    var at = key.indexOf(':'), kind = at === -1 ? key : key.slice(0, at), id = at === -1 ? key : key.slice(at + 1);
    if (kind === 'query') {
      var q = run.queries[id] || { models: [] }, model = q.models[0] || null;
      var out = { step: key, kind: 'query', id: id, model: model };
      return model && r.models[model] ? merge(out, tableRef(r.models[model].schema + '.' + model)) : merge(out, { table: null, source: null, system: null });
    }
    if (kind === 'model') return merge({ step: key, kind: 'model', id: id, model: id }, tableRef((r.models[id] ? r.models[id].schema : 'GOLD') + '.' + id));
    if (kind === 'glossary') return merge({ step: key, kind: 'term', id: id }, sourceRef('context-repo'));
    if (kind === 'skill' || kind === 'policy') return merge({ step: key, kind: kind, id: id }, sourceRef('context-repo'));
    if (kind === 'doc') return merge({ step: key, kind: 'doc', id: id }, sourceRef(r.knowledge[id] ? r.knowledge[id].source : null));
    if (kind === 'work') return merge({ step: key, kind: 'work', id: id }, sourceRef(r.work[id] ? r.work[id].source : null));
    return merge({ step: key, kind: kind, id: id }, sourceRef('session'));       // guard, route, memory, validate
  }

  // ---- Provenance: tidy the sources behind each highlighted phrase ---------------------
  function finishMarks(run) {
    var keys = {};
    run.steps.forEach(function (step) {
      var tool = MCX.script.describeTool(step);
      if (tool) keys[tool.key] = true;
    });
    var problems = [];
    var text = run.answer.text();
    var marks = run.answer.marks.map(function (mark) {
      var phrase = mark.good != null ? mark.good : mark.bad;
      if (text.indexOf(phrase) === -1) problems.push('highlighted phrase is not in the answer: "' + phrase + '"');
      if (mark.good == null) return { bad: mark.bad };
      var from = [];
      function cite(key) { if (keys[key] && from.indexOf(key) === -1) from.push(key); }
      (mark.from || []).forEach(function (source) {
        var key = source;
        if (source !== 'persona' && source.indexOf(':') === -1 && ['guard', 'route', 'memory', 'validate'].indexOf(source) === -1) key = 'query:' + source;
        key = key.replace(/^term:/, 'glossary:');
        if (!keys[key]) { problems.push('"' + phrase + '" cites something that was never loaded or run: ' + source); return; }
        cite(key);
      });
      // Lineage: a cited query brings the model it was compiled from and the terms behind its metrics.
      from.slice().forEach(function (key) {
        var query = key.indexOf('query:') === 0 && run.queries[key.slice(6)];
        if (!query) return;
        if (query.models[0]) cite('model:' + query.models[0]);
        (query.metrics || []).slice(0, 4).forEach(function (m) { if (m.term && from.length < 6) cite('glossary:' + m.term); });
      });
      return run.side === 'context' ? { good: mark.good, from: from } : { good: mark.good };
    });
    // The wording of the lead finding follows the voice skill, when one was loaded.
    var voice = 'skill:voice-and-tone', lead = marks.filter(function (m) { return m.good != null && m.from; })[0];
    if (lead && keys[voice] && !marks.some(function (m) { return m.from && m.from.indexOf(voice) !== -1; })) lead.from.push(voice);
    if (run.side === 'context') marks.forEach(function (m) { if (m.from) m.lineage = m.from.map(function (key) { return lineageOf(run, key); }); });
    return { marks: marks, problems: problems };
  }

  function transcript(run) {
    var done = finishMarks(run);
    return { steps: run.steps, answer: run.answer.text(), marks: done.marks, problems: done.problems, facts: run.facts };
  }

  // ---- "Also relevant": the strongest fact from knowledge or work, in one short paragraph -----
  function alsoRelevant(run) {
    var threshold = settings().alsoRelevant;
    if (threshold == null || run.stopped) return;
    if (['blocked', 'out-of-scope'].indexOf(run.route.kind) !== -1) return;
    // A fact about the same glossary terms as the question; with no certified answer at all, any fact this close.
    var none = run.route.kind === 'none';
    var best = (run.pack.facts || []).filter(function (f) { return (none || (f.terms && f.terms.length)) && f.vector >= threshold; })[0];
    if (!best) return;
    var where = best.kind === 'doc'
      ? 'from the ' + best.system + ' page “' + best.title + '” (updated ' + MCX.fmt.date(best.date) + ')'
      : 'from ' + best.system + ' ' + best.channel + ' (' + MCX.fmt.date(best.date) + ')';
    run.answer.p('Also relevant, ' + where + ': ' + run.g('“' + best.snippet + '”', best.key));
    run.alsoRelevant = best.key;
  }

  // ---- Validation fallback ------------------------------------------------------------------
  function fallback(t, validation) {
    var failed = validation.checks.filter(function (c) { return !c.ok; }).map(function (c) { return c.failed || c.label; });
    var phrase = 'It was checked before it reached you, and ' + failed.join('; ');
    validation.withheld = { answer: t.answer, marks: t.marks };
    validation.fallback = true;
    t.answer = "I can't give you this answer. " + phrase + '. Nothing was written anywhere and no action was proposed; the full answer is kept for review.';
    t.marks = [{ good: phrase, from: ['validate'], lineage: [{ step: 'validate', kind: 'validate', id: 'validate', source: 'session', system: (MCX.build.source('session') || {}).system || null }] }];
  }

  // -------------------------------------------------------------------
  // Asking
  // -------------------------------------------------------------------
  /** Build the warehouse if it is not built yet. */
  function ready() { return MCX.db.isOpen() ? Promise.resolve(MCX.db.stats) : MCX.db.open(); }

  /** Drop every cache that depends on the context repository (call after changing MCX.contextRepo). */
  function invalidate() {
    if (MCX.build) MCX.build.reset();
    if (MCX.search) MCX.search.reset();
    if (MCX.context && MCX.context.reset) MCX.context.reset();
  }

  /**
   * input: { persona: 'marcus', question: 'Why is ...?', slug?: catalog slug, bucket?: question type,
   *          history?: [{ question, analysis, answer }] earlier turns of this session }
   * returns { route, plan, intent, pack, context, bare, ms,
   *           guard, decision, facts, validation, actions, quality, cost, version, build, execution }
   */
  function ask(input) {
    var started = Date.now();
    var card = MCX.contextRepo.personas[input.persona];
    if (!card) throw new Error('No persona called ' + input.persona + ' in the context repository');
    var raw = String(input.question || '').trim();
    var history = Array.isArray(input.history) ? input.history : [];

    // Guard first. A blocked question goes to the "blocked" analysis; personal data is masked.
    var guard = MCX.guard.check(raw);
    var question = guard.clean;
    var route;
    if (guard.verdict === 'blocked') route = MCX.router.blocked(guard);
    else {
      route = MCX.router.route(card, question, input.slug);
      // A follow-up is read together with the turn before it, from the session memory.
      if (history.length && !input.slug && (route.kind === 'none' || MCX.router.looksLikeFollowUp(question))) route = MCX.router.followUp(card, question, history) || route;
    }
    var asked = route.followUp ? route.followUp.question : question;
    var plan = MCX.analyses[route.analysis];
    if (!plan) throw new Error('No analysis called ' + route.analysis);
    var intent = input.bucket || plan.intent || MCX.text.intentOf(asked);
    var time = MCX.sem.anchors();
    var decision = MCX.router.decide(route, guard, intent);

    var named = card.scope.kind === 'operator' ? null : MCX.sem.findEntity(asked);
    var want = route.want || (plan.scope === 'network' ? { kind: 'network' } : typeof plan.scope === 'function' ? plan.scope(card, asked) : null);
    var scope = MCX.sem.resolveScope(card, asked, want);
    var pack = MCX.context.assemble({ persona: card, question: asked, intent: intent, scope: scope, time: time, plan: plan, history: history, blocked: route.kind === 'blocked' });

    var context = new Run('context', { persona: card, question: asked, intent: intent, pack: pack, scope: scope, time: time, focus: named });
    context.route = route;
    context.guard = guard;
    context.decision = decision;
    opening(context);
    try {
      plan.run(context);
    } catch (error) {
      if (!error.bound) {
        error.message = 'Analysis ' + plan.name + ' failed: ' + error.message;
        throw error;
      }
      context.stopped = error.message;
      context.say('Stopped: ' + error.message + '. The answer will not be given.');
    }
    alsoRelevant(context);

    // Validate, then propose actions (each waits for a decision; high impact for a human check).
    var actions = context.stopped ? [] : MCX.actions.propose(plan, context);
    var validateStep = { validate: 'checking', meta: '', detail: '' };
    context.steps.push(validateStep);
    var actionSteps = actions.map(function (a) {
      return { action: a.id, label: a.title, meta: a.system + ' ' + a.type + ', ' + a.impact + ' impact' + (a.needsApproval ? ', waiting for a human check (' + a.approverRole + ')' : ', the asker can approve it'), detail: a.detail + '\nWhy: ' + a.why };
    });
    actionSteps.forEach(function (s) { context.steps.push(s); });
    var contextSide = transcript(context);
    var execution = { queries: context.execution.queries, rows: context.execution.rows, bounds: settings().bounds || null, stopped: context.stopped || null };
    var validation = MCX.validate.check({ run: context, transcript: contextSide, pack: pack, persona: card, actions: actions, route: route, guard: guard, execution: execution, question: raw });
    validateStep.validate = validation.ok ? 'passed' : 'failed';
    validateStep.meta = validation.checks.filter(function (c) { return c.ok; }).length + ' of ' + validation.checks.length + ' checks passed';
    validateStep.detail = validation.checks.map(function (c) { return (c.ok ? '✓ ' : '✗ ') + c.label + (c.detail ? ' — ' + c.detail : ''); }).join('\n');
    if (!validation.ok) {
      fallback(contextSide, validation);
      validation.withheld.actions = actions;
      actions = [];
      contextSide.steps = contextSide.steps.filter(function (s) { return actionSteps.indexOf(s) === -1; });
    }

    // The analyst without context: unchanged. A blocked question is still run there, as typed.
    var bareRoute = route, barePlan = plan, bareIntent = intent;
    if (route.kind === 'blocked') {
      bareRoute = MCX.router.route(card, raw, input.slug);
      barePlan = MCX.analyses[bareRoute.analysis];
      bareIntent = input.bucket || barePlan.intent || MCX.text.intentOf(raw);
    }
    var bare = new Run('bare', { persona: card, question: raw, intent: bareIntent });
    bare.route = bareRoute;
    try {
      MCX.bare.run(bare, barePlan, bareRoute);
    } catch (error) {
      error.message = 'Bare analyst failed on ' + barePlan.name + ': ' + error.message;
      throw error;
    }

    var result = { route: route, plan: { name: plan.name, title: plan.title }, intent: intent, pack: pack,
      context: contextSide, bare: transcript(bare), ms: Date.now() - started };
    result.guard = guard;
    result.decision = decision;
    result.facts = pack.facts;
    result.validation = validation;
    result.actions = actions;
    result.cost = pack.cost;
    result.version = MCX.build.version();
    result.build = MCX.build.summary();
    result.execution = execution;
    result.quality = MCX.quality.score(result);
    return result;
  }

  MCX.engine = { ready: ready, ask: ask, Run: Run, Writer: Writer, lineageOf: lineageOf, invalidate: invalidate };
})(typeof window !== 'undefined' ? window : globalThis);
