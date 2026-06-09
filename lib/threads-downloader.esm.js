// Built from src/ — run `npm run build` when Node is available to regenerate.

const THREADS_URL_RE =
  /^https?:\/\/(www\.)?threads\.(com|net)\/(@[\w.]+)?\/post\/[\w-]+|https?:\/\/(www\.)?threads\.(com|net)\/t\/[\w-]+/i;

const ELEMENT_KEY = Symbol('mediaElement');

function normalizeThreadsUrl(url) {
  let u = url.trim().split('?')[0];
  if (!u.endsWith('/')) u += '/';
  return u.replace(/threads\.net/gi, 'threads.com');
}

function isValidThreadsUrl(url) {
  return THREADS_URL_RE.test(url.split('?')[0]);
}

function assertBrowser() {
  if (typeof window === 'undefined') throw new Error('This module runs in the browser only.');
  if (location.protocol === 'file:') throw new Error('Open over HTTPS, e.g. GitHub Pages.');
}

function extractShortcode(postUrl) {
  const m = postUrl.match(/\/(?:post|t)\/([^/?]+)/);
  return m ? m[1] : '';
}

function unescapeMetaUrl(str) {
  try { return JSON.parse('"' + str.replace(/"/g, '\\"') + '"'); }
  catch { return str.replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/&amp;/g, '&'); }
}

function decodeEfgTag(url) {
  const m = url.match(/[?&]efg=([^&]+)/i);
  if (!m) return '';
  try {
    let b64 = decodeURIComponent(m[1]).replace(/\s/g, '+');
    if (b64.length % 4) b64 += '===='.slice(b64.length % 4);
    const j = JSON.parse(atob(b64));
    return j.encode_tag || j.vencode_tag || '';
  } catch { return ''; }
}

function isThumbnailUrl(url) {
  if (/cover_frame|video_default|thumbnail|poster/i.test(url)) return true;
  return /cover_frame|video_default|thumbnail|poster/i.test(decodeEfgTag(url));
}

function isProfilePicUrl(url) {
  if (/profile_pic|anonymous_profile_pic|t51\.2885-19|_s150x150|django\.150/i.test(url)) return true;
  return /profile_pic|anonymous_profile_pic/i.test(decodeEfgTag(url));
}

function isPostMediaUrl(url) {
  if (isProfilePicUrl(url) || isThumbnailUrl(url)) return false;
  if (/\.mp4|o1\/v\//i.test(url)) return true;
  const tag = decodeEfgTag(url);
  if (/FEED/i.test(tag) && !/cover_frame|video_default/i.test(tag)) return true;
  if (/t51\.(82787|71878)-15|dst-jpg_e\d+/i.test(url)) return true;
  return false;
}

function scoreMediaUrl(url, alt) {
  if (isProfilePicUrl(url) || isThumbnailUrl(url)) return -1000;
  if (/\.mp4|o1\/v\//i.test(url)) return 1000;
  if (/FEED/i.test(decodeEfgTag(url))) return 700;
  if (/t51\.(82787|71878)-15/i.test(url)) return 650;
  if (/dst-jpg_e\d+/i.test(url)) return 500;
  if (alt && /profile\s*pic/i.test(alt)) return -1000;
  if (alt && /^Image\s+2$/i.test(alt.trim())) return 300;
  return 10;
}

function collectMp4Urls(text) {
  const urls = [], seen = {};
  [/\[Video[^\]]*\]\((https?:\/\/[^)]+)\)/gi, /(https?:\/\/[^\s"'<>\\]+\.mp4[^\s"'<>\\]*)/gi].forEach((re) => {
    let m;
    while ((m = re.exec(text)) !== null) {
      const u = unescapeMetaUrl(m[1] || m[0]);
      if (u && !seen[u]) { seen[u] = 1; urls.push(u); }
    }
  });
  return urls;
}

function extractFromText(text) {
  const mp4s = collectMp4Urls(text);
  if (mp4s.length) return { type: 'video', mediaUrl: mp4s[mp4s.length - 1] };
  const imgs = [...text.matchAll(/!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g)]
    .map((m) => ({ alt: m[1], url: m[2], score: scoreMediaUrl(m[2], m[1]) }))
    .filter((x) => x.score >= 100 && isPostMediaUrl(x.url) && !/profile\s*pic/i.test(x.alt));
  if (imgs.length) return { type: 'image', mediaUrl: imgs[0].url };
  return null;
}

function walkMediaElements(root) {
  const candidates = [];
  function visit(node) {
    if (node.nodeType === 1) {
      const el = node;
      if (el.tagName === 'VIDEO') {
        const src = el.src || el.querySelector('source')?.getAttribute('src') || '';
        if (src && isPostMediaUrl(src)) candidates.push({ type: 'video', url: src, score: scoreMediaUrl(src), element: el });
      }
      if (el.tagName === 'IMG') {
        const src = el.src || '';
        if (src && isPostMediaUrl(src)) candidates.push({ type: 'image', url: src, score: scoreMediaUrl(src, el.alt), element: el });
      }
      if (el.shadowRoot) visit(el.shadowRoot);
      el.querySelectorAll('*').forEach((child) => { if (child.shadowRoot) visit(child.shadowRoot); });
    }
    node.childNodes.forEach(visit);
  }
  visit(root);
  return candidates.sort((a, b) => b.score - a.score);
}

function candidatesToItems(candidates) {
  const videos = candidates.filter((c) => c.type === 'video');
  const images = candidates.filter((c) => c.type === 'image');
  if (videos.length) return [{ type: 'video', mediaUrl: videos[0].url, duration: videos[0].element?.duration }];
  if (images.length > 1) return images.map((c) => ({ type: 'image', mediaUrl: c.url }));
  if (images.length) return [{ type: 'image', mediaUrl: images[0].url }];
  return [];
}

function parseHtmlAttrs(html) {
  const attrs = {};
  html.replace(/data-([\w-]+)="([^"]*)"/g, (_, k, v) => { attrs[k] = v; });
  return attrs;
}

let embedScriptPromise = null;

function loadEmbedScript() {
  if (embedScriptPromise) return embedScriptPromise;
  embedScriptPromise = new Promise((resolve, reject) => {
    if (document.querySelector('script[data-threads-embed]')) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://www.threads.com/embed.js';
    s.async = true;
    s.dataset.threadsEmbed = '1';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('embed.js blocked. Disable adblock or adjust CSP.'));
    document.body.appendChild(s);
  });
  return embedScriptPromise;
}

function processEmbeds() {
  if (window.instgrm?.Embeds?.process) window.instgrm.Embeds.process();
}

async function fetchOEmbed(postUrl, signal) {
  const endpoints = [
    'https://graph.threads.net/v1.0/oembed?url=' + encodeURIComponent(postUrl),
    'https://graph.threads.com/oembed?url=' + encodeURIComponent(postUrl),
  ];
  let lastError = 'oEmbed request failed';
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { signal });
      const data = await res.json();
      if (data.error) { lastError = data.error.error_user_msg || data.error.message || lastError; continue; }
      if (data.html) return data;
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      lastError = e?.message || lastError;
    }
  }
  throw new Error(lastError);
}

