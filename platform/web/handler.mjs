import { readFile } from 'node:fs/promises';

const pages = new Set(['/', '/markets', '/vault', '/stake', '/earn', '/collect']);
const files = new Map([
  ['/assets/10x.css', ['10x.css', 'text/css']],
  ['/assets/client.mjs', ['client.mjs', 'text/javascript']],
  ['/assets/views.mjs', ['views.mjs', 'text/javascript']],
  ['/assets/activity.mjs', ['activity.mjs', 'text/javascript']],
  ['/assets/collection-studio.mjs', ['collection-studio.mjs', 'text/javascript']],
  ['/assets/wallet.mjs', ['wallet.mjs', 'text/javascript']],
  ['/favicon.svg', ['mark.svg', 'image/svg+xml']],
]);

/** Compose before the API dispatcher. Unknown resources fall through. */
export async function handleWeb(request) {
  const path = new URL(request.url).pathname;
  const asset = pages.has(path) ? ['index.html', 'text/html'] : files.get(path);
  if (!asset) return null;
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed',
    { status: 405, headers: { Allow: 'GET, HEAD' } });
  const [name, type] = asset;
  const headers = {
    'Content-Type': type + '; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; img-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'none'",
  };
  return new Response(request.method === 'HEAD' ? null : await readFile(new URL(name, import.meta.url)), { headers });
}
