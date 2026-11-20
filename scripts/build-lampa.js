const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const vendor = path.join(root, "vendor");
const source = path.join(vendor, "lampa-source");
const output = path.join(source, "build", "github", "lampa");

fs.mkdirSync(vendor, { recursive: true });

if (!fs.existsSync(path.join(source, "gulpfile.js"))) {
  fs.rmSync(source, { recursive: true, force: true });
  execFileSync("git", ["clone", "--depth", "1", "https://github.com/yumata/lampa-source.git", source], {
    cwd: root,
    stdio: "inherit"
  });
}

execFileSync("npm", ["install", "--no-audit", "--no-fund"], {
  cwd: source,
  stdio: "inherit"
});
// Build the upstream source bundle and web assets in the same order as its development pipeline.
const gulpfile = path.join(source, "gulpfile.js");
let gulpText = fs.readFileSync(gulpfile, "utf8");
if (!gulpText.includes("exports.cinemaos_build")) {
  gulpText += "\n// Cinema OS build integration added 2026-11-20: expose the upstream build steps.\n" +
    "exports.cinemaos_build = series(merge, plugins, sass_task, lang_task, sync_github, uglify_task, public_github, write_manifest, index_github);\n";
  fs.writeFileSync(gulpfile, gulpText, "utf8");
}
execFileSync("npx", ["gulp", "cinemaos_build"], {
  cwd: source,
  stdio: "inherit"
});

if (!fs.existsSync(path.join(output, "index.html")) || !fs.existsSync(path.join(output, "app.min.js"))) {
  throw new Error("Lampa build completed without the expected web files.");
}

