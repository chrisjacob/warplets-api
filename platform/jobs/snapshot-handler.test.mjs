import test from 'node:test';
import assert from 'node:assert/strict';
import {cutoffScenario} from '../application/fixtures/cutoff-scenario.mjs';
import {createSnapshotHandler,cutoffJobKey} from './snapshot-handler.mjs';
import {createCutoffFreezeRepository} from '../storage/cutoff-freeze.mjs';
import {createJobRepository} from './repository.mjs';
import {createJobCommand} from './model.mjs';
import {createHandlerRegistry} from './handlers.mjs';
import {runTick} from './runner.mjs';
import {utf8,canonicalJson} from '../security/canonical.mjs';
async function setup(t,complete=true){
 const env=await cutoffScenario({complete});t.after(()=>env.db.close());
 env.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(env.principal.id,'jobs-runner');
 const bytes=utf8(canonicalJson(env.query)),byteDigest=await env.crypto.sha256(bytes),configuration={key:'private/'+byteDigest+'.json',byteDigest,size:bytes.length,semanticDigest:null,visibility:'private',contentType:'application/json'};
 await env.store.putIfAbsent(configuration,bytes);
 const payload={principal:env.principal,configuration},repository=createJobRepository(env.driver,{...env.ports,principal:env.principal});
 const command=await createJobCommand({principal:env.principal,requestKey:'snapshot-job',nowMs:env.clock.nowMs(),input:{
  type:'complete-cutoff',businessKey:cutoffJobKey(env.epoch,byteDigest),sourceKey:'synthetic-cutoff',payload,readyMs:env.clock.nowMs(),maxAttempts:5}},env.crypto);
 const enqueued=await repository.enqueue(command);assert.equal(enqueued.kind,'committed',JSON.stringify(enqueued));
 const handler=createSnapshotHandler({service:env.service,freezeRepository:createCutoffFreezeRepository(env.driver,env.ports),store:env.store,principal:env.principal,...env.ports});
 return {...env,repository,handler,payload,configuration};
}
test('bounded durable cutoff job reads digest-bound configuration and checkpoints sealed result',async t=>{
 const env=await setup(t);const result=await runTick({repository:env.repository,clock:env.clock,handlers:createHandlerRegistry({'complete-cutoff':env.handler}),limit:1,deadlineMs:5000});
 assert.equal(result.items[0].job.state,'completed',JSON.stringify(result));
 assert.equal(result.items[0].job.checkpoint.stage,'input-sealed');assert.ok(result.items[0].job.result.inputDigest);
 assert.equal(env.db.prepare('SELECT COUNT(*) n FROM app_epoch_inputs').get().n,1);
});
test('missing coverage holds a job with persisted manifest identity and no complete input',async t=>{
 const env=await setup(t,false),result=await runTick({repository:env.repository,clock:env.clock,handlers:createHandlerRegistry({'complete-cutoff':env.handler}),limit:1,deadlineMs:5000});
 const job=result.items[0].job;assert.equal(job.state,'held');assert.equal(job.reason,'snapshot-dependencies');
 assert.equal(job.dependency,'cutoff-evidence:'+env.epoch);assert.ok(job.checkpoint.manifestDigest);
 assert.equal(env.db.prepare('SELECT COUNT(*) n FROM app_epoch_inputs').get().n,0);
});
test('payload or business binding cannot execute another cutoff and a changed object fails verification',async t=>{
 const env=await setup(t),acquired=await env.repository.acquireJob({leaseMs:30000}),job=acquired.job;
 const context={job,lease:job.lease,signal:new AbortController().signal,checkpoint:async()=>({kind:'checkpointed'})};
 assert.equal((await env.handler({...context,job:{...job,businessKey:'another-epoch'}})).reason,'job-snapshot-binding');
 env.objects.get(env.configuration.key)[0]^=1;
 assert.equal((await env.handler(context)).reason,'snapshot-configuration-conflict');
 assert.equal(env.db.prepare('SELECT COUNT(*) n FROM app_epoch_inputs').get().n,0);
});
