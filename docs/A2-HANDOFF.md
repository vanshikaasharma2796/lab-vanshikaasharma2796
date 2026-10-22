# Context engine v2 — phase A2 handoff

A2 built the stateful shell around the pure engine: `MCX.service` (learning loop, lifecycle, human check and write-back,
audit, versions, observe, retention), the HTTP API, the MCP server, the evals, the golden answers and a scripted
scenario. This note is for phase B (the visual UI) and for the .NET and Java ports. The checklist with file and function
pointers is `docs/CONTEXT-ENGINE.md`; endpoint shapes are `docs/API.md`; MCP is `docs/MCP.md`.

## State of play

- `node tools/validate.js`: all green (everything A1 had, plus: 26 of 26 evals, 72 of 72 golden answers reproduced,
  `evals/bundle.js` up to date, the 65-step scenario identical to `evals/scenario-expected.json` and identical over two
  runs, audit chain verify and tamper detection, storage fallback, MCP smoke, API smoke on a free port). About a minute.
- `node tools/golden.js --update` and `node tools/scenario.js --update` are deterministic: two runs give byte-identical
  files.
- In the page (served by `tools/server.js`, checked in the browser): `MCX.service` asks, takes feedback, finds gaps,
  drafts/tests/reviews/approves/deploys a change, decides an action (written to `OPS.ACTION_LOG`), verifies the audit,
  observes; after a reload the deployed overlay is re-applied; rollback works; no console errors. The page still plays
  recorded and live answers. A deploy gives the same version hash in the browser, in Node overlay mode and in Node files
  mode (`f7c3d0f2cb46` for "queue time" → drive-thru time).
- Unchanged: `MCX.engine.ask()`, the bare analyst, every A1 module. Small additions outside `src/service/`:
  `MCX.db.run()` (`warehouse/db.js`), `signoff` in `context/actions.json` (+ one line in `policies/human-check.md`;
  this moved the context version to `47f1fde8f37b`), the bundle builder moved into `tools/lib/context-build.js` (output
  byte-identical).

## Files

| File | What |
|---|---|
| `src/service/storage.js` | `MCX.storage.memory()`, `MCX.storage.local(prefix)` (localStorage, every access wrapped, memory fallback) |
| `src/service/audit.js` | `MCX.audit.entry(prev, seq, fields)`, `.verify(entries, anchor)`, `.hashOf(e)`, `.GENESIS` |
| `src/service/evals.js` | `MCX.evals.fingerprint(result)`, `.diff(a, b)`, `.check(case, result)`, `.run(cases?, ask?)`, `.golden(ask?)`, `.goldenFor(persona, slug)`, `.inputOf(case)`, `.bundle()` |
| `src/service/changes.js` | `MCX.changes.describe(repo, spec, at)`, `.apply(repo, change)`, `.signoff(repo, owner)`, `.KINDS` |
| `src/service/service.js` | `MCX.createService(options)`; in the page `MCX.service` (+ `MCX.service.downloadChanges()`) |
| `evals/golden-set.json` | 26 business evals |
| `evals/golden-answers.json` | 72 golden answers `[{ id, input, output }]`, one per line |
| `evals/bundle.js` | generated: `MCX.evalBundle = { set, golden: [{ id, input, fp }] }` for the page |
| `evals/scenario.json`, `evals/scenario-expected.json` | the scripted service run and its expected result |
| `tools/server.js`, `tools/mcp.js`, `.vscode/mcp.json` | HTTP API (port 3242) and MCP stdio server |
| `tools/eval.js`, `tools/golden.js`, `tools/scenario.js`, `tools/lifecycle.js` | evals, goldens, scenario, apply exported changes |
| `tools/lib/node-service.js` | `createNodeService({ varDir, mode, contextDir, clock, ids, settings, watch })`, `watchContext()` |
| `tools/lib/file-storage.js`, `context-files.js`, `context-build.js`, `compare.js`, `evals-bundle.js` | Node storage, writing a change into its file, the bundle builder, parity comparison, eval bundle |

## The `MCX.service` contract

Every method is async and resolves with plain JSON (the HTTP response body). Errors are rejected `Error`s with
`status` (400/403/404/409) and sometimes `code`; the HTTP layer turns them into `{ error, code? }`.

