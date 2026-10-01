/* My Collection — purchase record synced from delivered orders, per-box break upload (social links), My Breaks, Radar tab */
const esc = VPX.esc;
let coll = null;
let tab = 'coll';
const bid = () => encodeURIComponent(VPX.buyerId());

function money2(n) { return '$' + Number(n || 0).toFixed(2); }
function fmtDate(iso) { try { return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }); } catch (_) { return ''; } }

function setTab(t) {
  tab = t;
  document.querySelectorAll('.vp-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
  qs('#t-coll').classList.toggle('hidden', t !== 'coll');
  qs('#t-breaks').classList.toggle('hidden', t !== 'breaks');
  qs('#t-radar').classList.toggle('hidden', t !== 'radar');
  qs('#page-tag').textContent = t === 'radar' ? 'MY RADAR' : t === 'breaks' ? 'MY BREAKS' : 'MY COLLECTION';
  if (t === 'radar') VPX.loadRadar().then(() => VPX.renderRadarInto(qs('#radar-host')));
  if (t === 'breaks') renderBreaks();
  history.replaceState(null, '', t === 'radar' ? '/radar' : t === 'breaks' ? '/my-breaks' : '/collection');
}

async function load() {
  try {
    coll = await api('/api/collection?buyer=' + bid());
    render();
  } catch (e) { qs('#items').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

function render() {
  const t = coll.totals;
  qs('#totals').innerHTML = `
    <div class="vp-total"><div class="n">${t.boxes}</div><div class="l">Boxes bought</div></div>
    <div class="vp-total"><div class="n">${money2(t.spent)}</div><div class="l">Total spent</div></div>
    <div class="vp-total"><div class="n">${t.hits}</div><div class="l">Hits pulled</div></div>`;
  const host = qs('#items');
  if (!coll.items.length) {
    host.innerHTML = '<div class="empty">No purchases on this device yet.<br>Order from the <a href="/">machine</a> — delivered boxes appear here automatically.</div>';
    return;
  }
  host.innerHTML = '';
  for (const it of coll.items) {
    const el = document.createElement('article');
    el.className = 'vp-break';
    el.id = 'box-' + it.orderId;
    const thumb = it.image ? `<img class="thumb" src="${esc(it.image)}" alt="" />` : `<div class="thumb">${it.emoji || '🎴'}</div>`;
    const stTag = it.delivered ? '<span class="vp-chip">Delivered</span>' : `<span class="vp-chip purple">${esc(it.status.replace('_', ' '))}</span>`;
    el.innerHTML = `
      <div class="vp-box">${thumb}<div>
        <h3>${esc(it.title)}</h3>
        <div class="meta">${esc(it.set)}${it.category ? ' · ' + esc(it.category) : ''}</div>
        <div class="meta">${money2(it.price)} · ${esc(fmtDate(it.date))} · #${esc(it.last4)}</div>
        <div style="margin-top:6px">${stTag}${it.breaks.length ? ` <span class="vp-chip gold">${it.breaks.length} break${it.breaks.length > 1 ? 's' : ''}</span>` : ''}</div>
      </div></div>
      ${it.hitsPulled.length ? `<div class="vp-hits">${it.hitsPulled.map((h) => `<span class="vp-chip gold">◎ ${esc(h)}</span>`).join('')}</div>` : ''}
      ${it.delivered ? `<button type="button" class="vp-btn purple block" style="margin-top:10px" data-add="${esc(it.orderId)}|${esc(it.lineId)}">▶ ${it.breaks.length ? 'Add another break' : 'Add my box break'}</button>
        <button type="button" class="vp-btn ghost block sm" style="margin-top:6px" data-log="${esc(it.orderId)}|${esc(it.lineId)}">Just log delivery · mark hits</button>`
        : `<a class="vp-btn ghost block sm" style="display:block;text-align:center;text-decoration:none;margin-top:10px" href="/track/${esc(it.orderId)}">Track order</a>`}
      ${it.breaks.map((b) => breakCard(b, true)).join('')}`;
    host.appendChild(el);
  }
  host.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => openBreakForm(...b.dataset.add.split('|'), false)));
  host.querySelectorAll('[data-log]').forEach((b) => b.addEventListener('click', () => openBreakForm(...b.dataset.log.split('|'), true)));
  wireBreakCards(host);
  const want = new URLSearchParams(location.search).get('order');
  if (want && !wireBreakCards._done) {
    wireBreakCards._done = true;
    const btn = host.querySelector(`[data-add^="${want}|"]`);
    if (btn) { btn.scrollIntoView({ block: 'center' }); btn.click(); }
  }
}

function breakCard(b, mine) {
  return `<div class="vp-break" style="margin-top:10px;background:rgba(12,22,28,.7)" data-br="${esc(b.id)}">
    <div class="row-between"><div>${VPX.platformTag(b.platform) || '<span class="vp-chip">Photos / hits</span>'}</div>
      <div class="vp-toggle" data-vis="${esc(b.id)}"><button type="button" data-v="private" class="${b.visibility === 'private' ? 'on' : ''}">Private</button><button type="button" data-v="public" class="${b.visibility === 'public' ? 'on' : ''}">Public</button></div></div>
    ${b.caption ? `<p style="font-size:13px;margin:8px 0 0">${esc(b.caption)}</p>` : ''}
    ${VPX.embedHtml(b.platform)}
    ${(b.photos || []).length ? `<div class="vp-photos">${b.photos.map((p) => `<img src="${esc(p)}" alt="" />`).join('')}</div>` : ''}
    ${(b.hitsPulled || []).length ? `<div class="vp-hits">${b.hitsPulled.map((h) => `<span class="vp-chip gold">◎ ${esc(h.name)}</span>`).join('')}</div>` : ''}
    <div class="vp-hint">${b.consentMarketing ? '✓ You allowed VendiPort to feature this in marketing' + (b.marketingStatus === 'approved' ? ' · <b style="color:#7fe6dc">featured</b>' : ' · pending review') : 'Not shared for marketing'} · ${b.visibility === 'public' ? 'Visible in the Breaks feed' : 'Only you can see this'}</div>
    ${b.visibility === 'public' ? VPX.shareButtons(b) : ''}
    <button type="button" class="vp-btn ghost sm" style="margin-top:8px" data-del="${esc(b.id)}">Delete</button>
  </div>`;
}

function wireBreakCards(root) {
  VPX.wireShare(root);
  root.querySelectorAll('[data-vis]').forEach((tg) => {
    if (tg.dataset.w) return; tg.dataset.w = '1';
    tg.querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => {
      try { await api('/api/breaks/' + tg.dataset.vis + '?buyer=' + bid(), { method: 'PATCH', body: JSON.stringify({ visibility: b.dataset.v }) }); toast(b.dataset.v === 'public' ? 'Now public in the Breaks feed' : 'Now private'); await load(); if (tab === 'breaks') renderBreaks(); } catch (e) { toast(e.message); }
    }));
  });
  root.querySelectorAll('[data-del]').forEach((b) => {
    if (b.dataset.w) return; b.dataset.w = '1';
    b.addEventListener('click', async () => { if (!confirm('Delete this break?')) return; try { await api('/api/breaks/' + b.dataset.del + '?buyer=' + bid(), { method: 'DELETE' }); toast('Deleted'); await load(); if (tab === 'breaks') renderBreaks(); } catch (e) { toast(e.message); } });
  });
}

