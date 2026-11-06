import {createEvidenceService} from '../evidence/service.mjs';
import {createEvidenceRepository} from '../evidence/repository.mjs';
import {createArtifactReferenceRepository} from '../storage/atomic-artifacts.mjs';
import {collectionObservationFixture} from '../application/fixtures/collection-observation.mjs';
import {createCollectionObservationService,buildCollectionObservationCommand} from './observation-service.mjs';
import {createCollectionObservationRepository} from './observation-repository.mjs';
import {sql,measureBatch} from '../storage/atomic-driver.mjs';
export const OBSERVATION_TEST_OPERATOR={kind:'operator',id:'synthetic-collection-observer'};
export function observationInput(receipt,{requestKey,expectedAssetVersion}){const {assetId,kind,from,to,observedMs}=receipt.decision.decoded;return {requestKey,assetId,kind,from,to,observedMs,expectedAssetVersion,evidenceReceiptId:receipt.receiptDigest,evidenceDigest:receipt.envelope.byteDigest};}
/** Synthetic private control surface only; no public caller can invoke faults. */
export async function dispatchCollectionObservation({driver:base,crypto:baseCrypto,store:baseStore,request}){
 let injected=false,armed=false,sequence=0;const metrics={statements:0,batches:0,maxBatchBytes:0,maxParameters:0,maxResultBytes:0,objectReads:0};
 const driver={...base,leaseNowSql:String(request.nowMs),async batch(statements){
  const m=measureBatch(statements);metrics.statements+=m.statements;metrics.batches++;metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,m.batchBytes);metrics.maxParameters=Math.max(metrics.maxParameters,m.maxParameters);let selected=statements;
  const writes=statements.some(s=>s.sql.startsWith('INSERT INTO collect_observations'));
  if(writes&&!injected&&request.fault?.startsWith('omit-')){injected=true;const prefix={'omit-asset':'UPDATE collect_assets','omit-vault':'UPDATE vault_assets','omit-vault-observation':'INSERT INTO vault_observations','omit-collect-observation':'INSERT INTO collect_observations','omit-conflict':'INSERT INTO app_collection_operation_conflicts','omit-binding':'INSERT INTO app_collection_observation_bindings'}[request.fault];selected=statements.filter(s=>!s.sql.startsWith(prefix));}
  const result=await base.batch(selected);metrics.maxResultBytes=Math.max(metrics.maxResultBytes,new TextEncoder().encode(JSON.stringify(result)).length);if(writes&&!injected&&request.fault==='lost-response'){injected=true;throw Error('Synthetic lost committed observation response.');}return result;
 }};
 const store={...baseStore,async getVerified(identity){metrics.objectReads++;if(request.fault==='missing-object'){injected=true;return {status:'missing',identity};}const value=await baseStore.getVerified(identity);armed=true;if(request.fault==='corrupt-bytes'&&value.status==='verified'){injected=true;return {...value,bytes:new TextEncoder().encode('{}')};}return value;}};
 const crypto={...baseCrypto,async sha256(bytes){if(armed&&!injected){
  if(request.fault==='revoke'){injected=true;await base.batch([sql("UPDATE app_operator_scopes SET enabled=0 WHERE operator=? AND scope='collection-evidence'",OBSERVATION_TEST_OPERATOR.id)]);}
  if(request.fault==='head-change'){injected=true;await base.batch([sql('DELETE FROM app_evidence_heads WHERE receipt_digest=?',request.input.evidenceReceiptId)]);}
 }return baseCrypto.sha256(bytes);}};
 const ports={crypto,clock:{nowMs:()=>request.nowMs},ids:{next:()=>request.idPrefix+'-'+(++sequence)}},principal=request.principal??OBSERVATION_TEST_OPERATOR;
 try{let result;
  if(request.method==='evidence'){
   const fixture=await collectionObservationFixture({crypto,inventoryId:request.inventoryId,assetId:request.assetId,events:request.events}),service=createEvidenceService({...ports,store,repository:createEvidenceRepository(driver,ports),artifactRepository:createArtifactReferenceRepository(driver,ports),readers:fixture.readers});
   const registration=await service.registerSource(principal,fixture.source);if(!['committed','replayed'].includes(registration.kind))return {status:200,result:registration,injected,metrics};result=await service.ingest(principal,fixture.request(request.recordId,request.supersedes??null));
  }else{
   const repository=createCollectionObservationRepository(driver,{...ports,artifacts:store}),service=createCollectionObservationService({repository,crypto});
   if(request.method==='forged'){const c=await buildCollectionObservationCommand(principal,request.input,crypto);result=await repository.observe({...c,input:{...c.input,expectedAssetVersion:c.input.expectedAssetVersion+1}});}
   else result=await service.observe(principal,request.input);
  }
  return {status:200,result,injected,metrics};
 }catch(error){return {status:500,error:injected&&request.fault?.startsWith('omit-')?'mandatory-effects-aborted':error.code??error.message,injected,metrics};}
}
