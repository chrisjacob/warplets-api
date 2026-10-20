import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import { analyzeWalletEvidence, type WalletEvidence } from "./wallet-analysis";
import { walletInput, key, signature, trade } from "./wallet-fixtures.test-helper";
import { fixtureCandidates } from "./fixtures";
import { saveCandidate } from "./store";
import { hashJson, toBase58 } from "./solana";
import { WalletTransactionSchema } from "./wallet-rpc";
import { buildSecondHopOutflows, secondHopAnchors } from "./second-hop";
import { MAINNET_GENESIS, RpcClient } from "./rpc";
import { claimFundingRecovery, finishFundingRecovery, fundingRecoveryCandidates, fundingRecoveryStatus, recordUnsupportedFundingRead, recoverFundingBodies, type FundingRecovery } from "./funding-recovery";
import { FundingScanSchema, type FundingScan } from "./funding-history";
import { TRANSACTION_READER_VERSION } from "./inbox-recovery-model";
import { walletPlan } from "./wallet-plan";
import { runWalletCycle } from "./wallet-cycle";
import { priorWalletEvidence } from "./wallet-work";
import { assess, DEFAULT_POLICY } from "./model";

const opened: DatabaseSync[] = [], now = new Date("2026-10-20T00:01:00.000Z");
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); });
afterEach(() => { opened.splice(0).forEach(db => db.close()); vi.useRealTimers(); vi.restoreAllMocks(); });
async function setup(second = false, legacy = false) {
  const sqlite = new DatabaseSync(":memory:"); opened.push(sqlite);
  for (const f of readdirSync(new URL("../migrations/", import.meta.url)).filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  const db = sqliteD1(sqlite), input: WalletEvidence = { ...await walletInput(), version: "wallet-input-v4", funding_scans: [], second_hop_scans: [] };
  const scans: FundingScan[] = input.records.map((r, i) => FundingScanSchema.parse({ wallet: key(7 + i), anchor: { wallet: key(7 + i), signature: r.signature, slot: r.transaction!.slot, block_time: new Date(r.transaction!.blockTime! * 1000).toISOString(), kind: i ? "sampled_buy" : "signed_creation" }, lookback_seconds: 3600,
    pages: [{ before: r.signature, fetched_at: input.observed_at, rows: [{ signature: signature(130 + i), slot: r.transaction!.slot - 2, blockTime: r.transaction!.blockTime! - 3601, err: null, confirmationStatus: "finalized" }] }], examined: [], attempted_at: input.observed_at }));
  let scan = structuredClone(scans[0]!);
  if (second) {
    const bytes=new Uint8Array(12);new DataView(bytes.buffer).setUint32(0,2,true);new DataView(bytes.buffer).setBigUint64(4,1000n,true);
    const addresses=[key(20),key(7),"11111111111111111111111111111111"];
    const downstream=WalletTransactionSchema.parse({version:0,slot:9999,blockTime:Date.parse(scan.anchor.block_time)/1000-5,
      transaction:{signatures:[signature(91)],message:{header:{numRequiredSignatures:1},accountKeys:addresses,instructions:[...Array.from({length:3},()=>({programIdIndex:2,accounts:[],data:"1"})),{programIdIndex:2,accounts:[0,1],data:toBase58(bytes)}]}},
      meta:{err:null,fee:5000,innerInstructions:[],loadedAddresses:{writable:[],readonly:[]},preTokenBalances:[],postTokenBalances:[],preBalances:[10000,10000,1],postBalances:[4000,11000,1]}});
    input.records.push({signature:signature(91),fetched_at:input.observed_at,status:"available",purposes:["wallet"],transaction:downstream});
    scans[0]!.pages[0]!.rows.unshift({signature:signature(91),slot:downstream.slot,blockTime:downstream.blockTime,err:null,confirmationStatus:"finalized"});scans[0]!.examined=[{signature:signature(91),status:"available"}];
    const outflows=await buildSecondHopOutflows(input.records.map(r=>r.transaction!),input.asset.address,input.asset.pool,input.asset.creation!.slot,new Set([key(7)]),scans.map(s=>s.anchor),true);
    const anchor=secondHopAnchors(outflows,new Set([key(7)]))[0]!;
    scan=FundingScanSchema.parse({...scan,wallet:anchor.wallet,anchor,pages:[{before:anchor.signature,fetched_at:input.observed_at,rows:[{signature:signature(135),slot:anchor.slot-2,blockTime:Date.parse(anchor.block_time)/1000-3601,err:null,confirmationStatus:"finalized"}]}]});
  }
  const tx = await trade(scan.wallet, scan.anchor.slot - 1, "buy", 92); tx.blockTime = Date.parse(scan.anchor.block_time) / 1000 - 10;
  scan.pages[0]!.rows.unshift({ signature: signature(92), slot: tx.slot, blockTime: tx.blockTime, err: null, confirmationStatus: "finalized" });
  scan.examined = [{ signature: signature(92), status: "unsupported" }];
  scan=FundingScanSchema.parse(scan);
  input.funding_scans = second ? scans : [scan, ...scans.slice(1)];
  // Offline synthetic outflows above pass the same anchor decoder as live data.
  input.second_hop_scans = second ? [scan] : [];
  const analysis = await analyzeWalletEvidence(input);
  const candidate = { ...(await fixtureCandidates(now))[0]!, creation: input.asset.creation, mode: "live" as const, wallet_analysis: analysis, holders: null };
  const anchorKey = second && !legacy ? `${scan.anchor.signature}:3` : scan.anchor.signature;
  const checkpoint = async (s: FundingScan, hop = second) => {
    const normalized = FundingScanSchema.parse(s), table = hop ? "tenx_second_hop_scans" : "tenx_funding_scans";
    await db.prepare(`INSERT INTO ${table}(address,wallet,anchor_signature,payload,payload_hash,attempted_at) VALUES(?,?,?,?,?,?) ON CONFLICT(address,wallet,anchor_signature) DO UPDATE SET payload=excluded.payload,payload_hash=excluded.payload_hash,attempted_at=excluded.attempted_at`)
      .bind(candidate.address, s.wallet, hop ? legacy ? s.anchor.signature : `${s.anchor.signature}:${s.anchor.instruction_index}` : s.anchor.signature, JSON.stringify(normalized), await hashJson(normalized), s.attempted_at).run();
  };
  await saveCandidate(db, candidate);
  await db.prepare("INSERT INTO tenx_wallet_evidence(payload_hash,address,payload,observed_at) VALUES(?,?,?,?)").bind(analysis.evidence_hash, candidate.address, JSON.stringify(input), input.observed_at).run();
  for (const s of input.funding_scans!) await checkpoint(s, false);
  if (second) await checkpoint(scan);
  const row: FundingRecovery = { signature: signature(92), slot: tx.slot, blockTime: tx.blockTime!, hop: second ? "second" : "direct", wallet: scan.wallet, anchor_key: anchorKey, checkpoint_hash: await hashJson(scan) };
  const owner = async (job = "job") => db.prepare("UPDATE tenx_wallet_control SET lease_owner=?,lease_until=? WHERE id=1").bind(job, new Date(now.getTime() + 360000).toISOString()).run();
  const transport = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const b = JSON.parse(String(init?.body));
    return Response.json({ jsonrpc: "2.0", id: b.id, result: b.method === "getGenesisHash" ? MAINNET_GENESIS : tx });
  });
  const settings = { db, rpcUrl: "https://rpc.example", rpcDailyLimit: 5000, walletDailyLimit: 800, marketDailyLimit: 600, walletEnabled: true, marketEnabled: false, transport };
  const rpc = () => new RpcClient(settings.rpcUrl, async () => {}, transport, 18);
  return { db, sqlite, input, candidate, scan, tx, row, checkpoint, owner, transport, rpc, settings };
}

