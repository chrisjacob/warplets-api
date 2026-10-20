export class ContentError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
export function canonicalContentUrl(raw: string): { canonical_url: string; platform: "x" | "youtube" | "farcaster" | "web" } {
  let url: URL; try { url = new URL(raw); } catch { throw new ContentError("content_invalid_url"); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.port || !host.includes(".") || host.includes(":") || /^\d+(?:\.\d+){3}$/.test(host) || /(?:^|\.)(?:localhost|local|internal|home|test|invalid)$/.test(host) || host.endsWith(".")) throw new ContentError("content_public_https_url_required");
  for (const key of url.searchParams.keys()) if (/^(?:token|access_token|api_key|apikey|key|secret|password|auth|authorization|signature|sig)$/i.test(key)) throw new ContentError("content_url_contains_private_parameter");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (/^(?:utm_.+|fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  let platform: "x" | "youtube" | "farcaster" | "web" = "web";
  if (["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"].includes(host)) {
    const match = url.pathname.match(/^\/(?:[^/]+\/status|i\/status)\/(\d{1,24})(?:\/(?:photo|video)\/[1-9]\d*)?\/?$/);
    if (match) { url = new URL(`https://x.com/i/status/${match[1]}`); platform = "x"; }
  } else if (["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(host)) {
    const video = host === "youtu.be" ? url.pathname.slice(1).replace(/\/$/, "") : url.pathname === "/watch" ? url.searchParams.get("v") : url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/]+)\/?$/)?.[1];
    if (video && /^[a-zA-Z0-9_-]{11}$/.test(video)) { url = new URL(`https://www.youtube.com/watch?v=${video}`); platform = "youtube"; }
  } else if (["farcaster.xyz", "www.farcaster.xyz", "warpcast.com", "www.warpcast.com"].includes(host) && /^\/[^/]+\/0x[a-f0-9]{8,40}\/?$/i.test(url.pathname)) {
    url = new URL(`https://farcaster.xyz${url.pathname.replace(/\/$/, "").toLowerCase()}`); platform = "farcaster";
  }
  if (url.href.length > 2048 || /[\u0000-\u001f\u007f]/.test(raw)) throw new ContentError("content_invalid_url");
  // No DNS resolution, metadata requests, scraping, embeds or redirects here.
  return { canonical_url: url.href, platform };
}
