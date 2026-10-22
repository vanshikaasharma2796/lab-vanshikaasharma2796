/* =====================================================================
   tools/lib/compare.js — compare two JSON values the way parity is judged

   Same keys, same array lengths and order, strings byte-identical,
   numbers equal within 1e-9 (relative). Keys named "ms" are ignored, and
   so is any string naming the SQLite version (it differs by driver).

     firstDifference(expected, actual) -> null | { path, expected, actual }
     strip(value)                      -> a copy without "ms" keys
   ===================================================================== */
'use strict';

/** A JSON copy (functions and undefined dropped, as in a file) without any "ms" key. */
function strip(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v, (key, value) => (key === 'ms' ? undefined : value)));
}

function sameNumber(a, b) {
  if (a === b) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b), 1e-300);
  return Math.abs(a - b) / scale <= 1e-9;
}

function show(v) { const s = JSON.stringify(v); return s && s.length > 160 ? s.slice(0, 157) + '…' : s; }

function firstDifference(a, b, at) {
  const where = at || '$';
  if (typeof a === 'number' && typeof b === 'number') return sameNumber(a, b) ? null : { path: where, expected: a, actual: b };
  if (typeof a === 'string' && typeof b === 'string') {
    if (a === b || (/SQLite \d/.test(a) && /SQLite \d/.test(b))) return null;
    return { path: where, expected: a, actual: b };
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b ? null : { path: where, expected: a, actual: b };
  if (Array.isArray(a) !== Array.isArray(b)) return { path: where, expected: show(a), actual: show(b) };
  if (Array.isArray(a)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) { const d = firstDifference(a[i], b[i], where + '[' + i + ']'); if (d) return d; }
    return a.length === b.length ? null : { path: where + '.length', expected: a.length, actual: b.length };
  }
  const ka = Object.keys(a).filter((k) => k !== 'ms'), kb = Object.keys(b).filter((k) => k !== 'ms');
  for (const k of ka) {
    if (!(k in b)) return { path: where + '.' + k, expected: show(a[k]), actual: '(missing)' };
    const d = firstDifference(a[k], b[k], where + '.' + k);
    if (d) return d;
  }
  for (const k of kb) if (!(k in a)) return { path: where + '.' + k, expected: '(missing)', actual: show(b[k]) };
  return null;
}

module.exports = { strip, firstDifference, show };
