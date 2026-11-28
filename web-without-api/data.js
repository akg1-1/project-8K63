/* ==========================================================================
   Cashfy — данные и утилиты
   Категории трат и покупки.
   ========================================================================== */

(function (global) {
  'use strict';

  /* ------------------------------ Категории ------------------------------ */
  /* budget — лимит на месяц в рублях; сумма всех лимитов = 70 000 ₽          */

  var CATEGORIES = [
    {
      id: 'food', name: 'Еда', emoji: '🍜', color: '#1DB954', color2: '#0B6B31',
      budget: 18000, tagline: 'Доставка, кафе и продукты',
      merchants: ['ВкусВилл', 'Пятёрочка', 'Додо Пицца', 'Яндекс Еда', 'Шоколадница', 'Столовая №1', 'Кофемания', 'Лента', 'Перекрёсток', 'Самокат']
    },
    {
      id: 'transport', name: 'Транспорт', emoji: '🚇', color: '#2E77D0', color2: '#123A6B',
      budget: 6000, tagline: 'Метро, такси, бензин',
      merchants: ['Яндекс Go', 'Метро', 'Лукойл АЗС', 'Ситимобил', 'Самокат', 'РЖД', 'Парковка', 'Газпромнефть']
    },
    {
      id: 'fun', name: 'Развлечения', emoji: '🎬', color: '#E8115B', color2: '#7A0B31',
      budget: 9500, tagline: 'Кино, бары, концерты',
      merchants: ['Кинопоиск', 'Steam', 'Бар «Руки вверх»', 'Концерт', 'Караоке', 'Боулинг', 'Квиз', 'Театр']
    },
    {
      id: 'home', name: 'Дом', emoji: '🏠', color: '#FFA42B', color2: '#8A5310',
      budget: 11000, tagline: 'Бытовуха и уют',
      merchants: ['Ozon', 'Леруа Мерлен', 'Коммуналка', 'Клининг', 'IKEA', 'Водоканал', 'Хозтовары', 'Мебель']
    },
    {
      id: 'health', name: 'Здоровье', emoji: '💊', color: '#1BC0A5', color2: '#0B6B5C',
      budget: 5000, tagline: 'Аптека, спорт, врачи',
      merchants: ['Аптека Вита', 'Стоматология', 'Фитнес-клуб', 'Анализы', 'Массаж', 'Оптика']
    },
    {
      id: 'shop', name: 'Шопинг', emoji: '🛍️', color: '#8D67AB', color2: '#4A3560',
      budget: 12000, tagline: 'Одежда и всё, что блестит',
      merchants: ['Wildberries', 'Золотое Яблоко', 'Nike', 'Zara', 'Ламода', 'Ozon', 'Маркет']
    },
    {
      id: 'subs', name: 'Подписки', emoji: '🔁', color: '#AF2896', color2: '#5C154F',
      budget: 4000, tagline: 'Твой ежемесячный автоплатёж',
      merchants: ['Spotify', 'Яндекс Плюс', 'iCloud', 'Notion', 'ChatGPT Plus']
    },
    {
      id: 'other', name: 'Другое', emoji: '📦', color: '#535353', color2: '#2A2A2A',
      budget: 4500, tagline: 'Подарки и сюрпризы',
      merchants: ['Перевод другу', 'Подарок', 'Цветы', 'Такси другу', 'Благотворительность', 'Долг']
    }
  ];

  var CAT_BY_ID = {};
  CATEGORIES.forEach(function (c) { CAT_BY_ID[c.id] = c; });

  /* --------------------------- Подписки (реальные) ------------------------ */

  var SUBSCRIPTIONS = [
    { title: 'Spotify Premium', amount: 199, day: 3 },
    { title: 'Яндекс Плюс', amount: 399, day: 5 },
    { title: 'iCloud 200 ГБ', amount: 149, day: 9 },
    { title: 'Notion Plus', amount: 690, day: 14 },
    { title: 'ChatGPT Plus', amount: 1900, day: 22 }
  ];

  /* --------------------------- Подборки треков ---------------------------- */
  /* Для каждой категории — настроение и несколько треков. Ссылки на сервисы  */
  /* строятся автоматически по поиску, поэтому работают из любого источника.  */

  var MOODS = {
    food: {
      vibe: 'Уютное утро и запах кофе',
      tracks: [
        { title: 'Coffee', artist: 'beabadoobee' },
        { title: 'Lemon Tree', artist: 'Fools Garden' },
        { title: 'Sunday Morning', artist: 'Maroon 5' }
      ]
    },
    transport: {
      vibe: 'Дорога, скорость и любимый маршрут',
      tracks: [
        { title: 'Midnight City', artist: 'M83' },
        { title: 'Road Trippin’', artist: 'Red Hot Chili Peppers' },
        { title: 'Highway to Hell', artist: 'AC/DC' }
      ]
    },
    fun: {
      vibe: 'Вечер пятницы, который не хочется заканчивать',
      tracks: [
        { title: 'Blinding Lights', artist: 'The Weeknd' },
        { title: 'Uptown Funk', artist: 'Mark Ronson, Bruno Mars' },
        { title: 'As It Was', artist: 'Harry Styles' }
      ]
    },
    home: {
      vibe: 'Домашний лоу-фай и тёплый свет',
      tracks: [
        { title: 'Home', artist: 'Edward Sharpe & The Magnetic Zeros' },
        { title: 'Sunset Lover', artist: 'Petit Biscuit' },
        { title: 'Shelter', artist: 'Porter Robinson, Madeon' }
      ]
    },
    health: {
      vibe: 'Мотивация на тренировку и стакан воды',
      tracks: [
        { title: 'Stronger', artist: 'Kanye West' },
        { title: 'Eye of the Tiger', artist: 'Survivor' },
        { title: 'Don’t Start Now', artist: 'Dua Lipa' }
      ]
    },
    shop: {
      vibe: 'Красиво, импульсивно и немного опасно',
      tracks: [
        { title: 'Material Girl', artist: 'Madonna' },
        { title: 'New Shoes', artist: 'Paolo Nutini' },
        { title: 'Fashion Killa', artist: 'A$AP Rocky' }
      ]
    },
    subs: {
      vibe: 'Ежемесячный автоплатёж, который снова списался',
      tracks: [
        { title: 'Another One Bites the Dust', artist: 'Queen' },
        { title: 'Every Breath You Take', artist: 'The Police' },
        { title: 'Money', artist: 'Pink Floyd' }
      ]
    },
    other: {
      vibe: 'Всякое бывает, и это нормально',
      tracks: [
        { title: 'Oops!… I Did It Again', artist: 'Britney Spears' },
        { title: 'Whatever', artist: 'Oasis' },
        { title: 'La La Land', artist: 'Demi Lovato' }
      ]
    }
  };

  /* ------------------- Профили настроения для ИИ-подборки ----------------- */
  /* ИИ-скоринг: совпадения по словам в названии/исполнителе и по жанру чарта. */

  var MOOD_PROFILES = {
    food: {
      keywords: ['coffee', 'morning', 'sweet', 'sugar', 'honey', 'lemon', 'cake', 'dinner', 'kitchen', 'tea', 'eat', 'food'],
      genres: ['Pop', 'Singer/Songwriter', 'Jazz', 'Acoustic', 'Alternative', 'Easy Listening']
    },
    transport: {
      keywords: ['road', 'drive', 'driving', 'highway', 'city', 'night', 'ride', 'speed', 'away', 'run'],
      genres: ['Rock', 'Electronic', 'Alternative', 'Hip-Hop/Rap', 'Pop', 'Dance']
    },
    fun: {
      keywords: ['party', 'dance', 'night', 'love', 'weekend', 'tonight', 'crazy', 'fire', 'club', 'drink'],
      genres: ['Dance', 'Pop', 'Hip-Hop/Rap', 'Electronic', 'R&B/Soul']
    },
    home: {
      keywords: ['home', 'house', 'stay', 'rain', 'sun', 'calm', 'slow', 'dream', 'light', 'sleep', 'golden'],
      genres: ['Alternative', 'Indie', 'Singer/Songwriter', 'Electronic', 'Pop', 'Easy Listening']
    },
    health: {
      keywords: ['strong', 'power', 'fight', 'run', 'breath', 'alive', 'higher', 'rise', 'energy', 'work', 'body'],
      genres: ['Hip-Hop/Rap', 'Rock', 'Electronic', 'Pop', 'Dance']
    },
    shop: {
      keywords: ['money', 'gold', 'fashion', 'style', 'diamond', 'brand', 'buy', 'rich', 'shopping', 'dress'],
      genres: ['Pop', 'R&B/Soul', 'Hip-Hop/Rap', 'Electronic']
    },
    subs: {
      keywords: ['again', 'every', 'time', 'month', 'repeat', 'more', 'wait', 'still', 'one more'],
      genres: ['Pop', 'Rock', 'Electronic', 'Alternative']
    },
    other: {
      keywords: ['life', 'whatever', 'mistake', 'maybe', 'why', 'strange', 'ok', 'story'],
      genres: ['Pop', 'Alternative', 'Indie', 'Hip-Hop/Rap']
    }
  };

  /* --------------------------- Диапазоны сумм ----------------------------- */

  var AMOUNTS = {
    food: [150, 1400, 10],
    transport: [60, 650, 10],
    fun: [350, 2800, 50],
    home: [400, 3500, 50],
    health: [250, 2200, 50],
    shop: [400, 2800, 100],
    subs: [149, 1990, 1],
    other: [150, 1200, 50]
  };

  var WEIGHTS = { food: 30, transport: 17, fun: 10, home: 8, health: 6, shop: 9, other: 9 };

  /* -------------------------------- Утилиты ------------------------------- */

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function ymd(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function parseYmd(s) {
    var p = String(s).split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function addDays(d, n) {
    var x = new Date(d.getTime());
    x.setDate(x.getDate() + n);
    return x;
  }

  function daysInMonth(d) {
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  }

  var NF = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  function fmtNum(n) { return NF.format(Math.round(Number(n) || 0)); }

  var MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  var MONTHS_FULL = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  var WEEKDAYS = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
  var WEEKDAYS_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

  function fmtDate(d) { return d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()]; }
  function fmtDateLong(d) {
    var wd = WEEKDAYS[(d.getDay() + 6) % 7];
    return d.getDate() + ' ' + MONTHS_FULL[d.getMonth()] + ', ' + wd;
  }
  function monthName(d) { return MONTHS_FULL[d.getMonth()]; }

  function plural(n, one, few, many) {
    var a = Math.abs(n) % 100;
    var b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  function timeLabel(minutes) {
    var h = Math.floor(minutes / 60);
    var m = Math.round(minutes % 60);
    return pad2(h) + ':' + pad2(m);
  }

  /* ------------------------------ Генератор ------------------------------- */

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var POOL = CATEGORIES.filter(function (c) { return c.id !== 'subs'; });
  var TOTAL_W = POOL.reduce(function (s, c) { return s + (WEIGHTS[c.id] || 5); }, 0);

  function seedTransactions() {
    var rnd = mulberry32(20261110);
    var out = [];
    var today = new Date();
    today.setHours(12, 0, 0, 0);

    var DAYS = 152;

    for (var i = DAYS; i >= 0; i--) {
      var d = addDays(today, -i);
      var dow = d.getDay();
      var weekend = dow === 0 || dow === 6;

      var r = rnd();
      var n = r < 0.07 ? 0 : r < 0.43 ? 1 : r < 0.78 ? 2 : r < 0.94 ? 3 : 4;
      if (weekend && rnd() < 0.5) n += 1;
      if (i === 0) n = Math.max(2, n);

      for (var k = 0; k < n; k++) {
        // категория
        var rw = rnd() * TOTAL_W;
        var cat = POOL[POOL.length - 1];
        for (var c = 0; c < POOL.length; c++) {
          rw -= (WEIGHTS[POOL[c].id] || 5);
          if (rw <= 0) { cat = POOL[c]; break; }
        }

        var range = AMOUNTS[cat.id] || [200, 2000, 50];
        var amount = range[0] + rnd() * (range[1] - range[0]);
        if (weekend) amount *= 1.08 + rnd() * 0.42;
        amount = Math.max(range[0], Math.round(amount / range[2]) * range[2]);

        var merchant = cat.merchants[Math.floor(rnd() * cat.merchants.length)];

        var hour = cat.id === 'fun'
          ? 18 + Math.floor(rnd() * 6)
          : 8 + Math.floor(rnd() * 14);
        if (hour > 23) hour = 23;
        var minute = Math.floor(rnd() * 12) * 5;

        out.push({
          id: 's' + (out.length + 1) + '-' + Math.floor(rnd() * 1e6).toString(36),
          title: merchant,
          categoryId: cat.id,
          amount: amount,
          date: ymd(d),
          time: pad2(hour) + ':' + pad2(minute),
          note: ''
        });
      }
    }

    // подписки — каждый месяц, в фиксированные дни
    var firstMonth = new Date(today.getFullYear(), today.getMonth() - 5, 1);
    for (var m = 0; m <= 5; m++) {
      var base = new Date(firstMonth.getFullYear(), firstMonth.getMonth() + m, 1);
      var dim = daysInMonth(base);
      SUBSCRIPTIONS.forEach(function (s) {
        var day = Math.min(s.day, dim);
        var dt = new Date(base.getFullYear(), base.getMonth(), day);
        dt.setHours(10, 0, 0, 0);
        if (dt > today) return;
        out.push({
          id: 'sub-' + ymd(dt) + '-' + s.day,
          title: s.title,
          categoryId: 'subs',
          amount: s.amount,
          date: ymd(dt),
          time: '10:00',
          note: 'Автоплатёж'
        });
      });
    }

    // пара «вау»-покупок, чтобы в «Итогах» было о чём рассказать
    var wowDay = addDays(today, -46);
    out.push({
      id: 'wow-1', title: 'Кроссовки Nike', categoryId: 'shop',
      amount: 6490, date: ymd(wowDay), time: '19:20', note: 'Импульсная покупка'
    });
    var wowDay2 = addDays(today, -19);
    out.push({
      id: 'wow-2', title: 'Концерт «Мумий Тролль»', categoryId: 'fun',
      amount: 4200, date: ymd(wowDay2), time: '21:10', note: 'Тот самый вечер'
    });

    // гарантируем хотя бы одну недавнюю трату в каждой категории,
    // чтобы демо не показывало «0 ₽ за месяц»
    var recentFrom = ymd(addDays(today, -12));
    CATEGORIES.forEach(function (c) {
      if (c.id === 'subs') return;
      var has = out.some(function (t) { return t.categoryId === c.id && t.date >= recentFrom; });
      if (has) return;
      var range = AMOUNTS[c.id] || [200, 2000, 50];
      var amount = range[0] + rnd() * (range[1] - range[0]);
      amount = Math.max(range[0], Math.round(amount / range[2]) * range[2]);
      var d2 = addDays(today, -(3 + Math.floor(rnd() * 8)));
      out.push({
        id: 'fill-' + c.id,
        title: c.merchants[Math.floor(rnd() * c.merchants.length)],
        categoryId: c.id,
        amount: amount,
        date: ymd(d2),
        time: pad2(9 + Math.floor(rnd() * 12)) + ':' + pad2(Math.floor(rnd() * 12) * 5),
        note: ''
      });
    });

    out.sort(function (a, b) {
      if (a.date === b.date) return a.time < b.time ? -1 : 1;
      return a.date < b.date ? -1 : 1;
    });

    return out;
  }

  /* --------------------------------- Export ------------------------------- */

  global.CashfyData = {
    CATEGORIES: CATEGORIES,
    CAT_BY_ID: CAT_BY_ID,
    MOODS: MOODS,
    MOOD_PROFILES: MOOD_PROFILES,
    SUBSCRIPTIONS: SUBSCRIPTIONS,
    seedTransactions: seedTransactions,
    util: {
      ymd: ymd,
      parseYmd: parseYmd,
      addDays: addDays,
      daysInMonth: daysInMonth,
      fmtNum: fmtNum,
      fmtDate: fmtDate,
      fmtDateLong: fmtDateLong,
      monthName: monthName,
      monthsShort: MONTHS_SHORT,
      weekdays: WEEKDAYS,
      weekdaysShort: WEEKDAYS_SHORT,
      plural: plural,
      timeLabel: timeLabel,
      pad2: pad2
    }
  };
})(window);
