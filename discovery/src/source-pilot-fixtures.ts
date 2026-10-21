import { toBase58 } from "./solana";
import { WSOL } from "./pump";
import type { SourcePilotInput } from "./source-pilot-model";

// Invented parser examples only. Never evidence about any actual token.
export function syntheticSourcePilotInputs(): SourcePilotInput[] {
  const address = toBase58(new Uint8Array(32).fill(2)), pool = toBase58(new Uint8Array(32).fill(3));
  const received_at = "2026-10-21T06:00:00.000Z";
  return [
    { version: "source-pilot-input-v1", provenance: "synthetic", received_at,
      request: { kind: "jupiter_tokens_v2", addresses: [address] },
      response: [{ id: address, updatedAt: received_at, organicScore: 23, holderCount: 100,
        audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: false, topHoldersPercentage: 41.5 },
        fdv: 5_000_000, mcap: null, stats5m: { buyVolume: 10000, sellVolume: 5000, buyOrganicVolume: 25, sellOrganicVolume: 20, numTraders: 100, numOrganicBuyers: 3, numNetBuyers: 20 } }] },
    { version: "source-pilot-input-v1", provenance: "synthetic", received_at,
      request: { kind: "geckoterminal_token_info", address },
      response: { data: { id: `solana_${address}`, type: "token", attributes: { address, gt_score: 76,
        gt_score_details: { pool: 80, transaction: 60, creation: 90, info: 70, holders: 80 },
        holders: { count: 100, distribution_percentage: { top_10: "41.5" }, last_updated: received_at } } } } },
    { version: "source-pilot-input-v1", provenance: "synthetic", received_at,
      request: { kind: "geckoterminal_pool_candles", address, pool, start_at: "2026-10-21T05:57:00.000Z", end_at: received_at },
      response: { data: { type: "ohlcv_request_response", attributes: { ohlcv_list: [
        [Date.parse("2026-10-21T05:59:00Z") / 1000, 1.1, 1.3, 1, 1.2, 2],
        [Date.parse("2026-10-21T05:57:00Z") / 1000, 1, 1.1, 0.9, 1, 1],
      ] } }, meta: { base: { address }, quote: { address: WSOL } } } },
  ];
}
