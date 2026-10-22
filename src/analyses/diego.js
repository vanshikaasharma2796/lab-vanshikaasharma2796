/* =====================================================================
   src/analyses/diego.js — eight analyses for the person who runs the promo

   Diego (Ads) launched the McContext Double Stack. His questions are
   about the campaign: what it earns and where, what it does to the
   other combos and to the kitchens, and what to do with its weight.
   All eight are network-wide; a region named in a question does not
   narrow them.

     promo-performance              How is the Double Stack promo performing since launch?
     double-stack-sales-by-region   Which regions are selling the most Double Stack?
     double-stack-by-region         Why is the Double Stack hurting some regions more than others?
     combo-cannibalization          Is the Double Stack cannibalizing our other combos?
     rollout-back-on-track          How do we get the Double Stack rollout back on track?
     adjust-the-promo               How should I adjust the promo while single-lane stores recover?
     pause-double-stack             What if we paused Double Stack at single-lane stores — what's the revenue impact?
     delay-next-lto                 What if we delay the next LTO by 2 weeks?

   Every figure comes from a query; every rule (the promo playbook, the
   ops playbook, the what-if effects, the revenue-at-risk rule, the
   launch-readiness test) is read from the context layer. Nothing here
   is a fixed number.
   ===================================================================== */
