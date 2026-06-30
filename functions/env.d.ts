interface Env {
  PROXY_HMAC_SECRET: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
  APP_KV?: KVNamespace;
}
