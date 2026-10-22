/* =====================================================================
   src/analyses/sam.js — Sam, Customer Support

   Sam hears the wait-time complaints. His answers give the count first,
   the cause in one sentence, then what agents should say or do. They
   never promise a fix date operations has not confirmed and never blame
   the store team (the care recovery policy).

     sam/wait-complaints-this-week     How many wait-time complaints did we get this week?
     sam/complaints-by-store           Which stores are generating the most wait-time complaints?
     sam/why-complaints-up             Why are wait-time complaints up this week?
     sam/burger-or-drive-thru          Are customers complaining about the Double Stack or about the drive-thru?
     sam/what-to-tell-customers        What should my team tell customers who complain about the wait?
     sam/escalate-to-ops               Which complaints should I escalate to ops first?
     sam/staff-for-4-weeks             What if drive-thru stays this slow for 4 weeks — how many complaints should I staff for?
     sam/complaints-after-prestaging   What if single-lane stores start pre-staging — when do complaints come back down?

   "Wait-time complaint" is the certified category on CARE_TICKET_FACT,
   tagged at intake. The bare analyst has only free text to search.
   ===================================================================== */
(function (global) {
  'use strict';
  const MCX = global.MCX, fmt = MCX.fmt, E = MCX.evidence, L = E.label;
  const { n, usd, pct, signed, cap, word, list, date, dateRange } = fmt;

  const WAIT = { category: 'wait_time' };
  const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, eight: 8, ten: 10, twelve: 12 };

  function days(t) { return `${dateRange(t.thisWeek.start, t.thisWeek.end)}, ${word(t.thisWeek.days)} days so far`; }
  function weeksIn(question, fallback) {
    const m = /(\d+|one|two|three|four|five|six|eight|ten|twelve)\s+weeks?/i.exec(question);
    return m ? (/^\d+$/.test(m[1]) ? Number(m[1]) : WORDS[m[1].toLowerCase()]) : fallback;
  }
  /** Wait-time complaints week by week, with the number of days in each. */
  function ticketWeeks(ctx, key, say) {
    return ctx.q(key || 'ticket_weeks', { model: 'CARE_TICKET_FACT', by: ['week_start'], metrics: ['days', 'tickets'], where: { eq: WAIT, since: ctx.time.trendStart }, order: 'week_start' },
      say || 'Certified wait-time complaints by week, with the days in each week.');
  }
  /** { before (per week), beforeDay, last, lastDay, now, nowDay, perWeekNow } from the weekly rows. */
  function readTickets(ctx, rows) {
    const t = ctx.time, before = rows.filter((row) => fmt.addDays(row.week_start, 6) < t.launch.date);
    const typical = before.reduce((sum, row) => sum + row.tickets, 0) / (before.length || 1);
    const now = rows[rows.length - 1], last = rows.filter((row) => row.week_start === t.lastWeek.start)[0] || rows[rows.length - 2];
    return { weeks: before.length, typical, typicalDay: typical / 7, last, lastDay: last.tickets / last.days, now, nowDay: now.tickets / now.days, runRate: now.tickets / now.days * 7 };
  }
  /**
   * The complaint-forecast rule applied store by store to this week's seconds over benchmark and order volumes.
   * Returns rows with expected_per_week, and a function that re-runs the rule with seconds taken off some stores.
   */
  function forecast(ctx, key, say) {
    const p = ctx.params('complaint-forecast');
    const over = MCX.sem.metricSql('ORDER_TIMING_MART', 'secs_vs_benchmark'), orders = MCX.sem.metricSql('ORDER_TIMING_MART', 'dt_orders_per_day');
    const rate = `(${p.base_per_10k_orders} + CASE WHEN ${over} > ${p.ignore_within_secs} THEN ${p.per_sec_over} * ${over} ELSE 0 END)`;
    const rows = ctx.q(key || 'forecast', { model: 'ORDER_TIMING_MART', by: ['store_name', 'region', 'lane_type', 'has_parallel_staging'], metrics: ['secs_vs_benchmark', 'dt_orders_per_day'],
      columns: [{ sql: `ROUND(${orders} * 7 / 10000.0 * ${rate}, 2)`, as: 'expected_per_week' }], where: { week: 'this' }, order: 'expected_per_week DESC' }, say);
    const expect = (row, back) => {
      const secs = row.secs_vs_benchmark - (back || 0);
      return row.daily_dt_orders * 7 / 10000 * (p.base_per_10k_orders + (secs > p.ignore_within_secs ? p.per_sec_over * secs : 0));
    };
    return {
      rows, params: p, total: rows.reduce((sum, row) => sum + row.expected_per_week, 0),
      base: rows.reduce((sum, row) => sum + row.daily_dt_orders * 7 / 10000 * p.base_per_10k_orders, 0),
      after: (back, applies) => rows.reduce((sum, row) => sum + expect(row, applies(row) ? back : 0), 0)
    };
  }

  // ===================================================================
  // How many wait-time complaints did we get this week?
  // ===================================================================
  MCX.analysis('sam/wait-complaints-this-week', {
    title: 'Wait-time complaints this week', intent: 'descriptive', scope: 'network',
    terms: ['wait-time-complaint', 'reporting-week'],
    skills: [],
    models: ['CARE_TICKET_FACT'],
    bare: { topic: 'complaints', cannot: 'I can give you a count of labels containing "wait" for the last 7 days.' },
    run(ctx) {
      const t = ctx.time, a = ctx.answer, term = ctx.term('wait-time-complaint');
      ctx.say('Reading the certified GOLD tables.');
      const rows = ticketWeeks(ctx);
      if (t.thisWeek.partial) ctx.policy('partial-week', `This week has ${word(t.thisWeek.days)} days of data (${dateRange(t.thisWeek.start, t.thisWeek.end)}). A ${word(t.thisWeek.days)}-day count cannot sit next to a seven-day one, so comparing per day.`);
      const where = ctx.q('this_week', { model: 'CARE_TICKET_FACT', by: ['wait_location'], metrics: ['tickets', 'naming_double_stack'], where: { eq: WAIT, week: 'this' }, order: 'tickets DESC' }, 'This week by where the wait happened, and how many name the Double Stack.');
      ctx.voice();
      const r = readTickets(ctx, rows), loc = E.index(where, 'wait_location');
      const naming = where.reduce((sum, row) => sum + row.naming_double_stack, 0);

      a.p(`${ctx.g(`${n(r.now.tickets)} wait-time complaints so far this week, in ${word(r.now.days)} days`, 'ticket_weeks', 'glossary:wait-time-complaint')} (${dateRange(t.thisWeek.start, t.thisWeek.end)}). That is ${n(r.nowDay)} a day.`);
      a.listed(`${ctx.g('Compared per day, because this week is partial', 'policy:partial-week', 'glossary:reporting-week')}:`, [
        `This week: ${n(r.nowDay)} a day.`,
        `Last week (${dateRange(t.lastWeek.start, t.lastWeek.end)}): ${n(r.last.tickets)} complaints, ${n(r.lastDay)} a day.`,
        `A typical week before the ${E.item(t.launch.item)} launch: about ${n(r.typical)}, ${n(r.typicalDay)} a day.`
      ]);
      a.p(`So ${ctx.g(`the daily rate is ${n(r.nowDay / r.typicalDay, 1)} times the pre-launch level`, 'ticket_weeks')} and higher than last week's.`);
      a.p(`Of this week's ${n(r.now.tickets)}: ${ctx.g(`${n((loc.drive_thru || {}).tickets || 0)} are drive-thru waits and ${n((loc.in_store || {}).tickets || 0)} in-store`, 'this_week')}; ${n(naming)} name the Double Stack.`);
      a.p(`These are tickets an agent tagged as a wait-time complaint at intake (${term.maps_to.replace('GOLD.', '')}), not a text search. For the team: if the rate holds, plan on about ${n(fmt.round(r.runRate, -1))} this week.`);
      ctx.facts = r;
    }
  });

  // ===================================================================
  // Which stores are generating the most wait-time complaints?
  // ===================================================================
  MCX.analysis('sam/complaints-by-store', {
    title: 'Complaints by store', intent: 'descriptive', scope: 'network',
    terms: ['wait-time-complaint', 'lane-type', 'parallel-staging'],
    skills: ['ontology'],
    models: ['CARE_TICKET_FACT', 'FRANCHISE_STORE_DIM'],
    bare: { topic: 'complaints', cannot: 'I can count labels by STORE_REF, but the same store appears under more than one spelling, so the ranking is unreliable.' },
    run(ctx) {
      const t = ctx.time, s = ctx.scope, a = ctx.answer;
      ctx.say('Reading the certified GOLD tables.');
      const stores = ctx.q('stores', { model: 'CARE_TICKET_FACT', by: ['store_name', 'operator_name', 'lane_type', 'has_parallel_staging'], metrics: ['tickets'], where: { eq: WAIT, since: t.launch.date }, order: 'tickets DESC, f.store_name', limit: 8 },
        `Wait-time complaints by store since the ${date(t.launch.date)} launch, with each store's operator and kitchen format.`);
      const formats = ctx.q('formats', { model: 'CARE_TICKET_FACT', by: ['lane_type', 'has_parallel_staging'], metrics: ['tickets'], where: { eq: WAIT, since: t.launch.date }, order: 'tickets DESC' },
        'Roll the stores up by kitchen format: are the complaints spread evenly?');
      ctx.voice();
      const f = E.byFormat(formats), total = formats.reduce((sum, row) => sum + row.tickets, 0);
      const top = stores[0], rest = stores.slice(1, 6);
      const allExposed = stores.every((row) => E.formatOf(row) === 'exposed');
      const per = (key) => (f[key] ? f[key].tickets / s[key] : 0);
      const ops = {}; stores.forEach((row) => { ops[row.operator_name] = (ops[row.operator_name] || 0) + 1; });
      const opList = Object.keys(ops).sort((p, q) => ops[q] - ops[p]);

      a.p(`${ctx.g(`${top.store_name} has the most: ${n(top.tickets)} wait-time complaints since the launch on ${date(t.launch.date)}`, 'stores', 'glossary:wait-time-complaint')}. Next are ${list(rest.map((row) => `${row.store_name} (${row.tickets})`))}.`);
      a.p(`${ctx.g(allExposed ? `Every store in the top ${word(stores.length)} is single-lane without parallel staging` : `${stores.filter((row) => E.formatOf(row) === 'exposed').length} of the top ${word(stores.length)} are single-lane without parallel staging`, 'stores', 'glossary:parallel-staging')}. ` +
        `They belong to ${list(opList.map((name) => `${name} (${ops[name]})`))}.`);
      a.listed(`Since launch there have been ${n(total)} wait-time complaints. By kitchen format:`, [
        f.exposed ? `${ctx.g(`${cap(L.exposed)}: ${n(f.exposed.tickets)} complaints, ${pct(f.exposed.tickets / total * 100)} of the total, from ${pct(s.exposed / s.stores * 100)} of the stores`, 'formats', 'skill:ontology')} — ${n(per('exposed'), 1)} per store.` : null,
        f.dual ? `${cap(L.dual)}: ${n(f.dual.tickets)}, or ${n(per('dual'), 1)} per store.` : null,
        f.retrofitted ? `${cap(L.retrofitted)}: ${n(f.retrofitted.tickets)}, or ${n(per('retrofitted'), 1)} per store.` : null
      ]);
      a.p(`${ctx.g(`A single-lane store without parallel staging draws about ${n(per('exposed') / (per('dual') || 1))} times the complaints of a dual-lane store`, 'formats', 'glossary:lane-type')}. ` +
        `For the team: brief agents on those ${s.exposed} stores first, and use the escalation rule for the ones at the top of this list.`);
      ctx.facts = { top: stores.map((r) => [r.store_name, r.tickets]), total };
    }
  });

  // ===================================================================
  // Why are wait-time complaints up this week?
  // ===================================================================
  MCX.analysis('sam/why-complaints-up', {
    title: 'Why complaints are up', intent: 'diagnostic', scope: 'network',
    terms: ['wait-time-complaint', 'drive-thru-time', 'benchmark', 'parallel-staging'],
    skills: ['diagnostic-playbook', 'complaint-forecast'],
    models: ['CARE_TICKET_FACT', 'ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM', 'MENU_CHANGE_LOG'],
    bare: 'complaints',
    run(ctx) {
      const t = ctx.time, s = ctx.scope, a = ctx.answer, item = E.item(t.launch.item);
      ctx.say('Walking the playbook against the certified GOLD tables.');
      const rows = ticketWeeks(ctx, 'ticket_weeks', 'Confirm — certified wait-time complaints by week.');
      if (t.thisWeek.partial) ctx.policy('partial-week', `This week has ${word(t.thisWeek.days)} days of data, so complaints are compared per day.`);
      const timing = E.readWeeks(ctx, E.weeks(ctx, { key: 'timing_weeks', say: 'The complaint forecast says complaints follow drive-thru time. Drive-thru time over the same weeks.' }));
      const formats = ctx.q('ticket_formats', { model: 'CARE_TICKET_FACT', by: ['lane_type', 'has_parallel_staging'], metrics: ['tickets'], where: { eq: WAIT, since: t.launch.date }, order: 'tickets DESC' }, 'Spread — which stores are the complaints coming from? By kitchen format, since launch.');
      const over = E.formats(ctx, { key: 'timing_formats', say: 'And where those formats stand against benchmark this week.' });
      const where = ctx.q('location', { model: 'CARE_TICKET_FACT', by: ['wait_location'], metrics: ['tickets', 'naming_double_stack'], where: { eq: WAIT, since: t.launch.date }, order: 'tickets DESC' }, 'Where the wait happened, and how many name the Double Stack.');
      const menu = E.menu(ctx, { say: 'Correlate — the menu change log at the break.' });
      ctx.voice();

      const r = readTickets(ctx, rows), f = E.byFormat(formats), total = formats.reduce((sum, row) => sum + row.tickets, 0);
      const loc = E.index(where, 'wait_location'), naming = where.reduce((sum, row) => sum + row.naming_double_stack, 0);
      const forecast = ctx.params('complaint-forecast');

      a.p(`${ctx.g(`Because the drive-thru got slower at ${s.exposed} stores when the ${item} launched, and complaints follow drive-thru time`, 'ticket_formats', 'timing_formats', 'correlate', 'skill:diagnostic-playbook')}.`);
      a.p(`Counts: about ${n(r.typical)} wait-time complaints a week before the launch; ${n(r.last.tickets)} in the launch week; ${ctx.g(`${n(r.now.tickets)} in the first ${word(r.now.days)} days of this week, ${n(r.nowDay)} a day against ${n(r.typicalDay)}`, 'ticket_weeks', 'glossary:wait-time-complaint')}.`);
      a.listed('Cause, in the order the playbook checks it:', [
        `${ctx.g(`Drive-thru time moved in the same weeks: ${n(timing.baseline)} sec before, ${n(timing.launchWeek.avg_dt_secs)} in the launch week, ${n(timing.now.avg_dt_secs)} now`, 'timing_weeks', 'skill:complaint-forecast', 'glossary:drive-thru-time')}. The forecast rule adds ${n(forecast.per_sec_over, 2)} complaints per 10,000 orders for every second a store is over benchmark.`,
        `${ctx.g(`${pct(f.exposed.tickets / total * 100)} of the complaints since launch come from the ${s.exposed} ${L.exposed}`, 'ticket_formats', 'glossary:parallel-staging')}, which are ${n(over.exposed.secs_vs_benchmark)} sec over benchmark. The ${L.dual} are ${n(Math.abs(over.dual.secs_vs_benchmark))} sec inside it.`,
        `${pct((loc.drive_thru || {}).tickets / total * 100)} are about the drive-thru rather than waiting in store.`,
        menu.launch ? `The menu change log has the ${menu.launch.item_name} launching on ${date(menu.launch.event_date)} with two-step prep` + (menu.alert ? `, and an ops alert on ${date(menu.alert.event_date)} about window time at single-lane stores.` : '.') : null
      ]);
      a.p(`${ctx.g(`It is the wait, not the product: ${n(naming)} of ${n(total)} complaints name the ${item}`, 'location')}.`);
      a.p(`For agents: apologise, give the reason (a new item is slowing some single-lane drive-thrus), and do not promise a date. Operations has confirmed pre-staging, not a finish.`);
      ctx.facts = { r, share: f.exposed.tickets / total };
    }
  });

  // ===================================================================
  // Are customers complaining about the Double Stack or about the drive-thru?
  // ===================================================================
  MCX.analysis('sam/burger-or-drive-thru', {
    title: 'The burger or the drive-thru', intent: 'diagnostic', scope: 'network',
    terms: ['wait-time-complaint', 'double-stack'],
    skills: ['cause-attribution'],
    models: ['CARE_TICKET_FACT', 'ITEM_RATING_DAILY'],
    bare: { topic: 'complaints', cannot: 'I can count tickets whose text mentions the Double Stack, but a mention does not say whether the customer disliked the burger or the wait for it.' },
    run(ctx) {
      const t = ctx.time, a = ctx.answer, item = E.item(t.launch.item);
      ctx.say('Running the attribution checklist against the certified GOLD tables.');
      const wait = ctx.q('wait', { model: 'CARE_TICKET_FACT', by: ['wait_location'], metrics: ['tickets', 'naming_double_stack'], where: { eq: WAIT, since: t.launch.date }, order: 'tickets DESC' },
        `Candidate one, the wait — wait-time complaints since ${date(t.launch.date)}, by where the wait happened, and how many name the ${item}.`);
      const product = ctx.q('product', { model: 'CARE_TICKET_FACT', by: ['about_item'], metrics: ['tickets'], where: { eq: { category: 'food_quality' }, since: t.launch.date }, order: 'tickets DESC' },
        'Candidate two, the product — food-quality complaints since launch, by the item they are about.');
      const rating = ctx.q('rating', { model: 'ITEM_RATING_DAILY', by: ['item_name'], metrics: ['ratings', 'avg_rating'], where: { since: t.launch.date }, order: 'avg_rating DESC' }, 'What customers say about the item when they rate it.');
      ctx.voice();
      const loc = E.index(wait, 'wait_location'), total = wait.reduce((sum, row) => sum + row.tickets, 0), naming = wait.reduce((sum, row) => sum + row.naming_double_stack, 0);
      const about = product.filter((row) => row.about_item === t.launch.item)[0] || { tickets: 0 }, quality = product.reduce((sum, row) => sum + row.tickets, 0);
      const stars = rating.filter((row) => row.item_name === t.launch.item)[0], other = rating.filter((row) => row.item_name !== t.launch.item)[0];

      a.p(`${ctx.g('The drive-thru. Customers like the burger and dislike the wait for it', 'wait', 'product', 'skill:cause-attribution')}.`);
      a.listed(`Since the launch on ${date(t.launch.date)}:`, [
        `${ctx.g(`${n(total)} wait-time complaints, ${n((loc.drive_thru || {}).tickets || 0)} of them at the drive-thru`, 'wait', 'glossary:wait-time-complaint')}. ${n(naming)} (${pct(naming / total * 100)}) name the ${item}, and those are about how long it took.`,
        `${ctx.g(`${n(about.tickets)} product complaints about the ${item} itself`, 'product', 'glossary:double-stack')}, out of ${n(quality)} food-quality tickets.`,
        stars ? `${ctx.g(`${n(stars.ratings)} in-app ratings averaging ${n(stars.avg_rating, 1)} stars`, 'rating')}` + (other ? `; the ${other.item_name} is at ${n(other.avg_rating, 1)}.` : '.') : null
      ]);
      a.p(`${ctx.g(`For every complaint about the burger there are about ${n(total / (about.tickets || 1))} about the wait`, 'wait', 'product')}. The attribution check that settles it is who is exposed to which cause: every customer who orders the ${item} gets the product, but only those at slow drive-thrus get the wait, and that is where the complaints are.`);
      a.p(`For agents: do not apologise for the ${item}. Apologise for the wait, say a new item is slowing some single-lane drive-thrus, and log the store. If a customer does complain about the product, tag it food quality with the item, so the two stay separate.`);
      ctx.facts = { total, naming, about: about.tickets, stars };
    }
  });

  // ===================================================================
  // What should my team tell customers who complain about the wait?
  // ===================================================================
  MCX.analysis('sam/what-to-tell-customers', {
    title: 'What agents say', intent: 'prescriptive', scope: 'network',
    terms: ['wait-time-complaint', 'benchmark'],
    skills: ['care-recovery'],
    models: ['ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM', 'MENU_CHANGE_LOG', 'CARE_TICKET_FACT'],
    bare(b, kit) {
      kit.topics.complaints(b, { kind: 'network', where: 's.IS_ACTIVE = TRUE' }, { cannot: 'I can tell you roughly how many people are complaining.' });
      b.notes.asks.unshift('What is your recovery policy? Nothing in the raw warehouse says what an agent may offer or promise, so ' + b.b('any script I wrote would be generic customer-service language') + '.');
      kit.relimit(b, b.b("I can't give agents the real reason for the wait") + ', which stores it applies to, or what is being done about it. Those need the cause and a policy, and the raw tables hold neither.');
    },
    run(ctx) {
      const t = ctx.time, a = ctx.answer, care = ctx.params('care-recovery');
      ctx.say('Applying the care recovery policy, step by step.');
      const flagged = E.formats(ctx, { key: 'flagged', metrics: ['stores', 'secs_vs_benchmark', 'stores_over'], say: 'Step 3 depends on which stores are over benchmark. This week, by kitchen format.' });
      const menu = E.menu(ctx, { say: 'Steps 2 and 4 need the real reason and what operations has confirmed. The menu change log.' });
      const rows = ticketWeeks(ctx, 'ticket_weeks', 'How many customers this covers: wait-time complaints by week.');
      const share = ctx.q('at_flagged', { model: 'CARE_TICKET_FACT', by: ['lane_type', 'has_parallel_staging'], metrics: ['tickets'], where: { eq: WAIT, week: 'this' }, order: 'tickets DESC' }, 'And how many of this week\'s complaints come from each kind of store.');
      ctx.voice();
      const r = readTickets(ctx, rows), x = flagged.exposed, over = flagged.rows.filter((row) => row.secs_vs_benchmark > 0);
      const stores = over.reduce((sum, row) => sum + row.stores, 0);
      const tickets = share.reduce((sum, row) => sum + row.tickets, 0);
      const atFlagged = share.filter((row) => over.some((o) => E.formatOf(o) === E.formatOf(row))).reduce((sum, row) => sum + row.tickets, 0);
      const vouchers = r.runRate * (atFlagged / (tickets || 1)) * care.voucher_usd;
      const twoStep = menu.launch && menu.launch.requires_two_step_prep, confirmed = menu.alert && /pre-stage/i.test(menu.alert.notes || '');

      a.p(`${ctx.g(`Apologise, give the real reason, offer the ${usd(care.voucher_usd)} voucher where the store is over benchmark, and do not promise a date`, 'skill:care-recovery', 'correlate')}.`);
      a.listed('The care recovery policy, step by step, with words an agent can use:', [
        `Apologise without qualification. "I'm sorry you had to wait. That is not the service we want to give you."`,
        `${ctx.g('Give the real reason', 'correlate', 'skill:care-recovery')}. "We have just launched a new item${twoStep ? ' that takes two steps to prepare' : ''}, and it is slowing the line at some of our single-lane drive-thrus."`,
        `Offer the ${usd(care.voucher_usd)} recovery voucher when the store is flagged as over benchmark. ${ctx.g(`This week that is ${stores} stores`, 'flagged', 'glossary:benchmark')}: ${list(over.map((row) => `the ${row.stores} ${L[E.formatOf(row)]}`))}.` +
          (flagged.dual && flagged.dual.secs_vs_benchmark <= 0 ? ` The ${flagged.dual.stores} dual-lane stores are inside benchmark, so no voucher is offered by default there.` : ''),
        `Say what is being done, and only what is confirmed. ` + (confirmed ? `"Those kitchens are now preparing the new item's components ahead of the rush." ${ctx.g(`That is the ops alert of ${date(menu.alert.event_date)}; no finish date has been confirmed, so none is given`, 'correlate')}.` : 'Operations has not confirmed an action yet, so say the team is working on it and give no date.')
      ], true);
      a.p(`Never blame the store team: the cause is the kitchen layout, not the crew.`);
      a.p(`Scale: ${ctx.g(`${n(r.now.tickets)} wait-time complaints in ${word(r.now.days)} days this week, about ${n(fmt.round(r.runRate, -1))} a week at this rate`, 'ticket_weeks', 'glossary:wait-time-complaint')}. ` +
        `${pct(atFlagged / (tickets || 1) * 100)} come from flagged stores, so ${ctx.g(`vouchers run to about ${usd(fmt.round(vouchers, -1))} a week`, 'at_flagged', 'skill:care-recovery')}.` + (x ? ` The single-lane stores without parallel staging are ${n(x.secs_vs_benchmark)} sec over benchmark, which is why the calls come from there.` : ''));
      ctx.facts = { stores, runRate: r.runRate, vouchers };
    }
  });

  // ===================================================================
  // Which complaints should I escalate to ops first?
  // ===================================================================
  MCX.analysis('sam/escalate-to-ops', {
    title: 'Escalation list', intent: 'prescriptive', scope: 'network',
    terms: ['wait-time-complaint', 'benchmark', 'operators'],
    skills: ['care-recovery'],
    models: ['CARE_TICKET_FACT', 'ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM'],
    bare: { topic: 'complaints', cannot: 'I can list the store names that appear most often on tickets.' },
    run(ctx) {
      const t = ctx.time, s = ctx.scope, a = ctx.answer, rule = ctx.params('care-recovery').escalate;
      ctx.say('Applying the escalation rule from the care recovery policy.');
      const byTickets = ctx.q('ticket_test', { model: 'CARE_TICKET_FACT', by: ['store_name', 'operator_name'], metrics: ['tickets'], where: { eq: WAIT, week: 'last' }, having: `COUNT(*) >= ${rule.store_tickets_per_week}`, order: 'tickets DESC, f.store_name' },
        `First test — stores with ${word(rule.store_tickets_per_week)} or more wait-time complaints in a week. Using last week, the last full one.`);
      const bySecs = E.stores(ctx, { key: 'seconds_test', by: ['operator_name', 'region'], metrics: ['secs_vs_benchmark'], having: `AVG(t.secs_vs_benchmark) > ${rule.or_secs_over}`,
        say: `Second test — stores more than ${rule.or_secs_over} sec over benchmark this week.` });
      const quiet = E.formats(ctx, { key: 'not_escalated', where: { week: 'this', lane: 'dual_lane' }, metrics: ['stores', 'secs_vs_benchmark'], say: 'And the stores that should not be escalated: dual-lane, this week.' }).dual;
      ctx.voice();

      const names = {}; byTickets.forEach((row) => { names[row.store_name] = true; }); bySecs.forEach((row) => { names[row.store_name] = true; });
      const total = Object.keys(names).length, both = byTickets.filter((row) => bySecs.some((x) => x.store_name === row.store_name));
      const ops = {}; bySecs.forEach((row) => { (ops[row.operator_name] = ops[row.operator_name] || []).push(row); });
      const opList = Object.keys(ops).sort((p, q) => ops[q].length - ops[p].length || ops[q][0].secs_vs_benchmark - ops[p][0].secs_vs_benchmark);
      const allExposed = bySecs.every((row) => E.formatOf(row) === 'exposed');
      const regions = []; bySecs.forEach((row) => { if (regions.indexOf(row.region) === -1) regions.push(row.region); });

      a.p(`${ctx.g(`Escalate ${total} stores${allExposed ? ', all single-lane without parallel staging' : ''}, starting with the ${regions[0]}`, 'seconds_test', 'ticket_test', 'skill:care-recovery')}.`);
      a.listed(`The rule: ${word(rule.store_tickets_per_week)} or more wait-time complaints in a week, or more than ${rule.or_secs_over} sec over benchmark.`, [
        `${ctx.g(`On seconds: ${bySecs.length} stores are more than ${rule.or_secs_over} sec over this week`, 'seconds_test', 'glossary:benchmark')} (${days(t)}). The worst are ${list(bySecs.slice(0, 3).map((row) => `${row.store_name} (${signed(row.secs_vs_benchmark)})`))}.`,
        byTickets.length ? `${ctx.g(`On complaints: ${word(byTickets.length)} store${byTickets.length === 1 ? '' : 's'} drew ${word(rule.store_tickets_per_week)} or more last week`, 'ticket_test', 'glossary:wait-time-complaint')}${byTickets.length > 4 ? ', among them' : ' —'} ${list(byTickets.slice(0, 4).map((row) => `${row.store_name} (${row.tickets})`))}.` +
          (both.length === byTickets.length ? ' All are already on the seconds list.' : '') : `On complaints: no store reached ${word(rule.store_tickets_per_week)} in the last full week, so the seconds test is doing the work.`
      ]);
      a.listed(`${ctx.g('By operator, so ops knows whom to call', 'seconds_test', 'glossary:operators')}:`, opList.map((name) => `${name}: ${ops[name].length} store${ops[name].length === 1 ? '' : 's'}, worst ${ops[name][0].store_name} (${signed(ops[name][0].secs_vs_benchmark)} sec)`));
      a.p((quiet ? `${ctx.g(`Not worth escalating: the ${quiet.stores} dual-lane stores`, 'not_escalated')}. They are ${n(Math.abs(quiet.secs_vs_benchmark))} sec ${quiet.secs_vs_benchmark <= 0 ? 'inside' : 'over'} benchmark and their complaints are at the normal trickle. ` : '') +
        `When escalating, send the store, the count and the seconds over. Do not blame the store team, and do not pass on a fix date ops has not confirmed.`);
      ctx.facts = { total, ops: opList.map((name) => [name, ops[name].length]) };
    }
  });

  // ===================================================================
  // What if drive-thru stays this slow for 4 weeks — how many complaints should I staff for?
  // ===================================================================
  MCX.analysis('sam/staff-for-4-weeks', {
    title: 'What-if: staffing the queue', intent: 'predictive', scope: 'network',
    terms: ['wait-time-complaint', 'drive-thru-time', 'benchmark'],
    skills: ['complaint-forecast', 'care-recovery'],
    models: ['ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM', 'CARE_TICKET_FACT'],
    bare(b, kit) {
      kit.topics.complaints(b, { kind: 'network', where: 's.IS_ACTIVE = TRUE' }, {});
      b.notes.asks.push('How do complaints follow drive-thru time? ' + b.b('The raw warehouse has no forecast rule') + ', so the only projection I can make is to assume last week repeats.');
      kit.relimit(b, b.b("I can't forecast the queue responsibly") + ': my count depends on a text match, and nothing ties complaints to how slow the stores are. Repeating my last 7 days four times is arithmetic, not a forecast.');
    },
    run(ctx) {
      const t = ctx.time, a = ctx.answer, weeks = weeksIn(ctx.question, 4), care = ctx.params('care-recovery');
      ctx.say('Walking the complaint forecast against the certified GOLD tables.');
      const f = forecast(ctx, 'forecast', 'Apply the forecast rule store by store: this week\'s seconds over benchmark and drive-thru orders.');
      const rows = ticketWeeks(ctx, 'observed', 'Check the rule against what the queue actually received.');
      if (t.thisWeek.partial) ctx.policy('partial-week', `This week has ${word(t.thisWeek.days)} days of data, so the observed figure is a daily rate scaled to a week.`);
      const handle = ctx.one('handle', { model: 'CARE_TICKET_FACT', metrics: ['tickets', 'handle_minutes'], where: { eq: WAIT, since: t.launch.date } }, 'Handle time per wait-time ticket since launch, to turn tickets into hours.');
      ctx.voice();
      const r = readTickets(ctx, rows), p = f.params, minutes = handle.handle_minutes || care.handle_minutes;
      const hours = (tickets) => tickets * minutes / 60;
      const exposed = f.rows.filter((row) => E.formatOf(row) === 'exposed'), fromExposed = exposed.reduce((sum, row) => sum + row.expected_per_week, 0);
      const plan = Math.max(f.total, r.runRate);          // staff for the higher of the rule and the queue

      a.p(`${ctx.g(`About ${n(fmt.round(plan * weeks, -1))} wait-time complaints over ${word(weeks)} weeks, roughly ${n(fmt.round(plan, -1))} a week`, 'forecast', 'observed', 'skill:complaint-forecast', 'glossary:wait-time-complaint')}, against about ${n(r.typical)} a week before the launch.`);
      a.p(`How that is built: the forecast rule gives a store on benchmark ${n(p.base_per_10k_orders)} complaints per 10,000 drive-thru orders, plus ${n(p.per_sec_over, 2)} for every second over once it is more than ${n(p.ignore_within_secs)} sec over. Applied store by store to this week's figures it gives ${n(f.total)} a week. ` +
        `${ctx.g(`Check: the queue is receiving ${n(r.nowDay)} a day this week, which is ${n(r.runRate)} a week`, 'observed')}. The rule and the queue agree to within ${n(Math.abs(f.total - r.runRate) / r.runRate * 100)}%; staff for the higher of the two.`);
      a.listed('Staffing:', [
        `${ctx.g(`At ${n(minutes)} minutes a ticket, that is about ${n(hours(plan))} agent-hours a week`, 'handle', 'skill:care-recovery')}, against ${n(hours(r.typical))} before the launch: ${n(hours(plan) - hours(r.typical))} more hours a week.`,
        `Over the ${word(weeks)} weeks: about ${n(fmt.round(hours(plan) * weeks, -1))} hours, ${n(fmt.round((hours(plan) - hours(r.typical)) * weeks, -1))} of them extra.`,
        `${ctx.g(`${pct(fromExposed / f.total * 100)} of the expected complaints come from the ${exposed.length} single-lane stores without parallel staging`, 'forecast', 'glossary:benchmark')}, so agents who know those stores will take most of the calls.`
      ]);
      a.p(`Assumptions: drive-thru time stays where it is this week and traffic is flat. No fix date is confirmed by operations, so staff for the full ${word(weeks)} weeks and review each Monday; complaints follow drive-thru time within the same week, so the queue will show a fix almost as soon as the kitchens do.`);
      ctx.facts = { model: f.total, observed: r.runRate, plan, weeks };
    }
  });

  // ===================================================================
  // What if single-lane stores start pre-staging — when do complaints come back down?
  // ===================================================================
  MCX.analysis('sam/complaints-after-prestaging', {
    title: 'What-if: complaints after pre-staging', intent: 'predictive', scope: 'network',
    terms: ['pre-staging', 'wait-time-complaint', 'benchmark', 'lane-type'],
    skills: ['complaint-forecast', 'what-if-analysis'],
    models: ['ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM', 'CARE_TICKET_FACT'],
    bare(b, kit) {
      kit.topics.complaints(b, { kind: 'network', where: 's.IS_ACTIVE = TRUE' }, {});
      b.notes.asks.push('What does pre-staging do to the wait, and how quickly do complaints follow? ' + b.b('The raw warehouse has neither an ops model nor a complaint model') + '.');
      kit.relimit(b, b.b("I can't say when complaints come back down") + '. I can show that my "wait" count rose; I have nothing that links a change in the kitchen to a change in the queue.');
    },
    run(ctx) {
      const t = ctx.time, a = ctx.answer, model = ctx.params('what-if-analysis'), stage = model.pre_stage_secs, crew = model.crew_forward_secs;
      ctx.say('Walking the what-if model and the complaint forecast against the certified GOLD tables.');
      const f = forecast(ctx, 'forecast', 'Expected complaints per week today, store by store, from seconds over benchmark and orders.');
      const rows = ticketWeeks(ctx, 'observed', 'The observed level before the launch and now, for reference.');
      ctx.voice();
      const r = readTickets(ctx, rows), isExposed = (row) => E.formatOf(row) === 'exposed';
      const after = [f.after(stage[1], isExposed), f.after(stage[0], isExposed)], both = f.after((stage[0] + stage[1] + crew[0] + crew[1]) / 2, isExposed);
      const exposed = f.rows.filter(isExposed), p = f.params;
      const regions = {}; exposed.forEach((row) => { const g = (regions[row.region] = regions[row.region] || { region: row.region, stores: 0, over: 0 }); g.stores++; g.over += row.secs_vs_benchmark; });
      const stay = Object.keys(regions).map((key) => regions[key]).map((g) => Object.assign(g, { left: g.over / g.stores - (stage[0] + stage[1]) / 2 })).filter((g) => g.left > p.ignore_within_secs).sort((x, y) => y.left - x.left);

      a.p(`${ctx.g(`Within the first full week of pre-staging, to about ${n(fmt.round(after[0], -1))}–${n(fmt.round(after[1], -1))} a week`, 'forecast', 'skill:complaint-forecast', 'skill:what-if-analysis')}: roughly ${pct((1 - (after[0] + after[1]) / 2 / f.total) * 100)} below today's rate, still above the ${n(r.typical)} a week before the launch.`);
      a.listed('How that is built:', [
        `${ctx.g(`Today the forecast rule gives ${n(f.total)} wait-time complaints a week`, 'forecast', 'glossary:wait-time-complaint')} (the queue is running at ${n(r.runRate)}).`,
        `${ctx.g(`Pre-staging takes ${stage.join('–')} sec off window time at the ${exposed.length} single-lane stores without parallel staging`, 'skill:what-if-analysis', 'glossary:pre-staging')}. Re-running the rule on the lower seconds gives ${n(after[0])}–${n(after[1])} a week.`,
        `With the second playbook step as well (one crew member forward, another ${crew.join('–')} sec): about ${n(both)} a week, close to the pre-launch level.`
      ]);
      a.p(`When: ${ctx.g('complaints follow drive-thru time within the same week', 'skill:complaint-forecast', 'observed')}, so the drop shows in the first full week after the stores start, not a month later.`);
      if (stay.length) a.p(`${ctx.g(`Where it stays elevated: the ${list(stay.map((g) => g.region))}`, 'forecast', 'glossary:benchmark')}, whose single-lane stores would still be about ${list(stay.map((g) => `${n(g.left)} sec`))} over benchmark after pre-staging alone.`);
      a.p(`Assumptions: traffic flat, the Double Stack's share of orders unchanged, every exposed store pre-stages in both pre-rush slots. For agents nothing changes yet: no start date has been confirmed, so none is given to customers.`);
      ctx.facts = { now: f.total, after, both, typical: r.typical };
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
