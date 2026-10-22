---
term: service-breach
name: Service breach
status: certified
owner: Store Ops
synonyms: [break, breaks, break first, breach, breaking point]
maps_to: GOLD.ORDER_TIMING_MART.secs_vs_benchmark
hold: true
rule: {"secs_over": 30, "min_pct_inside": 50}
resolves: Glossary resolves “break” to a service breach — a segment more than 30 sec over its benchmark, or with under half its orders inside it.
---

A group of stores is in breach when it averages more than 30 seconds over its benchmark, or when fewer than half its orders are served inside benchmark.
