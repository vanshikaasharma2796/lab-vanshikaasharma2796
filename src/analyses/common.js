/* =====================================================================
   src/analyses/common.js — what happens to a question nobody planned for

     lookup         a typed question that names a certified metric is
                    answered straight from the semantic layer:
                    term -> metric -> SQL -> rows -> a sentence per row
     out-of-scope   an operator asking about someone else's stores is
                    refused by the persona-scope policy
     no-match       nothing fits: say so, and say what can be asked
     blocked        the guard stopped the question (injection, unsafe
                    request): say which rule fired and what can be asked.
                    The analyst without context has no guard: it runs the
                    question as typed, through the normal router.
   ===================================================================== */
(function (global) {
  'use strict';
  const MCX = global.MCX, fmt = MCX.fmt, E = MCX.evidence;
  const { n, cap, word, list, date, dateRange } = fmt;

  // -------------------------------------------------------------------
  // Reading a typed question as: metric, cut, period
  // -------------------------------------------------------------------
  const CUTS = [
    { test: /\b(by|per|each|across|which|what) (the )?regions?\b|\bregional\b|\bregion by region\b/, by: ['region'], label: 'region' },
    { test: /\b(by|per|each|which) (the )?operators?\b|\boperator by operator\b/, by: ['operator_name'], label: 'operator' },
    { test: /\b(by|per) (lane|kitchen|format)|\blane types?\b|\bkitchen formats?\b|\bsingle lane (vs|versus|and|or) dual\b/, by: ['lane_type', 'has_parallel_staging'], label: 'kitchen format' },
    { test: /\b(by|per|each|which|what) (of my |of the |of our )?stores?\b|\bstore by store\b|\bslowest\b|\bworst\b|\bbest\b/, by: ['store_name'], label: 'store' },
    { test: /\b(by|per|each) week\b|\bweekly\b|\btrend\b|\bweek by week\b|\bover the last\b/, by: ['week_start'], label: 'week' },
    { test: /\b(by|per|each) (item|combo)\b|\bwhich (item|combo)s?\b/, by: ['item_name'], label: 'item' },
    { test: /\b(by|per|each) channel\b/, by: ['channel'], label: 'channel' }
  ];
  const UNITS = [[/secs?$|_s$|^benchmark$/, ' sec'], [/pct|share|rate/, '%'], [/rev|avg_ticket|usd|net_per_day|gross_per_day/, '$']];
  const COUNTS = /^(tickets|stores|days|ds_orders|stores_out|units|naming_double_stack|combo_orders)$/;

  function unitOf(column) { const hit = UNITS.filter((u) => u[0].test(column))[0]; return hit ? hit[1] : ''; }
  function show(column, value) {
    if (value == null) return '—';
    if (typeof value !== 'number') return String(value);
    const unit = unitOf(column), digits = Math.abs(value) < 100 && value !== Math.round(value) ? 1 : 0;
    return unit === '$' ? '$' + n(value, value < 100 ? 2 : 0) : n(value, digits) + unit;
  }
  const NAMES = { avg_dt_secs: 'drive-thru time', benchmark: 'benchmark', secs_vs_benchmark: 'against benchmark', pct_in_benchmark: 'of orders inside benchmark', tickets: 'complaints', days: 'days of data',
    net_per_day: 'net a day', net_rev: 'net revenue', fill_rate_pct: 'shift fill rate', days_of_cover: 'days of cover', ds_share_pct: 'of drive-thru orders', ds_orders: 'Double Stack orders', combo_orders_per_day: 'combo orders a day', stores: 'stores' };
  function plainName(column) { return NAMES[column] || column.replace(/_/g, ' '); }

  /** { model, metrics, by, cut, when, eq, term } or null if the wording names no certified metric. */
  function parse(card, question) {
    const repo = MCX.contextRepo, text = MCX.text.normalise(question);
    const terms = MCX.context.matchTerms(question);
    let found = null;
    terms.forEach((match) => {
      if (found) return;
      Object.keys(repo.models).forEach((name) => {
        if (found) return;
        const metrics = Object.keys(repo.models[name].metrics).filter((m) => repo.models[name].metrics[m].term === match.id);
        if (metrics.length) found = { model: name, metrics: metrics.slice(0, 3), term: match.id };
      });
    });
    if (!found) return null;
    const cut = CUTS.filter((c) => c.test.test(text))[0] || null;
    found.cut = cut;
    found.by = cut ? cut.by : [];
    found.when = /\blast week\b/.test(text) ? 'last' : /\bsince (the )?launch\b|\bsince may\b/.test(text) ? 'launch' : cut && cut.label === 'week' ? 'trend' : 'this';
    found.eq = found.term === 'wait-time-complaint' ? { category: 'wait_time' } : found.model === 'COMBO_REVENUE_DAILY' ? { category: 'Combo' } : null;
    if (found.model !== 'ORDER_TIMING_MART' && found.metrics.indexOf('stores') === -1 && repo.models[found.model].metrics.days) found.metrics.push('days');
    return found;
  }
  MCX.lookup = { parse: parse };

  MCX.analysis('lookup', {
    title: 'Semantic-layer lookup', intent: 'descriptive', anyScope: true,
    terms: [], skills: [], models: [],
    run(ctx) {
      const t = ctx.time, w = ctx.who, a = ctx.answer, ask = parse(ctx.persona, ctx.question);
      if (!ask) throw new Error('nothing to look up');
      const repo = MCX.contextRepo, model = repo.models[ask.model], term = repo.glossary[ask.term];
      const where = {};
      if (model.dimensions.date) {
        if (ask.when === 'last') where.week = 'last';
        else if (ask.when === 'launch') where.since = t.launch.date;
        else if (ask.when === 'trend') where.since = t.trendStart;
        else where.week = 'this';
      }
      if (ask.eq) where.eq = ask.eq;
      const period = !model.dimensions.date ? 'latest' : ask.when === 'last' ? `last week (${dateRange(t.lastWeek.start, t.lastWeek.end)})` : ask.when === 'launch' ? `since the launch on ${date(t.launch.date)}`
        : ask.when === 'trend' ? 'week by week' : `this week (${dateRange(t.thisWeek.start, t.thisWeek.end)}${t.thisWeek.partial ? ', ' + word(t.thisWeek.days) + ' days so far' : ''})`;

      ctx.say(`No playbook was written for this wording, so answering straight from the semantic layer: “${term.name.toLowerCase()}” is a certified metric on ${ask.model}.`, { hold: true });
      if (ask.when === 'this' && t.thisWeek.partial && model.dimensions.date) ctx.policy('partial-week', `"This week" has ${word(t.thisWeek.days)} days of data. Reporting it as it stands, with the days stated.`);
      const spec = { model: ask.model, by: ask.by, metrics: ask.metrics, where: where, order: ask.by.length ? (ask.cut.label === 'week' ? 'week_start' : '2 DESC') : null, limit: ask.cut && ask.cut.label === 'store' ? 10 : null };
      let rows;
      try {
        rows = ctx.q('lookup', spec, `Compile ${ask.metrics.join(', ')} from the ${ask.model} model${ask.cut ? ', cut by ' + ask.cut.label : ''}, for ${w.stores}.`);
      } catch (error) {
        if (!ask.by.length) throw error;
        ctx.say(`${ask.model} cannot be cut by ${ask.cut.label}. Dropping the cut.`);
        ask.cut = null; ask.by = [];
        rows = ctx.q('lookup', { model: ask.model, metrics: ask.metrics, where: where }, `Compile ${ask.metrics.join(', ')} from the ${ask.model} model for ${w.stores}.`);
      }
      ctx.voice();
      const columns = Object.keys(rows[0] || {});
      const dims = columns.filter((c) => typeof rows[0][c] !== 'number' || c === 'has_parallel_staging');
      // "days" is the same on every row of a plain cut: say it once, in the lead.
      const sameDays = columns.indexOf('days') !== -1 && rows.every((row) => row.days === rows[0].days) && ask.cut && ask.cut.label !== 'week';
      const values = columns.filter((c) => dims.indexOf(c) === -1 && !(sameDays && c === 'days'));
      const daysNote = sameDays && ask.when !== 'this' ? `, ${word(rows[0].days)} days of data` : '';
      const counting = COUNTS.test((model.metrics[ask.metrics[0]] || {}).as || ask.metrics[0]);
      const title = counting && !/s$/.test(term.name) ? term.name + 's' : term.name;      // "Wait-time complaints by region"
      const scopeNote = ctx.regionProxy ? ` (${ask.model} stops at region, so this is the ${ctx.regionProxy})` : '';
      const signedToo = (c, v) => (c === 'secs_vs_benchmark' && typeof v === 'number' ? fmt.signed(v) + ' sec' : show(c, v));
      const line = (row) => values.map((c, i) => (i === 0 && values.length === 1 && !COUNTS.test(c) ? show(c, row[c]) : /^(pct|ds_share|secs_vs)/.test(c) || COUNTS.test(c) ? `${signedToo(c, row[c])} ${plainName(c)}` : `${plainName(c)} ${show(c, row[c])}`)).join(', ');
      const label = (row) => (row.lane_type ? E.group(ctx, E.formatOf(row), row.stores).noun : dims.map((c) => (c === 'week_start' ? 'week of ' + date(row[c]) : row[c])).join(' · '));

      if (!rows.length) {
        a.p(`${ctx.g(`${title} for ${w.stores}, ${period}: no rows`, 'lookup', 'persona', 'skill:voice-and-tone')}. The certified table has nothing for that period and scope.`);
        return;
      }
      if (!ask.by.length) {
        a.p(`${ctx.g(`${title} for ${w.stores}, ${period}: ${line(rows[0])}`, 'lookup', 'persona', 'glossary:' + ask.term, 'skill:voice-and-tone')}${scopeNote}.`);
      } else {
        a.listed(`${ctx.g(`${title} by ${ask.cut.label} for ${w.stores}, ${period}`, 'lookup', 'persona', 'glossary:' + ask.term, 'skill:voice-and-tone')}${daysNote}${scopeNote}:`, rows.map((row) => `${cap(String(label(row)))}: ${line(row)}`));
      }
      a.p(`Definition used: ${term.name.toLowerCase()} means ${term.maps_to}${term.not ? `, not ${term.not}` : ''}. This is a direct read of the certified metric; it was not run through a diagnostic playbook, so it describes and does not explain.`);
    }
  });

  // -------------------------------------------------------------------
  // An operator asking about stores that are not theirs
  // -------------------------------------------------------------------
  MCX.analysis('out-of-scope', {
    title: 'Outside the persona\'s scope', intent: 'descriptive',
    terms: ['operators'], skills: [], models: ['ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM'],
    run(ctx) {
      const w = ctx.who, a = ctx.answer, named = ctx.route.named;
      const what = named.kind === 'operator' ? `${named.operator}'s stores` : named.kind === 'store' ? named.store : `the ${named.region} as a whole`;
      ctx.policy('persona-scope', `The question is about ${what}. The persona-scope policy lets a franchise operator see their own stores and nothing else, so that part is not run.`);
      const f = E.formats(ctx, { key: 'own', say: `What can be shown: ${w.stores}, this week against benchmark.` });
      ctx.voice();
      a.p(`${ctx.g(`I can't show you ${what}`, 'policy:persona-scope', 'persona')}. As a franchise operator you see your own stores; figures for other operators, other stores or a whole region are for corporate roles.`);
      a.listed(`${ctx.g(`Here is the same view for ${w.stores} this week`, 'own', 'glossary:operators', 'skill:voice-and-tone')}:`,
        f.rows.map((row) => `${cap(E.group(ctx, E.formatOf(row)).label)}: ${n(row.avg_dt_secs)} sec against a ${n(row.benchmark)} benchmark (${fmt.signed(row.secs_vs_benchmark)}), ${fmt.pct(row.pct_in_benchmark)} of orders inside it.`));
      a.p('If you need a comparison with the rest of the region, your franchise business partner can run it.');
    },
    bare: 'timing'
  });

  // -------------------------------------------------------------------
  // The guard blocked the question
  // -------------------------------------------------------------------
  MCX.analysis('blocked', {
    title: 'Blocked by the guard', intent: 'descriptive', anyScope: true,
    terms: [], skills: [], models: [],
    run(ctx) {
      const a = ctx.answer, guard = ctx.guard || { findings: [], reason: 'was blocked' };
      const rules = guard.findings.filter((f) => f.severity === 'high').map((f) => f.rule);
      const bank = (MCX.catalog.personas.filter((p) => p.id === ctx.persona.id)[0] || { questions: [] }).questions;
      const hero = bank.filter((q) => q.hero)[0] || bank[0];
      ctx.policy('pinned-instructions', `The guard blocked the question (${rules.join(', ')}). Nothing is queried and nothing is retrieved.`);
      a.p(`${ctx.g("I can't run that request", 'guard', 'policy:pinned-instructions')}: the question ${guard.reason || 'was blocked'}. The rules I follow do not change from inside a question, and no answer may carry personal data in bulk or secrets.`);
      if (hero) a.p(`Ask about the business in your own words instead, for example: “${hero.text}”`);
    },
    bare: null      // the runtime runs the question as typed through the normal router instead
  });

  // -------------------------------------------------------------------
  // Nothing fits
  // -------------------------------------------------------------------
  MCX.analysis('no-match', {
    title: 'No certified answer', intent: 'descriptive', anyScope: true,
    terms: [], skills: [], models: [],
    run(ctx) {
      const a = ctx.answer, bank = (MCX.catalog.personas.filter((p) => p.id === ctx.persona.id)[0] || { questions: [] }).questions;
      const resolved = ctx.pack.terms.filter((item) => item.match).map((item) => `“${item.match}”`);
      ctx.say('No analysis and no certified metric matches this wording. Saying so rather than guessing.', { hold: true });
      a.p(`${ctx.g("I don't have a certified way to answer that", 'persona')}, so I won't improvise one. ` +
        (resolved.length ? `I recognised ${list(resolved)} from the glossary, but nothing in the context layer says how to turn the question into a metric or a playbook.` : 'None of its wording matches a glossary term, a certified metric or a playbook.'));
      if (ctx.route.near) a.p(`The closest question I do know how to answer is: “${ctx.route.near}”`);
      a.listed('Questions like these are covered:', bank.slice(0, 5).map((q) => q.text));
      a.p('You can also ask for a certified metric directly, for example “drive-thru time by region last week” or “wait-time complaints by store this week”.');
    },
    bare(b, kit) {
      const tables = b.q('raw_tables', "\n  SELECT name FROM BRONZE.sqlite_master\n  WHERE type = 'table'\n  ORDER BY name", 'List the raw tables and look for anything that sounds like the question.');
      kit.ask(b, 'Which table holds this? There are ' + tables.length + ' raw tables (' + list(tables.slice(0, 4).map((r) => r.name)) + ', …) and no description of any of them. ' + b.b("I'd be guessing from the names") + '.');
      kit.ask(b, 'What exactly should be measured, over which days, and for which stores?');
      kit.limit(b, b.b("I can't answer this from table names alone") + '. Point me at the table and the definition and I will run it.');
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
