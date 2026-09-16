/* Door handoff — tote QR camera scan required for accept; refuse = seal/QR fail */
let currentOrder = null;
let scanLoop = null;
let mediaStream = null;
let detector = null;

async function init() {
  const id = orderIdFromPath();
  if (!id) {
    qs('#handoff-body').innerHTML = '<div class="empty">Missing order id. Use /handoff/&lt;orderId&gt;</div>';
    return;
  }
  try {
    const { order } = await api(`/api/orders/${id}`);
    currentOrder = order;
    render(order);
  } catch (err) {
    qs('#handoff-body').innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
  }
}

function visual(order) {
  if (order.productImage) {
    return `<img src="${escapeHtml(order.productImage)}" alt="" /><div class="glass-sheen" aria-hidden="true"></div>`;
  }
  return `<div class="fallback-tile"><div class="emoji">${order.productEmoji || '🎴'}</div><div class="code">BOX</div></div><div class="glass-sheen" aria-hidden="true"></div>`;
}

function stopScanner() {
  if (scanLoop) {
    cancelAnimationFrame(scanLoop);
    scanLoop = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
}

function render(order) {
  stopScanner();
  currentOrder = order;
  const body = qs('#handoff-body');
  const done = ['DELIVERED_ACCEPTED', 'REFUSED_SEAL', 'CANCELLED'].includes(order.status);
  const inRoute = order.status === 'PICKED_UP' || order.status === 'READY';
  const canDecide = inRoute && (order.approveUnlocked || order.arrivePhotoStub || order.status === 'READY');

  body.innerHTML = `
    <div class="co-machine">
      <div class="ho-hero">
        <div class="glass-window">
          <span class="bracket tl"></span><span class="bracket tr"></span>
          <span class="bracket bl"></span><span class="bracket br"></span>
          <div class="glass-inner">${visual(order)}</div>
        </div>
        <div>
          <div class="row-between" style="margin-bottom:8px">
            <span class="status-tag ${order.status}">${order.status}</span>
            <span class="last4">Last-4 ${order.last4}</span>
          </div>
          <h2 style="font-size:16px;line-height:1.25">${escapeHtml(order.productTitle)}</h2>
          <div class="mono" style="margin-top:6px">${escapeHtml(order.windowLabel)}</div>
          <div class="mono">Total ${money(order.total)}</div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-label">Sealed tote bag</div>
        <p style="font-size:13px;color:var(--muted);margin:0;line-height:1.4">
          Confirm everything is intact (zip-tie + VOID). Then scan or upload a photo of the
          <strong>QR printed on your tote bag</strong> — it must match the tote QR from the shop’s pack photo
          (last-4 ${order.last4}). That photo goes to the shop as drop-off proof.
        </p>
      </div>

      <div id="actions"></div>
    </div>
    <p class="footer-note">Keep tote secured until tote-bag QR accept.</p>
  `;

  const actions = qs('#actions');

  if (done) {
    if (order.status === 'DELIVERED_ACCEPTED') {
      actions.innerHTML = `<div class="banner ok">Tote-bag QR matched · Accepted — sale final.${order.qrVerified ? ' ✓' : ''}</div>
        ${order.confirmImage ? `<div class="panel" style="margin-top:10px"><div class="panel-label">Your confirmation photo (sent to shop)</div>
        <img src="${escapeHtml(order.confirmImage)}" alt="Confirmation" style="width:100%;max-height:220px;object-fit:cover;border-radius:10px;margin-top:6px" />
        <div class="mono" style="margin-top:6px">${escapeHtml(order.confirmedAt || '')}</div></div>` : ''}`;
    } else if (order.status === 'REFUSED_SEAL') {
      actions.innerHTML = '<div class="banner warn">Refused (seal / tote-bag QR fail) — full refund stub. Return tote to shop.</div>';
    } else {
      actions.innerHTML = '<div class="banner warn">Order cancelled.</div>';
    }
    return;
  }

  if (!canDecide) {
    const msg = order.status === 'PICKED_UP' && !order.arrivePhotoStub
      ? 'Waiting for arrive photo stub to unlock tote-bag QR accept.'
      : `Handoff unlocks after pickup (+ arrive photo). Now: ${escapeHtml(order.status)}`;
    actions.innerHTML = `<div class="banner warn">${msg}</div>`;
    if (order.status === 'PICKED_UP' && !order.arrivePhotoStub) {
      const stub = document.createElement('button');
      stub.type = 'button';
      stub.className = 'btn btn-teal btn-block';
      stub.style.marginTop = '10px';
      stub.textContent = 'Simulate arrive photo (stub)';
      stub.addEventListener('click', () => doAction(order.id, 'arrive-photo'));
      actions.appendChild(stub);
    }
    if (order.cancelAllowed) {
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn btn-ghost btn-block';
      cancel.style.marginTop = '10px';
      cancel.textContent = 'Cancel order (15% fee) — still open';
      cancel.addEventListener('click', () => doAction(order.id, 'cancel'));
      actions.appendChild(cancel);
    }
    return;
  }

  // QR accept panel — no naked Accept button
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = `
    <div class="panel-label">Scan or upload the QR on your tote bag</div>
    <p style="font-size:12px;color:var(--muted);margin:0 0 10px;line-height:1.4">
      Intact package + match to the <strong>store’s original tote QR</strong>. Camera scan captures a proof frame;
      upload sends your tote-QR photo to the shop. Sale completes only when codes match.
    </p>
    <div class="qr-stage">
      <video id="qr-video" playsinline muted></video>
      <canvas id="qr-canvas" class="hidden"></canvas>
      <div class="qr-frame" aria-hidden="true"></div>
    </div>
    <p class="mono" id="qr-status" style="margin:8px 0">Camera idle</p>
    <div class="job-actions" style="margin-top:8px">
      <button type="button" class="btn btn-teal btn-sm" id="qr-start">Start camera scan</button>
      <button type="button" class="btn btn-ghost btn-sm" id="qr-stop">Stop</button>
    </div>
    <div class="field" style="margin-top:12px">
      <label style="font-size:11px;color:var(--muted)">Or upload photo of tote-bag QR</label>
      <input type="file" id="qr-file" accept="image/*" capture="environment" style="width:100%;margin-top:6px;color:#cfd6e2" />
    </div>
  `;
  actions.appendChild(panel);

  qs('#qr-start').addEventListener('click', () => startCameraScan(order));
  qs('#qr-stop').addEventListener('click', () => {
    stopScanner();
    qs('#qr-status').textContent = 'Camera stopped';
  });
  qs('#qr-file').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) scanImageFile(order, f);
  });

  const refuse = document.createElement('button');
  refuse.type = 'button';
  refuse.className = 'ho-big refuse';
  refuse.style.marginTop = '12px';
  refuse.textContent = 'REFUSE — SEAL / TOTE-BAG QR FAIL · FULL REFUND';
  refuse.addEventListener('click', () => {
    stopScanner();
    doAction(order.id, 'refuse');
  });
  actions.appendChild(refuse);

  const locked = document.createElement('div');
  locked.className = 'ho-locked';
  locked.textContent = 'Cancel closed after pickup · Accept only via tote-bag QR match';
  actions.appendChild(locked);
}

