/* =====================================================================
   data/marcus.js — replays for Marcus J. Williams (Franchise Operator)

   Eight questions, each answered twice: "bare" (raw SQL, no context)
   and "context" (with the context layer). The wording of the questions,
   reasoning lines, SQL and answers follows the public McContext demo.

   Format (see docs/EDITING.md):
     { say [, hold: true] }   a reasoning line (hold lingers on it)
     { sql, key, rows, cols } a warehouse query; key is what marks point at
     { persona | term | skill | model [, meta] }   a context-layer load
     answer                   the final message (plain text, line breaks kept)
     marks                    phrases to highlight: { good, from } or { bad }
   ===================================================================== */

// ----------------------------------------------------------------------
// How did my stores perform vs benchmark?
// ----------------------------------------------------------------------
MCX.replay("marcus", "stores-vs-benchmark", {
  bare: {
    steps: [
      { say: "See what operators exist in the raw data — I have no identity context telling me which one is 'me'." },
      { key: "raw_franchise_owners", rows: 9, cols: "OPERATOR_ID, OPERATOR_NAME, REGION", sql: `
          SELECT OPERATOR_ID, OPERATOR_NAME, REGION
          FROM MCCONTEXT_BURGER_DEMO.BRONZE.RAW_FRANCHISE_OWNERS
          ORDER BY OPERATOR_ID` },
      { say: "Pull whatever 'performance' signals exist in the POS table — revenue, transactions, service time — network-wide, since I can't scope to a person." },
      { key: "raw_pos_daily", rows: 3, cols: "MO, REVENUE_USD, TRANSACTIONS, AVG_SERVICE_SECS", sql: `
          SELECT DATE_TRUNC('month', DATE) AS mo,
                 SUM(TOTAL_REVENUE_USD)    AS revenue_usd,
                 SUM(TOTAL_TRANSACTIONS)   AS transactions,
                 ROUND(AVG(AVG_SERVICE_SECS), 1) AS avg_service_secs
          FROM MCCONTEXT_BURGER_DEMO.BRONZE.RAW_POS_DAILY
          WHERE DATE >= '2026-03-01'
          GROUP BY mo ORDER BY mo` },
      { say: "Two raw columns both claim to be “drive-thru time” and they disagree — `RAW_POS_DAILY.avg_service_secs` (order-to-payment) vs `RAW_ORDER_TIMING_DAILY.avg_dt_secs` (gate-to-window). Nothing says which is authoritative — guessing.", hold: true },
      { say: "Honest limit: No identity scope, no performance-metric definition, no benchmark, no seasonal control." }
    ],
    answer: `Happy to pull a performance read. Before I can make it yours, though, a few things I'd need — without them I'm guessing:
• Whose stores are "my"? I see 9 operators in RAW_FRANCHISE_OWNERS and no signed-in identity, so I can't tell which stores are yours. I'd be reporting the whole network.
• What counts as "performance" here? There's no single performance metric in the raw tables. I can show revenue, transaction count, service time, drive-thru seconds, units sold — but I don't know which of those your business actually manages to.
• "Versus benchmark" — which benchmark? There's no benchmark column in the raw warehouse, so I have nothing to compare against. I can't tell you if a number is good, bad, or just normal for this time of year.

Here's the unscoped raw data I can pull: network-wide revenue and transactions are roughly flat month-over-month, and average POS service time ticked up slightly into May. But that's the whole company, against no benchmark, with no seasonal control.

Honest limit: I can hand you a grab-bag of metrics for the entire network, but I can't tell you how your stores are doing, against your benchmark, or whether any movement is meaningful versus seasonal. Tell me which operator you are and what "performance" means to your team, and I'll scope it properly.`,
    marks: [
      { bad: "I can't tell which stores are yours" },
      { bad: "There's no single performance metric in the raw tables" },
      { bad: "There's no benchmark column in the raw warehouse" },
      { bad: "I can't tell you how your stores are doing" }
    ]
  },

  context: {
    steps: [
      { persona: "Marcus J. Williams · 14 Southeast stores", meta: "scope: operator, stores: 14" },
      { say: "Resolved who's asking from the persona — scoped automatically to your 14 Southeast stores. Never had to ask." },
      { term: "operators" },
      { skill: "seasonality-check" },
      { skill: "diagnostic-playbook" },
      { say: "Loaded the drive-thru diagnostic playbook — scope → confirm → rule out seasonality → spread → decompose → correlate → quantify.", hold: true },
      { skill: "ontology" },
      { say: "Walking the playbook against the certified GOLD tables." },
      { say: "Scope to Marcus's store portfolio (operator glossary) and split by lane type." },
      { key: "scope", rows: 2, cols: "LANE_TYPE, N_STORES", sql: `
          SELECT LANE_TYPE, COUNT(DISTINCT STORE_ID) AS n_stores
          FROM MCCONTEXT_BURGER_DEMO.GOLD.ORDER_TIMING_MART
          WHERE OPERATOR_NAME = 'Marcus J. Williams'
          GROUP BY LANE_TYPE` },
      { say: "Compare this May's benchmark compliance to the same window last year — rule out seasonality before calling it a problem." },
      { key: "seasonality", rows: 2, cols: "YR, PCT_WITHIN_BENCHMARK, WINDOW_SECS", sql: `
          SELECT EXTRACT(year FROM DATE) AS yr,
                 ROUND(AVG(PCT_WITHIN_BENCHMARK)*100, 0) AS pct_within_benchmark,
                 ROUND(AVG(AVG_WINDOW_TIME_SECS), 1)     AS window_secs
          FROM MCCONTEXT_BURGER_DEMO.GOLD.ORDER_TIMING_MART
          WHERE OPERATOR_NAME = 'Marcus J. Williams'
            AND DATE BETWEEN DATEADD(year, EXTRACT(year FROM DATE)-2026, '2026-05-01')
                          AND DATEADD(year, EXTRACT(year FROM DATE)-2026, '2026-05-13')
          GROUP BY yr ORDER BY yr` },
      { say: "Decompose by lane type to find where the drop concentrates — single-lane vs dual-lane." },
      { key: "decompose", rows: 4, cols: "LANE_TYPE, PERIOD, WINDOW_SECS, PCT_WITHIN_BENCHMARK", sql: `
          SELECT LANE_TYPE,
                 CASE WHEN DATE < '2026-05-01' THEN 'Apr' ELSE 'May' END AS period,
                 ROUND(AVG(AVG_WINDOW_TIME_SECS), 1)   AS window_secs,
                 ROUND(AVG(PCT_WITHIN_BENCHMARK)*100, 0) AS pct_within_benchmark
          FROM MCCONTEXT_BURGER_DEMO.GOLD.ORDER_TIMING_MART
          WHERE OPERATOR_NAME = 'Marcus J. Williams' AND DATE >= '2026-04-01'
          GROUP BY LANE_TYPE, period ORDER BY LANE_TYPE, period` },
      { say: "Correlate the onset against the menu change log to identify the driver." },
      { key: "correlate", rows: 2, cols: "ITEM_NAME, EVENT_TYPE, EVENT_DATE, REQUIRES_TWO_STEP_PREP, OPS_IMPACT_LEVEL", sql: `
          SELECT ITEM_NAME, EVENT_TYPE, EVENT_DATE, REQUIRES_TWO_STEP_PREP, OPS_IMPACT_LEVEL
          FROM MCCONTEXT_BURGER_DEMO.GOLD.MENU_CHANGE_LOG
          WHERE EVENT_DATE BETWEEN '2026-04-20' AND '2026-05-15'
          ORDER BY EVENT_DATE` }
    ],
    answer: `Your single-lane stores are the problem — and it's structural, not seasonal.

Across your 14 Southeast stores, benchmark compliance is 63% this week, down from 77% the same week last year. That's not a seasonal dip — last May held at 77%, so something genuinely changed.

The drop is concentrated in your 6 single-lane stores:

1. Single-lane window time jumped from 41s (April) to 59s (May) — an 18-second blowout; compliance there fell 81% → 54%.
2. Your 8 dual-lane stores barely moved (window 41s → 44s, compliance 75% → 70%) — they stage prep in parallel, so they absorbed it.
3. Onset matches the May 7 McContext Double Stack launch (two-step prep, high ops impact) — there's even a Southeast ops alert dated May 9.

What to do: pre-stage Double Stack components during pre-rush (10am, 4pm) at your 6 single-lane stores, and flag to Ops that single-lane sites need a parallel prep station before the weekend.`,
    marks: [
      { good: "Your single-lane stores are the problem — and it's structural, not seasonal", from: ["persona", "query:spread", "skill:seasonality-check"] },
      { good: "benchmark compliance is 63% this week, down from 77% the same week last year", from: ["glossary:drive-thru-time", "query:seasonality", "model:ORDER_TIMING_MART"] },
      { good: "Single-lane window time jumped from 41s (April) to 59s (May)", from: ["query:decompose"] },
      { good: "Onset matches the May 7 McContext Double Stack launch", from: ["query:correlate", "model:MENU_CHANGE_LOG"] },
      { good: "pre-stage Double Stack components during pre-rush (10am, 4pm) at your 6 single-lane stores", from: ["skill:voice-and-tone", "skill:diagnostic-playbook"] }
    ]
  }
});

