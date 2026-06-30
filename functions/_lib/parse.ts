import type { MediaGroup, MediaVariant } from './types';
import { PROXY_PATH } from './types';

const FETCH_HEADERS = {
  'User-Agent':
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
};

function unescapeMetaUrl(str: string): string {
  try {
    return JSON.parse('"' + str.replace(/"/g, '\\"') + '"') as string;
  } catch {
    return str.replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/&amp;/g, '&');
  }
}

function decodeEfgTag(url: string): string {
  const m = url.match(/[?&]efg=([^&]+)/i);
  if (!m) return '';
  try {
    let b64 = decodeURIComponent(m[1]).replace(/\s/g, '+');
    if (b64.length % 4) b64 += '===='.slice(b64.length % 4);
    const j = JSON.parse(atob(b64)) as { encode_tag?: string; vencode_tag?: string };
    return j.encode_tag || j.vencode_tag || '';
  } catch {
    return '';
  }
}

function isThumbnailUrl(url: string): boolean {
  if (/cover_frame|video_default|thumbnail|poster/i.test(url)) return true;
  return /cover_frame|video_default|thumbnail|poster/i.test(decodeEfgTag(url));
}

function isProfilePicUrl(url: string): boolean {
  if (/profile_pic|anonymous_profile_pic|t51\.2885-19|_s150x150|django\.150/i.test(url)) return true;
  return /profile_pic|anonymous_profile_pic/i.test(decodeEfgTag(url));
}

function variantDedupeKey(url: string): string {
  const assetId = url.match(/\/(AQ[A-Za-z0-9_-]+)/)?.[1];
  if (assetId) return assetId;
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url.split('?')[0];
  }
}

function collectPosterUrls(text: string): string[] {
  const normalized = normalizeHtml(text);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of normalized.matchAll(/"thumbnail_url"\s*:\s*"([^"]+)"/g)) {
    const u = unescapeMetaUrl(m[1]);
    if (!u || seen.has(u) || isProfilePicUrl(u) || /\.mp4/i.test(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

export function htmlContainsPostId(html: string, postId: string): boolean {
  if (!postId || !html) return false;
  const escaped = postId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`/post/${escaped}(?:/|["'?&#])`, 'i'),
    new RegExp(`/t/${escaped}(?:/|["'?&#])`, 'i'),
    new RegExp(`"code"\\s*:\\s*"${escaped}"`, 'i'),
    new RegExp(`"shortcode"\\s*:\\s*"${escaped}"`, 'i'),
    new RegExp(`data-text-post-permalink="[^"]*/(?:post|t)/${escaped}`, 'i'),
  ];
  return patterns.some((re) => re.test(html));
}

