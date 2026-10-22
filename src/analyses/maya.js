/* =====================================================================
   src/analyses/maya.js — Maya, Service Analyst

   Maya pulls it all together for Marcus J. Williams and for leadership.
   Her answers are written to be pasted into a brief: scope and
   definitions, what moved, what was ruled out, the size of it, and how
   sure the reading is.

     maya/company-drive-thru-average   What's the company-wide drive-thru average this week?
     maya/regions-8-week-trend         How did the regions trend over the last 8 weeks?
     maya/marcus-drive-thru-up         Why is Marcus's drive-thru time up this week?
     maya/execution-or-store-mix       Is Marcus's slowdown his execution or his store mix?
     maya/monday-digest-lead           Which findings should the Monday ops digest lead with?
     maya/marcus-first-moves           What should Marcus do first, and what can wait?
     maya/revenue-at-risk-4-weeks      What's the projected revenue at risk if drive-thru stays at this level for 4 weeks?
     maya/marcus-three-prep-stations   What if Marcus gets parallel prep stations at his three hardest-hit stores?

   The four questions that name Marcus are scoped to his stores by the
   context layer (ctx.scope); the other four are network-wide.
   ===================================================================== */
(function (global) {
  'use strict';
  const MCX = global.MCX, fmt = MCX.fmt, E = MCX.evidence, L = E.label;
  const { n, usd, k, kRange, pct, signed, cap, word, list, date, dateRange } = fmt;

  const SEGMENT = { order: 'order time', prep: 'prep time', window: 'window time' };
  const COLUMN = { order: 'order_s', prep: 'prep_s', window: 'window_s' };
  const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };

  function days(t) { return `${dateRange(t.thisWeek.start, t.thisWeek.end)}, ${word(t.thisWeek.days)} days of data`; }
  function inside(secs) { return secs > 0 ? `${n(secs)} sec over` : `${n(Math.abs(secs))} sec inside`; }
  function first(name) { return String(name).split(' ')[0]; }
  /** A count written in the question: "4 weeks", "three stores". */
  function countIn(question, unit, fallback) {
    const m = new RegExp('(\\d+|' + Object.keys(WORDS).join('|') + ')\\s+(?:[a-z-]+\\s+){0,3}?' + unit, 'i').exec(question);
    if (!m) return fallback;
    return /^\d+$/.test(m[1]) ? Number(m[1]) : WORDS[m[1].toLowerCase()];
  }
  function moves(ctx, before, after) {
    return ctx.params('drive-thru-timing').segments
      .map((name) => ({ name, change: after[COLUMN[name]] - before[COLUMN[name]], before: before[COLUMN[name]], after: after[COLUMN[name]] }))
      .sort((p, q) => q.change - p.change);
  }

  // ===================================================================
  // What's the company-wide drive-thru average this week?
  // ===================================================================
  MCX.analysis('maya/company-drive-thru-average', {
    title: 'Company-wide average', intent: 'descriptive', scope: 'network',
    terms: ['drive-thru-time', 'benchmark', 'reporting-week'],
    skills: ['ontology'],
    models: ['ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM'],
    bare: { topic: 'timing', cannot: 'I can give a network average on a column and a window I chose.' },
    run(ctx) {
      const t = ctx.time, a = ctx.answer, term = ctx.term('drive-thru-time');
      ctx.say('Reading the certified GOLD tables.');
      if (t.thisWeek.partial) ctx.policy('partial-week', `Data ends ${fmt.dayDate(t.maxDate)}: "this week" is ${days(t)}. The average can be reported with the days stated.`);
      const weeks = E.readWeeks(ctx, E.weeks(ctx, { key: 'weeks', say: 'The network average by week, for the figure and its reference points.' }));
      const f = E.formats(ctx, { key: 'formats', say: 'An average over mixed kitchens can hide a split. Cut this week by lane type and parallel staging.' });
      ctx.voice();
      const now = weeks.now, last = weeks.launchWeek;

      a.p(`Scope and definition: all ${ctx.scope.stores} stores; drive-thru time is gate to window (${term.maps_to.replace('GOLD.', '')}), read against each store's own benchmark.`);
      a.p(`${ctx.g(`The company-wide average is ${n(now.avg_dt_secs)} sec this week, ${n(Math.abs(now.secs_vs_benchmark), 1)} sec ${now.secs_vs_benchmark > 0 ? 'over' : 'inside'} the blended benchmark of ${n(now.benchmark, 1)}`, 'weeks', 'glossary:drive-thru-time', 'glossary:benchmark')}, ` +
        `with ${pct(now.pct_in_benchmark)} of orders served inside benchmark. ${ctx.g(`Caveat: the week has ${word(t.thisWeek.days)} days of data (${dateRange(t.thisWeek.start, t.thisWeek.end)})`, 'policy:partial-week', 'glossary:reporting-week')}; quote the average, not a weekly total.`);
      a.p(`Reference points: ${last && last !== now ? `the last full week (${dateRange(t.lastWeek.start, t.lastWeek.end)}) averaged ${n(last.avg_dt_secs)} sec; ` : ''}the ${word(weeks.before.length)} weeks before the ${E.item(t.launch.item)} launch averaged ${n(weeks.baseline)}, with ${pct(weeks.before[0].pct_in_benchmark)} of orders inside benchmark.`);
      a.listed(`${ctx.g('The average hides a split by kitchen format', 'formats', 'skill:ontology')}:`, ['exposed', 'retrofitted', 'dual'].filter((key) => f[key]).map((key) =>
        `${cap(L[key])} (${f[key].stores}): ${n(f[key].avg_dt_secs)} sec against ${n(f[key].benchmark)}, ${inside(f[key].secs_vs_benchmark)}; ${pct(f[key].pct_in_benchmark)} inside benchmark.`));
      a.p(`For a brief: ${ctx.g(`quote ${n(now.avg_dt_secs)} against ${n(now.benchmark)} with the ${word(t.thisWeek.days)}-day caveat, and lead with the format split`, 'weeks', 'formats')}. On the average alone the network looks roughly on benchmark; ${f.exposed ? `${f.exposed.stores} stores are ${n(f.exposed.secs_vs_benchmark)} sec over it.` : ''}`);
      ctx.facts = { now, baseline: weeks.baseline };
    }
  });

  // ===================================================================
  // How did the regions trend over the last 8 weeks?
  // ===================================================================
  MCX.analysis('maya/regions-8-week-trend', {
    title: 'Regional trend', intent: 'descriptive', scope: 'network',
    terms: ['region', 'reporting-week', 'drive-thru-time', 'benchmark', 'staffing-fill-rate'],
    skills: ['ontology'],
    models: ['ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM', 'STAFFING_DAILY_FACT'],
    bare: 'regions',
    run(ctx) {
      const t = ctx.time, a = ctx.answer;
      ctx.say('Reading the certified GOLD tables.');
      const rows = ctx.q('trend', { model: 'ORDER_TIMING_MART', by: ['region', 'week_start'], metrics: ['days', 'drive_thru_time', 'secs_vs_benchmark'], where: { since: t.trendStart }, order: 'f.region, t.week_start' },
        `Drive-thru time by region and week: eight full weeks from ${date(t.trendStart)}, plus this one.`);
      if (t.thisWeek.partial) ctx.policy('partial-week', `The last point is a partial week (${days(t)}). It is an average, so it can sit on the trend, flagged.`);
      const regions = []; rows.forEach((row) => { if (regions.indexOf(row.region) === -1) regions.push(row.region); });
      const series = regions.map((region) => {
        const own = rows.filter((row) => row.region === region), before = own.filter((row) => fmt.addDays(row.week_start, 6) < t.launch.date);
        return { region, start: before[0], end: before[before.length - 1], launch: own[own.length - 2], now: own[own.length - 1], drift: before[before.length - 1].avg_dt_secs - before[0].avg_dt_secs };
      }).sort((p, q) => q.now.secs_vs_benchmark - p.now.secs_vs_benchmark);
      const drifting = series.filter((s) => s.drift >= 1).sort((p, q) => q.drift - p.drift)[0];
      let who = null, fill = null;
      if (drifting) {
        const ops = ctx.q('drift', { model: 'ORDER_TIMING_MART', by: ['operator_name'], where: { region: drifting.region, since: t.trendStart, before: t.launch.date },
          columns: [{ sql: `ROUND(AVG(CASE WHEN t.week_start = '${drifting.end.week_start}' THEN t.avg_dt_secs END) - AVG(CASE WHEN t.week_start = '${drifting.start.week_start}' THEN t.avg_dt_secs END), 1)`, as: 'secs_gained' }],
          metrics: ['stores'], order: 'secs_gained DESC' }, `The ${drifting.region} was already creeping up before the launch. Which operator?`);
        who = ops[0];
        const staff = E.staffing(ctx, { key: 'fill', scope: { kind: 'operator', operator: who.operator_name }, say: `Shift fill rate for ${who.operator_name}'s stores over the same weeks.` });
        fill = { then: staff[0].fill_rate_pct, now: staff[staff.length - 1].fill_rate_pct };
      }
      ctx.voice();
      const top = series[0];

      a.p(`${ctx.g(`Flat for ${word(rows.filter((row) => row.region === top.region && fmt.addDays(row.week_start, 6) < t.launch.date).length)} weeks, then a break in the week of ${date(top.launch.week_start)} in all ${word(series.length)} regions, largest in the ${top.region}`, 'trend', 'glossary:region', 'skill:ontology')}.`);
      a.list(series.map((s) => `${s.region}: ${Math.abs(s.drift) < 1 ? `${n(s.end.avg_dt_secs)} sec through ${fmt.month(s.end.week_start)}` : `${n(s.start.avg_dt_secs)} → ${n(s.end.avg_dt_secs)} sec before launch`}, ${n(s.launch.avg_dt_secs)} in the launch week, ` +
        `${n(s.now.avg_dt_secs)} this week — ${inside(s.now.secs_vs_benchmark)} its blended benchmark.`));
      const notes = [];
      if (drifting && who) {
        notes.push(`${ctx.g(`The ${drifting.region} was the only region already drifting before the launch`, 'trend', 'drift')} (${signed(drifting.drift, 1)} sec across those weeks), and the drift is one operator: ` +
          `${who.operator_name}'s ${who.stores} stores gained ${n(who.secs_gained)} sec while ${ctx.g(`shift fill rate fell from ${pct(fill.then)} to ${pct(fill.now)}`, 'fill', 'glossary:staffing-fill-rate')}.`);
      }
      notes.push(`${ctx.g('The last two points are direction, not level', 'policy:partial-week', 'glossary:reporting-week')}: the week of ${date(top.launch.week_start)} mixes ${word(fmt.daysBetween(top.launch.week_start, t.launch.date))} days before the ${date(t.launch.date)} launch with ${word(7 - fmt.daysBetween(top.launch.week_start, t.launch.date))} after, and this week has ${word(t.thisWeek.days)} days of data.`);
      a.listed('Two things to note:', notes, true);
      a.p(`Regions differ because their kitchens differ; a store-format cut of the same eight weeks shows one format moving in all four.`);
      ctx.facts = { series: series.map((s) => [s.region, s.start.avg_dt_secs, s.end.avg_dt_secs, s.launch.avg_dt_secs, s.now.avg_dt_secs]), who };
    }
  });

  // ===================================================================
  // Why is Marcus's drive-thru time up this week?
  // ===================================================================
  MCX.analysis('maya/marcus-drive-thru-up', {
    title: 'Diagnosis brief', intent: 'diagnostic',
    terms: ['drive-thru-time', 'benchmark', 'staffing-fill-rate'],
    skills: ['diagnostic-playbook', 'seasonality-check', 'drive-thru-timing', 'what-if-analysis'],
    models: ['ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM', 'MENU_CHANGE_LOG', 'DAILY_SALES_FACT', 'STAFFING_DAILY_FACT'],
    bare: 'timing',
    run(ctx) {
      const t = ctx.time, s = ctx.scope, w = ctx.who, a = ctx.answer, found = {};
      const X = E.group(ctx, 'exposed'), D = E.group(ctx, 'dual'), who = first(s.operator || w.name);
      const steps = {
        scope() {
          E.calendar(ctx);
          if (t.thisWeek.partial) ctx.policy('partial-week', `"This week" is ${days(t)}. Averages can be compared; the caveat goes in the brief.`);
        },
        confirm() { found.weeks = E.readWeeks(ctx, E.weeks(ctx, { say: `Confirm the metric moved — weekly trend for ${w.stores}.` })); },
        seasonality() {
          found.lastYear = E.lastYear(ctx, { say: 'Rule out seasonality — the same days last year.' });
          found.weather = E.weather(ctx, { say: 'Rule out weather — rain in these markets this week.' });
          found.fill = E.staffing(ctx, { say: 'Rule out staffing — shift fill rate for the same stores, week by week.' });
        },
        spread() { found.formats = E.formats(ctx, { say: 'Spread — which stores moved? Lane type and parallel staging.' }); },
        decompose() { found.segments = E.segments(ctx, { say: `Decompose — order, prep and window before and after ${date(t.launch.date)}.` }); },
        correlate() { found.menu = E.menu(ctx, { say: 'Correlate — the menu change log at the break.' }); },
        quantify() { found.risk = E.risk(ctx, { atRiskOnly: true, say: 'Quantify — revenue at risk with the what-if rule.' }); }
      };
      ctx.say('Walking the playbook against the certified GOLD tables.');
      ctx.skill('diagnostic-playbook').steps.forEach((name) => { if (steps[name]) steps[name](); });
      ['weeks', 'formats', 'segments', 'menu'].forEach((need) => { if (!found[need]) throw new Error('the diagnostic playbook must keep its confirm, spread, decompose and correlate steps'); });
      ctx.voice();

      const W = found.weeks, f = found.formats, x = f.exposed, d = f.dual, seg = found.segments.exposed, menu = found.menu, mv = moves(ctx, seg.before, seg.after);
      a.p(`Scope and definitions. ${cap(w.stores)}: ${s.exposed} single-lane and ${s.dual} dual-lane. Drive-thru time is gate to window, read against each store's benchmark. This week is ${days(t)}.`);
      a.p(`What moved. Portfolio drive-thru time is ${n(W.now.avg_dt_secs)} sec against ~${n(W.baseline)} in the ${word(W.before.length)} weeks before. ` +
        `${ctx.g(`The whole rise is in ${who}'s ${X.count} ${X.noun}: ${n(x.avg_dt_secs)} sec against a ${n(x.benchmark)} benchmark (${signed(x.secs_vs_benchmark)})`, 'spread', 'confirm', 'glossary:drive-thru-time', 'glossary:benchmark')}.` +
        (d ? ` His ${D.count} ${D.noun} are at ${n(d.avg_dt_secs)}, ${inside(d.secs_vs_benchmark)}.` : ''));
      a.p(`Cause. ${ctx.g(`The break sits at the ${date(t.launch.date)} ${E.item(t.launch.item)} launch`, 'correlate', 'decompose', 'skill:diagnostic-playbook')}` +
        (menu.launch ? ` (${menu.launch.requires_two_step_prep ? 'two-step prep, ' : ''}${menu.launch.ops_impact_level} ops impact${menu.alert ? `; ops alert ${date(menu.alert.event_date)}` : ''})` : '') +
        `. At his single-lane stores ${ctx.g(`${SEGMENT[mv[0].name]} went ${n(mv[0].before)} → ${n(mv[0].after)} sec`, 'decompose', 'skill:drive-thru-timing')}` +
        (mv[1].change >= 3 ? ` and ${SEGMENT[mv[1].name]} ${n(mv[1].before)} → ${n(mv[1].after)}` : '') + `; ${SEGMENT[mv[2].name]} did not move.`);
      if (found.lastYear && found.weather && found.fill) {
        const fill = found.fill, fillBefore = fill.filter((row) => fmt.addDays(row.week_start, 6) < t.launch.date);
        const then = fillBefore.reduce((sum, row) => sum + row.fill_rate_pct, 0) / (fillBefore.length || 1), now = fill[fill.length - 1].fill_rate_pct;
        a.p(`${ctx.g('Ruled out: seasonality, weather and staffing', 'seasonality', 'weather', 'staffing', 'skill:seasonality-check')}. The same days last year ran ${n(found.lastYear.then.avg_dt_secs)} sec; ` +
          `${found.weather.dry ? `all ${word(t.thisWeek.days)} days were dry` : `rain fell only on ${list(found.weather.wet.map(fmt.weekday))}`}; his shift fill rate is ${pct(now)} against ${pct(then)} before the launch.`);
      }
      if (found.risk && found.risk.stores) {
        const risk = found.risk;
        a.p(`Size. ${ctx.g(`~${k(risk.weekly.central)} a week of revenue at risk (range ${kRange(risk.weekly.low, risk.weekly.high)})`, 'quantify', 'skill:what-if-analysis')} at the ${word(risk.stores)} stores, on the rule of ${pct(risk.rule.share_of_orders * 100)} of drive-thru orders for every ${risk.rule.every_secs} sec over benchmark.`);
      }
      a.p(`Confidence. High on cause: one kitchen format moved, one segment moved, on the launch date. Lower on level: ${word(t.thisWeek.days)} days of data this week, so the ${n(x.avg_dt_secs)}-sec figure will settle as the week fills in.`);
      ctx.facts = { baseline: W.baseline, now: W.now.avg_dt_secs, x, d };
    }
  });

  // ===================================================================
  // Is Marcus's slowdown his execution or his store mix?
  // ===================================================================
  MCX.analysis('maya/execution-or-store-mix', {
    title: 'Execution or store mix', intent: 'diagnostic',
    terms: ['benchmark', 'lane-type', 'parallel-staging', 'staffing-fill-rate'],
    skills: ['operator-scorecard'],
    models: ['ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM', 'STAFFING_DAILY_FACT'],
    bare: { topic: 'ranking', cannot: 'I can rank his stores against others on raw seconds, which says nothing about whether the comparison is like for like.' },
    run(ctx) {
      const t = ctx.time, s = ctx.scope, a = ctx.answer, name = s.operator, who = first(name);
      ctx.say('Applying the operator scorecard: like-for-like kitchens only.');
      const peers = ctx.q('peers', { model: 'ORDER_TIMING_MART', by: ['operator_name', 'region', 'lane_type', 'has_parallel_staging'], metrics: ['stores', 'secs_vs_benchmark', 'window_time'], where: { week: 'this' }, scope: false,
        order: 'f.lane_type DESC, f.has_parallel_staging, secs_vs_benchmark DESC' }, 'Every operator by kitchen format this week, so his stores are compared with the same kind of store.');
      const mix = ctx.q('mix', { model: 'FRANCHISE_STORE_DIM', by: ['operator_name'], metrics: ['stores'], scope: false,
        columns: [{ sql: "SUM(CASE WHEN f.lane_type = 'single_lane' AND f.has_parallel_staging = FALSE THEN 1 ELSE 0 END)", as: 'exposed' }], order: 'f.operator_name' },
        'How much of each portfolio is single-lane without parallel staging.');
      const weeks = E.readWeeks(ctx, E.weeks(ctx, { key: 'own_trend', say: `Execution leaves a trail before the event. ${name}'s stores, week by week.` }));
      const fill = E.staffing(ctx, { say: 'And his shift fill rate over the same weeks.' });
      ctx.voice();

      const exposed = E.only(peers, 'exposed'), dual = E.only(peers, 'dual');
      const mine = { x: exposed.filter((r) => r.operator_name === name)[0], d: dual.filter((r) => r.operator_name === name)[0] };
      const sameRegion = exposed.filter((r) => r.region === s.regionOf && r.operator_name !== name);
      const elsewhere = exposed.filter((r) => r.region !== s.regionOf);
      const avg = (rows) => rows.reduce((sum, r) => sum + r.secs_vs_benchmark * r.stores, 0) / (rows.reduce((sum, r) => sum + r.stores, 0) || 1);
      const otherDual = dual.filter((r) => r.operator_name !== name);
      const myMix = mix.filter((r) => r.operator_name === name)[0], rest = mix.filter((r) => r.operator_name !== name);
      const restShare = rest.reduce((sum, r) => sum + r.exposed, 0) / rest.reduce((sum, r) => sum + r.stores, 0) * 100;
      const range = [Math.min.apply(null, elsewhere.map((r) => r.secs_vs_benchmark)), Math.max.apply(null, elsewhere.map((r) => r.secs_vs_benchmark))];
      const fillBefore = fill.filter((row) => fmt.addDays(row.week_start, 6) < t.launch.date), fillNow = fill[fill.length - 1].fill_rate_pct;
      const likeForLike = !sameRegion.length || Math.abs(mine.x.secs_vs_benchmark - avg(sameRegion)) <= 5;

      a.p(`${ctx.g(`Store mix. On like-for-like kitchens ${who} runs level with his peers`, 'peers', 'skill:operator-scorecard')}; he has more of the kitchens the ${E.item(t.launch.item)} slows.`);
      a.list([
        `${ctx.g(`His ${mine.x.stores} single-lane stores without parallel staging are ${n(mine.x.secs_vs_benchmark)} sec over benchmark this week`, 'peers', 'glossary:benchmark')}. ` +
          (sameRegion.length ? `${list(sameRegion.map((r) => `${r.operator_name}'s ${r.stores} in the same region are ${n(r.secs_vs_benchmark)} over`))}. ` : '') +
          `Elsewhere the same format runs ${n(range[0])}–${n(range[1])} sec over, by region.`,
        mine.d ? `His ${mine.d.stores} dual-lane stores are ${inside(mine.d.secs_vs_benchmark)} benchmark; the other operators' dual-lane stores average ${inside(avg(otherDual))}.` : null,
        `${ctx.g(`${pct(myMix.exposed / myMix.stores * 100)} of his stores are that exposed format, against ${pct(restShare)} for the other operators`, 'mix', 'glossary:parallel-staging')}. That mix is why his portfolio average moved more than the network's.`,
        `${ctx.g(`Nothing was drifting before the launch`, 'own_trend', 'staffing', 'glossary:staffing-fill-rate')}: ${n(weeks.before[0].avg_dt_secs)} sec in the week of ${date(weeks.before[0].week_start)}, ${n(weeks.before[weeks.before.length - 1].avg_dt_secs)} in the week of ${date(weeks.before[weeks.before.length - 1].week_start)}, ` +
          `with shift fill rate at ${pct(fillBefore[0].fill_rate_pct)} then and ${pct(fillNow)} now.`
      ]);
      a.p(`Verdict, in the scorecard's terms: ${ctx.g(likeForLike ? 'structural, not execution' : 'mostly structural, with a gap to peers worth a look', 'skill:operator-scorecard', 'peers', 'mix')}. ` +
        `His exposed kitchens are over benchmark and his dual-lane kitchens are fine, so the problem is the kitchen: he needs parallel prep stations, not an operations review.`);
      a.p(`Confidence: high. The comparison is same format, same region, same week. The caveat is the week itself: ${days(t)}.`);
      ctx.facts = { mine, sameRegion, restShare };
    }
  });

  // ===================================================================
  // Which findings should the Monday ops digest lead with?
  // ===================================================================
  MCX.analysis('maya/monday-digest-lead', {
    title: 'Monday ops digest', intent: 'prescriptive', scope: 'network',
    terms: ['benchmark', 'revenue-at-risk', 'days-of-cover', 'staffing-fill-rate', 'combo-revenue'],
    skills: ['ops-digest', 'what-if-analysis', 'supply-allocation'],
    models: ['ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM', 'DAILY_SALES_FACT', 'INVENTORY_DAILY_FACT', 'DC_STOCK_FACT', 'STAFFING_DAILY_FACT', 'COMBO_REVENUE_DAILY', 'MENU_CHANGE_LOG'],
    bare(b, kit) {
      const who = kit.identify(b);
      const t = kit.timing(b, who);
      kit.events(b, t.max);
      kit.ask(b, 'What does the digest rank by? Dollars, stores affected, or how unusual the move is? Nothing in the raw warehouse says what leadership wants first, so ' + b.b('I would be choosing the headline myself') + '.');
      kit.ask(b, 'Which teams feed it? I can see timing, POS, staffing, tickets, stock and promo tables, with no definitions joining them.');
      kit.limit(b, 'I can hand you a list of things that moved. ' + b.b("I can't size them in dollars or say which needs a decision") + ', because the raw tables hold no benchmark, no revenue-at-risk rule and no digest format.');
    },
    run(ctx) {
      const t = ctx.time, a = ctx.answer, digest = ctx.params('ops-digest'), supply = ctx.params('supply-allocation');
      const firstWeekEnd = fmt.addDays(t.trendStart, 6);
      ctx.say(`Building the digest from the certified GOLD tables: at most ${word(digest.max_findings)} findings, ranked by dollars and by whether a decision is needed.`);
      const f = E.formats(ctx, { key: 'formats', say: 'Finding one candidate — drive-thru by kitchen format this week.' });
      const risk = E.risk(ctx, { atRiskOnly: true, say: 'Its size in dollars, with the what-if rule.' });
      const cover = ctx.q('cover', { model: 'INVENTORY_DAILY_FACT', by: ['region'], metrics: ['days_of_cover'], where: { eq: { component: 'Stack Sauce', date: t.maxDate } }, order: 'days_of_cover' },
        'Second candidate — Stack Sauce cover in stores, by region, on the latest date.');
      const out = ctx.one('stockouts', { model: 'INVENTORY_DAILY_FACT', by: ['region'], metrics: ['stockout_hours', 'stores_out'], where: { eq: { component: 'Stack Sauce' }, since: t.launch.date, raw: ['i.stockout_hours > 0'] }, order: 'stockout_hours DESC' },
        'Any stockouts since launch.');
      const dc = ctx.q('dc', { model: 'DC_STOCK_FACT', by: ['dc_name', 'region', 'on_hand', 'weekly_usage', 'next_delivery_date'], where: { eq: { item: 'Stack Sauce' } }, order: 'dc.on_hand / dc.weekly_usage' },
        'And what the distribution centres hold against weekly usage.');
      const fill = ctx.q('fill', { model: 'STAFFING_DAILY_FACT', by: ['operator_name'],
        columns: [{ sql: `ROUND(AVG(CASE WHEN s.date <= '${firstWeekEnd}' THEN s.shift_fill_rate END) * 100, 1)`, as: 'fill_then' },
          { sql: `ROUND(AVG(CASE WHEN s.date >= '${t.launch.date}' THEN s.shift_fill_rate END) * 100, 1)`, as: 'fill_now' }],
        where: { since: t.trendStart }, order: 'fill_now - fill_then', limit: 1 }, 'Third candidate — any operator whose shift fill rate has slipped.');
      const combos = ctx.q('combos', { model: 'COMBO_REVENUE_DAILY', split: { at: t.launch.date, before: 'pre', after: 'post' }, metrics: ['days', 'net_per_day'], where: { eq: { category: 'Combo' }, from: t.baseline.from, to: t.maxDate }, order: 'period DESC' },
        'Below the fold — did combo revenue really dip? Per day, before and after.');
      const menu = E.menu(ctx, { key: 'menu', planned: true, say: 'And what is next on the menu calendar.' });
      ctx.voice();

      const x = f.exposed, short = cover[0], lowDc = dc[0], op = fill[0], by = E.index(combos, 'period');
      const comboChange = (by.post.net_per_day - by.pre.net_per_day) / by.pre.net_per_day * 100;
      const next = menu.planned.filter((row) => row.requires_two_step_prep)[0];
      const dcDays = lowDc.on_hand / (lowDc.weekly_usage / 7), slipped = op && op.fill_then - op.fill_now >= 3;

      a.p(`${ctx.g(`Lead with ${word(slipped ? 3 : 2)} findings, in this order`, 'skill:ops-digest', 'quantify')}. Each has one number, one decision and one caveat.`);
      const lines = [
        `${ctx.g(`The ${E.item(t.launch.item)} launch has put ${x.stores} single-lane kitchens ${n(x.secs_vs_benchmark)} sec over benchmark`, 'formats', 'glossary:benchmark')}. Number: ${ctx.g(`~${k(risk.weekly.central)} a week of drive-thru revenue at risk`, 'quantify', 'skill:what-if-analysis', 'glossary:revenue-at-risk')}. ` +
          `Decision: mandate pre-staging at all ${x.stores} now, and fund parallel prep stations for the worst. Caveat: this week is ${word(t.thisWeek.days)} days of data.`,
        `${ctx.g(`Stack Sauce is short in the ${short.region}`, 'cover', 'glossary:days-of-cover')}. Number: ${n(short.days_of_cover, 1)} days of store cover against a ${word(supply.target_cover_days)}-day target` +
          (out.stockout_hours ? `, after ${n(out.stockout_hours)} stockout hours at ${word(out.stores_out)} stores` : '') + `; the ${lowDc.dc_name} holds ${n(dcDays, 1)} days of regional usage and its next delivery is ${date(lowDc.next_delivery_date)}. ` +
          `Decision: ${ctx.g('approve a transfer between distribution centres', 'dc', 'skill:supply-allocation')} before then. Caveat: cover is a regional average; stores differ.`
      ];
      if (slipped) {
        lines.push(`${ctx.g(`${op.operator_name}'s shift fill rate has gone from ${pct(op.fill_then)} to ${pct(op.fill_now)}`, 'fill', 'glossary:staffing-fill-rate')}, a staffing problem the launch is masking. ` +
          `Decision: an operations review. Caveat: his single-lane stores are also hit by the launch, so the two effects have to be separated.`);
      }
      a.list(lines, true);
      a.p(`Open with the segment view, not the network average: the digest format asks for it when an average hides a split, and this one does.`);
      a.p(`Below the fold: ${ctx.g(`combo revenue did not dip`, 'combos', 'glossary:combo-revenue')} (${signed(comboChange)}% per day since launch; the weekly drop is the partial week)` +
        (next ? `; and ${next.item_name}, another two-step item, is planned for ${date(next.event_date)}.` : '.'));
      ctx.facts = { risk: risk.weekly, short, dcDays, op, comboChange };
    }
  });

  // ===================================================================
  // What should Marcus do first, and what can wait?
  // ===================================================================
  MCX.analysis('maya/marcus-first-moves', {
    title: 'First moves', intent: 'prescriptive',
    terms: ['pre-staging', 'benchmark', 'revenue-at-risk', 'combo-revenue', 'retrofit-kit'],
    skills: ['ops-playbook', 'what-if-analysis'],
    models: ['ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM', 'DAILY_SALES_FACT', 'COMBO_REVENUE_DAILY', 'DC_STOCK_FACT'],
    bare: { topic: 'timing' },
    run(ctx) {
      const t = ctx.time, s = ctx.scope, w = ctx.who, a = ctx.answer, who = first(s.operator || w.name);
      const play = ctx.params('ops-playbook'), model = ctx.params('what-if-analysis'), item = E.item(t.launch.item);
      const X = E.group(ctx, 'exposed'), D = E.group(ctx, 'dual');
      ctx.say('Walking the ops playbook against the certified GOLD tables.');
      const f = E.formats(ctx, { key: 'formats', say: `Where ${w.stores} stand this week, by kitchen format.` });
      const risk = E.risk(ctx, { atRiskOnly: true, say: 'Order the work by revenue at risk, store by store.' });
      const combos = ctx.q('combos', { model: 'COMBO_REVENUE_DAILY', split: { at: t.launch.date, before: 'pre', after: 'post' }, metrics: ['days', 'net_per_day'], where: { eq: { category: 'Combo' }, from: t.baseline.from, to: t.maxDate }, order: 'period DESC' },
        'Is combo revenue something he has to act on? Per day, before and after the launch.');
      const kits = ctx.q('kits', { model: 'DC_STOCK_FACT', by: ['dc_name', 'on_hand', 'lead_time_days', 'unit_cost_usd'], where: { eq: { item: 'PPS-2 retrofit kit' } } }, 'If it comes to step 3: retrofit kits at his distribution centre.');
      ctx.voice();

      const x = f.exposed, d = f.dual, stage = model.pre_stage_secs, crew = model.crew_forward_secs, by = E.index(combos, 'period');
      const both = [x.avg_dt_secs - stage[1] - crew[1], x.avg_dt_secs - stage[0] - crew[0]];
      const top = risk.hit.slice(0, 3), topShare = top.reduce((sum, r) => sum + r.weekly_rev_at_risk, 0) / risk.weekly.central * 100;
      const comboChange = (by.post.net_per_day - by.pre.net_per_day) / by.pre.net_per_day * 100, kit = kits[0];

      a.p(`${ctx.g(`First: the playbook's two free steps at ${who}'s ${X.count} ${X.noun}, starting tomorrow`, 'skill:ops-playbook', 'formats', 'glossary:pre-staging')}. Everything else can wait for the ${word(play.review_after_trading_days)}-day review.`);
      a.listed('Do first:', [
        `Pre-stage ${item} components in the ${play.pre_rush.join(' and ')} pre-rush: ${stage.join('–')} sec back.`,
        `Move one crew member forward into those slots: another ${crew.join('–')}. ${ctx.g(`Together: ${n(x.avg_dt_secs)} sec → about ${n(both[0])}–${n(both[1])}, against a ${n(x.benchmark)} benchmark`, 'formats', 'skill:what-if-analysis', 'glossary:benchmark')}.`,
        `Start where the money is: ${ctx.g(`${list(top.map((r) => `${r.store_name} (${k(r.weekly_rev_at_risk)})`))} a week at risk`, 'quantify', 'glossary:revenue-at-risk')} — ${pct(topShare)} of the ~${k(risk.weekly.central)} a week across the ${word(risk.stores)}.`
      ], true);
      a.listed('Can wait:', [
        d ? `His ${D.count} ${D.noun}: ${inside(d.secs_vs_benchmark)} benchmark. Leave them alone.` : null,
        `${ctx.g(`Combo revenue: no real dip`, 'combos', 'glossary:combo-revenue')}. ${cap(signed(comboChange))}% per day since launch in the ${ctx.regionProxy || s.regionOf}; the weekly drop is the partial week.`,
        `The parallel prep station decision: only if window time is still above ${play.escalate_above_window_secs} sec at the review. ${ctx.g(`The ${kit.dc_name} has ${n(kit.on_hand)} kits on hand at ${usd(kit.unit_cost_usd)} installed`, 'kits', 'glossary:retrofit-kit')}, so nothing is lost by waiting ${word(play.review_after_trading_days)} days.`
      ]);
      a.p(`Caveat: this week is ${days(t)}. The order of the stores will not change; the dollar figures may move a little as the week fills in.`);
      ctx.facts = { both, top: top.map((r) => r.store_name), comboChange };
    }
  });

  // ===================================================================
  // What's the projected revenue at risk if drive-thru stays at this level for 4 weeks?
  // ===================================================================
  MCX.analysis('maya/revenue-at-risk-4-weeks', {
    title: 'Revenue at risk, projected', intent: 'predictive', scope: 'network',
    terms: ['revenue-at-risk', 'benchmark', 'drive-thru-time'],
    skills: ['what-if-analysis'],
    models: ['ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM', 'DAILY_SALES_FACT'],
    bare: { topic: 'whatif', needs: 'Slow service costs orders at a rate somebody has to have measured', cannot: 'Without a rule that turns seconds into lost orders, a dollar projection from these rows would be a guess.' },
    run(ctx) {
      const t = ctx.time, a = ctx.answer, model = ctx.params('what-if-analysis'), weeks = countIn(ctx.question, 'weeks?', 4);
      ctx.say('Walking the what-if model against the certified GOLD tables.');
      const risk = E.risk(ctx, { atRiskOnly: true, by: ['region'], say: 'Revenue at risk this week, store by store, with the rule written into the query.' });
      const f = E.formats(ctx, { key: 'formats', say: 'Which kitchen formats are over the threshold at all.' });
      ctx.voice();

      const rule = risk.rule, stage = model.pre_stage_secs, central = risk.weekly.central;
      const regions = {}; risk.hit.forEach((row) => { (regions[row.region] = regions[row.region] || { region: row.region, stores: 0, usd: 0 }); regions[row.region].stores++; regions[row.region].usd += row.weekly_rev_at_risk; });
      const byRegion = Object.keys(regions).map((key) => regions[key]).sort((p, q) => q.usd - p.usd);
      const allExposed = risk.hit.every((row) => E.formatOf(row) === 'exposed');
      const after = stage.map((back) => risk.hit.reduce((sum, row) => {
        const over = row.secs_vs_benchmark - back;
        return sum + (over > rule.ignore_within_secs ? row.daily_dt_orders * 7 * (over / rule.every_secs * rule.share_of_orders) * row.avg_ticket : 0);
      }, 0)).sort((p, q) => p - q);

      a.p(`${ctx.g(`About ${k(central * weeks)} over ${word(weeks)} weeks at the central case, in a range of ${kRange(risk.weekly.low * weeks, risk.weekly.high * weeks)}`, 'quantify', 'skill:what-if-analysis', 'glossary:revenue-at-risk')}.`);
      a.p(`Method. The revenue-at-risk rule from the ops what-if model: every ${rule.every_secs} sec over benchmark costs about ${pct(rule.share_of_orders * 100)} of drive-thru orders, valued at the store's average ticket; stores within ${rule.ignore_within_secs} sec count as zero. ` +
        `Applied store by store to this week: ${ctx.g(`${k(central)} a week (low ${k(risk.weekly.low)}, high ${k(risk.weekly.high)})`, 'quantify')}, times ${word(weeks)}.`);
      a.listed('Where it sits, per week:', byRegion.map((r) => `${r.region}: ${k(r.usd)} across ${r.stores} store${r.stores === 1 ? '' : 's'}`));
      a.p(`${ctx.g(allExposed ? `All ${risk.stores} stores at risk are single-lane without parallel staging` : `${risk.stores} stores are at risk`, 'quantify', 'formats', 'glossary:benchmark')}; ` +
        `none of the ${(f.dual ? f.dual.stores : 0) + (f.retrofitted ? f.retrofitted.stores : 0)} kitchens with parallel staging is over the threshold.`);
      a.p(`Assumptions: traffic flat, item mix unchanged, nothing fixed for ${word(weeks)} weeks, and this week's ${word(t.thisWeek.days)} days (${dateRange(t.thisWeek.start, t.thisWeek.end)}) taken as representative. ` +
        `What changes it: ${ctx.g(`pre-staging at those stores would cut the weekly figure to ${kRange(after[0], after[1])}`, 'skill:what-if-analysis', 'quantify')}, or ${kRange(after[0] * weeks, after[1] * weeks)} over the ${word(weeks)} weeks.`);
      ctx.facts = { weeks, central, byRegion, after };
    }
  });

  // ===================================================================
  // What if Marcus gets parallel prep stations at his three hardest-hit stores?
  // ===================================================================
  MCX.analysis('maya/marcus-three-prep-stations', {
    title: 'What-if: stations at the hardest-hit stores', intent: 'predictive',
    terms: ['parallel-staging', 'retrofit-kit', 'benchmark', 'revenue-at-risk'],
    skills: ['what-if-analysis', 'retrofit-planning'],
    models: ['ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM', 'DAILY_SALES_FACT', 'DC_STOCK_FACT'],
    bare: { topic: 'whatif', needs: 'A parallel prep station changes how a kitchen assembles a two-step item' },
    run(ctx) {
      const t = ctx.time, s = ctx.scope, w = ctx.who, a = ctx.answer, who = first(s.operator || w.name);
      const model = ctx.params('what-if-analysis'), plan = ctx.params('retrofit-planning');
      const asked = Math.min(countIn(ctx.question, 'hardest|stores?|kitchens?', 3), s.exposed);
      ctx.say('Walking the what-if model against the certified GOLD tables.');
      const risk = E.risk(ctx, { atRiskOnly: true, say: `Pick ${who}'s hardest-hit stores: rank by revenue at risk this week.` });
      const pilot = E.formats(ctx, { key: 'target', scope: false, where: { since: t.launch.date, lane: 'single_lane' }, say: 'The target state — single-lane kitchens in the network that already have a station, since launch.' }).retrofitted;
      const now = ctx.one('portfolio', { model: 'ORDER_TIMING_MART', metrics: ['stores', 'drive_thru_time', 'benchmark', 'secs_vs_benchmark'], where: { week: 'this' } }, 'His portfolio average this week, to re-work after the change.');
      const kits = ctx.q('kits', { model: 'DC_STOCK_FACT', by: ['dc_name', 'on_hand', 'lead_time_days', 'unit_cost_usd'], where: { eq: { item: 'PPS-2 retrofit kit' } } }, 'Kits, lead time and installed cost at his distribution centre.');
      ctx.voice();

      const exposed = risk.hit.filter((row) => E.formatOf(row) === 'exposed'), picked = exposed.slice(0, asked), rest = exposed.slice(asked);
      const target = pilot ? pilot.secs_vs_benchmark : 0, ignore = model.loss_rule.ignore_within_secs;
      const removed = picked.reduce((sum, row) => sum + row.weekly_rev_at_risk, 0) * (target <= ignore ? 1 : 1 - target / (picked.reduce((sum, r) => sum + r.secs_vs_benchmark, 0) / picked.length));
      const saved = picked.reduce((sum, row) => sum + (row.secs_vs_benchmark - target), 0);
      const singleNow = exposed.reduce((sum, row) => sum + row.secs_vs_benchmark, 0) / exposed.length, singleAfter = (exposed.reduce((sum, row) => sum + row.secs_vs_benchmark, 0) - saved) / exposed.length;
      const portfolioAfter = now.avg_dt_secs - saved / now.stores, kit = kits[0], cost = picked.length * kit.unit_cost_usd;
      const nights = Math.ceil(picked.length / (plan.install_crews * plan.installs_per_crew_per_night));

      a.p(`${ctx.g(`It removes about ${pct(removed / risk.weekly.central * 100)} of his revenue at risk for ${picked.length === exposed.length ? 'the full' : `${pct(picked.length / exposed.length * 100)} of the`} capital`, 'quantify', 'skill:what-if-analysis', 'glossary:revenue-at-risk')}` +
        (rest.length ? `, and leaves ${word(rest.length)} single-lane store${rest.length === 1 ? '' : 's'} that still need the playbook.` : '.'));
      a.p(`The ${word(picked.length)} hardest-hit by revenue at risk are ${ctx.g(list(picked.map((row) => `${row.store_name} (${signed(row.secs_vs_benchmark)} sec, ${k(row.weekly_rev_at_risk)} a week)`)), 'quantify')}: ${k(picked.reduce((sum, r) => sum + r.weekly_rev_at_risk, 0))} of the ~${k(risk.weekly.central)} a week.`);
      if (pilot) a.p(`Target state: ${ctx.g(`the ${word(pilot.stores)} retrofitted single-lane kitchens in the network run ${n(pilot.window_s)} sec at the window and ${inside(pilot.secs_vs_benchmark)} benchmark since launch`, 'target', 'glossary:parallel-staging')}, through the same item.`);
      a.listed('Projected, if those stores land where the retrofitted kitchens are:', [
        `The ${word(picked.length)} stores: ${list(picked.map((row) => signed(row.secs_vs_benchmark)))} sec over → about ${signed(target)} each.`,
        `His single-lane average: ${signed(singleNow)} sec → about ${signed(singleAfter)}.`,
        `${ctx.g(`His portfolio: ${n(now.avg_dt_secs)} sec → about ${n(portfolioAfter)}, against a blended benchmark of ${n(now.benchmark)}`, 'portfolio', 'target', 'glossary:benchmark')}.`
      ]);
      a.p(`Cost and timing: ${ctx.g(`${picked.length} × ${usd(kit.unit_cost_usd)} installed = ${usd(cost)}, paid back in about ${n(cost / removed)} weeks`, 'kits', 'skill:retrofit-planning', 'glossary:retrofit-kit')}. ` +
        `The ${kit.dc_name} has ${n(kit.on_hand)} kit${kit.on_hand === 1 ? '' : 's'} on hand${kit.on_hand >= picked.length ? '' : `; the rest are ${kit.lead_time_days} days from the supplier`}, and ${word(plan.install_crews)} crews fit ${picked.length <= plan.install_crews ? 'all of them in one night' : `them in ${word(nights)} nights`}.`);
      if (rest.length) a.p(`Still open: ${list(rest.map((row) => row.store_name))} (${signed(Math.min.apply(null, rest.map((r) => r.secs_vs_benchmark)))} to ${signed(Math.max.apply(null, rest.map((r) => r.secs_vs_benchmark)))} sec). They need pre-staging and a crew member forward, worth ${model.pre_stage_secs[0] + model.crew_forward_secs[0]}–${model.pre_stage_secs[1] + model.crew_forward_secs[1]} sec. Assumes traffic and item mix hold.`);
      ctx.facts = { picked: picked.map((r) => r.store_name), removed, portfolioAfter, cost };
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
