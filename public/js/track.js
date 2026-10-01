/* Track order — /track/<id> or /order/<id> — survives refresh */
// TRACK_STREAM comes from session.js (was duplicated here, which broke this page)

let trackCatalog = null;
let currentTrackOrder = null;

function orderIdFromPath() {
  const parts = location.pathname.split('/').filter(Boolean);
  if ((parts[0] === 'track' || parts[0] === 'order') && parts[1]) return parts[1];
  const q = new URLSearchParams(location.search).get('id');
  return q || '';
}

function trackKey(order) {
  const st = order.status;
  if (st === 'CANCELLED') return 'paid';
  if (st === 'DELIVERED_ACCEPTED' || st === 'REFUSED_SEAL') return 'accept';
  if (st === 'PICKED_UP') return order.arrivePhotoStub ? 'arrive' : 'out';
  if (st === 'READY') return 'ready';
  if (st === 'PACKING') return 'pack';
  if (st === 'PAID') return 'paid';
  return 'paid';
}

function pulseText(order) {
  const st = order.status;
  if (st === 'PAID') return 'Paid — shop will pack your sealed tote…';
  if (st === 'PACKING') return 'Packing — product going into tote (QR on bag in frame)…';
  if (st === 'READY') return 'Ready — awaiting pickup';
  if (st === 'PICKED_UP') {
    return order.arrivePhotoStub
      ? 'Arrived — scan or upload the QR on your tote bag'
      : 'Out for delivery…';
  }
  if (st === 'DELIVERED_ACCEPTED') return 'Accepted — sale final (tote QR matched)';
  if (st === 'REFUSED_SEAL') return 'Refused seal / tote QR — full refund stub';
  if (st === 'CANCELLED') return 'Cancelled';
  return `Status: ${st}`;
}