export function isPostMediaUrl(url: string): boolean {
  if (isProfilePicUrl(url) || isThumbnailUrl(url)) return false;
  if (/\.mp4|o1\/v\//i.test(url)) return true;
  const tag = decodeEfgTag(url);
  if (/FEED/i.test(tag) && !/cover_frame|video_default/i.test(tag)) return true;
  if (/t51\.(82787|71878)-15|dst-jpg_e\d+/i.test(url)) return true;
  return false;
}

function scoreMediaUrl(url: string): number {
  if (isProfilePicUrl(url) || isThumbnailUrl(url)) return -1000;
  if (/\.mp4|o1\/v\//i.test(url)) return 1000;
  if (/FEED/i.test(decodeEfgTag(url))) return 700;
  if (/t51\.(82787|71878)-15/i.test(url)) return 650;
  if (/dst-jpg_e\d+/i.test(url)) return 500;
  return 10;
}

interface RawCandidate {
  url: string;
  type: 'video' | 'image';
  width?: number;
  height?: number;
}

function normalizeHtml(html: string): string {
  return html.replace(/&amp;/g, '&').replace(/\\u0026/g, '&').replace(/\\\//g, '/');
}

function collectMp4FromText(text: string): RawCandidate[] {
  const normalized = normalizeHtml(text);
  const out: RawCandidate[] = [];
  const seen = new Set<string>();
  const patterns = [
    /\[Video[^\]]*\]\((https?:\/\/[^)]+)\)/gi,
    /(https?:\/\/[^\s"'<>\\]+\.mp4[^\s"'<>\\]*)/gi,
    /(https?:\/\/[^\s"'<>\\]+cdninstagram\.com[^\s"'<>\\]+\.mp4[^\s"'<>\\]*)/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(normalized)) !== null) {
      const u = unescapeMetaUrl(m[1] || m[0]);
      if (u && isPostMediaUrl(u) && !seen.has(u)) {
        seen.add(u);
        out.push({ url: u, type: 'video' });
      }
    }
  }
  return out;
}

function collectFromJsonBlobs(text: string): RawCandidate[] {
  const normalized = normalizeHtml(text);
  const out: RawCandidate[] = [];
  const seen = new Set<string>();

  function add(url: string | undefined, type: 'video' | 'image', width?: number, height?: number) {
    if (!url || !isPostMediaUrl(url) || seen.has(url)) return;
    seen.add(url);
    out.push({ url: unescapeMetaUrl(url), type, width, height });
  }

  const versionBlocks = normalized.matchAll(/"video_versions"\s*:\s*(\[[\s\S]*?\])/g);
  for (const block of versionBlocks) {
    try {
      const arr = JSON.parse(block[1]) as Array<{ url?: string; width?: number; height?: number }>;
      for (const v of arr) add(v.url, 'video', v.width, v.height);
    } catch {
      /* skip malformed */
    }
  }

  const imageBlocks = normalized.matchAll(/"image_versions2"\s*:\s*(\{[\s\S]*?"candidates"\s*:\s*\[[\s\S]*?\]\s*\})/g);
  for (const block of imageBlocks) {
    try {
      const obj = JSON.parse(block[1]) as { candidates?: Array<{ url?: string; width?: number; height?: number }> };
      for (const c of obj.candidates || []) add(c.url, 'image', c.width, c.height);
    } catch {
      /* skip */
    }
  }

  const displayUrls = normalized.matchAll(/"display_url"\s*:\s*"([^"]+)"/g);
  for (const m of displayUrls) {
    const u = unescapeMetaUrl(m[1]);
    const type = /\.mp4|o1\/v\//i.test(u) ? 'video' : 'image';
    add(u, type);
  }

  const playback = normalized.matchAll(/"playback_url"\s*:\s*"([^"]+)"/g);
  for (const m of playback) add(unescapeMetaUrl(m[1]), 'video');

  return out;
}

function collectImagesFromMarkdown(text: string): RawCandidate[] {
  const out: RawCandidate[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g)) {
    const url = m[2];
    if (!isPostMediaUrl(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, type: 'image' });
  }
  return out;
}

function dedupeVariants(candidates: RawCandidate[], max = 3): MediaVariant[] {
  const sorted = [...candidates].sort((a, b) => {
    const sa = (a.width || 0) * (a.height || 0) || scoreMediaUrl(a.url);
    const sb = (b.width || 0) * (b.height || 0) || scoreMediaUrl(b.url);
    return sb - sa;
  });

  const seen = new Set<string>();
  const variants: MediaVariant[] = [];

  for (const c of sorted) {
    const key = variantDedupeKey(c.url);
    if (seen.has(key)) continue;
    seen.add(key);

    const w = c.width;
    const h = c.height;
    const resolution = w && h ? `${w}x${h}` : 'Best Quality';
    const content_type = c.type === 'video' ? 'video/mp4' : 'image/jpeg';

    variants.push({
      url: c.url,
      proxy_path: PROXY_PATH,
      content_type,
      width: w,
      height: h,
      resolution,
    });
    if (variants.length >= max) break;
  }

  return variants;
}

