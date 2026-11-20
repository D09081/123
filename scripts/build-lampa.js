const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const vendor = path.join(root, "vendor");
const source = path.join(vendor, "lampa-source");
const output = path.join(source, "build", "github", "lampa");

fs.mkdirSync(vendor, { recursive: true });

if (!fs.existsSync(path.join(source, "gulpfile.js"))) {
  execFileSync("git", ["clone", "--depth", "1", "https://github.com/yumata/lampa-source.git", source], {
    cwd: root,
    stdio: "inherit"
  });
}

execFileSync("npm", ["install", "--no-audit", "--no-fund"], {
  cwd: source,
  stdio: "inherit"
});
execFileSync("npx", ["gulp", "pack_github"], {
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

console.log("Cinema OS engine built from yumata/lampa-source.");
