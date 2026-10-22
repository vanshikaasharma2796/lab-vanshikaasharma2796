# Context engine v2 — phase A1 handoff

A1 built the pure engine (`MCX.engine.ask` and the modules under it) and the new context content. This note is for
phase A2 (service, HTTP API, MCP, evals, scenario) and phase B (the visual UI). The architecture map is
`docs/CONTEXT-ENGINE.md`; the result shapes are in `docs/ENGINE.md` ("What `ask()` returns").

## State of play

- `node tools/validate.js`: all green (bank, context, recordings, 48 live answers, 9 typed questions, and the new
  context-engine sections: sources and build, routing and actions, guard, retrieval/memory/validation/determinism).
- `node tools/ask.js --all`: 48 of 48 clean.
- Bare transcripts are byte-identical to the pre-v2 engine for all 48 bank questions and 12 typed questions (checked
  against the backup zip). Context answers keep every old paragraph, mark (good/bad + `from`) and trace step, in order;
  v2 only adds (steps, an "Also relevant" paragraph on some answers, `lineage` on good marks).
- The same `ask()` input gives the same JSON in Node and in the browser (checked by SHA-256 of the result minus `ms`).
- The page loads and plays live answers (checked over a local static server; the Browser pane cannot run file:// pages
  with relative scripts, but the page uses plain `<script>` tags only and no fetch, so a double-click works as before).

## New modules (script order in `index.html`)

`format, text, sha256, semantic, guard, search, build, context, runtime, evidence, bare, router, validate, actions,
quality`, then the analyses. Everything resolves at call time, so the order only matters for the analyses files.

| Module | Public API |
|---|---|
| `src/engine/sha256.js` | `MCX.sha256(text) -> hex`, `MCX.canonicalJson(value)` |
| `src/engine/guard.js` | `MCX.guard.check(q) -> { verdict, findings, clean, reason }`, `.mask(text)`, `.findPii(text)` |
| `src/engine/search.js` | `MCX.search.query(q, { mode, k, persona, kinds, keepExcluded, region, today })`, `.embed`, `.exclusion(kind, id, card, { region, today })`, `.allows(list, card)`, `.reset()` |
| `src/engine/build.js` | `MCX.build.version()`, `.connect()`, `.freshness()`, `.mapMeaning()`, `.resolve()`, `.entitiesOf(kind, id)`, `.graph()`, `.neighbours(nodeId)`, `.sourceOfTable(table)`, `.source(id)`, `.report()`, `.summary()`, `.reset()` |
| `src/engine/router.js` | adds `.decide(route, guard, intent)`, `.followUp(card, q, history)`, `.looksLikeFollowUp(q)`, `.rewrite(earlier, q)`, `.blocked(guard)` |
| `src/engine/context.js` | adds `.retrieveFacts(q, card, { today })`, `.memorySlice(history)`, `.toolsFor(plan, blocked)`, `.reset()` |
| `src/engine/validate.js` | `MCX.validate.check({ run, transcript, pack, persona, actions, route, guard, execution, question })` |
| `src/engine/actions.js` | `MCX.actions.propose(plan, run)`, `.words(run)`, `.fill(template, words)`, `.largestDollars(text)` |
| `src/engine/quality.js` | `MCX.quality.score(result)` |
| `src/engine/runtime.js` | `MCX.engine.ask(input)` (now takes `history`), `.lineageOf(run, key)`, `.invalidate()` |
| `src/analyses/common.js` | new analysis `blocked` |

## `ask()` input and result

Input: `{ persona, question, slug?, bucket?, history?: [{ question, analysis, answer }] }`. The service should build
`history` from its log for the session: `question` = the logged `pack.question` (already masked), `analysis` =
`plan.name`, `answer` = `context.answer`. Only the last two turns are used. Bank questions (with `slug`) are never read
as follow-ups.

Result additions (full shapes in `docs/ENGINE.md`): `guard`, `decision`, `facts`, `validation`, `actions`, `quality`,
`cost`, `version`, `build`, `execution`, plus `marks[].lineage` on the context side and pack fields `instructions`,
`memory`, `facts`, `tools`, `cost`, `tokens.{instructions, memory, facts, factsBudget, tools, total}`. `pack.leftOut`
now also holds `{ kind: 'doc' | 'work', id, reason, why }` with `reason` one of `access`, `residency`, `retention`,
`draft`, `threshold`, `limit`, `budget` (older entries for terms and skills have no `reason`).

