import { z } from "zod";
import { GmgnRequestSchema, GmgnCandleSeriesSchema } from "./gmgn-request";
import { normalizeGmgn } from "./gmgn-normalize";
import { normalizeGmgnCandles } from "./gmgn-candles";
import { corroborateGmgnUnits } from "./gmgn-candle-units";
import { hashJson } from "./solana";
import { boundedJsonValue } from "./source-pilot";

const Entry = z.object({ id: z.uuid(), request: GmgnRequestSchema, receipt_hash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  state: z.enum(["reserved", "fetching", "succeeded", "failed"]), received_at: z.string().datetime().nullable(), response: z.unknown() }).strict();
export async function assembleGmgnWindow(raw: unknown) {
  boundedJsonValue(raw, 7_600_000);
  const entries = z.array(Entry).min(1).max(4).parse(raw), first = entries[0]!.request;
  if (first.kind !== "gmgn_token_candles" || !first.series) throw new Error("gmgn_window_series_required");
  const series = GmgnCandleSeriesSchema.parse(first.series), slots = new Set<number>(), bars: ReturnType<typeof normalizeGmgnCandles>["candles"] = [];
  const received: string[] = [], refs: { request_id: string; part: number; receipt_hash: string | null; state: string }[] = [];
  let failed = 0;
  for (const entry of entries) {
    const request = entry.request;
    if (request.kind !== "gmgn_token_candles" || !request.series || request.address !== first.address || request.series.id !== series.id ||
      request.series.start_at !== series.start_at || request.series.end_at !== series.end_at || slots.has(request.series.part)) throw new Error("gmgn_window_identity_or_duplicate");
    slots.add(request.series.part); refs.push({ request_id: entry.id, part: request.series.part, receipt_hash: entry.receipt_hash, state: entry.state });
    if (entry.state === "failed") failed++;
    if (entry.state !== "succeeded") continue;
    if (!entry.received_at || !entry.receipt_hash) throw new Error("gmgn_window_receipt_required");
    const report = normalizeGmgn(request, entry.response, entry.received_at);
    const metrics = z.object({ candles: z.array(z.unknown()).max(100) }).parse(report.metrics);
    // normalizeGmgn already checked each page; the combined normalization below
    // repeats all time/OHLC checks over the fixed parent window and seam pairs.
    bars.push(...metrics.candles as typeof bars); received.push(entry.received_at);
  }
  const unique = new Map<number, typeof bars[number]>(), conflicts = new Set<number>();
  for (const bar of bars) {
    const previous = unique.get(bar.time);
    if (previous && JSON.stringify(previous) !== JSON.stringify(bar)) conflicts.add(bar.time);
    else unique.set(bar.time, bar);
  }
  bars.splice(0,bars.length,...[...unique.values()].filter(bar=>!conflicts.has(bar.time)).sort((a,b)=>a.time-b.time));
  received.sort(); refs.sort((a,b) => a.part-b.part);
  const at = received.at(-1) ?? null;
  const combined = at ? normalizeGmgnCandles({ list: bars }, { kind: "gmgn_token_candles", address: first.address, start_at: series.start_at, end_at: series.end_at }, Date.parse(at)) : null;
  const units = corroborateGmgnUnits(bars), span = at ? Date.parse(at) - Date.parse(received[0]!) : null;
  const gaps = ["request_context_only_no_canonical_pool_proof", "organic_volume_unknown", "independent_trade_units_not_verified"];
  const complete = combined?.complete_window === true && received.length === 4;
  if (!complete) gaps.push("candle_window_incomplete");
  if (span !== null && span > 300_000) gaps.push("receipt_span_exceeds_five_minutes");
  if (units.state === "unknown") gaps.push("candle_volume_units_unknown");
  if (conflicts.size) gaps.push("overlapping_candle_conflict");
  const usdTotal = complete && combined && units.usd_field ? combined.candles.reduce<number | null>((sum, bar) => sum === null || bar[units.usd_field!] === null ? null : sum + bar[units.usd_field!]!, 0) : null;
  if (usdTotal !== null && !Number.isFinite(usdTotal)) throw new Error("gmgn_window_volume_overflow");
  const report = { version: "gmgn-candle-window-v1" as const, window_id: series.id, address: first.address, window_start: series.start_at, window_end: series.end_at,
    received_at: at, receipt_span_ms: span, expected_parts: 4, attempted_parts: entries.length, succeeded_parts: received.length, failed_parts: failed,
    candle_count: bars.length, expected_count: 360, missing_minutes: 360-bars.length, overlap_conflicts: conflicts.size, complete_window: complete,
    units, reported_window_volume_usd: usdTotal, activity: combined?.activity ?? null, receipt_refs: refs, gaps,
    organic_demand_certified: false, independent_pool_binding_verified: false, scoring_effect: "none", evidence_gates_changed: false, provider_requests: 0 };
  return { ...report, report_hash: await hashJson(report) };
}
