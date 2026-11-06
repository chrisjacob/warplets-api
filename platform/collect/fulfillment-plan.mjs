import {canonicalJson,utf8} from '../security/canonical.mjs';
import {decode58} from '../server/base58.mjs';
import {applyVerifiedProgressionDraw,prepareProgression} from '../domain/collections/progression.mjs';
import {seasonExpiry} from '../domain/collections/policy.mjs';
import {drawRequestPreimage,roundTime} from '../randomness/request-plan.mjs';
import {materializeProgressionDraw} from '../randomness/portable-draw.mjs';
import {verifyPinnedBeacon} from '../beacon/portable.mjs';
const clone=v=>JSON.parse(canonicalJson(v));
const freeze=v=>{if(v&&typeof v==='object'){for(const child of Object.values(v))freeze(child);Object.freeze(v);}return v;};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const id=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
const time=v=>Number.isSafeInteger(v)&&v>=0&&v<=8640000000000000;
const natural=v=>Number.isSafeInteger(v)&&v>=0;
const fail=(c,code)=>{if(!c){const e=new TypeError(code);e.code=code;throw e;}};
function json(raw,max,code){fail(typeof raw==='string'&&utf8(raw).length<=max,code);let body;try{body=JSON.parse(raw);}catch{fail(false,code);}fail(JSON.stringify(body)===raw,code);return body;}
function wallet(value){try{decode58(value,32);}catch{fail(false,'fulfillment-wallet-invalid');}}
/** Fresh repository facts only; no supplied boolean represents verified chain
 * state. The trusted verifier checks configured entropy before pure domain math. */
