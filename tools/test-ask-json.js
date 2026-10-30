#!/usr/bin/env node
/* tools/test-ask-json.js — checks the --json flag of tools/ask.js
     node tools/test-ask-json.js        exits with 1 if a check fails */
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');

const ask = path.join(__dirname, 'ask.js');
const cases = [
  { args: ['marcus', 'drive-thru-up'], route: 'bank', analysis: 'drive-thru-diagnosis' },
  { args: ['maya', 'staffing by operator this week'], route: 'lookup', analysis: 'lookup' },
  { args: ['marcus', 'How is Greg Novak doing on drive-thru?'], route: 'out-of-scope', analysis: 'out-of-scope' }
];

let failed = 0;
cases.forEach((c) => {
  const run = spawnSync(process.execPath, [ask].concat(c.args, ['--json']), { encoding: 'utf8' });
  let problem = null;
  try {
    const out = JSON.parse(run.stdout);
    if (out.route !== c.route) problem = 'route ' + out.route + ', expected ' + c.route;
    else if (out.analysis !== c.analysis) problem = 'analysis ' + out.analysis + ', expected ' + c.analysis;
    else if (!out.answer || out.problems.length) problem = 'empty answer or problems: ' + out.problems.join('; ');
    else if (run.status !== 0) problem = 'exit code ' + run.status;
  } catch (e) {
    problem = 'output is not JSON: ' + String(run.stdout).slice(0, 60);
  }
  if (problem) failed++;
  console.log((problem ? 'FAIL  ' : 'PASS  ') + c.args.join(' ') + (problem ? ' (' + problem + ')' : ''));
});
console.log(failed ? failed + ' failed.' : 'All ' + cases.length + ' passed.');
process.exitCode = failed ? 1 : 0;