/* Shop phone — Jobs | Inventory | Windows */
let shop = null;
let tab = 'jobs';

const STEPS = [
  { key: 'PAID', label: 'PAID — pull it' },
  { key: 'PACKING', label: 'Pack + tote QR' },
  { key: 'READY', label: 'Seal → READY' },
  { key: 'AWAIT', label: 'Awaiting pickup' },
  { key: 'PICKED_UP', label: 'Picked up' },
  { key: 'DONE', label: 'Done' },
];

async function init() {
  const { shops } = await api('/api/shops');
  shop = shops[0];
  if (!shop) {
    qs('#job-list').innerHTML = '<div class="empty">No shop configured</div>';
    return;
  }
  qs('#shop-name').textContent = shop.name;
  qs('#staff-label').textContent = shop.staffLabel || 'Staff';
  qs('#own-driver').checked = !!(shop.ownDriver || shop.customWindows);
  updateModeCopy();

  qs('#own-driver').addEventListener('change', async (e) => {
    try {
      const { shop: s, modeCopy } = await api(`/api/shops/${shop.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ownDriver: e.target.checked, customWindows: e.target.checked }),
      });
      shop = s;
      updateModeCopy(modeCopy);
      toast(s.ownDriver ? 'Own-driver / custom windows ON' : 'Platform hours + courier');
      if (tab === 'windows') await loadWindows();
    } catch (err) {
      toast(err.message);
      e.target.checked = !!(shop.ownDriver || shop.customWindows);
    }
  });

  document.querySelectorAll('.tab').forEach((b) => {
    b.addEventListener('click', () => switchTab(b.dataset.tab));
  });

  qs('#inv-add').addEventListener('click', addProduct);
  qs('#win-add').addEventListener('click', addWindow);

  // deep link
  if (location.pathname.includes('inventory')) switchTab('inventory');
  else if (location.hash === '#windows') switchTab('windows');
  else if (location.hash === '#inventory') switchTab('inventory');
  else if (location.hash === '#stats') switchTab('stats');

  await refreshJobs();
  setInterval(() => { if (tab === 'jobs') refreshJobs(); }, 4000);
}

function updateModeCopy(explicit) {
  qs('#mode-copy').textContent = explicit || (
    (shop.ownDriver || shop.customWindows)
      ? 'Own-driver ON — shop windows drive buyer slots; shop keeps transport fee.'
      : 'Own-driver OFF — platform hours + courier average fee (pass-through).'
  );
  qs('#win-mode').textContent = (shop.ownDriver || shop.customWindows)
    ? 'Custom windows ON — buyers see these times + units only (no shop name).'
    : 'Custom windows OFF — buyers see platform hours. Toggle own-driver ON to use this list.';
}

function switchTab(name) {
  tab = name;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  qs('#tab-jobs').classList.toggle('hidden', name !== 'jobs');
  qs('#tab-inventory').classList.toggle('hidden', name !== 'inventory');
  qs('#tab-windows').classList.toggle('hidden', name !== 'windows');
  const statsEl = qs('#tab-stats');
  if (statsEl) statsEl.classList.toggle('hidden', name !== 'stats');
  qs('#page-title').textContent =
    name === 'jobs' ? 'Jobs' : name === 'inventory' ? 'Inventory' : name === 'windows' ? 'Windows' : 'Stats';
  qs('#page-sub').textContent =
    name === 'jobs' ? 'Shop stream: PAID → pack → seal → READY → pickup → done'
    : name === 'inventory' ? 'Upload sealed SKUs to the anonymous machine'
    : name === 'windows' ? 'Shop delivery windows · own-driver toggle'
    : 'Orders today · units listed · own-driver';
  if (name === 'inventory') loadInventory();
  if (name === 'windows') loadWindows();
  if (name === 'stats') loadStats();
}

async function loadStats() {
  const body = qs('#stats-body');
  if (!body) return;
  try {
    const { stats } = await api('/api/stats');
    const rows = Object.keys(stats.byStatus || {}).sort()
      .map((k) => `<div class="line"><span class="muted">${escapeHtml(k)}</span><span>${stats.byStatus[k]}</span></div>`)
      .join('') || '<div class="line"><span class="muted">No orders today</span><span>0</span></div>';
    body.innerHTML = `
      <div class="panel" style="margin:0">
        <div class="panel-label">${escapeHtml(stats.date)} · ${escapeHtml(stats.shopName || 'Shop')}</div>
        <div class="line total"><span>Orders today</span><span>${stats.ordersToday}</span></div>
        ${rows}
        <div class="line"><span class="muted">Active jobs (open)</span><span>${stats.activeJobs}</span></div>
        <div class="line"><span class="muted">SKUs live on machine</span><span>${stats.skusLive}</span></div>
        <div class="line"><span class="muted">Units listed</span><span>${stats.unitsListed}</span></div>
        <div class="line"><span class="muted">Own-driver</span><span>${stats.ownDriver ? 'ON' : 'OFF'}</span></div>
      </div>
      <p class="footer-note" style="text-align:left;margin-top:10px">${escapeHtml(stats.note || '')}</p>
    `;
  } catch (err) {
    body.innerHTML = `<div class="empty">${escapeHtml(err.message || 'Stats failed')}</div>`;
  }
}

async function refreshJobs() {
  const { orders } = await api('/api/orders?scope=shop');
  renderJobs(orders);
}

function stepState(orderStatus, stepKey, order) {
  const keys = ['PAID', 'PACKING', 'READY', 'AWAIT', 'PICKED_UP', 'DONE'];
  let mapped = orderStatus;
  if (orderStatus === 'READY') mapped = 'AWAIT';
  if (orderStatus === 'DELIVERED_ACCEPTED' || orderStatus === 'REFUSED_SEAL') mapped = 'DONE';
  if (orderStatus === 'CANCELLED') mapped = 'PAID';
  const si = keys.indexOf(stepKey);
  const oi = keys.indexOf(mapped);
  if (oi < 0 || si < 0) return '';
  if (stepKey === 'PACKING' && order.packPhotoStub && oi >= 1) {
    if (oi > 1) return 'done';
    return order.packPhotoStub ? 'done' : 'current';
  }
  if (stepKey === 'READY' && order.sealConfirmed && oi >= 2) {
    if (oi > 2) return 'done';
  }
  if (oi > si) return 'done';
  if (oi === si) return 'current';
  return '';
}

function renderJobs(orders) {
  const list = qs('#job-list');
  if (!orders.length) {
    list.innerHTML = '<div class="empty">No active PAID jobs.<br>Buyer pays on the machine first.</div>';
    return;
  }
  // Group READY by window
  const ready = orders.filter((o) => o.status === 'READY');
  const rest = orders.filter((o) => o.status !== 'READY');
  list.innerHTML = '';
  if (ready.length) {
    const byWin = {};
    for (const o of ready) {
      (byWin[o.windowLabel] || (byWin[o.windowLabel] = [])).push(o);
    }
    const head = document.createElement('div');
    head.className = 'step-label';
    head.textContent = 'READY by window (batch run)';
    list.appendChild(head);
    for (const [label, group] of Object.entries(byWin)) {
      const g = document.createElement('div');
      g.className = 'mono';
      g.style.margin = '6px 0';
      g.textContent = `${label} · ${group.length} tote(s)`;
      list.appendChild(g);
      group.forEach((o) => list.appendChild(jobCard(o)));
    }
  }
  rest.forEach((o) => list.appendChild(jobCard(o)));
}

function jobCard(o) {
  const el = document.createElement('article');
  el.className = `shop-job ${o.status}`;
  const thumb = o.productImage
    ? `<img class="shop-thumb" src="${escapeHtml(o.productImage)}" alt="" />`
    : `<div class="shop-thumb" style="display:grid;place-items:center;font-size:22px">${o.productEmoji || '🎴'}</div>`;

  el.innerHTML = `
    <div class="shop-job-head">
      ${thumb}
      <div>
        <div class="row-between" style="margin-bottom:4px">
          <span class="status-tag ${o.status}">${o.status}</span>
          <span class="last4">Last-4 ${o.last4}</span>
        </div>
        <h2 style="font-size:15px;line-height:1.25">${escapeHtml(o.productTitle)}</h2>
        <div class="mono" style="margin-top:4px">${escapeHtml(o.windowLabel)} · ${money(o.productPrice)}</div>
      </div>
    </div>
    ${o.status === 'PAID' ? '<div class="banner paid" style="margin-top:10px">PAID — pull it.</div>' : ''}
    <div class="panel" style="margin-top:10px">
      <div class="panel-label">Pack · tote bag (QR already on bag)</div>
      <p style="font-size:12px;color:var(--muted);margin:0;line-height:1.45">
        <strong>Put product in tote → photo with tote bag QR visible in frame.</strong>
        Bags already have a QR printed on them — no stickers. Last-4 <strong>${o.last4}</strong>.
      </p>
    </div>
    <div class="panel" style="margin-top:8px">
      <div class="panel-label">Seal (physical — separate from QR)</div>
      <p style="font-size:11px;color:var(--muted);margin:0;line-height:1.4">
        Zip both pulls · one zip tie through both loops · VOID wrap on lock head ·
        “Only accept if untampered.” QR stays the pre-printed code on the bag.
      </p>
    </div>
    <div class="checklist"></div>
    <div class="job-actions"></div>
    <div class="mono" style="margin-top:8px"><a href="${o.handoffUrl}">Handoff ${o.handoffUrl}</a></div>
    ${o.toteQrPayload ? `
      <div class="panel tote-qr-panel" style="margin-top:10px">
        <div class="panel-label">Tote bag QR linked to this order</div>
        <p style="font-size:12px;color:var(--muted);margin:0 0 10px;line-height:1.45">
          Pre-printed on the bag. Staff: include this QR in the pack photo.
          Buyer at the door: scan or upload <em>this same</em> tote bag QR (last-4 <strong>${o.last4}</strong>).
        </p>
        <div class="tote-qr-frame">
          <img class="tote-qr-img" alt="Pre-printed tote bag QR for order ${escapeHtml(o.last4)}"
            src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(o.toteQrPayload)}" />
        </div>
        <div class="mono" style="margin-top:8px;word-break:break-all;font-size:10px">${escapeHtml(o.toteQrPayload)}</div>
        <div class="mono" style="margin-top:4px">${o.toteQrLinkedAt ? 'Bag QR linked ✓' : 'Demo link: order payload'} · only accept if untampered</div>
        <div class="tote-link-row" data-oid="${o.id}" style="margin-top:10px">
          <label style="font-size:10px;color:var(--muted);letter-spacing:.04em;text-transform:uppercase">Optional — link this bag’s QR</label>
          <input type="text" class="field-input tote-link-input" placeholder="Scan/paste bag QR payload" value="${escapeHtml(o.toteQrPayload)}" style="margin-top:4px;font-size:12px;padding:8px" />
          <button type="button" class="btn btn-ghost btn-sm tote-link-btn" style="margin-top:6px">Link tote bag QR to order</button>
        </div>
      </div>` : ''}
  `;

  const streamHost = document.createElement('div');
  streamHost.className = 'stream-wrap shop-job-stream';
  streamHost.innerHTML = '<div class="panel-label">Shop stream</div><div class="vp-stream-host"></div>';
  el.insertBefore(streamHost, el.querySelector('.checklist'));
  if (typeof renderProcessStream === 'function' && typeof shopStreamKeyFromOrder === 'function') {
    renderProcessStream(streamHost.querySelector('.vp-stream-host'), SHOP_STREAM, shopStreamKeyFromOrder(o));
  }

  const listEl = el.querySelector('.checklist');
  for (const s of STEPS) {
    const st = stepState(o.status, s.key, o);
    const row = document.createElement('div');
    row.className = `check-row ${st}`;
    const n = STEPS.indexOf(s) + 1;
    const mark = st === 'done' ? '✓' : String(n);
    row.innerHTML = `<span class="mark">${mark}</span><span>${escapeHtml(s.label)}${s.key==='PACKING' && o.packPhotoStub ? ' ✓' : ''}${s.key==='READY' && o.sealConfirmed ? ' ✓' : ''}</span>`;
    listEl.appendChild(row);
  }

  const actions = el.querySelector('.job-actions');
  if (o.status === 'PAID') {
    actions.appendChild(btn('Start pack', 'btn-red', () => act(o.id, 'start-pack')));
  }
  if (o.status === 'PACKING' || (o.status === 'PAID')) {
    if (!o.packPhotoStub) actions.appendChild(btn('Pack photo — product + tote QR in frame (stub)', 'btn-ghost', () => act(o.id, 'pack-photo')));
    if (o.status === 'PACKING' && o.packPhotoStub && !o.sealConfirmed) {
      actions.appendChild(btn('Confirm seal (zip+VOID)', 'btn-teal', () => act(o.id, 'seal')));
    }
    if (o.sealConfirmed || o.status === 'PAID') {
      actions.appendChild(btn('Mark READY', 'btn-teal', () => act(o.id, 'ready')));
    }
  }
  if (o.status === 'READY') {
    actions.appendChild(btn('Pickup scan (cancel closes)', 'btn-ghost', () => act(o.id, 'pickup')));
  }
  if (o.status === 'PICKED_UP') {
    if (!o.arrivePhotoStub) {
      actions.appendChild(btn('Arrive photo stub (unlock approve)', 'btn-teal', () => act(o.id, 'arrive-photo')));
    } else {
      const n = document.createElement('div');
      n.className = 'mono';
      n.textContent = 'Arrive photo ✓ · buyer approve unlocked';
      actions.appendChild(n);
    }
  }
  const linkRow = el.querySelector('.tote-link-row');
  if (linkRow) {
    const inp = linkRow.querySelector('.tote-link-input');
    const b = linkRow.querySelector('.tote-link-btn');
    b.addEventListener('click', async () => {
      const payload = (inp.value || '').trim();
      if (!payload) return toast('Enter/scan the QR printed on the tote bag');
      try {
        await api(`/api/orders/${o.id}/assign-tote-qr`, {
          method: 'POST',
          body: JSON.stringify({ toteQrPayload: payload }),
        });
        toast('Tote bag QR linked to order');
        await refreshJobs();
      } catch (err) {
        toast(err.message || 'Link failed');
      }
    });
  }
  return el;
}

function btn(label, cls, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn ${cls} btn-sm`;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

async function act(id, action) {
  try {
    await api(`/api/orders/${id}/${action}`, { method: 'POST', body: '{}' });
    toast(`${action} ✓`);
    await refreshJobs();
  } catch (err) {
    toast(err.message);
  }
}

async function loadInventory() {
  const { products } = await api('/api/products?scope=shop');
  const list = qs('#inv-list');
  list.innerHTML = '';
  for (const p of products) {
    const el = document.createElement('article');
    el.className = 'card';
    const earliest = p.earliestWindow;
    const thumb = p.image
      ? `<img class="shop-thumb" src="${escapeHtml(p.image)}" alt="" />`
      : `<div class="shop-thumb" style="display:grid;place-items:center">${p.emoji || '🎴'}</div>`;
    el.innerHTML = `
      <div class="inv-row">
        ${thumb}
        <div>
          <div class="row-between">
            <strong style="font-size:14px">${escapeHtml(p.title)}</strong>
            ${p.hidden ? '<span class="status-tag CANCELLED">HIDDEN</span>' : '<span class="status-tag READY">LIVE</span>'}
          </div>
          <div class="mono">${escapeHtml(p.category)} · ${money(p.price)} · ${earliest ? earliest.units + ' @ ' + earliest.label : 'no window'}</div>
        </div>
      </div>
      <div class="inv-actions">
        <button type="button" class="btn btn-sm btn-ghost" data-a="price">Edit price</button>
        <button type="button" class="btn btn-sm btn-ghost" data-a="units">Edit units</button>
        <button type="button" class="btn btn-sm btn-ghost" data-a="hide">${p.hidden ? 'Unhide' : 'Hide'}</button>
      </div>`;
    el.querySelector('[data-a="price"]').onclick = async () => {
      const v = prompt('New price', p.price);
      if (v == null) return;
      await api(`/api/products/${p.id}`, { method: 'PATCH', body: JSON.stringify({ price: Number(v) }) });
      toast('Price updated');
      loadInventory();
    };
    el.querySelector('[data-a="units"]').onclick = async () => {
      const v = prompt('Units for earliest window', earliest ? earliest.units : 0);
      if (v == null) return;
      await api(`/api/products/${p.id}`, { method: 'PATCH', body: JSON.stringify({ units: Number(v) }) });
      toast('Units updated');
      loadInventory();
    };
    el.querySelector('[data-a="hide"]').onclick = async () => {
      if (p.hidden) {
        await api(`/api/products/${p.id}`, { method: 'PATCH', body: JSON.stringify({ hidden: false }) });
      } else {
        await api(`/api/products/${p.id}`, { method: 'DELETE' });
      }
      toast(p.hidden ? 'Unhidden' : 'Hidden from machine');
      loadInventory();
    };
    list.appendChild(el);
  }
}

async function addProduct() {
  const title = qs('#inv-title').value.trim();
  if (!title) return toast('Title required');
  const body = {
    title,
    subtitle: qs('#inv-sub').value.trim() || 'Sealed · Demo price — confirm with shop',
    category: qs('#inv-cat').value,
    price: Number(qs('#inv-price').value),
    units: Number(qs('#inv-units').value),
    windowLabel: qs('#inv-window').value.trim() || 'Today 4-6pm',
    imageUrl: qs('#inv-url').value.trim() || null,
  };
  try {
    const { product } = await api('/api/products', { method: 'POST', body: JSON.stringify(body) });
    const file = qs('#inv-file').files[0];
    if (file) {
      const fd = new FormData();
      fd.append('productId', product.id);
      fd.append('image', file);
      const res = await fetch('/api/products/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
    }
    toast('Product live on machine');
    qs('#inv-title').value = '';
    qs('#inv-file').value = '';
    loadInventory();
  } catch (err) {
    toast(err.message);
  }
}

async function loadWindows() {
  const data = await api(`/api/shops/${shop.id}/windows`);
  shop.ownDriver = data.ownDriver;
  qs('#platform-wins').textContent = (data.platformWindows || []).map((w) => w.label).join(' · ');
  const list = qs('#win-list');
  list.innerHTML = '';
  if (!(data.windows || []).length) {
    list.innerHTML = '<div class="empty">No shop windows yet. Add one above.</div>';
    return;
  }
  for (const w of data.windows) {
    const el = document.createElement('article');
    el.className = 'card';
    el.innerHTML = `
      <div class="row-between">
        <strong>${escapeHtml(w.label)}</strong>
        <span class="status-tag ${w.active !== false ? 'READY' : 'CANCELLED'}">${w.active !== false ? 'ACTIVE' : 'OFF'}</span>
      </div>
      <div class="mono">id ${escapeHtml(w.id)} · capacity ${w.capacity ?? '—'}</div>
      <div class="inv-actions">
        <button type="button" class="btn btn-sm btn-ghost" data-a="edit">Edit</button>
        <button type="button" class="btn btn-sm btn-ghost" data-a="tog">${w.active !== false ? 'Deactivate' : 'Activate'}</button>
        <button type="button" class="btn btn-sm btn-red" data-a="del">Delete</button>
      </div>`;
    el.querySelector('[data-a="edit"]').onclick = async () => {
      const label = prompt('Label', w.label);
      if (label == null) return;
      const capacity = prompt('Capacity', w.capacity ?? 0);
      if (capacity == null) return;
      await api(`/api/shops/${shop.id}/windows/${encodeURIComponent(w.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ label, capacity: Number(capacity) }),
      });
      toast('Window updated');
      loadWindows();
    };
    el.querySelector('[data-a="tog"]').onclick = async () => {
      await api(`/api/shops/${shop.id}/windows/${encodeURIComponent(w.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: w.active === false }),
      });
      loadWindows();
    };
    el.querySelector('[data-a="del"]').onclick = async () => {
      if (!confirm('Delete window?')) return;
      await api(`/api/shops/${shop.id}/windows/${encodeURIComponent(w.id)}`, { method: 'DELETE' });
      toast('Deleted');
      loadWindows();
    };
    list.appendChild(el);
  }
}

async function addWindow() {
  const label = qs('#win-label').value.trim();
  if (!label) return toast('Label required');
  try {
    await api(`/api/shops/${shop.id}/windows`, {
      method: 'POST',
      body: JSON.stringify({ label, capacity: Number(qs('#win-cap').value) || 0 }),
    });
    qs('#win-label').value = '';
    toast('Window added');
    loadWindows();
  } catch (err) {
    toast(err.message);
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch((e) => toast(e.message));
});
