import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {recoveryFixture,memoryArtifacts} from './fixtures.mjs';
import {createPublicRecovery,createPrivateRecovery} from './restore.mjs';
import {readPublicRecoveredClaims,reconcileRecovery} from './reconcile.mjs';
import {createJobRepository} from '../jobs/repository.mjs';
import {createJobCommand} from '../jobs/model.mjs';
import {canonicalJson} from '../security/canonical.mjs';
import {addCampaign,recordAllocation} from '../earn/workflow.mjs';
import {exportBoard} from '../earn/archive.mjs';
import {createRecoveryExporter} from './export.mjs';

function target(t,f,mode,extra={}){const db=openDatabase();t.after(()=>db.close());const driver=createNodeAtomicDriver(db),artifacts=memoryArtifacts();return {db,driver,artifacts,
 service:(mode==='public'?createPublicRecovery:createPrivateRecovery)({...f,driver,artifacts,sourceArtifacts:f.store,...extra})};}
test('independently pinned public recovery imports only awards, stays mutation-disabled and keeps years-later claims',async t=>{
 const f=await recoveryFixture();t.after(()=>f.db.close());const captured=await f.exporter.capturePublic();assert.equal(captured.kind,'captured');
 assert.equal(captured.inventory.schema,null);assert.deepEqual(captured.inventory.tables,[]);assert.doesNotMatch(canonicalJson(captured.inventory),/Synthetic assessment|example.test|session_hash/);
 const pin=captured.digest,targetDb=target(t,f,'public'),input={inventory:captured.inventory,pinnedDigest:pin};
 await assert.rejects(()=>targetDb.service.start({...input,pinnedDigest:'a'.repeat(64)}),/independent pin/);
 const restored=await targetDb.service.restore(input);assert.equal(restored.kind,'restored',JSON.stringify(restored));assert.equal(restored.report.chainStatus,'unproven');
 assert.equal((await targetDb.service.restore(input)).kind,'replayed');
 assert.equal(targetDb.db.prepare('SELECT COUNT(*) n FROM earn_submissions').get().n,0);
 assert.throws(()=>targetDb.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run('forbidden','w1','http://localhost',999999999999),/mutation-disabled/);
 assert.throws(()=>targetDb.db.prepare('INSERT INTO earn_fixture_campaigns VALUES(?,?,?)').run('forbidden',0,'1000000'),/mutation-disabled|read-only/);
 const claims=await readPublicRecoveredClaims(targetDb.driver,{wallet:'w1',nowMs:f.golden.start+730*86400000});assert.equal(claims.items.length,1);assert.equal(claims.items[0].awardUnits,claims.items[0].vestedUnits);
 assert.equal(targetDb.db.prepare('SELECT status FROM app_recovery_state').get().status,'ready');
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM earn_boards').get().n,1,'source is never mutated by recovery');
});

test('missing public objects hold an isolated target and recover through the same immutable pin',async t=>{
 const f=await recoveryFixture();t.after(()=>f.db.close());const captured=await f.exporter.capturePublic(),targetDb=target(t,f,'public'),input={inventory:captured.inventory,pinnedDigest:captured.digest};
 const identity=captured.inventory.objects[0],bytes=f.objects.get(identity.key);f.objects.delete(identity.key);
 const held=await targetDb.service.restore(input);assert.equal(held.kind,'held');assert.equal(targetDb.db.prepare('SELECT mode,status FROM app_recovery_state').get().mode,'public');
 assert.throws(()=>targetDb.db.prepare('INSERT INTO auth_challenges VALUES(?,?,?,?,?,?)').run('x','w','o','m',1,null),/mutation-disabled/);
 const damaged=new Uint8Array(bytes);damaged[0]^=1;f.objects.set(identity.key,damaged);const corrupt=await targetDb.service.restore(input);assert.equal(corrupt.kind,'held');assert.equal(corrupt.reason,'recovery-object-conflict');
 f.objects.set(identity.key,bytes);assert.equal((await targetDb.service.restore(input)).kind,'restored');
});

