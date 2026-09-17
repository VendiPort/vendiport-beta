/* Buyer virtual vending machine — glass slots + machine checkout; never reveals shop */
let catalog = { products: [], deliveryFee: 10, minOrder: 25 };
let selected = null;
let addToOrderId = null;
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
    const id = p.id || src;
    return `<img class="box-photo" data-box-src="${escapeHtml(src)}" data-box-id="${escapeHtml(id)}" src="${escapeHtml(src)}" alt="" loading="lazy" />`;
  }
  const emoji = p.emoji || p.productEmoji || '🎴';
  return `<div class="fallback-tile"><div class="emoji">${emoji}</div><div class="code">${escapeHtml(tileCode)}</div></div>`;
}

/** Apply galaxy composite to .box-photo imgs inside root (live cache by product id). */
async function applyGalaxyComposites(root) {
  const scope = root || document;
  const imgs = scope.querySelectorAll('img.box-photo[data-box-src]');
  if (!imgs.length || typeof BoxComposite === 'undefined') return;
  await Promise.all(
    Array.from(imgs).map(async (img) => {
      if (img.dataset.galaxyDone === '1') return;
      const id = img.dataset.boxId || img.dataset.boxSrc;
      const src = img.dataset.boxSrc;
      const glass = img.closest('.glass-inner');
      try {
        const url = await BoxComposite.getComposited(id, src);
        img.src = url;
        img.dataset.galaxyDone = '1';
        img.classList.add('galaxy-on');
        if (glass) {
          glass.classList.remove('galaxy-fallback');
          glass.classList.add('galaxy-ready');
        }
      } catch (err) {
        if (glass) glass.classList.add('galaxy-fallback');
      }
    })
  );
}

