import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {createJobRepository} from './repository.mjs';
import {createJobCommand} from './model.mjs';
import {runTick} from './runner.mjs';
import {createHandlerRegistry} from './handlers.mjs';
import {createSettlementHandler} from './settlement-handler.mjs';
import {createSettlementCommand,COMMIT_BOARD,settlementFenceKey} from '../storage/atomic-settlement.mjs';
import {sourceJobOutboxStatement,reconcileJobOutbox} from './outbox.mjs';
import {sql,measureBatch} from '../storage/atomic-driver.mjs';
const crypto=createNodeCrypto(),principal={kind:'operator',id:'synthetic-jobs'};
function setup(t,path=':memory:'){
 const db=openDatabase(path);t.after(()=>db.close());let now=100000,loseResponse=false,delay=false;const measurements=[];
 db.function('fixture_job_clock',()=>now);db.prepare('INSERT OR IGNORE INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'jobs-runner');
 const base=createNodeAtomicDriver(db),driver={...base,leaseNowSql:'fixture_job_clock()',async batch(statements){
  measurements.push(measureBatch(statements));
  if(delay&&statements.some(s=>s.sql.includes('SET checkpoint_json'))){delay=false;now+=50000;}
  const result=await base.batch(statements);if(loseResponse&&statements.some(s=>s.sql.startsWith('UPDATE app_jobs SET state='))){loseResponse=false;throw Error('lost response');}return result;
 }},clock={nowMs:()=>now},repository=createJobRepository(driver,{crypto,ids:{next:randomUUID},clock,principal});
 const command=(key,extra={})=>createJobCommand({principal,requestKey:key,nowMs:now,input:{type:'complete-cutoff',businessKey:key,sourceKey:key,payload:{epoch:1},readyMs:now,maxAttempts:3,...extra}},crypto);
 return {db,repository,clock,command,measurements,advance:ms=>now+=ms,lose:()=>loseResponse=true,delay:()=>delay=true};
}
test('job identity, simultaneous acquisition and expired replacement fence exactly one holder',async t=>{
 const f=setup(t),c=await f.command('cutoff');const results=await Promise.all([f.repository.enqueue(c),f.repository.enqueue(c)]);
 assert.deepEqual(results.map(r=>r.kind).sort(),['committed','replayed']);
 assert.equal((await f.repository.enqueue(await f.command('cutoff',{payload:{epoch:2}}))).code,'idempotency_conflict');
 const leases=await Promise.all([f.repository.acquireJob(),f.repository.acquireJob()]);assert.equal(leases.filter(x=>x.kind==='acquired').length,1);
 const first=leases.find(x=>x.kind==='acquired').job;
 assert.equal((await f.repository.checkpoint(first.lease,{sequence:0,value:{phase:'captured'}})).kind,'checkpointed');
 f.advance(30001);const second=(await f.repository.acquireJob()).job;assert.deepEqual(second.checkpoint,{phase:'captured'});assert.equal(second.attempt,2);
 assert.equal((await f.repository.finish(first.lease,{state:'completed',result:{ok:true}})).kind,'conflict');
 assert.equal((await f.repository.finish(second.lease,{state:'completed',result:{ok:true}})).kind,'finished');
 assert.equal((await f.repository.readJob(second.id)).state,'completed');
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_job_attempts').get().n,2);
 assert.equal(f.db.prepare('SELECT expires_ms FROM app_execution_fences').get().expires_ms,0);
 console.log('Job SQL maxima',JSON.stringify(Object.fromEntries(['statements','maxParameters','maxSqlBytes','batchBytes'].map(key=>[key,Math.max(...f.measurements.map(m=>m[key]))]))));
});
test('checkpoint execution-time fence, lost finish response, and held dependency wake are durable',async t=>{
 const f=setup(t);await f.repository.enqueue(await f.command('held'));let job=(await f.repository.acquireJob()).job;
 f.delay();assert.equal((await f.repository.checkpoint(job.lease,{sequence:0,value:{bad:true}})).kind,'conflict');
 job=(await f.repository.acquireJob()).job;f.lose();assert.equal((await f.repository.finish(job.lease,{state:'held',reason:'source-gap',dependency:'owner-cut',readyMs:null})).kind,'finished');
 assert.equal((await f.repository.acquireJob()).kind,'idle');
 const wake={jobId:job.id,dependency:'owner-cut',evidenceDigest:'a'.repeat(64)};
 assert.equal((await f.repository.wake(wake)).kind,'woken');assert.equal((await f.repository.wake(wake)).kind,'unchanged');
 job=(await f.repository.acquireJob()).job;
 await f.repository.finish(job.lease,{state:'held',reason:'source-gap',dependency:'owner-cut',readyMs:null});
 assert.equal((await f.repository.wake(wake)).kind,'unchanged');
});
test('runner holds absent handlers, retries only known read failures, and caps work/deadline/attempts',async t=>{
 const f=setup(t);for(let i=0;i<22;i++)await f.repository.enqueue(await f.command('job-'+i));
 const run=await runTick({...f,limit:20,deadlineMs:5000});assert.equal(run.processed,20);assert.ok(run.items.every(x=>x.job.state==='held'));
 const handlers=createHandlerRegistry({'complete-cutoff':async context=>{
  assert.equal((await context.checkpoint({step:1})).kind,'checkpointed');assert.equal((await context.checkpoint({step:2})).kind,'checkpointed');
  f.advance(200);return {state:'completed',result:'one'};
 }});
 assert.equal((await runTick({...f,handlers,deadlineMs:100})).processed,1);
 const retry=createHandlerRegistry({'complete-cutoff':async()=>{throw Object.assign(Error('offline'),{effect:'read-only',retryable:true});}});
 const attempted=await runTick({...f,handlers:retry,deadlineMs:100});assert.equal(attempted.items[0].job.state,'retry');
 for(let i=0;i<3;i++){f.advance(100000);await runTick({...f,handlers:retry,deadlineMs:100});}
 assert.equal((await f.repository.readJob(attempted.items[0].job.id)).reason,'attempt-ceiling');
});
test('reopened database retains checkpoints and committed result after a lost response',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'10x-jobs-'));
 const path=join(directory,'state.sqlite'),f=setup(t,path);await f.repository.enqueue(await f.command('restart'));let job=(await f.repository.acquireJob()).job;
 await f.repository.checkpoint(job.lease,{sequence:0,value:{receipt:'stable-business-receipt'}});
 const other=openDatabase(path);t.after(()=>other.close());other.function('fixture_job_clock',()=>f.clock.nowMs());
 const reopened=createJobRepository({...createNodeAtomicDriver(other),leaseNowSql:'fixture_job_clock()'},{crypto,ids:{next:randomUUID},clock:f.clock,principal});
 assert.deepEqual((await reopened.readJob(job.id)).checkpoint,{receipt:'stable-business-receipt'});
 f.advance(30001);job=(await reopened.acquireJob()).job;
 assert.equal((await reopened.finish(job.lease,{state:'completed',result:{receipt:'stable-business-receipt'}})).kind,'finished');
 assert.equal((await f.repository.readJob(job.id)).result.receipt,'stable-business-receipt');
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
});
test('settlement handler binds immutable payload and reconciles a committed business receipt after a crash',async t=>{
 const f=setup(t),command=await createSettlementCommand(COMMIT_BOARD,{principal,requestKey:'board',nowMs:f.clock.nowMs(),input:{epoch:1,manifestDigest:'a'.repeat(64),planDigest:'b'.repeat(64)}},crypto);
 const input={type:'finalize-board',businessKey:settlementFenceKey(COMMIT_BOARD,command.input),sourceKey:'complete-input-one',payload:{command},readyMs:f.clock.nowMs(),maxAttempts:3};
 await f.repository.enqueue(await createJobCommand({principal,requestKey:'settle',nowMs:f.clock.nowMs(),input},crypto));
 f.db.exec('CREATE TABLE synthetic_business_receipts(id TEXT PRIMARY KEY,output_digest TEXT NOT NULL) STRICT');let crashed=false,calls=0;
 const handler=createSettlementHandler({async commitBoard(received,lease){
  calls++;assert.deepEqual(received.input,command.input);assert.equal(lease.businessKey,input.businessKey);
  const result=f.db.prepare('INSERT OR IGNORE INTO synthetic_business_receipts VALUES(?,?)').run('business-one','c'.repeat(64));
  if(!crashed){crashed=true;throw Error('response lost after business commit');}
  return {kind:result.changes?'committed':'replayed',receipt:{operationId:'business-one',outputDigest:'c'.repeat(64)}};
 }},{crypto,clock:f.clock});
 const handlers=createHandlerRegistry({'finalize-board':handler});
 const first=await runTick({...f,handlers});assert.equal(first.items[0].job.state,'held');
 await f.repository.wake({jobId:first.items[0].job.id,dependency:'reconciliation',evidenceDigest:'d'.repeat(64)});
 const next=await runTick({...f,handlers});assert.equal(next.items[0].job.state,'completed');assert.equal(calls,2);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM synthetic_business_receipts').get().n,1);
 const rejected=await handler({job:{type:'finalize-board',payload:{command:{...command,input:{...command.input,epoch:2}}},businessKey:input.businessKey},lease:{payloadDigest:'e'.repeat(64)}});
 assert.equal(rejected.reason,'job-command-binding');assert.equal(calls,2);
});
test('deadline abort holds unknown work and rejects a late handler checkpoint',async t=>{
 const f=setup(t);await f.repository.enqueue(await f.command('slow'));let late,resolve;
 const deferred=new Promise(r=>resolve=r),handlers=createHandlerRegistry({'complete-cutoff':async context=>{await deferred;late=await context.checkpoint({late:true});return {state:'completed',result:'late'};}});
 const result=await runTick({...f,handlers,deadlineMs:20});assert.equal(result.items[0].reason,'handler-outcome-unknown');
 resolve();await new Promise(r=>setTimeout(r,10));assert.equal(late.reason,'handler-aborted');
 assert.equal(f.db.prepare('SELECT state FROM app_jobs').get().state,'running');
});
test('durable source outbox shares source rollback and reconciles enqueue after interruption',async t=>{
 const f=setup(t),command=await f.command('outbox');f.db.exec('CREATE TABLE synthetic_source_events(id TEXT PRIMARY KEY) STRICT');
 const effect=await sourceJobOutboxStatement(command,{crypto,gate:'EXISTS(SELECT 1 FROM synthetic_source_events WHERE id=?)',values:['source-event']});
 const driver=createNodeAtomicDriver(f.db),batch=[sql('INSERT INTO synthetic_source_events VALUES(?)','source-event'),effect];
 f.db.exec("CREATE TRIGGER fail_outbox BEFORE INSERT ON app_job_outbox BEGIN SELECT RAISE(ABORT,'source interrupted'); END");
 await assert.rejects(driver.batch(batch),/source interrupted/);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM synthetic_source_events').get().n,0);
 f.db.exec('DROP TRIGGER fail_outbox');await driver.batch(batch);
 let interrupted=false;const transport={...driver,async batch(statements){if(!interrupted&&statements[0].sql.startsWith('UPDATE app_job_outbox')){interrupted=true;throw Error('before pointer');}return driver.batch(statements);}};
 await assert.rejects(reconcileJobOutbox(transport,f.repository),/before pointer/);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_jobs').get().n,1);
 assert.equal((await reconcileJobOutbox(driver,f.repository)).items[0].kind,'replayed');
 assert.ok(f.db.prepare('SELECT job_id FROM app_job_outbox').get().job_id);assert.equal((await reconcileJobOutbox(driver,f.repository)).processed,0);
 console.log('Source outbox batch',JSON.stringify(measureBatch(batch)));
});

test('tick deadline bounds hung outbox, acquisition and completion I/O without claiming rollback',async t=>{
 const f=setup(t),hung=()=>new Promise(()=>{});
 for(const [reason,options] of [
  ['outbox-outcome-unknown',{outbox:hung}],
  ['acquire-outcome-unknown',{repository:{...f.repository,acquireJob:hung}}],
 ]){
  const result=await runTick({...f,...options,deadlineMs:15});assert.equal(result.items[0].reason,reason);
 }
 await f.repository.enqueue(await f.command('finish-hang'));
 const result=await runTick({...f,repository:{...f.repository,finish:hung},handlers:createHandlerRegistry({'complete-cutoff':async()=>({state:'completed',result:'done'})}),deadlineMs:15});
 assert.equal(result.items[0].reason,'finish-outcome-unknown');assert.equal(f.db.prepare('SELECT state FROM app_jobs').get().state,'running');
});
