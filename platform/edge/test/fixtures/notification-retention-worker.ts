import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import type {Statement} from '../../../storage/d1/atomic-driver';
import type {JobLease} from '../../../application/ports';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {createNotificationDeliveryRepository} from '../../../storage/notification-delivery.mjs';
import {createNotificationRetentionHandler} from '../../../jobs/notification-retention-handler.mjs';
import {createJobRepository} from '../../../jobs/repository.mjs';
import {createJobCommand} from '../../../jobs/model.mjs';
import {createHandlerRegistry} from '../../../jobs/handlers.mjs';
import {runTick} from '../../../jobs/runner.mjs';
import {retentionPayload,retentionBusinessKey,retentionSourceKey} from '../../../notifications/retention-plan.mjs';
import {measureBatch,sql} from '../../../storage/atomic-driver.mjs';
type Body={method:'purge'|'enqueue-job'|'acquire-job'|'tick';nowMs:number;limit?:number;runKey?:string;lease?:JobLease;fault?:'clock'|'lost';idPrefix:string};
export default {async fetch(request:Request,env:Env){
 if(request.method!=='POST'||new URL(request.url).pathname!=='/__fixture')return new Response('Not found',{status:404});
 const body=await request.json() as Body,base=createD1AtomicDriver(env.DB),principal={kind:'operator' as const,id:'synthetic-retention-worker'},crypto=createWebCrypto();let sequence=0,injected=false;
 await base.batch([sql('UPDATE notification_retention_fixture_clock SET now_ms=?',body.nowMs)]);
 const metrics={statements:0,batches:0,maxBatchBytes:0,maxParameters:0,maxResultBytes:0};
 const driver={...base,leaseNowSql:'(SELECT now_ms FROM notification_retention_fixture_clock)',async batch(statements:readonly Statement[]){
  const m=measureBatch(statements);metrics.statements+=m.statements;metrics.batches++;metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,m.batchBytes);metrics.maxParameters=Math.max(metrics.maxParameters,m.maxParameters);
  const purge=statements.some(s=>s.sql.startsWith('WITH due AS'));if(purge&&!injected&&body.fault==='clock'){injected=true;await base.batch([sql('UPDATE notification_retention_fixture_clock SET now_ms=?',body.nowMs+30000)]);}
  const result=await base.batch(statements);metrics.maxResultBytes=Math.max(metrics.maxResultBytes,new TextEncoder().encode(JSON.stringify(result)).length);if(purge&&!injected&&body.fault==='lost'){injected=true;throw Error('Synthetic committed purge response loss.');}return result;
 }};
 const ports={crypto,clock:{nowMs:()=>body.nowMs},ids:{next:()=>body.idPrefix+'-'+(++sequence)}},repository=createNotificationDeliveryRepository(driver,ports),jobs=createJobRepository(driver,{...ports,principal});let result;
 if(body.method==='purge')result=await repository.purgeExpired(principal,{limit:body.limit},body.lease);
 else if(body.method==='enqueue-job'){const payload=retentionPayload({kind:'notification-retention-v1',runKey:body.runKey,limit:body.limit});result=await jobs.enqueue(await createJobCommand({principal,requestKey:payload.runKey,nowMs:body.nowMs,input:{businessKey:retentionBusinessKey(payload),sourceKey:retentionSourceKey(payload),type:'retention-maintenance',payload,readyMs:body.nowMs,maxAttempts:5}},crypto));}
 else if(body.method==='acquire-job')result=await jobs.acquireJob();
 else result=await runTick({repository:jobs,clock:ports.clock,handlers:createHandlerRegistry({'retention-maintenance':createNotificationRetentionHandler({repository,...ports,principal})}),limit:1,deadlineMs:5000});
 return Response.json({result,injected,metrics});
}};
