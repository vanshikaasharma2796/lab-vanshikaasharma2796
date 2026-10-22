---
term: double-stack
name: McContext Double Stack
status: certified
owner: Marketing
synonyms: [double stack, the double stack, mccontext double stack]
maps_to: GOLD.DAILY_SALES_FACT.double_stack_transactions
hold: false
resolves: Glossary resolves “Double Stack” to SKU-DS-001 — a two-step-prep limited-time offer, with its revenue on `COMBO_REVENUE_DAILY` and its order mix on `DAILY_SALES_FACT`.
---

The limited-time offer launched in May: a beef stack, then a sauce layer. Two prep steps.

Revenue is on `COMBO_REVENUE_DAILY` (`is_lto`). How much of a store's drive-thru trade it makes up is `double_stack_transactions` over `dt_transactions` on `DAILY_SALES_FACT`.
