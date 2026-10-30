#!/usr/bin/env node
/* =====================================================================
   tools/ask.js — ask the engine a question from the command line

     node tools/ask.js marcus drive-thru-up          a question from the bank, by slug
     node tools/ask.js priya "Why is Greg Novak's drive-thru time up?"
     node tools/ask.js --all                         every bank question; report problems only
     node tools/ask.js --list                        the bank

   Options:  --sql   show each query      --rows    show the first result rows
             --context  show the assembled context     --bare / --ctx   one side only
             --facts    what the analysis handed back (its ctx.facts)
             --engine   the context engine's parts: guard, route decision, facts from
                        knowledge and work (and what was left out, and why), memory,
                        validation, proposed actions, quality, cost, version, build
             --after="an earlier question"   ask that first, in the same session, and
                        pass it as history (memory); repeat for more turns

   It loads the same files the page loads, builds the same warehouse and
   runs the same engine, so what prints here is what the page shows.
   ===================================================================== */
'use strict';

const { MCX, openWarehouse } = require('./lib/load');
const { checkLive: check } = require('./lib/checks');

const args = process.argv.slice(2);
const after = args.filter((a) => a.startsWith('--after=')).map((a) => a.slice(8));
const flags = new Set(args.filter((a) => a.startsWith('--') && !a.startsWith('--after=')));
const words = args.filter((a) => !a.startsWith('--'));

function findQuestion(personaId, what) {
  const persona = MCX.catalog.personas.find((p) => p.id === personaId);
  if (!persona) throw new Error('No persona called ' + personaId);
  const fromBank = persona.questions.find((q) => q.slug === what);
  return fromBank ? { persona: personaId, question: fromBank.text, slug: fromBank.slug, bucket: fromBank.bucket } : { persona: personaId, question: what };
}

/** Mark highlighted phrases the way the page would: [[good]] and {{bad}}. */
function highlighted(transcript) {
  return MCX.script.segment(transcript.answer, transcript.marks)
    .map((piece) => (piece.kind === 'good' ? '[[' + piece.text + ']]' : piece.kind === 'bad' ? '{{' + piece.text + '}}' : piece.text)).join('');
}

function printSide(name, transcript) {
  console.log('\n' + '='.repeat(100) + '\n' + name + '\n' + '='.repeat(100));
  transcript.steps.forEach((step) => {
    if (step.say != null) { console.log('  ✦ ' + step.say + (step.hold ? '  (hold)' : '')); return; }
    const tool = MCX.script.describeTool(step);
    if (tool.kind === 'context') { console.log('  ◆ ' + MCX.script.labelOf(tool) + '   {' + tool.source + '}' + (step.tokens ? '  ' + step.tokens + ' tok' : '')); return; }
    console.log('  ▣ ' + MCX.script.labelOf(tool) + '   [' + tool.key + '] ' + step.rows + ' rows, ' + step.ms + ' ms');
    if (flags.has('--sql')) console.log(tool.sql.split('\n').map((l) => '        ' + l).join('\n'));
    if (flags.has('--rows') && step.result) {
      console.log('        ' + step.result.columns.join(' | '));
      step.result.rows.forEach((row) => console.log('        ' + row.join(' | ')));
      if (step.result.total > step.result.rows.length) console.log('        … ' + (step.result.total - step.result.rows.length) + ' more');
    }
  });
  console.log('\n' + highlighted(transcript));
  if (name.startsWith('WITH')) {
    transcript.marks.filter((m) => m.good).forEach((m) => console.log('    ↳ "' + m.good.slice(0, 60) + (m.good.length > 60 ? '…' : '') + '"  ←  ' + m.from.join(', ')));
  }
  transcript.problems.forEach((p) => console.log('  !! ' + p));
}