// ----------------------------------------------------------------------
// What was my drive-thru time last week?
// ----------------------------------------------------------------------
MCX.replay("marcus", "drive-thru-last-week", {
  bare: {
    steps: [
      { say: "Find an operator named 'Marcus' in the raw franchise owners table." },
      { key: "raw_franchise_owners", rows: 1, cols: "OPERATOR_ID, OPERATOR_NAME, REGION, YEARS_WITH_BRAND", sql: `
          SELECT OPERATOR_ID, OPERATOR_NAME, REGION, YEARS_WITH_BRAND
          FROM MCCONTEXT_BURGER_DEMO.BRONZE.RAW_FRANCHISE_OWNERS
          WHERE OPERATOR_NAME ILIKE '%Marcus%'` },
      { say: "List the active stores owned by that operator so we can scope the analysis." },
      { key: "raw_stores", rows: 14, cols: "STORE_ID, STORE_NAME, CITY, STATE, LANE_TYPE, OPENED_DATE", sql: `
          SELECT STORE_ID, STORE_NAME, CITY, STATE, LANE_TYPE, OPENED_DATE
          FROM MCCONTEXT_BURGER_DEMO.BRONZE.RAW_STORES
          WHERE OPERATOR_ID = 'OP-SE-01' AND IS_ACTIVE = TRUE
          ORDER BY LANE_TYPE, CITY` },
      { say: "Pull this week's drive-thru timing for Marcus's stores so we can see the change." },
      { key: "raw_order_timing_daily", rows: 14, cols: "STORE_ID, AVG_DT_SECS, AVG_ORDER_SECS, AVG_PREP_SECS, AVG_WINDOW_SECS", sql: `
          SELECT t.STORE_ID, AVG(t.AVG_DT_SECS) AS avg_dt_secs,
                 AVG(t.AVG_ORDER_TIME_SECS) AS avg_order_secs,
                 AVG(t.AVG_PREP_TIME_SECS)  AS avg_prep_secs,
                 AVG(t.AVG_WINDOW_TIME_SECS) AS avg_window_secs
          FROM MCCONTEXT_BURGER_DEMO.BRONZE.RAW_ORDER_TIMING_DAILY t
          JOIN MCCONTEXT_BURGER_DEMO.BRONZE.RAW_STORES s ON t.STORE_ID = s.STORE_ID
          WHERE s.OPERATOR_ID = 'OP-SE-01'
            AND t.DATE >= DATEADD(day, -7, (SELECT MAX(DATE) FROM MCCONTEXT_BURGER_DEMO.BRONZE.RAW_ORDER_TIMING_DAILY))
          GROUP BY t.STORE_ID
          ORDER BY avg_dt_secs DESC` },
      { say: "Two raw columns both claim to be “drive-thru time” and they disagree — `RAW_POS_DAILY.avg_service_secs` (order-to-payment) vs `RAW_ORDER_TIMING_DAILY.avg_dt_secs` (gate-to-window). Nothing says which is authoritative — guessing.", hold: true },
      { say: "Honest limit: Operator scope guessed, not confirmed." }
    ],
    answer: `Happy to help dig in. Before I commit to a full answer, a few things I'd want from you — without them I'm working from raw tables and educated guesses:
• Whose stores are "my"? I see operators in RAW_FRANCHISE_OWNERS — there's a Marcus J. Williams in the Southeast running 14 stores, which I'm assuming for now. Confirm or correct me.
• Which metric counts as drive-thru time for you? I see two candidates in the raw warehouse — RAW_POS_DAILY.AVG_SERVICE_SECS (register-to-payment) and RAW_ORDER_TIMING_DAILY.AVG_DT_SECS (gate-to-window). They tell different stories. Which one does your ops team report on?
• What's the benchmark you're measuring "up" against? No benchmark column in the raw tables — I can compare against a 4-week trailing average, but that's a baseline I'd be inventing.

Here's what I can glean from your question with the raw data:

Assuming you're Marcus's 14 Southeast stores, the past 7 days of AVG_DT_SECS are elevated relative to the prior 4-week window. The spike is concentrated in a subset of stores rather than evenly distributed. There are also a few signals worth checking — a RAW_PROMO_EVENTS table and a RAW_STAFFING_DAILY table — but without a diagnostic methodology I'd just be eyeballing correlations, not attributing cause.

Honest limit: I can describe the elevation. I can't confidently tell you why without the answers above. If you share those — operator scope, canonical metric, your benchmark — I'll re-run this end-to-end and give you the segment, the driver, and the recommended action.`,
    marks: [
      { bad: "which I'm assuming for now" },
      { bad: "Which one does your ops team report on?" },
      { bad: "that's a baseline I'd be inventing" },
      { bad: "I can't confidently tell you why" },
      { good: "the past 7 days of AVG_DT_SECS are elevated relative to the prior 4-week window" }
    ]
  },

  context: {
    steps: [
      { persona: "Marcus J. Williams · 14 Southeast stores", meta: "scope: operator, stores: 14" },
      { say: "Resolved who's asking from the persona — scoped automatically to your 14 Southeast stores. Never had to ask." },
      { term: "drive-thru-time" },
      { say: "Glossary resolves “drive-thru time” to gate-to-window — `ORDER_TIMING_MART.avg_dt_secs`. The POS order-to-payment column is explicitly the wrong one.", hold: true },
      { term: "operators" },
      { skill: "drive-thru-timing" },
      { model: "ORDER_TIMING_MART" },
      { model: "FRANCHISE_STORE_DIM" },
      { say: "Walking the playbook against the certified GOLD tables." },
      { say: "Pull Marcus's portfolio drive-thru time for last week (and prior week for context)." },
      { key: "scope", rows: 2, cols: "WEEK_START, AVG_DT_SECS, BENCHMARK_SECS, PCT_IN_TARGET, DT_TX", sql: `
          SELECT t.week_start,
                 AVG(t.avg_dt_secs) AS avg_dt_secs,
                 AVG(t.benchmark_dt_secs) AS benchmark_secs,
                 AVG(t.pct_within_benchmark) AS pct_in_target,
                 SUM(t.total_dt_transactions) AS dt_tx
          FROM MCCONTEXT_BURGER_DEMO.GOLD.ORDER_TIMING_MART t
          JOIN MCCONTEXT_BURGER_DEMO.GOLD.FRANCHISE_STORE_DIM f USING (STORE_ID)
          WHERE f.operator_name = 'Marcus J. Williams'
            AND t.week_start >= DATEADD(week, -3, DATE_TRUNC('week', CURRENT_DATE))
          GROUP BY t.week_start
          ORDER BY t.week_start` },
      { say: "Confirm what 'last week' looks like — see most recent dates and per-store breakdown for the most recent full week." },
      { key: "confirm", rows: 14, cols: "STORE_NAME, AVG_DT_SECS, BENCHMARK, PCT_IN_TARGET, LAST_DATE", sql: `
          SELECT t.store_name,
                 AVG(t.avg_dt_secs) AS avg_dt_secs,
                 AVG(t.benchmark_dt_secs) AS benchmark,
                 AVG(t.pct_within_benchmark) AS pct_in_target,
                 MAX(t.date) AS last_date
          FROM MCCONTEXT_BURGER_DEMO.GOLD.ORDER_TIMING_MART t
          JOIN MCCONTEXT_BURGER_DEMO.GOLD.FRANCHISE_STORE_DIM f USING (STORE_ID)
          WHERE f.operator_name = 'Marcus J. Williams'
            AND t.week_start = '2026-05-04'
          GROUP BY t.store_name
          ORDER BY avg_dt_secs DESC` }
    ],
    answer: `Thanks for letting us know — here's last week's drive-thru picture across your 14 Southeast stores.

Your portfolio averaged 183 seconds at the drive-thru last week (May 4–10), against a blended benchmark of 176 seconds — about 6 seconds over target. Only 62% of transactions cleared inside benchmark, on ~29,200 drive-thru orders.

The story splits cleanly by lane type:
• Your 6 single-lane stores ran 195 sec vs. a 165 sec target — 30 sec over. Atlanta Peachtree (203), Charlotte Uptown (200), and Nashville Midtown (200) were the worst. Benchmark compliance at these stores is sitting at 48–56%.
• Your 8 dual-lane stores ran 173 sec vs. a 185 sec target — 12 sec inside benchmark, with 70–72% compliance. These stores are healthy.

This is a single-lane problem, not a portfolio problem. If you want, I can run the diagnostic on those 6 stores to figure out why (Double Stack window-time impact is the leading suspect).`,
    marks: [
      { good: "Your portfolio averaged 183 seconds at the drive-thru last week (May 4–10), against a blended benchmark of 176 seconds", from: ["persona", "glossary:drive-thru-time", "query:confirm", "model:ORDER_TIMING_MART"] },
      { good: "Your 6 single-lane stores ran 195 sec vs. a 165 sec target — 30 sec over", from: ["query:scope", "model:FRANCHISE_STORE_DIM"] },
      { good: "Your 8 dual-lane stores ran 173 sec vs. a 185 sec target — 12 sec inside benchmark", from: ["query:scope", "model:FRANCHISE_STORE_DIM"] },
      { good: "This is a single-lane problem, not a portfolio problem", from: ["persona", "query:confirm"] }
    ]
  }
});

