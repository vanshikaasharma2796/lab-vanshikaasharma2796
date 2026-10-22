#!/usr/bin/env node
/* =====================================================================
   tools/server.js — the context engine over HTTP (A0: APIs)

     node tools/server.js                     http://127.0.0.1:3242
     node tools/server.js --port 8080         or PORT=8080
     node tools/server.js --host 0.0.0.0      listen beyond this machine
     node tools/server.js --var <dir>         where state is kept (default var/)
     node tools/server.js --mode overlay      keep deployed changes in var/ only
                                              (default "files": write them into
                                              context/, rebuild, reload)
     node tools/server.js --no-watch          do not reload when context/ changes
     node tools/server.js --context <dir>     another copy of context/ (tests, try-outs)
     node tools/server.js --web <dir>         serve another page folder instead of this
                                              project's (the API is unchanged): the
                                              .NET/Java port bundle (index.html, assets/,
                                              src/{config,script,client,app}.js,
                                              data/marcus.js), whose page reaches the engine
                                              over this API through src/client.js.
                                              data/catalog.js is generated from the
                                              question bank the engine routes with.

   Zero dependencies: Node's own http module. It serves the page (same
   files as a double-click, so the page runs its own in-browser engine)
   and every /api/* endpoint, each returning exactly what the matching
   MCX.service method returns. The endpoints, request bodies, responses
   and errors are in docs/API.md; the .NET and Java ports serve the same.
   ===================================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { createNodeService, root } = require('./lib/node-service');
const { MCX } = require('./lib/load');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.otf': 'font/otf', '.wasm': 'application/wasm', '.map': 'application/json; charset=utf-8'
};
// What the page needs; nothing else is served (not var/, tools/, .git, package files).
const PUBLIC = ['index.html', 'assets', 'src', 'context', 'data', 'warehouse', 'vendor', 'evals', 'docs', 'NOTICE.md', 'README.md'];
const MAX_BODY = 1024 * 1024;

function options(argv) {
  const o = { port: Number(process.env.PORT) || 3242, host: '127.0.0.1', varDir: path.join(root, 'var'), mode: 'files', watch: true };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split('=');
    const value = () => (inline !== undefined ? inline : argv[++i]);
    if (flag === '--port') o.port = Number(value());
    else if (flag === '--host') o.host = value();
    else if (flag === '--var') o.varDir = path.resolve(value());
    else if (flag === '--mode') o.mode = value();
    else if (flag === '--no-watch') o.watch = false;
    else if (flag === '--context') o.contextDir = path.resolve(value());
    else if (flag === '--web') o.webDir = path.resolve(value());
    else if (flag === '--quiet') o.quiet = true;
    else if (flag === '--help' || flag === '-h') o.help = true;
  }
  if (!(o.port >= 0 && o.port < 65536)) throw new Error('--port must be a number from 0 to 65535');
  if (['files', 'overlay'].indexOf(o.mode) === -1) throw new Error('--mode must be files or overlay');
  if (o.webDir && !fs.existsSync(path.join(o.webDir, 'index.html'))) throw new Error('--web ' + o.webDir + ' has no index.html');
  return o;
}

function send(res, status, body, type) {
  const text = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(text);
}
function fail(res, status, message, code) { send(res, status, code ? { error: message, code } : { error: message }); }

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('The request body is larger than 1 MB'), { status: 400 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) return resolve({});
      try {
        const body = JSON.parse(text);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
        resolve(body);
      } catch (e) { reject(Object.assign(new Error('The request body must be a JSON object'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

/** The routes: [method, pattern, handler(service, match, query, body)]. */
const ROUTES = [
  ['GET', /^\/api\/status$/, (s) => s.status()],
  ['GET', /^\/api\/health$/, (s) => s.health()],
  ['POST', /^\/api\/ask$/, (s, m, q, b) => s.ask(b)],
  ['POST', /^\/api\/sql$/, (s, m, q, b) => s.sql(b)],
  ['GET', /^\/api\/sources$/, (s) => s.sources()],
  ['GET', /^\/api\/graph$/, (s, m, q) => s.graph({ focus: q.get('focus') || null })],
  ['GET', /^\/api\/search$/, (s, m, q) => s.search({ q: q.get('q'), mode: q.get('mode') || undefined, k: q.get('k') || undefined, persona: q.get('persona') || undefined, kinds: q.get('kinds') || undefined })],
  ['GET', /^\/api\/define$/, (s, m, q) => s.define({ term: q.get('term') })],
  ['GET', /^\/api\/lineage$/, (s, m, q) => s.lineage({ table: q.get('table') || undefined, persona: q.get('persona') || undefined, question: q.get('question') || undefined, slug: q.get('slug') || undefined })],
  ['GET', /^\/api\/log$/, (s, m, q) => s.log({ limit: q.get('limit') || undefined, persona: q.get('persona') || undefined, session: q.get('session') || undefined })],
  ['POST', /^\/api\/feedback$/, (s, m, q, b) => s.feedback(b)],
  ['GET', /^\/api\/gaps$/, (s) => s.gaps()],
  ['GET', /^\/api\/evals$/, (s) => s.evals()],
  ['GET', /^\/api\/actions$/, (s, m, q) => s.actions({ status: q.get('status') || undefined })],
  ['POST', /^\/api\/actions\/([^/]+)\/decide$/, (s, m, q, b) => s.decide(m[1], b)],
  ['GET', /^\/api\/changes$/, (s, m, q) => s.changes({ status: q.get('status') || undefined })],
  ['GET', /^\/api\/changes\/export$/, (s) => s.exportChanges()],
  ['POST', /^\/api\/changes$/, (s, m, q, b) => s.draft(b)],
  ['POST', /^\/api\/changes\/([^/]+)\/test$/, (s, m) => s.test(m[1])],
  ['POST', /^\/api\/changes\/([^/]+)\/review$/, (s, m, q, b) => s.review(m[1], b)],
  ['POST', /^\/api\/changes\/([^/]+)\/approve$/, (s, m, q, b) => s.approve(m[1], b)],
  ['POST', /^\/api\/changes\/([^/]+)\/deploy$/, (s, m, q, b) => s.deploy(m[1], b)],
  ['POST', /^\/api\/changes\/([^/]+)\/reject$/, (s, m, q, b) => s.reject(m[1], b)],
  ['GET', /^\/api\/versions$/, (s) => s.versions()],
  ['POST', /^\/api\/versions\/([^/]+)\/rollback$/, (s, m, q, b) => s.rollback(m[1], b)],
  ['GET', /^\/api\/audit$/, (s, m, q) => s.audit({ limit: q.get('limit') || undefined })],
  ['GET', /^\/api\/audit\/verify$/, (s) => s.verifyAudit()],
  ['GET', /^\/api\/observe$/, (s) => s.observe()],
  ['POST', /^\/api\/retention\/purge$/, (s, m, q, b) => s.retention(b)]
];

