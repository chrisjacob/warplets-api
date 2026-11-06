import test from 'node:test';
import assert from 'node:assert/strict';
import {fullAdoptionTarget,assertFullAdoptionReady} from './v2-adoption-full.fixtures.mjs';
import {pendingReplaySource,pauseSql,businessSnapshot,assertReplays} from './v2-ready-business-replay.fixtures.mjs';
import {dispatchImportedLifecycle} from '../collect/imported-lifecycle-test-harness.mjs';
test('normal V2 ready target replays the original pending mint after pause, scope revocation, close and source loss',async t=>{
 const f=await pendingReplaySource(t),target=fullAdoptionTarget(t,f);let result=await target.call('start'),calls=1;
 while(result.kind!=='restored'&&calls++<10000){assert.ok(['started','progress','replayed'].includes(result.kind),JSON.stringify(result));result=await target.call();}await assertFullAdoptionReady(target,f,result);
 target.db.prepare('UPDATE app_operator_scopes SET enabled=0,revision=revision+1').run();target.db.prepare(pauseSql).run(f.replayRequest.nowMs);f.store.objects.clear();
 const all=async q=>target.db.prepare(q).all(),before=await businessSnapshot(all),request=f.replayRequest,call=input=>dispatchImportedLifecycle({driver:target.driver,crypto:f.crypto,store:target.store,request:{...request,input}});
 const replay=await call(request.input),changed=await call({...request.input,expectedTermsDigest:'0'.repeat(64)}),fresh=await call({...request.input,requestKey:'synthetic-recovered-new-key'});assertReplays(f.expected,replay.result,changed.result,fresh.result);assert.deepEqual(await businessSnapshot(all),before);assert.equal(target.db.prepare('SELECT COUNT(*) n FROM tx_intents').get().n,0);
 const pending=target.db.prepare('SELECT commitment,settled_ms FROM collect_operations WHERE id=?').get(replay.result.value.operationId);assert.equal(pending.settled_ms,null);assert.equal(pending.commitment,f.db.prepare('SELECT commitment FROM collect_operations WHERE id=?').get(replay.result.value.operationId).commitment);
 t.diagnostic(JSON.stringify({normalReady:true,syntheticPrerequisiteProof:false,acceptedReplayExact:true,sourceLost:true,afterPauseAndClose:true,scopesRevoked:true,businessTablesUnchanged:Object.keys(before).length,pendingCommitmentUnchanged:true,financialExecution:false,calls,maxRecoveryOperations:Math.max(...target.measurements.map(m=>m.sql+m.objectReads+m.objectWrites)),replaySql:replay.metrics.sql,freshReason:fresh.result.reason??fresh.result.code}));
});