function renderBrowse() {
  qs('#view-browse').classList.remove('hidden');
  qs('#view-checkout').classList.add('hidden');
  qs('#view-paid').classList.add('hidden');
  renderAccountChip();
  paintBuyerStream('browse', 'browse');
  const ab = qs('#addto-banner');
  if (ab) {
    if (addToOrderId) {
      ab.classList.remove('hidden');
      ab.textContent = 'Adding to order · last-4 ' + addToOrderId.slice(-4).toUpperCase() + ' — push a box, then pay stub for the add-on.';
    } else ab.classList.add('hidden');
  }

  const list = qs('#product-list');
  list.innerHTML = '';
  for (const p of catalog.products) {
    const earliest = p.earliestWindow;
    const slot = document.createElement('article');
    slot.className = 'vslot';
    slot.innerHTML = `
      <div class="slot-showcase">
        <div class="glass-window">
          <span class="bracket tl"></span><span class="bracket tr"></span>
          <span class="bracket bl"></span><span class="bracket br"></span>
          <div class="glass-inner">${productVisual(p)}</div>
          <button type="button" class="chase-icon-btn" aria-label="Hits still available for ${escapeHtml(p.title)}">
            <svg class="chase-badge-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="16" height="16">
              <circle cx="12" cy="12" r="10" fill="none" stroke="#4fd1c5" stroke-width="2"/>
              <circle cx="12" cy="12" r="6.2" fill="none" stroke="#e8f7f5" stroke-width="2"/>
              <circle cx="12" cy="12" r="2.4" fill="#4fd1c5"/>
            </svg>
            <span class="chase-icon-label" aria-hidden="true"><span>Hits</span><span>available</span></span>
          </button>
        </div>
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
    const chaseBtn = slot.querySelector('.chase-icon-btn');
    if (chaseBtn) {
      chaseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        openChaseOverlay(p);
      });
    }
    list.appendChild(slot);
  }
  applyGalaxyComposites(list);
}

function openChaseOverlay(product) {
  const overlay = qs('#chase-overlay');
  if (!overlay) return;
  const mini = qs('#chase-mini');
  if (mini) mini.classList.add('hidden');
  overlay.classList.remove('minimized');
  const chase = Array.isArray(product.chaseTop3) ? product.chaseTop3.slice(0, 3) : [];
  qs('#chase-overlay-title').textContent = 'Hits still available';
  qs('#chase-overlay-sub').textContent =
    (product.title || '') + ' · top cards of value that may still be in this sealed box';
  const list = qs('#chase-overlay-list');
  list.innerHTML = '';
  if (!chase.length) {
    list.innerHTML = '<li class="chase-overlay-item"><div class="nm">No hits listed yet</div><div class="note">Demo beta — check back soon.</div></li>';
  } else {
    // Highest potential value first among the seeded top chase cards
    const ranked = chase
      .map((c, idx) => ({ c, idx, val: Number(c.potentialValue) }))
      .sort((a, b) => {
        const av = Number.isFinite(a.val) ? a.val : -1;
        const bv = Number.isFinite(b.val) ? b.val : -1;
        if (bv !== av) return bv - av;
        return a.idx - b.idx;
      });
    ranked.forEach((row, i) => {
      const c = row.c;
      const li = document.createElement('li');
      li.className = 'chase-overlay-item';
      const val = row.val;
      const valHtml = Number.isFinite(val)
        ? `<div class="potential-value"><span class="pv-label">Potential value</span><span class="pv-amt">${money(val)}</span></div>`
        : '';
      li.innerHTML = `
        <div class="chase-overlay-rank">${i + 1}</div>
        <div class="chase-overlay-body">
          <div class="nm-row">
            <div class="nm">${escapeHtml(c.name)}</div>
            ${valHtml}
          </div>
          <div class="rarity">${c.rarity ? escapeHtml(c.rarity) + ' · ' : ''}potentially still available</div>
          <div class="note">${escapeHtml(c.note || '')}</div>
        </div>`;
      list.appendChild(li);
    });
  }
  const demo = qs('#chase-overlay-demo');
  if (demo) demo.classList.toggle('hidden', !(product.chaseDemo || chase.length));
  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
  const miniLbl = qs('.chase-mini-label');
  if (miniLbl) miniLbl.textContent = 'Hits';
}

function minimizeChaseOverlay() {
  const overlay = qs('#chase-overlay');
  const mini = qs('#chase-mini');
  if (!overlay || overlay.classList.contains('hidden')) return;
  overlay.classList.add('hidden');
  overlay.classList.add('minimized');
  overlay.setAttribute('aria-hidden', 'true');
  if (mini) {
    mini.classList.remove('hidden');
    mini.setAttribute('aria-expanded', 'false');
  }
}

function restoreChaseOverlay() {
  const overlay = qs('#chase-overlay');
  const mini = qs('#chase-mini');
  if (!overlay) return;
  if (mini) mini.classList.add('hidden');
  overlay.classList.remove('minimized');
  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
}

function closeChaseOverlay() {
  const overlay = qs('#chase-overlay');
  const mini = qs('#chase-mini');
  if (!overlay) return;
  overlay.classList.add('hidden');
  overlay.classList.remove('minimized');
  overlay.setAttribute('aria-hidden', 'true');
  if (mini) mini.classList.add('hidden');
}

async function openCheckout(productId) {
  const product = catalog.products.find((p) => p.id === productId);
  if (!product) return;
  const windowId = (product.earliestWindow && product.earliestWindow.id) || (product.windows[0] && product.windows[0].id);
  if (addToOrderId) {
    try {
      const { order } = await api(`/api/orders/${addToOrderId}/add-items`, {
        method: 'POST',
        body: JSON.stringify({ productId, windowId }),
      });
      toast('Added — pay stub for the add-on on Track');
      location.href = '/track/' + addToOrderId;
      return;
    } catch (err) {
      toast(err.message || 'Could not add to order');
      return;
    }
  }
  selected = { product, windowId };
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
  loadPayConfig().catch(() => {});

  const p = selected.product;
  const t = calcTotals();

  qs('#co-visual').innerHTML = productVisual(p);
  applyGalaxyComposites(qs('#co-visual'));
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

let payConfig = { mode: 'stub' };

async function loadPayConfig() {
  try {
    payConfig = await api('/api/payments/config');
  } catch {
    payConfig = { mode: 'stub' };
  }
  const sub = qs('#co-total-sub');
  const btn = qs('#pay-btn');
  if (payConfig.mode === 'stripe_test') {
    if (sub) sub.textContent = 'Stripe TEST checkout · use 4242… · no live charges';
    if (btn) btn.classList.add('stripe-test');
  } else {
    if (sub) sub.textContent = 'Pay stub · no real Stripe (set sk_test_/pk_test_ on host for test mode)';
  }
}

async function payStub() {
  const btn = qs('#pay-btn');
  btn.disabled = true;
  try {
    if (!payConfig || !payConfig.mode) await loadPayConfig();
    if (payConfig.mode === 'stripe_test') {
      const { url, orderId } = await api('/api/payments/checkout', {
        method: 'POST',
        body: JSON.stringify({
          productId: selected.product.id,
          windowId: selected.windowId,
          membershipOptIn: membershipOn(),
        }),
      });
      if (!url) throw new Error('No Stripe Checkout URL');
      try { localStorage.setItem('vendiport_last_order', orderId); } catch (_) {}
      toast('Redirecting to Stripe TEST Checkout…');
      location.href = url;
      return;
    }
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
  const changeCopy = qs('#paid-change-copy');
  const changeBtn = qs('#paid-change-btn');
  const cancelCopy = qs('#paid-cancel-copy');
  if (order.cancelAllowed || order.canAddItems) {
    if (changeCopy) changeCopy.textContent = 'You can change or cancel your order until the courier picks it up.';
    if (changeBtn) {
      changeBtn.href = '/track/' + order.id;
      changeBtn.textContent = 'Change order';
      changeBtn.classList.remove('hidden');
    }
    if (cancelCopy) cancelCopy.textContent = 'Opens Track: Add items or Cancel order. Cancel fee: 15% of product.';
  } else {
    if (changeCopy) {
      changeCopy.textContent =
        'This order can’t be changed or canceled — the courier has picked it up. All sales final except if the seal or tote QR fails at delivery.';
    }
    if (changeBtn) changeBtn.classList.add('hidden');
    if (cancelCopy) cancelCopy.textContent = '';
  }

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
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', () => {
  const q = new URLSearchParams(location.search);
  addToOrderId = q.get('addTo') || null;
  qs('#back-browse').addEventListener('click', () => {
    if (addToOrderId) {
      location.href = '/track/' + addToOrderId;
      return;
    }
    loadBrowse();
  });
  qs('#pay-btn').addEventListener('click', payStub);
  const chaseOverlay = qs('#chase-overlay');
  if (chaseOverlay) {
    qs('#chase-overlay-close').addEventListener('click', closeChaseOverlay);
    const minBtn = qs('#chase-overlay-min');
    if (minBtn) minBtn.addEventListener('click', (e) => { e.stopPropagation(); minimizeChaseOverlay(); });
    const mini = qs('#chase-mini');
    if (mini) mini.addEventListener('click', restoreChaseOverlay);
    chaseOverlay.addEventListener('click', (e) => {
      if (e.target === chaseOverlay) minimizeChaseOverlay();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !chaseOverlay.classList.contains('hidden')) closeChaseOverlay();
    });
  }
  renderAccountChip();
  loadPayConfig().catch(() => {});
  loadBrowse().catch((e) => toast(e.message));
});
