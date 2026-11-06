import {createRetainedCollectionObservationVerifier} from '../../../recovery/v2-legacy-current-observation.mjs';
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {r2ArtifactStore} from '../../../artifacts/r2';
export default {async fetch(request:Request,env:Env){
 if(new URL(request.url).pathname!=='/__fixture'||request.method!=='POST')return new Response('Not found',{status:404});
 try{const body=await request.json() as any,base=createWebCrypto(),store=r2ArtifactStore(env.MANIFESTS);let changed=false;
 const crypto={...base,async sha256(bytes:Uint8Array){const result=await base.sha256(bytes);if(body.fault==='watermark'&&!changed){changed=true;await env.DB.prepare('UPDATE app_recovery_watermark SET revision=revision+1').run();}return result;}};
 const artifacts=body.fault==='missing'?{...store,getVerified:async(identity:any)=>({status:'missing' as const,identity})}:store;
 return Response.json(await createRetainedCollectionObservationVerifier({driver:createD1AtomicDriver(env.DB),crypto,artifacts}).replay(body.input));
 }catch(error){return Response.json({error:String(error)},{status:409});}
}};
