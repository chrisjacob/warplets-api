import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localRuntime } from './local-runtime.mjs';
import { openDatabase } from '../../storage/database.mjs';
import { createNodeEarnRepository } from '../../storage/node/earn-repository.mjs';
import { buildGoldenScenario } from '../../application/fixtures/earn-scenario.mjs';
import { createNodeCrypto } from '../../security/node-crypto.mjs';
import { canonicalJson,utf8 } from '../../security/canonical.mjs';
import { computeBoard,computeAllocation } from '../../earn/settlement.mjs';
import { createSettlementCommand,SEAL_INPUT,COMMIT_BOARD,COMMIT_ALLOCATION,settlementFenceKey } from '../../storage/atomic-settlement.mjs';
const crypto=createNodeCrypto(),hash=value=>crypto.sha256(utf8(canonicalJson(value))),principal={kind:'operator',id:'synthetic'};
const fixture=JSON.parse(readFileSync(new URL('../../application/fixtures/earn-golden.json',import.meta.url),'utf8'));
for(const count of [3,100])test('workerd fenced board/allocation preserve reference commitments for '+count+' wallets',async t=>{
 const {mf,db}=await localRuntime(t,new URL('./fixtures/settlement-worker.ts',import.meta.url)),reference=openDatabase();t.after(()=>reference.close());
 for(const scope of ['evidence-ingest','earn-snapshot','earn-settlement'])await db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').bind(principal.id,scope).run();
 const call=async body=>{const response=await mf.dispatchFetch('http://localhost/fixture',{method:'POST',body:JSON.stringify(body)});return {status:response.status,...await response.json()};};
 const wallets=['w3','w1','w2',...Array.from({length:count-3},(_,i)=>'w'+(i+4))];
 await buildGoldenScenario(reference,{wallets,async beforeFinalize(query){
  const nowMs=query.nowMs;
  for(const table of ['earn_fixture_campaigns','price_sources','earn_stake_reads','price_observations','earn_submissions','earn_reviews','earn_owner_snapshots','ops_config_audit']){
   const rows=reference.prepare('SELECT * FROM '+table).all();
   if(rows.length)await db.batch(rows.map(row=>db.prepare('INSERT INTO '+table+' VALUES('+Object.keys(row).map(()=>'?').join(',')+')').bind(...Object.values(row))));
  }
  const loaded=await createNodeEarnRepository(reference).loadBoardInput(query),plan=computeBoard(loaded.input),inputDigest=await hash(loaded.input);
  const manifest={mode:'synthetic-fixture',epoch:query.epoch,inputDigest,coverage:'synthetic-test-only'},bytes=utf8(canonicalJson(manifest)),byteDigest=await crypto.sha256(bytes),manifestDigest=await hash(['10x-cutoff-fixture-v1',manifest]);
  const identity={key:'private/'+byteDigest+'.json',byteDigest,size:bytes.length,semanticDigest:manifestDigest,visibility:'private',contentType:'application/json'};
  assert.equal((await call({method:'store',identity,bytes:[...bytes],nowMs})).kind,'committed');
  const seal=await createSettlementCommand(SEAL_INPUT,{principal,requestKey:'seal',nowMs,input:{epoch:query.epoch,asOfMs:nowMs,sourceRef:query.sourceRef,objectKey:identity.key,byteDigest,manifestDigest,inputDigest,previousManifestDigest:null}},crypto);
  assert.equal((await call({method:'sealBoardInput',command:seal,nowMs})).result.kind,'committed');
  const board=await createSettlementCommand(COMMIT_BOARD,{principal,requestKey:'board',nowMs,input:{epoch:query.epoch,manifestDigest,planDigest:await hash(plan)}},crypto);
  const lease={businessKey:settlementFenceKey(COMMIT_BOARD,board.input),token:'lease',payloadDigest:'0'.repeat(64),revision:'1'};
  await db.prepare('INSERT INTO app_execution_fences VALUES(?,?,?,?,?)').bind(lease.businessKey,lease.token,nowMs,1,lease.payloadDigest).run();
  assert.equal((await call({method:'commitBoard',command:board,lease,nowMs})).result.kind,'conflict');
  await db.prepare('UPDATE app_execution_fences SET expires_ms=?').bind(nowMs+10000).run();
  const expired=await call({method:'commitBoard',command:board,lease,nowMs,fault:'expire-during-hash'});assert.equal(expired.result.kind,'conflict');
  assert.equal((await call({method:'commitBoard',command:board,lease,nowMs,fault:'expire-during-transport'})).result.kind,'conflict');
  // Real SQL clock also rejects an old fixture-era lease despite caller time.
  assert.equal((await call({method:'commitBoard',command:board,lease,nowMs,useDatabaseClock:true})).result.kind,'conflict');
  const omitted=await call({method:'commitBoard',command:board,lease,nowMs,fault:'omit-last-child'});assert.equal(omitted.status,500);assert.match(omitted.error,/Incomplete board streaks/);
  for(const table of ['earn_boards','earn_decisions','earn_member_facts','earn_streaks'])assert.equal(await db.prepare('SELECT COUNT(*) n FROM '+table).first('n'),0);
  await db.prepare('UPDATE app_execution_fences SET expires_ms=? WHERE business_key=?').bind(Date.now()+60000,lease.businessKey).run();
  const accepted=await call({method:'commitBoard',command:board,lease,nowMs,useDatabaseClock:true});assert.equal(accepted.result.kind,'committed');
  assert.equal(accepted.result.value.snapshotId,count===3?fixture.bundle.manifest.board.snapshotId:await crypto.sha256(utf8(JSON.stringify(plan.commitmentInput))));
  assert.equal((await call({method:'commitBoard',command:board,lease:{...lease,token:'replaced'},nowMs})).result.kind,'replayed');
  const allocationPlan=computeAllocation({tokenId:'A',day:2,activationMs:fixture.start,originalSupplyUnits:'1000000',nowMs,board:{epoch:query.epoch,status:'final',winners:plan.winners}});
  const allocation=await createSettlementCommand(COMMIT_ALLOCATION,{principal,requestKey:'allocation',nowMs,input:{tokenId:'A',day:2,boardDigest:accepted.result.value.snapshotId,planDigest:await hash(allocationPlan)}},crypto);
  const allocationLease={...lease,businessKey:settlementFenceKey(COMMIT_ALLOCATION,allocation.input),token:'allocation'};
  await db.prepare('INSERT INTO app_execution_fences VALUES(?,?,?,?,?)').bind(allocationLease.businessKey,allocationLease.token,nowMs+10000,1,allocationLease.payloadDigest).run();
  const failed=await call({method:'commitAllocation',command:allocation,lease:allocationLease,nowMs,fault:'omit-last-child'});assert.equal(failed.status,500);assert.match(failed.error,/Missing allocation or awards/);
  assert.equal(await db.prepare('SELECT COUNT(*) n FROM earn_allocations').first('n'),0);
  const allocated=await call({method:'commitAllocation',command:allocation,lease:allocationLease,nowMs});assert.equal(allocated.result.kind,'committed');
  const awards=await db.prepare('SELECT wallet,amount FROM earn_awards ORDER BY wallet').all();assert.deepEqual(awards.results,[...wallets].sort().map(wallet=>({wallet,amount:count===3?'1000':'100'})));
  assert.equal(await db.prepare('SELECT burn FROM earn_allocations').first('burn'),count===3?'7000':'0');
  console.log('D1 board commit measured',JSON.stringify(accepted.measurements[0]));
 }});
});
