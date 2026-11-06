import test from 'node:test';
import assert from 'node:assert/strict';
import {adoptionAuthorityFixture,syntheticAdoptionLabel} from '../../collect/legacy-adoption-authority.fixtures.mjs';
import {localRuntime} from './local-runtime.mjs';
test('actual D1 installed054 synthetic accepted-import reader matches Node32stage receipts and exact founder BigInt counts',async t=>{
 const f=await adoptionAuthorityFixture(t,{count:3,stageCount:32,type:'founder',cost:'4611686018427387904',receiptState:'staging'}),{mf,db}=await localRuntime(t,new URL('./fixtures/legacy-adoption-authority-worker.ts',import.meta.url));
 assert.equal(f.label,syntheticAdoptionLabel);
 // Fixture-only restoring nonce with an explicitly synthetic checkpoint. No genuine activation/restore claim.
 const recovery=f.db.prepare('SELECT * FROM app_recovery_runs').all();for(const row of recovery){const keys=Object.keys(row);await db.prepare('INSERT INTO app_recovery_runs('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').bind(...Object.values(row)).run();}
 await db.prepare("UPDATE app_recovery_state SET mode='private',status='restoring',generation='synthetic-reader-generation',active_restore_id='synthetic-reader-import',inventory_digest=?,write_nonce='synthetic-fixture-load' WHERE id=1").bind(f.certificate.economic_selection_digest).run();
 for(const table of ['app_operator_scopes','collect_inventories','collect_operations','collect_assets','vault_assets','vault_observations','collect_observations','collect_level_history','fair_inventories','fair_requests','fair_results','app_command_receipts','app_collection_records','app_collection_list_seals','app_collection_source_seals','app_collection_eligibility_pages','app_collection_legacy_adoptions','app_collection_authorities','app_collection_stages','app_collection_legacy_stage_imports','app_collection_legacy_mint_anchors','app_collection_legacy_adoption_objects']){const rows=f.db.prepare('SELECT * FROM '+table).all();for(let n=0;n<rows.length;n+=3)await db.batch(rows.slice(n,n+3).map(row=>{const keys=Object.keys(row);return db.prepare('INSERT INTO '+table+'('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').bind(...Object.values(row));}));}
 await db.prepare("UPDATE app_recovery_state SET status='ready',write_nonce=NULL WHERE id=1").run();
 // Exercise the real mandatory UPDATE triggers on synthetic staged receipts.
 await db.prepare("UPDATE app_command_receipts SET state=state WHERE 0").run();
 await assert.rejects(db.prepare("UPDATE app_command_receipts SET state='committed' WHERE operation_id=?").bind(f.receipt.operation_id).run(),/Missing exact legacy adoption command effect/);
 for(const p of f.stagePlans){await db.prepare("UPDATE app_command_receipts SET state='committed' WHERE operation_id=?").bind(p.body.command.operationId).run();f.db.prepare("UPDATE app_command_receipts SET state='committed' WHERE operation_id=?").run(p.body.command.operationId);}
 await db.prepare("UPDATE app_command_receipts SET state='committed' WHERE operation_id=?").bind(f.receipt.operation_id).run();f.db.prepare("UPDATE app_command_receipts SET state='committed' WHERE operation_id=?").run(f.receipt.operation_id);

 const call=async fault=>{const response=await mf.dispatchFetch('http://localhost/__fixture',{method:'POST',body:JSON.stringify({request:f.request(),fault})});assert.equal(response.status,200,await response.clone().text());return response.json();};
 const expected=await f.service.read(f.request()),actual=await call();assert.equal(actual.kind,'ready',JSON.stringify(actual));for(const key of ['certificate','authority','counts','stage'])assert.deepEqual(actual[key],expected[key]);assert.equal(actual.stage.founderSpentLamports,'13835058055282163712');assert.equal(actual.metrics.sql,28);assert.ok(actual.metrics.workingBytes<=1048576&&actual.metrics.maxBatchBytes<=262144);t.diagnostic(JSON.stringify(actual.metrics));
 assert.equal((await call('final-watermark')).reason,'legacy-adoption-source-changed');assert.equal((await call()).kind,'ready');
 await assert.rejects(db.prepare("UPDATE app_collection_legacy_adoptions SET parent_preimage_json='{}'").run(),/immutable/i);
 await assert.rejects(db.prepare("DELETE FROM app_collection_legacy_stage_imports").run(),/immutable|Retain/i);
 assert.equal((await mf.dispatchFetch('http://localhost/api/v1/legacy-adoption-authority')).status,404);
});
