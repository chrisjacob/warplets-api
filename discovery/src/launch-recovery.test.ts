import {afterEach,expect,it,vi} from "vitest";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync,mkdtempSync,rmSync} from "node:fs";
import {join,resolve,dirname,basename} from "node:path";
import {tmpdir} from "node:os";
import {sqliteD1} from "../../app/functions/_lib/sqliteTestDb";
import {evaluateRecovery,recoveryExample} from "./launch-recovery-math";
import {RecoveryScenario,RecoveryRecord,RecoveryList,RecoveryStep,type RecoveryInput} from "./launch-recovery-model";
import {createRecovery,recoveryList,recoveryRecord,replayRecovery} from "./launch-recovery-store";
import {hashJson} from "./solana";
import worker,{type LocalEnv} from "./worker";
const now=new Date("2026-10-20T12:00:00.000Z"),opened:DatabaseSync[]=[],folders:string[]=[];
afterEach(()=>{opened.splice(0).forEach(db=>db.close());for(const path of folders.splice(0)){const absolute=resolve(path);if(dirname(absolute)!==resolve(tmpdir())||!basename(absolute).startsWith("tenx-recovery-test-"))throw Error("Unexpected cleanup path");rmSync(absolute,{recursive:true,force:true});}vi.restoreAllMocks();});
const scenario=(kind:Parameters<typeof recoveryExample>[0]="lost_response")=>({...recoveryExample(kind),as_of:now.toISOString()});
const request=(s=scenario())=>({request_id:crypto.randomUUID(),reason:"Offline interrupted launch recovery review",scenario:s});
type Events=RecoveryInput["events"];
const submit=(step:zStep="create_token",outcome:"finalized"|"failed"|"pending"="finalized",lose_response=false):Events[number]=>({kind:"submit",step,outcome,lose_response,configuration_matches:true,resource_matches:true});
type zStep=typeof RecoveryStep.options[number];
const start:Events=[{kind:"tick"},{kind:"reconcile",step:"create_token"}];
const run=(events:Events)=>evaluateRecovery({...scenario(),events});
function fixture(path=":memory:"){const sql=new DatabaseSync(path);opened.push(sql);for(const n of readdirSync(new URL("../migrations/",import.meta.url)).filter(n=>n.endsWith(".sql")).sort())sql.exec(readFileSync(new URL(`../migrations/${n}`,import.meta.url),"utf8"));
  const db=sqliteD1(sql),batch=db.batch.bind(db);let queue=Promise.resolve<unknown>(null);db.batch=((items:D1PreparedStatement[])=>{const r=queue.then(()=>batch(items));queue=r.catch(()=>null);return r;}) as D1Database["batch"];return {db,sql};}
