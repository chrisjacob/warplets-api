import {canonicalJson,utf8} from '../security/canonical.mjs';
import {decode58} from '../server/base58.mjs';
import {decodePoolAccount} from '../quotes/accounts.mjs';
import {QUOTE_PROGRAM,QuoteError,quoteAmounts} from '../quotes/math.mjs';

export const QUOTE_COMPARISON_FORMAT='10x.local.quote-comparison.v1';
const kind=value=>['synthetic-sdk','captured-program'].includes(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const text=value=>typeof value==='string'&&value.length>0&&value.length<=256&&value.trim()===value;
const time=value=>Number.isSafeInteger(value)&&value>=0;
const decimal=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(value);
const demand=(ok,message)=>{if(!ok)throw new TypeError('Quote comparison: '+message);};
const exact=(value,keys,label)=>demand(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k)),label+' fields');
const copy=value=>JSON.parse(canonicalJson(value));
const frozen=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))frozen(child);Object.freeze(value);}return value;};
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const keys=['attMint','ogMint','attVault','ogVault'];
function address(value){demand(typeof value==='string','account address');try{decode58(value,32);}catch{throw new TypeError('Quote comparison: canonical account address');}}
function context(value){
 demand(kind(value.evidenceKind),'evidence kind');
 exact(value.program,['address','binaryDigest','decoderVersion'],'program');address(value.program.address);
 demand(text(value.program.decoderVersion),'decoder version');
 demand(value.evidenceKind==='synthetic-sdk'?value.program.binaryDigest===null:digest(value.program.binaryDigest),'independent program binary digest required for captured comparisons');
 exact(value.identities,keys,'identities');for(const k of keys)address(value.identities[k]);
 demand(value.identities.attMint!==value.identities.ogMint,'distinct ATT and OG mints');
 demand(time(value.activationMs)&&time(value.currentPointMs),'activation/current-point clocks');
 demand(['buy-att','sell-att'].includes(value.direction),'direction');
 demand(decimal(value.inputUnits),'input base units');
 demand(Number.isInteger(value.slippageBps)&&value.slippageBps>=0&&value.slippageBps<=500,'slippage');
}
function record(value){
 exact(value,['format','id','evidenceKind','source','program','rawPool','identities','activationMs','currentPointMs','direction','inputUnits','slippageBps','observed'],'record');
 demand(value.format===QUOTE_COMPARISON_FORMAT&&text(value.id),'format or id');context(value);
 exact(value.source,['fileDigest','sourceCommit','recordingId','label'],'source');
 demand(digest(value.source.fileDigest)&&/^[a-f0-9]{40}$/.test(value.source.sourceCommit)&&text(value.source.recordingId)&&text(value.source.label),'source provenance');
 exact(value.rawPool,['address','owner','data','byteDigest'],'raw pool');address(value.rawPool.address);address(value.rawPool.owner);
 demand(digest(value.rawPool.byteDigest)&&typeof value.rawPool.data==='string'&&value.rawPool.data.length<=2048,'raw pool encoding');
 if(value.observed?.kind==='rejected'){
  exact(value.observed,['kind','errorCode'],'observed rejection');
  demand(value.evidenceKind==='synthetic-sdk'&&typeof value.observed.errorCode==='string'&&/^[a-z][a-z0-9_]{0,63}$/.test(value.observed.errorCode),'explicit synthetic error code required');
 }else{
  exact(value.observed,['kind','outputUnits','grossOutputUnits','inputFeeUnits','outputFeeUnits','totalFeeUnits','nextSqrtPriceX64'],'observed amounts');
  demand(value.observed.kind==='amounts'&&['outputUnits','grossOutputUnits','inputFeeUnits','outputFeeUnits','totalFeeUnits','nextSqrtPriceX64'].every(k=>decimal(value.observed[k])),'observed amounts');
 }
 demand(utf8(canonicalJson(value)).length<=8192,'record exceeds 8 KiB');return value;
}
function expected(value){
 exact(value,['evidenceKind','sourceFileDigest','sourceCommit','recordingId','recordDigest','program','rawPool','identities','activationMs','currentPointMs','direction','inputUnits','slippageBps'],'expected requirement');context(value);
 demand(digest(value.sourceFileDigest)&&digest(value.recordDigest)&&/^[a-f0-9]{40}$/.test(value.sourceCommit)&&text(value.recordingId),'independent source/record pins');
 exact(value.rawPool,['address','byteDigest'],'expected raw pool');address(value.rawPool.address);demand(digest(value.rawPool.byteDigest),'independent pre-state pin');return value;
}
function poolBytes(data){
 try{const raw=atob(data);if(btoa(raw)!==data||raw.length!==1112)return null;return Uint8Array.from(raw,c=>c.charCodeAt(0));}catch{return null;}
}

/** Offline, raw-POOL-only arithmetic comparison. Expected pins are supplied by
 * the operator's independently retained evidence inventory, never inferred from
 * the record being compared. A matched record grants no execution authority. */
