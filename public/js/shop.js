/* Shop phone — Jobs | Inventory | Windows */
let shop = null;
let tab = 'jobs';
let knownPaidIds = new Set();
let saleSoundArmed = false;
let saleAudioCtx = null;
let alertDismissedFor = new Set();
let jobsPollMs = 3000;
let jobsPollTimer = null;

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
  wireInventoryCapture();

  // deep link
  if (location.pathname.includes('inventory')) switchTab('inventory');
  else if (location.hash === '#windows') switchTab('windows');
  else if (location.hash === '#inventory') switchTab('inventory');
  else if (location.hash === '#stats') switchTab('stats');
  else if (location.hash === '#wanted') switchTab('wanted');
  else if (location.hash === '#earnings') switchTab('earnings');

  wirePause();
  loadWantedBadge();
  await refreshJobs();
  startJobsPoll();
  const arm = qs('#sale-sound-arm');
  if (arm) arm.addEventListener('click', armSaleSound);
  const nArm = qs('#sale-notify-arm');
  if (nArm) nArm.addEventListener('click', armSaleNotifications);
  const dismiss = qs('#sale-alert-dismiss');
  if (dismiss) dismiss.addEventListener('click', () => {
    document.querySelectorAll('.shop-job.PAID').forEach((el) => {
      const id = el.dataset.oid;
      if (id) alertDismissedFor.add(id);
    });
    updateSaleAlert([]);
  });
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
  qs('#tab-wanted').classList.toggle('hidden', name !== 'wanted');
  qs('#tab-earnings').classList.toggle('hidden', name !== 'earnings');
  const statsEl = qs('#tab-stats');
  if (statsEl) statsEl.classList.toggle('hidden', name !== 'stats');
  qs('#page-title').textContent =
    name === 'jobs' ? 'Jobs' : name === 'inventory' ? 'Inventory' : name === 'windows' ? 'Windows' : name === 'wanted' ? 'Wanted' : name === 'earnings' ? 'Earnings' : 'Stats';
  qs('#page-sub').textContent =
    name === 'jobs' ? 'Shop stream: PAID → pack → seal → READY → pickup → done'
    : name === 'inventory' ? 'Upload sealed SKUs to the anonymous machine'
    : name === 'windows' ? 'Shop delivery windows · own-driver toggle'
    : name === 'wanted' ? 'Ranked buyer demand · tap “I have this” to list it and alert followers'
    : name === 'earnings' ? 'Daily payout summary · what you’ve earned'
    : 'Orders today · units listed · own-driver';
  if (name !== 'inventory') stopBarcodeScan();
  if (name === 'inventory') loadInventory();
  if (name === 'windows') loadWindows();
  if (name === 'stats') loadStats();
  if (name === 'wanted') loadWanted();
  if (name === 'earnings') loadEarnings();
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

function startJobsPoll() {
  if (jobsPollTimer) clearInterval(jobsPollTimer);
  jobsPollTimer = setInterval(() => {
    if (tab === 'jobs') refreshJobs().catch(() => {});
  }, jobsPollMs);
}

async function armSaleNotifications() {
  const b = qs('#sale-notify-arm');
  if (!('Notification' in window)) {
    toast('Notifications not supported in this browser');
    return;
  }
  try {
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      toast('Browser notifications on for new PAID sales');
      if (b) b.textContent = 'Notifications ON';
      try {
        new Notification('VendiPort shop alerts on', {
          body: 'You will get a ping when a buyer pays.',
          silent: true,
        });
      } catch (_) {}
    } else {
      toast('Notification permission denied');
    }
  } catch (err) {
    toast(err.message || 'Could not enable notifications');
  }
}

function notifyNewSale(order) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification('New VendiPort sale — pull it', {
      body: `${order.productTitle || 'Sealed product'} · last-4 ${order.last4}`,
      tag: `vendiport-paid-${order.id}`,
      renotify: true,
    });
    n.onclick = () => {
      try { window.focus(); } catch (_) {}
      n.close();
    };
  } catch (_) {}
}

function armSaleSound() {
  saleSoundArmed = true;
  try {
    saleAudioCtx = saleAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (saleAudioCtx.state === 'suspended') saleAudioCtx.resume();
    // short arm chirp
    playSaleBeep(180);
    toast('Sale alert sound on');
    const b = qs('#sale-sound-arm');
    if (b) b.textContent = 'Alert sound ON';
  } catch (err) {
    toast('Sound unavailable on this device');
  }
}

function playSaleBeep(ms = 420) {
  if (!saleSoundArmed || !saleAudioCtx) return;
  try {
    const ctx = saleAudioCtx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = 880;
    g.gain.value = 0.04;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    setTimeout(() => {
      o.frequency.value = 1320;
    }, ms / 2);
    setTimeout(() => {
      try { o.stop(); } catch (_) {}
    }, ms);
  } catch (_) {}
}

