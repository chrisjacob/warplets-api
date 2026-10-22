import { z } from "zod";
import { Address } from "./model";
import { safeTokenImage } from "./images";

export const AttentionChain = z.enum(["solana", "base", "bsc", "robinhood"]);
export type AttentionChainId = z.infer<typeof AttentionChain>;
export const gmgnChain = { solana: "sol", base: "base", bsc: "bsc", robinhood: "robinhood" } as const;
export function attentionAddress(chain: AttentionChainId, value: unknown): string | null {
  if (chain === "solana") { const parsed = Address.safeParse(value); return parsed.success ? parsed.data : null; }
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value) && !/^0x0{40}$/i.test(value) ? value.toLowerCase() : null;
}
const Chains = z.array(AttentionChain).min(1).max(4).refine(a => new Set(a).size === a.length, "duplicate_chains");
export const AttentionRequest = z.union([
  z.object({ kind: z.literal("gmgn_hot_searches"), chains: Chains.default(["solana", "base", "bsc", "robinhood"]),
    intervals: z.array(z.enum(["1h", "24h"])).min(1).max(2).refine(a => new Set(a).size === a.length).default(["24h", "1h"]),
    limit: z.number().int().min(1).max(30).default(20), min_liquidity: z.number().min(0).max(1_000_000).default(10000) }).strict(),
  z.object({ kind: z.literal("geckoterminal_global_trending"), duration: z.enum(["1h", "6h", "24h"]).default("24h"), page: z.number().int().min(1).max(2).default(1) }).strict(),
  z.object({ kind: z.literal("attention_dex_crosscheck"), chain: AttentionChain, addresses: z.array(z.string().max(44)).min(1).max(30) }).strict()
    .refine(r => r.addresses.every(a => attentionAddress(r.chain, a) !== null) && new Set(r.addresses.map(a => attentionAddress(r.chain, a))).size === r.addresses.length, "invalid_or_duplicate_identity"),
]);
export type AttentionRequestInput = z.infer<typeof AttentionRequest>;
export const isAttentionRequest = (request: { kind: string }) => ["gmgn_hot_searches", "geckoterminal_global_trending", "attention_dex_crosscheck"].includes(request.kind);
export function attentionDescriptor(raw: unknown) {
  const request = AttentionRequest.parse(raw);
  const headers: Record<string,string> = {Accept:"application/json"};
  if (request.kind === "gmgn_hot_searches") { headers["Content-Type"]="application/json"; return { request, provider: "gmgn" as const, url: "https://openapi.gmgn.ai/v1/market/hot_searches", method: "POST" as const,
    headers, weight: 3,
    body: JSON.stringify({ params: request.chains.flatMap(chain => request.intervals.map(interval => ({ label: "hot-search", chain: gmgnChain[chain], interval,
      limit: request.limit, min_liquidity: request.min_liquidity, filters: chain === "solana" ? ["renounced", "frozen"] : ["not_honeypot", "verified", "renounced"] }))) }) }; }
  const url = request.kind === "geckoterminal_global_trending"
    ? `https://api.geckoterminal.com/api/v2/networks/trending_pools?duration=${request.duration}&page=${request.page}&include=base_token,network`
    : `https://api.dexscreener.com/tokens/v1/${request.chain}/${request.addresses.map(a => attentionAddress(request.chain, a)).join(",")}`;
  return { request, provider: request.kind === "geckoterminal_global_trending" ? "geckoterminal_public" as const : "dexscreener" as const, url, method: "GET" as const, headers, weight: 1 };
}
export const AttentionToken = z.object({ chain: AttentionChain, address: z.string(), name: z.string().nullable(), symbol: z.string().nullable(), image_url: z.string().nullable(),
  window: z.enum(["1h", "6h", "24h"]), provider_rank: z.number().int().positive().nullable(), search_interest: z.number().nonnegative().nullable(),
  market_cap_usd: z.number().nonnegative().nullable(), fdv_usd: z.number().nonnegative().nullable(), liquidity_usd: z.number().nonnegative().nullable(),
  volume_24h_usd: z.number().nonnegative().nullable(), volume_1h_usd: z.number().nonnegative().nullable(), holders: z.number().nonnegative().nullable(),
  reported_open_seconds: z.number().nonnegative().nullable(), wash_flag: z.boolean().nullable(), mint_disabled: z.boolean().nullable(), freeze_disabled: z.boolean().nullable(),
  honeypot: z.boolean().nullable(), top10_ratio: z.number().min(0).max(1).nullable(), insider_ratio: z.number().min(0).max(1).nullable(), bundler_ratio: z.number().min(0).max(1).nullable(),
  buys: z.number().nonnegative().nullable(), sells: z.number().nonnegative().nullable(), pool: z.string().nullable(), boost_count: z.number().nonnegative().nullable() });
