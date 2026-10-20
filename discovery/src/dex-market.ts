import { z } from "zod";
import { Address, MarketSchema, type Market } from "./model";
import { boundedJson, SourceError, type Reserve } from "./rpc";
import { safeTokenImage } from "./images";
import { WSOL } from "./pump";

const Pair = z.object({ chainId: z.string(), pairAddress: Address, baseToken: z.object({ address: Address }), quoteToken: z.object({ address: Address }), priceUsd: z.unknown().optional(), marketCap: z.unknown().optional(), fdv: z.unknown().optional(), liquidity: z.object({ usd: z.unknown().optional() }).nullish(), volume: z.object({ h24: z.unknown().optional() }).optional(), info: z.object({ imageUrl: z.unknown().optional() }).optional() });
const number = (v: unknown) => (typeof v === "number" || typeof v === "string" && v.trim() !== "") && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null;
export async function dexMarkets(rows: { address: string; pool: string }[], reserve: Reserve, at: string, transport: typeof fetch = fetch): Promise<Map<string, Market>> {
  if (!rows.length || rows.length > 30 || new Set(rows.map(r => r.address)).size !== rows.length) throw new SourceError("invalid_market_batch");
  rows.forEach(r => { Address.parse(r.address); Address.parse(r.pool); });
  await reserve("market");
  let response: Response;
  try { response = await transport(`https://api.dexscreener.com/tokens/v1/solana/${rows.map(r => r.address).join(",")}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10000), redirect: "manual" }); }
  catch { throw new SourceError("market_unavailable", 120); }
  if (!response.ok) { await response.body?.cancel(); throw new SourceError(response.status === 429 ? "market_rate_limited" : "market_http_error", 300); }
  const pairs = z.array(Pair).max(900).parse(await boundedJson(response, 1_000_000)), result = new Map<string, Market>();
  for (const row of rows) {
    const matches = pairs.filter(p => p.chainId === "solana" && p.pairAddress === row.pool);
    if (matches.length > 1) throw new SourceError("market_duplicate_pool");
    const p = matches[0]; if (!p) continue;
    if (p.baseToken.address !== row.address || p.quoteToken.address !== WSOL) throw new SourceError("market_identity_mismatch");
    result.set(row.address, MarketSchema.parse({ source: "dexscreener", fetched_at: at, observed_at: null, price_usd: number(p.priceUsd), market_cap_usd: number(p.marketCap), fdv_usd: number(p.fdv), liquidity_usd: number(p.liquidity?.usd), volume_24h_usd: number(p.volume?.h24), image_url: safeTokenImage(p.info?.imageUrl) }));
  }
  return result;
}
