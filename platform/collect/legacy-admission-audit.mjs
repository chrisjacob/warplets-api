import {canonicalJson,utf8} from '../security/canonical.mjs';
import {verifyCollectionRecordBody,collectionListClosureDigest} from './source-intake.mjs';
import {prepareMintAdmission} from '../domain/collections/inventory.mjs';
import {LEVEL_QUOTAS,drawLevel} from '../domain/collections/policy.mjs';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const need=(value,code)=>{if(!value){const error=new TypeError(code);error.code=code;throw error;}};
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const id=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
const nat=(v,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
const money=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,22})$/.test(v);
const time=v=>nat(v,8640000000000000);
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const clone=v=>JSON.parse(canonicalJson(v));
const amount=v=>exact(v,['$lamports'])&&money(v.$lamports)&&BigInt(v.$lamports)<(1n<<64n);
const hash=(crypto,v)=>crypto.sha256(utf8(canonicalJson(v)));
function raw(v,max){need(exact(v,['id','size','bytes'])&&digest(v.id)&&nat(v.size,max)&&v.size>0&&v.bytes instanceof Uint8Array&&v.bytes.length===v.size,'legacy-admission-record');return {...v,bytes:v.bytes.slice()};}
export const LEGACY_ADMISSION_AUDIT_LIMITS=Object.freeze({rootBytes:131072,pageBytes:65536,membershipPageBytes:8192,contextBytes:32768,workingBytes:1048576,stages:32,admissions:1000});
function rootShape(root){need(root.format==='collection-source-v1'&&root.admissions.count<=1000&&root.inventory.fulfilled<=root.admissions.count,'legacy-admission-root');}
function initial(root,rootId){return {rootId,ordinal:0,pageIndex:0,entryIndex:0,fulfilled:0,pending:0,paid:0,free:0,founder:0,remaining:[...LEVEL_QUOTAS],stages:root.stages.map(s=>({id:s.terms.id,type:s.terms.type,admitted:0,spentLamports:'0'}))};}
function prefixShape(p,root,rootId){
 need(exact(p,['rootId','ordinal','pageIndex','entryIndex','fulfilled','pending','paid','free','founder','remaining','stages'])&&p.rootId===rootId&&[p.ordinal,p.fulfilled,p.pending,p.paid,p.free,p.founder].every(v=>nat(v,1000))&&nat(p.pageIndex,16)&&nat(p.entryIndex,100),'legacy-admission-prefix');
 need(p.ordinal<=root.admissions.count&&p.fulfilled+p.pending===p.ordinal&&p.paid+p.free+p.founder===p.fulfilled&&Array.isArray(p.remaining)&&p.remaining.length===10&&p.remaining.every((v,i)=>nat(v,LEVEL_QUOTAS[i]))&&p.remaining.reduce((a,b)=>a+b,0)===1000-p.fulfilled,'legacy-admission-prefix-counts');
 need(Array.isArray(p.stages)&&p.stages.length===root.stages.length&&p.stages.every((s,i)=>exact(s,['id','type','admitted','spentLamports'])&&s.id===root.stages[i].terms.id&&s.type===root.stages[i].terms.type&&nat(s.admitted,1000)&&money(s.spentLamports)&&amount(root.stages[i].terms.costLamports)&&BigInt(s.spentLamports)===BigInt(s.admitted)*BigInt(root.stages[i].terms.costLamports.$lamports))&&p.stages.reduce((n,s)=>n+s.admitted,0)===p.ordinal,'legacy-admission-stage-prefix');
 if(p.ordinal===0)need(same(p,initial(root,rootId)),'legacy-admission-initial-prefix');
}
/** Initialization proves only canonical root shape. Prior audit state and all
 * historical facts must be selected by a future private guarded repository. */
