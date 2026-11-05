import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cutoffScenario} from '../application/fixtures/cutoff-scenario.mjs';
import {nodeArtifactStore} from './node.mjs';
import {createManifestCodec} from './manifest-codec.mjs';
import {createPublicationService} from './publication.mjs';
import {createPublicationHandler} from '../jobs/publication-handler.mjs';
import {createPublicationRepository,createPublicationCommand,PLAN_PUBLICATION,PUBLISH_PUBLICATION} from '../storage/publication.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {createSettlementPreparationRepository} from '../storage/settlement-preparation.mjs';
import {createEarnSettlementService} from '../earn/settlement-service.mjs';
import {createJobRepository} from '../jobs/repository.mjs';
import {createJobCommand} from '../jobs/model.mjs';
import {reconcileJobOutbox} from '../jobs/outbox.mjs';
import {COMMIT_ALLOCATION,settlementFenceKey} from '../storage/atomic-settlement.mjs';

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'10x-publication-')),store=nodeArtifactStore(root);
 const env=await cutoffScenario({store,beforeFreeze({db}){for(const scope of ['jobs-runner','earn-publication'])db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run('synthetic-snapshot',scope);}});
 t.after(async()=>{env.db.close();await rm(root,{recursive:true,force:true});});
 assert.equal((await env.service.assemble(env.principal,env.query)).kind,'committed');
 const jobs=createJobRepository(env.driver,{...env.ports,principal:env.principal});await reconcileJobOutbox(env.driver,jobs);
 const boardJob=(await jobs.acquireJob()).job,settlement=createEarnSettlementService({repository:createSettlementPreparationRepository(env.driver,env.ports),artifacts:store,...env.ports});
 assert.equal(boardJob.type,'finalize-board');const prepared=await settlement.prepareBoard(env.principal,{epoch:env.epoch,requestKey:boardJob.id});
 assert.equal((await env.settlementRepository.commitBoard(prepared.command,boardJob.lease)).kind,'committed');
 await jobs.finish(boardJob.lease,{state:'completed',result:{synthetic:true}});await reconcileJobOutbox(env.driver,jobs);
 const job=(await jobs.acquireJob()).job;assert.equal(job.type,'publish-archive');
 const codec=createManifestCodec({crypto:env.crypto}),repository=createPublicationRepository(env.driver,env.ports);
 const make=({driver=env.driver,...options}={})=>createPublicationService({repository:createPublicationRepository(driver,env.ports),store,
  privateReferences:env.privateReferences,codec,...env.ports,principal:env.principal,...options});
 const run=(service=make(),current=job)=>service.run({job:current,lease:current.lease,signal:new AbortController().signal});
 const count=table=>env.db.prepare('SELECT COUNT(*) n FROM '+table).get().n;
 return {...env,root,store,jobs,job,settlement,codec,repository,make,run,count};
}

test('publication persists exact source identity and canonical bytes, publishes once and verifies immutable replay',async t=>{
 const e=await fixture(t),result=await e.run();assert.equal(result.kind,'published',JSON.stringify(result));
 const p=result.publication;assert.equal(p.state,'published');assert.equal(e.count('manifest_catalog'),1);assert.equal(e.count('app_artifact_publications'),1);
 const bytes=new Uint8Array(await readFile(join(e.root,p.identity.key))),verified=await e.codec.verify(bytes,{semanticDigest:p.identity.semanticDigest,byteDigest:p.identity.byteDigest});
 assert.equal(verified.manifest.board.snapshotId,e.db.prepare('SELECT snapshot_hash FROM earn_boards').get().snapshot_hash);
 assert.ok(!new TextDecoder().decode(bytes).includes('synthetic review'));assert.equal(verified.manifest.allocations.length,0);
 assert.deepEqual(await e.run(),result);assert.equal(e.count('manifest_catalog'),1);
 assert.throws(()=>e.db.exec('DELETE FROM manifest_catalog'),/Retain published/);
});

