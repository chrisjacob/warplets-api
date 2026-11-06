import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {build} from 'esbuild';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {pendingReplaySource,pauseSql,businessSnapshot,assertReplays} from '../../recovery/v2-ready-business-replay.fixtures.mjs';
async function runtime(t){
 const bundle=await build({entryPoints:[fileURLToPath(new URL('./fixtures/recovery-ready-business-replay-worker.ts',import.meta.url))],bundle:true,platform:'browser',format:'esm',write:false,target:'es2022'}),mf=new Miniflare({workers:[{config:{name:'recovery-v2-private-test',type:'worker',compatibilityDate:'2026-08-25',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env:{DB:{type:'d1',id:'00000000-0000-4000-8000-000000000001'},MANIFESTS:{type:'r2',name:'recovery-v2-target'},RECOVERY_SOURCE:{type:'r2',name:'recovery-v2-source'}}}}]});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB'),directory=new URL('../../storage/',import.meta.url);await db.exec('CREATE TABLE schema_versions(version TEXT PRIMARY KEY) STRICT');
 for(const name of readdirSync(directory).filter(n=>/^\d+.*\.sql$/.test(n)).sort()){const statements=[];let current='';for(const line of readFileSync(new URL(name,directory),'utf8').replace(/^--.*$/gm,'').split(/\r?\n/)){current+=(current?'\n':'')+line;const value=current.trim();if(value.endsWith(';')&&(!value.startsWith('CREATE TRIGGER')||/\bEND;$/i.test(value))){statements.push(db.prepare(value));current='';}}assert.equal(current.trim(),'');await db.batch(statements);await db.prepare('INSERT INTO schema_versions VALUES(?)').bind(name).run();}
 return {mf,db,source:await mf.getR2Bucket('RECOVERY_SOURCE'),target:await mf.getR2Bucket('MANIFESTS')};
}



test('normal actual D1/R2 ready target preserves accepted pending business replay after denial and source loss',async t=>{
 const f=await pendingReplaySource(t),r=await runtime(t),input={root:f.captured.value,pinnedDigest:f.captured.digest};
 for(const row of f.db.prepare('SELECT identity_json FROM app_recovery_capture_objects WHERE capture_id=?').all(f.captured.captureId)){const id=JSON.parse(row.identity_json),object=await f.store.getVerified(id);assert.equal(object.status,'verified');await r.source.put(id.key,object.bytes,{httpMetadata:{contentType:id.contentType}});}
 let revision=0,calls=0;const metrics=[];
 const call=async body=>{const response=await r.mf.dispatchFetch('http://localhost/__fixture',{method:'POST',body:JSON.stringify(body)}),value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;};
 const recover=async method=>{const data=await call({method,input:{...input,expectedRevision:revision},schema:f.schema,nowMs:f.now});if(Number.isSafeInteger(data.result.revision))revision=data.result.revision;metrics.push(data.metrics);assert.ok(data.checkpointBytes<=131072);return data.result;};
 let result=await recover('start');while(result.kind!=='restored'&&calls++<10000){assert.ok(['started','progress','replayed'].includes(result.kind),JSON.stringify(result));result=await recover('step');}
 assert.equal(result.kind,'restored',JSON.stringify(result));assert.equal(result.report.financialExecution,false);assert.equal(await r.db.prepare('SELECT status FROM app_recovery_state').first('status'),'ready');assert.equal(await r.db.prepare("SELECT COUNT(*) n FROM app_recovery_reconcile_checks WHERE phase='legacy-adoption-complete'").first('n'),1);
 await r.db.batch([r.db.prepare('UPDATE app_operator_scopes SET enabled=0,revision=revision+1'),r.db.prepare(pauseSql).bind(f.replayRequest.nowMs)]);
 for(const row of f.db.prepare('SELECT identity_json FROM app_recovery_capture_objects WHERE capture_id=?').all(f.captured.captureId))await r.source.delete(JSON.parse(row.identity_json).key);
 const all=async q=>(await r.db.prepare(q).all()).results,before=await businessSnapshot(all),request=f.replayRequest,business=input=>call({method:'business-replay',request:{...request,input}});
 const replay=await business(request.input),changed=await business({...request.input,expectedTermsDigest:'0'.repeat(64)}),fresh=await business({...request.input,requestKey:'synthetic-recovered-new-key'});assertReplays(f.expected,replay.result,changed.result,fresh.result);assert.deepEqual(await businessSnapshot(all),before);assert.equal(await r.db.prepare('SELECT COUNT(*) n FROM tx_intents').first('n'),0);
 const pending=await r.db.prepare('SELECT commitment,settled_ms FROM collect_operations WHERE id=?').bind(replay.result.value.operationId).first();assert.equal(pending.settled_ms,null);assert.equal(pending.commitment,f.db.prepare('SELECT commitment FROM collect_operations WHERE id=?').get(replay.result.value.operationId).commitment);
 assert.ok(metrics.every(m=>m.sql+m.objectReads+m.objectWrites<=64&&m.maxBatchBytes<=262144));t.diagnostic(JSON.stringify({actualD1:true,actualR2:true,normalReady:true,syntheticPrerequisiteProof:false,acceptedNodeD1ReplayParity:true,sourceLost:true,afterPauseAndClose:true,scopesRevoked:true,businessTablesUnchanged:Object.keys(before).length,pendingCommitmentUnchanged:true,financialExecution:false,calls,maxRecoveryOperations:Math.max(...metrics.map(m=>m.sql+m.objectReads+m.objectWrites)),replaySql:replay.metrics.sql,freshReason:fresh.result.reason??fresh.result.code}));
});
