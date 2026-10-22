/* =====================================================================
   warehouse/seed.js — turn the world into tables

   Reads warehouse/world.js and produces every row of the demo warehouse:

     GOLD    certified tables the context layer describes
     BRONZE  the raw tables underneath: same facts, no definitions,
             a few traps (closed stores, free-text categories, two columns
             that both look like "drive-thru time")

   The data is deterministic: no random numbers, so every load gives the
   same warehouse and every answer can be checked by hand.

   MCX.warehouse.tables()  -> [{ schema, name, columns: [[name, type]], rows: [[...]] }]
   MCX.warehouse.load(db)  -> creates and fills the tables in a sql.js database
   ===================================================================== */
(function (global) {
  'use strict';
  var MCX = (global.MCX = global.MCX || {});
  var W = MCX.world;

  // ---- Dates (all UTC, ISO strings) ----------------------------------------
  function toDate(s) { var p = s.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function addDays(s, n) { var d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); }
  function daysBetween(a, b) { return Math.round((toDate(b) - toDate(a)) / 86400000); }
  function range(from, to) { var out = []; for (var d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; }
  function weekday(s) { return (toDate(s).getUTCDay() + 6) % 7; }           // 0 = Monday
  function weekStart(s) { return addDays(s, -weekday(s)); }

  // A small day-to-day wobble. Monday–Wednesday sums to zero and so does
  // Thursday–Sunday, so weekly and part-week averages land on round numbers.
  var WOBBLE = [1, -1, 0, 1, -1, 1, -1];
  function wobble(day, sign) { return WOBBLE[weekday(day)] * sign; }
  function round(x, d) { var p = Math.pow(10, d || 0); return Math.round(x * p) / p; }

  var THIS_YEAR = range(W.firstDay, W.lastDay);
  var LAST_YEAR = range(W.lastYear.firstDay, W.lastYear.lastDay);

  // ---- Stores ------------------------------------------------------------------
  var KIND = { x: ['single_lane', false], p: ['single_lane', true], d: ['dual_lane', true] };
  var VARIATION = [12, -6, 0, 6, -12];

  function buildStores() {
    var stores = [];
    W.operators.forEach(function (op) {
      var counts = { x: 0, p: 0, d: 0 }, seen = { x: 0, p: 0, d: 0 };
      op.stores.forEach(function (s) { counts[s[3]]++; });
      op.stores.forEach(function (s) {
        var kind = s[3], extra = s[4] || {}, i = seen[kind]++, n = stores.length;
        var lane = KIND[kind][0];
        stores.push({
          id: 'S' + String(n + 1).padStart(3, '0'),
          name: s[0], city: s[1], state: s[2], region: op.region,
          operator: op, kind: kind, lane: lane, staging: KIND[kind][1],
          orders: extra.orders != null ? extra.orders : W.ordersPerDay[lane] + VARIATION[i % VARIATION.length],
          offset: extra.offset != null ? extra.offset : W.spread[counts[kind]][i],
          sign: n % 2 ? 1 : -1,
          opened: (2004 + (n * 7) % 18) + '-' + String(1 + (n * 5) % 12).padStart(2, '0') + '-' + String(1 + (n * 11) % 27).padStart(2, '0'),
          active: true
        });
      });
    });
    return stores;
  }
  var STORES = buildStores();

  // ---- Drive-thru timing for one store on one day --------------------------------
  function timing(store, day, lastYear) {
    var op = store.operator, kind = store.kind;
    var week = lastYear ? 0 : Math.floor(daysBetween(W.firstDay, day) / 7);
    var after = !lastYear && day >= W.launchDay;
    var effect = W.launchEffect[store.region];
    var rush = (W.launchRush[day] || 0);

    var order = W.parts.order;
    var prep = (op.prep && op.prep[kind] != null ? op.prep[kind] : (kind === 'x' ? W.parts.prep : kind === 'p' ? W.parts.prep - 1 : W.parts.prep + 2));
    if (!lastYear && op.prepDrift && op.prepDrift[kind]) prep += op.prepDrift[kind][Math.min(week, op.prepDrift[kind].length - 1)];
    var windowSecs = W.parts.window;

    if (kind === 'x') {
      prep += Math.round(store.offset / 3);
      if (after) { prep += effect.prep; windowSecs += effect.window + Math.round(rush * effect.window / 30) + store.offset; }
    } else {
      prep += store.offset;
      if (after) windowSecs += kind === 'd' ? W.stagedEffect.dual_lane : W.stagedEffect.retrofitted;
    }
    var n = wobble(day, store.sign);
    windowSecs += 2 * n; prep -= n;

    var total = order + prep + windowSecs;
    var benchmark = W.benchmark[store.lane];
    var over = total - benchmark;
    var rule = W.inside[kind === 'x' ? 'exposed' : kind === 'p' ? 'retrofitted' : 'dual_lane'];
    var inside;
    if (kind === 'x') inside = Math.max(rule.floor, rule.base - rule.perSecOver * Math.max(0, over - 1));
    else if (kind === 'p') inside = rule.base - rule.perSecOver * Math.max(0, over);
    else inside = rule.base - rule.perSecCloser * Math.max(0, over - rule.comfortable) - (after ? rule.afterLaunch : 0);
    inside = round(inside + 0.004 * n, 3);

    return {
      order: order, prep: prep, window: windowSecs, total: total, benchmark: benchmark, over: over, inside: inside,
      orders: Math.round(store.orders * (1 + 0.02 * n)), after: after, week: week
    };
  }

  function weather(region, day, lastYear) {
    var rain = (!lastYear && W.rain[region] && W.rain[region][day]) || 0;
    var span = W.temperature[region];
    var first = lastYear ? W.lastYear.firstDay : W.firstDay;
    var temp = Math.round(span[0] + (span[1] - span[0]) * daysBetween(first, day) / 58 + WOBBLE[weekday(day)]);
    return { rain: rain, temp: temp, condition: rain > 0.05 ? 'rain' : (weekday(day) % 3 === 0 ? 'cloudy' : 'clear') };
  }

  function fillRate(store, day) {
    var op = store.operator;
    var week = Math.floor(daysBetween(W.firstDay, day) / 7);
    var base = op.fillByWeek ? op.fillByWeek[Math.min(week, op.fillByWeek.length - 1)] : op.fill - (day >= W.launchDay ? 0.003 : 0);
    return round(base + 0.002 * wobble(day, store.sign), 3);
  }

  // ---- Tables ----------------------------------------------------------------------
  function tables() {
    var T = [];
    function table(schema, name, columns) {
      var t = { schema: schema, name: name, columns: columns, rows: [] };
      T.push(t);
      return t.rows;
    }

    // --- GOLD: stores -------------------------------------------------------------
    var dim = table('GOLD', 'FRANCHISE_STORE_DIM', [['store_id', 'TEXT'], ['store_name', 'TEXT'], ['city', 'TEXT'], ['state', 'TEXT'], ['region', 'TEXT'],
      ['operator_id', 'TEXT'], ['operator_name', 'TEXT'], ['lane_type', 'TEXT'], ['has_parallel_staging', 'BOOLEAN'], ['opened_date', 'TEXT']]);
    STORES.forEach(function (s) { dim.push([s.id, s.name, s.city, s.state, s.region, s.operator.id, s.operator.name, s.lane, s.staging ? 1 : 0, s.opened]); });

    // --- GOLD + BRONZE: drive-thru timing, sales, staffing, complaints ----------------
    var mart = table('GOLD', 'ORDER_TIMING_MART', [['store_id', 'TEXT'], ['date', 'TEXT'], ['week_start', 'TEXT'], ['avg_dt_secs', 'REAL'], ['avg_order_time_secs', 'REAL'],
      ['avg_prep_time_secs', 'REAL'], ['avg_window_time_secs', 'REAL'], ['benchmark_dt_secs', 'REAL'], ['secs_vs_benchmark', 'REAL'], ['pct_within_benchmark', 'REAL'],
      ['is_above_benchmark', 'BOOLEAN'], ['total_dt_transactions', 'INTEGER'], ['precipitation_in', 'REAL'], ['avg_temp_f', 'REAL'], ['weather_condition', 'TEXT']]);
    var sales = table('GOLD', 'DAILY_SALES_FACT', [['store_id', 'TEXT'], ['date', 'TEXT'], ['total_transactions', 'INTEGER'], ['dt_transactions', 'INTEGER'], ['avg_ticket_usd', 'REAL'],
      ['total_revenue_usd', 'REAL'], ['combo_transactions', 'INTEGER'], ['non_combo_transactions', 'INTEGER'], ['double_stack_transactions', 'INTEGER'], ['combo_attach_rate', 'REAL']]);
    var staffing = table('GOLD', 'STAFFING_DAILY_FACT', [['store_id', 'TEXT'], ['date', 'TEXT'], ['scheduled_crew_hours', 'REAL'], ['worked_crew_hours', 'REAL'], ['shift_fill_rate', 'REAL'], ['crew_hours_per_100_tx', 'REAL']]);
    var tickets = table('GOLD', 'CARE_TICKET_FACT', [['ticket_id', 'TEXT'], ['date', 'TEXT'], ['store_id', 'TEXT'], ['channel', 'TEXT'], ['category', 'TEXT'], ['wait_location', 'TEXT'],
      ['mentions_double_stack', 'BOOLEAN'], ['about_item', 'TEXT'], ['handle_minutes', 'INTEGER']]);

    var rawTiming = table('BRONZE', 'RAW_ORDER_TIMING_DAILY', [['STORE_ID', 'TEXT'], ['DATE', 'TEXT'], ['AVG_DT_SECS', 'REAL'], ['AVG_ORDER_TIME_SECS', 'REAL'], ['AVG_PREP_TIME_SECS', 'REAL'], ['AVG_WINDOW_TIME_SECS', 'REAL'], ['TOTAL_DT_TRANSACTIONS', 'INTEGER']]);
    var rawPos = table('BRONZE', 'RAW_POS_DAILY', [['STORE_ID', 'TEXT'], ['DATE', 'TEXT'], ['TOTAL_REVENUE_USD', 'REAL'], ['TOTAL_TRANSACTIONS', 'INTEGER'], ['AVG_SERVICE_SECS', 'REAL']]);
    var rawStaffing = table('BRONZE', 'RAW_STAFFING_DAILY', [['STORE_ID', 'TEXT'], ['DATE', 'TEXT'], ['HEADCOUNT', 'INTEGER'], ['SCHEDULED_HOURS', 'REAL'], ['WORKED_HOURS', 'REAL']]);
    var rawTickets = table('BRONZE', 'RAW_SUPPORT_TICKETS', [['TICKET_ID', 'TEXT'], ['CREATED_AT', 'TEXT'], ['STORE_REF', 'TEXT'], ['CHANNEL', 'TEXT'], ['CATEGORY_TEXT', 'TEXT'], ['BODY_SNIPPET', 'TEXT']]);

    var care = W.care;
    var WAIT_LABELS = ['Wait time', 'slow service', 'long wait', 'drive thru slow', 'Wait Time', 'wait', 'line too long', 'DT wait'];
    var WAIT_BODIES = ['Sat in the drive-thru line for ten minutes.', 'Line at the window was not moving.', 'Took far too long to get my order at the window.', 'Waited ages inside for my food.'];
    var OTHER_LABELS = { order_accuracy: ['order wrong', 'missing item'], food_quality: ['cold food', 'food quality'], staff: ['rude staff', 'staff'], app: ['app issue', 'waited for refund'], other: ['other', 'feedback'] };
    var waitCarry = {}, otherCarry = {}, ticketNo = 0, waitNo = 0, qualityNo = 0, itemComplaints = 0;
    STORES.forEach(function (s, i) { waitCarry[s.id] = ((i * 37) % 100) / 100; otherCarry[s.id] = ((i * 53) % 100) / 100; });

    function pick(list, n) {            // list of [value, percent]; n is a running counter
      var at = (n * 37) % 100, sum = 0;
      for (var i = 0; i < list.length; i++) { sum += list[i][1]; if (at < sum) return list[i][0]; }
      return list[list.length - 1][0];
    }

    function addDay(day, lastYear) {
      STORES.forEach(function (s) {
        var t = timing(s, day, lastYear), w = weather(s.region, day, lastYear);
        mart.push([s.id, day, weekStart(day), t.total, t.order, t.prep, t.window, t.benchmark, t.over, t.inside, t.over > 0 ? 1 : 0, t.orders, w.rain, w.temp, w.condition]);
        rawTiming.push([s.id, day, t.total, t.order, t.prep, t.window, t.orders]);
        if (lastYear) return;

        var total = Math.round(t.orders / W.driveThruShare);
        var ticket = W.ticket[s.lane];
        var attach = t.after ? 0.47 : 0.46;
        var combo = Math.round(total * attach);
        var mix = W.launchEffect[s.region].mix / 100 * (s.kind === 'd' ? 0.93 : 1);
        sales.push([s.id, day, total, t.orders, ticket, round(total * ticket, 2), combo, total - combo, t.after ? Math.round(t.orders * mix) : 0, attach]);
        rawPos.push([s.id, day, round(total * ticket, 2), total, 127 + (s.offset > 0 ? 2 : s.offset < 0 ? -2 : 0) + (t.after && s.kind === 'x' ? 1 : 0) + wobble(day, s.sign)]);

        var scheduled = (s.lane === 'single_lane' ? 96 : 118) + s.offset;
        var fill = fillRate(s, day);
        var worked = round(scheduled * fill, 1);
        staffing.push([s.id, day, scheduled, worked, fill, round(worked / total * 100, 1)]);
        rawStaffing.push([s.id, day, s.lane === 'single_lane' ? 22 : 27, scheduled, worked]);

        // Complaints: a store on benchmark gets a trickle; every second over adds to it.
        var rate = care.waitPer10k + (t.over > care.tolerance ? care.perSecOver * t.over : 0);
        waitCarry[s.id] += t.orders * rate / 10000;
        while (waitCarry[s.id] >= 1) {
          waitCarry[s.id] -= 1; ticketNo++; waitNo++;
          var where = waitNo % 25 < 21 ? 'drive_thru' : 'in_store';
          var mentions = t.after && waitNo % 9 === 4;
          var id = 'T' + String(ticketNo).padStart(6, '0');
          var channel = pick(care.channels, ticketNo);
          tickets.push([id, day, s.id, channel, 'wait_time', where, mentions ? 1 : 0, null, care.handleMinutes[ticketNo % care.handleMinutes.length]]);
          rawTickets.push([id, day + ' ' + String(8 + ticketNo % 12).padStart(2, '0') + ':' + String((ticketNo * 7) % 60).padStart(2, '0'), ticketNo % 4 === 0 ? s.name.toLowerCase() : s.name, channel,
            WAIT_LABELS[waitNo % WAIT_LABELS.length], mentions ? 'Double Stack took forever at the window.' : WAIT_BODIES[where === 'drive_thru' ? waitNo % 3 : 3]]);
        }
        otherCarry[s.id] += total * care.otherPer10k / 10000;
        while (otherCarry[s.id] >= 1) {
          otherCarry[s.id] -= 1; ticketNo++;
          var category = pick(care.otherMix, ticketNo);
          var about = null;
          if (category === 'food_quality' && t.after) {
            qualityNo++;
            if (qualityNo % 7 === 3 && itemComplaints < care.doubleStackProductComplaints) { about = W.doubleStack.name; itemComplaints++; }
          }
          var tid = 'T' + String(ticketNo).padStart(6, '0');
          var ch = pick(care.channels, ticketNo);
          tickets.push([tid, day, s.id, ch, category, null, about ? 1 : 0, about, care.handleMinutes[ticketNo % care.handleMinutes.length]]);
          rawTickets.push([tid, day + ' ' + String(8 + ticketNo % 12).padStart(2, '0') + ':' + String((ticketNo * 7) % 60).padStart(2, '0'), ticketNo % 4 === 0 ? s.name.toLowerCase() : s.name, ch,
            OTHER_LABELS[category][ticketNo % 2], about ? 'Double Stack was messy and fell apart.' : 'See ticket.']);
        }
      });
    }
    LAST_YEAR.forEach(function (day) { addDay(day, true); });
    THIS_YEAR.forEach(function (day) { addDay(day, false); });

    // --- GOLD + BRONZE: combo revenue ---------------------------------------------------
    var comboRev = table('GOLD', 'COMBO_REVENUE_DAILY', [['date', 'TEXT'], ['region', 'TEXT'], ['category', 'TEXT'], ['item_name', 'TEXT'], ['sku_id', 'TEXT'], ['is_lto', 'BOOLEAN'],
      ['gross_rev', 'REAL'], ['net_rev', 'REAL'], ['discount_amount_usd', 'REAL'], ['discount_rate', 'REAL'], ['total_units', 'INTEGER']]);
    var rawCombo = table('BRONZE', 'RAW_COMBO_REVENUE_DAILY', [['DATE', 'TEXT'], ['REGION', 'TEXT'], ['SKU_ID', 'TEXT'], ['GROSS_REVENUE_USD', 'REAL'], ['NET_REVENUE_USD', 'REAL'], ['TOTAL_UNITS', 'INTEGER']]);
    var regions = Object.keys(W.comboShare);
    function addCombos(day, lastYear) {
      var after = !lastYear && day >= W.launchDay;
      regions.forEach(function (region) {
        Object.keys(W.combos).forEach(function (item, i) {
          var c = W.combos[item];
          var net = round(c.net[after ? 1 : 0] * W.comboShare[region] * (lastYear ? 0.985 : 1) * (1 + 0.015 * wobble(day, i % 2 ? 1 : -1)), 2);
          var gross = round(net / (1 - W.comboDiscount), 2);
          comboRev.push([day, region, 'Combo', item, c.sku, 0, gross, net, round(gross - net, 2), W.comboDiscount, Math.round(net / c.price)]);
          rawCombo.push([day, region, c.sku, gross, net, Math.round(net / c.price)]);
        });
        if (after) {
          var ds = W.doubleStack;
          var dsNet = round(ds.netPerDay[region] * (1 + 0.02 * wobble(day, 1)), 2);
          var dsGross = round(dsNet / (1 - ds.launchDiscount), 2);
          comboRev.push([day, region, 'LTO', ds.name, ds.sku, 1, dsGross, dsNet, round(dsGross - dsNet, 2), ds.launchDiscount, Math.round(dsNet / ds.netPrice)]);
          rawCombo.push([day, region, ds.sku, dsGross, dsNet, Math.round(dsNet / ds.netPrice)]);
        }
      });
    }
    LAST_YEAR.forEach(function (day) { if (day >= '2025-04-07') addCombos(day, true); });
    THIS_YEAR.forEach(function (day) { addCombos(day, false); });

    // --- GOLD: menu log, item ratings ---------------------------------------------------------
    var menu = table('GOLD', 'MENU_CHANGE_LOG', [['event_date', 'TEXT'], ['event_type', 'TEXT'], ['item_name', 'TEXT'], ['sku_id', 'TEXT'], ['ops_impact_level', 'TEXT'],
      ['requires_two_step_prep', 'BOOLEAN'], ['affected_regions', 'TEXT'], ['notes', 'TEXT']]);
    W.menuLog.forEach(function (m) { menu.push([m[0], m[1], m[2], m[3], m[4], m[5] ? 1 : 0, m[6], m[7]]); });

    var ratings = table('GOLD', 'ITEM_RATING_DAILY', [['date', 'TEXT'], ['item_name', 'TEXT'], ['ratings', 'INTEGER'], ['avg_rating', 'REAL']]);
    var STARS = [4.5, 4.4, 4.3, 4.4, 4.5, 4.4, 4.3];
    THIS_YEAR.forEach(function (day) {
      ratings.push([day, 'Classic Combo', 310 + 10 * WOBBLE[weekday(day)], 4.2]);
      if (day >= W.launchDay) ratings.push([day, W.doubleStack.name, 240, STARS[weekday(day)]]);
    });

    // --- GOLD + BRONZE: kitchens ------------------------------------------------------------------
    var equipment = table('GOLD', 'KITCHEN_EQUIPMENT_DIM', [['store_id', 'TEXT'], ['equipment_type', 'TEXT'], ['model', 'TEXT'], ['quantity', 'INTEGER'], ['installed_date', 'TEXT'], ['status', 'TEXT']]);
    var rawEquipment = table('BRONZE', 'RAW_EQUIPMENT_REGISTER', [['ASSET_ID', 'TEXT'], ['STORE_ID', 'TEXT'], ['EQUIPMENT_NAME', 'TEXT'], ['STATUS', 'TEXT'], ['INSTALLED_ON', 'TEXT']]);
    var STATION_NAMES = ['PPS-1', 'Parallel prep station', '2nd prep line', 'prep stn (parallel)'];
    var asset = 0, retro = 0;
    function addAsset(storeId, name, status, installed) { asset++; rawEquipment.push(['A' + String(asset).padStart(5, '0'), storeId, name, status, installed]); }
    STORES.forEach(function (s, i) {
      var dual = s.lane === 'dual_lane';
      equipment.push([s.id, 'grill', 'FlatTop 36', 2, s.opened, 'active']); addAsset(s.id, 'Flat-top grill', 'active', s.opened);
      equipment.push([s.id, 'fryer', 'CrispLine 2', dual ? 3 : 2, s.opened, 'active']); addAsset(s.id, 'Fryer bank', 'active', s.opened);
      equipment.push([s.id, 'holding_pan', 'HeatHold 4', dual ? 6 : 4, s.opened, 'active']); addAsset(s.id, 'Holding pans', 'active', s.opened);
      if (s.kind === 'd') {
        equipment.push([s.id, 'parallel_prep_station', 'PPS-1 (built in)', 1, s.opened, 'active']);
        addAsset(s.id, STATION_NAMES[i % STATION_NAMES.length], 'active', s.opened);
        if (i % 14 === 3) addAsset(s.id, 'Parallel prep station', 'decommissioned', '2014-06-01'); // an old unit nobody removed from the register
      } else if (s.kind === 'p') {
        var day = addDays('2026-02-10', retro++ * 3);
        equipment.push([s.id, 'parallel_prep_station', 'PPS-2 (retrofit)', 1, day, 'active']);
        addAsset(s.id, 'PPS-2', 'active', day);
      } else if (i % 9 === 0) {
        addAsset(s.id, 'Prep table', 'active', s.opened); // a plain table, not a parallel station
      }
    });

    var supply = W.supply;
    var inventory = table('GOLD', 'INVENTORY_DAILY_FACT', [['store_id', 'TEXT'], ['date', 'TEXT'], ['component', 'TEXT'], ['daily_usage_units', 'REAL'], ['on_hand_units', 'REAL'], ['days_of_cover', 'REAL'], ['stockout_hours', 'REAL']]);
    var rawInventory = table('BRONZE', 'RAW_INVENTORY_COUNTS', [['STORE_ID', 'TEXT'], ['COUNT_DATE', 'TEXT'], ['ITEM_CODE', 'TEXT'], ['ON_HAND', 'REAL'], ['UOM', 'TEXT']]);
    var launchDays = range(W.launchDay, W.lastDay);
    var shortStores = STORES.filter(function (s) { return s.region === 'Southeast' && s.kind === 'x'; }).slice(0, supply.sauce.stockoutHours.length);
    STORES.forEach(function (s, i) {
      var mix = W.launchEffect[s.region].mix / 100 * (s.kind === 'd' ? 0.93 : 1);
      var endCover = supply.sauce.cover[s.region] + ((i % 5) - 2) * 0.1;
      var shortAt = shortStores.indexOf(s);
      launchDays.forEach(function (day, d) {
        var t = timing(s, day, false);
        var usage = round(t.orders * mix / supply.sauce.ordersPerPouch, 1);
        var cover = round(supply.sauce.targetCover + (endCover - supply.sauce.targetCover) * d / (launchDays.length - 1), 1);
        var out = 0;
        if (shortAt >= 0 && (day === '2026-05-09' || day === '2026-05-10')) {
          var hours = supply.sauce.stockoutHours[shortAt];
          out = day === '2026-05-09' ? Math.ceil(hours * 0.55) : hours - Math.ceil(hours * 0.55);
          cover = 0;
        }
        inventory.push([s.id, day, supply.sauce.item, usage, round(cover * usage, 1), cover, out]);
        rawInventory.push([s.id, day, 'SS-POUCH', round(cover * usage, 1), 'pouch']);
        var patties = round(t.orders * 1.9);
        var pattyCover = round(supply.patty.cover + ((i % 3) - 1) * 0.2, 1);
        inventory.push([s.id, day, supply.patty.item, patties, round(pattyCover * patties), pattyCover, 0]);
        rawInventory.push([s.id, day, 'BP-41', round(pattyCover * patties), 'each']);
      });
    });

    var centreStock = table('GOLD', 'DC_STOCK_FACT', [['dc_name', 'TEXT'], ['region', 'TEXT'], ['item', 'TEXT'], ['on_hand', 'REAL'], ['unit', 'TEXT'], ['weekly_usage', 'REAL'],
      ['next_delivery_date', 'TEXT'], ['lead_time_days', 'INTEGER'], ['unit_cost_usd', 'REAL']]);
    var rawCentre = table('BRONZE', 'RAW_DC_STOCK', [['DC', 'TEXT'], ['ITEM_CODE', 'TEXT'], ['ON_HAND', 'REAL'], ['UOM', 'TEXT']]);
    Object.keys(supply.centres).forEach(function (region) {
      var dc = supply.centres[region];
      centreStock.push([dc, region, supply.sauce.item, supply.sauce.cases[dc], 'case', supply.sauce.weeklyCases[region], supply.sauce.nextDelivery[dc], 6, 86]);
      centreStock.push([dc, region, supply.kit.item, supply.kit.onHand[dc], 'kit', 0, null, supply.kit.leadDays, supply.kit.installedCost]);
      rawCentre.push([dc, 'SS-CASE', supply.sauce.cases[dc], 'case']);
      rawCentre.push([dc, 'PPS2-KIT', supply.kit.onHand[dc], 'kit']);
    });

    // --- BRONZE: the rest ---------------------------------------------------------------------------
    var owners = table('BRONZE', 'RAW_FRANCHISE_OWNERS', [['OPERATOR_ID', 'TEXT'], ['OPERATOR_NAME', 'TEXT'], ['REGION', 'TEXT'], ['YEARS_WITH_BRAND', 'INTEGER']]);
    W.operators.forEach(function (op) { owners.push([op.id, op.name, op.region, op.years]); });

    var rawStores = table('BRONZE', 'RAW_STORES', [['STORE_ID', 'TEXT'], ['STORE_NAME', 'TEXT'], ['CITY', 'TEXT'], ['STATE', 'TEXT'], ['LANE_TYPE', 'TEXT'], ['OPENED_DATE', 'TEXT'], ['OPERATOR_ID', 'TEXT'], ['IS_ACTIVE', 'BOOLEAN']]);
    STORES.forEach(function (s) { rawStores.push([s.id, s.name, s.city, s.state, s.lane, s.opened, s.operator.id, 1]); });
    W.closedStores.forEach(function (c, i) { rawStores.push(['S' + String(STORES.length + i + 1).padStart(3, '0'), c[0], c[1], c[2], c[3], '2009-03-01', c[4], 0]); });

    var items = table('BRONZE', 'RAW_MENU_ITEMS', [['SKU_ID', 'TEXT'], ['ITEM_NAME', 'TEXT'], ['CATEGORY', 'TEXT'], ['IS_LTO', 'BOOLEAN'], ['LAUNCH_DATE', 'TEXT']]);
    Object.keys(W.combos).forEach(function (item, i) { items.push([W.combos[item].sku, item, 'Combo', 0, (2012 + i) + '-03-01']); });
    W.menuLog.forEach(function (m) { if (m[1] !== 'ops_alert') items.push([m[3], m[2], 'LTO', 1, m[0]]); });

    var promos = table('BRONZE', 'RAW_PROMO_EVENTS', [['EVENT_DATE', 'TEXT'], ['EVENT_NAME', 'TEXT'], ['EVENT_TYPE', 'TEXT'], ['REGION', 'TEXT']]);
    W.promoEvents.forEach(function (p) { promos.push(p.slice()); });

    return T;
  }

  /** Create and fill every table in a sql.js database. Returns { tables, rows, ms }. */
  function load(db) {
    var started = Date.now(), rows = 0;
    var all = tables();
    db.run("ATTACH DATABASE ':memory:' AS GOLD; ATTACH DATABASE ':memory:' AS BRONZE;");
    db.run('BEGIN');
    all.forEach(function (t) {
      db.run('CREATE TABLE ' + t.schema + '.' + t.name + ' (' + t.columns.map(function (c) { return c[0] + ' ' + c[1]; }).join(', ') + ')');
      var insert = db.prepare('INSERT INTO ' + t.schema + '.' + t.name + ' VALUES (' + t.columns.map(function () { return '?'; }).join(',') + ')');
      t.rows.forEach(function (row) { insert.run(row); });
      insert.free();
      rows += t.rows.length;
    });
    db.run('COMMIT');
    db.run('CREATE INDEX GOLD.ix_timing ON ORDER_TIMING_MART (date, store_id); CREATE INDEX GOLD.ix_sales ON DAILY_SALES_FACT (date, store_id); CREATE INDEX BRONZE.ix_raw_timing ON RAW_ORDER_TIMING_DAILY (DATE, STORE_ID);');
    return {
      tables: all.map(function (t) { return { schema: t.schema, name: t.name, columns: t.columns.map(function (c) { return c[0]; }), rows: t.rows.length }; }),
      rows: rows,
      ms: Date.now() - started
    };
  }

  MCX.warehouse = { tables: tables, load: load, stores: STORES, dates: { addDays: addDays, weekStart: weekStart, weekday: weekday, range: range, daysBetween: daysBetween } };
})(typeof window !== 'undefined' ? window : globalThis);
