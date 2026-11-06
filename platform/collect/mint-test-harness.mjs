import {measureBatch,sql} from '../storage/atomic-driver.mjs';
import {createMintReservationRepository} from './mint-repository.mjs';
import {createMintReservationService,buildMintReservationCommand} from './mint-service.mjs';
export async function dispatchMintReservation({driver:base,crypto:baseCrypto,request}){
 let now=request.nowMs,sequence=0,injected=false;const metrics={statements:0,batches:0,maxBatchBytes:0,maxParameters:0,maxResultBytes:0};
 const driver={...base,leaseNowSql:String(request.nowMs),async batch(statements){
  const m=measureBatch(statements);metrics.statements+=m.statements;metrics.batches++;metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,m.batchBytes);metrics.maxParameters=Math.max(metrics.maxParameters,m.maxParameters);const writes=statements.some(s=>s.sql.startsWith('INSERT INTO app_collection_mint_admissions'));let selected=statements;
  if(writes&&!injected){
   const prefix={'omit-operation':'INSERT INTO collect_operations','omit-fair':'INSERT INTO fair_requests','omit-authority':'UPDATE app_collection_authorities','omit-admission':'INSERT INTO app_collection_mint_admissions'}[request.fault];
   if(prefix){injected=true;selected=statements.filter(s=>!s.sql.startsWith(prefix));}
   if(request.fault==='source-change'){injected=true;await base.batch([sql("UPDATE app_revisions SET revision=revision+1 WHERE name='source'")]);}
   if(request.fault==='watermark-change'){injected=true;await base.batch([sql('UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1')]);}
   if(request.fault==='revoke'){injected=true;await base.batch([sql("UPDATE app_operator_scopes SET enabled=0 WHERE operator=? AND scope='collection-founder'",request.principal.id)]);}
   if(request.fault==='advance-in-batch'){injected=true;now+=request.advanceMs;}
  }
  if(writes&&injected&&['advance-in-batch','advance-final-hash'].includes(request.fault))selected=selected.map(s=>({...s,sql:s.sql.replaceAll(String(request.nowMs),String(now))}));
  const result=await base.batch(selected);metrics.maxResultBytes=Math.max(metrics.maxResultBytes,new TextEncoder().encode(JSON.stringify(result)).length);
  if(writes&&!injected&&request.fault==='lost-response'){injected=true;throw Error('Synthetic mint committed response lost.');}return result;
 }};
 const crypto={...baseCrypto,async sha256(bytes){if(!injected&&request.fault==='advance-final-hash'&&new TextDecoder().decode(bytes).includes('"status":"awaiting-evidence"')){injected=true;now+=request.advanceMs;}return baseCrypto.sha256(bytes);}};
 const ports={crypto,clock:{nowMs:()=>now},ids:{next:()=>request.idPrefix+'-'+(++sequence)}},repository=createMintReservationRepository(driver,ports),service=createMintReservationService({repository,crypto});
 try{let result;if(request.method==='forged'){const command=await buildMintReservationCommand(request.principal,request.input,crypto);result=await repository.reserveMint({...command,input:{...command.input,expectedTermsDigest:'0'.repeat(64)}});}else result=await service.reserveMint(request.principal,request.input);return {status:200,result,injected,metrics};}
 catch(error){return {status:500,error:injected&&request.fault?.startsWith('omit-')?'mandatory-effects-aborted':error.code??error.message,injected,metrics};}
}
