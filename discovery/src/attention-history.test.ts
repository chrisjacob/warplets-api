import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import { syntheticBundle } from "./fixtures";
import { normalizeAttention } from "./attention-feed-contract";
import { buildAttentionQueue } from "./attention-queue";
import { planCanonicalAttentionIntake, reviewCanonicalAttentionState } from "./canonical-attention-intake";
import { collectAttentionHistory, historyObservation, planAttentionHistory, replayAttentionHistory, reviewAttentionHistory, selectHistoryBodies, type HistoryObservation } from "./attention-history";
import { MAINNET_GENESIS, type SignatureRow } from "./rpc";
import { reserveQualityQuota, runQualityCycle, type QualitySettings } from "./quality-cycle";
import { toBase58 } from "./solana";
const at = new Date("2026-10-23T05:00:00.000Z"), opened: DatabaseSync[] = [];
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(at); });
afterEach(() => { opened.splice(0).forEach(db => db.close()); vi.restoreAllMocks(); vi.useRealTimers(); });
const signature = (n: number) => { const bytes = new Uint8Array(64); new DataView(bytes.buffer).setUint32(0, n); return toBase58(bytes); };
async function setup() {
  const sqlite = new DatabaseSync(":memory:"); opened.push(sqlite);
  for (const f of readdirSync(new URL("../migrations/", import.meta.url)).filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  const db = sqliteD1(sqlite), observed = new Date(at.getTime() - 3600000), bundle = await syntheticBundle(new Date(at.getTime() - 2 * 86400000));
  const gmgn = normalizeAttention({ kind: "gmgn_hot_searches", chains: ["solana"], intervals: ["24h"] }, { code: 0, data: [{ chain: "sol", interval: "24h", tokens: [{ address: bundle.mint, open_timestamp: at.getTime() / 1000 - 3 * 86400, visiting_count: 100, renounced_mint: 1, renounced_freeze_account: 1 }] }] }, new Date(observed.getTime() - 60000).toISOString());
  const dex = normalizeAttention({ kind: "attention_dex_crosscheck", chain: "solana", addresses: [bundle.mint] }, [{ chainId: "solana", pairAddress: bundle.pool, baseToken: { address: bundle.mint }, liquidity: { usd: 40000 } }], new Date(observed.getTime() - 30000).toISOString());
  const plan = await planCanonicalAttentionIntake(buildAttentionQueue([gmgn, dex], observed), []); expect(plan).not.toBeNull();
  const accounts = { context: bundle.accounts.context, value: [bundle.accounts.value[0]!, bundle.accounts.value[1]!, bundle.accounts.value[4]!, bundle.accounts.value[2]!, null, bundle.accounts.value[3]!] }, canonical = await reviewCanonicalAttentionState(plan!, accounts, observed.toISOString());
  sqlite.prepare("INSERT INTO tenx_jobs(id,kind,state,started_at) VALUES('original-canonical','canonical_attention_intake','succeeded',?)").run(observed.toISOString());
  sqlite.prepare("INSERT INTO tenx_canonical_intakes(address,utc_hour,job_id,plan_hash,plan,created_at) VALUES(?,?,'original-canonical',?,?,?)").run(bundle.mint, observed.toISOString().slice(0, 13), plan!.plan_hash, JSON.stringify(plan), observed.toISOString());
  sqlite.prepare("INSERT INTO tenx_canonical_intake_receipts(address,receipt_hash,receipt,observed_at) VALUES(?,?,?,?)").run(bundle.mint, canonical.receipt_hash, JSON.stringify(canonical), observed.toISOString());
  const page: SignatureRow[] = [bundle.graduation, bundle.creation].map(tx => ({ signature: tx.transaction.signatures[0]!, slot: tx.slot, err: null, blockTime: tx.blockTime, confirmationStatus: "finalized" }));
  const transport = vi.fn<typeof fetch>(async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    expect(sqlite.prepare("SELECT count(*) n FROM tenx_attention_history_plans").get()!.n).toBeGreaterThan(0);
    if (request.method === "getTransaction") expect(sqlite.prepare("SELECT count(*) n FROM tenx_attention_history_reads WHERE step=0").get()!.n).toBeGreaterThan(0);
    const result = request.method === "getGenesisHash" ? MAINNET_GENESIS : request.method === "getSignaturesForAddress" ? page : [bundle.creation, bundle.graduation].find(tx => tx.transaction.signatures[0] === request.params[0]) ?? null;
    return Response.json({ jsonrpc: "2.0", id: request.id, result });
  });
  const settings: QualitySettings = { db, rpcUrl: "https://rpc.invalid", rpcDailyLimit: 5000, marketDailyLimit: 600, marketEnabled: false, qualityEnabled: true, qualityDailyLimit: 1800, transport };
  await db.prepare("UPDATE tenx_quality_control SET lease_owner='history-owner',lease_until=?1 WHERE id=1").bind(new Date(at.getTime() + 300000).toISOString()).run();
  const collect = (remaining = 18, clock = () => at) => collectAttentionHistory(settings, "history-owner", remaining, clock, reserveQualityQuota(db, settings, at));
  return { sqlite, db, settings, bundle, canonical, page, transport, collect };
}
it("collects exact historical creation and migration proof for an older runner under the ordinary quality lease", async () => {
  const { db, sqlite, settings, canonical, bundle, transport } = await setup();
  sqlite.exec("UPDATE tenx_quality_control SET lease_owner=NULL,lease_until=NULL");
  const result = await runQualityCycle(settings, at);
  expect(result).toMatchObject({ state: "succeeded", rpc_calls: 4, historical_intake: { historical_pair_verified: true, candidate_admitted: false } });
  expect(transport).toHaveBeenCalledTimes(4);
  const replay = await replayAttentionHistory(db, bundle.mint, canonical); expect(replay.previous).toMatchObject({ status: "verified", historical_creation_proven: true, historical_migration_proven: true, candidate_admitted: false });
  expect(replay.previous!.origin!.proof.signature).toBe(bundle.creation.transaction.signatures[0]);
  expect(replay.previous!.graduation!.proof.signature).toBe(bundle.graduation.transaction.signatures[0]);
  expect(sqlite.prepare("SELECT used FROM tenx_quality_usage").get()!.used).toBe(4); expect(sqlite.prepare("SELECT used FROM tenx_usage WHERE provider='rpc'").get()!.used).toBe(4);
  for (const table of ["tenx_candidates", "tenx_leads", "tenx_proofs", "tenx_evidence", "tenx_holder_evidence"]) expect(sqlite.prepare(`SELECT count(*) n FROM ${table}`).get()!.n).toBe(0);
  for (const table of ["tenx_attention_history_plans", "tenx_attention_history_reads", "tenx_attention_history_receipts"]) expect(() => sqlite.exec(`DELETE FROM ${table}`)).toThrow("attention_history_immutable");
});
it("keeps missing historical bodies unknown and terminal without retry or candidate admission", async () => {
  const { sqlite, collect, transport } = await setup(); const original = transport.getMockImplementation()!;
  transport.mockImplementation(async (input, init) => JSON.parse(String(init?.body)).method === "getTransaction" ? Response.json({ jsonrpc: "2.0", id: JSON.parse(String(init?.body)).id, result: null }) : original(input, init));
  expect(await collect()).toMatchObject({ state: "collected", historical_pair_verified: false });
  const receipt = JSON.parse(String(sqlite.prepare("SELECT receipt FROM tenx_attention_history_receipts").get()!.receipt));
  expect(receipt).toMatchObject({ status: "unknown_within_bound", continuation_allowed: false, historical_creation_proven: false, historical_migration_proven: false }); expect(receipt.inspected.every((r: { outcome: string }) => r.outcome === "archival_body_missing")).toBe(true);
  const count = transport.mock.calls.length; expect(await collect()).toMatchObject({ state: "held", reason: "history_no_unspent_canonical_lead" }); expect(transport).toHaveBeenCalledTimes(count);
});
it.each(["pause", "owner", "backoff", "remaining", "migration"])("holds before reserving or dispatching on %s", async kind => {
  const { sqlite, collect, transport } = await setup();
  if (kind === "pause") sqlite.exec("UPDATE tenx_control SET paused=1"); if (kind === "owner") sqlite.exec("UPDATE tenx_quality_control SET lease_owner='other'"); if (kind === "backoff") sqlite.prepare("UPDATE tenx_control SET retry_after=?").run(new Date(at.getTime() + 300000).toISOString());
  if (kind === "migration") sqlite.exec("DROP TABLE tenx_attention_history_receipts;DROP TABLE tenx_attention_history_reads;DROP TABLE tenx_attention_history_plans");
  expect(await collect(kind === "remaining" ? 5 : 18)).toMatchObject({ state: "held", rpc_calls: 0 }); expect(transport).not.toHaveBeenCalled(); expect(sqlite.prepare("SELECT count(*) n FROM tenx_jobs WHERE kind='attention_history'").get()!.n).toBe(0);
});
it.each(["quality", "global", "cluster", "rate_limit", "ownership", "day", "bad_slot", "bad_pool"])("preserves a spent original turn after %s", async kind => {
  const { sqlite, transport, collect, bundle } = await setup(); let current = at; const original = transport.getMockImplementation()!;
  if (kind === "quality") sqlite.prepare("INSERT INTO tenx_quality_usage(day,used) VALUES(?,1800)").run(at.toISOString().slice(0, 10));
  if (kind === "global") sqlite.prepare("INSERT INTO tenx_usage(provider,day,used) VALUES('rpc',?,5000)").run(at.toISOString().slice(0, 10));
  transport.mockImplementation(async (input, init) => {
    const request = JSON.parse(String(init?.body));
    if (kind === "cluster") return Response.json({ jsonrpc: "2.0", id: request.id, result: "wrong" });
    if (request.method === "getTransaction") {
      if (kind === "rate_limit") return new Response(null, { status: 429, headers: { "retry-after": "900" } });
      if (kind === "ownership") sqlite.exec("UPDATE tenx_quality_control SET lease_owner='other'"); if (kind === "day") current = new Date("2026-10-24T00:00:00.000Z");
      if (kind === "bad_slot") return Response.json({ jsonrpc: "2.0", id: request.id, result: { ...bundle.graduation, slot: 999999 } });
      if (kind === "bad_pool") { const wrong = structuredClone(bundle.graduation); wrong.transaction.message.accountKeys[0] = bundle.mint; return Response.json({ jsonrpc: "2.0", id: request.id, result: wrong }); }
    }
    return original(input, init);
  });
  expect(await collect(18, () => current)).toMatchObject({ state: "failed", receipt_saved: false, historical_pair_verified: false });
  expect(sqlite.prepare("SELECT count(*) n FROM tenx_attention_history_plans").get()!.n).toBe(1); expect(sqlite.prepare("SELECT count(*) n FROM tenx_attention_history_receipts").get()!.n).toBe(0);
  if (kind === "rate_limit") expect(sqlite.prepare("SELECT retry_after FROM tenx_control").get()!.retry_after).toBe("2026-10-23T05:15:00.000Z");
  sqlite.exec("UPDATE tenx_control SET retry_after=NULL;UPDATE tenx_quality_control SET lease_owner='history-owner'"); // Synthetic hold removal only: the original spent mint must still be denied.
  const count = transport.mock.calls.length; expect(await collect()).toMatchObject({ state: "held", reason: "history_no_unspent_canonical_lead" }); expect(transport).toHaveBeenCalledTimes(count);
  if (["rate_limit", "ownership", "day", "bad_slot", "bad_pool"].includes(kind)) expect(sqlite.prepare("SELECT count(*) n FROM tenx_attention_history_reads WHERE step=0").get()!.n).toBe(1);
});
it("uses only deterministic page edges, validates pagination and keeps an incomplete first page as research", async () => {
  const { canonical, bundle } = await setup(), plan = await planAttentionHistory(canonical, null, at.toISOString(), 1);
  const page = Array.from({ length: 1000 }, (_, i) => ({ signature: signature(i + 1), slot: 29000 - i, err: null, blockTime: null, confirmationStatus: "finalized" }));
  const selection = selectHistoryBodies(plan, page, [], at.toISOString()); expect(selection.selected.map(r => r.signature)).toEqual([page[0]!.signature, page[1]!.signature, page[998]!.signature, page[999]!.signature]);
  const reads: HistoryObservation[] = [await historyObservation(0, { method: "getSignaturesForAddress", params: [plan.curve, { commitment: "finalized", limit: 1000 }] }, page, null, at.toISOString())];
  for (const [i, item] of selection.selected.entries()) reads.push(await historyObservation(i + 1, { method: "getTransaction", params: [item.signature, { commitment: "finalized", encoding: "json", maxSupportedTransactionVersion: 1 }] }, null, "archival_body_missing", at.toISOString()));
  const first = await reviewAttentionHistory(plan, canonical, null, [], reads, at.toISOString()); expect(first).toMatchObject({ continuation_allowed: true, status: "scanning", historical_pair_verified: false });
  const next = await planAttentionHistory(canonical, first, at.toISOString(), 2); expect(next).toMatchObject({ turn: 2, before_signature: page[999]!.signature, parent_receipt_hash: first.receipt_hash });
  expect(() => selectHistoryBodies(next, page, page.map(r => r.signature), at.toISOString())).toThrow();
  await expect(reviewAttentionHistory({ ...plan, state_slot: 1 }, canonical, null, [], reads, at.toISOString())).rejects.toThrow("history_plan_mismatch");
  await expect(reviewAttentionHistory(plan, canonical, null, [], reads.slice(0, 1), at.toISOString())).rejects.toThrow("history_body_count_mismatch");
  expect(bundle.mint).toBe(canonical.address);
});
it("continues only the original retained cursor and carries replayed migration proof into a later creation page", async () => {
  const { sqlite, db, collect, canonical, page, transport, bundle } = await setup(); const original = transport.getMockImplementation()!;
  const first = [page[0]!, ...Array.from({ length: 999 }, (_, i) => ({ signature: signature(i + 100), slot: 19999 - i, err: null, blockTime: null, confirmationStatus: "finalized" }))];
  transport.mockImplementation(async (input, init) => { const request = JSON.parse(String(init?.body));
    if (request.method === "getSignaturesForAddress") return Response.json({ jsonrpc: "2.0", id: request.id, result: request.params[1].before ? [page[1]!] : first });
    return original(input, init);
  });
  expect(await collect()).toMatchObject({ rpc_calls: 6, historical_creation_proven: false, historical_migration_proven: true, historical_pair_verified: false });
  const firstReceipt = String(sqlite.prepare("SELECT receipt FROM tenx_attention_history_receipts").get()!.receipt);
  expect(await collect()).toMatchObject({ rpc_calls: 3, historical_pair_verified: true });
  const secondRequest = transport.mock.calls.map(call => JSON.parse(String(call[1]?.body))).filter(r => r.method === "getSignaturesForAddress")[1]; expect(secondRequest.params[1].before).toBe(first[999]!.signature);
  const replay = await replayAttentionHistory(db, bundle.mint, canonical); expect(replay.previous).toMatchObject({ turn: 2, historical_pair_verified: true, continuation_allowed: false });
  expect(String(sqlite.prepare("SELECT receipt FROM tenx_attention_history_receipts ORDER BY observed_at,plan_id LIMIT 1").get()!.receipt)).toBe(firstReceipt);
  expect(sqlite.prepare("SELECT used FROM tenx_quality_usage").get()!.used).toBe(9);
});
it("bounds a spent UTC hour to three original turns without a new request", async () => {
  const { sqlite, collect, transport } = await setup();
  for (const slot of [1, 2, 3]) sqlite.prepare("INSERT INTO tenx_jobs(id,kind,state,started_at) VALUES(?,'attention_history','failed',?)").run(`attention-history-${at.toISOString().slice(0, 13)}-${slot}`, at.toISOString());
  expect(await collect()).toMatchObject({ state: "held", reason: "history_hour_spent", rpc_calls: 0 }); expect(transport).not.toHaveBeenCalled();
});
it("retains unsupported transaction layouts as unknown without manufacturing proof", async () => {
  const { sqlite, collect, transport, bundle } = await setup(); const original = transport.getMockImplementation()!;
  transport.mockImplementation(async (input, init) => { const request = JSON.parse(String(init?.body)); return request.method === "getTransaction" ? Response.json({ jsonrpc: "2.0", id: request.id, result: { ...bundle.creation, transaction: { ...bundle.creation.transaction, signatures: [request.params[0]] }, version: 2 } }) : original(input, init); });
  expect(await collect()).toMatchObject({ state: "collected", historical_pair_verified: false, historical_creation_proven: false, historical_migration_proven: false });
  const receipt = JSON.parse(String(sqlite.prepare("SELECT receipt FROM tenx_attention_history_receipts").get()!.receipt)); expect(receipt.inspected.every((r: { outcome: string }) => r.outcome === "unsupported_transaction_version")).toBe(true);
});
it("charges the current request day when research starts after the ordinary cycle crossed midnight", async () => {
  const { sqlite, settings } = await setup(); sqlite.exec("UPDATE tenx_quality_control SET lease_owner=NULL,lease_until=NULL");
  const before = new Date("2026-10-23T23:59:59.000Z"), after = new Date("2026-10-24T00:00:01.000Z");
  vi.spyOn(Date, "now").mockReturnValueOnce(before.getTime()).mockReturnValue(after.getTime());
  expect(await runQualityCycle(settings, before)).toMatchObject({ historical_intake: { historical_pair_verified: true }, rpc_calls: 4 });
  expect(sqlite.prepare("SELECT day,used FROM tenx_quality_usage").all()).toEqual([{ day: "2026-10-24", used: 4 }]);
  expect(sqlite.prepare("SELECT day,used FROM tenx_usage WHERE provider='rpc'").all()).toEqual([{ day: "2026-10-24", used: 4 }]);
});
it("rejects a creation timestamp after graduation even when both exact instruction bodies validate", async () => {
  const { sqlite, collect, bundle, page } = await setup();
  bundle.creation.blockTime = bundle.graduation.blockTime! + 10; page[1]!.blockTime = bundle.creation.blockTime;
  expect(await collect()).toMatchObject({ state: "failed", error: "history_origin_after_migration", historical_pair_verified: false });
  expect(sqlite.prepare("SELECT count(*) n FROM tenx_attention_history_reads").get()!.n).toBe(3);
  expect(sqlite.prepare("SELECT count(*) n FROM tenx_attention_history_receipts").get()!.n).toBe(0);
});
it("stops after three full original pages and never treats uninspected bodies as absent proof", async () => {
  const { sqlite, collect, transport, canonical, db, bundle } = await setup(); const original = transport.getMockImplementation()!; let pages = 0;
  transport.mockImplementation(async (input, init) => { const request = JSON.parse(String(init?.body));
    if (request.method === "getSignaturesForAddress") { const start = pages++ * 1000; return Response.json({ jsonrpc: "2.0", id: request.id, result: Array.from({ length: 1000 }, (_, i) => ({ signature: signature(start + i + 100), slot: 29000 - start - i, err: null, blockTime: null, confirmationStatus: "finalized" })) }); }
    return original(input, init);
  });
  for (let turn = 1; turn <= 3; turn++) expect(await collect()).toMatchObject({ state: "collected", rpc_calls: 6, historical_pair_verified: false });
  const replay = await replayAttentionHistory(db, bundle.mint, canonical); expect(replay.previous).toMatchObject({ turn: 3, status: "unknown_within_bound", continuation_allowed: false, historical_pair_verified: false });
  const count = transport.mock.calls.length; expect(await collect()).toMatchObject({ state: "held", reason: "history_hour_spent" }); expect(transport).toHaveBeenCalledTimes(count);
  expect(sqlite.prepare("SELECT used FROM tenx_quality_usage").get()!.used).toBe(18);
});
