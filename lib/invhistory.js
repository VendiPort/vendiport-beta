'use strict';
/* Inventory history (store-side + admin read-only). DEMO weekly snapshots seeded
   deterministically per SKU for Apr 19 - Oct 19 2026, with LIVE paid orders merged on top.
   Reference / demo only — not financial advice. */
const TRENDS = require('./trends');
const START = Date.parse('2026-04-19T00:00:00Z');
const END = Date.parse('2026-10-19T00:00:00Z');
const WEEK = 7 * 864e5;
const PERIODS = { '30d': { weeks: 5, label: 'Last 30 days', days: 30 }, '3m': { weeks: 13, label: 'Last 3 months', days: 91 }, '6m': { weeks: 27, label: 'Last 6 months', days: 183 } };
const LIVE_OK = new Set(['PAID', 'PACKING', 'PACKED', 'READY', 'SEALED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED_ACCEPTED']);
const LABEL = 'DEMO history (seeded) + LIVE orders merged · reference only, not financial advice';

function rng(seedStr) { let h = 2166136261; for (const c of seedStr) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; }; }
const units = (p) => (p.windows || []).reduce((s, w) => s + (Number(w.units) || 0), 0);
const r2 = (n) => Math.round(n * 100) / 100;

function profile(p, trend) {
  const t = String(p.title).toLowerCase();
  if (trend && trend.pctChange > 0 && trend.status !== 'presale') return { kind: 'rising', rate: 3.2 };
  if (trend && trend.pctChange < 0) return { kind: 'cooling', rate: 0.35 };
  if (/topps|bowman/.test(t)) return { kind: 'rising', rate: 2.6 };
  if (/pokemon|pokémon|panini/.test(t)) return { kind: 'cooling', rate: 0.3 };
  return { kind: 'steady', rate: 1.5 };
}

function skuHistory(p, orders) {
  const R = rng(p.id);
  const trend = TRENDS.trendForProduct(p);
  const prof = profile(p, trend);
  const now = units(p);
  const price = Number(p.price) || 0;
  const startPrice = r2(prof.kind === 'rising' ? price * 0.88 : prof.kind === 'cooling' ? price * 1.15 : price);
  const N = PERIODS['6m'].weeks;
  // Walk BACKWARD from the stock on the machine now so the history ends exactly at today.
  const rows = new Array(N);
  let end = now;
  for (let i = N - 1; i >= 0; i--) {
    const x = prof.rate * (0.5 + R());
    const sold = Math.floor(x) + (R() < x - Math.floor(x) ? 1 : 0);
    const cap = prof.kind === 'cooling' ? 18 : 9;
    let restock = 0;
    if (end > 0 && end + sold > cap) restock = Math.min(end, end + sold - (1 + Math.floor(R() * 3)));
    const start = end + sold - restock; // stock at start of week
    rows[i] = { stock: end, sold, restock, start };
    end = start;
  }
  const weeks = rows.map((r, i) => {
    const at = START + i * WEEK;
    const f = i / (N - 1);
    let market = null;
    if (trend && trend.currentPrice && trend.sameEdition && trend.status !== 'presale') {
      const rel = Date.parse(trend.releaseDate || '') || START;
      market = at < rel ? null : r2(trend.releasePrice + (trend.currentPrice - trend.releasePrice) * Math.min(1, (at - rel) / Math.max(WEEK, END - rel)));
    }
    return { weekOf: new Date(at).toISOString().slice(0, 10), openStock: r.start, stock: r.stock, sold: r.sold, restock: r.restock, liveSold: 0, shopPrice: i === N - 1 ? price : r2(startPrice + (price - startPrice) * f), marketPrice: market, source: 'DEMO' };
  });
  // merge LIVE paid orders into their week
  for (const o of orders) {
    if (o.productId !== p.id || !LIVE_OK.has(o.status)) continue;
    const t = Date.parse(o.paidAt || o.createdAt);
    if (!(t >= START && t < END + WEEK)) continue;
    const w = weeks[Math.min(weeks.length - 1, Math.floor((t - START) / WEEK))];
    w.sold += 1; w.liveSold += 1; w.source = 'DEMO+LIVE';
  }
  return { id: p.id, title: p.title, category: p.category, price, trend: trend ? { product: trend.product, pctChange: trend.pctChange, status: trend.status } : null, profile: prof.kind, weeks };
}