test('private one-transaction snapshot restores all tables, revokes sessions and fences stale job leases',async t=>{
 const f=await recoveryFixture();t.after(()=>f.db.close());
 f.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run('synthetic-secret-session-hash','w1','http://localhost',999999999999);
 f.db.prepare('INSERT INTO auth_challenges VALUES(?,?,?,?,?,?)').run('synthetic-secret-nonce','w1','http://localhost','synthetic-private-auth-message',999999999999,null);
 const principal={kind:'operator',id:'synthetic-recovery'},clock={nowMs:()=>Date.now()};f.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'jobs-runner');
 const jobs=createJobRepository(f.driver,{...f,clock,principal});await jobs.enqueue(await createJobCommand({principal,requestKey:'synthetic-running-job',nowMs:clock.nowMs(),input:{businessKey:'synthetic-running-job',sourceKey:'synthetic-running-job',type:'retention-maintenance',payload:{synthetic:true},readyMs:clock.nowMs(),maxAttempts:5}},f.crypto));
 const acquired=await jobs.acquireJob();assert.equal(acquired.kind,'acquired');
 const captured=await f.exporter.capturePrivate();assert.equal(captured.kind,'captured',JSON.stringify(captured));assert.ok(captured.inventory.tables.length>80);
 assert.ok(captured.inventory.tables.every(t=>!['sessions','auth_challenges'].includes(t.name)));for(const identity of captured.inventory.objects)assert.doesNotMatch(new TextDecoder().decode(f.objects.get(identity.key)),/synthetic-secret-session-hash|synthetic-secret-nonce|synthetic-private-auth-message/);
 const recovered=target(t,f,'private'),input={inventory:captured.inventory,pinnedDigest:captured.digest};
 const result=await recovered.service.restore(input);assert.equal(result.kind,'restored',JSON.stringify(result));
 assert.equal(recovered.db.prepare('SELECT COUNT(*) n FROM sessions').get().n,0);assert.equal(recovered.db.prepare('SELECT COUNT(*) n FROM auth_challenges').get().n,0);
 const old=recovered.db.prepare('SELECT * FROM app_jobs WHERE id=?').get(acquired.job.id);assert.equal(old.state,'held');assert.equal(old.lease_token,null);assert.equal(old.revision,Number(acquired.job.lease.revision)+1);
 const restoredJobs=createJobRepository(recovered.driver,{...f,clock,principal});assert.equal((await restoredJobs.finish(acquired.job.lease,{state:'completed',result:{bad:true}})).kind,'conflict');
 assert.equal(f.db.prepare('SELECT state FROM app_jobs WHERE id=?').get(acquired.job.id).state,'running');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sessions').get().n,1);
 assert.equal((await recovered.service.restore(input)).kind,'replayed');
});

test('unknown object writes remain held until the same conditional immutable write verifies',async t=>{
 const f=await recoveryFixture();t.after(()=>f.db.close());const captured=await f.exporter.capturePublic(),backing=memoryArtifacts();let calls=0;
 const uncertain={...backing,async putIfAbsent(identity,bytes){calls++;const result=await backing.putIfAbsent(identity,bytes);return calls===1?{status:'unknown',identity}:result;}};
 const recovered=target(t,f,'public',{artifacts:uncertain}),input={inventory:captured.inventory,pinnedDigest:captured.digest};
 const held=await recovered.service.restore(input);assert.equal(held.kind,'held');assert.equal(held.reason,'recovery-object-write-unknown');assert.equal(backing.objects.size,1);
 assert.equal((await recovered.service.restore(input)).kind,'restored');assert.equal(calls,2);assert.equal(backing.objects.size,1);
});

