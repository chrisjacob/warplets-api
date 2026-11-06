import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {build} from 'esbuild';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {recordedPreparationRecoverySource} from '../../recovery/recorded-preparation.fixtures.mjs';
async function runtime(t){
 const bundle=await build({entryPoints:[fileURLToPath(new URL('./fixtures/recovery-v2-restore-worker.ts',import.meta.url))],bundle:true,platform:'browser',format:'esm',write:false,target:'es2022'}),mf=new Miniflare({workers:[{config:{name:'recovery-v2-private-test',type:'worker',compatibilityDate:'2026-08-25',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env:{DB:{type:'d1',id:'00000000-0000-4000-8000-000000000001'},MANIFESTS:{type:'r2',name:'recovery-v2-target'},RECOVERY_SOURCE:{type:'r2',name:'recovery-v2-source'}}}}]});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB'),directory=new URL('../../storage/',import.meta.url);await db.exec('CREATE TABLE schema_versions(version TEXT PRIMARY KEY) STRICT');
 for(const name of readdirSync(directory).filter(n=>/^\d+.*\.sql$/.test(n)).sort()){const statements=[];let current='';for(const line of readFileSync(new URL(name,directory),'utf8').replace(/^--.*$/gm,'').split(/\r?\n/)){current+=(current?'\n':'')+line;const value=current.trim();if(value.endsWith(';')&&(!value.startsWith('CREATE TRIGGER')||/\bEND;$/i.test(value))){statements.push(db.prepare(value));current='';}}assert.equal(current.trim(),'');await db.batch(statements);await db.prepare('INSERT INTO schema_versions VALUES(?)').bind(name).run();}
 return {mf,db,source:await mf.getR2Bucket('RECOVERY_SOURCE'),target:await mf.getR2Bucket('MANIFESTS')};
}
test('actual fresh D1/R2 restore independently verifies genuine unsigned preparation expiry replacement expiry history',async t=>{
 const f=await recordedPreparationRecoverySource(t),r=await runtime(t),objects=f.db.prepare('SELECT identity_json FROM app_recovery_capture_objects WHERE capture_id=?').all(f.captured.captureId).map(row=>JSON.parse(row.identity_json));
 for(const identity of objects)await r.source.put(identity.key,f.store.objects.get(identity.key),{httpMetadata:{contentType:identity.contentType}});
 let revision=0,result,lost=false;const metrics=[];
 for(let n=0;n<5000;n++){const response=await r.mf.dispatchFetch('http://localhost/__fixture',{method:'POST',body:JSON.stringify({method:result?'step':'start',input:{root:f.captured.value,pinnedDigest:f.captured.digest,expectedRevision:revision},schema:f.schema,nowMs:f.now,fault:'lost-final-ack'})});assert.equal(response.status,200,await response.clone().text());const output=await response.json();result=output.result;metrics.push(output.metrics);lost||=output.faulted;if(result.kind==='restored')break;assert.ok(['started','progress','replayed'].includes(result.kind),JSON.stringify(result));revision=result.revision;}
 assert.equal(result.kind,'restored',JSON.stringify(result));assert.equal(lost,true);assert.equal(await r.db.prepare('SELECT status FROM app_recovery_state').first('status'),'ready');
 for(const table of ['tx_intents','tx_attempts','tx_receipts','app_recorded_attempt_expiries','app_recorded_attempt_preparations'])assert.deepEqual((await r.db.prepare('SELECT rowid,* FROM '+table+' ORDER BY rowid').all()).results,f.db.prepare('SELECT rowid,* FROM '+table+' ORDER BY rowid').all().map(v=>({...v})));
 assert.equal(await r.db.prepare("SELECT COUNT(*) n FROM app_recovery_reconcile_checks WHERE phase='recorded-preparation'").first('n'),2);assert.equal(await r.db.prepare("SELECT COUNT(*) n FROM app_recovery_reconcile_checks WHERE phase='recorded-expiry-history'").first('n'),1);
 assert.ok(metrics.every(m=>m.sql+m.objectReads+m.objectWrites<=64&&m.maxBatchBytes<=262144&&m.returnedBytes+m.objectBytes+m.maxBatchBytes<=1048576));t.diagnostic(JSON.stringify({tables:result.report.tables,steps:metrics.length,legacyEvents:0,boundExpiries:2,boundPreparations:2,originalReceiptBytesAndOrder:true,maxOperations:Math.max(...metrics.map(m=>m.sql+m.objectReads+m.objectWrites)),maxBatchBytes:Math.max(...metrics.map(m=>m.maxBatchBytes)),maxSerializedWorkingBytes:Math.max(...metrics.map(m=>m.returnedBytes+m.objectBytes+m.maxBatchBytes)),chainAuthority:'unverified',financialExecution:false}));
});