function visual(order) {
  if (order.productImage) {
    return `<img src="${escapeHtml(order.productImage)}" alt="" /><div class="glass-sheen" aria-hidden="true"></div>`;
  }
  const emoji = order.productEmoji || '🎴';
  return `<div class="fallback-tile"><div class="emoji">${emoji}</div><div class="code">${escapeHtml((order.productTitle || 'VP').slice(0, 3).toUpperCase())}</div></div><div class="glass-sheen" aria-hidden="true"></div>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function linesHtml(order) {
  const lines = order.lineItems || [];
  if (!lines.length) return '';
  return `
    <div class="panel">
      <div class="panel-label">Order lines</div>
      ${lines
        .map(
          (l) => `<div class="line"><span class="muted">${escapeHtml(l.title)}${l.paid === false ? ' (unpaid)' : ''}</span><span>${money(l.price)}</span></div>`
        )
        .join('')}
      <div class="line"><span class="muted">Delivery</span><span>${money(order.deliveryFee)}</span></div>
      ${order.guestFee ? `<div class="line"><span class="muted">Guest fee</span><span>${money(order.guestFee)}</span></div>` : ''}
      <div class="line total"><span>Total</span><span>${money(order.total)}</span></div>
    </div>`;
}

function codePanelHtml(order) {
  if (order.status !== 'PICKED_UP' || !order.deliveryCode) return '';
  return `<div class="panel"><div class="panel-label">Delivery code</div>
    <div class="vp-code"><div class="cap">Read this to the courier</div><div class="num">${escapeHtml(order.deliveryCode)}</div></div>
    <p class="vp-hint" style="margin:0">The courier enters this code (or snaps photo proof) at the door. Then you do the seal check on the <a href="${escapeHtml(order.handoffUrl || '#')}">handoff page</a>.</p>
    ${order.proofType ? `<p class="vp-hint" style="color:#7fe6dc">✓ Handoff proof recorded (${order.proofType === 'code' ? 'delivery code' : 'photo'}).</p>` : `<div class="vp-row" style="margin-top:10px"><input class="vp-input" id="proof-code" inputmode="numeric" maxlength="4" placeholder="Courier: enter code" /><button type="button" class="vp-btn" id="proof-go">Verify</button></div>
    <button type="button" class="vp-btn ghost block sm" id="proof-photo" style="margin-top:8px">📷 Photo proof instead (stub)</button><input type="file" id="proof-file" accept="image/*" capture="environment" class="hidden" />`}
  </div>`;
}

function ratingHtml(order) {
  if (order.status !== 'DELIVERED_ACCEPTED') return '';
  if (order.rated) return `<div class="panel"><div class="panel-label">Your rating</div><p style="font-size:13px;margin:0">Shop ${'★'.repeat(order.rating.shop)} · Delivery ${'★'.repeat(order.rating.delivery)} — thanks!</p>
    <a class="vp-btn block" style="display:block;text-align:center;text-decoration:none;margin-top:10px" href="/collection">▣ Add your box break → My Collection</a></div>`;
  return `<div class="panel" id="rate-panel"><div class="panel-label">Rate your order</div>
    <div class="vp-row" style="justify-content:space-between"><span style="font-size:13px">The shop (packing &amp; seal)</span><span class="vp-stars" data-k="shop"></span></div>
    <div class="vp-row" style="justify-content:space-between;margin-top:6px"><span style="font-size:13px">The delivery</span><span class="vp-stars" data-k="delivery"></span></div>
    <input class="vp-input" id="rate-comment" placeholder="Anything to add? (optional)" maxlength="200" style="margin-top:10px" />
    <button type="button" class="vp-btn block" id="rate-go" style="margin-top:10px">Send rating</button>
    <a class="vp-btn ghost block" style="display:block;text-align:center;text-decoration:none;margin-top:8px" href="/collection">▣ Log your box break → My Collection</a></div>`;
}

function wireRating(order) {
  const pr = qs('#proof-go');
  if (pr) {
    pr.addEventListener('click', async () => {
      try { const r = await api(`/api/orders/${order.id}/arrive-proof`, { method: 'POST', body: JSON.stringify({ code: qs('#proof-code').value.trim() }) }); toast('Delivery code verified'); renderTrack(r.order); } catch (e) { toast(e.message); }
    });
    const pb = qs('#proof-photo'), pf = qs('#proof-file');
    pb.addEventListener('click', () => pf.click());
    pf.addEventListener('change', async () => {
      const f = pf.files && pf.files[0]; if (!f) return;
      const url = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
      try { const r = await api(`/api/orders/${order.id}/arrive-proof`, { method: 'POST', body: JSON.stringify({ photo: url }) }); toast('Photo proof saved (stub)'); renderTrack(r.order); } catch (e) { toast(e.message); }
    });
  }
  const panel = qs('#rate-panel');
  if (!panel) return;
  const val = { shop: 0, delivery: 0 };
  panel.querySelectorAll('.vp-stars').forEach((el) => {
    const k = el.dataset.k;
    const paint = () => { el.innerHTML = [1, 2, 3, 4, 5].map((n) => `<button type="button" class="${n <= val[k] ? 'on' : ''}" data-n="${n}" aria-label="${n} star">★</button>`).join(''); el.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { val[k] = +b.dataset.n; paint(); })); };
    paint();
  });
  qs('#rate-go').addEventListener('click', async () => {
    if (!val.shop || !val.delivery) return toast('Tap stars for both the shop and the delivery');
    try { const r = await api(`/api/orders/${order.id}/rate`, { method: 'POST', body: JSON.stringify({ shop: val.shop, delivery: val.delivery, comment: qs('#rate-comment').value }) }); toast('Thanks for rating!'); renderTrack(r.order); } catch (e) { toast(e.message); }
  });
}

const CANCEL_REASONS = ['Changed my mind', 'Ordered the wrong box', 'Found it elsewhere', 'Delivery time too late', 'Other'];
function openCancelSheet(order, fee) {
  const body = VPX.openSheet('Cancel order', 'One tap · refund on its way', `
    <p class="vp-hint" style="margin:0 0 8px">Why are you cancelling? (helps us improve)</p>
    ${CANCEL_REASONS.map((r, i) => `<label class="vp-check"><input type="radio" name="cr" value="${escapeHtml(r)}" ${i === 0 ? 'checked' : ''}/> <span>${escapeHtml(r)}</span></label>`).join('')}
    <div class="panel" style="margin:12px 0 0"><div class="line"><span class="muted">Cancel fee (15% of product)</span><span>${money(fee)}</span></div><div class="line"><span class="muted">Delivery fee</span><span>Refunded</span></div></div>
    <button type="button" class="vp-btn red block" id="cx-go" style="margin-top:12px;min-height:50px;font-size:15px">Cancel &amp; refund</button>
    <button type="button" class="vp-btn ghost block" id="cx-no" style="margin-top:8px">Keep my order</button>`);
  body.querySelector('#cx-no').addEventListener('click', VPX.closeSheet);
  body.querySelector('#cx-go').addEventListener('click', async () => {
    const reason = (body.querySelector('input[name=cr]:checked') || {}).value || 'Other';
    try { const { order: o } = await api(`/api/orders/${order.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }); VPX.closeSheet(); toast(`Cancelled · refund started · fee ${money(o.cancelFee || 0)}`); renderTrack(o); } catch (e) { toast(e.message); }
  });
}
function wireCancelQuick(order) {
  // One-tap cancel button lives at top of the order card for any cancelable order
  if (!order.cancelAllowed) return;
  const hero = qs('.co-hero-copy');
  if (!hero || qs('#quick-cancel')) return;
  const b = document.createElement('button');
  b.type = 'button'; b.id = 'quick-cancel'; b.className = 'vp-btn red sm'; b.style.marginTop = '10px'; b.textContent = 'Cancel & refund';
  b.addEventListener('click', () => openCancelSheet(order, order.cancelFeeEstimate != null ? order.cancelFeeEstimate : +(Number(order.productPrice || 0) * 0.15).toFixed(2)));
  hero.appendChild(b);
}

