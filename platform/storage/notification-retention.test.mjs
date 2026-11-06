import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from './database.mjs';
import {createNodeAtomicDriver} from './node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {createNotificationDeliveryRepository} from './notification-delivery.mjs';
import {measureBatch} from './atomic-driver.mjs';
import {recoveryFixture} from '../recovery/fixtures.mjs';
import {createPrivateReferenceService} from '../artifacts/reference-service.mjs';
import {createArtifactReferenceRepository} from './atomic-artifacts.mjs';
const DAY=86400000,NOW=Date.UTC(2026,10,10),principal={kind:'operator',id:'synthetic-retention-worker'};
function fixture(t,fault=null){
 const db=openDatabase();t.after(()=>db.close());let sqlNow=NOW,injected=false;db.function('synthetic_retention_clock',()=>sqlNow);
 const base=createNodeAtomicDriver(db),metrics=[],driver={...base,leaseNowSql:'synthetic_retention_clock()',async batch(statements){
  metrics.push(measureBatch(statements));const purge=statements.some(s=>s.sql.startsWith('WITH due AS'));
  if(purge&&!injected&&fault==='clock'){injected=true;sqlNow+=30000;}
  if(purge&&!injected&&fault==='generation'){injected=true;db.prepare('UPDATE app_recovery_state SET generation=?').run('synthetic-other-generation');}
  const result=await base.batch(statements);if(purge&&!injected&&fault==='lost'){injected=true;throw Error('Synthetic committed purge response loss.');}return result;
 }};
 const repo=createNotificationDeliveryRepository(driver,{crypto:createNodeCrypto(),clock:{nowMs:()=>NOW},ids:{next:randomUUID}});
 return {db,repo,metrics};
}
function seed(db,count=101){
 // Explicit old reference rows test retention capacity, not enqueue authority.
 for(let n=0;n<count;n++){const id=n.toString(16).padStart(64,'0');db.prepare('INSERT INTO notice_outbox VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'synthetic-retention-wallet','local-inbox',1,'launch','synthetic-market','Synthetic title','Synthetic message','/markets/synthetic-market',NOW-9*DAY,NOW-7*DAY,'delivered',1,NOW-9*DAY,null,null);db.prepare('INSERT INTO notice_inbox VALUES(?,?,?)').run(id,'synthetic-retention-wallet',NOW-9*DAY);}
 db.prepare('INSERT INTO notice_outbox VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('f'.repeat(64),'synthetic-retention-wallet','local-inbox',1,'launch','synthetic-fresh','Fresh','Fresh','/markets/synthetic-fresh',NOW-9*DAY,NOW-7*DAY+1,'queued',0,NOW-9*DAY,null,null);
 db.prepare('INSERT INTO notice_preferences VALUES(?,?,?,?,?,?,?)').run('synthetic-retention-wallet','local-inbox',1,1,'["launch"]','synthetic-old-reference-terms',NOW-9*DAY);
 db.prepare('INSERT INTO notice_consent_requests VALUES(?,?,?,?,?,?)').run('synthetic-retention-wallet','local-inbox','old-key','a'.repeat(64),1,NOW-9*DAY);
}
test('retention deletes exactly100 expired outbox rows including boundary, cascades inbox, preserves consent and all other business tables',async t=>{
 const f=fixture(t);seed(f.db);f.db.prepare("INSERT INTO ops_scope_log VALUES('synthetic-retention-pause','optional-notifications',1,NULL,?,'fixture','pause','fixture','pause')").run(NOW);
 const tables=f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('notice_outbox','notice_inbox','app_recovery_watermark') ORDER BY name").all().map(r=>r.name),snapshot=()=>JSON.stringify(tables.map(name=>[name,f.db.prepare('SELECT * FROM "'+name+'"').all().map(r=>JSON.stringify(r)).sort()])),before=snapshot();
 assert.deepEqual(await f.repo.purgeExpired(principal),{kind:'purged',outboxRemoved:100,consentRequestKeysRemoved:0});assert.equal(f.db.prepare('SELECT COUNT(*) n FROM notice_outbox').get().n,2);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM notice_inbox').get().n,1);
 assert.deepEqual(await f.repo.purgeExpired(principal),{kind:'purged',outboxRemoved:1,consentRequestKeysRemoved:0});assert.equal(f.db.prepare('SELECT id FROM notice_outbox').get().id,'f'.repeat(64));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM notice_inbox').get().n,0);assert.equal(snapshot(),before);
 assert.deepEqual(await f.repo.purgeExpired(principal),{kind:'purged',outboxRemoved:0,consentRequestKeysRemoved:0});assert.ok(f.metrics.every(m=>m.statements<=2&&m.batchBytes<=262144));t.diagnostic(JSON.stringify({expired:101,firstPage:100,maxBatchBytes:Math.max(...f.metrics.map(m=>m.batchBytes)),consentKeysRetained:true,pauseIndependent:true}));
});
test('retention rejects bad bounds, recovery/clock/generation races and reports lost acknowledgement without invented counts',async t=>{
 const f=fixture(t);seed(f.db,1);for(const options of [{limit:0},{limit:101},{limit:1.5},{now:NOW}])await assert.rejects(f.repo.purgeExpired(principal,options),TypeError);await assert.rejects(f.repo.purgeExpired({kind:'wallet',wallet:'x'}),TypeError);
 f.db.prepare("UPDATE app_recovery_state SET status='held'").run();assert.equal((await f.repo.purgeExpired(principal)).reason,'read-only-recovery');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM notice_outbox').get().n,2);
 for(const fault of ['clock','generation']){const race=fixture(t,fault);seed(race.db,1);assert.equal((await race.repo.purgeExpired(principal)).reason,'retention-fenced');assert.equal(race.db.prepare('SELECT COUNT(*) n FROM notice_outbox').get().n,2);}
 const lost=fixture(t,'lost');seed(lost.db,1);assert.equal((await lost.repo.purgeExpired(principal)).reason,'retention-outcome-unknown');assert.equal(lost.db.prepare('SELECT COUNT(*) n FROM notice_outbox').get().n,1);assert.equal((await lost.repo.purgeExpired(principal)).outboxRemoved,0);
});

test('expired notice purge preserves populated golden claim liabilities and public/private artifact commitments byte-for-byte',async t=>{
 const f=await recoveryFixture();t.after(()=>f.db.close());seed(f.db,2);
 const bytes=new TextEncoder().encode('{"source":"synthetic-private-retention-commitment"}'),digest=await f.crypto.sha256(bytes),identity={key:'private/'+digest+'.json',byteDigest:digest,size:bytes.length,semanticDigest:null,visibility:'private',contentType:'application/json'};
 f.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'evidence-ingest');
 const artifactService=createPrivateReferenceService({...f,repository:createArtifactReferenceRepository(f.driver,f)});
 assert.equal((await artifactService.persist(principal,{identity,bytes,requestKey:'synthetic-retention-private'})).kind,'committed');
 const tables=['earn_boards','earn_allocations','earn_awards','manifest_catalog','app_private_artifacts','app_command_receipts'],snapshot=()=>JSON.stringify(tables.map(table=>[table,f.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()])),before=snapshot(),objects=[...f.store.objects].map(([key,data])=>[key,Buffer.from(data).toString('hex')]);
 for(const table of ['earn_boards','earn_allocations','earn_awards','manifest_catalog','app_private_artifacts'])assert.ok(f.db.prepare('SELECT COUNT(*) n FROM '+table).get().n>0,table);
 f.db.function('synthetic_retention_clock',()=>NOW);const repo=createNotificationDeliveryRepository({...f.driver,leaseNowSql:'synthetic_retention_clock()'},{...f,clock:{nowMs:()=>NOW}});
 assert.equal((await repo.purgeExpired(principal)).outboxRemoved,2);assert.equal(snapshot(),before);assert.deepEqual([...f.store.objects].map(([key,data])=>[key,Buffer.from(data).toString('hex')]),objects);assert.equal((await f.store.getVerified(f.artifact.identity)).status,'verified');assert.equal((await f.store.getVerified(identity)).status,'verified');
});
