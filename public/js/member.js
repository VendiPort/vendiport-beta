function hideAll() {
  ['#view-hub', '#view-join', '#view-login', '#view-create', '#view-status'].forEach((sel) => {
    const el = qs(sel);
    if (el) el.classList.add('hidden');
  });
}

function paintMemberStream(key) {
  renderProcessStream(qs('#member-stream'), MEMBER_STREAM, key);
}

function showHub() {
  hideAll();
  qs('#view-hub').classList.remove('hidden');
  paintMemberStream(isMember() ? 'member' : 'account');
}

function showJoin() {
  hideAll();
  qs('#view-join').classList.remove('hidden');
  paintMemberStream('join');
}

function showLogin() {
  hideAll();
  qs('#view-login').classList.remove('hidden');
  paintMemberStream('auth');
}

function showCreate() {
  hideAll();
  qs('#view-create').classList.remove('hidden');
  paintMemberStream('auth');
}

function showStatus() {
  hideAll();
  qs('#view-status').classList.remove('hidden');
  const s = getMemberSession();
  qs('#status-contact').textContent = (s && s.contact) || 'Member';
  paintMemberStream('member');
}

function route() {
  renderAccountChip();
  const hash = (location.hash || '#hub').replace('#', '') || 'hub';
  if (isMember() && !['join', 'login', 'create'].includes(hash)) {
    showStatus();
    return;
  }
  if (hash === 'login') showLogin();
  else if (hash === 'create') showCreate();
  else if (hash === 'join') showJoin();
  else if (hash === 'hub' || hash === '') showHub();
  else showHub();
}

document.addEventListener('DOMContentLoaded', () => {
  route();
  window.addEventListener('hashchange', route);

  qs('#join-pay').addEventListener('click', () => {
    const contact = qs('#join-contact').value.trim();
    if (!contact) return toast('Enter phone or email');
    setMemberSession({ contact, member: true, plan: '1.99/mo' });
    toast('Member activated (stub) — first month free');
    paintMemberStream('machine');
    setTimeout(() => { location.href = '/'; }, 400);
  });

  qs('#login-go').addEventListener('click', () => {
    const contact = qs('#login-contact').value.trim();
    if (!contact) return toast('Enter phone or email');
    setMemberSession({ contact, member: true, plan: '1.99/mo' });
    toast('Signed in as Member');
    location.href = '/';
  });

  qs('#create-go').addEventListener('click', () => {
    const contact = qs('#create-contact').value.trim();
    if (!contact) return toast('Enter phone or email');
    qs('#join-contact').value = contact;
    location.hash = '#join';
    toast('Account created (demo) — join membership next');
  });

  qs('#status-out').addEventListener('click', () => {
    clearMemberSession();
    toast('Signed out');
    location.hash = '#hub';
    route();
  });
});
