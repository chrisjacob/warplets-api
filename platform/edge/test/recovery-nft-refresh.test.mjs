import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {build} from 'esbuild';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {refreshRepositoryFixture,REFRESH_OWNER} from '../../nfts/refresh-repository.fixtures.mjs';
import {completeRefreshRehearsal} from '../../nfts/refresh-acceptance.fixtures.mjs';
import {createRecoveryV2Capture} from '../../recovery/v2-capture.mjs';
import {createRecoveryV2Codec} from '../../recovery/v2-codec.mjs';
import {createManifestCodec} from '../../artifacts/manifest-codec.mjs';
import {readInstalledRecoverySchema} from '../../recovery/node-schema.mjs';
import {canonicalJson,utf8} from '../../security/canonical.mjs';

async function runtime(t){
 const built=await build({entryPoints:[fileURLToPath(new URL('./fixtures/recovery-nft-refresh-worker.ts',import.meta.url))],bundle:true,platform:'browser',format:'esm',target:'es2022',write:false}),mf=new Miniflare({workers:[{config:{name:'refresh-private-recovery-test',type:'worker',compatibilityDate:'2026-08-25',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:built.outputFiles[0].text}}},env:{DB:{type:'d1',id:'00000000-0000-4000-8000-000000000001'},MANIFESTS:{type:'r2',name:'refresh-restored-target'},RECOVERY_SOURCE:{type:'r2',name:'refresh-pinned-source'}}}}]});t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB'),directory=new URL('../../storage/',import.meta.url);await db.exec('CREATE TABLE schema_versions(version TEXT PRIMARY KEY) STRICT');
 for(const name of readdirSync(directory).filter(n=>/^\d+.*\.sql$/.test(n)).sort()){const statements=[];let current='';for(const line of readFileSync(new URL(name,directory),'utf8').replace(/^--.*$/gm,'').split(/\r?\n/)){current+=(current?'\n':'')+line;const value=current.trim();if(value.endsWith(';')&&(!value.startsWith('CREATE TRIGGER')||/\bEND;$/i.test(value))){statements.push(db.prepare(value));current='';}}assert.equal(current.trim(),'');await db.batch(statements);await db.prepare('INSERT INTO schema_versions VALUES(?)').bind(name).run();}
 return {mf,db,source:await mf.getR2Bucket('RECOVERY_SOURCE'),target:await mf.getR2Bucket('MANIFESTS')};
}
test('actual D1/R2 full fresh populated refresh recovery preserves independently pinned private history and semantic coverage',async t=>{
 const f=await refreshRepositoryFixture(t),done=await completeRefreshRehearsal(f),schema=await readInstalledRecoverySchema(f.crypto),v2Codec=createRecoveryV2Codec(f),capture=createRecoveryV2Capture({...f,...f.ports,schema,v2Codec,codec:createManifestCodec(f)});
 // Independently retained original checkpoint identities; restore never discovers authority from target bytes.
 const originals=f.db.prepare('SELECT * FROM app_private_artifacts ORDER BY object_key').all().map(a=>({key:a.object_key,byteDigest:a.byte_digest,size:a.size,semanticDigest:a.semantic_digest,visibility:'private',contentType:a.content_type}));
 let captured=await capture.start({captureId:'synthetic-refresh-d1-populated',sourceCommit:'a'.repeat(40)});for(let n=0;n<5000&&['started','progress','replayed'].includes(captured.kind);n++)captured=await capture.step({captureId:captured.captureId,expectedRevision:captured.revision});assert.equal(captured.kind,'captured',JSON.stringify(captured));
 const pin=JSON.parse(JSON.stringify({root:captured.value,pinnedDigest:captured.digest}));assert.equal(await f.crypto.sha256(utf8(canonicalJson(pin.root))),pin.pinnedDigest);await v2Codec.verifyRoot(utf8(canonicalJson(pin.root)),pin.pinnedDigest);
 const objects=f.db.prepare('SELECT identity_json FROM app_recovery_capture_objects WHERE capture_id=? ORDER BY object_key').all(captured.captureId).map(r=>JSON.parse(r.identity_json)),r=await runtime(t);
 assert.equal((await r.target.list()).objects.length,0);assert.equal(await r.db.prepare('SELECT COUNT(*) n FROM app_nft_refresh_revisions').first('n'),0);
 for(const identity of objects){const bytes=f.store.objects.get(identity.key);assert.equal(bytes.length,identity.size);assert.equal(await f.crypto.sha256(bytes),identity.byteDigest);await r.source.put(identity.key,bytes,{httpMetadata:{contentType:identity.contentType}});}
 let revision=0,result=null,checkpointPeak=0;const metrics=[],phases={};
 for(let n=0;n<5000;n++){
  const response=await r.mf.dispatchFetch('http://localhost/__fixture',{method:'POST',body:JSON.stringify({method:result?'step':'start',input:{...pin,expectedRevision:revision},schema,nowMs:f.clock.nowMs()+86400000,fault:'lost-final-ack'})});assert.equal(response.status,200,await response.clone().text());const value=await response.json();result=value.result;metrics.push(value.metrics);
  const current=await r.db.prepare("SELECT length(CAST(checkpoint_json AS BLOB)) bytes,json_extract(checkpoint_json,'$.phase') phase FROM app_recovery_runs WHERE id=?").bind(pin.pinnedDigest).first();if(current){checkpointPeak=Math.max(checkpointPeak,current.bytes);phases[current.phase]=Math.max(phases[current.phase]??0,current.bytes);}
  if(result.kind==='restored')break;assert.ok(['started','progress','replayed'].includes(result.kind),JSON.stringify(result));revision=result.revision;
 }
 assert.equal(result.kind,'restored',JSON.stringify(result));assert.equal(await r.db.prepare('SELECT status FROM app_recovery_state').first('status'),'ready');assert.ok(checkpointPeak<=131072);
 assert.equal(await r.db.prepare("SELECT COUNT(*) n FROM app_recovery_reconcile_checks WHERE phase='nft-refresh'").first('n'),7);assert.equal(await r.db.prepare("SELECT item_count FROM app_recovery_reconcile_checks WHERE phase='nft-refresh-count' AND scope='complete'").first('item_count'),7);
 const checkpoint=JSON.parse(await r.db.prepare('SELECT checkpoint_json FROM app_recovery_runs WHERE id=?').bind(pin.pinnedDigest).first('checkpoint_json'));assert.equal(checkpoint.nftRefreshComplete,true);assert.equal(checkpoint.checkedNftRefresh,7);
 for(const table of ['app_nft_refresh_revisions','app_private_artifacts','app_command_receipts','collect_assets','collect_operations','vault_assets','vault_observations'])assert.deepEqual((await r.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()).results,JSON.parse(JSON.stringify(f.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all())),table);
 // Revalidate EVERY captured private descriptor/page/object and every original pin after target restart requests.
 for(const identity of objects){const value=await r.target.get(identity.key);assert.ok(value,identity.key);const bytes=new Uint8Array(await value.arrayBuffer());assert.equal(bytes.length,identity.size);assert.equal(await f.crypto.sha256(bytes),identity.byteDigest);}
 for(const identity of originals){const value=await r.target.get(identity.key),bytes=new Uint8Array(await value.arrayBuffer());assert.deepEqual(bytes,f.store.objects.get(identity.key));assert.equal(await f.crypto.sha256(bytes),identity.byteDigest);}
 const loaded=await r.mf.dispatchFetch('http://localhost/__fixture',{method:'POST',body:JSON.stringify({method:'refresh-read',nowMs:f.clock.nowMs()+86400000,principal:REFRESH_OWNER,requestId:done.ref.requestId})});assert.equal(loaded.status,200);const found=await loaded.json();assert.equal(found.kind,'found',JSON.stringify(found));assert.deepEqual(found.value.state,done.state);assert.equal(found.value.state.history.length,6);assert.deepEqual(found.value.state.job,done.state.job);assert.equal(found.value.state.metadataApplied,false);assert.equal(found.value.state.receiptAuthenticity,'unverified');
 assert.ok(metrics.every(m=>m.sql+m.objectReads+m.objectWrites<=64&&m.returnedBytes+m.objectBytes+m.maxBatchBytes<=1048576));
 t.diagnostic(JSON.stringify({steps:metrics.length,tables:result.report.tables,originalObjects:originals.length,capturedObjects:objects.length,revisionChecks:7,checkpointPeak,phases,maxOperations:Math.max(...metrics.map(m=>m.sql+m.objectReads+m.objectWrites)),maxBatchBytes:Math.max(...metrics.map(m=>m.maxBatchBytes)),maxSerializedWorkingBytes:Math.max(...metrics.map(m=>m.returnedBytes+m.objectBytes+m.maxBatchBytes)),separateBuckets:true,independentPins:true,fullHistory:true,financialExecution:false,metadataApplied:false}));
});
