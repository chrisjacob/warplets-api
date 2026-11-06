import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {createNotificationDeliveryRepository} from '../storage/notification-delivery.mjs';
import {createJobRepository} from './repository.mjs';
import {createJobCommand} from './model.mjs';
import {createNotificationRetentionHandler} from './notification-retention-handler.mjs';
import {retentionPayload,retentionBusinessKey,retentionSourceKey} from '../notifications/retention-plan.mjs';
import {createHandlerRegistry} from './handlers.mjs';
import {runTick} from './runner.mjs';
const NOW=Date.UTC(2026,10,10),DAY=86400000,principal={kind:'operator',id:'synthetic-retention-job'};
async function fixture(t){
 const db=openDatabase();t.after(()=>db.close());let now=NOW;db.function('synthetic_retention_clock',()=>now);const driver={...createNodeAtomicDriver(db),leaseNowSql:'synthetic_retention_clock()'},ports={crypto:createNodeCrypto(),clock:{nowMs:()=>now},ids:{next:randomUUID}},jobs=createJobRepository(driver,{...ports,principal}),repo=createNotificationDeliveryRepository(driver,ports);
 db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'jobs-runner');
 for(let n=0;n<3;n++)db.prepare('INSERT INTO notice_outbox VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(n.toString(16).padStart(64,'0'),'synthetic-wallet','local-inbox',1,'launch','synthetic-market','Synthetic','Synthetic','/markets/synthetic-market',NOW-9*DAY,NOW-7*DAY,'queued',0,NOW-9*DAY,null,null);
 const payload=retentionPayload({kind:'notification-retention-v1',runKey:'synthetic-run',limit:2}),command=await createJobCommand({principal,requestKey:'synthetic-run',nowMs:now,input:{businessKey:retentionBusinessKey(payload),sourceKey:retentionSourceKey(payload),type:'retention-maintenance',payload,readyMs:now,maxAttempts:5}},ports.crypto);
 assert.equal((await jobs.enqueue(command)).kind,'committed');const handler=createNotificationRetentionHandler({repository:repo,...ports,principal});return {db,driver,ports,jobs,repo,handler,setNow:value=>now=value};
}
test('B03 retention retries one bounded page then completes without notification delivery leases or invented cumulative counts',async t=>{
 const f=await fixture(t),handlers=createHandlerRegistry({'retention-maintenance':f.handler}),first=await runTick({repository:f.jobs,clock:f.ports.clock,handlers,limit:1,deadlineMs:5000});assert.equal(first.items[0].job.state,'retry');assert.equal(first.items[0].job.checkpoint.lastPageRemoved,2);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM notice_outbox').get().n,1);
 const next=await runTick({repository:f.jobs,clock:f.ports.clock,handlers,limit:1,deadlineMs:5000});assert.equal(next.items[0].job.state,'completed');assert.equal(next.items[0].job.result.lastPageRemoved,1);assert.equal(next.items[0].job.attempt,2);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM notice_outbox').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM notice_preferences').get().n,0);
});
test('retention handler and SQL reject changed payload, expired/stolen leases, missing execution fence and revoked runner',async t=>{
 for(const fault of ['payload','expired','stolen','execution-fence','revoked']){const f=await fixture(t),acquired=await f.jobs.acquireJob(),job=acquired.job,lease=job.lease;assert.equal(acquired.kind,'acquired');
  if(fault==='expired')f.setNow(NOW+30000);if(fault==='stolen')lease.token='synthetic-wrong-token';if(fault==='execution-fence')f.db.prepare('DELETE FROM app_execution_fences').run();if(fault==='revoked')f.db.prepare('UPDATE app_operator_scopes SET enabled=0').run();if(fault==='payload')job.payload.limit=3;
  const result=await f.handler({job,lease,signal:new AbortController().signal,checkpoint:async()=>{throw Error('Fenced cleanup cannot checkpoint.');}});assert.equal(result.state,'held',fault);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM notice_outbox').get().n,3,fault);
 }
 for(const value of [{kind:'notification-retention-v1',runKey:'x',limit:101},{kind:'notification-retention-v1',runKey:'\n',limit:1},{kind:'notification-retention-v1',runKey:'x',limit:1,nowMs:0}])assert.throws(()=>retentionPayload(value),TypeError);
});
