/* Shared API helpers for VendiPort beta */
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText || 'Request failed');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function money(n) {
  return `$${Number(n).toFixed(2)}`;
}

function toast(msg, ms = 2800) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), ms);
}

function qs(sel, root = document) {
  return root.querySelector(sel);
}

function orderIdFromPath() {
  const parts = location.pathname.split('/').filter(Boolean);
  // /handoff/:orderId
  if (parts[0] === 'handoff' && parts[1]) return parts[1];
  const u = new URL(location.href);
  return u.searchParams.get('orderId') || '';
}
