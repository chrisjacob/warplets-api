import test from 'node:test';
import assert from 'node:assert/strict';
import {cutoffScenario} from '../application/fixtures/cutoff-scenario.mjs';
import {createJobRepository} from './repository.mjs';
import {createJobCommand} from './model.mjs';
import {createEarnSettlementService} from '../earn/settlement-service.mjs';
import {createSettlementPreparationRepository} from '../storage/settlement-preparation.mjs';
import {COMMIT_ALLOCATION,settlementFenceKey,createAtomicSettlementRepository} from '../storage/atomic-settlement.mjs';
import {createCutoffSnapshotService} from '../earn/snapshot.mjs';

test('board commit between allocation pending read and held finish cannot lose its durable dependency wake',async t=>{
 const env=await cutoffScenario({beforeFreeze({db}){db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run('synthetic-snapshot','jobs-runner');}});t.after(()=>env.db.close());
 assert.equal((await env.service.assemble(env.principal,env.query)).kind,'committed');
 const jobs=createJobRepository(env.driver,{...env.ports,principal:env.principal}),service=createEarnSettlementService({repository:createSettlementPreparationRepository(env.driver,env.ports),artifacts:env.store,...env.ports});
 const payload={tokenId:'A',day:2},businessKey=settlementFenceKey(COMMIT_ALLOCATION,payload);
 await jobs.enqueue(await createJobCommand({principal:env.principal,requestKey:businessKey,nowMs:env.clock.nowMs(),input:{businessKey,sourceKey:businessKey,
  type:'allocate-token-day',payload:{...payload,principal:env.principal},readyMs:env.clock.nowMs(),maxAttempts:5}},env.crypto));
 const acquired=await jobs.acquireJob(),job=acquired.job;
 const missing=await service.prepareAllocation(env.principal,{...payload,requestKey:job.id});assert.equal(missing.reason,'board-required');assert.deepEqual(missing.dependencyIds,['board:'+env.epoch]);
 const prepared=await service.prepareBoard(env.principal,{epoch:env.epoch,requestKey:'synthetic-racing-board'});assert.equal(prepared.kind,'prepared');
 const lease={businessKey:settlementFenceKey(prepared.command.operationKind,prepared.command.input),token:'synthetic-board-lease',revision:'1',payloadDigest:prepared.command.requestDigest};
 env.db.prepare('INSERT INTO app_execution_fences(business_key,holder_token,revision,payload_digest,expires_ms) VALUES(?,?,?,?,?)').run(lease.businessKey,lease.token,1,lease.payloadDigest,env.clock.nowMs()+10000);
 const omit={...env.driver,async batch(statements){return env.driver.batch(statements.filter(s=>!s.sql.startsWith('INSERT INTO app_settlement_dependencies')));}};
 await assert.rejects(createAtomicSettlementRepository(omit,env.ports).commitBoard(prepared.command,lease),/Missing settlement dependency event/);
 assert.equal(env.db.prepare('SELECT COUNT(*) n FROM earn_boards').get().n,0);
 assert.equal(env.db.prepare("SELECT COUNT(*) n FROM app_job_outbox WHERE source_key LIKE 'publish-board:%'").get().n,0);
 assert.equal(env.db.prepare("SELECT COUNT(*) n FROM app_command_receipts WHERE operation_kind='earn.commit-board.v1'").get().n,0);
 const board=await env.settlementRepository.commitBoard(prepared.command,lease);assert.equal(board.kind,'committed');
 assert.equal((await jobs.readJob(job.id)).state,'running');
 let lost=false;const loss={...env.driver,async batch(statements){const result=await env.driver.batch(statements);
  if(!lost&&statements.some(s=>s.sql.startsWith('WITH new_dependency'))){lost=true;throw Error('lost hold acknowledgement');}return result;}};
 const reopened=createJobRepository(loss,{...env.ports,principal:env.principal}),hold={state:'held',reason:missing.reason,dependency:missing.dependencyIds[0],readyMs:null};
 const finished=await reopened.finish(job.lease,hold);assert.equal(lost,true);assert.equal(finished.kind,'finished');assert.equal(finished.job.state,'queued');
 const again=(await jobs.acquireJob()).job;assert.equal(again.id,job.id);assert.equal(again.attempt,2);
 assert.equal((await service.prepareAllocation(env.principal,{...payload,requestKey:job.id})).kind,'prepared');
 // An already-observed event cannot spin a persistently held handler.
 assert.equal((await jobs.finish(again.lease,hold)).job.state,'held');assert.equal((await jobs.acquireJob()).kind,'idle');
 assert.equal((await env.settlementRepository.commitBoard(prepared.command,lease)).kind,'replayed');
 assert.equal((await jobs.acquireJob()).kind,'idle');
 const events=env.db.prepare('SELECT * FROM app_settlement_dependencies WHERE dependency=?').all('board:'+env.epoch);assert.equal(events.length,1);assert.equal(events[0].digest,board.value.snapshotId);
 assert.throws(()=>env.db.prepare('DELETE FROM app_settlement_dependencies').run(),/Retain settlement dependency/);
});

test('omitting the seal dependency child rolls back its complete-input pointer and durable finalize obligation',async t=>{
 const env=await cutoffScenario();t.after(()=>env.db.close());
 const omit={...env.driver,async batch(statements){return env.driver.batch(statements.filter(s=>!s.sql.startsWith('INSERT INTO app_settlement_dependencies')));}};
 const service=createCutoffSnapshotService({repository:env.repository,settlementRepository:createAtomicSettlementRepository(omit,env.ports),privateReferences:env.privateReferences,...env.ports});
 await assert.rejects(service.assemble(env.principal,env.query),/Missing settlement dependency event/);
 for(const table of ['app_complete_inputs','app_epoch_inputs','app_job_outbox','app_settlement_dependencies'])assert.equal(env.db.prepare('SELECT COUNT(*) n FROM '+table).get().n,0,table);
 assert.equal(env.db.prepare("SELECT COUNT(*) n FROM app_command_receipts WHERE operation_kind='earn.seal-input.v1'").get().n,0);
 assert.equal((await env.service.assemble(env.principal,env.query)).kind,'committed');
 assert.equal(env.db.prepare('SELECT COUNT(*) n FROM app_settlement_dependencies').get().n,1);
});
