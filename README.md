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

- Chrome or Edge recommended (MediaRecorder for video)
- Public Threads post
- HTTPS (GitHub Pages, not `file://`)
- Allow `threads.com/embed.js` (disable adblock on this site if embed fails)

## How it works

1. Validates post via Meta oEmbed API
2. Renders official Threads embed (`embed.js`) and reads media from DOM
3. **Video:** plays embed or detached video, records via MediaRecorder (WebM)
4. **Image:** direct CDN fetch with referrer, canvas fallback if blocked

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
- L3 embed-page fetch is CORS-blocked from browser; rely on L1 embed DOM

## Limits

- WebM video output (re-encoded, not source MP4)
- Private posts fail at oEmbed or embed timeout
- iOS Safari video capture is best-effort
