---
name: seasonality-check
title: Seasonality check
owner: Central Reporting
description: Compare a period with the same days a year earlier before calling a change a problem.
intents: [diagnostic, descriptive]
when: [seasonal, last year, normal for this time]
---

# Seasonality check

Compare the period with the same weekdays one year earlier (364 days back), on the same metric and the same stores.

If last year shows the same movement, it is seasonal. If last year is flat, something changed.
