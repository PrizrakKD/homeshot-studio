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
for (const f of ['index.html', 'config.json']) fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
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
  const before = find(files, 'before', IMG) || find(files, 'до', IMG);
  const after = find(files, 'after', IMG) || find(files, 'после', IMG);
  if (!before || !after) { console.warn(`Пропуск ${dir}: нужны before.jpg и after.jpg`); continue; }

  const slug = dir.replace(/[^\w.-]+/g, '-');
  const out = path.join(OUT, 'works', slug);
  fs.mkdirSync(out, { recursive: true });
  for (const [name, file] of [['before', before], ['after', after]]) {
    await sharp(path.join(src, file)).rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(path.join(out, `${name}.jpg`));
  }
  const w = { title: prettify(dir), sub: '', before: `works/${slug}/before.jpg`, after: `works/${slug}/after.jpg` };

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
