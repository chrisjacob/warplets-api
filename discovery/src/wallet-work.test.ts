import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import { analyzeWalletEvidence, type WalletEvidence } from "./wallet-analysis";
import { walletInput, key, signature, trade } from "./wallet-fixtures.test-helper";
import { fixtureCandidates } from "./fixtures";
import { saveCandidate } from "./store";
import { hashJson } from "./solana";
import { MAINNET_GENESIS, RpcClient } from "./rpc";
import { canContinueFunding, catchupLimit, continueFunding, priorWalletEvidence, replayLegacyWallets, walletWork } from "./wallet-work";
import { runWalletCycle } from "./wallet-cycle";
import { assess, DEFAULT_POLICY } from "./model";
import transient from "../fixtures/recorded/temporary-wsol-trade.json";
import { WalletTransactionSchema } from "./wallet-rpc";
import { compareCollectionPotential, comparePotential } from "./priority";
import { compareWalletPlans, walletPlan, walletPlans } from "./wallet-plan";
import { FundingScanSchema, type FundingScan } from "./funding-history";
const opened: DatabaseSync[] = [];
afterEach(() => { opened.splice(0).forEach(d => d.close()); vi.restoreAllMocks(); });
async function setup() {
  const sqlite = new DatabaseSync(":memory:"); opened.push(sqlite);
  for (const file of readdirSync(new URL("../migrations/", import.meta.url)).filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  const db = sqliteD1(sqlite), input: WalletEvidence = { ...await walletInput(), version: "wallet-input-v4", second_hop_scans: [], funding_scans: [] };
  input.funding_scans = input.records.map((r, i) => ({ wallet: i ? key(7 + i) : key(7), anchor: { wallet: i ? key(7 + i) : key(7), signature: r.signature, slot: r.transaction!.slot, block_time: new Date(r.transaction!.blockTime! * 1000).toISOString(), kind: i ? "sampled_buy" : "signed_creation" }, lookback_seconds: 3600, pages: [], examined: [], attempted_at: input.observed_at }));
  const analysis = await analyzeWalletEvidence(input), candidate = { ...(await fixtureCandidates())[0]!, creation: input.asset.creation, graduation: null, mode: "live" as const, wallet_analysis: analysis, holders: null };
  await saveCandidate(db, candidate);
  await db.prepare("INSERT INTO tenx_wallet_evidence(payload_hash,address,payload,observed_at) VALUES(?1,?2,?3,?4)").bind(analysis.evidence_hash,candidate.address,JSON.stringify(input),input.observed_at).run();
  for (const r of input.records) await db.prepare("INSERT INTO tenx_wallet_transactions(signature,payload_hash,payload,fetched_at) VALUES(?1,?2,?3,?4)").bind(r.signature, await hashJson(r.transaction), JSON.stringify(r.transaction), r.fetched_at).run();
  const transport = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const b = JSON.parse(String(init?.body));
    if (b.method === "getGenesisHash") return Response.json({ jsonrpc: "2.0", id: b.id, result: MAINNET_GENESIS });
    if (b.method === "getSignaturesForAddress") {
      const anchor = input.funding_scans!.find(s => s.wallet === b.params[0])!.anchor;
      return Response.json({ jsonrpc: "2.0", id: b.id, result: [{ signature: signature(80 + Number(b.id)), slot: anchor.slot - 1, blockTime: Date.parse(anchor.block_time) / 1000 - 3601, err: null, confirmationStatus: "finalized" }] });
    }
    throw new Error("Unexpected transaction or pool refresh");
  });
  const rpc = () => new RpcClient("https://rpc.example", async () => {}, transport, 18);
  const settings = { db, rpcUrl: "https://rpc.example", rpcDailyLimit: 5000, walletDailyLimit: 800, marketDailyLimit: 600, walletEnabled: true, marketEnabled: false, transport };
  return { db, input, candidate, transport, rpc, settings };
}
describe("funding continuations keep eligibility snapshots honest", () => {
  it.each(["version", "layout"])("retains an unsupported %s body once while other funding windows advance", async (failure) => {
    const { db, candidate, input, transport, rpc } = await setup();
    const original = transport.getMockImplementation()!, scan = structuredClone(input.funding_scans![0]!);
    scan.pages = [{ before: scan.anchor.signature, fetched_at: input.observed_at, rows: [
      { signature: signature(92), slot: scan.anchor.slot - 1, blockTime: Date.parse(scan.anchor.block_time) / 1000 - 10, err: null, confirmationStatus: "finalized" },
      { signature: signature(93), slot: scan.anchor.slot - 2, blockTime: Date.parse(scan.anchor.block_time) / 1000 - 3601, err: null, confirmationStatus: "finalized" },
    ] }];
    const normalized=FundingScanSchema.parse(scan);
    await db.prepare("INSERT INTO tenx_funding_scans(address,wallet,anchor_signature,payload,payload_hash,attempted_at) VALUES(?1,?2,?3,?4,?5,?6)").bind(candidate.address,scan.wallet,scan.anchor.signature,JSON.stringify(normalized),await hashJson(normalized),scan.attempted_at).run();
    transport.mockImplementation(async (url,init) => {
      const b=JSON.parse(String(init?.body));
      if (b.method === "getTransaction") return Response.json(failure === "version" ? {jsonrpc:"2.0",id:b.id,error:{code:-32015,message:"unsupported"}} : {jsonrpc:"2.0",id:b.id,result:{version:1}});
      return original(url,init);
    });
    const before=await db.prepare("SELECT payload FROM tenx_candidates").all();
    const first=await continueFunding(db,candidate,rpc());
    expect(first.examined_windows).toBe(2);
    expect(first.gaps).toContain("funding_transaction_missing_or_unsupported");
    const saved=JSON.parse((await db.prepare("SELECT payload FROM tenx_funding_scans WHERE wallet=?1").bind(scan.wallet).first<{payload:string}>())!.payload);
    expect(saved.examined).toEqual([{signature:signature(92),status:"unsupported"}]);
    const second=await continueFunding(db,candidate,rpc());
    expect(second).toMatchObject({examined_windows:3,stage:"source_limited"});
    expect(transport.mock.calls.filter(([,init])=>JSON.parse(String(init?.body)).method==="getTransaction")).toHaveLength(1);
    expect(await db.prepare("SELECT payload FROM tenx_candidates").all()).toEqual(before);
    expect((await walletPlan(db,candidate)).stage).toBe("source_limited");
  });
  it("does not mislabel transient provider errors as terminal unsupported evidence", async () => {
    const {db,candidate,input,transport,rpc}=await setup(),original=transport.getMockImplementation()!;
    transport.mockImplementation(async(url,init)=>{
      const b=JSON.parse(String(init?.body));
      if(b.method==="getTransaction")return new Response(null,{status:429,headers:{"retry-after":"300"}});
      if(b.method==="getSignaturesForAddress"){
        const anchor=input.funding_scans!.find(s=>s.wallet===b.params[0])!.anchor;
        return Response.json({jsonrpc:"2.0",id:b.id,result:[{signature:signature(92),slot:anchor.slot-1,blockTime:Date.parse(anchor.block_time)/1000-10,err:null,confirmationStatus:"finalized"},{signature:signature(93),slot:anchor.slot-2,blockTime:Date.parse(anchor.block_time)/1000-3601,err:null,confirmationStatus:"finalized"}]});
      }
      return original(url,init);
    });
    await expect(continueFunding(db,candidate,rpc())).rejects.toThrow("rpc_rate_limited");
    const saved=await db.prepare("SELECT payload FROM tenx_funding_scans").all<{payload:string}>();
    expect(saved.results).toHaveLength(1);expect(JSON.parse(saved.results[0]!.payload).examined).toEqual([]);
  });
  it("resumes exact saved anchors with no trade resampling and no candidate timestamp changes", async () => {
    const { db, candidate, transport, rpc } = await setup();
    const before = await db.prepare("SELECT payload FROM tenx_candidates WHERE mode='live'").first();
    const initial = assess(candidate, DEFAULT_POLICY, new Date());
    expect(canContinueFunding(candidate)).toBe(true);
    const first = await continueFunding(db,candidate,rpc()); expect(first).toMatchObject({ windows: 4, examined_windows: 3, stage: "direct_funding", rpc_calls: 4 });
    const second = await continueFunding(db,candidate,rpc()); expect(second).toMatchObject({ windows: 4, examined_windows: 4, stage: "refresh_required", rpc_calls: 2 });
    expect(await db.prepare("SELECT payload FROM tenx_candidates WHERE mode='live'").first()).toEqual(before);
    expect(assess(candidate, DEFAULT_POLICY, new Date()).eligibility).toBe(initial.eligibility);
    expect((await walletWork(db))[0]!.snapshot_at).toBe(candidate.wallet_analysis.observed_at);
    expect(transport.mock.calls.every(([, init]) => ["getGenesisHash", "getSignaturesForAddress"].includes(JSON.parse(String(init?.body)).method))).toBe(true);
    expect((await db.prepare("SELECT count(*) AS n FROM tenx_selections").first<{n:number}>())!.n).toBe(0);
  });
  it("does not turn an empty provider history into an examined window", async () => {
    const { db,candidate,rpc,transport } = await setup();
    transport.mockImplementation(async (_url, init) => { const b=JSON.parse(String(init?.body)); return Response.json({jsonrpc:"2.0",id:b.id,result:b.method==="getGenesisHash"?MAINNET_GENESIS:[]}); });
    await continueFunding(db,candidate,rpc()); const last=await continueFunding(db,candidate,rpc());
    expect(last).toMatchObject({stage:"source_limited",examined_windows:0}); expect(last.gaps).toContain("provider_history_ended_before_window_boundary");
    expect(canContinueFunding(candidate,last)).toBe(false);
  });
  it("prioritizes finishable collection without changing eligibility or display-ranking rules",async()=>{
    const {candidate}=await setup(),at=new Date("2026-10-20T00:00:00Z"),base={...candidate,creation:{...candidate.creation!,block_time:"2026-10-19T23:00:00.000Z"},graduation:(await fixtureCandidates(at))[0]!.graduation};
    const limited={...base,address:key(42),market:{...base.market!,liquidity_usd:500000},wallet_analysis:{...base.wallet_analysis,funding_coverage:base.wallet_analysis.funding_coverage!.map((c,i)=>i?c:{...c,gaps:["provider_history_ended_before_window_boundary"]})}};
    expect(comparePotential(limited,base,DEFAULT_POLICY,at)).toBeLessThan(0);
    expect(compareCollectionPotential(limited,base,DEFAULT_POLICY,at)).toBeGreaterThan(0);
    expect(canContinueFunding(limited)).toBe(false);expect(assess(limited,DEFAULT_POLICY,at).reasons).toContain("pre_buy_funding_coverage_partial");
  });
  it("rejects prior evidence and analysis tampering before making any RPC call", async () => {
    const { db,candidate,rpc,transport } = await setup();
    await expect(priorWalletEvidence(db,{...candidate,wallet_analysis:{...candidate.wallet_analysis,observed_at:"2026-10-20T01:00:00Z"}})).rejects.toThrow("wallet_analysis_cache_replay_mismatch");
    await db.prepare("UPDATE tenx_wallet_evidence SET payload_hash='bad'").run();
    await expect(continueFunding(db,candidate,rpc())).rejects.toThrow("wallet_evidence_cache_missing"); expect(transport).not.toHaveBeenCalled();
  });
  it("invalidates progress display when the candidate snapshot changes", async () => {
    const { db,candidate,rpc } = await setup(); await continueFunding(db,candidate,rpc()); expect(await walletWork(db)).toHaveLength(1);
    await db.prepare("UPDATE tenx_candidates SET payload=json_set(payload,'$.wallet_analysis.evidence_hash',?1)").bind("a".repeat(64)).run(); expect(await walletWork(db)).toEqual([]);
  });
  it("retains prior buyers and exact funding anchors when a later pool sample changes", async () => {
    const { db,input,candidate,rpc,settings,transport } = await setup();
    await continueFunding(db,candidate,rpc()); await continueFunding(db,candidate,rpc());
    const newBuy = await trade(key(11),10002,"buy",70);
    transport.mockImplementation(async (_url,init) => {
      const b=JSON.parse(String(init?.body)); let result: unknown;
      if (b.method==="getGenesisHash") result=MAINNET_GENESIS;
      else if (b.method==="getTransaction") result=newBuy;
      else if (b.method==="getSignaturesForAddress") result=b.params[0]===candidate.pool ? [{signature:signature(70),slot:newBuy.slot,blockTime:newBuy.blockTime,err:null,confirmationStatus:"finalized"}] : [];
      else throw new Error("unexpected method");
      return Response.json({jsonrpc:"2.0",id:b.id,result});
    });
    expect(await runWalletCycle(settings,candidate.address)).toMatchObject({state:"succeeded",verified_buys:4});
    const saved=JSON.parse((await db.prepare("SELECT payload FROM tenx_candidates WHERE mode='live'").first<{payload:string}>())!.payload);
    expect(saved.wallet_analysis.funding_coverage).toEqual(expect.arrayContaining(input.funding_scans!.slice(1).map(s=>expect.objectContaining({wallet:s.wallet,anchor_signature:s.anchor.signature,status:"window_examined"}))));
    expect(saved.wallet_analysis.metrics.distinct_buyers).toBe(4);
    expect(saved.wallet_analysis.gaps).toContain("pre_buy_funding_coverage_partial");
    const records=JSON.parse((await db.prepare("SELECT payload FROM tenx_wallet_evidence WHERE payload_hash=?1").bind(saved.wallet_analysis.evidence_hash).first<{payload:string}>())!.payload).records;
    expect(records.find((r: {signature:string})=>r.signature===signature(31)).fetched_at).toBe(input.records[1]!.fetched_at);
  });
  it("uses a bounded catch-up reserve inside both unchanged daily ceilings", async () => {
    const { db,candidate,settings } = await setup(); expect(catchupLimit(800)).toBe(180); expect(catchupLimit(80)).toBe(18);
    expect(await runWalletCycle(settings,candidate.address)).toMatchObject({state:"progressed",snapshot_updated:false});
    expect(await db.prepare("SELECT used FROM tenx_usage WHERE provider='wallet_catchup'").first()).toEqual({used:18});
    expect(await db.prepare("SELECT used FROM tenx_wallet_usage").first()).toEqual({used:4});
    expect(await db.prepare("SELECT used FROM tenx_usage WHERE provider='rpc'").first()).toEqual({used:4});
    await db.prepare("UPDATE tenx_control SET paused=1").run(); expect(await runWalletCycle(settings,candidate.address)).toEqual({state:"paused"});
  });
  it("does not bypass provider backoff, leases or exhausted wallet quotas", async () => {
    const { db,candidate,settings,transport } = await setup(); const later=new Date(Date.now()+600000).toISOString();
    await db.prepare("UPDATE tenx_control SET retry_after=?1,last_error='rpc_rate_limited'").bind(later).run(); expect(await runWalletCycle(settings,candidate.address)).toEqual({state:"waiting",reason:"shared_rpc_backoff"});
    await db.prepare("UPDATE tenx_control SET retry_after=NULL,last_error=NULL").run(); await db.prepare("UPDATE tenx_wallet_control SET lease_until=?1").bind(later).run(); expect(await runWalletCycle(settings,candidate.address)).toEqual({state:"waiting"});
    await db.prepare("UPDATE tenx_wallet_control SET lease_until=NULL").run(); await db.prepare("INSERT INTO tenx_wallet_usage(day,used) VALUES(?1,800)").bind(new Date().toISOString().slice(0,10)).run(); expect(await runWalletCycle(settings,candidate.address)).toMatchObject({state:"failed",error_code:"wallet_daily_budget_exhausted"}); expect(transport).not.toHaveBeenCalled();
  });
  it("recovers a recorded real buyer from legacy evidence without freshening timestamps or changing cohorts",async()=>{
    const {db}=await setup(),tx=WalletTransactionSchema.parse(transient.transaction),at=transient.recorded_at;
    const input:WalletEvidence={version:"wallet-input-v3",observed_at:at,cluster:MAINNET_GENESIS,asset:{address:transient.mint,pool:transient.pool,token_program:key(1),creation:null,graduation:null},records:[{signature:tx.transaction.signatures[0]!,fetched_at:at,status:"available",purposes:["recent"],transaction:tx}],histories:[],holders:null,prior_losses:[],funding_scans:[],second_hop_scans:[],gaps:[]};
    const old=await analyzeWalletEvidence(input),c={...(await fixtureCandidates())[0]!,address:transient.mint,pool:transient.pool,creation:null,graduation:null,mode:"live" as const,wallet_analysis:old};
    expect(old.metrics.distinct_buyers).toBe(0);await saveCandidate(db,c);
    await db.prepare("INSERT INTO tenx_wallet_evidence(payload_hash,address,payload,observed_at) VALUES(?1,?2,?3,?4)").bind(old.evidence_hash,c.address,JSON.stringify(input),at).run();
    const cohorts=await db.prepare("SELECT payload FROM tenx_cohorts ORDER BY address").all();
    const network=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("No provider requests"));
    const result=await replayLegacyWallets(db);expect(result).toMatchObject({provider_requests:0,errors:[],upgraded:[{address:c.address,buyers_before:0,buyers_after:1,observed_at:at}]});expect(network).not.toHaveBeenCalled();
    const saved=JSON.parse((await db.prepare("SELECT payload FROM tenx_candidates WHERE address=?1 AND mode='live'").bind(c.address).first<{payload:string}>())!.payload);
    expect(saved.wallet_analysis.version).toBe("wallet-signals-v4");expect(saved.wallet_analysis.observed_at).toBe(at);expect(saved.checked_at).toBe(c.checked_at);expect(saved.wallet_analysis.gaps).toContain("pre_buy_funding_coverage_partial");
    expect(await db.prepare("SELECT payload FROM tenx_cohorts ORDER BY address").all()).toEqual(cohorts);
    expect(await analyzeWalletEvidence(JSON.parse((await db.prepare("SELECT payload FROM tenx_wallet_evidence WHERE payload_hash=?1").bind(saved.wallet_analysis.evidence_hash).first<{payload:string}>())!.payload))).toEqual(saved.wallet_analysis);
  });
});

