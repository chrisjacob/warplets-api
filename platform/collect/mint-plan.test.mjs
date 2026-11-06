import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {canonicalJson} from '../security/canonical.mjs';
import {encode58} from '../server/base58.mjs';
import {openDatabase} from '../storage/database.mjs';
import {createCollection,fulfillMint} from './store.mjs';
import {createInventory,publishStage,admitMint,applyVerifiedMintDraw} from '../domain/collections/inventory.mjs';
import {LEVEL_QUOTAS,seasonExpiry} from '../domain/collections/policy.mjs';
import {materializeDraw,sha} from '../randomness/selection.mjs';
import {roundTime,leadMs} from '../randomness/request-plan.mjs';
import {prepareNormalizedMintAdmission,prepareNormalizedMintDraw,prepareNormalizedMintFulfillment} from './mint-plan.mjs';

const crypto=createNodeCrypto(),start=Date.parse('2026-11-01T00:00:00Z'),day=86400000;
const wallet=i=>encode58(Uint8Array.from({length:32},(_,j)=>(i>>((j%4)*8))&255));
const traits={model:'Synthetic model',backdrop:'Synthetic backdrop',symbol:'Synthetic symbol'};
const proof=JSON.parse(readFileSync(new URL('../beacon/fixtures/round-30000000.json',import.meta.url)));
const encode=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?{$lamports:String(x)}:x);
function sample({kind='genesis',type='whitelist',tranche=1,nowMs=start+2*day}={}){
 const a={inventoryId:'synthetic-mint-'+kind,kind,tranche:kind==='genesis'?tranche:null,seasonStart:kind==='season'?start:null,revision:1,admitted:0,fulfilled:0,remaining:[...LEVEL_QUOTAS]},s={id:'synthetic-stage',type,opensAt:nowMs,closesAt:nowMs+day,allocation:1000,walletLimit:kind==='genesis'?1:1000,priceLamports:type==='founder'?'0':'100000000',costLamports:'500000',approvedSpendLamports:type==='founder'?'500000':null,termsDigest:'a'.repeat(64)};
 return {command:{operationKind:'collection.reserve-operation.v1',principal:type==='founder'?{kind:'operator',id:'synthetic-founder'}:{kind:'wallet',wallet:wallet(1)},nowMs,input:{kind:'mint',inventoryId:a.inventoryId,stageId:s.id,expectedTermsDigest:s.termsDigest,...(type==='founder'?{wallet:wallet(1)}:{})}},facts:{authority:a,stage:s,sourceKind:'synthetic-local-operator-fixture',stageAdmissionCount:0,walletAdmissionCount:0,founderSpentLamports:'0',membership:{wallet:wallet(1),stageId:s.id,eligible:true,sourceId:type==='public'?null:'b'.repeat(64)},opening:null,commitmentUsed:false,fairPolicy:null},operationId:'synthetic-mint-op',commitment:'synthetic-mint-commitment'};
}
async function fulfillment(input=sample(),{ticket=999,atMs=input.command.nowMs+1000}={}){
 const planned=await prepareNormalizedMintAdmission(input,crypto);
 return {authority:{...input.facts.authority,revision:planned.effects.revision,admitted:planned.effects.admitted},admission:planned.admission,event:{inventoryId:planned.inventoryId,operationId:planned.admission.operationId,commitment:planned.admission.drawCommitment,provenance:'manual-fixture',atMs,proof:{proofId:'synthetic-mint-proof',assetId:'synthetic-minted-asset',ticket,traits}},fairness:null,nowMs:atMs,reservedAsset:null,conflicts:{assetCount:0,slotCount:0,proofCount:0,snapshotCount:0},admissionPlan:planned};
}

