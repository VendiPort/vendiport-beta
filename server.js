#!/usr/bin/env node
/**
 * VendiPort beta — single-process Node HTTP server (built-ins only).
 * Virtual vending machine for sealed trading cards + same-day tote delivery.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { URL } = require('url');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT, 'data');
const PORT = Number(process.env.PORT) || 3847;
const HOST = process.env.HOST || '0.0.0.0';
const DELIVERY_FEE = 10; // flat buyer-paid average courier fee (stub)
const MIN_ORDER = 25; // demo: placeholder prices under PRD $75 floor
const CANCEL_FEE_RATE = 0.15; // 15% of product
const PLATFORM_TAKE = 0.15;
const PLATFORM_WINDOWS = [
  { id: 'w_today_1400', label: 'Today 2-4pm' },
  { id: 'w_today_1600', label: 'Today 4-6pm' },
  { id: 'w_today_1800', label: 'Today 6-8pm' },
  { id: 'w_tmr_1000', label: 'Tomorrow 10am-12pm' },
];
const MONEY_COPY = {
  platformTake: '~15% platform take on product (shop keeps ~85%)',
  partnership: 'Shop partnership: $0 for first 3 months, then $50/mo or $30/mo annual',
  totes: 'Totes: first 10 free per shop, then at VendiPort cost with volume breaks',
  delivery: 'Buyer-paid flat delivery (avg courier pass-through). Own-driver ON: shop keeps transport fee.',
  minOrderPrd: 'PRD min order $75 for delivery; demo catalog may use lower placeholder prices (MIN_ORDER relaxed).',
};

const CANCELABLE = new Set(['DRAFT', 'PAID', 'PACKING', 'READY']);
const SHOP_VISIBLE = new Set(['PAID', 'PACKING', 'READY', 'PICKED_UP', 'DELIVERED_ACCEPTED']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function readJson(name, fallback) {
  const file = path.join(DATA, name);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error('readJson failed:', name, err.message);
    if (fallback !== undefined) return fallback;
    throw err;
  }
}

function writeJson(name, value) {
  ensureDataDir();
  const file = path.join(DATA, name);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function ensureDataDir() {
  if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });
  // Seed from bundled ./data if DATA_DIR is empty / fresh volume
  const bundled = path.join(ROOT, 'data');
  for (const name of ['products.json', 'shops.json', 'orders.json']) {
    const dest = path.join(DATA, name);
    if (fs.existsSync(dest)) continue;
    const src = path.join(bundled, name);
    if (fs.existsSync(src) && path.resolve(src) !== path.resolve(dest)) {
      fs.copyFileSync(src, dest);
    } else if (name === 'orders.json') {
      fs.writeFileSync(dest, '[]\n');
    }
  }
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  const base = {
    'Content-Type': typeof body === 'string' || Buffer.isBuffer(body)
      ? 'text/plain; charset=utf-8'
      : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  };
  res.writeHead(status, { ...base, ...headers });
  res.end(payload);
}

function sendError(res, status, message) {
  send(res, status, { error: message });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}


function saveOrderImage(subdir, orderId, dataUrlOrBase64) {
  if (!dataUrlOrBase64) return null;
  let raw = String(dataUrlOrBase64);
  let ext = '.jpg';
  const m = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i.exec(raw);
  let buf;
  if (m) {
    ext = m[1].toLowerCase() === 'png' ? '.png' : m[1].toLowerCase() === 'webp' ? '.webp' : '.jpg';
    buf = Buffer.from(m[2], 'base64');
  } else {
    buf = Buffer.from(raw.replace(/\s/g, ''), 'base64');
  }
  if (!buf.length || buf.length > 8 * 1024 * 1024) return null;
  const dir = path.join(PUBLIC, 'img', subdir);
  fs.mkdirSync(dir, { recursive: true });
  const fname = `${orderId}-${Date.now()}${ext}`;
  fs.writeFileSync(path.join(dir, fname), buf);
  return `/img/${subdir}/${fname}`;
}

function saveConfirmImage(orderId, dataUrlOrBase64) {
  return saveOrderImage('confirmations', orderId, dataUrlOrBase64);
}

function savePackImage(orderId, dataUrlOrBase64) {
  return saveOrderImage('pack', orderId, dataUrlOrBase64);
}

function last4(id) {
  const s = String(id || '');
  return s.slice(-4).toUpperCase();
}

function publicOrder(o) {
  return {
    id: o.id,
    last4: last4(o.id),
    status: o.status,
    productId: o.productId,
    productTitle: o.productTitle,
    productImage: o.productImage || null,
    productEmoji: o.productEmoji || null,
    productPrice: o.productPrice,
    deliveryFee: o.deliveryFee,
    total: o.total,
    windowId: o.windowId,
    windowLabel: o.windowLabel,
    membershipOptIn: o.membershipOptIn,
    cancelAllowed: CANCELABLE.has(o.status),
    cancelFeeRate: CANCEL_FEE_RATE,
    cancelFeeCopy:
      'Cancel until driver pickup: 15% of product (shop 7.5% / VendiPort 7.5%). Delivery fee refunded if not picked up. After pickup, cancel is closed — all sales final except seal / tote-bag QR refuse (full refund).',
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    pickedUpAt: o.pickedUpAt || null,
    acceptedAt: o.acceptedAt || null,
    refusedAt: o.refusedAt || null,
    cancelledAt: o.cancelledAt || null,
    cancelFee: o.cancelFee || null,
    handoffUrl: `/handoff/${o.id}`,
    toteQrPayload: o.toteQrPayload || `VENDIPORT:ORDER:${o.id}`,
    qrVerified: !!o.qrVerified,
    confirmImage: o.confirmImage || null,
    confirmedAt: o.confirmedAt || o.acceptedAt || null,
    matchedToteQr: o.matchedToteQr || o.qrScannedPayload || null,
    packPhotoStub: !!o.packPhotoStub,
    packPhoto: o.packPhoto || null,
    toteQrFromPackPhoto: !!o.toteQrFromPackPhoto,
    sealConfirmed: !!o.sealConfirmed,
    arrivePhotoStub: !!o.arrivePhotoStub,
    approveUnlocked: !!(o.arrivePhotoStub || o.status === 'PICKED_UP' || o.status === 'DELIVERED_ACCEPTED' || o.status === 'REFUSED_SEAL'),
  };
}

function shopOrder(o) {
  return {
    ...publicOrder(o),
    shopId: o.shopId,
    toteQrLinkedAt: o.toteQrLinkedAt || null,
    packPhotoNote: o.packPhotoNote || null,
  };
}

function earliestWindow(product) {
  return (product.windows && product.windows[0]) || null;
}

function findProduct(id) {
  return readJson('products.json', []).find((p) => p.id === id);
}

function findOrder(id) {
  return readJson('orders.json', []).find((o) => o.id === id);
}

function saveOrder(updated) {
  const orders = readJson('orders.json', []);
  const i = orders.findIndex((o) => o.id === updated.id);
  if (i === -1) orders.push(updated);
  else orders[i] = updated;
  writeJson('orders.json', orders);
  return updated;
}

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  if (rel === '/shop' || rel === '/shop/' || rel === '/shop/inventory' || rel === '/shop/inventory/') rel = '/shop.html';
  if (rel === '/member' || rel === '/member/' || rel === '/login' || rel === '/login/' || rel === '/join' || rel === '/join/' || rel === '/account' || rel === '/account/') rel = '/member.html';
  if (rel.startsWith('/handoff/')) rel = '/handoff.html';
  if (rel.startsWith('/track/') || rel.startsWith('/order/')) rel = '/track.html';
  if (rel === '/track' || rel === '/order') rel = '/track.html';

  const filePath = path.normalize(path.join(PUBLIC, rel));
  if (!filePath.startsWith(PUBLIC)) {
    return sendError(res, 403, 'Forbidden');
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return sendError(res, 404, 'Not found');
  }
  const ext = path.extname(filePath).toLowerCase();
  const data = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(data);
}


function slugifyProductId(title, explicit) {
  if (explicit && String(explicit).trim()) {
    return String(explicit).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  const base = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'sku';
  return `${base}-${Date.now().toString(36).slice(-4)}`;
}

function windowIdFromLabel(label) {
  const s = String(label).toLowerCase();
  if (s.includes('2-4') || s.includes('2–4')) return 'w_today_1400';
  if (s.includes('4-6') || s.includes('4–6')) return 'w_today_1600';
  if (s.includes('6-8') || s.includes('6–8')) return 'w_today_1800';
  if (s.includes('tomorrow')) return 'w_tmr_1000';
  return 'w_' + s.replace(/[^a-z0-9]+/g, '_').slice(0, 24);
}

function emojiForCategory(cat) {
  const c = String(cat || '').toLowerCase();
  if (c.includes('base')) return '⚾';
  if (c.includes('wrest')) return '🤼';
  if (c.includes('hockey')) return '🏒';
  if (c.includes('basket')) return '🏀';
  return '🏈';
}

function extFromUpload(filename, mime) {
  const lower = String(filename || '').toLowerCase();
  if (lower.endsWith('.png') || mime === 'image/png') return '.png';
  if (lower.endsWith('.webp') || mime === 'image/webp') return '.webp';
  if (lower.endsWith('.gif') || mime === 'image/gif') return '.gif';
  return '.jpg';
}

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readMultipart(req) {
  const ctype = String(req.headers['content-type'] || '');
  const m = ctype.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!m) throw new Error('multipart boundary missing');
  const boundary = m[1] || m[2];
  const buf = await readRaw(req);
  const parts = [];
  const sep = Buffer.from('--' + boundary);
  let start = buf.indexOf(sep) + sep.length;
  while (start < buf.length) {
    if (buf[start] === 45 && buf[start + 1] === 45) break; // --
    if (buf[start] === 13 && buf[start + 1] === 10) start += 2;
    const next = buf.indexOf(sep, start);
    if (next < 0) break;
    let part = buf.slice(start, next - 2); // trim \r\n
    start = next + sep.length;
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd < 0) continue;
    const header = part.slice(0, headerEnd).toString('utf8');
    const data = part.slice(headerEnd + 4);
    const nameM = header.match(/name="([^"]+)"/i);
    const fileM = header.match(/filename="([^"]*)"/i);
    const mimeM = header.match(/Content-Type:\s*([^\r\n]+)/i);
    if (!nameM) continue;
    parts.push({
      name: nameM[1],
      filename: fileM ? fileM[1] : null,
      mime: mimeM ? mimeM[1].trim() : null,
      data,
    });
  }
  const fields = {};
  const files = {};
  for (const part of parts) {
    if (part.filename != null && part.filename !== '') {
      files[part.name] = part;
    } else {
      fields[part.name] = part.data.toString('utf8');
    }
  }
  return { fields, files };
}



function getPrimaryShop() {
  const shops = readJson('shops.json', []);
  return shops[0] || null;
}

function shopUsesCustomWindows(shop) {
  return !!(shop && (shop.ownDriver || shop.customWindows));
}

/** Buyer-facing windows only — never includes shop identity */
function resolveProductWindowsForBuyer(product, shop) {
  const byId = {};
  for (const w of product.windows || []) byId[w.id] = w;
  if (shopUsesCustomWindows(shop)) {
    const active = (shop.windows || []).filter((w) => w.active !== false);
    return active.map((sw) => {
      const pw = byId[sw.id];
      return {
        id: sw.id,
        label: sw.label,
        units: pw ? pw.units : 0,
      };
    }).filter((w) => w.units > 0 || true); // show even 0 so buyer sees sold-out slots? keep all active
  }
  // Platform hours: map product units onto platform window ids
  return PLATFORM_WINDOWS.map((pw) => {
    const match = byId[pw.id] || (product.windows || []).find((w) => w.label === pw.label);
    return {
      id: pw.id,
      label: pw.label,
      units: match ? match.units : ((product.windows || [])[0] ? (product.windows[0].units || 0) : 0),
    };
  });
}

