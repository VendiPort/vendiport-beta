/* Track order — /track/<id> or /order/<id> — survives refresh */
const TRACK_STREAM = [
  { key: 'paid', label: 'Paid' },
  { key: 'pack', label: 'Packing' },
  { key: 'ready', label: 'Ready' },
  { key: 'out', label: 'Out' },
  { key: 'arrive', label: 'Arrive' },
  { key: 'accept', label: 'Scan tote QR' },
];

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
  if (cancel) {
    cancel.addEventListener('click', async () => {
      const ok = confirm(
        `Cancel this order?\n\nCancel fee: 15% of product (${money(fee)}).\nDelivery fee refunded if not yet picked up.`
      );
      if (!ok) return;
      try {
        const { order: o } = await api(`/api/orders/${order.id}/cancel`, { method: 'POST', body: '{}' });
        toast(`Cancelled. Fee ${money(o.cancelFee || 0)}`);
        renderTrack(o);
      } catch (err) {
        toast(err.message);
      }
    });
  }

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
