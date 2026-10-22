/* =====================================================================
   src/engine/text.js — reading a question

   Small, dependency-free text tools used to match a question against
   the context layer:

     normalise / tokens      lower-case words, hyphens and plurals folded
     hasPhrase               whole-phrase match on word boundaries
     rank                    score documents against a query (BM25)
     intentOf                what kind of question it is

   MCX.text
   ===================================================================== */
(function (global) {
  'use strict';
  var MCX = (global.MCX = global.MCX || {});

  var STOP = { a: 1, an: 1, the: 1, of: 1, to: 1, in: 1, on: 1, at: 1, for: 1, and: 1, or: 1, is: 1, are: 1, was: 1, were: 1, be: 1, do: 1, does: 1, did: 1, i: 1, we: 1, my: 1, our: 1, me: 1, it: 1, its: 1, this: 1, that: 1, with: 1, by: 1, from: 1, as: 1, s: 1, if: 1, so: 1, than: 1, then: 1, there: 1, any: 1, some: 1, get: 1, has: 1, have: 1, should: 1 };

  /** "Why is Marcus's drive-thru time up?" -> "why is marcus s drive thru time up" */
  function normalise(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/[^a-z0-9%$]+/g, ' ')
      .trim();
  }

  /** A light stem: plurals and -ing/-ed, enough to match "stores" with "store". */
  function stem(word) {
    if (word.length > 4 && /ies$/.test(word)) return word.slice(0, -3) + 'y';
    if (word.length > 3 && /(ches|shes|sses|xes)$/.test(word)) return word.slice(0, -2);
    if (word.length > 3 && /s$/.test(word) && !/ss$/.test(word)) return word.slice(0, -1);
    return word;
  }

  function tokens(text, keepStop) {
    var out = [];
    normalise(text).split(' ').forEach(function (word) {
      if (!word) return;
      if (!keepStop && STOP[word]) return;
      out.push(stem(word));
    });
    return out;
  }

  /** True if the phrase occurs in the text as whole words, ignoring case, hyphens and plurals. */
  function hasPhrase(text, phrase) {
    var hay = ' ' + tokens(text, true).join(' ') + ' ';
    var needle = ' ' + tokens(phrase, true).join(' ') + ' ';
    return needle.trim().length > 0 && hay.indexOf(needle) !== -1;
  }

  /**
   * Rank documents against a query with BM25.
   * docs: [{ id, text }]  ->  [{ id, score }] best first, zero scores dropped.
   */
  function rank(query, docs) {
    var terms = tokens(query);
    if (!terms.length || !docs.length) return [];
    var lists = docs.map(function (doc) { return tokens(doc.text); });
    var avgLength = lists.reduce(function (sum, l) { return sum + l.length; }, 0) / lists.length || 1;
    var seen = {};
    terms.forEach(function (term) {
      if (seen[term] != null) return;
      seen[term] = lists.filter(function (l) { return l.indexOf(term) !== -1; }).length;
    });
    var k1 = 1.4, b = 0.6;
    return docs.map(function (doc, i) {
      var list = lists[i], score = 0;
      Object.keys(seen).forEach(function (term) {
        var df = seen[term];
        if (!df) return;
        var tf = list.filter(function (w) { return w === term; }).length;
        if (!tf) return;
        var idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
        score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * list.length / avgLength));
      });
      return { id: doc.id, score: score };
    }).filter(function (r) { return r.score > 0; }).sort(function (a, b2) { return b2.score - a.score; });
  }

  /**
   * What kind of question is this?
   *   descriptive   what happened        diagnostic   why
   *   prescriptive  what to do           predictive   what if
   */
  function intentOf(question) {
    var q = normalise(question);
    if (/^what if\b|\bwhat if\b|\bsuppose\b|\bprojected\b|\bforecast\b|\bwhat does it take\b/.test(q)) return 'predictive';
    if (/^why\b|\bwhy\b|\bcause\b|\bor is it\b|^is .* (or|cannibali)|^are .* or\b|\bdue to\b/.test(q)) return 'diagnostic';
    if (/^how (do|should|can|could) (i|we)\b|\bwhat should\b|\bshould i\b|\bshould we\b|\brecommend\b|\bprioriti[sz]e\b|\bwhich .* (need|should|lead)\b|\bwhat playbook\b|\bwhat to tell\b/.test(q)) return 'prescriptive';
    return 'descriptive';
  }

  /** Rough size of a piece of text in model tokens: about four characters each. */
  function tokenCount(text) { return Math.ceil(String(text || '').length / 4); }

  MCX.text = { normalise: normalise, tokens: tokens, stem: stem, hasPhrase: hasPhrase, rank: rank, intentOf: intentOf, tokenCount: tokenCount };
})(typeof window !== 'undefined' ? window : globalThis);
