---
policy: human-check
name: Human check for high-impact actions
owner: Store Ops
applies_to: [proposed actions, write-back]
---

- The engine may propose actions (a ticket, a message, a task, an order) but never writes to an enterprise system on its own.
- An action is high impact when it touches many stores, when the answer behind it puts a large dollar figure at stake, or when the catalog marks it high. The thresholds are in `context/actions.json` (`high_impact`).
- A high-impact action waits for a human check: someone holding the action's approver role signs it off before it is written. The approvers for each role are listed in `context/actions.json` (`approvers`).
- A low-impact action can be approved by the person who asked.
- Every decision, approved or rejected, is logged with who made it and when.
- A change to the context itself (a synonym, a playbook number, a page) is drafted, tested against the golden answers and the evals, reviewed, then signed off by the team that owns the file before it goes live. Who signs off for each owner is listed in `context/actions.json` (`signoff`); the author of a change never signs it off.