test('bounded normalized admission and ordered fulfillment match the reference reducer for all 1000 initial slots',async()=>{
 const input=sample({type:'public'}),s=input.facts.stage;
 let full=publishStage(createInventory({id:input.facts.authority.inventoryId,kind:'genesis',tranche:1}),{...s,publishedAt:start,priceLamports:BigInt(s.priceLamports),founderApproved:true}),a=input.facts.authority;
 const plans=[];
 for(let i=0;i<1000;i++){
  const owner=wallet(i+1),v=structuredClone(input);v.facts.authority=a;v.command.principal.wallet=owner;v.facts.membership.wallet=owner;v.facts.stageAdmissionCount=i;v.operationId='synthetic-op-'+i;v.commitment='synthetic-commitment-'+i;
  const p=await prepareNormalizedMintAdmission(v,crypto);full=admitMint(full,{operationId:v.operationId,wallet:owner,stageId:s.id,at:v.command.nowMs,drawCommitment:v.commitment,costLamports:BigInt(s.costLamports)});
  const {ordinal,priceLamports,termsDigest,membershipSourceId,fairPolicyHash,fairRegisteredMs,targetRound,contextDigest,...actual}=p.admission;
  assert.deepEqual({...actual,costLamports:BigInt(actual.costLamports),level:null,proofId:null,ticket:null},full.admissions[i]);assert.equal(ordinal,i);plans.push(p.admission);a={...a,admitted:p.effects.admitted,revision:p.effects.revision};
 }
 const levels=Array(10).fill(0),slots=new Set();
 for(let i=0;i<1000;i++){
  const row=plans[i],ticket=(i*71)%(1000-i),event={inventoryId:a.inventoryId,operationId:row.operationId,commitment:row.drawCommitment,provenance:'manual-fixture',atMs:input.command.nowMs+1000,proof:{proofId:'synthetic-proof-'+i,assetId:'synthetic-asset-'+i,ticket,traits}},p=await prepareNormalizedMintFulfillment({authority:a,admission:row,event,fairness:null,nowMs:event.atMs,reservedAsset:null,conflicts:{assetCount:0,slotCount:0,proofCount:0,snapshotCount:0}},crypto,null);
  full=applyVerifiedMintDraw(full,{operationId:row.operationId,drawCommitment:row.drawCommitment,proofId:event.proof.proofId,ticket});assert.deepEqual(p.effect.remaining,full.remaining);assert.equal(JSON.parse(p.effect.asset.assetJson).level,full.admissions[i].level);assert.equal(p.effect.fulfilled,full.fulfilled);levels[full.admissions[i].level-1]++;slots.add(p.effect.asset.slotJson);a={...a,fulfilled:p.effect.fulfilled,remaining:p.effect.remaining,revision:p.effect.authorityRevision};
 }
 assert.deepEqual(levels,LEVEL_QUOTAS);assert.equal(slots.size,1000);assert.equal(a.fulfilled,1000);assert.deepEqual(a.remaining,Array(10).fill(0));
});

test('stage prices, budgets, wallet limits, membership, time windows and founder lane remain exact',async()=>{
 for(const [mutate,code] of [[v=>v.command.nowMs--,'stage_unavailable'],[v=>v.command.nowMs=v.facts.stage.closesAt,'stage_unavailable'],[v=>v.facts.membership.eligible=false,'wallet_ineligible'],[v=>v.facts.membership.sourceId=null,'mint-membership-source'],[v=>v.facts.walletAdmissionCount=1,'invalid_admission_facts'],[v=>{v.facts.authority.admitted=1;v.facts.stageAdmissionCount=1;v.facts.walletAdmissionCount=1;},'stage_wallet_limit'],[v=>v.facts.commitmentUsed=true,'duplicate_draw_commitment'],[v=>v.facts.stage.priceLamports=null,'mint-units-invalid'],[v=>v.command.input.priceLamports='0','mint-command-binding'],[v=>{v.facts.stage.type='founder';v.facts.stage.priceLamports='0';},'mint-founder-budget-missing']]){
  const v=sample();mutate(v);await assert.rejects(prepareNormalizedMintAdmission(v,crypto),e=>e.code===code||e.message.includes(code));
 }
 const founder=sample({kind:'season',type:'founder'}),p=await prepareNormalizedMintAdmission(founder,crypto);assert.equal(p.admission.priceLamports,'0');assert.equal(p.admission.costLamports,'500000');assert.equal(p.executable,false);founder.facts.founderSpentLamports='1';await assert.rejects(prepareNormalizedMintAdmission(founder,crypto),/founder_budget_exceeded/);
 const invalid=sample({kind:'season',type:'founder'});invalid.command.principal={kind:'wallet',wallet:wallet(1)};delete invalid.command.input.wallet;await assert.rejects(prepareNormalizedMintAdmission(invalid,crypto),/mint-principal-lane/);
 const free=sample({kind:'season',type:'free'});free.facts.stage.priceLamports='0';await assert.rejects(prepareNormalizedMintAdmission(free,crypto),/mint-free-cut-pending/);
});

test('first admission for a later Genesis tranche requires the bound decision and exhausted prior tranche or explicit override',async()=>{
 const v=sample({tranche:2});await assert.rejects(prepareNormalizedMintAdmission(v,crypto),/mint-tranche-opening-pending/);
 v.facts.opening={firstStage:{ballotId:'synthetic-ballot',inventoryOverrideReason:null},decision:{ballotId:'synthetic-ballot',earliestMs:v.command.nowMs},previous:{tranche:1,admitted:999}};
 await assert.rejects(prepareNormalizedMintAdmission(v,crypto),/mint-previous-tranche-unsold/);v.facts.opening.previous.admitted=1000;await prepareNormalizedMintAdmission(v,crypto);
 v.facts.opening.previous.admitted=1;v.facts.opening.firstStage.inventoryOverrideReason='Synthetic founder override';await prepareNormalizedMintAdmission(v,crypto);
 v.facts.opening.decision.earliestMs++;await assert.rejects(prepareNormalizedMintAdmission(v,crypto),/mint-tranche-opening-pending/);
});

