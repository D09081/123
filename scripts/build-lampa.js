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
const indexPath = path.join(output, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
if (!html.includes('CINEMA_OS_CYBER_SKIN')) {
  html = html.replace('</head>', '<style id="CINEMA_OS_CYBER_SKIN">' + cinemaCss + '</style></head>');
}
// Keep Showy out of Cinema OS, including installations where it was saved in Lampa's plugin list.
// Our Torrent Pro extension is installed below as a native Cinema OS script.
const bootstrap = `
(function(){
  try {
    var current = localStorage.getItem('plugins');
    var list = current ? JSON.parse(current) : [];
    if (!Array.isArray(list)) list = [];
    list = list.filter(function(item) {
      var url = typeof item === 'string' ? item : item && item.url;
      return url !== 'https://showy.online/m.js' && url !== 'https://showy.online/m.js/';
    });
    var plugins = [
      'https://nb557.github.io/plugins/online_mod.js',
      {url: location.origin + '/plugins/torrent-pro.js', status: 1, name: 'Torrent Pro'}
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
// Weather widget intentionally removed from Cinema OS.

// Publish the design-free Torrent Pro plugin. Lampa loads it from its native
// Settings > Extensions list, populated in the bootstrap above (localStorage "plugins").
const torrentPluginSource = path.join(root, "plugins", "torrent-pro.js");
if (!fs.existsSync(torrentPluginSource)) {
  throw new Error("Cinema OS Torrent Pro source is missing: " + torrentPluginSource);
}
const pluginOutputDir = path.join(output, "plugins");
fs.mkdirSync(pluginOutputDir, { recursive: true });
fs.copyFileSync(torrentPluginSource, path.join(pluginOutputDir, "torrent-pro.js"));
// Do not inject a second script tag: Lampa's plugin loader owns loading and status.
if (!html.includes('CINEMA_OS_SOURCE_BOOTSTRAP')) {
  html = html.replace(/<script>\s*window\.youtube_lazy_load = true/, '<script>\n        /* CINEMA_OS_SOURCE_BOOTSTRAP */\n        ' + bootstrap + '\n        window.youtube_lazy_load = true');
}


// Rebrand only the browser tab; upstream source and copyright notices remain intact.
html = html.replace("<title>Lampa - Каталог фильмов и сериалов</title>", "<title>Cinema OS — powered by Lampa</title>");
fs.writeFileSync(indexPath, html, "utf8");
const licensePath = path.join(source, "LICENSE");
if (fs.existsSync(licensePath)) fs.copyFileSync(licensePath, path.join(output, "LICENSE"));

console.log("Cinema OS engine built from yumata/lampa-source.");
