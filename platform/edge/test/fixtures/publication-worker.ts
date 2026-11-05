import worker from '../../src/worker';
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {r2ArtifactStore} from '../../../artifacts/r2';
import {createManifestCodec} from '../../../artifacts/manifest-codec.mjs';
import {createPublicationService} from '../../../artifacts/publication.mjs';
import {createPublicationRepository} from '../../../storage/publication.mjs';
import {createPrivateReferenceService} from '../../../artifacts/reference-service.mjs';
import {createArtifactReferenceRepository} from '../../../storage/atomic-artifacts.mjs';
import {createJobRepository} from '../../../jobs/repository.mjs';
import {reconcileJobOutbox} from '../../../jobs/outbox.mjs';
import type {Job,JobOutcome} from '../../../jobs/repository.mjs';
import type {JobLease,OperatorPrincipal} from '../../../application/ports';
export default {async fetch(request:Request,env:Env,ctx:ExecutionContext){
 if(new URL(request.url).pathname!=='/__fixture/publication')return worker.fetch(request,env,ctx);
 const body=await request.json() as {method:string;nowMs:number;principal:OperatorPrincipal;job:Job;lease:JobLease;outcome:JobOutcome;jobKey:string;fault?:string};
 let nowMs=body.nowMs,fired=false;const raw=createD1AtomicDriver(env.DB);
 await env.DB.prepare('CREATE TABLE IF NOT EXISTS fixture_publication_clock(now_ms INTEGER NOT NULL)').run();
 await env.DB.batch([env.DB.prepare('DELETE FROM fixture_publication_clock'),env.DB.prepare('INSERT INTO fixture_publication_clock VALUES(?)').bind(nowMs)]);
 const driver={...raw,leaseNowSql:'(SELECT now_ms FROM fixture_publication_clock)',async batch(statements:Parameters<typeof raw.batch>[0]){
  if(!fired&&statements.some(s=>s.sql.startsWith('INSERT INTO manifest_catalog'))){
   if(['omit-catalog','omit-state','lost-catalog'].includes(body.fault??'')){
    fired=true;const filtered=body.fault==='omit-catalog'?statements.filter(s=>!s.sql.startsWith('INSERT INTO manifest_catalog')):
     body.fault==='omit-state'?statements.filter(s=>!s.sql.startsWith("UPDATE app_artifact_publications SET state='published'")):statements;
    const result=await raw.batch(filtered);if(body.fault==='lost-catalog')throw Error('Synthetic lost committed catalog acknowledgement');return result;
   }
  }return raw.batch(statements);
 }};
 const cryptoPort=createWebCrypto(),ports={crypto:cryptoPort,clock:{nowMs:()=>nowMs},ids:{next:()=>crypto.randomUUID()}},baseStore=r2ArtifactStore(env.MANIFESTS);
 const store={...baseStore,async putIfAbsent(identity:Parameters<typeof baseStore.putIfAbsent>[0],bytes:Uint8Array){
  if(identity.visibility==='public'&&!fired){
   if(body.fault==='before-put'){fired=true;return {status:'unknown' as const,identity};}
   if(body.fault==='conflict'){fired=true;const changed=new Uint8Array(bytes);changed[0]^=1;await env.MANIFESTS.put(identity.key,changed,{httpMetadata:{contentType:identity.contentType}});}
   if(body.fault==='lost-put'){fired=true;await baseStore.putIfAbsent(identity,bytes);return {status:'unknown' as const,identity};}
   if(body.fault==='expired-lease'){fired=true;const result=await baseStore.putIfAbsent(identity,bytes);nowMs+=30001;await env.DB.prepare('UPDATE fixture_publication_clock SET now_ms=?').bind(nowMs).run();return result;}
  }return baseStore.putIfAbsent(identity,bytes);
 },async getVerified(identity:Parameters<typeof baseStore.getVerified>[0]){
  if(identity.visibility==='public'&&!fired&&body.fault==='readback'){fired=true;throw Error('Synthetic readback interruption');}return baseStore.getVerified(identity);
 }};
 const repository=createPublicationRepository(driver,ports),jobs=createJobRepository(driver,{...ports,principal:body.principal});
 const service=createPublicationService({repository,store,privateReferences:createPrivateReferenceService({store,repository:createArtifactReferenceRepository(driver,ports),...ports}),
  codec:createManifestCodec({crypto:cryptoPort}),...ports,principal:body.principal});
 try{
  const result=body.method==='drain'?await reconcileJobOutbox(driver,jobs):body.method==='acquire'?await jobs.acquireJob():
   body.method==='finish'?await jobs.finish(body.lease,body.outcome):body.method==='read'?await repository.readJob(body.jobKey):
   await service.run({job:body.job,lease:body.lease,signal:new AbortController().signal});
  return Response.json({result,nowMs});
 }catch(error){return Response.json({error:String(error),nowMs},{status:500});}
}};
