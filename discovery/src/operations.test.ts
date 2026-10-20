import {afterEach,describe,expect,it,vi} from "vitest";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {sqliteD1} from "../../app/functions/_lib/sqliteTestDb";
import {heartbeatState,loopState,operations,recordWatchdog} from "./operations";
import {WatchdogReportSchema} from "./operations-model";
import worker,{type LocalEnv} from "./worker";
import {runCycle} from "./ingest";
import {MAINNET_GENESIS} from "./rpc";
const opened:DatabaseSync[]=[],at=new Date("2026-10-20T00:00:00.000Z");
afterEach(()=>{opened.splice(0).forEach(d=>d.close());vi.restoreAllMocks();});
function setup(){const sqlite=new DatabaseSync(":memory:");opened.push(sqlite);for(const file of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../migrations/${file}`,import.meta.url),"utf8"));return sqliteD1(sqlite);}
const settings=(db:D1Database)=>({db,rpcUrl:"https://rpc.invalid",rpcDailyLimit:5000,marketDailyLimit:600,marketEnabled:true,walletEnabled:true,walletDailyLimit:800,qualityEnabled:true,qualityDailyLimit:1800});
describe("local operational health",()=>{
  it("distinguishes missing, stale and future timer evidence",()=>{
    expect(heartbeatState(null,at)).toBe("missing");expect(heartbeatState(at.toISOString(),at)).toBe("recent");
    expect(heartbeatState(new Date(at.getTime()-1200001).toISOString(),at)).toBe("stale");expect(heartbeatState(new Date(at.getTime()+1).toISOString(),at)).toBe("future");
  });
  it("does not mistake intentional pacing, provider backoff or budget exhaustion for a dead timer",()=>{
    const row={lease_until:null,next_refresh_at:new Date(at.getTime()+600000).toISOString(),last_success:at.toISOString(),last_error:null},opts={enabled:true,paused:false,limited:false};
    expect(loopState(row,at,opts)).toBe("scheduled");expect(loopState(row,at,{...opts,limited:true})).toBe("budget_limited");expect(loopState(row,at,{...opts,paused:true})).toBe("paused");expect(loopState(row,at,{...opts,backoff:row.next_refresh_at})).toBe("backoff");
    expect(loopState({...row,next_refresh_at:new Date(at.getTime()-1200001).toISOString()},at,opts)).toBe("overdue");expect(loopState({...row,last_success:new Date(at.getTime()+1).toISOString()},at,opts)).toBe("clock_invalid");
  });
  it("is read-only, exposes quota/backoff/expired jobs, and never fetches providers",async()=>{
    const db=setup(),network=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("no provider"));
    await db.prepare("UPDATE tenx_control SET heartbeat_at=?1,reviewed_at=?1,last_error='rpc_rate_limited',retry_after=?2 WHERE id=1").bind(at.toISOString(),new Date(at.getTime()+600000).toISOString()).run();
    await db.prepare("INSERT INTO tenx_wallet_usage(day,used) VALUES(?1,800)").bind(at.toISOString().slice(0,10)).run();
    await db.prepare("INSERT INTO tenx_jobs(id,kind,state,started_at) VALUES('abandoned','refresh','running',?1)").bind(new Date(at.getTime()-1800000).toISOString()).run();
    const before=await db.prepare("SELECT * FROM tenx_control").first(),result=await operations(settings(db),at);
    expect(result).toMatchObject({timer:"recent",provider_requests:0,abandoned_jobs:1,watchdog:{last:null,fresh:false,external_channels_configured:false}});expect(result.loops.find(l=>l.name==="wallets")?.state).toBe("budget_limited");expect(result.loops.find(l=>l.name==="discovery")?.state).toBe("backoff");expect(result.issues).toContain("abandoned_jobs_retained");expect(network).not.toHaveBeenCalled();expect(await db.prepare("SELECT * FROM tenx_control").first()).toEqual(before);
  });
  it("retains only watchdog transitions and ignores duplicate/out-of-order reports",async()=>{
    const db=setup(),report={version:"local-watchdog-v1" as const,checked_at:at.toISOString(),code:"healthy" as const,restart_recommended:false};
    await recordWatchdog(db,report,at);await recordWatchdog(db,report,at);
    const later=new Date(at.getTime()+30000);await recordWatchdog(db,{...report,checked_at:later.toISOString()},later);
    await recordWatchdog(db,{...report,code:"timer_stale",restart_recommended:true},later);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM tenx_watchdog_events").first<{n:number}>())!.n).toBe(1);
    const next=new Date(later.getTime()+30000);await recordWatchdog(db,{...report,checked_at:next.toISOString(),code:"timer_stale",restart_recommended:true},next);
    const result=await operations(settings(db),next);expect(result.watchdog.events).toHaveLength(2);expect(result.watchdog.last?.code).toBe("timer_stale");expect(result.watchdog.fresh).toBe(true);
    await expect(recordWatchdog(db,{...report,checked_at:new Date(next.getTime()+1).toISOString()},next)).rejects.toThrow("watchdog_report_outside_admission_window");await expect(recordWatchdog(db,report,new Date(at.getTime()+120001))).rejects.toThrow("watchdog_report_outside_admission_window");
    expect(WatchdogReportSchema.safeParse({...report,restart_recommended:true}).success).toBe(false);
  });
  it("protects watchdog writes and publishes read-only operations without credentials",async()=>{
    const db=setup(),env:LocalEnv={TENX_DB:db,TENX_LOCAL_ONLY:"true",TENX_NODE_RELAY:"false",TENX_ADMIN_TOKEN:"a".repeat(64),TENX_RPC_URL:"https://rpc.invalid",TENX_RPC_DAILY_LIMIT:"5000",TENX_MARKET_DAILY_LIMIT:"600",TENX_MARKET_PROVIDER:"dexscreener",TENX_QUALITY_ENABLED:"true",TENX_QUALITY_RPC_DAILY_LIMIT:"1800",TENX_MARKET_ENABLED:"false",TENX_WALLET_ANALYSIS_ENABLED:"true",TENX_WALLET_RPC_DAILY_LIMIT:"800"};
    const url="http://127.0.0.1/api/10x/",body={reason:"watchdog test",report:{version:"local-watchdog-v1",checked_at:new Date().toISOString(),code:"healthy",restart_recommended:false}};
    expect((await worker.fetch(new Request(`${url}admin/watchdog`,{method:"POST",body:JSON.stringify(body)}),env)).status).toBe(401);
    expect((await worker.fetch(new Request(`${url}admin/watchdog`,{method:"POST",headers:{authorization:`Bearer ${env.TENX_ADMIN_TOKEN}`,"content-type":"application/json"},body:JSON.stringify(body)}),env)).status).toBe(200);
    const response=await worker.fetch(new Request(`${url}system/operations`),env);expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("no-store");expect(await response.text()).not.toContain(env.TENX_ADMIN_TOKEN);
    expect((await worker.fetch(new Request(`${url}system/operations`,{method:"POST",headers:{"content-type":"application/json"},body:"{}"}),env)).status).toBe(404);
  });
  it("a resumed discovery request cannot finish another owner's job or publish after losing its lease",async()=>{
    const db=setup();
    const transport=vi.fn(async()=>{
      // Simulate a request resuming after a different process acquired the lease.
      await db.prepare("UPDATE tenx_control SET lease_owner='new-owner' WHERE id=1").run();
      return Response.json({jsonrpc:"2.0",id:1,result:MAINNET_GENESIS});
    });
    expect(await runCycle({...settings(db),transport},at)).toMatchObject({state:"failed",error_code:"discovery_lease_lost",rpc_calls:1});
    expect(await db.prepare("SELECT lease_owner,last_error FROM tenx_control").first()).toMatchObject({lease_owner:"new-owner",last_error:null});expect(transport).toHaveBeenCalledOnce();
    expect((await db.prepare("SELECT COUNT(*) AS n FROM tenx_candidates").first<{n:number}>())!.n).toBe(0);
  });
});
