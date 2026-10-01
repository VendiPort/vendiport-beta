#!/usr/bin/env node
/* End-to-end smoke test (no deps). Starts the server on a temp DATA_DIR and walks every flow.
   Run: node tests/smoke.js   (or: npm test) */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const PORT = 3900 + Math.floor(Math.random() * 90);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-smoke-'));
for (const f of ['products.json', 'shops.json']) fs.copyFileSync(path.join(ROOT, 'data', f), path.join(DATA, f));
fs.writeFileSync(path.join(DATA, 'orders.json'), '[]\n');
const PASS = 'test-pass';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let fails = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
function call(method, p, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}, data ? { 'Content-Length': Buffer.byteLength(data) } : {}) }, (res) => {
      const ch = [];
      res.on('data', (c) => ch.push(c));
      res.on('end', () => { const t = Buffer.concat(ch).toString(); let j; try { j = JSON.parse(t); } catch (_) { j = null; } resolve({ status: res.statusCode, json: j, text: t }); });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
const A = { 'x-admin-passcode': PASS };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const srv = spawn('node', ['server.js'], { cwd: ROOT, env: Object.assign({}, process.env, { PORT, DATA_DIR: DATA, ADMIN_PASSCODE: PASS, HOST: '127.0.0.1' }), stdio: 'ignore' });
  try {
    for (let i = 0; i < 40; i++) { try { const h = await call('GET', '/health'); if (h.status === 200) break; } catch (_) {} await sleep(150); }
    const buyer = 'buyer-smoke-1';

    console.log('Area check (4)');
    let r = await call('GET', '/api/area?zip=94110');
    ok(r.json.inArea === true && r.json.sameDay, 'in-area ZIP => same-day');
    r = await call('GET', '/api/area?zip=10001');
    ok(r.json.inArea === false && /ship-only/.test(r.json.message), 'out-of-area ZIP => ship-only message');
    r = await call('PUT', '/api/buyer/' + buyer, { zip: '94110', phone: '+14155550123', notifyText: true, address: { line1: '1 Market St', city: 'SF', zip: '94110' } });
    ok(r.json.buyer.address && r.json.buyer.zip === '94110' && r.json.area.inArea, 'saved address + ZIP persisted');

    console.log('Catalog');
    r = await call('GET', '/api/products');
    const prods = r.json.products;
    ok(prods.length > 5 && prods.every((p) => !('shopName' in p) && !JSON.stringify(p).includes('Demo Shop')), 'buyer catalog loads, no shop name');
    ok(prods.every((p) => p.stock && p.stock.total > 0), 'sold-out (0 stock) SKUs hidden from buyers');
    const prod = prods.find((p) => p.id === '2022-panini-score-football');

    console.log('Order + timeline (1), notify opt-in');
    r = await call('POST', '/api/orders', { productId: prod.id, windowId: prod.windows.find((w) => w.units > 0).id, buyerId: buyer, zip: '94110', notifyText: true, notifyPhone: '415-555-0123', pay: true });
    ok(r.status === 200 || r.status === 201, 'order created + paid (stub)');
    let o = r.json.order;
    ok(o.status === 'PAID' && o.timeline.some((t) => t.key === 'paid'), 'timeline has Paid message');
    ok(o.smsLog.some((s) => s.kind === 'order_paid' && s.simulated), 'simulated text logged for Paid');
    ok(!JSON.stringify(o.smsLog).includes('4155550123'), 'phone number is masked in log');
    const id = o.id;
    await call('POST', `/api/orders/${id}/start-pack`);
    r = await call('GET', '/api/orders/' + id);
    ok(r.json.order.timeline.some((t) => t.key === 'packing'), 'timeline has Packing');

    console.log('Packing checklist + box photo gate (9)');
    r = await call('POST', `/api/orders/${id}/pack-photo`, { toteQrPayload: 'VENDIPORT:ORDER:' + id });
    r = await call('POST', `/api/orders/${id}/seal`);
    r = await call('POST', `/api/orders/${id}/ready`);
    ok(r.status === 409 && /checklist/i.test(r.json.error), 'READY blocked until checklist + photo');
    r = await call('POST', `/api/orders/${id}/pack-checklist`, { checks: { item: true, factory: true, tote: true, zip: true } });
    ok(r.json.done === false, 'checklist without photo is not done');
    r = await call('POST', `/api/orders/${id}/pack-checklist`, { checks: { item: true, factory: true, tote: true, zip: true }, boxPhoto: PNG });
    ok(r.json.done === true, 'checklist + sealed-box photo => done');
    r = await call('POST', `/api/orders/${id}/ready`);
    ok(r.status === 200 && r.json.order.status === 'READY', 'READY allowed after checklist');
    r = await call('POST', `/api/orders/${id}/pickup`);
    ok(r.json.order.status === 'PICKED_UP', 'pickup => Out');
    r = await call('GET', '/api/orders/' + id);
    o = r.json.order;
    ok(['paid', 'packing', 'ready', 'out'].every((k) => o.timeline.some((t) => t.key === k)), 'timeline Paid/Packing/Ready/Out all present');
    ok(o.smsLog.length >= 4, 'simulated text log has all 4 updates');

    console.log('Handoff proof (2) + seal check (6)');
    ok(/^\d{4}$/.test(o.deliveryCode), 'delivery code issued');
    r = await call('POST', `/api/orders/${id}/arrive-proof`, { code: '0000' });
    ok(r.status === 409, 'wrong delivery code rejected');
    r = await call('POST', `/api/orders/${id}/arrive-proof`, { code: o.deliveryCode });
    ok(r.status === 200 && r.json.order.proofType === 'code' && r.json.order.arrivePhotoStub, 'delivery code unlocks handoff');
    r = await call('POST', `/api/orders/${id}/accept`, { qrPayload: 'VENDIPORT:ORDER:' + id, confirmImage: PNG, sealIntact: false, note: 'tear strip pulled' });
    ok(r.json.disputed === true && r.json.order.status === 'PICKED_UP', 'seal check "No" routes to dispute (not accepted)');
    r = await call('POST', `/api/orders/${id}/accept`, { qrPayload: 'VENDIPORT:ORDER:' + id, confirmImage: PNG, sealIntact: true });
    ok(r.status === 409, 'accept blocked while dispute is open');
    r = await call('GET', '/api/admin/disputes', null, A);
    const dp = r.json.disputes.find((d) => d.orderId === id);
    ok(dp && dp.photos.length >= 1 && dp.timestamps.length >= 4, 'admin dispute queue has photos + timestamps');
    r = await call('POST', `/api/admin/disputes/${dp.id}/resolve`, { outcome: 'dismiss' }, A);
    ok(r.json.dispute.status === 'resolved', 'admin resolves dispute');
    r = await call('POST', `/api/orders/${id}/accept`, { qrPayload: 'VENDIPORT:ORDER:' + id, confirmImage: PNG, sealIntact: true });
    ok(r.status === 200 && r.json.order.status === 'DELIVERED_ACCEPTED', 'seal "Yes" + QR => Accepted');

    console.log('Rating (7) + My Collection / breaks (19)');
    r = await call('POST', `/api/orders/${id}/rate`, { shop: 5, delivery: 4, comment: 'fast' });
    ok(r.status === 201 && r.json.order.rated, 'shop + delivery rating saved');
    r = await call('POST', `/api/orders/${id}/rate`, { shop: 5, delivery: 4 });
    ok(r.status === 409, 'cannot rate twice');
    r = await call('GET', '/api/collection?buyer=' + buyer);
    ok(r.json.items.length === 1 && r.json.items[0].delivered && r.json.totals.boxes === 1, 'delivered order auto-syncs into My Collection');
    ok(r.json.totals.spent > 40 && !JSON.stringify(r.json).match(/Demo Shop/), 'collection totals + store hidden');
    const line = r.json.items[0];
    r = await call('POST', '/api/breaks', { buyer, orderId: id, lineId: line.lineId, url: 'not a url', caption: 'x' });
    ok(r.status === 400, 'invalid link rejected');
    r = await call('POST', '/api/breaks', { buyer, orderId: id, lineId: line.lineId, url: 'https://www.tiktok.com/@a/video/7234567890123456789', caption: 'Rip!', hitsPulled: ['Kenny Pickett RC'], visibility: 'public', consentMarketing: true, photos: [PNG] });
    ok(r.status === 201 && r.json.break.platform.id === 'tiktok' && r.json.break.platform.embed, 'TikTok link detected + embedded');
    const brId = r.json.break.id;
    r = await call('POST', '/api/breaks', { buyer, orderId: id, url: 'https://youtu.be/dQw4w9WgXcQ', visibility: 'private' });
    ok(r.status === 201 && r.json.break.platform.id === 'youtube' && /youtube/.test(r.json.break.platform.embed), 'YouTube link => inline embed');
    r = await call('POST', '/api/breaks', { buyer, orderId: id, url: 'https://example.com/watch/123', visibility: 'private' });
    ok(r.json.break.platform.id === 'link' && !r.json.break.platform.embeddable, 'unknown site => "Watch on" card');
    r = await call('GET', '/api/breaks/public');
    ok(r.json.breaks.some((b) => b.id === brId) && !r.json.breaks.some((b) => b.visibility === 'private'), 'public gallery lists public breaks only');
    r = await call('GET', '/api/products');
    const pick = r.json.products.find((p) => p.id === prod.id).chaseTop3.find((c) => c.name === 'Kenny Pickett RC');
    ok(pick.pulled >= 1, 'hits pulled updates "Hits still available" status');
    r = await call('PATCH', '/api/breaks/' + brId + '?buyer=' + buyer, { visibility: 'private' });
    ok(r.json.break.visibility === 'private', 'public/private toggle');
    await call('PATCH', '/api/breaks/' + brId + '?buyer=' + buyer, { visibility: 'public' });
    r = await call('GET', '/api/breaks/' + brId + '/card.svg?buyer=' + buyer);
    ok(r.status === 200 && /VendiPort|Vendi/.test(r.text) && /<svg/.test(r.text), 'share card with VendiPort watermark');
    r = await call('POST', '/api/breaks/' + brId + '/share');
    ok(r.json.shares >= 1, 'share counter');
    r = await call('GET', '/api/admin/breaks', null, A);
    const adm = r.json.breaks.find((b) => b.id === brId);
    ok(adm && adm.consentMarketing && adm.marketingStatus === 'pending', 'admin content queue shows consented break');
    r = await call('POST', `/api/admin/breaks/${brId}/marketing`, { action: 'approve' }, A);
    ok(r.json.break.marketingStatus === 'approved', 'admin approves for marketing');
    r = await call('GET', `/api/admin/breaks/${brId}/download`, null, A);
    ok(r.status === 200 && r.json.platform === 'TikTok', 'admin download package');
    r = await call('GET', '/api/admin/breaks');
    ok(r.status === 401, 'admin API requires passcode');

    console.log('Radar / hits alerts (3,16) + Wanted feed (15)');
    r = await call('POST', '/api/radar', { buyer, label: 'Brock Purdy', kind: 'player', source: 'search' });
    ok(r.json.added && r.json.items.length === 1, 'add to Radar by typing');
    r = await call('POST', '/api/radar', { buyer, label: 'brock purdy' });
    ok(r.json.already === true, 'duplicate radar entry de-duped');
    r = await call('POST', '/api/radar', { buyer, label: 'Brock Purdy Mosaic RC', kind: 'card', source: 'chase' });
    r = await call('POST', '/api/radar', { buyer, label: 'Sauce Gardner RC', kind: 'card', source: 'chase', productId: prod.id });
    ok(r.json.items.some((i) => i.available.length), 'chase card shows availability ("On your radar")');
    const entry = r.json.items.find((i) => /Gardner/.test(i.label));
    r = await call('GET', '/api/wanted');
    const w = r.json.wanted.find((x) => /Brock Purdy Mosaic/i.test(x.label));
    ok(w && w.buyers >= 7 && w.buyers <= 8, 'Wanted feed aggregates (demo + real) anonymously');
    ok(!/buyer-smoke|4155550123|"buyer"|demo_\d/.test(JSON.stringify(r.json.wanted)), 'Wanted feed has no buyer ids/contact');
    r = await call('POST', '/api/wanted/have', { key: w.key });
    ok(r.json.status === 'flagged', '"I have this" flags when no stock');
    // list a matching box -> alerts queue
    r = await call('POST', '/api/products', { title: 'Brock Purdy Rookie Blaster', price: 40, units: 3 });
    await sleep(300);
    r = await call('GET', '/api/radar?buyer=' + buyer);
    ok(r.json.alerts.some((a) => a.type === 'radar_match' && /Purdy|Brock/i.test(a.text)), 'radar alert fired when matching item listed');
    ok(r.json.sms.some((s) => s.simulated), 'simulated text log for radar alert');
    r = await call('DELETE', '/api/radar/' + entry.id + '?buyer=' + buyer);
    ok(r.json.items.every((i) => i.id !== entry.id), 'remove from Radar');
    r = await call('GET', '/api/products?scope=shop');
    ok(r.json.products.some((p) => p.wantedBuyers > 0), 'shop inventory shows "Someone wants this" data');

    console.log('Zero-result search log + events');
    r = await call('GET', '/api/search?q=pokemon+booster+box');
    ok(r.json.results.length === 0, 'search no results');
    await call('POST', '/api/events', { type: 'browse' });
    await call('POST', '/api/events', { type: 'select' });

    console.log('Cancel with reason (5)');
    r = await call('POST', '/api/orders', { productId: prod.id, windowId: prod.windows.find((w) => w.units > 0).id, buyerId: buyer, pay: true });
    const cid = r.json.order.id;
    r = await call('POST', `/api/orders/${cid}/cancel`, { reason: 'Changed my mind' });
    ok(r.json.order.status === 'CANCELLED' && r.json.order.cancelReason === 'Changed my mind', 'one-tap cancel keeps reason');

    console.log('Stock + pause (8, 11) + earnings (10)');
    r = await call('GET', '/api/products?scope=shop');
    const lowish = r.json.products.find((p) => p.id === '2021-panini-score-football');
    ok(lowish.stock.low, 'low-stock flagged on shop inventory');
    await call('PATCH', '/api/products/2021-panini-score-football', { soldOut: true });
    r = await call('GET', '/api/products');
    ok(!r.json.products.some((p) => p.id === '2021-panini-score-football'), 'product auto-hides at 0 stock');
    r = await call('POST', '/api/shop/pause', { paused: true, reason: 'Closing early' });
    ok(r.json.paused, 'pause on');
    r = await call('GET', '/api/products');
    ok(r.json.products.length === 0 && r.json.paused, 'paused shop hides all SKUs');
    r = await call('POST', '/api/orders', { productId: prod.id, windowId: prod.windows[0].id });
    ok(r.status === 409, 'cannot order while paused');
    await call('POST', '/api/shop/pause', { paused: false });
    r = await call('GET', '/api/products');
    ok(r.json.products.length > 3, 'resume shows SKUs again');
    r = await call('GET', '/api/shop/earnings');
    ok(r.json.today.delivered === 1 && r.json.today.net > 30, 'earnings summary counts the delivered order');

    console.log('Out-of-area order blocked (4)');
    r = await call('POST', '/api/orders', { productId: prod.id, windowId: prod.windows.find((w) => w.units > 0).id, zip: '10001' });
    ok(r.status === 409 && /ship-only/.test(r.json.error), 'out-of-area ZIP => ship-only, no same-day order');

    console.log('Admin dashboard (12, 18)');
    r = await call('POST', '/api/admin/login', { passcode: 'nope' });
    ok(r.status === 401, 'wrong passcode rejected');
    r = await call('POST', '/api/admin/login', { passcode: PASS });
    ok(r.status === 200, 'passcode login');
    r = await call('GET', '/api/admin/overview', null, A);
    const ov = r.json;
    ok(ov.dashboard.ordersToday >= 2 && 'lateOrders' in ov.dashboard && 'refundRatePct' in ov.dashboard, 'dashboard: orders today / late / refund rate');
    ok(ov.dashboard.awaitingVerification >= 3, 'dashboard: shops awaiting verification (seeded demo)');
    ok(ov.demand.top.length && ov.demand.byZip.length && ov.demand.recruit.length, 'owner diag: demand + ZIP vs stores + recruit list');
    ok(ov.sales.real.orders >= 1 && ov.sales.demo.daily.length, 'owner diag: sales (real + labelled demo)');
    ok(ov.fulfillment.real.paidToPackedMins != null, 'owner diag: fulfillment timings from real orders');
    ok(ov.product.real.funnel.browse >= 1, 'owner diag: funnel events recorded');
    ok(ov.demand.zeroSearches.some((z) => /pokemon/.test(z.q) && !z.demo), 'owner diag: zero-result searches (real)');
    r = await call('GET', '/api/admin/verification', null, A);
    const pend = r.json.verification.find((v) => v.status === 'pending');
    r = await call('POST', `/api/admin/verification/${pend.id}/approve`, {}, A);
    ok(r.json.verification.status === 'approved', 'shop approval screen: approve');

    console.log('Static pages');
    for (const p of ['/', '/shop', '/account', '/admin', '/collection', '/radar', '/breaks', '/track/x', '/handoff/x']) {
      r = await call('GET', p);
      ok(r.status === 200 && /<html/i.test(r.text), 'GET ' + p);
    }
  } catch (e) {
    fails++; console.log('  ✗ crashed:', e.stack);
  } finally {
    srv.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
  }
  console.log(`\n${n - fails}/${n} checks passed`);
  process.exit(fails ? 1 : 0);
})();
