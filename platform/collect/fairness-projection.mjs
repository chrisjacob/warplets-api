import {canonicalJson,utf8} from '../security/canonical.mjs';
import {drawRequestPreimage,roundTime} from '../randomness/request-plan.mjs';
import {beaconSeedPreimage,beaconProofPreimage,validateTraitChoices,traitFields,pickTrait} from '../randomness/draw-protocol.mjs';
import {uniformDraw,materializeProgressionDraw} from '../randomness/portable-draw.mjs';
import {verifyPinnedBeacon} from '../beacon/portable.mjs';
import {LEVEL_QUOTAS,drawLevel} from '../domain/collections/policy.mjs';
export const FAIRNESS_PROJECTION_FORMAT='10x.local.fairness.v1';
export const FAIRNESS_PROJECTION_LIMITS=Object.freeze({inputBytes:262144,transcriptBytes:262144});
const need=(v,message)=>{if(!v)throw new TypeError('Fairness projection: '+message);};
const id=v=>typeof v==='string'&&v.length>0&&v.length<=128,digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),time=v=>Number.isSafeInteger(v)&&v>=0&&v<=8640000000000000;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
function capture(value){let count=0,bytes=0;const seen=new Set(),add=s=>{bytes+=utf8(s).length;need(bytes<=262144,'input bound');};function copy(v,depth=0){need(depth<=24&&++count<=8192,'structure bound');if(v===null||typeof v==='string'||typeof v==='boolean'||Number.isSafeInteger(v)){add(JSON.stringify(v));return v;}need(v&&typeof v==='object'&&!seen.has(v),'plain data');const array=Array.isArray(v);need(array?Object.getPrototypeOf(v)===Array.prototype:[Object.prototype,null].includes(Object.getPrototypeOf(v)),'plain data');seen.add(v);add('[]');const keys=Reflect.ownKeys(v).filter(k=>!(array&&k==='length'));need(!array||keys.length===v.length&&keys.every((k,i)=>k===String(i)),'dense array');const o=array?[]:{};for(const key of keys){const d=Object.getOwnPropertyDescriptor(v,key);need(typeof key==='string'&&d?.enumerable&&Object.hasOwn(d,'value'),'data fields');add(JSON.stringify(key)+':,');Object.defineProperty(o,key,{value:copy(d.value,depth+1),enumerable:true});}seen.delete(v);return o;}return copy(value);}
/** Only a trusted repository may establish retained assignment, immutable source
 * linkage and reveal/prefix coverage. These booleans are NOT request authority.
 * No HTTP adapter is provided. Oversized policies need a future bounded public
 * policy-reference adapter; they are never truncated or published here. */