test('before-put and lost-put interruptions retain one exact plan and resume the same immutable public object',async t=>{
 for(const fault of ['before','after']){
  const e=await fixture(t);let fired=false;
  const store={...e.store,async putIfAbsent(identity,bytes){if(identity.visibility==='public'&&!fired){fired=true;if(fault==='after')await e.store.putIfAbsent(identity,bytes);return {status:'unknown',identity};}return e.store.putIfAbsent(identity,bytes);}};
  const result=await e.run(e.make({store}));assert.equal(result.reason,'publication-write-unknown');assert.equal(e.count('manifest_catalog'),0);
  const plan=await e.repository.readJob(e.job.businessKey);assert.equal(plan.state,'planned');
  assert.equal((await e.store.getVerified(plan.identity)).status,fault==='before'?'missing':'verified');
  const resumed=await e.run();assert.equal(resumed.kind,'published');assert.equal(resumed.publication.identity.byteDigest,plan.identity.byteDigest);
  assert.equal(e.count('app_artifact_publications'),1);assert.equal(e.count('manifest_catalog'),1);
 }
});

test('readback transport interruption leaves an unlisted object and recovery rechecks bytes before publishing',async t=>{
 const e=await fixture(t);let interrupted=false;
 const store={...e.store,async getVerified(identity){if(identity.visibility==='public'&&!interrupted){interrupted=true;throw Error('Synthetic public readback interruption');}return e.store.getVerified(identity);}};
 await assert.rejects(e.run(e.make({store})),/readback interruption/);assert.equal(e.count('manifest_catalog'),0);
 const planned=await e.repository.readJob(e.job.businessKey);assert.equal(planned.state,'planned');assert.equal((await e.store.getVerified(planned.identity)).status,'verified');
 assert.equal((await e.run()).kind,'published');
});

test('catalog interruption and omitted final publication child roll back visibility; committed response loss reconciles',async t=>{
 for(const fault of ['before','omit-catalog','omit-state','after']){
  const e=await fixture(t);let fired=false;
  const driver={...e.driver,async batch(statements){const publish=statements.some(s=>s.sql.startsWith('INSERT INTO manifest_catalog'));
   if(publish&&!fired){fired=true;if(fault==='before')throw Error('Synthetic catalog interruption');
    const filtered=fault==='omit-catalog'?statements.filter(s=>!s.sql.startsWith('INSERT INTO manifest_catalog')):
     fault==='omit-state'?statements.filter(s=>!s.sql.startsWith('UPDATE app_artifact_publications SET state=\'published\'')):statements;
    const result=await e.driver.batch(filtered);if(fault==='after')throw Error('Synthetic committed publication acknowledgement lost');return result;
   }return e.driver.batch(statements);
  }};
  if(fault==='after')assert.equal((await e.run(e.make({driver}))).kind,'published');
  else{
   await assert.rejects(e.run(e.make({driver})),fault==='before'?/catalog interruption/:/Missing verified public catalog/);
   assert.equal(e.count('manifest_catalog'),0);assert.equal((await e.repository.readJob(e.job.businessKey)).state,'planned');
   assert.equal((await e.run()).kind,'published');
  }
  assert.equal(e.count('manifest_catalog'),1);assert.equal(e.count('app_artifact_publications'),1);
 }
});

test('conflicting immutable public bytes hold publication and never overwrite the target',async t=>{
 const e=await fixture(t);let corrupt;
 const store={...e.store,async putIfAbsent(identity,bytes){
  if(identity.visibility==='public'&&!corrupt){await e.store.getVerified(identity);corrupt=new Uint8Array(bytes);corrupt[0]^=1;await writeFile(join(e.root,identity.key),corrupt);}
  return e.store.putIfAbsent(identity,bytes);
 }};
 const result=await e.run(e.make({store}));assert.equal(result.reason,'publication-object-conflict');
 const plan=await e.repository.readJob(e.job.businessKey);assert.equal(plan.state,'held');assert.equal(e.count('manifest_catalog'),0);
 assert.deepEqual(new Uint8Array(await readFile(join(e.root,plan.identity.key))),corrupt);assert.equal((await e.run()).reason,'publication-object-conflict');
});

