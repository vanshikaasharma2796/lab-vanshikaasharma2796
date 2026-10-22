---
term: lane-type
name: Lane type
status: certified
owner: Store Ops
synonyms: [lane type, single-lane, single lane, dual-lane, dual lane, one lane or two, lanes]
maps_to: GOLD.FRANCHISE_STORE_DIM.lane_type
hold: false
resolves: Glossary resolves “lane type” to `FRANCHISE_STORE_DIM.lane_type`, and notes that single-lane stores split again on `has_parallel_staging`.
---

`single_lane` or `dual_lane`: how many drive-thru lanes a store has. It sets the benchmark.

Single-lane stores are not one group. The few with a parallel prep station behave like dual-lane kitchens, so always read single-lane together with `has_parallel_staging`.
