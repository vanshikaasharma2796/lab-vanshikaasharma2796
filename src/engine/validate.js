/* =====================================================================
   src/engine/validate.js — checking an answer before it is given

   After the analysis has written its answer, and before anyone sees it:

     schema   the answer is not empty; every highlighted phrase is in it;
              every finding cites at least one loaded source; every step
              in the trace is a known kind
     policy   no raw (BRONZE) table on the context side; an operator's
              answer names no other operator unless the question did; no
              unmasked personal data in the answer or the facts; every
              fact respects residency, retention and access
     action   every high-impact action waits for a human check
     bounds   the run stayed inside engine.bounds

   If any check fails, the runtime gives a safe fallback instead (saying
   what failed) and keeps the original under validation.withheld.

   MCX.validate.check({ run, transcript, pack, persona, actions, route, guard, execution, question })
     -> { ok, checks: [{ id, kind, label, ok, detail }] }
   ===================================================================== */
(function (global) {
  'use strict';
  var MCX = (global.MCX = global.MCX || {});

  var FAILED = {
    "answer": "the answer was empty",
    "marks": "a highlighted phrase is missing from the answer",
    "cited": "a finding cites no loaded source",
    "steps": "the trace has a step of an unknown kind",
    "certified": "a raw table was read",
    "scope": "it names another operator",
    "pii": "it contains personal data",
    "facts": "a fact breaks residency, retention or access",
    "actions": "a high-impact action skipped the human check",
    "bounds": "the run went past its execution bounds"
  };

  function check(input) {
    var t = input.transcript, pack = input.pack, card = input.persona, checks = [];
    function add(id, kind, label, problems) {
      checks.push({ id: id, kind: kind, label: label, ok: !problems.length, failed: FAILED[id], detail: problems.slice(0, 3).join('; ') + (problems.length > 3 ? '; and ' + (problems.length - 3) + ' more' : '') });
    }

    // ---- Schema ---------------------------------------------------------------
    add('answer', 'schema', 'The answer is not empty', String(t.answer || '').trim() ? [] : ['no answer was written']);
    add('marks', 'schema', 'Every highlighted phrase is in the answer',
      t.marks.filter(function (m) { var p = m.good != null ? m.good : m.bad; return String(t.answer).indexOf(p) === -1; }).map(function (m) { return '“' + (m.good || m.bad) + '”'; }));
    add('cited', 'schema', 'Every finding cites a loaded source',
      t.marks.filter(function (m) { return m.good != null && !(m.from && m.from.length); }).map(function (m) { return '“' + m.good + '”'; }));
    add('steps', 'schema', 'Every step in the trace is a known kind',
      t.steps.map(function (s, i) { return s.say != null || MCX.script.describeTool(s) ? null : 'step ' + (i + 1); }).filter(Boolean));

    // ---- Policy ---------------------------------------------------------------
    add('certified', 'policy', 'Only certified tables were read',
      t.steps.filter(function (s) { return s.sql != null && /\bBRONZE\./i.test(s.sql); }).map(function (s) { return s.key; }));
    var scopeProblems = [];
    if (card.scope && card.scope.kind === 'operator') {
      var e = MCX.sem.entities(), asked = String(input.question || '');
      Object.keys(e.operators).forEach(function (name) {
        if (name === card.scope.operator) return;
        var full = [name, name.replace(/\s[A-Z]\.\s/, ' ')];
        var named = full.some(function (n) { return MCX.text.hasPhrase(t.answer, n); });
        var inQuestion = e.operators[name].aliases.some(function (a) { return a.length > 3 && MCX.text.hasPhrase(asked, a); });
        if (named && !inQuestion) scopeProblems.push('names ' + name);
      });
    }
    add('scope', 'policy', 'An operator sees only their own stores', scopeProblems);
    var pii = MCX.guard.findPii(t.answer).map(function (p) { return 'answer: ' + p.rule; });
    (pack.facts || []).forEach(function (f) { MCX.guard.findPii(f.snippet).forEach(function (p) { pii.push(f.key + ': ' + p.rule); }); });
    add('pii', 'policy', 'No unmasked personal data', pii);
    var leaks = [];
    (pack.facts || []).forEach(function (f) {
      var why = MCX.search.exclusion(f.kind, f.id, card, { region: (MCX.config.engine || {}).region, today: pack.time ? pack.time.maxDate : null });
      if (why) leaks.push(f.key + ' (' + why.code + ')');
    });
    add('facts', 'policy', 'Facts respect residency, retention and access', leaks);

    // ---- Action gates ---------------------------------------------------------
    add('actions', 'action', 'High-impact actions wait for a human check',
      (input.actions || []).filter(function (a) { return a.impact === 'high' && !a.needsApproval; }).map(function (a) { return a.id; }));

    // ---- Execution bounds -----------------------------------------------------
    var x = input.execution || {};
    add('bounds', 'bounds', 'The run stayed inside its execution bounds', x.stopped ? [x.stopped] : []);

    return { ok: checks.every(function (c) { return c.ok; }), checks: checks };
  }

  MCX.validate = { check: check };
})(typeof window !== 'undefined' ? window : globalThis);