// ----------------------------------------------------------------------
// Why is my drive-thru time up this week?
// ----------------------------------------------------------------------
MCX.replay("marcus", "drive-thru-up", {
  bare: {
    steps: [
      { say: "Find an operator named 'Marcus' in the raw franchise owners table." },
      { key: "raw_franchise_owners", rows: 1, cols: "OPERATOR_ID, OPERATOR_NAME, REGION, YEARS_WITH_BRAND", sql: `
          SELECT OPERATOR_ID, OPERATOR_NAME, REGION, YEARS_WITH_BRAND
          FROM MCCONTEXT_BURGER_DEMO.BRONZE.RAW_FRANCHISE_OWNERS
          WHERE OPERATOR_NAME ILIKE '%Marcus%'` },
      { say: "List the active stores owned by that operator so we can scope the analysis." },
      { key: "raw_stores", rows: 14, cols: "STORE_ID, STORE_NAME, CITY, STATE, LANE_TYPE, OPENED_DATE", sql: `
          SELECT STORE_ID, STORE_NAME, CITY, STATE, LANE_TYPE, OPENED_DATE
          FROM MCCONTEXT_BURGER_DEMO.BRONZE.RAW_STORES
          WHERE OPERATOR_ID = 'OP-SE-01' AND IS_ACTIVE = TRUE
          ORDER BY LANE_TYPE, CITY` },
      { say: "Pull this week's drive-thru timing for Marcus's stores so we can see the change." },
      { key: "raw_order_timing_daily", rows: 14, cols: "STORE_ID, AVG_DT_SECS, AVG_ORDER_SECS, AVG_PREP_SECS, AVG_WINDOW_SECS", sql: `
          SELECT t.STORE_ID, AVG(t.AVG_DT_SECS) AS avg_dt_secs,
                 AVG(t.AVG_ORDER_TIME_SECS) AS avg_order_secs,
                 AVG(t.AVG_PREP_TIME_SECS)  AS avg_prep_secs,
                 AVG(t.AVG_WINDOW_TIME_SECS) AS avg_window_secs
          FROM MCCONTEXT_BURGER_DEMO.BRONZE.RAW_ORDER_TIMING_DAILY t
          JOIN MCCONTEXT_BURGER_DEMO.BRONZE.RAW_STORES s ON t.STORE_ID = s.STORE_ID
          WHERE s.OPERATOR_ID = 'OP-SE-01'
            AND t.DATE >= DATEADD(day, -7, (SELECT MAX(DATE) FROM MCCONTEXT_BURGER_DEMO.BRONZE.RAW_ORDER_TIMING_DAILY))
          GROUP BY t.STORE_ID
          ORDER BY avg_dt_secs DESC` },
      { say: "Two raw columns both claim to be “drive-thru time” and they disagree — `RAW_POS_DAILY.avg_service_secs` (order-to-payment) vs `RAW_ORDER_TIMING_DAILY.avg_dt_secs` (gate-to-window). Nothing says which is authoritative — guessing.", hold: true },
      { say: "Honest limit: Operator scope guessed, not confirmed." }
    ],
    answer: `Happy to help dig in. Before I commit to a full answer, a few things I'd want from you — without them I'm working from raw tables and educated guesses:
• Whose stores are "my"? I see operators in RAW_FRANCHISE_OWNERS — there's a Marcus J. Williams in the Southeast running 14 stores, which I'm assuming for now. Confirm or correct me.
• Which metric counts as drive-thru time for you? I see two candidates in the raw warehouse — RAW_POS_DAILY.AVG_SERVICE_SECS (register-to-payment) and RAW_ORDER_TIMING_DAILY.AVG_DT_SECS (gate-to-window). They tell different stories. Which one does your ops team report on?
• What's the benchmark you're measuring "up" against? No benchmark column in the raw tables — I can compare against a 4-week trailing average, but that's a baseline I'd be inventing.

Here's what I can glean from your question with the raw data:

Assuming you're Marcus's 14 Southeast stores, the past 7 days of AVG_DT_SECS are elevated relative to the prior 4-week window. The spike is concentrated in a subset of stores rather than evenly distributed. There are also a few signals worth checking — a RAW_PROMO_EVENTS table and a RAW_STAFFING_DAILY table — but without a diagnostic methodology I'd just be eyeballing correlations, not attributing cause.

Honest limit: I can describe the elevation. I can't confidently tell you why without the answers above. If you share those — operator scope, canonical metric, your benchmark — I'll re-run this end-to-end and give you the segment, the driver, and the recommended action.`,
    marks: [
      { bad: "which I'm assuming for now" },
      { bad: "Which one does your ops team report on?" },
      { bad: "that's a baseline I'd be inventing" },
      { bad: "I can't confidently tell you why" },
      { good: "the past 7 days of AVG_DT_SECS are elevated relative to the prior 4-week window" }
    ]
  },

  context: {
    steps: [
      { persona: "Marcus J. Williams · 14 Southeast stores", meta: "scope: operator, stores: 14" },
      { say: "Resolved who's asking from the persona — scoped automatically to your 14 Southeast stores. Never had to ask." },
      { term: "drive-thru-time" },
      { say: "Glossary resolves “drive-thru time” to gate-to-window — `ORDER_TIMING_MART.avg_dt_secs`. The POS order-to-payment column is explicitly the wrong one.", hold: true },
      { term: "combo-revenue" },
      { term: "operators" },
      { skill: "diagnostic-playbook" },
      { say: "Loaded the drive-thru diagnostic playbook — scope → confirm → rule out seasonality → spread → decompose → correlate → quantify.", hold: true },
      { skill: "seasonality-check" },
      { skill: "what-if-analysis" },
      { skill: "drive-thru-timing" },
      { model: "ORDER_TIMING_MART" },
      { model: "FRANCHISE_STORE_DIM" },
      { model: "MENU_CHANGE_LOG" },
      { model: "DAILY_SALES_FACT" },
      { say: "Walking the playbook against the certified GOLD tables." },
      { say: "Confirm the metric actually moved — pull 8-week drive-thru trend for Marcus's portfolio" },
      { key: "confirm", rows: 9, cols: "WEEK_START, AVG_DT_SECS, PCT_IN_TARGET, SECS_VS_BENCH", sql: `
          SELECT t.week_start,
                 AVG(t.avg_dt_secs) AS avg_dt_secs,
                 AVG(t.pct_within_benchmark) AS pct_in_target,
                 AVG(t.secs_vs_benchmark) AS secs_vs_bench
          FROM MCCONTEXT_BURGER_DEMO.GOLD.ORDER_TIMING_MART t
          JOIN MCCONTEXT_BURGER_DEMO.GOLD.FRANCHISE_STORE_DIM f USING (STORE_ID)
          WHERE f.operator_name = 'Marcus J. Williams'
            AND t.week_start >= DATEADD(week, -8, (SELECT MAX(week_start) FROM MCCONTEXT_BURGER_DEMO.GOLD.ORDER_TIMING_MART))
          GROUP BY t.week_start
          ORDER BY t.week_start` },
      { say: "Find the latest data date available so we know what 'this week' means" },
      { key: "scope", rows: 1, cols: "MAX_DATE, MAX_WEEK", sql: `
          SELECT MAX(date) AS max_date, MAX(week_start) AS max_week FROM MCCONTEXT_BURGER_DEMO.GOLD.ORDER_TIMING_MART` },
      { say: "Classify spread — which of Marcus's stores are above benchmark this week, and by lane type" },
      { key: "spread", rows: 14, cols: "STORE_NAME, LANE_TYPE, HAS_PARALLEL_STAGING, AVG_DT, BENCH, SECS_OVER, PCT_IN", sql: `
          SELECT f.store_name, f.lane_type, f.has_parallel_staging,
                 AVG(t.avg_dt_secs) AS avg_dt,
                 AVG(t.benchmark_dt_secs) AS bench,
                 AVG(t.secs_vs_benchmark) AS secs_over,
                 AVG(t.pct_within_benchmark) AS pct_in
          FROM MCCONTEXT_BURGER_DEMO.GOLD.ORDER_TIMING_MART t
          JOIN MCCONTEXT_BURGER_DEMO.GOLD.FRANCHISE_STORE_DIM f USING (STORE_ID)
          WHERE f.operator_name = 'Marcus J. Williams'
            AND t.week_start = '2026-05-11'
          GROUP BY f.store_name, f.lane_type, f.has_parallel_staging
          ORDER BY secs_over DESC` },
      { say: "Decompose drive-thru time into order/prep/window segments, pre vs post May 7" },
      { key: "decompose", rows: 4, cols: "PERIOD, LANE_TYPE, ORDER_S, PREP_S, WINDOW_S, TOTAL_DT", sql: `
          SELECT CASE WHEN t.date < '2026-05-07' THEN 'pre_may7' ELSE 'post_may7' END AS period,
                 f.lane_type,
                 AVG(t.avg_order_time_secs) AS order_s,
                 AVG(t.avg_prep_time_secs) AS prep_s,
                 AVG(t.avg_window_time_secs) AS window_s,
                 AVG(t.avg_dt_secs) AS total_dt
          FROM MCCONTEXT_BURGER_DEMO.GOLD.ORDER_TIMING_MART t
          JOIN MCCONTEXT_BURGER_DEMO.GOLD.FRANCHISE_STORE_DIM f USING (STORE_ID)
          WHERE f.operator_name = 'Marcus J. Williams'
            AND t.date BETWEEN '2026-04-20' AND '2026-05-13'
          GROUP BY period, f.lane_type
          ORDER BY f.lane_type, period` },
      { say: "Check menu changes around May 7 that could explain the spike" },
      { key: "correlate", rows: 2, cols: "EVENT_DATE, EVENT_TYPE, ITEM_NAME, SKU_ID, OPS_IMPACT_LEVEL, REQUIRES_TWO_STEP_PREP, AFFECTED_REGIONS, NOTES", sql: `
          SELECT event_date, event_type, item_name, sku_id, ops_impact_level, requires_two_step_prep, affected_regions, notes
          FROM MCCONTEXT_BURGER_DEMO.GOLD.MENU_CHANGE_LOG
          WHERE event_date BETWEEN '2026-04-15' AND '2026-05-13'
          ORDER BY event_date` },
      { say: "Rule out weather — check precipitation across Marcus's market areas for the week" },
      { key: "seasonality", rows: 9, cols: "DATE, RAIN_IN, TEMP_F, WEATHER_CONDITION", sql: `
          SELECT t.date, AVG(t.precipitation_in) AS rain_in, AVG(t.avg_temp_f) AS temp_f, t.weather_condition
          FROM MCCONTEXT_BURGER_DEMO.GOLD.ORDER_TIMING_MART t
          JOIN MCCONTEXT_BURGER_DEMO.GOLD.FRANCHISE_STORE_DIM f USING (STORE_ID)
          WHERE f.operator_name = 'Marcus J. Williams'
            AND t.date BETWEEN '2026-05-11' AND '2026-05-13'
          GROUP BY t.date, t.weather_condition
          ORDER BY t.date` },
      { say: "Quantify the revenue at risk — drive-thru volume and ticket size at affected single-lane stores" },
      { key: "quantify", rows: 2, cols: "LANE_TYPE, STORES, AVG_DAILY_TX, AVG_TICKET, AVG_DT_TX", sql: `
          SELECT f.lane_type,
                 COUNT(DISTINCT f.store_id) AS stores,
                 AVG(d.total_transactions) AS avg_daily_tx,
                 AVG(d.avg_ticket_usd) AS avg_ticket,
                 AVG(t.total_dt_transactions) AS avg_dt_tx
          FROM MCCONTEXT_BURGER_DEMO.GOLD.DAILY_SALES_FACT d
          JOIN MCCONTEXT_BURGER_DEMO.GOLD.FRANCHISE_STORE_DIM f USING (STORE_ID)
          JOIN MCCONTEXT_BURGER_DEMO.GOLD.ORDER_TIMING_MART t ON t.store_id = d.store_id AND t.date = d.date
          WHERE f.operator_name = 'Marcus J. Williams'
            AND d.date BETWEEN '2026-05-11' AND '2026-05-13'
          GROUP BY f.lane_type` },
      { skill: "voice-and-tone", meta: "purpose: voice" }
    ],
    answer: `Thanks for letting us know — here's what's going on.

The Double Stack launch on May 7 is hammering your 6 single-lane stores. Drive-thru time across your portfolio jumped from ~168 sec (steady April baseline) to 187 sec this week — but the damage is entirely concentrated on the single-lane side, where average drive-thru time is now 213 sec vs a 165 sec benchmark (+47 sec over). Your 8 dual-lane stores (all with parallel staging) are still comfortably under benchmark at 172 sec. This isn't seasonality and it isn't weather — Sun/Mon were dry across your markets, and the spike begins precisely on the May 7 launch date.

The bottleneck is window time, exactly the failure mode the corporate ops alert flagged on May 9: single-lane window time went from 41 sec pre-launch to 74 sec post-launch (+33 sec), with prep adding another ~13 sec. The two-step beef-stack + sauce-layer prep has nowhere to land on a single lane without parallel staging.

At ~274 drive-thru transactions/day and a $7.65 ticket, every 30 sec over benchmark costs roughly 8% of peak transactions — that's ~$11k–$14k/week of revenue at risk across the six single-lane stores, with Atlanta Buckhead (+51 sec), Charlotte Uptown (+47 sec) and Atlanta Peachtree (+45 sec) the worst offenders.`,
    marks: [
      { good: "The Double Stack launch on May 7 is hammering your 6 single-lane stores", from: ["query:correlate", "query:spread", "model:MENU_CHANGE_LOG", "persona"] },
      { good: "213 sec vs a 165 sec benchmark (+47 sec over)", from: ["query:spread", "glossary:drive-thru-time", "model:ORDER_TIMING_MART"] },
      { good: "Your 8 dual-lane stores (all with parallel staging) are still comfortably under benchmark at 172 sec", from: ["query:spread", "model:FRANCHISE_STORE_DIM"] },
      { good: "This isn't seasonality and it isn't weather", from: ["query:seasonality", "skill:seasonality-check"] },
      { good: "The bottleneck is window time", from: ["query:decompose", "model:ORDER_TIMING_MART"] },
      { good: "41 sec pre-launch to 74 sec post-launch (+33 sec)", from: ["query:decompose"] },
      { good: "$11k–$14k/week of revenue at risk across the six single-lane stores", from: ["query:quantify", "skill:voice-and-tone", "model:DAILY_SALES_FACT"] }
    ]
  }
});

