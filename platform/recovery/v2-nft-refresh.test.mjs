import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshRepositoryFixture,REFRESH_OWNER,REFRESH_OPERATOR,REFRESH_BUYER} from '../nfts/refresh-repository.fixtures.mjs';
import {completeRefreshRehearsal} from '../nfts/refresh-acceptance.fixtures.mjs';
import {createRefreshRepository} from '../nfts/refresh-repository.mjs';
import {createRecoveryV2Codec} from './v2-codec.mjs';
import {createRecoveryV2Capture} from './v2-capture.mjs';
import {createManifestCodec} from '../artifacts/manifest-codec.mjs';
import {readInstalledRecoverySchema} from './node-schema.mjs';
import {v2RestoreTarget} from './v2-restore-fixtures.mjs';

test('populated authenticated refresh checkpoints survive normal private V2 restore and exact local history replay',async t=>{
 const f=await refreshRepositoryFixture(t),done=await completeRefreshRehearsal(f);
 const tables=['app_nft_refresh_revisions','app_private_artifacts','app_command_receipts','collect_assets','collect_operations','vault_assets','vault_observations'],before=Object.fromEntries(tables.map(n=>[n,f.db.prepare('SELECT * FROM '+n+' ORDER BY rowid').all()]));
 const ports={...f,...f.ports,now:f.clock.nowMs(),schema:await readInstalledRecoverySchema(f.crypto),codec:createManifestCodec({crypto:f.crypto})},v2Codec=createRecoveryV2Codec(ports),capture=createRecoveryV2Capture({...ports,v2Codec});
 let captured=await capture.start({captureId:'synthetic-refresh-populated',sourceCommit:'a'.repeat(40)});
 for(let n=0;n<5000&&captured.kind!=='captured';n++){assert.ok(['started','progress','replayed'].includes(captured.kind),JSON.stringify(captured));captured=await capture.step({captureId:captured.captureId,expectedRevision:captured.revision});}assert.equal(captured.kind,'captured');
 const target=v2RestoreTarget(t,{...ports,v2Codec,captured},{faults:['lost-final-ack']}),batch=target.driver.batch;let omit=true,lose=true;
 target.driver.batch=async statements=>{if(statements.some(s=>s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks')&&s.values[1]==='nft-refresh')){if(omit){omit=false;return batch(statements.filter(s=>!s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks')));}const out=await batch(statements);if(lose){lose=false;throw Error('Synthetic lost refresh proof acknowledgement');}return out;}return batch(statements);};
 let r=await target.call('start'),peak=0,omissionChecked=false,lostChecked=false;const phases={};
 for(let n=0;n<5000&&['started','progress','replayed'].includes(r.kind);n++){const row=target.db.prepare('SELECT checkpoint_json FROM app_recovery_runs').get();if(row){const bytes=Buffer.byteLength(row.checkpoint_json),phase=JSON.parse(row.checkpoint_json).phase;peak=Math.max(peak,bytes);phases[phase]=Math.max(phases[phase]??0,bytes);}r=await target.call('step');if(!omit&&!omissionChecked){omissionChecked=true;assert.equal(r.kind,'conflict');assert.equal(target.db.prepare("SELECT COUNT(*) n FROM app_recovery_reconcile_checks WHERE phase='nft-refresh'").get().n,0);r=await target.call('step');assert.equal(r.kind,'replayed');lostChecked=true;assert.equal(target.db.prepare("SELECT COUNT(*) n FROM app_recovery_reconcile_checks WHERE phase='nft-refresh'").get().n,1);}}
 assert.equal(r.kind,'restored',JSON.stringify(r));assert.ok(peak<=131072);assert.equal(target.db.prepare('SELECT status FROM app_recovery_state').get().status,'ready');
 for(const n of tables)assert.deepEqual(target.db.prepare('SELECT * FROM '+n+' ORDER BY rowid').all(),before[n],n);
 for(const row of before.app_private_artifacts){assert.deepEqual(target.store.objects.get(row.object_key),f.store.objects.get(row.object_key),row.object_key);}
 const repo=createRefreshRepository(target.driver,{...f.ports,artifacts:target.store}),found=await repo.read(REFRESH_OWNER,{requestId:done.ref.requestId});assert.equal(found.kind,'found',JSON.stringify(found));assert.deepEqual(found.value.state,done.state);assert.equal(found.value.state.history.length,6);assert.equal(found.value.state.rehearsalOnly,true);assert.equal(found.value.state.metadataApplied,false);
 target.db.prepare("UPDATE app_operator_scopes SET enabled=0 WHERE operator=? AND scope='nft-refresh'").run(REFRESH_OPERATOR.id);
 for(const command of done.commands){const replay=await repo.execute(command);assert.equal(replay.kind,'replayed');}
 assert.equal((await repo.read({kind:'wallet',wallet:REFRESH_BUYER},{requestId:done.ref.requestId})).kind,'missing');
 assert.deepEqual(target.db.prepare('SELECT * FROM app_nft_refresh_revisions ORDER BY rowid').all(),before.app_nft_refresh_revisions);
 assert.ok(omissionChecked&&lostChecked);assert.equal(target.checkpoint().nftRefreshComplete,true);assert.equal(target.db.prepare("SELECT COUNT(*) n FROM app_recovery_reconcile_checks WHERE phase='nft-refresh'").get().n,7);assert.equal(target.db.prepare("SELECT item_count FROM app_recovery_reconcile_checks WHERE phase='nft-refresh-count'").get().item_count,7);
 assert.ok(target.metrics.every(m=>m.sql+m.objectReads+m.objectWrites<=64&&m.maxBatchBytes<=262144));t.diagnostic(JSON.stringify({revisions:7,objects:before.app_private_artifacts.length,steps:target.metrics.length,checkpointPeak:peak,phases,maxOperations:Math.max(...target.metrics.map(m=>m.sql+m.objectReads+m.objectWrites)),maxBatchBytes:Math.max(...target.metrics.map(m=>m.maxBatchBytes)),fullHistoryReplay:true,independentRefreshSemanticPhase:true,omittedProofRollback:true,lostProofReplay:true,financialExecution:false}));
});
