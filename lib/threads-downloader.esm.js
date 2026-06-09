// src/threads/url.ts
var THREADS_URL_RE = /^https?:\/\/(www\.)?threads\.(com|net)\/(@[\w.]+)?\/post\/[\w-]+|https?:\/\/(www\.)?threads\.(com|net)\/t\/[\w-]+/i;
function normalizeThreadsUrl(url) {
  let u = url.trim().split("?")[0];
  if (!u.endsWith("/")) u += "/";
  return u.replace(/threads\.net/gi, "threads.com");
}
function isValidThreadsUrl(url) {
  return THREADS_URL_RE.test(url.split("?")[0]);
}
function assertBrowser() {
  if (typeof window === "undefined") {
    throw new Error("This module runs in the browser only.");
  }
  if (location.protocol === "file:") {
    throw new Error("Open over HTTPS, e.g. GitHub Pages.");
  }
}

// src/threads/oembed.ts
async function fetchOEmbed(postUrl, signal) {
  const endpoints = [
    `https://graph.threads.net/v1.0/oembed?url=${encodeURIComponent(postUrl)}`,
    `https://graph.threads.com/oembed?url=${encodeURIComponent(postUrl)}`
  ];
  let lastError = "oEmbed request failed";
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { signal });
      const data = await res.json();
      if (data.error) {
        lastError = data.error.error_user_msg || data.error.message || lastError;
        continue;
      }
      if (data.html) return data;
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") throw e;
      lastError = e instanceof Error ? e.message : lastError;
    }
  }
  throw new Error(lastError);
}

