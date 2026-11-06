// Disposable private synthetic fixture only; no public fulfillment route.
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {r2ArtifactStore} from '../../../artifacts/r2';
import {createNobleBeaconVerifier} from '../../../beacon/noble-verifier.mjs';
import {dispatchCollectionFulfillment} from '../../../collect/fulfillment-test-harness.mjs';
import {dispatchProgressionReservation} from '../../../collect/reservation-test-harness.mjs';
import {dispatchCollectionObservation} from '../../../collect/observation-test-harness.mjs';
export default {async fetch(request:Request,env:Env){
 if(request.method!=='POST'||new URL(request.url).pathname!=='/__fixture')return new Response('Not found',{status:404});
 const body=await request.json() as any,ports={driver:createD1AtomicDriver(env.DB),crypto:createWebCrypto(),request:body},store=r2ArtifactStore(env.MANIFESTS);
 return Response.json(body.lane==='reservation'?await dispatchProgressionReservation(ports):body.lane==='observation'?await dispatchCollectionObservation({...ports,store}):await dispatchCollectionFulfillment({...ports,store,beaconVerifier:createNobleBeaconVerifier()}));
}};