async function renderBreaks() {
  const host = qs('#my-breaks');
  host.innerHTML = '<div class="empty">Loading…</div>';
  try {
    const { breaks } = await api('/api/breaks/mine?buyer=' + bid());
    host.innerHTML = breaks.length ? breaks.map((b) => `<div class="vp-break"><h3 style="font-size:14px">${esc(b.boxTitle)}</h3>${breakCard(b, true).replace('class="vp-break" style="margin-top:10px;background:rgba(12,22,28,.7)"', 'style="margin-top:6px"')}</div>`).join('') : '<div class="empty">No breaks yet.<br>Open <b>Collection</b> and tap “Add my box break” on a delivered box.</div>';
    wireBreakCards(host);
  } catch (e) { host.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

function openBreakForm(orderId, lineId, logOnly) {
  const it = coll.items.find((i) => i.orderId === orderId && i.lineId === lineId) || coll.items.find((i) => i.orderId === orderId);
  const body = VPX.openSheet(logOnly ? 'Log delivery' : 'My box break', esc(it.title), `
    ${logOnly ? '' : `<label class="vp-lbl">Link to your break video</label>
    <input class="vp-input" id="bk-url" inputmode="url" placeholder="Paste a YouTube, TikTok, Instagram, Facebook, X, Twitch… link" autocomplete="off" />
    <div id="bk-detect" class="vp-hint"></div>`}
    <label class="vp-lbl">Caption</label><input class="vp-input" id="bk-cap" maxlength="140" placeholder="What happened?" />
    <label class="vp-lbl">Tag</label><input class="vp-input" id="bk-tag" value="${esc(it.set)}" maxlength="24" />
    ${it.hitsOptions.length ? `<label class="vp-lbl">Hits you pulled (updates “Hits still available”)</label>${it.hitsOptions.map((h) => `<label class="vp-check"><input type="checkbox" class="bk-hit" value="${esc(h)}" ${it.hitsPulled.includes(h) ? 'checked' : ''}/> <span>${esc(h)}</span></label>`).join('')}` : ''}
    <label class="vp-lbl">Other hit (optional)</label><input class="vp-input" id="bk-hit-x" maxlength="60" placeholder="Card name" />
    ${logOnly ? '' : `<label class="vp-lbl">Photos (optional)</label><input type="file" id="bk-photos" accept="image/*" multiple style="width:100%;color:#cfd6e2" /><div class="vp-photos" id="bk-prev"></div>`}
    <label class="vp-lbl">Who can see it</label>
    <div class="vp-toggle" id="bk-vis"><button type="button" data-v="private" class="on">Private</button><button type="button" data-v="public">Public</button></div>
    <div class="vp-consent"><label class="vp-check" style="padding:0"><input type="checkbox" id="bk-consent" /><span><strong>Let VendiPort feature this break in marketing</strong><br><span class="vp-hint" style="margin:0">Optional — off by default. If you tick this, VendiPort may share your public link, hits and caption (with credit) on our channels. You can turn it off any time.</span></span></label></div>
    <button type="button" class="vp-btn purple block" id="bk-save" style="margin-top:14px;min-height:48px">${logOnly ? 'Save to My Collection' : 'Save break'}</button>`);
  let vis = 'private';
  body.querySelectorAll('#bk-vis button').forEach((b) => b.addEventListener('click', () => { vis = b.dataset.v; body.querySelectorAll('#bk-vis button').forEach((x) => x.classList.toggle('on', x === b)); }));
  const urlIn = body.querySelector('#bk-url');
  const detect = body.querySelector('#bk-detect');
  const NAMES = [[/youtu\.?be/, 'YouTube'], [/tiktok/, 'TikTok'], [/instagram|instagr\.am/, 'Instagram'], [/facebook|fb\.watch|fb\.com/, 'Facebook'], [/(^|\/\/|\.)x\.com|twitter/, 'X'], [/twitch/, 'Twitch'], [/vimeo/, 'Vimeo'], [/reddit|redd\.it/, 'Reddit'], [/kick\.com/, 'Kick']];
  if (urlIn) urlIn.addEventListener('input', () => {
    const v = urlIn.value.trim();
    if (!v) { detect.textContent = ''; return; }
    const m = NAMES.find((n) => n[0].test(v.toLowerCase()));
    const ok = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/|$|\?)/i.test(v);
    detect.innerHTML = !ok ? '<span style="color:#ff8a8a">That doesn’t look like a link yet</span>' : `<span style="color:#7fe6dc">✓ ${m ? m[1] : 'Link'} detected${m && /YouTube|TikTok|Instagram|Twitch|Vimeo/.test(m[1]) ? ' — will embed' : ' — will show a “Watch on ' + (m ? m[1] : 'site') + '” card'}</span>`;
  });
  let photos = [];
  const pin = body.querySelector('#bk-photos');
  if (pin) pin.addEventListener('change', async () => {
    photos = [];
    const prev = body.querySelector('#bk-prev'); prev.innerHTML = '';
    for (const f of Array.from(pin.files).slice(0, 4)) {
      const d = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
      photos.push(d); prev.insertAdjacentHTML('beforeend', `<img src="${d}" alt="" />`);
    }
  });
  body.querySelector('#bk-save').addEventListener('click', async () => {
    const hits = Array.from(body.querySelectorAll('.bk-hit:checked')).map((c) => c.value);
    const x = body.querySelector('#bk-hit-x').value.trim(); if (x) hits.push(x);
    const payload = { buyer: VPX.buyerId(), orderId, lineId, url: urlIn ? urlIn.value.trim() : '', caption: body.querySelector('#bk-cap').value, tags: [body.querySelector('#bk-tag').value], hitsPulled: hits, photos, visibility: vis, consentMarketing: body.querySelector('#bk-consent').checked };
    try { const r = await api('/api/breaks', { method: 'POST', body: JSON.stringify(payload) }); VPX.closeSheet(); toast(vis === 'public' ? 'Saved — live in the Breaks feed' : 'Saved to My Collection'); coll = r.collection; render(); } catch (e) { toast(e.message); }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  renderAccountChip();
  document.querySelectorAll('.vp-tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.t)));
  const p = location.pathname;
  load().then(() => { if (p === '/radar') setTab('radar'); else if (p === '/my-breaks') setTab('breaks'); });
});