// src/threads/extract.ts
function unescapeMetaUrl(str) {
  try {
    return JSON.parse('"' + str.replace(/"/g, '\\"') + '"');
  } catch {
    return str.replace(/\\u0026/g, "&").replace(/\\\//g, "/").replace(/&amp;/g, "&");
  }
}
function decodeEfgTag(url) {
  const m = url.match(/[?&]efg=([^&]+)/i);
  if (!m) return "";
  try {
    let b64 = decodeURIComponent(m[1]).replace(/\s/g, "+");
    if (b64.length % 4) b64 += "====".slice(b64.length % 4);
    const j = JSON.parse(atob(b64));
    return j.encode_tag || j.vencode_tag || "";
  } catch {
    return "";
  }
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
  if (isProfilePicUrl(url) || isThumbnailUrl(url)) return -1e3;
  if (/\.mp4|o1\/v\//i.test(url)) return 1e3;
  if (/FEED/i.test(decodeEfgTag(url))) return 700;
  if (/t51\.(82787|71878)-15/i.test(url)) return 650;
  if (/dst-jpg_e\d+/i.test(url)) return 500;
  if (alt && /profile\s*pic/i.test(alt)) return -1e3;
  if (alt && /^Image\s+2$/i.test(alt.trim())) return 300;
  return 10;
}
function collectMp4Urls(text) {
  const urls = [];
  const seen = {};
  const patterns = [
    /\[Video[^\]]*\]\((https?:\/\/[^)]+)\)/gi,
    /(https?:\/\/[^\s"'<>\\]+\.mp4[^\s"'<>\\]*)/gi
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const u = unescapeMetaUrl(m[1] || m[0]);
      if (u && !seen[u]) {
        seen[u] = 1;
        urls.push(u);
      }
    }
  }
  return urls;
}
function extractFromText(text) {
  const mp4s = collectMp4Urls(text);
  if (mp4s.length) return { type: "video", mediaUrl: mp4s[mp4s.length - 1] };
  const imgs = [...text.matchAll(/!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g)].map((m) => ({ alt: m[1], url: m[2], score: scoreMediaUrl(m[2], m[1]) })).filter((x) => x.score >= 100 && isPostMediaUrl(x.url) && !/profile\s*pic/i.test(x.alt));
  if (imgs.length) return { type: "image", mediaUrl: imgs[0].url };
  return null;
}
function walkMediaElements(root) {
  const candidates = [];
  function visit(node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node;
      if (el.tagName === "VIDEO") {
        const v = el;
        const src = v.src || v.querySelector("source")?.getAttribute("src") || "";
        if (src && isPostMediaUrl(src)) {
          candidates.push({ type: "video", url: src, score: scoreMediaUrl(src), element: v });
        }
      }
      if (el.tagName === "IMG") {
        const img = el;
        const src = img.src || "";
        if (src && isPostMediaUrl(src)) {
          candidates.push({
            type: "image",
            url: src,
            score: scoreMediaUrl(src, img.alt),
            element: img
          });
        }
      }
      if (el.shadowRoot) visit(el.shadowRoot);
      el.querySelectorAll("*").forEach((child) => {
        if (child.shadowRoot) visit(child.shadowRoot);
      });
    }
    node.childNodes.forEach(visit);
  }
  visit(root);
  return candidates.sort((a, b) => b.score - a.score);
}
function candidatesToItems(candidates) {
  const videos = candidates.filter((c) => c.type === "video");
  const images = candidates.filter((c) => c.type === "image");
  if (videos.length) {
    const best = videos[0];
    return [{ type: "video", mediaUrl: best.url, duration: best.element?.duration }];
  }
  if (images.length > 1) {
    return images.map((c) => ({ type: "image", mediaUrl: c.url }));
  }
  if (images.length) {
    return [{ type: "image", mediaUrl: images[0].url }];
  }
  return [];
}

// src/threads/embed-page.ts
async function extractFromEmbedPage(embedUrl, signal) {
  if (!embedUrl) return null;
  try {
    const res = await fetch(embedUrl, { credentials: "omit", signal });
    if (!res.ok) return null;
    const text = await res.text();
    const mp4s = collectMp4Urls(text);
    if (mp4s.length) return { type: "video", mediaUrl: mp4s[mp4s.length - 1] };
    const fromText = extractFromText(text);
    if (fromText?.mediaUrl) return fromText;
    return null;
  } catch {
    return null;
  }
}

// src/threads/embed-url.ts
function permalinkFromOEmbedHtml(html) {
  const match = html.match(/data-text-post-permalink="([^"]+)"/);
  if (!match) return null;
  return match[1].replace(/&amp;/g, "&");
}
function buildEmbedUrlFromPermalink(permalink) {
  const re = /^(.*?)\/?(\?.*|#|$)/;
  const match = re.exec(permalink);
  if (!match) return permalink;
  return `${match[1]}/embed/${match[2] || ""}`;
}

// src/threads/embed-session.ts
var ELEMENT_KEY = /* @__PURE__ */ Symbol("mediaElement");
var IFRAME_KEY = /* @__PURE__ */ Symbol("embedIframe");
function waitForEmbedIframe(iframe, timeoutMs, signal) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const onMessage = (event) => {
      const origin = event.origin || "";
      if (!/threads\.(com|net)$/.test(origin.replace(/^https?:\/\/(www\.)?/, ""))) return;
      if (typeof event.data === "number" && event.data > 120) {
        cleanup();
        resolve();
      }
    };
    const poll = setInterval(() => {
      if (iframe.clientHeight > 120 || iframe.offsetHeight > 120) {
        cleanup();
        resolve();
        return;
      }
      if (Date.now() > deadline) {
        cleanup();
        resolve();
      }
    }, 400);
    const onLoad = () => {
      setTimeout(() => {
        if (Date.now() > deadline) return;
        cleanup();
        resolve();
      }, 2500);
    };
    const cleanup = () => {
      clearInterval(poll);
      iframe.removeEventListener("load", onLoad);
      window.removeEventListener("message", onMessage);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      resolve();
    };
    iframe.addEventListener("load", onLoad);
    window.addEventListener("message", onMessage);
    signal?.addEventListener("abort", onAbort);
    if (iframe.contentDocument?.readyState === "complete") onLoad();
  });
}
function buildResolved(postUrl, items, resolvedVia) {
  let type = "text";
  if (items.length > 1) type = "carousel";
  else if (items.length === 1) type = items[0].type;
  return { type, postUrl, items, resolvedVia };
}
function attachRefs(items, candidates, iframe) {
  return items.map((item) => {
    const withRefs = { ...item };
    const match = candidates.find((c) => c.url === item.mediaUrl && c.type === item.type);
    if (match?.element) withRefs[ELEMENT_KEY] = match.element;
    if (!item.mediaUrl) withRefs[IFRAME_KEY] = iframe;
    return withRefs;
  });
}
function getMediaElement(item) {
  return item[ELEMENT_KEY];
}
function getEmbedIframe(item) {
  return item[IFRAME_KEY];
}
async function createEmbedSession(postUrl, options) {
  const timeoutMs = options?.timeoutMs ?? 25e3;
  const signal = options?.signal;
  const oembed = await fetchOEmbed(postUrl, signal);
  const permalink = permalinkFromOEmbedHtml(oembed.html);
  if (!permalink) {
    throw new Error("oEmbed blockquote missing permalink.");
  }
  const embedUrl = buildEmbedUrlFromPermalink(permalink);
  let items = [];
  let resolvedVia = "embedPage";
  const fromPage = await extractFromEmbedPage(embedUrl, signal);
  if (fromPage?.mediaUrl) {
    items = [fromPage];
  }
  const iframe = document.createElement("iframe");
  iframe.title = "Threads embed";
  iframe.src = embedUrl;
  iframe.setAttribute("allow", "autoplay; encrypted-media; fullscreen");
  iframe.setAttribute("allowfullscreen", "true");
  iframe.setAttribute("referrerpolicy", "no-referrer-when-downgrade");
  iframe.style.cssText = "position:fixed;left:0;top:0;width:658px;min-height:480px;height:70vh;max-height:900px;opacity:0.02;pointer-events:none;z-index:-1;border:0;";
  document.body.appendChild(iframe);
  await waitForEmbedIframe(iframe, timeoutMs, signal);
  const candidates = walkMediaElements(iframe.contentDocument?.body ?? document.body);
  if (!items.length && candidates.length) {
    items = candidatesToItems(candidates);
    resolvedVia = "dom";
  }
  if (!items.length) {
    items = [{ type: "video" }];
    resolvedVia = "embedIframe";
  }
  const itemsWithRefs = attachRefs(items, candidates, iframe);
  const resolved = buildResolved(postUrl, itemsWithRefs, resolvedVia);
  return {
    iframe,
    candidates,
    resolved,
    dispose: () => {
      iframe.remove();
    }
  };
}

