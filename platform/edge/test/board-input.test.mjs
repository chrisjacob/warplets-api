import test from 'node:test';
import assert from 'node:assert/strict';
import { localRuntime } from './local-runtime.mjs';
import { openDatabase } from '../../storage/database.mjs';
import { createNodeEarnRepository } from '../../storage/node/earn-repository.mjs';
import { buildGoldenScenario } from '../../application/fixtures/earn-scenario.mjs';
import { computeBoard } from '../../earn/settlement.mjs';
test('workerd asynchronous board snapshot and portable component plan match reference golden inputs',async t=>{
  const {mf,db}=await localRuntime(t,new URL('./fixtures/board-input-worker.ts',import.meta.url));
  const reference=openDatabase();t.after(()=>reference.close());
  await buildGoldenScenario(reference,{async beforeFinalize(query){
    // Copy the sanitized scenario, not a parallel or simplified test schema.
    for(const table of ['earn_fixture_campaigns','price_sources','earn_stake_reads','price_observations','earn_submissions','earn_reviews','earn_owner_snapshots','ops_config_audit']) {
      const rows=reference.prepare('SELECT * FROM '+table).all();
      if(rows.length)await db.batch(rows.map(row=>db.prepare('INSERT INTO '+table+' VALUES('+Object.keys(row).map(()=>'?').join(',')+')').bind(...Object.values(row))));
    }
    const get=async value=>(await (await mf.dispatchFetch('http://localhost/fixture',{method:'POST',body:JSON.stringify(value)})).json());
    const loaded=await get(query),expected=await createNodeEarnRepository(reference).loadBoardInput(query);
    assert.equal(loaded.kind,'loaded');assert.deepEqual(loaded.input,JSON.parse(JSON.stringify(expected.input)));
    assert.deepEqual(loaded.plan,JSON.parse(JSON.stringify(computeBoard(expected.input))));
    assert.ok(loaded.measurements.inputBytes<=256*1024);
    assert.deepEqual(await get({...query,race:true}),{kind:'conflict',code:'revision_conflict'});
    console.log('D1 board input measured',JSON.stringify(loaded.measurements));
  }});
});
