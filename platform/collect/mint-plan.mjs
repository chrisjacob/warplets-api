import {canonicalJson,utf8} from '../security/canonical.mjs';
import {decode58} from '../server/base58.mjs';
import {planMintReservation} from '../application/collection-planning.mjs';
import {prepareMintAdmission} from '../domain/collections/inventory.mjs';
import {LEVEL_QUOTAS,drawLevel,seasonExpiry} from '../domain/collections/policy.mjs';
import {drawRequestPreimage,roundTime} from '../randomness/request-plan.mjs';
import {traitFields,validateTraitChoices,beaconSeedPreimage,beaconProofPreimage,pickTrait} from '../randomness/draw-protocol.mjs';
import {uniformDraw} from '../randomness/portable-draw.mjs';
import {verifyPinnedBeacon} from '../beacon/portable.mjs';

const clone=v=>JSON.parse(canonicalJson(v));
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const fail=(ok,code)=>{if(!ok){const error=new TypeError(code);error.code=code;throw error;}};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const id=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const natural=v=>Number.isSafeInteger(v)&&v>=0;
const time=v=>natural(v)&&v<=8640000000000000;
function wallet(v){try{decode58(v,32);}catch{fail(false,'mint-wallet-invalid');}}
function units(v){fail(typeof v==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(v)&&BigInt(v)<=(1n<<64n)-1n,'mint-units-invalid');return BigInt(v);}
function authority(a){
 fail(exact(a,['inventoryId','kind','tranche','seasonStart','revision','admitted','fulfilled','remaining'])&&id(a.inventoryId)&&natural(a.revision)&&a.revision<Number.MAX_SAFE_INTEGER&&natural(a.admitted)&&a.admitted<=1000&&natural(a.fulfilled)&&a.fulfilled<=a.admitted,'mint-authority-invalid');
 fail(a.kind==='genesis'&&Number.isInteger(a.tranche)&&a.tranche>=1&&a.tranche<=10&&a.seasonStart===null||a.kind==='season'&&a.tranche===null&&time(a.seasonStart),'mint-inventory-invalid');
 fail(Array.isArray(a.remaining)&&a.remaining.length===10&&a.remaining.every((n,i)=>natural(n)&&n<=LEVEL_QUOTAS[i])&&a.remaining.reduce((s,n)=>s+n,0)===1000-a.fulfilled,'mint-remaining-conflict');return a;
}
function stage(s){
 fail(exact(s,['id','type','opensAt','closesAt','allocation','walletLimit','priceLamports','costLamports','approvedSpendLamports','termsDigest'])&&id(s.id)&&['whitelist','free','public','founder'].includes(s.type)&&time(s.opensAt)&&time(s.closesAt)&&s.opensAt<s.closesAt&&Number.isInteger(s.allocation)&&s.allocation>=1&&s.allocation<=1000&&Number.isInteger(s.walletLimit)&&s.walletLimit>=1&&s.walletLimit<=1000&&hash(s.termsDigest),'mint-stage-invalid');
 units(s.priceLamports);units(s.costLamports);if(s.approvedSpendLamports!==null)units(s.approvedSpendLamports);if(['free','founder'].includes(s.type))fail(s.priceLamports==='0','mint-free-price-invalid');
 if(s.type==='founder')fail(s.approvedSpendLamports!==null,'mint-founder-budget-missing');return s;
}
function opening(a,f,nowMs){
 if(a.kind!=='genesis'||a.tranche===1||a.admitted>0)return;
 fail(exact(f,['firstStage','decision','previous'])&&exact(f.firstStage,['ballotId','inventoryOverrideReason'])&&id(f.firstStage.ballotId)&&exact(f.decision,['ballotId','earliestMs'])&&f.decision.ballotId===f.firstStage.ballotId&&time(f.decision.earliestMs)&&nowMs>=f.decision.earliestMs,'mint-tranche-opening-pending');
 fail(exact(f.previous,['tranche','admitted'])&&f.previous.tranche===a.tranche-1&&natural(f.previous.admitted)&&f.previous.admitted<=1000,'mint-previous-tranche-missing');
 fail(f.firstStage.inventoryOverrideReason===null||typeof f.firstStage.inventoryOverrideReason==='string'&&f.firstStage.inventoryOverrideReason.trim().length>0&&utf8(f.firstStage.inventoryOverrideReason).length<=4096,'mint-override-invalid');
 fail(f.previous.admitted===1000||f.firstStage.inventoryOverrideReason!==null,'mint-previous-tranche-unsold');
}
function admission(row,a){
 fail(exact(row,['operationId','ordinal','wallet','stageId','drawCommitment','admittedAt','costLamports','priceLamports','termsDigest','membershipSourceId','fairPolicyHash','fairRegisteredMs','targetRound','contextDigest'])&&id(row.operationId)&&id(row.stageId)&&id(row.drawCommitment)&&natural(row.ordinal)&&row.ordinal<a.admitted&&time(row.admittedAt)&&hash(row.termsDigest)&&(row.membershipSourceId===null||hash(row.membershipSourceId)),'mint-admission-invalid');
 wallet(row.wallet);units(row.costLamports);units(row.priceLamports);
 if(a.kind==='season')fail(a.seasonStart<=row.admittedAt,'mint-before-season');
 if(row.fairPolicyHash===null)fail(row.fairRegisteredMs===null&&row.targetRound===null&&row.contextDigest===null,'mint-fairness-binding-invalid');
 else fail(hash(row.fairPolicyHash)&&time(row.fairRegisteredMs)&&row.fairRegisteredMs<=row.admittedAt&&Number.isSafeInteger(row.targetRound)&&row.targetRound>0&&hash(row.contextDigest),'mint-fairness-binding-invalid');return row;
}

