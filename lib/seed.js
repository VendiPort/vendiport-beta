'use strict';
// Demo seed for extras.json. Everything created here carries demo:true so the UI/admin can label it.
const { keyOf, mulberry, setNameOf } = require('./util');

const DEFAULT_ZIPS = [
  '94102', '94103', '94105', '94107', '94108', '94109', '94110', '94111', '94112', '94114', '94115', '94116', '94117',
  '94118', '94121', '94122', '94123', '94124', '94127', '94131', '94132', '94133', '94134', '94158',
  '94601', '94606', '94607', '94609', '94610', '94612', '94618', '94704', '94705', '94707', '94709',
  '94301', '94303', '94401', '94403', '95110', '95112', '95126', '95128',
];

// [label, kind, productId|null, count]
const WANT = [
  ['Kenny Pickett RC', 'card', null, 14],
  ['Trevor Lawrence RC', 'card', null, 11],
  ['2022 Panini Mosaic Football', 'box', '2022-panini-mosaic-football', 9],
  ['Sauce Gardner RC', 'card', null, 8],
  ['Julio Rodríguez Chrome RC', 'card', null, 7],
  ['Patrick Mahomes Prizm RC', 'card', null, 7],
  ['Hulk Hogan Metal Auto', 'card', null, 6],
  ['Brock Purdy Mosaic RC', 'card', null, 6],
  ['Drake London RC', 'card', null, 5],
  ['Corbin Carroll RC', 'card', null, 5],
  ['2022 Topps Chrome Baseball', 'box', '2022-topps-chrome-baseball', 5],
  ['Caitlin Clark Topps Chrome', 'card', null, 4],
  ['Stone Cold Steve Austin', 'player', null, 4],
  ['Elly De La Cruz', 'player', null, 3],
  ['2021 Panini Contenders Football', 'box', '2021-panini-contenders-football', 3],
  ['Victor Wembanyama Prizm', 'card', null, 3],
];
const ZIP_IN = ['94107', '94110', '94117', '94121', '94607', '94612', '95112', '94114', '94131', '94704'];
const ZIP_OUT = ['98101', '98103', '97201', '78701', '10001', '60601', '85004'];

