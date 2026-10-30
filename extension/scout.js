// Homeshot scout: scores rental listings on Avito search pages and marks likely clients.
// A likely client: owner (not an agency), fair price, listing hangs for a while, weak or few photos.
(function () {
  if (window.__homeshotScout) return; window.__homeshotScout = true;
  const isItem = () => /_\d{7,}$/.test(location.pathname.replace(/\/$/, ''));
  if (isItem()) return;

  const MARKET_KEY = 'hs_market', LEADS_KEY = 'hs_leads', DIM_KEY = 'hs_dim';
  const MAX_SAMPLE = 3000;
  let market = {}, leads = {}, dim = false, cards = new Map(), ready = false;

  const num = s => parseFloat(String(s || '').replace(/\s| /g, '').replace(',', '.')) || 0;
  const median = a => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  function parse(el) {
    const id = el.getAttribute('data-item-id'); if (!id) return null;
    const priceMeta = el.querySelector('[data-marker="item-price"] meta[itemprop="price"]');
    const priceTxt = (el.querySelector('[data-marker="item-price-value"]') || {}).textContent || '';
    if (!/месяц/i.test(priceTxt)) return null; // only long-term rent
    const price = priceMeta ? num(priceMeta.content) : num(priceTxt);
    const tEl = el.querySelector('[data-marker="item-title"]');
    const title = tEl ? tEl.textContent.replace(/\s+/g, ' ').trim() : '';
    const rooms = /студи/i.test(title) ? 0 : (title.match(/(\d+)-к\./) || [])[1];
    const area = num((title.match(/([\d,]+)\s*м²/) || [])[1]);
    if (rooms == null || !area || !price) return null;
    const slides = el.querySelectorAll('[data-marker="item-photo"] li').length;
    const more = (el.textContent.match(/Ещё\s*(\d+)\s*фото/) || [])[1];
    const full = !!el.querySelector('a[href*="search_seller_info"]'); // card fully rendered (Avito renders lazily)
    const photos = more ? slides + Number(more) : (full ? slides : null);
    const cover = (() => { const li = el.querySelector('[data-marker^="slider-image/image-"]'); return li ? li.getAttribute('data-marker').replace('slider-image/image-', '') : ''; })();
    const seller = el.querySelector('a[href*="/user/"][href*="search_seller_info"], a[href*="/brands/"]');
    const sellerBox = seller ? seller.closest('div').parentElement.parentElement : null;
    const sTxt = sellerBox ? sellerBox.textContent : '';
    const done = /Нет завершённых/.test(sTxt) ? 0 : (sTxt.match(/(\d[\d\s]*)\s+завершённ/) ? num(sTxt.match(/(\d[\d\s]*)\s+завершённ/)[1]) : null);
    const company = !!el.querySelector('a[href*="/brands/"]') || /агентств|недвижимост|риелт|риэлт|realty|estate/i.test(seller ? seller.textContent : '');
    const href = tEl ? tEl.href.split('?')[0] : '';
    const best = img => { const ss = (img.getAttribute('srcset') || '').split(',').map(x => x.trim().split(/\s+/)).filter(x => x[0]); ss.sort((a, b) => parseInt(b[1]) - parseInt(a[1])); return ss[0] ? ss[0][0] : (img.currentSrc || img.src || ''); };
    const gallery = [...el.querySelectorAll('[data-marker^="slider-image/image-"]')].map(li => { const im = li.querySelector('img'); const u = im ? best(im) : ''; return /^https?:\/\/[^/]*img\.avito\.st\//.test(u) ? u : li.getAttribute('data-marker').replace('slider-image/image-', ''); });
    const descEl = el.querySelector('meta[itemprop="description"]');
    const addr = (el.querySelector('[data-marker="item-address"]') || {}).textContent || '';
    return { id, price, rooms: Number(rooms), area, ppm: price / area, title, photos, slides, cover, sellerName: seller ? seller.textContent.trim() : '', done, company, sellerKnown: !!seller, href, addr: addr.replace(/\s+/g, ' ').trim(), gallery, desc: descEl ? descEl.content : '' };
  }

  function stats(d) {
    const same = Object.values(market).filter(m => m.r === Math.min(d.rooms, 4));
    const ppm = median(same.map(m => m.p));
    const ids = Object.keys(market).map(Number).sort((a, b) => a - b);
    let lo = 0, hi = ids.length; const v = Number(d.id);
    while (lo < hi) { const m = (lo + hi) >> 1; if (ids[m] < v) lo = m + 1; else hi = m; }
    const olderThan = ids.length > 20 ? 1 - lo / ids.length : null; // share of listings that are newer
    return { ppm, n: same.length, olderThan };
  }

  function score(d, q) {
    const st = stats(d), why = [], bad = [];
    let s = 0;
    if (d.photos == null) {}
    else if (d.photos <= 5) { s += 25; why.push(d.photos + ' фото'); }
    else if (d.photos <= 8) { s += 15; why.push(d.photos + ' фото'); }
    else if (d.photos <= 12) s += 5;
    else if (d.photos > 20) s -= 10;
    if (st.olderThan != null) {
      if (st.olderThan >= 0.7) { s += 20; why.push('висит давно'); }
      else if (st.olderThan >= 0.5) { s += 10; why.push('висит неделями'); }
      else if (st.olderThan < 0.15) { s += 5; why.push('новое'); }
    }
    const rel = st.n >= 8 && st.ppm ? d.ppm / st.ppm : null;
    if (rel != null) {
      if (rel > 1.25) bad.push('дорого +' + Math.round((rel - 1) * 100) + '%');
      else if (rel <= 1.05) { s += 10; why.push('цена в рынке'); }
    }
    if (d.company || (d.done != null && d.done >= 100)) bad.push('риелтор или компания');
    else if (d.sellerKnown && (d.done == null || d.done <= 10)) { s += 10; why.push('собственник'); }
    if (q) {
      if (q.dark) { s += 15; why.push('тёмная обложка'); }
      if (q.vertical) { s += 10; why.push('вертикальная обложка'); }
    }
    s = Math.max(0, Math.min(100, s));
    if (bad.length) s = Math.min(s, 25);
    return { s, why, bad, rel, st };
  }

  // ---- UI ----
  const css = `
    :host{all:initial}
    *{box-sizing:border-box;font-family:Manrope,"Segoe UI",system-ui,sans-serif}
    .b{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:6px 0 8px;font-size:12px;line-height:1}
    .sc{min-width:34px;height:26px;padding:0 8px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;background:#2E2823;color:#B0A598}
    .hot .sc{background:#D6A870;color:#14110F}.warm .sc{background:#5A4630;color:#F2ECE4}
    .t{height:22px;padding:0 8px;border-radius:999px;display:inline-flex;align-items:center;background:#F3EEE8;color:#4B3F33}
    .t.x{background:#FBE9E5;color:#9B3B2A}
    .lead{height:26px;padding:0 10px;border-radius:999px;border:1.5px solid #D6A870;background:transparent;color:#8A6A45;font:700 12px inherit;cursor:pointer}
    .lead:hover{background:#D6A870;color:#14110F}
    .lead[aria-pressed=true]{background:#14110F;border-color:#14110F;color:#D6A870;cursor:default}
    .lg{color:#8C8177;font-size:11px}`;
  const panelHost = document.createElement('div');
  panelHost.style.cssText = 'all:initial;position:fixed;left:16px;bottom:16px;z-index:2147483646';
  const pr = panelHost.attachShadow({ mode: 'open' });
  pr.innerHTML = `<style>${css}
    .p{width:430px;max-width:calc(100vw - 32px);border-radius:12px;background:#14110F;color:#F2ECE4;box-shadow:0 8px 28px rgba(0,0,0,.4);font-size:13px;overflow:hidden}
    .ph{display:flex;align-items:center;gap:8px;padding:10px 10px 10px 14px}
    .ph .st{flex:1;min-width:0;line-height:1.35}
    .p b{color:#D6A870}
    .p small{color:#8C8177;font-size:11px}
    .p button{height:30px;padding:0 12px;border-radius:999px;border:1px solid #3A322B;background:transparent;color:#F2ECE4;font:600 12px inherit;cursor:pointer;white-space:nowrap}
    .p button:hover{border-color:#D6A870}
    .p button[aria-pressed=true]{background:#D6A870;border-color:#D6A870;color:#14110F}
    .p .tg{display:flex;align-items:center;gap:6px}
    .p .tg i{font-style:normal;display:inline-block;transition:transform .2s}
    .p.open .tg i{transform:rotate(180deg)}
    .ls{display:none;border-top:1px solid #2E2823;max-height:min(420px,55vh);overflow:auto}
    .p.open .ls{display:block}
    .it{display:flex;gap:10px;align-items:center;padding:8px 10px 8px 14px;border-bottom:1px solid #221D19}
    .it img{width:52px;height:52px;object-fit:cover;border-radius:6px;background:#2E2823;flex-shrink:0}
    .it .tx{flex:1;min-width:0}
    .it .tx a{color:#F2ECE4;text-decoration:none;font-weight:600;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.3}
    .it .tx a:hover{color:#D6A870}
    .it .tx span{color:#8C8177;font-size:12px}
    .it .sc{height:22px;min-width:28px;font-size:12px}
    .it.sent{opacity:.55}
    .it .ok{color:#7FBF8E;font-size:12px;white-space:nowrap}
    .it button{height:28px;padding:0 10px}
    .it .rm{width:28px;padding:0;font-size:15px;color:#B0A598}
    .it .rm:hover{border-color:#E8907A;color:#E8907A}
    .ft{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 14px;border-top:1px solid #2E2823}
    .ft .go{background:#D6A870;border-color:#D6A870;color:#14110F}
    .ft .go[disabled]{opacity:.45;cursor:default}
    .emp{padding:14px;color:#8C8177}
    .msg{color:#D6A870;font-size:12px}.msg.err{color:#E8907A}</style>
    <div class="p" id="p">
      <div class="ph"><div class="st"><b id="hot">0</b> кандидатов · <span id="warm">0</span> возможных<br><small id="mk"></small></div>
        <button type="button" id="dim" aria-pressed="false" title="Приглушить карточки с низкой оценкой">Приглушить</button>
        <button type="button" class="tg" id="tg" aria-expanded="false">Лиды <b id="lc">0</b> <i>▴</i></button></div>
      <div class="ls" id="ls"></div>
    </div>`;
  const P = pr.getElementById('p');

  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmt = n => Math.round(n).toLocaleString('ru-RU');

  function renderList() {
    const arr = Object.values(leads).sort((a, b) => (b.added || '').localeCompare(a.added || ''));
    const local = arr.filter(l => l.state !== 'sent');
    pr.getElementById('lc').textContent = arr.length;
    const box = pr.getElementById('ls');
    if (!arr.length) { box.innerHTML = '<div class="emp">Пока пусто. Нажимайте «+ В лиды» на карточках.</div>'; return; }
    box.innerHTML = arr.map(l => `<div class="it${l.state === 'sent' ? ' sent' : ''}" data-id="${esc(l.id)}">
        <img src="${esc(l.cover)}" alt="" loading="lazy">
        <div class="tx"><a href="${esc(l.url)}" target="_blank" rel="noopener" title="${esc(l.title)}">${esc(l.title)}</a><span>${fmt(l.price)} ₽ · ${esc(l.sellerName || 'продавец ?')}</span></div>
        <span class="sc">${l.score}</span>
        ${l.state === 'sent' ? '<span class="ok">✓ в админке</span>' : '<button type="button" data-send>В админку</button>'}
        <button type="button" class="rm" data-rm aria-label="Убрать из списка" title="Убрать из списка">×</button></div>`).join('') +
      `<div class="ft"><span class="msg" id="msg" role="status"></span><button type="button" class="go" id="all"${local.length ? '' : ' disabled'}>Отправить все (${local.length})</button></div>`;
  }

  function saveLeads() { chrome.storage.local.set({ [LEADS_KEY]: leads }); }

  function sendLeads(ids, btn) {
    const list = ids.map(id => leads[id]).filter(Boolean);
    if (!list.length) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Отправляю…'; }
    chrome.runtime.sendMessage({ type: 'leads', leads: list }, res => {
      if (res && res.ok) { list.forEach(l => { l.state = 'sent'; l.sent = new Date().toISOString(); }); saveLeads(); renderList(); refreshAll(); }
      else { renderList(); const m = pr.getElementById('msg'); if (m) { m.textContent = (res && res.error) || 'Не получилось отправить'; m.className = 'msg err'; } }
    });
  }

  pr.addEventListener('click', e => {
    const it = e.target.closest('.it'), id = it && it.dataset.id;
    if (e.target.closest('#tg')) { P.classList.toggle('open'); pr.getElementById('tg').setAttribute('aria-expanded', String(P.classList.contains('open'))); return; }
    if (e.target.closest('#dim')) { dim = !dim; pr.getElementById('dim').setAttribute('aria-pressed', String(dim)); chrome.storage.local.set({ [DIM_KEY]: dim }); refreshAll(); return; }
    if (e.target.closest('[data-rm]')) { delete leads[id]; saveLeads(); renderList(); refresh(id); return; }
    if (e.target.closest('[data-send]')) { sendLeads([id], e.target.closest('[data-send]')); return; }
    if (e.target.closest('#all')) { sendLeads(Object.keys(leads).filter(k => leads[k].state !== 'sent'), e.target.closest('#all')); }
  });

  function badge(el, d, r) {
    let host = el.querySelector(':scope [data-hs-badge]');
    if (!host) {
      host = document.createElement('div'); host.setAttribute('data-hs-badge', '');
      host.attachShadow({ mode: 'open' });
      const t = el.querySelector('[data-marker="item-title"]');
      const anchor = t ? (t.closest('h2, h3') || t) : null;
      if (anchor && anchor.parentElement) anchor.parentElement.insertBefore(host, anchor.nextSibling); else el.prepend(host);
      host.shadowRoot.addEventListener('click', e => {
        const b = e.target.closest('.lead'); if (!b) return;
        e.preventDefault(); e.stopPropagation(); toggleLead(host.dataset.id);
      });
    }
    host.dataset.id = d.id;
    const cls = r.s >= 55 ? 'hot' : r.s >= 35 ? 'warm' : '';
    const inLeads = !!leads[d.id];
    const html = `<style>${css}</style><div class="b ${cls}" title="Оценка Homeshot: чем выше, тем вероятнее, что владельцу нужна обработка фото">
      <span class="sc">${r.s}</span>${r.why.map(w => `<span class="t">${w}</span>`).join('')}${r.bad.map(w => `<span class="t x">${w}</span>`).join('')}
      <button type="button" class="lead" aria-pressed="${inLeads}" title="${inLeads ? 'Убрать из лидов' : 'Добавить в список лидов'}">${inLeads ? '✓ В лидах' : '+ В лиды'}</button>
      ${r.st.n < 8 ? '<span class="lg">мало данных о рынке</span>' : ''}</div>`;
    if (host.__html !== html) { host.shadowRoot.innerHTML = html; host.__html = html; }
    const op = dim && r.s < 35 && !inLeads ? '0.35' : '';
    if (el.style.opacity !== op) { el.style.transition = 'opacity .2s'; el.style.opacity = op; }
    el.dataset.hsScore = r.s;
  }

  function toggleLead(id) {
    if (leads[id]) { if (leads[id].state === 'sent') return; delete leads[id]; }
    else {
      const c = cards.get(id); if (!c) return;
      const r = score(c.d, c.q);
      leads[id] = { ...c.d, score: r.s, why: r.why, bad: r.bad, quality: c.q || null, rel: r.rel, added: new Date().toISOString(), url: c.d.href, source: location.href, state: 'local' };
    }
    saveLeads(); renderList(); refresh(id);
  }

  function refresh(id) {
    const c = cards.get(id); if (!c || !c.el.isConnected) return;
    badge(c.el, c.d, score(c.d, c.q));
  }
  function refreshAll() {
    let hot = 0, warm = 0;
    cards.forEach((c, id) => { refresh(id); const v = Number(c.el.dataset.hsScore); if (v >= 55) hot++; else if (v >= 35) warm++; });
    pr.getElementById('hot').textContent = hot; pr.getElementById('warm').textContent = warm;
    pr.getElementById('mk').textContent = 'Homeshot · оценено ' + cards.size + ' · база рынка ' + Object.keys(market).length;
  }

  let saveT = 0;
  function remember(d) {
    market[d.id] = { r: Math.min(d.rooms, 4), p: Math.round(d.ppm), t: Date.now() };
    clearTimeout(saveT); saveT = setTimeout(() => {
      const ks = Object.keys(market); if (ks.length > MAX_SAMPLE) ks.sort((a, b) => market[a].t - market[b].t).slice(0, ks.length - MAX_SAMPLE).forEach(k => delete market[k]);
      chrome.storage.local.set({ [MARKET_KEY]: market });
    }, 800);
  }

  const queue = []; let busy = 0;
  function quality(id) {
    const c = cards.get(id); if (!c || !c.d.cover || c.qAsked) return; c.qAsked = true;
    queue.push(id); pump();
  }
  function pump() {
    while (busy < 3 && queue.length) {
      const id = queue.shift(), c = cards.get(id); busy++;
      chrome.runtime.sendMessage({ type: 'quality', url: c.d.cover }, res => { busy--; if (res && res.ok) { c.q = res.q; refresh(id); refreshAll(); } pump(); });
    }
  }

  // Throttled scan: Avito changes the DOM constantly while scrolling, so a debounce would never fire.
  let lastScan = 0, scanT = 0;
  function scan() {
    if (scanT) return;
    scanT = setTimeout(doScan, Math.max(0, 400 - (Date.now() - lastScan)));
  }
  function doScan() {
    scanT = 0; lastScan = Date.now();
    if (!ready) return;
    document.querySelectorAll('[data-marker="item"][data-item-id]').forEach(el => {
      const d = parse(el); if (!d) return;
      const prev = cards.get(d.id);
      if (prev && prev.el === el && prev.d.sellerKnown === d.sellerKnown && prev.d.photos === d.photos && prev.d.cover === d.cover) return;
      cards.set(d.id, { el, d, q: prev && prev.d.cover === d.cover ? prev.q : undefined, qAsked: prev && prev.d.cover === d.cover ? prev.qAsked : false });
      remember(d); quality(d.id);
    });
    if (cards.size && !panelHost.isConnected) document.documentElement.appendChild(panelHost);
    refreshAll();
  }

  chrome.storage.local.get({ [MARKET_KEY]: {}, [LEADS_KEY]: {}, [DIM_KEY]: false }, s => {
    market = s[MARKET_KEY] || {}; leads = s[LEADS_KEY] || {}; dim = !!s[DIM_KEY];
    Object.keys(leads).forEach(k => { if (!leads[k] || !leads[k].id) delete leads[k]; });
    pr.getElementById('dim').setAttribute('aria-pressed', String(dim));
    ready = true; renderList(); scan();
  });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'local' && ch[LEADS_KEY]) { leads = ch[LEADS_KEY].newValue || {}; renderList(); refreshAll(); }
  });
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true, characterData: true });
  window.addEventListener('scroll', scan, { passive: true });
  setInterval(scan, 2000);
})();