function buildProductWindows(body, units, windowLabel) {
  const shop = getPrimaryShop();
  if (shopUsesCustomWindows(shop) && shop.windows && shop.windows.length) {
    const unitsMap = body.unitsByWindow || {};
    return shop.windows.filter((w) => w.active !== false).map((sw, i) => ({
      id: sw.id,
      label: sw.label,
      units: unitsMap[sw.id] != null ? Math.max(0, parseInt(unitsMap[sw.id], 10) || 0) : (i === 0 ? units : 0),
    }));
  }
  const primaryId = windowIdFromLabel(windowLabel);
  return [
    { id: primaryId, label: windowLabel, units },
    { id: 'w_today_1800', label: 'Today 6-8pm', units: Math.max(units, 1) },
    { id: 'w_tmr_1000', label: 'Tomorrow 10am-12pm', units: Math.max(units + 1, 2) },
  ];
}

function syncProductsToShopWindow(sw, removedId) {
  const products = readJson('products.json', []);
  for (const p of products) {
    if (!p.windows) p.windows = [];
    if (removedId) {
      p.windows = p.windows.filter((w) => w.id !== removedId);
      continue;
    }
    const existing = p.windows.find((w) => w.id === sw.id);
    if (existing) {
      existing.label = sw.label;
    } else {
      p.windows.push({ id: sw.id, label: sw.label, units: 0 });
    }
  }
  writeJson('products.json', products);
}

