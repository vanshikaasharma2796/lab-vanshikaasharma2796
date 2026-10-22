/* =====================================================================
   tools/lib/file-storage.js — the service's storage under Node: files

   One file per key in a folder (var/ by default, gitignored, created on
   the first write). Append-only histories are JSON Lines, one record per
   line; the rest are JSON:

     var/log.jsonl  feedback.jsonl  audit.jsonl  outbox.jsonl
     var/changes.json  versions.json  actions.json  counters.json  ...

   Writes go to a temporary file first and are then renamed over the old
   one, so a crash never leaves half a file.
   ===================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const JSONL = ['log', 'feedback', 'audit', 'outbox'];

function copy(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }

function createFileStorage(dir) {
  const fileOf = (key) => path.join(dir, key + (JSONL.indexOf(key) !== -1 ? '.jsonl' : '.json'));
  function write(file, text) {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, text);
    try { fs.renameSync(tmp, file); } catch (error) {
      // Windows can refuse a rename over a file another process has open: write in place instead.
      fs.writeFileSync(file, text);
      try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ }
    }
  }
  return {
    kind: 'files',
    dir,
    read(key, fallback) {
      const file = fileOf(key);
      if (!fs.existsSync(file)) return copy(fallback);
      const text = fs.readFileSync(file, 'utf8');
      if (JSONL.indexOf(key) !== -1) return text.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
      return text.trim() ? JSON.parse(text) : copy(fallback);
    },
    write(key, value) {
      const text = JSONL.indexOf(key) !== -1 && Array.isArray(value)
        ? value.map((v) => JSON.stringify(v)).join('\n') + (value.length ? '\n' : '')
        : JSON.stringify(value, null, 1) + '\n';
      write(fileOf(key), text);
    },
    keys() {
      return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.jsonl?$/.test(f)).map((f) => f.replace(/\.jsonl?$/, '')) : [];
    }
  };
}

module.exports = { createFileStorage, JSONL };
