import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {canonicalJson,utf8} from '../../security/canonical.mjs';
import {createNodeCrypto} from '../../security/node-crypto.mjs';
import {createManifestCodec} from '../../artifacts/manifest-codec.mjs';
import {readInstalledRecoverySchema} from '../../recovery/node-schema.mjs';
import {createHostedNodeMirror} from '../../recovery/hosted-node-mirror.mjs';
import {rehearseIntegratedRecovery} from '../../recovery/integrated-rehearsal.mjs';
import {createHostedRuntime} from '../../scripts/hosted-runtime.mjs';
import {authenticateHosted,HOSTED_DAY} from './hosted-slice.mjs';
const rows=async(runtime,statement,values=[])=>{const result=await runtime.db.prepare(statement).bind(...values).all();return result.results;};
const one=async(runtime,statement,values=[])=>runtime.db.prepare(statement).bind(...values).first();
const demand=(result,kind)=>assert.equal(result.kind,kind,JSON.stringify(result));
export async function buildHostedEvidence(runtime,{epoch,historyStartMs,prefix}){
 const query={epoch,historyStartMs,sourceBindings:[]};
 const frozen=await runtime.call({method:'freeze',epoch});assert.ok(['committed','replayed'].includes(frozen.kind)||frozen.code==='epoch-already-frozen',JSON.stringify(frozen));
 const inventory=await runtime.call({method:'inventory',query});demand(inventory,'loaded');let index=0;
 for(const requirement of inventory.inputs.filter(i=>i.authority==='evidence')){
  const pricing=['entry-stake','closing-stake'].includes(requirement.kind),at=requirement.cutoffMs;
  const [wallet,tokenId]=pricing?JSON.parse(requirement.subject.id):[];
  const policy=pricing?JSON.parse((await one(runtime,'SELECT policy FROM price_sources WHERE token_id=?',[tokenId])).policy):{kind:requirement.kind,fromMs:requirement.coverage.fromMs};
  const field={'campaign-registry':'campaigns',ownership:'assets','position-inventory':'positions','action-completions':'completions'}[requirement.kind];
  assert.ok(pricing||field,'Unsupported synthetic hosted requirement '+requirement.kind);
  const payload=pricing?JSON.parse((await one(runtime,'SELECT raw_evidence FROM price_observations WHERE wallet=? AND token_id=? AND as_of_ms=? ORDER BY revision DESC LIMIT 1',[wallet,tokenId,at])).raw_evidence):
   {version:1,network:'local-solana',kind:requirement.kind,subject:requirement.subject,fromMs:requirement.coverage.fromMs,toMs:at,complete:true,pages:[{cursor:null,nextCursor:null,items:requirement.value[field]}]};
  const sourceId=prefix+'-'+index++,decoderVersion=pricing?'synthetic-pricing-v1':'synthetic-cutoff-facts-v1';
  const recorded=await runtime.call({method:'ingest',sourceId,fixture:{payload,policy,subject:requirement.subject,decoderVersion,now:at,
   records:[{id:'fixture',subject:requirement.subject,contextSlot:pricing?'100':'10',blockTimeMs:at,retrievedAtMs:at,finality:'finalized',bytes:[...utf8(canonicalJson(payload))]}]}});
  assert.equal(recorded.receipt.value?.decision.status,'verified',JSON.stringify(recorded.receipt));
  query.sourceBindings.push({kind:requirement.kind,subject:requirement.subject,cutoffMs:at,sourceId,sourceRevision:recorded.source.sourceRevision,decoderVersion});
 }
 return query;
}
async function wakeHeld(runtime,job,digest){
 assert.equal(job.state,'held',JSON.stringify(job));demand(await runtime.call({method:'wake',input:{jobId:job.id,dependency:job.dependency,evidenceDigest:digest}}),'woken');
}
export async function verifyHostedTranscript(runtime,fixture){
 const began=performance.now(),crypto=createNodeCrypto(),codec=createManifestCodec({crypto}),schema=await readInstalledRecoverySchema(crypto);
 const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:fileURLToPath(new URL('../../../',import.meta.url)),encoding:'utf8'}).trim();
 // Keep admission inside this fixture's original epoch. Near UTC midnight,
 // advancing two minutes would select the deliberately zero closing stake
 // observation and test a different day before the intended cutoff phase.
 const {epoch,start,cutoff,accounts,principal}=fixture;let nowMs=Math.min(fixture.nowMs+120000,cutoff-1),mirror;
 const setNow=async value=>{nowMs=value;mirror?.setNow(value);return runtime.call({method:'set-clock',nowMs});};
 try{
  await setNow(nowMs);
  const submissions=[];
  for(const [index,account] of accounts.entries()){
   const existing=await rows(runtime,'SELECT * FROM earn_submissions WHERE wallet=? AND epoch=?',[account.wallet,epoch]);
   const actor=await authenticateHosted(runtime,account);
   const tokens=index===0?['hosted-a','hosted-b']:['hosted-a'];
   for(const tokenId of tokens){
    const prior=existing.find(p=>p.token_id===tokenId),body={tokenId,url:'https://example.test/synthetic-'+account.label+'-'+tokenId};
    const post=prior??(await actor.client.submitEarnContent({idempotencyKey:'synthetic-'+account.label+'-'+tokenId,body})).data;
    if(!prior){const replay=await actor.client.submitEarnContent({idempotencyKey:'synthetic-'+account.label+'-'+tokenId,body});assert.equal(replay.data.id,post.id);}
    const score=index===2?0:index===0?(tokenId==='hosted-a'?9:7):index===1?8:6;
    const input={submissionId:post.id,score,reason:'Synthetic human moderation '+account.label,sourceRef:'synthetic-human-review:'+post.id};
    const review=await runtime.call({method:'review',input});assert.equal(review.recorded,true);assert.equal((await runtime.call({method:'review',input})).replayed,true);
    submissions.push({id:post.id,wallet:account.wallet,tokenId,score});
   }
  }
  assert.equal(submissions.length,5);
  await setNow(cutoff+1);
  const missingQuery={epoch,historyStartMs:start-HOSTED_DAY,sourceBindings:[]};
  demand(await runtime.call({method:'schedule-cutoff',query:missingQuery}),'committed');await runtime.call({method:'tick'});
  const heldMissing=await one(runtime,"SELECT * FROM app_jobs WHERE type='complete-cutoff' AND state='held'");assert.ok(heldMissing);assert.equal(await one(runtime,'SELECT * FROM earn_boards WHERE epoch=?',[epoch]),null);
  const query=await buildHostedEvidence(runtime,{epoch,historyStartMs:start-HOSTED_DAY,prefix:'hosted-current'});
  const scheduled=await runtime.call({method:'schedule-cutoff',query});demand(scheduled,'committed');
  await runtime.call({method:'tick',fault:'mid-read'});assert.equal(runtime.lastMeasurements.faultInjected,true);
  const interrupted=await one(runtime,"SELECT * FROM app_jobs WHERE id=?",[scheduled.job.id]);assert.equal(interrupted.state,'held');
  await wakeHeld(runtime,interrupted,await crypto.sha256(utf8('synthetic restored private reader')));await runtime.call({method:'tick'});
  assert.ok(await one(runtime,'SELECT * FROM app_epoch_inputs WHERE epoch=?',[epoch]));
  await runtime.call({method:'drain-outbox'});let acquired;
  for(let n=0;n<3;n++){acquired=await runtime.call({method:'acquire'});demand(acquired,'acquired');if(acquired.job.type==='finalize-board')break;
   assert.equal(acquired.job.id,heldMissing.id,'Only the superseded incomplete configuration may precede this board');
   demand(await runtime.call({method:'resume-cutoff',job:acquired.job}),'finished');
  }
  assert.equal(acquired.job.type,'finalize-board');
  const old=await runtime.call({method:'prepare-board',query:{epoch,requestKey:acquired.job.id}});demand(old,'prepared');
  mirror=await createHostedNodeMirror({source:runtime,schema,sourceCommit,nowMs,principal});
  const mirroredJob=mirror.db.prepare('SELECT * FROM app_jobs WHERE id=?').get(acquired.job.id);
  demand(await mirror.context.jobs.wake({jobId:mirroredJob.id,dependency:mirroredJob.dependency,evidenceDigest:mirror.inventoryDigest}),'woken');
  await setNow(nowMs+31000);
  const expired=await runtime.call({method:'commit-board',command:old.command,lease:acquired.job.lease});assert.ok(['conflict','pending'].includes(expired.kind),JSON.stringify(expired));
  assert.equal(await one(runtime,'SELECT * FROM earn_boards WHERE epoch=?',[epoch]),null);
  await runtime.call({method:'tick'});await mirror.context.tick();
  const board=await one(runtime,'SELECT * FROM earn_boards WHERE epoch=?',[epoch]);assert.ok(board);
  const stale=await runtime.call({method:'commit-board',command:old.command,lease:acquired.job.lease});demand(stale,'replayed');
  assert.equal((await one(runtime,'SELECT snapshot_hash FROM earn_boards WHERE epoch=?',[epoch])).snapshot_hash,board.snapshot_hash);
  const nodeBoard=mirror.db.prepare('SELECT * FROM earn_boards WHERE epoch=?').get(epoch);assert.deepEqual(JSON.parse(nodeBoard.winners),JSON.parse(board.winners));assert.equal(nodeBoard.snapshot_hash,board.snapshot_hash);assert.equal(nodeBoard.finalized_ms,board.finalized_ms);
  const winners=JSON.parse(board.winners);assert.equal(winners.length,3);assert.equal(winners.find(w=>w.wallet===accounts[0].wallet).tokenId,'hosted-b');assert.ok(!winners.some(w=>w.wallet===accounts[2].wallet));
  let publicationJob;
  for(let n=0;n<8&&!publicationJob;n++){await runtime.call({method:'tick',fault:'after-put'});publicationJob=await one(runtime,"SELECT * FROM app_jobs WHERE type='publish-archive' AND state='held'");}
  assert.ok(publicationJob);assert.equal(publicationJob.reason,'publication-write-unknown');assert.equal(runtime.lastMeasurements.faultInjected,true);assert.equal((await one(runtime,'SELECT COUNT(*) n FROM manifest_catalog')).n,0);
  const plannedObject=await one(runtime,'SELECT object_key,state FROM app_artifact_publications WHERE job_key=?',[publicationJob.business_key]);assert.equal(plannedObject.state,'planned');assert.ok(await runtime.bucket.get(plannedObject.object_key));
  await wakeHeld(runtime,publicationJob,await crypto.sha256(utf8('synthetic put reconciled')));
  for(let n=0;n<8;n++){await runtime.call({method:'tick',fault:'before-catalog'});publicationJob=await one(runtime,'SELECT * FROM app_jobs WHERE id=?',[publicationJob.id]);if(publicationJob.state==='held')break;}
  assert.equal(publicationJob.state,'held');assert.equal(publicationJob.reason,'publication-outcome-unknown');assert.equal(runtime.lastMeasurements.faultInjected,true);assert.equal((await one(runtime,'SELECT COUNT(*) n FROM manifest_catalog')).n,0);
  await wakeHeld(runtime,publicationJob,await crypto.sha256(utf8('synthetic catalog transport restored')));
  for(let n=0;n<8;n++){await runtime.call({method:'tick'});if((await one(runtime,'SELECT * FROM app_jobs WHERE id=?',[publicationJob.id])).state==='completed')break;}
  assert.equal((await one(runtime,'SELECT COUNT(*) n FROM manifest_catalog')).n,1);
  await setNow(fixture.activation+2*HOSTED_DAY+35*60000+1000);
  demand(await runtime.call({method:'schedule'}),'scheduled');demand(await mirror.context.scheduler.scheduleCampaigns(),'scheduled');
  for(let n=0;n<35;n++){await runtime.call({method:'tick'});await mirror.context.tick();}
  const allocations=await rows(runtime,'SELECT * FROM earn_allocations WHERE epoch=? ORDER BY token_id,day',[epoch]);assert.equal(allocations.length,2);
  assert.deepEqual(allocations.map(r=>JSON.parse(canonicalJson(r))),mirror.db.prepare('SELECT * FROM earn_allocations WHERE epoch=? ORDER BY token_id,day').all(epoch).map(r=>JSON.parse(canonicalJson(r))));
  assert.equal(allocations[1].starts_ms-allocations[0].starts_ms,35*60000);
  const awards=await rows(runtime,'SELECT * FROM earn_awards WHERE token_id IN (?,?) AND day=3 ORDER BY token_id,wallet',['hosted-a','hosted-b']);
  assert.deepEqual(awards.map(r=>JSON.parse(canonicalJson(r))),mirror.db.prepare('SELECT * FROM earn_awards WHERE day=3 ORDER BY token_id,wallet').all().map(r=>JSON.parse(canonicalJson(r))));
  // A separately evidenced empty board proves day-one burn; absence is never emptiness.
  const bootstrapEpoch=epoch-2,bootstrap=await buildHostedEvidence(runtime,{epoch:bootstrapEpoch,historyStartMs:bootstrapEpoch*HOSTED_DAY,prefix:'hosted-empty-bootstrap'});
  demand(await runtime.call({method:'seal',query:bootstrap}),'committed');
  for(let n=0;n<25;n++)await runtime.call({method:'tick'});
  const bootstrapBoard=await one(runtime,'SELECT winners FROM earn_boards WHERE epoch=?',[bootstrapEpoch]);assert.deepEqual(JSON.parse(bootstrapBoard.winners),[]);
  const burns=await rows(runtime,'SELECT * FROM earn_allocations WHERE day=1 ORDER BY token_id');assert.equal(burns.length,2);assert.ok(burns.every(a=>a.burn===a.budget));
  const before=canonicalJson(burns);demand(await runtime.call({method:'seal',query:bootstrap}),'final');assert.equal(canonicalJson(await rows(runtime,'SELECT * FROM earn_allocations WHERE day=1 ORDER BY token_id')),before);
  const catalog=await rows(runtime,'SELECT * FROM manifest_catalog ORDER BY byte_digest');assert.ok(catalog.length>=3);
  const commitments=[];
  for(const object of catalog){const response=await fetch(runtime.origin+'/api/v1/manifests/'+object.byte_digest);assert.equal(response.status,200);const bytes=new Uint8Array(await response.arrayBuffer()),bundle=JSON.parse(new TextDecoder().decode(bytes));
   const verified=await codec.verify(bytes,{semanticDigest:bundle.sha256,byteDigest:object.byte_digest});commitments.push({byteDigest:object.byte_digest,semanticDigest:verified.semanticDigest,epoch:verified.manifest.board.epoch});
   assert.ok(!new TextDecoder().decode(bytes).includes('example.test'));assert.ok(!new TextDecoder().decode(bytes).includes('Synthetic human moderation'));
  }
  const businessKey='synthetic-core-recovery-pending';demand(await runtime.call({method:'enqueue',input:{businessKey,sourceKey:businessKey,type:'reconcile-publication',payload:{fixture:'synthetic-pending-recovery'},readyMs:nowMs,maxAttempts:5}}),'committed');
  const pending=await runtime.call({method:'acquire'});demand(pending,'acquired');assert.equal(pending.job.businessKey,businessKey);
  const recovery=await rehearseIntegratedRecovery({source:runtime,createFreshRuntime:createHostedRuntime,schema,sourceCommit,pinDirectory:resolve('work/b20-independent-pins'),account:accounts[1],principal,lease:pending.job.lease});
  return {classification:'complete synthetic local transcript',runtime:'workerd-local',submissions:submissions.length,winners:winners.length,allocationWindows:allocations.map(a=>({tokenId:a.token_id,day:a.day,startsMs:a.starts_ms,vestsFromMs:a.vests_from_ms,vestsThroughMs:a.vests_through_ms})),bootstrapBurns:burns.length,commitments,recovery,
   faults:['missing-required-evidence','mid-private-read','after-lease-acquisition','after-public-put','before-catalog-commit'],nodeD1Parity:true,financialExecution:false,providerCalls:0,elapsedMs:Math.round(performance.now()-began),measurements:runtime.measurements};
 }finally{mirror?.close();}
}
