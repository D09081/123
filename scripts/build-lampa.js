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
:root{color-scheme:dark}
html,body{background:#070b14!important;color:#f4f7ff!important}
body{background:radial-gradient(ellipse at 75% -10%,rgba(33,112,155,.24),transparent 42%),radial-gradient(ellipse at 8% 80%,rgba(99,57,166,.13),transparent 38%),#070b14!important}
#app{background:transparent!important}
.head,.head__body,.menu,.menu__content,.settings,.settings__content,.selectbox__content,.modal__content{background:rgba(9,16,30,.96)!important}
.head{border-bottom:1px solid rgba(69,205,255,.18)!important;box-shadow:0 8px 35px rgba(0,0,0,.22)!important}
.menu__item,.menu__item span,.settings__item,.settings__title{color:#dbe8fb!important}
.menu__item.focus,.menu__item.hover,.settings__item.focus,.settings__item.hover,.selector.focus,.selector.hover{background:linear-gradient(100deg,rgba(28,184,220,.22),rgba(128,86,230,.2))!important;border-color:rgba(65,213,255,.75)!important;box-shadow:0 0 0 1px rgba(65,213,255,.18),0 0 26px rgba(34,190,230,.13)!important}
.card__view,.card__promo,.full-start__poster,.full-start__background,.full-start__title{border-radius:14px!important}
.card__view{border:1px solid rgba(120,166,210,.13)!important;overflow:hidden!important;box-shadow:0 8px 26px rgba(0,0,0,.24)!important;transition:transform .18s,border-color .18s,box-shadow .18s!important}
.card.focus .card__view,.card.hover .card__view{border-color:#39d9ff!important;box-shadow:0 0 0 2px rgba(57,217,255,.24),0 12px 34px rgba(0,0,0,.42)!important;transform:scale(1.035)!important}
.full-start__title{color:#fff!important;text-shadow:0 3px 22px #000!important}
.full-start__tag,.tag,.card__rating{border-radius:7px!important}
.full-start__button,.button,.selector{border-radius:10px!important}
.full-start__button.focus,.button.focus,.selector.focus{box-shadow:0 0 0 2px rgba(57,217,255,.65),0 0 24px rgba(57,217,255,.2)!important}
.items-line__title,.category__title,.head__title{color:#f5f8ff!important;letter-spacing:.02em}
.items-line__title:after{content:"";display:block;width:2.4em;height:2px;margin-top:.42em;background:linear-gradient(90deg,#39d9ff,#9870ff);border-radius:3px}
.full-start,.full-start__background{background-color:#0b1220!important}
.full-start__details,.full-descr,.full-review,.full-persons{color:#d2def0!important}
::-webkit-scrollbar-thumb{background:#2e8ba8!important}
@media(max-width:800px){.head{background:rgba(7,12,23,.98)!important}.card__view{border-radius:10px!important}}
`;
const indexPath = path.join(output, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
if (!html.includes('CINEMA_OS_CYBER_SKIN')) {
  html = html.replace('</head>', '<style id="CINEMA_OS_CYBER_SKIN">' + cinemaCss + '</style></head>');
}
// Seed Showy as an enabled Lampa extension on first launch. Existing user plugin settings are preserved.
// Showy exposes VideoDB and several other providers; its own Telegram authorization may be required.
const bootstrap = `
(function(){
  try {
    var current = localStorage.getItem('plugins');
    var list = current ? JSON.parse(current) : [];
    if (!Array.isArray(list)) list = [];
    var url = 'https://showy.online/m.js';
    if (!list.some(function(item){ return (typeof item === 'string' ? item : item && item.url) === url; })) {
      list.push({url:url,status:1});
      localStorage.setItem('plugins', JSON.stringify(list));
    }
  } catch(e) { console.warn('Cinema OS source bootstrap:', e); }
})();
`;
if (!html.includes('CINEMA_OS_SOURCE_BOOTSTRAP')) {
  html = html.replace(/<script>\s*window\.youtube_lazy_load = true/, '<script>\n        /* CINEMA_OS_SOURCE_BOOTSTRAP */\n        ' + bootstrap + '\n        window.youtube_lazy_load = true');
}

// Rebrand only the browser tab; upstream source and copyright notices remain intact.
html = html.replace("<title>Lampa - Каталог фильмов и сериалов</title>", "<title>Cinema OS — powered by Lampa</title>");
fs.writeFileSync(indexPath, html, "utf8");
const licensePath = path.join(source, "LICENSE");
if (fs.existsSync(licensePath)) fs.copyFileSync(licensePath, path.join(output, "LICENSE"));

console.log("Cinema OS engine built from yumata/lampa-source.");
