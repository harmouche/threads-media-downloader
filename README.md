# Threads Media Downloader

Browser-only Threads photo and video downloader. No backend, no install.

**Live app:** https://harmouche.github.io/threads-media-downloader/

## Usage

1. Open the live URL above
2. Paste a public Threads post link (`threads.com/@user/post/CODE` or `threads.com/t/CODE`)
3. Click **Download**

- **Videos** save as `threads-video.webm`
- **Images** save as `threads-photo.jpg`

## Requirements

- Modern browser (Chrome, Edge, Firefox, Safari)
- Public Threads post (private posts will not work)
- Page must be served over HTTPS (GitHub Pages, not `file://`)

## Deploy updates

```bash
cd threads-media-downloader
git add index.html
git commit -m "Update downloader"
git push
```

GitHub Pages redeploys automatically from the `main` branch.

## How it works

1. Validates the post via Meta's public oEmbed API
2. Resolves media type via a read-only page fetch
3. **Video:** loads the official Threads embed and records playback (bypasses CDN CORS)
4. **Image:** fetches from Meta CDN with the correct referrer

No server-side code. Single `index.html` file.