export async function prepareCollectionFulfillment(value,crypto,beaconVerifier){
 const {input,event,operation:op,reservation:r,inventory,assets,vaults,owners,fairPolicy,fairRequest,existingFairResult,holdCount,snapshotConflict,nowMs}=clone(value);
 fail(op&&r&&inventory&&time(nowMs)&&time(event.atMs)&&event.atMs<=nowMs,'fulfillment-facts-unavailable');
 fail(holdCount===0,'operation-external-transfer-held');fail(op.settled_ms===null&&op.receipt===null&&op.proof_id===null&&op.evidence_digest===null,'operation-already-settled');
 fail(input.operationId===op.id&&event.operationId===op.id&&r.operation_id===op.id&&event.inventoryId===op.inventory_id&&inventory.id===op.inventory_id&&event.kind===op.kind&&event.commitment===op.commitment&&['upgrade','visual'].includes(op.kind),'fulfillment-operation-binding');
 const effectiveMs=event.provenance==='configured-offline-beacon'?nowMs:event.atMs;
 wallet(op.owner);fail(time(op.created_ms)&&op.created_ms<=event.atMs&&inventory.kind==='season'&&inventory.tranche===null&&time(inventory.season_start)&&inventory.season_start<=op.created_ms,'fulfillment-season-or-clock');
 fail(op.operation===r.operation_json,'fulfillment-reservation-operation');const body=json(op.operation,16384,'fulfillment-operation-json');
 fail(exact(body,['kind','operationId','commitment','signer','targetId','expectedTargetVersion','materialId','expectedMaterialVersion','preparedAt','feeLamports','result'])&&body.kind===op.kind&&body.operationId===op.id&&body.commitment===op.commitment&&body.signer===op.owner&&body.preparedAt===op.created_ms&&body.result===null&&id(body.targetId)&&body.targetId===r.target_id&&natural(body.expectedTargetVersion)&&exact(body.feeLamports,['$lamports'])&&typeof body.feeLamports.$lamports==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(body.feeLamports.$lamports)&&BigInt(body.feeLamports.$lamports)<=(1n<<64n)-1n,'fulfillment-operation-state');
 const ids=[body.targetId];if(op.kind==='upgrade'){fail(id(body.materialId)&&body.materialId!==body.targetId&&body.materialId===r.material_id&&natural(body.expectedMaterialVersion),'fulfillment-material-binding');ids.push(body.materialId);}else fail(body.materialId===null&&body.expectedMaterialVersion===null&&r.material_id===null&&r.material_after_json===null,'fulfillment-unexpected-material');
 fail(assets.length===ids.length&&vaults.length===ids.length&&owners.length===ids.length&&new Set(assets.map(a=>a.id)).size===ids.length&&new Set(vaults.map(a=>a.id)).size===ids.length&&new Set(owners.map(a=>a.asset_id)).size===ids.length,'fulfillment-participants-missing');
 const current=ids.map((assetId,index)=>{
  const a=assets.find(a=>a.id===assetId),v=vaults.find(v=>v.id===assetId),o=owners.find(o=>o.asset_id===assetId);fail(a&&v&&o&&a.inventory_id===inventory.id&&a.owner===op.owner&&v.owner===op.owner,'fulfillment-owner-conflict');
  fail(time(a.bind_ms)&&a.bind_ms>=inventory.season_start&&time(a.observed_ms)&&a.bind_ms<=a.observed_ms&&a.observed_ms>=op.created_ms&&a.observed_ms<=effectiveMs&&time(a.reveal_ms)&&a.reveal_ms>=a.bind_ms&&a.reveal_ms<=a.observed_ms&&time(v.latest_ms)&&v.latest_ms<=effectiveMs,'fulfillment-participant-clock');
  fail(a.asset===(index===0?r.target_after_json:r.material_after_json),'fulfillment-reservation-lock-changed');const nft=json(a.asset,16384,'fulfillment-asset-json');
  fail(exact(nft,['id','owner','level','traits','version','rerolls','eligibleAt','pending','expiresAt'])&&nft.id===a.id&&nft.owner===op.owner&&natural(nft.version)&&nft.version===(index===0?body.expectedTargetVersion:body.expectedMaterialVersion)+1&&nft.pending===op.id&&Number.isInteger(nft.level)&&nft.level>=1&&nft.level<=10&&natural(nft.rerolls)&&time(nft.eligibleAt)&&nft.expiresAt===seasonExpiry(inventory.season_start,nft.level),'fulfillment-asset-state');
  fail(exact(nft.traits,['model','backdrop','symbol'])&&Object.values(nft.traits).every(x=>typeof x==='string'&&x.length>0&&x.length<=128&&x.trim()===x),'fulfillment-current-traits');
  const slot=json(a.slot,4096,'fulfillment-slot'),coords=json(v.coords,4096,'fulfillment-vault-coordinates'),slotKey=json(v.slot_key,4096,'fulfillment-vault-slot');fail(exact(slot,['kind','seasonId','slotIndex'])&&slot.kind==='season'&&slot.seasonId===inventory.id&&Number.isInteger(slot.slotIndex)&&slot.slotIndex>=0&&slot.slotIndex<1000&&canonicalJson(slot)===canonicalJson(coords)&&canonicalJson(slot)===canonicalJson(slotKey),'fulfillment-slot-conflict');
  const owner=json(o.body,4096,'fulfillment-owner-evidence');fail(time(o.observed_ms)&&o.observed_ms>=a.bind_ms&&o.observed_ms<=a.observed_ms&&o.observed_ms<=v.latest_ms&&id(o.event_id)&&owner.eventId===o.event_id&&owner.assetId===a.id&&['bind','transfer'].includes(o.kind)&&owner.kind===o.kind&&owner.at===new Date(o.observed_ms).toISOString()&&(o.kind==='bind'?owner.owner:owner.to)===op.owner,'fulfillment-owner-evidence-conflict');
  return {a,v,nft};
 });
 // Re-derive the original reservation with the shared domain planner, using
 // the immutable locked versions; this checks original fee and cooldown math
 // without introducing another formula or changing any current authority.
 const original=prepareProgression({seasonId:inventory.id,start:inventory.season_start,assets:current.map(({nft},index)=>({...nft,pending:null,version:index===0?body.expectedTargetVersion:body.expectedMaterialVersion})),operations:[]},{...body,at:op.created_ms}),fee=original.operations[0].feeLamports;
 fail(canonicalJson({...original.operations[0],feeLamports:{$lamports:fee.toString()}})===canonicalJson(body)&&canonicalJson(original.assets)===canonicalJson(current.map(x=>x.nft)),'fulfillment-original-reservation-conflict');
 if(op.kind==='upgrade')fail(current[0].nft.level<10&&current[0].nft.level===current[1].nft.level&&!snapshotConflict,'historical-snapshot-or-upgrade-conflict');
 let fixture,fairResult=null;
 if(r.fair_policy_hash!==null){
  fail(event.provenance==='configured-offline-beacon'&&fairPolicy&&fairRequest&&fairPolicy.policy_hash===r.fair_policy_hash&&fairPolicy.registered_ms===r.fair_registered_ms&&fairRequest.target_round===r.target_round&&fairRequest.context_digest===r.context_digest&&time(fairPolicy.registered_ms),'fulfillment-configured-fairness-required');
  const derived=drawRequestPreimage(fairPolicy,{opId:op.id,kind:op.kind,inventoryId:op.inventory_id,owner:op.owner,commitment:op.commitment,now:op.created_ms});fail(derived.targetRound===fairRequest.target_round&&await crypto.sha256(utf8(canonicalJson(derived.preimage)))===fairRequest.context_digest&&event.atMs===roundTime(fairRequest.target_round),'fulfillment-fair-request-conflict');
  const entropy=await verifyPinnedBeacon(event.proof,fairRequest.target_round,crypto,beaconVerifier);let choices={};if(op.kind==='visual')choices=json(fairPolicy.traits,524288,'fulfillment-fair-policy-traits');
  fixture=await materializeProgressionDraw({operation:op,request:fairRequest,randomness:entropy,traitChoices:choices},crypto);
  fairResult={proofId:fixture.proofId,signedRoundJson:canonicalJson(event.proof),fixtureJson:canonicalJson(fixture),settledMs:nowMs};
  if(existingFairResult)fail(existingFairResult.operation_id===op.id&&existingFairResult.proof_id===fairResult.proofId&&existingFairResult.signed_round===fairResult.signedRoundJson&&existingFairResult.fixture===fairResult.fixtureJson&&time(existingFairResult.settled_ms)&&existingFairResult.settled_ms>=event.atMs&&existingFairResult.settled_ms<=nowMs,'fulfillment-existing-fair-result-conflict');
  if(existingFairResult)fairResult.settledMs=existingFairResult.settled_ms;
 }else{
  fail(event.provenance==='manual-fixture'&&fairPolicy===null&&fairRequest===null&&existingFairResult===null&&r.fair_registered_ms===null&&r.target_round===null&&r.context_digest===null,'fulfillment-manual-fairness-unavailable');
  fixture={operationId:op.id,commitment:op.commitment,proofId:event.proof.proofId,at:event.atMs,finalized:true,...(op.kind==='upgrade'?{ticket:event.proof.ticket}:{traits:event.proof.traits})};
 }
 const effectFixture={...fixture,at:effectiveMs};
 const next=applyVerifiedProgressionDraw({seasonId:inventory.id,start:inventory.season_start,assets:current.map(x=>x.nft),operations:[{...body,feeLamports:fee}]},effectFixture),writes=current.map(({a,v})=>({id:a.id,beforeJson:a.asset,afterJson:JSON.stringify(next.assets.find(nft=>nft.id===a.id)),beforeObservedMs:a.observed_ms,slotJson:a.slot,vaultOwner:v.owner,vaultLatestMs:v.latest_ms,vaultCoordsJson:v.coords,vaultSlotKey:v.slot_key,bindMs:a.bind_ms,revealMs:a.reveal_ms}));
 fail(writes.every(w=>utf8(w.afterJson).length<=16384),'fulfillment-asset-output-bound');
 const legacyOutput=op.kind==='upgrade'?fixture.ticket:{model:fixture.traits.model,backdrop:fixture.traits.backdrop,symbol:fixture.traits.symbol};
 const operationReceiptJson=JSON.stringify({operationId:op.id,assetId:body.targetId,materialId:body.materialId,at:effectiveMs}),legacyEvidenceDigest=await crypto.sha256(utf8(JSON.stringify([op.kind,op.id,op.commitment,fixture.proofId,effectiveMs,legacyOutput])));
 const history=op.kind==='upgrade'?next.assets.map(a=>({assetId:a.id,effectiveMs,level:a.level,sourceRef:op.id})):[];
 const result={operationId:op.id,inventoryId:inventory.id,kind:op.kind,targetId:body.targetId,materialId:body.materialId,proofId:fixture.proofId,effectiveMs,status:'fulfilled',provenance:event.provenance,evidenceReceiptId:input.evidenceReceiptId,source:'local-fixture',executable:false};
 const effect={target:writes[0],material:writes[1]??null,operationReceiptJson,legacyEvidenceDigest,fairResult,history};fail(utf8(canonicalJson(effect)).length<=131072,'fulfillment-effect-byte-bound');return freeze({result,effect,fixture:effectFixture});
}