// src/threads/capture-iframe.ts
function pickMime() {
  const types = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return types.find((m) => MediaRecorder.isTypeSupported(m)) || "video/webm";
}
function captureStream(stream, durationSec, onProgress, signal, stopTracks = true) {
  const mime = pickMime();
  return new Promise((resolve, reject) => {
    const chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    const start = Date.now();
    const onAbort = () => {
      if (recorder.state === "recording") recorder.stop();
      reject(new Error("Aborted"));
    };
    recorder.ondataavailable = (e) => {
      if (e.data?.size) chunks.push(e.data);
    };
    recorder.onerror = () => reject(new Error("Recording failed"));
    recorder.onstop = () => {
      signal?.removeEventListener("abort", onAbort);
      if (stopTracks) stream.getTracks().forEach((t) => t.stop());
      if (!chunks.length) return reject(new Error("Recording produced no data"));
      resolve(new Blob(chunks, { type: mime }));
    };
    const tick = setInterval(() => {
      const elapsed = (Date.now() - start) / 1e3;
      onProgress?.(Math.min(95, elapsed / durationSec * 100), `Recording embed... ${Math.round(elapsed)}s`);
    }, 300);
    signal?.addEventListener("abort", onAbort);
    recorder.start(250);
    setTimeout(() => {
      clearInterval(tick);
      if (recorder.state === "recording") recorder.stop();
    }, (durationSec + 2) * 1e3);
  });
}
function canCaptureEmbedIframe() {
  return typeof window.CropTarget !== "undefined" && typeof MediaStreamTrack.prototype.cropTo === "function";
}
async function captureEmbedIframe(iframe, options) {
  if (!canCaptureEmbedIframe()) {
    throw new Error(
      "Chrome 132+ is required to record the embed without a direct media URL. Use Chrome and allow tab capture when prompted."
    );
  }
  const durationSec = options?.durationSec ?? 60;
  options?.onProgress?.(12, "Allow this tab when the browser asks...");
  let stream = options?.displayStream;
  let ownsStream = false;
  if (!stream) {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      preferCurrentTab: true,
      selfBrowserSurface: "include"
    });
    ownsStream = true;
  }
  try {
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error("No video track from tab capture");
    const cropTarget = await window.CropTarget.fromElement(iframe);
    await track.cropTo(cropTarget);
    options?.onProgress?.(20, "Recording embed playback...");
    const blob = await captureStream(
      stream,
      durationSec,
      options?.onProgress,
      options?.signal,
      ownsStream
    );
    if (blob.size < 5e4) {
      throw new Error("Recording too small. Try again and keep the embed visible until recording finishes.");
    }
    return blob;
  } finally {
    if (ownsStream) {
      stream.getTracks().forEach((t) => t.stop());
    }
  }
}

