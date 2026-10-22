---
term: wait-time-complaint
name: Wait-time complaint
status: certified
owner: Customer Support
synonyms: [wait-time complaints, wait time complaints, wait-time complaint, complaints, complaint, complaining, complain]
maps_to: GOLD.CARE_TICKET_FACT.category = 'wait_time'
not: BRONZE.RAW_SUPPORT_TICKETS.CATEGORY_TEXT
hold: true
resolves: Glossary resolves “wait-time complaint” to a care ticket with `category = 'wait_time'` on `CARE_TICKET_FACT` — tagged at intake, not guessed from free text.
---

A care ticket an agent has tagged as being about waiting, with where the wait happened (`wait_location`) and whether the customer named the Double Stack.

The raw ticket table has only free text ("slow service", "DT wait", "line too long"). Searching it for the word "wait" misses some complaints and picks up others that are about refunds.