// ----------------------------------------------------------------------
// Why did my combo revenue dip after May 7?
// ----------------------------------------------------------------------
MCX.replay("marcus", "combo-revenue-dip", {
  bare: {
    steps: [
      { say: "Pull Southeast region combo revenue weekly, both gross and net, around the May 7 launch." },
      { key: "raw_combo_revenue_daily", rows: 5, cols: "WK, GROSS_REV, NET_REV, UNITS", sql: `
          SELECT DATE_TRUNC('week', DATE) AS wk,
                 SUM(GROSS_REVENUE_USD) AS gross_rev,
                 SUM(NET_REVENUE_USD)   AS net_rev,
                 SUM(TOTAL_UNITS)       AS units
          FROM MCCONTEXT_BURGER_DEMO.BRONZE.RAW_COMBO_REVENUE_DAILY
          WHERE REGION = 'Southeast'
            AND DATE BETWEEN '2026-04-15' AND '2026-05-20'
          GROUP BY wk ORDER BY wk` },
      { say: "Two raw columns both read as “combo revenue” — gross vs net of discounts — and no definition tells me which one finance means. Picking one blind.", hold: true },
      { say: "Break down combo revenue by item since May 7 — see which SKUs the dip concentrates in." },
      { key: "raw_combo_revenue_daily", rows: 8, cols: "ITEM_NAME, IS_LTO, LAUNCH_DATE, NET_REV, UNITS", sql: `
          SELECT m.ITEM_NAME, m.IS_LTO, m.LAUNCH_DATE,
                 SUM(c.NET_REVENUE_USD) AS net_rev,
                 SUM(c.TOTAL_UNITS)     AS units
          FROM MCCONTEXT_BURGER_DEMO.BRONZE.RAW_COMBO_REVENUE_DAILY c
          JOIN MCCONTEXT_BURGER_DEMO.BRONZE.RAW_MENU_ITEMS m ON m.SKU_ID = c.SKU_ID
          WHERE c.REGION = 'Southeast'
            AND c.DATE BETWEEN '2026-05-07' AND '2026-05-20'
          GROUP BY m.ITEM_NAME, m.IS_LTO, m.LAUNCH_DATE
          ORDER BY net_rev DESC` },
      { say: "Honest limit: Two raw revenue columns plausibly mean 'combo revenue' and they disagree." }
    ],
    answer: `Happy to help dig in. Before I commit to a confident answer, a few things would change my interpretation a lot:
• Which 'combo revenue' do you mean? I see two columns in the raw table: GROSS_REVENUE_USD and NET_REVENUE_USD. For the past three weeks, gross is up ~5% but net is down ~8%. They tell opposite stories. Which one is your reporting truth — finance (net of discounts) or marketing (gross on combo SKUs)?
• Which stores are 'my'? The combo revenue table doesn't have a STORE_ID column — granularity is SKU × region × day. I rolled up to the Southeast region as a proxy, but that spans more than just your 14 stores. Want me to do that, or do you have a way to filter to your stores?
• Are you asking about the dip itself or about the Double Stack? I can see from RAW_PROMO_EVENTS that the Double Stack launched May 7. It looks like customers may have substituted toward it from other combos — but I'd need the Double Stack's revenue treatment (counted as combo or non-combo?) to attribute properly.

Here's what the raw data shows:

Southeast combo gross revenue is steady to slightly up since May 7; net is down ~8% over the same window because of a heavier discount footprint (likely the Double Stack's launch promotion). Volume on the Double Stack SKU is large enough that it's plausibly cannibalising other combos.

Honest limit: the metric you call 'combo revenue dip' could be real (net) or imaginary (gross), and even if it's real I can't cleanly attribute to the Double Stack vs broader factors without a store-level join and a clear definition. Tell me which metric and how the Double Stack is supposed to be classified, and I'll give you a definitive answer.`,
    marks: [
      { bad: "gross is up ~5% but net is down ~8%. They tell opposite stories" },
      { bad: "Which one is your reporting truth — finance (net of discounts) or marketing (gross on combo SKUs)?" },
      { bad: "I rolled up to the Southeast region as a proxy" },
      { bad: "the metric you call 'combo revenue dip' could be real (net) or imaginary (gross)" }
    ]
  },

  context: {
    steps: [
      { persona: "Marcus J. Williams · 14 Southeast stores", meta: "scope: operator, stores: 14" },
      { say: "Resolved who's asking from the persona — scoped automatically to your 14 Southeast stores. Never had to ask." },
      { term: "combo-revenue" },
      { say: "Glossary resolves “combo revenue” to net-of-discount — `COMBO_REVENUE_DAILY.net_rev`, not gross. One authoritative definition.", hold: true },
      { term: "operators" },
      { skill: "diagnostic-playbook" },
      { say: "Loaded the drive-thru diagnostic playbook — scope → confirm → rule out seasonality → spread → decompose → correlate → quantify.", hold: true },
      { skill: "seasonality-check" },
      { model: "COMBO_REVENUE_DAILY" },
      { model: "DAILY_SALES_FACT" },
      { say: "Walking the playbook against the certified GOLD tables." },
      { say: "Confirm combo revenue actually dipped after May 7 for Marcus's stores by comparing pre/post weekly net revenue from combo SKUs." },
      { key: "confirm", rows: 10, cols: "WK, COMBO_TX, TOTAL_REV, COMBO_ATTACH, DS_TX", sql: `
          SELECT DATE_TRUNC('week', f.DATE) AS wk,
                 SUM(f.COMBO_TRANSACTIONS) AS combo_tx,
                 SUM(f.TOTAL_REVENUE_USD) AS total_rev,
                 AVG(f.COMBO_ATTACH_RATE) AS combo_attach,
                 SUM(f.DOUBLE_STACK_TRANSACTIONS) AS ds_tx
          FROM MCCONTEXT_BURGER_DEMO.GOLD.DAILY_SALES_FACT f
          WHERE f.OPERATOR_NAME = 'Marcus J. Williams'
            AND f.DATE BETWEEN '2026-03-15' AND '2026-06-30'
          GROUP BY wk
          ORDER BY wk` },
      { say: "Pull combo revenue (gross and net) for Marcus's region (Southeast) pre/post May 7 from the item-level table to see whether combos specifically dipped." },
      { key: "confirm", rows: 10, cols: "WK, GROSS_REV, NET_REV, DISCOUNT_USD, UNITS", sql: `
          SELECT DATE_TRUNC('week', c.DATE) AS wk,
                 SUM(c.GROSS_REV) AS gross_rev,
                 SUM(c.NET_REV) AS net_rev,
                 SUM(c.DISCOUNT_AMOUNT_USD) AS discount_usd,
                 SUM(c.TOTAL_UNITS) AS units
          FROM MCCONTEXT_BURGER_DEMO.GOLD.COMBO_REVENUE_DAILY c
          WHERE c.REGION = 'Southeast'
            AND c.CATEGORY = 'Combo'
            AND c.DATE BETWEEN '2026-03-15' AND '2026-06-30'
          GROUP BY wk
          ORDER BY wk` },
      { say: "Check date coverage — looks like data ends mid-May 2026. Confirm max date so we know the post-period is partial, not a real dip." },
      { key: "scope", rows: 1, cols: "MAX_DATE, MIN_DATE, DISTINCT_DAYS", sql: `
          SELECT MAX(DATE) AS max_date, MIN(DATE) AS min_date, COUNT(DISTINCT DATE) AS distinct_days
          FROM MCCONTEXT_BURGER_DEMO.GOLD.COMBO_REVENUE_DAILY
          WHERE REGION = 'Southeast' AND DATE >= '2026-05-01'` },
      { say: "Daily combo revenue and combo transactions around May 7 launch — see whether daily volumes shifted or it's just a truncated week." },
      { key: "confirm", rows: 24, cols: "DATE, COMBO_TX, NONCOMBO_TX, DS_TX, COMBO_ATTACH, TOTAL_REV", sql: `
          SELECT f.DATE,
                 SUM(f.COMBO_TRANSACTIONS) AS combo_tx,
                 SUM(f.NON_COMBO_TRANSACTIONS) AS noncombo_tx,
                 SUM(f.DOUBLE_STACK_TRANSACTIONS) AS ds_tx,
                 AVG(f.COMBO_ATTACH_RATE) AS combo_attach,
                 SUM(f.TOTAL_REVENUE_USD) AS total_rev
          FROM MCCONTEXT_BURGER_DEMO.GOLD.DAILY_SALES_FACT f
          WHERE f.OPERATOR_NAME = 'Marcus J. Williams'
            AND f.DATE BETWEEN '2026-04-20' AND '2026-05-31'
          GROUP BY f.DATE
          ORDER BY f.DATE` },
      { say: "Compare combo revenue per day pre vs post May 7 at item-level — is combo gross/net revenue actually lower per day, or stable? Check whether Double Stack is cannibalizing other combos." },
      { key: "decompose", rows: 12, cols: "PERIOD, ITEM_NAME, DAYS, GROSS_PER_DAY, NET_PER_DAY, UNITS_PER_DAY, DISC_RATE", sql: `
          SELECT CASE WHEN DATE < '2026-05-07' THEN 'pre' ELSE 'post' END AS period,
                 ITEM_NAME,
                 COUNT(DISTINCT DATE) AS days,
                 SUM(GROSS_REV)/COUNT(DISTINCT DATE) AS gross_per_day,
                 SUM(NET_REV)/COUNT(DISTINCT DATE) AS net_per_day,
                 SUM(TOTAL_UNITS)/COUNT(DISTINCT DATE) AS units_per_day,
                 AVG(DISCOUNT_RATE) AS disc_rate
          FROM MCCONTEXT_BURGER_DEMO.GOLD.COMBO_REVENUE_DAILY
          WHERE REGION = 'Southeast'
            AND CATEGORY = 'Combo'
            AND DATE BETWEEN '2026-04-07' AND '2026-05-13'
          GROUP BY period, ITEM_NAME
          ORDER BY ITEM_NAME, period` },
      { say: "Check Double Stack revenue in the post period — is it net additive or just a discount-heavy LTO eroding net combo revenue?" },
      { key: "correlate", rows: 8, cols: "ITEM_NAME, IS_LTO, CATEGORY, GROSS, NET, DISC, DISC_RATE, UNITS", sql: `
          SELECT ITEM_NAME, IS_LTO, CATEGORY,
                 SUM(GROSS_REV) AS gross,
                 SUM(NET_REV) AS net,
                 SUM(DISCOUNT_AMOUNT_USD) AS disc,
                 AVG(DISCOUNT_RATE) AS disc_rate,
                 SUM(TOTAL_UNITS) AS units
          FROM MCCONTEXT_BURGER_DEMO.GOLD.COMBO_REVENUE_DAILY
          WHERE REGION = 'Southeast'
            AND DATE BETWEEN '2026-05-07' AND '2026-05-13'
          GROUP BY ITEM_NAME, IS_LTO, CATEGORY
          ORDER BY net DESC
          LIMIT 20` },
      { say: "Same-week historical check — does May 7-13 typically run lower than late April? Pull last year's May data for Southeast combos. (Seasonality rule-out.)" },
      { key: "seasonality", rows: 13, cols: "YR, MO, NET_PER_DAY, UNITS_PER_DAY", sql: `
          SELECT EXTRACT(year FROM DATE) AS yr,
                 EXTRACT(month FROM DATE) AS mo,
                 SUM(NET_REV)/COUNT(DISTINCT DATE) AS net_per_day,
                 SUM(TOTAL_UNITS)/COUNT(DISTINCT DATE) AS units_per_day
          FROM MCCONTEXT_BURGER_DEMO.GOLD.COMBO_REVENUE_DAILY
          WHERE REGION = 'Southeast' AND CATEGORY = 'Combo'
          GROUP BY yr, mo
          ORDER BY yr, mo` }
    ],
    answer: `Thanks for letting us know — and good news: your combo revenue did not actually dip after May 7. The "dip" in the weekly view is a reporting artifact (the most recent week is only partial — data ends May 13), not a real drop. On a per-day basis, every one of your six core combos is flat-to-up since the Double Stack launched.

Here's what the daily numbers actually show for your Southeast portfolio:
• Pre-launch (Apr 7–May 6) net combo revenue: ~$22,560/day
• Post-launch (May 7–13) net combo revenue: ~$22,770/day — essentially flat (+1%)
• Plus the Double Stack itself added ~$1,640/day in net LTO revenue on top of that

So total combo-category revenue is actually up ~$1,850/day (~8%) since May 7. The only combo that softened was the Family Bundle (−5% per day, ~$380/day) — a plausible small cannibalization signal, but well inside normal week-to-week noise. Everything else (Classic, Chicken, Spicy Stack, BBQ Ranch, Value) is up 2–7%.

Bottom line: the dip you're seeing is the partial-week truncation in the May 11 week (only 3 days of data). Once the full week loads you should see combo revenue at or above April levels, plus a clean lift from the Double Stack.`,
    marks: [
      { good: "your combo revenue did not actually dip after May 7", from: ["query:confirm", "glossary:combo-revenue"] },
      { good: "the dip you're seeing is the partial-week truncation in the May 11 week (only 3 days of data)", from: ["query:confirm", "query:seasonality"] },
      { good: "total combo-category revenue is actually up ~$1,850/day (~8%) since May 7", from: ["query:decompose", "glossary:combo-revenue"] },
      { good: "the Double Stack itself added ~$1,640/day in net LTO revenue", from: ["query:correlate", "query:decompose"] },
      { good: "The only combo that softened was the Family Bundle", from: ["query:decompose"] }
    ]
  }
});

