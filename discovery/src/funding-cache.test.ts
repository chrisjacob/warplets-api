import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {afterEach,expect,it,vi} from "vitest";
import {sqliteD1} from "../../app/functions/_lib/sqliteTestDb";
import {collectFundingHistories,fundingTask,FundingScanSchema,recoverCachedFunding} from "./funding-history";
import {hashJson} from "./solana";
import {RpcClient} from "./rpc";
import {key,signature} from "./wallet-fixtures.test-helper";
import recorded from "../fixtures/recorded/v1-wallet-funding.json";
const opened:DatabaseSync[]=[];
afterEach(()=>{opened.splice(0).forEach(db=>db.close());vi.restoreAllMocks();});
async function fixture(status:"missing"|"unsupported"="unsupported"){
  const sqlite=new DatabaseSync(":memory:");opened.push(sqlite);
  for(const name of ["0005_wallet_analysis.sql","0007_funding_history.sql","0008_second_hop.sql"])sqlite.exec(readFileSync(new URL(`../migrations/${name}`,import.meta.url),"utf8"));
  const db=sqliteD1(sqlite),now=new Date(recorded.recorded_at),scan=FundingScanSchema.parse({wallet:recorded.anchor.wallet,anchor:recorded.anchor,lookback_seconds:3600,attempted_at:recorded.recorded_at,pages:[{before:recorded.anchor.signature,fetched_at:recorded.recorded_at,rows:[{signature:recorded.signature,slot:recorded.transaction.slot,blockTime:recorded.transaction.blockTime,err:null,confirmationStatus:"finalized"},{signature:signature(210),slot:recorded.transaction.slot-1,blockTime:Date.parse(recorded.anchor.block_time)/1000-3601,err:null,confirmationStatus:"finalized"}]}],examined:[{signature:recorded.signature,status}]});
  const saveCache=()=>db.prepare("INSERT INTO tenx_wallet_transactions(signature,payload_hash,payload,fetched_at) VALUES(?,?,?,?)").bind(recorded.signature,recorded.transaction_hash,JSON.stringify(recorded.transaction),recorded.recorded_at).run();
  await db.prepare("INSERT INTO tenx_funding_scans(address,wallet,anchor_signature,payload,payload_hash,attempted_at) VALUES(?,?,?,?,?,?)").bind(recorded.mint,scan.wallet,scan.anchor.signature,JSON.stringify(scan),await hashJson(scan),scan.attempted_at).run();
  return {db,sqlite,now,scan,saveCache};
}
it.each(["missing","unsupported"] as const)("recovers a %s marker from exact cache evidence without writes or source calls",async status=>{
  const f=await fixture(status);await f.saveCache();const before=f.sqlite.prepare("SELECT total_changes() AS n").get(),outside=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("Network forbidden"));
  const result=await recoverCachedFunding(f.db,[f.scan],f.now);expect(result.recovered).toEqual([{scan:0,signature:recorded.signature,previous_status:status}]);expect(result.records[0]!.fetched_at).toBe(recorded.recorded_at);expect(result.records[0]!.transaction.version).toBe(1);expect(fundingTask(result.scans[0]!).coverage.status).toBe("window_examined");
  expect(f.scan.examined[0]!.status).toBe(status);expect(f.sqlite.prepare("SELECT total_changes() AS n").get()).toEqual(before);expect(outside).not.toHaveBeenCalled();
});
it("retains unavailable and irreparable windows without fetching replacement bodies",async()=>{
  const f=await fixture();expect((await recoverCachedFunding(f.db,[f.scan],f.now)).recovered).toEqual([]);await f.saveCache();
  const missingBoundary=structuredClone(f.scan);missingBoundary.pages[0]!.rows.pop();missingBoundary.pages.push({before:recorded.signature,fetched_at:recorded.recorded_at,rows:[]});expect((await recoverCachedFunding(f.db,[missingBoundary],f.now)).recovered).toEqual([]);
  const oversized=structuredClone(f.scan);oversized.pages[0]!.rows.splice(1,0,...Array.from({length:12},(_,i)=>({signature:signature(50+i),slot:recorded.transaction.slot,blockTime:recorded.transaction.blockTime,err:null,confirmationStatus:"finalized" as const})));expect((await recoverCachedFunding(f.db,[oversized],f.now)).recovered).toEqual([]);
});
it.each(["hash","signature","slot","time","future","wallet"])("rejects mismatched %s before promoting a cache marker",async failure=>{
  const f=await fixture();await f.saveCache();const tx=structuredClone(recorded.transaction);
  if(failure==="signature")tx.transaction.signatures[0]=signature(211);
  if(failure==="slot")tx.slot++;
  if(failure==="time")tx.blockTime++;
  if(failure==="wallet")tx.transaction.message.accountKeys=tx.transaction.message.accountKeys.map(k=>k===recorded.anchor.wallet?key(211):k);
  await f.db.prepare("UPDATE tenx_wallet_transactions SET payload=?,payload_hash=?,fetched_at=?").bind(JSON.stringify(tx),failure==="hash"?"a".repeat(64):await hashJson(tx),failure==="future"?new Date(f.now.getTime()+1000).toISOString():recorded.recorded_at).run();
  await expect(recoverCachedFunding(f.db,[f.scan],f.now)).rejects.toThrow();expect(f.scan.examined[0]!.status).toBe("unsupported");
});
it("promotes only a consumed cached body, preserves old snapshots and persists an exact checkpoint",async()=>{
  const f=await fixture();await f.saveCache();const rpc=new RpcClient("https://offline.invalid",async()=>{throw Error("Quota forbidden");},async()=>{throw Error("Network forbidden");},0);
  const result=await collectFundingHistories(f.db,rpc,recorded.mint,[f.scan.anchor],async()=>({transaction:recorded.transaction as any,status:"available"}),{cacheRecovery:true,rpcCeiling:0});
  expect(fundingTask(result[0]!).coverage.status).toBe("window_examined");expect(rpc.calls).toBe(0);expect(f.scan.examined[0]!.status).toBe("unsupported");
  const saved=await f.db.prepare("SELECT payload,payload_hash FROM tenx_funding_scans").first<{payload:string;payload_hash:string}>();expect(JSON.parse(saved!.payload).examined[0].status).toBe("available");expect(await hashJson(FundingScanSchema.parse(JSON.parse(saved!.payload)))).toBe(saved!.payload_hash);
});
it("retains the marker when record/byte bounds prevent consuming the body",async()=>{
  const f=await fixture();await f.saveCache();const rpc=new RpcClient("https://offline.invalid",async()=>{throw Error("Quota forbidden");},async()=>{throw Error("Network forbidden");},0);
  const result=await collectFundingHistories(f.db,rpc,recorded.mint,[f.scan.anchor],async()=>null,{cacheRecovery:true,rpcCeiling:0});expect(result[0]!.examined[0]!.status).toBe("unsupported");expect(result[0]!.attempted_at).toBe(f.scan.attempted_at);
});
it("requires the consumed body to match the verified recovery body",async()=>{
  const f=await fixture();await f.saveCache();const rpc=new RpcClient("https://offline.invalid",async()=>{throw Error("Quota forbidden");},async()=>{throw Error("Network forbidden");},0);
  await expect(collectFundingHistories(f.db,rpc,recorded.mint,[f.scan.anchor],async()=>({transaction:{...recorded.transaction,slot:recorded.transaction.slot+1} as any,status:"available"}),{cacheRecovery:true,rpcCeiling:0})).rejects.toThrow("funding_recovery_body_changed");
  expect(JSON.parse((await f.db.prepare("SELECT payload FROM tenx_funding_scans").first<{payload:string}>())!.payload).examined[0].status).toBe("unsupported");
});
it("bounds cache lookups across several otherwise-finishable windows",async()=>{
  const f=await fixture(),scans=[0,1].map(i=>{const scan=structuredClone(f.scan);scan.wallet=i?key(201):scan.wallet;scan.anchor.wallet=scan.wallet;
    scan.pages[0]!.rows=[...Array.from({length:12},(_,n)=>({signature:signature(30+i*12+n),slot:recorded.transaction.slot-n,blockTime:recorded.transaction.blockTime-n,err:null,confirmationStatus:"finalized" as const})),scan.pages[0]!.rows[1]!];
    scan.pages[0]!.rows[12]!.slot=recorded.transaction.slot-20;scan.examined=scan.pages[0]!.rows.slice(0,12).map(r=>({signature:r.signature,status:"unsupported" as const}));return scan;});
  const queries=vi.spyOn(f.db,"prepare");expect((await recoverCachedFunding(f.db,scans,f.now)).recovered).toEqual([]);expect(queries).toHaveBeenCalledTimes(24);
  await f.saveCache();expect((await recoverCachedFunding(f.db,[scans[0]!,f.scan],f.now)).recovered).toHaveLength(1);
});
it.each([false,true])("keeps recovery bound to an exact second-hop instruction, including legacy key=%s",async legacy=>{
  const f=await fixture();await f.saveCache();const scan=FundingScanSchema.parse({...f.scan,anchor:{...f.scan.anchor,kind:"funding_transfer",instruction_index:3}});
  await f.db.prepare("INSERT INTO tenx_second_hop_scans(address,wallet,anchor_signature,payload,payload_hash,attempted_at) VALUES(?,?,?,?,?,?)").bind(recorded.mint,scan.wallet,legacy?scan.anchor.signature:`${scan.anchor.signature}:3`,JSON.stringify(scan),await hashJson(scan),scan.attempted_at).run();
  const rpc=new RpcClient("https://offline.invalid",async()=>{throw Error("Quota forbidden");},async()=>{throw Error("Network forbidden");},0);
  const result=await collectFundingHistories(f.db,rpc,recorded.mint,[scan.anchor],async()=>({transaction:recorded.transaction as any,status:"available"}),{secondHop:true,cacheRecovery:true,rpcCeiling:0});expect(result[0]!.examined[0]!.status).toBe("available");
  // A different outflow instruction cannot inherit this checkpoint.
  const different=await collectFundingHistories(f.db,rpc,recorded.mint,[{...scan.anchor,instruction_index:4}],async()=>null,{secondHop:true,cacheRecovery:true,rpcCeiling:0});expect(different[0]!.examined).toEqual([]);
});
it("does not overwrite a checkpoint advanced by another collector",async()=>{
  const f=await fixture();await f.saveCache();const rpc=new RpcClient("https://offline.invalid",async()=>{throw Error("Quota forbidden");},async()=>{throw Error("Network forbidden");},0);
  await expect(collectFundingHistories(f.db,rpc,recorded.mint,[f.scan.anchor],async()=>{await f.db.prepare("UPDATE tenx_funding_scans SET payload_hash=?").bind("b".repeat(64)).run();return {transaction:recorded.transaction as any,status:"available"};},{cacheRecovery:true,rpcCeiling:0})).rejects.toThrow("funding_checkpoint_changed_during_cache_recovery");
  expect((await f.db.prepare("SELECT payload_hash FROM tenx_funding_scans").first<{payload_hash:string}>())!.payload_hash).toBe("b".repeat(64));
});
