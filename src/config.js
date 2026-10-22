/* =====================================================================
   src/config.js — everything you are likely to want to change

   Loaded first. It creates the global MCX object, holds the brand names,
   the on-screen copy and the replay pacing, and gives the data files a
   place to register themselves.
   ===================================================================== */
(function (global) {
  'use strict';

  var MCX = (global.MCX = global.MCX || {});

  MCX.config = {
    /* ---- Brand ------------------------------------------------------
       contextLayer is the name shown wherever the context layer is
       mentioned: panel title, hover cards, "Powered by ..." lines and the
       source of every persona / glossary / skill / model load.
       To use your own logo, replace assets/img/context-layer-logo.svg
       (keep the file name) or point contextLogo at another image.      */
    brand: {
      company: 'McContext Burger',
      analyst: 'McContext analyst',
      contextLayer: 'Regenesys AI',
      warehouse: 'Snowflake',
      companyLogo: 'assets/img/mccontext-logo.svg',
      contextLogo: 'assets/img/context-layer-logo.svg'
    },

    /* ---- Copy -------------------------------------------------------
       {context} and {warehouse} are replaced with the brand names above. */
    copy: {
      pageTitle: 'Two AI analysts · same question · McContext × {context}',
      eyebrow: 'Live demo',
      headline: 'Two AI analysts · same question · same warehouse · <em>different answers?</em>',
      bankHint: 'Pick a question — answered <b>both ways</b>, side by side.',
      emptyPanel: 'Pick a question, then press <strong>Run</strong>.',
      noReplay: 'No replay is bundled for this question yet.',
      bare: {
        name: '{analyst}',
        meta: 'Raw SQL · bare schemas, no context',
        footer: 'Powered by raw SQL · bare schemas, no context layer'
      },
      context: {
        name: '{analyst} + {context}',
        meta: 'Connected · persona, glossary, skills, semantic models',
        footer: 'Powered by {context} · persona + glossary + diagnostic playbook + semantic models'
      },
      timelineLabel: 'Tool-call timeline',
      timelineHint: 'Hover any block',
      timelineEmpty: 'Awaiting tool calls',
      citeTitle: "Powered by {context}'s context layer",
      citeCue: '↓ pulsing in trace below',
      kinds: {
        context: '{context} context',
        warehouse: '{warehouse} query',
        warehouseLive: 'Warehouse query',  // a live answer runs on the warehouse inside the page
        // Context-engine steps: each has its own colour and icon in the trace and the timeline
        guard: 'Guard',
        route: 'Routing',
        doc: 'Knowledge page',
        work: 'Work thread',
        memory: 'Session memory',
        validate: 'Validation',
        action: 'Human check',
        act: 'Write-back'
      },

      /* ---- Under the context answer --------------------------------------
         Quality, cost, feedback, proposed actions (human check) and the
         banners for a blocked or withheld answer. Live answers only.      */
      extras: {
        blocked: 'Blocked by the guard',
        blockedLine: '{reason}. The analyst without context ran it anyway.',
        withheld: 'Answer withheld',
        withheldLine: 'It failed a check before it reached you: {failed}. Nothing was written and no action was proposed.',
        withheldShow: 'Show the withheld answer (kept for review)',
        masked: 'Personal data masked',
        maskedLine: 'Read as: “{clean}”',
        memory: 'Remembered',
        memoryLine: 'Read with the earlier turn: “{from}” → “{question}”',
        quality: 'Quality',
        qualityTitle: 'How well this answer is grounded',
        bands: { strong: 'strong', fair: 'fair', weak: 'weak' },
        parts: { grounded: 'Grounded', coverage: 'Words understood', budget: 'Budget fit', guard: 'Guard', validation: 'Validation', freshness: 'Fresh sources' },
        cost: '{tokens} tokens · {currency} {estimate}',
        audit: 'Audit {id}',
        feedback: 'Was this useful?',
        up: 'Useful',
        down: 'Not useful',
        notePlaceholder: 'Add a note (optional). Personal data is masked.',
        send: 'Send feedback',
        thanks: 'Thanks. Logged as {id}{note}.',
        actions: 'Proposed actions',
        actionsHint: 'Nothing is written until a person says yes.',
        humanCheck: 'Human check by {role}',
        lowImpact: 'Low impact: the asker or {role} decides',
        decideAs: 'Decide as',
        approve: 'Approve',
        reject: 'Reject',
        written: 'Written to {system} as {ref} (simulated)',
        rejected: 'Rejected by {by}',
        working: 'Working…'
      },

      /* ---- Live mode ---------------------------------------------------
         Everything the page says when a question is answered by the live
         engine instead of a recorded replay. Slots such as {name}, {n} and
         {tokens} are filled in by the page. Word pairs are singular, plural. */
      mode: {
        label: 'Answer source',
        recorded: 'Recorded',
        live: 'Live',
        recordedTitle: 'Replay the recorded answers',
        liveTitle: 'Answer with the live engine',
        noRecordings: 'Nothing is recorded for {name}. These questions are answered live.',
        noEngine: 'The live engine did not start, so live answers are unavailable.'
      },
      ask: {
        placeholder: 'Or type your own question — it is answered live',
        label: 'Your own question',
        button: 'Ask',
        own: 'Ask your own',
        kind: 'Typed',
        emoji: '💬',
        unavailable: 'Typed questions need the live engine, which did not start.'
      },
      live: {
        starting: 'Starting…',
        footerSuffix: ' · live',
        contextFooter: 'Powered by {context} · {loaded}',
        loaded: {
          persona: 'persona',
          policies: ['policy', 'policies'],
          terms: ['glossary term', 'glossary terms'],
          skills: ['skill', 'skills'],
          models: ['semantic model', 'semantic models']
        },
        noAnalysis: 'This question has no live analysis yet.',
        costCap: 'The daily cost cap for this person is reached. It resets at midnight UTC.',
        failed: 'This question could not be answered live.',
        unavailable: 'The live engine did not start, and nothing is recorded for this question.',
        rows: ['row', 'rows'],
        moreRows: ['{n} more not shown', '{n} more not shown'],
        noRows: 'No rows',
        queryLine: '{ms} ms in the in-page warehouse',
        tokens: ['token', 'tokens'],
        routes: {
          match: 'Matched to: “{like}”',
          lookup: 'Answered from the semantic layer',
          'out-of-scope': 'Refused by the persona-scope policy',
          none: 'No certified answer',
          blocked: 'Blocked by the guard'
        }
      },
      strip: {
        starting: 'Starting the live engine…',
        ready: 'Live engine ready · warehouse: {rows} rows in {tables} tables, built in {ms} ms ({engine} in this page) · context repository: {files} files, {tokens} tokens',
        readyRemote: 'Live engine ready on the server · warehouse: {rows} rows in {tables} tables, built in {ms} ms ({engine}) · context repository: {files} files, {tokens} tokens',
        failed: 'The live engine did not start: {error}. Recorded replays still work.',
        repository: 'Context repository',
        warehouse: 'Warehouse',
        loop: 'Learning loop'
      },
      contextButton: {
        label: 'Context',
        title: 'See the context that was assembled for this question',
        disabledTitle: 'Run a question live to see the context that was assembled'
      },
      sheet: {
        title: '{context} context layer',
        sub: 'What the analyst on the right is given, and where it comes from',
        close: 'Close',
        // The order here is the order of the tabs.
        tabs: { question: 'This question', prompt: 'As one prompt', guardrails: 'Guardrails', repository: 'Repository', warehouse: 'Warehouse', loop: 'Learning loop' },
        empty: 'Run a question live to see the context that was assembled for it.',
        facts: { scope: 'Scope', analysis: 'Analysis', route: 'Route' },
        budget: 'Context budget',
        budgetLine: '{used} of {budget} tokens · the whole repository is {repo}',
        factsLine: 'Facts: {facts} of {budget} tokens · pinned instructions {instructions} · tools {tools} · memory {memory} · handed over in all: {total}',
        compacted: 'Compacted to fit the budget: {names}. That saved {saved} tokens.',
        groups: { instructions: 'Pinned instructions', persona: 'Who is asking', policies: 'Rules', memory: 'Memory', terms: 'What the words mean', skills: 'Playbooks',
          models: 'Certified tables', facts: 'Facts from knowledge and work', tools: 'Tools it may use' },
        tags: { compact: 'compact', late: 'loaded mid-run', masked: 'masked' },
        leftOut: 'Considered, not loaded',
        reasons: { access: 'access', residency: 'residency', retention: 'retention', draft: 'draft', threshold: 'not close enough', limit: 'enough already', budget: 'over budget' },
        guardrails: {
          intro: 'Every live answer is screened, routed, checked and scored before it is shown, and written to a tamper-evident audit trail.',
          guard: 'Guard', route: 'Route decision', validation: 'Validation', quality: 'Quality', cost: 'Cost and budget',
          lineage: 'Lineage: every finding back to its source system', audit: 'Audit entry', version: 'Context version', execution: 'Execution bounds',
          noFindings: 'Nothing found: no injection, no bulk personal data, no secrets, no personal data in the question.',
          spentToday: '{name} has spent {currency} {spent} of {cap} today (the daily cap)'
        },
        loop: {
          intro: 'Every answer is logged; people vote; the engine spots gaps and drafts a fix; a fix is tested on a copy, reviewed, signed off by the file’s owner and deployed as a new version, which can be rolled back.',
          observe: 'Today at a glance', log: 'Answer log', feedback: 'Feedback', gaps: 'Gaps', changes: 'Changes', versions: 'Versions',
          actions: 'Actions queue', audit: 'Audit trail', evals: 'Evals', freshness: 'Freshness and drift', retention: 'Retention',
          draft: 'Draft a fix', test: 'Test', review: 'Review', approveStep: 'Approve', deploy: 'Deploy', reject: 'Reject', rollback: 'Roll back',
          exportChanges: 'Export changes', verify: 'Verify the chain', runEvals: 'Run the evals', purge: 'Purge old entries',
          testing: 'Testing on a copy of the context: re-asking the gap question, every golden answer and the evals…',
          emptyLog: 'Nothing asked yet. Run a question live.', emptyGaps: 'No gaps yet. Ask something the engine does not know, such as “queue time by region this week”.',
          emptyChanges: 'No changes yet. Draft a fix from a gap.', emptyActions: 'No actions yet. Prescriptive and predictive answers propose them.'
        },
        kinds: { persona: 'Persona', term: 'Glossary term', skill: 'Skill', model: 'Semantic model', policy: 'Policy', doc: 'Knowledge page', work: 'Work thread' },
        available: '{terms}, {skills}, {models} and {policies} were available.',
        availableWords: {
          terms: ['glossary term', 'glossary terms'],
          skills: ['skill', 'skills'],
          models: ['model', 'models'],
          policies: ['policy', 'policies']
        },
        promptCaption: 'This is the text a language model would be handed. In this build a deterministic engine follows it instead.',
        copy: 'Copy',
        copied: 'Copied',
        copyFailed: 'Select the text to copy it',
        repositoryCaption: 'These are plain files in the <code>context/</code> folder. Edit one, run <code>node tools/build-context.js</code>, reload, and the answers change.',
        repositoryTotal: '{files} files · {tokens} tokens',
        repositoryGroups: { persona: 'Personas', term: 'Glossary', skill: 'Skills', model: 'Semantic models', policy: 'Policies',
          doc: 'Knowledge pages', work: 'Work threads', source: 'Sources', catalog: 'Routing and actions' },
        repositoryMissing: 'The context repository did not load.',
        warehouseCaption: 'The warehouse is SQLite compiled to WebAssembly, running in this page, filled with generated McContext data. In production this is your own warehouse; the context layer and the SQL stay the same.',
        warehouseCaptionRemote: 'The warehouse is SQLite, running on the server next to the engine, filled with generated McContext data. In production this is your own warehouse; the context layer and the SQL stay the same.',
        warehouseFacts: { engine: 'Engine', rows: 'Rows', tables: 'Tables', built: 'Built in' },
        warehouseStarting: 'The warehouse is still being built.',
        warehouseFailed: 'The warehouse did not start.',
        tables: ['table', 'tables'],
        schemas: {
          GOLD: 'Certified tables, described by the context layer',
          BRONZE: 'Raw tables, all the bare analyst can read'
        },
        ops: 'Write-back: every approved action lands here and in the outbox, with a simulated Jira, ServiceNow, Slack or SAP reference',
        graph: 'Knowledge graph',
        graphLine: '{nodes} nodes and {edges} links join people, stores, terms, metrics, tables, pages, threads and the systems they come from.',
        neighbourhood: 'Around this question',
        sources: 'Sources'
      }
    },

    /* ---- Pacing (milliseconds) ---------------------------------------
       Each wait gets ±25% jitter. The bare analyst is quick and frantic;
       the context analyst is slower and deliberate, except for its
       context loads, which land in a fast flurry.                       */
    pacing: {
      bare:    { call: 150, result: 240, say: 360, answer: 700 },
      context: { call: 240, result: 360, say: 470, answer: 900 },
      load: 125,                 // persona / glossary / skill / model loads
      contextHeadStart: 220,     // the context panel starts a beat later
      afterQuestion: [280, 480], // pause after the question bubble lands
      hold: 1100,                // extra time on lines marked hold: true
      typing: { base: 900, extra: 400 },
      jitter: 0.25,
      speed: 1                   // 2 = twice as fast, 0.5 = half speed
    },

    /* ---- Behaviour --------------------------------------------------- */
    features: {
      stepDetails: true,   // click a tool row to see the SQL or the source
      answerScroll: 'end'  // 'end' (as the original demo) or 'start'
    },

    /* ---- Live engine ---------------------------------------------------
       contextBudget   tokens the context layer may hand over per question.
                       Lower it (try 2500) and watch cards get compacted.
       resultRows      result rows kept for the "rows" view under a query.
       matchThreshold  how close a typed question must be to a known one
                       (0 to 1) before its analysis is reused.            */
    engine: {
      contextBudget: 4000,
      resultRows: 8,
      matchThreshold: 0.45,

      /* ---- Context engine v2 -------------------------------------------
         region        where this deployment runs: content held in another
                       region (sources.json residency) is never retrieved
         factsBudget   tokens for facts from knowledge pages and work threads,
                       on top of contextBudget
         factsMin      how close in meaning (vector cosine, 0 to 1) a page or
                       thread that shares a glossary term with the question
                       must be to become a fact
         alsoRelevant  one without a shared term must be at least this close;
                       the best fact with a shared term at least this close
                       is added to the answer as an "Also relevant" paragraph
         budgets       contextBudget per question type; each defaults to
                       contextBudget, so today's numbers do not move
         cost          estimate per 1,000 tokens handed over, and the daily
                       cap per person the service layer enforces
         bounds        an analysis that runs more queries or reads more rows
                       than this is stopped, and the answer is withheld
         guard         maxLength: longer questions are blocked
         retention     logDays: the service purges log entries older than this */
      region: 'us',
      factsBudget: 700,
      factsMin: 0.35,
      alsoRelevant: 0.55,
      budgets: { descriptive: 4000, diagnostic: 4000, prescriptive: 4000, predictive: 4000 },
      cost: { perThousand: 0.003, currency: 'USD', dailyCap: 2 },
      bounds: { maxQueries: 25, maxRows: 20000 },
      guard: { maxLength: 500 },
      retention: { logDays: 30 }
    }
  };

  /* ---- Registry: the data files call these ---------------------------- */
  MCX.catalog = null;
  MCX.replays = {};

  /** Register one question's pair of replays: { bare: {...}, context: {...} } */
  MCX.replay = function (personaId, slug, pair) {
    MCX.replays[personaId + '/' + slug] = pair;
  };

  /** Look up the pair for a persona + question slug (or null). */
  MCX.findReplay = function (personaId, slug) {
    return MCX.replays[personaId + '/' + slug] || null;
  };
})(window);
