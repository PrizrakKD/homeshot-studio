// Homeshot background: fetches Avito photos (no CORS limits here), dedupes, sends chosen ones to GitHub drafts.
const DEFAULTS = { owner: 'PrizrakKD', repo: 'homeshot-studio', branch: 'main', token: '' };
const cache = new Map(); // url -> {blob, w, h}

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'open-options') { chrome.runtime.openOptionsPage(); return false; }
  const run = msg.type === 'scan' ? scan(msg.urls) : msg.type === 'send' ? send(msg) : msg.type === 'settings' ? settings() : msg.type === 'quality' ? quality(msg.url) : msg.type === 'leads' ? saveLeads(msg.leads) : msg.type === 'match' ? match(msg.url, msg.urls) : null;
  if (!run) return false;
  run.then(r => reply({ ok: true, ...r }), e => reply({ ok: false, error: e.message || String(e) }));
  return true;
});

async function settings() {
  const s = await chrome.storage.local.get(DEFAULTS);
  return { configured: !!s.token, owner: s.owner, repo: s.repo };
}

async function load(url) {
  if (cache.has(url)) return cache.get(url);
  const r = await fetch(url, { credentials: 'omit' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const blob = await r.blob();
  if (!/^image\//.test(blob.type) && blob.type) throw new Error('not image');
  const bmp = await createImageBitmap(blob);
  const item = { blob, w: bmp.width, h: bmp.height, hash: aHash(bmp) };
  bmp.close();
  cache.set(url, item);
  return item;
}

function aHash(bmp) {
  const c = new OffscreenCanvas(8, 8), g = c.getContext('2d');
  g.drawImage(bmp, 0, 0, 8, 8);
  const d = g.getImageData(0, 0, 8, 8).data, v = [];
  for (let i = 0; i < 64; i++) v.push(d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11);
  const avg = v.reduce((a, b) => a + b, 0) / 64;
  return v.map(x => (x > avg ? 1 : 0));
}
const dist = (a, b) => a.reduce((n, x, i) => n + (x !== b[i]), 0);

async function thumb(blob) {
  const bmp = await createImageBitmap(blob);
  const k = 320 / Math.max(bmp.width, bmp.height);
  const c = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const b = await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
  return blobToDataUrl(b);
}

function blobToDataUrl(b) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
}

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch { out[k] = null; } } }));
  return out;
}

async function scan(urls) {
  const uniq = [...new Set(urls)].slice(0, 160);
  const loaded = await pool(uniq, 6, load);
  const groups = [];
  uniq.forEach((url, i) => {
    const it = loaded[i];
    if (!it || Math.min(it.w, it.h) < 300) return;
    const g = groups.find(x => dist(x.hash, it.hash) <= 6 && Math.abs(x.w / x.h - it.w / it.h) < 0.08);
    if (!g) groups.push({ url, hash: it.hash, w: it.w, h: it.h, order: i });
    else if (it.w * it.h > g.w * g.h) Object.assign(g, { url, w: it.w, h: it.h });
  });
  groups.sort((a, b) => a.order - b.order);
  const photos = await Promise.all(groups.map(async g => ({ url: g.url, w: g.w, h: g.h, thumb: await thumb(cache.get(g.url).blob) })));
  return { photos };
}

async function toJpegB64(blob) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
  const c = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const jpg = await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  return (await blobToDataUrl(jpg)).split(',')[1];
}
function textB64(s) { return btoa(String.fromCharCode(...new TextEncoder().encode(s))); }