function pendingHtml(order) {
  const p = order.pendingAddon;
  if (!p || !(p.lines || []).length) return '';
  return `
    <div class="panel alert" id="pending-addon-panel">
      <div class="panel-label" style="color:#ff8a8a">Add-on awaiting pay stub</div>
      ${(p.lines || [])
        .map((l) => `<div class="line"><span class="muted">${escapeHtml(l.title)}</span><span>${money(l.price)}</span></div>`)
        .join('')}
      <div class="line total"><span>Due now (stub)</span><span>${money(p.delta)}</span></div>
      <p style="font-size:12px;color:var(--muted);margin:8px 0 0;line-height:1.4">
        Shop is alerted only after you pay the add-on stub.
      </p>
      <button type="button" class="pay-stub" id="track-pay-addon" style="margin-top:10px">
        Pay stub ${money(p.delta)} for add-on
        <span class="subline">No real Stripe required</span>
      </button>
      <button type="button" class="btn btn-ghost btn-block btn-sm" id="track-clear-addon" style="margin-top:8px">Discard add-on</button>
    </div>`;
}

async function ensureCatalog() {
  if (trackCatalog) return trackCatalog;
  trackCatalog = await api('/api/products');
  return trackCatalog;
}

function changeOrderHtml(order) {
  if (!(order.canAddItems || order.cancelAllowed)) {
    if (order.salesFinal) {
      return `<div class="panel alert"><p style="font-size:13px;margin:0;line-height:1.45">This order can’t be changed or canceled — the courier has picked it up. All sales final except if the seal or tote QR fails at delivery.</p></div>`;
    }
    return '';
  }
  const fee = order.cancelFeeEstimate != null ? order.cancelFeeEstimate : +(Number(order.productPrice || 0) * 0.15).toFixed(2);
  return `
    <div class="panel" id="change-order-panel">
      <div class="panel-label">Change order</div>
      <p style="font-size:13px;color:var(--muted);margin:0 0 10px;line-height:1.45">
        You can change or cancel your order until the courier picks it up.
      </p>
      <button type="button" class="btn btn-teal btn-block" id="track-change-order" style="min-height:48px">Change order</button>
      <div id="change-order-menu" class="hidden" style="margin-top:12px">
        <p class="mono" style="margin:0 0 8px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#8b95a8">Add items</p>
        <a class="btn btn-red btn-block btn-sm" href="/?addTo=${encodeURIComponent(order.id)}" style="text-align:center;text-decoration:none;margin-bottom:8px">
          Add items from machine
        </a>
        <button type="button" class="btn btn-ghost btn-block btn-sm" id="track-toggle-picker" style="margin-bottom:10px">Add items from list</button>
        <div id="track-picker" class="hidden" style="margin-bottom:12px"></div>
        <p class="mono" style="margin:0 0 8px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#8b95a8">Cancel order</p>
        <button type="button" class="btn btn-ghost btn-block btn-sm" id="track-cancel">
          Cancel order
        </button>
        <p style="font-size:12px;color:var(--muted);margin:8px 0 0;line-height:1.45">
          Cancel fee: 15% of product (${money(fee)}). Delivery fee refunded if not yet picked up.
        </p>
      </div>
    </div>`;
}

