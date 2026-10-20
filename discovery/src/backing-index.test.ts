import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync,readdirSync } from "node:fs";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import { openBacking,freezeBacking,backingRecord,backingList } from "./backing";
import { BackingOpening } from "./backing-model";
import { WindowState,emptyWindow } from "./backing-window-model";
import { retainedWindow,windowCoverage } from "./backing-window";
import { runBackingIndex,backingIndexLimit } from "./backing-index";
import { key,now,trade } from "./wallet-fixtures.test-helper";
import { WalletTransactionSchema } from "./wallet-rpc";
import { MAINNET_GENESIS } from "./rpc";
import { hashJson,toBase58 } from "./solana";
import type { Settings } from "./ingest";

const instances:DatabaseSync[]=[];
afterEach(()=>instances.splice(0).forEach(db=>db.close()));
const sig=(n:number)=>toBase58(new Uint8Array(64).fill(n));
async function fixture(members=1){
  const sqlite=new DatabaseSync(":memory:");instances.push(sqlite);let time=now.getTime();
  sqlite.function("strftime",{varargs:true},()=>new Date(time).toISOString());
  for(const file of readdirSync(new URL("../migrations",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../migrations/${file}`,import.meta.url),"utf8"));
  const base=sqliteD1(sqlite);let tail:Promise<unknown>=Promise.resolve();
  const db={...base,batch(statements:D1PreparedStatement[]){const p=tail.then(()=>base.batch(statements));tail=p.catch(()=>{});return p;}} as D1Database;
  const identity=crypto.randomUUID();sqlite.prepare("INSERT INTO tenx_identities VALUES(?,?)").run(identity,now.toISOString());
  for(let n=0;n<members;n++)sqlite.prepare("INSERT INTO tenx_identity_wallets VALUES(?,?,?)").run(key(n+8),identity,now.toISOString());
  const id=crypto.randomUUID();await openBacking(db,{request_id:id,reason:"Offline wallet-window coverage fixture",duration_minutes:1,assumptions:{assumed_sol_usd:100,minimum_trade_usd:1,per_identity_cap_usd:100}},now);
  const opening=BackingOpening.parse(JSON.parse(String(sqlite.prepare("SELECT opening FROM tenx_backing_runs").get()!.opening)));
  const raw=await trade(key(8),12000,"buy",31);raw.blockTime=Math.floor(now.getTime()/1000)+10;const tx=WalletTransactionSchema.parse(raw);
  const rows=[{signature:tx.transaction.signatures[0]!,slot:tx.slot,err:null,blockTime:tx.blockTime,confirmationStatus:"finalized"},{signature:sig(100),slot:11900,err:null,blockTime:Math.floor(now.getTime()/1000)-1,confirmationStatus:"finalized"}];
  const calls:{method:string;params:unknown[]}[]=[];
  const replies:Record<string,unknown>={getGenesisHash:MAINNET_GENESIS,getSlot:30000,getBlockTime:Math.floor(now.getTime()/1000)+61,getSignaturesForAddress:rows,getTransaction:tx};
  let onCall:((method:string)=>void)|undefined;
  const transport:typeof fetch=async(_input,init)=>{
    const request=JSON.parse(String(init!.body)) as {id:number;method:string;params:unknown[]};calls.push({method:request.method,params:request.params});onCall?.(request.method);
    return Response.json({jsonrpc:"2.0",id:request.id,result:replies[request.method]});
  };
  const settings:Settings={db,rpcUrl:"https://api.mainnet-beta.solana.com",rpcDailyLimit:5000,marketDailyLimit:600,marketEnabled:false,walletEnabled:true,walletDailyLimit:800,transport};
  const clock=()=>new Date(time),at=(seconds:number)=>{time=now.getTime()+seconds*1000;};
  at(65);
  return {sqlite,db,id,opening,tx,rows,calls,replies,settings,clock,at,onCall:(fn:(method:string)=>void)=>{onCall=fn;}};
}
describe("bounded prospective signed-wallet indexing",()=>{
  it("retains finalized root/time, address pages and bodies within the existing free quotas, then replays offline",async()=>{
    const f=await fixture();expect(await runBackingIndex(f.settings,f.clock)).toMatchObject({state:"finalized_slot_observed",rpc_calls:3});
    f.at(126);expect(await runBackingIndex(f.settings,f.clock)).toMatchObject({state:"progress",rpc_calls:3});
    const state=await retainedWindow(f.db,f.id);expect(state.finality).toMatchObject({slot:30000,commitment:"finalized",genesis:MAINNET_GENESIS});expect(state.pages).toHaveLength(1);
    expect(f.calls.find(c=>c.method==="getSignaturesForAddress")!.params).toEqual([key(8),{commitment:"finalized",minContextSlot:30000,limit:50}]);
    expect(f.calls.find(c=>c.method==="getTransaction")!.params[1]).toMatchObject({commitment:"finalized"});
    f.at(361);await freezeBacking(f.db,f.id,f.clock());const record=(await backingRecord(f.db,f.id))!;
    expect(record.result.source_coverage).toMatchObject({status:"rpc_window_covered",wallets_requested:1,wallet_boundaries_reached:1,signatures_in_window:1,bodies_retained:1,bodies_missing:0,reserved_calls:6,independent_finality_verified:false});
    const hash=record.record_hash;f.sqlite.exec("DELETE FROM tenx_wallet_transactions;DELETE FROM tenx_backing_window_index");expect((await backingRecord(f.db,f.id))!.record_hash).toBe(hash);
    const publicData=JSON.stringify(await backingList(f.db));expect(publicData).not.toContain(key(8));expect(publicData).not.toContain(f.rows[0]!.signature);
    expect(f.sqlite.prepare("SELECT used FROM tenx_backing_index_usage").get()!.used).toBe(6);expect(f.sqlite.prepare("SELECT used FROM tenx_wallet_usage").get()!.used).toBe(6);expect(f.sqlite.prepare("SELECT used FROM tenx_usage WHERE provider='rpc'").get()!.used).toBe(6);
  });
  it("makes no source calls for empty membership, paused/disabled collection, backoff or an expired deadline",async()=>{
    const f=await fixture(0);expect(await runBackingIndex(f.settings,f.clock)).toMatchObject({state:"no_linked_wallets",rpc_calls:0});
    f.at(361);expect((await runBackingIndex(f.settings,f.clock)).state).toBe("waiting");expect(f.calls).toHaveLength(0);
    const g=await fixture();g.sqlite.exec("UPDATE tenx_control SET paused=1");expect((await runBackingIndex(g.settings,g.clock)).state).toBe("paused");
    g.sqlite.prepare("UPDATE tenx_control SET paused=0,last_error='rpc_rate_limited',retry_after=?").run(new Date(now.getTime()+300000).toISOString());expect((await runBackingIndex(g.settings,g.clock)).state).toBe("backoff");expect(g.calls).toHaveLength(0);
    expect((await runBackingIndex({...g.settings,walletEnabled:false},g.clock)).state).toBe("disabled");
  });
  it("never treats empty or short pages without an older boundary as complete history",async()=>{
    const f=await fixture();await runBackingIndex(f.settings,f.clock);f.replies.getSignaturesForAddress=[];f.at(126);await runBackingIndex(f.settings,f.clock);
    let coverage=await windowCoverage(f.opening,await retainedWindow(f.db,f.id),[]);expect(coverage.status).toBe("incomplete");expect(coverage.gaps).toContain("wallet_start_boundary_not_reached");
    const state=await retainedWindow(f.db,f.id);state.pages[0]!.rows=[f.rows[0]!];state.pages[0]!.rows_hash=await hashJson(state.pages[0]!.rows);
    coverage=await windowCoverage(f.opening,state,[]);expect(coverage.wallet_boundaries_reached).toBe(0);expect(coverage.bodies_missing).toBe(1);
  });
  it("retains missing archival bodies as missing evidence and does not retry them indefinitely",async()=>{
    const f=await fixture();await runBackingIndex(f.settings,f.clock);f.replies.getTransaction=null;f.at(126);await runBackingIndex(f.settings,f.clock);
    expect((await retainedWindow(f.db,f.id)).unavailable).toEqual([{signature:f.rows[0]!.signature,reason:"missing"}]);
    f.at(187);await runBackingIndex(f.settings,f.clock);expect(f.calls.filter(c=>c.method==="getTransaction")).toHaveLength(1);
    const coverage=await windowCoverage(f.opening,await retainedWindow(f.db,f.id),[]);expect(coverage).toMatchObject({status:"incomplete",bodies_missing:1});
  });
  it("reuses a correctly hashed cached body without another transaction request",async()=>{
    const f=await fixture();f.sqlite.prepare("INSERT INTO tenx_wallet_transactions VALUES(?,?,?,?)").run(f.rows[0]!.signature,await hashJson(f.tx),JSON.stringify(f.tx),new Date(now.getTime()+20000).toISOString());
    await runBackingIndex(f.settings,f.clock);f.at(126);await runBackingIndex(f.settings,f.clock);expect(f.calls.filter(c=>c.method==="getTransaction")).toHaveLength(0);
    expect((await retainedWindow(f.db,f.id)).processed).toEqual([f.rows[0]!.signature]);
  });
  it("refuses wrong clusters and roots that have not reached the estimated cutoff time",async()=>{
    const f=await fixture();f.replies.getGenesisHash="devnet";expect(await runBackingIndex(f.settings,f.clock)).toMatchObject({state:"held",error:"wrong_solana_cluster"});expect(f.calls).toHaveLength(1);
    const g=await fixture();g.replies.getBlockTime=Math.floor(now.getTime()/1000)+59;expect(await runBackingIndex(g.settings,g.clock)).toMatchObject({state:"held",error:"finalized_cutoff_not_reached"});expect((await retainedWindow(g.db,g.id)).finality).toBeNull();
  });
  it("drops a transaction response arriving after the immutable source deadline",async()=>{
    const f=await fixture();await runBackingIndex(f.settings,f.clock);f.at(126);f.onCall(method=>{if(method==="getTransaction")f.at(361);});
    expect(await runBackingIndex(f.settings,f.clock)).toMatchObject({state:"held",error:"source_deadline_passed"});expect(f.sqlite.prepare("SELECT COUNT(*) n FROM tenx_wallet_transactions").get()!.n).toBe(0);
    expect((await retainedWindow(f.db,f.id)).processed).toHaveLength(0);
  });
  it("serializes concurrent ticks and fences a stale owner before it can advance evidence",async()=>{
    const f=await fixture(),results=await Promise.all([runBackingIndex(f.settings,f.clock),runBackingIndex(f.settings,f.clock)]);
    expect(results.map(r=>r.state).sort()).toEqual(["finalized_slot_observed","waiting"]);expect(f.calls).toHaveLength(3);
    const g=await fixture();g.onCall(method=>{if(method==="getSlot")g.sqlite.prepare("UPDATE tenx_backing_window_index SET lease_owner='replacement'").run();});
    expect(await runBackingIndex(g.settings,g.clock)).toMatchObject({state:"held",error:"index_lease_lost"});expect((await retainedWindow(g.db,g.id)).finality).toBeNull();expect(g.sqlite.prepare("SELECT lease_owner FROM tenx_backing_window_index").get()!.lease_owner).toBe("replacement");
  });
  it("keeps daily, run, wallet and global caps without sending requests beyond them",async()=>{
    expect(backingIndexLimit(800)).toBe(160);expect(backingIndexLimit(100)).toBe(20);
    for(const cap of ["daily","run","wallet","global"]){
      const f=await fixture();
      if(cap==="daily")f.sqlite.prepare("INSERT INTO tenx_backing_index_usage VALUES(?,160)").run(now.toISOString().slice(0,10));
      if(cap==="run")f.sqlite.exec("UPDATE tenx_backing_window_index SET reserved_calls=64");
      if(cap==="wallet")f.sqlite.prepare("INSERT INTO tenx_wallet_usage VALUES(?,800)").run(now.toISOString().slice(0,10));
      if(cap==="global")f.sqlite.prepare("INSERT INTO tenx_usage VALUES('rpc',?,5000)").run(now.toISOString().slice(0,10));
      expect((await runBackingIndex(f.settings,f.clock)).state).toBe("held");expect(f.calls).toHaveLength(0);
      expect(Number(f.sqlite.prepare("SELECT used FROM tenx_backing_index_usage").get()?.used??0)).toBeLessThanOrEqual(160);
      expect(Number(f.sqlite.prepare("SELECT used FROM tenx_wallet_usage").get()?.used??0)).toBeLessThanOrEqual(800);
      expect(Number(f.sqlite.prepare("SELECT used FROM tenx_usage WHERE provider='rpc'").get()?.used??0)).toBeLessThanOrEqual(5000);
    }
  });
  it("retains a 429 as shared backoff and makes no subsequent call during it",async()=>{
    const f=await fixture();f.settings.transport=async()=>new Response(null,{status:429,headers:{"retry-after":"600"}});
    expect(await runBackingIndex(f.settings,f.clock)).toMatchObject({state:"held",error:"rpc_rate_limited"});
    expect(f.sqlite.prepare("SELECT last_error FROM tenx_control").get()!.last_error).toBe("rpc_rate_limited");f.at(126);expect((await runBackingIndex(f.settings,f.clock)).state).toBe("backoff");
  });
  it("detects page tampering, cursor replay, slot mismatch and unknown or nonfinalized timestamps",async()=>{
    const f=await fixture();await runBackingIndex(f.settings,f.clock);f.at(126);await runBackingIndex(f.settings,f.clock);const state=await retainedWindow(f.db,f.id);
    state.pages[0]!.rows_hash="f".repeat(64);await expect(windowCoverage(f.opening,state,[])).rejects.toThrow("backing_history_page_provenance_mismatch");state.pages[0]!.rows_hash=await hashJson(state.pages[0]!.rows);
    state.pages[0]!.before=sig(99);await expect(windowCoverage(f.opening,state,[])).rejects.toThrow("backing_history_page_provenance_mismatch");state.pages[0]!.before=null;
    state.pages[0]!.rows[0]!.blockTime=null;state.pages[0]!.rows[0]!.confirmationStatus="confirmed";state.pages[0]!.rows_hash=await hashJson(state.pages[0]!.rows);
    const coverage=await windowCoverage(f.opening,state,[]);expect(coverage.gaps).toContain("signature_block_time_unknown");expect(coverage.gaps).toContain("signature_finality_not_reported");
    state.pages[0]!.rows[0]!.err=42;state.pages[0]!.rows_hash=await hashJson(state.pages[0]!.rows);expect((await windowCoverage(f.opening,state,[])).gaps).toContain("signature_execution_status_unknown");
    state.pages[0]!.rows=f.rows;state.pages[0]!.rows_hash=await hashJson(f.rows);
    await expect(windowCoverage(f.opening,state,[{signature:f.rows[0]!.signature,payload_hash:await hashJson(f.tx),fetched_at:new Date(now.getTime()+126000).toISOString(),transaction:{...f.tx,slot:f.tx.slot+1}}])).rejects.toThrow("backing_indexed_transaction_mismatch");
  });
  it("shows scope limits instead of claiming coverage of more than sixteen frozen wallets",async()=>{
    const f=await fixture(17),coverage=await windowCoverage(f.opening,{...emptyWindow(),reserved_calls:0,last_error:null},[]);
    expect(coverage).toMatchObject({wallets_requested:17,wallets_tracked:16,status:"incomplete"});expect(coverage.gaps).toContain("wallet_inventory_limit_reached");
  });
  it("does not invent a truncation gap when the exact sixteen-page limit covers all tracked wallets",async()=>{
    const f=await fixture(16);await runBackingIndex(f.settings,f.clock);const state=WindowState.parse(JSON.parse(String(f.sqlite.prepare("SELECT payload FROM tenx_backing_window_index").get()!.payload)));
    for(const member of f.opening.members){const rows=[f.rows[1]!];state.pages.push({address:member.address,before:null,limit:50,min_context_slot:30000,fetched_at:new Date(now.getTime()+100000).toISOString(),rows,rows_hash:await hashJson(rows)});}
    f.sqlite.prepare("UPDATE tenx_backing_window_index SET payload=?,next_attempt_at=NULL").run(JSON.stringify(state));f.at(126);
    expect(await runBackingIndex(f.settings,f.clock)).toMatchObject({state:"bounded_index_finished",rpc_calls:0});
    const coverage=await windowCoverage(f.opening,await retainedWindow(f.db,f.id),[]);expect(coverage.status).toBe("rpc_window_covered");expect(coverage.gaps).not.toContain("window_index_capacity_limited");
  });
  it("does not fetch rows above the finalized slot and explicitly retains unsupported transaction gaps",async()=>{
    const f=await fixture();await runBackingIndex(f.settings,f.clock);f.rows[0]!.slot=30001;f.at(126);await runBackingIndex(f.settings,f.clock);
    expect(f.calls.filter(c=>c.method==="getTransaction")).toHaveLength(0);expect((await windowCoverage(f.opening,await retainedWindow(f.db,f.id),[])).gaps).toContain("window_signature_above_finalized_slot");
    const g=await fixture(),original=g.settings.transport!;g.settings.transport=async(input,init)=>{const req=JSON.parse(String(init!.body));return req.method==="getTransaction"?Response.json({jsonrpc:"2.0",id:req.id,error:{code:-32015}}):original(input,init);};
    await runBackingIndex(g.settings,g.clock);g.at(126);await runBackingIndex(g.settings,g.clock);expect((await retainedWindow(g.db,g.id)).unavailable[0]!.reason).toBe("unsupported");
  });
  it("holds a changed RPC source without sending requests under the old observation",async()=>{
    const f=await fixture();await runBackingIndex(f.settings,f.clock);f.at(126);f.settings.rpcUrl="https://different-rpc.invalid";
    expect(await runBackingIndex(f.settings,f.clock)).toMatchObject({state:"held",error:"rpc_source_changed_within_window",rpc_calls:0});expect(f.calls).toHaveLength(3);
  });
  it("rejects cache hash conflicts and body/address mismatches before advancing progress",async()=>{
    for(const mode of ["cache","address"]){
      const f=await fixture();await runBackingIndex(f.settings,f.clock);
      if(mode==="cache")f.sqlite.prepare("INSERT INTO tenx_wallet_transactions VALUES(?,?,?,?)").run(f.rows[0]!.signature,"f".repeat(64),JSON.stringify(f.tx),new Date(now.getTime()+20000).toISOString());
      else f.tx.transaction.message.accountKeys=f.tx.transaction.message.accountKeys.map(k=>k===key(8)?key(99):k);
      f.at(126);expect(await runBackingIndex(f.settings,f.clock)).toMatchObject({state:"held",error:mode==="cache"?"indexed_cache_hash_mismatch":"indexed_wallet_not_referenced"});
      expect((await retainedWindow(f.db,f.id)).processed).toHaveLength(0);
    }
  });
  it("detects omitted cached member references while ignoring unrelated wallets in the shared cache",async()=>{
    const f=await fixture();await runBackingIndex(f.settings,f.clock);f.at(126);await runBackingIndex(f.settings,f.clock);const window=await retainedWindow(f.db,f.id);
    const cached={signature:f.rows[0]!.signature,payload_hash:await hashJson(f.tx),fetched_at:f.clock().toISOString(),transaction:f.tx};
    const extra=structuredClone(f.tx);extra.transaction.signatures[0]=sig(55);extra.transaction.message.accountKeys=extra.transaction.message.accountKeys.map(k=>k===key(8)?key(99):k);
    const outside={...cached,signature:sig(55),payload_hash:await hashJson(extra),transaction:extra};
    expect((await windowCoverage(f.opening,window,[cached,outside])).status).toBe("rpc_window_covered");
    extra.transaction.message.accountKeys=structuredClone(f.tx.transaction.message.accountKeys);outside.payload_hash=await hashJson(extra);
    const missing=await windowCoverage(f.opening,window,[cached,outside]);expect(missing.status).toBe("incomplete");expect(missing.gaps).toContain("cached_member_transactions_outside_index");
  });
});
