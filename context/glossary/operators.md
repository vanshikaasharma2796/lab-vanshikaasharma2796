---
term: operators
name: Operator
status: certified
owner: Franchise Relations
synonyms: [operator, operators, franchisee, franchise operator, portfolio, my stores]
maps_to: GOLD.FRANCHISE_STORE_DIM.operator_name
hold: false
resolves: Glossary resolves an operator's stores through `FRANCHISE_STORE_DIM.operator_name` — one certified owner per active store.
---

A franchise operator owns a set of stores. `FRANCHISE_STORE_DIM` holds one row per active store with its operator, so "my stores" for a signed-in operator is a filter on `operator_name`.

Closed stores are not in the dimension. The raw store table still lists them.