async function extractFromEmbedPage(shortcode, signal) {
  if (!shortcode) return null;
  try {
    const res = await fetch('https://www.threads.net/embed/post/' + shortcode, { credentials: 'omit', signal });
    if (!res.ok) return null;
    const text = await res.text();
    const mp4s = collectMp4Urls(text);
    if (mp4s.length) return { type: 'video', mediaUrl: mp4s[mp4s.length - 1] };
    return extractFromText(text);
  } catch { return null; }
}

function waitForMedia(container, timeoutMs, signal) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const tryResolve = () => {
      const found = walkMediaElements(container);
      if (found.length || Date.now() > deadline) { cleanup(); resolve(found); }
    };
    const cleanup = () => { obs.disconnect(); clearInterval(poll); signal?.removeEventListener('abort', onAbort); };
    const onAbort = () => { cleanup(); resolve([]); };
    const obs = new MutationObserver(tryResolve);
    obs.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    const poll = setInterval(tryResolve, 400);
    signal?.addEventListener('abort', onAbort);
    tryResolve();
  });
}

function attachElements(items, candidates) {
  return items.map((item) => {
    const match = candidates.find((c) => c.url === item.mediaUrl && c.type === item.type);
    const copy = { ...item };
    if (match?.element) copy[ELEMENT_KEY] = match.element;
    return copy;
  });
}

