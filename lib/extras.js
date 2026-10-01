'use strict';
/**
 * VendiPort beta extras: JSON-backed stubs layered on the existing order state machine.
 * Buyer: order timeline + simulated texts, delivery code, Radar (hits alerts), area check,
 *        cancel reasons, accept-or-refuse + claims, ratings, My Collection + box breaks (social links).
 * Shop:  stock flags, packing checklist, earnings, pause, Wanted feed ("I have this").
 * No real SMS / payments anywhere.
 */
const fs = require('fs');
const path = require('path');
const U = require('./util');
const { createStore } = require('./store');
const { DEFAULT_ZIPS } = require('./seed');
const { createDisputes } = require('./disputes');

const LOW_STOCK = 2;
const PLATFORM_TAKE = 0.15;
const SERVICE_ZIPS = new Set(
  (process.env.SERVICE_ZIPS ? process.env.SERVICE_ZIPS.split(/[\s,]+/) : DEFAULT_ZIPS).map(U.zip5).filter(Boolean)
);
const TIMELINE_TEXT = {
  paid: 'Paid — your order is locked in and the shop has been alerted.',
  packing: 'Packing — the shop photographed your box on the bag QR and is sealing it.',
  ready: 'Ready — sealed bag photographed and waiting for pickup.',
  out: 'Out — your tote is on its way.',
  arrived: 'Arrived — meet the courier at the door. Read them your delivery code.',
  delivered: 'Delivered — accepted at the door. Enjoy the rip!',
  cancelled: 'Cancelled — refund is on its way.',
  refused: 'Refused at the door — full refund issued.',
};
const TIMELINE_STEPS = ['paid', 'packing', 'ready', 'out'];
const CHECKLIST_ITEMS = [
  { id: 'item', label: 'Right sealed box pulled (matches order)' },
  { id: 'factory', label: 'Factory wrap intact — no tears or resealing' },
  { id: 'tote', label: 'Photo 1 done · product on the bag QR, QR visible' },
  { id: 'zip', label: 'Bag pressed shut · peel-and-seal strip fully sealed · QR-in-V visible' },
];