export async function projectCollectionFairness(value,{crypto,beaconVerifier}){
 const f=capture(value);need(exact(f,['operation','policy','request','result','assignment','disclosure','remainingQuotas','waiting']),'facts shape');const op=f.operation;
 need(exact(op,['id','kind','inventoryId','owner','rawCommitment','createdMs','settledMs','proofId'])&&['mint','upgrade','visual'].includes(op.kind)&&['id','inventoryId','owner','rawCommitment'].every(k=>id(op[k]))&&time(op.createdMs)&&(op.settledMs===null||time(op.settledMs)&&op.settledMs>=op.createdMs)&&(op.proofId===null||id(op.proofId)),'operation');
 need(exact(f.disclosure,['selectedRevealed','participantsRevealed','mintPrefixRevealed'])&&Object.values(f.disclosure).every(v=>typeof v==='boolean')&&['prior-admission','entropy','fulfillment','conflict'].includes(f.waiting),'disclosure facts');
 need(f.assignment===null||exact(f.assignment,['irreversible','assetId','level'])&&typeof f.assignment.irreversible==='boolean'&&id(f.assignment.assetId)&&(f.assignment.level===null||Number.isInteger(f.assignment.level)&&f.assignment.level>=1&&f.assignment.level<=10),'assignment');
 need((f.policy===null&&f.request===null)||(exact(f.policy,['policyHash','registeredMs','traitChoices'])&&digest(f.policy.policyHash)&&time(f.policy.registeredMs)&&exact(f.request,['targetRound','contextDigest'])&&Number.isSafeInteger(f.request.targetRound)&&f.request.targetRound>0&&digest(f.request.contextDigest)),'configured request');
 const hash=async v=>{const d=await crypto.sha256(utf8(canonicalJson(v)));need(digest(d),'hash result');return d;};
 const commitment=await hash(['10x.collection-fairness-public-v1',op.inventoryId,op.id,op.rawCommitment,f.request?.contextDigest??null]);
 const assigned=op.settledMs!==null&&f.assignment?.irreversible===true;
 const base={format:FAIRNESS_PROJECTION_FORMAT,source:'local-fixture',providerStatus:'candidate-unselected',requiresVerifiedRepository:true,requestState:f.waiting==='conflict'?'held':assigned?'assigned':'waiting',evidenceState:f.waiting==='conflict'?'conflicted':f.policy===null?'manual-fixture':f.result?'retained-unverified':'waiting-'+f.waiting,financialState:'not-applicable-local',commitment,disclosure:'sealed',transcript:null,financialExecution:false,serverSigning:false,broadcast:false};
 if(!assigned||!f.disclosure.selectedRevealed||!(op.kind==='mint'?f.disclosure.mintPrefixRevealed:f.disclosure.participantsRevealed)||!f.result||!f.policy||f.waiting==='conflict'||typeof beaconVerifier?.verifyShortSignature!=='function')return freeze(base);
 // No outcome-bearing input is copied into public output until every gate passes.
 try{
  const r=f.result;need(exact(r,['proofId','proof','fixture'])&&id(r.proofId)&&r.proofId===op.proofId,'retained result');
  const derived=drawRequestPreimage({policy_hash:f.policy.policyHash,registered_ms:f.policy.registeredMs},{opId:op.id,kind:op.kind,inventoryId:op.inventoryId,owner:op.owner,commitment:op.rawCommitment,now:op.createdMs});need(derived.targetRound===f.request.targetRound&&await hash(derived.preimage)===f.request.contextDigest&&op.settledMs>=roundTime(f.request.targetRound),'request binding');
  const randomness=await verifyPinnedBeacon(r.proof,f.request.targetRound,crypto,beaconVerifier);let fixture,choices=null,remaining=null,level=null;
  if(op.kind==='mint'){
   if(f.policy.traitChoices===null||f.remainingQuotas===null)return freeze(base);
   choices=validateTraitChoices(f.policy.traitChoices);remaining=f.remainingQuotas;need(Array.isArray(remaining)&&remaining.length===10&&remaining.every((n,i)=>Number.isInteger(n)&&n>=0&&n<=LEVEL_QUOTAS[i])&&remaining.reduce((a,b)=>a+b,0)>0,'remaining quota replay');
   const seed=await hash(beaconSeedPreimage(f.request.contextDigest,randomness)),traits={};for(const key of traitFields)traits[key]=pickTrait(choices[key],await uniformDraw(seed,key,choices[key].reduce((n,c)=>n+c.weight,0),crypto));
   const ticket=await uniformDraw(seed,'initial-level',remaining.reduce((a,b)=>a+b,0),crypto);level=drawLevel(remaining,ticket);need(f.assignment.level===level,'selected level');
   fixture={operationId:op.id,commitment:op.rawCommitment,proofId:await hash(beaconProofPreimage(f.request.targetRound,seed)),at:roundTime(f.request.targetRound),finalized:true,traits,ticket,assetId:f.assignment.assetId};
  }else{
   if(op.kind==='visual'&&f.policy.traitChoices===null)return freeze(base);if(op.kind==='visual')choices=validateTraitChoices(f.policy.traitChoices);
   fixture=await materializeProgressionDraw({operation:{id:op.id,kind:op.kind,commitment:op.rawCommitment},request:{target_round:f.request.targetRound,context_digest:f.request.contextDigest},randomness,traitChoices:choices},crypto);
  }
  need(canonicalJson(r.fixture)===canonicalJson(fixture)&&fixture.proofId===r.proofId,'same retained draw');
  const transcript={format:'10x.recorded-draw-transcript.v1',verificationScope:'recorded-beacon-draw-only',requestPreimage:derived.preimage,contextDigest:f.request.contextDigest,policyHash:f.policy.policyHash,publicTraitChoices:choices,proof:{chain:r.proof.chain,round:r.proof.round,signature:r.proof.signature,randomness:r.proof.randomness},fixture,selectedAssignment:{assetId:f.assignment.assetId,level},remainingQuotas:remaining,reservedAssetMapping:'withheld',policyClosure:'requires-trusted-retained-policy',productionOrderAndCustody:'unverified'};
  if(utf8(canonicalJson(transcript)).length>262144)return freeze(base);return freeze({...base,evidenceState:'verified',disclosure:'revealed',transcript:{...transcript,digest:await hash(transcript)}});
 }catch{return freeze({...base,requestState:'held',evidenceState:'conflicted'});}
}