async function createEmbedSession(postUrl, options) {
  const timeoutMs = options?.timeoutMs ?? 20000;
  const signal = options?.signal;
  const oembed = await fetchOEmbed(postUrl, signal);
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;overflow:hidden;';
  container.innerHTML = oembed.html;
  document.body.appendChild(container);
  await loadEmbedScript();
  processEmbeds();
  const candidates = await waitForMedia(container, timeoutMs, signal);
  let resolvedVia = 'dom';
  let items = candidatesToItems(candidates);
  if (!items.length) parseHtmlAttrs(oembed.html);
  if (!items.length) {
    const fromPage = await extractFromEmbedPage(extractShortcode(postUrl), signal);
    if (fromPage) { items = [fromPage]; resolvedVia = 'embedPage'; }
  }
  if (!items.length) { container.remove(); throw new Error('No media found. Post may be text-only or embed failed.'); }
  const itemsWithElements = attachElements(items, candidates);
  let type = 'text';
  if (itemsWithElements.length > 1) type = 'carousel';
  else if (itemsWithElements.length === 1) type = itemsWithElements[0].type;
  return {
    container,
    resolved: { type, postUrl, items: itemsWithElements, resolvedVia },
    dispose: () => container.remove(),
  };
}

function isValidImage(buf) {
  if (!buf || buf.byteLength < 5000) return false;
  const v = new Uint8Array(buf, 0, 4);
  const head = new TextDecoder().decode(buf.slice(0, Math.min(200, buf.byteLength)));
  if (/bad url timestamp|forbidden|markdown content/i.test(head)) return false;
  return (v[0] === 0xff && v[1] === 0xd8) || (v[0] === 0x89 && v[1] === 0x50) || (v[0] === 0x52 && v[1] === 0x49);
}

async function downloadImage(mediaUrl, embedImg, options) {
  options?.onProgress?.(30, 'Downloading image...');
  try {
    const res = await fetch(mediaUrl, { credentials: 'omit', referrerPolicy: 'no-referrer-when-downgrade', signal: options?.signal });
    if (res.ok) {
      const buf = await res.arrayBuffer();
      if (isValidImage(buf)) {
        options?.onProgress?.(95, 'Image ready');
        return new Blob([buf], { type: 'image/jpeg' });
      }
    }
  } catch (e) { if (e?.name === 'AbortError') throw e; }
  if (embedImg) {
    const blob = await new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.referrerPolicy = 'no-referrer-when-downgrade';
      image.onload = () => {
        try {
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          canvas.getContext('2d').drawImage(image, 0, 0);
          canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.95);
        } catch { resolve(null); }
      };
      image.onerror = () => resolve(null);
      image.src = embedImg.src;
    });
    if (blob?.size > 5000) return blob;
  }
  throw new Error('Image download blocked. Try Chrome or Edge on desktop.');
}

function pickMime() {
  return ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || 'video/webm';
}

function loadDetachedVideo(src, signal) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.preload = 'auto';
    video.referrerPolicy = 'no-referrer-when-downgrade'; video.crossOrigin = 'anonymous';
    video.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;';
    const timer = setTimeout(() => cleanup(() => reject(new Error('Video playback timeout'))), 18000);
    const onAbort = () => cleanup(() => reject(new Error('Aborted')));
    function cleanup(done) {
      clearTimeout(timer); video.onerror = null; video.onloadeddata = null;
      signal?.removeEventListener('abort', onAbort);
      video.pause(); video.removeAttribute('src'); video.load(); video.remove(); done();
    }
    video.onerror = () => cleanup(() => reject(new Error('Video playback error')));
    video.onloadeddata = () => { clearTimeout(timer); video.onerror = null; signal?.removeEventListener('abort', onAbort); resolve(video); };
    signal?.addEventListener('abort', onAbort);
    document.body.appendChild(video);
    video.src = src;
  });
}

async function prepareEmbedVideo(video) {
  video.muted = true; video.playsInline = true; video.referrerPolicy = 'no-referrer-when-downgrade';
  if (video.readyState < 2) {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Embed video timeout')), 18000);
      video.onloadeddata = () => { clearTimeout(t); resolve(); };
      video.onerror = () => { clearTimeout(t); reject(new Error('Embed video playback error')); };
      video.load();
    });
  }
  return video;
}

