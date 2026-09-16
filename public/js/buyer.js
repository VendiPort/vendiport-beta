/* Buyer virtual vending machine — glass slots + machine checkout; never reveals shop */
let catalog = { products: [], deliveryFee: 10, minOrder: 25 };
let selected = null;
const GUEST_RATE = 0.005; // +0.5% guest fee when not a member

function membershipOn() {
  return typeof isMember === 'function' ? isMember() : false;
}

function paintBuyerStream(which, key) {
  const el = qs(`#buyer-stream-${which}`);
  if (!el || typeof renderProcessStream !== 'function') return;
  if (which === 'paid' && typeof TRACK_STREAM !== 'undefined') {
    const k = typeof trackStreamKeyFromOrder === 'function' && window.__lastPaidOrder
      ? trackStreamKeyFromOrder(window.__lastPaidOrder)
      : (key === 'delivery' ? 'out' : key);
    renderProcessStream(el, TRACK_STREAM, k);
    return;
  }
  renderProcessStream(el, BUYER_STREAM, key);
}

function onMemberSessionChange() {
  renderAccountChip();
  if (!qs('#view-checkout').classList.contains('hidden') && selected) renderCheckout();
}

async function loadBrowse() {
  catalog = await api('/api/products');
  renderBrowse();
}

function productVisual(p) {
  const tileCode = p.tile || (p.category || 'VP').slice(0, 3).toUpperCase();
  if (p.image || p.productImage) {
    const src = p.image || p.productImage;
    return `<img src="${escapeHtml(src)}" alt="" loading="lazy" /><div class="glass-sheen" aria-hidden="true"></div>`;
  }
  const emoji = p.emoji || p.productEmoji || '🎴';
  return `<div class="fallback-tile"><div class="emoji">${emoji}</div><div class="code">${escapeHtml(tileCode)}</div></div><div class="glass-sheen" aria-hidden="true"></div>`;
}

function renderBrowse() {
  qs('#view-browse').classList.remove('hidden');
  qs('#view-checkout').classList.add('hidden');
  qs('#view-paid').classList.add('hidden');
  renderAccountChip();
  paintBuyerStream('browse', 'browse');

  const list = qs('#product-list');
  list.innerHTML = '';
  for (const p of catalog.products) {
    const earliest = p.earliestWindow;
    const slot = document.createElement('article');
    slot.className = 'vslot';
    slot.innerHTML = `
      <div class="glass-window">
        <span class="bracket tl"></span><span class="bracket tr"></span>
        <span class="bracket bl"></span><span class="bracket br"></span>
        <div class="glass-inner">${productVisual(p)}</div>
      </div>
      <div class="rail" aria-hidden="true"></div>
      <div class="slot-meta-bar">
        <span class="win">${escapeHtml(earliest ? earliest.label : '—')}</span>
        <span class="units">${earliest ? earliest.units : 0} left</span>
      </div>
      <div class="slot-title">${escapeHtml(p.title)}</div>
      <div class="slot-price">${money(p.price)}</div>
      <button type="button" class="push-tab" aria-label="Select ${escapeHtml(p.title)}">
        Get it<span class="hint">Push</span>
      </button>`;
    slot.querySelector('.push-tab').addEventListener('click', () => openCheckout(p.id));
    list.appendChild(slot);
  }
}

function openCheckout(productId) {
  const product = catalog.products.find((p) => p.id === productId);
  if (!product) return;
  selected = {
    product,
    windowId: (product.earliestWindow && product.earliestWindow.id) || (product.windows[0] && product.windows[0].id),
  };
  renderCheckout();
}

function calcTotals() {
  const p = selected.product;
  const product = p.price;
  const delivery = catalog.deliveryFee;
  const guest = membershipOn() ? 0 : +(product * GUEST_RATE).toFixed(2);
  const total = +(product + delivery + guest).toFixed(2);
  return { product, delivery, guest, total };
}