async function api(service, req, res, url) {
  const route = ROUTES.filter((r) => r[0] === req.method && r[1].test(url.pathname))[0];
  if (!route) {
    const other = ROUTES.some((r) => r[1].test(url.pathname));
    return fail(res, 404, other ? req.method + ' is not supported on ' + url.pathname : 'No endpoint ' + req.method + ' ' + url.pathname);
  }
  let match;
  try { match = route[1].exec(url.pathname).map((part, i) => (i ? decodeURIComponent(part) : part)); } catch (e) { return fail(res, 400, 'Bad characters in the path'); }
  const body = req.method === 'POST' ? await readBody(req) : {};
  const result = await route[2](service, match, url.searchParams, body);
  send(res, 200, result);
}

/** The question bank as a script, as the .NET and Java servers generate it from data/catalog.json. */
function catalogScript() { return 'MCX.catalog = ' + JSON.stringify(MCX.catalog) + ';\n'; }

function serveFile(req, res, url, webDir) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 404, 'No endpoint ' + req.method + ' ' + url.pathname);
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch (e) { return fail(res, 400, 'Bad characters in the path'); }
  if (rel === '/' || rel === '') rel = '/index.html';
  const parts = rel.split('/').filter(Boolean);
  // No traversal, no hidden files, no backslashes or drive letters; this project: only the public folders;
  // --web: anything in that folder.
  if (!parts.length || parts.some((p) => p === '..' || p === '.' || p.startsWith('.') || /[\\:\0]/.test(p)) || (!webDir && PUBLIC.indexOf(parts[0]) === -1)) return fail(res, 404, 'Not found: ' + rel);
  const base = webDir || root;
  if (webDir && rel === '/data/catalog.js' && !fs.existsSync(path.join(webDir, 'data', 'catalog.js'))) {
    const text = catalogScript();
    res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Content-Length': Buffer.byteLength(text), 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    return res.end(req.method === 'HEAD' ? undefined : text);
  }
  const file = path.resolve(base, ...parts);
  if (file.indexOf(path.resolve(base) + path.sep) !== 0) return fail(res, 404, 'Not found: ' + rel);
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) return fail(res, 404, 'Not found: ' + rel);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

/** Start the server. Resolves with { server, service, url, close() }. */
async function start(argv) {
  const o = options(argv || []);
  const log = (line) => { if (!o.quiet) console.log(line); };
  const service = await createNodeService({ varDir: o.varDir, mode: o.mode, watch: o.watch, contextDir: o.contextDir, log: (line) => log(line) });
  const server = http.createServer((req, res) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch (e) { return fail(res, 400, 'Bad request URL'); }
    if (url.pathname.startsWith('/api/')) {
      api(service, req, res, url).catch((error) => {
        if (error.status) fail(res, error.status, error.message, error.code);
        else { console.error(error.stack || error.message); fail(res, 500, String(error.message || error).split('\n')[0]); }
      });
    } else serveFile(req, res, url, o.webDir);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(o.port, o.host, resolve); });
  const port = server.address().port;
  const url = 'http://' + (o.host === '0.0.0.0' ? 'localhost' : o.host) + ':' + port + '/';
  const health = await service.health();
  log('McContext context engine on ' + url + '  (context version ' + health.version + ', ' + o.mode + ' mode, state in ' + (o.varDir.indexOf(path.resolve(root) + path.sep) === 0 ? path.relative(root, o.varDir).split(path.sep).join('/') : o.varDir) +
    (service.watching ? ', watching context/ via ' + service.watching : '') + ')');
  if (o.webDir) log('Page: ' + o.webDir + ' (it reaches the engine over the API; data/catalog.js is generated)');
  log('API: ' + url + 'api/health · docs/API.md · Ctrl+C to stop');
  const close = () => new Promise((resolve) => { service.close(); server.close(() => resolve()); setTimeout(resolve, 1000).unref(); });
  return { server, service, url, port, close };
}

if (require.main === module) {
  let o;
  try { o = options(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exit(1); }
  if (o.help) { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n\/\*/, '').replace(/^ {3}/gm, '')); process.exit(0); }
  start(process.argv.slice(2)).then((s) => {
    const stop = () => { s.close().then(() => process.exit(0)); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  }, (error) => {
    console.error(error.code === 'EADDRINUSE' ? 'Port ' + o.port + ' is in use. Stop the other server or pass --port <n>.' : (error.stack || error.message));
    process.exit(1);
  });
}

module.exports = { start, options, ROUTES };
