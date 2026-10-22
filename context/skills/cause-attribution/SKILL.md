---
name: cause-attribution
title: Attribution checklist
owner: Central Reporting
description: Five checks for deciding between two candidate causes of the same change.
intents: [diagnostic]
when: [cause, or is it, because of, due to, attribute]
steps: [timing, who-moved, which-seconds, dose-response, exceptions]
announce: Loaded the attribution checklist — timing, who moved and who didn't, which seconds moved, dose-response, then exceptions.
hold: true
---

# Attribution checklist

1. **Timing.** Which candidate changed on the day the metric broke?
2. **Who moved, who didn't.** Find a group exposed to one cause and not the other.
3. **Which seconds moved.** Each cause leaves a different fingerprint in order, prep and window.
4. **Dose-response.** More of the cause should mean more of the effect.
5. **Exceptions.** Look for anyone the second cause does explain, and report them separately.

Give a verdict and a confidence. Do not average the two causes together.
