export interface OEmbedData {
  html: string;
  provider_name?: string;
  error?: { message?: string; error_user_msg?: string };
}

export async function fetchOEmbedServer(postUrl: string): Promise<OEmbedData> {
  const endpoints = [
    `https://graph.threads.net/v1.0/oembed?url=${encodeURIComponent(postUrl)}`,
    `https://graph.threads.com/oembed?url=${encodeURIComponent(postUrl)}`,
  ];

  let lastError = 'oEmbed request failed';

  for (const url of endpoints) {
    try {
      const res = await fetch(url);
      const data = (await res.json()) as OEmbedData;
      if (data.error) {
        lastError = data.error.error_user_msg || data.error.message || lastError;
        continue;
      }
      if (data.html) return data;
    } catch (e) {
      lastError = e instanceof Error ? e.message : lastError;
    }
  }

  const err = new Error(lastError);
  (err as Error & { status: number }).status = 404;
  throw err;
}

export function permalinkFromOEmbedHtml(html: string): string | null {
  const match = html.match(/data-text-post-permalink="([^"]+)"/);
  if (!match) return null;
  return match[1].replace(/&amp;/g, '&');
}

export function buildEmbedUrlFromPermalink(permalink: string): string {
  try {
    const u = new URL(permalink.replace(/&amp;/g, '&'));
    const path = u.pathname.replace(/\/$/, '');
    return `${u.origin}${path}/embed/`;
  } catch {
    const re = /^(.*?)\/?(\?.*|#|$)/;
    const match = re.exec(permalink);
    if (!match) return permalink;
    return `${match[1]}/embed/`;
  }
}
