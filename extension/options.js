const DEFAULTS = { owner: 'PrizrakKD', repo: 'homeshot-studio', branch: 'main', token: '' };
const $ = id => document.getElementById(id);
const st = (t, err) => { $('st').textContent = t; $('st').className = err ? 'err' : ''; };

chrome.storage.local.get(DEFAULTS).then(s => { $('token').value = s.token; $('owner').value = s.owner; $('repo').value = s.repo; });

$('save').addEventListener('click', async () => {
  const s = { token: $('token').value.trim(), owner: $('owner').value.trim() || DEFAULTS.owner, repo: $('repo').value.trim() || DEFAULTS.repo };
  st('Проверяю…');
  try {
    const r = await fetch(`https://api.github.com/repos/${s.owner}/${s.repo}`, { headers: { Authorization: 'Bearer ' + s.token, Accept: 'application/vnd.github+json' } });
    if (r.status === 401) throw new Error('Токен не подходит или истёк.');
    if (!r.ok) throw new Error('Репозиторий не найден или нет доступа.');
    const j = await r.json();
    if (!j.permissions || !j.permissions.push) throw new Error('У токена нет доступа на запись (нужно Contents: Read and write).');
    await chrome.storage.local.set(s);
    st('Сохранено. Откройте объявление на Авито, внизу справа появится кнопка «В Homeshot».');
  } catch (e) { st(e.message, true); }
});
