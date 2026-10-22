/* =====================================================================
   src/engine/guard.js — screening a question before anything runs

   The first step on the context side. A question is checked for:

     length              longer than engine.guard.maxLength characters
     prompt-injection    "ignore previous instructions", "reveal your
                         system prompt", "you are now", "act as", jailbreaks
     sql-injection       "; drop", "union select", "or 1=1", comment tails
     script-injection    "<script", "javascript:", "onerror="
     data-exfiltration   every customer's emails or phones, "export
                         everything", "dump the database"
     credentials         passwords, API keys, tokens, connection strings
     pii-*               an email, a phone number or a card number in the
                         question itself

   Any of the first six blocks the question. Personal data in an
   otherwise fine question is masked, not blocked: the question goes on
   with the data replaced (j***@example.com, ***-***-0182).

   MCX.guard.check(question) -> { verdict: 'pass'|'masked'|'blocked', findings: [{ rule, severity, text }], clean }
   MCX.guard.mask(text)      -> text with personal data masked
   MCX.guard.findPii(text)   -> [{ rule, text }] unmasked personal data found
   ===================================================================== */
(function (global) {
  'use strict';
  var MCX = (global.MCX = global.MCX || {});

  function settings() { return ((MCX.config && MCX.config.engine) || {}).guard || {}; }

  // Rules that block, in the order they are checked. Each pattern runs on the lower-cased question.
  var BLOCK = [
    { rule: 'prompt-injection', patterns: [
      /\b(ignore|disregard|forget|override)\b[^.?!]{0,40}\b(previous|prior|above|earlier|all|any|your|the|these)\b[^.?!]{0,30}\b(instructions?|rules?|prompts?|polic(y|ies)|guardrails?|context)\b/,
      /\b(reveal|show|print|repeat|leak|output|tell me)\b[^.?!]{0,30}\b(system prompt|hidden prompt|initial prompt|your (instructions|prompt|rules)|pinned instructions)\b/,
      /\byou are now\b/,
      /\bact as\b/,
      /\bpretend (to be|you are|you're)\b/,
      /\bjailbreak|\bdan mode\b|\bdeveloper mode\b/,
      /\b(bypass|disable|turn off|get around)\b[^.?!]{0,30}\b(polic(y|ies)|guard|guardrails?|filters?|scope|restrictions?|masking)\b/
    ] },
    { rule: 'sql-injection', patterns: [
      /;\s*(drop|delete|insert|update|alter|truncate|create|attach)\b/,
      /\bunion\s+(all\s+)?select\b/,
      /\bdrop\s+(table|schema|database)\b/,
      /'\s*(or|and)\s+'?\d+'?\s*=\s*'?\d+/,
      /\bor\s+1\s*=\s*1\b/,
      /'\s*--|;\s*--|--\s*$/,
      /\/\*[\s\S]*\*\//
    ] },
    { rule: 'script-injection', patterns: [/<\s*\/?\s*script\b/, /\bjavascript\s*:/, /\bon(error|load|click|mouseover)\s*=/, /<\s*iframe\b/] },
    { rule: 'data-exfiltration', patterns: [
      /\b(all|every|each|full list of|list of|list all|export|download|dump)\b[^.?!]{0,30}\bcustomers?'?s?\b[^.?!]{0,25}\b(emails?|e-mails?|phones?|phone numbers?|addresses|personal data|contact details|card numbers?)\b/,
      /\b(emails?|phone numbers?|addresses|contact details)\b[^.?!]{0,20}\bof (all|every) customers?\b/,
      /\bexport (everything|all( the)? (data|tables|records|customers|tickets))\b/,
      /\bdump (the |all )?(database|warehouse|tables|data)\b/,
      /\b(download|copy) (the )?(whole|entire|full) (database|warehouse)\b/
    ] },
    { rule: 'credentials', patterns: [/\b(passwords?|credentials?|api[ -]?keys?|access tokens?|secret keys?|connection strings?|private keys?)\b/] }
  ];
  var MESSAGES = {
    length: 'longer than the guard allows',
    'prompt-injection': 'tries to change or reveal the instructions the engine follows',
    'sql-injection': 'contains SQL that could change or read past the warehouse rules',
    'script-injection': 'contains script markup',
    'data-exfiltration': 'asks for personal or bulk data no answer may contain',
    credentials: 'asks for credentials or secrets'
  };

  // Personal data, in the order it is masked (cards first: they contain phone-length digit runs).
  var CARD = /\b(?:\d[ -]?){12,18}\d\b/g;
  var EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
  var PHONE = /(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\b\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/g;

  function luhn(digits) {
    var sum = 0, double = false;
    for (var i = digits.length - 1; i >= 0; i--) {
      var d = digits.charCodeAt(i) - 48;
      if (double) { d *= 2; if (d > 9) d -= 9; }
      sum += d; double = !double;
    }
    return sum % 10 === 0;
  }
  function digitsOf(text) { return String(text).replace(/\D/g, ''); }
  function isCard(text) { var d = digitsOf(text); return d.length >= 13 && d.length <= 19 && luhn(d); }

  function maskEmail(text) {
    var at = text.indexOf('@');
    return text.charAt(0) + '***' + text.slice(at);
  }
  function maskPhone(text) { return '***-***-' + digitsOf(text).slice(-4); }
  function maskCard(text) { return '****-****-****-' + digitsOf(text).slice(-4); }

  /** Every piece of personal data in a text: [{ rule, text, at }] in the order found (cards, emails, phones). */
  function findPii(text) {
    var s = String(text == null ? '' : text), out = [], taken = [];
    function free(start, end) { return !taken.some(function (t) { return start < t[1] && end > t[0]; }); }
    function scan(pattern, rule, test) {
      pattern.lastIndex = 0;
      var m;
      while ((m = pattern.exec(s))) {
        var start = m.index, end = m.index + m[0].length;
        if ((!test || test(m[0])) && free(start, end)) { out.push({ rule: rule, text: m[0], at: start }); taken.push([start, end]); }
      }
    }
    scan(CARD, 'pii-card', isCard);
    scan(EMAIL, 'pii-email');
    scan(PHONE, 'pii-phone', function (hit) { return /\*/.test(hit) ? false : digitsOf(hit).length >= 10; });
    return out;
  }

  /** The text with every email, phone number and card number masked. */
  function mask(text) {
    var s = String(text == null ? '' : text);
    var found = findPii(s).sort(function (a, b) { return b.at - a.at; });   // replace from the end so positions hold
    found.forEach(function (f) {
      var masked = f.rule === 'pii-email' ? maskEmail(f.text) : f.rule === 'pii-card' ? maskCard(f.text) : maskPhone(f.text);
      s = s.slice(0, f.at) + masked + s.slice(f.at + f.text.length);
    });
    return s;
  }

  function check(question) {
    var raw = String(question == null ? '' : question);
    var lower = raw.toLowerCase().replace(/[’‘]/g, "'");
    var findings = [];
    var max = settings().maxLength || 500;
    if (raw.length > max) findings.push({ rule: 'length', severity: 'high', text: raw.length + ' characters; the limit is ' + max });
    BLOCK.forEach(function (group) {
      for (var i = 0; i < group.patterns.length; i++) {
        var m = group.patterns[i].exec(lower);
        if (m) { findings.push({ rule: group.rule, severity: 'high', text: mask(raw.substr(m.index, m[0].length)).trim() || m[0] }); break; }
      }
    });
    var blocked = findings.length > 0;
    findPii(raw).forEach(function (p) {
      findings.push({ rule: p.rule, severity: 'medium', text: mask(p.text) });
    });
    var verdict = blocked ? 'blocked' : findings.length ? 'masked' : 'pass';
    return {
      verdict: verdict,
      findings: findings,
      clean: mask(raw),
      reason: blocked ? findings.filter(function (f) { return f.severity === 'high'; }).map(function (f) { return MESSAGES[f.rule]; }).join('; ') : null
    };
  }

  MCX.guard = { check: check, mask: mask, findPii: findPii, messages: MESSAGES };
})(typeof window !== 'undefined' ? window : globalThis);
