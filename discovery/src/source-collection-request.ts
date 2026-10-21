import { z } from "zod";
import { Address } from "./model";
import { SourcePilotRequestSchema } from "./source-pilot-model";
import { sourcePilotPlan } from "./source-pilot";
import { GmgnRequestSchema, gmgnDescriptor } from "./gmgn-request";

// One descriptor is exactly ONE HTTP request. Pool metadata is separately charged.
export const SourceFetchRequestSchema = z.union([
  GmgnRequestSchema,
  SourcePilotRequestSchema,
  z.object({ kind: z.literal("geckoterminal_pool_metadata"), address: Address, pool: Address }).strict(),
  z.object({ kind: z.literal("geckoterminal_pool_trades"), address: Address, pool: Address }).strict(),
]);
export type SourceFetchRequest = z.infer<typeof SourceFetchRequestSchema>;
export function sourceFetchDescriptor(raw: unknown, now: Date) {
  const request = SourceFetchRequestSchema.parse(raw);
  if (request.kind === "gmgn_token_info" || request.kind === "gmgn_token_security" || request.kind === "gmgn_token_pool" || request.kind === "gmgn_token_candles" || request.kind === "gmgn_token_traders") return gmgnDescriptor(request, now);
  if (request.kind === "geckoterminal_pool_candles" && Date.parse(request.end_at) > Math.floor(now.getTime() / 60_000) * 60_000)
    throw new Error("source_collection_open_candle_window");
  let url: string;
  if (request.kind === "geckoterminal_pool_metadata" || request.kind === "geckoterminal_pool_trades") {
    const base = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${request.pool}`;
    // Public endpoint: no Pro-only per_page/cursor/trading_period parameters.
    // Include anomalous trades explicitly; a missing flag remains unknown.
    url = request.kind === "geckoterminal_pool_metadata" ? base : `${base}/trades?include_anomalous=true&token=${request.address}`;
  } else url = sourcePilotPlan(SourcePilotRequestSchema.parse(request)).proposed_requests.at(-1)!.url;
  const provider = request.kind === "jupiter_tokens_v2" ? "jupiter" : "geckoterminal_public";
  return { request, provider, url, method: "GET" as const,
    headers: { Accept: provider === "jupiter" ? "application/json" : "application/json;version=20230203" } };
}
