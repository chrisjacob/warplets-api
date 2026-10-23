import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import { syntheticBundle } from "./fixtures";
import { key } from "./wallet-fixtures.test-helper";
import { MAINNET_GENESIS, type Accounts } from "./rpc";
import { TOKEN_2022 } from "./pump";
import { hashJson } from "./solana";
import { collectAttention, readAttentionQueue, reviewAttention } from "./attention-queue";
import { GMGN_USE_AUTHORITY } from "./gmgn-model";
import { runQualityCycle, reserveQualityQuota, type QualitySettings } from "./quality-cycle";
import { canonicalIntakeAddresses, collectCanonicalAttentionIntake, planCanonicalAttentionIntake, reviewCanonicalAttentionState } from "./canonical-attention-intake";
const at = new Date("2026-10-23T04:00:00.000Z"), opened: DatabaseSync[] = [];
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(at); });
afterEach(() => { opened.splice(0).forEach(db => db.close()); vi.restoreAllMocks(); vi.useRealTimers(); });
async function setup(poolHint?: string) {
  const sqlite = new DatabaseSync(":memory:"); opened.push(sqlite);
  for (const f of readdirSync(new URL("../migrations/", import.meta.url)).filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  const db = sqliteD1(sqlite), bundle = await syntheticBundle(at), source = { db, apiKey: "synthetic-only", permissionReference: GMGN_USE_AUTHORITY, marketDailyLimit: 600 };
  await collectAttention(source, { source: "gmgn", reason: "Synthetic older attention lead" }, async () => Response.json({ code: 0, data: [{ chain: "sol", interval: "24h", tokens: [{ address: bundle.mint, visiting_count: 100, open_timestamp: at.getTime() / 1000 - 3 * 86400, is_wash_trading: false, renounced_mint: 1, renounced_freeze_account: 1 }] }] }), () => new Date(at.getTime() - 60000));
  await reviewAttention(source, { reason: "Synthetic exact market pool" }, async () => Response.json([{ chainId: "solana", pairAddress: poolHint ?? bundle.pool, baseToken: { address: bundle.mint }, liquidity: { usd: 40000 }, volume: { h24: 200000, h1: 5000 }, txns: { h24: { buys: 100, sells: 90 } } }]), () => new Date(at.getTime() - 30000));
  const accounts: Accounts = { context: bundle.accounts.context, value: [bundle.accounts.value[0]!, bundle.accounts.value[1]!, bundle.accounts.value[4]!, bundle.accounts.value[2]!, null, bundle.accounts.value[3]!] };
  const transport = vi.fn<typeof fetch>(async (_url, init) => {
    expect(sqlite.prepare("SELECT count(*) n FROM tenx_canonical_intakes").get()!.n).toBe(1);
    const request = JSON.parse(String(init?.body)); return Response.json({ jsonrpc: "2.0", id: request.id, result: request.method === "getGenesisHash" ? MAINNET_GENESIS : accounts });
  });
  const settings: QualitySettings = { db, rpcUrl: "https://rpc.invalid", rpcDailyLimit: 5000, marketDailyLimit: 600, marketEnabled: false, qualityEnabled: true, qualityDailyLimit: 1800, transport };
  return { sqlite, db, bundle, accounts, transport, settings, queue: await readAttentionQueue(db, at, "review") };
}
async function lease(db: D1Database) { await db.prepare("UPDATE tenx_quality_control SET lease_owner='test-owner',lease_until=?1 WHERE id=1").bind(new Date(at.getTime() + 300000).toISOString()).run(); }
it("retains a current canonical-state research receipt with two shared RPC calls and no candidate/migration admission", async () => {
  const { sqlite, settings, transport, queue, bundle, db } = await setup(); expect(queue.rows[0]!.pool).toBe(bundle.pool);
  const result = await runQualityCycle(settings, at); expect(result).toMatchObject({ state: "succeeded", rpc_calls: 2, targets: 0, canonical_intake: { state: "collected", receipt_saved: true, candidate_admitted: false } });
  expect(transport).toHaveBeenCalledTimes(2); expect(sqlite.prepare("SELECT used FROM tenx_quality_usage").get()).toEqual({ used: 2 });
  expect(sqlite.prepare("SELECT used FROM tenx_usage WHERE provider='rpc'").get()).toEqual({ used: 2 });
  for (const table of ["tenx_candidates", "tenx_leads", "tenx_proofs", "tenx_holder_evidence"]) expect(sqlite.prepare(`SELECT count(*) n FROM ${table}`).get()!.n).toBe(0);
  const saved = sqlite.prepare("SELECT receipt FROM tenx_canonical_intake_receipts").get()!, plan = JSON.parse(String(sqlite.prepare("SELECT plan FROM tenx_canonical_intakes").get()!.plan)), report = JSON.parse(String(saved.receipt));
  expect(report).toMatchObject({ current_pool_verified: true, historical_creation_proven: false, historical_migration_proven: false, candidate_admitted: false, authority_checks: "revoked", holder_quality: "unknown", market_data_bound_to_pool: false, scoring_effect: "none" });
  expect(await reviewCanonicalAttentionState(plan, report.accounts, report.observed_at)).toEqual(report);
  expect(() => sqlite.exec("UPDATE tenx_canonical_intakes SET plan='{}'")).toThrow("canonical_intake_immutable"); expect(() => sqlite.exec("DELETE FROM tenx_canonical_intake_receipts")).toThrow("canonical_intake_immutable");
  await lease(db); expect(await collectCanonicalAttentionIntake(settings, "test-owner", 18, () => at, reserveQualityQuota(db, settings, at))).toMatchObject({ state: "held", reason: "canonical_intake_hour_spent", rpc_calls: 0 }); expect(transport).toHaveBeenCalledTimes(2);
});
it("selects only positive reported older, fresh non-adverse exact Solana pool leads without fallback after state inspection", async () => {
  const { queue, bundle } = await setup(); const plan = await planCanonicalAttentionIntake(queue, []); expect(plan?.address).toBe(bundle.mint);
  expect(await planCanonicalAttentionIntake(queue, [bundle.mint])).toBeNull();
  for (const change of [{ reported_open_seconds: 0 }, { reported_open_seconds: at.getTime() / 1000 - 100 }, { checks: "adverse" as const }, { attention_families: 0 }, { pool: null }, { market_crosschecked: false }]) {
    const altered = structuredClone(queue); Object.assign(altered.rows[0]!, change); expect(await planCanonicalAttentionIntake(altered, [])).toBeNull();
  }
});
it.each(["pool_owner", "vault_owner", "mint_program", "curve", "shape", "zero_slot", "plan_hash"])("holds invalid %s observations instead of inventing history", async kind => {
  const { queue, accounts } = await setup(), plan = (await planCanonicalAttentionIntake(queue, []))!, changed = structuredClone(accounts);
  expect(plan).not.toBeNull();
  if (kind === "pool_owner") changed.value[1]!.owner = key(99);
  if (kind === "vault_owner") changed.value[3]!.owner = key(99);
  if (kind === "mint_program") changed.value[0]!.owner = key(99);
  if (kind === "curve") changed.value[2] = null;
  if (kind === "shape") changed.value.pop();
  if (kind === "zero_slot") changed.context.slot = 0;
  if (kind === "plan_hash") plan.plan_hash = "0".repeat(64);
  await expect(reviewCanonicalAttentionState(plan, changed, at.toISOString())).rejects.toThrow();
});
it("supports a verified Token2022 mint path and preserves active authorities as adverse research facts", async () => {
  const { queue, accounts } = await setup(), plan = (await planCanonicalAttentionIntake(queue, []))!, changed = structuredClone(accounts);
  changed.value[0]!.owner = TOKEN_2022; changed.value[4] = structuredClone(changed.value[3]!); changed.value[4]!.owner = TOKEN_2022; changed.value[3] = null;
  const addresses = await canonicalIntakeAddresses(plan), poolBytes = Buffer.from(changed.value[1]!.data[0], "base64");
  const { publicKey } = await import("./solana"); poolBytes.set(publicKey(addresses[4]!), 8 + 1 + 2 + 32 * 4); changed.value[1]!.data[0] = poolBytes.toString("base64");
  const mintBytes = Buffer.from(changed.value[0]!.data[0], "base64"); mintBytes[0] = 1; changed.value[0]!.data[0] = mintBytes.toString("base64");
  expect(await reviewCanonicalAttentionState(plan, changed, at.toISOString())).toMatchObject({ current_pool_verified: true, authority_checks: "adverse", candidate_admitted: false });
});
it.each(["pause", "lease", "backoff", "budget", "migration"])("does not dispatch or retain a new plan under a %s hold", async kind => {
  const { sqlite, db, settings, transport } = await setup(); await lease(db);
  if (kind === "pause") sqlite.exec("UPDATE tenx_control SET paused=1");
  if (kind === "lease") sqlite.exec("UPDATE tenx_quality_control SET lease_owner='other'");
  if (kind === "backoff") sqlite.prepare("UPDATE tenx_control SET retry_after=?").run(new Date(at.getTime() + 300000).toISOString());
  if (kind === "migration") sqlite.exec("DROP TABLE tenx_canonical_intake_receipts;DROP TABLE tenx_canonical_intakes");
  expect(await collectCanonicalAttentionIntake(settings, "test-owner", kind === "budget" ? 1 : 18, () => at, reserveQualityQuota(db, settings, at))).toMatchObject({ state: "held", rpc_calls: 0 }); expect(transport).not.toHaveBeenCalled();
  expect(sqlite.prepare("SELECT count(*) n FROM tenx_jobs WHERE kind='canonical_attention_intake'").get()!.n).toBe(0);
});
it.each(["quality", "global", "wrong_cluster", "rate_limit", "ownership", "day_rollover", "pool_mismatch"])("retains the original spent plan after %s without a receipt or retry", async kind => {
  const { sqlite, db, settings, transport, accounts } = await setup(kind === "pool_mismatch" ? key(99) : undefined); await lease(db); let now = at;
  if (kind === "quality") sqlite.prepare("INSERT INTO tenx_quality_usage(day,used) VALUES(?,1800)").run(at.toISOString().slice(0, 10));
  if (kind === "global") sqlite.prepare("INSERT INTO tenx_usage(provider,day,used) VALUES('rpc',?,5000)").run(at.toISOString().slice(0, 10));
  if (["wrong_cluster", "rate_limit", "ownership", "day_rollover"].includes(kind)) transport.mockImplementation(async (_url, init) => {
    const request = JSON.parse(String(init?.body)); if (kind === "rate_limit") return new Response(null, { status: 429, headers: { "retry-after": "900" } });
    if (kind === "ownership") sqlite.exec("UPDATE tenx_quality_control SET lease_owner='other'"); if (kind === "day_rollover") now = new Date("2026-10-24T00:00:00.000Z");
    return Response.json({ jsonrpc: "2.0", id: request.id, result: request.method === "getGenesisHash" ? kind === "wrong_cluster" ? "wrong" : MAINNET_GENESIS : accounts });
  });
  const result = await collectCanonicalAttentionIntake(settings, "test-owner", 18, () => now, reserveQualityQuota(db, settings, at)); expect(result).toMatchObject({ state: "failed", receipt_saved: false, candidate_admitted: false });
  expect(sqlite.prepare("SELECT count(*) n FROM tenx_canonical_intakes").get()!.n).toBe(1); expect(sqlite.prepare("SELECT count(*) n FROM tenx_canonical_intake_receipts").get()!.n).toBe(0);
  if (["quality", "global", "pool_mismatch"].includes(kind)) expect(transport).not.toHaveBeenCalled();
  if (kind === "rate_limit") expect(sqlite.prepare("SELECT last_error,retry_after FROM tenx_control WHERE id=1").get()).toEqual({ last_error: "rpc_rate_limited", retry_after: "2026-10-23T04:15:00.000Z" });
  const before = transport.mock.calls.length; expect(await collectCanonicalAttentionIntake(settings, "test-owner", 18, () => at, reserveQualityQuota(db, settings, at))).toMatchObject({ state: "held", reason: "canonical_intake_hour_spent" }); expect(transport).toHaveBeenCalledTimes(before);
  const saved = JSON.parse(String(sqlite.prepare("SELECT plan FROM tenx_canonical_intakes").get()!.plan)), { plan_hash, ...body } = saved; expect(await hashJson(body)).toBe(plan_hash);
});
