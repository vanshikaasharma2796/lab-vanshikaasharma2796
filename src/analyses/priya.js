/* =====================================================================
   src/analyses/priya.js — Priya, Store Ops

   Network-wide questions, answered format by format. Priya owns lane
   type, parallel staging and the ops playbook, so every answer leads
   with the cut by kitchen format and ends on a playbook step.

     priya/distribution-by-lane-type   What was the drive-thru distribution last week by lane type?
     priya/regions-missing-benchmark   Which regions are missing benchmark right now?
     priya/national-drive-thru-up      Why is our drive-thru time up nationally this week?
     priya/launch-or-staffing          Is the Double Stack launch the cause of the drive-thru spike, or is it staffing?
     priya/playbook-worst-stores       What playbook step do I recommend for the worst-performing single-lane stores?
     priya/operators-intervention      Which operators need a corporate intervention this quarter?
     priya/traffic-up-8-percent        What if traffic increases 8% — which segments break first?
     priya/prestage-everywhere         What if every single-lane store pre-stages from Monday — are we back at benchmark?
   ===================================================================== */
(function (global) {
  'use strict';
  const MCX = global.MCX, fmt = MCX.fmt, E = MCX.evidence, L = E.label;
  const { n, pct, k, kRange, signed, cap, word, list, date, dateRange } = fmt;

  const SEGMENT = { order: 'order time', prep: 'prep time', window: 'window time' };
  const COLUMN = { order: 'order_s', prep: 'prep_s', window: 'window_s' };
  const REGION_ORDER = (a, b) => b.secs_vs_benchmark - a.secs_vs_benchmark;

  function days(t) { return `${dateRange(t.thisWeek.start, t.thisWeek.end)}, ${word(t.thisWeek.days)} days so far`; }
  function inside(secs) { return secs > 0 ? `${n(secs)} sec over` : `${n(Math.abs(secs))} sec inside`; }
  function count(c, noun) { return `${c} ${noun}${c === 1 ? '' : 's'}`; }
  /** Weekly revenue at risk for rows from E.risk, after taking `back` seconds off some of them. */
  function riskAfter(risk, back, applies) {
    const rule = risk.rule;
    return risk.rows.reduce((sum, row) => {
      const over = row.secs_vs_benchmark - (applies(row) ? back : 0);
      const lost = over > rule.ignore_within_secs ? over / rule.every_secs * rule.share_of_orders : 0;
      return sum + row.daily_dt_orders * 7 * lost * row.avg_ticket;
    }, 0);
  }

  // ===================================================================
  // What was the drive-thru distribution last week by lane type?
  // ===================================================================
  MCX.analysis('priya/distribution-by-lane-type', {
    title: 'Distribution by kitchen format', intent: 'descriptive', scope: 'network',
    terms: ['drive-thru-time', 'benchmark', 'lane-type', 'parallel-staging'],
    skills: ['ontology'],
    models: ['ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM'],
    bare: { topic: 'timing', cannot: 'I can give you raw seconds by lane type for a week I had to guess at, but not a distribution against benchmark, and RAW_STORES does not say which single-lane kitchens have been refitted.' },
    run(ctx) {
      const t = ctx.time, a = ctx.answer, week = t.lastWeek;
      ctx.say('Reading the certified GOLD tables.');
      const f = E.formats(ctx, { key: 'formats', where: { week: 'last' }, say: `Last week (${dateRange(week.start, week.end)}) by lane type, split again on parallel staging — single-lane stores are not one group.` });
      const stores = E.stores(ctx, { key: 'stores', where: { week: 'last' }, say: 'The distribution inside each format: every store against its own benchmark.' });
      const launchIn = t.launch.date > week.start && t.launch.date <= week.end;
      const split = launchIn ? E.formats(ctx, { key: 'split', where: { week: 'last' }, split: { at: t.launch.date, before: 'before', after: 'after' },
        metrics: ['days', 'drive_thru_time'], say: `The week straddles the ${date(t.launch.date)} launch. Split it there.` }).rows : [];
      ctx.voice();

      const all = stores.length, mean = stores.reduce((s, r) => s + r.avg_dt_secs, 0) / all, bench = stores.reduce((s, r) => s + r.benchmark, 0) / all;
      const line = (key) => {
        const row = f[key];
        if (!row) return null;
        const own = E.only(stores, key).sort((x, y) => y.avg_dt_secs - x.avg_dt_secs);
        const over = own.filter((r) => r.secs_vs_benchmark > 0).length, far = own.filter((r) => r.secs_vs_benchmark >= 30).length;
        const head = `${cap(L[key])} (${row.stores}): ${n(row.avg_dt_secs)} sec against ${n(row.benchmark)}, ${inside(row.secs_vs_benchmark)}; ${pct(row.pct_in_benchmark)} of orders inside benchmark`;
        return `${key === 'exposed' ? ctx.g(head, 'formats', 'glossary:benchmark') : head}. ` +
          `${over === own.length ? (own.length === 1 ? 'It is' : `All ${own.length} are`) : over === 0 ? 'None is' : `${over} of ${own.length} are`} over benchmark${far ? `, ${far} by 30 sec or more` : ''}; ` +
          `the range runs from ${n(own[own.length - 1].avg_dt_secs)} sec (${own[own.length - 1].store_name}) to ${n(own[0].avg_dt_secs)} (${own[0].store_name}).`;
      };
      a.p(`${ctx.g(`Last week the network averaged ${n(mean)} sec against a blended benchmark of ${n(bench)}`, 'stores', 'glossary:drive-thru-time')}, but the three kitchen formats sat in very different places.`);
      a.list(['exposed', 'retrofitted', 'dual'].map(line));
      if (split.length) {
        const get = (key, period) => E.only(split, key).filter((r) => r.period === period)[0] || {};
        const before = fmt.daysBetween(week.start, t.launch.date);
        a.p(`The week straddles the ${E.item(t.launch.item)} launch on ${fmt.dayDate(t.launch.date)}: ${word(before)} days before it, ${word(7 - before)} after. Split there, ` +
          `${ctx.g(`the ${L.exposed} ran ${n(get('exposed', 'before').avg_dt_secs)} sec before the launch and ${n(get('exposed', 'after').avg_dt_secs)} from it`, 'split')}; ` +
          `the ${L.dual} went ${n(get('dual', 'before').avg_dt_secs)} → ${n(get('dual', 'after').avg_dt_secs)}. Last week's average understates where those ${f.exposed.stores} stores are now.`);
      }
      a.p(`${ctx.g('Read the distribution by kitchen format, not by lane type alone', 'skill:ontology', 'glossary:lane-type', 'glossary:parallel-staging')}: ` +
        (f.retrofitted ? `the ${word(f.retrofitted.stores)} ${L.retrofitted} sit with the dual-lane kitchens, not with the other single-lane stores.` : 'single-lane stores split on whether they have parallel staging.'));
      ctx.facts = { mean, bench, formats: f.rows };
    }
  });

  // ===================================================================
  // Which regions are missing benchmark right now?
  // ===================================================================
  MCX.analysis('priya/regions-missing-benchmark', {
    title: 'Regions against benchmark', intent: 'descriptive', scope: 'network',
    terms: ['benchmark', 'region', 'reporting-week', 'lane-type'],
    skills: ['ontology'],
    models: ['ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM'],
    bare: 'regions',
    run(ctx) {
      const t = ctx.time, a = ctx.answer;
      ctx.say('Reading the certified GOLD tables.');
      if (t.thisWeek.partial) ctx.policy('partial-week', `"Right now" is this week: ${days(t)}. Averages are safe to report; the days are stated.`);
      const regions = E.regions(ctx, { say: 'Each region against its own blended benchmark this week.' });
      const cut = E.formats(ctx, { key: 'region_formats', by: ['region'], metrics: ['stores', 'drive_thru_time', 'secs_vs_benchmark'],
        say: 'A regional average can hide a split. Cut each region by lane type and parallel staging.' }).rows;
      ctx.voice();

      const over = regions.filter((r) => r.secs_vs_benchmark > 0), ok = regions.filter((r) => r.secs_vs_benchmark <= 0);
      const exposed = E.only(cut, 'exposed').sort(REGION_ORDER), dual = E.only(cut, 'dual'), retro = E.only(cut, 'retrofitted');
      const total = E.index(regions, 'region');
      const dualRange = [Math.min.apply(null, dual.map((r) => -r.secs_vs_benchmark)), Math.max.apply(null, dual.map((r) => -r.secs_vs_benchmark))];
      const text = (r) => `the ${r.region} by ${n(Math.abs(r.secs_vs_benchmark))} sec (${n(r.avg_dt_secs)} against ${n(r.benchmark)})`;

      a.p(`${ctx.g(`${cap(word(over.length))} of the ${word(regions.length)} regions ${over.length === 1 ? 'is' : 'are'} over ${over.length === 1 ? 'its' : 'their'} blended benchmark this week`, 'regions', 'glossary:benchmark', 'glossary:region')} (${days(t)}): ` +
        `${list(over.map(text))}. ${ok.length ? `${cap(list(ok.map((r) => `the ${r.region} (${n(Math.abs(r.secs_vs_benchmark))} sec inside)`)))} pass${ok.length === 1 ? 'es' : ''}.` : ''}`);
      a.listed(`The regional average hides the real line. ${ctx.g(`In every region the ${L.exposed} are over benchmark`, 'region_formats', 'skill:ontology')}:`,
        exposed.map((r) => `${r.region}: ${count(r.stores, 'store')}, ${signed(r.secs_vs_benchmark)} sec`));
      a.p(`And in every region the ${L.dual} are ${n(dualRange[0])}–${n(dualRange[1])} sec inside benchmark` +
        (retro.length ? `; the ${retro[0].region}'s ${word(retro[0].stores)} ${L.retrofitted} are ${inside(retro[0].secs_vs_benchmark)}.` : '.'));
      const most = exposed[0], least = exposed[exposed.length - 1];
      a.p(`${ctx.g(`A region misses benchmark when it has many of those kitchens and passes when it has few`, 'region_formats', 'regions', 'glossary:lane-type')}: ` +
        `${most.stores} of ${total[most.region].stores} stores in the ${most.region}, ${least.stores} of ${total[least.region].stores} in the ${least.region}. ` +
        `So the list to work from is not ${word(over.length)} regions but ${exposed.reduce((s, r) => s + r.stores, 0)} kitchens, and the first playbook step for all of them is pre-staging.`);
      ctx.facts = { regions, exposed };
    }
  });

  // ===================================================================
  // Why is our drive-thru time up nationally this week?
  // ===================================================================
  MCX.analysis('priya/national-drive-thru-up', {
    title: 'Network drive-thru diagnosis', intent: 'diagnostic', scope: 'network',
    terms: ['drive-thru-time', 'benchmark', 'parallel-staging'],
    skills: ['diagnostic-playbook', 'seasonality-check', 'drive-thru-timing', 'what-if-analysis'],
    models: ['ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM', 'MENU_CHANGE_LOG', 'DAILY_SALES_FACT'],
    bare: 'timing',
    run(ctx) {
      const t = ctx.time, a = ctx.answer, item = E.item(t.launch.item), found = {};
      const steps = {
        scope() {
          E.calendar(ctx);
          if (t.thisWeek.partial) ctx.policy('partial-week', `Data ends ${fmt.dayDate(t.maxDate)}, so "this week" is ${days(t)}. Averages can be compared; totals cannot.`);
        },
        confirm() { found.weeks = E.readWeeks(ctx, E.weeks(ctx, { say: 'Confirm the metric moved — the network trend, week by week.' })); },
        seasonality() {
          found.lastYear = E.lastYear(ctx, { say: 'Rule out seasonality — the same days last year.' });
          found.weather = E.weather(ctx, { say: 'Rule out weather — rain across the network this week.' });
        },
        spread() {
          found.formats = E.formats(ctx, { say: 'Spread — which kitchens moved? Lane type and parallel staging first.' });
          found.gradient = E.regions(ctx, { key: 'gradient', where: { week: 'this', exposed: true }, metrics: ['stores', 'secs_vs_benchmark', 'window_time'],
            say: 'And region by region, for the format that moved.' });
        },
        decompose() { found.segments = E.segments(ctx, { say: `Decompose — order, prep and window before and after ${date(t.launch.date)}.` }); },
        correlate() { found.menu = E.menu(ctx, { say: 'Correlate — the menu change log at the break.' }); },
        quantify() { found.risk = E.risk(ctx, { atRiskOnly: true, say: 'Quantify — revenue at risk with the what-if rule.' }); }
      };
      ctx.say('Walking the playbook against the certified GOLD tables.');
      ctx.skill('diagnostic-playbook').steps.forEach((name) => { if (steps[name]) steps[name](); });
      ['weeks', 'formats', 'segments', 'menu'].forEach((need) => { if (!found[need]) throw new Error('the diagnostic playbook must keep its confirm, spread, decompose and correlate steps'); });
      ctx.voice();

      const W = found.weeks, f = found.formats, x = f.exposed, d = f.dual, r = f.retrofitted, seg = found.segments.exposed, menu = found.menu;
      const mv = ctx.params('drive-thru-timing').segments.map((name) => ({ name, change: seg.after[COLUMN[name]] - seg.before[COLUMN[name]], before: seg.before[COLUMN[name]], after: seg.after[COLUMN[name]] }))
        .sort((p, q) => q.change - p.change);

      let p = `${ctx.g(`The ${item} launch on ${date(t.launch.date)} is hitting one kitchen format: the ${x.stores} ${L.exposed}`, 'correlate', 'spread', 'skill:diagnostic-playbook', 'glossary:parallel-staging')}. ` +
        `Network drive-thru time went from ~${n(W.baseline)} sec before the launch to ${n(W.now.avg_dt_secs)} this week, against a blended benchmark of ${n(W.now.benchmark)}, and the rise is in those stores: ` +
        `${ctx.g(`${n(x.avg_dt_secs)} sec against a ${n(x.benchmark)}-sec benchmark (${signed(x.secs_vs_benchmark)})`, 'spread', 'glossary:drive-thru-time', 'glossary:benchmark')}. ` +
        `${ctx.g(`The ${d.stores} ${L.dual} are ${inside(d.secs_vs_benchmark)}`, 'spread')}` + (r ? ` and the ${word(r.stores)} ${L.retrofitted} are ${inside(r.secs_vs_benchmark)}.` : '.');
      if (found.lastYear && found.weather) {
        p += ` ${ctx.g('It is not seasonal and it is not weather', 'seasonality', 'weather', 'skill:seasonality-check')}: the same days last year ran ${n(found.lastYear.then.avg_dt_secs)} sec, and ` +
          (found.weather.dry ? 'the week has been dry.' : `rain fell on ${list(found.weather.wet.map(fmt.weekday))} only, while the rise is in all four regions.`);
      }
      a.p(p);
      a.p(`${ctx.g(`The bottleneck is ${SEGMENT[mv[0].name]}`, 'decompose', 'skill:drive-thru-timing')}: ${n(mv[0].before)} → ${n(mv[0].after)} sec at those stores since launch` +
        (mv[1].change >= 3 ? `, with ${SEGMENT[mv[1].name]} adding ${n(mv[1].change)}` : '') + `. ` +
        (menu.launch ? `The menu change log has the launch as two-step prep with ${menu.launch.ops_impact_level} ops impact` + (menu.alert ? `, and an ops alert on ${date(menu.alert.event_date)} for exactly this.` : '.') : ''));
      if (found.gradient) {
        a.p(`The size of the hit follows the region: ${list(found.gradient.map((row) => `${signed(row.secs_vs_benchmark)} sec in the ${row.region} (${count(row.stores, 'store')})`))}.`);
      }
      if (found.risk && found.risk.stores) {
        const risk = found.risk, play = ctx.params('what-if-analysis');
        a.p(`${ctx.g(`Revenue at risk is ~${k(risk.weekly.central)} a week across ${risk.stores} stores`, 'quantify', 'skill:what-if-analysis')} (range ${kRange(risk.weekly.low, risk.weekly.high)}). ` +
          `Playbook step: pre-stage in the pre-rush at all ${x.stores} from tomorrow, worth ${play.pre_stage_secs.join('–')} sec of window time each.`);
      }
      ctx.facts = { baseline: W.baseline, now: W.now.avg_dt_secs, x, d, r, moves: mv };
    }
  });

  // ===================================================================
  // Is the Double Stack launch the cause of the drive-thru spike, or is it staffing?
  // ===================================================================
  MCX.analysis('priya/launch-or-staffing', {
    title: 'Launch or staffing', intent: 'diagnostic', scope: 'network',
    terms: ['staffing-fill-rate', 'drive-thru-time', 'double-stack'],
    skills: ['cause-attribution', 'drive-thru-timing'],
    models: ['ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM', 'STAFFING_DAILY_FACT', 'MENU_CHANGE_LOG', 'DAILY_SALES_FACT'],
    bare: 'staffing',
    run(ctx) {
      const t = ctx.time, a = ctx.answer, item = E.item(t.launch.item), found = {};
      const firstWeekEnd = fmt.addDays(t.trendStart, 6);
      const steps = {
        'timing'() {
          found.weeks = E.readWeeks(ctx, E.weeks(ctx, { key: 'timing', say: 'Timing — which candidate changed when the metric broke? Drive-thru time by week.' }));
          found.fill = E.staffing(ctx, { key: 'fill', say: 'The same weeks for staffing: shift fill rate.' });
          found.menu = E.menu(ctx, { key: 'launch', say: 'And the launch date from the menu change log.' });
        },
        'who-moved'() {
          found.segments = E.segments(ctx, { key: 'who_moved', say: 'Who moved and who did not — each kitchen format before and after the launch.' });
          found.fillFormats = ctx.q('fill_formats', { model: 'STAFFING_DAILY_FACT', by: ['lane_type', 'has_parallel_staging'], metrics: ['stores', 'fill_rate'], where: { since: t.launch.date }, order: 'f.lane_type DESC, f.has_parallel_staging' },
            'Were the formats staffed differently? Fill rate by format since launch.');
        },
        'which-seconds'() { /* read from the before/after split already pulled */ },
        'dose-response'() {
          found.dose = E.regions(ctx, { key: 'dose', where: { exposed: true, from: t.baseline.from, to: t.maxDate }, split: { at: t.launch.date, before: 'before', after: 'after' },
            metrics: ['window_time'], order: 'f.region, period DESC', say: 'Dose-response — the window blowout at exposed stores, region by region.' });
          found.mix = ctx.q('mix', { model: 'DAILY_SALES_FACT', by: ['region'], metrics: ['double_stack_share'], where: { exposed: true, since: t.launch.date }, order: 'ds_share_pct DESC' },
            `Against how much of their drive-thru trade is the ${item}.`);
        },
        'exceptions'() {
          found.operators = ctx.q('exceptions', { model: 'STAFFING_DAILY_FACT', by: ['operator_name'],
            columns: [{ sql: `ROUND(AVG(CASE WHEN s.date <= '${firstWeekEnd}' THEN s.shift_fill_rate END) * 100, 1)`, as: 'fill_then' },
              { sql: `ROUND(AVG(CASE WHEN s.date >= '${t.launch.date}' THEN s.shift_fill_rate END) * 100, 1)`, as: 'fill_now' }],
            where: { since: t.trendStart }, order: 'fill_now - fill_then' }, 'Exceptions — is there anyone staffing does explain? Fill rate by operator, mid-March against now.');
        }
      };
      ctx.say('Running the attribution checklist against the certified GOLD tables.');
      ctx.skill('cause-attribution').steps.forEach((name) => { if (steps[name]) steps[name](); });
      const fallen = (found.operators || []).filter((row) => row.fill_then - row.fill_now >= 3);
      if (fallen.length) {
        found.drift = E.readWeeks(ctx, E.weeks(ctx, { key: 'exception_trend', scope: { kind: 'operator', operator: fallen[0].operator_name },
          say: `${fallen[0].operator_name}'s fill rate fell. Did those stores' times move before the launch?` }));
      }
      ctx.voice();

      const W = found.weeks, seg = found.segments, x = seg.exposed, d = seg.dual, r = seg.retrofitted;
      const fill = found.fill, fillBefore = fill.filter((row) => fmt.addDays(row.week_start, 6) < t.launch.date), fillNow = fill[fill.length - 1];
      const avgFill = fillBefore.reduce((s, row) => s + row.fill_rate_pct, 0) / (fillBefore.length || 1);
      const mv = ctx.params('drive-thru-timing').segments.map((name) => ({ name, change: x.after[COLUMN[name]] - x.before[COLUMN[name]] }));
      const change = E.index(mv, 'name'), ff = E.byFormat(found.fillFormats);
      const dose = found.mix.map((m) => {
        const rows = found.dose.filter((row) => row.region === m.region), by = E.index(rows, 'period');
        return { region: m.region, share: m.ds_share_pct, blowout: by.after.window_s - by.before.window_s };
      });
      const ordered = dose.every((row, i) => i === 0 || row.blowout <= dose[i - 1].blowout);

      a.p(`${ctx.g(`It is the launch. Staffing explains ${fallen.length ? 'one operator' : 'none of it'}, not the spike`, 'timing', 'who_moved', 'skill:cause-attribution')}.`);
      const lines = [
        `Timing. Drive-thru time was flat at ~${n(W.baseline)} sec for ${word(W.before.length)} weeks and broke in the week of ${date(W.launchWeek.week_start)}, the week the ${item} launched (${date(t.launch.date)}). ` +
          `${ctx.g(`Network shift fill rate was ${pct(avgFill, 1)} before and is ${pct(fillNow.fill_rate_pct, 1)} now: no step`, 'fill', 'glossary:staffing-fill-rate')}.`,
        `Who moved. Only the ${x.before ? found.fillFormats.filter((row) => E.formatOf(row) === 'exposed')[0].stores : ''} ${L.exposed}: ${n(x.before.avg_dt_secs)} → ${n(x.after.avg_dt_secs)} sec. The ${L.dual} went ${n(d.before.avg_dt_secs)} → ${n(d.after.avg_dt_secs)}` +
          (r ? ` and the ${L.retrofitted} ${n(r.before.avg_dt_secs)} → ${n(r.after.avg_dt_secs)}` : '') + `, on fill rates of ${pct(ff.exposed.fill_rate_pct, 1)}, ${pct(ff.dual.fill_rate_pct, 1)}${ff.retrofitted ? ` and ${pct(ff.retrofitted.fill_rate_pct, 1)}` : ''}.`,
        `${ctx.g(`Which seconds. Window time ${signed(change.window.change)} sec, prep ${signed(change.prep.change)}, order ${signed(change.order.change)}`, 'who_moved', 'skill:drive-thru-timing')}. A short crew shows in order and prep; a two-step item with nowhere to be assembled shows at the window.`,
        `Dose-response. ${ctx.g(`Where the ${item} is a bigger share of orders, the window blowout is bigger`, 'dose', 'mix', 'glossary:double-stack')}: ${list(dose.map((row) => `${row.region} ${pct(row.share)} → ${signed(row.blowout)} sec`))}${ordered ? '' : ' (not perfectly in order)'}.`
      ];
      if (fallen.length && found.drift) {
        const D = found.drift, first = D.before[0], last = D.before[D.before.length - 1];
        lines.push(`Exceptions. ${ctx.g(`${fallen[0].operator_name}: fill rate ${pct(fallen[0].fill_then)} → ${pct(fallen[0].fill_now)}`, 'exceptions', 'exception_trend')}, and those stores went from ${n(first.avg_dt_secs)} to ${n(last.avg_dt_secs)} sec before the launch, on prep time (${n(first.prep_s)} → ${n(last.prep_s)}). That part is staffing, and it needs its own ops review.`);
      } else {
        lines.push('Exceptions. No operator shows a fall in fill rate large enough to matter.');
      }
      a.listed('The attribution checklist, in order:', lines, true);
      a.p(`Verdict: the launch, with high confidence. One format moved, one segment moved, on the launch date, in proportion to how much ${item} each region sells. The playbook step is pre-staging at the exposed stores; ${fallen.length ? `${fallen[0].operator_name}'s scheduling is a separate conversation.` : 'no staffing action is indicated.'}`);
      ctx.facts = { dose, fallen, avgFill };
    }
  });

  // ===================================================================
  // What playbook step do I recommend for the worst-performing single-lane stores?
  // ===================================================================
  MCX.analysis('priya/playbook-worst-stores', {
    title: 'Playbook for the worst stores', intent: 'prescriptive', scope: 'network',
    terms: ['pre-staging', 'parallel-staging', 'benchmark', 'lane-type'],
    skills: ['ops-playbook', 'what-if-analysis'],
    models: ['ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM', 'MENU_CHANGE_LOG'],
    bare: { topic: 'ranking', cannot: 'I can list the slowest single-lane stores on raw seconds.' },
    run(ctx) {
      const t = ctx.time, a = ctx.answer, item = E.item(t.launch.item);
      const play = ctx.params('ops-playbook'), model = ctx.params('what-if-analysis');
      ctx.say('Walking the ops playbook against the certified GOLD tables.');
      const stores = E.stores(ctx, { key: 'worst', where: { week: 'this', exposed: true }, by: ['region'], say: 'Rank the single-lane stores without parallel staging by seconds over benchmark this week.' });
      const menu = E.menu(ctx, { say: 'The playbook applies to a two-step item. Check the menu change log.' });
      const pilot = E.formats(ctx, { key: 'pilot', where: { since: t.launch.date, lane: 'single_lane' }, say: 'Evidence for step 3 — single-lane kitchens that already have a parallel prep station, since launch.' }).retrofitted;
      ctx.voice();

      const ignore = model.loss_rule.ignore_within_secs, stage = model.pre_stage_secs, crew = model.crew_forward_secs;
      const mid = (pair) => (pair[0] + pair[1]) / 2;
      const afterOne = stores.filter((row) => row.secs_vs_benchmark - mid(stage) > ignore);
      const afterTwo = stores.filter((row) => row.secs_vs_benchmark - mid(stage) - mid(crew) > ignore);
      const stillHigh = stores.filter((row) => row.window_s - stage[0] - crew[0] > play.escalate_above_window_secs);
      const windows = stores.map((row) => row.window_s), worst = stores.slice(0, 5);
      const regions = []; worst.forEach((row) => { if (regions.indexOf(row.region) === -1) regions.push(row.region); });

      a.p(`${ctx.g(`Step 1, pre-staging, at all ${stores.length} ${L.exposed}, starting tomorrow`, 'skill:ops-playbook', 'worst', 'glossary:pre-staging')}; step 2 on top at the ${afterOne.length} where pre-staging alone will not reach benchmark.`);
      a.p(`The worst five this week (${days(t)}) are all in the ${list(regions)}: ${ctx.g(list(worst.map((row) => `${row.store_name} (${signed(row.secs_vs_benchmark)} sec)`)), 'worst', 'glossary:benchmark')}. ` +
        `Window time across the ${stores.length} runs from ${n(Math.min.apply(null, windows))} to ${n(Math.max.apply(null, windows))} sec` +
        (menu.launch && menu.launch.requires_two_step_prep ? `, and the menu change log confirms the cause the playbook is written for: a two-step item (${item}, ${date(menu.launch.event_date)}).` : '.'));
      a.listed('What each step is worth (ops what-if model):', [
        `${ctx.g(`Step 1 — pre-stage ${item} components in the ${play.pre_rush.join(' and ')} pre-rush: ${stage.join('–')} sec back`, 'skill:what-if-analysis', 'skill:ops-playbook')}. Free, starts the next day. On its own it brings ${stores.length - afterOne.length} of the ${stores.length} to within ${ignore} sec of benchmark.`,
        `Step 2 — one crew member forward into the pre-rush: another ${crew.join('–')} sec. With both, ${afterTwo.length ? `${stores.length - afterTwo.length} of the ${stores.length} are` : `all ${stores.length} are`} at or near benchmark in the central case.`,
        `Step 3 — a parallel prep station, only where window time is still above ${play.escalate_above_window_secs} sec after ${word(play.review_after_trading_days)} trading days` +
          (stillHigh.length ? `; on today's figures that is ${count(stillHigh.length, 'store')}.` : '; on today\'s figures steps 1 and 2 should clear that bar everywhere.') +
          (pilot ? ` ${ctx.g(`The ${word(pilot.stores)} retrofitted kitchens show what it does: ${n(pilot.window_s)} sec at the window, ${inside(pilot.secs_vs_benchmark)}`, 'pilot', 'glossary:parallel-staging')}, through the same launch.` : '')
      ]);
      a.p(`Do not recommend pulling the item: the playbook requires steps 1 and 2 first. Review window time store by store after ${word(play.review_after_trading_days)} trading days; under ${play.working_below_window_secs} sec means it is working.`);
      ctx.facts = { afterOne: afterOne.length, afterTwo: afterTwo.length, stillHigh: stillHigh.length };
    }
  });

  // ===================================================================
  // Which operators need a corporate intervention this quarter?
  // ===================================================================
  MCX.analysis('priya/operators-intervention', {
    title: 'Operator scorecard', intent: 'prescriptive', scope: 'network',
    terms: ['intervention', 'operators', 'benchmark', 'staffing-fill-rate'],
    skills: ['operator-scorecard'],
    models: ['ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM', 'STAFFING_DAILY_FACT'],
    bare: { topic: 'regions', by: 'operator', cannot: 'I can rank operators on raw seconds, which mostly ranks them by how many dual-lane stores they have.' },
    run(ctx) {
      const t = ctx.time, a = ctx.answer, rule = ctx.params('operator-scorecard');
      const firstWeekEnd = fmt.addDays(t.trendStart, 6);
      ctx.say('Applying the operator scorecard to the certified GOLD tables.');
      const card = ctx.q('scorecard', { model: 'ORDER_TIMING_MART', by: ['operator_name', 'region', 'lane_type', 'has_parallel_staging'], metrics: ['stores', 'secs_vs_benchmark'], where: { week: 'this' },
        order: 'f.operator_name, f.lane_type DESC, f.has_parallel_staging' }, 'Like for like — every operator by kitchen format this week. A plain average only ranks them by lane mix.');
      const over = E.stores(ctx, { key: 'trigger', by: ['operator_name'], having: `AVG(t.secs_vs_benchmark) >= ${rule.watch.secs_over}`, metrics: ['secs_vs_benchmark'],
        say: `First test — stores ${rule.trigger.secs_over}+ sec over benchmark, counted by operator (and ${rule.watch.secs_over}+ for the watch list).` });
      const before = ctx.q('drift', { model: 'ORDER_TIMING_MART', by: ['operator_name', 'week_start'], metrics: ['secs_vs_benchmark', 'prep_time'], where: { exposed: true, since: t.trendStart, before: t.launch.date },
        order: 'f.operator_name, t.week_start' }, `Second test — stores more than ${rule.drift.secs_over} sec over for ${word(rule.drift.weeks)} weeks running. Exposed stores, week by week, before the launch.`);
      const fill = ctx.q('fill', { model: 'STAFFING_DAILY_FACT', by: ['operator_name'],
        columns: [{ sql: `ROUND(AVG(CASE WHEN s.date <= '${firstWeekEnd}' THEN s.shift_fill_rate END) * 100, 1)`, as: 'fill_then' },
          { sql: `ROUND(AVG(CASE WHEN s.date >= '${t.launch.date}' THEN s.shift_fill_rate END) * 100, 1)`, as: 'fill_now' }],
        where: { since: t.trendStart }, order: 'fill_now - fill_then' }, 'Execution evidence — shift fill rate by operator, mid-March against now.');
      ctx.voice();

      const names = []; card.forEach((row) => { if (names.indexOf(row.operator_name) === -1) names.push(row.operator_name); });
      const fillBy = E.index(fill, 'operator_name');
      const ops = names.map((name) => {
        const rows = card.filter((row) => row.operator_name === name), f = E.byFormat(rows);
        const weeks = before.filter((row) => row.operator_name === name && fmt.addDays(row.week_start, 6) < t.launch.date);
        let run = 0; for (let i = weeks.length - 1; i >= 0 && weeks[i].secs_vs_benchmark > rule.drift.secs_over; i--) run++;
        return { name, region: rows[0].region, x: f.exposed, d: f.dual,
          hot: over.filter((row) => row.operator_name === name && row.secs_vs_benchmark >= rule.trigger.secs_over).length,
          warm: over.filter((row) => row.operator_name === name).length,
          run, prep: weeks.length ? [weeks[0].prep_s, weeks[weeks.length - 1].prep_s] : null, fill: fillBy[name] };
      });
      const triggered = ops.filter((o) => o.hot >= rule.trigger.stores || o.run >= rule.drift.weeks).sort((p, q) => q.run - p.run || q.hot - p.hot);
      const drifting = triggered.filter((o) => o.run >= rule.drift.weeks), structural = triggered.filter((o) => o.run < rule.drift.weeks);
      const watch = ops.filter((o) => triggered.indexOf(o) === -1 && o.warm > 0).sort((p, q) => q.warm - p.warm);
      const others = ops.filter((o) => drifting.indexOf(o) === -1 && o.d);
      const dualRange = [Math.min.apply(null, others.map((o) => -o.d.secs_vs_benchmark)), Math.max.apply(null, others.map((o) => -o.d.secs_vs_benchmark))];

      a.p(`${ctx.g(`${cap(word(triggered.length))} operators meet the ops-review trigger`, 'trigger', 'drift', 'glossary:intervention', 'skill:operator-scorecard')}` +
        (drifting.length && structural.length ? ', for two different reasons, and they need different things.' : '.') +
        ` The trigger: ${word(rule.trigger.stores)} or more stores ${rule.trigger.secs_over}+ sec over benchmark, or stores more than ${rule.drift.secs_over} sec over for ${word(rule.drift.weeks)} weeks running.`);
      const lines = structural.map((o) => `${o.name} (${o.region}): ${count(o.hot, 'store')} at ${rule.trigger.secs_over}+ sec over. All are single-lane without parallel staging (${signed(o.x.secs_vs_benchmark)} sec); ` +
        `the ${o.d.stores} dual-lane stores are ${inside(o.d.secs_vs_benchmark)}, and fill rate is steady at ${pct(o.fill.fill_now)}. ${ctx.g(`Structural: ${o.name.split(' ')[0]} needs kitchens, not a review`, 'scorecard', 'fill')}.`);
      drifting.forEach((o) => lines.push(`${o.name} (${o.region}): ${count(o.hot, 'store')} at ${rule.trigger.secs_over}+ over, and the second test as well. ` +
        `${ctx.g(`Those stores were already more than ${rule.drift.secs_over} sec over for ${word(o.run)} weeks before the launch`, 'drift')}, on prep time (${n(o.prep[0])} → ${n(o.prep[1])} sec); ` +
        `the dual-lane stores are only ${n(-o.d.secs_vs_benchmark)} sec inside benchmark against ${n(dualRange[0])}–${n(dualRange[1])} for everyone else; and ${ctx.g(`shift fill rate has fallen from ${pct(o.fill.fill_then)} to ${pct(o.fill.fill_now)}`, 'fill', 'glossary:staffing-fill-rate')}. Execution: an operations review of scheduling and prep, as well as the kitchens.`));
      a.list(lines);
      if (watch.length) a.p(`Watch list (stores ${rule.watch.secs_over}+ sec over, below the trigger): ${list(watch.map((o) => `${o.name} (${o.warm})`))}. Same kitchen format, fewer of them.`);
      a.p(`So the intervention is capital for parallel prep stations for ${list(structural.map((o) => o.name.split(' ')[0]))}${drifting.length ? `, and an ops review for ${list(drifting.map((o) => o.name.split(' ')[0]))}` : ''}. ` +
        `${ctx.g('Do not rank operators on a plain average: the lane mix decides it', 'skill:operator-scorecard', 'scorecard')}.`);
      ctx.facts = { triggered: triggered.map((o) => [o.name, o.hot, o.run]), watch: watch.map((o) => [o.name, o.warm]) };
    }
  });

  // ===================================================================
  // What if traffic increases 8% — which segments break first?
  // ===================================================================
  MCX.analysis('priya/traffic-up-8-percent', {
    title: 'What-if: more traffic', intent: 'predictive', scope: 'network',
    terms: ['service-breach', 'benchmark', 'parallel-staging'],
    skills: ['what-if-analysis'],
    models: ['ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM'],
    bare: { topic: 'whatif', needs: 'More traffic slows a drive-thru by an amount that depends on the kitchen' },
    run(ctx) {
      const t = ctx.time, a = ctx.answer, model = ctx.params('what-if-analysis'), breach = ctx.term('service-breach').rule;
      const asked = /(\d+(?:\.\d+)?)\s*%/.exec(ctx.question), up = asked ? Number(asked[1]) : 5;
      ctx.say('Walking the what-if model against the certified GOLD tables.');
      const f = E.formats(ctx, { key: 'position', say: 'Where each kitchen format stands this week, before any extra traffic.' });
      const regions = E.regions(ctx, { key: 'exposed_regions', where: { week: 'this', exposed: true }, metrics: ['stores', 'secs_vs_benchmark', 'pct_in_benchmark'], say: 'The exposed stores are not one group either. Region by region.' });
      ctx.voice();

      const rate = { exposed: model.traffic_secs_per_pct.exposed, retrofitted: model.traffic_secs_per_pct.retrofitted, dual: model.traffic_secs_per_pct.dual_lane };
      const inBreach = (row) => row.secs_vs_benchmark > breach.secs_over || row.pct_in_benchmark < breach.min_pct_inside;
      const add = (key) => [up * rate[key][0], up * rate[key][1]];
      const needs = (row, key) => Math.max(0, (breach.secs_over - row.secs_vs_benchmark) / rate[key][1]);    // traffic % at which the top of the range breaches
      const already = regions.filter(inBreach), next = regions.filter((row) => !inBreach(row)).map((row) => Object.assign({ at: needs(row, 'exposed') }, row)).sort((p, q) => p.at - q.at);
      const breaks = next.filter((row) => row.at <= up);
      const line = (key) => {
        const row = f[key];
        if (!row) return null;
        const more = add(key);
        return `${cap(L[key])} (${row.stores}): ${signed(row.secs_vs_benchmark)} sec now, ${pct(row.pct_in_benchmark)} of orders inside benchmark. Adds ${n(more[0])}–${n(more[1])} sec: ${signed(row.secs_vs_benchmark + more[0])} to ${signed(row.secs_vs_benchmark + more[1])}. ` +
          (inBreach(row) ? 'Already in breach.' : row.secs_vs_benchmark + more[1] > breach.secs_over ? 'Breaks.' : `Holds; it would take about ${n(needs(row, key))}% more traffic to breach.`);
      };

      a.p(`${ctx.g(`The ${L.exposed} are already in breach, so more traffic does not break them first: it breaks them further`, 'position', 'glossary:service-breach')}. ` +
        (breaks.length ? `What newly breaks at +${n(up, up % 1 ? 1 : 0)}%: ${list(breaks.map((row) => `the ${row.stores} in the ${row.region}`))}.` : `Nothing new breaks at +${n(up, up % 1 ? 1 : 0)}%.`) +
        ` A breach is a segment more than ${breach.secs_over} sec over its benchmark, or with under ${breach.min_pct_inside}% of orders inside it.`);
      a.listed(`This week (${days(t)}), and with ${n(up, up % 1 ? 1 : 0)}% more traffic (ops what-if model):`, ['exposed', 'retrofitted', 'dual'].map(line));
      a.p(`Inside the exposed group the order is set by where each region already stands. ` +
        (already.length ? `${ctx.g(`Already in breach: ${list(already.map((row) => `the ${row.region} (${signed(row.secs_vs_benchmark)} sec, ${count(row.stores, 'store')})`))}`, 'exposed_regions')}. ` : '') +
        (next.length ? `${ctx.g(`First to break: ${list(next.map((row) => `the ${row.region} at about +${n(Math.max(1, row.at))}% traffic (${signed(row.secs_vs_benchmark)} sec now)`))}`, 'exposed_regions', 'skill:what-if-analysis')}.` : ''));
      a.p(`${ctx.g('Kitchens with parallel staging have room', 'position', 'skill:what-if-analysis', 'glossary:parallel-staging')}: each 1% of traffic costs them ${n(rate.dual[0], 2)}–${n(rate.retrofitted[1], 1)} sec against ${n(rate.exposed[0], 1)}–${n(rate.exposed[1], 1)} at an exposed store. ` +
        `Assumptions: item mix unchanged and nothing fixed first. Pre-staging before the traffic arrives is the playbook step that changes this answer.`);
      ctx.facts = { up, already: already.map((r) => r.region), next: next.map((r) => [r.region, r.at]) };
    }
  });

  // ===================================================================
  // What if every single-lane store pre-stages from Monday — are we back at benchmark?
  // ===================================================================
  MCX.analysis('priya/prestage-everywhere', {
    title: 'What-if: pre-staging everywhere', intent: 'predictive', scope: 'network',
    terms: ['pre-staging', 'benchmark', 'lane-type', 'parallel-staging'],
    skills: ['what-if-analysis', 'ops-playbook'],
    models: ['ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM', 'DAILY_SALES_FACT'],
    bare: { topic: 'whatif', needs: 'Pre-staging moves work from the rush to the pre-rush' },
    run(ctx) {
      const t = ctx.time, a = ctx.answer, model = ctx.params('what-if-analysis'), play = ctx.params('ops-playbook');
      const monday = fmt.addDays(t.thisWeek.start, 7), stage = model.pre_stage_secs, crew = model.crew_forward_secs, ignore = model.loss_rule.ignore_within_secs;
      ctx.say('Walking the what-if model against the certified GOLD tables.');
      const net = ctx.one('network', { model: 'ORDER_TIMING_MART', metrics: ['stores', 'drive_thru_time', 'benchmark', 'secs_vs_benchmark'], where: { week: 'this' } }, 'Where the network stands this week against its blended benchmark.');
      const regions = E.regions(ctx, { key: 'exposed_regions', where: { week: 'this', exposed: true }, metrics: ['stores', 'drive_thru_time', 'secs_vs_benchmark', 'window_time'], say: 'The stores that would pre-stage — single-lane without parallel staging, by region.' });
      const risk = E.risk(ctx, { atRiskOnly: true, say: 'Revenue at risk today, store by store, to re-run after the change.' });
      ctx.voice();

      const exposed = regions.reduce((s, row) => s + row.stores, 0), share = exposed / net.stores;
      const netAfter = [net.avg_dt_secs - share * stage[1], net.avg_dt_secs - share * stage[0]];
      const isExposed = (row) => E.formatOf(row) === 'exposed';
      const still = risk.rows.filter((row) => isExposed(row) && row.secs_vs_benchmark - (stage[0] + stage[1]) / 2 > ignore).length;
      const left = [riskAfter(risk, stage[1], isExposed), riskAfter(risk, stage[0], isExposed)];
      const leftBoth = riskAfter(risk, (stage[0] + stage[1] + crew[0] + crew[1]) / 2, isExposed);
      const where = (row) => {
        const lo = row.secs_vs_benchmark - stage[1], hi = row.secs_vs_benchmark - stage[0];
        return `${row.region} (${count(row.stores, 'store')}): ${signed(row.secs_vs_benchmark)} sec → ${hi <= ignore && lo <= 0 ? (hi <= 0 ? 'inside benchmark' : 'at benchmark') : `${signed(lo)} to ${signed(hi)}`}`;
      };
      const overRegions = regions.filter((row) => row.secs_vs_benchmark - stage[0] > ignore);

      a.p(`${ctx.g(`On the network average, ${netAfter[1] <= net.benchmark ? 'yes' : 'not quite'}`, 'network', 'skill:what-if-analysis', 'glossary:benchmark')}. ` +
        (overRegions.length ? `In the ${list(overRegions.map((row) => row.region))} single-lane kitchens, not yet.` : 'And in every region the single-lane kitchens come back too.'));
      a.listed(`If all ${exposed} ${L.exposed} pre-stage from ${fmt.dayDate(monday)}, the what-if model takes ${stage.join('–')} sec off their window time:`, [
        `${ctx.g(`Network: ${n(net.avg_dt_secs)} sec now → about ${n(netAfter[0])}–${n(netAfter[1])}, against a blended benchmark of ${n(net.benchmark)}`, 'network', 'exposed_regions', 'glossary:pre-staging')}.`
      ].concat(regions.map(where)));
      a.p(`${ctx.g(`${still} of the ${exposed} would still be more than ${ignore} sec over after step 1`, 'quantify', 'skill:what-if-analysis')}. Step 2 of the playbook, one crew member forward into the ${play.pre_rush.join(' and ')} pre-rush, is worth another ${crew.join('–')} sec and closes most of that.`);
      a.p(`${ctx.g(`Revenue at risk falls from ~${k(risk.weekly.central)} a week to ${kRange(left[0], left[1])}`, 'quantify', 'skill:what-if-analysis')} with pre-staging alone, and to about ${k(leftBoth)} with both steps.`);
      a.p(`Assumptions: traffic flat, the Double Stack's share of orders unchanged, and clean execution in both pre-rush slots at every store. ` +
        `${ctx.g(`Review after ${word(play.review_after_trading_days)} trading days`, 'skill:ops-playbook')}: window time under ${play.working_below_window_secs} sec means it is working; still above ${play.escalate_above_window_secs} means a parallel prep station.`);
      ctx.facts = { netAfter, left, leftBoth, still };
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