test('expired worker may leave verified unlisted bytes but cannot publish; replacement lease resumes the exact plan',async t=>{
 const e=await fixture(t);let expired=false;
 const store={...e.store,async putIfAbsent(identity,bytes){const result=await e.store.putIfAbsent(identity,bytes);if(identity.visibility==='public'&&!expired){expired=true;e.advance(30001);}return result;}};
 const result=await e.run(e.make({store}));assert.equal(result.kind,'conflict');assert.equal(e.count('manifest_catalog'),0);
 const plan=await e.repository.readJob(e.job.businessKey);assert.equal(plan.state,'planned');
 const replacement=(await e.jobs.acquireJob()).job;assert.equal(replacement.id,e.job.id);assert.notEqual(replacement.lease.token,e.job.lease.token);
 const resumed=await e.run(e.make(),replacement);assert.equal(resumed.kind,'published');assert.deepEqual(resumed.publication.identity,plan.identity);
});

test('a real unrelated job lease cannot authorize another publication even when its payload bytes match',async t=>{
 const e=await fixture(t),businessKey='synthetic-unrelated-publication';
 await e.jobs.enqueue(await createJobCommand({principal:e.principal,requestKey:businessKey,nowMs:e.clock.nowMs(),input:{businessKey,sourceKey:businessKey,type:'publish-archive',
  payload:e.job.payload,readyMs:e.clock.nowMs(),maxAttempts:5}},e.crypto));
 const unrelated=(await e.jobs.acquireJob()).job;assert.equal(unrelated.businessKey,businessKey);assert.equal(unrelated.payloadDigest,e.job.payloadDigest);
 const forgedLease={...unrelated.lease,businessKey:e.job.businessKey};
 const result=await e.make().run({job:e.job,lease:forgedLease,signal:new AbortController().signal});
 assert.equal(result.reason,'publication-job-binding');assert.equal(e.count('app_artifact_publications'),0);assert.equal(e.count('manifest_catalog'),0);
 const pausedStore={...e.store,async putIfAbsent(identity,bytes){return identity.visibility==='public'?{status:'unknown',identity}:e.store.putIfAbsent(identity,bytes);}};
 assert.equal((await e.run(e.make({store:pausedStore}))).reason,'publication-write-unknown');
 const plan=await e.repository.readJob(e.job.businessKey),command=await createPublicationCommand(PUBLISH_PUBLICATION,{principal:e.principal,requestKey:plan.id,nowMs:e.clock.nowMs(),input:{id:plan.id,verifiedIdentity:plan.identity}},e.crypto);
 assert.equal((await e.repository.publish(command,forgedLease)).kind,'conflict');assert.equal(e.count('manifest_catalog'),0);assert.equal((await e.repository.get(plan.id)).state,'planned');
 assert.equal((await e.run()).kind,'published');
});

test('a directly staged valid bundle cannot substitute different winners for its recorded SQL source',async t=>{
 const e=await fixture(t),loaded=await e.repository.loadSource({epoch:e.epoch});
 const changed={...loaded.source,board:{...loaded.source.board,winners:loaded.source.board.winners.map(w=>({...w,wallet:'synthetic-other-wallet',userId:'synthetic-other-wallet'}))}};
 const built=await e.codec.build(changed),staging=[];
 for(let offset=0;offset<built.bytes.length;offset+=128*1024){
  const bytes=built.bytes.slice(offset,offset+128*1024),byteDigest=await e.crypto.sha256(bytes),identity={key:'private/'+byteDigest+'.bin',byteDigest,size:bytes.length,semanticDigest:null,visibility:'private',contentType:'application/octet-stream'};
  assert.equal((await e.privateReferences.persist(e.principal,{identity,bytes,requestKey:byteDigest})).kind,'committed');staging.push(identity);
 }
 const id=await e.crypto.sha256(utf8(canonicalJson(['earn-publication-v1',e.job.businessKey]))),command=await createPublicationCommand(PLAN_PUBLICATION,{principal:e.principal,requestKey:e.job.businessKey,
  nowMs:e.clock.nowMs(),expectedRevisions:loaded.versions,input:{id,jobKey:e.job.businessKey,epoch:e.epoch,identity:built.identity,sourceDigest:loaded.sourceDigest,selectionsJson:canonicalJson(loaded.selections),stagingJson:canonicalJson(staging)}},e.crypto);
 assert.equal((await e.repository.plan(command,e.job.lease)).kind,'committed');
 const result=await e.run();assert.equal(result.kind,'pending');assert.match(result.reason,/source|identity/);
 assert.equal((await e.repository.get(id)).state,'held');assert.equal((await e.store.getVerified(built.identity)).status,'missing');assert.equal(e.count('manifest_catalog'),0);
});

