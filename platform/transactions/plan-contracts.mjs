import {canonicalJson,utf8} from '../security/canonical.mjs';
import {decode58} from '../server/base58.mjs';
import {requireId,tokenUnits} from '../domain/economics/units.mjs';

export const ACTION_REQUEST_FORMAT='10x.action-request.v1';
export const ACTION_REQUEST_LIMITS=Object.freeze({requestBytes:2048,outputBytes:4096,idCharacters:128});
export const ACTION_KINDS=Object.freeze(['launch','fund','claim','stake','unstake','harvest','swap','collection']);
export class ActionPlanInputError extends TypeError{
 constructor(){super('Invalid bounded action preparation request.');this.code='invalid-action-request';}
}
const check=condition=>{if(!condition)throw new ActionPlanInputError();};
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
// Closed, enumerable data fields only. No toJSON, accessors, prototypes with
// methods or hidden authority fields are copied or invoked before validation.
function object(value,keys){
 check(value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value)));
 const names=Reflect.ownKeys(value);check(names.length===keys.length&&names.every(name=>typeof name==='string'&&keys.includes(name)));
 const copy={};for(const key of keys){const descriptor=Object.getOwnPropertyDescriptor(value,key);check(descriptor&&descriptor.enumerable&&Object.hasOwn(descriptor,'value'));copy[key]=descriptor.value;}return copy;
}
function identifier(value){try{return requireId(value,'action subject');}catch{throw new ActionPlanInputError();}}
function amount(value,positive=false){check(typeof value==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(value));try{const units=tokenUnits(BigInt(value),'action amount');check(!positive||units>0n);}catch{throw new ActionPlanInputError();}return value;}
const digest=value=>{check(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value));return value;};
function parameters(action,input){
 let p;
 if(action==='launch'){p=object(input,['launchId']);identifier(p.launchId);}
 else if(action==='fund'){p=object(input,['campaignId','amountUnits']);identifier(p.campaignId);amount(p.amountUnits,true);}
 else if(action==='stake'||action==='unstake'){p=object(input,['marketId','amountUnits']);identifier(p.marketId);amount(p.amountUnits,true);}
 else if(action==='harvest'){p=object(input,['marketId']);identifier(p.marketId);}
 else if(action==='swap'){p=object(input,['marketId','direction','inputUnits','slippageBps']);identifier(p.marketId);check(['buy-att','sell-att'].includes(p.direction));amount(p.inputUnits,true);check(Number.isInteger(p.slippageBps)&&p.slippageBps>=0&&p.slippageBps<=500);}
 else{
  check(input&&typeof input==='object');const descriptor=Object.getOwnPropertyDescriptor(input,'kind');check(descriptor&&Object.hasOwn(descriptor,'value'));
  if(action==='claim'&&descriptor.value==='earn'){p=object(input,['kind','tokenId','day']);identifier(p.tokenId);check(Number.isInteger(p.day)&&p.day>=1&&p.day<=10);}
  else if(action==='claim'&&descriptor.value==='vault'){p=object(input,['kind','assetId','tokenId']);identifier(p.assetId);identifier(p.tokenId);}
  else if(action==='collection'&&descriptor.value==='mint'){p=object(input,['kind','inventoryId','stageId','expectedTermsDigest']);identifier(p.inventoryId);identifier(p.stageId);digest(p.expectedTermsDigest);}
  else if(action==='collection'&&descriptor.value==='progression'){p=object(input,['kind','operationId']);identifier(p.operationId);}
  else throw new ActionPlanInputError();
 }
 return p;
}
/** Economic choices only, never supplied recipients, account lists or wire data. */
export function normalizeActionRequest(value){
 const input=object(value,['format','action','parameters','maximumFeeUnits']);check(input.format===ACTION_REQUEST_FORMAT&&ACTION_KINDS.includes(input.action));
 const request={format:ACTION_REQUEST_FORMAT,action:input.action,parameters:parameters(input.action,input.parameters),maximumFeeUnits:amount(input.maximumFeeUnits)};
 check(utf8(canonicalJson(request)).length<=ACTION_REQUEST_LIMITS.requestBytes);return freeze(request);
}
function principal(value){const p=object(value,['kind','wallet']);check(p.kind==='wallet'&&typeof p.wallet==='string'&&p.wallet.length>=32&&p.wallet.length<=44);try{decode58(p.wallet,32);}catch{throw new ActionPlanInputError();}return freeze(p);}
function economicParameters(request){
 const value={...request.parameters};
 // Slippage/fee ceilings and the reviewed stage commitment are preparation
 // protections, not a second economic intention when refreshed. Actual amount,
 // direction and selected immutable subjects remain part of that intention.
 if(request.action==='swap')delete value.slippageBps;
 if(request.action==='collection'&&value.kind==='mint')delete value.expectedTermsDigest;
 return value;
}
/** No clock, request key or source observation is accepted here. Those belong to
 * a later guarded preparation; this helper cannot create or approve an intent. */
