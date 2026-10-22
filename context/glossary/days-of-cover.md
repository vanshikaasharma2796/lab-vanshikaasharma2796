---
term: days-of-cover
name: Days of cover
status: certified
owner: Supply Chain
synonyms: [days of cover, cover, stock, stockout, stockouts, running short, components, rebalance]
maps_to: GOLD.INVENTORY_DAILY_FACT.days_of_cover
hold: false
resolves: Glossary resolves stock levels to days of cover — on-hand units over daily usage, `INVENTORY_DAILY_FACT.days_of_cover`, against a four-day target.
---

On-hand units divided by daily usage. The target is four days in stores.

A stockout is logged in hours on the same table. Distribution-centre stock is on `DC_STOCK_FACT`.
