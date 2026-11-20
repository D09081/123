/* Lampa Torrent Pro — компактное расширение «Где смотреть». */
(function () {
  'use strict';

  var ID = 'lampa_torrent_pro';
  var VERSION = '1.9.3';
  var TITLE = 'Torrent Pro';

  if (window.__ltp_loaded) return;
  window.__ltp_loaded = true;

  var SEARCH_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v4m5-4v4m5-4v4M3 10h18M10 14l5 3-5 3z"/></svg>';
  var MAGNET_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4v7a7 7 0 0 0 14 0V4"/><path d="M5 4h4v6H5zm10 0h4v6h-4z"/></svg>';

  /* ---------- утилиты ---------- */

  function get(key, fallback) {
    try {
      var v = Lampa.Storage.get(key, fallback);
      return v === undefined || v === null ? fallback : v;
    } catch (_) { return fallback; }
  }
  function str(key) { return String(get(key, '') || '').trim(); }

  function notify(text) {
    try { Lampa.Noty.show(text); } catch (_) { console.log('[LTP] ' + text); }
  }

  function fmtSize(bytes) {
    bytes = Number(bytes);
    if (!bytes || bytes < 0) return '';
    var units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'], i = 0;
    while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
    return bytes.toFixed(i > 1 ? 1 : 0) + ' ' + units[i];
  }

  // Короткий cache + объединение одинаковых параллельных запросов.
  // Не даём повторным экранам запускать одинаковую сетевую работу.
  var requestCache = {};
  var requestPending = {};
  var REQUEST_CACHE_TTL = 10000;
  var REQUEST_CACHE_LIMIT = 40;

  function getJSON(url, timeout) {
    var key = String(url);
    var cached = requestCache[key];
    var now = Date.now();
    if (cached && cached.expires > now) return Promise.resolve(cached.data);
    if (requestPending[key]) return requestPending[key];

    var task = new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.timeout = timeout || 15000;
      xhr.withCredentials = false;
      xhr.onload = function () {
        if (xhr.status < 200 || xhr.status >= 300) return reject(new Error('HTTP ' + xhr.status + (xhr.responseText ? ': ' + String(xhr.responseText).slice(0,120) : '')));
        try { resolve(JSON.parse(xhr.responseText)); }
        catch (e) { reject(new Error('Ответ не JSON: ' + String(xhr.responseText || '').slice(0,80))); }
      };
      xhr.onerror = function () { reject(new Error('Сетевой запрос заблокирован: проверьте DNS, HTTPS и CORS')); };
      xhr.ontimeout = function () { reject(new Error('Таймаут запроса')); };
      xhr.onabort = function () { reject(new Error('Запрос отменён')); };
      xhr.send();
    }).then(function (data) {
      requestCache[key] = { data: data, expires: Date.now() + REQUEST_CACHE_TTL };
      var keys = Object.keys(requestCache);
      if (keys.length > REQUEST_CACHE_LIMIT) {
        keys.sort(function (a,b) { return requestCache[a].expires - requestCache[b].expires; });
        keys.slice(0, keys.length - REQUEST_CACHE_LIMIT).forEach(function (k) { delete requestCache[k]; });
      }
      return data;
    }).then(function (data) {
      delete requestPending[key];
      return data;
    }, function (error) {
      delete requestPending[key];
      throw error;
    });
    requestPending[key] = task;
    return task;
  }

  function normalizeBase(url) {
    url = String(url || '').trim().replace(/\/+$/, '');
    if (!url) return '';
    if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
    return url;
  }

  function jackettBase() { return normalizeBase(str('ltp_parser_url') || str('jackett_url')); }

  function currentController() {
    try {
      var active = Lampa.Controller.enabled();
      var name = active && active.name;
      return name && name !== 'select' && name !== 'modal' ? name : 'content';
    } catch (_) { return 'content'; }
  }
  function backTo(name) {
    var target = name && name !== 'select' && name !== 'modal' ? name : 'content';
    try { Lampa.Controller.toggle(target); }
    catch (_) {
      if (target !== 'content') {
        try { Lampa.Controller.toggle('content'); } catch (e) {}
      }
    }
  }
  // Экран «Где смотреть» открывается поверх карточки фильма. На webOS
  // возврат всегда должен активировать контроллер карточки, а не select.
  function backToMovie(prev) {
    var target = prev && prev !== 'select' && prev !== 'modal' ? prev : 'content';
    try { Lampa.Controller.toggle(target); }
    catch (_) { try { Lampa.Controller.toggle('content'); } catch (e) {} }
  }

  /* ---------- источники раздач ---------- */

  function searchArchive(query) {
    var q = 'title:(' + query.replace(/["():\\]/g, ' ') + ') AND mediatype:(movies)';
    var url = 'https://archive.org/advancedsearch.php?q=' + encodeURIComponent(q) +
      '&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=year&fl%5B%5D=item_size&fl%5B%5D=downloads' +
      '&sort%5B%5D=downloads+desc&rows=30&page=1&output=json';
    return getJSON(url).then(function (data) {
      var docs = (data && data.response && data.response.docs) || [];
      return docs.map(function (d) {
        var id = d.identifier;
        return {
          source: 'Internet Archive',
          title: String(d.title || id) + (d.year ? ' (' + d.year + ')' : ''),
          size: Number(d.item_size) || 0,
          seeders: 0,
          archiveId: id,
          link: 'https://archive.org/download/' + encodeURIComponent(id) + '/' + encodeURIComponent(id) + '_archive.torrent',
          magnet: ''
        };
      });
    });
  }

  function searchJackett(query) {
    var base = jackettBase();
    var key = str('ltp_parser_key') || str('jackett_key');
    if (!base) return Promise.resolve({ items: [], link: '' });
    var url = base + '/api/v2.0/indexers/all/results?apikey=' + encodeURIComponent(key) +
      '&Query=' + encodeURIComponent(query);
    return getJSON(url, 25000).then(function (data) {
      var list = (data && (data.Results || data.results)) || [];
      return list.map(function (r) {
        return {
          source: r.Tracker || r.TrackerId || 'Jackett',
          title: String(r.Title || ''),
          size: Number(r.Size) || 0,
          seeders: Number(r.Seeders) || 0,
          link: r.Link || '',
          magnet: r.MagnetUri || ''
        };
      }).filter(function (r) { return r.title && (r.magnet || r.link); })
        .sort(function (a, b) { return b.seeders - a.seeders; })
        .slice(0, 60);
    });
  }

  function searchAll(query) {
    var errors = [];
    function safe(p, name) {
      return p.catch(function (e) { errors.push(name + ': ' + e.message); return []; });
    }
    return Promise.all([
      safe(searchJackett(query), 'Jackett'),
      safe(searchArchive(query), 'Internet Archive')
    ]).then(function (res) {
      return { items: res[0].concat(res[1]), errors: errors };
    });
  }

  /* ---------- список раздач и запуск ---------- */

  function play(entry, movie) {
    var element = {
      title: entry.title, Title: entry.title,
      MagnetUri: entry.magnet || '', magnet: entry.magnet || '',
      Link: entry.link || '', link: entry.link || '',
      Seeders: entry.seeders, Size: entry.size, size: entry.size,
      Tracker: entry.source, tracker: entry.source,
      url: entry.magnet || entry.link
    };
    try {
      Lampa.Torrent.start(element, movie);
    } catch (e) {
      var text = entry.magnet || entry.link;
      try {
        Lampa.Utils.copyTextToClipboard(text, function () {
          notify('Не удалось запустить автоматически. Ссылка скопирована.');
        }, function () { notify('Не удалось запустить раздачу: ' + e.message); });
      } catch (_) { notify('Не удалось запустить раздачу: ' + e.message); }
    }
  }


  /* ---------- онлайн-просмотр Internet Archive (без торрента) ---------- */

  var VIDEO_RANK = { mp4: 0, m4v: 1, webm: 2, ogv: 3, mkv: 4, avi: 5 };

  function archiveVideoFiles(meta, id) {
    var files = (meta && meta.files) || [];
    var ok = /\.(mp4|m4v|webm|ogv|mkv|avi)$/i;
    return files.filter(function (f) {
      return f && ok.test(f.name || '') && Number(f.size) > 1048576;
    }).map(function (f) {
      var ext = String(f.name).split('.').pop().toLowerCase();
      return {
        name: f.name,
        size: Number(f.size) || 0,
        rank: VIDEO_RANK[ext] === undefined ? 9 : VIDEO_RANK[ext],
        url: 'https://archive.org/download/' + encodeURIComponent(id) + '/' +
          String(f.name).split('/').map(encodeURIComponent).join('/')
      };
    }).sort(function (a, b) { return a.rank - b.rank || a.name.localeCompare(b.name); });
  }

  function playOnline(file, files, title) {
    var playlist = files.map(function (f) { return { title: f.name, url: f.url }; });
    try {
      Lampa.Player.play({ title: title, url: file.url });
      if (Lampa.Player.playlist) Lampa.Player.playlist(playlist);
    } catch (e) {
      notify('Не удалось запустить плеер: ' + e.message);
    }
  }

  function watchArchive(entry, prev) {
    try { Lampa.Loading.start(); } catch (_) {}
    getJSON('https://archive.org/metadata/' + encodeURIComponent(entry.archiveId), 20000).then(function (meta) {
      try { Lampa.Loading.stop(); } catch (_) {}
      var files = archiveVideoFiles(meta, entry.archiveId);
      if (!files.length) { notify('Видеофайлов для онлайн-просмотра нет. Попробуйте торрент.'); return; }
      if (files.length === 1) return playOnline(files[0], files, entry.title);
      Lampa.Select.show({
        title: 'Выберите файл',
        items: files.map(function (f) {
          return { title: f.name, subtitle: fmtSize(f.size), ltp_file: f };
        }),
        onBack: function () { backTo(prev); },
        onSelect: function (a) { backTo(prev); playOnline(a.ltp_file, files, entry.title); }
      });
    }).catch(function (e) {
      try { Lampa.Loading.stop(); } catch (_) {}
      notify('Не удалось получить файлы: ' + e.message);
    });
  }

  function archiveChoice(entry, movie, prev) {
    Lampa.Select.show({
      title: entry.title,
      items: [
        { title: 'Смотреть онлайн', subtitle: 'Сразу, без торрента', act: 'watch' },
        { title: 'Запустить торрентом', subtitle: 'Через TorrServer', act: 'torrent' }
      ],
      onBack: function () { backTo(prev); },
      onSelect: function (a) {
        backTo(prev);
        if (a.act === 'watch') watchArchive(entry, prev);
        else play(entry, movie);
      }
    });
  }

  function showTorrents(query, movie, prev) {
    query = (query || '').trim();
    if (!query) return;
    movie = movie || { id: 0, title: query, original_title: query, name: query };
    try { Lampa.Loading.start(); } catch (_) {}
    searchAll(query).then(function (result) {
      try { Lampa.Loading.stop(); } catch (_) {}
      var items = [];
      result.items.slice().sort(function (a, b) {
        return sourcePreferenceScore(b) - sourcePreferenceScore(a);
      }).forEach(function (r) {
        var meta = [r.source];
        if (r.seeders) meta.push('↑' + r.seeders);
        var size = fmtSize(r.size);
        if (size) meta.push(size);
        var quality = /\\b(2160p|4k|uhd)\\b/i.test(r.title) ? '4K' :
          /\\b(1080p|1080i|full.?hd)\\b/i.test(r.title) ? '1080p' :
          /\\b(720p|hd)\\b/i.test(r.title) ? '720p' : '';
        if (quality) meta.push(quality);
        items.push({ title: r.title, subtitle: meta.join(' • '), ltp_entry: r });
      });

      if (!result.items.length) {
        notify('Раздач не найдено.' + (jackettBase() ? '' :
          ' Для новых фильмов и сериалов укажите Jackett (настройки парсера Lampa).'));
      }
      if (result.errors.length) notify(result.errors.join('; '));
      if (!items.length) { backTo(prev); return; }

      Lampa.Select.show({
        title: 'Раздачи: ' + query,
        items: items,
        onBack: function () { backTo(prev); },
        onSelect: function (a) {
          backTo(prev);
          if (a.ltp_entry && a.ltp_entry.archiveId) return archiveChoice(a.ltp_entry, movie, prev);
          if (a.ltp_entry) return play(a.ltp_entry, movie);
          if (a.ltp_provider) return openExternal(a.ltp_url);
        }
      });
    }).catch(function (e) {
      try { Lampa.Loading.stop(); } catch (_) {}
      notify('Ошибка поиска: ' + e.message);
    });
  }


  function openExternal(url) {
    if (!url) { notify('Каталог не предоставил прямую ссылку на этот сервис.'); return; }
    try {
      var w = window.open(url, '_blank');
      if (!w) Lampa.Utils.copyTextToClipboard(url, function () { notify('Ссылка скопирована.'); }, function () { notify(url); });
    } catch (_) { notify('Откройте ссылку: ' + url); }
  }

  /* ---------- «Где смотреть»: легальные сервисы по данным TMDB ---------- */

  var PROVIDER_GROUPS = [
    ['flatrate', 'По подписке'],
    ['free', 'Бесплатно'],
    ['ads', 'Бесплатно с рекламой'],
    ['rent', 'Аренда'],
    ['buy', 'Покупка']
  ];

  function providerItems(movie, region) {
    if (!movie || !movie.id || !Lampa.TMDB || !Lampa.TMDB.api) return Promise.resolve([]);
    var type = (movie.name && !movie.title) || movie.first_air_date && !movie.release_date ? 'tv' : 'movie';
    return getJSON(Lampa.TMDB.api(type + '/' + movie.id + '/watch/providers')).then(function (d) {
      var r = d && d.results && d.results[region];
      var items = [];
      var seen = {};
      if (r) {
        PROVIDER_GROUPS.forEach(function (g) {
          (r[g[0]] || []).forEach(function (p) {
            var key = String(p.provider_id || p.provider_name || '') + ':' + g[0];
            if (seen[key]) return;
            seen[key] = true;
            items.push({
              title: p.provider_name,
              subtitle: g[1] + ' · ' + region + ' · доступность по данным TMDB',
              ltp_provider_info: true
            });
          });
        });
        items.sort(function (a, b) { return a.title.localeCompare(b.title, 'ru'); });
      }
      return { items: items, link: r && r.link ? r.link : '' };
    }).catch(function () { return { items: [], link: '' }; });
  }

  function buildQuery(movie) {
    var name = movie.title || movie.name || movie.original_title || movie.original_name || '';
    var year = String(movie.release_date || movie.first_air_date || '').slice(0, 4);
    var original = movie.original_title || movie.original_name || '';
    return (original && /^[\x00-\x7F]+$/.test(original) ? original : name) + (year && movie.title ? ' ' + year : '');
  }

  // «Где смотреть»: легальные сервисы (TMDB) + источники для загрузки (Internet Archive, ваш Jackett)
  /* «Где смотреть»: сервисы по данным TMDB + JustWatch + поиск раздач. */
  function showWhere(movie, prev) {
    movie = movie || {};
    prev = prev && prev !== 'select' && prev !== 'modal' ? prev : 'content';
    var region = (str('ltp_region') || 'RU').toUpperCase();
    var query = buildQuery(movie).trim();
    try { Lampa.Loading.start(); } catch (_) {}
    providerItems(movie, region).then(function (result) {
      try { Lampa.Loading.stop(); } catch (_) {}
      result = result || { items: [], link: '' };
      var justwatch = 'https://www.justwatch.com/' + region.toLowerCase() + '/search?q=' + encodeURIComponent(query);
      var items = [{
        title: 'Открыть варианты просмотра',
        subtitle: 'JustWatch · официальные сервисы, аренда и покупка · ' + region,
        ltp_provider: true,
        ltp_url: result.link || justwatch
      }];
      if (result.items && result.items.length) {
        items.push({ title: 'Доступность по данным TMDB', subtitle: 'Список сервисов для выбранного региона' });
        result.items.forEach(function (item) { items.push(item); });
      } else {
        items.push({ title: 'Сервисы не найдены', subtitle: 'Откройте JustWatch для ручного поиска' });
      }
      items.push({ title: 'Поиск раздач', subtitle: 'Internet Archive и ваш Jackett; для magnet может потребоваться TorrServer', ltp_search_torrents: true });
      Lampa.Select.show({
        title: 'Где смотреть · ' + (movie.title || movie.name || query),
        items: items,
        onBack: function () { backToMovie(prev); },
        onSelect: function (item) {
          backToMovie(prev);
          if (item.ltp_provider) return openExternal(item.ltp_url);
          if (item.ltp_search_torrents) return showTorrents(query, movie, prev);
          if (item.ltp_provider_info) return notify(item.title + ': данные TMDB о доступности сервиса.');
        }
      });
    }).catch(function (error) {
      try { Lampa.Loading.stop(); } catch (_) {}
      notify('Не удалось загрузить варианты просмотра: ' + error.message);
      backToMovie(prev);
    });
  }

  function addCardButton() {
    if (!Lampa.Listener || !Lampa.Listener.follow) return;
    Lampa.Listener.follow('full', function (e) {
      if (e.type !== 'complite') return;
      try {
        var movie = e.data && e.data.movie;
        if (!movie) return;
        var render = e.object.activity.render();
        if (render.find('.ltp-full-btn').length) return;

        var btn = $('<div class="full-start__button selector ltp-full-btn">' + MAGNET_ICON + '<span>Где смотреть</span></div>');
        btn.on('hover:enter', function () { showWhere(movie, currentController()); });

        var anchor = render.find('.view--torrent').first();
        if (anchor.length) anchor.after(btn);
        else render.find('.full-start-new__buttons, .full-start__buttons').first().append(btn);
        try { Lampa.Controller.collectionAppend(btn); } catch (_) {}
      } catch (err) {
        console.error('[Lampa Torrent Pro] card button:', err);
      }
    });
  }

  function addParam(name, type, title, description, fallback) {
    if (!Lampa.SettingsApi || !Lampa.SettingsApi.addParam) return;
    Lampa.SettingsApi.addParam({
      component: ID,
      param: { name: name, type: type, default: fallback },
      field: { name: title, description: description || '' }
    });
  }

  function addSettings() {
    try {
      if (!Lampa.SettingsApi) return;
      if (Lampa.SettingsApi.addComponent) {
        Lampa.SettingsApi.addComponent({
          component: ID,
          name: 'Torrent Pro',
          icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 3h16v2H4zm0 4h16v2H4zm0 4h10v2H4zm0 4h16v2H4zm0 4h10v2H4z"/></svg>'
        });
      }
      addParam('ltp_parser_url', 'input', 'Адрес Jackett',
        'Необязательно. Если пусто — берётся адрес из настроек парсера Lampa. Указывайте только свой сервер.', '');
      addParam('ltp_parser_key', 'input', 'Ключ Jackett',
        'Необязательно. Если пусто — берётся ключ из настроек парсера Lampa.', '');
      addParam('ltp_region', 'input', 'Регион для «Где смотреть»',
        'Код страны, например RU, UA, BY, KZ. По умолчанию RU.', 'RU');
      addParam('ltp_quality_preference', 'input', 'Предпочитаемое качество',
        'Например 1080p, 4K или 720p. Фактическое качество зависит от раздачи.', '1080p');
      addParam('ltp_audio_preference', 'input', 'Предпочитаемая озвучка',
        'Например русская, lostfilm, дубляж. Автовыбор зависит от плеера.', 'русская');
    } catch (e) {
      console.error('[Torrent Pro] settings error:', e);
    }
  }

  function start() {
    if (window.__ltp_started) return;
    window.__ltp_started = true;
    addSettings();
    addCardButton();
    window.lampaTorrentPro = { version: VERSION, where: showWhere, advertising: false, telemetry: false };
    console.log('[Torrent Pro] ' + VERSION + ' ready');
  }

  if (window.appready) start();
  else if (Lampa.Listener && Lampa.Listener.follow) {
    Lampa.Listener.follow('app', function (event) {
      if (event.type === 'ready') start();
    });
  }
})();
