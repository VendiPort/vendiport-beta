'use strict';
/** Dispute engine: evidence record, credibility hints, claim history, recommendation, owner actions,
 *  fault consequences, pattern view, resolution log. Pure logic over extras state + orders. */

const DAY = 864e5;
const FAULTS = ['shop', 'delivery', 'buyer', 'unclear'];
const ACTIVE = ['open', 'awaiting_proof'];
const STATUS_LABEL = { open: 'Open', awaiting_proof: 'Awaiting proof', denied: 'Claim denied', resolved: 'Resolved' };

// Standard neutral denial wording — fixed text, no admissions / guarantees / fault language.
const DENY_TEXT = 'We have completed our review of your claim based on the records for this order, including the packaging photos, the delivery photo, and the QR scan records. Based on that review, we are unable to approve your claim, and no refund or replacement will be issued for this order. This decision is based on the information available to us and does not waive any of VendiPort\'s rights or any provision of the Terms of Service. If you have additional information, you may submit it within 7 days and we will consider it.';

const norm = (s) => String(s || '').trim().toUpperCase();
const ts = (x) => Date.parse(x) || 0;
const mins = (a, b) => (a && b ? Math.round((ts(b) - ts(a)) / 60000) : null);
const human = (m) => (m < 90 ? m + ' min' : m < 2880 ? Math.round(m / 60) + ' h' : Math.round(m / 1440) + ' days');
const money = (n) => '$' + Number(n || 0).toFixed(2);

function err(status, message, extra) { const e = new Error(message); e.status = status; Object.assign(e, extra || {}); return e; }

