---
term: kitchen-equipment
name: Kitchen equipment
status: certified
owner: Supply Chain
synonyms: [kitchen, kitchens, equipment, every kitchen]
maps_to: GOLD.KITCHEN_EQUIPMENT_DIM
not: BRONZE.RAW_EQUIPMENT_REGISTER.EQUIPMENT_NAME
hold: false
resolves: Glossary resolves “what is in a kitchen” to the certified equipment register — `KITCHEN_EQUIPMENT_DIM`, one row per store and equipment type.
---

What each kitchen has: one row per store and equipment type, with model, quantity, install date and status.

The raw asset register names the same station four different ways and still lists decommissioned units.
