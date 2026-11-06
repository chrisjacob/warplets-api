import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {measureBatch} from '../storage/atomic-driver.mjs';
import {createNotificationDeliveryRepository} from '../storage/notification-delivery.mjs';
import {createNotificationConsentRepository} from '../storage/notification-consent.mjs';
import {NOTICE_TERMS,buildNotificationConsentCommand} from '../notifications/consent.mjs';
import {buildEnqueueNoticeCommand} from '../notifications/delivery-plan.mjs';
import {deliveryJobPayload,deliveryJobBusinessKey,deliveryJobSourceKey} from '../notifications/delivery-job-plan.mjs';
import {encode58} from '../server/base58.mjs';
import {createJobRepository} from './repository.mjs';
import {createJobCommand} from './model.mjs';
import {createHandlerRegistry} from './handlers.mjs';
import {runTick} from './runner.mjs';
import {createNotificationDeliveryHandler} from './notification-delivery-handler.mjs';
const NOW=Date.UTC(2026,10,12),DAY=86400000,principal={kind:'operator',id:'synthetic-notice-job'},wallet=encode58(new Uint8Array(32).fill(123)),crypto=createNodeCrypto();
async function fixture(t){
 const db=openDatabase();t.after(()=>db.close());let now=NOW,hook=null;db.function('synthetic_notice_job_clock',()=>now);const base={...createNodeAtomicDriver(db),leaseNowSql:'synthetic_notice_job_clock()'},metrics=[],driver={...base,async batch(s){metrics.push(measureBatch(s));if(hook)await hook(s);return base.batch(s);}},ports={crypto,clock:{nowMs:()=>now},ids:{next:randomUUID}},repo=createNotificationDeliveryRepository(driver,ports),jobs=createJobRepository(driver,{...ports,principal}),consent=createNotificationConsentRepository(driver,ports);
 for(const scope of ['jobs-runner','notification-work'])db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,scope);
 const enable={channel:'local-inbox',enabled:true,topics:['launch'],terms:NOTICE_TERMS,expectedRevision:0};assert.equal((await consent.setConsent(await buildNotificationConsentCommand({principal:{kind:'wallet',wallet},requestKey:'enable',input:enable,nowMs:now},crypto))).appliedRevision,1);
 const notices=[];for(let n=1;n<=2;n++){db.prepare('INSERT INTO market_fixtures VALUES(?,?,?,?,?)').run(n,'synthetic-job-market-'+n,'mint-'+n,'pool-'+n,JSON.stringify({activatedAt:new Date(now).toISOString()}));const command=await buildEnqueueNoticeCommand({principal,requestKey:'notice-'+n,input:{wallet,topic:'launch',subject:'synthetic-job-market-'+n},nowMs:now},crypto),result=await repo.enqueueNotice(command);assert.equal(result.state,'queued');notices.push(result.id);}
 const payload=deliveryJobPayload({kind:'notification-delivery-v1',noticeId:notices[0]}),command=await createJobCommand({principal,requestKey:'job-'+notices[0],nowMs:now,input:{businessKey:deliveryJobBusinessKey(payload),sourceKey:deliveryJobSourceKey(payload),type:'deliver-local-notice',payload,readyMs:now,maxAttempts:5}},crypto);assert.equal((await jobs.enqueue(command)).kind,'committed');
 const handler=createNotificationDeliveryHandler({repository:repo,...ports,principal}),handlers=createHandlerRegistry({'deliver-local-notice':handler}),tick=()=>runTick({repository:jobs,clock:ports.clock,handlers,limit:1,deadlineMs:5000});
 const context=job=>{let sequence=job.checkpointSeq;return {job,lease:job.lease,signal:new AbortController().signal,checkpoint:async value=>{const out=await jobs.checkpoint(job.lease,{sequence,value});if(out.kind==='checkpointed')sequence=out.job.checkpointSeq;return out;}};};
 return {db,repo,jobs,consent,ports,notices,handler,tick,context,base,metrics,setNow:n=>now=n,getNow:()=>now,setHook:f=>hook=f,enable};
}
const effects=db=>JSON.stringify(['notice_outbox','notice_inbox','app_command_receipts'].map(name=>[name,db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()]));
test('B03 delivers exactly one known notice after durable token checkpoint; unrelated notice remains untouched',async t=>{
 const f=await fixture(t);let checked=false;f.setHook(statements=>{if(statements.some(s=>s.sql.startsWith('INSERT INTO notice_inbox'))){const row=f.db.prepare('SELECT checkpoint_json FROM app_jobs').get(),cp=JSON.parse(row.checkpoint_json),notice=f.db.prepare('SELECT lease FROM notice_outbox WHERE id=?').get(f.notices[0]);assert.equal(cp.noticeLease.lease,notice.lease);assert.equal(cp.noticeLease.id,f.notices[0]);checked=true;}});
 const result=await f.tick();assert.equal(result.items[0].job.state,'completed');assert.equal(result.items[0].job.result.state,'delivered');assert.equal(checked,true);assert.equal(f.db.prepare('SELECT state FROM notice_outbox WHERE id=?').get(f.notices[1]).state,'queued');assert.equal(f.db.prepare('SELECT attempts FROM notice_outbox WHERE id=?').get(f.notices[1]).attempts,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM notice_inbox').get().n,1);assert.ok(f.metrics.every(m=>m.batchBytes<=262144&&m.maxParameters<=100));
});
test('failed/aborted checkpoint never finishes or invents a notice token; exact saved checkpoint resumes',async t=>{
 const f=await fixture(t),acquired=await f.jobs.acquireJob(),ctx=f.context(acquired.job);let real=null;
 const output=await f.handler({...ctx,checkpoint:async value=>{real=await ctx.checkpoint(value);return {kind:'pending',reason:'synthetic-lost-checkpoint-ack'};}});assert.equal(output.reason,'notice-checkpoint-unknown');assert.equal(real.kind,'checkpointed');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM notice_inbox').get().n,0);assert.equal(f.db.prepare('SELECT state FROM notice_outbox WHERE id=?').get(f.notices[0]).state,'leased');
 const resumed=f.context(await f.jobs.readJob(acquired.job.id));assert.equal((await f.handler(resumed)).result.state,'delivered');assert.equal(f.db.prepare('SELECT attempts FROM notice_outbox WHERE id=?').get(f.notices[0]).attempts,1);
 const other=await fixture(t),job=(await other.jobs.acquireJob()).job,abort=new AbortController();abort.abort();const before=effects(other.db);assert.equal((await other.handler({...other.context(job),signal:abort.signal})).reason,'notice-handler-aborted');assert.equal(effects(other.db),before);
});
test('expired notice token reconciles unknown before retry; revoked worker can reconcile but cannot redeliver',async t=>{
 const f=await fixture(t),first=(await f.jobs.acquireJob()).job,ctx=f.context(first);await f.handler({...ctx,checkpoint:async value=>{await ctx.checkpoint(value);return {kind:'pending'};}});f.setNow(NOW+30001);
 const replacement=(await f.jobs.acquireJob()).job;assert.equal(replacement.attempt,2);const result=await f.handler(f.context(replacement));assert.equal(result.state,'retry');assert.equal(result.reason,'notice-retry');assert.equal(f.db.prepare('SELECT state FROM notice_outbox WHERE id=?').get(f.notices[0]).state,'retry');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM notice_inbox').get().n,0);
 assert.equal((await f.jobs.finish(replacement.lease,result)).kind,'finished');f.setNow(result.readyMs);assert.equal((await f.tick()).items[0].job.result.state,'delivered');assert.equal(f.db.prepare('SELECT attempts FROM notice_outbox WHERE id=?').get(f.notices[0]).attempts,2);
 const revoked=await fixture(t),job=(await revoked.jobs.acquireJob()).job,[token]=await revoked.repo.leaseDue(principal,{limit:1,noticeId:revoked.notices[0]},job.lease);assert.equal((await revoked.repo.finishLease(principal,{...token,outcome:'unknown'},job.lease)).state,'unknown');revoked.db.prepare("UPDATE app_operator_scopes SET enabled=0 WHERE scope='notification-work'").run();assert.equal((await revoked.repo.reconcileUnknown(principal,{id:token.id},job.lease)).state,'retry');assert.equal((await revoked.repo.leaseDue(principal,{limit:1,noticeId:token.id},job.lease)).code,'operator_scope_required');
});
test('job/notice mutations require both real leases and exact source payload; finished delivery replay remains read-only',async t=>{
 for(const fault of ['job-expiry','job-token','execution-fence','wrong-notice','job-scope']){const f=await fixture(t),job=(await f.jobs.acquireJob()).job,lease=structuredClone(job.lease);if(fault==='job-expiry')f.setNow(NOW+30000);if(fault==='job-token')lease.token='synthetic-stolen';if(fault==='execution-fence')f.db.prepare('DELETE FROM app_execution_fences').run();if(fault==='job-scope')f.db.prepare("UPDATE app_operator_scopes SET enabled=0 WHERE scope='jobs-runner'").run();const before=effects(f.db);assert.deepEqual(await f.repo.leaseDue(principal,{limit:1,noticeId:f.notices[fault==='wrong-notice'?1:0]},lease),[]);assert.equal(effects(f.db),before,fault);}
 const f=await fixture(t),job=(await f.jobs.acquireJob()).job,[token]=await f.repo.leaseDue(principal,{limit:1,noticeId:f.notices[0]},job.lease);f.db.prepare('DELETE FROM app_execution_fences').run();const before=effects(f.db),failed=await f.repo.finishLease(principal,token,job.lease);assert.equal(failed.kind,'conflict');assert.equal(effects(f.db),before);
 assert.equal((await f.repo.finishLease(principal,token)).state,'delivered');assert.equal((await f.consent.setConsent(await buildNotificationConsentCommand({principal:{kind:'wallet',wallet},requestKey:'revoke',input:{...f.enable,enabled:false,topics:[],expectedRevision:1},nowMs:NOW},crypto))).appliedRevision,2);f.db.prepare('UPDATE app_operator_scopes SET enabled=0').run();const after=effects(f.db);assert.equal((await f.repo.finishLease(principal,token,{...job.lease,token:'stale'})).state,'delivered');assert.equal(effects(f.db),after);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM notice_inbox').get().n,0);
});
test('cancelled/expired notice job reports its real terminal state and optional pause never claims delivery',async t=>{
 for(const mode of ['expired','revoked','pause']){const f=await fixture(t);if(mode==='expired')f.setNow(NOW+DAY);if(mode==='revoked')await f.consent.setConsent(await buildNotificationConsentCommand({principal:{kind:'wallet',wallet},requestKey:'revoke',input:{...f.enable,enabled:false,topics:[],expectedRevision:1},nowMs:NOW},crypto));if(mode==='pause')f.db.prepare("INSERT INTO ops_scope_log VALUES('synthetic-job-pause','optional-notifications',1,NULL,?,'fixture','pause','fixture','pause')").run(NOW);const result=await f.tick();assert.equal(result.items[0].job.state,mode==='pause'?'retry':'completed');if(mode!=='pause')assert.equal(result.items[0].job.result.state,'cancelled');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM notice_inbox').get().n,0);}
});
