import {createProgressionReservationRepository} from './reservation-repository.mjs';
import {createProgressionReservationService,buildProgressionReservationCommand} from './reservation-service.mjs';
import {createCollectionQuoteService} from './quote-service.mjs';
import {createCollectionQuoteRepository} from './quote-repository.mjs';
import {sql,measureBatch} from '../storage/atomic-driver.mjs';
export function reviewedReservation(quote,requestKey){return {requestKey,kind:quote.kind,inventoryId:quote.inventoryId,targetId:quote.targetId,materialId:quote.materialId,expectedTargetVersion:quote.targetVersion,expectedMaterialVersion:quote.materialVersion,quoteId:quote.id,bindingDigest:quote.bindingDigest,policyVersion:quote.policyVersion,reviewedFeeLamports:quote.feeLamports,reviewedMaxTotalLamports:quote.maxTotalLamports,quoteExpiresMs:quote.expiresMs};}
/** Private synthetic acceptance transport; never a product route. */
export async function dispatchProgressionReservation({driver:base,crypto:baseCrypto,request}){
 let now=request.nowMs,sequence=0,injected=false,armed=false;if(!Number.isSafeInteger(now)||now<0)throw new TypeError('Invalid fixture clock.');
 const metrics={statements:0,batches:0,maxBatchBytes:0,maxParameters:0};
 const driver={...base,...(request.productionClock?{}:{leaseNowSql:String(now)}),async batch(statements){
  const size=measureBatch(statements);metrics.statements+=size.statements;metrics.batches++;metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,size.batchBytes);metrics.maxParameters=Math.max(metrics.maxParameters,size.maxParameters);
  if(statements.some(s=>s.sql.includes('FROM ops_scope_log'))&&statements.length===8)armed=true;
  const writes=statements.some(s=>s.sql.startsWith('INSERT INTO collect_operations'));let selected=statements;
  if(writes&&!injected&&['omit-target','omit-material','omit-operation','omit-fair','omit-link'].includes(request.fault)){
   injected=true;selected=statements.filter(s=>request.fault==='omit-target'?!(s.sql.startsWith('UPDATE collect_assets')&&s.values[2]===request.input.targetId):request.fault==='omit-material'?!(s.sql.startsWith('UPDATE collect_assets')&&s.values[2]===request.input.materialId):!s.sql.startsWith({'omit-operation':'INSERT INTO collect_operations','omit-fair':'INSERT INTO fair_requests','omit-link':'INSERT INTO app_collection_reservations'}[request.fault]));
  }
  if(writes&&!injected&&['expire-in-batch','advance-in-batch'].includes(request.fault)){injected=true;now=request.fault==='expire-in-batch'?request.input.quoteExpiresMs:now+request.advanceMs;selected=statements.map(s=>({...s,sql:s.sql.replaceAll(String(request.nowMs),String(now))}));}
  if(writes&&injected&&request.fault==='fair-final-hash')selected=statements.map(s=>({...s,sql:s.sql.replaceAll(String(request.nowMs),String(now))}));
  const result=await base.batch(selected);if(writes&&!injected&&request.fault==='lost-response'){injected=true;throw Error('Synthetic lost committed reservation response.');}return result;
 }};
 const crypto={...baseCrypto,async sha256(bytes){
  if(armed&&!injected){
   if(request.fault==='fair-final-hash'&&new TextDecoder().decode(bytes).includes('"status":"awaiting-evidence"')){injected=true;now=request.roundAtMs;}
   if(request.fault==='source-change'){injected=true;await base.batch([sql('UPDATE collect_inventories SET revision=revision+1 WHERE id=?',request.input.inventoryId)]);}
   if(request.fault==='owner-change'){injected=true;await base.batch([sql('UPDATE collect_assets SET owner=? WHERE id=?',request.other,request.input.targetId)]);}
   if(request.fault==='pause'){injected=true;await base.batch([sql('INSERT INTO ops_scope_log VALUES(?,?,?,?,?,?,?,?,?)','synthetic-pause-'+request.idPrefix,'collection-progression',1,null,now,'synthetic-operator','Synthetic acceptance pause','synthetic-evidence','synthetic-pause-'+request.idPrefix)]);}
   if(request.fault==='configure-fair'){injected=true;await base.batch([sql('INSERT INTO fair_inventories VALUES(?,?,?,?)',request.input.inventoryId,'b'.repeat(64),'{}',now)]);}
   if(request.fault==='expire-during-hash'){injected=true;now=request.input.quoteExpiresMs;}
  }
  return baseCrypto.sha256(bytes);
 }};
 const ports={crypto,clock:{nowMs:()=>now},ids:{next:()=>request.idPrefix+'-'+(++sequence)}};
 try{
  let result;
  if(request.method==='quote')result=await createCollectionQuoteService({crypto,repository:createCollectionQuoteRepository(driver,ports)}).issueQuote(request.principal,request.input);
  else{const repository=createProgressionReservationRepository(driver,ports),service=createProgressionReservationService({crypto,repository});
   if(request.method==='forged'){const command=await buildProgressionReservationCommand(request.principal,request.input,crypto);result=await repository.reserve({...command,input:{...command.input,reviewedMaxTotalLamports:'0'}});}
   else result=await service.reserve(request.principal,request.input);
  }
  return {status:200,result,injected,metrics};
 }catch(error){return {status:500,error:injected&&request.fault.startsWith('omit-')?'mandatory-effects-aborted':error.code??error.message,injected,metrics};}
}