function updateSaleAlert(paidOrders) {
  const el = qs('#sale-alert');
  const badge = qs('#jobs-badge');
  const n = paidOrders.length;
  if (badge) {
    badge.dataset.count = String(n);
    badge.textContent = n ? String(n) : '';
  }
  // title badge on jobs tab already
  if (!el) return;
  const visible = paidOrders.filter((o) => !alertDismissedFor.has(o.id));
  if (!visible.length) {
    el.classList.remove('on');
    return;
  }
  el.classList.add('on');
  const title = qs('#sale-alert-title');
  const body = qs('#sale-alert-body');
  if (title) title.textContent = visible.length === 1
    ? `New sale — pull it · last-4 ${visible[0].last4}`
    : `${visible.length} new sales — pull them`;
  if (body) {
    body.textContent = visible
      .map((o) => `${o.productTitle} · ${o.windowLabel} · last-4 ${o.last4}`)
      .join(' · ');
  }
}

async function refreshJobs() {
  const { orders } = await api('/api/orders?scope=shop');
  // Never show unpaid/DRAFT — server already filters; belt + suspenders
  const paidPlus = (orders || []).filter((o) =>
    ['PAID', 'PACKING', 'READY', 'PICKED_UP', 'DELIVERED_ACCEPTED'].includes(o.status)
  );
  const paidNow = paidPlus.filter((o) => o.status === 'PAID');
  const paidIds = new Set(paidNow.map((o) => o.id));
  let fresh = false;
  for (const id of paidIds) {
    if (!knownPaidIds.has(id)) {
      fresh = true;
      alertDismissedFor.delete(id);
    }
  }
  if (fresh && knownPaidIds.size > 0) {
    // new sale since first load
    playSaleBeep();
    toast('New PAID sale — pull it');
    for (const o of paidNow) {
      if (!knownPaidIds.has(o.id)) notifyNewSale(o);
    }
  }
  // seed on first load without blasting
  if (knownPaidIds.size === 0) {
    paidIds.forEach((id) => knownPaidIds.add(id));
  } else {
    paidIds.forEach((id) => knownPaidIds.add(id));
    // drop settled
    for (const id of [...knownPaidIds]) {
      if (![...paidIds].includes(id) && !paidPlus.some((o) => o.id === id && o.status === 'PAID')) {
        // keep history small
      }
    }
  }
  // Faster poll while PAID waiting
  const nextMs = paidNow.length ? 2000 : 4000;
  if (nextMs !== jobsPollMs) {
    jobsPollMs = nextMs;
    startJobsPoll();
  }
  updateSaleAlert(paidNow);
  renderJobs(paidPlus);
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
    list.innerHTML = '<div class="empty">No PAID sales yet.<br>Buyer must pay on the machine first — then a sale alert appears here.</div>';
    updateSaleAlert([]);
    return;
  }
  const paid = orders.filter((o) => o.status === 'PAID');
  const packing = orders.filter((o) => o.status === 'PACKING');
  const ready = orders.filter((o) => o.status === 'READY');
  const picked = orders.filter((o) => o.status === 'PICKED_UP');
  const accepted = orders.filter((o) => o.status === 'DELIVERED_ACCEPTED');
  list.innerHTML = '';

  // PAID first — unmissable
  if (paid.length) {
    const head = document.createElement('div');
    head.className = 'new-sale-head';
    head.textContent = 'New sale — pull it (start pack only after PAID)';
    list.appendChild(head);
    paid.forEach((o) => list.appendChild(jobCard(o)));
  }
  packing.forEach((o) => list.appendChild(jobCard(o)));
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
  picked.forEach((o) => list.appendChild(jobCard(o)));
  if (accepted.length) {
    const headA = document.createElement('div');
    headA.className = 'step-label';
    headA.textContent = 'Buyer confirmed (tote QR matched)';
    list.appendChild(headA);
    accepted.forEach((o) => list.appendChild(jobCard(o)));
  }
}


function shopLinesHtml(o) {
  const lines = o.lineItems || [];
  if (lines.length <= 1) return '';
  return `<ul style="margin:6px 0 0;padding-left:16px;font-size:12px;color:var(--muted);line-height:1.4">${
    lines.map((l) => `<li>${escapeHtml(l.title || 'Item')} · ${money(l.price)}${l.paid === false ? ' (pending)' : ''}</li>`).join('')
  }</ul>`;
}

