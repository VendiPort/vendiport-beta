/* Public Breaks gallery / feed (+ single break page at /breaks/<id>) */
const esc = VPX.esc;
function card(b, solo) {
  const hits = (b.hitsPulled || []).length
    ? `<div class="vp-lbl" style="margin-top:8px">Hits pulled</div><div class="vp-hits">${b.hitsPulled.map((h) => `<span class="vp-chip gold">◎ ${esc(h.name)}</span>`).join('')}</div>`
    : '<div class="vp-hint">No big hits this time — still a clean sealed delivery.</div>';
  return `<article class="vp-break" id="${esc(b.id)}">
    <div class="row-between"><h3 style="font-size:15px;color:#eef2f7">${esc(b.boxTitle)}</h3>${VPX.platformTag(b.platform)}</div>
    ${b.caption ? `<p style="font-size:13px;margin:6px 0 0;color:#cfd6e2">${esc(b.caption)}</p>` : ''}
    ${VPX.embedHtml(b.platform)}
    ${(b.photos || []).length ? `<div class="vp-photos">${b.photos.map((p) => `<img src="${esc(p)}" alt="" />`).join('')}</div>` : ''}
    ${hits}
    <div class="vp-hint" style="display:flex;justify-content:space-between"><span>${(b.tags || []).map((t) => '#' + esc(t.replace(/\s+/g, ''))).join(' ')}</span><span>${b.views || 0} views · ${b.shares || 0} shares${b.demo ? ' · <span class="vp-chip demo">demo</span>' : ''}</span></div>
    ${VPX.shareButtons(b)}
    ${solo ? '' : `<a class="vp-hint" href="/breaks/${esc(b.id)}">Permalink →</a>`}
  </article>`;
}
async function load() {
  const feed = document.getElementById('feed');
  const m = location.pathname.match(/^\/breaks\/(br_\w+)/);
  try {
    if (m) {
      const { break: b } = await api('/api/breaks/' + m[1] + '?buyer=' + encodeURIComponent(VPX.buyerId()));
      feed.innerHTML = card(b, true) + '<a class="vp-btn block" style="display:block;text-align:center;text-decoration:none;margin-top:14px" href="/">Shop same-day sealed boxes →</a>';
      document.getElementById('b-sub').textContent = 'A box break shared from VendiPort';
      VPX.ping('/api/breaks/' + b.id + '/view');
    } else {
      const { breaks, demo } = await api('/api/breaks/public');
      feed.innerHTML = breaks.length ? breaks.map((b) => card(b)).join('') : '<div class="empty">No public breaks yet — be the first from <a href="/collection">My Collection</a>.</div>';
      if (demo) document.getElementById('demo-note').textContent = 'Some entries are demo content for the beta.';
    }
    VPX.wireShare(feed);
  } catch (e) { feed.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
document.addEventListener('DOMContentLoaded', () => { renderAccountChip(); load(); });