// src/threads/download-image.ts
function isValidImage(buf) {
  if (!buf || buf.byteLength < 5e3) return false;
  const v = new Uint8Array(buf, 0, 4);
  const head = new TextDecoder().decode(buf.slice(0, Math.min(200, buf.byteLength)));
  if (/bad url timestamp|forbidden|markdown content/i.test(head)) return false;
  return v[0] === 255 && v[1] === 216 || v[0] === 137 && v[1] === 80 || v[0] === 82 && v[1] === 73;
}
async function fetchImageBytes(url, signal) {
  try {
    const res = await fetch(url, {
      credentials: "omit",
      referrerPolicy: "no-referrer-when-downgrade",
      signal
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (isValidImage(buf)) return buf;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw e;
  }
  return null;
}
async function canvasFromImage(img) {
  return new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.referrerPolicy = "no-referrer-when-downgrade";
    image.onload = () => {
      try {
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(image, 0, 0);
        canvas.toBlob((b) => resolve(b), "image/jpeg", 0.95);
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = img.src;
  });
}
async function downloadImage(mediaUrl, embedImg, options) {
  options?.onProgress?.(30, "Downloading image...");
  const buf = await fetchImageBytes(mediaUrl, options?.signal);
  if (buf) {
    options?.onProgress?.(95, "Image ready");
    return new Blob([buf], { type: "image/jpeg" });
  }
  if (embedImg) {
    options?.onProgress?.(50, "Trying canvas fallback...");
    const blob = await canvasFromImage(embedImg);
    if (blob && blob.size > 5e3) {
      options?.onProgress?.(95, "Image ready");
      return blob;
    }
  }
  throw new Error("Image download blocked. Try Chrome or Edge on desktop.");
}

// src/threads/download-video.ts
function pickMime2() {
  const types = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return types.find((m) => MediaRecorder.isTypeSupported(m)) || "video/webm";
}
function loadDetachedVideo(src, signal) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.referrerPolicy = "no-referrer-when-downgrade";
    video.crossOrigin = "anonymous";
    video.style.cssText = "position:fixed;left:-9999px;width:1px;height:1px;";
    const timer = setTimeout(() => cleanup(() => reject(new Error("Video playback timeout"))), 18e3);
    const onAbort = () => cleanup(() => reject(new Error("Aborted")));
    function cleanup(done) {
      clearTimeout(timer);
      video.onerror = null;
      video.onloadeddata = null;
      signal?.removeEventListener("abort", onAbort);
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.remove();
      done();
    }
    video.onerror = () => cleanup(() => reject(new Error("Video playback error")));
    video.onloadeddata = () => {
      clearTimeout(timer);
      video.onerror = null;
      signal?.removeEventListener("abort", onAbort);
      resolve(video);
    };
    signal?.addEventListener("abort", onAbort);
    document.body.appendChild(video);
    video.src = src;
  });
}
async function prepareEmbedVideo(video) {
  video.muted = true;
  video.playsInline = true;
  video.referrerPolicy = "no-referrer-when-downgrade";
  if (video.readyState < 2) {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Embed video timeout")), 18e3);
      video.onloadeddata = () => {
        clearTimeout(t);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(t);
        reject(new Error("Embed video playback error"));
      };
      video.load();
    });
  }
  return video;
}
function captureVideo(video, onProgress, signal) {
  const duration = video.duration && isFinite(video.duration) ? video.duration : 60;
  const mime = pickMime2();
  return video.play().then(() => {
    const stream = video.captureStream?.() ?? video.mozCaptureStream?.();
    if (!stream) throw new Error("captureStream not supported");
    return new Promise((resolve, reject) => {
      const chunks = [];
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      const startTime = Date.now();
      const onAbort = () => {
        if (recorder.state === "recording") recorder.stop();
        reject(new Error("Aborted"));
      };
      recorder.ondataavailable = (e) => {
        if (e.data?.size) chunks.push(e.data);
      };
      recorder.onerror = () => reject(new Error("Recording failed"));
      recorder.onstop = () => {
        signal?.removeEventListener("abort", onAbort);
        if (!chunks.length) return reject(new Error("Recording produced no data"));
        resolve(new Blob(chunks, { type: mime }));
      };
      const tick = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1e3;
        onProgress?.(Math.min(95, elapsed / duration * 100), `Recording... ${Math.round(elapsed)}s / ${Math.round(duration)}s`);
      }, 300);
      signal?.addEventListener("abort", onAbort);
      recorder.start(250);
      video.onended = () => {
        if (recorder.state === "recording") recorder.stop();
      };
      setTimeout(() => {
        clearInterval(tick);
        if (recorder.state === "recording") {
          video.pause();
          recorder.stop();
        }
      }, (duration + 4) * 1e3);
    });
  });
}
async function downloadVideo(mediaUrl, embedVideo, options) {
  if (!window.MediaRecorder) {
    throw new Error("MediaRecorder not supported. Use Chrome or Edge.");
  }
  options?.onProgress?.(15, "Starting playback...");
  let video = null;
  const tried = [];
  if (embedVideo?.src || embedVideo?.querySelector("source")) {
    tried.push("embed");
    try {
      video = await prepareEmbedVideo(embedVideo);
    } catch {
      video = null;
    }
  }
  if (!video && mediaUrl) {
    tried.push("detached");
    try {
      video = await loadDetachedVideo(mediaUrl, options?.signal);
    } catch {
      video = null;
    }
  }
  if (!video) {
    throw new Error(
      `Video playback failed (tried: ${tried.join(", ")}). Use Chrome/Edge over HTTPS and disable adblock.`
    );
  }
  options?.onProgress?.(20, "Recording...");
  const blob = await captureVideo(video, options?.onProgress, options?.signal);
  if (!embedVideo || video !== embedVideo) {
    video.pause();
    video.remove();
  }
  if (blob.size < 5e4) {
    throw new Error("Recording too small. Try again immediately.");
  }
  options?.onProgress?.(98, "Video ready");
  return blob;
}

