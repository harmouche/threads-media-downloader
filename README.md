# Threads Media Downloader (private)

Browser-only Threads photo and video downloader. No backend, no npm publish.

**Live app:** https://harmouche.github.io/threads-media-downloader/

## Usage

1. Open the live URL above
2. Paste a public Threads post link (`threads.com/@user/post/CODE` or `threads.com/t/CODE`)
3. Click **Download**

- **Videos** save as `threads-video.webm`
- **Images** save as `threads-photo.jpg`
- **Carousels** download the first image only in v1

## Requirements

- **Chrome 132+** recommended (tab capture + crop for video when direct URLs are CORS-blocked)
- Public Threads post
- HTTPS (GitHub Pages, not `file://`)
- Allow **tab capture** when prompted on Download (records the official Threads embed)

## How it works

1. Validates post via Meta oEmbed API
2. Builds the official embed URL (`threads.com/t/CODE/embed/`) and loads it in a hidden iframe
3. Tries to read a direct CDN URL from the embed page (usually blocked by CORS in browser)
4. **Video:** if a direct URL is found, MediaRecorder on playback; otherwise Chrome tab capture cropped to the embed iframe (WebM)
5. **Image:** direct CDN fetch with referrer, canvas fallback if blocked

No third-party proxies. Source module lives in `../social-media-downloader/`.

## Build and deploy

When you change the module source:

```bash
cd ../social-media-downloader
npm install
npm run build
npm run copy
```

If Node is unavailable, edit `dist/threads-downloader.esm.js` directly and copy to `lib/`.

Deploy UI:

```bash
cd threads-media-downloader
git add index.html lib/ README.md
git commit -m "Update downloader"
git push
```

## Spike and baseline

- Phase 0 test page: `spike-embed.html`
- Comparison notes: `BASELINE.md` (2026-06-09)
- Meta embed.js mounts a cross-origin iframe; inline DOM media is not available on the parent page
- L3 embed-page fetch is CORS-blocked from browser; video uses tab capture fallback in Chrome 132+

## Limits

- WebM video output (re-encoded, not source MP4)
- Private posts fail at oEmbed or embed timeout
- iOS Safari video capture is best-effort