// ----------------------------------------------------------------------
// How do I bring my drive-thru back to benchmark by Friday?
// ----------------------------------------------------------------------
MCX.replay("marcus", "drive-thru-to-benchmark", {
  bare: {
    steps: [
      { say: "Find an operator named 'Marcus' in the raw franchise owners table." },
      { key: "raw_franchise_owners", rows: 1, cols: "OPERATOR_ID, OPERATOR_NAME, REGION, YEARS_WITH_BRAND", sql: `
          SELECT OPERATOR_ID, OPERATOR_NAME, REGION, YEARS_WITH_BRAND
          FROM MCCONTEXT_BURGER_DEMO.BRONZE.RAW_FRANCHISE_OWNERS
          WHERE OPERATOR_NAME ILIKE '%Marcus%'` },
      { say: "List the active stores owned by that operator so we can scope the analysis." },
      { key: "raw_stores", rows: 14, cols: "STORE_ID, STORE_NAME, CITY, STATE, LANE_TYPE, OPENED_DATE", sql: `
          SELECT STORE_ID, STORE_NAME, CITY, STATE, LANE_TYPE, OPENED_DATE
          FROM MCCONTEXT_BURGER_DEMO.BRONZE.RAW_STORES
          WHERE OPERATOR_ID = 'OP-SE-01' AND IS_ACTIVE = TRUE
          ORDER BY LANE_TYPE, CITY` },
      { say: "Pull this week's drive-thru timing for Marcus's stores so we can see the change." },
      { key: "raw_order_timing_daily", rows: 14, cols: "STORE_ID, AVG_DT_SECS, AVG_ORDER_SECS, AVG_PREP_SECS, AVG_WINDOW_SECS", sql: `
          SELECT t.STORE_ID, AVG(t.AVG_DT_SECS) AS avg_dt_secs,
                 AVG(t.AVG_ORDER_TIME_SECS) AS avg_order_secs,
                 AVG(t.AVG_PREP_TIME_SECS)  AS avg_prep_secs,
                 AVG(t.AVG_WINDOW_TIME_SECS) AS avg_window_secs
          FROM MCCONTEXT_BURGER_DEMO.BRONZE.RAW_ORDER_TIMING_DAILY t
          JOIN MCCONTEXT_BURGER_DEMO.BRONZE.RAW_STORES s ON t.STORE_ID = s.STORE_ID
          WHERE s.OPERATOR_ID = 'OP-SE-01'
            AND t.DATE >= DATEADD(day, -7, (SELECT MAX(DATE) FROM MCCONTEXT_BURGER_DEMO.BRONZE.RAW_ORDER_TIMING_DAILY))
          GROUP BY t.STORE_ID
          ORDER BY avg_dt_secs DESC` },
      { say: "Two raw columns both claim to be “drive-thru time” and they disagree — `RAW_POS_DAILY.avg_service_secs` (order-to-payment) vs `RAW_ORDER_TIMING_DAILY.avg_dt_secs` (gate-to-window). Nothing says which is authoritative — guessing.", hold: true },
      { say: "Honest limit: Operator scope guessed, not confirmed." }
    ],
    answer: `Happy to help dig in. Before I commit to a full answer, a few things I'd want from you — without them I'm working from raw tables and educated guesses:
• Whose stores are "my"? I see operators in RAW_FRANCHISE_OWNERS — there's a Marcus J. Williams in the Southeast running 14 stores, which I'm assuming for now. Confirm or correct me.
• Which metric counts as drive-thru time for you? I see two candidates in the raw warehouse — RAW_POS_DAILY.AVG_SERVICE_SECS (register-to-payment) and RAW_ORDER_TIMING_DAILY.AVG_DT_SECS (gate-to-window). They tell different stories. Which one does your ops team report on?
• What's the benchmark you're measuring "up" against? No benchmark column in the raw tables — I can compare against a 4-week trailing average, but that's a baseline I'd be inventing.

Here's what I can glean from your question with the raw data:

Assuming you're Marcus's 14 Southeast stores, the past 7 days of AVG_DT_SECS are elevated relative to the prior 4-week window. The spike is concentrated in a subset of stores rather than evenly distributed. There are also a few signals worth checking — a RAW_PROMO_EVENTS table and a RAW_STAFFING_DAILY table — but without a diagnostic methodology I'd just be eyeballing correlations, not attributing cause.

Honest limit: I can describe the elevation. I can't confidently tell you why without the answers above. If you share those — operator scope, canonical metric, your benchmark — I'll re-run this end-to-end and give you the segment, the driver, and the recommended action.`,
    marks: [
      { bad: "which I'm assuming for now" },
      { bad: "Which one does your ops team report on?" },
      { bad: "that's a baseline I'd be inventing" },
      { bad: "I can't confidently tell you why" },
      { good: "the past 7 days of AVG_DT_SECS are elevated relative to the prior 4-week window" }
    ]
  },

  context: {
    steps: [
      { persona: "Marcus J. Williams · 14 Southeast stores", meta: "scope: operator, stores: 14" },
      { say: "Resolved who's asking from the persona — scoped automatically to your 14 Southeast stores. Never had to ask." },
      { term: "drive-thru-time" },
      { say: "Glossary resolves “drive-thru time” to gate-to-window — `ORDER_TIMING_MART.avg_dt_secs`. The POS order-to-payment column is explicitly the wrong one.", hold: true },
      { term: "combo-revenue" },
      { term: "operators" },
      { skill: "diagnostic-playbook" },
      { say: "Loaded the drive-thru diagnostic playbook — scope → confirm → rule out seasonality → spread → decompose → correlate → quantify.", hold: true },
      { skill: "seasonality-check" },
      { skill: "what-if-analysis" },
      { skill: "drive-thru-timing" },
      { model: "ORDER_TIMING_MART" },
      { model: "FRANCHISE_STORE_DIM" },
      { model: "MENU_CHANGE_LOG" },
      { model: "DAILY_SALES_FACT" },
      { say: "Walking the playbook against the certified GOLD tables." },
      { say: "Confirm Marcus's current drive-thru position vs benchmark this week and identify which stores are above benchmark." },
      { key: "scope", rows: 14, cols: "STORE_ID, STORE_NAME, LANE_TYPE, HAS_PARALLEL_STAGING, AVG_DT_SECS, BENCHMARK, SECS_OVER, PCT_IN_TARGET, DT_TX", sql: `
          SELECT f.store_id, f.store_name, f.lane_type, f.has_parallel_staging,
                 AVG(t.avg_dt_secs) AS avg_dt_secs,
                 AVG(t.benchmark_dt_secs) AS benchmark,
                 AVG(t.secs_vs_benchmark) AS secs_over,
                 AVG(t.pct_within_benchmark) AS pct_in_target,
                 SUM(t.total_dt_transactions) AS dt_tx
          FROM MCCONTEXT_BURGER_DEMO.GOLD.ORDER_TIMING_MART t
          JOIN MCCONTEXT_BURGER_DEMO.GOLD.FRANCHISE_STORE_DIM f USING (STORE_ID)
          WHERE f.operator_name = 'Marcus J. Williams'
            AND t.week_start = (SELECT MAX(week_start) FROM MCCONTEXT_BURGER_DEMO.GOLD.ORDER_TIMING_MART)
          GROUP BY f.store_id, f.store_name, f.lane_type, f.has_parallel_staging
          ORDER BY secs_over DESC` },
      { say: "Pull 8-week trend to confirm the drive-thru elevation is real and not a one-week blip." },
      { key: "confirm", rows: 9, cols: "WEEK_START, AVG_DT_SECS, SECS_OVER, PCT_IN_TARGET, STORES_ABOVE", sql: `
          SELECT t.week_start,
                 AVG(t.avg_dt_secs) AS avg_dt_secs,
                 AVG(t.secs_vs_benchmark) AS secs_over,
                 AVG(t.pct_within_benchmark) AS pct_in_target,
                 COUNT(DISTINCT CASE WHEN t.is_above_benchmark THEN t.store_id END) AS stores_above
          FROM MCCONTEXT_BURGER_DEMO.GOLD.ORDER_TIMING_MART t
          JOIN MCCONTEXT_BURGER_DEMO.GOLD.FRANCHISE_STORE_DIM f USING (STORE_ID)
          WHERE f.operator_name = 'Marcus J. Williams'
            AND t.week_start >= DATEADD(week, -8, (SELECT MAX(week_start) FROM MCCONTEXT_BURGER_DEMO.GOLD.ORDER_TIMING_MART))
          GROUP BY t.week_start
          ORDER BY t.week_start` },
      { say: "Decompose drive-thru time into order/prep/window segments pre vs post Double Stack launch (May 7) for the 6 single-lane stores to identify the bottleneck." },
      { key: "decompose", rows: 4, cols: "LANE_TYPE, PERIOD, ORDER_S, PREP_S, WINDOW_S, TOTAL_DT", sql: `
          SELECT f.lane_type,
                 CASE WHEN t.date < '2026-05-07' THEN 'pre' ELSE 'post' END AS period,
                 AVG(t.avg_order_time_secs) AS order_s,
                 AVG(t.avg_prep_time_secs) AS prep_s,
                 AVG(t.avg_window_time_secs) AS window_s,
                 AVG(t.avg_dt_secs) AS total_dt
          FROM MCCONTEXT_BURGER_DEMO.GOLD.ORDER_TIMING_MART t
          JOIN MCCONTEXT_BURGER_DEMO.GOLD.FRANCHISE_STORE_DIM f USING (STORE_ID)
          WHERE f.operator_name = 'Marcus J. Williams'
            AND t.date >= DATEADD(day, -28, (SELECT MAX(date) FROM MCCONTEXT_BURGER_DEMO.GOLD.ORDER_TIMING_MART))
          GROUP BY f.lane_type, period
          ORDER BY f.lane_type, period` },
      { say: "Rule out weather and check menu events near the inflection date." },
      { key: "correlate", rows: 2, cols: "EVENT_DATE, EVENT_TYPE, ITEM_NAME, OPS_IMPACT_LEVEL, REQUIRES_TWO_STEP_PREP, AFFECTED_REGIONS, NOTES", sql: `
          SELECT event_date, event_type, item_name, ops_impact_level, requires_two_step_prep, affected_regions, notes
          FROM MCCONTEXT_BURGER_DEMO.GOLD.MENU_CHANGE_LOG
          WHERE event_date BETWEEN '2026-04-15' AND '2026-05-15'
          ORDER BY event_date` },
      { say: "Check Double Stack mix share at single-lane vs dual-lane stores to size the impact." },
      { key: "correlate", rows: 2, cols: "LANE_TYPE, DS_TX, TOTAL_TX, DS_SHARE, REVENUE, AVG_TICKET", sql: `
          SELECT f.lane_type,
                 SUM(s.double_stack_transactions) AS ds_tx,
                 SUM(s.total_transactions) AS total_tx,
                 SUM(s.double_stack_transactions)::FLOAT / NULLIF(SUM(s.total_transactions),0) AS ds_share,
                 SUM(s.total_revenue_usd) AS revenue,
                 AVG(s.avg_ticket_usd) AS avg_ticket
          FROM MCCONTEXT_BURGER_DEMO.GOLD.DAILY_SALES_FACT s
          JOIN MCCONTEXT_BURGER_DEMO.GOLD.FRANCHISE_STORE_DIM f USING (STORE_ID)
          WHERE f.operator_name = 'Marcus J. Williams'
            AND s.date >= '2026-05-07'
          GROUP BY f.lane_type` },
      { say: "Quantify weekly revenue at risk from the 6 single-lane stores' DT elevation using the 30s = -8% tx heuristic." },
      { key: "bound-range", rows: 2, cols: "LANE_TYPE, N_STORES, SECS_OVER, WEEKLY_DT_TX, ABANDONMENT_RATE, WEEKLY_REV_AT_RISK", sql: `
          SELECT f.lane_type,
                 COUNT(DISTINCT f.store_id) AS n_stores,
                 AVG(t.secs_vs_benchmark) AS secs_over,
                 SUM(t.total_dt_transactions) AS weekly_dt_tx,
                 AVG(t.secs_vs_benchmark)/30.0 * 0.08 AS abandonment_rate,
                 SUM(t.total_dt_transactions) * (AVG(t.secs_vs_benchmark)/30.0 * 0.08) * 7.80 AS weekly_rev_at_risk
          FROM MCCONTEXT_BURGER_DEMO.GOLD.ORDER_TIMING_MART t
          JOIN MCCONTEXT_BURGER_DEMO.GOLD.FRANCHISE_STORE_DIM f USING (STORE_ID)
          WHERE f.operator_name = 'Marcus J. Williams'
            AND t.week_start = (SELECT MAX(week_start) FROM MCCONTEXT_BURGER_DEMO.GOLD.ORDER_TIMING_MART)
          GROUP BY f.lane_type` },
      { skill: "voice-and-tone", meta: "purpose: voice" }
    ],
    answer: `Thanks for flagging this — here's the play to get you back to benchmark by Friday.

Your 8 dual-lane stores are fine — they're running 14 seconds under their 185-sec benchmark. The problem is fully isolated to your 6 single-lane stores, which are sitting 43 seconds over their 165-sec benchmark. The trigger is unambiguous: the McContext Double Stack launched 2026-05-07, requires two-step prep, and corporate's own ops alert on May 9 called out single-lane stores specifically (+47s window time).

Decomposing the 43-second gap at your single-lane stores vs. their pre-launch baseline:
• Window time: +33 sec (41s → 74s) — this is the bottleneck. Two-step prep is stacking up at the handoff.
• Prep time: +12 sec (80s → 92s) — secondary.
• Order time: flat (~45s) — not the issue.

At ~4,900 weekly drive-thru transactions across the 6 single-lane stores and the 30s = -8% transactions heuristic, you're bleeding ~$4.4k/week in lost drive-thru revenue at those 6 stores. Dual-lane stores are net positive — don't touch them.

To hit benchmark by Friday, the only lever fast enough is pre-staging Double Stack components at the 6 single-lane stores starting tomorrow morning. Per the McContext ops playbook, clean pre-staging recovers 25–30 sec of window time — which brings your single-lane stores from 208s down to ~178–183s. That's still ~15s over the 165s benchmark, so you also need a second lever: pull one crew member forward to the 10am and 4pm pre-rush shifts (recovers another 10–15s of order/handoff coordination). Combined central estimate: 165–175s by Friday at the 6 single-lane stores, recovering $2.5k–$3.5k of the $4.4k weekly risk.

If you're not at or below 175s window time by Wednesday's close, the structural fix (parallel prep station) is the only path — pre-staging alone won't get a single-lane store to a 165s benchmark on a high-volume Friday.`,
    marks: [
      { good: "The problem is fully isolated to your 6 single-lane stores, which are sitting 43 seconds over their 165-sec benchmark", from: ["persona", "query:scope", "query:confirm", "glossary:drive-thru-time"] },
      { good: "Window time: +33 sec (41s → 74s) — this is the bottleneck", from: ["query:decompose"] },
      { good: "you're bleeding ~$4.4k/week in lost drive-thru revenue at those 6 stores", from: ["query:correlate", "skill:what-if-analysis"] },
      { good: "pre-staging Double Stack components at the 6 single-lane stores starting tomorrow morning", from: ["skill:diagnostic-playbook", "skill:voice-and-tone"] },
      { good: "Combined central estimate: 165–175s by Friday at the 6 single-lane stores, recovering $2.5k–$3.5k of the $4.4k weekly risk", from: ["skill:what-if-analysis", "skill:voice-and-tone"] }
    ]
  }
});

