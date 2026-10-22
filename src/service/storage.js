/* =====================================================================
   src/service/storage.js — where the service keeps its state

   The service (src/service/service.js) keeps everything with state in a
   handful of keys: the answer log, feedback, the audit chain, changes,
   versions, the action queue, the outbox and a few counters. A storage
   is anything with read(key, fallback) and write(key, value):

     MCX.storage.memory()          in memory (tests, the scripted scenario)
     MCX.storage.local('mcx.')     the browser's localStorage; every access
                                   is wrapped, and when localStorage is not
                                   there (private window, blocked site data,
                                   file:// in some browsers) it falls back to
                                   memory for the rest of the visit
     tools/lib/file-storage.js     Node: one file per key under var/

   Values are plain JSON. read() returns a fresh copy, so the caller may
   change what it gets without touching what is stored.
   ===================================================================== */
(function (global) {
  'use strict';
  var MCX = (global.MCX = global.MCX || {});

  function copy(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }

  /** Everything in memory. */
  function memory() {
    var data = {};
    return {
      kind: 'memory',
      read: function (key, fallback) { return key in data ? copy(data[key]) : copy(fallback); },
      write: function (key, value) { data[key] = copy(value); },
      keys: function () { return Object.keys(data); }
    };
  }

  /** The browser's localStorage under a prefix, falling back to memory when it cannot be used. */
  function local(prefix) {
    prefix = prefix || 'mcx.service.';
    var spare = memory();
    var store = null;
    try {
      store = global.localStorage || null;
      if (store) { var probe = prefix + '__probe'; store.setItem(probe, '1'); store.removeItem(probe); }
    } catch (error) { store = null; }
    var out = {
      kind: store ? 'localStorage' : 'memory (localStorage unavailable)',
      read: function (key, fallback) {
        if (!store) return spare.read(key, fallback);
        try {
          var text = store.getItem(prefix + key);
          return text == null ? copy(fallback) : JSON.parse(text);
        } catch (error) {
          return spare.read(key, fallback);
        }
      },
      write: function (key, value) {
        spare.write(key, value);
        if (!store) return;
        try { store.setItem(prefix + key, JSON.stringify(value)); } catch (error) {
          // Quota exceeded or storage switched off mid-visit: keep going in memory.
          store = null;
          out.kind = 'memory (localStorage failed: ' + (error && error.name || 'error') + ')';
        }
      },
      keys: function () {
        if (!store) return spare.keys();
        try {
          var keys = [];
          for (var i = 0; i < store.length; i++) { var k = store.key(i); if (k && k.indexOf(prefix) === 0) keys.push(k.slice(prefix.length)); }
          return keys;
        } catch (error) { return spare.keys(); }
      },
      /** Remove every key under the prefix (a fresh start for this browser). */
      clear: function () {
        var keys = out.keys();
        keys.forEach(function (k) { try { if (store) store.removeItem(prefix + k); } catch (error) { /* ignore */ } });
        spare = memory();
      }
    };
    return out;
  }

  MCX.storage = { memory: memory, local: local };
})(typeof window !== 'undefined' ? window : globalThis);
