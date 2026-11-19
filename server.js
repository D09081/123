const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;

function send(res, status, data, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "content-type": type,
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type, authorization"
  });
  res.end(type.startsWith("application/json") ? JSON.stringify(data) : data);
}
function getAdapters() {
  try {
    const raw = JSON.parse(process.env.SOURCE_ADAPTERS || "[]");
    return Array.isArray(raw) ? raw.filter(x => x && typeof x.name === "string" && typeof x.url === "string") : [];
  } catch { return []; }
}
async function searchSources(query) {
  const adapters = getAdapters();
  const settled = await Promise.all(adapters.map(async source => {
    try {
      const url = new URL(source.url);
      url.searchParams.set(source.queryParam || "q", query);
      const response = await fetch(url, { headers: { accept: "application/json", ...(source.headers || {}) }, signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const body = await response.json();
      const rows = Array.isArray(body) ? body : (body.results || body.items || []);
      if (!Array.isArray(rows)) throw new Error("Unsupported JSON format");
      return { items: rows.filter(x => x && typeof x.url === "string" && /^https?:\/\//i.test(x.url)).map(x => ({
        source: source.name, title: x.title || x.name || "Без названия", url: x.url,
        type: x.type === "iframe" ? "iframe" : "video", rating: x.rating ?? null,
        quality: x.quality || null, voice: x.voice || null
      })), error: null };
    } catch (e) { return { items: [], error: source.name + ": " + e.message }; }
  }));
  return { items: settled.flatMap(x => x.items), errors: settled.map(x => x.error).filter(Boolean) };
}
const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/health") return send(res, 200, { ok: true, app: "Cinema OS API", status: "running" });
  if (url.pathname === "/api/catalog/search" && req.method === "GET") {
    const query = (url.searchParams.get("query") || "").trim();
    if (!query) return send(res, 400, { error: "query_required" });
    try {
      const encoded = encodeURIComponent(query);
      const types = ["movie", "series"];
      const responses = await Promise.all(types.map(async type => {
        const endpoint = "https://v3-cinemeta.strem.io/catalog/" + type + "/top/search=" + encoded + ".json";
        const response = await fetch(endpoint, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error("Cinemeta " + type + " HTTP " + response.status);
        return { type, body: await response.json() };
      }));
      const items = responses.flatMap(({ type, body }) => (body.metas || []).map(x => ({
        id: x.imdb_id || x.id,
        title: x.name || x.title || "Без названия",
        year: x.year || (x.releaseInfo || "").slice(0, 4),
        type: type === "series" ? "Сериал" : "Фильм",
        genre: Array.isArray(x.genres) ? x.genres.join(", ") : "",
        desc: x.description || "",
        poster: x.poster || "",
        rating: typeof x.imdbRating === "number" ? x.imdbRating : (x.imdbRating && !Number.isNaN(Number(x.imdbRating)) ? Number(x.imdbRating) : null),
        ratingSource: "IMDb",
        imdbId: x.imdb_id || x.id || null
      })));
      const unique = [...new Map(items.map(x => [x.id || (x.title + x.year), x])).values()];
      return send(res, 200, { provider: "Cinemeta", ratingSource: "IMDb", items: unique });
    } catch (e) { return send(res, 502, { error: "catalog_unavailable", provider: "Cinemeta", message: e.message }); }
  }
  if (url.pathname === "/api/sources/search" && req.method === "GET") {
    const query = (url.searchParams.get("query") || "").trim();
    if (!query) return send(res, 400, { error: "query_required" });
    return send(res, 200, await searchSources(query));
  }
  if (url.pathname === "/" || url.pathname === "/index.html") {
    try { return send(res, 200, fs.readFileSync(path.join(ROOT, "index.html"), "utf8"), "text/html; charset=utf-8"); }
    catch { return send(res, 404, "index.html not found", "text/plain; charset=utf-8"); }
  }
  return send(res, 404, { error: "not_found" });
});
server.listen(PORT, "0.0.0.0", () => console.log("Cinema OS listening on " + PORT));
