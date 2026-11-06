import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {build} from 'esbuild';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {recoveryLegacyAdoptionSource} from '../../recovery/v2-legacy-adoption-fixtures.mjs';
async function runtime(t){
 const bundle=await build({entryPoints:[fileURLToPath(new URL('./fixtures/recovery-legacy-current-worker.ts',import.meta.url))],bundle:true,platform:'browser',format:'esm',write:false,target:'es2022'}),mf=new Miniflare({workers:[{config:{name:'recovery-v2-private-test',type:'worker',compatibilityDate:'2026-08-25',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env:{DB:{type:'d1',id:'00000000-0000-4000-8000-000000000001'},MANIFESTS:{type:'r2',name:'recovery-v2-target'},RECOVERY_SOURCE:{type:'r2',name:'recovery-v2-source'}}}}]});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB'),directory=new URL('../../storage/',import.meta.url);await db.exec('CREATE TABLE schema_versions(version TEXT PRIMARY KEY) STRICT');
 for(const name of readdirSync(directory).filter(n=>/^\d+.*\.sql$/.test(n)).sort()){const statements=[];let current='';for(const line of readFileSync(new URL(name,directory),'utf8').replace(/^--.*$/gm,'').split(/\r?\n/)){current+=(current?'\n':'')+line;const value=current.trim();if(value.endsWith(';')&&(!value.startsWith('CREATE TRIGGER')||/\bEND;$/i.test(value))){statements.push(db.prepare(value));current='';}}assert.equal(current.trim(),'');await db.batch(statements);await db.prepare('INSERT INTO schema_versions VALUES(?)').bind(name).run();}
 return {mf,db,source:await mf.getR2Bucket('RECOVERY_SOURCE'),target:await mf.getR2Bucket('MANIFESTS')};
}
import {hashJson} from '../../recovery/inventory.mjs';
import {canonicalJson} from '../../security/canonical.mjs';
test('actual fresh D1 target verifies legacy current graph with explicitly synthetic original-mint prerequisite',async t=>{
 const f=await recoveryLegacyAdoptionSource(t),r=await runtime(t),identities=f.db.prepare('SELECT identity_json FROM app_recovery_capture_objects WHERE capture_id=?').all(f.captured.captureId).map(x=>JSON.parse(x.identity_json));for(const id of identities)await r.source.put(id.key,f.store.objects.get(id.key),{httpMetadata:{contentType:id.contentType}});
 const input={root:f.captured.value,pinnedDigest:f.captured.digest};let revision=0;
 const call=async(method='step',fault)=>{const response=await r.mf.dispatchFetch('http://localhost/__fixture',{method:'POST',body:JSON.stringify({method,fault,input:{...input,expectedRevision:revision},schema:f.schema,nowMs:f.now})});assert.equal(response.status,200,await response.clone().text());const data=await response.json();if(Number.isSafeInteger(data.result.revision))revision=data.result.revision;return data;};
 let data=await call('start');for(let n=0;n<5000&&data.result.phase!=='reconcile-audit';n++){assert.ok(['started','progress','replayed'].includes(data.result.kind),JSON.stringify(data.result));data=await call();}assert.equal(data.result.phase,'reconcile-audit');
 const c=JSON.parse(await r.db.prepare('SELECT checkpoint_json FROM app_recovery_runs WHERE id=?').bind(input.pinnedDigest).first('checkpoint_json')),row=await r.db.prepare('SELECT * FROM app_collection_legacy_mint_anchors LIMIT 1').first(),anchor=JSON.parse(row.body_json);
 c.phase='reconcile-legacy-adoption-current';c.legacyAdoption={id:anchor.adoptionId,currentOrdinal:0};
 const checkpoint=canonicalJson(c),reset=async()=>{await r.db.batch([r.db.prepare("UPDATE app_recovery_runs SET state='restoring',checkpoint_json=?,report_json=NULL WHERE id=?").bind(checkpoint,input.pinnedDigest),r.db.prepare("UPDATE app_recovery_state SET status='restoring',write_nonce=NULL WHERE active_restore_id=?").bind(input.pinnedDigest)]);revision=c.revision;};
 await reset();data=await call('current');assert.equal(data.result.kind,'held');assert.match(data.result.reason,/original mint semantic proof/);
 // Deliberately synthetic prerequisite, isolating this private adapter only.
 await r.db.prepare('INSERT INTO app_recovery_reconcile_checks VALUES(?,?,?,?,?,?,?)').bind(input.pinnedDigest,'legacy-adoption-mint',anchor.adoptionId,anchor.ordinal,c.targetWatermark,await hashJson(f.crypto,['v2-legacy-original-mint',anchor.adoptionId,anchor.ordinal,row.body_digest,anchor.originalOutcome]),1).run();
 await reset();data=await call('current','omit-current-proof');assert.equal(data.result.kind,'conflict');assert.equal(await r.db.prepare("SELECT COUNT(*) n FROM app_recovery_reconcile_checks WHERE phase='legacy-adoption-current'").first('n'),0);assert.equal(await r.db.prepare('SELECT checkpoint_json FROM app_recovery_runs WHERE id=?').bind(input.pinnedDigest).first('checkpoint_json'),checkpoint);
 data=await call('current');assert.equal(data.result.kind,'progress',JSON.stringify(data));assert.equal(await r.db.prepare("SELECT COUNT(*) n FROM app_recovery_reconcile_checks WHERE phase='legacy-adoption-current'").first('n'),1);assert.ok(data.metrics.every(m=>m.workingBytes<=1048576&&m.sql<=64));
 data=await call('current');assert.equal(data.result.phase,'reconcile-legacy-adoption-closure');assert.equal(await r.db.prepare('SELECT status FROM app_recovery_state').first('status'),'restoring');
 t.diagnostic(JSON.stringify({syntheticPrerequisiteProof:true,fullReadiness:false,freshD1Target:true,sourceObjects:identities.length}));
});