function jobCard(o) {
  const el = document.createElement('article');
  el.className = `shop-job ${o.status}`;
  el.dataset.oid = o.id;
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
        ${shopLinesHtml(o)}
      </div>
    </div>
    ${o.amended && ['PAID','PACKING','READY'].includes(o.status)
      ? '<div class="banner paid" style="margin-top:10px">Order updated — pull added items</div>'
      : ''}
    ${o.status === 'PAID' && !o.amended ? '<div class="banner paid" style="margin-top:10px">NEW SALE — pull it. Start pack → pack photo with tote QR.</div>' : ''}
    ${o.status === 'PAID' && o.amended ? '<div class="banner paid" style="margin-top:8px">NEW SALE — pull all line items → pack photo with tote QR.</div>' : ''}
    <div class="panel" style="margin-top:10px">
      <div class="panel-label">Pack · two photos tied to the bag QR</div>
      <p style="font-size:12px;color:var(--muted);margin:0 0 6px;line-height:1.45">
        <strong>Photo 1 — before sealing:</strong> product placed on/over the bag’s QR, QR visible. This is the original scan: it starts packing and links the bag QR to this order (last-4 <strong>${o.last4}</strong>).<br>
        <strong>Photo 2 — after sealing:</strong> press the Mylar bag shut; the sealed bag with the <strong>QR-in-V and peel-and-seal strip visible</strong>. This marks the order <strong>READY</strong> and automatically calls delivery (own-driver shops are notified instead).
      </p>
      <p class="terms-note" style="margin:6px 0 0">${VPX.ACCEPT_RULE_SHOP}</p>
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
    ${o.packPhoto || o.status === 'DELIVERED_ACCEPTED' || o.toteQrFromPackPhoto ? `
      <div class="panel" style="margin-top:10px;border-color:rgba(46,196,182,0.45)">
        <div class="panel-label">Transaction identity (tote QR chain)</div>
        <p style="font-size:12px;color:var(--muted);margin:0 0 10px;line-height:1.4">
          QR read from the <strong>pack photo</strong> identifies this sale end-to-end.
          Buyer door photo must match that same code.
        </p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div>
            <div class="mono" style="margin-bottom:4px">Pack photo</div>
            ${o.packPhoto
              ? `<a href="${escapeHtml(o.packPhoto)}" target="_blank" rel="noopener"><img src="${escapeHtml(o.packPhoto)}" alt="Pack" style="width:100%;height:120px;object-fit:cover;border-radius:10px;border:1px solid #2a3344" /></a>`
              : `<div class="empty" style="min-height:120px;display:grid;place-items:center;font-size:11px">No pack image yet</div>`}
          </div>
          <div>
            <div class="mono" style="margin-bottom:4px">Buyer confirm</div>
            ${o.confirmImage
              ? `<a href="${escapeHtml(o.confirmImage)}" target="_blank" rel="noopener"><img src="${escapeHtml(o.confirmImage)}" alt="Buyer confirm" style="width:100%;height:120px;object-fit:cover;border-radius:10px;border:1px solid #2a3344" /></a>`
              : `<div class="empty" style="min-height:120px;display:grid;place-items:center;font-size:11px">Waiting for door QR</div>`}
          </div>
        </div>
        <div class="row-between" style="margin-top:10px">
          <span class="status-tag ${o.status === 'DELIVERED_ACCEPTED' ? 'READY' : 'PAID'}">${o.status === 'DELIVERED_ACCEPTED' ? 'QR MATCHED' : (o.toteQrFromPackPhoto ? 'PACK QR LINKED' : 'LINK QR')}</span>
          <span class="mono">${o.confirmedAt ? escapeHtml(String(o.confirmedAt).replace('T',' ').slice(0,19)) : ''}</span>
        </div>
        ${o.status === 'DELIVERED_ACCEPTED' ? `<p style="font-size:12px;color:#9fdad3;margin:8px 0 0;line-height:1.4">Customer confirmed intact drop-off — tote QR matched yours.</p>` : ''}
        <div class="mono" style="margin-top:6px;word-break:break-all;font-size:10px">Identity QR: ${escapeHtml(o.matchedToteQr || o.toteQrPayload || '—')}</div>
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

  if (['PAID', 'PACKING'].includes(o.status)) {
    const pc = packChecklistEl(o);
    el.insertBefore(pc, el.querySelector('.job-actions'));
  }
  const actions = el.querySelector('.job-actions');
  // Locked stream: PAID alert → Start pack ONLY (no pack/ready until PACKING)
  if (o.status === 'PAID') {
    actions.appendChild(btn('📷 Photo 1 — product on the bag QR (starts packing)', 'btn-red', () => capturePackPhoto(o)));
    actions.appendChild(btn('Demo stub (no camera)', 'btn-ghost', () => act(o.id, 'pack-photo')));
  }
  if (o.status === 'PACKING') {
    const done = o.packChecklist && o.packChecklist.done;
    const ck = o.packChecklist && o.packChecklist.checks || {};
    const allChecked = (o.checklistItems || []).every((i) => ck[i.id]);
    const st = document.createElement('div');
    st.className = 'mono';
    st.innerHTML = `Photo 1 ${o.packBeforeDone || o.packPhotoStub ? '✓' : '—'} · Photo 2 ${o.packAfterDone ? '✓' : 'next'}`;
    actions.appendChild(st);
    actions.appendChild(btn('Reshoot Photo 1', 'btn-ghost', () => capturePackPhoto(o)));
    actions.appendChild(btn('📷 Photo 2 — sealed bag, QR-in-V + strip visible → READY + call delivery', allChecked ? 'btn-teal' : 'btn-ghost', () => captureSealedPhoto(o)));
    actions.appendChild(btn('Demo stub (no camera)', 'btn-ghost', () => act(o.id, 'pack-sealed', { stub: true, checks: Object.fromEntries((o.checklistItems || []).map((i) => [i.id, true])) })));
  }
  if (o.status === 'READY') {
    const dsp = o.dispatch;
    const n = document.createElement('div');
    n.className = 'banner ok'; n.style.margin = '6px 0';
    n.textContent = dsp ? (dsp.mode === 'own' ? 'Ready — your own driver delivers it (no courier requested).' : 'Courier requested automatically (simulated) — pickup ETA ~15 min.') : 'Ready for pickup.';
    actions.appendChild(n);
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

function packChecklistEl(o) {
  const items = o.checklistItems || [];
  const cur = (o.packChecklist && o.packChecklist.checks) || {};
  const d = document.createElement('div');
  d.className = 'pack-check';
  d.innerHTML = `<div class="panel-label" style="margin-bottom:6px">Packing checklist · tick all, then take Photo 2</div>
    ${items.map((i) => `<label class="vp-check"><input type="checkbox" data-c="${i.id}" ${cur[i.id] ? 'checked' : ''}/> <span>${escapeHtml(i.label)}</span></label>`).join('')}
    <div class="vp-row" style="margin-top:8px"><button type="button" class="vp-btn sm" data-a="save">Save checklist</button></div>
    <p class="vp-hint" style="margin:6px 0 0">${o.packAfterDone ? '<b style="color:#7fe6dc">✓ Both photos on record.</b>' : `Photo 1 ${o.packBeforeDone || o.packPhotoStub ? '✓ done' : 'first'} · Photo 2 (sealed bag) needs every box ticked. (Photo storage is a stub in beta.)`}</p>`;
  const checks = () => Object.fromEntries(items.map((i) => [i.id, d.querySelector(`[data-c="${i.id}"]`).checked]));
  d.querySelector('[data-a="save"]').addEventListener('click', async () => {
    try { await api(`/api/orders/${o.id}/pack-checklist`, { method: 'POST', body: JSON.stringify({ checks: checks() }) }); await refreshJobs(); toast('Checklist saved'); } catch (e) { toast(e.message); }
  });
  d.checks = checks;
  return d;
}

/** Photo 2: sealed bag (QR-in-V + seal strip visible). Marks READY and triggers the delivery call. */
async function captureSealedPhoto(order) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*'; input.capture = 'environment';
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const photo = await fileToDataUrlShop(file);
      const card = document.querySelector(`[data-oid="${order.id}"]`) || document;
      const boxes = card.querySelectorAll('.pack-check [data-c]');
      const checks = {};
      boxes.forEach((b) => { checks[b.dataset.c] = b.checked; });
      const r = await api(`/api/orders/${order.id}/pack-sealed`, { method: 'POST', body: JSON.stringify({ photo, checks, qr: order.toteQrPayload }) });
      toast(r.dispatch && r.dispatch.mode === 'courier' ? 'READY — courier requested automatically (simulated)' : 'READY — your own driver delivers (no courier requested)');
      await refreshJobs();
    } catch (err) { toast(err.message || 'Photo 2 failed'); }
  };
  input.click();
}

function btn(label, cls, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn ${cls} btn-sm`;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}


async function capturePackPhoto(order) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.capture = 'environment';
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      toast('Reading tote QR from pack photo…');
      const dataUrl = await fileToDataUrlShop(file);
      let detected = await detectQrFromImageFile(file);
      let fromPack = !!detected;
      if (!detected) {
        toast('No QR found in pack photo — reshoot or enter bag QR manually');
        const manual = prompt('No QR detected. Enter/paste the tote bag QR payload (or Cancel to reshoot):');
        if (!manual || !manual.trim()) {
          toast('Reshoot pack photo with tote QR in frame');
          return;
        }
        detected = manual.trim();
        fromPack = false;
      }
      const { order: o, qrDetected } = await api(`/api/orders/${order.id}/pack-photo`, {
        method: 'POST',
        body: JSON.stringify({
          packImage: dataUrl,
          toteQrPayload: detected,
          qrDetectedFromPack: fromPack,
          fromPackPhoto: fromPack,
        }),
      });
      toast(fromPack || qrDetected
        ? 'Pack photo saved — tote QR is transaction identity'
        : 'Pack photo saved — QR linked manually (reshoot preferred)');
      await refreshJobs();
    } catch (err) {
      toast(err.message || 'Pack photo failed');
    }
  };
  input.click();
}

