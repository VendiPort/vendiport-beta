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
          Look at the bag first. <strong>Do not accept if the bag looks tampered.</strong> Then scan or upload a photo of the
          <strong>QR printed on your tote bag</strong> — it must match the tote QR from the shop’s pack photo
          (last-4 ${order.last4}). That photo goes to the shop as drop-off proof.
        </p>
      </div>

      <div id="actions"></div>
      <div class="panel accept-rule" style="margin-top:10px"><div class="panel-label">Before you accept</div>
        <p style="font-size:12px;color:var(--muted);margin:0;line-height:1.45">${VPX.ACCEPT_RULE}</p></div>
      <div id="evidence-host"></div>
    </div>
    <p class="footer-note">Keep tote secured until tote-bag QR accept.</p>
  `;

  const actions = qs('#actions');
  if (VPX.renderEvidence) VPX.renderEvidence(qs('#evidence-host'), order);

  if (done) {
    if (order.status === 'DELIVERED_ACCEPTED') {
      actions.innerHTML = `<div class="banner ok">Tote-bag QR matched · Accepted — sale final.${order.qrVerified ? ' ✓' : ''}</div>
        ${order.confirmImage ? `<div class="panel" style="margin-top:10px"><div class="panel-label">Your confirmation photo (sent to shop)</div>
        <img src="${escapeHtml(order.confirmImage)}" alt="Confirmation" style="width:100%;max-height:220px;object-fit:cover;border-radius:10px;margin-top:6px" />
        <div class="mono" style="margin-top:6px">${escapeHtml(order.confirmedAt || '')}</div></div>` : ''}
        <div class="panel" style="margin-top:10px"><div class="panel-label">After the rip</div>
          <p class="vp-hint" style="margin:0 0 10px">Delivered and sealed ✓ — rate the order and add your box break to My Collection.</p>
          <a class="vp-btn block" style="display:block;text-align:center;text-decoration:none" href="/track/${order.id}">⭐ Rate shop &amp; delivery</a>
          <a class="vp-btn purple block" style="display:block;text-align:center;text-decoration:none;margin-top:8px" href="/collection?order=${order.id}">▶ Add my box break (any social link)</a>
          <a class="vp-btn ghost block" style="display:block;text-align:center;text-decoration:none;margin-top:8px" href="/collection">▣ My Collection</a></div>`;
    } else if (order.status === 'REFUSED_SEAL') {
      actions.innerHTML = `<div class="banner warn">Refused — bag looked tampered. Full refund issued. Return the tote to the courier/shop.</div>${order.claim ? `<div class="panel" style="margin-top:10px"><div class="panel-label">Your report</div><p class="vp-hint" style="margin:0">VendiPort keeps the report with the photos and scan records for this order. <a href="/track/${order.id}">View order status</a></p></div>` : ''}`;
    } else {
      actions.innerHTML = '<div class="banner warn">Order cancelled.</div>';
    }
    return;
  }

  if (order.disputeOpen) {
    actions.innerHTML = `<div class="banner warn">Report open — VendiPort is reviewing the records for this order. <a href="/track/${order.id}">View order status</a></div>
      <div class="panel" style="margin-top:10px"><div class="panel-label">What happens next</div><p class="vp-hint" style="margin:0">1. We compare photos &amp; timestamps · 2. You get a refund or a replacement · 3. You’ll see the result in your order status. Keep the tote and don’t open it.</p>
      <a class="vp-btn ghost block" style="display:block;text-align:center;text-decoration:none;margin-top:10px" href="/track/${order.id}">View order status</a></div>`;
    return;
  }
  if (!canDecide) {
    const msg = order.status === 'PICKED_UP' && !order.arrivePhotoStub
      ? 'Waiting for arrive photo stub to unlock tote-bag QR accept.'
      : `Handoff unlocks after pickup (+ arrive photo). Now: ${escapeHtml(order.status)}`;
    actions.innerHTML = `<div class="banner warn">${msg}</div>`;
    if (order.status === 'PICKED_UP' && !order.arrivePhotoStub) {
      const dc = document.createElement('div');
      dc.className = 'panel'; dc.style.marginTop = '10px';
      dc.innerHTML = `<div class="panel-label">Handoff proof · delivery code</div>${order.deliveryCode ? `<div class="vp-code"><div class="cap">Your delivery code</div><div class="num">${escapeHtml(order.deliveryCode)}</div></div>` : ''}<p class="vp-hint" style="margin:0 0 8px">Courier: enter the buyer’s 4-digit code, or take photo proof of the tote at the door.</p><div class="vp-row"><input class="vp-input" id="ho-code" inputmode="numeric" maxlength="4" placeholder="Enter code" /><button type="button" class="vp-btn" id="ho-code-go">Verify</button></div><button type="button" class="vp-btn ghost block sm" id="ho-photo" style="margin-top:8px">📷 Photo proof instead</button><input type="file" id="ho-file" accept="image/*" capture="environment" class="hidden" />`;
      actions.appendChild(dc);
      dc.querySelector('#ho-code-go').addEventListener('click', async () => {
        try { const r = await api(`/api/orders/${order.id}/arrive-proof`, { method: 'POST', body: JSON.stringify({ code: dc.querySelector('#ho-code').value.trim() }) }); toast('Delivery code verified'); render(r.order); } catch (e) { toast(e.message); }
      });
      dc.querySelector('#ho-photo').addEventListener('click', () => dc.querySelector('#ho-file').click());
      dc.querySelector('#ho-file').addEventListener('change', async (ev) => {
        const f = ev.target.files && ev.target.files[0]; if (!f) return;
        const url = await fileToDataUrl(f);
        try { const r = await api(`/api/orders/${order.id}/arrive-proof`, { method: 'POST', body: JSON.stringify({ photo: url }) }); toast('Photo proof saved'); render(r.order); } catch (e) { toast(e.message); }
      });
      const stub = document.createElement('button');
      stub.type = 'button';
      stub.className = 'btn btn-teal btn-block';
      stub.style.marginTop = '10px';
      stub.textContent = 'Simulate arrive photo (stub)';
      stub.classList.add('hidden');
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
      <button type="button" class="btn btn-ghost btn-sm" id="qr-tap">Tap to scan tote QR</button>
    </div>
    <div class="field" style="margin-top:12px">
      <label style="font-size:11px;color:var(--muted)">Or upload photo of tote-bag QR</label>
      <input type="file" id="qr-file" accept="image/*" capture="environment" style="width:100%;margin-top:6px;color:#cfd6e2" />
    </div>
  `;
  actions.appendChild(panel);

  qs('#qr-start').addEventListener('click', () => startCameraScan(order));
  qs('#qr-tap').addEventListener('click', () => tapScanStub(order));
  qs('#qr-stop').addEventListener('click', () => {
    stopScanner();
    qs('#qr-status').textContent = 'Camera stopped';
  });
  qs('#qr-file').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) scanImageFile(order, f);
  });

  const acceptNote = document.createElement('div');
  acceptNote.className = 'banner warn';
  acceptNote.style.marginTop = '12px';
  acceptNote.innerHTML = '<b>Do not accept if the bag looks tampered.</b> By accepting, you acknowledge receipt of the order in sealed condition and that the sale is final.';
  actions.appendChild(acceptNote);
  const refuse = document.createElement('button');
  refuse.type = 'button';
  refuse.className = 'ho-big refuse';
  refuse.style.marginTop = '12px';
  refuse.textContent = 'BAG LOOKS TAMPERED — DON’T ACCEPT';
  refuse.addEventListener('click', () => { stopScanner(); openRefuseSheet(order); });
  actions.appendChild(refuse);
  const refuseSub = document.createElement('p');
  refuseSub.className = 'vp-hint';
  refuseSub.style.textAlign = 'center';
  refuseSub.textContent = 'Refuse / Report — full refund. Your note and photo are optional.';
  actions.appendChild(refuseSub);

  const locked = document.createElement('div');
  locked.className = 'ho-locked';
  locked.textContent = 'Cancel closed after pickup · Accept happens when the tote-bag QR matches';
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
  if (status) status.textContent = 'QR captured — accepting…';
  await submitAccept(order, payload, confirmImage);
}

