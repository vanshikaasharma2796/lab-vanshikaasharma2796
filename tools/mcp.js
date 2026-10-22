#!/usr/bin/env node
/* =====================================================================
   tools/mcp.js — the context engine as an MCP server (A0: MCP)

     node tools/mcp.js                 stdio, state in var/mcp/
     node tools/mcp.js --var <dir>     state elsewhere
     node tools/mcp.js --memory        keep nothing between runs

   Model Context Protocol over stdio: JSON-RPC 2.0, one message per line
   on stdin and stdout, protocol version 2025-06-18. Methods: initialize,
   notifications/initialized, ping, tools/list, tools/call. Logs go to
   stderr only (stdout carries nothing but protocol messages).

   Tools: ask, search, define_term, sql_gold (read-only, certified GOLD
   tables only), lineage, sources, observe. Each returns its result as
   JSON text plus structuredContent. GitHub Copilot in VS Code picks the
   server up from .vscode/mcp.json. Details and a manual test: docs/MCP.md.
   ===================================================================== */
'use strict';

// Nothing but protocol messages may reach stdout: send stray console output to stderr.
console.log = console.info = console.warn = console.debug = (...args) => process.stderr.write(args.join(' ') + '\n');

const path = require('path');
const readline = require('readline');

const PROTOCOL = '2025-06-18';
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
const PERSONAS = ['marcus', 'diego', 'priya', 'maya', 'sam', 'lena'];

const TOOLS = [
  { name: 'ask', title: 'Ask the context engine',
    description: 'Answer a business question about McContext Burger (drive-thru time, Double Stack launch, complaints, staffing, stock, retrofit kits) as one of the personas, from the certified warehouse and context layer. Screened by the guard, routed, grounded in certified tables, knowledge pages and work threads (access, residency and retention filtered, personal data masked), validated, scored; proposes actions that wait for a human check. The answer is logged and audited.',
    inputSchema: { type: 'object', properties: {
      persona: { type: 'string', enum: PERSONAS, description: 'Who is asking: marcus (franchise operator, own 14 stores), diego (Ads), priya (Store Ops), maya (Service Analyst), sam (Customer Support), lena (Supply Chain)' },
      question: { type: 'string', description: 'The question, in plain words' },
      session: { type: 'string', description: 'Optional session id: follow-ups in the same session use the earlier turns (memory)' } }, required: ['persona', 'question'], additionalProperties: false } },
  { name: 'search', title: 'Search knowledge and work',
    description: 'Hybrid (BM25 + vector, fused by reciprocal rank), keyword or vector search over the knowledge pages (Confluence, SharePoint, Notion) and work threads (Slack, Teams, email, Zoom). With a persona, only what that persona may see; personal data is masked.',
    inputSchema: { type: 'object', properties: { q: { type: 'string' }, mode: { type: 'string', enum: ['hybrid', 'keyword', 'vector'] }, k: { type: 'integer', minimum: 1, maximum: 50 }, persona: { type: 'string', enum: PERSONAS } }, required: ['q'], additionalProperties: false } },
  { name: 'define_term', title: 'Define a business term',
    description: 'What a McContext business term means in the glossary (by id, name or synonym): definition, the certified column it maps to, the wrong column it must not be confused with, owner, and the metrics built on it.',
    inputSchema: { type: 'object', properties: { term: { type: 'string', description: 'e.g. "drive-thru time", "revenue at risk", "benchmark"' } }, required: ['term'], additionalProperties: false } },
  { name: 'sql_gold', title: 'Read certified tables (SQL)',
    description: 'Run one read-only SELECT on the certified GOLD tables of the warehouse (SQLite dialect). Only GOLD tables with a semantic model may be named, with their schema (GOLD.ORDER_TIMING_MART …); raw BRONZE tables are refused (certified-sources policy). At most 200 rows.',
    inputSchema: { type: 'object', properties: { sql: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 1000 } }, required: ['sql'], additionalProperties: false } },
  { name: 'lineage', title: 'Lineage of an answer or a table',
    description: 'Where an answer\'s findings come from (query → semantic model → GOLD table → source system, pages and threads → their system), or which systems feed a table. Give persona + question, or table.',
    inputSchema: { type: 'object', properties: { persona: { type: 'string', enum: PERSONAS }, question: { type: 'string' }, table: { type: 'string', description: 'e.g. GOLD.ORDER_TIMING_MART' } }, additionalProperties: false } },
  { name: 'sources', title: 'Sources and freshness',
    description: 'The source registry: systems of record, knowledge, data, semantics, work and runtime, with reachability, item counts, residency, retention, access, personal data and freshness against SLA.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'observe', title: 'Observe the engine',
    description: 'The dashboard: answers, average quality, guard blocks and masks, validation failures, feedback, open gaps, changes and actions by status, cost today against the cap, drift alerts (source freshness, answers that changed, golden drift), audit chain status.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } }
];

