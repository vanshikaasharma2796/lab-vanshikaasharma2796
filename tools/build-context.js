#!/usr/bin/env node
/* =====================================================================
   tools/build-context.js — bundle the context layer for the page

   The context layer is kept as plain files in context/:

     personas/<id>.json            who is asking, and what they may see
     glossary/<term>.md            a business term and what it maps to
     skills/<name>/SKILL.md        a playbook; params.json beside it holds its numbers
     models/<TABLE>.json           a certified table: columns, metrics, joins
     policies/<name>.md            rules every answer follows
     sources.json                  the source registry: every system context comes from
     knowledge/<id>.md             written know-how (wiki pages), front matter + markdown
     work/<id>.json                recent work: chat threads, emails, call notes
     routing.json                  which executor handles which kind of request
     actions.json                  actions an answer may propose, and who approves them

   A page opened by double-click cannot read files, so this script packs
   them into one script, context/bundle.js, which the page loads.

   Run it after changing anything in context/:   node tools/build-context.js
   ===================================================================== */
'use strict';

const path = require('path');
const { build } = require('./lib/context-build');

const result = build(path.join(__dirname, '..', 'context'), { write: 'always' });
console.log(`context/bundle.js written${result.written ? '' : ' (no change)'}: ${result.counts} (${Math.round(result.text.length / 1024)} KB)`);