/** Refuse / Report: the bag looks tampered. Full refund + a dispute record (optional note and photo). */
function openRefuseSheet(order) {
  const body = VPX.openSheet('Bag looks tampered', 'Refuse the delivery — you are refunded in full', `
    <div class="vp-seal-q">
      <div style="font-size:38px">🛡️</div>
      <p class="vp-hint" style="margin:0">If the tear strip is pulled, the seal is lifted, or the bag looks opened, do not accept it. Choose <b>Refuse / Report</b> and you’ll be refunded in full. VendiPort keeps your report with the photos and scan records for this order.</p>
      <div style="text-align:left;margin-top:12px"><label class="vp-lbl">What did you see? (optional)</label><textarea class="vp-textarea" id="rf-note" placeholder="Tear strip pulled, seal lifted…"></textarea>
      <label class="vp-lbl" style="margin-top:8px">Photo (optional)</label><input type="file" id="rf-file" accept="image/*" capture="environment" class="vp-input" />
      <button type="button" class="vp-btn red block" id="rf-go" style="margin-top:10px">Refuse / Report — full refund</button>
      <button type="button" class="vp-btn ghost block" id="rf-x" style="margin-top:6px">Cancel</button></div>
    </div>`);
  body.querySelector('#rf-x').addEventListener('click', () => VPX.closeSheet());
  body.querySelector('#rf-go').addEventListener('click', async () => {
    const f = body.querySelector('#rf-file').files && body.querySelector('#rf-file').files[0];
    const photo = f ? await fileToDataUrl(f) : null;
    try {
      const r = await api(`/api/orders/${order.id}/refuse`, { method: 'POST', body: JSON.stringify({ note: body.querySelector('#rf-note').value, photo }) });
      VPX.closeSheet(); toast('Refused — full refund issued'); render(r.order);
    } catch (e) { toast(e.message); }
  });
}