describe("budget-aware funding plans",()=>{
  async function checkpoint(db:D1Database,address:string,scan:FundingScan){
    scan=FundingScanSchema.parse(scan);
    await db.prepare("INSERT INTO tenx_funding_scans(address,wallet,anchor_signature,payload,payload_hash,attempted_at) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(address,wallet,anchor_signature) DO UPDATE SET payload=excluded.payload,payload_hash=excluded.payload_hash").bind(address,scan.wallet,scan.anchor.signature,JSON.stringify(scan),await hashJson(scan),scan.attempted_at).run();
  }
  it("plans from verified exact anchors without provider reads or snapshot mutations",async()=>{
    const {db,candidate,transport}=await setup(),before=await db.prepare("SELECT payload FROM tenx_candidates").all();
    const network=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("network forbidden"));
    expect(await walletPlan(db,candidate)).toMatchObject({stage:"direct_funding",windows:4,examined_windows:0,minimum_rpc_calls:5});
    expect(transport).not.toHaveBeenCalled();expect(network).not.toHaveBeenCalled();expect(await db.prepare("SELECT payload FROM tenx_candidates").all()).toEqual(before);
  });
  it("skips bodies for a known oversized window and prevents manual retries consuming quota",async()=>{
    const {db,candidate,input,settings,transport}=await setup(),scan=structuredClone(input.funding_scans![1]!);
    scan.pages=[{before:scan.anchor.signature,fetched_at:input.observed_at,rows:Array.from({length:13},(_,i)=>({signature:signature(100+i),slot:scan.anchor.slot-i-1,blockTime:Date.parse(scan.anchor.block_time)/1000-1-i,err:null,confirmationStatus:"finalized" as const}))}];
    await checkpoint(db,candidate.address,scan);
    const plan=await walletPlan(db,candidate);expect(plan,JSON.stringify(plan)).toMatchObject({stage:"source_limited",blocked_windows:1,pending_bodies:13,cached_pending_bodies:null,minimum_rpc_calls:null});expect(plan.gaps).toContain("funding_window_exceeds_transaction_bound");
    const before=await db.prepare("SELECT payload FROM tenx_candidates").all();
    expect(await runWalletCycle(settings,candidate.address)).toMatchObject({state:"waiting",reason:"source_limited",rpc_calls:0});
    expect(transport).not.toHaveBeenCalled();expect(await db.prepare("SELECT * FROM tenx_wallet_usage").all()).toMatchObject({results:[]});expect(await db.prepare("SELECT payload FROM tenx_candidates").all()).toEqual(before);
  });
  it("counts reusable saved bodies and rejects poisoned pending cache entries before network work",async()=>{
    const {db,candidate,input}=await setup(),scan=structuredClone(input.funding_scans![1]!),tx=input.records[2]!.transaction!;
    scan.pages=[{before:scan.anchor.signature,fetched_at:input.observed_at,rows:[{signature:tx.transaction.signatures[0]!,slot:tx.slot,blockTime:tx.blockTime,err:null,confirmationStatus:"finalized"},{signature:signature(91),slot:tx.slot-1,blockTime:Date.parse(scan.anchor.block_time)/1000-3601,err:null,confirmationStatus:"finalized"}]}];
    await checkpoint(db,candidate.address,scan);
    const cachedPlan=await walletPlan(db,candidate);expect(cachedPlan,JSON.stringify(cachedPlan)).toMatchObject({stage:"direct_funding",pending_bodies:1,cached_pending_bodies:1,minimum_rpc_calls:4});
    // The prior input is verified separately; use a genuinely pending cached body.
    const missing=await trade(key(8),9999,"buy",92);missing.blockTime=Date.parse(scan.anchor.block_time)/1000-10;
    scan.pages[0]!.rows[0]={signature:signature(92),slot:missing.slot,blockTime:missing.blockTime,err:null,confirmationStatus:"finalized"};scan.pages[0]!.rows[1]!.slot=missing.slot-1;await checkpoint(db,candidate.address,scan);
    await db.prepare("INSERT INTO tenx_wallet_transactions(signature,payload_hash,payload,fetched_at) VALUES(?1,?2,?3,?4)").bind(signature(92),"a".repeat(64),JSON.stringify(missing),input.observed_at).run();
    expect(await walletPlan(db,candidate)).toMatchObject({stage:"cache_invalid",gaps:["wallet_cache_hash_or_identity_mismatch"]});
    scan.examined=[{signature:signature(92),status:"available"}];await checkpoint(db,candidate.address,scan);
    expect(await walletPlan(db,candidate)).toMatchObject({stage:"cache_invalid",gaps:["wallet_cache_hash_or_identity_mismatch"]});
    await db.prepare("DELETE FROM tenx_wallet_transactions WHERE signature=?1").bind(signature(92)).run();
    expect(await walletPlan(db,candidate)).toMatchObject({stage:"cache_invalid",gaps:["wallet_checkpoint_body_missing"]});
  });
  it("retains source-ended and future/hash-mismatched checkpoint gaps",async()=>{
    const {db,candidate,input}=await setup(),scan=structuredClone(input.funding_scans![0]!);
    scan.pages=[{before:scan.anchor.signature,fetched_at:input.observed_at,rows:[]}];await checkpoint(db,candidate.address,scan);
    expect(await walletPlan(db,candidate)).toMatchObject({stage:"source_limited",gaps:expect.arrayContaining(["provider_history_ended_before_window_boundary"])});
    scan.pages=[];scan.attempted_at=new Date(Date.now()+3600000).toISOString();await checkpoint(db,candidate.address,scan);
    expect(await walletPlan(db,candidate)).toMatchObject({stage:"cache_invalid",gaps:["funding_checkpoint_from_future"]});
    await db.prepare("UPDATE tenx_funding_scans SET payload_hash='bad'").run();expect((await walletPlan(db,candidate)).stage).toBe("cache_invalid");
  });
  it("automatically skips known blocked current contenders without consuming RPC allowance",async()=>{
    const {db,candidate,input,settings,transport}=await setup(),scan=structuredClone(input.funding_scans![0]!);
    scan.pages=[{before:scan.anchor.signature,fetched_at:input.observed_at,rows:[]}];await checkpoint(db,candidate.address,scan);
    const current={...candidate,graduation:(await fixtureCandidates())[0]!.graduation,market:{...candidate.market!,market_cap_usd:200000,liquidity_usd:100000}};await saveCandidate(db,current);
    expect(await runWalletCycle(settings)).toMatchObject({state:"empty"});expect(transport).not.toHaveBeenCalled();
    expect(await db.prepare("SELECT * FROM tenx_wallet_usage").all()).toMatchObject({results:[]});expect((await walletPlan(db,current)).stage).toBe("source_limited");
  });
  it("measures real calls and net completed windows once, separately from eligibility",async()=>{
    const {db,candidate,settings}=await setup();
    const before=await db.prepare("SELECT payload FROM tenx_candidates").all();
    expect(await runWalletCycle(settings,candidate.address)).toMatchObject({state:"progressed",rpc_calls:4,snapshot_updated:false});
    const stats=await db.prepare("SELECT kind,state,rpc_calls,completed_windows FROM tenx_wallet_runs").all();expect(stats.results).toEqual([{kind:"funding",state:"succeeded",rpc_calls:4,completed_windows:3}]);
    expect(await walletPlan(db,candidate)).toMatchObject({stage:"direct_funding",examined_windows:3,minimum_rpc_calls:2});
    expect(await runWalletCycle(settings,candidate.address)).toMatchObject({state:"progressed",rpc_calls:2});
    expect(await walletPlan(db,candidate)).toMatchObject({stage:"refresh_required",examined_windows:4});
    const summary=await walletPlans(db);expect(summary.yield).toMatchObject({turns:2,rpc_calls:6,completed_windows:4,failed_turns:0,rpc_per_completed_window:1.5});
    expect(await db.prepare("SELECT payload FROM tenx_candidates").all()).toEqual(before);
  });
  it("compares completion cost without changing eligibility or treating unknowns as free",async()=>{
    const {db,candidate}=await setup(),plan=await walletPlan(db,candidate);
    const low={candidate,plan:{...plan,minimum_rpc_calls:2}},high={candidate,plan:{...plan,minimum_rpc_calls:10}};
    expect(compareWalletPlans(low,high,new Date())).toBeLessThan(0);
    expect(compareWalletPlans(high,{candidate,plan:{...plan,stage:"new_snapshot",minimum_rpc_calls:null}},new Date())).toBeLessThan(0);
    expect(assess(candidate,DEFAULT_POLICY,new Date()).eligibility).not.toBe("eligible");
  });
});