/** Private pure plan. Repository must resolve accepted replay first, load all
 * facts in one snapshot, check actual scopes/controls, then CAS every effect.
 * It conveys neither payment nor chain eligibility/finality authority. */
export async function prepareNormalizedMintAdmission(value,crypto){
 const {command:c,facts:f,operationId,commitment}=clone(value),a=authority(f.authority),s=stage(f.stage);
 fail(c.operationKind==='collection.reserve-operation.v1'&&time(c.nowMs)&&id(operationId)&&id('collect:'+operationId)&&id(commitment)&&f.sourceKind==='synthetic-local-operator-fixture','mint-command-invalid');
 fail(exact(c.input,c.principal?.kind==='operator'?['kind','inventoryId','stageId','expectedTermsDigest','wallet']:['kind','inventoryId','stageId','expectedTermsDigest'])&&c.input.kind==='mint'&&c.input.inventoryId===a.inventoryId&&c.input.stageId===s.id&&c.input.expectedTermsDigest===s.termsDigest,'mint-command-binding');
 const owner=c.principal?.kind==='wallet'?c.principal.wallet:c.input.wallet;wallet(owner);
 fail(c.principal?.kind==='wallet'&&s.type!=='founder'||c.principal?.kind==='operator'&&id(c.principal.id)&&s.type==='founder','mint-principal-lane');
 fail(s.type!=='free','mint-free-cut-pending');
 fail(a.kind!=='genesis'||s.walletLimit===1,'mint-genesis-wallet-limit');
 fail(a.kind!=='season'||a.seasonStart<=c.nowMs,'mint-before-season');opening(a,f.opening,c.nowMs);
 fail(exact(f.membership,['wallet','stageId','eligible','sourceId'])&&f.membership.wallet===owner&&f.membership.stageId===s.id&&typeof f.membership.eligible==='boolean','mint-membership-binding');
 fail(s.type==='public'?f.membership.eligible&&f.membership.sourceId===null:hash(f.membership.sourceId),'mint-membership-source');
 const facts={inventoryId:a.inventoryId,inventoryRevision:String(a.revision),stage:s,slots:1000,admissionCount:a.admitted,stageAdmissionCount:f.stageAdmissionCount,walletAdmissionCount:f.walletAdmissionCount,founderSpentLamports:f.founderSpentLamports,membership:f.membership,priorOperation:null,commitmentUsed:f.commitmentUsed};units(f.founderSpentLamports);
 let row;
 if(c.principal.kind==='wallet')row=planMintReservation(c,facts,{operationId,commitment}).admission;
 else{const planned=prepareMintAdmission({...facts,stage:{...s,approvedSpendLamports:units(s.approvedSpendLamports)},eligible:f.membership.eligible,founderSpentLamports:units(f.founderSpentLamports)},{operationId,wallet:owner,stageId:s.id,at:c.nowMs,drawCommitment:commitment,costLamports:units(s.costLamports)});row={...planned.admission,costLamports:planned.admission.costLamports.toString()};}
 let fairPolicyHash=null,fairRegisteredMs=null,targetRound=null,contextDigest=null;
 if(f.fairPolicy!==null){fail(exact(f.fairPolicy,['policy_hash','registered_ms'])&&hash(f.fairPolicy.policy_hash)&&time(f.fairPolicy.registered_ms),'mint-fair-policy-invalid');const request=drawRequestPreimage(f.fairPolicy,{opId:operationId,kind:'mint',inventoryId:a.inventoryId,owner,commitment,now:c.nowMs});fairPolicyHash=f.fairPolicy.policy_hash;fairRegisteredMs=f.fairPolicy.registered_ms;targetRound=request.targetRound;contextDigest=await crypto.sha256(utf8(canonicalJson(request.preimage)));}
 const stored={operationId,ordinal:a.admitted,wallet:owner,stageId:s.id,drawCommitment:commitment,admittedAt:c.nowMs,costLamports:row.costLamports,priceLamports:s.priceLamports,termsDigest:s.termsDigest,membershipSourceId:f.membership.sourceId,fairPolicyHash,fairRegisteredMs,targetRound,contextDigest};
 return freeze({inventoryId:a.inventoryId,expectedAuthorityRevision:a.revision,admission:stored,operationJson:JSON.stringify({stageId:s.id,costLamports:{$lamports:s.costLamports},priceLamports:{$lamports:s.priceLamports}}),effects:{admitted:a.admitted+1,revision:a.revision+1},source:'local-fixture',executable:false});
}

