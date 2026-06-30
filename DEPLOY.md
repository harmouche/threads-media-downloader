# Deploy checklist

Run after `npm run gate` passes.

## 1. Authenticate

```bash
npx wrangler login
```

## 2. Secrets (required)

Generate a new production secret (do not reuse `.dev.vars`):

```bash
openssl rand -hex 32
npx wrangler pages secret put PROXY_HMAC_SECRET --project-name=threads-media-downloader
npx wrangler pages secret put TURNSTILE_SECRET_KEY --project-name=threads-media-downloader
```

Create a Turnstile widget at https://dash.cloudflare.com → Turnstile. Add the **site key** as Pages env var `TURNSTILE_SITE_KEY`.

## 3. Deploy

```bash
cd threads-media-downloader
npm run deploy
```

## 4. Smoke test on `*.pages.dev`

1. Open the deployed URL
2. Resolve a public video post
3. Download via button (proxy path if direct CDN blocked)

## 5. Retire GitHub Pages

GitHub repo → **Settings** → **Pages** → Source: **None** (or delete custom domain from old GH Pages).

Point your domain (if any) to Cloudflare Pages instead.

## Optional: KV rate limits

Not required. HMAC + Turnstile is the default abuse model.

```bash
npx wrangler kv namespace create APP_KV
# Uncomment [[kv_namespaces]] in wrangler.toml, set id, redeploy
```
