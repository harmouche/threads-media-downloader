import { signProxyAuth } from '../../../_lib/proxy-auth';
import {
  buildEmbedUrlFromPermalink,
  fetchOEmbedServer,
  permalinkFromOEmbedHtml,
} from '../../../_lib/oembed';
import {
  collectAllCdnUrls,
  resolveMediaFromPages,
} from '../../../_lib/parse';
import type { ResolveResponse } from '../../../_lib/types';
import {
  checkRateLimit,
  clientIp,
  corsHeaders,
  errorResponse,
  jsonResponse,
  rejectIfCrossOrigin,
  verifyTurnstile,
} from '../../../_lib/rate-limit';
import { extractPostId, isValidThreadsUrl, normalizeThreadsUrl } from '../../../_lib/url';

function buildEmbedUrlFromPostUrl(postUrl: string): string {
  const base = postUrl.replace(/\/$/, '');
  return `${base}/embed/`;
}

function mapOembedError(msg: string): string {
  return msg
    .replace(/Sorry, that page does not exist./i, 'Invalid Thread')
    .replace(/Sorry, you are not authorized to see this status./i, 'The thread you entered is private.')
    .replace(/No status found with that ID./i, 'Invalid Thread.')
    .replace(/Not Found/i, 'The thread is invalid, deleted, or private.');
}

async function resolvePost(postUrl: string, postId: string) {
  let embedUrl = buildEmbedUrlFromPostUrl(postUrl);
  let oembedUsed = false;
  let oembedPrivate = false;
  let oembedInvalid = false;

  try {
    const oembed = await fetchOEmbedServer(postUrl);
    const permalink = permalinkFromOEmbedHtml(oembed.html);
    if (permalink) {
      embedUrl = buildEmbedUrlFromPermalink(permalink);
      oembedUsed = true;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (/not authorized to see|private/i.test(msg) && !/does not exist|not found/i.test(msg)) {
      oembedPrivate = true;
    }
    if (/could not be embedded|does not exist|not found/i.test(msg)) {
      oembedInvalid = true;
    }
    console.log('oembed skip', postId, msg);
  }

  if (oembedPrivate) {
    throw Object.assign(new Error('The thread you entered is private.'), { status: 404 });
  }

  const parsed = await resolveMediaFromPages(postUrl, embedUrl, postId);
  return { parsed, oembedUsed, oembedPrivate, oembedInvalid };
}

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => {
  const cors = corsHeaders(request);
  return new Response(null, {
    status: 204,
    headers: {
      ...cors,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const crossOrigin = rejectIfCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const ip = clientIp(request);

  const allowed = await checkRateLimit(env.APP_KV, `resolve:${ip}`, 30);
  if (!allowed) {
    return errorResponse('Too many requests. Try again later.', 429, request);
  }

  let body: { url?: string; captchaToken?: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body.', 400, request);
  }

  const turnstileOk = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, body.captchaToken, ip);
  if (!turnstileOk) return errorResponse('Captcha verification failed.', 403, request);

  const rawUrl = (body.url || '').trim();
  if (!rawUrl) return errorResponse('Missing url.', 400, request);
  if (!isValidThreadsUrl(rawUrl)) {
    return errorResponse('Invalid URL. Use threads.com/@user/post/CODE or threads.com/t/CODE', 400, request);
  }

  const postUrl = normalizeThreadsUrl(rawUrl);
  const postId = extractPostId(postUrl);
  if (!postId) return errorResponse('Could not extract post id.', 400, request);

  try {
    const { parsed, oembedUsed, oembedPrivate, oembedInvalid } = await resolvePost(postUrl, postId);

    if (parsed.rawVariantCount === 0) {
      const msg = oembedPrivate
        ? 'The thread you entered is private.'
        : oembedInvalid
          ? 'The thread is invalid, deleted, or private.'
          : oembedUsed
            ? 'No video or image found in this post.'
            : 'The thread is invalid, deleted, or private.';
      return errorResponse(msg, 404, request);
    }

    const cdnUrls = collectAllCdnUrls(parsed.media);
    if (!env.PROXY_HMAC_SECRET) {
      console.error('media: PROXY_HMAC_SECRET not configured');
      return errorResponse('Server misconfigured.', 500, request);
    }

    const proxy_auth = await signProxyAuth(env.PROXY_HMAC_SECRET, postId, cdnUrls);

    const response: ResolveResponse = {
      meta: { thread_id: postId, post_url: postUrl },
      proxy_auth,
      media: parsed.media,
    };

    if (!env.TURNSTILE_SECRET_KEY) {
      response.parserDebug = {
        source: parsed.parserSource,
        rawVariantCount: parsed.rawVariantCount,
      };
    }

    console.log(
      'resolve ok',
      JSON.stringify({
        postId,
        variants: parsed.rawVariantCount,
        source: parsed.parserSource,
      })
    );

    return jsonResponse(response, 200, request);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Resolve failed';
    const status = (e as Error & { status?: number }).status || 500;
    console.log('resolve fail', postId, msg);
    return errorResponse(mapOembedError(msg), status >= 400 && status < 600 ? status : 500, request);
  }
};
