import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mintFixture} from '../collect/mint-test-fixture.mjs';
import {createMintReservationService} from '../collect/mint-service.mjs';
import {createMintReservationRepository} from '../collect/mint-repository.mjs';
import {dispatchMintFulfillment,mintFulfillmentInput,MINT_FULFILLMENT_TEST_OPERATOR} from '../collect/mint-fulfillment-test-harness.mjs';
import {memoryArtifacts} from './fixtures.mjs';
import {roundTime,leadMs} from '../randomness/request-plan.mjs';
import {publishDrawPolicy} from '../randomness/selection.mjs';
import {createRecoveryV2CollectionReconciler} from './v2-reconcile-collections.mjs';
import {observeCollectionAsset} from '../collect/store.mjs';
import {createRecoveryV2Capture} from './v2-capture.mjs';
import {createRecoveryV2Codec} from './v2-codec.mjs';
import {createManifestCodec} from '../artifacts/manifest-codec.mjs';
import {readInstalledRecoverySchema} from './node-schema.mjs';
import {v2RestoreTarget} from './v2-restore-fixtures.mjs';
import {recoveryMintFixture} from './v2-mint-fixture.mjs';
async function check(f){let c={phase:'reconcile-collection-authorities',targetWatermark:0},proofs=[];const repository={async advance(_loaded,r){c={...c,...r.delta};proofs.push(r.check);return {kind:'progress'};}},reconciler=createRecoveryV2CollectionReconciler({driver:f.base,artifacts:f.store,crypto:f.ports.crypto,beaconVerifier:f.beaconVerifier,repository});for(let n=0;n<20&&c.phase.startsWith('reconcile-collection-');n++)await reconciler.step({},c);assert.equal(c.phase,'reconcile-publications');return proofs;}
test('normalized historical manual/configured mint reconciliation retains quota, evidence and current owner independence',async t=>{
 for(const configured of [false,true]){const f=await recoveryMintFixture(t,{configured});f.db.prepare('UPDATE app_operator_scopes SET enabled=0').run();f.db.prepare('DELETE FROM app_evidence_heads').run();
  // A revealed NFT has a newer Collect observation than its last Vault owner
  // observation; current state is not the concealed original mint body.
  observeCollectionAsset(f.db,{sourceId:'synthetic-recovery-reveal',kind:'reveal',assetId:f.assetId,at:f.atMs+2000,finalized:true},f.atMs+2000);
  observeCollectionAsset(f.db,{sourceId:'synthetic-recovery-transfer',kind:'transfer',assetId:f.assetId,from:f.op.owner,to:f.holders[1],at:f.atMs+3000,finalized:true},f.atMs+3000);
  const proofs=await check(f);assert.equal(proofs.filter(p=>p.scope.startsWith('fulfillment:')).length,1);
 }
});
test('fresh v2 target restores configured mint raw evidence and historical slot after reveal and transfer',async t=>{
 const f=await recoveryMintFixture(t,{configured:true}),now=f.atMs+86400000,ports={...f.ports,clock:{nowMs:()=>now},schema:await readInstalledRecoverySchema(f.ports.crypto),v2Codec:createRecoveryV2Codec(f.ports),codec:createManifestCodec(f.ports),beaconVerifier:f.beaconVerifier};
 observeCollectionAsset(f.db,{sourceId:'synthetic-full-recovery-reveal',kind:'reveal',assetId:f.assetId,at:f.atMs+2000,finalized:true},f.atMs+2000);observeCollectionAsset(f.db,{sourceId:'synthetic-full-recovery-transfer',kind:'transfer',assetId:f.assetId,from:f.op.owner,to:f.holders[1],at:f.atMs+3000,finalized:true},f.atMs+3000);
 f.db.prepare('UPDATE app_operator_scopes SET enabled=0').run();f.db.prepare('DELETE FROM app_evidence_heads').run();const capture=createRecoveryV2Capture({...ports,driver:f.base,artifacts:f.store});let captured=await capture.start({captureId:'synthetic-configured-mint-restore',sourceCommit:'a'.repeat(40)});for(let n=0;n<3000&&['started','progress','replayed'].includes(captured.kind);n++)captured=await capture.step({captureId:captured.captureId,expectedRevision:captured.revision});assert.equal(captured.kind,'captured',JSON.stringify(captured));
 const target=v2RestoreTarget(t,{...ports,store:f.store,captured,now}),result=await target.drive();assert.equal(result.kind,'restored',JSON.stringify(result));assert.equal(target.db.prepare('SELECT owner FROM collect_assets').get().owner,f.holders[1]);assert.equal(target.db.prepare("SELECT COUNT(*) n FROM app_recovery_reconcile_checks WHERE phase='collection' AND scope LIKE 'fulfillment:%'").get().n,1);assert.equal(target.db.prepare('SELECT COUNT(*) n FROM app_collection_mint_fulfillments').get().n,1);
 t.diagnostic(JSON.stringify({configuredMint:1,syntheticVerifier:true,retainedRawEvidence:true,currentOwnerDiffersFromMint:true,revokedOperator:true,acceptedEvidenceHeadAbsent:true,tables:result.report.tables}));
});
test('normalized recovery rejects altered remaining quotas and missing original bind observation',async t=>{
 const f=await recoveryMintFixture(t);const old=f.db.prepare('SELECT remaining_json FROM app_collection_authorities').get().remaining_json;
 // Explicit SQL corruption after removing guards is only a negative fixture.
 const guards=f.db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='app_collection_authorities'").all();for(const g of guards)f.db.exec('DROP TRIGGER '+g.name);
 f.db.prepare('UPDATE app_collection_authorities SET remaining_json=?').run(JSON.stringify([489,255,128,64,32,16,8,4,2,1]));await assert.rejects(check(f),/quota conservation/);f.db.prepare('UPDATE app_collection_authorities SET remaining_json=?').run(old);for(const g of guards)f.db.exec(g.sql);
 const observationGuards=f.db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='vault_observations'").all();for(const g of observationGuards)f.db.exec('DROP TRIGGER '+g.name);f.db.prepare('DELETE FROM vault_observations WHERE event_id=?').run('collect:'+f.op.id);for(const g of observationGuards)f.db.exec(g.sql);await assert.rejects(check(f),/fixed mint slot/);
});
test('maximum legal Unicode trait policy is selected in three bounded continuations without cloning all choices',async t=>{
 const f=await recoveryMintFixture(t,{configured:true,largeTraits:true}),base=f.base,measurements=[];let returned=0;
 f.base={...base,async batch(statements){const result=await base.batch(statements);returned+=Buffer.byteLength(JSON.stringify(result));return result;}};
 let c={phase:'reconcile-collection-authorities',targetWatermark:0};const repository={async advance(_loaded,r){c={...c,...r.delta};measurements.push({phase:r.check.scope,returnedBytes:returned,checkpointBytes:Buffer.byteLength(JSON.stringify(c))});returned=0;return {kind:'progress'};}},reconciler=createRecoveryV2CollectionReconciler({driver:f.base,artifacts:f.store,crypto:f.ports.crypto,beaconVerifier:f.beaconVerifier,repository});for(let n=0;n<20&&c.phase.startsWith('reconcile-collection-');n++)await reconciler.step({},c);assert.equal(c.phase,'reconcile-publications');const traits=measurements.filter(m=>m.phase.startsWith('trait:'));assert.equal(traits.length,3);assert.ok(traits.every(m=>m.returnedBytes<120000&&m.checkpointBytes<4000));t.diagnostic(JSON.stringify({policyBytes:f.db.prepare('SELECT length(CAST(traits AS BLOB)) bytes FROM fair_inventories').get().bytes,traitContinuations:traits.length,maxReturnedBytes:Math.max(...traits.map(m=>m.returnedBytes)),maxCheckpointBytes:Math.max(...traits.map(m=>m.checkpointBytes)),syntheticVerifier:true,captureLargeRowAcceptance:false}));
});
