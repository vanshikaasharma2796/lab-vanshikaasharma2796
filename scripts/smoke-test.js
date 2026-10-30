#!/usr/bin/env node
/* =====================================================================
   scripts/smoke-test.js — is the locally deployed server working?

     node scripts/smoke-test.js              checks http://127.0.0.1:3242
     node scripts/smoke-test.js --port 4242

   Eight quick checks of tools/server.js (page + HTTP API); prints
   PASS/FAIL for each and exits with 1 if any fail. The ask check is
   logged and audited by the server like any other answer.
   ===================================================================== */
'use strict';

const http = require('http');

const args = process.argv.slice(2);
const at = args.indexOf('--port');
const PORT = Number(at !== -1 ? args[at + 1] : process.env.PORT || 3242);

function request(method, urlPath, body) {
  return new Promise((resolve) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method, timeout: 15000,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
        resolve({ status: res.statusCode, type: res.headers['content-type'] || '', body: text, json });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', (error) => resolve({ status: 0, type: '', body: '', json: null, error: error.message }));
    if (data) req.write(data);
    req.end();
  });
}
const get = (p) => request('GET', p);
const post = (p, b) => request('POST', p, b);
const got = (r) => 'got ' + (r.error || r.status);

const checks = [
  ['health: engine ready', async () => { const r = await get('/api/health'); return r.status === 200 && r.json.ok && r.json.warehouse.ready ? 'ok' : got(r); }],
  ['page loads', async () => { const r = await get('/'); return r.status === 200 && r.type.startsWith('text/html') && r.body.includes('Two AI analysts') ? 'ok' : got(r); }],
  ['SQLite WebAssembly served as application/wasm', async () => { const r = await get('/vendor/sqljs/sql-wasm.wasm'); return r.status === 200 && r.type === 'application/wasm' ? 'ok' : got(r) + ' ' + r.type; }],
  ['hidden, private and outside files are refused', async () => {
    const codes = [];
    for (const p of ['/.git/config', '/..%2f..%2fpackage.json', '/var/', '/tools/server.js']) codes.push((await get(p)).status);
    return codes.every((c) => c === 404) ? 'ok' : 'got ' + codes.join(', ');
  }],
  ['ask: Marcus gets the drive-thru diagnosis', async () => {
    const r = await post('/api/ask', { persona: 'marcus', question: 'Why is my drive-thru time up this week?', session: 'smoke' });
    return r.status === 200 && r.json.route.analysis === 'drive-thru-diagnosis' && r.json.validation.ok ? 'ok' : got(r);
  }],
  ['search: hybrid search finds the sauce shortage', async () => {
    const r = await get('/api/search?q=sauce%20shortage&persona=lena&k=3');
    return r.status === 200 && r.json.hits.length > 0 ? 'ok' : got(r);
  }],
  ['sql: writes are refused (read-only)', async () => { const r = await post('/api/sql', { sql: 'DELETE FROM GOLD.FRANCHISE_STORE_DIM' }); return r.status === 400 ? 'ok' : got(r); }],
  ['audit: the hash chain verifies', async () => { const r = await get('/api/audit/verify'); return r.status === 200 && r.json.ok ? 'ok' : got(r); }]
];

(async () => {
  let failed = 0;
  console.log('Smoke test against http://127.0.0.1:' + PORT + '/');
  for (const [name, run] of checks) {
    let result;
    try { result = await run(); } catch (error) { result = error.message.split('\n')[0]; }
    if (result !== 'ok') failed++;
    console.log((result === 'ok' ? 'PASS  ' : 'FAIL  ') + name + (result === 'ok' ? '' : '  (' + result + ')'));
  }
  console.log(failed ? failed + ' check(s) failed.' : 'All ' + checks.length + ' checks passed.');
  process.exitCode = failed ? 1 : 0;
})();