| Method | Arguments | Returns |
|---|---|---|
| `ask(input)` | `{ persona, question, slug?, bucket?, session? }` | engine result + `log: { id, at, session }`, `audit: { id, hash }`, `queued: [action ids]` |
| `feedback(args)` | `{ log, vote: 'up'|'down', note?, by? }` | `{ id, at, log, vote, note (masked), by, persona, question }` |
| `log(args)` | `{ limit?, persona?, session? }` | `{ total, purged, entries }` newest first |
| `gaps()` | — | `{ total, open, gaps: [{ id, type, persona, question, count, logs, first, last, detail, suggestion, notes, status, changes }] }` |
| `evals()` | — | `{ at, version, score, passed, total, cases }` |
| `changes(args)` | `{ status? }` | `{ total, counts, changes }` |
| `draft(args)` | `{ fromGap, author? }` or `{ kind, target, value, reason, author, question?, persona? }` | the change |
| `test(id)` | change id | the change with `test` |
| `review(id, args)` | `{ by? }` | the change with `review` |
| `approve(id, args)` | `{ by }` | the change with `approval` |
| `deploy(id, args)` | `{ by }` | the change with `deployment` |
| `reject(id, args)` | `{ by, note? }` | the change with `rejection` |
| `versions()` | — | `{ current, base, active, history }` |
| `rollback(version, args)` | `{ by }` | `{ version, previous, target, matches, undone }` |
| `exportChanges()` | — | `{ format: 'mccontext-changes/1', exported, base, current, changes }` |
| `actions(args)` | `{ status? }` | `{ total, counts, actions, outbox }` |
| `decide(id, args)` | `{ decision: 'approve'|'reject', by, note? }` | the action (approve → `status: 'written'`, `write`) |
| `audit(args)` | `{ limit? }` | `{ total, anchor, entries }` newest first |
| `verifyAudit()` | — | `{ ok, checked, total, anchor, broken, head }` |
| `observe()` | — | dashboard (`docs/API.md`) |
| `retention(args)` | `{ days? }` | `{ at, days, cutoff, purged, kept, tombstones }` |
| `sources()`, `graph({ focus? })`, `search({ q, mode?, k?, persona?, kinds? })`, `health()`, `status()`, `sql({ sql, gold?, limit? })`, `define({ term })`, `lineage({ table } | { persona, question, slug? })` | | see `docs/API.md` |
| `reload(repo)` | a rebuilt repository (Node watcher) | `{ changed, version, previous? }` |
| `ready()` | — | resolves when the warehouse is built, state loaded, the overlay applied |

Change kinds (`src/service/changes.js`): `add-synonym` (target: glossary id; value: phrase), `set-param` (target:
`<skill>:<dotted.path>` in its params.json; value: same type as now), `edit-text` (target: `glossary|skill|policy|knowledge:<id>`;
value: the new body), `add-note` (same targets; value: a note appended as `Field note (YYYY-MM-DD, Name): …`).
Statuses: `draft → tested → reviewed → approved → deployed`, or `rejected`, or (after a rollback) `rolled-back`.
Sign-off: `context/actions.json` `signoff[owner of the file]`; the author never signs off.

Action queue rules: one open entry per engine action id (a repeat proposal adds its log id to `logs`; after a decision a
new proposal gets id `<id>-2`, `-3`, …). High impact: `by` must be in `approvers`. Low impact: the asker or an approver.

## Storage

Keys (browser: `localStorage['mcx.service.' + key]` as JSON; Node: `var/<key>.json`, and `var/<key>.jsonl` one record
per line for `log`, `feedback`, `audit`, `outbox`):

`counters` (`{ log, fb, aud, chg, out, 'ref:Jira', 'ref:SAP', … }`), `log`, `feedback`, `audit`, `auditAnchor`
(`{ seq, hash, purged, at }` or null), `changes`, `restore` (files mode: `{ changeId: [{ file, before, after }] }`),
`versions` (`{ base, current, history, active }`), `actions`, `outbox`, `tombstones` (`{ log, feedback, audit, purges }`),
`evalRuns` (last 20).

The MCP server keeps its own state in `var/mcp/` (two processes must not share one folder). `OPS.ACTION_LOG` is in the
in-memory warehouse; it is emptied and refilled from `outbox` whenever a service starts.

## Determinism rules (for the ports)

On top of A1's rules (`docs/CONTEXT-ENGINE.md`, "Determinism"):

- **Clock**: the service reads `clock()`; a scripted step returns one time for the whole call. ISO strings; when a time
  is computed (retention cutoff) it is written without milliseconds when they are zero (`2026-05-21T09:00:00Z`).
  Comparisons of times parse them (`Date.parse`), "today" is the first 10 characters (UTC day).
- **Ids**: counters per kind, `kind + '-' + 4-digit zero-padded`. Gap id `'gap-' + sha256(type + '|' + persona + '|' + question).slice(0, 10)`.
- **Rounding**: `round(x, d) = floor(x · 10^d + 0.5) / 10^d`. Cost sums: `round(sum, 6)` summed in log order;
  `avgQuality = round(sum / n, 1)`; eval score `floor(passed · 100 / total + 0.5)`.