export async function startLegacyAdmissions(value,{crypto}){const record=raw(value,131072),root=await verifyCollectionRecordBody(record,crypto);rootShape(root);return freeze(initial(root,record.id));}
function capture(value){
 need(exact(value,['sourceRoot','admissionPage','asOfMs','prefix','operation','stageAudit','membership','freeCutAudit','controlFact','openingDecision','priorFacts','mintAudit']),'legacy-admission-fields');
 const sourceRoot=raw(value.sourceRoot,131072),admissionPage=raw(value.admissionPage,65536),membershipPage=value.membership?raw(value.membership.page,8192):null;
 const {sourceRoot:ignore,admissionPage:ignore2,membership,...rest}=value,context={...rest,membership:membership?{seal:membership.seal}:null};
 if(membership)need(exact(membership,['seal','page']),'legacy-admission-membership');const text=canonicalJson(context),contextBytes=utf8(text).length;need(contextBytes<=32768,'legacy-admission-context-bound');
 const workingBytes=4*(sourceRoot.size+admissionPage.size+(membershipPage?.size??0))+3*contextBytes+16384;need(workingBytes<=1048576,'legacy-admission-working-bound');
 return {sourceRoot,admissionPage,membershipPage,...JSON.parse(text),metrics:{sourceBytes:sourceRoot.size+admissionPage.size,membershipBytes:membershipPage?.size??0,contextBytes,workingBytes}};
}
function held(reason){return freeze({kind:'held',reason});}
async function membership(f,stage,entry,crypto){
 if(stage.terms.type==='public'){need(stage.eligibility.kind==='unrestricted'&&f.membership===null&&f.freeCutAudit===null,'legacy-admission-public-membership');return true;}
 if(!f.membership)return null;
 const l=f.membership.seal;need(exact(l,['id','count','pageIds','walletsDigest','closureDigest','firstWallet','lastWallet'])&&digest(l.id)&&nat(l.count,10000)&&Array.isArray(l.pageIds)&&l.pageIds.length===Math.max(1,Math.ceil(l.count/100))&&l.pageIds.every(digest)&&new Set(l.pageIds).size===l.pageIds.length&&digest(l.walletsDigest)&&digest(l.closureDigest),'legacy-admission-list');
 need(stage.eligibility.kind==='list'&&stage.eligibility.manifestId===l.id&&await collectionListClosureDigest(l,crypto)===l.closureDigest&&await hash(crypto,{format:'collection-list-v1',count:l.count,pageCount:l.pageIds.length,pageIds:l.pageIds,walletsDigest:l.walletsDigest})===l.id,'legacy-admission-list-binding');
 const page=await verifyCollectionRecordBody(f.membershipPage,crypto);need(page.format==='collection-page-v1'&&page.kind==='eligibility'&&l.pageIds[page.index]===f.membershipPage.id&&page.entries.length===Math.min(100,l.count-page.index*100)&&page.entries.includes(entry.wallet),'legacy-admission-wallet-ineligible');
 if(stage.terms.type==='free'){
  const cut=f.freeCutAudit;if(cut===null)return null;
  need(exact(cut,['rootId','inventoryId','stageId','opensAt','listId','walletsDigest','originalCutDigest','sourceDigest'])&&cut.rootId===f.sourceRoot.id&&cut.inventoryId===f.inventoryId&&cut.stageId===entry.stageId&&cut.opensAt===stage.terms.opensAt&&cut.listId===l.id&&cut.walletsDigest===l.walletsDigest&&digest(cut.originalCutDigest)&&digest(cut.sourceDigest),'legacy-admission-free-cut-binding');
 }else need(f.freeCutAudit===null&&f.stageAudit.originalListId===l.id&&f.stageAudit.walletsDigest===l.walletsDigest,'legacy-admission-original-list-binding');
 return true;
}
function controls(f,root,entry){
 const c=f.controlFact;if(c===null)return 'legacy-admission-historical-control-missing';
 need(exact(c,['rootId','operationId','atMs','scope','sourceDigest','scopeRevision','paused','pressure','decision'])&&c.rootId===f.sourceRoot.id&&c.operationId===entry.operationId&&c.atMs===entry.admittedAt&&c.scope==='collection-mint'&&digest(c.sourceDigest)&&(c.scopeRevision===null||digest(c.scopeRevision))&&typeof c.paused==='boolean'&&['normal','warning','limit'].includes(c.pressure),'legacy-admission-control-facts');
 const expected=c.paused?{scope:'collection-mint',allowed:false,reason:'operator-pause',revision:c.scopeRevision}:c.pressure==='limit'?{scope:'collection-mint',allowed:false,reason:'budget-limit'}:{scope:'collection-mint',allowed:true,reason:c.pressure==='warning'?'budget-warning':'available',revision:c.scopeRevision};
 need(same(c.decision,expected),'legacy-admission-control-decision');need(expected.allowed,'legacy-admission-original-control-rejected');
 if(root.inventory.kind==='genesis'&&root.inventory.tranche>1&&f.prefix.ordinal===0){
  const d=f.openingDecision,first=root.stages[0].terms;if(d===null)return 'legacy-admission-original-opening-decision-missing';
  need(exact(d,['rootId','inventoryId','tranche','atMs','ballotId','earliestMs','previousTranche','previousUnsold','sourceDigest'])&&d.rootId===f.sourceRoot.id&&d.inventoryId===root.inventory.id&&d.tranche===root.inventory.tranche&&d.atMs===entry.admittedAt&&d.ballotId===first.ballotId&&id(d.ballotId)&&time(d.earliestMs)&&d.earliestMs<=entry.admittedAt&&d.previousTranche===d.tranche-1&&nat(d.previousUnsold,1000)&&digest(d.sourceDigest),'legacy-admission-opening-decision');
  need(d.previousUnsold===0||typeof first.inventoryOverrideReason==='string'&&first.inventoryOverrideReason.trim().length>0,'legacy-admission-previous-tranche-unsold');
 }else need(f.openingDecision===null,'legacy-admission-unexpected-opening-decision');return null;
}
/** One original admission, including pending rows. Historical correctness only;
 * no current chain, payment, operation or inventory activation authority. */
