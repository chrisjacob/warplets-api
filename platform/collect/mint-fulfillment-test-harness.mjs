import {createEvidenceService} from '../evidence/service.mjs';
import {createEvidenceRepository} from '../evidence/repository.mjs';
import {createArtifactReferenceRepository} from '../storage/atomic-artifacts.mjs';
import {mintFulfillmentFixture} from './mint-fulfillment-fixture.mjs';
import {createMintFulfillmentService} from './mint-fulfillment-service.mjs';
import {buildCollectionFulfillmentCommand} from './fulfillment-service.mjs';
import {createMintFulfillmentRepository} from './mint-fulfillment-repository.mjs';
import {sql,measureBatch} from '../storage/atomic-driver.mjs';
export const MINT_FULFILLMENT_TEST_OPERATOR={kind:'operator',id:'synthetic-mint-fulfiller'};
export const mintFulfillmentInput=(receipt,requestKey)=>({requestKey,operationId:receipt.decision.decoded.operationId,evidenceReceiptId:receipt.receiptDigest,evidenceDigest:receipt.envelope.byteDigest});
export async function dispatchMintFulfillment({driver:base,crypto:baseCrypto,store:baseStore,beaconVerifier,request}){
 let injected=false,armed=false,sequence=0,now=request.nowMs;const metrics={statements:0,batches:0,maxBatchBytes:0,maxParameters:0,maxResultBytes:0,objectReads:0};
 const driver={...base,leaseNowSql:String(request.nowMs),async batch(statements){const m=measureBatch(statements);metrics.statements+=m.statements;metrics.batches++;metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,m.batchBytes);metrics.maxParameters=Math.max(metrics.maxParameters,m.maxParameters);let selected=statements;const writes=statements.some(s=>s.sql.startsWith('INSERT INTO app_collection_mint_fulfillments'));
  if(writes&&!injected&&request.fault?.startsWith('omit-')){injected=true;const prefix={'omit-asset':'INSERT INTO collect_assets','omit-vault':'INSERT INTO vault_assets','omit-bind':'INSERT INTO vault_observations','omit-history':'INSERT INTO collect_level_history','omit-authority':'UPDATE app_collection_authorities','omit-fair':'INSERT INTO fair_results','omit-link':'INSERT INTO app_collection_mint_fulfillments','omit-settlement':'UPDATE collect_operations'}[request.fault];selected=statements.filter(s=>!s.sql.startsWith(prefix));}
  if(writes&&!injected&&['wrong-derived-slot','wrong-season-expiry'].includes(request.fault)){injected=true;const corrupt=value=>{if(typeof value==='string'&&/^[\[{]/.test(value)){try{return JSON.stringify(corrupt(JSON.parse(value)));}catch{return value;}}if(Array.isArray(value))return value.map(corrupt);if(value&&typeof value==='object'){const copy=Object.fromEntries(Object.entries(value).map(([k,v])=>[k,corrupt(v)]));if(request.fault==='wrong-derived-slot'){if(copy.kind==='genesis'&&Number.isInteger(copy.ordinal))copy.ordinal+=1;if(copy.kind==='season'&&Number.isInteger(copy.slotIndex))copy.slotIndex+=1;}if(request.fault==='wrong-season-expiry'&&Number.isInteger(copy.expiresAt))copy.expiresAt+=1000;return copy;}return value;};selected=statements.map(s=>({...s,values:s.values.map(corrupt)}));}
  if(writes&&!injected&&request.fault==='advance-in-batch'){injected=true;now+=request.advanceMs;}
  if(writes&&injected&&['advance-in-batch','advance-final-hash'].includes(request.fault))selected=selected.map(s=>({...s,sql:s.sql.replaceAll(String(request.nowMs),String(now))}));
  const result=await base.batch(selected);metrics.maxResultBytes=Math.max(metrics.maxResultBytes,new TextEncoder().encode(JSON.stringify(result)).length);if(writes&&!injected&&request.fault==='lost-response'){injected=true;throw Error('Synthetic lost committed fulfillment response.');}return result;
 }};
 const store={...baseStore,async getVerified(identity){metrics.objectReads++;if(request.fault==='missing-object'){injected=true;return {status:'missing',identity};}const result=await baseStore.getVerified(identity);armed=true;if(request.fault==='corrupt-bytes'&&result.status==='verified'){injected=true;return {...result,bytes:new TextEncoder().encode('{}')};}return result;}};
 const crypto={...baseCrypto,async sha256(bytes){if(armed&&!injected){
  if(request.fault==='advance-final-hash'&&new TextDecoder().decode(bytes).includes('"status":"fulfilled"')){injected=true;now+=request.advanceMs;}
  if(request.fault==='revoke'){injected=true;await base.batch([sql("UPDATE app_operator_scopes SET enabled=0 WHERE operator=? AND scope='collection-evidence'",MINT_FULFILLMENT_TEST_OPERATOR.id)]);}
  if(request.fault==='head-change'){injected=true;await base.batch([sql('DELETE FROM app_evidence_heads WHERE receipt_digest=?',request.input.evidenceReceiptId)]);}
  if(request.fault==='source-change'){injected=true;await base.batch([sql("UPDATE app_revisions SET revision=revision+1 WHERE name='source'")]);}
 }return baseCrypto.sha256(bytes);}};
 const ports={crypto,clock:{nowMs:()=>now},ids:{next:()=>request.idPrefix+'-'+(++sequence)}},principal=request.principal??MINT_FULFILLMENT_TEST_OPERATOR;
 try{let result;if(request.method==='evidence'){
  const fixture=await mintFulfillmentFixture({crypto,event:request.event}),service=createEvidenceService({...ports,store,repository:createEvidenceRepository(driver,ports),artifactRepository:createArtifactReferenceRepository(driver,ports),readers:fixture.readers}),registration=await service.registerSource(principal,fixture.source);
  if(!['committed','replayed'].includes(registration.kind))return {status:200,result:registration,injected,metrics};result=await service.ingest(principal,{...fixture.request,supersedes:request.supersedes??null});
 }else{const repository=createMintFulfillmentRepository(driver,{...ports,artifacts:store,beaconVerifier}),service=createMintFulfillmentService({repository,crypto});if(request.method==='forged'){const c=await buildCollectionFulfillmentCommand(principal,request.input,crypto);result=await repository.fulfillMint({...c,input:{...c.input,evidenceDigest:'0'.repeat(64)}});}else result=await service.fulfillMint(principal,request.input);}
 return {status:200,result,injected,metrics};}catch(error){return {status:500,error:injected&&(request.fault?.startsWith('omit-')||['wrong-derived-slot','wrong-season-expiry'].includes(request.fault))?'mandatory-effects-aborted':error.code??error.message,injected,metrics};}
}
