'use strict';
// Shared helpers for VendiPort beta extras (matching, platform detection, dates).
const STOP = new Set(['rc', 'rookie', 'card', 'cards', 'box', 'the', 'a', 'of', 'and', 'auto', 'autograph', 'sealed']);

function toks(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t && !STOP.has(t));
}
function keyOf(label) {
  return toks(label).join(' ');
}
function matchLabelToText(label, text) {
  const t = toks(label);
  if (!t.length) return false;
  const h = ' ' + toks(text).join(' ') + ' ';
  return t.every((x) => h.includes(' ' + x + ' '));
}
function productHay(p) {
  return [p.title].concat((p.chaseTop3 || []).map((c) => c.name));
}
function matchesProduct(entry, p) {
  if (!entry || !p) return false;
  if (entry.productId && entry.kind === 'box') return entry.productId === p.id;
  return productHay(p).some((h) => matchLabelToText(entry.label, h));
}
function totalUnits(p) {
  return (p.windows || []).reduce((s, w) => s + (Number(w.units) || 0), 0);
}
function setNameOf(title) {
  return String(title || '').replace(/\s+(Football|Baseball|Basketball|Hockey|Wrestling)$/i, '').trim();
}
function zip5(z) {
  const m = String(z || '').match(/\d{5}/);
  return m ? m[0] : '';
}
function isoDay(d) {
  const x = new Date(d);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
}
function uid(p) {
  return p + '_' + require('crypto').randomBytes(5).toString('hex');
}
function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Social platform detection for break links ----
const PLATFORMS = {
  youtube: { label: 'YouTube', icon: '▶', color: '#ff3d3d' },
  tiktok: { label: 'TikTok', icon: '♪', color: '#25f4ee' },
  instagram: { label: 'Instagram', icon: '◎', color: '#ff5fa2' },
  facebook: { label: 'Facebook', icon: 'f', color: '#5b8dff' },
  x: { label: 'X', icon: '𝕏', color: '#e8eef5' },
  twitch: { label: 'Twitch', icon: '◈', color: '#a970ff' },
  vimeo: { label: 'Vimeo', icon: 'V', color: '#1ab7ea' },
  reddit: { label: 'Reddit', icon: '●', color: '#ff7a3d' },
  kick: { label: 'Kick', icon: 'K', color: '#53fc18' },
  link: { label: 'Link', icon: '↗', color: '#8b95a8' },
};

function parseBreakUrl(raw) {
  const input = String(raw || '').trim();
  if (!input) return { error: 'Paste a link to your break video' };
  if (input.length > 500) return { error: 'Link is too long' };
  let u;
  try {
    u = new URL(/^https?:\/\//i.test(input) ? input : 'https://' + input);
  } catch (_) {
    return { error: 'That does not look like a valid link' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'Only http(s) links are allowed' };
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.|mobile\.)/, '');
  if (!host.includes('.') || /\s/.test(host)) return { error: 'That does not look like a valid link' };
  if (/^(localhost|127\.|10\.|192\.168\.|0\.)/.test(host)) return { error: 'Use a public social link' };
  u.protocol = 'https:';
  let platform = 'link';
  let embed = null;
  let id = null;
  const p = u.pathname;
  if (host === 'youtu.be' || host.endsWith('youtube.com') || host === 'youtube-nocookie.com') {
    platform = 'youtube';
    if (host === 'youtu.be') id = p.split('/')[1];
    else if (p.startsWith('/shorts/') || p.startsWith('/embed/') || p.startsWith('/live/')) id = p.split('/')[2];
    else if (p === '/watch') id = u.searchParams.get('v');
    if (!id || !/^[\w-]{6,15}$/.test(id)) return { error: 'That YouTube link has no video id' };
    embed = 'https://www.youtube-nocookie.com/embed/' + id;
  } else if (host.endsWith('tiktok.com') || host === 'vm.tiktok.com') {
    platform = 'tiktok';
    const m = p.match(/\/video\/(\d{8,25})/);
    if (m) { id = m[1]; embed = 'https://www.tiktok.com/embed/v2/' + id; }
  } else if (host.endsWith('instagram.com') || host === 'instagr.am') {
    platform = 'instagram';
    const m = p.match(/\/(p|reel|reels|tv)\/([\w-]+)/);
    if (m) { id = m[2]; embed = 'https://www.instagram.com/' + (m[1] === 'reels' ? 'reel' : m[1]) + '/' + id + '/embed'; }
  } else if (host.endsWith('facebook.com') || host === 'fb.watch' || host === 'fb.com') {
    platform = 'facebook';
  } else if (host === 'x.com' || host.endsWith('twitter.com') || host === 'x.com') {
    platform = 'x';
  } else if (host.endsWith('twitch.tv')) {
    platform = 'twitch';
    if (host === 'clips.twitch.tv') { id = p.split('/')[1]; }
    else { const m = p.match(/\/clip\/([\w-]+)/); if (m) id = m[1]; else { const v = p.match(/\/videos\/(\d+)/); if (v) { id = 'v' + v[1]; } } }
    if (id && id[0] !== 'v') embed = 'twitch-clip:' + id; // client adds parent host
    else if (id) embed = 'twitch-video:' + id.slice(1);
  } else if (host.endsWith('vimeo.com')) {
    platform = 'vimeo';
    const m = p.match(/\/(\d{6,12})/);
    if (m) { id = m[1]; embed = 'https://player.vimeo.com/video/' + id; }
  } else if (host.endsWith('reddit.com') || host === 'redd.it') {
    platform = 'reddit';
  } else if (host.endsWith('kick.com')) {
    platform = 'kick';
  }
  const meta = PLATFORMS[platform];
  return {
    url: u.toString(),
    host,
    platform,
    platformLabel: meta.label,
    platformIcon: meta.icon,
    platformColor: meta.color,
    embed,
    videoId: id,
    thumb: platform === 'youtube' ? 'https://img.youtube.com/vi/' + id + '/hqdefault.jpg' : null,
    embeddable: !!embed,
  };
}

module.exports = {
  toks, keyOf, matchLabelToText, matchesProduct, totalUnits, setNameOf, zip5, isoDay, uid, mulberry,
  parseBreakUrl, PLATFORMS,
};