/** Compute the private deterministic slot before one named reserved-asset read.
 * Never expose this result through member/public DTOs before reveal. */
export async function prepareNormalizedMintDraw(value,crypto,beaconVerifier){
 const {authority:raw,admission:rawAdmission,event,fairness,nowMs}=clone(value),a=authority(raw),row=admission(rawAdmission,a);
 fail(row.ordinal===a.fulfilled,'draw_out_of_order');
 fail(time(nowMs)&&exact(event,['inventoryId','operationId','commitment','provenance','atMs','proof'])&&event.inventoryId===a.inventoryId&&event.operationId===row.operationId&&event.commitment===row.drawCommitment&&time(event.atMs)&&event.atMs%1000===0&&event.atMs>=row.admittedAt&&event.atMs<=nowMs,'mint-evidence-binding');
 let ticket,traits,proofId,assetId=null,fairResult=null;
 if(row.fairPolicyHash===null){
  fail(event.provenance==='manual-fixture'&&fairness===null&&exact(event.proof,['proofId','assetId','ticket','traits'])&&id(event.proof.proofId)&&id(event.proof.assetId),'mint-manual-evidence-required');
  ({ticket,traits,proofId,assetId}=event.proof);
 }else{
  fail(event.provenance==='configured-offline-beacon'&&exact(fairness,['policy','request'])&&exact(fairness.policy,['policy_hash','registered_ms','traits'])&&fairness.policy.policy_hash===row.fairPolicyHash&&fairness.policy.registered_ms===row.fairRegisteredMs&&exact(fairness.request,['target_round','context_digest'])&&fairness.request.target_round===row.targetRound&&fairness.request.context_digest===row.contextDigest,'mint-configured-evidence-required');
  const derived=drawRequestPreimage(fairness.policy,{opId:row.operationId,kind:'mint',inventoryId:a.inventoryId,owner:row.wallet,commitment:row.drawCommitment,now:row.admittedAt});
  fail(derived.targetRound===row.targetRound&&event.atMs===roundTime(row.targetRound)&&await crypto.sha256(utf8(canonicalJson(derived.preimage)))===row.contextDigest,'mint-fair-request-conflict');
  const randomness=await verifyPinnedBeacon(event.proof,row.targetRound,crypto,beaconVerifier),seed=await crypto.sha256(utf8(canonicalJson(beaconSeedPreimage(row.contextDigest,randomness))));
  proofId=await crypto.sha256(utf8(canonicalJson(beaconProofPreimage(row.targetRound,seed))));
  fail(typeof fairness.policy.traits==='string'&&utf8(fairness.policy.traits).length<=524288,'mint-trait-policy-bound');const choices=validateTraitChoices(JSON.parse(fairness.policy.traits));traits={};
  for(const key of traitFields)traits[key]=pickTrait(choices[key],await uniformDraw(seed,key,choices[key].reduce((s,c)=>s+c.weight,0),crypto));
  ticket=await uniformDraw(seed,'initial-level',1000-a.fulfilled,crypto);
  fairResult={proofId,signedRoundJson:canonicalJson(event.proof),settledMs:nowMs};
 }
 fail(exact(traits,['model','backdrop','symbol'])&&Object.values(traits).every(v=>typeof v==='string'&&v.length>0&&v.length<=128&&v.trim()===v),'mint-traits-invalid');
 const level=drawLevel(a.remaining,ticket),ordinal=LEVEL_QUOTAS[level-1]-a.remaining[level-1],slotIndex=LEVEL_QUOTAS.slice(0,level-1).reduce((s,n)=>s+n,0)+ordinal;
 return freeze({inventoryId:a.inventoryId,operationId:row.operationId,commitment:row.drawCommitment,expectedAuthorityRevision:a.revision,proofId,provenance:event.provenance,atMs:event.atMs,ticket,traits:{model:traits.model,backdrop:traits.backdrop,symbol:traits.symbol},level,ordinal,slotIndex,assetId,fairResult});
}

