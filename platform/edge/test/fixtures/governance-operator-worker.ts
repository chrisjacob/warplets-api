import worker from '../../src/worker';
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import type {Statement} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {createGovernanceOperatorService,prepareGovernanceOperatorCommand,PUBLISH_BALLOT,RECORD_DECISION} from '../../../governance/operator-service.mjs';
import type {GovernancePublicationInput} from '../../../governance/operator-service.mjs';
import type {RecordGenesisDecisionCommand} from '../../../application/collections';
import {createGovernanceOperatorRepository} from '../../../governance/operator-repository.mjs';
import {measureBatch,sql} from '../../../storage/atomic-driver.mjs';
type Input={method:'publish'|'decision'|'preview-publish'|'preview-decision';expectedRevisions?:{earn:string;source:string;control:string};input:GovernancePublicationInput|RecordGenesisDecisionCommand['input'];key:string;nowMs:number;fault?:'omit-audit'|'alter-audit'|'omit-voters'|'omit-binding'|'omit-decision'|'lost-response'|'revoke'|'tamper-index'|'tamper-record'|'clock'};
// Internal synthetic fixture only. The product router has no operator endpoint.
export default {async fetch(request:Request,env:Env,ctx:ExecutionContext){
 if(new URL(request.url).pathname!=='/__fixture/operator')return worker.fetch(request,env,ctx);
 const input=await request.json() as Input;if(!Number.isSafeInteger(input.nowMs)||input.nowMs<0)return Response.json({error:'Invalid fixture clock.'},{status:400});
 const base=createD1AtomicDriver(env.DB),principal={kind:'operator' as const,id:'synthetic-governance-operator'};let injected=false;
 await base.batch([sql('UPDATE governance_operator_clock SET now_ms=?',input.nowMs)]);
 const metrics={statements:0,maxBatchBytes:0,maxParameters:0,mutationStatements:0};
 const driver={...base,leaseNowSql:'(SELECT now_ms FROM governance_operator_clock)',async batch(statements:readonly Statement[]){
  const size=measureBatch(statements);metrics.statements+=size.statements;metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,size.batchBytes);metrics.maxParameters=Math.max(metrics.maxParameters,size.maxParameters);
  const writes=statements.some(s=>s.sql.startsWith('INSERT INTO app_command_receipts'));if(writes)metrics.mutationStatements=statements.length;
  if(writes&&!injected&&input.fault==='revoke'){injected=true;await base.batch([sql('UPDATE app_operator_scopes SET enabled=0 WHERE operator=? AND scope=?',principal.id,input.method.endsWith('publish')?'governance-publication':'governance-decision')]);}
  if(writes&&!injected&&input.fault==='clock'){injected=true;await base.batch([sql('UPDATE governance_operator_clock SET now_ms=?',input.nowMs-1)]);}
  const omitted=input.fault==='omit-audit'?'ops_config_audit':input.fault==='omit-voters'?'genesis_voters':input.fault==='omit-binding'?'app_governance_publications':input.fault==='omit-decision'?'genesis_decisions':null;
  const selected=statements.flatMap(s=>{if(omitted&&s.sql.startsWith('INSERT INTO '+omitted)){injected=true;return [];}if(input.fault==='alter-audit'&&s.sql.startsWith('INSERT INTO ops_config_audit')){injected=true;const values=[...s.values];values[7]='synthetic-wrong-operator';return [{...s,values}];}return [s];});
  const result=await base.batch(selected);
  if(writes&&!injected&&input.fault==='lost-response'){injected=true;throw Error('Synthetic governance commit acknowledgement loss.');}
  for(let i=0;i<statements.length;i++){
   if(input.fault==='tamper-index'&&statements[i].sql.includes('FROM app_collection_eligibility_pages WHERE'))for(const row of result[i].rows)row.entries_json='[]';
   if(input.fault==='tamper-record'&&statements[i].sql.startsWith('SELECT id,size,body_base64 FROM'))for(const row of result[i].rows)row.body_base64=btoa('x'.repeat(Number(row.size)));
  }
  return result;
 }};
 const cryptoPort=createWebCrypto(),repository=createGovernanceOperatorRepository(driver,{crypto:cryptoPort,ids:{next:()=>crypto.randomUUID()}}),service=createGovernanceOperatorService({repository,crypto:cryptoPort,clock:{nowMs:()=>input.nowMs}});
 try{let result;
  if(input.method==='preview-publish')result=await repository.previewBallot!(await prepareGovernanceOperatorCommand(PUBLISH_BALLOT,{principal,input:input.input as GovernancePublicationInput,requestKey:input.key,expectedRevisions:input.expectedRevisions??{},nowMs:input.nowMs},cryptoPort));
  else if(input.method==='preview-decision')result=await repository.previewDecision!(await prepareGovernanceOperatorCommand(RECORD_DECISION,{principal,input:input.input as RecordGenesisDecisionCommand['input'],requestKey:input.key,expectedRevisions:input.expectedRevisions??{},nowMs:input.nowMs},cryptoPort));
  else result=input.method==='publish'?await service.publishBallot(principal,{input:input.input as GovernancePublicationInput,requestKey:input.key,expectedRevisions:input.expectedRevisions}):await service.recordDecision(principal,{input:input.input as RecordGenesisDecisionCommand['input'],requestKey:input.key,expectedRevisions:input.expectedRevisions});
  return Response.json({status:200,result,metrics,injected});}
 catch(error){return Response.json({status:500,error:String(error),metrics,injected});}
}};
