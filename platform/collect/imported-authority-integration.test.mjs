import test from 'node:test';
import assert from 'node:assert/strict';
import {preparedAdoptionFixture,adoptionPrincipal} from './legacy-adoption-activation.fixtures.mjs';
import {createMintReservationRepository} from './mint-repository.mjs';
import {createMintReservationService} from './mint-service.mjs';
import {createStagePublicationRepository} from './stage-repository.mjs';
import {createStagePublicationService} from './stage-service.mjs';
import {createInventoryReadRepository} from './inventory-read-model.mjs';
import {createCollection} from './store.mjs';
import {changeScope} from '../operations/controls.mjs';
import {legacyAdmissionWallet,START,DAY} from './legacy-stage-source.fixtures.mjs';
async function activated(t,options={}){const f=await preparedAdoptionFixture(t,{openAtActivation:true,...options});const r=await f.activation.activate(adoptionPrincipal,f.activationInput);assert.equal(r.kind,'committed',JSON.stringify(r));return f;}
function services(f,{driver=f.driver,crypto=f.crypto}={}){let now=START+30*DAY;const measured=[],base={...driver,get leaseNowSql(){return String(now);},async batch(s){measured.push(s);return driver.batch(s);}},ports={...f.economicPorts,crypto,clock:{nowMs:()=>now}};return {driver:base,measured,setNow:v=>{now=v;},mint:{reserveMint:(...args)=>createMintReservationService({crypto,repository:createMintReservationRepository(base,ports)}).reserveMint(...args)},stages:{publishStage:(...args)=>createStagePublicationService({crypto,repository:createStagePublicationRepository(base,ports)}).publishStage(...args)},reads:createInventoryReadRepository(base,{crypto,normalizedAdmissionAvailable:true})};}
test('genuine imported source admits new mint and stage using combined counts, then replays before current controls',async t=>{
 const f=await activated(t),s=services(f),wallet=legacyAdmissionWallet(1),principal={kind:'wallet',wallet},stage=f.db.prepare('SELECT * FROM app_collection_stages WHERE inventory_id=?').get(f.inventoryId),request={requestKey:'new-after-import',inventoryId:f.inventoryId,stageId:stage.stage_id,expectedTermsDigest:stage.terms_digest};
 const minted=await s.mint.reserveMint(principal,request);assert.equal(minted.kind,'committed',JSON.stringify(minted));assert.equal(f.db.prepare('SELECT ordinal FROM app_collection_mint_admissions').get().ordinal,1);
 const view=await s.reads.readInventory({inventoryId:f.inventoryId,nowMs:START+30*DAY,principal});assert.equal(view.kind,'ready',JSON.stringify(view));assert.equal(view.value.counts.unsold,998);assert.equal(view.value.stages[0].walletReservations,2);
 const input={inventoryId:f.inventoryId,stageId:'next-stage',type:'whitelist',publishedAt:START+30*DAY,opensAt:START+42*DAY,closesAt:START+43*DAY,priceLamports:'100000000',costLamports:'5000',allocation:1,walletLimit:1,founderApproved:false,approvedSpendLamports:null,ballotId:null,inventoryOverrideReason:null,eligibilityListId:stage.list_id,sourceKind:'synthetic-local-operator-fixture'},pub={requestKey:'new-stage-after-import',input};
 const published=await s.stages.publishStage(adoptionPrincipal,pub);assert.equal(published.kind,'committed',JSON.stringify(published));
 s.setNow(input.opensAt);const next={...request,stageId:input.stageId,expectedTermsDigest:published.value.termsDigest};const raced=await Promise.all(['last-slot-a','last-slot-b'].map(requestKey=>s.mint.reserveMint(principal,{...next,requestKey})));assert.equal(raced.filter(r=>r.kind==='committed').length,1,JSON.stringify(raced));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_collection_mint_admissions WHERE stage_id=?').get(input.stageId).n,1);
 changeScope(f.db,{scope:'collection-mint',paused:true,atMs:input.opensAt,actor:'synthetic-import-controls',reason:'Synthetic pause',evidenceRef:'synthetic-local-controls',requestKey:'pause-import'});assert.equal((await s.mint.reserveMint(principal,request)).kind,'replayed');assert.equal((await s.mint.reserveMint(principal,{...next,requestKey:'paused-new'})).reason,'operator-pause');
 f.db.prepare('UPDATE app_operator_scopes SET enabled=0 WHERE operator=?').run(adoptionPrincipal.id);s.setNow(START+100*DAY);
 assert.equal((await s.mint.reserveMint(principal,request)).kind,'replayed');assert.equal((await s.stages.publishStage(adoptionPrincipal,pub)).kind,'replayed');
 assert.notEqual((await s.mint.reserveMint(principal,{...request,requestKey:'new-closed'})).kind,'committed');
});
test('one imported inventory per stable page retains every mixed and all-imported ID',async t=>{
 const f=await activated(t,{inventoryId:'b-import'});await activated(t,{inventoryId:'d-import',db:f.db,profile:'empty',seasonStart:Date.UTC(2025,11,1)});await activated(t,{inventoryId:'e-import',db:f.db,profile:'empty',seasonStart:Date.UTC(2025,10,1)});
 const onlyReads=createInventoryReadRepository(f.driver,{crypto:f.crypto}),onlyIds=[];let onlyAfter='';do{const r=await onlyReads.listInventories({nowMs:START+30*DAY,after:onlyAfter});assert.equal(r.kind,'ready',JSON.stringify(r));assert.equal(r.value.items.length,1);onlyIds.push(r.value.items[0].id);onlyAfter=r.value.nextCursor;}while(onlyAfter);assert.deepEqual(onlyIds,['b-import','d-import','e-import']);
 for(const [n,inventoryId] of ['a-legacy','c-legacy','f-legacy'].entries())createCollection(f.db,{id:inventoryId,kind:'season',seasonStart:Date.UTC(2025,n,1)});
 const reads=createInventoryReadRepository(f.driver,{crypto:f.crypto,normalizedAdmissionAvailable:true}),ids=[],pages=[];let after='';
 do{const r=await reads.listInventories({nowMs:START+30*DAY,after});assert.equal(r.kind,'ready',JSON.stringify(r));pages.push(r.value.items.map(x=>x.id));ids.push(...pages.at(-1));after=r.value.nextCursor;}while(after);
 assert.deepEqual(ids,['a-legacy','b-import','c-legacy','d-import','e-import','f-legacy']);assert.deepEqual(pages,[['a-legacy','b-import','c-legacy'],['d-import'],['e-import','f-legacy']]);
 const withoutCrypto=await createInventoryReadRepository(f.driver).readInventory({inventoryId:'b-import',nowMs:START+30*DAY});assert.equal(withoutCrypto.reason,'inventory-imported-authority-unavailable');
});

