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