test('publication reuses exact private staging registered by another scoped operator',async t=>{
 const e=await fixture(t),other={kind:'operator',id:'synthetic-other-stager'};e.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(other.id,'evidence-ingest');
 const loaded=await e.repository.loadSource({epoch:e.epoch}),built=await e.codec.build(loaded.source);assert.ok(built.bytes.length<128*1024);
 const byteDigest=await e.crypto.sha256(built.bytes),identity={key:'private/'+byteDigest+'.bin',byteDigest,size:built.bytes.length,semanticDigest:null,visibility:'private',contentType:'application/octet-stream'};
 assert.equal((await e.privateReferences.persist(other,{identity,bytes:built.bytes,requestKey:byteDigest})).kind,'committed');
 assert.equal((await e.run()).kind,'published');assert.equal(e.count('manifest_catalog'),1);
});

test('a valid directly staged board-only plan cannot satisfy a job requiring its committed allocation',async t=>{
 const e=await fixture(t);await e.jobs.finish(e.job.lease,{state:'completed',result:{synthetic:true}});
 const input={tokenId:'A',day:2},businessKey=settlementFenceKey(COMMIT_ALLOCATION,input);
 await e.jobs.enqueue(await createJobCommand({principal:e.principal,requestKey:businessKey,nowMs:e.clock.nowMs(),input:{businessKey,sourceKey:businessKey,type:'allocate-token-day',payload:{principal:e.principal,...input},readyMs:e.clock.nowMs(),maxAttempts:5}},e.crypto));
 const allocationJob=(await e.jobs.acquireJob()).job,prepared=await e.settlement.prepareAllocation(e.principal,{...input,requestKey:allocationJob.id});
 assert.equal((await e.settlementRepository.commitAllocation(prepared.command,allocationJob.lease)).kind,'committed');await e.jobs.finish(allocationJob.lease,{state:'completed',result:{synthetic:true}});
 await reconcileJobOutbox(e.driver,e.jobs);const job=(await e.jobs.acquireJob()).job;assert.equal(job.payload.tokenId,'A');
 const loaded=await e.repository.loadSource({epoch:e.epoch,selections:[]}),built=await e.codec.build(loaded.source);assert.equal(built.manifest.allocations.length,0);
 const byteDigest=await e.crypto.sha256(built.bytes),identity={key:'private/'+byteDigest+'.bin',byteDigest,size:built.bytes.length,semanticDigest:null,visibility:'private',contentType:'application/octet-stream'};
 assert.equal((await e.privateReferences.persist(e.principal,{identity,bytes:built.bytes,requestKey:byteDigest})).kind,'committed');
 const id=await e.crypto.sha256(utf8(canonicalJson(['earn-publication-v1',job.businessKey]))),command=await createPublicationCommand(PLAN_PUBLICATION,{principal:e.principal,requestKey:job.businessKey,
  nowMs:e.clock.nowMs(),expectedRevisions:loaded.versions,input:{id,jobKey:job.businessKey,epoch:e.epoch,identity:built.identity,sourceDigest:loaded.sourceDigest,selectionsJson:'[]',stagingJson:canonicalJson([identity])}},e.crypto);
 assert.equal((await e.repository.plan(command,job.lease)).kind,'committed');
 const result=await e.run(e.make(),job);assert.equal(result.kind,'pending');assert.match(result.reason,/allocation/);
 assert.equal((await e.repository.get(id)).state,'held');assert.equal((await e.store.getVerified(built.identity)).status,'missing');assert.equal(e.count('manifest_catalog'),0);
});

