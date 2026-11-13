import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {localRuntime} from './local-runtime.mjs';
import {openDatabase} from '../../storage/database.mjs';
import {recordSamplePrice} from '../../pricing/fixtures.mjs';
import {configureWorkload} from '../../earn/operations.mjs';
import {createClient,PlatformApiError} from '../../contracts/client.mjs';
import {encode58} from '../../server/base58.mjs';
import {evaluateSubmission,createAppeal,verifyReport} from '../../ai-review/review.mjs';
import {exampleJob,syntheticProvider} from '../../ai-review/fixture.mjs';
import {canonicalJson} from '../../security/canonical.mjs';

const origin='http://localhost',entry=new URL('./fixtures/ai-review-feedback-worker.ts',import.meta.url);
const key=()=>{const pair=generateKeyPairSync('ed25519');return {...pair,wallet:encode58(pair.publicKey.export({type:'spki',format:'der'}).subarray(-32))};};
async function actor(mf,keys){
 const a={wallet:keys.wallet,cookie:'',lastStatus:null};
 a.raw=async(path,{headers={},...init}={})=>mf.dispatchFetch(origin+path,{...init,headers:{origin,cookie:a.cookie,...headers}});
 a.client=createClient({baseUrl:origin+'/api/v1',fetchImpl:async(url,init)=>{
  const headers=new Headers(init.headers);headers.set('origin',origin);if(a.cookie)headers.set('cookie',a.cookie);
  const response=await mf.dispatchFetch(url,{...init,headers});a.lastStatus=response.status;
  const cookie=response.headers.get('set-cookie');if(cookie)a.cookie=cookie.split(';')[0];return response;
 }});
 const challenge=await a.client.createWalletChallenge({body:{wallet:a.wallet}});
 await a.client.verifyWalletSignature({body:{nonce:challenge.data.nonce,signature:encode58(sign(null,Buffer.from(challenge.data.message),keys.privateKey))}});
 return a;
}
async function fixture(t,count=6){
 const {mf,db}=await localRuntime(t,entry),node=openDatabase();t.after(()=>node.close());const now=Date.now(),keys=[key(),key()];
 configureWorkload(node,{effectiveEpoch:Math.floor(now/86400000),atMs:now-1000,staffedMinutes:30,secondsPerReview:30,admissionLimit:20,operator:'synthetic-review-http',reason:'SYNTHETIC Worker review test capacity'});
 for(let i=0;i<count;i++){
  const tokenId='synthetic-review-http-'+i;node.prepare('INSERT INTO earn_fixture_campaigns VALUES(?,?,?)').run(tokenId,now-1000,'1000000');
  recordSamplePrice(node,{wallet:keys[0].wallet,tokenId,asOfMs:now-500,validUntilMs:now+600000,stakedUnits:'10000000'});
 }
 for(const table of ['earn_fixture_campaigns','earn_workload_policies','price_sources','earn_stake_reads','price_observations','ops_config_audit']){
  const statements=node.prepare('SELECT * FROM '+table+' ORDER BY rowid').all().map(row=>{const columns=Object.keys(row);return db.prepare('INSERT INTO '+table+' ('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').bind(...Object.values(row));});if(statements.length)await db.batch(statements);
 }
 const [owner,other]=await Promise.all(keys.map(k=>actor(mf,k)));
 const admit=async index=>{
  const tokenId='synthetic-review-http-'+index,url='https://qa.invalid/submissions/worker-'+index;
  const result=await owner.client.submitEarnContent({body:{tokenId,url},idempotencyKey:'synthetic-worker-submit-'+index});
  assert.equal(owner.lastStatus,201);const id=result.data.id;
  assert.equal((await db.prepare('SELECT state FROM ai_review_jobs WHERE submission_id=?').bind(id).first()).state,'awaiting-capture');
  return {id,tokenId,url};
 };
 const install=async(submission,{previousReport=null,appeal=null,jobId='submission:'+submission.id,corrupt=false}={})=>{
  const time=Date.now(),job={...exampleJob,submissionId:submission.id,tokenId:submission.tokenId,url:submission.url,capturedAt:new Date(time).toISOString()};
  const report=await evaluateSubmission({job,provider:syntheticProvider,nowMs:time,previousReport,appeal});verifyReport(report);
  const stored=structuredClone(report);
  if(corrupt){stored.payload.evaluation.criteria[0].evidence[0].quote='FORGED ungrounded source';stored.reportId=createHash('sha256').update(canonicalJson(stored.payload)).digest('hex');}
  await db.batch([
   db.prepare('INSERT INTO ai_review_captures VALUES(?,?,?,?,?,?)').bind(jobId,canonicalJson(job),report.payload.inputHash,'SYNTHETIC Node-validated private test capture','synthetic-review-http',time),
   db.prepare("UPDATE ai_review_jobs SET state='ready',updated_ms=?,revision=revision+1 WHERE id=?").bind(time,jobId),
   db.prepare("UPDATE ai_review_jobs SET state='running',attempt=1,lease_token=?,lease_until_ms=?,dispatched_ms=?,updated_ms=?,revision=revision+1 WHERE id=?").bind('synthetic-lease-'+jobId,time+30000,time,time,jobId),
   db.prepare('INSERT INTO ai_review_attempts(job_id,attempt,lease_token,started_ms,dispatched_ms,ended_ms,outcome) VALUES(?,1,?,?,?,?,?)').bind(jobId,'synthetic-lease-'+jobId,time,time,time,'completed'),
   db.prepare('INSERT INTO ai_review_reports VALUES(?,?,?,?,?)').bind(stored.reportId,jobId,submission.id,canonicalJson(stored),time),
   db.prepare("UPDATE ai_review_jobs SET state='completed',lease_token=NULL,lease_until_ms=NULL,updated_ms=?,revision=revision+1 WHERE id=?").bind(time,jobId),
  ]);
  return report;
 };
 return {mf,db,owner,other,admit,install};
}
const read=(a,id)=>a.client.getEarnReviewFeedback({path:{submissionId:id}});
const appeal=(a,id,reportId,key='synthetic-appeal',reason='Please reconsider the supplied example.')=>a.client.submitEarnReviewAppeal({path:{submissionId:id},body:{reportId,reason},idempotencyKey:key});
const expectError=(operation,status,code)=>assert.rejects(operation,error=>error instanceof PlatformApiError&&error.status===status&&error.code===code);

test('actual Worker creator feedback is advertised, wallet-owned, bounded and private; appeals preserve immutable report lineage',async t=>{
 const f=await fixture(t,2),{mf,db,owner,other}=f;
 const capabilities=await (await mf.dispatchFetch(origin+'/api/v1/capabilities')).json();assert.equal(capabilities.features.some(feature=>feature.id==='earn-review-feedback'),true);assert.equal(capabilities.production.financialExecution,false);
 const spec=await (await mf.dispatchFetch(origin+'/api/v1/openapi.json')).json();assert.ok(spec.paths['/earn/submissions/{submissionId}/review']);assert.ok(spec.paths['/earn/submissions/{submissionId}/appeals']);
 const submission=await f.admit(0),path='/api/v1/earn/submissions/'+submission.id;
 assert.equal((await mf.dispatchFetch(origin+path+'/review')).status,401);assert.equal((await owner.raw(path+'/capture',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,404);assert.equal((await owner.raw(path+'/run',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,404);
 await expectError(read(other,submission.id),404,'submission_not_found');
 const pending=(await read(owner,submission.id)).data;assert.equal(pending.status,'awaiting-capture');assert.equal(pending.feedback,null);assert.equal(pending.appeal.eligible,false);assert.equal(pending.paidCallsEnabled,false);
 const report=await f.install(submission),ready=(await read(owner,submission.id)).data;
 assert.equal(ready.feedback.reportId,report.reportId);assert.equal(ready.feedback.suggestedScore,report.payload.score);assert.equal(ready.feedback.label,'SIMULATION — not an AI judgment');assert.equal(ready.finalReview,null);assert.equal(ready.appeal.eligible,true);
 assert.doesNotMatch(JSON.stringify(ready),/capturedJob|projectContext|providerEvidence|job_json|report_json/);assert.ok(!JSON.stringify(ready).includes(report.payload.capturedJob.content));
 await expectError(appeal(other,submission.id,report.reportId),404,'submission_not_found');
 for(const [init,status,code] of [
  [{headers:{origin:'https://wrong.invalid','content-type':'application/json'},body:'{}'},403,'invalid_origin'],
  [{headers:{'content-type':'text/plain'},body:'{}'},415,'unsupported_media_type'],
  [{headers:{'content-type':'application/json'},body:JSON.stringify({reportId:report.reportId,reason:'SYNTHETIC',wallet:other.wallet})},400,'invalid_input'],
 ]){const response=await owner.raw(path+'/appeals',{method:'POST',...init});assert.equal(response.status,status);assert.equal((await response.json()).error.code,code);}
 await db.prepare("DELETE FROM request_limits WHERE bucket LIKE 'review-appeal:%'").run();
 const accepted=await appeal(owner,submission.id,report.reportId);assert.equal(owner.lastStatus,201);assert.equal(accepted.data.appeal.latest.reportId,report.reportId);assert.equal(accepted.data.status,'awaiting-capture');
 const replay=await appeal(owner,submission.id,report.reportId);assert.equal(owner.lastStatus,200);assert.equal(replay.data.appeal.latest.appealId,accepted.data.appeal.latest.appealId);
 await expectError(appeal(owner,submission.id,report.reportId,'synthetic-appeal','Changed reason.'),409,'idempotency_conflict');
 assert.equal(await db.prepare('SELECT COUNT(*) n FROM ai_review_appeals').first('n'),1);assert.equal(await db.prepare("SELECT COUNT(*) n FROM ai_review_jobs WHERE kind='appeal'").first('n'),1);
 const saved=await db.prepare('SELECT appeal_json FROM ai_review_appeals').first('appeal_json'),appealArtifact=JSON.parse(saved);
 const replacement=await f.install(submission,{previousReport:report,appeal:appealArtifact,jobId:'appeal:'+appealArtifact.appealId});
 const reconsidered=(await read(owner,submission.id)).data;assert.equal(reconsidered.feedback.reportId,replacement.reportId);assert.equal(reconsidered.feedback.previousReportId,report.reportId);assert.equal(reconsidered.appeal.latest.status,'reviewed');
 await expectError(appeal(owner,submission.id,report.reportId,'synthetic-old-report'),409,'review_changed');
 assert.equal(await db.prepare('SELECT COUNT(*) n FROM earn_reviews').first('n'),0);assert.equal(await db.prepare('SELECT COUNT(*) n FROM earn_allocations').first('n'),0);
 // A recomputed top-level hash cannot make ungrounded source evidence valid.
 const malformed=await f.admit(1);await f.install(malformed,{corrupt:true});const invalid=await owner.raw('/api/v1/earn/submissions/'+malformed.id+'/review');assert.equal(invalid.status,503);const unavailable=await invalid.json();assert.equal(unavailable.error.code,'review_evidence_unavailable');assert.doesNotMatch(JSON.stringify(unavailable),/FORGED|SYNTHETIC QA CONTENT/);await owner.client.revokeSession();await expectError(read(owner,submission.id),401,'authentication_required');
});

test('actual Worker concurrent appeal requests create one obligation and final/closed guards keep scores and rewards unchanged',async t=>{
 const f=await fixture(t,3),{db,owner}=f,first=await f.admit(0),report=await f.install(first);
 const competing=await Promise.allSettled([appeal(owner,first.id,report.reportId,'synthetic-concurrent-a'),appeal(owner,first.id,report.reportId,'synthetic-concurrent-b')]);
 assert.equal(competing.filter(value=>value.status==='fulfilled').length,1);assert.equal(competing.filter(value=>value.status==='rejected'&&value.reason.status===409&&value.reason.code==='review-in-progress').length,1);
 assert.equal(await db.prepare('SELECT COUNT(*) n FROM ai_review_appeals').first('n'),1);assert.equal(await db.prepare("SELECT COUNT(*) n FROM ai_review_jobs WHERE kind='appeal'").first('n'),1);
 const final=await f.admit(1),finalReport=await f.install(final);await db.prepare('INSERT INTO earn_reviews VALUES(?,?,?,?,?,?)').bind(final.id,2,'synthetic-reviewer','SYNTHETIC final authority',Date.now(),'synthetic:final').run();
 const reviewed=(await read(owner,final.id)).data;assert.equal(reviewed.finalReview.score,2);assert.equal(reviewed.appeal.eligible,false);assert.equal(reviewed.appeal.reason,'final-review-recorded');await expectError(appeal(owner,final.id,finalReport.reportId,'synthetic-after-final'),409,'final-review-recorded');
 const closed=await f.admit(2),closedReport=await f.install(closed);
 const epoch=await db.prepare('SELECT epoch FROM earn_submissions WHERE id=?').bind(closed.id).first('epoch');await db.prepare('INSERT INTO earn_boards VALUES(?,?,?,?,?)').bind(epoch,'[]',Date.now(),'a'.repeat(64),'SYNTHETIC closed board fixture').run();
 await expectError(appeal(owner,closed.id,closedReport.reportId,'synthetic-after-board'),409,'board-closed');
 assert.equal(await db.prepare('SELECT content_score FROM earn_reviews WHERE submission_id=?').bind(final.id).first('content_score'),2);assert.equal(await db.prepare('SELECT COUNT(*) n FROM earn_allocations').first('n'),0);
});

test('actual D1 awaited-hash races and lost acknowledgements cannot insert stale appeals or duplicate children',async t=>{
 const f=await fixture(t,4),{mf,db,owner}=f;
 const race=async(submission,report,{statements=[],lostResponse=false,key='synthetic-race-'+submission.id}={})=>{
  const response=await mf.dispatchFetch(origin+'/__fixture/appeal-race',{method:'POST',body:JSON.stringify({wallet:owner.wallet,submissionId:submission.id,reportId:report.reportId,reason:'SYNTHETIC race reconsideration',requestKey:key,raceStatements:statements,lostResponse})});return {status:response.status,...await response.json()};
 };
 const final=await f.admit(0),finalReport=await f.install(final),finalRace=await race(final,finalReport,{statements:[{sql:'INSERT INTO earn_reviews VALUES(?,?,?,?,?,?)',values:[final.id,3,'synthetic-reviewer','SYNTHETIC hash race',Date.now(),'synthetic:race']}]});
 assert.equal(finalRace.injected,true);assert.ok(finalRace.hashes>0);assert.equal(finalRace.status,409);assert.equal(finalRace.error.code,'final-review-recorded');assert.equal(await db.prepare('SELECT COUNT(*) n FROM ai_review_appeals').first('n'),0);
 const lost=await f.admit(1),lostReport=await f.install(lost),lostKey='synthetic-lost-response',lostResult=await race(lost,lostReport,{key:lostKey,lostResponse:true});assert.equal(lostResult.committed,true);assert.equal(lostResult.status,200);assert.equal(lostResult.result.outcome,'replayed');
 const recovered=await race(lost,lostReport,{key:lostKey});assert.equal(recovered.status,200);assert.equal(recovered.result.outcome,'replayed');assert.equal(await db.prepare('SELECT COUNT(*) n FROM ai_review_appeals WHERE submission_id=?').bind(lost.id).first('n'),1);assert.equal(await db.prepare("SELECT COUNT(*) n FROM ai_review_jobs WHERE submission_id=? AND kind='appeal'").bind(lost.id).first('n'),1);
 const latest=await f.admit(2),latestReport=await f.install(latest),time=Date.now(),competing=createAppeal({report:latestReport,reason:'SYNTHETIC competing review',createdAt:new Date(time).toISOString()}),digest=createHash('sha256').update(canonicalJson({submissionId:latest.id,reportId:latestReport.reportId,reason:competing.payload.reason})).digest('hex');
 const latestRace=await race(latest,latestReport,{statements:[{sql:'INSERT INTO ai_review_appeals VALUES(?,?,?,?,?,?,?,?,?)',values:[competing.appealId,latest.id,latestReport.reportId,'appeal:'+competing.appealId,owner.wallet,'synthetic-race-winner',digest,canonicalJson(competing),time]}]});
 assert.equal(latestRace.injected,true);assert.equal(latestRace.status,409);assert.equal(latestRace.error.code,'review-in-progress');assert.equal(await db.prepare('SELECT COUNT(*) n FROM ai_review_appeals WHERE submission_id=?').bind(latest.id).first('n'),1);assert.equal(await db.prepare("SELECT COUNT(*) n FROM ai_review_jobs WHERE submission_id=? AND kind='appeal'").bind(latest.id).first('n'),1);
 const closed=await f.admit(3),closedReport=await f.install(closed),epoch=await db.prepare('SELECT epoch FROM earn_submissions WHERE id=?').bind(closed.id).first('epoch');
 const closedRace=await race(closed,closedReport,{statements:[{sql:'INSERT INTO earn_boards VALUES(?,?,?,?,?)',values:[epoch,'[]',Date.now(),'b'.repeat(64),'SYNTHETIC board hash race']}]});assert.equal(closedRace.injected,true);assert.equal(closedRace.status,409);assert.equal(closedRace.error.code,'board-closed');assert.equal(await db.prepare('SELECT COUNT(*) n FROM ai_review_appeals WHERE submission_id=?').bind(closed.id).first('n'),0);
});

test('D1 recovery hold written during WebCrypto verification rejects appeal with no orphaned job',async t=>{
 const f=await fixture(t,1),submission=await f.admit(0),report=await f.install(submission);
 const response=await f.mf.dispatchFetch(origin+'/__fixture/appeal-race',{method:'POST',body:JSON.stringify({wallet:f.owner.wallet,submissionId:submission.id,reportId:report.reportId,reason:'SYNTHETIC recovery race',requestKey:'synthetic-recovery-race',raceStatements:[{sql:"UPDATE app_recovery_state SET mode='public',status='held' WHERE id=1",values:[]}]})});
 const value=await response.json();assert.equal(value.injected,true);assert.ok(value.hashes>0);assert.equal(response.status,409);assert.equal(value.error.code,'review_unavailable');await expectError(appeal(f.owner,submission.id,report.reportId,'synthetic-http-recovery'),409,'review_unavailable');assert.equal(await f.db.prepare('SELECT COUNT(*) n FROM ai_review_appeals').first('n'),0);assert.equal(await f.db.prepare("SELECT COUNT(*) n FROM ai_review_jobs WHERE kind='appeal'").first('n'),0);
});

test('D1 appeal trigger satisfies immediate child foreign key and rolls back mismatched child or source atomically',async t=>{
 const f=await fixture(t,2),{db,owner}=f;
 const prepare=async(index)=>{
  const submission=await f.admit(index),report=await f.install(submission),time=Date.now(),artifact=createAppeal({report,reason:'SYNTHETIC atomic trigger check',createdAt:new Date(time).toISOString()}),jobId='appeal:'+artifact.appealId;
  const values=[artifact.appealId,submission.id,report.reportId,jobId,owner.wallet,'synthetic-trigger-'+index,'a'.repeat(64),canonicalJson(artifact),time];
  return {submission,report,time,artifact,jobId,values};
 };
 const first=await prepare(0);assert.equal(await db.prepare('SELECT COUNT(*) n FROM ai_review_jobs WHERE id=?').bind(first.jobId).first('n'),0);
 await db.prepare('INSERT INTO ai_review_appeals VALUES(?,?,?,?,?,?,?,?,?)').bind(...first.values).run();
 const child=await db.prepare('SELECT * FROM ai_review_jobs WHERE id=?').bind(first.jobId).first();assert.equal(child.state,'awaiting-capture');assert.equal(child.revision,0);assert.equal(child.previous_report_id,first.report.reportId);assert.equal(child.appeal_id,first.artifact.appealId);
 const second=await prepare(1),before=await db.prepare('SELECT revision FROM app_recovery_watermark WHERE id=1').first('revision');
 await assert.rejects(db.batch([
  db.prepare("INSERT INTO ai_review_jobs(id,submission_id,kind,previous_report_id,appeal_id,state,created_ms,updated_ms) VALUES(?,?,'appeal',?,?,'held',?,?)").bind(second.jobId,second.submission.id,second.report.reportId,second.artifact.appealId,second.time,second.time),
  db.prepare('INSERT INTO ai_review_appeals VALUES(?,?,?,?,?,?,?,?,?)').bind(...second.values),
 ]),/Appeal job binding mismatch/);
 assert.equal(await db.prepare('SELECT COUNT(*) n FROM ai_review_jobs WHERE id=?').bind(second.jobId).first('n'),0);assert.equal(await db.prepare('SELECT COUNT(*) n FROM ai_review_appeals WHERE appeal_id=?').bind(second.artifact.appealId).first('n'),0);assert.equal(await db.prepare('SELECT revision FROM app_recovery_watermark WHERE id=1').first('revision'),before);
 const wrongOwner=[...second.values];wrongOwner[4]=f.other.wallet;await assert.rejects(db.prepare('INSERT INTO ai_review_appeals VALUES(?,?,?,?,?,?,?,?,?)').bind(...wrongOwner).run(),/Appeal source binding mismatch/);
 assert.equal(await db.prepare('SELECT COUNT(*) n FROM ai_review_jobs WHERE id=?').bind(second.jobId).first('n'),0);assert.equal(await db.prepare('SELECT revision FROM app_recovery_watermark WHERE id=1').first('revision'),before);
});
