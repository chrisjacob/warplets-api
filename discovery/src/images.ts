// A token metadata URL is not a fetch instruction. Only these public image
// gateways are permitted; localhost, credentials, custom ports and data URLs fail.
const hosts = new Set(["coin-images.coingecko.com", "assets.coingecko.com", "coin-images.geckoterminal.com", "assets.geckoterminal.com", "cdn.dexscreener.com", "dd.dexscreener.com", "ipfs.io", "gateway.pinata.cloud", "pump.mypinata.cloud", "cdn.pump.fun", "pbs.twimg.com"]);
const gateways = new Set(["ipfs.io", "gateway.pinata.cloud", "pump.mypinata.cloud"]);
export function safeTokenImage(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value.startsWith("ipfs://") ? `https://gateway.pinata.cloud/ipfs/${value.slice(7).replace(/^ipfs\//, "")}` : value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !hosts.has(url.hostname)) return null;
    if (gateways.has(url.hostname) && !/^\/ipfs\/[a-zA-Z0-9]{32,128}(?:\/[a-zA-Z0-9._~/-]*)?$/.test(url.pathname)) return null;
    if (url.hostname === "pbs.twimg.com" && !/^\/media\/[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9]+)?$/.test(url.pathname)) return null;
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
  const result: string[] = [];
  for (const value of values) {
    const safe = safeTokenImage(value); if (!safe) continue;
    const url = new URL(safe);
    // Prefer Pinata because ipfs.io may challenge image requests on this workstation.
    const normalized = gateways.has(url.hostname) ? safeMetadataUrl(safe)! : safe;
    if (!result.includes(normalized)) result.push(normalized);
  }
  return result;
}
