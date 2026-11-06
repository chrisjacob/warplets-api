import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../storage/database.mjs';
import {createCollection,publishCollectionStage} from './store.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {prepareStagePublication,normalizeStagePublication} from './stage-plan.mjs';
import {encode58} from '../server/base58.mjs';
const crypto=createNodeCrypto(),start=Date.parse('2026-11-01T00:00:00.000Z'),day=86400000;
const wallets=Array.from({length:3},(_,i)=>encode58(Uint8Array.from({length:32},(_,j)=>i+j+1))).sort();
const initial={inventoryId:'synthetic-stage-genesis',stageId:'synthetic-whitelist',type:'whitelist',publishedAt:start,opensAt:start+2*day,closesAt:start+3*day,priceLamports:'100000000',costLamports:'500000',allocation:1000,walletLimit:null,founderApproved:false,approvedSpendLamports:null,ballotId:null,inventoryOverrideReason:null,eligibilityListId:'a'.repeat(64),sourceKind:'synthetic-local-operator-fixture'};
const fact=(i=initial,patch={})=>({header:{id:i.inventoryId,kind:'genesis',tranche:1,seasonStart:null,revision:0},stages:[],nowMs:start,eligibility:{id:i.eligibilityListId,wallets},previous:null,ballot:null,...patch});
const legacyInput=i=>({inventoryId:i.inventoryId,stage:{id:i.stageId,type:i.type,publishedAt:i.publishedAt,opensAt:i.opensAt,closesAt:i.closesAt,priceLamports:i.priceLamports,costLamports:i.costLamports,allocation:i.allocation,...(i.walletLimit===null?{}:{walletLimit:i.walletLimit}),founderApproved:i.founderApproved,...(i.approvedSpendLamports===null?{}:{approvedSpendLamports:i.approvedSpendLamports}),ballotId:i.ballotId,inventoryOverrideReason:i.inventoryOverrideReason,wallets:i.eligibilityListId===null?[]:wallets}});
test('bounded stage plan preserves exact legacy terms digest and domain fields without retaining membership array',async t=>{
 const db=openDatabase();t.after(()=>db.close());createCollection(db,{id:initial.inventoryId,kind:'genesis',tranche:1});
 const plan=await prepareStagePublication(initial,fact(),crypto);publishCollectionStage(db,legacyInput(initial),start);
 const legacy=JSON.parse(db.prepare('SELECT state FROM collect_inventories WHERE id=?').get(initial.inventoryId).state).stages[0],{wallets:ignored,...expected}=legacy;
 assert.deepEqual(plan.stage,expected);assert.equal(plan.stage.walletLimit,1);assert.deepEqual(plan.eligibility,{kind:'list',listId:initial.eligibilityListId,count:3});
 assert.doesNotMatch(JSON.stringify(plan),new RegExp(wallets[0]));assert.equal(plan.executable,false);
 const listChanged=await prepareStagePublication(initial,fact(initial,{eligibility:{id:initial.eligibilityListId,wallets:wallets.slice(0,2)}}),crypto);assert.notEqual(listChanged.stage.termsDigest,plan.stage.termsDigest);
});
test('publication preserves initial price, notice, approval, typed source and exact list requirements',async()=>{
 for(const [change,reason] of [[{priceLamports:'999'},'initial_genesis_price'],[{opensAt:start+day},'insufficient_genesis_notice'],[{type:'public',eligibilityListId:null},'public_stage_requires_approval'],[{publishedAt:start+1},'future_publication']]){
  const i={...initial,...change};await assert.rejects(()=>prepareStagePublication(i,fact(i,{eligibility:i.eligibilityListId===null?null:{id:i.eligibilityListId,wallets}}),crypto),new RegExp(reason));
 }
 assert.throws(()=>normalizeStagePublication({...initial,priceLamports:null}),/invalid_units/);assert.throws(()=>normalizeStagePublication({...initial,sourceKind:'live-chain'}),/stage_source_kind/);
 assert.throws(()=>normalizeStagePublication({...initial,clock:start}),/invalid_stage_publication/);assert.throws(()=>normalizeStagePublication({...initial,type:'free'}),/eligibility_binding/);
 await assert.rejects(()=>prepareStagePublication(initial,fact(initial,{eligibility:null}),crypto),/stage_list_unavailable/);
 await assert.rejects(()=>prepareStagePublication(initial,fact(initial,{eligibility:{id:initial.eligibilityListId,wallets:[wallets[0],wallets[0]]}}),crypto),/stage_list_order/);
});
test('Season free publication requires both closed paid phases and leaves membership pending until the opening cut',async()=>{
 const i={...initial,inventoryId:'synthetic-stage-season',stageId:'synthetic-free',type:'free',priceLamports:'0',eligibilityListId:null,opensAt:start+4*day,closesAt:start+5*day},header={id:i.inventoryId,kind:'season',tranche:null,seasonStart:start,revision:2};
 const stages=[{id:'paid-one',type:'whitelist',closesAt:start+2*day},{id:'paid-two',type:'whitelist',closesAt:start+3*day}],facts=fact(i,{header,stages,eligibility:null});
 const result=await prepareStagePublication(i,facts,crypto);assert.deepEqual(result.eligibility,{kind:'pending',listId:null,count:null});assert.equal(result.stage.walletLimit,1);
 await assert.rejects(()=>prepareStagePublication(i,{...facts,stages:stages.slice(0,1)},crypto),/paid_stages_incomplete/);
 await assert.rejects(()=>prepareStagePublication(i,{...facts,stages:[...stages,{id:'still-open',type:'whitelist',closesAt:i.opensAt+1}]},crypto),/paid_stages_incomplete/);
 await assert.rejects(()=>prepareStagePublication({...i,opensAt:start-1},facts,crypto),/stage_before_season/);
});
test('next-tranche publication binds the prior opening ballot while actual opening and unsold holds remain admission predicates',async()=>{
 const i={...initial,inventoryId:'synthetic-stage-genesis-two',ballotId:'synthetic-prior-ballot',priceLamports:'200000000'},facts=fact(i,{header:{id:i.inventoryId,kind:'genesis',tranche:2,seasonStart:null,revision:0},previous:{tranche:1,openings:[start-4*day,start-2*day]},ballot:{id:i.ballotId,trancheOpeningMs:start-4*day}});
 const plan=await prepareStagePublication(i,facts,crypto);assert.equal(plan.stage.ballotId,i.ballotId);assert.equal(plan.stage.priceLamports.$lamports,'200000000');
 await assert.rejects(()=>prepareStagePublication(i,{...facts,ballot:{...facts.ballot,trancheOpeningMs:start}},crypto),/wrong_ballot/);
 await assert.rejects(()=>prepareStagePublication(i,{...facts,previous:null},crypto),/missing_previous_tranche/);
});
