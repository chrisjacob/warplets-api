// Local test fixture only; no application Worker or external provider route.
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {createArtifactReferenceRepository} from '../../../storage/atomic-artifacts.mjs';
import {r2ArtifactStore} from '../../../artifacts/r2';
import {createEvidenceRepository} from '../../../evidence/repository.mjs';
import {createEvidenceService} from '../../../evidence/service.mjs';
import {createRecordedReader} from '../../../evidence/recorded.mjs';
import {canonicalJson} from '../../../security/canonical.mjs';
import type {EvidenceSource,Recording} from '../../../evidence/types';
export default {async fetch(request:Request,env:Env){
 if(new URL(request.url).hostname!=='localhost')return new Response('fixture only',{status:403});
 const b=await request.json() as {source:EvidenceSource;records:Array<Omit<Recording,'bytes'>&{bytes:number[]}>;now:number;action:'register'|'ingest'|'head';recordId:string;cutoff:number;supersedes:string|null;key:string;fault?:string};
 const cryptoPort=createWebCrypto(),base=createD1AtomicDriver(env.DB);let injected=false;
 const driver={...base,async batch(statements:Parameters<typeof base.batch>[0]){
  if(!injected&&statements[0].sql.startsWith('INSERT INTO app_command_receipts')&&statements[0].values.includes('evidence.record-receipt.v1')){
   injected=true;
   if(b.fault==='skip-head')statements=statements.filter(s=>!s.sql.startsWith('INSERT INTO app_evidence_heads'));
   if(b.fault==='lost-response'){await base.batch(statements);throw Error('fixture response lost');}
  }
  return base.batch(statements);
 }};
 const ports={crypto:cryptoPort,ids:{next:()=>crypto.randomUUID()},clock:{nowMs:()=>b.now}};
 const repository=createEvidenceRepository(driver,ports),artifactRepository=createArtifactReferenceRepository(driver,ports);
 const reader=await createRecordedReader({mode:b.source.mode,chainGenesis:b.source.chainGenesis,records:b.records.map(r=>({...r,bytes:new Uint8Array(r.bytes)})),crypto:cryptoPort});
 const service=createEvidenceService({...ports,repository,artifactRepository,store:r2ArtifactStore(env.MANIFESTS),readers:new Map([[canonicalJson([b.source.sourceId,b.source.sourceRevision]),reader]])});
 try{
  const result=b.action==='register'?await service.registerSource({kind:'operator',id:'fixture-reader'},b.source):b.action==='head'?await repository.selectHead(b.key):
   await service.ingest({kind:'operator',id:'fixture-reader'},{sourceId:b.source.sourceId,sourceRevision:b.source.sourceRevision,recordId:b.recordId,requestedCutoffMs:b.cutoff,supersedes:b.supersedes});
  return Response.json({result,counters:reader.counters()});
 }catch(error){return Response.json({error:String(error)},{status:409});}
}};
