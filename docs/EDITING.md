# Editing the demo

Everything is plain text. After a change, reload the page. If you changed anything under `context/`, run `node tools/build-context.js` first.

## Names and logos

`src/config.js`, section `brand`:

| Key | What it changes |
|---|---|
| `contextLayer` | The name of the context layer everywhere it appears: the right-hand panel, hover cards, "Powered by ..." lines, the source of every load |
| `company`, `analyst` | The company and the analyst's name |
| `warehouse` | The warehouse named on recorded queries ("Snowflake query") |
| `companyLogo`, `contextLogo` | The two logos. Replace `assets/img/context-layer-logo.svg` with your own file to change the context-layer logo |

No data file names the context layer, so a rename never touches a word such as "Atlanta".

## Wording on the page

`src/config.js`, section `copy`: headline, panel titles, button labels, the status strip, the context sheet.

### Wording of the context-engine parts

All in `src/config.js`, section `copy`:

| Key | What it changes |
|---|---|
| `kinds.guard`, `kinds.route`, `kinds.doc`, `kinds.work`, `kinds.memory`, `kinds.validate`, `kinds.action`, `kinds.act` | The names of the engine's own steps in the timeline hover cards |
| `extras` | Everything under a live context answer: the blocked, withheld, masked and memory banners, the quality badge and its six parts, the cost and audit chips, the feedback box (👍/👎 and note), the proposed actions and their Approve/Reject, the "Written to {system} as {ref} (simulated)" line |
| `sheet.tabs` | The tabs of the context sheet, in order: This question, As one prompt, Guardrails, Repository, Warehouse, Learning loop |
| `sheet.groups`, `sheet.reasons`, `sheet.tags` | "This question": the group titles (pinned instructions, facts, tools, memory, …) and the reasons something was left out (access, residency, retention, draft, not close enough, enough already, over budget) |
| `sheet.guardrails` | The Guardrails tab |
| `sheet.loop` | The Learning-loop tab: section titles, button labels (Draft a fix, Test, Review, Approve, Deploy, Reject, Roll back, Export changes, Verify the chain, Run the evals, Purge old entries) and empty states |
| `sheet.ops`, `sheet.graph`, `sheet.graphLine`, `sheet.neighbourhood`, `sheet.sources` | The OPS write-back table in Warehouse; the knowledge graph and sources in Repository |
| `strip.loop`, `strip.readyRemote`, `sheet.warehouseCaptionRemote` | The "Learning loop" link in the bottom strip; the strip and warehouse lines when the page runs on a server |
| `live.costCap` | What both panels say when the person's daily cost cap is reached |

The colours of the steps and of the sheet's sections are CSS variables at the end of `assets/css/app.css` (`--t-guard`,
`--t-route`, … and `--s-question`, `--s-guardrails`, `--s-loop`, …). Keep text colours at 4.5:1 or more on white.

## Pacing

`src/config.js`, section `pacing`. `speed: 2` plays everything twice as fast. The link parameter `?speed=3` does the same for one visit.

## The question bank

`data/catalog.js`: six people, eight questions each, two per question type. One question per person has `hero: true` and is selected when that person is chosen.

A bank question is answered live by the analysis named `<persona id>/<slug>` in `src/analyses/`, or by the one in its `analysis` field. See `docs/ENGINE.md` to write one.

## Recorded replays

`data/marcus.js` holds Marcus's eight questions as recorded on the public demo. Each is registered with:

```js
MCX.replay('marcus', 'drive-thru-up', {
  bare:    { steps: [...], answer: `...`, marks: [...] },
  context: { steps: [...], answer: `...`, marks: [...] }
});
```

A step is one of:

```js
{ say: 'A reasoning line.', hold: true }              // hold lingers on it
{ sql: `SELECT ...`, key: 'spread', rows: 14, cols: 'STORE_NAME, ...' }   // a warehouse query
{ persona: 'Marcus J. Williams · 14 Southeast stores', meta: 'scope: operator' }
{ term: 'drive-thru-time' }   { skill: 'diagnostic-playbook' }   { model: 'ORDER_TIMING_MART' }
```

`marks` highlights phrases in the answer: `{ good: 'phrase', from: ['query:spread', 'glossary:drive-thru-time'] }` (green, with the steps it rests on) or `{ bad: 'phrase' }` (pink, a guess or a gap).

## The data

`warehouse/world.js` describes the network: operators, stores, the launch and what it did to each kind of kitchen, complaints, stock. `warehouse/seed.js` turns it into tables. Change a number in `world.js` and every live answer changes.

## The page on a server (the .NET and Java ports)

The ports serve this same page from their own server and reach the engine over HTTP. `node tools/web-bundle.js <dir>`
writes that page: `index.html` (this one with the script list `src/config.js`, `src/script.js`, `src/client.js`,
`data/catalog.js`, `data/marcus.js`, `src/app.js`), `assets/`, those four `src/` files and `data/marcus.js`.
`src/client.js` gives the page `MCX.engine`, `MCX.db`, `MCX.context` and every `MCX.service` method it uses, each mapped to
its endpoint in `docs/API.md`. The server generates `data/catalog.js` from its question bank. Try it with
`node tools/server.js --web <dir> --mode overlay --var <a scratch folder>`. After editing `src/app.js`, `src/config.js`,
`src/script.js` or `assets/`, write the bundle again and copy it into the ports' `web/` folders.

## Links

`index.html?persona=priya&q=launch-or-staffing&autorun&speed=2` selects a person and a question and runs it. `?mode=live` or `?mode=recorded` picks the source. `?ask=Why+is+Greg+Novak's+drive-thru+time+up` asks a typed question.
