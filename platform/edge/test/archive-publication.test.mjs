import test from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from './local-runtime.mjs';
import {cutoffScenario} from '../../application/fixtures/cutoff-scenario.mjs';
import {createJobRepository} from '../../jobs/repository.mjs';
import {createJobCommand} from '../../jobs/model.mjs';
import {reconcileJobOutbox} from '../../jobs/outbox.mjs';
import {createSettlementPreparationRepository} from '../../storage/settlement-preparation.mjs';
import {createEarnSettlementService} from '../../earn/settlement-service.mjs';
import {createPublicationRepository} from '../../storage/publication.mjs';
import {createManifestCodec} from '../../artifacts/manifest-codec.mjs';
import {COMMIT_ALLOCATION,settlementFenceKey} from '../../storage/atomic-settlement.mjs';
const tables=['app_operator_scopes','earn_fixture_campaigns','earn_boards','earn_allocations','earn_awards','app_job_outbox'];
async function source(t){
 const e=await cutoffScenario({beforeFreeze({db}){for(const scope of ['jobs-runner','earn-publication'])db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run('synthetic-snapshot',scope);}});t.after(()=>e.db.close());
 assert.equal((await e.service.assemble(e.principal,e.query)).kind,'committed');const jobs=createJobRepository(e.driver,{...e.ports,principal:e.principal});
 await reconcileJobOutbox(e.driver,jobs);const boardJob=(await jobs.acquireJob()).job;
 const settlement=createEarnSettlementService({repository:createSettlementPreparationRepository(e.driver,e.ports),artifacts:e.store,...e.ports});
 const prepared=await settlement.prepareBoard(e.principal,{epoch:e.epoch,requestKey:boardJob.id});assert.equal((await e.settlementRepository.commitBoard(prepared.command,boardJob.lease)).kind,'committed');
 await jobs.finish(boardJob.lease,{state:'completed',result:{synthetic:true}});
 const rows=()=>Object.fromEntries(tables.map(table=>[table,e.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()
  .filter(row=>table!=='app_job_outbox'||JSON.parse(row.command_json).input.type==='publish-archive').map(row=>table==='app_job_outbox'?{...row,job_id:null}:row)]));
 const initial=rows(),codec=createManifestCodec({crypto:e.crypto}),repository=createPublicationRepository(e.driver,e.ports);
 const old=await codec.build((await repository.loadSource({epoch:e.epoch})).source);
 const input={tokenId:'A',day:2},businessKey=settlementFenceKey(COMMIT_ALLOCATION,input);
 await jobs.enqueue(await createJobCommand({principal:e.principal,requestKey:businessKey,nowMs:e.clock.nowMs(),input:{businessKey,sourceKey:businessKey,type:'allocate-token-day',payload:{principal:e.principal,...input},readyMs:e.clock.nowMs(),maxAttempts:5}},e.crypto));
 const allocationJob=(await jobs.acquireJob()).job,allocation=await settlement.prepareAllocation(e.principal,{...input,requestKey:allocationJob.id});
 assert.equal((await e.settlementRepository.commitAllocation(allocation.command,allocationJob.lease)).kind,'committed');
 await jobs.finish(allocationJob.lease,{state:'completed',result:{synthetic:true}});
 return {initial,expanded:rows(),old,newer:await codec.build((await repository.loadSource({epoch:e.epoch})).source),codec,principal:e.principal,nowMs:e.clock.nowMs()};
}
async function seed(db,rows){
 for(const table of tables){const statements=rows[table].map(row=>{const columns=Object.keys(row);return db.prepare('INSERT OR IGNORE INTO '+table+' ('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').bind(...Object.values(row));});
  if(statements.length)await db.batch(statements);
 }
}
async function runtime(t,s){
 const {mf,db}=await localRuntime(t,new URL('./fixtures/publication-worker.ts',import.meta.url));await seed(db,s.initial);let nowMs=s.nowMs;
 const call=async(method,extra={})=>{const response=await mf.dispatchFetch('http://localhost/__fixture/publication',{method:'POST',body:JSON.stringify({method,principal:s.principal,nowMs,...extra})});const value=await response.json();return {status:response.status,...value};};
 const ok=async(method,extra={})=>{const value=await call(method,extra);assert.equal(value.status,200,JSON.stringify(value));return value.result;};
 await ok('drain');const acquired=await ok('acquire');assert.equal(acquired.kind,'acquired');assert.equal(acquired.job.type,'publish-archive');
 return {mf,db,call,ok,job:acquired.job,bucket:await mf.getR2Bucket('MANIFESTS'),advance:ms=>nowMs+=ms,
  count:table=>db.prepare('SELECT COUNT(*) n FROM '+table).first('n'),run:(job=acquired.job,fault)=>call('run',{job,lease:job.lease,...(fault?{fault}:{})})};
}

test('actual D1/R2 publication resumes a lost put, serves exact byte-addressed bundles and retains older versions after allocation expansion',async t=>{
 const s=await source(t),r=await runtime(t,s),unknown=await r.run(r.job,'lost-put');assert.equal(unknown.result.reason,'publication-write-unknown');assert.equal(await r.count('manifest_catalog'),0);
 assert.equal((await r.mf.dispatchFetch('http://localhost/api/v1/manifests/'+s.old.byteDigest)).status,404);
 const first=(await r.run()).result;assert.equal(first.kind,'published');assert.deepEqual(first.publication.identity,s.old.identity);
 const get=await r.mf.dispatchFetch('http://localhost/api/v1/manifests/'+s.old.byteDigest);assert.equal(get.status,200);assert.deepEqual(new Uint8Array(await get.arrayBuffer()),s.old.bytes);
 assert.equal((await r.mf.dispatchFetch('http://localhost/api/v1/manifests/'+s.old.semanticDigest)).status,404);
 assert.deepEqual((await r.run()).result,first);await r.ok('finish',{lease:r.job.lease,outcome:{state:'completed',result:{publication:first.publication.id}}});
 await seed(r.db,s.expanded);await r.ok('drain');const newerJob=(await r.ok('acquire')).job;
 const second=(await r.run(newerJob)).result;assert.equal(second.kind,'published');assert.deepEqual(second.publication.identity,s.newer.identity);assert.equal(await r.count('manifest_catalog'),2);
 const newerGet=await r.mf.dispatchFetch('http://localhost/api/v1/manifests/'+s.newer.byteDigest),bytes=new Uint8Array(await newerGet.arrayBuffer());assert.equal(newerGet.status,200);assert.deepEqual(bytes,s.newer.bytes);
 const verified=await s.codec.verify(bytes,{semanticDigest:s.newer.semanticDigest,byteDigest:s.newer.byteDigest}),allocation=verified.manifest.allocations[0];
 const proof=await s.codec.proof(allocation,allocation.awards[0].wallet);assert.equal(await s.codec.verifyProof(proof,allocation.awardRoot),true);
 assert.equal((await r.mf.dispatchFetch('http://localhost/api/v1/manifests/'+s.old.byteDigest)).status,200);
 await r.bucket.delete(s.newer.identity.key);assert.equal((await r.mf.dispatchFetch('http://localhost/api/v1/manifests/'+s.newer.byteDigest)).status,503);
 assert.equal((await r.run(newerJob)).result.reason,'published-object-missing');assert.equal(await r.count('manifest_catalog'),2);
 const corrupt=new Uint8Array(s.newer.bytes);corrupt[0]^=1;await r.bucket.put(s.newer.identity.key,corrupt,{httpMetadata:{contentType:'application/json'}});
 const broken=await r.mf.dispatchFetch('http://localhost/api/v1/manifests/'+s.newer.byteDigest);assert.equal(broken.status,503);assert.ok(!(await broken.text()).includes('wallet'));
 assert.equal((await r.run(newerJob)).result.reason,'published-object-conflict');assert.equal(await r.count('earn_awards'),1);
});

test('actual D1/R2 publication faults preserve atomic catalog visibility and exact resumable plans',async t=>{
 const s=await source(t);
 for(const fault of ['before-put','readback','omit-catalog','omit-state','lost-catalog','expired-lease','conflict'])await t.test(fault,async sub=>{
  const r=await runtime(sub,s),result=await r.run(r.job,fault);
  if(['readback','omit-catalog','omit-state'].includes(fault))assert.equal(result.status,500);else assert.equal(result.status,200);
  const p=await r.ok('read',{jobKey:r.job.businessKey});assert.ok(p);
  if(fault==='lost-catalog'){assert.equal(result.result.kind,'published');assert.equal(await r.count('manifest_catalog'),1);}
  else{
   assert.equal(await r.count('manifest_catalog'),0);
   if(fault==='conflict'){assert.equal(p.state,'held');assert.equal(result.result.reason,'publication-object-conflict');assert.equal((await r.run()).result.reason,'publication-object-conflict');return;}
   assert.equal(p.state,'planned');let current=r.job;
   if(fault==='expired-lease'){assert.equal(result.result.kind,'conflict');r.advance(30001);current=(await r.ok('acquire')).job;assert.equal(current.id,r.job.id);assert.notEqual(current.lease.token,r.job.lease.token);}
   const resumed=await r.run(current);assert.equal(resumed.status,200);assert.equal(resumed.result.kind,'published');assert.deepEqual(resumed.result.publication.identity,p.identity);
   assert.equal(await r.count('manifest_catalog'),1);
  }
  assert.equal(await r.count('app_artifact_publications'),1);
 });
});
