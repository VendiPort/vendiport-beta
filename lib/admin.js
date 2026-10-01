'use strict';
/** Owner /admin API — passcode via ADMIN_PASSCODE (default dev value). Real numbers from JSON state; seeded numbers labelled demo. */
const U = require('./util');

const DEV_PASSCODE = 'vendiport-admin-dev';

function createAdmin(ctx, X) {
  const { readJson, send, sendError, readBody, findOrder, saveOrder, publicOrder } = ctx;
  const passcode = () => process.env.ADMIN_PASSCODE || DEV_PASSCODE;
  const now = () => new Date().toISOString();
  const S = () => X.S();
  const DAY = 864e5;

  function authed(req) {
    const h = String(req.headers['x-admin-passcode'] || '');
    return h && h === passcode();
  }
  const sumBy = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
  const round = (n, d = 2) => +Number(n || 0).toFixed(d);
  const mins = (a, b) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 60000) : null);
  const avg = (arr) => { const v = arr.filter((x) => x != null && x >= 0); return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null; };
  const tl = (o, k) => ((o.timeline || []).find((t) => t.key === k) || {}).at || null;

  function isLate(o) {
    if (['DELIVERED_ACCEPTED', 'CANCELLED', 'REFUSED_SEAL', 'DRAFT'].includes(o.status)) return false;
    return X.parseWindowEnd(o.windowLabel, o.createdAt) < Date.now();
  }

  function overview() {
    const orders = readJson('orders.json', []).filter((o) => o.status !== 'DRAFT');
    const st = S();
    const demo = st.demo;
    const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
    const today = orders.filter((o) => Date.parse(o.createdAt) >= startToday.getTime());
    const late = orders.filter(isLate);
    const cancelled = orders.filter((o) => o.status === 'CANCELLED');
    const refused = orders.filter((o) => o.status === 'REFUSED_SEAL');
    const refunded = cancelled.length + refused.length;
    const paidish = orders.length;
    const delivered = orders.filter((o) => o.status === 'DELIVERED_ACCEPTED');
    const verification = Object.values(st.verification);
    const pending = verification.filter((v) => v.status === 'pending');
    const openDisputes = st.disputes.filter((d) => d.status === 'open');

    // -------- Demand
    const wanted = X.aggregateWanted();
    const products = readJson('products.json', []);
    const zipDemand = {};
    for (const e of st.radar) if (e.zip) zipDemand[e.zip] = (zipDemand[e.zip] || 0) + 1;
    const stores = realAndDemoStores();
    const storesByZip = {};
    for (const s of stores) if (s.zip && s.status === 'active') storesByZip[s.zip] = (storesByZip[s.zip] || 0) + 1;
    const zipRows = Object.entries(zipDemand).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([zip, n]) => ({
      zip, buyers: n, activeStores: storesByZip[zip] || 0, inServiceArea: X.SERVICE_ZIPS.has(zip),
    }));
    const recruit = zipRows.filter((z) => z.activeStores === 0).slice(0, 6);
    const radarEntries = st.radar.length;
    const alertsReal = st.alerts.length;
    const realZero = {};
    for (const s of st.searches) realZero[s.q.toLowerCase()] = (realZero[s.q.toLowerCase()] || 0) + 1;
    const zeroSearches = Object.entries(realZero).map(([q, n]) => ({ q, n, demo: false }))
      .concat((demo.zeroSearches || []).map(([q, n]) => ({ q, n, demo: true }))).sort((a, b) => b.n - a.n).slice(0, 8);
    const radarBuyers = new Set(st.radar.filter((e) => !e.demo).map((e) => e.buyer));
    const radarOrders = new Set(orders.filter((o) => o.buyerId && radarBuyers.has(o.buyerId)).map((o) => o.buyerId));
    const demand = {
      top: wanted.slice(0, 8).map((w) => ({ label: w.label, kind: w.kind, buyers: w.buyers, growth7d: w.growth7d, prev7d: w.prev7d, growthPct: w.prev7d ? Math.round(((w.growth7d - w.prev7d) / w.prev7d) * 100) : (w.growth7d ? 100 : 0), demo: w.demo })),
      byZip: zipRows, recruit,
      conversion: {
        realRadarBuyers: radarBuyers.size, realConverted: radarOrders.size,
        demoRadarAlertsSent: demo.radarAlertsSent || 0, demoConverted: demo.radarConverted || 0,
        demoRatePct: demo.radarAlertsSent ? Math.round((demo.radarConverted / demo.radarAlertsSent) * 100) : 0,
      },
      zeroSearches, totalRadarEntries: radarEntries, realAlertsQueued: alertsReal,
    };

    // -------- Sales & money
    const realDaily = {};
    for (const o of orders.filter((x) => ['PAID', 'PACKING', 'READY', 'PICKED_UP', 'DELIVERED_ACCEPTED'].includes(x.status))) {
      const d = U.isoDay(o.paidAt || o.createdAt);
      realDaily[d] = realDaily[d] || { day: d, orders: 0, revenue: 0 };
      realDaily[d].orders++; realDaily[d].revenue += Number(o.total || 0);
    }
    const realDays = Object.values(realDaily).sort((a, b) => a.day.localeCompare(b.day)).map((r) => ({ ...r, revenue: round(r.revenue) }));
    const last7 = (demo.daily || []).slice(-7);
    const prev7 = (demo.daily || []).slice(-14, -7);
    const realRevenue = sumBy(realDays, (r) => r.revenue);
    const goodOrders = orders.filter((o) => ['PAID', 'PACKING', 'READY', 'PICKED_UP', 'DELIVERED_ACCEPTED'].includes(o.status));
    const gmv = sumBy(goodOrders, (o) => Number(o.productPrice || 0));
    const owed = {};
    for (const o of delivered) owed[o.shopId] = (owed[o.shopId] || 0) + Number(o.productPrice || 0) * (1 - X.PLATFORM_TAKE);
    const sales = {
      real: { orders: goodOrders.length, revenue: round(realRevenue), avgOrder: goodOrders.length ? round(realRevenue / goodOrders.length) : 0, takeRatePct: 15, platformTake: round(gmv * X.PLATFORM_TAKE), daily: realDays.slice(-7) },
      demo: {
        daily: last7, weekOrders: sumBy(last7, (r) => r.orders), weekRevenue: sumBy(last7, (r) => r.revenue), prevWeekRevenue: sumBy(prev7, (r) => r.revenue),
        avgOrder: last7.length ? round(sumBy(last7, (r) => r.revenue) / Math.max(1, sumBy(last7, (r) => r.orders))) : 0,
        membership: demo.membership, referrals: demo.referrals,
        freeMonthConversionPct: demo.membership ? Math.round((demo.membership.freeMonthConverted / demo.membership.freeMonthStarted) * 100) : 0,
        referralConversionPct: demo.referrals ? Math.round((demo.referrals.firstPurchase / demo.referrals.signups) * 100) : 0,
        payoutsOwed: demo.payoutsOwed, refunds: demo.refunds,
      },
      realPayoutsOwed: Object.entries(owed).map(([id, v]) => ({ shop: X.shopName(id), owed: round(v) })),
      realRefunds: { count: refunded, amount: round(sumBy(cancelled.concat(refused), (o) => Number((o.refundStub && (o.refundStub.amount || o.refundStub.productRefund)) || 0))) },
    };

    // -------- Fulfillment
    const p2pack = orders.map((o) => mins(tl(o, 'paid'), tl(o, 'packing')));
    const p2ready = orders.map((o) => mins(tl(o, 'paid'), tl(o, 'ready')));
    const p2del = delivered.map((o) => mins(tl(o, 'paid'), tl(o, 'delivered')));
    const lateByStore = {};
    for (const o of late) { const n = X.shopName(o.shopId); lateByStore[n] = (lateByStore[n] || 0) + 1; }
    const cancelReasons = {};
    for (const o of cancelled) { const r = o.cancelReason || 'No reason given'; cancelReasons[r] = (cancelReasons[r] || 0) + 1; }
    const fulfillment = {
      real: { paidToPackedMins: avg(p2pack), paidToReadyMins: avg(p2ready), paidToDeliveredMins: avg(p2del), lateNow: late.length, lateByStore: Object.entries(lateByStore), cancelRatePct: paidish ? round((cancelled.length / paidish) * 100, 1) : 0, refundRatePct: paidish ? round((refunded / paidish) * 100, 1) : 0, cancelReasons: Object.entries(cancelReasons), refused: refused.length, sampleSize: paidish },
      demo: { ...(demo.fulfillment || {}), cancelReasons: demo.cancelReasons || [] },
    };

    // -------- Trust & safety
    const sealByStore = {};
    for (const d of st.disputes.filter((x) => x.reason === 'seal_not_intact' && !x.demo)) sealByStore[d.shopName] = (sealByStore[d.shopName] || 0) + 1;
    const rByShop = {};
    for (const r of st.ratings) { const n = X.shopName(r.shopId); const a = (rByShop[n] = rByShop[n] || { shop: 0, delivery: 0, n: 0 }); a.shop += r.shop; a.delivery += r.delivery; a.n++; }
    const trust = {
      real: { sealByStore: Object.entries(sealByStore), ratings: Object.entries(rByShop).map(([n, a]) => ({ store: n, shop: round(a.shop / a.n, 1), delivery: round(a.delivery / a.n, 1), n: a.n })) },
      demo: { sealNotIntact: demo.sealNotIntact, ratings: (demo.ratings || []).map(([store, shop, delivery, n]) => ({ store, shop, delivery, n })) },
      openDisputes: openDisputes.length, pendingVerification: pending.length,
    };

    // -------- Stores
    const activeStores = stores.filter((s) => s.status === 'active').length;
    const pausedStores = stores.filter((s) => s.status === 'paused').length;
    const soldOutStores = stores.filter((s) => s.status === 'sold_out').length;
    const live = products.filter((p) => !p.hidden);
    const iHaveReal = st.iHave;
    const responders = {};
    for (const h of iHaveReal) { const n = X.shopName(h.shopId); (responders[n] = responders[n] || []).push(h.respondedAfterMins || 0); }
    const storesSec = {
      list: stores,
      counts: { active: activeStores, paused: pausedStores, soldOut: soldOutStores },
      inventory: { skusLive: live.length, units: sumBy(live, (p) => U.totalUnits(p)), lowStock: live.filter((p) => X.stockInfo(p).low).length, soldOutSkus: products.filter((p) => X.stockInfo(p).soldOut).length },
      iHaveUsage: { real: iHaveReal.length, demo: sumBy((S().demoStores || []), (s) => s.iHaveCount || 0) },
      fastest: { real: Object.entries(responders).map(([n, a]) => ({ store: n, mins: avg(a) })), demo: (demo.fastestResponders || []).map(([store, m]) => ({ store, mins: m })) },
    };

    // -------- Product health
    const ev = st.events;
    const c = (t) => ev.filter((e) => e.type === t).length;
    const outVis = ev.filter((e) => e.type === 'area_check' && e.inArea === false);
    const outZip = {};
    for (const e of outVis) outZip[e.zip] = (outZip[e.zip] || 0) + 1;
    const errs = {};
    for (const e of ev.filter((x) => x.type === 'error')) errs[e.detail || 'error'] = (errs[e.detail || 'error'] || 0) + 1;
    const f = { browse: c('browse'), select: c('select'), checkout: c('checkout'), paid: c('paid') };
    const product = {
      real: { funnel: f, outOfAreaVisitors: outVis.length, outOfAreaByZip: Object.entries(outZip).sort((a, b) => b[1] - a[1]).slice(0, 6), errors: Object.entries(errs), errorTotal: sumBy(Object.values(errs), (x) => x) },
      demo: { funnel: demo.funnel, outOfArea: demo.outOfArea, errors: demo.errors },
    };

    return {
      generatedAt: now(),
      passcodeIsDefault: !process.env.ADMIN_PASSCODE,
      dashboard: {
        ordersToday: today.length, lateOrders: late.length, refundRatePct: paidish ? round((refunded / paidish) * 100, 1) : 0, refunded, ordersTotal: paidish,
        awaitingVerification: pending.length, openDisputes: openDisputes.length,
        pendingMarketing: S().breaks.filter((b) => b.marketingStatus === 'pending').length,
        lateList: late.slice(0, 8).map((o) => ({ id: o.id, last4: String(o.id).slice(-4).toUpperCase(), window: o.windowLabel, status: o.status, title: o.productTitle })),
      },
      demand, sales, fulfillment, trust, stores: storesSec, product,
    };
  }

  function realAndDemoStores() {
    const out = [];
    const sh = X.primaryShop();
    const products = readJson('products.json', []);
    if (sh) {
      const ss = X.shopState(sh.id);
      const live = products.filter((p) => !p.hidden);
      const units = sumBy(live, (p) => U.totalUnits(p));
      out.push({ id: sh.id, name: sh.name, zip: sh.zip || '94110', status: ss.paused ? 'paused' : units <= 0 ? 'sold_out' : 'active', skus: live.length, units, lowStockSkus: live.filter((p) => X.stockInfo(p).low).length, iHaveCount: S().iHave.filter((h) => h.shopId === sh.id).length, verification: (S().verification[sh.id] || {}).status || 'verified', demo: false });
    }
    for (const d of S().demoStores) out.push(d);
    return out;
  }

  function disputesList() {
    return S().disputes.slice().sort((a, b) => b.openedAt.localeCompare(a.openedAt)).map(X.disputeView);
  }

  function breaksList() {
    return S().breaks.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((b) => ({ ...X.breakPublic(b, true), buyerRef: String(b.buyer || '').slice(-4), shares: b.shares || 0, views: b.views || 0 }));
  }

  async function handle(req, res, pathname) {
    if (!pathname.startsWith('/api/admin')) return false;
    const method = req.method.toUpperCase();
    if (pathname === '/api/admin/login' && method === 'POST') {
      const body = await readBody(req);
      if (String(body.passcode || '') !== passcode()) return sendError(res, 401, 'Wrong passcode'), true;
      return send(res, 200, { ok: true, defaultPasscode: !process.env.ADMIN_PASSCODE }), true;
    }
    if (!authed(req)) return sendError(res, 401, 'Admin passcode required'), true;
    let m;
    if (pathname === '/api/admin/overview' && method === 'GET') return send(res, 200, overview()), true;
    if (pathname === '/api/admin/disputes' && method === 'GET') return send(res, 200, { disputes: disputesList() }), true;
    if ((m = pathname.match(/^\/api\/admin\/disputes\/([\w-]+)\/resolve$/)) && method === 'POST') {
      const body = await readBody(req);
      const d = S().disputes.find((x) => x.id === m[1]);
      if (!d) return sendError(res, 404, 'Dispute not found'), true;
      const outcome = ['refund', 'dismiss', 'replace'].includes(body.outcome) ? body.outcome : 'dismiss';
      d.status = 'resolved'; d.outcome = outcome; d.resolvedAt = now(); d.resolutionNote = String(body.note || '').slice(0, 300);
      if (outcome === 'refund' && !d.demo) {
        const o = findOrder(d.orderId);
        if (o && o.status !== 'REFUSED_SEAL') {
          if (o.status !== 'DELIVERED_ACCEPTED') o.status = 'REFUSED_SEAL';
          o.refundStub = { amount: o.total, fee: 0, note: 'Full refund — dispute resolved for buyer (stub).' };
          o.refusedAt = now(); o.updatedAt = o.refusedAt;
          saveOrder(o);
        }
      }
      X.store.save();
      return send(res, 200, { dispute: d }), true;
    }
    if (pathname === '/api/admin/verification' && method === 'GET') {
      const list = Object.values(S().verification).sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
      return send(res, 200, { verification: list }), true;
    }
    if ((m = pathname.match(/^\/api\/admin\/verification\/([\w-]+)\/(approve|reject)$/)) && method === 'POST') {
      const v = S().verification[m[1]];
      if (!v) return sendError(res, 404, 'Not found'), true;
      v.status = m[2] === 'approve' ? 'approved' : 'rejected';
      v.decidedAt = now();
      X.store.save();
      return send(res, 200, { verification: v }), true;
    }
    if (pathname === '/api/admin/breaks' && method === 'GET') {
      const list = breaksList();
      const top = list.slice().sort((a, b) => (b.views + b.shares * 4) - (a.views + a.shares * 4)).slice(0, 5).map((b) => ({ id: b.id, boxTitle: b.boxTitle, views: b.views, shares: b.shares, platform: b.platform && b.platform.label, score: b.views + b.shares * 4 }));
      return send(res, 200, { breaks: list, top }), true;
    }
    if ((m = pathname.match(/^\/api\/admin\/breaks\/(br_\w+)\/(moderate|marketing|download)$/))) {
      const b = S().breaks.find((x) => x.id === m[1]);
      if (!b) return sendError(res, 404, 'Break not found'), true;
      if (m[2] === 'download' && method === 'GET') {
        const pub = X.breakPublic(b, true);
        const pkg = { id: b.id, box: b.boxTitle, caption: b.caption, hitsPulled: b.hitsPulled, link: pub.platform && pub.platform.url, platform: pub.platform && pub.platform.label, photos: b.photos, consentMarketing: !!b.consentMarketing, marketingStatus: b.marketingStatus, shareCard: `/api/breaks/${b.id}/card.svg?buyer=${encodeURIComponent(b.buyer || '')}`, watermark: 'VendiPort · same-day sealed boxes', exportedAt: now(), note: 'Marketing package stub — original clip stays on the buyer’s social platform; link back + credit buyer.' };
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="vendiport-break-${b.id}.json"`, 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify(pkg, null, 2)), true;
      }
      if (method === 'POST') {
        const body = await readBody(req);
        if (m[2] === 'moderate') { b.moderation = body.action === 'hide' ? 'hidden' : 'ok'; }
        if (m[2] === 'marketing') {
          if (!b.consentMarketing) return sendError(res, 409, 'Buyer has not consented to marketing use'), true;
          b.marketingStatus = body.action === 'approve' ? 'approved' : 'rejected';
        }
        X.store.save();
        return send(res, 200, { break: breaksList().find((x) => x.id === b.id) }), true;
      }
    }
    if (pathname === '/api/admin/reset-demo' && method === 'POST') { X.store.reset(); return send(res, 200, { ok: true }), true; }
    return sendError(res, 404, 'Admin route not found'), true;
  }
  return { handle, overview };
}
module.exports = { createAdmin, DEV_PASSCODE };