function renderCheckout() {
  qs('#view-browse').classList.add('hidden');
  qs('#view-checkout').classList.remove('hidden');
  qs('#view-paid').classList.add('hidden');
  renderAccountChip();
  paintBuyerStream('checkout', 'checkout');

  const p = selected.product;
  const t = calcTotals();

  qs('#co-visual').innerHTML = productVisual(p);
  qs('#co-title').textContent = p.title;
  qs('#co-sub').textContent = p.subtitle || '';
  qs('#co-order').textContent = money(t.product);
  qs('#co-delivery').textContent = money(t.delivery);
  qs('#co-due').textContent = money(t.total);
  qs('#co-total-btn').textContent = `Pay ${money(t.total)}`;
  qs('#co-total-sub').textContent = `Order ${money(t.product)} + Delivery ${money(t.delivery)}${t.guest ? ` + Guest ${money(t.guest)}` : ''} · stub`;

  const guestLine = qs('#co-guest-line');
  const status = qs('#member-status-line');
  if (t.guest > 0) {
    guestLine.classList.remove('hidden');
    qs('#co-guest').textContent = money(t.guest);
    status.innerHTML = 'Guest +0.5% — <a href="/account">Sign in / Join</a> (top right)';
  } else {
    guestLine.classList.add('hidden');
    status.textContent = 'Member — no guest fee';
  }

  const chips = qs('#window-chips');
  chips.innerHTML = '';
  for (const w of p.windows) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'window-chip' + (w.id === selected.windowId ? ' on' : '');
    b.innerHTML = `<div class="t">${escapeHtml(w.label)}</div><div class="u">${w.units} unit${w.units === 1 ? '' : 's'}</div>`;
    b.addEventListener('click', () => {
      selected.windowId = w.id;
      renderCheckout();
    });
    chips.appendChild(b);
  }
}

async function payStub() {
  const btn = qs('#pay-btn');
  btn.disabled = true;
  try {
    const { order } = await api('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        productId: selected.product.id,
        windowId: selected.windowId,
        membershipOptIn: membershipOn(),
        pay: true,
      }),
    });
    if (!order.productImage && selected.product.image) order.productImage = selected.product.image;
    if (!order.productEmoji && selected.product.emoji) order.productEmoji = selected.product.emoji;
    renderPaid(order);
    toast('Paid (stub). Shop notified.');
  } catch (err) {
    toast(err.message || 'Pay failed');
  } finally {
    btn.disabled = false;
  }
}

function renderPaid(order) {
  qs('#view-browse').classList.add('hidden');
  qs('#view-checkout').classList.add('hidden');
  qs('#view-paid').classList.remove('hidden');
  renderAccountChip();
  window.__lastPaidOrder = order;
  try { localStorage.setItem('vendiport_last_order', order.id); } catch (_) {}
  paintBuyerStream('paid', buyerStreamKeyFromOrder(order));
  const trackA = qs('#paid-track');
  if (trackA) {
    trackA.href = `/track/${order.id}`;
    trackA.textContent = location.origin + `/track/${order.id}`;
  }

  qs('#paid-visual').innerHTML = productVisual({
    image: order.productImage,
    emoji: order.productEmoji,
    tile: (order.productTitle || 'VP').slice(0, 3).toUpperCase(),
  });
  qs('#paid-last4').textContent = order.last4;
  qs('#paid-status').textContent = order.status;
  qs('#paid-status').className = 'status-tag ' + order.status;
  qs('#paid-title').textContent = order.productTitle;
  qs('#paid-window').textContent = order.windowLabel;
  qs('#paid-total').textContent = money(order.total);
  qs('#paid-id').textContent = order.id;
  qs('#paid-cancel-copy').textContent = order.cancelFeeCopy;

  const pulse = qs('#paid-pulse-text');
  if (order.status === 'PAID' || order.status === 'PACKING') {
    pulse.textContent = 'Shop is packing your sealed tote…';
  } else if (order.status === 'CANCELLED') {
    pulse.textContent = 'Order cancelled';
  } else if (order.status === 'READY') {
    pulse.textContent = 'Ready — awaiting pickup';
  } else if (order.status === 'PICKED_UP') {
    pulse.textContent = order.arrivePhotoStub ? 'Arrived — scan or upload the QR on your tote bag' : 'Out for delivery…';
  } else if (order.status === 'DELIVERED_ACCEPTED') {
    pulse.textContent = 'Accepted — done';
  } else if (order.status === 'REFUSED_SEAL') {
    pulse.textContent = 'Refused seal / tote-bag QR — full refund stub';
  } else {
    pulse.textContent = `Status: ${order.status}`;
  }

  const link = qs('#paid-handoff');
  link.href = order.handoffUrl;
  link.textContent = location.origin + order.handoffUrl;

  qs('#paid-cancel-btn').onclick = async () => {
    try {
      const { order: o } = await api(`/api/orders/${order.id}/cancel`, { method: 'POST', body: '{}' });
      toast(`Cancelled. Fee ${money(o.cancelFee || 0)}`);
      renderPaid(o);
    } catch (err) {
      toast(err.message);
    }
  };
  qs('#paid-cancel-btn').disabled = !order.cancelAllowed;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', () => {
  qs('#back-browse').addEventListener('click', () => loadBrowse());
  qs('#pay-btn').addEventListener('click', payStub);
  renderAccountChip();
  loadBrowse().catch((e) => toast(e.message));
});