test('published object disappearance or corruption is reported without rewriting the immutable catalog or awards',async t=>{
 const e=await fixture(t),first=await e.run(),p=first.publication,path=join(e.root,p.identity.key),bytes=await readFile(path),board=e.db.prepare('SELECT * FROM earn_boards').get();
 await unlink(path);assert.equal((await e.run()).reason,'published-object-missing');assert.equal(e.count('manifest_catalog'),1);
 await writeFile(path,bytes);const corrupt=new Uint8Array(bytes);corrupt[0]^=1;await writeFile(path,corrupt);
 assert.equal((await e.run()).reason,'published-object-conflict');assert.equal((await e.repository.get(p.id)).state,'published');
 assert.deepEqual(e.db.prepare('SELECT * FROM earn_boards').get(),board);
});

test('later allocation expands a new public bundle while older published bytes and identity remain retained',async t=>{
 const e=await fixture(t),first=await e.run(),oldBytes=await readFile(join(e.root,first.publication.identity.key));
 await e.jobs.finish(e.job.lease,{state:'completed',result:{publication:first.publication.id}});
 const identity={tokenId:'A',day:2},businessKey=settlementFenceKey(COMMIT_ALLOCATION,identity);
 await e.jobs.enqueue(await createJobCommand({principal:e.principal,requestKey:businessKey,nowMs:e.clock.nowMs(),input:{businessKey,sourceKey:businessKey,type:'allocate-token-day',payload:{principal:e.principal,...identity},readyMs:e.clock.nowMs(),maxAttempts:5}},e.crypto));
 const allocationJob=(await e.jobs.acquireJob()).job,prepared=await e.settlement.prepareAllocation(e.principal,{...identity,requestKey:allocationJob.id});assert.equal(prepared.kind,'prepared');
 assert.equal((await e.settlementRepository.commitAllocation(prepared.command,allocationJob.lease)).kind,'committed');await e.jobs.finish(allocationJob.lease,{state:'completed',result:{synthetic:true}});
 await reconcileJobOutbox(e.driver,e.jobs);const newerJob=(await e.jobs.acquireJob()).job;assert.equal(newerJob.type,'publish-archive');
 const second=await e.run(e.make(),newerJob);assert.equal(second.kind,'published');assert.notEqual(second.publication.identity.byteDigest,first.publication.identity.byteDigest);
 assert.equal(e.count('manifest_catalog'),2);assert.equal(e.count('app_artifact_publications'),2);assert.deepEqual(await readFile(join(e.root,first.publication.identity.key)),oldBytes);
 const newer=await e.store.getVerified(second.publication.identity),verified=await e.codec.verify(newer.bytes,{semanticDigest:second.publication.identity.semanticDigest});
 assert.equal(verified.manifest.allocations.length,1);assert.deepEqual(await e.run(),first,'older job replay retains its original smaller bundle');
});


test('publication runner holds an unknown readback and wakes the same immutable plan under a replacement lease',async t=>{
 const e=await fixture(t),abort=new AbortController();let interrupted=false;
 const store={...e.store,async getVerified(identity){if(identity.visibility==='public'&&!interrupted){interrupted=true;throw Error('Synthetic readback loss');}return e.store.getVerified(identity);}};
 const context=job=>({job,lease:job.lease,signal:abort.signal,checkpoint:value=>e.jobs.checkpoint(job.lease,{sequence:job.checkpointSeq,value})});
 const held=await createPublicationHandler(e.make({store}))(context(e.job));
 assert.equal(held.dependency,'publication-reconciliation');assert.equal(held.reason,'publication-outcome-unknown');
 assert.equal((await e.jobs.finish(e.job.lease,held)).kind,'finished');
 const plan=await e.repository.readJob(e.job.businessKey);assert.equal(plan.state,'planned');assert.equal(e.count('manifest_catalog'),0);
 assert.equal((await e.jobs.wake({jobId:e.job.id,dependency:held.dependency,evidenceDigest:plan.identity.byteDigest})).kind,'woken');
 const replacement=(await e.jobs.acquireJob()).job;assert.notEqual(replacement.lease.revision,e.job.lease.revision);
 const result=await createPublicationHandler(e.make())(context(replacement));assert.equal(result.state,'completed');
 assert.equal((await e.jobs.finish(replacement.lease,result)).kind,'finished');
 assert.equal(e.count('manifest_catalog'),1);assert.equal(e.count('app_artifact_publications'),1);
 assert.equal((await e.repository.get(plan.id)).identity.byteDigest,plan.identity.byteDigest);
});
