import {canonicalJson,utf8} from '../security/canonical.mjs';
import {decode58} from '../server/base58.mjs';
export const RESERVE_COLLECTION_MINT='collection.reserve-operation.v1';
const id=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
/** Private fixture command only. Repository resolves replay and independently
 * evaluates current published authority; no client-supplied amounts or entropy. */
export async function buildMintReservationCommand(principal,request,crypto){
 const p=structuredClone(principal),r=structuredClone(request),founder=p?.kind==='operator';
 if(founder?!exact(p,['kind','id'])||!id(p.id):!exact(p,['kind','wallet'])||p.kind!=='wallet')throw new TypeError('Mint principal must be a wallet or scoped operator.');
 if(!founder)decode58(p.wallet,32);
 if(!exact(r,founder?['requestKey','inventoryId','stageId','expectedTermsDigest','wallet']:['requestKey','inventoryId','stageId','expectedTermsDigest'])||!id(r.requestKey)||!id(r.inventoryId)||!id(r.stageId)||typeof r.expectedTermsDigest!=='string'||!/^[a-f0-9]{64}$/.test(r.expectedTermsDigest))throw new TypeError('Supply exact mint stage terms and request key.');
 if(founder)decode58(r.wallet,32);
 const input={kind:'mint',inventoryId:r.inventoryId,stageId:r.stageId,expectedTermsDigest:r.expectedTermsDigest,...(founder?{wallet:r.wallet}:{})},operationKind=RESERVE_COLLECTION_MINT,businessIdentity=canonicalJson([p.kind,founder?p.id:p.wallet,r.requestKey]);
 const requestDigest=await crypto.sha256(utf8(canonicalJson([operationKind,p,businessIdentity,r.requestKey,input])));
 return freeze({operationKind,principal:p,businessIdentity,requestKey:r.requestKey,input,requestDigest});
}
export function createMintReservationService({repository,crypto}){
 return Object.freeze({async reserveMint(principal,request){return repository.reserveMint(await buildMintReservationCommand(principal,request,crypto));}});
}
