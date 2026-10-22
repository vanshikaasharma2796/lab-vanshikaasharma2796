/* =====================================================================
   tools/lib/context-build.js — read context/ into one repository object

   The parser behind tools/build-context.js, shared with the server (which
   rebuilds when a file changes or a change is deployed) and with
   tools/lifecycle.js. See tools/build-context.js for the file layout.

     const { build } = require('./context-build');
     const { repo, counts } = build(contextDir, { write: true });   // also writes bundle.js
   ===================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_ROOT = path.join(__dirname, '..', '..', 'context');

/** A small front-matter reader: "key: value" lines between two --- lines. */
function readMarkdown(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!match) throw new Error(file + ': no front matter');
  const head = {};
  match[1].split('\n').forEach((line, n) => {
    if (!line.trim() || line.trim().startsWith('#')) return;
    const at = line.indexOf(':');
    if (at < 1) throw new Error(`${file}: line ${n + 2} is not "key: value"`);
    head[line.slice(0, at).trim()] = readValue(line.slice(at + 1).trim(), file);
  });
  return { head, body: match[2].trim() };
}

function readValue(raw, file) {
  if (raw === '') return '';
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (raw.startsWith('{')) {
    try { return JSON.parse(raw); } catch (e) { throw new Error(file + ': bad JSON value: ' + raw.slice(0, 60)); }
  }
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim();
    return inner ? inner.split(',').map((item) => item.trim().replace(/^["']|["']$/g, '')) : [];
  }
  return raw.replace(/^"(.*)"$/, '$1');
}

const KINDS = ['record', 'knowledge', 'data', 'semantics', 'work', 'runtime'];

/** Parse every file under root into the repository object the page and the engine read. */
function readRepo(root) {

  function list(dir, test) {
    const full = path.join(root, dir);
    return fs.existsSync(full) ? fs.readdirSync(full).filter(test).sort() : [];
  }
  const rel = (...parts) => ['context'].concat(parts).join('/');

  const repo = { personas: {}, glossary: {}, skills: {}, models: {}, policies: {}, sources: [], knowledge: {}, work: {}, routing: null, actions: null };

  list('personas', (f) => f.endsWith('.json')).forEach((f) => {
    const persona = JSON.parse(fs.readFileSync(path.join(root, 'personas', f), 'utf8'));
    persona.file = rel('personas', f);
    repo.personas[persona.id] = persona;
  });

  list('glossary', (f) => f.endsWith('.md')).forEach((f) => {
    const { head, body } = readMarkdown(path.join(root, 'glossary', f));
    if (!head.term) throw new Error(f + ': glossary entry needs "term"');
    repo.glossary[head.term] = Object.assign({}, head, { body, file: rel('glossary', f) });
  });

  list('skills', (d) => fs.existsSync(path.join(root, 'skills', d, 'SKILL.md'))).forEach((d) => {
    const { head, body } = readMarkdown(path.join(root, 'skills', d, 'SKILL.md'));
    if (head.name !== d) throw new Error(`skills/${d}/SKILL.md: name "${head.name}" does not match its folder`);
    const paramsFile = path.join(root, 'skills', d, 'params.json');
    const params = fs.existsSync(paramsFile) ? JSON.parse(fs.readFileSync(paramsFile, 'utf8')) : {};
    repo.skills[d] = Object.assign({ intents: [], when: [], steps: [] }, head, { params, body, file: rel('skills', d, 'SKILL.md') });
  });

  list('models', (f) => f.endsWith('.json')).forEach((f) => {
    const model = JSON.parse(fs.readFileSync(path.join(root, 'models', f), 'utf8'));
    if (model.name + '.json' !== f) throw new Error(`models/${f}: name "${model.name}" does not match the file`);
    model.file = rel('models', f);
    repo.models[model.name] = model;
  });

  list('policies', (f) => f.endsWith('.md')).forEach((f) => {
    const { head, body } = readMarkdown(path.join(root, 'policies', f));
    repo.policies[head.policy] = Object.assign({}, head, { body, file: rel('policies', f) });
  });

  // ---- Context engine v2: sources, knowledge, work, routing, actions ----------------
  function readJson(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(path.relative(root, file) + ': ' + e.message); }
  }
  if (fs.existsSync(path.join(root, 'sources.json'))) {
    repo.sources = readJson(path.join(root, 'sources.json'));
    if (!Array.isArray(repo.sources)) throw new Error('sources.json must be an array');
    repo.sources.forEach((s, i) => {
      ['id', 'kind', 'name', 'system', 'connector', 'location', 'owner', 'residency'].forEach((k) => { if (!s[k]) throw new Error(`sources.json[${i}] has no ${k}`); });
      if (KINDS.indexOf(s.kind) === -1) throw new Error(`sources.json: ${s.id} has an unknown kind ${s.kind}`);
      if (repo.sources.filter((o) => o.id === s.id).length > 1) throw new Error(`sources.json: id ${s.id} is used twice`);
    });
  }
  const sourceIds = repo.sources.map((s) => s.id);

  list('knowledge', (f) => f.endsWith('.md')).forEach((f) => {
    const { head, body } = readMarkdown(path.join(root, 'knowledge', f));
    if (head.id + '.md' !== f) throw new Error(`knowledge/${f}: id "${head.id}" does not match the file`);
    ['title', 'system', 'source', 'owner', 'updated', 'status'].forEach((k) => { if (!head[k]) throw new Error(`knowledge/${f} has no ${k}`); });
    if (['approved', 'draft'].indexOf(head.status) === -1) throw new Error(`knowledge/${f}: status must be approved or draft`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(head.updated))) throw new Error(`knowledge/${f}: updated must be YYYY-MM-DD`);
    if (sourceIds.indexOf(head.source) === -1) throw new Error(`knowledge/${f}: no source called ${head.source} in sources.json`);
    repo.knowledge[head.id] = Object.assign({ terms: [], entities: [], access: ['*'] }, head, { body, file: rel('knowledge', f) });
  });

  list('work', (f) => f.endsWith('.json')).forEach((f) => {
    const thread = readJson(path.join(root, 'work', f));
    if (thread.id + '.json' !== f) throw new Error(`work/${f}: id "${thread.id}" does not match the file`);
    ['system', 'source', 'channel', 'title', 'date'].forEach((k) => { if (!thread[k]) throw new Error(`work/${f} has no ${k}`); });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(thread.date)) throw new Error(`work/${f}: date must be YYYY-MM-DD`);
    if (!Array.isArray(thread.messages) || !thread.messages.length) throw new Error(`work/${f} has no messages`);
    if (sourceIds.indexOf(thread.source) === -1) throw new Error(`work/${f}: no source called ${thread.source} in sources.json`);
    thread.file = rel('work', f);
    repo.work[thread.id] = thread;
  });

  if (fs.existsSync(path.join(root, 'routing.json'))) { repo.routing = readJson(path.join(root, 'routing.json')); repo.routing.file = rel('routing.json'); }
  if (fs.existsSync(path.join(root, 'actions.json'))) { repo.actions = readJson(path.join(root, 'actions.json')); repo.actions.file = rel('actions.json'); }

  const counts = ['personas', 'glossary', 'skills', 'models', 'policies', 'knowledge', 'work'].map((kind) => `${Object.keys(repo[kind]).length} ${kind}`)
    .concat([repo.sources.length + ' sources', (repo.routing ? repo.routing.rules.length : 0) + ' routing rules', (repo.actions ? Object.keys(repo.actions.actions).length : 0) + ' action sets']).join(', ');
  return repo;
}

