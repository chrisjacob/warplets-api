import {createCollectionSourceRepository} from './source-repository.mjs';
import {createCollectionSourceIntake,collectionIntakeCommandBytes,SEAL_COLLECTION_LIST,prepareCollectionList} from './source-intake.mjs';
import {sql,measureBatch} from '../storage/atomic-driver.mjs';
export const COLLECTION_TEST_OPERATOR={kind:'operator',id:'synthetic-collection-importer'};
/** Internal synthetic fixture transport. It is never mounted by the product. */
export async function collectionSourceTestDispatch({driver:base,crypto,ids,request}){
 let injected=false;const metrics={statements:0,maxBatchBytes:0,maxParameters:0,maxSqlBytes:0,batches:0};
 const driver={...base,async batch(statements){
  const size=measureBatch(statements);metrics.statements+=size.statements;metrics.batches++;for(const key of ['maxParameters','maxSqlBytes'])metrics[key]=Math.max(metrics[key],size[key]);metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,size.batchBytes);
  const writes=statements.some(s=>s.sql.startsWith('INSERT INTO app_command_receipts'));
  if(writes&&!injected&&request.fault==='revoke'){injected=true;await base.batch([sql("UPDATE app_operator_scopes SET enabled=0 WHERE operator=? AND scope='collection-import'",COLLECTION_TEST_OPERATOR.id)]);}
  let selected=statements;
  if(writes&&!injected&&request.fault==='omit-child'){injected=true;selected=statements.filter(s=>!s.sql.startsWith('INSERT INTO app_collection_'));}
  const result=await base.batch(selected);
  if(writes&&!injected&&request.fault==='lost-response'){injected=true;throw Error('Synthetic response lost after commit.');}
  return result;
 }};
 const repository=createCollectionSourceRepository(driver,{crypto,ids}),service=createCollectionSourceIntake({repository,crypto,clock:{nowMs:()=>request.nowMs??180000001}});
 try{
  let result;
  if(request.method==='stage')result=await service.stageRecord(COLLECTION_TEST_OPERATOR,{record:{...request.record,bytes:new Uint8Array(request.record.bytes)},requestKey:request.key,expectedRevisions:request.expectedRevisions});
  else if(request.method==='seal-list')result=await service.sealList(COLLECTION_TEST_OPERATOR,{id:request.id,requestKey:request.key});
  else if(request.method==='seal-source')result=await service.sealSource(COLLECTION_TEST_OPERATOR,{id:request.id,requestKey:request.key});
  else if(request.method==='forged-list'){
   const [manifest]=await repository.readRecords([request.id]),body=JSON.parse(new TextDecoder().decode(manifest.bytes));
   const seal=await prepareCollectionList({manifest,pages:await repository.readRecords(body.pageIds)},crypto);
   const command={operationKind:SEAL_COLLECTION_LIST,principal:COLLECTION_TEST_OPERATOR,businessIdentity:request.id,input:{id:request.id},requestKey:request.key,expectedRevisions:{},nowMs:180000001};
   command.requestDigest=await crypto.sha256(collectionIntakeCommandBytes(command));result=await repository.sealList(command,{...seal,count:seal.count+1});
  }else throw Error('Unknown source test method.');
  return {status:200,result,metrics,injected};
 }catch(error){return {status:500,error:error.message,metrics,injected};}
}