// Cinema OS Cyber Hybrid skin and a preconfigured, user-visible video source.
const cinemaCss = `
:root{color-scheme:dark;--cos-bg:#050914;--cos-panel:#0b1426;--cos-cyan:#39dcff;--cos-violet:#9667ff;--cos-text:#f4f7ff}
html,body,#app{min-height:100%;background:#050914!important;color:var(--cos-text)!important}
body{background:radial-gradient(ellipse at 78% 0%,rgba(24,168,218,.30),transparent 38%),radial-gradient(ellipse at 4% 75%,rgba(125,66,218,.22),transparent 42%),linear-gradient(135deg,#050914 0%,#091326 52%,#080b19 100%)!important}
#app{background:transparent!important}
.head,.head__body{background:linear-gradient(100deg,rgba(5,13,27,.98),rgba(11,24,45,.96) 60%,rgba(23,17,48,.96))!important;border-bottom:1px solid rgba(57,220,255,.42)!important;box-shadow:0 8px 32px rgba(0,0,0,.38),0 1px 0 rgba(150,103,255,.18)!important}
.head__logo,.head__title{color:#fff!important;text-shadow:0 0 18px rgba(57,220,255,.55)!important}
.menu,.menu__content,.settings,.settings__content,.selectbox__content,.modal__content,.selectbox__item{background:rgba(7,14,29,.98)!important;color:#edf6ff!important}
.menu__item,.menu__item span,.settings__item,.settings__title{color:#dcecff!important}
.menu__item.focus,.menu__item.hover,.settings__item.focus,.settings__item.hover,.selector.focus,.selector.hover,.selectbox__item.focus{background:linear-gradient(105deg,rgba(21,180,222,.35),rgba(132,83,237,.32))!important;outline:1px solid rgba(57,220,255,.85)!important;box-shadow:0 0 24px rgba(57,220,255,.2)!important;border-radius:10px!important}
.card__view,.card__promo,.full-start__poster{border-radius:13px!important;overflow:hidden!important}
.card__view{border:1px solid rgba(112,177,218,.32)!important;box-shadow:0 8px 25px rgba(0,0,0,.38)!important}
.card.focus .card__view,.card.hover .card__view{border:2px solid var(--cos-cyan)!important;box-shadow:0 0 0 2px rgba(57,220,255,.25),0 0 30px rgba(57,220,255,.35)!important;transform:scale(1.045)!important}
.card__title,.card__name,.items-line__title,.category__title,.head__title{color:#f4f8ff!important}
.items-line__title{font-weight:800!important;letter-spacing:.035em!important;text-shadow:0 0 16px rgba(57,220,255,.16)!important}
.items-line__title:after{content:"";display:block;width:3.4em;height:3px;margin-top:.4em;background:linear-gradient(90deg,var(--cos-cyan),var(--cos-violet));border-radius:4px;box-shadow:0 0 12px rgba(57,220,255,.45)}
.full-start,.full-start__background{background-color:#081225!important}
.full-start__title{color:#fff!important;text-shadow:0 3px 24px #000,0 0 18px rgba(57,220,255,.2)!important}
.full-start__details,.full-descr,.full-review,.full-persons{color:#d2e1f5!important}
.full-start__button,.button,.selector{border-radius:10px!important}
.full-start__button.focus,.button.focus,.selector.focus{background:linear-gradient(100deg,#087f9f,#6240b7)!important;box-shadow:0 0 0 2px rgba(57,220,255,.7),0 0 26px rgba(57,220,255,.3)!important}
.tag,.card__rating,.full-start__tag{border-radius:7px!important}
::-webkit-scrollbar-thumb{background:linear-gradient(#39dcff,#9667ff)!important}
@media(max-width:800px){.head,.head__body{background:rgba(5,13,27,.99)!important}.card__view{border-radius:9px!important}}
`;
const weatherCss = `
#cinema-os-weather{position:fixed;z-index:9999;top:0;right:22px;height:66px;min-width:228px;box-sizing:border-box;display:flex;align-items:center;gap:12px;padding:0 16px 0 20px;border:0;border-left:1px solid rgba(57,220,255,.32);border-radius:0;background:linear-gradient(90deg,rgba(5,13,27,.18),rgba(7,18,35,.72));box-shadow:inset 1px 0 0 rgba(150,103,255,.12);color:#f4f8ff;font:600 14px/1.15 Arial,sans-serif;pointer-events:none;backdrop-filter:blur(10px)}
#cinema-os-weather:before{content:"";position:absolute;left:-1px;top:15px;bottom:15px;width:2px;background:linear-gradient(180deg,transparent,#39dcff 45%,#9667ff 85%,transparent);box-shadow:0 0 12px rgba(57,220,255,.55)}
#cinema-os-weather .cos-weather-icon{width:36px;height:36px;display:grid;place-items:center;font-size:25px;line-height:1;border-radius:10px;background:linear-gradient(145deg,rgba(57,220,255,.13),rgba(150,103,255,.16));box-shadow:inset 0 0 0 1px rgba(107,205,255,.18),0 0 18px rgba(57,220,255,.10)}
#cinema-os-weather .cos-weather-city{font-size:9px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#82eaff}
#cinema-os-weather .cos-weather-temp{font-size:22px;font-weight:800;letter-spacing:-.04em;color:#fff;text-shadow:0 0 14px rgba(57,220,255,.22)}
#cinema-os-weather .cos-weather-detail{max-width:125px;font-size:10px;line-height:1.4;color:#b8cce2;white-space:normal}
@media(max-width:1100px){#cinema-os-weather{right:8px;min-width:0;height:54px;gap:8px;padding:0 9px 0 12px}#cinema-os-weather .cos-weather-detail{display:none}#cinema-os-weather .cos-weather-icon{width:30px;height:30px;font-size:21px}#cinema-os-weather .cos-weather-temp{font-size:19px}}
@media(max-width:800px){#cinema-os-weather{top:0;right:0;height:48px;padding:0 8px;border-left:0;background:linear-gradient(90deg,transparent,rgba(7,18,35,.78))}#cinema-os-weather:before{display:none}#cinema-os-weather .cos-weather-icon{width:26px;height:26px;font-size:18px}#cinema-os-weather .cos-weather-city{font-size:8px}#cinema-os-weather .cos-weather-temp{font-size:17px}}
`;
const weatherScript = `
(function(){
  if (window.__cinemaOsWeatherLoaded) return;
  window.__cinemaOsWeatherLoaded = true;
  var url = 'https://api.open-meteo.com/v1/forecast?latitude=50.5956&longitude=36.5873&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Europe%2FMoscow&forecast_days=1';
  var labels = {0:'Ясно',1:'Преимущественно ясно',2:'Переменная облачность',3:'Пасмурно',45:'Туман',48:'Изморозь',51:'Морось',53:'Морось',55:'Сильная морось',61:'Небольшой дождь',63:'Дождь',65:'Сильный дождь',71:'Небольшой снег',73:'Снег',75:'Сильный снег',77:'Снежная крупа',80:'Ливень',81:'Ливень',82:'Сильный ливень',85:'Снегопад',86:'Сильный снегопад',95:'Гроза',96:'Гроза с градом',99:'Сильная гроза'};
  function icon(code){
    if(code===0) return '☀️';
    if(code===1||code===2) return '🌤️';
    if(code===3) return '☁️';
    if(code===45||code===48) return '🌫️';
    if(code>=51&&code<=67||code>=80&&code<=82) return '🌧️';
    if(code>=71&&code<=77||code===85||code===86) return '❄️';
    if(code>=95) return '⛈️';
    return '🌡️';
  }
  function mount(){
    if(document.getElementById('cinema-os-weather')) return;
    var el=document.createElement('div');
    el.id='cinema-os-weather';
    el.innerHTML='<span class="cos-weather-icon">⛅</span><span><span class="cos-weather-city">БЕЛГОРОД</span><br><span class="cos-weather-temp">--°</span></span><span class="cos-weather-detail">Загрузка погоды…</span>';
    document.body.appendChild(el);
  }
  function update(){
    mount();
    fetch(url,{cache:'no-store'}).then(function(r){if(!r.ok) throw new Error('weather '+r.status);return r.json();}).then(function(data){
      var c=data.current||{}, d=data.daily||{};
      var el=document.getElementById('cinema-os-weather');
      if(!el) return;
      el.querySelector('.cos-weather-icon').textContent=icon(c.weather_code);
      el.querySelector('.cos-weather-temp').textContent=Math.round(c.temperature_2m)+'°';
      var desc=labels[c.weather_code]||'Погода';
      var feels=Number.isFinite(c.apparent_temperature)?'Ощущается '+Math.round(c.apparent_temperature)+'°':'';
      var wind=Number.isFinite(c.wind_speed_10m)?'Ветер '+Math.round(c.wind_speed_10m)+' км/ч':'';
      var range=d.temperature_2m_min&&d.temperature_2m_max?' · '+Math.round(d.temperature_2m_min[0])+'° / '+Math.round(d.temperature_2m_max[0])+'°':'';
      el.querySelector('.cos-weather-detail').textContent=desc+' · '+[feels,wind].filter(Boolean).join(' · ')+range;
      el.title='Белгород: '+desc+'. Обновлено '+new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
    }).catch(function(){
      var el=document.getElementById('cinema-os-weather');
      if(el) el.querySelector('.cos-weather-detail').textContent='Нет соединения с погодным сервисом';
    });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',function(){mount();update();});
  else {mount();update();}
  window.setInterval(update,15*60*1000);
})();
`;


