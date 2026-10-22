/* =====================================================================
   src/engine/semantic.js — from business words to SQL

   The semantic models in context/models/ say what each certified table
   holds: its dimensions, its metrics (as SQL expressions) and how it
   joins to other tables. This file turns a request written in those
   words into a real query:

     MCX.sem.compile({
       model: 'ORDER_TIMING_MART',
       by: ['lane_type', 'has_parallel_staging'],
       metrics: ['stores', 'drive_thru_time', 'secs_vs_benchmark'],
       where: { week: 'this' }
     }, ctx)
     -> { sql: 'SELECT f.lane_type, ... FROM GOLD.ORDER_TIMING_MART t JOIN ...', models, metrics }

   It also works out the two things every question depends on:
     anchors()        what "this week", "last week" and "the launch" mean in the data
     resolveScope()   whose stores the question is about

   Change a metric's SQL in a model file, rebuild the context bundle, and
   every answer that uses the metric changes with it.
   ===================================================================== */
(function (global) {
  'use strict';
  var MCX = (global.MCX = global.MCX || {});
  var cache = { anchors: null, entities: null };

  function lit(value) {
    if (value === true) return 'TRUE';
    if (value === false) return 'FALSE';
    if (typeof value === 'number') return String(value);
    return "'" + String(value).replace(/'/g, "''") + "'";
  }
  function q(sql) { return MCX.db.query(sql).rows; }
  function models() { return MCX.contextRepo.models; }

  // -------------------------------------------------------------------
  // Time: what the reporting-week term means on this data
  // -------------------------------------------------------------------
  function anchors() {
    if (cache.anchors) return cache.anchors;
    var fmt = MCX.fmt;
    var latest = q("SELECT MAX(date) AS max_date, MAX(week_start) AS max_week FROM GOLD.ORDER_TIMING_MART")[0];
    var days = q("SELECT COUNT(DISTINCT date) AS days FROM GOLD.ORDER_TIMING_MART WHERE week_start = " + lit(latest.max_week))[0].days;
    var launch = q("SELECT event_date, item_name, sku_id FROM GOLD.MENU_CHANGE_LOG WHERE event_type = 'launch' AND event_date <= " + lit(latest.max_date) + " ORDER BY event_date DESC LIMIT 1")[0];
    var next = q("SELECT event_date, item_name, requires_two_step_prep, ops_impact_level FROM GOLD.MENU_CHANGE_LOG WHERE event_type = 'planned_launch' AND event_date > " + lit(latest.max_date) + " ORDER BY event_date LIMIT 1")[0];
    var thisStart = latest.max_week;
    cache.anchors = {
      maxDate: latest.max_date,
      thisWeek: { start: thisStart, end: latest.max_date, days: days, partial: days < 7 },
      lastWeek: { start: fmt.addDays(thisStart, -7), end: fmt.addDays(thisStart, -1), days: 7 },
      trendStart: fmt.addDays(thisStart, -56),                         // eight full weeks before this one
      launch: launch ? { date: launch.event_date, item: launch.item_name, sku: launch.sku_id, days: fmt.daysBetween(launch.event_date, latest.max_date) + 1 } : null,
      nextLaunch: next ? { date: next.event_date, item: next.item_name, twoStep: !!next.requires_two_step_prep, impact: next.ops_impact_level } : null,
      baseline: launch ? { from: fmt.addDays(launch.event_date, -30), to: fmt.addDays(launch.event_date, -1) } : null, // the 30 days before launch
      /** The same weekday one year earlier. */
      lastYear: function (iso) { return fmt.addDays(iso, -364); }
    };
    return cache.anchors;
  }

  // -------------------------------------------------------------------
  // Entities: operators, regions and stores, read from the store dimension
  // -------------------------------------------------------------------
  function entities() {
    if (cache.entities) return cache.entities;
    var rows = q('SELECT store_name, operator_name, region, lane_type, has_parallel_staging FROM GOLD.FRANCHISE_STORE_DIM');
    var operators = {}, regions = {}, stores = {};
    rows.forEach(function (r) {
      (operators[r.operator_name] = operators[r.operator_name] || { name: r.operator_name, region: r.region, stores: 0 }).stores++;
      (regions[r.region] = regions[r.region] || { name: r.region, stores: 0 }).stores++;
      stores[r.store_name] = { name: r.store_name, operator: r.operator_name, region: r.region };
    });
    Object.keys(operators).forEach(function (name) {
      var parts = name.replace(/\b[A-Z]\.\s*/g, '').split(' ');
      operators[name].aliases = [name, name.replace(/\s[A-Z]\.\s/, ' '), parts[0], parts[parts.length - 1]];
    });
    cache.entities = { operators: operators, regions: regions, stores: stores };
    return cache.entities;
  }

  /** Find an operator, store or region named in the question. */
  function findEntity(question) {
    var text = MCX.text, e = entities(), found = null;
    Object.keys(e.stores).forEach(function (name) { if (!found && text.hasPhrase(question, name)) found = { kind: 'store', store: name }; });
    if (found) return found;
    Object.keys(e.operators).forEach(function (name) {
      if (found) return;
      e.operators[name].aliases.forEach(function (alias) {
        if (!found && alias.length > 3 && text.hasPhrase(question, alias)) found = { kind: 'operator', operator: name };
      });
    });
    if (found) return found;
    Object.keys(e.regions).forEach(function (name) { if (!found && text.hasPhrase(question, name)) found = { kind: 'region', region: name }; });
    return found;
  }

  // -------------------------------------------------------------------
  // Scope: whose stores is this about?
  // -------------------------------------------------------------------
  /**
   * The persona decides the default (an operator sees their own stores;
   * corporate roles see the network). A corporate user who names an
   * operator, a store or a region narrows the scope to it.
   * want: optional { kind, operator | region | store } to force a scope.
   */
  function resolveScope(persona, question, want) {
    var fmt = MCX.fmt, e = entities();
    var own = persona.scope || { kind: 'network' };
    var named = want || (own.kind === 'operator' ? null : findEntity(question));
    var base = named || (own.kind === 'operator' ? { kind: 'operator', operator: own.operator } : { kind: 'network' });
    var scope = { kind: base.kind, operator: base.operator || null, region: base.region || null, store: base.store || null };
    scope.own = own.kind === 'operator' && scope.kind === 'operator' && scope.operator === own.operator;
    scope.person = scope.own ? 'second' : scope.kind === 'network' ? 'network' : 'third';
    scope.named = !!named && scope.kind !== 'network';

    var where = scopeSql(scope, 'f');
    var counts = q('SELECT COUNT(*) AS stores, ' +
      "SUM(CASE WHEN f.lane_type = 'single_lane' AND f.has_parallel_staging = FALSE THEN 1 ELSE 0 END) AS exposed, " +
      "SUM(CASE WHEN f.lane_type = 'single_lane' AND f.has_parallel_staging = TRUE THEN 1 ELSE 0 END) AS retrofitted, " +
      "SUM(CASE WHEN f.lane_type = 'dual_lane' THEN 1 ELSE 0 END) AS dual, COUNT(DISTINCT f.region) AS regions, COUNT(DISTINCT f.operator_name) AS operators " +
      'FROM GOLD.FRANCHISE_STORE_DIM f' + (where ? ' WHERE ' + where : ''))[0];
    scope.stores = counts.stores; scope.exposed = counts.exposed; scope.retrofitted = counts.retrofitted; scope.dual = counts.dual;
    scope.single = counts.exposed + counts.retrofitted;
    scope.regions = counts.regions; scope.operators = counts.operators;
    scope.regionOf = scope.region || (scope.operator ? e.operators[scope.operator].region : scope.store ? e.stores[scope.store].region : null);

    // Words for the scope, in the person the reader expects.
    if (scope.kind === 'operator') {
      scope.name = scope.operator;
      scope.poss = scope.own ? 'your' : fmt.possessive(scope.operator);
      scope.label = scope.poss + ' ' + scope.stores + ' ' + scope.regionOf + ' stores';
      scope.chip = scope.operator + ' · ' + scope.stores + ' ' + scope.regionOf + ' stores';
    } else if (scope.kind === 'region') {
      scope.name = 'the ' + scope.region;
      scope.poss = "the " + scope.region + "'s";
      scope.label = "the " + scope.region + "'s " + scope.stores + ' stores';
      scope.chip = scope.region + ' · ' + scope.stores + ' stores';
    } else if (scope.kind === 'store') {
      scope.name = scope.store;
      scope.poss = fmt.possessive(scope.store);
      scope.label = scope.store;
      scope.chip = scope.store + ' · ' + scope.regionOf;
    } else {
      scope.name = 'the network';
      scope.poss = "the network's";
      scope.label = 'all ' + scope.stores + ' stores';
      scope.chip = 'All regions · ' + scope.stores + ' stores';
    }
    return scope;
  }

  /** The WHERE fragment for a scope, on the store dimension alias. */
  function scopeSql(scope, alias) {
    if (!scope) return null;
    if (scope.kind === 'operator') return alias + '.operator_name = ' + lit(scope.operator);
    if (scope.kind === 'region') return alias + '.region = ' + lit(scope.region);
    if (scope.kind === 'store') return alias + '.store_name = ' + lit(scope.store);
    return null;
  }

  // -------------------------------------------------------------------
  // The compiler
  // -------------------------------------------------------------------
  /**
   * spec:
   *   model     base model name (required)
   *   by        dimension names to group by; 'OTHER_MODEL.dim' reaches across a declared join
   *   metrics   metric names; ['name', digits] overrides the rounding; 'OTHER_MODEL.metric' joins that model
   *   columns   extra select expressions: [{ sql, as }]
   *   join      other models to join even if no metric names them: ['DAILY_SALES_FACT']
   *   split     { at: 'YYYY-MM-DD', as: 'period', before: 'before', after: 'after' } adds a before/after column
   *   where     { week: 'this' | 'last' | 'YYYY-MM-DD', from, to, since, before, ranges: [[from, to], ...],
   *               exposed, lane, staging, region, operator, store, stores: [...],
   *               eq: { dimension: value | [values] }, raw: ['sql', ...] }
   *   scope     false to ignore the question's scope (default: apply it), or a scope object
   *   having, order, limit
   */
  function compile(spec, ctx) {
    var repo = models();
    var base = repo[spec.model];
    if (!base) throw new Error('No semantic model called ' + spec.model);
    var dim = repo.FRANCHISE_STORE_DIM;
    var isDim = spec.model === 'FRANCHISE_STORE_DIM';
    var time = anchors();
    var where = spec.where || {};
    var dateCol = base.dimensions.date || base.dimensions.event_date || null;
    var joins = [], used = [];

    /** Bring another model into the query through a join the base model declares. */
    function need(name) {
      if (name === spec.model) return base;
      var other = repo[name];
      if (!other) throw new Error('No semantic model called ' + name);
      if (!joins.some(function (j) { return j.model === name; })) {
        var clause = base.joins && base.joins[name];
        if (!clause) throw new Error('Model ' + spec.model + ' declares no join to ' + name);
        joins.push({ model: name, clause: clause });
      }
      return other;
    }
    function canReachStores() { return isDim || !!(base.joins && base.joins.FRANCHISE_STORE_DIM); }
    function storeAttr(name) {
      if (isDim) return base.dimensions[name];
      if (!canReachStores() || !dim.dimensions[name]) return null;
      need('FRANCHISE_STORE_DIM');
      return dim.dimensions[name];
    }
    function dimension(name) {
      if (name.indexOf('.') !== -1) {
        var parts = name.split('.');
        var other = need(parts[0]);
        if (!other.dimensions[parts[1]]) throw new Error('Model ' + parts[0] + ' has no dimension "' + parts[1] + '"');
        return other.dimensions[parts[1]];
      }
      if (base.dimensions[name]) return base.dimensions[name];
      var expr = storeAttr(name);
      if (!expr) throw new Error('Model ' + spec.model + ' has no dimension "' + name + '"');
      return expr;
    }
    function metric(name) {
      var owner = base, modelName = spec.model, short = name;
      if (name.indexOf('.') !== -1) { modelName = name.split('.')[0]; short = name.split('.')[1]; owner = need(modelName); }
      var def = owner.metrics[short];
      if (!def) throw new Error('Model ' + modelName + ' has no metric "' + short + '"');
      used.push({ model: modelName, name: short, term: def.term || null });
      return def;
    }

    (spec.join || []).forEach(need);

    var select = [], group = [];
    (spec.by || []).forEach(function (name) {
      var expr = dimension(name), short = name.split('.').pop();
      var plain = /^[a-z_]+\.[a-z_]+$/i.test(expr);             // "f.region" needs no alias; an expression does
      select.push(plain ? { sql: expr } : { sql: expr, as: short, dim: true });
      group.push(plain ? expr : short);
    });
    if (spec.split) {
      if (!dateCol) throw new Error('Model ' + spec.model + ' has no date to split on');
      var as = spec.split.as || 'period';
      select.push({ sql: 'CASE WHEN ' + dateCol + ' < ' + lit(spec.split.at) + ' THEN ' + lit(spec.split.before || 'before') + ' ELSE ' + lit(spec.split.after || 'after') + ' END', as: as, dim: true });
      group.push(as);
    }
    (spec.metrics || []).forEach(function (entry) {
      var name = Array.isArray(entry) ? entry[0] : entry;
      var def = metric(name);
      var digits = Array.isArray(entry) ? entry[1] : def.round;
      select.push({ sql: digits == null ? def.sql : 'ROUND(' + def.sql + ', ' + digits + ')', as: def.as || name.split('.').pop() });
    });
    (spec.columns || []).forEach(function (c) { select.push({ sql: c.sql, as: c.as }); });
    if (!select.length) throw new Error('Nothing to select from ' + spec.model);

    var tests = [];
    function needDate() { if (!dateCol) throw new Error('Model ' + spec.model + ' has no date to filter on'); return dateCol; }
    if (where.week) {
      var start = where.week === 'this' ? time.thisWeek.start : where.week === 'last' ? time.lastWeek.start : where.week;
      var physical = (base.columns || []).some(function (c) { return c.name === 'week_start'; });
      if (physical) tests.push(base.dimensions.week_start + ' = ' + lit(start));
      else tests.push(needDate() + ' BETWEEN ' + lit(start) + ' AND ' + lit(MCX.fmt.addDays(start, 6)));
    }
    if (where.from && where.to) tests.push(needDate() + ' BETWEEN ' + lit(where.from) + ' AND ' + lit(where.to));
    else if (where.from) tests.push(needDate() + ' >= ' + lit(where.from));
    else if (where.to) tests.push(needDate() + ' <= ' + lit(where.to));
    if (where.since) tests.push(needDate() + ' >= ' + lit(where.since));
    if (where.before) tests.push(needDate() + ' < ' + lit(where.before));
    if (where.ranges) {
      tests.push('(' + where.ranges.map(function (r) { return needDate() + ' BETWEEN ' + lit(r[0]) + ' AND ' + lit(r[1]); }).join(' OR ') + ')');
    }

    function attrTest(name, test) {
      var expr = base.dimensions[name] || storeAttr(name);
      if (!expr) throw new Error('Model ' + spec.model + ' cannot filter on ' + name);
      tests.push(test(expr));
    }
    if (where.exposed != null) {
      var lane = storeAttr('lane_type'), staging = storeAttr('has_parallel_staging');
      if (!lane) throw new Error('Model ' + spec.model + ' cannot filter on kitchen format');
      tests.push(where.exposed ? lane + " = 'single_lane' AND " + staging + ' = FALSE' : 'NOT (' + lane + " = 'single_lane' AND " + staging + ' = FALSE)');
    }
    if (where.lane) attrTest('lane_type', function (x) { return x + ' = ' + lit(where.lane); });
    if (where.staging != null) attrTest('has_parallel_staging', function (x) { return x + ' = ' + (where.staging ? 'TRUE' : 'FALSE'); });
    if (where.region) attrTest('region', function (x) { return x + ' = ' + lit(where.region); });
    if (where.operator) attrTest('operator_name', function (x) { return x + ' = ' + lit(where.operator); });
    if (where.store) attrTest('store_name', function (x) { return x + ' = ' + lit(where.store); });
    if (where.stores) attrTest('store_name', function (x) { return x + ' IN (' + where.stores.map(lit).join(', ') + ')'; });
    Object.keys(where.eq || {}).forEach(function (name) {
      var value = where.eq[name], expr = dimension(name);
      if (value === null) tests.push(expr + ' IS NULL');
      else if (Array.isArray(value)) tests.push(expr + ' IN (' + value.map(lit).join(', ') + ')');
      else tests.push(expr + ' = ' + lit(value));
    });

    // The question's scope: an operator's stores, a region, one store, or everything.
    var scope = spec.scope === false ? null : (spec.scope && spec.scope.kind ? spec.scope : ctx && ctx.scope);
    if (scope && scope.kind !== 'network') {
      if (canReachStores()) {
        if (!isDim) need('FRANCHISE_STORE_DIM');
        tests.push(scopeSql(scope, dim.alias));
      } else if (base.dimensions.region && scope.regionOf) {
        tests.push(base.dimensions.region + ' = ' + lit(scope.regionOf));   // this table stops at region
        if (ctx && scope.kind !== 'region') ctx.regionProxy = scope.regionOf;
      }
    }
    (where.raw || []).forEach(function (test) { tests.push(test); });

    var width = select.reduce(function (max, s) { return s.as ? Math.max(max, s.sql.length) : max; }, 0);
    width = Math.min(width, 64);
    var plainDims = select.filter(function (s) { return !s.as; }).map(function (s) { return s.sql; });
    var rest = select.filter(function (s) { return s.as; }).map(function (s) { return s.sql + ' '.repeat(Math.max(1, width - s.sql.length + 1)) + 'AS ' + s.as; });
    var items = (plainDims.length ? [plainDims.join(', ')] : []).concat(rest);
    var lines = ['SELECT ' + items.join(',\n       ')];
    lines.push('FROM ' + base.schema + '.' + base.name + ' ' + base.alias);
    joins.sort(function (a, b) { return (b.model === 'FRANCHISE_STORE_DIM') - (a.model === 'FRANCHISE_STORE_DIM'); });
    joins.forEach(function (j) { var m = repo[j.model]; lines.push('JOIN ' + m.schema + '.' + m.name + ' ' + m.alias + ' ' + j.clause); });
    if (tests.length) lines.push('WHERE ' + tests.join('\n  AND '));
    var aggregates = (spec.metrics || []).length + (spec.columns || []).length;
    if (group.length && aggregates) lines.push('GROUP BY ' + group.join(', '));   // a plain listing needs no grouping
    if (spec.having) lines.push('HAVING ' + spec.having);
    if (spec.order) lines.push('ORDER BY ' + spec.order);
    if (spec.limit) lines.push('LIMIT ' + spec.limit);

    return { sql: lines.join('\n'), models: [spec.model].concat(joins.map(function (j) { return j.model; })), metrics: used };
  }

  /** The SQL behind a certified metric, for use inside a custom column. */
  function metricSql(model, name) {
    var def = models()[model] && models()[model].metrics[name];
    if (!def) throw new Error('Model ' + model + ' has no metric "' + name + '"');
    return def.sql;
  }

  /** The certified tables a piece of SQL reads, e.g. ['ORDER_TIMING_MART', 'FRANCHISE_STORE_DIM']. */
  function tablesIn(sql, schema) {
    var found = [], pattern = new RegExp('\\b' + (schema || 'GOLD') + '\\.([A-Za-z_0-9]+)', 'g'), m;
    while ((m = pattern.exec(sql))) if (found.indexOf(m[1]) === -1) found.push(m[1]);
    return found;
  }

  MCX.sem = {
    anchors: anchors, entities: entities, findEntity: findEntity, resolveScope: resolveScope, scopeSql: scopeSql,
    compile: compile, metricSql: metricSql, tablesIn: tablesIn, lit: lit,
    reset: function () { cache.anchors = null; cache.entities = null; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
