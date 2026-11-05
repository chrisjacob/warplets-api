import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './database.mjs';
import { createNodeAtomicDriver } from './node/atomic-driver.mjs';
import { loadAtomicBoardInput } from './atomic-board-input.mjs';
import { createNodeEarnRepository } from './node/earn-repository.mjs';
import { buildGoldenScenario } from '../application/fixtures/earn-scenario.mjs';
import { computeBoard } from '../earn/settlement.mjs';
import { createNodeCrypto } from '../security/node-crypto.mjs';
const crypto=createNodeCrypto();
test('bounded asynchronous board input reproduces every reference component and commitment input',async t=>{
  const db=openDatabase();t.after(()=>db.close());const driver=createNodeAtomicDriver(db);
  await buildGoldenScenario(db,{async beforeFinalize(query){
    const loaded=await loadAtomicBoardInput(driver,crypto,query);
    assert.equal(loaded.kind,'loaded');
    const reference=await createNodeEarnRepository(db).loadBoardInput(query);
    assert.deepEqual(JSON.parse(JSON.stringify(loaded.input)),JSON.parse(JSON.stringify(reference.input)));
    assert.deepEqual(computeBoard(loaded.input),computeBoard(reference.input));
    assert.ok(loaded.measurements.inputBytes<256*1024);
    let changed=false;
    const racing={...driver,async batch(statements){
      const result=await driver.batch(statements);
      if(!changed&&statements[0].sql.includes('CASE WHEN length(assets)')){changed=true;db.exec("UPDATE app_revisions SET revision=revision+1 WHERE name='source'");}
      return result;
    }};
    assert.deepEqual(await loadAtomicBoardInput(racing,crypto,query),{kind:'conflict',code:'revision_conflict'});
  }});
});
test('100 current wallets and paged late approvals load only required historical streaks',async t=>{
 const db=openDatabase();t.after(()=>db.close());const driver=createNodeAtomicDriver(db);
 await buildGoldenScenario(db,{wallets:Array.from({length:100},(_,i)=>'w'+(i+1)),async beforeFinalize(query){
  const start=query.epoch*86400000,entry=db.prepare('SELECT id FROM earn_stake_reads LIMIT 1').get().id;
  for(const oldEpoch of [query.epoch-2,query.epoch-1])db.prepare('INSERT INTO earn_boards VALUES(?,?,?,?,?)').run(oldEpoch,'[]',start-1,'synthetic-previous-'+oldEpoch,'synthetic-history');
  for(let i=0;i<101;i++){
   const wallet='late-'+i,post='late-post-'+i,epoch=query.epoch-(i<100?1:2);
   db.prepare('INSERT INTO earn_submissions VALUES(?,?,?,?,?,?,?,?)').run(post,wallet,'A',epoch,'https://example.test/late/'+i,start-86400000,entry,post);
   db.prepare('INSERT INTO earn_reviews VALUES(?,?,?,?,?,?)').run(post,7,'synthetic-reviewer','delayed',start,'synthetic-late');
   db.prepare('INSERT INTO earn_decisions VALUES(?,?,?,?)').run(post,epoch,1,entry);
  }
  const loaded=await loadAtomicBoardInput(driver,crypto,query),reference=await createNodeEarnRepository(db).loadBoardInput(query);
  assert.equal(loaded.kind,'loaded');assert.equal(loaded.input.late.length,101);assert.equal(loaded.measurements.participants,201);
  assert.equal(loaded.measurements.readBatches,14);assert.deepEqual(computeBoard(loaded.input),computeBoard(reference.input));
  assert.equal(Object.keys(loaded.input.facts).length,100);assert.equal(computeBoard(loaded.input).streaks.length,201);
 }});
});