async function handleApi(req, res, pathname) {
  const method = req.method.toUpperCase();

  // GET /api/health
  if (method === 'GET' && pathname === '/api/health') {
    return send(res, 200, { ok: true, brand: 'VendiPort', port: PORT, dataDir: DATA });
  }

  // GET /api/products — buyer catalog (no shop identity). ?scope=shop includes hidden.
  if (method === 'GET' && pathname === '/api/products') {
    const u = new URL(req.url, `http://${req.headers.host}`);
    const shopScope = u.searchParams.get('scope') === 'shop';
    const shop = getPrimaryShop();
    const products = readJson('products.json', [])
      .filter((p) => shopScope || !p.hidden)
      .map((p) => {
        const windows = shopScope
          ? (p.windows || []).map((w) => ({ id: w.id, label: w.label, units: w.units }))
          : resolveProductWindowsForBuyer(p, shop);
        const earliest = windows.find((w) => w.units > 0) || windows[0] || null;
        return {
          id: p.id,
          title: p.title,
          subtitle: p.subtitle,
          category: p.category,
          price: p.price,
          emoji: p.emoji,
          tile: p.tile || null,
          image: p.image || null,
          barcode: p.barcode || null,
          hidden: !!p.hidden,
          earliestWindow: earliest
            ? { id: earliest.id, label: earliest.label, units: earliest.units }
            : null,
          windows,
        };
      });
    return send(res, 200, {
      products,
      deliveryFee: DELIVERY_FEE,
      minOrder: MIN_ORDER,
      minOrderPrd: 75,
      moneyCopy: MONEY_COPY,
      windowMode: shopUsesCustomWindows(shop) ? 'shop-custom' : 'platform',
      // never include shop name/address
    });
  }

  // POST /api/products — shop adds sealed SKU (JSON; optional imageUrl)
  if (method === 'POST' && pathname === '/api/products') {
    const body = await readBody(req);
    const title = String(body.title || '').trim();
    if (!title) return sendError(res, 400, 'Title required');
    const price = Number(body.price);
    if (!(price >= 0)) return sendError(res, 400, 'Valid price required');
    const units = Math.max(0, parseInt(body.units, 10) || 0);
    const windowLabel = String(body.windowLabel || 'Today 4-6pm').trim();
    const category = String(body.category || 'Football').trim();
    const id = slugifyProductId(title, body.id);
    const products = readJson('products.json', []);
    if (products.some((p) => p.id === id)) return sendError(res, 409, 'Product id already exists');

    let image = body.imageUrl ? String(body.imageUrl).trim() : null;
    if (image && image.startsWith('http')) {
      // leave remote URL as-is, or download later via upload endpoint
    } else if (image && !image.startsWith('/')) {
      image = null;
    }

    const barcode = body.barcode != null ? String(body.barcode).trim() : '';
    const product = {
      id,
      title,
      subtitle: String(body.subtitle || 'Sealed · Demo price — confirm with shop').trim(),
      category,
      price,
      emoji: body.emoji || emojiForCategory(category),
      tile: String(body.tile || title.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() || 'SKU'),
      image: image || null,
      barcode: barcode || null,
      hidden: false,
      windows: buildProductWindows(body, units, windowLabel),
    };
    products.push(product);
    writeJson('products.json', products);
    return send(res, 201, { product });
  }

  // POST /api/products/upload — multipart image → public/img/products/<id>.<ext>
  if (method === 'POST' && pathname === '/api/products/upload') {
    const parsed = await readMultipart(req);
    const file = parsed.files.image || parsed.files.file;
    const productId = (parsed.fields.productId || parsed.fields.id || '').trim();
    if (!file || !file.data || !file.data.length) return sendError(res, 400, 'image file required');
    if (!productId) return sendError(res, 400, 'productId required');
    const products = readJson('products.json', []);
    const product = products.find((p) => p.id === productId);
    if (!product) return sendError(res, 404, 'Product not found');
    const ext = extFromUpload(file.filename, file.mime);
    const dir = path.join(PUBLIC, 'img', 'products');
    fs.mkdirSync(dir, { recursive: true });
    const fname = `${productId}${ext}`;
    fs.writeFileSync(path.join(dir, fname), file.data);
    product.image = `/img/products/${fname}`;
    writeJson('products.json', products);
    return send(res, 200, { product, image: product.image });
  }

  // PATCH /api/products/:id — edit price/units/hidden/title/subtitle
  if (method === 'PATCH' && pathname.startsWith('/api/products/')) {
    const id = decodeURIComponent(pathname.slice('/api/products/'.length).split('/')[0]);
    const body = await readBody(req);
    const products = readJson('products.json', []);
    const product = products.find((p) => p.id === id);
    if (!product) return sendError(res, 404, 'Product not found');
    if (body.title != null) product.title = String(body.title).trim();
    if (body.subtitle != null) product.subtitle = String(body.subtitle).trim();
    if (body.category != null) product.category = String(body.category).trim();
    if (body.price != null) {
      const price = Number(body.price);
      if (!(price >= 0)) return sendError(res, 400, 'Invalid price');
      product.price = price;
    }
    if (body.hidden != null) product.hidden = !!body.hidden;
    if (body.imageUrl != null) {
      const img = String(body.imageUrl).trim();
      product.image = img || null;
    }
    if (body.emoji != null) product.emoji = String(body.emoji);
    if (body.barcode != null) product.barcode = String(body.barcode).trim() || null;
    if (body.units != null || body.windowLabel != null) {
      const units = body.units != null ? Math.max(0, parseInt(body.units, 10) || 0) : null;
      if (!product.windows || !product.windows.length) {
        const label = String(body.windowLabel || 'Today 4-6pm');
        product.windows = [{ id: windowIdFromLabel(label), label, units: units ?? 1 }];
      } else {
        if (body.windowLabel != null) {
          product.windows[0].label = String(body.windowLabel).trim();
          product.windows[0].id = windowIdFromLabel(product.windows[0].label);
        }
        if (units != null) product.windows[0].units = units;
      }
    }
    writeJson('products.json', products);
    return send(res, 200, { product });
  }

  // DELETE /api/products/:id — hide (soft) by default; ?hard=1 removes
  if (method === 'DELETE' && pathname.startsWith('/api/products/')) {
    const id = decodeURIComponent(pathname.slice('/api/products/'.length).split('/')[0]);
    const u = new URL(req.url, `http://${req.headers.host}`);
    const hard = u.searchParams.get('hard') === '1';
    let products = readJson('products.json', []);
    const product = products.find((p) => p.id === id);
    if (!product) return sendError(res, 404, 'Product not found');
    if (hard) {
      products = products.filter((p) => p.id !== id);
      writeJson('products.json', products);
      return send(res, 200, { deleted: id });
    }
    product.hidden = true;
    writeJson('products.json', products);
    return send(res, 200, { product });
  }

  // GET /api/shops — shop phone only
  if (method === 'GET' && pathname === '/api/shops') {
    return send(res, 200, { shops: readJson('shops.json', []) });
  }

  // PATCH /api/shops/:id — own-driver / custom windows toggle
  if (method === 'PATCH' && pathname.match(/^\/api\/shops\/[^/]+$/)) {
    const id = pathname.slice('/api/shops/'.length);
    const body = await readBody(req);
    const shops = readJson('shops.json', []);
    const shop = shops.find((s) => s.id === id);
    if (!shop) return sendError(res, 404, 'Shop not found');
    if (typeof body.ownDriver === 'boolean') {
      shop.ownDriver = body.ownDriver;
      shop.customWindows = body.ownDriver; // custom windows follow own-driver for MVP
    }
    if (typeof body.customWindows === 'boolean') {
      shop.customWindows = body.customWindows;
      if (body.customWindows) shop.ownDriver = true;
    }
    if (!shop.windows) shop.windows = [];
    writeJson('shops.json', shops);
    return send(res, 200, {
      shop,
      modeCopy: shopUsesCustomWindows(shop)
        ? 'Own-driver ON — shop windows drive buyer slots; shop keeps transport fee.'
        : 'Own-driver OFF — platform hours + courier average fee (pass-through).',
    });
  }

  // GET /api/shops/:id/windows
  if (method === 'GET' && pathname.match(/^\/api\/shops\/[^/]+\/windows$/)) {
    const id = pathname.split('/')[3];
    const shop = readJson('shops.json', []).find((s) => s.id === id);
    if (!shop) return sendError(res, 404, 'Shop not found');
    return send(res, 200, {
      windows: shop.windows || [],
      ownDriver: !!shop.ownDriver,
      customWindows: shopUsesCustomWindows(shop),
      platformWindows: PLATFORM_WINDOWS,
    });
  }

  // POST /api/shops/:id/windows — create window
  if (method === 'POST' && pathname.match(/^\/api\/shops\/[^/]+\/windows$/)) {
    const id = pathname.split('/')[3];
    const body = await readBody(req);
    const shops = readJson('shops.json', []);
    const shop = shops.find((s) => s.id === id);
    if (!shop) return sendError(res, 404, 'Shop not found');
    if (!shop.windows) shop.windows = [];
    const label = String(body.label || '').trim();
    if (!label) return sendError(res, 400, 'label required');
    const wid = body.id ? String(body.id) : windowIdFromLabel(label) + '-' + Date.now().toString(36).slice(-3);
    if (shop.windows.some((w) => w.id === wid)) return sendError(res, 409, 'Window id exists');
    const sw = {
      id: wid,
      label,
      capacity: Math.max(0, parseInt(body.capacity, 10) || 0),
      active: body.active !== false,
    };
    shop.windows.push(sw);
    writeJson('shops.json', shops);
    syncProductsToShopWindow(sw);
    return send(res, 201, { window: sw, shop });
  }

  // PATCH /api/shops/:id/windows/:wid
  if (method === 'PATCH' && pathname.match(/^\/api\/shops\/[^/]+\/windows\/[^/]+$/)) {
    const parts = pathname.split('/');
    const shopId = parts[3];
    const wid = decodeURIComponent(parts[5]);
    const body = await readBody(req);
    const shops = readJson('shops.json', []);
    const shop = shops.find((s) => s.id === shopId);
    if (!shop) return sendError(res, 404, 'Shop not found');
    const sw = (shop.windows || []).find((w) => w.id === wid);
    if (!sw) return sendError(res, 404, 'Window not found');
    if (body.label != null) sw.label = String(body.label).trim();
    if (body.capacity != null) sw.capacity = Math.max(0, parseInt(body.capacity, 10) || 0);
    if (body.active != null) sw.active = !!body.active;
    writeJson('shops.json', shops);
    syncProductsToShopWindow(sw);
    return send(res, 200, { window: sw });
  }

  // DELETE /api/shops/:id/windows/:wid
  if (method === 'DELETE' && pathname.match(/^\/api\/shops\/[^/]+\/windows\/[^/]+$/)) {
    const parts = pathname.split('/');
    const shopId = parts[3];
    const wid = decodeURIComponent(parts[5]);
    const shops = readJson('shops.json', []);
    const shop = shops.find((s) => s.id === shopId);
    if (!shop) return sendError(res, 404, 'Shop not found');
    shop.windows = (shop.windows || []).filter((w) => w.id !== wid);
    writeJson('shops.json', shops);
    syncProductsToShopWindow(null, wid);
    return send(res, 200, { deleted: wid });
  }

  // GET /api/orders
  if (method === 'GET' && pathname === '/api/orders') {
    const u = new URL(req.url, `http://${req.headers.host}`);
    const scope = u.searchParams.get('scope') || 'buyer';
    const status = u.searchParams.get('status');
    let orders = readJson('orders.json', []);
    if (scope === 'shop') {
      orders = orders.filter((o) => SHOP_VISIBLE.has(o.status) || status);
      if (status) {
        const wanted = new Set(status.split(','));
        orders = orders.filter((o) => wanted.has(o.status));
      } else {
        orders = orders.filter((o) => SHOP_VISIBLE.has(o.status));
      }
      return send(res, 200, { orders: orders.map(shopOrder) });
    }
    if (status) {
      const wanted = new Set(status.split(','));
      orders = orders.filter((o) => wanted.has(o.status));
    }
    return send(res, 200, { orders: orders.map(publicOrder) });
  }

  // GET /api/orders/:id
  if (method === 'GET' && /^\/api\/orders\/[^/]+$/.test(pathname)) {
    const id = pathname.slice('/api/orders/'.length);
    const order = findOrder(id);
    if (!order) return sendError(res, 404, 'Order not found');
    return send(res, 200, { order: publicOrder(order) });
  }

  // GET /api/stats — shop demo stats (JSON-backed)
  if (method === 'GET' && pathname === '/api/stats') {
    const shop = getPrimaryShop();
    const orders = readJson('orders.json', []);
    const products = readJson('products.json', []);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const startIso = start.toISOString();
    const today = orders.filter((o) => (o.createdAt || o.updatedAt || '') >= startIso);
    const byStatus = {};
    for (const o of today) {
      byStatus[o.status] = (byStatus[o.status] || 0) + 1;
    }
    const unitsListed = products
      .filter((p) => !p.hidden)
      .reduce((sum, p) => sum + (p.windows || []).reduce((s, w) => s + (Number(w.units) || 0), 0), 0);
    const skusLive = products.filter((p) => !p.hidden).length;
    return send(res, 200, {
      stats: {
        date: startIso.slice(0, 10),
        ordersToday: today.length,
        byStatus,
        skusLive,
        unitsListed,
        ownDriver: !!(shop && (shop.ownDriver || shop.customWindows)),
        shopName: shop ? shop.name : null,
        activeJobs: orders.filter((o) => SHOP_VISIBLE.has(o.status)).length,
        note: 'Demo stats from local JSON — free-tier disk may reset',
      },
    });
  }

  // POST /api/orders — create DRAFT then optional immediate pay via ?pay=1 or body.pay
  if (method === 'POST' && pathname === '/api/orders') {
    const body = await readBody(req);
    const product = findProduct(body.productId);
    if (!product) return sendError(res, 400, 'Unknown product');
    const window =
      (product.windows || []).find((w) => w.id === body.windowId) || earliestWindow(product);
    if (!window) return sendError(res, 400, 'No delivery window');
    if (window.units < 1) return sendError(res, 400, 'No units left for that window');
    if (product.price < MIN_ORDER) {
      return sendError(res, 400, `Min order for delivery is $${MIN_ORDER}`);
    }

    const shops = readJson('shops.json', []);
    const shop = shops[0];
    if (!shop) return sendError(res, 500, 'No fulfillment shop configured');

    const now = new Date().toISOString();
    const orderId = randomUUID();
    const order = {
      id: orderId,
      status: 'DRAFT',
      productId: product.id,
      productTitle: product.title,
      productImage: product.image || null,
      productEmoji: product.emoji || null,
      productPrice: product.price,
      toteQrPayload: `VENDIPORT:ORDER:${orderId}`,
      deliveryFee: DELIVERY_FEE,
      total: product.price + DELIVERY_FEE,
      windowId: window.id,
      windowLabel: window.label,
      membershipOptIn: !!body.membershipOptIn,
      shopId: shop.id,
      createdAt: now,
      updatedAt: now,
    };

    // Decrement window units on pay only (reserve on pay for MVP)
    saveOrder(order);

    if (body.pay) {
      return payOrder(res, order.id);
    }
    return send(res, 201, { order: publicOrder(order) });
  }

  // POST /api/orders/:id/pay
  if (method === 'POST' && /^\/api\/orders\/[^/]+\/pay$/.test(pathname)) {
    const id = pathname.split('/')[3];
    return payOrder(res, id);
  }

  // POST /api/orders/:id/start-pack
  if (method === 'POST' && /^\/api\/orders\/[^/]+\/start-pack$/.test(pathname)) {
    const id = pathname.split('/')[3];
    return transition(res, id, 'PAID', 'PACKING');
  }

  // POST /api/orders/:id/pack-photo — pack image + QR in frame = transaction identity
  if (method === 'POST' && /^\/api\/orders\/[^/]+\/pack-photo$/.test(pathname)) {
    const id = pathname.split('/')[3];
    const order = findOrder(id);
    if (!order) return sendError(res, 404, 'Order not found');
    if (!['PAID', 'PACKING'].includes(order.status)) {
      return sendError(res, 409, `Cannot pack-photo from ${order.status}`);
    }
    const body = await readBody(req);
    if (order.status === 'PAID') order.status = 'PACKING';

    const packPath = savePackImage(
      order.id,
      (body && (body.packImage || body.packImageBase64 || body.imageDataUrl)) || null
    );
    if (packPath) {
      order.packPhoto = packPath;
      order.packPhotoStub = true;
      order.packPhotoNote = 'Pack photo saved — tote QR in frame is transaction identity.';
    } else {
      // Demo stub without camera (local/API tests)
      order.packPhotoStub = true;
      order.packPhotoNote =
        'Demo stub pack photo (no image). Reshoot with tote QR in frame for real identity.';
    }

    const detected = body && body.toteQrPayload ? String(body.toteQrPayload).trim() : '';
    const fromPack = !!(body && (body.qrDetectedFromPack || body.fromPackPhoto));
    if (detected) {
      order.toteQrPayload = detected;
      order.toteQrLinkedAt = new Date().toISOString();
      order.toteQrFromPackPhoto = fromPack || !!packPath;
    } else if (!order.toteQrPayload) {
      order.toteQrPayload = `VENDIPORT:ORDER:${order.id}`;
      order.toteQrFromPackPhoto = false;
    }

    order.updatedAt = new Date().toISOString();
    saveOrder(order);
    return send(res, 200, {
      order: shopOrder(order),
      qrDetected: !!detected && fromPack,
      needsManualLink: !detected || !order.toteQrFromPackPhoto,
    });
  }

  // POST /api/orders/:id/assign-tote-qr — link pre-printed bag QR to this order
  if (method === 'POST' && /^\/api\/orders\/[^/]+\/assign-tote-qr$/.test(pathname)) {
    const id = pathname.split('/')[3];
    const order = findOrder(id);
    if (!order) return sendError(res, 404, 'Order not found');
    if (['DELIVERED_ACCEPTED', 'REFUSED_SEAL', 'CANCELLED'].includes(order.status)) {
      return sendError(res, 409, `Cannot assign tote QR from ${order.status}`);
    }
    const body = await readBody(req);
    const payload = String((body && body.toteQrPayload) || '').trim();
    if (!payload) return sendError(res, 400, 'toteQrPayload required — scan/enter the QR printed on the tote bag');
    order.toteQrPayload = payload;
    order.toteQrLinkedAt = new Date().toISOString();
    order.toteQrFromPackPhoto = !!(body && body.fromPackPhoto);
    order.updatedAt = new Date().toISOString();
    saveOrder(order);
    return send(res, 200, { order: shopOrder(order) });
  }

  // POST /api/orders/:id/seal — confirm zip-tie + VOID label
  if (method === 'POST' && /^\/api\/orders\/[^/]+\/seal$/.test(pathname)) {
    const id = pathname.split('/')[3];
    const order = findOrder(id);
    if (!order) return sendError(res, 404, 'Order not found');
    if (order.status !== 'PACKING') return sendError(res, 409, `Cannot seal from ${order.status}`);
    if (!order.packPhotoStub) return sendError(res, 409, 'Capture pack photo stub first');
    order.sealConfirmed = true;
    order.sealChecklist = {
      zipTie: true,
      voidLabel: true,
      qrLast4: order.id.slice(-4).toUpperCase(),
      copy: 'Zip both pulls · one zip tie through both loops · VOID wrap on lock head (physical seal). Tote QR is already printed on the bag — not a sticker.',
    };
    order.updatedAt = new Date().toISOString();
    saveOrder(order);
    return send(res, 200, { order: shopOrder(order) });
  }

  // POST /api/orders/:id/ready  (sealed + ready)
  if (method === 'POST' && /^\/api\/orders\/[^/]+\/ready$/.test(pathname)) {
    const id = pathname.split('/')[3];
    const order = findOrder(id);
    if (!order) return sendError(res, 404, 'Order not found');
    if (!['PACKING', 'PAID'].includes(order.status)) {
      return sendError(res, 409, `Cannot mark ready from ${order.status}`);
    }
    // Guided path prefers pack+seal; allow skip for demo with auto-stubs
    if (!order.packPhotoStub) {
      order.packPhotoStub = true;
      order.packPhotoNote = 'Auto-stubbed pack photo for READY shortcut';
    }
    if (!order.sealConfirmed) {
      order.sealConfirmed = true;
      order.sealChecklist = { zipTie: true, voidLabel: true, qrLast4: order.id.slice(-4).toUpperCase(), copy: 'Seal checklist auto-confirmed on READY' };
    }
    if (order.status === 'PAID') order.status = 'PACKING';
    order.status = 'READY';
    order.updatedAt = new Date().toISOString();
    order.sealedAt = order.updatedAt;
    saveOrder(order);
    return send(res, 200, { order: shopOrder(order) });
  }

  // POST /api/orders/:id/arrive-photo — stub unlocks buyer approve
  if (method === 'POST' && /^\/api\/orders\/[^/]+\/arrive-photo$/.test(pathname)) {
    const id = pathname.split('/')[3];
    const order = findOrder(id);
    if (!order) return sendError(res, 404, 'Order not found');
    if (order.status !== 'PICKED_UP') return sendError(res, 409, `Arrive photo after pickup only (now ${order.status})`);
    order.arrivePhotoStub = true;
    order.arrivePhotoNote = 'Stub: sealed tote at door photo (camera not wired). Buyer approve unlocked.';
    order.updatedAt = new Date().toISOString();
    saveOrder(order);
    return send(res, 200, { order: publicOrder(order) });
  }

  // POST /api/orders/:id/pickup — driver has tote; cancel closes
  if (method === 'POST' && /^\/api\/orders\/[^/]+\/pickup$/.test(pathname)) {
    const id = pathname.split('/')[3];
    const order = findOrder(id);
    if (!order) return sendError(res, 404, 'Order not found');
    if (order.status !== 'READY') {
      return sendError(res, 409, `Cannot pickup from ${order.status}`);
    }
    order.status = 'PICKED_UP';
    order.updatedAt = new Date().toISOString();
    order.pickedUpAt = order.updatedAt;
    saveOrder(order);
    return send(res, 200, { order: shopOrder(order) });
  }

  // POST /api/orders/:id/accept — sale final ONLY after tote QR match + confirmation image
  if (method === 'POST' && /^\/api\/orders\/[^/]+\/accept$/.test(pathname)) {
    const id = pathname.split('/')[3];
    const body = await readBody(req);
    const order = findOrder(id);
    if (!order) return sendError(res, 404, 'Order not found');
    if (!['PICKED_UP', 'READY'].includes(order.status)) {
      return sendError(res, 409, `Cannot accept from ${order.status}`);
    }
    if (order.status === 'READY') {
      order.status = 'PICKED_UP';
      order.pickedUpAt = new Date().toISOString();
    }
    if (!order.arrivePhotoStub) {
      return sendError(res, 409, 'Arrive photo stub required before QR accept');
    }
    const expected = order.toteQrPayload || `VENDIPORT:ORDER:${order.id}`;
    const scanned = String(body.qrPayload || body.qr || '').trim();
    if (!scanned) {
      return sendError(res, 400, 'Scan or upload the QR printed on your tote bag. Sale final only after that tote QR matches the shop-linked bag QR.');
    }
    // Must match the shop-linked tote QR (original bag code)
    const norm = (s) => String(s || '').trim().toUpperCase();
    const ok =
      norm(scanned) === norm(expected) ||
      (norm(expected).includes(norm(scanned)) && scanned.length >= 8) ||
      (norm(scanned).includes(norm(expected)) && expected.length >= 8);
    if (!ok) {
      return sendError(res, 409, 'QR does not match the tote QR from the shop pack photo (last-4 ' + last4(order.id) + '). Confirm intact package and scan that same bag QR.');
    }
    const confirmPath = saveConfirmImage(
      order.id,
      body.confirmImage || body.confirmImageBase64 || body.imageDataUrl || null
    );
    if (!confirmPath) {
      return sendError(res, 400, 'Confirmation image required — upload a photo of the tote QR or use camera (we capture a frame). Store needs this proof.');
    }
    const now = new Date().toISOString();
    order.qrVerified = true;
    order.qrScannedAt = now;
    order.qrScannedPayload = scanned;
    order.matchedToteQr = expected;
    order.confirmImage = confirmPath;
    order.confirmedAt = now;
    order.status = 'DELIVERED_ACCEPTED';
    order.updatedAt = now;
    order.acceptedAt = now;
    order.settlementStub = {
      product: order.productPrice,
      platformTake: +(order.productPrice * PLATFORM_TAKE).toFixed(2),
      shopShare: +(order.productPrice * (1 - PLATFORM_TAKE)).toFixed(2),
      deliveryFee: order.deliveryFee,
      note: 'Sale final after tote QR match + buyer confirmation image. Shop payout stub.',
    };
    saveOrder(order);
    return send(res, 200, { order: publicOrder(order) });
  }

  // POST /api/orders/:id/refuse — seal broken, full refund stub
  if (method === 'POST' && /^\/api\/orders\/[^/]+\/refuse$/.test(pathname)) {
    const id = pathname.split('/')[3];
    const order = findOrder(id);
    if (!order) return sendError(res, 404, 'Order not found');
    if (!['PICKED_UP', 'READY'].includes(order.status)) {
      return sendError(res, 409, `Cannot refuse from ${order.status}`);
    }
    order.status = 'REFUSED_SEAL';
    order.updatedAt = new Date().toISOString();
    order.refusedAt = order.updatedAt;
    order.refundStub = {
      amount: order.total,
      fee: 0,
      note: 'Full refund — seal/QR integrity fail. No 15% cancel fee. Return tote to shop.',
    };
    saveOrder(order);
    return send(res, 200, { order: publicOrder(order) });
  }

  // POST /api/orders/:id/cancel
  if (method === 'POST' && /^\/api\/orders\/[^/]+\/cancel$/.test(pathname)) {
    const id = pathname.split('/')[3];
    const order = findOrder(id);
    if (!order) return sendError(res, 404, 'Order not found');
    if (!CANCELABLE.has(order.status)) {
      return sendError(
        res,
        409,
        'Cancel closed after driver pickup. All sales final except seal refuse.'
      );
    }
    const cancelFee = +(order.productPrice * CANCEL_FEE_RATE).toFixed(2);
    const shopShare = +(cancelFee / 2).toFixed(2);
    const platformShare = +(cancelFee / 2).toFixed(2);
    const productRefund = +(order.productPrice - cancelFee).toFixed(2);
    order.status = 'CANCELLED';
    order.updatedAt = new Date().toISOString();
    order.cancelledAt = order.updatedAt;
    order.cancelFee = cancelFee;
    order.refundStub = {
      productRefund,
      deliveryRefund: order.deliveryFee,
      cancelFee,
      cancelFeeSplit: { shop: shopShare, vendiport: platformShare },
      note: '15% cancel fee of product split 7.5/7.5. Delivery fee refunded (not picked up).',
    };
    // Restore a unit to the window
    restoreUnit(order.productId, order.windowId);
    saveOrder(order);
    return send(res, 200, { order: publicOrder(order) });
  }

  return sendError(res, 404, 'API route not found');
}

