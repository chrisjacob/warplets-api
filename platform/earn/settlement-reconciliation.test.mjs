import test from 'node:test';
import assert from 'node:assert/strict';
import {cutoffScenario} from '../application/fixtures/cutoff-scenario.mjs';
import {createLocalSettlementContext} from '../application/settlement-context.mjs';
import {createSettlementReconciler} from './settlement-reconciliation.mjs';
import {evidenceFixture} from '../evidence/fixtures.mjs';
import {canonicalJson} from '../security/canonical.mjs';
test('later negative evidence records an immutable incident without reranking or removing any final award',async t=>{
 const e=await cutoffScenario({beforeFreeze({db}){db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run('synthetic-snapshot','jobs-runner');}});t.after(()=>e.db.close());
 assert.equal((await e.service.assemble(e.principal,e.query)).kind,'committed');
 const context=createLocalSettlementContext({...e.ports,driver:e.driver,artifacts:e.store,principal:e.principal});
 assert.equal((await context.tick()).items[0].job.state,'completed');
 await context.scheduler.scheduleCampaigns();
 // The archive handler is explicitly held until B08; due allocation work keeps
 // progressing independently through the same durable outbox.
 for(let i=0;i<15&&!e.db.prepare('SELECT 1 FROM earn_allocations WHERE token_id=? AND day=2').get('A');i++)await context.tick();
 assert.ok(e.db.prepare('SELECT 1 FROM earn_allocations WHERE token_id=? AND day=2').get('A'));
 const before=e.db.prepare('SELECT * FROM earn_awards ORDER BY token_id,day,wallet').all(),board=e.db.prepare('SELECT * FROM earn_boards').get();
 const make=(driver=e.driver)=>createSettlementReconciler({...e.ports,driver,artifacts:e.store,principal:e.principal});
 assert.equal((await make().inspectBoard({epoch:e.epoch})).kind,'consistent');
 const owner=e.fixtures.find(f=>f.requirement.kind==='ownership'),subject=owner.source.subject;
 const payload={version:1,network:'local-solana',kind:'ownership',subject,fromMs:e.cutoff,toMs:e.cutoff,complete:false,pages:[]};
 const next=await evidenceFixture({crypto:e.crypto,payload,policy:owner.source.policy,subject,decoderVersion:owner.source.decoderVersion,now:e.cutoff});
 next.source.sourceId=owner.source.sourceId;next.source.sourceRevision='v2';next.request.sourceId=next.source.sourceId;next.request.sourceRevision='v2';
 e.readers.set(canonicalJson([next.source.sourceId,'v2']),next.reader);
 assert.equal((await e.evidenceService.registerSource(e.principal,next.source)).kind,'committed');
 assert.equal((await e.evidenceService.ingest(e.principal,{...next.request,supersedes:owner.receipt.receiptDigest})).value.decision.status,'pending');
 let lost=false;const loss={...e.driver,async batch(s){const r=await e.driver.batch(s);if(!lost&&s.some(x=>x.sql.startsWith('INSERT INTO app_settlement_incidents'))){lost=true;throw Error('lost acknowledgement');}return r;}};
 const incident=await make(loss).inspectBoard({epoch:e.epoch});assert.equal(incident.kind,'incident');assert.equal(incident.changedRequirements,1);assert.equal(incident.awardsPreserved,true);
 assert.deepEqual(await make().inspectBoard({epoch:e.epoch}),incident);assert.equal(e.db.prepare('SELECT COUNT(*) n FROM app_settlement_incidents').get().n,1);
 assert.deepEqual(e.db.prepare('SELECT * FROM earn_awards ORDER BY token_id,day,wallet').all(),before);assert.deepEqual(e.db.prepare('SELECT * FROM earn_boards').get(),board);
 assert.throws(()=>e.db.exec('DELETE FROM app_settlement_incidents'),/Retain settlement/);
});
