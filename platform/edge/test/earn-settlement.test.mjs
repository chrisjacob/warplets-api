import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {localRuntime} from './local-runtime.mjs';
import {settlementScenario,copySettlementSeed} from '../../application/fixtures/settlement-scenario.mjs';
import {measuredDriver,settlementAcceptance} from './fixtures/earn-settlement-harness.mjs';
import {COMMIT_ALLOCATION,createSettlementCommand,settlementFenceKey} from '../../storage/atomic-settlement.mjs';
import {allocationWindow,DAY_MS} from '../../domain/earn/index.mjs';
import {canonicalJson,utf8} from '../../security/canonical.mjs';

async function setup(t,options){
 const node=await settlementScenario(options);t.after(()=>node.db.close());
 const {mf,db}=await localRuntime(t,new URL('./fixtures/earn-settlement-worker.ts',import.meta.url)),r2=await mf.getR2Bucket('MANIFESTS');
 await copySettlementSeed(node,db,r2);
 const measured=measuredDriver(node.driver),runtime=settlementAcceptance({...node.ports,driver:measured.driver,store:node.store,principal:node.principal,ids:{next:randomUUID}});
 const stages=[];
 async function both(body){
  const before={...measured.measurements},left=await runtime.call(body);
  const response=await mf.dispatchFetch('http://localhost/synthetic-settlement',{method:'POST',body:JSON.stringify({...body,principal:node.principal,nowMs:node.clock.nowMs()})});
  const right=await response.json();assert.equal(response.status,200,JSON.stringify(right));
  const delta=Object.fromEntries(Object.entries(measured.measurements).map(([key,value])=>[key,key.startsWith('max')?value:value-before[key]]));
  assert.equal(right.result.kind,left.kind,JSON.stringify({left,right}));
  stages.push({method:body.method,node:delta,d1:right.measurements});return {node:left,d1:right.result,measurements:right.measurements};
 }
 async function edge(body){const r=await mf.dispatchFetch('http://localhost/synthetic-settlement',{method:'POST',body:JSON.stringify({...body,principal:node.principal,nowMs:node.clock.nowMs()})});return {status:r.status,...await r.json()};}
 return {...node,edge,both,edgeDb:db,r2,runtime,stages};
}
const complete=result=>{assert.equal(result.processed,1,JSON.stringify(result));assert.equal(result.items[0].job.state,'completed',JSON.stringify(result));};