// ----------------------------------------------------------------------
// Which of my stores should I prioritize this week?
// ----------------------------------------------------------------------
MCX.replay("marcus", "prioritize-stores", {
  bare: {
    steps: [
      { say: "See which operators exist — no identity tells me which stores are 'mine'." },
      { key: "raw_franchise_owners", rows: 9, cols: "OPERATOR_ID, OPERATOR_NAME, REGION", sql: `
          SELECT OPERATOR_ID, OPERATOR_NAME, REGION
          FROM MCCONTEXT_BURGER_DEMO.BRONZE.RAW_FRANCHISE_OWNERS ORDER BY OPERATOR_ID` },
      { say: "Rank stores by raw drive-thru seconds — the only ordering I can build without a benchmark." },
      { key: "raw_order_timing_daily", rows: 10, cols: "STORE_NAME, AVG_DT_SECS", sql: `
          SELECT s.STORE_NAME, ROUND(AVG(t.AVG_DT_SECS), 0) AS avg_dt_secs
          FROM MCCONTEXT_BURGER_DEMO.BRONZE.RAW_ORDER_TIMING_DAILY t
          JOIN MCCONTEXT_BURGER_DEMO.BRONZE.RAW_STORES s ON s.STORE_ID = t.STORE_ID
          WHERE t.DATE >= '2026-05-01'
          GROUP BY s.STORE_NAME ORDER BY avg_dt_secs DESC LIMIT 10` },
      { say: "Honest limit: No identity scope, no benchmark, no impact model — recoverable with a few answers or a curated layer." }
    ],
    answer: `Happy to help you prioritize — but "priority" needs a few things I don't have:
• Which stores are yours? I see 9 operators in RAW_FRANCHISE_OWNERS and no signed-in identity, so I can't filter to your portfolio.
• Priority by what? Biggest gap? Most volume? Most revenue at risk? Those rank stores differently, and the raw tables have no benchmark column to define "worst," nor a revenue-at-risk model.
• What's the target? Without a benchmark I can sort by raw drive-thru seconds, but a high number might be normal for a high-volume store — I can't tell.

Here's the best I can do unscoped: stores ranked by raw average drive-thru seconds (network-wide, no benchmark applied). It's a list, but not a priority list. Tell me which operator you are and what priority should optimize for, and I'll rank your stores by impact.`,
    marks: [
      { bad: "I can't filter to your portfolio" },
      { bad: "no benchmark column to define" },
      { bad: "a high number might be normal for a high-volume store — I can't tell" },
      { bad: "It's a list, but not a priority list" }
    ]
  },

  context: {
    steps: [
      { persona: "Marcus J. Williams · 14 Southeast stores", meta: "scope: operator, stores: 14" },
      { say: "Resolved who's asking from the persona — scoped automatically to your 14 Southeast stores. Never had to ask." },
      { term: "operators" },
      { skill: "diagnostic-playbook" },
      { say: "Loaded the drive-thru diagnostic playbook — scope → confirm → rule out seasonality → spread → decompose → correlate → quantify.", hold: true },
      { skill: "ontology" },
      { say: "Walking the playbook against the certified GOLD tables." },
      { say: "Scope to the breaching cohort — single-lane vs dual-lane." },
      { key: "spread", rows: 2, cols: "LANE_TYPE, WINDOW_SECS, PCT_WITHIN_BENCHMARK, N_STORES", sql: `
          SELECT LANE_TYPE,
                 ROUND(AVG(AVG_WINDOW_TIME_SECS), 0)     AS window_secs,
                 ROUND(AVG(PCT_WITHIN_BENCHMARK)*100, 0) AS pct_within_benchmark,
                 COUNT(DISTINCT STORE_ID)                AS n_stores
          FROM MCCONTEXT_BURGER_DEMO.GOLD.ORDER_TIMING_MART
          WHERE OPERATOR_NAME = 'Marcus J. Williams' AND DATE >= '2026-05-01'
          GROUP BY LANE_TYPE` },
      { say: "Rank single-lane stores by revenue impact = seconds-over-benchmark × drive-thru volume." },
      { key: "quantify", rows: 6, cols: "STORE_NAME, WINDOW_SECS, SECS_OVER_BENCHMARK, DT_TRANSACTIONS", sql: `
          SELECT STORE_NAME,
                 ROUND(AVG(AVG_WINDOW_TIME_SECS), 0) AS window_secs,
                 ROUND(AVG(SECS_VS_BENCHMARK), 0)    AS secs_over_benchmark,
                 SUM(TOTAL_DT_TRANSACTIONS)          AS dt_transactions
          FROM MCCONTEXT_BURGER_DEMO.GOLD.ORDER_TIMING_MART
          WHERE OPERATOR_NAME = 'Marcus J. Williams' AND LANE_TYPE = 'single_lane'
            AND DATE >= '2026-05-01'
          GROUP BY STORE_NAME ORDER BY secs_over_benchmark * dt_transactions DESC` }
    ],
    answer: `Prioritize your 6 single-lane stores — start with Charlotte Uptown.

All 6 single-lane stores are breaching (≈54% within benchmark, ~59s window). Your 8 dual-lane stores are fine (~70%, ~44s), so they're not where your attention goes this week.

Ranked by revenue impact (seconds over benchmark × drive-thru volume):

1. Charlotte Uptown — ~59s window, ~31s over benchmark, highest volume
2. Atlanta Peachtree — ~61s, ~31s over
3. Nashville Midtown — ~60s, ~29s over

The cause and fix are identical across all six (Double Stack two-step prep → pre-stage during pre-rush), so one playbook covers the cohort. If you can only staff a change at a few this week, hit those top three first.`,
    marks: [
      { good: "Prioritize your 6 single-lane stores — start with Charlotte Uptown", from: ["persona", "query:spread", "query:quantify"] },
      { good: "All 6 single-lane stores are breaching", from: ["query:spread", "glossary:drive-thru-time"] },
      { good: "Ranked by revenue impact", from: ["query:quantify", "skill:diagnostic-playbook"] },
      { good: "Charlotte Uptown — ~59s window, ~31s over benchmark, highest volume", from: ["query:quantify", "model:FRANCHISE_STORE_DIM"] }
    ]
  }
});

