import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {collectionSourceTestDispatch,COLLECTION_TEST_OPERATOR} from '../../../collect/source-test-harness.mjs';
import {createEligibilityIndexService} from '../../../collect/eligibility-index-service.mjs';
import {createEligibilityIndexRepository} from '../../../collect/eligibility-index-repository.mjs';
import {measureBatch,sql} from '../../../storage/atomic-driver.mjs';
import type {Statement} from '../../../storage/d1/atomic-driver';
type Input={method:string;id:string;key:string;expectedRevisions?:Record<string,string>;fault?:'omit-child'|'lost-response'|'revoke'|'tamper-record'|'tamper-index'};
// Synthetic private fixture only; no product HTTP route exposes materialization.
export default {async fetch(request:Request,env:Env){
 const input=await request.json() as Input,base=createD1AtomicDriver(env.DB),cryptoPort=createWebCrypto(),ids={next:()=>crypto.randomUUID()};
 if(input.method==='stage')return Response.json(await collectionSourceTestDispatch({driver:base,crypto:cryptoPort,ids,request:input}));
 let injected=false;const metrics={statements:0,maxBatchBytes:0,maxParameters:0};
 const driver={...base,leaseNowSql:'180000001',async batch(statements:readonly Statement[]){
  const m=measureBatch(statements);metrics.statements+=m.statements;metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,m.batchBytes);metrics.maxParameters=Math.max(metrics.maxParameters,m.maxParameters);
  const writes=statements.some(s=>s.sql.startsWith('INSERT INTO app_collection_eligibility_pages'));
  if(writes&&!injected&&input.fault==='revoke'){injected=true;await base.batch([sql("UPDATE app_operator_scopes SET enabled=0 WHERE operator=? AND scope='collection-import'",COLLECTION_TEST_OPERATOR.id)]);}
  const selected=writes&&input.fault==='omit-child'?statements.filter(s=>!s.sql.startsWith('INSERT INTO app_collection_eligibility_pages')):statements;
  const result=await base.batch(selected);
  if(writes&&!injected&&input.fault==='lost-response'){injected=true;throw Error('Synthetic index response lost after commit.');}
  for(let i=0;i<statements.length;i++){
   if(input.fault==='tamper-record'&&statements[i].sql.includes('body_base64 FROM app_collection_records'))for(const row of result[i].rows)row.body_base64=btoa('x'.repeat(Number(row.size)));
   if(input.fault==='tamper-index'&&statements[i].sql.includes('FROM app_collection_eligibility_pages WHERE'))for(const row of result[i].rows)row.entries_json='[]';
  }
  return result;
 }};
 const service=createEligibilityIndexService({repository:createEligibilityIndexRepository(driver,{crypto:cryptoPort,ids,clock:{nowMs:()=>180000001}}),crypto:cryptoPort,clock:{nowMs:()=>180000001}});
 try{return Response.json({status:200,result:await service.materializePage({kind:'operator',id:COLLECTION_TEST_OPERATOR.id},{id:input.id,requestKey:input.key,expectedRevisions:input.expectedRevisions}),metrics});}
 catch(error){return Response.json({status:500,error:String(error),metrics});}
}};