test('mint effects preserve exact legacy asset, slot, Vault event, receipt and digest bytes for Genesis and Season',async t=>{
 for(const kind of ['genesis','season']){
  const input=sample({kind}),v=await fulfillment(input),p=await prepareNormalizedMintFulfillment(v,crypto,null),db=openDatabase();t.after(()=>db.close());createCollection(db,{id:v.authority.inventoryId,kind,...(kind==='genesis'?{tranche:1}:{seasonStart:start})});
  let state=createInventory({id:v.authority.inventoryId,kind,tranche:kind==='genesis'?1:undefined});state={...state,stages:[{...input.facts.stage,priceLamports:100000000n,costLamports:500000n,wallets:[wallet(1)]}]};state=admitMint(state,{operationId:v.admission.operationId,wallet:v.admission.wallet,stageId:v.admission.stageId,at:v.admission.admittedAt,drawCommitment:v.admission.drawCommitment,costLamports:500000n});
  db.prepare('UPDATE collect_inventories SET state=?,revision=? WHERE id=?').run(encode(state),state.version,v.authority.inventoryId);
  db.prepare('INSERT INTO collect_operations(id,kind,inventory_id,owner,request_key,request_digest,commitment,created_ms,operation) VALUES(?,?,?,?,?,?,?,?,?)').run(v.admission.operationId,'mint',v.authority.inventoryId,v.admission.wallet,'synthetic-request','a'.repeat(64),v.admission.drawCommitment,v.admission.admittedAt,v.admissionPlan.operationJson);
  fulfillMint(db,p.fixture,v.nowMs);const asset=db.prepare('SELECT * FROM collect_assets WHERE id=?').get(p.result.assetId),op=db.prepare('SELECT * FROM collect_operations WHERE id=?').get(v.admission.operationId),event=db.prepare('SELECT body FROM vault_observations WHERE asset_id=?').get(asset.id);
  assert.equal(asset.asset,p.effect.asset.assetJson);assert.equal(asset.slot,p.effect.asset.slotJson);assert.equal(op.receipt,p.effect.operationReceiptJson);assert.equal(op.evidence_digest,p.effect.legacyEvidenceDigest);assert.equal(event.body,p.effect.vaultEventJson);assert.equal(asset.reveal_ms,null);assert.equal(p.effect.history.length,kind==='season'?1:0);if(kind==='season')assert.equal(JSON.parse(asset.asset).expiresAt,seasonExpiry(start,10));
  assert.doesNotMatch(JSON.stringify(p.result),/traits|level|slot|ticket|commitment|proofId/);
 }
});

test('ordered draws fail closed for corrupt counters, duplicate/occupied effects and changed evidence identity',async()=>{
 const v=await fulfillment();
 for(const [mutate,code] of [[x=>x.authority.remaining[0]--,'mint-remaining-conflict'],[x=>{x.authority.admitted=2;x.admission.ordinal=1;},'draw_out_of_order'],[x=>x.event.commitment='changed','mint-evidence-binding'],[x=>x.event.atMs=x.nowMs+1000,'mint-evidence-binding'],[x=>x.event.atMs++,'mint-evidence-binding'],[x=>x.event.proof.ticket=1000,'invalid_draw_ticket'],[x=>x.event.proof.traits.level=10,'mint-traits-invalid'],[x=>x.conflicts.assetCount=1,'mint-existing-asset-proof-or-snapshot'],[x=>x.conflicts.slotCount=1,'mint-existing-asset-proof-or-snapshot'],[x=>x.conflicts.proofCount=1,'mint-existing-asset-proof-or-snapshot'],[x=>x.conflicts.snapshotCount=1,'mint-existing-asset-proof-or-snapshot']]){const x=structuredClone(v);mutate(x);await assert.rejects(prepareNormalizedMintFulfillment(x,crypto,null),e=>e.code===code||e.message.includes(code));}
});

