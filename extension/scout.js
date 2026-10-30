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
    const addr = (el.querySelector('[data-marker="item-address"]') || {}).textContent || '';
    return { id, price, rooms: Number(rooms), area, ppm: price / area, title, photos, slides, cover, sellerName: seller ? seller.textContent.trim() : '', done, company, sellerKnown: !!seller, href, addr: addr.replace(/\s+/g, ' ').trim() };
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
    .p{display:flex;align-items:center;gap:10px;padding:10px 12px 10px 14px;border-radius:12px;background:#14110F;color:#F2ECE4;box-shadow:0 8px 28px rgba(0,0,0,.35);font-size:13px}
    .p b{color:#D6A870}
    .p button{height:30px;padding:0 12px;border-radius:999px;border:1px solid #3A322B;background:transparent;color:#F2ECE4;font:600 12px inherit;cursor:pointer}
    .p button[aria-pressed=true]{background:#D6A870;border-color:#D6A870;color:#14110F}
    .p small{color:#8C8177}</style>
    <div class="p" role="status"><span>Homeshot: <b id="hot">0</b> кандидатов из <span id="all">0</span> <small id="mk"></small></span><button type="button" id="dim" aria-pressed="false">Приглушить остальные</button></div>`;

  function badge(el, d, r) {
    let host = el.querySelector(':scope [data-hs-badge]');
    if (!host) {
      host = document.createElement('div'); host.setAttribute('data-hs-badge', '');
      host.attachShadow({ mode: 'open' });
      const t = el.querySelector('[data-marker="item-title"]');
      const anchor = t ? (t.closest('h2, h3') || t) : null;
      if (anchor && anchor.parentElement) anchor.parentElement.insertBefore(host, anchor.nextSibling); else el.prepend(host);
      host.shadowRoot.addEventListener('click', e => {
        const b = e.target.closest('.lead'); if (!b || b.getAttribute('aria-pressed') === 'true') return;
        e.preventDefault(); e.stopPropagation(); addLead(d.id, b);
      });
    }
    const cls = r.s >= 55 ? 'hot' : r.s >= 35 ? 'warm' : '';
    const inLeads = !!leads[d.id];
    host.shadowRoot.innerHTML = `<style>${css}</style><div class="b ${cls}" title="Оценка Homeshot: чем выше, тем вероятнее, что владельцу нужна обработка фото">
      <span class="sc">${r.s}</span>${r.why.map(w => `<span class="t">${w}</span>`).join('')}${r.bad.map(w => `<span class="t x">${w}</span>`).join('')}
      ${r.s >= 35 || inLeads ? `<button type="button" class="lead" aria-pressed="${inLeads}">${inLeads ? '✓ В лидах' : '+ В лиды'}</button>` : ''}
      ${r.st.n < 8 ? '<span class="lg">мало данных о рынке</span>' : ''}</div>`;
    el.style.transition = 'opacity .2s';
    el.style.opacity = dim && r.s < 35 && !inLeads ? '0.35' : '';
    el.dataset.hsScore = r.s;
  }

  function addLead(id, btn) {
    const c = cards.get(id); if (!c) return;
    btn.textContent = 'Сохраняю…';
    const r = score(c.d, c.q);
    const lead = { ...c.d, score: r.s, why: r.why, quality: c.q || null, rel: r.rel, added: new Date().toISOString(), url: c.d.href, source: location.href };
    chrome.runtime.sendMessage({ type: 'lead', lead }, res => {
      if (res && res.ok) { leads[id] = { added: lead.added }; chrome.storage.local.set({ [LEADS_KEY]: leads }); refresh(id); }
      else { btn.textContent = 'Ошибка'; btn.title = (res && res.error) || ''; setTimeout(() => refresh(id), 2500); }
    });
  }

  function refresh(id) {
    const c = cards.get(id); if (!c || !c.el.isConnected) return;
    badge(c.el, c.d, score(c.d, c.q));
  }
  function refreshAll() {
    let hot = 0;
    cards.forEach((c, id) => { refresh(id); if (Number(c.el.dataset.hsScore) >= 55) hot++; });
    pr.getElementById('hot').textContent = hot; pr.getElementById('all').textContent = cards.size;
    pr.getElementById('mk').textContent = '· база рынка: ' + Object.keys(market).length;
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
      chrome.runtime.sendMessage({ type: 'quality', url: c.d.cover }, res => { busy--; if (res && res.ok) { c.q = res.q; refreshAll(); } pump(); });
    }
  }

  let scanT = 0;
  function scan() {
    clearTimeout(scanT); scanT = setTimeout(() => {
      if (!ready) return;
      document.querySelectorAll('[data-marker="item"][data-item-id]').forEach(el => {
        const d = parse(el); if (!d) return;
        const prev = cards.get(d.id);
        if (prev && prev.el === el && prev.d.sellerKnown === d.sellerKnown && prev.d.photos === d.photos) return;
        cards.set(d.id, { el, d, q: prev && prev.q, qAsked: prev && prev.qAsked });
        remember(d); quality(d.id);
      });
      if (cards.size && !panelHost.isConnected) document.documentElement.appendChild(panelHost);
      refreshAll();
    }, 250);
  }

  pr.getElementById('dim').addEventListener('click', e => {
    dim = !dim; e.currentTarget.setAttribute('aria-pressed', String(dim)); chrome.storage.local.set({ [DIM_KEY]: dim }); refreshAll();
  });

  chrome.storage.local.get({ [MARKET_KEY]: {}, [LEADS_KEY]: {}, [DIM_KEY]: false }, s => {
    market = s[MARKET_KEY] || {}; leads = s[LEADS_KEY] || {}; dim = !!s[DIM_KEY];
    pr.getElementById('dim').setAttribute('aria-pressed', String(dim));
    ready = true; scan();
  });
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
})();