async function showPicker(order) {
  const host = qs('#track-picker');
  if (!host) return;
  host.classList.remove('hidden');
  host.innerHTML = '<div class="empty">Loading…</div>';
  try {
    const cat = await ensureCatalog();
    host.innerHTML = '';
    for (const p of cat.products || []) {
      const win = p.earliestWindow || (p.windows && p.windows[0]);
      if (!win || !win.units) continue;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'btn btn-ghost btn-block btn-sm';
      row.style.marginBottom = '6px';
      row.style.textAlign = 'left';
      row.innerHTML = `<strong>${escapeHtml(p.title)}</strong><br><span class="mono">${money(p.price)} · ${escapeHtml(win.label)} · ${win.units} left</span>`;
      row.addEventListener('click', () => stageAdd(order, p.id, win.id));
      host.appendChild(row);
    }
    if (!host.children.length) host.innerHTML = '<div class="empty">No units available</div>';
  } catch (err) {
    host.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
  }
}

async function stageAdd(order, productId, windowId) {
  try {
    const { order: o } = await api(`/api/orders/${order.id}/add-items`, {
      method: 'POST',
      body: JSON.stringify({ productId, windowId }),
    });
    toast('Add-on staged — pay stub for the delta');
    renderTrack(o);
  } catch (err) {
    toast(err.message || 'Could not add');
  }
}

