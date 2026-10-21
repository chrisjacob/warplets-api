import {afterEach,describe,expect,it,vi} from "vitest";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {sqliteD1} from "../../app/functions/_lib/sqliteTestDb";
import {participationFixture,participationTrade,participationFunding} from "./holder-participation-fixtures.test-helper";
import {acquisitionInput,acquisitionWallet} from "./holder-acquisition-fixtures.test-helper";
import {reviewHolderAcquisition} from "./holder-acquisition";
import {reviewHolderParticipation,replayHolderParticipationRecord} from "./holder-participation";
import {holderParticipation} from "./holder-participation-store";
import {HolderParticipation,verifyHolderParticipation,HOLDER_PARTICIPATION_POLICY as P} from "./holder-participation-model";
import {hashJson,toBase58} from "./solana";
import {key,signature} from "./wallet-fixtures.test-helper";
import {historyInput,historyAccount,holderHistoryFixture} from "./holder-history-fixtures.test-helper";
import {HolderEvidenceSchema} from "./holders";
import type {WalletEvidence} from "./wallet-analysis";
import type {WalletTransaction} from "./wallet-rpc";
const databases:DatabaseSync[]=[];
afterEach(()=>{databases.splice(0).forEach(db=>db.close());vi.restoreAllMocks();});
const source=(input:Awaited<ReturnType<typeof participationFixture>>)=>structuredClone(input.wallet!.evidence as WalletEvidence);
async function withTrades(transactions:WalletTransaction[]){return acquisitionInput(await holderHistoryFixture(),await acquisitionWallet(transactions));}
describe("fixed acquired and endpoint-retained sample",()=>{
  it("measures native size and mature retained acquisition without population or score credit; original v1 replay remains",async()=>{
    const inputs=await participationFixture(),old=await reviewHolderAcquisition(inputs),report=await reviewHolderParticipation(inputs);
    expect(report).toMatchObject({state:"available",freshness:"fresh",acquisition_hash:old.report_hash,history_hash:old.history.report_hash,policy_hash:await hashJson(P),since_first:{status:"measured_sample",raw_entrants:1,signed_net_buy_entrants:1,screened_retained_entrants:1,partitions:{supported:1}},recent:{raw_entrants:0,screened_retained_entrants:0},meaningful_holder_growth_24h:null,beneficial_independence_verified:false,organic_demand_certified:false,scoring_effect:"none",provider_requests:0,database_writes:0});
    expect(await verifyHolderParticipation(report)).toEqual(report);expect(await replayHolderParticipationRecord({inputs,report})).toEqual(report);expect(await reviewHolderAcquisition(inputs)).toEqual(old);
    await expect(replayHolderParticipationRecord({inputs,report:{...report,freshness:"stale"}})).rejects.toThrow("replay_mismatch");
  });
  it.each(["below_size","retention_one_second_short","later_buy","transfer_only"])("keeps the %s boundary explicit",async kind=>{
    const trades=kind==="transfer_only"?[]:kind==="below_size"?[await participationTrade({quote:9999999n})]:kind==="retention_one_second_short"?[await participationTrade({time:"2026-10-21T08:30:01Z"})]:[await participationTrade({time:"2026-10-21T08:29:59Z"}),await participationTrade({time:"2026-10-21T08:50:00Z",sig:72,slot:31500})];
    const report=await reviewHolderParticipation(await withTrades(trades));expect(report.since_first?.screened_retained_entrants).toBe(0);expect(report.since_first?.partitions?.[kind==="below_size"?"below_native_size":kind==="transfer_only"?"no_sampled_buy":"retention_not_mature"]).toBe(1);
  });
  it("counts transaction net once across multiple swaps and does not multiply it by the instruction count",async()=>{
    const tx=await participationTrade({quote:5000000n});tx.transaction.message.instructions.push(structuredClone(tx.transaction.message.instructions[0]!));tx.meta!.innerInstructions!.push({...structuredClone(tx.meta!.innerInstructions![0]!),index:1});tx.meta!.postTokenBalances[0]!.uiTokenAmount.amount="200";
    expect((await reviewHolderParticipation(await withTrades([tx]))).since_first).toMatchObject({signed_net_buy_entrants:1,screened_retained_entrants:1});
  });
  it.each(["history","quote","mixed","sell","balance","unsigned"])("partitions unsupported %s evidence without dust or safety claims",async reason=>{
    const inputs=await participationFixture(),wallet=source(inputs),tx=wallet.records[0]!.transaction!;
    if(reason==="history")wallet.histories[0]!.rows=[];
    if(reason==="quote")tx.meta!.innerInstructions![0]!.instructions.pop();
    if(reason==="mixed")tx.meta!.postTokenBalances[0]!.uiTokenAmount.amount="101";
    if(reason==="sell"){const sell=await participationTrade({side:"sell",sig:72,slot:31500,time:"2026-10-21T08:40:00Z"});wallet.records.push({signature:sell.transaction.signatures[0]!,fetched_at:wallet.records[0]!.fetched_at,status:"available",purposes:["recent"],transaction:sell});wallet.histories[0]!.rows.push({signature:sell.transaction.signatures[0]!,slot:sell.slot,blockTime:sell.blockTime,err:null,confirmationStatus:"finalized"});}
    if(reason==="balance"){const data=new Uint8Array(9);data[0]=3;new DataView(data.buffer).setBigUint64(1,100000001n,true);tx.meta!.innerInstructions![0]!.instructions[0]!.data=toBase58(data);tx.meta!.postTokenBalances[0]!.uiTokenAmount.amount="100000001";}
    if(reason==="unsigned")tx.transaction.message.header.numRequiredSignatures=2;
    const report=await reviewHolderParticipation(await acquisitionInput(inputs.history,wallet)),partitions=report.since_first!.partitions!;expect(report.since_first!.screened_retained_entrants).toBe(0);expect(Object.values(partitions).reduce((a,b)=>a+b,0)).toBe(1);
    const category={history:"missing_finalized_history",quote:"unknown_quote",mixed:"mixed_net_flow",sell:"sampled_sell",balance:"insufficient_endpoint_balance",unsigned:"no_sampled_buy"} as const;expect(partitions[category[reason as keyof typeof category]]).toBe(1);
  });
  it("screens creator roles and ordinary sponsored transactions conservatively, without calling them fraud",async()=>{
    const inputs=await participationFixture(),rows=inputs.history.samples.map((sample,i)=>({evidence:{...HolderEvidenceSchema.parse(sample.evidence),creator:key(3)},observed_at:inputs.history.index[i]!.observed_at}));
    expect((await reviewHolderParticipation(await acquisitionInput(await historyInput(rows,inputs.history.cutoff_at),source(inputs)))).since_first?.partitions?.observed_creator_or_link).toBe(1);
    const sponsored=await participationTrade(),keys=sponsored.transaction.message.accountKeys;keys.unshift(key(9));sponsored.meta!.preBalances.unshift(10000);sponsored.meta!.postBalances.unshift(10000);sponsored.transaction.message.header.numRequiredSignatures=2;sponsored.transaction.signatures.push(signature(72));
    // Remap existing account references so the original buyer still signs the swap.
    for(const ix of [...sponsored.transaction.message.instructions,...sponsored.meta!.innerInstructions!.flatMap(i=>i.instructions)]){ix.programIdIndex++;ix.accounts=ix.accounts.map(i=>i+1);}
    for(const b of [...sponsored.meta!.preTokenBalances,...sponsored.meta!.postTokenBalances])b.accountIndex++;
    expect((await reviewHolderParticipation(await withTrades([sponsored]))).since_first?.partitions?.observed_creator_or_link).toBe(1);
  });
  it("uses finalized direct developer/shared-funder evidence, but does not infer independence from missing links",async()=>{
    const one=await reviewHolderParticipation(await withTrades([participationFunding(),await participationTrade()]));expect(one.since_first?.partitions?.observed_creator_or_link).toBe(1);
    const inputs=await participationFixture(),rows=inputs.history.samples.map((s,i)=>({evidence:structuredClone(HolderEvidenceSchema.parse(s.evidence)),observed_at:inputs.history.index[i]!.observed_at}));
    rows[2]!.evidence.inventory.value.push(historyAccount(4,key(4),inputs.history.address,100000000n));const vault=rows[2]!.evidence.inventory.value.find(r=>r.pubkey===rows[0]!.evidence.inventory.value.at(-1)!.pubkey)!;const bytes=Uint8Array.from(atob(vault.account.data[0]),c=>c.charCodeAt(0));new DataView(bytes.buffer).setBigUint64(64,700000000n,true);vault.account.data[0]=btoa(String.fromCharCode(...bytes));
    const history=await historyInput(rows,inputs.history.cutoff_at),wallet=await acquisitionWallet([participationFunding(key(9),key(3),80),participationFunding(key(9),key(4),81),await participationTrade(),await participationTrade({owner:key(4),sig:72,slot:31011})]);
    const report=await reviewHolderParticipation(await acquisitionInput(history,wallet));expect(report.since_first).toMatchObject({raw_entrants:2,screened_retained_entrants:0,partitions:{observed_creator_or_link:2}});expect(report.beneficial_independence_verified).toBe(false);
  });
  it("keeps missing/conflicting/latest-corrupt sources and output truncation held or rejected; detects future scope",async()=>{
    const inputs=await participationFixture();expect((await reviewHolderParticipation(await acquisitionInput(inputs.history,null))).since_first).toMatchObject({status:"held",screened_retained_entrants:null,partitions:null});
    const conflict=await acquisitionInput(inputs.history,null),meta=inputs.wallet_index[0]!;conflict.wallet_index=[meta,{...meta,evidence_hash:"f".repeat(64)}];expect((await reviewHolderParticipation(conflict)).since_first?.status).toBe("held");
    const changed=structuredClone(inputs);(changed.wallet!.evidence as WalletEvidence).gaps.push("tampered");await expect(reviewHolderParticipation(changed)).rejects.toThrow("raw_hash_mismatch");
    for(const gap of ["trade_output_limit","funding_output_limit"]){const wallet=source(inputs);wallet.gaps.push(gap);expect((await reviewHolderParticipation(await acquisitionInput(inputs.history,wallet))).since_first).toMatchObject({status:"held",screened_retained_entrants:null});}
    const future=source(inputs);future.records[0]!.fetched_at="2026-10-21T10:00:00.000Z";await expect(reviewHolderParticipation(await acquisitionInput(inputs.history,future))).rejects.toThrow("future");
    const scope=source(inputs);scope.asset.pool=key(251);await expect(reviewHolderParticipation(await acquisitionInput(inputs.history,scope))).rejects.toThrow("scope_mismatch");
    const stale=structuredClone(inputs);stale.history.cutoff_at="2026-10-21T10:05:00.000Z";expect((await reviewHolderParticipation(stale)).freshness).toBe("stale");
  });
  it("holds legacy funding at its output cap even when v1 has no truncation marker",async()=>{
    const transactions=Array.from({length:51},(_,i)=>{const tx=participationFunding(key(1),key(3),80+i,"2026-10-21T08:20:00Z",30500+i);tx.transaction.message.instructions.push(structuredClone(tx.transaction.message.instructions[0]!));return tx;});
    const inputs=await withTrades([...transactions,await participationTrade()]),report=await reviewHolderParticipation(inputs);expect(report.since_first).toMatchObject({status:"held",screened_retained_entrants:null,partitions:null});expect(report.since_first?.gaps).toContain("trade_or_link_output_truncated_or_at_bound");
  });
  it("verifies aggregate partitions/policy identity and serves cache reads with zero IO/writes",async()=>{
    const inputs=await participationFixture(),report=await reviewHolderParticipation(inputs);await expect(verifyHolderParticipation({...report,policy_hash:"f".repeat(64)})).rejects.toThrow();expect(HolderParticipation.safeParse({...report,meaningful_holder_growth_24h:1}).success).toBe(false);
    const sqlite=new DatabaseSync(":memory:");databases.push(sqlite);for(const f of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../migrations/${f}`,import.meta.url),"utf8"));
    for(const meta of inputs.history.index)sqlite.prepare("INSERT INTO tenx_holder_evidence VALUES(?,?,?,?,?)").run(meta.payload_hash,meta.address,meta.slot,JSON.stringify(inputs.history.samples.find(s=>s.payload_hash===meta.payload_hash)!.evidence),meta.observed_at);
    const meta=inputs.wallet_index[0]!;sqlite.prepare("INSERT INTO tenx_wallet_evidence VALUES(?,?,?,?)").run(meta.evidence_hash,meta.address,JSON.stringify(inputs.wallet!.evidence),meta.observed_at);
    const before=sqlite.prepare("SELECT total_changes() n").get(),network=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("forbidden")),db=sqliteD1(sqlite);expect((await holderParticipation(db,meta.address,new Date(inputs.history.cutoff_at))).report).toEqual(report);expect(network).not.toHaveBeenCalled();expect(sqlite.prepare("SELECT total_changes() n").get()).toEqual(before);
    sqlite.prepare("UPDATE tenx_wallet_evidence SET payload='{}' WHERE payload_hash=?").run(meta.evidence_hash);await expect(holderParticipation(db,meta.address,new Date(inputs.history.cutoff_at))).rejects.toThrow();
  });
});
