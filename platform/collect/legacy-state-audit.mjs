import {verifyCollectionRecordBody} from './source-intake.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
export const LEGACY_STATE_AUDIT_LIMITS=Object.freeze({transcriptBytes:33554432,fragmentBytes:65536,checkpointBytes:4096,workingBytes:1048576,recordsPerStep:3});
const FORMAT='legacy-canonical-state-audit-v1',keys=['format','rootId','phase','admissionIndex','admissionCount','stageIndex','listPageIndex','listCount','listLastWallet','listsVerified','walletsVerified','prefixBytes','mainHash','listHash','checkpointDigest'];
const termKeys=['allocation','approvedSpendLamports','ballotId','closesAt','costLamports','id','inventoryOverrideReason','opensAt','priceLamports','publishedAt','termsDigest','type','walletLimit'];
const requiredTerms=['allocation','closesAt','id','opensAt','priceLamports','publishedAt','type','walletLimit'];
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),nat=(v,max)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
const exact=(v,ks)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===ks.length&&ks.every(k=>Object.hasOwn(v,k));
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
class Held extends Error{constructor(reason){super(reason);this.reason=reason;}}
const need=(c,reason='legacy-state-input-invalid')=>{if(!c)throw new Held(reason);};
const clone=v=>JSON.parse(canonicalJson(v));
function hashState(value){need(value&&typeof value==='object'&&!Array.isArray(value)&&nat(value.bytes,33554432)&&utf8(canonicalJson(value)).length<=1024,'legacy-state-hash-state-invalid');return value;}
function capture(input){
 need(exact(input,['rootId','checkpoint'])&&digest(input.rootId));if(input.checkpoint===null)return {rootId:input.rootId,checkpoint:null};
 const c=input.checkpoint;need(exact(c,keys)&&c.format===FORMAT&&c.rootId===input.rootId&&['admissions','stages','wallets','finish'].includes(c.phase)&&digest(c.checkpointDigest),'legacy-state-checkpoint-invalid');
 for(const [key,max] of [['admissionIndex',16],['admissionCount',1000],['stageIndex',32],['listPageIndex',100],['listCount',10000],['listsVerified',32],['walletsVerified',320000],['prefixBytes',33554432]])need(nat(c[key],max),'legacy-state-checkpoint-invalid');
 need(c.listLastWallet===null||typeof c.listLastWallet==='string'&&c.listLastWallet.length<=44,'legacy-state-checkpoint-invalid');hashState(c.mainHash);if(c.listHash!==null)hashState(c.listHash);
 need(c.mainHash.bytes===c.prefixBytes&&utf8(canonicalJson(c)).length<=4096,'legacy-state-prefix-bytes-invalid');return clone(input);
}
function validateRoot(root){
 need(root.format==='collection-source-v1','legacy-state-root-kind');
 for(const stage of root.stages){const t=stage.terms;need(Object.keys(t).every(k=>termKeys.includes(k))&&requiredTerms.every(k=>Object.hasOwn(t,k)),'legacy-state-unknown-stage-terms');
  for(const k of ['publishedAt','opensAt','closesAt'])need(nat(t[k],8640000000000000),'legacy-state-stage-terms-invalid');
  need(nat(t.allocation,1000)&&nat(t.walletLimit,1000),'legacy-state-stage-terms-invalid');
  for(const k of ['priceLamports','costLamports','approvedSpendLamports'])if(Object.hasOwn(t,k))need(exact(t[k],['$lamports'])&&typeof t[k].$lamports==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(t[k].$lamports)&&BigInt(t[k].$lamports)<(1n<<64n),'legacy-state-stage-terms-invalid');
  if(Object.hasOwn(t,'termsDigest'))need(digest(t.termsDigest),'legacy-state-stage-terms-invalid');
  if(Object.hasOwn(t,'ballotId'))need(t.ballotId===null||typeof t.ballotId==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(t.ballotId),'legacy-state-stage-terms-invalid');
  if(Object.hasOwn(t,'inventoryOverrideReason'))need(t.inventoryOverrideReason===null||typeof t.inventoryOverrideReason==='string'&&t.inventoryOverrideReason.length<=500,'legacy-state-stage-terms-invalid');
 }
}
function validateCursor(c,root){
 need(c.admissionIndex<=root.admissions.pageIds.length&&c.admissionCount<=root.admissions.count&&c.stageIndex<=root.stages.length,'legacy-state-cursor-invalid');
 need(c.admissionCount>=c.admissionIndex&&c.admissionCount<=c.admissionIndex*100,'legacy-state-cursor-invalid');
 if(c.phase==='admissions')need(c.stageIndex===0&&c.listsVerified===0&&c.walletsVerified===0,'legacy-state-cursor-invalid');
 else need(c.admissionIndex===root.admissions.pageIds.length&&c.admissionCount===root.admissions.count,'legacy-state-cursor-invalid');
 const completeLists=root.stages.slice(0,c.stageIndex).filter(s=>s.eligibility.kind==='list').length;
 need(c.listsVerified===completeLists&&c.walletsVerified<=completeLists*10000,'legacy-state-cursor-invalid');
 if(c.phase==='wallets')need(c.stageIndex<root.stages.length&&root.stages[c.stageIndex].eligibility.kind==='list'&&c.listHash!==null&&c.listCount===c.listPageIndex*100&&(c.listCount===0?c.listLastWallet===null:c.listLastWallet!==null)&&c.listHash.bytes>=1+c.listCount*34&&c.listHash.bytes<=1+c.listCount*47,'legacy-state-cursor-invalid');
 else need(c.listPageIndex===0&&c.listCount===0&&c.listLastWallet===null&&c.listHash===null,'legacy-state-cursor-invalid');
 if(c.phase==='finish')need(c.stageIndex===root.stages.length,'legacy-state-cursor-invalid');
}
/** Deterministic transcript continuation only. Checkpoint digests detect edits;
 * they are not signatures or proof of reachable prefixes. A future private CAS
 * repository must retain the authentic checkpoint/source-generation lineage. */
