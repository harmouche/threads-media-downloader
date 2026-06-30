import { isAllowedCdnUrl } from '../../_lib/cdn-allowlist';
import {
  base64urlDecode,
  verifyProxyAuth,
} from '../../_lib/proxy-auth';
import type { ProxyAuth } from '../../_lib/types';
import {
  checkRateLimit,
  clientIp,
  errorResponse,
} from '../../_lib/rate-limit';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env, waitUntil } = context;
  const ip = clientIp(request);

  const allowed = await checkRateLimit(env.APP_KV, `dl:${ip}`, 60);
  if (!allowed) return errorResponse('Too many downloads. Try again later.', 429);

  const url = new URL(request.url);
  const uParam = url.searchParams.get('u');
  const authParam = url.searchParams.get('auth');

  if (!uParam || !authParam) return errorResponse('Missing u or auth parameter.', 400);

  let cdnUrl: string;
  let auth: ProxyAuth;
  try {
    cdnUrl = base64urlDecode(uParam);
    auth = JSON.parse(base64urlDecode(authParam)) as ProxyAuth;
  } catch {
    return errorResponse('Invalid u or auth encoding.', 400);
  }

  if (!env.PROXY_HMAC_SECRET) {
    console.error('cdn: PROXY_HMAC_SECRET not configured');
    return errorResponse('Server misconfigured.', 500);
  }

  const valid = await verifyProxyAuth(env.PROXY_HMAC_SECRET, auth, cdnUrl);
  if (!valid) return errorResponse('Invalid or expired download authorization.', 403);

  if (!isAllowedCdnUrl(cdnUrl)) return errorResponse('URL not allowed.', 403);

  const cacheKey = new Request(cdnUrl, { method: 'GET' });
  const cache = caches.default;
  let upstream = await cache.match(cacheKey);

  if (!upstream) {
    upstream = await fetch(cdnUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ThreadsMediaDownloader/1.0)',
        Referer: 'https://www.threads.com/',
      },
      cf: { cacheEverything: true, cacheTtl: 3600 },
    });
    if (upstream.ok) {
      waitUntil(cache.put(cacheKey, upstream.clone()));
    }
  }

  if (!upstream.ok) {
    console.log('cdn: upstream fail', upstream.status, auth.post_id);
    return errorResponse('Could not fetch media from CDN.', 502);
  }

  const contentType = upstream.headers.get('Content-Type') || 'application/octet-stream';
  const ext = contentType.includes('video') ? 'mp4' : contentType.includes('png') ? 'png' : 'jpg';
  const filename = `threads-media.${ext}`;

  const headers = new Headers(upstream.headers);
  headers.set('Content-Type', contentType);
  headers.set('Content-Disposition', `attachment; filename="${filename}"`);
  headers.set('Cache-Control', 'public, max-age=3600');
  headers.delete('Set-Cookie');

  const cacheStatus = upstream.headers.get('cf-cache-status') || 'UNKNOWN';
  headers.set('X-Cache-Status', cacheStatus);

  return new Response(upstream.body, { status: upstream.status, headers });
};
