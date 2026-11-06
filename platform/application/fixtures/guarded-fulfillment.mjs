// Local synthetic test composition, deliberately unavailable to public routes.
import {randomUUID} from 'node:crypto';
import {createNodeAtomicDriver} from '../../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../../security/node-crypto.mjs';
import {canonicalJson} from '../../security/canonical.mjs';
import {createEvidenceService} from '../../evidence/service.mjs';
import {createEvidenceRepository} from '../../evidence/repository.mjs';
import {createArtifactReferenceRepository} from '../../storage/atomic-artifacts.mjs';
import {createCollectionFulfillmentService} from '../../collect/fulfillment-service.mjs';
import {createCollectionFulfillmentRepository} from '../../collect/fulfillment-repository.mjs';
import {collectionFulfillmentFixture} from './collection-fulfillment.mjs';
import {memoryArtifacts} from './memory-artifacts.mjs';
export function createGuardedFulfillmentFixture(db,{artifacts=memoryArtifacts()}={}){
 const crypto=createNodeCrypto(),principal={kind:'operator',id:'synthetic-collection-fulfiller'},saved=new Map();
 for(const scope of ['evidence-ingest','collection-evidence'])db.prepare('INSERT OR IGNORE INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,scope);
 return async(operationId,{atMs,proofId='synthetic-progression-'+operationId,ticket=0,traits=null},nowMs=atMs)=>{
  const op=db.prepare('SELECT * FROM collect_operations WHERE id=?').get(operationId);if(!op||!['upgrade','visual'].includes(op.kind))throw Error('Unknown synthetic progression operation.');
  const event={inventoryId:op.inventory_id,operationId,kind:op.kind,commitment:op.commitment,provenance:'manual-fixture',atMs,proof:{proofId,ticket:op.kind==='upgrade'?ticket:null,traits:op.kind==='visual'?traits:null}},eventJson=canonicalJson(event),driver={...createNodeAtomicDriver(db),leaseNowSql:String(nowMs)},ports={crypto,clock:{nowMs:()=>nowMs},ids:{next:randomUUID}},service=createCollectionFulfillmentService({crypto,repository:createCollectionFulfillmentRepository(driver,{...ports,artifacts})});
  let input=saved.get(eventJson);if(!input){
   const fixture=await collectionFulfillmentFixture({crypto,event}),evidence=createEvidenceService({...ports,store:artifacts,repository:createEvidenceRepository(driver,ports),artifactRepository:createArtifactReferenceRepository(driver,ports),readers:fixture.readers}),registered=await evidence.registerSource(principal,fixture.source);if(!['committed','replayed'].includes(registered.kind))throw Error('Synthetic source unavailable: '+JSON.stringify(registered));
   const old=db.prepare('SELECT receipt_digest FROM app_evidence_heads WHERE stream_key=?').get(canonicalJson([fixture.source.sourceId,'collection-operation',operationId,null])),recorded=await evidence.ingest(principal,{...fixture.request,supersedes:old?.receipt_digest??null});if(!['committed','replayed'].includes(recorded.kind)||recorded.value.decision.status!=='verified')throw Error('Synthetic evidence unavailable: '+JSON.stringify(recorded));
   input={requestKey:'synthetic-fulfillment:'+operationId,operationId,evidenceReceiptId:recorded.value.receiptDigest,evidenceDigest:recorded.value.envelope.byteDigest};saved.set(eventJson,input);
  }
  const result=await service.fulfill(principal,input);if(!['committed','replayed'].includes(result.kind))throw Error('Synthetic fulfillment unavailable: '+JSON.stringify(result));return {...result.value,replayed:result.kind==='replayed'};
 };
}
