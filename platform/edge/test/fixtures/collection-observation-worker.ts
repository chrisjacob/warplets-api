// Disposable synthetic acceptance control. No public observation route.
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {r2ArtifactStore} from '../../../artifacts/r2';
import {dispatchCollectionObservation} from '../../../collect/observation-test-harness.mjs';
import {dispatchProgressionReservation} from '../../../collect/reservation-test-harness.mjs';
export default {async fetch(request:Request,env:Env){
 if(request.method!=='POST'||new URL(request.url).pathname!=='/__fixture')return new Response('Not found',{status:404});
 const body=await request.json() as any,ports={driver:createD1AtomicDriver(env.DB),crypto:createWebCrypto(),request:body};
 return Response.json(body.lane==='reservation'?await dispatchProgressionReservation(ports):await dispatchCollectionObservation({...ports,store:r2ArtifactStore(env.MANIFESTS)}));
}};