function createExtras(ctx) {
  const { readJson, writeJson, send, sendError, readBody, findOrder, saveOrder, findProduct, publicOrder, PUBLIC, DATA_DIR } = ctx;
  const store = createStore(DATA_DIR);
  const S = () => store.get();
  const now = () => new Date().toISOString();

  function readMultiBody(req) { return readBody(req); }

  function saveDataImage(subdir, base, dataUrl) {
    if (!dataUrl) return null;
    const m = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i.exec(String(dataUrl));
    if (!m) return null;
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length || buf.length > 6 * 1024 * 1024) return null;
    const ext = m[1].toLowerCase() === 'png' ? '.png' : m[1].toLowerCase() === 'webp' ? '.webp' : '.jpg';
    const dir = path.join(PUBLIC, 'img', subdir);
    fs.mkdirSync(dir, { recursive: true });
    const fname = `${base}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}${ext}`;
    fs.writeFileSync(path.join(dir, fname), buf);
    return `/img/${subdir}/${fname}`;
  }

  const shops = () => readJson('shops.json', []);
  const primaryShop = () => shops()[0] || null;
  const shopName = (id) => {
    const s = shops().find((x) => x.id === id);
    if (s) return s.name;
    const d = S().demoStores.find((x) => x.id === id);
    return d ? d.name : id || 'Shop';
  };
  const shopState = (id) => {
    const st = S().shopState;
    if (!st[id]) st[id] = { paused: false };
    return st[id];
  };
  const anyShopPaused = () => {
    const sh = primaryShop();
    return !!(sh && shopState(sh.id).paused);
  };

  // ---------------- stock / products ----------------
  function stockInfo(p) {
    const total = U.totalUnits(p);
    return { total, low: total > 0 && total <= LOW_STOCK, soldOut: total <= 0 };
  }
  /** Buyer catalog filter: hidden, sold out (0 stock) and paused-shop SKUs never show. */
  function buyerVisible(p) {
    if (p.hidden) return false;
    if (anyShopPaused()) return false;
    return U.totalUnits(p) > 0;
  }
  function hitsPulledMap() {
    const map = {};
    for (const b of S().breaks) {
      if (b.moderation === 'hidden') continue;
      for (const h of b.hitsPulled || []) {
        const k = b.productId + '::' + U.keyOf(h.name);
        map[k] = (map[k] || 0) + 1;
      }
    }
    return map;
  }
  function decorateProduct(out, p, scope) {
    const hp = hitsPulledMap();
    out.chaseTop3 = (out.chaseTop3 || []).map((c) => Object.assign({}, c, { pulled: hp[p.id + '::' + U.keyOf(c.name)] || 0 }));
    out.stock = stockInfo(p);
    if (scope === 'shop') {
      const wanted = aggregateWanted();
      const hit = wanted.filter((w) => U.matchesProduct({ kind: w.kind, label: w.label, productId: w.productId }, p));
      out.wantedBuyers = hit.reduce((s, w) => Math.max(s, w.buyers), 0);
      out.wantedLabels = hit.slice(0, 3).map((w) => w.label);
    }
    return out;
  }

  // ---------------- buyers / area ----------------
  function buyerId(req, body, url) {
    return String((body && (body.buyer || body.buyerId)) || req.headers['x-buyer-id'] || (url && url.searchParams.get('buyer')) || '').slice(0, 64);
  }
  function profile(id) {
    const b = S().buyers;
    if (!b[id]) b[id] = { id, createdAt: now() };
    return b[id];
  }
  const maskPhone = (p) => (p ? '•••-•••-' + String(p).replace(/\D/g, '').slice(-4) : '');
  function areaCheck(zipRaw) {
    const zip = U.zip5(zipRaw);
    if (!zip) return { zip: '', valid: false, inArea: false, message: 'Enter a 5-digit ZIP to check same-day delivery.' };
    const inArea = SERVICE_ZIPS.has(zip);
    return {
      zip, valid: true, inArea, sameDay: inArea,
      message: inArea
        ? 'Same-day delivery is available in your area.'
        : 'Same-day isn’t in your area yet — this beta is ship-only for your ZIP (coming soon). Add cards to your Radar and we’ll text you when we open nearby.',
    };
  }

  // ---------------- radar / wanted ----------------
  function matchProductsForEntry(e) {
    return readJson('products.json', []).filter((p) => U.matchesProduct(e, p));
  }
  function aggregateWanted() {
    const groups = {};
    const t = Date.now();
    for (const e of S().radar) {
      const g = groups[e.key] || (groups[e.key] = { key: e.key, labels: {}, kind: e.kind, productId: e.productId || null, buyersSet: new Set(), zips: {}, last7: 0, prev7: 0, demo: true, firstAt: e.createdAt });
      g.labels[e.label] = (g.labels[e.label] || 0) + 1;
      g.buyersSet.add(e.buyer);
      if (e.zip) g.zips[e.zip] = (g.zips[e.zip] || 0) + 1;
      const age = t - Date.parse(e.createdAt);
      if (age <= 7 * 864e5) g.last7++;
      else if (age <= 14 * 864e5) g.prev7++;
      if (!e.demo) g.demo = false;
      if (e.createdAt < g.firstAt) g.firstAt = e.createdAt;
      if (e.kind === 'box') g.kind = 'box';
      if (e.productId) g.productId = e.productId;
    }
    const products = readJson('products.json', []);
    const have = S().iHave;
    return Object.values(groups).map((g) => {
      const label = Object.entries(g.labels).sort((a, b) => b[1] - a[1])[0][0];
      const entry = { kind: g.kind, label, productId: g.productId };
      const inStock = products.filter((p) => buyerVisibleRaw(p) && U.matchesProduct(entry, p));
      const zipRows = Object.entries(g.zips).sort((a, b) => b[1] - a[1]);
      const shown = zipRows.filter((z) => z[1] >= 2).slice(0, 4);
      const hidden = zipRows.length - shown.length;
      const mine = have.filter((h) => h.key === g.key).slice(-1)[0] || null;
      return {
        key: g.key, label, kind: g.kind, productId: g.productId,
        buyers: g.buyersSet.size, // anonymous count only
        zips: shown.map(([zip, n]) => ({ zip, n, inArea: SERVICE_ZIPS.has(zip) })),
        otherAreas: hidden,
        outOfAreaBuyers: zipRows.filter((z) => !SERVICE_ZIPS.has(z[0])).reduce((s, z) => s + z[1], 0),
        growth7d: g.last7, prev7d: g.prev7,
        listedNow: inStock.map((p) => ({ id: p.id, title: p.title, units: U.totalUnits(p) })),
        iHave: mine ? { status: mine.status, at: mine.at } : null,
        demo: g.demo,
      };
    }).sort((a, b) => b.buyers - a.buyers || b.growth7d - a.growth7d);
  }
  // visibility ignoring the shop pause flag (wanted counts should reflect stock the shop physically has)
  function buyerVisibleRaw(p) { return !p.hidden && U.totalUnits(p) > 0; }

  function queueAlert(buyer, type, text, extra) {
    const st = S();
    const a = Object.assign({ id: U.uid('al'), buyer, type, text, at: now(), read: false }, extra || {});
    st.alerts.push(a);
    const prof = st.buyers[buyer];
    if (prof && prof.notifyText && prof.phone) {
      st.sms.push({ id: U.uid('sms'), buyer, to: maskPhone(prof.phone), text: 'VendiPort: ' + text, at: now(), kind: a.type, simulated: true });
    }
    return a;
  }
  /** After any inventory change: alert radar followers when a matching item becomes available (transition). */
  function scanRadar() {
    const st = S();
    const products = readJson('products.json', []);
    const prevSet = new Set(st.inStockSnapshot || []);
    const first = !st.inStockSnapshot;
    const nowSet = new Set();
    let sent = 0;
    for (const p of products) {
      const vis = buyerVisibleRaw(p) && !anyShopPaused();
      if (vis) nowSet.add(p.id);
      if (!vis || first || prevSet.has(p.id)) continue;
      // newly listed / restocked
      for (const e of st.radar) {
        if (e.demo || !U.matchesProduct(e, p)) continue;
        if (e.zip && !SERVICE_ZIPS.has(e.zip)) continue;
        queueAlert(e.buyer, 'radar_match', `On your radar: ${e.label} — ${p.title} just got listed near you.`, { productId: p.id, radarId: e.id });
        sent++;
      }
    }
    // flagged "I have this" that now have inventory
    for (const h of st.iHave) {
      if (h.status !== 'flagged') continue;
      const entry = { kind: h.kind, label: h.label, productId: h.productId };
      const live = products.find((p) => buyerVisibleRaw(p) && U.matchesProduct(entry, p));
      if (live) { h.status = 'listed'; h.listedAt = now(); h.productId = live.id; sent += alertFollowers(h.key, live); }
    }
    st.inStockSnapshot = [...nowSet];
    store.save();
    return sent;
  }
  function alertFollowers(key, product) {
    let n = 0;
    const seen = new Set();
    for (const e of S().radar) {
      if (e.key !== key || e.demo || seen.has(e.buyer)) continue;
      seen.add(e.buyer);
      queueAlert(e.buyer, 'radar_match', `On your radar: ${e.label} is now available — ${product.title}.`, { productId: product.id, radarId: e.id });
      n++;
    }
    return n;
  }

  // ---------------- order hooks ----------------
  function deliveryCodeFor(order) {
    let h = 0;
    for (const ch of String(order.id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return String(1000 + (h % 9000));
  }
  function pushTimeline(order, key, text) {
    order.timeline = order.timeline || [];
    if (order.timeline.some((t) => t.key === key)) return;
    const at = now();
    const msg = key === 'arrived' ? TIMELINE_TEXT.arrived.replace('delivery code', 'delivery code (' + deliveryCodeFor(order) + ')') : text || TIMELINE_TEXT[key];
    order.timeline.push({ key, text: msg, at });
    if (order.notify && order.notify.optIn && order.notify.phone) {
      S().sms.push({ id: U.uid('sms'), buyer: order.buyerId || null, orderId: order.id, to: maskPhone(order.notify.phone), text: 'VendiPort: ' + msg, at, kind: 'order_' + key, simulated: true });
    }
  }
  /** Photo 2 (sealed) => READY => delivery-service call. Stub: no courier API. Own-driver shops skip dispatch. */
  function dispatchOrder(order) {
    const sh = shops().find((x) => x.id === order.shopId) || primaryShop();
    const own = !!(sh && (sh.ownDriver || sh.customWindows));
    const at = now();
    const last4 = String(order.id).slice(-4).toUpperCase();
    let h = 0; for (const ch of String(order.id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    if (own) {
      order.dispatch = { mode: 'own', status: 'own_driver', at, driverId: 'own_' + (sh ? sh.id : 'shop'), stub: true };
      S().shopNotices.push({ id: U.uid('sn'), shopId: order.shopId, orderId: order.id, last4, kind: 'own_driver', text: `Order #${last4} is READY — your own driver delivers it. No courier requested.`, at });
      pushTimeline(order, 'dispatch', 'Ready — the shop’s own driver will deliver (no courier requested).');
    } else {
      order.dispatch = { mode: 'courier', status: 'requested', requestId: U.uid('dr'), at, driverId: 'drv_' + (1 + (h % 4)), eta: '~15 min pickup', stub: true };
      S().dispatches.push({ id: order.dispatch.requestId, orderId: order.id, last4, shopId: order.shopId, shopName: shopName(order.shopId), zip: order.zip || null, driverId: order.dispatch.driverId, status: 'requested', at, stub: true });
      pushTimeline(order, 'dispatch', 'Courier requested — pickup ETA ~15 min (simulated delivery-service call).');
    }
  }
  /** Called by server.saveOrder before writing. prev may be undefined (new order). */
  function beforeSave(prev, order) {
    const prevStatus = prev && prev.status;
    const map = { PAID: 'paid', PACKING: 'packing', READY: 'ready', PICKED_UP: 'out', DELIVERED_ACCEPTED: 'delivered', CANCELLED: 'cancelled', REFUSED_SEAL: 'refused' };
    if (order.status !== prevStatus && map[order.status]) {
      // fill skipped steps so the timeline stays contiguous (e.g. PAID -> PICKED_UP via API)
      const idx = TIMELINE_STEPS.indexOf(map[order.status]);
      for (let i = 0; i < idx; i++) pushTimeline(order, TIMELINE_STEPS[i]);
      pushTimeline(order, map[order.status]);
      if (order.status === 'PAID') S().events.push({ type: 'paid', at: now(), orderId: order.id });
    }
    if (order.arrivePhotoStub && !(prev && prev.arrivePhotoStub)) pushTimeline(order, 'arrived');
    if (order.status === 'READY' && !order.dispatch) dispatchOrder(order);
    if (order.status === 'PICKED_UP' && order.dispatch && order.dispatch.status === 'requested') { order.dispatch.status = 'picked_up'; order.dispatch.pickedUpAt = now(); const dq = S().dispatches.find((x) => x.orderId === order.id); if (dq) dq.status = 'picked_up'; }
    if (order.status === 'PICKED_UP' && !order.deliveryCode) order.deliveryCode = deliveryCodeFor(order);
    store.save();
  }

  function orderExtras(o) {
    const dispute = o.disputeId ? S().disputes.find((d) => d.id === o.disputeId) : null;
    const rating = S().ratings.find((r) => r.orderId === o.id);
    return {
      timeline: o.timeline || [],
      timelineText: TIMELINE_TEXT,
      deliveryCode: ['PICKED_UP', 'READY', 'DELIVERED_ACCEPTED'].includes(o.status) ? deliveryCodeFor(o) : null,
      proofType: o.proofType || null,
      notify: o.notify ? { optIn: !!o.notify.optIn, phoneMasked: maskPhone(o.notify.phone) } : { optIn: false, phoneMasked: '' },
      smsLog: S().sms.filter((s) => s.orderId === o.id).slice(-12),
      disputeOpen: !!(dispute && D.ACTIVE.includes(dispute.status)),
      claim: D.claimFor(o),
      evidence: D.publicEvidence(o),
      dispatch: o.dispatch ? { mode: o.dispatch.mode, status: o.dispatch.status, at: o.dispatch.at } : null,
      disputeId: o.disputeId || null,
      sealCheck: o.sealCheck || null,
      cancelReason: o.cancelReason || null,
      rated: !!rating,
      rating: rating ? { shop: rating.shop, delivery: rating.delivery, comment: rating.comment } : null,
      buyerId: o.buyerId || null,
      packChecklist: o.packChecklist ? { done: !!o.packChecklist.done, at: o.packChecklist.at, boxPhoto: o.packChecklist.boxPhoto || null, checks: o.packChecklist.checks } : null,
      packBeforeDone: !!o.packBefore, packAfterDone: !!o.packAfter,
      checklistItems: CHECKLIST_ITEMS,
    };
  }

  /** Called from POST /api/orders. Returns an error string or null; mutates order with buyer info. */
  function preOrder(body) {
    if (anyShopPaused()) return 'The machine is paused right now (shop is closed early). Check back soon — add it to your Radar to get a text when it’s back.';
    if (body.zip) {
      const a = areaCheck(body.zip);
      if (a.valid && !a.inArea) return a.message;
    }
    return null;
  }
  function attachBuyer(order, body) {
    if (body.buyerId || body.buyer) order.buyerId = String(body.buyerId || body.buyer).slice(0, 64);
    const zip = U.zip5(body.zip);
    if (zip) order.zip = zip;
    const phone = String(body.notifyPhone || '').replace(/[^\d+]/g, '');
    if (body.notifyText && phone.replace(/\D/g, '').length >= 10) {
      order.notify = { optIn: true, phone };
      if (order.buyerId) { const p = profile(order.buyerId); p.phone = phone; p.notifyText = true; }
    }
    if (order.buyerId && zip) profile(order.buyerId).zip = zip;
    store.save();
  }

  const D = createDisputes({ S, findOrder, saveOrder, profile, shopName, maskPhone, store, uid: U.uid });
  function sealDispute(order, note, photo, reason, channel) {
    const st = S();
    const d = {
      id: U.uid('dp'), orderId: order.id, last4: String(order.id).slice(-4).toUpperCase(), shopId: order.shopId,
      shopName: shopName(order.shopId), reason: reason || 'seal_not_intact', note: String(note || '').slice(0, 500),
      status: 'open', openedAt: now(), buyer: order.buyerId || null,
      buyerPhoto: photo || null,
      channel: channel || (order.status === 'DELIVERED_ACCEPTED' ? 'claim_after_accept' : 'refused_at_door'),
      driverId: (order.dispatch && order.dispatch.driverId) || null,
      productPrice: order.productPrice || 0, total: order.total || 0, productTitle: order.productTitle || '',
    };
    st.disputes.push(d);
    order.disputeId = d.id;
    order.sealCheck = { intact: false, at: d.openedAt };
    store.save();
    return d;
  }
  const disputeView = (d) => D.view(d);

  // ---------------- breaks / collection ----------------
  function breakPublic(b, withPrivate) {
    const meta = b.url ? U.parseBreakUrl(b.url) : null;
    return {
      id: b.id, productId: b.productId, boxTitle: b.boxTitle, caption: b.caption, tags: b.tags || [],
      hitsPulled: b.hitsPulled || [], photos: b.photos || [], visibility: b.visibility,
      platform: meta && !meta.error ? { id: meta.platform, label: meta.platformLabel, icon: meta.platformIcon, color: meta.platformColor, embed: meta.embed, thumb: meta.thumb, url: meta.url, embeddable: meta.embeddable } : null,
      createdAt: b.createdAt, shares: b.shares || 0, views: b.views || 0, demo: !!b.demo,
      consentMarketing: withPrivate ? !!b.consentMarketing : undefined,
      marketingStatus: withPrivate ? b.marketingStatus : undefined,
      orderId: withPrivate ? b.orderId : undefined, lineId: withPrivate ? b.lineId : undefined,
      moderation: withPrivate ? b.moderation : undefined,
    };
  }
  function collectionFor(id) {
    const orders = readJson('orders.json', []).filter((o) => o.buyerId === id && o.status !== 'DRAFT');
    const items = [];
    const breaks = S().breaks.filter((b) => b.buyer === id);
    for (const o of orders) {
      const lines = (o.lineItems && o.lineItems.length ? o.lineItems : [{ id: 'line_primary', productId: o.productId, title: o.productTitle, price: o.productPrice, image: o.productImage }]).filter((l) => l.paid !== false);
      for (const l of lines) {
        const lineBreaks = breaks.filter((b) => b.orderId === o.id && (b.lineId === l.id || !b.lineId || lines.length === 1));
        const p = findProduct(l.productId) || {};
        items.push({
          orderId: o.id, last4: String(o.id).slice(-4).toUpperCase(), lineId: l.id, productId: l.productId,
          title: l.title, set: U.setNameOf(l.title), category: p.category || '', price: l.price, orderTotal: o.total,
          image: l.image || o.productImage || p.image || null, emoji: l.emoji || o.productEmoji || null,
          status: o.status, delivered: o.status === 'DELIVERED_ACCEPTED', date: o.acceptedAt || o.createdAt, orderedAt: o.createdAt,
          hitsOptions: (p.chaseTop3 || []).map((c) => c.name),
          hitsPulled: [].concat(...lineBreaks.map((b) => (b.hitsPulled || []).map((h) => h.name))).filter((v, i, a) => a.indexOf(v) === i),
          breaks: lineBreaks.map((b) => breakPublic(b, true)),
        });
      }
    }
    items.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const delivered = items.filter((i) => i.delivered);
    const spentOrders = new Set();
    let spent = 0;
    for (const i of delivered) if (!spentOrders.has(i.orderId)) { spentOrders.add(i.orderId); spent += Number(i.orderTotal || 0); }
    return {
      items,
      totals: {
        boxes: delivered.length,
        spent: +spent.toFixed(2),
        hits: new Set([].concat(...delivered.map((i) => i.hitsPulled))).size,
        breaks: breaks.length,
      },
    };
  }

  function shareCardSvg(b, base) {
    const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const hits = (b.hitsPulled || []).slice(0, 3).map((h) => h.name);
    let logo = '';
    try {
      const buf = fs.readFileSync(path.join(PUBLIC, 'img', 'logo.png'));
      logo = `<image href="data:image/png;base64,${buf.toString('base64')}" x="390" y="70" width="300" height="300"/>`;
    } catch (_) {}
    const cap = String(b.caption || '').slice(0, 70);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#140c26"/><stop offset="1" stop-color="#07090d"/></linearGradient>
<linearGradient id="r" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4fd1c5"/><stop offset="1" stop-color="#8a4fd1"/></linearGradient></defs>
<rect width="1080" height="1080" fill="url(#g)"/><rect x="24" y="24" width="1032" height="1032" rx="36" fill="none" stroke="url(#r)" stroke-width="6"/>
${logo}
<text x="540" y="470" text-anchor="middle" font-family="Poppins,Arial,sans-serif" font-weight="800" font-size="46" fill="#4fd1c5" letter-spacing="6">BOX BREAK</text>
<text x="540" y="545" text-anchor="middle" font-family="Poppins,Arial,sans-serif" font-weight="800" font-size="52" fill="#fff">${esc(String(b.boxTitle || '').slice(0, 34))}</text>
<text x="540" y="620" text-anchor="middle" font-family="Arial,sans-serif" font-size="34" fill="#c9b8ff">${esc(cap)}</text>
${hits.length ? `<text x="540" y="720" text-anchor="middle" font-family="Arial,sans-serif" font-size="30" font-weight="700" fill="#4fd1c5">HITS PULLED</text>` + hits.map((h, i) => `<text x="540" y="${770 + i * 48}" text-anchor="middle" font-family="Arial,sans-serif" font-size="38" fill="#fff">◎ ${esc(h)}</text>`).join('') : ''}
<text x="540" y="990" text-anchor="middle" font-family="Poppins,Arial,sans-serif" font-weight="800" font-size="40" fill="#fff">Vendi<tspan fill="#4fd1c5">Port</tspan> <tspan font-size="26" fill="#8b95a8" font-weight="400">· same-day sealed boxes</tspan></text>
<text x="540" y="1030" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" fill="#8b95a8">${esc((base || '').replace(/^https?:\/\//, ''))}/breaks/${esc(b.id)}</text>
</svg>`;
  }

  // ---------------- earnings ----------------
  function parseWindowEnd(label, createdAt) {
    const m = String(label || '').match(/(\d{1,2})(?::\d\d)?\s*(am|pm)?\s*[-–]\s*(\d{1,2})(?::\d\d)?\s*(am|pm)/i);
    const d = new Date(createdAt || Date.now());
    if (/tomorrow/i.test(label)) d.setDate(d.getDate() + 1);
    if (!m) { d.setHours(23, 59, 0, 0); return d.getTime(); }
    let h = parseInt(m[3], 10) % 12;
    if (/pm/i.test(m[4])) h += 12;
    d.setHours(h, 0, 0, 0);
    return d.getTime();
  }
  function earnings() {
    const sh = primaryShop();
    const orders = readJson('orders.json', []);
    const ownDriver = !!(sh && (sh.ownDriver || sh.customWindows));
    const byDay = {};
    const day = (d) => (byDay[d] || (byDay[d] = { day: d, delivered: 0, sales: 0, platformFee: 0, deliveryKept: 0, cancelShare: 0, refunds: 0, net: 0 }));
    let pending = 0, pendingCount = 0;
    for (const o of orders) {
      if (o.status === 'DELIVERED_ACCEPTED') {
        const d = day(U.isoDay(o.acceptedAt || o.updatedAt));
        const prod = Number(o.productPrice || 0);
        d.delivered++; d.sales += prod; d.platformFee += prod * PLATFORM_TAKE;
        if (ownDriver) d.deliveryKept += Number(o.deliveryFee || 0);
      } else if (o.status === 'CANCELLED' && o.cancelFee) {
        const d = day(U.isoDay(o.cancelledAt || o.updatedAt));
        d.cancelShare += Number(o.cancelFee) / 2; d.refunds++;
      } else if (['PAID', 'PACKING', 'READY', 'PICKED_UP'].includes(o.status)) {
        pending += Number(o.productPrice || 0) * (1 - PLATFORM_TAKE); pendingCount++;
      }
    }
    const rows = Object.values(byDay).map((d) => { d.net = +(d.sales - d.platformFee + d.deliveryKept + d.cancelShare).toFixed(2); d.sales = +d.sales.toFixed(2); d.platformFee = +d.platformFee.toFixed(2); d.deliveryKept = +d.deliveryKept.toFixed(2); d.cancelShare = +d.cancelShare.toFixed(2); return d; }).sort((a, b) => b.day.localeCompare(a.day));
    const adj = (S().payoutAdjustments || []).filter((a) => !sh || a.shopId === sh.id).sort((a, b) => b.at.localeCompare(a.at));
    const adjTotal = +adj.reduce((x, a) => x + a.amount, 0).toFixed(2);
    const today = U.isoDay(Date.now());
    const t = rows.find((r) => r.day === today) || { day: today, delivered: 0, sales: 0, platformFee: 0, deliveryKept: 0, cancelShare: 0, refunds: 0, net: 0 };
    return {
      today: t, days: rows.slice(0, 7),
      totalNet: +(rows.reduce((s, r) => s + r.net, 0) + adjTotal).toFixed(2),
      adjustments: adj.slice(0, 10), adjustmentsTotal: adjTotal,
      shopNotices: (S().shopNotices || []).filter((n) => !sh || n.shopId === sh.id).slice(-5).reverse(),
      pending: +pending.toFixed(2), pendingCount, ownDriver, platformTake: PLATFORM_TAKE,
      payoutNote: 'Daily payout stub — net is paid next business day after buyer accepts. No real transfers in beta.',
    };
  }

  // ------------------------------------------------------------
  async function handle(req, res, pathname) {
    const method = req.method.toUpperCase();
    const url = new URL(req.url, 'http://x');
    let m;

    // ---- area ----
    if (method === 'GET' && pathname === '/api/area') {
      const zip = url.searchParams.get('zip');
      const a = areaCheck(zip);
      const id = buyerId(req, null, url);
      if (a.valid) {
        S().events.push({ type: 'area_check', zip: a.zip, inArea: a.inArea, at: now() });
        if (id) profile(id).zip = a.zip;
        store.save();
      }
      return send(res, 200, a), true;
    }
    // ---- buyer profile ----
    if ((m = pathname.match(/^\/api\/buyer\/([\w-]{3,64})$/))) {
      const id = m[1];
      if (method === 'GET') {
        const p = profile(id);
        return send(res, 200, { buyer: { id, zip: p.zip || '', notifyText: !!p.notifyText, phoneMasked: maskPhone(p.phone), address: p.address || null } }), true;
      }
      if (method === 'PUT') {
        const body = await readBody(req);
        const p = profile(id);
        if (body.zip != null) p.zip = U.zip5(body.zip);
        if (body.phone != null) p.phone = String(body.phone).replace(/[^\d+]/g, '');
        if (body.notifyText != null) p.notifyText = !!body.notifyText && !!p.phone;
        if (body.address) {
          const a = body.address;
          p.address = { line1: String(a.line1 || '').slice(0, 120), city: String(a.city || '').slice(0, 60), zip: U.zip5(a.zip || p.zip), note: String(a.note || '').slice(0, 160) };
          if (p.address.zip) p.zip = p.address.zip;
        }
        store.save();
        return send(res, 200, { buyer: { id, zip: p.zip || '', notifyText: !!p.notifyText, phoneMasked: maskPhone(p.phone), address: p.address || null }, area: areaCheck(p.zip) }), true;
      }
    }
    // ---- search (logs zero-result searches) ----
    if (method === 'GET' && pathname === '/api/search') {
      const q = String(url.searchParams.get('q') || '').trim().slice(0, 80);
      if (!q) return send(res, 200, { q, results: [] }), true;
      const results = readJson('products.json', []).filter((p) => buyerVisible(p) && productHayMatch(p, q)).map((p) => ({ id: p.id, title: p.title, price: p.price, image: p.image || null, hits: (p.chaseTop3 || []).map((c) => c.name) }));
      if (!results.length) { S().searches.push({ q, at: now(), zip: U.zip5(url.searchParams.get('zip')) }); store.save(); }
      return send(res, 200, { q, results }), true;
    }
    // ---- events ----
    if (method === 'POST' && pathname === '/api/events') {
      const body = await readBody(req);
      const type = String(body.type || '');
      if (['browse', 'select', 'checkout', 'error', 'area_check'].includes(type)) {
        const ev = { type, at: now() };
        if (body.detail) ev.detail = String(body.detail).slice(0, 120);
        if (body.zip) ev.zip = U.zip5(body.zip);
        S().events.push(ev);
        if (S().events.length > 5000) S().events.splice(0, S().events.length - 5000);
        store.save();
      }
      return send(res, 200, { ok: true }), true;
    }

    // ---- radar ----
    if (pathname === '/api/radar' && method === 'GET') {
      const id = buyerId(req, null, url);
      if (!id) return sendError(res, 400, 'buyer id required'), true;
      return send(res, 200, radarView(id)), true;
    }
    if (pathname === '/api/radar' && method === 'POST') {
      const body = await readBody(req);
      const id = buyerId(req, body);
      const label = String(body.label || '').trim().slice(0, 80);
      if (!id) return sendError(res, 400, 'buyer id required'), true;
      if (label.length < 2) return sendError(res, 400, 'Type a card, player, set or box'), true;
      const kind = ['card', 'player', 'set', 'box'].includes(body.kind) ? body.kind : 'card';
      const key = U.keyOf(label);
      if (!key) return sendError(res, 400, 'Type a card, player, set or box'), true;
      const st = S();
      const existing = st.radar.find((e) => e.buyer === id && e.key === key);
      if (existing) return send(res, 200, Object.assign(radarView(id), { added: false, already: true })), true;
      const prof = profile(id);
      const zip = U.zip5(body.zip) || prof.zip || '';
      const entry = { id: U.uid('rd'), buyer: id, kind, label, key, productId: body.productId ? String(body.productId) : null, zip, source: body.source === 'chase' ? 'chase' : 'search', createdAt: now() };
      st.radar.push(entry);
      store.save();
      return send(res, 201, Object.assign(radarView(id), { added: true, entry: entry.id })), true;
    }
    if ((m = pathname.match(/^\/api\/radar\/(rd_\w+)$/)) && method === 'DELETE') {
      const id = buyerId(req, null, url);
      const st = S();
      const i = st.radar.findIndex((e) => e.id === m[1] && e.buyer === id);
      if (i < 0) return sendError(res, 404, 'Not on your radar'), true;
      st.radar.splice(i, 1);
      store.save();
      return send(res, 200, radarView(id)), true;
    }
    if (pathname === '/api/radar/read' && method === 'POST') {
      const body = await readBody(req);
      const id = buyerId(req, body);
      S().alerts.forEach((a) => { if (a.buyer === id) a.read = true; });
      store.save();
      return send(res, 200, radarView(id)), true;
    }

    // ---- wanted (shop) ----
    if (pathname === '/api/wanted' && method === 'GET') {
      const list = aggregateWanted();
      const buyers = new Set(S().radar.map((e) => e.buyer)).size;
      return send(res, 200, { wanted: list.slice(0, 30), totalBuyers: buyers, demoSeeded: S().radar.some((e) => e.demo), note: 'Anonymous counts only — no buyer names or contact info.' }), true;
    }
    if (pathname === '/api/wanted/have' && method === 'POST') {
      const body = await readBody(req);
      const key = String(body.key || '');
      const w = aggregateWanted().find((x) => x.key === key);
      if (!w) return sendError(res, 404, 'Not on the wanted list'), true;
      const sh = primaryShop();
      const units = Math.max(0, parseInt(body.units, 10) || 0);
      const products = readJson('products.json', []);
      let product = body.productId ? products.find((p) => p.id === body.productId) : null;
      let status = 'flagged';
      let created = false;
      if (!product) {
        const entry = { kind: w.kind, label: w.label, productId: w.productId };
        product = products.find((p) => U.matchesProduct(entry, p) && buyerVisibleRaw(p)) || products.find((p) => U.matchesProduct(entry, p));
      }
      if (product && units > 0) {
        product.hidden = false;
        if (!product.windows || !product.windows.length) product.windows = [{ id: 'w_today_1600', label: 'Today 4-6pm', units: 0 }];
        product.windows[0].units = (Number(product.windows[0].units) || 0) + units;
        writeJson('products.json', products);
        status = 'listed';
      } else if (!product && w.kind === 'box' && Number(body.price) > 0 && units > 0) {
        const id = U.keyOf(w.label).replace(/ /g, '-') + '-' + Date.now().toString(36).slice(-4);
        product = { id, title: w.label, subtitle: 'Sealed · Demo price — confirm with shop', category: 'Football', price: Number(body.price), emoji: '🏈', tile: 'NEW', image: null, barcode: null, hidden: false, windows: [{ id: 'w_today_1600', label: 'Today 4-6pm', units }] };
        products.push(product);
        writeJson('products.json', products);
        status = 'listed'; created = true;
      } else if (product && U.totalUnits(product) > 0 && !product.hidden) {
        status = 'listed'; // already on the machine — just notify followers
      }
      const st = S();
      const rec = { id: U.uid('ih'), key, label: w.label, kind: w.kind, productId: product ? product.id : null, shopId: sh && sh.id, status, at: now(), respondedAfterMins: Math.max(1, Math.round((Date.now() - Date.parse(w.firstAt || now())) / 60000)), units };
      // response time: since the first real or seeded demand for it
      st.iHave.push(rec);
      let alerted = 0;
      if (status === 'listed' && product) {
        alerted = alertFollowers(key, product);
        rec.listedAt = now();
        st.inStockSnapshot = [...new Set([...(st.inStockSnapshot || []), product.id])];
      }
      store.save();
      return send(res, 200, { ok: true, status, created, productId: product ? product.id : null, alertsQueued: alerted, message: status === 'listed' ? `Listed — hits alert queued for ${alerted} real follower${alerted === 1 ? '' : 's'} (demo followers are counted, not messaged).` : 'Flagged — we’ll queue a hits alert to those buyers the moment you list it.' }), true;
    }

    // ---- shop: pause / earnings / verification ----
    if (pathname === '/api/shop/status' && method === 'GET') {
      const sh = primaryShop();
      const ss = sh ? shopState(sh.id) : {};
      const ver = sh ? (S().verification[sh.id] || { status: sh.verification || 'verified' }) : null;
      const prods = readJson('products.json', []);
      return send(res, 200, { paused: !!ss.paused, pausedSince: ss.pausedAt || null, reason: ss.reason || '', verification: ver, lowStock: prods.filter((p) => stockInfo(p).low && !p.hidden).map((p) => ({ id: p.id, title: p.title, units: U.totalUnits(p) })), soldOut: prods.filter((p) => stockInfo(p).soldOut).map((p) => ({ id: p.id, title: p.title })), lowStockThreshold: LOW_STOCK }), true;
    }
    if (pathname === '/api/shop/pause' && method === 'POST') {
      const body = await readBody(req);
      const sh = primaryShop();
      if (!sh) return sendError(res, 404, 'No shop'), true;
      const ss = shopState(sh.id);
      ss.paused = !!body.paused;
      ss.reason = String(body.reason || '').slice(0, 80);
      ss.pausedAt = ss.paused ? now() : null;
      store.save();
      if (!ss.paused) scanRadar();
      return send(res, 200, { paused: ss.paused, reason: ss.reason, pausedAt: ss.pausedAt, message: ss.paused ? 'Paused — all your SKUs are hidden from the machine.' : 'Back open — SKUs are visible again.' }), true;
    }
    if (pathname === '/api/shop/earnings' && method === 'GET') return send(res, 200, earnings()), true;
    if (pathname === '/api/shop/verify' && method === 'POST') {
      const body = await readBody(req);
      const sh = primaryShop();
      if (!sh) return sendError(res, 404, 'No shop'), true;
      const bizId = String(body.bizId || '').trim();
      if (bizId.length < 5) return sendError(res, 400, 'Enter your business ID / seller permit number'), true;
      S().verification[sh.id] = { id: sh.id, name: sh.name, owner: String(body.owner || sh.staffLabel || '').slice(0, 80), bizId: bizId.slice(0, 60), zip: sh.zip || '', status: 'pending', submittedAt: now(), docs: ['Submitted in shop app'] };
      store.save();
      return send(res, 200, { verification: S().verification[sh.id] }), true;
    }

    // ---- order extras ----
    if ((m = pathname.match(/^\/api\/orders\/([^/]+)\/(buyer|notify|arrive-proof|pack-checklist|pack-sealed|claim-proof|dispute|rate)$/)) && method === 'POST') {
      const order = findOrder(m[1]);
      if (!order) return sendError(res, 404, 'Order not found'), true;
      const body = await readBody(req);
      const act = m[2];
      if (act === 'buyer') {
        attachBuyer(order, body);
        saveOrder(order);
        return send(res, 200, { order: publicOrder(order) }), true;
      }
      if (act === 'notify') {
        const phone = String(body.phone || '').replace(/[^\d+]/g, '');
        if (body.optIn === false) {
          order.notify = { optIn: false, phone: order.notify ? order.notify.phone : '' };
        } else {
          if (phone.replace(/\D/g, '').length < 10) return sendError(res, 400, 'Enter a valid mobile number'), true;
          order.notify = { optIn: true, phone };
          if (order.buyerId) { const p = profile(order.buyerId); p.phone = phone; p.notifyText = true; }
          S().sms.push({ id: U.uid('sms'), buyer: order.buyerId || null, orderId: order.id, to: maskPhone(phone), text: 'VendiPort: Text updates on for order ' + String(order.id).slice(-4).toUpperCase() + '. Reply STOP to opt out. (simulated)', at: now(), kind: 'optin', simulated: true });
        }
        saveOrder(order);
        return send(res, 200, { order: publicOrder(order) }), true;
      }
      if (act === 'arrive-proof') {
        if (order.status !== 'PICKED_UP') return sendError(res, 409, `Handoff proof is for picked-up orders (now ${order.status})`), true;
        const code = String(body.code || '').trim();
        if (code) {
          if (code !== deliveryCodeFor(order)) return sendError(res, 409, 'Delivery code does not match — ask the buyer to read it from their order page'), true;
          order.proofType = 'code';
        } else {
          const photo = saveDataImage('boxes', 'arrive-' + order.id.slice(0, 8), body.photo);
          order.proofType = 'photo';
          order.arriveProofPhoto = photo || null;
        }
        order.arrivePhotoStub = true;
        order.arrivePhotoNote = order.proofType === 'code' ? 'Delivery code verified at the door.' : 'Photo proof (stub) of tote at the door.';
        order.proofAt = now();
        order.updatedAt = order.proofAt;
        saveOrder(order);
        return send(res, 200, { order: publicOrder(order) }), true;
      }
      if (act === 'pack-sealed') {
        // Photo 2: sealed bag (QR-in-V + seal strip visible) => READY + automatic delivery-service call
        if (order.status !== 'PACKING' || !order.packBefore) return sendError(res, 409, 'Take Photo 1 first (product on the bag QR) — that starts packing.'), true;
        const checks = Object.assign({}, order.packChecklist && order.packChecklist.checks, body.checks && typeof body.checks === 'object' ? body.checks : {});
        if (process.env.REQUIRE_PACK_CHECKLIST !== '0' && !CHECKLIST_ITEMS.every((i) => checks[i.id])) return sendError(res, 409, 'Finish the packing checklist before Photo 2.'), true;
        const photo = saveDataImage('boxes', 'sealed-' + order.id.slice(0, 8), body.photo);
        if (!photo && !body.stub) return sendError(res, 400, 'Add Photo 2 — the sealed bag with the QR-in-V and seal strip visible.'), true;
        const qr = String(body.qr || body.toteQrPayload || order.packBefore.qr).trim();
        if (qr.toUpperCase() !== String(order.packBefore.qr).toUpperCase()) return sendError(res, 409, 'The QR on the sealed bag does not match the original scan from Photo 1.'), true;
        order.packAfter = { photo: photo || null, stub: !photo, at: now(), qr };
        order.sealConfirmed = true;
        order.sealChecklist = { bagSealed: true, tearStripIntact: true, qrLast4: String(order.id).slice(-4).toUpperCase(), copy: 'Sealed bag photographed with QR-in-V and seal strip visible.' };
        order.packChecklist = { checks: Object.fromEntries(CHECKLIST_ITEMS.map((i) => [i.id, !!checks[i.id]])), boxPhoto: photo || 'stub', done: true, at: now() };
        order.status = 'READY'; order.sealedAt = now(); order.updatedAt = order.sealedAt;
        saveOrder(order);
        return send(res, 200, { order: Object.assign({}, publicOrder(order), { shopId: order.shopId }), dispatch: order.dispatch || null }), true;
      }
      if (act === 'claim-proof') {
        try { D.submitProof(order, body, (img) => saveDataImage('boxes', 'proof-' + order.id.slice(0, 8), img)); } catch (e) { return sendError(res, e.status || 400, e.message), true; }
        return send(res, 200, { order: publicOrder(order) }), true;
      }
      if (act === 'pack-checklist') {
        if (!['PAID', 'PACKING'].includes(order.status)) return sendError(res, 409, `Checklist is for packing (now ${order.status})`), true;
        const checks = body.checks && typeof body.checks === 'object' ? body.checks : {};
        const allChecked = CHECKLIST_ITEMS.every((i) => checks[i.id]);
        let boxPhoto = order.packChecklist && order.packChecklist.boxPhoto;
        if (body.boxPhoto) boxPhoto = saveDataImage('boxes', 'box-' + order.id.slice(0, 8), body.boxPhoto) || boxPhoto;
        if (body.stubPhoto && !boxPhoto) boxPhoto = 'stub';
        order.packChecklist = { checks: Object.fromEntries(CHECKLIST_ITEMS.map((i) => [i.id, !!checks[i.id]])), boxPhoto: boxPhoto || null, done: !!(allChecked && boxPhoto), at: now() };
        if (order.status === 'PAID') order.status = 'PACKING';
        order.updatedAt = now();
        saveOrder(order);
        return send(res, 200, { order: Object.assign({}, publicOrder(order), { shopId: order.shopId }), done: order.packChecklist.done }), true;
      }
      if (act === 'dispute') {
        if (!['PICKED_UP', 'READY', 'DELIVERED_ACCEPTED'].includes(order.status)) return sendError(res, 409, 'Claims open after pickup'), true;
        if (order.disputeId && S().disputes.some((d) => d.id === order.disputeId && D.ACTIVE.includes(d.status))) return sendError(res, 409, 'A claim is already open for this order'), true;
        const photo = saveDataImage('boxes', 'dispute-' + order.id.slice(0, 8), body.photo);
        const d = sealDispute(order, body.note, photo, body.reason);
        order.updatedAt = now();
        saveOrder(order);
        return send(res, 201, { dispute: { id: d.id, status: d.status }, order: publicOrder(order) }), true;
      }
      if (act === 'rate') {
        if (order.status !== 'DELIVERED_ACCEPTED') return sendError(res, 409, 'You can rate after delivery'), true;
        if (S().ratings.some((r) => r.orderId === order.id)) return sendError(res, 409, 'Already rated — thanks!'), true;
        const sc = (v) => Math.min(5, Math.max(1, parseInt(v, 10) || 0));
        const shopR = sc(body.shop), delR = sc(body.delivery);
        if (!shopR || !delR) return sendError(res, 400, 'Rate both the shop and the delivery (1-5)'), true;
        S().ratings.push({ id: U.uid('rt'), orderId: order.id, shopId: order.shopId, buyer: order.buyerId || null, shop: shopR, delivery: delR, comment: String(body.comment || '').slice(0, 300), at: now() });
        store.save();
        return send(res, 201, { order: publicOrder(order) }), true;
      }
    }

    // ---- collection & breaks ----
    if (pathname === '/api/collection' && method === 'GET') {
      const id = buyerId(req, null, url);
      if (!id) return sendError(res, 400, 'buyer id required'), true;
      return send(res, 200, collectionFor(id)), true;
    }
    if (pathname === '/api/breaks' && method === 'POST') {
      const body = await readBody(req);
      const id = buyerId(req, body);
      const order = findOrder(String(body.orderId || ''));
      if (!id || !order || order.buyerId !== id) return sendError(res, 403, 'That order is not in your collection'), true;
      if (order.status !== 'DELIVERED_ACCEPTED') return sendError(res, 409, 'Breaks open after delivery'), true;
      let urlMeta = null;
      if (body.url && String(body.url).trim()) {
        urlMeta = U.parseBreakUrl(body.url);
        if (urlMeta.error) return sendError(res, 400, urlMeta.error), true;
      }
      const photos = (Array.isArray(body.photos) ? body.photos : []).slice(0, 4).map((d) => saveDataImage('breaks', 'br-' + id.slice(0, 6), d)).filter(Boolean);
      const hits = (Array.isArray(body.hitsPulled) ? body.hitsPulled : []).map((n) => String(n).trim().slice(0, 80)).filter(Boolean).slice(0, 8);
      const caption = String(body.caption || '').trim().slice(0, 140);
      if (!urlMeta && !photos.length && !hits.length && !caption) return sendError(res, 400, 'Add a link, photo, hit or caption'), true;
      const line = (order.lineItems || []).find((l) => l.id === body.lineId) || (order.lineItems || [])[0] || {};
      const visibility = body.visibility === 'public' ? 'public' : 'private';
      if (visibility === 'public' && !urlMeta && !photos.length) return sendError(res, 400, 'Public breaks need a link or a photo'), true;
      const consent = !!body.consentMarketing;
      const b = {
        id: U.uid('br'), buyer: id, orderId: order.id, lineId: line.id || null, productId: line.productId || order.productId,
        boxTitle: line.title || order.productTitle, url: urlMeta ? urlMeta.url : null, caption, hitsPulled: hits.map((name) => ({ name })),
        photos, tags: [U.setNameOf(line.title || order.productTitle)].concat((Array.isArray(body.tags) ? body.tags : []).map((t) => String(t).slice(0, 24)).slice(0, 4)),
        visibility, consentMarketing: consent, marketingStatus: consent ? 'pending' : 'none', moderation: 'ok', views: 0, shares: 0, createdAt: now(),
      };
      S().breaks.push(b);
      store.save();
      return send(res, 201, { break: breakPublic(b, true), collection: collectionFor(id) }), true;
    }
    if (pathname === '/api/breaks/public' && method === 'GET') {
      const list = S().breaks.filter((b) => b.visibility === 'public' && b.moderation !== 'hidden').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((b) => breakPublic(b, false));
      return send(res, 200, { breaks: list, demo: list.some((b) => b.demo) }), true;
    }
    if (pathname === '/api/breaks/mine' && method === 'GET') {
      const id = buyerId(req, null, url);
      const list = S().breaks.filter((b) => b.buyer === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((b) => breakPublic(b, true));
      return send(res, 200, { breaks: list }), true;
    }
    if ((m = pathname.match(/^\/api\/breaks\/(br_\w+)(?:\/(card\.svg|share|view))?$/))) {
      const b = S().breaks.find((x) => x.id === m[1]);
      if (!b) return sendError(res, 404, 'Break not found'), true;
      const sub = m[2];
      const owner = buyerId(req, null, url) === b.buyer;
      const visible = b.visibility === 'public' && b.moderation !== 'hidden';
      if (!sub && method === 'GET') {
        if (!visible && !owner) return sendError(res, 404, 'Break not found'), true;
        return send(res, 200, { break: breakPublic(b, owner) }), true;
      }
      if (sub === 'card.svg' && method === 'GET') {
        if (!visible && !owner) return sendError(res, 404, 'Break not found'), true;
        const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '') || `${(req.headers['x-forwarded-proto'] || 'http').split(',')[0]}://${req.headers.host}`;
        res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(shareCardSvg(b, base)), true;
      }
      if (sub === 'share' && method === 'POST') { b.shares = (b.shares || 0) + 1; store.save(); return send(res, 200, { shares: b.shares }), true; }
      if (sub === 'view' && method === 'POST') { b.views = (b.views || 0) + 1; store.save(); return send(res, 200, { views: b.views }), true; }
      if (method === 'PATCH') {
        if (!owner) return sendError(res, 403, 'Not your break'), true;
        const body = await readBody(req);
        if (body.visibility) {
          if (body.visibility === 'public' && !b.url && !(b.photos || []).length) return sendError(res, 400, 'Public breaks need a link or a photo'), true;
          b.visibility = body.visibility === 'public' ? 'public' : 'private';
        }
        if (body.caption != null) b.caption = String(body.caption).slice(0, 140);
        if (body.consentMarketing != null) {
          b.consentMarketing = !!body.consentMarketing;
          b.marketingStatus = b.consentMarketing ? (b.marketingStatus === 'approved' ? 'approved' : 'pending') : 'none';
        }
        store.save();
        return send(res, 200, { break: breakPublic(b, true) }), true;
      }
      if (method === 'DELETE') {
        if (!owner) return sendError(res, 403, 'Not your break'), true;
        S().breaks.splice(S().breaks.indexOf(b), 1);
        store.save();
        return send(res, 200, { deleted: b.id }), true;
      }
    }
    return false;
  }

  function productHayMatch(p, q) {
    const qt = U.toks(q);
    if (!qt.length) return false;
    const hay = ' ' + U.toks([p.title, p.category].concat((p.chaseTop3 || []).map((c) => c.name)).join(' ')).join(' ') + ' ';
    return qt.every((t) => hay.includes(t));
  }

  function radarView(id) {
    const st = S();
    const products = readJson('products.json', []);
    const mine = st.radar.filter((e) => e.buyer === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const onRadarProducts = {};
    const items = mine.map((e) => {
      const matches = products.filter((p) => buyerVisible(p) && U.matchesProduct(e, p));
      for (const p of matches) (onRadarProducts[p.id] = onRadarProducts[p.id] || []).push(e.label);
      return { id: e.id, kind: e.kind, label: e.label, productId: e.productId, source: e.source, zip: e.zip, createdAt: e.createdAt, available: matches.map((p) => ({ id: p.id, title: p.title, price: p.price })) };
    });
    const alerts = st.alerts.filter((a) => a.buyer === id).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20);
    const sms = st.sms.filter((s) => s.buyer === id && !s.orderId).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10);
    const prof = st.buyers[id] || {};
    return { items, alerts, unread: alerts.filter((a) => !a.read).length, sms, onRadarProducts, textsOn: !!prof.notifyText, phoneMasked: maskPhone(prof.phone) };
  }

  return {
    handle, store, S, beforeSave, orderExtras, preOrder, attachBuyer, decorateProduct, buyerVisible, scanRadar, stockInfo,
    areaCheck, aggregateWanted, collectionFor, breakPublic, disputeView, earnings, parseWindowEnd, shopName, primaryShop, shopState,
    disputes: D, dispatchOrder, deliveryCodeFor, CHECKLIST_ITEMS, SERVICE_ZIPS, LOW_STOCK, PLATFORM_TAKE, sealDispute, saveDataImage, shareCardSvg,
    logError(msg) { try { S().events.push({ type: 'error', at: now(), detail: String(msg).slice(0, 120) }); store.save(); } catch (_) {} },
  };
}

module.exports = { createExtras, CHECKLIST_ITEMS, TIMELINE_TEXT };