const indexPath = path.join(output, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
if (!html.includes('CINEMA_OS_CYBER_SKIN')) {
  html = html.replace('</head>', '<style id="CINEMA_OS_CYBER_SKIN">' + cinemaCss + weatherCss + '</style></head>');
}
// Seed Showy as an enabled Lampa extension on first launch. Existing user plugin settings are preserved.
// Showy exposes VideoDB and several other providers; its own Telegram authorization may be required.
const bootstrap = `
(function(){
  try {
    var current = localStorage.getItem('plugins');
    var list = current ? JSON.parse(current) : [];
    if (!Array.isArray(list)) list = [];
    var plugins = [
      'https://nb557.github.io/plugins/online_mod.js',
      'https://showy.online/m.js'
    ];
    plugins.forEach(function(url) {
      if (!list.some(function(item) {
        return (typeof item === 'string' ? item : item && item.url) === url;
      })) list.push({url:url,status:1});
    });
    localStorage.setItem('plugins', JSON.stringify(list));
  } catch(e) { console.warn('Cinema OS video sources bootstrap:', e); }
})();
`;
if (!html.includes('CINEMA_OS_WEATHER_WIDGET')) {
  html = html.replace('</body>', '<script id="CINEMA_OS_WEATHER_WIDGET">'+weatherScript+'</script></body>');
}
if (!html.includes('CINEMA_OS_SOURCE_BOOTSTRAP')) {
  html = html.replace(/<script>\s*window\.youtube_lazy_load = true/, '<script>\n        /* CINEMA_OS_SOURCE_BOOTSTRAP */\n        ' + bootstrap + '\n        window.youtube_lazy_load = true');
}


// Rebrand only the browser tab; upstream source and copyright notices remain intact.
html = html.replace("<title>Lampa - Каталог фильмов и сериалов</title>", "<title>Cinema OS — powered by Lampa</title>");
fs.writeFileSync(indexPath, html, "utf8");
const licensePath = path.join(source, "LICENSE");
if (fs.existsSync(licensePath)) fs.copyFileSync(licensePath, path.join(output, "LICENSE"));

console.log("Cinema OS engine built from yumata/lampa-source.");
