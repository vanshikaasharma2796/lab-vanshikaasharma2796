---
term: drive-thru-time
name: Drive-thru time
status: certified
owner: Store Ops
synonyms: [drive-thru time, drive thru time, drive-thru, drive thru, dt time, speed of service, service speed]
maps_to: GOLD.ORDER_TIMING_MART.avg_dt_secs
not: BRONZE.RAW_POS_DAILY.AVG_SERVICE_SECS
hold: true
resolves: Glossary resolves “drive-thru time” to gate-to-window — `ORDER_TIMING_MART.avg_dt_secs`. The POS order-to-payment column is explicitly the wrong one.
---

Seconds from the car reaching the order point to the bag being handed over at the window ("gate to window").

It is the sum of three segments, each certified on the same table: order time, prep time and window time.

Do not use `RAW_POS_DAILY.AVG_SERVICE_SECS`. That column stops the clock at payment, so it never sees a queue at the window.
