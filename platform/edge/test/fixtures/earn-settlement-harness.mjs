// Local acceptance orchestration shared by Node and workerd, never HTTP product code.
import {COMMIT_BOARD,settlementFenceKey} from '../../../storage/atomic-settlement.mjs';
import {createLocalSettlementContext} from '../../../application/settlement-context.mjs';
import {createCutoffSnapshotRepository} from '../../../storage/cutoff-snapshot.mjs';
import {createCutoffSnapshotService} from '../../../earn/snapshot.mjs';
import {createArtifactReferenceRepository} from '../../../storage/atomic-artifacts.mjs';
import {createPrivateReferenceService} from '../../../artifacts/reference-service.mjs';
import {createJobCommand} from '../../../jobs/model.mjs';
import {createPreparedSettlementHandler} from '../../../jobs/prepared-settlement-handler.mjs';
import {createHandlerRegistry} from '../../../jobs/handlers.mjs';
import {runTick} from '../../../jobs/runner.mjs';
import {reconcileJobOutbox} from '../../../jobs/outbox.mjs';
import {measureBatch} from '../../../storage/atomic-driver.mjs';

export function measuredDriver(driver){
 const measurements={batches:0,statements:0,selects:0,writes:0,maxParameters:0,maxSqlBytes:0,maxBatchBytes:0};
 return {measurements,driver:{...driver,async batch(statements){
  const m=measureBatch(statements);measurements.batches++;measurements.statements+=statements.length;
  for(const statement of statements)measurements[/^\s*(SELECT|WITH)\b/i.test(statement.sql)?'selects':'writes']++;
  measurements.maxParameters=Math.max(measurements.maxParameters,m.maxParameters);
  measurements.maxSqlBytes=Math.max(measurements.maxSqlBytes,m.maxSqlBytes);
  measurements.maxBatchBytes=Math.max(measurements.maxBatchBytes,m.batchBytes);
  return driver.batch(statements);
 }}};
}

export function settlementAcceptance({driver,store,crypto,clock,ids,principal}){
 const ports={crypto,clock,ids},context=createLocalSettlementContext({driver,artifacts:store,...ports,principal});
 const {repository:atomic,service,jobs}=context;
 const snapshots=createCutoffSnapshotService({repository:createCutoffSnapshotRepository(driver,ports),settlementRepository:atomic,
  privateReferences:createPrivateReferenceService({store,repository:createArtifactReferenceRepository(driver,ports),...ports}),...ports});
 const handler=createPreparedSettlementHandler({service,repository:atomic,crypto,clock,principal});
 const handlers=createHandlerRegistry({'finalize-board':handler,'allocate-token-day':handler});
 return {atomic,service,jobs,async call(body){
  if(body.method==='seal')return snapshots.assemble(principal,body.query);
  if(body.method==='prepare-board')return service.prepareBoard(principal,body.query);
  if(body.method==='prepare-allocation')return service.prepareAllocation(principal,body.query);
  if(body.method==='enqueue'){
   const {kind,input,requestKey}=body,businessKey=settlementFenceKey(kind,input),payload={principal,...input};
   return jobs.enqueue(await createJobCommand({principal,requestKey,nowMs:clock.nowMs(),input:{businessKey,
    sourceKey:'synthetic-source-'+businessKey,type:kind===COMMIT_BOARD?'finalize-board':'allocate-token-day',payload,readyMs:clock.nowMs(),maxAttempts:5}},crypto));
  }
  if(body.method==='tick')return runTick({repository:jobs,clock,handlers,limit:1,deadlineMs:5000});
  if(body.method==='tick-context')return context.tick();
  if(body.method==='schedule')return context.scheduler.scheduleCampaigns(body.query);
  if(body.method==='reconcile')return context.reconciler.inspectBoard(body.query);
  if(body.method==='drain-outbox')return reconcileJobOutbox(driver,jobs,{limit:20});
  if(body.method==='acquire')return jobs.acquireJob();
  if(body.method==='commit-board')return atomic.commitBoard(body.command,body.lease);
  if(body.method==='commit-allocation')return atomic.commitAllocation(body.command,body.lease);
  if(body.method==='wake')return jobs.wake(body.input);
  if(body.method==='finish')return jobs.finish(body.lease,body.outcome);
  throw Error('Unknown synthetic acceptance operation.');
 }};
}
