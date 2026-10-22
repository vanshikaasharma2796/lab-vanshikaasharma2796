/* =====================================================================
   tools/lib/context-files.js — write a lifecycle change into context/

   The service describes a change (src/service/changes.js); this puts it
   in the file it belongs to, keeping everything else in the file as it
   was:

     add-synonym   the "synonyms: [...]" line of the glossary file
     set-param     one value in skills/<id>/params.json (2-space JSON)
     edit-text     the markdown body after the front matter
     add-note      the markdown body after the front matter

   writeChange(contextDir, change) -> [{ file, before, after }]  (text of each file)
   restore(contextDir, files)      puts the "before" text back (rollback)
   ===================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { readValue } = require('./context-build');

/** 'context/glossary/x.md' -> <contextDir>/glossary/x.md (the path must stay inside contextDir). */
function absolute(contextDir, rel) {
  const parts = String(rel).split('/');
  if (parts[0] !== 'context' || parts.some((p) => p === '..' || p === '')) throw new Error('Not a context file: ' + rel);
  const full = path.resolve(contextDir, ...parts.slice(1));
  if (full.indexOf(path.resolve(contextDir) + path.sep) !== 0) throw new Error('Not a context file: ' + rel);
  return full;
}

function splitFrontMatter(text, file) {
  const m = /^(---\n[\s\S]*?\n---)\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n'));
  if (!m) throw new Error(file + ': no front matter');
  return { head: m[1], body: m[2] };
}

function nextText(contextDir, change, before) {
  if (change.kind === 'add-synonym') {
    const { head, body } = splitFrontMatter(before, change.file);
    const line = /^synonyms:(.*)$/m.exec(head);
    const list = line ? readValue(line[1].trim(), change.file) : [];
    const synonyms = Array.isArray(list) ? list.slice() : [];
    if (synonyms.indexOf(change.value) === -1) synonyms.push(change.value);
    const next = 'synonyms: [' + synonyms.join(', ') + ']';
    const head2 = line ? head.replace(/^synonyms:.*$/m, next) : head.replace(/\n---$/, '\n' + next + '\n---');
    return head2 + '\n' + body;
  }
  if (change.kind === 'set-param') {
    const params = JSON.parse(before);
    const keys = change.target.slice(change.target.indexOf(':') + 1).split('.');
    let node = params;
    keys.slice(0, -1).forEach((k) => {
      if (!node || typeof node !== 'object' || !(k in node)) throw new Error(change.file + ': no parameter ' + keys.join('.'));
      node = node[k];
    });
    if (!node || typeof node !== 'object' || !(keys[keys.length - 1] in node)) throw new Error(change.file + ': no parameter ' + keys.join('.'));
    node[keys[keys.length - 1]] = change.value;
    return JSON.stringify(params, null, 2) + '\n';
  }
  if (change.kind === 'edit-text' || change.kind === 'add-note') {
    const { head } = splitFrontMatter(before, change.file);
    return head + '\n\n' + String(change.after).trim() + '\n';
  }
  throw new Error('Unknown change kind ' + change.kind);
}

/** Write one change into its file. Returns what was there before and what is there now. */
function writeChange(contextDir, change) {
  const file = absolute(contextDir, change.file);
  const before = fs.readFileSync(file, 'utf8');
  const after = nextText(contextDir, change, before);
  fs.writeFileSync(file, after);
  return [{ file: change.file, before, after }];
}

/** Put files back as they were (newest change first is the caller's job). */
function restore(contextDir, files) {
  (files || []).forEach((f) => fs.writeFileSync(absolute(contextDir, f.file), f.before));
}

module.exports = { writeChange, restore, absolute, nextText };