async function ensureDetector() {
  if (detector) return detector;
  if ('BarcodeDetector' in window) {
    try {
      detector = new BarcodeDetector({ formats: ['qr_code'] });
      return detector;
    } catch (_) {}
  }
  return null;
}

async function startCameraScan(order) {
  const status = qs('#qr-status');
  const video = qs('#qr-video');
  try {
    stopScanner();
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    video.srcObject = mediaStream;
    await video.play();
    status.textContent = 'Scanning… aim at the QR on your tote bag';
    const det = await ensureDetector();
    if (!det) {
      status.textContent = 'BarcodeDetector unavailable — upload a photo of the tote-bag QR';
      return;
    }
    const tick = async () => {
      if (!mediaStream) return;
      try {
        const codes = await det.detect(video);
        if (codes && codes.length) {
          const raw = codes[0].rawValue || '';
          status.textContent = 'QR detected — capturing proof frame…';
          const snap = captureVideoSnapshot(video);
          stopScanner();
          await acceptWithQr(order, raw, snap);
          return;
        }
      } catch (_) {}
      scanLoop = requestAnimationFrame(tick);
    };
    scanLoop = requestAnimationFrame(tick);
  } catch (err) {
    status.textContent = 'Camera blocked — upload a photo of the tote-bag QR instead';
    toast(err.message || 'Camera unavailable');
  }
}

async function scanImageFile(order, file) {
  const status = qs('#qr-status');
  status.textContent = 'Reading QR from image…';
  try {
    const bmp = await createImageBitmap(file);
    const det = await ensureDetector();
    if (det) {
      const codes = await det.detect(bmp);
      bmp.close && bmp.close();
      if (codes && codes.length) {
        const dataUrl = await fileToDataUrl(file);
        await acceptWithQr(order, codes[0].rawValue || '', dataUrl);
        return;
      }
      status.textContent = 'No QR found in image — try again';
      return;
    }
    // No BarcodeDetector: draw + note; allow demo paste from filename? Instead try jsQR via dynamic import from CDN
    const ok = await tryJsQrFromFile(file);
    bmp.close && bmp.close();
    if (ok) {
      const dataUrl = await fileToDataUrl(file);
      await acceptWithQr(order, ok, dataUrl);
      return;
    }
    status.textContent = 'Could not decode QR — try another image or camera';
  } catch (err) {
    status.textContent = err.message || 'Image scan failed';
  }
}

async function tryJsQrFromFile(file) {
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
    const img = await loadImageFromFile(file);
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

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = reject;
    img.src = url;
  });
}

function captureVideoSnapshot(video) {
  try {
    if (!video || !video.videoWidth) return null;
    const canvas = document.createElement('canvas');
    const maxW = 1280;
    const scale = Math.min(1, maxW / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch (_) {
    return null;
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function acceptWithQr(order, payload, confirmImage) {
  const status = qs('#qr-status');
  if (!confirmImage) {
    const msg = 'Need a confirmation photo of the tote QR for the shop.';
    if (status) status.textContent = msg;
    toast(msg);
    return;
  }
  try {
    const { order: o } = await api(`/api/orders/${order.id}/accept`, {
      method: 'POST',
      body: JSON.stringify({ qrPayload: payload, confirmImage }),
    });
    toast('Tote QR matched — confirmation sent to shop');
    render(o);
  } catch (err) {
    if (status) status.textContent = err.message;
    toast(err.message);
  }
}

async function doAction(id, action) {
  try {
    const { order } = await api(`/api/orders/${id}/${action}`, { method: 'POST', body: '{}' });
    toast(action === 'refuse' ? 'Full refund stub' : 'Updated');
    render(order);
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

document.addEventListener('DOMContentLoaded', () => init());
window.addEventListener('pagehide', stopScanner);