// src/threads/save.ts
async function saveBlob(blob, filename) {
  if ("showSaveFilePicker" in window) {
    const handle = await window.showSaveFilePicker({ suggestedName: filename });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 6e4);
}

// src/index.ts
async function resolvePost(inputUrl, options) {
  assertBrowser();
  const postUrl = normalizeThreadsUrl(inputUrl);
  if (!isValidThreadsUrl(postUrl)) {
    throw new Error("Invalid URL. Use threads.com/@user/post/CODE or threads.com/t/CODE");
  }
  const session = await createEmbedSession(postUrl, options);
  session.dispose();
  return session.resolved;
}
async function requestTabCapture(options) {
  if (!canCaptureEmbedIframe()) return void 0;
  try {
    options?.onProgress?.(
      8,
      "Allow this tab when prompted (used if Threads blocks direct media URLs)..."
    );
    return await navigator.mediaDevices.getDisplayMedia({
      video: true,
      preferCurrentTab: true,
      selfBrowserSurface: "include"
    });
  } catch {
    return void 0;
  }
}
async function downloadPost(inputUrl, options) {
  assertBrowser();
  const postUrl = normalizeThreadsUrl(inputUrl);
  if (!isValidThreadsUrl(postUrl)) {
    throw new Error("Invalid URL. Use threads.com/@user/post/CODE or threads.com/t/CODE");
  }
  options?.onProgress?.(5, "Resolving post...");
  const tabCapture = await requestTabCapture(options);
  const session = await createEmbedSession(postUrl, {
    signal: options?.signal,
    timeoutMs: 2e4
  });
  try {
    const item = session.resolved.items[0];
    if (!item) throw new Error("No media found.");
    const element = getMediaElement(item);
    const embedIframe = getEmbedIframe(item) ?? session.iframe;
    let blob;
    let filename;
    if (item.type === "video") {
      if (item.mediaUrl) {
        tabCapture?.getTracks().forEach((t) => t.stop());
        if (!window.MediaRecorder) {
          throw new Error("MediaRecorder not supported. Use Chrome or Edge.");
        }
        blob = await downloadVideo(item.mediaUrl, element, options);
        filename = "threads-video.webm";
      } else {
        if (!tabCapture) {
          throw new Error(
            "Could not read a direct video URL (Threads CORS). Allow tab capture in Chrome 132+ when prompted, or use the dt.html fallback."
          );
        }
        blob = await captureEmbedIframe(embedIframe, {
          signal: options?.signal,
          onProgress: options?.onProgress,
          displayStream: tabCapture
        });
        filename = "threads-video.webm";
      }
    } else {
      tabCapture?.getTracks().forEach((t) => t.stop());
      if (!item.mediaUrl) {
        throw new Error("No image URL found. Image posts may need tab capture support in a future update.");
      }
      blob = await downloadImage(item.mediaUrl, element, options);
      filename = "threads-photo.jpg";
    }
    options?.onProgress?.(100, "Done");
    await saveBlob(blob, filename);
    return { blob, filename };
  } finally {
    tabCapture?.getTracks().forEach((t) => t.stop());
    session.dispose();
  }
}
export {
  downloadPost,
  resolvePost,
  saveBlob
};
