/* =====================================================================
   src/service/audit.js — the audit trail as a hash chain (G2)

   Every answer, feedback, decision, write-back, change step, rollback
   and purge is one entry. Each entry carries the hash of the entry
   before it, and its own hash covers its content and that link:

     hash = sha256(canonicalJson({ id, seq, at, type, actor, subject, data, prev }))

   Changing, removing or reordering any entry breaks every hash after it,
   which verify() finds. The first entry links to GENESIS (64 zeros).
   When retention purges old entries the chain keeps an anchor: the hash
   and sequence number of the last purged entry, so the entries that are
   left still verify.

     MCX.audit.entry(prevHash, seq, fields)   -> a new entry with its hash
     MCX.audit.verify(entries, anchor)        -> { ok, checked, broken }
   ===================================================================== */
(function (global) {
  'use strict';
  var MCX = (global.MCX = global.MCX || {});
  var GENESIS = '0000000000000000000000000000000000000000000000000000000000000000';

  function body(e) {
    return { id: e.id, seq: e.seq, at: e.at, type: e.type, actor: e.actor, subject: e.subject, data: e.data, prev: e.prev };
  }
  function hashOf(e) { return MCX.sha256(MCX.canonicalJson(body(e))); }

  /** A new entry: fields { id, at, type, actor, subject, data }. */
  function entry(prev, seq, fields) {
    var e = { id: fields.id, seq: seq, at: fields.at, type: fields.type, actor: fields.actor == null ? null : fields.actor,
      subject: fields.subject == null ? null : fields.subject, data: fields.data == null ? {} : fields.data, prev: prev || GENESIS };
    e.hash = hashOf(e);
    return e;
  }

  /** Recompute the chain. anchor: { seq, hash } of the last purged entry, or null. */
  function verify(entries, anchor) {
    var prev = anchor && anchor.hash ? anchor.hash : GENESIS;
    var seq = anchor && anchor.seq ? anchor.seq : 0;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e.prev !== prev) return { ok: false, checked: i, broken: { id: e.id, seq: e.seq, reason: 'does not link to the entry before it' } };
      if (e.seq !== seq + 1) return { ok: false, checked: i, broken: { id: e.id, seq: e.seq, reason: 'out of sequence (expected ' + (seq + 1) + ')' } };
      if (hashOf(e) !== e.hash) return { ok: false, checked: i, broken: { id: e.id, seq: e.seq, reason: 'its content does not match its hash' } };
      prev = e.hash;
      seq = e.seq;
    }
    return { ok: true, checked: entries.length, broken: null };
  }

  MCX.audit = { GENESIS: GENESIS, entry: entry, verify: verify, hashOf: hashOf };
})(typeof window !== 'undefined' ? window : globalThis);