function restoreUnit(productId, windowId) {
  const products = readJson('products.json', []);
  const p = products.find((x) => x.id === productId);
  if (!p) return;
  const w = (p.windows || []).find((x) => x.id === windowId);
  if (w) w.units += 1;
  writeJson('products.json', products);
}

function consumeUnit(productId, windowId) {
  const products = readJson('products.json', []);
  const p = products.find((x) => x.id === productId);
  if (!p) return false;
  const w = (p.windows || []).find((x) => x.id === windowId);
  if (!w || w.units < 1) return false;
  w.units -= 1;
  writeJson('products.json', products);
  return true;
}

function payOrder(res, id) {
  const order = findOrder(id);
  if (!order) return sendError(res, 404, 'Order not found');
  if (order.status !== 'DRAFT') {
    return sendError(res, 409, `Cannot pay from ${order.status}`);
  }
  if (!consumeUnit(order.productId, order.windowId)) {
    return sendError(res, 409, 'No units left for that window');
  }
  order.status = 'PAID';
  order.updatedAt = new Date().toISOString();
  order.paidAt = order.updatedAt;
  order.paymentStub = {
    method: 'stub',
    charged: order.total,
    note: 'Pay stub — no real Stripe. Marked PAID so shop can pack.',
  };
  saveOrder(order);
  return send(res, 200, { order: publicOrder(order) });
}

