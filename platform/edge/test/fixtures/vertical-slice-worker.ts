// Private synthetic B20 harness. The loopback dispatcher never forwards this control path.
import worker from '../../src/worker';
import {createWorkerEarnService} from '../../src/earn';
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {r2ArtifactStore} from '../../../artifacts/r2';
import {createLocalSettlementContext} from '../../../application/settlement-context.mjs';
import {createCutoffSnapshotRepository} from '../../../storage/cutoff-snapshot.mjs';
import {createFreezeCommand,createCutoffFreezeRepository} from '../../../storage/cutoff-freeze.mjs';
import {createArtifactReferenceRepository} from '../../../storage/atomic-artifacts.mjs';
import {createEvidenceRepository} from '../../../evidence/repository.mjs';
import {createEvidenceService} from '../../../evidence/service.mjs';
import {evidenceFixture} from '../../../evidence/fixtures.mjs';
import {reconcileJobOutbox} from '../../../jobs/outbox.mjs';
import {createSnapshotHandler} from '../../../jobs/snapshot-handler.mjs';
import {createJobCommand} from '../../../jobs/model.mjs';
import {createCutoffSnapshotService} from '../../../earn/snapshot.mjs';
import {createPrivateReferenceService} from '../../../artifacts/reference-service.mjs';
import {canonicalJson} from '../../../security/canonical.mjs';
import {handleRecoveryControl} from './recovery-control';
let fixtureNow=Date.now();Date.now=()=>fixtureNow;
const principal={kind:'operator' as const,id:'synthetic-hosted-operator'};
export default {async fetch(request:Request,env:Env,ctx:ExecutionContext){
 if(new URL(request.url).pathname!=='/__fixture')return worker.fetch(request,env,ctx);
 if(request.method!=='POST'||new URL(request.url).hostname!=='localhost')return new Response('Unavailable',{status:404});
 try{
  const body=await request.json() as any;
  if(body.nowMs!==undefined){if(!Number.isSafeInteger(body.nowMs)||body.nowMs<0)throw Error('Invalid fixture clock');fixtureNow=body.nowMs;}
  const cryptoPort=createWebCrypto(),raw=createD1AtomicDriver(env.DB),baseStore=r2ArtifactStore(env.MANIFESTS);let fired=false;
  const measurements={sqlStatements:0,batches:0,objectReads:0,objectWrites:0,faultInjected:false};
  const driver={...raw,leaseNowSql:String(fixtureNow),async batch(statements:Parameters<typeof raw.batch>[0]){
   measurements.sqlStatements+=statements.length;measurements.batches++;
   if(!fired&&body.fault==='before-catalog'&&statements.some(s=>s.sql.startsWith('INSERT INTO manifest_catalog'))){fired=true;measurements.faultInjected=true;throw Error('Synthetic interruption before catalog');}
   return raw.batch(statements);
  }};
  const artifacts={async getVerified(identity:Parameters<typeof baseStore.getVerified>[0]){
   measurements.objectReads++;
   if(!fired&&body.fault==='mid-read'&&identity.visibility==='private'){fired=true;measurements.faultInjected=true;throw Error('Synthetic interrupted private read');}
   return baseStore.getVerified(identity);
  },async putIfAbsent(identity:Parameters<typeof baseStore.putIfAbsent>[0],bytes:Uint8Array){
   measurements.objectWrites++;const result=await baseStore.putIfAbsent(identity,bytes);
   if(!fired&&body.fault==='after-put'&&identity.visibility==='public'){fired=true;measurements.faultInjected=true;return {status:'unknown' as const,identity};}return result;
  }};
  const ports={driver,artifacts,crypto:cryptoPort,clock:{nowMs:()=>fixtureNow},ids:{next:()=>crypto.randomUUID()}},context=createLocalSettlementContext({...ports,principal});
  let result:any;
  if(body.method==='set-clock')result={nowMs:fixtureNow};
  else if(body.method==='review')result=await createWorkerEarnService(env.DB,fixtureNow).recordFinalReview(principal,body.input);
  else if(body.method==='freeze')result=await createCutoffFreezeRepository(driver,ports).freezeEpoch(await createFreezeCommand({principal,epoch:body.epoch,nowMs:fixtureNow},cryptoPort));
  else if(body.method==='inventory')result=await createCutoffSnapshotRepository(driver,ports).loadInventory({...body.query,nowMs:fixtureNow});
  else if(body.method==='ingest'){
   const f=await evidenceFixture({...body.fixture,crypto:cryptoPort,records:body.fixture.records.map((r:any)=>({...r,bytes:new Uint8Array(r.bytes)}))});
   f.source.sourceId=body.sourceId;f.request.sourceId=body.sourceId;
   const service=createEvidenceService({...ports,repository:createEvidenceRepository(driver,ports),artifactRepository:createArtifactReferenceRepository(driver,ports),store:artifacts,
    readers:new Map([[canonicalJson([f.source.sourceId,f.source.sourceRevision]),f.reader]])});
   const registered=await service.registerSource(principal,{...f.source,version:1,mode:'synthetic-fixture'});if(!['committed','replayed'].includes(registered.kind))throw Error(JSON.stringify(registered));
   result={source:f.source,receipt:await service.ingest(principal,f.request)};
  }
  else if(body.method==='seal')result=await createCutoffSnapshotService({...ports,repository:createCutoffSnapshotRepository(driver,ports),settlementRepository:context.repository,privateReferences:createPrivateReferenceService({...ports,store:artifacts,repository:createArtifactReferenceRepository(driver,ports)})}).assemble(principal,body.query);
  else if(body.method==='resume-cutoff'){
   const service=createCutoffSnapshotService({...ports,repository:createCutoffSnapshotRepository(driver,ports),settlementRepository:context.repository,privateReferences:createPrivateReferenceService({...ports,store:artifacts,repository:createArtifactReferenceRepository(driver,ports)})});
   const handler=createSnapshotHandler({...ports,service,freezeRepository:createCutoffFreezeRepository(driver,ports),store:artifacts,principal});let sequence=body.job.checkpointSeq;
   const outcome=await handler({job:body.job,lease:body.job.lease,payload:body.job.payload,signal:new AbortController().signal,deadlineMs:fixtureNow+5000,checkpoint:async(value:any)=>{const saved=await context.jobs.checkpoint(body.job.lease,{sequence,value});if(saved.kind==='checkpointed')sequence=saved.job.checkpointSeq;return saved;}});
   result=await context.jobs.finish(body.job.lease,outcome);
  }
  else if(body.method==='drain-outbox')result=await reconcileJobOutbox(driver,context.jobs,{limit:20});
  else if(body.method==='enqueue')result=await context.jobs.enqueue(await createJobCommand({principal,requestKey:body.input.businessKey,nowMs:fixtureNow,input:body.input},cryptoPort));
  else if(body.method==='schedule-cutoff')result=await context.scheduleCutoff(body.query);
  else if(body.method==='schedule')result=await context.scheduler.scheduleCampaigns(body.query);
  else if(body.method==='tick')result=await context.tick();
  else if(body.method==='acquire')result=await context.jobs.acquireJob();
  else if(body.method==='finish')result=await context.jobs.finish(body.lease,body.outcome);
  else if(body.method==='wake')result=await context.jobs.wake(body.input);
  else if(body.method==='prepare-board')result=await context.service.prepareBoard(principal,body.query);
  else if(body.method==='commit-board')result=await context.repository.commitBoard(body.command,body.lease);
  else if(body.method==='reconcile')result=await context.reconciler.inspectBoard(body.query);
  else result=await handleRecoveryControl(body,env,ports);
  if(result===undefined)throw Error('Unknown private fixture method');
  return Response.json(result,{headers:{'x-fixture-measurements':JSON.stringify(measurements)}});
 }catch(error){return Response.json({error:String(error)},{status:500});}
}};