export async function auditLegacyAdmission(value,{crypto,onMeasure}={}){const f=capture(value);value=null;try{return await auditCaptured(f,crypto);}finally{onMeasure?.(f.metrics);}}
async function auditCaptured(f,crypto){
 need(time(f.asOfMs),'legacy-admission-clock');const root=await verifyCollectionRecordBody(f.sourceRoot,crypto),page=await verifyCollectionRecordBody(f.admissionPage,crypto);rootShape(root);prefixShape(f.prefix,root,f.sourceRoot.id);
 const p=f.prefix;need(p.ordinal<root.admissions.count&&page.format==='collection-page-v1'&&page.kind==='admissions'&&page.index===p.pageIndex&&root.admissions.pageIds[p.pageIndex]===f.admissionPage.id&&p.entryIndex<page.entries.length&&p.ordinal>=p.pageIndex+p.entryIndex&&(p.pageIndex!==0||p.ordinal===p.entryIndex),'legacy-admission-cursor');const entry=page.entries[p.entryIndex],stage=root.stages.find(s=>s.terms.id===entry.stageId),op=f.operation;f.inventoryId=root.inventory.id;
 need(stage&&amount(stage.terms.costLamports)&&amount(stage.terms.priceLamports)&&same(stage.terms.costLamports,entry.costLamports),'legacy-admission-stage-cost');
 if(f.stageAudit===null)return held('legacy-admission-stage-audit-missing');const audit=f.stageAudit;need(audit.kind==='verified'&&audit.inventoryId===root.inventory.id&&audit.stageId===entry.stageId&&audit.termsDigest===stage.terms.termsDigest&&audit.normalizedProjectionDigest===await hash(crypto,stage.terms)&&audit.verification==='publication-preimage-and-scalar-reducer-only'&&audit.source==='local-reference-fixture'&&audit.executable===false,'legacy-admission-stage-audit-binding');
 const eligible=await membership(f,stage,entry,crypto);if(eligible===null)return held(stage.terms.type==='free'?'legacy-admission-original-free-cut-missing':'legacy-admission-original-membership-missing');
 const controlHold=controls(f,root,entry);if(controlHold)return held(controlHold);
 need(op&&op.kind==='mint'&&op.id===entry.operationId&&op.inventory_id===root.inventory.id&&op.owner===entry.wallet&&op.commitment===entry.drawCommitment&&op.created_ms===entry.admittedAt&&time(op.created_ms)&&op.created_ms<=f.asOfMs&&id(op.request_key)&&op.request_digest===await crypto.sha256(utf8(JSON.stringify([stage.terms.type==='founder'?'founder':'mint',root.inventory.id,entry.stageId]))),'legacy-admission-operation-binding');
 need(same(JSON.parse(op.operation),{stageId:entry.stageId,costLamports:stage.terms.costLamports,priceLamports:stage.terms.priceLamports}),'legacy-admission-operation-body');
 const prior=f.priorFacts;if(prior===null)return held('legacy-admission-prior-index-facts-missing');need(exact(prior,['rootId','ordinal','operationId','commitment','wallet','requestKey','stageId','proofId','walletStageCount','operationCount','commitmentCount','ownerRequestCount','proofCount'])&&prior.rootId===f.sourceRoot.id&&prior.ordinal===p.ordinal&&prior.operationId===op.id&&prior.commitment===op.commitment&&prior.wallet===op.owner&&prior.requestKey===op.request_key&&prior.stageId===entry.stageId&&prior.proofId===entry.proofId&&nat(prior.walletStageCount,1000)&&[prior.operationCount,prior.commitmentCount,prior.ownerRequestCount,prior.proofCount].every(v=>v===0),'legacy-admission-duplicate-or-unbound-index');
 const stageCounter=p.stages.find(s=>s.id===entry.stageId),terms={...stage.terms,priceLamports:BigInt(stage.terms.priceLamports.$lamports),costLamports:BigInt(stage.terms.costLamports.$lamports),...(stage.terms.approvedSpendLamports?{approvedSpendLamports:BigInt(stage.terms.approvedSpendLamports.$lamports)}:{})};
 prepareMintAdmission({stage:terms,slots:1000,admissionCount:p.ordinal,stageAdmissionCount:stageCounter.admitted,walletAdmissionCount:prior.walletStageCount,founderSpentLamports:BigInt(stageCounter.spentLamports),eligible,priorOperation:null,commitmentUsed:false},{operationId:op.id,wallet:op.owner,stageId:entry.stageId,at:entry.admittedAt,drawCommitment:op.commitment,costLamports:BigInt(entry.costLamports.$lamports)});
 const next=clone(p),counter=next.stages.find(s=>s.id===entry.stageId);counter.admitted++;counter.spentLamports=(BigInt(counter.spentLamports)+BigInt(entry.costLamports.$lamports)).toString();next.ordinal++;next.entryIndex++;if(next.entryIndex===page.entries.length){next.pageIndex++;next.entryIndex=0;}
 if(entry.level===null){need(p.ordinal>=root.inventory.fulfilled&&entry.proofId===null&&entry.ticket===null&&op.settled_ms===null&&op.proof_id===null&&op.evidence_digest===null&&op.receipt===null&&f.mintAudit===null,'legacy-admission-pending-outcome');next.pending++;}
 else{
  need(p.ordinal<root.inventory.fulfilled&&p.pending===0&&p.fulfilled===p.ordinal&&time(op.settled_ms)&&op.settled_ms>=entry.admittedAt&&op.settled_ms<=f.asOfMs&&op.proof_id===entry.proofId&&digest(op.evidence_digest),'legacy-admission-settlement-order');
  if(f.mintAudit===null)return held('legacy-admission-original-mint-audit-missing');const m=f.mintAudit,summary=m.summary;need(m.kind==='audited'&&summary.rootId===f.sourceRoot.id&&summary.admissionPageId===f.admissionPage.id&&summary.ordinal===p.ordinal&&summary.inventoryId===root.inventory.id&&summary.operationId===op.id&&summary.originalWallet===op.owner&&summary.initialLevel===entry.level&&summary.legacyEvidenceDigest===op.evidence_digest&&summary.source==='local-fixture'&&summary.executable===false,'legacy-admission-mint-audit-binding');
  need(op.receipt===JSON.stringify({operationId:op.id,assetId:summary.assetId,at:op.settled_ms}),'legacy-admission-original-receipt');
  const level=drawLevel(p.remaining,entry.ticket);need(level===entry.level,'legacy-admission-draw-level');next.remaining[level-1]--;next.fulfilled++;next[stage.terms.type==='free'?'free':stage.terms.type==='founder'?'founder':'paid']++;
  need(same(m.nextPrefix,{rootId:p.rootId,ordinal:next.ordinal,pageIndex:next.pageIndex,entryIndex:next.entryIndex,remaining:next.remaining}),'legacy-admission-mint-prefix-binding');
 }
 return freeze({kind:'audited',summary:{rootId:p.rootId,ordinal:p.ordinal,inventoryId:root.inventory.id,operationId:op.id,wallet:op.owner,stageId:entry.stageId,termsDigest:stage.terms.termsDigest,priceLamports:stage.terms.priceLamports.$lamports,costLamports:entry.costLamports.$lamports,status:entry.level===null?'pending':'fulfilled',verification:'historical-admission-economics',source:'local-reference-fixture',executable:false},nextPrefix:next});
}
export async function finishLegacyAdmissions(value,prefix,{crypto}){const record=raw(value,131072),p=clone(prefix);need(utf8(canonicalJson(p)).length<=32768,'legacy-admission-context-bound');const root=await verifyCollectionRecordBody(record,crypto);rootShape(root);prefixShape(p,root,record.id);need(p.ordinal===root.admissions.count&&p.pageIndex===root.admissions.pageIds.length&&p.entryIndex===0&&p.fulfilled===root.inventory.fulfilled&&same(p.remaining,root.inventory.remaining),'legacy-admission-final-aggregates');return freeze({kind:'verified',rootId:record.id,inventoryId:root.inventory.id,admitted:p.ordinal,fulfilled:p.fulfilled,remaining:p.remaining,counts:{paid:p.paid,free:p.free,founder:p.founder,pending:p.pending,unsold:1000-p.ordinal,unmintedReserve:1000-p.fulfilled},stages:p.stages,verification:'historical-admission-economics',source:'local-reference-fixture',executable:false});}
