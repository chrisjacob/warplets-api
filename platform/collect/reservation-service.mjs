import {canonicalJson,utf8} from '../security/canonical.mjs';
import {quotePrincipal,CollectionQuoteInputError} from './quote-service.mjs';
export const RESERVE_COLLECTION_PROGRESSION='collection.reserve-operation.v1';
const id=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const natural=v=>Number.isSafeInteger(v)&&v>=0;
const units=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(v)&&BigInt(v)<(1n<<64n);
const clone=v=>{try{return JSON.parse(canonicalJson(v));}catch{throw new CollectionQuoteInputError('invalid-progression-reservation');}};
const freeze=v=>{if(v&&typeof v==='object'){for(const child of Object.values(v))freeze(child);Object.freeze(v);}return v;};
const demand=(c,code)=>{if(!c)throw new CollectionQuoteInputError(code);};
const fields=['kind','inventoryId','targetId','materialId','expectedTargetVersion','expectedMaterialVersion','quoteId','bindingDigest','policyVersion','reviewedFeeLamports','reviewedMaxTotalLamports','quoteExpiresMs'];
export function normalizeProgressionReservation(value){
 const v=clone(value);demand(v&&Object.keys(v).every(k=>fields.includes(k))&&['upgrade','visual'].includes(v.kind)&&id(v.inventoryId)&&id(v.targetId)&&natural(v.expectedTargetVersion),'invalid-progression-reservation');
 if(v.kind==='upgrade')demand(id(v.materialId)&&v.materialId!==v.targetId&&natural(v.expectedMaterialVersion),'invalid-progression-participants');
 else demand(v.materialId==null&&v.expectedMaterialVersion==null,'unexpected-progression-material');
 demand(id(v.quoteId)&&digest(v.bindingDigest)&&id(v.policyVersion)&&units(v.reviewedFeeLamports)&&units(v.reviewedMaxTotalLamports)&&BigInt(v.reviewedMaxTotalLamports)>=BigInt(v.reviewedFeeLamports)&&natural(v.quoteExpiresMs)&&v.quoteExpiresMs<=8640000000000000,'invalid-reviewed-quote');
 return freeze({...v,materialId:v.materialId??null,expectedMaterialVersion:v.expectedMaterialVersion??null});
}
export const progressionReservationBytes=c=>utf8(canonicalJson([RESERVE_COLLECTION_PROGRESSION,c.principal,c.businessIdentity,c.requestKey,c.input]));
export async function buildProgressionReservationCommand(principal,value,crypto){
 const p=quotePrincipal(principal),v=clone(value);demand(v&&id(v.requestKey),'invalid-reservation-request-key');const {requestKey,...body}=v,input=normalizeProgressionReservation(body);
 const businessIdentity=await crypto.sha256(utf8(canonicalJson([RESERVE_COLLECTION_PROGRESSION,p.wallet,requestKey]))),c={operationKind:RESERVE_COLLECTION_PROGRESSION,principal:p,requestKey,input,businessIdentity};
 return freeze({...c,requestDigest:await crypto.sha256(progressionReservationBytes(c))});
}
export function createProgressionReservationService({repository,crypto}){return Object.freeze({
 async reserve(principal,input){return repository.reserve(await buildProgressionReservationCommand(principal,input,crypto));},
});}
