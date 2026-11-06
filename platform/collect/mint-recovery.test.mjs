import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {mintFixture} from './mint-test-fixture.mjs';
import {createMintReservationService} from './mint-service.mjs';
import {createMintReservationRepository} from './mint-repository.mjs';
import {memoryArtifacts} from '../application/fixtures/memory-artifacts.mjs';
import {createManifestCodec} from '../artifacts/manifest-codec.mjs';
import {readInstalledRecoverySchema} from '../recovery/node-schema.mjs';
import {createRecoveryExporter} from '../recovery/export.mjs';
import {createPrivateRecovery} from '../recovery/restore.mjs';
import {canonicalJson} from '../security/canonical.mjs';

// Installed045 and its explicit recovery allowlist entry are required.
test('private recovery retains genuine pending mint admissions, fixed fairness and exact accepted replay',async t=>{
 const f=await mintFixture(t,{configured:true}),target=openDatabase();t.after(()=>target.close());const service=createMintReservationService({...f.ports,repository:createMintReservationRepository(f.base,f.ports)}),accepted=await service.reserveMint(f.principal,f.request);assert.equal(accepted.kind,'committed');
 const sourceArtifacts=memoryArtifacts(),artifacts=memoryArtifacts(),driver=createNodeAtomicDriver(target),ports={...f.ports,schema:await readInstalledRecoverySchema(f.ports.crypto),codec:createManifestCodec({crypto:f.ports.crypto})};
 const captured=await createRecoveryExporter({...ports,driver:f.base,artifacts:sourceArtifacts,sourceCommit:'0'.repeat(40)}).capturePrivate();assert.equal(captured.kind,'captured',JSON.stringify(captured));assert.equal(captured.inventory.tables.find(t=>t.name==='app_collection_mint_admissions').rowCount,1);
 const restored=await createPrivateRecovery({...ports,driver,artifacts,sourceArtifacts}).restore({inventory:structuredClone(captured.inventory),pinnedDigest:captured.digest});assert.equal(restored.kind,'restored',JSON.stringify(restored));
 for(const table of ['app_collection_mint_admissions','app_collection_authorities','app_collection_stages','app_collection_list_seals','app_collection_eligibility_pages','collect_inventories','collect_operations','fair_inventories','fair_reserved_assets','fair_requests','app_command_receipts'])assert.equal(canonicalJson(target.prepare('SELECT * FROM '+table).all().sort((a,b)=>canonicalJson(a).localeCompare(canonicalJson(b)))),canonicalJson(f.db.prepare('SELECT * FROM '+table).all().sort((a,b)=>canonicalJson(a).localeCompare(canonicalJson(b)))),table);
 f.setNow(f.input.closesAt+86400000);sourceArtifacts.objects.clear();const replay=await createMintReservationService({...f.ports,repository:createMintReservationRepository(driver,f.ports)}).reserveMint(f.principal,f.request);assert.equal(replay.kind,'replayed');assert.deepEqual(replay.value,accepted.value);assert.deepEqual(replay.receipt,accepted.receipt);
 assert.throws(()=>target.prepare('DELETE FROM app_collection_mint_admissions').run(),/Retain/);assert.throws(()=>target.prepare('UPDATE fair_reserved_assets SET asset_id=asset_id').run(),/immutable/);assert.throws(()=>target.prepare('UPDATE collect_operations SET settled_ms=created_ms').run(),/Guarded.*mint.*fulfillment/i);assert.equal(target.prepare('SELECT COUNT(*) n FROM collect_assets').get().n,0);assert.equal(target.prepare('SELECT COUNT(*) n FROM tx_intents').get().n,0);
 t.diagnostic(JSON.stringify({businessTables:captured.inventory.tables.length,admissions:1,pendingFairRequests:1,reservedAssets:1000,acceptedReplayAfterCloseAndSourceLoss:true,financialExecution:false}));
});
