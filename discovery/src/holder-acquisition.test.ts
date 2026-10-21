import {afterEach,describe,expect,it,vi} from "vitest";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {sqliteD1} from "../../app/functions/_lib/sqliteTestDb";
import {holderAcquisitionFixture,acquisitionInput,acquisitionTrade,acquisitionWallet} from "./holder-acquisition-fixtures.test-helper";
import {reviewHolderAcquisition,replayHolderAcquisitionRecord} from "./holder-acquisition";
import {holderAcquisition} from "./holder-acquisition-store";
import {HolderAcquisitionReportSchema} from "./holder-acquisition-model";
import {hashJson,toBase58} from "./solana";
import {key,signature} from "./wallet-fixtures.test-helper";
import type {WalletEvidence} from "./wallet-analysis";
import worker,{type LocalEnv} from "./worker";
const opened:DatabaseSync[]=[];
afterEach(()=>{opened.splice(0).forEach(db=>db.close());vi.restoreAllMocks();vi.useRealTimers();});
const wallet=(input:Awaited<ReturnType<typeof holderAcquisitionFixture>>)=>structuredClone(input.wallet!.evidence as WalletEvidence);
describe("cached signed acquisition evidence",()=>{
  it("supports an entrant only from matched canonical signed net buys, preserving every qualification gate",async()=>{
    const inputs=await holderAcquisitionFixture(),report=await reviewHolderAcquisition(inputs);
    expect(report.since_first).toMatchObject({status:"measured_sample",raw_entrants:1,supported_net_buy_entrants:1,acquisition_unknown_entrants:0,interval_sampled_trades:1,finalized_matched_transactions:1});
    // This buyer already existed at the middle inventory, so its later buy
    // cannot manufacture another entrant in the most recent interval.
    expect(report.recent?.supported_net_buy_entrants).toBe(0);expect(report.meaningful_holder_growth).toBeNull();expect(report.organic_demand_certified).toBe(false);expect(report.scoring_effect).toBe("none");
    expect(await replayHolderAcquisitionRecord({inputs,report})).toEqual(report);
    await expect(replayHolderAcquisitionRecord({inputs,report:{...report,wallet_stale:true}})).rejects.toThrow("report_mismatch");
    const{report_hash,...raw}=report;expect(await hashJson(raw)).toBe(report_hash);
  });
  it("counts transaction-wide net flow once across multiple buy instructions",async()=>{
    const inputs=await holderAcquisitionFixture(),tx=await acquisitionTrade();
    tx.transaction.message.instructions.push(structuredClone(tx.transaction.message.instructions[0]!));
    tx.meta!.innerInstructions!.push({...structuredClone(tx.meta!.innerInstructions![0]!),index:1});tx.meta!.postTokenBalances[0]!.uiTokenAmount.amount="200";
    const report=await reviewHolderAcquisition(await acquisitionInput(inputs.history,await acquisitionWallet([tx])));
    expect(report.since_first).toMatchObject({supported_net_buy_entrants:1,interval_sampled_trades:2,finalized_matched_transactions:1});
  });
  it.each(["missing_history","quote","mixed","sold","balance","unsigned","outside_slot","outside_time"])("keeps %s activity from supporting a raw entrant",async reason=>{
    const inputs=await holderAcquisitionFixture(),source=wallet(inputs),tx=source.records[0]!.transaction!;
    if(reason==="missing_history")source.histories[0]!.rows=[];
    if(reason==="quote")tx.meta!.innerInstructions![0]!.instructions.pop();
    if(reason==="mixed")tx.meta!.postTokenBalances[0]!.uiTokenAmount.amount="101";
    if(reason==="sold"){
      const sell=await acquisitionTrade("sell",72,31020);source.records.push({signature:sell.transaction.signatures[0]!,fetched_at:source.records[0]!.fetched_at,status:"available",purposes:["recent"],transaction:sell});
      source.histories[0]!.rows.push({signature:sell.transaction.signatures[0]!,slot:sell.slot,blockTime:sell.blockTime,err:null,confirmationStatus:"finalized"});
    }
    if(reason==="balance"){
      tx.meta!.postTokenBalances[0]!.uiTokenAmount.amount="100000001";const data=new Uint8Array(9);data[0]=3;new DataView(data.buffer).setBigUint64(1,100000001n,true);
      tx.meta!.innerInstructions![0]!.instructions[0]!.data=toBase58(data);
    }
    if(reason==="unsigned")tx.transaction.message.header.numRequiredSignatures=2;
    if(reason==="outside_slot")tx.slot=29999,source.histories[0]!.rows[0]!.slot=29999;
    if(reason==="outside_time")tx.blockTime=Date.parse("2026-10-21T07:59:00Z")/1000,source.histories[0]!.rows[0]!.blockTime=tx.blockTime;
    const report=await reviewHolderAcquisition(await acquisitionInput(inputs.history,source));
    expect(report.since_first?.supported_net_buy_entrants).toBe(0);expect(report.since_first?.acquisition_unknown_entrants).toBe(1);
    if(reason==="sold")expect(report.since_first?.exclusions.two_sided_or_round_trip).toBe(1);
    if(reason==="mixed")expect(report.since_first?.exclusions.mixed_or_nonpositive_transaction_flow).toBe(1);
    if(reason==="balance")expect(report.since_first?.exclusions.endpoint_balance_below_sampled_acquisition).toBe(1);
  });
  it("distinguishes missing samples, no matching buys and conflicting latest receipts",async()=>{
    const inputs=await holderAcquisitionFixture();
    expect((await reviewHolderAcquisition(await acquisitionInput(inputs.history,null))).since_first).toMatchObject({status:"held",supported_net_buy_entrants:null,acquisition_unknown_entrants:1});
    expect((await reviewHolderAcquisition(await acquisitionInput(inputs.history,await acquisitionWallet()))).since_first).toMatchObject({status:"measured_sample",supported_net_buy_entrants:0,acquisition_unknown_entrants:1});
    inputs.wallet_index.push({...inputs.wallet_index[0]!,evidence_hash:"f".repeat(64)});inputs.wallet=null;
    expect((await reviewHolderAcquisition(inputs)).gaps).toContain("wallet_receipt_timestamp_conflict");
  });
  it("rejects altered receipts, foreign scope, future evidence and conflicting finalized rows",async()=>{
    const inputs=await holderAcquisitionFixture(),changed=structuredClone(inputs);(changed.wallet!.evidence as WalletEvidence).gaps.push("tampered");
    await expect(reviewHolderAcquisition(changed)).rejects.toThrow("raw_hash_mismatch");
    const source=wallet(inputs);source.asset.pool=key(250);
    await expect(reviewHolderAcquisition(await acquisitionInput(inputs.history,source))).rejects.toThrow("scope_mismatch");
    const future=wallet(inputs);future.records[0]!.fetched_at="2026-10-21T10:00:00.000Z";
    await expect(reviewHolderAcquisition(await acquisitionInput(inputs.history,future))).rejects.toThrow("future");
    const futureHistory=wallet(inputs);futureHistory.histories[0]!.fetched_at="2026-10-21T09:04:00.000Z";
    await expect(reviewHolderAcquisition(await acquisitionInput(inputs.history,futureHistory))).rejects.toThrow("history_from_future");
    const pending=wallet(inputs);pending.histories[0]!.rows.push({...pending.histories[0]!.rows[0]!,confirmationStatus:"confirmed"});
    await expect(reviewHolderAcquisition(await acquisitionInput(inputs.history,pending))).rejects.toThrow("history_transaction_mismatch");
    const time=wallet(inputs);time.histories[0]!.rows[0]!.blockTime!--;
    expect((await reviewHolderAcquisition(await acquisitionInput(inputs.history,time))).since_first?.exclusions.missing_finalized_history).toBe(1);
  });
  it("bounds wallet bodies and holds partial owner comparisons",async()=>{
    const inputs=await holderAcquisitionFixture(),big=structuredClone(inputs);big.wallet!.evidence={body:"x".repeat(1_800_001)};
    await expect(reviewHolderAcquisition(big)).rejects.toThrow("byte_limit");
    const sample=inputs.history.samples.at(-1)!;const raw=sample.evidence as import("./holders").HolderEvidence;raw.inventory.value.shift();
    sample.payload_hash=await hashJson(raw);inputs.history.index.at(-1)!.payload_hash=sample.payload_hash;
    expect((await reviewHolderAcquisition(inputs)).since_first).toMatchObject({status:"held",supported_net_buy_entrants:null,raw_entrants:null});
  });
  it("holds every acquisition count when the existing wallet trade output is truncated",async()=>{
    const inputs=await holderAcquisitionFixture(),base=await acquisitionTrade();
    base.transaction.message.instructions.push(structuredClone(base.transaction.message.instructions[0]!));
    base.meta!.innerInstructions!.push({...structuredClone(base.meta!.innerInstructions![0]!),index:1});base.meta!.postTokenBalances[0]!.uiTokenAmount.amount="200";
    const transactions=Array.from({length:64},(_,i)=>{const tx=structuredClone(base);tx.transaction.signatures=[signature(100+i)];tx.slot=31010+i;return tx;});
    const report=await reviewHolderAcquisition(await acquisitionInput(inputs.history,await acquisitionWallet(transactions)));
    expect(report.since_first).toMatchObject({status:"held",supported_net_buy_entrants:null,acquisition_unknown_entrants:1});
    expect(report.gaps).toContain("wallet_trade_output_limit");
  });
  it("serves aggregate-only cache reads, authenticates private inputs and never writes or calls a provider",async()=>{
    const sqlite=new DatabaseSync(":memory:");opened.push(sqlite);for(const f of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../migrations/${f}`,import.meta.url),"utf8"));
    const db=sqliteD1(sqlite),inputs=await holderAcquisitionFixture();
    for(const meta of inputs.history.index)sqlite.prepare("INSERT INTO tenx_holder_evidence VALUES(?,?,?,?,?)").run(meta.payload_hash,meta.address,meta.slot,JSON.stringify(inputs.history.samples.find(row=>row.payload_hash===meta.payload_hash)!.evidence),meta.observed_at);
    const meta=inputs.wallet_index[0]!;sqlite.prepare("INSERT INTO tenx_wallet_evidence VALUES(?,?,?,?)").run(meta.evidence_hash,meta.address,JSON.stringify(inputs.wallet!.evidence),meta.observed_at);
    const before=sqlite.prepare("SELECT total_changes() n").get(),network=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("no provider IO"));vi.useFakeTimers();vi.setSystemTime(new Date(inputs.history.cutoff_at));
    expect((await holderAcquisition(db,inputs.history.address,new Date(inputs.history.cutoff_at))).report).toEqual(await reviewHolderAcquisition(inputs));
    const env={TENX_DB:db,TENX_LOCAL_ONLY:"true",TENX_ADMIN_TOKEN:"a".repeat(64)} as LocalEnv,path=`http://localhost/api/10x/holders/acquisition/solana/${meta.address}`;
    const read=await worker.fetch(new Request(path),env);expect(read.status).toBe(200);const report=HolderAcquisitionReportSchema.parse(await read.json());expect(JSON.stringify(report)).not.toContain('"records":');
    const privatePath=path.replace("/api/10x/","/api/10x/admin/");expect((await worker.fetch(new Request(privatePath),env)).status).toBe(401);
    expect(await(await worker.fetch(new Request(privatePath,{headers:{authorization:`Bearer ${env.TENX_ADMIN_TOKEN}`}}),env)).json()).toMatchObject({report:{report_hash:report.report_hash},inputs:{wallet:{evidence_hash:meta.evidence_hash}}});
    expect(network).not.toHaveBeenCalled();expect(sqlite.prepare("SELECT total_changes() n").get()).toEqual(before);
  });
});
