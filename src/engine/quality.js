/* =====================================================================
   src/engine/quality.js — did the answer have the context it needed?

   A score from 0 to 100 for each context-side answer, from six parts
   (each 0 to 1, weighted):

     grounded    30  share of findings whose lineage is complete: every
                     cited source resolves to a registered system, and at
                     least one is a query, a page, a thread or a policy
     coverage    20  share of the question's content words the context
                     understood: glossary phrases, named operators,
                     regions and stores, time words, the matched question
     budget      10  the cards fit their budget and the facts theirs
     guard       10  pass 1, masked 0.8, blocked 0
     validation  20  every check passed
     freshness   10  share of the sources used that are within their SLA

   score = floor(sum + 0.5); 80 and up is strong, 60 and up fair, below
   that weak.

   MCX.quality.score(result) -> { score, band, parts: { name: { value, weight, detail } } }
   ===================================================================== */
(function (global) {
  'use strict';
  var MCX = (global.MCX = global.MCX || {});
  var WEIGHTS = { grounded: 30, coverage: 20, budget: 10, guard: 10, validation: 20, freshness: 10 };
  var TIME_WORDS = ['week', 'today', 'yesterday', 'month', 'launch', 'since', 'last', 'now', 'right', 'quarter', 'day'];

  function complete(lineage) {
    return lineage.length > 0 && lineage.every(function (l) { return !!l.source; }) &&
      lineage.some(function (l) { return ['query', 'doc', 'work', 'policy'].indexOf(l.kind) !== -1; });
  }

  function coverage(result) {
    var text = MCX.text, pack = result.pack;
    var content = [];
    var asked = String(pack.question).replace(/\S*\*\*\*\S*/g, ' ');      // masked personal data is not a word to understand
    text.tokens(asked).forEach(function (w) { if (content.indexOf(w) === -1) content.push(w); });
    if (!content.length) return { value: 1, detail: 'no content words' };
    var known = {};
    function learn(phrase) { text.tokens(phrase).forEach(function (w) { known[w] = true; }); }
    pack.terms.forEach(function (t) { if (t.match) learn(t.match); });
    TIME_WORDS.forEach(learn);
    if (pack.scope && pack.scope.named) learn([pack.scope.operator, pack.scope.region, pack.scope.store].filter(Boolean).join(' '));
    if (result.route.kind === 'bank') { content.forEach(function (w) { known[w] = true; }); }
    if (result.route.like) learn(result.route.like);
    var e = MCX.sem.entities();
    Object.keys(e.operators).forEach(function (n) { if (text.hasPhrase(pack.question, n) || e.operators[n].aliases.some(function (a) { return a.length > 3 && text.hasPhrase(pack.question, a); })) learn(e.operators[n].aliases.join(' ')); });
    Object.keys(e.regions).forEach(function (n) { if (text.hasPhrase(pack.question, n)) learn(n); });
    Object.keys(e.stores).forEach(function (n) { if (text.hasPhrase(pack.question, n)) learn(n); });
    var hit = content.filter(function (w) { return known[w]; });
    var missed = content.filter(function (w) { return !known[w]; });
    return { value: hit.length / content.length, detail: hit.length + ' of ' + content.length + ' content words understood' + (missed.length ? '; not understood: ' + missed.slice(0, 5).join(', ') : '') };
  }

  function score(result) {
    var parts = {}, marks = result.context.marks.filter(function (m) { return m.good != null; });
    var grounded = marks.filter(function (m) { return complete(m.lineage || []); });
    parts.grounded = { value: marks.length ? grounded.length / marks.length : 0, detail: grounded.length + ' of ' + marks.length + ' findings trace back to a registered system' };
    parts.coverage = coverage(result);
    var t = result.pack.tokens;
    var fits = t.used <= t.budget && (t.facts || 0) <= (t.factsBudget || Infinity);
    parts.budget = { value: fits ? 1 : Math.min(1, t.budget / t.used), detail: t.used + ' of ' + t.budget + ' tokens; facts ' + (t.facts || 0) + ' of ' + (t.factsBudget || 0) };
    var g = result.guard.verdict;
    parts.guard = { value: g === 'pass' ? 1 : g === 'masked' ? 0.8 : 0, detail: g };
    parts.validation = { value: result.validation.ok ? 1 : 0, detail: result.validation.checks.filter(function (c) { return c.ok; }).length + ' of ' + result.validation.checks.length + ' checks passed' };
    var used = [];
    marks.forEach(function (m) { (m.lineage || []).forEach(function (l) {
      if (l.source && used.indexOf(l.source) === -1) used.push(l.source);
      (l.upstream || []).forEach(function (u) { if (used.indexOf(u.source) === -1) used.push(u.source); });
    }); });
    var fresh = MCX.build.freshness();
    var stale = used.filter(function (id) { var f = fresh.filter(function (x) { return x.id === id; })[0]; return f && !f.fresh; });
    parts.freshness = { value: used.length ? (used.length - stale.length) / used.length : 1, detail: (used.length - stale.length) + ' of ' + used.length + ' sources used are within their SLA' + (stale.length ? '; stale: ' + stale.join(', ') : '') };

    var total = 0;
    Object.keys(WEIGHTS).forEach(function (k) { parts[k].weight = WEIGHTS[k]; total += parts[k].value * WEIGHTS[k]; });
    var value = Math.floor(total + 0.5);
    return { score: value, band: value >= 80 ? 'strong' : value >= 60 ? 'fair' : 'weak', parts: parts };
  }

  MCX.quality = { score: score, weights: WEIGHTS };
})(typeof window !== 'undefined' ? window : globalThis);
