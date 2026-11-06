import {canonicalJson,utf8} from '../security/canonical.mjs';
export const FULFILL_COLLECTION_PROGRESSION='collection.fulfill-operation.v1';
export class CollectionFulfillmentInputError extends TypeError{constructor(code){super(code);this.code=code;this.status=400;}}
const fail=(c,code)=>{if(!c)throw new CollectionFulfillmentInputError(code);};
const clone=v=>{try{return JSON.parse(canonicalJson(v));}catch{throw new CollectionFulfillmentInputError('invalid-fulfillment-input');}};
const freeze=v=>{if(v&&typeof v==='object'){for(const child of Object.values(v))freeze(child);Object.freeze(v);}return v;};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export const collectionFulfillmentBytes=c=>utf8(canonicalJson([FULFILL_COLLECTION_PROGRESSION,c.principal,c.businessIdentity,c.requestKey,c.input]));
export async function buildCollectionFulfillmentCommand(principal,value,crypto){
 const p=clone(principal),v=clone(value);fail(p&&Object.keys(p).length===2&&p.kind==='operator'&&id(p.id),'collection-evidence-operator-required');
 fail(v&&Object.keys(v).length===4&&['requestKey','operationId','evidenceReceiptId','evidenceDigest'].every(k=>Object.hasOwn(v,k))&&id(v.requestKey)&&id(v.operationId)&&digest(v.evidenceReceiptId)&&digest(v.evidenceDigest),'invalid-fulfillment-input');
 const {requestKey,...input}=v,c={operationKind:FULFILL_COLLECTION_PROGRESSION,principal:p,requestKey,input,businessIdentity:input.operationId};return freeze({...c,requestDigest:await crypto.sha256(collectionFulfillmentBytes(c))});
}
export function createCollectionFulfillmentService({repository,crypto}){return Object.freeze({async fulfill(principal,input){return repository.fulfill(await buildCollectionFulfillmentCommand(principal,input,crypto));}});}
