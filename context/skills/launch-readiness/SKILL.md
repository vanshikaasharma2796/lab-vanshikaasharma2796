---
name: launch-readiness
title: Launch readiness
owner: Store Ops
description: Whether a kitchen is ready to take a new two-step item.
intents: [predictive, prescriptive]
when: [launch, next lto, delay, ready, readiness]
announce: Loaded the launch-readiness rule — a two-step item should not land on a store whose window time is above 45 sec.
hold: true
---

# Launch readiness

A kitchen is ready for a two-step item if it has parallel staging, or if its window time is at or under 45 seconds.

A launch can be split: ready kitchens on the planned date, the rest when they pass the test.
