import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { openDatabase } from './database.mjs';
import { createNodeAtomicDriver } from './node/atomic-driver.mjs';
import { createAtomicSettlementRepository,createSettlementCommand,SEAL_INPUT,COMMIT_BOARD,COMMIT_ALLOCATION,settlementFenceKey } from './atomic-settlement.mjs';
import { createPrivateReferenceService } from '../artifacts/reference-service.mjs';
import { createArtifactReferenceRepository } from './atomic-artifacts.mjs';
import { createNodeCrypto } from '../security/node-crypto.mjs';
import { canonicalJson,utf8 } from '../security/canonical.mjs';
import { computeBoard,computeAllocation } from '../earn/settlement.mjs';
import { buildGoldenScenario } from '../application/fixtures/earn-scenario.mjs';
const crypto=createNodeCrypto(),principal={kind:'operator',id:'synthetic'};
const hash=value=>crypto.sha256(utf8(canonicalJson(value)));
const fixture=JSON.parse(readFileSync(new URL('../application/fixtures/earn-golden.json',import.meta.url),'utf8'));
for(const count of [3,100])test('guarded sealed-input board and allocation preserve reference commitments for '+count+' wallets',async t=>{
  const db=openDatabase();t.after(()=>db.close());let nowMs=0,delayCommit=false;
  db.function('fixture_now_ms',()=>nowMs);const baseDriver=createNodeAtomicDriver(db),driver={...baseDriver,leaseNowSql:'fixture_now_ms()',async batch(statements){
    if(delayCommit&&statements.some(s=>s.sql.startsWith('INSERT INTO earn_boards'))){nowMs+=20000;delayCommit=false;}
    return baseDriver.batch(statements);
  }},ports={crypto,ids:{next:randomUUID}};
  for(const scope of ['evidence-ingest','earn-snapshot','earn-settlement'])db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,scope);
  const repository=createAtomicSettlementRepository(driver,{...ports,clock:{nowMs:()=>nowMs}});
  const wallets=['w3','w1','w2',...Array.from({length:count-3},(_,i)=>'w'+(i+4))];
  const actual=await buildGoldenScenario(db,{wallets,async beforeFinalize(query){
    nowMs=query.nowMs;
    const loaded=await repository.loadBoardInput(query);assert.ok(loaded.measurements.readBatches<=12);
    const plan=computeBoard(loaded.input),manifest={mode:'synthetic-fixture',epoch:query.epoch,inputDigest:loaded.inputDigest,coverage:'synthetic-test-only'};
    const bytes=utf8(canonicalJson(manifest)),byteDigest=await crypto.sha256(bytes),manifestDigest=await hash(['10x-cutoff-fixture-v1',manifest]);
    const identity={key:'private/'+byteDigest+'.json',byteDigest,size:bytes.length,semanticDigest:manifestDigest,visibility:'private',contentType:'application/json'};
    const store={async putIfAbsent(){return {status:'created'};},async getVerified(){return {status:'verified',bytes,identity};}};
    const artifacts=createPrivateReferenceService({store,repository:createArtifactReferenceRepository(driver,ports),crypto,clock:{nowMs:()=>nowMs}});
    assert.equal((await artifacts.persist(principal,{identity,bytes,requestKey:'input-object'})).kind,'committed');
    const seal=await createSettlementCommand(SEAL_INPUT,{principal,requestKey:'seal',nowMs,input:{epoch:query.epoch,asOfMs:query.nowMs,sourceRef:query.sourceRef,
      objectKey:identity.key,byteDigest,manifestDigest,inputDigest:loaded.inputDigest,previousManifestDigest:null}},crypto);
    assert.equal((await repository.sealBoardInput(seal)).kind,'committed');
    const board=await createSettlementCommand(COMMIT_BOARD,{principal,requestKey:'board',nowMs,input:{epoch:query.epoch,manifestDigest,planDigest:await hash(plan)}},crypto);
    const lease={businessKey:settlementFenceKey(COMMIT_BOARD,board.input),token:'lease',payloadDigest:'0'.repeat(64),revision:'1'};
    db.prepare('INSERT INTO app_execution_fences VALUES(?,?,?,?,?)').run(lease.businessKey,lease.token,nowMs,1,lease.payloadDigest);
    assert.equal((await repository.commitBoard(board,lease)).kind,'conflict');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM earn_boards').get().n,0);
    db.prepare('UPDATE app_execution_fences SET expires_ms=?').run(nowMs+10000);
    db.exec("CREATE TEMP TRIGGER fail_board_child BEFORE INSERT ON earn_streaks BEGIN SELECT RAISE(ABORT,'streak interrupted'); END");
    await assert.rejects(repository.commitBoard(board,lease),/streak interrupted/);
    for(const table of ['earn_boards','earn_decisions','earn_member_facts','earn_streaks'])assert.equal(db.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);
    db.exec('DROP TRIGGER fail_board_child');
    delayCommit=true;assert.equal((await repository.commitBoard(board,lease)).kind,'conflict');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM earn_boards').get().n,0);nowMs=query.nowMs;
    const accepted=await repository.commitBoard(board,lease);assert.equal(accepted.kind,'committed');
    assert.equal((await repository.commitBoard({...board,nowMs:nowMs+20000},lease)).kind,'replayed');
    const allocationPlan=computeAllocation({tokenId:'A',day:2,activationMs:fixture.start,originalSupplyUnits:'1000000',nowMs,
      board:{epoch:query.epoch,status:'final',winners:plan.winners}});
    const allocation=await createSettlementCommand(COMMIT_ALLOCATION,{principal,requestKey:'allocation',nowMs,input:{tokenId:'A',day:2,boardDigest:accepted.value.snapshotId,planDigest:await hash(allocationPlan)}},crypto);
    const allocationLease={...lease,businessKey:settlementFenceKey(COMMIT_ALLOCATION,allocation.input),token:'allocation-lease'};
    db.prepare('INSERT INTO app_execution_fences VALUES(?,?,?,?,?)').run(allocationLease.businessKey,allocationLease.token,nowMs+10000,1,allocationLease.payloadDigest);
    db.exec("CREATE TEMP TRIGGER fail_award_child BEFORE INSERT ON earn_awards BEGIN SELECT RAISE(ABORT,'award interrupted'); END");
    await assert.rejects(repository.commitAllocation(allocation,allocationLease),/award interrupted/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM earn_allocations').get().n,0);
    db.exec('DROP TRIGGER fail_award_child');
    assert.equal((await repository.commitAllocation(allocation,allocationLease)).kind,'committed');
    assert.equal((await repository.commitAllocation(allocation,allocationLease)).kind,'replayed');
  }});
  if(count===3){const {source,nonDeterministicCapture,...expected}=fixture;assert.deepEqual(actual,expected);}
  else {const other=openDatabase();try{assert.deepEqual(actual,await buildGoldenScenario(other,{wallets}));}finally{other.close();}}
});
