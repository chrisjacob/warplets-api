import assert from 'node:assert/strict';
import {cutoffScenario} from '../application/fixtures/cutoff-scenario.mjs';
import {createLocalSettlementContext} from '../application/settlement-context.mjs';
if(process.argv.slice(2).join(' ')!=='--fixture-rehearsal')throw Error('Only --fixture-rehearsal is supported. No live scheduler is installed.');
const fixture=await cutoffScenario({beforeFreeze({db}){db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run('synthetic-snapshot','jobs-runner');}});
try{
 const context=createLocalSettlementContext({...fixture.ports,driver:fixture.driver,artifacts:fixture.store,principal:fixture.principal});
 assert.equal((await context.scheduleCutoff(fixture.query)).kind,'committed');
 assert.equal((await context.scheduleCutoff(fixture.query)).kind,'replayed');
 assert.equal((await context.scheduler.scheduleCampaigns()).kind,'scheduled');
 let ticks=0;
 while(ticks++<25){await context.tick();if(fixture.db.prepare("SELECT 1 FROM earn_allocations WHERE token_id='A' AND day=2").get())break;}
 const board=fixture.db.prepare('SELECT snapshot_hash FROM earn_boards WHERE epoch=?').get(fixture.epoch),allocation=fixture.db.prepare("SELECT * FROM earn_allocations WHERE token_id='A' AND day=2").get();
 assert.ok(board);assert.ok(allocation);
 const awards=fixture.db.prepare("SELECT amount FROM earn_awards WHERE token_id='A' AND day=2").all().reduce((sum,r)=>sum+BigInt(r.amount),0n);
 assert.equal(awards+BigInt(allocation.burn),BigInt(allocation.budget));
 assert.equal((await context.reconciler.inspectBoard({epoch:fixture.epoch})).kind,'consistent');
 assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM manifest_catalog').get().n,0);
 console.log(JSON.stringify({mode:'synthetic-fixture',ticks,epoch:fixture.epoch,snapshotId:board.snapshot_hash,allocation,awardedUnits:String(awards),
  publicationObligations:fixture.db.prepare("SELECT COUNT(*) n FROM app_job_outbox WHERE json_extract(command_json,'$.input.type')='publish-archive'").get().n,
  publicationStatus:'pending-B08',providerCalls:0,financialExecution:false},null,2));
}finally{fixture.db.close();}
