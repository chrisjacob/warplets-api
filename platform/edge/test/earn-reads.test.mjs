import test from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from './local-runtime.mjs';
import {openDatabase} from '../../storage/database.mjs';
import {createNodeAtomicDriver} from '../../storage/node/atomic-driver.mjs';
import {createEarnReadRepository} from '../../storage/earn-reads.mjs';
import {buildGoldenScenario} from '../../application/fixtures/earn-scenario.mjs';
import {configureWorkload} from '../../earn/operations.mjs';
import {configureAction,recordActionCompletion} from '../../earn/components.mjs';
import {importBoard} from '../../earn/archive.mjs';
import {DAY_MS} from '../../domain/earn/index.mjs';
async function copy(node,db,tables){
 for(const table of tables){const statements=node.prepare('SELECT * FROM '+table+' ORDER BY rowid').all().map(row=>{
  const keys=Object.keys(row);return db.prepare('INSERT INTO '+table+' ('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').bind(...Object.values(row));
 });if(statements.length)await db.batch(statements);}
}
test('workerd Earn projections match Node DTOs and reject mixed reads without wallet data leakage',async t=>{
 const node=openDatabase();t.after(()=>node.close());
 const scenario=await buildGoldenScenario(node,{beforeFinalize(q){const start=q.epoch*DAY_MS;
  configureWorkload(node,{effectiveEpoch:q.epoch,atMs:start-1,staffedMinutes:10,secondsPerReview:6,admissionLimit:100,operator:'fixture',reason:'synthetic staffing'});
  configureAction(node,{actionId:'guide',label:'Fixture guide',verifier:'fixture-proof',enabled:true,effectiveEpoch:q.epoch,atMs:start-1});
  recordActionCompletion(node,{wallet:'w1',actionId:'guide',verifier:'fixture-proof',verifiedMs:start,sourceRef:'synthetic-proof'});
 }});
 const {mf,db}=await localRuntime(t,new URL('./fixtures/earn-reads-worker.ts',import.meta.url));
 await copy(node,db,['earn_fixture_campaigns','price_sources','earn_stake_reads','price_observations','earn_workload_policies',
  'earn_action_catalog','earn_action_changes','earn_action_completions','earn_submissions','earn_reviews','earn_owner_snapshots','earn_boards',
  'earn_member_facts','earn_streaks','earn_decisions','earn_allocations','earn_awards']);
 const repo=createEarnReadRepository(createNodeAtomicDriver(node)),nowMs=scenario.start+2*DAY_MS,principal={kind:'wallet',wallet:'w1'};
 const call=async(method,extra={})=>{const response=await mf.dispatchFetch('http://localhost/reads',{method:'POST',body:JSON.stringify({method,epoch:scenario.epoch,nowMs,wallet:'w1',...extra})});assert.equal(response.status,200);return response.json();};
 assert.deepEqual(await call('leaderboard'),await repo.readLeaderboard({epoch:scenario.epoch}));
 assert.deepEqual(await call('claims'),await repo.readWalletClaims({principal,nowMs}));
 assert.deepEqual(await call('submissions'),await repo.readWalletSubmissions({principal,nowMs}));
 assert.deepEqual(await call('capacity'),await repo.readCapacity({nowMs}));assert.deepEqual(await call('actions'),await repo.readActions({nowMs}));
 assert.deepEqual((await call('claims',{wallet:'unrelated'})).items,[]);assert.deepEqual((await call('submissions',{wallet:'unrelated'})).items,[]);
 assert.equal((await call('claims',{race:true})).reason,'revision_conflict');
 await db.prepare('DELETE FROM earn_workload_policies').run();assert.equal((await call('capacity')).reason,'staffing-required');
 assert.equal((await call('submissions')).memberStatus.admission.reason,'staffing-required');
});
test('workerd archive projections preserve readonly recovery DTOs and ownership filtering',async t=>{
 const original=openDatabase(),recovery=openDatabase();t.after(()=>{original.close();recovery.close();});
 const s=await buildGoldenScenario(original);importBoard(recovery,s.bundle.manifest,s.bundle.sha256);
 const {mf,db}=await localRuntime(t,new URL('./fixtures/earn-reads-worker.ts',import.meta.url));
 await copy(recovery,db,['earn_recovered_boards','earn_recovered_allocations','earn_recovered_awards']);
 const repo=createEarnReadRepository(createNodeAtomicDriver(recovery)),nowMs=s.start+2*DAY_MS,principal={kind:'wallet',wallet:'w1'};
 const call=async method=>(await mf.dispatchFetch('http://localhost/reads',{method:'POST',body:JSON.stringify({method,epoch:s.epoch,nowMs,wallet:'w1'})})).json();
 assert.deepEqual(await call('leaderboard'),await repo.readLeaderboard({epoch:s.epoch}));
 assert.deepEqual(await call('claims'),await repo.readWalletClaims({principal,nowMs}));
});
