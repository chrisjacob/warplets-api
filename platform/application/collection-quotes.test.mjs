import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createCollectionQuotePlanning} from './collection-quotes.mjs';
import {prepareProgression,visualRerollQuote} from '../domain/collections/progression.mjs';
import {seasonExpiry} from '../domain/collections/policy.mjs';
import {quoteProgression,readCollectionAsset} from '../collect/store.mjs';
import {createCollectionEdgeFixture} from './fixtures/collection-edges.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {encode58} from '../server/base58.mjs';
const crypto={sha256:async bytes=>createHash('sha256').update(bytes).digest('hex')},planning=createCollectionQuotePlanning({crypto}),policyVersion='synthetic-progression-v1';
const wallet=encode58(Buffer.alloc(32,7)),other=encode58(Buffer.alloc(32,8)),start=Date.UTC(2026,0,1),now=Date.UTC(2026,1,15);
function scene(kind='upgrade',level=1){
 const assets=['target',...(kind==='upgrade'?['material']:[])].map(id=>({id,inventoryId:'synthetic-season',owner:wallet,revealStatus:'revealed',level,traits:{model:'Synthetic',backdrop:'Synthetic',symbol:'Synthetic'},version:0,rerolls:0,eligibleAt:0,pending:null,expiresAt:seasonExpiry(start,level),ownerObservedAtMs:start}));
 return {quoteId:'synthetic-quote',principal:{kind:'wallet',wallet},inventoryId:'synthetic-season',policyVersion,nowMs:now,expiresMs:now+15000,context:{kind:'season',seasonId:'synthetic-season',start,assets},request:{kind,targetId:'target',expectedTargetVersion:0,...(kind==='upgrade'?{materialId:'material',expectedMaterialVersion:0}:{})}};
}
function command(q,nowMs=q.asOfMs+1000){return {principal:{kind:'wallet',wallet:q.wallet},operationKind:'collection.reserve-operation.v1',businessIdentity:'synthetic',requestKey:'synthetic-request',requestDigest:'a'.repeat(64),expectedRevisions:{source:'0'},nowMs,input:{kind:q.kind,inventoryId:q.inventoryId,targetId:q.targetId,materialId:q.materialId,expectedTargetVersion:q.targetVersion,expectedMaterialVersion:q.materialVersion,quoteId:q.id,bindingDigest:q.bindingDigest,policyVersion:q.policyVersion,reviewedFeeLamports:q.feeLamports,reviewedMaxTotalLamports:q.maxTotalLamports,quoteExpiresMs:q.expiresMs}};}
const options={operationId:'synthetic-operation',commitment:'synthetic-commitment',policyVersion};
async function rebound(quote){const value=structuredClone(quote);value.outcomesDigest=await crypto.sha256(utf8(canonicalJson(value.outcomes)));const {bindingDigest,...bound}=value;return {...bound,bindingDigest:await crypto.sha256(utf8(canonicalJson(bound)))};}
test('all upgrade Levels1–9 match existing Node preview and prepare exact two-asset transitions without changing history',async()=>{
 for(let level=1;level<=9;level++){
  const f=await createCollectionEdgeFixture({assetCount:2,seasonLevel:level});
  try{
   const targetId='synthetic-season-000',materialId='synthetic-season-001',request={kind:'upgrade',targetId,materialId,expectedTargetVersion:0,expectedMaterialVersion:0};
   const context={kind:'season',seasonId:f.seasonId,start:f.start,assets:[targetId,materialId].map(id=>{const row=f.db.prepare('SELECT * FROM collect_assets WHERE id=?').get(id);return {...JSON.parse(row.asset),inventoryId:row.inventory_id,revealStatus:'revealed',ownerObservedAtMs:Date.parse(readCollectionAsset(f.db,id).ownerObservedAt)};})};
   const old=quoteProgression(f.db,{inventoryId:f.seasonId,wallet:f.accounts.original.wallet,request,now:f.nowMs}),historical=f.historical();
   const quote=await planning.derive({quoteId:'synthetic-level-'+level,principal:{kind:'wallet',wallet:f.accounts.original.wallet},inventoryId:f.seasonId,request,context,policyVersion,nowMs:f.nowMs,expiresMs:f.nowMs+15000});
   assert.equal(quote.feeLamports,old.feeLamports);assert.equal(quote.outcomes.targetAfter.level,old.nextTargetLevel);assert.equal(new Date(quote.outcomes.targetAfter.expiresAtMs).toISOString(),old.nextTargetExpiry);
   assert.deepEqual(quote.outcomes.materialOutcomes.map(row=>({level:row.level,count:row.probabilityNumerator,total:row.probabilityDenominator,expiresAt:new Date(row.expiresAtMs).toISOString(),remainingMs:row.remainingMs})),old.materialProbabilities);
   const accepted=await planning.accept(command(quote),quote,context,options),raw=context.assets.map(({inventoryId,revealStatus,ownerObservedAtMs,...asset})=>asset),reference=prepareProgression({seasonId:f.seasonId,start:f.start,assets:raw,operations:[]},{...request,...options,signer:f.accounts.original.wallet,at:f.nowMs+1000});
   assert.deepEqual(accepted.assetWrites,[...reference.assets].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0));assert.deepEqual(accepted.operation,{...reference.operations[0],feeLamports:reference.operations[0].feeLamports.toString()});assert.equal(accepted.executable,false);assert.equal(f.historical(),historical);
  }finally{await f.close();}
 }
});
test('visual quotes retain Level and expiry, next fee/cooldown counters, and unknown network and total cost',async()=>{
 for(const rerolls of [0,1,2,10,20]){
  const input=scene('visual',5);input.context.assets[0].rerolls=rerolls;const quote=await planning.derive(input),reference=visualRerollQuote(rerolls,now);
  assert.equal(quote.feeLamports,reference.feeLamports.toString());assert.equal(quote.outcomes.cooldownMs,reference.cooldownMs);assert.equal(quote.outcomes.completedRerolls,rerolls);assert.equal(quote.outcomes.targetAfter.level,5);assert.equal(quote.outcomes.targetAfter.expiresAtMs,input.context.assets[0].expiresAt);
  assert.equal(quote.maxTotalLamports,quote.feeLamports);assert.equal(quote.ceilingScope,'disclosed-local-components-only');assert.equal(quote.totalCost,'unknown');assert.equal(quote.costQuote.network.amountLamports,null);assert.equal(quote.executable,false);
  const accepted=await planning.accept(command(quote),quote,input.context,options);assert.equal(accepted.assetWrites.length,1);assert.equal(accepted.assetWrites[0].level,5);assert.equal(accepted.assetWrites[0].rerolls,rerolls);assert.equal(accepted.assetWrites[0].pending,options.operationId);
 }
});
test('wrong actor/kind/participants/versions/policy/fee/ceiling/expiry and altered outcome terms are rejected',async()=>{
 const input=scene(),quote=await planning.derive({...input,maxTotalLamports:'10005000'}),base=command(quote);
 const changes=[c=>c.principal.wallet=other,c=>c.input.kind='visual',c=>c.input.targetId='changed',c=>c.input.materialId='changed',c=>c.input.expectedTargetVersion++,c=>c.input.expectedMaterialVersion++,c=>c.input.policyVersion='changed',c=>c.input.reviewedFeeLamports='0',c=>c.input.reviewedMaxTotalLamports='10005001',c=>c.input.quoteExpiresMs++,c=>c.nowMs=quote.expiresMs,c=>c.nowMs=quote.asOfMs-1];
 for(const change of changes){const c=structuredClone(base);change(c);await assert.rejects(planning.accept(c,quote,input.context,options));}
 await assert.rejects(planning.accept(base,quote,input.context,{...options,policyVersion:'new-policy'}),/policy/);
 const forged=structuredClone(quote);forged.outcomes.materialOutcomes[0].probabilityNumerator++;const altered=await rebound(forged);await assert.rejects(planning.accept(command(altered),altered,input.context,options),/outcomes-changed/);
 const repriced=structuredClone(quote);repriced.feeLamports='9999999';repriced.costQuote.items[0].amountLamports=repriced.feeLamports;const changedPrice=await rebound(repriced);await assert.rejects(planning.accept(command(changedPrice),changedPrice,input.context,options),/outcomes-changed/);
 await assert.rejects(planning.derive({...input,maxTotalLamports:'9999999'}),/below-fee/);await assert.rejects(planning.derive({...input,maxTotalLamports:'010000000'}),/invalid-local-ceiling/);
});
test('fresh source changes cannot reuse a stored quote even if the caller keeps its request digest',async()=>{
 const input=scene(),quote=await planning.derive(input),c=command(quote);
 for(const change of [context=>context.assets[0].owner=other,context=>context.assets[1].version++,context=>context.assets[0].pending='other-operation',context=>context.assets[1].revealStatus='unrevealed',context=>context.assets[0].traits.model='Changed',context=>context.start++,context=>context.kind='genesis']){
  const current=structuredClone(input.context);change(current);await assert.rejects(planning.accept(c,quote,current,options));
 }
 const shifted=structuredClone(input.context);for(const asset of shifted.assets){asset.level=2;asset.expiresAt=seasonExpiry(start,2);}await assert.rejects(planning.accept(c,quote,shifted,options),/local-ceiling-below-fee/);
 const missing=scene('visual');delete missing.context.assets[0].eligibleAt;await assert.rejects(planning.derive(missing),/missing-participant-cooldown/);
});
test('digest-await caller mutation cannot alter derived quote or acceptance plan',async()=>{
 const input=scene(),original=structuredClone(input);let once=true;
 const slow=createCollectionQuotePlanning({crypto:{sha256:async bytes=>{if(once){once=false;input.context.assets[0].owner=other;input.request.targetId='changed';input.principal.wallet=other;}return crypto.sha256(bytes);}}});
 const quote=await slow.derive(input);assert.equal(quote.wallet,wallet);assert.equal(quote.targetId,'target');assert.throws(()=>{quote.costQuote.network.amountLamports='0';},TypeError);
 const c=command(quote),stored=structuredClone(quote),current=structuredClone(original.context),ids={...options};once=true;
 const delayed=createCollectionQuotePlanning({crypto:{sha256:async bytes=>{if(once){once=false;c.input.reviewedFeeLamports='0';stored.outcomes.targetAfter.level=10;current.assets[0].owner=other;ids.commitment='changed';}return crypto.sha256(bytes);}}});
 const plan=await delayed.accept(c,stored,current,ids);assert.equal(plan.operation.signer,wallet);assert.equal(plan.operation.commitment,options.commitment);assert.equal(plan.assetWrites[0].owner,wallet);
});
test('elapsed quote lifetime preserves issuance outcomes but current-time domain bounds still apply',async()=>{
 const input=scene(),quote=await planning.derive(input);assert.equal(quote.outcomes.materialOutcomes[0].remainingMs,0);
 assert.equal((await planning.accept(command(quote,quote.expiresMs-1),quote,input.context,options)).status,'ready');
 const visual=scene('visual');visual.nowMs=8640000000000000-3600001;visual.expiresMs=8640000000000000;
 const nearLimit=await planning.derive(visual);await assert.rejects(planning.accept(command(nearLimit,visual.expiresMs-1),nearLimit,visual.context,options),error=>error.code==='reroll_quote_unrepresentable');
});
