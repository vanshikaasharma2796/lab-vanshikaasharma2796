---
term: benchmark
name: Benchmark
status: certified
owner: Store Ops
synonyms: [benchmark, vs benchmark, missing benchmark, target, on target, standard]
maps_to: GOLD.ORDER_TIMING_MART.benchmark_dt_secs
hold: false
resolves: Glossary sets the benchmark by lane type — 165 sec single-lane, 185 sec dual-lane — so any mix of stores is read against its blended benchmark.
---

The drive-thru time a store is expected to hit: 165 seconds for a single-lane store, 185 for a dual-lane store.

Three certified columns carry it: `benchmark_dt_secs`, `secs_vs_benchmark` (positive means over) and `pct_within_benchmark` (the share of orders served inside it).

For a group of stores, compare against the blended benchmark: the average of each store's own benchmark. Never hold a mixed group to a single number.
