import type { ProxyAuth } from './types';

const AUTH_TTL_SEC = 900;

function canonicalPayload(postId: string, exp: number, urlHashes: string[]): string {
  const sorted = [...urlHashes].sort();
  return `${postId}|${exp}|${sorted.join(',')}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export async function signProxyAuth(
  secret: string,
  postId: string,
  cdnUrls: string[]
): Promise<ProxyAuth> {
  const url_hashes = await Promise.all(cdnUrls.map((u) => sha256Hex(u)));
  const exp = Math.floor(Date.now() / 1000) + AUTH_TTL_SEC;
  const payload = canonicalPayload(postId, exp, url_hashes);
  const sig = await hmacHex(secret, payload);
  return { post_id: postId, exp, url_hashes, sig };
}

export async function verifyProxyAuth(
  secret: string,
  auth: ProxyAuth,
  cdnUrl: string
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  if (!auth?.post_id || !auth.exp || !auth.sig || !Array.isArray(auth.url_hashes)) return false;
  if (auth.exp <= now) return false;

  const urlHash = await sha256Hex(cdnUrl);
  if (!auth.url_hashes.includes(urlHash)) return false;

  const expected = await hmacHex(secret, canonicalPayload(auth.post_id, auth.exp, auth.url_hashes));
  return timingSafeEqual(expected, auth.sig);
}

export function base64urlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64urlDecode(str: string): string {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
