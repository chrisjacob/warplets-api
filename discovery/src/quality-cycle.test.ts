import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import { fixtureCandidates, syntheticBundle } from "./fixtures";
import { creationProof, graduationProof, migrations, TOKEN } from "./pump";
import { publicKey, toBase58 } from "./solana";
import { saveCandidate, candidates } from "./store";
import { assess, DEFAULT_POLICY } from "./model";
import { MAINNET_GENESIS } from "./rpc";
import { reserveQualityQuota, runQualityCycle } from "./quality-cycle";
const at = new Date("2026-10-20T00:00:00Z"), key=(n:number)=>toBase58(new Uint8Array(32).fill(n));
const opened:DatabaseSync[]=[];
afterEach(()=>{opened.splice(0).forEach(d=>d.close());vi.restoreAllMocks()});
function account(address:string,owner:string,mint:string,amount:bigint){const bytes=new Uint8Array(165);bytes.set(publicKey(mint));bytes.set(publicKey(owner),32);new DataView(bytes.buffer).setBigUint64(64,amount,true);bytes[108]=1;return{pubkey:address,account:{owner:TOKEN,executable:false,space:165,data:[btoa(String.fromCharCode(...bytes)),"base64"]}}}
async function fixture(){
  const sqlite=new DatabaseSync(":memory:");opened.push(sqlite);for(const file of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../migrations/${file}`,import.meta.url),"utf8"));
  const db=sqliteD1(sqlite), base=(await fixtureCandidates(at))[0]!, states=new Map<string,unknown>(), inventories=new Map<string,unknown>();
  for(let i=41;i<44;i++){
    const b=await syntheticBundle(at,i);b.creation.transaction.signatures[0]=toBase58(new Uint8Array(64).fill(i));b.graduation.transaction.signatures[0]=toBase58(new Uint8Array(64).fill(i+100));
    const m=(await migrations(b.graduation))[0]!, creation=(await creationProof(b.creation,b.mint,at.toISOString()))!.proof;
    const c={...base,address:b.mint,pool:b.pool,creation,graduation:await graduationProof(b.graduation,m,at.toISOString()),mode:"live" as const};await saveCandidate(db,c,[b.creation,b.graduation]);
    await db.prepare("INSERT INTO tenx_leads(address,pool,migration_tx,migration_signature,first_seen_at) VALUES(?1,?2,?3,?4,?5)").bind(c.address,c.pool,JSON.stringify(b.graduation),b.graduation.transaction.signatures[0]!,at.toISOString()).run();
    [c.address,c.pool,m.baseVault,m.quoteVault,m.curve].forEach((a,n)=>states.set(a,b.accounts.value[n]));
    inventories.set(c.address,{context:{slot:30001},value:[...Array.from({length:120},(_,n)=>account(key(n+1),key(n+1),c.address,5000000n)),account(m.baseVault,c.pool,c.address,400000000n)]});
  }
  const transport=vi.fn(async(_input:unknown,init?:RequestInit)=>{const body=JSON.parse(String(init?.body));const result=body.method==="getGenesisHash"?MAINNET_GENESIS:body.method==="getProgramAccounts"?inventories.get(body.params[1].filters[0].memcmp.bytes):body.method==="getMultipleAccounts"?{context:{slot:body.params[1].minContextSlot===20000?30000:30002},value:body.params[0].map((a:string)=>states.get(a)??null)}:null;return Response.json({jsonrpc:"2.0",id:body.id,result})});
  return{db,transport,settings:{db,rpcUrl:"https://rpc.example",rpcDailyLimit:5000,marketDailyLimit:600,marketEnabled:false,qualityEnabled:true,qualityDailyLimit:1800,transport}};
}
describe("focused chain and holder refresh within free budgets",()=>{
  it("batches risk reads and mint states, verifies all inventories and keeps wallet gaps blocking",async()=>{
    const {db,settings,transport}=await fixture();
    expect(await runQualityCycle(settings,at)).toMatchObject({state:"succeeded",targets:3,holder_inventories:3,rpc_calls:6});
    const rows=await candidates(db);expect(rows).toHaveLength(3);for(const c of rows){expect(c.holders).toMatchObject({status:"verified",layout_certified:true,holder_count:120,top1_pct:.5,top10_pct:5});expect(assess(c,DEFAULT_POLICY,at).reasons).toEqual(["wallet_analysis_unavailable"])}
    expect(transport.mock.calls.filter(([,init])=>JSON.parse(String(init?.body)).method==="getMultipleAccounts")).toHaveLength(2);
    expect(await runQualityCycle(settings,new Date(at.getTime()+60000))).toMatchObject({state:"waiting"});expect(transport).toHaveBeenCalledTimes(6);
  });
  it("does not re-date cached holder evidence and rotates due refreshes",async()=>{
    const {db,settings}=await fixture();await runQualityCycle(settings,at);
    expect(await runQualityCycle(settings,new Date(at.getTime()+300000))).toMatchObject({rpc_calls:2,holder_inventories:0});
    expect((await candidates(db)).every(c=>c.holders?.observed_at===at.toISOString())).toBe(true);
    expect(await runQualityCycle(settings,new Date(at.getTime()+1200000))).toMatchObject({rpc_calls:5,holder_inventories:2});
  });
  it("honors disabled, pause, backoff and leases without provider calls",async()=>{
    const {db,settings,transport}=await fixture();expect(await runQualityCycle({...settings,qualityEnabled:false},at)).toMatchObject({state:"disabled"});
    await db.prepare("UPDATE tenx_control SET paused=1").run();expect(await runQualityCycle(settings,at)).toMatchObject({state:"paused"});
    await db.prepare("UPDATE tenx_control SET paused=0,last_error='rpc_rate_limited',retry_after=?1").bind("2026-10-20T01:00:00Z").run();expect(await runQualityCycle(settings,at)).toMatchObject({reason:"shared_rpc_backoff"});
    await db.prepare("UPDATE tenx_control SET retry_after=NULL").run();await db.prepare("UPDATE tenx_quality_control SET lease_until=?1").bind("2026-10-20T01:00:00Z").run();expect(await runQualityCycle(settings,at)).toMatchObject({state:"waiting"});expect(transport).not.toHaveBeenCalled();
  });
  it("reserves atomically inside both quality and global allowances",async()=>{
    const {db,settings}=await fixture(), reserve=reserveQualityQuota(db,{...settings,rpcDailyLimit:2,qualityDailyLimit:3},at);
    const results=await Promise.allSettled(Array.from({length:10},()=>reserve()));expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(2);
    expect((await db.prepare("SELECT used FROM tenx_usage WHERE provider='rpc'").first<{used:number}>())?.used).toBe(2);expect((await db.prepare("SELECT used FROM tenx_quality_usage").first<{used:number}>())?.used).toBe(3);
  });
  it("does not refresh definitely old or economically excluded candidates",async()=>{
    const {db,settings,transport}=await fixture();await db.prepare("UPDATE tenx_candidates SET payload=json_set(payload,'$.market.liquidity_usd',1)").run();expect(await runQualityCycle(settings,at)).toMatchObject({state:"empty",rpc_calls:0});expect(transport).not.toHaveBeenCalled();
  });
  it("retains last-good evidence and retries after provider throttling",async()=>{
    const {db,settings}=await fixture();await runQualityCycle(settings,at);const before=(await candidates(db)).map(c=>c.holders?.payload_hash);
    const result=await runQualityCycle({...settings,transport:async()=>new Response(null,{status:429})},new Date(at.getTime()+300000));expect(result).toMatchObject({state:"failed",error_code:"rpc_rate_limited",rpc_calls:1});
    expect((await candidates(db)).map(c=>c.holders?.payload_hash)).toEqual(before);
    expect(await db.prepare("SELECT last_error,retry_after FROM tenx_control").first()).toMatchObject({last_error:"rpc_rate_limited",retry_after:new Date(at.getTime()+600000).toISOString()});
    expect(await runQualityCycle(settings,new Date(at.getTime()+360000))).toMatchObject({reason:"shared_rpc_backoff"});
  });
});
