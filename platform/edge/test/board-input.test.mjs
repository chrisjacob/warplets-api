import test from 'node:test';
import assert from 'node:assert/strict';
import { localRuntime } from './local-runtime.mjs';
import { openDatabase } from '../../storage/database.mjs';
import { createNodeEarnRepository } from '../../storage/node/earn-repository.mjs';
import { buildGoldenScenario } from '../../application/fixtures/earn-scenario.mjs';
import { computeBoard } from '../../earn/settlement.mjs';
for(const lateCount of [0,101])test('workerd board snapshot matches reference with '+lateCount+' late approvals',async t=>{
  const {mf,db}=await localRuntime(t,new URL('./fixtures/board-input-worker.ts',import.meta.url));
  const reference=openDatabase();t.after(()=>reference.close());
  await buildGoldenScenario(reference,{...(lateCount?{wallets:Array.from({length:100},(_,i)=>'w'+(i+1))}:{}),async beforeFinalize(query){
    if(lateCount){
      const start=query.epoch*86400000,entry=reference.prepare('SELECT id FROM earn_stake_reads LIMIT 1').get().id;
      for(const epoch of [query.epoch-2,query.epoch-1])reference.prepare('INSERT INTO earn_boards VALUES(?,?,?,?,?)').run(epoch,'[]',start-1,'synthetic-prior-'+epoch,'synthetic-history');
      for(let i=0;i<lateCount;i++){
        const wallet='late-'+i,id='late-post-'+i,epoch=query.epoch-(i<100?1:2);
        reference.prepare('INSERT INTO earn_submissions VALUES(?,?,?,?,?,?,?,?)').run(id,wallet,'A',epoch,'https://example.test/late/'+i,start-86400000,entry,id);
        reference.prepare('INSERT INTO earn_reviews VALUES(?,?,?,?,?,?)').run(id,7,'synthetic-reviewer','delayed',start,'synthetic-late');
        reference.prepare('INSERT INTO earn_decisions VALUES(?,?,?,?)').run(id,epoch,1,entry);
      }
    }
    // Copy the sanitized scenario, not a parallel or simplified test schema.
    for(const table of ['earn_fixture_campaigns','price_sources','earn_stake_reads','price_observations','earn_submissions','earn_reviews','earn_boards','earn_decisions','earn_streaks','earn_owner_snapshots','ops_config_audit']) {
      const rows=reference.prepare('SELECT * FROM '+table).all();
      if(rows.length)await db.batch(rows.map(row=>db.prepare('INSERT INTO '+table+' VALUES('+Object.keys(row).map(()=>'?').join(',')+')').bind(...Object.values(row))));
    }
    const get=async value=>(await (await mf.dispatchFetch('http://localhost/fixture',{method:'POST',body:JSON.stringify(value)})).json());
    const loaded=await get(query),expected=await createNodeEarnRepository(reference).loadBoardInput(query);
    assert.equal(loaded.kind,'loaded');assert.deepEqual(loaded.input,JSON.parse(JSON.stringify(expected.input)));
    assert.deepEqual(loaded.plan,JSON.parse(JSON.stringify(computeBoard(expected.input))));
    assert.ok(loaded.measurements.inputBytes<=256*1024);
    if(lateCount){assert.equal(loaded.measurements.participants,201);assert.equal(loaded.measurements.readBatches,14);assert.deepEqual(await get({...query,race:true,raceStage:'late-page'}),{kind:'conflict',code:'revision_conflict'});}
    assert.deepEqual(await get({...query,race:true}),{kind:'conflict',code:'revision_conflict'});
    console.log('D1 board input measured',JSON.stringify(loaded.measurements));
  }});
});
