/* =====================================================================
   src/engine/evidence.js — queries that many analyses share

   Each function runs one query through the semantic layer and hands
   back tidy rows. An analysis strings several together and writes the
   answer from what comes back.

   Kitchen formats, used throughout:
     exposed       single-lane, no parallel staging
     retrofitted   single-lane, parallel prep station fitted later
     dual          dual-lane (built with parallel staging)

   MCX.evidence
   ===================================================================== */
(function (global) {
  'use strict';
  var MCX = (global.MCX = global.MCX || {});
  var TIMING = 'ORDER_TIMING_MART';

  /** Which kitchen format a row with lane_type and has_parallel_staging belongs to. */
  function formatOf(row) { return row.lane_type === 'dual_lane' ? 'dual' : row.has_parallel_staging ? 'retrofitted' : 'exposed'; }

  /** { exposed: row, retrofitted: row, dual: row } from rows grouped by lane type and parallel staging. */
  function byFormat(rows) {
    var out = {};
    rows.forEach(function (row) { out[formatOf(row)] = row; });
    return out;
  }

  /** Index rows by a column: index(rows, 'region').Southeast */
  function index(rows, column) {
    var out = {};
    rows.forEach(function (row) { out[row[column]] = row; });
    return out;
  }

  /** Words for each format, given which formats the scope actually has. */
  function names(scope) {
    var plain = !scope.retrofitted;       // no retrofitted stores in scope: "single-lane" says it all
    return {
      exposed: plain ? 'single-lane' : 'single-lane without parallel staging',
      exposedStores: plain ? 'single-lane stores' : 'single-lane stores without parallel staging',
      retrofitted: 'retrofitted single-lane',
      retrofittedStores: 'retrofitted single-lane stores',
      dual: 'dual-lane',
      dualStores: 'dual-lane stores'
    };
  }

  /**
   * Words for one kitchen format in the question's scope, with the verb forms that go with it:
   *   group(ctx, 'exposed') -> { count: 6, noun: 'single-lane stores', kind: 'single-lane', label: 'your 6 single-lane stores', are: 'are', they: 'they', ... }
   * When the scope also has retrofitted single-lane stores the two are told apart: the noun gains
   * "without parallel staging" and the adjective becomes "exposed single-lane" (the glossary's word).
   */
  function group(ctx, format, count) {
    var s = ctx.scope, c = count != null ? count : s[format];
    var base = format === 'dual' ? 'dual-lane' : format === 'retrofitted' ? 'retrofitted single-lane' : 'single-lane';
    var tail = format === 'exposed' && s.retrofitted ? ' without parallel staging' : '';
    var noun = base + (c === 1 ? ' store' : ' stores') + tail;
    var kind = tail ? 'exposed ' + base : base;       // as an adjective: "exposed single-lane window time"
    return { count: c, noun: noun, kind: kind, a: /^[aeiou]/.test(kind) ? 'an' : 'a', label: ctx.who.poss + ' ' + (c === 1 ? 'one' : c) + ' ' + noun, the: 'the ' + (c === 1 ? 'one' : c) + ' ' + noun,
      are: c === 1 ? 'is' : 'are', were: c === 1 ? 'was' : 'were', they: c === 1 ? 'it' : 'they', them: c === 1 ? 'it' : 'them', s: c === 1 ? '' : 's' };
  }

  /** The three kitchen formats in plain words, for network-wide answers. */
  var LABEL = {
    exposed: 'single-lane stores without parallel staging',
    retrofitted: 'retrofitted single-lane stores',
    dual: 'dual-lane stores'
  };

  var E = {
    formatOf: formatOf, byFormat: byFormat, index: index, names: names, group: group, label: LABEL,

    /** "Double Stack" from "McContext Double Stack". */
    item: function (name) { return String(name || '').replace(/^McContext\s+/, ''); },

    /** Rows of one kitchen format from a result grouped by lane type and parallel staging (plus anything else). */
    only: function (rows, format) { return rows.filter(function (row) { return formatOf(row) === format; }); },

    /** One period, region by region. */
    regions: function (ctx, o) {
      o = o || {};
      return ctx.q(o.key || 'regions', {
        model: o.model || TIMING, by: ['region'].concat(o.by || []),
        metrics: o.metrics || ['stores', 'drive_thru_time', 'benchmark', 'secs_vs_benchmark', 'pct_in_benchmark', 'window_time'],
        columns: o.columns, split: o.split, where: o.where || { week: 'this' }, scope: o.scope,
        order: o.order || 'secs_vs_benchmark DESC'
      }, o.say);
    },

    /** Week by week: eight full weeks and this one. */
    weeks: function (ctx, o) {
      o = o || {};
      return ctx.q(o.key || 'confirm', {
        model: TIMING, by: ['week_start'],
        metrics: ['days', 'drive_thru_time', 'benchmark', 'secs_vs_benchmark', 'pct_in_benchmark', 'prep_time', 'window_time'].concat(o.metrics || []),
        where: Object.assign({ since: ctx.time.trendStart }, o.where), scope: o.scope, order: 'week_start'
      }, o.say);
    },

    /**
     * What the weekly rows say about the weeks before the launch week.
     * Returns { before: [rows], baseline (avg seconds), drift (seconds gained across them), launchWeek, now }.
     */
    readWeeks: function (ctx, rows) {
      var fmt = MCX.fmt, t = ctx.time;
      var before = rows.filter(function (r) { return fmt.addDays(r.week_start, 6) < t.launch.date; });
      var baseline = before.reduce(function (s, r) { return s + r.avg_dt_secs; }, 0) / (before.length || 1);
      return {
        before: before, baseline: baseline,
        drift: before.length > 1 ? before[before.length - 1].avg_dt_secs - before[0].avg_dt_secs : 0,
        launchWeek: rows.filter(function (r) { return r.week_start <= t.launch.date && fmt.addDays(r.week_start, 6) >= t.launch.date; })[0] || null,
        now: rows[rows.length - 1]
      };
    },

    /** The latest data date, shown as a query so the reader can see what "this week" rests on. */
    calendar: function (ctx, o) {
      o = o || {};
      return ctx.one(o.key || 'scope', {
        model: TIMING,
        columns: [{ sql: 'MAX(t.date)', as: 'max_date' }, { sql: 'MAX(t.week_start)', as: 'this_week' },
          { sql: "COUNT(DISTINCT CASE WHEN t.week_start = '" + ctx.time.thisWeek.start + "' THEN t.date END)", as: 'days_this_week' }],
        scope: false
      }, o.say || 'Find the latest data date, so we know what "this week" means.');
    },

    /** Shift fill rate week by week. */
    staffing: function (ctx, o) {
      o = o || {};
      return ctx.q(o.key || 'staffing', {
        model: 'STAFFING_DAILY_FACT', by: ['week_start'], metrics: ['fill_rate'].concat(o.metrics || []),
        where: Object.assign({ since: ctx.time.trendStart }, o.where), scope: o.scope, order: 'week_start'
      }, o.say);
    },

    /** One period, cut by kitchen format. Returns { exposed, retrofitted, dual, rows }. */
    formats: function (ctx, o) {
      o = o || {};
      var rows = ctx.q(o.key || 'spread', {
        model: o.model || TIMING, by: ['lane_type', 'has_parallel_staging'].concat(o.by || []),
        metrics: o.metrics || ['stores', 'drive_thru_time', 'benchmark', 'secs_vs_benchmark', 'pct_in_benchmark', 'window_time'],
        columns: o.columns, split: o.split,
        where: o.where || { week: 'this' }, scope: o.scope, order: o.order || 'f.lane_type DESC, f.has_parallel_staging'
      }, o.say);
      var out = o.split || (o.by && o.by.length) ? {} : byFormat(rows);
      out.rows = rows;
      return out;
    },

    /** One period, store by store. */
    stores: function (ctx, o) {
      o = o || {};
      return ctx.q(o.key || 'stores', {
        model: o.model || TIMING, by: ['store_name', 'lane_type', 'has_parallel_staging'].concat(o.by || []),
        metrics: o.metrics || ['drive_thru_time', 'benchmark', 'secs_vs_benchmark', 'pct_in_benchmark', 'window_time', 'dt_orders_per_day'],
        columns: o.columns, where: o.where || { week: 'this' }, scope: o.scope,
        having: o.having, order: o.order || 'secs_vs_benchmark DESC', limit: o.limit
      }, o.say);
    },

    /**
     * Order, prep and window seconds before and after the launch, by kitchen format.
     * "before" is the 30 days before launch. "after" is launch to date, or o.after: { from, to }.
     * Returns { exposed: { before, after }, ... , rows }.
     */
    segments: function (ctx, o) {
      o = o || {};
      var t = ctx.time;
      var rows = ctx.q(o.key || 'decompose', {
        model: TIMING, by: ['lane_type', 'has_parallel_staging'],
        split: { at: t.launch.date, before: 'before', after: 'after' },
        metrics: ['days', 'order_time', 'prep_time', 'window_time', 'drive_thru_time', 'pct_in_benchmark'],
        where: Object.assign(o.after ? { ranges: [[t.baseline.from, t.baseline.to], [o.after.from, o.after.to]] } : { from: t.baseline.from, to: t.maxDate }, o.where),
        scope: o.scope, order: 'f.lane_type DESC, f.has_parallel_staging, period DESC'
      }, o.say);
      var out = { rows: rows };
      rows.forEach(function (row) { (out[formatOf(row)] = out[formatOf(row)] || {})[row.period] = row; });
      return out;
    },

    /** The menu change log around the launch (o.planned: true also brings what is still to come). Returns { launch, alert, planned, rows }. */
    menu: function (ctx, o) {
      o = o || {};
      var t = ctx.time;
      var rows = ctx.q(o.key || 'correlate', {
        model: 'MENU_CHANGE_LOG',
        by: ['event_date', 'event_type', 'item_name', 'ops_impact_level', 'requires_two_step_prep', 'affected_regions', 'notes'],
        where: o.planned ? { from: o.from || t.baseline.from } : { from: o.from || t.baseline.from, to: o.to || t.maxDate }, scope: false, order: 'm.event_date'
      }, o.say);
      return {
        rows: rows,
        launch: rows.filter(function (r) { return r.event_type === 'launch'; })[0] || null,
        alert: rows.filter(function (r) { return r.event_type === 'ops_alert'; })[0] || null,
        planned: rows.filter(function (r) { return r.event_type === 'planned_launch'; })
      };
    },

    /** Rain by day for a period. Returns { rows, wet: [dates], dry: boolean }. */
    weather: function (ctx, o) {
      o = o || {};
      var rows = ctx.q(o.key || 'weather', {
        model: TIMING, by: ['date'], metrics: [['rain', 2]],
        columns: [{ sql: 'ROUND(AVG(t.avg_temp_f), 0)', as: 'temp_f' }],
        where: o.where || { week: 'this' }, scope: o.scope, order: 't.date'
      }, o.say);
      var wet = rows.filter(function (r) { return r.rain_in > 0.05; }).map(function (r) { return r.date; });
      return { rows: rows, wet: wet, dry: !wet.length };
    },

    /**
     * The same days a year earlier. period: { from, to } this year.
     * Returns { now, then } with drive-thru time, share inside benchmark and window time.
     */
    lastYear: function (ctx, o) {
      o = o || {};
      var t = ctx.time;
      var from = (o.period && o.period.from) || t.thisWeek.start, to = (o.period && o.period.to) || t.thisWeek.end;
      var rows = ctx.q(o.key || 'seasonality', {
        model: TIMING, split: { at: from, as: 'year', before: 'last year', after: 'this year' },
        metrics: ['days', 'drive_thru_time', 'pct_in_benchmark', 'window_time'],
        where: Object.assign({ ranges: [[t.lastYear(from), t.lastYear(to)], [from, to]] }, o.where), scope: o.scope, order: 'year'
      }, o.say);
      var by = index(rows, 'year');
      return { rows: rows, now: by['this year'] || {}, then: by['last year'] || {}, from: from, to: to };
    },

    /**
     * Revenue at risk, store by store, with the rule from the what-if skill written into the SQL.
     * o.atRiskOnly keeps only stores the rule counts (more than a few seconds over benchmark).
     * Returns { rows, hit (rows at risk), stores, weekly: { low, central, high }, orders (per week), ticket, rule }.
     */
    risk: function (ctx, o) {
      o = o || {};
      var p = ctx.params('what-if-analysis'), rule = p.loss_rule;
      var over = MCX.sem.metricSql(TIMING, 'secs_vs_benchmark');
      var orders = MCX.sem.metricSql(TIMING, 'dt_orders_per_day');
      var ticket = MCX.sem.metricSql('DAILY_SALES_FACT', 'avg_ticket');
      var lost = 'CASE WHEN ' + over + ' > ' + rule.ignore_within_secs + ' THEN ' + over + ' / ' + rule.every_secs + '.0 * ' + rule.share_of_orders + ' ELSE 0 END';
      var rows = ctx.q(o.key || 'quantify', {
        model: TIMING, by: ['store_name', 'lane_type', 'has_parallel_staging'].concat(o.by || []),
        metrics: ['secs_vs_benchmark', 'dt_orders_per_day', 'DAILY_SALES_FACT.avg_ticket'],
        columns: [
          { sql: 'ROUND(' + lost + ' * 100, 1)', as: 'pct_orders_lost' },
          { sql: 'ROUND(' + orders + ' * 7 * (' + lost + ') * ' + ticket + ', 0)', as: 'weekly_rev_at_risk' }
        ],
        where: o.where || { week: 'this' }, scope: o.scope,
        having: o.atRiskOnly ? over + ' > ' + rule.ignore_within_secs : o.having, order: 'weekly_rev_at_risk DESC'
      }, o.say);
      var hit = rows.filter(function (r) { return r.weekly_rev_at_risk > 0; });
      var central = hit.reduce(function (sum, r) { return sum + r.weekly_rev_at_risk; }, 0);
      return {
        rows: rows, hit: hit, stores: hit.length, rule: rule,
        orders: hit.reduce(function (sum, r) { return sum + r.daily_dt_orders * 7; }, 0),
        ticket: hit.length ? hit.reduce(function (sum, r) { return sum + r.avg_ticket; }, 0) / hit.length : 0,
        weekly: { low: central * p.low_case_peak_share, central: central, high: central * p.high_case }
      };
    }
  };

  MCX.evidence = E;
})(typeof window !== 'undefined' ? window : globalThis);