// ----------------------------------------------------------------------
// What if I pre-stage Double Stack components — what's the impact?
// ----------------------------------------------------------------------
MCX.replay("marcus", "prestage-double-stack", {
  bare: {
    steps: [
      { say: "Pull the current raw window-time trend — the anchor any forecast would start from." },
      { key: "raw_order_timing_daily", rows: 5, cols: "WK, WINDOW_SECS", sql: `
          SELECT DATE_TRUNC('week', DATE) AS wk, ROUND(AVG(AVG_WINDOW_TIME_SECS), 1) AS window_secs
          FROM MCCONTEXT_BURGER_DEMO.BRONZE.RAW_ORDER_TIMING_DAILY
          WHERE DATE >= DATEADD(week, -4, (SELECT MAX(DATE) FROM MCCONTEXT_BURGER_DEMO.BRONZE.RAW_ORDER_TIMING_DAILY))
          GROUP BY wk ORDER BY wk` },
      { say: "Honest limit: Forecasting without a baseline or an effect model is guessing — the curated what-if skill is exactly what's missing." }
    ],
    answer: `Happy to think it through — but I can't forecast the impact responsibly without a few things:
• A baseline / benchmark to measure the improvement against — there's no benchmark column in the raw data.
• A model of how the change affects window time — pre-staging or a prep station shifts operations, but the raw warehouse has no ops playbook quantifying that. I'd be inventing a number.
• Scope — which stores are yours and which lane types they are (single-lane responds very differently from dual-lane).

Here's the current raw window-time trend network-wide, which is where any estimate would start. But projecting the effect of an operational change would be a guess. With a calibrated ops what-if model and your benchmark, this becomes a real low/central/high estimate.`,
    marks: [
      { bad: "I can't forecast the impact responsibly" },
      { bad: "the raw warehouse has no ops playbook quantifying that" },
      { bad: "there's no benchmark column in the raw data" },
      { bad: "I'd be inventing a number" }
    ]
  },

  context: {
    steps: [
      { persona: "Marcus J. Williams · 14 Southeast stores", meta: "scope: operator, stores: 14" },
      { say: "Resolved who's asking from the persona — scoped automatically to your 14 Southeast stores. Never had to ask." },
      { skill: "what-if-analysis" },
      { skill: "diagnostic-playbook" },
      { say: "Loaded the drive-thru diagnostic playbook — scope → confirm → rule out seasonality → spread → decompose → correlate → quantify.", hold: true },
      { say: "Walking the playbook against the certified GOLD tables." },
      { say: "Anchor on observed reality — single-lane window now vs the April baseline." },
      { key: "decompose", rows: 2, cols: "PERIOD, WINDOW_SECS, PCT_WITHIN_BENCHMARK", sql: `
          SELECT CASE WHEN DATE < '2026-05-01' THEN 'Apr (baseline)' ELSE 'May (now)' END AS period,
                 ROUND(AVG(AVG_WINDOW_TIME_SECS), 0)     AS window_secs,
                 ROUND(AVG(PCT_WITHIN_BENCHMARK)*100, 0) AS pct_within_benchmark
          FROM MCCONTEXT_BURGER_DEMO.GOLD.ORDER_TIMING_MART
          WHERE OPERATOR_NAME = 'Marcus J. Williams' AND LANE_TYPE = 'single_lane' AND DATE >= '2026-04-01'
          GROUP BY period ORDER BY period` },
      { say: "Pull single-lane drive-thru volume since launch to size the revenue recovery." },
      { key: "quantify", rows: 1, cols: "DT_TRANSACTIONS_SINCE_LAUNCH", sql: `
          SELECT SUM(TOTAL_DT_TRANSACTIONS) AS dt_transactions_since_launch
          FROM MCCONTEXT_BURGER_DEMO.GOLD.ORDER_TIMING_MART
          WHERE OPERATOR_NAME = 'Marcus J. Williams' AND LANE_TYPE = 'single_lane' AND DATE >= '2026-05-07'` }
    ],
    answer: `Pre-staging is your quick win — it targets the exact driver and should recover most of the gap.

Pre-staging Double Stack components attacks the two-step prep penalty directly. Your single-lane window is ~59s now, up from a ~41s April baseline (an 18s blowout).

Projected impact on single-lane window time (per the ops what-if model):
• Central: ~32–38s — recovers 25–30s, back at or under your April baseline; compliance climbs from ~54% toward ~75%.
• Low (sloppy execution): ~45s.  High (clean pre-rush staging): ~30s.

Two assumptions: traffic holds at current levels, and the Double Stack stays ~28% of single-lane mix. Confirm after 5 days: if Wed–Fri single-lane window averages under ~45s, it's working; if it stays above 50s you likely need a parallel prep station (the structural fix), not just staging.`,
    marks: [
      { good: "Pre-staging is your quick win — it targets the exact driver", from: ["skill:what-if-analysis", "query:decompose"] },
      { good: "Your single-lane window is ~59s now, up from a ~41s April baseline (an 18s blowout)", from: ["query:decompose", "glossary:drive-thru-time"] },
      { good: "Central: ~32–38s — recovers 25–30s, back at or under your April baseline", from: ["skill:what-if-analysis", "query:quantify"] },
      { good: "if Wed–Fri single-lane window averages under ~45s, it's working", from: ["skill:what-if-analysis"] }
    ]
  }
});

