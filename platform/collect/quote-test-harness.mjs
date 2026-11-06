import {createCollectionQuoteRepository} from './quote-repository.mjs';
import {createCollectionQuoteService,buildCollectionQuoteCommand} from './quote-service.mjs';
import {sql,measureBatch} from '../storage/atomic-driver.mjs';

/** Synthetic local acceptance only; this transport is never mounted publicly. */
export async function dispatchCollectionQuote({driver:base,crypto:baseCrypto,request}){
 let now=request.nowMs,sequence=0,injected=false;
 if(!Number.isSafeInteger(now)||now<0)throw new TypeError('Invalid synthetic clock.');
 const metrics={statements:0,batches:0,maxBatchBytes:0,maxParameters:0};
 const driver={...base,...(request.productionClock?{}:{leaseNowSql:String(now)}),async batch(statements){
  const size=measureBatch(statements);metrics.statements+=size.statements;metrics.batches++;metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,size.batchBytes);metrics.maxParameters=Math.max(metrics.maxParameters,size.maxParameters);
  const writes=statements.some(s=>s.sql.startsWith('INSERT INTO app_command_receipts'));let selected=statements;
  if(writes&&!injected&&request.fault==='omit-child'){injected=true;selected=statements.filter(s=>!s.sql.startsWith('INSERT INTO app_collection_quotes'));}
  if(writes&&!injected&&request.fault==='expire-in-batch'){
   injected=true;now+=120000;selected=statements.map(s=>({...s,sql:s.sql.replaceAll(String(request.nowMs)+'>=?',String(now)+'>=?').replaceAll(String(request.nowMs)+'<?',String(now)+'<?')}));
  }
  const result=await base.batch(selected);
  if(writes&&!injected&&request.fault==='lost-response'){injected=true;throw Error('Synthetic lost committed response.');}
  return result;
 }};
 const crypto={...baseCrypto,async sha256(bytes){
  const decoded=new TextDecoder().decode(bytes);
  if(!injected&&decoded.includes('"format":"collection-progression-quote-v1"')){
   if(request.fault==='source-change'){injected=true;await base.batch([sql('UPDATE collect_inventories SET revision=revision+1 WHERE id=?',request.input.inventoryId)]);}
   if(request.fault==='control-change'){injected=true;await base.batch([sql("UPDATE app_revisions SET revision=revision+1 WHERE name='control'")]);}
   if(request.fault==='owner-change'){injected=true;await base.batch([sql('UPDATE collect_assets SET owner=? WHERE id=?',request.other,request.input.targetId)]);}
   if(request.fault==='expire-during-hash'){injected=true;now+=120000;}
  }
  return baseCrypto.sha256(bytes);
 }};
 const ids={next:()=>request.idPrefix+'-'+(++sequence)},repository=createCollectionQuoteRepository(driver,{crypto,ids,clock:{nowMs:()=>now}}),service=createCollectionQuoteService({repository,crypto});
 try{
  let result;
  if(request.method==='read')result=await service.readQuote(request.principal,request.id);
  else if(request.method==='forged'){
   const command=await buildCollectionQuoteCommand(request.principal,request.input,crypto);
   result=await repository.issueQuote({...command,input:{...command.input,maxTotalLamports:'0'}});
  }else result=await service.issueQuote(request.principal,request.input);
  return {status:200,result,injected,metrics};
 }catch(error){return {status:500,error:request.fault==='omit-child'&&injected?'mandatory-child-aborted':error.code??error.message,injected,metrics};}
}
