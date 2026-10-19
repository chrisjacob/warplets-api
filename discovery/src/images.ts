// A token metadata URL is not a fetch instruction. Only these public image
// gateways are permitted; localhost, credentials, custom ports and data URLs fail.
const hosts = new Set(["coin-images.coingecko.com", "assets.coingecko.com", "coin-images.geckoterminal.com", "assets.geckoterminal.com", "ipfs.io", "gateway.pinata.cloud", "pump.mypinata.cloud", "cdn.pump.fun"]);
export function safeTokenImage(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !hosts.has(url.hostname)) return null;
    if (["ipfs.io", "gateway.pinata.cloud", "pump.mypinata.cloud"].includes(url.hostname) && !/^\/ipfs\/[a-zA-Z0-9]{32,128}(?:\/[^?#]*)?$/.test(url.pathname)) return null;
    url.hash = ""; return url.href;
  } catch { return null; }
}
