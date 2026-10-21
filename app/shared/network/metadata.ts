export { isNetworkRoute } from './model';
export const NETWORK_CSP = [
  "default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https:", "connect-src 'self'", "font-src 'self'",
  "base-uri 'none'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'none'",
].join('; ');
export function networkHtml(html: string, origin: string, path = '/') {
  const title = 'Network State Protocol Map · 10X';
  const description = 'People, places, and progress on Farcaster. Explore currently opted-in Network State Protocol members.';
  return html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`)
    .replace(/<meta[^>]+(?:name|property)=["'](?:fc:miniapp|fc:frame|base:app_id|og:[^"']+|twitter:[^"']+|description|application-name|apple-mobile-web-app-title)["'][^>]*>/gi, '')
    .replace(/<link[^>]+rel=["'](?:canonical|manifest|icon|shortcut icon|apple-touch-icon)["'][^>]*>/gi, '')
    .replace('</head>', `<meta name="description" content="${description}"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:type" content="website"><meta property="og:url" content="${origin}${path === '/network' ? '/' : path}"><meta name="twitter:card" content="summary"><meta name="application-name" content="10X Network"><link rel="canonical" href="${origin}/"><link rel="icon" type="image/svg+xml" href="/network/icon.svg"></head>`);
}
