# Copilot instructions for McContext Talk-to-Data (Context Engine)

## What this project is
A browser demo plus an optional zero-dependency Node server. `index.html` loads plain JavaScript files in a fixed order.

Two "analysts" answer the same business question on the same warehouse: one with raw tables only (the bare analyst,
`src/engine/bare.js`), one with the context engine and the context layer in `context/`. The warehouse is SQLite compiled
to WebAssembly (`vendor/sqljs/`), filled by `warehouse/seed.js` from `warehouse/world.js`. There is NO language model
inside: answers are written by deterministic analyses in `src/analyses/`.

The context engine (`src/engine/`: guard, router, search, build, context, validate, actions, quality) and the service
`MCX.service` (`src/service/`: log, feedback, gaps, evals, change lifecycle, actions queue, audit chain, versions,
observe, retention) are mapped element by element in `docs/CONTEXT-ENGINE.md`.

## Facts you can rely on
- No install step, no npm packages. Node.js 18+ is only needed for the tools in `tools/`.
- 6 people, 8 questions each (2 per type: descriptive, diagnostic, prescriptive, predictive) in `data/catalog.js`.
- 82 context files: 6 personas, 20 glossary terms, 16 skills, 11 semantic models, 6 policies, 10 knowledge pages,
  10 work threads, plus `sources.json` (18 sources), `routing.json` (5 rules) and `actions.json`.
- The warehouse has 23 tables (GOLD = certified, BRONZE = raw) and 64,563 rows; `OPS.ACTION_LOG` holds write-backs.
- Evals: 26 business evals (`evals/golden-set.json`), 72 golden answers, a 65-step scenario.
- The server is `tools/server.js` (page + HTTP API, port 3242, 127.0.0.1 only). Its state is in `var/` (not in Git).
- The MCP server is `tools/mcp.js` (stdio), registered for Copilot in `.vscode/mcp.json`.

## Rules
1. Never run `npm install` and never add a dependency. Use only Node's built-in modules.
2. Do not edit generated files by hand: `context/bundle.js`, `evals/bundle.js`, `vendor/sqljs/sql-wasm-binary.js`.
3. After changing anything under `context/`, run `node tools/build-context.js`, then `node tools/validate.js`.
4. After changing `src/`, `data/` or `warehouse/`, run `node tools/validate.js`. It must end with "All checks passed."
   It takes about 2 minutes; wait for it.
5. Do not change `tools/validate.js`, `tools/lib/checks.js` or anything in `evals/` unless the task says so.
   Never run `node tools/golden.js --update` or `node tools/scenario.js --update` unless the task says so.
6. Change only the files the task names. If something else seems to need a change, stop and ask.
7. Start/stop the server with `scripts/start.sh` / `scripts/stop.sh`. Do not delete `var/` unless the task says so.
8. Use the terminal commands exactly as given. The terminal is bash.
9. When you finish, reply with a short table: step, command or file, result.
10. If a command fails, show the error text, explain it in one sentence, and stop. Do not try random fixes.
11. Run terminal commands strictly one at a time, in the order the task gives them. Wait for each command to finish and read its output before you start the next one. Never run two commands in parallel.

## Useful commands
- `node tools/validate.js` - check everything (about 2 minutes)
- `node tools/ask.js <persona> <slug or "question"> [--sql] [--rows] [--context] [--ctx] [--bare] [--engine] [--after="earlier question"]`
- `node tools/ask.js --all [persona]` and `node tools/ask.js --list`
- `node tools/sql.js --tables` and `node tools/sql.js "SELECT ..."`
- `node tools/eval.js`, `node tools/golden.js`, `node tools/scenario.js`
- `node tools/build-context.js` - repack `context/` into `context/bundle.js`
- `node tools/server.js [--port 4242]` - page + API; `node scripts/smoke-test.js` - check the running server
- `node tools/mcp.js --memory` - the MCP server over stdio