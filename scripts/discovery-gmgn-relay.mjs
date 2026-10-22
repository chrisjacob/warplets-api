import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";

const paths = new Set(["/v1/token/info", "/v1/token/security", "/v1/token/pool_info", "/v1/market/token_kline", "/v1/market/token_top_traders", "/v1/user/wallet_activity", "/v1/market/rank"]);
const hotPath = "/v1/market/hot_searches";
export function gmgnHotSearchTarget(input, body, now = Date.now()) {
  const url = new URL(input.slice("/gmgn".length), "https://openapi.gmgn.ai");
  if (!input.startsWith("/gmgn/v1/") || url.origin !== "https://openapi.gmgn.ai" || url.pathname !== hotPath ||
    [...url.searchParams.keys()].length !== 2 || ["timestamp", "client_id"].some(k => url.searchParams.getAll(k).length !== 1) ||
    !/^\d{10}$/.test(url.searchParams.get("timestamp") ?? "") || Math.abs(Number(url.searchParams.get("timestamp")) * 1000 - now) > 10000 ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(url.searchParams.get("client_id") ?? "") || typeof body !== "string" || Buffer.byteLength(body) > 16000) return null;
  let parsed; try { parsed = JSON.parse(body); } catch { return null; }
  if (!parsed || Object.keys(parsed).join() !== "params" || !Array.isArray(parsed.params) || parsed.params.length < 1 || parsed.params.length > 8) return null;
  const seen = new Set();
  for (const p of parsed.params) {
    if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).sort().join() !== "chain,filters,interval,label,limit,min_liquidity" ||
      p.label !== "hot-search" || !["sol", "base", "bsc", "robinhood"].includes(p.chain) || !["1h", "24h"].includes(p.interval) ||
      !Number.isInteger(p.limit) || p.limit < 1 || p.limit > 30 || typeof p.min_liquidity !== "number" || !Number.isFinite(p.min_liquidity) || p.min_liquidity < 0 || p.min_liquidity > 1000000 ||
      JSON.stringify(p.filters) !== JSON.stringify(p.chain === "sol" ? ["renounced", "frozen"] : ["not_honeypot", "verified", "renounced"]) || seen.has(`${p.chain}:${p.interval}`)) return null;
    seen.add(`${p.chain}:${p.interval}`);
  }
  return url.href;
}
export function gmgnRelayTarget(input, now = Date.now()) {
  if (!input.startsWith("/gmgn/v1/")) return null;
  const url = new URL(input.slice("/gmgn".length), "https://openapi.gmgn.ai");
  if (!paths.has(url.pathname) || url.origin !== "https://openapi.gmgn.ai") return null;
  if (url.pathname === "/v1/market/rank") {
    const required = ["chain", "interval", "limit", "order_by", "direction", "min_liquidity", "min_marketcap", "min_volume", "timestamp", "client_id", "platforms"];
    const allowed = new Set([...required, "filters", "min_created", "max_created"]);
    if ([...url.searchParams.keys()].some(k => !allowed.has(k)) || required.some(k => url.searchParams.getAll(k).length !== 1) ||
      ["min_created", "max_created"].some(k => url.searchParams.getAll(k).length > 1)) return null;
    if (url.searchParams.get("chain") !== "sol" || !["1h", "6h", "24h"].includes(url.searchParams.get("interval")) ||
      url.searchParams.get("limit") !== "100" || url.searchParams.get("direction") !== "desc" ||
      !["volume", "swaps", "holder_count"].includes(url.searchParams.get("order_by")) || url.searchParams.get("platforms") !== "Pump.fun") return null;
    const filters = url.searchParams.getAll("filters");
    if (JSON.stringify(filters) !== JSON.stringify(["renounced", "frozen", "is_out_market"]) && JSON.stringify(filters) !== JSON.stringify(["renounced", "frozen", "is_out_market", "not_wash_trading"])) return null;
    for (const [key, maximum] of [["min_liquidity", 1000000], ["min_marketcap", 10000000], ["min_volume", 10000000]]) if (!/^\d+(?:\.\d+)?$/.test(url.searchParams.get(key)) || Number(url.searchParams.get(key)) > maximum) return null;
    for (const key of ["min_created", "max_created"]) if (url.searchParams.has(key) && (!/^\d{1,3}h$/.test(url.searchParams.get(key)) || Number(url.searchParams.get(key).slice(0, -1)) > 168)) return null;
    if (url.searchParams.has("min_created") && url.searchParams.has("max_created") && Number(url.searchParams.get("min_created").slice(0,-1)) >= Number(url.searchParams.get("max_created").slice(0,-1))) return null;
    if (!/^\d{10}$/.test(url.searchParams.get("timestamp") ?? "") || Math.abs(Number(url.searchParams.get("timestamp")) * 1000 - now) > 10000 ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(url.searchParams.get("client_id") ?? "")) return null;
    return url.href;
  }
  const candles = url.pathname === "/v1/market/token_kline";
  const traders = url.pathname === "/v1/market/token_top_traders";
  const activity=url.pathname==="/v1/user/wallet_activity";
  const allowed = new Set(["chain", ...(activity?["wallet_address","token_address","limit"]:["address"]), "timestamp", "client_id", ...(candles ? ["resolution", "from", "to"] : []),...(traders?["limit","order_by","direction"]:[])]);
  if ([...url.searchParams.keys()].length !== allowed.size || [...allowed].some(key => url.searchParams.getAll(key).length !== 1)) return null;
  if (url.searchParams.get("chain") !== "sol" || !(activity?["wallet_address","token_address"]:["address"]).every(key=>/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(url.searchParams.get(key)??"")) ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(url.searchParams.get("client_id") ?? "")) return null;
  const stamp = url.searchParams.get("timestamp");
  if (!/^\d{10}$/.test(stamp ?? "") || Math.abs(Number(stamp) * 1000 - now) > 10_000) return null;
  if(traders&&(url.searchParams.get("limit")!=="100"||url.searchParams.get("order_by")!=="buy_volume_cur"||url.searchParams.get("direction")!=="desc"))return null;
  if(activity&&url.searchParams.get("limit")!=="20")return null;
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
  const hot = target.pathname === hotPath && init.method === "POST" && gmgnHotSearchTarget(`/gmgn${target.pathname}${target.search}`, init.body) === target.href;
  if (target.origin !== "https://openapi.gmgn.ai" || target.username || target.password || !hot && (!paths.has(target.pathname) || init.method && init.method !== "GET")) throw new Error("gmgn_relay_target_not_allowed");
  return new Promise((resolve, reject) => {
    const outgoing = request(target, { method: hot ? "POST" : "GET", family: 4, headers: init.headers, signal: init.signal }, incoming => {
      const headers = new Headers();
      for (const name of ["content-type", "content-length", "retry-after", "x-ratelimit-reset", "x-ratelimit-remaining", "x-ratelimit-limit"]) {
        const value = incoming.headers[name]; if (typeof value === "string") headers.set(name, value);
      }
      const status = incoming.statusCode ?? 502;
      if ([204, 205, 304].includes(status)) { incoming.resume(); resolve(new Response(null, { status, headers })); }
      else resolve(new Response(Readable.toWeb(incoming), { status, headers }));
    });
    outgoing.on("error", reject); outgoing.end(hot ? init.body : undefined);
  });
}
