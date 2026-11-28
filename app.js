/* ==========================================================================
Cashfy — логика приложения (данные через API)
========================================================================== */
(function () {
  'use strict';
  var D = window.CashfyData;
  var U = D.util;
  var CATS = D.CATEGORIES;
  var Charts = window.Charts;
  var esc = Charts.esc;
  var API = window.CashfyAPI;

  var CACHE_KEY = 'cashfy.cache.v1';
  var LOCAL_MIGRATION_KEY = 'cashfy.local-migrated.v1';

  var main, playerEl, mobileNav, modalRoot, toastRoot, sideCategories, sideNav, authRoot;
  var state = null;
  var activeUser = null;
  var ui = { period: 30, modalCat: 'food', aiSeed: 1, authMode: 'login', syncing: false };
  var lastHash = null;
  var toastTimer = null;
  var saveTimer = null;
  var offlineMode = false;

  /* ------------------------------------------------------------------
     Хранилище: кэш в localStorage + синхронизация с сервером
  ------------------------------------------------------------------ */
  function defaultBudgets() {
    var o = {};
    CATS.forEach(function (c) { o[c.id] = c.budget; });
    return o;
  }
  function normalizeState(s) {
    if (!s || !Array.isArray(s.transactions)) return null;
    s.budgets = Object.assign(defaultBudgets(), s.budgets || {});
    s.settings = Object.assign(
      { name: 'Пользователь', monthlyBudget: 70000, currency: '₽' },
      s.settings || {}
    );
    s.picks = (s.picks && typeof s.picks === 'object') ? s.picks : {};
    s.transactions = s.transactions.filter(function (t) {
      return t && typeof t.amount === 'number' && typeof t.date === 'string';
    }).map(function (t) {
      return {
        id: t.id || 'x' + Math.random().toString(36).slice(2),
        title: String(t.title || 'Трата'),
        categoryId: D.CAT_BY_ID[t.categoryId] ? t.categoryId : 'other',
        amount: t.amount,
        date: t.date,
        time: t.time || '12:00',
        note: t.note || ''
      };
    });
    return s;
  }
  function cacheKey() {
    return activeUser && activeUser.id ? CACHE_KEY + '.' + activeUser.id : CACHE_KEY;
  }
  function readCache() {
    try {
      var raw = localStorage.getItem(cacheKey());
      if (!raw) return null;
      return normalizeState(JSON.parse(raw));
    } catch (e) { return null; }
  }
  function writeCache(s) {
    try { localStorage.setItem(cacheKey(), JSON.stringify(s)); } catch (e) { }
  }
  function emptyState(name) {
    return {
      transactions: [],
      budgets: defaultBudgets(),
      settings: { name: name || 'Пользователь', monthlyBudget: 70000, currency: '₽', createdAt: new Date().toISOString() },
      picks: {}
    };
  }
  function demoState(name) {
    var s = emptyState(name);
    s.transactions = D.seedTransactions();
    s.__fresh = true;
    return s;
  }

  /* Загрузка с сервера. При ошибке сети — fallback на кэш. */
  function syncFromServer() {
    ui.syncing = true;
    return API.getState()
      .then(function (serverState) {
        offlineMode = false;
        var normalized = normalizeState(serverState);
        if (normalized) {
          state = normalized;
          writeCache(state);
        } else {
          state = readCache() || emptyState(activeUser && activeUser.name);
        }
        ui.syncing = false;
        return state;
      })
      .catch(function (err) {
        ui.syncing = false;
        if (err && err.status === 401) {
          logout(true);
          throw err;
        }
        offlineMode = true;
        var cached = readCache();
        if (cached) {
          state = cached;
          toast('Нет связи с сервером — работаем офлайн', { ms: 2500 });
        } else {
          state = emptyState(activeUser && activeUser.name);
          toast('Нет связи с сервером', { ms: 2500 });
        }
        return state;
      });
  }

  /* Сохранение: сразу в кэш, на сервер — асинхронно с дебаунсом. */
  function saveState() {
    if (!state) return;
    writeCache(state);
    if (!activeUser || offlineMode) return;
    if (!API.getToken()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      API.putState(state).catch(function (err) {
        if (err && err.status === 401) { logout(true); return; }
        console.warn('Cashfy: не удалось сохранить на сервер', err);
      });
    }, 400);
  }
  function saveStateNow() {
    clearTimeout(saveTimer);
    if (state) writeCache(state);
    if (!activeUser || offlineMode || !API.getToken()) return Promise.resolve();
    return API.putState(state).catch(function () { });
  }

  /* ------------------------------------------------------------------
     Авторизация через API
  ------------------------------------------------------------------ */
  function showAuth() {
    if (!authRoot) return;
    document.documentElement.classList.add('auth-mode');
    if (main) main.innerHTML = '';
    var mode = ui.authMode || 'login';
    authRoot.innerHTML =
      '<div class="auth-card">' +
      '<div class="auth-logo">' +
      '<span class="logo-mark" aria-hidden="true"><svg viewBox="0 0 32 32">' +
      '<circle cx="16" cy="16" r="16" fill="#1DB954"/>' +
      '<rect x="9" y="16" width="3" height="8" rx="1.5" fill="#04240f"/>' +
      '<rect x="14.5" y="9" width="3" height="15" rx="1.5" fill="#04240f"/>' +
      '<rect x="20" y="13" width="3" height="11" rx="1.5" fill="#04240f"/>' +
      '</svg></span>' +
      '<span class="logo-text">cashfy</span>' +
      '</div>' +
      '<h1 class="auth-title">' + (mode === 'register' ? 'Создать аккаунт' : 'Вход в Cashfy') + '</h1>' +
      '<p class="auth-sub">' + (mode === 'register' ? 'Твои траты будут синхронизироваться с сервером.' : 'Войди, чтобы вернуться к своим тратам.') + '</p>' +
      '<div class="auth-tabs">' +
      '<button type="button" class="auth-tab' + (mode === 'login' ? ' is-on' : '') + '" data-action="auth-tab" data-tab="login">Вход</button>' +
      '<button type="button" class="auth-tab' + (mode === 'register' ? ' is-on' : '') + '" data-action="auth-tab" data-tab="register">Регистрация</button>' +
      '</div>' +
      '<form id="authForm" class="auth-form" novalidate>' +
      '<label class="field"><span>Имя</span><input id="authName" maxlength="24" autocomplete="username" placeholder="Например, Артём"></label>' +
      '<label class="field"><span>Пароль</span><input id="authPass" type="password" autocomplete="current-password" placeholder="Минимум 4 символа"></label>' +
      (mode === 'register' ? '<label class="field"><span>Повтори пароль</span><input id="authPass2" type="password" autocomplete="new-password"></label>' : '') +
      '<div class="auth-error" id="authError"></div>' +
      '<button class="btn btn-green auth-submit" type="submit">' + (mode === 'register' ? 'Создать аккаунт' : 'Войти') + '</button>' +
      '</form>' +
      '<div class="auth-alt"><button type="button" class="auth-link" data-action="auth-guest">Продолжить как гость</button></div>' +
      '<p class="auth-note">Данные синхронизируются с сервером. Без входа — только в этой сессии.</p>' +
      '</div>';
    var nameEl = document.getElementById('authName');
    if (nameEl) nameEl.focus();
  }
  function hideAuth() {
    if (!authRoot) return;
    authRoot.innerHTML = '';
    document.documentElement.classList.remove('auth-mode');
  }
  function authError(msg) {
    var el = document.getElementById('authError');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  }
  function submitAuth() {
    var nameEl = document.getElementById('authName');
    var passEl = document.getElementById('authPass');
    var pass2El = document.getElementById('authPass2');
    var name = (nameEl ? nameEl.value : '').trim();
    var pass = passEl ? passEl.value : '';
    var mode = ui.authMode || 'login';
    if (name.length < 2) return authError('Имя — минимум 2 символа');
    if (pass.length < 4) return authError('Пароль — минимум 4 символа');
    if (mode === 'register' && pass2El && pass2El.value !== pass) return authError('Пароли не совпадают');

    var submitBtn = document.querySelector('.auth-submit');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Подожди…'; }

    var promise = mode === 'register' ? API.register(name, pass) : API.login(name, pass);
    promise
      .then(function (res) {
        if (!res || !res.token) throw new Error('Сервер не вернул токен');
        API.setToken(res.token);
        return API.me();
      })
      .then(function (me) {
        activeUser = { id: me.id, name: me.name };
        return afterLogin(mode === 'register');
      })
      .catch(function (err) {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = mode === 'register' ? 'Создать аккаунт' : 'Войти'; }
        authError((err && err.message) || 'Не удалось войти. Проверь имя и пароль.');
      });
  }
  function guestLogin() {
    var submitBtn = document.querySelector('.auth-submit');
    if (submitBtn) { submitBtn.disabled = true; }
    API.guest()
      .then(function (res) {
        if (!res || !res.token) throw new Error('Сервер не вернул токен гостя');
        API.setToken(res.token);
        return API.me();
      })
      .then(function (me) {
        activeUser = { id: me.id, name: me.name || 'Гость' };
        return afterLogin(false);
      })
      .catch(function (err) {
        if (submitBtn) { submitBtn.disabled = false; }
        authError((err && err.message) || 'Не удалось войти как гость');
      });
  }
  /* После логина: если на сервере пусто, а в кэше есть данные — предложить миграцию. */
  function afterLogin(isNewAccount) {
    return syncFromServer().then(function () {
      if (isNewAccount || !state.transactions.length) {
        var migrated = localStorage.getItem(LOCAL_MIGRATION_KEY);
        if (!migrated) {
          var legacy = null;
          try { legacy = JSON.parse(localStorage.getItem('cashfy.state.v1') || 'null'); } catch (e) { }
          if (legacy && Array.isArray(legacy.transactions) && legacy.transactions.length) {
            if (window.confirm('Найдены локальные траты из прошлой сессии (' + legacy.transactions.length + ' шт.). Загрузить их в аккаунт?')) {
              state.transactions = state.transactions.concat(legacy.transactions);
              saveState();
            }
            localStorage.setItem(LOCAL_MIGRATION_KEY, '1');
          }
        }
        if (!state.transactions.length) {
          state.transactions = D.seedTransactions();
          state.__fresh = true;
          saveState();
        }
      }
      if (state.__fresh) { delete state.__fresh; saveState(); }
      mpReset();
      hideAuth();
      render();
      toast('С возвращением, ' + (activeUser.name || 'друг'));
    });
  }
  function logout(silent) {
    stopAudio();
    API.logout().catch(function () { });
    API.clearToken();
    activeUser = null;
    state = null;
    ui.authMode = 'login';
    offlineMode = false;
    if (main) main.innerHTML = '';
    if (playerEl) playerEl.innerHTML = '';
    if (mobileNav) mobileNav.innerHTML = '';
    showAuth();
    if (!silent) toast('Вы вышли из аккаунта');
  }
  function deleteAccount() {
    if (!activeUser) return;
    if (!window.confirm('Удалить аккаунт «' + activeUser.name + '» и все данные на сервере?')) return;
    API.deleteMe()
      .then(function () {
        try { localStorage.removeItem(cacheKey()); } catch (e) { }
        logout();
        toast('Аккаунт удалён');
      })
      .catch(function (err) { toast('Не удалось удалить: ' + (err.message || 'ошибка')); });
  }
  function boot() {
    if (!API.getToken()) { showAuth(); return Promise.resolve(); }
    return API.me()
      .then(function (me) {
        activeUser = { id: me.id, name: me.name };
        return syncFromServer();
      })
      .then(function () {
        if (!state.transactions.length) {
          state.transactions = D.seedTransactions();
          state.__fresh = true;
          saveState();
        }
        if (state.__fresh) { delete state.__fresh; saveState(); }
        mpReset();
        hideAuth();
        render();
      })
      .catch(function (err) {
        if (err && err.status === 401) {
          API.clearToken();
          showAuth();
          return;
        }
        showAuth();
      });
  }

  /* ------------------------------------------------------------------
     Утилиты
  ------------------------------------------------------------------ */
  function icon(name, cls) {
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
  }
  function money(n, opts) {
    opts = opts || {};
    var cur = state.settings.currency || '₽';
    var v = Math.round(Math.abs(Number(n) || 0));
    var s = U.fmtNum(v) + ' ' + cur;
    if (Number(n) < 0) return '−' + s;
    if (opts.plus && Number(n) > 0) return '+' + s;
    return s;
  }
  function hexA(hex, a) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h.split('').map(function (x) { return x + x; }).join('');
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }
  function cat(id) { return D.CAT_BY_ID[id] || CATS[CATS.length - 1]; }
  function catStyle(c) { return '--c1:' + c.color + ';--c2:' + c.color2; }
  function ini(name) { return String(name || 'A').trim().charAt(0).toUpperCase() || 'A'; }
  function todayKey() { return U.ymd(new Date()); }
  function daysAgoKey(n) { return U.ymd(U.addDays(new Date(), -n)); }
  function budgetOf(id) {
    var b = state.budgets[id];
    return typeof b === 'number' ? b : cat(id).budget;
  }
  function sum(list) { return list.reduce(function (s, t) { return s + t.amount; }, 0); }
  function txToday() {
    var k = todayKey();
    return state.transactions.filter(function (t) { return t.date === k; });
  }
  function txLastDays(days) {
    var end = todayKey();
    var start = daysAgoKey(days - 1);
    return state.transactions.filter(function (t) { return t.date >= start && t.date <= end; });
  }
  function txThisMonth() {
    var pref = todayKey().slice(0, 7);
    return state.transactions.filter(function (t) { return t.date.slice(0, 7) === pref; });
  }
  function txOfCategory(id) {
    return state.transactions.filter(function (t) { return t.categoryId === id; })
      .sort(function (a, b) { return (a.date + a.time) < (b.date + b.time) ? 1 : -1; });
  }
  function byCategory(list) {
    var o = {};
    CATS.forEach(function (c) { o[c.id] = 0; });
    list.forEach(function (t) { o[t.categoryId] = (o[t.categoryId] || 0) + t.amount; });
    return o;
  }
  function sortedCats(list) {
    var o = byCategory(list);
    return CATS.map(function (c) { return { cat: c, value: o[c.id] || 0 }; })
      .filter(function (x) { return x.value > 0; })
      .sort(function (a, b) { return b.value - a.value; });
  }
  function dailySeries(list, days) {
    var map = {};
    list.forEach(function (t) { map[t.date] = (map[t.date] || 0) + t.amount; });
    var out = [];
    for (var i = days - 1; i >= 0; i--) {
      var d = U.addDays(new Date(), -i);
      var k = U.ymd(d);
      out.push({ key: k, date: d, value: map[k] || 0 });
    }
    return out;
  }
  function weekdayTotals(list) {
    var arr = [0, 0, 0, 0, 0, 0, 0];
    list.forEach(function (t) { arr[(U.parseYmd(t.date).getDay() + 6) % 7] += t.amount; });
    return arr;
  }
  function topMerchants(list, limit) {
    var map = {};
    list.forEach(function (t) {
      var k = t.title;
      if (!map[k]) map[k] = { title: k, sum: 0, count: 0, categoryId: t.categoryId };
      map[k].sum += t.amount;
      map[k].count++;
    });
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return b.sum - a.sum; })
      .slice(0, limit || 5);
  }
  function streak() {
    var set = {};
    state.transactions.forEach(function (t) { set[t.date] = 1; });
    var n = 0;
    for (var i = 0; i < 400; i++) {
      var k = U.ymd(U.addDays(new Date(), -i));
      if (set[k]) n++;
      else if (i === 0) continue;
      else break;
    }
    return n;
  }
  function daysLeftInMonth() {
    var now = new Date();
    return U.daysInMonth(now) - now.getDate();
  }
  function greeting() {
    var h = new Date().getHours();
    if (h < 5) return 'Доброй ночи';
    if (h < 12) return 'Доброе утро';
    if (h < 18) return 'Добрый день';
    return 'Добрый вечер';
  }
  function parseAmount(v) {
    if (typeof v === 'number') return v;
    var s = String(v == null ? '' : v).replace(/\s|₽/g, '').replace(',', '.');
    var n = Number(s);
    return isFinite(n) ? n : 0;
  }
  function pctOf(part, whole) { return whole ? Math.min(100, (part / whole) * 100) : 0; }
  function barClass(part, whole) {
    var p = whole ? part / whole : 0;
    if (p > 1) return 'over';
    if (p > 0.85) return 'warn';
    return '';
  }
  function plural(n, one, few, many) { return U.plural(n, one, few, many); }

  /* ------------------------------------------------------------------
     Подборки треков
  ------------------------------------------------------------------ */
  var SOURCES = [
    { id: 'spotify', label: 'Spotify', url: function (q) { return 'https://open.spotify.com/search/' + encodeURIComponent(q); } },
    { id: 'youtube', label: 'YouTube', url: function (q) { return 'https://music.youtube.com/search?q=' + encodeURIComponent(q); } },
    { id: 'yandex', label: 'Я.Музыка', url: function (q) { return 'https://music.yandex.ru/search?text=' + encodeURIComponent(q); } },
    { id: 'soundcloud', label: 'SoundCloud', url: function (q) { return 'https://soundcloud.com/search?q=' + encodeURIComponent(q); } }
  ];
  function moodOf(id) {
    var m = (D.MOODS || {})[id];
    return m || { vibe: 'Настроение категории', tracks: [] };
  }
  function customPicks(id) {
    var all = (state.picks && typeof state.picks === 'object') ? state.picks : {};
    return Array.isArray(all[id]) ? all[id] : [];
  }

  /* ------------------------------------------------------------------
     AI-подборка музыки
  ------------------------------------------------------------------ */
  var CHART_TTL = 6 * 60 * 60 * 1000;
  var CHART_COUNTRIES = [
    { id: 'ru', label: 'Россия' },
    { id: 'us', label: 'США' },
    { id: 'gb', label: 'Великобритания' },
    { id: 'de', label: 'Германия' },
    { id: 'kz', label: 'Казахстан' }
  ];
  var chartCache = null;
  var chartLoading = null;
  var chartError = '';
  var CHART_KEY = 'cashfy.chart.v1';

  function chartCountry() { return (state && state.settings && state.settings.chartCountry) || 'ru'; }
  function countryLabel(cc) {
    for (var i = 0; i < CHART_COUNTRIES.length; i++) if (CHART_COUNTRIES[i].id === cc) return CHART_COUNTRIES[i].label;
    return cc.toUpperCase();
  }
  function readChartCache() {
    if (chartCache) return chartCache;
    try {
      var c = JSON.parse(localStorage.getItem(CHART_KEY) || 'null');
      if (c && Array.isArray(c.items) && c.items.length) { chartCache = c; return c; }
    } catch (e) { }
    return null;
  }
  function chartIsFresh(c) { return !!c && (Date.now() - c.ts) < CHART_TTL; }
  function parseChartFeed(data, cc) {
    var entries = (data && data.feed && data.feed.entry) || [];
    var items = [];
    entries.forEach(function (e, i) {
      var name = e['im:name'] ? e['im:name'].label : '';
      var artist = e['im:artist'] ? e['im:artist'].label : '';
      var images = e['im:image'] || [];
      var art = images.length ? images[images.length - 1].label : '';
      var attrs = (e.category && e.category.attributes) || {};
      var appUrl = '', preview = '';
      (e.link || []).forEach(function (l) {
        var a = l.attributes || {};
        if (a.type === 'audio/x-m4a' && a.href) preview = a.href;
        else if (a.rel === 'alternate' && a.href) appUrl = a.href;
      });
      if (!name || !artist) return;
      items.push({ rank: i + 1, name: name, artist: artist, art: art, genre: attrs.term || '', genreRu: attrs.label || '', appUrl: appUrl, preview: preview });
    });
    return { cc: cc, ts: Date.now(), items: items };
  }
  function loadChart(cc, force) {
    var cached = readChartCache();
    if (!force && cached && cached.cc === cc && chartIsFresh(cached)) return Promise.resolve(cached);
    if (chartLoading) return chartLoading;
    chartError = '';
    chartLoading = fetch('https://itunes.apple.com/' + cc + '/rss/topsongs/limit=50/json', { mode: 'cors' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        var chart = parseChartFeed(data, cc);
        if (!chart.items.length) throw new Error('пустой чарт');
        chartCache = chart;
        try { localStorage.setItem(CHART_KEY, JSON.stringify(chart)); } catch (e) { }
        return chart;
      })
      .catch(function (err) {
        chartError = 'нет связи с чартом';
        var fallback = readChartCache();
        if (fallback) return fallback;
        throw err;
      })
      .then(function (res) { chartLoading = null; return res; }, function (err) { chartLoading = null; throw err; });
    return chartLoading;
  }
  function hash01(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 1000) / 1000;
  }
  function moodProfile(id) { return (D.MOOD_PROFILES && D.MOOD_PROFILES[id]) || { keywords: [], genres: [] }; }
  function scoreTrack(item, profile, seed) {
    var text = (item.name + ' ' + item.artist + ' ' + (item.genre || '') + ' ' + (item.genreRu || '')).toLowerCase();
    var score = 0;
    (profile.keywords || []).forEach(function (k) { if (text.indexOf(String(k).toLowerCase()) >= 0) score += 34; });
    (profile.genres || []).forEach(function (g) {
      var gl = String(g).toLowerCase();
      var ig = String(item.genre || '').toLowerCase();
      if (ig && ig === gl) score += 26;
      else if (ig && ig.indexOf(gl) >= 0) score += 16;
    });
    score += Math.max(0, 15 - item.rank * 0.3);
    score += hash01(seed + '|' + item.name + '|' + item.artist) * 20;
    return score;
  }
  function pickForCategory(catId, seed, count) {
    var chart = readChartCache();
    if (!chart || !chart.items.length) return [];
    var profile = moodProfile(catId);
    var scored = chart.items.map(function (it) { return { item: it, score: scoreTrack(it, profile, seed) }; })
      .sort(function (a, b) { return b.score - a.score; });
    var picked = [], seen = {};
    scored.forEach(function (x) {
      if (picked.length >= count) return;
      var key = x.item.artist.toLowerCase();
      if (seen[key]) return;
      seen[key] = 1;
      picked.push(x);
    });
    var best = picked.length ? picked[0].score : 1;
    return picked.map(function (x, i) {
      return { item: x.item, match: Math.max(42, Math.min(99, Math.round((x.score / best) * 92 - i * 3))) };
    });
  }
  function svcUrl(kind, q) {
    var e = encodeURIComponent(q);
    if (kind === 'spotify') return 'https://open.spotify.com/search/' + e;
    if (kind === 'youtube') return 'https://music.youtube.com/search?q=' + e;
    if (kind === 'yandex') return 'https://music.yandex.ru/search?text=' + e;
    if (kind === 'apple') return 'https://music.apple.com/ru/search?term=' + e;
    return 'https://soundcloud.com/search?q=' + e;
  }
  function timeAgo(ts) {
    var min = Math.round(Math.max(0, Date.now() - ts) / 60000);
    if (min < 1) return 'только что';
    if (min < 60) return min + ' мин назад';
    var h = Math.round(min / 60);
    if (h < 24) return h + ' ч назад';
    return Math.round(h / 24) + ' дн назад';
  }
  function aiTrackRow(entry) {
    var it = entry.item;
    var q = it.artist + ' ' + it.name;
    var key = it.name + '|' + it.artist;
    var links = [['spotify', 'Spotify'], ['youtube', 'YouTube'], ['yandex', 'Я.Музыка'], ['apple', 'Apple Music']]
      .map(function (s) { return '<a class="src" href="' + svcUrl(s[0], q) + '" target="_blank" rel="noopener noreferrer">' + s[1] + '</a>'; }).join('');
    return '<div class="ai-track">' +
      '<button class="ai-play" type="button" data-action="ai-play" data-key="' + esc(key) + '" data-name="' + esc(it.name) + '" data-artist="' + esc(it.artist) + '" data-preview="' + esc(it.preview) + '" aria-label="Включить превью ' + esc(it.name) + '">' +
      '<svg class="ic" aria-hidden="true"><use href="#i-play"/></svg></button>' +
      (it.art ? '<img class="ai-art" src="' + esc(it.art) + '" alt="" loading="lazy" width="44" height="44" onerror="this.style.visibility=\'hidden\'">' : '<span class="ai-art ai-art-ph" aria-hidden="true"></span>') +
      '<div class="ai-main"><div class="ai-name">' + esc(it.name) + '</div><div class="ai-artist">' + esc(it.artist) + (it.genreRu ? ' · ' + esc(it.genreRu) : '') + '</div></div>' +
      '<div class="ai-rank"><span class="ai-match">' + entry.match + '%</span><span class="ai-place">#' + it.rank + ' в чарте</span></div>' +
      '<div class="pick-sources">' + links + '</div></div>';
  }
  function offlineTracks(c) {
    var mood = moodOf(c.id);
    return '<div class="pick-list">' + mood.tracks.map(function (t) {
      var query = t.artist + ' ' + t.title;
      var links = SOURCES.map(function (s) { return '<a class="src" href="' + s.url(query) + '" target="_blank" rel="noopener noreferrer">' + esc(s.label) + '</a>'; }).join('');
      return '<div class="pick"><div class="pick-main"><div class="pick-title">' + esc(t.title) + '</div><div class="pick-sub">' + esc(t.artist) + '</div></div><div class="pick-sources">' + links + '</div></div>';
    }).join('') + '</div>';
  }
  function aiInner(c, picks, opts) {
    opts = opts || {};
    var chart = readChartCache();
    var cc = chartCountry();
    var fresh = chart && chartIsFresh(chart) && chart.cc === cc;
    var countryOpts = CHART_COUNTRIES.map(function (x) { return '<option value="' + x.id + '"' + (x.id === cc ? ' selected' : '') + '>' + x.label + '</option>'; }).join('');
    var html = '<div class="panel-title">' + icon('spark') + 'AI-подборка по чартам</div>' +
      '<p class="hint picks-vibe">Смотрю топ Apple Music и подбираю под настроение категории. «' + esc(moodOf(c.id).vibe) + '».</p>';
    html += '<div class="ai-meta"><span class="ai-badge">ИИ</span>' +
      '<span class="hint ai-updated">' + (chart ? 'чарт ' + esc(countryLabel(chart.cc)) + ' · обновлён ' + timeAgo(chart.ts) : 'чарт ещё не загружен') + '</span>' +
      '<select id="aiCountry" class="ai-select" aria-label="Страна чарта">' + countryOpts + '</select>' +
      '<button class="btn btn-dark ai-refresh" type="button" data-action="ai-refresh" data-id="' + c.id + '">Пересчитать</button></div>';
    if (!fresh && !picks.length && !opts.error) {
      html += '<div class="ai-loading"><span class="ai-spinner" aria-hidden="true"></span>Загружаю чарт и подбираю треки…</div>';
    } else if (picks.length) {
      html += '<div class="ai-list">' + picks.map(aiTrackRow).join('') + '</div>';
      if (!fresh) html += '<p class="hint ai-warn">' + (opts.error ? 'Чарт не обновился (' + esc(opts.error) + '), показываю сохранённую подборку.' : 'Показываю сохранённый чарт.') + '</p>';
    } else {
      html += '<div class="ai-offline">Не получилось загрузить чарт' + (opts.error ? ' (' + esc(opts.error) + ')' : '') + '. Включаю офлайн-подборку.</div>' + offlineTracks(c);
    }
    var mine = customPicks(c.id);
    if (mine.length) {
      html += '<div class="ai-mine">' + mine.map(function (p, i) {
        return '<div class="pick pick-mine"><div class="pick-main"><div class="pick-title">' + esc(p.title) + '</div><div class="pick-sub">своя ссылка</div></div>' +
          '<div class="pick-sources"><a class="src" href="' + esc(p.url) + '" target="_blank" rel="noopener noreferrer">Открыть</a>' +
          '<button class="pick-del" type="button" data-action="del-pick" data-id="' + c.id + '" data-index="' + i + '" aria-label="Убрать трек"><svg class="ic" aria-hidden="true"><use href="#i-trash"/></svg></button></div></div>';
      }).join('') + '</div>';
    }
    html += '<div class="pick-form"><input id="pickUrl" type="url" placeholder="Ссылка на трек (любой сайт)" autocomplete="off">' +
      '<input id="pickTitle" type="text" placeholder="Название (необязательно)" maxlength="60" autocomplete="off">' +
      '<button class="btn btn-green" type="button" data-action="add-pick" data-id="' + c.id + '">Добавить</button></div>';
    return html;
  }
  function renderPicks(c) {
    var cc = chartCountry();
    var chart = readChartCache();
    var fresh = chart && chartIsFresh(chart) && chart.cc === cc;
    var picks = fresh ? pickForCategory(c.id, 'seed' + (ui.aiSeed || 1), 5) : [];
    if (!fresh && !chartLoading) {
      loadChart(cc, false).then(function () { refreshAi(c.id); }).catch(function () { refreshAi(c.id); });
    }
    return '<div class="panel-box picks" id="aiPicks" data-cat="' + c.id + '">' + aiInner(c, picks, { error: chartError }) + '</div>';
  }
  function refreshAi(catId) {
    var box = document.getElementById('aiPicks');
    if (!box) return;
    var c = cat(catId);
    if (!c) return;
    box.innerHTML = aiInner(c, pickForCategory(c.id, 'seed' + (ui.aiSeed || 1), 5), { error: chartError });
  }
  function aiRefresh(catId) {
    ui.aiSeed = (ui.aiSeed || 1) + 1;
    chartCache = null;
    loadChart(chartCountry(), true).then(function () {
      refreshAi(catId);
      toast('Подборка пересчитана');
    }).catch(function () {
      refreshAi(catId);
      toast('Чарт не загрузился — оставил сохранённую подборку');
    });
  }
  function aiCountryChanged(cc, catId) {
    if (!state) return;
    state.settings.chartCountry = cc;
    saveState();
    ui.aiSeed = 1;
    var box = document.getElementById('aiPicks');
    if (box) box.innerHTML = aiInner(cat(catId), [], {});
    loadChart(cc, false).then(function () { refreshAi(catId); }).catch(function () { refreshAi(catId); });
  }

  /* ------------------------------------------------------------------
     Музыкальный плеер
  ------------------------------------------------------------------ */
  var EQ_HTML = '<span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>';
  var PLAY_HTML = '<svg class="ic" aria-hidden="true"><use href="#i-play"/></svg>';
  var PAUSE_HTML = '<svg class="ic" aria-hidden="true"><use href="#i-pause"/></svg>';
  var mp = { queue: [], index: -1, track: null, playing: false, currentTime: 0, duration: 30, seeking: false, seekTimer: null };
  var mpAudio = null;
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function paintRange(input, value, max) {
    if (!input) return;
    var pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
    input.style.background = 'linear-gradient(90deg, var(--green) 0%, var(--green) ' + pct.toFixed(2) + '%, #3a3a3a ' + pct.toFixed(2) + '%, #3a3a3a 100%)';
  }
  function mpQueueFromDom() {
    var rows = document.querySelectorAll('#aiPicks .ai-track');
    var out = [];
    Array.prototype.forEach.call(rows, function (row) {
      var btn = row.querySelector('.ai-play');
      if (!btn) return;
      var img = row.querySelector('.ai-art');
      out.push({ key: btn.getAttribute('data-key'), name: btn.getAttribute('data-name'), artist: btn.getAttribute('data-artist'), preview: btn.getAttribute('data-preview'), art: img ? img.getAttribute('src') : '' });
    });
    return out;
  }
  function stopAudio() { if (mpAudio) { try { mpAudio.pause(); } catch (e) { } mpAudio = null; } mp.playing = false; }
  function playFromButton(btn) {
    var key = btn.getAttribute('data-key');
    if (mp.track && mp.track.key === key) { togglePlay(); return; }
    var queue = mpQueueFromDom();
    var idx = -1;
    for (var i = 0; i < queue.length; i++) if (queue[i].key === key) { idx = i; break; }
    if (idx < 0) return;
    playIndex(queue, idx);
  }
  function playIndex(queue, idx) {
    if (!queue || !queue.length) return;
    idx = ((idx % queue.length) + queue.length) % queue.length;
    var track = queue[idx];
    if (!track.preview) { toast('У этого трека нет превью — открой его в сервисе'); return; }
    stopAudio();
    mp.queue = queue; mp.index = idx; mp.track = track; mp.currentTime = 0; mp.duration = 30; mp.playing = true;
    mpAudio = new Audio(track.preview);
    mpAudio.volume = 0.9; mpAudio.preload = 'auto';
    mpAudio.addEventListener('loadedmetadata', function () { if (isFinite(mpAudio.duration) && mpAudio.duration > 0) mp.duration = mpAudio.duration; updateMpProgress(); });
    mpAudio.addEventListener('timeupdate', function () { if (mp.seeking) return; mp.currentTime = mpAudio.currentTime; updateMpProgress(); });
    mpAudio.addEventListener('play', function () { mp.playing = true; renderPlayer(); syncRowStates(); });
    mpAudio.addEventListener('pause', function () { mp.playing = false; renderPlayer(); syncRowStates(); });
    mpAudio.addEventListener('ended', function () { if (mp.index + 1 < mp.queue.length) playIndex(mp.queue, mp.index + 1); else { mp.playing = false; renderPlayer(); syncRowStates(); } });
    mpAudio.addEventListener('error', function () { toast('Превью не открылось — включи трек в сервисе'); mpClose(); });
    renderPlayer(); syncRowStates();
    var pr = mpAudio.play();
    if (pr && pr.then) pr.then(function () { mp.playing = true; renderPlayer(); syncRowStates(); }).catch(function () { toast('Браузер не разрешил автозапуск — нажми ▶ ещё раз'); mp.playing = false; renderPlayer(); syncRowStates(); });
  }
  function togglePlay() {
    if (!mp.track) return;
    if (!mpAudio) { playIndex(mp.queue, mp.index); return; }
    if (mpAudio.paused) { mpAudio.play(); mp.playing = true; } else { mpAudio.pause(); mp.playing = false; }
    renderPlayer(); syncRowStates();
  }
  function mpNext() { if (!mp.queue.length) return; playIndex(mp.queue, mp.index + 1); }
  function mpPrev() {
    if (!mp.queue.length) return;
    if (mpAudio && mpAudio.currentTime > 3) { try { mpAudio.currentTime = 0; } catch (e) { } mp.currentTime = 0; updateMpProgress(); return; }
    playIndex(mp.queue, mp.index - 1);
  }
  function mpClose() {
    stopAudio(); mp.track = null; mp.queue = []; mp.index = -1; mp.currentTime = 0;
    if (playerEl) renderPlayer();
    syncRowStates();
  }
  function mpReset() { stopAudio(); mp.track = null; mp.queue = []; mp.index = -1; mp.currentTime = 0; mp.seeking = false; }
  function mpSeekTo(value) {
    if (!mpAudio) return;
    mp.seeking = true;
    var v = Math.max(0, Number(value) || 0);
    try { mpAudio.currentTime = v; } catch (e) { }
    mp.currentTime = v; updateMpProgress();
    clearTimeout(mp.seekTimer);
    mp.seekTimer = setTimeout(function () { mp.seeking = false; }, 350);
  }
  function updateMpProgress() {
    var seek = document.getElementById('mpSeek');
    var dur = mp.duration || 30;
    var cur = Math.min(mp.currentTime || 0, dur);
    if (seek) { if (!mp.seeking) { seek.max = dur; seek.value = cur; } paintRange(seek, mp.seeking ? Number(seek.value) : cur, dur); }
    var t0 = document.querySelector('.mp-t0');
    var t1 = document.querySelector('.mp-t1');
    if (t0) t0.textContent = fmtTime(mp.seeking ? Number((seek || {}).value || cur) : cur);
    if (t1) t1.textContent = fmtTime(dur);
  }
  function syncRowStates() {
    Array.prototype.forEach.call(document.querySelectorAll('.ai-play'), function (btn) {
      var isCur = !!(mp.track && btn.getAttribute('data-key') === mp.track.key);
      var active = isCur && mp.playing;
      btn.classList.toggle('is-playing', active);
      btn.classList.toggle('is-paused', isCur && !mp.playing);
      btn.innerHTML = active ? EQ_HTML : PLAY_HTML;
      btn.setAttribute('aria-label', active ? 'Пауза' : 'Включить превью');
    });
  }
  function renderMusicPlayer() {
    if (!playerEl || !mp.track) return;
    var t = mp.track;
    var dur = mp.duration || 30;
    var cur = Math.min(mp.currentTime || 0, dur);
    var cover = t.art ? '<img src="' + esc(t.art) + '" alt="" class="mp-art">' : '<span class="mp-art mp-art-ph" aria-hidden="true">' + icon('spark') + '</span>';
    playerEl.className = 'player music';
    playerEl.innerHTML =
      '<div class="player-inner"><div class="p-left"><span class="mp-cover">' + cover + (mp.playing ? EQ_HTML : '') + '</span>' +
      '<span class="p-meta"><span class="p-title">' + esc(t.name) + '</span><span class="p-sub">' + esc(t.artist) + '</span></span></div>' +
      '<div class="p-center"><div class="mp-controls">' +
      '<button class="mp-btn" type="button" data-action="mp-prev" aria-label="Предыдущий трек">' + icon('prev') + '</button>' +
      '<button class="mp-btn mp-play" type="button" data-action="mp-toggle" aria-label="' + (mp.playing ? 'Пауза' : 'Играть') + '">' + (mp.playing ? PAUSE_HTML : PLAY_HTML) + '</button>' +
      '<button class="mp-btn" type="button" data-action="mp-next" aria-label="Следующий трек">' + icon('next') + '</button></div>' +
      '<div class="mp-seek"><span class="mp-time mp-t0">' + fmtTime(cur) + '</span>' +
      '<input id="mpSeek" class="mp-range" type="range" min="0" max="' + dur + '" step="0.1" value="' + cur.toFixed(2) + '" aria-label="Перемотка трека">' +
      '<span class="mp-time mp-t1">' + fmtTime(dur) + '</span></div></div>' +
      '<div class="p-right"><button class="mp-btn mp-play-mobile" type="button" data-action="mp-toggle" aria-label="' + (mp.playing ? 'Пауза' : 'Играть') + '">' + (mp.playing ? PAUSE_HTML : PLAY_HTML) + '</button>' +
      '<button class="icon-btn mp-close" type="button" data-action="mp-close" aria-label="Закрыть плеер">' + icon('x') + '</button></div></div>';
    paintRange(document.getElementById('mpSeek'), cur, dur);
  }
  function addPick(catId) {
    var urlEl = document.getElementById('pickUrl');
    var titleEl = document.getElementById('pickTitle');
    var url = (urlEl ? urlEl.value : '').trim();
    if (!/^https?:\/\/\S+$/i.test(url)) {
      if (urlEl) { urlEl.focus(); urlEl.style.borderColor = 'var(--red)'; }
      toast('Нужна ссылка, начинающаяся с http:// или https://');
      return;
    }
    var title = (titleEl && titleEl.value.trim()) || 'Мой трек';
    if (!state.picks || typeof state.picks !== 'object') state.picks = {};
    if (!Array.isArray(state.picks[catId])) state.picks[catId] = [];
    state.picks[catId].push({ title: title, url: url });
    saveState(); render();
    toast('Трек добавлен в подборку');
  }
  function delPick(catId, index) {
    var arr = state.picks && state.picks[catId];
    if (!Array.isArray(arr) || index < 0 || index >= arr.length) return;
    arr.splice(index, 1);
    saveState(); render();
    toast('Трек убран из подборки');
  }

  /* ------------------------------------------------------------------
     Импорт CSV
  ------------------------------------------------------------------ */
  var CSV_KEYS = {
    date: ['дата', 'date', 'день'],
    amount: ['сумма', 'amount', 'sum', 'стоимость'],
    category: ['категория', 'category', 'раздел', 'тип'],
    title: ['название', 'описание', 'title', 'магазин', 'merchant', 'контрагент', 'комментарий'],
    note: ['заметка', 'note', 'примечание']
  };
  function splitCsvLine(line, delim) {
    var out = [], cur = '', quoted = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (quoted) {
        if (ch === '"') { if (line.charAt(i + 1) === '"') { cur += '"'; i++; } else quoted = false; } else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === delim) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map(function (s) { return s.trim(); });
  }
  function detectDelim(line) {
    if (line.indexOf('\t') >= 0) return '\t';
    if (line.indexOf(';') >= 0) return ';';
    return ',';
  }
  function parseCsvAmount(v) {
    var s = String(v == null ? '' : v).replace(/\u00a0|\s/g, '').replace(/[₽$€]/g, '').replace(',', '.');
    var n = parseFloat(s);
    return isFinite(n) ? Math.abs(n) : 0;
  }
  function parseCsvDate(v) {
    var s = String(v == null ? '' : v).trim();
    var m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return m[1] + '-' + U.pad2(Number(m[2])) + '-' + U.pad2(Number(m[3]));
    if ((m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/))) return m[3] + '-' + U.pad2(Number(m[2])) + '-' + U.pad2(Number(m[1]));
    if ((m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2})$/))) return '20' + m[3] + '-' + U.pad2(Number(m[2])) + '-' + U.pad2(Number(m[1]));
    return null;
  }
  function matchCategory(v) {
    var s = String(v || '').trim().toLowerCase();
    if (!s) return null;
    for (var i = 0; i < CATS.length; i++) {
      var c = CATS[i];
      var name = c.name.toLowerCase();
      if (c.id.toLowerCase() === s || name === s || s.indexOf(name) >= 0) return c.id;
    }
    return null;
  }
  function parseCsv(text) {
    var lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
    if (!lines.length) return { rows: [], skipped: 0, hasHeader: false };
    var delim = detectDelim(lines[0]);
    var first = splitCsvLine(lines[0], delim);
    var lower = first.map(function (s) { return s.toLowerCase(); });
    var idx = {};
    Object.keys(CSV_KEYS).forEach(function (key) {
      var aliases = CSV_KEYS[key];
      for (var a = 0; a < aliases.length; a++) {
        for (var i = 0; i < lower.length; i++) { if (lower[i].indexOf(aliases[a]) >= 0) { idx[key] = i; return; } }
      }
    });
    var hasHeader = idx.date != null || idx.amount != null;
    var body = hasHeader ? lines.slice(1) : lines;
    var rows = [], skipped = 0;
    body.forEach(function (line) {
      var cells = splitCsvLine(line, delim);
      var raw = {
        date: idx.date != null ? cells[idx.date] : cells[0],
        amount: idx.amount != null ? cells[idx.amount] : cells[1],
        category: idx.category != null ? cells[idx.category] : cells[2],
        title: idx.title != null ? cells[idx.title] : cells[3],
        note: idx.note != null ? cells[idx.note] : cells[4]
      };
      var amount = parseCsvAmount(raw.amount);
      if (!(amount > 0)) { skipped++; return; }
      rows.push({ amount: amount, date: parseCsvDate(raw.date) || todayKey(), categoryId: matchCategory(raw.category) || 'other', title: String(raw.title || '').trim() || 'Импорт', note: String(raw.note || '').trim() });
    });
    return { rows: rows, skipped: skipped, hasHeader: hasHeader };
  }
  var pendingImport = null;
  function onFileChosen(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var parsed = parseCsv(String(reader.result || ''));
      pendingImport = parsed.rows;
      var box = document.getElementById('importPreview');
      if (!box) return;
      if (!parsed.rows.length) {
        box.innerHTML = '<p class="hint" style="margin-top:12px;color:var(--red)">Не нашёл ни одной траты. Нужны колонки с датой и суммой.</p>';
        return;
      }
      var preview = parsed.rows.slice(0, 5).map(function (r) {
        return '<tr><td>' + esc(r.date) + '</td><td>' + esc(cat(r.categoryId).name) + '</td><td>' + esc(r.title) + '</td><td class="num">' + money(r.amount) + '</td></tr>';
      }).join('');
      box.innerHTML = '<div class="import-preview"><p class="hint">Нашёл <b>' + parsed.rows.length + '</b> ' + plural(parsed.rows.length, 'трату', 'траты', 'трат') +
        (parsed.skipped ? ' · пропущено строк: ' + parsed.skipped : '') + '</p>' +
        '<table class="import-table"><thead><tr><th>Дата</th><th>Категория</th><th>Название</th><th class="num">Сумма</th></tr></thead><tbody>' + preview + '</tbody></table>' +
        '<div class="row-actions"><button class="btn btn-green" type="button" data-action="apply-import">Импортировать ' + parsed.rows.length + '</button>' +
        '<button class="btn btn-dark" type="button" data-action="cancel-import">Отмена</button></div></div>';
    };
    reader.readAsText(file, 'utf-8');
  }
  function applyImport() {
    if (!pendingImport || !pendingImport.length) return;
    var n = 0;
    pendingImport.forEach(function (r) {
      state.transactions.push({ id: 'imp' + Date.now().toString(36) + '-' + (n++), amount: r.amount, title: r.title, categoryId: r.categoryId, date: r.date, time: '12:00', note: r.note });
    });
    pendingImport = null;
    saveState(); render();
    toast('Импортировано ' + n + ' ' + plural(n, 'трата', 'траты', 'трат'));
  }
  function cancelImport() {
    pendingImport = null;
    var box = document.getElementById('importPreview');
    if (box) box.innerHTML = '';
  }
  function downloadFile(name, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function downloadTemplate() {
    downloadFile('cashfy-template.csv',
      '\uFEFFдата;сумма;категория;название;заметка\n05.11.2026;450,00;Еда;Додо Пицца;обед\n06.11.2026;199,00;Подписки;Spotify Premium;автоплатёж\n07.11.2026;80,00;Транспорт;Метро;поездка\n',
      'text/csv;charset=utf-8');
    toast('Шаблон CSV скачан');
  }

  /* ------------------------------------------------------------------
     Роутер
  ------------------------------------------------------------------ */
  function parseRoute() {
    var h = (location.hash || '').replace(/^#\/?/, '');
    return h.split('/').filter(Boolean).map(function (p) { try { return decodeURIComponent(p); } catch (e) { return p; } });
  }
  function currentView() { return parseRoute()[0] || 'home'; }
  function go(path) { if (location.hash === '#' + path) render(); else location.hash = '#' + path; }
  function onHashChange() { render(); if (main) main.scrollTop = 0; }

  /* ------------------------------------------------------------------
     Рендер
  ------------------------------------------------------------------ */
  function render() {
    if (!main || !state) return;
    var route = parseRoute();
    var view = route[0] || 'home';
    var html;
    switch (view) {
      case 'categories': html = viewCategories(); break;
      case 'cat': html = viewCategory(route[1]); break;
      case 'stats': html = viewStats(); break;
      case 'recap': html = viewRecap(); break;
      case 'settings': html = viewSettings(); break;
      case 'search': html = viewSearch(); break;
      default: html = viewHome(); view = 'home';
    }
    if (lastHash !== location.hash) { main.scrollTop = 0; lastHash = location.hash; }
    main.innerHTML = html;
    afterRender();
    renderSidebar();
    renderPlayer();
    renderMobileNav();
    syncNav(view, route[1]);
  }
  function afterRender() {
    animateCounts();
    var q = document.getElementById('q');
    if (q) { q.focus(); var len = q.value.length; try { q.setSelectionRange(len, len); } catch (e) { } }
    syncRowStates();
  }
  function animateCounts() {
    var nodes = main.querySelectorAll('[data-count]');
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    Array.prototype.forEach.call(nodes, function (el) {
      var to = Number(el.getAttribute('data-count')) || 0;
      var suffix = el.getAttribute('data-suffix') || '';
      if (reduced || to === 0) { el.textContent = U.fmtNum(to) + suffix; return; }
      var t0 = Date.now();
      var dur = 850;
      function step() {
        var p = Math.max(0, Math.min(1, (Date.now() - t0) / dur));
        var e = 1 - Math.pow(1 - p, 3);
        el.textContent = U.fmtNum(to * e) + suffix;
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
      setTimeout(function () { el.textContent = U.fmtNum(to) + suffix; }, dur + 150);
    });
  }
  function syncNav(view, param) {
    var key = view === 'cat' ? 'categories' : view;
    Array.prototype.forEach.call(document.querySelectorAll('.nav-item'), function (el) { el.classList.toggle('is-active', el.getAttribute('data-nav') === key); });
    Array.prototype.forEach.call(mobileNav.querySelectorAll('.mnav-item'), function (el) { el.classList.toggle('is-active', el.getAttribute('data-nav') === key); });
    Array.prototype.forEach.call(sideCategories.querySelectorAll('.lib-item'), function (el) { el.classList.toggle('is-active', view === 'cat' && el.getAttribute('data-id') === param); });
  }

  /* ------------------------------ Topbar ---------------------------- */
  function topbar() {
    var view = currentView();
    var showBack = view !== 'home';
    var syncBadge = offlineMode ? '<span class="pill" style="background:rgba(255,164,43,.18);color:#ffb366">офлайн</span>' : '';
    return '<div class="topbar"><div class="topbar-left">' +
      (showBack ? '<button class="icon-btn" type="button" data-action="back" aria-label="Назад">' + icon('left') + '</button>' : '') +
      syncBadge +
      '</div><button class="topbar-search" type="button" data-action="nav" data-to="/search">' +
      icon('search') + '<span>Искать трату или категорию</span></button>' +
      '<div class="topbar-right"><button class="btn btn-green" type="button" data-action="add">' + icon('plus') + '<span>Добавить трату</span></button>' +
      '<button class="avatar" type="button" data-action="nav" data-to="/settings" aria-label="Настройки">' + esc(ini(state.settings.name)) + '</button></div></div>';
  }

  /* ------------------------------ Home ------------------------------ */
  function statCard(opts) {
    return '<div class="stat"><div class="stat-top">' + icon(opts.icon) + '<span>' + esc(opts.label) + '</span></div>' +
      '<div class="stat-value">' + opts.value + '</div><div class="stat-sub">' + opts.sub + '</div>' +
      (opts.pct != null ? '<div class="bar"><i class="bar-fill ' + (opts.barClass || '') + '" style="width:' + opts.pct.toFixed(1) + '%"></i></div>' : '') +
      '</div>';
  }
  function catCard(item) {
    var c = item.cat;
    var spent = item.value;
    var budget = budgetOf(c.id);
    var pct = pctOf(spent, budget);
    return '<div class="card" role="button" tabindex="0" data-action="cat" data-id="' + c.id + '" aria-label="Категория ' + esc(c.name) + '">' +
      '<div class="cover" style="' + catStyle(c) + '"><span aria-hidden="true">' + c.emoji + '</span>' +
      '<span class="add-btn" role="button" tabindex="-1" data-action="add" data-cat="' + c.id + '" aria-label="Добавить трату в ' + esc(c.name) + '"></span></div>' +
      '<div class="card-title">' + esc(c.name) + '</div>' +
      '<div class="card-sub">' + money(spent) + ' за месяц</div>' +
      '<div class="card-progress"><i class="' + (item.value > budget ? 'over' : '') + '" style="width:' + pct.toFixed(1) + '%;background:' + (item.value > budget ? 'var(--red)' : 'var(--green)') + '"></i></div></div>';
  }
  function trackRow(t, idx) {
    var c = cat(t.categoryId);
    var d = U.parseYmd(t.date);
    return '<div class="track" role="button" tabindex="0" data-action="tx" data-id="' + t.id + '" aria-label="' + esc(t.title) + ', ' + money(t.amount) + '">' +
      '<span class="track-num">' + (idx + 1) + '</span>' +
      '<span class="track-cell"><span class="track-cover" style="' + catStyle(c) + '">' + c.emoji + '</span>' +
      '<span class="track-text"><span class="track-title">' + esc(t.title) + '</span>' +
      '<span class="track-sub">' + esc(c.name) + (t.note ? ' · ' + esc(t.note) : '') + '</span></span></span>' +
      '<span class="track-cat">' + esc(c.name) + '</span>' +
      '<span class="track-date">' + U.fmtDate(d) + '</span>' +
      '<span class="track-amount">−' + money(t.amount) + '</span></div>';
  }
  function tracksHead() {
    return '<div class="tracks-head"><span class="th-num">#</span><span>Трата</span><span class="th-cat">Категория</span><span class="th-date">Дата</span><span class="th-sum">Сумма</span></div>';
  }
  function viewHome() {
    var today = txToday();
    var todaySum = sum(today);
    var now = new Date();
    var dayBudget = Math.round(state.settings.monthlyBudget / U.daysInMonth(now));
    var mList = txThisMonth();
    var mSum = sum(mList);
    var mb = state.settings.monthlyBudget;
    var st = streak();
    var recent = state.transactions.slice().sort(function (a, b) { return (a.date + a.time) < (b.date + b.time) ? 1 : -1; }).slice(0, 8);
    var top = sortedCats(mList);
    var tops = top.length ? top : CATS.map(function (c) { return { cat: c, value: 0 }; });
    var html = topbar() + '<div class="view">';
    var artCats = tops.slice(0, 3);
    while (artCats.length < 3) artCats.push({ cat: CATS[artCats.length], value: 0 });
    html += '<section class="hero"><div class="hero-text">' +
      '<p class="hero-kicker">' + esc(greeting()) + ', ' + esc(state.settings.name) + '</p>' +
      '<h1 class="hero-title">Твои траты<br><em>под контролем</em></h1>' +
      '<p class="hero-sub">Не банковское приложение. Красивые отчёты, понятные лимиты и советы, которые реально экономят деньги.</p></div>' +
      '<div class="hero-art" aria-hidden="true">' + artCats.map(function (x, i) { return '<span class="hero-disc" style="' + catStyle(x.cat) + ';--i:' + i + '">' + x.cat.emoji + '</span>'; }).join('') + '</div></section>';
    html += '<div class="stat-row">' +
      statCard({ icon: 'wallet', label: 'Сегодня', value: money(todaySum), sub: 'из ' + money(dayBudget) + ' дневного лимита · ' + today.length + ' ' + plural(today.length, 'трата', 'траты', 'трат'), pct: pctOf(todaySum, dayBudget), barClass: barClass(todaySum, dayBudget) }) +
      statCard({ icon: 'bars', label: 'Этот месяц', value: money(mSum), sub: 'потрачено ' + Math.round(pctOf(mSum, mb)) + '% бюджета', pct: pctOf(mSum, mb), barClass: barClass(mSum, mb) }) +
      statCard({ icon: 'flame', label: 'Стрик', value: st + ' ' + plural(st, 'день', 'дня', 'дней'), sub: 'подряд ведёшь учёт' }) +
      '</div>';
    html += '<section class="sec"><div class="sec-head"><h2 class="sec-title">Категории</h2>' +
      '<button class="sec-link" type="button" data-action="nav" data-to="/categories">Показать все</button></div>' +
      '<div class="shelf">' + tops.map(catCard).join('') + '</div></section>';
    html += '<div class="cols"><section class="sec"><div class="sec-head"><h2 class="sec-title">Последние траты</h2>' +
      '<button class="sec-link" type="button" data-action="nav" data-to="/stats">Статистика</button></div>' +
      (recent.length ? tracksHead() + '<div class="tracks">' + recent.map(trackRow).join('') + '</div>' : '<div class="empty"><span class="empty-emoji">💳</span><p><strong>Пока пусто.</strong><br>Добавь первую трату — и увидишь, куда уходят деньги.</p><button class="btn btn-green" type="button" data-action="add">' + icon('plus') + 'Добавить трату</button></div>') +
      '</section>';
    html += '<aside>' + panelDonut(mList, 'Расклад месяца') + panelDJ(mList) + '</aside></div>';
    html += '</div>';
    return html;
  }
  function panelDonut(list, title) {
    var total = sum(list);
    var items = sortedCats(list);
    var parts = items.map(function (x) { return { value: x.value, color: x.cat.color, label: x.cat.name, text: money(x.value) }; });
    return '<div class="panel-box"><div class="panel-title">' + icon('bars') + esc(title) + '</div><div class="donut-wrap">' +
      Charts.donut(parts, { centerTop: total ? U.fmtNum(total) : '0', centerBottom: 'за месяц', label: 'Распределение трат по категориям' }) +
      '<div class="legend">' + (items.length ? items.slice(0, 6).map(function (x) {
        var share = total ? Math.round((x.value / total) * 100) : 0;
        return '<button class="legend-row" type="button" data-action="cat" data-id="' + x.cat.id + '"><span class="dot" style="background:' + x.cat.color + '"></span><span class="legend-name">' + esc(x.cat.name) + '</span><span class="legend-val">' + share + '%</span></button>';
      }).join('') : '<p class="hint">Добавь траты, чтобы увидеть расклад.</p>') + '</div></div></div>';
  }
  function panelDJ(list) {
    var tips = djTips(list);
    return '<div class="panel-box"><div class="panel-title">' + icon('spark') + 'Советы</div>' +
      tips.map(function (t) {
        return '<div style="display:flex;gap:12px;padding:10px 0;border-top:1px solid #222"><span style="font-size:20px;line-height:1.2">' + t.emoji + '</span>' +
          '<div><div style="font-weight:700;font-size:13.5px;margin-bottom:2px">' + esc(t.title) + '</div>' +
          '<div class="hint" style="font-size:12.5px">' + esc(t.text) + '</div></div></div>';
      }).join('') + '</div>';
  }
  function djTips(list) {
    var total = sum(list);
    var mb = state.settings.monthlyBudget;
    var tips = [];
    var left = daysLeftInMonth();
    if (total > mb) tips.push({ emoji: '🔥', title: 'Перебор ' + money(total - mb), text: 'Бюджет месяца уже пробит. Отложи необязательные покупки до следующего месяца.' });
    else if (total > mb * 0.85) tips.push({ emoji: '⏳', title: 'Осталось ' + money(mb - total), text: 'До конца месяца ' + left + ' ' + plural(left, 'день', 'дня', 'дней') + '. Держи темп — и в лимит уложишься.' });
    else tips.push({ emoji: '🎚️', title: 'Темп ровный', text: 'Потрачено ' + Math.round(pctOf(total, mb)) + '% бюджета. Ещё есть место для приятной покупки.' });
    var over = sortedCats(list).filter(function (x) { return x.value > budgetOf(x.cat.id); });
    if (over.length) {
      var o = over[0];
      tips.push({ emoji: '📈', title: '«' + o.cat.name + '» в переборе', text: 'Лимит ' + money(budgetOf(o.cat.id)) + ', а уже ' + money(o.value) + '. Сократи пару трат — и вернёшься в лимит.' });
    } else {
      var subsSum = D.SUBSCRIPTIONS.reduce(function (s, x) { return s + x.amount; }, 0);
      tips.push({ emoji: '🔁', title: 'Подписки: ' + money(subsSum) + ' в месяц', text: 'Это ' + money(subsSum * 12) + ' в год. Проверь, все ли сервисы ты реально используешь.' });
    }
    return tips.slice(0, 2);
  }

  /* --------------------------- Категории --------------------------- */
  function viewCategories() {
    var mList = txThisMonth();
    var o = byCategory(mList);
    var total = sum(mList);
    var items = CATS.map(function (c) { return { cat: c, value: o[c.id] || 0 }; }).sort(function (a, b) { return b.value - a.value; });
    return topbar() + '<div class="view"><h1 class="page-title">Категории</h1>' +
      '<p class="hint" style="margin:-10px 0 22px">8 категорий, ' + money(total) + ' за месяц. Нажми «+» на карточке, чтобы записать трату.</p>' +
      '<div class="grid-cards">' + items.map(catCard).join('') + '</div>' +
      '<p class="hint" style="margin-top:26px">Лимиты по каждой категории можно поменять в настройках.</p></div>';
  }

  /* ---------------------------- Category ---------------------------- */
  function viewCategory(id) {
    var c = cat(id);
    if (!c || !D.CAT_BY_ID[id]) return viewCategories();
    var mList = txThisMonth().filter(function (t) { return t.categoryId === id; });
    var monthSum = sum(mList);
    var budget = budgetOf(id);
    var list = txOfCategory(id);
    var totalAll = sum(list);
    var avg = list.length ? Math.round(totalAll / list.length) : 0;
    var pct = pctOf(monthSum, budget);
    var grad = 'background:linear-gradient(180deg,' + hexA(c.color, 0.55) + ' 0%,' + hexA(c.color, 0.18) + ' 42%,#121212 100%)';
    var html = topbar() +
      '<div class="cat-head" style="' + grad + '"><div class="cat-cover" style="' + catStyle(c) + '">' + c.emoji + '</div>' +
      '<div class="cat-info"><div class="cat-kicker">Категория</div><h1 class="cat-title">' + esc(c.name) + '</h1>' +
      '<div class="cat-meta"><b>' + list.length + '</b>&nbsp;' + plural(list.length, 'трата', 'траты', 'трат') +
      ' · <b>' + money(totalAll) + '</b> всего · ' + esc(c.tagline) + '</div></div></div>' +
      '<div class="view"><div class="cat-actions">' +
      '<button class="btn btn-green" type="button" data-action="add" data-cat="' + c.id + '">' + icon('plus') + 'Записать трату</button>' +
      '<button class="btn btn-ghost" type="button" data-action="nav" data-to="/stats">' + icon('bars') + 'В статистике</button>' +
      '<div class="budget-edit"><input id="catBudget" type="number" min="0" step="500" value="' + budget + '" aria-label="Лимит на месяц">' +
      '<button class="btn btn-dark" type="button" data-action="save-cat-budget" data-id="' + c.id + '">Лимит</button></div></div>' +
      '<div class="cat-budget"><div class="cat-budget-label"><span>Этот месяц: ' + money(monthSum) + '</span><span>лимит ' + money(budget) + '</span></div>' +
      '<div class="bar"><i class="bar-fill ' + barClass(monthSum, budget) + '" style="width:' + pct.toFixed(1) + '%"></i></div></div>' +
      '<div class="kpi-row" style="margin-top:22px">' +
      '<div class="kpi"><div class="kpi-label">За месяц</div><div class="kpi-value">' + money(monthSum) + '</div></div>' +
      '<div class="kpi"><div class="kpi-label">Средний чек</div><div class="kpi-value">' + money(avg) + '</div></div>' +
      '<div class="kpi"><div class="kpi-label">Осталось</div><div class="kpi-value">' + money(Math.max(0, budget - monthSum)) + '</div></div></div>' +
      renderPicks(c) +
      (list.length ? tracksHead() + '<div class="tracks">' + list.slice(0, 80).map(trackRow).join('') + '</div>' : '<div class="empty"><span class="empty-emoji">' + c.emoji + '</span><p><strong>Пока пусто.</strong><br>Добавь первую трату в «' + esc(c.name) + '».</p></div>') +
      '</div>';
    return html;
  }

  /* ----------------------------- Stats ------------------------------ */
  function viewStats() {
    var days = ui.period;
    var list = txLastDays(days);
    var prevStart = daysAgoKey(days * 2 - 1);
    var prevEnd = daysAgoKey(days);
    var prev = state.transactions.filter(function (t) { return t.date >= prevStart && t.date <= prevEnd; });
    var total = sum(list);
    var prevTotal = sum(prev);
    var avg = list.length ? total / list.length : 0;
    var delta = prevTotal ? ((total - prevTotal) / prevTotal) * 100 : 0;
    var series = dailySeries(list, Math.min(days, 90));
    var labels = series.map(function (p) { return U.fmtDate(p.date); });
    var values = series.map(function (p) { return p.value; });
    var catItems = sortedCats(list);
    var donutParts = catItems.map(function (x) { return { value: x.value, color: x.cat.color, label: x.cat.name, text: money(x.value) }; });
    var wd = weekdayTotals(list);
    var wdItems = wd.map(function (v, i) { return { label: U.weekdays[i], short: U.weekdaysShort[i], value: v, text: money(v) }; });
    var merchants = topMerchants(list, 5);
    var periodChips = [7, 30, 90].map(function (p) {
      return '<button class="chip' + (days === p ? ' is-on' : '') + '" type="button" data-action="period" data-days="' + p + '">' +
        (p === 7 ? '7 дней' : p === 30 ? '30 дней' : '90 дней') + '</button>';
    }).join('');
    var html = topbar() + '<div class="view"><div class="sec-head stats-head" style="margin:6px 0 18px"><h1 class="page-title" style="margin:0">Статистика</h1><div class="chips">' + periodChips + '</div></div>';
    if (!list.length) { html += '<div class="empty"><span class="empty-emoji">📊</span><p><strong>Нет данных за период.</strong><br>Добавь траты или выбери другой период.</p></div></div>'; return html; }
    html += '<div class="kpi-row">' +
      '<div class="kpi"><div class="kpi-label">Всего за период</div><div class="kpi-value">' + money(total) + '</div></div>' +
      '<div class="kpi"><div class="kpi-label">Средний чек</div><div class="kpi-value">' + money(avg) + '</div></div>' +
      '<div class="kpi"><div class="kpi-label">Трат</div><div class="kpi-value">' + list.length + '</div></div>' +
      '<div class="kpi"><div class="kpi-label">Динамика</div><div class="kpi-value"><span class="delta ' + (delta <= 0 ? 'down' : 'up') + '">' + (delta <= 0 ? '↓' : '↑') + ' ' + Math.abs(Math.round(delta)) + '%</span></div></div></div>';
    html += '<div class="panel-box" style="margin-bottom:18px"><div class="panel-title">' + icon('bars') + 'Траты по дням</div>' +
      Charts.area(values, labels, { label: 'График трат по дням', tip: function (label, v) { return label + ' — ' + money(v); } }) + '</div>';
    html += '<div class="cols"><div class="panel-box"><div class="panel-title">' + icon('wallet') + 'Куда уходят деньги</div><div class="donut-wrap">' +
      Charts.donut(donutParts, { size: 168, stroke: 22, centerTop: total ? U.fmtNum(total) : '0', centerBottom: 'за период', label: 'Категории за период' }) +
      '<div class="legend">' + catItems.map(function (x) {
        var share = total ? Math.round((x.value / total) * 100) : 0;
        return '<button class="legend-row" type="button" data-action="cat" data-id="' + x.cat.id + '"><span class="dot" style="background:' + x.cat.color + '"></span><span class="legend-name">' + esc(x.cat.name) + '</span><span class="legend-val">' + share + '%</span></button>';
      }).join('') + '</div></div></div><div>' +
      '<div class="panel-box"><div class="panel-title">' + icon('bars') + 'Дни недели</div>' + Charts.bars(wdItems, { label: 'Траты по дням недели' }) + '</div>' +
      '<div class="panel-box"><div class="panel-title">' + icon('flame') + 'Чаще всего платил</div>' +
      merchants.map(function (m) {
        var c = cat(m.categoryId);
        return '<div class="legend-row" style="cursor:default"><span class="dot" style="background:' + c.color + '"></span><span class="legend-name" style="color:#fff">' + esc(m.title) + '</span><span class="legend-val">' + money(m.sum) + '</span></div>';
      }).join('') + '</div></div></div>';
    html += '</div>';
    return html;
  }

  /* ----------------------------- Итоги ----------------------------- */
  function personality() {
    var all = state.transactions;
    var total = sum(all) || 1;
    var o = byCategory(all);
    var shares = {};
    CATS.forEach(function (c) { shares[c.id] = (o[c.id] || 0) / total; });
    var night = all.filter(function (t) { var h = parseInt(String(t.time || '12:00').slice(0, 2), 10); return h >= 22 || h < 5; }).length / (all.length || 1);
    if (night > 0.12) return { emoji: '🌙', title: 'Ночной транжира', text: 'Половина твоих покупок случается после 22:00. Днём ты аккуратнее.' };
    if (shares.food > 0.3) return { emoji: '🍜', title: 'Гурман', text: 'Еда — твоя главная статья. Кафе и доставка съедают больше, чем кажется.' };
    if (shares.shop > 0.25) return { emoji: '🛍️', title: 'Шопоголик', text: 'Импульсивные покупки — твоя слабость, но выглядят они красиво.' };
    if (shares.subs > 0.12) return { emoji: '📆', title: 'Коллекционер подписок', text: 'Подписок больше, чем времени на них. Один сервис явно оплачивается зря.' };
    if (total < state.settings.monthlyBudget * 0.7) return { emoji: '🧘', title: 'Минималист', text: 'Ты тратишь меньше, чем мог бы. Редкий и очень полезный навык.' };
    return { emoji: '📊', title: 'Финансовый стратег', text: 'Ровный темп без резких скачков. Ты держишь бюджет лучше большинства.' };
  }
  function viewRecap() {
    var all = state.transactions;
    if (!all.length) return topbar() + '<div class="view"><h1 class="page-title">Cashfy Итоги</h1><div class="empty"><span class="empty-emoji">✨</span><p><strong>Ещё нечего подводить.</strong><br>Добавь траты, чтобы собрать свой год.</p></div></div>';
    var total = sum(all);
    var monthsSet = {};
    all.forEach(function (t) { monthsSet[t.date.slice(0, 7)] = 1; });
    var months = Object.keys(monthsSet).length || 1;
    var cats = sortedCats(all);
    var top = cats[0];
    var biggest = all.slice().sort(function (a, b) { return b.amount - a.amount; })[0];
    var biggestCat = cat(biggest.categoryId);
    var avg = total / all.length;
    var persona = personality();
    var coffee = Math.max(1, Math.round(total / 250));
    var wd = weekdayTotals(all);
    var wdMax = wd.indexOf(Math.max.apply(null, wd));
    var wdItems = wd.map(function (v, i) { return { label: U.weekdays[i], short: U.weekdaysShort[i], value: v, text: money(v), color: i === wdMax ? '#1ED760' : '#3f3f3f' }; });
    var html = topbar() + '<div class="view recap">';
    html += '<div class="wrap-block green wrap-hero"><div class="wrap-kicker">Cashfy Итоги · ' + new Date().getFullYear() + '</div>' +
      '<div class="wrap-big"><span data-count="' + Math.round(total) + '">0</span> ₽</div>' +
      '<p class="wrap-note" style="margin:0 auto">' + all.length + ' ' + plural(all.length, 'трата', 'траты', 'трат') + ' за ' + months + ' ' + plural(months, 'месяц', 'месяца', 'месяцев') + '. Каждая — история о твоих деньгах.</p></div>';
    html += '<div class="wrap-grid">' +
      '<div class="wrap-card"><div class="stat-top">' + icon('spark') + 'Категория года</div>' +
      '<div class="wrap-cover" style="' + catStyle(top.cat) + '">' + top.cat.emoji + '</div>' +
      '<div style="font-size:20px;font-weight:800;letter-spacing:-.5px">' + esc(top.cat.name) + '</div>' +
      '<div class="hint">' + money(top.value) + ' · ' + Math.round((top.value / total) * 100) + '% всех трат</div></div>' +
      '<div class="wrap-card"><div class="stat-top">' + icon('wallet') + 'Покупка года</div>' +
      '<div class="wrap-cover" style="' + catStyle(biggestCat) + '">' + biggestCat.emoji + '</div>' +
      '<div style="font-size:20px;font-weight:800;letter-spacing:-.5px">' + esc(biggest.title) + '</div>' +
      '<div class="hint">' + money(biggest.amount) + ' · ' + U.fmtDate(U.parseYmd(biggest.date)) + '</div></div>' +
      '<div class="wrap-card"><div class="stat-top">' + icon('wallet') + 'Средний чек</div>' +
      '<div class="wrap-big" style="font-size:clamp(30px,6vw,44px);margin:6px 0 4px">' + money(avg) + '</div>' +
      '<div class="hint">Самый дорогой день — ' + esc(U.weekdays[wdMax]) + '</div></div></div>';
    html += '<div class="wrap-block purple" style="margin-top:18px"><div class="wrap-persona"><div class="wrap-persona-emoji">' + persona.emoji + '</div>' +
      '<div><div class="wrap-kicker">Твой денежный характер</div>' +
      '<h3 style="font-size:24px;font-weight:800;letter-spacing:-.6px;margin-top:4px">' + esc(persona.title) + '</h3>' +
      '<p style="color:rgba(255,255,255,.78);font-size:13.5px;margin-top:6px">' + esc(persona.text) + '</p></div></div></div>';
    html += '<div class="wrap-block amber" style="margin-top:18px"><div class="wrap-kicker">Если перевести в мелочи</div>' +
      '<div class="wrap-big" style="font-size:clamp(30px,6.5vw,56px)">' + U.fmtNum(coffee) + ' × капучино</div>' +
      '<p class="wrap-note">Столько чашек кофе можно было выпить вместо части этих трат. Или ' + U.fmtNum(Math.round(total / 450)) + ' поездок на такси.</p></div>';
    html += '<div class="panel-box" style="margin-top:18px"><div class="panel-title">' + icon('bars') + 'Твои самые дорогие дни</div>' +
      Charts.bars(wdItems, { label: 'Траты по дням недели' }) + '</div>';
    html += '<div class="wrap-actions"><button class="btn btn-green" type="button" data-action="share-recap">' + icon('share') + 'Поделиться итогами</button>' +
      '<button class="btn btn-ghost" type="button" data-action="nav" data-to="/stats">' + icon('bars') + 'Открыть статистику</button></div></div>';
    return html;
  }
  function recapText() {
    var all = state.transactions;
    var total = sum(all);
    var cats = sortedCats(all);
    var top = cats[0];
    var biggest = all.slice().sort(function (a, b) { return b.amount - a.amount; })[0];
    var p = personality();
    return 'Мои Cashfy Итоги ' + new Date().getFullYear() + ':\nВсего трат: ' + money(total) + '\nКатегория года: ' + top.cat.name + ' — ' + money(top.value) +
      '\nПокупка года: ' + biggest.title + ' — ' + money(biggest.amount) + '\nДенежный характер: ' + p.emoji + ' ' + p.title + '\nМои траты под контролем. #cashfy';
  }

  /* ---------------------------- Settings ---------------------------- */
  function viewSettings() {
    var mb = state.settings.monthlyBudget;
    var sumBudgets = CATS.reduce(function (s, c) { return s + budgetOf(c.id); }, 0);
    var diff = sumBudgets - mb;
    var budgetRows = CATS.map(function (c) {
      return '<div class="budget-row"><span class="dot" style="background:' + c.color + '"></span><span class="name">' + esc(c.name) + '</span>' +
        '<input id="b-' + c.id + '" type="number" min="0" step="500" value="' + budgetOf(c.id) + '" aria-label="Лимит: ' + esc(c.name) + '"></div>';
    }).join('');
    return topbar() + '<div class="view"><h1 class="page-title">Настройки</h1>' +
      '<section class="panel-box form-panel"><div class="panel-title">' + icon('wallet') + 'Профиль и бюджет</div>' +
      '<label class="field"><span>Как тебя зовут</span><input id="setName" value="' + esc(state.settings.name) + '" maxlength="24"></label>' +
      '<label class="field"><span>Бюджет на месяц, ₽</span><input id="setBudget" type="number" min="1000" step="1000" value="' + mb + '"></label>' +
      '<div class="row-actions"><button class="btn btn-green" type="button" data-action="save-settings">Сохранить</button></div></section>' +
      '<section class="panel-box form-panel"><div class="panel-title">' + icon('grid') + 'Лимиты по категориям</div>' + budgetRows +
      '<p class="hint" style="margin-top:10px">Сумма лимитов: ' + money(sumBudgets) + (diff === 0 ? ' — ровно как бюджет месяца.' : ' (' + (diff > 0 ? '+' : '−') + money(Math.abs(diff)) + ' к бюджету месяца).') + '</p>' +
      '<div class="row-actions"><button class="btn btn-green" type="button" data-action="save-budgets">Сохранить лимиты</button></div></section>' +
      '<section class="panel-box form-panel"><div class="panel-title">' + icon('bars') + 'Импорт трат из файла</div>' +
      '<p class="hint" style="margin-bottom:14px">CSV или TSV из банка/таблицы. Колонки: <b>дата, сумма, категория, название, заметка</b>.</p>' +
      '<div class="row-actions"><label class="btn btn-green" for="importFile">Выбрать файл</label>' +
      '<input id="importFile" type="file" accept=".csv,.tsv,.txt,text/csv" hidden>' +
      '<button class="btn btn-dark" type="button" data-action="download-template">Скачать шаблон CSV</button></div><div id="importPreview"></div></section>' +
      '<section class="panel-box form-panel"><div class="panel-title">' + icon('wallet') + 'Аккаунт</div>' +
      '<p class="hint" style="margin-bottom:14px">Ты вошёл как <b>' + esc(activeUser ? activeUser.name : '—') + '</b>' +
      (offlineMode ? ' · <span style="color:var(--amber)">офлайн-режим</span>' : ' · <span style="color:var(--green)">данные синхронизированы</span>') + '.</p>' +
      '<div class="row-actions"><button class="btn btn-dark" type="button" data-action="force-sync">Пересинхронизировать</button>' +
      '<button class="btn btn-dark" type="button" data-action="logout">Выйти</button>' +
      (activeUser && activeUser.id !== 'guest' ? '<button class="btn btn-danger" type="button" data-action="delete-account">Удалить аккаунт</button>' : '') +
      '</div></section>' +
      '<section class="panel-box form-panel"><div class="panel-title">' + icon('settings') + 'Данные</div>' +
      '<p class="hint" style="margin-bottom:14px">Данные хранятся на сервере и в кэше браузера.</p>' +
      '<div class="row-actions"><button class="btn btn-dark" type="button" data-action="export">Скачать JSON</button>' +
      '<button class="btn btn-dark" type="button" data-action="reset-demo">Перезалить демо-данные</button>' +
      '<button class="btn btn-danger" type="button" data-action="wipe">Удалить все траты</button></div></section>' +
      '<p class="hint">Cashfy · ' + U.fmtNum(state.transactions.length) + ' транзакций</p></div>';
  }

  /* ----------------------------- Search ----------------------------- */
  function viewSearch() {
    return topbar() + '<div class="view" style="padding-top:6px"><div class="topbar-search" style="max-width:none;cursor:text;margin-bottom:18px">' +
      icon('search') + '<input id="q" type="search" placeholder="Магазин, категория или заметка" autocomplete="off" ' +
      'style="flex:1;background:transparent;border:0;outline:none;color:#fff;font-size:14px;min-width:0"></div>' +
      '<div id="searchResults">' + searchResultsHTML('') + '</div></div>';
  }
  function searchResultsHTML(query) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) {
      var m = txThisMonth();
      var o = byCategory(m);
      return '<h2 class="sec-title" style="margin-bottom:14px">Категории</h2><div class="grid-cards">' +
        CATS.slice().sort(function (a, b) { return (o[b.id] || 0) - (o[a.id] || 0); })
          .map(function (c) { return catCard({ cat: c, value: o[c.id] || 0 }); }).join('') +
        '</div><p class="hint" style="margin-top:18px">Попробуй найти: «Додо», «такси», «подписки».</p>';
    }
    var matchedCats = CATS.filter(function (c) { return (c.name + ' ' + c.tagline).toLowerCase().indexOf(q) >= 0; });
    var matchedTx = state.transactions.filter(function (t) { return (t.title + ' ' + cat(t.categoryId).name + ' ' + (t.note || '')).toLowerCase().indexOf(q) >= 0; })
      .sort(function (a, b) { return (a.date + a.time) < (b.date + b.time) ? 1 : -1; }).slice(0, 40);
    var html = '';
    if (matchedCats.length) html += '<h2 class="sec-title" style="margin-bottom:14px">Категории</h2><div class="grid-cards" style="margin-bottom:26px">' +
      matchedCats.map(function (c) { return catCard({ cat: c, value: byCategory(txThisMonth())[c.id] || 0 }); }).join('') + '</div>';
    if (matchedTx.length) html += '<h2 class="sec-title" style="margin-bottom:6px">Траты · ' + matchedTx.length + '</h2>' +
      tracksHead() + '<div class="tracks">' + matchedTx.map(trackRow).join('') + '</div>';
    if (!matchedCats.length && !matchedTx.length) html += '<div class="empty"><span class="empty-emoji">🔍</span><p><strong>Ничего не нашлось.</strong><br>Попробуй другое слово.</p></div>';
    return html;
  }

  /* ----------------------------- Sidebar ---------------------------- */
  function renderSidebar() {
    if (!sideCategories) return;
    var m = txThisMonth();
    var o = byCategory(m);
    var order = CATS.slice().sort(function (a, b) { return (o[b.id] || 0) - (o[a.id] || 0); });
    sideCategories.innerHTML = order.map(function (c) {
      return '<li><button class="lib-item" type="button" data-action="cat" data-id="' + c.id + '">' +
        '<span class="lib-cover" style="' + catStyle(c) + '">' + c.emoji + '</span>' +
        '<span class="lib-meta"><span class="lib-name">' + esc(c.name) + '</span>' +
        '<span class="lib-sum">' + money(o[c.id] || 0) + ' за месяц</span></span></button></li>';
    }).join('');
  }

  /* ----------------------------- Player ----------------------------- */
  function renderPlayer() {
    if (!playerEl) return;
    if (mp.track) { renderMusicPlayer(); return; }
    var list = txToday();
    var total = sum(list);
    var now = new Date();
    var daily = Math.round(state.settings.monthlyBudget / U.daysInMonth(now));
    var pct = pctOf(total, daily);
    var over = total > daily;
    var topRow = list.slice().sort(function (a, b) { return b.amount - a.amount; })[0];
    var c = topRow ? cat(topRow.categoryId) : null;
    var rest = daily - total;
    playerEl.className = 'player' + (over ? ' over' : '');
    playerEl.innerHTML =
      '<div class="player-progress"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
      '<div class="player-inner"><div class="p-left">' +
      '<span class="p-cover" style="' + (c ? catStyle(c) : '') + '">' + (c ? c.emoji : icon('wallet')) + '</span>' +
      '<span class="p-meta"><span class="p-title">' + (list.length ? 'Сегодня, ' + esc(U.fmtDate(now)) : 'Сегодня пока пусто') + '</span>' +
      '<span class="p-sub">' + (list.length ? list.length + ' ' + plural(list.length, 'трата', 'траты', 'трат') + ' · больше всего: ' + esc(c.name) : 'добавь первую трату') + '</span></span></div>' +
      '<div class="p-center"><div class="p-labels"><span>потрачено ' + money(total) + '</span>' +
      '<span>' + (over ? 'перебор ' + money(total - daily) : 'осталось ' + money(rest)) + '</span></div>' +
      '<div class="p-bar"><i style="width:' + pct.toFixed(1) + '%"></i></div></div>' +
      '<div class="p-right"><span class="p-sum">' + money(total) + '</span>' +
      '<button class="p-plus" type="button" data-action="add" aria-label="Добавить трату">' + icon('plus') + '</button></div></div>';
  }

  /* --------------------------- Mobile nav --------------------------- */
  function renderMobileNav() {
    if (!mobileNav) return;
    var item = function (to, key, label, ic) {
      return '<button class="mnav-item" type="button" data-action="nav" data-to="' + to + '" data-nav="' + key + '" aria-label="' + label + '">' +
        icon(ic) + '<span>' + label + '</span></button>';
    };
    mobileNav.innerHTML =
      item('/home', 'home', 'Главная', 'home') +
      item('/categories', 'categories', 'Категории', 'grid') +
      '<button class="mnav-item mnav-add" type="button" data-action="add" aria-label="Добавить трату">' + icon('plus') + '<span>Добавить</span></button>' +
      item('/stats', 'stats', 'Статистика', 'bars') +
      item('/recap', 'recap', 'Итоги', 'spark');
  }

  /* ----------------------------- Modal ------------------------------ */
  function openTxModal(tx, presetCat) {
    var editing = !!tx;
    var t = tx || { title: '', amount: '', categoryId: presetCat || 'food', date: todayKey(), note: '' };
    ui.modalCat = t.categoryId;
    var chips = CATS.map(function (c) {
      return '<button type="button" class="chip' + (c.id === ui.modalCat ? ' is-on' : '') + '" data-action="chip" data-id="' + c.id + '">' +
        '<span class="dot" style="background:' + c.color + '"></span>' + esc(c.name) + '</button>';
    }).join('');
    modalRoot.innerHTML =
      '<div class="modal-backdrop" data-action="close-modal"></div>' +
      '<form class="sheet" id="txForm" novalidate' + (editing ? ' data-edit-id="' + esc(t.id) + '"' : '') + '>' +
      '<div class="sheet-head"><span class="sheet-title">' + (editing ? 'Изменить трату' : 'Новая трата') + '</span>' +
      '<button class="icon-btn" type="button" data-action="close-modal" aria-label="Закрыть">' + icon('x') + '</button></div>' +
      '<label class="sr-only" for="f-amount">Сумма</label>' +
      '<input class="amount-input" id="f-amount" inputmode="decimal" placeholder="0 ₽" autocomplete="off" value="' + (editing ? esc(String(t.amount)) : '') + '">' +
      '<div class="quick-amounts">' + [100, 300, 500, 1000, 2000].map(function (v) { return '<button type="button" class="quick" data-action="quick" data-v="' + v + '">+' + v + '</button>'; }).join('') + '</div>' +
      '<div class="chips" id="txChips">' + chips + '</div>' +
      '<div class="field-row" style="margin-top:16px">' +
      '<label class="field"><span>Название</span><input id="f-title" maxlength="40" autocomplete="off" placeholder="Додо Пицца" value="' + esc(t.title) + '"></label>' +
      '<label class="field"><span>Дата</span><input id="f-date" type="date" value="' + esc(t.date) + '"></label></div>' +
      '<label class="field"><span>Заметка</span><input id="f-note" maxlength="60" autocomplete="off" placeholder="За что это было" value="' + esc(t.note || '') + '"></label>' +
      '<div class="sheet-actions">' +
      (editing ? '<button class="btn btn-danger" type="button" data-action="delete-tx" data-id="' + esc(t.id) + '" aria-label="Удалить трату">' + icon('trash') + '</button>' : '') +
      '<button class="btn btn-dark" type="button" data-action="close-modal">Отмена</button>' +
      '<button class="btn btn-green" type="submit">' + (editing ? 'Сохранить' : 'Добавить') + '</button></div></form>';
    modalRoot.classList.add('is-open');
    var inp = document.getElementById('f-amount');
    if (inp) { inp.focus(); try { inp.select(); } catch (e) { } }
  }
  function closeModal() { modalRoot.classList.remove('is-open'); modalRoot.innerHTML = ''; }
  function readForm() {
    var amountEl = document.getElementById('f-amount');
    var titleEl = document.getElementById('f-title');
    var dateEl = document.getElementById('f-date');
    var noteEl = document.getElementById('f-note');
    return {
      amount: parseAmount(amountEl ? amountEl.value : ''),
      title: (titleEl ? titleEl.value : '').trim(),
      date: (dateEl && dateEl.value) ? dateEl.value : todayKey(),
      note: (noteEl ? noteEl.value : '').trim(),
      categoryId: ui.modalCat || 'food'
    };
  }
  function submitTx() {
    var form = document.getElementById('txForm');
    if (!form) return;
    var data = readForm();
    var editId = form.getAttribute('data-edit-id');
    var editing = !!editId;
    if (!(data.amount > 0)) { var amt = document.getElementById('f-amount'); if (amt) { amt.focus(); amt.style.borderColor = 'var(--red)'; } return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)) data.date = todayKey();
    if (!data.title) data.title = cat(data.categoryId).name;
    if (editing) {
      var t = state.transactions.filter(function (x) { return x.id === editId; })[0];
      if (t) { t.amount = data.amount; t.title = data.title; t.categoryId = data.categoryId; t.date = data.date; t.note = data.note; }
    } else {
      state.transactions.push({
        id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        amount: data.amount, title: data.title, categoryId: data.categoryId,
        date: data.date, time: U.pad2(new Date().getHours()) + ':' + U.pad2(new Date().getMinutes()), note: data.note
      });
    }
    saveState(); closeModal(); render();
    toast(editing ? 'Трата обновлена' : 'Трата добавлена: ' + money(data.amount));
  }
  function deleteTx(id) {
    var idx = -1;
    for (var i = 0; i < state.transactions.length; i++) if (state.transactions[i].id === id) { idx = i; break; }
    if (idx < 0) return;
    var removed = state.transactions.splice(idx, 1)[0];
    saveState(); closeModal(); render();
    toast('Удалено: ' + money(removed.amount), {
      action: { label: 'Вернуть', fn: function () { state.transactions.push(removed); saveState(); render(); toast('Возвращено'); } },
      ms: 5000
    });
  }

  /* ----------------------------- Toast ------------------------------ */
  function toast(msg, opts) {
    opts = opts || {};
    if (!toastRoot) return;
    toastRoot.innerHTML = '';
    var el = document.createElement('div');
    el.className = 'toast';
    var span = document.createElement('span');
    span.textContent = msg;
    el.appendChild(span);
    if (opts.action) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = opts.action.label;
      b.addEventListener('click', function () { opts.action.fn(); el.remove(); });
      el.appendChild(b);
    }
    toastRoot.appendChild(el);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.style.opacity = '0'; el.style.transform = 'translateY(10px)'; el.style.transition = 'opacity .25s, transform .25s';
      setTimeout(function () { el.remove(); }, 260);
    }, opts.ms || 3200);
  }

  /* ---------------------- Settings / data actions ------------------- */
  function saveSettings() {
    var nameEl = document.getElementById('setName');
    var budgetEl = document.getElementById('setBudget');
    var name = nameEl ? nameEl.value.trim() : state.settings.name;
    var mb = budgetEl ? Math.round(parseAmount(budgetEl.value)) : state.settings.monthlyBudget;
    if (!(mb >= 1000)) mb = state.settings.monthlyBudget;
    state.settings.name = name || 'Пользователь';
    state.settings.monthlyBudget = mb;
    saveState(); render();
    toast('Настройки сохранены');
  }
  function saveBudgets() {
    CATS.forEach(function (c) {
      var el = document.getElementById('b-' + c.id);
      if (!el) return;
      var v = Math.round(parseAmount(el.value));
      state.budgets[c.id] = v >= 0 ? v : budgetOf(c.id);
    });
    saveState(); render();
    toast('Лимиты обновлены');
  }
  function saveCatBudget(id) {
    var el = document.getElementById('catBudget');
    if (!el) return;
    var v = Math.round(parseAmount(el.value));
    if (!(v >= 0)) return;
    state.budgets[id] = v;
    saveState(); render();
    toast('Лимит «' + cat(id).name + '»: ' + money(v));
  }
  function exportJSON() {
    var data = JSON.stringify(state, null, 2);
    var blob = new Blob([data], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'cashfy-' + todayKey() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('Файл с данными скачан');
  }
  function resetDemo() {
    if (!window.confirm('Перезалить демо-данные? Текущие траты будут заменены.')) return;
    state.transactions = D.seedTransactions();
    saveState(); render();
    toast('Демо-данные перезалиты');
  }
  function wipeAll() {
    if (!window.confirm('Удалить все траты? Это необратимо.')) return;
    state.transactions = [];
    saveState(); render();
    toast('Все траты удалены');
  }
  function forceSync() {
    toast('Синхронизация…');
    syncFromServer().then(function () { render(); toast('Синхронизировано'); })
      .catch(function () { toast('Не удалось синхронизировать'); });
  }
  function shareRecap() {
    var text = recapText();
    var done = function () { toast('Текст итогов скопирован — вставляй куда хочешь'); };
    var fail = function () { toast('Не получилось скопировать. Попробуй ещё раз'); };
    if (navigator.share) { navigator.share({ title: 'Cashfy Итоги', text: text }).then(done).catch(function () { copyFallback(text) ? done() : fail(); }); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done).catch(function () { copyFallback(text) ? done() : fail(); }); return; }
    copyFallback(text) ? done() : fail();
  }
  function copyFallback(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }

  /* ----------------------------- Events ----------------------------- */
  function onClick(e) {
    var el = e.target.closest ? e.target.closest('[data-action]') : null;
    if (!el) return;
    var action = el.getAttribute('data-action');
    switch (action) {
      case 'nav': e.preventDefault(); go(el.getAttribute('data-to')); break;
      case 'back': if (window.history.length > 2) window.history.back(); else go('/home'); break;
      case 'add': openTxModal(null, el.getAttribute('data-cat')); break;
      case 'cat': go('/cat/' + encodeURIComponent(el.getAttribute('data-id'))); break;
      case 'tx':
        var tx = state.transactions.filter(function (t) { return t.id === el.getAttribute('data-id'); })[0];
        if (tx) openTxModal(tx);
        break;
      case 'period': ui.period = Number(el.getAttribute('data-days')) || 30; render(); break;
      case 'chip':
        ui.modalCat = el.getAttribute('data-id');
        Array.prototype.forEach.call(modalRoot.querySelectorAll('#txChips .chip'), function (c) { c.classList.toggle('is-on', c.getAttribute('data-id') === ui.modalCat); });
        break;
      case 'quick':
        var amountEl = document.getElementById('f-amount');
        if (amountEl) { var cur = parseAmount(amountEl.value); amountEl.value = String(cur + Number(el.getAttribute('data-v'))); amountEl.style.borderColor = ''; }
        break;
      case 'save-cat-budget': saveCatBudget(el.getAttribute('data-id')); break;
      case 'save-settings': saveSettings(); break;
      case 'save-budgets': saveBudgets(); break;
      case 'export': exportJSON(); break;
      case 'reset-demo': resetDemo(); break;
      case 'wipe': wipeAll(); break;
      case 'share-recap': shareRecap(); break;
      case 'delete-tx': deleteTx(el.getAttribute('data-id')); break;
      case 'close-modal': closeModal(); break;
      case 'add-pick': addPick(el.getAttribute('data-id')); break;
      case 'del-pick': delPick(el.getAttribute('data-id'), Number(el.getAttribute('data-index'))); break;
      case 'download-template': downloadTemplate(); break;
      case 'apply-import': applyImport(); break;
      case 'cancel-import': cancelImport(); break;
      case 'auth-tab': ui.authMode = el.getAttribute('data-tab') === 'register' ? 'register' : 'login'; showAuth(); break;
      case 'auth-guest': guestLogin(); break;
      case 'logout': logout(); break;
      case 'delete-account': deleteAccount(); break;
      case 'force-sync': forceSync(); break;
      case 'ai-refresh': aiRefresh(el.getAttribute('data-id')); break;
      case 'ai-play': playFromButton(el); break;
      case 'mp-toggle': togglePlay(); break;
      case 'mp-prev': mpPrev(); break;
      case 'mp-next': mpNext(); break;
      case 'mp-close': mpClose(); break;
    }
  }
  function onSubmit(e) {
    if (e.target && e.target.id === 'txForm') { e.preventDefault(); submitTx(); return; }
    if (e.target && e.target.id === 'authForm') { e.preventDefault(); submitAuth(); }
  }
  function onKeyDown(e) {
    if (e.key === 'Escape' && modalRoot.classList.contains('is-open')) { closeModal(); return; }
    if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.matches && e.target.matches('[role="button"][data-action]')) { e.preventDefault(); e.target.click(); }
  }
  function onInput(e) {
    if (e.target && e.target.id === 'q') { var box = document.getElementById('searchResults'); if (box) box.innerHTML = searchResultsHTML(e.target.value); }
    if (e.target && e.target.id === 'f-amount') e.target.style.borderColor = '';
    if (e.target && e.target.id === 'mpSeek') mpSeekTo(e.target.value);
  }
  function onChange(e) {
    if (!e.target) return;
    if (e.target.id === 'importFile') { onFileChosen(e.target.files && e.target.files[0]); return; }
    if (e.target.id === 'aiCountry') { var box = document.getElementById('aiPicks'); aiCountryChanged(e.target.value, box ? box.getAttribute('data-cat') : 'food'); }
  }
  function init() {
    main = document.getElementById('main');
    playerEl = document.getElementById('player');
    mobileNav = document.getElementById('mobileNav');
    modalRoot = document.getElementById('modalRoot');
    toastRoot = document.getElementById('toastRoot');
    sideCategories = document.getElementById('sideCategories');
    sideNav = document.getElementById('sideNav');
    authRoot = document.getElementById('authRoot');
    if (!document.getElementById('i-plus') || !document.getElementById('i-home')) {
      console.warn('Cashfy: не найдены SVG-иконки. Скопируйте все файлы проекта заново.');
    }
    document.addEventListener('click', onClick);
    document.addEventListener('submit', onSubmit);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    window.addEventListener('hashchange', onHashChange);
    if (!location.hash) { try { history.replaceState(null, '', '#/home'); } catch (e) { location.hash = '#/home'; } }
    boot();
  }
  if (/[?&]debug=1/.test(location.search)) {
    window.addEventListener('error', function (err) {
      var box = document.getElementById('crashBox') || (function () {
        var d = document.createElement('div');
        d.id = 'crashBox';
        d.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9999;max-width:90vw;background:#2a0000;color:#ffb3b3;font:12px monospace;padding:8px;border-radius:8px;white-space:pre-wrap';
        document.body.appendChild(d);
        return d;
      })();
      box.textContent += (err.message || 'error') + ' @ ' + (err.filename || '') + ':' + (err.lineno || '') + '\n';
    });
  }
  window.CashfyImport = { parseCsv: parseCsv, matchCategory: matchCategory, parseCsvDate: parseCsvDate, parseCsvAmount: parseCsvAmount };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();