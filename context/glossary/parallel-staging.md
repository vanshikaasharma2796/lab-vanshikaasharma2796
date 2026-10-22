---
term: parallel-staging
name: Parallel staging
status: certified
owner: Store Ops
synonyms: [parallel staging, parallel prep station, parallel prep stations, prep station, prep stations, retrofit, retrofitted]
maps_to: GOLD.FRANCHISE_STORE_DIM.has_parallel_staging
hold: true
resolves: Glossary resolves “parallel staging” to a second prep line for two-step items — `FRANCHISE_STORE_DIM.has_parallel_staging`, standard on dual-lane and rare on single-lane.
---

A second prep line where a two-step item can be assembled without blocking the main line.

Every dual-lane kitchen is built with one. A single-lane kitchen has one only if it was retrofitted. A single-lane store without it is "exposed": a two-step item queues at the window.

The flag lives on `FRANCHISE_STORE_DIM.has_parallel_staging`; the asset itself is on `KITCHEN_EQUIPMENT_DIM`.
