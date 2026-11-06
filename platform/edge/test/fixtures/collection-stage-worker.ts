import worker from '../../src/worker';
import {createD1AtomicDriver,type Statement} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {createStagePublicationService,type StagePublicationInput} from '../../../collect/stage-service.mjs';
import {createStagePublicationRepository} from '../../../collect/stage-repository.mjs';
import {measureBatch,sql} from '../../../storage/atomic-driver.mjs';
type Input={input:StagePublicationInput;requestKey:string;nowMs:number;fault?:'omit-authority'|'omit-revision'|'omit-stage'|'lost-response'|'revoke'};
// Explicit private fixture entry. The production router has no publication route.
export default {async fetch(request:Request,env:Env,ctx:ExecutionContext){
 if(new URL(request.url).pathname!=='/__fixture/stage')return worker.fetch(request,env,ctx);
 const input=await request.json() as Input;if(!Number.isSafeInteger(input.nowMs)||input.nowMs<0)return Response.json({error:'Invalid fixture clock.'},{status:400});
 const base=createD1AtomicDriver(env.DB),principal={kind:'operator' as const,id:'synthetic-stage-publisher'},metrics={statements:0,maxBatchBytes:0,maxParameters:0,mutationStatements:0};let injected=false;
 const driver={...base,leaseNowSql:String(input.nowMs),async batch(statements:readonly Statement[]){
  const m=measureBatch(statements),writes=statements.some(s=>s.sql.startsWith('INSERT INTO app_collection_stages'));metrics.statements+=m.statements;metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,m.batchBytes);metrics.maxParameters=Math.max(metrics.maxParameters,m.maxParameters);if(writes)metrics.mutationStatements=statements.length;
  if(writes&&!injected&&input.fault==='revoke'){injected=true;await base.batch([sql("UPDATE app_operator_scopes SET enabled=0 WHERE operator=? AND scope='collection-publication'",principal.id)]);}
  const omitted=input.fault==='omit-authority'?'INSERT INTO app_collection_authorities':input.fault==='omit-revision'?'UPDATE app_collection_authorities':input.fault==='omit-stage'?'INSERT INTO app_collection_stages':null;
  const result=await base.batch(omitted?statements.filter(s=>!s.sql.startsWith(omitted)):statements);
  if(writes&&!injected&&input.fault==='lost-response'){injected=true;throw Error('Synthetic stage acknowledgement loss.');}return result;
 }};
 const ports={crypto:createWebCrypto(),clock:{nowMs:()=>input.nowMs},ids:{next:()=>crypto.randomUUID()}},service=createStagePublicationService({...ports,repository:createStagePublicationRepository(driver,ports)});
 try{return Response.json({status:200,result:await service.publishStage(principal,{input:input.input,requestKey:input.requestKey}),metrics});}
 catch(error){return Response.json({status:500,error:String(error),metrics});}
}};
