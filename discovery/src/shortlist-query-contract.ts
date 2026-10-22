import { z } from "zod";
import { Address } from "./model";

export const ShortlistQueryRequest = z.union([
  z.object({ kind: z.literal("gmgn_market_rank"), interval: z.enum(["1h", "6h", "24h"]),
    min_age_hours: z.number().int().min(0).max(168).optional(), max_age_hours: z.number().int().min(1).max(168).optional(),
    min_liquidity: z.number().min(0).max(1_000_000).default(10000), min_marketcap: z.number().min(0).max(10_000_000).default(0),
    min_volume: z.number().min(0).max(10_000_000).default(0), strict_wash_filter: z.boolean().default(false),
    order_by: z.enum(["volume", "swaps", "holder_count"]).default("volume") }).strict()
    .refine(r => r.min_age_hours === undefined || r.max_age_hours === undefined || r.min_age_hours < r.max_age_hours, "invalid_age_window"),
  z.object({ kind: z.literal("geckoterminal_trending_list"), duration: z.enum(["1h", "6h", "24h"]), page: z.number().int().min(1).max(2).default(1) }).strict(),
  z.object({ kind: z.literal("dexscreener_token_crosscheck"), addresses: z.array(Address).min(1).max(30)
    .refine(a => new Set(a).size === a.length, "duplicate_mints") }).strict(),
]);
export type ShortlistRequest = z.infer<typeof ShortlistQueryRequest>;
export function shortlistDescriptor(raw: unknown) {
  const request = ShortlistQueryRequest.parse(raw);
  let provider: "gmgn" | "geckoterminal_public" | "dexscreener", url: URL;
  if (request.kind === "gmgn_market_rank") {
    provider = "gmgn"; url = new URL("https://openapi.gmgn.ai/v1/market/rank");
    const filters = ["renounced", "frozen", "is_out_market", ...(request.strict_wash_filter ? ["not_wash_trading"] : [])];
    for (const [key, value] of Object.entries({ chain: "sol", interval: request.interval, limit: 100, order_by: request.order_by, direction: "desc",
      min_liquidity: request.min_liquidity,
      min_marketcap: request.min_marketcap, min_volume: request.min_volume,
      ...(request.min_age_hours !== undefined ? { min_created: `${request.min_age_hours}h` } : {}),
      ...(request.max_age_hours !== undefined ? { max_created: `${request.max_age_hours}h` } : {}) })) url.searchParams.set(key, String(value));
    for (const value of filters) url.searchParams.append("filters", value);
    url.searchParams.append("platforms", "Pump.fun");
  } else if (request.kind === "geckoterminal_trending_list") {
    provider = "geckoterminal_public"; url = new URL("https://api.geckoterminal.com/api/v2/networks/solana/trending_pools");
    url.searchParams.set("duration", request.duration); url.searchParams.set("page", String(request.page)); url.searchParams.set("include", "base_token");
  } else {
    provider = "dexscreener"; url = new URL(`https://api.dexscreener.com/tokens/v1/solana/${request.addresses.join(",")}`);
  }
  return { request, provider, url: url.href, method: "GET" as const, headers: { Accept: "application/json" }, weight: provider === "gmgn" ? 3 : 1 };
}

const NumberField = z.union([z.number(), z.string().regex(/^-?\d+(?:\.\d+)?$/).max(100).transform(Number)])
  .pipe(z.number().finite());
