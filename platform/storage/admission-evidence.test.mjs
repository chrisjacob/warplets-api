import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from './database.mjs';
import {createNodeAtomicDriver} from './node/atomic-driver.mjs';
import {createAtomicEarnRepository} from './atomic-earn.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {start,command,seed} from './fixtures/atomic-earn.mjs';
const crypto=createNodeCrypto(),valid={status:'verified',expiresMs:start+1000,microUsd:'10000000'};
async function fixture(t){
 const db=openDatabase();t.after(()=>db.close());const driver=createNodeAtomicDriver(db);await seed(driver);
 db.prepare('INSERT INTO earn_fixture_campaigns VALUES(?,?,?)').run('B',start,'1000000');
 return {db,repository:createAtomicEarnRepository(driver,{crypto,ids:{next:randomUUID}})};
}
const invalid=[
 ['other-wallet read',db=>db.prepare("UPDATE price_observations SET read_id='read-w2' WHERE wallet='w1'").run()],
 ['other-token read',db=>db.prepare("UPDATE earn_stake_reads SET token_id='B' WHERE id='read-w1'").run()],
 ['read value disagrees with decision',db=>db.prepare("UPDATE earn_stake_reads SET micro_usd='20000000' WHERE id='read-w1'").run()],
 ['read timestamp disagrees with assembled point',db=>db.prepare("UPDATE earn_stake_reads SET observed_ms=? WHERE id='read-w1'").run(start-1)],
 ['read expiry disagrees with decision',db=>db.prepare("UPDATE earn_stake_reads SET expires_ms=? WHERE id='read-w1'").run(start+999)],
 ['read already expired',db=>db.prepare("UPDATE earn_stake_reads SET expires_ms=? WHERE id='read-w1'").run(start-1)],
 ['decision already expired',db=>db.prepare("UPDATE price_observations SET decision=? WHERE wallet='w1'").run(JSON.stringify({...valid,expiresMs:start-1}))],
 ['different market policy hash',db=>db.prepare("UPDATE price_observations SET policy_hash='different-policy' WHERE wallet='w1'").run()],
 ['missing read reference',db=>db.prepare("UPDATE price_observations SET read_id=NULL WHERE wallet='w1'").run()],
 ['future observation',db=>db.prepare("UPDATE price_observations SET as_of_ms=? WHERE wallet='w1'").run(start+1)],
 ...['{broken','null','[]','{}',JSON.stringify({...valid,microUsd:'1e7'}),JSON.stringify({status:'verified',microUsd:'10000000'}),JSON.stringify({...valid,expiresMs:String(start+1000)})].map(value=>[
  'invalid decision '+value,db=>db.prepare("UPDATE price_observations SET decision=? WHERE wallet='w1'").run(value)]),
];
test('admission holds mismatched or malformed pricing references without creating any accepted effect',async t=>{
 for(const [label,mutate] of invalid){
  const {db,repository}=await fixture(t);mutate(db);
  const result=await repository.admitSubmission(await command());assert.equal(result.kind,'pending',label+' '+JSON.stringify(result));assert.equal(result.reason,'stake-evidence',label);
  for(const table of ['app_command_receipts','earn_submissions','earn_admission_counts'])assert.equal(db.prepare('SELECT COUNT(*) n FROM '+table).get().n,0,label+' '+table);
 }
});
test('valid observation and read identity permits fresh reuse, inclusive expiry and distinct receipt/read IDs',async t=>{
 const {db,repository}=await fixture(t),c=await command();c.nowMs=start+1000;
 const result=await repository.admitSubmission(c);assert.equal(result.kind,'committed');
 const row=db.prepare('SELECT * FROM earn_submissions').get();assert.equal(row.entry_read_id,'read-w1');assert.equal(row.submitted_ms,start+1000);
 assert.notEqual(row.entry_read_id,db.prepare("SELECT receipt FROM price_observations WHERE wallet='w1'").get().receipt);
});
test('valid consistent stake below threshold stays ineligible rather than accepted or unavailable',async t=>{
 const {db,repository}=await fixture(t);
 db.prepare("UPDATE earn_stake_reads SET micro_usd='9999999' WHERE id='read-w1'").run();
 db.prepare("UPDATE price_observations SET decision=? WHERE wallet='w1'").run(JSON.stringify({...valid,microUsd:'9999999'}));
 assert.equal((await repository.admitSubmission(await command())).code,'stake_ineligible');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM earn_submissions').get().n,0);
});
