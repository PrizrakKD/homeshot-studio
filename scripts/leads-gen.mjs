// Downloads generated examples for leads: leads/<id>/remote.json {"items": {"leads/<id>/02-full.jpg": "https://..."}}
// saves leads/<id>/02-gen.jpg, records it in leads/<id>.json as gen[full] = gen, deletes remote.json.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(process.cwd(), 'leads');
if (!fs.existsSync(ROOT)) process.exit(0);
let done = 0;
for (const id of fs.readdirSync(ROOT)) {
  const dir = path.join(ROOT, id), rem = path.join(dir, 'remote.json'), meta = path.join(ROOT, id + '.json');
  if (!fs.existsSync(rem) || !fs.existsSync(meta)) continue;
  const items = JSON.parse(fs.readFileSync(rem, 'utf8')).items || {};
  const lead = JSON.parse(fs.readFileSync(meta, 'utf8'));
  lead.gen = lead.gen || {};
  for (const [full, url] of Object.entries(items)) {
    const nn = (path.basename(full).match(/^(\d+)/) || [])[1];
    if (!nn) continue;
    const r = await fetch(url);
    if (!r.ok) { console.warn(`Не скачалось ${url}: ${r.status}`); continue; }
    const out = `leads/${id}/${nn}-gen.jpg`;
    fs.writeFileSync(path.join(process.cwd(), out), Buffer.from(await r.arrayBuffer()));
    lead.gen[full] = out; done++;
    if (Array.isArray(lead.genQueue)) lead.genQueue = lead.genQueue.filter(f => f !== full);
  }
  lead.genAt = new Date().toISOString();
  fs.writeFileSync(meta, JSON.stringify(lead, null, 2) + '\n');
  fs.unlinkSync(rem);
  console.log(`Лид ${id}: примеров ${Object.keys(items).length}`);
}
console.log(`Скачано примеров: ${done}`);