- **Fingerprint**: 7 parts, each `sha256(canonicalJson(part)).slice(0, 16)` (`src/service/evals.js`; the part
  definitions are in its header). Diff order: route, guard, answer, marks, facts, actions, validation.
- **Audit hash**: `sha256(canonicalJson({ id, seq, at, type, actor, subject, data, prev }))`, GENESIS = 64 zeros;
  `actor`/`subject` null when absent, `data` `{}` when absent.
- **Gap suggestion**: lower-case the question, split on `[a-z0-9%$'-]+`, keep runs of words whose first token
  (`MCX.text.tokens(word)[0]`) is in the not-understood list and that are not question words; rank each run against
  the glossary (name + synonyms + body, `MCX.text.rank`); best score wins, ties: more words, then earlier.
- **External refs**: Jira `JIRA-(1041+n)`, ServiceNow `INC` + 7-digit `(10041+n)`, Slack `SLACK-(1041+n)`, SAP
  `PO-(4500001041+n)`, n = per-system counter.
- **Sandbox test**: clone the live repository, apply the change, swap it in, ask the gap question, re-ask every golden
  case and fingerprint it, run the evals; swap back. Evals results are cached per context version.
- **Messages**: every error and summary sentence is part of the scenario output; copy the strings exactly.

## What the ports copy, and how to regenerate

Copy verbatim: `context/*` (including the new `signoff` in `actions.json`), `evals/golden-set.json`,
`evals/golden-answers.json`, `evals/scenario.json`, `evals/scenario-expected.json`. The ports do not need
`evals/bundle.js` (it is the page's packing of the first two; their pages call the server).

- Golden answers: compare each `{ id, input, output }` with the port's `ask(input)` minus `ms` (strings identical,
  numbers within 1e-9, the SQLite version string excepted). Cases: 48 bank questions, `typed-1`…`typed-12` (the
  original typed set, same order), `typed-13`…`typed-24` (guard, PII, memory with `history` in the input, knowledge,
  access, residency, retention, draft).
- Scenario: read `evals/scenario.json` (`rules`, `start`, `settings`, `askFields`, `steps`), run it against a service
  with fresh storage, overlay mode, the fixed clock and counter ids; keep only `askFields` for `ask` (a path segment
  `x[]` maps over an array), drop `ms` keys, record refusals as `{ ok: false, status, error, code }`; compare with
  `evals/scenario-expected.json` step by step.
- Regenerate after changing the engine or context: `node tools/golden.js --update`, `node tools/scenario.js --update`,
  then `node tools/validate.js`. Copy the four files to the ports again.

## For phase B (the UI)

Everything below is ready in `MCX.service`; nothing in `src/app.js` uses it yet.

- Ask through `MCX.service.ask({ persona, question, slug, bucket, session })` instead of `MCX.engine.ask` (same
  result plus `log`, `audit`, `queued`); keep one `session` id per typed conversation so follow-ups get memory. Handle
  a rejected promise with `status 403, code 'cost-cap'`.
- Under the answer: feedback (`feedback({ log: result.log.id, vote, note })`), the quality badge (`result.quality`),
  proposed actions with Approve/Reject (`decide(queuedId, { decision, by: persona })`; show `write.ref`, e.g.
  "Written to SAP as PO-4500001042 (simulated)", or the 403 message for the wrong person).
- Guardrails tab: `result.guard`, `decision`, `validation`, `quality.parts`, `cost`, lineage in `context.marks[].lineage`,
  `result.audit`, `result.version`.
- Learning loop tab: `log()`, `gaps()` with "Draft a fix" (`draft({ fromGap, author: persona })`), `changes()` with
  Test → Review → Approve → Deploy / Reject, `versions()` with Rollback, `actions()`, `verifyAudit()`, `observe()`
  (drift, freshness, cost), `evals()`, "Export changes" (`MCX.service.downloadChanges()`).
- Warehouse sheet: the `OPS` schema (`OPS.ACTION_LOG`) exists after `MCX.service.ready()`; it is not in `MCX.db.stats`.
- `test()` re-asks ~120 questions (2–3 s in the browser); show progress.
- The ports' `web/src/client.js` maps each `MCX.service` method to its endpoint in `docs/API.md`.

## Known limits

- The page's service keeps its state per browser (localStorage); two tabs do not share a session. The Node server and
  the MCP server keep separate state folders.
- `fs.watch` with `recursive` needs Node 20+ on Linux; on Node 18 Linux the watcher falls back to one watcher per
  folder (new folders are picked up only after a restart) and, if that fails, to polling every 2 s.
- A guard rule is code (`src/engine/guard.js`), so a `blocked-benign` gap names it for a person; it is not drafted.
- Rolling back a version that a file edit outside the lifecycle has since changed restores the files the lifecycle
  wrote; the result is reported with `matches: false`.
