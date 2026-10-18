import { jsonSecure, sha256Hex } from '../security';

interface CacheContext { request: Request; waitUntil(promise: Promise<unknown>): void }
// Short-lived, data-center-local caching. Cache hits bypass D1 and KV entirely.
// Callers must check the serving flag and validate inputs before entering here.
export async function cachedNetworkResponse(context: CacheContext, resource: string, selection: unknown, load: () => Promise<Response>, ttl = 60): Promise<Response> {
  const url = new URL(context.request.url);
  url.pathname = `/__network_cache/v1/${resource}/${await sha256Hex(JSON.stringify(selection))}`;
  url.search = '';
  const key = new Request(url, { method: 'GET' });
  let cache: Cache | null = null;
  try {
    cache = await caches.open('network-public-v1');
    const hit = await cache.match(key);
    if (hit) { const response = new Response(hit.body, hit); response.headers.set('x-network-cache', 'HIT'); return response; }
  } catch { console.warn('network_cache_read_failed'); }
  let response: Response;
  try { response = await load(); }
  catch { console.error('network_api_read_failed', resource); return jsonSecure({ error: 'Network data is temporarily unavailable' }, { status: 503 }); }
  if (response.status === 200) {
    response.headers.set('cache-control', `public, max-age=30, s-maxage=${ttl}`);
    if (cache) context.waitUntil(cache.put(key, response.clone()).catch(() => { console.warn('network_cache_write_failed'); }));
  }
  response.headers.set('x-network-cache', 'MISS');
  return response;
}