export function createQuoteComparison({crypto}){
 async function compareCopied(r,e){
  const recordDigest=await crypto.sha256(utf8(canonicalJson(r)));
  const base={recordId:r.id,evidenceKind:r.evidenceKind,scope:r.evidenceKind==='synthetic-sdk'?'synthetic-arithmetic':'recorded-program-comparison',coverage:'raw-pool-only',
   hashes:{recordDigest,sourceFileDigest:r.source.fileDigest,poolByteDigest:r.rawPool.byteDigest,programBinaryDigest:r.program.binaryDigest},executable:false,financialExecution:false};
  const result=(status,reason,extra={})=>frozen({...base,status,reason,...extra});
  const bindings=[['evidence-kind',r.evidenceKind,e.evidenceKind],['source-file',r.source.fileDigest,e.sourceFileDigest],['source-commit',r.source.sourceCommit,e.sourceCommit],
   ['recording',r.source.recordingId,e.recordingId],['program',r.program,e.program],['pool-address',r.rawPool.address,e.rawPool.address],['pre-state',r.rawPool.byteDigest,e.rawPool.byteDigest],
   ['identities',r.identities,e.identities],['activation',r.activationMs,e.activationMs],['current-point',r.currentPointMs,e.currentPointMs],['direction',r.direction,e.direction],['input',r.inputUnits,e.inputUnits],['slippage',r.slippageBps,e.slippageBps]];
  for(const [field,actual,wanted] of bindings)if(!same(actual,wanted))return result('incompatible',field+'-mismatch');
  if(recordDigest!==e.recordDigest)return result('incompatible','record-pin-mismatch');
  if(r.program.address!==QUOTE_PROGRAM||r.rawPool.owner!==r.program.address)return result('incompatible','unsupported-program');
  if(r.program.decoderVersion!=='damm-pool-v1')return result('incompatible','unsupported-decoder');
  const bytes=poolBytes(r.rawPool.data);if(!bytes)return result('incompatible','raw-pool-encoding');
  if(await crypto.sha256(bytes)!==r.rawPool.byteDigest)return result('incompatible','raw-pool-digest-mismatch');
  let pool;try{pool=decodePoolAccount(r.rawPool);}catch(error){if(error instanceof QuoteError)return result('incompatible','pool-'+error.code);throw error;}
  if(keys.some(k=>pool[k]!==r.identities[k]))return result('incompatible','decoded-identities-mismatch');
  if(pool.activationMs!==r.activationMs)return result('incompatible','decoded-activation-mismatch');
  let actual;
  try{actual=quoteAmounts({direction:r.direction,inputUnits:r.inputUnits,slippageBps:r.slippageBps,pool,nowMs:r.currentPointMs});}
  catch(error){
   if(!(error instanceof QuoteError))throw error;
   return r.observed.kind==='rejected'&&r.observed.errorCode===error.code?result('matched','expected-rejection',{expectedErrorCode:r.observed.errorCode,actualErrorCode:error.code}):
    result('failed','unexpected-rejection',{expectedErrorCode:r.observed.kind==='rejected'?r.observed.errorCode:null,actualErrorCode:error.code});
  }
  if(r.observed.kind==='rejected')return result('failed','expected-rejection-not-returned',{expectedErrorCode:r.observed.errorCode,actualErrorCode:null});
  const observed=r.observed;
  if(BigInt(observed.inputFeeUnits)+BigInt(observed.outputFeeUnits)!==BigInt(observed.totalFeeUnits)||BigInt(observed.outputUnits)+BigInt(observed.outputFeeUnits)!==BigInt(observed.grossOutputUnits))return result('failed','observed-deltas-inconsistent');
  const compared={outputUnits:actual.expectedOutputUnits,grossOutputUnits:actual.grossOutputUnits,inputFeeUnits:actual.inputFeeUnits,outputFeeUnits:actual.outputFeeUnits,
   totalFeeUnits:String(BigInt(actual.inputFeeUnits)+BigInt(actual.outputFeeUnits)),nextSqrtPriceX64:actual.nextSqrtPriceX64};
  const differences=Object.keys(compared).filter(k=>compared[k]!==observed[k]);
  return differences.length?result('failed','observed-delta-mismatch',{differences,actual:compared}):result('matched','exact-observed-deltas',{actual:compared});
 }
 return Object.freeze({
  async compare(value,requirement){const r=record(copy(value)),e=expected(copy(requirement));return compareCopied(r,e);},
  async matrix(input){
   // Capture the complete matrix before any digest await. An async caller cannot
   // replace an expected pin, record or missing requirement while verification runs.
   input=copy(input);exact(input,['records','requirements'],'matrix');
   demand(Array.isArray(input.records)&&input.records.length<=128&&Array.isArray(input.requirements)&&input.requirements.length<=128,'matrix row bound');
   const records=new Map();for(const value of input.records){record(value);demand(!records.has(value.id),'duplicate record');records.set(value.id,value);}
   const ids=new Set();for(const q of input.requirements){
    exact(q,['id','expected','recordIds','missingReason'],'matrix requirement');demand(text(q.id)&&!ids.has(q.id),'unique requirement id');ids.add(q.id);
    demand(Array.isArray(q.recordIds)&&q.recordIds.length<=8&&q.recordIds.every(text)&&new Set(q.recordIds).size===q.recordIds.length,'candidate record IDs');
    if(q.expected===null)demand(q.recordIds.length===0&&text(q.missingReason),'missing requirement needs explicit reason and no invented context');
    else{expected(q.expected);demand(q.missingReason===null,'specified context must not have a missing reason');}
   }
   const items=[];
   for(const q of input.requirements){
    const comparisons=[];for(const id of q.recordIds){const r=records.get(id);if(r)comparisons.push(await compareCopied(r,q.expected));}
    const applicable=comparisons.filter(c=>c.status!=='incompatible'),missingIds=q.recordIds.filter(id=>!records.has(id));
    const status=applicable.some(c=>c.status==='failed')?'failed':missingIds.length||!applicable.length?'missing':'matched';
    items.push({id:q.id,status,reason:q.missingReason??(status==='failed'?'applicable-record-failed':missingIds.length?'candidate-record-unavailable':!applicable.length?'no-compatible-record':'all-applicable-records-matched'),missingRecordIds:missingIds,comparisons});
   }
   return frozen({format:QUOTE_COMPARISON_FORMAT,items,counts:Object.fromEntries(['matched','missing','failed'].map(s=>[s,items.filter(i=>i.status===s).length])),executable:false,financialExecution:false});
  },
 });
}
