# Baseline: embed path vs dt.html

Date: 2026-06-09

## Summary

| Approach | Discovery | Image download | Video download |
|----------|-----------|----------------|----------------|
| dt.html (current) | r.jina.ai scrape | corsproxy / allorigins mirrors | CDN + cors mirrors + MediaRecorder |
| New module | oEmbed + embed.js DOM (L1), HTML attrs (L2) | direct fetch + canvas fallback | embed/detached video + MediaRecorder |

## Layer probe (server-side curl)

- `graph.threads.com/oembed` and `graph.threads.net/v1.0/oembed`: work for valid public posts; return 404-style error for deleted/invalid posts.
- `threads.net/embed/post/{id}`: returns `302` to error page; `Cross-Origin-Resource-Policy: same-origin` means **L3 is CORS-blocked from browser**. Treat L3 as optional; do not depend on it.

## Ship gate decision

- **Proceed with module build**: L1 embed.js path is the viable first-party replacement for jina scraping.
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