test('imported mint and publication cannot commit after helper capture changes or omitted admission effects',async t=>{
 const f=await activated(t),wallet=legacyAdmissionWallet(1),stage=f.db.prepare('SELECT * FROM app_collection_stages WHERE inventory_id=?').get(f.inventoryId),request={requestKey:'fault-import',inventoryId:f.inventoryId,stageId:stage.stage_id,expectedTermsDigest:stage.terms_digest},principal={kind:'wallet',wallet};
 for(const fault of ['watermark','omit-admission']){let hit=false;const driver={...f.driver,async batch(statements){if(!hit&&statements.some(s=>s.sql.startsWith('INSERT INTO collect_operations'))){hit=true;if(fault==='watermark')f.db.exec('UPDATE app_recovery_watermark SET revision=revision+1');else statements=statements.map(s=>s.sql.startsWith('INSERT INTO app_collection_mint_admissions')?{sql:'SELECT 1 omitted',values:[]}:s);}return f.driver.batch(statements);}},s=services(f,{driver});if(fault==='omit-admission')await assert.rejects(()=>s.mint.reserveMint(principal,request),/Collection command requires exact accepted origin|Missing atomic/);else assert.equal((await s.mint.reserveMint(principal,request)).kind,'conflict');assert.equal(hit,true);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_collection_mint_admissions').get().n,0);}
 const s=services(f);s.setNow(START+30*DAY-1);assert.equal((await s.mint.reserveMint(principal,request)).reason,'imported-authority-not-yet-created');
 let changed=false;const crypto={...f.crypto,async sha256(bytes){const out=await f.crypto.sha256(bytes);if(!changed){changed=true;f.db.exec('UPDATE app_recovery_watermark SET revision=revision+1');}return out;}},r=await createInventoryReadRepository(f.driver,{crypto}).readInventory({inventoryId:f.inventoryId,nowMs:START+30*DAY});assert.equal(r.kind,'pending');
});
