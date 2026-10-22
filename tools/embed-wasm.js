#!/usr/bin/env node
/* =====================================================================
   tools/embed-wasm.js — pack the SQLite binary for the page

   A page opened by double-click (file://) is not allowed to fetch a
   .wasm file, so the page loads vendor/sqljs/sql-wasm-binary.js instead:
   the same bytes, written out as base64 in a script.

   Run this only after replacing vendor/sqljs/ with another sql.js
   release:   node tools/embed-wasm.js
   ===================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'vendor', 'sqljs');
const wasm = fs.readFileSync(path.join(dir, 'sql-wasm.wasm'));
const loader = fs.readFileSync(path.join(dir, 'sql-wasm.js'), 'utf8');

// The release number is not written inside the files, so it is kept here. Change it when you change the files.
const RELEASE = '1.14.2';
if (!/initSqlJs/.test(loader)) throw new Error('vendor/sqljs/sql-wasm.js does not look like the sql.js loader');

const out =
  '/* sql.js ' + RELEASE + ' (SQLite compiled to WebAssembly), embedded as base64 so the page can load it from a double-click (file://),\n' +
  '   where the browser will not fetch a .wasm file. Generated from vendor/sqljs/sql-wasm.wasm by tools/embed-wasm.js. */\n' +
  'window.MCX_SQL_WASM_BASE64 = "' + wasm.toString('base64') + '";\n';

const target = path.join(dir, 'sql-wasm-binary.js');
const before = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
fs.writeFileSync(target, out);
console.log('vendor/sqljs/sql-wasm-binary.js: ' + (wasm.length / 1024).toFixed(0) + ' KB of WebAssembly as ' +
  (out.length / 1024).toFixed(0) + ' KB of script' + (before === out ? ' (unchanged)' : ' (updated)') + '.');
