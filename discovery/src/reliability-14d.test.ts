// Synthetic, isolated discovery exercise. Never loads the running local D1 database.
import {afterEach,describe,expect,it,vi} from "vitest";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync,unlinkSync,writeFileSync,mkdirSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {sqliteD1} from "../../app/functions/_lib/sqliteTestDb";
import {syntheticBundle,fixtureCandidates} from "./fixtures";
import {runCycle} from "./ingest";
import {candidates,control,reserveQuota} from "./store";
import {dailyElection,electionRecord,evaluateElection,freezeElection,replayElection} from "./elections";
import {runReviews} from "./research";
import {assess,DEFAULT_POLICY} from "./model";
import {heartbeatState} from "./operations";
import {MAINNET_GENESIS} from "./rpc";
import {curveAddress,PUMP} from "./pump";
import schema from "../protocol/pump-schema.json";

let sqlite:DatabaseSync|undefined,filename:string|undefined;
afterEach(()=>{sqlite?.close();sqlite=undefined;if(filename)unlinkSync(filename);filename=undefined;vi.useRealTimers();vi.restoreAllMocks();});
describe("14 simulated days of local discovery fault recovery",()=>{
  it("preserves evidence, budgets and idempotent rehearsals through outages, retries and a real database reopen",async()=>{
    vi.useFakeTimers({toFake:["Date"]});vi.spyOn(console,"warn").mockImplementation(()=>{});
    const outside=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("real_network_forbidden"));
    const start=Date.parse("2026-10-01T00:00:00.000Z");vi.setSystemTime(start);
    filename=join(tmpdir(),`tenx-discovery-reliability-${crypto.randomUUID()}.sqlite`);sqlite=new DatabaseSync(filename);
    for(const f of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../migrations/${f}`,import.meta.url),"utf8"));
    let db=sqliteD1(sqlite),bundle=await syntheticBundle(new Date(start)),curve=await curveAddress(bundle.mint);
    await db.prepare("INSERT INTO tenx_leads(address,pool,migration_tx,migration_signature,first_seen_at) VALUES(?1,?2,?3,?4,?5)").bind(bundle.mint,bundle.pool,JSON.stringify(bundle.graduation),bundle.graduation.transaction.signatures[0]!,new Date(start).toISOString()).run();
    const methods:string[]=[],dailyHashes=new Map<string,string>();let failures=0,successes=0,blocked=0,duplicates=0,reopened=false,recovered=false;
    const transport=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
      const body=JSON.parse(String(init?.body));methods.push(body.method);const elapsed=Date.now()-start;
      if(elapsed>=3*86400000 && elapsed<5*86400000)return new Response(null,{status:429,headers:{"retry-after":"7200"}});
      let result:unknown;
      if(body.method==="getGenesisHash")result=MAINNET_GENESIS;
      else if(body.method==="getSignaturesForAddress")result=body.params[0]===curve?[{signature:bundle.creation.transaction.signatures[0],slot:bundle.creation.slot,err:null,blockTime:bundle.creation.blockTime,confirmationStatus:"finalized"}]:[];
      else if(body.method==="getTransaction")result=bundle.creation;
      else if(body.method==="getProgramAccounts")result={context:{slot:30000},value:[]};
      else if(body.method==="getMultipleAccounts"){
        const addresses=body.params[0];
        if(addresses.length>1)result=bundle.accounts;
        else if(addresses[0]===bundle.mint)result={context:{slot:30000},value:[bundle.accounts.value[0]]};
        else{const bytes=new Uint8Array(145);bytes.set(schema.global_discriminator);bytes.fill(9,113);result={context:{slot:30000},value:[{owner:PUMP,executable:false,data:[btoa(String.fromCharCode(...bytes)),"base64"]}]};}
      }else throw new Error(`unexpected_provider_method_${body.method}`);
      return Response.json({jsonrpc:"2.0",id:body.id,result});
    });
    for(let hour=0;hour<14*24;hour++){
      const now=new Date(start+hour*3600000);vi.setSystemTime(now);
      if(hour===6*24+23){
        await db.prepare("INSERT INTO tenx_jobs(id,kind,state,started_at) VALUES('simulated-crash','refresh','running',?1)").bind(now.toISOString()).run();
        await db.prepare("UPDATE tenx_control SET lease_owner='simulated-crash',lease_until=?1 WHERE id=1").bind(new Date(now.getTime()+600000).toISOString()).run();
        sqlite.close();sqlite=new DatabaseSync(filename!);db=sqliteD1(sqlite);reopened=true;
        expect((await candidates(db))[0]?.creation).not.toBeNull();
      }
      if(hour===8*24)await db.prepare("UPDATE tenx_control SET paused=1 WHERE id=1").run();
      if(hour===8*24+2)await db.prepare("UPDATE tenx_control SET paused=0 WHERE id=1").run();
      const settings={db,rpcUrl:"https://offline-fixture.invalid",rpcDailyLimit:12,marketDailyLimit:3,marketEnabled:false,transport};
      const result=await runCycle(settings,now);if(result.state==="succeeded")successes++;else if(result.state==="failed")failures++;else blocked++;
      const callCount=methods.length;await runCycle(settings,now);expect(methods).toHaveLength(callCount);duplicates++;
      if(hour===7*24+1){expect(await db.prepare("SELECT state,error_code FROM tenx_jobs WHERE id='simulated-crash'").first()).toMatchObject({state:"failed",error_code:"lease_expired_without_completion"});recovered=true;}
      if(hour===8*24 || hour===8*24+1)expect(result.state).toBe("skipped");
      if(hour%24===0){
        const day=now.toISOString().slice(0,10);await dailyElection(db,now);const record=(await electionRecord(db,`daily-${day}`))!;expect(record.result.outcome).toBe("no_eligible_winner");expect(await replayElection(record)).toMatchObject({status:"verified",provider_requests:0});dailyHashes.set(record.id,record.record_hash);
        expect(await dailyElection(db,now)).toMatchObject({state:"already_recorded"});await runReviews(db,now);
        // Exercise the actual atomic reservation beyond the market ceiling.
        const reserve=reserveQuota(db,{rpc:12,market:3},now);await reserve("market");await reserve("market");await reserve("market");await expect(reserve("market")).rejects.toThrow("market_daily_budget_exhausted");
      }
      for(const row of (await db.prepare("SELECT provider,used FROM tenx_usage").all<{provider:string;used:number}>()).results)expect(row.used).toBeLessThanOrEqual(row.provider==="rpc"?12:3);
      const live=await candidates(db);expect(live.every(c=>assess(c,DEFAULT_POLICY,now).eligibility!=="eligible")).toBe(true);
      if(hour===2*24){const f=(await fixtureCandidates(now))[0]!,future=new Date(now.getTime()+1000).toISOString();expect(assess({...f,market:{...f.market!,fetched_at:future}},DEFAULT_POLICY,now).reasons).toContain("market_data_stale");expect(()=>evaluateElection(freezeElection([{...f,mode:"live",risk:{...f.risk,observed_at:future}}],now))).toThrow("election_evidence_from_future");}
      if(hour===5*24){expect(result.state).toBe("succeeded");expect(heartbeatState(new Date(now.getTime()-1200001).toISOString(),now)).toBe("stale");}
    }
    for(const [id,hash] of dailyHashes)expect((await electionRecord(db,id))?.record_hash).toBe(hash);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM tenx_election_runs").first<{n:number}>())!.n).toBe(14);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM tenx_audit WHERE action='election_snapshot'").first<{n:number}>())!.n).toBe(14);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM tenx_proofs").first<{n:number}>())!.n).toBe(2);
    expect(methods.every(m=>["getGenesisHash","getMultipleAccounts","getSignaturesForAddress","getTransaction","getProgramAccounts"].includes(m))).toBe(true);
    expect(outside).not.toHaveBeenCalled();expect(reopened&&recovered).toBe(true);expect((await control(db)).lease_owner).toBeNull();
    const report={version:"discovery-reliability-14d-v1",mode:"synthetic_offline",days:14,hourly_ticks:336,duplicate_deliveries:duplicates,simulated_provider_requests:methods.length,successful_cycles:successes,failed_cycles:failures,paused_backoff_or_budget_skips:blocked,daily_immutable_rehearsals:14,outage_hours:48,database_reopened:reopened,abandoned_job_recovered:recovered,real_provider_requests:0,financial_execution_enabled:false,untested:["live voting","campaign settlement","financial execution","14 days of real workstation uptime","external alert delivery"]};
    mkdirSync(new URL("../../.tmp/",import.meta.url),{recursive:true});writeFileSync(new URL("../../.tmp/discovery-reliability-14d.json",import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  },30000);
});
