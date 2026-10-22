---
term: combo-revenue
name: Combo revenue
status: certified
owner: Finance
synonyms: [combo revenue, combo sales, combos, combo]
maps_to: GOLD.COMBO_REVENUE_DAILY.net_rev
not: BRONZE.RAW_COMBO_REVENUE_DAILY.GROSS_REVENUE_USD
hold: true
resolves: Glossary resolves “combo revenue” to net-of-discount — `COMBO_REVENUE_DAILY.net_rev`, not gross. One authoritative definition.
---

Revenue from combo items after discounts. Finance reports net; gross overstates a discounted launch.

The table is by item, region and day. It has no store column, so store-level views have to be allocated from `DAILY_SALES_FACT`.

Compare per-day figures, not weekly totals, whenever a partial week is in range.
