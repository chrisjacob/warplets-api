import test from 'node:test';
import assert from 'node:assert/strict';
import {freeCutFixture} from './free-cut-test-fixture.mjs';
import {dispatchMintReservation} from './mint-test-harness.mjs';
import {createInventoryReadRepository} from './inventory-read-model.mjs';
import {governanceWallets} from '../governance/operator-test-fixture.mjs';
const input=f=>({requestKey:'synthetic-free-mint',inventoryId:f.inventoryId,stageId:f.stageId,expectedTermsDigest:f.publication.value.termsDigest});
const mint=(f,patch={})=>dispatchMintReservation({driver:f.base,crypto:f.ports.crypto,request:{principal:{kind:'wallet',wallet:f.holders[0]},nowMs:f.getNow(),idPrefix:'synthetic-free-mint',input:input(f),...patch}});
async function seal(f){await f.stage();const b=await f.begin();assert.equal(b.kind,'committed');assert.equal((await f.page(b.value.attemptId)).kind,'committed');assert.equal((await f.seal(b.value.attemptId)).kind,'committed');}
const read=async(f,wallet=f.holders[0])=>{const r=await createInventoryReadRepository(f.base).readInventory({inventoryId:f.inventoryId,nowMs:f.getNow(),principal:wallet?{kind:'wallet',wallet}:null});assert.equal(r.kind,'ready',JSON.stringify(r));return r.value;};
test('private free mint waits for sealed fixed cut, retains original terms and reveals bounded eligibility',async t=>{
 const f=await freeCutFixture(t);assert.equal((await mint(f)).result.reason,'mint-free-cut-pending');const before=f.db.prepare('SELECT terms_json FROM app_collection_stages WHERE stage_id=?').get(f.stageId).terms_json;
 assert.equal((await read(f)).stages.at(-1).status,'awaiting-snapshot');await seal(f);
 const view=await read(f),stage=view.stages.at(-1);assert.equal(stage.status,'open');assert.equal(stage.eligible,true);assert.equal(stage.reservationStatus.reason,'admission-unavailable');assert.doesNotMatch(JSON.stringify(view),/wallets|root_id|holdings/);
 assert.equal((await read(f,governanceWallets(3)[2])).stages.at(-1).eligible,false);assert.equal((await read(f,null)).stages.at(-1).eligible,null);
 const r=await mint(f);assert.equal(r.result?.kind,'committed',JSON.stringify(r));const admission=f.db.prepare('SELECT * FROM app_collection_mint_admissions').get();assert.equal(admission.price_lamports,'0');assert.equal(admission.membership_source_id,f.groups[0].manifest.id);assert.equal(admission.terms_digest,f.publication.value.termsDigest);assert.equal(f.db.prepare('SELECT terms_json FROM app_collection_stages WHERE stage_id=?').get(f.stageId).terms_json,before);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM collect_snapshots').get().n,0);
 f.setNow(f.cutMs+86400001);assert.equal((await mint(f)).result.kind,'replayed');t.diagnostic(JSON.stringify(r.metrics));
});
test('free admission keeps wallet eligibility, limits, atomic children and source fences',async t=>{
 for(const fault of ['omit-operation','omit-authority','omit-admission','source-change','watermark-change']){const f=await freeCutFixture(t);await seal(f);const r=await mint(f,{fault});assert.equal(fault.startsWith('omit-')?r.status:r.result.code,fault.startsWith('omit-')?500:'revision_conflict',JSON.stringify(r));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_collection_mint_admissions').get().n,0);}
 const f=await freeCutFixture(t);await seal(f);assert.equal((await mint(f,{principal:{kind:'wallet',wallet:governanceWallets(3)[2]}})).result.reason,'wallet_ineligible');assert.equal((await mint(f)).result.kind,'committed');assert.equal((await mint(f,{idPrefix:'synthetic-second',input:{...input(f),requestKey:'synthetic-second'}})).result.reason,'stage_wallet_limit');
});

test('independent SQL rejects forged eligibility reads and a fabricated unsealed cut',async t=>{
 for(const missingCut of [false,true]){
  const f=await freeCutFixture(t);if(!missingCut)await seal(f);
  let aborted=null;const outsider=governanceWallets(3)[2],driver={...f.base,async batch(statements){let results;try{results=await f.base.batch(statements);}catch(error){aborted=error.message;throw error;}return results.map((r,n)=>{
   if(statements[n].sql.includes('indexed_pages')&&statements[n].sql.includes('FROM app_collection_stages s'))return {...r,rows:[{id:f.groups[0].manifest.id,member_count:2,page_count:1,indexed_pages:1,indexed_members:2,wallet_count:1}]};
   if(missingCut&&statements[n].sql.startsWith('SELECT c.root_id,c.list_id,c.cut_ms'))return {...r,rows:[{root_id:f.bundle.root.id,list_id:f.groups[0].manifest.id,cut_ms:f.cutMs,eligible_count:2,inventory_id:f.inventoryId,stage_id:f.stageId,terms_digest:f.publication.value.termsDigest,at_ms:f.cutMs,eligibility_list_id:f.groups[0].manifest.id}]};
   return r;
  });}};
  const r=await dispatchMintReservation({driver,crypto:f.ports.crypto,request:{principal:{kind:'wallet',wallet:missingCut?f.holders[0]:outsider},nowMs:f.getNow(),idPrefix:'synthetic-forged-read',input:input(f)}});assert.equal(r.status,500,JSON.stringify(r));assert.match(aborted,/Missing atomic normalized mint admission/);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_collection_mint_admissions').get().n,0);
 }
});
import {dispatchMintFulfillment,mintFulfillmentInput,MINT_FULFILLMENT_TEST_OPERATOR} from './mint-fulfillment-test-harness.mjs';
import {memoryArtifacts} from '../application/fixtures/memory-artifacts.mjs';
import {seasonExpiry} from '../domain/collections/policy.mjs';
test('free admission fulfills one concealed original Season slot with retained evidence and replay',async t=>{
 const f=await freeCutFixture(t);await seal(f);const reserved=await mint(f);assert.equal(reserved.result.kind,'committed');const op=f.db.prepare('SELECT * FROM collect_operations WHERE id=?').get(reserved.result.value.operationId);
 for(const scope of ['evidence-ingest','collection-evidence'])f.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(MINT_FULFILLMENT_TEST_OPERATOR.id,scope);
 const store=memoryArtifacts(),atMs=f.cutMs+1000,call=request=>dispatchMintFulfillment({driver:f.base,crypto:f.ports.crypto,store,request:{nowMs:atMs+1000,idPrefix:'synthetic-free-fulfillment',...request}});
 const evidence=await call({method:'evidence',idPrefix:'synthetic-free-evidence',event:{inventoryId:f.inventoryId,operationId:op.id,kind:'mint',commitment:op.commitment,provenance:'manual-fixture',atMs,proof:{proofId:'synthetic-free-proof',assetId:'synthetic-free-season-asset',ticket:999,traits:{model:'Synthetic',backdrop:'Synthetic',symbol:'Synthetic'}}}});assert.equal(evidence.result?.kind,'committed',JSON.stringify(evidence));const input=mintFulfillmentInput(evidence.result.value,'synthetic-free-fulfillment');
 const fulfilled=await call({input});assert.equal(fulfilled.result?.kind,'committed',JSON.stringify(fulfilled));const asset=f.db.prepare('SELECT * FROM collect_assets WHERE id=?').get(fulfilled.result.value.assetId),body=JSON.parse(asset.asset),authority=f.db.prepare('SELECT * FROM app_collection_authorities WHERE inventory_id=?').get(f.inventoryId);assert.equal(asset.reveal_ms,null);assert.equal(body.level,10);assert.equal(body.expiresAt,seasonExpiry(f.cutMs-5*86400000,10));assert.equal(authority.fulfilled,1);assert.equal(JSON.parse(authority.remaining_json)[9],0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM collect_level_history WHERE asset_id=?').get(asset.id).n,1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM vault_observations WHERE asset_id=?').get(asset.id).n,1);
 store.objects.clear();assert.equal((await call({input,nowMs:atMs+86400000})).result.kind,'replayed');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM tx_intents').get().n,0);
});
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {readInstalledRecoverySchema} from '../recovery/node-schema.mjs';
import {createManifestCodec} from '../artifacts/manifest-codec.mjs';
import {createRecoveryExporter} from '../recovery/export.mjs';
import {createPrivateRecovery} from '../recovery/restore.mjs';
test('private recovery retains sealed free-cut admission and exact accepted wallet retry',async t=>{
 const f=await freeCutFixture(t);await seal(f);const accepted=await mint(f);assert.equal(accepted.result.kind,'committed');const sourceArtifacts=memoryArtifacts(),artifacts=memoryArtifacts(),db=openDatabase();t.after(()=>db.close());const schema=await readInstalledRecoverySchema(f.ports.crypto),ports={...f.ports,schema,codec:createManifestCodec({crypto:f.ports.crypto}),clock:{nowMs:()=>f.cutMs+86400001}},capture=await createRecoveryExporter({...ports,driver:f.base,artifacts:sourceArtifacts,sourceCommit:'0'.repeat(40)}).capturePrivate();assert.equal(capture.kind,'captured',JSON.stringify(capture));const driver=createNodeAtomicDriver(db),restored=await createPrivateRecovery({...ports,driver,artifacts,sourceArtifacts}).restore({inventory:capture.inventory,pinnedDigest:capture.digest});assert.equal(restored.kind,'restored',JSON.stringify(restored));
 const retry=await dispatchMintReservation({driver,crypto:f.ports.crypto,request:{principal:{kind:'wallet',wallet:f.holders[0]},nowMs:ports.clock.nowMs(),idPrefix:'synthetic-recovered-retry',input:input(f)}});assert.equal(retry.result.kind,'replayed');assert.deepEqual(retry.result.value,accepted.result.value);assert.deepEqual(retry.result.receipt,accepted.result.receipt);assert.deepEqual(db.prepare('SELECT * FROM app_collection_free_cuts').all(),f.db.prepare('SELECT * FROM app_collection_free_cuts').all());assert.deepEqual(db.prepare('SELECT * FROM app_collection_mint_admissions').all(),f.db.prepare('SELECT * FROM app_collection_mint_admissions').all());
 const view=await createInventoryReadRepository(driver).readInventory({inventoryId:f.inventoryId,nowMs:f.cutMs+1000,principal:{kind:'wallet',wallet:f.holders[0]}});assert.equal(view.kind,'ready');assert.equal(view.value.stages.at(-1).reservationStatus.reason,'wallet-limit');
});