function fileToDataUrlShop(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function detectQrFromImageFile(file) {
  try {
    if ('BarcodeDetector' in window && typeof createImageBitmap === 'function') {
      const bmp = await createImageBitmap(file);
      let detector;
      try {
        detector = new BarcodeDetector({ formats: ['qr_code'] });
      } catch {
        detector = new BarcodeDetector();
      }
      const codes = await detector.detect(bmp);
      bmp.close && bmp.close();
      if (codes && codes[0] && codes[0].rawValue) return codes[0].rawValue;
    }
  } catch (_) {}
  try {
    if (!window.jsQR) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    const img = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => { URL.revokeObjectURL(url); resolve(im); };
      im.onerror = reject;
      im.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = window.jsQR(data.data, data.width, data.height);
    return code && code.data ? code.data : null;
  } catch (_) {
    return null;
  }
}

async function act(id, action, body) {
  try {
    await api(`/api/orders/${id}/${action}`, { method: 'POST', body: JSON.stringify(body || {}) });
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
  const low = products.filter((p) => p.stock && p.stock.low && !p.hidden);
  if (low.length) {
    const w = document.createElement('div');
    w.className = 'banner warn';
    w.style.marginBottom = '10px';
    w.innerHTML = `⚠ Low stock: ${low.map((p) => escapeHtml(p.title) + ' (' + p.stock.total + ')').join(' · ')}`;
    list.appendChild(w);
  }
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
          <div class="mono">${escapeHtml(p.category)} · ${money(p.price)} · ${earliest ? earliest.units + ' @ ' + earliest.label : 'no window'}${p.barcode ? ' · barcode ' + escapeHtml(p.barcode) : ''}</div>
          <div style="margin-top:5px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
            ${p.stock && p.stock.soldOut ? '<span class="stock-out">⛔ 0 stock — auto-hidden from buyers</span>' : p.stock && p.stock.low ? `<span class="stock-low">⚠ Low stock · ${p.stock.total} left</span>` : `<span class="mono">${p.stock ? p.stock.total : ''} total units</span>`}
            ${p.wantedBuyers ? `<span class="want-badge" title="${escapeHtml((p.wantedLabels || []).join(' · '))}">★ Someone wants this · ${p.wantedBuyers} buyer${p.wantedBuyers > 1 ? 's' : ''}</span>` : ''}
          </div>
        </div>
      </div>
      <div class="inv-actions">
        <button type="button" class="btn btn-sm btn-ghost" data-a="price">Edit price</button>
        <button type="button" class="btn btn-sm btn-ghost" data-a="units">Edit units</button>
        <button type="button" class="btn btn-sm btn-ghost" data-a="hide">${p.hidden ? 'Unhide' : 'Hide'}</button>
        <button type="button" class="btn btn-sm btn-ghost" data-a="sold">Mark sold out</button>
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
    el.querySelector('[data-a="sold"]').onclick = async () => {
      await api(`/api/products/${p.id}`, { method: 'PATCH', body: JSON.stringify({ soldOut: true }) });
      toast('Sold out — hidden from buyers until restocked');
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

let invSelectedFile = null;
let invBarcodeStream = null;
let invBarcodeTimer = null;

function wireInventoryCapture() {
  const camBtn = qs('#inv-cam-btn');
  const galBtn = qs('#inv-gallery-btn');
  const barBtn = qs('#inv-barcode-btn');
  const camInput = qs('#inv-file-cam');
  const galInput = qs('#inv-file-gallery');
  if (!camBtn || !camInput) return;

  camBtn.addEventListener('click', () => camInput.click());
  galBtn.addEventListener('click', () => galInput.click());
  camInput.addEventListener('change', () => onInvPhotoPicked(camInput));
  galInput.addEventListener('change', () => onInvPhotoPicked(galInput));
  barBtn.addEventListener('click', () => startBarcodeScan());
}

async function onInvPhotoPicked(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const preview = qs('#inv-preview');
  const title = qs('#inv-title');

  // Prefer galaxy composite before preview/save (shops upload white/light bg).
  let outFile = file;
  if (typeof BoxComposite !== 'undefined') {
    try {
      toast('Framing box on galaxy…');
      outFile = await BoxComposite.compositeFile(file);
    } catch (err) {
      console.warn('Galaxy composite failed, using original', err);
      outFile = file;
    }
  }
  invSelectedFile = outFile;
  if (preview._blobUrl) URL.revokeObjectURL(preview._blobUrl);
  const url = URL.createObjectURL(outFile);
  preview._blobUrl = url;
  preview.src = url;
  preview.classList.add('on');
  if (title) setTimeout(() => title.focus(), 50);
  toast(outFile !== file ? 'Galaxy frame ready — confirm title, price & windows' : 'Photo ready — confirm title, price & windows');
}

function setLinkedBarcode(code) {
  const raw = String(code || '').trim();
  qs('#inv-barcode').value = raw;
  const pill = qs('#inv-barcode-pill');
  const label = qs('#inv-barcode-label');
  if (!raw) {
    pill.classList.add('hidden');
    return;
  }
  label.textContent = raw;
  pill.classList.remove('hidden');
  // Suggest placeholder only — do not invent a product name
  const title = qs('#inv-title');
  if (title && !title.value.trim()) {
    title.placeholder = `Barcode ${raw} — confirm box title`;
  }
  title.focus();
  toast('Barcode linked — confirm/edit title');
}

function stopBarcodeScan() {
  if (invBarcodeTimer) {
    clearInterval(invBarcodeTimer);
    invBarcodeTimer = null;
  }
  if (invBarcodeStream) {
    invBarcodeStream.getTracks().forEach((tr) => tr.stop());
    invBarcodeStream = null;
  }
  const stage = qs('#inv-barcode-stage');
  if (stage) stage.classList.remove('on');
  const video = qs('#inv-barcode-video');
  if (video) video.srcObject = null;
}

async function ensureJsQR() {
  if (window.jsQR) return true;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return !!window.jsQR;
}

async function startBarcodeScan() {
  const status = qs('#inv-barcode-status');
  const stage = qs('#inv-barcode-stage');
  const video = qs('#inv-barcode-video');
  status.classList.remove('hidden');
  stopBarcodeScan();

  try {
    invBarcodeStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
  } catch (err) {
    status.textContent = 'Camera blocked — type barcode manually or use photo.';
    const manual = prompt('Enter barcode / UPC from the box');
    if (manual) setLinkedBarcode(manual);
    return;
  }

  stage.classList.add('on');
  video.srcObject = invBarcodeStream;
  await video.play();
  status.textContent = 'Aim at barcode on the box…';

  if ('BarcodeDetector' in window) {
    let detector;
    try {
      detector = new BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code', 'itf'],
      });
    } catch {
      detector = new BarcodeDetector();
    }
    invBarcodeTimer = setInterval(async () => {
      try {
        const codes = await detector.detect(video);
        if (codes && codes[0] && codes[0].rawValue) {
          setLinkedBarcode(codes[0].rawValue);
          status.textContent = 'Barcode linked';
          stopBarcodeScan();
        }
      } catch (_) {}
    }, 400);
    return;
  }

  // Fallback: jsQR (QR) + canvas frame; for 1D offer manual entry tip
  status.textContent = 'BarcodeDetector unavailable — trying QR fallback (or enter UPC manually)…';
  try {
    await ensureJsQR();
  } catch {
    status.textContent = 'No barcode engine — enter code manually.';
    const manual = prompt('Enter barcode / UPC from the box');
    if (manual) setLinkedBarcode(manual);
    stopBarcodeScan();
    return;
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  invBarcodeTimer = setInterval(() => {
    if (!video.videoWidth) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = window.jsQR(data.data, data.width, data.height);
    if (code && code.data) {
      setLinkedBarcode(code.data);
      status.textContent = 'Code linked (QR fallback)';
      stopBarcodeScan();
    }
  }, 500);
}

async function addProduct() {
  const title = qs('#inv-title').value.trim();
  if (!title) return toast('Title required — confirm the box name');
  const barcode = (qs('#inv-barcode') && qs('#inv-barcode').value.trim()) || '';
  const body = {
    title,
    subtitle: qs('#inv-sub').value.trim() || 'Sealed · Demo price — confirm with shop',
    category: qs('#inv-cat').value,
    price: Number(qs('#inv-price').value),
    units: Number(qs('#inv-units').value),
    windowLabel: qs('#inv-window').value.trim() || 'Today 4-6pm',
    imageUrl: qs('#inv-url').value.trim() || null,
    barcode: barcode || null,
  };
  try {
    const { product } = await api('/api/products', { method: 'POST', body: JSON.stringify(body) });
    const file = invSelectedFile
      || (qs('#inv-file-cam').files && qs('#inv-file-cam').files[0])
      || (qs('#inv-file-gallery').files && qs('#inv-file-gallery').files[0]);
    if (file) {
      const fd = new FormData();
      fd.append('productId', product.id);
      fd.append('image', file);
      const res = await fetch('/api/products/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
    }
    toast('Product live on machine');
    resetInventoryForm();
    loadInventory();
  } catch (err) {
    toast(err.message);
  }
}

function resetInventoryForm() {
  stopBarcodeScan();
  invSelectedFile = null;
  qs('#inv-title').value = '';
  qs('#inv-title').placeholder = 'Confirm box title (shop edits)';
  qs('#inv-sub').value = '';
  qs('#inv-url').value = '';
  qs('#inv-barcode').value = '';
  qs('#inv-barcode-pill').classList.add('hidden');
  qs('#inv-preview').classList.remove('on');
  qs('#inv-preview').removeAttribute('src');
  qs('#inv-file-cam').value = '';
  qs('#inv-file-gallery').value = '';
  qs('#inv-barcode-status').classList.add('hidden');
  qs('#inv-barcode-status').textContent = '';
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


// ---------------- Pause switch (11) ----------------
async function wirePause() {
  const tt = qs('#shop-terms-text'); if (tt && window.VPX) tt.innerHTML = '<b>Two photos per order:</b> Photo 1 — product on the bag’s QR before sealing; Photo 2 — the sealed bag with QR-in-V and seal strip visible. Photo 2 marks the order READY and automatically calls delivery. ' + VPX.ACCEPT_RULE_SHOP;
  const sw = qs('#pause-switch');
  if (!sw) return;
  const paint = (st) => {
    sw.checked = !!st.paused;
    qs('#pause-title').textContent = st.paused ? 'PAUSED — SKUs hidden' : 'Open for orders';
    qs('#pause-copy').textContent = st.paused ? 'Buyers can’t see or order your boxes. Flip off to reopen.' : 'Pause when closing early or on vacation — hides all your SKUs from the machine.';
    qs('#pause-card').classList.toggle('pause-on', !!st.paused);
    const v = st.verification;
    const vn = qs('#verify-note');
    if (vn) {
      if (v && v.status && v.status !== 'verified' && v.status !== 'approved') {
        vn.innerHTML = `<div class="banner warn" style="margin-bottom:10px">Business ID ${escapeHtml(v.status)} — VendiPort reviews it before you go live.</div>`;
      } else vn.innerHTML = '';
    }
  };
  try { paint(await api('/api/shop/status')); } catch (_) {}
  sw.addEventListener('change', async () => {
    try {
      const r = await api('/api/shop/pause', { method: 'POST', body: JSON.stringify({ paused: sw.checked, reason: sw.checked ? 'Closing early' : '' }) });
      paint(r); toast(r.message);
    } catch (e) { toast(e.message); sw.checked = !sw.checked; }
  });
}

// ---------------- Wanted feed (15) ----------------
async function loadWantedBadge() {
  try {
    const { wanted } = await api('/api/wanted');
    const n = wanted.filter((w) => !w.iHave && !w.listedNow.length).length;
    const b = qs('#wanted-badge');
    if (b) { b.textContent = n || ''; b.dataset.count = n; }
  } catch (_) {}
}
async function loadWanted() {
  const host = qs('#wanted-body');
  try {
    const d = await api('/api/wanted');
    if (!d.wanted.length) { host.innerHTML = 'No demand yet.'; return; }
    host.className = '';
    host.innerHTML = (d.demoSeeded ? '<div class="mono" style="margin-bottom:8px"><span class="status-tag CANCELLED">DEMO</span> includes seeded demo demand · ' + d.totalBuyers + ' anonymous buyers total</div>' : '') +
      d.wanted.map((w, i) => {
        const zips = w.zips.length ? w.zips.map((z) => `<span class="status-tag ${z.inArea ? 'READY' : 'CANCELLED'}" title="${z.inArea ? 'In service area' : 'Outside service area'}">${escapeHtml(z.zip)} ×${z.n}</span>`).join(' ') : '<span class="mono">spread across many ZIPs</span>';
        const growth = w.growth7d ? `<span class="mono" style="color:#7fe6dc">▲ ${w.growth7d} new this week</span>` : '';
        let state = '';
        if (w.iHave) state = `<span class="status-tag ${w.iHave.status === 'listed' ? 'READY' : 'PACKING'}">${w.iHave.status === 'listed' ? 'LISTED · followers alerted' : 'FLAGGED'}</span>`;
        else if (w.listedNow.length) state = `<span class="status-tag READY">IN STOCK · ${escapeHtml(w.listedNow[0].title)}</span>`;
        return `<div class="wanted-row" data-key="${escapeHtml(w.key)}">
          <div class="row-between" style="align-items:flex-start;gap:10px">
            <div style="display:flex;gap:10px;align-items:flex-start"><div class="rank">${i + 1}</div><div><div class="nm">${escapeHtml(w.label)}</div><div class="mono">${w.kind === 'box' ? 'Sealed box' : 'Chase card / player'}</div></div></div>
            <div style="text-align:right"><div class="big">${w.buyers}</div><div class="bl">buyers want it</div></div>
          </div>
          <div style="margin:8px 0;display:flex;gap:5px;flex-wrap:wrap;align-items:center"><span class="mono">Area demand:</span> ${zips}${w.otherAreas ? `<span class="mono">+${w.otherAreas} more ZIPs</span>` : ''}</div>
          <div class="row-between"><div>${growth} ${state}</div>
          <button type="button" class="btn btn-teal btn-sm" data-have="1" ${w.iHave && w.iHave.status === 'listed' ? 'disabled' : ''}>I have this</button></div>
        </div>`;
      }).join('');
    host.querySelectorAll('.wanted-row').forEach((row) => {
      const w = d.wanted.find((x) => x.key === row.dataset.key);
      row.querySelector('[data-have]').addEventListener('click', () => iHaveThis(w));
    });
    loadWantedBadge();
  } catch (e) { host.innerHTML = escapeHtml(e.message); }
}
async function iHaveThis(w) {
  const existing = w.listedNow && w.listedNow[0];
  let units = 0, price = 0;
  if (existing) {
    const v = prompt(`“${w.label}” matches ${existing.title} (${existing.units} on the machine).\nAdd more units? Enter 0 to just alert followers.`, '0');
    if (v == null) return;
    units = Math.max(0, parseInt(v, 10) || 0);
  } else {
    const v = prompt(`How many “${w.label}” do you have in stock?\n(Enter 0 to just flag that you have it — you can list it later.)`, '2');
    if (v == null) return;
    units = Math.max(0, parseInt(v, 10) || 0);
    if (units > 0 && w.kind === 'box' && !w.productId) { const p = prompt('Price per box ($)?', '40'); if (p == null) return; price = Number(p) || 0; }
  }
  try {
    const r = await api('/api/wanted/have', { method: 'POST', body: JSON.stringify({ key: w.key, units, price, productId: existing ? existing.id : undefined }) });
    toast(r.message, 5000);
    await loadWanted();
  } catch (e) { toast(e.message); }
}

// ---------------- Earnings (10) ----------------
async function loadEarnings() {
  const host = qs('#earn-body');
  try {
    const e = await api('/api/shop/earnings');
    const t = e.today;
    host.className = '';
    host.innerHTML = `
      <div class="card teal"><div class="step-label">Today · ${escapeHtml(t.day)}</div>
        <div class="line total"><span>Net payout</span><span>${money(t.net)}</span></div>
        <div class="line"><span class="muted">Delivered orders</span><span>${t.delivered}</span></div>
        <div class="line"><span class="muted">Product sales</span><span>${money(t.sales)}</span></div>
        <div class="line"><span class="muted">VendiPort fee (${Math.round(e.platformTake * 100)}%)</span><span>−${money(t.platformFee)}</span></div>
        ${e.ownDriver ? `<div class="line"><span class="muted">Delivery fees kept (own-driver)</span><span>+${money(t.deliveryKept)}</span></div>` : ''}
        <div class="line"><span class="muted">Cancel-fee share</span><span>+${money(t.cancelShare)}</span></div>
      </div>
      <div class="card"><div class="step-label">Coming up</div>
        <div class="line"><span class="muted">In progress (${e.pendingCount} order${e.pendingCount === 1 ? '' : 's'})</span><span>${money(e.pending)}</span></div>
        <p class="mono" style="margin-top:6px">${escapeHtml(e.payoutNote)}</p></div>
      ${(e.shopNotices || []).length ? `<div class="card"><div class="step-label">Delivery notices</div>${e.shopNotices.map((n) => `<div class="line"><span class="muted">${escapeHtml(n.text)}</span></div>`).join('')}</div>` : ''}
      <div class="card ${e.adjustments && e.adjustments.length ? 'warn' : ''}"><div class="step-label">Payout adjustments</div>
        ${e.adjustments && e.adjustments.length ? e.adjustments.map((a) => `<div class="line"><span class="muted">#${escapeHtml(a.last4 || '')} · ${escapeHtml(a.reason)}</span><span>${money(a.amount)}</span></div>`).join('') + `<div class="line total"><span>Total adjustments</span><span>${money(e.adjustmentsTotal)}</span></div>` : '<div class="mono">None.</div>'}
        <p class="mono" style="margin-top:6px">When VendiPort reviews a seal claim and finds shop fault, the order amount can be charged to the shop’s payout. It shows here.</p></div>
      <div class="card"><div class="step-label">Last 7 days</div>
        ${e.days.length ? e.days.map((d) => `<div class="line"><span class="muted">${escapeHtml(d.day)} · ${d.delivered} delivered</span><span>${money(d.net)}</span></div>`).join('') : '<div class="mono">No deliveries yet.</div>'}
        <div class="line total"><span>All-time net</span><span>${money(e.totalNet)}</span></div></div>`;
  } catch (er) { host.innerHTML = escapeHtml(er.message); }
}
