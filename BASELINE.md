# Baseline: embed path vs dt.html

Date: 2026-06-09

## Summary

| Approach | Discovery | Image download | Video download |
|----------|-----------|----------------|----------------|
| dt.html (current) | r.jina.ai scrape | corsproxy / allorigins mirrors | CDN + cors mirrors + MediaRecorder |
| New module | oEmbed permalink → official `/embed/` iframe; optional embed HTML fetch (L3, usually CORS-blocked) | direct fetch + canvas fallback | direct URL + MediaRecorder, or Chrome tab capture cropped to embed iframe |

## Layer probe (server-side curl)

- `graph.threads.com/oembed` and `graph.threads.net/v1.0/oembed`: work for valid public posts; return 404-style error for deleted/invalid posts.
- `threads.net/embed/post/{id}`: returns `302` to error page; `Cross-Origin-Resource-Policy: same-origin` means **L3 is CORS-blocked from browser**. Treat L3 as optional; do not depend on it.

## Ship gate decision

- **Architecture (2026-06-09)**: Meta `embed.js` does **not** inject `<video>` into your page. It replaces the oEmbed blockquote with a **cross-origin** iframe (`threads.com/t/CODE/embed/`). Parent DOM walks always see zero inline media.
- **Discovery**: Build embed URL from `data-text-post-permalink` (same transform as Meta SDK). Browser `fetch(embedUrl)` is usually **CORS-blocked** (`cross-origin-resource-policy: same-origin`).
- **Download fallback**: Chrome 132+ tab capture + `CropTarget.fromElement(iframe)` records the official embed playback without third-party proxies. User must allow tab capture when prompted (click must happen first, before long waits).
- **L3 deprioritized**: browser fetch of embed page will fail CORS in practice.
- **Video risk**: without cors mirrors, video depends on embed/detached playback. Spike page [`spike-embed.html`](spike-embed.html) validates per-URL on HTTPS before deploy.

## How to run spike on your URLs

1. Serve `threads-media-downloader/` over HTTPS (GitHub Pages or `npx serve` + tunnel).
2. Open `spike-embed.html`.
3. Paste each test URL; copy `spike-results.json` output.
4. Compare image/video pass rate to dt.html on the same URLs.

## Test matrix (fill when run on HTTPS)

| Post URL | Type | dt.html | L1 | L2 | L3 | Image | Video |
|----------|------|---------|----|----|-----|-------|-------|
| (your URL 1) | image | | | | | | |
| (your URL 2) | image | | | | | | |
| (your URL 3) | video | | | | | | |
| (your URL 4) | video | | | | | | |
| (your URL 5) | carousel | | | | | | |
| (your URL 6) | carousel | | | | | | |
| (your URL 7) | text | | | | | | |
| (your URL 8) | text | | | | | | |
