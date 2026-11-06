import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {openDatabase} from '../../storage/database.mjs';
import {createApp} from '../../server/application.mjs';
import {recoveryReadFixture,recoveryReadTables} from '../../transactions/recovery-read.fixtures.mjs';
import {localRuntime} from './local-runtime.mjs';
const origin='http://localhost',states=['validated','awaiting_signature','attempt_expired','submitted','unknown','confirmed','failed','finalized'];
test('production Worker recovery HTTP matches Node across all eight legacy states with live owner session fences',async t=>{
 const runtime=await localRuntime(t,new URL('../src/worker.ts',import.meta.url));
 for(const state of states){const node=openDatabase();try{const f=await recoveryReadFixture(node,{state});
  for(const table of [...recoveryReadTables].reverse())await runtime.db.prepare('DELETE FROM '+table).run();
  for(const table of recoveryReadTables)for(const row of f.dump()[table])await runtime.db.prepare('INSERT INTO '+table+' ('+Object.keys(row).join(',')+') VALUES ('+Object.keys(row).map(()=>'?').join(',')+')').bind(...Object.values(row)).run();
  await runtime.db.prepare('DELETE FROM sessions').run();for(const [i,wallet] of [f.owner,f.other].entries()){const values=[createHash('sha256').update('synthetic-recovery-'+i).digest('hex'),wallet,origin,Date.now()+300000];await runtime.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(...values).run();node.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(...values);}
  const call=(id=f.intent.id,owner=0,method='GET')=>runtime.mf.dispatchFetch(origin+'/api/v1/transactions/'+id,{method,headers:{cookie:'tenx_edge_local_session=synthetic-recovery-'+owner}});
  const before=await runtime.db.prepare('SELECT revision FROM app_recovery_watermark WHERE id=1').first(),response=await call();assert.equal(response.status,200,await response.clone().text());assert.equal(response.headers.get('cache-control'),'no-store');const actual=await response.json(),app=createApp(node,{clock:()=>actual.asOfMs}),expected=await (await app(new Request(origin+'/api/v1/transactions/'+f.intent.id,{headers:{cookie:'tenx_local_session=synthetic-recovery-0'}}))).json();assert.deepEqual(actual,expected);assert.equal(actual.state,state);assert.equal(actual.financialExecution,false);assert.equal(actual.executable,false);assert.equal(actual.provenance,'legacy-recorded-unverified');assert.doesNotMatch(JSON.stringify(actual),/messageBase64|instructions|accounts|simulation_ref|"signature"/);assert.ok(!JSON.stringify(actual).includes(f.signature));assert.deepEqual(await runtime.db.prepare('SELECT revision FROM app_recovery_watermark WHERE id=1').first(),before);
  assert.equal((await call(f.intent.id,1)).status,404);assert.equal((await call(f.intent.id,9)).status,401);assert.equal((await call('missing')).status,404);assert.equal((await call('%20')).status,400);assert.equal((await call(f.intent.id,0,'POST')).status,405);
  if(state==='unknown'){assert.equal(actual.nextLocalTransition,'reconcile-existing-attempt');assert.equal(actual.replacementEligible,false);await runtime.db.prepare("UPDATE tx_attempts SET packet='{}'").run();const bad=await call();assert.equal(bad.status,503);assert.equal((await bad.json()).error.code,'transaction_history_pending');}
  await runtime.db.prepare('DELETE FROM sessions WHERE wallet=?').bind(f.owner).run();assert.equal((await call()).status,401);
 }finally{node.close();}}
 const cap=await (await runtime.mf.dispatchFetch(origin+'/api/v1/capabilities')).json();assert.ok(cap.features.some(f=>f.id==='transaction-receipt-preview'));assert.equal(cap.production.financialExecution,false);
 t.diagnostic(JSON.stringify({states:8,productionWorker:true,NodeParity:true,ownerIsolation:true,revokedSession:true,syntheticRetainedUnsignedData:true,signing:false,broadcast:false}));
});