/** Recomputes the draw from captured evidence; a supplied draw result is never
 * authority. All effects below are private and must commit in one guarded batch. */
export async function prepareNormalizedMintFulfillment(value,crypto,beaconVerifier){
 const input=clone(value),a=authority(input.authority),row=admission(input.admission,a),draw=await prepareNormalizedMintDraw(input,crypto,beaconVerifier);
 fail(exact(input.conflicts,['assetCount','slotCount','proofCount','snapshotCount'])&&Object.values(input.conflicts).every(n=>n===0),'mint-existing-asset-proof-or-snapshot');
 let assetId=draw.assetId;
 if(row.fairPolicyHash!==null){const r=input.reservedAsset;fail(exact(r,['inventoryId','slotIndex','assetId'])&&r.inventoryId===a.inventoryId&&r.slotIndex===draw.slotIndex,'mint-reserved-asset-binding');wallet(r.assetId);assetId=r.assetId;}
 else fail(input.reservedAsset===null,'mint-manual-reserved-asset-conflict');
 const remaining=[...a.remaining];remaining[draw.level-1]--;
 const slot=a.kind==='genesis'?{kind:'genesis',tranche:a.tranche,level:draw.level,ordinal:draw.ordinal}:{kind:'season',seasonId:a.inventoryId,slotIndex:draw.slotIndex};
 const nft={id:assetId,owner:row.wallet,level:draw.level,traits:draw.traits,version:0,rerolls:0,eligibleAt:0,pending:null,expiresAt:a.kind==='season'?seasonExpiry(a.seasonStart,draw.level):null};
 const fixture={operationId:row.operationId,commitment:row.drawCommitment,proofId:draw.proofId,at:draw.atMs,finalized:true,traits:draw.traits,ticket:draw.ticket,assetId};
 const vaultEvent={eventId:'collect:'+row.operationId,assetId,kind:'bind',at:new Date(draw.atMs).toISOString(),owner:row.wallet,slot};fail(id(vaultEvent.eventId),'mint-vault-event-id-bound');
 const effect={expectedAuthorityRevision:a.revision,admitted:a.admitted,fulfilled:a.fulfilled+1,remaining,authorityRevision:a.revision+1,admissionOrdinal:row.ordinal,asset:{id:assetId,inventoryId:a.inventoryId,owner:row.wallet,bindMs:draw.atMs,observedMs:draw.atMs,revealMs:null,slotJson:JSON.stringify(slot),assetJson:JSON.stringify(nft)},vaultEventJson:JSON.stringify(vaultEvent),operationReceiptJson:JSON.stringify({operationId:row.operationId,assetId,at:draw.atMs}),legacyEvidenceDigest:await crypto.sha256(utf8(JSON.stringify(['mint',row.operationId,assetId,draw.proofId,draw.atMs,draw.ticket,row.drawCommitment,draw.traits]))),fairResult:draw.fairResult?{...draw.fairResult,fixtureJson:canonicalJson(fixture)}:null,history:a.kind==='season'?[{assetId,effectiveMs:draw.atMs,level:draw.level,sourceRef:row.operationId}]:[]};
 fail(utf8(canonicalJson(effect)).length<=32768,'mint-effect-byte-bound');
 return freeze({result:{operationId:row.operationId,inventoryId:a.inventoryId,kind:'mint',assetId,at:draw.atMs,status:'fulfilled',provenance:draw.provenance,source:'local-fixture',executable:false},effect,fixture});
}