function groupByType(
  candidates: RawCandidate[],
  posters: string[] = []
): { videos: MediaGroup[]; images: MediaGroup[] } {
  const videos = candidates.filter((c) => c.type === 'video');
  const images = candidates.filter((c) => c.type === 'image');

  const videoGroups: MediaGroup[] = [];
  const imageGroups: MediaGroup[] = [];

  if (videos.length) {
    const variants = dedupeVariants(videos);
    if (variants.length) {
      const poster =
        posters.find((p) => !/\.mp4/i.test(p)) ||
        images.find((i) => !isThumbnailUrl(i.url))?.url;
      videoGroups.push({
        thumbnail: poster || undefined,
        variants,
      });
    }
  }

  if (images.length) {
    const byBase = new Map<string, RawCandidate[]>();
    for (const img of images) {
      const base = img.url.split('?')[0];
      const list = byBase.get(base) || [];
      list.push(img);
      byBase.set(base, list);
    }
    const uniqueImages = [...byBase.values()].map((list) => list[0]);
    for (const img of uniqueImages) {
      const variants = dedupeVariants([img, ...images.filter((i) => i.url === img.url)], 3);
      if (variants.length) imageGroups.push({ thumbnail: variants[0].url, variants });
    }
  }

  return { videos: videoGroups, images: imageGroups };
}

export async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      ...FETCH_HEADERS,
      Referer: 'https://www.threads.com/',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Fetch failed HTTP ${res.status}`);
  return res.text();
}

async function fetchHtmlViaJina(url: string): Promise<string> {
  const res = await fetch(`https://r.jina.ai/${url}`, {
    headers: { 'X-Timeout': '25', Accept: 'text/plain' },
  });
  if (!res.ok) throw new Error(`Jina reader HTTP ${res.status}`);
  return res.text();
}

function htmlLooksUseful(html: string): boolean {
  return html.length > 3000 && /mp4|video_versions|display_url|image_versions/i.test(html);
}

export interface ParseResult {
  media: { videos: MediaGroup[]; images: MediaGroup[] };
  parserSource: string;
  rawVariantCount: number;
}

export function parseMediaFromHtml(html: string, source: string): ParseResult {
  const normalized = normalizeHtml(html);
  const candidates: RawCandidate[] = [
    ...collectMp4FromText(normalized),
    ...collectFromJsonBlobs(normalized),
    ...collectImagesFromMarkdown(normalized),
  ];
  const posters = collectPosterUrls(normalized);

  const media = groupByType(candidates, posters);
  const rawVariantCount =
    media.videos.reduce((n, g) => n + g.variants.length, 0) +
    media.images.reduce((n, g) => n + g.variants.length, 0);

  return { media, parserSource: source, rawVariantCount };
}

export async function resolveMediaFromPages(
  postUrl: string,
  embedUrl: string,
  postId: string
): Promise<ParseResult> {
  let embedConfirmed = false;

  const embedAttempts: Array<{ url: string; source: string }> = [
    { url: embedUrl, source: 'embed' },
  ];
  const pageAttempts: Array<{ url: string; source: string }> = [
    { url: postUrl, source: 'page' },
  ];

  async function tryAttempt(attempt: { url: string; source: string }): Promise<{
    html: string;
    result: ParseResult;
  } | null> {
    let html = '';
    try {
      html = await fetchHtml(attempt.url);
      if (!htmlLooksUseful(html)) {
        html = await fetchHtmlViaJina(attempt.url);
        attempt.source = `${attempt.source}-jina`;
      }
    } catch {
      try {
        html = await fetchHtmlViaJina(attempt.url);
        attempt.source = `${attempt.source}-jina`;
      } catch {
        return null;
      }
    }

    const result = parseMediaFromHtml(html, attempt.source);
    return { html, result };
  }

  for (const attempt of embedAttempts) {
    const out = await tryAttempt(attempt);
    if (!out) continue;
    if (htmlContainsPostId(out.html, postId)) {
      embedConfirmed = true;
      if (out.result.rawVariantCount > 0) return out.result;
    }
  }

  if (embedConfirmed) {
    return parseMediaFromHtml('', 'none');
  }

  for (const attempt of pageAttempts) {
    const out = await tryAttempt(attempt);
    if (!out) continue;
    if (out.result.rawVariantCount > 0 && htmlContainsPostId(out.html, postId)) {
      return out.result;
    }
  }

  return parseMediaFromHtml('', 'none');
}

export function collectAllCdnUrls(media: {
  videos: MediaGroup[];
  images: MediaGroup[];
}): string[] {
  const urls = new Set<string>();
  for (const g of [...media.videos, ...media.images]) {
    for (const v of g.variants) urls.add(v.url);
  }
  return [...urls];
}
