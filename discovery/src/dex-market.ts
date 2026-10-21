import { z } from "zod";
import { type Market } from "./model";
import { boundedJson, SourceError, type Reserve } from "./rpc";
import { freezeMarketBatch,validateMarketRows } from "./market-batch";

export async function dexMarketBatch(rows: { address: string; pool: string }[], reserve: Reserve, at: string, transport: typeof fetch = fetch) {
  validateMarketRows(rows);
  await reserve("market");
  let response: Response;
  try { response = await transport(`https://api.dexscreener.com/tokens/v1/solana/${rows.map(r => r.address).join(",")}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10000), redirect: "manual" }); }
  catch { throw new SourceError("market_unavailable", 120); }
  if (!response.ok) { await response.body?.cancel(); throw new SourceError(response.status === 429 ? "market_rate_limited" : "market_http_error", 300); }
  const pairs = z.array(z.unknown()).max(900).parse(await boundedJson(response, 1_000_000));
  return freezeMarketBatch({version:"dex-market-input-v1",at,rows:rows.map(({address,pool})=>({address,pool})),pairs});
}
// Strict all-or-error adapter retained for callers that need that contract.
export async function dexMarkets(rows: { address: string; pool: string }[], reserve: Reserve, at: string, transport: typeof fetch = fetch): Promise<Map<string, Market>> {
  const batch=await dexMarketBatch(rows,reserve,at,transport),rejected=batch.record.report.rows.find(r=>r.state==="rejected");
  if(rejected)throw new SourceError(rejected.code!);
  return batch.markets;
}