// ----------------------------------------------------------------------
// What if I add a parallel prep station at my single-lane stores?
// ----------------------------------------------------------------------
MCX.replay("marcus", "parallel-prep-station", {
  bare: {
    steps: [
      { say: "Pull the current raw window-time trend — the anchor any forecast would start from." },
      { key: "raw_order_timing_daily", rows: 5, cols: "WK, WINDOW_SECS", sql: `
          SELECT DATE_TRUNC('week', DATE) AS wk, ROUND(AVG(AVG_WINDOW_TIME_SECS), 1) AS window_secs
          FROM MCCONTEXT_BURGER_DEMO.BRONZE.RAW_ORDER_TIMING_DAILY
          WHERE DATE >= DATEADD(week, -4, (SELECT MAX(DATE) FROM MCCONTEXT_BURGER_DEMO.BRONZE.RAW_ORDER_TIMING_DAILY))
          GROUP BY wk ORDER BY wk` },
      { say: "Two raw columns both claim to be “drive-thru time” and they disagree — `RAW_POS_DAILY.avg_service_secs` (order-to-payment) vs `RAW_ORDER_TIMING_DAILY.avg_dt_secs` (gate-to-window). Nothing says which is authoritative — guessing.", hold: true },
      { say: "Honest limit: Forecasting without a baseline or an effect model is guessing — the curated what-if skill is exactly what's missing." }
    ],
    answer: `Happy to think it through — but I can't forecast the impact responsibly without a few things:
• A baseline / benchmark to measure the improvement against — there's no benchmark column in the raw data.
• A model of how the change affects window time — pre-staging or a prep station shifts operations, but the raw warehouse has no ops playbook quantifying that. I'd be inventing a number.
• Scope — which stores are yours and which lane types they are (single-lane responds very differently from dual-lane).

Here's the current raw window-time trend network-wide, which is where any estimate would start. But projecting the effect of an operational change would be a guess. With a calibrated ops what-if model and your benchmark, this becomes a real low/central/high estimate.`,
    marks: [
      { bad: "I can't forecast the impact responsibly" },
      { bad: "the raw warehouse has no ops playbook quantifying that" },
      { bad: "there's no benchmark column in the raw data" },
      { bad: "I'd be inventing a number" }
    ]
  },

  context: {
    steps: [
      { persona: "Marcus J. Williams · 14 Southeast stores", meta: "scope: operator, stores: 14" },
      { say: "Resolved who's asking from the persona — scoped automatically to your 14 Southeast stores. Never had to ask." },
      { skill: "what-if-analysis" },
      { skill: "diagnostic-playbook" },
      { say: "Loaded the drive-thru diagnostic playbook — scope → confirm → rule out seasonality → spread → decompose → correlate → quantify.", hold: true },
      { say: "Walking the playbook against the certified GOLD tables." },
      { say: "Compare single-lane to dual-lane — dual-lane is the target state a parallel station reaches." },
      { key: "decompose", rows: 2, cols: "LANE_TYPE, WINDOW_SECS, PCT_WITHIN_BENCHMARK", sql: `
          SELECT LANE_TYPE,
                 ROUND(AVG(AVG_WINDOW_TIME_SECS), 0)     AS window_secs,
                 ROUND(AVG(PCT_WITHIN_BENCHMARK)*100, 0) AS pct_within_benchmark
          FROM MCCONTEXT_BURGER_DEMO.GOLD.ORDER_TIMING_MART
          WHERE OPERATOR_NAME = 'Marcus J. Williams' AND DATE >= '2026-05-01'
          GROUP BY LANE_TYPE` }
    ],
    answer: `A parallel prep station is the structural fix — it makes single-lane behave like your dual-lane stores.

Your dual-lane stores barely moved when the Double Stack launched (~44s window, ~70% compliance) because they stage prep in parallel. A parallel prep station gives single-lane the same capability.

Projected impact on single-lane window time:
• Central: ~40–44s (matching dual-lane), compliance toward ~70%.
• Low: ~48s.  High: ~40s.

Trade-off vs pre-staging: pre-staging is free and fast but caps out around your old baseline; a parallel station is capex + space but durable through future two-step LTOs. Recommendation: pre-stage everywhere this week for the immediate recovery, and scope parallel stations for your 2–3 highest-volume single-lane stores (Charlotte Uptown, Atlanta Peachtree) if the gap persists past two weeks.`,
    marks: [
      { good: "A parallel prep station is the structural fix — it makes single-lane behave like your dual-lane stores", from: ["skill:what-if-analysis", "query:decompose"] },
      { good: "Your dual-lane stores barely moved when the Double Stack launched (~44s window, ~70% compliance) because they stage prep in parallel", from: ["query:decompose", "model:FRANCHISE_STORE_DIM"] },
      { good: "Central: ~40–44s (matching dual-lane), compliance toward ~70%", from: ["skill:what-if-analysis"] },
      { good: "scope parallel stations for your 2–3 highest-volume single-lane stores (Charlotte Uptown, Atlanta Peachtree)", from: ["skill:voice-and-tone", "query:decompose"] }
    ]
  }
});
