/* =====================================================================
   src/engine/context.js — assembling the context for one question

   The context repository (context/) holds everything the business has
   written down: who people are, what its words mean, how its analyses
   are done, what its certified tables contain and the rules every
   answer follows. No question needs all of it.

   assemble() picks what this question needs and fits it into a token
   budget:

     1. the persona card of whoever is asking, and the scope it implies
     2. glossary terms whose wording appears in the question, plus any
        the chosen playbook depends on
     3. the skills (playbooks) the analysis follows
     4. the semantic models its queries are compiled from
     5. the policies in force

   If the pack is over budget, cards are compacted to their definitions
   and numbers (prose dropped) before anything optional is left out. The
   result records what was loaded, why, at what size, and what was not.

   Context engine v2 adds, each with a budget of its own so the
   compaction above never moves:

     instructions  the pinned-instructions policy, always first
     memory        the last two turns of this session, one line each
     facts         up to two knowledge pages and two work threads,
                   found by hybrid search (src/engine/search.js),
                   filtered by access, residency, retention and status,
                   personal data masked, within engine.factsBudget;
                   what was found and not used goes to leftOut with
                   the reason (access, residency, retention, draft,
                   threshold, limit, budget)
     tools         what this request may use (semantic SQL, glossary
                   lookup, search, action proposals)
     cost          tokens handed over x engine.cost.perThousand

   MCX.context.assemble(input) -> pack        MCX.context.stats() -> repository totals
   ===================================================================== */
