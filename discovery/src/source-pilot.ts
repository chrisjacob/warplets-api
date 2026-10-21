import { z } from "zod";
import { sourcePilotReadiness } from "./source-pilot-readiness";
import { hashJson } from "./solana";
import { SourceError } from "./rpc";
import { normalizeSourcePilot } from "./source-pilot-normalize";
import { SOURCE_PILOT_LIMITS, SourcePilotInputSchema, SourcePilotRecordSchema, SourcePilotRequestSchema, type SourcePilotRequest } from "./source-pilot-model";

// No transport, D1 binding, scheduler or activation argument exists in this
// milestone. These are proposed GET descriptors, never executable requests.
export function sourcePilotPlan(raw?: SourcePilotRequest) {
  const request = raw === undefined ? null : SourcePilotRequestSchema.parse(raw);
  const descriptors: { provider: "jupiter" | "geckoterminal_public"; method: "GET"; url: string }[] = [];
  if (request?.kind === "jupiter_tokens_v2") {
    const url = new URL("https://api.jup.ag/tokens/v2/search");
    url.searchParams.set("query", request.addresses.join(","));
    descriptors.push({ provider: "jupiter", method: "GET", url: url.href });
  } else if (request?.kind === "geckoterminal_token_info") {
    descriptors.push({ provider: "geckoterminal_public", method: "GET", url: `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${request.address}/info` });
  } else if (request?.kind === "geckoterminal_pool_candles") {
    // A candle body does not echo its pool. A future collector must also bind
    // pool metadata and canonical chain proof to the same observation.
    descriptors.push({ provider: "geckoterminal_public", method: "GET", url: `https://api.geckoterminal.com/api/v2/networks/solana/pools/${request.pool}` });
    const url = new URL(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${request.pool}/ohlcv/minute`);
    url.search = new URLSearchParams({ aggregate: "1", before_timestamp: String(Date.parse(request.end_at) / 1000),
      limit: String((Date.parse(request.end_at) - Date.parse(request.start_at)) / 60_000), currency: "usd", token: request.address, include_empty_intervals: "false" }).toString();
    descriptors.push({ provider: "geckoterminal_public", method: "GET", url: url.href });
  }
  return {
    ...sourcePilotReadiness(), version: "source-pilot-plan-v1" as const,
    proposed_http_requests: descriptors.length, proposed_requests: descriptors,
  };
}

// JSON files are untrusted. Bound nesting/work as well as bytes, and reject JS
// values JSON.stringify would silently launder (NaN -> null, undefined -> absent).
function boundedJsonValue(raw: unknown, byteLimit: number) {
  let nodes = 0;
  const ancestors = new Set<object>();
  function check(value: unknown, depth: number) {
    if (++nodes > 30_000 || depth > 24) throw new SourceError("source_pilot_input_complexity_limit");
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (typeof value !== "object" || ancestors.has(value)) throw new SourceError("source_pilot_non_json_input");
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new SourceError("source_pilot_non_json_input");
    ancestors.add(value);
    if (Array.isArray(value)) for (let i = 0; i < value.length; i++) check(value[i], depth + 1);
    else for (const item of Object.values(value)) check(item, depth + 1);
    ancestors.delete(value);
  }
  check(raw, 0);
  const serialized = JSON.stringify(raw);
  if (new TextEncoder().encode(serialized).byteLength > byteLimit) throw new SourceError("source_pilot_size_limit");
}
const domain = (input_hash: string, report_hash: string) => ({ version: "source-pilot-record-v1", input_hash, report_hash });
export async function freezeSourcePilot(raw: unknown) {
  boundedJsonValue(raw, SOURCE_PILOT_LIMITS.input_bytes);
  const inputs = SourcePilotInputSchema.parse(raw), report = normalizeSourcePilot(inputs);
  const input_hash = await hashJson(inputs), report_hash = await hashJson(report);
  const record = SourcePilotRecordSchema.parse({ version: "source-pilot-record-v1", inputs, report, input_hash, report_hash, record_hash: await hashJson(domain(input_hash, report_hash)) });
  boundedJsonValue(record, SOURCE_PILOT_LIMITS.record_bytes);
  return record;
}
export async function replaySourcePilot(raw: unknown) {
  boundedJsonValue(raw, SOURCE_PILOT_LIMITS.record_bytes);
  const record = SourcePilotRecordSchema.parse(raw), regenerated = await freezeSourcePilot(record.inputs);
  if (await hashJson(record) !== await hashJson(regenerated)) throw new SourceError("source_pilot_replay_mismatch");
  return { replay: "verified" as const, provider_requests: 0 as const, database_writes: 0 as const,
    source_authenticity: "unverified" as const, record_hash: record.record_hash, report: regenerated.report };
}
export function sourcePilotError(error: unknown): string {
  return error instanceof SourceError ? error.code : error instanceof z.ZodError ? "source_pilot_schema_invalid" : "source_pilot_unavailable";
}
