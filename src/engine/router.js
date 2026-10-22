/* =====================================================================
   src/engine/router.js — which analysis answers this question?

   A question picked from the bank is bound to its analysis by name.
   A typed question is matched in three steps:

     1. the persona-scope policy: an operator may only ask about their
        own stores
     2. the closest question an analysis already knows how to answer
     3. failing that, a direct lookup through the semantic layer, if the
        wording names a certified metric

   If nothing fits, the answer says so and lists what can be asked.

   MCX.router.route(personaCard, question, slug) -> { analysis, kind, why, ... }
   ===================================================================== */
(function (global) {
  'use strict';
  var MCX = (global.MCX = global.MCX || {});

  function catalogPersona(id) {
    return (MCX.catalog.personas || []).filter(function (p) { return p.id === id; })[0] || null;
  }

  /** Every bank question with the analysis that answers it. */
  function examples() {
    var out = [];
    MCX.catalog.personas.forEach(function (persona) {
      persona.questions.forEach(function (q) {
        out.push({ persona: persona.id, slug: q.slug, text: q.text, bucket: q.bucket, analysis: q.analysis || persona.id + '/' + q.slug });
      });
    });
    return out;
  }

  function wordSet(text) {
    var set = {};
    MCX.text.tokens(text).forEach(function (w) { set[w] = true; });
    return set;
  }
  /** Shared words over all words (Jaccard), on stemmed words without stop words. */
  function similarity(a, b) {
    var A = wordSet(a), B = wordSet(b), shared = 0, all = 0;
    Object.keys(A).forEach(function (w) { all++; if (B[w]) shared++; });
    Object.keys(B).forEach(function (w) { if (!A[w]) all++; });
    return all ? shared / all : 0;
  }

  function route(card, question, slug) {
    var persona = catalogPersona(card.id);
    // A question from the bank.
    if (slug && persona) {
      var picked = persona.questions.filter(function (q) { return q.slug === slug; })[0];
      if (picked) return { kind: 'bank', analysis: picked.analysis || card.id + '/' + slug, slug: slug, bucket: picked.bucket, why: 'picked from the question bank' };
    }

    var isOperator = card.scope.kind === 'operator';
    var named = MCX.sem.findEntity(question);
    var entities = MCX.sem.entities();

    // 1. persona-scope policy: an operator cannot look at anyone else's stores.
    if (isOperator && named) {
      var theirs = (named.kind === 'operator' && named.operator === card.scope.operator) ||
        (named.kind === 'store' && entities.stores[named.store].operator === card.scope.operator);
      if (!theirs) return { kind: 'out-of-scope', analysis: 'out-of-scope', named: named, why: 'persona-scope policy: an operator sees their own stores' };
    }

    // 2. The closest question an analysis already answers.
    var intent = MCX.text.intentOf(question);
    var best = null;
    examples().forEach(function (example) {
      var plan = MCX.analyses[example.analysis];
      if (!plan) return;
      if (isOperator && !plan.anyScope && example.persona !== card.id) return;      // network-wide analyses are not for operators
      if (named && !isOperator && !plan.anyScope && example.persona !== card.id) return;
      var score = similarity(question, example.text) + (example.bucket === intent ? 0.08 : 0) + (example.persona === card.id ? 0.05 : 0);
      if (!best || score > best.score) best = { score: score, example: example };
    });
    var threshold = (MCX.config.engine && MCX.config.engine.matchThreshold) || 0.45;
    // A question that asks for a metric cut a particular way ("... by region") is a lookup, unless it is nearly a known question.
    var lookup = MCX.analyses.lookup && MCX.lookup ? MCX.lookup.parse(card, question) : null;
    if (lookup && lookup.cut && !(best && best.score >= 0.8)) {
      return { kind: 'lookup', analysis: 'lookup', bucket: 'descriptive', why: 'the wording names a certified metric and how to cut it' };
    }
    if (best && best.score >= threshold) {
      return { kind: 'match', analysis: best.example.analysis, bucket: best.example.bucket, score: best.score, like: best.example.text,
        why: 'closest known question: “' + best.example.text + '”' };
    }

    // 3. A certified metric named in the question.
    if (lookup) {
      return { kind: 'lookup', analysis: 'lookup', bucket: 'descriptive', why: 'the wording names a certified metric' };
    }
    return { kind: 'none', analysis: 'no-match', near: best ? best.example.text : null, why: 'no analysis or certified metric matches the wording' };
  }

  /**
   * Which executor handles this request, from the routing table in context/routing.json.
   * Rules are tried in order; the first whose `when` matches wins. A `when` value may be a list.
   * -> { rule, executor, what, model, fallback }
   */
  function decide(routed, guard, intent) {
    var table = (MCX.contextRepo && MCX.contextRepo.routing) || { rules: [] };
    var facts = { guard: guard ? guard.verdict : 'pass', route: routed.kind, intent: intent || null };
    function matches(when) {
      return Object.keys(when || {}).every(function (key) {
        var want = when[key];
        return Array.isArray(want) ? want.indexOf(facts[key]) !== -1 : want === facts[key];
      });
    }
    var rule = (table.rules || []).filter(function (r) { return matches(r.when); })[0] || table.default || { id: 'default', executor: 'rule', what: 'deterministic analysis' };
    return {
      rule: rule.id, executor: rule.executor, what: rule.what || '',
      model: rule.model || null, fallback: rule.fallback || null,
      connected: rule.executor === 'model' ? false : true
    };
  }

  /** Wording that only makes sense after an earlier turn: "what about last week?", "and the Midwest?", "same for staffing". */
  function looksLikeFollowUp(question) {
    return /^\s*(and|but|also|what about|how about|and what about|what of|same for|same but|now|then|ok|okay)\b/i.test(String(question || ''));
  }

  var OPENER = /^\s*(and what about|what about|how about|what of|same for|same but|and|but|also|now|then|ok|okay)\b[\s,]*/i;
  var TIME = /\b(this week|last week|since (the )?launch|right now|today|yesterday)\b/i;

  /**
   * The earlier question rewritten with what the follow-up changes: a new time ("what about last week?")
   * replaces the earlier one; anything else ("and the Midwest?") is added to it.
   */
  function rewrite(earlier, question) {
    var rest = String(question).replace(OPENER, '').replace(/[?.!\s]+$/, '').trim();
    var before = String(earlier).trim().replace(/[?.!\s]+$/, '');
    var time = TIME.exec(rest);
    if (time && TIME.test(before)) {
      var other = rest.replace(TIME, '').replace(/^[\s,]*(the\s+)?$/i, '').trim();
      return before.replace(TIME, time[0].toLowerCase()) + (other ? ' ' + other : '');
    }
    return before + ' ' + rest;
  }

  /** A typed follow-up ("what about last week?") read together with the turn before it. */
  function followUp(card, question, history) {
    var last = (history || []).filter(function (t) { return t && t.question; }).slice(-1)[0];
    if (!last) return null;
    var combined = rewrite(last.question, question);
    var again = route(card, combined, null);
    if (again.kind === 'none') return null;
    again.followUp = { from: last.question, question: combined };
    again.why = 'a follow-up to “' + last.question + '”, read as “' + combined + '”; ' + again.why;
    return again;
  }

  /** The route for a question the guard blocked. */
  function blocked(guard) {
    return { kind: 'blocked', analysis: 'blocked', bucket: 'descriptive', findings: guard.findings, why: 'guard: the question ' + (guard.reason || 'was blocked') };
  }

  MCX.router = { route: route, examples: examples, similarity: similarity, decide: decide, followUp: followUp, looksLikeFollowUp: looksLikeFollowUp, rewrite: rewrite, blocked: blocked };
})(typeof window !== 'undefined' ? window : globalThis);
