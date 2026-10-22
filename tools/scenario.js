#!/usr/bin/env node
/* =====================================================================
   tools/scenario.js — replay the scripted service scenario

     node tools/scenario.js            run evals/scenario.json and compare with
                                       evals/scenario-expected.json (first
                                       differing JSON path per step)
     node tools/scenario.js --update   write evals/scenario-expected.json
     node tools/scenario.js --print    print the result instead of comparing

   The run is reproducible by design: a fixed clock (evals/scenario.json
   "start", one minute per step), sequential ids from fresh storage (a new
   temporary folder, removed afterwards), overlay mode (nothing in
   context/ is written). The rules are in the "rules" block of the
   scenario file; the .NET and Java ports replay the same file and must
   produce the same expected file.
   ===================================================================== */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createNodeService, MCX, root } = require('./lib/node-service');
const { strip, firstDifference } = require('./lib/compare');

const FILES = { script: path.join(root, 'evals', 'scenario.json'), expected: path.join(root, 'evals', 'scenario-expected.json') };

/** Value at a dotted path; "x[]" maps the rest of the path over the array x; "[key=value]" picks an element. */
function at(value, pathText) {
  const parts = String(pathText).split('.');
  function walk(v, i) {
    if (i === parts.length) return v;
    if (v == null) return undefined;
    let seg = parts[i];
    const pick = /^(.*)\[(\w+)=([^\]]*)\]$/.exec(seg);
    if (pick) {
      const list = pick[1] ? v[pick[1]] : v;
      const found = Array.isArray(list) ? list.filter((x) => x && String(x[pick[2]]) === pick[3])[0] : undefined;
      return walk(found, i + 1);
    }
    if (seg.endsWith('[]')) {
      seg = seg.slice(0, -2);
      const list = seg ? v[seg] : v;
      return Array.isArray(list) ? list.map((x) => walk(x, i + 1)) : undefined;
    }
    return walk(v[seg], i + 1);
  }
  return walk(value, 0);
}

function resolve(args, named) {
  if (typeof args === 'string' && args.charAt(0) === '@') {
    const dot = args.indexOf('.');
    const name = dot === -1 ? args.slice(1) : args.slice(1, dot);
    if (!(name in named)) throw new Error('No earlier step called ' + name);
    return dot === -1 ? named[name] : at(named[name], args.slice(dot + 1));
  }
  if (Array.isArray(args)) return args.map((a) => resolve(a, named));
  if (args && typeof args === 'object') { const o = {}; Object.keys(args).forEach((k) => { o[k] = resolve(args[k], named); }); return o; }
  return args;
}

function project(result, fields) {
  const out = {};
  fields.forEach((f) => { const v = at(result, f); out[f] = v === undefined ? null : v; });
  return out;
}

/** Run the scenario; returns the expected-file object. */
async function run(script) {
  script = script || JSON.parse(fs.readFileSync(FILES.script, 'utf8'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcx-scenario-'));
  let now = Date.parse(script.start);
  const clock = () => new Date(now).toISOString().replace('.000Z', 'Z');
  const savedRepo = MCX.contextRepo;
  let service;
  try {
    service = await createNodeService({ varDir: dir, mode: 'overlay', clock, settings: script.settings || {} });
    const named = {}, steps = [];
    for (let i = 0; i < script.steps.length; i++) {
      const s = script.steps[i];
      if (i > 0) now += 60000;
      if (s.at) now = Date.parse(s.at);
      const record = { n: i + 1, name: s.name || null, call: s.call, at: clock() };
      try {
        if (typeof service[s.call] !== 'function') throw Object.assign(new Error('No service method ' + s.call), { status: 400 });
        const args = resolve(s.args || [], named);
        const result = strip(await service[s.call].apply(null, args));
        if (s.name) named[s.name] = result;
        record.ok = true;
        record.result = s.call === 'ask' ? project(result, script.askFields) : result;
      } catch (error) {
        if (!error.status) throw error;                      // a bug, not a refusal: stop the run
        record.ok = false;
        record.status = error.status;
        record.error = error.message;
        record.code = error.code || null;
      }
      steps.push(record);
    }
    return { description: script.description, start: script.start, steps };
  } finally {
    if (service) service.close();
    MCX.contextRepo = savedRepo;
    MCX.engine.invalidate();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function serialise(result) { return JSON.stringify(result, null, 1) + '\n'; }

/** Compare a run with the expected file: [{ step, path, expected, actual }] (empty = same). */
function compare(expected, actual) {
  const out = [];
  const n = Math.max(expected.steps.length, actual.steps.length);
  for (let i = 0; i < n; i++) {
    const d = firstDifference(expected.steps[i], actual.steps[i], '$.steps[' + i + ']');
    if (d) out.push(Object.assign({ step: (expected.steps[i] || actual.steps[i]).n + ' ' + (expected.steps[i] || actual.steps[i]).call }, d));
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const started = Date.now();
  const result = await run();
  const text = serialise(result);
  if (args.includes('--update')) {
    fs.writeFileSync(FILES.expected, text);
    console.log('evals/scenario-expected.json written: ' + result.steps.length + ' steps (' + result.steps.filter((s) => !s.ok).length + ' refused on purpose), ' + Math.round(text.length / 1024) + ' KB, ' + (Date.now() - started) + ' ms.');
    return;
  }
  if (args.includes('--print')) { process.stdout.write(text); return; }
  if (!fs.existsSync(FILES.expected)) { console.log('No evals/scenario-expected.json yet: run node tools/scenario.js --update'); process.exitCode = 1; return; }
  const diffs = compare(JSON.parse(fs.readFileSync(FILES.expected, 'utf8')), JSON.parse(text));
  diffs.slice(0, 10).forEach((d) => console.log('✗ step ' + d.step + '   first difference at ' + d.path + '\n      expected: ' + JSON.stringify(d.expected) + '\n      now:      ' + JSON.stringify(d.actual)));
  console.log(diffs.length ? diffs.length + ' step(s) differ.' : 'All ' + result.steps.length + ' steps identical (' + (Date.now() - started) + ' ms).');
  process.exitCode = diffs.length ? 1 : 0;
}

if (require.main === module) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { run, compare, serialise, at, resolve, FILES };
