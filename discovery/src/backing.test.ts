import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync,readdirSync } from "node:fs";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import { backingList, backingRecord, evaluateBacking, freezeBacking, openBacking, settleBacking } from "./backing";
import { BackingOpening, BackingEvidence, type Opening, type Evidence } from "./backing-model";
import { fixtureCandidates } from "./fixtures";
import { gateSample, key, now, trade } from "./wallet-fixtures.test-helper";
import { assess, DEFAULT_POLICY, type Candidate } from "./model";
import { curveAddress } from "./pump";
import { hashJson, toBase58 } from "./solana";
import worker, { type LocalEnv } from "./worker";
import { WalletTransactionSchema } from "./wallet-rpc";
import { saveCandidate } from "./store";
import { referenceMicros } from "./backing-history";

const databases: DatabaseSync[]=[];
afterEach(()=>{databases.splice(0).forEach(db=>db.close());vi.restoreAllMocks();});
const assumptions={assumed_sol_usd:100,minimum_trade_usd:1,per_identity_cap_usd:100};
const identity="11111111-1111-4111-8111-111111111111";
async function candidate():Promise<Candidate>{
  const c=(await fixtureCandidates(now))[0]!,w=await gateSample();
  return {...c,mode:"live",risk:{...c.risk,holder_concentration:"verified"},wallet_analysis:{...w,signals:[]},holders:{version:"owners-v2",status:"verified",layout_certified:true,observed_at:now.toISOString(),context_slot:30000,payload_hash:"a".repeat(64),supply_raw:"10000",inventoried_raw:"10000",account_count:200,holder_count:200,top1_pct:1,top10_pct:10,pool_pct:20,creator_pct:1,creator:key(7),owners:[],gaps:[]}};
}
async function sample(){
  const c=await candidate(),opening=BackingOpening.parse({version:"backing-opening-v1",id:crypto.randomUUID(),starts_at:now.toISOString(),ends_at:new Date(now.getTime()+60000).toISOString(),deadline:new Date(now.getTime()+360000).toISOString(),policy:DEFAULT_POLICY,assumptions,candidates:[c],members:[{address:key(8),identity_id:identity,linked_at:now.toISOString()},{address:key(9),identity_id:identity,linked_at:now.toISOString()}],candidate_scope:"up_to_20_observed_contenders"});
  const evidence=BackingEvidence.parse({version:"backing-evidence-v1",frozen_at:opening.deadline,closing_candidates:[c],revoked_wallets:[],transactions:[],scan_limited:false,source:"cached_finalized_mainnet_rpc"});
  return {c,opening,evidence};
}
async function transaction(wallet=key(8),sig=31,side="buy",quote=1000000000n,base=100n,seconds=10){
  const tx=await trade(wallet,10001+sig,side,sig),mint=(await fixtureCandidates(now))[0]!.address,curve=await curveAddress(mint),system="11111111111111111111111111111111";
  tx.blockTime=Math.floor(now.getTime()/1000)+seconds;
  const keys=tx.transaction.message.accountKeys;
  if(!keys.includes(system)){keys.push(system);tx.meta!.preBalances.push(10000);tx.meta!.postBalances.push(10000);}
  const bytes=(v:bigint)=>{const a=new Uint8Array(8);new DataView(a.buffer).setBigUint64(0,v,true);return [...a];};
  tx.meta!.innerInstructions![0]!.instructions[0]!.data=toBase58(Uint8Array.from([3,...bytes(base)]));
  tx.meta!.preTokenBalances[0]!.uiTokenAmount.amount=side==="buy"?"0":base.toString();tx.meta!.postTokenBalances[0]!.uiTokenAmount.amount=side==="buy"?base.toString():"0";
  tx.meta!.innerInstructions![0]!.instructions.push({programIdIndex:keys.indexOf(system),accounts:side==="buy"?[keys.indexOf(wallet),keys.indexOf(curve)]:[keys.indexOf(curve),keys.indexOf(wallet)],stackHeight:2,data:toBase58(Uint8Array.from([2,0,0,0,...bytes(quote)]))});
  const normalized=WalletTransactionSchema.parse(tx);
  return {signature:normalized.transaction.signatures[0]!,payload_hash:await hashJson(normalized),fetched_at:new Date(now.getTime()+Math.max(1000,seconds*1000)).toISOString(),transaction:normalized};
}
function database(){
  const sqlite=new DatabaseSync(":memory:");databases.push(sqlite);
  // Database write time is independent of JS request time in production.
  let clock=now.toISOString();sqlite.function("strftime",{varargs:true},()=>clock);
  for(const file of readdirSync(new URL("../migrations",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../migrations/${file}`,import.meta.url),"utf8"));
  const base=sqliteD1(sqlite);let tail:Promise<unknown>=Promise.resolve();
  const db={...base,batch(statements:D1PreparedStatement[]){const result=tail.then(()=>base.batch(statements));tail=result.catch(()=>{});return result;}} as D1Database;
  return {sqlite,db,setClock:(value:Date)=>{clock=value.toISOString();}};
}
async function putCandidate(db:D1Database,c:Candidate){await db.prepare("INSERT OR REPLACE INTO tenx_candidates(address,pool,mode,payload,checked_at) VALUES(?,?,'live',?,?)").bind(c.address,c.pool,JSON.stringify(c),c.checked_at).run();}
const request=(id=crypto.randomUUID())=>({request_id:id,reason:"Offline prospective backing experiment",duration_minutes:1,assumptions});
describe("finalized-cache backing ledger and frozen experiments",()=>{
  it("decodes real instruction paths, groups multiple signed wallets under one cap and gives zero live votes",async()=>{
    const {opening,evidence}=await sample();expect(assess(opening.candidates[0]!,DEFAULT_POLICY,now).eligibility).toBe("eligible");
    evidence.transactions=[await transaction(),await transaction(key(9),32)];
    const result=await evaluateBacking(opening,evidence);
    expect(result.entries).toHaveLength(2);expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({buys:2,sells:0,net_quote_lamports_raw:"2000000000",hypothetical_net_usd_micros:"200000000",linear_projection_micros:"100000000",sqrt_projection_micros:"10000000",reasons:[]});
    expect(result).toMatchObject({winner_address:null,outcome:"withheld",voting_enabled:false,rewards_enabled:false,pricing:"hypothetical_fixed_SOL_USD_not_verified_valuation"});
    expect(result.gaps).toContain("source_coverage_not_exhaustive");
  });
  it("subtracts sells across linked wallets and detects round trips even with positive quote spend",async()=>{
    const {opening,evidence}=await sample();evidence.transactions=[await transaction(),await transaction(key(9),32,"sell",900000000n)];
    const result=await evaluateBacking(opening,evidence);expect(result.groups[0]).toMatchObject({net_base_raw:"0",net_quote_lamports_raw:"100000000",linear_projection_micros:"0"});
    expect(result.groups[0]!.reasons).toContain("no_positive_net_token_purchase");
    evidence.transactions[1]=await transaction(key(9),32,"sell",200000000n,50n);
    const partial=await evaluateBacking(opening,evidence);expect(partial.groups[0]).toMatchObject({net_base_raw:"50",linear_projection_micros:"80000000"});
  });
  it("does not count old holdings, out-of-window buys or trades at the end boundary",async()=>{
    const {opening,evidence}=await sample();evidence.transactions=[await transaction(key(8),31,"buy",1000000000n,100n,-1),await transaction(key(8),32,"buy",1000000000n,100n,60),await transaction(key(8),33,"sell")];
    const result=await evaluateBacking(opening,evidence);expect(result.ignored_transactions).toBe(2);expect(result.entries).toHaveLength(1);expect(result.groups[0]!.linear_projection_micros).toBe("0");
  });
  it("holds unknown quotes, missing membership, revoked links and funding signals instead of inventing clean activity",async()=>{
    const {opening,evidence}=await sample();evidence.transactions=[await transaction()];
    evidence.transactions[0]!.transaction.meta!.innerInstructions![0]!.instructions.pop();evidence.transactions[0]!.payload_hash=await hashJson(evidence.transactions[0]!.transaction);
    expect((await evaluateBacking(opening,evidence)).groups[0]!.reasons).toContain("quote_amount_unmeasured");
    evidence.transactions=[await transaction()];evidence.revoked_wallets=[key(8)];
    expect((await evaluateBacking(opening,evidence)).groups[0]!.reasons).toContain("wallet_unlinked_during_window");
    evidence.revoked_wallets=[];evidence.closing_candidates[0]!.wallet_analysis!.signals=[{code:"shared_direct_funding_source",wallets:[key(8)],signatures:[],strength:"heuristic"}];
    expect((await evaluateBacking(opening,evidence)).groups[0]!.reasons).toContain("funding_or_coordination_signal");
    opening.members=[];const unlinked=await evaluateBacking(opening,evidence);expect(unlinked.entries[0]!.reasons).toContain("wallet_not_linked_at_open");expect(unlinked.groups).toHaveLength(0);
  });
  it("keeps every eligibility gate at opening and cutoff, including future market evidence",async()=>{
    const {opening,evidence}=await sample();evidence.transactions=[await transaction()];
    evidence.closing_candidates[0]!.market!.fetched_at=new Date(now.getTime()+61000).toISOString();
    const future=await evaluateBacking(opening,evidence);expect(future.groups[0]!.reasons).toContain("candidate_ineligible_at_close");
    evidence.closing_candidates=structuredClone(opening.candidates);opening.candidates[0]!.holders=null;
    expect((await evaluateBacking(opening,evidence)).groups[0]!.reasons).toContain("candidate_ineligible_at_open");
    opening.candidates[0]!.mode="fixture";await expect(evaluateBacking(opening,evidence)).rejects.toThrow("backing_fixture_input");
  });
  it("applies minimum buys before netting, always subtracts sells and uses exact integer arithmetic",async()=>{
    const {opening,evidence}=await sample();opening.assumptions.minimum_trade_usd=10;
    evidence.transactions=[await transaction(key(8),31,"buy",90000000n),await transaction(key(8),32,"buy",90000000n)];
    const small=await evaluateBacking(opening,evidence);expect(small.groups[0]!.linear_projection_micros).toBe("0");
    evidence.transactions=[await transaction(key(8),31,"buy",123456789n)];
    expect((await evaluateBacking(opening,evidence)).groups[0]).toMatchObject({hypothetical_net_usd_micros:"12345678",sqrt_projection_micros:"3513641"});
  });
  it("rejects source hash/signature/future-time conflicts and duplicate transactions",async()=>{
    const {opening,evidence}=await sample(),row=await transaction();evidence.transactions=[row,{...row}];
    await expect(evaluateBacking(opening,evidence)).rejects.toThrow("backing_duplicate_transaction");
    evidence.transactions=[{...row,payload_hash:"f".repeat(64)}];await expect(evaluateBacking(opening,evidence)).rejects.toThrow("backing_transaction_hash_mismatch");
    evidence.transactions=[{...row,fetched_at:new Date(Date.parse(opening.deadline)+1).toISOString()}];await expect(evaluateBacking(opening,evidence)).rejects.toThrow("backing_transaction_time_mismatch");
    opening.members[0]!.linked_at=new Date(now.getTime()+1).toISOString();await expect(evaluateBacking(opening,evidence)).rejects.toThrow("backing_membership_mismatch");
  });
  it("is deterministic under source arrival order and preserves same-tx instruction identity",async()=>{
    const {opening,evidence}=await sample();evidence.transactions=[await transaction(),await transaction(key(9),32)];
    expect(await evaluateBacking(opening,{...evidence,transactions:[...evidence.transactions].reverse()})).toEqual(await evaluateBacking(opening,evidence));
    const row=evidence.transactions[0]!,tx=row.transaction;
    tx.transaction.message.instructions.push(structuredClone(tx.transaction.message.instructions[0]!));tx.meta!.innerInstructions!.push({...structuredClone(tx.meta!.innerInstructions![0]!),index:1});tx.meta!.postTokenBalances[0]!.uiTokenAmount.amount="200";row.payload_hash=await hashJson(tx);
    const result=await evaluateBacking(opening,{...evidence,transactions:[row]});expect(new Set(result.entries.map(e=>e.instruction_index)).size).toBe(2);
    expect(result.groups[0]!.net_base_raw).toBe("200");
  });
  it("opens once, freezes membership before trading, refuses early close and replays after source changes without RPC",async()=>{
    const {db,sqlite}=database(),c=await candidate(),r=request(),provider=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("provider forbidden"));await putCandidate(db,c);
    sqlite.prepare("INSERT INTO tenx_identities VALUES(?,?)").run(identity,now.toISOString());sqlite.prepare("INSERT INTO tenx_identity_wallets VALUES(?,?,?)").run(key(8),identity,now.toISOString());
    const opened=await openBacking(db,r,now);expect(opened).toMatchObject({state:"open",frozen_wallet_count:1,eligible_at_open:1});
    expect((await openBacking(db,r,new Date(now.getTime()+10000))).opening_hash).toBe(opened.opening_hash);
    await expect(openBacking(db,{...r,assumptions:{...assumptions,assumed_sol_usd:101}},now)).rejects.toThrow("backing_request_conflict");
    await expect(openBacking(db,request(),now)).rejects.toThrow("backing_active_daily_limit_or_membership_changed");
    await expect(freezeBacking(db,r.request_id,now)).rejects.toThrow("backing_source_deadline_not_reached");
    const t=await transaction();sqlite.prepare("INSERT INTO tenx_wallet_transactions VALUES(?,?,?,?)").run(t.signature,t.payload_hash,JSON.stringify(t.transaction),t.fetched_at);
    sqlite.prepare("INSERT INTO tenx_identity_wallets VALUES(?,?,?)").run(key(9),identity,new Date(now.getTime()+10000).toISOString());
    const deadline=new Date(now.getTime()+360000),frozen=await freezeBacking(db,r.request_id,deadline);expect(frozen).toMatchObject({state:"frozen",entries:1,groups:1,replay:"hash_checked"});
    const record=await backingRecord(db,r.request_id);expect(record!.opening.members).toHaveLength(1);expect(record!.result.groups[0]!.linear_projection_micros).toBe("100000000");
    sqlite.exec("DELETE FROM tenx_wallet_transactions;DELETE FROM tenx_identity_wallets");await putCandidate(db,{...c,holders:null});
    expect((await backingRecord(db,r.request_id))!.record_hash).toBe(record!.record_hash);expect((await freezeBacking(db,r.request_id,deadline)).record_hash).toBe(record!.record_hash);
    const publicList=await backingList(db);expect(JSON.stringify(publicList)).not.toContain(identity);expect(JSON.stringify(publicList)).not.toContain(key(8));expect(provider).not.toHaveBeenCalled();
    expect(sqlite.prepare("SELECT count(*) n FROM tenx_audit WHERE action LIKE 'backing_%'").get()?.n).toBe(2);
  });
  it("detects retained-evidence tampering and excludes post-deadline arrivals permanently",async()=>{
    const {db,sqlite}=database(),r=request();await putCandidate(db,await candidate());await openBacking(db,r,now);
    const late=await transaction();sqlite.prepare("INSERT INTO tenx_wallet_transactions VALUES(?,?,?,?)").run(late.signature,late.payload_hash,JSON.stringify(late.transaction),new Date(now.getTime()+360001).toISOString());
    await freezeBacking(db,r.request_id,new Date(now.getTime()+400000));expect((await backingRecord(db,r.request_id))!.result.entries).toHaveLength(0);
    sqlite.prepare("UPDATE tenx_backing_runs SET evidence=json_set(evidence,'$.scan_limited',json('true')) WHERE id=?").run(r.request_id);
    await expect(backingRecord(db,r.request_id)).rejects.toThrow("backing_replay_mismatch");
  });
  it("automatically settles a due window, reports source corruption and never bypasses it",async()=>{
    const {db,sqlite}=database(),r=request();await putCandidate(db,await candidate());await openBacking(db,r,now);
    expect(await settleBacking(db,now)).toEqual({state:"waiting"});
    const t=await transaction();sqlite.prepare("INSERT INTO tenx_wallet_transactions VALUES(?,?,?,?)").run(t.signature,"f".repeat(64),JSON.stringify(t.transaction),t.fetched_at);
    expect(await settleBacking(db,new Date(now.getTime()+360000))).toMatchObject({state:"failed",error:"backing_transaction_hash_mismatch"});
    expect((await backingList(db)).runs[0]!.last_error).toBe("backing_transaction_hash_mismatch");
    sqlite.prepare("UPDATE tenx_wallet_transactions SET payload_hash=?").run(t.payload_hash);
    expect(await settleBacking(db,new Date(now.getTime()+360000))).toMatchObject({state:"frozen"});
  });
  it("guards protected writes and evidence reads and forbids a caller-supplied policy",async()=>{
    const {db,setClock}=database(),env={TENX_DB:db,TENX_LOCAL_ONLY:"true",TENX_ADMIN_TOKEN:"a".repeat(64)} as LocalEnv,r=request();setClock(new Date(Date.now()+1000));
    const req=(path:string,body?:unknown,authorized=false)=>new Request(`http://127.0.0.1:8794/api/10x/${path}`,{...(body?{method:"POST",body:JSON.stringify(body)}:{}),headers:{"content-type":"application/json",...(authorized?{authorization:`Bearer ${"a".repeat(64)}`}:{})}});
    expect((await worker.fetch(req("admin/backing/open",r),env)).status).toBe(401);
    expect((await worker.fetch(req(`admin/backing/${r.request_id}`),env)).status).toBe(401);
    expect((await worker.fetch(req("admin/backing/open",{...r,policy:{require_wallet_analysis:false}},true),env)).status).toBe(400);
    expect((await worker.fetch(req("backing"),env)).status).toBe(200);
    expect((await worker.fetch(req("admin/backing/open",r,true),env)).status).toBe(200);
  });
  it("admits one concurrent opening and one immutable freeze with one audit each",async()=>{
    const {db,sqlite}=database(),r=request();await putCandidate(db,await candidate());
    const opened=await Promise.all([openBacking(db,r,now),openBacking(db,r,now)]);expect(opened[0].opening_hash).toBe(opened[1].opening_hash);
    const closed=await Promise.all([freezeBacking(db,r.request_id,new Date(now.getTime()+360000)),freezeBacking(db,r.request_id,new Date(now.getTime()+360001))]);
    expect(closed[0].record_hash).toBe(closed[1].record_hash);expect(sqlite.prepare("SELECT count(*) n FROM tenx_audit WHERE action LIKE 'backing_%'").get()?.n).toBe(2);
  });
  it("bounds source bodies and records truncation rather than claiming an exhaustive tally",async()=>{
    const {db,sqlite}=database(),r=request();await putCandidate(db,await candidate());await openBacking(db,r,now);
    const base=await transaction();
    for(let i=0;i<101;i++){
      const tx=structuredClone(base.transaction);tx.transaction.signatures[0]=toBase58(new Uint8Array(64).fill(i+1));
      sqlite.prepare("INSERT INTO tenx_wallet_transactions VALUES(?,?,?,?)").run(tx.transaction.signatures[0],await hashJson(tx),JSON.stringify(tx),base.fetched_at);
    }
    await freezeBacking(db,r.request_id,new Date(now.getTime()+360000));
    const record=await backingRecord(db,r.request_id);expect(record!.evidence.transactions.length).toBeLessThanOrEqual(100);expect(record!.evidence.scan_limited).toBe(true);expect(record!.result.gaps).toContain("transaction_scan_limit_reached");expect(record!.result.winner_address).toBeNull();
  });
  it("detects nontrade token transfers and same-transaction round trips instead of inflating purchases",async()=>{
    const {opening,evidence}=await sample(),t=await transaction();
    t.transaction.meta!.postTokenBalances[0]!.uiTokenAmount.amount="200";t.payload_hash=await hashJson(t.transaction);evidence.transactions=[t];
    expect((await evaluateBacking(opening,evidence)).groups[0]!.reasons).toContain("nontrade_transfer_or_incomplete_decode");
    const buy=await transaction(),sell=await transaction(key(8),32,"sell");
    const keys=buy.transaction.transaction.message.accountKeys,other=sell.transaction.transaction.message.accountKeys;
    const ix=structuredClone(sell.transaction.transaction.message.instructions[0]!);ix.programIdIndex=keys.indexOf(other[ix.programIdIndex]!);ix.accounts=ix.accounts.map(i=>keys.indexOf(other[i]!));buy.transaction.transaction.message.instructions.push(ix);
    buy.transaction.meta!.innerInstructions!.push({index:1,instructions:sell.transaction.meta!.innerInstructions![0]!.instructions.map(i=>({...i,programIdIndex:keys.indexOf(other[i.programIdIndex]!),accounts:i.accounts.map(a=>keys.indexOf(other[a]!))}))});
    buy.transaction.meta!.postTokenBalances[0]!.uiTokenAmount.amount="0";buy.payload_hash=await hashJson(buy.transaction);evidence.transactions=[buy];
    expect((await evaluateBacking(opening,evidence)).groups[0]!.reasons).toContain("same_transaction_round_trip");
  });
  it("refuses a future opening snapshot without leaving an unfreezable active run",async()=>{
    const {db,sqlite}=database(),c=await candidate();c.market!.fetched_at=new Date(now.getTime()+1).toISOString();await putCandidate(db,c);
    await expect(openBacking(db,request(),now)).rejects.toThrow("backing_opening_evidence_from_future");expect(sqlite.prepare("SELECT count(*) n FROM tenx_backing_runs").get()?.n).toBe(0);
  });
  it("retains a failing pre-cutoff snapshot after late cleanup, and seals the journal",async()=>{
    const {db,sqlite,setClock}=database(),c=await candidate(),r=request();await putCandidate(db,c);await openBacking(db,r,now);
    setClock(new Date(now.getTime()+59000));
    await db.prepare("UPDATE tenx_candidates SET payload=json_set(payload,'$.holders',NULL) WHERE address=?").bind(c.address).run();
    const captured=sqlite.prepare("SELECT * FROM tenx_backing_candidate_history").get();expect(captured?.recorded_at).toBe(new Date(now.getTime()+59000).toISOString());
    setClock(new Date(now.getTime()+61000));await putCandidate(db,c);
    await freezeBacking(db,r.request_id,new Date(now.getTime()+360000));
    const record=(await backingRecord(db,r.request_id))!;expect(record.result.algorithm).toBe("backing-experiment-v2");expect(record.evidence.closing_candidates[0]!.holders).toBeNull();expect(record.result.projections[0]!.eligible_at_close).toBe(false);
    expect(()=>sqlite.exec("UPDATE tenx_backing_candidate_history SET recorded_at='2026-10-20T00:00:00.000Z'")).toThrow("backing_history_immutable");
    expect(()=>sqlite.exec("DELETE FROM tenx_backing_candidate_history")).toThrow("backing_history_immutable");
    expect(record.evidence.cutoff!.selected[0]!.sequence).not.toBeNull();
  });
  it("captures effective merged evidence in the source-write transaction and rolls it back on error",async()=>{
    const {db,sqlite,setClock}=database(),c=await candidate(),r=request();await putCandidate(db,c);await openBacking(db,r,now);
    setClock(new Date(now.getTime()+10000));
    const newer={...c,risk:{...c.risk,observed_at:new Date(now.getTime()+10000).toISOString()}};
    await saveCandidate(db,newer);setClock(new Date(now.getTime()+20000));
    await saveCandidate(db,{...c,checked_at:new Date(now.getTime()+20000).toISOString()});
    const last=sqlite.prepare("SELECT payload FROM tenx_backing_candidate_history ORDER BY sequence DESC LIMIT 1").get();expect(JSON.parse(String(last!.payload)).risk.observed_at).toBe(newer.risk.observed_at);
    const before=sqlite.prepare("SELECT count(*) n FROM tenx_backing_candidate_history").get()!.n;
    await expect(db.batch([db.prepare("UPDATE tenx_candidates SET payload=json_set(payload,'$.holders',NULL) WHERE address=?").bind(c.address),db.prepare("INSERT INTO table_that_does_not_exist VALUES(1)")])).rejects.toThrow();
    expect(sqlite.prepare("SELECT count(*) n FROM tenx_backing_candidate_history").get()!.n).toBe(before);
    expect(JSON.parse(String(sqlite.prepare("SELECT payload FROM tenx_candidates").get()!.payload)).holders).not.toBeNull();
  });
  it("captures cutoff equality and ignores unchanged rows and post-cutoff writes",async()=>{
    const {db,sqlite,setClock}=database(),c=await candidate(),r=request();await putCandidate(db,c);await openBacking(db,r,now);
    await db.prepare("UPDATE tenx_candidates SET payload=payload").run();expect(sqlite.prepare("SELECT count(*) n FROM tenx_backing_candidate_history").get()!.n).toBe(0);
    setClock(new Date(now.getTime()+60000));await db.prepare("UPDATE tenx_candidates SET payload=json_set(payload,'$.market.price_usd',0.1)").run();
    setClock(new Date(now.getTime()+60001));await db.prepare("UPDATE tenx_candidates SET payload=json_set(payload,'$.market.price_usd',999)").run();
    expect(sqlite.prepare("SELECT count(*) n FROM tenx_backing_candidate_history").get()!.n).toBe(1);
    await freezeBacking(db,r.request_id,new Date(now.getTime()+360000));expect((await backingRecord(db,r.request_id))!.evidence.closing_candidates[0]!.market!.price_usd).toBe(0.1);
  });
  it("holds all closing gates on byte-cap exhaustion or candidate deletion while allowing collectors to continue",async()=>{
    const {db,sqlite,setClock}=database(),c=await candidate(),r=request();await putCandidate(db,c);await openBacking(db,r,now);setClock(new Date(now.getTime()+10000));
    // Oversized raw row is allowed by SQLite but not retained; the collector is not blocked by the journal cap.
    await db.prepare("UPDATE tenx_candidates SET payload=json_set(payload,'$.name',?)").bind("x".repeat(600001)).run();
    expect(sqlite.prepare("SELECT history_limited FROM tenx_backing_runs").get()!.history_limited).toBe(1);expect(sqlite.prepare("SELECT count(*) n FROM tenx_backing_candidate_history").get()!.n).toBe(0);
    await putCandidate(db,c);await freezeBacking(db,r.request_id,new Date(now.getTime()+360000));const record=(await backingRecord(db,r.request_id))!;
    expect(record.result.coverage_detail!.cutoff).toBe("history_limited");expect(record.result.projections[0]!.eligible_at_close).toBe(false);expect(record.result.gaps).toContain("cutoff_history_capacity_or_candidate_loss");
    // A new window tests the independent deletion guard.
    const second=request(),later=new Date(now.getTime()+400000);setClock(later);await openBacking(db,second,later);await db.prepare("DELETE FROM tenx_candidates").run();
    expect(sqlite.prepare("SELECT history_limited FROM tenx_backing_runs WHERE id=?").get(second.request_id)!.history_limited).toBe(1);
  });
  it("bounds snapshot count atomically and deduplicates consecutive payloads",async()=>{
    const {db,sqlite,setClock}=database(),c=await candidate(),r=request();await putCandidate(db,c);await openBacking(db,r,now);setClock(new Date(now.getTime()+10000));
    // Small raw payloads isolate the row-count bound from the byte bound; they are never used for settlement.
    for(let i=0;i<201;i++)await db.prepare("UPDATE tenx_candidates SET payload=?").bind(JSON.stringify({address:c.address,n:i})).run();
    expect(sqlite.prepare("SELECT count(*) n FROM tenx_backing_candidate_history").get()!.n).toBe(200);expect(sqlite.prepare("SELECT history_limited FROM tenx_backing_runs").get()!.history_limited).toBe(1);
  });
  it("retains provider price references without lookahead or live USD credit",async()=>{
    const {db,sqlite,setClock}=database(),c=await candidate(),r=request();c.market!.price_usd=2;await putCandidate(db,c);await openBacking(db,r,now);
    const t=await transaction();sqlite.prepare("INSERT INTO tenx_wallet_transactions VALUES(?,?,?,?)").run(t.signature,t.payload_hash,JSON.stringify(t.transaction),t.fetched_at);
    setClock(new Date(now.getTime()+20000));await db.prepare("UPDATE tenx_candidates SET payload=json_set(payload,'$.market.price_usd',999,'$.market.fetched_at',?)").bind(new Date(now.getTime()+20000).toISOString()).run();
    await freezeBacking(db,r.request_id,new Date(now.getTime()+360000));const record=(await backingRecord(db,r.request_id))!,ref=record.result.price_references![0]!;
    const decimals=t.transaction.meta!.postTokenBalances[0]!.uiTokenAmount.decimals;
    expect(ref).toMatchObject({status:"provider_reference_only",reference_usd_micros:referenceMicros("100",decimals,2),verified_usd_micros:null,snapshot_sequence:null});
    expect(ref.gaps).toContain("provider_publication_time_unknown");expect(record.result.coverage_detail).toMatchObject({references_available:1,verified_usd_trades:0});
    await db.prepare("UPDATE tenx_candidates SET payload=json_set(payload,'$.market.price_usd',1000)").run();expect((await backingRecord(db,r.request_id))!.record_hash).toBe(record.record_hash);
  });
  it("withholds stale, ambiguous-decimal, missing and future price references and bounds extreme prices",async()=>{
    const {opening,evidence}=await sample();opening.cutoff_evidence_version="candidate-journal-v1";
    evidence.cutoff={version:"candidate-journal-v1",baseline_recorded_at:opening.starts_at,history_limited:false,selected:[{address:opening.candidates[0]!.address,sequence:null,recorded_at:opening.starts_at,payload_hash:await hashJson(opening.candidates[0]!)}],prices:[]};evidence.transactions=[await transaction()];
    const missing=await evaluateBacking(opening,evidence);expect(missing.price_references![0]!.gaps).toContain("no_pre_trade_price_available");
    const p={address:opening.candidates[0]!.address,sequence:null,recorded_at:opening.starts_at,source:"dexscreener" as const,fetched_at:new Date(now.getTime()-180001).toISOString(),observed_at:null,price_usd:2};evidence.cutoff.prices=[p];
    expect((await evaluateBacking(opening,evidence)).price_references![0]!.gaps).toContain("pre_trade_price_stale");
    p.fetched_at=new Date(now.getTime()+1000).toISOString();expect((await evaluateBacking(opening,evidence)).price_references![0]!.reference_usd_micros).toBeNull();
    p.fetched_at=opening.starts_at;p.price_usd=1e308;expect((await evaluateBacking(opening,evidence)).price_references![0]!.gaps).toContain("price_reference_out_of_bounds");
    p.price_usd=2;evidence.transactions[0]!.transaction.meta!.preTokenBalances[0]!.uiTokenAmount.decimals=8;evidence.transactions[0]!.transaction.meta!.postTokenBalances[0]!.uiTokenAmount.decimals=9;evidence.transactions[0]!.payload_hash=await hashJson(evidence.transactions[0]!.transaction);
    expect((await evaluateBacking(opening,evidence)).price_references![0]!.gaps).toContain("mint_decimals_missing_or_ambiguous");
    expect(referenceMicros("123456789",9,1.23456789)).toBe("152415");expect(referenceMicros("1000000000",9,1.2e-7)).toBe("0");expect(referenceMicros("1",0,1.2e7)).toBe("12000000000000");
  });
  it("keeps legacy inputs byte compatible and refuses missing or changed new cutoff provenance",async()=>{
    const {opening,evidence}=await sample(),old=await evaluateBacking(opening,evidence);
    expect(old.algorithm).toBe("backing-experiment-v1");expect(old).not.toHaveProperty("price_references");expect(old).not.toHaveProperty("coverage_detail");
    opening.cutoff_evidence_version="candidate-journal-v1";await expect(evaluateBacking(opening,evidence)).rejects.toThrow("backing_cutoff_history_missing");
    evidence.cutoff={version:"candidate-journal-v1",baseline_recorded_at:opening.starts_at,history_limited:false,selected:[{address:opening.candidates[0]!.address,sequence:null,recorded_at:opening.starts_at,payload_hash:"f".repeat(64)}],prices:[]};
    await expect(evaluateBacking(opening,evidence)).rejects.toThrow("backing_cutoff_snapshot_mismatch");
  });
  it("rejects candidate changes between snapshot read and atomic admission",async()=>{
    const {db,sqlite}=database(),c=await candidate();await putCandidate(db,c);
    const racing={...db,batch:async(statements:D1PreparedStatement[])=>{
      await db.prepare("UPDATE tenx_candidates SET payload=json_set(payload,'$.holders',NULL)").run();return db.batch(statements);
    }} as D1Database;
    await expect(openBacking(racing,request(),now)).rejects.toThrow("backing_active_daily_limit_or_membership_changed");
    expect(sqlite.prepare("SELECT count(*) n FROM tenx_backing_runs").get()!.n).toBe(0);expect(sqlite.prepare("SELECT count(*) n FROM tenx_audit WHERE action='backing_open'").get()!.n).toBe(0);
  });
  it("does not capture fixture or out-of-scope candidates, and does not trust future-dated retained sources",async()=>{
    const {db,sqlite,setClock}=database(),c=await candidate();await putCandidate(db,c);const r=request();await openBacking(db,r,now);setClock(new Date(now.getTime()+10000));
    const outsider={...c,address:key(99)};await putCandidate(db,outsider);
    await db.prepare("INSERT INTO tenx_candidates(address,pool,mode,payload,checked_at) VALUES(?,?,'fixture',?,?)").bind(key(98),c.pool,JSON.stringify({...c,address:key(98),mode:"fixture"}),c.checked_at).run();
    expect(sqlite.prepare("SELECT count(*) n FROM tenx_backing_candidate_history").get()!.n).toBe(0);
    await db.prepare("UPDATE tenx_candidates SET payload=json_set(payload,'$.risk.observed_at',?) WHERE address=? AND mode='live'").bind(new Date(now.getTime()+20000).toISOString(),c.address).run();
    await freezeBacking(db,r.request_id,new Date(now.getTime()+360000));expect((await backingRecord(db,r.request_id))!.result.projections[0]!.eligible_at_close).toBe(false);
  });
  it("holds history coverage when a contender leaves the live scope without deletion",async()=>{
    const {db,sqlite,setClock}=database(),c=await candidate(),r=request();await putCandidate(db,c);await openBacking(db,r,now);setClock(new Date(now.getTime()+10000));
    await db.prepare("UPDATE tenx_candidates SET mode='fixture' WHERE address=?").bind(c.address).run();
    expect(sqlite.prepare("SELECT history_limited FROM tenx_backing_runs").get()!.history_limited).toBe(1);
    await freezeBacking(db,r.request_id,new Date(now.getTime()+360000));expect((await backingRecord(db,r.request_id))!.result.coverage_detail!.cutoff).toBe("history_limited");
  });
});
