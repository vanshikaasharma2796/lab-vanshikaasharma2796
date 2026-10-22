/* =====================================================================
   tools/lib/node-service.js — MCX.service under Node

   Loads the engine the way the page does (tools/lib/load.js), builds the
   warehouse, and creates the service with:

     storage   files under varDir (default: memory when no varDir)
     mode      'files': a deployed change is written into context/, the
                        bundle is rebuilt and the engine reloads (server)
               'overlay': changes are kept in storage only (scripted runs,
                        MCP, tests: nothing in context/ is touched)
     watch     keep fresh (B4): watch context/ and reload on any change.
               fs.watch with a debounce; recursive where the platform has
               it (Windows, macOS, Linux on Node 20+), one watcher per
               folder where it does not, and polling of file times if
               watching fails altogether.

     const { createNodeService } = require('./lib/node-service');
     const service = await createNodeService({ varDir, mode: 'files', watch: true });
   ===================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { MCX, root, openWarehouse } = require('./load');
const { createFileStorage } = require('./file-storage');
const { build } = require('./context-build');
const contextFiles = require('./context-files');

const CONTEXT = path.join(root, 'context');

/** Every file under dir except bundle.js, with its modification time: a signature for polling. */
function signature(dir) {
  const parts = [];
  (function walk(d) {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).forEach((e) => {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name !== 'bundle.js') { try { parts.push(full + ':' + fs.statSync(full).mtimeMs); } catch (err) { /* gone */ } }
    });
  })(dir);
  return parts.join('|');
}

function folders(dir) {
  const out = [dir];
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => { if (e.isDirectory()) folders(path.join(dir, e.name)).forEach((d) => out.push(d)); });
  return out;
}

/**
 * Watch dir; call onChange() once things settle (debounce ms). Returns { close, how }.
 */
function watchContext(dir, onChange, options) {
  options = options || {};
  const debounce = options.debounce || 400;
  let timer = null, closed = false;
  const watchers = [];
  function poke(name) {
    if (closed || (name && path.basename(String(name)) === 'bundle.js')) return;
    clearTimeout(timer);
    timer = setTimeout(() => { if (!closed) onChange(); }, debounce);
  }
  let how = null;
  if (!options.poll) {
    try {
      watchers.push(fs.watch(dir, { recursive: true }, (event, name) => poke(name)));
      how = 'fs.watch (recursive)';
    } catch (error) {
      try {
        folders(dir).forEach((d) => watchers.push(fs.watch(d, (event, name) => poke(name))));
        how = 'fs.watch (one per folder)';
      } catch (e2) {
        watchers.forEach((w) => { try { w.close(); } catch (e) { /* ignore */ } });
        watchers.length = 0;
      }
    }
    watchers.forEach((w) => w.on('error', () => { /* a folder went away; polling below still covers it */ }));
  }
  let poller = null;
  if (!watchers.length) {
    let last = signature(dir);
    poller = setInterval(() => { const now = signature(dir); if (now !== last) { last = now; poke(null); } }, options.interval || 2000);
    if (poller.unref) poller.unref();
    how = 'polling every ' + ((options.interval || 2000) / 1000) + ' s';
  }
  return {
    how,
    close() { closed = true; clearTimeout(timer); watchers.forEach((w) => { try { w.close(); } catch (e) { /* ignore */ } }); if (poller) clearInterval(poller); }
  };
}

/**
 * options: { varDir, mode: 'files' | 'overlay', contextDir, clock, ids, settings, watch, log }
 */
async function createNodeService(options) {
  const o = options || {};
  const log = o.log || ((line) => process.stderr.write(line + '\n'));
  await openWarehouse();
  const contextDir = path.resolve(o.contextDir || CONTEXT);
  if (contextDir !== path.resolve(CONTEXT)) { MCX.contextRepo = build(contextDir).repo; MCX.engine.invalidate(); }
  const storage = o.varDir ? createFileStorage(path.resolve(o.varDir)) : MCX.storage.memory();
  const mode = o.mode === 'files' ? 'files' : 'overlay';
  const hooks = mode === 'files' ? {
    persist: (change) => contextFiles.writeChange(contextDir, change),
    restore: (files) => contextFiles.restore(contextDir, files),
    reload: () => build(contextDir, { write: true }).repo
  } : {};
  const service = MCX.createService({ storage, clock: o.clock, ids: o.ids, settings: o.settings, mode, hooks });
  await service.ready();
  let watcher = null;
  if (o.watch) {
    watcher = watchContext(contextDir, () => {
      let repo;
      try { repo = build(contextDir, { write: true }).repo; } catch (error) { log('context/ changed but does not build: ' + error.message + ' (keeping the last good version)'); return; }
      service.reload(repo).then((r) => { if (r.changed) log('context/ changed: reloaded, version ' + r.previous + ' -> ' + r.version); },
        (error) => log('reload failed: ' + error.message));
    }, o.watchOptions);
  }
  service.watching = watcher ? watcher.how : null;
  service.close = () => { if (watcher) watcher.close(); };
  service.contextDir = contextDir;
  return service;
}

module.exports = { createNodeService, watchContext, signature, MCX, root };
