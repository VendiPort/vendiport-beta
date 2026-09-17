/* VendiPort box → galaxy compositor (vanilla, no ML).
 * White/light-bg product photos → edge flood white-key → centered on shared galaxy.
 * Contain-with-padding (~10%) so the whole sealed box stays readable and SKUs look even.
 */
(function (global) {
  'use strict';

  const GALAXY_URL = '/img/galaxy-bg.jpg';
  const OUT_W = 720;
  const OUT_H = 960; // 3:4 matches glass slots
  const PAD = 0.08; // ~8–12% margin around subject
  const WHITE_THRESH = 232;
  const WHITE_SOFT = 18;
  const CHROMA_MAX = 42;

  const cache = new Map(); // key → object URL or data URL
  let galaxyImgPromise = null;

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      // Only set CORS for absolute remote URLs; same-origin paths stay untainted for canvas.
      if (/^https?:\/\//i.test(src) && src.indexOf(location.origin) !== 0) {
        img.crossOrigin = 'anonymous';
      }
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image: ' + src));
      img.src = src;
    });
  }

  function getGalaxy() {
    if (!galaxyImgPromise) {
      galaxyImgPromise = loadImage(GALAXY_URL).catch((err) => {
        galaxyImgPromise = null;
        throw err;
      });
    }
    return galaxyImgPromise;
  }

  function isNearWhitePixel(r, g, b, thresh, soft) {
    const mn = Math.min(r, g, b);
    const mx = Math.max(r, g, b);
    if (mx - mn > CHROMA_MAX) return false;
    return mn >= thresh - soft;
  }

  function whitenessAlpha(r, g, b, thresh, soft) {
    const mn = Math.min(r, g, b);
    const mx = Math.max(r, g, b);
    if (mx - mn > CHROMA_MAX) return 0; // keep colored pixels
    if (mn < thresh - soft) return 0;
    if (mn >= thresh) return 1;
    return (mn - (thresh - soft)) / soft;
  }

  /** Edge-connected white-key with soft alpha. Protects white logos inside the box. */
  function keyWhiteBackground(imageData, thresh, soft) {
    const { data, width, height } = imageData;
    const n = width * height;
    const visited = new Uint8Array(n);
    const queue = new Int32Array(n);
    let qh = 0;
    let qt = 0;

    function trySeed(i) {
      const o = i * 4;
      if (!isNearWhitePixel(data[o], data[o + 1], data[o + 2], thresh, soft)) return;
      if (visited[i]) return;
      visited[i] = 1;
      queue[qt++] = i;
    }

    for (let x = 0; x < width; x++) {
      trySeed(x);
      trySeed((height - 1) * width + x);
    }
    for (let y = 0; y < height; y++) {
      trySeed(y * width);
      trySeed(y * width + width - 1);
    }

    while (qh < qt) {
      const i = queue[qh++];
      const x = i % width;
      const y = (i / width) | 0;
      if (x > 0) trySeed(i - 1);
      if (x < width - 1) trySeed(i + 1);
      if (y > 0) trySeed(i - width);
      if (y < height - 1) trySeed(i + width);
    }

    for (let i = 0; i < n; i++) {
      if (!visited[i]) continue;
      const o = i * 4;
      const w = whitenessAlpha(data[o], data[o + 1], data[o + 2], thresh, soft);
      // Steeper soft falloff reduces white halo on dark galaxy
      const a = Math.round(255 * Math.pow(1 - w, 1.85));
      data[o + 3] = a;
      if (a < 12) {
        data[o] = 0;
        data[o + 1] = 0;
        data[o + 2] = 0;
        data[o + 3] = 0;
      }
    }
    return imageData;
  }

  /** Bounding box of opaque-ish pixels after keying. */
  function subjectBounds(imageData, alphaMin) {
    const { data, width, height } = imageData;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] < alphaMin) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  function drawCover(ctx, img, cw, ch) {
    const ir = img.width / img.height;
    const cr = cw / ch;
    let dw;
    let dh;
    if (ir > cr) {
      dh = ch;
      dw = ch * ir;
    } else {
      dw = cw;
      dh = cw / ir;
    }
    ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
  }

  /**
   * Composite white-bg product onto galaxy canvas.
   * @returns {Promise<HTMLCanvasElement>}
   */
  async function compositeToCanvas(source) {
    const galaxy = await getGalaxy();
    let product;
    if (typeof source === 'string') {
      product = await loadImage(source);
    } else if (source instanceof HTMLImageElement) {
      product = source;
    } else if (source instanceof Blob || source instanceof File) {
      const url = URL.createObjectURL(source);
      try {
        product = await loadImage(url);
      } finally {
        URL.revokeObjectURL(url);
      }
    } else {
      throw new Error('Unsupported composite source');
    }

    // Key on offscreen at product resolution (cap for phone CPU)
    const maxSide = 900;
    let pw = product.width;
    let ph = product.height;
    const scaleDown = Math.min(1, maxSide / Math.max(pw, ph));
    pw = Math.max(1, Math.round(pw * scaleDown));
    ph = Math.max(1, Math.round(ph * scaleDown));

    const keyCanvas = document.createElement('canvas');
    keyCanvas.width = pw;
    keyCanvas.height = ph;
    const kctx = keyCanvas.getContext('2d', { willReadFrequently: true });
    kctx.drawImage(product, 0, 0, pw, ph);
    let idata = kctx.getImageData(0, 0, pw, ph);
    keyWhiteBackground(idata, WHITE_THRESH, WHITE_SOFT);
    kctx.putImageData(idata, 0, 0);

    const bounds = subjectBounds(idata, 40) || { x: 0, y: 0, w: pw, h: ph };

    const out = document.createElement('canvas');
    out.width = OUT_W;
    out.height = OUT_H;
    const ctx = out.getContext('2d');
    drawCover(ctx, galaxy, OUT_W, OUT_H);

    // Contain subject in padded frame — natural aspect, no stretch
    const availW = OUT_W * (1 - 2 * PAD);
    const availH = OUT_H * (1 - 2 * PAD);
    const fit = Math.min(availW / bounds.w, availH / bounds.h);
    const dw = bounds.w * fit;
    const dh = bounds.h * fit;
    const dx = (OUT_W - dw) / 2;
    const dy = (OUT_H - dh) / 2;

    // Crisp draw — no soft shadow haze around merchandise
    ctx.drawImage(
      keyCanvas,
      bounds.x,
      bounds.y,
      bounds.w,
      bounds.h,
      dx,
      dy,
      dw,
      dh
    );

    return out;
  }

  async function compositeToDataURL(source, type, quality) {
    const canvas = await compositeToCanvas(source);
    return canvas.toDataURL(type || 'image/jpeg', quality == null ? 0.88 : quality);
  }

  async function compositeToBlob(source, type, quality) {
    const canvas = await compositeToCanvas(source);
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
        type || 'image/jpeg',
        quality == null ? 0.88 : quality
      );
    });
  }

  async function compositeFile(file) {
    const blob = await compositeToBlob(file);
    const name = (file && file.name ? file.name.replace(/\.[^.]+$/, '') : 'box') + '-galaxy.jpg';
    return new File([blob], name, { type: 'image/jpeg' });
  }

  /** Cached composited URL for browse/checkout. */
  async function getComposited(cacheKey, imageUrl) {
    const key = String(cacheKey || imageUrl);
    if (cache.has(key)) return cache.get(key);
    const pending = compositeToDataURL(imageUrl)
      .then((url) => {
        cache.set(key, url);
        return url;
      })
      .catch((err) => {
        cache.delete(key);
        throw err;
      });
    cache.set(key, pending);
    return pending;
  }

  function clearCache() {
    cache.clear();
  }

  global.BoxComposite = {
    GALAXY_URL,
    compositeToCanvas,
    compositeToDataURL,
    compositeToBlob,
    compositeFile,
    getComposited,
    clearCache,
    cache,
  };
})(typeof window !== 'undefined' ? window : globalThis);
