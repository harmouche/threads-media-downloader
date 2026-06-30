export const THREADS_URL_RE =
  /^https?:\/\/(www\.)?threads\.(com|net)\/(@[\w.]+)?\/post\/[\w-]+|https?:\/\/(www\.)?threads\.(com|net)\/t\/[\w-]+/i;

export function normalizeThreadsUrl(url: string): string {
  let u = url.trim().split('?')[0];
  if (!u.endsWith('/')) u += '/';
  return u.replace(/threads\.net/gi, 'threads.com');
}

export function isValidThreadsUrl(url: string): boolean {
  return THREADS_URL_RE.test(url.split('?')[0]);
}

export function extractPostId(postUrl: string): string {
  const m = postUrl.match(/\/(?:post|t)\/([^/?]+)/);
  return m ? m[1] : '';
}
