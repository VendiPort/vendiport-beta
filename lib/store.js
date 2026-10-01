'use strict';
// JSON-backed state for beta extras (radar, alerts, texts, breaks, disputes, events...).
const fs = require('fs');
const path = require('path');
const { seed } = require('./seed');

function createStore(getDataDir) {
  let cache = null;
  let cachedFor = null;
  const file = () => path.join(getDataDir(), 'extras.json');
  function save() {
    const dir = getDataDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = file() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2) + '\n');
    fs.renameSync(tmp, file());
  }
  function get() {
    if (cache && cachedFor === file()) return cache;
    cachedFor = file();
    try {
      cache = JSON.parse(fs.readFileSync(file(), 'utf8'));
    } catch (_) {
      cache = null;
    }
    if (!cache || typeof cache !== 'object') {
      cache = seed();
      save();
    }
    for (const k of ['radar', 'alerts', 'sms', 'iHave', 'breaks', 'disputes', 'ratings', 'events', 'searches', 'payoutsPaid']) {
      if (!Array.isArray(cache[k])) cache[k] = [];
    }
    for (const k of ['buyers', 'shopState', 'verification', 'demo']) if (!cache[k] || typeof cache[k] !== 'object') cache[k] = {};
    if (!Array.isArray(cache.demoStores)) cache.demoStores = [];
    return cache;
  }
  function reset() { cache = seed(); save(); return cache; }
  return { get, save, reset };
}

module.exports = { createStore };