it("recovers a lost response after restart without minting twice or repeating an announcement",()=>{
  const r=evaluateRecovery(scenario());expect(r.modeled_state).toBe("ACTIVE");expect(r.restarts).toBe(1);expect(r.modeled_announcements).toBe(1);
  expect(r.steps.map(p=>[p.attempts,p.effects,p.phase])).toEqual(Array(5).fill([1,1,"confirmed"]));expect(r.steps[0]!.tx_alias).toBe("sim-tx-create_token-1");
  expect(r.trace.some(t=>t.outcome==="submission_held_missing_fresh_intent_or_existing_effect")).toBe(true);expect(r.trace.at(-1)!.outcome).toBe("duplicate_announcement_suppressed");
  expect(r).toMatchObject({launch_enabled:false,signing_enabled:false,publishing_enabled:false,chain_evidence_verified:false,provider_requests:0});
});
it("does not treat a recorded intent or restart as permission to submit",()=>{
  const r=run([{kind:"tick"},submit(),{kind:"reconcile",step:"create_token"},{kind:"restart"},submit()]);expect(r.steps[0]!.attempts).toBe(0);expect(r.trace.at(-1)!.outcome).toContain("held");
  expect(run([...start,{kind:"restart"},{kind:"reconcile",step:"create_token"},submit()]).steps[0]!.attempts).toBe(1);
});
it.each(["winner_frozen","simulation_passed","budget_funded","same_chain_tenx_ready"] as const)("holds every effect when assumed %s is missing",guard=>{
  const s=scenario();s.assumed_preflight[guard]=false;const r=evaluateRecovery(s);expect(r.modeled_state).toBe("BLOCKED");expect(r.steps.every(p=>p.effects===0&&p.attempts===0)).toBe(true);expect(r.modeled_announcements).toBe(0);
});
it("holds missing lock verification while preserving completed principal effects",()=>{
  const r=evaluateRecovery(scenario("missing_lock"));expect(r.modeled_state).toBe("TENX_POOL_CREATED");expect(r.modeled_announcements).toBe(0);expect(r.steps.every(p=>p.effects===1)).toBe(true);expect(r.trace.some(t=>t.outcome==="critical_deployment_lock_or_fee_check_missing")).toBe(true);
});
it.each(["deployment_matches","permanent_locks","fee_rights"] as const)("requires the independent assumed %s check before announcement",check=>{
  const s=scenario();const v=s.events.find(e=>e.kind==="verify")!;if(v.kind!=="verify")throw Error("verify");v[check]=false;expect(evaluateRecovery(s).modeled_announcements).toBe(0);
});
it("holds a disappeared receipt without erasing the earlier effect or reminting",()=>{
  const s=scenario("reorg");s.events.push(submit());const r=evaluateRecovery(s);expect(r.modeled_state).toBe("RECOVERY_REQUIRED");expect(r.steps[0]).toMatchObject({effects:1,attempts:1,phase:"uncertain",uncertain:true});expect(r.modeled_announcements).toBe(0);
});
it("freezes step identity across configuration changes instead of inventing a new mint key",()=>{
  const normal=evaluateRecovery(scenario()),changed=evaluateRecovery(scenario("configuration"));expect(changed.steps.map(p=>p.idempotency_key)).toEqual(normal.steps.map(p=>p.idempotency_key));expect(changed.modeled_state).toBe("RECOVERY_REQUIRED");expect(changed.modeled_announcements).toBe(0);expect(changed.steps[0]!.attempts).toBe(1);
  const s=scenario("configuration");s.events.push({kind:"configuration_change",fingerprint:s.configuration_fingerprint},submit());expect(evaluateRecovery(s).modeled_state).toBe("RECOVERY_REQUIRED");
});
it("does not retry pending transactions even when acknowledgement is lost",()=>{
  const events:Events=[...start,submit("create_token","pending",true),{kind:"restart"},{kind:"reconcile",step:"create_token"},{kind:"retry_failed",step:"create_token"},submit(),{kind:"tick"}];
  const r=run(events);expect(r.steps[0]).toMatchObject({attempts:1,effects:0,phase:"submitted"});expect(r.modeled_state).toBe("RECOVERY_REQUIRED");
  const recovered=run([...events,{kind:"chain_status",step:"create_token",attempt:1,status:"finalized"},{kind:"reconcile",step:"create_token"}]);expect(recovered.steps[0]).toMatchObject({attempts:1,effects:1,phase:"confirmed"});
});
it("requires a fresh explicit retry after an assumed definitive failure and caps attempts at two",()=>{
  const failed:Events=[...start,submit("create_token","failed"),{kind:"reconcile",step:"create_token"}];
  expect(run([...failed,submit()]).steps[0]!.attempts).toBe(1);
  const retry:Events=[...failed,{kind:"retry_failed",step:"create_token"},submit(),{kind:"reconcile",step:"create_token"},submit("create_token","failed"),{kind:"reconcile",step:"create_token"},{kind:"retry_failed",step:"create_token"},{kind:"reconcile",step:"create_token"},submit()];
  const r=run(retry);expect(r.steps[0]).toMatchObject({attempts:2,effects:0,phase:"failed"});expect(r.steps[0]!.receipts).toHaveLength(2);
});
it("keeps both attempt receipts and flags a contradicted old failure after retry as manual recovery",()=>{
  const r=run([...start,submit("create_token","failed"),{kind:"reconcile",step:"create_token"},{kind:"retry_failed",step:"create_token"},{kind:"reconcile",step:"create_token"},submit(),{kind:"reconcile",step:"create_token"},{kind:"chain_status",step:"create_token",attempt:1,status:"finalized"},{kind:"reconcile",step:"create_token"}]);
  expect(r.steps[0]).toMatchObject({attempts:2,effects:2,phase:"uncertain",uncertain:true});expect(r.modeled_state).toBe("RECOVERY_REQUIRED");expect(r.modeled_announcements).toBe(0);
});
it.each(["configuration_matches","resource_matches"] as const)("holds conflicting %s rather than accepting a matching transaction status alone",field=>{
  const event=submit();if(event.kind!=="submit")throw Error("submit");event[field]=false;const r=run([...start,event,{kind:"reconcile",step:"create_token"},{kind:"tick"},submit("create_native_pool")]);expect(r.steps[0]!.phase).toBe("conflict");expect(r.steps[1]!.attempts).toBe(0);expect(r.modeled_announcements).toBe(0);
});
it("rejects out-of-order pool creation and unverified early announcements",()=>{
  const r=run([{kind:"reconcile",step:"create_token"},submit("create_tenx_pool"),{kind:"tick"},{kind:"reconcile",step:"create_native_pool"},{kind:"verify",deployment_matches:true,permanent_locks:true,fee_rights:true},{kind:"announce"}]);expect(r.steps.every(p=>p.attempts===0)).toBe(true);expect(r.modeled_announcements).toBe(0);
});
it("invalidates ready permissions and critical verification across pause/resume",()=>{
  expect(run([...start,{kind:"pause"},submit(),{kind:"resume"},submit()]).steps[0]!.attempts).toBe(0);
  const s=scenario();s.events=s.events.slice(0,-2);s.events.push({kind:"pause"},{kind:"resume"},{kind:"announce"});expect(evaluateRecovery(s).modeled_announcements).toBe(0);
  s.events.push(...RecoveryStep.options.map(step=>({kind:"reconcile" as const,step})),{kind:"verify",deployment_matches:true,permanent_locks:true,fee_rights:true},{kind:"announce"});expect(evaluateRecovery(s).modeled_announcements).toBe(1);
});
it("preserves irreversible effects on abort and never resumes an aborted launch",()=>{
  const r=run([...start,submit(),{kind:"reconcile",step:"create_token"},{kind:"abort"},{kind:"resume"},{kind:"restart"},{kind:"tick"},submit("create_native_pool"),{kind:"announce"}]);expect(r.modeled_state).toBe("ABORTED");expect(r.steps[0]!.effects).toBe(1);expect(r.steps[1]!.effects).toBe(0);expect(r.modeled_announcements).toBe(0);
});
it("retains a past modeled announcement but stops claiming ACTIVE after source evidence changes",()=>{
  const s=scenario();s.events.push({kind:"chain_status",step:"lock_positions",attempt:1,status:"missing"},{kind:"announce"});const r=evaluateRecovery(s);expect(r.modeled_announcements).toBe(1);expect(r.modeled_state).toBe("RECOVERY_REQUIRED");expect(r.trace.at(-1)!.outcome).toContain("held");
});
it("requires new reconciliation and verification of all retained steps after restart",()=>{
  const s=scenario();s.events=s.events.slice(0,-2);s.events.push({kind:"restart"},{kind:"verify",deployment_matches:true,permanent_locks:true,fee_rights:true},{kind:"announce"});expect(evaluateRecovery(s).modeled_announcements).toBe(0);
  s.events.push(...RecoveryStep.options.map(step=>({kind:"reconcile" as const,step})),{kind:"verify",deployment_matches:true,permanent_locks:true,fee_rights:true},{kind:"announce"});const r=evaluateRecovery(s);expect(r.modeled_state).toBe("ACTIVE");expect(r.steps.every(p=>p.attempts===1)).toBe(true);
});
it.each(["too_many","invalid_step","real_tx","withdraw","extra_field"])("rejects unsupported exercise input: %s",fault=>{
  const s:any=scenario();if(fault==="too_many")s.events=Array(81).fill({kind:"tick"});if(fault==="invalid_step")s.events[1].step="fund_treasury";if(fault==="real_tx")s.events[2].signed_transaction="secret";if(fault==="withdraw")s.events[0].kind="withdraw_principal";if(fault==="extra_field")s.private_key="secret";expect(RecoveryScenario.safeParse(s).success).toBe(false);
});
it("never performs network I/O and keeps the maximum transcript inside record bounds",()=>{
  const network=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("Network forbidden")),s=scenario();while(s.events.length<80)s.events.push({kind:"tick"});const r=evaluateRecovery(s);expect(r.trace).toHaveLength(80);expect(new TextEncoder().encode(JSON.stringify(s)+JSON.stringify(r)).length).toBeLessThan(100000);expect(new TextEncoder().encode(JSON.stringify(request(s))).length).toBeLessThan(16000);expect(network).not.toHaveBeenCalled();
});
it("saves immutable exercises, retries idempotently, redacts inputs and detects rehashed false results",async()=>{
  const {db,sql}=fixture(),body=request(),record=await createRecovery(db,body,now);expect(await createRecovery(db,body,now)).toEqual(record);expect(await recoveryRecord(db,record.id)).toEqual(record);expect(await replayRecovery(record)).toEqual(record);const list=RecoveryList.parse(await recoveryList(db));expect(list.runs[0]).not.toHaveProperty("inputs");expect(list.runs[0]).not.toHaveProperty("reason");
  const bad=structuredClone(record);bad.result.steps[0]!.effects=0;bad.result_hash=await hashJson(bad.result);const {record_hash:_h,inputs:_i,result:_r,...meta}=bad;bad.record_hash=await hashJson(meta);await expect(replayRecovery(bad)).rejects.toThrow("mismatch");
  await expect(createRecovery(db,{...body,reason:"Conflicting review"},now)).rejects.toThrow("conflict");expect(()=>sql.exec("UPDATE tenx_launch_recovery_labs SET result='{}'")).toThrow("immutable");expect(()=>sql.exec("DELETE FROM tenx_launch_recovery_labs")).toThrow("immutable");
});
it("caps concurrent admissions and retains idempotent retries at the cap",async()=>{
  const {db,sql}=fixture(),body=request(),record=await createRecovery(db,body,now);const runs=await Promise.allSettled(Array.from({length:12},()=>createRecovery(db,request(),now)));expect(runs.filter(r=>r.status==="fulfilled")).toHaveLength(9);expect(runs.filter(r=>r.status==="rejected")).toHaveLength(3);expect(await createRecovery(db,body,now)).toEqual(record);expect((await recoveryList(db)).runs).toHaveLength(5);
  // Reload through a fresh D1 wrapper: no evaluator singleton or mutable journal is required for replay.
  expect(await recoveryRecord(sqliteD1(sql),record.id)).toEqual(record);
});
it("replays a saved exercise after closing and reopening its real local database file",async()=>{
  const folder=mkdtempSync(join(tmpdir(),"tenx-recovery-test-"));folders.push(folder);const path=join(folder,"recovery.sqlite"),{db,sql}=fixture(path),record=await createRecovery(db,request(),now);
  opened.splice(opened.indexOf(sql),1);sql.close();const reopened=new DatabaseSync(path);opened.push(reopened);expect(await recoveryRecord(sqliteD1(reopened),record.id)).toEqual(record);
});
it("resolves conflicting concurrent UUIDs and rolls back an exercise if its audit write fails",async()=>{
  const {db,sql}=fixture(),body=request(),race=await Promise.allSettled([createRecovery(db,body,now),createRecovery(db,{...body,reason:"Conflicting concurrent review"},now)]);expect(race.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(race.filter(r=>r.status==="rejected")).toHaveLength(1);expect(sql.prepare("SELECT COUNT(*) n FROM tenx_launch_recovery_labs").get()).toMatchObject({n:1});
  sql.exec("CREATE TRIGGER fail_recovery_audit BEFORE INSERT ON tenx_audit WHEN NEW.action='launch_recovery_lab' BEGIN SELECT RAISE(ABORT,'test_audit_unavailable'); END;");const next=request();await expect(createRecovery(db,next,now)).rejects.toThrow("test_audit_unavailable");expect(await recoveryRecord(db,next.request_id)).toBeNull();
});
it("preserves local/authentication/origin/body guards and private full-input access",async()=>{
  const {db}=fixture(),env={TENX_DB:db,TENX_ADMIN_TOKEN:"a".repeat(64),TENX_LOCAL_ONLY:"true"} as LocalEnv,body=request();
  const send=(token="",origin?:string,type="application/json",payload=JSON.stringify(body),host="127.0.0.1:8794")=>worker.fetch(new Request(`http://${host}/api/10x/admin/launches/recovery-lab`,{method:"POST",headers:{"content-type":type,...(token?{authorization:`Bearer ${token}`} :{}),...(origin?{origin}:{})},body:payload}),env);
  expect((await send()).status).toBe(401);expect((await send(env.TENX_ADMIN_TOKEN,"https://evil.example")).status).toBe(403);expect((await send(env.TENX_ADMIN_TOKEN,undefined,"text/plain")).status).toBe(415);expect((await send(env.TENX_ADMIN_TOKEN,undefined,"application/json","x".repeat(33000))).status).toBe(413);expect((await send(env.TENX_ADMIN_TOKEN,undefined,"application/json",JSON.stringify(body),"example.com")).status).toBe(503);
  const response=await send(env.TENX_ADMIN_TOKEN);expect(response.status).toBe(200);const record=RecoveryRecord.parse((await response.json() as {record:unknown}).record);
  expect((await worker.fetch(new Request(`http://127.0.0.1:8794/api/10x/admin/launches/recovery-lab/${record.id}`),env)).status).toBe(401);expect((await worker.fetch(new Request("http://127.0.0.1:8794/api/10x/launches/recovery-lab"),env)).status).toBe(200);
});
