// Test-only private reference orchestration, never a public ingestion route.
import { r2ArtifactStore } from '../../../artifacts/r2';
import { createPrivateReferenceService } from '../../../artifacts/reference-service.mjs';
import { createArtifactReferenceRepository } from '../../../storage/atomic-artifacts.mjs';
import { createD1AtomicDriver } from '../../../storage/d1/atomic-driver';
import { createWebCrypto } from '../../../security/web-crypto.mjs';
import type { ArtifactIdentity } from '../../../application/ports';
export default {async fetch(request:Request,env:Env){
  const body=await request.json() as {identity:ArtifactIdentity;bytes:number[];requestKey:string};
  const cryptoPort=createWebCrypto(),repository=createArtifactReferenceRepository(createD1AtomicDriver(env.DB),{crypto:cryptoPort,ids:{next:()=>crypto.randomUUID()}});
  const service=createPrivateReferenceService({store:r2ArtifactStore(env.MANIFESTS),repository,crypto:cryptoPort,clock:{nowMs:()=>100}});
  try{return Response.json(await service.persist({kind:'operator',id:'synthetic'},{...body,bytes:new Uint8Array(body.bytes)}));}
  catch(error){return Response.json({error:String(error)},{status:500});}
}};