test('omitted private data never enables a partially restored ledger',async t=>{
 const f=await recoveryFixture();t.after(()=>f.db.close());const captured=await f.exporter.capturePrivate(),recovered=target(t,f,'private');let omitted=false;
 const faulty={...recovered.driver,async batch(statements){if(!omitted&&statements.some(s=>s.sql.startsWith('INSERT OR IGNORE INTO "earn_awards"'))){omitted=true;let found=false;statements=statements.filter(s=>{if(!found&&s.sql.startsWith('INSERT OR IGNORE INTO "earn_awards"')){found=true;return false;}return true;});}return recovered.driver.batch(statements);}};
 const result=await createPrivateRecovery({...f,driver:faulty,artifacts:recovered.artifacts,sourceArtifacts:f.store}).restore({inventory:captured.inventory,pinnedDigest:captured.digest});
 assert.equal(omitted,true);assert.equal(result.kind,'held');assert.equal(result.reason,'recovery-table-conflict');
 assert.equal(recovered.db.prepare('SELECT status FROM app_recovery_state').get().status,'held');assert.equal(recovered.db.prepare('SELECT write_nonce FROM app_recovery_state').get().write_nonce,null);
 assert.throws(()=>recovered.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run('bad','w','o',999999999999),/mutation-disabled/);
});

test('a delayed private restore unit cannot write after another worker activates the recovered runtime',async t=>{
 const f=await recoveryFixture();t.after(()=>f.db.close());const captured=await f.exporter.capturePrivate(),recovered=target(t,f,'private'),input={inventory:captured.inventory,pinnedDigest:captured.digest};
 const started=await recovered.service.start(input);assert.equal(started.kind,'started');
 for(let n=0;n<started.units-1;n++)assert.equal((await recovered.service.step(input)).kind,'progress');
 let release,entered;const blocked=new Promise(resolve=>release=resolve),waiting=new Promise(resolve=>entered=resolve);
 const delayed={...recovered.driver,async batch(statements){if(statements.some(s=>s.sql.startsWith('UPDATE app_revisions SET revision=?'))&&statements.some(s=>s.sql.startsWith('UPDATE app_recovery_state SET write_nonce=?'))){entered();await blocked;}return recovered.driver.batch(statements);}};
 const stale=createPrivateRecovery({...f,driver:delayed,artifacts:recovered.artifacts,sourceArtifacts:f.store}).step(input);await waiting;
 assert.equal((await recovered.service.step(input)).kind,'progress');assert.equal((await recovered.service.finish(input)).kind,'restored');
 recovered.db.prepare("UPDATE app_revisions SET revision=revision+1 WHERE name='earn'").run();const current=recovered.db.prepare("SELECT revision FROM app_revisions WHERE name='earn'").get().revision;
 release();assert.equal((await stale).kind,'replayed');assert.equal(recovered.db.prepare("SELECT revision FROM app_revisions WHERE name='earn'").get().revision,current,'stale fence reset did not overwrite newer application state');
 assert.equal(recovered.db.prepare('SELECT status FROM app_recovery_state').get().status,'ready');
});

