import {matchesExpectedRevisions} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {captureCollectionCutRecord,prepareCollectionCutRecord} from './free-cut-codec.mjs';
export const STAGE_COLLECTION_CUT_RECORD='collection.stage-cut-record.v1';
export const BEGIN_COLLECTION_FREE_CUT='collection.begin-free-cut.v1';
export const VALIDATE_COLLECTION_CUT_PAGE='collection.validate-cut-page.v1';
export const SEAL_COLLECTION_FREE_CUT='collection.seal-free-cut.v1';
const id=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v),hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
export async function buildCollectionCutCommand(operationKind,principal,request,crypto){
 const p=structuredClone(principal),r=structuredClone(request);
 if(!exact(p,['kind','id'])||p.kind!=='operator'||!id(p.id)||!id(r?.requestKey))throw new TypeError('Collection cuts require a scoped operator and request key.');
 const fields=operationKind===STAGE_COLLECTION_CUT_RECORD?['id']:operationKind===BEGIN_COLLECTION_FREE_CUT?['rootId']:operationKind===VALIDATE_COLLECTION_CUT_PAGE?['attemptId','pageIndex']:operationKind===SEAL_COLLECTION_FREE_CUT?['attemptId']:null;
 const reviewed=Object.hasOwn(r??{},'expectedRevisions');
 if(reviewed){matchesExpectedRevisions(r.expectedRevisions,{});if(Object.keys(r.expectedRevisions).length!==3)throw new TypeError('Supply all reviewed cut revisions.');}
 if(!fields||!exact(r,['requestKey',...fields,...(reviewed?['expectedRevisions']:[])])||!hash(r[fields[0]])||(operationKind===VALIDATE_COLLECTION_CUT_PAGE&&(!Number.isInteger(r.pageIndex)||r.pageIndex<0||r.pageIndex>99)))throw new TypeError('Supply exact bounded collection cut fields.');
 const {requestKey,expectedRevisions,...input}=r,businessIdentity=operationKind===BEGIN_COLLECTION_FREE_CUT?canonicalJson([input.rootId,requestKey]):operationKind===VALIDATE_COLLECTION_CUT_PAGE?canonicalJson([input.attemptId,input.pageIndex]):input[fields[0]];
 const requestDigest=await crypto.sha256(utf8(canonicalJson([operationKind,p,businessIdentity,requestKey,input])));
 return freeze({operationKind,principal:p,businessIdentity,requestKey,input,requestDigest,...(reviewed?{expectedRevisions}:{})});
}
/** Private named commands only. Repository re-verifies retained bytes and all
 * closure/current-source facts; codec output is never an approval capability. */
export function createCollectionCutService({repository,crypto}){
 return Object.freeze({
  async stageRecord(principal,request){
   if(!exact(request,['requestKey','record']))throw new TypeError('Supply a request key and immutable cut record.');
   const record=captureCollectionCutRecord(request.record),p=structuredClone(principal),requestKey=request.requestKey;
   await prepareCollectionCutRecord(record,crypto);
   return repository.stageRecord(await buildCollectionCutCommand(STAGE_COLLECTION_CUT_RECORD,p,{requestKey,id:record.id},crypto),record);
  },
  async beginCut(principal,request){return repository.beginCut(await buildCollectionCutCommand(BEGIN_COLLECTION_FREE_CUT,principal,request,crypto));},
  async validatePage(principal,request){return repository.validatePage(await buildCollectionCutCommand(VALIDATE_COLLECTION_CUT_PAGE,principal,request,crypto));},
  async sealCut(principal,request){return repository.sealCut(await buildCollectionCutCommand(SEAL_COLLECTION_FREE_CUT,principal,request,crypto));},
 });
}
