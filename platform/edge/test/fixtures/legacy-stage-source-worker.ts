// Private synthetic local acceptance only. No production HTTP mount.
import {createLegacyStageSource} from '../../../collect/legacy-stage-source.mjs';
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {createWorkerRecoveryDigest} from '../../../recovery/v2-worker-digest.mjs';
import {r2ArtifactStore} from '../../../artifacts/r2';
export default {async fetch(request:Request,env:{DB:D1Database;MANIFESTS:R2Bucket}){
 if(new URL(request.url).pathname!=='/__fixture'||request.method!=='POST')return new Response('Not found',{status:404});
 try{const body=await request.json() as any,base=createWebCrypto();let hashes=0;const crypto={...base,async sha256(bytes:Uint8Array){hashes++;if(body.fault==='source'&&hashes===5)await env.DB.prepare('UPDATE app_operator_scopes SET revision=revision+1 WHERE operator=?').bind('synthetic-stage-source').run();return base.sha256(bytes);}},service=createLegacyStageSource({driver:createD1AtomicDriver(env.DB),crypto,createDigest:createWorkerRecoveryDigest,artifacts:r2ArtifactStore(env.MANIFESTS)});return Response.json(await service.read(body.input));}catch(error){return Response.json({error:String(error)},{status:500});}
}};
