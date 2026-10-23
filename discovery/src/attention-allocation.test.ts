import { expect, it } from "vitest";
import { key } from "./wallet-fixtures.test-helper";
import { normalizeAttention, type AttentionSnapshot } from "./attention-feed-contract";
import { attentionCandleRequest, attentionReviewRequest, attentionTraderRequest, buildAttentionQueue } from "./attention-queue";
import { allocatedAttentionReviewRequest, ATTENTION_ALLOCATION_POLICY, fairAttentionReviewRequest, type AttentionReviewAttempt } from "./attention-scheduling";

const start = new Date("2026-10-22T20:05:00.000Z");
function attention(at = start): AttentionSnapshot {
  // 98 exact identities: 38 Solana, 20 in each other chain. Solana is below
  // the global head and older; a second source window supplies the extra 18.
  const groups = ["bsc", "base", "robinhood", "sol", "sol"].map((chain, group) => ({
    chain, interval: group === 4 ? "1h" : "24h", tokens: Array.from({ length: group === 4 ? 18 : 20 }, (_, n) => ({
      address: chain === "sol" ? key(101 + n + (group === 4 ? 20 : 0)) : "0x" + String(n + 1).padStart(40, "0"),
      rank: n + 1, visiting_count: (5 - group) * 1000 - n, open_timestamp: start.getTime() / 1000 - 30 * 86400,
      liquidity: 40000, volume: 100000, buys: 100, sells: 80, renounced_mint: 1, renounced_freeze_account: 1,
      is_wash_trading: false, is_honeypot: false,
    })),
  }));
  return normalizeAttention({ kind: "gmgn_hot_searches", intervals: ["24h", "1h"], limit: 30 }, { code: 0, data: groups }, at.toISOString());
}
function simulate(selector: typeof allocatedAttentionReviewRequest) {
  const attempts: AttentionReviewAttempt[] = [], markets: AttentionSnapshot[] = [], solana = new Set<string>();
  const counts: Record<string, number> = {}, sizes: number[] = [], freshCounts: number[] = [];
  for (let hour = 0; hour < 24; hour++) {
    const now = new Date(start.getTime() + hour * 3600000), queue = buildAttentionQueue([attention(now), ...markets], now);
    const request = selector(queue, attempts);
    if (request?.kind !== "attention_dex_crosscheck") throw Error("Missing allocated opportunity");
    counts[request.chain] = (counts[request.chain] ?? 0) + 1; sizes.push(request.addresses.length);
    if (request.chain === "solana") request.addresses.forEach(a => solana.add(a));
    attempts.push({ chain: request.chain, addresses: request.addresses, last_attempt: now.toISOString() });
    markets.push(normalizeAttention(request, request.addresses.map(address => ({ chainId: request.chain, baseToken: { address }, liquidity: { usd: 40000 }, txns: { h24: { buys: 100, sells: 80 } } })), now.toISOString()));
    // Half-hour probes include the gap that four-chain v1 rotation creates.
    const probe = new Date(now.getTime() + 1800000), view = buildAttentionQueue([attention(probe), ...markets], probe);
    freshCounts.push(view.rows.filter(r => r.chain === "solana" && r.market_crosschecked).length);
    if (selector === allocatedAttentionReviewRequest) {
      expect(attentionCandleRequest(view, probe)).not.toBeNull();
      expect(attentionTraderRequest(view, probe)).not.toBeNull();
    }
  }
  return { counts, sizes, freshCounts, solana };
}
it("allocates the same 24 hourly opportunities 12/4/4/4 across midnight with fresh Solana targets in an ideal-success model", () => {
  const result = simulate(allocatedAttentionReviewRequest), legacy = simulate(fairAttentionReviewRequest);
  expect(result.counts).toEqual({ solana: 12, bsc: 4, base: 4, robinhood: 4 });
  expect(result.sizes).toHaveLength(24); expect(result.sizes.every(n => n > 0 && n <= 20)).toBe(true);
  expect(result.solana.size).toBe(38); expect(Math.min(...result.freshCounts)).toBeGreaterThan(0);
  expect(legacy.freshCounts).toContain(0); expect(Object.values(legacy.counts).reduce((a, b) => a + b, 0)).toBe(24);
});
it("anchors allocation to UTC hour rather than invocation count, queue rank, prior failures or local timezone", () => {
  const input = buildAttentionQueue([attention()], start), before = JSON.stringify(input);
  const failed = [{ chain: "solana" as const, addresses: [key(101)], last_attempt: new Date(start.getTime() - 3600000).toISOString() }];
  expect(attentionReviewRequest(input, failed)).toMatchObject({ chain: "solana" });
  expect(attentionReviewRequest(input, failed)).toEqual(allocatedAttentionReviewRequest(input, failed));
  const odd = { ...input, as_of: "2026-10-22T21:05:00.000Z" };
  expect(allocatedAttentionReviewRequest(odd, failed)).toMatchObject({ chain: "bsc" });
  expect(JSON.stringify(input)).toBe(before);
  expect(ATTENTION_ALLOCATION_POLICY).toMatchObject({ version: "attention-solana-allocation-v2", crosscheck_batches_per_hour_max: 1, crosscheck_addresses_max: 20, freshness_seconds: 7200 });
});
it("lends empty preferred slots while respecting fresh checks, stale attention and adverse identities", () => {
  const input = buildAttentionQueue([attention()], start);
  for (const row of input.rows.filter(r => r.chain === "solana")) row.market_crosschecked = true;
  expect(allocatedAttentionReviewRequest(input)).toMatchObject({ chain: "bsc" });
  const odd = { ...input, as_of: "2026-10-22T21:05:00.000Z" };
  for (const row of odd.rows) { row.market_crosschecked = false; if (row.chain !== "solana") row.checks = "adverse"; }
  expect(allocatedAttentionReviewRequest(odd)).toMatchObject({ chain: "solana" });
  odd.rows.forEach(row => row.attention_families = 0); expect(allocatedAttentionReviewRequest(odd)).toBeNull();
});
it("keeps token fairness across reserved Solana turns even when the original response was failed or empty", () => {
  const input = buildAttentionQueue([attention()], start), first = allocatedAttentionReviewRequest(input);
  if (first?.kind !== "attention_dex_crosscheck") throw Error("Missing Solana request");
  const next = allocatedAttentionReviewRequest({ ...input, as_of: "2026-10-22T22:05:00.000Z" }, [{ chain: first.chain, addresses: first.addresses, last_attempt: start.toISOString() }]);
  if (next?.kind !== "attention_dex_crosscheck") throw Error("Missing next Solana request");
  expect(next.chain).toBe("solana"); expect(new Set([...first.addresses, ...next.addresses]).size).toBe(38);
  expect(fairAttentionReviewRequest(input)).toMatchObject({ chain: "bsc" }); // Archived v1 remains replayable.
});
it("retains the exact two-hour freshness boundary and makes no coverage promise after missing or late responses", () => {
  const input = buildAttentionQueue([attention()], start), request = allocatedAttentionReviewRequest(input);
  if (request?.kind !== "attention_dex_crosscheck") throw Error("Missing request");
  const market = normalizeAttention(request, request.addresses.map(address => ({ chainId: "solana", baseToken: { address } })), start.toISOString());
  const boundary = new Date(start.getTime() + 7200000), late = new Date(boundary.getTime() + 1);
  expect(buildAttentionQueue([attention(boundary), market], boundary).rows.filter(r => r.market_crosschecked)).toHaveLength(20);
  const view = buildAttentionQueue([attention(late), market], late);
  expect(view.rows.filter(r => r.market_crosschecked)).toHaveLength(0);
  expect(attentionCandleRequest(view, late)).toBeNull(); expect(attentionTraderRequest(view, late)).toBeNull();
  expect(view.scoring_effect).toBe("none"); expect(view.launch_enabled).toBe(false); expect(view.evidence_gates_changed).toBe(false);
});
it("preserves full-input bounds and exact attempt validation even when filtering the preferred group", () => {
  const input = buildAttentionQueue([attention()], start);
  expect(() => allocatedAttentionReviewRequest({ ...input, rows: [...input.rows, ...input.rows] })).toThrow("attention_followup_selection_bound");
  const invalid = { chain: "base" as const, addresses: [key(101)], last_attempt: start.toISOString() };
  expect(() => allocatedAttentionReviewRequest(input, [invalid])).toThrow();
  expect(() => allocatedAttentionReviewRequest(input, [{ chain: "solana", addresses: [key(101)], last_attempt: new Date(start.getTime() + 1).toISOString() }])).toThrow("attention_review_attempt_future");
});
