import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {openDatabase} from './database.mjs';
import {createNodeAtomicDriver} from './node/atomic-driver.mjs';
import {createAtomicEarnRepository} from './atomic-earn.mjs';
import {createAtomicReceipts} from './atomic-receipts.mjs';
import {createNodeEarnRepository} from './node/earn-repository.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {canonicalJson,orderedJson,utf8} from '../security/canonical.mjs';
import {verifyConfigChain} from '../operations/audit.mjs';
import {FINAL_REVIEW,reviewRequestBytes} from '../application/commands.mjs';
import {sql,revisions} from './atomic-driver.mjs';
import {start,command,reviewCommand,seed} from './fixtures/atomic-earn.mjs';
const crypto=createNodeCrypto(),ports={crypto,ids:{next:randomUUID}},day=86400000;
async function fixture(t,count=1){
 const db=openDatabase();t.after(()=>db.close());const driver=createNodeAtomicDriver(db);await seed(driver,{limit:2});const repository=createAtomicEarnRepository(driver,ports),reviews=[];
 for(let n=1;n<=count;n++){const accepted=await repository.admitSubmission(await command('w'+n,'synthetic-admit-'+n));assert.equal(accepted.kind,'committed');reviews.push(await reviewCommand(accepted.value.submission.id));}
 return {db,driver,repository,reviews};
}
const reviewReceipts=db=>db.prepare('SELECT * FROM app_command_receipts WHERE operation_kind=? ORDER BY operation_id').all(FINAL_REVIEW);
const audits=db=>db.prepare('SELECT * FROM ops_config_audit ORDER BY seq').all();

test('final review atomically binds exact audit payload and historical ordered audit digest',async t=>{
 const f=await fixture(t),c=f.reviews[0],accepted=await f.repository.recordFinalReview(c);assert.equal(accepted.kind,'committed');
 const [row]=audits(f.db),payload={score:c.input.score,reason:c.input.reason,requestDigest:c.requestDigest,reviewedAtMs:c.nowMs,adoptedReference:false};
 assert.deepEqual({...row},{seq:1,previous_hash:null,event_hash:row.event_hash,category:'final-review',entity:c.input.submissionId,change_key:c.requestKey,recorded_ms:c.nowMs,actor:c.principal.id,evidence_ref:c.input.sourceRef,payload:orderedJson(payload)});
 const expected=await crypto.sha256(utf8(orderedJson(['10x-local-config-audit-v1',1,null,'final-review',c.input.submissionId,c.requestKey,c.nowMs,c.principal.id,c.input.sourceRef,payload])));
 assert.equal(row.event_hash,expected);assert.deepEqual(verifyConfigChain(f.db),{format:'10x-local-config-audit-v1',events:1,head:expected});
 const stored=reviewReceipts(f.db)[0];assert.equal(stored.request_digest,c.requestDigest);assert.equal(JSON.parse(stored.input_json).audit.eventHash,expected);
});

test('omitted or altered review audit child rolls back both review and receipt',async t=>{
 for(const fault of ['omit','payload','actor','previous-hash']){
  const f=await fixture(t);let injected=false;
  const driver={...f.driver,async batch(statements){const selected=statements.flatMap(s=>{
   if(!s.sql.startsWith('INSERT INTO ops_config_audit'))return [s];injected=true;if(fault==='omit')return [];
   const values=[...s.values];if(fault==='payload')values[9]=orderedJson({...JSON.parse(values[9]),score:0});
   if(fault==='actor')values[7]='synthetic-wrong-actor';if(fault==='previous-hash')values[1]='0'.repeat(64);return [{...s,values}];
  });return f.driver.batch(selected);}};
  await assert.rejects(createAtomicEarnRepository(driver,ports).recordFinalReview(f.reviews[0]),/Missing exact final review audit/);assert.equal(injected,true);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM earn_reviews').get().n,0);assert.equal(reviewReceipts(f.db).length,0);assert.equal(audits(f.db).length,0);
  assert.equal((await f.repository.recordFinalReview(f.reviews[0])).kind,'committed');assert.equal(verifyConfigChain(f.db).events,1);
 }
});

test('independent concurrent reviews contend on the shared audit head and retry forms one chain',async t=>{
 const f=await fixture(t,2);let captures=0,release;const barrier=new Promise(resolve=>{release=resolve;});
 const driver={...f.driver,async batch(statements){const result=await f.driver.batch(statements);if(statements.some(s=>s.sql==='SELECT seq,event_hash FROM ops_config_audit ORDER BY seq DESC LIMIT 1')&&captures<2){captures++;if(captures===2)release();await barrier;}return result;}};
 const repository=createAtomicEarnRepository(driver,ports),results=await Promise.all(f.reviews.map(c=>repository.recordFinalReview(c)));
 assert.deepEqual(results.map(r=>r.kind).sort(),['committed','conflict']);const loser=results.findIndex(r=>r.kind==='conflict');assert.equal(results[loser].code,'revision_conflict');
 assert.equal((await repository.recordFinalReview(f.reviews[loser])).kind,'committed');const chain=audits(f.db);assert.equal(chain.length,2);assert.equal(chain[1].previous_hash,chain[0].event_hash);assert.equal(verifyConfigChain(f.db).events,2);assert.equal(reviewReceipts(f.db).length,2);
});

