import { corsHeaders, jsonResponse } from '../_lib/rate-limit';

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => {
  const cors = corsHeaders(request);
  return new Response(null, {
    status: 204,
    headers: {
      ...cors,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    },
  });
};

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  return jsonResponse(
    {
      turnstileSiteKey: env.TURNSTILE_SITE_KEY || '',
    },
    200,
    request
  );
};