export type AttentionTokenRow = z.infer<typeof AttentionToken>;
export const AttentionObservation = z.object({ version: z.literal("provider-attention-observation-v1"), provider: z.enum(["gmgn", "geckoterminal", "dexscreener"]),
  received_at: z.iso.datetime(), rows: z.array(AttentionToken).max(300), rejected: z.array(z.object({ index: z.number(), reason: z.string() })).max(300), returned: z.number(),
  scoring_effect: z.literal("none"), evidence_gates_changed: z.literal(false) });
export type AttentionSnapshot = z.infer<typeof AttentionObservation>;
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const number = (v: unknown): number | null => { if (typeof v !== "number" && !(typeof v === "string" && /^\d+(?:\.\d+)?$/.test(v))) return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };
const ratio = (v: unknown) => { const n = number(v); return n !== null && n <= 1 ? n : null; };
const flag = (v: unknown) => v === true || v === 1 || v === "1" ? true : v === false || v === 0 || v === "0" ? false : null;
const label = (v: unknown) => typeof v === "string" ? v.slice(0, 100).replace(/[\u0000-\u001f\u007f]/g, "") : null;
export function normalizeAttention(rawRequest: unknown, raw: unknown, receivedAt: string): AttentionSnapshot {
  const request = AttentionRequest.parse(rawRequest), at = Date.parse(z.iso.datetime().parse(receivedAt));
  const rows: AttentionTokenRow[] = [], rejected: { index: number; reason: string }[] = [];
  const provider = request.kind === "gmgn_hot_searches" ? "gmgn" : request.kind === "geckoterminal_global_trending" ? "geckoterminal" : "dexscreener";
  const inputs: { input: unknown; chain: unknown; window: "1h" | "6h" | "24h"; rank: number }[] = [], tokens = new Map<string, Record<string, unknown>>();
  if (request.kind === "gmgn_hot_searches") {
    let data: unknown = raw;
    for (let depth = 0; depth < 2 && !Array.isArray(data); depth++) { const envelope = obj(data); if (envelope.code !== 0 && envelope.code !== "0") throw Error("gmgn_application_error"); data = envelope.data; }
    const blocks = z.array(z.unknown()).max(request.chains.length * request.intervals.length).parse(data), seen = new Set<string>();
    for (const value of blocks) {
      const block = obj(value), chain = AttentionChain.options.find(c => gmgnChain[c] === block.chain), interval = z.enum(["1h", "24h"]).parse(block.interval);
      if (!chain || !request.chains.includes(chain) || !request.intervals.includes(interval) || seen.has(`${chain}:${interval}`)) throw Error("attention_response_scope_mismatch");
      seen.add(`${chain}:${interval}`);
      z.array(z.unknown()).max(request.limit).parse(block.tokens).forEach((input, i) => inputs.push({ input, chain, window: interval, rank: i + 1 }));
    }
  } else if (request.kind === "geckoterminal_global_trending") {
    const body = obj(raw);
    for (const value of z.array(z.unknown()).max(100).parse(body.included ?? [])) { const item = obj(value); if (typeof item.id === "string") tokens.set(item.id, obj(item.attributes)); }
    z.array(z.unknown()).max(20).parse(body.data).forEach((input, i) => { const r = obj(input), relationships = obj(r.relationships); const network = obj(obj(relationships.network).data).id;
      inputs.push({ input, chain: network, window: "24h", rank: i + 1 }); });
  } else z.array(z.unknown()).max(300).parse(raw).forEach((input, i) => inputs.push({ input, chain: obj(input).chainId, window: "24h", rank: i + 1 }));
  for (const [index, item] of inputs.entries()) {
    const chain = AttentionChain.safeParse(item.chain); if (!chain.success) { rejected.push({ index, reason: "unsupported_chain" }); continue; }
    const r = obj(item.input), a = obj(r.attributes), gmgn = provider === "gmgn", dex = provider === "dexscreener";
    const tokenId = obj(obj(obj(r.relationships).base_token).data).id;
    const token = typeof tokenId === "string" ? tokens.get(tokenId) ?? {} : {};
    const rawAddress = gmgn ? r.address : dex ? obj(r.baseToken).address : typeof tokenId === "string" && tokenId.startsWith(`${chain.data}_`) ? tokenId.slice(chain.data.length + 1) : null;
    const address = attentionAddress(chain.data, rawAddress);
    if (!address || gmgn && r.chain !== undefined && r.chain !== gmgnChain[chain.data] || request.kind === "attention_dex_crosscheck" && (chain.data !== request.chain || !request.addresses.some(a => attentionAddress(request.chain, a) === address))) { rejected.push({ index, reason: "identity_or_scope_mismatch" }); continue; }
    const open = gmgn ? number(r.open_timestamp) : dex ? number(r.pairCreatedAt) : typeof a.pool_created_at === "string" ? Date.parse(a.pool_created_at) : null;
    const seconds = open === null ? null : gmgn ? open : open / 1000;
    if (seconds !== null && (!Number.isFinite(seconds) || seconds < 0 || seconds * 1000 > at)) { rejected.push({ index, reason: "invalid_or_future_time" }); continue; }
    const volume = gmgn ? number(r.volume) : number(obj(dex ? r.volume : a.volume_usd).h24);
    rows.push({ chain: chain.data, address, name: label(gmgn ? r.name : dex ? obj(r.baseToken).name : token.name), symbol: label(gmgn ? r.symbol : dex ? obj(r.baseToken).symbol : token.symbol),
      image_url: safeTokenImage(gmgn ? r.logo : dex ? obj(r.info).imageUrl : token.image_url), window: gmgn ? item.window : request.kind === "geckoterminal_global_trending" ? request.duration : "24h",
      provider_rank: gmgn ? number(r.rank) !== null && Number.isInteger(number(r.rank)) && Number(r.rank) > 0 ? Number(r.rank) : item.rank : dex ? null : item.rank,
      search_interest: gmgn ? number(r.visiting_count) : null, market_cap_usd: number(gmgn ? r.market_cap : dex ? r.marketCap : a.market_cap_usd), fdv_usd: number(gmgn ? r.fdv : dex ? r.fdv : a.fdv_usd),
      liquidity_usd: number(gmgn ? r.liquidity : dex ? obj(r.liquidity).usd : a.reserve_in_usd), volume_24h_usd: gmgn && item.window !== "24h" ? null : volume,
      volume_1h_usd: gmgn ? item.window === "1h" ? volume : null : number(obj(dex ? r.volume : a.volume_usd).h1), holders: gmgn ? number(r.holder_count) : null,
      reported_open_seconds: seconds, wash_flag: gmgn ? flag(r.is_wash_trading) : null, mint_disabled: gmgn && chain.data === "solana" ? flag(r.renounced_mint) : null,
      freeze_disabled: gmgn && chain.data === "solana" ? flag(r.renounced_freeze_account) : null, honeypot: gmgn && chain.data !== "solana" ? flag(r.is_honeypot) : null,
      top10_ratio: gmgn ? ratio(r.top_10_holder_rate) : null, insider_ratio: gmgn ? ratio(r.rat_trader_amount_rate) : null, bundler_ratio: gmgn ? ratio(r.bundler_rate) : null,
      buys: number(gmgn ? r.buys : obj(obj(dex ? r.txns : a.transactions).h24).buys), sells: number(gmgn ? r.sells : obj(obj(dex ? r.txns : a.transactions).h24).sells),
      pool: attentionAddress(chain.data, gmgn ? null : dex ? r.pairAddress : a.address), boost_count: dex ? number(obj(r.boosts).active) : null });
  }
  return AttentionObservation.parse({ version: "provider-attention-observation-v1", provider, received_at: receivedAt, rows, rejected, returned: inputs.length, scoring_effect: "none", evidence_gates_changed: false });
}
