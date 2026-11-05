import test from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from './local-runtime.mjs';
import {cutoffScenario} from '../../application/fixtures/cutoff-scenario.mjs';
import {canonicalJson,utf8} from '../../security/canonical.mjs';
const tables=['app_operator_scopes','earn_fixture_campaigns','price_sources','earn_stake_reads','price_observations','ops_config_audit',
 'earn_submissions','earn_reviews','earn_owner_snapshots','app_command_receipts','app_epoch_freezes','app_private_artifacts',
 'app_evidence_sources','app_evidence_receipts','app_evidence_heads'];
test('D1/R2 snapshot service seals complete private inputs, recovers omitted/lost attempts and rejects scope correction',async t=>{
 const node=await cutoffScenario();t.after(()=>node.db.close());
 const secondPrincipal={kind:'operator',id:'synthetic-snapshot-recovery'};
 for(const scope of ['earn-snapshot','evidence-ingest','earn-settlement'])node.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(secondPrincipal.id,scope);
 const {mf,db}=await localRuntime(t,new URL('./fixtures/cutoff-snapshot-worker.ts',import.meta.url)),r2=await mf.getR2Bucket('MANIFESTS');
 // Copy only synthetic fixture application/provenance rows. No snapshot attempts
 // or sealed pointers exist yet. R2 receives the exact verified private bytes.
 for(const table of tables){
  const statements=node.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all().map(row=>{
   const keys=Object.keys(row);return db.prepare('INSERT INTO '+table+' ('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').bind(...Object.values(row));
  });
  for(let offset=0;offset<statements.length;offset+=100)await db.batch(statements.slice(offset,offset+100));
 }
 for(const [key,bytes] of node.objects)await r2.put(key,bytes,{httpMetadata:{contentType:key.endsWith('.json')?'application/json':'application/octet-stream'}});
 const call=async(fault,nowMs=node.clock.nowMs(),principal=node.principal)=>{
  const response=await mf.dispatchFetch('http://localhost/snapshot',{method:'POST',body:JSON.stringify({principal,query:node.query,nowMs,fault})});
  return {status:response.status,result:await response.json()};
 };
 const omitted=await call('omit-attempt');assert.equal(omitted.status,500);assert.match(omitted.result.error,/Missing snapshot attempt/);
 assert.equal(await db.prepare('SELECT COUNT(*) n FROM app_snapshot_attempts').first('n'),0);
 assert.equal(await db.prepare('SELECT COUNT(*) n FROM app_epoch_inputs').first('n'),0);
 const raced=await call('scope-race');assert.equal(raced.result.code,'revision_conflict');
 assert.equal(await db.prepare('SELECT COUNT(*) n FROM app_snapshot_attempts').first('n'),0);
 assert.equal(await db.prepare('SELECT COUNT(*) n FROM app_epoch_inputs').first('n'),0);
 await db.prepare("UPDATE app_operator_scopes SET enabled=1,revision=revision+1 WHERE operator=? AND scope='earn-snapshot'").bind(node.principal.id).run();
 const ready=await call('lose-response');assert.equal(ready.status,200);assert.equal(ready.result.kind,'committed',JSON.stringify(ready.result));
 assert.equal(await db.prepare('SELECT COUNT(*) n FROM app_snapshot_attempts').first('n'),1);
 assert.equal(await db.prepare('SELECT COUNT(*) n FROM manifest_catalog').first('n'),0);
 assert.equal(await db.prepare('SELECT COUNT(*) n FROM earn_boards').first('n'),0);
 const sealed=await db.prepare('SELECT * FROM app_complete_inputs').first(),root=await (await r2.get(sealed.object_key)).json();
 assert.equal(root.status,'ready');assert.equal(root.mode,'synthetic-fixture');assert.ok(root.artifacts.requirements.length);
 const input=await (await r2.get(root.inputObject.key)).json();
 assert.equal(await node.crypto.sha256(utf8(canonicalJson(input))),sealed.input_digest);
 const nodeReady=await node.service.assemble(node.principal,node.query);assert.equal(nodeReady.kind,'committed');
 const nodeSealed=node.db.prepare('SELECT * FROM app_complete_inputs').get(),nodeRoot=JSON.parse(new TextDecoder().decode(node.objects.get(nodeSealed.object_key)));
 assert.equal(root.requirementsDigest,nodeRoot.requirementsDigest);assert.equal(root.evidenceDigest,nodeRoot.evidenceDigest);
 assert.equal(sealed.input_digest,nodeSealed.input_digest,'portable service seals identical canonical economic inputs');
 for(const pages of Object.values(root.artifacts))for(const identity of pages){
  assert.ok(identity.key.startsWith('private/'));const bytes=new Uint8Array(await (await r2.get(identity.key)).arrayBuffer());
  assert.equal(bytes.byteLength,identity.size);assert.equal(await node.crypto.sha256(bytes),identity.byteDigest);
 }
 const replay=await call(undefined,node.clock.nowMs()+1000);assert.equal(replay.result.kind,'replayed');
 assert.equal(replay.result.value.manifestDigest,ready.result.value.manifestDigest);
 assert.equal(await db.prepare('SELECT COUNT(*) n FROM app_snapshot_attempts').first('n'),1);
 const recovered=await call(undefined,node.clock.nowMs()+2000,secondPrincipal);assert.equal(recovered.result.kind,'replayed',JSON.stringify(recovered.result));
 assert.equal(recovered.result.value.manifestDigest,ready.result.value.manifestDigest);
 assert.equal(await db.prepare('SELECT COUNT(*) n FROM app_snapshot_attempts').first('n'),1);
 assert.equal((await r2.list({prefix:'public/'})).objects.length,0);
});
