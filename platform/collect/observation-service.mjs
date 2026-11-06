import {canonicalJson,utf8} from '../security/canonical.mjs';
import {decode58} from '../server/base58.mjs';
export const OBSERVE_COLLECTION_ASSET='collection.observe-asset.v1';
export class CollectionObservationInputError extends TypeError{constructor(code){super(code);this.code=code;this.status=400;}}
const fail=(c,code)=>{if(!c)throw new CollectionObservationInputError(code);};
const clone=v=>{try{return JSON.parse(canonicalJson(v));}catch{throw new CollectionObservationInputError('invalid-observation-input');}};
const freeze=v=>{if(v&&typeof v==='object'){for(const child of Object.values(v))freeze(child);Object.freeze(v);}return v;};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const fields=['assetId','kind','from','to','observedMs','expectedAssetVersion','evidenceReceiptId','evidenceDigest'];
export function normalizeCollectionObservation(value){
 const i=clone(value);fail(i&&Object.keys(i).length===fields.length&&fields.every(k=>Object.hasOwn(i,k))&&id(i.assetId)&&['transfer','reveal'].includes(i.kind),'invalid-observation-input');
 fail(Number.isSafeInteger(i.observedMs)&&i.observedMs>=0&&i.observedMs<=8640000000000000&&Number.isSafeInteger(i.expectedAssetVersion)&&i.expectedAssetVersion>=0&&digest(i.evidenceReceiptId)&&digest(i.evidenceDigest),'invalid-observation-binding');
 if(i.kind==='transfer'){try{decode58(i.from,32);decode58(i.to,32);}catch{fail(false,'invalid-observation-wallet');}fail(i.from!==i.to&&i.observedMs%1000===0,'invalid-observation-transfer');}
 else fail(i.from===null&&i.to===null,'invalid-observation-reveal');return freeze(i);
}
export const collectionObservationBytes=c=>utf8(canonicalJson([OBSERVE_COLLECTION_ASSET,c.principal,c.businessIdentity,c.requestKey,c.input]));
export async function buildCollectionObservationCommand(principal,value,crypto){
 const p=clone(principal),v=clone(value);fail(p&&Object.keys(p).length===2&&p.kind==='operator'&&id(p.id),'collection-evidence-operator-required');fail(v&&id(v.requestKey),'invalid-observation-request-key');
 const {requestKey,...body}=v,input=normalizeCollectionObservation(body),c={operationKind:OBSERVE_COLLECTION_ASSET,principal:p,requestKey,input,businessIdentity:canonicalJson([input.assetId,input.evidenceReceiptId])};
 return freeze({...c,requestDigest:await crypto.sha256(collectionObservationBytes(c))});
}
export function createCollectionObservationService({repository,crypto}){return Object.freeze({async observe(principal,input){return repository.observe(await buildCollectionObservationCommand(principal,input,crypto));}});}
