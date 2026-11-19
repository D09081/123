# Cinema OS

Standalone web app for MSX Player / LG webOS with an optional Node.js API backend.

## Run locally
```bash
npm start
```
Open http://localhost:3000

## Railway
Deploy repository `D09081/123` from branch `main`. The service starts with `npm start` and listens on Railway's `PORT`.

Set variables:
- `KINOPOISK_API_KEY` — Kinopoisk.dev API key. Keep it server-side; do not put it in the frontend.
- `SOURCE_ADAPTERS` — optional JSON array of permitted JSON API adapters, for example:
```json
[
  { "name": "MyCatalog", "url": "https://example.org/api/search", "queryParam": "q" }
]
```
Each adapter must return a JSON array or an object with `results` / `items`. Items may include `title`, `url`, `type` (`video` or `iframe`), `rating`, `quality`, and `voice`.

## API
- `GET /api/health`
- `GET /api/catalog/search?query=...`
- `GET /api/sources/search?query=...`

The backend only connects to API endpoints explicitly configured by the operator. It does not bypass DRM, authentication, paywalls, or anti-bot protections. Provider integrations must use permitted access methods.