async function main() {
  const stats = await openWarehouse();
  if (flags.has('--list')) {
    MCX.catalog.personas.forEach((p) => p.questions.forEach((q) => console.log(p.id.padEnd(8) + q.slug.padEnd(30) + q.text)));
    return;
  }

  if (flags.has('--all')) {
    let failed = 0, asked = 0;
    const only = words[0];
    for (const persona of MCX.catalog.personas) {
      if (only && persona.id !== only) continue;
      for (const q of persona.questions) {
        asked++;
        try {
          const result = MCX.engine.ask({ persona: persona.id, question: q.text, slug: q.slug, bucket: q.bucket });
          const problems = check(result);
          const size = result.pack.tokens.used + ' tok';
          console.log((problems.length ? '✗ ' : '✓ ') + (persona.id + '/' + q.slug).padEnd(40) + String(result.context.steps.filter((s) => s.sql).length).padStart(2) + ' queries  ' + size.padStart(9) + '  ' + result.ms + ' ms');
          problems.forEach((p) => console.log('      ' + p));
          if (problems.length) failed++;
        } catch (error) {
          failed++;
          console.log('✗ ' + (persona.id + '/' + q.slug).padEnd(40) + error.message.split('\n')[0]);
          if (flags.has('--trace')) console.log(error.stack);
        }
      }
    }
    console.log('\n' + (asked - failed) + ' of ' + asked + ' questions answered cleanly. Warehouse: ' + stats.rows + ' rows in ' + stats.tables.length + ' tables.');
    process.exitCode = failed ? 1 : 0;
    return;
  }

  if (words.length < 2) { console.log('Usage: node tools/ask.js <persona> <slug or "question"> [--sql] [--rows] [--context] [--json]   |   --all [persona]   |   --list'); return; }
  const input = findQuestion(words[0], words.slice(1).join(' '));
  const history = [];
  after.forEach((earlier) => {
    const turn = MCX.engine.ask(Object.assign(findQuestion(words[0], earlier), { history: history.slice() }));
    history.push({ question: turn.pack.question, analysis: turn.plan.name, answer: turn.context.answer });
  });
  if (history.length) input.history = history;
  const result = MCX.engine.ask(input);
  const pack = result.pack;
  if (flags.has('--json')) {   // one machine-readable summary instead of the full printout
    const problems = check(result);
    console.log(JSON.stringify({
      question: input.question,
      persona: pack.persona.name,
      route: result.route.kind,
      analysis: result.plan.name,
      tokens: { used: pack.tokens.used, budget: pack.tokens.budget },
      queries: result.context.steps.filter((s) => s.sql).length,
      findings: result.context.marks.filter((m) => m.good).length,
      answer: result.context.answer,
      problems
    }, null, 2));
    process.exitCode = problems.length ? 1 : 0;
    return;
  }
  console.log('Question : ' + input.question);
  console.log('Asked by : ' + pack.persona.name + '   scope: ' + pack.scope.chip);
  console.log('Route    : ' + result.route.kind + ' → ' + result.plan.name + '  (' + result.route.why + ')');
  console.log('Context  : ' + pack.tokens.used + ' of ' + pack.tokens.budget + ' tokens (repository: ' + pack.tokens.repo + ')  ·  ' +
    pack.terms.length + ' terms, ' + pack.skills.length + ' skills, ' + pack.models.length + ' models, ' + pack.policies.length + ' policies' +
    (pack.compacted.length ? '  ·  compacted: ' + pack.compacted.map((c) => c.id).join(', ') : ''));
  pack.leftOut.forEach((l) => console.log('   not loaded: ' + l.kind + ' ' + l.id + ' — ' + l.why));
  if (flags.has('--context')) console.log('\n' + pack.prompt);
  if (!flags.has('--bare')) printSide('WITH CONTEXT', result.context);
  if (!flags.has('--ctx')) printSide('BARE', result.bare);
  const problems = check(result);
  console.log('\n' + (problems.length ? problems.length + ' problem(s):\n  ' + problems.join('\n  ') : 'No problems.') + '   (' + result.ms + ' ms)');
  if (flags.has('--facts')) console.log(JSON.stringify(result.context.facts, null, 2));
  if (flags.has('--engine')) printEngine(result);
}

