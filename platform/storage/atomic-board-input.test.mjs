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
