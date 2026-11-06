import recovery from './recovery-adoption-full-worker';
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {r2ArtifactStore} from '../../../artifacts/r2';
import {dispatchImportedLifecycle} from '../../../collect/imported-lifecycle-test-harness.mjs';
// Private fixture only. Normal recovery is delegated unchanged to the67 harness.
export default {async fetch(request:Request,env:Env&{RECOVERY_SOURCE:R2Bucket}){
 if(new URL(request.url).pathname!=='/__fixture')return new Response('Not found',{status:404});
 const body=await request.clone().json() as any;if(body.method!=='business-replay')return recovery.fetch(request,env);
 if(body.request?.method!=='mint')return new Response('Invalid fixture command',{status:400});
 return Response.json(await dispatchImportedLifecycle({driver:createD1AtomicDriver(env.DB),crypto:createWebCrypto(),store:r2ArtifactStore(env.MANIFESTS),request:body.request}));
}};
