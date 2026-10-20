import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {sqliteD1} from "../../app/functions/_lib/sqliteTestDb";
import {claimRecovery,finishRecovery,inboxRecoveryStatus,recordUnsupportedRead,recoveryCandidates,type InboxEntry} from "./inbox-recovery";
import {TRANSACTION_READER_VERSION} from "./inbox-recovery-model";
import {key,signature} from "./wallet-fixtures.test-helper";
import {syntheticBundle} from "./fixtures";
import {runCycle} from "./ingest";
import {MAINNET_GENESIS} from "./rpc";
import {hashJson} from "./solana";
import {assess,DEFAULT_POLICY} from "./model";

const opened:DatabaseSync[]=[],now=new Date("2026-10-20T12:00:00.000Z");
beforeEach(()=>{vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(now);});
afterEach(()=>{opened.splice(0).forEach(db=>db.close());vi.useRealTimers();vi.restoreAllMocks();});
function setup(){
  const sqlite=new DatabaseSync(":memory:");opened.push(sqlite);
  for(const f of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../migrations/${f}`,import.meta.url),"utf8"));
  return {sqlite,db:sqliteD1(sqlite)};
}
async function enqueue(db:D1Database,n=91,options:{slot?:number;queued?:string;result?:string;processed?:string|null}={}):Promise<InboxEntry>{
  const row={signature:signature(n),slot:options.slot??10000-n,processed_at:options.processed===undefined?new Date(now.getTime()-60000).toISOString():options.processed,result:options.result??"unsupported_transaction_version"};
  await db.prepare("INSERT INTO tenx_pending_signatures(signature,slot,queued_at,processed_at,result) VALUES(?1,?2,?3,?4,?5)").bind(row.signature,row.slot,options.queued??new Date(now.getTime()-120000).toISOString(),row.processed_at,row.result).run();
  return row;
}
const owner=async(db:D1Database,id="job")=>db.prepare("UPDATE tenx_control SET lease_owner=?1 WHERE id=1").bind(id).run();
describe("bounded transaction-reader upgrade recovery",()=>{
  it("selects only recent processed version rejections and excludes already attempted reader versions",async()=>{
    const {db}=setup(),current=await enqueue(db);
    await enqueue(db,92,{result:"unsupported_or_invalid_transaction"});
    await enqueue(db,93,{result:"unsupported_quote"});
    await enqueue(db,94,{queued:new Date(now.getTime()-86400001).toISOString()});
    await enqueue(db,95,{queued:new Date(now.getTime()+1).toISOString()});
    await enqueue(db,96,{processed:null});
    await enqueue(db,97,{processed:new Date(now.getTime()+1).toISOString()});
    expect(await recoveryCandidates(db,now)).toEqual([current]);
    await owner(db);expect(await claimRecovery(db,current,"job",now)).toBe(true);
    expect(await recoveryCandidates(db,now)).toEqual([]);
    expect(await inboxRecoveryStatus(db,now)).toMatchObject({pending_recent:0,older_unsupported:1,used_today:1,remaining_today:19,provider_requests:0});
  });
  it("atomically admits at most twenty attempts per UTC day and one per signature/reader",async()=>{
    const {db}=setup();await owner(db);
    const rows=[];for(let n=1;n<=25;n++)rows.push(await enqueue(db,n));
    // Separate bounded turns use the same global admission counter.
    for(let n=0;n<19;n++){await owner(db,`job${n}`);expect(await claimRecovery(db,rows[n]!,`job${n}`,now)).toBe(true);}
    await owner(db,"last");const admitted=await Promise.all(rows.slice(19).map(row=>claimRecovery(db,row,"last",now)));
    expect(admitted.filter(Boolean)).toHaveLength(1);
    expect(await claimRecovery(db,rows[0]!,"last",now)).toBe(false);
    expect(await recoveryCandidates(db,now)).toEqual([]);
    expect(await inboxRecoveryStatus(db,now)).toMatchObject({used_today:20,remaining_today:0,pending_recent:5});
    const tomorrow=new Date(now.getTime()+86400000);vi.setSystemTime(tomorrow);
    const next=await enqueue(db,26,{queued:tomorrow.toISOString(),processed:tomorrow.toISOString()});
    await owner(db,"nextday");expect(await claimRecovery(db,next,"nextday",tomorrow)).toBe(true);
    expect(await inboxRecoveryStatus(db,tomorrow)).toMatchObject({used_today:1});
  });
  it("admits at most two concurrent rechecks in one turn even when daily room remains",async()=>{
    const {db}=setup();await owner(db);const rows=[];for(let n=91;n<=95;n++)rows.push(await enqueue(db,n));
    const admitted=await Promise.all(rows.map(row=>claimRecovery(db,row,"job",now)));
    expect(admitted.filter(Boolean)).toHaveLength(2);expect((await inboxRecoveryStatus(db,now)).used_today).toBe(2);
  });
  it("requires the active unpaused lease and exact old inbox identity before reservation",async()=>{
    const {db}=setup(),row=await enqueue(db);
    expect(await claimRecovery(db,row,"job",now)).toBe(false);await owner(db);
    expect(await claimRecovery(db,{...row,slot:row.slot+1},"job",now)).toBe(false);
    await db.prepare("UPDATE tenx_control SET paused=1").run();expect(await claimRecovery(db,row,"job",now)).toBe(false);
    expect(await inboxRecoveryStatus(db,now)).toMatchObject({used_today:0});
  });
  it("preserves an interrupted receipt without repeating it, and never finalizes after losing the lease",async()=>{
    const {db}=setup(),row=await enqueue(db);await owner(db);expect(await claimRecovery(db,row,"job",now)).toBe(true);
    await owner(db,"replacement");await finishRecovery(db,row,"job","not_a_migration",null,now);
    expect((await inboxRecoveryStatus(db,now)).recent[0]).toMatchObject({state:"reading",outcome:null,prior_processed_at:row.processed_at});
    expect(await recoveryCandidates(db,now)).toEqual([]);
    expect(await db.prepare("SELECT result FROM tenx_pending_signatures").first()).toEqual({result:"unsupported_transaction_version"});
  });
  it("commits a hashed receipt with its projection atomically and protects the completed history",async()=>{
    const {db,sqlite}=setup(),row=await enqueue(db);await owner(db);await claimRecovery(db,row,"job",now);
    const tx=(await syntheticBundle(now)).graduation;
    sqlite.exec("CREATE TRIGGER fault_receipt BEFORE UPDATE ON tenx_inbox_reads BEGIN SELECT RAISE(ABORT,'simulated'); END;");
    await expect(finishRecovery(db,row,"job","not_a_migration",tx,now)).rejects.toThrow("simulated");
    expect(await db.prepare("SELECT result FROM tenx_pending_signatures").first()).toEqual({result:"unsupported_transaction_version"});
    sqlite.exec("DROP TRIGGER fault_receipt");await finishRecovery(db,row,"job","not_a_migration",tx,now);
    expect((await inboxRecoveryStatus(db,now)).recent[0]).toMatchObject({state:"finished",outcome:"not_a_migration",payload_hash:await hashJson(tx),prior_processed_at:row.processed_at});
    expect(()=>sqlite.exec("DELETE FROM tenx_inbox_reads")).toThrow("immutable_inbox_read");
    expect(()=>sqlite.exec("UPDATE tenx_inbox_reads SET outcome='migration_verified'")).toThrow("immutable_inbox_read");
  });
  it("records new unsupported reads at the current reader so ordinary ticks cannot reopen them",async()=>{
    const {db}=setup(),row=await enqueue(db,91,{processed:null});await owner(db);
    await recordUnsupportedRead(db,row,"job","unsupported_transaction_version",now);
    expect(await recoveryCandidates(db,now)).toEqual([]);
    expect(await db.prepare("SELECT reader_version,is_recovery FROM tenx_inbox_reads").first()).toEqual({reader_version:TRANSACTION_READER_VERSION,is_recovery:0});
    expect(await inboxRecoveryStatus(db,now)).toMatchObject({used_today:0});
  });
  it("recovers a synthetic finalized v1 migration through the ordinary proof gates without making it eligible",async()=>{
    const {db}=setup(),bundle=await syntheticBundle(now),sig=bundle.graduation.transaction.signatures[0]!;
    await db.prepare("UPDATE tenx_control SET last_harvest=?1").bind(now.toISOString()).run();
    await db.prepare("INSERT INTO tenx_pending_signatures(signature,slot,queued_at,processed_at,result) VALUES(?1,?2,?3,?3,'unsupported_transaction_version')").bind(sig,bundle.graduation.slot,new Date(now.getTime()-60000).toISOString()).run();
    const raw={...bundle.graduation,version:1,transaction:{...bundle.graduation.transaction,message:{...bundle.graduation.transaction.message,header:{numRequiredSignatures:bundle.graduation.transaction.signatures.length,numReadonlySignedAccounts:0,numReadonlyUnsignedAccounts:0},transactionConfig:{priorityFee:null,computeUnitLimit:200000,loadedAccountsDataSizeLimit:67108864,heapSize:null}}}};
    const transport=vi.fn(async(_url:unknown,init?:RequestInit)=>{
      const b=JSON.parse(String(init?.body));
      const result=b.method==="getGenesisHash"?MAINNET_GENESIS:b.method==="getTransaction"?b.params[0]===sig?raw:bundle.creation:b.method==="getSignaturesForAddress"?[{signature:bundle.creation.transaction.signatures[0],slot:bundle.creation.slot,blockTime:bundle.creation.blockTime,err:null,confirmationStatus:"finalized"}]:bundle.accounts;
      return Response.json({jsonrpc:"2.0",id:b.id,result});
    });
    const settings={db,rpcUrl:"https://rpc.invalid",rpcDailyLimit:100,marketDailyLimit:10,marketEnabled:false,transport};
    expect(await runCycle(settings,now)).toMatchObject({state:"succeeded",processed:1});
    const saved=JSON.parse((await db.prepare("SELECT payload FROM tenx_candidates WHERE mode='live'").first<{payload:string}>())!.payload);
    expect(saved.creation).not.toBeNull();expect(saved.graduation).not.toBeNull();expect(assess(saved,DEFAULT_POLICY,now).eligibility).not.toBe("eligible");
    expect((await inboxRecoveryStatus(db,now)).recent[0]).toMatchObject({outcome:"migration_verified",state:"finished",payload_hash:expect.any(String)});
    expect(transport.mock.calls.filter(([,init])=>{const b=JSON.parse(String(init?.body));return b.method==="getTransaction"&&b.params[0]===sig;})).toHaveLength(1);
    const calls=transport.mock.calls.length;expect(await runCycle(settings,now)).toMatchObject({state:"duplicate"});expect(transport).toHaveBeenCalledTimes(calls);
  });
  it("keeps six total inbox bodies per turn and four fresh slots when old rechecks are pending",async()=>{
    const {db}=setup();await db.prepare("UPDATE tenx_control SET last_harvest=?1").bind(now.toISOString()).run();
    const rows:InboxEntry[]=[];for(let n=80;n<86;n++)rows.push(await enqueue(db,n,{processed:null}));for(let n=91;n<94;n++)rows.push(await enqueue(db,n));
    const transport=vi.fn(async(_url:unknown,init?:RequestInit)=>{
      const b=JSON.parse(String(init?.body));if(b.method==="getGenesisHash")return Response.json({jsonrpc:"2.0",id:b.id,result:MAINNET_GENESIS});
      const row=rows.find(r=>r.signature===b.params[0])!;
      return Response.json({jsonrpc:"2.0",id:b.id,result:{slot:row.slot,blockTime:now.getTime()/1000-10,version:"legacy",transaction:{signatures:[row.signature],message:{accountKeys:[key(1)],instructions:[]}},meta:{err:null,innerInstructions:[]}}});
    });
    expect(await runCycle({db,rpcUrl:"https://rpc.invalid",rpcDailyLimit:100,marketDailyLimit:10,marketEnabled:false,transport},now)).toMatchObject({state:"succeeded",rpc_calls:7});
    expect(transport.mock.calls.filter(([,init])=>JSON.parse(String(init?.body)).method==="getTransaction")).toHaveLength(6);
    expect(await inboxRecoveryStatus(db,now)).toMatchObject({used_today:2,pending_recent:1});
    expect(await db.prepare("SELECT count(*) AS n FROM tenx_pending_signatures WHERE processed_at IS NULL").first()).toEqual({n:2});
  });
  it.each(["unsupported","missing","mismatch","rate_limit"])("retains %s recovery as a source gap and never retries that reader",async(failure)=>{
    const {db}=setup(),row=await enqueue(db);await db.prepare("UPDATE tenx_control SET last_harvest=?1").bind(now.toISOString()).run();
    const transport=vi.fn(async(_url:unknown,init?:RequestInit)=>{
      const b=JSON.parse(String(init?.body));if(b.method==="getGenesisHash")return Response.json({jsonrpc:"2.0",id:b.id,result:MAINNET_GENESIS});
      if(failure==="rate_limit")return new Response(null,{status:429,headers:{"retry-after":"300"}});
      if(failure==="unsupported")return Response.json({jsonrpc:"2.0",id:b.id,error:{code:-32015}});
      return Response.json({jsonrpc:"2.0",id:b.id,result:failure==="missing"?null:{slot:row.slot+1,blockTime:now.getTime()/1000,version:"legacy",transaction:{signatures:[row.signature],message:{accountKeys:[key(1)],instructions:[]}},meta:{err:null,innerInstructions:[]}}});
    });
    const result=await runCycle({db,rpcUrl:"https://rpc.invalid",rpcDailyLimit:100,marketDailyLimit:10,marketEnabled:false,transport},now);
    expect(result.state).toBe(["rate_limit","mismatch"].includes(failure)?"failed":"succeeded");
    expect(await recoveryCandidates(db,new Date(now.getTime()+60000))).toEqual([]);
    expect((await inboxRecoveryStatus(db,now)).recent[0]?.state).toBe("finished");
    expect((await db.prepare("SELECT count(*) AS n FROM tenx_leads").first<{n:number}>())!.n).toBe(0);
    if(failure==="rate_limit")expect(await db.prepare("SELECT last_error,retry_after FROM tenx_control").first()).toMatchObject({last_error:"rpc_rate_limited",retry_after:expect.any(String)});
  });
});
