import {afterEach,expect,it,vi} from "vitest";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {sqliteD1} from "../../app/functions/_lib/sqliteTestDb";
import {analyzeWalletEvidence,WalletEvidenceSchema,type WalletEvidence} from "./wallet-analysis";
import {WalletAnalysisSchema} from "./wallet-model";
import {currentWalletReader,directFundingLimit,expandedFundingScope} from "./wallet-funding-scope";
import {walletInput,key,signature,trade} from "./wallet-fixtures.test-helper";
import {fixtureCandidates} from "./fixtures";
import {assess,DEFAULT_POLICY} from "./model";
import {saveCandidate} from "./store";
import {hashJson} from "./solana";
import {MAINNET_GENESIS,RpcClient,SourceError} from "./rpc";
import {continueFunding,priorWalletEvidence,replayLegacyWallets} from "./wallet-work";
import {walletPlan} from "./wallet-plan";
import {fundingTask,FundingScanSchema,recoverCachedFunding} from "./funding-history";
import nineBuyerRecord from "../fixtures/recorded/funding-scope-nine-buyers-v4.json";
import overflowRecord from "../fixtures/recorded/funding-scope-v4.json";
const opened:DatabaseSync[]=[],at=new Date();
afterEach(()=>{opened.splice(0).forEach(db=>db.close());vi.restoreAllMocks();});
async function fixture(count=9){
  const sql=new DatabaseSync(":memory:");opened.push(sql);for(const n of readdirSync(new URL("../migrations/",import.meta.url)).filter(n=>n.endsWith(".sql")).sort())sql.exec(readFileSync(new URL(`../migrations/${n}`,import.meta.url),"utf8"));const db=sqliteD1(sql);
  const original=await walletInput(),txs=await Promise.all(Array.from({length:count},(_,i)=>trade(key(8+i),10001,"buy",80+i)));
  const input:WalletEvidence={...original,version:"wallet-input-v4",records:[original.records[0]!,...txs.map(tx=>({signature:tx.transaction.signatures[0]!,status:"available" as const,transaction:tx,purposes:["early" as const],fetched_at:original.observed_at}))],funding_scans:[],second_hop_scans:[],gaps:["funding_wallet_limit"]};
  input.funding_scans=input.records.slice(0,8).map((r,i)=>FundingScanSchema.parse({wallet:key(7+i),anchor:{wallet:key(7+i),signature:r.signature,slot:r.transaction!.slot,block_time:new Date(r.transaction!.blockTime!*1000).toISOString(),kind:i?"sampled_buy":"signed_creation"},lookback_seconds:3600,pages:[],examined:[],attempted_at:input.observed_at}));
  const analysis=await analyzeWalletEvidence(input),candidate={...(await fixtureCandidates())[0]!,creation:input.asset.creation,graduation:null,mode:"live" as const,wallet_analysis:analysis,holders:null};
  await saveCandidate(db,candidate);await db.prepare("INSERT INTO tenx_wallet_evidence(payload_hash,address,payload,observed_at) VALUES(?,?,?,?)").bind(analysis.evidence_hash,candidate.address,JSON.stringify(input),input.observed_at).run();
  for(const r of input.records)await db.prepare("INSERT INTO tenx_wallet_transactions(signature,payload_hash,payload,fetched_at) VALUES(?,?,?,?)").bind(r.signature,await hashJson(r.transaction),JSON.stringify(r.transaction),r.fetched_at).run();
  const transport=vi.fn(async(_url:unknown,init?:RequestInit)=>{const b=JSON.parse(String(init?.body));if(b.method==="getGenesisHash")return Response.json({jsonrpc:"2.0",id:b.id,result:MAINNET_GENESIS});if(b.method==="getSignaturesForAddress")return Response.json({jsonrpc:"2.0",id:b.id,result:[{signature:signature(200+Number(b.id)),slot:9000,blockTime:Date.parse(input.asset.creation!.block_time)/1000-3602,err:null,confirmationStatus:"finalized"}]});throw Error("Unexpected body purchase");});
  const rpc=()=>new RpcClient("https://rpc.example",async()=>{},transport,18);return {db,input,candidate,transport,rpc};
}
it("replays both real v4 fixtures with their original hashes and never modifies historical inputs",async()=>{
  const f=await fixture(),outside=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("Network forbidden"));
  for(const [raw,hash] of [[nineBuyerRecord,"92dd291ce33f6c0cee03fd0642280e93ee00f50c278a02a0dd1e3a04e2ee0d7c"],[overflowRecord,"4609a7100eb4ca281b3a52923a1659064b3f358e3bd24a5b14a560a3234d57bc"]] as const){const input=WalletEvidenceSchema.parse(raw);expect(await hashJson(input)).toBe(hash);expect((await analyzeWalletEvidence(input)).evidence_hash).toBe(hash);await expandedFundingScope(f.db,input);expect(await hashJson(input)).toBe(hash);}expect(outside).not.toHaveBeenCalled();
},20000);
it("prepares all nine real sampled buyers without fabricating completed history",async()=>{
  const f=await fixture(),input=WalletEvidenceSchema.parse(nineBuyerRecord),expanded=await expandedFundingScope(f.db,input);
  expect(expanded.version).toBe("wallet-input-v5");expect(expanded.funding_scans).toHaveLength(9);expect(expanded.records).toEqual(input.records);expect(expanded.observed_at).toBe(input.observed_at);expect(expanded.gaps).not.toContain("funding_wallet_limit");
  const r=await analyzeWalletEvidence(expanded);expect(r.metrics.distinct_buyers).toBe(9);expect(r.gaps).toContain("buyer_funding_histories_not_all_sampled");expect(r.funding_coverage!.every(c=>c.status==="partial")).toBe(true);expect(f.transport).not.toHaveBeenCalled();
});
it("does not expand a real twenty-two-buyer sample beyond the existing output capacity",async()=>{
  const f=await fixture(),input=WalletEvidenceSchema.parse(overflowRecord),expanded=await expandedFundingScope(f.db,input);expect(expanded).toEqual(input);expect((await analyzeWalletEvidence(expanded)).gaps).toContain("wallet_output_limit");expect(expanded.gaps).toContain("funding_wallet_limit");
});
it("plans and completes ten required windows in bounded turns without publishing a fresh snapshot",async()=>{
  const f=await fixture(),oldHash=f.candidate.wallet_analysis.evidence_hash,oldAt=f.candidate.wallet_analysis.observed_at,initial=await assess(f.candidate,DEFAULT_POLICY,at),plan=await walletPlan(f.db,f.candidate,new Date());
  expect(plan).toMatchObject({stage:"direct_funding",windows:10,direct_wallet_limit:20,additional_windows:2,minimum_rpc_calls:11});expect(f.transport).not.toHaveBeenCalled();
  let result;for(let i=0;i<4;i++){const rpc=f.rpc();result=await continueFunding(f.db,f.candidate,rpc);expect(rpc.calls).toBeLessThanOrEqual(18);}
  expect(result).toMatchObject({stage:"refresh_required",windows:10,examined_windows:10});expect(f.transport).toHaveBeenCalledTimes(14);
  const row=await f.db.prepare("SELECT payload FROM tenx_candidates WHERE address=? AND mode='live'").bind(f.candidate.address).first<{payload:string}>();const saved=JSON.parse(row!.payload);expect(saved.wallet_analysis.evidence_hash).toBe(oldHash);expect(saved.wallet_analysis.observed_at).toBe(oldAt);expect(assess(saved,DEFAULT_POLICY,at)).toEqual(initial);
  expect(await walletPlan(f.db,f.candidate,new Date())).toMatchObject({stage:"refresh_required",windows:10,examined_windows:10});expect((await priorWalletEvidence(f.db,f.candidate))!.version).toBe("wallet-input-v4");
},20000);
it("keeps empty archive histories blocking and avoids purchasing them again",async()=>{
  const f=await fixture();f.transport.mockImplementation(async(_url,init)=>{const b=JSON.parse(String(init?.body));return Response.json({jsonrpc:"2.0",id:b.id,result:b.method==="getGenesisHash"?MAINNET_GENESIS:[]});});await continueFunding(f.db,f.candidate,f.rpc());
  const calls=f.transport.mock.calls.length,plan=await walletPlan(f.db,f.candidate,new Date());expect(plan.stage).toBe("source_limited");expect(plan.gaps).toContain("provider_history_ended_before_window_boundary");expect(f.transport).toHaveBeenCalledTimes(calls);
});
it("preserves shared RPC failures and the per-turn network ceiling",async()=>{
  const f=await fixture();const reserve=vi.fn(async()=>{throw new SourceError("rpc_daily_budget_exhausted",3600);});const rpc=new RpcClient("https://rpc.example",reserve,f.transport,18);await expect(continueFunding(f.db,f.candidate,rpc)).rejects.toThrow();expect(f.transport).not.toHaveBeenCalled();expect(f.candidate.wallet_analysis.version).toBe("wallet-signals-v4");
});
it("retains the old eight-window schema and only admits twenty in v5",async()=>{
  const f=await fixture(),expanded=await expandedFundingScope(f.db,f.input);expect(WalletEvidenceSchema.safeParse({...expanded,version:"wallet-input-v4"}).success).toBe(false);expect(directFundingLimit(f.input)).toBe(8);expect(directFundingLimit(expanded)).toBe(20);
  expect(WalletEvidenceSchema.safeParse({...expanded,funding_scans:Array(21).fill(expanded.funding_scans![0])}).success).toBe(false);const r=await analyzeWalletEvidence(expanded);expect(WalletAnalysisSchema.safeParse({...r,version:"wallet-signals-v4"}).success).toBe(false);
  await expect(recoverCachedFunding(f.db,expanded.funding_scans!,at)).rejects.toThrow("funding_wallet_limit");expect((await recoverCachedFunding(f.db,expanded.funding_scans!,at,20)).scans).toHaveLength(10);
});
it("keeps omitted buyers and creation wallets blocking even when the input flag is cleared",async()=>{
  const f=await fixture(),expanded=await expandedFundingScope(f.db,f.input);expanded.funding_scans=expanded.funding_scans!.slice(1,-1);expanded.gaps=[];const r=await analyzeWalletEvidence(expanded);expect(r.gaps).toContain("funding_wallet_limit");expect(r.gaps).toContain("buyer_funding_histories_not_all_sampled");expect(assess({...f.candidate,wallet_analysis:r},DEFAULT_POLICY,at).reasons).toContain("pre_buy_funding_coverage_partial");
});
it("does not bypass other output, byte or twelve-body bounds",async()=>{
  const f=await fixture(),oversized=structuredClone(f.input);oversized.gaps.push("wallet_transaction_sample_limit");const a=await analyzeWalletEvidence(oversized),c={...f.candidate,wallet_analysis:a};await f.db.prepare("INSERT INTO tenx_wallet_evidence VALUES(?,?,?,?)").bind(a.evidence_hash,c.address,JSON.stringify(oversized),a.observed_at).run();const p=await walletPlan(f.db,c,at);expect(p.stage).toBe("source_limited");expect(p.gaps).toContain("wallet_snapshot_sample_bound");
  const expanded=await expandedFundingScope(f.db,f.input),scan=expanded.funding_scans![0]!;scan.pages=[{before:scan.anchor.signature,fetched_at:f.input.observed_at,rows:Array.from({length:13},(_,i)=>({signature:signature(180+i),slot:scan.anchor.slot-i-1,blockTime:Date.parse(scan.anchor.block_time)/1000-i-1,err:null,confirmationStatus:"finalized"}))}];expect(fundingTask(scan).gaps).toContain("funding_window_exceeds_transaction_bound");
});
it("rejects stale evidence tampering before any continuation request",async()=>{
  const f=await fixture();await expect(continueFunding(f.db,{...f.candidate,wallet_analysis:{...f.candidate.wallet_analysis,observed_at:at.toISOString()}},f.rpc())).rejects.toThrow("wallet_analysis_cache_replay_mismatch");expect(f.transport).not.toHaveBeenCalled();
});
it("does not downgrade a retained v5 snapshot through legacy maintenance",async()=>{
  const f=await fixture(),expanded=await expandedFundingScope(f.db,f.input),r=await analyzeWalletEvidence(expanded);expect(currentWalletReader(r.version)).toBe(true);await f.db.prepare("INSERT INTO tenx_wallet_evidence VALUES(?,?,?,?)").bind(r.evidence_hash,f.candidate.address,JSON.stringify(expanded),r.observed_at).run();await saveCandidate(f.db,{...f.candidate,wallet_analysis:r});expect((await replayLegacyWallets(f.db)).upgraded).toEqual([]);
});