test('a newer public recovery retains old bundles and an older import cannot remove later allocations',async t=>{
 const f=await recoveryFixture();t.after(()=>f.db.close());const older=await f.exporter.capturePublic();
 const activation=f.golden.start+86400000+321;addCampaign(f.db,{tokenId:'B',activationMs:activation,originalUnits:'100000'});recordAllocation(f.db,{tokenId:'B',day:1,nowMs:activation});
 const manifest=exportBoard(f.db,f.golden.epoch).manifest,artifact=await f.codec.build({board:manifest.board,allocations:manifest.allocations});await f.store.putIfAbsent(artifact.identity,artifact.bytes);
 f.db.prepare('INSERT INTO manifest_catalog VALUES(?,?,?,?,?)').run(artifact.byteDigest,artifact.identity.key,artifact.identity.size,'earn-archive-v1',f.clock.nowMs());
 const newer=await f.exporter.capturePublic(),recovered=target(t,f,'public');assert.equal(newer.inventory.publications.length,2);
 assert.equal((await recovered.service.restore({inventory:newer.inventory,pinnedDigest:newer.digest})).kind,'restored');
 assert.equal((await recovered.service.restore({inventory:older.inventory,pinnedDigest:older.digest})).kind,'restored');
 assert.equal(recovered.db.prepare('SELECT COUNT(*) n FROM earn_recovered_allocations').get().n,2);assert.equal(recovered.db.prepare('SELECT COUNT(*) n FROM manifest_catalog').get().n,2);
 const oldPin=older.inventory.publications[0],oldBytes=recovered.artifacts.objects.get(oldPin.identity.key),verified=await f.codec.verify(oldBytes,{semanticDigest:oldPin.semanticDigest,byteDigest:oldPin.identity.byteDigest});
 const proof=await f.codec.proof(verified.manifest.allocations[0],'w1');assert.equal(await f.codec.verifyProof(proof,oldPin.allocations[0].awardRoot),true);
});

test('export operation budgets refuse oversized inventories before object reads or page writes',async t=>{
 const f=await recoveryFixture();t.after(()=>f.db.close());let reads=0,writes=0;
 const store={async getVerified(){reads++;throw Error('Must refuse before object read');},async putIfAbsent(){writes++;throw Error('Must refuse before page write');}};
 const exporter=createRecoveryExporter({...f,driver:f.driver,artifacts:store,sourceCommit:'0'.repeat(40)});
 const receipt=f.db.prepare('INSERT INTO app_command_receipts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)'),artifact=f.db.prepare('INSERT INTO app_private_artifacts VALUES(?,?,?,?,?,?,?)');
 f.db.exec('BEGIN');try{for(let n=0;n<512;n++){const id='synthetic-capture-bound-'+n,digest=n.toString(16).padStart(64,'0');
  receipt.run(id,'operator:synthetic','synthetic.capture-bound',id,id,digest,'{}',id,'committed','{}','{}',digest,id,0);
  artifact.run('private/'+digest+'.json',digest,1,null,'application/json',0,id);
 }f.db.exec('COMMIT');}catch(error){f.db.exec('ROLLBACK');throw error;}
 const privateResult=await exporter.capturePrivate();assert.equal(privateResult.kind,'pending');assert.equal(privateResult.reason,'private-capture-operation-or-byte-bound');assert.equal(reads,0);assert.equal(writes,0);
 const insert=f.db.prepare('INSERT INTO manifest_catalog VALUES(?,?,?,?,?)');for(let n=0;n<900;n++){const digest=n.toString(16).padStart(64,'0');insert.run(digest,'public/'+digest+'.json',1,'earn-archive-v1',0);}
 const publicResult=await exporter.capturePublic();assert.equal(publicResult.kind,'pending');assert.equal(publicResult.reason,'public-capture-operation-or-byte-bound');assert.equal(reads,0);assert.equal(writes,0);
});

test('caller mutation across inventory hashing cannot replace the independently verified restore identity',async t=>{
 const f=await recoveryFixture();t.after(()=>f.db.close());const captured=await f.exporter.capturePublic(),value={inventory:structuredClone(captured.inventory),pinnedDigest:captured.digest};let changed=false;
 const crypto={...f.crypto,async sha256(bytes){if(!changed){changed=true;value.pinnedDigest='a'.repeat(64);value.inventory.objects=[];}return f.crypto.sha256(bytes);}};
 const recovered=target(t,f,'public',{crypto}),result=await recovered.service.restore(value);assert.equal(result.kind,'restored',JSON.stringify(result));assert.equal(result.restoreId,captured.digest);
 assert.equal(recovered.db.prepare('SELECT inventory_digest FROM app_recovery_state').get().inventory_digest,captured.digest);assert.equal(recovered.db.prepare('SELECT id FROM app_recovery_runs').get().id,captured.digest);
});
