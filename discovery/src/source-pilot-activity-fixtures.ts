import { syntheticSourcePilotInputs } from "./source-pilot-fixtures";
import { WSOL } from "./pump";
import { toBase58 } from "./solana";
import type { SourceActivityInput } from "./source-pilot-activity";

// Invented inputs, including an uncovered control. Never actual-token evidence.
export function syntheticSourceActivityInput(): SourceActivityInput {
  const sources = syntheticSourcePilotInputs();
  const request = sources[2]!.request;
  if (request.kind !== "geckoterminal_pool_candles") throw new Error("synthetic_fixture_kind");
  const { address, pool } = request, received_at = sources[2]!.received_at;
  (sources[2]!.response as { data: { attributes: { ohlcv_list: number[][] } } }).data.attributes.ohlcv_list.splice(1, 0,
    [Date.parse("2026-10-21T05:58:00Z") / 1000, 1, 1.1, 1, 1.1, 0]);
  return { version: "source-activity-input-v1", provenance: "synthetic", selected_at: "2026-10-21T05:59:00.000Z", cutoff_at: received_at,
    cohort: [{ address, pool, pool_metadata: { received_at, response: {
      data: { id: `solana_${pool}`, type: "pool", attributes: { address: pool }, relationships: {
        base_token: { data: { id: `solana_${address}`, type: "token" } },
        quote_token: { data: { id: `solana_${WSOL}`, type: "token" } },
      } },
    } } }, { address: toBase58(new Uint8Array(32).fill(4)), pool: toBase58(new Uint8Array(32).fill(5)), pool_metadata: null }], sources };
}