export async function bindActionRequest(value,crypto){
 const input=object(value,['principal','request']),owner=principal(input.principal),request=normalizeActionRequest(input.request);
 const economicBytes=utf8(canonicalJson(['10x.action-economic-intent.v1',owner.wallet,request.action,economicParameters(request)]));
 const requestBytes=utf8(canonicalJson([ACTION_REQUEST_FORMAT,owner.wallet,request]));
 const economicIntentDigest=digest(await crypto.sha256(economicBytes)),requestDigest=digest(await crypto.sha256(requestBytes));
 return freeze({format:'10x.bound-action-request.v1',principal:owner,request,economicIntentDigest,requestDigest,financialExecution:false});
}

const common=Object.freeze(['registered-program-identity','typed-program-codec','recorded-unsigned-message','recorded-simulation','recorded-blockhash-lifetime','verified-funding-and-fees']);
const requirements=freeze({
 launch:['registered-launch-source','original-supply-and-activation','complete-genesis-backing','activation-season-snapshot','launch-pool-and-fee-policy','reward-custody'],
 fund:['registered-campaign','campaign-funding-plan','funding-destination-and-custody'],
 'claim:earn':['original-earn-allocation','original-vesting-and-cumulative-claims','claim-custody'],
 'claim:vault':['original-vault-manifest','original-slot-and-current-owner','original-vesting-and-cumulative-claims','claim-custody'],
 stake:['registered-farm-policy','farm-deposit-permission','owner-stake-position'],
 unstake:['registered-farm-policy','principal-withdrawal-permission','owner-stake-position'],
 harvest:['registered-farm-policy','farm-harvest-permission','owner-stake-position','cumulative-harvest-state'],
 swap:['verified-quote-source','current-quote-and-account-state','swap-account-derivation','captured-program-parity'],
 'collection:mint':['published-stage-terms','current-stage-eligibility','collection-reservation-evidence','collection-program-policy'],
 'collection:progression':['stored-progression-operation','current-participant-ownership-and-versions','retained-progression-outcome','collection-program-policy']
});
export const ACTION_EVIDENCE_REQUIREMENTS=Object.freeze([...new Set([...Object.values(requirements).flat(),...common])]);
/** Required categories are not assertions that records are missing from a DB.
 * Only future named source adapters may evaluate those independent facts. */
export function actionRequirements(value){const request=normalizeActionRequest(value),key=['claim','collection'].includes(request.action)?request.action+':'+request.parameters.kind:request.action;return Object.freeze([...requirements[key],...common]);}
export function unsupportedActionPlan(value){
 const request=normalizeActionRequest(value),result={kind:'unsupported',reason:'unsupported-factory',action:request.action,requiredEvidence:actionRequirements(request),evidenceStatus:'not-evaluated',wire:null,executable:false,financialExecution:false,serverSigning:false,broadcast:false};
 check(utf8(canonicalJson(result)).length<=ACTION_REQUEST_LIMITS.outputBytes);return freeze(result);
}
