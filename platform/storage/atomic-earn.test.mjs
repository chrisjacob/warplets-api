import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from './database.mjs';
import { createNodeAtomicDriver } from './node/atomic-driver.mjs';
import { createAtomicEarnRepository } from './atomic-earn.mjs';
import { createNodeCrypto } from '../security/node-crypto.mjs';
import { admissionRequestBytes,reviewRequestBytes,ADMIT_SUBMISSION,FINAL_REVIEW } from '../application/commands.mjs';
import { sql } from './atomic-driver.mjs';
import { start,command,reviewCommand,seed } from './fixtures/atomic-earn.mjs';
const crypto=createNodeCrypto();
function fixture(t) {
  const db=openDatabase();t.after(()=>db.close());const driver=createNodeAtomicDriver(db);
  return {db,driver,ports:{crypto,ids:{next:randomUUID}}};
}
test('guarded Node final-slot admission, exact replay after pause and final-review authority',async t=>{
  const {db,driver,ports}=fixture(t);await seed(driver);
  const repository=createAtomicEarnRepository(driver,ports),c=await command();
  const outcomes=await Promise.all([repository.admitSubmission(c),repository.admitSubmission(await command('w2'))]);
  assert.equal(outcomes.filter(o=>o.kind==='committed').length,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM earn_submissions').get().n,1);
  const accepted=outcomes[0];assert.equal(accepted.kind,'committed');
  db.exec("INSERT INTO ops_scope_log VALUES('r','earn-admission',1,NULL,0,'synthetic','pause','synthetic','pause')");
  const replay=await repository.admitSubmission({...c,nowMs:start+86400000});
  assert.equal(replay.kind,'replayed');assert.deepEqual(replay.value,accepted.value);assert.deepEqual(replay.receipt,accepted.receipt);
  const changed={...c,input:{...c.input,url:'https://example.test/different'}};
  changed.requestDigest=await crypto.sha256(admissionRequestBytes(changed));
  assert.equal((await repository.admitSubmission(changed)).code,'idempotency_conflict');
  const review=await reviewCommand(accepted.value.submission.id);
  assert.equal((await repository.recordFinalReview(review)).kind,'committed');
  db.exec("UPDATE app_operator_scopes SET enabled=0,revision=1");
  assert.equal((await repository.recordFinalReview({...review,nowMs:start+100})).kind,'replayed');
});
test('missing staffing holds; revision race and missing mandatory child cannot commit partial receipt',async t=>{
  const {db,driver,ports}=fixture(t);await seed(driver,{staffed:false});
  assert.equal((await createAtomicEarnRepository(driver,ports).admitSubmission(await command())).reason,'staffing-required');
  db.prepare("INSERT INTO earn_workload_policies VALUES('p',?,?,60,60,1,'synthetic','synthetic')").run(20001,start);
  const broken={...driver,async batch(statements){return driver.batch(statements[0].sql.startsWith('INSERT INTO app_command_receipts')?[statements[0],...statements.slice(2)]:statements);}};
  await assert.rejects(createAtomicEarnRepository(broken,ports).admitSubmission(await command()),/Missing mandatory submission/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM earn_submissions').get().n,0);
  const race={...driver,async batch(statements){
    if(statements[0].sql.startsWith('INSERT INTO app_command_receipts'))db.exec("INSERT INTO ops_scope_log VALUES('r','earn-admission',1,NULL,0,'synthetic','race','synthetic','race')");
    return driver.batch(statements);
  }};
  assert.equal((await createAtomicEarnRepository(race,ports).admitSubmission(await command())).code,'revision_conflict');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n,0);
});
test('lost response reconciles the committed durable receipt without a second write',async t=>{
  const {db,driver,ports}=fixture(t);await seed(driver);
  const lost={...driver,async batch(statements){
    const result=await driver.batch(statements);
    if(statements[0].sql.startsWith('INSERT INTO app_command_receipts'))throw Error('lost response');
    return result;
  }};
  const outcome=await createAtomicEarnRepository(lost,ports).admitSubmission(await command());
  assert.equal(outcome.kind,'replayed');assert.equal(db.prepare('SELECT COUNT(*) n FROM earn_submissions').get().n,1);
});

import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('durable receipt survives closing and reopening the reference database',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'tenx-atomic-'));
  const path=join(directory,'fixture.sqlite');let db=openDatabase(path);
  t.after(()=>{db.close();rmSync(directory,{recursive:true,force:true});});
  const ports={crypto,ids:{next:randomUUID}},c=await command();
  await seed(createNodeAtomicDriver(db));
  const accepted=await createAtomicEarnRepository(createNodeAtomicDriver(db),ports).admitSubmission(c);
  db.close();db=openDatabase(path);
  const replay=await createAtomicEarnRepository(createNodeAtomicDriver(db),ports).admitSubmission({...c,nowMs:start+86400000});
  assert.equal(replay.kind,'replayed');assert.deepEqual(replay.receipt,accepted.receipt);assert.deepEqual(replay.value,accepted.value);
});

test('mutating caller-owned commands during digest await cannot change admission or final moderation',async t=>{
  const {db,driver,ports}=fixture(t);await seed(driver);
  let mutate=()=>{};
  const cryptoPort={...crypto,async sha256(bytes){const digest=await crypto.sha256(bytes);mutate();return digest;}};
  const repository=createAtomicEarnRepository(driver,{...ports,crypto:cryptoPort});
  const c=await command(),originalUrl=c.input.url,originalDigest=c.requestDigest;
  mutate=()=>{c.input.url='https://example.test/changed-after-digest';c.principal.wallet='w2';c.requestKey='changed';};
  const accepted=await repository.admitSubmission(c);assert.equal(accepted.kind,'committed');
  assert.equal(accepted.value.submission.url,originalUrl);assert.equal(accepted.receipt.requestDigest,originalDigest);
  assert.equal(db.prepare('SELECT wallet FROM earn_submissions').get().wallet,'w1');
  const review=await reviewCommand(accepted.value.submission.id);
  mutate=()=>{review.input.score=0;review.input.reason='changed';review.principal.id='other';};
  const decision=await repository.recordFinalReview(review);assert.equal(decision.kind,'committed');
  const row=db.prepare('SELECT content_score,moderator,reason FROM earn_reviews').get();
  assert.deepEqual({...row},{content_score:7,moderator:'synthetic-operator',reason:'synthetic'});
});

test('explicit admission and moderation revisions are honored before any new receipt',async t=>{
  const {db,driver,ports}=fixture(t);await seed(driver);const repository=createAtomicEarnRepository(driver,ports),c=await command();
  assert.equal((await repository.admitSubmission({...c,expectedRevisions:{control:'999999'}})).code,'revision_conflict');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n,0);
  await assert.rejects(repository.admitSubmission({...c,expectedRevisions:{unknown:'1'}}),/Invalid expected/);
  const accepted=await repository.admitSubmission(c),review=await reviewCommand(accepted.value.submission.id);
  assert.equal((await repository.recordFinalReview({...review,expectedRevisions:{earn:'0'}})).code,'revision_conflict');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM earn_reviews').get().n,0);
  assert.equal((await repository.recordFinalReview(review)).kind,'committed');
  assert.equal((await repository.admitSubmission({...c,expectedRevisions:{control:'0'}})).kind,'replayed');
});
