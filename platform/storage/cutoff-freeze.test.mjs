import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from './database.mjs';
import {createNodeAtomicDriver} from './node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {createFreezeCommand,createCutoffFreezeRepository} from './cutoff-freeze.mjs';
import {DAY_MS} from '../domain/earn/index.mjs';
import {buildGoldenScenario} from '../application/fixtures/earn-scenario.mjs';
const crypto=createNodeCrypto(),principal={kind:'operator',id:'cutoff-fixture'};
test('closed admission inventory freezes atomically, rejects later mutation and replays after revocation',async t=>{
 const db=openDatabase();t.after(()=>db.close());db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'earn-snapshot');
 const driver=createNodeAtomicDriver(db),ports={crypto,ids:{next:randomUUID}},repo=createCutoffFreezeRepository(driver,ports);
 await buildGoldenScenario(db,{async beforeFinalize(query){
  const command=await createFreezeCommand({principal,epoch:query.epoch,nowMs:query.nowMs},crypto);
  const omitted={...driver,async batch(statements){return driver.batch(statements.filter(s=>!s.sql.startsWith('INSERT INTO app_epoch_freezes')));}};
  await assert.rejects(createCutoffFreezeRepository(omitted,ports).freezeEpoch(command),/Missing epoch admission freeze/);
  assert.equal(await repo.readFreeze(query.epoch),null);
  let revoked=false;const racingCrypto={...crypto,async sha256(bytes){
   if(!revoked&&new TextDecoder().decode(bytes).includes('entryReadId')){revoked=true;db.prepare('UPDATE app_operator_scopes SET enabled=0,revision=revision+1 WHERE operator=?').run(principal.id);}
   return crypto.sha256(bytes);
  }};
  assert.equal((await createCutoffFreezeRepository(driver,{...ports,crypto:racingCrypto}).freezeEpoch(command)).kind,'conflict');
  assert.equal(await repo.readFreeze(query.epoch),null);db.prepare('UPDATE app_operator_scopes SET enabled=1,revision=revision+1 WHERE operator=?').run(principal.id);

  const results=await Promise.all([repo.freezeEpoch(command),repo.freezeEpoch(command)]);
  assert.deepEqual(results.map(x=>x.kind).sort(),['committed','replayed']);
  const frozen=await repo.readFreeze(query.epoch);assert.equal(frozen.admission_count,3);assert.equal(JSON.parse(frozen.inventory_json).length,3);
  assert.throws(()=>db.prepare('UPDATE earn_submissions SET url=? WHERE epoch=?').run('https://example.test/changed',query.epoch),/Frozen admissions/);
  const original=db.prepare('SELECT * FROM earn_submissions LIMIT 1').get();
  assert.throws(()=>db.prepare('INSERT INTO earn_submissions VALUES(?,?,?,?,?,?,?,?)').run('late-new',original.wallet,original.token_id,query.epoch,original.url,original.submitted_ms,original.entry_read_id,'new-key'),/Epoch admission/);
  db.prepare("UPDATE app_operator_scopes SET enabled=0,revision=revision+1 WHERE operator=?").run(principal.id);
  assert.equal((await repo.freezeEpoch({...command,nowMs:query.nowMs+DAY_MS})).kind,'replayed');
 }});
});
test('freeze holds at midnight until close and bounds100 long-URL admissions through row digests',async t=>{
 const db=openDatabase();t.after(()=>db.close());let now=DAY_MS;db.function('fixture_cutoff_clock',()=>now);
 db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'earn-snapshot');
 const measurements=[],repo=createCutoffFreezeRepository({...createNodeAtomicDriver(db),leaseNowSql:'fixture_cutoff_clock()'},
  {crypto,ids:{next:randomUUID},telemetry:{record:(_event,m)=>measurements.push(m)}});
 assert.equal((await repo.freezeEpoch(await createFreezeCommand({principal,epoch:1,nowMs:now},crypto))).reason,'board-open');
 db.prepare('INSERT INTO earn_fixture_campaigns VALUES(?,?,?)').run('A',0,'10000');
 const url='https://example.test/'+ 'a'.repeat(2027);
 for(let n=0;n<100;n++){
  db.prepare('INSERT INTO earn_stake_reads VALUES(?,?,?,?,?,?,?)').run('r'+n,'w'+n,'A',1,DAY_MS,'10000000','synthetic');
  db.prepare('INSERT INTO earn_submissions VALUES(?,?,?,?,?,?,?,?)').run('s'+n,'w'+n,'A',0,url,1,'r'+n,'key'+n);
 }
 const result=await repo.freezeEpoch(await createFreezeCommand({principal,epoch:0,nowMs:now},crypto));assert.equal(result.kind,'committed');
 assert.ok(measurements[0].batchBytes<20000);assert.equal(result.value.admissionCount,100);
 console.log('100 long-URL freeze batch',JSON.stringify(measurements[0]));
});
