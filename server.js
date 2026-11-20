const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const TIMEOUT_MS = 15000;
const apiCache = new Map();
async function cached(key, ttlMs, loader) {
  const current = apiCache.get(key);
  if (current && current.expiresAt > Date.now()) return current.value;
  const value = await loader();
  apiCache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

function send(res, status, data, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "content-type": type,
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "cache-control": "no-store"
  });
  res.end(type.startsWith("application/json") ? JSON.stringify(data) : data);
}

function escapeSolr(value) {
  return String(value).replace(/[+\-!(){}\[\]^"~*?:\\/]/g, "\\$&");
}

function getAdapters() {
  try {
    const raw = JSON.parse(process.env.SOURCE_ADAPTERS || "[]");
    return Array.isArray(raw)
      ? raw.filter(x => x && typeof x.name === "string" && typeof x.url === "string" && ["json", "stremio"].includes(x.protocol || "json"))
      : [];
  } catch {
    return [];
  }
}

function hasOpenRights(meta) {
  const value = [meta.licenseurl, meta.rights, meta.license]
    .flat()
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return /creativecommons\.org\/(licenses|publicdomain)|creativecommons|public domain|publicdomain|cc0|cc-by|cc by|open access/.test(value);
}

async function searchInternetArchive(query) {
  const safeQuery = escapeSolr(query);
  const searchUrl = new URL("https://archive.org/advancedsearch.php");
  searchUrl.searchParams.set("q", 'mediatype:movies AND title:"' + safeQuery + '"');
  for (const field of ["identifier", "title", "year", "description", "creator"]) {
    searchUrl.searchParams.append("fl[]", field);
  }
  searchUrl.searchParams.set("rows", "10");
  searchUrl.searchParams.set("page", "1");
  searchUrl.searchParams.set("output", "json");

  const searchResponse = await fetch(searchUrl, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!searchResponse.ok) throw new Error("Internet Archive search HTTP " + searchResponse.status);

  const searchData = await searchResponse.json();
  const docs = searchData.response?.docs || [];

  const groups = await Promise.all(docs.map(async doc => {
    try {
      const metadataResponse = await fetch(
        "https://archive.org/metadata/" + encodeURIComponent(doc.identifier),
        { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) }
      );
      if (!metadataResponse.ok) return [];

      const record = await metadataResponse.json();
      const meta = record.metadata || {};
      if (!hasOpenRights(meta)) return [];

      const files = (record.files || []).filter(file =>
        typeof file.name === "string" &&
        /\.(mp4|webm|ogv)$/i.test(file.name) &&
        !file.name.startsWith("__") &&
        file.source !== "metadata" &&
        !file.name.includes("/")
      );

      return files.slice(0, 5).map(file => ({
        source: "Internet Archive",
        title: meta.title || doc.title || query,
        url: "https://archive.org/download/" + encodeURIComponent(doc.identifier) + "/" + encodeURIComponent(file.name),
        type: "video",
        quality: file.format || file.name.split(".").pop().toUpperCase(),
        voice: meta.language || null,
        rights: meta.licenseurl || meta.rights || meta.license || "Лицензия указана в метаданных",
        itemUrl: "https://archive.org/details/" + encodeURIComponent(doc.identifier)
      }));
    } catch (error) {
      return [];
    }
  }));

  return groups.flat();
}

async function searchConfiguredAdapters(query, media = {}) {
  const adapters = getAdapters();
  const responses = await Promise.all(adapters.map(async source => {
    try {
      let rows = [];
      if ((source.protocol || "json") === "stremio") {
        if (!media.imdbId) throw new Error("Для этого фильма нет IMDb ID, поэтому Stremio-поиск недоступен");
        const base = source.url.replace(/\/+$/, "").replace(/\/manifest\.json$/i, "");
        const mediaType = media.type === "Сериал" || media.type === "series" ? "series" : "movie";
        const endpoint = new URL(base + "/stream/" + mediaType + "/" + encodeURIComponent(media.imdbId) + ".json");
        const response = await fetch(endpoint, {
          headers: { accept: "application/json", ...(source.headers || {}) },
          signal: AbortSignal.timeout(TIMEOUT_MS)
        });
        if (!response.ok) throw new Error("HTTP " + response.status);
        const body = await response.json();
        rows = Array.isArray(body.streams) ? body.streams : [];
      } else {
        const endpoint = new URL(source.url);
        endpoint.searchParams.set(source.queryParam || "q", query);
        const response = await fetch(endpoint, {
          headers: { accept: "application/json", ...(source.headers || {}) },
          signal: AbortSignal.timeout(TIMEOUT_MS)
        });
        if (!response.ok) throw new Error("HTTP " + response.status);
        const body = await response.json();
        rows = Array.isArray(body) ? body : (body.results || body.items || []);
      }
      if (!Array.isArray(rows)) throw new Error("Неподдерживаемый JSON-формат");
      return {
        items: rows.filter(item => item && typeof item.url === "string" && /^https?:\/\//i.test(item.url))
          .map(item => ({
            source: source.name,
            title: item.title || item.name || item.description || "Без названия",
            url: item.url,
            type: item.type === "iframe" ? "iframe" : "video",
            rating: item.rating ?? null,
            quality: item.quality || (Array.isArray(item.behaviorHints?.filename) ? item.behaviorHints.filename[0] : item.behaviorHints?.filename) || null,
            voice: item.voice || null
          })),
        error: null
      };
    } catch (error) {
      return { items: [], error: source.name + ": " + error.message };
    }
  }));
  return {
    items: responses.flatMap(result => result.items),
    errors: responses.map(result => result.error).filter(Boolean)
  };
}

async function searchSources(query, media = {}) {
  const [archive, configured] = await Promise.all([
    searchInternetArchive(query).then(items => ({ items, error: null }))
      .catch(error => ({ items: [], error: "Internet Archive: " + error.message })),
    searchConfiguredAdapters(query, media)
  ]);

  const errors = [...configured.errors];
  if (archive.error) errors.unshift(archive.error);
  if (!archive.items.length && !configured.items.length && !errors.length) {
    errors.push("В доступных источниках варианты не найдены. Попробуйте другое написание названия.");
  }

  return {
    items: [...archive.items, ...configured.items],
    errors,
    providers: { internetArchive: archive.error ? "temporarily_unavailable" : "available" }
  };
}


const RUSSIAN_COLLECTIONS = {
  "Российское": ["Брат","Брат 2","Левиафан","Дурак","Нелюбовь","Холоп","Последний богатырь","Майор Гром","Лёд","Движение вверх","Слово пацана","Бригада","Метод","Кухня","Триггер","Вампиры средней полосы","Фишер","Эпидемия"],
  "Советское": ["Москва слезам не верит","Ирония судьбы","Бриллиантовая рука","Операция Ы","Иван Васильевич меняет профессию","Служебный роман","Любовь и голуби","Белое солнце пустыни","Семнадцать мгновений весны"],
  "Мультфильмы": ["Ну, погоди!","Ёжик в тумане","Трое из Простоквашино","Винни-Пух","Маша и Медведь","Смешарики","Фиксики","Иван Царевич и Серый Волк"]
};
async function discoverRussianCatalog() {
  const jobs = Object.entries(RUSSIAN_COLLECTIONS).flatMap(([collection,titles])=>titles.map(title=>({collection,title})));
  const items=[],warnings=[];
  let cursor=0;
  async function worker(){
    while(cursor<jobs.length){
      const job=jobs[cursor++];
      try{const result=await searchCatalog(job.title);items.push(...result.items.map(item=>({...item,collection:job.collection})));if(result.warnings?.length)warnings.push(...result.warnings)}
      catch(error){warnings.push(error.message||"Ошибка поиска")}
    }
  }
  await Promise.all(Array.from({length:6},()=>worker()));
  const unique=[...new Map(items.map(item=>[item.id||(item.title+item.year),item])).values()];
  if(!unique.length)throw new Error("Подборки временно недоступны. Попробуйте позже.");
  return {items:unique,warnings:[...new Set(warnings)].slice(0,5)};
}

async function discoverCatalog() {
  const types = ["movie", "series"];
  const settled = await Promise.allSettled(types.map(async type => {
    const endpoint = "https://v3-cinemeta.strem.io/catalog/" + type + "/top.json";
    const response = await fetch(endpoint, {
      headers: { accept: "application/json" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return { type, body: await response.json() };
  }));
  const errors = [];
  const items = [];
  settled.forEach((result, index) => {
    if (result.status !== "fulfilled") {
      errors.push((types[index] === "movie" ? "Фильмы" : "Сериалы") + ": " + result.reason.message);
      return;
    }
    const { type, body } = result.value;
    (body.metas || []).forEach(item => items.push({
      id: item.imdb_id || item.id,
      title: item.name || item.title || "Без названия",
      year: item.year || (item.releaseInfo || "").slice(0, 4),
      type: type === "series" ? "Сериал" : "Фильм",
      genre: Array.isArray(item.genres) ? item.genres.join(", ") : "",
      desc: item.description || "",
      poster: item.poster || "",
      rating: typeof item.imdbRating === "number" ? item.imdbRating :
        (item.imdbRating && !Number.isNaN(Number(item.imdbRating)) ? Number(item.imdbRating) : null),
      ratingSource: "IMDb",
      imdbId: item.imdb_id || item.id || null
    }));
  });
  const unique = [...new Map(items.map(item => [item.id || (item.title + item.year), item])).values()];
  if (!unique.length && errors.length === types.length) throw new Error(errors.join("; "));
  return { items: unique, warnings: errors };
}

async function searchCatalog(query) {
  const encoded = encodeURIComponent(query);
  const types = ["movie", "series"];
  const settled = await Promise.allSettled(types.map(async type => {
    const endpoint = "https://v3-cinemeta.strem.io/catalog/" + type + "/top/search=" + encoded + ".json";
    const response = await fetch(endpoint, {
      headers: { accept: "application/json" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const body = await response.json();
    return { type, body };
  }));

  const errors = [];
  const responses = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") responses.push(result.value);
    else errors.push((types[index] === "movie" ? "Фильмы" : "Сериалы") + ": " + result.reason.message);
  });

  const items = responses.flatMap(({ type, body }) => (body.metas || []).map(item => ({
    id: item.imdb_id || item.id,
    title: item.name || item.title || "Без названия",
    year: item.year || (item.releaseInfo || "").slice(0, 4),
    type: type === "series" ? "Сериал" : "Фильм",
    genre: Array.isArray(item.genres) ? item.genres.join(", ") : "",
    desc: item.description || "",
    poster: item.poster || "",
    rating: typeof item.imdbRating === "number"
      ? item.imdbRating
      : (item.imdbRating && !Number.isNaN(Number(item.imdbRating)) ? Number(item.imdbRating) : null),
    ratingSource: "IMDb",
    imdbId: item.imdb_id || item.id || null
  })));

  const unique = [...new Map(items.map(item => [item.id || (item.title + item.year), item])).values()];
  if (!unique.length && errors.length === types.length) {
    const error = new Error(errors.join("; "));
    error.details = errors;
    throw error;
  }
  return { items: unique, warnings: errors };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/api/health") {
    return send(res, 200, { ok: true, app: "Cinema OS API", status: "running", version: "1.1.0", capabilities: ["catalog", "search", "favorites-client", "open-rights-sources", "direct-player"] });
  }

  if (url.pathname === "/api/catalog/discover" && req.method === "GET") {
    try {
      const result = await cached("catalog:discover", 10 * 60 * 1000, discoverCatalog);
      return send(res, 200, { provider: "Cinemeta", ratingSource: "IMDb", items: result.items, warnings: result.warnings });
    } catch (error) {
      return send(res, 502, { error: "catalog_unavailable", provider: "Cinemeta", message: error.message });
    }
  }

  if (url.pathname === "/api/catalog/russian" && req.method === "GET") {
    try {
      const result = await cached("catalog:russian", 30 * 60 * 1000, discoverRussianCatalog);
      return send(res, 200, { provider: "Cinemeta", ratingSource: "IMDb", items: result.items, warnings: result.warnings });
    } catch (error) {
      return send(res, 502, { error: "catalog_unavailable", provider: "Cinemeta", message: error.message });
    }
  }

  if (url.pathname === "/api/catalog/search" && req.method === "GET") {
    const query = (url.searchParams.get("query") || "").trim();
    if (!query) return send(res, 400, { error: "query_required" });
    try {
      const result = await cached("catalog:search:" + query.toLowerCase(), 3 * 60 * 1000, () => searchCatalog(query));
      return send(res, 200, { provider: "Cinemeta", ratingSource: "IMDb", items: result.items, warnings: result.warnings });
    } catch (error) {
      return send(res, 502, { error: "catalog_unavailable", provider: "Cinemeta", message: error.message });
    }
  }

  if (url.pathname === "/api/sources/search" && req.method === "GET") {
    const query = (url.searchParams.get("query") || "").trim();
    if (!query) return send(res, 400, { error: "query_required" });
    try {
      const media = { imdbId: (url.searchParams.get("imdbId") || "").trim(), type: (url.searchParams.get("type") || "").trim() };
      return send(res, 200, await cached("sources:search:" + query.toLowerCase() + ":" + media.imdbId + ":" + media.type, 60 * 1000, () => searchSources(query, media)));
    } catch (error) {
      return send(res, 502, { error: "sources_unavailable", message: error.message });
    }
  }

  // Serve the locally built, open-source Lampa application as the Cinema OS engine.
  // API routes above remain native to this service.
  const lampaRoot = path.join(ROOT, "vendor", "lampa-source", "build", "github", "lampa");
  try {
    const pathname = decodeURIComponent(url.pathname);
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const filePath = path.resolve(lampaRoot, relative);
    if (filePath.startsWith(lampaRoot + path.sep) || filePath === path.join(lampaRoot, "index.html")) {
      const resolved = fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()
        ? path.join(filePath, "index.html")
        : filePath;
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        const ext = path.extname(resolved).toLowerCase();
        const types = {
          ".html":"text/html; charset=utf-8",".js":"application/javascript; charset=utf-8",
          ".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",
          ".svg":"image/svg+xml",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",
          ".webp":"image/webp",".gif":"image/gif",".woff":"font/woff",".woff2":"font/woff2",
          ".ttf":"font/ttf",".ico":"image/x-icon",".mp3":"audio/mpeg",".mp4":"video/mp4"
        };
        res.writeHead(200, {
          "content-type": types[ext] || "application/octet-stream",
          "cache-control": ext === ".html" ? "no-cache" : "public, max-age=3600"
        });
        return fs.createReadStream(resolved).pipe(res);
      }
    }
  } catch (error) {
    console.error("Static app error:", error.message);
  }

  // Fallback page is kept only for build failures, so the service never returns a blank screen.
  if (url.pathname === "/" || url.pathname === "/index.html") {
    try {
      return send(res, 200, fs.readFileSync(path.join(ROOT, "index.html"), "utf8"), "text/html; charset=utf-8");
    } catch {}
  }
  return send(res, 404, { error: "not_found" });
});

server.listen(PORT, "0.0.0.0", () => console.log("Cinema OS listening on " + PORT));
