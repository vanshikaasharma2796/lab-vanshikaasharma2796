# MCP server

The context engine as a Model Context Protocol server, so an assistant (GitHub Copilot in VS Code, Claude, any MCP
client) can use it as tools.

```
node tools/mcp.js                 stdio; state (log, audit) in var/mcp/
node tools/mcp.js --var <dir>     state elsewhere
node tools/mcp.js --memory        keep nothing between runs
```

- Transport: stdio, JSON-RPC 2.0, one JSON message per line. **stdout carries protocol messages only**; logs go to stderr.
- Protocol version `2025-06-18` (also answers a client asking for `2025-03-26` or `2024-11-05` with that version).
- Methods: `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`. Unknown methods: `-32601`;
  bad JSON: `-32700`; unknown tool or missing required argument: `-32602`.
- A tool refusal (unknown persona, GOLD-only policy, bad SQL) is a normal result with `isError: true` and the reason as
  text, so the model can read it and try again.
- Results: `content: [{ type: "text", text: <JSON> }]` and the same object as `structuredContent`.
- The warehouse is built at start (about a second); `initialize` is answered at once, tool calls wait for it.
- It runs the same `MCX.service` as the page and the HTTP server (overlay mode: it never writes `context/`). The .NET
  port (`dotnet run --project src/McContext.Cli -- mcp`) and the Java port (`java -jar target/mccontext.jar mcp`) expose
  the same tools with the same schemas and results.

## Tools

| Tool | Arguments | Result |
|---|---|---|
| `ask` | `persona` (marcus, diego, priya, maya, sam, lena), `question`, `session?` (default `"mcp"`: follow-ups use memory) | `{ log, route, analysis, guard, executor, answer, findings: [{ text, sources }], facts: [{ key, title, system, date, snippet }], actions: [{ id, title, system, type, impact, needsApproval, approverRole }], validation, quality: { score, band }, cost, version }` — logged and audited like any answer |
| `search` | `q`, `mode?` (hybrid, keyword, vector), `k?`, `persona?` | `service.search()`: hits with masked snippets |
| `define_term` | `term` | `service.define()`: definition, certified column, the wrong column, owner, synonyms, metrics |
| `sql_gold` | `sql`, `limit?` | `service.sql({ gold: true })`: one read-only SELECT on GOLD tables with a semantic model; BRONZE/OPS refused (certified-sources policy) |
| `lineage` | `persona` + `question`, or `table` | `service.lineage()`: findings with their lineage, or the systems behind a table |
| `sources` | — | `service.sources()`: registry, reachability, freshness, residency, retention, access |
| `observe` | — | `service.observe()`: quality, guard, gaps, changes, actions, cost, drift, audit |

## GitHub Copilot in VS Code

`.vscode/mcp.json` registers the server for the workspace:

```json
{ "servers": { "mccontext": { "type": "stdio", "command": "node", "args": ["${workspaceFolder}/tools/mcp.js"] } } }
```

Open the folder in VS Code (1.99 or later, Copilot Chat in **Agent** mode), start the `mccontext` server from the MCP view
or the `mcp.json` code lens, then ask, for example: *"As Priya, why is Greg Novak's drive-thru time up this week? Use the
mccontext tools"*, *"Define revenue at risk"*, *"Which sources are stale?"*. Node 18 or later must be on the PATH.

## A manual test

Paste these lines into `node tools/mcp.js --memory` (or pipe them in, one per line):

```
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"manual","version":"1"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"define_term","arguments":{"term":"speed of service"}}}
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"sql_gold","arguments":{"sql":"SELECT * FROM BRONZE.RAW_STORES"}}}
{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"ask","arguments":{"persona":"marcus","question":"Why is my drive-thru time up this week?"}}}
{"jsonrpc":"2.0","id":6,"method":"ping"}
```

Expected (shortened):

```
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{"listChanged":false}},"serverInfo":{"name":"mccontext-context-engine",…},"instructions":"…"}}
{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"ask",…},{"name":"search",…},{"name":"define_term",…},{"name":"sql_gold",…},{"name":"lineage",…},{"name":"sources",…},{"name":"observe",…}]}}
{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"{\n \"id\": \"drive-thru-time\", …"}],"structuredContent":{"id":"drive-thru-time",…},"isError":false}}
{"jsonrpc":"2.0","id":4,"result":{"content":[{"type":"text","text":"Refused (403): certified-sources policy: BRONZE is not certified; only GOLD tables with a semantic model may be read"}],"isError":true}}
{"jsonrpc":"2.0","id":5,"result":{"content":[{"type":"text","text":"{\n \"log\": \"log-0001\",\n \"route\": \"match\",\n \"analysis\": \"drive-thru-diagnosis\", …"}],…}}
{"jsonrpc":"2.0","id":6,"result":{}}
```

From bash: `printf '%s\n' '<line 1>' '<line 2>' … | node tools/mcp.js --memory 2>/dev/null`. From PowerShell:
`Get-Content requests.jsonl | node tools/mcp.js --memory`. `node tools/validate.js` runs this exchange automatically
(initialize, tools/list, one `sql_gold` call).
