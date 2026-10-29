// Processes drafts/<id>/: sends each src photo to Higgsfield, saves variants to gen/, writes status.json.
// Env: HF_KEY_ID, HF_KEY_SECRET (secrets); HF_MODEL_PATH, HF_BODY, HF_PROMPT, HF_VARIANTS (repo variables, optional).
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.HF_API_BASE || 'https://api.higgsfield.ai';
const ROOT = path.join(process.cwd(), 'drafts');
const KEY = process.env.HF_KEY_ID && process.env.HF_KEY_SECRET ? `Key ${process.env.HF_KEY_ID}:${process.env.HF_KEY_SECRET}` : '';
const MODEL = (process.env.HF_MODEL_PATH || '').replace(/^\/+|\/+$/g, '');
const VARIANTS = Math.max(1, Math.min(4, Number(process.env.HF_VARIANTS) || 2));
const PROMPT = process.env.HF_PROMPT || [
  'Transform the reference photo into a professional real estate interior photograph of this exact same room.',
  'Strictly preserve the layout: walls, windows, doors, floor, ceiling, built-in furniture, kitchen units, appliances and all main furniture stay in the same positions, shapes and colors.',
  'Camera: full-frame wide-angle lens, eye level, perfectly vertical lines, balanced composition.',
  'Lighting: warm cozy evening light, all lamps switched on with a warm glow, soft natural fill, balanced HDR exposure, no blown highlights.',
  'Styling: remove clutter, cables and personal items; beds neatly made with neutral linen; at most one plant and a few books as decor.',
  'Photorealistic, sharp, interior design magazine quality, no people, no text, no watermark.'
].join(' ');
const BODY = process.env.HF_BODY || JSON.stringify({
  prompt: '{{prompt}}',
  input_images: [{ type: 'image_url', image_url: '{{image_url}}' }],
  aspect_ratio: '1:1',
  num_images: '{{num_images}}'
});

const now = () => new Date().toISOString();
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function fill(tpl, vars) {
  if (typeof tpl === 'string') {
    const whole = tpl.match(/^\{\{(\w+)\}\}$/);
    if (whole) return vars[whole[1]];
    return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k]));
  }
  if (Array.isArray(tpl)) return tpl.map(t => fill(t, vars));
  if (tpl && typeof tpl === 'object') return Object.fromEntries(Object.entries(tpl).map(([k, v]) => [k, fill(v, vars)]));
  return tpl;
}

async function hf(pathname, opts = {}) {
  const r = await fetch(pathname.startsWith('http') ? pathname : API + pathname, {
    ...opts, headers: { Authorization: KEY, 'Content-Type': 'application/json', Accept: 'application/json', ...(opts.headers || {}) }
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!r.ok) throw new Error(`Higgsfield ${r.status}: ${(json.detail && JSON.stringify(json.detail)) || json.message || text.slice(0, 300)}`);
  return json;
}

async function upload(file) {
  const u = await hf('/files/generate-upload-url', { method: 'POST', body: JSON.stringify({ content_type: 'image/jpeg' }) });
  const put = await fetch(u.upload_url, { method: 'PUT', headers: u.upload_headers || { 'Content-Type': 'image/jpeg' }, body: fs.readFileSync(file) });
  if (!put.ok) throw new Error(`Загрузка в Higgsfield не удалась: ${put.status}`);
  return u.public_url;
}

function outputUrls(s) {
  const list = s.images || s.output?.images || s.outputs || s.result?.images || [];
  return list.map(i => (typeof i === 'string' ? i : i.url)).filter(Boolean);
}

async function generate(file) {
  const imageUrl = await upload(file);
  const body = fill(JSON.parse(BODY), { prompt: PROMPT, image_url: imageUrl, num_images: VARIANTS });
  const sub = await hf('/' + MODEL, { method: 'POST', body: JSON.stringify(body) });
  const statusUrl = sub.status_url || `/requests/${sub.request_id}/status`;
  const deadline = Date.now() + 8 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(Number(process.env.HF_POLL_MS||5000));
    const s = await hf(statusUrl);
    if (s.status === 'completed') {
      const urls = outputUrls(s);
      if (!urls.length) throw new Error('Higgsfield вернул пустой результат: ' + JSON.stringify(s).slice(0, 300));
      return urls;
    }
    if (['failed', 'nsfw', 'canceled'].includes(s.status)) throw new Error(`Higgsfield: ${s.status}${s.error ? ' (' + s.error + ')' : ''}`);
  }
  throw new Error('Higgsfield не успел за 8 минут');
}