(function (global) {
  'use strict';
  const MCX = global.MCX, fmt = MCX.fmt, E = MCX.evidence;
  const { n, usd, k, kRange, pct, signed, cap, word, list, date, dateRange } = fmt;

  const COMBO = 'COMBO_REVENUE_DAILY', SALES = 'DAILY_SALES_FACT', TIMING = 'ORDER_TIMING_MART';
  const SEGMENT = { order: 'order time', prep: 'prep time', window: 'window time' };
  const COLUMN = { order: 'order_s', prep: 'prep_s', window: 'window_s' };

  /** "Double Stack" from "McContext Double Stack". */
  function shortItem(name) { return String(name).replace(/^McContext\s+/, ''); }
  /** What the two steps are, from a menu-log note: "fry, then sauce toss". */
  function twoSteps(event) { const m = /Two-step prep: ([^.]+)\./.exec((event && event.notes) || ''); return m ? m[1] : null; }
  function sum(rows, column) { return rows.reduce((total, row) => total + (Number(row[column]) || 0), 0); }
  /** "41" when both ends round to the same number, otherwise "41–46". */
  function span(lo, hi) { return n(lo) === n(hi) ? n(lo) : `${n(Math.min(lo, hi))}–${n(Math.max(lo, hi))}`; }
  /** "+$27k" or "−$5k". */
  function signedK(x) { return (x < 0 ? '−' : '+') + k(Math.abs(x)); }
  /** "the Southeast, the Midwest and the West" */
  function theRegions(rows) { return list(rows.map((row) => `the ${row.region}`)); }
  /** A list that says its unit once: "11 of 24 stores in the Southeast, 10 of 35 in the Midwest and …". */
  function oncePer(rows, first, rest) { return list(rows.map((row, i) => (i ? rest(row) : first(row)))); }
  /** " (May 11–13, three days so far)": the partial-week policy wants the days stated with this week's figures. */
  function daysSoFar(t) { return t.thisWeek.partial ? ` (${dateRange(t.thisWeek.start, t.thisWeek.end)}, ${word(t.thisWeek.days)} days so far)` : ''; }
  /** The reasoning line for a launch period that ends in a partial week. */
  function perDay(ctx, why) {
    const t = ctx.time;
    if (t.thisWeek.partial) ctx.policy('partial-week', `Data ends ${fmt.dayDate(t.maxDate)}, so "this week" is ${dateRange(t.thisWeek.start, t.thisWeek.end)}: ${word(t.thisWeek.days)} days. ${why}`);
  }

  // -------------------------------------------------------------------
  // Shared evidence: the promo in dollars
  // -------------------------------------------------------------------
  /**
   * What the launch item has earned since launch, region by region, largest first.
   * Returns { rows, days, net, gross (dollars per day), units, discount (percent), weekly }.
   */
  function promo(ctx, o) {
    o = o || {};
    const t = ctx.time;
    const rows = ctx.q(o.key || 'promo', {
      model: COMBO, by: ['region'], metrics: ['days', 'net_per_day', 'gross_per_day', 'units', 'discount_rate'],
      where: { eq: { is_lto: true, item_name: t.launch.item }, since: t.launch.date }, order: 'net_per_day DESC'
    }, o.say);
    const net = sum(rows, 'net_per_day');
    return { rows, days: rows.length ? rows[0].days : 0, net, gross: sum(rows, 'gross_per_day'), units: sum(rows, 'units'),
      discount: rows.length ? rows[0].discount_rate * 100 : 0, weekly: net * 7 };
  }

  /**
   * The combos item by item: net revenue per day in the 30 days before launch against the days since.
   * Returns { rows, items: [{ name, pre, post, change, pctChange }], pre, post, up, down (most down first) }.
   */
  function combos(ctx, o) {
    o = o || {};
    const t = ctx.time;
    const rows = ctx.q(o.key || 'combos', {
      model: COMBO, by: ['item_name'], split: { at: t.launch.date, before: 'pre', after: 'post' }, metrics: ['days', 'net_per_day'],
      where: { eq: { category: 'Combo' }, from: t.baseline.from, to: t.maxDate }, order: 'c.item_name, period DESC'
    }, o.say);
    const items = pivot(rows);
    return { rows, items, pre: sum(items, 'pre'), post: sum(items, 'post'),
      down: items.filter((c) => c.pctChange < -0.5).sort((x, y) => x.pctChange - y.pctChange), up: items.filter((c) => c.pctChange >= -0.5) };
  }
  /** One entry per item from rows split into "pre" and "post". */
  function pivot(rows) {
    const byItem = {};
    rows.forEach((row) => { (byItem[row.item_name] = byItem[row.item_name] || { name: row.item_name })[row.period] = row.net_per_day; });
    return Object.keys(byItem).map((name) => byItem[name]).filter((c) => c.pre > 0 && c.post != null)
      .map((c) => Object.assign(c, { change: c.post - c.pre, pctChange: (c.post - c.pre) / c.pre * 100 }));
  }

  /**
   * The combo table stops at region. Following the glossary, a region's Double Stack revenue is split between its
   * kitchen formats by each format's share of the region's Double Stack orders on the sales fact.
   * Returns { rows, regions: [{ region, net, exposed, retrofitted, dual, coping, share }], exposed, retrofitted, coping } in dollars per day.
   */
  function allocate(ctx, sales, o) {
    o = o || {};
    const rows = ctx.q(o.key || 'allocate', {
      model: SALES, by: ['region', 'lane_type', 'has_parallel_staging'], metrics: ['stores', 'double_stack_orders'],
      where: { since: ctx.time.launch.date }, order: 'f.region, f.lane_type DESC, f.has_parallel_staging'
    }, o.say);
    const regions = sales.rows.map((sale) => {
      const mine = rows.filter((row) => row.region === sale.region), orders = sum(mine, 'ds_orders') || 1;
      const part = (format) => sale.net_per_day * sum(mine.filter((row) => E.formatOf(row) === format), 'ds_orders') / orders;
      const out = { region: sale.region, net: sale.net_per_day, exposed: part('exposed'), retrofitted: part('retrofitted'), dual: part('dual') };
      return Object.assign(out, { coping: out.retrofitted + out.dual, share: out.net ? out.exposed / out.net * 100 : 0 });
    });
    return { rows, regions, exposed: sum(regions, 'exposed'), retrofitted: sum(regions, 'retrofitted'), coping: sum(regions, 'coping') };
  }

  // -------------------------------------------------------------------
  // Shared evidence: the kitchens behind it
  // -------------------------------------------------------------------
  /** Stores by region and kitchen format, from the store dimension: { Southeast: { region, stores, exposed, retrofitted, dual }, … }. */
  function kitchens(ctx, o) {
    o = o || {};
    const rows = ctx.q(o.key || 'kitchens', { model: 'FRANCHISE_STORE_DIM', by: ['region', 'lane_type', 'has_parallel_staging'], metrics: ['stores'],
      order: 'f.region, f.lane_type DESC, f.has_parallel_staging' }, o.say);
    const out = {};
    rows.forEach((row) => {
      const region = (out[row.region] = out[row.region] || { region: row.region, stores: 0, exposed: 0, retrofitted: 0, dual: 0 });
      region.stores += row.stores;
      region[E.formatOf(row)] += row.stores;
    });
    return out;
  }

  /**
   * Exposed kitchens region by region: the 30 days before launch against this week.
   * Returns [{ region, stores, before, now, blowout (window seconds gained) }], the region furthest over benchmark first.
   */
  function exposedByRegion(ctx, o) {
    o = o || {};
    const t = ctx.time;
    const rows = ctx.q(o.key || 'exposed', {
      model: TIMING, by: ['region'], split: { at: t.launch.date, before: 'before', after: 'now' },
      metrics: ['stores', 'order_time', 'prep_time', 'window_time', 'drive_thru_time', 'secs_vs_benchmark'],
      where: { exposed: true, ranges: [[t.baseline.from, t.baseline.to], [t.thisWeek.start, t.thisWeek.end]] }, order: 'f.region, period'
    }, o.say);
    const by = {};
    rows.forEach((row) => { (by[row.region] = by[row.region] || { region: row.region })[row.period] = row; });
    return Object.keys(by).map((region) => by[region]).filter((g) => g.before && g.now)
      .map((g) => Object.assign(g, { stores: g.now.stores, blowout: g.now.window_s - g.before.window_s }))
      .sort((p, q) => q.now.secs_vs_benchmark - p.now.secs_vs_benchmark);
  }

  /**
   * What a what-if effect of back = [low, high] seconds does to one group of exposed kitchens. The seconds come off
   * window time and drive-thru time, but no step makes a kitchen faster than it was before the launch.
   * Returns { region, window: [best, cautious], over: [best, cautious] }.
   */
  function project(group, back) {
    const floor = (column, secs) => Math.max(group.before[column], group.now[column] - secs);
    return { region: group.region, window: [floor('window_s', back[1]), floor('window_s', back[0])], over: [floor('secs_vs_benchmark', back[1]), floor('secs_vs_benchmark', back[0])] };
  }

  /**
   * Revenue still at risk, store by store, once `back` seconds come off drive-thru time. floor[store] is the store's
   * seconds over benchmark before the launch: it cannot come out better than that. Scaled from each store's risk today.
   */
  function riskAfter(rule, rows, floor, back) {
    return rows.reduce((total, row) => {
      const over = Math.max(floor[row.store_name] != null ? floor[row.store_name] : 0, row.secs_vs_benchmark - back);
      return total + (over > rule.ignore_within_secs ? row.weekly_rev_at_risk * over / row.secs_vs_benchmark : 0);
    }, 0);
  }

  /** The segment that moved most between two rows: the drive-thru-timing skill's bottleneck rule. */
  function bottleneck(ctx, before, now) {
    return ctx.params('drive-thru-timing').segments.map((name) => ({ name, change: now[COLUMN[name]] - before[COLUMN[name]] })).sort((p, q) => q.change - p.change)[0];
  }

  /** How many weeks of delay the question asks about ("by 2 weeks"). A wording without a number takes the bank question's. */
  function weeksAsked(ctx, analysis) {
    const read = (text) => Number((/(\d+)\s*-?\s*weeks?\b/i.exec(text || '') || [])[1]) || 0;
    const bank = MCX.router.examples().filter((example) => example.analysis === analysis)[0];
    return read(ctx.question) || read(bank && bank.text) || 1;
  }

  // -------------------------------------------------------------------
  // The bare analyst: what the raw tables show of the promo
  // -------------------------------------------------------------------
  /** The Double Stack's row in the raw menu table: without a context layer, the only place its SKU and launch date live. */
  function rawItem(b) {
    return b.one('raw_menu_item', `
      SELECT SKU_ID, ITEM_NAME, CATEGORY, IS_LTO, LAUNCH_DATE
      FROM BRONZE.RAW_MENU_ITEMS
      WHERE ITEM_NAME LIKE '%Double Stack%'`, 'Find the Double Stack in the raw menu table, for its SKU and launch date.');
  }
  /** Its raw revenue by region since launch, gross and net. */
  function rawRegions(b, item, say) {
    return b.q('raw_item_regions', `
      SELECT REGION,
             COUNT(DISTINCT DATE)             AS days,
             ROUND(SUM(GROSS_REVENUE_USD), 0) AS gross_rev,
             ROUND(SUM(NET_REVENUE_USD), 0)   AS net_rev,
             SUM(TOTAL_UNITS)                 AS units
      FROM BRONZE.RAW_COMBO_REVENUE_DAILY
      WHERE SKU_ID = '${item.SKU_ID}'
      GROUP BY REGION
      ORDER BY net_rev DESC`, say);
  }
  /** Raw drive-thru seconds before and after a date, by lane type: the only store attribute the raw tables offer. */
  function rawLanes(b, since, say) {
    return b.q('raw_lane_timing', `
      SELECT s.LANE_TYPE,
             CASE WHEN t.DATE < '${since}' THEN 'before' ELSE 'after' END AS period,
             COUNT(DISTINCT t.STORE_ID)                                 AS stores,
             ROUND(AVG(t.AVG_DT_SECS), 1)                               AS avg_dt_secs
      FROM BRONZE.RAW_ORDER_TIMING_DAILY t
      JOIN BRONZE.RAW_STORES s ON s.STORE_ID = t.STORE_ID
      WHERE s.IS_ACTIVE = TRUE
        AND t.DATE >= date('${since}', '-30 days')
      GROUP BY s.LANE_TYPE, period
      ORDER BY s.LANE_TYPE DESC, period DESC`, say);
  }
  function rawCell(rows, lane, period) { return rows.filter((row) => row.LANE_TYPE === lane && row.period === period)[0] || {}; }

  // ===================================================================
  // How is the Double Stack promo performing since launch?
  // ===================================================================
  MCX.analysis('diego/promo-performance', {
    title: 'Promo performance', intent: 'descriptive', scope: 'network',
    terms: ['double-stack', 'combo-revenue', 'benchmark', 'parallel-staging'],
    skills: ['promo-playbook'],
    models: ['COMBO_REVENUE_DAILY', 'DAILY_SALES_FACT', 'ITEM_RATING_DAILY', 'ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM'],
    bare(b, kit) {
      const item = rawItem(b);
      if (!item.SKU_ID) { kit.limit(b, `${b.b("I can't find the Double Stack in RAW_MENU_ITEMS")}, so I have nothing to report on.`); return; }
      const weeks = b.q('raw_item_weeks', `
        SELECT date(DATE, 'weekday 0', '-6 days') AS wk,
               COUNT(DISTINCT DATE)               AS days,
               ROUND(SUM(GROSS_REVENUE_USD), 0)   AS gross_rev,
               ROUND(SUM(NET_REVENUE_USD), 0)     AS net_rev,
               SUM(TOTAL_UNITS)                   AS units
        FROM BRONZE.RAW_COMBO_REVENUE_DAILY
        WHERE SKU_ID = '${item.SKU_ID}'
        GROUP BY wk
        ORDER BY wk`, 'Pull its revenue by week, gross and net. "Since launch" is the only period I can be sure of.');
      b.say('Two raw columns both read as revenue — gross and net of discounts — and no definition tells me which one a promo is judged on. Reporting both.', { hold: true });
      const net = sum(weeks, 'net_rev'), gross = sum(weeks, 'gross_rev'), days = sum(weeks, 'days');
      const first = weeks[0], last = weeks[weeks.length - 1];
      kit.ask(b, `"Performing" against what? No raw table holds a sales target, a forecast or a plan for this item, so ${b.b("I can tell you what it sold, not whether that is good")}.`);
      kit.ask(b, `Gross or net? RAW_COMBO_REVENUE_DAILY has both: ${usd(gross)} gross and ${usd(net)} net since launch. ${b.b('Which one do you judge a promo on?')}`);
      if (weeks.length > 1) {
        kit.ask(b, `How should I compare the weeks? Net revenue is ${usd(first.net_rev)} in the week of ${date(first.wk)} and ${b.b(`${usd(last.net_rev)} in the week of ${date(last.wk)}, a ${pct(Math.abs(last.net_rev - first.net_rev) / first.net_rev * 100)} ${last.net_rev < first.net_rev ? 'fall' : 'rise'}`)}. ` +
          `The first has ${first.days} days of sales and the second ${last.days}, and I have no rule for that.`);
      }
      kit.fact(b, `Since ${date(item.LAUNCH_DATE)} the ${item.ITEM_NAME} has sold ${b.g(`${n(sum(weeks, 'units'))} units in ${n(days)} days`)}, for ${usd(net)} net (${usd(gross)} gross). RAW_MENU_ITEMS files it under "${item.CATEGORY}".`);
      kit.limit(b, 'That is a sales tally, not a verdict. What the promo is doing to other items and what it costs the stores are not in these rows. Give me the target and the official revenue figure and I can say how it is performing.');
    },
    run(ctx) {
      const t = ctx.time, a = ctx.answer;
      const X = E.group(ctx, 'exposed');
      const item = shortItem(t.launch.item), play = ctx.params('promo-playbook');

      ctx.say('Reading the certified GOLD tables.');
      perDay(ctx, 'The promo playbook judges a promotion on net revenue per day, so no weekly totals.');
      const sales = promo(ctx, { say: `What the ${item} has earned since ${date(t.launch.date)}: net and gross per day, units and the discount, by region.` });
      const others = combos(ctx, { say: 'Did the other combos hold? Net revenue per day, the 30 days before launch against the days since.' });
      const mix = ctx.one('mix', { model: SALES, metrics: ['double_stack_share'], where: { since: t.launch.date } },
        `How much of the drive-thru trade is it? Share of drive-thru orders that include the ${item}.`);
      const stars = ctx.q('rating', { model: 'ITEM_RATING_DAILY', by: ['item_name'], metrics: ['ratings', 'avg_rating'], where: { since: t.launch.date }, order: 'avg_rating DESC' },
        'What customers make of it: in-app star ratings since launch.');
      const f = E.formats(ctx, { key: 'cost', say: 'What the launch costs the kitchens: this week against benchmark, by lane type and parallel staging.' });

      const x = f.exposed, rest = f.rows.filter((row) => E.formatOf(row) !== 'exposed');
      const worst = rest.length ? Math.max.apply(null, rest.map((row) => row.secs_vs_benchmark)) : 0;
      const own = stars.filter((row) => row.item_name === t.launch.item)[0], peer = stars.filter((row) => row.item_name !== t.launch.item)[0];
      const change = (others.post - others.pre) / others.pre * 100;
      ctx.voice();

      a.p(`${ctx.g(`The ${item} is earning ${usd(sales.net)} a day net since it launched on ${date(t.launch.date)}`, 'promo', 'glossary:combo-revenue', 'skill:promo-playbook')}, a run rate of about ${k(sales.weekly)} a week.`);
      a.listed(`The first ${word(sales.days)} days${t.thisWeek.partial ? `, per day because this week has only ${word(t.thisWeek.days)} days of data so far` : ''}:`, [
        `By region: ${oncePer(sales.rows, (row) => `${row.region} ${usd(row.net_per_day)} a day`, (row) => `${row.region} ${usd(row.net_per_day)}`)}.`,
        `Volume and price: ${n(sales.units)} units. Gross is ${usd(sales.gross)} a day; ${ctx.g(`the ${pct(sales.discount)} launch discount takes ${usd(sales.gross - sales.net)} a day`, 'promo')}, and revenue is reported net.`,
        mix.ds_share_pct != null ? `Reach: ${ctx.g(`it is in ${pct(mix.ds_share_pct)} of drive-thru orders`, 'mix', 'glossary:double-stack')}.` : null,
        own ? `Rating: ${ctx.g(`${n(own.avg_rating, 1)} stars from ${n(own.ratings)} in-app ratings`, 'rating')}${peer ? `, against ${n(peer.avg_rating, 1)} for the ${peer.item_name}` : ''}.` : null
      ]);
      a.p(change > -3
        ? `${ctx.g('The other combos held', 'combos')}: ${usd(fmt.round(others.pre, -1))} a day in the 30 days before launch, ${usd(fmt.round(others.post, -1))} since, with ${others.up.length === others.items.length ? `all ${word(others.items.length)}` : `${word(others.up.length)} of the ${word(others.items.length)}`} flat or up.`
        : `${ctx.g(`The other combos are down ${pct(Math.abs(change))} a day`, 'combos')}: ${usd(fmt.round(others.pre, -1))} in the 30 days before launch, ${usd(fmt.round(others.post, -1))} since.`);
      if (x && x.secs_vs_benchmark > Math.max(0, worst)) {
        a.p(`The cost is in the kitchens. ${ctx.g(`${cap(X.the)} are running ${n(x.avg_dt_secs)} sec at the drive-thru against a ${n(x.benchmark)}-sec benchmark`, 'cost', 'glossary:benchmark', 'glossary:parallel-staging')}, ` +
          `${n(x.secs_vs_benchmark)} sec over${daysSoFar(t)}; the other ${n(sum(rest, 'stores'))} stores are ${worst <= 0 ? 'inside benchmark' : `inside benchmark or within ${n(worst)} sec of it`}. ` +
          `So the decision now is not whether to keep the promo but where to put its weight: full at ${play.push_where}, eased around the ${X.count} that are over.`);
      } else {
        a.p(`${ctx.g('No kitchen format is paying for it', 'cost', 'glossary:benchmark', 'glossary:parallel-staging')}: every one is at or inside its benchmark this week${daysSoFar(t)}, so the campaign can keep its full weight.`);
      }
      ctx.facts = { sales, combos: { pre: others.pre, post: others.post }, mix, own, x };
    }
  });

  // ===================================================================
  // Which regions are selling the most Double Stack?
  // ===================================================================
  MCX.analysis('diego/double-stack-sales-by-region', {
    title: 'Double Stack sales by region', intent: 'descriptive', scope: 'network',
    terms: ['double-stack', 'region', 'combo-revenue', 'parallel-staging'],
    skills: ['promo-playbook', 'ontology'],
    models: ['COMBO_REVENUE_DAILY', 'FRANCHISE_STORE_DIM', 'DAILY_SALES_FACT'],
    bare(b, kit) {
      const item = rawItem(b);
      if (!item.SKU_ID) { kit.limit(b, `${b.b("I can't find the Double Stack in RAW_MENU_ITEMS")}, so I have nothing to rank.`); return; }
      const regions = rawRegions(b, item, 'Total its revenue by region since launch, gross and net.');
      const stores = kit.index(b.q('raw_region_stores', `
        SELECT o.REGION, COUNT(*) AS listed, SUM(s.IS_ACTIVE) AS active
        FROM BRONZE.RAW_STORES s
        JOIN BRONZE.RAW_FRANCHISE_OWNERS o ON o.OPERATOR_ID = s.OPERATOR_ID
        GROUP BY o.REGION
        ORDER BY o.REGION`, 'Count stores per region for a per-store view. RAW_STORES has no region, so each store takes its owner\'s.'), 'REGION');
      const closed = Object.keys(stores).reduce((total, region) => total + stores[region].listed - stores[region].active, 0);
      const perStore = regions.map((row) => ({ region: row.REGION, value: stores[row.REGION] ? row.net_rev / row.days / stores[row.REGION].active : 0 })).sort((p, q) => q.value - p.value);
      kit.ask(b, `"Most" by what? ${b.b('I ranked on total dollars, which favours the region with the most stores')}. Per store the order changes: ${perStore[0].region} comes first.`);
      kit.ask(b, `Gross or net? RAW_COMBO_REVENUE_DAILY has both, about ${pct((1 - sum(regions, 'net_rev') / sum(regions, 'gross_rev')) * 100)} apart. ${b.b('Which one is your reporting truth?')}`);
      kit.ask(b, `Which stores count? RAW_STORES lists ${n(sum(Object.keys(stores).map((region) => stores[region]), 'listed'))} stores and ${n(closed)} of them are inactive. I left those out, which is an assumption.`);
      kit.fact(b, `Net revenue since ${date(item.LAUNCH_DATE)} (${regions[0].days} days): ${b.g(list(regions.map((row) => `${row.REGION} ${usd(row.net_rev)}`)))}.`);
      kit.fact(b, `RAW_POS_DAILY has total transactions and no item detail, so ${b.b("I can't say how big a part of each region's orders the Double Stack is")}.`);
      kit.limit(b, 'I can rank regions on raw dollars. Whether a region is selling well for its size, or could take more, needs the official revenue figure and something about what its stores can handle. Neither is in the raw tables.');
    },
    run(ctx) {
      const t = ctx.time, a = ctx.answer;
      const item = shortItem(t.launch.item), play = ctx.params('promo-playbook');

      ctx.say('Reading the certified GOLD tables.');
      perDay(ctx, 'Regions are compared on net revenue per day since launch, never on weekly totals.');
      const sales = promo(ctx, { key: 'sales', say: `Rank the regions on net ${item} revenue per day since ${date(t.launch.date)}.` });
      const shops = kitchens(ctx, { key: 'stores', say: 'Roll up from stores: how many each region has, and how many of them have parallel staging.' });
      const mix = E.index(ctx.q('mix', { model: SALES, by: ['region'], metrics: ['double_stack_share'], where: { since: t.launch.date }, order: 'ds_share_pct DESC' },
        `Size is not appetite: the ${item}'s share of drive-thru orders in each region.`), 'region');

      const regions = sales.rows.filter((row) => shops[row.region]).map((row) => {
        const shop = shops[row.region];
        return { region: row.region, net: row.net_per_day, stores: shop.stores, exposed: shop.exposed, staged: shop.stores - shop.exposed,
          perStore: row.net_per_day / shop.stores, share: mix[row.region] ? mix[row.region].ds_share_pct : 0 };
      });
      const average = sum(regions, 'net') / sum(regions, 'stores');
      regions.forEach((r) => { r.index = r.perStore / average * 100; });
      const ranked = regions.slice().sort((p, q) => q.perStore - p.perStore);
      const top = regions[0], hi = ranked[0], lo = ranked[ranked.length - 1], middle = ranked.slice(1, -1);
      const line = (r) => `${r.region}: ${usd(r.net)} a day from ${r.stores} stores (${usd(r.perStore)} a store), ${pct(r.share)} of drive-thru orders`;
      ctx.voice();

      a.p(`${ctx.g(top === hi ? `The ${top.region} sells the most ${item}, in dollars and per store` : `The ${top.region} sells the most ${item} in dollars; the ${hi.region} sells the most per store`, 'sales', 'stores', 'glossary:region', 'skill:ontology')}.`);
      a.listed(`Net revenue per day since the ${date(t.launch.date)} launch, and the ${item}'s share of drive-thru orders:`,
        regions.map((r) => (r === top ? `${ctx.g(line(r), 'sales', 'stores', 'glossary:combo-revenue')}.` : r === hi ? `${ctx.g(line(r), 'mix', 'glossary:double-stack')}.` : `${line(r)}.`)));
      a.p(`The network averages ${usd(average)} a store. Against that, ${ctx.g(`the ${hi.region} over-indexes at ${n(hi.index)} and the ${lo.region} under-indexes at ${n(lo.index)}`, 'sales', 'stores')}` +
        (middle.length ? `; ${oncePer(middle, (r) => `the ${r.region} (${n(r.index)})`, (r) => `the ${r.region} (${n(r.index)})`)} ${middle.length === 1 ? 'sits' : 'sit'} in between.` : '.'));
      a.p(`What that means for media weight: the promo playbook keeps full weight at ${play.push_where}. ` +
        `${ctx.g(`That is ${lo.staged} of ${lo.stores} stores in the ${lo.region}`, 'stores', 'skill:promo-playbook', 'glossary:parallel-staging')}, where the ${item} has the most room to grow, ` +
        `and ${hi.staged} of ${hi.stores} in the ${hi.region}, where it is already ${pct(hi.share)} of orders. ` +
        (lo.staged / lo.stores >= hi.staged / hi.stores
          ? `Added weight belongs in the ${lo.region}. Hold drive-thru weight in the ${hi.region}: ${hi.exposed} of its kitchens are single-lane without parallel staging, the format the playbook holds back until window time is under ${play.resume_below_window_secs} sec.`
          : `The ${lo.region} has the room but not the kitchens, so no region is a clear place to add drive-thru weight yet.`));
      ctx.facts = { regions, average };
    }
  });

  // ===================================================================
  // Why is the Double Stack hurting some regions more than others?
  // ===================================================================
  MCX.analysis('diego/double-stack-by-region', {
    title: 'Double Stack by region', intent: 'diagnostic', scope: 'network',
    terms: ['double-stack', 'region', 'parallel-staging', 'benchmark'],
    skills: ['cause-attribution', 'ontology', 'drive-thru-timing'],
    models: ['COMBO_REVENUE_DAILY', 'MENU_CHANGE_LOG', 'ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM', 'DAILY_SALES_FACT'],
    bare(b, kit) {
      const item = rawItem(b);
      if (!item.LAUNCH_DATE) { kit.limit(b, `${b.b("I can't find the Double Stack in RAW_MENU_ITEMS")}, so I have no date to compare around.`); return; }
      const since = item.LAUNCH_DATE;
      const timing = b.q('raw_region_timing', `
        SELECT o.REGION, s.LANE_TYPE,
               CASE WHEN t.DATE < '${since}' THEN 'before' ELSE 'after' END AS period,
               COUNT(DISTINCT t.STORE_ID)                                 AS stores,
               ROUND(AVG(t.AVG_DT_SECS), 1)                               AS avg_dt_secs
        FROM BRONZE.RAW_ORDER_TIMING_DAILY t
        JOIN BRONZE.RAW_STORES s ON s.STORE_ID = t.STORE_ID
        JOIN BRONZE.RAW_FRANCHISE_OWNERS o ON o.OPERATOR_ID = s.OPERATOR_ID
        WHERE s.IS_ACTIVE = TRUE
          AND t.DATE >= date('${since}', '-30 days')
        GROUP BY o.REGION, s.LANE_TYPE, period
        ORDER BY o.REGION, s.LANE_TYPE, period DESC`, 'Average raw drive-thru seconds by owner region and lane type, 30 days before that date against the days since.');
      const pos = b.q('raw_region_pos', `
        SELECT o.REGION,
               CASE WHEN p.DATE < '${since}' THEN 'before' ELSE 'after' END AS period,
               ROUND(AVG(p.AVG_SERVICE_SECS), 1)                          AS avg_service_secs
        FROM BRONZE.RAW_POS_DAILY p
        JOIN BRONZE.RAW_STORES s ON s.STORE_ID = p.STORE_ID
        JOIN BRONZE.RAW_FRANCHISE_OWNERS o ON o.OPERATOR_ID = s.OPERATOR_ID
        WHERE s.IS_ACTIVE = TRUE
          AND p.DATE >= date('${since}', '-30 days')
        GROUP BY o.REGION, period
        ORDER BY o.REGION, period DESC`, 'RAW_POS_DAILY has its own service-time column. Same cut.');
      b.say('Two raw columns both claim to be “drive-thru time” and they disagree — `RAW_POS_DAILY.AVG_SERVICE_SECS` and `RAW_ORDER_TIMING_DAILY.AVG_DT_SECS`. Nothing says which is authoritative — guessing.', { hold: true });

      // Blend the lane types back into one figure per region, and keep single-lane apart.
      const names = [];
      timing.forEach((row) => { if (names.indexOf(row.REGION) === -1) names.push(row.REGION); });
      const blend = (region, period, lane) => {
        const rows = timing.filter((row) => row.REGION === region && row.period === period && (!lane || row.LANE_TYPE === lane));
        const stores = sum(rows, 'stores');
        return stores ? rows.reduce((total, row) => total + row.avg_dt_secs * row.stores, 0) / stores : 0;
      };
      const moved = names.map((region) => ({ region, all: blend(region, 'after') - blend(region, 'before'), single: blend(region, 'after', 'single_lane') - blend(region, 'before', 'single_lane') }))
        .sort((p, q) => q.all - p.all);
      const posMove = Math.max.apply(null, names.map((region) => {
        const rows = pos.filter((row) => row.REGION === region), by = kit.index(rows, 'period');
        return by.after && by.before ? Math.abs(by.after.avg_service_secs - by.before.avg_service_secs) : 0;
      }));
      const singles = moved.slice().sort((p, q) => q.single - p.single), most = singles[0], least = singles[singles.length - 1];
      kit.ask(b, `How should I measure "hurting"? I used the change in AVG_DT_SECS around ${date(since)}. On AVG_SERVICE_SECS no region moves by more than ${n(Math.max(posMove, 1))} sec. ${b.b('Which one does your ops team report on?')}`);
      kit.ask(b, `What makes a region different? RAW_STORES gives me city, state, lane type and opening date. Single-lane stores slowed most, so lane type is my best guess. But single-lane stores slowed ${n(most.single)} sec in the ${most.region} and ${n(least.single)} in the ${least.region}, and ${b.b("I can't see why")}.`);
      kit.ask(b, `Is it the Double Stack at all? RAW_MENU_ITEMS confirms the launch date. Nothing in the raw tables links the item to kitchen workload, so ${b.b("the timing is a coincidence I'm leaning on")}.`);
      kit.fact(b, `On AVG_DT_SECS, ${b.g(oncePer(moved, (m) => `the ${m.region} is up ${n(m.all)} sec since launch`, (m) => `the ${m.region} ${n(m.all)}`))}. Lane type explains some of it.`);
      kit.limit(b, `I can show that the regions moved by different amounts. I'm missing whatever separates a single-lane store that coped from one that didn't, so "the ${moved[0].region} is worse" is as far as I can go, and ${b.b('that points you at the people rather than the cause')}.`);
    },
    run(ctx) {
      const t = ctx.time, a = ctx.answer;
      const item = shortItem(t.launch.item), found = {};

      // The checks, and their order, come from the checklist file. Remove one there and it is not run here.
      const checks = {
        timing() { found.menu = E.menu(ctx, { key: 'timing', say: 'Timing — was the launch the same in every region: same item, same day?' }); },
        'who-moved'() {
          found.spread = E.formats(ctx, { key: 'who_moved', by: ['region'], metrics: ['stores', 'drive_thru_time', 'benchmark', 'secs_vs_benchmark', 'window_time'],
            order: 'f.lane_type DESC, f.has_parallel_staging, secs_vs_benchmark DESC', say: 'Who moved and who did not — this week against benchmark, by kitchen format within each region.' }).rows;
        },
        'which-seconds'() { found.seconds = exposedByRegion(ctx, { key: 'which_seconds', say: 'Which seconds moved — exposed kitchens region by region, the 30 days before launch against this week.' }); },
        'dose-response'() {
          found.dose = ctx.q('dose', { model: SALES, by: ['region', 'lane_type', 'has_parallel_staging'], metrics: ['stores', 'double_stack_share'], where: { since: t.launch.date },
            order: 'f.lane_type DESC, f.has_parallel_staging, ds_share_pct DESC' }, `Dose-response — the ${item}'s share of drive-thru orders in the same kitchens. More of it should mean more seconds.`);
        },
        exceptions() {
          found.drift = ctx.params('operator-scorecard').drift;
          found.before = ctx.q('exceptions', { model: TIMING, by: ['operator_name', 'region'], metrics: ['stores', 'prep_time', 'secs_vs_benchmark'],
            where: { exposed: true, from: t.baseline.from, to: t.baseline.to }, order: 'secs_vs_benchmark DESC' },
            `Exceptions — any operator whose exposed kitchens were already more than ${found.drift.secs_over} sec over benchmark before the launch (the scorecard's drift test).`);
        }
      };
      ctx.say('Walking the attribution checklist against the certified GOLD tables.');
      const sales = promo(ctx, { say: `Start with what the ${item} earns in each region, so the damage is read against the sales.` });
      ctx.skill('cause-attribution').steps.forEach((name) => { if (checks[name]) checks[name](); });
      ['spread', 'seconds', 'dose'].forEach((need) => { if (!found[need]) throw new Error('the attribution checklist must keep its who-moved, which-seconds and dose-response checks'); });

      const cell = (rows, region, format) => rows.filter((row) => row.region === region && E.formatOf(row) === format)[0] || null;
      const regions = found.seconds.map((g) => {
        const mix = cell(found.dose, g.region, 'exposed'), main = bottleneck(ctx, g.before, g.now);
        return { region: g.region, exposed: g.stores, stores: sum(found.spread.filter((row) => row.region === g.region), 'stores'),
          over: g.now.secs_vs_benchmark, share: mix ? mix.ds_share_pct : 0, main: main.name, change: main.change };
      });
      const staged = found.spread.filter((row) => E.formatOf(row) !== 'exposed'), duals = staged.filter((row) => E.formatOf(row) === 'dual');
      const worst = staged.length ? Math.max.apply(null, staged.map((row) => row.secs_vs_benchmark)) : 0;
      const retro = staged.filter((row) => E.formatOf(row) === 'retrofitted')[0];
      const retroMix = retro && cell(found.dose, retro.region, 'retrofitted'), neighbour = retro && cell(found.dose, retro.region, 'exposed');
      const inStep = regions.every((r, i) => !i || r.share <= regions[i - 1].share);
      const oneSegment = regions.every((r) => r.main === regions[0].main);
      const early = found.before ? found.before.filter((row) => row.secs_vs_benchmark > found.drift.secs_over) : [];
      const peers = found.before ? found.before.filter((row) => early.indexOf(row) === -1) : [];
      const first = regions[0], last = regions[regions.length - 1], launch = found.menu && found.menu.launch;
      ctx.voice();

      a.p(`${ctx.g('It is the kitchens, not the regions', 'who_moved', 'dose', 'skill:cause-attribution')}. The ${item} sells in all ${word(sales.rows.length)} (${usd(sales.net)} a day net), and where it hurts comes down to two things: ` +
        `how many kitchens are exposed, and how much of their trade the ${item} is.` +
        (launch && launch.affected_regions === 'ALL' ? ` The launch itself was identical: one item, ${date(launch.event_date)}, all regions.` : ''));
      a.listed(`The checks, on this week's figures${daysSoFar(t)}:`, [
        `Exposure. ${ctx.g(`Single-lane kitchens without parallel staging are ${oncePer(regions, (r) => `${r.exposed} of ${r.stores} stores in the ${r.region}`, (r) => `${r.exposed} of ${r.stores} in the ${r.region}`)}`, 'who_moved', 'skill:ontology', 'glossary:parallel-staging')}. ` +
          (worst <= 0 ? 'Every other kitchen is inside benchmark.' : `Nothing else is more than ${n(worst)} sec over benchmark.`),
        `Dose. At those kitchens ${ctx.g(`the ${item} is ${oncePer(regions, (r) => `${pct(r.share)} of drive-thru orders in the ${r.region}`, (r) => `${pct(r.share)} in the ${r.region}`)}`, 'dose', 'glossary:double-stack')}, ` +
          `and they run ${list(regions.map((r) => n(r.over)))} sec over benchmark${inStep ? ': the same order' : ', which does not follow the same order'}.`,
        oneSegment ? `Seconds. ${ctx.g(`The rise is in ${SEGMENT[first.main]}${first.main === 'window' ? ', where a two-step item queues' : ''}`, 'which_seconds', 'skill:drive-thru-timing')}: ${list(regions.map((r) => signed(r.change)))} sec on the 30 days before launch.` : null
      ], true);
      if (duals.length) {
        const inside = duals.map((row) => -row.secs_vs_benchmark);
        a.p(`The controls hold. ${ctx.g(`Dual-lane stores are ${span(Math.min.apply(null, inside), Math.max.apply(null, inside))} sec inside benchmark in every region`, 'who_moved', 'glossary:benchmark')}` +
          (retro && retroMix ? `, and the ${retro.region}'s ${word(retro.stores)} retrofitted single-lane kitchens sell ${neighbour && n(neighbour.ds_share_pct) === n(retroMix.ds_share_pct) ? `the same ${pct(retroMix.ds_share_pct)}` : pct(retroMix.ds_share_pct)} and sit ${n(retro.secs_vs_benchmark)} sec over.` : '.'));
      }
      if (found.before) {
        const e = early[0];
        a.p(e ? `One exception to keep apart: ${ctx.g(`${fmt.possessive(e.operator_name)} ${word(e.stores)} exposed ${e.region} kitchens were already ${n(e.secs_vs_benchmark)} sec over benchmark before the launch`, 'exceptions', 'skill:operator-scorecard')}, ` +
            `on prep time (${n(e.prep_s)} sec against ${n(sum(peers, 'prep_s') / (peers.length || 1))} elsewhere). That part is not the campaign's.`
          : `${ctx.g(`No operator's exposed kitchens were more than ${found.drift.secs_over} sec over benchmark before the launch`, 'exceptions', 'skill:operator-scorecard')}, so there is no second cause to separate.`);
      }
      a.p(`For the campaign: demand is the dose. Ease drive-thru weight where exposure and share are both high, the ${first.region} first; the ${last.region} has room for more.`);
      ctx.facts = { regions, worst, early };
    }
  });

  // ===================================================================
  // Is the Double Stack cannibalizing our other combos?
  // ===================================================================
  MCX.analysis('diego/combo-cannibalization', {
    title: 'Combo cannibalization check', intent: 'diagnostic', scope: 'network',
    terms: ['combo-revenue', 'double-stack'],
    skills: ['diagnostic-playbook', 'seasonality-check', 'promo-playbook'],
    models: ['COMBO_REVENUE_DAILY', 'DAILY_SALES_FACT'],
    bare: { topic: 'combo', cannot: 'Something moved after the launch, but I cannot tell cannibalization from a short week or from ordinary week-to-week movement.' },
    run(ctx) {
      const t = ctx.time, a = ctx.answer;
      const item = shortItem(t.launch.item), category = { category: 'Combo' };
      const post = { from: t.launch.date, to: t.maxDate };

      ctx.say('Walking the playbook against the certified GOLD tables.');
      const weekly = ctx.q('confirm', { model: COMBO, by: ['week_start'], metrics: ['days', 'net_rev', 'net_per_day'], where: { eq: category, since: t.baseline.from }, order: 'week_start' },
        `Confirm — did combo revenue move at all? Weekly net revenue around ${date(t.launch.date)}, with the days in each week.`);
      const lastWeek = weekly[weekly.length - 1], full = weekly.filter((row) => row.days === 7), prevWeek = full[full.length - 1];
      const partial = lastWeek.days < 7 && !!prevWeek;
      if (partial) ctx.policy('partial-week', `The week of ${date(lastWeek.week_start)} has ${word(lastWeek.days)} days of data, so its total cannot be set against a full week. Switching to revenue per day.`);
      const ly = pivot(ctx.q('seasonality', { model: COMBO, by: ['item_name'], split: { at: t.lastYear(t.launch.date), before: 'pre', after: 'post' }, metrics: ['days', 'net_per_day'],
        where: { eq: category, ranges: [[t.lastYear(t.baseline.from), t.lastYear(t.baseline.to)], [t.lastYear(post.from), t.lastYear(post.to)]] }, order: 'c.item_name, period DESC' },
        'Rule out seasonality — the same two periods last year, item by item.'));
      const c = combos(ctx, { key: 'spread', say: `Spread — which combos moved? Net revenue per day before and after ${date(t.launch.date)}, item by item.` });
      const sales = promo(ctx, { key: 'correlate', say: `Correlate — what arrived at the break: ${item} revenue since launch, on top of the combos or instead of them?` });
      const tills = E.index(ctx.q('quantify', { model: SALES, split: { at: t.launch.date, before: 'pre', after: 'post' }, metrics: ['days', 'combo_orders_per_day'], where: { from: t.baseline.from, to: t.maxDate }, order: 'period DESC' },
        'Quantify from the other side — combo orders per day at the tills, before and after.'), 'period');

      const change = (c.post - c.pre) / c.pre * 100, lift = c.post - c.pre + sales.net;
      const soft = c.down[0], rises = c.up.map((x) => x.pctChange), gained = sum(c.up, 'change');
      const lyPre = sum(ly, 'pre'), lyPost = sum(ly, 'post'), lyChange = lyPre ? (lyPost - lyPre) / lyPre * 100 : 0;
      const lySoft = soft && ly.filter((x) => x.name === soft.name)[0];
      const orders = tills.pre && tills.post ? (tills.post.combo_orders_per_day - tills.pre.combo_orders_per_day) / tills.pre.combo_orders_per_day * 100 : null;
      const seasonal = Math.abs(lyChange) >= 1 || (lySoft && Math.abs(lySoft.pctChange) >= 1);
      ctx.voice();

      if (change < -3) {
        a.p(`${ctx.g(`Yes: net combo revenue per day is down ${pct(Math.abs(change))} since the ${item} launched`, 'spread', 'glossary:combo-revenue', 'skill:diagnostic-playbook', 'skill:seasonality-check', 'skill:promo-playbook')}: ` +
          `${usd(c.pre)} a day before, ${usd(c.post)} since, against ${usd(sales.net)} a day from the ${item}. ${list(c.down.map((x) => `${x.name} (${signed(x.pctChange)}%)`))} ${c.down.length === 1 ? 'is' : 'are'} down; the same weeks last year moved ${signed(lyChange)}%.`);
        return;
      }

      a.p(`${ctx.g(`No. The ${item} is adding revenue, not moving it`, 'spread', 'correlate', 'skill:diagnostic-playbook')}: it earns ${usd(sales.net)} a day net, and the other combos are ${Math.abs(change) < 0.5 ? 'flat' : change > 0 ? 'up' : 'down'} ${pct(Math.abs(change))} since it launched.`);
      a.listed(`Net revenue per day, the 30 days before ${date(t.launch.date)} against the ${word(sales.days)} days since:`, [
        `All ${word(c.items.length)} combos: ${usd(fmt.round(c.pre, -1))} → ${usd(fmt.round(c.post, -1))}.`,
        soft ? `${cap(word(c.up.length))} of the ${word(c.items.length)} are up ${span(Math.min.apply(null, rises), Math.max.apply(null, rises))}%. ${ctx.g(`The only one down is the ${soft.name}: ${signed(soft.pctChange)}%, ${usd(fmt.round(Math.abs(soft.change), -1))} a day`, 'spread', 'glossary:combo-revenue')}.`
          : `${ctx.g(`All ${word(c.items.length)} are flat or up`, 'spread', 'glossary:combo-revenue')} (${span(Math.min.apply(null, rises), Math.max.apply(null, rises))}%).`,
        `${ctx.g(`Combos plus the ${item}: ${lift < 0 ? '−' : '+'}${fmt.usd(fmt.round(Math.abs(lift), -1))} a day, ${signed(lift / c.pre * 100)}%`, 'spread', 'correlate')}.`,
        orders != null ? `The tills agree: ${ctx.g(`combo orders per day are ${orders >= 0 ? 'up' : 'down'} ${pct(Math.abs(orders))}`, 'quantify')}.` : null
      ]);
      a.p(seasonal ? `Last year the same weeks moved ${signed(lyChange)}%, so part of this is seasonal and the comparison should be read with that in mind.`
        : `${ctx.g('It is not seasonal', 'seasonality', 'skill:seasonality-check')}: the same weeks last year were flat${lySoft ? `, the ${soft.name} included` : ''}.`);
      if (soft) {
        a.p(`Verdict: mild substitution in one bundle at most. Even if every dollar the ${soft.name} lost went to the ${item}, that is ${pct(Math.abs(soft.change) / sales.net * 100)} of what the ${item} earns, ` +
          `and the other ${word(c.up.length)} combos gained ${usd(fmt.round(gained, -1))} a day.`);
      }
      a.p((partial ? `Read all of this per day. ${ctx.g(`This week has ${word(lastWeek.days)} days of data`, 'confirm', 'policy:partial-week', 'skill:promo-playbook')}, so its ${k(lastWeek.net_rev)} of combo revenue next to last week's ${k(prevWeek.net_rev)} is a short week, not a collapse. `
        : `${ctx.g('The weekly totals say the same', 'confirm', 'skill:promo-playbook')}. `) +
        `For the campaign: cannibalization is no reason to change its weight.`);
      ctx.facts = { pre: c.pre, post: c.post, change, lift, soft, orders, lyChange };
    }
  });

  // ===================================================================
  // How do we get the Double Stack rollout back on track?
  // ===================================================================
  MCX.analysis('diego/rollout-back-on-track', {
    title: 'Rollout recovery plan', intent: 'prescriptive', scope: 'network',
    terms: ['double-stack', 'parallel-staging', 'pre-staging', 'revenue-at-risk', 'benchmark'],
    skills: ['ops-playbook', 'promo-playbook', 'what-if-analysis'],
    models: ['COMBO_REVENUE_DAILY', 'ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM', 'DAILY_SALES_FACT'],
    bare(b, kit) {
      const item = rawItem(b);
      if (!item.SKU_ID) { kit.limit(b, `${b.b("I can't find the Double Stack in RAW_MENU_ITEMS")}, so I cannot say where its rollout stands.`); return; }
      b.say('"Rollout" and "on track" are not defined anywhere I can see, so start with how the item is selling.');
      const regions = rawRegions(b, item, 'Total its revenue by region since launch, gross and net.');
      b.say('Two raw columns both read as revenue — gross and net of discounts — and no definition tells me which one a launch is judged on. Picking one blind.', { hold: true });
      const lanes = rawLanes(b, item.LAUNCH_DATE, 'Check whether stores slowed down after the launch.');
      const tables = b.q('raw_tables', `
        SELECT name
        FROM BRONZE.sqlite_master
        WHERE type = 'table'
        ORDER BY name`, 'Look for a rollout plan or a target to measure against.');
      const blend = (period) => {
        const rows = lanes.filter((row) => row.period === period), stores = sum(rows, 'stores');
        return stores ? rows.reduce((total, row) => total + row.avg_dt_secs * row.stores, 0) / stores : 0;
      };
      const days = regions.length ? regions[0].days : 0, net = sum(regions, 'net_rev'), gross = sum(regions, 'gross_rev');
      kit.ask(b, `What was the plan? "Back on track" assumes a track, and ${b.b("I can't find one in the raw warehouse")}: none of the ${tables.length} BRONZE tables holds a rollout schedule, a sales target or a service target.`);
      kit.ask(b, `Which revenue? RAW_COMBO_REVENUE_DAILY has ${usd(gross)} gross and ${usd(net)} net for the item over ${n(days)} days. I don't know which one a launch is judged on.`);
      kit.ask(b, `What can stores actually change? AVG_DT_SECS went from ${n(blend('before'))} to ${n(blend('after'))} sec after ${date(item.LAUNCH_DATE)}. I have no list of operational levers and ${b.b('no evidence of what any of them is worth')}.`);
      kit.fact(b, `The ${item.ITEM_NAME} is selling in ${regions.length === 1 ? 'one region' : `all ${word(regions.length)} regions`}, and raw drive-thru seconds rose about ${n(blend('after') - blend('before'))} after it launched.`);
      kit.fact(b, `If you want a suggestion anyway: ${b.b('slow down or pause the rollout until speed recovers')}. That is generic advice. I can't size what a pause would cost or save, and I can't tell you which stores need help and which are fine.`);
      kit.limit(b, 'I can describe what happened after the launch. A recovery plan needs targets, a cause and a costed set of options, and none of those are in the raw tables.');
    },
    run(ctx) {
      const t = ctx.time, a = ctx.answer;
      const X = E.group(ctx, 'exposed');
      const item = shortItem(t.launch.item), promoPlay = ctx.params('promo-playbook'), play = ctx.params('ops-playbook'), model = ctx.params('what-if-analysis');

      ctx.say('Walking the playbooks against the certified GOLD tables.');
      const sales = promo(ctx, { say: `What is the rollout worth? Net ${item} revenue per day since launch.` });
      const f = E.formats(ctx, { say: 'Where is it off track? This week against benchmark, by lane type and parallel staging.' });
      const risk = E.risk(ctx, { atRiskOnly: true, say: 'Size the problem: weekly revenue at risk at the stores over benchmark, with the what-if rule.' });
      const groups = exposedByRegion(ctx, { say: 'How far each region has to come back: exposed kitchens, the 30 days before launch against this week.' });
      const stage = model.pre_stage_secs, crew = model.crew_forward_secs, resume = promoPlay.resume_below_window_secs;
      ctx.say(`Read the two playbooks: ops fixes the kitchen (pre-stage ${stage.join('–')} sec, crew forward ${crew.join('–')} sec, then a parallel prep station); the campaign steers demand until window time is under ${resume} sec.`, { hold: true });

      const x = f.exposed, r = f.retrofitted, rest = f.rows.filter((row) => E.formatOf(row) !== 'exposed');
      const worst = rest.length ? Math.max.apply(null, rest.map((row) => row.secs_vs_benchmark)) : 0;
      ctx.voice();

      if (!x || !risk.stores) {
        a.p(`${ctx.g(`The ${item} rollout is on track`, 'promo', 'spread', 'quantify', 'skill:ops-playbook', 'skill:promo-playbook', 'skill:what-if-analysis')}: it earns ${usd(sales.net)} a day net and no kitchen format is more than ${model.loss_rule.ignore_within_secs} sec over benchmark this week${daysSoFar(t)}. Keep the campaign at full weight.`);
        return;
      }
      const ratio = risk.weekly.central / sales.weekly;
      const first = groups.map((g) => project(g, stage));
      const clear = first.filter((p) => p.window[1] < resume), short = first.filter((p) => p.window[1] >= resume);
      const steps = ctx.skill('ops-playbook').steps.map((name, i) => {
        const step = play.steps[name], secs = model[step.effect];
        const what = step.label.replace("the item's", item).replace('the pre-rush', i ? 'the pre-rush' : `the ${play.pre_rush.join(' and ')} pre-rush`);
        if (Array.isArray(secs)) return `${i ? what : ctx.g(what, 'skill:ops-playbook', 'glossary:pre-staging')}: ${i ? 'another ' : ''}${secs.join('–')} sec of window time back${step.cost === 'none' ? ', free' : ''}, from the ${step.starts}.`;
        return `${what} where window time is still above ${play.escalate_above_window_secs} sec after ${word(play.review_after_trading_days)} trading days` + (r ? `; the ${word(r.stores)} kitchens that have one run ${n(r.window_s)} sec.` : '.');
      });

      a.p(`${ctx.g(`Keep the ${item} on the menu and on air: the fix is in ${X.count} kitchens, not in the campaign`, 'spread', 'promo', 'skill:promo-playbook', 'glossary:parallel-staging')}.`);
      a.p(`It earns ${usd(sales.net)} a day net, about ${k(sales.weekly)} a week. ${cap(X.the)} are ${n(x.secs_vs_benchmark)} sec over benchmark${daysSoFar(t)}, which puts ` +
        `${ctx.g(`about ${k(risk.weekly.central)} a week of drive-thru revenue at risk`, 'quantify', 'skill:what-if-analysis', 'glossary:revenue-at-risk')} (range ${kRange(risk.weekly.low, risk.weekly.high)}), ` +
        `${ratio > 1.1 ? 'more than the promo earns' : ratio >= 0.9 ? 'about what the promo earns' : `${pct(ratio * 100)} of what the promo earns`}. ` +
        `The other ${n(sum(rest, 'stores'))} stores are ${worst <= 0 ? 'inside benchmark' : `inside benchmark or within ${n(worst)} sec of it`}.`);
      a.listed('What operations does, in the ops playbook\'s order:', steps, true);
      a.listed('What the campaign does meanwhile, from the promo playbook:', [
        `${ctx.g(`Keep full weight at ${promoPlay.push_where}`, 'skill:promo-playbook', 'spread')}: ${n(sum(rest, 'stores'))} of ${n(sum(f.rows, 'stores'))} stores.`,
        `Around the ${X.count} exposed kitchens, move drive-thru demand off the peak: push the offer in the app, for dine-in and off-peak.`,
        `Resume normal weight once window time is back under ${resume} sec. ` +
          (clear.length && short.length ? `${ctx.g(`Pre-staging alone should get ${theRegions(clear)} there`, 'exposed', 'skill:what-if-analysis')}; ${theRegions(short)} ${short.length === 1 ? 'lands' : 'land'} at ${span(Math.min.apply(null, short.map((p) => p.window[0])), Math.max.apply(null, short.map((p) => p.window[1])))} sec and ${short.length === 1 ? 'needs' : 'need'} the second step.`
            : clear.length ? `${ctx.g('Pre-staging alone should get every region there', 'exposed', 'skill:what-if-analysis')}.`
              : `${ctx.g('Pre-staging alone gets no region there', 'exposed', 'skill:what-if-analysis')}, so plan on the second step everywhere.`)
      ]);
      ctx.facts = { sales, x, risk: risk.weekly, first };
    }
  });

  // ===================================================================
  // How should I adjust the promo while single-lane stores recover?
  // ===================================================================
  MCX.analysis('diego/adjust-the-promo', {
    title: 'Promo adjustment', intent: 'prescriptive', scope: 'network',
    terms: ['double-stack', 'combo-revenue', 'parallel-staging'],
    skills: ['promo-playbook', 'ontology'],
    models: ['COMBO_REVENUE_DAILY', 'DAILY_SALES_FACT', 'FRANCHISE_STORE_DIM', 'ORDER_TIMING_MART'],
    bare(b, kit) {
      const events = b.q('raw_promo_events', `
        SELECT EVENT_DATE, EVENT_NAME, EVENT_TYPE, REGION
        FROM BRONZE.RAW_PROMO_EVENTS
        ORDER BY EVENT_DATE`, 'Find "the promo" — RAW_PROMO_EVENTS is the only table that lists campaigns.');
      const launch = events.filter((row) => row.EVENT_TYPE === 'product_launch').pop() || events[events.length - 1];
      if (!launch) { kit.limit(b, `${b.b('RAW_PROMO_EVENTS is empty')}, so I cannot tell which promo you mean.`); return; }
      const lanes = rawLanes(b, launch.EVENT_DATE, `See what "recover" refers to: raw drive-thru seconds by lane type around ${date(launch.EVENT_DATE)}.`);
      const single = { was: rawCell(lanes, 'single_lane', 'before'), now: rawCell(lanes, 'single_lane', 'after') }, dual = { was: rawCell(lanes, 'dual_lane', 'before'), now: rawCell(lanes, 'dual_lane', 'after') };
      kit.ask(b, `Which promo? RAW_PROMO_EVENTS lists ${word(events.length)}: ${list(events.map((row) => `${row.EVENT_NAME} (${date(row.EVENT_DATE)})`))}. ${b.b(`I'm assuming you mean the ${launch.EVENT_NAME}`)}.`);
      kit.ask(b, `Recover to what? Single-lane stores went from ${n(single.was.avg_dt_secs)} to ${n(single.now.avg_dt_secs)} sec on AVG_DT_SECS, but ${b.b('there is no benchmark column in the raw data')}, so I can't say when a store has recovered.`);
      kit.ask(b, `Adjust what? No raw table holds media weight, spend, channels or targeting, and the revenue table stops at region, so ${b.b('any adjustment from me would be generic')}.`);
      kit.fact(b, `${b.g(`The ${n(single.now.stores)} single-lane stores slowed by ${n(single.now.avg_dt_secs - single.was.avg_dt_secs)} sec after ${date(launch.EVENT_DATE)}`)}; the ${n(dual.now.stores)} dual-lane stores moved ${n(dual.was.avg_dt_secs)} → ${n(dual.now.avg_dt_secs)}. RAW_STORES tells me the lane type and nothing else about the kitchens.`);
      kit.limit(b, 'I can show that single-lane stores slowed. Steering a campaign around them needs a playbook, a recovery threshold and what the promo sells store by store, and the raw tables have none of the three.');
    },
    run(ctx) {
      const t = ctx.time, a = ctx.answer;
      const X = E.group(ctx, 'exposed');
      const item = shortItem(t.launch.item), play = ctx.params('promo-playbook'), limit = play.resume_below_window_secs;

      ctx.say('Walking the promo playbook against the certified GOLD tables.');
      ctx.say(`The playbook: full weight at ${play.push_where}; hold at ${play.hold_where}; resume under ${limit} sec of window time.`, { hold: true });
      const sales = promo(ctx, { say: `What is at stake: net ${item} revenue per day since launch, by region.` });
      const split = allocate(ctx, sales, { say: `The revenue table stops at region, so allocate it to kitchen formats by their share of each region's ${item} orders.` });
      const f = E.formats(ctx, { say: 'Which kitchens are coping? This week against benchmark, by lane type and parallel staging.' });
      const stores = E.stores(ctx, { key: 'hold', by: ['region'], where: { week: 'this', exposed: true }, metrics: ['window_time', 'secs_vs_benchmark'], order: 'window_s DESC',
        say: `Which exposed stores are above the ${limit}-sec window limit this week?` });
      const shops = kitchens(ctx, { key: 'stores', say: 'Roll the exposed stores up to regions: how much of each region they are.' });

      const rest = f.rows.filter((row) => E.formatOf(row) !== 'exposed');
      const worst = rest.length ? Math.max.apply(null, rest.map((row) => row.secs_vs_benchmark)) : 0;
      const above = stores.filter((row) => row.window_s > limit);
      const regions = split.regions.map((r) => {
        const mine = stores.filter((row) => row.region === r.region);
        return Object.assign({ stores: shops[r.region] ? shops[r.region].stores : mine.length, held: mine.length, window: mine.length ? sum(mine, 'window_s') / mine.length : 0 }, r);
      }).filter((r) => r.held).sort((p, q) => q.exposed - p.exposed);
      const total = split.exposed + split.coping, top = regions[0];
      ctx.voice();

      if (!above.length || !top) {
        a.p(`${ctx.g(`No adjustment is needed: no exposed store is above the ${limit}-sec window limit this week`, 'hold', 'promo', 'allocate', 'spread', 'skill:promo-playbook', 'skill:ontology')}${daysSoFar(t)}. The ${item} earns ${usd(sales.net)} a day net; keep full weight everywhere.`);
        return;
      }
      a.p(`${ctx.g(`Hold full weight behind ${pct(split.coping / total * 100)} of the promo's revenue and re-aim the rest`, 'promo', 'allocate', 'skill:promo-playbook')}. The ${item} earns ${usd(sales.net)} a day net. ` +
        `${usd(fmt.round(split.coping, -1))} of it comes from the ${n(sum(rest, 'stores'))} stores with parallel staging, which are ${worst <= 0 ? 'inside benchmark' : `inside benchmark or within ${n(worst)} sec of it`}. ` +
        `${ctx.g(`${usd(fmt.round(split.exposed, -1))} a day comes from the ${X.count} exposed single-lane stores`, 'allocate', 'glossary:combo-revenue', 'glossary:parallel-staging')}, ` +
        `${above.length === stores.length ? `all of them above the ${limit}-sec window limit` : `${n(above.length)} of them above the ${limit}-sec window limit`} this week${daysSoFar(t)}.`);
      a.listed(`${ctx.g('Where the exposed revenue sits', 'allocate', 'hold', 'stores', 'skill:ontology')} (the revenue table stops at region, so it is allocated by ${item} orders):`,
        regions.map((r) => `${r.region}: ${r.held} of ${r.stores} stores, ${n(r.window)} sec at the window, ${usd(fmt.round(r.exposed, -1))} a day (${pct(r.share)} of the region's ${item} revenue).`));
      a.listed('The promo playbook\'s three moves:', [
        `${ctx.g(`Keep full weight at ${play.push_where}`, 'skill:promo-playbook', 'spread')}.`,
        `Around ${play.hold_where}, shift drive-thru demand away from the peak: push the offer in the app, for dine-in and off-peak. ${ctx.g(`That is mostly a ${top.region} job`, 'allocate', 'hold')}: ${pct(top.share)} of its ${item} revenue is at exposed stores.`,
        `${ctx.g(`Resume normal weight store by store once window time is back under ${limit} sec`, 'skill:promo-playbook', 'hold')}.`
      ], true);
      a.p(`Do not pull the promotion: this is a kitchen problem in ${X.count} of ${n(sum(f.rows, 'stores'))} stores.`);
      ctx.facts = { split: { exposed: split.exposed, coping: split.coping }, regions, above: above.length };
    }
  });

  // ===================================================================
  // What if we paused Double Stack at single-lane stores — what's the revenue impact?
  // ===================================================================
  MCX.analysis('diego/pause-double-stack', {
    title: 'What-if: pausing the Double Stack', intent: 'predictive', scope: 'network',
    terms: ['double-stack', 'revenue-at-risk', 'combo-revenue', 'parallel-staging'],
    skills: ['what-if-analysis', 'ops-playbook'],
    models: ['COMBO_REVENUE_DAILY', 'DAILY_SALES_FACT', 'ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM'],
    bare(b, kit) {
      const item = rawItem(b);
      if (!item.SKU_ID) { kit.limit(b, `${b.b("I can't find the Double Stack in RAW_MENU_ITEMS")}, so I cannot size a pause.`); return; }
      const regions = rawRegions(b, item, 'Pull what the item sells, to size what a pause would give up.');
      b.say('Two raw columns both read as revenue — gross and net of discounts — and no definition tells me which one finance means. Picking one blind.', { hold: true });
      b.q('raw_revenue_columns', `PRAGMA BRONZE.table_info('RAW_COMBO_REVENUE_DAILY')`, 'Try to split that by store — check what the revenue table is keyed on.');
      const lanes = kit.index(b.q('raw_store_lanes', `
        SELECT LANE_TYPE, COUNT(*) AS stores
        FROM BRONZE.RAW_STORES
        WHERE IS_ACTIVE = TRUE
        GROUP BY LANE_TYPE`, 'Count single-lane stores, since revenue cannot be tied to them directly.'), 'LANE_TYPE');
      const days = regions.length ? regions[0].days : 1, weekly = (column) => sum(regions, column) / days * 7;
      const single = lanes.single_lane ? lanes.single_lane.stores : 0, all = single + (lanes.dual_lane ? lanes.dual_lane.stores : 0);
      const guess = all ? weekly('net_rev') * single / all : 0;
      kit.ask(b, `What a pause gives up. The Double Stack brings in about ${k(weekly('gross_rev'))} a week gross, or ${k(weekly('net_rev'))} net of discounts, and ${b.b("I don't know which one you count")}. ` +
        `RAW_COMBO_REVENUE_DAILY is by item, region and day with no store column, so I can't isolate single-lane stores. If every store sells the same amount, the ${n(single)} single-lane stores would be about ${k(guess)} a week. ${b.b('That assumption is probably wrong')}.`);
      kit.ask(b, `What a pause gains. I'd need to know how much faster those stores get without the item, and what a second of drive-thru time is worth. The raw warehouse has no model for either. ${b.b("I'd be inventing a number")}.`);
      kit.ask(b, `Which stores. RAW_STORES has lane type, so I can list ${n(single)} single-lane stores. Nothing tells me whether all of them are struggling.`);
      kit.fact(b, `The only firm number I have is the cost: roughly ${k(guess)} a week of Double Stack sales, give or take the gross-versus-net question.`);
      kit.limit(b, `I can tell you what a pause would cost. ${b.b("I can't tell you what it would save")}, so I can't tell you whether it is worth doing. With a calibrated what-if model and store-level sales, this becomes a real low, central and high estimate.`);
    },
    run(ctx) {
      const t = ctx.time, a = ctx.answer;
      const X = E.group(ctx, 'exposed');
      const item = shortItem(t.launch.item), model = ctx.params('what-if-analysis'), rule = model.loss_rule, play = ctx.params('ops-playbook');
      const stage = model.pre_stage_secs, crew = model.crew_forward_secs;

      ctx.say('Walking the what-if model against the certified GOLD tables.');
      const sales = promo(ctx, { say: `What a pause gives up: net ${item} revenue per day since launch, by region.` });
      const split = allocate(ctx, sales, { say: `The revenue table stops at region, so allocate it to kitchen formats by their share of each region's ${item} orders.` });
      const now = E.risk(ctx, { where: { week: 'this', lane: 'single_lane' }, say: 'What a pause could win back: revenue at risk this week at every single-lane store, with the what-if rule.' });
      const pre = E.risk(ctx, { key: 'baseline', by: ['operator_name'], where: { from: t.baseline.from, to: t.baseline.to, exposed: true },
        say: 'And what those stores would go back to: the same rule on the 30 days before launch.' });
      ctx.say(`The ops playbook puts pre-staging (${stage.join('–')} sec) and a crew member forward (${crew.join('–')} sec) ahead of any pause. No step makes a kitchen faster than it was before the launch.`, { hold: true });

      const hit = now.hit.filter((row) => E.formatOf(row) === 'exposed'), spared = now.rows.filter((row) => E.formatOf(row) === 'retrofitted');
      const atRisk = sum(hit, 'weekly_rev_at_risk'), stays = sum(pre.hit, 'weekly_rev_at_risk'), won = atRisk - stays;
      const lost = split.exposed * 7, net = { low: won * model.low_case_peak_share - lost, central: won - lost, high: won * model.high_case - lost };
      const floor = {};
      pre.rows.forEach((row) => { floor[row.store_name] = row.secs_vs_benchmark; });
      const steps = [atRisk - riskAfter(rule, hit, floor, stage[0] + crew[0]), atRisk - riskAfter(rule, hit, floor, stage[1] + crew[1])];
      const owners = [];
      pre.hit.forEach((row) => { if (owners.indexOf(row.operator_name) === -1) owners.push(row.operator_name); });
      ctx.voice();

      if (!hit.length) {
        a.p(`${ctx.g(`A pause would only cost money: about ${k(lost)} a week of net ${item} revenue`, 'promo', 'allocate', 'quantify', 'baseline', 'skill:what-if-analysis', 'skill:ops-playbook')}. No single-lane store is more than ${rule.ignore_within_secs} sec over benchmark this week${daysSoFar(t)}, so there is no drive-thru revenue to win back.`);
        return;
      }
      a.p(`${ctx.g(`Pausing at the ${hit.length} exposed single-lane stores nets about ${signedK(net.central)} a week`, 'quantify', 'baseline', 'allocate', 'skill:what-if-analysis')} (range ${signedK(net.low)} to ${signedK(net.high)}). ` +
        `It is still the wrong first move: the ops playbook's first two steps recover about as much and give up nothing.`);
      a.listed(`Per week, at those ${hit.length} stores${daysSoFar(t)}:`, [
        `Given up: ${ctx.g(`${k(lost)} of net ${item} revenue, ${pct(split.exposed / sales.net * 100)} of the ${k(sales.weekly)} it earns`, 'promo', 'allocate', 'glossary:combo-revenue')}. The revenue table stops at region, so this is allocated by ${item} orders.`,
        `Won back: ${ctx.g(`${k(won)} of the ${k(atRisk)} of drive-thru revenue at risk`, 'quantify', 'baseline', 'glossary:revenue-at-risk')}, as the stores return to their pre-launch times (low ${k(won * model.low_case_peak_share)}, high ${k(won * model.high_case)}).` +
          (stays > 0 ? ` The other ${k(stays)} was at risk before the launch${owners.length === 1 ? `, at ${fmt.possessive(owners[0])} stores` : ''}.` : ''),
        `Net: about ${signedK(net.central)}.`
      ]);
      a.listed('Two cautions:', [
        spared.length ? `Not every single-lane store. ${ctx.g(`${cap(word(spared.length))} of the ${n(now.rows.length)} have a parallel prep station and are ${n(sum(spared, 'secs_vs_benchmark') / spared.length)} sec over benchmark`, 'quantify', 'glossary:parallel-staging')}; ` +
          `pausing there gives up ${k(split.retrofitted * 7)} a week for nothing.` : null,
        `${ctx.g('The ops playbook never pulls an item before pre-staging and moving a crew member forward have been tried', 'skill:ops-playbook')}. ` +
          `On the what-if model ${ctx.g(`those two steps win back ${kRange(steps[0], steps[1])} a week`, 'quantify', 'baseline', 'skill:what-if-analysis')} and keep the ${k(lost)}.`
      ], true);
      a.p(`Assumptions: traffic stays flat, and a customer who cannot buy a ${item} buys nothing in its place, so the ${k(lost)} is a ceiling. Review after ${word(play.review_after_trading_days)} trading days of pre-staging before considering a pause.`);
      ctx.facts = { lost, atRisk, stays, won, net, steps, spared: spared.length };
    }
  });

  // ===================================================================
  // What if we delay the next LTO by 2 weeks?
  // ===================================================================
  MCX.analysis('diego/delay-next-lto', {
    title: 'What-if: delaying the next LTO', intent: 'predictive', scope: 'network',
    terms: ['lto', 'parallel-staging', 'retrofit-kit'],
    skills: ['launch-readiness', 'what-if-analysis', 'retrofit-planning'],
    models: ['MENU_CHANGE_LOG', 'ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM', 'DC_STOCK_FACT'],
    bare(b, kit) {
      const weeks = weeksAsked(b, 'diego/delay-next-lto');
      const max = kit.latest(b, 'RAW_POS_DAILY');
      const next = b.q('raw_next_lto', `
        SELECT SKU_ID, ITEM_NAME, LAUNCH_DATE
        FROM BRONZE.RAW_MENU_ITEMS
        WHERE IS_LTO = TRUE
          AND LAUNCH_DATE > '${max}'
        ORDER BY LAUNCH_DATE`, 'Find "the next LTO" — future-dated limited-time items in the raw menu table.');
      if (!next.length) { kit.limit(b, `${b.b('RAW_MENU_ITEMS has no future-dated limited-time item')}, so I cannot tell which launch you mean.`); return; }
      if (next.length > 1) b.say(`${cap(word(next.length))} future-dated limited-time items, and nothing says which one is "next" for planning purposes.`);
      const rate = b.one('raw_lto_run_rate', `
        SELECT m.ITEM_NAME,
               COUNT(DISTINCT c.DATE)                                           AS days,
               ROUND(SUM(c.GROSS_REVENUE_USD) / COUNT(DISTINCT c.DATE) * 7, 0)  AS gross_per_week,
               ROUND(SUM(c.NET_REVENUE_USD) / COUNT(DISTINCT c.DATE) * 7, 0)    AS net_per_week
        FROM BRONZE.RAW_COMBO_REVENUE_DAILY c
        JOIN BRONZE.RAW_MENU_ITEMS m ON m.SKU_ID = c.SKU_ID
        WHERE m.IS_LTO = TRUE
        GROUP BY m.ITEM_NAME
        ORDER BY days DESC`, 'Use the current limited-time item\'s sales as a stand-in for what the delay is worth.');
      const moved = (rate.gross_per_week || 0) * weeks, span2 = weeks === 1 ? 'a week' : `${word(weeks)} weeks`;
      kit.ask(b, `Which LTO? RAW_MENU_ITEMS has ${next.length === 1 ? 'one future-dated limited-time item' : `${word(next.length)} future-dated limited-time items`}: ${list(next.map((row) => `${row.ITEM_NAME} on ${date(row.LAUNCH_DATE)}`))}. ` +
        (next.length > 1 ? `${b.b("I'm assuming you mean the first one")}.` : 'I am taking that one.'));
      kit.ask(b, `What is ${span2} worth? There is no forecast for an item that has not launched. As a stand-in I used the ${rate.ITEM_NAME}'s run rate, about ${k(rate.gross_per_week || 0)} a week gross, which makes the delay roughly ${k(moved)} of sales pushed back. ${b.b('A different kind of item could sell very differently')}.`);
      kit.ask(b, `Why delay? ${b.b("I don't know what the delay is meant to fix")}. If it is kitchen speed, the raw tables cannot tell me which stores would struggle with the new item, or by how much.`);
      kit.fact(b, `What I can offer is one side of the trade: about ${k(moved)} of sales moved ${span2} later, if ${next[0].ITEM_NAME} sells like the last limited-time item.`);
      kit.limit(b, `I can't say whether that is a good trade, because ${b.b("I can't see what you'd be buying with it")}. With the launch calendar, a readiness rule and a what-if model, this becomes a real low, central and high estimate.`);
    },
    run(ctx) {
      const t = ctx.time, a = ctx.answer, next = t.nextLaunch;
      const rule = ctx.params('launch-readiness'), model = ctx.params('what-if-analysis'), plan = ctx.params('retrofit-planning');
      const limit = rule.max_window_secs, weeks = weeksAsked(ctx, 'diego/delay-next-lto');

      ctx.say('Walking the launch-readiness rule and the what-if model against the certified GOLD tables.');
      const menu = E.menu(ctx, { key: 'calendar', planned: true, say: 'Find the next planned launch on the menu change log, and what it asks of a kitchen.' });
      const event = next && menu.planned.filter((row) => row.event_date === next.date)[0];
      if (!event) {
        ctx.voice();
        a.p(`${ctx.g(`No launch is planned after ${date(t.maxDate)}`, 'calendar', 'glossary:lto', 'skill:launch-readiness', 'skill:what-if-analysis', 'skill:retrofit-planning')} on the menu change log, so there is nothing to delay.`);
        return;
      }
      const stores = E.stores(ctx, { key: 'readiness', by: ['region'], metrics: ['window_time'],
        columns: [{ sql: `CASE WHEN f.has_parallel_staging OR ${MCX.sem.metricSql(TIMING, 'window_time')} <= ${limit} THEN 1 ELSE 0 END`, as: 'ready' }], order: 'ready, window_s DESC',
        say: `Apply the readiness rule to every kitchen this week: parallel staging, or window time at or under ${limit} sec.` });
      const groups = exposedByRegion(ctx, { say: 'What pre-staging can do by the launch date: exposed kitchens by region, the 30 days before launch against this week.' });
      const kitName = (/=\s*'([^']+)'/.exec(ctx.term('retrofit-kit').maps_to) || [])[1];
      const kits = ctx.q('kits', { model: 'DC_STOCK_FACT', by: ['dc_name', 'region', 'on_hand', 'lead_time_days'], where: { eq: { item: kitName } }, order: 'dc.on_hand DESC' },
        'The structural fix: retrofit kits in stock and the supplier lead time, against the two dates.');

      // Readiness today, and what each date allows.
      const planned = event.event_date, delayed = fmt.addDays(planned, weeks * 7), delay = weeks === 1 ? 'one-week' : `${word(weeks)}-week`;
      const pass = stores.filter((row) => row.ready), fail = stores.filter((row) => !row.ready);
      const names = [];
      stores.forEach((row) => { if (names.indexOf(row.region) === -1) names.push(row.region); });
      const regions = names.map((region) => ({ region, stores: stores.filter((row) => row.region === region).length, ready: pass.filter((row) => row.region === region).length }))
        .sort((p, q) => q.ready / q.stores - p.ready / p.stores);
      const staged = groups.map((g) => project(g, model.pre_stage_secs));
      const afterStage = staged.length ? [Math.min.apply(null, staged.map((p) => p.window[0])), Math.max.apply(null, staged.map((p) => p.window[1]))] : [0, 0];
      const extra = model.second_two_step_item_secs, withSecond = [afterStage[0] + extra[0], afterStage[1] + extra[1]];
      const need = fail.length, onHand = sum(kits, 'on_hand'), lead = kits.length ? Math.max.apply(null, kits.map((row) => row.lead_time_days)) : 0;
      const perNight = plan.install_crews * plan.installs_per_crew_per_night, fromStock = Math.min(need, onHand), toOrder = need - fromStock;
      const stockDone = fmt.addDays(t.maxDate, plan.ship_days + Math.ceil(fromStock / perNight));
      const arrive = fmt.addDays(t.maxDate, lead), allDone = toOrder ? fmt.addDays(arrive, Math.ceil(toOrder / perNight)) : stockDone;
      const firstWave = pass.length + (stockDone <= planned ? fromStock : 0) + (allDone <= planned ? toOrder : 0), late = stores.length - firstWave;
      const steps = twoSteps(event);
      ctx.voice();

      if (!need) {
        a.p(`${ctx.g(`No delay is needed: all ${n(stores.length)} kitchens pass the launch-readiness rule today`, 'readiness', 'calendar', 'skill:launch-readiness', 'skill:what-if-analysis', 'skill:retrofit-planning')}. ${event.item_name} can launch on ${date(planned)} as planned.`);
        return;
      }
      a.p(allDone <= planned
        ? `${ctx.g(`A ${delay} delay is not needed`, 'readiness', 'kits', 'skill:launch-readiness')}: every kitchen that fails the readiness rule today can be fitted with a parallel prep station by ${date(allDone)}, before the planned date.`
        : `${ctx.g(`A blanket ${delay} delay holds back ${n(pass.length)} ready kitchens to protect ${n(need)}`, 'readiness', 'skill:launch-readiness')}. Split the launch instead: ${date(planned)} where kitchens are ready, the rest as they are fitted.`);
      a.p(`${ctx.g(`Next on the calendar is ${event.item_name}, planned for ${date(planned)}`, 'calendar', 'glossary:lto')}. ` +
        `${event.requires_two_step_prep ? `Like the ${shortItem(t.launch.item)} it is two-step prep${steps ? ` (${steps})` : ''}` : 'It is single-step prep'}, flagged ${event.ops_impact_level} ops impact.`);
      a.p(`The readiness rule (parallel staging, or window time at or under ${limit} sec) ${ctx.g(`passes ${n(pass.length)} of ${n(stores.length)} kitchens today`, 'readiness', 'skill:launch-readiness', 'glossary:parallel-staging')}: ` +
        `${oncePer(regions, (r) => `${r.ready} of ${r.stores} in the ${r.region}`, (r) => `${r.ready} of ${r.stores} in the ${r.region}`)}. ` +
        `The ${n(need)} that fail are single-lane kitchens without parallel staging, at ${span(Math.min.apply(null, fail.map((row) => row.window_s)), Math.max.apply(null, fail.map((row) => row.window_s)))} sec this week${daysSoFar(t)}.`);
      a.listed(`What the extra ${weeks === 1 ? 'week' : `${word(weeks)} weeks`} would change for those ${n(need)}:`, [
        event.requires_two_step_prep
          ? `Pre-staging alone brings them back to ${span(afterStage[0], afterStage[1])} sec by ${date(planned)}, but ${ctx.g(`a second two-step item adds ${extra.join('–')} sec on a lane that is not fixed`, 'exposed', 'skill:what-if-analysis')}: ` +
            `${span(withSecond[0], withSecond[1])} sec, ${withSecond[0] > limit ? 'over the limit again' : 'at or over the limit'}. More time does not change that.`
          : `Pre-staging alone brings them back to ${ctx.g(`${span(afterStage[0], afterStage[1])} sec by ${date(planned)}`, 'exposed', 'skill:what-if-analysis')}, and a single-step item adds nothing at the window.`,
        `Parallel prep stations do. ${ctx.g(`${n(fromStock)} retrofit ${fromStock === 1 ? 'kit is' : 'kits are'} in stock`, 'kits', 'skill:retrofit-planning', 'glossary:retrofit-kit')}` +
          (toOrder ? ` and the other ${n(toOrder)} ${toOrder === 1 ? 'is' : 'are'} ${n(lead)} days from the supplier, arriving ${date(arrive)}. With ${word(plan.install_crews)} crews fitting one kitchen a night each, all ${n(need)} are done by ${date(allDone)}: ` +
            (allDone <= planned ? 'before the planned date.' : allDone <= delayed ? `too late for ${date(planned)}, well inside ${date(delayed)}.` : `after ${date(delayed)} as well.`)
            : `, enough for all ${n(need)}: fitted by ${date(stockDone)}.`)
      ]);
      a.p(allDone <= planned ? `For the campaign: keep the ${date(planned)} date, on condition the kits are ordered now.`
        : `For the campaign: ${ctx.g(`plan two waves, not a later date`, 'readiness', 'kits', 'skill:retrofit-planning')}. ${n(firstWave)} kitchens can launch on ${date(planned)}; ` +
          (allDone <= delayed ? `the last ${n(late)} need ${n(fmt.daysBetween(planned, allDone))} more days, not ${weeks * 7}.` : `the last ${n(late)} follow by ${date(allDone)}.`));
      ctx.facts = { planned, delayed, pass: pass.length, need, afterStage, withSecond, onHand, toOrder, arrive, allDone, firstWave };
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
