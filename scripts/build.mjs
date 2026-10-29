// Builds the site into _site/: compresses photos from works/<folder>/ and writes works.json.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = process.cwd();
const OUT = path.join(ROOT, '_site');
const SRC = path.join(ROOT, 'works');
const IMG = /\.(jpe?g|png|webp)$/i;
const VID = /\.(mp4|webm)$/i;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'works'), { recursive: true });
for (const f of ['index.html', 'admin.html', 'config.json']) fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
fs.cpSync(path.join(ROOT, 'assets'), path.join(OUT, 'assets'), { recursive: true });

const find = (files, base, re) => files.find(f => re.test(f) && path.parse(f).name.toLowerCase() === base);
const prettify = name => name.replace(/^\d{4}-\d{2}-\d{2}[-_ ]?/, '').replace(/[-_]+/g, ' ').trim();

const works = [];
const dirs = fs.existsSync(SRC)
  ? fs.readdirSync(SRC, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort().reverse()
  : [];

for (const dir of dirs) {
  const src = path.join(SRC, dir);
  const files = fs.readdirSync(src);
  // Pairs: before.jpg/after.jpg (legacy, first) and NN-before.jpg/NN-after.jpg.
  const raw = [];
  const lb = find(files, 'before', IMG) || find(files, 'до', IMG);
  const la = find(files, 'after', IMG) || find(files, 'после', IMG);
  if (lb && la) raw.push({ key: '00', before: lb, after: la });
  const nums = [...new Set(files.map(f => (f.match(/^(\d+)-(?:before|after)\./i) || [])[1]).filter(Boolean))].sort((a, b) => a - b);
  for (const n of nums) {
    const b = files.find(f => new RegExp(`^${n}-before\\.`, 'i').test(f) && IMG.test(f));
    const a = files.find(f => new RegExp(`^${n}-after\\.`, 'i').test(f) && IMG.test(f));
    if (b && a) raw.push({ key: n, before: b, after: a });
  }
  if (!raw.length) { console.warn(`Пропуск ${dir}: нужны before.jpg и after.jpg (или 01-before.jpg и 01-after.jpg)`); continue; }

  const slug = dir.replace(/[^\w.-]+/g, '-');
  const out = path.join(OUT, 'works', slug);
  fs.mkdirSync(out, { recursive: true });
  const pairs = [];
  for (let i = 0; i < raw.length; i++) {
    const p = {};
    for (const side of ['before', 'after']) {
      const name = `${String(i + 1).padStart(2, '0')}-${side}.jpg`;
      await sharp(path.join(src, raw[i][side])).rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true })
        .toFile(path.join(out, name));
      p[side] = `works/${slug}/${name}`;
    }
    pairs.push(p);
  }
  const w = { id: dir, title: prettify(dir), sub: '', before: pairs[0].before, after: pairs[0].after, pairs };

  const video = find(files, 'video', VID) || files.find(f => VID.test(f));
  if (video) {
    const ext = path.extname(video).toLowerCase();
    fs.copyFileSync(path.join(src, video), path.join(out, `video${ext}`));
    w.video = `works/${slug}/video${ext}`;
  }
  const info = files.find(f => /^info\.txt$/i.test(f));
  if (info) {
    const lines = fs.readFileSync(path.join(src, info), 'utf8').replace(/^﻿/, '').split(/\r?\n/).map(s => s.trim());
    if (lines[0]) w.title = lines[0];
    if (lines[1]) w.sub = lines[1];
  }
  works.push(w);
  console.log(`Готово: ${dir}`);
}

fs.writeFileSync(path.join(OUT, 'works.json'), JSON.stringify(works, null, 1));
console.log(`Работ в галерее: ${works.length}`);
