#!/usr/bin/env node
/* =====================================================================
   tools/eval.js — run the business evals (G1)

     node tools/eval.js            every case in evals/golden-set.json
     node tools/eval.js --json     the result as JSON (the shape of
                                   MCX.service.evals() and GET /api/evals)
     node tools/eval.js <id> ...   only these cases

   Reads evals/golden-set.json directly (not the bundle), so a case you
   just added runs at once. Exits with code 1 if any case fails.
   ===================================================================== */
'use strict';

const { MCX, openWarehouse } = require('./lib/load');
const bundle = require('./lib/evals-bundle');

async function main() {
  await openWarehouse();
  const args = process.argv.slice(2);
  const only = args.filter((a) => !a.startsWith('--'));
  const cases = bundle.readSet().filter((c) => !only.length || only.indexOf(c.id) !== -1);
  const result = MCX.evals.run(cases);
  if (args.includes('--json')) { console.log(JSON.stringify(result, null, 2)); }
  else {
    result.cases.forEach((c) => {
      console.log((c.ok ? '✓ ' : '✗ ') + c.id.padEnd(28) + ' ' + String(c.route).padEnd(13) + ' ' + String(c.quality).padStart(3) + '  ' + c.title);
      c.failures.forEach((f) => console.log('      ' + f));
    });
    console.log('\n' + result.passed + ' of ' + result.total + ' evals pass (score ' + result.score + ').');
  }
  process.exitCode = result.passed === result.total ? 0 : 1;
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