async function submitAccept(order, payload, confirmImage) {
  const status = qs('#qr-status');
  try {
    const r = await api(`/api/orders/${order.id}/accept`, {
      method: 'POST',
      body: JSON.stringify({ qrPayload: payload, confirmImage }),
    });
    toast('Tote QR matched — accepted');
    render(r.order);
  } catch (err) {
    if (status) status.textContent = err.message;
    toast(err.message);
  }
}

/** Tap-to-scan stub: uses the order's tote QR and draws a proof frame (for demos / no camera). */
async function tapScanStub(order) {
  const c = document.createElement('canvas');
  c.width = 480; c.height = 320;
  const x = c.getContext('2d');
  x.fillStyle = '#0b1114'; x.fillRect(0, 0, 480, 320);
  x.fillStyle = '#4fd1c5'; x.font = 'bold 22px sans-serif'; x.fillText('Tote QR proof (tap scan stub)', 24, 50);
  x.fillStyle = '#fff'; x.font = '16px monospace'; x.fillText(String(order.toteQrPayload || '').slice(0, 44), 24, 90);
  x.fillStyle = '#8b95a8'; x.fillText('Last-4 ' + order.last4 + ' · ' + new Date().toLocaleString(), 24, 120);
  for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) { if ((i * 7 + j * 13 + i * j) % 3) { x.fillStyle = '#fff'; x.fillRect(300 + i * 14, 150 + j * 14, 12, 12); } }
  await acceptWithQr(order, order.toteQrPayload, c.toDataURL('image/jpeg', 0.8));
}

async function doAction(id, action) {
  try {
    const { order } = await api(`/api/orders/${id}/${action}`, { method: 'POST', body: '{}' });
    toast('Updated');
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
