/* VendiPort owner /admin — dashboard, owner diagnostics, disputes, verification, content queue.
   Real numbers come from JSON state; anything seeded is tagged DEMO. */
(function () {
'use strict';
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const $ = (s) => document.querySelector(s);
let PASS = '';
try { PASS = sessionStorage.getItem('vp_admin') || ''; } catch (_) {}
let OV = null, TAB = 'dash';
const TABS = [['dash', 'Dashboard'], ['demand', 'Demand'], ['sales', 'Sales & money'], ['ful', 'Fulfillment'], ['trust', 'Trust & safety'], ['stores', 'Stores'], ['health', 'Product health'], ['disputes', 'Disputes'], ['verify', 'Shop approval'], ['content', 'Content queue']];

async function A(path, opts) {
  const r = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json', 'x-admin-passcode': PASS } }, opts || {}));
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.error || r.statusText); e.status = r.status; throw e; }
  return d;
}
const usd = (n) => '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const DEMO = '<span class="tag demo">demo</span>';
const REAL = '<span class="tag real">live</span>';
const dash = (v, u) => (v == null ? '—' : v + (u || ''));
const fmt = (iso) => { try { return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (_) { return ''; } };
const kpi = (n, l, cls) => `<div class="kpi"><div class="n ${cls || ''}">${n}</div><div class="l">${l}</div></div>`;
const bar = (pct) => `<div class="bar"><i style="width:${Math.max(2, Math.min(100, pct))}%"></i></div>`;
const toast = (m) => { let t = $('#toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); } t.textContent = m; t.classList.remove('hidden'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 2600); };

async function unlock(pw) {
  PASS = pw;
  try {
    await A('/api/admin/overview');
    try { sessionStorage.setItem('vp_admin', pw); } catch (_) {}
    $('#gate').classList.add('hidden'); $('#app').classList.remove('hidden');
    await refresh();
  } catch (e) { PASS = ''; $('#pw-hint').textContent = e.status === 401 ? 'Wrong passcode' : e.message; $('#pw-hint').style.color = '#ff8a8a'; }
}

async function refresh() {
  OV = await A('/api/admin/overview');
  $('#who').textContent = OV.passcodeIsDefault ? 'dev passcode in use — set ADMIN_PASSCODE' : 'secured';
  paintTabs(); await paint();
}
function paintTabs() {
  const d = OV.dashboard;
  const badge = { disputes: d.openDisputes, verify: d.awaitingVerification, content: d.pendingMarketing };
  $('#tabs').innerHTML = TABS.map(([k, l]) => `<button data-t="${k}" class="${TAB === k ? 'on' : ''}">${l}${badge[k] ? `<span class="n">${badge[k]}</span>` : ''}</button>`).join('');
  $('#tabs').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { TAB = b.dataset.t; paintTabs(); paint(); }));
}
let NET = null, NETON = false;
const NETTABS = ['dash', 'demand', 'sales', 'stores'];
async function paint() {
  const v = $('#view');
  v.innerHTML = '<div class="empty">Loading…</div>';
  try {
    if (NETTABS.includes(TAB)) {
      if (NETON && !NET) NET = await A('/api/admin/network');
      v.innerHTML = netToggle();
      const body = document.createElement('div'); v.appendChild(body);
      v.querySelector('[data-net]').addEventListener('click', (e) => { NETON = !NETON; paint(); });
      if (NETON) NETVIEWS[TAB](body); else await VIEWS[TAB](body);
    } else await VIEWS[TAB](v);
  } catch (e) { v.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

function table(head, rows, right) {
  right = right || [];
  return `<table class="t"><thead><tr>${head.map((h, i) => `<th class="${right.includes(i) ? 'r' : ''}">${h}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map((r) => `<tr>${r.map((c, i) => `<td class="${right.includes(i) ? 'r' : ''}">${c}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${head.length}" class="note">No data yet</td></tr>`}</tbody></table>`;
}

function patternCards(T) {
  const P = T.patterns || { stores: [], drivers: [], buyers: [] };
  const rows = (arr, extra) => arr.slice(0, 8).map((r) => [esc(r.name) + (r.repeat ? ' <span class="tag red">repeat offender</span>' : ''), r.d30, r.total, extra ? extra(r) : r.faults, esc(r.consequence), r.demo ? DEMO : REAL]);
  return `<div class="grid2"><div class="card sec"><h2>Claims by store</h2>${table(['Store', '30d', 'All', 'At fault', 'Consequence', ''], rows(P.stores), [1, 2, 3])}</div>
    <div class="card sec"><h2>Claims by driver</h2>${table(['Driver', '30d', 'All', 'At fault', 'Consequence', ''], rows(P.drivers), [1, 2, 3])}</div></div>
    <div class="card sec"><h2>Claims by buyer <span class="note">(anonymised) · refunds auto-hold after 2 claims in 30 days</span></h2>${table(['Buyer', '30d', 'All', 'Strikes', 'Consequence', ''], rows(P.buyers, (r) => r.strikes || 0), [1, 2, 3])}</div>`;
}
const pct = (n) => (n == null ? '—' : n + '%');
const netToggle = () => `<div class="row-between" style="margin-bottom:10px"><span class="note">${NETON ? `Showing the <b style="color:#ffd84a">20-store DEMO / projected</b> network. Real LIVE numbers are on the “Live” view.` : 'Showing real LIVE numbers (plus labelled seeded demo).'}</span><button type="button" class="vp-btn sm ${NETON ? 'purple' : 'ghost'}" data-net="1">${NETON ? '← Live view' : '20-store demo view →'}</button></div>`;
const NETBANNER = `<div class="banner warn" style="margin-bottom:10px"><b>DEMO / projected</b> — modelled from the assumptions below, not real sales. Live numbers stay on the “Live view”.</div>`;
function netAssumptions() {
  const a = NET.assumptions;
  return `<div class="card sec"><h2>Assumptions ${DEMO}</h2>
    <div class="line"><span class="muted">Stores</span><span>${a.stores} across ${new Set(NET.stores.map((x) => x.zip)).size} ZIPs / SF-area neighborhoods</span></div>
    <div class="line"><span class="muted">Orders / store / day (median store)</span><span>${a.ordersPerStorePerDayMedian}</span></div>
    <div class="line"><span class="muted">Standout store</span><span>${a.standoutMultiple}× the median (one store only)</span></div>
    <div class="line"><span class="muted">Average order value (incl. delivery)</span><span>${usd(a.aov)} · ${Math.round(a.deliveryShareOfAov * 100)}% is delivery pass-through, so GMV = orders × AOV × ${1 - a.deliveryShareOfAov}</span></div>
    <div class="line"><span class="muted">VendiPort take rate</span><span>${Math.round(a.takeRate * 100)}% — ${esc(a.takeSource)}</span></div>
    <div class="line"><span class="muted">Members × price</span><span>${a.members} × $${a.membershipPrice} / mo</span></div>
    <div class="line"><span class="muted">Fill rate range</span><span>${a.fillRatePct[0]}–${a.fillRatePct[1]}% per store</span></div>
    <div class="line"><span class="muted">Same-day success · dispute rate</span><span>${a.sameDayPct}% · ${a.disputeRatePct}%</span></div>
    <div class="line"><span class="muted">Ramp</span><span>${a.ramp.map((r) => Math.round(r * 100) + '%').join(' → ')}</span></div>
    <p class="note">${esc(a.rampNote)} Weekly → monthly uses ${a.weeksPerMonth} weeks. Every figure below is computed from these inputs (take = GMV × rate; payout = GMV − take).</p></div>`;
}
function netStoresTable(limit) {
  const rows = NET.stores.slice(0, limit || 99).map((s) => [esc(s.name) + (s.standout ? ' <span class="tag gold">standout</span>' : ''), esc(s.neighborhood), s.zip, s.ordersWeek, usd(s.gmvWeek), usd(s.take), usd(s.payout), pct(s.fillRate)]);
  return table(['Store', 'Neighborhood', 'ZIP', 'Orders/wk', 'GMV/wk', 'Take', 'Payout', 'Fill'], rows, [3, 4, 5, 6, 7]);
}
const netHeat = () => NET.heat.map((z) => `<div class="barrow"><span><b>${esc(z.zip)}</b> <span class="note">${esc(z.hood)}</span></span>${bar(z.pct)}<span>${z.ordersWeek}/wk</span></div>`).join('');
const NETVIEWS = {
  dash(v) {
    const R = NET.rollup;
    v.innerHTML = NETBANNER + `<div class="kpis">${kpi(R.ordersPerDay, 'Orders / day')}${kpi(usd(R.gmvWeek), 'GMV / week')}${kpi(usd(R.gmvMonth), 'GMV / month')}${kpi(usd(R.revenueMonth), 'VendiPort revenue / mo')}${kpi(usd(R.aov), 'Avg order value')}${kpi(pct(R.sameDayPct), 'Same-day success')}${kpi(pct(R.disputeRatePct), 'Dispute rate')}${kpi(R.topMultiple + '×', 'Top store vs median')}</div>
      <div class="grid2"><div class="card sec"><h2>Demand heat map by ZIP ${DEMO}</h2>${netHeat()}</div>${netAssumptions()}</div>`;
  },
  demand(v) {
    v.innerHTML = NETBANNER + `<div class="grid2"><div class="card sec"><h2>Demand heat map by ZIP ${DEMO}</h2>${netHeat()}<p class="note">Orders per week by store ZIP; bar = share of the busiest ZIP.</p></div>
      <div class="card sec"><h2>Busiest neighborhoods</h2>${table(['ZIP', 'Area', 'Stores', 'Orders/wk'], NET.heat.slice(0, 8).map((z) => [z.zip, esc(z.hood), z.stores, z.ordersWeek]), [2, 3])}</div></div>` + netAssumptions();
  },
  sales(v) {
    const R = NET.rollup, a = NET.assumptions;
    v.innerHTML = NETBANNER + `<div class="kpis">${kpi(usd(R.gmvWeek), 'GMV / week')}${kpi(usd(R.gmvMonth), 'GMV / month')}${kpi(usd(R.takeMonth), 'Take (' + Math.round(a.takeRate * 100) + '%) / mo')}${kpi(usd(R.membershipMonth), 'Memberships / mo (' + a.members + ')')}${kpi(usd(R.revenueMonth), 'VendiPort revenue / mo', 'gold')}${kpi(usd(R.payoutWeek), 'Shop payouts / week')}</div>
      <div class="card sec"><h2>Per-store ${DEMO}</h2>${netStoresTable()}</div>` + netAssumptions();
  },
  stores(v) {
    const R = NET.rollup;
    v.innerHTML = NETBANNER + `<div class="kpis">${kpi(NET.stores.length, 'Stores')}${kpi(R.medianOrdersWeek, 'Median orders / wk')}${kpi(R.topOrdersWeek, 'Top store orders / wk')}${kpi(pct(R.fillRatePct), 'Avg fill rate')}</div>
      <div class="card sec"><h2>20 seeded stores ${DEMO}</h2>${netStoresTable()}</div>` + netAssumptions();
  },
};

const VIEWS = {
  async dash(v) {
    const d = OV.dashboard;
    v.innerHTML = `
      <div class="kpis">
        ${kpi(d.ordersToday, 'Orders today')}
        ${kpi(d.lateOrders, 'Late orders', d.lateOrders ? 'warn' : '')}
        ${kpi(d.refundRatePct + '%', 'Refund rate (' + d.refunded + '/' + d.ordersTotal + ')', d.refundRatePct > 10 ? 'warn' : '')}
        ${kpi(d.awaitingVerification, 'Shops awaiting verification', d.awaitingVerification ? 'gold' : '')}
        ${kpi(d.openDisputes, 'Open disputes', d.openDisputes ? 'warn' : '')}
        ${kpi(d.pendingMarketing, 'Breaks awaiting marketing OK', d.pendingMarketing ? 'gold' : '')}
      </div>
      <div class="grid2">
        <div class="card"><div class="step-label">Late orders ${REAL}</div>${d.lateList.length ? table(['Order', 'Window', 'Status'], d.lateList.map((l) => ['#' + l.last4 + ' ' + esc(l.title), esc(l.window), `<span class="tag red">${esc(l.status)}</span>`])) : '<p class="note">None — nice.</p>'}</div>
        <div class="card"><div class="step-label">Jump to</div>
          <div class="qrow"><button class="vp-btn sm" data-go="disputes">Dispute queue</button><button class="vp-btn sm" data-go="verify">Approve shops</button><button class="vp-btn sm purple" data-go="content">Content queue</button><button class="vp-btn sm ghost" data-go="demand">Demand</button></div>
          <p class="note" style="margin-top:10px">Numbers tagged ${REAL} come from live JSON state. ${DEMO} numbers are seeded sample data so the dashboard looks alive for demos.</p></div>
      </div>`;
    v.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { TAB = b.dataset.go; paintTabs(); paint(); }));
  },

  async demand(v) {
    const D = OV.demand;
    v.innerHTML = `
      <div class="kpis">${kpi(D.totalRadarEntries, 'Radar entries (anonymous)')}${kpi(D.top.length ? D.top[0].buyers : 0, 'Top item buyers')}${kpi(D.recruit.length, 'ZIPs to recruit a shop', D.recruit.length ? 'gold' : '')}${kpi(D.conversion.demoRatePct + '%', 'Radar→order ' + 'conversion')}</div>
      <div class="grid2">
        <div class="card sec"><h2>Top wanted + growth</h2>${table(['Item', 'Buyers', '7d', 'Growth'], D.top.map((t) => [esc(t.label) + (t.demo ? ' ' + DEMO : ''), t.buyers, '+' + t.growth7d, t.growthPct > 0 ? `<span style="color:#7fe6dc">▲${t.growthPct}%</span>` : '—']), [1, 2, 3])}</div>
        <div class="card sec"><h2>Demand by ZIP vs active stores</h2>${table(['ZIP', 'Buyers', 'Stores', 'Area'], D.byZip.map((z) => [z.zip, z.buyers, z.activeStores ? z.activeStores : '<span class="tag red">0</span>', z.inServiceArea ? '<span class="tag teal">service</span>' : '<span class="tag gray">out</span>']), [1, 2])}</div>
      </div>
      <div class="grid2">
        <div class="card sec"><h2>Unfilled demand — recruit a shop here</h2>${D.recruit.length ? D.recruit.map((z) => `<div class="barrow"><b>${esc(z.zip)}</b>${bar(z.buyers * 8)}<span>${z.buyers} buyers</span></div>`).join('') : '<p class="note">Every high-demand ZIP has an active store.</p>'}<p class="note">${DEMO} ZIP demand is seeded; real follows add to it.</p></div>
        <div class="card sec"><h2>Radar → order conversion</h2>
          <div class="line"><span class="muted">Real radar followers who ordered ${REAL}</span><span>${D.conversion.realConverted}/${D.conversion.realRadarBuyers}</span></div>
          <div class="line"><span class="muted">Alerts sent ${DEMO}</span><span>${D.conversion.demoRadarAlertsSent}</span></div>
          <div class="line"><span class="muted">Led to an order ${DEMO}</span><span>${D.conversion.demoConverted} (${D.conversion.demoRatePct}%)</span></div>
          <div class="line"><span class="muted">Alerts queued (live) ${REAL}</span><span>${D.realAlertsQueued}</span></div>
          <h2 style="margin-top:12px">Zero-result searches</h2>${table(['Search', 'Count', ''], D.zeroSearches.map((z) => [esc(z.q), z.n, z.demo ? DEMO : REAL]), [1])}</div>
      </div>`;
  },

  async sales(v) {
    const S = OV.sales, R = S.real, M = S.demo;
    const wow = M.prevWeekRevenue ? Math.round(((M.weekRevenue - M.prevWeekRevenue) / M.prevWeekRevenue) * 100) : 0;
    const max = Math.max(1, ...M.daily.map((d) => d.revenue));
    v.innerHTML = `
      <div class="kpis">${kpi(R.orders, 'Orders (live)')}${kpi(usd(R.revenue), 'Revenue (live)')}${kpi(usd(R.avgOrder), 'Avg order (live)')}${kpi(R.takeRatePct + '%', 'Take rate · ' + usd(R.platformTake))}</div>
      <div class="grid2">
        <div class="card sec"><h2>Revenue per day ${DEMO} last 14d</h2>${M.daily.slice(-7).map((d) => `<div class="barrow"><span>${esc(d.day.slice(5))}</span>${bar((d.revenue / max) * 100)}<span>${usd(d.revenue)}</span></div>`).join('')}
          <div class="line"><span class="muted">Week</span><span>${M.weekOrders} orders · ${usd(M.weekRevenue)} <span style="color:${wow >= 0 ? '#7fe6dc' : '#ff8a8a'}">${wow >= 0 ? '▲' : '▼'}${Math.abs(wow)}%</span></span></div>
          <div class="line"><span class="muted">Avg order</span><span>${usd(M.avgOrder)}</span></div></div>
        <div class="card sec"><h2>Live revenue per day ${REAL}</h2>${table(['Day', 'Orders', 'Revenue'], R.daily.map((d) => [d.day, d.orders, usd(d.revenue)]), [1, 2])}</div>
      </div>
      <div class="grid2">
        <div class="card sec"><h2>Membership ${DEMO}</h2>
          <div class="line"><span class="muted">New members</span><span>${M.membership.newMembers}</span></div><div class="line"><span class="muted">Active</span><span>${M.membership.active}</span></div>
          <div class="line"><span class="muted">Canceled</span><span>${M.membership.canceled}</span></div>
          <div class="line"><span class="muted">Free month → paid</span><span>${M.membership.freeMonthConverted}/${M.membership.freeMonthStarted} (${M.freeMonthConversionPct}%)</span></div>
          <h2 style="margin-top:12px">Referrals ${DEMO}</h2>
          <div class="line"><span class="muted">Signups</span><span>${M.referrals.signups}</span></div><div class="line"><span class="muted">First purchase</span><span>${M.referrals.firstPurchase} (${M.referralConversionPct}%)</span></div></div>
        <div class="card sec"><h2>Payouts owed</h2>
          ${table(['Store', 'Owed', ''], S.realPayoutsOwed.map((p) => [esc(p.shop), usd(p.owed), REAL]).concat(M.payoutsOwed.map(([n, a]) => [esc(n), usd(a), DEMO])), [1])}
          <h2 style="margin-top:12px">Payout adjustments (claims charged to shop)</h2>
          ${table(['Store', 'Order', 'Adjustment', ''], (S.payoutAdjustments || []).map((a) => [esc(a.shopName || a.shopId), '#' + esc(a.last4 || ''), usd(a.amount), a.demo ? DEMO : REAL]), [2])}
          <h2 style="margin-top:12px">Refunds</h2>
          <div class="line"><span class="muted">Live ${REAL}</span><span>${S.realRefunds.count} · ${usd(S.realRefunds.amount)}</span></div>
          <div class="line"><span class="muted">Demo ${DEMO}</span><span>${M.refunds.count} of ${M.refunds.orders} · ${usd(M.refunds.amount)}</span></div></div>
      </div>`;
  },

  async ful(v) {
    const R = OV.fulfillment.real, M = OV.fulfillment.demo;
    v.innerHTML = `
      <div class="kpis">${kpi(dash(R.paidToPackedMins, 'm'), 'Paid → packed (live)')}${kpi(dash(R.paidToReadyMins, 'm'), 'Paid → ready (live)')}${kpi(dash(R.paidToDeliveredMins, 'm'), 'Paid → delivered (live)')}${kpi(R.lateNow, 'Late now', R.lateNow ? 'warn' : '')}</div>
      <p class="note">Live timings use real order timelines (${R.sampleSize} order${R.sampleSize === 1 ? '' : 's'} so far). Demo averages: packed ${M.paidToPackedMins}m · ready ${M.paidToReadyMins}m · delivered ${M.paidToDeliveredMins}m ${DEMO}</p>
      <div class="grid2">
        <div class="card sec"><h2>Late orders by store</h2>${table(['Store', 'Late', ''], R.lateByStore.map(([n, c]) => [esc(n), c, REAL]).concat((M.ordersLate || []).map(([n, c]) => [esc(n), c, DEMO])), [1])}</div>
        <div class="card sec"><h2>Cancel / refund rate</h2><div class="line"><span class="muted">Cancel rate ${REAL}</span><span>${R.cancelRatePct}%</span></div><div class="line"><span class="muted">Refund rate ${REAL}</span><span>${R.refundRatePct}%</span></div>
          <h2 style="margin-top:12px">Reasons</h2>${table(['Reason', 'Count', ''], R.cancelReasons.map(([n, c]) => [esc(n), c, REAL]).concat(M.cancelReasons.map(([n, c]) => [esc(n), c, DEMO])), [1])}</div>
      </div>
      <div class="card sec"><h2>Delivery-service calls ${REAL}</h2>
        <p class="note">Photo 2 (sealed bag) marks the order READY and automatically requests a courier — simulated, no real courier API. Own-driver shops skip this and are notified instead (${OV.fulfillment.dispatches.ownDriverNotices} notice(s)).</p>
        ${table(['Order', 'Store', 'Driver', 'Status', 'Requested'], OV.fulfillment.dispatches.list.map((d) => ['#' + esc(d.last4), esc(d.shopName || ''), esc(d.driverId || '—'), `<span class="tag teal">${esc(String(d.status).replace('_', ' '))}</span>`, esc(fmt(d.at))]))}</div>
      <div class="card sec"><h2>Failed / refused handoffs</h2><div class="line"><span class="muted">Refused at door — live ${REAL}</span><span>${R.refused}</span></div><div class="line"><span class="muted">Failed handoffs ${DEMO}</span><span>${M.handoffFailed}</span></div><div class="line"><span class="muted">Refused (seal/QR) ${DEMO}</span><span>${M.handoffRefused}</span></div></div>`;
  },

  async trust(v) {
    const T = OV.trust;
    v.innerHTML = `
      <div class="kpis">${kpi(T.openDisputes, 'Active claims', T.openDisputes ? 'warn' : '')}${kpi(OV.dashboard.awaitingVerification, 'Shops awaiting verification', 'gold')}${kpi(T.held, 'Buyers on refund hold', T.held ? 'warn' : '')}</div>
      <div class="grid2">
        <div class="card sec"><h2>Seal-not-intact reports by store</h2>${table(['Store', 'Reports', ''], T.real.sealByStore.map(([n, c]) => [esc(n), c, REAL]).concat((T.demo.sealNotIntact || []).map(([n, c]) => [esc(n), c, DEMO])), [1])}</div>
        <div class="card sec"><h2>Ratings by store / delivery</h2>${table(['Store', 'Shop', 'Delivery', 'n', ''], T.real.ratings.map((r) => [esc(r.store), '★' + r.shop, '★' + r.delivery, r.n, REAL]).concat(T.demo.ratings.map((r) => [esc(r.store), '★' + r.shop, '★' + r.delivery, r.n, DEMO])), [1, 2, 3])}</div>
      </div>
      ${patternCards(T)}
      <div class="card sec"><h2>Resolution log</h2>${table(['When', 'Claim', 'Store', 'Outcome', 'Fault', 'Amount', 'By', ''], (T.log || []).map((l) => [esc(fmt(l.at)), '#' + esc(l.last4), esc(l.shopName || ''), esc(l.outcome || ''), esc(l.fault || '—'), l.amount ? usd(l.amount) : '—', esc(l.by || ''), l.demo ? DEMO : REAL]), [5])}</div>
      <div class="qrow"><button class="vp-btn" data-go="disputes">Open dispute queue</button><button class="vp-btn ghost" data-go="verify">Shop approvals</button></div>`;
    v.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { TAB = b.dataset.go; paintTabs(); paint(); }));
  },

  async stores(v) {
    const S = OV.stores;
    const st = { active: 'teal', paused: 'gray', sold_out: 'red' };
    v.innerHTML = `
      <div class="kpis">${kpi(S.counts.active, 'Active stores')}${kpi(S.counts.paused, 'Paused')}${kpi(S.counts.soldOut, 'Sold out')}${kpi(S.inventory.lowStock, 'Low-stock SKUs (live)', S.inventory.lowStock ? 'gold' : '')}${kpi(S.iHaveUsage.real + S.iHaveUsage.demo, '“I have this” uses')}</div>
      <div class="card sec"><h2>Stores</h2>${table(['Store', 'ZIP', 'Status', 'SKUs', 'Units', 'Low', '“I have”', 'Verify', ''], S.list.map((s) => [esc(s.name), esc(s.zip), `<span class="tag ${st[s.status] || 'gray'}">${esc(s.status.replace('_', ' '))}</span>`, s.skus, s.units, s.lowStockSkus, s.iHaveCount, esc(s.verification), s.demo ? DEMO : REAL]), [3, 4, 5, 6])}</div>
      <div class="card sec"><h2>Payout adjustments by store</h2>${table(['Store', 'Charged claims', 'Total', ''], (OV.sales.adjustmentsByShop || []).map((a) => [esc(a.shopName), a.count, usd(a.total), a.demo ? DEMO : REAL]), [1, 2])}<p class="note">Claims charged to a shop (“Charge to shop”) are deducted from that shop’s payout and show on its Earnings tab.</p></div>
      <div class="grid2">
        <div class="card sec"><h2>Inventory health ${REAL}</h2><div class="line"><span class="muted">SKUs live</span><span>${S.inventory.skusLive}</span></div><div class="line"><span class="muted">Units on machine</span><span>${S.inventory.units}</span></div><div class="line"><span class="muted">Low-stock SKUs</span><span>${S.inventory.lowStock}</span></div><div class="line"><span class="muted">Sold-out SKUs (auto-hidden)</span><span>${S.inventory.soldOutSkus}</span></div></div>
        <div class="card sec"><h2>Fastest Wanted responders</h2>${table(['Store', 'Median reply', ''], S.fastest.real.map((f) => [esc(f.store), dash(f.mins, ' min'), REAL]).concat(S.fastest.demo.map((f) => [esc(f.store), f.mins + ' min', DEMO])), [1])}</div>
      </div>`;
  },

  async health(v) {
    const R = OV.product.real, M = OV.product.demo;
    const fun = (f, tag) => { const top = Math.max(1, f.browse); return ['browse', 'select', 'checkout', 'paid'].map((k, i, a) => `<div class="barrow"><span style="text-transform:capitalize">${k}</span>${bar((f[k] / top) * 100)}<span>${f[k]}${i ? ' · ' + (a[i - 1] && f[a[i - 1]] ? Math.round((f[k] / f[a[i - 1]]) * 100) : 0) + '%' : ''}</span></div>`).join(''); };
    v.innerHTML = `
      <div class="grid2">
        <div class="card sec"><h2>Funnel — Browse › Select › Checkout › Paid ${REAL}</h2>${fun(R.funnel)}<p class="note">Counts since the last reset; % is step-to-step.</p></div>
        <div class="card sec"><h2>Funnel ${DEMO}</h2>${fun(M.funnel)}</div>
      </div>
      <div class="grid2">
        <div class="card sec"><h2>Out-of-area visitors</h2><div class="line"><span class="muted">Live ${REAL}</span><span>${R.outOfAreaVisitors}</span></div><div class="line"><span class="muted">Demo ${DEMO}</span><span>${M.outOfArea.visitors}</span></div>
          ${table(['ZIP', 'Visitors', ''], R.outOfAreaByZip.map(([z, c]) => [z, c, REAL]).concat(M.outOfArea.byZip.map(([z, c]) => [z, c, DEMO])), [1])}</div>
        <div class="card sec"><h2>Errors</h2><div class="line"><span class="muted">Live ${REAL}</span><span>${R.errorTotal}</span></div><div class="line"><span class="muted">Demo ${DEMO}</span><span>${M.errors.total}</span></div>
          ${table(['Error', 'Count', ''], R.errors.map(([n, c]) => [esc(n), c, REAL]).concat(M.errors.byType.map(([n, c]) => [esc(n), c, DEMO])), [1])}</div>
      </div>`;
  },

  async disputes(v) {
    const { disputes } = await A('/api/admin/disputes');
    const act = disputes.filter((d) => d.canAct);
    const FAULT = [['shop', 'Shop'], ['delivery', 'Delivery'], ['buyer', 'Buyer'], ['unclear', 'Unclear']];
    const REC = { refund: 'teal', proof: 'gold', deny: 'gray', close: 'teal' };
    const tone = { good: '#7fe6dc', warn: '#ffd84a', bad: '#ff8a8a' };
    const cmp = (d) => {
      const e = d.evidence || {}; const ph = (x, label, sub) => `<figure>${x && x.photo ? `<a href="${esc(x.photo)}" target="_blank" rel="noopener"><img src="${esc(x.photo)}" alt="${esc(label)}" /></a>` : `<div class="ph-none">${x && x.stub ? 'stub photo' : 'no photo'}</div>`}<figcaption><b>${esc(label)}</b><br>${esc(sub)}${x && x.at ? '<br>' + esc(fmt(x.at)) : ''}</figcaption></figure>`;
      const door = e.door || {}; const doorP = door.reportPhoto || door.photo;
      return `<div class="cmp">${ph(e.before, '1 · Before sealing', 'product on the bag QR')}${ph(e.after, '2 · Sealed bag', 'QR-in-V + seal strip')}${ph(doorP ? { photo: doorP, at: door.qrScannedAt || door.proofAt } : null, '3 · At the door', 'buyer / handoff photo')}</div>
        <p class="note" style="margin:4px 0">QR chain: ${d.qrChain && d.qrChain.shopQrMatch ? '<span class="tag teal">Photo 1 = Photo 2</span>' : '<span class="tag red">shop QRs differ / missing</span>'} ${door.qrMatched ? '<span class="tag teal">door scan matched</span>' : '<span class="tag gray">no door scan</span>'}${door.qrScanPhoto ? ` · <a href="${esc(door.qrScanPhoto)}" target="_blank" rel="noopener">door QR scan photo ↗</a>` : ''}</p>`;
    };
    const hist = (h) => `<div class="grid3">
      <div class="mini"><b>Buyer</b> ${h.buyer.repeat ? '<span class="tag red">repeat claimant</span>' : ''}${h.buyer.hold ? ' <span class="tag red">refund hold</span>' : ''}<br>${h.buyer.d30} claim(s) / 30 days · ${h.buyer.total} total${h.buyer.strikes ? ' · <b>' + h.buyer.strikes + ' strike(s)</b>' : ''}</div>
      <div class="mini"><b>Store</b> ${esc(h.shop.name || '')} ${h.shop.repeat ? '<span class="tag red">repeat store</span>' : ''}<br>${h.shop.d30} claim(s) / 30 days · ${h.shop.total} total</div>
      <div class="mini"><b>Driver</b> ${esc(h.driver.label)} ${h.driver.repeat ? '<span class="tag red">repeat driver</span>' : ''}<br>${h.driver.d30} claim(s) / 30 days · ${h.driver.faults} at fault</div></div>`;
    const logT = (d) => (d.log || []).length ? `<div class="resl"><b>Resolution log</b>${d.log.map((l) => `<div>${esc(fmt(l.at))} · ${esc(l.by)} · <b>${esc(l.outcome)}</b>${l.fault ? ' · fault: ' + esc(l.fault) : ''}${l.amount ? ' · ' + usd(l.amount) : ''}${l.charged ? ' · charged shop ' + usd(l.charged) : ''}${l.absorbed ? ' · absorbed ' + usd(l.absorbed) : ''}${l.strikes ? ' · buyer strikes ' + l.strikes : ''}${l.note ? ' · “' + esc(l.note) + '”' : ''}</div>`).join('')}</div>` : '';
    v.innerHTML = `<div class="kpis">${kpi(act.length, 'Active claims', act.length ? 'warn' : '')}${kpi(disputes.filter((d) => d.status === 'awaiting_proof').length, 'Awaiting proof', 'gold')}${kpi(disputes.filter((d) => d.status === 'denied').length, 'Claim denied')}${kpi(disputes.filter((d) => d.status === 'resolved').length, 'Resolved')}</div>
      <p class="note" style="margin-bottom:10px">Compare the three photos, check the timeline hints and claim history, then act. The recommendation is a suggestion — the decision is yours.</p>` +
      (disputes.map((d) => `
      <div class="card sec" data-id="${esc(d.id)}">
        <div class="row-between"><div><strong>#${esc(d.last4)}</strong> ${esc(d.productTitle || '')} <span class="tag ${d.status === 'open' ? 'red' : d.status === 'awaiting_proof' ? 'gold' : d.status === 'denied' ? 'gray' : 'teal'}">${esc(d.statusLabel)}</span> ${d.demo ? DEMO : REAL} ${d.channel === 'claim_after_accept' ? '<span class="tag gray">after acceptance</span>' : '<span class="tag teal">refused at door</span>'}</div><span class="mono">${esc(d.shopName || '')} · ${usd(d.total)}</span></div>
        <p class="note" style="margin:6px 0">Opened ${esc(fmt(d.openedAt))}${d.note ? ' — “' + esc(d.note) + '”' : ''}${d.refund ? ` · <b>refunded ${usd(d.refund.amount)} at the door</b>` : ''}</p>
        ${cmp(d)}
        ${d.canAct ? `<div class="rec"><span class="tag ${REC[d.recommendation.action]}">Recommended</span> <b>${esc(d.recommendation.label)}</b><div class="note">${esc(d.recommendation.reason)}</div></div>` : ''}
        <div class="hints">${d.hints.map((h) => `<div style="color:${tone[h.tone]}">${h.tone === 'good' ? '✓' : h.tone === 'bad' ? '✗' : '•'} ${esc(h.text)}</div>`).join('')}</div>
        <div class="tl">${(d.timeline || []).map((t) => `<span><b>${esc(t.label)}</b> ${esc(fmt(t.at))}</span>`).join('')}</div>
        ${hist(d.history)}
        ${(d.buyerProof || []).length ? `<div class="mini"><b>Buyer’s extra proof</b>${d.buyerProof.map((p) => `<div>${esc(fmt(p.at))} — ${esc(p.note || 'photo')}${p.photo ? ` · <a href="${esc(p.photo)}" target="_blank" rel="noopener">photo ↗</a>` : ''}</div>`).join('')}</div>` : ''}
        ${d.status === 'awaiting_proof' ? `<p class="note">⏳ Proof requested ${esc(fmt(d.proofRequestedAt))} — deadline ${esc(fmt(d.proofDeadline))}.</p>` : ''}
        ${d.denial ? `<div class="mini"><b>Message sent to buyer</b><div class="note" style="color:#cfd6e2">${esc(d.denial.message)}${d.denial.note ? '<br><br>Additional note: ' + esc(d.denial.note) : ''}</div></div>` : ''}
        ${d.canAct ? `<div class="act">
          <div class="row-between"><label class="note">Fault</label><div class="seg" data-fault>${FAULT.map(([k, l]) => `<button type="button" data-f="${k}" class="${k === 'unclear' ? 'on' : ''}">${l}</button>`).join('')}</div></div>
          <p class="note fnote" style="margin:4px 0">Unclear — no consequence recorded.</p>
          <label class="vp-check" data-chargewrap style="display:none"><input type="checkbox" data-charge /> <span>Charge to shop — deduct ${usd(d.productPrice || d.total)} from this shop’s payout</span></label>
          <input class="vp-input" data-note placeholder="Optional note (added to the buyer message / log)" maxlength="300" style="margin-top:6px" />
          <div class="qrow">
            ${d.refund ? `<button class="vp-btn sm" data-o="close">Close — refund stands</button>` : `<button class="vp-btn sm" data-o="refund">Refund buyer (no return)</button>`}
            <button class="vp-btn sm ghost" data-o="replace">Replace box</button>
            ${d.status === 'awaiting_proof' ? '' : '<button class="vp-btn sm ghost" data-o="proof">Request more proof (24h)</button>'}
            ${d.refund ? '' : '<button class="vp-btn sm red" data-o="deny">Deny claim</button>'}
          </div></div>` : ''}
        ${logT(d)}
      </div>`).join('') || '<div class="empty">No claims.</div>');
    const FN = { shop: 'Shop fault — you can charge the order amount to the shop’s payout.', delivery: 'Delivery fault — absorbed by VendiPort and logged against the driver.', buyer: 'Buyer fraud — adds a strike; refunds auto-hold for review after 2 claims in 30 days.', unclear: 'Unclear — no consequence recorded.' };
    v.querySelectorAll('.card[data-id]').forEach((c) => {
      let fault = 'unclear';
      const seg = c.querySelector('[data-fault]');
      if (seg) seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        fault = b.dataset.f; seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        c.querySelector('.fnote').textContent = FN[fault]; c.querySelector('[data-chargewrap]').style.display = fault === 'shop' ? 'flex' : 'none';
      }));
      c.querySelectorAll('[data-o]').forEach((b) => b.addEventListener('click', async () => {
        const o = b.dataset.o; const note = c.querySelector('[data-note]').value.trim();
        const body = { action: o, fault, note, chargeShop: fault === 'shop' && c.querySelector('[data-charge]').checked };
        try {
          let r;
          try { r = await A(`/api/admin/disputes/${c.dataset.id}/act`, { method: 'POST', body: JSON.stringify(body) }); }
          catch (e) { if (e.status === 409 && /held for review/.test(e.message) && confirm(e.message + '\n\nRelease the hold and continue?')) r = await A(`/api/admin/disputes/${c.dataset.id}/act`, { method: 'POST', body: JSON.stringify(Object.assign({ overrideHold: true }, body)) }); else throw e; }
          toast({ refund: 'Refunded — logged', replace: 'Replacement queued — logged', proof: 'Proof requested — buyer notified', deny: 'Claim denied — buyer notified', close: 'Closed — logged' }[o]); await refresh();
        } catch (e) { toast(e.message); }
      }));
    });
  },

  async verify(v) {
    const { verification } = await A('/api/admin/verification');
    v.innerHTML = `<p class="note">Business ID verification — review the seller permit / EIN before a shop can go live.</p>` + (verification.map((s) => `
      <div class="card sec" data-id="${esc(s.id)}">
        <div class="row-between"><div><strong>${esc(s.name)}</strong> <span class="tag ${s.status === 'pending' ? 'red' : s.status === 'approved' ? 'teal' : 'gray'}">${esc(s.status)}</span> ${s.demo ? DEMO : REAL}</div><span class="mono">${esc(fmt(s.submittedAt))}</span></div>
        <div class="line"><span class="muted">Owner</span><span>${esc(s.owner)}</span></div>
        <div class="line"><span class="muted">Business ID</span><span class="mono" style="color:#e8f7f5">${esc(s.bizId)}</span></div>
        <div class="line"><span class="muted">ZIP</span><span>${esc(s.zip)}</span></div>
        <div class="line"><span class="muted">Documents</span><span>${(s.docs || []).map(esc).join(' · ')}</span></div>
        ${s.status === 'pending' ? `<div class="qrow"><button class="vp-btn sm" data-a="approve">Approve</button><button class="vp-btn sm red" data-a="reject">Reject</button></div>` : ''}
      </div>`).join('') || '<div class="empty">Nothing to review.</div>');
    v.querySelectorAll('.card[data-id]').forEach((c) => c.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', async () => {
      try { await A(`/api/admin/verification/${c.dataset.id}/${b.dataset.a}`, { method: 'POST', body: '{}' }); toast(b.dataset.a === 'approve' ? 'Shop approved' : 'Shop rejected'); await refresh(); } catch (e) { toast(e.message); }
    })));
  },

  async content(v) {
    const { breaks, top } = await A('/api/admin/breaks');
    const q = breaks.filter((b) => b.consentMarketing);
    const embedLink = (b) => (b.platform ? `<a href="${esc(b.platform.url)}" target="_blank" rel="noopener">${esc(b.platform.label)} link ↗</a>` : '<span class="note">photos only</span>');
    v.innerHTML = `
      <div class="kpis">${kpi(q.filter((b) => b.marketingStatus === 'pending').length, 'Awaiting your OK', 'gold')}${kpi(q.filter((b) => b.marketingStatus === 'approved').length, 'Approved for marketing')}${kpi(breaks.length, 'All uploads')}</div>
      <div class="card sec"><h2>Top-performing breaks</h2>${table(['Break', 'Platform', 'Views', 'Shares', 'Score'], top.map((t) => [esc(t.boxTitle), esc(t.platform || 'photos'), t.views, t.shares, t.score]), [2, 3, 4])}</div>
      <div class="card sec"><h2>Marketing content queue <span class="note">(buyers who opted in)</span></h2>
      ${q.map((b) => `<div class="card" data-id="${esc(b.id)}" style="margin-bottom:8px">
        <div class="row-between"><div><strong>${esc(b.boxTitle)}</strong> <span class="tag ${b.marketingStatus === 'approved' ? 'teal' : b.marketingStatus === 'rejected' ? 'gray' : 'red'}">${esc(b.marketingStatus)}</span> ${b.demo ? DEMO : ''}</div><span class="mono">${b.views} views · ${b.shares} shares</span></div>
        <p class="note" style="margin:5px 0">${b.platform ? `<span class="vp-plat" style="color:${esc(b.platform.color)}"><i>${esc(b.platform.icon)}</i>${esc(b.platform.label)}</span> · ` : ''}${embedLink(b)} · ${esc(b.visibility)}${b.caption ? ' · “' + esc(b.caption) + '”' : ''}</p>
        ${(b.hitsPulled || []).length ? `<div class="vp-hits">${b.hitsPulled.map((h) => `<span class="vp-chip gold">◎ ${esc(h.name)}</span>`).join('')}</div>` : ''}
        <div class="qrow"><button class="vp-btn sm" data-a="approve">Approve</button><button class="vp-btn sm ghost" data-a="reject">Reject</button><button class="vp-btn sm purple" data-dl="1">Download package</button><button class="vp-btn sm ghost" data-a="hide">Hide</button></div>
      </div>`).join('') || '<p class="note">No opted-in breaks yet.</p>'}</div>
      <div class="card sec"><h2>Moderation — all uploads</h2>${table(['Box', 'Platform', 'Vis.', 'Marketing', 'Moderation', ''], breaks.map((b) => [esc(b.boxTitle), esc(b.platform ? b.platform.label : 'photos'), esc(b.visibility), b.consentMarketing ? esc(b.marketingStatus) : '—', esc(b.moderation), `<button class="vp-btn sm ghost" data-mod="${esc(b.id)}|${b.moderation === 'hidden' ? 'show' : 'hide'}">${b.moderation === 'hidden' ? 'Unhide' : 'Hide'}</button>`]))}</div>`;
    v.querySelectorAll('.card[data-id]').forEach((c) => {
      c.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', async () => {
        try {
          if (b.dataset.a === 'hide') await A(`/api/admin/breaks/${c.dataset.id}/moderate`, { method: 'POST', body: JSON.stringify({ action: 'hide' }) });
          else await A(`/api/admin/breaks/${c.dataset.id}/marketing`, { method: 'POST', body: JSON.stringify({ action: b.dataset.a }) });
          toast('Updated'); await refresh();
        } catch (e) { toast(e.message); }
      }));
      c.querySelector('[data-dl]').addEventListener('click', async () => {
        try { const r = await fetch(`/api/admin/breaks/${c.dataset.id}/download`, { headers: { 'x-admin-passcode': PASS } }); const blob = await r.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `vendiport-break-${c.dataset.id}.json`; a.click(); toast('Downloaded marketing package'); } catch (e) { toast(e.message); }
      });
    });
    v.querySelectorAll('[data-mod]').forEach((b) => b.addEventListener('click', async () => { const [id, act] = b.dataset.mod.split('|'); await A(`/api/admin/breaks/${id}/moderate`, { method: 'POST', body: JSON.stringify({ action: act }) }); toast('Updated'); await refresh(); }));
  },
};

document.addEventListener('DOMContentLoaded', () => {
  $('#pw-go').addEventListener('click', () => unlock($('#pw').value));
  $('#pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock($('#pw').value); });
  if (PASS) unlock(PASS);
});

})();
