#!/usr/bin/env node
/**
 * Phase 0 ship gate runner (CLI). Requires `npm run dev` on port 8788.
 * Usage: node scripts/spike-gate.mjs
 */

const BASE = process.env.SPIKE_BASE || 'http://localhost:8788';

const BASELINE_URLS = [
  'https://www.threads.com/@mosseri/post/DDupwppSjcp',
  'https://www.threads.com/@threads/post/DI33nzTAHgT',
  'https://www.threads.com/@mariners/post/DKTSy7DN1eN',
  'https://www.threads.com/@nba/post/DKTSy7DN1eN',
  'https://www.threads.com/@natgeo/post/DI33nzTAHgT',
  'https://www.threads.com/@nike/post/DI33nzTAHgT',
  'https://www.threads.com/@mosseri/post/DI1xuSxv93T',
];

const BAD_URLS = [
  'https://www.threads.com/@fake/not-a-post/INVALID',
  'https://www.threads.com/@threads/post/INVALIDCODE99',
];

function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function resolveUrl(url) {
  const res = await fetch(`${BASE}/api/threads/post/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function testDirect(url) {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    return res.ok;
  } catch {
    return false;
  }
}

async function testProxy(cdnUrl, proxy_auth) {
  const u = b64urlEncode(cdnUrl);
  const auth = b64urlEncode(JSON.stringify(proxy_auth));
  const res = await fetch(`${BASE}/api/threads/cdn?u=${encodeURIComponent(u)}&auth=${encodeURIComponent(auth)}`);
  return {
    ok: res.ok,
    cache: res.headers.get('x-cache-status') || res.headers.get('cf-cache-status') || '',
    size: Number(res.headers.get('content-length') || 0),
  };
}

async function main() {
  const results = [];
  let resolvePass = 0;
  let downloadPass = 0;
  let cacheHit = false;

  const contentSlots = BASELINE_URLS.slice(0, 6);
  const textOnlyUrl = BASELINE_URLS[6];

  for (const url of contentSlots) {
    const row = { url, slot: 'content' };
    try {
      const { status, data } = await resolveUrl(url);
      row.status = status;
      if (!data.proxy_auth) {
        row.resolveOk = false;
        row.error = data.error;
        results.push(row);
        console.log('FAIL', url, data.error || status);
        continue;
      }
      const variants = [...(data.media?.videos || []), ...(data.media?.images || [])].flatMap((g) => g.variants || []);
      row.variantCount = variants.length;
      row.parserDebug = data.parserDebug;
      const first = variants[0];
      let directCdnOk = false;
      let proxyCdnOk = false;
      if (first) {
        directCdnOk = await testDirect(first.url);
        const p1 = await testProxy(first.url, data.proxy_auth);
        proxyCdnOk = p1.ok;
        row.proxySize = p1.size;
        row.cacheStatus = p1.cache;
        if (proxyCdnOk) {
          const p2 = await testProxy(first.url, data.proxy_auth);
          if ((p2.cache || '').toUpperCase() === 'HIT') cacheHit = true;
        }
      }
      row.downloadOk = directCdnOk || proxyCdnOk;
      row.directCdnOk = directCdnOk;
      row.proxyCdnOk = proxyCdnOk;
      if (row.variantCount > 0) resolvePass++;
      if (row.downloadOk) downloadPass++;
      results.push(row);
      console.log('OK', url, JSON.stringify({ variantCount: row.variantCount, downloadOk: row.downloadOk, source: row.parserDebug?.source }));
    } catch (e) {
      row.error = e.message;
      results.push(row);
      console.log('ERR', url, e.message);
    }
  }

  try {
    const { status, data } = await resolveUrl(textOnlyUrl);
    const variants = [...(data.media?.videos || []), ...(data.media?.images || [])].flatMap((g) => g.variants || []);
    const textOnlyOk = variants.length === 0 && status >= 400;
    results.push({ url: textOnlyUrl, textOnly: true, status, variantCount: variants.length, textOnlyOk });
    console.log(textOnlyOk ? 'TEXT OK' : 'TEXT FAIL', textOnlyUrl, status, data.error || variants.length);
  } catch (e) {
    results.push({ url: textOnlyUrl, textOnly: true, error: e.message, textOnlyOk: false });
    console.log('TEXT ERR', textOnlyUrl, e.message);
  }

  let badPass = 0;
  for (const url of BAD_URLS) {
    const { status, data } = await resolveUrl(url);
    const ok = status >= 400 || !data.proxy_auth;
    if (ok) badPass++;
    results.push({ url, badUrl: true, status, failOk: ok, error: data.error });
    console.log(ok ? 'BAD OK' : 'BAD FAIL', url, status, data.error || '');
  }

  const textOnlyOk = results.find((r) => r.textOnly)?.textOnlyOk === true;
  const summary = {
    resolvePass,
    resolveTarget: contentSlots.length,
    resolveGate: resolvePass >= 6,
    downloadPass,
    downloadGate: downloadPass >= 4,
    badPass,
    badGate: badPass >= 2,
    textOnlyOk,
    cacheHit,
    results,
  };

  console.log('\n=== GATE SUMMARY ===');
  console.log(`resolve with media: ${resolvePass}/${contentSlots.length} (need 6)`);
  console.log(`downloads ok: ${downloadPass}/${contentSlots.length} (need 4)`);
  console.log(`text-only slot rejects media: ${textOnlyOk}`);
  console.log(`bad url fail: ${badPass}/${BAD_URLS.length} (need 2)`);
  console.log(`cache HIT seen: ${cacheHit}`);
  const ship = summary.resolveGate && summary.downloadGate && summary.badGate && textOnlyOk;
  console.log(`SHIP: ${ship ? 'PASS' : 'FAIL'}`);

  const fs = await import('node:fs');
  fs.writeFileSync('spike-api-results.json', JSON.stringify({ ...summary, ship }, null, 2));
  console.log('Wrote spike-api-results.json');
  process.exit(ship ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
