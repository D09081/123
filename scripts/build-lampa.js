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

// Rebrand only the browser tab; upstream source and copyright notices remain intact.
const indexPath = path.join(output, "index.html");
let html = fs.readFileSync(indexPath, "utf8");
html = html.replace("<title>Lampa - Каталог фильмов и сериалов</title>", "<title>Cinema OS — powered by Lampa</title>");
fs.writeFileSync(indexPath, html, "utf8");
const licensePath = path.join(source, "LICENSE");
if (fs.existsSync(licensePath)) fs.copyFileSync(licensePath, path.join(output, "LICENSE"));

console.log("Cinema OS engine built from yumata/lampa-source.");