test('configured draw uses the unchanged pinned request and legacy seed/ticket/traits/slot, with no fallback',async t=>{
 const nowMs=roundTime(proof.round)-leadMs,v0=sample({nowMs});v0.facts.fairPolicy={policy_hash:'c'.repeat(64),registered_ms:nowMs-1000};const p=await prepareNormalizedMintAdmission(v0,crypto),choices=Object.fromEntries(['model','backdrop','symbol'].map(k=>[k,[{name:'Synthetic '+k+' one',weight:2},{name:'Synthetic '+k+' two',weight:1}]])),v={authority:{...v0.facts.authority,revision:p.effects.revision,admitted:1},admission:p.admission,event:{inventoryId:p.inventoryId,operationId:p.admission.operationId,commitment:p.admission.drawCommitment,provenance:'configured-offline-beacon',atMs:roundTime(proof.round),proof},fairness:{policy:{...v0.facts.fairPolicy,traits:canonicalJson(choices)},request:{target_round:p.admission.targetRound,context_digest:p.admission.contextDigest}},nowMs:roundTime(proof.round)+day,conflicts:{assetCount:0,slotCount:0,proofCount:0,snapshotCount:0}};
 await assert.rejects(prepareNormalizedMintDraw(v,crypto,null),/verifier unavailable/);await assert.rejects(prepareNormalizedMintDraw(v,crypto,{verifyShortSignature:()=>false}),/verification failed/);
 // Trusted-port fixture only; this is not new BLS verification evidence.
 const verifier={verifyShortSignature:()=>true},draw=await prepareNormalizedMintDraw(v,crypto,verifier);v.reservedAsset={inventoryId:v.authority.inventoryId,slotIndex:draw.slotIndex,assetId:wallet(draw.slotIndex+5000)};
 const plan=await prepareNormalizedMintFulfillment(v,crypto,verifier),db=openDatabase();t.after(()=>db.close());createCollection(db,{id:v.authority.inventoryId,kind:'genesis',tranche:1});db.prepare('UPDATE collect_inventories SET state=? WHERE id=?').run(JSON.stringify({fulfilled:0,admissions:[{operationId:v.admission.operationId}],remaining:LEVEL_QUOTAS}),v.authority.inventoryId);db.prepare('INSERT INTO fair_inventories VALUES(?,?,?,?)').run(v.authority.inventoryId,v.fairness.policy.policy_hash,v.fairness.policy.traits,v.fairness.policy.registered_ms);db.prepare('INSERT INTO fair_reserved_assets VALUES(?,?,?)').run(v.authority.inventoryId,draw.slotIndex,v.reservedAsset.assetId);
 const reference=materializeDraw(db,{id:v.admission.operationId,kind:'mint',inventory_id:v.authority.inventoryId,commitment:v.admission.drawCommitment},v.fairness.request,proof.randomness,v.event.atMs);assert.deepEqual(plan.fixture,reference);assert.equal(plan.effect.fairResult.fixtureJson,canonicalJson(reference));assert.equal(plan.result.at,v.event.atMs);assert.equal(plan.effect.fairResult.settledMs,v.nowMs);
 const x=structuredClone(v);x.reservedAsset.slotIndex=(draw.slotIndex+1)%1000;await assert.rejects(prepareNormalizedMintFulfillment(x,crypto,verifier),/mint-reserved-asset-binding/);
 const manual=structuredClone(v);manual.event.provenance='manual-fixture';await assert.rejects(prepareNormalizedMintDraw(manual,crypto,verifier),/mint-configured-evidence-required/);
 const changed=structuredClone(v);changed.fairness.request.context_digest=sha(['changed']);await assert.rejects(prepareNormalizedMintDraw(changed,crypto,verifier),/mint-configured-evidence-required/);
});

test('capture precedes every await and private outputs are deeply frozen',async()=>{
 const input=sample();input.facts.fairPolicy={policy_hash:'c'.repeat(64),registered_ms:input.command.nowMs-1000};let mutated=false;
 const planned=await prepareNormalizedMintAdmission(input,{...crypto,async sha256(bytes){if(!mutated){mutated=true;input.command.principal.wallet=wallet(999);input.facts.stage.costLamports='0';input.facts.authority.admitted=999;}return crypto.sha256(bytes);}});assert.equal(planned.admission.wallet,wallet(1));assert.equal(planned.admission.costLamports,'500000');assert.equal(planned.admission.ordinal,0);assert.ok(Object.isFrozen(planned.admission));
 const v=structuredClone(await fulfillment());let changed=false;const p=await prepareNormalizedMintFulfillment(v,{...crypto,async sha256(bytes){if(!changed){changed=true;v.admission.wallet=wallet(2);v.event.proof.traits.model='Changed';v.conflicts.assetCount=1;}return crypto.sha256(bytes);}},null);assert.equal(p.effect.asset.owner,wallet(1));assert.equal(JSON.parse(p.effect.asset.assetJson).traits.model,traits.model);assert.ok(Object.isFrozen(p.effect.remaining));
});
