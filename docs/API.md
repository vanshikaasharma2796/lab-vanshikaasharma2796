# HTTP API

The context engine over HTTP. The original serves it with `node tools/server.js` (zero dependencies, port **3242**); the
.NET port on 3240 and the Java port on 3238 serve **the same endpoints with the same shapes**. Every response body is
exactly what the matching `MCX.service` method returns (`src/service/service.js`; contract in `docs/A2-HANDOFF.md`).

```
node tools/server.js                       http://127.0.0.1:3242   (page + API)
node tools/server.js --port 8080           or PORT=8080
node tools/server.js --host 0.0.0.0        listen beyond this machine (default: 127.0.0.1 only)
node tools/server.js --var <dir>           where state is kept (default var/, gitignored, created on demand)
node tools/server.js --mode overlay        deployed changes stay in var/ (default "files": written into context/)
node tools/server.js --context <dir>       another copy of context/ (try-outs, tests)
node tools/server.js --no-watch            do not reload when context/ changes
node tools/server.js --web <dir>           serve another page folder (the API is unchanged): the .NET/Java port page
                                           written by node tools/web-bundle.js <dir>; it reaches the engine through
                                           src/client.js; GET /data/catalog.js is generated (MCX.catalog = <bank>;)
```

The page itself uses only the endpoints below: every `MCX.service` method it calls is one endpoint (`src/client.js` maps
them; `tools/validate.js` checks that none is missing). Things the in-browser page reads directly come from these too:
the repository library and stats from `GET /api/status` (fetched again after a deploy or a rollback), sources with
freshness from `GET /api/sources`, the graph and the question's neighbourhood from `GET /api/graph` (with and without
`focus`), the `OPS.ACTION_LOG` rows from `POST /api/sql` (`SELECT * FROM OPS.ACTION_LOG ORDER BY at DESC, id DESC`,
`limit` 50; the columns come back even when there are no rows), the feedback list from `GET /api/audit?limit=200`
(entries of type `feedback`), spend today from `GET /api/observe`. No endpoint was added for the page.

## Conventions

- JSON in, JSON out, UTF-8. `POST` bodies are a JSON object (an empty body is `{}`), at most 1 MB.
- Success is `200` with the method's result. Errors are `{ "error": "<sentence>" }`, plus `"code"` when there is one
  (`"cost-cap"`), with:

  | Status | When |
  |---|---|
  | 400 | bad input: missing or malformed field, body not a JSON object, SQL that is not one read-only statement |
  | 403 | refused by a rule: daily cost cap, owner sign-off, author approving their own change, human check by the wrong role, GOLD-only SQL touching another schema |
  | 404 | no such endpoint (also a known path with another method), persona, log entry, gap, change, action, version, graph node, term or file |
  | 409 | wrong state: approving an unreviewed change, deciding a decided action, rolling back to the live version |
  | 500 | anything unexpected (the message is the first line of the error) |

- Times are ISO 8601 UTC from the server clock. Ids: `log-0001`, `fb-0001`, `aud-0001`, `chg-0001`, `out-0001`
  (per-kind counters kept in storage); action ids are 10 hex from the engine (`sha256(analysis|scope|title)`); gap ids
  `gap-` + 10 hex of `sha256(type|persona|question)`; versions 12 hex.
- Persona ids: `marcus`, `diego`, `priya`, `maya`, `sam`, `lena`.
- Static files (without `--web`): `/` is `index.html`; only `index.html`, `assets/`, `src/`, `context/`, `data/`, `warehouse/`, `vendor/`,
  `evals/`, `docs/`, `NOTICE.md`, `README.md` are served; `..`, dot-files, backslashes and anything else are 404. Content
  types include `application/wasm` for `.wasm`.
  With `--web <dir>`: any file in that folder (still no `..`, dot-files or backslashes), and `GET /data/catalog.js`
  generated as `MCX.catalog = <the question bank as JSON>;` when the folder has none (the ports do the same from
  `data/catalog.json`).

