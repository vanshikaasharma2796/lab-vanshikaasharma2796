/* =====================================================================
   src/engine/format.js — turning numbers and dates into words

   Every figure in a live answer goes through one of these, so the same
   quantity always reads the same way.   MCX.fmt
   ===================================================================== */
(function (global) {
  'use strict';
  var MCX = (global.MCX = global.MCX || {});

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

  function toDate(iso) { var p = String(iso).split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function round(x, digits) { var p = Math.pow(10, digits || 0); return Math.round(x * p) / p; }

  /** 1234.5 -> "1,235"; n(1234.56, 1) -> "1,234.6" */
  function n(x, digits) {
    var value = round(Number(x), digits || 0);
    var parts = value.toFixed(digits || 0).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }

  var fmt = {
    round: round,
    n: n,

    /** "203 sec" */
    sec: function (x) { return n(x) + ' sec'; },
    /** "$1,640" */
    usd: function (x, digits) { return '$' + n(x, digits || 0); },
    /** Thousands: "$44k", "$4.4k", "$860", and "$2.8 million" from a million up. */
    k: function (x) {
      var v = Math.abs(Number(x)), sign = x < 0 ? '-' : '';
      if (v >= 1e6) return sign + '$' + n(v / 1e6, 1) + ' million';
      if (v >= 9950) return sign + '$' + n(v / 1000) + 'k';
      if (v >= 1000) return sign + '$' + n(v / 1000, 1) + 'k';
      return sign + '$' + n(v);
    },
    /** "$44k–$54k" */
    kRange: function (lo, hi) { return fmt.k(lo) + '–' + fmt.k(hi); },
    /** "58%" */
    pct: function (x, digits) { return n(x, digits || 0) + '%'; },
    /** "+47" or "−3" (a true minus sign) */
    signed: function (x, digits) { var v = round(x, digits || 0); return (v > 0 ? '+' : v < 0 ? '−' : '') + n(Math.abs(v), digits || 0); },
    /** "25–30" */
    range: function (lo, hi, digits) { return n(lo, digits || 0) + '–' + n(hi, digits || 0); },
    /** "a, b and c" */
    list: function (items, word) {
      items = items.filter(function (x) { return x != null && x !== ''; });
      if (items.length <= 1) return items.join('');
      return items.slice(0, -1).join(', ') + ' ' + (word || 'and') + ' ' + items[items.length - 1];
    },
    /** "1 store", "6 stores" */
    plural: function (count, noun, plural) { return n(count) + ' ' + (Number(count) === 1 ? noun : (plural || noun + 's')); },
    /** "six" for small counts, digits otherwise */
    word: function (count) { return count >= 0 && count <= 12 && count === Math.round(count) ? WORDS[count] : n(count); },
    cap: function (text) { return text.charAt(0).toUpperCase() + text.slice(1); },

    /** "May 7" */
    date: function (iso) { var d = toDate(iso); return MONTHS_LONG[d.getUTCMonth()] + ' ' + d.getUTCDate(); },
    /** "Thursday May 7" */
    dayDate: function (iso) { var d = toDate(iso); return DAYS[d.getUTCDay()] + ' ' + MONTHS_LONG[d.getUTCMonth()] + ' ' + d.getUTCDate(); },
    weekday: function (iso) { return DAYS[toDate(iso).getUTCDay()]; },
    month: function (iso) { return MONTHS_LONG[toDate(iso).getUTCMonth()]; },
    monthShort: function (iso) { return MONTHS[toDate(iso).getUTCMonth()]; },
    /** "May 11–13", "April 27–May 3" */
    dateRange: function (from, to) {
      var a = toDate(from), b = toDate(to);
      if (from === to) return fmt.date(from);
      if (a.getUTCMonth() === b.getUTCMonth()) return MONTHS_LONG[a.getUTCMonth()] + ' ' + a.getUTCDate() + '–' + b.getUTCDate();
      return fmt.date(from) + '–' + fmt.date(to);
    },
    addDays: function (iso, days) { var d = toDate(iso); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); },
    daysBetween: function (a, b) { return Math.round((toDate(b) - toDate(a)) / 86400000); },

    /** Name's -> "Marcus J. Williams's", "the Southeast's" */
    possessive: function (name) { return name + "'s"; }
  };

  MCX.fmt = fmt;
})(typeof window !== 'undefined' ? window : globalThis);
