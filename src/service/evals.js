/* =====================================================================
   src/service/evals.js — evals and golden answers (G1, L2, C3)

   Two kinds of known right answers, both in evals/ and packed into
   evals/bundle.js for the page (tools/golden.js --update writes it):

     the eval set       evals/golden-set.json: business expectations per
                        question (route, analysis, guard verdict, words the
                        answer must or must not contain, sources it must
                        cite, facts, what is left out and why, actions...)
     golden answers     evals/golden-answers.json: the full ask() output of
                        every bank question and a set of typed ones. The
                        page and the service compare against a fingerprint
                        of each (MCX.evalBundle.golden), the tools against
                        the whole file.

   A fingerprint is a short hash per part of an answer, so "what moved"
   can be named without carrying the whole answer around:

     route        { kind, analysis }           path "route"
     guard        the guard verdict            path "guard.verdict"
     answer       the context answer text      path "context.answer"
     marks        the highlighted findings     path "context.marks"
     facts        the keys of the facts used   path "facts"
     actions      { id, impact, needsApproval } path "actions"
     validation   validation.ok                path "validation.ok"

   Each part: the first 16 hex of sha256(canonicalJson(part)).
   ===================================================================== */
(function (global) {
  'use strict';
  var MCX = (global.MCX = global.MCX || {});

  var PARTS = ['route', 'guard', 'answer', 'marks', 'facts', 'actions', 'validation'];
  var PATHS = { route: 'route', guard: 'guard.verdict', answer: 'context.answer', marks: 'context.marks', facts: 'facts', actions: 'actions', validation: 'validation.ok' };

  function h(value) { return MCX.sha256(MCX.canonicalJson(value)).slice(0, 16); }

  function partsOf(result) {
    return {
      route: { kind: result.route.kind, analysis: result.plan.name },
      guard: result.guard ? result.guard.verdict : null,
      answer: result.context.answer,
      marks: result.context.marks.map(function (m) { return m.good != null ? { good: m.good, from: m.from || [] } : { bad: m.bad }; }),
      facts: (result.facts || []).map(function (f) { return f.key; }),
      actions: (result.actions || []).map(function (a) { return { id: a.id, impact: a.impact, needsApproval: a.needsApproval }; }),
      validation: result.validation ? result.validation.ok : null
    };
  }

  /** { route, guard, answer, marks, facts, actions, validation }: 16 hex each. */
  function fingerprint(result) {
    var parts = partsOf(result), out = {};
    PARTS.forEach(function (p) { out[p] = h(parts[p]); });
    return out;
  }

  /** The path of the first part that differs, or null when the two fingerprints agree. */
  function diff(a, b) {
    for (var i = 0; i < PARTS.length; i++) if (!a || !b || a[PARTS[i]] !== b[PARTS[i]]) return PATHS[PARTS[i]];
    return null;
  }

  function bundle() { return MCX.evalBundle || { set: [], golden: [] }; }
  function goodMarks(result) { return result.context.marks.filter(function (m) { return m.good != null; }); }

  /** What a case expects that this result does not do: a list of short sentences (empty = pass). */
  function check(c, result) {
    var x = c.expect || {}, out = [];
    function oneOf(want, got) { return Array.isArray(want) ? want.indexOf(got) !== -1 : want === got; }
    if (x.route != null && !oneOf(x.route, result.route.kind)) out.push('route ' + result.route.kind + ', expected ' + [].concat(x.route).join(' or '));
    if (x.analysis != null && !oneOf(x.analysis, result.plan.name)) out.push('analysis ' + result.plan.name + ', expected ' + [].concat(x.analysis).join(' or '));
    if (x.guard != null && result.guard.verdict !== x.guard) out.push('guard ' + result.guard.verdict + ', expected ' + x.guard);
    if (x.executor != null && result.decision.executor !== x.executor) out.push('executor ' + result.decision.executor + ', expected ' + x.executor);
    (x.contains || []).forEach(function (text) { if (result.context.answer.indexOf(text) === -1) out.push('the answer does not say “' + text + '”'); });
    if (x.notContains && x.notContains.length) {
      var everything = JSON.stringify(result.context) + '\n' + result.pack.prompt + '\n' + JSON.stringify(result.facts || []);
      x.notContains.forEach(function (text) { if (everything.indexOf(text) !== -1) out.push('“' + text + '” reaches the context side'); });
    }
    var cited = [];
    goodMarks(result).forEach(function (m) { (m.from || []).forEach(function (k) { if (cited.indexOf(k) === -1) cited.push(k); }); });
    (x.cites || []).forEach(function (key) { if (cited.indexOf(key) === -1) out.push('no finding cites ' + key); });
    var factKeys = (result.facts || []).map(function (f) { return f.key; });
    (x.facts || []).forEach(function (key) { if (factKeys.indexOf(key) === -1) out.push('fact ' + key + ' was not used'); });
    (x.noFacts || []).forEach(function (key) { if (factKeys.indexOf(key) !== -1) out.push('fact ' + key + ' was used'); });
    Object.keys(x.leftOut || {}).forEach(function (key) {
      var found = result.pack.leftOut.filter(function (l) { return l.kind + ':' + l.id === key; })[0];
      if (!found) out.push(key + ' was not left out');
      else if (found.reason !== x.leftOut[key]) out.push(key + ' was left out for ' + found.reason + ', expected ' + x.leftOut[key]);
    });
    if (x.actions != null && result.actions.length !== x.actions) out.push(result.actions.length + ' action(s), expected ' + x.actions);
    if (x.needsApproval != null && result.actions.filter(function (a) { return a.needsApproval; }).length !== x.needsApproval) out.push(result.actions.filter(function (a) { return a.needsApproval; }).length + ' action(s) wait for a human check, expected ' + x.needsApproval);
    if (x.maxTokens != null && result.pack.tokens.total > x.maxTokens) out.push(result.pack.tokens.total + ' tokens, more than ' + x.maxTokens);
    if (x.minQuality != null && result.quality.score < x.minQuality) out.push('quality ' + result.quality.score + ', below ' + x.minQuality);
    if (x.validation != null && result.validation.ok !== x.validation) out.push('validation ' + (result.validation.ok ? 'passed' : 'failed') + ', expected ' + (x.validation ? 'pass' : 'fail'));
    if (x.memory != null && result.pack.memory.turns.length !== x.memory) out.push(result.pack.memory.turns.length + ' memory turn(s), expected ' + x.memory);
    return out;
  }

  /** The input a case is asked with. */
  function inputOf(c) {
    var input = { persona: c.persona, question: c.question };
    if (c.slug) input.slug = c.slug;
    if (c.bucket) input.bucket = c.bucket;
    if (c.history) input.history = c.history;
    return input;
  }

  /**
   * Run eval cases (default: the eval set) through ask (default: MCX.engine.ask).
   * -> { score, passed, total, cases: [{ id, title, ok, failures, route, analysis, quality }] }
   */
  function run(cases, ask) {
    cases = cases || bundle().set;
    ask = ask || MCX.engine.ask;
    var out = cases.map(function (c) {
      var failures, result = null;
      try {
        result = ask(inputOf(c));
        failures = check(c, result);
      } catch (error) {
        failures = ['failed: ' + String(error.message).split('\n')[0]];
      }
      return { id: c.id, title: c.title || c.question, ok: !failures.length, failures: failures,
        route: result ? result.route.kind : null, analysis: result ? result.plan.name : null, quality: result ? result.quality.score : null };
    });
    var passed = out.filter(function (c) { return c.ok; }).length;
    return { score: out.length ? Math.floor(passed * 100 / out.length + 0.5) : 0, passed: passed, total: out.length, cases: out };
  }

  /**
   * Re-ask every golden case and compare its fingerprint with the golden one.
   * -> { total, same, changed: [{ id, path }] }
   */
  function golden(ask) {
    ask = ask || MCX.engine.ask;
    var list = bundle().golden, changed = [];
    list.forEach(function (g) {
      var path;
      try { path = diff(fingerprint(ask(g.input)), g.fp); } catch (error) { path = 'error: ' + String(error.message).split('\n')[0]; }
      if (path) changed.push({ id: g.id, path: path });
    });
    return { total: list.length, same: list.length - changed.length, changed: changed };
  }

  /** The golden fingerprint for a bank question (persona + slug), or null. */
  function goldenFor(persona, slug) {
    var id = persona + '/' + slug;
    return bundle().golden.filter(function (g) { return g.id === id; })[0] || null;
  }

  MCX.evals = { PARTS: PARTS, PATHS: PATHS, fingerprint: fingerprint, diff: diff, check: check, inputOf: inputOf, run: run, golden: golden, goldenFor: goldenFor, bundle: bundle };
})(typeof window !== 'undefined' ? window : globalThis);
