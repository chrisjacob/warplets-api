import test from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from './local-runtime.mjs';
import {openDatabase} from '../../storage/database.mjs';
import {createNodeAtomicDriver} from '../../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../../security/node-crypto.mjs';
import {createNotificationDeliveryRepository} from '../../storage/notification-delivery.mjs';
import {createNotificationRetentionHandler} from '../../jobs/notification-retention-handler.mjs';
import {createJobRepository} from '../../jobs/repository.mjs';
import {createJobCommand} from '../../jobs/model.mjs';
import {createHandlerRegistry} from '../../jobs/handlers.mjs';
import {runTick} from '../../jobs/runner.mjs';
import {retentionPayload,retentionBusinessKey,retentionSourceKey} from '../../notifications/retention-plan.mjs';
import {canonicalJson} from '../../security/canonical.mjs';
const DAY=86400000,NOW=Date.UTC(2026,10,10),principal={kind:'operator',id:'synthetic-retention-worker'},crypto=createNodeCrypto();
async function nodeCall(db,body){
 db.prepare('UPDATE notification_retention_fixture_clock SET now_ms=?').run(body.nowMs);const base=createNodeAtomicDriver(db);let sequence=0,injected=false;
 const driver={...base,leaseNowSql:'(SELECT now_ms FROM notification_retention_fixture_clock)',async batch(statements){const purge=statements.some(s=>s.sql.startsWith('WITH due AS'));if(purge&&!injected&&body.fault==='clock'){injected=true;db.prepare('UPDATE notification_retention_fixture_clock SET now_ms=?').run(body.nowMs+30000);}const result=await base.batch(statements);if(purge&&!injected&&body.fault==='lost'){injected=true;throw Error('Synthetic committed purge response loss.');}return result;}};
 const ports={crypto,clock:{nowMs:()=>body.nowMs},ids:{next:()=>body.idPrefix+'-'+(++sequence)}},repository=createNotificationDeliveryRepository(driver,ports),jobs=createJobRepository(driver,{...ports,principal});let result;
 if(body.method==='purge')result=await repository.purgeExpired(principal,{limit:body.limit},body.lease);
 else if(body.method==='enqueue-job'){const payload=retentionPayload({kind:'notification-retention-v1',runKey:body.runKey,limit:body.limit});result=await jobs.enqueue(await createJobCommand({principal,requestKey:payload.runKey,nowMs:body.nowMs,input:{businessKey:retentionBusinessKey(payload),sourceKey:retentionSourceKey(payload),type:'retention-maintenance',payload,readyMs:body.nowMs,maxAttempts:5}},crypto));}
 else if(body.method==='acquire-job')result=await jobs.acquireJob();
 else result=await runTick({repository:jobs,clock:ports.clock,handlers:createHandlerRegistry({'retention-maintenance':createNotificationRetentionHandler({repository,...ports,principal})}),limit:1,deadlineMs:5000});
 return {result,injected};
}
test('actual local D1 retention counts returned IDs across inbox cascades and B03 lease retries with exact Node parity',async t=>{
 const node=openDatabase();t.after(()=>node.close());const {mf,db}=await localRuntime(t,new URL('./fixtures/notification-retention-worker.ts',import.meta.url));
 const run=async(sql,...values)=>{node.prepare(sql).run(...values);await db.prepare(sql).bind(...values).run();};
 node.exec('CREATE TABLE notification_retention_fixture_clock(now_ms INTEGER)');await db.prepare('CREATE TABLE notification_retention_fixture_clock(now_ms INTEGER)').run();await run('INSERT INTO notification_retention_fixture_clock VALUES(?)',NOW);await run('INSERT INTO app_operator_scopes VALUES(?,?,0,1)',principal.id,'jobs-runner');
 await run("INSERT INTO ops_scope_log VALUES('synthetic-retention-pause','optional-notifications',1,NULL,?,'fixture','pause','fixture','pause')",NOW);
 await run('INSERT INTO notice_preferences VALUES(?,?,?,?,?,?,?)','synthetic-wallet','local-inbox',1,1,'["launch"]','synthetic-reference-terms',NOW-9*DAY);await run('INSERT INTO notice_consent_requests VALUES(?,?,?,?,?,?)','synthetic-wallet','local-inbox','synthetic-old-key','a'.repeat(64),1,NOW-9*DAY);
 // Explicit synthetic old reference rows exercise cascade metadata, not enqueue authority.
 const seed=async(n,expires=NOW-7*DAY,inbox=true)=>{const id=n.toString(16).padStart(64,'0');await run('INSERT INTO notice_outbox VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,'synthetic-wallet','local-inbox',1,'launch','synthetic-market','Synthetic','Synthetic','/markets/synthetic-market',NOW-9*DAY,expires,inbox?'delivered':'queued',inbox?1:0,NOW-9*DAY,null,null);if(inbox)await run('INSERT INTO notice_inbox VALUES(?,?,?)',id,'synthetic-wallet',NOW-9*DAY);};
 for(let n=0;n<101;n++)await seed(n);await seed(999,NOW-7*DAY+1,false);
 const tables=['notice_outbox','notice_inbox','notice_preferences','notice_consent_requests','app_command_receipts','app_jobs','app_job_attempts','app_job_events','app_execution_fences'],metrics=[];let calls=0;
 const snapshotNode=()=>canonicalJson(tables.map(name=>[name,node.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()])),snapshotD1=async()=>canonicalJson(await Promise.all(tables.map(async name=>[name,(await db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()).results])));
 const both=async(extra={})=>{const body={method:'purge',limit:100,nowMs:NOW,idPrefix:'synthetic-retention-'+(++calls),...extra},n=await nodeCall(node,body),response=await mf.dispatchFetch('http://localhost/__fixture',{method:'POST',body:JSON.stringify(body)});assert.equal(response.status,200);const d=await response.json();assert.deepEqual(d.result,n.result);assert.equal(d.injected,n.injected);assert.equal(await snapshotD1(),snapshotNode());metrics.push(d.metrics);return d.result;};
 assert.deepEqual(await both(),{kind:'purged',outboxRemoved:100,consentRequestKeysRemoved:0});assert.equal(node.prepare('SELECT COUNT(*) n FROM notice_inbox').get().n,1);assert.equal((await both({fault:'clock'})).reason,'retention-fenced');assert.equal((await both({fault:'lost'})).reason,'retention-outcome-unknown');assert.equal((await both()).outboxRemoved,0);assert.equal(node.prepare('SELECT COUNT(*) n FROM notice_outbox').get().n,1);
 for(let n=200;n<203;n++)await seed(n,NOW-7*DAY,false);assert.equal((await both({method:'enqueue-job',runKey:'first',limit:2})).kind,'committed');assert.equal((await both({method:'tick'})).items[0].job.state,'retry');assert.equal((await both({method:'tick'})).items[0].job.state,'completed');
 await seed(300,NOW-7*DAY,false);assert.equal((await both({method:'enqueue-job',runKey:'stale',limit:1})).kind,'committed');const acquired=await both({method:'acquire-job'});assert.equal(acquired.kind,'acquired');assert.equal((await both({limit:1,lease:acquired.job.lease,nowMs:NOW+30000})).reason,'retention-fenced');assert.equal(node.prepare('SELECT COUNT(*) n FROM notice_outbox').get().n,2);
 await run("UPDATE app_recovery_state SET status='held'");assert.equal((await both()).reason,'read-only-recovery');assert.equal(node.prepare('SELECT COUNT(*) n FROM notice_consent_requests').get().n,1);assert.equal(node.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n,0);
 assert.ok(metrics.every(m=>m.statements<=64&&m.maxBatchBytes<=262144));t.diagnostic(JSON.stringify({pairedCalls:calls,expired:101,firstPageRemoved:100,maxStatements:Math.max(...metrics.map(m=>m.statements)),maxBatchBytes:Math.max(...metrics.map(m=>m.maxBatchBytes)),maxParameters:Math.max(...metrics.map(m=>m.maxParameters)),maxResultBytes:Math.max(...metrics.map(m=>m.maxResultBytes)),financialExecution:false,externalTransport:false}));
});