function createDisputes(c) {
  const { S, findOrder, saveOrder, profile, shopName, maskPhone, store, uid } = c;
  const now = () => new Date().toISOString();

  // ---------------- evidence record ----------------
  /** Photos, QR scans and timestamps for one real order (demo disputes carry a stored copy). */
  function evidenceFor(o) {
    o = o || {};
    const tl = (k) => ((o.timeline || []).find((t) => t.key === k) || {}).at || null;
    const b = o.packBefore || null, a = o.packAfter || null;
    return {
      before: b ? { photo: b.photo || null, stub: !!b.stub, at: b.at, qr: b.qr } : null,
      after: a ? { photo: a.photo || null, stub: !!a.stub, at: a.at, qr: a.qr } : null,
      door: {
        photo: o.arriveProofPhoto || null, proofType: o.proofType || null, proofAt: o.proofAt || null,
        qrScanPhoto: o.confirmImage || null, qrScannedAt: o.qrScannedAt || null, qrScanned: o.qrScannedPayload || null, qrMatched: !!o.qrVerified,
      },
      outAt: tl('out'), arrivedAt: tl('arrived'), acceptedAt: o.acceptedAt || null, refusedAt: o.refusedAt || null,
      dispatch: o.dispatch ? { mode: o.dispatch.mode, status: o.dispatch.status, at: o.dispatch.at, driverId: o.dispatch.driverId } : null,
    };
  }
  /** What the buyer may see on their own order page (no internal scoring). */
  function publicEvidence(o) {
    const e = evidenceFor(o);
    return { before: e.before, after: e.after, door: e.door, arrivedAt: e.arrivedAt, acceptedAt: e.acceptedAt, refusedAt: e.refusedAt, qrChain: qrChain(e) };
  }
  function qrChain(e) {
    const shop = !!(e.before && e.after && norm(e.before.qr) === norm(e.after.qr));
    const door = !!(e.door && e.door.qrMatched);
    return { shopQrMatch: shop, doorQrMatch: door };
  }

  // ---------------- claim history ----------------
  function history(d) {
    const all = S().disputes;
    const end = ts(d.openedAt), from = end - 30 * DAY;
    const w = (x) => ts(x.openedAt) >= from && ts(x.openedAt) <= end;
    const byBuyer = d.buyer ? all.filter((x) => x.buyer === d.buyer) : [d];
    const byShop = all.filter((x) => x.shopId === d.shopId);
    const byDriver = d.driverId ? all.filter((x) => x.driverId === d.driverId) : [];
    const b30 = byBuyer.filter(w).length, s30 = byShop.filter(w).length, v30 = byDriver.filter(w).length;
    const strikes = d.buyer ? (profile(d.buyer).strikes || 0) : 0;
    return {
      buyer: { total: byBuyer.length, d30: b30, prior30: Math.max(0, b30 - 1), strikes, repeat: b30 >= 2, hold: b30 - 1 >= 2 || strikes >= 2 },
      shop: { id: d.shopId, name: d.shopName, total: byShop.length, d30: s30, repeat: s30 >= 3 },
      driver: { id: d.driverId || null, label: driverLabel(d.driverId), total: byDriver.length, d30: v30, repeat: v30 >= 2, faults: byDriver.filter((x) => x.fault === 'delivery').length },
    };
  }
  const driverLabel = (id) => (id ? (/^own_/.test(id) ? 'Shop driver' : 'Courier #' + String(id).replace(/\D/g, '')) : '—');

  // ---------------- recommendation ----------------
  function recommend(d, ev, hist) {
    const hints = [];
    const H = (tone, text) => hints.push({ tone, text });
    const accepted = d.channel === 'claim_after_accept';
    const refused = d.channel === 'refused_at_door';
    const hasB = !!ev.before, hasA = !!ev.after;
    const shopQr = hasB && hasA && norm(ev.before.qr) === norm(ev.after.qr);
    const sealedRecord = hasB && hasA && shopQr;
    let score = 0;

    if (accepted) {
      const g = mins(ev.acceptedAt || ev.arrivedAt, d.openedAt);
      H('bad', `Buyer accepted the delivery at the door${g != null ? (g < 2 ? ' and reported right after' : ' and reported ' + human(g) + ' later') : ''} — claims after acceptance are weak by default.`);
      if (ev.door && ev.door.qrMatched) H('good', 'Door QR scan matched the bag QR from the shop photos.');
    } else {
      const g = mins(ev.arrivedAt, d.openedAt);
      if (g == null) { score -= 2; H('bad', 'No Arrived event — the report cannot be tied to the door handoff (weak).'); }
      else if (g <= 30) { score += 2; H('good', `Reported ${Math.max(0, g)} min after arrival (within ~30 min) — credible timing.`); }
      else if (g <= 120) H('warn', `Reported ${human(g)} after arrival — borderline timing.`);
      else { score -= 2; H('bad', `Reported ${human(g)} after arrival — long after the handoff (weak).`); }
    }

    if (!hasA) { score += 2; H('warn', 'Shop has no sealed-bag photo (Photo 2) — cannot show the bag left sealed.'); }
    else if (!shopQr) { score += 3; H('bad', 'QR on the sealed-bag photo does not match the original scan (Photo 1).'); }
    else { score -= 1; H('good', 'Shop record: Photo 1 (before sealing) and Photo 2 (sealed, QR-in-V) are tied to the same QR scan.'); }
    if (!hasB) { score += 1; H('warn', 'No Photo 1 (product on the bag QR) on record.'); }

    if (!accepted) {
      if (ev.door && (ev.door.reportPhoto || ev.door.photo)) { score += 1; H('good', 'Buyer attached a door photo.'); }
      else { score -= 1; H('warn', 'No buyer door photo — note only.'); }
    }
    if (hist.buyer.repeat) { score -= 2; H('bad', `Repeat claimant: ${hist.buyer.d30} claims in 30 days${hist.buyer.strikes ? ' · ' + hist.buyer.strikes + ' strike(s)' : ''}.`); }
    if (hist.shop.repeat) { score += 1; H('warn', `Repeat store: ${hist.shop.d30} claims in 30 days.`); }
    if (hist.driver.repeat) H('warn', `Repeat driver: ${hist.driver.label} has ${hist.driver.d30} claims in 30 days.`);
    if (hist.buyer.hold) H('bad', 'Refunds are on hold for review for this buyer (2+ prior claims in 30 days or 2 strikes).');

    const proofs = d.buyerProof || [];
    if (d.status === 'awaiting_proof') {
      if (proofs.length) { score += 1; H('good', `Buyer sent ${proofs.length} extra item(s) of proof.`); }
      else if (d.proofDeadline && Date.now() > ts(d.proofDeadline)) { score -= 3; H('bad', 'No extra proof received by the 24-hour deadline.'); }
      else H('warn', 'Waiting for the buyer’s extra proof (24-hour deadline).');
    }

    let action, label, reason;
    if (accepted) {
      if (sealedRecord) { action = 'deny'; reason = 'Accepted at the door and the shop’s two-photo record is consistent — claim is weak.'; }
      else { action = 'proof'; reason = 'Accepted at the door, but the shop’s two-photo record is incomplete — ask for more proof first.'; }
    } else if (score >= 3) { action = 'refund'; reason = refused ? 'Timely report and the shop record does not clearly show a sealed bag — confirm the refund and review the shop.' : 'Timely report and the shop record does not clearly show a sealed bag — refund or replace.'; }
    else if (score <= -1) { action = 'deny'; reason = 'Report is weak (timing / evidence / history) and the shop record is consistent.'; }
    else { action = 'proof'; reason = 'Evidence is mixed — request more proof before deciding.'; }
    if (d.status === 'awaiting_proof' && !proofs.length && d.proofDeadline && Date.now() > ts(d.proofDeadline)) { action = 'deny'; reason = 'No additional proof arrived by the 24-hour deadline.'; }
    if (refused && action === 'deny') { label = 'Close — refund stands'; reason = 'Refunded at the door automatically. ' + reason + ' Record fault and any strike; no shop charge.'; }
    else label = { refund: refused ? 'Confirm refund (clear tamper)' : 'Refund / Replace (clear tamper)', proof: 'Request more proof', deny: 'Deny claim' }[action];
    if (refused && action === 'refund') reason = 'Timely report and the shop record does not clearly show a sealed bag — refund stands; consider charging the shop.';
    return { rec: { action: refused && action === 'deny' ? 'close' : action, label, reason, score }, hints };
  }

  // ---------------- views ----------------
  function buildTimeline(d, ev) {
    const t = [];
    const add = (label, at) => { if (at) t.push({ label, at }); };
    if (d.demo && Array.isArray(d.timestamps)) d.timestamps.forEach((x) => add(x.label, x.at));
    else {
      const o = findOrder(d.orderId) || {};
      (o.timeline || []).forEach((x) => add(x.key[0].toUpperCase() + x.key.slice(1), x.at));
      add('Photo 1 · before sealing', ev.before && ev.before.at);
      add('Photo 2 · sealed', ev.after && ev.after.at);
      add('Door QR scan', ev.door && ev.door.qrScannedAt);
    }
    add('Claim opened', d.openedAt);
    if (d.proofRequestedAt) add('Proof requested', d.proofRequestedAt);
    if (d.proofReceivedAt) add('Proof received', d.proofReceivedAt);
    if (d.resolvedAt) add('Resolved', d.resolvedAt);
    return t.sort((a, b) => ts(a.at) - ts(b.at)).filter((x, i, arr) => arr.findIndex((y) => y.label === x.label && y.at === x.at) === i);
  }
  function view(d) {
    const o = d.demo ? null : findOrder(d.orderId);
    const ev = d.demo ? JSON.parse(JSON.stringify(d.evidence || {})) : evidenceFor(o);
    ev.door = ev.door || {};
    if (d.buyerPhoto) ev.door.reportPhoto = d.buyerPhoto;
    const hist = history(d);
    const { rec, hints } = recommend(d, ev, hist);
    const photos = [];
    if (ev.before && ev.before.photo) photos.push({ label: 'Photo 1 · before sealing', url: ev.before.photo });
    if (ev.after && ev.after.photo) photos.push({ label: 'Photo 2 · sealed bag', url: ev.after.photo });
    if (ev.door.reportPhoto || ev.door.photo) photos.push({ label: 'Buyer door photo', url: ev.door.reportPhoto || ev.door.photo });
    if (ev.door.qrScanPhoto) photos.push({ label: 'Door QR scan', url: ev.door.qrScanPhoto });
    const timeline = buildTimeline(d, ev);
    return Object.assign({}, d, {
      evidence: ev, photos, timeline, timestamps: timeline, hints, history: hist, recommendation: rec,
      statusLabel: STATUS_LABEL[d.status] || d.status,
      productTitle: d.productTitle || (o && o.productTitle) || '', total: d.total != null ? d.total : (o && o.total) || 0,
      productPrice: d.productPrice != null ? d.productPrice : (o && o.productPrice) || 0,
      refundHold: !!(d.refundHold || hist.buyer.hold), canAct: ACTIVE.includes(d.status),
      qrChain: qrChain(ev),
    });
  }

  // ---------------- notify buyer ----------------
  function tell(d, o, kind, text) {
    d.messages = d.messages || [];
    d.messages.push({ from: 'VendiPort', kind, text, at: now() });
    if (o && o.notify && o.notify.optIn && o.notify.phone) {
      S().sms.push({ id: uid('sms'), buyer: o.buyerId || null, orderId: o.id, to: maskPhone(o.notify.phone), text: 'VendiPort: ' + text, at: now(), kind: 'claim_' + kind, simulated: true });
    }
  }
  const logRow = (d, row) => { d.log = d.log || []; d.log.push(Object.assign({ at: now(), by: 'Owner (admin)' }, row)); };

  // ---------------- owner actions ----------------
  function resolve(d, body) {
    const action = ({ refund: 'refund', replace: 'replace', proof: 'proof', deny: 'deny', close: 'close', dismiss: 'deny' })[String(body.action || body.outcome || '')];
    if (!action) throw err(400, 'Choose an action: refund, replace, proof, deny or close');
    if (!ACTIVE.includes(d.status)) throw err(409, 'This claim is already closed');
    if (action === 'proof' && d.status === 'awaiting_proof') throw err(409, 'Proof was already requested');
    if (action === 'deny' && d.channel === 'refused_at_door') throw err(409, 'This order was refunded at the door — use Close (refund stands), or choose fault and consequences.');
    const fault = FAULTS.includes(body.fault) ? body.fault : 'unclear';
    const note = String(body.note || '').trim().slice(0, 400);
    const o = d.demo ? null : findOrder(d.orderId);
    const sale = +(Number(d.productPrice != null ? d.productPrice : o && o.productPrice) || 0).toFixed(2);
    const total = +(Number(d.total != null ? d.total : o && o.total) || sale).toFixed(2);
    const hist = history(d);

    if ((action === 'replace' || (action === 'refund' && !d.refund)) && hist.buyer.hold && !body.overrideHold) {
      d.refundHold = true; store.save();
      throw err(409, `Refund held for review — this buyer has ${hist.buyer.d30} claims in 30 days${hist.buyer.strikes ? ' and ' + hist.buyer.strikes + ' strike(s)' : ''}. Send overrideHold:true to release it.`, { held: true });
    }

    const row = { action, fault, note, amount: 0 };
    if (action === 'proof') {
      d.status = 'awaiting_proof';
      d.proofRequestedAt = now();
      d.proofDeadline = new Date(Date.now() + DAY).toISOString();
      tell(d, o, 'proof', 'We need additional information to review your claim. Please add a photo or note on your order page within 24 hours. If we do not receive it, we will complete our review with the records available.' + (note ? ' ' + note : ''));
      row.outcome = 'Proof requested (24h)';
    } else if (action === 'deny') {
      d.status = 'denied'; d.outcome = 'denied'; d.resolvedAt = now();
      d.denial = { at: d.resolvedAt, note, message: DENY_TEXT };
      tell(d, o, 'denied', DENY_TEXT + (note ? '\n\nAdditional note: ' + note : ''));
      row.outcome = 'Claim denied';
    } else if (action === 'close') {
      d.status = 'resolved'; d.outcome = 'closed'; d.resolvedAt = now();
      row.outcome = 'Closed — refund stands'; row.amount = d.refund ? d.refund.amount : 0;
    } else {
      d.status = 'resolved'; d.resolvedAt = now();
      if (action === 'refund') {
        d.outcome = 'refunded';
        if (d.refund) row.amount = d.refund.amount; // already refunded at the door
        else {
          d.refund = { amount: total, returnRequired: false, at: now() };
          row.amount = total;
          if (o && !o.refundStub) {
            if (o.status !== 'DELIVERED_ACCEPTED') o.status = 'REFUSED_SEAL';
            o.refundStub = { amount: o.total, fee: 0, note: 'Full refund — claim approved, no return required (stub).' };
            o.refusedAt = o.refusedAt || now(); o.updatedAt = now();
            saveOrder(o);
          }
        }
        tell(d, o, 'refund', `Your claim has been reviewed. A refund of ${money(row.amount)} has been issued to your original payment method. No return is required.`);
        row.outcome = 'Refunded' + (row.amount ? ' ' + money(row.amount) : '') + ' · no return';
      } else {
        d.outcome = 'replaced';
        d.replacement = { status: 'queued', at: now(), cost: sale };
        if (o) { o.replacementStub = d.replacement; o.updatedAt = now(); saveOrder(o); }
        tell(d, o, 'replace', 'Your claim has been reviewed. A replacement box has been queued for delivery.');
        row.outcome = 'Replacement queued';
      }
    }

    // ---- fault attribution + consequences (not for "request proof") ----
    if (action !== 'proof') {
      d.fault = fault;
      const shopId = d.shopId || (o && o.shopId);
      if (fault === 'shop' && body.chargeShop) {
        if (!(S().payoutAdjustments || []).some((a) => a.disputeId === d.id)) {
          S().payoutAdjustments.push({ id: uid('adj'), shopId, shopName: shopName(shopId), amount: -sale, orderId: d.orderId, last4: d.last4, disputeId: d.id, reason: 'Seal claim charged to shop (order amount)', at: now(), demo: !!d.demo });
        }
        d.chargedShop = sale; row.charged = sale;
      } else if (fault === 'delivery') {
        d.absorbed = (action === 'refund' || action === 'replace') ? (action === 'refund' ? total : sale) : 0;
        row.absorbed = d.absorbed;
        d.driverFault = true;
      } else if (fault === 'buyer') {
        if (d.buyer) { const p = profile(d.buyer); p.strikes = (p.strikes || 0) + 1; row.strikes = p.strikes; }
        d.buyerStrike = true;
      }
    }
    logRow(d, row);
    store.save();
    return view(d);
  }

  /** Buyer adds an extra photo / note after "Request more proof". */
  function submitProof(order, body, savePhoto) {
    const d = S().disputes.find((x) => x.id === order.disputeId);
    if (!d || d.status !== 'awaiting_proof') throw err(409, 'VendiPort has not asked for more proof on this order.');
    if (d.proofDeadline && Date.now() > ts(d.proofDeadline)) throw err(409, 'The 24-hour window to add proof has passed.');
    const note = String(body.note || '').trim().slice(0, 500);
    const photo = savePhoto(body.photo);
    if (!note && !photo) throw err(400, 'Add a photo or a short note.');
    d.buyerProof = d.buyerProof || [];
    d.buyerProof.push({ photo: photo || null, note, at: now() });
    d.proofReceivedAt = now();
    d.status = 'open';
    d.messages = (d.messages || []).concat([{ from: 'You', kind: 'proof', text: note || 'Photo added', at: now() }]);
    store.save();
    return d;
  }

  function claimFor(o) {
    const d = o.disputeId && S().disputes.find((x) => x.id === o.disputeId);
    if (!d) return null;
    return {
      id: d.id, status: d.status, statusLabel: STATUS_LABEL[d.status] || d.status, channel: d.channel || null, openedAt: d.openedAt,
      messages: d.messages || [], proofDeadline: d.proofDeadline || null,
      canSubmitProof: d.status === 'awaiting_proof' && (!d.proofDeadline || Date.now() < ts(d.proofDeadline)),
      refundIssued: !!d.refund, replacement: d.replacement ? d.replacement.status : null, outcome: d.outcome || null,
    };
  }

  // ---------------- pattern view + resolution log ----------------
  function patterns() {
    const all = S().disputes;
    const since = Date.now() - 30 * DAY;
    const build = (keyOf, nameOf, repeatAt, conseq, extra) => {
      const m = {};
      for (const d of all) {
        const k = keyOf(d); if (!k) continue;
        const r = (m[k] = m[k] || { id: k, name: nameOf(d, k), total: 0, d30: 0, demoAll: true, faults: 0 });
        r.total++; if (ts(d.openedAt) >= since) r.d30++;
        if (!d.demo) r.demoAll = false;
        if (extra) extra(r, d);
      }
      return Object.values(m).map((r) => Object.assign(r, { demo: r.demoAll, repeat: r.d30 >= repeatAt, consequence: conseq(r) })).sort((a, b) => b.d30 - a.d30 || b.total - a.total);
    };
    return {
      stores: build((d) => d.shopId, (d) => d.shopName || shopName(d.shopId), 3,
        (r) => (r.d30 >= 3 ? 'Listing review + rating hit' : r.d30 >= 2 ? 'Watch — rating hit if repeated' : '—'), (r, d) => { if (d.fault === 'shop') r.faults++; }),
      drivers: build((d) => d.driverId, (d, k) => driverLabel(k), 2,
        (r) => (r.d30 >= 2 ? 'Driver review' : '—'), (r, d) => { if (d.fault === 'delivery') r.faults++; }),
      buyers: build((d) => d.buyer, (d, k) => 'Buyer …' + String(k).slice(-4), 2,
        (r) => (r.d30 >= 3 ? 'Hold refunds for review + strike' : r.d30 >= 2 ? 'Watch — refund hold at 3rd claim' : '—'),
        (r, d) => { r.strikes = (S().buyers[d.buyer] || {}).strikes || 0; if (d.fault === 'buyer') r.faults++; }),
    };
  }
  function logRows() {
    const rows = [];
    for (const d of S().disputes) for (const l of d.log || []) rows.push(Object.assign({ disputeId: d.id, last4: d.last4, shopName: d.shopName, demo: !!d.demo }, l));
    return rows.sort((a, b) => ts(b.at) - ts(a.at));
  }
  function adjustmentsByShop() {
    const m = {};
    for (const a of S().payoutAdjustments || []) { const r = (m[a.shopId] = m[a.shopId] || { shopId: a.shopId, shopName: a.shopName || shopName(a.shopId), total: 0, count: 0, demo: true }); r.total += a.amount; r.count++; if (!a.demo) r.demo = false; }
    return Object.values(m).map((r) => Object.assign(r, { total: +r.total.toFixed(2) }));
  }

  return { evidenceFor, publicEvidence, view, resolve, submitProof, claimFor, patterns, logRows, adjustmentsByShop, history, DENY_TEXT, STATUS_LABEL, ACTIVE, qrChain };
}

module.exports = { createDisputes, DENY_TEXT, FAULTS };
