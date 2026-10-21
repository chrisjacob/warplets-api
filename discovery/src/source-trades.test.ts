import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reviewSourceTrades, replaySourceTrades } from "./source-trades";
import { syntheticSourceActivityInput } from "./source-pilot-activity-fixtures";
import { key } from "./wallet-fixtures.test-helper";
import { WSOL } from "./pump";
import { sourceReviewCommand } from "../../scripts/discovery-source-review";

function sample() {
  const seed = syntheticSourceActivityInput(), row = seed.cohort[0]!;
  return { version: "source-trades-input-v1", provenance: "synthetic", address: row.address, pool: row.pool,
    start_at: new Date(Date.parse(seed.cutoff_at) - 3600000).toISOString(), cutoff_at: seed.cutoff_at,
    received_at: seed.cutoff_at, pool_metadata: { ...row.pool_metadata!, received_at: seed.cutoff_at },
    response: { data: [
      { id: "opaque-event-1", type: "trade", attributes: { block_number: 1, block_timestamp: seed.cutoff_at, tx_hash: "1".repeat(64), tx_from_address: key(120),
        kind: "buy", from_token_address: WSOL, to_token_address: row.address, from_token_amount: "0.001", to_token_amount: "1", volume_in_usd: "0.1", is_anomalous: true as boolean | null | undefined } },
      { id: "opaque-event-2", type: "trade", attributes: { block_number: 1, block_timestamp: seed.cutoff_at, tx_hash: "1".repeat(64), tx_from_address: key(121),
        kind: "sell", from_token_address: row.address, to_token_address: WSOL, from_token_amount: "1", to_token_amount: "0.001", volume_in_usd: "0.1", is_anomalous: undefined as boolean | null | undefined } },
    ] },
  };
}
// Model missing optional flags as absent JSON, not JS undefined.
function input() { return JSON.parse(JSON.stringify(sample())) as ReturnType<typeof sample>; }
describe("public pool trade sample measurements", () => {
  it("keeps transactions distinct from events, unknown anomaly flags, and file provenance", async () => {
    const record = await reviewSourceTrades(input());
    expect(record.report).toMatchObject({ source_authenticity: "unverified", complete_history: false, scoring_effect: "none",
      metrics: { sampled_events: 2, sampled_transactions: 1, source_reported_wallets: 2, buys: 1, sells: 1,
        sub_dollar_events: 2, vendor_anomalous_events: 1, vendor_flag_known_events: 1, vendor_flag_unknown_events: 1, largest_reported_wallet_volume_pct: 50 } });
    expect(await replaySourceTrades(record)).toMatchObject({ replay: "verified", provider_requests: 0, database_writes: 0 });
    expect(record.report.pool_binding.canonical_chain_proof).toBe("not_checked");
    const changed = structuredClone(record); changed.report.metrics!.buys++;
    await expect(replaySourceTrades(changed)).rejects.toThrow("replay_mismatch");
  });
  it("does not measure a missing, foreign or inverted pool metadata file", async () => {
    const missing = input(); missing.pool_metadata = null as never;
    expect((await reviewSourceTrades(missing)).report.metrics).toBeNull();
    const foreign = input(); (foreign.pool_metadata.response as any).data.attributes.address = key(123);
    expect((await reviewSourceTrades(foreign)).report.metrics).toBeNull();
    const inverted = input(); (inverted.pool_metadata.response as any).data.relationships.base_token.data.id = `solana_${WSOL}`;
    expect((await reviewSourceTrades(inverted)).report.metrics).toBeNull();
  });
  it("reports discarded older events and an empty sample without passing missingness", async () => {
    const old = input(); old.response.data[0]!.attributes.block_timestamp = new Date(Date.parse(old.start_at) - 1).toISOString();
    expect((await reviewSourceTrades(old)).report).toMatchObject({ outside_window_events: 1, metrics: { sampled_events: 1, buys: 0 } });
    old.response.data = []; expect((await reviewSourceTrades(old)).report.metrics).toBeNull();
  });
  it("retains reported zero volume but does not divide by zero", async () => {
    const raw = input(); for (const t of raw.response.data) { t.attributes.volume_in_usd = "0"; t.attributes.is_anomalous = false; }
    expect((await reviewSourceTrades(raw)).report.metrics).toMatchObject({ reported_volume_usd: 0, largest_reported_wallet_volume_pct: null, vendor_flag_known_events: 2, vendor_anomalous_events: 0 });
  });
  it.each(["duplicate", "future", "direction", "mint", "number", "negative", "nan", "timestamp", "stale", "metadata_time", "amount_length"])("rejects %s rather than repairing trade evidence", async kind => {
    const raw = input(), a = raw.response.data[0]!.attributes;
    if (kind === "duplicate") raw.response.data[1]!.id = raw.response.data[0]!.id;
    if (kind === "future") a.block_timestamp = new Date(Date.parse(raw.received_at) + 1).toISOString();
    if (kind === "direction") a.kind = "sell";
    if (kind === "mint") a.to_token_address = key(123);
    if (kind === "number") a.volume_in_usd = 0 as never;
    if (kind === "negative") a.volume_in_usd = "-1";
    if (kind === "nan") a.volume_in_usd = "NaN";
    if (kind === "timestamp") a.block_timestamp = "not a date";
    if (kind === "stale") raw.received_at = new Date(Date.parse(raw.cutoff_at) - 300001).toISOString();
    if (kind === "metadata_time") raw.pool_metadata.received_at = new Date(Date.parse(raw.cutoff_at) + 1).toISOString();
    if (kind === "amount_length") a.volume_in_usd = "9".repeat(101);
    await expect(reviewSourceTrades(raw)).rejects.toThrow();
  });
  it("holds 301 rows instead of silently truncating and marks the public 300-row cap", async () => {
    const raw = input(), base = raw.response.data[0]!;
    raw.response.data = Array.from({ length: 300 }, (_, i) => ({ ...base, id: `event-${i}` }));
    expect((await reviewSourceTrades(raw)).report).toMatchObject({ response_at_public_row_cap: true, complete_history: false });
    raw.response.data.push({ ...base, id: "301" }); await expect(reviewSourceTrades(raw)).rejects.toThrow();
  });
  it("reviews and freezes/replays trade files without network or leaking raw fields in ordinary output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "10x-source-trades-")), file = join(dir, "input.json"), saved = join(dir, "record.json");
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("forbidden"));
    try {
      const raw = input(); Object.assign(raw.response, { ignored_secret: "private-example" });
      await writeFile(file, JSON.stringify(raw), { flag: "wx" });
      const report = await sourceReviewCommand(["trades", file]);
      expect(JSON.stringify(report)).not.toContain("private-example");
      expect(await sourceReviewCommand(["trades-freeze", file, saved])).toEqual(report);
      expect(await sourceReviewCommand(["trades-replay", saved])).toMatchObject({ replay: "verified", provider_requests: 0 });
      expect(JSON.parse(await readFile(saved, "utf8")).inputs).toEqual(raw);
      await expect(sourceReviewCommand(["trades-freeze", file, saved])).rejects.toThrow();
      await expect(sourceReviewCommand(["trades-freeze", file, file])).rejects.toThrow("output_conflict"); expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); for (const path of [file, saved]) await unlink(path).catch(() => undefined); await rmdir(dir); }
  });
});
