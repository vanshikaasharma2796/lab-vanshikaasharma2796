/* =====================================================================
   src/analyses/operator.js — eight analyses about a set of stores

   The questions a franchise operator asks about their own stores. Each
   works for any scope the context layer resolves: an operator's own
   stores ("your"), an operator a corporate user names ("Greg Novak's"),
   a region, or the whole network.

     drive-thru-snapshot     What was my drive-thru time last week?
     benchmark-scorecard     How did my stores perform vs benchmark?
     drive-thru-diagnosis    Why is my drive-thru time up this week?
     combo-revenue-check     Why did my combo revenue dip after May 7?
     recovery-plan           How do I bring my drive-thru back to benchmark by Friday?
     store-priorities        Which of my stores should I prioritize this week?
     what-if-prestage        What if I pre-stage Double Stack components?
     what-if-prep-station    What if I add a parallel prep station at my single-lane stores?

   Every figure comes from a query; every rule (benchmarks, the
   revenue-at-risk rule, what a playbook step is worth) is read from the
   context layer. Nothing here is a fixed number.
   ===================================================================== */
(function (global) {
  'use strict';
  const MCX = global.MCX, fmt = MCX.fmt, E = MCX.evidence;
  const { n, usd, k, kRange, pct, signed, cap, word, list, date, dateRange } = fmt;

  const SEGMENT = { order: 'order time', prep: 'prep time', window: 'window time' };
  const COLUMN = { order: 'order_s', prep: 'prep_s', window: 'window_s' };

  /** "Double Stack" from "McContext Double Stack". */
  function shortItem(name) { return String(name).replace(/^McContext\s+/, ''); }
  /** What the two steps are, from the launch note: "beef stack, then sauce layer". */
  function twoSteps(launch) { const m = /Two-step prep: ([^.]+)\./.exec((launch && launch.notes) || ''); return m ? m[1] : null; }
  /** Seconds each segment moved between two rows, largest first: [{ name, change }]. */
  function moves(ctx, before, after) {
    return ctx.params('drive-thru-timing').segments
      .map((name) => ({ name, change: after[COLUMN[name]] - before[COLUMN[name]], before: before[COLUMN[name]], after: after[COLUMN[name]] }))
      .sort((a, b) => b.change - a.change);
  }
  function daysSoFar(t) { return t.thisWeek.partial ? ` (${dateRange(t.thisWeek.start, t.thisWeek.end)}, ${word(t.thisWeek.days)} days so far)` : ''; }
  function top(rows, count, text) { return list(rows.slice(0, count).map(text)); }

  // ===================================================================
  // What was my drive-thru time last week?
  // ===================================================================
  MCX.analysis('drive-thru-snapshot', {
    title: 'Drive-thru snapshot', intent: 'descriptive', anyScope: true,
    terms: ['drive-thru-time', 'benchmark', 'reporting-week'],
    skills: ['drive-thru-timing'],
    models: ['ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM'],
    bare: 'timing',
    run(ctx) {
      const t = ctx.time, s = ctx.scope, w = ctx.who, a = ctx.answer;
      const last = /\blast week\b/i.test(ctx.question);
      const period = last ? t.lastWeek : t.thisWeek, when = last ? 'last week' : 'this week';
      const X = E.group(ctx, 'exposed'), R = E.group(ctx, 'retrofitted'), D = E.group(ctx, 'dual');

      ctx.say('Reading the certified GOLD tables.');
      if (!last && t.thisWeek.partial) ctx.policy('partial-week', `Data ends ${fmt.dayDate(t.maxDate)}, so "this week" is ${dateRange(period.start, period.end)}: ${word(period.days)} days. Reporting averages, not totals.`);
      const weeks = E.weeks(ctx, { key: 'weeks', metrics: ['dt_orders'], where: { since: fmt.addDays(period.start, -14), to: period.end },
        say: `Pull drive-thru time for ${w.stores}, ${when} and the two weeks before it.` });
      const f = E.formats(ctx, { key: 'formats', where: { week: last ? 'last' : 'this' },
        metrics: ['stores', 'drive_thru_time', 'benchmark', 'secs_vs_benchmark', 'pct_in_benchmark', 'order_time', 'prep_time', 'window_time'],
        say: `Split ${when} by lane type and parallel staging — a blended average can hide a split.` });
      const stores = E.stores(ctx, { key: 'stores', where: { week: last ? 'last' : 'this' }, say: 'Store by store, slowest against benchmark first.' });

      const wk = weeks[weeks.length - 1], prev = weeks[weeks.length - 2];
      const x = f.exposed, r = f.retrofitted, d = f.dual;
      const over = wk.secs_vs_benchmark;
      const voice = ctx.voice();
      if (s.own) a.p(`Thanks for asking — here's ${last ? "last week's" : "this week's"} drive-thru picture across ${w.stores}.`);

      a.p(`${ctx.g(`${cap(w.portfolio)} averaged ${n(wk.avg_dt_secs)} seconds at the drive-thru ${when} (${dateRange(period.start, period.end)}), against a blended benchmark of ${n(wk.benchmark)} seconds`, 'persona', 'weeks', 'glossary:drive-thru-time', 'glossary:benchmark')}` +
        ` — about ${n(Math.abs(over))} seconds ${over > 0 ? 'over' : 'inside'}. ${pct(wk.pct_in_benchmark)} of orders cleared inside benchmark, on ~${n(fmt.round(wk.dt_orders, -2))} drive-thru orders` +
        `${!last && t.thisWeek.partial ? ` in ${word(period.days)} days` : ''}.${prev ? ` The week before, the average was ${n(prev.avg_dt_secs)}.` : ''}`);

      const split = x && d && x.secs_vs_benchmark > 5 && d.secs_vs_benchmark <= 0;
      const slow = stores.filter((row) => E.formatOf(row) === 'exposed');
      const lines = [];
      if (x) lines.push(`${ctx.g(`${cap(X.label)} ran ${n(x.avg_dt_secs)} sec vs a ${n(x.benchmark)} sec benchmark — ${n(Math.abs(x.secs_vs_benchmark))} sec ${x.secs_vs_benchmark > 0 ? 'over' : 'inside'}`, 'formats')}.` +
        (slow.length > 3 ? ` ${top(slow, 3, (row) => `${row.store_name} (${n(row.avg_dt_secs)})`)} were the slowest.` : '') + ` ${pct(x.pct_in_benchmark)} of orders there were inside benchmark.`);
      if (r) lines.push(`${cap(R.label)} ran ${n(r.avg_dt_secs)} sec vs ${n(r.benchmark)} — ${n(Math.abs(r.secs_vs_benchmark))} sec ${r.secs_vs_benchmark > 0 ? 'over' : 'inside'}, ${pct(r.pct_in_benchmark)} inside benchmark.`);
      if (d) lines.push(`${ctx.g(`${cap(D.label)} ran ${n(d.avg_dt_secs)} sec vs a ${n(d.benchmark)} sec benchmark — ${n(Math.abs(d.secs_vs_benchmark))} sec ${d.secs_vs_benchmark > 0 ? 'over' : 'inside benchmark'}`, 'formats')}, with ${pct(d.pct_in_benchmark)} of orders inside it.${d.secs_vs_benchmark <= 0 ? ' These stores are healthy.' : ''}`);
      a.listed(split ? 'The story splits cleanly by lane type:' : 'By kitchen format:', lines);

      if (x && d) {
        a.p(`${ctx.g(`The gap is at the window`, 'formats', 'skill:drive-thru-timing')}: ${X.kind} window time was ${n(x.window_s)} sec against ${n(d.window_s)} at the dual-lane stores, ` +
          `while order time was level (${n(x.order_s)} vs ${n(d.order_s)} sec) and prep time was ${n(x.prep_s)} vs ${n(d.prep_s)}.`);
      }
      const launchIn = t.launch && t.launch.date >= period.start && t.launch.date <= period.end;
      a.p((split ? `${ctx.g(`This is ${X.a} ${X.kind} problem, not a ${s.kind === 'operator' ? 'portfolio' : s.kind === 'region' ? 'regional' : 'network'} problem`, 'persona', 'stores')}.` : 'No kitchen format stands apart from the others.') +
        (launchIn ? ` The week includes the ${shortItem(t.launch.item)} launch on ${fmt.dayDate(t.launch.date)}, so it mixes ${word(fmt.daysBetween(period.start, t.launch.date))} days before it with ${word(fmt.daysBetween(t.launch.date, period.end) + 1)} after.` : '') +
        (split ? (voice.person === 'second' ? ` Ask why and I'll run the full diagnostic on ${X.count === 1 ? 'that store' : 'those ' + X.count + ' stores'}.` : ' The diagnostic playbook is the next step.') : ''));
      ctx.facts = { week: wk, formats: { x, r, d } };
    }
  });

  // ===================================================================
  // How did my stores perform vs benchmark?
  // ===================================================================
  MCX.analysis('benchmark-scorecard', {
    title: 'Benchmark scorecard', intent: 'descriptive', anyScope: true,
    terms: ['benchmark'],
    skills: ['diagnostic-playbook', 'seasonality-check', 'ontology', 'ops-playbook'],
    models: ['ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM', 'MENU_CHANGE_LOG'],
    bare: { topic: 'ranking', cannot: "I can hand you raw seconds for a list of stores, but not how they are doing against a benchmark, or whether any movement is more than seasonal." },
    run(ctx) {
      const t = ctx.time, s = ctx.scope, w = ctx.who, a = ctx.answer;
      const X = E.group(ctx, 'exposed'), R = E.group(ctx, 'retrofitted'), D = E.group(ctx, 'dual');
      const item = shortItem(t.launch.item), playbook = ctx.params('ops-playbook');

      ctx.say('Walking the playbook against the certified GOLD tables.');
      ctx.q('scope', { model: 'FRANCHISE_STORE_DIM', by: ['lane_type', 'has_parallel_staging'], metrics: ['stores'], order: 'f.lane_type DESC' },
        `Scope to ${w.stores} and split by lane type and parallel staging.`);
      const ly = E.lastYear(ctx, { say: 'Compare benchmark compliance this week with the same days last year — rule out seasonality before calling it a problem.' });
      const f = E.formats(ctx, { say: 'Where does this week sit against benchmark, by kitchen format?' });
      const seg = E.segments(ctx, { say: `Find where the drop concentrates — each format before and after ${date(t.launch.date)}.` });
      const menu = E.menu(ctx, { say: 'Correlate the onset against the menu change log.' });

      const x = f.exposed, d = f.dual, r = f.retrofitted, sx = seg.exposed, sd = seg.dual;
      const seasonal = Math.abs(ly.now.pct_in_benchmark - ly.then.pct_in_benchmark) < 4;
      ctx.voice();

      if (!x || x.secs_vs_benchmark <= 5 || seasonal) {
        a.p(`${ctx.g(`${w.Stores} are ${f.rows.every((row) => row.secs_vs_benchmark <= 5) ? 'inside or within a few seconds of benchmark' : 'mixed against benchmark'} this week`, 'spread', 'persona', 'skill:diagnostic-playbook', 'skill:ontology', 'skill:ops-playbook', 'skill:seasonality-check')}: ` +
          `${pct(ly.now.pct_in_benchmark)} of orders inside benchmark, against ${pct(ly.then.pct_in_benchmark)} on the same days last year.`);
        a.list(f.rows.map((row) => `${cap(E.group(ctx, E.formatOf(row)).label)}: ${n(row.avg_dt_secs)} sec vs ${n(row.benchmark)} (${signed(row.secs_vs_benchmark)}), ${pct(row.pct_in_benchmark)} inside benchmark.`));
        return;
      }

      a.p(`${ctx.g(`${cap(X.label)} ${X.are} the problem — and it's structural, not seasonal`, 'persona', 'spread', 'skill:seasonality-check', 'skill:diagnostic-playbook')}.`);
      a.p(`Across ${w.stores}, ${ctx.g(`${pct(ly.now.pct_in_benchmark)} of orders were served inside benchmark this week, down from ${pct(ly.then.pct_in_benchmark)} on the same days last year`, 'seasonality', 'glossary:benchmark')}` +
        `${daysSoFar(t)}. That's not a seasonal dip — last year's drive-thru time on those days was ${n(ly.then.avg_dt_secs)} sec against ${n(ly.now.avg_dt_secs)} now, so something genuinely changed.`);

      const lines = [
        `${ctx.g(`${cap(X.kind)} window time jumped from ${n(sx.before.window_s)} sec (the 30 days before launch) to ${n(sx.after.window_s)} sec since`, 'decompose')} — a ${n(sx.after.window_s - sx.before.window_s)}-second blowout; ` +
          `the share of orders inside benchmark there fell ${pct(sx.before.pct_in_benchmark)} → ${pct(sx.after.pct_in_benchmark)}, and this week ${X.they} ${X.are} at ${n(x.avg_dt_secs)} sec against a ${n(x.benchmark)} benchmark (${signed(x.secs_vs_benchmark)}).`,
        d ? `${cap(D.label)} barely moved (window ${n(sd.before.window_s)} → ${n(sd.after.window_s)} sec, ${pct(sd.before.pct_in_benchmark)} → ${pct(sd.after.pct_in_benchmark)} inside benchmark) — they stage prep in parallel, so they absorbed it.` +
          (r ? ` So did ${R.the} (${signed(r.secs_vs_benchmark)} sec against benchmark this week).` : '') : null,
        menu.launch ? `${ctx.g(`The break lines up with the ${date(menu.launch.event_date)} ${menu.launch.item_name} launch`, 'correlate')} (${menu.launch.requires_two_step_prep ? 'two-step prep, ' : ''}${menu.launch.ops_impact_level} ops impact)` +
          (menu.alert ? ` — there's ${menu.alert.affected_regions === 'ALL' ? 'a network' : 'a ' + menu.alert.affected_regions} ops alert dated ${date(menu.alert.event_date)}.` : '.') : null
      ];
      a.listed(`${ctx.g(`The drop is concentrated in ${X.label}`, 'spread', 'skill:ontology')}:`, lines, true);

      a.p(`What to do: ${ctx.g(`pre-stage ${item} components in the pre-rush (${playbook.pre_rush.join(' and ')}) at ${X.label}`, 'skill:ops-playbook', 'skill:voice-and-tone')}, ` +
        `and flag to Ops that ${X.count === 1 ? 'that kitchen needs' : 'those kitchens need'} a parallel prep station if window time is still above ${playbook.escalate_above_window_secs} sec after ${word(playbook.review_after_trading_days)} trading days.`);
      ctx.facts = { now: ly.now, then: ly.then, x, d };
    }
  });

  // ===================================================================
  // Why is my drive-thru time up this week?
  // ===================================================================
  MCX.analysis('drive-thru-diagnosis', {
    title: 'Drive-thru diagnosis', intent: 'diagnostic', anyScope: true,
    terms: ['drive-thru-time', 'benchmark'],
    skills: ['diagnostic-playbook', 'seasonality-check', 'drive-thru-timing', 'what-if-analysis'],
    models: ['ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM', 'MENU_CHANGE_LOG', 'DAILY_SALES_FACT'],
    bare: 'timing',
    run(ctx) {
      const t = ctx.time, s = ctx.scope, w = ctx.who, a = ctx.answer;
      const X = E.group(ctx, 'exposed'), R = E.group(ctx, 'retrofitted'), D = E.group(ctx, 'dual');
      const item = shortItem(t.launch.item), found = {};

      // The steps, and their order, come from the playbook file. Remove one there and it is not run here.
      const steps = {
        scope() {
          E.calendar(ctx);
          if (t.thisWeek.partial) ctx.policy('partial-week', `Data ends ${fmt.dayDate(t.maxDate)}, so "this week" is ${dateRange(t.thisWeek.start, t.thisWeek.end)}: ${word(t.thisWeek.days)} days. Averages can be compared; totals cannot.`);
        },
        confirm() { found.weeks = E.readWeeks(ctx, E.weeks(ctx, { say: `Confirm the metric actually moved — weekly drive-thru trend for ${w.stores}.` })); },
        seasonality() {
          found.lastYear = E.lastYear(ctx, { say: 'Rule out seasonality — the same days last year.' });
          found.weather = E.weather(ctx, { say: 'Rule out weather — rain across these markets this week.' });
        },
        spread() { found.formats = E.formats(ctx, { say: 'Classify the spread — this week by lane type and parallel staging.' }); },
        decompose() { found.segments = E.segments(ctx, { say: `Decompose drive-thru time into order, prep and window, before and after ${date(t.launch.date)}.` }); },
        correlate() { found.menu = E.menu(ctx, { say: `Correlate — check the menu change log around ${date(t.launch.date)}.` }); },
        quantify() { found.risk = E.risk(ctx, { atRiskOnly: true, say: 'Quantify — revenue at risk at the stores over benchmark, with the rule from the what-if model.' }); }
      };
      ctx.say('Walking the playbook against the certified GOLD tables.');
      ctx.skill('diagnostic-playbook').steps.forEach((name) => { if (steps[name]) steps[name](); });
      ['weeks', 'formats', 'segments', 'menu'].forEach((need) => { if (!found[need]) throw new Error('the diagnostic playbook must keep its confirm, spread, decompose and correlate steps'); });

      const W = found.weeks, f = found.formats, x = f.exposed, d = f.dual, r = f.retrofitted, menu = found.menu;
      const drifting = W.drift >= 3;
      if (drifting) {
        ctx.term('staffing-fill-rate');
        found.fill = E.staffing(ctx, { say: 'Drive-thru time was already creeping up before the launch. Check shift fill rate over the same weeks.' });
      }
      const voice = ctx.voice();
      const now = W.now.avg_dt_secs;

      if (!x || x.secs_vs_benchmark <= 5) {
        a.p(`${ctx.g(`${w.Poss} drive-thru time is ${n(now)} sec this week against ~${n(W.baseline)} sec before the launch`, 'confirm', 'spread', 'skill:diagnostic-playbook', 'skill:seasonality-check', 'skill:drive-thru-timing', 'skill:what-if-analysis', 'skill:voice-and-tone')}, ` +
          `and no kitchen format is more than a few seconds over its benchmark. There is no ${item} problem to diagnose in this scope.`);
        return;
      }

      const seg = found.segments.exposed, mv = moves(ctx, seg.before, seg.after), main = mv[0], second = mv[1];
      if (voice.person === 'second' && s.own) a.p("Thanks for letting us know — here's what's going on.");

      // 1. The finding: who moved.
      let p = `${ctx.g(`The ${item} launch on ${date(t.launch.date)} is ${s.own ? 'hammering' : 'hitting'} ${X.label}`, 'correlate', 'spread', 'persona', 'skill:diagnostic-playbook')}. ` +
        `Drive-thru time across ${w.portfolio} went from ~${n(W.baseline)} sec (${drifting ? `the average of the ${word(W.before.length)} weeks before` : `steady through ${fmt.month(t.baseline.from)}`}) to ${n(now)} sec this week — ` +
        `but the damage is ${d && d.secs_vs_benchmark <= 0 ? 'entirely ' : ''}concentrated on the ${X.kind} side, where average drive-thru time is now ` +
        `${ctx.g(`${n(x.avg_dt_secs)} sec vs a ${n(x.benchmark)} sec benchmark (${signed(x.secs_vs_benchmark)} sec over)`, 'spread', 'glossary:drive-thru-time', 'glossary:benchmark')}.`;
      if (d) {
        const under = d.secs_vs_benchmark <= -5 ? 'still comfortably under benchmark' : d.secs_vs_benchmark <= 0 ? 'still under benchmark' : `${n(d.secs_vs_benchmark)} sec over benchmark`;
        p += ` ${ctx.g(`${cap(D.label)} (all with parallel staging) ${D.are} ${under} at ${n(d.avg_dt_secs)} sec`, 'spread')}` +
          (r ? `, and ${R.the} ${R.are} at ${n(r.avg_dt_secs)} (${signed(r.secs_vs_benchmark)})` : '') + '.';
      }
      if (found.lastYear && found.weather) {
        const ly = found.lastYear, wx = found.weather;
        const dry = wx.dry ? `${t.thisWeek.days === 7 ? 'the week was' : `all ${word(t.thisWeek.days)} days were`} dry across ${s.own ? 'your' : 'these'} markets` : `rain fell only on ${list(wx.wet.map(fmt.weekday))}`;
        p += ` ${ctx.g(`This isn't seasonality and it isn't weather`, 'seasonality', 'weather', 'skill:seasonality-check')} — the same days last year ran ${n(ly.then.avg_dt_secs)} sec, ${dry}, ` +
          `and the break sits at the ${date(t.launch.date)} launch: ${X.kind} drive-thru time was ${n(seg.before.avg_dt_secs)} sec in the 30 days before and ${n(seg.after.avg_dt_secs)} since.`;
      }
      a.p(p);

      // 2. The bottleneck: which seconds moved.
      p = `${ctx.g(`The bottleneck is ${SEGMENT[main.name]}`, 'decompose', 'skill:drive-thru-timing')}` +
        (menu.alert ? `, exactly the failure mode the corporate ops alert flagged on ${date(menu.alert.event_date)}` : '') +
        `: ${X.kind} ${SEGMENT[main.name]} went from ${ctx.g(`${n(main.before)} sec pre-launch to ${n(main.after)} sec post-launch (${signed(main.change)} sec)`, 'decompose')}` +
        (second.change >= 3 ? `, with ${SEGMENT[second.name]} adding another ~${n(second.change)} sec` : '') + '.';
      if (menu.launch && menu.launch.requires_two_step_prep) {
        p += ` The two-step prep${twoSteps(menu.launch) ? ` (${twoSteps(menu.launch)})` : ''} has nowhere to land in a single-lane kitchen without parallel staging.`;
      }
      a.p(p);

      // 3. Anything that was already moving before the launch.
      if (drifting && found.fill) {
        const first = W.before[0], last = W.before[W.before.length - 1];
        const fill = E.index(found.fill, 'week_start'), f0 = fill[first.week_start], f1 = fill[last.week_start];
        const inPrep = last.prep_s - first.prep_s >= W.drift - 1.5;
        a.p(`Not all of it is the launch. Drive-thru time was already creeping up before ${date(t.launch.date)}: ${n(first.avg_dt_secs)} sec in the week of ${date(first.week_start)}, ${n(last.avg_dt_secs)} by the week of ${date(last.week_start)}` +
          `${inPrep ? `, all of it in prep time (${n(first.prep_s)} → ${n(last.prep_s)} sec)` : ''}. Over the same weeks ` +
          `${ctx.g(`shift fill rate slid from ${pct(f0.fill_rate_pct)} to ${pct(f1.fill_rate_pct)}`, 'staffing', 'glossary:staffing-fill-rate')}. That part is a staffing problem, it shows in every kitchen format, and it pre-dates the ${item}.`);
      }

      // 4. What it is worth.
      if (found.risk && found.risk.stores) {
        const risk = found.risk, rule = risk.rule;
        const onlyExposed = risk.hit.every((row) => E.formatOf(row) === 'exposed');
        const worst = risk.hit.slice().sort((p1, p2) => p2.secs_vs_benchmark - p1.secs_vs_benchmark);
        a.p(`At ~${n(risk.orders / 7 / risk.stores)} drive-thru orders a day per store and a ${usd(risk.ticket, 2)} ticket, every ${rule.every_secs} sec over benchmark costs roughly ${pct(rule.share_of_orders * 100)} of drive-thru orders — that's ` +
          `${ctx.g(`~${k(risk.weekly.central)} a week of revenue at risk across the ${risk.stores <= 12 ? word(risk.stores) : risk.stores} ${onlyExposed ? E.group(ctx, 'exposed', risk.stores).noun : 'stores over benchmark'}`, 'quantify', 'skill:what-if-analysis', 'skill:voice-and-tone')}` +
          ` (range ${kRange(risk.weekly.low, risk.weekly.high)})` +
          (worst.length >= 3 ? `, with ${top(worst, 3, (row) => `${row.store_name} (${signed(row.secs_vs_benchmark)} sec)`)} the worst offenders.` : '.'));
      }
      ctx.facts = { baseline: W.baseline, now, drift: W.drift, x, d, r, segments: mv, risk: found.risk && found.risk.weekly };
    }
  });

  // ===================================================================
  // Why did my combo revenue dip after May 7?
  // ===================================================================
  MCX.analysis('combo-revenue-check', {
    title: 'Combo revenue check', intent: 'diagnostic', anyScope: true,
    terms: ['combo-revenue'],
    skills: ['diagnostic-playbook', 'seasonality-check'],
    models: ['COMBO_REVENUE_DAILY', 'DAILY_SALES_FACT'],
    bare: 'combo',
    run(ctx) {
      const t = ctx.time, s = ctx.scope, w = ctx.who, a = ctx.answer;
      const item = shortItem(t.launch.item), combos = { category: 'Combo' };
      const post = { from: t.launch.date, to: t.maxDate };

      ctx.say('Walking the playbook against the certified GOLD tables.');
      const weekly = ctx.q('weekly', { model: 'COMBO_REVENUE_DAILY', by: ['week_start'], metrics: ['days', 'net_rev', 'net_per_day'], where: { eq: combos, since: t.baseline.from }, order: 'week_start' },
        `Confirm the dip — weekly net combo revenue around ${date(t.launch.date)}, with the number of days in each week.`);
      const lastWeek = weekly[weekly.length - 1], full = weekly.filter((row) => row.days === 7), prevWeek = full[full.length - 1];
      const partial = lastWeek.days < 7;
      if (partial) ctx.policy('partial-week', `The week of ${date(lastWeek.week_start)} has ${word(lastWeek.days)} days of data, so its total cannot be compared with a full week. Switching to revenue per day.`);
      if (ctx.regionProxy) ctx.say(`The certified combo table stops at region, so these figures are the ${ctx.regionProxy}; store-level combo orders come from DAILY_SALES_FACT.`);

      const items = ctx.q('items', { model: 'COMBO_REVENUE_DAILY', by: ['item_name'], split: { at: t.launch.date, before: 'pre', after: 'post' }, metrics: ['days', 'net_per_day'],
        where: { eq: combos, from: t.baseline.from, to: t.maxDate }, order: 'c.item_name, period DESC' },
        `Compare net combo revenue per day before and after ${date(t.launch.date)}, item by item.`);
      const lto = ctx.one('lto', { model: 'COMBO_REVENUE_DAILY', by: ['item_name'], metrics: ['days', 'net_per_day', 'gross_per_day', 'discount_rate'], where: { eq: { is_lto: true }, since: t.launch.date } },
        `Check ${item} revenue since launch — is it on top of the combos or instead of them?`);
      const ly = ctx.q('seasonality', { model: 'COMBO_REVENUE_DAILY', split: { at: t.lastYear(t.launch.date), before: 'pre', after: 'post' }, metrics: ['days', 'net_per_day'],
        where: { eq: combos, ranges: [[t.lastYear(t.baseline.from), t.lastYear(t.baseline.to)], [t.lastYear(post.from), t.lastYear(post.to)]] }, order: 'period DESC' },
        'Seasonality check — the same two periods last year.');
      let own = null;
      if (s.kind === 'operator') {
        const rows = ctx.q('own_stores', { model: 'DAILY_SALES_FACT', by: ['operator_name'], split: { at: t.launch.date, before: 'pre', after: 'post' }, metrics: ['stores', 'combo_orders_per_day'],
          where: { region: s.regionOf, from: t.baseline.from, to: t.maxDate }, scope: false, order: 'f.operator_name, period DESC' },
          `Bring it down to ${w.stores}: combo orders per day by operator in the ${s.regionOf}, before and after.`);
        const mine = rows.filter((row) => row.operator_name === s.operator), sum = (period) => rows.filter((row) => row.period === period).reduce((x, row) => x + row.combo_orders_per_day, 0);
        const pre = mine.filter((row) => row.period === 'pre')[0], after = mine.filter((row) => row.period === 'post')[0];
        own = { share: pre.combo_orders_per_day / sum('pre') * 100, change: (after.combo_orders_per_day - pre.combo_orders_per_day) / pre.combo_orders_per_day * 100 };
      }

      // Pivot the items: one entry per combo with its per-day revenue before and after.
      const byItem = {};
      items.forEach((row) => { (byItem[row.item_name] = byItem[row.item_name] || { name: row.item_name })[row.period] = row.net_per_day; });
      const all = Object.keys(byItem).map((name) => byItem[name]).map((c) => Object.assign(c, { change: c.post - c.pre, pctChange: (c.post - c.pre) / c.pre * 100 }));
      const pre = all.reduce((x, c) => x + c.pre, 0), after = all.reduce((x, c) => x + c.post, 0);
      const down = all.filter((c) => c.pctChange < -0.5), up = all.filter((c) => c.pctChange >= -0.5);
      const change = (after - pre) / pre * 100, total = after - pre + (lto.net_per_day || 0);
      const lyBy = E.index(ly, 'period'), where = ctx.regionProxy ? `the ${ctx.regionProxy}` : s.kind === 'region' ? `the ${s.region}` : 'the network';
      ctx.voice();

      if (change < -3) {
        a.p(`${ctx.g(`Net combo revenue per day is down ${pct(Math.abs(change))} since ${date(t.launch.date)}`, 'items', 'glossary:combo-revenue', 'skill:diagnostic-playbook', 'skill:seasonality-check', 'skill:voice-and-tone')} in ${where}: ` +
          `${usd(pre)} a day before, ${usd(after)} since. ${list(down.map((c) => `${c.name} (${signed(c.pctChange)}%)`))} ${down.length === 1 ? 'is' : 'are'} down; the ${item} added ${usd(lto.net_per_day || 0)} a day.`);
        return;
      }

      a.p(`${s.own ? 'Thanks for letting us know — and good news: ' : ''}${ctx.g(`${s.own ? 'your' : w.poss} combo revenue did not actually dip after ${date(t.launch.date)}`, 'items', 'glossary:combo-revenue', 'skill:diagnostic-playbook')}. ` +
        (partial ? `The "dip" in the weekly view is a reporting artifact (the most recent week is only partial — data ends ${date(t.maxDate)}), not a real drop. ` : '') +
        `On a per-day basis, ${down.length ? `${word(up.length)} of the ${word(all.length)}` : `every one of the ${word(all.length)}`} core combos ${up.length === 1 ? 'is' : 'are'} flat-to-up since the ${item} launched.`);

      a.listed(`Here's what the daily numbers show for ${where}${ctx.regionProxy ? ' (the certified combo table stops at region)' : ''}:`, [
        `Pre-launch (${dateRange(t.baseline.from, t.baseline.to)}) net combo revenue: ~${usd(fmt.round(pre, -1))}/day`,
        `Post-launch (${dateRange(post.from, post.to)}) net combo revenue: ~${usd(fmt.round(after, -1))}/day — ${Math.abs(change) < 2 ? 'essentially flat' : change > 0 ? 'up' : 'down'} (${signed(change)}%)`,
        lto.net_per_day ? `Plus ${ctx.g(`the ${item} itself added ~${usd(fmt.round(lto.net_per_day, -1))}/day in net LTO revenue`, 'lto')} on top of that, at a ${pct(lto.discount_rate * 100)} launch discount` : null
      ]);
      if (own) {
        a.p(`${w.Stores} take about ${pct(own.share)} of the region's combo orders, and ${ctx.g(`their combo orders per day moved ${signed(own.change)}% across the same split`, 'own_stores', 'persona')} — the same picture, store for store.`);
      }

      const softened = down.sort((x, y) => x.pctChange - y.pctChange)[0];
      const rises = up.map((c) => c.pctChange), names = up.map((c) => c.name.replace(' Combo', ''));
      a.p(`So ${ctx.g(`total combo-category revenue is up ~${usd(fmt.round(total, -1))}/day (~${pct(total / pre * 100)}) since ${date(t.launch.date)}`, 'items', 'lto', 'glossary:combo-revenue')}. ` +
        (softened ? `${ctx.g(`The only combo that softened was the ${softened.name}`, 'items')} (${signed(softened.pctChange)}% per day, ~${usd(fmt.round(Math.abs(softened.change), -1))}/day) — a plausible small cannibalization signal, and small next to the lift. ` +
          `Everything else (${list(names)}) is up ${n(Math.min.apply(null, rises))}–${n(Math.max.apply(null, rises))}%.` : `All ${word(all.length)} are up ${n(Math.min.apply(null, rises))}–${n(Math.max.apply(null, rises))}%.`));

      a.p(`Bottom line: ` + (partial ? `${ctx.g(`${s.own ? "the dip you're seeing" : 'the apparent dip'} is the partial week of ${date(lastWeek.week_start)} (only ${lastWeek.days} days of data)`, 'weekly', 'policy:partial-week')}. ` +
          `Its total of ${k(lastWeek.net_rev)} looks like a collapse next to ${k(prevWeek.net_rev)} the week before, but per day it is ${usd(lastWeek.net_per_day)} against ${usd(prevWeek.net_per_day)}. ` : '') +
        (lyBy.pre && lyBy.post ? `${ctx.g('There is no seasonal dip hiding underneath', 'seasonality', 'skill:seasonality-check')}: the same weeks last year ran ~${usd(fmt.round(lyBy.pre.net_per_day, -1))} then ~${usd(fmt.round(lyBy.post.net_per_day, -1))} a day. ` : '') +
        `Once the full week loads, combo revenue should sit at or above ${fmt.month(t.baseline.from)} levels, plus a clean lift from the ${item}.`);
      ctx.facts = { pre, after, change, lto, total, own, down };
    }
  });

  // ===================================================================
  // How do I bring my drive-thru back to benchmark by Friday?
  // ===================================================================
  MCX.analysis('recovery-plan', {
    title: 'Recovery plan', intent: 'prescriptive', anyScope: true,
    terms: ['drive-thru-time', 'benchmark', 'pre-staging'],
    skills: ['diagnostic-playbook', 'drive-thru-timing', 'ops-playbook', 'what-if-analysis'],
    models: ['ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM', 'MENU_CHANGE_LOG', 'DAILY_SALES_FACT'],
    bare: { topic: 'timing' },
    run(ctx) {
      const t = ctx.time, s = ctx.scope, w = ctx.who, a = ctx.answer;
      const X = E.group(ctx, 'exposed'), D = E.group(ctx, 'dual');
      const item = shortItem(t.launch.item), play = ctx.params('ops-playbook'), model = ctx.params('what-if-analysis');

      ctx.say('Walking the playbook against the certified GOLD tables.');
      const f = E.formats(ctx, { key: 'scope', say: `Confirm ${w.poss} position against benchmark this week, by lane type and parallel staging.` });
      const seg = E.segments(ctx, { after: { from: t.thisWeek.start, to: t.thisWeek.end }, say: `Decompose where the seconds are now — this week against the 30 days before ${date(t.launch.date)}.` });
      const menu = E.menu(ctx, { say: 'Check the menu change log for what changed at the break.' });
      const risk = E.risk(ctx, { atRiskOnly: true, say: 'Quantify weekly revenue at risk with the what-if rule.' });
      ctx.say(`Read the ops playbook for two-step items: pre-stage (${model.pre_stage_secs.join('–')} sec), crew forward (${model.crew_forward_secs.join('–')} sec), then a parallel prep station.`, { hold: true });

      const x = f.exposed, d = f.dual;
      const mv = moves(ctx, seg.exposed.before, seg.exposed.after);
      const stage = model.pre_stage_secs, crew = model.crew_forward_secs;
      const afterStage = [x.avg_dt_secs - stage[1], x.avg_dt_secs - stage[0]];
      const afterBoth = [x.avg_dt_secs - stage[1] - crew[1], x.avg_dt_secs - stage[0] - crew[0]];
      const residual = [Math.max(0, afterBoth[0] - x.benchmark), Math.max(0, afterBoth[1] - x.benchmark)];
      const ignore = model.loss_rule.ignore_within_secs;
      const left = residual.map((secs) => (secs <= ignore ? 0 : risk.weekly.central * secs / x.secs_vs_benchmark));
      const recovered = [risk.weekly.central - left[1], risk.weekly.central - left[0]];
      const friday = fmt.addDays(t.thisWeek.start, 4), daysLeft = fmt.daysBetween(t.maxDate, friday);
      const voice = ctx.voice();

      if (voice.person === 'second' && s.own) a.p(`Thanks for flagging this — here's the play to get you back to benchmark by Friday.`);
      a.p((d ? `${cap(D.label)} ${D.are} fine — ${D.they}'re running ${n(Math.abs(d.secs_vs_benchmark))} seconds ${d.secs_vs_benchmark <= 0 ? 'under' : 'over'} ${D.count === 1 ? 'its' : 'their'} ${n(d.benchmark)}-sec benchmark. ` : '') +
        `${ctx.g(`The problem is ${d && d.secs_vs_benchmark <= 0 ? 'fully ' : ''}isolated to ${X.label}, which ${X.are} sitting ${n(x.secs_vs_benchmark)} seconds over ${X.count === 1 ? 'its' : 'their'} ${n(x.benchmark)}-sec benchmark`, 'persona', 'scope', 'glossary:drive-thru-time', 'glossary:benchmark', 'skill:diagnostic-playbook')}. ` +
        (menu.launch ? `The trigger is unambiguous: the ${menu.launch.item_name} launched on ${date(menu.launch.event_date)}${menu.launch.requires_two_step_prep ? ', requires two-step prep' : ''}` +
          (menu.alert ? `, and the ops alert on ${date(menu.alert.event_date)} called out single-lane stores specifically.` : '.') : ''));

      a.listed(`Where the seconds are at ${X.label}, this week against the 30 days before launch:`, mv.map((m, i) =>
        m.change >= 3
          ? (i === 0 ? `${ctx.g(`${cap(SEGMENT[m.name])}: ${signed(m.change)} sec (${n(m.before)} → ${n(m.after)}) — this is the bottleneck`, 'decompose', 'skill:drive-thru-timing')}. Two-step prep is stacking up at the handoff.`
            : `${cap(SEGMENT[m.name])}: ${signed(m.change)} sec (${n(m.before)} → ${n(m.after)}) — secondary.`)
          : `${cap(SEGMENT[m.name])}: flat (~${n(m.after)} sec) — not the issue.`));

      a.p(`At ~${n(fmt.round(risk.orders, -2))} drive-thru orders a week across the ${word(risk.stores)} stores, the revenue-at-risk rule (${pct(risk.rule.share_of_orders * 100)} of orders for every ${risk.rule.every_secs} sec over) puts ` +
        `${ctx.g(`~${k(risk.weekly.central)} a week of drive-thru revenue at stake`, 'quantify', 'skill:what-if-analysis')}.${d && d.secs_vs_benchmark <= 0 ? ` The dual-lane stores are inside benchmark — don't touch them.` : ''}`);

      a.listed(`Friday (${date(friday)}) is ${word(daysLeft)} trading day${daysLeft === 1 ? '' : 's'} away, so only the steps that start tomorrow count. The ops playbook has two:`, [
        `${ctx.g(`Pre-stage ${item} components in the ${play.pre_rush.join(' and ')} pre-rush at ${X.label}`, 'skill:ops-playbook', 'glossary:pre-staging')}. Worth ${stage.join('–')} sec of window time: ${n(x.avg_dt_secs)} → ~${n(afterStage[0])}–${n(afterStage[1])} sec.`,
        `Move one crew member forward into those pre-rush slots: another ${crew.join('–')} sec.`
      ], true);
      a.p(`${ctx.g(`Together: ~${n(afterBoth[0])}–${n(afterBoth[1])} sec by Friday at ${X.the}, against a ${n(x.benchmark)}-sec benchmark`, 'skill:what-if-analysis', 'skill:voice-and-tone', 'scope')} — ` +
        `${afterBoth[1] <= x.benchmark + ignore ? 'at benchmark or within a few seconds of it across the range' : afterBoth[0] <= x.benchmark ? 'at benchmark in the best case, a few seconds over in the cautious one' : 'closer, but still over'}, ` +
        `recovering ${recovered[0] >= risk.weekly.central * 0.98 ? 'essentially all' : kRange(recovered[0], recovered[1])} of the ${k(risk.weekly.central)} weekly risk. That assumes traffic and the ${item}'s share of orders hold where they are.`);
      a.p(`Pre-staging alone leaves ${X.them} ${n(afterStage[0] - x.benchmark)}–${n(afterStage[1] - x.benchmark)} sec over, so do both. Review after ${word(play.review_after_trading_days)} trading days: window time under ${play.working_below_window_secs} sec means it is working; ` +
        `still above ${play.escalate_above_window_secs} means the structural fix — a parallel prep station — is the only path.`);
      ctx.facts = { x, d, afterStage, afterBoth, recovered, risk: risk.weekly };
    }
  });

  // ===================================================================
  // Which of my stores should I prioritize this week?
  // ===================================================================
  MCX.analysis('store-priorities', {
    title: 'Store priorities', intent: 'prescriptive', anyScope: true,
    terms: ['benchmark', 'revenue-at-risk'],
    skills: ['diagnostic-playbook', 'ontology', 'what-if-analysis'],
    models: ['ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM', 'DAILY_SALES_FACT'],
    bare: { topic: 'ranking', cannot: "It's a list, but not a priority list." },
    run(ctx) {
      const t = ctx.time, s = ctx.scope, w = ctx.who, a = ctx.answer;
      const X = E.group(ctx, 'exposed'), D = E.group(ctx, 'dual');
      const item = shortItem(t.launch.item);

      ctx.say('Walking the playbook against the certified GOLD tables.');
      const f = E.formats(ctx, { say: 'Scope to the group that is over benchmark — this week by lane type and parallel staging.' });
      const risk = E.risk(ctx, { atRiskOnly: true, say: 'Rank stores by revenue at risk: seconds over benchmark × drive-thru orders × ticket, with the what-if rule.' });
      const x = f.exposed, d = f.dual;
      ctx.voice();

      if (!risk.stores) {
        a.p(`${ctx.g(`None of ${w.stores} is more than ${risk.rule.ignore_within_secs} sec over benchmark this week`, 'spread', 'quantify', 'persona', 'skill:diagnostic-playbook', 'skill:ontology', 'skill:what-if-analysis', 'skill:voice-and-tone')}, so there is nothing to prioritise on drive-thru time.`);
        return;
      }
      const rows = risk.hit, first = rows[0];
      const allExposed = rows.every((row) => E.formatOf(row) === 'exposed') && rows.length === s.exposed;
      const head = allExposed ? `Prioritize ${X.label} — start with ${first.store_name}` : `Prioritize the ${word(rows.length)} stores over benchmark — start with ${first.store_name}`;
      a.p(`${ctx.g(head, 'persona', 'spread', 'quantify', 'skill:diagnostic-playbook')}.`);
      a.p((allExposed ? `${ctx.g(`All ${X.count} ${X.noun} are over benchmark this week`, 'spread', 'glossary:benchmark', 'skill:ontology')}` : `${ctx.g(`${cap(word(rows.length))} of ${w.stores} are over benchmark this week`, 'spread', 'glossary:benchmark', 'skill:ontology')}`) +
        ` (${pct(x.pct_in_benchmark)} of orders inside benchmark, ${n(x.window_s)} sec at the window${daysSoFar(t).replace(' (', '; ').replace(')', '')}).` +
        (d ? ` ${cap(D.label)} ${D.are} ${d.secs_vs_benchmark <= 0 ? 'fine' : 'closer to target'} (${pct(d.pct_in_benchmark)}, ${n(d.window_s)} sec), so ${D.they}'re not where ${s.own ? 'your' : 'the'} attention goes this week.` : ''));

      const shown = rows.slice(0, Math.min(rows.length, 6));
      a.listed(`${ctx.g('Ranked by revenue at risk', 'quantify', 'skill:what-if-analysis', 'glossary:revenue-at-risk')} (seconds over benchmark × drive-thru volume × ticket):`,
        shown.map((row, i) => (i === 0 ? ctx.g(`${row.store_name} — ${signed(row.secs_vs_benchmark)} sec over, ${n(row.daily_dt_orders)} drive-thru orders a day, ~${k(row.weekly_rev_at_risk)} a week at risk`, 'quantify')
          : `${row.store_name} — ${signed(row.secs_vs_benchmark)} sec, ${n(row.daily_dt_orders)} a day, ~${k(row.weekly_rev_at_risk)}`)), true);

      const topThree = rows.slice(0, 3).reduce((sum, row) => sum + row.weekly_rev_at_risk, 0);
      const volume = rows.slice().sort((p, q) => q.secs_vs_benchmark - p.secs_vs_benchmark)[0];
      a.p((volume.store_name !== first.store_name ? `${volume.store_name} has the biggest gap in seconds, but ${first.store_name} loses more because it serves more cars. ` : '') +
        `The cause and the fix are the same at all ${word(rows.length)} (${item} two-step prep → pre-stage in the pre-rush), so one playbook covers the group. ` +
        (rows.length > 3 ? `If ${s.own ? 'you' : 'the operator'} can only staff a change at a few this week, take the top three first: they carry ${pct(topThree / risk.weekly.central * 100)} of the ~${k(risk.weekly.central)} a week at risk.` : `Together they put ~${k(risk.weekly.central)} a week at risk.`));
      ctx.facts = { rows: rows.map((row) => [row.store_name, row.secs_vs_benchmark, row.weekly_rev_at_risk]), total: risk.weekly };
    }
  });

  // ===================================================================
  // What if I pre-stage Double Stack components — what's the impact?
  // ===================================================================
  MCX.analysis('what-if-prestage', {
    title: 'What-if: pre-staging', intent: 'predictive', anyScope: true,
    terms: ['pre-staging', 'benchmark'],
    skills: ['what-if-analysis', 'ops-playbook', 'drive-thru-timing'],
    models: ['ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM', 'DAILY_SALES_FACT'],
    bare: { topic: 'whatif', needs: 'Pre-staging shifts work from the rush to the pre-rush' },
    run(ctx) {
      const t = ctx.time, s = ctx.scope, w = ctx.who, a = ctx.answer;
      const X = E.group(ctx, 'exposed');
      const item = shortItem(t.launch.item), model = ctx.params('what-if-analysis'), play = ctx.params('ops-playbook');

      ctx.say('Walking the what-if model against the certified GOLD tables.');
      const seg = E.segments(ctx, { key: 'anchor', where: { exposed: true }, after: { from: t.thisWeek.start, to: t.thisWeek.end },
        say: `Anchor on observed reality — ${X.kind} window time this week against the 30 days before launch.` });
      const now = E.formats(ctx, { key: 'position', where: { week: 'this', exposed: true }, say: 'Where those stores sit against benchmark this week.' }).exposed;
      const mix = ctx.one('mix', { model: 'DAILY_SALES_FACT', metrics: ['double_stack_share'], where: { exposed: true, since: t.launch.date } },
        `Check how much of ${X.kind} drive-thru trade is the ${item} — the forecast assumes it holds.`);
      const risk = E.risk(ctx, { atRiskOnly: true, where: { week: 'this', exposed: true }, say: 'Size the revenue at stake with the what-if rule.' });

      const before = seg.exposed.before, after = seg.exposed.after, back = model.pre_stage_secs;
      const blowout = after.window_s - before.window_s;
      const central = (back[0] + back[1]) / 2;
      const windowCase = { low: after.window_s - back[0], central: after.window_s - central, high: after.window_s - back[1] };
      const total = [now.avg_dt_secs - back[1], now.avg_dt_secs - back[0]];
      const left = total.map((secs) => Math.max(0, secs - now.benchmark)).map((secs) => (secs <= model.loss_rule.ignore_within_secs ? 0 : risk.weekly.central * secs / now.secs_vs_benchmark));
      const recovered = [risk.weekly.central - left[1], risk.weekly.central - left[0]];
      ctx.voice();

      a.p(`${ctx.g(`Pre-staging is ${s.own ? 'your' : 'the'} quick win — it goes straight at the bottleneck`, 'skill:what-if-analysis', 'anchor', 'skill:drive-thru-timing')} and should recover most of the gap.`);
      a.p(`Pre-staging ${item} components attacks the two-step prep penalty directly. ${ctx.g(`${cap(w.poss)} ${X.kind} window time is ${n(after.window_s)} sec this week, up from ${n(before.window_s)} sec in the 30 days before launch (a ${n(blowout)}-second blowout)`, 'anchor', 'glossary:pre-staging')}; ` +
        `prep time is up ${n(after.prep_s - before.prep_s)} sec as well, and pre-staging does not touch that.`);
      a.listed(`Projected ${X.kind} window time (ops what-if model):`, [
        `${ctx.g(`Central: ~${n(windowCase.central)} sec — ${n(central)} sec back`, 'skill:what-if-analysis', 'anchor')}, within ${n(Math.max(0, windowCase.central - before.window_s))} sec of the pre-launch ${n(before.window_s)}.`,
        `Low (patchy execution): ~${n(windowCase.low)} sec. High (clean staging in both pre-rush slots, ${play.pre_rush.join(' and ')}): ~${n(windowCase.high)} sec.`
      ]);
      a.p(`In drive-thru time that takes ${X.label} from ${n(now.avg_dt_secs)} sec to about ${n(total[0])}–${n(total[1])}, against a ${n(now.benchmark)} benchmark: much closer, still ${n(total[0] - now.benchmark)}–${n(total[1] - now.benchmark)} sec over. ` +
        `It takes ${ctx.g(`${kRange(recovered[0], recovered[1])} a week off the ~${k(risk.weekly.central)} at risk`, 'quantify', 'skill:what-if-analysis', 'skill:voice-and-tone')}.`);
      a.p(`Two assumptions: traffic holds at current levels, and the ${item} stays about ${pct(mix.ds_share_pct)} of ${X.kind} drive-thru orders. ` +
        `${ctx.g(`Check after ${word(play.review_after_trading_days)} trading days: if ${X.kind} window time is under ${play.working_below_window_secs} sec, it's working`, 'skill:ops-playbook')}; ` +
        `if it is still above ${play.escalate_above_window_secs}, ${s.own ? 'you need' : 'it needs'} a parallel prep station (the structural fix), not just staging.`);
      ctx.facts = { before, after, windowCase, total, recovered, mix };
    }
  });

  // ===================================================================
  // What if I add a parallel prep station at my single-lane stores?
  // ===================================================================
  MCX.analysis('what-if-prep-station', {
    title: 'What-if: parallel prep station', intent: 'predictive', anyScope: true,
    terms: ['parallel-staging', 'retrofit-kit', 'benchmark'],
    skills: ['what-if-analysis', 'ops-playbook', 'retrofit-planning'],
    models: ['ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM', 'DAILY_SALES_FACT', 'DC_STOCK_FACT', 'MENU_CHANGE_LOG'],
    bare: { topic: 'whatif', needs: 'A parallel prep station changes how a kitchen assembles a two-step item' },
    run(ctx) {
      const t = ctx.time, s = ctx.scope, w = ctx.who, a = ctx.answer;
      const X = E.group(ctx, 'exposed'), D = E.group(ctx, 'dual');
      const item = shortItem(t.launch.item), model = ctx.params('what-if-analysis'), play = ctx.params('ops-playbook'), plan = ctx.params('retrofit-planning');

      ctx.say('Walking the what-if model against the certified GOLD tables.');
      const seg = E.segments(ctx, { key: 'own', after: { from: t.thisWeek.start, to: t.thisWeek.end },
        say: `Start from ${w.stores}: each kitchen format this week against the 30 days before launch.` });
      const pilot = E.formats(ctx, { key: 'target', scope: false, where: { since: t.launch.date, lane: 'single_lane' },
        say: 'Find the target state — single-lane kitchens across the network that already have a parallel prep station, since launch.' });
      const now = E.formats(ctx, { key: 'position', where: { week: 'this', exposed: true }, say: `Where ${X.label} sit${X.count === 1 ? 's' : ''} against benchmark this week.` }).exposed;
      const risk = E.risk(ctx, { atRiskOnly: true, where: { week: 'this', exposed: true }, say: 'Size the revenue at stake with the what-if rule.' });
      const kits = ctx.q('kits', { model: 'DC_STOCK_FACT', by: ['dc_name', 'region', 'on_hand', 'lead_time_days', 'unit_cost_usd'], where: { eq: { item: 'PPS-2 retrofit kit' } }, scope: s.kind === 'network' ? false : undefined, order: 'dc.on_hand DESC' },
        'Check retrofit kits: stock, supplier lead time and installed cost.');
      const menu = E.menu(ctx, { planned: true, say: 'Check the menu change log for the next two-step item.' });

      const x = seg.exposed, d = seg.dual, retro = pilot.retrofitted;
      const blowout = x.after.window_s - x.before.window_s;
      const target = retro ? retro.window_s : d ? d.after.window_s : x.before.window_s;
      const windowCase = { low: x.after.window_s - blowout * model.prep_station.low_case_recovery, central: target, high: x.before.window_s };
      const totalCentral = now.avg_dt_secs - (x.after.window_s - target) - (retro ? x.after.prep_s - x.before.prep_s : 0);
      const cost = kits[0].unit_cost_usd, need = s.exposed, onHand = kits.reduce((sum, row) => sum + row.on_hand, 0);
      const residual = Math.max(0, totalCentral - now.benchmark);
      const recovered = residual <= model.loss_rule.ignore_within_secs ? risk.weekly.central : risk.weekly.central * (1 - residual / now.secs_vs_benchmark);
      const payback = need * cost / recovered;
      const stage = model.pre_stage_secs, nextTwoStep = menu.planned.filter((row) => row.requires_two_step_prep)[0];
      const ranked = risk.hit;
      ctx.voice();

      a.p(`${ctx.g(`A parallel prep station is the structural fix — it makes a single-lane kitchen behave like the ones that already stage in parallel`, 'skill:what-if-analysis', 'target', 'glossary:parallel-staging')}.`);
      a.p((retro ? `The evidence is already in the network: ${ctx.g(`the ${word(retro.stores)} single-lane kitchens that have a station are running ${n(retro.window_s)} sec at the window since launch, ${n(Math.abs(retro.secs_vs_benchmark))} sec ${retro.secs_vs_benchmark > 0 ? 'over' : 'under'} benchmark`, 'target')}, with ${pct(retro.pct_in_benchmark)} of orders inside it. ` : '') +
        `${cap(X.label)} ${X.are} at ${n(x.after.window_s)} sec at the window and ${n(now.secs_vs_benchmark)} sec over.` +
        (d ? ` ${s.own ? 'Your own' : cap(w.poss)} ${D.count} dual-lane stores (all with parallel staging) barely moved when the ${item} launched: ${n(d.before.window_s)} → ${n(d.after.window_s)} sec at the window.` : ''));
      a.listed(`Projected window time at ${X.label}:`, [
        `${ctx.g(`Central: ~${n(windowCase.central)} sec (matching the retrofitted kitchens), drive-thru ~${n(totalCentral)} sec against ${n(now.benchmark)}`, 'skill:what-if-analysis', 'target', 'position')}.`,
        `Low: ~${n(windowCase.low)} sec (the station recovers ${pct(model.prep_station.low_case_recovery * 100)} of the blowout). High: ~${n(windowCase.high)} sec, the pre-launch level.`
      ]);
      a.p(`At the central case that removes ${recovered >= risk.weekly.central * 0.98 ? 'essentially all' : '~' + k(recovered)} of the ~${k(risk.weekly.central)} a week at risk.`);
      a.p(`Cost and timing: ${ctx.g(`a PPS-2 kit is ${usd(cost)} installed, so ${need === 1 ? 'the one kitchen' : `${word(need)} kitchens`} is ${usd(need * cost)}, paid back in about ${n(payback)} weeks`, 'kits', 'quantify', 'skill:retrofit-planning', 'glossary:retrofit-kit')}. ` +
        (s.kind === 'network' ? `The distribution centres hold ${n(onHand)} kits between them` : `The ${kits[0].dc_name} has ${n(kits[0].on_hand)} kit${kits[0].on_hand === 1 ? '' : 's'} on hand`) +
        `${(s.kind === 'network' ? onHand : kits[0].on_hand) >= need ? ', enough to cover it' : `; the rest ${need - (s.kind === 'network' ? onHand : kits[0].on_hand) === 1 ? 'is' : 'are'} ${kits[0].lead_time_days} days from the supplier`}. ` +
        `With ${word(plan.install_crews)} install crews fitting one kitchen a night each, ${need <= plan.install_crews ? 'it is a single night' : `${word(Math.ceil(Math.min(need, s.kind === 'network' ? onHand : kits[0].on_hand) / plan.install_crews))} nights for the kits in stock`}.`);
      a.p(`Trade-off vs pre-staging: pre-staging is free and starts tomorrow, but it only wins back ${stage.join('–')} sec and leaves ${X.them} over benchmark; a station costs money and a night's install but holds ` +
        (nextTwoStep ? `through the next two-step item (${nextTwoStep.item_name}, planned for ${date(nextTwoStep.event_date)}). ` : 'through future two-step items. ') +
        `Recommendation: ${ctx.g(`pre-stage everywhere this week, and put stations into the highest-risk kitchens first`, 'skill:ops-playbook', 'skill:voice-and-tone', 'quantify')}` +
        (ranked.length >= 3 ? ` — ${top(ranked, 3, (row) => row.store_name)}.` : '.') +
        ` Escalate sooner if window time is still above ${play.escalate_above_window_secs} sec after ${word(play.review_after_trading_days)} trading days of pre-staging.`);
      ctx.facts = { windowCase, totalCentral, cost, need, payback, retro };
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
