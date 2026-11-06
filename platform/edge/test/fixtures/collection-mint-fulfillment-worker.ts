import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {r2ArtifactStore} from '../../../artifacts/r2';
import {createNobleBeaconVerifier} from '../../../beacon/noble-verifier.mjs';
import {dispatchMintFulfillment} from '../../../collect/mint-fulfillment-test-harness.mjs';
// Disposable private fixture. Production has no normalized mint fulfillment route.
export default {async fetch(request:Request,env:Env){
 if(request.method!=='POST'||new URL(request.url).pathname!=='/__fixture')return new Response('Not found',{status:404});
 const body=await request.json() as {nowMs:number};if(!Number.isSafeInteger(body.nowMs)||body.nowMs<0)return Response.json({error:'Invalid fixture clock.'},{status:400});
 return Response.json(await dispatchMintFulfillment({driver:createD1AtomicDriver(env.DB),crypto:createWebCrypto(),store:r2ArtifactStore(env.MANIFESTS),beaconVerifier:createNobleBeaconVerifier(),request:body}));
}};
