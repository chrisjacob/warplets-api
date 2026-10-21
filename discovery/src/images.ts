// A token metadata URL is not a fetch instruction. Only these public image
// gateways are permitted; localhost, credentials, custom ports and data URLs fail.
const hosts = new Set(["coin-images.coingecko.com", "assets.coingecko.com", "coin-images.geckoterminal.com", "assets.geckoterminal.com", "cdn.dexscreener.com", "dd.dexscreener.com", "ipfs.io", "gateway.pinata.cloud", "pump.mypinata.cloud", "cdn.pump.fun", "images.pump.fun", "gateway.irys.xyz", "pbs.twimg.com"]);
const gateways = new Set(["ipfs.io", "gateway.pinata.cloud", "pump.mypinata.cloud"]);
export function safeTokenImage(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value.startsWith("ipfs://") ? `https://gateway.pinata.cloud/ipfs/${value.slice(7).replace(/^ipfs\//, "")}` : value);
    // Custom Pinata gateways carry the same immutable /ipfs/ pointer. Rewrite
    // to our fixed gateway; never fetch the supplied custom origin.
    if (/^[a-z0-9-]+\.mypinata\.cloud$/.test(url.hostname) && /^\/ipfs\/[a-zA-Z0-9]{32,128}(?:\/[a-zA-Z0-9._~/-]*)?$/.test(url.pathname)) url.hostname = "gateway.pinata.cloud";
    const publicTokenAsset = /^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname) && /^\/storage\/v1\/object\/public\/token-assets\/[a-f0-9]{64}\.(?:png|jpg|jpeg|webp|gif)$/.test(url.pathname);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !hosts.has(url.hostname) && !publicTokenAsset) return null;
    if (gateways.has(url.hostname) && !/^\/ipfs\/[a-zA-Z0-9]{32,128}(?:\/[a-zA-Z0-9._~/-]*)?$/.test(url.pathname)) return null;
    if (url.hostname === "images.pump.fun" && !/^\/coin-image\/[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(url.pathname)) return null;
    if (url.hostname === "gateway.irys.xyz" && !/^\/[a-zA-Z0-9_-]{43}$/.test(url.pathname)) return null;
    if (url.hostname === "pbs.twimg.com" && !/^\/(?:media\/[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9]+)?|profile_images\/[0-9]+\/[a-zA-Z0-9_.-]+)$/.test(url.pathname)) return null;
    if (url.pathname.split("/").some(part => part === "." || part === "..") || /%2e|%2f|%5c/i.test(url.pathname)) return null;
    url.hash = ""; return url.href;
  } catch { return null; }
}
// Fetch JSON only from content-addressed IPFS paths, never arbitrary metadata hosts.
export function safeMetadataUrl(value: unknown): string | null {
  const safe = safeTokenImage(value); if (!safe) return null;
  const url = new URL(safe); if (!gateways.has(url.hostname)) return null;
  url.hostname = "gateway.pinata.cloud"; url.search = ""; return url.href;
}
export function tokenImageSources(...values: unknown[]): string[] {
  const result: string[] = [], alternatives: string[] = [];
  function append(value: unknown, target: string[], unwrap = true) {
    const safe = safeTokenImage(value); if (!safe) return;
    const url = new URL(safe), normalized = gateways.has(url.hostname) ? safeMetadataUrl(safe)! : safe;
    if (!target.includes(normalized)) target.push(normalized);
    if (gateways.has(url.hostname)) {
      const fallback = new URL(normalized); fallback.hostname = "ipfs.io";
      if (!alternatives.includes(fallback.href)) alternatives.push(fallback.href);
    }
    // These are the source references returned in real Pump image metadata.
    // Never follow arbitrary nested origins or recurse through proxy chains.
    if (unwrap && url.hostname === "images.pump.fun") {
      const source = url.searchParams.get("src");
      if (source && safeTokenImage(source) && new URL(source).hostname !== "images.pump.fun") append(source, alternatives, false);
      const cid = url.searchParams.get("ipfs");
      if (cid && /^[a-zA-Z0-9]{32,128}$/.test(cid)) append(`ipfs://${cid}`, alternatives, false);
    }
  }
  for (const value of values) {
    try { append(value, result); } catch { /* Malformed nested pointers stay absent. */ }
  }
  return [...new Set([...result, ...alternatives])];
}