const n = (value: unknown, signed = false): number | null => { const parsed = NumberField.safeParse(value); return parsed.success && (signed || parsed.data >= 0) ? parsed.data : null; };
const flag = (value: unknown): boolean | null => value === true || value === 1 || value === "1" || value === "true" ? true : value === false || value === 0 || value === "0" || value === "false" ? false : null;
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const ratio = (v: unknown) => { const value = n(v); return value !== null && value <= 1 ? value : null; };
const optionalAddress = (v: unknown) => { const parsed = Address.safeParse(v); return parsed.success ? parsed.data : null; };
const label = (v: unknown) => typeof v === "string" ? v.slice(0, 100).replace(/[\u0000-\u001f\u007f]/g, "") : null;
export function normalizeShortlist(rawRequest: unknown, raw: unknown, receivedAt: string) {
  const request = ShortlistQueryRequest.parse(rawRequest), received = Date.parse(z.string().datetime().parse(receivedAt)), body = object(raw);
  let rows: unknown[]; const tokens = new Map<string, Record<string, unknown>>();
  if (request.kind === "gmgn_market_rank") {
    if (body.code !== 0 && body.code !== "0") throw Error("gmgn_application_error");
    let data = object(body.data);
    // The live market route wraps its business response in a second envelope.
    // Validate both codes; never recursively search arbitrary provider objects.
    if ("code" in data) {
      if (data.code !== 0 && data.code !== "0") throw Error("gmgn_application_error");
      data = object(data.data);
    }
    rows = z.array(z.unknown()).max(100).parse(data.rank);
  } else if (request.kind === "geckoterminal_trending_list") {
    rows = z.array(z.unknown()).max(20).parse(body.data);
    for (const item of z.array(z.unknown()).max(100).parse(body.included ?? [])) { const t = object(item); if (typeof t.id === "string") tokens.set(t.id, object(t.attributes)); }
  } else rows = z.array(z.unknown()).max(300).parse(raw);
  const accepted = [], rejected: { index: number; reason: string }[] = [];
  for (const [index, input] of rows.entries()) {
    const r = object(input), a = object(r.attributes), relationships = object(r.relationships), gmgn = request.kind === "gmgn_market_rank", dex = request.kind === "dexscreener_token_crosscheck";
    const tokenId = object(object(relationships.base_token).data).id;
    const token = typeof tokenId === "string" ? object(tokens.get(tokenId)) : {}, address = gmgn ? r.address : dex ? object(r.baseToken).address : typeof tokenId === "string" && tokenId.startsWith("solana_") ? tokenId.slice(7) : null;
    const mint = Address.safeParse(address);
    if (!mint.success || dex && (r.chainId !== "solana" || !request.addresses.includes(mint.data))) { rejected.push({ index, reason: "mint_or_chain_mismatch" }); continue; }
    const opened = gmgn ? n(r.open_timestamp) : dex ? n(r.pairCreatedAt) : typeof a.pool_created_at === "string" ? Date.parse(a.pool_created_at) : null;
    const openSeconds = opened === null ? null : gmgn ? opened : opened / 1000;
    const created = gmgn ? n(r.creation_timestamp) : null;
    if (created !== null && created * 1000 > received || openSeconds !== null && (!Number.isFinite(openSeconds) || openSeconds * 1000 > received)) { rejected.push({ index, reason: "future_or_invalid_time" }); continue; }
    accepted.push({ address: mint.data, symbol: label(gmgn ? r.symbol : dex ? object(r.baseToken).symbol : token.symbol),
      name: label(gmgn ? r.name : dex ? object(r.baseToken).name : token.name), pool: optionalAddress(gmgn ? null : dex ? r.pairAddress : a.address),
      reported_creation_seconds: created, reported_open_seconds: openSeconds,
      market_cap_usd: n(gmgn ? r.market_cap : dex ? r.marketCap : a.market_cap_usd),
      fdv_usd: n(gmgn ? r.fdv : dex ? r.fdv : a.fdv_usd), liquidity_usd: n(gmgn ? r.liquidity : dex ? object(r.liquidity).usd : a.reserve_in_usd),
      volume_usd: n(gmgn ? r.volume : dex ? object(r.volume).h24 : object(a.volume_usd).h24),
      volume_1h_usd: gmgn ? request.interval === "1h" ? n(r.volume) : null : n(object(dex ? r.volume : a.volume_usd).h1),
      volume_6h_usd: gmgn ? request.interval === "6h" ? n(r.volume) : null : n(object(dex ? r.volume : a.volume_usd).h6),
      volume_interval: gmgn ? request.interval : "24h", holder_count: gmgn ? n(r.holder_count) : null,
      buys: n(gmgn ? r.buys : object(object(dex ? r.txns : a.transactions).h24).buys),
      sells: n(gmgn ? r.sells : object(object(dex ? r.txns : a.transactions).h24).sells),
      change_1h_pct: n(gmgn ? r.price_change_percent1h : object(dex ? r.priceChange : a.price_change_percentage).h1, true),
      change_24h_pct: n(gmgn ? request.interval === "24h" ? r.price_change_percent : null : object(dex ? r.priceChange : a.price_change_percentage).h24, true),
      top10_ratio: gmgn ? ratio(r.top_10_holder_rate) : null, insider_ratio: gmgn ? ratio(r.rat_trader_amount_rate) : null,
      bundler_ratio: gmgn ? ratio(r.bundler_rate) : null, rug_ratio: gmgn ? ratio(r.rug_ratio) : null,
      wash_flag: gmgn ? flag(r.is_wash_trading) : null, mint_disabled: gmgn ? flag(r.renounced_mint) : null,
      freeze_disabled: gmgn ? flag(r.renounced_freeze_account) : null, platform: gmgn ? label(r.launchpad_platform) : dex ? label(r.dexId) : null });
  }
  return { version: "shortlist-query-observation-v1", request, received_at: receivedAt, rows: accepted, rejected,
    returned: rows.length, exhaustive: false, graduation_verified: false, organic_volume_certified: false,
    meaningful_holder_growth_certified: false, scoring_effect: "none", evidence_gates_changed: false };
}
