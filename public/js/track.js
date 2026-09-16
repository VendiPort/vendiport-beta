/* Track order — /track/<id> or /order/<id> — survives refresh */
const TRACK_STREAM = [
  { key: 'paid', label: 'Paid' },
  { key: 'pack', label: 'Packing' },
  { key: 'ready', label: 'Ready' },
  { key: 'out', label: 'Out' },
  { key: 'arrive', label: 'Arrive' },
  { key: 'accept', label: 'Scan tote QR' },
];

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

function renderTrack(order) {
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
        </div>
      </div>

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

      ${order.cancelAllowed ? `
        <div class="panel alert">
          <p style="font-size:12px;line-height:1.45;margin:0">${escapeHtml(order.cancelFeeCopy || '')}</p>
          <button type="button" class="btn btn-ghost btn-block btn-sm" id="track-cancel" style="margin-top:10px">Cancel order (15% fee)</button>
        </div>` : ''}
    </div>
  `;

  const cancel = qs('#track-cancel');
  if (cancel) {
    cancel.addEventListener('click', async () => {
      try {
        const { order: o } = await api(`/api/orders/${order.id}/cancel`, { method: 'POST', body: '{}' });
        toast(`Cancelled. Fee ${money(o.cancelFee || 0)}`);
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
    try { localStorage.setItem('vendiport_last_order', id); } catch (_) {}
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
