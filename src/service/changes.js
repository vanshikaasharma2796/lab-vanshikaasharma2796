/* =====================================================================
   src/service/changes.js — what a context change is, and how it applies

   The lifecycle (C1–C6) works on small, typed changes to the context
   repository. Each one names a target, the file it lives in, and the
   team that owns that file (who must sign it off):

     add-synonym   target: a glossary term id        value: the new wording
                   e.g. { target: 'drive-thru-time', value: 'queue time' }
     set-param     target: '<skill>:<path.in.params>' value: the new number
                   e.g. { target: 'what-if-analysis:loss_rule.share_of_orders', value: 0.1 }
     edit-text     target: '<kind>:<id>'              value: the new body (markdown)
     add-note      target: '<kind>:<id>'              value: a note, appended to the body as
                                                      "Field note (YYYY-MM-DD, Name): ..."
                   kind is glossary, skill, policy or knowledge

   describe(repo, spec, at) checks a change and works out its file, owner,
   before and after. apply(repo, change) puts it into a repository object
   (in place). Both are pure: the same repository and change give the same
   result in the browser, in Node and in the ports.
   ===================================================================== */
(function (global) {
  'use strict';
  var MCX = (global.MCX = global.MCX || {});

  var KINDS = ['add-synonym', 'set-param', 'edit-text', 'add-note'];
  var COLLECTIONS = { glossary: 'glossary', skill: 'skills', policy: 'policies', knowledge: 'knowledge' };

  function fail(status, message) { var e = new Error(message); e.status = status; return e; }

  function textTarget(repo, target) {
    var at = String(target || '').indexOf(':');
    var kind = at === -1 ? '' : target.slice(0, at), id = at === -1 ? '' : target.slice(at + 1);
    if (!COLLECTIONS[kind]) throw fail(400, 'target must be glossary:<id>, skill:<id>, policy:<id> or knowledge:<id>');
    var item = (repo[COLLECTIONS[kind]] || {})[id];
    if (!item) throw fail(404, 'No ' + kind + ' called ' + id + ' in the context repository');
    return { kind: kind, id: id, item: item };
  }

  function paramAt(params, path) {
    var parts = path.split('.'), node = params;
    for (var i = 0; i < parts.length - 1; i++) {
      if (!node || typeof node !== 'object' || !(parts[i] in node)) return { found: false };
      node = node[parts[i]];
    }
    var leaf = parts[parts.length - 1];
    if (!node || typeof node !== 'object' || Array.isArray(node) || !(leaf in node)) return { found: false };
    return { found: true, parent: node, key: leaf, value: node[leaf] };
  }

  function personName(repo, id) { var p = repo.personas[id]; return p ? p.name : id; }

  /**
   * Check a change and work out where it lands.
   * spec: { kind, target, value, author }   at: ISO time of the draft (dates a note)
   * -> { file, owner, label, before, after }
   */
  function describe(repo, spec, at) {
    if (KINDS.indexOf(spec.kind) === -1) throw fail(400, 'kind must be one of ' + KINDS.join(', '));
    if (spec.kind === 'add-synonym') {
      var term = repo.glossary[spec.target];
      if (!term) throw fail(404, 'No glossary term called ' + spec.target + ' in the context repository');
      var phrase = String(spec.value == null ? '' : spec.value).trim().toLowerCase().replace(/\s+/g, ' ');
      if (phrase.length < 2 || phrase.length > 60 || !/^[a-z0-9][a-z0-9 '&\/-]*$/.test(phrase)) throw fail(400, 'a synonym is 2 to 60 letters, digits, spaces, hyphens, slashes, ampersands or apostrophes');
      Object.keys(repo.glossary).forEach(function (id) {
        if ((repo.glossary[id].synonyms || []).indexOf(phrase) !== -1) throw fail(409, '“' + phrase + '” is already a synonym of ' + id);
      });
      var synonyms = (term.synonyms || []).slice();
      return { file: term.file, owner: term.owner, label: 'Add “' + phrase + '” as a synonym of ' + term.name, value: phrase, before: synonyms, after: synonyms.concat([phrase]) };
    }
    if (spec.kind === 'set-param') {
      var cut = String(spec.target || '').indexOf(':');
      var skillId = cut === -1 ? '' : spec.target.slice(0, cut), path = cut === -1 ? '' : spec.target.slice(cut + 1);
      var skill = repo.skills[skillId];
      if (!skill) throw fail(404, 'No skill called ' + skillId + ' in the context repository (target is <skill>:<param.path>)');
      var found = paramAt(skill.params || {}, path);
      if (!found.found) throw fail(404, 'No parameter ' + path + ' in ' + skillId + '/params.json');
      var value = spec.value;
      if (typeof found.value === 'number' && typeof value === 'string' && value.trim() !== '' && !isNaN(Number(value))) value = Number(value);
      if (found.value === null || typeof found.value === 'object') throw fail(400, path + ' is not a single value; change one of its parts');
      if (typeof value !== typeof found.value) throw fail(400, path + ' is a ' + typeof found.value + '; the new value must be one too');
      if (typeof value === 'number' && !isFinite(value)) throw fail(400, 'the new value must be a finite number');
      return { file: 'context/skills/' + skillId + '/params.json', owner: skill.owner, label: 'Set ' + skillId + ' ' + path + ' from ' + JSON.stringify(found.value) + ' to ' + JSON.stringify(value), value: value, before: found.value, after: value };
    }
    var t = textTarget(repo, spec.target);
    var text = String(spec.value == null ? '' : spec.value).trim();
    if (!text) throw fail(400, 'value must be the ' + (spec.kind === 'add-note' ? 'note' : 'new text'));
    if (text.length > 20000) throw fail(400, 'value is longer than 20,000 characters');
    var before = String(t.item.body || '');
    var name = t.item.name || t.item.title || t.id;
    if (spec.kind === 'edit-text') return { file: t.item.file, owner: t.item.owner, label: 'Rewrite the text of ' + name, value: text, before: before, after: text };
    var line = 'Field note (' + String(at || '').slice(0, 10) + ', ' + personName(repo, spec.author) + '): ' + text.replace(/\s*\n\s*/g, ' ');
    return { file: t.item.file, owner: t.item.owner, label: 'Add a field note to ' + name, value: text, before: before, after: before + '\n\n' + line };
  }

  /** Put a described change into a repository object (in place). Returns the repository. */
  function apply(repo, change) {
    if (change.kind === 'add-synonym') {
      // Added, not replaced: synonym changes compose in any order, and rolling one back leaves the others.
      var term = repo.glossary[change.target];
      if (!term) throw fail(409, 'The glossary term ' + change.target + ' is no longer there');
      term.synonyms = (term.synonyms || []).slice();
      if (term.synonyms.indexOf(change.value) === -1) term.synonyms.push(change.value);
    } else if (change.kind === 'set-param') {
      var cut = change.target.indexOf(':');
      var found = paramAt(repo.skills[change.target.slice(0, cut)].params, change.target.slice(cut + 1));
      if (!found.found) throw fail(409, 'The parameter ' + change.target + ' is no longer there');
      found.parent[found.key] = change.after;
    } else {
      textTarget(repo, change.target).item.body = change.after;
    }
    return repo;
  }

  /** The people who sign off a file owned by this team (context/actions.json, signoff). */
  function signoff(repo, owner) {
    var list = repo.actions && repo.actions.signoff && repo.actions.signoff[owner];
    return Array.isArray(list) ? list.slice() : [];
  }

  MCX.changes = { KINDS: KINDS, describe: describe, apply: apply, signoff: signoff };
})(typeof window !== 'undefined' ? window : globalThis);