test('lost final-review acknowledgement resolves one original audit and later revoked-scope replay adds nothing',async t=>{
 const f=await fixture(t);let lost=false;const driver={...f.driver,async batch(statements){const result=await f.driver.batch(statements);if(!lost&&statements.some(s=>s.sql.startsWith('INSERT INTO ops_config_audit'))){lost=true;throw Error('Synthetic lost review acknowledgement');}return result;}};
 const first=await createAtomicEarnRepository(driver,ports).recordFinalReview(f.reviews[0]);assert.equal(first.kind,'replayed');assert.equal(lost,true);
 f.db.prepare('UPDATE app_operator_scopes SET enabled=0,revision=revision+1').run();const before=canonicalJson({audit:audits(f.db),receipts:reviewReceipts(f.db)});
 const later=await f.repository.recordFinalReview({...f.reviews[0],nowMs:start+day});assert.deepEqual(later,first);assert.equal(canonicalJson({audit:audits(f.db),receipts:reviewReceipts(f.db)}),before);assert.equal(verifyConfigChain(f.db).events,1);
 const changed={...f.reviews[0],input:{...f.reviews[0].input,score:9}};changed.requestDigest=await crypto.sha256(reviewRequestBytes(changed));assert.equal((await f.repository.recordFinalReview(changed)).code,'idempotency_conflict');assert.equal(audits(f.db).length,1);
});

test('reference review adoption records its audit now while preserving original review time and bytes',async t=>{
 const f=await fixture(t),c={...f.reviews[0],nowMs:start+1};await createNodeEarnRepository(f.db,{ids:ports.ids}).recordFinalReview(c);
 const before=canonicalJson(f.db.prepare('SELECT * FROM earn_reviews').all()),originalDigest=await crypto.sha256(utf8(before));assert.equal(reviewReceipts(f.db).length,0);
 f.db.prepare('UPDATE app_operator_scopes SET enabled=0,revision=revision+1').run();const now=start+2*day,result=await f.repository.recordFinalReview({...c,nowMs:now});assert.equal(result.kind,'committed');assert.equal(result.value.replayed,true);
 const row=audits(f.db)[0],stored=reviewReceipts(f.db)[0];assert.equal(row.category,'final-review-adoption');assert.equal(row.recorded_ms,now);assert.equal(stored.created_ms,c.nowMs);
 assert.deepEqual(JSON.parse(row.payload),{score:c.input.score,reason:c.input.reason,requestDigest:c.requestDigest,reviewedAtMs:c.nowMs,adoptedReference:true});assert.equal(stored.request_digest,c.requestDigest);
 assert.equal(await crypto.sha256(utf8(canonicalJson(f.db.prepare('SELECT * FROM earn_reviews').all()))),originalDigest);assert.equal(verifyConfigChain(f.db).events,1);
 assert.equal((await f.repository.recordFinalReview({...c,nowMs:now+day})).kind,'replayed');assert.equal(audits(f.db).length,1);
});

test('a pre056 committed review receipt replays unchanged without retroactive audit fabrication',async t=>{
 const f=await fixture(t),c=f.reviews[0];
 // Synthetic upgrade setup only: retain all old mandatory effects, disable the
 // single additive056 guard while producing the original pre056 receipt form.
 f.db.exec('DROP TRIGGER app_final_review_audit_mandatory');
 const old=await createAtomicReceipts(f.driver,ports).execute(c,{businessKey:c.businessIdentity,input:{...c.input,moderator:c.principal.id},result:{recorded:true,replayed:false},resultRef:c.input.submissionId,
  version:revisions(f.db.prepare('SELECT * FROM app_revisions ORDER BY name').all()),child:(gate,values)=>sql(`INSERT INTO earn_reviews SELECT ?,?,?,?,?,? WHERE ${gate}`,c.input.submissionId,c.input.score,c.principal.id,c.input.reason,c.nowMs,c.input.sourceRef,...values)});
 assert.equal(old.kind,'committed');f.db.exec(readFileSync(new URL('./056-final-review-audit.sql',import.meta.url),'utf8'));
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE name='app_final_review_audit_mandatory'").get().n,1);
 const before=canonicalJson(reviewReceipts(f.db));f.db.prepare('UPDATE app_operator_scopes SET enabled=0,revision=revision+1').run();const replay=await f.repository.recordFinalReview({...c,nowMs:start+day});
 assert.equal(replay.kind,'replayed');assert.deepEqual(replay.receipt,old.receipt);assert.deepEqual(replay.value,old.value);assert.equal(canonicalJson(reviewReceipts(f.db)),before);assert.equal(audits(f.db).length,0);
});
