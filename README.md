# Threads Media Downloader

Cloudflare Pages app with a resolve API and direct MP4/JPEG downloads.

**Stack:** Cloudflare Pages Functions, **per-post HMAC** CDN proxy, optional Turnstile, StreamSaver for large videos.

Server fetch uses the `facebookexternalhit` user agent so Meta returns embed HTML with CDN URLs (standard browser UAs often get a JS shell).

## Auth model (no KV required)

| Layer | Role |
|-------|------|
| **HMAC `proxy_auth`** | Required. Scopes CDN proxy downloads to URLs from a resolve (15 min). |
| **Turnstile** | Recommended on resolve in production. |
| **KV** | Optional. IP rate limits only if you bind `APP_KV`. Not used for download tokens. |

## Local dev

```bash
cd threads-media-downloader
npm install
cp .dev.vars.example .dev.vars   # set PROXY_HMAC_SECRET
npm run dev
```

Open `http://localhost:8788` for the app or `http://localhost:8788/spike-api.html` for the Phase 0 gate.

Turnstile is **optional** locally: if `TURNSTILE_SECRET_KEY` is not set, the API skips captcha verification.

## Deploy (Cloudflare Pages)

1. Create a Pages project linked to this repo (or use existing `threads-media-downloader`).
2. Set secrets:
   ```bash
   npx wrangler pages secret put PROXY_HMAC_SECRET --project-name=threads-media-downloader
   npx wrangler pages secret put TURNSTILE_SECRET_KEY --project-name=threads-media-downloader
   ```
3. Set `TURNSTILE_SITE_KEY` in Cloudflare Pages **environment variables** (public; served via `GET /api/config`).
4. Deploy:
   ```bash
   npm run deploy
   ```
5. **Retire GitHub Pages:** In the repo Settings → Pages, disable the old GitHub Pages source or point DNS to your `*.pages.dev` / custom domain instead.

### Optional: KV rate limits

Only if you want per-IP throttling beyond Turnstile + HMAC:

```bash
npx wrangler kv namespace create APP_KV
```

Uncomment `[[kv_namespaces]]` in `wrangler.toml`, set the namespace id, redeploy.

## Ship gate

```bash
npm run dev   # terminal 1
npm run gate  # terminal 2 — writes spike-api-results.json
```

## Usage

1. Paste a public Threads URL (`threads.com/@user/post/CODE` or `threads.com/t/CODE`)
2. Click **Load media** (complete captcha when Turnstile is enabled)
3. Pick a quality and **Download**, or use **Open raw link**

Videos save as MP4; images as JPEG.

## Privacy

- Post URLs are sent to the resolve API on our server.
- Turnstile tokens go to Cloudflare when enabled.
- Media is fetched from Meta CDN directly when possible; otherwise via HMAC-scoped proxy (15 min).
- Optional KV stores rate-limit counters only (not used by default).
- Edge cache may store public CDN bytes keyed by upstream URL.
- Public posts only.

## Module source

Browser module is built from `../social-media-downloader`:

```bash
cd ../social-media-downloader
npm run build && npm run copy
```

## Spike / baseline

- `spike-api.html` — API ship gate
- `BASELINE.md` — test matrix and gate results