function seed() {
  const rnd = mulberry(20260930);
  const now = Date.now();
  const DAY = 864e5;
  const iso = (ms) => new Date(ms).toISOString();
  const state = {
    version: 1,
    seededAt: iso(now),
    radar: [],
    alerts: [],
    sms: [],
    buyers: {},
    iHave: [],
    breaks: [],
    disputes: [],
    ratings: [],
    events: [],
    searches: [],
    shopState: {},
    verification: {},
    demoStores: [],
    demo: {},
    payoutsPaid: [],
  };

  // ---- demand (anonymous radar entries) ----
  let n = 0;
  for (const [label, kind, productId, count] of WANT) {
    for (let i = 0; i < count; i++) {
      const outArea = rnd() < (productId ? 0.12 : 0.3);
      const zip = outArea ? ZIP_OUT[Math.floor(rnd() * ZIP_OUT.length)] : ZIP_IN[Math.floor(rnd() * ZIP_IN.length)];
      const age = Math.pow(rnd(), 1.7) * 30 * DAY; // skew recent => visible growth
      state.radar.push({
        id: 'rd_demo_' + (++n),
        buyer: 'demo_' + (n * 7919 % 997),
        kind,
        label,
        key: keyOf(label),
        productId,
        zip,
        source: rnd() < 0.5 ? 'chase' : 'search',
        createdAt: iso(now - age),
        demo: true,
      });
    }
  }

  // ---- demo stores (admin-only; the buyer UI never shows shop names) ----
  const stores = [
    ['ds_1', 'Card Cove', '94110', 'active', 14, 31, 2, 9, 11, 'verified'],
    ['ds_2', 'Gridiron Goods', '94607', 'active', 9, 22, 3, 6, 18, 'verified'],
    ['ds_3', 'Slab & Sleeve', '95112', 'paused', 11, 17, 1, 2, 42, 'verified'],
    ['ds_4', 'Rookie Row Collectibles', '94117', 'sold_out', 6, 0, 0, 4, 27, 'verified'],
    ['ds_5', 'Hobby Haven SF', '94121', 'active', 18, 44, 4, 11, 8, 'verified'],
  ];
  for (const [id, name, zip, status, skus, units, low, iHave, resp, ver] of stores) {
    state.demoStores.push({ id, name, zip, status, skus, units, lowStockSkus: low, iHaveCount: iHave, avgResponseMins: resp, verification: ver, demo: true });
  }
  const pending = [
    ['ds_p1', 'Bayside Breaks LLC', 'Marisol Vega', 'CA-RESALE-SR-DEMO-4471', '94601', 3],
    ['ds_p2', 'Peninsula Pull Co.', 'Dev Anand', 'CA-SELLERS-PERMIT-DEMO-9902', '94401', 1],
    ['ds_p3', 'Golden State Gems', 'Tyrone Banks', 'EIN-DEMO-88-1234567', '94704', 6],
  ];
  for (const [id, name, owner, bizId, zip, ago] of pending) {
    state.verification[id] = {
      id, name, owner, bizId, zip, demo: true, status: 'pending',
      submittedAt: iso(now - ago * DAY), docs: ['Business license (demo scan)', 'Storefront photo (demo)'],
    };
  }

  // ---- demo disputes ----
  state.disputes.push({
    id: 'dp_demo_1', demo: true, orderId: 'demo-order-1001', last4: '1001', shopId: 'ds_2', shopName: 'Gridiron Goods',
    reason: 'seal_not_intact', note: 'Zip tie looks cut and the VOID label is peeled on one corner.',
    status: 'open', openedAt: iso(now - 3 * 3600e3),
    photos: [
      { label: 'Buyer door photo', url: '/img/products/2022-panini-mosaic-football.jpg' },
      { label: 'Shop sealed-box photo', url: '/img/products/2022-panini-score-football.jpg' },
    ],
    timestamps: [
      { label: 'Paid', at: iso(now - 7 * 3600e3) }, { label: 'Packed', at: iso(now - 6.2 * 3600e3) },
      { label: 'Ready', at: iso(now - 6 * 3600e3) }, { label: 'Out', at: iso(now - 4.1 * 3600e3) },
      { label: 'Arrived', at: iso(now - 3.2 * 3600e3) }, { label: 'Reported', at: iso(now - 3 * 3600e3) },
    ],
  });
  state.disputes.push({
    id: 'dp_demo_2', demo: true, orderId: 'demo-order-0987', last4: '0987', shopId: 'ds_1', shopName: 'Card Cove',
    reason: 'seal_not_intact', note: 'Tote opened — product looked repacked.', status: 'open', openedAt: iso(now - 26 * 3600e3),
    photos: [{ label: 'Buyer door photo', url: '/img/products/2022-topps-chrome-baseball.jpg' }],
    timestamps: [
      { label: 'Paid', at: iso(now - 31 * 3600e3) }, { label: 'Ready', at: iso(now - 29 * 3600e3) },
      { label: 'Out', at: iso(now - 27 * 3600e3) }, { label: 'Reported', at: iso(now - 26 * 3600e3) },
    ],
  });

  // ---- demo box breaks (gallery + content queue) ----
  const demoBreaks = [
    ['2022 Panini Mosaic Football', '2022-panini-mosaic-football', 'https://www.youtube.com/shorts/aBcDeFgH123', ['Kenny Pickett Mosaic RC'], 'Mosaic rip night — Pickett came through!', 'public', true, 'approved', 412, 38],
    ['2022 Panini Score Football', '2022-panini-score-football', 'https://www.tiktok.com/@collectorjay/video/7234567890123456789', ['Drake London RC'], 'Two Score blasters, one huge pull', 'public', true, 'pending', 268, 21],
    ['2022 Topps Chrome Baseball', '2022-topps-chrome-baseball', 'https://www.instagram.com/reel/Cx1yZ2aBcDe/', ['Julio Rodríguez Chrome RC'], 'Chrome refractor pulled on camera', 'public', true, 'approved', 355, 29],
    ['2021 Panini Contenders Football', '2021-panini-contenders-football', 'https://www.youtube.com/watch?v=Zx9Yw8Vu7Ts', ['Trevor Lawrence Ticket RC'], 'Ticket RC! Same-day delivery made it easy', 'public', false, 'none', 121, 7],
    ['leaf-metal-legends-wrestling', 'leaf-metal-legends-wrestling', 'https://x.com/hobbyking/status/1700000000000000000', ['Stone Cold Steve Austin'], 'Metal Legends opening', 'public', true, 'pending', 97, 11],
    ['2022 Panini Absolute Football', '2022-panini-absolute-football', 'https://www.twitch.tv/boxbreakbro/clip/CoolCrispyClipName', [], 'Hit-less, but the packaging was perfect', 'private', false, 'none', 12, 0],
  ];
  demoBreaks.forEach((b, i) => {
    state.breaks.push({
      id: 'br_demo_' + (i + 1), demo: true, buyer: 'demo_b' + i, orderId: 'demo-order-' + (2000 + i), lineId: 'line_demo',
      productId: b[1], boxTitle: b[0] === 'leaf-metal-legends-wrestling' ? 'Leaf Metal Legends Wrestling' : b[0],
      url: b[2], caption: b[4], hitsPulled: b[3].map((name) => ({ name })), photos: [], tags: [setNameOf(b[0])],
      visibility: b[5], consentMarketing: b[6], marketingStatus: b[7], moderation: 'ok',
      views: b[8], shares: b[9], createdAt: iso(now - (i + 1) * 1.3 * DAY),
    });
  });

  // ---- demo analytics blocks (always labelled DEMO in admin) ----
  const days = [];
  for (let d = 13; d >= 0; d--) {
    const orders = Math.round(3 + rnd() * 6 + (13 - d) * 0.25);
    const avg = 42 + rnd() * 10;
    days.push({ day: new Date(now - d * DAY).toISOString().slice(0, 10), orders, revenue: Math.round(orders * (avg + 10)) });
  }
  state.demo = {
    daily: days,
    membership: { newMembers: 23, active: 61, canceled: 4, freeMonthStarted: 31, freeMonthConverted: 19 },
    referrals: { signups: 17, firstPurchase: 9 },
    funnel: { browse: 940, select: 410, checkout: 188, paid: 121 },
    outOfArea: { visitors: 63, byZip: [['98101', 14], ['97201', 9], ['78701', 8], ['10001', 7], ['60601', 5], ['85004', 4]] },
    errors: { total: 9, byType: [['payment_stub_timeout', 4], ['image_upload_failed', 3], ['qr_decode_failed', 2]] },
    zeroSearches: [['panini prizm mahomes rookie', 11], ['bowman chrome 1st', 8], ['pokemon booster box', 7], ['wemby prizm silver', 5], ['topps now', 3]],
    fulfillment: { paidToPackedMins: 14, paidToReadyMins: 31, paidToDeliveredMins: 142, ordersLate: [['Slab & Sleeve', 4], ['Hobby Haven SF', 2], ['Card Cove', 1]], handoffFailed: 3, handoffRefused: 2 },
    cancelReasons: [['Changed my mind', 7], ['Found it elsewhere', 4], ['Ordered wrong box', 3], ['Delivery time too late', 3], ['Other', 1]],
    ratings: [['Card Cove', 4.8, 4.6, 22], ['Gridiron Goods', 4.5, 4.4, 17], ['Hobby Haven SF', 4.9, 4.7, 31], ['Slab & Sleeve', 3.9, 4.0, 9]],
    sealNotIntact: [['Gridiron Goods', 2], ['Card Cove', 1], ['Slab & Sleeve', 1]],
    payoutsOwed: [['Card Cove', 612.4], ['Gridiron Goods', 388.1], ['Hobby Haven SF', 904.75], ['Slab & Sleeve', 127.0]],
    refunds: { count: 6, amount: 241.5, orders: 121 },
    fastestResponders: [['Hobby Haven SF', 8], ['Gridiron Goods', 18], ['Rookie Row Collectibles', 27], ['Slab & Sleeve', 42]],
    radarAlertsSent: 148,
    radarConverted: 37,
  };
  return state;
}

module.exports = { seed, DEFAULT_ZIPS };