async function gh(s, path, opts = {}) {
  const r = await fetch(`https://api.github.com/repos/${s.owner}/${s.repo}${path}`, {
    method: opts.method || 'GET',
    headers: { Authorization: 'Bearer ' + s.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) throw new Error('GitHub-токен не подходит. Обновите его в настройках расширения.');
    if (r.status === 403 || r.status === 404) throw new Error('У токена нет доступа на запись к репозиторию.');
    throw new Error('GitHub: ' + (j.message || r.status));
  }
  return r.json();
}

function slug(s) {
  const TR = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
  return (s || '').toLowerCase().split('').map(c => TR[c] ?? c).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'avito';
}

// Cover photo check for the scout. Pixel statistics separate only robust cases (dark, vertical);
// whether photos are really "good" is judged later by a person or Claude.
const qcache = new Map();
async function quality(url) {
  if (qcache.has(url)) return { q: qcache.get(url) };
  const r = await fetch(url, { credentials: 'omit' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const bmp = await createImageBitmap(await r.blob());
  const k = 160 / Math.max(bmp.width, bmp.height), w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = new OffscreenCanvas(w, h), g = c.getContext('2d'); g.drawImage(bmp, 0, 0, w, h);
  const vertical = bmp.height > bmp.width * 1.1; bmp.close();
  const d = g.getImageData(0, 0, w, h).data; let sum = 0; const n = w * h;
  for (let i = 0; i < d.length; i += 4) sum += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
  const mean = sum / n;
  const q = { mean: Math.round(mean), dark: mean < 105, vertical };
  qcache.set(url, q);
  return { q };
}

async function commitFiles(s, files, message) {
  const ref = await gh(s, `/git/ref/heads/${s.branch}`);
  const head = ref.object.sha;
  const commit = await gh(s, `/git/commits/${head}`);
  const tree = [];
  for (const f of files) {
    const b = await gh(s, '/git/blobs', { method: 'POST', body: { content: f.b64, encoding: 'base64' } });
    tree.push({ path: f.path, mode: '100644', type: 'blob', sha: b.sha });
  }
  const t = await gh(s, '/git/trees', { method: 'POST', body: { base_tree: commit.tree.sha, tree } });
  const c = await gh(s, '/git/commits', { method: 'POST', body: { message, tree: t.sha, parents: [head] } });
  await gh(s, `/git/refs/heads/${s.branch}`, { method: 'PATCH', body: { sha: c.sha } });
}

async function saveLeads(list) {
  const s = await chrome.storage.local.get(DEFAULTS);
  if (!s.token) throw new Error('Сначала укажите GitHub-токен в настройках расширения.');
  const files = [];
  for (const l of list) {
    const { state, ...rest } = l;
    const saved = [];
    for (let i = 0; i < (l.gallery || []).length; i++) {
      try {
        const r = await fetch(l.gallery[i], { credentials: 'omit' });
        if (!r.ok) continue;
        const path = `leads/${l.id}/${String(i + 1).padStart(2, '0')}.jpg`;
        files.push({ path, b64: await toJpegB64(await r.blob()) });
        saved.push(path);
      } catch (e) { /* skip photo */ }
    }
    files.push({ path: `leads/${l.id}.json`, b64: textB64(JSON.stringify({ ...rest, photoFiles: saved, status: 'new', sent: new Date().toISOString() }, null, 2) + '\n') });
  }
  await commitFiles(s, files, list.length === 1 ? `Лид: ${list[0].title}` : `Лиды: ${list.length} шт.`);
  return {};
}

// Admin "take this photo": find the gallery photo on the listing page that matches the lead photo.
async function match(url, urls) {
  const ref = await load(url);
  let best = -1, bd = 99;
  urls.forEach((u, i) => { const it = cache.get(u); if (!it) return; const d = dist(ref.hash, it.hash); if (d < bd) { bd = d; best = i; } });
  return { index: bd <= 12 ? best : -1 };
}

async function send({ urls, title, address, pageUrl }) {
  const s = await chrome.storage.local.get(DEFAULTS);
  if (!s.token) throw new Error('Сначала укажите GitHub-токен в настройках расширения.');
  if (!urls.length) throw new Error('Не выбрано ни одного фото.');
  const d = new Date();
  const stamp = d.toISOString().slice(0, 10) + '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
  const id = `${stamp}-${slug(title)}`;
  const files = [];
  for (let i = 0; i < urls.length; i++) {
    const it = await load(urls[i]);
    files.push({ path: `drafts/${id}/src/${String(i + 1).padStart(2, '0')}.jpg`, b64: await toJpegB64(it.blob) });
  }
  const meta = { title: title || 'Объявление', address: address || '', url: pageUrl, created: d.toISOString(), photos: urls.length };
  files.push({ path: `drafts/${id}/meta.json`, b64: textB64(JSON.stringify(meta, null, 2) + '\n') });

  const ref = await gh(s, `/git/ref/heads/${s.branch}`);
  const head = ref.object.sha;
  const commit = await gh(s, `/git/commits/${head}`);
  const tree = [];
  for (const f of files) {
    const b = await gh(s, '/git/blobs', { method: 'POST', body: { content: f.b64, encoding: 'base64' } });
    tree.push({ path: f.path, mode: '100644', type: 'blob', sha: b.sha });
  }
  const t = await gh(s, '/git/trees', { method: 'POST', body: { base_tree: commit.tree.sha, tree } });
  const c = await gh(s, '/git/commits', { method: 'POST', body: { message: `Черновик с Авито: ${meta.title}`, tree: t.sha, parents: [head] } });
  await gh(s, `/git/refs/heads/${s.branch}`, { method: 'PATCH', body: { sha: c.sha } });
  return { id, admin: `https://${s.owner.toLowerCase()}.github.io/${s.repo}/admin.html` };
}
