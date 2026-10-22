---
name: diagnostic-playbook
title: Drive-thru diagnostic playbook
owner: Store Ops
description: The order in which a change in a service metric is investigated, so that a cause is only named after the alternatives are ruled out.
intents: [diagnostic, prescriptive]
when: [why, cause, up, down, spike, slow, dip]
steps: [scope, confirm, seasonality, spread, decompose, correlate, quantify]
announce: Loaded the drive-thru diagnostic playbook — {steps}.
hold: true
---

# Drive-thru diagnostic playbook

Work through the steps in order. Do not name a cause before step 6.

1. **Scope.** Whose stores, which dates. Find the latest data date first; "this week" may be partial.
2. **Confirm.** Did the metric really move? Look at the weekly trend, not one day.
3. **Rule out seasonality.** Compare with the same days last year.
4. **Spread.** Which stores moved? Cut by lane type and parallel staging before anything else.
5. **Decompose.** Split drive-thru time into order, prep and window. The segment that moved is the bottleneck.
6. **Correlate.** Check the menu change log for a launch or alert at the break. Check weather.
7. **Quantify.** Put a dollar figure on it with the revenue-at-risk rule.

If the spread shows that only one kind of store moved, say so first: it is the finding.
