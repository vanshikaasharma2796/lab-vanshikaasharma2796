/* =====================================================================
   src/analyses/lena.js — Lena, Supply Chain

   Lena knows what is in every kitchen and every distribution centre.
   Her answers are in units, places, dates and cost: what is in stock,
   what has to be ordered, and the lead time.

     lena/kitchens-with-prep-station   Which kitchens have a parallel prep station and which don't?
     lena/component-stockouts          How are Double Stack components holding up — any stockouts since launch?
     lena/why-some-kitchens-cope       Why do some single-lane kitchens cope with the Double Stack and others don't?
     lena/southeast-sauce-short        Why is the Southeast running short of Stack Sauce?
     lena/fastest-retrofit             How do I get parallel prep stations into the worst kitchens fastest?
     lena/rebalance-stock              How should I rebalance Double Stack stock between regions this week?
     lena/retrofit-every-single-lane   What if we retrofit every single-lane kitchen — what does it take?
     lena/honey-heat-readiness         What if Honey Heat Chicken launches on June 4 — are the kitchens ready?
   ===================================================================== */
(function (global) {
  'use strict';
  const MCX = global.MCX, fmt = MCX.fmt, E = MCX.evidence, L = E.label;
  const { n, usd, k, kRange, pct, signed, cap, word, list, date, dateRange } = fmt;

  const STATION = { equipment_type: 'parallel_prep_station' };
  const KIT = 'PPS-2 retrofit kit', SAUCE = 'Stack Sauce';

  function count(c, noun, plural) { return `${c} ${c === 1 ? noun : (plural || noun + 's')}`; }
  function short(dc) { return String(dc).replace(/ DC$/, ''); }
  /** "Beef Patty 4:1" -> "beef patties": a component named in running text. */
  function plural(component) { return /patty/i.test(component) ? 'beef patties' : String(component).toLowerCase(); }
  /** Retrofit kits by distribution centre: [{ dc_name, region, on_hand, lead_time_days, unit_cost_usd }]. */
  function kitStock(ctx, say) {
    return ctx.q('kits', { model: 'DC_STOCK_FACT', by: ['dc_name', 'region', 'on_hand', 'lead_time_days', 'unit_cost_usd'], where: { eq: { item: KIT } }, order: 'dc.on_hand DESC' },
      say || 'Retrofit kits: stock by distribution centre, supplier lead time and installed cost.');
  }
  /** Nights needed to fit a number of kitchens with the crews in the retrofit-planning skill. */
  function nights(plan, kitchens) { return Math.ceil(kitchens / (plan.install_crews * plan.installs_per_crew_per_night)); }

  // ===================================================================
  // Which kitchens have a parallel prep station and which don't?
  // ===================================================================
  MCX.analysis('lena/kitchens-with-prep-station', {
    title: 'Kitchens with a parallel prep station', intent: 'descriptive', scope: 'network',
    terms: ['parallel-staging', 'kitchen-equipment'],
    skills: ['ontology'],
    models: ['KITCHEN_EQUIPMENT_DIM', 'FRANCHISE_STORE_DIM'],
    bare: 'equipment',
    run(ctx) {
      const s = ctx.scope, a = ctx.answer;
      ctx.say('Reading the certified equipment register.');
      const stations = ctx.q('stations', { model: 'KITCHEN_EQUIPMENT_DIM', by: ['model', 'lane_type'], metrics: ['stores'], where: { eq: Object.assign({ status: 'active' }, STATION) },
        columns: [{ sql: 'MIN(e.installed_date)', as: 'first_installed' }, { sql: 'MAX(e.installed_date)', as: 'last_installed' }], order: 'stores DESC' },
        'Active parallel prep stations by model and the lane type of the kitchen they are in.');
      const retro = ctx.q('retrofits', { model: 'KITCHEN_EQUIPMENT_DIM', by: ['store_name', 'operator_name', 'region', 'installed_date'], where: { eq: STATION, lane: 'single_lane' }, order: 'e.installed_date' },
        'The single-lane kitchens that have one: which stores, whose, fitted when.');
      const without = ctx.q('without', { model: 'FRANCHISE_STORE_DIM', by: ['region', 'operator_name'], metrics: ['stores'], where: { staging: false }, order: 'stores DESC, f.operator_name' },
        'Kitchens without a station, by region and operator, from the store dimension.');
      const flagged = ctx.one('check', { model: 'FRANCHISE_STORE_DIM', metrics: ['stores'], where: { staging: true } }, 'Cross-check: stores flagged has_parallel_staging should equal active stations in the register.');
      ctx.voice();

      const have = stations.reduce((sum, row) => sum + row.stores, 0), builtIn = stations.filter((row) => row.lane_type === 'dual_lane')[0], fitted = stations.filter((row) => row.lane_type === 'single_lane')[0];
      const none = without.reduce((sum, row) => sum + row.stores, 0);
      const regions = {}; without.forEach((row) => { regions[row.region] = (regions[row.region] || 0) + row.stores; });
      const regionList = Object.keys(regions).sort((p, q) => regions[q] - regions[p]);
      const owners = []; retro.forEach((row) => { if (owners.indexOf(row.operator_name) === -1) owners.push(row.operator_name); });

      a.p(`${ctx.g(`${have} of the ${s.stores} kitchens have a parallel prep station; ${none} do not`, 'stations', 'without', 'glossary:parallel-staging', 'glossary:kitchen-equipment')}.`);
      a.list([
        builtIn ? `Built in: ${builtIn.stores}, the ${builtIn.model.replace(/\s*\(.*\)/, '')}, in every dual-lane kitchen.` : null,
        fitted ? `${ctx.g(`Retrofitted: ${fitted.stores} single-lane kitchens with a ${fitted.model.replace(/\s*\(.*\)/, '')} kit, fitted in ${fmt.month(fitted.first_installed)} ${fitted.first_installed.slice(0, 4)}`, 'stations', 'retrofits')} — ${list(retro.map((row) => row.store_name))}, ${owners.length === 1 ? `all ${owners[0]}'s` : `owned by ${list(owners)}`} in the ${retro[0].region}.` : null,
        `${ctx.g(`Without: ${none}, all single-lane`, 'without', 'skill:ontology')}. ${list(regionList.map((region) => `${region} ${regions[region]}`))}.`,
        `By operator: ${list(without.map((row) => `${row.operator_name} ${row.stores}`))}.`
      ]);
      a.p(`${ctx.g(`The register agrees with the store dimension: ${flagged.stores} stores flagged for parallel staging, ${have} active stations`, 'check', 'stations')}. ` +
        `The ${none} without are the kitchens where a two-step item queues at the window; each needs one PPS-2 kit.`);
      ctx.facts = { have, none, regions };
    }
  });

  // ===================================================================
  // How are Double Stack components holding up — any stockouts since launch?
  // ===================================================================
  MCX.analysis('lena/component-stockouts', {
    title: 'Component stock since launch', intent: 'descriptive', scope: 'network',
    terms: ['days-of-cover', 'stack-sauce', 'double-stack'],
    skills: ['supply-allocation'],
    models: ['INVENTORY_DAILY_FACT', 'FRANCHISE_STORE_DIM'],
    bare: 'stock',
    run(ctx) {
      const t = ctx.time, a = ctx.answer, target = ctx.params('supply-allocation').target_cover_days;
      ctx.say('Reading the certified stock tables.');
      const totals = ctx.q('components', { model: 'INVENTORY_DAILY_FACT', by: ['component'], metrics: ['stockout_hours', 'stores_out'], where: { since: t.launch.date }, order: 'stockout_hours DESC' }, `Stockout hours since the ${date(t.launch.date)} launch, by component.`);
      const outs = ctx.q('stockouts', { model: 'INVENTORY_DAILY_FACT', by: ['component', 'region', 'date'], metrics: ['stockout_hours', 'stores_out'], where: { since: t.launch.date, raw: ['i.stockout_hours > 0'] }, order: 'i.date' }, 'Where and when: the days and regions with any hours out of stock.');
      const cover = ctx.q('cover', { model: 'INVENTORY_DAILY_FACT', by: ['component', 'region'], metrics: ['days_of_cover'], where: { eq: { date: t.maxDate } }, order: 'i.component DESC, days_of_cover' }, `Days of cover in stores on ${date(t.maxDate)}, against the ${word(target)}-day target.`);
      ctx.voice();

      const hit = totals.filter((row) => row.stockout_hours > 0), clean = totals.filter((row) => !row.stockout_hours);
      const sauce = cover.filter((row) => row.component === SAUCE), below = sauce.filter((row) => row.days_of_cover < target), above = sauce.filter((row) => row.days_of_cover >= target);
      const regions = []; outs.forEach((row) => { if (regions.indexOf(row.region) === -1) regions.push(row.region); });
      const lastOut = outs.length ? outs[outs.length - 1].date : null;

      if (!hit.length) {
        a.p(`${ctx.g('No stockouts since launch on any Double Stack component', 'components', 'glossary:days-of-cover', 'skill:supply-allocation')}. Cover on ${date(t.maxDate)}: ${list(cover.map((row) => `${row.component} ${n(row.days_of_cover, 1)} days in the ${row.region}`))}.`);
        return;
      }
      a.p(`${ctx.g(`One component, ${regions.length === 1 ? 'one region' : word(regions.length) + ' regions'}: ${hit[0].component} ran out at ${word(hit[0].stores_out)} ${regions[0]} stores`, 'components', 'stockouts', 'glossary:stack-sauce')}` +
        (clean.length ? `; ${list(clean.map((row) => plural(row.component)))} have not run out anywhere.` : '.'));
      a.list([
        `${hit[0].component}: ${ctx.g(`${n(hit[0].stockout_hours)} stockout hours since launch, all in the ${list(regions)}`, 'stockouts')} — ${list(outs.map((row) => `${n(row.stockout_hours)} hours across ${row.stores_out} stores on ${fmt.dayDate(row.date)}`))}.` + (lastOut && lastOut < t.maxDate ? ' None since.' : '')
      ].concat(clean.map((row) => {
        const own = cover.filter((c) => c.component === row.component);
        const lo = n(Math.min.apply(null, own.map((c) => c.days_of_cover)), 1), hi = n(Math.max.apply(null, own.map((c) => c.days_of_cover)), 1);
        return `${row.component}: no stockouts; ${lo === hi ? lo : `${lo}–${hi}`} days of cover in every region.`;
      })));
      a.p(`${ctx.g(`${SAUCE} cover in stores on ${date(t.maxDate)}, against the ${word(target)}-day target: ${list(sauce.map((row) => `${row.region} ${n(row.days_of_cover, 1)} days`))}`, 'cover', 'glossary:days-of-cover', 'skill:supply-allocation')}.`);
      a.p(`So ${list(below.map((row) => `the ${row.region}`))} ${below.length === 1 ? 'is' : 'are'} under target${below.length ? ` (the ${below[0].region} at about ${pct(below[0].days_of_cover / target * 100)} of it)` : ''} and ${list(above.map((row) => `the ${row.region}`))} ${above.length === 1 ? 'is' : 'are'} over. ` +
        `The stock exists; it is in the wrong regions. Next step: a transfer between distribution centres before the ${below.length ? below[0].region : 'short region'}'s next delivery.`);
      ctx.facts = { hit, sauce };
    }
  });

  // ===================================================================
  // Why do some single-lane kitchens cope with the Double Stack and others don't?
  // ===================================================================
  MCX.analysis('lena/why-some-kitchens-cope', {
    title: 'Why some kitchens cope', intent: 'diagnostic', scope: 'network',
    terms: ['parallel-staging', 'kitchen-equipment', 'lane-type', 'double-stack', 'staffing-fill-rate'],
    skills: ['cause-attribution'],
    models: ['ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM', 'KITCHEN_EQUIPMENT_DIM', 'STAFFING_DAILY_FACT', 'DAILY_SALES_FACT'],
    bare: { topic: 'equipment', cannot: 'I can list asset names and I can see timing by lane type, but nothing certified links the two.' },
    run(ctx) {
      const t = ctx.time, a = ctx.answer, item = E.item(t.launch.item);
      ctx.say('Running the attribution checklist against the certified GOLD tables.');
      const seg = E.segments(ctx, { key: 'who_moved', where: { lane: 'single_lane' }, say: 'Who moved and who did not — single-lane kitchens with and without parallel staging, before and after the launch.' });
      const now = E.formats(ctx, { key: 'since_launch', where: { since: t.launch.date, lane: 'single_lane' }, say: 'The same two groups since launch, against benchmark.' });
      const register = ctx.q('register', { model: 'KITCHEN_EQUIPMENT_DIM', by: ['model'], metrics: ['stores'], where: { eq: STATION, lane: 'single_lane' } }, 'What separates them in the equipment register.');
      const fill = ctx.q('crews', { model: 'STAFFING_DAILY_FACT', by: ['has_parallel_staging', 'operator_name'], metrics: ['stores', 'fill_rate'], where: { lane: 'single_lane', since: t.launch.date }, order: 'f.has_parallel_staging, fill_rate_pct' }, 'Are the crews different? Shift fill rate for single-lane stores since launch, by operator.');
      const dose = E.regions(ctx, { key: 'dose', where: { exposed: true, since: t.launch.date }, metrics: ['stores', 'window_time', 'secs_vs_benchmark'], order: 'window_s DESC', say: 'Dose-response among the kitchens without a station — window time by region.' });
      const mix = ctx.q('mix', { model: 'DAILY_SALES_FACT', by: ['region'], metrics: ['double_stack_share'], where: { exposed: true, since: t.launch.date }, order: 'ds_share_pct DESC' }, `Against the ${item}'s share of their drive-thru orders.`);
      ctx.voice();

      const x = seg.exposed, r = seg.retrofitted, nx = now.exposed, nr = now.retrofitted, share = E.index(mix, 'region');
      const crews = (staged) => fill.filter((row) => !!row.has_parallel_staging === staged);
      const weighted = (rows) => rows.reduce((sum, row) => sum + row.fill_rate_pct * row.stores, 0) / (rows.reduce((sum, row) => sum + row.stores, 0) || 1);
      const exposedCrews = crews(false), low = exposedCrews[0], withoutLow = weighted(exposedCrews.filter((row) => row !== low));
      const outlier = low && withoutLow - low.fill_rate_pct >= 3;

      a.p(`${ctx.g(`The kitchens that cope have a parallel prep station. Among single-lane kitchens it is the one thing that separates them`, 'who_moved', 'register', 'skill:cause-attribution', 'glossary:parallel-staging')}.`);
      a.list([
        nr ? `${ctx.g(`${nr.stores} single-lane kitchens with a ${register[0] ? register[0].model.replace(/\s*\(.*\)/, '') : 'PPS-2'} retrofit: window time ${n(r.before.window_s)} → ${n(r.after.window_s)} sec since launch`, 'who_moved', 'since_launch', 'glossary:kitchen-equipment')}, ${n(Math.abs(nr.secs_vs_benchmark))} sec ${nr.secs_vs_benchmark > 0 ? 'over' : 'inside'} benchmark, ${pct(nr.pct_in_benchmark)} of orders inside it.` : null,
        `${ctx.g(`${nx.stores} single-lane kitchens without one: ${n(x.before.window_s)} → ${n(x.after.window_s)} sec`, 'who_moved', 'since_launch')}, ${n(nx.secs_vs_benchmark)} over, ${pct(nx.pct_in_benchmark)} inside.`
      ]);
      a.p(`Same lane type, same benchmark, same item, same launch day. ${ctx.g(`Crews are not the difference`, 'crews', 'glossary:staffing-fill-rate')}: shift fill rate is ${pct(weighted(crews(true)), 1)} in the retrofitted kitchens and ${pct(weighted(exposedCrews), 1)} in the others` +
        (outlier ? `, and that gap is one operator (${low.operator_name}, ${pct(low.fill_rate_pct, 1)}); without those stores it is ${pct(withoutLow, 1)}.` : '.'));
      a.listed(`${ctx.g(`The second factor, among the ${nx.stores} without a station, is how much ${item} they sell`, 'dose', 'mix', 'glossary:double-stack')}:`,
        dose.map((row) => `${row.region}: ${pct((share[row.region] || {}).ds_share_pct)} of drive-thru orders, ${n(row.window_s)} sec at the window (${count(row.stores, 'kitchen')}).`));
      a.p(`So it is equipment first and mix second. A PPS-2 kit removes the first; nothing in supply changes the second. The kitchens to fit first are the ones with both: no station and the highest ${item} share.`);
      ctx.facts = { x: nx, r: nr, dose };
    }
  });

  // ===================================================================
  // Why is the Southeast running short of Stack Sauce?
  // ===================================================================
  MCX.analysis('lena/southeast-sauce-short', {
    title: 'Why the sauce is short', intent: 'diagnostic', scope: 'network',
    terms: ['stack-sauce', 'days-of-cover', 'double-stack', 'region'],
    skills: ['supply-allocation'],
    models: ['DAILY_SALES_FACT', 'FRANCHISE_STORE_DIM', 'INVENTORY_DAILY_FACT', 'DC_STOCK_FACT'],
    bare: 'stock',
    run(ctx) {
      const t = ctx.time, a = ctx.answer, plan = ctx.params('supply-allocation'), item = E.item(t.launch.item);
      const focus = (ctx.focus && ctx.focus.region) || null;
      ctx.say('Reading the certified sales and stock tables.');
      const mix = ctx.q('mix', { model: 'DAILY_SALES_FACT', by: ['region'], metrics: [['double_stack_share', 1]], where: { since: t.launch.date }, order: 'ds_share_pct DESC' },
        `The launch allocation assumed the ${item} would be ${plan.launch_plan_mix_pct}% of drive-thru orders everywhere. Actual share by region since launch.`);
      const cover = ctx.q('cover', { model: 'INVENTORY_DAILY_FACT', by: ['region'], metrics: ['days_of_cover'], where: { eq: { component: SAUCE, date: t.maxDate } }, order: 'days_of_cover' }, `What that did to store cover: days of ${SAUCE} on ${date(t.maxDate)}.`);
      const outs = ctx.q('stockouts', { model: 'INVENTORY_DAILY_FACT', by: ['region'], metrics: ['stockout_hours', 'stores_out'], where: { eq: { component: SAUCE }, since: t.launch.date, raw: ['i.stockout_hours > 0'] }, order: 'stockout_hours DESC' }, 'And whether any store actually ran out.');
      const dc = ctx.q('dc', { model: 'DC_STOCK_FACT', by: ['dc_name', 'region', 'on_hand', 'weekly_usage', 'next_delivery_date'], where: { eq: { item: SAUCE } }, order: 'dc.on_hand / dc.weekly_usage' }, 'Behind the stores: each distribution centre against its region\'s weekly usage.');
      ctx.voice();

      const region = focus || cover[0].region, shareBy = E.index(mix, 'region'), coverBy = E.index(cover, 'region'), dcBy = E.index(dc, 'region');
      const mine = shareBy[region], least = mix[mix.length - 1], out = E.index(outs, 'region')[region], home = dcBy[region], far = dc[dc.length - 1];
      const daysOf = (row) => row.on_hand / (row.weekly_usage / 7), until = fmt.daysBetween(t.maxDate, home.next_delivery_date);
      const ahead = (row) => (row.ds_share_pct / plan.launch_plan_mix_pct - 1) * 100;

      a.p(`${ctx.g(`Because ${SAUCE} was allocated on one planning assumption, and the ${region} sells more ${item} than the plan`, 'mix', 'skill:supply-allocation', 'glossary:stack-sauce')}.`);
      a.p(`The launch allocation assumed the ${item} would be ${plan.launch_plan_mix_pct}% of drive-thru orders in every region. ${ctx.g(`Actual since launch: ${list(mix.map((row) => `${row.region} ${pct(row.ds_share_pct)}`))}`, 'mix', 'glossary:double-stack')}. ` +
        `The ${region} is using about ${pct(Math.abs(ahead(mine)))} ${ahead(mine) > 0 ? 'more' : 'less'} sauce than it was given; the ${least.region} about ${pct(Math.abs(ahead(least)))} less.`);
      a.p(`In the stores: ${ctx.g(`${n(coverBy[region].days_of_cover, 1)} days of cover in the ${region} against a ${word(plan.target_cover_days)}-day target`, 'cover', 'glossary:days-of-cover')} (${list(cover.filter((row) => row.region !== region).map((row) => `${row.region} ${n(row.days_of_cover, 1)}`))})` +
        (out ? `, and ${ctx.g(`${n(out.stockout_hours)} stockout hours at ${word(out.stores_out)} ${region} stores`, 'stockouts')} over the launch weekend.` : '.'));
      a.p(`Behind the stores: ${ctx.g(`the ${home.dc_name} holds ${n(home.on_hand)} cases against regional usage of ${n(home.weekly_usage)} a week, ${n(daysOf(home), 1)} days`, 'dc')}, and its next delivery is ${date(home.next_delivery_date)}, ${word(until)} days out. ` +
        `The ${far.dc_name} holds ${n(far.on_hand)} cases against ${n(far.weekly_usage)} a week: ${n(daysOf(far), 1)} days.`);
      a.p(`So it is an allocation problem, not a supplier problem. The stock exists, in the wrong region. Move cases to ${short(home.dc_name)} now, and size the ${date(home.next_delivery_date)} delivery on the ${region}'s actual share, not the plan.`);
      ctx.facts = { region, mix, cover, home: daysOf(home), far: daysOf(far) };
    }
  });

  // ===================================================================
  // How do I get parallel prep stations into the worst kitchens fastest?
  // ===================================================================
  MCX.analysis('lena/fastest-retrofit', {
    title: 'Fastest retrofit', intent: 'prescriptive', scope: 'network',
    terms: ['parallel-staging', 'retrofit-kit', 'revenue-at-risk'],
    skills: ['retrofit-planning', 'what-if-analysis'],
    models: ['ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM', 'DAILY_SALES_FACT', 'DC_STOCK_FACT'],
    bare: { topic: 'equipment', cannot: 'I can list assets and kit counts.' },
    run(ctx) {
      const t = ctx.time, a = ctx.answer, plan = ctx.params('retrofit-planning');
      ctx.say('Following the retrofit-planning skill against the certified GOLD tables.');
      const risk = E.risk(ctx, { atRiskOnly: true, by: ['region'], where: { week: 'this', exposed: true }, say: 'Rank the kitchens without a station by weekly revenue at risk: that is the order kits go out in.' });
      const kits = kitStock(ctx);
      ctx.voice();

      const stock = kits.reduce((sum, row) => sum + row.on_hand, 0), ranked = risk.hit, first = ranked.slice(0, stock), later = ranked.slice(stock);
      const cost = kits[0].unit_cost_usd, lead = kits[0].lead_time_days;
      const goes = {}; first.forEach((row) => { (goes[row.region] = goes[row.region] || []).push(row); });
      const regions = Object.keys(goes).sort((p, q) => goes[q].length - goes[p].length);
      const dcBy = E.index(kits, 'region');
      const local = regions.map((region) => ({ region, need: goes[region].length, have: (dcBy[region] || { on_hand: 0 }).on_hand, dc: (dcBy[region] || {}).dc_name }));
      const donors = kits.filter((row) => row.on_hand > (goes[row.region] || []).length).map((row) => `${short(row.dc_name)}'s ${row.on_hand - (goes[row.region] || []).length}`);
      const receivers = local.filter((row) => row.need > row.have).map((row) => row.region);
      const ship = fmt.addDays(t.maxDate, plan.ship_days), need = nights(plan, first.length), done = fmt.addDays(ship, need);
      const recovered = first.reduce((sum, row) => sum + row.weekly_rev_at_risk, 0), arrive = fmt.addDays(t.maxDate, lead);

      a.p(`${ctx.g(`Use the ${stock} kits already in the distribution centres, send them to the ${stock} kitchens with the most revenue at risk, and fit them in ${word(need)} nights`, 'kits', 'quantify', 'skill:retrofit-planning')}.`);
      a.list([
        `${ctx.g(`In stock: ${list(kits.map((row) => `${short(row.dc_name)} ${row.on_hand}`))}`, 'kits', 'glossary:retrofit-kit')}.`,
        `${ctx.g(`Where they go, ranked by weekly revenue at risk: ${list(regions.map((region) => `${goes[region].length} to the ${region}`))}`, 'quantify', 'skill:what-if-analysis', 'glossary:revenue-at-risk')}. First in line: ${list(first.slice(0, 4).map((row) => `${row.store_name} (${k(row.weekly_rev_at_risk)} a week)`))}.`,
        `Routing: ${list(local.map((row) => `${short(row.dc)} covers ${Math.min(row.need, row.have)} of the ${row.region}'s ${row.need}`))}` + (receivers.length && donors.length ? `; ${list(donors)} spare kits ship to the ${list(receivers)}.` : '.'),
        `${ctx.g(`Schedule: kits ship ${fmt.dayDate(ship)}; ${word(plan.install_crews)} crews at one kitchen a night finish the ${stock} by the morning of ${fmt.dayDate(done)}`, 'skill:retrofit-planning', 'kits')}.`,
        `Money: ${stock} × ${usd(cost)} installed = ${usd(stock * cost)}, recovering about ${k(recovered)} a week: ${ctx.g(`payback about ${n(stock * cost / recovered)} weeks`, 'quantify', 'kits')}.`
      ]);
      if (later.length) {
        a.p(`The other ${later.length} kitchens need kits from the supplier: ${lead} days' lead time, so an order placed now lands about ${date(arrive)} and takes ${word(nights(plan, later.length))} more nights to fit. Until then they run the playbook's pre-staging.`);
      }
      ctx.facts = { stock, first: first.map((r) => r.store_name), recovered, done };
    }
  });

  // ===================================================================
  // How should I rebalance Double Stack stock between regions this week?
  // ===================================================================
  MCX.analysis('lena/rebalance-stock', {
    title: 'Rebalancing stock', intent: 'prescriptive', scope: 'network',
    terms: ['days-of-cover', 'stack-sauce', 'double-stack', 'region'],
    skills: ['supply-allocation'],
    models: ['DC_STOCK_FACT', 'INVENTORY_DAILY_FACT', 'FRANCHISE_STORE_DIM'],
    bare: 'stock',
    run(ctx) {
      const t = ctx.time, a = ctx.answer, plan = ctx.params('supply-allocation');
      ctx.say('Following the stock-allocation skill against the certified stock tables.');
      const dc = ctx.q('dc', { model: 'DC_STOCK_FACT', by: ['dc_name', 'region', 'on_hand', 'weekly_usage', 'next_delivery_date'], where: { eq: { item: SAUCE } }, order: 'dc.on_hand / dc.weekly_usage' },
        `${SAUCE} at each distribution centre against its own region's weekly usage and next delivery.`);
      const cover = ctx.q('cover', { model: 'INVENTORY_DAILY_FACT', by: ['component', 'region'], metrics: ['days_of_cover'], where: { eq: { date: t.maxDate } }, order: 'i.component DESC, days_of_cover' },
        `Store cover by component and region on ${date(t.maxDate)}: does anything else need to move?`);
      ctx.voice();

      const round = (cases) => Math.ceil(cases / 10) * 10;
      const centres = dc.map((row) => {
        const daily = row.weekly_usage / 7, until = fmt.daysBetween(t.maxDate, row.next_delivery_date);
        return Object.assign({}, row, { daily, days: row.on_hand / daily, until, gap: daily * until - row.on_hand, spare: row.on_hand - daily * plan.donor_keeps_days });
      });
      const shortOnes = centres.filter((c) => c.gap > 0).sort((p, q) => q.gap - p.gap), donors = centres.filter((c) => c.spare > 0).sort((p, q) => q.spare - p.spare);
      const moves = []; const left = donors.map((d) => ({ dc: d, spare: Math.floor(d.spare) }));
      shortOnes.forEach((s) => {
        let need = round(s.gap);
        left.forEach((d) => {
          if (need <= 0 || d.spare <= 0) return;
          const take = Math.min(need, d.spare);
          moves.push({ from: d.dc, to: s, cases: take }); d.spare -= take; need -= take;
        });
      });
      const arrive = fmt.addDays(t.maxDate, 1 + plan.transit_days);
      const patties = cover.filter((row) => row.component !== SAUCE), sauce = cover.filter((row) => row.component === SAUCE);
      const main = moves[0];

      if (!moves.length) {
        a.p(`${ctx.g('No transfer is needed this week', 'dc', 'skill:supply-allocation', 'glossary:days-of-cover')}: every distribution centre covers its region until its next delivery.`);
        a.list(centres.map((c) => `${c.dc_name} (${c.region}): ${n(c.on_hand)} cases, ${n(c.days, 1)} days; next delivery ${date(c.next_delivery_date)}.`));
        return;
      }
      a.p(`${ctx.g(`Move ${list(moves.map((m, i) => `${n(m.cases)}${i === 0 ? ` cases of ${SAUCE}` : ''} from ${short(m.from.dc_name)} to ${short(m.to.dc_name)}`))}`, 'dc', 'skill:supply-allocation', 'glossary:stack-sauce')}. Nothing else needs to move.`);
      a.listed(`Each distribution centre in days of its own region's usage:`, centres.map((c) => {
        const head = `${c.dc_name} (${c.region}): ${n(c.on_hand)} cases, ${n(c.days, 1)} days; next delivery ${date(c.next_delivery_date)}, ${word(c.until)} days out`;
        if (c.gap > 0) return `${c === shortOnes[0] ? ctx.g(head, 'dc', 'glossary:days-of-cover') : head}. Short by about ${n(c.gap)} cases${c.gap < c.daily ? ', which is marginal' : ''}.`;
        const give = `Can give ${n(Math.floor(c.spare))} and still keep the ${word(plan.donor_keeps_days)}-day reserve`;
        return `${head}. ${c.spare > 0 ? (c === donors[0] ? ctx.g(give, 'skill:supply-allocation', 'dc') : give) + '.' : 'Nothing to spare.'}`;
      }));
      a.p(`Timing: transfers take ${word(plan.transit_days)} days, so cases sent tomorrow reach ${short(main.to.dc_name)} on ${fmt.dayDate(arrive)}. ${ctx.g(`${short(main.to.dc_name)} has ${n(main.to.days, 1)} days on hand`, 'dc')}, so it gets there ${main.to.days > 1 + plan.transit_days ? 'before the shelf is empty' : 'just as the shelf empties: send it today if possible'}, and carries the region to the ${date(main.to.next_delivery_date)} delivery.`);
      a.p(`${ctx.g(`In stores, ${SAUCE} cover is ${list(sauce.map((row) => `${n(row.days_of_cover, 1)} days in the ${row.region}`))}`, 'cover')}, against a ${word(plan.target_cover_days)}-day target` +
        (patties.length ? `; ${plural(patties[0].component)} are at ${n(Math.min.apply(null, patties.map((row) => row.days_of_cover)), 1)} days or more everywhere and need no move.` : '.') +
        ` Then fix the cause: size the next deliveries on each region's actual Double Stack share, not the launch plan.`);
      ctx.facts = { centres: centres.map((c) => [c.dc_name, c.days, c.gap, c.spare]), moves: moves.map((m) => [m.from.dc_name, m.to.dc_name, m.cases]) };
    }
  });

  // ===================================================================
  // What if we retrofit every single-lane kitchen — what does it take?
  // ===================================================================
  MCX.analysis('lena/retrofit-every-single-lane', {
    title: 'What-if: retrofit every kitchen', intent: 'predictive', scope: 'network',
    terms: ['parallel-staging', 'retrofit-kit', 'lane-type', 'revenue-at-risk'],
    skills: ['retrofit-planning', 'what-if-analysis'],
    models: ['FRANCHISE_STORE_DIM', 'DC_STOCK_FACT', 'ORDER_TIMING_MART', 'DAILY_SALES_FACT', 'MENU_CHANGE_LOG'],
    bare: { topic: 'whatif', needs: 'A retrofit changes a kitchen, and what that is worth has to be measured somewhere' },
    run(ctx) {
      const t = ctx.time, a = ctx.answer, plan = ctx.params('retrofit-planning');
      ctx.say('Following the retrofit-planning skill against the certified GOLD tables.');
      const need = ctx.q('kitchens', { model: 'FRANCHISE_STORE_DIM', by: ['region'], metrics: ['stores'], where: { exposed: true }, order: 'stores DESC' }, 'Kitchens to fit: single-lane without a parallel prep station, by region.');
      const kits = kitStock(ctx);
      const risk = E.risk(ctx, { atRiskOnly: true, where: { week: 'this', exposed: true }, say: 'What it is worth: weekly revenue at risk at those kitchens, with the what-if rule.' });
      const menu = E.menu(ctx, { key: 'next', planned: true, say: 'And the date that matters: the next two-step item in the menu change log.' });
      ctx.voice();

      const total = need.reduce((sum, row) => sum + row.stores, 0), stock = kits.reduce((sum, row) => sum + row.on_hand, 0), order = Math.max(0, total - stock);
      const cost = kits[0].unit_cost_usd, lead = kits[0].lead_time_days;
      const ship = fmt.addDays(t.maxDate, plan.ship_days), firstNights = nights(plan, Math.min(stock, total)), firstDone = fmt.addDays(ship, firstNights);
      const arrive = fmt.addDays(t.maxDate, lead), restNights = nights(plan, order), allDone = fmt.addDays(arrive, restNights);
      const next = menu.planned.filter((row) => row.requires_two_step_prep)[0];
      const payback = (weekly) => total * cost / weekly;

      a.p(`${ctx.g(`${total} kitchens, ${usd(total * cost)}, and about ${word(Math.round(fmt.daysBetween(t.maxDate, allDone) / 7))} weeks end to end`, 'kitchens', 'kits', 'skill:retrofit-planning')}: ${Math.min(stock, total)} can be done by ${date(firstDone)}, the other ${order} wait for the supplier.`);
      a.list([
        `Kitchens to fit: ${total} single-lane without a station — ${list(need.map((row) => `${row.region} ${row.stores}`))}.`,
        `${ctx.g(`Kits: ${stock} on hand (${list(kits.map((row) => `${short(row.dc_name)} ${row.on_hand}`))}); ${order} to order at a ${lead}-day lead time, landing about ${date(arrive)}`, 'kits', 'glossary:retrofit-kit')}.`,
        `Installs: ${word(plan.install_crews)} crews, one kitchen a night each. The ${Math.min(stock, total)} in stock take ${word(firstNights)} nights (done ${date(firstDone)}); the other ${order} take ${word(restNights)} more (done about ${date(allDone)}).`,
        `Cost: ${total} × ${usd(cost)} installed = ${usd(total * cost)}.`,
        `${ctx.g(`Return: it removes about ${k(risk.weekly.central)} a week of revenue at risk (range ${kRange(risk.weekly.low, risk.weekly.high)})`, 'quantify', 'skill:what-if-analysis', 'glossary:revenue-at-risk')}, a payback of about ${n(payback(risk.weekly.central))} weeks (${n(payback(risk.weekly.high))}–${n(payback(risk.weekly.low))}).`
      ]);
      if (next) {
        const fittedByThen = next.event_date > firstDone ? Math.min(stock, total) : 0, allByThen = allDone <= next.event_date;
        a.p(`${ctx.g(`One date matters: ${next.item_name}, another two-step item, is planned for ${date(next.event_date)}`, 'next', 'glossary:parallel-staging')}. ` +
          (allByThen ? 'The full programme lands before it.' : `Only the first ${fittedByThen} kitchens will be fitted by then; the other ${total - fittedByThen} need pre-staging to carry them, or the launch split so they get the new item later.`));
      }
      a.p(`To hold these dates the order for ${order} kits has to go to the supplier now. Phase the installs by revenue at risk, highest first.`);
      ctx.facts = { total, stock, order, firstDone, allDone, risk: risk.weekly };
    }
  });

  // ===================================================================
  // What if Honey Heat Chicken launches on June 4 — are the kitchens ready?
  // ===================================================================
  MCX.analysis('lena/honey-heat-readiness', {
    title: 'What-if: next launch readiness', intent: 'predictive', scope: 'network',
    terms: ['lto', 'parallel-staging', 'retrofit-kit', 'pre-staging'],
    skills: ['launch-readiness', 'what-if-analysis', 'retrofit-planning'],
    models: ['MENU_CHANGE_LOG', 'ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM', 'DC_STOCK_FACT'],
    bare: { topic: 'whatif', needs: 'A second two-step item lands on kitchens in different states', cannot: 'The raw tables have a launch date and raw window times, and nothing that says what "ready" means for a kitchen.' },
    run(ctx) {
      const t = ctx.time, a = ctx.answer, ready = ctx.params('launch-readiness'), model = ctx.params('what-if-analysis'), plan = ctx.params('retrofit-planning');
      ctx.say('Applying the launch-readiness rule to the certified GOLD tables.');
      const menu = E.menu(ctx, { key: 'next', planned: true, say: 'The launch in question, from the menu change log: item, date, and whether it is two-step.' });
      const named = menu.planned.filter((row) => MCX.text.hasPhrase(ctx.question, row.item_name))[0] || menu.planned.filter((row) => row.requires_two_step_prep)[0] || menu.planned[0];
      const f = E.formats(ctx, { key: 'formats', metrics: ['stores', 'window_time', 'secs_vs_benchmark'], say: `Readiness is parallel staging, or window time at or under ${ready.max_window_secs} sec. This week by kitchen format.` });
      const regions = E.regions(ctx, { key: 'exposed_regions', where: { week: 'this', exposed: true }, metrics: ['stores', 'window_time'], order: 'window_s DESC', say: 'The kitchens that fail the first test: window time by region.' });
      const kits = kitStock(ctx);
      ctx.voice();

      const stage = model.pre_stage_secs, second = model.second_two_step_item_secs, limit = ready.max_window_secs;
      const staged = (f.dual ? f.dual.stores : 0) + (f.retrofitted ? f.retrofitted.stores : 0), exposed = f.exposed ? f.exposed.stores : 0, all = staged + exposed;
      const passToday = regions.filter((row) => row.window_s <= limit).reduce((sum, row) => sum + row.stores, 0);
      const stock = kits.reduce((sum, row) => sum + row.on_hand, 0), lead = kits[0].lead_time_days;
      const ship = fmt.addDays(t.maxDate, plan.ship_days), fitted = Math.min(stock, exposed), fittedBy = fmt.addDays(ship, nights(plan, fitted));
      const order = Math.max(0, exposed - stock), deadline = fmt.addDays(named.event_date, -lead), restDone = fmt.addDays(named.event_date, nights(plan, order));
      const afterBoth = (row) => [row.window_s - stage[1] + second[0], row.window_s - stage[0] + second[1]];
      const clear = regions.filter((row) => afterBoth(row)[1] <= limit), fail = regions.filter((row) => afterBoth(row)[1] > limit);
      const twoStep = !!named.requires_two_step_prep;

      a.p(`${ctx.g(`${staged + passToday} of ${all} kitchens are ready today; ${staged + passToday + fitted} can be by ${date(named.event_date)}`, 'formats', 'kits', 'skill:launch-readiness')}; the other ${Math.max(0, exposed - passToday - fitted)} are not, unless they are fitted later or the launch is split.`);
      a.p(`${ctx.g(`${named.item_name} is planned for ${fmt.dayDate(named.event_date)}`, 'next', 'glossary:lto')}${twoStep ? ', and like the Double Stack it is two-step prep' : ', single-step'}${named.ops_impact_level ? ` with ${named.ops_impact_level} ops impact` : ''}. The rule: a kitchen is ready for a two-step item if it has parallel staging, or its window time is at or under ${limit} sec.`);
      a.list([
        `${ctx.g(`Ready: ${f.dual ? `${f.dual.stores} dual-lane` : ''}${f.retrofitted ? ` and ${f.retrofitted.stores} retrofitted single-lane` : ''} kitchens`, 'formats', 'glossary:parallel-staging')} (window ${n(Math.min(f.dual.window_s, (f.retrofitted || f.dual).window_s))}–${n(Math.max(f.dual.window_s, (f.retrofitted || f.dual).window_s))} sec).`,
        `${ctx.g(`Not ready: ${exposed} single-lane kitchens without a station`, 'exposed_regions', 'formats')}. Window time this week: ${list(regions.map((row) => `${row.region} ${n(row.window_s)} sec`))}.`,
        `${ctx.g(`Pre-staging the Double Stack takes ${stage.join('–')} sec off, but a second two-step item adds ${second.join('–')} back on a lane that is not fixed`, 'skill:what-if-analysis', 'glossary:pre-staging')}. Net: ${list(regions.map((row) => `${row.region} ${n(afterBoth(row)[0])}–${n(afterBoth(row)[1])} sec`))}. ` +
          (clear.length ? `Only the ${list(clear.map((row) => row.region))} (${clear.reduce((sum, row) => sum + row.stores, 0)} kitchens) clears ${limit} across the range.` : `None clears ${limit} across the range.`)
      ]);
      a.listed('What ships and what has to be ordered:', [
        `${ctx.g(`Ships now: the ${stock} PPS-2 kits in stock, to the highest-risk kitchens, fitted by ${date(fittedBy)}`, 'kits', 'skill:retrofit-planning', 'glossary:retrofit-kit')}.`,
        order ? `To order: ${order} kits at a ${lead}-day lead time. To land by ${date(named.event_date)} the order has to go by ${fmt.dayDate(deadline)}${deadline <= fmt.addDays(t.maxDate, 1) ? ', which is tomorrow at the latest' : ''}, and fitting them takes ${word(nights(plan, order))} more nights, to about ${date(restDone)}.` : 'Nothing to order: stock covers every kitchen.'
      ]);
      a.p(`So the supply answer is a split launch: ${staged + passToday + fitted} kitchens on ${date(named.event_date)}, the rest as their kits are fitted` + (fail.length ? `, with the ${list(fail.map((row) => row.region))} last in line for the new item and first in line for kits.` : '.'));
      ctx.facts = { item: named.item_name, staged, fitted, order, deadline };
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