export function createLegacyStateAudit({crypto,hash,readRecord}){
 return Object.freeze({async step(value){
  const metrics={records:0,readBytes:0,emittedBytes:0,maxWorkingBytes:0};let c,checkpointBytes=0;
  const read=async id=>{const record=await readRecord(id);need(record,'legacy-state-record-missing');need(record.id===id,'legacy-state-record-identity');need(record.bytes instanceof Uint8Array&&record.bytes.length===record.size&&record.size<=131072,'legacy-state-record-bound');metrics.records++;metrics.readBytes+=record.size;need(metrics.records<=3,'legacy-state-record-bound');const body=await verifyCollectionRecordBody(record,crypto);return body;};
  const emit=(text,toList=false)=>{if(!text)return;const bytes=utf8(text);need(bytes.length<=65536&&c.prefixBytes+bytes.length<=33554432,'legacy-state-transcript-bound');c.mainHash=hash.advance(c.mainHash,bytes);if(toList)c.listHash=hash.advance(c.listHash,bytes);c.prefixBytes+=bytes.length;metrics.emittedBytes+=bytes.length;metrics.maxWorkingBytes=Math.max(metrics.maxWorkingBytes,metrics.readBytes*4+checkpointBytes*3+bytes.length*3+16384);need(metrics.maxWorkingBytes<=1048576,'legacy-state-working-bound');};
  try{
   const input=capture(value);checkpointBytes=input.checkpoint?utf8(canonicalJson(input.checkpoint)).length:0;
   if(input.checkpoint){const {checkpointDigest,...body}=input.checkpoint;need(await crypto.sha256(utf8(canonicalJson(body)))===checkpointDigest,'legacy-state-checkpoint-digest');c=body;hash.finish(c.mainHash);if(c.listHash)hash.finish(c.listHash);}
   const root=await read(input.rootId);validateRoot(root);metrics.maxWorkingBytes=metrics.readBytes*4+checkpointBytes*3+16384;need(metrics.maxWorkingBytes<=1048576,'legacy-state-working-bound');
   if(!c){c={format:FORMAT,rootId:input.rootId,phase:'admissions',admissionIndex:0,admissionCount:0,stageIndex:0,listPageIndex:0,listCount:0,listLastWallet:null,listsVerified:0,walletsVerified:0,prefixBytes:0,mainHash:hash.initial(),listHash:null};emit('{"admissions":[');}
   else{
    validateCursor(c,root);
    if(c.phase==='admissions'){
     if(c.admissionIndex<root.admissions.pageIds.length){const page=await read(root.admissions.pageIds[c.admissionIndex]);need(page.format==='collection-page-v1'&&page.kind==='admissions'&&page.index===c.admissionIndex&&page.entries.length>0&&c.admissionCount+page.entries.length<=root.admissions.count,'legacy-state-admission-page');emit((c.admissionCount?',':'')+canonicalJson(page.entries).slice(1,-1));c.admissionIndex++;c.admissionCount+=page.entries.length;}
     else{need(c.admissionCount===root.admissions.count,'legacy-state-admission-count');const before=Object.keys(root.inventory).sort().filter(k=>k<'stages').map(k=>JSON.stringify(k)+':'+canonicalJson(root.inventory[k])).join(',');emit('],'+before+',"stages":[');c.phase='stages';}
    }else if(c.phase==='stages'){
     if(c.stageIndex===root.stages.length){const after=Object.keys(root.inventory).sort().filter(k=>k>'stages').map(k=>JSON.stringify(k)+':'+canonicalJson(root.inventory[k])).join(',');emit(']'+(after?','+after:'')+'}');c.phase='finish';}
     else{const stage=root.stages[c.stageIndex],prefix=(c.stageIndex?',':'')+canonicalJson(stage.terms).slice(0,-1)+',"wallets":';
      if(stage.eligibility.kind==='list'){const list=await read(stage.eligibility.manifestId);need(list.format==='collection-list-v1','legacy-state-list-kind');emit(prefix+'[');c.listHash=hash.advance(hash.initial(),utf8('['));c.phase='wallets';}
      else{emit(prefix+'null}');c.stageIndex++;}
     }
    }else if(c.phase==='wallets'){
     const list=await read(root.stages[c.stageIndex].eligibility.manifestId);need(list.format==='collection-list-v1'&&c.listPageIndex<list.pageIds.length,'legacy-state-list-kind');
     const page=await read(list.pageIds[c.listPageIndex]),expected=c.listPageIndex===list.pageIds.length-1?list.count-c.listPageIndex*100:100;
     need(page.format==='collection-page-v1'&&page.kind==='eligibility'&&page.index===c.listPageIndex&&page.entries.length===expected&&(c.listLastWallet===null||page.entries.length>0&&c.listLastWallet<page.entries[0]),'legacy-state-wallet-page');
     emit((c.listCount&&page.entries.length?',':'')+canonicalJson(page.entries).slice(1,-1),true);c.listPageIndex++;c.listCount+=page.entries.length;c.listLastWallet=page.entries.at(-1)??c.listLastWallet;
     if(c.listPageIndex===list.pageIds.length){need(c.listCount===list.count,'legacy-state-list-count');c.listHash=hash.advance(c.listHash,utf8(']'));need(hash.finish(c.listHash)===list.walletsDigest,'legacy-state-list-digest');emit(']}');c.stageIndex++;c.listsVerified++;c.walletsVerified+=c.listCount;c.phase='stages';c.listPageIndex=0;c.listCount=0;c.listLastWallet=null;c.listHash=null;}
    }else{const computed=hash.finish(c.mainHash);need(computed===root.source.stateDigest,'legacy-state-projection-digest-mismatch');return freeze({kind:'verified',rootId:input.rootId,inventoryId:root.source.inventoryId,sourceRevision:root.source.revision,stateDigest:computed,transcriptBytes:c.prefixBytes,admissionCount:c.admissionCount,stageCount:c.stageIndex,listOccurrences:c.listsVerified,walletOccurrences:c.walletsVerified,verification:'projection-digest-only',rawSourceRelationVerified:false,economicsVerified:false,adoptionAuthorized:false,executable:false,metrics});}
   }
   validateCursor(c,root);need(c.mainHash.bytes===c.prefixBytes,'legacy-state-prefix-bytes-invalid');const checkpoint={...c,checkpointDigest:await crypto.sha256(utf8(canonicalJson(c)))};need(utf8(canonicalJson(checkpoint)).length<=4096,'legacy-state-checkpoint-bound');return freeze({kind:'continue',checkpoint,metrics});
  }catch(error){return freeze({kind:'held',reason:error instanceof Held?error.reason:'legacy-state-record-or-hash-invalid',metrics});}
 }});
}