/** The context engine's parts of one answer. */
function printEngine(result) {
  const pack = result.pack, line = (label, text) => console.log((label + ' ').padEnd(12, ' ') + ': ' + text);
  console.log('\n' + '='.repeat(100) + '\nCONTEXT ENGINE\n' + '='.repeat(100));
  line('Version', result.version + '   build: ' + result.build.ok + ' of ' + result.build.sources + ' sources reachable' + (result.build.stale.length ? ', stale: ' + result.build.stale.join(', ') : '') + ', ' + result.build.flags + ' flag(s)');
  line('Guard', result.guard.verdict + (result.guard.findings.length ? '  ' + result.guard.findings.map((f) => f.rule + ' [' + f.severity + '] ' + f.text).join(' | ') : ''));
  if (result.guard.verdict === 'masked') line('', 'read as: ' + result.guard.clean);
  line('Decision', result.decision.executor + ' (rule ' + result.decision.rule + ')' + (result.decision.what ? ' — ' + result.decision.what : '') + (result.decision.model ? '  model: ' + result.decision.model + ', fallback: ' + result.decision.fallback : ''));
  if (result.route.followUp) line('Follow-up', 'read with “' + result.route.followUp.from + '”');
  line('Memory', pack.memory.turns.length ? pack.memory.turns.length + ' turn(s)' : 'none');
  pack.memory.turns.forEach((t) => console.log('              ' + t.line));
  line('Facts', pack.facts.length + ' (' + pack.tokens.facts + ' of ' + pack.tokens.factsBudget + ' tokens)');
  pack.facts.forEach((f) => console.log('   ' + f.key.padEnd(44) + ' ' + f.system + ', ' + f.date + (f.masked ? ', MASKED' : '') + '  ' + f.why + '\n      “' + f.snippet + '”'));
  const out = pack.leftOut.filter((l) => l.kind === 'doc' || l.kind === 'work');
  if (out.length) console.log('   left out:');
  out.forEach((l) => console.log('   ' + (l.reason + ' ').padEnd(11) + (l.kind + ':' + l.id).padEnd(44) + ' ' + l.why));
  line('Tools', pack.tools.map((t) => t.id).join(', ') || 'none');
  line('Tokens', pack.tokens.used + ' cards (budget ' + pack.tokens.budget + ') + ' + pack.tokens.instructions + ' instructions + ' + pack.tokens.memory + ' memory + ' + pack.tokens.facts + ' facts + ' + pack.tokens.tools + ' tools = ' + pack.tokens.total);
  line('Cost', result.cost.currency + ' ' + result.cost.estimate.toFixed(4) + ' (' + result.cost.tokens + ' tokens at ' + result.cost.perThousand + ' per 1,000)');
  line('Execution', result.execution.queries + ' queries, ' + result.execution.rows + ' rows' + (result.execution.bounds ? ' (bounds ' + result.execution.bounds.maxQueries + ' / ' + result.execution.bounds.maxRows + ')' : '') + (result.execution.stopped ? '  STOPPED: ' + result.execution.stopped : ''));
  line('Validation', result.validation.ok ? 'passed' : 'FAILED — fallback answer given');
  result.validation.checks.forEach((c) => console.log('   ' + (c.ok ? '✓ ' : '✗ ') + c.kind.padEnd(8) + c.label + (c.detail ? ' — ' + c.detail : '')));
  if (result.validation.withheld) console.log('   withheld answer starts: ' + result.validation.withheld.answer.slice(0, 120) + '…');
  line('Actions', result.actions.length ? '' : 'none');
  result.actions.forEach((a) => console.log('   ' + a.id + '  ' + a.system + ' ' + a.type + ' · ' + a.impact.toUpperCase() + ' impact' + (a.needsApproval ? ' · waits for a human check by ' + a.approverRole + ' (' + a.approvers.join(', ') + ')' : ' · the asker can approve') + '\n      ' + a.title + '\n      why: ' + a.why));
  line('Quality', result.quality.score + ' (' + result.quality.band + ')');
  Object.keys(result.quality.parts).forEach((k) => { const p = result.quality.parts[k]; console.log('   ' + k.padEnd(11) + String(Math.round(p.value * p.weight * 10) / 10).padStart(5) + ' / ' + p.weight + '  ' + p.detail); });
  const lead = result.context.marks.filter((m) => m.good && m.lineage)[0];
  if (lead) {
    console.log('   lineage of the lead finding:');
    lead.lineage.forEach((l) => console.log('     ' + l.step.padEnd(34) + ' → ' + (l.table ? l.table + ' → ' : '') + (l.source || '?') + ' (' + (l.system || '?') + ')' + (l.upstream ? ' ← ' + l.upstream.map((u) => u.system).join(', ') : '')));
  }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
