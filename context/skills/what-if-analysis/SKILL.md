---
name: what-if-analysis
title: Ops what-if model
owner: Store Ops
description: Calibrated effects of operational changes on window time, and the rule that turns seconds over benchmark into revenue at risk. Always answered as low, central and high.
intents: [predictive, prescriptive, diagnostic]
when: [what if, impact, projected, forecast, at risk, revenue impact]
announce: Loaded the ops what-if model — low, central and high cases, with the assumptions stated.
hold: false
---

# Ops what-if model

Effects, in seconds of window time at a single-lane store without parallel staging:

- Pre-staging a two-step item in the pre-rush: 25–30 seconds back.
- Moving one crew member forward into the pre-rush: another 10–15.
- A second two-step item on a lane that is not yet fixed: 10–15 worse.
- A parallel prep station: the central case is the window time of the single-lane kitchens that already have one. The low case recovers 75% of the blowout.

Traffic: each 1% of extra traffic adds 1.5–2.0 seconds at an exposed single-lane store, 0.4–0.6 at a retrofitted one and 0.25–0.5 at a dual-lane store.

Revenue at risk: every 30 seconds over benchmark costs about 8% of drive-thru orders, at the average ticket. Stores within 5 seconds of benchmark count as zero. The high case is 1.25 times the central case (peak weighting); the low case assumes the rule only bites at peak, about 60% of orders.

Always state the assumptions: traffic held flat, item mix unchanged, nothing else changing.
