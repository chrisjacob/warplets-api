// Local acceptance only. No member progression reservation endpoint is mounted.
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {dispatchProgressionReservation} from '../../../collect/reservation-test-harness.mjs';
export default {async fetch(request:Request,env:Env){
 if(request.method!=='POST'||new URL(request.url).pathname!=='/__fixture')return new Response('Not found',{status:404});
 return Response.json(await dispatchProgressionReservation({driver:createD1AtomicDriver(env.DB),crypto:createWebCrypto(),request:await request.json()}));
}};