(function (global) {
  'use strict';
  var MCX = (global.MCX = global.MCX || {});

  function repo() { return MCX.contextRepo; }
  function count(text) { return MCX.text.tokenCount(text); }
  function firstSentence(text) { var m = /^[\s\S]*?[.!?](?=\s|$)/.exec(String(text || '').trim()); return m ? m[0] : String(text || '').trim(); }
  function bodyOf(item) { return String(item.body || '').replace(/^#\s.*\n+/, '').trim(); }

  // -------------------------------------------------------------------
  // How each kind of context is written into the pack
  // -------------------------------------------------------------------
  function personaText(card, scope) {
    var lines = [card.name + ' — ' + card.role + '. ' + card.blurb];
    lines.push('Sees: ' + (card.scope.kind === 'operator' ? 'their own stores only' : 'every store') + '. This question: ' + scope.chip + '.');
    if (card.owns && card.owns.length) lines.push('Owns: ' + card.owns.join('; ') + '.');
    lines.push('Cares about: ' + card.cares_about.join('; ') + '.');
    lines.push('Answer style: ' + card.answer_style);
    return lines.join('\n');
  }

  function termText(term, detail) {
    var head = term.name + ' — ' + term.status + ', owner ' + term.owner + '\nMeans: ' + term.maps_to + (term.not ? '\nNot: ' + term.not : '');
    if (detail === 'brief') return head + '\n' + firstSentence(term.body);
    return head + '\n' + bodyOf(term);
  }

  function skillText(skill, detail) {
    var head = skill.title + ' (' + skill.name + ') — owner ' + skill.owner + '\n' + skill.description;
    var steps = skill.steps && skill.steps.length ? '\nSteps: ' + skill.steps.join(' → ') : '';
    var params = Object.keys(skill.params || {}).length ? '\nNumbers: ' + JSON.stringify(skill.params) : '';
    if (detail === 'brief') return head + steps + params;
    return head + '\n' + bodyOf(skill) + params;
  }

  function modelText(model, detail) {
    var lines = [model.schema + '.' + model.name + ' (alias ' + model.alias + ') — certified, owner ' + model.owner,
      'Grain: ' + model.grain + '. ' + model.description];
    var joins = Object.keys(model.joins || {});
    if (joins.length) lines.push('Joins: ' + joins.map(function (j) { return j + ' ' + model.joins[j]; }).join('; '));
    lines.push('Dimensions: ' + Object.keys(model.dimensions).join(', '));
    lines.push('Metrics:');
    Object.keys(model.metrics).forEach(function (name) { lines.push('  ' + name + ' = ' + model.metrics[name].sql); });
    if (detail !== 'brief') {
      lines.push('Columns:');
      model.columns.forEach(function (c) { lines.push('  ' + c.name + ' ' + c.type + (c.description ? ' — ' + c.description : '')); });
    }
    return lines.join('\n');
  }

  function policyText(policy) { return policy.name + ' — owner ' + policy.owner + '\n' + policy.body; }

  function factText(f) {
    var where = f.kind === 'doc' ? f.system + ' page “' + f.title + '”, updated ' + f.date : f.system + ' ' + f.channel + ', “' + f.title + '”, ' + f.date;
    return '[' + f.key + '] ' + where + ' (source: ' + f.lineage.source + ')\n“' + f.snippet + '”';
  }
  function pageText(page) {
    return page.title + ' — ' + page.system + ', owner ' + page.owner + ', updated ' + page.updated + ', ' + page.status +
      '\nAccess: ' + (page.access || ['*']).join(', ') + '. Terms: ' + (page.terms || []).join(', ') + '.\n' + bodyOf(page);
  }
  function threadText(t) {
    return t.title + ' — ' + t.system + ' ' + t.channel + ', ' + t.date + ', residency ' + t.residency + '\nAccess: ' + (t.access || ['*']).join(', ') + '.\n' +
      t.messages.map(function (m) { return m.at + ' ' + m.from + ': ' + m.text; }).join('\n');
  }

  function settings() { return (MCX.config && MCX.config.engine) || {}; }

  // -------------------------------------------------------------------
  // Facts from knowledge and work: hybrid retrieval, filtered and masked
  // -------------------------------------------------------------------
  var FACT_LIMITS = { doc: 2, work: 2 };
  var REASONS = { access: 'access', residency: 'residency', retention: 'retention', draft: 'draft' };

  function sharedWords(question, snippetText) {
    var q = MCX.text.tokens(question), s = MCX.text.tokens(snippetText), out = [];
    q.forEach(function (w) { if (s.indexOf(w) !== -1 && out.indexOf(w) === -1) out.push(w); });
    return out;
  }

  /** Glossary terms each page or thread is linked to by the build (its tags plus synonyms found in it). */
  function termsByItem() {
    var out = {};
    MCX.build.mapMeaning().links.forEach(function (l) { (out[l.kind + ':' + l.id] = out[l.kind + ':' + l.id] || []).push(l.term); });
    return out;
  }

  /**
   * Retrieve facts for a question: at most two approved knowledge pages and two work threads,
   * each as its best one or two sentences. Candidates come from hybrid search; a candidate is a fact
   * when it shares a glossary term with the question and is close in meaning (vector >= factsMin),
   * or is very close in meaning without one (vector >= alsoRelevant). Returns { facts, leftOut, tokens, budget }.
   */
  function retrieveFacts(question, card, options) {
    var cfg = settings(), budget = cfg.factsBudget || 700, min = cfg.factsMin != null ? cfg.factsMin : 0.35;
    var strong = cfg.alsoRelevant != null ? cfg.alsoRelevant : 0.55;
    var region = cfg.region || 'us';
    var asked = matchTerms(question).map(function (m) { return m.id; });
    var linked = termsByItem();
    var hits = MCX.search.query(question, { mode: 'hybrid', k: 0, persona: card, kinds: ['doc', 'work'], keepExcluded: true, region: region, today: options.today });
    var facts = [], leftOut = [], used = 0, taken = { doc: 0, work: 0 }, looked = 0;
    hits.forEach(function (hit) {
      if (!(hit.keyword > 0) || looked >= 8) return;
      looked++;
      var key = hit.kind + ':' + hit.id;
      var shared = (linked[key] || []).filter(function (t) { return asked.indexOf(t) !== -1; });
      if (hit.excluded) { leftOut.push({ kind: hit.kind, id: hit.id, reason: REASONS[hit.excluded] || hit.excluded, why: hit.why }); return; }
      var need = shared.length ? min : strong;
      if (hit.vector < need) {
        leftOut.push({ kind: hit.kind, id: hit.id, reason: 'threshold', why: 'below the relevance threshold (' + (shared.length ? 'shares ' + shared.join(', ') + '; ' : 'no glossary term in common; ') + 'vector ' + hit.vector.toFixed(3) + ' < ' + need + ')' });
        return;
      }
      if (taken[hit.kind] >= FACT_LIMITS[hit.kind]) { leftOut.push({ kind: hit.kind, id: hit.id, reason: 'limit', why: 'relevant, but ' + FACT_LIMITS[hit.kind] + (hit.kind === 'doc' ? ' pages' : ' threads') + ' are enough' }); return; }
      var item = hit.kind === 'doc' ? r().knowledge[hit.id] : r().work[hit.id];
      var src = MCX.build.source(hit.source) || {};
      var words = sharedWords(question, hit.snippet + ' ' + hit.title);
      var fact = {
        key: key, kind: hit.kind, id: hit.id, title: hit.title, system: hit.system, date: hit.date, snippet: hit.snippet,
        score: hit.score, keyword: hit.keyword, vector: hit.vector, terms: shared,
        why: (shared.length ? 'about ' + shared.join(', ') + ', like the question' : words.length ? 'shares “' + words.slice(0, 3).join('”, “') + '” with the question' : 'close in meaning to the question') +
          ' (hybrid ' + hit.score.toFixed(2) + ', vector ' + hit.vector.toFixed(2) + ')',
        lineage: { source: hit.source, system: src.system || hit.system }, file: item.file,
        masked: hit.snippet.indexOf('***') !== -1
      };
      if (hit.channel) fact.channel = hit.channel;
      fact.text = factText(fact);
      fact.tokens = count(fact.text);
      if (used + fact.tokens > budget) { leftOut.push({ kind: hit.kind, id: hit.id, reason: 'budget', why: 'over the ' + budget + '-token facts budget' }); return; }
      used += fact.tokens;
      taken[hit.kind]++;
      facts.push(fact);
    });
    return { facts: facts, leftOut: leftOut, tokens: used, budget: budget };
  }
  function r() { return repo(); }

  // -------------------------------------------------------------------
  // Memory: the last two turns of this session, one line each
  // -------------------------------------------------------------------
  function memorySlice(history) {
    var turns = (history || []).filter(function (t) { return t && t.question; }).slice(-2).map(function (t) {
      var answer = MCX.guard.mask(firstSentence(String(t.answer || '').split('\n')[0]));
      if (answer.length > 160) answer = answer.slice(0, 157) + '…';
      var line = 'Earlier: “' + MCX.guard.mask(String(t.question).trim()) + '”' + (t.analysis ? ' → ' + t.analysis : '') + (answer ? ' — ' + answer : '');
      return { question: MCX.guard.mask(String(t.question).trim()), analysis: t.analysis || null, line: line };
    });
    var text = turns.map(function (t) { return t.line; }).join('\n');
    return { turns: turns, text: text, tokens: text ? count(text) : 0 };
  }

  // -------------------------------------------------------------------
  // Tools this request may use
  // -------------------------------------------------------------------
  var TOOLS = {
    'semantic-sql': { name: 'Semantic SQL', description: 'Compile certified metrics into read-only SQL on GOLD tables through the semantic models.' },
    'glossary-lookup': { name: 'Glossary lookup', description: 'Resolve a business word to its certified definition and the column it maps to.' },
    'search': { name: 'Search (hybrid)', description: 'Keyword and vector search over the approved knowledge pages and work threads this person may see, personal data masked.' },
    'action-proposal': { name: 'Action proposal', description: 'Propose a ticket, message, task or order from the actions catalog; high-impact ones wait for a human check.' }
  };
  function toolsFor(plan, blocked) {
    if (blocked) return [];
    var ids = [];
    if ((plan.models || []).length || plan.name === 'lookup') ids.push('semantic-sql');
    ids.push('glossary-lookup', 'search');
    var catalog = repo().actions && repo().actions.actions;
    if (catalog && catalog[plan.name] && catalog[plan.name].length) ids.push('action-proposal');
    return ids.map(function (id) { var text = TOOLS[id].name + ' (' + id + ') — ' + TOOLS[id].description; return { id: id, name: TOOLS[id].name, description: TOOLS[id].description, text: text, tokens: count(text) }; });
  }

  // -------------------------------------------------------------------
  // Retrieval: which glossary terms does the wording of the question use?
  // -------------------------------------------------------------------
  function matchTerms(question) {
    var text = MCX.text, glossary = repo().glossary;
    var words = ' ' + text.tokens(question, true).join(' ') + ' ';
    var found = [];
    Object.keys(glossary).forEach(function (id) {
      var best = null;
      (glossary[id].synonyms || []).forEach(function (phrase) {
        if (text.hasPhrase(question, phrase) && (!best || phrase.length > best.length)) best = phrase;
      });
      if (best) found.push({ id: id, match: best, at: words.indexOf(' ' + text.tokens(best, true).join(' ') + ' ') });
    });
    return found.sort(function (a, b) { return a.at - b.at; });
  }

  /** Terms that share words with the question but were not matched: shown as "considered". */
  function nearTerms(question, taken) {
    var glossary = repo().glossary;
    var docs = Object.keys(glossary).filter(function (id) { return taken.indexOf(id) === -1; })
      .map(function (id) { return { id: id, text: glossary[id].name + ' ' + (glossary[id].synonyms || []).join(' ') + ' ' + glossary[id].body }; });
    return MCX.text.rank(question, docs).slice(0, 3);
  }

  /** Skills whose trigger phrases appear in the question. */
  function triggeredSkills(question, intent) {
    var text = MCX.text, skills = repo().skills, out = [];
    Object.keys(skills).forEach(function (id) {
      var hit = (skills[id].when || []).filter(function (phrase) { return text.hasPhrase(question, phrase); })[0];
      if (hit && (skills[id].intents || []).indexOf(intent) !== -1) out.push({ id: id, match: hit });
    });
    return out;
  }

  // -------------------------------------------------------------------
  // Assembly
  // -------------------------------------------------------------------
  /**
   * input: { persona (card from the repository), question, intent, scope, time,
   *          plan: { name, title, terms: [], skills: [], models: [] }, budget }
   */
  function assemble(input) {
    var r = repo(), card = input.persona, plan = input.plan || {}, question = input.question;
    var cfg = settings();
    var budget = input.budget || (cfg.budgets && cfg.budgets[input.intent]) || cfg.contextBudget || 4000;
    var items = [];
    function add(kind, id, source, text, extra) {
      var item = { kind: kind, id: id, file: source.file, name: source.title || source.name || id, detail: 'full',
        full: text('full'), brief: text('brief') };
      Object.keys(extra || {}).forEach(function (k) { item[k] = extra[k]; });
      items.push(item);
      return item;
    }
    function has(kind, id) { return items.some(function (i) { return i.kind === kind && i.id === id; }); }

    // 1. Who is asking
    add('persona', card.id, card, function () { return personaText(card, input.scope); }, { required: true, why: 'who is asking' });

    // 2. Policies in force
    ['persona-scope', 'certified-sources', 'partial-week'].forEach(function (id) {
      var policy = r.policies[id];
      if (!policy) return;
      if (id === 'partial-week' && !(input.time && input.time.thisWeek.partial)) return;
      add('policy', id, policy, function () { return policyText(policy); }, { required: true,
        why: id === 'partial-week' ? 'this week has ' + input.time.thisWeek.days + ' days of data' : 'applies to every answer' });
    });

    // 3. Glossary: the question's own wording first, then what the playbook depends on
    matchTerms(question).forEach(function (m) {
      var term = r.glossary[m.id];
      add('term', m.id, term, function (d) { return termText(term, d); },
        { required: (plan.terms || []).indexOf(m.id) !== -1, why: 'the question says “' + m.match + '”', match: m.match });
    });
    (plan.terms || []).forEach(function (id) {
      var term = r.glossary[id];
      if (!term) throw new Error('Analysis ' + plan.name + ' needs a glossary term that does not exist: ' + id);
      if (!has('term', id)) add('term', id, term, function (d) { return termText(term, d); }, { required: true, why: 'the playbook depends on it' });
    });
    if (card.scope.kind === 'operator' && !has('term', 'operators') && r.glossary.operators) {
      add('term', 'operators', r.glossary.operators, function (d) { return termText(r.glossary.operators, d); }, { required: true, why: 'the persona is an operator: “my” means their own stores' });
    }

    // 4. Skills the analysis follows
    (plan.skills || []).forEach(function (id) {
      var skill = r.skills[id];
      if (!skill) throw new Error('Analysis ' + plan.name + ' follows a skill that does not exist: ' + id);
      add('skill', id, skill, function (d) { return skillText(skill, d); }, { required: true, why: 'the ' + (plan.title || 'analysis').toLowerCase() + ' follows it' });
    });

    // 5. Semantic models its queries are compiled from
    (plan.models || []).forEach(function (id) {
      var model = r.models[id];
      if (!model) throw new Error('Analysis ' + plan.name + ' reads a model that does not exist: ' + id);
      add('model', id, model, function (d) { return modelText(model, d); }, { required: true, why: 'queries are compiled from it' });
    });

    // ---- Fit the budget: compact before leaving anything out -------------------
    items.forEach(function (i) { i.tokens = count(i.full); });
    function used() { return items.reduce(function (sum, i) { return sum + (i.out ? 0 : i.tokens); }, 0); }
    var compacted = [], leftOut = [];
    function compact(kind) {
      items.filter(function (i) { return i.kind === kind && i.detail === 'full' && !i.out; })
        .sort(function (a, b) { return b.tokens - a.tokens; })
        .forEach(function (i) {
          if (used() <= budget || count(i.brief) >= i.tokens) return;
          i.detail = 'brief'; i.saved = i.tokens - count(i.brief); i.tokens = count(i.brief);
          compacted.push(i);
        });
    }
    ['model', 'skill', 'term'].forEach(compact);
    items.filter(function (i) { return !i.required; }).reverse().forEach(function (i) {
      if (used() <= budget) return;
      i.out = true;
      leftOut.push({ kind: i.kind, id: i.id, why: 'over the ' + budget + '-token budget, and the playbook does not depend on it' });
    });

    // ---- What was considered and not loaded -------------------------------------
    var loadedTerms = items.filter(function (i) { return i.kind === 'term'; }).map(function (i) { return i.id; });
    nearTerms(question, loadedTerms).forEach(function (n) {
      leftOut.push({ kind: 'term', id: n.id, why: 'shares words with the question but none of its phrases match (score ' + n.score.toFixed(1) + ')' });
    });
    triggeredSkills(question, input.intent).forEach(function (t) {
      if (!has('skill', t.id)) leftOut.push({ kind: 'skill', id: t.id, why: 'triggered by “' + t.match + '”, but this analysis does not follow it' });
    });

    var kept = items.filter(function (i) { return !i.out; });
    kept.forEach(function (i) { i.text = i.detail === 'brief' ? i.brief : i.full; delete i.full; delete i.brief; });
    function of(kind) { return kept.filter(function (i) { return i.kind === kind; }); }

    // Which loads get a spoken line in the trace: definitions that change the answer.
    var spoken = 0;
    of('term').forEach(function (i) { i.narrate = !!r.glossary[i.id].hold && !!i.match && spoken++ < 2; });
    spoken = 0;
    of('skill').forEach(function (i) { i.narrate = !!r.skills[i.id].announce && spoken++ < 2; });

    var pack = {
      question: question, intent: input.intent, plan: { name: plan.name, title: plan.title },
      persona: of('persona')[0], policies: of('policy'), terms: of('term'), skills: of('skill'), models: of('model'),
      scope: input.scope, time: input.time,
      compacted: compacted.map(function (i) { return { kind: i.kind, id: i.id, saved: i.saved }; }),
      leftOut: leftOut,
      considered: { terms: Object.keys(r.glossary).length, skills: Object.keys(r.skills).length, models: Object.keys(r.models).length, policies: Object.keys(r.policies).length },
      tokens: { used: used(), budget: budget, repo: stats().tokens }
    };

    // ---- Context engine v2: pinned instructions, memory, facts, tools, cost ------------
    // These have budgets of their own, so the compaction above is exactly what it was.
    var pinned = r.policies['pinned-instructions'];
    pack.instructions = pinned ? { kind: 'policy', id: 'pinned-instructions', file: pinned.file, name: pinned.name, text: policyText(pinned), tokens: count(policyText(pinned)), why: 'always first, never compacted' } : null;
    pack.memory = memorySlice(input.history);
    var retrieved = input.blocked ? { facts: [], leftOut: [], tokens: 0, budget: cfg.factsBudget || 700 } : retrieveFacts(question, card, { today: input.time ? input.time.maxDate : null });
    pack.facts = retrieved.facts;
    retrieved.leftOut.forEach(function (l) { pack.leftOut.push(l); });
    pack.tools = toolsFor(plan, input.blocked);
    pack.considered.knowledge = Object.keys(r.knowledge || {}).length;
    pack.considered.work = Object.keys(r.work || {}).length;
    pack.tokens.instructions = pack.instructions ? pack.instructions.tokens : 0;
    pack.tokens.memory = pack.memory.tokens;
    pack.tokens.facts = retrieved.tokens;
    pack.tokens.factsBudget = retrieved.budget;
    pack.tokens.tools = pack.tools.reduce(function (s, t) { return s + t.tokens; }, 0);
    totals2(pack);
    pack.prompt = render(pack);
    return pack;
  }

  /** Everything handed over: the budgeted cards plus instructions, memory, facts and tools. Also the cost estimate. */
  function totals2(pack) {
    var t = pack.tokens;
    t.total = t.used + (t.instructions || 0) + (t.memory || 0) + (t.facts || 0) + (t.tools || 0);
    var c = settings().cost || {};
    var per = c.perThousand != null ? c.perThousand : 0;
    pack.cost = { tokens: t.total, perThousand: per, estimate: t.total / 1000 * per, currency: c.currency || 'USD' };
  }

  /** Load one more item into a pack while an analysis is running (just-in-time context). */
  function extend(pack, kind, id, why) {
    var r = repo();
    var list = { term: pack.terms, skill: pack.skills, model: pack.models, policy: pack.policies }[kind];
    var found = list.filter(function (i) { return i.id === id; })[0];
    if (found) return found;
    var source = { term: r.glossary, skill: r.skills, model: r.models, policy: r.policies }[kind][id];
    if (!source) throw new Error('No ' + kind + ' called ' + id + ' in the context repository');
    var text = kind === 'term' ? termText(source, 'full') : kind === 'skill' ? skillText(source, 'full') : kind === 'model' ? modelText(source, 'full') : policyText(source);
    var item = { kind: kind, id: id, file: source.file, name: source.title || source.name || id, detail: 'full', text: text, tokens: count(text), required: true, why: why || 'needed part-way through the analysis', late: true };
    list.push(item);
    pack.tokens.used += item.tokens;
    if (pack.tokens.total != null) totals2(pack);
    pack.prompt = render(pack);
    return item;
  }

  // -------------------------------------------------------------------
  // The pack as one piece of text: what a language model would be handed
  // -------------------------------------------------------------------
  function render(pack) {
    var fmt = MCX.fmt, t = pack.time, out = [];
    function section(title, list) {
      if (!list.length) return;
      out.push('', '## ' + title);
      list.forEach(function (i) { out.push('', i.text); });
    }
    out.push('# Context for one question', '', 'Question: ' + pack.question);
    out.push('Type: ' + pack.intent + '. Scope: ' + pack.scope.chip + '.');
    if (t) {
      out.push('Latest data: ' + fmt.dayDate(t.maxDate) + '. This week: ' + fmt.dateRange(t.thisWeek.start, t.thisWeek.end) +
        ' (' + t.thisWeek.days + (t.thisWeek.partial ? ' days, partial' : ' days') + '). Last week: ' + fmt.dateRange(t.lastWeek.start, t.lastWeek.end) + '.');
    }
    if (pack.instructions) section('Pinned instructions', [pack.instructions]);
    section('Who is asking', [pack.persona]);
    section('Rules', pack.policies);
    if (pack.memory && pack.memory.text) section('Memory', [pack.memory]);
    section('What the words mean', pack.terms);
    section('Playbooks', pack.skills);
    section('Certified tables', pack.models);
    section('Facts from knowledge and work', pack.facts || []);
    section('Tools', pack.tools || []);
    return out.join('\n');
  }

  // -------------------------------------------------------------------
  // The repository as a whole
  // -------------------------------------------------------------------
  var totals = null, totalsRepo = null;
  function catalogText(name, value) { return name + '\n' + JSON.stringify(value, null, 1); }
  function stats() {
    if (totals && totalsRepo === repo()) return totals;
    var r = repo(), tokens = 0, files = 0;
    Object.keys(r.personas).forEach(function (id) { tokens += count(JSON.stringify(r.personas[id])); files++; });
    Object.keys(r.glossary).forEach(function (id) { tokens += count(termText(r.glossary[id], 'full')); files++; });
    Object.keys(r.skills).forEach(function (id) { tokens += count(skillText(r.skills[id], 'full')); files++; });
    Object.keys(r.models).forEach(function (id) { tokens += count(modelText(r.models[id], 'full')); files++; });
    Object.keys(r.policies).forEach(function (id) { tokens += count(policyText(r.policies[id])); files++; });
    Object.keys(r.knowledge || {}).forEach(function (id) { tokens += count(pageText(r.knowledge[id])); files++; });
    Object.keys(r.work || {}).forEach(function (id) { tokens += count(threadText(r.work[id])); files++; });
    if (r.sources && r.sources.length) { tokens += count(catalogText('sources', r.sources)); files++; }
    if (r.routing) { tokens += count(catalogText('routing', r.routing)); files++; }
    if (r.actions) { tokens += count(catalogText('actions', r.actions)); files++; }
    totals = { tokens: tokens, files: files, personas: Object.keys(r.personas).length, terms: Object.keys(r.glossary).length,
      skills: Object.keys(r.skills).length, models: Object.keys(r.models).length, policies: Object.keys(r.policies).length,
      knowledge: Object.keys(r.knowledge || {}).length, work: Object.keys(r.work || {}).length, sources: (r.sources || []).length };
    totalsRepo = r;
    return totals;
  }

  /** Every item in the repository, as it would be written into a pack: for browsing. */
  function library() {
    var r = repo(), out = [];
    Object.keys(r.personas).forEach(function (id) { out.push({ kind: 'persona', id: id, name: r.personas[id].name + ' · ' + r.personas[id].role, file: r.personas[id].file, text: JSON.stringify(r.personas[id], null, 2) }); });
    Object.keys(r.glossary).forEach(function (id) { out.push({ kind: 'term', id: id, name: r.glossary[id].name, file: r.glossary[id].file, text: termText(r.glossary[id], 'full') }); });
    Object.keys(r.skills).forEach(function (id) { out.push({ kind: 'skill', id: id, name: r.skills[id].title, file: r.skills[id].file, text: skillText(r.skills[id], 'full') }); });
    Object.keys(r.models).forEach(function (id) { out.push({ kind: 'model', id: id, name: id, file: r.models[id].file, text: modelText(r.models[id], 'full') }); });
    Object.keys(r.policies).forEach(function (id) { out.push({ kind: 'policy', id: id, name: r.policies[id].name, file: r.policies[id].file, text: policyText(r.policies[id]) }); });
    Object.keys(r.knowledge || {}).forEach(function (id) { out.push({ kind: 'doc', id: id, name: r.knowledge[id].title, file: r.knowledge[id].file, text: pageText(r.knowledge[id]) }); });
    Object.keys(r.work || {}).forEach(function (id) { out.push({ kind: 'work', id: id, name: r.work[id].title, file: r.work[id].file, text: threadText(r.work[id]) }); });
    (r.sources || []).forEach(function (src) { out.push({ kind: 'source', id: src.id, name: src.name + ' · ' + src.system, file: 'context/sources.json', text: JSON.stringify(src, null, 2) }); });
    if (r.routing) out.push({ kind: 'catalog', id: 'routing', name: 'Routing table', file: r.routing.file, text: JSON.stringify(r.routing, null, 2) });
    if (r.actions) out.push({ kind: 'catalog', id: 'actions', name: 'Actions catalog', file: r.actions.file, text: JSON.stringify(r.actions, null, 2) });
    out.forEach(function (i) { i.tokens = count(i.text); });
    return out;
  }

  MCX.context = { assemble: assemble, extend: extend, render: render, stats: stats, library: library, matchTerms: matchTerms,
    retrieveFacts: retrieveFacts, memorySlice: memorySlice, toolsFor: toolsFor, factText: factText, pageText: pageText, threadText: threadText,
    reset: function () { totals = null; totalsRepo = null; } };
})(typeof window !== 'undefined' ? window : globalThis);
