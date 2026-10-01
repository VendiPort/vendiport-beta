'use strict';
/** 20-store DEMO / projected network model. Every figure derives from the ASSUMPTIONS object below
 *  (deterministic — no randomness at request time), so the admin "Assumptions" panel can trace each number. */
const { mulberry } = require('./util');

function build(takeRate, takeSource) {
  const A = {
    stores: 20,
    ordersPerStorePerDayMedian: 3.0, // median store
    standoutMultiple: 2.5,           // one store ≈ 2-3x median
    aov: 46,                          // average order value (product + delivery), USD
    takeRate,                         // VendiPort take on product sales
    takeSource,
    deliveryShareOfAov: 0.14,         // part of AOV that is delivery fee (pass-through, not in GMV take)
    members: 190, membershipPrice: 1.99,
    ramp: [0.55, 0.7, 0.85, 1], rampNote: 'Weeks 1-4 of a store’s life ramp to 55% / 70% / 85% / 100% of steady state; the demo shows steady state (week 5+).',
    fillRatePct: [84, 96], sameDayPct: 94.5, disputeRatePct: 1.4,
    daysPerWeek: 7, weeksPerMonth: 4.33,
  };
  const rnd = mulberry(20261001);
  // [name, neighborhood, zip, size factor vs median]
  const raw = [
    ['Mission Card Co.', 'Mission', '94110', 1.0], ['Castro Cardboard', 'Castro', '94114', 0.8], ['SoMa Slabs', 'SoMa', '94103', 1.15],
    ['Richmond Rip Shop', 'Richmond', '94121', 0.9], ['Sunset Sports Cards', 'Sunset', '94122', 0.7], ['Marina Mint', 'Marina', '94123', 0.85],
    ['Haight Hobby', 'Haight-Ashbury', '94117', 1.1], ['Nob Hill Packs', 'Nob Hill', '94109', 0.65], ['Potrero Pulls', 'Potrero Hill', '94107', 0.95],
    ['Bernal Breaks', 'Bernal Heights', '94110', 0.75], ['Noe Valley Wax', 'Noe Valley', '94114', 1.05], ['Excelsior Cards', 'Excelsior', '94112', 0.6],
    ['Oakland Lake Cards', 'Lake Merritt (Oakland)', '94612', 1.2], ['Temescal Trading', 'Temescal (Oakland)', '94609', 0.9], ['Berkeley Boxes', 'Berkeley', '94704', 0.8],
    ['Daly City Dugout', 'Daly City', '94014', 0.55], ['San Mateo Stack', 'San Mateo', '94401', 1.0], ['Palo Alto Prizm', 'Palo Alto', '94301', 0.85],
    ['San Jose Slab House', 'San Jose', '95112', 1.1], ['Bayview Ballpark Cards', 'Bayview', '94124', 0.7],
  ];
  const median = A.ordersPerStorePerDayMedian;
  const stores = raw.map(([name, hood, zip, f], i) => {
    const jitter = 1 + (rnd() - 0.5) * 0.08;
    let perDay = median * f * jitter;
    return { id: 'n20_' + (i + 1), name, neighborhood: hood, zip, perDay };
  });
  // make one store the realistic standout: ~2.5x the median of the final set
  const sorted = stores.map((s) => s.perDay).sort((a, b) => a - b);
  const med0 = (sorted[9] + sorted[10]) / 2;
  const top = stores.reduce((a, b) => (b.perDay > a.perDay ? b : a));
  top.perDay = +(med0 * A.standoutMultiple).toFixed(2);
  top.standout = true;
  for (const s of stores) {
    s.perDay = +s.perDay.toFixed(2);
    s.ordersWeek = Math.round(s.perDay * A.daysPerWeek);
    s.gmvWeek = Math.round(s.ordersWeek * A.aov * (1 - A.deliveryShareOfAov));
    s.take = +(s.gmvWeek * A.takeRate).toFixed(2);
    s.payout = +(s.gmvWeek - s.take).toFixed(2);
    s.fillRate = Math.round(A.fillRatePct[0] + (A.fillRatePct[1] - A.fillRatePct[0]) * (0.25 + 0.75 * rnd()));
    s.demo = true;
  }
  stores.sort((a, b) => b.ordersWeek - a.ordersWeek);
  const ordersWeek = stores.reduce((a, s) => a + s.ordersWeek, 0);
  const gmvWeek = stores.reduce((a, s) => a + s.gmvWeek, 0);
  const takeWeek = +(gmvWeek * A.takeRate).toFixed(2);
  const memberWeek = +(A.members * A.membershipPrice * 12 / 52).toFixed(2);
  const ws = stores.map((s) => s.ordersWeek).sort((a, b) => a - b);
  const medianWeek = (ws[9] + ws[10]) / 2;
  const byZip = {};
  for (const s of stores) { const z = (byZip[s.zip] = byZip[s.zip] || { zip: s.zip, hood: s.neighborhood, stores: 0, ordersWeek: 0 }); z.stores++; z.ordersWeek += s.ordersWeek; }
  const heat = Object.values(byZip).sort((a, b) => b.ordersWeek - a.ordersWeek);
  const maxZ = heat[0].ordersWeek;
  heat.forEach((z) => { z.pct = Math.round((z.ordersWeek / maxZ) * 100); });
  const rollup = {
    ordersPerDay: +(ordersWeek / 7).toFixed(1), ordersWeek,
    gmvWeek, gmvMonth: Math.round(gmvWeek * A.weeksPerMonth),
    takeWeek, takeMonth: Math.round(takeWeek * A.weeksPerMonth),
    membershipMonth: +(A.members * A.membershipPrice).toFixed(2),
    revenueWeek: +(takeWeek + memberWeek).toFixed(2),
    revenueMonth: Math.round(takeWeek * A.weeksPerMonth + A.members * A.membershipPrice),
    aov: A.aov, sameDayPct: A.sameDayPct, disputeRatePct: A.disputeRatePct,
    fillRatePct: Math.round(stores.reduce((a, s) => a + s.fillRate, 0) / stores.length),
    medianOrdersWeek: medianWeek, topOrdersWeek: stores[0].ordersWeek, topMultiple: +(stores[0].ordersWeek / medianWeek).toFixed(1),
    payoutWeek: +stores.reduce((a, s) => a + s.payout, 0).toFixed(2),
  };
  return { label: 'DEMO / projected', assumptions: A, stores, rollup, heat };
}
module.exports = { build };