for(const count of [0,5,10,100])test('complete B05 manifest through leased B07 board/allocation has Node/workerd parity for '+count+' winners',async t=>{
 const multi=count===10,day=count===5?10:2;
 const f=await setup(t,{wallets:count,campaigns:multi?10:1,day,extraPost:multi,extremes:multi});
 const sealed=await f.both({method:'seal',query:f.query});assert.equal(sealed.node.kind,'committed');
 assert.equal(sealed.node.value.inputDigest,sealed.d1.value.inputDigest);
 assert.equal(sealed.node.value.manifestDigest,sealed.d1.value.manifestDigest,'identical complete fixture produces identical manifest bytes');
 const prepared=await f.both({method:'prepare-board',query:{epoch:f.epoch,requestKey:'synthetic-inspection'}});
 assert.equal(prepared.node.kind,'prepared',JSON.stringify(prepared));assert.equal(prepared.node.plan.winners.length,count);
 assert.deepEqual(prepared.d1.plan,prepared.node.plan);
 if(multi){assert.equal(prepared.node.plan.decisions.length,11);assert.equal(prepared.node.plan.winners.find(w=>w.wallet==='synthetic-wallet-000').submissionId,'synthetic-second-post');}
 assert.equal((await f.both({method:'drain-outbox'})).node.processed,1);
 const finalized=await f.both({method:'tick'});complete(finalized.node);complete(finalized.d1);
 assert.ok(finalized.measurements.statements<=1000,'complete Worker preparation, commit and job bookkeeping must fit1000 SQL statements');
 const nodeBoard=f.db.prepare('SELECT * FROM earn_boards WHERE epoch=?').get(f.epoch),edgeBoard=await f.edgeDb.prepare('SELECT * FROM earn_boards WHERE epoch=?').bind(f.epoch).first();
 assert.deepEqual(edgeBoard,{...nodeBoard});
 const proofBytes=utf8(JSON.stringify(prepared.node.plan.commitmentInput));assert.equal(await f.crypto.sha256(proofBytes),nodeBoard.snapshot_hash);
 assert.equal(await f.crypto.sha256(utf8(JSON.stringify(prepared.d1.plan.commitmentInput))),nodeBoard.snapshot_hash);
 assert.equal((await f.both({method:'prepare-board',query:{epoch:f.epoch,requestKey:'synthetic-inspection'}})).node.kind,'final');
 // Delay processing two days; the allocation and vesting dates remain anchored
 // to each campaign's actual activation, including the35-minute difference.
 f.advance(2*DAY_MS+35*60*1000);
 const campaigns=f.db.prepare('SELECT * FROM earn_fixture_campaigns ORDER BY token_id').all();
 for(const campaign of campaigns){
  const query={tokenId:campaign.token_id,day,requestKey:'synthetic-allocation-'+campaign.token_id};
  const plan=await f.both({method:'prepare-allocation',query});assert.equal(plan.node.kind,'prepared',JSON.stringify(plan));assert.deepEqual(plan.d1.plan,plan.node.plan);
  await f.both({method:'enqueue',kind:COMMIT_ALLOCATION,input:{tokenId:campaign.token_id,day},requestKey:query.requestKey});
  const allocated=await f.both({method:'tick'});complete(allocated.node);complete(allocated.d1);
  const window=allocationWindow(campaign.activation_ms,day),record=f.db.prepare('SELECT * FROM earn_allocations WHERE token_id=? AND day=?').get(campaign.token_id,day);
  assert.equal(record.epoch,f.epoch);assert.equal(record.starts_ms,window.startsAtMs);assert.equal(record.vests_from_ms,window.vestsFromMs);assert.equal(record.vests_through_ms,window.vestsThroughMs);
  const awards=f.db.prepare('SELECT wallet,amount FROM earn_awards WHERE token_id=? AND day=? ORDER BY wallet').all(campaign.token_id,day);
  assert.deepEqual((await f.edgeDb.prepare('SELECT wallet,amount FROM earn_awards WHERE token_id=? AND day=? ORDER BY wallet').bind(campaign.token_id,day).all()).results,awards.map(a=>({...a})));
  assert.equal(BigInt(record.budget),awards.reduce((sum,a)=>sum+BigInt(a.amount),0n)+BigInt(record.burn));
  assert.ok(awards.every(a=>BigInt(a.amount)<=BigInt(record.budget)/10n));
  if(!multi){assert.equal(record.burn,count===0?'10000':count===5?'5000':'0');assert.ok(awards.every(a=>a.amount===(count===100?'100':'1000')));}
  assert.equal((await f.both({method:'prepare-allocation',query})).node.kind,'recorded');
 }
 if(multi){const times=f.db.prepare('SELECT starts_ms,vests_from_ms FROM earn_allocations ORDER BY token_id').all();assert.equal(times[1].starts_ms-times[0].starts_ms,35*60*1000);assert.equal(times[1].vests_from_ms-times[0].vests_from_ms,35*60*1000);}
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_job_outbox').get().n,2+campaigns.length,'seal, board and every allocation leave durable next work');
 assert.equal(await f.edgeDb.prepare('SELECT COUNT(*) n FROM manifest_catalog').first('n'),0,'B07 does not publish prematurely');
 if(count===5){
  const query={epoch:f.epoch},consistent=await f.both({method:'reconcile',query});assert.equal(consistent.node.kind,'consistent');assert.deepEqual(consistent.node,consistent.d1);
  const awardsBefore=f.db.prepare('SELECT * FROM earn_awards ORDER BY token_id,day,wallet').all().map(r=>({...r}));
  const key=f.db.prepare('SELECT stream_key FROM app_evidence_heads ORDER BY stream_key LIMIT 1').get().stream_key;
  f.db.prepare('DELETE FROM app_evidence_heads WHERE stream_key=?').run(key);await f.edgeDb.prepare('DELETE FROM app_evidence_heads WHERE stream_key=?').bind(key).run();
  const incident=await f.both({method:'reconcile',query});assert.equal(incident.node.kind,'incident');assert.equal(incident.node.changedRequirements,1);assert.equal(incident.node.awardsPreserved,true);assert.deepEqual(incident.node,incident.d1);
  const repeated=await f.both({method:'reconcile',query});assert.deepEqual(repeated.node,incident.node);assert.deepEqual(repeated.d1,incident.d1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_settlement_incidents').get().n,1);assert.equal(await f.edgeDb.prepare('SELECT COUNT(*) n FROM app_settlement_incidents').first('n'),1);
  assert.deepEqual(f.db.prepare('SELECT * FROM earn_boards WHERE epoch=?').get(f.epoch),nodeBoard);assert.deepEqual(await f.edgeDb.prepare('SELECT * FROM earn_boards WHERE epoch=?').bind(f.epoch).first(),edgeBoard);
  assert.deepEqual(f.db.prepare('SELECT * FROM earn_awards ORDER BY token_id,day,wallet').all().map(r=>({...r})),awardsBefore);assert.deepEqual((await f.edgeDb.prepare('SELECT * FROM earn_awards ORDER BY token_id,day,wallet').all()).results,awardsBefore);
 }
 const budget={};for(const stage of f.stages){const s=budget[stage.method]??={calls:0,nodeStatements:0,d1Statements:0,d1Batches:0};s.calls++;s.nodeStatements+=stage.node.statements;s.d1Statements+=stage.d1.statements;s.d1Batches+=stage.d1.batches;}
 console.log('B07 complete synthetic query budget',canonicalJson({wallets:count,campaigns:campaigns.length,budget,boardTick:finalized.measurements}));
});

test('workerd real leases roll back omitted board/award/outbox effects, reject expiry and correction races, and reconcile lost commits',async t=>{
 const f=await setup(t,{wallets:2});
 assert.equal((await f.edge({method:'seal',query:f.query})).result.kind,'committed');
 await f.edge({method:'drain-outbox'});
 const acquired=await f.edge({method:'acquire'});assert.equal(acquired.result.kind,'acquired');const lease=acquired.result.job.lease;
 let prepared=await f.edge({method:'prepare-board',query:{epoch:f.epoch,requestKey:'synthetic-fault-board'}});assert.equal(prepared.result.kind,'prepared');
 const count=async table=>f.edgeDb.prepare('SELECT COUNT(*) n FROM '+table).first('n');
 const attempt=async fault=>f.edge({method:'commit-board',command:prepared.result.command,lease,fault});
 const beforeBoardReceipts=await count('app_command_receipts');
 for(const fault of ['omit-last-child','omit-outbox','wrong-publication-board']){
  const failed=await attempt(fault);assert.equal(failed.status,500,JSON.stringify(failed));
  for(const table of ['earn_boards','earn_decisions','earn_member_facts','earn_streaks'])assert.equal(await count(table),0);
  assert.equal(await count('app_job_outbox'),1);
  assert.equal(await count('app_command_receipts'),beforeBoardReceipts);
 }
 const expired=await attempt('expired-worker');assert.equal(expired.result.kind,'conflict');assert.equal(await count('earn_boards'),0);
 await f.edgeDb.prepare('UPDATE app_execution_fences SET expires_ms=?').bind(f.clock.nowMs()+30000).run();
 const corrected=await attempt('correction-race');assert.equal(corrected.result.kind,'conflict');assert.equal(await count('earn_boards'),0);
 assert.notEqual((await f.edge({method:'prepare-board',query:{epoch:f.epoch,requestKey:'synthetic-stale-manifest'}})).result.kind,'prepared');
 assert.equal((await f.edge({method:'seal',query:f.query})).result.kind,'committed');
 prepared=await f.edge({method:'prepare-board',query:{epoch:f.epoch,requestKey:'synthetic-fault-board'}});assert.equal(prepared.result.kind,'prepared');
 const accepted=await attempt('lost-committed-response');assert.ok(['committed','replayed'].includes(accepted.result.kind),JSON.stringify(accepted));
 assert.equal(await count('earn_boards'),1);assert.equal(await count('earn_member_facts'),2);assert.equal(await count('app_job_outbox'),2);
 const replay=await f.edge({method:'commit-board',command:prepared.result.command,lease:{...lease,token:'stale-synthetic-token'}});assert.equal(replay.result.kind,'replayed');
 const immutable=await f.edgeDb.prepare('SELECT snapshot_hash,winners FROM earn_boards').first();
 await f.edgeDb.prepare("UPDATE app_operator_scopes SET revision=revision+1 WHERE scope='earn-settlement'").run();
 assert.equal((await f.edge({method:'prepare-board',query:{epoch:f.epoch,requestKey:'synthetic-final-correction'}})).result.kind,'final');
 assert.deepEqual(await f.edgeDb.prepare('SELECT snapshot_hash,winners FROM earn_boards').first(),immutable);
 await f.edge({method:'finish',lease,outcome:{state:'completed',result:{synthetic:true}}});
 await f.edge({method:'enqueue',kind:COMMIT_ALLOCATION,input:{tokenId:'A',day:2},requestKey:'synthetic-fault-allocation'});
 const allocationLease=(await f.edge({method:'acquire'})).result.job.lease;
 const allocation=await f.edge({method:'prepare-allocation',query:{tokenId:'A',day:2,requestKey:'synthetic-fault-allocation'}});assert.equal(allocation.result.kind,'prepared');
 const beforeAllocationReceipts=await count('app_command_receipts');
 for(const fault of ['omit-last-child','omit-outbox','wrong-publication-board']){
  const failed=await f.edge({method:'commit-allocation',command:allocation.result.command,lease:allocationLease,fault});assert.equal(failed.status,500,JSON.stringify(failed));
  assert.equal(await count('earn_allocations'),0);assert.equal(await count('earn_awards'),0);assert.equal(await count('app_job_outbox'),2);
  assert.equal(await count('app_command_receipts'),beforeAllocationReceipts);
 }
 const allocated=await f.edge({method:'commit-allocation',command:allocation.result.command,lease:allocationLease,fault:'lost-committed-response'});
 assert.ok(['committed','replayed'].includes(allocated.result.kind),JSON.stringify(allocated));assert.equal(await count('earn_allocations'),1);assert.equal(await count('earn_awards'),2);
 assert.equal((await f.edge({method:'commit-allocation',command:allocation.result.command,lease:{...allocationLease,token:'expired-synthetic'}})).result.kind,'replayed');
 // Direct writes here model a malformed legacy campaign row. Both preparation
 // and the guarded repository must refuse it before planning any award.
 const immutableReceipts=await count('app_command_receipts');
 await f.edgeDb.prepare('INSERT INTO earn_fixture_campaigns VALUES(?,?,?)').bind('synthetic-invalid-supply',f.start,'0').run();
 for(const supply of ['0','100','18446744073709551616','01','malformed']){
  await f.edgeDb.prepare('UPDATE earn_fixture_campaigns SET original_units=? WHERE token_id=?').bind(supply,'synthetic-invalid-supply').run();
  const query={tokenId:'synthetic-invalid-supply',day:2,requestKey:'synthetic-invalid-'+supply};
  const preparation=await f.edge({method:'prepare-allocation',query});assert.equal(preparation.result.kind,'pending');assert.equal(preparation.result.reason,'campaign-supply-policy');
  const input={tokenId:query.tokenId,day:2,boardDigest:immutable.snapshot_hash,planDigest:'0'.repeat(64)};
  const command=await createSettlementCommand(COMMIT_ALLOCATION,{principal:f.principal,requestKey:query.requestKey,nowMs:f.clock.nowMs(),input},f.crypto);
  const direct=await f.edge({method:'commit-allocation',command,lease:{...allocationLease,businessKey:settlementFenceKey(COMMIT_ALLOCATION,input)}});
  assert.equal(direct.result.kind,'pending');assert.equal(direct.result.reason,'campaign-supply-policy');assert.equal(await count('app_command_receipts'),immutableReceipts);
  assert.equal(await count('earn_allocations'),1);assert.equal(await count('earn_awards'),2);
 }
});

test('local settlement context wakes an allocation held before its board and preserves durable publication work',async t=>{
 const f=await setup(t,{wallets:1});
 const enqueued=await f.edge({method:'enqueue',kind:COMMIT_ALLOCATION,input:{tokenId:'A',day:2},requestKey:'synthetic-waiting-allocation'}),id=enqueued.result.job.id;
 const held=await f.edge({method:'tick-context'});assert.equal(held.result.items[0].job.state,'held');assert.equal(held.result.items[0].job.dependency,'board:'+f.epoch);
 await f.edge({method:'seal',query:f.query});
 const board=await f.edge({method:'tick-context'});complete(board.result);
 assert.equal(await f.edgeDb.prepare('SELECT state FROM app_jobs WHERE id=?').bind(id).first('state'),'queued','board commit wakes the exact waiting dependency');
 for(let n=0;n<3&&await f.edgeDb.prepare('SELECT state FROM app_jobs WHERE id=?').bind(id).first('state')!=='completed';n++)await f.edge({method:'tick-context'});
 assert.equal(await f.edgeDb.prepare('SELECT state FROM app_jobs WHERE id=?').bind(id).first('state'),'completed');
 assert.equal(await f.edgeDb.prepare('SELECT COUNT(*) n FROM earn_allocations').first('n'),1);
 assert.equal(await f.edgeDb.prepare("SELECT COUNT(*) n FROM app_job_events WHERE job_id=?").bind(id).first('n'),1);
 assert.equal(await f.edgeDb.prepare("SELECT COUNT(*) n FROM app_job_outbox WHERE command_json LIKE '%publish-archive%'").first('n'),2);
});

test('Node/workerd scheduler records ten campaign days with exact activation offsets and durable replay',async t=>{
 const f=await setup(t,{wallets:0,campaigns:10});
 let after='',scheduled=0;
 do{const r=await f.both({method:'schedule',query:{after,limit:3}});assert.deepEqual(r.node,r.d1);assert.equal(r.node.kind,'scheduled');scheduled+=r.node.count;after=r.node.next;}while(after);
 assert.equal(scheduled,100);assert.equal((await f.both({method:'schedule',query:{}})).node.count,100);
 const rows=await f.edgeDb.prepare('SELECT command_json FROM app_job_outbox ORDER BY source_key').all();
 assert.equal(rows.results.length,100);
 for(const row of rows.results){const command=JSON.parse(row.command_json),{tokenId,day}=command.input.payload;
  const campaign=f.db.prepare('SELECT activation_ms FROM earn_fixture_campaigns WHERE token_id=?').get(tokenId),window=allocationWindow(campaign.activation_ms,day);
  assert.equal(command.input.readyMs,window.startsAtMs);assert.equal(command.nowMs,window.startsAtMs);
  if(day===10)assert.equal(window.vestsFromMs,campaign.activation_ms+10*DAY_MS,'day10 vests from actual day11');
 }
 assert.equal(await f.edgeDb.prepare('SELECT COUNT(*) n FROM earn_allocations').first('n'),0);
});

test('complete delayed moderation keeps its original board and a25-hour approval gap restarts the streak in Node/workerd',async t=>{
 const f=await setup(t,{wallets:2,beforeFreeze({db,epoch,start,advance}){
  db.prepare('UPDATE earn_reviews SET reviewed_ms=? WHERE submission_id=?').run(start+DAY_MS+3600003,'synthetic-post-0');
  db.prepare('INSERT INTO earn_boards VALUES(?,?,?,?,?)').run(epoch-1,'[]',start,'synthetic-previous-final','synthetic-previous-source');
  db.prepare('INSERT INTO earn_streaks VALUES(?,?,?,?)').run(epoch-1,'synthetic-wallet-001',3,start-DAY_MS+3);
  advance(DAY_MS);
 }});
 assert.equal((await f.both({method:'seal',query:f.query})).node.kind,'committed');
 const prepared=await f.both({method:'prepare-board',query:{epoch:f.epoch,requestKey:'synthetic-late-review'}});assert.equal(prepared.node.kind,'prepared');assert.deepEqual(prepared.node.plan,prepared.d1.plan);
 assert.equal(prepared.node.plan.winners.length,2);assert.ok(prepared.node.plan.winners.some(w=>w.submissionId==='synthetic-post-0'));
 assert.equal(prepared.node.plan.streaks.some(s=>s.wallet==='synthetic-wallet-000'),false,'late review never backdates its approval to the original submission day');
 assert.equal(prepared.node.plan.streaks.find(s=>s.wallet==='synthetic-wallet-001').days,1,'a25-hour gap restarts the previous three-day streak');
 await f.both({method:'drain-outbox'});const finalized=await f.both({method:'tick'});complete(finalized.node);complete(finalized.d1);
 const node=f.db.prepare('SELECT epoch,snapshot_hash,winners FROM earn_boards ORDER BY epoch').all();assert.deepEqual((await f.edgeDb.prepare('SELECT epoch,snapshot_hash,winners FROM earn_boards ORDER BY epoch').all()).results,node.map(r=>({...r})));
 assert.equal(node.at(-1).epoch,f.epoch,'delayed processing never moves the original board');
});

test('workerd board completion between pending read and held finish preserves the wake across lost acknowledgement without spinning',async t=>{
 const f=await setup(t,{wallets:1});
 const enqueued=await f.edge({method:'enqueue',kind:COMMIT_ALLOCATION,input:{tokenId:'A',day:2},requestKey:'synthetic-racing-allocation'}),id=enqueued.result.job.id;
 const acquired=await f.edge({method:'acquire'});assert.equal(acquired.result.job.id,id);
 const missing=await f.edge({method:'prepare-allocation',query:{tokenId:'A',day:2,requestKey:id}});
 assert.equal(missing.result.reason,'board-required');assert.deepEqual(missing.result.dependencyIds,['board:'+f.epoch]);
 await f.edge({method:'seal',query:f.query});await f.edge({method:'drain-outbox'});
 const committed=await f.edge({method:'tick'});complete(committed.result);
 assert.equal(await f.edgeDb.prepare('SELECT state FROM app_jobs WHERE id=?').bind(id).first('state'),'running');
 const outcome={state:'held',reason:missing.result.reason,dependency:missing.result.dependencyIds[0],readyMs:null};
 const finished=await f.edge({method:'finish',lease:acquired.result.job.lease,outcome,fault:'lost-hold-response'});
 assert.equal(finished.result.kind,'finished',JSON.stringify(finished));assert.equal(finished.result.job.state,'queued');
 const again=await f.edge({method:'acquire'});assert.equal(again.result.job.id,id);assert.equal(again.result.job.attempt,2);
 assert.equal((await f.edge({method:'prepare-allocation',query:{tokenId:'A',day:2,requestKey:id}})).result.kind,'prepared');
 const sameEvent=await f.edge({method:'finish',lease:again.result.job.lease,outcome});assert.equal(sameEvent.result.job.state,'held');
 assert.equal((await f.edge({method:'acquire'})).result.kind,'idle','an already-observed dependency event cannot spin a persistently held job');
 const events=await f.edgeDb.prepare('SELECT digest FROM app_settlement_dependencies WHERE dependency=?').bind('board:'+f.epoch).all();
 assert.equal(events.results.length,1);assert.equal(events.results[0].digest,await f.edgeDb.prepare('SELECT snapshot_hash FROM earn_boards WHERE epoch=?').bind(f.epoch).first('snapshot_hash'));
});
