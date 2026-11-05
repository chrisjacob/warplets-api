import test from 'node:test';
import assert from 'node:assert/strict';
import {cutoffScenario} from '../application/fixtures/cutoff-scenario.mjs';
import {createCutoffSnapshotService} from './snapshot.mjs';
import {createCutoffSnapshotRepository} from '../storage/cutoff-snapshot.mjs';
import {createSettlementCommand,COMMIT_BOARD,settlementFenceKey} from '../storage/atomic-settlement.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {computeBoard} from './settlement.mjs';
import {evidenceFixture} from '../evidence/fixtures.mjs';
test('complete synthetic coverage seals stable private input and feeds the fenced settlement command',async t=>{
 const env=await cutoffScenario();t.after(()=>env.db.close());
 const result=await env.service.assemble(env.principal,env.query);assert.equal(result.kind,'committed',JSON.stringify(result));
 assert.equal(env.db.prepare('SELECT COUNT(*) n FROM app_snapshot_attempts').get().n,1);
 assert.equal(env.db.prepare('SELECT COUNT(*) n FROM manifest_catalog').get().n,0);
 const sealed=env.db.prepare('SELECT * FROM app_complete_inputs').get(),root=JSON.parse(new TextDecoder().decode(env.objects.get(sealed.object_key)));
 assert.equal(root.status,'ready');assert.equal(root.mode,'synthetic-fixture');assert.ok(root.artifacts.requirements.length);
 const input=JSON.parse(new TextDecoder().decode(env.objects.get(root.inputObject.key)));assert.equal(await env.crypto.sha256(utf8(canonicalJson(input))),sealed.input_digest);
 env.advance(1000);const replay=await env.service.assemble(env.principal,env.query);assert.equal(replay.kind,'replayed');assert.equal(replay.value.manifestDigest,result.value.manifestDigest);
 assert.equal(env.db.prepare('SELECT COUNT(*) n FROM app_snapshot_attempts').get().n,1);
 const plan=computeBoard(input),command=await createSettlementCommand(COMMIT_BOARD,{principal:env.principal,requestKey:'fixture-board',nowMs:env.clock.nowMs(),
  input:{epoch:env.epoch,manifestDigest:result.value.manifestDigest,planDigest:await env.crypto.sha256(utf8(canonicalJson(plan)))}},env.crypto);
 const lease={businessKey:settlementFenceKey(COMMIT_BOARD,command.input),token:'fixture-lease',revision:'1',payloadDigest:command.requestDigest};
 env.db.prepare('INSERT INTO app_execution_fences(business_key,holder_token,revision,payload_digest,expires_ms) VALUES(?,?,?,?,?)').run(lease.businessKey,lease.token,1,lease.payloadDigest,env.clock.nowMs()+10000);
 assert.equal((await env.settlementRepository.commitBoard(command,lease)).kind,'committed');
 assert.equal(env.db.prepare('SELECT COUNT(*) n FROM earn_boards').get().n,1);
});
test('missing coverage persists named private dependency attempt and never seals an empty board',async t=>{
 const env=await cutoffScenario({complete:false,post:false});t.after(()=>env.db.close());
 const result=await env.service.assemble(env.principal,env.query);assert.equal(result.reason,'snapshot-dependencies');assert.ok(result.dependencyIds.length);
 assert.equal(env.db.prepare('SELECT status FROM app_snapshot_attempts').get().status,'pending');
 assert.equal(env.db.prepare('SELECT COUNT(*) n FROM app_epoch_inputs').get().n,0);
 assert.equal(env.db.prepare('SELECT COUNT(*) n FROM earn_boards').get().n,0);
 assert.equal((await env.service.assemble(env.principal,env.query)).manifestDigest,result.manifestDigest);
});
test('late read correction after artifact writes rejects attempt and pointer',async t=>{
 const env=await cutoffScenario();t.after(()=>env.db.close());let corrected=false;
 const references={async persist(...args){const result=await env.privateReferences.persist(...args);
  if(!corrected){corrected=true;env.db.prepare("UPDATE earn_reviews SET reason='new review'").run();}return result;}};
 const service=createCutoffSnapshotService({repository:env.repository,settlementRepository:env.settlementRepository,privateReferences:references,...env.ports});
 assert.equal((await service.assemble(env.principal,env.query)).code,'revision_conflict');
 assert.equal(env.db.prepare('SELECT COUNT(*) n FROM app_snapshot_attempts').get().n,0);
 assert.equal(env.db.prepare('SELECT COUNT(*) n FROM app_epoch_inputs').get().n,0);
 assert.equal((await env.service.assemble(env.principal,env.query)).kind,'committed');
});
test('omitted snapshot attempt child rolls back, and committed response loss recovers from receipt',async t=>{
 const env=await cutoffScenario();t.after(()=>env.db.close());
 const omit={...env.driver,async batch(statements){return env.driver.batch(statements.filter(s=>!s.sql.startsWith('INSERT INTO app_snapshot_attempts')));}};
 const make=driver=>createCutoffSnapshotService({repository:createCutoffSnapshotRepository(driver,env.ports),settlementRepository:env.settlementRepository,privateReferences:env.privateReferences,...env.ports});
 await assert.rejects(make(omit).assemble(env.principal,env.query),/Missing snapshot attempt/);
 assert.equal(env.db.prepare('SELECT COUNT(*) n FROM app_snapshot_attempts').get().n,0);
 let lost=false;const loss={...env.driver,async batch(statements){const result=await env.driver.batch(statements);
  if(!lost&&statements.some(s=>s.sql.startsWith('INSERT INTO app_snapshot_attempts'))){lost=true;throw Error('response lost');}return result;}};
 assert.equal((await make(loss).assemble(env.principal,env.query)).kind,'committed');assert.equal(lost,true);
 assert.equal(env.db.prepare('SELECT COUNT(*) n FROM app_snapshot_attempts').get().n,1);
});
test('enrolled position requires matching complete journal and daily checkpoint before sealing',async t=>{
 const env=await cutoffScenario({position:true});t.after(()=>env.db.close());
 const inventory=await env.repository.loadInventory({...env.query,nowMs:env.clock.nowMs()});assert.equal(inventory.walletDetails[0].chains[0].chain.status,'ready');
 assert.equal((await env.service.assemble(env.principal,env.query)).kind,'committed');
 env.db.prepare('UPDATE earn_position_cutoffs SET flags=?').run('[]');
 const broken=await env.service.assemble(env.principal,env.query);assert.equal(broken.reason,'snapshot-dependencies');
 const row=env.db.prepare("SELECT * FROM app_snapshot_attempts WHERE status='pending'").get();
 assert.ok(row);assert.notEqual(row.manifest_digest,env.db.prepare('SELECT manifest_digest FROM app_epoch_inputs').get().manifest_digest);
});
test('every required external binding is mandatory and a mismatched registered price policy stays pending',async t=>{
 const env=await cutoffScenario();t.after(()=>env.db.close());
 for(const binding of env.query.sourceBindings){
  const query={...env.query,sourceBindings:env.query.sourceBindings.filter(b=>b!==binding)};
  assert.equal((await env.service.assemble(env.principal,query)).reason,'snapshot-dependencies',binding.kind);
 }
 assert.equal(env.db.prepare('SELECT COUNT(*) n FROM app_epoch_inputs').get().n,0);
 const price=env.fixtures.find(f=>f.requirement.kind==='entry-stake'),wrong={...price.source,sourceId:'wrong-pool',policy:{...price.source.policy,pool:'fixture-other-pool'}};
 assert.equal((await env.evidenceService.registerSource(env.principal,wrong)).kind,'committed');
 const sourceBindings=env.query.sourceBindings.map(b=>b.kind==='entry-stake'?{...b,sourceId:wrong.sourceId}:b);
 const inventory=await env.repository.loadInventory({...env.query,sourceBindings,nowMs:env.clock.nowMs()});
 assert.equal(inventory.inputs.find(i=>i.authority==='evidence'&&i.kind==='entry-stake').pendingReason,'source-policy-mismatch');
});
test('new current incomplete correction masks prior verified evidence and cannot replace the sealed pointer',async t=>{
 const env=await cutoffScenario();t.after(()=>env.db.close());const first=await env.service.assemble(env.principal,env.query);
 const owner=env.fixtures.find(f=>f.requirement.kind==='ownership'),subject=owner.source.subject;
 const payload={version:1,network:'local-solana',kind:'ownership',subject,fromMs:env.cutoff,toMs:env.cutoff,complete:false,pages:[]};
 const next=await evidenceFixture({crypto:env.crypto,payload,policy:owner.source.policy,subject,decoderVersion:owner.source.decoderVersion,now:env.cutoff});
 next.source.sourceId=owner.source.sourceId;next.source.sourceRevision='v2';next.request.sourceId=next.source.sourceId;next.request.sourceRevision='v2';
 env.readers.set(canonicalJson([next.source.sourceId,'v2']),next.reader);
 assert.equal((await env.evidenceService.registerSource(env.principal,next.source)).kind,'committed');
 const corrected=await env.evidenceService.ingest(env.principal,{...next.request,supersedes:owner.receipt.receiptDigest});
 assert.equal(corrected.value.decision.status,'pending');
 const result=await env.service.assemble(env.principal,env.query);assert.equal(result.reason,'snapshot-dependencies');
 assert.equal(env.db.prepare('SELECT manifest_digest FROM app_epoch_inputs').get().manifest_digest,first.value.manifestDigest);
});
test('another authorized operator reuses exact private pages and immutable snapshot identity',async t=>{
 const env=await cutoffScenario();t.after(()=>env.db.close());const second={kind:'operator',id:'other-synthetic-operator'};
 for(const scope of ['earn-snapshot','evidence-ingest'])env.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(second.id,scope);
 const first=await env.service.assemble(env.principal,env.query);assert.equal(first.kind,'committed');
 const result=await env.service.assemble(second,env.query);assert.equal(result.kind,'replayed',JSON.stringify(result));assert.equal(result.value.manifestDigest,first.value.manifestDigest);
 assert.equal(env.db.prepare('SELECT COUNT(*) n FROM app_snapshot_attempts').get().n,1);
});
