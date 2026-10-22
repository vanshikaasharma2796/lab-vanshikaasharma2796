---
term: lto
name: Limited-time offer (LTO)
status: certified
owner: Marketing
synonyms: [lto, next lto, limited-time offer, limited time offer, promo, promotion, rollout, launch]
maps_to: GOLD.MENU_CHANGE_LOG
hold: true
resolves: Glossary resolves “LTO” to a limited-time offer — an item flagged `is_lto`, with its launch and any ops alerts on `MENU_CHANGE_LOG`.
---

A menu item sold for a fixed window. `MENU_CHANGE_LOG` records each launch, each planned launch and any ops alert raised against it, with two fields that matter to kitchens: `requires_two_step_prep` and `ops_impact_level`.

"The next LTO" is the earliest `planned_launch` after the latest data date.