function renderTrack(order) {
  currentTrackOrder = order;
  renderAccountChip();
  renderProcessStream(qs('#track-stream'), TRACK_STREAM, trackKey(order));

  const body = qs('#track-body');
  const handoff = location.origin + (order.handoffUrl || `/handoff/${order.id}`);
  const trackUrl = `${location.origin}/track/${order.id}`;

  body.innerHTML = `
    <div class="co-machine">
      <div class="packing-pulse">
        <span class="dot"></span>
        <span>${escapeHtml(pulseText(order))}</span>
      </div>
      <div class="co-hero">
        <div class="glass-window">
          <span class="bracket tl"></span><span class="bracket tr"></span>
          <span class="bracket bl"></span><span class="bracket br"></span>
          <div class="glass-inner">${visual(order)}</div>
        </div>
        <div class="co-hero-copy">
          <div class="row-between" style="margin-bottom:8px">
            <span class="status-tag ${order.status}">${order.status}</span>
            <span class="last4">Last-4 ${order.last4}</span>
          </div>
          <h2>${escapeHtml(order.productTitle || '')}</h2>
          <p class="mono" style="margin-top:6px">Window: ${escapeHtml(order.windowLabel || '')}</p>
          <p class="mono">Total: ${money(order.total)}</p>
          <p class="order-id-chip" style="margin-top:8px">Order ${escapeHtml(order.id)}</p>
          ${order.amended ? `<p class="mono" style="color:#2ec4b6;margin-top:6px">Order updated — shop notified of added items</p>` : ''}
        </div>
      </div>

      <div class="panel" id="tl-panel"></div>
      ${codePanelHtml(order)}
      ${ratingHtml(order)}
      ${linesHtml(order)}
      ${pendingHtml(order)}
      ${changeOrderHtml(order)}

      <div class="panel">
        <div class="panel-label">Bookmark this page</div>
        <p style="font-size:12px;color:var(--muted);margin:0 0 6px;line-height:1.4">
          Status survives refresh. Share or save this Track link.
        </p>
        <a class="handoff-link-box" href="${escapeHtml(trackUrl)}">${escapeHtml(trackUrl)}</a>
      </div>

      <div class="panel">
        <div class="panel-label">Door handoff · tote-bag QR</div>
        <p style="font-size:12px;color:var(--muted);margin:0 0 6px;line-height:1.4">
          When the tote arrives, open handoff and scan or upload the <strong>QR printed on your tote bag</strong>.
        </p>
        <a class="handoff-link-box" href="${escapeHtml(order.handoffUrl || '#')}">${escapeHtml(handoff)}</a>
      </div>

    </div>
  `;

  VPX.renderTimeline(qs('#tl-panel'), order);
  wireRating(order);
  wireCancelQuick(order);
  const changeBtn = qs('#track-change-order');
  const changeMenu = qs('#change-order-menu');
  if (changeBtn && changeMenu) {
    changeBtn.addEventListener('click', () => {
      changeMenu.classList.toggle('hidden');
      changeBtn.textContent = changeMenu.classList.contains('hidden') ? 'Change order' : 'Close change order';
    });
  }

  const fee = order.cancelFeeEstimate != null ? order.cancelFeeEstimate : +(Number(order.productPrice || 0) * 0.15).toFixed(2);
  const cancel = qs('#track-cancel');
  if (cancel) cancel.addEventListener('click', () => openCancelSheet(order, fee));

  const toggle = qs('#track-toggle-picker');
  if (toggle) toggle.addEventListener('click', () => showPicker(order));

  const payAddon = qs('#track-pay-addon');
  if (payAddon) {
    payAddon.addEventListener('click', async () => {
      try {
        const { order: o, message } = await api(`/api/orders/${order.id}/pay-addon`, {
          method: 'POST',
          body: '{}',
        });
        toast(message || 'Add-on paid (stub)');
        renderTrack(o);
      } catch (err) {
        toast(err.message);
      }
    });
  }
  const clearAddon = qs('#track-clear-addon');
  if (clearAddon) {
    clearAddon.addEventListener('click', async () => {
      try {
        const { order: o } = await api(`/api/orders/${order.id}/clear-addon`, { method: 'POST', body: '{}' });
        toast('Add-on discarded');
        renderTrack(o);
      } catch (err) {
        toast(err.message);
      }
    });
  }
}

async function load() {
  const id = orderIdFromPath();
  if (!id) {
    qs('#track-body').innerHTML = '<div class="empty">Missing order id. Use /track/&lt;orderId&gt;</div>';
    return;
  }
  try {
    const { order } = await api(`/api/orders/${id}`);
    try {
      localStorage.setItem('vendiport_last_order', id);
    } catch (_) {}
    renderTrack(order);
  } catch (err) {
    qs('#track-body').innerHTML = `<div class="empty">${escapeHtml(err.message || 'Order not found')}</div>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  renderAccountChip();
  load();
  setInterval(() => {
    const id = orderIdFromPath();
    if (id) load().catch(() => {});
  }, 8000);
});
