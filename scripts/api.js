#!/usr/bin/env node
/* =====================================================================
   scripts/api.js — call the running server's HTTP API from any shell

     node scripts/api.js GET /api/health
     node scripts/api.js POST /api/ask persona=priya "question=queue time by region this week"
     node scripts/api.js GET /api/search q=sauce mode=keyword k=3 persona=lena
     node scripts/api.js --port 4242 GET /api/observe --only=answers+avgQuality+cost

   key=value pairs become the JSON body (POST) or the query string (GET),
   so no JSON quoting is needed in bash. A value
   that is a number, true, false or null is sent as that; anything else
   as text. --only=a+b.c prints just those fields (use + between them). Exit code 1 on HTTP >= 400.
   ===================================================================== */
'use strict';

const http = require('http');

const args = process.argv.slice(2);
let port = Number(process.env.PORT) || 3242;
let only = null;
const words = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port') port = Number(args[++i]);
  else if (args[i].startsWith('--only=')) only = args[i].slice(7).split(/[+,]/);
  else words.push(args[i]);
}
const [method, path, ...pairs] = words;
if (!method || !path || !path.startsWith('/')) {
  console.log('Usage: node scripts/api.js [--port 3242] GET|POST /api/... [key=value ...] [--only=field+field]');
  process.exit(1);
}

const fields = {};
pairs.forEach((pair) => {
  const at = pair.indexOf('=');
  if (at < 1) { console.log('Not a key=value pair: ' + pair); process.exit(1); }
  const key = pair.slice(0, at), text = pair.slice(at + 1);
  let value = text;
  if (/^(-?\d+(\.\d+)?|true|false|null)$/.test(text)) value = JSON.parse(text);
  fields[key] = value;
});

const isGet = method.toUpperCase() === 'GET';
const query = isGet && pairs.length ? (path.includes('?') ? '&' : '?') + new URLSearchParams(fields).toString() : '';
const body = isGet ? null : JSON.stringify(fields);

const pick = (obj, dotted) => dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

const req = http.request({ host: '127.0.0.1', port, path: path + query, method: method.toUpperCase(), timeout: 120000,
  headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {} }, (res) => {
  let text = '';
  res.setEncoding('utf8');
  res.on('data', (chunk) => { text += chunk; });
  res.on('end', () => {
    console.log('HTTP ' + res.statusCode);
    let json;
    try { json = JSON.parse(text); } catch (e) { console.log(text.slice(0, 2000)); return; }
    if (only && res.statusCode < 400) {
      const out = {};
      only.forEach((f) => { out[f] = pick(json, f); });
      json = out;
    }
    console.log(JSON.stringify(json, null, 2));
    process.exitCode = res.statusCode >= 400 ? 1 : 0;
  });
});
req.on('timeout', () => req.destroy(new Error('timed out')));
req.on('error', (error) => { console.log('Could not reach http://127.0.0.1:' + port + ' (' + error.message + '). Is the server running?'); process.exitCode = 1; });
if (body) req.write(body);
req.end();