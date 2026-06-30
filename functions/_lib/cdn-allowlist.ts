export function isAllowedCdnUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host.endsWith('.fbcdn.net') || host === 'fbcdn.net') return true;
    if (host.endsWith('.cdninstagram.com') || host === 'cdninstagram.com') return true;
    if (host.endsWith('.instagram.com') && /\/(v|o1|t51)/.test(u.pathname)) return true;
    return false;
  } catch {
    return false;
  }
}
