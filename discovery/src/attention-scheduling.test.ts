import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import { key } from "./wallet-fixtures.test-helper";
import { AttentionRequest, normalizeAttention } from "./attention-feed-contract";
import { attentionCandleRequest, attentionTraderRequest, buildAttentionQueue, collectAttention, reviewAttention } from "./attention-queue";
import { fairAttentionReviewRequest, decodeAttentionReviewAttempts, readAttentionReviewAttempts, type AttentionReviewAttempt } from "./attention-scheduling";
import { GMGN_USE_AUTHORITY } from "./gmgn-model";
const at = new Date("2026-10-23T02:00:00.000Z"), databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); vi.restoreAllMocks(); });
function body(count = 24) {
  return { code: 0, data: ["bsc", "base", "robinhood", "sol"].map((chain, index) => ({ chain, interval: "24h", tokens: Array.from({ length: count }, (_, n) => ({
    address: chain === "sol" ? key(101 + n) : "0x" + String(n + 1).padStart(40, "0"), symbol: "SAME", rank: n + 1, visiting_count: (4 - index) * 1000 - n,
    open_timestamp: Math.floor(at.getTime() / 1000) - (chain === "sol" ? 3 * 86400 : 1800), liquidity: 40000, volume: 100000,
    buys: 100, sells: 80, renounced_mint: 1, renounced_freeze_account: 1, is_wash_trading: false, is_honeypot: false,
  })) })) };
}
function queue() { return buildAttentionQueue([normalizeAttention({ kind: "gmgn_hot_searches", intervals: ["24h"], limit: 30 }, body(), at.toISOString())], at); }
function setup() {
  const sqlite = new DatabaseSync(":memory:"); databases.push(sqlite);
  for (const f of readdirSync(new URL("../migrations/", import.meta.url)).filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  return { sqlite, db: sqliteD1(sqlite) };
}
it("reaches all four chains in four opportunities without global-head crowding or token-age exclusion", () => {
  const input = queue(), before = JSON.stringify(input), attempts: AttentionReviewAttempt[] = [], chains: string[] = [];
  expect(input.rows.slice(0, 20).every(r => r.chain === "bsc")).toBe(true);
  for (let turn = 0; turn < 4; turn++) {
    const request = fairAttentionReviewRequest(input, attempts); if (!request || request.kind !== "attention_dex_crosscheck") throw Error("Missing request");
    expect(request.addresses).toHaveLength(20); chains.push(request.chain);
    attempts.push({ chain: request.chain, addresses: request.addresses, last_attempt: new Date(at.getTime() - (4 - turn) * 60000).toISOString() });
  }
  expect(new Set(chains).size).toBe(4); expect(chains).toContain("solana"); expect(JSON.stringify(input)).toBe(before);
  expect(input.rows.filter(r => r.chain === "solana").every(r => at.getTime() / 1000 - r.reported_open_seconds! > 86400)).toBe(true);
});
it("rotates tokens within one chain even when prior batches returned no useful data", () => {
  const input = queue(); input.rows = input.rows.filter(r => r.chain === "solana");
  const first = fairAttentionReviewRequest(input); if (first?.kind !== "attention_dex_crosscheck") throw Error("Missing first");
  const second = fairAttentionReviewRequest(input, [{ chain: first.chain, addresses: first.addresses, last_attempt: new Date(at.getTime() - 3600000).toISOString() }]);
  if (second?.kind !== "attention_dex_crosscheck") throw Error("Missing second");
  expect(second.addresses.slice(0, 4)).toEqual(input.rows.slice(20).map(r => r.address));
  expect(new Set([...first.addresses, ...second.addresses]).size).toBe(24);
});
it("preserves freshness, adverse and existing market checks without symbol joins or cross-chain address collisions", () => {
  const input = queue(); input.rows.forEach(r => { if (r.chain === "bsc") r.checks = "adverse"; if (r.chain === "base") r.attention_families = 0; if (r.chain === "robinhood") r.market_crosschecked = true; });
  expect(fairAttentionReviewRequest(input)).toMatchObject({ chain: "solana" });
  input.rows.forEach(r => r.market_crosschecked = true); expect(fairAttentionReviewRequest(input)).toBeNull();
  const clean = queue(), attempts: AttentionReviewAttempt[] = [{ chain: "bsc", addresses: [clean.rows[0]!.address], last_attempt: at.toISOString() }];
  expect(fairAttentionReviewRequest(clean, attempts)).toMatchObject({ chain: "base" });
});
it("selects crosschecked older Solana candle/trader targets beyond the first twenty global rows", () => {
  const input = queue(), solana = input.rows.filter(r => r.chain === "solana"); solana.forEach(r => r.market_crosschecked = true);
  expect(input.rows.indexOf(solana[0]!)).toBeGreaterThan(20);
  expect(attentionCandleRequest(input, at)).toMatchObject({ address: solana[0]!.address }); expect(attentionTraderRequest(input, at)).toMatchObject({ address: solana[0]!.address });
  const attempts = [{ address: solana[0]!.address, last_attempt: at.toISOString() }];
  expect(attentionCandleRequest(input, at, attempts)).toMatchObject({ address: solana[1]!.address }); expect(attentionTraderRequest(input, at, attempts)).toMatchObject({ address: solana[1]!.address });
  solana.forEach(r => r.checks = "adverse"); expect(attentionCandleRequest(input, at)).toBeNull(); expect(attentionTraderRequest(input, at)).toBeNull();
});
it("validates bounded exact attempt metadata and rejects future scheduling inputs", () => {
  const request = { kind: "attention_dex_crosscheck", chain: "bsc", addresses: ["0x" + "1".repeat(40)] };
  expect(decodeAttentionReviewAttempts([{ request: JSON.stringify(request), last_attempt: at.toISOString() }])).toHaveLength(1);
  for (const raw of [[{ request: null, last_attempt: at.toISOString() }], [{ request: "x".repeat(5001), last_attempt: at.toISOString() }], Array.from({ length: 26 }, () => ({ request: JSON.stringify(request), last_attempt: at.toISOString() })), [{ request: JSON.stringify({ ...request, addresses: [...request.addresses, ...request.addresses] }), last_attempt: at.toISOString() }]]) expect(() => decodeAttentionReviewAttempts(raw)).toThrow();
  expect(() => fairAttentionReviewRequest(queue(), [{ chain: "bsc", addresses: request.addresses, last_attempt: new Date(at.getTime() + 1).toISOString() }])).toThrow("attention_review_attempt_future");
  expect(fairAttentionReviewRequest(queue(), [{ chain: "bsc", addresses: request.addresses, last_attempt: new Date(at.getTime() - 86400001).toISOString() }])).toMatchObject({ chain: "bsc" });
});
it("counts failed reservations in chain fairness while preserving hourly identity, charges and source backoff", async () => {
  const { sqlite, db } = setup(), settings = { db, apiKey: "synthetic-only", permissionReference: GMGN_USE_AUTHORITY, marketDailyLimit: 600 };
  await collectAttention(settings, { source: "gmgn", reason: "Synthetic four-chain source" }, async () => Response.json(body(20)), () => new Date(at.getTime() - 60000));
  const failed = vi.fn(async () => new Response(null, { status: 429, headers: { "retry-after": "300" } }));
  expect(await reviewAttention(settings, { reason: "First bounded opportunity" }, failed, () => at)).toMatchObject({ state: "failed", provider_requests: 1 });
  expect(await reviewAttention(settings, { reason: "Duplicate remains spent" }, failed, () => at)).toMatchObject({ state: "held", reason: "review_hour_already_reserved", provider_requests: 0 });
  const before = sqlite.prepare("SELECT total_changes() n").get()!.n, attempts = await readAttentionReviewAttempts(db, at);
  expect(attempts).toHaveLength(1); expect(attempts[0]!.chain).toBe("solana"); expect(sqlite.prepare("SELECT total_changes() n").get()!.n).toBe(before);
  const next = vi.fn(async (url: string) => { expect(url).toContain("/tokens/v1/bsc/"); return Response.json([]); });
  expect(await reviewAttention(settings, { reason: "Next regular hourly opportunity" }, next, () => new Date(at.getTime() + 3600000))).toMatchObject({ provider_requests: 1, selection_policy: "attention-solana-allocation-v2" });
  expect(failed).toHaveBeenCalledTimes(1); expect(next).toHaveBeenCalledTimes(1);
  expect(sqlite.prepare("SELECT used FROM tenx_usage WHERE provider='market' AND day=?").get(at.toISOString().slice(0, 10))).toEqual({ used: 3 });
  expect(AttentionRequest.parse({ kind: "attention_dex_crosscheck", chain: attempts[0]!.chain, addresses: attempts[0]!.addresses }).kind).toBe("attention_dex_crosscheck");
});
