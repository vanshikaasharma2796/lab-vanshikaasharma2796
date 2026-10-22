/* =====================================================================
   src/engine/actions.js — what an answer proposes to do

   context/actions.json lists, per analysis, the actions an answer may
   propose: a ticket, a message, a task or an order, in Jira,
   ServiceNow, Slack or SAP. Templates use only words the scope and the
   calendar define, so the same question always proposes the same action
   with the same id:

     {stores}     "Marcus J. Williams's 14 Southeast stores", "all 104 stores"
     {portfolio}  "Marcus J. Williams's portfolio", "the Southeast", "the network"
     {count}      stores in scope        {exposed}  exposed single-lane stores in scope
     {week}       "the week of May 11"   {launch}   "Double Stack"
     {next}       "Honey Heat Chicken"   {nextDate} "June 4"

   Impact: "high" or "low" as written, or "auto": high when the scope has
   at least high_impact.stores_at_least stores, or the answer puts at
   least high_impact.dollars_at_least dollars at stake. High impact means
   a human check by someone holding the approver role.

   Nothing is written here. The service layer queues, decides and acts.

   MCX.actions.propose(plan, run) -> [{ id, analysis, type, system, title, detail, ownerRole, approverRole,
                                       approvers, impact, needsApproval, why, status: 'proposed' }]
   ===================================================================== */
(function (global) {
  'use strict';
  var MCX = (global.MCX = global.MCX || {});

  function catalog() { return (MCX.contextRepo && MCX.contextRepo.actions) || { approvers: {}, high_impact: {}, actions: {} }; }

  /** Words for the scope, written for a ticket rather than for the reader ("your" never appears). */
  function words(run) {
    var fmt = MCX.fmt, s = run.scope, t = run.time || {};
    var stores = s.kind === 'operator' ? fmt.possessive(s.operator) + ' ' + s.stores + ' ' + s.regionOf + ' stores'
      : s.kind === 'region' ? 'the ' + s.region + "'s " + s.stores + ' stores'
      : s.kind === 'store' ? s.store : 'all ' + s.stores + ' stores';
    var portfolio = s.kind === 'operator' ? fmt.possessive(s.operator) + ' portfolio' : s.kind === 'region' ? 'the ' + s.region : s.kind === 'store' ? s.store : 'the network';
    return {
      stores: stores, portfolio: portfolio, count: String(s.stores), exposed: String(s.exposed),
      week: t.thisWeek ? 'the week of ' + fmt.date(t.thisWeek.start) : 'this week',
      launch: t.launch ? MCX.evidence.item(t.launch.item) : 'launch',
      next: t.nextLaunch ? t.nextLaunch.item : 'the next launch',
      nextDate: t.nextLaunch ? fmt.date(t.nextLaunch.date) : 'its planned date'
    };
  }
  function fill(template, w) { return String(template).replace(/\{(\w+)\}/g, function (m, key) { return w[key] != null ? w[key] : m; }); }

  /** The largest dollar figure in a text: "$44k" -> 44000, "$2.8 million" -> 2800000, "$1,250" -> 1250. */
  function largestDollars(text) {
    var best = 0, pattern = /\$(\d[\d,]*(?:\.\d+)?)(\s?(k|million)\b)?/g, m;
    while ((m = pattern.exec(String(text)))) {
      var v = Number(m[1].replace(/,/g, ''));
      if (m[3] === 'k') v *= 1000;
      if (m[3] === 'million') v *= 1000000;
      if (v > best) best = v;
    }
    return best;
  }

  function propose(plan, run) {
    var c = catalog(), list = (c.actions || {})[plan.name] || [];
    if (!list.length) return [];
    var w = words(run), limits = c.high_impact || {}, answer = run.answer.text();
    var dollars = largestDollars(answer);
    return list.map(function (a) {
      var title = fill(a.title, w), detail = fill(a.detail, w);
      var impact = a.impact, why;
      if (impact === 'auto') {
        if (limits.stores_at_least && run.scope.stores >= limits.stores_at_least) { impact = 'high'; why = 'touches ' + run.scope.stores + ' stores (high impact from ' + limits.stores_at_least + ')'; }
        else if (limits.dollars_at_least && dollars >= limits.dollars_at_least) { impact = 'high'; why = 'the answer puts ' + MCX.fmt.k(dollars) + ' at stake (high impact from ' + MCX.fmt.k(limits.dollars_at_least) + ')'; }
        else { impact = 'low'; why = run.scope.stores + ' stores and ' + (dollars ? MCX.fmt.k(dollars) : 'no dollar figure') + ' at stake: under the high-impact thresholds'; }
      } else {
        why = 'the catalog marks it ' + impact + ' impact';
      }
      var role = a.owner_role;
      return {
        id: MCX.sha256(plan.name + '|' + run.scope.label + '|' + title).slice(0, 10),
        analysis: plan.name, type: a.type, system: a.system, title: title, detail: detail,
        ownerRole: role, approverRole: role, approvers: (c.approvers || {})[role] || [],
        impact: impact, needsApproval: impact === 'high', why: why, status: 'proposed'
      };
    });
  }

  MCX.actions = { propose: propose, words: words, fill: fill, largestDollars: largestDollars };
})(typeof window !== 'undefined' ? window : globalThis);
