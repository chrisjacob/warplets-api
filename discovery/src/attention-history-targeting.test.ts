import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import schema from "../protocol/pump-schema.json";
import { syntheticBundle } from "./fixtures";
import { normalizeAttention } from "./attention-feed-contract";
import { buildAttentionQueue } from "./attention-queue";
import { canonicalIntakeAddresses, planCanonicalAttentionIntake, planTargetedCanonicalIntake, reviewCanonicalAttentionState } from "./canonical-attention-intake";
import { collectAttentionHistory, historyObservation, planAttentionHistory, planTargetedAttentionHistory, replayAttentionHistory, reviewAttentionHistory, selectHistoryBodies, type HistoryReceipt } from "./attention-history";
import { attentionHistoryTargets, METADATA_PROGRAM, TARGETED_HISTORY_POLICY } from "./attention-history-targeting";
import { MAINNET_GENESIS, type SignatureRow, type Transaction } from "./rpc";
import { reserveQualityQuota, type QualitySettings } from "./quality-cycle";
import { AMM, PUMP, TOKEN, TOKEN_2022, WSOL } from "./pump";
import { fromBase58, hashJson, publicKey, toBase58 } from "./solana";

const at = new Date("2026-10-23T08:10:00.000Z"), opened: DatabaseSync[] = [];
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(at); });
afterEach(() => { opened.splice(0).forEach(db => db.close()); vi.restoreAllMocks(); vi.useRealTimers(); });
const signature = (n: number) => { const b = new Uint8Array(64); new DataView(b.buffer).setUint32(0, n); return toBase58(b); };
const pageRow = (tx: Transaction): SignatureRow => ({ signature: tx.transaction.signatures[0]!, slot: tx.slot, blockTime: tx.blockTime, err: null, confirmationStatus: "finalized" });
async function setup(targeted = true, token2022 = false) {
  const sqlite = new DatabaseSync(":memory:"); opened.push(sqlite);
  for (const f of readdirSync(new URL("../migrations/", import.meta.url)).filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  const db = sqliteD1(sqlite), observed = new Date(at.getTime() - 60000), bundle = await syntheticBundle(new Date(at.getTime() - 2 * 86400000));
  const gmgn = normalizeAttention({ kind: "gmgn_hot_searches", chains: ["solana"], intervals: ["24h"] }, { code: 0, data: [{ chain: "sol", interval: "24h", tokens: [{ address: bundle.mint, open_timestamp: at.getTime() / 1000 - 3 * 86400, renounced_mint: 1, renounced_freeze_account: 1, is_wash_trading: false }] }] }, observed.toISOString());
  const dex = normalizeAttention({ kind: "attention_dex_crosscheck", chain: "solana", addresses: [bundle.mint] }, [{ chainId: "solana", pairAddress: bundle.pool, baseToken: { address: bundle.mint }, liquidity: { usd: 40000 } }], observed.toISOString());
  const queue = buildAttentionQueue([gmgn, dex], observed), plan = (await (targeted ? planTargetedCanonicalIntake : planCanonicalAttentionIntake)(queue, []))!;
  const accounts = { context: bundle.accounts.context, value: [bundle.accounts.value[0]!, bundle.accounts.value[1]!, bundle.accounts.value[4]!, bundle.accounts.value[2]!, null, bundle.accounts.value[3]!] };
  if (token2022) {
    accounts.value[0]!.owner = TOKEN_2022; accounts.value[4] = structuredClone(accounts.value[3]!); accounts.value[4]!.owner = TOKEN_2022; accounts.value[3] = null;
    const addresses = await canonicalIntakeAddresses(plan), bytes = Buffer.from(accounts.value[1]!.data[0], "base64");
    bytes.set(publicKey(addresses[4]!), 8 + 1 + 2 + 32 * 4); accounts.value[1]!.data[0] = bytes.toString("base64");
  }
  const canonical = await reviewCanonicalAttentionState(plan, accounts, observed.toISOString()), targets = await attentionHistoryTargets(canonical.identity);
  // Bind the synthetic instruction accounts to the actual derived lookup PDAs.
  const create = schema.instructions.find(i => i.name === "create")!, migrate = schema.instructions.find(i => i.name === "migrate")!;
  if (!token2022) {
    bundle.creation.transaction.message.accountKeys[create.accounts.indexOf("metadata") + 1] = targets.creation.address;
    bundle.creation.transaction.message.accountKeys[create.accounts.indexOf("mpl_token_metadata") + 1] = METADATA_PROGRAM;
  }
  if (token2022) {
    const remap = (tx: Transaction, oldName: string, newName: string) => {
      const old = schema.instructions.find(i => i.name === oldName)!, next = schema.instructions.find(i => i.name === newName)!;
      const keys = tx.transaction.message.accountKeys, ix = tx.transaction.message.instructions[0]!, data = fromBase58(ix.data);
      const values: Record<string, string> = { ...Object.fromEntries(old.accounts.map((name, i) => [name, keys[ix.accounts[i]!]!])),
        mint: bundle.mint, base_mint: bundle.mint, quote_mint: WSOL, token_program: TOKEN_2022, base_token_program: TOKEN_2022, quote_token_program: TOKEN,
        pool_base_token_account: canonical.identity.baseVault, pool_quote_token_account: canonical.identity.quoteVault };
      const children = tx.meta!.innerInstructions?.[0]?.instructions.map(child => ({ ...child, keys: child.accounts.map(i => keys[i]!) })) ?? [];
      const addresses = next.accounts.map(name => values[name] ?? keys[1]!);
      tx.transaction.message = { accountKeys: [PUMP, ...addresses], instructions: [{ programIdIndex: 0, accounts: addresses.map((_, i) => i + 1), data: toBase58(Uint8Array.from([...next.discriminator, ...data.slice(8)])) }] };
      tx.meta!.innerInstructions = children.length ? [{ index: 0, instructions: children.map(child => {
        const keys = tx.transaction.message.accountKeys, programIdIndex = keys.length; keys.push(AMM); const offset = keys.length; keys.push(...child.keys);
        return { programIdIndex, accounts: child.keys.map((_, i) => offset + i), data: child.data, stackHeight: child.stackHeight };
      }) }] : [];
    };
    remap(bundle.creation, "create", "create_v2"); remap(bundle.graduation, "migrate", "migrate_v2");
  }
  const migrationDefinition = schema.instructions.find(i => i.name === (token2022 ? "migrate_v2" : "migrate"))!;
  bundle.graduation.transaction.message.accountKeys[migrationDefinition.accounts.indexOf("lp_mint") + 1] = targets.migration.address;
  const child = bundle.graduation.meta!.innerInstructions![0]!.instructions[0]!;
  bundle.graduation.transaction.message.accountKeys[child.accounts[schema.create_pool.accounts.indexOf("lp_mint")]!] = targets.migration.address;
  sqlite.prepare("INSERT INTO tenx_jobs(id,kind,state,started_at) VALUES('canonical-original','canonical_attention_intake','succeeded',?)").run(observed.toISOString());
  sqlite.prepare("INSERT INTO tenx_canonical_intakes(address,utc_hour,job_id,plan_hash,plan,created_at) VALUES(?,?,'canonical-original',?,?,?)").run(bundle.mint, observed.toISOString().slice(0, 13), plan.plan_hash, JSON.stringify(plan), observed.toISOString());
  sqlite.prepare("INSERT INTO tenx_canonical_intake_receipts(address,receipt_hash,receipt,observed_at) VALUES(?,?,?,?)").run(bundle.mint, canonical.receipt_hash, JSON.stringify(canonical), observed.toISOString());
  sqlite.prepare("UPDATE tenx_quality_control SET lease_owner='target-owner',lease_until=? WHERE id=1").run(new Date(at.getTime() + 300000).toISOString());
  const transport = vi.fn<typeof fetch>(async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    expect(sqlite.prepare("SELECT count(*) n FROM tenx_attention_history_plans").get()!.n).toBeGreaterThan(0);
    let result: unknown = null;
    if (request.method === "getGenesisHash") result = MAINNET_GENESIS;
    if (request.method === "getSignaturesForAddress") {
      expect(request.params[1].limit).toBe(1000);
      result = request.params[0] === targets.migration.address ? [pageRow(bundle.graduation)] : request.params[0] === targets.creation.address ? [pageRow(bundle.creation)] : [pageRow(bundle.graduation), pageRow(bundle.creation)];
    }
    if (request.method === "getTransaction") result = [bundle.creation, bundle.graduation].find(tx => tx.transaction.signatures[0] === request.params[0]) ?? null;
    return Response.json({ jsonrpc: "2.0", id: request.id, result });
  });
  const settings: QualitySettings = { db, rpcUrl: "https://rpc.invalid", rpcDailyLimit: 5000, marketDailyLimit: 600, qualityEnabled: true, qualityDailyLimit: 1800, marketEnabled: false, transport };
  const collect = (remaining = 18, clock = () => at) => collectAttentionHistory(settings, "target-owner", remaining, clock, reserveQualityQuota(db, settings, clock()));
  return { sqlite, db, settings, bundle, plan, canonical, targets, transport, collect, queue, accounts };
}
it("declares future intake policy before collection and keeps old intake plans replayable", async () => {
  const { plan, canonical, queue, accounts, bundle } = await setup();
  expect(plan).toMatchObject({ version: "canonical-attention-intake-v2", history_targeting_policy_hash: await hashJson(TARGETED_HISTORY_POLICY) });
  expect(await planTargetedCanonicalIntake(queue, [bundle.mint])).toBeNull();
  const legacy = (await planCanonicalAttentionIntake(queue, []))!;
  expect(legacy.version).toBe("canonical-attention-intake-v1");
  expect(await reviewCanonicalAttentionState(legacy, accounts, canonical.observed_at)).toMatchObject({ current_pool_verified: true, historical_creation_proven: false });
  const broken = { ...plan, history_targeting_policy_hash: "0".repeat(64) };
  await expect(reviewCanonicalAttentionState(broken, accounts, canonical.observed_at)).rejects.toThrow("canonical_intake_policy_mismatch");
});
it("derives distinct canonical LP/metadata hints and uses the Token2022 mint instead of inventing separate metadata", async () => {
  const { canonical, targets } = await setup();
  expect(targets.migration.kind).toBe("pool_lp_mint"); expect(targets.creation.kind).toBe("classic_metadata");
  expect(new Set([targets.migration.address, targets.creation.address, canonical.address, canonical.identity.curve, canonical.identity.pool]).size).toBe(5);
  expect((await attentionHistoryTargets({ ...canonical.identity, baseProgram: TOKEN_2022 })).creation).toEqual({ kind: "token2022_mint", address: canonical.address });
  await expect(attentionHistoryTargets({ ...canonical.identity, baseProgram: METADATA_PROGRAM })).rejects.toThrow("history_target_token_program");
});
it("proves a synthetic older classic-token pair in two original targeted turns, preserving quotas and every admission gate", async () => {
  const { sqlite, db, canonical, bundle, collect, transport, targets } = await setup();
  expect(await collect()).toMatchObject({ state: "collected", rpc_calls: 3, historical_migration_proven: true, historical_creation_proven: false, candidate_admitted: false });
  const first = String(sqlite.prepare("SELECT receipt FROM tenx_attention_history_receipts").get()!.receipt);
  expect(await collect()).toMatchObject({ state: "collected", rpc_calls: 3, historical_pair_verified: true, candidate_admitted: false, scoring_effect: "none" });
  const replay = await replayAttentionHistory(db, bundle.mint, canonical);
  expect(replay.previous).toMatchObject({ version: "attention-history-receipt-v2", turn: 2, target_kind: "classic_metadata", historical_pair_verified: true, continuation_allowed: false });
  expect(replay.previous!.graduation!.proof.fetched_at).toBe(JSON.parse(first).graduation.proof.fetched_at);
  expect(replay.previous!.origin!.proof.signature).toBe(bundle.creation.transaction.signatures[0]);
  expect(sqlite.prepare("SELECT used FROM tenx_quality_usage").get()!.used).toBe(6); expect(sqlite.prepare("SELECT used FROM tenx_usage WHERE provider='rpc'").get()!.used).toBe(6);
  const pages = transport.mock.calls.map(c => JSON.parse(String(c[1]?.body))).filter(r => r.method === "getSignaturesForAddress");
  expect(pages.map(r => r.params[0])).toEqual([targets.migration.address, targets.creation.address]); expect(pages.every(r => !r.params[1].before)).toBe(true);
  const count = transport.mock.calls.length; expect(await collect()).toMatchObject({ state: "held", reason: "history_no_unspent_canonical_lead" }); expect(transport).toHaveBeenCalledTimes(count);
  for (const table of ["tenx_candidates", "tenx_leads", "tenx_proofs", "tenx_evidence", "tenx_holder_evidence", "tenx_score_cohorts"]) expect(sqlite.prepare(`SELECT count(*) n FROM ${table}`).get()!.n).toBe(0);
  for (const table of ["tenx_attention_history_plans", "tenx_attention_history_reads", "tenx_attention_history_receipts"]) expect(() => sqlite.exec(`DELETE FROM ${table}`)).toThrow("attention_history_immutable");
});
it("leaves an unattempted old cohort on its exact original curve policy", async () => {
  const { collect, transport, canonical, sqlite } = await setup(false);
  expect(await collect()).toMatchObject({ state: "collected", rpc_calls: 4, historical_pair_verified: true });
  const page = transport.mock.calls.map(c => JSON.parse(String(c[1]?.body))).find(r => r.method === "getSignaturesForAddress");
  expect(page.params[0]).toBe(canonical.identity.curve); expect(JSON.parse(String(sqlite.prepare("SELECT plan FROM tenx_attention_history_plans").get()!.plan)).version).toBe("attention-historical-proof-v1");
});
it("validates actual create_v2/migrate_v2 bodies for a synthetic Token2022 cohort using the original mint target", async () => {
  const { collect, canonical, bundle, db, transport } = await setup(true, true);
  expect(await collect()).toMatchObject({ historical_migration_proven: true, historical_creation_proven: false, rpc_calls: 3 });
  expect(await collect()).toMatchObject({ historical_pair_verified: true, rpc_calls: 3, candidate_admitted: false });
  const result = await replayAttentionHistory(db, bundle.mint, canonical);
  expect(result.previous).toMatchObject({ target_kind: "token2022_mint", target_address: bundle.mint, origin: { proof: { instruction: "create_v2" } }, graduation: { proof: { instruction: "migrate_v2" } } });
  expect(transport.mock.calls.map(c => JSON.parse(String(c[1]?.body))).filter(r => r.method === "getSignaturesForAddress").at(-1).params[0]).toBe(bundle.mint);
});
it("keeps a metadata update without a Pump creation instruction unknown even when the lookup address matches", async () => {
  const { collect, transport, bundle, db, canonical } = await setup(), original = transport.getMockImplementation()!;
  transport.mockImplementation(async (url, init) => { const r = JSON.parse(String(init?.body)); if (r.method === "getTransaction" && r.params[0] === bundle.creation.transaction.signatures[0]) { const update = structuredClone(bundle.creation); update.transaction.message.instructions = []; return Response.json({ jsonrpc: "2.0", id: r.id, result: update }); } return original(url, init); });
  await collect(); expect(await collect()).toMatchObject({ historical_creation_proven: false, historical_migration_proven: true, historical_pair_verified: false });
  expect((await replayAttentionHistory(db, bundle.mint, canonical)).previous).toMatchObject({ status: "unknown_within_bound", continuation_allowed: false, inspected: [{ outcome: "not_target_proof" }] });
});
it("never reopens an existing failed original mint under the new policy", async () => {
  const { canonical, sqlite, collect, transport } = await setup();
  const original = await planAttentionHistory(canonical, null, at.toISOString(), 1), id = "old-spent-history";
  sqlite.prepare("INSERT INTO tenx_jobs(id,kind,state,started_at,error_code,rpc_calls) VALUES(?,'attention_history','failed',?,'rpc_unavailable',1)").run(id, at.toISOString());
  sqlite.prepare("INSERT INTO tenx_attention_history_plans(id,address,utc_hour,hour_slot,turn,plan_hash,plan,created_at) VALUES(?,?,?,?,?,?,?,?)").run(id, canonical.address, at.toISOString().slice(0, 13), 1, 1, original.plan_hash, JSON.stringify(original), at.toISOString());
  expect(await collect()).toMatchObject({ state: "held", reason: "history_no_unspent_canonical_lead", rpc_calls: 0 }); expect(transport).not.toHaveBeenCalled();
  expect(sqlite.prepare("SELECT plan_hash FROM tenx_attention_history_plans").get()!.plan_hash).toBe(original.plan_hash);
});
it("continues only the original same-target cursor and starts the distinct creation target without that cursor", async () => {
  const { collect, transport, targets, bundle, db, canonical } = await setup(), original = transport.getMockImplementation()!;
  const first = Array.from({ length: 1000 }, (_, i): SignatureRow => ({ signature: signature(i + 100), slot: 29000 - i, blockTime: null, err: null, confirmationStatus: "finalized" }));
  transport.mockImplementation(async (url, init) => { const r = JSON.parse(String(init?.body)); if (r.method === "getSignaturesForAddress" && r.params[0] === targets.migration.address && !r.params[1].before) return Response.json({ jsonrpc: "2.0", id: r.id, result: first }); return original(url, init); });
  expect(await collect()).toMatchObject({ rpc_calls: 6, historical_pair_verified: false });
  expect(await collect()).toMatchObject({ rpc_calls: 3, historical_migration_proven: true });
  expect(await collect()).toMatchObject({ rpc_calls: 3, historical_pair_verified: true });
  const pages = transport.mock.calls.map(c => JSON.parse(String(c[1]?.body))).filter(r => r.method === "getSignaturesForAddress");
  expect(pages[1].params[1].before).toBe(first[999]!.signature); expect(pages[2].params[0]).toBe(targets.creation.address); expect(pages[2].params[1].before).toBeUndefined();
  expect((await replayAttentionHistory(db, bundle.mint, canonical)).previous!.turn).toBe(3);
});
it("allows cross-target signature overlap without requesting an already inspected body again", async () => {
  const { collect, transport, bundle, targets } = await setup(), original = transport.getMockImplementation()!;
  bundle.graduation.transaction.message.accountKeys.push(targets.creation.address);
  transport.mockImplementation(async (url, init) => { const r = JSON.parse(String(init?.body)); if (r.method === "getSignaturesForAddress" && r.params[0] === targets.creation.address) return Response.json({ jsonrpc: "2.0", id: r.id, result: [pageRow(bundle.graduation), pageRow(bundle.creation)] }); return original(url, init); });
  await collect(); expect(await collect()).toMatchObject({ rpc_calls: 3, historical_pair_verified: true });
  expect(transport.mock.calls.map(c => JSON.parse(String(c[1]?.body))).filter(r => r.method === "getTransaction" && r.params[0] === bundle.graduation.transaction.signatures[0])).toHaveLength(1);
});
it.each(["target", "signature", "slot", "time", "pool", "sibling"])("holds a targeted body with mismatched %s as spent rather than weakening proof", async kind => {
  const { collect, bundle, sqlite, transport, targets } = await setup();
  if (kind === "target") bundle.graduation.transaction.message.accountKeys = bundle.graduation.transaction.message.accountKeys.map(k => k === targets.migration.address ? bundle.mint : k);
  const original = transport.getMockImplementation()!;
  transport.mockImplementation(async (url, init) => { const r = JSON.parse(String(init?.body)); if (r.method !== "getTransaction") return original(url, init);
    const tx = structuredClone(bundle.graduation);
    if (kind === "signature") tx.transaction.signatures[0] = signature(9000);
    if (kind === "slot") tx.slot++;
    if (kind === "time") tx.blockTime!++;
    if (kind === "pool") tx.transaction.message.accountKeys[schema.instructions.find(i => i.name === "migrate")!.accounts.indexOf("pool") + 1] = bundle.mint;
    if (kind === "sibling") tx.meta!.innerInstructions = [];
    return Response.json({ jsonrpc: "2.0", id: r.id, result: tx });
  });
  expect(await collect()).toMatchObject({ state: "failed", receipt_saved: false, historical_pair_verified: false });
  const count = transport.mock.calls.length; expect(await collect()).toMatchObject({ state: "held", rpc_calls: 0 }); expect(transport).toHaveBeenCalledTimes(count);
  expect(sqlite.prepare("SELECT count(*) n FROM tenx_attention_history_receipts").get()!.n).toBe(0);
});
it.each(["pause", "owner", "backoff", "remaining", "quality", "global", "rate_limit", "day"])("preserves shared %s controls for the new target path", async kind => {
  const { sqlite, collect, transport } = await setup();
  if (kind === "pause") sqlite.exec("UPDATE tenx_control SET paused=1"); if (kind === "owner") sqlite.exec("UPDATE tenx_quality_control SET lease_owner='other'");
  if (kind === "backoff") sqlite.prepare("UPDATE tenx_control SET retry_after=?").run(new Date(at.getTime() + 60000).toISOString());
  if (kind === "quality") sqlite.prepare("INSERT INTO tenx_quality_usage(day,used) VALUES(?,1800)").run(at.toISOString().slice(0, 10));
  if (kind === "global") sqlite.prepare("INSERT INTO tenx_usage(provider,day,used) VALUES('rpc',?,5000)").run(at.toISOString().slice(0, 10));
  let now = at; const original = transport.getMockImplementation()!;
  transport.mockImplementation(async (url, init) => { const r = JSON.parse(String(init?.body)); if (kind === "rate_limit") return new Response(null, { status: 429, headers: { "retry-after": "300" } }); if (kind === "day") now = new Date("2026-10-24T00:00:00.000Z"); return original(url, init); });
  const result = await collect(kind === "remaining" ? 5 : 18, () => now);
  const spent = ["quality", "global", "rate_limit", "day"].includes(kind);
  expect(result).toMatchObject(spent ? { state: "failed", historical_pair_verified: false, receipt_saved: false } : { state: "held", rpc_calls: 0 });
  if (!spent || kind === "quality" || kind === "global") expect(transport).not.toHaveBeenCalled();
  if (kind === "rate_limit") expect(sqlite.prepare("SELECT retry_after FROM tenx_control").get()!.retry_after).toBe("2026-10-23T08:15:00.000Z");
  if (spent) { const count = transport.mock.calls.length; expect(await collect(18, () => at)).toMatchObject({ state: "held", rpc_calls: 0 }); expect(transport).toHaveBeenCalledTimes(count); }
});
it("stops after the same three-page and eighteen-call bound with missing bodies kept unknown", async () => {
  const { collect, transport, db, canonical, bundle, sqlite } = await setup(), original = transport.getMockImplementation()!; let page = 0;
  transport.mockImplementation(async (url, init) => { const r = JSON.parse(String(init?.body)); if (r.method === "getSignaturesForAddress") { const offset = page++ * 1000; return Response.json({ jsonrpc: "2.0", id: r.id, result: Array.from({ length: 1000 }, (_, i) => ({ signature: signature(offset + i + 100), slot: 29000 - offset - i, blockTime: null, err: null, confirmationStatus: "finalized" })) }); } return original(url, init); });
  for (let i = 0; i < 3; i++) expect(await collect()).toMatchObject({ state: "collected", rpc_calls: 6, historical_pair_verified: false });
  const replay = await replayAttentionHistory(db, bundle.mint, canonical); expect(replay.previous).toMatchObject({ status: "unknown_within_bound", turn: 3, continuation_allowed: false });
  expect(replay.seen).toHaveLength(3000); expect(sqlite.prepare("SELECT used FROM tenx_quality_usage").get()!.used).toBe(18);
  expect(await collect()).toMatchObject({ state: "held", reason: "history_hour_spent", rpc_calls: 0 });
});
it("rejects altered target plans and prevents a legacy receipt being adopted as a fresh v2 parent", async () => {
  const { canonical } = await setup(), plan = await planTargetedAttentionHistory(canonical, null, at.toISOString(), 1);
  const reads = [await historyObservation(0, { method: "getSignaturesForAddress", params: [plan.target_address, { commitment: "finalized", limit: 1000 }] }, [], null, at.toISOString())];
  for (const alteration of [{ target_address: canonical.address }, { canonical_intake_plan_hash: "0".repeat(64) }, { policy_hash: "0".repeat(64) }]) await expect(reviewAttentionHistory({ ...plan, ...alteration }, canonical, null, [], reads, at.toISOString())).rejects.toThrow("history_plan_mismatch");
  const receipt = await reviewAttentionHistory(plan, canonical, null, [], reads, at.toISOString());
  const { receipt_hash: _hash, ...body } = { ...receipt, version: "attention-history-receipt-v1" as const };
  const legacy: HistoryReceipt = { ...body, receipt_hash: await hashJson(body) };
  await expect(planTargetedAttentionHistory(canonical, legacy, at.toISOString(), 2)).rejects.toThrow("history_parent_unusable");
  expect(() => selectHistoryBodies(plan, [], [], at.toISOString(), Array(9).fill(signature(1)))).toThrow();
});