function compactAnswer(r) {
  return {
    log: r.log.id, route: r.route.kind, analysis: r.plan.name, guard: r.guard.verdict, executor: r.decision.executor,
    answer: r.context.answer,
    findings: r.context.marks.filter((m) => m.good != null).map((m) => ({ text: m.good, sources: m.from })),
    facts: (r.facts || []).map((f) => ({ key: f.key, title: f.title, system: f.system, date: f.date, snippet: f.snippet })),
    actions: r.actions.map((a) => ({ id: a.id, title: a.title, system: a.system, type: a.type, impact: a.impact, needsApproval: a.needsApproval, approverRole: a.approverRole })),
    validation: r.validation.ok, quality: { score: r.quality.score, band: r.quality.band }, cost: r.cost, version: r.version
  };
}

function handlers(service) {
  return {
    ask: async (a) => compactAnswer(await service.ask({ persona: a.persona, question: a.question, session: a.session || 'mcp' })),
    search: (a) => service.search(a),
    define_term: (a) => service.define({ term: a.term }),
    sql_gold: (a) => service.sql({ sql: a.sql, gold: true, limit: a.limit || 200 }),
    lineage: (a) => service.lineage(a),
    sources: () => service.sources(),
    observe: () => service.observe()
  };
}

function options(argv) {
  const root = path.join(__dirname, '..');
  const o = { varDir: path.join(root, 'var', 'mcp') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--memory') o.varDir = null;
    else if (argv[i] === '--var') o.varDir = path.resolve(argv[++i]);
    else if (argv[i].startsWith('--var=')) o.varDir = path.resolve(argv[i].slice(6));
  }
  return o;
}

function main() {
  const o = options(process.argv.slice(2));
  const { createNodeService } = require('./lib/node-service');
  const starting = createNodeService({ varDir: o.varDir, mode: 'overlay' }).then((service) => {
    process.stderr.write('mccontext MCP server ready (context version ' + require('./lib/load').MCX.build.version() + ', state ' + (o.varDir || 'in memory') + ')\n');
    return { service, run: handlers(service) };
  });
  starting.catch((error) => process.stderr.write('mccontext MCP server failed to start: ' + (error.stack || error.message) + '\n'));

  const write = (message) => process.stdout.write(JSON.stringify(message) + '\n');
  const reply = (id, result) => write({ jsonrpc: '2.0', id, result });
  const error = (id, code, message) => write({ jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } });

  async function handle(msg) {
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') { if (msg && msg.id !== undefined && msg.method === undefined) return; return error(msg && msg.id, -32600, 'Invalid Request'); }
    const isNotification = msg.id === undefined || msg.id === null;
    const params = msg.params || {};
    switch (msg.method) {
      case 'initialize': {
        const asked = params.protocolVersion;
        return reply(msg.id, {
          protocolVersion: SUPPORTED.indexOf(asked) !== -1 ? asked : PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'mccontext-context-engine', title: 'McContext context engine (Regenesys AI)', version: '2.0.0' },
          instructions: 'McContext Burger talk-to-data. Use ask for business questions (pick the persona who is asking), search for pages and threads, define_term for what a business word means, sql_gold for read-only SQL on certified GOLD tables, lineage for where a finding comes from, sources and observe for the engine\'s health. Answers come only from certified context; personal data is masked.'
        });
      }
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return undefined;
      case 'ping':
        return isNotification ? undefined : reply(msg.id, {});
      case 'tools/list':
        return reply(msg.id, { tools: TOOLS });
      case 'tools/call': {
        const tool = TOOLS.filter((t) => t.name === params.name)[0];
        if (!tool) return error(msg.id, -32602, 'Unknown tool: ' + params.name);
        const args = params.arguments || {};
        const missing = (tool.inputSchema.required || []).filter((k) => args[k] === undefined || args[k] === null || args[k] === '');
        if (missing.length) return error(msg.id, -32602, 'Missing argument(s) for ' + tool.name + ': ' + missing.join(', '));
        try {
          const ready = await starting;
          const result = await ready.run[tool.name](args);
          return reply(msg.id, { content: [{ type: 'text', text: JSON.stringify(result, null, 1) }], structuredContent: result, isError: false });
        } catch (e) {
          // A refusal (bad input, policy) is a tool result the model can read, not a protocol error.
          return reply(msg.id, { content: [{ type: 'text', text: (e.status ? 'Refused (' + e.status + '): ' : 'Failed: ') + String(e.message).split('\n')[0] }], isError: true });
        }
      }
      default:
        if (isNotification) return undefined;
        return error(msg.id, -32601, 'Method not found: ' + msg.method);
    }
  }

  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  let queue = Promise.resolve();
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch (e) { error(null, -32700, 'Parse error'); return; }
    // One at a time, in order: the engine is synchronous and the log is shared.
    queue = queue.then(() => handle(msg)).catch((e) => { process.stderr.write((e.stack || e.message) + '\n'); if (msg && msg.id !== undefined) error(msg.id, -32603, 'Internal error'); });
  });
  rl.on('close', () => { queue.then(() => starting.then((r) => r.service.close(), () => {})).then(() => process.exit(0)); });
}

if (require.main === module) main();
module.exports = { TOOLS, compactAnswer, PROTOCOL };
