import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";

const paths = new Set(["/v1/token/info", "/v1/token/security", "/v1/token/pool_info", "/v1/market/token_kline", "/v1/market/token_top_traders"]);
export function gmgnRelayTarget(input, now = Date.now()) {
  if (!input.startsWith("/gmgn/v1/")) return null;
  const url = new URL(input.slice("/gmgn".length), "https://openapi.gmgn.ai");
  if (!paths.has(url.pathname) || url.origin !== "https://openapi.gmgn.ai") return null;
  const candles = url.pathname === "/v1/market/token_kline";
  const traders = url.pathname === "/v1/market/token_top_traders";
  const allowed = new Set(["chain", "address", "timestamp", "client_id", ...(candles ? ["resolution", "from", "to"] : []),...(traders?["limit","order_by","direction"]:[])]);
  if ([...url.searchParams.keys()].length !== allowed.size || [...allowed].some(key => url.searchParams.getAll(key).length !== 1)) return null;
  if (url.searchParams.get("chain") !== "sol" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(url.searchParams.get("address") ?? "") ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(url.searchParams.get("client_id") ?? "")) return null;
  const stamp = url.searchParams.get("timestamp");
  if (!/^\d{10}$/.test(stamp ?? "") || Math.abs(Number(stamp) * 1000 - now) > 10_000) return null;
  if(traders&&(url.searchParams.get("limit")!=="100"||url.searchParams.get("order_by")!=="buy_volume_cur"||url.searchParams.get("direction")!=="desc"))return null;
  if (candles) {
    const from = url.searchParams.get("from"), to = url.searchParams.get("to");
    if (!/^\d{13}$/.test(from ?? "") || !/^\d{13}$/.test(to ?? "")) return null;
    const start = Number(from), end = Number(to) + 1;
    if (url.searchParams.get("resolution") !== "1m" || start % 60_000 || end % 60_000 || end <= start || end - start > 21_600_000 || end > Math.floor(now / 60_000) * 60_000) return null;
  }
  return url.href;
}
export function gmgnIpv4Fetch(url, init, request = httpsRequest) {
  const target = new URL(url);
  if (target.origin !== "https://openapi.gmgn.ai" || !paths.has(target.pathname) || target.username || target.password || init.method && init.method !== "GET") throw new Error("gmgn_relay_target_not_allowed");
  return new Promise((resolve, reject) => {
    const outgoing = request(target, { method: "GET", family: 4, headers: init.headers, signal: init.signal }, incoming => {
      const headers = new Headers();
      for (const name of ["content-type", "content-length", "retry-after", "x-ratelimit-reset", "x-ratelimit-remaining", "x-ratelimit-limit"]) {
        const value = incoming.headers[name]; if (typeof value === "string") headers.set(name, value);
      }
      const status = incoming.statusCode ?? 502;
      if ([204, 205, 304].includes(status)) { incoming.resume(); resolve(new Response(null, { status, headers })); }
      else resolve(new Response(Readable.toWeb(incoming), { status, headers }));
    });
    outgoing.on("error", reject); outgoing.end();
  });
}
