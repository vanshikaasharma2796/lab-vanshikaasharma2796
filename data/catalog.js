/* =====================================================================
   data/catalog.js — who can ask, and what they can ask

   Four question types (buckets), six people, eight questions each.
   Mark one question per persona with hero: true; it is pre-selected
   when that persona is chosen.

   Where an answer comes from:
     recorded   a replay registered under the same slug in data/<persona>.js
     live       the analysis named <persona id>/<slug> in src/analyses/,
                or the one named by an "analysis" field on the question

   Marcus's questions are the ones on the public McContext demo, with
   their recorded answers in data/marcus.js; they also run live. The
   other five people are the team around him. Their questions were
   written for this project and are answered live.
   ===================================================================== */
MCX.catalog = {
  buckets: [
    { key: 'descriptive',  emoji: '📊', label: 'What — descriptive' },
    { key: 'diagnostic',   emoji: '🔍', label: 'Why — diagnostic' },
    { key: 'prescriptive', emoji: '🎯', label: 'How — prescriptive' },
    { key: 'predictive',   emoji: '🔮', label: 'What-if — predictive' }
  ],

  defaultPersona: 'marcus',

  personas: [
    {
      id: 'marcus',
      name: 'Marcus J. Williams',
      role: 'Franchise Operator',
      emoji: '🧑‍🍳',
      tag: 'Recorded + live',
      blurb: 'Runs 14 stores in the Southeast.',
      questions: [
        { slug: 'stores-vs-benchmark',     bucket: 'descriptive',  analysis: 'benchmark-scorecard', text: 'How did my stores perform vs benchmark?' },
        { slug: 'drive-thru-last-week',    bucket: 'descriptive',  analysis: 'drive-thru-snapshot', text: 'What was my drive-thru time last week?' },
        { slug: 'drive-thru-up',           bucket: 'diagnostic',   analysis: 'drive-thru-diagnosis', text: 'Why is my drive-thru time up this week?', hero: true },
        { slug: 'combo-revenue-dip',       bucket: 'diagnostic',   analysis: 'combo-revenue-check', text: 'Why did my combo revenue dip after May 7?' },
        { slug: 'drive-thru-to-benchmark', bucket: 'prescriptive', analysis: 'recovery-plan', text: 'How do I bring my drive-thru back to benchmark by Friday?' },
        { slug: 'prioritize-stores',       bucket: 'prescriptive', analysis: 'store-priorities', text: 'Which of my stores should I prioritize this week?' },
        { slug: 'prestage-double-stack',   bucket: 'predictive',   analysis: 'what-if-prestage', text: 'What if I pre-stage Double Stack components — what\'s the impact?' },
        { slug: 'parallel-prep-station',   bucket: 'predictive',   analysis: 'what-if-prep-station', text: 'What if I add a parallel prep station at my single-lane stores?' }
      ]
    },
    {
      id: 'diego',
      name: 'Diego',
      role: 'Ads',
      emoji: '📣',
      tag: 'Live',
      blurb: 'Launched the Double Stack promo.',
      questions: [
        { slug: 'promo-performance',      bucket: 'descriptive',  text: 'How is the Double Stack promo performing since launch?' },
        { slug: 'double-stack-sales-by-region', bucket: 'descriptive', text: 'Which regions are selling the most Double Stack?' },
        { slug: 'double-stack-by-region', bucket: 'diagnostic',   text: 'Why is the Double Stack hurting some regions more than others?', hero: true },
        { slug: 'combo-cannibalization',  bucket: 'diagnostic',   text: 'Is the Double Stack cannibalizing our other combos?' },
        { slug: 'rollout-back-on-track',  bucket: 'prescriptive', text: 'How do we get the Double Stack rollout back on track?' },
        { slug: 'adjust-the-promo',       bucket: 'prescriptive', text: 'How should I adjust the promo while single-lane stores recover?' },
        { slug: 'pause-double-stack',     bucket: 'predictive',   text: 'What if we paused Double Stack at single-lane stores — what\'s the revenue impact?' },
        { slug: 'delay-next-lto',         bucket: 'predictive',   text: 'What if we delay the next LTO by 2 weeks?' }
      ]
    },
    {
      id: 'priya',
      name: 'Priya',
      role: 'Store Ops',
      emoji: '🏪',
      tag: 'Live',
      blurb: 'Knows which stores have one lane or two.',
      questions: [
        { slug: 'distribution-by-lane-type', bucket: 'descriptive',  text: 'What was the drive-thru distribution last week by lane type?' },
        { slug: 'regions-missing-benchmark', bucket: 'descriptive',  text: 'Which regions are missing benchmark right now?' },
        { slug: 'national-drive-thru-up',    bucket: 'diagnostic',   text: 'Why is our drive-thru time up nationally this week?', hero: true },
        { slug: 'launch-or-staffing',        bucket: 'diagnostic',   text: 'Is the Double Stack launch the cause of the drive-thru spike, or is it staffing?' },
        { slug: 'playbook-worst-stores',     bucket: 'prescriptive', text: 'What playbook step do I recommend for the worst-performing single-lane stores?' },
        { slug: 'operators-intervention',    bucket: 'prescriptive', text: 'Which operators need a corporate intervention this quarter?' },
        { slug: 'traffic-up-8-percent',      bucket: 'predictive',   text: 'What if traffic increases 8% — which segments break first?' },
        { slug: 'prestage-everywhere',       bucket: 'predictive',   text: 'What if every single-lane store pre-stages from Monday — are we back at benchmark?' }
      ]
    },
    {
      id: 'maya',
      name: 'Maya',
      role: 'Service Analyst',
      emoji: '📊',
      tag: 'Live',
      blurb: 'Pulls it all together for Marcus.',
      questions: [
        { slug: 'company-drive-thru-average', bucket: 'descriptive',  text: 'What\'s the company-wide drive-thru average this week?' },
        { slug: 'regions-8-week-trend',       bucket: 'descriptive',  text: 'How did the regions trend over the last 8 weeks?' },
        { slug: 'marcus-drive-thru-up',       bucket: 'diagnostic',   text: 'Why is Marcus\'s drive-thru time up this week?', hero: true },
        { slug: 'execution-or-store-mix',     bucket: 'diagnostic',   text: 'Is Marcus\'s slowdown his execution or his store mix?' },
        { slug: 'monday-digest-lead',         bucket: 'prescriptive', text: 'Which findings should the Monday ops digest lead with?' },
        { slug: 'marcus-first-moves',         bucket: 'prescriptive', text: 'What should Marcus do first, and what can wait?' },
        { slug: 'revenue-at-risk-4-weeks',    bucket: 'predictive',   text: 'What\'s the projected revenue at risk if drive-thru stays at this level for 4 weeks?' },
        { slug: 'marcus-three-prep-stations', bucket: 'predictive',   text: 'What if Marcus gets parallel prep stations at his three hardest-hit stores?' }
      ]
    },
    {
      id: 'sam',
      name: 'Sam',
      role: 'Customer Support',
      emoji: '🎧',
      tag: 'Live',
      blurb: 'Hears the wait-time complaints.',
      questions: [
        { slug: 'wait-complaints-this-week', bucket: 'descriptive',  text: 'How many wait-time complaints did we get this week?' },
        { slug: 'complaints-by-store',       bucket: 'descriptive',  text: 'Which stores are generating the most wait-time complaints?' },
        { slug: 'why-complaints-up',         bucket: 'diagnostic',   text: 'Why are wait-time complaints up this week?', hero: true },
        { slug: 'burger-or-drive-thru',      bucket: 'diagnostic',   text: 'Are customers complaining about the Double Stack or about the drive-thru?' },
        { slug: 'what-to-tell-customers',    bucket: 'prescriptive', text: 'What should my team tell customers who complain about the wait?' },
        { slug: 'escalate-to-ops',           bucket: 'prescriptive', text: 'Which complaints should I escalate to ops first?' },
        { slug: 'staff-for-4-weeks',         bucket: 'predictive',   text: 'What if drive-thru stays this slow for 4 weeks — how many complaints should I staff for?' },
        { slug: 'complaints-after-prestaging', bucket: 'predictive', text: 'What if single-lane stores start pre-staging — when do complaints come back down?' }
      ]
    },
    {
      id: 'lena',
      name: 'Lena',
      role: 'Supply Chain',
      emoji: '📦',
      tag: 'Live',
      blurb: 'Knows what\'s in every kitchen.',
      questions: [
        { slug: 'kitchens-with-prep-station', bucket: 'descriptive',  text: 'Which kitchens have a parallel prep station and which don\'t?' },
        { slug: 'component-stockouts',        bucket: 'descriptive',  text: 'How are Double Stack components holding up — any stockouts since launch?' },
        { slug: 'why-some-kitchens-cope',     bucket: 'diagnostic',   text: 'Why do some single-lane kitchens cope with the Double Stack and others don\'t?', hero: true },
        { slug: 'southeast-sauce-short',      bucket: 'diagnostic',   text: 'Why is the Southeast running short of Stack Sauce?' },
        { slug: 'fastest-retrofit',           bucket: 'prescriptive', text: 'How do I get parallel prep stations into the worst kitchens fastest?' },
        { slug: 'rebalance-stock',            bucket: 'prescriptive', text: 'How should I rebalance Double Stack stock between regions this week?' },
        { slug: 'retrofit-every-single-lane', bucket: 'predictive',   text: 'What if we retrofit every single-lane kitchen — what does it take?' },
        { slug: 'honey-heat-readiness',       bucket: 'predictive',   text: 'What if Honey Heat Chicken launches on June 4 — are the kitchens ready?' }
      ]
    }
  ]
};
