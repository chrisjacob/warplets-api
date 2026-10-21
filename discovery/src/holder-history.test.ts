import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import { holderHistoryFixture, historyInput, historyAccount, holderKey } from "./holder-history-fixtures.test-helper";
import { reviewHolderHistory, replayHolderHistoryRecord, selectedHolderSnapshots } from "./holder-history";
import { holderHistory } from "./holder-history-store";
import { HolderHistoryReportSchema } from "./holder-history-model";
import { hashJson } from "./solana";
import type { HolderEvidence } from "./holders";
import worker, { type LocalEnv } from "./worker";

const opened:DatabaseSync[]=[];
afterEach(()=>{opened.splice(0).forEach(db=>db.close());vi.restoreAllMocks();vi.useRealTimers();});
const evidenceRows=(input:Awaited<ReturnType<typeof holderHistoryFixture>>)=>input.samples.map(row=>({evidence:structuredClone(row.evidence as HolderEvidence),observed_at:input.index.find(meta=>meta.payload_hash===row.payload_hash)!.observed_at}));
function setup(){const sqlite=new DatabaseSync(":memory:");opened.push(sqlite);
  for(const f of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../migrations/${f}`,import.meta.url),"utf8"));
  return{sqlite,db:sqliteD1(sqlite)};
}
describe("cached raw owner history with qualified growth held",()=>{
  it("preserves archived JSON hashes and replays a recorded real full inventory",async()=>{
    const recorded=JSON.parse(readFileSync(new URL("../fixtures/recorded/holder-evidence.json",import.meta.url),"utf8"));
    const result=await reviewHolderHistory(await historyInput([{evidence:recorded.evidence,observed_at:recorded.expected.observed_at}],new Date(Date.parse(recorded.expected.observed_at)+60_000).toISOString()));
    expect(result.snapshots[0]).toMatchObject({payload_hash:recorded.expected.payload_hash,raw_owner_count:recorded.expected.holder_count,layout_certified:true});
    const rows=evidenceRows(await holderHistoryFixture());
    Object.assign(rows[0]!.evidence.inventory.value[0]!.account,{preserved_rpc_extension:123});
    const input=await historyInput(rows,"2026-10-21T09:05:00.000Z");
    expect((await reviewHolderHistory(input)).snapshots[0]!.payload_hash).toBe(input.index[0]!.payload_hash);
  });
  it("replays full inventories, net entrances/exits and endpoint retention without meaningful or daily growth credit",async()=>{
    const inputs=await holderHistoryFixture(),report=await reviewHolderHistory(inputs);
    expect(report).toMatchObject({status:"available",stale:false,snapshots:[{raw_owner_count:2},{raw_owner_count:3},{raw_owner_count:2}],
      since_first:{status:"measured",entrants:1,exits:1,retained:1,net_change:0,raw_growth_pct:0,positive_balance_retention_pct:50,duration_seconds:3600},
      recent:{status:"measured",entrants:0,exits:1,retained:2,net_change:-1,positive_balance_retention_pct:2/3*100},
      meaningful_holder_growth:null,trailing_24h_holder_growth:null,since_creation_holder_growth:null,scoring_effect:"none",provider_requests:0,database_writes:0});
    expect(await reviewHolderHistory(JSON.parse(JSON.stringify(inputs)))).toEqual(report);
    const {report_hash,...raw}=report;expect(await hashJson(raw)).toBe(report_hash);
    expect(await replayHolderHistoryRecord({inputs,report})).toEqual(report);
    await expect(replayHolderHistoryRecord({inputs,report:{...report,stale:true}})).rejects.toThrow("report_mismatch");
    expect(JSON.stringify(report)).not.toContain('"owners":');
  });
  it("aggregates split accounts and excludes only the canonical vault",async()=>{
    const rows=evidenceRows(await holderHistoryFixture());
    rows[2]!.evidence.inventory.value[1]=historyAccount(3,holderKey(1),rows[2]!.evidence.mint,100_000_000n);
    const result=await reviewHolderHistory(await historyInput(rows,"2026-10-21T09:05:00.000Z"));
    expect(result.snapshots[2]!.raw_owner_count).toBe(1);expect(result.since_first).toMatchObject({entrants:0,exits:1,net_change:-1});
  });
  it("keeps dust-manufactured entrants unqualified even when the raw count rises",async()=>{
    const rows=evidenceRows(await holderHistoryFixture()),end=rows[2]!.evidence;
    for(let n=10;n<110;n++)end.inventory.value.push(historyAccount(n,holderKey(n),end.mint,1n));
    const vault=end.inventory.value.find(row=>row.account.data[0] && row.pubkey===rows[0]!.evidence.inventory.value.at(-1)!.pubkey)!;
    vault.account.data=historyAccount(250,end.pool,end.mint,799_999_900n).account.data;
    const report=await reviewHolderHistory(await historyInput(rows,"2026-10-21T09:05:00.000Z"));
    expect(report.since_first).toMatchObject({status:"measured",entrants:101,exits:1,net_change:100});
    expect(report.meaningful_holder_growth).toBeNull();expect(report.acquisition_provenance).toBe("unknown");expect(report.organic_demand_certified).toBe(false);
  });
  it("distinguishes a missing baseline from an evidenced zero starting owner count",async()=>{
    const all=await holderHistoryFixture(),rows=evidenceRows(all).filter((_,i)=>i!==1);
    const baseline=rows[0]!.evidence,originalVault=baseline.inventory.value.at(-1)!;
    baseline.inventory.value=[{...historyAccount(250,baseline.pool,baseline.mint,1_000_000_000n),pubkey:originalVault.pubkey}];
    const report=await reviewHolderHistory(await historyInput(rows,"2026-10-21T09:05:00.000Z"));
    expect(report.since_first).toMatchObject({starting_owners:0,ending_owners:2,net_change:2,raw_growth_pct:null,positive_balance_retention_pct:null});
    expect((await reviewHolderHistory(await historyInput(rows.slice(1),"2026-10-21T09:05:00.000Z"))).since_first).toBeNull();
  });
  it.each(["partial","legacy","slot","timestamp","supply"])("holds %s comparisons without skipping inconvenient evidence",async reason=>{
    const rows=evidenceRows(await holderHistoryFixture()),end=rows[2]!.evidence;
    if(reason==="partial")end.inventory.value.shift();
    if(reason==="legacy")end.inventory.value.forEach(row=>row.account.data[0]=btoa(atob(row.account.data[0]).slice(0,109)));
    if(reason==="slot"){end.inventory.context.slot=30000;end.mint_state.context.slot=30001;}
    if(reason==="timestamp")rows[2]!.observed_at=rows[1]!.observed_at;
    if(reason==="supply"){
      const mint=end.mint_state.value[0]!,bytes=Uint8Array.from(atob(mint.data[0]),c=>c.charCodeAt(0));new DataView(bytes.buffer).setBigUint64(36,1_000_000_100n,true);mint.data[0]=btoa(String.fromCharCode(...bytes));
      end.inventory.value.at(-1)!.account.data=historyAccount(250,end.pool,end.mint,800_000_100n).account.data;
    }
    const report=await reviewHolderHistory(await historyInput(rows,"2026-10-21T09:05:00.000Z"));
    expect(report.since_first).toMatchObject({status:"held",entrants:null,net_change:null,raw_growth_pct:null});
  });
  it("rejects changed hashes, foreign metadata, future data, duplicate indexes and omitted selected snapshots",async()=>{
    const input=await holderHistoryFixture();
    const tampered=structuredClone(input);(tampered.samples[0]!.evidence as HolderEvidence).creator=null;
    await expect(reviewHolderHistory(tampered)).rejects.toThrow("hash_mismatch");
    await expect(reviewHolderHistory({...input,index:[...input.index,input.index[0]]})).rejects.toThrow("index_mismatch");
    await expect(reviewHolderHistory({...input,cutoff_at:"2026-10-21T08:55:00.000Z"})).rejects.toThrow("index_mismatch");
    await expect(reviewHolderHistory({...input,address:holderKey(200)})).rejects.toThrow("index_mismatch");
    await expect(reviewHolderHistory({...input,samples:input.samples.slice(1)})).rejects.toThrow("selection_mismatch");
  });
  it("holds archive exhaustion and missing/stale histories explicitly",async()=>{
    const input=await holderHistoryFixture();
    const index=Array.from({length:97},(_,i)=>({...input.index[0]!,payload_hash:i.toString(16).padStart(64,"0"),slot:i,observed_at:new Date(Date.parse("2026-10-21T07:00:00Z")+i*60000).toISOString()}));
    expect(selectedHolderSnapshots(index)).toEqual([]);
    expect(await reviewHolderHistory({...input,index,samples:[]})).toMatchObject({status:"limited",since_first:null,snapshots:[]});
    expect(await reviewHolderHistory({...input,index:[],samples:[]})).toMatchObject({status:"no_history",since_first:null,stale:true});
    expect((await reviewHolderHistory({...input,cutoff_at:"2026-10-21T10:00:00.000Z"})).stale).toBe(true);
  });
  it("bounds selected payload size before parsing or hashing",async()=>{
    const input=await holderHistoryFixture();input.samples[0]!.evidence={data:"x".repeat(3_000_001)};
    await expect(reviewHolderHistory(input)).rejects.toThrow("byte_limit");
  });
  it("reads existing archives without IO/writes, protects full replay inputs and excludes data after cutoff",async()=>{
    const {db,sqlite}=setup(),input=await holderHistoryFixture();
    for(const meta of input.index)sqlite.prepare("INSERT INTO tenx_holder_evidence VALUES(?,?,?,?,?)").run(meta.payload_hash,meta.address,meta.slot,JSON.stringify(input.samples.find(row=>row.payload_hash===meta.payload_hash)!.evidence),meta.observed_at);
    const before=JSON.stringify(sqlite.prepare("SELECT * FROM tenx_holder_evidence ORDER BY payload_hash").all()),network=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("no provider IO"));
    expect((await holderHistory(db,input.address,new Date(input.cutoff_at))).report).toEqual(await reviewHolderHistory(input));
    expect((await holderHistory(db,input.address,new Date("2026-10-21T08:40:00Z"))).report.snapshots).toHaveLength(2);
    vi.useFakeTimers();vi.setSystemTime(new Date(input.cutoff_at));
    const env={TENX_DB:db,TENX_LOCAL_ONLY:"true",TENX_ADMIN_TOKEN:"a".repeat(64)} as LocalEnv;
    const path=`http://localhost/api/10x/holders/history/solana/${input.address}`;
    const publicRead=await worker.fetch(new Request(path),env);expect(publicRead.status).toBe(200);
    const report=HolderHistoryReportSchema.parse(await publicRead.json());expect(report.snapshots).toHaveLength(3);expect(JSON.stringify(report)).not.toContain('"evidence":');
    const privatePath=path.replace("/api/10x/","/api/10x/admin/");expect((await worker.fetch(new Request(privatePath),env)).status).toBe(401);
    const privateRead=await worker.fetch(new Request(privatePath,{headers:{authorization:`Bearer ${env.TENX_ADMIN_TOKEN}`}}),env);
    expect(await privateRead.json()).toMatchObject({inputs:{samples:input.samples},report:{report_hash:report.report_hash}});
    expect(network).not.toHaveBeenCalled();expect(sqlite.prepare("SELECT * FROM tenx_usage").all()).toEqual([]);
    expect(JSON.stringify(sqlite.prepare("SELECT * FROM tenx_holder_evidence ORDER BY payload_hash").all())).toBe(before);
    sqlite.exec("UPDATE tenx_holder_evidence SET payload='{}'");await expect(holderHistory(db,input.address,new Date(input.cutoff_at))).rejects.toThrow("hash_mismatch");
  });
});
