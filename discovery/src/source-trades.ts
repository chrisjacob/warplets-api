import { z } from "zod";
import { Address, Signature } from "./model";
import { WSOL } from "./pump";
import { hashJson } from "./solana";
import { SourceError } from "./rpc";
import { boundedJsonValue } from "./source-pilot";
import { poolBinding } from "./source-pilot-activity";

const Time = z.string().datetime();
const Amount = z.string().max(100).regex(/^\d+(?:\.\d+)?$/).transform(Number).pipe(z.number().finite().nonnegative());
const Positive = Amount.refine(value => value > 0, "positive_amount_required");
const Trade = z.object({ id: z.string().min(1).max(256), type: z.literal("trade"), attributes: z.object({
  block_number: z.number().int().safe().nonnegative(), block_timestamp: Time, tx_hash: Signature,
  tx_from_address: Address, kind: z.enum(["buy", "sell"]), from_token_address: Address, to_token_address: Address,
  from_token_amount: Positive, to_token_amount: Positive, volume_in_usd: Amount,
  is_anomalous: z.boolean().nullable().optional().transform(value => value ?? null),
}) });
const Input = z.object({ version: z.literal("source-trades-input-v1"), provenance: z.enum(["synthetic", "unverified_file"]),
  address: Address, pool: Address, start_at: Time, cutoff_at: Time, received_at: Time,
  pool_metadata: z.object({ received_at: Time, response: z.unknown() }).strict().nullable(), response: z.unknown(),
}).strict().superRefine((input, context) => {
  const start = Date.parse(input.start_at), end = Date.parse(input.cutoff_at), received = Date.parse(input.received_at);
  if (start >= end || start > received || end - start > 21_600_000 || received > end || end - received > 300_000 ||
    input.pool_metadata && (Date.parse(input.pool_metadata.received_at) > end || end - Date.parse(input.pool_metadata.received_at) > 300_000))
    context.addIssue({ code: "custom", message: "source_trades_time_mismatch" });
});
export async function reviewSourceTrades(raw: unknown) {
  boundedJsonValue(raw, 1_000_000);
  const inputs = Input.parse(raw), envelope = z.object({ data: z.array(Trade).max(300) }).parse(inputs.response);
  const binding = poolBinding(inputs), ids = new Set<string>();
  let outside_window = 0;
  const trades = envelope.data.filter(row => {
    if (ids.has(row.id)) throw new SourceError("source_trades_duplicate_event");
    ids.add(row.id);
    const a = row.attributes, at = Date.parse(a.block_timestamp);
    if (at > Date.parse(inputs.received_at)) throw new SourceError("source_trades_future_event");
    const [from, to] = a.kind === "buy" ? [WSOL, inputs.address] : [inputs.address, WSOL];
    if (a.from_token_address !== from || a.to_token_address !== to) throw new SourceError("source_trades_orientation_mismatch");
    // Public endpoint does not offer a free historical cursor/window. Older
    // events are reported outside-window, not fabricated into this observation.
    if (at < Date.parse(inputs.start_at)) { outside_window++; return false; }
    return true;
  });
  const volume = trades.reduce((sum, row) => sum + row.attributes.volume_in_usd, 0);
  if (!Number.isFinite(volume)) throw new SourceError("source_trades_metric_overflow");
  const byWallet = new Map<string, number>();
  for (const row of trades) byWallet.set(row.attributes.tx_from_address, (byWallet.get(row.attributes.tx_from_address) ?? 0) + row.attributes.volume_in_usd);
  const buy = trades.filter(row => row.attributes.kind === "buy"), known = trades.filter(row => row.attributes.is_anomalous !== null);
  const measured = binding.state === "metadata_consistent" && trades.length > 0 ? {
    sampled_events: trades.length, sampled_transactions: new Set(trades.map(row => row.attributes.tx_hash)).size,
    source_reported_wallets: byWallet.size, buys: buy.length, sells: trades.length - buy.length, reported_volume_usd: volume,
    sub_dollar_events: trades.filter(row => row.attributes.volume_in_usd < 1).length,
    largest_reported_wallet_volume_pct: volume === 0 ? null : Math.max(...byWallet.values()) / volume * 100,
    vendor_anomalous_events: known.filter(row => row.attributes.is_anomalous === true).length,
    vendor_flag_known_events: known.length, vendor_flag_unknown_events: trades.length - known.length,
  } : null;
  const report = { version: "source-trades-report-v1", address: inputs.address, pool: inputs.pool,
    start_at: inputs.start_at, cutoff_at: inputs.cutoff_at, received_at: inputs.received_at,
    provenance: inputs.provenance, source_authenticity: "unverified", pool_binding: binding,
    response_events: envelope.data.length, outside_window_events: outside_window,
    response_at_public_row_cap: envelope.data.length === 300, complete_history: false,
    metrics: measured, scoring_effect: "none", evidence_gates_changed: false,
    limitations: ["sample_not_population", "provider_wallet_not_verified_signer_or_beneficial_owner", "pool_not_echoed_in_trade_body", "vendor_anomaly_flag_not_wash_verdict", "opening_cap_unknown"],
  };
  const input_hash = await hashJson(inputs), report_hash = await hashJson(report);
  const record = { version: "source-trades-record-v1", inputs, report, input_hash, report_hash,
    record_hash: await hashJson({ version: "source-trades-record-v1", input_hash, report_hash }) };
  boundedJsonValue(record, 1_900_000);
  return record;
}
export async function replaySourceTrades(raw: unknown) {
  boundedJsonValue(raw, 1_900_000);
  const record = z.object({ version: z.literal("source-trades-record-v1"), inputs: z.unknown(), report: z.unknown(),
    input_hash: z.string(), report_hash: z.string(), record_hash: z.string() }).strict().parse(raw);
  const regenerated = await reviewSourceTrades(record.inputs);
  if (await hashJson(record) !== await hashJson(regenerated)) throw new SourceError("source_trades_replay_mismatch");
  return { replay: "verified", provider_requests: 0, database_writes: 0, record_hash: regenerated.record_hash, report: regenerated.report };
}