function captureVideo(video, onProgress, signal) {
  const duration = video.duration && isFinite(video.duration) ? video.duration : 60;
  const mime = pickMime();
  return video.play().then(() => {
    const stream = video.captureStream?.() || video.mozCaptureStream?.();
    if (!stream) throw new Error('captureStream not supported');
    return new Promise((resolve, reject) => {
      const chunks = [];
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      const startTime = Date.now();
      const onAbort = () => { if (recorder.state === 'recording') recorder.stop(); reject(new Error('Aborted')); };
      recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
      recorder.onerror = () => reject(new Error('Recording failed'));
      recorder.onstop = () => {
        signal?.removeEventListener('abort', onAbort);
        if (!chunks.length) return reject(new Error('Recording produced no data'));
        resolve(new Blob(chunks, { type: mime }));
      };
      const tick = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        onProgress?.(Math.min(95, (elapsed / duration) * 100), 'Recording... ' + Math.round(elapsed) + 's / ' + Math.round(duration) + 's');
      }, 300);
      signal?.addEventListener('abort', onAbort);
      recorder.start(250);
      video.onended = () => { if (recorder.state === 'recording') recorder.stop(); };
      setTimeout(() => { clearInterval(tick); if (recorder.state === 'recording') { video.pause(); recorder.stop(); } }, (duration + 4) * 1000);
    });
  });
}

async function downloadVideo(mediaUrl, embedVideo, options) {
  if (!window.MediaRecorder) throw new Error('MediaRecorder not supported. Use Chrome or Edge.');
  options?.onProgress?.(15, 'Starting playback...');
  let video = null;
  const tried = [];
  if (embedVideo?.src || embedVideo?.querySelector('source')) {
    tried.push('embed');
    try { video = await prepareEmbedVideo(embedVideo); } catch { video = null; }
  }
  if (!video && mediaUrl) {
    tried.push('detached');
    try { video = await loadDetachedVideo(mediaUrl, options?.signal); } catch { video = null; }
  }
  if (!video) throw new Error('Video playback failed (tried: ' + tried.join(', ') + '). Use Chrome/Edge over HTTPS and disable adblock.');
  options?.onProgress?.(20, 'Recording...');
  const blob = await captureVideo(video, options?.onProgress, options?.signal);
  if (!embedVideo || video !== embedVideo) { video.pause(); video.remove(); }
  if (blob.size < 50000) throw new Error('Recording too small. Try again immediately.');
  options?.onProgress?.(98, 'Video ready');
  return blob;
}

export async function saveBlob(blob, filename) {
  if ('showSaveFilePicker' in window) {
    const handle = await window.showSaveFilePicker({ suggestedName: filename });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function resolvePost(inputUrl, options) {
  assertBrowser();
  const postUrl = normalizeThreadsUrl(inputUrl);
  if (!isValidThreadsUrl(postUrl)) throw new Error('Invalid URL. Use threads.com/@user/post/CODE or threads.com/t/CODE');
  const session = await createEmbedSession(postUrl, options);
  const resolved = session.resolved;
  session.dispose();
  return resolved;
}

export async function downloadPost(inputUrl, options) {
  assertBrowser();
  const postUrl = normalizeThreadsUrl(inputUrl);
  if (!isValidThreadsUrl(postUrl)) throw new Error('Invalid URL. Use threads.com/@user/post/CODE or threads.com/t/CODE');
  options?.onProgress?.(5, 'Resolving post...');
  const session = await createEmbedSession(postUrl, { signal: options?.signal, timeoutMs: 20000 });
  try {
    const item = session.resolved.items[0];
    if (!item) throw new Error('No media found.');
    const element = item[ELEMENT_KEY];
    let blob, filename;
    if (item.type === 'video') {
      if (!window.MediaRecorder) throw new Error('MediaRecorder not supported. Use Chrome or Edge.');
      if (!item.mediaUrl) throw new Error('No video URL found.');
      blob = await downloadVideo(item.mediaUrl, element, options);
      filename = 'threads-video.webm';
    } else {
      if (!item.mediaUrl) throw new Error('No image URL found.');
      blob = await downloadImage(item.mediaUrl, element, options);
      filename = 'threads-photo.jpg';
    }
    options?.onProgress?.(100, 'Done');
    await saveBlob(blob, filename);
    return { blob, filename };
  } finally {
    session.dispose();
  }
}
