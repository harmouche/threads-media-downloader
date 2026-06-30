# Baseline: Cloudflare API path

Date: 2026-06-26 (gate PASS)

## Architecture (current)

| Layer | Approach |
|-------|----------|
| Hosting | Cloudflare Pages + Functions |
| Discovery | oEmbed fast-path → server fetch embed/page → JSON/HTML parse |
| Download | Direct CDN fetch; fallback HMAC proxy `/api/threads/cdn` |
| Proxy auth | **Per-post HMAC** `proxy_auth` (required) |
| Resolve abuse | Turnstile (recommended); optional KV IP limits |
| Video | StreamSaver MP4 when possible |
| Parser UA | `facebookexternalhit` for SSR embed HTML |

## Test matrix

| Slot | Type | Post URL | Resolve | Download | Notes |
|------|------|----------|---------|----------|-------|
| 1 | image | https://www.threads.com/@mosseri/post/DDupwppSjcp | pass | pass | embed-jina |
| 2 | carousel | https://www.threads.com/@threads/post/DI33nzTAHgT | pass | pass | 3 images |
| 3 | video | https://www.threads.com/@mariners/post/DKTSy7DN1eN | pass | pass | embed |
| 4 | video | https://www.threads.com/@nba/post/DKTSy7DN1eN | pass | pass | embed |
| 5 | carousel | https://www.threads.com/@natgeo/post/DI33nzTAHgT | pass | pass | embed-jina |
| 6 | carousel | https://www.threads.com/@nike/post/DI33nzTAHgT | pass | pass | embed-jina |
| 7 | text-only | https://www.threads.com/@mosseri/post/DI1xuSxv93T | fail (expected) | n/a | no media |
| 8 | private/deleted | https://www.threads.com/@threads/post/INVALIDCODE99 | fail (expected) | n/a | oEmbed + post-id guard |

Built-in spike bad URL: `https://www.threads.com/@fake/not-a-post/INVALID`

## Ship gate (Phase 0)

| Metric | Pass | Result |
|--------|------|--------|
| Resolve returns media (slots 1-6) | 6/6 | pass |
| Downloads direct or proxy (slots 1-6) | ≥4/6 | pass (6/6) |
| Text-only slot 7 rejects media | yes | pass |
| oEmbed fast-fail | 2/2 | pass |
| Edge cache HIT | log only | MISS (does not block ship) |

Run: `npm run dev` then `npm run gate`.

## Production checklist

1. `npx wrangler pages secret put PROXY_HMAC_SECRET` (rotate from dev)
2. `npx wrangler pages secret put TURNSTILE_SECRET_KEY`
3. Set `TURNSTILE_SITE_KEY` in Pages env
4. `npm run deploy`
5. Disable legacy GitHub Pages hosting for this repo
6. *(Optional)* KV namespace for IP rate limits only

## Pivot decision

Parser iteration 1: `facebookexternalhit` UA + canonical post-id guard + embed-first flow. Gate passed; no pivot required.
