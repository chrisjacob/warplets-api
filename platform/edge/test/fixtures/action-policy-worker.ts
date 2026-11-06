import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import type {Statement} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {createActionPolicyRepository} from '../../../earn/action-policy-repository.mjs';
import {verifyRecoveredActionPolicy} from '../../../recovery/v2-reconcile-action-policies.mjs';
import {buildActionPolicyCommand} from '../../../earn/action-policy-service.mjs';
import type {ActionPolicyInput,ActionPolicyRevisions} from '../../../earn/action-policy-service.mjs';
import {measureBatch,sql} from '../../../storage/atomic-driver.mjs';
type Body={input:ActionPolicyInput;requestKey:string;expectedRevisions:ActionPolicyRevisions;nowMs:number;idPrefix:string;preview?:boolean;verifyRecovery?:boolean;fault?:'omit-catalog'|'omit-policy'|'omit-audit'|'alter-audit'|'midnight'|'expired'|'revoke'|'lost-response'};
// Private synthetic local fixture. No operator route is exposed by the product.
export default {async fetch(request:Request,env:Env){
 if(request.method!=='POST'||new URL(request.url).pathname!=='/__fixture')return new Response('Not found',{status:404});
 const body=await request.json() as Body;if(!Number.isSafeInteger(body.nowMs)||body.nowMs<0)return new Response('Invalid fixture clock',{status:400});
 const base=createD1AtomicDriver(env.DB),cryptoPort=createWebCrypto(),principal={kind:'operator' as const,id:'synthetic-action-policy-operator'};let sequence=0,injected=false;
 await base.batch([sql('UPDATE action_policy_fixture_clock SET now_ms=?',body.nowMs)]);
 const metrics={statements:0,batches:0,maxBatchBytes:0,maxParameters:0,maxResultBytes:0,mutationStatements:0};
 const driver={...base,leaseNowSql:'(SELECT now_ms FROM action_policy_fixture_clock)',async batch(statements:readonly Statement[]){
  const size=measureBatch(statements);metrics.statements+=size.statements;metrics.batches++;metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,size.batchBytes);metrics.maxParameters=Math.max(metrics.maxParameters,size.maxParameters);
  const writes=statements.some(s=>s.sql.startsWith('INSERT INTO app_command_receipts'));if(writes)metrics.mutationStatements=statements.length;
  if(writes&&!injected&&['midnight','expired','revoke'].includes(body.fault??'')){injected=true;
   if(body.fault==='revoke')await base.batch([sql("UPDATE app_operator_scopes SET enabled=0,revision=revision+1 WHERE operator=?",principal.id)]);
   else await base.batch([sql('UPDATE action_policy_fixture_clock SET now_ms=?',body.fault==='midnight'?body.input.effectiveEpoch*86400000:body.nowMs+30001)]);
  }
  const omitted={'omit-catalog':'earn_action_catalog','omit-policy':'earn_action_changes','omit-audit':'ops_config_audit'}[body.fault as 'omit-catalog'|'omit-policy'|'omit-audit'];
  const selected=statements.flatMap(s=>{if(omitted&&s.sql.startsWith('INSERT INTO '+omitted)){injected=true;return [];}if(body.fault==='alter-audit'&&s.sql.startsWith('INSERT INTO ops_config_audit')){injected=true;const values=[...s.values];values[7]='synthetic-wrong-operator';return [{...s,values}];}return [s];});
  const result=await base.batch(selected);metrics.maxResultBytes=Math.max(metrics.maxResultBytes,new TextEncoder().encode(JSON.stringify(result)).length);
  if(writes&&!injected&&body.fault==='lost-response'){injected=true;throw Error('Synthetic action-policy acknowledgement loss');}return result;
 }};
 try{if(body.verifyRecovery){const rows=await driver.batch([sql("SELECT * FROM app_command_receipts WHERE operation_kind='earn.configure-action.v1' AND principal_key=? AND request_key=?",'operator:'+principal.id,body.requestKey)]),command=await verifyRecoveredActionPolicy(rows[0].rows[0],async(statements:readonly Statement[])=>(await driver.batch(statements)).map(r=>r.rows),cryptoPort);return Response.json({status:200,result:{kind:'verified',requestDigest:command.requestDigest,businessIdentity:command.businessIdentity},metrics,injected});}
  const repository=createActionPolicyRepository(driver,{crypto:cryptoPort,clock:{nowMs:()=>body.nowMs},ids:{next:()=>body.idPrefix+'-'+(++sequence)}}),command=await buildActionPolicyCommand({principal,input:body.input,requestKey:body.requestKey,nowMs:body.nowMs,expectedRevisions:body.expectedRevisions},cryptoPort),result=body.preview?await repository.previewAction(command):await repository.configureAction(command);return Response.json({status:200,result,metrics,injected});}
 catch(error){return Response.json({status:500,error:injected?'synthetic-action-policy-fault':String(error),metrics,injected});}
}};