## Endpoints

| Method and path | Service method | Body or query |
|---|---|---|
| `GET /api/status` | `status()` | — |
| `GET /api/health` | `health()` | — |
| `POST /api/ask` | `ask(body)` | `{ persona, question, slug?, bucket?, session? }` |
| `POST /api/sql` | `sql(body)` | `{ sql, gold?, limit? }` |
| `GET /api/sources` | `sources()` | — |
| `GET /api/graph` | `graph({ focus })` | `?focus=term:drive-thru-time` (optional) |
| `GET /api/search` | `search({ q, mode, k, persona, kinds })` | `?q=&mode=hybrid|keyword|vector&k=5&persona=&kinds=doc,work` |
| `GET /api/define` | `define({ term })` | `?term=speed%20of%20service` |
| `GET /api/lineage` | `lineage({ table } or { persona, question, slug })` | `?table=GOLD.ORDER_TIMING_MART` or `?persona=&question=` |
| `GET /api/log` | `log({ limit, persona, session })` | `?limit=50` |
| `POST /api/feedback` | `feedback(body)` | `{ log, vote: "up"|"down", note?, by? }` |
| `GET /api/gaps` | `gaps()` | — |
| `GET /api/evals` | `evals()` | — |
| `GET /api/actions` | `actions({ status })` | `?status=proposed|written|rejected` (optional; an approved action is written in the same call, so there is no `approved` status) |
| `POST /api/actions/{id}/decide` | `decide(id, body)` | `{ decision: "approve"|"reject", by, note? }` |
| `GET /api/changes` | `changes({ status })` | `?status=` (optional) |
| `POST /api/changes` | `draft(body)` | `{ fromGap, author? }` or `{ kind, target, value, reason, author }` |
| `POST /api/changes/{id}/test` | `test(id)` | — |
| `POST /api/changes/{id}/review` | `review(id, body)` | `{ by? }` |
| `POST /api/changes/{id}/approve` | `approve(id, body)` | `{ by }` |
| `POST /api/changes/{id}/deploy` | `deploy(id, body)` | `{ by }` |
| `POST /api/changes/{id}/reject` | `reject(id, body)` | `{ by, note? }` |
| `GET /api/changes/export` | `exportChanges()` | — |
| `GET /api/versions` | `versions()` | — |
| `POST /api/versions/{version}/rollback` | `rollback(version, body)` | `{ by }` |
| `GET /api/audit` | `audit({ limit })` | `?limit=50` |
| `GET /api/audit/verify` | `verifyAudit()` | — |
| `GET /api/observe` | `observe()` | — |
| `POST /api/retention/purge` | `retention(body)` | `{ days? }` (default `engine.retention.logDays`, 30) |

The examples below are real (from `evals/scenario-expected.json`, the scripted run at 2026-05-13T15:00Z); long values are
shortened with `…`.

### `GET /api/status`

`{ warehouse: MCX.db.stats, context: MCX.context.stats(), library: MCX.context.library() }`, unchanged from v1:
`warehouse = { tables: [{ schema, name, columns: [names], rows }], rows, ms, engine }`.

### `GET /api/health`

```json
{"ok":true,"version":"47f1fde8f37b","mode":"files","storage":"files",
 "warehouse":{"ready":true,"rows":64563,"tables":23,"ops":0},"sources":{"total":18,"ok":18,"stale":1},
 "audit":{"ok":true,"entries":0},"evals":{"cases":26,"golden":72},"overlay":{"active":0,"skipped":[]}}
```

`mode` is `files` or `overlay`; `storage` is `files`, `localStorage`, `memory` or `memory (localStorage unavailable)`;
`warehouse.ops` = rows in `OPS.ACTION_LOG`; `overlay.skipped` lists deployed changes that no longer apply.

### `POST /api/ask`

