/* VendiPort beta — shared buyer extras: buyer id, header Radar/? buttons, key sheet, Radar sheet,
   area check, order timeline, break rendering. Loaded after api.js + session.js. */
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const VPX = (window.VPX = window.VPX || {});
  VPX.esc = esc;

  // ---- buyer id (device-bound demo identity; no accounts in beta) ----
  VPX.buyerId = function () {
    let id = null;
    try { id = localStorage.getItem('vp_buyer_id'); } catch (_) {}
    if (!id) {
      id = 'b_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      try { localStorage.setItem('vp_buyer_id', id); } catch (_) {}
    }
    return id;
  };
  const bid = () => encodeURIComponent(VPX.buyerId());
  VPX.zip = () => { try { return localStorage.getItem('vp_zip') || ''; } catch (_) { return ''; } };
  VPX.fmtTime = (iso) => { try { return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (_) { return ''; } };
  VPX.ping = (url, body) => { try { fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then((r) => r.text()).catch(() => {}); } catch (_) {} };
  VPX.event = (type, detail) => VPX.ping('/api/events', { type, detail, zip: VPX.zip() });
  window.addEventListener('error', (e) => VPX.event('error', 'js:' + String(e.message || '').slice(0, 80)));

  // ---- icons ----
  const STAR_SVG = (s) => `<svg viewBox="0 0 24 24" width="${s || 18}" height="${s || 18}" aria-hidden="true"><path d="M12 2.6l2.9 6.1 6.7.8-4.9 4.6 1.3 6.6L12 17.4 6 20.7l1.3-6.6L2.4 9.5l6.7-.8z" fill="none" stroke="#ffd84a" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.2" fill="#4fd1c5"/></svg>`;
  const BULLSEYE = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="#4fd1c5" stroke-width="2"/><circle cx="12" cy="12" r="6.2" fill="none" stroke="#e8f7f5" stroke-width="2"/><circle cx="12" cy="12" r="2.4" fill="#4fd1c5"/></svg>`;
  VPX.STAR_SVG = STAR_SVG;

  // ---- sheet ----
  let sheetEl = null;
  VPX.openSheet = function (title, sub, html) {
    VPX.closeSheet();
    sheetEl = document.createElement('div');
    sheetEl.className = 'vp-sheet-overlay';
    sheetEl.innerHTML = `<div class="vp-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="vp-sheet-top"><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div><button type="button" class="vp-x" aria-label="Close">×</button></div><div class="vp-sheet-body">${html || ''}</div></div>`;
    document.body.appendChild(sheetEl);
    sheetEl.querySelector('.vp-x').addEventListener('click', VPX.closeSheet);
    sheetEl.addEventListener('click', (e) => { if (e.target === sheetEl) VPX.closeSheet(); });
    return sheetEl.querySelector('.vp-sheet-body');
  };
  VPX.closeSheet = function () { if (sheetEl) { sheetEl.remove(); sheetEl = null; } };

  // ---- "How VendiPort works" key ----
  VPX.openKey = function () {
    const rows = [
      [BULLSEYE, 'Hits still available', 'Bull’s-eye = top cards that may still be inside that sealed box. Tap it on any box.'],
      [STAR_SVG(18), 'Radar (star)', 'Tap the star on a chase card, or type a card / player / set / box. We alert you — in-app and by text if you opt in — when a match is listed near you. <a href="#" data-k="radar">Open my Radar →</a>'],
      ['📍', 'Your area', 'Enter your ZIP up front. In our service list = same-day. Outside = ship-only message (same-day coming soon).'],
      ['✉️', 'Text updates', 'Opt in at checkout for Paid → Packing → Ready → Out messages. Beta texts are simulated and shown in-app.'],
      ['🔢', 'Delivery code', 'A 4-digit code appears on your order once it’s out. Read it to the courier — or they snap photo proof.'],
      ['🛡️', 'Seal check', 'At the door, tap/scan the tote QR, then answer “Was the seal intact?” “No” opens a dispute with VendiPort.'],
      ['↩️', 'One-tap cancel', 'Cancel until pickup with a quick reason. Fee: 15% of product; delivery refunded.'],
      ['▣', 'My Collection', 'Every delivered box syncs into your personal record: box, set, price, date, hits and breaks. <a href="/collection">Open →</a>'],
      ['▶', 'Box breaks', 'Paste a link to your break from YouTube, TikTok, Instagram, Facebook, X, Twitch and more. Public ones appear in <a href="/breaks">Breaks</a>.'],
      ['⭐', 'Ratings', 'After delivery, rate the shop and the delivery in one tap.'],
    ];
    const body = VPX.openSheet('How VendiPort works', 'Quick key to the icons you’ll see', rows.map((r) => `<div class="vp-key-row"><div class="vp-key-ico">${r[0]}</div><div><strong>${r[1]}</strong><span class="d">${r[2]}</span></div></div>`).join('') + '<p class="vp-hint" style="text-align:center">Press <b>?</b> anytime to open this key.</p>');
    const a = body.querySelector('[data-k="radar"]');
    if (a) a.addEventListener('click', (e) => { e.preventDefault(); VPX.openRadar(); });
  };

  // ---- Radar ----
  VPX.radar = { items: [], alerts: [], sms: [], unread: 0, onRadarProducts: {}, keys: new Set(), loaded: false };
  const keyOf = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((t) => t && !['rc', 'rookie', 'card', 'cards', 'box', 'the', 'a', 'of', 'and', 'auto', 'autograph', 'sealed'].includes(t)).join(' ');
  VPX.keyOf = keyOf;
  VPX.loadRadar = async function () {
    try {
      const d = await api('/api/radar?buyer=' + bid());
      VPX.radar = Object.assign(VPX.radar, d, { keys: new Set((d.items || []).map((i) => keyOf(i.label))), loaded: true });
      updateBadge();
      document.dispatchEvent(new CustomEvent('vp-radar'));
    } catch (_) {}
    return VPX.radar;
  };
  function updateBadge() {
    document.querySelectorAll('.vp-radar-badge-count').forEach((b) => {
      b.textContent = VPX.radar.unread || '';
      b.classList.toggle('hidden', !VPX.radar.unread);
    });
  }
  VPX.addRadar = async function (label, kind, opts) {
    opts = opts || {};
    try {
      if (opts.search !== false) { try { await api('/api/search?q=' + encodeURIComponent(label) + '&zip=' + encodeURIComponent(VPX.zip())); } catch (_) {} }
      const d = await api('/api/radar', { method: 'POST', body: JSON.stringify({ buyer: VPX.buyerId(), label, kind: kind || 'card', source: opts.source || 'search', productId: opts.productId || null, zip: VPX.zip() }) });
      VPX.radar = Object.assign(VPX.radar, d, { keys: new Set((d.items || []).map((i) => keyOf(i.label))) });
      updateBadge();
      document.dispatchEvent(new CustomEvent('vp-radar'));
      toast(d.already ? 'Already on your Radar' : '★ Added to your Radar');
      return d;
    } catch (err) { toast(err.message); }
  };
  VPX.removeRadar = async function (id) {
    try {
      const d = await api('/api/radar/' + id + '?buyer=' + bid(), { method: 'DELETE' });
      VPX.radar = Object.assign(VPX.radar, d, { keys: new Set((d.items || []).map((i) => keyOf(i.label))) });
      updateBadge();
      document.dispatchEvent(new CustomEvent('vp-radar'));
      return d;
    } catch (err) { toast(err.message); }
  };
  VPX.toggleRadar = async function (label, kind, opts) {
    const k = keyOf(label);
    const ex = (VPX.radar.items || []).find((i) => keyOf(i.label) === k);
    if (ex) { await VPX.removeRadar(ex.id); toast('Removed from Radar'); return false; }
    await VPX.addRadar(label, kind, opts);
    return true;
  };
  VPX.renderRadarInto = function (host, opts) {
    opts = opts || {};
    const R = VPX.radar;
    const items = (R.items || []).map((i) => `
      <div class="vp-radar-item${i.available && i.available.length ? ' live' : ''}">
        <span class="star">${STAR_SVG(20)}</span>
        <div class="grow"><div class="nm">${esc(i.label)}</div>
          <div class="sub2">${esc(i.kind)}${i.zip ? ' · ' + esc(i.zip) : ''} · ${i.available && i.available.length ? '<b style="color:#ffd84a">On your radar — available now: ' + esc(i.available[0].title) + '</b>' : 'watching'}</div></div>
        <button type="button" class="vp-btn ghost sm" data-rm="${esc(i.id)}">Remove</button>
      </div>`).join('') || '<p class="vp-hint" style="text-align:center;padding:14px 0">Nothing on your Radar yet. Add a card, player, set or box — or tap the ☆ on a chase card.</p>';
    const alerts = (R.alerts || []).map((a) => `<div class="vp-alert${a.read ? ' read' : ''}">${esc(a.text)}<small>${esc(VPX.fmtTime(a.at))}</small></div>`).join('');
    const sms = (R.sms || []).map((s) => `<div class="vp-sms">${esc(s.text)}<small>→ ${esc(s.to)} · ${esc(VPX.fmtTime(s.at))} · simulated text</small></div>`).join('');
    host.innerHTML = `
      <div class="vp-row"><input class="vp-input" id="rdr-in" placeholder="Card, player, set or box…" maxlength="80" autocomplete="off" />
        <select class="vp-select" id="rdr-kind" style="width:94px"><option value="card">Card</option><option value="player">Player</option><option value="set">Set</option><option value="box">Box</option></select></div>
      <button type="button" class="vp-btn block" id="rdr-add" style="margin-top:8px">${'★'} Add to Radar</button>
      <p class="vp-hint">Anonymous: stores only see how many buyers want something — never who.</p>
      <div class="vp-lbl">Your Radar (${(R.items || []).length})</div>${items}
      <div class="vp-lbl">Alerts${R.unread ? ' · ' + R.unread + ' new' : ''}</div>${alerts || '<p class="vp-hint">No alerts yet. We’ll ping you here the moment a match is listed nearby.</p>'}
      <div class="vp-lbl">Text log (simulated)</div>
      ${R.textsOn ? `<p class="vp-hint" style="margin:0 0 4px">Texts on for ${esc(R.phoneMasked)}</p>` : `<div class="vp-row"><input class="vp-input" id="rdr-phone" type="tel" placeholder="Mobile for text alerts (optional)" /><button type="button" class="vp-btn ghost" id="rdr-phone-go">Text me</button></div>`}
      ${sms || '<p class="vp-hint">No texts sent. Beta texts are simulated — nothing is really sent.</p>'}`;
    const add = async () => {
      const inp = host.querySelector('#rdr-in');
      const v = inp.value.trim();
      if (v.length < 2) return toast('Type a card, player, set or box');
      await VPX.addRadar(v, host.querySelector('#rdr-kind').value, { source: 'search' });
      VPX.renderRadarInto(host, opts);
    };
    host.querySelector('#rdr-add').addEventListener('click', add);
    host.querySelector('#rdr-in').addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    host.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => { await VPX.removeRadar(b.dataset.rm); VPX.renderRadarInto(host, opts); }));
    const pg = host.querySelector('#rdr-phone-go');
    if (pg) pg.addEventListener('click', async () => {
      const ph = host.querySelector('#rdr-phone').value.trim();
      if (ph.replace(/\D/g, '').length < 10) return toast('Enter a valid mobile number');
      try { await api('/api/buyer/' + bid(), { method: 'PUT', body: JSON.stringify({ phone: ph, notifyText: true }) }); await VPX.loadRadar(); toast('Text alerts on (simulated)'); VPX.renderRadarInto(host, opts); } catch (e) { toast(e.message); }
    });
  };
  VPX.openRadar = async function () {
    const body = VPX.openSheet(STAR_SVG(18) + ' My Radar', 'Wish list + watch list · alerts when matches are listed nearby', '<div class="empty">Loading…</div>');
    await VPX.loadRadar();
    VPX.renderRadarInto(body, {});
    try { await api('/api/radar/read', { method: 'POST', body: JSON.stringify({ buyer: VPX.buyerId() }) }); setTimeout(VPX.loadRadar, 400); } catch (_) {}
  };

  // ---- area check ----
  VPX.areaMsg = null;
  VPX.checkArea = async function (zip) {
    const a = await api('/api/area?zip=' + encodeURIComponent(zip) + '&buyer=' + bid());
    if (a.valid) { try { localStorage.setItem('vp_zip', a.zip); } catch (_) {} VPX.areaMsg = a; }
    return a;
  };
  VPX.renderArea = function (host) {
    if (!host) return;
    const zip = VPX.zip();
    host.innerHTML = `
      <div class="panel-label">Your area</div>
      <div class="vp-row"><input class="vp-input" id="area-zip" inputmode="numeric" maxlength="5" placeholder="ZIP code" value="${esc(zip)}" style="max-width:130px" />
        <button type="button" class="vp-btn" id="area-go">Check same-day</button>
        <a href="#" class="vp-area-edit" id="area-addr">Saved address</a></div>
      <div id="area-msg"></div>`;
    const show = (a) => {
      const m = host.querySelector('#area-msg');
      if (!a || !a.valid) { m.innerHTML = a ? `<div class="msg no">${esc(a.message)}</div>` : ''; return; }
      m.innerHTML = `<div class="msg ${a.inArea ? 'ok' : 'no'}">${a.inArea ? '✓ ' : '✈ '}${esc(a.message)}</div>`;
      document.dispatchEvent(new CustomEvent('vp-area', { detail: a }));
    };
    const go = async () => {
      const z = host.querySelector('#area-zip').value.trim();
      try { const a = await VPX.checkArea(z); show(a); } catch (e) { toast(e.message); }
    };
    host.querySelector('#area-go').addEventListener('click', go);
    host.querySelector('#area-zip').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    host.querySelector('#area-addr').addEventListener('click', async (e) => {
      e.preventDefault();
      let p = {};
      try { p = (await api('/api/buyer/' + bid())).buyer; } catch (_) {}
      const a = p.address || {};
      const body = VPX.openSheet('Saved address', 'Used for same-day delivery checks', `
        <label class="vp-lbl">Street</label><input class="vp-input" id="ad-l1" value="${esc(a.line1 || '')}" placeholder="123 Main St" />
        <div class="vp-row"><div style="flex:1"><label class="vp-lbl">City</label><input class="vp-input" id="ad-city" value="${esc(a.city || '')}" /></div>
        <div style="width:96px"><label class="vp-lbl">ZIP</label><input class="vp-input" id="ad-zip" inputmode="numeric" maxlength="5" value="${esc(a.zip || p.zip || VPX.zip())}" /></div></div>
        <label class="vp-lbl">Drop-off note</label><input class="vp-input" id="ad-note" value="${esc(a.note || '')}" placeholder="Gate code, buzzer…" />
        <button type="button" class="vp-btn block" id="ad-save" style="margin-top:12px">Save address</button>`);
      body.querySelector('#ad-save').addEventListener('click', async () => {
        try {
          const r = await api('/api/buyer/' + bid(), { method: 'PUT', body: JSON.stringify({ address: { line1: body.querySelector('#ad-l1').value, city: body.querySelector('#ad-city').value, zip: body.querySelector('#ad-zip').value, note: body.querySelector('#ad-note').value } }) });
          try { if (r.buyer.zip) localStorage.setItem('vp_zip', r.buyer.zip); } catch (_) {}
          VPX.closeSheet(); VPX.renderArea(host); show(r.area); host.querySelector('#area-zip').value = r.buyer.zip || '';
          toast('Address saved');
        } catch (er) { toast(er.message); }
      });
    });
    if (zip) { VPX.checkArea(zip).then(show).catch(() => {}); }
  };

  // ---- timeline ----
  VPX.renderTimeline = function (host, order) {
    if (!host || !order) return;
    const steps = ['paid', 'packing', 'ready', 'out'];
    const labels = { paid: 'Paid', packing: 'Packing', ready: 'Ready', out: 'Out' };
    const T = order.timeline || [];
    const text = order.timelineText || {};
    const rows = steps.map((k, i) => {
      const t = T.find((x) => x.key === k);
      return `<div class="vp-tl-step${t ? ' done' : ''}"><div class="dot">${t ? '✓' : i + 1}</div><div class="tx"><b>${labels[k]}</b> — ${esc(t ? t.text : text[k] || '')}${t ? `<span class="tm">${esc(VPX.fmtTime(t.at))}</span>` : ''}</div></div>`;
    }).join('');
    const extra = ['arrived', 'delivered', 'cancelled', 'refused'].map((k) => T.find((x) => x.key === k)).filter(Boolean)
      .map((t) => `<div class="vp-tl-step done"><div class="dot">✓</div><div class="tx"><b>${esc(t.key[0].toUpperCase() + t.key.slice(1))}</b> — ${esc(t.text)}<span class="tm">${esc(VPX.fmtTime(t.at))}</span></div></div>`).join('');
    const log = (order.smsLog || []).map((s) => `<div class="vp-sms">${esc(s.text)}<small>→ ${esc(s.to)} · ${esc(VPX.fmtTime(s.at))} · text sent (simulated)</small></div>`).join('');
    const nf = order.notify || {};
    const final = ['DELIVERED_ACCEPTED', 'CANCELLED', 'REFUSED_SEAL'].includes(order.status);
    host.innerHTML = `
      <div class="panel-label">Order status</div><div class="vp-tl">${rows}${extra}</div>
      <div class="vp-lbl">Text updates</div>
      ${nf.optIn ? `<p class="vp-hint" style="margin:0 0 6px">✓ Texting ${esc(nf.phoneMasked)} (simulated — no real SMS in beta)</p>` : (final ? '' : `<div class="vp-row"><input class="vp-input" id="tl-phone" type="tel" placeholder="Mobile number" /><button type="button" class="vp-btn" id="tl-go">Text me updates</button></div><p class="vp-hint">Opt in to get each status as a text. Beta: shown below as a simulated log.</p>`)}
      ${log ? `<div class="vp-lbl">Text log</div>${log}` : ''}`;
    const go = host.querySelector('#tl-go');
    if (go) go.addEventListener('click', async () => {
      const phone = host.querySelector('#tl-phone').value.trim();
      try { const r = await api(`/api/orders/${order.id}/notify`, { method: 'POST', body: JSON.stringify({ phone }) }); VPX.renderTimeline(host, r.order); toast('Text updates on (simulated)'); } catch (e) { toast(e.message); }
    });
  };

  // ---- breaks rendering (shared by collection + gallery) ----
  VPX.platformTag = (p) => p ? `<span class="vp-plat" style="color:${esc(p.color)}"><i>${esc(p.icon)}</i>${esc(p.label)}</span>` : '';
  VPX.embedHtml = function (p) {
    if (!p) return '';
    if (p.embed && /^https:\/\//.test(p.embed)) {
      const tall = p.id === 'tiktok' || p.id === 'instagram' || /shorts/.test(p.url || '');
      return `<div class="vp-embed${tall ? ' tall' : ''}"><iframe src="${esc(p.embed)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" title="${esc(p.label)} box break"></iframe></div>`;
    }
    if (p.embed && /^twitch-(clip|video):/.test(p.embed)) {
      const [kind, id] = p.embed.split(':');
      const src = kind === 'twitch-clip' ? `https://clips.twitch.tv/embed?clip=${encodeURIComponent(id)}&parent=${location.hostname}` : `https://player.twitch.tv/?video=${encodeURIComponent(id)}&parent=${location.hostname}&autoplay=false`;
      return `<div class="vp-embed"><iframe src="${esc(src)}" allowfullscreen loading="lazy" title="Twitch box break"></iframe></div>`;
    }
    return `<a class="vp-watch" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer" style="color:${esc(p.color)}"><div class="pi">${esc(p.icon)}</div><div><div class="wt" style="color:#eef2f7">Watch on ${esc(p.label)}</div><div class="ws">Opens in ${esc(p.label)} · ${esc((p.url || '').replace(/^https?:\/\//, '').slice(0, 42))}</div></div></a>`;
  };
  VPX.shareUrl = (id) => location.origin + '/breaks/' + id;
  VPX.shareButtons = function (b) {
    const url = VPX.shareUrl(b.id);
    const txt = encodeURIComponent(`${b.boxTitle} box break on VendiPort${(b.hitsPulled || []).length ? ' — pulled ' + b.hitsPulled.map((h) => h.name).join(', ') : ''}`);
    return `<div class="vp-share">
      <button type="button" class="vp-btn sm" data-share="copy" data-id="${esc(b.id)}">Copy link</button>
      <button type="button" class="vp-btn sm purple" data-share="native" data-id="${esc(b.id)}">Share…</button>
      <a class="vp-btn sm ghost" style="text-decoration:none;display:inline-grid;place-items:center" target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?text=${txt}&url=${encodeURIComponent(url)}">𝕏</a>
      <a class="vp-btn sm ghost" style="text-decoration:none;display:inline-grid;place-items:center" target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}">f</a>
      <a class="vp-btn sm ghost" style="text-decoration:none;display:inline-grid;place-items:center" target="_blank" rel="noopener" href="/api/breaks/${esc(b.id)}/card.svg?buyer=${bid()}">Share card</a></div>
      <p class="vp-hint">Share card = VendiPort-branded image with watermark + caption template (stub).</p>`;
  };
  VPX.wireShare = function (root) {
    root.querySelectorAll('[data-share]').forEach((btn) => {
      if (btn.dataset.wired) return; btn.dataset.wired = '1';
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id, url = VPX.shareUrl(id);
        const caption = `Check out my box break on VendiPort 🔥 ${url}`;
        if (btn.dataset.share === 'native' && navigator.share) { try { await navigator.share({ title: 'VendiPort box break', text: 'Check out my box break on VendiPort', url }); } catch (_) { return; } }
        else { try { await navigator.clipboard.writeText(caption); toast('Link + caption copied'); } catch (_) { prompt('Copy this:', caption); } }
        VPX.ping('/api/breaks/' + id + '/share');
      });
    });
  };

  // ---- header buttons + "?" key ----
  function injectHeader() {
    document.querySelectorAll('.brand-row-spread').forEach((row) => {
      if (row.querySelector('.vp-tools')) return;
      const chip = row.querySelector('.account-chip');
      const t = document.createElement('div');
      t.className = 'vp-tools';
      t.innerHTML = `<a class="vp-tool-btn" href="/collection" title="My Collection" aria-label="My Collection" style="font-size:14px">▣</a>
        <button type="button" class="vp-tool-btn" data-act="radar" title="My Radar" aria-label="My Radar">${STAR_SVG(18)}<span class="vp-badge vp-radar-badge-count hidden"></span></button>
        <button type="button" class="vp-tool-btn" data-act="key" title="How VendiPort works (?)" aria-label="How VendiPort works">?</button>`;
      if (chip) row.insertBefore(t, chip); else row.appendChild(t);
      t.querySelector('[data-act="radar"]').addEventListener('click', () => VPX.openRadar());
      t.querySelector('[data-act="key"]').addEventListener('click', () => VPX.openKey());
    });
  }
  document.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
    if (e.key === '?') { e.preventDefault(); VPX.openKey(); }
    if (e.key === 'Escape') VPX.closeSheet();
  });
  document.addEventListener('DOMContentLoaded', () => { injectHeader(); VPX.loadRadar(); });
})();
