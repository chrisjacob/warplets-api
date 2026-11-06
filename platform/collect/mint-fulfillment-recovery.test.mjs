import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {mintFixture} from './mint-test-fixture.mjs';
import {createMintReservationService} from './mint-service.mjs';
import {createMintReservationRepository} from './mint-repository.mjs';
import {createMintFulfillmentService} from './mint-fulfillment-service.mjs';
import {createMintFulfillmentRepository} from './mint-fulfillment-repository.mjs';
import {dispatchMintFulfillment,mintFulfillmentInput,MINT_FULFILLMENT_TEST_OPERATOR} from './mint-fulfillment-test-harness.mjs';
import {memoryArtifacts} from '../application/fixtures/memory-artifacts.mjs';
import {createManifestCodec} from '../artifacts/manifest-codec.mjs';
import {readInstalledRecoverySchema} from '../recovery/node-schema.mjs';
import {createRecoveryExporter} from '../recovery/export.mjs';
import {createPrivateRecovery} from '../recovery/restore.mjs';
import {canonicalJson} from '../security/canonical.mjs';
import {roundTime,leadMs} from '../randomness/request-plan.mjs';

// The target is fresh and uses the same independently pinned installed schema.
test('private recovery retains configured mint outcome, raw evidence, fixed slot and original accepted replay',async t=>{
 const proof=JSON.parse(readFileSync(new URL('../beacon/fixtures/round-30000000.json',import.meta.url))),f=await mintFixture(t,{configured:true,admissionAtMs:roundTime(proof.round)-leadMs}),target=openDatabase();t.after(()=>target.close());
 for(const scope of ['evidence-ingest','collection-evidence'])f.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(MINT_FULFILLMENT_TEST_OPERATOR.id,scope);
 const admitted=await createMintReservationService({...f.ports,repository:createMintReservationRepository(f.base,f.ports)}).reserveMint(f.principal,f.request);assert.equal(admitted.kind,'committed');
 const op=f.db.prepare('SELECT * FROM collect_operations').get(),sourceArtifacts=memoryArtifacts(),artifacts=memoryArtifacts(),atMs=roundTime(proof.round),event={inventoryId:f.input.inventoryId,operationId:op.id,kind:'mint',commitment:op.commitment,provenance:'configured-offline-beacon',atMs,proof};
 // Fixture verifier injection only. Separate actual workerd tests verify pinned
 // BLS; this case verifies retention and restoration of an accepted transcript.
 const shared={driver:f.base,crypto:f.ports.crypto,store:sourceArtifacts,beaconVerifier:{verifyShortSignature:()=>true}},ev=await dispatchMintFulfillment({...shared,request:{method:'evidence',event,nowMs:atMs+1000,idPrefix:'synthetic-mint-recovery-evidence'}});assert.equal(ev.result.kind,'committed');
 const input=mintFulfillmentInput(ev.result.value,'synthetic-mint-recovery-fulfill'),accepted=await dispatchMintFulfillment({...shared,request:{input,nowMs:atMs+1000,idPrefix:'synthetic-mint-recovery-fulfill'}});assert.equal(accepted.result.kind,'committed',JSON.stringify(accepted));
 const driver=createNodeAtomicDriver(target),ports={...f.ports,clock:{nowMs:()=>atMs+86400000},schema:await readInstalledRecoverySchema(f.ports.crypto),codec:createManifestCodec({crypto:f.ports.crypto})},capture=await createRecoveryExporter({...ports,driver:f.base,artifacts:sourceArtifacts,sourceCommit:'0'.repeat(40)}).capturePrivate();assert.equal(capture.kind,'captured',JSON.stringify(capture));assert.equal(capture.inventory.tables.find(t=>t.name==='app_collection_mint_fulfillments').rowCount,1);
 const restored=await createPrivateRecovery({...ports,driver,artifacts,sourceArtifacts}).restore({inventory:structuredClone(capture.inventory),pinnedDigest:capture.digest});assert.equal(restored.kind,'restored',JSON.stringify(restored));
 for(const table of ['app_collection_mint_admissions','app_collection_mint_fulfillments','app_collection_authorities','app_collection_stages','collect_assets','vault_assets','vault_observations','collect_operations','fair_inventories','fair_reserved_assets','fair_requests','fair_results','app_evidence_receipts','app_evidence_heads','app_command_receipts'])assert.equal(canonicalJson(target.prepare('SELECT * FROM '+table).all().sort((a,b)=>canonicalJson(a).localeCompare(canonicalJson(b)))),canonicalJson(f.db.prepare('SELECT * FROM '+table).all().sort((a,b)=>canonicalJson(a).localeCompare(canonicalJson(b)))),table);
 const evidence=target.prepare('SELECT object_key FROM app_evidence_receipts WHERE receipt_digest=?').get(input.evidenceReceiptId);assert.ok(artifacts.objects.has(evidence.object_key));target.prepare('UPDATE app_operator_scopes SET enabled=0 WHERE operator=?').run(MINT_FULFILLMENT_TEST_OPERATOR.id);artifacts.objects.clear();sourceArtifacts.objects.clear();
 const replay=await createMintFulfillmentService({crypto:f.ports.crypto,repository:createMintFulfillmentRepository(driver,{...ports,artifacts})}).fulfillMint(MINT_FULFILLMENT_TEST_OPERATOR,input);assert.equal(replay.kind,'replayed');assert.deepEqual(replay.value,accepted.result.value);assert.deepEqual(replay.receipt,accepted.result.receipt);assert.throws(()=>target.prepare('UPDATE vault_assets SET coords=?').run('{}'),/immutable|fixed|Retain/i);assert.throws(()=>target.prepare('UPDATE collect_operations SET settled_ms=NULL').run(),/Guarded|immutable/i);assert.equal(target.prepare('SELECT COUNT(*) n FROM tx_intents').get().n,0);
 t.diagnostic(JSON.stringify({businessTables:capture.inventory.tables.length,configuredMintFulfillments:1,rawEvidenceRetained:true,exactReplayAfterAuthorityAndObjectLoss:true,financialExecution:false}));
});