function countsOf(repo) {
  return ['personas', 'glossary', 'skills', 'models', 'policies', 'knowledge', 'work'].map((kind) => `${Object.keys(repo[kind]).length} ${kind}`)
    .concat([repo.sources.length + ' sources', (repo.routing ? repo.routing.rules.length : 0) + ' routing rules', (repo.actions ? Object.keys(repo.actions.actions).length : 0) + ' action sets']).join(', ');
}

/** The text of context/bundle.js for a repository. */
function bundleText(repo) {
  return `/* Generated by tools/build-context.js from the files in context/. Do not edit: change the source files and rebuild. */
(function (global) {
  var MCX = (global.MCX = global.MCX || {});
  MCX.contextRepo = ${JSON.stringify(repo, null, 1)};
})(typeof window !== 'undefined' ? window : globalThis);
`;
}

/**
 * Read root (default: the project's context/ folder) and, with { write: true }, write root/bundle.js.
 * -> { repo, counts, text, written }
 */
function build(root, options) {
  root = root || DEFAULT_ROOT;
  const repo = readRepo(root);
  const text = bundleText(repo);
  let written = false;
  if (options && options.write) {
    const file = path.join(root, 'bundle.js');
    const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (old !== text || options.write === 'always') { fs.writeFileSync(file, text); written = old !== text; }
  }
  return { repo, counts: countsOf(repo), text, written };
}

module.exports = { build, readRepo, readMarkdown, readValue, bundleText, DEFAULT_ROOT };