async function download(url, to) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Не скачался результат: ${r.status}`);
  fs.writeFileSync(to, Buffer.from(await r.arrayBuffer()));
}

if (!fs.existsSync(ROOT)) { console.log('Черновиков нет'); process.exit(0); }

let changed = 0;
for (const id of fs.readdirSync(ROOT).sort()) {
  const dir = path.join(ROOT, id);
  if (!fs.statSync(dir).isDirectory()) continue;
  const srcDir = path.join(dir, 'src'), genDir = path.join(dir, 'gen');
  if (!fs.existsSync(srcDir)) continue;
  const statusPath = path.join(dir, 'status.json'), regenPath = path.join(dir, 'regen.json');
  const status = readJson(statusPath, { state: 'queued', variants: {} });
  status.variants = status.variants || {};
  const remotePath = path.join(dir, 'remote.json');
  const remote = readJson(remotePath, null);
  if (remote && remote.variants) {
    // Results generated elsewhere (Claude + Higgsfield subscription): download them into gen/.
    fs.mkdirSync(genDir, { recursive: true });
    const errors = [];
    for (const [key, urls] of Object.entries(remote.variants)) {
      try {
        const stamp = Date.now().toString(36), saved = [];
        for (let i = 0; i < urls.length; i++) {
          const rel = `gen/${key}-${stamp}-${i + 1}.jpg`;
          await download(urls[i], path.join(dir, rel));
          saved.push(rel);
        }
        for (const old of status.variants[key] || []) fs.rmSync(path.join(dir, old), { force: true });
        status.variants[key] = saved;
        console.log(`${id}/${key}: скачано ${saved.length}`);
      } catch (e) { errors.push(`${key}: ${e.message}`); }
    }
    fs.rmSync(remotePath, { force: true });
    fs.rmSync(regenPath, { force: true });
    fs.rmSync(path.join(dir, 'request.json'), { force: true });
    const srcKeys = fs.readdirSync(srcDir).filter(f => /\.jpe?g$/i.test(f)).map(f => path.parse(f).name);
    const allDone = srcKeys.every(k => (status.variants[k] || []).length);
    Object.assign(status, { state: errors.length ? 'error' : allDone ? 'done' : 'manual', message: errors.join('\n'), updated: now() });
    writeJson(statusPath, status);
    changed++;
    continue;
  }
  const regen = readJson(regenPath, null);
  const regenAll = regen && (!regen.items || !regen.items.length);
  const srcs = fs.readdirSync(srcDir).filter(f => /\.jpe?g$/i.test(f)).sort();
  const todo = srcs.filter(f => {
    const key = path.parse(f).name;
    return regenAll || (regen && regen.items.includes(key)) || !(status.variants[key] || []).length;
  });
  if (!todo.length && !regen) continue;

  if (!KEY || !MODEL) {
    // No API key: the draft waits for manual processing through Claude.
    if (status.state !== 'manual') { Object.assign(status, { state: 'manual', message: '', updated: now() }); writeJson(statusPath, status); changed++; }
    console.log(`${id}: ждёт обработки через Claude`);
    continue;
  }

  fs.mkdirSync(genDir, { recursive: true });
  const errors = [];
  for (const f of todo) {
    const key = path.parse(f).name;
    console.log(`${id}/${f}: генерирую`);
    try {
      const urls = await generate(path.join(srcDir, f));
      for (const old of status.variants[key] || []) fs.rmSync(path.join(dir, old), { force: true });
      const stamp = Date.now().toString(36);
      status.variants[key] = [];
      for (let i = 0; i < urls.length; i++) {
        const rel = `gen/${key}-${stamp}-${i + 1}.jpg`;
        await download(urls[i], path.join(dir, rel));
        status.variants[key].push(rel);
      }
    } catch (e) {
      console.error(`${id}/${f}: ${e.message}`);
      errors.push(`${f}: ${e.message}`);
    }
  }
  if (regen) fs.rmSync(regenPath, { force: true });
  const allDone = srcs.every(f => (status.variants[path.parse(f).name] || []).length);
  Object.assign(status, { state: errors.length ? 'error' : allDone ? 'done' : 'queued', message: errors.join('\n'), updated: now() });
  writeJson(statusPath, status);
  changed++;
}
console.log(`Обновлено черновиков: ${changed}`);
