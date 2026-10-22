/* =====================================================================
   tools/lib/checks.js — what every answer has to get right

   checkLive(result)      an answer the engine just produced
   checkRecorded(pair)    a recorded replay from data/*.js

   Both return a list of problems; an empty list is a pass.
   ===================================================================== */
'use strict';

const { MCX } = require('./load');

function toolKeys(steps) {
  const keys = new Set();
  steps.forEach((step) => { const tool = MCX.script.describeTool(step); if (tool) keys.add(tool.key); });
  return keys;
}

/** Checks on one live result from MCX.engine.ask(). */
function checkLive(result) {
  const problems = [];
  ['context', 'bare'].forEach((side) => {
    const t = result[side];
    t.problems.forEach((p) => problems.push(side + ': ' + p));
    if (!t.answer.trim()) problems.push(side + ': empty answer');
    const bad = /\b(undefined|NaN|null|Infinity)\b|\[object Object\]/.exec(t.answer + ' ' + t.steps.map((s) => s.say || '').join(' '));
    if (bad) problems.push(side + ': "' + bad[0] + '" in the text');
    if (/\$-|--\d|\d\.\d{4,}/.test(t.answer)) problems.push(side + ': a number looks unformatted');
    const keys = t.steps.filter((s) => s.sql).map((s) => s.key);
    keys.forEach((k, i) => { if (keys.indexOf(k) !== i) problems.push(side + ': query key used twice: ' + k); });
  });
  const c = result.context;
  if (!c.marks.some((m) => m.good)) problems.push('context: no highlighted finding');
  c.marks.filter((m) => m.good && !m.from.length).forEach((m) => problems.push('context: no source for "' + m.good + '"'));
  // Context engine v2: every answer is screened, validated and scored.
  if (!result.guard || !result.decision || !result.validation || !result.quality) problems.push('context engine: guard, decision, validation or quality missing');
  else if (!result.validation.ok) problems.push('validation failed: ' + result.validation.checks.filter((x) => !x.ok).map((x) => x.id + ' (' + x.detail + ')').join(', '));
  if (result.route.kind === 'none' || result.route.kind === 'blocked') return problems;   // nothing certified to run: no queries expected

  ['context', 'bare'].forEach((side) => { if (!result[side].steps.some((s) => s.sql)) problems.push(side + ': no query was run'); });
  if (!result.bare.marks.some((m) => m.bad)) problems.push('bare: no highlighted gap');
  // Everything that was loaded has to be used: a model read by a query, a skill cited by a finding.
  const cited = new Set([].concat(...c.marks.filter((m) => m.good).map((m) => m.from)));
  result.pack.models.forEach((m) => { if (!c.steps.some((s) => s.sql && s.sql.includes('.' + m.id + ' '))) problems.push('context: model ' + m.id + ' was loaded but no query reads it'); });
  result.pack.skills.forEach((s) => { if (!cited.has('skill:' + s.id)) problems.push('context: skill ' + s.id + ' is loaded but no finding cites it'); });
  return problems;
}

/** Checks on one recorded pair: { bare: { steps, answer, marks }, context: { ... } }. */
function checkRecorded(pair) {
  const problems = [];
  ['bare', 'context'].forEach((side) => {
    const t = pair[side];
    if (!t) { problems.push(side + ': missing'); return; }
    if (!Array.isArray(t.steps) || !t.steps.length) problems.push(side + ': no steps');
    if (!String(t.answer || '').trim()) problems.push(side + ': empty answer');
    (t.steps || []).forEach((step, i) => {
      if (step.say == null && !MCX.script.describeTool(step)) problems.push(side + ': step ' + (i + 1) + ' is neither a reasoning line nor a tool call');
    });
    const keys = toolKeys(t.steps || []);
    (t.marks || []).forEach((mark) => {
      const phrase = mark.good != null ? mark.good : mark.bad;
      if (!phrase || String(t.answer).indexOf(phrase) === -1) problems.push(side + ': highlighted phrase is not in the answer: "' + phrase + '"');
      (mark.from || []).forEach((key) => { if (!keys.has(key)) problems.push(side + ': "' + phrase + '" points at a step that is not in the trace: ' + key); });
    });
  });
  if (pair.bare && !(pair.bare.marks || []).some((m) => m.bad)) problems.push('bare: no highlighted gap');
  if (pair.context && !(pair.context.marks || []).some((m) => m.good)) problems.push('context: no highlighted finding');
  return problems;
}

module.exports = { checkLive, checkRecorded };
