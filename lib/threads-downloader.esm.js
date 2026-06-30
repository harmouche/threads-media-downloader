// ../threads-media-downloader/shared/url.ts
var THREADS_URL_RE = /^https?:\/\/(www\.)?threads\.(com|net)\/(@[\w.]+)?\/post\/[\w-]+|https?:\/\/(www\.)?threads\.(com|net)\/t\/[\w-]+/i;
function normalizeThreadsUrl(url) {
  let u = url.trim().split("?")[0];
  if (!u.endsWith("/")) u += "/";
  return u.replace(/threads\.net/gi, "threads.com");
}
function isValidThreadsUrl(url) {
  return THREADS_URL_RE.test(url.split("?")[0]);
}

// src/threads/url.ts
function assertBrowser() {
  if (typeof window === "undefined") {
    throw new Error("This module runs in the browser only.");
  }
  if (location.protocol === "file:") {
    throw new Error("Open over HTTPS, not file://");
  }
}

// src/threads/api-resolve.ts
function apiBase() {
  if (typeof location !== "undefined" && location.origin) return location.origin;
  return "";
}
async function resolvePostViaApi(inputUrl, options) {
  assertBrowser();
  const postUrl = normalizeThreadsUrl(inputUrl);
  if (!isValidThreadsUrl(postUrl)) {
    throw new Error("Invalid URL. Use threads.com/@user/post/CODE or threads.com/t/CODE");
  }
  const res = await fetch(`${apiBase()}/api/threads/post/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: postUrl,
      captchaToken: options?.captchaToken || ""
    }),
    signal: options?.signal
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Resolve failed (${res.status})`);
  }
  return data;
}
function encodeProxyQuery(cdnUrl, proxy_auth) {
  const u = btoa(unescape(encodeURIComponent(cdnUrl))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const auth = btoa(unescape(encodeURIComponent(JSON.stringify(proxy_auth)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `u=${encodeURIComponent(u)}&auth=${encodeURIComponent(auth)}`;
}
function buildProxyUrl(cdnUrl, proxy_path, proxy_auth) {
  const q = encodeProxyQuery(cdnUrl, proxy_auth);
  return `${apiBase()}${proxy_path}?${q}`;
}

// src/threads/download-direct.ts
function extensionFromType(contentType) {
  if (contentType.includes("video")) return "mp4";
  if (contentType.includes("png")) return "png";
  return "jpg";
}
function isNetworkError(err) {
  if (!(err instanceof Error)) return false;
  return /failed to fetch|networkerror|load failed/i.test(err.message) || err.name === "TypeError";
}
async function readWithProgress(res, onProgress) {
  const total = Number(res.headers.get("Content-Length") || 0);
  const reader = res.body?.getReader();
  if (!reader) return res.blob();
  const chunks = [];
  let received = 0;
  for (; ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.length;
      if (total > 0) {
        const pct = Math.min(99, Math.round(received / total * 100));
        onProgress?.(pct, `Downloading... ${pct}%`);
      } else {
        onProgress?.(50, `Downloading... ${Math.round(received / 1024)} KB`);
      }
    }
  }
  return new Blob(chunks, { type: res.headers.get("Content-Type") || "application/octet-stream" });
}
async function fetchStreamSaver() {
  const w = window;
  if (w.streamSaver) return w.streamSaver;
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/lib/vendor/streamsaver/StreamSaver.js";
    s.onload = () => {
      if (w.streamSaver) {
        w.streamSaver.mitm = "/lib/vendor/streamsaver/mitm.html";
        resolve(w.streamSaver);
      } else reject(new Error("StreamSaver failed to load"));
    };
    s.onerror = () => reject(new Error("Could not load StreamSaver"));
    document.head.appendChild(s);
  });
}
async function downloadVideoStreamSaver(res, filename, onProgress) {
  const total = Number(res.headers.get("Content-Length") || 0);
  const streamSaver = await fetchStreamSaver();
  const fileStream = streamSaver.createWriteStream(filename, { size: total || void 0 });
  const writer = fileStream.getWriter();
  const reader = res.body?.getReader();
  if (!reader) {
    const blob = await res.blob();
    await writer.write(blob);
    await writer.close();
    return blob;
  }
  const chunks = [];
  let received = 0;
  for (; ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      await writer.write(value);
      chunks.push(value);
      received += value.length;
      if (total > 0) {
        onProgress?.(Math.min(99, Math.round(received / total * 100)), "Downloading video...");
      }
    }
  }
  await writer.close();
  return new Blob(chunks, { type: res.headers.get("Content-Type") || "video/mp4" });
}
async function tryIosShare(blob, filename) {
  const file = new File([blob], filename, { type: blob.type, lastModified: Date.now() });
  const payload = { files: [file] };
  if (!navigator.canShare?.(payload)) return false;
  try {
    await navigator.share(payload);
    return true;
  } catch {
    return false;
  }
}
async function downloadVariant(variant, options) {
  const filename = `threads-${variant.content_type.includes("video") ? "video" : "photo"}.${extensionFromType(variant.content_type)}`;
  const { proxy_auth, onProgress, signal } = options;
  const directOpts = {
    credentials: "omit",
    referrerPolicy: "no-referrer-when-downgrade",
    signal
  };
  let res = null;
  try {
    onProgress?.(5, "Trying direct CDN...");
    res = await fetch(variant.url, directOpts);
    if (!res.ok) res = null;
  } catch (e) {
    if (!isNetworkError(e)) throw e;
  }
  if (!res) {
    onProgress?.(15, "Using proxy...");
    const proxyUrl = buildProxyUrl(variant.url, variant.proxy_path, proxy_auth);
    res = await fetch(proxyUrl, { signal });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
  }
  onProgress?.(20, "Saving...");
  let blob;
  if (variant.content_type.includes("video") && "WritableStream" in window) {
    try {
      blob = await downloadVideoStreamSaver(res, filename, onProgress);
    } catch {
      blob = await readWithProgress(res, onProgress);
    }
  } else {
    blob = await readWithProgress(res, onProgress);
  }
  if (blob.size < 5e3) throw new Error("Download too small. Try again or use Open raw link.");
  const shared = await tryIosShare(blob, filename);
  if (shared) onProgress?.(100, "Shared");
  return { blob, filename };
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
  return resolvePostViaApi(inputUrl, options);
}
async function downloadPost(inputUrl, options) {
  assertBrowser();
  const postUrl = normalizeThreadsUrl(inputUrl);
  if (!isValidThreadsUrl(postUrl)) {
    throw new Error("Invalid URL. Use threads.com/@user/post/CODE or threads.com/t/CODE");
  }
  options?.onProgress?.(5, "Resolving post...");
  const resolved = await resolvePostViaApi(postUrl, {
    captchaToken: options?.captchaToken,
    signal: options?.signal
  });
  const allGroups = [...resolved.media.videos, ...resolved.media.images];
  const firstVariant = options?.variant || allGroups[0]?.variants[0];
  if (!firstVariant) throw new Error("No media found.");
  const { blob, filename } = await downloadVariant(firstVariant, {
    proxy_auth: options?.proxy_auth || resolved.proxy_auth,
    onProgress: options?.onProgress,
    signal: options?.signal
  });
  options?.onProgress?.(100, "Done");
  await saveBlob(blob, filename);
  return { blob, filename };
}
export {
  buildProxyUrl,
  downloadPost,
  downloadVariant,
  resolvePost,
  resolvePostViaApi,
  saveBlob
};
