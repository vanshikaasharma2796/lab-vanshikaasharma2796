#!/usr/bin/env node
/* =====================================================================
   tools/lifecycle.js — bring changes deployed in the page into context/

     node tools/lifecycle.js apply <changes.json>             write them, rebuild
     node tools/lifecycle.js apply <changes.json> --dry-run   show what would change
     node tools/lifecycle.js apply <file> --context <dir>     another copy of context/

   In the page (opened by double-click) a deployed change lives as an
   overlay in the browser's storage; "Export changes"
   (MCX.service.downloadChanges()) saves them as JSON
   (format "mccontext-changes/1"). This writes each change, in order, into
   the file it belongs to (tools/lib/context-files.js) and rebuilds
   context/bundle.js, so the change is in the files for everyone.
   ===================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { build } = require('./lib/context-build');
const contextFiles = require('./lib/context-files');

function main() {
  const args = process.argv.slice(2);
  const words = [];
  let contextDir = path.join(__dirname, '..', 'context'), dry = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') dry = true;
    else if (args[i] === '--context') contextDir = path.resolve(args[++i]);
    else words.push(args[i]);
  }
  if (words[0] !== 'apply' || !words[1]) {
    console.log('Usage: node tools/lifecycle.js apply <changes.json> [--dry-run] [--context <dir>]');
    process.exitCode = words.length ? 1 : 0;
    return;
  }
  const data = JSON.parse(fs.readFileSync(path.resolve(words[1]), 'utf8'));
  if (data.format !== 'mccontext-changes/1' || !Array.isArray(data.changes)) throw new Error(words[1] + ' is not an export of changes (format mccontext-changes/1)');
  const before = build(contextDir).repo;
  const MCX = require('./lib/load').MCX;
  const version = (repo) => MCX.sha256(MCX.canonicalJson(repo)).slice(0, 12);
  console.log('context/ is at version ' + version(before) + '; the export was made from ' + data.base + ' and ends at ' + data.current + '.');
  if (!data.changes.length) { console.log('Nothing to apply.'); return; }
  data.changes.forEach((c) => {
    if (dry) { const file = contextFiles.absolute(contextDir, c.file); const text = fs.readFileSync(file, 'utf8'); const next = contextFiles.nextText(contextDir, c, text); console.log((text === next ? '= ' : '~ ') + c.id + '  ' + c.kind + ' ' + c.target + '  → ' + c.file); return; }
    contextFiles.writeChange(contextDir, c);
    console.log('✓ ' + c.id + '  ' + c.kind + ' ' + c.target + '  → ' + c.file + '  (approved by ' + (c.approvedBy || '?') + ')');
  });
  if (dry) return;
  const after = build(contextDir, { write: 'always' });
  console.log('context/bundle.js rebuilt: version ' + version(after.repo) + (data.current && version(after.repo) === data.current ? ' (the same as in the page)' : '') + '.');
}

try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