```json
{ "persona": "sam", "question": "Why are wait-time complaints up this week? Reply to jordan.miles@example.com", "session": "s1" }
```

Returns the full `MCX.engine.ask()` result (`route, plan, intent, pack, context, bare, ms, guard, decision, facts,
validation, actions, cost, version, build, execution, quality`; see `docs/ENGINE.md`) plus:

```json
"log":   { "id": "log-0003", "at": "2026-05-13T15:03:00Z", "session": "s1" },
"audit": { "id": "aud-0003", "hash": "…64 hex…" },
"queued": ["5a8f042745"]
```

`queued` = action-queue ids for the proposed actions. With `session`, the earlier turns of that session are passed as
`history` (memory). Errors: 400 no question; 404 unknown persona; 403 `{ "error": "The daily cost cap for Lena is reached:
USD 0.0197 of 0.0150 spent on 2026-05-13. It resets at midnight UTC.", "code": "cost-cap" }` once the person's
`cost.estimate` total for the UTC day has reached `engine.cost.dailyCap`.

### `POST /api/sql`

`{ "sql": "SELECT system, type, external_ref, decided_by, status FROM OPS.ACTION_LOG ORDER BY id" }` →

```json
{"columns":["system","type","external_ref","decided_by","status"],
 "rows":[{"system":"SAP","type":"order","external_ref":"PO-4500001042","decided_by":"lena","status":"written"}, …],
 "total":2,"truncated":false,"ms":0.4}
```

One `SELECT`/`WITH` statement (a trailing `;` is allowed); no `INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, ATTACH,
DETACH, PRAGMA, REPLACE, VACUUM, …` anywhere (400 `Read-only: …`). `limit` (default 200, max 1000) caps `rows`; `total`
is the full count. With `"gold": true` (the MCP `sql_gold` tool): only `GOLD.<table>` with a semantic model; `BRONZE.`,
`OPS.`, `main.`, `temp.`, `sqlite_*` → 403 `certified-sources policy: …`.

### `GET /api/sources`

`{ version, today, region, kinds: { record: 7, … }, flags: [{ source, flag, detail }], sources: [...] }`; each source is
`build.report()`'s entry (`id, kind, name, system, connector, ok, items, updated, detail, status, ageHours, slaHours,
fresh`) plus the registry's `owner, location, residency, retention_days, freshness_hours, pii, access, tables, feeds`.

### `GET /api/graph?focus=`

Without focus: `{ nodes: [{ id, type, label }], edges: [{ from, rel, to }], counts: { nodes, edges, types, relations } }`.
With focus: `{ focus, node, edges }` (edges touching the node); 404 when the node does not exist.

### `GET /api/search?q=customer%20phone%20number%20nine%20minutes&persona=sam&k=3`

```json
{"q":"customer phone number nine minutes","mode":"hybrid","k":3,"persona":"sam",
 "hits":[{"kind":"doc","id":"complaint-handling-guide","key":"doc:complaint-handling-guide",
          "title":"Care desk guide: wait-time complaints","heading":"Personal data","system":"SharePoint",
          "source":"sharepoint-policies","date":"2026-05-11","channel":null,
          "snippet":"Do not paste customer emails or phone numbers into Slack or Teams. …","masked":false,
          "score":1,"keyword":12.83,"vector":0.558}, …],
 "filtered":3}
