/* =====================================================================
   src/engine/bare.js — the analyst with no context layer

   Same warehouse, same question, but only what a context-free analyst
   has: the raw BRONZE tables, their column names, and the name of the
   person typing. No persona, no glossary, no playbooks, no certified
   tables, no benchmark.

   It is a competent analyst. It looks up what it can, runs real SQL and
   reports real numbers. Where it goes wrong, it goes wrong for the
   reason such analysts do: nothing tells it which of two columns is the
   metric, what "this week" means, which stores are "mine", or what
   counts as a wait-time complaint. Every query below runs on BRONZE.

   A topic procedure gathers three things and compose() writes them up:
     ask(text)     something it has to ask the person
     fact(text)    something the raw data does show
     limit(text)   what it cannot honestly conclude

   An analysis picks the topic with  bare: 'timing'  (or { topic, ... }),
   or supplies its own procedure:    bare: function (b, kit) { ... }
   ===================================================================== */
(function (global) {
  'use strict';
  var MCX = (global.MCX = global.MCX || {});
  var fmt = function () { return MCX.fmt; };

  function notes(b) { return (b.notes = b.notes || { asks: [], facts: [], limits: [] }); }
  function ask(b, text) { notes(b).asks.push(text); }
  function fact(b, text) { notes(b).facts.push(text); }
  function limit(b, text) { notes(b).limits.push(text); }
  /** Replace the closing limit a topic wrote, and drop the gap phrases that went with it. */
  function relimit(b, text) {
    var old = notes(b).limits.join(' ');
    b.answer.marks = b.answer.marks.filter(function (m) { return m.bad == null || old.indexOf(m.bad) === -1; });
    notes(b).limits = [text];
  }
  function index(rows, column) { var out = {}; rows.forEach(function (r) { out[r[column]] = r; }); return out; }

  // -------------------------------------------------------------------
  // Who is asking, and whose stores?
  // -------------------------------------------------------------------
  /**
   * Returns { kind: 'operator' | 'network' | 'unknown', operator, guessed, stores, single, dual, where }
   * `where` is a SQL condition on RAW_STORES aliased s.
   */
  function identify(b, options) {
    options = options || {};
    var f = fmt(), words = ' ' + MCX.text.normalise(b.question) + ' ';
    var owns = /\bmy (\w+[- ])?(stores?|drive thru|portfolio|kitchens?|combo|lanes?)\b|\bmine\b/.test(words);   // "my stores", not "my team"
    var firstPerson = owns || /\b(i|me)\b/.test(words);
    var who = { kind: 'network', where: 's.IS_ACTIVE = TRUE' };
    var owners = null;

    function named(row) {
      var parts = row.OPERATOR_NAME.replace(/\b[A-Z]\.\s*/g, '').split(' ');
      return [parts[0], parts[parts.length - 1]].some(function (name) { return name.length > 3 && MCX.text.hasPhrase(b.question, name); });
    }
    // Is someone named in the question? A capitalised word that is not a product, a place or a date is the only clue.
    var ordinary = /^(Double|Stack|Sauce|Honey|Heat|Chicken|Peach|Cobbler|Shake|LTO|Southeast|Midwest|Northeast|West|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|I)$/;
    var mentionsName = (b.question.match(/[a-z,] [A-Z][a-z]+/g) || []).some(function (hit) { return !ordinary.test(hit.split(' ')[1]); });
    if (firstPerson || mentionsName) {
      owners = b.q('owners', '\n  SELECT OPERATOR_ID, OPERATOR_NAME, REGION, YEARS_WITH_BRAND\n  FROM BRONZE.RAW_FRANCHISE_OWNERS\n  ORDER BY OPERATOR_ID',
        owns ? "See which operators exist in the raw data — nothing tells me which one is 'me'." : mentionsName ? 'See which operators exist in the raw data, in case the question names one.' : 'See which operators exist in the raw data — nothing tells me who is asking.');
      var match = owners.filter(named)[0];
      var guess = !match && firstPerson ? owners.filter(function (row) { return row.OPERATOR_NAME.split(' ')[0] === b.user.first; })[0] : null;
      var op = match || guess;
      if (op) {
        who = { kind: 'operator', operator: op, guessed: !match, where: "s.OPERATOR_ID = '" + op.OPERATOR_ID + "' AND s.IS_ACTIVE = TRUE" };
        var lanes = b.q('raw_stores', "\n  SELECT LANE_TYPE, COUNT(*) AS stores\n  FROM BRONZE.RAW_STORES s\n  WHERE " + who.where + '\n  GROUP BY LANE_TYPE',
          'Count the active stores owned by ' + op.OPERATOR_NAME + ', by lane type, to scope the analysis.');
        var by = index(lanes, 'LANE_TYPE');
        who.single = by.single_lane ? by.single_lane.stores : 0;
        who.dual = by.dual_lane ? by.dual_lane.stores : 0;
        who.stores = who.single + who.dual;
        who.label = (who.guessed ? 'you' : op.OPERATOR_NAME) + (who.guessed ? "'re " + op.OPERATOR_NAME : '');
        if (who.guessed) {
          ask(b, 'Whose stores are "my"? There is a ' + op.OPERATOR_NAME + ' in RAW_FRANCHISE_OWNERS with ' + who.stores + ' active ' + op.REGION + ' stores, ' +
            b.b("which I'm assuming is you") + '. Confirm or correct me.');
        }
      } else if (owns) {
        who = { kind: 'unknown', where: 's.IS_ACTIVE = TRUE', owners: owners.length };
        ask(b, 'Whose stores are "my"? I see ' + owners.length + ' operators in RAW_FRANCHISE_OWNERS and no signed-in identity, so ' + b.b("I can't tell which stores are yours") + '. I would be reporting the whole network.');
      }
    }
    who.f = f;
    return who;
  }

  /** The latest date in a raw table. */
  function latest(b, table, column, key) {
    return b.one(key || 'latest', '\n  SELECT MAX(' + (column || 'DATE') + ') AS max_date\n  FROM BRONZE.' + table,
      'Find the latest date in ' + table + ' — nothing defines "this week", so I will count back from it.').max_date;
  }

  // -------------------------------------------------------------------
  // Topics
  // -------------------------------------------------------------------
  /** Drive-thru seconds: the last 7 days against the 28 before, by lane type, on both candidate columns. */
  function timing(b, who, options) {
    options = options || {};
    var f = fmt();
    var max = latest(b, 'RAW_ORDER_TIMING_DAILY');
    var from7 = f.addDays(max, -6);
    var rows = b.q('raw_timing', "\n  SELECT CASE WHEN t.DATE > date('" + max + "', '-7 days') THEN 'last 7 days' ELSE 'prior 28 days' END AS period,\n         s.LANE_TYPE,\n         COUNT(DISTINCT t.STORE_ID)            AS stores,\n         ROUND(AVG(t.AVG_DT_SECS), 1)          AS avg_dt_secs,\n         ROUND(AVG(t.AVG_WINDOW_TIME_SECS), 1) AS avg_window_secs\n  FROM BRONZE.RAW_ORDER_TIMING_DAILY t\n  JOIN BRONZE.RAW_STORES s ON s.STORE_ID = t.STORE_ID\n  WHERE " + who.where + "\n    AND t.DATE > date('" + max + "', '-35 days')\n  GROUP BY period, s.LANE_TYPE\n  ORDER BY s.LANE_TYPE, period",
      'Pull drive-thru timing for ' + scopeWords(who) + ': the last 7 days against the 28 days before.');
    var pos = b.q('raw_pos', "\n  SELECT CASE WHEN p.DATE > date('" + max + "', '-7 days') THEN 'last 7 days' ELSE 'prior 28 days' END AS period,\n         ROUND(AVG(p.AVG_SERVICE_SECS), 1) AS avg_service_secs\n  FROM BRONZE.RAW_POS_DAILY p\n  JOIN BRONZE.RAW_STORES s ON s.STORE_ID = p.STORE_ID\n  WHERE " + who.where + "\n    AND p.DATE > date('" + max + "', '-35 days')\n  GROUP BY period\n  ORDER BY period",
      'RAW_POS_DAILY also has a service-time column. Pull it for the same stores and days.');
    b.say('Two raw columns both claim to be “drive-thru time” and they disagree — `RAW_POS_DAILY.AVG_SERVICE_SECS` and `RAW_ORDER_TIMING_DAILY.AVG_DT_SECS`. Nothing says which is authoritative — guessing.', { hold: true });

    function cell(period, lane) { return rows.filter(function (r) { return r.period === period && r.LANE_TYPE === lane; })[0] || null; }
    function blend(period, column) {
      var list = rows.filter(function (r) { return r.period === period; });
      var n = list.reduce(function (s, r) { return s + r.stores; }, 0);
      return n ? list.reduce(function (s, r) { return s + r[column] * r.stores; }, 0) / n : 0;
    }
    var now = blend('last 7 days', 'avg_dt_secs'), was = blend('prior 28 days', 'avg_dt_secs');
    var p = index(pos, 'period');
    var posNow = p['last 7 days'].avg_service_secs, posWas = p['prior 28 days'].avg_service_secs;
    var out = { max: max, from7: from7, now: now, was: was, posNow: posNow, posWas: posWas,
      single: { now: cell('last 7 days', 'single_lane'), was: cell('prior 28 days', 'single_lane') },
      dual: { now: cell('last 7 days', 'dual_lane'), was: cell('prior 28 days', 'dual_lane') } };

    ask(b, 'Which metric counts as drive-thru time for you? There are two candidates: RAW_ORDER_TIMING_DAILY.AVG_DT_SECS and RAW_POS_DAILY.AVG_SERVICE_SECS. They tell different stories. ' + b.b('Which one does your ops team report on?'));
    ask(b, 'What is the benchmark? There is no benchmark column in the raw tables. I can compare with the previous four weeks, but ' + b.b("that's a baseline I'd be inventing") + '.');
    ask(b, 'Which days do you mean? Nothing defines the reporting week, so I took the last 7 days of data (' + f.dateRange(from7, max) + ').');

    fact(b, (who.kind === 'operator' ? 'For ' + who.operator.OPERATOR_NAME + "'s " + who.stores + ' stores' : 'Across the ' + (who.kind === 'unknown' ? 'whole network' : 'network')) +
      ', AVG_DT_SECS averages ' + f.n(now) + ' sec over the last 7 days against ' + f.n(was) + ' sec for the 28 days before (' + f.signed(now - was) + '). ' +
      'AVG_SERVICE_SECS for the same stores reads ' + f.n(posNow) + ' sec against ' + f.n(posWas) + ': ' + (Math.abs(posNow - posWas) < 2 ? 'no change at all' : 'a different size of change') + '.');
    if (out.single.now && out.dual.now && out.single.was && out.dual.was) {
      var ds = out.single.now.avg_dt_secs - out.single.was.avg_dt_secs, dd = out.dual.now.avg_dt_secs - out.dual.was.avg_dt_secs;
      if (ds > dd + 5) {
        fact(b, b.g('On AVG_DT_SECS the rise sits in the ' + out.single.now.stores + ' single-lane stores') + ' (' + f.n(out.single.was.avg_dt_secs) + ' → ' + f.n(out.single.now.avg_dt_secs) + ' sec); the ' +
          out.dual.now.stores + ' dual-lane stores moved ' + f.n(out.dual.was.avg_dt_secs) + ' → ' + f.n(out.dual.now.avg_dt_secs) + '. RAW_STORES tells me the lane type and nothing else about the kitchens.');
      }
    }
    return out;
  }

  /** The three events the raw promo table lists around the rise. */
  function events(b, max) {
    var f = fmt();
    var rows = b.q('raw_promo_events', "\n  SELECT EVENT_DATE, EVENT_NAME, EVENT_TYPE, REGION\n  FROM BRONZE.RAW_PROMO_EVENTS\n  WHERE EVENT_DATE > date('" + max + "', '-21 days')\n  ORDER BY EVENT_DATE",
      'Look for anything that changed recently — RAW_PROMO_EVENTS is the only event table I can find.');
    if (rows.length) {
      fact(b, f.cap(f.word(rows.length)) + ' events sit in the three weeks before: ' + f.list(rows.map(function (r) { return r.EVENT_NAME + ' (' + f.date(r.EVENT_DATE) + ')'; })) +
        '. Any of them could line up with the change, and without a diagnostic method ' + b.b("I'd just be eyeballing correlations") + ', not attributing cause.');
    }
    return rows;
  }

  function scopeWords(who) {
    return who.kind === 'operator' ? who.operator.OPERATOR_NAME + "'s stores" : 'every active store';
  }

  /** Operators ranked on raw seconds: what "which operators" turns into without a scorecard. */
  function operators(b, who, spec) {
    var f = fmt();
    var max = latest(b, 'RAW_ORDER_TIMING_DAILY');
    var rows = b.q('raw_operators', "\n  SELECT o.OPERATOR_NAME, o.REGION,\n         COUNT(DISTINCT s.STORE_ID)    AS stores,\n         ROUND(AVG(t.AVG_DT_SECS), 1)  AS avg_dt_secs\n  FROM BRONZE.RAW_ORDER_TIMING_DAILY t\n  JOIN BRONZE.RAW_STORES s ON s.STORE_ID = t.STORE_ID\n  JOIN BRONZE.RAW_FRANCHISE_OWNERS o ON o.OPERATOR_ID = s.OPERATOR_ID\n  WHERE s.IS_ACTIVE = TRUE\n    AND t.DATE > date('" + max + "', '-7 days')\n  GROUP BY o.OPERATOR_NAME, o.REGION\n  ORDER BY avg_dt_secs DESC",
      'Rank operators on raw drive-thru seconds over the last 7 days — the only scorecard I can build.');
    var staff = b.q('raw_staffing', "\n  SELECT o.OPERATOR_NAME, ROUND(AVG(g.HEADCOUNT), 1) AS avg_headcount\n  FROM BRONZE.RAW_STAFFING_DAILY g\n  JOIN BRONZE.RAW_STORES s ON s.STORE_ID = g.STORE_ID\n  JOIN BRONZE.RAW_FRANCHISE_OWNERS o ON o.OPERATOR_ID = s.OPERATOR_ID\n  WHERE s.IS_ACTIVE = TRUE\n    AND g.DATE > date('" + max + "', '-7 days')\n  GROUP BY o.OPERATOR_NAME\n  ORDER BY avg_headcount",
      'RAW_STAFFING_DAILY has headcount. See whether anyone looks short.');
    ask(b, 'What triggers an intervention? Nothing in the raw warehouse defines one, so ' + b.b('I would be drawing the line myself') + '.');
    ask(b, 'What is the benchmark, and is it the same for every kind of store? ' + b.b('There is no benchmark column in the raw warehouse') + '.');
    ask(b, 'Which days? Nothing defines the reporting week or the quarter, so I took the last 7 days of data (' + f.dateRange(f.addDays(max, -6), max) + ').');
    fact(b, 'On raw AVG_DT_SECS over the last 7 days the slowest operators are ' + f.list(rows.slice(0, 3).map(function (r) { return r.OPERATOR_NAME + ' (' + f.n(r.avg_dt_secs) + ' sec, ' + r.stores + ' ' + r.REGION + ' stores)'; })) +
      ', and the fastest is ' + rows[rows.length - 1].OPERATOR_NAME + ' (' + f.n(rows[rows.length - 1].avg_dt_secs) + ').');
    fact(b, 'Average headcount per store runs from ' + f.n(staff[0].avg_headcount, 1) + ' to ' + f.n(staff[staff.length - 1].avg_headcount, 1) + ' across operators, which mostly reflects store size. ' +
      'An operator with more dual-lane stores will look slower on raw seconds whatever their service is like, and ' + b.b('I have no way to compare like with like') + '.');
    limit(b, (spec.cannot || 'I can rank operators on raw seconds.') + ' That is not a case for intervening with anyone: it needs a benchmark by store format, a trigger, and a way to tell a kitchen problem from a management one.');
  }

  var TOPICS = {
    // ---- drive-thru time: level, change, cause, fix, forecast ----------------------------
    timing: function (b, who, spec) {
      var t = timing(b, who);
      if (b.intent === 'diagnostic') {
        events(b, t.max);
        limit(b, 'I can describe the rise. ' + b.b("I can't confidently tell you why") + ' without the answers above. Tell me the scope, the metric and the benchmark, and I can re-run this properly.');
      } else if (b.intent === 'prescriptive') {
        ask(b, 'What is the playbook? Nothing in the raw warehouse says which fixes your operations team uses or what each is worth, so ' + b.b('any recommendation from me would be generic') + '.');
        limit(b, 'I can show where the seconds are. I cannot tell you which stores are over target, what to do about it, or what it would recover, because the raw tables hold no benchmark and no playbook.');
      } else if (b.intent === 'predictive') {
        ask(b, 'What does the change do to window time? The raw warehouse has no model of that. ' + b.b("I'd be inventing a number") + '.');
        limit(b, b.b("I can't forecast the impact responsibly") + ': there is no benchmark to measure it against and no calibrated effect to apply. The figures above are where any estimate would start.');
      } else {
        limit(b, 'These are raw averages over a window I chose, on a column I picked, with nothing to say whether they are good or bad. ' + (spec.cannot || "Tell me the metric, the benchmark and the reporting week and I'll give you a number you can use."));
      }
    },

    // ---- "performance vs benchmark", priorities and rankings -------------------------------
    ranking: function (b, who, spec) {
      var f = fmt();
      var max = latest(b, 'RAW_ORDER_TIMING_DAILY');
      var rows = b.q('raw_ranking', "\n  SELECT s.STORE_NAME, s.LANE_TYPE,\n         ROUND(AVG(t.AVG_DT_SECS), 0)   AS avg_dt_secs,\n         SUM(t.TOTAL_DT_TRANSACTIONS)   AS dt_transactions\n  FROM BRONZE.RAW_ORDER_TIMING_DAILY t\n  JOIN BRONZE.RAW_STORES s ON s.STORE_ID = t.STORE_ID\n  WHERE " + who.where + "\n    AND t.DATE > date('" + max + "', '-7 days')\n  GROUP BY s.STORE_NAME, s.LANE_TYPE\n  ORDER BY avg_dt_secs DESC\n  LIMIT 10",
        'Rank stores by raw drive-thru seconds over the last 7 days — the only ordering I can build without a benchmark.');
      ask(b, '"Versus benchmark" — which benchmark? ' + b.b('There is no benchmark column in the raw warehouse') + ', so I have nothing to compare against.');
      ask(b, 'Ranked by what? Biggest gap, most volume, most revenue at risk? Those give different lists, and the raw tables hold no revenue-at-risk rule.');
      var top = rows.slice(0, 3).map(function (r) { return r.STORE_NAME + ' (' + f.n(r.avg_dt_secs) + ' sec)'; });
      fact(b, 'Ranked by raw AVG_DT_SECS over the last 7 days (' + f.dateRange(f.addDays(max, -6), max) + '), the slowest of ' + scopeWords(who) + ' are ' + f.list(top) + '. ' +
        (rows.every(function (r) { return r.LANE_TYPE === rows[0].LANE_TYPE; }) ? 'The ' + rows.length + ' slowest are all ' : rows.filter(function (r) { return r.LANE_TYPE === rows[0].LANE_TYPE; }).length + ' of the ' + rows.length + ' slowest are ') +
        rows[0].LANE_TYPE.replace('_', '-') + ', but ' + b.b('a high number might be normal for that kind of store — I can\'t tell') + '.');
      limit(b, (spec.cannot || "It's a list of raw seconds, not a view against benchmark.") + ' Tell me the benchmark for each kind of store and what "performance" means to your team, and I can rank them properly.');
    },

    // ---- regions and operators -----------------------------------------------------------------
    regions: function (b, who, spec) {
      if (spec.by === 'operator') return operators(b, who, spec);
      var f = fmt();
      var max = latest(b, 'RAW_ORDER_TIMING_DAILY');
      var rows = b.q('raw_regions', "\n  SELECT o.REGION,\n         COUNT(DISTINCT s.STORE_ID)    AS stores,\n         ROUND(AVG(t.AVG_DT_SECS), 1)  AS avg_dt_secs\n  FROM BRONZE.RAW_ORDER_TIMING_DAILY t\n  JOIN BRONZE.RAW_STORES s ON s.STORE_ID = t.STORE_ID\n  JOIN BRONZE.RAW_FRANCHISE_OWNERS o ON o.OPERATOR_ID = s.OPERATOR_ID\n  WHERE s.IS_ACTIVE = TRUE\n    AND t.DATE > date('" + max + "', '-7 days')\n  GROUP BY o.REGION\n  ORDER BY avg_dt_secs DESC",
        'Average raw drive-thru seconds by region over the last 7 days. Region is only on the owners table, so stores take their owner\'s region.');
      var pos = b.q('raw_pos', "\n  SELECT o.REGION, ROUND(AVG(p.AVG_SERVICE_SECS), 1) AS avg_service_secs\n  FROM BRONZE.RAW_POS_DAILY p\n  JOIN BRONZE.RAW_STORES s ON s.STORE_ID = p.STORE_ID\n  JOIN BRONZE.RAW_FRANCHISE_OWNERS o ON o.OPERATOR_ID = s.OPERATOR_ID\n  WHERE s.IS_ACTIVE = TRUE\n    AND p.DATE > date('" + max + "', '-7 days')\n  GROUP BY o.REGION\n  ORDER BY avg_service_secs DESC",
        'The POS table has its own service-time column. Same cut.');
      b.say('Two raw columns both claim to be “drive-thru time” and they rank the regions differently — `RAW_ORDER_TIMING_DAILY.AVG_DT_SECS` and `RAW_POS_DAILY.AVG_SERVICE_SECS`. Nothing says which is authoritative — guessing.', { hold: true });
      ask(b, 'Which metric is drive-thru time? RAW_ORDER_TIMING_DAILY.AVG_DT_SECS and RAW_POS_DAILY.AVG_SERVICE_SECS both look like it. ' + b.b('Which one does your ops team report on?'));
      ask(b, 'What is the benchmark? ' + b.b('There is no benchmark column in the raw warehouse') + ', so I can rank regions by seconds but not say which are missing a target.');
      ask(b, 'Which days? Nothing defines the reporting week, so I took the last 7 days of data (' + f.dateRange(f.addDays(max, -6), max) + ').');
      fact(b, 'On AVG_DT_SECS over the last 7 days: ' + f.list(rows.map(function (r) { return r.REGION + ' ' + f.n(r.avg_dt_secs) + ' sec'; })) + '. ' +
        'On AVG_SERVICE_SECS the spread is ' + f.n(pos[pos.length - 1].avg_service_secs) + '–' + f.n(pos[0].avg_service_secs) + ' sec and ' + pos[0].REGION + ' comes out highest.');
      fact(b, 'A region with more dual-lane stores will look slower on raw seconds whatever its service is like, and ' + b.b("I have no way to adjust for that") + ' without a target per kind of store.');
      limit(b, (spec.cannot || 'I can rank regions on raw seconds.') + ' I cannot tell you which of them is actually behind, because that needs a benchmark by store format and a definition of the metric.');
    },

    // ---- combo revenue and the promo -------------------------------------------------------------
    combo: function (b, who, spec) {
      var f = fmt();
      var region = who.kind === 'operator' ? who.operator.REGION : null;
      var where = region ? "REGION = '" + region + "'\n    AND " : '';
      var max = latest(b, 'RAW_COMBO_REVENUE_DAILY');
      var weeks = b.q('raw_combo_weeks', "\n  SELECT date(DATE, 'weekday 0', '-6 days') AS wk,\n         COUNT(DISTINCT DATE)               AS days,\n         ROUND(SUM(GROSS_REVENUE_USD), 0)   AS gross_rev,\n         ROUND(SUM(NET_REVENUE_USD), 0)     AS net_rev\n  FROM BRONZE.RAW_COMBO_REVENUE_DAILY\n  WHERE " + where + "DATE > date('" + max + "', '-35 days')\n  GROUP BY wk\n  ORDER BY wk",
        'Pull ' + (region ? region + ' region ' : 'network ') + 'combo revenue by week, gross and net, around the launch.');
      b.say('Two raw columns both read as “combo revenue” — gross and net of discounts — and no definition tells me which one finance means. Picking one blind.', { hold: true });
      var items = b.q('raw_combo_items', "\n  SELECT m.ITEM_NAME, m.IS_LTO,\n         ROUND(SUM(c.GROSS_REVENUE_USD), 0) AS gross_rev,\n         ROUND(SUM(c.NET_REVENUE_USD), 0)   AS net_rev\n  FROM BRONZE.RAW_COMBO_REVENUE_DAILY c\n  JOIN BRONZE.RAW_MENU_ITEMS m ON m.SKU_ID = c.SKU_ID\n  WHERE " + where.replace('REGION', 'c.REGION') + "c.DATE > date('" + max + "', '-7 days')\n  GROUP BY m.ITEM_NAME, m.IS_LTO\n  ORDER BY net_rev DESC",
        'Break the last 7 days down by item to see where the money is.');
      var last = weeks[weeks.length - 1], prev = weeks[weeks.length - 2];
      var drop = prev ? (last.net_rev - prev.net_rev) / prev.net_rev * 100 : 0;
      var lto = items.filter(function (r) { return r.IS_LTO; })[0];
      ask(b, 'Which "combo revenue" do you mean? RAW_COMBO_REVENUE_DAILY has GROSS_REVENUE_USD and NET_REVENUE_USD. ' + b.b('Which one is your reporting truth') + ' — finance (net of discounts) or marketing (gross)?');
      if (who.kind !== 'network') ask(b, 'Which stores? The combo table has no STORE_ID — it stops at region. ' + b.b('I rolled up to the ' + (region || 'whole network') + ' as a proxy') + ', which is more than your stores.');
      ask(b, 'Is the Double Stack a combo? RAW_MENU_ITEMS files it under "LTO". Whether it counts towards combo revenue changes the answer.');
      fact(b, 'By week, net revenue in the table goes from ' + f.usd(prev.net_rev) + ' (week of ' + f.date(prev.wk) + ') to ' + b.b(f.usd(last.net_rev) + ' in the week of ' + f.date(last.wk) + ', a ' + f.pct(Math.abs(drop)) + ' fall') +
        '. That latest week has ' + last.days + ' days in it so far, and I have no rule for how to treat that.');
      if (lto) fact(b, 'Over the last 7 days the ' + lto.ITEM_NAME + ' took ' + f.usd(lto.net_rev) + ' net (' + f.usd(lto.gross_rev) + ' gross). It may be pulling sales from other combos; I cannot separate that from normal week-to-week movement.');
      limit(b, (spec.cannot || 'The "dip" could be real or an artefact of how I cut the weeks, and it reads differently on gross and on net.') + ' Tell me which revenue figure is the official one and how the Double Stack is classified, and I can give you a firm answer.');
    },

    // ---- complaints ---------------------------------------------------------------------------------
    complaints: function (b, who, spec) {
      var f = fmt();
      var max = latest(b, 'RAW_SUPPORT_TICKETS', 'substr(CREATED_AT, 1, 10)');
      var labels = b.q('raw_ticket_labels', "\n  SELECT CATEGORY_TEXT, COUNT(*) AS tickets\n  FROM BRONZE.RAW_SUPPORT_TICKETS\n  WHERE substr(CREATED_AT, 1, 10) > date('" + max + "', '-7 days')\n  GROUP BY CATEGORY_TEXT\n  ORDER BY tickets DESC",
        'See how tickets are labelled — CATEGORY_TEXT is free text typed by agents.');
      var counts = b.q('raw_wait_tickets', "\n  SELECT CASE WHEN substr(CREATED_AT, 1, 10) > date('" + max + "', '-7 days') THEN 'last 7 days' ELSE 'prior 7 days' END AS period,\n         COUNT(*)                  AS tickets,\n         COUNT(DISTINCT STORE_REF) AS store_refs\n  FROM BRONZE.RAW_SUPPORT_TICKETS\n  WHERE CATEGORY_TEXT LIKE '%wait%'\n    AND substr(CREATED_AT, 1, 10) > date('" + max + "', '-14 days')\n  GROUP BY period\n  ORDER BY period",
        "Count tickets whose label contains the word 'wait' — the nearest thing to a wait-time category I can build.");
      var c = index(counts, 'period');
      var now = c['last 7 days'] || { tickets: 0, store_refs: 0 }, was = c['prior 7 days'] || { tickets: 0 };
      var waitish = labels.filter(function (r) { return /wait/i.test(r.CATEGORY_TEXT); }).map(function (r) { return '"' + r.CATEGORY_TEXT + '"'; });
      var others = labels.filter(function (r) { return /slow|line|drive/i.test(r.CATEGORY_TEXT) && !/wait/i.test(r.CATEGORY_TEXT); }).map(function (r) { return '"' + r.CATEGORY_TEXT + '"'; });
      ask(b, 'What counts as a wait-time complaint? There is no category code, only ' + labels.length + ' free-text labels. I matched the word "wait" (' + f.list(waitish.slice(0, 4)) + '), ' +
        b.b('which misses labels like ' + f.list(others.slice(0, 3)) + ' and picks up "waited for refund"') + '.');
      ask(b, 'Which days are "this week"? Nothing defines it, so I took the last 7 days of tickets (' + f.dateRange(f.addDays(max, -6), max) + ').');
      ask(b, 'Which store is which? STORE_REF is typed by hand: I see ' + now.store_refs + ' different spellings in the last 7 days, some of them the same store in a different case.');
      fact(b, 'On that match there were ' + b.b(f.n(now.tickets) + ' "wait" tickets in the last 7 days') + ' against ' + f.n(was.tickets) + ' in the 7 days before. ' +
        'The direction is probably right. The count is whatever my text match happens to catch.');
      limit(b, (spec.cannot || 'I can count labels.') + ' ' + b.b("I can't tie a complaint to what was happening in the store") + ' — nothing links a ticket to drive-thru time, to a benchmark or to a menu change — so I cannot say why they moved or what to do about them.');
    },

    // ---- launch or staffing? ----------------------------------------------------------------------------
    staffing: function (b, who, spec) {
      var f = fmt();
      var t = timing(b, who);
      var staff = b.q('raw_staffing', "\n  SELECT CASE WHEN g.DATE > date('" + t.max + "', '-7 days') THEN 'last 7 days' ELSE 'prior 28 days' END AS period,\n         ROUND(AVG(g.HEADCOUNT), 1)       AS avg_headcount,\n         ROUND(AVG(g.SCHEDULED_HOURS), 1) AS scheduled_hours,\n         ROUND(AVG(g.WORKED_HOURS), 1)    AS worked_hours\n  FROM BRONZE.RAW_STAFFING_DAILY g\n  JOIN BRONZE.RAW_STORES s ON s.STORE_ID = g.STORE_ID\n  WHERE " + who.where + "\n    AND g.DATE > date('" + t.max + "', '-35 days')\n  GROUP BY period\n  ORDER BY period",
        'RAW_STAFFING_DAILY has headcount and hours. Compare the same two windows.');
      var s = index(staff, 'period');
      events(b, t.max);
      ask(b, 'What measures staffing here? I see HEADCOUNT, SCHEDULED_HOURS and WORKED_HOURS and no definition. ' + b.b('I used headcount, which may be the wrong one') + '.');
      fact(b, 'Average headcount per store is ' + f.n(s['last 7 days'].avg_headcount, 1) + ' in the last 7 days and ' + f.n(s['prior 28 days'].avg_headcount, 1) + ' in the 28 before: flat. Worked hours are ' +
        f.n(s['last 7 days'].worked_hours, 1) + ' a day against ' + f.n(s['prior 28 days'].worked_hours, 1) + '.');
      limit(b, (spec.cannot || 'Timing moved and headcount did not, and a launch sits in the same window.') + ' That is a coincidence in time, not an attribution. ' + b.b("I can't rule staffing in or out") + ' for any one operator without a method and the right staffing measure.');
    },

    // ---- kitchens and equipment -----------------------------------------------------------------------------
    equipment: function (b, who, spec) {
      var f = fmt();
      var names = b.q('raw_equipment_names', "\n  SELECT EQUIPMENT_NAME, STATUS, COUNT(*) AS assets\n  FROM BRONZE.RAW_EQUIPMENT_REGISTER\n  GROUP BY EQUIPMENT_NAME, STATUS\n  ORDER BY assets DESC",
        'See what the equipment register calls things — the names are typed by whoever logged the asset.');
      var hits = b.one('raw_prep_assets', "\n  SELECT COUNT(*) AS assets, COUNT(DISTINCT STORE_ID) AS stores\n  FROM BRONZE.RAW_EQUIPMENT_REGISTER\n  WHERE EQUIPMENT_NAME LIKE '%prep%'",
        "Count assets with 'prep' in the name — the closest I can get to a parallel prep station.");
      var lanes = b.q('raw_store_lanes', '\n  SELECT LANE_TYPE, COUNT(*) AS stores\n  FROM BRONZE.RAW_STORES s\n  WHERE ' + who.where + '\n  GROUP BY LANE_TYPE', 'Count stores by lane type for the denominator.');
      var prepNames = names.filter(function (r) { return /prep|pps/i.test(r.EQUIPMENT_NAME); });
      var total = lanes.reduce(function (sum, r) { return sum + r.stores; }, 0);
      ask(b, 'What is a parallel prep station called in the register? I see ' + f.word(prepNames.length) + ' candidates: ' + f.list(prepNames.map(function (r) { return '"' + r.EQUIPMENT_NAME + '"' + (r.STATUS !== 'active' ? ' (' + r.STATUS + ')' : ''); })) + '. ' +
        b.b('I matched on the word "prep", which is a guess') + '.');
      ask(b, 'Do decommissioned assets count? Some rows are marked decommissioned and are still in the register.');
      fact(b, 'Matching "prep" finds ' + b.b(f.n(hits.assets) + ' assets in ' + f.n(hits.stores) + ' of ' + f.n(total) + ' stores') + '. That includes a plain "Prep table" and at least one decommissioned unit, and it misses anything logged only by a model code such as "PPS-1".');
      limit(b, (spec.cannot || 'I can list asset names.') + ' ' + b.b("I can't give you a reliable list of which kitchens have one") + ', and nothing in the raw tables ties a station to how a kitchen performs.');
    },

    // ---- stock --------------------------------------------------------------------------------------------------
    stock: function (b, who, spec) {
      var f = fmt();
      var max = latest(b, 'RAW_INVENTORY_COUNTS', 'COUNT_DATE');
      var items = b.q('raw_inventory', "\n  SELECT o.REGION, i.ITEM_CODE, i.UOM,\n         COUNT(DISTINCT i.STORE_ID) AS stores,\n         ROUND(AVG(i.ON_HAND), 0)   AS avg_on_hand\n  FROM BRONZE.RAW_INVENTORY_COUNTS i\n  JOIN BRONZE.RAW_STORES s ON s.STORE_ID = i.STORE_ID\n  JOIN BRONZE.RAW_FRANCHISE_OWNERS o ON o.OPERATOR_ID = s.OPERATOR_ID\n  WHERE i.COUNT_DATE = '" + max + "'\n  GROUP BY o.REGION, i.ITEM_CODE, i.UOM\n  ORDER BY i.ITEM_CODE, avg_on_hand",
        'Pull the latest store stock counts by region and item code.');
      var dc = b.q('raw_dc_stock', '\n  SELECT DC, ITEM_CODE, ON_HAND, UOM\n  FROM BRONZE.RAW_DC_STOCK\n  ORDER BY ITEM_CODE, ON_HAND', 'And what the distribution centres hold.');
      var codes = []; items.forEach(function (r) { if (codes.indexOf(r.ITEM_CODE) === -1) codes.push(r.ITEM_CODE); });
      var pouch = items.filter(function (r) { return r.ITEM_CODE === 'SS-POUCH'; });
      ask(b, 'What are these items? The counts use codes (' + f.list(codes.map(function (c) { return '"' + c + '"'; })) + ') with no description. ' + b.b('I am guessing "SS-POUCH" is the sauce') + '.');
      ask(b, 'How fast is each store using it? The raw counts are units on hand only. Without usage ' + b.b("I can't turn stock into days of cover") + ', so I cannot say who is short.');
      ask(b, 'What is the target? Nothing says how many days a store should hold, or what a distribution centre must keep back.');
      if (pouch.length) {
        fact(b, 'On the latest count (' + f.date(max) + ') stores hold on average ' + f.list(pouch.map(function (r) { return f.n(r.avg_on_hand) + ' ' + r.UOM + 'es in the ' + r.REGION; })) + ' of SS-POUCH. ' +
          'A low number may mean a shortage or just smaller stores.');
      }
      fact(b, 'The distribution centres hold ' + f.list(dc.filter(function (r) { return r.ITEM_CODE === 'SS-CASE'; }).map(function (r) { return f.n(r.ON_HAND) + ' cases at ' + r.DC; })) + ' of SS-CASE, and ' +
        f.list(dc.filter(function (r) { return r.ITEM_CODE === 'PPS2-KIT'; }).map(function (r) { return f.n(r.ON_HAND) + ' at ' + r.DC; })) + ' of PPS2-KIT.');
      limit(b, (spec.cannot || 'I can read out what is on the shelf.') + ' Whether that is enough, where it should move and when the next delivery lands are not in the raw tables.');
    },

    // ---- what-if: the anchor and nothing more -----------------------------------------------------------------------
    whatif: function (b, who, spec) {
      var f = fmt();
      var max = latest(b, 'RAW_ORDER_TIMING_DAILY');
      var weeks = b.q('raw_window_trend', "\n  SELECT date(t.DATE, 'weekday 0', '-6 days')    AS wk,\n         COUNT(DISTINCT t.DATE)                 AS days,\n         ROUND(AVG(t.AVG_DT_SECS), 1)           AS avg_dt_secs,\n         ROUND(AVG(t.AVG_WINDOW_TIME_SECS), 1)  AS window_secs\n  FROM BRONZE.RAW_ORDER_TIMING_DAILY t\n  JOIN BRONZE.RAW_STORES s ON s.STORE_ID = t.STORE_ID\n  WHERE " + who.where + "\n    AND t.DATE > date('" + max + "', '-35 days')\n  GROUP BY wk\n  ORDER BY wk",
        'Pull the current raw window-time trend — the anchor any forecast would start from.');
      var first = weeks[0], last = weeks[weeks.length - 1];
      ask(b, 'A baseline or benchmark to measure the change against — ' + b.b("there's no benchmark column in the raw data") + '.');
      ask(b, 'A model of what the change does. ' + (spec.needs || 'Pre-staging, a prep station or a change in traffic all shift operations') + ', but ' + b.b('the raw warehouse has no ops playbook quantifying that') + '. ' + b.b("I'd be inventing a number") + '.');
      if (who.kind !== 'operator') ask(b, 'Which stores it applies to. RAW_STORES gives lane type and nothing about the kitchens, and single-lane and dual-lane stores will not respond the same way.');
      fact(b, 'What I can show is the starting point: for ' + scopeWords(who) + ', raw window time is ' + f.n(last.window_secs) + ' sec in the latest week (' + last.days + ' days of data) against ' + f.n(first.window_secs) + ' sec five weeks ago, ' +
        'and AVG_DT_SECS is ' + f.n(last.avg_dt_secs) + ' against ' + f.n(first.avg_dt_secs) + '.');
      limit(b, b.b("I can't forecast the impact responsibly") + '. ' + (spec.cannot || 'Projecting the effect of an operational change from these rows would be a guess.') + ' With a calibrated what-if model and your benchmark this becomes a real low, central and high estimate.');
    }
  };

  // -------------------------------------------------------------------
  // Writing it up
  // -------------------------------------------------------------------
  var OPENERS = {
    descriptive: "Happy to pull that. Before I can stand behind a number, a few things I'd need from you — without them I'm working from raw tables and educated guesses:",
    diagnostic: "Happy to help dig in. Before I commit to a full answer, a few things I'd want from you — without them I'm working from raw tables and educated guesses:",
    prescriptive: "Happy to help you plan this — but a recommendation needs a few things I don't have:",
    predictive: "Happy to think it through — but I can't forecast this responsibly without a few things:"
  };

  function compose(b) {
    var n = notes(b), a = b.answer;
    if (n.asks.length) a.listed(OPENERS[b.intent] || OPENERS.diagnostic, n.asks);
    if (n.facts.length) {
      a.p("Here's what I can glean from the raw data:");
      n.facts.forEach(function (text) { a.p(text); });
    }
    if (n.limits.length) {
      b.say('Honest limit: ' + MCX.script.plain(n.limits[0]).split(/(?<=[.!?])\s/)[0]);
      a.p('Honest limit: ' + n.limits.join(' '));
    }
  }

  /** Pick a topic from the wording when the analysis does not name one. */
  function guessTopic(question, intent) {
    var q = MCX.text.normalise(question);
    if (/complain|ticket|customer/.test(q)) return 'complaints';
    if (/sauce|stock|cover|inventory|rebalance/.test(q)) return 'stock';
    if (/kitchen|equipment|prep station|retrofit/.test(q) && intent !== 'predictive') return 'equipment';
    if (/combo|revenue|promo|selling|sales/.test(q) && intent !== 'predictive') return 'combo';
    if (/staff|crew|shift/.test(q)) return 'staffing';
    if (/region|operator|national|company/.test(q)) return 'regions';
    if (intent === 'predictive') return 'whatif';
    if (/benchmark|priorit|rank|worst|best/.test(q)) return 'ranking';
    return 'timing';
  }

  function run(b, plan) {
    var kit = { identify: identify, latest: latest, timing: timing, events: events, ask: ask, fact: fact, limit: limit, relimit: relimit, compose: compose, index: index, scopeWords: scopeWords, topics: TOPICS };
    if (typeof plan.bare === 'function') {
      plan.bare(b, kit);
      if (!b.answer.blocks.length) compose(b);
      return;
    }
    var spec = typeof plan.bare === 'string' ? { topic: plan.bare } : (plan.bare || {});
    var topic = spec.topic || guessTopic(b.question, b.intent);
    if (!TOPICS[topic]) throw new Error('No bare topic called ' + topic);
    var who = identify(b);
    TOPICS[topic](b, who, spec);
    compose(b);
  }

  MCX.bare = { run: run, topics: Object.keys(TOPICS), guessTopic: guessTopic };
})(typeof window !== 'undefined' ? window : globalThis);
