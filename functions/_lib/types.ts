export interface MediaVariant {
  url: string;
  proxy_path: string;
  content_type: string;
  width?: number;
  height?: number;
  resolution: string;
}

export interface MediaGroup {
  thumbnail?: string;
  variants: MediaVariant[];
}

export interface ProxyAuth {
  post_id: string;
  exp: number;
  url_hashes: string[];
  sig: string;
}

export interface ResolveMeta {
  thread_id: string;
  post_url: string;
}

export interface ResolveResponse {
  meta: ResolveMeta;
  proxy_auth: ProxyAuth;
  media: {
    videos: MediaGroup[];
    images: MediaGroup[];
  };
  parserDebug?: {
    source: string;
    rawVariantCount: number;
  };
}

export const PROXY_PATH = '/api/threads/cdn';