```

Snippets (and `q`) are always PII-masked. With a persona: access, residency, retention and draft filters as in retrieval;
without one: only what everyone may see. `filtered` = hits left out by those filters. 400 on empty `q` or a bad `mode`.

### `GET /api/define?term=speed%20of%20service`

`{ id: "drive-thru-time", name, status, owner, synonyms, maps_to, not, resolves, definition, metrics: ["GOLD.ORDER_TIMING_MART.drive_thru_time", …], file }`
— by id, name, synonym or glossary phrase in the text; 404 if none.

### `GET /api/lineage`

`?table=GOLD.ORDER_TIMING_MART` → `{ table, source: { id, name, system }, upstream: [{ id, name, system }] }`.
`?persona=priya&question=…` → `{ question, route, analysis, version, findings: [{ text, from, lineage }], facts: [{ key,
title, system, date, lineage }] }` (asked through the engine, not logged).

### `GET /api/log?limit=50`

`{ total, purged, entries: [...] }`, newest first. An entry:
`{ id, at, session, persona, slug, question (masked), route, analysis, score, followUp, guard, guardRules, validation,
quality, band, missed, cost: { tokens, estimate }, version, facts, sources, actions, figures, fingerprint, memory, answer }`.

### `POST /api/feedback`

`{ "log": "log-0003", "vote": "down", "note": "Say how long customers actually waited; call me on (404) 555-0182", "by": "sam" }` →

```json
{"id":"fb-0001","at":"2026-05-13T15:07:00Z","log":"log-0003","vote":"down",
 "note":"Say how long customers actually waited; call me on ***-***-0182","by":"sam","persona":"sam",
 "question":"Why are wait-time complaints up this week? Reply to j***@example.com"}
```

`by` defaults to the asker. 404 unknown log; 400 vote not up/down.

### `GET /api/gaps`

```json
{"total":4,"open":4,"gaps":[{"id":"gap-96cf53c327","type":"no-match","persona":"priya",
  "question":"queue time by region this week","count":1,"logs":["log-0006"],
  "first":"2026-05-13T15:06:00Z","last":"2026-05-13T15:06:00Z",
  "detail":"no analysis or certified metric matches the wording; not understood: queue, time",
  "suggestion":{"kind":"add-synonym","target":"drive-thru-time","value":"queue time","reason":"“queue time” was not understood in …"},
  "notes":[],"status":"open","changes":[]}, …]}
```

`type`: `no-match`, `weak-match`, `not-understood`, `down-vote`, `blocked-benign`. `suggestion` is null when there is no
automatic fix (`kind: null` for a guard rule a person must review). `status`: `open`, `drafted`, `fixed`.

### `GET /api/evals`

`{ at, version, score, passed, total, cases: [{ id, title, ok, failures: [sentences], route, analysis, quality }] }`.

### `GET /api/actions` and `POST /api/actions/{id}/decide`

`GET` → `{ total, counts: { proposed, written, rejected }, actions: [...], outbox: [...] }`. An action after approval:

```json
{"id":"79977d5887","action":"79977d5887","at":"2026-05-13T15:36:00Z","log":"log-0010","logs":["log-0010"],
 "persona":"lena","analysis":"lena/retrofit-every-single-lane","type":"order","system":"SAP",
 "title":"Purchase request: PPS-2 kits for every exposed single-lane kitchen","detail":"…",
 "impact":"high","needsApproval":true,"approverRole":"Supply Chain","approvers":["lena"],"why":"the catalog marks it high impact",
 "status":"written","decision":{"at":"2026-05-13T15:42:00Z","by":"lena","decision":"approve","note":"Order the 17 kits; Atlanta first."},
 "write":{"at":"2026-05-13T15:42:00Z","system":"SAP","ref":"PO-4500001042","table":"OPS.ACTION_LOG","outbox":"out-0001",
          "note":"Simulated: written to OPS.ACTION_LOG and the outbox as PO-4500001042; …"}}
