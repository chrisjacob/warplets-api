import test from 'node:test';
import assert from 'node:assert/strict';
import {freeCutFixture,CUT_OPERATOR} from './free-cut-test-fixture.mjs';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {memoryArtifacts} from '../application/fixtures/memory-artifacts.mjs';
import {createManifestCodec} from '../artifacts/manifest-codec.mjs';
import {readInstalledRecoverySchema} from '../recovery/node-schema.mjs';
import {createRecoveryExporter} from '../recovery/export.mjs';
import {createPrivateRecovery} from '../recovery/restore.mjs';
import {createCollectionCutService} from './free-cut-service.mjs';
import {createCollectionCutRepository} from './free-cut-repository.mjs';
import {canonicalJson} from '../security/canonical.mjs';
// The fresh target uses independently pinned installed schema and all four cut tables.
test('private recovery preserves the fixed cut, list closure and exact accepted command replay',async t=>{
 const f=await freeCutFixture(t);await f.stage();const begin=await f.begin(),attemptId=begin.value.attemptId;assert.equal((await f.page(attemptId)).kind,'committed');const accepted=await f.seal(attemptId);assert.equal(accepted.kind,'committed');
 const sourceArtifacts=memoryArtifacts(),artifacts=memoryArtifacts(),target=openDatabase();t.after(()=>target.close());const schema=await readInstalledRecoverySchema(f.ports.crypto),ports={...f.ports,schema,codec:createManifestCodec({crypto:f.ports.crypto}),clock:{nowMs:()=>f.cutMs+10*86400000}},capture=await createRecoveryExporter({...ports,driver:f.base,artifacts:sourceArtifacts,sourceCommit:'0'.repeat(40)}).capturePrivate();assert.equal(capture.kind,'captured',JSON.stringify(capture));
 const driver=createNodeAtomicDriver(target),restored=await createPrivateRecovery({...ports,driver,artifacts,sourceArtifacts}).restore({inventory:structuredClone(capture.inventory),pinnedDigest:capture.digest});assert.equal(restored.kind,'restored',JSON.stringify(restored));
 for(const table of ['app_collection_cut_records','app_collection_cut_attempts','app_collection_cut_pages','app_collection_free_cuts','app_collection_list_seals','app_collection_eligibility_pages','collect_assets','vault_observations','app_command_receipts'])assert.equal(canonicalJson(target.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()),canonicalJson(f.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()),table);
 target.prepare('UPDATE app_operator_scopes SET enabled=0 WHERE operator=?').run(CUT_OPERATOR.id);sourceArtifacts.objects.clear();artifacts.objects.clear();const replay=await createCollectionCutService({...ports,repository:createCollectionCutRepository(driver,ports)}).sealCut(CUT_OPERATOR,{requestKey:'synthetic-cut-seal',attemptId});assert.equal(replay.kind,'replayed');assert.deepEqual(replay.value,accepted.value);assert.deepEqual(replay.receipt,accepted.receipt);
 target.prepare("UPDATE app_recovery_state SET status='held'").run();const row=target.prepare('SELECT * FROM app_collection_cut_records LIMIT 1').get();assert.throws(()=>target.prepare('INSERT INTO app_collection_cut_records VALUES(?,?,?,?,?)').run('0'.repeat(64),row.format,row.size,row.body_json,row.operation_id),/mutation-disabled/);assert.equal(target.prepare('SELECT COUNT(*) n FROM tx_intents').get().n,0);
 t.diagnostic(JSON.stringify({businessTables:capture.inventory.tables.length,cutRecords:2,attempts:1,pageValidations:1,freeCuts:1,originalReceiptsRetained:true,heldTargetRejectsNewCutRecords:true,financialExecution:false}));
});