What the service needs from it:
- **Log (L1)**: `route`, `plan.name`, `pack.question` (masked), `guard.verdict`, `quality`, `cost.tokens/estimate`,
  `version`, `validation.ok`, `actions[].id`, and a few key figures for drift (A2 decides; good marks' text is stable).
- **Audit (G2)**: hash over `canonicalJson` of the log entry with `MCX.sha256`; include `version` and the cited
  sources (`marks[].lineage[].source`).
- **Actions (E5/E6)**: `actions[].id` is deterministic (`sha256(analysis + '|' + scope.label + '|' + title)`, first 10
  hex); `needsApproval`, `approverRole`, `approvers` (persona ids) drive the queue; low impact may be approved by the
  asker. A fallback answer has `actions: []` (they are kept in `validation.withheld.actions`).
- **Cost cap (G5)**: `cost.estimate` per answer against `engine.cost.dailyCap` per persona per day.
- **Gaps (L3)**: `route.kind === 'none'`, `route.score < 0.6` on `match`, `quality.parts.coverage.detail` lists the
  words not understood, `guard.verdict === 'blocked'` (for benign-but-blocked review).
- **Drift (O2)**: `MCX.build.freshness()` (source age vs SLA; the marketing calendar is stale by design).
- **Observe**: `MCX.build.report()` (sources, kinds, links, mentions, graph size, flags, version).

## Step kinds (context side), in order

`guard` (first) → `policy: pinned-instructions` → `persona` → reasoning line → `route` → `doc`* → `work`* → `memory`
(when there is history) → `term`/`skill`/`model` loads and queries as before → `validate` → `action`* (one per proposed
action). Keys: `guard`, `route`, `doc:<id>`, `work:<id>`, `memory`, `validate`, `action:<id>`. A step may carry `label`
(shown instead of the id: page/thread title, action title), `meta`, `detail`, `file`, `tokens`. A blocked question
stops after `route` (no facts, no loads), then `validate`.

## Config keys (`src/config.js`, `engine`)

`region` ('us'), `factsBudget` (700), `factsMin` (0.35), `alsoRelevant` (0.55), `budgets` (per intent, 4000 each),
`cost` ({ perThousand: 0.003, currency: 'USD', dailyCap: 2 }), `bounds` ({ maxQueries: 25, maxRows: 20000 }; the
heaviest bank answer uses 9 queries and 128 rows), `guard` ({ maxLength: 500 }), `retention` ({ logDays: 30 }). Page
copy: `copy.live.routes.blocked`, `copy.sheet.kinds.doc/work`, `copy.sheet.repositoryGroups.doc/work/source/catalog`.

## Extension points

- **Changing the repository at run time** (lifecycle deploy, rollback, browser overlay): mutate or replace
  `MCX.contextRepo`, then call `MCX.engine.invalidate()` (drops the build, search and stats caches). The caches are
  also keyed on the identity of `MCX.contextRepo`, so replacing the object is enough on its own; in-place edits need
  the call. `MCX.build.version()` then gives the new version.
- **Simulating a change** (C2): clone the repository (`JSON.parse(JSON.stringify(MCX.contextRepo))`), swap it in,
  `invalidate()`, ask, swap back, `invalidate()`.
- **Bundle format**: `context/bundle.js` sets `MCX.contextRepo = { personas, glossary, skills, models, policies,
  sources: [...], knowledge: { id: { ...front matter, body, file } }, work: { id: { ...thread, file } }, routing, actions }`.
  `routing.file` and `actions.file` are set by the build. `tools/build-context.js` validates ids, required fields,
  statuses, dates and source references; it is the only writer of the bundle.
- **New guard rule**: add a pattern to `BLOCK` in `guard.js` and a message to `MESSAGES`; add a case to the guard
  section of `tools/validate.js`.
- **New executor**: add a rule to `context/routing.json`; `decide()` is data-driven. Only `blocked` changes which
  analysis runs; the others describe it.
- **New action**: add to `context/actions.json` under the analysis name; template words are listed in its header.

## Not done in A1 (by design: A2 / B)

- Service layer `MCX.service` (log, feedback, gaps, lifecycle, approvals, act/write-back, OPS schema, outbox, audit
  chain, versions/rollback, retention purge, daily cost cap, observe/drift), HTTP server (`tools/server.js`, port
  3242), MCP server (`tools/mcp.js`), `.vscode/mcp.json`.
- `evals/golden-set.json`, `evals/golden-answers.json`, `evals/scenario*.json` and their tools; `npm test` sections
  for them. The old port goldens no longer match the context side (bare still does): regenerate from this engine.
- UI (B): icons/labels for the new step kinds in the timeline, Guardrails and Learning-loop tabs, feedback and quality
  under the answer, action approve/reject, session memory for typed follow-ups in the page (the engine accepts
  `history`; `src/app.js` does not pass it yet), facts/tools/memory groups in "This question".
- Reload on file change (B4) is a server concern (A2).

## Port notes (.NET, Java)

See "Determinism" in `docs/CONTEXT-ENGINE.md`. In short: SHA-256 over UTF-8 and canonical JSON with unescaped
non-ASCII; ECMAScript regexes; stable sorts with the tie-breakers in the code; `toFixed` semantics; FNV-1a on character
codes with `Math.imul` arithmetic; BM25 and RRF exactly as written; quality rounding is `floor(x + 0.5)`.
