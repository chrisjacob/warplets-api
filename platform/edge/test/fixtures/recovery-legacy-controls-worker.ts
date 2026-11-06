import recovery from './recovery-legacy-adoption-worker';
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {r2ArtifactStore} from '../../../artifacts/r2';
import {createRetainedLegacyControlVerifier} from '../../../recovery/v2-legacy-admission-controls.mjs';
export default {async fetch(request:Request,env:Env){
 const body=await request.clone().json() as any;
 if(body.method!=='controls')return recovery.fetch(request,env as any);
 const base=createD1AtomicDriver(env.DB),backing=r2ArtifactStore(env.MANIFESTS),artifacts={async getVerified(identity:any){const result=await backing.getVerified(identity);if(body.fault==='mutation')await env.DB.prepare('UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1').run();return result;}};
 return Response.json({result:await createRetainedLegacyControlVerifier({driver:base,crypto:createWebCrypto(),artifacts}).verify(body.controlInput)});
}};
