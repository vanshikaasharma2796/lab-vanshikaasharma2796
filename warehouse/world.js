/* =====================================================================
   warehouse/world.js — the McContext Burger network, as parameters

   Everything the warehouse contains is generated from this file by
   warehouse/seed.js: nine operators, 104 stores, the Double Stack launch
   on 7 May 2026 and what it did to each kind of kitchen.

   The figures for Marcus J. Williams's 14 Southeast stores are set so the
   certified tables reproduce what his recorded answers on the public
   demo say (single-lane window time 41 → 74 sec across the first week,
   208 sec this week against a 165 sec benchmark, 54% of orders inside
   benchmark for May to date, and so on). The rest of the network was
   written for this project. All of it is fictional.

   Change a number here and every live answer changes with it.
   ===================================================================== */
(function (global) {
  'use strict';
  var MCX = (global.MCX = global.MCX || {});

  // Per-store spread around an operator's average (seconds); each list sums to zero.
  var SPREAD = {
    1: [0], 2: [1, -1], 3: [3, 0, -3], 4: [1, 1, -1, -1], 5: [4, 2, 0, -2, -4],
    6: [3, 2, 1, -1, -2, -3], 7: [4, 3, 1, 0, -1, -3, -4], 8: [3, 2, 1, 1, -1, -1, -2, -3],
    9: [4, 3, 2, 1, 0, -1, -2, -3, -4], 13: [4, 3, 3, 2, 1, 1, 0, -1, -1, -2, -3, -3, -4]
  };

  MCX.world = {
    // ---- Calendar -------------------------------------------------------
    firstDay: '2026-03-16',           // a Monday
    lastDay: '2026-05-13',            // data ends on a Wednesday: "this week" has three days
    lastYear: { firstDay: '2025-03-17', lastDay: '2025-05-18' }, // the same weekdays a year earlier
    launchDay: '2026-05-07',          // a Thursday

    // ---- Standards --------------------------------------------------------
    benchmark: { single_lane: 165, dual_lane: 185 }, // seconds, gate to window
    ticket: { single_lane: 7.65, dual_lane: 7.80 },  // average ticket, USD
    driveThruShare: 0.62,                            // drive-thru orders as a share of all orders
    ordersPerDay: { single_lane: 274, dual_lane: 316 },

    // ---- Seconds, before the launch ----------------------------------------
    parts: { order: 45, prep: 80, window: 41 },

    // ---- What the Double Stack did, by region -------------------------------
    // Single-lane kitchens without parallel staging ("exposed"): extra seconds once the
    // launch settled. The first four days ran hotter (launchRush, scaled by window / 30).
    launchEffect: {
      Southeast: { window: 30, prep: 12, mix: 28 },
      Midwest:   { window: 22, prep: 8,  mix: 23 },
      Northeast: { window: 18, prep: 7,  mix: 21 },
      West:      { window: 14, prep: 5,  mix: 18 }
    },
    launchRush: { '2026-05-07': 4, '2026-05-08': 5, '2026-05-09': 7, '2026-05-10': 5 },
    stagedEffect: { dual_lane: 4, retrofitted: 3 },   // window seconds where there is parallel staging

    // ---- Share of orders inside benchmark ------------------------------------
    inside: {
      exposed:     { base: 0.81, perSecOver: 0.0115, floor: 0.15 },
      retrofitted: { base: 0.80, perSecOver: 0.0115 },
      dual_lane:   { base: 0.745, perSecCloser: 0.0125, comfortable: -17, afterLaunch: 0.035 }
    },

    // ---- Operators and their stores -------------------------------------------
    // lanes: x = single-lane, no parallel staging; p = single-lane, retrofitted; d = dual-lane
    operators: [
      { id: 'OP-SE-01', name: 'Marcus J. Williams', region: 'Southeast', years: 14, fill: 0.970, prep: { d: 82 },
        stores: [
          ['Atlanta Buckhead', 'Atlanta', 'GA', 'x', { orders: 274, offset: 6 }],
          ['Charlotte Uptown', 'Charlotte', 'NC', 'x', { orders: 330, offset: 3 }],
          ['Atlanta Peachtree', 'Atlanta', 'GA', 'x', { orders: 300, offset: 1 }],
          ['Nashville Midtown', 'Nashville', 'TN', 'x', { orders: 250, offset: 0 }],
          ['Greenville Main Street', 'Greenville', 'SC', 'x', { orders: 245, offset: -5 }],
          ['Chattanooga Northshore', 'Chattanooga', 'TN', 'x', { orders: 245, offset: -5 }],
          ['Atlanta Decatur', 'Atlanta', 'GA', 'd'], ['Atlanta Sandy Springs', 'Atlanta', 'GA', 'd'],
          ['Charlotte SouthPark', 'Charlotte', 'NC', 'd'], ['Charlotte Ballantyne', 'Charlotte', 'NC', 'd'],
          ['Nashville Green Hills', 'Nashville', 'TN', 'd'], ['Raleigh North Hills', 'Raleigh', 'NC', 'd'],
          ['Knoxville West Town', 'Knoxville', 'TN', 'd'], ['Columbia Harbison', 'Columbia', 'SC', 'd']
        ] },
      { id: 'OP-SE-02', name: 'Camille Fontaine', region: 'Southeast', years: 9, fill: 0.963, prep: { d: 82 },
        stores: [
          ['Jacksonville Riverside', 'Jacksonville', 'FL', 'x', { offset: 4 }],
          ['Tampa Westshore', 'Tampa', 'FL', 'x', { offset: 2 }],
          ['Orlando Colonial', 'Orlando', 'FL', 'x', { offset: 0 }],
          ['Mobile Dauphin', 'Mobile', 'AL', 'x', { offset: -3 }],
          ['Birmingham Five Points', 'Birmingham', 'AL', 'x', { offset: -3 }],
          ['Jacksonville Southside', 'Jacksonville', 'FL', 'd'], ['Tampa Brandon', 'Tampa', 'FL', 'd'],
          ['Orlando Lake Nona', 'Orlando', 'FL', 'd'], ['Tallahassee Capital Circle', 'Tallahassee', 'FL', 'd'],
          ['Pensacola Cordova', 'Pensacola', 'FL', 'd']
        ] },
      { id: 'OP-NE-01', name: 'Daniel Okafor', region: 'Northeast', years: 11, fill: 0.962, prep: { d: 83 },
        stores: [
          ['Newark Ironbound', 'Newark', 'NJ', 'x'], ['Yonkers Central', 'Yonkers', 'NY', 'x'], ['Stamford Summer Street', 'Stamford', 'CT', 'x'],
          ['Paramus Route 17', 'Paramus', 'NJ', 'd'], ['Edison Oak Tree', 'Edison', 'NJ', 'd'], ['White Plains Mamaroneck', 'White Plains', 'NY', 'd'],
          ['New Haven Whalley', 'New Haven', 'CT', 'd'], ['Hartford Farmington', 'Hartford', 'CT', 'd'], ['Albany Wolf Road', 'Albany', 'NY', 'd'],
          ['Syracuse Erie Boulevard', 'Syracuse', 'NY', 'd'], ['Cherry Hill Marlton', 'Cherry Hill', 'NJ', 'd'], ['Trenton Hamilton', 'Trenton', 'NJ', 'd']
        ] },
      { id: 'OP-NE-02', name: 'Teresa Marchetti', region: 'Northeast', years: 17, fill: 0.965, prep: { x: 79, d: 82 },
        stores: [
          ['Providence Federal Hill', 'Providence', 'RI', 'x'], ['Worcester Shrewsbury', 'Worcester', 'MA', 'x'],
          ['Boston Dorchester', 'Boston', 'MA', 'd'], ['Springfield Boston Road', 'Springfield', 'MA', 'd'], ['Lowell Chelmsford', 'Lowell', 'MA', 'd'],
          ['Allentown Hamilton', 'Allentown', 'PA', 'd'], ['Scranton Dickson', 'Scranton', 'PA', 'd'], ['Harrisburg Paxton', 'Harrisburg', 'PA', 'd'],
          ['Warwick Bald Hill', 'Warwick', 'RI', 'd']
        ] },
      // Greg Novak's prep time has been creeping since mid-March as shifts went unfilled.
      // prepDrift and fillByWeek are indexed by week, starting 16 March.
      { id: 'OP-MW-01', name: 'Greg Novak', region: 'Midwest', years: 6, prep: { x: 82, d: 84 },
        prepDrift: { x: [0, 1, 2, 3, 4, 5, 6, 6, 6], d: [0, 1, 2, 2, 3, 4, 5, 5, 5] },
        fillByWeek: [0.96, 0.94, 0.93, 0.91, 0.90, 0.89, 0.88, 0.88, 0.87],
        stores: [
          ['Columbus High Street', 'Columbus', 'OH', 'x'], ['Cleveland Lakewood', 'Cleveland', 'OH', 'x'], ['Indianapolis Broad Ripple', 'Indianapolis', 'IN', 'x'],
          ['Dayton Oregon', 'Dayton', 'OH', 'x'], ['Toledo Monroe', 'Toledo', 'OH', 'x'], ['Fort Wayne Coliseum', 'Fort Wayne', 'IN', 'x'], ['Detroit Corktown', 'Detroit', 'MI', 'x'],
          ['Columbus Polaris', 'Columbus', 'OH', 'd'], ['Columbus Easton', 'Columbus', 'OH', 'd'], ['Cleveland Parma', 'Cleveland', 'OH', 'd'],
          ['Cincinnati Oakley', 'Cincinnati', 'OH', 'd'], ['Indianapolis Castleton', 'Indianapolis', 'IN', 'd'], ['Indianapolis Greenwood', 'Indianapolis', 'IN', 'd'],
          ['Akron Fairlawn', 'Akron', 'OH', 'd'], ['Grand Rapids Kentwood', 'Grand Rapids', 'MI', 'd'], ['Ann Arbor Washtenaw', 'Ann Arbor', 'MI', 'd']
        ] },
      // Linda Hartmann retrofitted four single-lane kitchens with parallel prep stations in February: the pilot.
      { id: 'OP-MW-02', name: 'Linda Hartmann', region: 'Midwest', years: 21, fill: 0.966, prep: { p: 79, d: 81 },
        stores: [
          ['Rockford East State', 'Rockford', 'IL', 'x'],
          ['Chicago Logan Square', 'Chicago', 'IL', 'p'], ['Chicago Hyde Park', 'Chicago', 'IL', 'p'], ['Milwaukee Brady Street', 'Milwaukee', 'WI', 'p'], ['Madison State Street', 'Madison', 'WI', 'p'],
          ['Naperville Ogden', 'Naperville', 'IL', 'd'], ['Schaumburg Golf Road', 'Schaumburg', 'IL', 'd'], ['Joliet Jefferson', 'Joliet', 'IL', 'd'],
          ['Peoria War Memorial', 'Peoria', 'IL', 'd'], ['Green Bay Oneida', 'Green Bay', 'WI', 'd'], ['Kenosha Green Bay Road', 'Kenosha', 'WI', 'd']
        ] },
      { id: 'OP-MW-03', name: 'Samir Haddad', region: 'Midwest', years: 8, fill: 0.961, prep: { d: 83 },
        stores: [
          ['St. Louis Soulard', 'St. Louis', 'MO', 'x'], ['Kansas City Westport', 'Kansas City', 'MO', 'x'],
          ['St. Louis Chesterfield', 'St. Louis', 'MO', 'd'], ['Kansas City Overland Park', 'Overland Park', 'KS', 'd'], ['Des Moines Merle Hay', 'Des Moines', 'IA', 'd'],
          ['Omaha Dodge', 'Omaha', 'NE', 'd'], ['Minneapolis Uptown', 'Minneapolis', 'MN', 'd'], ['St. Paul Grand Avenue', 'St. Paul', 'MN', 'd']
        ] },
      { id: 'OP-W-01', name: 'Grace Nakamura', region: 'West', years: 12, fill: 0.964, prep: { x: 79, d: 81 },
        stores: [
          ['San Francisco Mission', 'San Francisco', 'CA', 'x'], ['Oakland Temescal', 'Oakland', 'CA', 'x'],
          ['San Jose Almaden', 'San Jose', 'CA', 'd'], ['Sacramento Arden', 'Sacramento', 'CA', 'd'], ['Fresno Blackstone', 'Fresno', 'CA', 'd'],
          ['Los Angeles Koreatown', 'Los Angeles', 'CA', 'd'], ['Los Angeles Westwood', 'Los Angeles', 'CA', 'd'], ['Long Beach Bixby', 'Long Beach', 'CA', 'd'],
          ['Anaheim Katella', 'Anaheim', 'CA', 'd'], ['San Diego Mission Valley', 'San Diego', 'CA', 'd'], ['Riverside Magnolia', 'Riverside', 'CA', 'd'],
          ['Bakersfield Rosedale', 'Bakersfield', 'CA', 'd'], ['Reno Virginia Street', 'Reno', 'NV', 'd'], ['Las Vegas Summerlin', 'Las Vegas', 'NV', 'd'],
          ['Henderson Green Valley', 'Henderson', 'NV', 'd']
        ] },
      { id: 'OP-W-02', name: 'Luis Ortega', region: 'West', years: 5, fill: 0.962, prep: { d: 80 },
        stores: [
          ['Portland Hawthorne', 'Portland', 'OR', 'x'],
          ['Phoenix Camelback', 'Phoenix', 'AZ', 'd'], ['Tucson Speedway', 'Tucson', 'AZ', 'd'], ['Mesa Dobson', 'Mesa', 'AZ', 'd'], ['Denver Colfax', 'Denver', 'CO', 'd'],
          ['Aurora Havana', 'Aurora', 'CO', 'd'], ['Seattle Northgate', 'Seattle', 'WA', 'd'], ['Tacoma Sixth Avenue', 'Tacoma', 'WA', 'd'], ['Salem Lancaster', 'Salem', 'OR', 'd']
        ] }
    ],
    // Closed stores still sitting in the raw store table.
    closedStores: [
      ['Macon Riverside', 'Macon', 'GA', 'single_lane', 'OP-SE-02'], ['Erie Peach Street', 'Erie', 'PA', 'dual_lane', 'OP-NE-02'],
      ['Flint Miller Road', 'Flint', 'MI', 'single_lane', 'OP-MW-01'], ['Spokane Division', 'Spokane', 'WA', 'dual_lane', 'OP-W-02']
    ],
    spread: SPREAD,

    // ---- Menu -----------------------------------------------------------------
    menuLog: [
      ['2026-05-07', 'launch', 'McContext Double Stack', 'SKU-DS-001', 'high', true, 'ALL', 'National limited-time offer. Two-step prep: beef stack, then sauce layer.'],
      ['2026-05-09', 'ops_alert', 'McContext Double Stack', 'SKU-DS-001', 'high', true, 'Southeast', 'Single-lane stores reporting window-time blowouts (+47s at the worst). Pre-stage components in the 10am and 4pm pre-rush.'],
      ['2026-06-04', 'planned_launch', 'Honey Heat Chicken', 'SKU-HH-001', 'high', true, 'ALL', 'Limited-time offer. Two-step prep: fry, then sauce toss.'],
      ['2026-06-25', 'planned_launch', 'Peach Cobbler Shake', 'SKU-PC-001', 'low', false, 'ALL', 'Limited-time offer. Single-step, no kitchen change.']
    ],
    promoEvents: [
      ['2026-05-01', 'Spring radio flight', 'media', 'Southeast'],
      ['2026-05-04', 'App coupon push', 'coupon', 'ALL'],
      ['2026-05-07', 'Double Stack launch', 'product_launch', 'ALL']
    ],

    // ---- Combos: net revenue per day, network, [before launch, after] -----------
    combos: {
      'Classic Combo':     { sku: 'SKU-CB-001', price: 8.40,  net: [18900, 19500] },
      'Chicken Combo':     { sku: 'SKU-CB-002', price: 8.10,  net: [13400, 13900] },
      'Spicy Stack Combo': { sku: 'SKU-CB-003', price: 8.90,  net: [7900, 8450] },
      'BBQ Ranch Combo':   { sku: 'SKU-CB-004', price: 8.70,  net: [6200, 6460] },
      'Value Combo':       { sku: 'SKU-CB-005', price: 5.90,  net: [5810, 5930] },
      'Family Bundle':     { sku: 'SKU-CB-006', price: 21.50, net: [26600, 25270] }
    },
    comboShare: { Southeast: 22560 / 78810, Midwest: 26950 / 78810, Northeast: 14860 / 78810, West: 14440 / 78810 },
    comboDiscount: 0.04,
    doubleStack: {
      sku: 'SKU-DS-001', name: 'McContext Double Stack', netPrice: 5.53, launchDiscount: 0.12,
      netPerDay: { Southeast: 1640, Midwest: 1960, Northeast: 1080, West: 1050 }
    },

    // ---- Customer Support ----------------------------------------------------------
    care: {
      waitPer10k: 3.0, perSecOver: 0.55, tolerance: 5,   // wait-time complaints per 10,000 drive-thru orders
      otherPer10k: 7.2,                                   // every other kind of complaint, per 10,000 orders
      otherMix: [['order_accuracy', 38], ['food_quality', 27], ['staff', 15], ['app', 12], ['other', 8]],
      channels: [['app', 52], ['call_centre', 27], ['social', 21]],
      handleMinutes: [10, 12, 14, 11, 13],
      doubleStackProductComplaints: 9
    },

    // ---- Supply Chain ------------------------------------------------------------------
    supply: {
      centres: { Southeast: 'Atlanta DC', Midwest: 'Columbus DC', Northeast: 'Newark DC', West: 'Reno DC' },
      kit: { item: 'PPS-2 retrofit kit', onHand: { 'Atlanta DC': 5, 'Columbus DC': 4, 'Newark DC': 2, 'Reno DC': 1 }, leadDays: 21, installedCost: 18500 },
      sauce: {
        item: 'Stack Sauce', planMix: 22, targetCover: 4.0,
        cover: { Southeast: 2.1, Midwest: 3.6, Northeast: 4.4, West: 5.3 },   // days in stores on the last day
        cases: { 'Atlanta DC': 140, 'Columbus DC': 410, 'Newark DC': 330, 'Reno DC': 420 },
        weeklyCases: { Southeast: 310, Midwest: 370, Northeast: 205, West: 200 },
        nextDelivery: { 'Atlanta DC': '2026-05-19', 'Columbus DC': '2026-05-21', 'Newark DC': '2026-05-22', 'Reno DC': '2026-05-20' },
        ordersPerPouch: 40,
        stockoutHours: [6, 5, 5, 4, 4, 4, 3]   // seven Southeast stores over the first weekend
      },
      patty: { item: 'Beef Patty 4:1', cover: 5.2 }
    },

    // ---- Weather: rain by region and day (inches). Everything else is dry. ---------------
    rain: {
      Southeast: { '2026-04-03': 0.4, '2026-04-14': 0.3, '2026-04-25': 0.5 },
      Midwest:   { '2026-04-05': 0.3, '2026-04-18': 0.4, '2026-05-13': 0.1 },
      Northeast: { '2026-04-08': 0.5, '2026-04-21': 0.3, '2026-05-12': 0.6 },
      West:      { '2026-03-28': 0.2 }
    },
    temperature: { Southeast: [68, 78], Midwest: [52, 66], Northeast: [50, 64], West: [64, 74] } // mid-March, mid-May (°F)
  };
})(typeof window !== 'undefined' ? window : globalThis);