function transition(res, id, from, to) {
  const order = findOrder(id);
  if (!order) return sendError(res, 404, 'Order not found');
  if (order.status !== from) {
    return sendError(res, 409, `Expected ${from}, got ${order.status}`);
  }
  order.status = to;
  order.updatedAt = new Date().toISOString();
  saveOrder(order);
  return send(res, 200, { order: shopOrder(order) });
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = u.pathname;

    // Liveness for free hosts / load balancers
    if (req.method === 'GET' && (pathname === '/health' || pathname === '/healthz')) {
      return send(res, 200, { ok: true });
    }

    if (pathname.startsWith('/api/')) {
      return await handleApi(req, res, pathname);
    }

    // Pretty handoff path still serves handoff.html
    return serveStatic(req, res, pathname);
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Server error');
  }
});

ensureDataDir();
server.listen(PORT, HOST, () => {
  console.log(`VendiPort beta listening on http://${HOST}:${PORT}`);
  console.log(`  Health:  http://${HOST}:${PORT}/health`);
  console.log(`  Buyer:   http://${HOST}:${PORT}/`);
  console.log(`  Shop:    http://${HOST}:${PORT}/shop`);
  console.log(`  Account: http://${HOST}:${PORT}/account`);
  console.log(`  Member:  http://${HOST}:${PORT}/member`);
  console.log(`  Handoff: http://${HOST}:${PORT}/handoff/<orderId>`);
  console.log(`  Track:   http://${HOST}:${PORT}/track/<orderId>`);
  console.log(`  Data:    ${DATA}`);
});