it("plans one otherwise-finishable unsupported body without writes or provider requests", async () => {
  const f = await setup(), before = f.sqlite.prepare("SELECT total_changes() AS n").get();
  expect(await fundingRecoveryCandidates(f.db, f.candidate, f.input, now)).toEqual([f.row]);
  expect(await walletPlan(f.db, f.candidate, now)).toMatchObject({ stage: "reader_recovery", source_recoverable_markers: 1, minimum_rpc_calls: 2 });
  expect(f.sqlite.prepare("SELECT total_changes() AS n").get()).toEqual(before); expect(f.transport).not.toHaveBeenCalled();
});
it("replays retained available bodies before purchasing any recovery read",async()=>{
  const f=await setup(),scan=structuredClone(f.scan),tx=await trade(scan.wallet,f.row.slot,"buy",93);
  tx.blockTime=f.row.blockTime;scan.pages[0]!.rows.splice(1,0,{signature:signature(93),slot:tx.slot,blockTime:tx.blockTime,err:null,confirmationStatus:"finalized"});scan.examined.push({signature:signature(93),status:"available"});await f.checkpoint(scan);
  await expect(fundingRecoveryCandidates(f.db,f.candidate,f.input,now)).rejects.toThrow("wallet_checkpoint_body_missing");
  await f.db.prepare("INSERT INTO tenx_wallet_transactions VALUES(?,?,?,?)").bind(signature(93),"a".repeat(64),JSON.stringify(tx),now.toISOString()).run();
  expect(await walletPlan(f.db,f.candidate,now)).toMatchObject({stage:"cache_invalid",gaps:["wallet_cache_hash_or_identity_mismatch"]});
  expect(await runWalletCycle(f.settings,undefined,now)).toMatchObject({state:"empty"});expect(f.transport).not.toHaveBeenCalled();expect((await fundingRecoveryStatus(f.db,now)).used_today).toBe(0);
});
it.each([false, true])("keeps second-hop recovery bound to its exact instruction (legacy key %s)", async legacy => {
  const f = await setup(true, legacy);
  expect(await fundingRecoveryCandidates(f.db, f.candidate, f.input, now)).toEqual([f.row]);
  const different = structuredClone(f.input); different.second_hop_scans![0]!.anchor.instruction_index = 4;
  expect(await fundingRecoveryCandidates(f.db, f.candidate, different, now)).toEqual([]);
  await f.owner(); expect(await recoverFundingBodies(f.db, f.candidate, f.input, f.rpc(), "job", now)).toEqual({ attempted: 1, recovered: 1 });
  expect((await fundingRecoveryStatus(f.db, now)).recent[0]).toMatchObject({ hop: "second", state: "finished", outcome: "available", payload_hash: await hashJson(f.tx) });
});
it("does not retry terminal reads made by the current reader, even the next day", async () => {
  const f = await setup(); await recordUnsupportedFundingRead(f.db, f.row.signature, f.row.slot, "unsupported_transaction_version", now);
  expect(await fundingRecoveryCandidates(f.db, f.candidate, f.input, now)).toEqual([]);
  expect(await fundingRecoveryCandidates(f.db, f.candidate, f.input, new Date(now.getTime() + 86400000))).toEqual([]);
  expect(await fundingRecoveryStatus(f.db, now)).toMatchObject({ used_today: 0, remaining_today: 20, recent: [], provider_requests: 0 });
});
it("admits an older reader rejection without replacing its original receipt",async()=>{
  const f=await setup();
  await f.db.prepare("INSERT INTO tenx_funding_reads(signature,reader_version,expected_slot,is_recovery,started_at,finished_at,state,outcome) VALUES(?,?,?,0,?,?,'finished','unsupported_transaction_version')")
    .bind(f.row.signature,"older-reader",f.row.slot,now.toISOString(),now.toISOString()).run();
  expect(await fundingRecoveryCandidates(f.db,f.candidate,f.input,now)).toEqual([f.row]);
  await f.owner();expect(await recoverFundingBodies(f.db,f.candidate,f.input,f.rpc(),"job",now)).toEqual({attempted:1,recovered:1});
  expect(await f.db.prepare("SELECT reader_version,outcome FROM tenx_funding_reads ORDER BY reader_version").all()).toMatchObject({results:[{reader_version:"older-reader",outcome:"unsupported_transaction_version"},{reader_version:TRANSACTION_READER_VERSION,outcome:"available"}]});
});
it("passes supported v1 source validation before caching a recovered body",async()=>{
  const f=await setup(),raw={...f.tx,version:1,transaction:{...f.tx.transaction,message:{...f.tx.transaction.message,transactionConfig:{priorityFee:null,computeUnitLimit:null,loadedAccountsDataSizeLimit:null,heapSize:null},header:{...f.tx.transaction.message.header,numReadonlySignedAccounts:0,numReadonlyUnsignedAccounts:1}}}};
  f.transport.mockImplementation(async(_url,init)=>{const b=JSON.parse(String(init?.body));return Response.json({jsonrpc:"2.0",id:b.id,result:b.method==="getGenesisHash"?MAINNET_GENESIS:raw});});
  await f.owner();expect(await recoverFundingBodies(f.db,f.candidate,f.input,f.rpc(),"job",now)).toEqual({attempted:1,recovered:1});
  const saved=await f.db.prepare("SELECT payload,payload_hash FROM tenx_wallet_transactions").first<{payload:string;payload_hash:string}>();
  expect(JSON.parse(saved!.payload).version).toBe(1);expect(await hashJson(WalletTransactionSchema.parse(JSON.parse(saved!.payload)))).toBe(saved!.payload_hash);
});
it.each(["checkpoint","candidate","paused"])("retains an interrupted receipt if %s changes during the source read",async fault=>{
  const f=await setup();await f.owner();await claimFundingRecovery(f.db,f.candidate,f.row,"job",now);
  if(fault==="checkpoint")await f.db.prepare("UPDATE tenx_funding_scans SET payload_hash='changed'").run();
  if(fault==="candidate")await f.db.prepare("UPDATE tenx_candidates SET payload=json_set(payload,'$.wallet_analysis.evidence_hash','changed')").run();
  if(fault==="paused")await f.db.prepare("UPDATE tenx_control SET paused=1").run();
  expect(await finishFundingRecovery(f.db,f.row,"job","available",f.tx,now)).toBe(false);
  expect((await fundingRecoveryStatus(f.db,now)).recent[0]).toMatchObject({state:"reading",payload_hash:null});
  expect(await f.db.prepare("SELECT * FROM tenx_wallet_transactions").all()).toMatchObject({results:[]});
});
it("propagates a recovery rate limit into shared backoff without repeating its body",async()=>{
  const f=await setup();f.transport.mockImplementation(async(_url,init)=>{const b=JSON.parse(String(init?.body));return b.method==="getGenesisHash"?Response.json({jsonrpc:"2.0",id:b.id,result:MAINNET_GENESIS}):new Response(null,{status:429,headers:{"retry-after":"300"}});});
  expect(await runWalletCycle(f.settings,undefined,now)).toMatchObject({state:"failed",error_code:"rpc_rate_limited",rpc_calls:2});
  expect(await f.db.prepare("SELECT last_error,retry_after FROM tenx_control").first()).toMatchObject({last_error:"rpc_rate_limited",retry_after:new Date(now.getTime()+300000).toISOString()});
  expect((await fundingRecoveryStatus(f.db,now)).recent[0]).toMatchObject({state:"finished",outcome:"rpc_rate_limited"});
  f.transport.mockClear();expect(await runWalletCycle(f.settings,undefined,now)).toMatchObject({state:"waiting",reason:"shared_rpc_backoff"});expect(f.transport).not.toHaveBeenCalled();
});
it.each(["missing", "oversized", "ended", "pending", "time", "budget"])("skips %s windows instead of paying for unfinishable evidence", async gap => {
  const f = await setup(), scan = structuredClone(f.scan);
  if (gap === "missing") scan.examined[0]!.status = "missing";
  if (gap === "oversized") scan.pages[0]!.rows.splice(1, 0, ...Array.from({ length: 12 }, (_, i) => ({ ...scan.pages[0]!.rows[0]!, signature: signature(140 + i) })));
  if (gap === "ended") { scan.pages[0]!.rows.pop(); scan.pages.push({ before: f.row.signature, fetched_at: scan.attempted_at, rows: [] }); }
  if (gap === "pending") scan.examined = [];
  if (gap === "time") scan.pages[0]!.rows[0]!.blockTime = null;
  if (gap === "budget") f.input.gaps.push("wallet_transaction_sample_limit");
  await f.checkpoint(scan); expect(await fundingRecoveryCandidates(f.db, f.candidate, f.input, now)).toEqual([]); expect(f.transport).not.toHaveBeenCalled();
});
it("does not enrich second-hop funding while an unrelated direct window is irreparable", async () => {
  const f = await setup(true), direct = structuredClone(f.input.funding_scans![1]!); direct.pages[0]!.rows = [];
  await f.checkpoint(direct, false); expect(await fundingRecoveryCandidates(f.db, f.candidate, f.input, now)).toEqual([]);
  direct.pages[0]!.rows=[{signature:signature(94),slot:direct.anchor.slot-1,blockTime:Date.parse(direct.anchor.block_time)/1000-1,err:null,confirmationStatus:"finalized"},f.input.funding_scans![1]!.pages[0]!.rows[0]!];
  direct.examined=[{signature:signature(94),status:"unsupported"}];await f.checkpoint(direct,false);
  expect(await fundingRecoveryCandidates(f.db,f.candidate,f.input,now)).toMatchObject([{signature:signature(94),hop:"direct"}]);
  await recordUnsupportedFundingRead(f.db,signature(94),direct.anchor.slot-1,"unsupported_transaction_version",now);
  expect(await fundingRecoveryCandidates(f.db,f.candidate,f.input,now)).toEqual([]);
});
it.each(["lease", "expired", "paused", "backoff", "checkpoint", "candidate", "slot", "time", "cached"])("requires exact admission and live unpaused ownership: %s", async fault => {
  const f = await setup(); if (fault !== "lease") await f.owner();
  if (fault === "expired") await f.db.prepare("UPDATE tenx_wallet_control SET lease_until=?").bind(new Date(now.getTime() - 1).toISOString()).run();
  if (fault === "paused") await f.db.prepare("UPDATE tenx_control SET paused=1").run();
  if (fault === "backoff") await f.db.prepare("UPDATE tenx_control SET retry_after=?,last_error='rpc_rate_limited'").bind(new Date(now.getTime() + 60000).toISOString()).run();
  if (fault === "checkpoint") await f.db.prepare("UPDATE tenx_funding_scans SET payload_hash='changed'").run();
  if (fault === "candidate") await f.db.prepare("UPDATE tenx_candidates SET payload=json_set(payload,'$.wallet_analysis.evidence_hash','changed')").run();
  if (fault === "slot") f.row.slot++;
  if (fault === "time") f.row.blockTime++;
  if (fault === "cached") await f.db.prepare("INSERT INTO tenx_wallet_transactions VALUES(?,?,?,?)").bind(f.row.signature, await hashJson(f.tx), JSON.stringify(f.tx), now.toISOString()).run();
  expect(await claimFundingRecovery(f.db, f.candidate, f.row, "job", now)).toBe(false); expect((await fundingRecoveryStatus(f.db, now)).used_today).toBe(0);
});
it("atomically caps concurrent claims at two per turn and twenty per UTC day", async () => {
  const f = await setup(), rows: FundingRecovery[] = [];
  for (const [i, original] of f.input.funding_scans!.slice(0, 2).entries()) {
    const scan = structuredClone(original), boundary = scan.pages[0]!.rows.at(-1)!;
    const references = Array.from({ length: 12 }, (_, n) => ({ signature: signature(150 + i * 12 + n), slot: scan.anchor.slot - 1, blockTime: Date.parse(scan.anchor.block_time) / 1000 - 1, err: null, confirmationStatus: "finalized" as const }));
    scan.pages[0]!.rows = [...references, boundary]; scan.examined = references.map(r => ({ signature: r.signature, status: "unsupported" })); await f.checkpoint(scan);
    for (const r of references) rows.push({ signature: r.signature, slot: r.slot, blockTime: r.blockTime, hop: "direct", wallet: scan.wallet, anchor_key: scan.anchor.signature, checkpoint_hash: await hashJson(FundingScanSchema.parse(scan)) });
  }
  await f.owner(); expect((await Promise.all(rows.slice(0, 5).map(r => claimFundingRecovery(f.db, f.candidate, r, "job", now)))).filter(Boolean)).toHaveLength(2);
  for (let i = 2; i < 19; i++) { await f.owner(`job${i}`); expect(await claimFundingRecovery(f.db, f.candidate, rows[i]!, `job${i}`, now)).toBe(true); }
  await f.owner("last"); expect((await Promise.all(rows.slice(19).map(r => claimFundingRecovery(f.db, f.candidate, r, "last", now)))).filter(Boolean)).toHaveLength(1);
  expect(await fundingRecoveryStatus(f.db, now)).toMatchObject({ used_today: 20, remaining_today: 0 });
  expect(await fundingRecoveryCandidates(f.db, f.candidate, f.input, now)).toEqual([]);
});
it("never repeats an interrupted claim or finalizes after lease loss", async () => {
  const f = await setup(); await f.owner(); expect(await claimFundingRecovery(f.db, f.candidate, f.row, "job", now)).toBe(true);
  await f.owner("replacement"); expect(await finishFundingRecovery(f.db, f.row, "job", "available", f.tx, now)).toBe(false);
  expect(await fundingRecoveryCandidates(f.db, f.candidate, f.input, now)).toEqual([]);
  expect((await fundingRecoveryStatus(f.db, now)).recent[0]).toMatchObject({ state: "reading", outcome: null });
  expect(await f.db.prepare("SELECT * FROM tenx_wallet_transactions").all()).toMatchObject({ results: [] });
});
it("commits the verified cache and immutable receipt atomically; leaves checkpoints and frozen inputs intact", async () => {
  const f = await setup(); await f.owner(); await claimFundingRecovery(f.db, f.candidate, f.row, "job", now);
  const before = await f.db.prepare("SELECT payload FROM tenx_candidates").all(), scans = await f.db.prepare("SELECT * FROM tenx_funding_scans").all();
  f.sqlite.exec("CREATE TRIGGER fault_receipt BEFORE UPDATE ON tenx_funding_reads BEGIN SELECT RAISE(ABORT,'simulated'); END;");
  await expect(finishFundingRecovery(f.db, f.row, "job", "available", f.tx, now)).rejects.toThrow("simulated");
  expect(await f.db.prepare("SELECT * FROM tenx_wallet_transactions").all()).toMatchObject({ results: [] });
  f.sqlite.exec("DROP TRIGGER fault_receipt"); expect(await finishFundingRecovery(f.db, f.row, "job", "available", f.tx, now)).toBe(true);
  expect((await fundingRecoveryStatus(f.db, now)).recent[0]).toMatchObject({ state: "finished", outcome: "available", payload_hash: await hashJson(f.tx) });
  expect(() => f.sqlite.exec("UPDATE tenx_funding_reads SET outcome='tampered'")).toThrow("funding_read_immutable");
  expect(() => f.sqlite.exec("DELETE FROM tenx_funding_reads")).toThrow("funding_read_immutable");
  expect(await f.db.prepare("SELECT payload FROM tenx_candidates").all()).toEqual(before); expect(await f.db.prepare("SELECT * FROM tenx_funding_scans").all()).toEqual(scans);
  expect(await priorWalletEvidence(f.db, f.candidate)).toEqual(f.input);
  expect(await walletPlan(f.db, f.candidate, now)).toMatchObject({ stage: "refresh_required", cached_recoverable_markers: 1, source_recoverable_markers: 0 });
});
it.each(["null", "version", "layout", "rate", "identity"])("retains %s recovery results without repeated reads", async failure => {
  const f = await setup(); await f.owner();
  f.transport.mockImplementation(async (_url, init) => {
    const b = JSON.parse(String(init?.body));
    if (b.method === "getGenesisHash") return Response.json({ jsonrpc:"2.0",id: b.id, result: MAINNET_GENESIS });
    if (failure === "rate") return new Response(null, { status: 429, headers: { "retry-after": "300" } });
    return Response.json({ jsonrpc:"2.0",id: b.id, ...(failure === "version" ? { error: { code: -32015, message: "unsupported" } } : { result: failure === "null" ? null : failure === "layout" ? { version: 1 } : { ...f.tx, slot: f.tx.slot + 1 } }) });
  });
  if (["rate", "identity"].includes(failure)) await expect(recoverFundingBodies(f.db, f.candidate, f.input, f.rpc(), "job", now)).rejects.toThrow();
  else expect(await recoverFundingBodies(f.db, f.candidate, f.input, f.rpc(), "job", now)).toEqual({ attempted: 1, recovered: 0 });
  expect((await fundingRecoveryStatus(f.db, now)).recent[0]).toMatchObject({ state: "finished", payload_hash: null });
  f.transport.mockClear(); expect(await recoverFundingBodies(f.db, f.candidate, f.input, f.rpc(), "job", now)).toEqual({ attempted: 0, recovered: 0 }); expect(f.transport).not.toHaveBeenCalled();
});
it("uses the automatic wallet lane and both quotas, preserving old eligibility and timestamps", async () => {
  const f = await setup(), before = await f.db.prepare("SELECT payload FROM tenx_candidates").all(), eligibility = assess(f.candidate, DEFAULT_POLICY, now);
  expect(await runWalletCycle(f.settings, undefined, now)).toMatchObject({ state: "progressed", rpc_calls: 2, recovery: { attempted: 1, recovered: 1 }, snapshot_updated: false });
  expect(await f.db.prepare("SELECT used FROM tenx_wallet_usage").first()).toEqual({ used: 2 });
  expect(await f.db.prepare("SELECT used FROM tenx_usage WHERE provider='rpc'").first()).toEqual({ used: 2 });
  expect(await f.db.prepare("SELECT payload FROM tenx_candidates").all()).toEqual(before); expect(assess(f.candidate, DEFAULT_POLICY, now)).toEqual(eligibility);
  expect(await f.db.prepare("SELECT kind,rpc_calls,completed_windows FROM tenx_wallet_runs").first()).toEqual({ kind: "funding", rpc_calls: 2, completed_windows: 0 });
});
it.each(["pause", "shared_backoff", "wallet_budget", "global_budget", "stale"])("obeys existing controls before successful recovery: %s", async fault => {
  const f = await setup();
  if (fault === "pause") await f.db.prepare("UPDATE tenx_control SET paused=1").run();
  if (fault === "shared_backoff") await f.db.prepare("UPDATE tenx_control SET retry_after=?,last_error='rpc_rate_limited'").bind(new Date(now.getTime() + 60000).toISOString()).run();
  if (fault === "wallet_budget") await f.db.prepare("INSERT INTO tenx_wallet_usage VALUES(?,800)").bind(now.toISOString().slice(0, 10)).run();
  if (fault === "global_budget") await f.db.prepare("INSERT INTO tenx_usage(provider,day,used) VALUES('rpc',?,5000)").bind(now.toISOString().slice(0, 10)).run();
  if (fault === "stale") { f.candidate.creation!.block_time = "2026-10-18T00:00:00.000Z"; await saveCandidate(f.db, f.candidate); }
  await runWalletCycle(f.settings, undefined, now); expect(f.transport).not.toHaveBeenCalled(); expect((await fundingRecoveryStatus(f.db, now)).used_today).toBe(0);
});
