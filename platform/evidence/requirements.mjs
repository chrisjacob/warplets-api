import {canonicalJson,utf8} from '../security/canonical.mjs';
import {clone,digest,text,time,requireEvidence} from './envelope.mjs';

export const REQUIREMENT_KINDS=Object.freeze(['campaign-registry','epoch-admissions','final-review','entry-stake','closing-stake','ownership',
 'position-inventory','position-history','action-policy','action-completions','issuer-policy','previous-board','late-approvals',
 'collection-policy','price-policy','position-checkpoints','application-history']);
const hash=(crypto,value)=>crypto.sha256(utf8(canonicalJson(value)));
const compare=(a,b)=>a.id<b.id?-1:a.id>b.id?1:0;
function identity(input){
 requireEvidence(['application','evidence'].includes(input.authority)&&REQUIREMENT_KINDS.includes(input.kind),'requirement-kind');
 requireEvidence(input.subject&&Object.keys(input.subject).length===2&&text(input.subject.kind)&&text(input.subject.id),'requirement-subject');
 requireEvidence(time(input.cutoffMs),'requirement-cutoff');
 const c=input.coverage;
 requireEvidence(c&&['point','interval'].includes(c.required)&&time(c.fromMs)&&time(c.toMs)&&c.fromMs<=c.toMs&&c.toMs===input.cutoffMs&&
  (c.required!=='point'||c.fromMs===c.toMs),'requirement-coverage');
 requireEvidence(input.available===undefined||typeof input.available==='boolean','requirement-availability');
 requireEvidence(input.pendingReason===undefined||text(input.pendingReason),'requirement-pending-reason');
 const result={authority:input.authority,kind:input.kind,subject:input.subject,cutoffMs:input.cutoffMs,coverage:{fromMs:c.fromMs,toMs:c.toMs,required:c.required}};
 if(input.authority==='evidence'){
  for(const key of ['sourceId','sourceRevision','decoderVersion'])requireEvidence(text(input[key]),'requirement-'+key);
  Object.assign(result,{sourceId:input.sourceId,sourceRevision:input.sourceRevision,decoderVersion:input.decoderVersion});
 }else requireEvidence(['sourceId','sourceRevision','decoderVersion'].every(key=>input[key]===undefined),'application-source-identity');
 return result;
}
// Capture every caller-owned value before the first digest await. SQL adapters
// must capture these values and their dependency revisions in the same read.
export async function buildRequirementSpecs(inputs,crypto){
 const captured=clone(inputs);requireEvidence(Array.isArray(captured)&&captured.length<=16384,'requirement-count-bound');
 const prepared=captured.map(input=>{
  const base=identity(input);requireEvidence(Object.hasOwn(input,'value')&&utf8(canonicalJson(input.value)).length<=256*1024,'requirement-value-bound');
  return {base,value:input.value,available:input.authority==='application'?input.available===true:input.available!==false,pendingReason:input.pendingReason??'fact-unavailable'};
 });
 const result=[],ids=new Set();
 for(const {base,value,available,pendingReason} of prepared){
  const id=await hash(crypto,['cutoff-requirement-v1',base]);requireEvidence(!ids.has(id),'duplicate-requirement');ids.add(id);
  result.push({...base,id,expectedValueDigest:await hash(crypto,['cutoff-value-v1',value]),available,pendingReason});
 }
 return result.sort(compare);
}
// Only supported complete synthetic decoders may normalize evidence for a
// historical requirement. Decoder-only account reads never prove coverage.
export function normalizeRequirementValue(kind,decoderVersion,decoded){
 requireEvidence(decoded&&typeof decoded==='object','missing-decoded-value');
 if(decoderVersion==='synthetic-cutoff-facts-v1'){
  requireEvidence(['campaign-registry','ownership','position-inventory','action-completions'].includes(kind)&&decoded.kind===kind&&Object.hasOwn(decoded,'value'),'decoded-kind');return clone(decoded.value);
 }
 if(decoderVersion==='synthetic-pricing-v1'){
  requireEvidence(['entry-stake','closing-stake'].includes(kind)&&decoded.status==='verified','decoded-pricing-kind');
  return Object.fromEntries(['status','microUsd','stakedUnits','priceNumerator','priceDenominator','expiresMs'].map(k=>{
   requireEvidence(Object.hasOwn(decoded,k),'decoded-pricing-field');return [k,decoded[k]];
  }));
 }
 if(decoderVersion==='synthetic-position-history-v2'){
  requireEvidence(kind==='position-history'&&Array.isArray(decoded.events),'decoded-history-kind');
  return Object.fromEntries(['wallet','tokenId','sequence','creditedUnits','events'].map(k=>{
   requireEvidence(Object.hasOwn(decoded,k),'decoded-history-field');return [k,clone(decoded[k])];
  }));
 }
 throw new TypeError('unsupported-complete-decoder');
}
export async function selectRequirementReceipts(specs,heads,crypto){
 const captured=clone(specs),headMap=new Map();
 requireEvidence(Array.isArray(captured)&&captured.length<=16384,'requirement-count-bound');
 // Freeze all heads before asynchronous hashing; the repository separately CASes
// source revisions so a later correction cannot seal this older snapshot.
 for(const spec of captured)headMap.set(spec.id,clone(heads.get(spec.id)??null));
 const requirements=[],evidence=[],dependencies=[],ids=new Set();
 for(const spec of captured.sort(compare)){
  const base=identity(spec);requireEvidence(digest(spec.id)&&digest(spec.expectedValueDigest)&&!ids.has(spec.id),'requirement-identity');ids.add(spec.id);
  requireEvidence(spec.id===await hash(crypto,['cutoff-requirement-v1',base]),'requirement-identity');
  const gaps=[];let receiptDigest=null,valueDigest=null;
  if(!spec.available)gaps.push(spec.pendingReason??'fact-unavailable');
  if(spec.authority==='application'){
   if(spec.available)valueDigest=spec.expectedValueDigest;
  }else{
   const head=headMap.get(spec.id),e=head?.envelope,d=head?.decision;
   if(!head)gaps.push('receipt-missing');
   else{
    if(!digest(head.receiptDigest))gaps.push('receipt-identity');else receiptDigest=head.receiptDigest;
    if(e?.mode!=='synthetic-fixture'||e?.finality!=='finalized')gaps.push('receipt-mode-or-finality');
    if(e?.sourceId!==spec.sourceId||e?.sourceRevision!==spec.sourceRevision||e?.decoderVersion!==spec.decoderVersion)gaps.push('receipt-source');
    if(canonicalJson(e?.subject??null)!==canonicalJson(spec.subject))gaps.push('receipt-subject');
    if(e?.requestedCutoffMs!==spec.cutoffMs)gaps.push('receipt-cutoff');
    if(d?.status!=='verified'||d?.scope!=='synthetic-transcript'||d?.coverage?.complete!==true||!Array.isArray(d?.coverage?.gaps)||d.coverage.gaps.length)gaps.push('receipt-incomplete');
    // Pricing v1 proves an exact assembled point, not an interval. Its B04
    // receipt predates explicit from/to fields; requestedCutoff supplies both.
    const coverage=d?.coverage,pricing=spec.decoderVersion==='synthetic-pricing-v1'&&spec.coverage.required==='point';
    if((coverage?.fromMs??(pricing?e?.requestedCutoffMs:undefined))!==spec.coverage.fromMs||
     (coverage?.toMs??(pricing?e?.requestedCutoffMs:undefined))!==spec.coverage.toMs)gaps.push('receipt-coverage');
    try{valueDigest=await hash(crypto,['cutoff-value-v1',normalizeRequirementValue(spec.kind,spec.decoderVersion,d?.decoded)]);
     if(valueDigest!==spec.expectedValueDigest)gaps.push('receipt-value');
    }catch{gaps.push('receipt-decoded-value');}
   }
  }
  requirements.push({...spec,receiptDigest,gaps});evidence.push({requirementId:spec.id,authority:spec.authority,valueDigest,receiptDigest});
  if(gaps.length)dependencies.push({id:spec.id,reasons:gaps});
 }
 return {kind:dependencies.length?'pending':'ready',requirements,evidence,dependencies,
  requirementsDigest:await hash(crypto,['cutoff-requirements-v1',captured]),evidenceDigest:await hash(crypto,['cutoff-evidence-v1',evidence])};
}
