import {publishStage} from '../domain/collections/inventory.mjs';
import {LEVEL_QUOTAS,checkTimestamp,requirePolicy} from '../domain/collections/policy.mjs';
import {utf8} from '../security/canonical.mjs';
import {decode58} from '../server/base58.mjs';
const keys=['inventoryId','stageId','type','publishedAt','opensAt','closesAt','priceLamports','costLamports','allocation','walletLimit','founderApproved','approvedSpendLamports','ballotId','inventoryOverrideReason','eligibilityListId','sourceKind'];
const exact=(v,ks)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===ks.length&&ks.every(k=>Object.hasOwn(v,k));
const id=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const amount=v=>{requirePolicy(typeof v==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(v)&&BigInt(v)<(1n<<64n),'invalid_units');return BigInt(v);};
const freeze=v=>{if(v&&typeof v==='object'){for(const child of Object.values(v))freeze(child);Object.freeze(v);}return v;};
const legacyEncode=v=>JSON.stringify(v,(_k,n)=>typeof n==='bigint'?{$lamports:n.toString()}:n);
/** A publication request names one independently verified list. Free-phase
 * membership is attached later at the exact published opening, never here. */
export function normalizeStagePublication(input){
 const i=structuredClone(input);requirePolicy(exact(i,keys),'invalid_stage_publication');
 requirePolicy(id(i.inventoryId)&&id(i.stageId)&&['whitelist','public','free','founder'].includes(i.type),'invalid_stage_identity');
 for(const at of [i.publishedAt,i.opensAt,i.closesAt])checkTimestamp(at);
 amount(i.priceLamports);amount(i.costLamports);if(i.approvedSpendLamports!==null)amount(i.approvedSpendLamports);
 requirePolicy(Number.isInteger(i.allocation)&&i.allocation>0&&i.allocation<=1000&&(i.walletLimit===null||Number.isInteger(i.walletLimit)&&i.walletLimit>0&&i.walletLimit<=1000),'invalid_stage_allocation');
 requirePolicy(typeof i.founderApproved==='boolean'&&(i.ballotId===null||id(i.ballotId)),'invalid_stage_approval');
 requirePolicy(i.inventoryOverrideReason===null||typeof i.inventoryOverrideReason==='string'&&i.inventoryOverrideReason.trim().length>0&&i.inventoryOverrideReason.length<=500,'invalid_override');
 requirePolicy(['whitelist','founder'].includes(i.type)?hash(i.eligibilityListId):i.eligibilityListId===null,'invalid_stage_eligibility_binding');
 requirePolicy(i.sourceKind==='synthetic-local-operator-fixture','stage_source_kind');return freeze(i);
}
/** Live publication policy, deliberately separate from historical terms
 * reconstruction: old accepted receipts retain their original exact preimage. */
export function validateNewStageOpeningPolicy(input,header,stages){
 const i=normalizeStagePublication(input);
 requirePolicy(header&&Array.isArray(stages),'stage_header_invalid');
 const firstLater=header.kind==='genesis'&&header.tranche>1&&stages.length===0;
 requirePolicy(firstLater||i.ballotId===null&&i.inventoryOverrideReason===null,'stage_opening_policy_inapplicable');
 return i;
}
/** Pure bounded stage derivation. Facts must come from the repository, whose
 * final claim must recheck revisions, scope, header and sealed list identity.
 * Passing this plan grants neither publication nor mint admission authority. */
export async function prepareStagePublication(input,facts,crypto){
 const i=normalizeStagePublication(input),f=structuredClone(facts),h=f.header;
 requirePolicy(h&&h.id===i.inventoryId&&['genesis','season'].includes(h.kind)&&Number.isSafeInteger(h.revision)&&h.revision>=0,'stage_header_invalid');
 requirePolicy(Array.isArray(f.stages)&&f.stages.length<32&&new Set(f.stages.map(s=>s.id)).size===f.stages.length,'stage_limit');
 checkTimestamp(f.nowMs);requirePolicy(i.publishedAt<=f.nowMs,'future_publication');
 requirePolicy(h.kind!=='season'||i.opensAt>=checkTimestamp(h.seasonStart),'stage_before_season');
 if(h.kind==='genesis')requirePolicy(Number.isInteger(h.tranche)&&h.tranche>=1&&h.tranche<=10,'invalid_genesis_tranche');
 if(h.kind==='genesis'&&h.tranche>1&&!f.stages.length){
  requirePolicy(i.ballotId!==null&&f.previous&&f.previous.tranche===h.tranche-1&&Array.isArray(f.previous.openings)&&f.previous.openings.length>0&&f.previous.openings.length<=32,'missing_previous_tranche');
  f.previous.openings.forEach(checkTimestamp);
  requirePolicy(f.ballot?.id===i.ballotId&&f.ballot.trancheOpeningMs===Math.min(...f.previous.openings),'wrong_ballot');
 }
 let wallets=[];
 if(i.eligibilityListId!==null){
  requirePolicy(f.eligibility?.id===i.eligibilityListId&&Array.isArray(f.eligibility.wallets)&&f.eligibility.wallets.length<=10000,'stage_list_unavailable');
  wallets=f.eligibility.wallets;for(let n=0;n<wallets.length;n++){decode58(wallets[n],32);requirePolicy(n===0||wallets[n-1]<wallets[n],'stage_list_order');}
 }else requirePolicy(f.eligibility===null,'unexpected_stage_list');
 const domainInput={id:i.stageId,type:i.type,publishedAt:i.publishedAt,opensAt:i.opensAt,closesAt:i.closesAt,priceLamports:amount(i.priceLamports),
  allocation:i.allocation,walletLimit:i.walletLimit??undefined,founderApproved:i.founderApproved,approvedSpendLamports:i.approvedSpendLamports===null?undefined:amount(i.approvedSpendLamports),wallets};
 const prior={id:h.id,kind:h.kind,tranche:h.tranche,version:h.revision,slots:1000,stages:f.stages,admissions:[],remaining:LEVEL_QUOTAS,fulfilled:0};
 const derived=publishStage(prior,domainInput).stages.at(-1),cost=amount(i.costLamports);
 // Preserve the existing published terms preimage, including explicit nulls
 // and ordered fields. Canonical storage hashes are a separate commitment.
 const termsDigest=await crypto.sha256(utf8(legacyEncode([h.id,i.stageId,i.type,i.publishedAt,i.opensAt,i.closesAt,domainInput.priceLamports,cost,i.allocation,i.walletLimit,i.founderApproved,domainInput.approvedSpendLamports??null,i.ballotId,i.inventoryOverrideReason,wallets])));
 const {wallets:ignored,...terms}=derived;
 const stage={...JSON.parse(legacyEncode(terms)),costLamports:{$lamports:i.costLamports},termsDigest,ballotId:i.ballotId,inventoryOverrideReason:i.inventoryOverrideReason};
 return freeze({inventoryId:h.id,expectedInventoryRevision:h.revision,stageId:i.stageId,ordinal:f.stages.length,stage,
  eligibility:{kind:i.type==='public'?'unrestricted':i.type==='free'?'pending':'list',listId:i.eligibilityListId,count:i.eligibilityListId===null?null:wallets.length},
  source:'local-fixture',executable:false});
}