function summarize(sku, period) {
  const P = PERIODS[period] || PERIODS['6m'];
  const w = sku.weeks.slice(-P.weeks);
  const sold = w.reduce((s, x) => s + x.sold, 0);
  const liveSold = w.reduce((s, x) => s + x.liveSold, 0);
  const restocks = w.reduce((s, x) => s + x.restock, 0);
  const revenue = r2(w.reduce((s, x) => s + x.sold * x.shopPrice, 0));
  const current = w[w.length - 1].stock;
  const opening = w[0].openStock;
  const avail = opening + restocks;
  const sellThrough = avail ? Math.min(100, Math.round((sold / avail) * 100)) : 0;
  const avgStock = w.reduce((s, x) => s + (x.openStock + x.stock) / 2, 0) / w.length;
  const avgDaysToSell = sold ? Math.round(avgStock / (sold / P.days)) : null;
  let status, suggestion;
  if (current === 0) { status = 'Sold out'; suggestion = sold ? 'Restock — it sold through' : 'Delist or relist when you have stock'; }
  else if (avgDaysToSell != null && avgDaysToSell <= 21) { status = 'Fast mover'; suggestion = 'Restock — demand is outpacing stock'; }
  else if (avgDaysToSell != null && avgDaysToSell <= 60) { status = 'Steady'; suggestion = 'Hold — keep stock and price where they are'; }
  else { status = 'Slow'; suggestion = (avgDaysToSell == null || avgDaysToSell > 180) && sku.profile === 'cooling' ? 'Delist or move to a bundle — barely selling' : 'Discount toward market price to move units'; }
  const lastM = [...w].reverse().find((x) => x.marketPrice != null);
  return {
    id: sku.id, title: sku.title, category: sku.category, currentStock: current, unitsSold: sold, liveUnitsSold: liveSold, restocks, sellThroughPct: sellThrough,
    avgDaysToSell, revenue, priceStart: w[0].shopPrice, priceNow: w[w.length - 1].shopPrice, marketNow: lastM ? lastM.marketPrice : null, trend: sku.trend, profile: sku.profile,
    status, suggestion, source: liveSold ? 'DEMO+LIVE' : 'DEMO',
    spark: { stock: w.map((x) => x.stock), sold: w.map((x) => x.sold) }, weeks: w,
  };
}

function build(products, orders, period, shopId) {
  const pk = PERIODS[period] ? period : '6m';
  const items = products.filter((p) => !shopId || !p.shopId || p.shopId === shopId).map((p) => summarize(skuHistory(p, orders), pk));
  const by = (f) => items.slice().sort(f)[0] || null;
  const best = by((a, b) => b.unitsSold - a.unitsSold);
  const slow = by((a, b) => a.sellThroughPct - b.sellThroughPct || a.unitsSold - b.unitsSold);
  return {
    label: LABEL, period: pk, periodLabel: PERIODS[pk].label, range: { from: items[0] ? items[0].weeks[0].weekOf : null, to: '2026-10-19' },
    note: 'Weekly snapshots. DEMO history is seeded for the demo shop; LIVE paid orders are added on top and tagged. Last snapshot = stock on the machine now. Reference only — not financial advice.',
    totals: { unitsSold: items.reduce((s, i) => s + i.unitsSold, 0), liveUnitsSold: items.reduce((s, i) => s + i.liveUnitsSold, 0), revenue: r2(items.reduce((s, i) => s + i.revenue, 0)), bestSeller: best && { title: best.title, unitsSold: best.unitsSold }, slowest: slow && { title: slow.title, sellThroughPct: slow.sellThroughPct }, skus: items.length },
    items,
  };
}

module.exports = { build, PERIODS, LABEL };
