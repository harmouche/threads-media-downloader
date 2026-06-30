const RESOLVE_LIMIT = 30;
const DOWNLOAD_LIMIT = 60;
const WINDOW_SEC = 3600;

export async function checkRateLimit(
  kv: KVNamespace | undefined,
  key: string,
  limit: number
): Promise<boolean> {
  if (!kv) return true;

  const now = Math.floor(Date.now() / 1000);
  const raw = await kv.get(key);
  let count = 0;
  let windowStart = now;

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { count: number; windowStart: number };
      if (now - parsed.windowStart < WINDOW_SEC) {
        count = parsed.count;
        windowStart = parsed.windowStart;
      }
    } catch {
      /* reset */
    }
  }

  if (count >= limit) return false;

  await kv.put(key, JSON.stringify({ count: count + 1, windowStart }), {
    expirationTtl: WINDOW_SEC + 60,
  });
  return true;
}

export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

export async function verifyTurnstile(
  secret: string | undefined,
  token: string | undefined,
  ip: string
): Promise<boolean> {
  if (!secret) return true;
  if (!token) return false;

  const body = new URLSearchParams({
    secret,
    response: token,
    remoteip: ip,
  });

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
  });
  const data = (await res.json()) as { success?: boolean };
  return !!data.success;
}

export function jsonResponse(data: unknown, status = 200, request?: Request): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...(request ? corsHeaders(request) : {}),
    },
  });
}

export function errorResponse(message: string, status: number, request?: Request): Response {
  return jsonResponse({ error: message }, status, request);
}

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  const host = request.headers.get('Host');
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function rejectIfCrossOrigin(request: Request): Response | null {
  if (isSameOriginRequest(request)) return null;
  return errorResponse('Cross-origin requests are not allowed.', 403, request);
}

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin');
  const host = request.headers.get('Host');
  if (origin && host && new URL(origin).host === host) {
    return { 'Access-Control-Allow-Origin': origin };
  }
  return {};
}
