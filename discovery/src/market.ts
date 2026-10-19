import { z } from "zod";
import { Address, MarketSchema, type Market } from "./model";
import { boundedJson, SourceError, type Reserve } from "./rpc";
import { safeTokenImage } from "./images";

const PoolData = z.object({ attributes: z.object({
  address: Address, base_token_price_usd: z.unknown(), market_cap_usd: z.unknown(), fdv_usd: z.unknown(),
  reserve_in_usd: z.unknown(), volume_usd: z.object({ h24: z.unknown() }),
}), relationships: z.object({ base_token: z.object({ data: z.object({ id: z.string().max(100) }) }) }) });
const Included = z.array(z.object({ id: z.string(), type: z.string(), attributes: z.object({ address: z.string().optional(), image_url: z.unknown().optional() }) })).max(60).optional();
const PoolResponse = z.object({ data: PoolData, included: Included });
function numeric(value: unknown): number | null {
  if ((typeof value !== "string" && typeof value !== "number") || value === "") return null;
  const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : null;
}
export async function marketForPool(pool: string, mint: string, reserve: Reserve, now: string, transport: typeof fetch = fetch): Promise<Market> {
  Address.parse(pool); Address.parse(mint); await reserve("market");
  let response: Response;
  try { response = await transport(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}?include=base_token`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000), redirect: "manual" }); }
  catch { throw new SourceError("market_unavailable", 120); }
  if (!response.ok) { await response.body?.cancel(); throw new SourceError(response.status === 429 ? "market_rate_limited" : "market_http_error", 300); }
  const parsed = PoolResponse.parse(await boundedJson(response, 100_000));
  if (parsed.data.attributes.address !== pool || parsed.data.relationships.base_token.data.id !== `solana_${mint}`) throw new SourceError("market_identity_mismatch");
  return decodeMarket(parsed.data, parsed.included, mint, now);
}
function decodeMarket(data: z.infer<typeof PoolData>, included: z.infer<typeof Included>, mint: string, now: string): Market {
  const a = data.attributes;
  return MarketSchema.parse({
    source: "geckoterminal", fetched_at: now, observed_at: null,
    price_usd: numeric(a.base_token_price_usd), market_cap_usd: numeric(a.market_cap_usd),
    fdv_usd: numeric(a.fdv_usd), liquidity_usd: numeric(a.reserve_in_usd), volume_24h_usd: numeric(a.volume_usd.h24),
    image_url: safeTokenImage(included?.find(token => token.id === `solana_${mint}` && token.type === "token" && (!token.attributes.address || token.attributes.address === mint))?.attributes.image_url),
  });
}
export async function marketsForPools(rows: { pool: string; address: string }[], reserve: Reserve, now: string, transport: typeof fetch = fetch): Promise<Map<string, Market>> {
  if (!rows.length || rows.length > 30 || new Set(rows.map(r => r.pool)).size !== rows.length) throw new SourceError("invalid_market_batch");
  rows.forEach(r => { Address.parse(r.pool); Address.parse(r.address); }); await reserve("market");
  let response: Response;
  try { response = await transport(`https://api.geckoterminal.com/api/v2/networks/solana/pools/multi/${rows.map(r => r.pool).join(",")}?include=base_token`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10000), redirect: "manual" }); }
  catch { throw new SourceError("market_unavailable", 120); }
  if (!response.ok) { await response.body?.cancel(); throw new SourceError(response.status === 429 ? "market_rate_limited" : "market_http_error", 300); }
  const result = z.object({ data: z.array(PoolData).max(30), included: Included }).parse(await boundedJson(response, 500000));
  const markets = new Map<string, Market>();
  for (const pool of result.data) {
    const row = rows.find(r => r.pool === pool.attributes.address);
    if (!row || pool.relationships.base_token.data.id !== `solana_${row.address}` || markets.has(row.address)) throw new SourceError("market_identity_mismatch");
    markets.set(row.address, decodeMarket(pool, result.included, row.address, now));
  }
  return markets;
}
