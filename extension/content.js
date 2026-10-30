// Homeshot content script: button on Avito listing pages, photo picker, send to drafts.
(function () {
  if (window.__homeshot) return; window.__homeshot = true;
  const isItem = () => /_\d{7,}$/.test(location.pathname.replace(/\/$/, ''));

  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;inset:auto 0 0 auto';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
  <style>
    :host{all:initial}
    [hidden]{display:none!important}
    *{box-sizing:border-box;font-family:Manrope,"Segoe UI",system-ui,sans-serif}
    .fab{position:fixed;right:20px;bottom:20px;display:flex;align-items:center;gap:10px;height:52px;padding:0 20px 0 14px;border:0;border-radius:999px;background:#14110F;color:#F2ECE4;font:600 15px/1 inherit;cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,.35)}
    .fab:hover{background:#2a241f}
    .fab:focus-visible,button:focus-visible,input:focus-visible{outline:2px solid #D6A870;outline-offset:2px}
    .ov{position:fixed;inset:0;background:rgba(10,8,7,.72);display:flex;align-items:center;justify-content:center;padding:16px}
    .dlg{width:min(980px,100%);max-height:calc(100vh - 32px);display:flex;flex-direction:column;background:#1C1815;color:#F2ECE4;border:1px solid #2E2823;border-radius:10px;overflow:hidden}
    .hd{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid #2E2823}
    .hd b{font-size:17px}
    .x{width:40px;height:40px;border:1px solid #2E2823;border-radius:50%;background:transparent;color:#B0A598;font-size:20px;cursor:pointer}
    .bd{padding:16px 20px;overflow:auto;display:grid;gap:14px}
    label{font-size:11px;font-weight:600;letter-spacing:.14em;color:#B0A598;text-transform:uppercase}
    input[type=text]{width:100%;height:42px;margin-top:6px;padding:0 12px;border-radius:6px;border:1px solid #2E2823;background:#14110F;color:#F2ECE4;font:500 14px inherit}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
    .ph{position:relative;aspect-ratio:4/3;border-radius:6px;overflow:hidden;border:2px solid transparent;background:#14110F;cursor:pointer;padding:0}
    .ph img{width:100%;height:100%;object-fit:cover;display:block}
    .ph[aria-pressed=true]{border-color:#D6A870}
    .ph .ck{position:absolute;top:6px;right:6px;width:24px;height:24px;border-radius:50%;background:rgba(20,17,15,.75);border:2px solid #F2ECE4}
    .ph[aria-pressed=true] .ck{background:#D6A870;border-color:#D6A870}
    .ph .sz{position:absolute;left:6px;bottom:6px;font-size:11px;padding:2px 6px;border-radius:4px;background:rgba(20,17,15,.75);color:#F2ECE4}
    .ft{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;padding:14px 20px;border-top:1px solid #2E2823}
    .msg{font-size:14px;color:#D6A870}.msg.err{color:#E8907A}
    .msg a{color:#D6A870}
    .go{height:46px;padding:0 22px;border:0;border-radius:999px;background:#D6A870;color:#14110F;font:600 15px inherit;cursor:pointer}
    .go[disabled]{opacity:.5;cursor:wait}
    .ln{height:40px;padding:0 14px;border:1px solid #2E2823;border-radius:999px;background:transparent;color:#B0A598;font:600 13px inherit;cursor:pointer}
    .muted{color:#8C8177;font-size:13px}
    .note{margin:0 20px 4px;padding:10px 14px;border-radius:8px;background:rgba(214,168,112,.12);border:1px solid #8A6A45;color:#F2ECE4;font-size:13px;line-height:1.45}
    .note b{color:#D6A870}
    .btns{display:flex;gap:8px;align-items:center}
  </style>
  <button class="fab" type="button" hidden>
    <svg width="26" height="26" viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M8 31 L32 9 L56 31" stroke="#F2ECE4" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 42 V55 H25" stroke="#F2ECE4" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M39 55 H50 V42" stroke="#F2ECE4" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="32" cy="38" r="6.5" fill="#D6A870"/></svg>
    В Homeshot
  </button>
  <div class="ov" hidden role="dialog" aria-modal="true" aria-label="Homeshot: выбор фото">
    <div class="dlg">
      <div class="hd"><b>Фото из объявления</b><button class="x" type="button" aria-label="Закрыть">×</button></div>
      <div class="bd">
        <div><label for="hs-title">Название черновика</label><input type="text" id="hs-title"></div>
        <div class="row"><span class="muted" id="hs-count"></span> <button class="ln" type="button" id="hs-all">Выбрать все</button> <button class="ln" type="button" id="hs-none">Снять все</button></div>
        <div class="grid" id="hs-grid"></div>
      </div>
      <div class="note" id="hs-note" hidden></div>
      <div class="ft"><span class="msg" id="hs-msg" role="status"></span><span class="btns"><button class="ln" type="button" id="hs-draft" hidden>В черновики</button><button class="go" type="button" id="hs-go">Отправить в Homeshot</button></span></div>
    </div>
  </div>`;
  document.documentElement.appendChild(host);

  const $ = s => root.querySelector(s);
  const fab = $('.fab'), ov = $('.ov'), grid = $('#hs-grid'), msg = $('#hs-msg'), go = $('#hs-go');
  let photos = [];

  function toast(text) {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = 'position:fixed;left:50%;top:20px;transform:translateX(-50%);max-width:min(560px,calc(100vw - 32px));padding:12px 18px;border-radius:12px;background:#14110F;color:#F2ECE4;border:1px solid #8A6A45;font:600 14px/1.45 "Segoe UI",system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.4);z-index:2147483647';
    root.appendChild(el); setTimeout(() => el.remove(), 9000);
  }
  function sync() { fab.hidden = !isItem(); }
  sync();
  // Opened from the admin "Написать сообщение" button: open the Avito chat with the seller.
  if (/homeshot-write/.test(location.hash) && isItem()) {
    history.replaceState(null, '', location.pathname + location.search);
    let tries = 0;
    const t = setInterval(() => {
      // Only the seller's "Написать" button on the listing. Never the header messenger link
      // (it opens your own chat list).
      const visible = x => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const outsideHeader = x => !x.closest('header, [data-marker^="header"], [class*="header"], nav') && !/\/profile\/messenger|\/messenger\/?$/.test(x.getAttribute('href') || '');
      const cands = [...document.querySelectorAll('[data-marker="messenger-button/button"], [data-marker*="item-view"] [data-marker*="messenger"] button')]
        .concat([...document.querySelectorAll('button, [role="button"]')].filter(x => /^\s*Написать( сообщение)?\s*$/i.test(x.textContent || '')));
      const btn = cands.find(x => visible(x) && outsideHeader(x));
      if (btn) { clearInterval(t); btn.scrollIntoView({ block: 'center' }); btn.click(); toast('Текст сообщения уже в буфере: вставьте его в чат (Ctrl+V) и прикрепите фото «до» и «после».'); }
      else if (++tries > 40) { clearInterval(t); toast('Не нашёл кнопку «Написать». Нажмите её на странице объявления: текст сообщения уже в буфере (Ctrl+V).'); }
    }, 250);
  }
  // Opened from the admin "take this photo" button: #homeshot-pick=<lead photo url>
  let pickUrl = '';
  const hm = location.hash.match(/homeshot-pick=([^&]+)/);
  if (hm && isItem()) { pickUrl = decodeURIComponent(hm[1]); history.replaceState(null, '', location.pathname + location.search); setTimeout(() => fab.click(), 1500); }
  let last = location.href;
  setInterval(() => { if (location.href !== last) { last = location.href; sync(); } }, 1000);

  function say(t, err, html) { msg.className = 'msg' + (err ? ' err' : ''); if (html) msg.innerHTML = html; else msg.textContent = t; }
  function count() { const n = photos.filter(p => p.on).length; $('#hs-count').textContent = `Выбрано: ${n} из ${photos.length}`; go.disabled = !n; }

  function collect() {
    const set = new Set();
    const re = /https?:\/\/[0-9a-z-]+\.img\.avito\.st\/[^\s"'\\)<>,]+/gi;
    const add = s => { if (!s) return; s = s.replace(/\\u002F/gi, '/').replace(/\\\//g, '/').replace(/&amp;/g, '&'); (s.match(re) || []).forEach(u => set.add(u)); };
    add(document.documentElement.innerHTML);
    document.querySelectorAll('script').forEach(sc => add(sc.textContent));
    document.querySelectorAll('img,source').forEach(el => { add(el.currentSrc); add(el.src); add(el.srcset); for (const a of el.attributes) if (/^data-/.test(a.name)) add(a.value); });
    return [...set];
  }
  function text(sels) { for (const s of sels) { const el = document.querySelector(s); if (el && el.textContent.trim()) return el.textContent.trim().replace(/\s+/g, ' '); } return ''; }

  const itemId = () => (location.pathname.replace(/\/$/, '').match(/_(\d{7,})$/) || [])[1];
  let leadMode = null;
  function setLeadMode(m, full) {
    leadMode = m;
    $('#hs-note').hidden = !m; $('#hs-draft').hidden = !m;
    if (m) $('#hs-note').innerHTML = '<b>Это объявление есть в лидах.</b> Выбранные фото в полном размере заменят превью в лиде, в админке они будут отмечены точкой «готово к генерации».' + (full ? ' Уже загружено полноразмерных: ' + full + '.' : '');
    go.textContent = m ? 'Заменить в лиде' : 'Отправить в Homeshot';
  }
  fab.addEventListener('click', async () => {
    ov.hidden = false; grid.innerHTML = ''; photos = []; count(); go.disabled = true; setLeadMode(null);
    $('#hs-title').value = text(['h1', '[itemprop="name"]']).slice(0, 120);
    const settings = await chrome.runtime.sendMessage({ type: 'settings' });
    if (!settings.configured) { say('', true, 'Укажите GitHub-токен в <a href="#" id="hs-opt">настройках расширения</a>, потом нажмите кнопку ещё раз.'); $('#hs-opt').onclick = e => { e.preventDefault(); chrome.runtime.sendMessage({ type: 'open-options' }); }; }
    else {
      say('Ищу фото на странице…');
      chrome.runtime.sendMessage({ type: 'leadCheck', id: itemId() }, r => { if (r && r.ok && r.lead) setLeadMode(r.lead, r.full); });
    }
    const urls = collect();
    const r = await chrome.runtime.sendMessage({ type: 'scan', urls });
    if (!r.ok) { say('Не удалось загрузить фото: ' + r.error, true); return; }
    photos = r.photos.map(p => ({ ...p, on: false }));
    if (pickUrl) {
      const m = await chrome.runtime.sendMessage({ type: 'match', url: pickUrl, urls: photos.map(p => p.url) });
      if (m && m.ok && m.index >= 0) photos[m.index].on = true;
      pickUrl = '';
    }
    if (!photos.length) { say('Фото не найдены. Пролистайте галерею объявления и попробуйте ещё раз.', true); return; }
    grid.innerHTML = photos.map((p, i) => `<button type="button" class="ph" data-i="${i}" aria-pressed="${p.on}" aria-label="Фото ${i + 1}"><img src="${p.thumb}" alt=""><span class="ck"></span><span class="sz">${p.w}×${p.h}</span></button>`).join('');
    if (settings.configured) say('Отметьте фото для обработки и нажмите «Отправить».');
    count();
  });
  grid.addEventListener('click', e => { const b = e.target.closest('.ph'); if (!b) return; const p = photos[+b.dataset.i]; p.on = !p.on; b.setAttribute('aria-pressed', String(p.on)); count(); });
  $('#hs-all').onclick = () => { photos.forEach(p => (p.on = true)); grid.querySelectorAll('.ph').forEach(b => b.setAttribute('aria-pressed', 'true')); count(); };
  $('#hs-none').onclick = () => { photos.forEach(p => (p.on = false)); grid.querySelectorAll('.ph').forEach(b => b.setAttribute('aria-pressed', 'false')); count(); };
  const close = () => { ov.hidden = true; };
  $('.x').onclick = close;
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  root.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  $('#hs-draft').addEventListener('click', () => { setLeadMode(null); say('Фото уйдут в черновики, а не в лид.'); });
  go.addEventListener('click', async () => {
    const chosen = photos.filter(p => p.on).map(p => p.url);
    go.disabled = true; say(`Отправляю ${chosen.length} фото…`);
    if (leadMode) {
      const r = await chrome.runtime.sendMessage({ type: 'sendToLead', id: itemId(), urls: chosen });
      if (!r.ok) { say(r.error, true); go.disabled = false; return; }
      say('', false, `Готово: ${r.count} фото в полном размере в лиде. Смотрите в <a href="${r.admin}" target="_blank" rel="noopener">админке</a> через минуту.`);
      return;
    }
    const r = await chrome.runtime.sendMessage({
      type: 'send', urls: chosen, title: $('#hs-title').value.trim(),
      address: text(['[itemprop="address"]', '[data-marker="item-view/item-address"]', '[class*="style-item-address"]']),
      pageUrl: location.href.split('?')[0]
    });
    if (!r.ok) { say(r.error, true); go.disabled = false; return; }
    say('', false, `Отправлено. Варианты появятся в <a href="${r.admin}" target="_blank" rel="noopener">админке</a> через 2–5 минут.`);
  });
})();
