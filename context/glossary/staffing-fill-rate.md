---
term: staffing-fill-rate
name: Staffing (shift fill rate)
status: certified
owner: People
synonyms: [staffing, understaffed, short-staffed, fill rate, shift fill, crew hours]
maps_to: GOLD.STAFFING_DAILY_FACT.shift_fill_rate
not: BRONZE.RAW_STAFFING_DAILY.HEADCOUNT
hold: true
resolves: Glossary resolves “staffing” to shift fill rate — worked crew hours over scheduled, `STAFFING_DAILY_FACT.shift_fill_rate`. Headcount is the wrong measure.
---

Worked crew hours as a share of scheduled crew hours. It falls when shifts go unfilled.

Headcount does not move when a shift is missed, so it cannot show a staffing problem.
