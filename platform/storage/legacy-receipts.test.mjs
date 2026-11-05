import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {openDatabase} from './database.mjs';
import {createNodeAtomicDriver} from './node/atomic-driver.mjs';
import {createAtomicEarnRepository} from './atomic-earn.mjs';
import {createNodeEarnRepository} from './node/earn-repository.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {admissionRequestBytes,reviewRequestBytes,ADMIT_SUBMISSION,FINAL_REVIEW} from '../application/commands.mjs';
import {start,command,reviewCommand,seed} from './fixtures/atomic-earn.mjs';
import {buildGoldenScenario} from '../application/fixtures/earn-scenario.mjs';
import {exportBoard} from '../earn/archive.mjs';
import {sql} from './atomic-driver.mjs';
const crypto=createNodeCrypto(),ports={crypto,ids:{next:randomUUID}},DAY=86400000;
async function fixture(t,{review=true}={}){
 const db=openDatabase();t.after(()=>db.close());const driver=createNodeAtomicDriver(db);await seed(driver);
 const old=createNodeEarnRepository(db,{ids:{next:()=> 'synthetic-legacy-post'}}),admission=await command();
 const accepted=await old.admitSubmission(admission),moderation=await reviewCommand(accepted.submission.id);
 moderation.nowMs=start+1;if(review)await old.recordFinalReview(moderation);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n,0);
 return {db,driver,admission,moderation,accepted,repository:createAtomicEarnRepository(driver,ports)};
}
function count(db,table){return db.prepare('SELECT COUNT(*) n FROM '+table).get().n;}
test('legacy accepted admission and review adopt original timestamps after pause, expiry and board closure',async t=>{
 const {db,repository,admission,moderation,accepted}=await fixture(t);
 db.prepare("INSERT INTO ops_scope_log VALUES('legacy-pause','earn-admission',1,NULL,?,'synthetic','pause','synthetic','legacy-pause')").run(start+2);
 db.prepare('UPDATE app_operator_scopes SET enabled=0,revision=revision+1').run();
 db.prepare('INSERT INTO earn_boards VALUES(?,?,?,?,?)').run(20001,'[]',start+DAY,'synthetic-closed','synthetic-closed-board');
 const results=await Promise.all([repository.admitSubmission({...admission,nowMs:start+20*DAY}),repository.admitSubmission({...admission,nowMs:start+20*DAY})]);
 assert.deepEqual(results.map(r=>r.kind).sort(),['committed','replayed']);
 assert.equal(results[0].value.replay,true);assert.deepEqual(results[0].value.submission,accepted.submission);
 assert.equal(db.prepare('SELECT created_ms FROM app_command_receipts WHERE operation_kind=?').get(ADMIT_SUBMISSION).created_ms,start);
 assert.equal(db.prepare('SELECT admitted FROM earn_admission_counts WHERE epoch=20001').get().admitted,1);
 const review=await repository.recordFinalReview({...moderation,nowMs:start+20*DAY});assert.equal(review.kind,'committed');assert.equal(review.value.replayed,true);
 assert.equal(db.prepare('SELECT created_ms FROM app_command_receipts WHERE operation_kind=?').get(FINAL_REVIEW).created_ms,start+1);
 assert.equal(count(db,'earn_submissions'),1);assert.equal(count(db,'earn_reviews'),1);assert.equal(count(db,'app_command_receipts'),2);
 assert.equal((await repository.recordFinalReview({...moderation,nowMs:start+21*DAY})).kind,'replayed');
});
test('changed legacy bodies, token identity and final review fields never adopt the original result',async t=>{
 const {db,repository,admission,moderation}=await fixture(t);
 for(const patch of [{url:'https://example.test/changed'},{tokenId:'different-token'}]){
  const c={...admission,input:{...admission.input,...patch}};c.businessIdentity=c.principal.wallet+'/'+c.input.tokenId;c.requestDigest=await crypto.sha256(admissionRequestBytes(c));
  assert.equal((await repository.admitSubmission(c)).code,'idempotency_conflict');
 }
 for(const patch of [{score:0},{reason:'different reason'},{sourceRef:'different-source'}]){
  const c={...moderation,input:{...moderation.input,...patch}};c.requestDigest=await crypto.sha256(reviewRequestBytes(c));
  assert.equal((await repository.recordFinalReview(c)).code,'final_review');
 }
 const other={...moderation,principal:{kind:'operator',id:'different-operator'}};other.requestDigest=await crypto.sha256(reviewRequestBytes(other));
 assert.equal((await repository.recordFinalReview(other)).code,'final_review');
 assert.equal(count(db,'app_command_receipts'),0);assert.equal(count(db,'earn_submissions'),1);assert.equal(count(db,'earn_reviews'),1);
});
test('revision corrections between legacy read and receipt claim block adoption',async t=>{
 for(const method of ['admitSubmission','recordFinalReview']){
  const {db,driver,admission,moderation}=await fixture(t);let injected=false;
  const racing={...driver,async batch(statements){
   if(!injected&&statements[0].sql.startsWith('INSERT INTO app_command_receipts')){injected=true;db.prepare('UPDATE app_operator_scopes SET revision=revision+1').run();}
   return driver.batch(statements);
  }};
  const repository=createAtomicEarnRepository(racing,ports),c=method==='admitSubmission'?admission:moderation;
  assert.equal((await repository[method](c)).code,'revision_conflict');assert.equal(count(db,'app_command_receipts'),0);
  assert.equal(count(db,'earn_submissions'),1);assert.equal(count(db,'earn_reviews'),1);
  assert.equal((await createAtomicEarnRepository(driver,ports)[method](c)).kind,'committed');
 }
});
test('legacy adoption still asserts the row and counter inside its atomic receipt transaction',async t=>{
 for(const method of ['admitSubmission','recordFinalReview']){
  const {db,driver,admission,moderation}=await fixture(t,{review:method==='recordFinalReview'});
  const table=method==='admitSubmission'?'earn_submissions':'earn_reviews',row=method==='admitSubmission'?'id':'submission_id';
  const removing={...driver,async batch(statements){
   if(statements[0].sql.startsWith('INSERT INTO app_command_receipts'))statements=[statements[0],sql('DELETE FROM '+table+' WHERE '+row+'=?','synthetic-legacy-post'),...statements.slice(1)];
   return driver.batch(statements);
  }};
  await assert.rejects(createAtomicEarnRepository(removing,ports)[method](method==='admitSubmission'?admission:moderation),/Missing mandatory submission|Missing mandatory review/);
  assert.equal(count(db,table),1);assert.equal(count(db,'app_command_receipts'),0);
  assert.equal(db.prepare('SELECT admitted FROM earn_admission_counts WHERE epoch=20001').get().admitted,1);
 }
 const {db,repository,admission}=await fixture(t,{review:false});db.prepare('UPDATE earn_admission_counts SET admitted=0').run();
 await assert.rejects(repository.admitSubmission(admission),/Missing mandatory submission/);
 assert.equal(count(db,'app_command_receipts'),0);
});
test('lost adoption response resolves the original result without inserting another accepted row',async t=>{
 const {db,driver,admission,moderation}=await fixture(t);let losses=0;
 const lost={...driver,async batch(statements){const result=await driver.batch(statements);if(statements[0].sql.startsWith('INSERT INTO app_command_receipts')){losses++;throw Error('lost legacy adoption response');}return result;}};
 const repository=createAtomicEarnRepository(lost,ports);
 assert.equal((await repository.admitSubmission(admission)).kind,'replayed');assert.equal((await repository.recordFinalReview(moderation)).kind,'replayed');
 assert.equal(losses,2);assert.equal(count(db,'app_command_receipts'),2);assert.equal(count(db,'earn_submissions'),1);assert.equal(count(db,'earn_reviews'),1);
});
test('migration021 published fixtures adopt receipts after upgrade without changing published commitments',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('PRAGMA foreign_keys=ON');
 const directory=new URL('./',import.meta.url),files=readdirSync(directory).filter(name=>/^\d{3}-.*\.sql$/.test(name)).sort();
 for(const file of files.filter(name=>Number(name.slice(0,3))<=21))db.exec(readFileSync(new URL(file,directory),'utf8'));
 const before=await buildGoldenScenario(db);
 for(const file of files.filter(name=>Number(name.slice(0,3))>=22))db.exec(readFileSync(new URL(file,directory),'utf8'));
 const repository=createAtomicEarnRepository(createNodeAtomicDriver(db),ports);
 const row=db.prepare("SELECT * FROM earn_submissions WHERE wallet='w1'").get(),review=db.prepare('SELECT * FROM earn_reviews WHERE submission_id=?').get(row.id);
 const admission={...await command(row.wallet,row.request_key),nowMs:row.submitted_ms+20*DAY,input:{tokenId:row.token_id,url:row.url}};
 admission.requestDigest=await crypto.sha256(admissionRequestBytes(admission));assert.equal((await repository.admitSubmission(admission)).value.replay,true);
 const moderation={...await reviewCommand(row.id),principal:{kind:'operator',id:review.moderator},nowMs:admission.nowMs,input:{submissionId:row.id,score:review.content_score,reason:review.reason,sourceRef:review.source_ref}};
 moderation.requestDigest=await crypto.sha256(reviewRequestBytes(moderation));assert.equal((await repository.recordFinalReview(moderation)).value.replayed,true);
 assert.deepEqual(exportBoard(db,before.epoch),before.bundle);assert.equal(db.prepare('SELECT admitted FROM earn_admission_counts WHERE epoch=?').get(before.epoch).admitted,3);
 assert.equal(count(db,'app_command_receipts'),2);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
