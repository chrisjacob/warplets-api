import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import type {Statement} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {createNotificationConsentRepository} from '../../../storage/notification-consent.mjs';
import {buildNotificationConsentCommand} from '../../../notifications/consent.mjs';
import type {NotificationConsentInput} from '../../../application/notifications';
import {measureBatch,sql} from '../../../storage/atomic-driver.mjs';
type Body={wallet:string;input:NotificationConsentInput;requestKey:string;nowMs:number;idPrefix:string;read?:boolean;fault?:string};
// Synthetic local-only acceptance control, never mounted by the product.
export default {async fetch(request:Request,env:Env){
 if(request.method!=='POST'||new URL(request.url).pathname!=='/__fixture')return new Response('Not found',{status:404});
 const body=await request.json() as Body,base=createD1AtomicDriver(env.DB),principal={kind:'wallet' as const,wallet:body.wallet};let count=0,injected=false;
 await base.batch([sql('UPDATE notification_consent_fixture_clock SET now_ms=?',body.nowMs)]);
 const metrics={statements:0,batches:0,maxBatchBytes:0,maxParameters:0,maxResultBytes:0,mutations:0};
 const driver={...base,leaseNowSql:'(SELECT now_ms FROM notification_consent_fixture_clock)',async batch(statements:readonly Statement[]){
  const m=measureBatch(statements);metrics.statements+=m.statements;metrics.batches++;metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,m.batchBytes);metrics.maxParameters=Math.max(metrics.maxParameters,m.maxParameters);metrics.mutations+=statements.filter(s=>!s.sql.startsWith('SELECT')).length;
  const writes=statements.some(s=>s.sql.startsWith('INSERT INTO app_command_receipts'));
  if(writes&&!injected&&['expire','source-race','generation-race'].includes(body.fault??'')){injected=true;if(body.fault==='expire')await base.batch([sql('UPDATE notification_consent_fixture_clock SET now_ms=?',body.nowMs+30001)]);else if(body.fault==='source-race')await base.batch([sql("UPDATE app_revisions SET revision=revision+1 WHERE name='source'")]);else await base.batch([sql("UPDATE app_recovery_state SET generation='synthetic-new-generation'")]);}
  const needles:Record<string,string>={'omit-pref':'INSERT INTO notice_preferences','omit-key':'INSERT INTO notice_consent_requests','omit-cancel':'UPDATE notice_outbox','omit-inbox':'DELETE FROM notice_inbox'};
  const selected=statements.flatMap(s=>{if(needles[body.fault??'']&&s.sql.startsWith(needles[body.fault??''])){injected=true;return [];}if(body.fault==='wrong-pref'&&s.sql.startsWith('INSERT INTO notice_preferences')){injected=true;const values=[...s.values];values[2]=Number(values[2])+1;return [{...s,values}];}if(body.fault==='wrong-key'&&s.sql.startsWith('INSERT INTO notice_consent_requests')){injected=true;const values=[...s.values];values[3]='f'.repeat(64);return [{...s,values}];}if(body.fault==='uncleared-lease'&&s.sql.startsWith('UPDATE notice_outbox')){injected=true;return [{...s,sql:s.sql.replace(',lease=NULL,lease_until_ms=NULL','')}];}return [s];});
  const result=await base.batch(selected);metrics.maxResultBytes=Math.max(metrics.maxResultBytes,new TextEncoder().encode(JSON.stringify(result)).length);
  if(writes&&!injected&&body.fault==='lost-response'){injected=true;throw Error('Synthetic lost consent response.');}return result;
 }};
 try{const crypto=createWebCrypto(),repo=createNotificationConsentRepository(driver,{crypto,clock:{nowMs:()=>body.nowMs},ids:{next:()=>body.idPrefix+'-'+(++count)}}),result=body.read?await repo.readPreferences(principal):await repo.setConsent(await buildNotificationConsentCommand({principal,input:body.input,requestKey:body.requestKey,nowMs:body.nowMs},crypto));return Response.json({status:200,result,metrics,injected});}
 catch(error){return Response.json({status:500,error:injected?'synthetic-consent-fault':String(error),metrics,injected});}
}};
