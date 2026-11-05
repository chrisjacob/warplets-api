import test from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from './local-runtime.mjs';
import {start,command,seed} from '../../storage/fixtures/atomic-earn.mjs';
const valid=JSON.stringify({status:'verified',expiresMs:start+1000,microUsd:'10000000'});
test('workerd D1 refuses mismatched or malformed stake references and accepts exact fresh reuse',async t=>{
 const {mf,db}=await localRuntime(t,new URL('./fixtures/atomic-earn-worker.ts',import.meta.url));
 await seed({batch:statements=>db.batch(statements.map(s=>db.prepare(s.sql).bind(...s.values)))});
 await db.prepare('INSERT INTO earn_fixture_campaigns VALUES(?,?,?)').bind('B',start,'1000000').run();
 const c=await command(),call=async command=>{const response=await mf.dispatchFetch('http://localhost/command',{method:'POST',body:JSON.stringify({method:'admitSubmission',command})});return {status:response.status,...await response.json()};};
 const cases=[
  ["UPDATE price_observations SET read_id='read-w2' WHERE wallet='w1'",[]],
  ["UPDATE earn_stake_reads SET token_id='B' WHERE id='read-w1'",[]],
  ["UPDATE earn_stake_reads SET micro_usd='20000000' WHERE id='read-w1'",[]],
  ["UPDATE earn_stake_reads SET observed_ms=? WHERE id='read-w1'",[start-1]],
  ["UPDATE earn_stake_reads SET expires_ms=? WHERE id='read-w1'",[start+999]],
  ["UPDATE earn_stake_reads SET expires_ms=? WHERE id='read-w1'",[start-1]],
  ["UPDATE price_observations SET policy_hash='different-policy' WHERE wallet='w1'",[]],
  ["UPDATE price_observations SET read_id=NULL WHERE wallet='w1'",[]],
  ...['{broken','null','[]','{}',JSON.stringify({status:'verified',expiresMs:start+1000,microUsd:'1e7'})].map(decision=>["UPDATE price_observations SET decision=? WHERE wallet='w1'",[decision]]),
 ];
 async function reset(){
  await db.batch([
   db.prepare("UPDATE earn_stake_reads SET token_id='A',micro_usd='10000000',observed_ms=?,expires_ms=? WHERE id='read-w1'").bind(start,start+1000),
   db.prepare("UPDATE price_observations SET read_id='read-w1',decision=?,policy_hash='synthetic-policy' WHERE wallet='w1'").bind(valid),
  ]);
 }
 for(const [sql,values] of cases){
  await reset();await db.prepare(sql).bind(...values).run();
  const result=await call(c);assert.equal(result.status,200,sql+' '+JSON.stringify(result));assert.equal(result.result.kind,'pending',sql);assert.equal(result.result.reason,'stake-evidence');
  for(const table of ['app_command_receipts','earn_submissions','earn_admission_counts'])assert.equal(await db.prepare('SELECT COUNT(*) n FROM '+table).first('n'),0);
 }
 await reset();const accepted=await call({...c,nowMs:start+1000});assert.equal(accepted.result.kind,'committed');
 assert.equal(await db.prepare('SELECT entry_read_id FROM earn_submissions').first('entry_read_id'),'read-w1');
});
