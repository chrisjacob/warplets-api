import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {createSettlementScheduler} from './settlement-scheduler.mjs';
import {DAY_MS,allocationWindow} from '../domain/earn/index.mjs';
import {U64_MAX} from '../domain/economics/index.mjs';
import {createJobRepository} from './repository.mjs';
import {createJobCommand} from './model.mjs';
import {reconcileJobOutbox} from './outbox.mjs';
import {canonicalJson} from '../security/canonical.mjs';
import {randomUUID} from 'node:crypto';
const principal={kind:'operator',id:'synthetic-scheduler'},crypto=createNodeCrypto();
function setup(){const db=openDatabase();for(const scope of ['jobs-runner','earn-settlement'])db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,scope);
 return {db,driver:createNodeAtomicDriver(db)};}
test('durable ten-day schedules retain separate activation times, paginate and replay exactly',async t=>{
 const {db,driver}=setup();t.after(()=>db.close());const start=20*DAY_MS+3600000;
 for(let i=0;i<10;i++)db.prepare('INSERT INTO earn_fixture_campaigns VALUES(?,?,?)').run('token'+i,start+i*35*60000,String(U64_MAX-U64_MAX%200n));
 const scheduler=createSettlementScheduler(driver,{crypto,principal});let after='',count=0;
 do{const r=await scheduler.scheduleCampaigns({after,limit:3});assert.equal(r.kind,'scheduled');count+=r.count;after=r.next;}while(after);
 assert.equal(count,100);assert.equal((await scheduler.scheduleCampaigns()).count,100);
 const rows=db.prepare('SELECT command_json FROM app_job_outbox ORDER BY source_key').all();assert.equal(rows.length,100);
 for(const {command_json} of rows){const c=JSON.parse(command_json),{tokenId,day}=c.input.payload,activation=start+Number(tokenId.slice(5))*35*60000;
  assert.equal(c.input.readyMs,allocationWindow(activation,day).startsAtMs);assert.equal(c.nowMs,c.input.readyMs);assert.equal(c.input.type,'allocate-token-day');assert.equal(c.input.maxAttempts,5);}
 assert.equal(db.prepare('SELECT COUNT(*) n FROM earn_allocations').get().n,0);
});
test('schedule authority/revision race refuses writes, unknown acknowledgement reconciles exact outbox',async t=>{
 const {db,driver}=setup();t.after(()=>db.close());db.prepare('INSERT INTO earn_fixture_campaigns VALUES(?,?,?)').run('A',20*DAY_MS,'1000000');
 let revoke=true;const racing={...driver,async batch(s){if(revoke&&s.some(x=>x.sql.startsWith('INSERT INTO app_job_outbox'))){revoke=false;db.prepare("UPDATE app_operator_scopes SET enabled=0 WHERE scope='earn-settlement'").run();}return driver.batch(s);}};
 const r=await createSettlementScheduler(racing,{crypto,principal}).scheduleCampaigns();assert.equal(r.kind,'conflict');assert.equal(db.prepare('SELECT COUNT(*) n FROM app_job_outbox').get().n,0);
 db.prepare("UPDATE app_operator_scopes SET enabled=1 WHERE scope='earn-settlement'").run();let lost=false;
 const loss={...driver,async batch(s){const r=await driver.batch(s);if(!lost&&s.some(x=>x.sql.startsWith('INSERT INTO app_job_outbox'))){lost=true;throw Error('lost');}return r;}};
 assert.equal((await createSettlementScheduler(loss,{crypto,principal}).scheduleCampaigns()).kind,'scheduled');assert.equal(db.prepare('SELECT COUNT(*) n FROM app_job_outbox').get().n,10);
});
test('a foreign operator outbox cannot starve this runner or consume its bounded dispatch slot',async t=>{
 const {db,driver}=setup();t.after(()=>db.close());const other={kind:'operator',id:'other-synthetic-scheduler'};
 db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(other.id,'jobs-runner');
 for(const [owner,key] of [[other,'aaa-foreign'],[principal,'zzz-own']]){
  const c=await createJobCommand({principal:owner,requestKey:key,nowMs:0,input:{businessKey:key,sourceKey:key,type:'retention-maintenance',payload:{fixture:true},readyMs:0,maxAttempts:1}},crypto);
  db.prepare('INSERT INTO app_job_outbox(source_key,command_json,request_digest) VALUES(?,?,?)').run(key,canonicalJson(c),c.requestDigest);
 }
 const repository=createJobRepository(driver,{crypto,ids:{next:randomUUID},clock:{nowMs:()=>0},principal});
 const dispatched=await reconcileJobOutbox(driver,repository,{limit:1});assert.equal(dispatched.processed,1);assert.equal(dispatched.items[0].job.businessKey,'zzz-own');
 assert.equal(db.prepare("SELECT job_id FROM app_job_outbox WHERE source_key='aaa-foreign'").get().job_id,null);
 assert.equal((await reconcileJobOutbox(driver,repository,{limit:1})).processed,0);
});
