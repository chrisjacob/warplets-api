import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {openDatabase} from '../storage/database.mjs';
import {createApp} from '../server/application.mjs';
import {recoveryReadFixture} from './recovery-read.fixtures.mjs';
const states=['validated','awaiting_signature','attempt_expired','submitted','unknown','confirmed','failed','finalized'],origin='http://localhost';
test('actual Node owner-only recovery HTTP preserves eight states and never exposes unsigned packets or recorded signatures',async t=>{
 for(const state of states){const db=openDatabase();try{const f=await recoveryReadFixture(db,{state}),app=createApp(db,{clock:()=>f.now});
  for(const [i,wallet] of [f.owner,f.other].entries())db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(createHash('sha256').update('synthetic-recovery-'+i).digest('hex'),wallet,origin,f.now+60000);
  const call=(id=f.intent.id,{owner=0,method='GET',headers={}}={})=>app(new Request(origin+'/api/v1/transactions/'+id,{method,headers:{cookie:'tenx_local_session=synthetic-recovery-'+owner,...headers}}));
  const before=db.prepare('SELECT total_changes() n').get().n,response=await call();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const v=await response.json();assert.equal(v.state,state);assert.equal(v.attemptId,f.packets.at(-1)?.attemptId??null);assert.equal(v.replacementEligible,state==='attempt_expired');assert.equal(v.financialExecution,false);assert.equal(v.executable,false);assert.equal(v.provenance,'legacy-recorded-unverified');assert.equal(db.prepare('SELECT total_changes() n').get().n,before);assert.doesNotMatch(JSON.stringify(v),/messageBase64|instructions|accounts|simulation_ref|"signature"/);assert.ok(!JSON.stringify(v).includes(f.signature));
  assert.equal((await call(f.intent.id,{owner:1})).status,404);assert.equal((await call(f.intent.id,{owner:9})).status,401);assert.equal((await call('missing')).status,404);assert.equal((await call('%20')).status,400);assert.equal((await call(f.intent.id,{method:'POST'})).status,405);
  if(state==='unknown'){assert.equal(v.nextLocalTransition,'reconcile-existing-attempt');assert.equal(v.requiredObservation,'same-attempt-recorded-outcome');db.prepare("UPDATE tx_attempts SET packet='{}'").run();const bad=await call();assert.equal(bad.status,503);assert.equal(bad.headers.get('cache-control'),'no-store');assert.equal((await bad.json()).error.code,'transaction_history_pending');}
  const capability=await (await app(new Request(origin+'/api/v1/capabilities'))).json();assert.ok(capability.features.some(f=>f.id==='transaction-receipt-preview'));assert.equal(capability.production.financialExecution,false);
 }finally{db.close();}}
 t.diagnostic(JSON.stringify({states:8,actualNodeAPI:true,ownerIsolation:true,noWritesOnReads:true,signing:false,broadcast:false,legacyProvenance:'unverified'}));
});
