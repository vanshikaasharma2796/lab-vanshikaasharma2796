#!/usr/bin/env node
/* =====================================================================
   tools/sql.js — run SQL against the demo warehouse

     node tools/sql.js "SELECT region, COUNT(*) FROM GOLD.FRANCHISE_STORE_DIM GROUP BY region"
     node tools/sql.js --tables            list every table with its columns and row count

   The warehouse is SQLite in memory with two schemas, GOLD and BRONZE.
   ===================================================================== */
'use strict';
const { MCX, openWarehouse } = require('./lib/load');

openWarehouse().then((stats) => {
  const arg = process.argv.slice(2).join(' ').trim();
  if (!arg || arg === '--tables') {
    stats.tables.forEach((t) => console.log((t.schema + '.' + t.name).padEnd(34) + String(t.rows).padStart(7) + ' rows   ' + t.columns.join(', ')));
    console.log('\n' + stats.rows + ' rows in ' + stats.tables.length + ' tables, built in ' + stats.ms + ' ms. ' + stats.engine);
    return;
  }
  const result = MCX.db.query(arg);
  console.log(result.columns.join(' | '));
  result.rows.forEach((row) => console.log(result.columns.map((c) => row[c]).join(' | ')));
  console.log('(' + result.rows.length + ' rows, ' + result.ms.toFixed(1) + ' ms)');
}).catch((error) => { console.error(error.message); process.exitCode = 1; });