```

`decide` body `{ decision, by, note? }` returns the action. 403 when a high-impact action is decided by someone not in
`approvers`, or a low-impact one by someone who is neither the asker nor an approver; 409 when it is not `proposed`. An
outbox record: `{ id, at, system, type, title, detail, by, status: "written", external_ref, action, log, impact, simulated: true }`.
References: Jira `JIRA-1042…`, ServiceNow `INC0010042…`, Slack `SLACK-1042…`, SAP `PO-4500001042…` (a counter per system).

### Changes: `GET /api/changes`, `POST /api/changes`, `/test`, `/review`, `/approve`, `/deploy`, `/reject`

`GET` → `{ total, counts: { draft, tested, reviewed, approved, deployed, rejected, rolled-back }, changes: [...] }`.
`POST /api/changes` with `{ "fromGap": "gap-96cf53c327", "author": "maya" }` or a manual change
`{ "kind": "set-param", "target": "what-if-analysis:loss_rule.share_of_orders", "value": 0.1, "reason": "…", "author": "maya" }`
(kinds and targets in `docs/A2-HANDOFF.md`). Every step returns the whole change; after deploy:

```json
{"id":"chg-0001","at":"2026-05-13T15:11:00Z","kind":"add-synonym","target":"drive-thru-time","value":"queue time",
 "reason":"…","author":"maya","drafter":"engine","note":"Drafted by the engine's rules; with a model connected, the model would draft the wording.",
 "fromGap":"gap-96cf53c327","question":"queue time by region this week","persona":"priya",
 "file":"context/glossary/drive-thru-time.md","owner":"Store Ops","signoff":["priya"],
 "label":"Add “queue time” as a synonym of Drive-thru time","before":[…],"after":[…, "queue time"],
 "status":"deployed","baseVersion":"47f1fde8f37b",
 "test":{"at":"…","sandbox":true,"version":{"live":"47f1fde8f37b","sandbox":"f7c3d0f2cb46"},
         "gap":{"persona":"priya","question":"…","before":{"route":"none","analysis":"no-match","score":null,"quality":60,"understood":"…","missed":["queue","time"],"answer":"…"},
                "after":{"route":"lookup","analysis":"lookup","score":null,"quality":100,"understood":"4 of 4 content words understood","missed":[],"answer":"…"}},
         "resolves":true,"goldenTotal":72,"goldenChanged":[],"evalsBefore":{"score":100,"passed":26,"total":26},
         "evalsAfter":{"score":100,"passed":26,"total":26},"broken":[],"fixed":[]},
 "review":{"at":"…","by":"priya","risk":"none","recommendation":"approve","summary":["…6 sentences…"]},
 "approval":{"at":"…","by":"priya","owner":"Store Ops"},
 "deployment":{"at":"…","by":"priya","version":"f7c3d0f2cb46","previous":"47f1fde8f37b","files":["context/glossary/drive-thru-time.md"],"mode":"overlay"},
 "rejection":null,"rollback":null,
 "history":[{"at":"…","by":"maya","step":"draft","status":"draft","note":"…"}, …]}
```

`goldenChanged` items are `{ id, path }` with `path` one of `route`, `guard.verdict`, `context.answer`, `context.marks`,
`facts`, `actions`, `validation.ok`. Rules: test needs `draft|tested|reviewed` (409); review needs `tested`; approve needs
`reviewed`, `by` in `signoff` (403) and `by ≠ author` (403); deploy needs `approved` and `by` = author or in `signoff`;
reject needs a change that is not live, by the author or a sign-off person. 404 unknown change, target or parameter;
409 synonym already used.

`GET /api/changes/export` → `{ format: "mccontext-changes/1", exported, base, current, changes: [{ id, kind, target,
value, after, file, owner, reason, author, approvedBy, deployedBy, deployedAt, version }] }` (the deployed changes in
order; `node tools/lifecycle.js apply <file>` writes them into `context/`).

### Versions: `GET /api/versions`, `POST /api/versions/{version}/rollback`

```json
{"current":"5ef6f65cd1c9","base":"47f1fde8f37b","active":["chg-0001","chg-0003"],
 "history":[{"version":"47f1fde8f37b","previous":null,"at":"…","by":null,"kind":"base","change":null,"note":"the context as first loaded"},
            {"version":"f7c3d0f2cb46","previous":"47f1fde8f37b","at":"…","by":"priya","kind":"deploy","change":"chg-0001","files":["context/glossary/drive-thru-time.md"]}, …]}
