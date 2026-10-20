import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import recorded from "../fixtures/recorded/v1-wallet-funding.json";
import { analyzeWalletEvidence, type WalletEvidence } from "./wallet-analysis";
import { FundingScanSchema } from "./funding-history";
import { WalletTransactionSchema } from "./wallet-rpc";
import { fixtureCandidates } from "./fixtures";
import { saveCandidate } from "./store";
import { hashJson, toBase58 } from "./solana";
import { key, signature, walletInput } from "./wallet-fixtures.test-helper";
import { compareWalletPlans, walletPlan } from "./wallet-plan";
import { continueCachedFunding } from "./funding-cache-work";
import { runWalletCycle } from "./wallet-cycle";
import { assess, DEFAULT_POLICY } from "./model";
import { MAINNET_GENESIS } from "./rpc";

const opened: DatabaseSync[] = [], now = new Date(recorded.recorded_at);
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); });
afterEach(() => { opened.splice(0).forEach(db => db.close()); vi.useRealTimers(); vi.restoreAllMocks(); });
async function setup(marker = false) {
  const sqlite = new DatabaseSync(":memory:"); opened.push(sqlite);
  for (const name of readdirSync(new URL("../migrations/", import.meta.url)).filter(n => n.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  const db = sqliteD1(sqlite), base = (await fixtureCandidates(now))[0]!;
  const tx = WalletTransactionSchema.parse(recorded.transaction), anchorTx = WalletTransactionSchema.parse(recorded.anchor_transaction);
  const scan = FundingScanSchema.parse({ wallet: recorded.anchor.wallet, anchor: recorded.anchor, lookback_seconds: 3600, attempted_at: recorded.recorded_at,
    pages: [{ before: recorded.anchor.signature, fetched_at: recorded.recorded_at, rows: [
      { signature: recorded.signature, slot: tx.slot, blockTime: tx.blockTime, err: null, confirmationStatus: "finalized" },
      { signature: signature(210), slot: tx.slot - 20, blockTime: Date.parse(recorded.anchor.block_time) / 1000 - 3601, err: null, confirmationStatus: "finalized" },
    ] }], examined: marker ? [{ signature: recorded.signature, status: "unsupported" }] : [] });
  const input: WalletEvidence = { version: "wallet-input-v4", observed_at: recorded.recorded_at, cluster: MAINNET_GENESIS,
    asset: { address: recorded.mint, pool: recorded.pool, token_program: base.risk.token_program, creation: base.creation, graduation: base.graduation },
    records: [{ signature: recorded.anchor.signature, transaction: anchorTx, fetched_at: recorded.recorded_at, status: "available", purposes: ["recent"] }],
    histories: [], holders: null, prior_losses: [], gaps: [], funding_scans: [scan], second_hop_scans: [] };
  if (marker) input.records.push({ signature: recorded.signature, transaction: null, fetched_at: recorded.recorded_at, status: "unsupported", purposes: ["wallet"] });
  const analysis = await analyzeWalletEvidence(input), candidate = { ...base, address: recorded.mint, pool: recorded.pool, mode: "live" as const, wallet_analysis: analysis, holders: null };
  await saveCandidate(db, candidate);
  await db.prepare("INSERT INTO tenx_wallet_evidence VALUES(?,?,?,?)").bind(analysis.evidence_hash, candidate.address, JSON.stringify(input), input.observed_at).run();
  const checkpoint = async () => { const normalized = FundingScanSchema.parse(scan); await db.prepare("INSERT INTO tenx_funding_scans VALUES(?,?,?,?,?,?) ON CONFLICT(address,wallet,anchor_signature) DO UPDATE SET payload=excluded.payload,payload_hash=excluded.payload_hash").bind(candidate.address, scan.wallet, scan.anchor.signature, JSON.stringify(normalized), await hashJson(normalized), scan.attempted_at).run(); };
  await checkpoint();
  await db.prepare("INSERT INTO tenx_wallet_transactions VALUES(?,?,?,?)").bind(recorded.signature, recorded.transaction_hash, JSON.stringify(tx), recorded.recorded_at).run();
  const owner = () => db.prepare("UPDATE tenx_wallet_control SET lease_owner='test-owner',lease_until=? WHERE id=1").bind(new Date(now.getTime() + 360000).toISOString()).run();
  const transport = vi.fn(async () => { throw Error("provider forbidden"); });
  const settings = { db, rpcUrl: "https://offline.invalid", rpcDailyLimit: 5000, walletDailyLimit: 800, marketDailyLimit: 600, walletEnabled: true, marketEnabled: false, transport };
  return { db, sqlite, scan, tx, input, candidate, checkpoint, owner, settings, transport };
}

it.each([false, true])("automatically consumes verified cached evidence with zero quota use (old marker %s)", async marker => {
  const f = await setup(marker), network = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("network forbidden"));
  const before = f.sqlite.prepare("SELECT total_changes() AS n").get();
  expect(await walletPlan(f.db, f.candidate, now)).toMatchObject({ stage: "cached_funding", minimum_rpc_calls: 0, examined_windows: 0, cached_recoverable_markers: marker ? 1 : 0, cached_pending_bodies: marker ? 0 : 1 });
  expect(f.sqlite.prepare("SELECT total_changes() AS n").get()).toEqual(before);
  const plan = await walletPlan(f.db, f.candidate, now);
  expect(compareWalletPlans({candidate:f.candidate,plan},{candidate:f.candidate,plan:{...plan,stage:"refresh_required",minimum_rpc_calls:null}},now)).toBeLessThan(0);
  const snapshot = f.sqlite.prepare("SELECT payload FROM tenx_candidates").get(), eligibility = assess(f.candidate, DEFAULT_POLICY, now);
  expect(await runWalletCycle(f.settings, f.candidate.address, now)).toMatchObject({ state: "progressed", rpc_calls: 0, source: "verified_cache", snapshot_updated: false, progress: { stage: "refresh_required", examined_windows: 1 } });
  expect(f.sqlite.prepare("SELECT payload FROM tenx_candidates").get()).toEqual(snapshot);
  expect(assess(f.candidate, DEFAULT_POLICY, now)).toEqual(eligibility);
  expect(await analyzeWalletEvidence(f.input)).toEqual(f.candidate.wallet_analysis);
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM tenx_wallet_usage").get()).toEqual({ n: 0 });
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM tenx_usage").get()).toEqual({ n: 0 });
  expect(f.sqlite.prepare("SELECT rpc_calls,completed_windows FROM tenx_wallet_runs").get()).toEqual({ rpc_calls: 0, completed_windows: 1 });
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM tenx_wallet_profiles").get()).toEqual({ n: 0 });
  expect((await walletPlan(f.db, f.candidate, now)).stage).toBe("refresh_required");
  expect(f.transport).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
});

it("can finish cached work with exhausted source allowances without replenishing any counter", async () => {
  const f = await setup();
  f.sqlite.exec(`INSERT INTO tenx_wallet_usage VALUES('${recorded.recorded_at.slice(0, 10)}',800); INSERT INTO tenx_usage VALUES('rpc','${recorded.recorded_at.slice(0, 10)}',5000); INSERT INTO tenx_usage VALUES('wallet_catchup','${recorded.recorded_at.slice(0, 10)}',180)`);
  const before = f.sqlite.prepare("SELECT * FROM tenx_usage ORDER BY provider").all();
  expect(await runWalletCycle(f.settings, f.candidate.address, now)).toMatchObject({ state: "progressed", rpc_calls: 0 });
  expect(f.sqlite.prepare("SELECT * FROM tenx_usage ORDER BY provider").all()).toEqual(before);
  expect(f.sqlite.prepare("SELECT used FROM tenx_wallet_usage").get()).toEqual({ used: 800 });
  expect(f.transport).not.toHaveBeenCalled();
});

it("does not turn cache progress into a claim that the RPC source recovered", async () => {
  const f = await setup();
  f.sqlite.exec("UPDATE tenx_wallet_control SET last_error='rpc_unavailable',last_success='2026-10-19T00:00:00.000Z'");
  expect(await runWalletCycle(f.settings,f.candidate.address,now)).toMatchObject({state:"progressed",rpc_calls:0});
  expect(f.sqlite.prepare("SELECT last_error,last_success FROM tenx_wallet_control").get()).toEqual({last_error:"rpc_unavailable",last_success:"2026-10-19T00:00:00.000Z"});
});

it.each(["hash", "signature", "slot", "time", "future", "wallet", "failed"])("rejects corrupt %s cache evidence before checkpoint writes", async failure => {
  const f = await setup(), tx = structuredClone(f.tx);
  if (failure === "signature") tx.transaction.signatures[0] = signature(211);
  if (failure === "slot") tx.slot++;
  if (failure === "time") tx.blockTime!++;
  if (failure === "wallet") tx.transaction.message.accountKeys = tx.transaction.message.accountKeys.map(k => k === f.scan.wallet ? "11111111111111111111111111111111" : k);
  if (failure === "failed") tx.meta!.err = { failed: true };
  await f.db.prepare("UPDATE tenx_wallet_transactions SET payload=?,payload_hash=?,fetched_at=?").bind(JSON.stringify(tx), failure === "hash" ? "a".repeat(64) : await hashJson(tx), failure === "future" ? new Date(now.getTime() + 1).toISOString() : recorded.recorded_at).run();
  const before = f.sqlite.prepare("SELECT * FROM tenx_funding_scans").all();
  expect((await walletPlan(f.db, f.candidate, now)).stage).toBe("cache_invalid");
  await f.owner(); await expect(continueCachedFunding(f.db, f.candidate, "test-owner", now)).rejects.toThrow();
  expect(f.sqlite.prepare("SELECT * FROM tenx_funding_scans").all()).toEqual(before); expect(f.transport).not.toHaveBeenCalled();
});

it.each(["checkpoint", "candidate", "owner", "expiry"])("does not overwrite a changed %s during cache adoption", async change => {
  const f = await setup(); await f.owner();
  const prepare = f.db.prepare.bind(f.db); let changed = false;
  vi.spyOn(f.db, "prepare").mockImplementation(sql => {
    if (sql.startsWith("UPDATE tenx_funding_scans") && !changed) {
      changed = true;
      if (change === "checkpoint") f.sqlite.exec("UPDATE tenx_funding_scans SET payload_hash='changed'");
      if (change === "candidate") f.sqlite.exec("UPDATE tenx_candidates SET payload=json_set(payload,'$.wallet_analysis.evidence_hash','changed')");
      if (change === "owner") f.sqlite.exec("UPDATE tenx_wallet_control SET lease_owner='new-owner'");
      if (change === "expiry") f.sqlite.exec("UPDATE tenx_wallet_control SET lease_until='1970-01-01T00:00:00.000Z'");
    }
    return prepare(sql);
  });
  await expect(continueCachedFunding(f.db, f.candidate, "test-owner", now)).rejects.toThrow("funding_cache_checkpoint_or_owner_changed");
  expect(JSON.parse(String(f.sqlite.prepare("SELECT payload FROM tenx_funding_scans").get()!.payload)).examined).toEqual([]);
});

it.each(["pause", "backoff", "not_contender"])("keeps %s collection guards in force for cache work", async guard => {
  const f = await setup();
  if (guard === "pause") f.sqlite.exec("UPDATE tenx_control SET paused=1");
  if (guard === "backoff") f.sqlite.prepare("UPDATE tenx_control SET retry_after=?,last_error='rpc_rate_limited'").run(new Date(now.getTime() + 300000).toISOString());
  if (guard === "not_contender") { const old = { ...f.candidate, verification: "rejected" as const }; await saveCandidate(f.db, old); }
  const before = f.sqlite.prepare("SELECT * FROM tenx_funding_scans").all();
  expect((await runWalletCycle(f.settings, f.candidate.address, now)).state).not.toBe("progressed");
  expect(f.sqlite.prepare("SELECT * FROM tenx_funding_scans").all()).toEqual(before); expect(f.transport).not.toHaveBeenCalled();
});

it("cannot replace a missing one-hour archive boundary with cache availability", async () => {
  const f = await setup(); f.scan.pages[0]!.rows.pop(); f.scan.pages.push({ before: recorded.signature, fetched_at: recorded.recorded_at, rows: [] }); await f.checkpoint();
  expect(await walletPlan(f.db, f.candidate, now)).toMatchObject({ stage: "source_limited", gaps: expect.arrayContaining(["provider_history_ended_before_window_boundary"]) });
  expect(await runWalletCycle(f.settings, f.candidate.address, now)).toMatchObject({ state: "waiting", rpc_calls: 0 });
  expect(f.transport).not.toHaveBeenCalled();
});

it("does not use a cached body to bypass the twelve-body window bound", async () => {
  const f = await setup();
  f.scan.pages[0]!.rows.splice(1,0,...Array.from({length:12},(_,n)=>({signature:signature(140+n),slot:f.tx.slot-n-1,blockTime:f.tx.blockTime!-n-1,err:null,confirmationStatus:"finalized" as const})));
  await f.checkpoint();
  expect(await walletPlan(f.db,f.candidate,now)).toMatchObject({stage:"source_limited",minimum_rpc_calls:null,gaps:expect.arrayContaining(["funding_window_exceeds_transaction_bound"])});
  expect(await runWalletCycle(f.settings,f.candidate.address,now)).toMatchObject({state:"waiting",rpc_calls:0});
  expect(JSON.parse(String(f.sqlite.prepare("SELECT payload FROM tenx_funding_scans").get()!.payload)).examined).toEqual([]);
});

it("bounds each cache turn to three bodies while another wallet's archive gap stays blocking", async () => {
  const f = await setup(), input: WalletEvidence = { ...await walletInput(), version: "wallet-input-v4", funding_scans: [], second_hop_scans: [] };
  const at = new Date(input.observed_at); vi.setSystemTime(at);
  // The setup's separate candidate uses the same synthetic graduation proof.
  // This isolated exercise replaces its fixture inventory, never a live store.
  f.sqlite.exec("DELETE FROM tenx_proofs; DELETE FROM tenx_candidates;");
  const base = (await fixtureCandidates(at))[0]!; input.asset.graduation = base.graduation;
  input.funding_scans = input.records.map((r, i) => FundingScanSchema.parse({ wallet: key(7+i), anchor: { wallet: key(7+i), signature: r.signature, slot: r.transaction!.slot, block_time: new Date(r.transaction!.blockTime!*1000).toISOString(), kind: i ? "sampled_buy" : "signed_creation" },
    lookback_seconds: 3600, attempted_at: input.observed_at, examined: [], pages: [{ before: r.signature, fetched_at: input.observed_at, rows: i ? [{ signature: signature(160+i), slot: r.transaction!.slot-30, blockTime: r.transaction!.blockTime!-3601, err:null, confirmationStatus:"finalized" }] : [] }] }));
  const scan = input.funding_scans[1]!;
  for (let n=0;n<7;n++) {
    const data = new Uint8Array(12); new DataView(data.buffer).setUint32(0,2,true); new DataView(data.buffer).setBigUint64(4,1n,true);
    const tx = WalletTransactionSchema.parse({version:0,slot:scan.anchor.slot-1-n,blockTime:Date.parse(scan.anchor.block_time)/1000-10-n,
      transaction:{signatures:[signature(92+n)],message:{header:{numRequiredSignatures:1},accountKeys:[key(20),scan.wallet,"11111111111111111111111111111111"],instructions:[{programIdIndex:2,accounts:[0,1],data:toBase58(data)}]}},
      meta:{err:null,fee:5000,innerInstructions:[],loadedAddresses:{writable:[],readonly:[]},preTokenBalances:[],postTokenBalances:[],preBalances:[10000,10000,1],postBalances:[4999,10001,1]}});
    scan.pages[0]!.rows.splice(n,0,{signature:signature(92+n),slot:tx.slot,blockTime:tx.blockTime,err:null,confirmationStatus:"finalized"});
    await f.db.prepare("INSERT INTO tenx_wallet_transactions VALUES(?,?,?,?)").bind(signature(92+n),await hashJson(tx),JSON.stringify(tx),input.observed_at).run();
  }
  input.funding_scans = input.funding_scans.map(s => FundingScanSchema.parse(s));
  const analysis = await analyzeWalletEvidence(input), candidate = { ...base, address:input.asset.address, pool:input.asset.pool, creation:input.asset.creation, wallet_analysis:analysis, mode:"live" as const, holders:null };
  await saveCandidate(f.db,candidate); await f.db.prepare("INSERT INTO tenx_wallet_evidence VALUES(?,?,?,?)").bind(analysis.evidence_hash,candidate.address,JSON.stringify(input),input.observed_at).run();
  for (const s of input.funding_scans) await f.db.prepare("INSERT INTO tenx_funding_scans VALUES(?,?,?,?,?,?)").bind(candidate.address,s.wallet,s.anchor.signature,JSON.stringify(s),await hashJson(s),s.attempted_at).run();
  const original = f.sqlite.prepare("SELECT payload FROM tenx_candidates WHERE address=?").get(candidate.address);
  for (const [turn, decoded] of [3,6,7].entries()) {
    const plan = await walletPlan(f.db,candidate,at);
    expect(plan,JSON.stringify(plan)).toMatchObject({stage:"cached_funding",minimum_rpc_calls:0,cached_pending_bodies:turn===2?1:3,blocked_windows:1});
    await f.owner();
    const work = await continueCachedFunding(f.db,candidate,"test-owner",at);
    expect(work).toMatchObject({rpc_calls:0,stage:"source_limited",examined_windows:turn===2?3:2,decoded_transactions:decoded});
    expect(work.gaps).toContain("provider_history_ended_before_window_boundary");
  }
  expect((await walletPlan(f.db,candidate,at)).stage).toBe("source_limited");
  expect(f.sqlite.prepare("SELECT payload FROM tenx_candidates WHERE address=?").get(candidate.address)).toEqual(original);
  expect(f.transport).not.toHaveBeenCalled();
});

it("does not claim progress or change another owner's schedule when ownership changes before the receipt", async () => {
  const f = await setup(), prepare=f.db.prepare.bind(f.db); let changed=false;
  const next = new Date(now.getTime()+900000).toISOString();
  vi.spyOn(f.db,"prepare").mockImplementation(sql=>{
    if(sql.startsWith("INSERT INTO tenx_wallet_work")&&!changed){ changed=true; f.sqlite.prepare("UPDATE tenx_wallet_control SET lease_owner='replacement',next_refresh_at=?").run(next); }
    return prepare(sql);
  });
  expect(await runWalletCycle(f.settings,f.candidate.address,now)).toMatchObject({state:"waiting",reason:"funding_cache_checkpoint_or_owner_changed",rpc_calls:0});
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM tenx_wallet_work").get()).toEqual({n:0});
  expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM tenx_wallet_runs").get()).toEqual({n:0});
  expect(f.sqlite.prepare("SELECT lease_owner,next_refresh_at FROM tenx_wallet_control").get()).toEqual({lease_owner:"replacement",next_refresh_at:next});
});
