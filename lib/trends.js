'use strict';
/* Market trends reference (static seed, NOT live data). Store-side + admin only. */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'data', 'market-trends.json');
const STOP = new Set(['booster', 'box', 'hobby', 'blaster', 'the', 'and', 'pokemon', 'tcg']);
let cache = null;
const norm = (s) => String(s || '').toLowerCase().replace(/é/g, 'e').replace(/[^a-z0-9 ]+/g, ' ');
const keyTokens = (s) => norm(s).split(/\s+/).filter((t) => t && !/^\d{2,4}$/.test(t) && !STOP.has(t));

function suggestion(pct) {
  if (pct > 50) return { level: 'hot', dir: 'up', text: 'Hot: consider listing more / price closer to market' };
  if (pct > 0) return { level: 'mild', dir: 'up', text: 'Rising mildly: steady demand, keep pricing near market' };
  if (pct === 0) return { level: 'flat', dir: 'flat', text: 'Flat: no clear move' };
  return { level: 'cooling', dir: 'down', text: 'Cooling: consider pricing near market or listing less' };
}

function load() {
  if (cache) return cache;
  const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const items = raw.items.map((it) => Object.assign({}, it, { suggestion: it.status === 'presale' ? { level: 'presale', dir: 'flat', text: 'Presale — not released yet. No trend suggestion until it ships.' } : suggestion(it.pctChange), tokens: keyTokens(it.product) }))
    .sort((a, b) => String(a.releaseDate).localeCompare(String(b.releaseDate)));
  cache = Object.assign({}, raw, { items });
  return cache;
}

function publicTrends() {
  const t = load();
  return Object.assign({}, t, { items: t.items.map(({ tokens, ...rest }) => rest) });
}

/* Fuzzy match: every non-year key token of the trend product appears in the SKU title.
   Most specific (most tokens) wins, so "Topps Cosmic Chrome" never steals a plain "Topps Chrome" SKU. */
function matchTitle(title) {
  const have = new Set(keyTokens(title));
  if (!have.size) return null;
  let best = null;
  for (const it of load().items) {
    if (it.tokens.length >= 2 && it.tokens.every((tk) => have.has(tk)) && (!best || it.tokens.length > best.tokens.length)) best = it;
  }
  return best;
}

function trendForProduct(p) {
  const it = matchTitle(p.title);
  if (!it) return null;
  const vsMarket = it.currentPrice ? Math.round(((Number(p.price) - it.currentPrice) / it.currentPrice) * 100) : null;
  const yr = (String(p.title).match(/\b(19|20)\d{2}\b/) || [])[0];
  const tyr = (it.product.match(/\b(19|20)\d{2}\b/) || [])[0];
  return {
    product: it.product, pctChange: it.pctChange, currentPrice: it.currentPrice, releasePrice: it.releasePrice,
    status: it.status, statusLabel: it.statusLabel, suggestion: it.suggestion, vsMarketPct: vsMarket,
    sameEdition: !yr || !tyr || yr === tyr,
    note: 'Market reference (asking-price based, Oct 2026), not live data',
  };
}

module.exports = { load, publicTrends, matchTitle, trendForProduct, suggestion };