```

`kind`: `base`, `deploy`, `rollback` (`target`, `undone`), `reload` (files changed on disk). Rollback body `{ by }` (a
person who signs off some context file; 403 otherwise) →
`{"version":"f7c3d0f2cb46","previous":"5ef6f65cd1c9","target":"f7c3d0f2cb46","matches":true,"undone":["chg-0003"]}`.
404 unknown version; 409 already live, or nothing deployed through the lifecycle since.

### Audit: `GET /api/audit?limit=5`, `GET /api/audit/verify`

```json
{"total":34,"anchor":null,"entries":[{"id":"aud-0034","seq":34,"at":"2026-05-13T15:44:00Z","type":"action.decide",
  "actor":"lena","subject":"fdade4cb8e","data":{"decision":"reject","impact":"high","needsApproval":true,"note":"…"},
  "prev":"942d0fcf…","hash":"87bcb2ae…"}]}
```

Types: `ask, feedback, action.decide, action.write, change.draft, change.test, change.review, change.approve,
change.deploy, change.reject, version.rollback, context.reload, retention.purge`. Verify →
`{"ok":true,"checked":34,"total":34,"anchor":null,"broken":null,"head":"87bcb2ae…"}`; on tampering `ok: false` and
`broken: { id, seq, reason }`.

### `GET /api/observe`

`{ at, version, versions, answers, avgQuality, bands: { strong, fair, weak }, guard: { blocked, masked }, validationFails,
feedback: { up, down }, gaps: { total, open, drafted, fixed }, changes: {…by status}, actions: {…by status}, written,
cost: { day, currency, cap, total, byPersona }, drift: { alerts, sources, answers, golden }, freshness: [{ id, kind,
status, updated, ageHours, slaHours }], sources: { total, ok, stale }, audit: { entries, ok, head }, evals: last run |
null, retention: { logDays, purged: { log, feedback, audit }, purges } }`. Drift alerts:
`{ kind: "source", id, status, detail }`, `{ kind: "answer", persona, question, log, previous, version, previousVersion,
added, removed }`, `{ kind: "golden", id, log, path, version }`.

### `POST /api/retention/purge`

`{}` → `{"at":"2026-06-20T09:00:00Z","days":30,"cutoff":"2026-05-21T09:00:00Z","purged":{"log":12,"feedback":2,"audit":34},
"kept":{"log":0,"feedback":0,"audit":1},"tombstones":{"log":12,"feedback":2,"audit":34}}` (the kept audit entry is the
purge's own). 400 when `days` is negative.

## Try it with curl

```
curl http://127.0.0.1:3242/api/health
curl -X POST http://127.0.0.1:3242/api/ask -H "Content-Type: application/json" -d "{\"persona\":\"priya\",\"question\":\"queue time by region this week\"}"
curl http://127.0.0.1:3242/api/gaps
curl -X POST http://127.0.0.1:3242/api/changes -H "Content-Type: application/json" -d "{\"fromGap\":\"gap-96cf53c327\",\"author\":\"maya\"}"
curl -X POST http://127.0.0.1:3242/api/changes/chg-0001/test
curl -X POST http://127.0.0.1:3242/api/changes/chg-0001/review -d "{\"by\":\"priya\"}"
curl -X POST http://127.0.0.1:3242/api/changes/chg-0001/approve -d "{\"by\":\"priya\"}"
curl -X POST http://127.0.0.1:3242/api/changes/chg-0001/deploy -d "{\"by\":\"priya\"}"
curl "http://127.0.0.1:3242/api/search?q=sauce%20shortage&persona=lena&k=3"
curl http://127.0.0.1:3242/api/audit/verify
```

In files mode, deploy writes `context/glossary/drive-thru-time.md` and rebuilds `context/bundle.js`; roll back with
`POST /api/versions/<base>/rollback {"by":"priya"}` to restore the file.
