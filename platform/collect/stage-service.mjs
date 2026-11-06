import {canonicalJson,utf8} from '../security/canonical.mjs';
import {matchesExpectedRevisions} from '../storage/atomic-driver.mjs';
import {normalizeStagePublication} from './stage-plan.mjs';
export const PUBLISH_COLLECTION_STAGE='collection.publish-stage.v1';
const id=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
const freeze=v=>{if(v&&typeof v==='object'){for(const child of Object.values(v))freeze(child);Object.freeze(v);}return v;};
export async function buildStagePublicationCommand(principal,request,crypto){
 const p=structuredClone(principal),r=structuredClone(request);
 if(!p||p.kind!=='operator'||Object.keys(p).length!==2||!id(p.id))throw new TypeError('Stage publication requires a scoped operator.');
 if(!r||typeof r!=='object'||Array.isArray(r)||!([2,3].includes(Object.keys(r).length))||Object.keys(r).some(k=>!['requestKey','input','expectedRevisions'].includes(k))||!id(r.requestKey)||!Object.hasOwn(r,'input'))throw new TypeError('Supply a request key and exact stage input.');
 const reviewed=Object.hasOwn(r,'expectedRevisions');
 if(reviewed){matchesExpectedRevisions(r.expectedRevisions,{});if(Object.keys(r.expectedRevisions).length!==3)throw new TypeError('Supply all reviewed stage revisions.');}
 const input=normalizeStagePublication(r.input),businessIdentity=canonicalJson([input.inventoryId,input.stageId]),operationKind=PUBLISH_COLLECTION_STAGE;
 const requestDigest=await crypto.sha256(utf8(canonicalJson([operationKind,p,businessIdentity,r.requestKey,input])));
 return freeze({operationKind,principal:p,businessIdentity,requestKey:r.requestKey,input,requestDigest,...(reviewed?{expectedRevisions:r.expectedRevisions}:{})});
}
/** No HTTP or economic execution authority. The repository independently
 * validates the named list, policy, current scope and immutable terms. */
export function createStagePublicationService({repository,crypto}){
 return Object.freeze({async publishStage(principal,request){return repository.publishStage(await buildStagePublicationCommand(principal,request,crypto));},
  async previewStage(principal,request){return repository.previewStage(await buildStagePublicationCommand(principal,request,crypto));}});
}
