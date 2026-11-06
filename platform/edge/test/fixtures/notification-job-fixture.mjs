// Private synthetic Node/workerd acceptance composition; never mounted publicly.
import {createNotificationDeliveryRepository} from '../../../storage/notification-delivery.mjs';
import {createNotificationConsentRepository} from '../../../storage/notification-consent.mjs';
import {buildNotificationConsentCommand} from '../../../notifications/consent.mjs';
import {buildEnqueueNoticeCommand} from '../../../notifications/delivery-plan.mjs';
import {deliveryJobPayload,deliveryJobBusinessKey,deliveryJobSourceKey} from '../../../notifications/delivery-job-plan.mjs';
import {createNotificationDeliveryHandler} from '../../../jobs/notification-delivery-handler.mjs';
import {createJobRepository} from '../../../jobs/repository.mjs';
import {createJobCommand} from '../../../jobs/model.mjs';
import {createHandlerRegistry} from '../../../jobs/handlers.mjs';
import {runTick} from '../../../jobs/runner.mjs';
import {measureBatch,sql} from '../../../storage/atomic-driver.mjs';
export async function callNotificationJobFixture(base,crypto,body){
 const principal={kind:'operator',id:'synthetic-notice-job-worker'};let sequence=0,injected=false;
 await base.batch([sql('UPDATE notification_job_fixture_clock SET now_ms=?',body.nowMs)]);
 const metrics={statements:0,maxBatchBytes:0,maxParameters:0,maxResultBytes:0};
 const driver={...base,leaseNowSql:'(SELECT now_ms FROM notification_job_fixture_clock)',async batch(statements){
  const m=measureBatch(statements);metrics.statements+=m.statements;metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,m.batchBytes);metrics.maxParameters=Math.max(metrics.maxParameters,m.maxParameters);
  const mutation=statements.some(s=>s.sql.startsWith('UPDATE notice_outbox')||s.sql.startsWith('INSERT INTO app_command_receipts'));
  if(mutation&&!injected&&body.fault==='execution-fence'){injected=true;await base.batch([sql('DELETE FROM app_execution_fences')]);}
  const result=await base.batch(statements);metrics.maxResultBytes=Math.max(metrics.maxResultBytes,new TextEncoder().encode(JSON.stringify(result)).length);return result;
 }};
 const ports={crypto,clock:{nowMs:()=>body.nowMs},ids:{next:()=>body.idPrefix+'-'+(++sequence)}},repo=createNotificationDeliveryRepository(driver,ports),jobs=createJobRepository(driver,{...ports,principal}),consent=createNotificationConsentRepository(driver,ports),handler=createNotificationDeliveryHandler({repository:repo,...ports,principal});let result;
 if(body.method==='consent')result=await consent.setConsent(await buildNotificationConsentCommand({principal:{kind:'wallet',wallet:body.wallet},requestKey:body.requestKey,input:body.input,nowMs:body.nowMs},crypto));
 else if(body.method==='enqueue')result=await repo.enqueueNotice(await buildEnqueueNoticeCommand({principal,requestKey:body.requestKey,input:body.input,nowMs:body.nowMs},crypto));
 else if(body.method==='enqueue-job'){const payload=deliveryJobPayload({kind:'notification-delivery-v1',noticeId:body.noticeId});result=await jobs.enqueue(await createJobCommand({principal,requestKey:body.noticeId,nowMs:body.nowMs,input:{businessKey:deliveryJobBusinessKey(payload),sourceKey:deliveryJobSourceKey(payload),type:'deliver-local-notice',payload,readyMs:body.nowMs,maxAttempts:5}},crypto));}
 else if(body.method==='tick')result=await runTick({repository:jobs,clock:ports.clock,handlers:createHandlerRegistry({'deliver-local-notice':handler}),limit:1,deadlineMs:5000});
 else if(body.method==='acquire')result=await jobs.acquireJob();
 else if(body.method==='handle'){const job=await jobs.readJob(body.jobId);let sequence=job.checkpointSeq;result=await handler({job,lease:job.lease,signal:new AbortController().signal,checkpoint:async value=>{const saved=await jobs.checkpoint(job.lease,{sequence,value});if(saved.kind==='checkpointed')sequence=saved.job.checkpointSeq;if(body.fault==='checkpoint'&&!injected){injected=true;return {kind:'pending'};}return saved;}});}
 else if(body.method==='finish-job')result=await jobs.finish(body.jobLease,body.outcome);
 else if(body.method==='lease')result=await repo.leaseDue(principal,{limit:1,noticeId:body.noticeId},body.jobLease);
 else if(body.method==='finish')result=await repo.finishLease(principal,body.noticeLease,body.jobLease);
 else if(body.method==='unknown')result=await repo.finishLease(principal,{...body.noticeLease,outcome:'unknown'},body.jobLease);
 else if(body.method==='reconcile')result=await repo.reconcileUnknown(principal,{id:body.noticeId},body.jobLease);
 else throw Error('Unknown synthetic fixture method.');
 return {result,injected,metrics};
}
