/* Demo account session — localStorage only (no real auth/Stripe) */
const VP_SESSION_KEY = 'vendiport_member_v1';

function getMemberSession() {
  try {
    const raw = localStorage.getItem(VP_SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !s.member) return null;
    return s;
  } catch {
    return null;
  }
}

function isMember() {
  const s = getMemberSession();
  return !!(s && s.member);
}

function setMemberSession({ contact, member, plan }) {
  const payload = {
    member: !!member,
    contact: String(contact || '').trim(),
    plan: plan || '1.99/mo',
    firstMonthFree: true,
    joinedAt: new Date().toISOString(),
  };
  localStorage.setItem(VP_SESSION_KEY, JSON.stringify(payload));
  return payload;
}

function clearMemberSession() {
  localStorage.removeItem(VP_SESSION_KEY);
}

function memberInitial() {
  const s = getMemberSession();
  if (!s || !s.member) return '?';
  const c = (s.contact || 'M').trim();
  if (c.includes('@')) return (c[0] || 'M').toUpperCase();
  const digits = c.replace(/\D/g, '');
  if (digits.length) return digits.slice(-1);
  return (c[0] || 'M').toUpperCase();
}

function memberLabel() {
  const s = getMemberSession();
  if (!s || !s.member) return null;
  const c = s.contact || '';
  if (c.includes('@')) return c.split('@')[0];
  if (c.length >= 4) return '••' + c.slice(-4);
  return 'Member';
}

/** Top-right account avatar — OfferUp / Mercari / eBay style */
function renderAccountChip(root = document) {
  const nodes = root.querySelectorAll('#account-chip, .account-chip');
  nodes.forEach((el) => {
    if (isMember()) {
      const initial = memberInitial();
      el.innerHTML = `
        <a class="acct-avatar member" href="/account" title="Account · Member" aria-label="Account">
          <span class="acct-initial">${escapeAttr(initial)}</span>
          <span class="acct-badge">Member</span>
        </a>`;
    } else {
      el.innerHTML = `
        <a class="acct-avatar guest" href="/account" title="Account · Sign in" aria-label="Account">
          <span class="acct-glyph" aria-hidden="true">👤</span>
        </a>`;
    }
  });
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Horizontal process stream / stepper */
function renderProcessStream(container, steps, currentKey) {
  if (!container) return;
  const idx = steps.findIndex((s) => s.key === currentKey);
  container.innerHTML = '';
  container.classList.add('vp-stream');
  const track = document.createElement('div');
  track.className = 'vp-stream-track';
  steps.forEach((s, i) => {
    const cell = document.createElement('div');
    let cls = 'vp-stream-step';
    if (idx < 0) cls += '';
    else if (i < idx) cls += ' done';
    else if (i === idx) cls += ' current';
    else cls += ' todo';
    if (s.fail) cls += ' fail';
    cell.className = cls;
    cell.innerHTML = `<span class="dot">${i < idx ? '✓' : i + 1}</span><span class="lbl">${s.label}</span>`;
    track.appendChild(cell);
    if (i < steps.length - 1) {
      const rail = document.createElement('div');
      rail.className = 'vp-stream-rail' + (i < idx ? ' on' : '');
      track.appendChild(rail);
    }
  });
  container.appendChild(track);
}

const BUYER_STREAM = [
  { key: 'browse', label: 'Browse' },
  { key: 'select', label: 'Select' },
  { key: 'checkout', label: 'Checkout' },
  { key: 'paid', label: 'Paid' },
  { key: 'pack', label: 'In pack' },
  { key: 'ready', label: 'Ready' },
  { key: 'delivery', label: 'Out' },
  { key: 'arrive', label: 'Arrive' },
  { key: 'accept', label: 'Tote QR' },
];

const SHOP_STREAM = [
  { key: 'PAID', label: 'PAID' },
  { key: 'PACKING', label: 'Pack photo' },
  { key: 'READY', label: 'Seal' },
  { key: 'AWAIT', label: 'Await pickup' },
  { key: 'PICKED_UP', label: 'Picked up' },
  { key: 'DONE', label: 'Done' },
];

const MEMBER_STREAM = [
  { key: 'browse', label: 'Browse guest' },
  { key: 'account', label: 'Account' },
  { key: 'auth', label: 'Sign in / Create' },
  { key: 'join', label: 'Join $1.99' },
  { key: 'member', label: 'Paid member' },
  { key: 'machine', label: 'Machine' },
];

function buyerStreamKeyFromOrder(order) {
  if (!order) return 'paid';
  const st = order.status;
  if (st === 'CANCELLED') return 'paid';
  if (st === 'DELIVERED_ACCEPTED') return 'accept';
  if (st === 'REFUSED_SEAL') return 'accept';
  if (st === 'PICKED_UP') return order.arrivePhotoStub ? 'arrive' : 'delivery';
  if (st === 'READY') return 'ready';
  if (st === 'PACKING') return 'pack';
  if (st === 'PAID') return 'paid';
  return 'paid';
}

function shopStreamKeyFromOrder(order) {
  const st = order.status;
  if (st === 'DELIVERED_ACCEPTED' || st === 'REFUSED_SEAL') return 'DONE';
  if (st === 'PICKED_UP') return 'PICKED_UP';
  if (st === 'READY') return 'AWAIT';
  if (st === 'PACKING') return 'PACKING';
  if (st === 'PAID') return 'PAID';
  if (st === 'CANCELLED') return 'PAID';
  return 'PAID';
}
