import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import type {Statement} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {createNotificationDeliveryRepository} from '../../../storage/notification-delivery.mjs';
import {createNotificationConsentRepository} from '../../../storage/notification-consent.mjs';
import {buildNotificationConsentCommand} from '../../../notifications/consent.mjs';
import {buildEnqueueNoticeCommand,ENQUEUE_NOTICE,DELIVER_NOTICE} from '../../../notifications/delivery-plan.mjs';
import type {EnqueueNoticeInput,NotificationConsentInput} from '../../../application/notifications';
import {measureBatch,sql} from '../../../storage/atomic-driver.mjs';
type Body={method:'enqueue'|'lease'|'finish'|'reconcile'|'inbox'|'consent';input?:EnqueueNoticeInput;wallet:string;requestKey:string;nowMs:number;idPrefix:string;limit?:number;cursor?:string|null;id?:string;lease?:string;outcome?:'delivered'|'retryable'|'unknown';consent?:NotificationConsentInput;fault?:string};
export default {async fetch(request:Request,env:Env){
 if(request.method!=='POST'||new URL(request.url).pathname!=='/__fixture')return new Response('Not found',{status:404});
 const body=await request.json() as Body,base=createD1AtomicDriver(env.DB),principal={kind:'operator' as const,id:'synthetic-notice-worker'},crypto=createWebCrypto();let sequence=0,injected=false;
 await base.batch([sql('UPDATE notification_delivery_fixture_clock SET now_ms=?',body.nowMs)]);
 const metrics={statements:0,batches:0,maxBatchBytes:0,maxParameters:0,maxResultBytes:0};
 const driver={...base,leaseNowSql:'(SELECT now_ms FROM notification_delivery_fixture_clock)',async batch(statements:readonly Statement[]){
  const m=measureBatch(statements);metrics.statements+=m.statements;metrics.batches++;metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,m.batchBytes);metrics.maxParameters=Math.max(metrics.maxParameters,m.maxParameters);
  const claim=statements.find(s=>s.sql.startsWith('INSERT INTO app_command_receipts')),kind=claim?.values[2];
  if(claim&&!injected&&['expire','revoke-worker','source-race'].includes(body.fault??'')){injected=true;if(body.fault==='expire')await base.batch([sql('UPDATE notification_delivery_fixture_clock SET now_ms=?',body.nowMs+30001)]);else if(body.fault==='revoke-worker')await base.batch([sql('UPDATE app_operator_scopes SET enabled=0 WHERE operator=?',principal.id)]);else await base.batch([sql('UPDATE market_fixtures SET body=? WHERE id=?',JSON.stringify({activatedAt:new Date(body.nowMs+86400000).toISOString()}),'synthetic-market-1')]);}
  const selected=statements.flatMap(s=>{if(body.fault==='omit-outbox'&&kind===ENQUEUE_NOTICE&&s.sql.startsWith('INSERT INTO notice_outbox')||body.fault==='omit-inbox'&&kind===DELIVER_NOTICE&&s.sql.startsWith('INSERT INTO notice_inbox')||body.fault==='omit-delivered'&&kind===DELIVER_NOTICE&&s.sql.startsWith('UPDATE notice_outbox')){injected=true;return [];}if(body.fault==='alter-template'&&s.sql.startsWith('INSERT INTO notice_outbox')){injected=true;const values=[...s.values];values[6]='Arbitrary text';return [{...s,values}];}return [s];});
  const result=await base.batch(selected);metrics.maxResultBytes=Math.max(metrics.maxResultBytes,new TextEncoder().encode(JSON.stringify(result)).length);if(claim&&!injected&&(body.fault==='lost-enqueue'&&kind===ENQUEUE_NOTICE||body.fault==='lost-delivery'&&kind===DELIVER_NOTICE)){injected=true;throw Error('Synthetic notice response loss.');}return result;
 }};
 try{const ports={crypto,clock:{nowMs:()=>body.nowMs},ids:{next:()=>body.idPrefix+'-'+(++sequence)}},repo=createNotificationDeliveryRepository(driver,ports);let result;
  if(body.method==='enqueue')result=await repo.enqueueNotice(await buildEnqueueNoticeCommand({principal,requestKey:body.requestKey,input:body.input!,nowMs:body.nowMs},crypto));
  else if(body.method==='lease')result=await repo.leaseDue(principal,{limit:body.limit});
  else if(body.method==='finish')result=await repo.finishLease(principal,{id:body.id!,lease:body.lease!,outcome:body.outcome});
  else if(body.method==='reconcile')result=await repo.reconcileUnknown(principal,{id:body.id!});
  else if(body.method==='consent')result=await createNotificationConsentRepository(driver,ports).setConsent(await buildNotificationConsentCommand({principal:{kind:'wallet',wallet:body.wallet},requestKey:body.requestKey,input:body.consent!,nowMs:body.nowMs},crypto));
  else result=await repo.readInbox({kind:'wallet',wallet:body.wallet},{cursor:body.cursor,limit:body.limit});
  return Response.json({status:200,result,metrics,injected});
 }catch(error){return Response.json({status:500,error:injected?'synthetic-notice-fault':String(error),metrics,injected});}
}};
