/* =====================================================================
   warehouse/db.js — the warehouse itself

   A real SQL database running in the page: SQLite compiled to
   WebAssembly (sql.js). It stands in for the company warehouse. Two
   schemas, GOLD (certified) and BRONZE (raw), filled by warehouse/seed.js.

     await MCX.db.open()        build the warehouse (once)
     MCX.db.query(sql)          -> { columns, rows, ms }   rows are objects
     MCX.db.stats               -> { tables, rows, ms } after open()
     MCX.db.run(sql, params)    a statement that writes (the service layer's
                                OPS schema: write-back of approved actions)

   Every query the analysts show is run through MCX.db.query, so the rows,
   the row counts and the timings on screen are real.
   ===================================================================== */
(function (global) {
  'use strict';
  var MCX = (global.MCX = global.MCX || {});
  var db = null;
  var opening = null;

  function now() { return global.performance && global.performance.now ? global.performance.now() : Date.now(); }

  function wasmBytes() {
    var base64 = global.MCX_SQL_WASM_BASE64;
    if (!base64) return null;
    var text = global.atob(base64);
    var bytes = new Uint8Array(text.length);
    for (var i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    return bytes;
  }

  /**
   * Build the warehouse. In the page this needs no arguments. Tools running
   * under Node pass { initSqlJs, wasmBinary }.
   */
  function open(options) {
    if (opening) return opening;
    options = options || {};
    var init = options.initSqlJs || global.initSqlJs;
    if (!init) return Promise.reject(new Error('sql.js is not loaded'));
    var started = now();
    opening = init({ wasmBinary: options.wasmBinary || wasmBytes() }).then(function (SQL) {
      db = new SQL.Database();
      var stats = MCX.warehouse.load(db);
      stats.ms = Math.round(now() - started);
      stats.engine = 'SQLite ' + query('SELECT sqlite_version() AS v').rows[0].v + ' (sql.js, in memory)';
      MCX.db.stats = stats;
      return stats;
    });
    return opening;
  }

  /** Run one SQL statement and return its rows as objects. */
  function query(sql) {
    if (!db) throw new Error('The warehouse is not open yet');
    var started = now();
    var statement;
    try {
      statement = db.prepare(sql);
    } catch (error) {
      throw new Error('SQL error: ' + error.message + '\n' + sql);
    }
    var columns = statement.getColumnNames();
    var rows = [];
    try {
      while (statement.step()) rows.push(statement.getAsObject());
    } catch (error) {
      throw new Error('SQL error: ' + error.message + '\n' + sql);
    } finally {
      statement.free();
    }
    return { columns: columns, rows: rows, ms: now() - started };
  }

  /** Run one statement that changes something (no rows back). params: an array for the ? placeholders. */
  function run(sql, params) {
    if (!db) throw new Error('The warehouse is not open yet');
    try {
      db.run(sql, params || []);
    } catch (error) {
      throw new Error('SQL error: ' + error.message + '\n' + sql);
    }
  }

  MCX.db = { open: open, query: query, run: run, stats: null, isOpen: function () { return !!db; } };
})(typeof window !== 'undefined' ? window : globalThis);
