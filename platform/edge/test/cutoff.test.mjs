import test from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from './local-runtime.mjs';
import {createFreezeCommand} from '../../storage/cutoff-freeze.mjs';
import {createNodeCrypto} from '../../security/node-crypto.mjs';
test('D1 freezes100 long-URL admissions atomically and replays closed receipt after scope removal',async t=>{
 const {mf,db}=await localRuntime(t,new URL('./fixtures/cutoff-worker.ts',import.meta.url)),principal={kind:'operator',id:'synthetic-cutoff'},crypto=createNodeCrypto();
 await db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').bind(principal.id,'earn-snapshot').run();
 await db.prepare('INSERT INTO earn_fixture_campaigns VALUES(?,?,?)').bind('A',0,'1000000').run();
 const url='https://example.test/'+'a'.repeat(2027),statements=[];
 for(let i=0;i<100;i++)statements.push(db.prepare('INSERT INTO earn_stake_reads VALUES(?,?,?,?,?,?,?)').bind('r'+i,'w'+i,'A',1,86400000,'10000000','synthetic'),
  db.prepare('INSERT INTO earn_submissions VALUES(?,?,?,?,?,?,?,?)').bind('s'+i,'w'+i,'A',0,url,1,'r'+i,'key'+i));
 await db.batch(statements);
 const command=await createFreezeCommand({principal,epoch:0,nowMs:86400000},crypto);
 const call=async fault=>{const response=await mf.dispatchFetch('http://localhost/fixture',{method:'POST',body:JSON.stringify({command,fault})});return {status:response.status,...await response.json()};};
 const omitted=await call('omit-freeze');assert.equal(omitted.status,500);assert.match(omitted.error,/Missing epoch admission freeze/);
 assert.equal(await db.prepare('SELECT COUNT(*) n FROM app_epoch_freezes').first('n'),0);
 const results=await Promise.all([call('lose-response'),call()]);assert.ok(results.every(r=>['committed','replayed'].includes(r.result.kind)));
 assert.equal(await db.prepare('SELECT COUNT(*) n FROM app_epoch_freezes').first('n'),1);
 assert.equal(await db.prepare('SELECT admission_count FROM app_epoch_freezes').first('admission_count'),100);
 await assert.rejects(db.prepare('UPDATE earn_submissions SET url=? WHERE id=?').bind('https://example.test/changed','s0').run(),/Frozen admissions/);
 await assert.rejects(db.prepare('INSERT INTO earn_submissions SELECT ?,wallet,token_id,epoch,url,submitted_ms,entry_read_id,? FROM earn_submissions WHERE id=?').bind('new','new-key','s0').run(),/Epoch admission/);
 await db.prepare('UPDATE app_operator_scopes SET enabled=0,revision=revision+1 WHERE operator=?').bind(principal.id).run();
 assert.equal((await call()).result.kind,'replayed');
 assert.ok(results[0].measurements[0].batchBytes<20000);console.log('D1 cutoff freeze measured',JSON.stringify(results[0].measurements[0]));
});
