---
term: reporting-week
name: Reporting week
status: certified
owner: Central Reporting
synonyms: [this week, last week, week, weeks, weekly, week on week, right now]
maps_to: GOLD.ORDER_TIMING_MART.week_start
hold: false
resolves: Glossary resolves “this week” to the Monday–Sunday reporting week — and flags a week with fewer than seven days as partial.
---

Weeks run Monday to Sunday and are keyed by `week_start`.

"This week" is the week containing the latest data date. "Last week" is the last complete week before it.

A week with fewer than seven days of data is partial. Report its averages with the number of days, and never compare its totals with a full week.
